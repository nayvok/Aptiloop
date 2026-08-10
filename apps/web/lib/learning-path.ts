import { z } from "zod";

const unitTypeSchema = z.enum([
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

const unitStatusSchema = z.enum([
  "locked",
  "ready",
  "in_progress",
  "completed",
  "skipped",
]);

const learnerUnitSchema = z
  .object({
    id: z.string().min(1),
    stableId: z.string().min(1),
    type: unitTypeSchema,
    order: z.number().int().positive(),
    title: z.string().min(1),
    description: z.string(),
    estimatedMinutes: z.number().int().nonnegative(),
    objectives: z.array(z.string()),
    checklist: z.array(
      z.object({
        id: z.string().min(1),
        label: z.string().min(1),
        required: z.boolean(),
      }),
    ),
    status: unitStatusSchema,
  })
  .passthrough();

export const learningPathSchema = z
  .object({
    curriculum: z
      .object({
        id: z.string().min(1),
        slug: z.string().min(1),
        title: z.string().min(1),
        description: z.string().nullable(),
        version: z.object({
          id: z.string().min(1),
          revision: z.number().int().positive(),
          contentHash: z.string().min(1),
          status: z.literal("published"),
        }),
        weeks: z.array(
          z.object({
            id: z.string().min(1),
            stableId: z.string().min(1),
            order: z.number().int().positive(),
            title: z.string().min(1),
            description: z.string().nullable(),
            days: z.array(
              z.object({
                id: z.string().min(1),
                stableId: z.string().min(1),
                order: z.number().int().positive(),
                title: z.string().min(1),
                description: z.string().min(1),
                goal: z.string().min(1),
                estimatedMinutes: z.number().int().nonnegative(),
                prerequisites: z.array(z.string()),
                expectedOutcomes: z.array(z.string()),
                depthLevel: z.enum([
                  "foundation",
                  "interview-ready",
                  "deep-dive",
                ]),
                outOfScope: z.array(z.string()),
                topics: z.array(z.string()),
                status: z.enum([
                  "completed",
                  "in_progress",
                  "available",
                  "locked",
                ]),
                sessionId: z.string().nullable(),
                units: z.array(learnerUnitSchema),
              }),
            ),
          }),
        ),
      })
      .nullable(),
  })
  .superRefine((value, context) => {
    const leak = findProtectedField(value);
    if (!leak) return;
    context.addIssue({
      code: "custom",
      path: leak.path,
      message: `Protected curriculum field received: ${leak.field}`,
    });
  });

export type LearningPath = z.infer<typeof learningPathSchema>;
export type LearningDay = NonNullable<
  LearningPath["curriculum"]
>["weeks"][number]["days"][number];

const protectedFieldNames = new Set([
  "referenceAnswer",
  "evaluationPoints",
  "correctOptionIds",
  "commonMistakes",
  "misconceptions",
  "protectedEvaluation",
]);

function findProtectedField(
  value: unknown,
  path: Array<string | number> = [],
): { field: string; path: Array<string | number> } | null {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findProtectedField(value[index], [...path, index]);
      if (found) return found;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;

  for (const [key, nestedValue] of Object.entries(value)) {
    if (protectedFieldNames.has(key)) {
      return { field: key, path: [...path, key] };
    }
    const found = findProtectedField(nestedValue, [...path, key]);
    if (found) return found;
  }
  return null;
}
