import { foundationWeekV2, publishedCurriculumV2 } from "./version-2.js";
import type {
  VersionedCurriculumDay,
  VersionedCurriculumVersion,
  VersionedCurriculumWeek,
} from "./versioned-types.js";

const dayOneQuizAnswerKey: Readonly<Record<string, readonly string[]>> = {
  "w1d1-quiz-q1": ["q1-b"],
  "w1d1-quiz-q2": ["q2-b"],
  "w1d1-quiz-q3": ["q3-b"],
  "w1d1-quiz-q4": ["q4-b"],
};

const foundationWeekV3 = {
  ...foundationWeekV2,
  days: foundationWeekV2.days.map((day) =>
    day.stableId !== "w1d1-values-types-objects"
      ? day
      : {
          ...day,
          units: day.units.map((unit) =>
            unit.stableId !== "w1d1-u08-quiz"
              ? unit
              : {
                  ...unit,
                  questions: unit.questions.map((question) => ({
                    ...question,
                    protectedEvaluation: {
                      ...question.protectedEvaluation,
                      correctOptionStableIds:
                        dayOneQuizAnswerKey[question.stableId] ?? [],
                    },
                  })),
                },
          ),
        },
  ),
} satisfies VersionedCurriculumWeek;

/**
 * Revision 2 adds an explicit server-side answer key to the Day 1 quiz.
 * Revision 1 remains an immutable published parent and is never rewritten.
 */
export const activeCurriculumVersion = {
  ...publishedCurriculumV2,
  id: "curriculum-foundation-v2-r2",
  revision: 2,
  parentVersionId: publishedCurriculumV2.id,
  contentHash:
    "920a36a5484ba88f01477a28a281fcc781935ef4124ef8ace7b689536d543427",
  createdAt: "2026-08-01T00:00:00.000Z",
  publishedAt: "2026-08-01T00:00:00.000Z",
  weeks: [foundationWeekV3],
} satisfies VersionedCurriculumVersion;

export const publishedCurriculumV3 = activeCurriculumVersion;

export function getVersionedCurriculumDay(
  stableId: string,
): VersionedCurriculumDay | undefined {
  return activeCurriculumVersion.weeks
    .flatMap((week) => week.days)
    .find((day) => day.stableId === stableId);
}
