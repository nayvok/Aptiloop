import { z } from "zod";

import { IdSchema, IsoDateTimeSchema } from "./dto.js";

const TextSchema = z.string().trim().min(1).max(50_000);
const ShortTextSchema = z.string().trim().min(1).max(500);
const StringListSchema = z.array(ShortTextSchema).max(500);

export const DepthLevelSchema = z.enum([
  "foundation",
  "interview-ready",
  "deep-dive",
]);
export type DepthLevel = z.infer<typeof DepthLevelSchema>;

export const CurriculumSourceKindSchema = z.enum([
  "documentation",
  "article",
  "video",
  "book",
  "course",
  "repository",
  "source-required",
]);
export type CurriculumSourceKind = z.infer<typeof CurriculumSourceKindSchema>;

export const CurriculumSourceSchema = z
  .object({
    id: IdSchema,
    title: ShortTextSchema,
    url: z.url().nullable(),
    kind: CurriculumSourceKindSchema,
    author: ShortTextSchema.optional(),
    description: TextSchema.optional(),
    chapter: ShortTextSchema.optional(),
    section: ShortTextSchema.optional(),
    timestamp: ShortTextSchema.optional(),
    required: z.boolean().default(true),
    estimatedMinutes: z.number().int().nonnegative().default(0),
    learningGoal: TextSchema.optional(),
    examplesToRepeat: StringListSchema.default([]),
  })
  .superRefine((source, context) => {
    if (source.kind !== "source-required" && source.url === null) {
      context.addIssue({
        code: "custom",
        path: ["url"],
        message: "Assigned curriculum sources require a URL",
      });
    }
  });
export type CurriculumSource = z.infer<typeof CurriculumSourceSchema>;

export const CurriculumVersionStatusSchema = z.enum([
  "draft",
  "published",
  "archived",
]);
export type CurriculumVersionStatus = z.infer<
  typeof CurriculumVersionStatusSchema
>;

export const UnitTypeSchema = z.enum([
  "briefing",
  "study",
  "recall",
  "teacher-dialogue",
  "quiz",
  "code-reading",
  "exercise",
  "review",
  "interview",
  "summary",
  "checkpoint",
  "spaced-review",
]);
export type UnitType = z.infer<typeof UnitTypeSchema>;

export const UnitStatusSchema = z.enum([
  "locked",
  "ready",
  "in_progress",
  "completed",
  "skipped",
]);
export type UnitStatus = z.infer<typeof UnitStatusSchema>;

export const UnitChecklistItemSchema = z.object({
  id: IdSchema,
  label: ShortTextSchema,
  required: z.boolean().default(true),
});
export type UnitChecklistItem = z.infer<typeof UnitChecklistItemSchema>;

export const QuestionKindSchema = z.enum([
  "explain",
  "compare",
  "predict-output",
  "find-bug",
  "multiple-choice",
  "design-choice",
]);
export type QuestionKind = z.infer<typeof QuestionKindSchema>;

export const UnitQuestionOptionSchema = z.object({
  id: IdSchema,
  label: ShortTextSchema,
});
export type UnitQuestionOption = z.infer<typeof UnitQuestionOptionSchema>;

export const UnitQuestionSchema = z
  .object({
    id: IdSchema,
    kind: QuestionKindSchema.default("explain"),
    prompt: TextSchema,
    options: z.array(UnitQuestionOptionSchema).default([]),
    /** Server-side answer key. Learner-facing repositories must redact it. */
    correctOptionIds: z.array(IdSchema).default([]),
    referenceAnswer: TextSchema.nullable().default(null),
    evaluationPoints: StringListSchema.default([]),
    commonMistakes: StringListSchema.default([]),
  })
  .superRefine((question, context) => {
    const optionIds = new Set<string>();
    question.options.forEach((option, index) => {
      if (optionIds.has(option.id)) {
        context.addIssue({
          code: "custom",
          path: ["options", index, "id"],
          message: `Duplicate question option ID: ${option.id}`,
        });
      }
      optionIds.add(option.id);
    });
    question.correctOptionIds.forEach((optionId, index) => {
      if (!optionIds.has(optionId)) {
        context.addIssue({
          code: "custom",
          path: ["correctOptionIds", index],
          message: `Correct option ID is not a public option: ${optionId}`,
        });
      }
    });
  });
export type UnitQuestion = z.infer<typeof UnitQuestionSchema>;

export const UnitCompletionCriterionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("acknowledgement") }),
  z.object({
    type: z.literal("checklist"),
    requiredItemIds: z.array(IdSchema).min(1),
  }),
  z.object({
    type: z.literal("attempts"),
    minimum: z.number().int().positive(),
  }),
  z.object({
    type: z.literal("dialogue"),
    minimumTurns: z.number().int().positive(),
    requiresRevision: z.boolean().default(false),
  }),
  z.object({
    type: z.literal("score"),
    minimum: z.number().min(0).max(1),
    minimumAttempts: z.number().int().positive().default(1),
  }),
  z.object({
    type: z.literal("fields"),
    required: z.array(ShortTextSchema).min(1),
  }),
  z.object({
    type: z.literal("exercise"),
    passingTestsRequired: z.boolean().default(true),
    acceptedReviewRequired: z.boolean().default(true),
  }),
  z.object({ type: z.literal("custom"), key: IdSchema }),
]);
export type UnitCompletionCriterion = z.infer<
  typeof UnitCompletionCriterionSchema
>;

export const UnitUnlockRuleSchema = z.object({
  type: z.literal("unit-completed"),
  unitId: IdSchema,
});
export type UnitUnlockRule = z.infer<typeof UnitUnlockRuleSchema>;

export const BriefingUnitPayloadSchema = z.object({
  type: z.literal("briefing"),
  scope: StringListSchema.default([]),
  /** What the day deliberately does not cover; shown to the learner in the briefing. */
  outOfScope: StringListSchema.default([]),
});
export const StudyUnitPayloadSchema = z.object({
  type: z.literal("study"),
  body: TextSchema.optional(),
});
export const RecallUnitPayloadSchema = z.object({
  type: z.literal("recall"),
  prompt: TextSchema,
});
export const TeacherDialogueUnitPayloadSchema = z.object({
  type: z.literal("teacher-dialogue"),
  openingPrompt: TextSchema,
  minimumTurns: z.number().int().positive().default(1),
  requiresRevision: z.boolean().default(true),
});
export const QuizUnitPayloadSchema = z.object({
  type: z.literal("quiz"),
  questionIds: z.array(IdSchema).min(1),
  minimumScore: z.number().min(0).max(1),
});
export const CodeReadingUnitPayloadSchema = z.object({
  type: z.literal("code-reading"),
  snippet: TextSchema,
});
export const ExerciseUnitPayloadSchema = z.object({
  type: z.literal("exercise"),
  exerciseId: IdSchema,
  acceptanceCriteria: StringListSchema.min(1),
  constraints: StringListSchema.default([]),
  template: TextSchema,
  testCommandId: IdSchema,
  hintPolicy: ShortTextSchema,
  reviewPolicy: ShortTextSchema,
});
export const ReviewUnitPayloadSchema = z.object({
  type: z.literal("review"),
  exerciseUnitId: IdSchema,
});
export const InterviewUnitPayloadSchema = z.object({
  type: z.literal("interview"),
  topics: StringListSchema.min(1),
});
export const SummaryUnitPayloadSchema = z.object({
  type: z.literal("summary"),
  prompts: StringListSchema.default([]),
});
export const CheckpointUnitPayloadSchema = z.object({
  type: z.literal("checkpoint"),
  label: ShortTextSchema,
});
export const SpacedReviewUnitPayloadSchema = z.object({
  type: z.literal("spaced-review"),
  topicIds: z.array(IdSchema).min(1),
});

export const UnitPayloadSchema = z.discriminatedUnion("type", [
  BriefingUnitPayloadSchema,
  StudyUnitPayloadSchema,
  RecallUnitPayloadSchema,
  TeacherDialogueUnitPayloadSchema,
  QuizUnitPayloadSchema,
  CodeReadingUnitPayloadSchema,
  ExerciseUnitPayloadSchema,
  ReviewUnitPayloadSchema,
  InterviewUnitPayloadSchema,
  SummaryUnitPayloadSchema,
  CheckpointUnitPayloadSchema,
  SpacedReviewUnitPayloadSchema,
]);
export type UnitPayload = z.infer<typeof UnitPayloadSchema>;

export const CurriculumUnitSchema = z
  .object({
    id: IdSchema,
    stableId: IdSchema,
    type: UnitTypeSchema,
    title: ShortTextSchema,
    description: TextSchema,
    order: z.number().int().positive(),
    estimatedMinutes: z.number().int().nonnegative(),
    objectives: StringListSchema,
    checklist: z.array(UnitChecklistItemSchema),
    sources: z.array(CurriculumSourceSchema),
    questions: z.array(UnitQuestionSchema),
    misconceptions: StringListSchema,
    referenceAnswer: TextSchema.nullable(),
    completionCriteria: z.array(UnitCompletionCriterionSchema).min(1),
    unlockRules: z.array(UnitUnlockRuleSchema),
    optional: z.boolean(),
    depthLevel: DepthLevelSchema,
    payload: UnitPayloadSchema,
  })
  .superRefine((unit, context) => {
    if (unit.type !== unit.payload.type) {
      context.addIssue({
        code: "custom",
        path: ["payload", "type"],
        message: "Unit payload type must match unit type",
      });
    }
  });
export type CurriculumUnit = z.infer<typeof CurriculumUnitSchema>;
export const UnitSchema = CurriculumUnitSchema;
export type Unit = CurriculumUnit;

function addUniqueIssues(
  values: readonly { readonly stableId: string; readonly order: number }[],
  context: z.RefinementCtx,
  path: string,
): void {
  const stableIds = new Set<string>();
  const orders = new Set<number>();
  values.forEach((value, index) => {
    if (stableIds.has(value.stableId)) {
      context.addIssue({
        code: "custom",
        path: [path, index, "stableId"],
        message: `Duplicate stable ID: ${value.stableId}`,
      });
    }
    if (orders.has(value.order)) {
      context.addIssue({
        code: "custom",
        path: [path, index, "order"],
        message: `Duplicate order: ${String(value.order)}`,
      });
    }
    stableIds.add(value.stableId);
    orders.add(value.order);
  });
}

export const CurriculumDaySchema = z
  .object({
    id: IdSchema,
    stableId: IdSchema,
    order: z.number().int().positive(),
    title: ShortTextSchema,
    description: TextSchema,
    goal: TextSchema,
    estimatedMinutes: z.number().int().positive(),
    prerequisites: z.array(IdSchema),
    expectedOutcomes: StringListSchema,
    depthLevel: DepthLevelSchema,
    outOfScope: StringListSchema,
    topics: StringListSchema,
    units: z.array(CurriculumUnitSchema).min(1),
  })
  .superRefine((day, context) => {
    addUniqueIssues(day.units, context, "units");
    const unitIds = new Set(day.units.map((unit) => unit.stableId));
    day.units.forEach((unit, unitIndex) => {
      unit.unlockRules.forEach((rule, ruleIndex) => {
        if (!unitIds.has(rule.unitId) || rule.unitId === unit.stableId) {
          context.addIssue({
            code: "custom",
            path: ["units", unitIndex, "unlockRules", ruleIndex, "unitId"],
            message: `Invalid unlock unit ID: ${rule.unitId}`,
          });
        }
      });
    });
  });
export type CurriculumDay = z.infer<typeof CurriculumDaySchema>;

const CurriculumWeekBaseSchema = z.object({
  id: IdSchema,
  stableId: IdSchema,
  order: z.number().int().positive(),
  title: ShortTextSchema,
  description: TextSchema,
});

export const CurriculumWeekSchema = CurriculumWeekBaseSchema.extend({
  days: z.array(CurriculumDaySchema).min(1),
}).superRefine((week, context) => {
  addUniqueIssues(week.days, context, "days");
});
export type CurriculumWeek = z.infer<typeof CurriculumWeekSchema>;

export const CurriculumVersionSchema = z
  .object({
    id: IdSchema,
    curriculumId: IdSchema,
    revision: z.number().int().positive(),
    parentVersionId: IdSchema.nullable(),
    status: CurriculumVersionStatusSchema,
    title: ShortTextSchema,
    description: TextSchema,
    contentHash: ShortTextSchema,
    createdAt: IsoDateTimeSchema,
    publishedAt: IsoDateTimeSchema.nullable(),
    archivedAt: IsoDateTimeSchema.nullable(),
    weeks: z.array(CurriculumWeekSchema),
  })
  .superRefine((version, context) => {
    addUniqueIssues(version.weeks, context, "weeks");
    if (version.status !== "draft" && version.publishedAt === null) {
      context.addIssue({
        code: "custom",
        path: ["publishedAt"],
        message: "Published and archived versions require publishedAt",
      });
    }
    if (version.status === "archived" && version.archivedAt === null) {
      context.addIssue({
        code: "custom",
        path: ["archivedAt"],
        message: "Archived versions require archivedAt",
      });
    }
  });
export type CurriculumVersion = z.infer<typeof CurriculumVersionSchema>;

export const CurriculumSchema = z.object({
  id: IdSchema,
  title: ShortTextSchema,
  description: TextSchema,
  versions: z.array(CurriculumVersionSchema),
});
export type Curriculum = z.infer<typeof CurriculumSchema>;

export const CurriculumSnapshotWeekSchema = z.object({
  id: IdSchema,
  stableId: IdSchema,
  order: z.number().int().positive(),
  title: ShortTextSchema,
  description: TextSchema.nullable(),
});
export type CurriculumSnapshotWeek = z.infer<
  typeof CurriculumSnapshotWeekSchema
>;

export const CurriculumSnapshotDaySchema = z.object({
  id: IdSchema,
  stableId: IdSchema,
  order: z.number().int().positive(),
  title: ShortTextSchema,
  description: TextSchema,
  goal: TextSchema,
  estimatedMinutes: z.number().int().positive(),
  prerequisites: z.array(IdSchema),
  expectedOutcomes: StringListSchema,
  depthLevel: DepthLevelSchema,
  outOfScope: StringListSchema,
  topics: StringListSchema,
});
export type CurriculumSnapshotDay = z.infer<typeof CurriculumSnapshotDaySchema>;

export const SessionSnapshotSchema = z.object({
  schemaVersion: z.number().int().positive(),
  contentHash: ShortTextSchema,
  curriculumId: IdSchema,
  curriculumVersionId: IdSchema,
  curriculumRevision: z.number().int().positive(),
  curriculumTitle: ShortTextSchema,
  week: CurriculumSnapshotWeekSchema,
  day: CurriculumSnapshotDaySchema,
  units: z.array(CurriculumUnitSchema).min(1),
  capturedAt: IsoDateTimeSchema,
});
export type SessionSnapshot = z.infer<typeof SessionSnapshotSchema>;
export const CurriculumSnapshotSchema = SessionSnapshotSchema;
export type CurriculumSnapshot = SessionSnapshot;
export const LearningSessionSnapshotSchema = SessionSnapshotSchema;
export type LearningSessionSnapshot = SessionSnapshot;

const ProgressBaseSchema = z.object({ type: UnitTypeSchema });
export const BriefingProgressPayloadSchema = ProgressBaseSchema.extend({
  type: z.literal("briefing"),
  acknowledged: z.boolean().default(false),
  checkedItemIds: z.array(IdSchema).default([]),
});
export const StudyProgressPayloadSchema = ProgressBaseSchema.extend({
  type: z.literal("study"),
  checkedItemIds: z.array(IdSchema).default([]),
  notes: z.string().max(50_000).default(""),
});
export const RecallProgressPayloadSchema = ProgressBaseSchema.extend({
  type: z.literal("recall"),
  answers: z
    .array(
      z.object({
        questionId: IdSchema,
        draft: z.string().max(50_000),
        firstAttemptId: IdSchema,
      }),
    )
    .default([]),
  // Kept for snapshots written before recall answers became question-scoped.
  draft: z.string().max(50_000).default(""),
  firstAttemptId: IdSchema.nullable().default(null),
});
export const TeacherDialogueProgressPayloadSchema = ProgressBaseSchema.extend({
  type: z.literal("teacher-dialogue"),
  conversationId: IdSchema.nullable().default(null),
  turnCount: z.number().int().nonnegative().default(0),
  revisionAttemptIds: z.array(IdSchema).default([]),
});
export const QuizProgressPayloadSchema = ProgressBaseSchema.extend({
  type: z.literal("quiz"),
  attemptedQuestionIds: z.array(IdSchema).default([]),
  correctQuestionIds: z.array(IdSchema).default([]),
  score: z.number().min(0).max(1).nullable().default(null),
});
export const CodeReadingProgressPayloadSchema = ProgressBaseSchema.extend({
  type: z.literal("code-reading"),
  prediction: z.string().max(50_000).default(""),
  explanation: z.string().max(50_000).default(""),
  verbalFix: z.string().max(50_000).default(""),
});
export const ExerciseProgressPayloadSchema = ProgressBaseSchema.extend({
  type: z.literal("exercise"),
  attemptId: IdSchema.nullable().default(null),
  latestTestRunId: IdSchema.nullable().default(null),
  latestReviewId: IdSchema.nullable().default(null),
});
export const ReviewProgressPayloadSchema = ProgressBaseSchema.extend({
  type: z.literal("review"),
  reviewId: IdSchema.nullable().default(null),
  reviewStatus: z
    .enum(["pending", "accepted", "changes_requested"])
    .nullable()
    .default(null),
  reviewedDiffHash: ShortTextSchema.nullable().default(null),
});
export const InterviewProgressPayloadSchema = ProgressBaseSchema.extend({
  type: z.literal("interview"),
  interviewSessionId: IdSchema.nullable().default(null),
  reportId: IdSchema.nullable().default(null),
});
export const SummaryProgressPayloadSchema = ProgressBaseSchema.extend({
  type: z.literal("summary"),
  summaryId: IdSchema.nullable().default(null),
});
export const CheckpointProgressPayloadSchema = ProgressBaseSchema.extend({
  type: z.literal("checkpoint"),
  acknowledged: z.boolean().default(false),
});
export const SpacedReviewProgressPayloadSchema = ProgressBaseSchema.extend({
  type: z.literal("spaced-review"),
  reviewedTopicIds: z.array(IdSchema).default([]),
});

export const UnitProgressPayloadSchema = z.discriminatedUnion("type", [
  BriefingProgressPayloadSchema,
  StudyProgressPayloadSchema,
  RecallProgressPayloadSchema,
  TeacherDialogueProgressPayloadSchema,
  QuizProgressPayloadSchema,
  CodeReadingProgressPayloadSchema,
  ExerciseProgressPayloadSchema,
  ReviewProgressPayloadSchema,
  InterviewProgressPayloadSchema,
  SummaryProgressPayloadSchema,
  CheckpointProgressPayloadSchema,
  SpacedReviewProgressPayloadSchema,
]);
export type UnitProgressPayload = z.infer<typeof UnitProgressPayloadSchema>;

export const UnitProgressSchema = z
  .object({
    unitId: IdSchema,
    unitType: UnitTypeSchema,
    status: UnitStatusSchema,
    payload: UnitProgressPayloadSchema,
    startedAt: IsoDateTimeSchema.nullable(),
    completedAt: IsoDateTimeSchema.nullable(),
    skippedAt: IsoDateTimeSchema.nullable(),
    updatedAt: IsoDateTimeSchema,
  })
  .superRefine((progress, context) => {
    if (progress.unitType !== progress.payload.type) {
      context.addIssue({
        code: "custom",
        path: ["payload", "type"],
        message: "Progress payload type must match unit type",
      });
    }
    if (progress.status === "in_progress" && progress.startedAt === null) {
      context.addIssue({
        code: "custom",
        path: ["startedAt"],
        message: "In-progress units require startedAt",
      });
    }
    if (progress.status === "completed" && progress.completedAt === null) {
      context.addIssue({
        code: "custom",
        path: ["completedAt"],
        message: "Completed units require completedAt",
      });
    }
    if (progress.status === "skipped" && progress.skippedAt === null) {
      context.addIssue({
        code: "custom",
        path: ["skippedAt"],
        message: "Skipped units require skippedAt",
      });
    }
  });
export type UnitProgress = z.infer<typeof UnitProgressSchema>;
