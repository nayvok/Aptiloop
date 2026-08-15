import type { MessageKey } from "@/lib/i18n";

type Translate = (
  key: MessageKey,
  values?: Record<string, string | number>,
) => string;

export type FailureOperation =
  | "home.load"
  | "home.courses.load"
  | "session.load"
  | "session.action"
  | "exercise.load"
  | "exercise.action"
  | "settings.ai.save"
  | "course.create"
  | "course.instructions.download"
  | "coursePack.library.load"
  | "coursePack.select"
  | "coursePack.uninstall"
  | "coursePack.export"
  | "studio.load"
  | "studio.action";

const operationMessageKeys = {
  "home.load": "home.unavailable",
  "home.courses.load": "home.coursesUnavailable",
  "session.load": "failure.operation.session.load",
  "session.action": "failure.operation.session.action",
  "exercise.load": "failure.operation.exercise.load",
  "exercise.action": "failure.operation.exercise.action",
  "settings.ai.save": "failure.operation.settingsAiSave",
  "course.create": "failure.operation.courseCreate",
  "course.instructions.download":
    "failure.operation.courseInstructionsDownload",
  "coursePack.library.load": "failure.operation.coursePackLibraryLoad",
  "coursePack.select": "failure.operation.coursePackSelect",
  "coursePack.uninstall": "failure.operation.coursePackUninstall",
  "coursePack.export": "failure.operation.coursePackExport",
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
const secretLikePattern =
  /(?:^|[._:-])(?:api[_-]?key|authorization|bearer|credential|password|secret|token)(?:[._:-]|$)|^(?:gh[opusr]_|sk-|xox[baprs]-)/iu;
const safeJsonPointerPattern = /^(?:\/[A-Za-z0-9._~/-]+){0,40}$/u;

const coursePackDiagnosticGroups = {
  unsafe: new Set([
    "PACK_ACTIVE_CONTENT",
    "PACK_AUTHORITY_FIELD",
    "PACK_LOCAL_PATH_VALUE",
    "PACK_PROTECTED_MATERIAL_LEAK",
    "PACK_SECRET_SHAPED_VALUE",
    "PACK_URL_UNSAFE",
  ]),
  structure: new Set([
    "PACK_JSON_INVALID",
    "PACK_SHAPE_INVALID",
    "PACK_ID_DUPLICATE",
    "PACK_ORDER_DUPLICATE",
    "PACK_ORDER_NOT_CANONICAL",
    "PACK_COMPLETION_CRITERION_UNKNOWN",
  ]),
  reference: new Set([
    "PACK_CAPSULE_HASH_MISMATCH",
    "PACK_CAPSULE_NODE_MISSING",
    "PACK_CAPSULE_SOURCE_MISSING",
    "PACK_CONTENT_HASH_MISMATCH",
    "PACK_KNOWLEDGE_REFERENCE_MISSING",
    "PACK_QUESTION_REFERENCE_MISSING",
    "PACK_SOURCE_HASH_MISMATCH",
    "PACK_SOURCE_REFERENCE_MISSING",
  ]),
  graph: new Set([
    "PACK_KNOWLEDGE_GRAPH_CYCLE",
    "PACK_KNOWLEDGE_GRAPH_INVALID",
  ]),
  locale: new Set([
    "PACK_LOCALE_DUPLICATE",
    "PACK_LOCALE_INVALID",
    "PACK_LOCALE_NOT_CANONICAL",
    "PACK_LOCALIZATION_DUPLICATE",
    "PACK_LOCALIZATION_FIELD_FORBIDDEN",
    "PACK_LOCALIZATION_INCOMPLETE",
    "PACK_LOCALIZATION_MISSING",
    "PACK_LOCALIZATION_PARTIAL",
    "PACK_LOCALIZATION_UNDECLARED",
    "PACK_PRIMARY_LOCALE_MISSING",
    "PACK_PRIMARY_LOCALE_OVERLAY",
  ]),
  provenance: new Set([
    "PACK_CONTENT_TERMS_MISSING",
    "PACK_PROVENANCE_UNRESOLVED",
    "PACK_SOURCE_ATTRIBUTION_MISSING",
    "PACK_SOURCE_TERMS_MISSING",
  ]),
  requirement: new Set([
    "PACK_REQUIREMENT_MISMATCH",
    "PACK_REQUIREMENT_UNAVAILABLE",
  ]),
} as const;

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

export function safeDiagnosticId(value: unknown): string | undefined {
  return typeof value === "string" &&
    diagnosticIdPattern.test(value) &&
    !secretLikePattern.test(value)
    ? value
    : undefined;
}

export type CoursePackDiagnosticPresentation = {
  code?: string;
  path?: string;
  message: string;
};

export function presentCoursePackDiagnostic(
  diagnostic: { code: string; path: string },
  t: Translate,
): CoursePackDiagnosticPresentation {
  const group = Object.entries(coursePackDiagnosticGroups).find(([, codes]) =>
    codes.has(diagnostic.code),
  )?.[0] as keyof typeof coursePackDiagnosticGroups | undefined;
  if (!group) {
    return { message: t("courses.validation.diagnostic.generic") };
  }
  return {
    code: diagnostic.code,
    ...(safeJsonPointerPattern.test(diagnostic.path)
      ? { path: diagnostic.path }
      : {}),
    message: t(`courses.validation.diagnostic.${group}` as MessageKey),
  };
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
    diagnosticId: safeDiagnosticId(failure?.diagnosticId),
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
