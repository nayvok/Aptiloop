import type { AgentError, AgentEvent, JsonValue } from "@dlh/shared";

import type { CodexNotification } from "./protocol.js";

interface NormalizerOptions {
  now?: () => Date;
}

export class CodexEventNormalizer {
  readonly #sessionId: string;
  readonly #now: () => Date;
  #sequence = 0;

  constructor(sessionId: string, options: NormalizerOptions = {}) {
    this.#sessionId = sessionId;
    this.#now = options.now ?? (() => new Date());
  }

  normalize(notification: CodexNotification): AgentEvent[] {
    const { method, params } = notification;
    if (
      method === "item/agentMessage/delta" &&
      typeof params.delta === "string"
    ) {
      return [this.#event({ type: "message.delta", delta: params.delta })];
    }

    if (method === "item/completed" && isRecord(params.item)) {
      const item = params.item;
      if (item.type === "agentMessage" && typeof item.text === "string") {
        return [this.#event({ type: "message.completed", content: item.text })];
      }
      const tool = toolDetails(item);
      if (tool) {
        return [
          this.#event({
            type: "tool.completed",
            toolCallId: tool.id,
            toolName: tool.name,
            output: tool.output,
          }),
        ];
      }
    }

    if (method === "item/started" && isRecord(params.item)) {
      const tool = toolDetails(params.item);
      if (tool) {
        return [
          this.#event({
            type: "tool.started",
            toolCallId: tool.id,
            toolName: tool.name,
            input: tool.input,
          }),
        ];
      }
    }

    if (method === "error") {
      return [this.#event({ type: "error", error: notificationError(params) })];
    }

    if (method === "transport/error") {
      const message =
        typeof params.message === "string"
          ? params.message
          : "Codex app-server became unavailable";
      return [
        this.#event({
          type: "error",
          error: { code: "unavailable", message, retryable: true },
        }),
        this.#event({ type: "session.completed", reason: "failed" }),
      ];
    }

    if (method === "turn/completed" && isRecord(params.turn)) {
      const status = params.turn.status;
      if (status === "failed") {
        const error = isRecord(params.turn.error)
          ? notificationError({ error: params.turn.error, willRetry: false })
          : {
              code: "provider_error" as const,
              message: "Codex turn failed",
              retryable: false,
            };
        return [
          this.#event({ type: "error", error }),
          this.#event({ type: "session.completed", reason: "failed" }),
        ];
      }
      return [
        this.#event({
          type: "session.completed",
          reason: status === "interrupted" ? "cancelled" : "completed",
        }),
      ];
    }
    return [];
  }

  #event(payload: EventPayload): AgentEvent {
    return {
      ...payload,
      sessionId: this.#sessionId,
      sequence: this.#sequence++,
      timestamp: this.#now().toISOString(),
    } as AgentEvent;
  }
}

type WithoutEventBase<Event> = Event extends AgentEvent
  ? Omit<Event, "sessionId" | "sequence" | "timestamp">
  : never;
type EventPayload = WithoutEventBase<AgentEvent>;

interface ToolDetails {
  id: string;
  name: string;
  input: JsonValue;
  output: JsonValue;
}

function toolDetails(item: Record<string, unknown>): ToolDetails | undefined {
  if (typeof item.id !== "string" || typeof item.type !== "string")
    return undefined;
  switch (item.type) {
    case "commandExecution":
      return {
        id: item.id,
        name: "commandExecution",
        input: { command: jsonString(item.command), cwd: jsonString(item.cwd) },
        output: {
          status: jsonString(item.status),
          exitCode: jsonScalar(item.exitCode),
          output: jsonString(item.aggregatedOutput),
        },
      };
    case "fileChange":
      return {
        id: item.id,
        name: "fileChange",
        input: { changes: toJson(item.changes) },
        output: {
          status: jsonString(item.status),
          changes: toJson(item.changes),
        },
      };
    case "mcpToolCall":
      return {
        id: item.id,
        name: `mcp:${jsonString(item.server)}:${jsonString(item.tool)}`,
        input: toJson(item.arguments),
        output: {
          status: jsonString(item.status),
          result: toJson(item.result),
          error: toJson(item.error),
        },
      };
    case "dynamicToolCall":
      return {
        id: item.id,
        name: jsonString(item.tool) || "dynamicToolCall",
        input: toJson(item.arguments),
        output: {
          status: jsonString(item.status),
          success: jsonScalar(item.success),
          contentItems: toJson(item.contentItems),
        },
      };
    default:
      return undefined;
  }
}

function notificationError(params: Record<string, unknown>): AgentError {
  const rawError = isRecord(params.error) ? params.error : {};
  return {
    code: "provider_error",
    message:
      typeof rawError.message === "string"
        ? rawError.message
        : "Codex reported an error",
    retryable: params.willRetry === true,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function jsonScalar(value: unknown): JsonValue {
  return value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
    ? value
    : null;
}

function toJson(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map(toJson);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, toJson(item)]),
    );
  }
  return null;
}
