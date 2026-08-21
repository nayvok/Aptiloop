import { z } from "zod";

import {
  QuestionKindSchema,
  UnitCompletionCriterionSchema,
  UnitPayloadSchema,
  UnitTypeSchema,
} from "./curriculum.js";
import type { JsonValue } from "./json.js";

const MAX_ID_LENGTH = 200;
const MAX_SHORT_TEXT_LENGTH = 500;
const MAX_TEXT_LENGTH = 50_000;
const MAX_LIST_ITEMS = 500;
const MAX_JSON_DEPTH = 8;
const MAX_JSON_CONTAINER_ITEMS = 200;
const MAX_JSON_PAYLOAD_LENGTH = 100_000;

const ENTITY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,199}$/;
const OPERATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,199}$/;
const STABLE_ID_PATTERN = /^[a-z0-9][a-z0-9._/-]{0,199}$/;
const LOCALE_PATTERN = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/;
const SHA256_PATTERN = /^(?:sha256:)?[0-9a-f]{64}$/;

export const CourseEntityIdSchema = z
  .string()
  .min(1)
  .max(MAX_ID_LENGTH)
  .regex(ENTITY_ID_PATTERN, "Malformed entity ID");
export type CourseEntityId = z.infer<typeof CourseEntityIdSchema>;

export const CourseOperationIdSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(OPERATION_ID_PATTERN, "Malformed operation ID");
export type CourseOperationId = z.infer<typeof CourseOperationIdSchema>;

export const StableCourseIdSchema = z
  .string()
  .min(1)
  .max(MAX_ID_LENGTH)
  .regex(STABLE_ID_PATTERN, "Malformed stable ID");
export type StableCourseId = z.infer<typeof StableCourseIdSchema>;

export const CourseLocaleSchema = z
  .string()
  .min(2)
  .max(35)
  .regex(LOCALE_PATTERN, "Malformed BCP 47 locale");
export type CourseLocale = z.infer<typeof CourseLocaleSchema>;

export const Sha256Schema = z
  .string()
  .regex(
    SHA256_PATTERN,
    "SHA-256 must be 64 lowercase hexadecimal characters with an optional sha256: prefix",
  );
export type Sha256 = z.infer<typeof Sha256Schema>;

const IsoDateTimeSchema = z.string().datetime({ offset: true });
const ShortTextSchema = z
  .string()
  .min(1)
  .max(MAX_SHORT_TEXT_LENGTH)
  .refine(
    (value) => value === value.trim(),
    "Text cannot have outer whitespace",
  )
  .refine((value) => value.trim().length > 0, "Text cannot be blank");

/**
 * A knowledge-node key carried by learning projections.
 *
 * Target Course Packs use stable IDs, while migrated sessions preserve
 * bounded semantic topic keys such as "primitive values".
 */
export const LearningKnowledgeNodeIdSchema = ShortTextSchema;
export type LearningKnowledgeNodeId = z.infer<
  typeof LearningKnowledgeNodeIdSchema
>;

const TextSchema = z
  .string()
  .min(1)
  .max(MAX_TEXT_LENGTH)
  .refine(
    (value) => value === value.trim(),
    "Text cannot have outer whitespace",
  )
  .refine((value) => value.trim().length > 0, "Text cannot be blank");
const StableIdListSchema = z.array(StableCourseIdSchema).max(MAX_LIST_ITEMS);
const EntityIdListSchema = z.array(CourseEntityIdSchema).max(MAX_LIST_ITEMS);
const ShortTextListSchema = z.array(ShortTextSchema).max(MAX_LIST_ITEMS);

export const CoursePackDiagnosticContextSchema = z.enum([
  "json-value",
  "learner-markdown",
  "educational-code",
  "field-name",
]);
export const CoursePackValidationDiagnosticSchema = z
  .object({
    code: z.string().min(1).max(100),
    severity: z.enum(["error", "warning"]),
    path: z.string().max(1_000),
    entityId: z.string().max(MAX_ID_LENGTH).nullable(),
    message: z.string().min(1).max(2_000),
    ruleId: z.string().min(1).max(100).nullable(),
    context: CoursePackDiagnosticContextSchema.nullable(),
  })
  .strict();
export type CoursePackValidationDiagnostic = z.infer<
  typeof CoursePackValidationDiagnosticSchema
>;

export const CoursePackValidationReportSchema = z
  .object({
    validatorVersion: z.string().min(1).max(100),
    valid: z.boolean(),
    errors: z.number().int().nonnegative(),
    warnings: z.number().int().nonnegative(),
    diagnostics: z.array(CoursePackValidationDiagnosticSchema),
    limits: z
      .object({
        maxBytes: z.number().int().positive(),
        maxDecodedCharacters: z.number().int().positive(),
        maxDepth: z.number().int().positive(),
        maxItems: z.number().int().positive(),
        maxStringCharacters: z.number().int().positive(),
        maxParseMilliseconds: z.number().int().positive(),
      })
      .strict(),
  })
  .strict();
export type CoursePackValidationReportDto = z.infer<
  typeof CoursePackValidationReportSchema
>;

export const CoursePackPreviewSchema = z
  .object({
    courseKey: StableCourseIdSchema,
    courseTitle: ShortTextSchema,
    revisionKey: StableCourseIdSchema,
    revisionNumber: z.number().int().positive(),
    contentHash: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
    availableLocales: z.array(CourseLocaleSchema).min(1).max(MAX_LIST_ITEMS),
    primaryLocale: CourseLocaleSchema,
    lessonCount: z.number().int().positive(),
    activityCount: z.number().int().positive(),
    sourcePrivacyClasses: z
      .object({
        public: z.number().int().nonnegative(),
        private: z.number().int().nonnegative(),
      })
      .strict(),
    requirements: z
      .object({
        activityTypes: z.array(StableCourseIdSchema).max(MAX_LIST_ITEMS),
        capabilities: z.array(StableCourseIdSchema).max(MAX_LIST_ITEMS),
        environmentIds: z.array(StableCourseIdSchema).max(MAX_LIST_ITEMS),
        checkIds: z.array(StableCourseIdSchema).max(MAX_LIST_ITEMS),
      })
      .strict(),
    provenance: z
      .object({
        contentStatus: z.enum(["development-fixture", "personal"]),
        author: ShortTextSchema,
        origin: z.enum(["original", "adapted", "generated", "migration"]),
        ownership: z.enum(["owned", "licensed", "permission", "unresolved"]),
        licenseSpdx: ShortTextSchema.nullable(),
        termsUrl: z.string().url().nullable(),
        attribution: TextSchema.nullable(),
        createdAt: IsoDateTimeSchema,
        notes: TextSchema.nullable(),
      })
      .strict(),
  })
  .strict();
export type CoursePackPreviewDto = z.infer<typeof CoursePackPreviewSchema>;

export const CoursePackPreparedSourceKindSchema = z.enum([
  "course-pack",
  "authoring-draft",
  "unknown",
]);
const CoursePackStagedValidationBaseSchema = z.object({
  storageAvailable: z.boolean(),
  validationId: z.string().uuid(),
  expiresAt: IsoDateTimeSchema,
  sourceKind: CoursePackPreparedSourceKindSchema,
  finalized: z.boolean(),
  report: CoursePackValidationReportSchema,
});
export const CoursePackStagedValidationResponseSchema = z
  .discriminatedUnion("valid", [
    CoursePackStagedValidationBaseSchema.extend({
      valid: z.literal(true),
      preview: CoursePackPreviewSchema,
    }).strict(),
    CoursePackStagedValidationBaseSchema.extend({
      valid: z.literal(false),
    }).strict(),
  ])
  .superRefine((response, context) => {
    if (response.report.valid !== response.valid) {
      context.addIssue({
        code: "custom",
        path: ["report", "valid"],
        message: "Validation report status must match the staged result",
      });
    }
  });
export type CoursePackStagedValidationResponse = z.infer<
  typeof CoursePackStagedValidationResponseSchema
>;

function addDuplicateIssues(
  values: readonly string[],
  context: z.RefinementCtx,
  path: string,
): void {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value)) {
      context.addIssue({
        code: "custom",
        path: [path, index],
        message: `Duplicate ID: ${value}`,
      });
    }
    seen.add(value);
  });
}

function jsonSchemaAtDepth(depth: number): z.ZodType<JsonValue> {
  const scalarSchema = z.union([
    z.string().max(MAX_TEXT_LENGTH),
    z.number().finite(),
    z.boolean(),
    z.null(),
  ]) as z.ZodType<JsonValue>;
  if (depth === 0) return scalarSchema;

  const childSchema = jsonSchemaAtDepth(depth - 1);
  const objectSchema = z
    .record(z.string().min(1).max(MAX_ID_LENGTH), childSchema)
    .superRefine((value, context) => {
      if (Object.keys(value).length > MAX_JSON_CONTAINER_ITEMS) {
        context.addIssue({
          code: "custom",
          message: `JSON objects may contain at most ${MAX_JSON_CONTAINER_ITEMS} fields`,
        });
      }
    }) as z.ZodType<JsonValue>;

  return z.union([
    scalarSchema,
    z.array(childSchema).max(MAX_JSON_CONTAINER_ITEMS),
    objectSchema,
  ]) as z.ZodType<JsonValue>;
}

export const BoundedCourseJsonValueSchema = jsonSchemaAtDepth(MAX_JSON_DEPTH);
export const BoundedCourseJsonObjectSchema = z
  .record(z.string().min(1).max(MAX_ID_LENGTH), BoundedCourseJsonValueSchema)
  .superRefine((value, context) => {
    if (Object.keys(value).length > MAX_JSON_CONTAINER_ITEMS) {
      context.addIssue({
        code: "custom",
        message: `JSON objects may contain at most ${MAX_JSON_CONTAINER_ITEMS} fields`,
      });
    }
    if (JSON.stringify(value).length > MAX_JSON_PAYLOAD_LENGTH) {
      context.addIssue({
        code: "custom",
        message: `JSON payload may contain at most ${MAX_JSON_PAYLOAD_LENGTH} serialized characters`,
      });
    }
  });
export type BoundedCourseJsonObject = z.infer<
  typeof BoundedCourseJsonObjectSchema
>;

export const CourseSchema = z
  .object({
    id: CourseEntityIdSchema,
    stableId: StableCourseIdSchema,
    title: ShortTextSchema,
    description: TextSchema.nullable(),
    primaryLocale: CourseLocaleSchema,
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
  })
  .strict()
  .superRefine((course, context) => {
    if (Date.parse(course.updatedAt) < Date.parse(course.createdAt)) {
      context.addIssue({
        code: "custom",
        path: ["updatedAt"],
        message: "Course updatedAt cannot precede createdAt",
      });
    }
  });
export type Course = z.infer<typeof CourseSchema>;

export const CourseRevisionBranchKindSchema = z.enum(["upstream", "personal"]);
export type CourseRevisionBranchKind = z.infer<
  typeof CourseRevisionBranchKindSchema
>;

export const CourseRevisionStatusSchema = z.enum([
  "draft",
  "published",
  "archived",
]);
export type CourseRevisionStatus = z.infer<typeof CourseRevisionStatusSchema>;

export const CourseRevisionSchema = z
  .object({
    id: CourseEntityIdSchema,
    courseId: CourseEntityIdSchema,
    revisionNumber: z.number().int().positive().max(1_000_000),
    parentRevisionId: CourseEntityIdSchema.nullable(),
    branchKind: CourseRevisionBranchKindSchema,
    status: CourseRevisionStatusSchema,
    contentHash: Sha256Schema.nullable(),
    basedOnContentHash: Sha256Schema.nullable(),
    createdAt: IsoDateTimeSchema,
    publishedAt: IsoDateTimeSchema.nullable(),
  })
  .strict()
  .superRefine((revision, context) => {
    if (revision.parentRevisionId === revision.id) {
      context.addIssue({
        code: "custom",
        path: ["parentRevisionId"],
        message: "A Course revision cannot be its own parent",
      });
    }
    if (revision.revisionNumber > 1 && revision.parentRevisionId === null) {
      context.addIssue({
        code: "custom",
        path: ["parentRevisionId"],
        message: "A non-root Course revision requires a parent revision",
      });
    }

    if (revision.status === "draft") {
      if (revision.contentHash !== null) {
        context.addIssue({
          code: "custom",
          path: ["contentHash"],
          message: "A draft revision cannot carry a published content hash",
        });
      }
      if (revision.publishedAt !== null) {
        context.addIssue({
          code: "custom",
          path: ["publishedAt"],
          message: "A draft revision cannot carry a publication timestamp",
        });
      }
    } else {
      if (revision.contentHash === null) {
        context.addIssue({
          code: "custom",
          path: ["contentHash"],
          message: "Published and archived revisions require a content hash",
        });
      }
      if (revision.publishedAt === null) {
        context.addIssue({
          code: "custom",
          path: ["publishedAt"],
          message: "Published and archived revisions require publishedAt",
        });
      }
    }

    if (revision.branchKind === "upstream") {
      if (revision.basedOnContentHash !== null) {
        context.addIssue({
          code: "custom",
          path: ["basedOnContentHash"],
          message: "An upstream revision cannot carry basedOnContentHash",
        });
      }
    } else {
      if (revision.parentRevisionId === null) {
        context.addIssue({
          code: "custom",
          path: ["parentRevisionId"],
          message: "A personal revision requires a parent revision",
        });
      }
      if (revision.basedOnContentHash === null) {
        context.addIssue({
          code: "custom",
          path: ["basedOnContentHash"],
          message: "A personal revision requires its immutable base hash",
        });
      }
    }
  });
export type CourseRevision = z.infer<typeof CourseRevisionSchema>;

const StrictCompletionCriterionShapeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("acknowledgement") }).strict(),
  z
    .object({
      type: z.literal("checklist"),
      requiredItemIds: EntityIdListSchema.min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("attempts"),
      minimum: z.number().int().positive().max(10_000),
    })
    .strict(),
  z
    .object({
      type: z.literal("dialogue"),
      minimumTurns: z.number().int().positive().max(1_000),
      requiresRevision: z.boolean().default(false),
    })
    .strict(),
  z
    .object({
      type: z.literal("score"),
      minimum: z.number().min(0).max(1),
      minimumAttempts: z.number().int().positive().max(10_000).default(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("fields"),
      required: z.array(ShortTextSchema).min(1).max(MAX_LIST_ITEMS),
    })
    .strict(),
  z
    .object({
      type: z.literal("exercise"),
      passingTestsRequired: z.boolean().default(true),
      acceptedReviewRequired: z.boolean().default(true),
    })
    .strict(),
  z.object({ type: z.literal("custom"), key: StableCourseIdSchema }).strict(),
]);

export const ActivityCompletionCriterionSchema =
  StrictCompletionCriterionShapeSchema.superRefine((criterion, context) => {
    if (!UnitCompletionCriterionSchema.safeParse(criterion).success) {
      context.addIssue({
        code: "custom",
        message: "Completion criterion is not registered",
      });
    }
  });
export type ActivityCompletionCriterion = z.infer<
  typeof ActivityCompletionCriterionSchema
>;

export const ActivityPayloadSchema = z
  .discriminatedUnion("type", [
    z
      .object({
        type: z.literal("briefing"),
        scope: ShortTextListSchema.default([]),
        outOfScope: ShortTextListSchema.default([]),
      })
      .strict(),
    z
      .object({
        type: z.literal("study"),
        body: TextSchema.optional(),
      })
      .strict(),
    z.object({ type: z.literal("recall"), prompt: TextSchema }).strict(),
    z
      .object({
        type: z.literal("teacher-dialogue"),
        openingPrompt: TextSchema,
        minimumTurns: z.number().int().positive().max(1_000).default(1),
        requiresRevision: z.boolean().default(true),
      })
      .strict(),
    z
      .object({
        type: z.literal("quiz"),
        questionIds: EntityIdListSchema.min(1),
        minimumScore: z.number().min(0).max(1),
      })
      .strict(),
    z.object({ type: z.literal("code-reading"), snippet: TextSchema }).strict(),
    z
      .object({
        type: z.literal("exercise"),
        exerciseId: CourseEntityIdSchema,
        acceptanceCriteria: ShortTextListSchema.min(1),
        constraints: ShortTextListSchema.default([]),
        template: TextSchema,
        testCommandId: CourseEntityIdSchema,
        hintPolicy: ShortTextSchema,
        reviewPolicy: ShortTextSchema,
      })
      .strict(),
    z
      .object({
        type: z.literal("review"),
        exerciseUnitId: CourseEntityIdSchema,
      })
      .strict(),
    z
      .object({
        type: z.literal("interview"),
        topics: ShortTextListSchema.min(1),
      })
      .strict(),
    z
      .object({
        type: z.literal("summary"),
        prompts: ShortTextListSchema.default([]),
      })
      .strict(),
    z
      .object({ type: z.literal("checkpoint"), label: ShortTextSchema })
      .strict(),
    z
      .object({
        type: z.literal("spaced-review"),
        topicIds: EntityIdListSchema.min(1),
      })
      .strict(),
  ])
  .superRefine((payload, context) => {
    if (!UnitPayloadSchema.safeParse(payload).success) {
      context.addIssue({
        code: "custom",
        message: "Activity payload is not registered",
      });
    }
    if (payload.type === "quiz") {
      addDuplicateIssues(payload.questionIds, context, "questionIds");
    }
    if (payload.type === "spaced-review") {
      addDuplicateIssues(payload.topicIds, context, "topicIds");
    }
  });
export type ActivityPayload = z.infer<typeof ActivityPayloadSchema>;

const ProtectedQuestionOptionSchema = z
  .object({
    id: CourseEntityIdSchema,
    label: ShortTextSchema,
  })
  .strict();

export const ProtectedActivityQuestionSchema = z
  .object({
    id: CourseEntityIdSchema,
    kind: QuestionKindSchema,
    prompt: TextSchema,
    options: z.array(ProtectedQuestionOptionSchema).max(MAX_LIST_ITEMS),
    correctOptionIds: EntityIdListSchema,
    referenceAnswer: TextSchema.nullable(),
    evaluationPoints: z.array(ShortTextSchema).max(MAX_LIST_ITEMS),
    commonMistakes: z.array(ShortTextSchema).max(MAX_LIST_ITEMS),
  })
  .strict()
  .superRefine((question, context) => {
    const optionIds = question.options.map((option) => option.id);
    addDuplicateIssues(optionIds, context, "options");
    addDuplicateIssues(question.correctOptionIds, context, "correctOptionIds");
    const publicOptionIds = new Set(optionIds);
    question.correctOptionIds.forEach((optionId, index) => {
      if (!publicOptionIds.has(optionId)) {
        context.addIssue({
          code: "custom",
          path: ["correctOptionIds", index],
          message: `Correct option does not exist: ${optionId}`,
        });
      }
    });
  });
export type ProtectedActivityQuestion = z.infer<
  typeof ProtectedActivityQuestionSchema
>;

export const ActivityProtectedMaterialSchema = z
  .object({
    referenceAnswer: TextSchema.nullable(),
    questions: z.array(ProtectedActivityQuestionSchema).max(MAX_LIST_ITEMS),
  })
  .strict();
export type ActivityProtectedMaterial = z.infer<
  typeof ActivityProtectedMaterialSchema
>;

const ActivityDefinitionBaseSchema = z
  .object({
    id: CourseEntityIdSchema,
    courseId: CourseEntityIdSchema,
    revisionId: CourseEntityIdSchema,
    lessonId: CourseEntityIdSchema,
    stableId: StableCourseIdSchema,
    type: UnitTypeSchema,
    order: z.number().int().nonnegative().max(1_000_000),
    title: ShortTextSchema,
    description: TextSchema,
    required: z.boolean(),
    prerequisiteActivityIds: EntityIdListSchema,
    capabilityIds: EntityIdListSchema,
    completionCriteria: z
      .array(ActivityCompletionCriterionSchema)
      .min(1)
      .max(100),
    payload: ActivityPayloadSchema,
    protectedMaterial: ActivityProtectedMaterialSchema,
  })
  .strict();

function refineActivityDefinition(
  activity: z.infer<typeof ActivityDefinitionBaseSchema>,
  context: z.RefinementCtx,
): void {
  if (activity.type !== activity.payload.type) {
    context.addIssue({
      code: "custom",
      path: ["payload", "type"],
      message: "Activity payload type must match activity type",
    });
  }
  if (activity.prerequisiteActivityIds.includes(activity.id)) {
    context.addIssue({
      code: "custom",
      path: ["prerequisiteActivityIds"],
      message: "An Activity cannot depend on itself",
    });
  }
  addDuplicateIssues(
    activity.prerequisiteActivityIds,
    context,
    "prerequisiteActivityIds",
  );
  addDuplicateIssues(activity.capabilityIds, context, "capabilityIds");
}

export const ActivityDefinitionSchema =
  ActivityDefinitionBaseSchema.superRefine(refineActivityDefinition);
export type ActivityDefinition = z.infer<typeof ActivityDefinitionSchema>;

const LearnerActivityDefinitionBaseSchema = ActivityDefinitionBaseSchema.omit({
  protectedMaterial: true,
});

export const LearnerActivityDefinitionSchema =
  LearnerActivityDefinitionBaseSchema.superRefine((activity, context) => {
    if (activity.type !== activity.payload.type) {
      context.addIssue({
        code: "custom",
        path: ["payload", "type"],
        message: "Activity payload type must match activity type",
      });
    }
    if (activity.prerequisiteActivityIds.includes(activity.id)) {
      context.addIssue({
        code: "custom",
        path: ["prerequisiteActivityIds"],
        message: "An Activity cannot depend on itself",
      });
    }
    addDuplicateIssues(
      activity.prerequisiteActivityIds,
      context,
      "prerequisiteActivityIds",
    );
    addDuplicateIssues(activity.capabilityIds, context, "capabilityIds");
  });
export type LearnerActivityDefinition = z.infer<
  typeof LearnerActivityDefinitionSchema
>;

export function toLearnerActivityDefinition(
  activity: ActivityDefinition,
): LearnerActivityDefinition {
  const { protectedMaterial, ...learnerActivity } = activity;
  void protectedMaterial;
  return learnerActivity;
}

export const CourseLessonSchema = z
  .object({
    id: CourseEntityIdSchema,
    courseId: CourseEntityIdSchema,
    revisionId: CourseEntityIdSchema,
    stableId: StableCourseIdSchema,
    order: z.number().int().nonnegative().max(1_000_000),
    title: ShortTextSchema,
    description: TextSchema,
    goal: TextSchema,
    prerequisiteLessonIds: EntityIdListSchema,
    entryActivityIds: EntityIdListSchema.min(1),
  })
  .strict()
  .superRefine((lesson, context) => {
    if (lesson.prerequisiteLessonIds.includes(lesson.id)) {
      context.addIssue({
        code: "custom",
        path: ["prerequisiteLessonIds"],
        message: "A Lesson cannot depend on itself",
      });
    }
    addDuplicateIssues(
      lesson.prerequisiteLessonIds,
      context,
      "prerequisiteLessonIds",
    );
    addDuplicateIssues(lesson.entryActivityIds, context, "entryActivityIds");
  });
export type CourseLesson = z.infer<typeof CourseLessonSchema>;

export const SourceRetrievalMethodSchema = z.enum([
  "official-http",
  "manual-import",
  "migration",
]);
export type SourceRetrievalMethod = z.infer<typeof SourceRetrievalMethodSchema>;

const RepositoryPathSchema = z
  .string()
  .min(1)
  .max(1_024)
  .refine(
    (value) =>
      !value.includes("\\") &&
      !value.startsWith("/") &&
      value
        .split("/")
        .every(
          (segment) => segment !== "" && segment !== "." && segment !== "..",
        ),
    "Repository locator paths must be canonical relative paths",
  );

export const SourceLocatorSchema = z.union([
  z
    .object({
      type: z.literal("text"),
      heading: ShortTextSchema.nullable(),
      paragraphIndex: z.number().int().nonnegative().max(1_000_000),
    })
    .strict(),
  z
    .object({
      type: z.literal("page"),
      page: z.number().int().positive().max(1_000_000),
    })
    .strict(),
  z
    .object({
      type: z.literal("timestamp"),
      startMilliseconds: z.number().int().nonnegative(),
      endMilliseconds: z.number().int().nonnegative(),
    })
    .strict()
    .superRefine((locator, context) => {
      if (locator.endMilliseconds < locator.startMilliseconds) {
        context.addIssue({
          code: "custom",
          path: ["endMilliseconds"],
          message: "Timestamp locator end cannot precede its start",
        });
      }
    }),
  z
    .object({
      type: z.literal("repository"),
      commit: z.string().regex(/^[0-9a-f]{7,64}$/),
      path: RepositoryPathSchema,
      startLine: z.number().int().positive().max(100_000_000),
      endLine: z.number().int().positive().max(100_000_000),
    })
    .strict()
    .superRefine((locator, context) => {
      if (locator.endLine < locator.startLine) {
        context.addIssue({
          code: "custom",
          path: ["endLine"],
          message: "Repository locator end cannot precede its start",
        });
      }
    }),
]);
export type SourceLocator = z.infer<typeof SourceLocatorSchema>;

const HttpsUrlSchema = z
  .string()
  .min(1)
  .max(4_000)
  .url()
  .refine(
    (value) => value === value.trim(),
    "URLs cannot have outer whitespace",
  )
  .refine((value) => {
    try {
      return new URL(value).protocol === "https:";
    } catch {
      return false;
    }
  }, "Only HTTPS URLs are accepted");
const MediaTypeSchema = z
  .string()
  .min(3)
  .max(255)
  .regex(/^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/);
const SourceContentSchema = z.union([
  z
    .string()
    .min(1)
    .max(MAX_TEXT_LENGTH)
    .refine(
      (value) => value.trim().length > 0,
      "Source content cannot be blank",
    ),
  BoundedCourseJsonObjectSchema,
  z.array(BoundedCourseJsonValueSchema).max(MAX_JSON_CONTAINER_ITEMS),
]);

export const SourceSnapshotSchema = z
  .object({
    snapshotId: CourseEntityIdSchema,
    courseId: CourseEntityIdSchema,
    revisionId: CourseEntityIdSchema,
    sourceAuthorityId: CourseEntityIdSchema,
    canonicalUrl: HttpsUrlSchema,
    retrievedAt: IsoDateTimeSchema,
    retrievalMethod: SourceRetrievalMethodSchema,
    mediaType: MediaTypeSchema,
    locale: CourseLocaleSchema.nullable(),
    contentHash: Sha256Schema,
    content: SourceContentSchema.nullable(),
    title: ShortTextSchema,
    authorPublisher: ShortTextSchema.nullable(),
    publishedOrUpdatedAt: IsoDateTimeSchema.nullable(),
    attribution: TextSchema.nullable(),
    licenseSpdx: ShortTextSchema.nullable(),
    termsUrl: HttpsUrlSchema.nullable(),
    locatorMap: z.array(SourceLocatorSchema).max(MAX_LIST_ITEMS),
    retentionMode: z.enum(["full", "extract", "metadata-only"]).default("full"),
    supersedesSnapshotId: CourseEntityIdSchema.nullable().default(null),
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
    if (snapshot.retentionMode === "metadata-only") {
      if (snapshot.content !== null) {
        context.addIssue({
          code: "custom",
          path: ["content"],
          message: "Metadata-only snapshots cannot retain content",
        });
      }
    } else if (snapshot.content === null) {
      context.addIssue({
        code: "custom",
        path: ["content"],
        message: "Full and extract snapshots require retained content",
      });
    }
  });
export type SourceSnapshot = z.infer<typeof SourceSnapshotSchema>;

export const CapsuleClaimConfidenceSchema = z.enum([
  "direct",
  "synthesized",
  "conflicted",
]);
export type CapsuleClaimConfidence = z.infer<
  typeof CapsuleClaimConfidenceSchema
>;

export const KnowledgeCapsuleClaimSchema = z
  .object({
    claimId: StableCourseIdSchema,
    statement: TextSchema,
    citationIds: StableIdListSchema.min(1),
    confidence: CapsuleClaimConfidenceSchema,
  })
  .strict()
  .superRefine((claim, context) => {
    addDuplicateIssues(claim.citationIds, context, "citationIds");
  });
export type KnowledgeCapsuleClaim = z.infer<typeof KnowledgeCapsuleClaimSchema>;

export const KnowledgeCapsuleCitationSchema = z
  .object({
    citationId: StableCourseIdSchema,
    snapshotId: CourseEntityIdSchema,
    locator: SourceLocatorSchema,
    quoteHash: Sha256Schema,
  })
  .strict();
export type KnowledgeCapsuleCitation = z.infer<
  typeof KnowledgeCapsuleCitationSchema
>;

export const KnowledgeCapsuleConflictSchema = z
  .object({
    conflictId: StableCourseIdSchema,
    claimIds: StableIdListSchema.min(2),
    status: z.enum(["unresolved", "resolved"]),
    note: TextSchema,
    resolution: TextSchema.nullable(),
  })
  .strict()
  .superRefine((conflict, context) => {
    addDuplicateIssues(conflict.claimIds, context, "claimIds");
    if (conflict.status === "resolved" && conflict.resolution === null) {
      context.addIssue({
        code: "custom",
        path: ["resolution"],
        message: "A resolved conflict requires its resolution",
      });
    }
    if (conflict.status === "unresolved" && conflict.resolution !== null) {
      context.addIssue({
        code: "custom",
        path: ["resolution"],
        message: "An unresolved conflict cannot carry a resolution",
      });
    }
  });
export type KnowledgeCapsuleConflict = z.infer<
  typeof KnowledgeCapsuleConflictSchema
>;

export const KnowledgeCapsuleCreatedBySchema = z.enum([
  "manual",
  "typed-ai-proposal",
  "migration",
]);
export type KnowledgeCapsuleCreatedBy = z.infer<
  typeof KnowledgeCapsuleCreatedBySchema
>;

export const KnowledgeCapsuleSchema = z
  .object({
    capsuleId: CourseEntityIdSchema,
    courseId: CourseEntityIdSchema,
    revisionId: CourseEntityIdSchema,
    schemaVersion: z.number().int().positive().max(1_000),
    knowledgeNodeIds: StableIdListSchema,
    primaryLocale: CourseLocaleSchema,
    claims: z.array(KnowledgeCapsuleClaimSchema).max(MAX_LIST_ITEMS),
    citations: z.array(KnowledgeCapsuleCitationSchema).max(MAX_LIST_ITEMS),
    conflicts: z.array(KnowledgeCapsuleConflictSchema).max(MAX_LIST_ITEMS),
    createdBy: KnowledgeCapsuleCreatedBySchema,
    validationHash: Sha256Schema,
    createdAt: IsoDateTimeSchema,
  })
  .strict()
  .superRefine((capsule, context) => {
    addDuplicateIssues(capsule.knowledgeNodeIds, context, "knowledgeNodeIds");
    const claimIds = capsule.claims.map((claim) => claim.claimId);
    const citationIds = capsule.citations.map(
      (citation) => citation.citationId,
    );
    const conflictIds = capsule.conflicts.map(
      (conflict) => conflict.conflictId,
    );
    addDuplicateIssues(claimIds, context, "claims");
    addDuplicateIssues(citationIds, context, "citations");
    addDuplicateIssues(conflictIds, context, "conflicts");

    const knownCitations = new Set(citationIds);
    capsule.claims.forEach((claim, claimIndex) => {
      claim.citationIds.forEach((citationId, citationIndex) => {
        if (!knownCitations.has(citationId)) {
          context.addIssue({
            code: "custom",
            path: ["claims", claimIndex, "citationIds", citationIndex],
            message: `Unknown citation: ${citationId}`,
          });
        }
      });
    });

    const knownClaims = new Set(claimIds);
    capsule.conflicts.forEach((conflict, conflictIndex) => {
      conflict.claimIds.forEach((claimId, claimIndex) => {
        if (!knownClaims.has(claimId)) {
          context.addIssue({
            code: "custom",
            path: ["conflicts", conflictIndex, "claimIds", claimIndex],
            message: `Unknown conflict claim: ${claimId}`,
          });
        }
      });
    });
  });
export type KnowledgeCapsule = z.infer<typeof KnowledgeCapsuleSchema>;

export const AdaptationBranchStatusSchema = z.enum(["active", "archived"]);
export type AdaptationBranchStatus = z.infer<
  typeof AdaptationBranchStatusSchema
>;

export const AdaptationBranchSchema = z
  .object({
    id: CourseEntityIdSchema,
    courseId: CourseEntityIdSchema,
    owner: z.literal("local"),
    baseRevisionId: CourseEntityIdSchema,
    headRevisionId: CourseEntityIdSchema.nullable(),
    status: AdaptationBranchStatusSchema,
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
  })
  .strict()
  .superRefine((branch, context) => {
    if (branch.headRevisionId === branch.baseRevisionId) {
      context.addIssue({
        code: "custom",
        path: ["headRevisionId"],
        message:
          "An adaptation head must not reuse its immutable base revision ID",
      });
    }
    if (Date.parse(branch.updatedAt) < Date.parse(branch.createdAt)) {
      context.addIssue({
        code: "custom",
        path: ["updatedAt"],
        message: "Adaptation updatedAt cannot precede createdAt",
      });
    }
  });
export type AdaptationBranch = z.infer<typeof AdaptationBranchSchema>;

export const EvidenceFactTypeSchema = z.enum([
  "recall-attempt",
  "quiz-answer",
  "code-reading-attempt",
  "summary",
]);
export type EvidenceFactType = z.infer<typeof EvidenceFactTypeSchema>;

const ProvenanceVersionSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/);

export const EvidenceProvenanceSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("learner"),
      sourceId: CourseEntityIdSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("deterministic-evaluator"),
      sourceId: CourseEntityIdSchema,
      sourceVersion: ProvenanceVersionSchema,
      sourceHash: Sha256Schema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("trusted-check"),
      sourceId: CourseEntityIdSchema,
      sourceVersion: ProvenanceVersionSchema,
      sourceHash: Sha256Schema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("read-only-reviewer"),
      sourceId: CourseEntityIdSchema,
      sourceVersion: ProvenanceVersionSchema,
      sourceHash: Sha256Schema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("migration"),
      sourceTable: StableCourseIdSchema,
      sourcePrimaryKey: CourseEntityIdSchema,
      sourceRowHash: Sha256Schema,
      transformVersion: ProvenanceVersionSchema,
      sourceDatabaseDigest: Sha256Schema.optional(),
    })
    .strict(),
]);
export type EvidenceProvenance = z.infer<typeof EvidenceProvenanceSchema>;

export const EvidenceFactSchema = z
  .object({
    id: CourseEntityIdSchema,
    schemaVersion: z.number().int().positive().max(1_000),
    operationId: CourseOperationIdSchema,
    courseId: CourseEntityIdSchema,
    revisionId: CourseEntityIdSchema,
    lessonId: CourseEntityIdSchema,
    sessionId: CourseEntityIdSchema,
    activityId: CourseEntityIdSchema,
    type: EvidenceFactTypeSchema,
    questionId: CourseEntityIdSchema.nullable(),
    correctness: z.number().finite().min(0).max(1).nullable(),
    occurredAt: IsoDateTimeSchema,
    recordedAt: IsoDateTimeSchema,
    payload: BoundedCourseJsonObjectSchema,
    provenance: EvidenceProvenanceSchema,
  })
  .strict()
  .superRefine((fact, context) => {
    if (Date.parse(fact.recordedAt) < Date.parse(fact.occurredAt)) {
      context.addIssue({
        code: "custom",
        path: ["recordedAt"],
        message: "Evidence recordedAt cannot precede occurredAt",
      });
    }
  });
export type EvidenceFact = z.infer<typeof EvidenceFactSchema>;

export const ReviewItemKindSchema = z.enum([
  "mistake-correction",
  "flashcard",
  "spaced-review",
  "activity-review",
]);
export type ReviewItemKind = z.infer<typeof ReviewItemKindSchema>;

export const ReviewItemStatusSchema = z.enum([
  "pending",
  "completed",
  "dismissed",
  "superseded",
]);
export type ReviewItemStatus = z.infer<typeof ReviewItemStatusSchema>;

export const ReviewItemSchema = z
  .object({
    id: CourseEntityIdSchema,
    courseId: CourseEntityIdSchema,
    revisionId: CourseEntityIdSchema,
    sourceEvidenceId: CourseEntityIdSchema,
    kind: ReviewItemKindSchema,
    status: ReviewItemStatusSchema,
    dueAt: IsoDateTimeSchema,
    payload: BoundedCourseJsonObjectSchema,
    schedulerVersion: ProvenanceVersionSchema,
    createdAt: IsoDateTimeSchema,
  })
  .strict();
export type ReviewItem = z.infer<typeof ReviewItemSchema>;

const expectedActivityTypeByEvidence: Record<
  EvidenceFactType,
  z.infer<typeof UnitTypeSchema>
> = {
  "recall-attempt": "recall",
  "quiz-answer": "quiz",
  "code-reading-attempt": "code-reading",
  summary: "summary",
};

export const ActivityEvidenceOwnershipSchema = z
  .object({
    activity: ActivityDefinitionSchema,
    evidence: EvidenceFactSchema,
  })
  .strict()
  .superRefine(({ activity, evidence }, context) => {
    const ownershipMatches =
      evidence.courseId === activity.courseId &&
      evidence.revisionId === activity.revisionId &&
      evidence.lessonId === activity.lessonId &&
      evidence.activityId === activity.id;
    if (!ownershipMatches) {
      context.addIssue({
        code: "custom",
        path: ["evidence"],
        message: "Evidence ownership does not match its Activity scope",
      });
    }
    if (expectedActivityTypeByEvidence[evidence.type] !== activity.type) {
      context.addIssue({
        code: "custom",
        path: ["evidence", "type"],
        message: "Evidence type does not belong to the Activity type",
      });
    }
  });
export type ActivityEvidenceOwnership = z.infer<
  typeof ActivityEvidenceOwnershipSchema
>;

export const ReviewItemOwnershipSchema = z
  .object({
    reviewItem: ReviewItemSchema,
    sourceEvidence: EvidenceFactSchema,
  })
  .strict()
  .superRefine(({ reviewItem, sourceEvidence }, context) => {
    if (
      reviewItem.sourceEvidenceId !== sourceEvidence.id ||
      reviewItem.courseId !== sourceEvidence.courseId ||
      reviewItem.revisionId !== sourceEvidence.revisionId
    ) {
      context.addIssue({
        code: "custom",
        path: ["reviewItem", "sourceEvidenceId"],
        message: "Review Item ownership does not match its source Evidence",
      });
    }
  });
export type ReviewItemOwnership = z.infer<typeof ReviewItemOwnershipSchema>;

export const StableIdentityEntityTypeSchema = z.enum([
  "course",
  "lesson",
  "activity",
  "source-snapshot",
  "knowledge-capsule",
]);
export type StableIdentityEntityType = z.infer<
  typeof StableIdentityEntityTypeSchema
>;

export const StableIdentityFingerprintSchema = z
  .object({
    entityType: StableIdentityEntityTypeSchema,
    courseId: CourseEntityIdSchema,
    revisionId: CourseEntityIdSchema.nullable(),
    stableId: StableCourseIdSchema,
    semanticHash: Sha256Schema,
  })
  .strict()
  .superRefine((identity, context) => {
    if (identity.entityType === "course" && identity.revisionId !== null) {
      context.addIssue({
        code: "custom",
        path: ["revisionId"],
        message: "Course stable identity is not revision-scoped",
      });
    }
    if (identity.entityType !== "course" && identity.revisionId === null) {
      context.addIssue({
        code: "custom",
        path: ["revisionId"],
        message: "This stable identity requires revision scope",
      });
    }
  });
export type StableIdentityFingerprint = z.infer<
  typeof StableIdentityFingerprintSchema
>;

function normalizedSha256(value: string): string {
  return value.startsWith("sha256:") ? value.slice("sha256:".length) : value;
}

export function hasStableIdentityReuseConflict(
  existingInput: StableIdentityFingerprint,
  candidateInput: StableIdentityFingerprint,
): boolean {
  const existing = StableIdentityFingerprintSchema.parse(existingInput);
  const candidate = StableIdentityFingerprintSchema.parse(candidateInput);
  return (
    existing.entityType === candidate.entityType &&
    existing.courseId === candidate.courseId &&
    existing.revisionId === candidate.revisionId &&
    existing.stableId === candidate.stableId &&
    normalizedSha256(existing.semanticHash) !==
      normalizedSha256(candidate.semanticHash)
  );
}

export const StableIdentityReuseInputSchema = z
  .object({
    existing: StableIdentityFingerprintSchema,
    candidate: StableIdentityFingerprintSchema,
  })
  .strict()
  .superRefine(({ existing, candidate }, context) => {
    if (hasStableIdentityReuseConflict(existing, candidate)) {
      context.addIssue({
        code: "custom",
        path: ["candidate", "semanticHash"],
        message:
          "A scoped stable ID cannot be reused for different semantic content",
      });
    }
  });
export type StableIdentityReuseInput = z.infer<
  typeof StableIdentityReuseInputSchema
>;

/**
 * The server-selected learning action exposed by a Course path.
 *
 * A resume action carries the stable Activity identity persisted in
 * learning_sessions.current_step. A start action intentionally does not name
 * an Activity because no immutable session snapshot exists until the lesson is
 * started.
 */
export const LearningPathNextActionSchema = z
  .discriminatedUnion("type", [
    z
      .object({
        type: z.literal("start"),
        lessonId: CourseEntityIdSchema,
      })
      .strict(),
    z
      .object({
        type: z.literal("resume"),
        lessonId: CourseEntityIdSchema,
        sessionId: CourseEntityIdSchema,
        currentStep: StableCourseIdSchema,
      })
      .strict(),
  ])
  .nullable();
export type LearningPathNextAction = z.infer<
  typeof LearningPathNextActionSchema
>;

export const LearningReviewQueueItemSchema = z
  .object({
    id: CourseEntityIdSchema,
    topic: ShortTextSchema,
    knowledgeNodeId: LearningKnowledgeNodeIdSchema,
    dimension: z.enum([
      "understanding",
      "explanation",
      "codeReading",
      "implementation",
      "debugging",
      "interview",
    ]),
    activityKind: z.enum(["recall", "correction"]),
    reasonCode: z.enum(["mistake", "low_mastery"]),
    dueAt: IsoDateTimeSchema,
    state: ReviewItemStatusSchema,
    isDue: z.boolean(),
    sessionId: CourseEntityIdSchema,
    activityId: CourseEntityIdSchema.nullable(),
    execution: z
      .object({
        id: CourseEntityIdSchema,
        type: z.literal("free-response"),
        schemaVersion: z.literal(1),
        activitySnapshotHash: Sha256Schema,
      })
      .strict()
      .nullable(),
  })
  .strict();
export type LearningReviewQueueItem = z.infer<
  typeof LearningReviewQueueItemSchema
>;

export const LearningReviewActivitySchema = z
  .object({
    executionId: CourseEntityIdSchema,
    schemaVersion: z.literal(1),
    activitySnapshotHash: Sha256Schema,
    executionContextHash: Sha256Schema,
    title: ShortTextSchema,
    description: TextSchema,
    prompt: TextSchema,
    dueAt: IsoDateTimeSchema,
    sourceEvidenceAt: IsoDateTimeSchema,
    sourceActivityType: UnitTypeSchema,
    dimension: z.enum([
      "understanding",
      "explanation",
      "codeReading",
      "implementation",
      "debugging",
      "interview",
    ]),
    activityKind: z.enum(["recall", "correction"]),
    reasonCode: z.enum(["mistake", "low_mastery"]),
    response: z
      .object({
        type: z.literal("free-response"),
        minimumLength: z.literal(1),
        maximumLength: z.literal(50_000),
      })
      .strict(),
  })
  .strict();
export type LearningReviewActivity = z.infer<
  typeof LearningReviewActivitySchema
>;

export const LearningReviewActivityResponseSchema = z
  .object({ activity: LearningReviewActivitySchema })
  .strict();
export type LearningReviewActivityResponse = z.infer<
  typeof LearningReviewActivityResponseSchema
>;

export const LearningReviewSubmissionSchema = z
  .object({
    operationId: CourseOperationIdSchema,
    executionContextHash: Sha256Schema,
    response: z
      .object({
        type: z.literal("free-response"),
        text: TextSchema,
      })
      .strict(),
  })
  .strict();
export type LearningReviewSubmission = z.infer<
  typeof LearningReviewSubmissionSchema
>;

export const LearningReviewSubmissionResponseSchema = z
  .object({
    idempotent: z.boolean(),
    completedReviewItemId: CourseEntityIdSchema,
    completionEvidenceId: CourseEntityIdSchema,
    nextReview: z
      .object({
        id: CourseEntityIdSchema,
        dueAt: IsoDateTimeSchema,
      })
      .strict(),
  })
  .strict();
export type LearningReviewSubmissionResponse = z.infer<
  typeof LearningReviewSubmissionResponseSchema
>;

export const LearningReviewsResponseSchema = z
  .object({
    asOf: IsoDateTimeSchema,
    reviews: z.array(LearningReviewQueueItemSchema).max(MAX_LIST_ITEMS),
  })
  .strict()
  .superRefine(({ asOf, reviews }, context) => {
    reviews.forEach((review, index) => {
      const expectedDue =
        review.state === "pending" &&
        Date.parse(review.dueAt) <= Date.parse(asOf);
      if (review.isDue !== expectedDue) {
        context.addIssue({
          code: "custom",
          path: ["reviews", index, "isDue"],
          message: "Review due state must match the server observation time",
        });
      }
    });
  });
export type LearningReviewsResponse = z.infer<
  typeof LearningReviewsResponseSchema
>;

export const LearningMistakeItemSchema = z
  .object({
    id: CourseEntityIdSchema,
    topic: ShortTextSchema,
    errorFamily: ShortTextSchema,
    occurrenceCount: z.number().int().positive().max(1_000_000),
    reviewAt: IsoDateTimeSchema,
    isDue: z.boolean(),
  })
  .strict();
export type LearningMistakeItem = z.infer<typeof LearningMistakeItemSchema>;

export const LearningMistakesResponseSchema = z
  .object({
    asOf: IsoDateTimeSchema,
    mistakes: z.array(LearningMistakeItemSchema).max(MAX_LIST_ITEMS),
  })
  .strict()
  .superRefine(({ asOf, mistakes }, context) => {
    mistakes.forEach((mistake, index) => {
      if (mistake.isDue && Date.parse(mistake.reviewAt) > Date.parse(asOf)) {
        context.addIssue({
          code: "custom",
          path: ["mistakes", index, "isDue"],
          message: "A future Correction cannot be due",
        });
      }
    });
  });
export type LearningMistakesResponse = z.infer<
  typeof LearningMistakesResponseSchema
>;
