import { resolve } from "node:path";

import type { Event, Part } from "@opencode-ai/sdk/v2";
import {
  AgentProviderError,
  JsonValueSchema,
  type AgentErrorCode,
  type AgentEvent,
  type AgentModel,
  type AgentProvider,
  type AgentSession,
  type AgentSessionStatus,
  type CreateAgentSessionInput,
  type ProviderStatus,
  type StreamAgentMessageInput,
} from "@aptiloop/agent-core/shared";

import {
  OpenCodeConfigurationError,
  resolveOpenCodeConnection,
  type OpenCodeEnvironment,
} from "./config.js";
import {
  SdkOpenCodeTransport,
  type OpenCodeMessageRecord,
  type OpenCodeProviderRecord,
  type OpenCodeProviderSnapshot,
  type OpenCodeTransport,
} from "./transport.js";

const CAPABILITIES = [
  "streaming",
  "models",
  "tools",
  "structured-output",
  "cancellation",
] as const;

const REVIEWER_DENIED_TOOLS: Readonly<Record<string, boolean>> = {
  apply_patch: false,
  bash: false,
  edit: false,
  patch: false,
  shell: false,
  write: false,
};

const REVIEWER_PERMISSION = [
  { permission: "*", pattern: "*", action: "deny" as const },
];

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_TURN_TIMEOUT_MS = 10 * 60_000;

interface Deadline {
  readonly controller: AbortController;
  dispose(): void;
}

function abortError(reason: unknown): Error {
  return reason instanceof Error
    ? reason
    : new DOMException("The operation was aborted", "AbortError");
}

function timeoutError(operation: string): DOMException {
  return new DOMException(
    `OpenCode ${operation} exceeded its deadline`,
    "TimeoutError",
  );
}

function validateTimeout(value: number, option: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new OpenCodeConfigurationError(
      `${option} must be a positive integer in milliseconds`,
    );
  }
  return value;
}

function createDeadline(
  timeoutMs: number,
  operation: string,
  parentSignal?: AbortSignal,
): Deadline {
  const controller = new AbortController();
  const abortFromParent = () => {
    controller.abort(abortError(parentSignal?.reason));
  };

  if (parentSignal?.aborted === true) {
    abortFromParent();
  } else {
    parentSignal?.addEventListener("abort", abortFromParent, { once: true });
  }

  const timeout = setTimeout(() => {
    controller.abort(timeoutError(operation));
  }, timeoutMs);
  timeout.unref();

  return {
    controller,
    dispose() {
      clearTimeout(timeout);
      parentSignal?.removeEventListener("abort", abortFromParent);
    },
  };
}

async function waitWithSignal<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) {
    throw abortError(signal.reason);
  }

  let removeAbortListener: () => void = () => {};
  const aborted = new Promise<never>((_resolve, reject) => {
    const onAbort = () => reject(abortError(signal.reason));
    removeAbortListener = () => signal.removeEventListener("abort", onAbort);
    signal.addEventListener("abort", onAbort, { once: true });
  });

  try {
    return await Promise.race([promise, aborted]);
  } finally {
    removeAbortListener();
  }
}

async function runWithDeadline<T>(
  timeoutMs: number,
  operation: string,
  task: (signal: AbortSignal) => Promise<T>,
  parentSignal?: AbortSignal,
): Promise<T> {
  const deadline = createDeadline(timeoutMs, operation, parentSignal);
  try {
    if (deadline.controller.signal.aborted) {
      throw abortError(deadline.controller.signal.reason);
    }
    return await waitWithSignal(
      Promise.resolve().then(() => task(deadline.controller.signal)),
      deadline.controller.signal,
    );
  } finally {
    deadline.dispose();
  }
}

interface StoredSession {
  readonly id: string;
  readonly role: CreateAgentSessionInput["role"];
  readonly modelId: string;
  readonly providerID: string;
  readonly nativeModelID: string;
  readonly systemPrompt: string;
  readonly createdAt: string;
  readonly metadata?: CreateAgentSessionInput["metadata"];
  status: AgentSessionStatus;
}

export interface OpenCodeAgentProviderOptions {
  readonly endpoint?: string;
  readonly directory: string;
  readonly env?: OpenCodeEnvironment;
  readonly transport?: OpenCodeTransport;
  readonly now?: () => Date;
  /** Deadline for one HTTP/session lifecycle request. Defaults to 15 seconds. */
  readonly requestTimeoutMs?: number;
  /** Maximum duration of one streamed model turn. Defaults to 10 minutes. */
  readonly turnTimeoutMs?: number;
}

function parseModelId(modelId: string): {
  providerID: string;
  nativeModelID: string;
} {
  const separator = modelId.indexOf("/");
  if (separator <= 0 || separator === modelId.length - 1) {
    throw new AgentProviderError(
      "invalid_input",
      "OpenCode model id must use provider/model format",
    );
  }

  return {
    providerID: modelId.slice(0, separator),
    nativeModelID: modelId.slice(separator + 1),
  };
}

function agentModelId(providerID: string, modelID: string): string {
  return `${providerID}/${modelID}`;
}

function toAgentModels(snapshot: OpenCodeProviderSnapshot): AgentModel[] {
  return snapshot.providers.flatMap((provider) => {
    if (!snapshot.connectedProviderIDs.has(provider.id)) {
      return [];
    }

    return provider.models.map((model) => ({
      id: agentModelId(provider.id, model.id),
      providerId: "opencode" as const,
      name: `${provider.name} · ${model.name}`,
      description: [
        model.capabilities.reasoning ? "reasoning" : undefined,
        model.capabilities.attachment ? "attachments" : undefined,
        model.capabilities.toolcall ? "tools" : undefined,
      ]
        .filter((value): value is string => value !== undefined)
        .join(", "),
      supportsStreaming: true,
      available: true,
    }));
  });
}

function toAgentSession(session: StoredSession): AgentSession {
  return {
    id: session.id,
    providerId: "opencode",
    role: session.role,
    modelId: session.modelId,
    status: session.status,
    createdAt: session.createdAt,
    ...(session.metadata === undefined ? {} : { metadata: session.metadata }),
  };
}

function eventSessionId(event: Event): string | undefined {
  switch (event.type) {
    case "message.updated":
    case "message.removed":
    case "message.part.updated":
    case "message.part.removed":
    case "session.status":
    case "session.idle":
    case "session.compacted":
    case "session.error":
      return event.properties.sessionID;
    default:
      return undefined;
  }
}

function messageContent(
  message: OpenCodeMessageRecord,
  responseFormat: StreamAgentMessageInput["responseFormat"],
): string {
  if (responseFormat === "json") {
    const parsed = JsonValueSchema.safeParse(message.structured);
    if (!parsed.success) {
      return "";
    }
    return JSON.stringify(parsed.data) ?? "";
  }

  return message.parts
    .filter(
      (part): part is Extract<Part, { type: "text" }> =>
        part.type === "text" && part.ignored !== true,
    )
    .map((part) => part.text)
    .join("");
}

// Provider tool inputs and outputs are intentionally discarded. Aptiloop owns
// the tool boundary and persists only lifecycle metadata.

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
}

function retryableOpenCodeError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("data" in error)) {
    return false;
  }

  const data = error.data;
  return (
    typeof data === "object" &&
    data !== null &&
    "isRetryable" in data &&
    data.isRetryable === true
  );
}

function errorCode(error: unknown): AgentErrorCode {
  if (typeof error !== "object" || error === null || !("name" in error)) {
    return "provider_error";
  }

  switch (error.name) {
    case "MessageAbortedError":
      return "cancelled";
    case "ProviderAuthError":
      return "misconfigured";
    case "StructuredOutputError":
    case "MessageOutputLengthError":
    case "ContextOverflowError":
      return "invalid_output";
    default:
      return "provider_error";
  }
}

export class OpenCodeAgentProvider implements AgentProvider {
  public readonly id = "opencode" as const;

  readonly #directory: string;
  readonly #now: () => Date;
  readonly #requestTimeoutMs: number;
  readonly #turnTimeoutMs: number;
  readonly #transport?: OpenCodeTransport;
  readonly #configurationError?: OpenCodeConfigurationError;
  readonly #sessions = new Map<string, StoredSession>();
  readonly #streamControllers = new Map<string, AbortController>();
  #shuttingDown = false;
  #shutdownPromise?: Promise<void>;

  public constructor(options: OpenCodeAgentProviderOptions) {
    this.#directory = resolve(options.directory);
    this.#now = options.now ?? (() => new Date());
    this.#requestTimeoutMs = validateTimeout(
      options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
      "requestTimeoutMs",
    );
    this.#turnTimeoutMs = validateTimeout(
      options.turnTimeoutMs ?? DEFAULT_TURN_TIMEOUT_MS,
      "turnTimeoutMs",
    );

    if (options.directory.trim() === "") {
      this.#configurationError = new OpenCodeConfigurationError(
        "OpenCode directory is required",
      );
      return;
    }

    if (options.transport !== undefined) {
      this.#transport = options.transport;
      return;
    }

    try {
      const connection = resolveOpenCodeConnection(
        options.endpoint,
        options.env,
      );
      this.#transport = new SdkOpenCodeTransport(connection);
    } catch (error) {
      if (error instanceof OpenCodeConfigurationError) {
        this.#configurationError = error;
        return;
      }
      throw error;
    }
  }

  public async getStatus(signal?: AbortSignal): Promise<ProviderStatus> {
    const checkedAt = this.#now().toISOString();
    if (this.#configurationError !== undefined) {
      return {
        providerId: this.id,
        state: "misconfigured",
        message: this.#configurationError.message,
        checkedAt,
        capabilities: [...CAPABILITIES],
      };
    }

    if (this.#shuttingDown) {
      return {
        providerId: this.id,
        state: "unavailable",
        message: "OpenCode adapter is shutting down",
        checkedAt,
        capabilities: [...CAPABILITIES],
      };
    }

    try {
      const health = await this.#request(
        "health check",
        (requestSignal) => this.#requireTransport().health(requestSignal),
        signal,
      );
      return {
        providerId: this.id,
        state: health.healthy ? "connected" : "error",
        message: `OpenCode ${health.version}`,
        checkedAt,
        capabilities: [...CAPABILITIES],
      };
    } catch {
      return {
        providerId: this.id,
        state: "unavailable",
        message: "OpenCode serve is unavailable",
        checkedAt,
        capabilities: [...CAPABILITIES],
      };
    }
  }

  public async listProviders(
    signal?: AbortSignal,
  ): Promise<OpenCodeProviderSnapshot> {
    try {
      return await this.#request(
        "provider list",
        (requestSignal) =>
          this.#requireTransport().listProviders(
            this.#directory,
            requestSignal,
          ),
        signal,
      );
    } catch (error) {
      if (error instanceof AgentProviderError) {
        throw error;
      }
      throw new AgentProviderError(
        "unavailable",
        "OpenCode provider list is unavailable",
        true,
        { cause: error },
      );
    }
  }

  public async listModels(signal?: AbortSignal): Promise<AgentModel[]> {
    return toAgentModels(await this.listProviders(signal));
  }

  public async createSession(
    input: CreateAgentSessionInput,
  ): Promise<AgentSession> {
    this.#assertRunning();
    const selected = parseModelId(input.modelId);
    const providers = await this.listProviders();
    this.#assertRunnableModel(
      providers,
      selected.providerID,
      selected.nativeModelID,
    );
    this.#assertRunning();

    try {
      const remote = await this.#request("session creation", (signal) =>
        this.#requireTransport().createSession(
          {
            directory: this.#directory,
            title: `Aptiloop · ${input.role}`,
            ...(input.role === "reviewer"
              ? { permission: REVIEWER_PERMISSION }
              : {}),
          },
          signal,
        ),
      );
      if (this.#shuttingDown) {
        await this.#abortRemoteSession(remote.id);
        throw new AgentProviderError(
          "unavailable",
          "OpenCode adapter is shutting down",
        );
      }
      const session: StoredSession = {
        id: remote.id,
        role: input.role,
        modelId: input.modelId,
        providerID: selected.providerID,
        nativeModelID: selected.nativeModelID,
        systemPrompt: input.systemPrompt,
        createdAt: this.#now().toISOString(),
        ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
        status: "active",
      };
      this.#sessions.set(session.id, session);
      return toAgentSession(session);
    } catch (error) {
      if (error instanceof AgentProviderError) {
        throw error;
      }
      throw new AgentProviderError(
        "provider_error",
        "OpenCode session could not be created",
        true,
        { cause: error },
      );
    }
  }

  public async *streamMessage(
    input: StreamAgentMessageInput,
  ): AsyncIterable<AgentEvent> {
    this.#assertRunning();
    const session = this.#sessions.get(input.sessionId);
    if (session === undefined) {
      throw new AgentProviderError(
        "session_not_found",
        `Unknown OpenCode session: ${input.sessionId}`,
      );
    }
    if (session.status !== "active") {
      throw new AgentProviderError(
        "invalid_input",
        `OpenCode session is ${session.status}`,
      );
    }
    if (this.#streamControllers.has(session.id)) {
      throw new AgentProviderError(
        "invalid_input",
        "OpenCode session already has an active response",
      );
    }

    const turnDeadline = createDeadline(this.#turnTimeoutMs, "session turn");
    const controller = turnDeadline.controller;
    this.#streamControllers.set(session.id, controller);
    let sequence = 0;
    let assistantMessageID: string | undefined;
    let remoteTurnFinished = false;
    const textByPart = new Map<string, string>();
    const toolStatuses = new Map<string, string>();

    const eventBase = () => ({
      sessionId: session.id,
      sequence: sequence++,
      timestamp: this.#now().toISOString(),
    });

    try {
      const stream = await this.#turnRequest(
        "event subscription",
        controller,
        (signal) => this.#requireTransport().subscribe(this.#directory, signal),
      );
      const iterator = stream[Symbol.asyncIterator]();
      const connectedEvent = await waitWithSignal(
        iterator.next(),
        controller.signal,
      );
      if (connectedEvent.done) {
        throw new AgentProviderError(
          "unavailable",
          "OpenCode event stream ended before connecting",
          true,
        );
      }
      let bufferedEvent: Event | undefined = connectedEvent.value;

      await this.#turnRequest("session prompt", controller, (signal) =>
        this.#requireTransport().promptAsync(
          {
            sessionID: session.id,
            directory: this.#directory,
            providerID: session.providerID,
            modelID: session.nativeModelID,
            prompt: input.message,
            responseFormat: input.responseFormat,
            system: session.systemPrompt,
            ...(session.role === "reviewer"
              ? { tools: REVIEWER_DENIED_TOOLS }
              : {}),
          },
          signal,
        ),
      );

      while (true) {
        const item =
          bufferedEvent === undefined
            ? await waitWithSignal(iterator.next(), controller.signal)
            : { done: false as const, value: bufferedEvent };
        bufferedEvent = undefined;
        if (item.done) {
          throw new AgentProviderError(
            "provider_error",
            "OpenCode event stream ended before session completion",
            true,
          );
        }
        const event = item.value;

        if (eventSessionId(event) !== session.id) {
          continue;
        }

        if (
          event.type === "message.updated" &&
          event.properties.info.role === "assistant"
        ) {
          assistantMessageID = event.properties.info.id;
          continue;
        }

        if (event.type === "message.part.updated") {
          const part = event.properties.part;
          if (part.type === "text") {
            const previous = textByPart.get(part.id) ?? "";
            const delta = part.text.startsWith(previous)
              ? part.text.slice(previous.length)
              : part.text;
            textByPart.set(part.id, part.text);
            if (delta !== "") {
              yield { ...eventBase(), type: "message.delta", delta };
            }
            continue;
          }

          if (part.type === "tool") {
            const currentStatus = part.state.status;
            const previousStatus = toolStatuses.get(part.callID);
            toolStatuses.set(part.callID, currentStatus);

            if (
              (currentStatus === "pending" || currentStatus === "running") &&
              previousStatus === undefined
            ) {
              yield {
                ...eventBase(),
                type: "tool.started",
                toolCallId: part.callID,
                toolName: part.tool,
              };
              continue;
            }

            if (
              (currentStatus === "completed" || currentStatus === "error") &&
              previousStatus !== "completed" &&
              previousStatus !== "error"
            ) {
              if (previousStatus === undefined) {
                yield {
                  ...eventBase(),
                  type: "tool.started",
                  toolCallId: part.callID,
                  toolName: part.tool,
                };
              }
              yield {
                ...eventBase(),
                type: "tool.completed",
                toolCallId: part.callID,
                toolName: part.tool,
              };
            }
          }
          continue;
        }

        if (event.type === "session.error") {
          const code = errorCode(event.properties.error);
          session.status = code === "cancelled" ? "cancelled" : "failed";
          remoteTurnFinished = true;
          yield {
            ...eventBase(),
            type: "error",
            error: {
              code,
              message: "OpenCode failed while generating a response",
              retryable: retryableOpenCodeError(event.properties.error),
            },
          };
          yield {
            ...eventBase(),
            type: "session.completed",
            reason: session.status === "cancelled" ? "cancelled" : "failed",
          };
          return;
        }

        if (event.type === "session.idle") {
          const finalMessage = await this.#getFinalAssistantMessage(
            session.id,
            assistantMessageID,
            controller.signal,
          );
          const content = messageContent(finalMessage, input.responseFormat);
          if (finalMessage.error !== undefined) {
            throw new AgentProviderError(
              errorCode(finalMessage.error),
              "OpenCode returned a failed assistant message",
              retryableOpenCodeError(finalMessage.error),
            );
          }
          if (content === "") {
            throw new AgentProviderError(
              "invalid_output",
              "OpenCode returned an empty assistant message",
            );
          }

          remoteTurnFinished = true;
          yield { ...eventBase(), type: "message.completed", content };
          yield {
            ...eventBase(),
            type: "session.completed",
            reason: "completed",
          };
          return;
        }
      }
    } catch (error) {
      if (
        isAbortError(error) &&
        (error as DOMException).name === "TimeoutError"
      ) {
        session.status = "failed";
        yield {
          ...eventBase(),
          type: "error",
          error: {
            code: "unavailable",
            message: "OpenCode response deadline was exceeded",
            retryable: true,
          },
        };
        yield { ...eventBase(), type: "session.completed", reason: "failed" };
        return;
      }

      if (controller.signal.aborted || isAbortError(error)) {
        session.status = "cancelled";
        yield {
          ...eventBase(),
          type: "session.completed",
          reason: "cancelled",
        };
        return;
      }

      session.status = "failed";
      const providerError =
        error instanceof AgentProviderError
          ? error
          : new AgentProviderError(
              "provider_error",
              "OpenCode failed while generating a response",
              true,
              { cause: error },
            );
      yield {
        ...eventBase(),
        type: "error",
        error: {
          code: providerError.code,
          message: providerError.message,
          retryable: providerError.retryable,
        },
      };
      yield { ...eventBase(), type: "session.completed", reason: "failed" };
    } finally {
      controller.abort();
      turnDeadline.dispose();
      this.#streamControllers.delete(session.id);
      if (!remoteTurnFinished && session.status !== "cancelled") {
        if (session.status === "active") {
          session.status = "cancelled";
        }
        try {
          await this.#abortRemoteSession(session.id);
        } catch {
          // The local iterator is already closed; shutdown/cancel remains best-effort here.
        }
      }
    }
  }

  public async cancelSession(sessionId: string): Promise<void> {
    const session = this.#sessions.get(sessionId);
    if (session === undefined) {
      throw new AgentProviderError(
        "session_not_found",
        `Unknown OpenCode session: ${sessionId}`,
      );
    }

    session.status = "cancelled";
    this.#streamControllers.get(sessionId)?.abort();
    try {
      await this.#abortRemoteSession(sessionId);
    } catch (error) {
      throw new AgentProviderError(
        "provider_error",
        "OpenCode session could not be cancelled",
        true,
        { cause: error },
      );
    }
  }

  /** Stops active SSE streams and asks OpenCode to abort active sessions. */
  public shutdown(): Promise<void> {
    if (this.#shutdownPromise !== undefined) {
      return this.#shutdownPromise;
    }
    this.#shuttingDown = true;

    this.#shutdownPromise = this.#shutdownActiveSessions();
    return this.#shutdownPromise;
  }

  async #shutdownActiveSessions(): Promise<void> {
    const activeSessions = [...this.#sessions.values()].filter(
      (session) => session.status === "active",
    );
    for (const controller of this.#streamControllers.values()) {
      controller.abort();
    }

    await Promise.allSettled(
      activeSessions.map(async (session) => {
        session.status = "cancelled";
        await this.#abortRemoteSession(session.id);
      }),
    );
    this.#streamControllers.clear();
  }

  #requireTransport(): OpenCodeTransport {
    if (
      this.#configurationError !== undefined ||
      this.#transport === undefined
    ) {
      throw new AgentProviderError(
        "misconfigured",
        this.#configurationError?.message ?? "OpenCode is not configured",
      );
    }
    return this.#transport;
  }

  #assertRunning(): void {
    this.#requireTransport();
    if (this.#shuttingDown) {
      throw new AgentProviderError(
        "unavailable",
        "OpenCode adapter is shutting down",
      );
    }
  }

  #request<T>(
    operation: string,
    task: (signal: AbortSignal) => Promise<T>,
    parentSignal?: AbortSignal,
  ): Promise<T> {
    return runWithDeadline(
      this.#requestTimeoutMs,
      operation,
      task,
      parentSignal,
    );
  }

  #turnRequest<T>(
    operation: string,
    turnController: AbortController,
    task: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const requestDeadline = createDeadline(
      this.#requestTimeoutMs,
      operation,
      turnController.signal,
    );
    const request = task(turnController.signal);

    return waitWithSignal(request, requestDeadline.controller.signal)
      .catch((error: unknown) => {
        if (
          isAbortError(error) &&
          (error as { readonly name: string }).name === "TimeoutError"
        ) {
          turnController.abort(error);
        }
        throw error;
      })
      .finally(() => requestDeadline.dispose());
  }

  #abortRemoteSession(sessionID: string): Promise<void> {
    return this.#request("session abort", (signal) =>
      this.#requireTransport().abortSession(sessionID, this.#directory, signal),
    );
  }

  #assertRunnableModel(
    snapshot: OpenCodeProviderSnapshot,
    providerID: string,
    modelID: string,
  ): void {
    const provider = snapshot.providers.find((item) => item.id === providerID);
    if (
      provider === undefined ||
      !snapshot.connectedProviderIDs.has(providerID) ||
      !provider.models.some((model) => model.id === modelID)
    ) {
      throw new AgentProviderError(
        "model_unavailable",
        `OpenCode model is not runnable: ${providerID}/${modelID}`,
      );
    }
  }

  async #getFinalAssistantMessage(
    sessionID: string,
    messageID: string | undefined,
    signal: AbortSignal,
  ): Promise<OpenCodeMessageRecord> {
    const transport = this.#requireTransport();
    if (messageID !== undefined) {
      return this.#request(
        "session message",
        (requestSignal) =>
          transport.getMessage(
            sessionID,
            messageID,
            this.#directory,
            requestSignal,
          ),
        signal,
      );
    }

    const messages = await this.#request(
      "session messages",
      (requestSignal) =>
        transport.listMessages(sessionID, this.#directory, requestSignal),
      signal,
    );
    const assistant = messages.findLast(
      (message) => message.role === "assistant",
    );
    if (assistant === undefined) {
      throw new AgentProviderError(
        "invalid_output",
        "OpenCode completed without an assistant message",
      );
    }
    return assistant;
  }
}

export type { OpenCodeProviderRecord };
