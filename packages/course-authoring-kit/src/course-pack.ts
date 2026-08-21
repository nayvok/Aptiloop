import { createHash } from "node:crypto";

import { validateActivityGraph } from "@aptiloop/learning-core";
import {
  ActivityCompletionCriterionSchema,
  ActivityPayloadSchema,
  ActivityProtectedMaterialSchema,
  CourseLocaleSchema,
  KnowledgeCapsuleCitationSchema,
  KnowledgeCapsuleClaimSchema,
  KnowledgeCapsuleConflictSchema,
  SourceLocatorSchema,
  StableCourseIdSchema,
  UnitTypeSchema,
} from "@aptiloop/shared";
import { z } from "zod";

import {
  COURSE_PACK_JSON_LIMITS_V1,
  parseStrictJson,
  StrictJsonError,
  type StrictJsonParseOptions,
} from "./strict-json.js";

export const COURSE_PACK_FORMAT = "aptiloop.course-pack" as const;
export const COURSE_PACK_AUTHORING_DRAFT_FORMAT =
  "aptiloop.course-pack-authoring-draft" as const;
export const COURSE_PACK_FORMAT_VERSION = 1 as const;
export const COURSE_PACK_FORMAT_MINOR_VERSION = 1 as const;
export const COURSE_PACK_VALIDATOR_VERSION = "m3-v3" as const;

const MAX_LIST_ITEMS = 500;
const MAX_SHORT_TEXT = 500;
const MAX_TEXT = 50_000;
const MAX_URL = 4_000;
const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/u;

const shortText = z.string().trim().min(1).max(MAX_SHORT_TEXT);
const text = z.string().trim().min(1).max(MAX_TEXT);
const nullableText = text.nullable();
const instant = z.string().datetime({ offset: true });
const sha256 = z.string().regex(HASH_PATTERN);
const httpsUrl = z
  .string()
  .trim()
  .min(1)
  .max(MAX_URL)
  .url()
  .refine((value) => new URL(value).protocol === "https:", "HTTPS is required");

function sortedUniqueIds() {
  return z
    .array(StableCourseIdSchema)
    .max(MAX_LIST_ITEMS)
    .superRefine((values, context) => {
      values.forEach((value, index) => {
        if (index > 0 && value <= values[index - 1]!) {
          context.addIssue({
            code: "custom",
            path: [index],
            message: "Identifiers must be unique and sorted",
          });
        }
      });
    });
}

export const CoursePackProvenanceSchema = z
  .object({
    contentStatus: z.enum(["development-fixture", "personal"]),
    author: shortText,
    origin: z.enum(["original", "adapted", "generated", "migration"]),
    ownership: z.enum(["owned", "licensed", "permission", "unresolved"]),
    licenseSpdx: shortText.nullable(),
    termsUrl: httpsUrl.nullable(),
    attribution: nullableText,
    createdAt: instant,
    notes: nullableText,
  })
  .strict();

export const CoursePackCourseSchema = z
  .object({
    courseKey: StableCourseIdSchema,
    title: shortText,
    description: text,
    primaryLocale: CourseLocaleSchema,
    availableLocales: z.array(CourseLocaleSchema).min(1).max(50),
    subjectTags: sortedUniqueIds(),
    provenance: CoursePackProvenanceSchema,
  })
  .strict();

export const CoursePackRevisionSchema = z
  .object({
    revisionKey: StableCourseIdSchema,
    revisionNumber: z.number().int().positive().max(1_000_000),
    parentRevisionKey: StableCourseIdSchema.nullable(),
    branchKind: z.enum(["upstream", "personal"]),
    basedOnContentHash: sha256.nullable(),
    contentHash: sha256,
  })
  .strict()
  .superRefine((revision, context) => {
    if (revision.revisionNumber === 1 && revision.parentRevisionKey !== null) {
      context.addIssue({
        code: "custom",
        path: ["parentRevisionKey"],
        message: "A root revision cannot declare a parent",
      });
    }
    if (revision.revisionNumber > 1 && revision.parentRevisionKey === null) {
      context.addIssue({
        code: "custom",
        path: ["parentRevisionKey"],
        message: "A non-root revision requires a parent",
      });
    }
    if (
      revision.branchKind === "upstream" &&
      revision.basedOnContentHash !== null
    ) {
      context.addIssue({
        code: "custom",
        path: ["basedOnContentHash"],
        message: "An upstream revision cannot declare a personal base hash",
      });
    }
    if (
      revision.branchKind === "personal" &&
      (revision.parentRevisionKey === null ||
        revision.basedOnContentHash === null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["basedOnContentHash"],
        message:
          "A personal revision requires a parent and immutable base hash",
      });
    }
  });

export const CoursePackRequirementsSchema = z
  .object({
    activityTypes: sortedUniqueIds(),
    capabilities: sortedUniqueIds(),
    environmentIds: sortedUniqueIds(),
    checkIds: sortedUniqueIds(),
  })
  .strict();

export const CoursePackKnowledgeNodeSchema = z
  .object({
    knowledgeNodeId: StableCourseIdSchema,
    title: shortText,
    description: text,
    kind: z.enum(["concept", "procedure", "skill", "misconception-family"]),
    prerequisiteKnowledgeNodeIds: sortedUniqueIds(),
    relatedKnowledgeNodeIds: sortedUniqueIds(),
    lifecycle: z.enum(["active", "superseded"]),
  })
  .strict();

const structuredContent = z.union([
  text,
  z.record(z.string().min(1).max(200), z.unknown()),
  z.array(z.unknown()).max(MAX_LIST_ITEMS),
]);

export const CoursePackSourceSnapshotSchema = z
  .object({
    snapshotId: StableCourseIdSchema,
    sourceAuthorityId: StableCourseIdSchema,
    canonicalUrl: httpsUrl,
    retrievedAt: instant,
    retrievalMethod: z.enum(["official-http", "manual-import"]),
    mediaType: z
      .string()
      .min(3)
      .max(255)
      .regex(/^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/u),
    locale: CourseLocaleSchema.nullable(),
    contentHash: sha256,
    content: structuredContent.nullable(),
    title: shortText,
    authorPublisher: shortText.nullable(),
    publishedOrUpdatedAt: instant.nullable(),
    attribution: nullableText,
    licenseSpdx: shortText.nullable(),
    termsUrl: httpsUrl.nullable(),
    locatorMap: z.array(SourceLocatorSchema).max(MAX_LIST_ITEMS),
    retentionMode: z.enum(["full", "extract", "metadata-only"]),
    supersedesSnapshotId: StableCourseIdSchema.nullable(),
    privacyClass: z.enum(["public", "private"]),
  })
  .strict()
  .superRefine((snapshot, context) => {
    if (snapshot.supersedesSnapshotId === snapshot.snapshotId) {
      context.addIssue({
        code: "custom",
        path: ["supersedesSnapshotId"],
        message: "A Source Snapshot cannot supersede itself",
      });
    }
    if (
      snapshot.retentionMode === "metadata-only" &&
      snapshot.content !== null
    ) {
      context.addIssue({
        code: "custom",
        path: ["content"],
        message: "Metadata-only snapshots cannot retain content",
      });
    }
    if (
      snapshot.retentionMode !== "metadata-only" &&
      snapshot.content === null
    ) {
      context.addIssue({
        code: "custom",
        path: ["content"],
        message: "Full and extract snapshots require content",
      });
    }
  });

export const CoursePackCapsuleSchema = z
  .object({
    capsuleId: StableCourseIdSchema,
    schemaVersion: z.literal(1),
    knowledgeNodeIds: sortedUniqueIds(),
    primaryLocale: CourseLocaleSchema,
    claims: z.array(KnowledgeCapsuleClaimSchema).max(MAX_LIST_ITEMS),
    citations: z.array(KnowledgeCapsuleCitationSchema).max(MAX_LIST_ITEMS),
    conflicts: z.array(KnowledgeCapsuleConflictSchema).max(MAX_LIST_ITEMS),
    createdBy: z.enum(["manual", "typed-ai-proposal", "migration"]),
    validationHash: sha256,
    createdAt: instant,
  })
  .strict();

export const CoursePackKnowledgeSchema = z
  .object({
    nodes: z.array(CoursePackKnowledgeNodeSchema).max(MAX_LIST_ITEMS),
    sourceSnapshots: z
      .array(CoursePackSourceSnapshotSchema)
      .max(MAX_LIST_ITEMS),
    capsules: z.array(CoursePackCapsuleSchema).max(MAX_LIST_ITEMS),
  })
  .strict();

export const CoursePackLocalizationSchema = z
  .object({
    locale: CourseLocaleSchema,
    releaseComplete: z.boolean(),
    fields: z.record(
      z.string().min(1).max(500),
      z.union([text, z.array(text).max(MAX_LIST_ITEMS)]),
    ),
  })
  .strict();

export const CoursePackActivitySchema = z
  .object({
    activityId: StableCourseIdSchema,
    schemaVersion: z.literal(1),
    order: z.number().int().nonnegative().max(1_000_000),
    type: UnitTypeSchema,
    title: shortText,
    description: text,
    estimatedMinutes: z.number().int().positive().max(100_000).nullable(),
    required: z.boolean(),
    prerequisiteActivityIds: sortedUniqueIds(),
    capabilityIds: sortedUniqueIds(),
    knowledgeNodeIds: sortedUniqueIds(),
    sourceSnapshotIds: sortedUniqueIds(),
    completionCriteria: z
      .array(ActivityCompletionCriterionSchema)
      .min(1)
      .max(100),
    payload: ActivityPayloadSchema,
    protectedMaterial: ActivityProtectedMaterialSchema,
  })
  .strict()
  .superRefine((activity, context) => {
    if (activity.type !== activity.payload.type) {
      context.addIssue({
        code: "custom",
        path: ["payload", "type"],
        message: "Activity type and payload type must match",
      });
    }
  });

export const CoursePackLessonSchema = z
  .object({
    lessonId: StableCourseIdSchema,
    order: z.number().int().nonnegative().max(1_000_000),
    title: shortText,
    description: text,
    goal: text,
    estimatedMinutes: z.number().int().positive().max(100_000),
    knowledgeNodeIds: sortedUniqueIds(),
    prerequisiteLessonIds: sortedUniqueIds().optional(),
    entryActivityIds: sortedUniqueIds().min(1),
    activities: z.array(CoursePackActivitySchema).min(1).max(MAX_LIST_ITEMS),
  })
  .strict();

export const CoursePackAuthoringDraftLessonV1Schema =
  CoursePackLessonSchema.extend({
    prerequisiteLessonIds: sortedUniqueIds(),
  });

const coursePackContentFields = {
  course: CoursePackCourseSchema,
  knowledge: CoursePackKnowledgeSchema,
  localizations: z.array(CoursePackLocalizationSchema).max(50),
  lessons: z.array(CoursePackLessonSchema).min(1).max(MAX_LIST_ITEMS),
} as const;

export const CoursePackV1Schema = z
  .object({
    format: z.literal(COURSE_PACK_FORMAT),
    formatVersion: z.literal(COURSE_PACK_FORMAT_VERSION),
    formatMinorVersion: z.literal(COURSE_PACK_FORMAT_MINOR_VERSION).optional(),
    revision: CoursePackRevisionSchema,
    requirements: CoursePackRequirementsSchema,
    ...coursePackContentFields,
  })
  .strict()
  .superRefine(validateLessonPrerequisiteVersionShape);

export type CoursePackV1 = z.infer<typeof CoursePackV1Schema>;

export const CoursePackAuthoringDraftRevisionV1Schema = z
  .object({
    revisionKey: StableCourseIdSchema,
    revisionNumber: z.number().int().positive().max(1_000_000),
    parentRevisionKey: StableCourseIdSchema.nullable(),
    branchKind: z.enum(["upstream", "personal"]),
    basedOnContentHash: sha256.nullable(),
  })
  .strict()
  .superRefine((revision, context) => {
    if (revision.revisionNumber === 1 && revision.parentRevisionKey !== null) {
      context.addIssue({
        code: "custom",
        path: ["parentRevisionKey"],
        message: "A root revision cannot declare a parent",
      });
    }
    if (revision.revisionNumber > 1 && revision.parentRevisionKey === null) {
      context.addIssue({
        code: "custom",
        path: ["parentRevisionKey"],
        message: "A non-root revision requires a parent",
      });
    }
    if (
      revision.branchKind === "upstream" &&
      revision.basedOnContentHash !== null
    ) {
      context.addIssue({
        code: "custom",
        path: ["basedOnContentHash"],
        message: "An upstream revision cannot declare a personal base hash",
      });
    }
    if (
      revision.branchKind === "personal" &&
      (revision.parentRevisionKey === null ||
        revision.basedOnContentHash === null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["basedOnContentHash"],
        message:
          "A personal revision requires a parent and immutable base hash",
      });
    }
  });

export const CoursePackAuthoringDraftV1Schema = z
  .object({
    format: z.literal(COURSE_PACK_AUTHORING_DRAFT_FORMAT),
    formatVersion: z.literal(COURSE_PACK_FORMAT_VERSION),
    formatMinorVersion: z.literal(COURSE_PACK_FORMAT_MINOR_VERSION),
    revision: CoursePackAuthoringDraftRevisionV1Schema,
    course: CoursePackCourseSchema,
    knowledge: CoursePackKnowledgeSchema,
    localizations: z.array(CoursePackLocalizationSchema).max(50),
    lessons: z
      .array(CoursePackAuthoringDraftLessonV1Schema)
      .min(1)
      .max(MAX_LIST_ITEMS),
  })
  .strict();
export type CoursePackAuthoringDraftV1 = z.infer<
  typeof CoursePackAuthoringDraftV1Schema
>;

function validateLessonPrerequisiteVersionShape(
  pack: {
    readonly formatMinorVersion?: number | undefined;
    readonly lessons: readonly {
      readonly prerequisiteLessonIds?: readonly string[] | undefined;
    }[];
  },
  context: z.RefinementCtx,
): void {
  pack.lessons.forEach((lesson, index) => {
    if (
      pack.formatMinorVersion === COURSE_PACK_FORMAT_MINOR_VERSION &&
      lesson.prerequisiteLessonIds === undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["lessons", index, "prerequisiteLessonIds"],
        message: "Current Course Packs require explicit lesson prerequisites",
      });
    }
    if (
      pack.formatMinorVersion === undefined &&
      lesson.prerequisiteLessonIds !== undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["lessons", index, "prerequisiteLessonIds"],
        message:
          "Lesson prerequisites require formatMinorVersion 1; legacy V1 omits both fields",
      });
    }
  });
}

export type CoursePackDiagnosticSeverity = "error" | "warning";
export type CoursePackDiagnosticContext =
  "json-value" | "learner-markdown" | "educational-code" | "field-name";

export interface CoursePackDiagnostic {
  readonly code: string;
  readonly severity: CoursePackDiagnosticSeverity;
  readonly path: string;
  readonly entityId: string | null;
  readonly message: string;
  readonly ruleId: string | null;
  readonly context: CoursePackDiagnosticContext | null;
}

export interface CoursePackValidationReport {
  readonly validatorVersion: typeof COURSE_PACK_VALIDATOR_VERSION;
  readonly valid: boolean;
  readonly errors: number;
  readonly warnings: number;
  readonly diagnostics: readonly CoursePackDiagnostic[];
  readonly limits: typeof COURSE_PACK_JSON_LIMITS_V1;
}

export interface CoursePackPreview {
  readonly courseKey: string;
  readonly courseTitle: string;
  readonly revisionKey: string;
  readonly revisionNumber: number;
  readonly contentHash: string;
  readonly primaryLocale: string;
  readonly availableLocales: readonly string[];
  readonly lessonCount: number;
  readonly activityCount: number;
  readonly sourcePrivacyClasses: Readonly<Record<"public" | "private", number>>;
  readonly requirements: CoursePackV1["requirements"];
  readonly provenance: CoursePackV1["course"]["provenance"];
}

export type CoursePackValidationResult =
  | {
      readonly valid: true;
      readonly pack: CoursePackV1;
      readonly canonicalJson: string;
      readonly contentHash: string;
      readonly report: CoursePackValidationReport;
      readonly preview: CoursePackPreview;
    }
  | {
      readonly valid: false;
      readonly pack: CoursePackV1 | null;
      readonly canonicalJson: string | null;
      readonly contentHash: string | null;
      readonly report: CoursePackValidationReport;
      readonly preview: CoursePackPreview | null;
    };

export interface CoursePackRegistry {
  readonly activityTypes: readonly string[];
  readonly capabilityIds: readonly string[];
  readonly environmentIds: readonly string[];
  readonly checkIds: readonly string[];
}

export const CORE_M3_COURSE_PACK_REGISTRY: CoursePackRegistry = Object.freeze({
  activityTypes: UnitTypeSchema.options,
  capabilityIds: [],
  environmentIds: [],
  checkIds: [],
});

export interface CoursePackValidationOptions extends StrictJsonParseOptions {
  readonly registry?: CoursePackRegistry;
}

export type CoursePackSourceKind =
  "course-pack" | "authoring-draft" | "unknown";

export type CoursePackPreparationResult =
  | (Extract<CoursePackValidationResult, { readonly valid: true }> & {
      readonly sourceKind: CoursePackSourceKind;
      readonly finalized: boolean;
      readonly preparedBytes: Uint8Array;
    })
  | (Extract<CoursePackValidationResult, { readonly valid: false }> & {
      readonly sourceKind: CoursePackSourceKind;
      readonly finalized: boolean;
      readonly preparedBytes: null;
    });

/**
 * Accepts either a finalized Course Pack or a hashless Authoring Draft.
 * Draft finalization is pure: the caller-owned value and source bytes are never
 * mutated, and the returned final Pack is validated through the same boundary.
 */
export function prepareCoursePackBytes(
  bytes: Uint8Array,
  options: CoursePackValidationOptions = {},
): CoursePackPreparationResult {
  let input: unknown;
  try {
    input = parseStrictJson(bytes, options);
  } catch (error) {
    return preparationResult(invalidJsonResult(error), "unknown", false);
  }

  const sourceKind: CoursePackSourceKind = isRecord(input)
    ? input.format === COURSE_PACK_AUTHORING_DRAFT_FORMAT
      ? "authoring-draft"
      : input.format === COURSE_PACK_FORMAT
        ? "course-pack"
        : "unknown"
    : "unknown";
  const registry = options.registry ?? CORE_M3_COURSE_PACK_REGISTRY;
  if (sourceKind !== "authoring-draft") {
    return preparationResult(
      validateCoursePackInput(input, registry),
      sourceKind,
      false,
    );
  }

  const diagnostics: CoursePackDiagnostic[] = [];
  const parsed = CoursePackAuthoringDraftV1Schema.safeParse(input);
  if (!parsed.success) {
    scanUntrustedValues(input, [], diagnostics);
    diagnostics.push(
      ...parsed.error.issues.map((issue) =>
        createDiagnostic(
          "PACK_DRAFT_SHAPE_INVALID",
          "error",
          jsonPointer(issue.path),
          null,
          issue.message,
        ),
      ),
    );
    return preparationResult(invalidResult(diagnostics), sourceKind, false);
  }

  const finalizedPack = finalizeCoursePackAuthoringDraft(parsed.data);
  return preparationResult(
    validateCoursePackInput(finalizedPack, registry),
    sourceKind,
    true,
  );
}

function preparationResult(
  result: CoursePackValidationResult,
  sourceKind: CoursePackSourceKind,
  finalized: boolean,
): CoursePackPreparationResult {
  return result.valid
    ? {
        ...result,
        sourceKind,
        finalized,
        preparedBytes: new TextEncoder().encode(result.canonicalJson),
      }
    : { ...result, sourceKind, finalized, preparedBytes: null };
}

export function validateCoursePackBytes(
  bytes: Uint8Array,
  options: CoursePackValidationOptions = {},
): CoursePackValidationResult {
  let input: unknown;
  try {
    input = parseStrictJson(bytes, options);
  } catch (error) {
    return invalidJsonResult(error);
  }
  return validateCoursePackInput(
    input,
    options.registry ?? CORE_M3_COURSE_PACK_REGISTRY,
  );
}

function invalidJsonResult(error: unknown): CoursePackValidationResult {
  const diagnostic =
    error instanceof StrictJsonError
      ? createDiagnostic(
          `PACK_JSON_${error.code}`,
          "error",
          "",
          null,
          `${error.message} (byte/character offset ${error.offset})`,
        )
      : createDiagnostic(
          "PACK_JSON_INVALID",
          "error",
          "",
          null,
          "Course Pack JSON could not be parsed",
        );
  return invalidResult([diagnostic]);
}

function validateCoursePackInput(
  input: unknown,
  registry: CoursePackRegistry,
): CoursePackValidationResult {
  const diagnostics: CoursePackDiagnostic[] = [];
  scanUntrustedValues(input, [], diagnostics);
  const parsed = CoursePackV1Schema.safeParse(input);
  if (!parsed.success) {
    diagnostics.push(
      ...parsed.error.issues.map((issue) =>
        createDiagnostic(
          "PACK_SHAPE_INVALID",
          "error",
          jsonPointer(issue.path),
          null,
          issue.message,
        ),
      ),
    );
    return invalidResult(diagnostics);
  }

  const pack = parsed.data;
  validatePackSemantics(pack, registry, diagnostics);
  const canonical = canonicalCoursePackJson(pack);
  const contentHash = calculateCoursePackContentHash(pack);
  if (pack.revision.contentHash !== contentHash) {
    diagnostics.push(
      createDiagnostic(
        "PACK_CONTENT_HASH_MISMATCH",
        "error",
        "/revision/contentHash",
        pack.revision.revisionKey,
        `Declared content hash does not match ${contentHash}`,
      ),
    );
  }
  sortDiagnostics(diagnostics);
  const report = createReport(diagnostics);
  const preview = createPreview(pack, contentHash);
  return report.valid
    ? {
        valid: true,
        pack,
        canonicalJson: canonical,
        contentHash,
        report,
        preview,
      }
    : {
        valid: false,
        pack,
        canonicalJson: canonical,
        contentHash,
        report,
        preview,
      };
}

export function canonicalJson(value: unknown): string {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new TypeError("Canonical JSON numbers must be finite");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort(compareText)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  throw new TypeError("Canonical JSON accepts only JSON values");
}

export function canonicalCoursePackJson(pack: CoursePackV1): string {
  return canonicalJson(pack);
}

export function calculateCoursePackContentHash(pack: CoursePackV1): string {
  const revision = Object.fromEntries(
    Object.entries(pack.revision).filter(([key]) => key !== "contentHash"),
  );
  const hashPayload = { ...pack, revision };
  return `sha256:${createHash("sha256")
    .update(canonicalJson(hashPayload), "utf8")
    .digest("hex")}`;
}

export function finalizeCoursePack(input: CoursePackV1): CoursePackV1 {
  const contentHash = calculateCoursePackContentHash(input);
  return CoursePackV1Schema.parse({
    ...input,
    revision: { ...input.revision, contentHash },
  });
}

export function deriveCoursePackRequirements(
  lessons: readonly CoursePackV1["lessons"][number][],
): CoursePackV1["requirements"] {
  return CoursePackRequirementsSchema.parse({
    activityTypes: uniqueSorted(
      lessons.flatMap((lesson) =>
        lesson.activities.map((activity) => activity.type),
      ),
    ),
    capabilities: uniqueSorted(
      lessons.flatMap((lesson) =>
        lesson.activities.flatMap((activity) => activity.capabilityIds),
      ),
    ),
    environmentIds: [],
    checkIds: uniqueSorted(
      lessons.flatMap((lesson) =>
        lesson.activities.flatMap((activity) =>
          activity.payload.type === "exercise"
            ? [activity.payload.testCommandId]
            : [],
        ),
      ),
    ),
  });
}

export function finalizeCoursePackAuthoringDraft(
  input: CoursePackAuthoringDraftV1,
): CoursePackV1 {
  const draft = CoursePackAuthoringDraftV1Schema.parse(input);
  return finalizeCoursePack(
    CoursePackV1Schema.parse({
      format: COURSE_PACK_FORMAT,
      formatVersion: draft.formatVersion,
      formatMinorVersion: draft.formatMinorVersion,
      course: draft.course,
      revision: {
        ...draft.revision,
        contentHash: `sha256:${"0".repeat(64)}`,
      },
      requirements: deriveCoursePackRequirements(draft.lessons),
      knowledge: draft.knowledge,
      localizations: draft.localizations,
      lessons: draft.lessons,
    }),
  );
}

function validatePackSemantics(
  pack: CoursePackV1,
  registry: CoursePackRegistry,
  diagnostics: CoursePackDiagnostic[],
): void {
  validateLocaleManifest(pack, diagnostics);
  validateIdentityAndOrdering(pack, diagnostics);
  validateGraphAndReferences(pack, registry, diagnostics);
  validateActivitySemantics(pack, diagnostics);
  validateRequirements(pack, registry, diagnostics);
  validateProvenance(pack, diagnostics);
  validateKnowledge(pack, diagnostics);
  validateProtectedSeparation(pack, diagnostics);
}

function validateLocaleManifest(
  pack: CoursePackV1,
  diagnostics: CoursePackDiagnostic[],
): void {
  const canonicalLocales: string[] = [];
  pack.course.availableLocales.forEach((locale, index) => {
    try {
      const canonical = Intl.getCanonicalLocales(locale)[0];
      if (!canonical) throw new RangeError("Missing canonical locale");
      if (canonical !== locale) {
        diagnostics.push(
          createDiagnostic(
            "PACK_LOCALE_NOT_CANONICAL",
            "error",
            `/course/availableLocales/${index}`,
            pack.course.courseKey,
            `Locale must use canonical spelling: ${canonical}`,
          ),
        );
      }
      if (canonicalLocales.includes(canonical)) {
        diagnostics.push(
          createDiagnostic(
            "PACK_LOCALE_DUPLICATE",
            "error",
            `/course/availableLocales/${index}`,
            pack.course.courseKey,
            `Duplicate locale: ${canonical}`,
          ),
        );
      }
      canonicalLocales.push(canonical);
    } catch {
      diagnostics.push(
        createDiagnostic(
          "PACK_LOCALE_INVALID",
          "error",
          `/course/availableLocales/${index}`,
          pack.course.courseKey,
          `Invalid locale: ${locale}`,
        ),
      );
    }
  });
  if (!pack.course.availableLocales.includes(pack.course.primaryLocale)) {
    diagnostics.push(
      createDiagnostic(
        "PACK_PRIMARY_LOCALE_MISSING",
        "error",
        "/course/availableLocales",
        pack.course.courseKey,
        "availableLocales must include primaryLocale",
      ),
    );
  }

  const localizable = localizableFields(pack);
  const seen = new Set<string>();
  pack.localizations.forEach((localization, index) => {
    if (localization.locale === pack.course.primaryLocale) {
      diagnostics.push(
        createDiagnostic(
          "PACK_PRIMARY_LOCALE_OVERLAY",
          "error",
          `/localizations/${index}/locale`,
          localization.locale,
          "Primary locale content is authored directly and cannot be an overlay",
        ),
      );
    }
    if (!pack.course.availableLocales.includes(localization.locale)) {
      diagnostics.push(
        createDiagnostic(
          "PACK_LOCALIZATION_UNDECLARED",
          "error",
          `/localizations/${index}/locale`,
          localization.locale,
          "Localization locale is not declared in availableLocales",
        ),
      );
    }
    if (seen.has(localization.locale)) {
      diagnostics.push(
        createDiagnostic(
          "PACK_LOCALIZATION_DUPLICATE",
          "error",
          `/localizations/${index}/locale`,
          localization.locale,
          "A locale can have only one overlay",
        ),
      );
    }
    seen.add(localization.locale);
    for (const field of Object.keys(localization.fields)) {
      if (!localizable.has(field)) {
        diagnostics.push(
          createDiagnostic(
            "PACK_LOCALIZATION_FIELD_FORBIDDEN",
            "error",
            `/localizations/${index}/fields/${escapePointer(field)}`,
            localization.locale,
            "Localization path is unknown, structural, or protected",
          ),
        );
      }
    }
    const missing = [...localizable].filter(
      (field) => localization.fields[field] === undefined,
    );
    if (missing.length > 0) {
      diagnostics.push(
        createDiagnostic(
          localization.releaseComplete
            ? "PACK_LOCALIZATION_INCOMPLETE"
            : "PACK_LOCALIZATION_PARTIAL",
          localization.releaseComplete ? "error" : "warning",
          `/localizations/${index}/fields`,
          localization.locale,
          `${missing.length} localizable field(s) are missing`,
        ),
      );
    }
  });
  for (const locale of pack.course.availableLocales) {
    if (locale !== pack.course.primaryLocale && !seen.has(locale)) {
      diagnostics.push(
        createDiagnostic(
          "PACK_LOCALIZATION_MISSING",
          "warning",
          "/localizations",
          locale,
          "Declared optional locale has no overlay",
        ),
      );
    }
  }
}

function validateIdentityAndOrdering(
  pack: CoursePackV1,
  diagnostics: CoursePackDiagnostic[],
): void {
  const lessonIds = new Set<string>();
  const activityIds = new Set<string>();
  const lessonOrders = new Set<number>();
  pack.lessons.forEach((lesson, lessonIndex) => {
    addDuplicateIdentity(
      lesson.lessonId,
      lessonIds,
      diagnostics,
      `/lessons/${lessonIndex}/lessonId`,
    );
    addDuplicateOrder(
      lesson.order,
      lessonOrders,
      diagnostics,
      `/lessons/${lessonIndex}/order`,
      lesson.lessonId,
    );
    if (
      lessonIndex > 0 &&
      lesson.order <= pack.lessons[lessonIndex - 1]!.order
    ) {
      diagnostics.push(
        createDiagnostic(
          "PACK_ORDER_NOT_CANONICAL",
          "error",
          `/lessons/${lessonIndex}/order`,
          lesson.lessonId,
          "Lessons must be stored in strictly increasing order",
        ),
      );
    }
    const activityOrders = new Set<number>();
    lesson.activities.forEach((activity, activityIndex) => {
      addDuplicateIdentity(
        activity.activityId,
        activityIds,
        diagnostics,
        `/lessons/${lessonIndex}/activities/${activityIndex}/activityId`,
      );
      addDuplicateOrder(
        activity.order,
        activityOrders,
        diagnostics,
        `/lessons/${lessonIndex}/activities/${activityIndex}/order`,
        activity.activityId,
      );
      if (
        activityIndex > 0 &&
        activity.order <= lesson.activities[activityIndex - 1]!.order
      ) {
        diagnostics.push(
          createDiagnostic(
            "PACK_ORDER_NOT_CANONICAL",
            "error",
            `/lessons/${lessonIndex}/activities/${activityIndex}/order`,
            activity.activityId,
            "Activities must be stored in strictly increasing order",
          ),
        );
      }
    });
  });
  const identities = [
    ...pack.knowledge.nodes.map((node, index) => ({
      id: node.knowledgeNodeId,
      path: `/knowledge/nodes/${index}/knowledgeNodeId`,
    })),
    ...pack.knowledge.sourceSnapshots.map((snapshot, index) => ({
      id: snapshot.snapshotId,
      path: `/knowledge/sourceSnapshots/${index}/snapshotId`,
    })),
    ...pack.knowledge.capsules.map((capsule, index) => ({
      id: capsule.capsuleId,
      path: `/knowledge/capsules/${index}/capsuleId`,
    })),
  ];
  const knowledgeIdentities = new Set<string>();
  identities.forEach((identity) =>
    addDuplicateIdentity(
      identity.id,
      knowledgeIdentities,
      diagnostics,
      identity.path,
    ),
  );
}

function validateGraphAndReferences(
  pack: CoursePackV1,
  registry: CoursePackRegistry,
  diagnostics: CoursePackDiagnostic[],
): void {
  validateLessonPrerequisiteGraph(pack, diagnostics);
  const knowledgeNodes = new Set(
    pack.knowledge.nodes.map((node) => node.knowledgeNodeId),
  );
  const snapshots = new Set(
    pack.knowledge.sourceSnapshots.map((snapshot) => snapshot.snapshotId),
  );
  pack.lessons.forEach((lesson, lessonIndex) => {
    const graph = validateActivityGraph(
      {
        courseId: pack.course.courseKey,
        revisionId: pack.revision.revisionKey,
        lessonId: lesson.lessonId,
        entryActivityIds: lesson.entryActivityIds,
        activities: lesson.activities.map((activity) => ({
          id: activity.activityId,
          stableId: activity.activityId,
          courseId: pack.course.courseKey,
          revisionId: pack.revision.revisionKey,
          lessonId: lesson.lessonId,
          type: activity.type,
          required: activity.required,
          prerequisiteActivityIds: activity.prerequisiteActivityIds,
        })),
      },
      registry.activityTypes,
    );
    if (!graph.valid) {
      diagnostics.push(
        ...graph.issues.map((issue) =>
          createDiagnostic(
            `PACK_GRAPH_${issue.code.toUpperCase().replaceAll("-", "_")}`,
            "error",
            `/lessons/${lessonIndex}${jsonPointer(issue.path)}`,
            issue.activityId,
            issue.message,
          ),
        ),
      );
    }
    lesson.knowledgeNodeIds.forEach((id, index) => {
      if (!knowledgeNodes.has(id)) {
        diagnostics.push(
          createDiagnostic(
            "PACK_KNOWLEDGE_REFERENCE_MISSING",
            "error",
            `/lessons/${lessonIndex}/knowledgeNodeIds/${index}`,
            lesson.lessonId,
            `Unknown KnowledgeNode: ${id}`,
          ),
        );
      }
    });
    lesson.activities.forEach((activity, activityIndex) => {
      activity.knowledgeNodeIds.forEach((id, index) => {
        if (!knowledgeNodes.has(id)) {
          diagnostics.push(
            createDiagnostic(
              "PACK_KNOWLEDGE_REFERENCE_MISSING",
              "error",
              `/lessons/${lessonIndex}/activities/${activityIndex}/knowledgeNodeIds/${index}`,
              activity.activityId,
              `Unknown KnowledgeNode: ${id}`,
            ),
          );
        }
      });
      activity.sourceSnapshotIds.forEach((id, index) => {
        if (!snapshots.has(id)) {
          diagnostics.push(
            createDiagnostic(
              "PACK_SOURCE_REFERENCE_MISSING",
              "error",
              `/lessons/${lessonIndex}/activities/${activityIndex}/sourceSnapshotIds/${index}`,
              activity.activityId,
              `Unknown Source Snapshot: ${id}`,
            ),
          );
        }
      });
      if (
        activity.completionCriteria.some(
          (criterion) => criterion.type === "custom",
        )
      ) {
        diagnostics.push(
          createDiagnostic(
            "PACK_COMPLETION_CRITERION_UNKNOWN",
            "error",
            `/lessons/${lessonIndex}/activities/${activityIndex}/completionCriteria`,
            activity.activityId,
            "Custom completion criteria are not registered in Core Alpha",
          ),
        );
      }
      if (activity.payload.type === "quiz") {
        const questionIds = new Set(
          activity.protectedMaterial.questions.map((question) => question.id),
        );
        activity.payload.questionIds.forEach((id: string, index: number) => {
          if (!questionIds.has(id)) {
            diagnostics.push(
              createDiagnostic(
                "PACK_QUESTION_REFERENCE_MISSING",
                "error",
                `/lessons/${lessonIndex}/activities/${activityIndex}/payload/questionIds/${index}`,
                activity.activityId,
                `Unknown protected question: ${id}`,
              ),
            );
          }
        });
      }
    });
  });
}

const completionCriterionByActivity = {
  briefing: "acknowledgement",
  study: "acknowledgement",
  recall: "attempts",
  "teacher-dialogue": "dialogue",
  quiz: "score",
  "code-reading": "fields",
  exercise: "exercise",
  review: "exercise",
  interview: "attempts",
  summary: "fields",
  checkpoint: "acknowledgement",
  "spaced-review": "attempts",
} as const;

function validateActivitySemantics(
  pack: CoursePackV1,
  diagnostics: CoursePackDiagnostic[],
): void {
  const knownKnowledgeNodes = new Set(
    pack.knowledge.nodes.map((node) => node.knowledgeNodeId),
  );
  pack.lessons.forEach((lesson, lessonIndex) => {
    const activities = new Map(
      lesson.activities.map((activity) => [activity.activityId, activity]),
    );
    lesson.activities.forEach((activity, activityIndex) => {
      const basePath = `/lessons/${lessonIndex}/activities/${activityIndex}`;
      const questionIds = new Set<string>();
      activity.protectedMaterial.questions.forEach(
        (question, questionIndex) => {
          if (questionIds.has(question.id)) {
            diagnostics.push(
              createDiagnostic(
                "PACK_QUESTION_ID_DUPLICATE",
                "error",
                `${basePath}/protectedMaterial/questions/${questionIndex}/id`,
                activity.activityId,
                `Duplicate protected question ID: ${question.id}`,
              ),
            );
          }
          questionIds.add(question.id);
        },
      );

      const expectedCriterion = completionCriterionByActivity[activity.type];
      activity.completionCriteria.forEach((criterion, criterionIndex) => {
        const criterionPath = `${basePath}/completionCriteria/${criterionIndex}`;
        if (criterion.type !== expectedCriterion) {
          diagnostics.push(
            createDiagnostic(
              "PACK_COMPLETION_CRITERION_INCOMPATIBLE",
              "error",
              criterionPath,
              activity.activityId,
              `${activity.type} activities require ${expectedCriterion} completion evidence`,
            ),
          );
          return;
        }
        if (
          criterion.type === "dialogue" &&
          activity.payload.type === "teacher-dialogue" &&
          (criterion.minimumTurns !== activity.payload.minimumTurns ||
            criterion.requiresRevision !== activity.payload.requiresRevision)
        ) {
          diagnostics.push(
            createDiagnostic(
              "PACK_COMPLETION_CRITERION_MISMATCH",
              "error",
              criterionPath,
              activity.activityId,
              "Dialogue completion must exactly match the teacher-dialogue payload",
            ),
          );
        }
        if (
          criterion.type === "score" &&
          activity.payload.type === "quiz" &&
          (criterion.minimum !== activity.payload.minimumScore ||
            criterion.minimumAttempts > activity.payload.questionIds.length)
        ) {
          diagnostics.push(
            createDiagnostic(
              "PACK_COMPLETION_CRITERION_MISMATCH",
              "error",
              criterionPath,
              activity.activityId,
              "Quiz score completion must match the payload and cannot require more questions than the quiz exposes",
            ),
          );
        }
        if (criterion.type === "fields") {
          const expectedFields =
            activity.type === "code-reading"
              ? ["explanation", "prediction", "verbalFix"]
              : ["summaryId"];
          if (!sameStringSets(criterion.required, expectedFields)) {
            diagnostics.push(
              createDiagnostic(
                "PACK_COMPLETION_CRITERION_MISMATCH",
                "error",
                criterionPath,
                activity.activityId,
                `${activity.type} completion requires exactly: ${expectedFields.join(", ")}`,
              ),
            );
          }
        }
        if (
          criterion.type === "attempts" &&
          activity.payload.type === "spaced-review" &&
          criterion.minimum > activity.payload.topicIds.length
        ) {
          diagnostics.push(
            createDiagnostic(
              "PACK_COMPLETION_CRITERION_MISMATCH",
              "error",
              criterionPath,
              activity.activityId,
              "Spaced-review attempts cannot exceed the declared topic count",
            ),
          );
        }
      });

      if (activity.payload.type === "quiz") {
        const questionsById = new Map(
          activity.protectedMaterial.questions.map((question) => [
            question.id,
            question,
          ]),
        );
        activity.payload.questionIds.forEach((questionId, questionIndex) => {
          const question = questionsById.get(questionId);
          if (
            question &&
            (question.options.length < 2 ||
              question.correctOptionIds.length < 1)
          ) {
            diagnostics.push(
              createDiagnostic(
                "PACK_QUESTION_EVALUATION_INVALID",
                "error",
                `${basePath}/payload/questionIds/${questionIndex}`,
                activity.activityId,
                "A quiz question requires at least two public options and one protected correct option",
              ),
            );
          }
        });
      }

      if (activity.payload.type === "review") {
        const exercise = activities.get(activity.payload.exerciseUnitId);
        if (!exercise || exercise.type !== "exercise") {
          diagnostics.push(
            createDiagnostic(
              "PACK_REVIEW_REFERENCE_INVALID",
              "error",
              `${basePath}/payload/exerciseUnitId`,
              activity.activityId,
              "A review must reference an exercise in the same lesson",
            ),
          );
        }
      }

      if (activity.payload.type === "spaced-review") {
        const knownNodes = knownKnowledgeNodes;
        activity.payload.topicIds.forEach((topicId, topicIndex) => {
          if (!knownNodes.has(topicId)) {
            diagnostics.push(
              createDiagnostic(
                "PACK_KNOWLEDGE_REFERENCE_MISSING",
                "error",
                `${basePath}/payload/topicIds/${topicIndex}`,
                activity.activityId,
                `Unknown KnowledgeNode: ${topicId}`,
              ),
            );
          }
        });
      }
    });
  });
}

function validateLessonPrerequisiteGraph(
  pack: CoursePackV1,
  diagnostics: CoursePackDiagnostic[],
): void {
  const lessonIndexById = new Map(
    pack.lessons.map((lesson, index) => [lesson.lessonId, index]),
  );
  pack.lessons.forEach((lesson, lessonIndex) => {
    (lesson.prerequisiteLessonIds ?? []).forEach(
      (prerequisiteId, prerequisiteIndex) => {
        const path = `/lessons/${lessonIndex}/prerequisiteLessonIds/${prerequisiteIndex}`;
        if (!lessonIndexById.has(prerequisiteId)) {
          diagnostics.push(
            createDiagnostic(
              "PACK_LESSON_GRAPH_REFERENCE_MISSING",
              "error",
              path,
              lesson.lessonId,
              `Unknown prerequisite lesson: ${prerequisiteId}`,
            ),
          );
        } else if (prerequisiteId === lesson.lessonId) {
          diagnostics.push(
            createDiagnostic(
              "PACK_LESSON_GRAPH_SELF_REFERENCE",
              "error",
              path,
              lesson.lessonId,
              "A lesson cannot require itself",
            ),
          );
        }
      },
    );
  });

  const complete = new Set<string>();
  const active = new Set<string>();
  const visit = (lessonId: string): void => {
    if (complete.has(lessonId)) return;
    active.add(lessonId);
    const lessonIndex = lessonIndexById.get(lessonId)!;
    const lesson = pack.lessons[lessonIndex]!;
    (lesson.prerequisiteLessonIds ?? []).forEach(
      (prerequisiteId, prerequisiteIndex) => {
        if (
          prerequisiteId === lessonId ||
          !lessonIndexById.has(prerequisiteId)
        ) {
          return;
        }
        if (active.has(prerequisiteId)) {
          diagnostics.push(
            createDiagnostic(
              "PACK_LESSON_GRAPH_CYCLE",
              "error",
              `/lessons/${lessonIndex}/prerequisiteLessonIds/${prerequisiteIndex}`,
              lessonId,
              "Lesson prerequisite relationships must be acyclic",
            ),
          );
          return;
        }
        visit(prerequisiteId);
      },
    );
    active.delete(lessonId);
    complete.add(lessonId);
  };
  for (const lesson of pack.lessons) visit(lesson.lessonId);
}

function validateRequirements(
  pack: CoursePackV1,
  registry: CoursePackRegistry,
  diagnostics: CoursePackDiagnostic[],
): void {
  const derived = deriveCoursePackRequirements(pack.lessons);
  validateExactRequirement(
    "activityTypes",
    pack.requirements.activityTypes,
    derived.activityTypes,
    diagnostics,
  );
  validateExactRequirement(
    "capabilities",
    pack.requirements.capabilities,
    derived.capabilities,
    diagnostics,
  );
  validateExactRequirement(
    "checkIds",
    pack.requirements.checkIds,
    derived.checkIds,
    diagnostics,
  );
  validateExactRequirement(
    "environmentIds",
    pack.requirements.environmentIds,
    derived.environmentIds,
    diagnostics,
  );

  for (const [name, declared, installed] of [
    ["activityTypes", pack.requirements.activityTypes, registry.activityTypes],
    ["capabilities", pack.requirements.capabilities, registry.capabilityIds],
    [
      "environmentIds",
      pack.requirements.environmentIds,
      registry.environmentIds,
    ],
    ["checkIds", pack.requirements.checkIds, registry.checkIds],
  ] as const) {
    const installedIds = new Set<string>(installed);
    declared.forEach((id, index) => {
      if (!installedIds.has(id)) {
        diagnostics.push(
          createDiagnostic(
            "PACK_REQUIREMENT_UNAVAILABLE",
            "error",
            `/requirements/${name}/${index}`,
            id,
            `Installed Core does not provide ${name} requirement: ${id}`,
          ),
        );
      }
    });
  }
}

function validateProvenance(
  pack: CoursePackV1,
  diagnostics: CoursePackDiagnostic[],
): void {
  const provenance = pack.course.provenance;
  if (provenance.ownership === "unresolved") {
    diagnostics.push(
      createDiagnostic(
        "PACK_PROVENANCE_UNRESOLVED",
        "error",
        "/course/provenance/ownership",
        pack.course.courseKey,
        "Unresolved ownership blocks installation",
      ),
    );
  }
  if (provenance.licenseSpdx === null && provenance.termsUrl === null) {
    diagnostics.push(
      createDiagnostic(
        "PACK_CONTENT_TERMS_MISSING",
        "error",
        "/course/provenance",
        pack.course.courseKey,
        "A license identifier or terms URL is required",
      ),
    );
  }
  pack.knowledge.sourceSnapshots.forEach((snapshot, index) => {
    if (snapshot.authorPublisher === null || snapshot.attribution === null) {
      diagnostics.push(
        createDiagnostic(
          "PACK_SOURCE_ATTRIBUTION_MISSING",
          "error",
          `/knowledge/sourceSnapshots/${index}`,
          snapshot.snapshotId,
          "Source author/publisher and attribution are required",
        ),
      );
    }
    if (snapshot.licenseSpdx === null && snapshot.termsUrl === null) {
      diagnostics.push(
        createDiagnostic(
          "PACK_SOURCE_TERMS_MISSING",
          "error",
          `/knowledge/sourceSnapshots/${index}`,
          snapshot.snapshotId,
          "Source license or terms URL is required",
        ),
      );
    }
  });
}

function validateKnowledge(
  pack: CoursePackV1,
  diagnostics: CoursePackDiagnostic[],
): void {
  const nodeIds = new Set(
    pack.knowledge.nodes.map((node) => node.knowledgeNodeId),
  );
  const snapshotIds = new Set(
    pack.knowledge.sourceSnapshots.map((snapshot) => snapshot.snapshotId),
  );
  pack.knowledge.nodes.forEach((node, nodeIndex) => {
    for (const [field, ids] of [
      ["prerequisiteKnowledgeNodeIds", node.prerequisiteKnowledgeNodeIds],
      ["relatedKnowledgeNodeIds", node.relatedKnowledgeNodeIds],
    ] as const) {
      ids.forEach((id, index) => {
        if (!nodeIds.has(id) || id === node.knowledgeNodeId) {
          diagnostics.push(
            createDiagnostic(
              "PACK_KNOWLEDGE_GRAPH_INVALID",
              "error",
              `/knowledge/nodes/${nodeIndex}/${field}/${index}`,
              node.knowledgeNodeId,
              `Knowledge relationship is missing or self-referential: ${id}`,
            ),
          );
        }
      });
    }
  });
  validateKnowledgePrerequisiteCycles(pack, nodeIds, diagnostics);
  pack.knowledge.sourceSnapshots.forEach((snapshot, index) => {
    if (snapshot.content !== null) {
      const content =
        typeof snapshot.content === "string"
          ? snapshot.content
          : canonicalJson(snapshot.content);
      const observed = `sha256:${createHash("sha256")
        .update(content, "utf8")
        .digest("hex")}`;
      if (observed !== snapshot.contentHash) {
        diagnostics.push(
          createDiagnostic(
            "PACK_SOURCE_HASH_MISMATCH",
            "error",
            `/knowledge/sourceSnapshots/${index}/contentHash`,
            snapshot.snapshotId,
            `Source content hash does not match ${observed}`,
          ),
        );
      }
    }
  });
  pack.knowledge.capsules.forEach((capsule, capsuleIndex) => {
    capsule.knowledgeNodeIds.forEach((id, index) => {
      if (!nodeIds.has(id)) {
        diagnostics.push(
          createDiagnostic(
            "PACK_CAPSULE_NODE_MISSING",
            "error",
            `/knowledge/capsules/${capsuleIndex}/knowledgeNodeIds/${index}`,
            capsule.capsuleId,
            `Unknown KnowledgeNode: ${id}`,
          ),
        );
      }
    });
    capsule.citations.forEach((citation, citationIndex) => {
      if (!snapshotIds.has(citation.snapshotId)) {
        diagnostics.push(
          createDiagnostic(
            "PACK_CAPSULE_SOURCE_MISSING",
            "error",
            `/knowledge/capsules/${capsuleIndex}/citations/${citationIndex}/snapshotId`,
            capsule.capsuleId,
            `Unknown Source Snapshot: ${citation.snapshotId}`,
          ),
        );
      }
    });
    const hashable = Object.fromEntries(
      Object.entries(capsule).filter(([key]) => key !== "validationHash"),
    );
    const observed = `sha256:${createHash("sha256")
      .update(canonicalJson(hashable), "utf8")
      .digest("hex")}`;
    if (capsule.validationHash !== observed) {
      diagnostics.push(
        createDiagnostic(
          "PACK_CAPSULE_HASH_MISMATCH",
          "error",
          `/knowledge/capsules/${capsuleIndex}/validationHash`,
          capsule.capsuleId,
          `Capsule validation hash does not match ${observed}`,
        ),
      );
    }
  });
}

function validateKnowledgePrerequisiteCycles(
  pack: CoursePackV1,
  nodeIds: ReadonlySet<string>,
  diagnostics: CoursePackDiagnostic[],
): void {
  const nodeIndexById = new Map(
    pack.knowledge.nodes.map((node, index) => [node.knowledgeNodeId, index]),
  );
  const complete = new Set<string>();
  const active = new Set<string>();

  const visit = (nodeId: string): void => {
    if (complete.has(nodeId)) return;
    active.add(nodeId);
    const nodeIndex = nodeIndexById.get(nodeId)!;
    const node = pack.knowledge.nodes[nodeIndex]!;
    node.prerequisiteKnowledgeNodeIds.forEach(
      (prerequisiteId, prerequisiteIndex) => {
        if (!nodeIds.has(prerequisiteId) || prerequisiteId === nodeId) return;
        if (active.has(prerequisiteId)) {
          diagnostics.push(
            createDiagnostic(
              "PACK_KNOWLEDGE_GRAPH_CYCLE",
              "error",
              `/knowledge/nodes/${nodeIndex}/prerequisiteKnowledgeNodeIds/${prerequisiteIndex}`,
              nodeId,
              "Knowledge prerequisite relationships must be acyclic",
            ),
          );
          return;
        }
        visit(prerequisiteId);
      },
    );
    active.delete(nodeId);
    complete.add(nodeId);
  };

  for (const node of pack.knowledge.nodes) visit(node.knowledgeNodeId);
}

function validateProtectedSeparation(
  pack: CoursePackV1,
  diagnostics: CoursePackDiagnostic[],
): void {
  const visible = learnerVisiblePackStrings(pack);
  pack.lessons.forEach((lesson, lessonIndex) => {
    lesson.activities.forEach((activity, activityIndex) => {
      const protectedValues = [
        activity.protectedMaterial.referenceAnswer,
        ...activity.protectedMaterial.questions.flatMap((question) => [
          question.referenceAnswer,
          ...question.evaluationPoints,
          ...question.commonMistakes,
        ]),
      ].filter((value): value is string => value !== null);
      if (
        protectedValues.some((protectedValue) =>
          visible.some((value) =>
            containsProtectedValue(value, protectedValue),
          ),
        )
      ) {
        diagnostics.push(
          createDiagnostic(
            "PACK_PROTECTED_MATERIAL_LEAK",
            "error",
            `/lessons/${lessonIndex}/activities/${activityIndex}`,
            activity.activityId,
            "Protected evaluation material appears in learner-visible Course content",
          ),
        );
      }
    });
  });
}

function learnerVisiblePackStrings(pack: CoursePackV1): string[] {
  const result = [pack.course.title, pack.course.description];
  for (const node of pack.knowledge.nodes) {
    result.push(node.title, node.description);
  }
  for (const snapshot of pack.knowledge.sourceSnapshots) {
    result.push(snapshot.title);
    if (snapshot.attribution !== null) result.push(snapshot.attribution);
    if (typeof snapshot.content === "string") result.push(snapshot.content);
  }
  for (const lesson of pack.lessons) {
    result.push(lesson.title, lesson.description, lesson.goal);
    for (const activity of lesson.activities) {
      result.push(
        activity.title,
        activity.description,
        ...visiblePayloadStrings(activity.payload),
        ...activity.protectedMaterial.questions.flatMap((question) => [
          question.prompt,
          ...question.options.map((option) => option.label),
        ]),
      );
    }
  }
  for (const localization of pack.localizations) {
    for (const value of Object.values(localization.fields)) {
      if (typeof value === "string") result.push(value);
      else result.push(...value);
    }
  }
  return result;
}

function containsProtectedValue(
  visible: string,
  protectedValue: string,
): boolean {
  const normalizedVisible = normalizeComparableText(visible);
  const normalizedProtected = normalizeComparableText(protectedValue);
  if (normalizedVisible === normalizedProtected) return true;
  let offset = normalizedVisible.indexOf(normalizedProtected);
  while (offset !== -1) {
    const before = normalizedVisible[offset - 1];
    const after = normalizedVisible[offset + normalizedProtected.length];
    if (
      (!isLetterOrNumber(normalizedProtected[0]) ||
        !isLetterOrNumber(before)) &&
      (!isLetterOrNumber(normalizedProtected.at(-1)) ||
        !isLetterOrNumber(after))
    ) {
      return true;
    }
    offset = normalizedVisible.indexOf(normalizedProtected, offset + 1);
  }
  return false;
}

function normalizeComparableText(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
}

function isLetterOrNumber(value: string | undefined): boolean {
  return value !== undefined && /[\p{L}\p{N}]/u.test(value);
}

const FORBIDDEN_FIELD_NAMES = new Set([
  "apikey",
  "args",
  "argv",
  "binary",
  "command",
  "commands",
  "credential",
  "credentials",
  "cwd",
  "env",
  "environmentvariables",
  "executable",
  "filesystempath",
  "hook",
  "hooks",
  "localpath",
  "networkrequest",
  "permission",
  "permissions",
  "plugin",
  "plugins",
  "privatekey",
  "providerconfig",
  "providercredentials",
  "script",
  "scripts",
  "secret",
  "shell",
  "token",
  "tooldefinition",
  "wasm",
  "webhook",
  "workingdirectory",
]);

const SECRET_PATTERNS = [
  /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/u,
  /\b(?:sk|rk)-[A-Za-z0-9_-]{16,}\b/u,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/u,
  /\bAKIA[0-9A-Z]{16}\b/u,
  /\bBearer\s+[A-Za-z0-9._~+/-]{12,}=*\b/iu,
  /\bAuthorization\s*:\s*Basic\s+[A-Za-z0-9+/]{12,}={0,2}(?![A-Za-z0-9+/=])/iu,
  /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/u,
  /\bAIza[0-9A-Za-z_-]{32,}\b/u,
  /(?:^|[\s{[(,;?&"'])(?:password|passphrase|api[\s_-]*key|access[\s_-]*token|client[\s_-]*secret|private[\s_-]*key)["']?\s*(?:=|:|=>)\s*["']?[^\s"'&,;}\]]{6,}(?=["']?(?:[ \t]*(?:$|[,;}\]])|&))/iu,
  /(?:^|[\s{[(,;])(?:password|passphrase|api[\s_-]*key|access[\s_-]*token|client[\s_-]*secret|private[\s_-]*key)\s+(?:is\s+)?["'][^"'\r\n]{6,}["']/iu,
  /https:\/\/[^\s/?#]+:(?:[^\s@/?#]{6,})@/iu,
];
const ACTIVE_CONTENT_RULES = [
  {
    ruleId: "active-html-element",
    pattern: /<\s*(?:script|iframe|object|embed|link|meta)\b/iu,
  },
  {
    ruleId: "event-handler-attribute",
    pattern: /\bon[a-z][a-z0-9:_-]*\s*=/iu,
    allowedInEducationalCode: true,
    allowedInFencedMarkdown: true,
  },
  { ruleId: "javascript-url", pattern: /\bjavascript\s*:/iu },
  { ruleId: "html-data-url", pattern: /\bdata\s*:\s*text\/html/iu },
  {
    ruleId: "remote-markdown-image",
    pattern: /!\[[^\]]*\]\(\s*https?:\/\//iu,
  },
] as const;
const FORBIDDEN_PATH_RULES = [
  { ruleId: "windows-drive-path", pattern: /^[A-Za-z]:[\\/]/u },
  { ruleId: "unc-path", pattern: /^\\\\/u },
  { ruleId: "network-path", pattern: /^\/\//u },
  { ruleId: "absolute-posix-path", pattern: /^\/(?!\/)/u },
  {
    ruleId: "parent-traversal-path",
    pattern: /(?:^|[\\/])\.\.(?:[\\/]|$)/u,
  },
  { ruleId: "windows-device-path", pattern: /^\\\\[.?]\\/u },
] as const;

function scanUntrustedValues(
  value: unknown,
  path: readonly (string | number)[],
  diagnostics: CoursePackDiagnostic[],
): void {
  if (typeof value === "string") {
    const context = scanContext(path);
    if (SECRET_PATTERNS.some((pattern) => pattern.test(value))) {
      diagnostics.push(
        createDiagnostic(
          "PACK_SECRET_SHAPED_VALUE",
          "error",
          jsonPointer(path),
          null,
          "Secret-shaped values are forbidden in Course Packs",
          "secret-shaped-value",
          context,
        ),
      );
    }
    for (const rule of ACTIVE_CONTENT_RULES) {
      if (
        "allowedInEducationalCode" in rule &&
        rule.allowedInEducationalCode &&
        context === "educational-code"
      ) {
        continue;
      }
      const scanValue =
        "allowedInFencedMarkdown" in rule &&
        rule.allowedInFencedMarkdown &&
        context === "learner-markdown"
          ? maskFencedCode(value)
          : value;
      if (!rule.pattern.test(scanValue)) continue;
      diagnostics.push(
        createDiagnostic(
          "PACK_ACTIVE_CONTENT",
          "error",
          jsonPointer(path),
          null,
          "Active or automatically fetched content is forbidden",
          rule.ruleId,
          context,
        ),
      );
    }
    for (const rule of FORBIDDEN_PATH_RULES) {
      if (!rule.pattern.test(value)) continue;
      diagnostics.push(
        createDiagnostic(
          "PACK_LOCAL_PATH_VALUE",
          "error",
          jsonPointer(path),
          null,
          "Absolute, device, UNC, or traversal path values are forbidden",
          rule.ruleId,
          context,
        ),
      );
    }
    if (/^https:\/\//iu.test(value)) {
      validateSafeUrl(value, path, diagnostics, context);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      scanUntrustedValues(item, [...path, index], diagnostics),
    );
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    const normalized = key.toLowerCase().replaceAll(/[^a-z0-9]/gu, "");
    if (FORBIDDEN_FIELD_NAMES.has(normalized)) {
      diagnostics.push(
        createDiagnostic(
          "PACK_AUTHORITY_FIELD",
          "error",
          jsonPointer([...path, key]),
          null,
          "Authority-bearing fields are forbidden in Course Packs",
          "authority-field",
          "field-name",
        ),
      );
    }
    scanUntrustedValues(child, [...path, key], diagnostics);
  }
}

function scanContext(
  path: readonly (string | number)[],
): CoursePackDiagnosticContext {
  let field: string | undefined;
  for (let index = path.length - 1; index >= 0; index -= 1) {
    const part = path[index];
    if (typeof part === "string") {
      field = part;
      break;
    }
  }
  const parent = path[path.length - 2];
  if (parent === "payload" && (field === "snippet" || field === "template")) {
    return "educational-code";
  }
  if (
    field === "body" ||
    field === "prompt" ||
    field === "openingPrompt" ||
    field === "description" ||
    field === "goal" ||
    field?.includes("/payload/body") === true
  ) {
    return "learner-markdown";
  }
  return "json-value";
}

function maskFencedCode(value: string): string {
  return value.replace(
    /(^|\r?\n)[ \t]{0,3}(`{3,}|~{3,})[^\r\n]*(?:\r?\n|$)[\s\S]*?(?:\r?\n[ \t]{0,3}\2[ \t]*(?=\r?\n|$)|$)/gu,
    "$1",
  );
}

function validateSafeUrl(
  value: string,
  path: readonly (string | number)[],
  diagnostics: CoursePackDiagnostic[],
  context: CoursePackDiagnosticContext,
): void {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/gu, "");
    if (
      url.protocol !== "https:" ||
      url.username !== "" ||
      url.password !== "" ||
      isLocalHostname(hostname)
    ) {
      throw new TypeError("Unsafe URL");
    }
  } catch {
    diagnostics.push(
      createDiagnostic(
        "PACK_URL_UNSAFE",
        "error",
        jsonPointer(path),
        null,
        "URL must be credential-free HTTPS and must not target a local network",
        "url-policy",
        context,
      ),
    );
  }
}

function isLocalHostname(hostname: string): boolean {
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "::1" ||
    hostname.startsWith("fe80:") ||
    hostname.startsWith("fc") ||
    hostname.startsWith("fd")
  ) {
    return true;
  }
  const octets = hostname.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return false;
  }
  return (
    octets[0] === 10 ||
    octets[0] === 127 ||
    (octets[0] === 169 && octets[1] === 254) ||
    (octets[0] === 172 && octets[1]! >= 16 && octets[1]! <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
  );
}

function localizableFields(pack: CoursePackV1): Set<string> {
  const result = new Set(["course/title", "course/description"]);
  pack.lessons.forEach((lesson) => {
    result.add(`lesson/${lesson.lessonId}/title`);
    result.add(`lesson/${lesson.lessonId}/description`);
    result.add(`lesson/${lesson.lessonId}/goal`);
    lesson.activities.forEach((activity) => {
      const base = `activity/${activity.activityId}`;
      result.add(`${base}/title`);
      result.add(`${base}/description`);
      for (const field of localizablePayloadFields(activity.payload)) {
        result.add(`${base}/payload/${field}`);
      }
    });
  });
  return result;
}

function localizablePayloadFields(
  payload: CoursePackV1["lessons"][number]["activities"][number]["payload"],
): string[] {
  switch (payload.type) {
    case "briefing":
      return ["scope", "outOfScope"];
    case "study":
      return payload.body === undefined ? [] : ["body"];
    case "recall":
      return ["prompt"];
    case "teacher-dialogue":
      return ["openingPrompt"];
    case "quiz":
    case "review":
    case "spaced-review":
      return [];
    case "code-reading":
      return ["snippet"];
    case "exercise":
      return [
        "acceptanceCriteria",
        "constraints",
        "hintPolicy",
        "reviewPolicy",
      ];
    case "interview":
      return ["topics"];
    case "summary":
      return ["prompts"];
    case "checkpoint":
      return ["label"];
  }
}

function visiblePayloadStrings(
  payload: CoursePackV1["lessons"][number]["activities"][number]["payload"],
): string[] {
  switch (payload.type) {
    case "briefing":
      return [...payload.scope, ...payload.outOfScope];
    case "study":
      return payload.body === undefined ? [] : [payload.body];
    case "recall":
      return [payload.prompt];
    case "teacher-dialogue":
      return [payload.openingPrompt];
    case "quiz":
      return [];
    case "code-reading":
      return [payload.snippet];
    case "exercise":
      return [
        ...payload.acceptanceCriteria,
        ...payload.constraints,
        payload.template,
        payload.hintPolicy,
        payload.reviewPolicy,
      ];
    case "review":
      return [];
    case "interview":
      return [...payload.topics];
    case "summary":
      return [...payload.prompts];
    case "checkpoint":
      return [payload.label];
    case "spaced-review":
      return [];
  }
}

function validateExactRequirement(
  name: keyof CoursePackV1["requirements"],
  declared: readonly string[],
  derived: readonly string[],
  diagnostics: CoursePackDiagnostic[],
): void {
  if (!sameStrings(declared, derived)) {
    diagnostics.push(
      createDiagnostic(
        "PACK_REQUIREMENT_MISMATCH",
        "error",
        `/requirements/${name}`,
        null,
        `Declared ${name} must exactly equal derived requirements: ${derived.join(", ")}`,
      ),
    );
  }
}

function addDuplicateIdentity(
  id: string,
  seen: Set<string>,
  diagnostics: CoursePackDiagnostic[],
  path: string,
): void {
  if (seen.has(id)) {
    diagnostics.push(
      createDiagnostic(
        "PACK_ID_DUPLICATE",
        "error",
        path,
        id,
        `Duplicate stable identity: ${id}`,
      ),
    );
  }
  seen.add(id);
}

function addDuplicateOrder(
  order: number,
  seen: Set<number>,
  diagnostics: CoursePackDiagnostic[],
  path: string,
  entityId: string,
): void {
  if (seen.has(order)) {
    diagnostics.push(
      createDiagnostic(
        "PACK_ORDER_DUPLICATE",
        "error",
        path,
        entityId,
        `Duplicate sibling order: ${order}`,
      ),
    );
  }
  seen.add(order);
}

function createPreview(
  pack: CoursePackV1,
  contentHash: string,
): CoursePackPreview {
  const sourcePrivacyClasses = { public: 0, private: 0 };
  for (const snapshot of pack.knowledge.sourceSnapshots) {
    sourcePrivacyClasses[snapshot.privacyClass] += 1;
  }
  return {
    courseKey: pack.course.courseKey,
    courseTitle: pack.course.title,
    revisionKey: pack.revision.revisionKey,
    revisionNumber: pack.revision.revisionNumber,
    contentHash,
    primaryLocale: pack.course.primaryLocale,
    availableLocales: pack.course.availableLocales,
    lessonCount: pack.lessons.length,
    activityCount: pack.lessons.reduce(
      (count, lesson) => count + lesson.activities.length,
      0,
    ),
    sourcePrivacyClasses,
    requirements: pack.requirements,
    provenance: pack.course.provenance,
  };
}

function invalidResult(
  diagnostics: CoursePackDiagnostic[],
): CoursePackValidationResult {
  sortDiagnostics(diagnostics);
  return {
    valid: false,
    pack: null,
    canonicalJson: null,
    contentHash: null,
    report: createReport(diagnostics),
    preview: null,
  };
}

function createReport(
  diagnostics: readonly CoursePackDiagnostic[],
): CoursePackValidationReport {
  const errors = diagnostics.filter(
    (diagnostic) => diagnostic.severity === "error",
  ).length;
  return {
    validatorVersion: COURSE_PACK_VALIDATOR_VERSION,
    valid: errors === 0,
    errors,
    warnings: diagnostics.length - errors,
    diagnostics,
    limits: COURSE_PACK_JSON_LIMITS_V1,
  };
}

function createDiagnostic(
  code: string,
  severity: CoursePackDiagnosticSeverity,
  path: string,
  entityId: string | null,
  message: string,
  ruleId: string | null = null,
  context: CoursePackDiagnosticContext | null = null,
): CoursePackDiagnostic {
  return { code, severity, path, entityId, message, ruleId, context };
}

function sortDiagnostics(diagnostics: CoursePackDiagnostic[]): void {
  diagnostics.sort(
    (left, right) =>
      compareText(left.path, right.path) ||
      compareText(left.code, right.code) ||
      compareText(left.entityId ?? "", right.entityId ?? "") ||
      compareText(left.message, right.message),
  );
}

function jsonPointer(path: readonly PropertyKey[]): string {
  return path.length === 0
    ? ""
    : `/${path.map((part) => escapePointer(String(part))).join("/")}`;
}

function escapePointer(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareText);
}

function sameStrings(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function sameStringSets(
  left: readonly string[],
  right: readonly string[],
): boolean {
  const leftSet = new Set(left);
  return (
    leftSet.size === left.length &&
    left.length === right.length &&
    right.every((value) => leftSet.has(value))
  );
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
