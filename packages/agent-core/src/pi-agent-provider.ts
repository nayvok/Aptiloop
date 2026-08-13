import { randomUUID } from "node:crypto";

import {
  Agent,
  type AgentEvent as PiAgentEvent,
  type AgentTool,
} from "@earendil-works/pi-agent-core";
import {
  createModels,
  type AssistantMessage,
  type AuthInteraction,
  type AuthType,
  type Credential,
  type Models,
} from "@earendil-works/pi-ai";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { opencodeProvider } from "@earendil-works/pi-ai/providers/opencode";
import {
  AgentSessionSchema,
  AptiloopToolNameSchema,
  type AgentEvent,
  type AgentModel,
  type AgentSession,
  type CreateAgentSessionInput,
  type ProviderId,
  type ProviderStatus,
  type StreamAgentMessageInput,
} from "@aptiloop/shared";

import { createAgentEventNormalizer } from "./event-normalizer.js";
import { AgentProviderError, type AgentProvider } from "./provider.js";
import { CORE_TOOL_POLICIES } from "./typed-tool-host.js";
import { toAptiloopAiRole } from "./roles.js";

interface PiSession {
  readonly session: AgentSession;
  readonly agent: Agent;
  cancelled: boolean;
}

export interface PiAgentProviderOptions {
  readonly models: Models;
  readonly providerType: string;
  readonly id?: ProviderId;
  readonly adapterVersion?: string;
  readonly now?: () => Date;
  readonly toolsForRole?: (
    role: ReturnType<typeof toAptiloopAiRole>,
    input: CreateAgentSessionInput,
  ) => readonly AgentTool[];
}

export class PiAgentProvider implements AgentProvider {
  readonly id: ProviderId;
  readonly providerType: string;
  readonly adapterVersion: string;
  readonly #models: Models;
  readonly #now: () => Date;
  readonly #toolsForRole: PiAgentProviderOptions["toolsForRole"] | undefined;
  readonly #sessions = new Map<string, PiSession>();
  #lastSuccessfulRequestAt: string | null = null;

  constructor(options: PiAgentProviderOptions) {
    this.#models = options.models;
    this.id = options.id ?? "pi";
    this.providerType = options.providerType;
    this.adapterVersion = options.adapterVersion ?? "0.84.1";
    this.#now = options.now ?? (() => new Date());
    this.#toolsForRole = options.toolsForRole;
  }
  supportsAuthType(type: AuthType): boolean {
    const auth = this.#models.getProvider(this.providerType)?.auth;
    return type === "api_key"
      ? auth?.apiKey !== undefined
      : auth?.oauth !== undefined;
  }

  async login(
    type: AuthType,
    interaction: AuthInteraction,
  ): Promise<Credential> {
    if (!this.supportsAuthType(type)) {
      throw new AgentProviderError(
        "invalid_input",
        `Pi provider ${this.providerType} does not support ${type} authentication`,
      );
    }
    return this.#models.login(this.providerType, type, interaction);
  }

  async logout(signal?: AbortSignal): Promise<void> {
    await this.#models.logout(
      this.providerType,
      signal ? { signal } : undefined,
    );
  }

  async getStatus(signal?: AbortSignal): Promise<ProviderStatus> {
    signal?.throwIfAborted();
    if (!this.#models.getProvider(this.providerType)) {
      return {
        providerId: this.id,
        state: "misconfigured",
        message: `Pi provider ${this.providerType} is not registered`,
        checkedAt: this.#now().toISOString(),
        capabilities: [],
      };
    }
    try {
      const auth = await this.#models.checkAuth(
        this.providerType,
        signal ? { signal } : undefined,
      );
      if (!auth) {
        return {
          providerId: this.id,
          state: "authentication-required",
          message: `Authentication is required for ${this.providerType}`,
          checkedAt: this.#now().toISOString(),
          capabilities: ["models"],
        };
      }
      return {
        providerId: this.id,
        state: this.#lastSuccessfulRequestAt ? "connected" : "degraded",
        message: this.#lastSuccessfulRequestAt
          ? `Last authenticated request succeeded at ${this.#lastSuccessfulRequestAt}`
          : "Authentication is configured; no authenticated request has been observed",
        checkedAt: this.#now().toISOString(),
        capabilities: ["streaming", "models", "tools", "cancellation"],
      };
    } catch (error) {
      return {
        providerId: this.id,
        state: "authentication-required",
        message: safeErrorMessage(
          error,
          `Authentication failed for ${this.providerType}`,
        ),
        checkedAt: this.#now().toISOString(),
        capabilities: ["models"],
      };
    }
  }

  async listModels(signal?: AbortSignal): Promise<AgentModel[]> {
    signal?.throwIfAborted();
    const authenticated =
      (await this.#models.checkAuth(
        this.providerType,
        signal ? { signal } : undefined,
      )) !== undefined;
    return this.#models.getModels(this.providerType).map((model) => ({
      id: model.id,
      providerId: this.id,
      name: model.name,
      contextWindow: model.contextWindow > 0 ? model.contextWindow : undefined,
      supportsStreaming: true,
      available: authenticated,
      description: `${this.providerType}/${model.id}`,
    }));
  }

  async createSession(
    input: CreateAgentSessionInput,
    signal?: AbortSignal,
  ): Promise<AgentSession> {
    signal?.throwIfAborted();
    const available = await this.#models.getAvailable(
      this.providerType,
      signal ? { signal } : undefined,
    );
    signal?.throwIfAborted();
    const model = available.find((candidate) => candidate.id === input.modelId);
    if (!model) {
      throw new AgentProviderError(
        "model_unavailable",
        `Configured Pi model ${this.providerType}/${input.modelId} is unavailable`,
      );
    }
    const id = `pi-session:${randomUUID()}`;
    const session = AgentSessionSchema.parse({
      id,
      providerId: this.id,
      role: input.role,
      modelId: input.modelId,
      status: "active",
      createdAt: this.#now().toISOString(),
      metadata: input.metadata,
    });
    const role = toAptiloopAiRole(input.role);
    const policy = CORE_TOOL_POLICIES.find(
      (candidate) => candidate.role === role,
    );
    if (!policy) {
      throw new AgentProviderError(
        "invalid_input",
        `No Aptiloop tool policy exists for ${role}`,
      );
    }
    const allowedToolNames = new Set<string>(policy.allowedTools);
    const tools = [...(this.#toolsForRole?.(role, input) ?? [])].map((tool) => {
      const parsedToolName = AptiloopToolNameSchema.safeParse(tool.name);
      if (!parsedToolName.success) {
        throw new AgentProviderError(
          "invalid_input",
          `Tool ${tool.name} is outside the Aptiloop tool registry`,
        );
      }
      const toolName = parsedToolName.data;
      if (!allowedToolNames.has(toolName)) {
        throw new AgentProviderError(
          "invalid_input",
          `Tool ${toolName} is not allowed for ${role}`,
        );
      }
      return tool;
    });
    const agent = new Agent({
      initialState: {
        systemPrompt: input.systemPrompt,
        model,
        tools,
      },
      streamFn: this.#models.streamSimple.bind(this.#models),
      sessionId: id,
      toolExecution: "sequential",
      beforeToolCall: async ({ toolCall }) =>
        allowedToolNames.has(toolCall.name)
          ? undefined
          : {
              block: true,
              reason: `Tool ${toolCall.name} is not allowed by Aptiloop policy`,
              terminate: true,
            },
    });
    this.#sessions.set(id, { session, agent, cancelled: false });
    return session;
  }

  async *streamMessage(
    input: StreamAgentMessageInput,
  ): AsyncIterable<AgentEvent> {
    const stored = this.#sessions.get(input.sessionId);
    if (!stored) {
      throw new AgentProviderError(
        "session_not_found",
        `Unknown Pi session: ${input.sessionId}`,
      );
    }
    if (stored.session.status !== "active") {
      throw new AgentProviderError(
        "invalid_input",
        `Pi session is ${stored.session.status}`,
      );
    }

    const normalizer = createAgentEventNormalizer(stored.session.id, {
      now: this.#now,
    });
    const queue = new AsyncEventQueue<AgentEvent>();
    let lastAssistant: AssistantMessage | undefined;
    let terminal = false;
    const emitTerminal = (
      reason: "completed" | "failed" | "cancelled",
      errorMessage?: string,
    ) => {
      if (terminal) return;
      terminal = true;
      if (errorMessage && reason === "failed") {
        const [event] = normalizer.normalize({
          type: "error",
          code: "provider_error",
          message: errorMessage,
        });
        if (event) queue.push(event);
      }
      const [event] = normalizer.normalize({
        type: "session.completed",
        reason,
      });
      if (event) queue.push(event);
      stored.session.status = reason === "completed" ? "active" : reason;
      queue.close();
    };
    const unsubscribe = stored.agent.subscribe((event: PiAgentEvent) => {
      if (
        event.type === "message_update" &&
        event.assistantMessageEvent.type === "text_delta"
      ) {
        const [normalized] = normalizer.normalize({
          type: "message.delta",
          delta: event.assistantMessageEvent.delta,
        });
        if (normalized) queue.push(normalized);
      } else if (
        event.type === "message_end" &&
        event.message.role === "assistant"
      ) {
        lastAssistant = event.message;
      } else if (event.type === "tool_execution_start") {
        const [normalized] = normalizer.normalize({
          type: "tool.started",
          toolCallId: event.toolCallId,
          toolName: event.toolName,
        });
        if (normalized) queue.push(normalized);
      } else if (event.type === "tool_execution_end") {
        const [normalized] = normalizer.normalize({
          type: "tool.completed",
          toolCallId: event.toolCallId,
          toolName: event.toolName,
        });
        if (normalized) queue.push(normalized);
      } else if (event.type === "agent_end") {
        if (stored.cancelled || lastAssistant?.stopReason === "aborted") {
          emitTerminal("cancelled");
          return;
        }
        if (!lastAssistant || lastAssistant.errorMessage) {
          emitTerminal(
            "failed",
            lastAssistant?.errorMessage ?? "Pi returned no assistant result",
          );
          return;
        }
        const content = lastAssistant.content
          .filter((block) => block.type === "text")
          .map((block) => block.text)
          .join("");
        const [normalized] = normalizer.normalize({
          type: "message.completed",
          content,
        });
        if (normalized) queue.push(normalized);
        this.#lastSuccessfulRequestAt = this.#now().toISOString();
        emitTerminal("completed");
      }
    });

    void stored.agent.prompt(input.message).catch((error: unknown) => {
      emitTerminal("failed", safeErrorMessage(error, "Pi request failed"));
    });

    try {
      for await (const event of queue) yield event;
    } finally {
      unsubscribe();
      if (!terminal) stored.agent.abort();
    }
  }

  async cancelSession(sessionId: string): Promise<void> {
    const stored = this.#sessions.get(sessionId);
    if (!stored) {
      throw new AgentProviderError(
        "session_not_found",
        `Unknown Pi session: ${sessionId}`,
      );
    }
    stored.cancelled = true;
    stored.session.status = "cancelled";
    stored.agent.abort();
    await stored.agent.waitForIdle();
    this.#sessions.delete(sessionId);
  }
}

export function createOpenAiPiAgentProvider(
  options: Pick<PiAgentProviderOptions, "toolsForRole"> = {},
): PiAgentProvider {
  const models = createModels();
  models.setProvider(openaiProvider());
  return new PiAgentProvider({
    models,
    providerType: "openai",
    adapterVersion: "0.84.1",
    ...options,
  });
}

export function createOpenCodeZenPiAgentProvider(
  options: Pick<PiAgentProviderOptions, "toolsForRole"> = {},
): PiAgentProvider {
  const models = createModels();
  models.setProvider(opencodeProvider());
  return new PiAgentProvider({
    id: "opencode",
    models,
    providerType: "opencode",
    adapterVersion: "0.84.1",
    ...options,
  });
}

class AsyncEventQueue<T> implements AsyncIterable<T> {
  readonly #values: T[] = [];
  readonly #waiters: Array<(result: IteratorResult<T>) => void> = [];
  #closed = false;

  push(value: T): void {
    if (this.#closed) return;
    const waiter = this.#waiters.shift();
    if (waiter) waiter({ value, done: false });
    else this.#values.push(value);
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const waiter of this.#waiters.splice(0)) {
      waiter({ value: undefined as T, done: true });
    }
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    while (true) {
      const value = this.#values.shift();
      if (value !== undefined) {
        yield value;
        continue;
      }
      if (this.#closed) return;
      const next = await new Promise<IteratorResult<T>>((resolve) => {
        this.#waiters.push(resolve);
      });
      if (next.done) return;
      yield next.value;
    }
  }
}

function safeErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim()
    ? error.message.slice(0, 500)
    : fallback;
}
