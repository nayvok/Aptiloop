import { LearningPathNextActionSchema } from "@aptiloop/shared";
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
    nextAction: LearningPathNextActionSchema,
    courseContext: z
      .object({
        courseId: z.string().min(1),
        revisionId: z.string().min(1),
        selected: z.boolean(),
      })
      .nullable(),
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
    if (leak) {
      context.addIssue({
        code: "custom",
        path: leak.path,
        message: `Protected curriculum field received: ${leak.field}`,
      });
    }

    if (value.curriculum === null) {
      if (value.nextAction !== null) {
        context.addIssue({
          code: "custom",
          path: ["nextAction"],
          message: "A missing Course cannot expose a next action",
        });
      }
      return;
    }

    const days = value.curriculum.weeks.flatMap((week) => week.days);
    const action = value.nextAction;
    if (action === null) return;
    const matchingDays = days.filter((day) => day.id === action.lessonId);
    if (matchingDays.length !== 1) {
      context.addIssue({
        code: "custom",
        path: ["nextAction", "lessonId"],
        message: "The next action must identify exactly one Course lesson",
      });
      return;
    }
    const day = matchingDays[0]!;

    if (action.type === "start") {
      const availableDays = days.filter(
        (candidate) => candidate.status === "available",
      );
      if (
        day.status !== "available" ||
        day.sessionId !== null ||
        availableDays.length !== 1
      ) {
        context.addIssue({
          code: "custom",
          path: ["nextAction"],
          message:
            "A start action requires exactly one available lesson without an active session",
        });
      }
      return;
    }

    const currentDays = days.filter(
      (candidate) => candidate.status === "in_progress",
    );
    const matchingSteps = day.units.filter(
      (unit) => unit.stableId === action.currentStep,
    );
    if (
      day.status !== "in_progress" ||
      day.sessionId !== action.sessionId ||
      currentDays.length !== 1 ||
      matchingSteps.length !== 1 ||
      !["ready", "in_progress"].includes(matchingSteps[0]!.status)
    ) {
      context.addIssue({
        code: "custom",
        path: ["nextAction"],
        message:
          "A resume action must match the one active lesson, session, and persisted current step",
      });
    }
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
