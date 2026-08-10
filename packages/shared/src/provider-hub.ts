import { z } from "zod";

import {
  ProviderCapabilitySchema,
  ProviderConnectionStateSchema,
  ProviderIdSchema,
} from "./agent.js";
import { JsonValueSchema } from "./json.js";

const StableIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[a-z0-9][a-z0-9._:-]*$/u);
const Sha256Schema = z
  .string()
  .regex(/^sha256:[a-f0-9]{64}$/u, "Expected a lowercase SHA-256 digest");

export const AptiloopAiRoleSchema = z.enum([
  "course-designer",
  "tutor",
  "evaluator",
  "reviewer",
]);
export type AptiloopAiRole = z.infer<typeof AptiloopAiRoleSchema>;

export const AptiloopToolNameSchema = z.enum([
  "course.readDraftSlice",
  "course.proposeDraftPatch",
  "knowledge.readCapsule",
  "lesson.readLearnerSafeContext",
  "lesson.submitTutorMessage",
  "knowledge.readSnapshotSlice",
  "evaluation.readAttemptBundle",
  "evaluation.submitTypedResult",
  "review.readBundle",
  "review.submitResult",
]);
export type AptiloopToolName = z.infer<typeof AptiloopToolNameSchema>;

export const ProviderTypedToolCallsSchema = z.enum([
  "none",
  "best-effort",
  "schema-constrained",
]);
export type ProviderTypedToolCalls = z.infer<
  typeof ProviderTypedToolCallsSchema
>;

export const ModelCapabilityProfileSchema = z
  .object({
    modelId: z.string().trim().min(1).max(300),
    available: z.boolean(),
    contextTokens: z.number().int().positive().nullable(),
    outputTokens: z.number().int().positive().nullable(),
    typedToolCalls: ProviderTypedToolCallsSchema,
    parallelToolCalls: z.boolean(),
    attachments: z.array(z.enum(["text", "image"])).max(2),
  })
  .strict();
export type ModelCapabilityProfile = z.infer<
  typeof ModelCapabilityProfileSchema
>;

export const ProviderCapabilityProfileSchema = z
  .object({
    providerType: z.string().trim().min(1).max(100),
    adapterVersion: z.string().trim().min(1).max(100),
    observedAt: z.string().datetime(),
    models: z.array(ModelCapabilityProfileSchema).max(500),
    connection: z
      .object({
        authenticated: z.boolean(),
        streaming: z.boolean(),
        cancellation: z.boolean(),
      })
      .strict(),
  })
  .strict();
export type ProviderCapabilityProfile = z.infer<
  typeof ProviderCapabilityProfileSchema
>;

export const ProviderConnectionSchema = z
  .object({
    connectionId: StableIdSchema,
    adapterId: ProviderIdSchema,
    providerType: z.string().trim().min(1).max(100),
    displayName: z.string().trim().min(1).max(200),
    credentialRef: StableIdSchema.nullable(),
    endpointProfileId: StableIdSchema.nullable(),
    enabled: z.boolean(),
    external: z.boolean(),
    state: ProviderConnectionStateSchema,
    observedCapabilities: ProviderCapabilityProfileSchema.nullable(),
    lastCheckedAt: z.string().datetime().nullable(),
  })
  .strict();
export type ProviderConnection = z.infer<typeof ProviderConnectionSchema>;

export const RoleBudgetsSchema = z
  .object({
    maxInputBytes: z.number().int().positive().max(2_500_000),
    maxOutputBytes: z.number().int().positive().max(1_000_000),
    maxEvents: z.number().int().positive().max(10_000),
    maxToolCalls: z.number().int().nonnegative().max(100),
    deadlineMs: z.number().int().positive().max(600_000),
  })
  .strict();
export type RoleBudgets = z.infer<typeof RoleBudgetsSchema>;

export const RoleProfileSchema = z
  .object({
    role: AptiloopAiRoleSchema,
    mode: z.enum(["no-ai", "connection"]),
    connectionId: StableIdSchema.nullable(),
    modelId: z.string().trim().min(1).max(300).nullable(),
    requiredCapabilities: z.array(ProviderCapabilitySchema).max(20),
    toolPolicyId: StableIdSchema,
    budgets: RoleBudgetsSchema,
  })
  .strict()
  .superRefine((profile, context) => {
    const hasConnection =
      profile.connectionId !== null && profile.modelId !== null;
    const hasAnySelection =
      profile.connectionId !== null || profile.modelId !== null;
    if (profile.mode === "connection" && !hasConnection) {
      context.addIssue({
        code: "custom",
        message: "Connection mode requires a connection and exact model",
      });
    }
    if (profile.mode === "no-ai" && hasAnySelection) {
      context.addIssue({
        code: "custom",
        message: "No-AI mode cannot retain an active connection selection",
      });
    }
  });
export type RoleProfile = z.infer<typeof RoleProfileSchema>;

export const ToolPolicySchema = z
  .object({
    toolPolicyId: StableIdSchema,
    role: AptiloopAiRoleSchema,
    allowedTools: z.array(AptiloopToolNameSchema).max(20),
  })
  .strict();
export type ToolPolicy = z.infer<typeof ToolPolicySchema>;

export const ProviderHubFailureCodeSchema = z.enum([
  "ai_disabled",
  "connection_not_found",
  "connection_disabled",
  "authentication_required",
  "misconfigured",
  "provider_unavailable",
  "model_unavailable",
  "capability_unknown",
  "capability_missing",
  "tool_policy_unavailable",
  "disclosure_required",
  "disclosure_mismatch",
  "invalid_output",
  "budget_exceeded",
  "cancelled",
  "timeout",
  "provider_error",
]);
export type ProviderHubFailureCode = z.infer<
  typeof ProviderHubFailureCodeSchema
>;

export const ProviderHubFailureSchema = z
  .object({
    code: ProviderHubFailureCodeSchema,
    retryable: z.boolean(),
    messageKey: z.string().trim().min(1).max(200),
    diagnosticId: StableIdSchema,
    recoveryAction: z.string().trim().min(1).max(200).nullable(),
  })
  .strict();
export type ProviderHubFailure = z.infer<typeof ProviderHubFailureSchema>;

export const DisclosurePayloadCategorySchema = z.enum([
  "course-content",
  "learner-message",
  "learner-evidence",
  "workspace-diff",
  "review-bundle",
  "source-snapshot",
  "knowledge-capsule",
]);
export type DisclosurePayloadCategory = z.infer<
  typeof DisclosurePayloadCategorySchema
>;

export const AiDisclosureScopeSchema = z
  .object({
    role: AptiloopAiRoleSchema,
    connectionId: StableIdSchema,
    providerType: z.string().trim().min(1).max(100),
    modelId: z.string().trim().min(1).max(300),
    destination: z.string().trim().min(1).max(500),
    payloadCategories: z.array(DisclosurePayloadCategorySchema).min(1).max(20),
    entityIds: z
      .record(StableIdSchema, StableIdSchema)
      .refine(
        (value) => Object.keys(value).length <= 20,
        "Too many disclosure entities",
      ),
    exclusions: z.array(z.string().trim().min(1).max(300)).max(30),
    byteCount: z.number().int().nonnegative().max(2_500_000),
    payloadSha256: Sha256Schema,
  })
  .strict();
export type AiDisclosureScope = z.infer<typeof AiDisclosureScopeSchema>;

export const AiDisclosureStatusSchema = z.enum([
  "pending",
  "approved",
  "cancelled",
  "consumed",
  "expired",
]);
export type AiDisclosureStatus = z.infer<typeof AiDisclosureStatusSchema>;

export const AiDisclosureSchema = z
  .object({
    operationId: StableIdSchema,
    scope: AiDisclosureScopeSchema,
    status: AiDisclosureStatusSchema,
    createdAt: z.string().datetime(),
    approvedAt: z.string().datetime().nullable(),
    consumedAt: z.string().datetime().nullable(),
    expiresAt: z.string().datetime(),
  })
  .strict()
  .superRefine((disclosure, context) => {
    const createdAt = Date.parse(disclosure.createdAt);
    const expiresAt = Date.parse(disclosure.expiresAt);
    if (expiresAt <= createdAt) {
      context.addIssue({
        code: "custom",
        message: "Disclosure expiry must follow creation",
        path: ["expiresAt"],
      });
    }
    const requiresApproval =
      disclosure.status === "approved" || disclosure.status === "consumed";
    if (requiresApproval !== (disclosure.approvedAt !== null)) {
      context.addIssue({
        code: "custom",
        message: "Disclosure approval timestamp does not match status",
        path: ["approvedAt"],
      });
    }
    if (
      (disclosure.status === "consumed") !==
      (disclosure.consumedAt !== null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Disclosure consumption timestamp does not match status",
        path: ["consumedAt"],
      });
    }
    if (
      disclosure.approvedAt &&
      Date.parse(disclosure.approvedAt) < createdAt
    ) {
      context.addIssue({
        code: "custom",
        message: "Disclosure approval predates creation",
        path: ["approvedAt"],
      });
    }
    if (
      disclosure.approvedAt &&
      disclosure.consumedAt &&
      Date.parse(disclosure.consumedAt) < Date.parse(disclosure.approvedAt)
    ) {
      context.addIssue({
        code: "custom",
        message: "Disclosure consumption predates approval",
        path: ["consumedAt"],
      });
    }
  });
export type AiDisclosure = z.infer<typeof AiDisclosureSchema>;

export const ProviderTurnProvenanceSchema = z
  .object({
    operationId: StableIdSchema,
    connectionId: StableIdSchema,
    providerType: z.string().trim().min(1).max(100),
    adapterId: ProviderIdSchema,
    modelId: z.string().trim().min(1).max(300),
    role: AptiloopAiRoleSchema,
    toolPolicyId: StableIdSchema,
    capabilityObservedAt: z.string().datetime().nullable(),
    disclosureOperationId: StableIdSchema.nullable(),
    metadata: z.record(z.string(), JsonValueSchema).optional(),
  })
  .strict();
export type ProviderTurnProvenance = z.infer<
  typeof ProviderTurnProvenanceSchema
>;
