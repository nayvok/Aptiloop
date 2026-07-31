import { z } from "zod";

import { AgentRoleSchema, ProviderIdSchema } from "./agent.js";

export const IdSchema = z.string().min(1).max(128);
export const IsoDateTimeSchema = z.string().datetime();

export const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    requestId: z.string().min(1).optional(),
  }),
});
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

export const AgentChatRequestSchema = z.object({
  role: AgentRoleSchema,
  providerId: ProviderIdSchema,
  modelId: z.string().min(1),
  sessionId: z.string().min(1).optional(),
  message: z.string().trim().min(1).max(50_000),
});
export type AgentChatRequest = z.infer<typeof AgentChatRequestSchema>;

export const SaveAnswerRequestSchema = z.object({
  questionId: IdSchema,
  answer: z.string().trim().min(1).max(50_000),
  submittedAt: IsoDateTimeSchema,
});
export type SaveAnswerRequest = z.infer<typeof SaveAnswerRequestSchema>;

export const ProviderRoleSelectionSchema = z.object({
  role: AgentRoleSchema,
  providerId: ProviderIdSchema,
  modelId: z.string().min(1),
});
export type ProviderRoleSelection = z.infer<typeof ProviderRoleSelectionSchema>;
