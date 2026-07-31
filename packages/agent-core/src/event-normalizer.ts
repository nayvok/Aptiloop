import {
  AgentEventSchema,
  type AgentEvent,
  type AgentErrorCode,
  type JsonValue,
} from "@dlh/shared";

type UnknownRecord = Readonly<Record<string, unknown>>;

export interface EventNormalizerOptions {
  readonly now?: () => Date;
  readonly startSequence?: number;
}

export interface AgentEventNormalizer {
  normalize(raw: unknown): AgentEvent[];
  readonly nextSequence: number;
}

type WithoutEventBase<T> = T extends unknown
  ? Omit<T, "sequence" | "sessionId" | "timestamp">
  : never;
type AgentEventPayload = WithoutEventBase<AgentEvent>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const stringField = (
  record: UnknownRecord,
  ...names: string[]
): string | undefined => {
  for (const name of names) {
    const value = record[name];
    if (typeof value === "string") return value;
  }
  return undefined;
};

const toJsonValue = (value: unknown): JsonValue | undefined => {
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) {
    const items = value.map(toJsonValue);
    return items.some((item) => item === undefined)
      ? undefined
      : (items as JsonValue[]);
  }
  if (isRecord(value)) {
    const result: Record<string, JsonValue> = {};
    for (const [key, item] of Object.entries(value)) {
      const json = toJsonValue(item);
      if (json === undefined) return undefined;
      result[key] = json;
    }
    return result;
  }
  return undefined;
};

export function createAgentEventNormalizer(
  sessionId: string,
  options: EventNormalizerOptions = {},
): AgentEventNormalizer {
  let sequence = options.startSequence ?? 0;
  const now = options.now ?? (() => new Date());
  const event = (payload: AgentEventPayload): AgentEvent =>
    AgentEventSchema.parse({
      ...payload,
      sessionId,
      sequence: sequence++,
      timestamp: now().toISOString(),
    });

  return {
    get nextSequence() {
      return sequence;
    },
    normalize(raw: unknown): AgentEvent[] {
      if (!isRecord(raw)) return [];
      const type = stringField(raw, "type", "event", "kind");
      if (!type) return [];

      if (
        [
          "message.delta",
          "text-delta",
          "content_block_delta",
          "agent_message_delta",
        ].includes(type)
      ) {
        const delta = stringField(raw, "delta", "text", "content");
        return delta === undefined
          ? []
          : [event({ type: "message.delta", delta })];
      }
      if (
        [
          "message.completed",
          "text",
          "agent_message",
          "response.completed",
        ].includes(type)
      ) {
        const content = stringField(raw, "content", "text", "message");
        return content === undefined
          ? []
          : [event({ type: "message.completed", content })];
      }
      if (["tool.started", "tool_start", "tool-call"].includes(type)) {
        const toolCallId = stringField(raw, "toolCallId", "callId", "id");
        const toolName = stringField(raw, "toolName", "name", "tool");
        if (!toolCallId || !toolName) return [];
        const input = toJsonValue(raw["input"] ?? raw["arguments"]);
        const payload =
          input === undefined
            ? { type: "tool.started" as const, toolCallId, toolName }
            : { type: "tool.started" as const, toolCallId, toolName, input };
        return [event(payload)];
      }
      if (["tool.completed", "tool_end", "tool-result"].includes(type)) {
        const toolCallId = stringField(raw, "toolCallId", "callId", "id");
        const toolName = stringField(raw, "toolName", "name", "tool");
        if (!toolCallId || !toolName) return [];
        const output = toJsonValue(raw["output"] ?? raw["result"]);
        const payload =
          output === undefined
            ? { type: "tool.completed" as const, toolCallId, toolName }
            : { type: "tool.completed" as const, toolCallId, toolName, output };
        return [event(payload)];
      }
      if (["error", "turn.error", "response.failed"].includes(type)) {
        const codeValue = stringField(raw, "code");
        const allowedCodes: readonly AgentErrorCode[] = [
          "cancelled",
          "invalid_input",
          "invalid_output",
          "misconfigured",
          "model_unavailable",
          "provider_error",
          "session_not_found",
          "timeout",
          "unavailable",
        ];
        const code =
          allowedCodes.find((candidate) => candidate === codeValue) ??
          "provider_error";
        return [
          event({
            type: "error",
            error: {
              code,
              message: stringField(raw, "message", "error") ?? "Provider error",
              retryable: raw["retryable"] === true,
            },
          }),
        ];
      }
      if (["session.completed", "turn.completed", "done"].includes(type)) {
        const rawReason = stringField(raw, "reason", "status");
        const reason =
          rawReason === "cancelled" || rawReason === "failed"
            ? rawReason
            : "completed";
        return [event({ type: "session.completed", reason })];
      }
      return [];
    },
  };
}

export function normalizeAgentEvents(
  sessionId: string,
  rawEvents: readonly unknown[],
): AgentEvent[] {
  const normalizer = createAgentEventNormalizer(sessionId);
  return rawEvents.flatMap((raw) => normalizer.normalize(raw));
}
