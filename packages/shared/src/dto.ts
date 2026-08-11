import { z } from "zod";

import { AgentRoleSchema, ProviderIdSchema } from "./agent.js";
import { DisclosurePayloadCategorySchema } from "./provider-hub.js";

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

const InterviewDisclosureIdSchema = z.string().trim().min(1).max(200);
const InterviewDisclosureOperationIdSchema = z.string().trim().min(8).max(200);

export const InterviewDisclosureContinuationSchema = z.discriminatedUnion(
  "kind",
  [
    z
      .object({
        kind: z.literal("start"),
        learningSessionId: InterviewDisclosureIdSchema.nullable(),
        interviewId: InterviewDisclosureIdSchema,
        operationId: InterviewDisclosureOperationIdSchema,
      })
      .strict(),
    z
      .object({
        kind: z.literal("answer"),
        learningSessionId: InterviewDisclosureIdSchema.nullable(),
        interviewId: InterviewDisclosureIdSchema,
        questionId: InterviewDisclosureIdSchema,
        operationId: InterviewDisclosureOperationIdSchema,
      })
      .strict(),
  ],
);
export type InterviewDisclosureContinuation = z.infer<
  typeof InterviewDisclosureContinuationSchema
>;

export const InterviewPendingDisclosureSchema = z
  .object({
    kind: z.literal("disclosure"),
    required: z.literal(true),
    continuation: InterviewDisclosureContinuationSchema,
    disclosure: z
      .object({
        operationId: InterviewDisclosureIdSchema,
        status: z.literal("pending"),
        createdAt: IsoDateTimeSchema,
        expiresAt: IsoDateTimeSchema,
        scope: z
          .object({
            destination: z.string().trim().min(1).max(500),
            payloadCategories: z
              .array(DisclosurePayloadCategorySchema)
              .min(1)
              .max(20),
            byteCount: z.number().int().nonnegative().max(2_500_000),
            exclusions: z.array(z.string().trim().min(1).max(300)).max(30),
          })
          .strict(),
      })
      .strict(),
  })
  .strict();
export type InterviewPendingDisclosure = z.infer<
  typeof InterviewPendingDisclosureSchema
>;
