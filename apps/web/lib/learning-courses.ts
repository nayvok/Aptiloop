import { z } from "zod";

const courseRevisionHashSchema = z
  .string()
  .regex(/^(?:sha256:)?[0-9a-f]{64}$/u);

export const learningCourseCollectionSchema = z
  .object({
    courses: z.array(
      z
        .object({
          id: z.string(),
          stableId: z.string(),
          title: z.string(),
          description: z.string().nullable(),
          primaryLocale: z.string(),
          selected: z.boolean(),
          activeRevisionId: z.string().nullable(),
          currentSessionId: z.string().nullable(),
          revisions: z.array(
            z
              .object({
                id: z.string(),
                revisionNumber: z.number().int().positive(),
                status: z.enum(["draft", "published", "archived"]),
                branchKind: z.enum(["upstream", "personal"]),
                contentHash: courseRevisionHashSchema.nullable(),
                learningSummary: z
                  .object({
                    state: z.enum(["not-started", "in-progress", "completed"]),
                    completedLessons: z.number().int().nonnegative(),
                    totalLessons: z.number().int().nonnegative(),
                    progressPercent: z.number().int().min(0).max(100),
                    lastActivityAt: z.string().datetime().nullable(),
                  })
                  .strict(),
              })
              .strict(),
          ),
        })
        .strict(),
    ),
  })
  .strict();

export type LearningCourseCollection = z.infer<
  typeof learningCourseCollectionSchema
>;
export type LearningCourse = LearningCourseCollection["courses"][number];
export type LearningCourseRevision = LearningCourse["revisions"][number];
