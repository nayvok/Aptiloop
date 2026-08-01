import { z } from "zod";

const idSchema = z.string().trim().min(1).max(200);
const textSchema = z.string().trim().min(1).max(50_000);
const shortTextSchema = z.string().trim().min(1).max(500);
const stringListSchema = z.array(shortTextSchema).max(500);

export const DepthLevelSchema = z.enum([
  "foundation",
  "interview-ready",
  "deep-dive",
]);

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

export const UnitChecklistItemSchema = z.object({
  id: idSchema,
  label: shortTextSchema,
  required: z.boolean().default(true),
});

export const CurriculumSourceSchema = z
  .object({
    id: idSchema,
    title: shortTextSchema,
    url: z.url().nullable(),
    kind: z.enum([
      "documentation",
      "article",
      "video",
      "book",
      "course",
      "repository",
      "source-required",
    ]),
    author: shortTextSchema.optional(),
    description: textSchema.optional(),
    chapter: shortTextSchema.optional(),
    section: shortTextSchema.optional(),
    timestamp: shortTextSchema.optional(),
    required: z.boolean().default(true),
    estimatedMinutes: z.number().int().nonnegative().default(0),
    learningGoal: textSchema.optional(),
    examplesToRepeat: stringListSchema.default([]),
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

const questionOptionSchema = z.object({
  id: idSchema,
  label: shortTextSchema,
});

export const UnitQuestionSchema = z
  .object({
    id: idSchema,
    kind: z
      .enum([
        "explain",
        "compare",
        "predict-output",
        "find-bug",
        "multiple-choice",
        "design-choice",
      ])
      .default("explain"),
    prompt: textSchema,
    options: z.array(questionOptionSchema).default([]),
    correctOptionIds: z.array(idSchema).default([]),
    referenceAnswer: textSchema.nullable().default(null),
    evaluationPoints: stringListSchema.default([]),
    commonMistakes: stringListSchema.default([]),
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

export const UnitCompletionCriterionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("acknowledgement") }),
  z.object({
    type: z.literal("checklist"),
    requiredItemIds: z.array(idSchema).min(1),
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
    required: z.array(shortTextSchema).min(1),
  }),
  z.object({
    type: z.literal("exercise"),
    passingTestsRequired: z.boolean().default(true),
    acceptedReviewRequired: z.boolean().default(true),
  }),
  z.object({ type: z.literal("custom"), key: idSchema }),
]);

export const UnitUnlockRuleSchema = z.object({
  type: z.literal("unit-completed"),
  unitId: idSchema,
});

export const UnitPayloadSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("briefing"),
    scope: stringListSchema.default([]),
  }),
  z.object({ type: z.literal("study"), body: textSchema.optional() }),
  z.object({ type: z.literal("recall"), prompt: textSchema }),
  z.object({
    type: z.literal("teacher-dialogue"),
    openingPrompt: textSchema,
    minimumTurns: z.number().int().positive().default(1),
    requiresRevision: z.boolean().default(true),
  }),
  z.object({
    type: z.literal("quiz"),
    questionIds: z.array(idSchema).min(1),
    minimumScore: z.number().min(0).max(1),
  }),
  z.object({ type: z.literal("code-reading"), snippet: textSchema }),
  z.object({
    type: z.literal("exercise"),
    exerciseId: idSchema,
    acceptanceCriteria: stringListSchema.min(1),
    constraints: stringListSchema.default([]),
    template: textSchema,
    testCommandId: idSchema,
    hintPolicy: shortTextSchema,
    reviewPolicy: shortTextSchema,
  }),
  z.object({ type: z.literal("review"), exerciseUnitId: idSchema }),
  z.object({
    type: z.literal("interview"),
    topics: stringListSchema.min(1),
  }),
  z.object({
    type: z.literal("summary"),
    prompts: stringListSchema.default([]),
  }),
  z.object({ type: z.literal("checkpoint"), label: shortTextSchema }),
  z.object({
    type: z.literal("spaced-review"),
    topicIds: z.array(idSchema).min(1),
  }),
]);
