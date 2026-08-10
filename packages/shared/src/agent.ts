import { z } from "zod";

import { JsonValueSchema } from "./json.js";

export const AgentRoleSchema = z.enum([
  "course-designer",
  "teacher",
  "reviewer",
  "interviewer",
  "curator",
  "codex-expert",
  "flashcard-generator",
  "daily-summary",
  "weekly-analysis",
]);
export type AgentRole = z.infer<typeof AgentRoleSchema>;

export const ProviderIdSchema = z.enum(["mock", "opencode", "codex", "pi"]);
export type ProviderId = z.infer<typeof ProviderIdSchema>;

export const ProviderConnectionStateSchema = z.enum([
  "disabled",
  "starting",
  "connected",
  "degraded",
  "authentication-required",
  "unavailable",
  "misconfigured",
  "error",
]);
export type ProviderConnectionState = z.infer<
  typeof ProviderConnectionStateSchema
>;

export const ProviderCapabilitySchema = z.enum([
  "streaming",
  "models",
  "tools",
  "structured-output",
  "cancellation",
]);
export type ProviderCapability = z.infer<typeof ProviderCapabilitySchema>;

export const ProviderStatusSchema = z.object({
  providerId: ProviderIdSchema,
  state: ProviderConnectionStateSchema,
  message: z.string().min(1).optional(),
  checkedAt: z.string().datetime(),
  capabilities: z.array(ProviderCapabilitySchema).default([]),
});
export type ProviderStatus = z.infer<typeof ProviderStatusSchema>;

export const AgentModelSchema = z.object({
  id: z.string().min(1),
  providerId: ProviderIdSchema,
  name: z.string().min(1),
  description: z.string().optional(),
  contextWindow: z.number().int().positive().optional(),
  supportsStreaming: z.boolean().default(true),
  available: z.boolean().default(true),
});
export type AgentModel = z.infer<typeof AgentModelSchema>;

export const AgentSessionStatusSchema = z.enum([
  "active",
  "completed",
  "cancelled",
  "failed",
]);
export type AgentSessionStatus = z.infer<typeof AgentSessionStatusSchema>;

export const AgentSessionSchema = z.object({
  id: z.string().min(1),
  providerId: ProviderIdSchema,
  role: AgentRoleSchema,
  modelId: z.string().min(1),
  status: AgentSessionStatusSchema,
  createdAt: z.string().datetime(),
  metadata: z.record(z.string(), JsonValueSchema).optional(),
});
export type AgentSession = z.infer<typeof AgentSessionSchema>;

export const CreateAgentSessionInputSchema = z.object({
  role: AgentRoleSchema,
  modelId: z.string().min(1),
  systemPrompt: z.string().min(1),
  metadata: z.record(z.string(), JsonValueSchema).optional(),
});
export type CreateAgentSessionInput = z.infer<
  typeof CreateAgentSessionInputSchema
>;

export const StreamAgentMessageInputSchema = z.object({
  sessionId: z.string().min(1),
  message: z.string().min(1),
  context: z.record(z.string(), JsonValueSchema).optional(),
  responseFormat: z.enum(["text", "json"]).default("text"),
});
export type StreamAgentMessageInput = z.infer<
  typeof StreamAgentMessageInputSchema
>;

export const AgentErrorCodeSchema = z.enum([
  "cancelled",
  "invalid_input",
  "invalid_output",
  "misconfigured",
  "model_unavailable",
  "provider_error",
  "session_not_found",
  "timeout",
  "unavailable",
]);
export type AgentErrorCode = z.infer<typeof AgentErrorCodeSchema>;

export const AgentErrorSchema = z.object({
  code: AgentErrorCodeSchema,
  message: z.string().min(1),
  retryable: z.boolean().default(false),
  diagnosticId: z.string().min(1).optional(),
});
export type AgentError = z.infer<typeof AgentErrorSchema>;

const EventBaseSchema = z.object({
  sessionId: z.string().min(1),
  sequence: z.number().int().nonnegative(),
  timestamp: z.string().datetime(),
});

export const AgentEventSchema = z.discriminatedUnion("type", [
  EventBaseSchema.extend({
    type: z.literal("message.delta"),
    delta: z.string(),
  }),
  EventBaseSchema.extend({
    type: z.literal("message.completed"),
    content: z.string(),
  }),
  EventBaseSchema.extend({
    type: z.literal("tool.started"),
    toolCallId: z.string().min(1),
    toolName: z.string().min(1),
    input: JsonValueSchema.optional(),
  }),
  EventBaseSchema.extend({
    type: z.literal("tool.completed"),
    toolCallId: z.string().min(1),
    toolName: z.string().min(1),
    output: JsonValueSchema.optional(),
  }),
  EventBaseSchema.extend({ type: z.literal("error"), error: AgentErrorSchema }),
  EventBaseSchema.extend({
    type: z.literal("session.completed"),
    reason: z.enum(["completed", "cancelled", "failed"]),
  }),
]);
export type AgentEvent = z.infer<typeof AgentEventSchema>;
