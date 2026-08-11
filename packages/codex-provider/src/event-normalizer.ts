import type { AgentError, AgentEvent, JsonValue } from "@aptiloop/shared";

import type { CodexNotification } from "./protocol.js";
import { redactSensitiveText, safeToolStatus } from "./sanitization.js";

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
      return [
        this.#event({
          type: "message.delta",
          delta: redactSensitiveText(params.delta),
        }),
      ];
    }

    if (method === "item/completed" && isRecord(params.item)) {
      const item = params.item;
      if (item.type === "agentMessage" && typeof item.text === "string") {
        return [
          this.#event({
            type: "message.completed",
            content: redactSensitiveText(item.text),
          }),
        ];
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
      return [
        this.#event({
          type: "error",
          error: {
            code: "unavailable",
            message: "Codex app-server became unavailable",
            retryable: true,
          },
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
        input: { kind: "command" },
        output: {
          status: safeToolStatus(item.status),
          exitCode: safeExitCode(item.exitCode),
        },
      };
    case "fileChange":
      return {
        id: item.id,
        name: "fileChange",
        input: { kind: "file-change" },
        output: { status: safeToolStatus(item.status) },
      };
    case "mcpToolCall":
      return {
        id: item.id,
        name: "mcpToolCall",
        input: { kind: "mcp" },
        output: { status: safeToolStatus(item.status) },
      };
    case "dynamicToolCall":
      return {
        id: item.id,
        name: "dynamicToolCall",
        input: { kind: "dynamic-tool" },
        output: {
          status: safeToolStatus(item.status),
          success: typeof item.success === "boolean" ? item.success : null,
        },
      };
    default:
      return undefined;
  }
}

function notificationError(params: Record<string, unknown>): AgentError {
  return {
    code: "provider_error",
    message: "Codex reported an error",
    retryable: params.willRetry === true,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeExitCode(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value)
    ? value
    : null;
}
