import { describe, expect, it } from "vitest";

import {
  activeCurriculumVersion,
  archivedLegacyCurriculumVersion,
  curriculum,
  draftRoadmapWeeks,
  foundationWeekV2,
  publishedCurriculumV2,
  toLearnerUnit,
  weekOneCurriculum,
} from "../src/index.js";

const allDays = foundationWeekV2.days;
const allUnits = allDays.flatMap((day) => day.units);

describe("published curriculum v2", () => {
  it("keeps the legacy export while publishing the new version", () => {
    expect(curriculum).toEqual([weekOneCurriculum]);
    expect(activeCurriculumVersion.status).toBe("published");
    expect(activeCurriculumVersion.title).toBe(
      "JavaScript, TypeScript и React: восстановление фундамента",
    );
    expect(activeCurriculumVersion.parentVersionId).toBe(
      publishedCurriculumV2.id,
    );
    expect(publishedCurriculumV2.parentVersionId).toBe(
      archivedLegacyCurriculumVersion.id,
    );
    expect(archivedLegacyCurriculumVersion.preservedExport).toBe(
      "weekOneCurriculum",
    );
    expect(activeCurriculumVersion.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(activeCurriculumVersion).toMatchObject({
      id: "curriculum-foundation-v2-r2",
      revision: 2,
      createdAt: "2026-08-01T00:00:00.000Z",
      publishedAt: "2026-08-01T00:00:00.000Z",
    });
    expect(publishedCurriculumV2).toMatchObject({
      id: "curriculum-foundation-v2-r1",
      revision: 1,
    });
    expect(activeCurriculumVersion.contentHash).not.toBe(
      publishedCurriculumV2.contentHash,
    );
  });

  it("uses stable unique IDs and consecutive authored order", () => {
    const dayIds = allDays.map((day) => day.stableId);
    const unitIds = allUnits.map((unit) => unit.stableId);

    expect(new Set(dayIds).size).toBe(dayIds.length);
    expect(new Set(unitIds).size).toBe(unitIds.length);
    expect(allDays.map((day) => day.order)).toEqual([1, 2, 3, 4, 5, 6, 7]);

    for (const day of allDays) {
      expect(day.units.map((unit) => unit.order)).toEqual(
        Array.from({ length: day.units.length }, (_, index) => index + 1),
      );
    }
  });

  it("chains every required unit to the previous required unit", () => {
    for (const day of allDays) {
      const [first, ...rest] = day.units;
      expect(first?.unlockRule).toEqual({
        kind: "day-start",
        requiredUnitStableIds: [],
      });

      rest.forEach((unit, index) => {
        expect(unit.required).toBe(true);
        expect(unit.unlockRule).toEqual({
          kind: "all-completed",
          requiredUnitStableIds: [day.units[index]?.stableId],
        });
      });
    }
  });

  it("contains the exact twelve-unit Day 1 vertical slice", () => {
    const day = allDays[0];
    expect(day?.units.map((unit) => unit.type)).toEqual([
      "briefing",
      "study",
      "study",
      "study",
      "study",
      "recall",
      "teacher-dialogue",
      "quiz",
      "code-reading",
      "exercise",
      "review",
      "summary",
    ]);
    expect(day?.units.map((unit) => unit.stableId)).toEqual([
      "w1d1-u01-briefing",
      "w1d1-u02-values-primitives",
      "w1d1-u03-null-undefined-truthiness",
      "w1d1-u04-objects-references-mutations",
      "w1d1-u05-equality-copy",
      "w1d1-u06-recall",
      "w1d1-u07-teacher-dialogue",
      "w1d1-u08-quiz",
      "w1d1-u09-code-reading",
      "w1d1-u10-exercise",
      "w1d1-u11-review",
      "w1d1-u12-summary",
    ]);
    expect(day?.outOfScope).toEqual(
      expect.arrayContaining([
        "hidden classes",
        "детали heap",
        "garbage collector internals",
      ]),
    );
  });

  it("provides the minimum authored content for every day", () => {
    const requiredFlow = [
      "briefing",
      "study",
      "recall",
      "teacher-dialogue",
      "quiz",
      "code-reading",
      "exercise",
      "review",
      "summary",
    ];

    for (const day of allDays) {
      const types = day.units.map((unit) => unit.type);
      requiredFlow.forEach((type) => expect(types).toContain(type));
      expect(day.goal.length).toBeGreaterThan(20);
      expect(day.expectedOutcomes.length).toBeGreaterThanOrEqual(3);
      if (day.dayNumber === 1) {
        expect(day.prerequisites).toEqual([]);
      } else {
        expect(day.prerequisites.length).toBeGreaterThan(0);
      }
      expect(day.depthLevel).toBe("interview-ready");
      expect(day.outOfScope.length).toBeGreaterThan(0);
      expect(day.topics.length).toBeGreaterThan(0);
      expect(day.misconceptions.length).toBeGreaterThan(0);
      expect(day.completionCriteria.length).toBeGreaterThan(0);

      const recall = day.units.find((unit) => unit.type === "recall");
      const quiz = day.units.find((unit) => unit.type === "quiz");
      const reading = day.units.find((unit) => unit.type === "code-reading");
      const exercise = day.units.find((unit) => unit.type === "exercise");
      expect(recall?.questions.length).toBeGreaterThanOrEqual(3);
      expect(quiz?.questions.length).toBeGreaterThanOrEqual(4);
      expect(reading?.questions.length).toBeGreaterThanOrEqual(1);
      expect(exercise?.exercise?.acceptanceCriteria.length).toBeGreaterThan(0);
      expect(exercise?.exercise?.hintPolicy).toBe("progressive-0-to-5");

      for (const unit of day.units) {
        expect(unit.completionCriteria.length).toBeGreaterThan(0);
      }
      for (const study of day.units.filter((unit) => unit.type === "study")) {
        expect(study.checklist.length).toBeGreaterThan(0);
        expect(study.sources.length).toBeGreaterThan(0);
        for (const source of study.sources) {
          expect(source.url).toMatch(/^https:\/\//);
          expect(source.learningGoal.length).toBeGreaterThan(0);
          expect(source.estimatedMinutes).toBeGreaterThan(0);
        }
      }
    }
  });

  it("keeps protected evaluation out of learner and interview context", () => {
    for (const unit of allUnits) {
      const authoredReferences = unit.questions.map(
        (item) => item.protectedEvaluation.referenceAnswer,
      );
      const learnerJson = JSON.stringify(toLearnerUnit(unit));

      expect(learnerJson).not.toContain("protectedEvaluation");
      expect(learnerJson).not.toContain("referenceAnswer");
      expect(learnerJson).not.toContain("correctOptionStableIds");
      authoredReferences.forEach((reference) =>
        expect(learnerJson).not.toContain(reference),
      );
    }
  });

  it("publishes Day 1 quiz choices without embedding correctness in options", () => {
    const quiz = activeCurriculumVersion.weeks[0]?.days[0]?.units.find(
      (unit) => unit.type === "quiz",
    );
    const publishedV2Quiz = publishedCurriculumV2.weeks[0]?.days[0]?.units.find(
      (unit) => unit.type === "quiz",
    );
    expect(
      publishedV2Quiz?.questions.every(
        (item) => item.protectedEvaluation.correctOptionStableIds === undefined,
      ),
    ).toBe(true);
    expect(quiz?.questions).toHaveLength(4);
    for (const item of quiz?.questions ?? []) {
      expect(item.kind).toBe("multiple-choice");
      expect(item.options).toHaveLength(3);
      const correctOptionStableIds =
        item.protectedEvaluation.correctOptionStableIds ?? [];
      expect(correctOptionStableIds).toHaveLength(1);
      expect(
        item.options?.every(
          (option) => Object.keys(option).sort().join(",") === "label,stableId",
        ),
      ).toBe(true);
      expect(
        item.options?.some((option) =>
          correctOptionStableIds.includes(option.stableId),
        ),
      ).toBe(true);
    }
  });

  it("defines the editable draft roadmap for weeks two through five", () => {
    expect(draftRoadmapWeeks.map((week) => week.weekNumber)).toEqual([
      2, 3, 4, 5,
    ]);
    expect(draftRoadmapWeeks.every((week) => week.status === "draft")).toBe(
      true,
    );
    expect(draftRoadmapWeeks[0]?.topics).toEqual(
      expect.arrayContaining(["Next.js", "HTTP", "authentication", "tests"]),
    );
    expect(draftRoadmapWeeks[3]?.topics).toEqual(
      expect.arrayContaining(["agents", "MCP", "RAG", "evals"]),
    );
  });
});
