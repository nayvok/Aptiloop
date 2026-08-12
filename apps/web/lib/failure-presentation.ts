import type { MessageKey } from "@/lib/i18n";

type Translate = (key: MessageKey) => string;

export type FailureOperation =
  | "session.load"
  | "session.action"
  | "exercise.load"
  | "exercise.action"
  | "settings.ai.save"
  | "course.create"
  | "course.instructions.download"
  | "studio.load"
  | "studio.action";

const operationMessageKeys = {
  "session.load": "failure.operation.session.load",
  "session.action": "failure.operation.session.action",
  "exercise.load": "failure.operation.exercise.load",
  "exercise.action": "failure.operation.exercise.action",
  "settings.ai.save": "failure.operation.settingsAiSave",
  "course.create": "failure.operation.courseCreate",
  "course.instructions.download":
    "failure.operation.courseInstructionsDownload",
  "studio.load": "failure.operation.studioLoad",
  "studio.action": "failure.operation.studioAction",
} as const satisfies Record<FailureOperation, MessageKey>;

const providerFailureMessageKeys = new Set<MessageKey>([
  "ai.failure.disabled",
  "ai.failure.connectionNotFound",
  "ai.failure.connectionDisabled",
  "ai.failure.authenticationRequired",
  "ai.failure.misconfigured",
  "ai.failure.providerUnavailable",
  "ai.failure.modelUnavailable",
  "ai.failure.capabilityUnknown",
  "ai.failure.capabilityMissing",
  "ai.failure.toolPolicyUnavailable",
  "ai.failure.disclosureRequired",
  "ai.failure.disclosureMismatch",
  "ai.failure.invalidOutput",
  "ai.failure.budgetExceeded",
  "ai.failure.cancelled",
  "ai.failure.timeout",
  "ai.failure.providerError",
]);

const diagnosticIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u;

export type FailurePresentation = {
  message: string;
  diagnostic?: string;
};

export class SafeUiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SafeUiError";
  }
}

function apiFailure(error: unknown) {
  if (!error || typeof error !== "object") return null;
  const candidate = error as {
    status?: unknown;
    failure?: unknown;
  };
  if (typeof candidate.status !== "number") return null;
  const failure = candidate.failure as
    { messageKey?: unknown; diagnosticId?: unknown } | undefined;
  return {
    messageKey:
      typeof failure?.messageKey === "string" ? failure.messageKey : undefined,
    diagnosticId:
      typeof failure?.diagnosticId === "string" &&
      diagnosticIdPattern.test(failure.diagnosticId)
        ? failure.diagnosticId
        : undefined,
  };
}

export function presentFailure(
  error: unknown,
  operation: FailureOperation,
  t: Translate,
): FailurePresentation {
  const fallback = t(operationMessageKeys[operation]);
  if (error instanceof SafeUiError) return { message: error.message };
  const apiError = apiFailure(error);
  if (!apiError) {
    return { message: fallback };
  }

  const failureKey = apiError.messageKey as MessageKey | undefined;
  return {
    message:
      failureKey && providerFailureMessageKeys.has(failureKey)
        ? t(failureKey)
        : fallback,
    ...(apiError.diagnosticId ? { diagnostic: apiError.diagnosticId } : {}),
  };
}
