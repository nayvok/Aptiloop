import { AgentProviderError, type AgentProvider } from "@dlh/agent-core";
import type {
  AgentEvent,
  AgentModel,
  AgentSession,
  AgentSessionStatus,
  CreateAgentSessionInput,
  JsonValue,
  ProviderStatus,
  StreamAgentMessageInput,
} from "@dlh/shared";

import {
  CodexAppServerTransport,
  type CodexAppServerOptions,
} from "./app-server-transport.js";
import { CodexEventNormalizer } from "./event-normalizer.js";
import {
  CodexTransportError,
  type CodexNotification,
  type CodexTransport,
} from "./protocol.js";

interface SessionState {
  session: AgentSession;
  threadId: string;
  activeTurnId?: string;
}

export interface CodexProviderOptions extends CodexAppServerOptions {
  transport?: CodexTransport;
  now?: () => Date;
}

export class CodexProvider implements AgentProvider {
  readonly id = "codex" as const;
  readonly #transport: CodexTransport;
  readonly #now: () => Date;
  readonly #sessions = new Map<string, SessionState>();

  constructor(options: CodexProviderOptions = {}) {
    this.#transport = options.transport ?? new CodexAppServerTransport(options);
    this.#now = options.now ?? (() => new Date());
  }

  async getStatus(signal?: AbortSignal): Promise<ProviderStatus> {
    const checkedAt = this.#now().toISOString();
    if (signal?.aborted)
      return status(
        "unavailable",
        checkedAt,
        "Codex status check was cancelled",
      );
    try {
      await this.#transport.connect();
      const account = await this.#transport.readAccount();
      if (signal?.aborted)
        return status(
          "unavailable",
          checkedAt,
          "Codex status check was cancelled",
        );
      if (account.requiresOpenaiAuth && account.account === null) {
        return status(
          "misconfigured",
          checkedAt,
          "Codex is installed but not signed in",
        );
      }
      return status("connected", checkedAt);
    } catch (error) {
      if (error instanceof CodexTransportError) {
        if (error.code === "unavailable" || error.code === "closed") {
          return status("unavailable", checkedAt, error.message);
        }
        if (error.code === "misconfigured")
          return status("misconfigured", checkedAt, error.message);
      }
      return status("error", checkedAt, safeErrorMessage(error));
    }
  }

  async listModels(signal?: AbortSignal): Promise<AgentModel[]> {
    throwIfAborted(signal);
    try {
      const models = await this.#transport.listModels();
      throwIfAborted(signal);
      return models.map((model) => ({
        id: model.model,
        providerId: this.id,
        name: model.displayName,
        ...(model.description ? { description: model.description } : {}),
        supportsStreaming: true,
        available: true,
      }));
    } catch (error) {
      throw providerError(error);
    }
  }

  async createSession(input: CreateAgentSessionInput): Promise<AgentSession> {
    const cwd = stringMetadata(input.metadata, "cwd");
    const existingThreadId = stringMetadata(input.metadata, "codexThreadId");
    const reviewer = input.role === "reviewer";
    const threadParams = {
      model: input.modelId,
      ...(cwd ? { cwd } : {}),
      developerInstructions: input.systemPrompt,
      sandbox: reviewer ? ("read-only" as const) : ("workspace-write" as const),
      approvalPolicy: "never" as const,
    };

    try {
      const result = existingThreadId
        ? await this.#transport.resumeThread({
            ...threadParams,
            threadId: existingThreadId,
          })
        : await this.#transport.startThread(threadParams);
      const session: AgentSession = {
        id: result.thread.id,
        providerId: this.id,
        role: input.role,
        modelId: input.modelId,
        status: "active",
        createdAt: this.#now().toISOString(),
        metadata: {
          ...input.metadata,
          codexThreadId: result.thread.id,
          sandbox: reviewer ? "read-only" : "workspace-write",
          approvalPolicy: "never",
        },
      };
      this.#sessions.set(session.id, { session, threadId: result.thread.id });
      return session;
    } catch (error) {
      throw providerError(error);
    }
  }

  async *streamMessage(
    input: StreamAgentMessageInput,
  ): AsyncIterable<AgentEvent> {
    const state = this.#sessions.get(input.sessionId);
    if (!state)
      throw new AgentProviderError(
        "session_not_found",
        "Codex session was not found",
      );
    if (state.activeTurnId)
      throw new AgentProviderError(
        "invalid_input",
        "Codex session already has an active turn",
      );

    const normalizer = new CodexEventNormalizer(input.sessionId, {
      now: this.#now,
    });
    const queue = new AsyncQueue<CodexNotification>();
    let terminalStatus: AgentSessionStatus | undefined;
    const unsubscribe = this.#transport.subscribe((notification) => {
      if (notification.method === "transport/error") {
        queue.push(notification);
        queue.end();
        return;
      }
      if (notification.params.threadId !== state.threadId) return;
      const notificationTurnId = notificationTurn(notification);
      if (
        state.activeTurnId &&
        notificationTurnId &&
        notificationTurnId !== state.activeTurnId
      )
        return;
      queue.push(notification);
      if (notification.method === "turn/completed") queue.end();
    });

    try {
      const response = await this.#transport.startTurn({
        threadId: state.threadId,
        input: [{ type: "text", text: messageWithContext(input) }],
        model: state.session.modelId,
        approvalPolicy: "never",
        sandboxPolicy:
          state.session.role === "reviewer"
            ? { type: "readOnly", networkAccess: false }
            : {
                type: "workspaceWrite",
                networkAccess: false,
                writableRoots: [],
              },
      });
      state.activeTurnId = response.turn.id;

      for await (const notification of queue) {
        for (const event of normalizer.normalize(notification)) {
          if (event.type === "session.completed") {
            terminalStatus =
              event.reason === "completed"
                ? "active"
                : event.reason === "cancelled"
                  ? "cancelled"
                  : "failed";
          }
          yield event;
        }
      }
    } catch (error) {
      throw providerError(error);
    } finally {
      unsubscribe();
      delete state.activeTurnId;
      if (terminalStatus) state.session.status = terminalStatus;
    }
  }

  async cancelSession(sessionId: string): Promise<void> {
    const state = this.#sessions.get(sessionId);
    if (!state)
      throw new AgentProviderError(
        "session_not_found",
        "Codex session was not found",
      );
    if (state.activeTurnId) {
      try {
        await this.#transport.interruptTurn({
          threadId: state.threadId,
          turnId: state.activeTurnId,
        });
      } catch (error) {
        throw providerError(error);
      }
    }
    state.session.status = "cancelled";
  }

  async shutdown(): Promise<void> {
    await this.#transport.shutdown();
  }
}

function status(
  state: ProviderStatus["state"],
  checkedAt: string,
  message?: string,
): ProviderStatus {
  return {
    providerId: "codex",
    state,
    checkedAt,
    capabilities: ["streaming", "models", "tools", "cancellation"],
    ...(message ? { message } : {}),
  };
}

function stringMetadata(
  metadata: Record<string, JsonValue> | undefined,
  key: string,
): string | undefined {
  const value = metadata?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function messageWithContext(input: StreamAgentMessageInput): string {
  const context =
    input.context && Object.keys(input.context).length > 0
      ? `Context (JSON):\n${JSON.stringify(input.context)}\n\n`
      : "";
  const responseInstruction =
    input.responseFormat === "json" ? "\n\nReturn only valid JSON." : "";
  return `${context}${input.message}${responseInstruction}`;
}

function notificationTurn(notification: CodexNotification): string | undefined {
  if (typeof notification.params.turnId === "string")
    return notification.params.turnId;
  return isRecord(notification.params.turn) &&
    typeof notification.params.turn.id === "string"
    ? notification.params.turn.id
    : undefined;
}

function providerError(error: unknown): AgentProviderError {
  if (error instanceof AgentProviderError) return error;
  if (error instanceof CodexTransportError) {
    if (error.code === "misconfigured")
      return new AgentProviderError("misconfigured", error.message, false, {
        cause: error,
      });
    if (error.code === "unavailable" || error.code === "closed") {
      return new AgentProviderError("unavailable", error.message, true, {
        cause: error,
      });
    }
  }
  return new AgentProviderError(
    "provider_error",
    safeErrorMessage(error),
    false,
    { cause: error },
  );
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted)
    throw new AgentProviderError("cancelled", "Operation was cancelled");
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Unexpected Codex provider error";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

class AsyncQueue<T> implements AsyncIterable<T> {
  readonly #values: T[] = [];
  readonly #waiters: Array<(result: IteratorResult<T>) => void> = [];
  #ended = false;

  push(value: T): void {
    if (this.#ended) return;
    const waiter = this.#waiters.shift();
    if (waiter) waiter({ value, done: false });
    else this.#values.push(value);
  }

  end(): void {
    this.#ended = true;
    for (const waiter of this.#waiters.splice(0))
      waiter({ value: undefined, done: true });
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const value = this.#values.shift();
        if (value !== undefined) return Promise.resolve({ value, done: false });
        if (this.#ended)
          return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => this.#waiters.push(resolve));
      },
    };
  }
}
