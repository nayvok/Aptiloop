import { describe, expect, it } from "vitest";

import {
  activeCurriculumVersion,
  archivedLegacyCurriculumVersion,
  curriculum,
  draftRoadmapWeeks,
  foundationWeekV2,
  publishedCurriculumRevision2,
  publishedCurriculumV2,
  publishedCurriculumV3,
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
      publishedCurriculumV3.id,
    );
    expect(publishedCurriculumV2.parentVersionId).toBe(
      archivedLegacyCurriculumVersion.id,
    );
    expect(archivedLegacyCurriculumVersion.preservedExport).toBe(
      "weekOneCurriculum",
    );
    expect(activeCurriculumVersion.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(activeCurriculumVersion).toMatchObject({
      id: "curriculum-foundation-v2-r4",
      revision: 4,
      createdAt: "2026-08-02T00:00:00.000Z",
      publishedAt: "2026-08-02T00:00:00.000Z",
    });
    expect(publishedCurriculumRevision2).toMatchObject({
      id: "curriculum-foundation-v2-r2",
      revision: 2,
      parentVersionId: publishedCurriculumV2.id,
      contentHash:
        "920a36a5484ba88f01477a28a281fcc781935ef4124ef8ace7b689536d543427",
    });
    expect(publishedCurriculumV2).toMatchObject({
      id: "curriculum-foundation-v2-r1",
      revision: 1,
    });
    expect(publishedCurriculumV3).toMatchObject({
      id: "curriculum-foundation-v2-r3",
      revision: 3,
      parentVersionId: publishedCurriculumRevision2.id,
      contentHash:
        "7ee9586b13cd47d693d2d1ac354fa1c5c36651e580c375c382898784cd663262",
    });
    expect(activeCurriculumVersion.contentHash).not.toBe(
      publishedCurriculumRevision2.contentHash,
    );
    expect(activeCurriculumVersion.contentHash).not.toBe(
      publishedCurriculumV3.contentHash,
    );
  });

  it("rewrites the Day 1 briefing checklist in plain Russian and keeps revision 3 immutable", () => {
    const revisionThreeBriefing =
      publishedCurriculumV3.weeks[0]?.days[0]?.units[0];
    const revisionFourBriefing =
      activeCurriculumVersion.weeks[0]?.days[0]?.units[0];

    expect(revisionThreeBriefing?.checklist).toEqual([
      "Прочитать outcomes",
      "Зафиксировать out of scope",
      "Подготовить Zed для практики",
    ]);
    expect(revisionFourBriefing?.stableId).toBe(
      revisionThreeBriefing?.stableId,
    );
    expect(revisionFourBriefing?.checklist).toEqual([
      "Прочитать «Результат дня» — цели занятия",
      "Просмотреть «Вне занятия» — что сегодня не разбираем",
      "Открыть Zed и подготовить папку для практики",
    ]);
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

  it("publishes an executable single-choice quiz for every day", () => {
    const publishedDays = activeCurriculumVersion.weeks.flatMap(
      (week) => week.days,
    );

    for (const day of publishedDays) {
      const quiz = day.units.find((unit) => unit.type === "quiz");
      expect(quiz?.questions, `Day ${day.dayNumber} quiz`).toHaveLength(4);

      for (const question of quiz?.questions ?? []) {
        const optionIds = (question.options ?? []).map(
          (option) => option.stableId,
        );
        const answerKey =
          question.protectedEvaluation.correctOptionStableIds ?? [];

        expect(question.kind).toBe("multiple-choice");
        expect(optionIds.length).toBeGreaterThanOrEqual(3);
        expect(optionIds.length).toBeLessThanOrEqual(4);
        expect(new Set(optionIds).size).toBe(optionIds.length);
        expect(answerKey).toHaveLength(1);
        expect(optionIds).toContain(answerKey[0]);
      }
    }
  });

  it("publishes code separately from the code-reading question", () => {
    const publishedDays = activeCurriculumVersion.weeks.flatMap(
      (week) => week.days,
    );

    for (const day of publishedDays) {
      const reading = day.units.find((unit) => unit.type === "code-reading");
      const snippet = reading?.codeSnippet ?? "";

      expect(snippet, `Day ${day.dayNumber} code snippet`).toMatch(
        /\b(?:const|let|function|type|import|console|Promise|setTimeout)\b/,
      );
      expect(snippet).toMatch(/[{}();=]/);
      expect(snippet.trim().length).toBeGreaterThan(40);
      expect(snippet).not.toBe(reading?.description);
      for (const question of reading?.questions ?? []) {
        expect(snippet).not.toBe(question.prompt);
      }
    }
  });

  it("keeps every published day within its honest three-hour budget", () => {
    const publishedDays = activeCurriculumVersion.weeks.flatMap(
      (week) => week.days,
    );

    for (const day of publishedDays) {
      const unitMinutes = day.units.reduce(
        (total, unit) => total + unit.estimatedMinutes,
        0,
      );

      expect(day.estimatedMinutes, `Day ${day.dayNumber} estimate`).toBe(
        unitMinutes,
      );
      expect(unitMinutes, `Day ${day.dayNumber} budget`).toBeLessThanOrEqual(
        180,
      );
    }
  });

  it("preserves revision 2 estimates as immutable parent content", () => {
    const revisionTwoDays = publishedCurriculumRevision2.weeks.flatMap(
      (week) => week.days,
    );

    expect(revisionTwoDays.map((day) => day.estimatedMinutes)).toEqual([
      195, 215, 197, 197, 197, 215, 209,
    ]);
    expect(
      revisionTwoDays.map((day) =>
        day.units.map((unit) => unit.estimatedMinutes),
      ),
    ).toEqual([
      [8, 18, 20, 22, 24, 18, 15, 12, 15, 45, 15, 8],
      [8, 18, 18, 18, 18, 18, 15, 12, 15, 50, 15, 10],
      [8, 18, 18, 18, 18, 15, 12, 15, 50, 15, 10],
      [8, 18, 18, 18, 18, 15, 12, 15, 50, 15, 10],
      [8, 18, 18, 18, 18, 15, 12, 15, 50, 15, 10],
      [8, 18, 18, 18, 18, 18, 15, 12, 15, 50, 15, 10],
      [8, 18, 18, 18, 15, 12, 15, 50, 15, 5, 25, 10],
    ]);
  });

  it("keeps revision 2 scoped to the original Day 1 answer-key change", () => {
    const revisionTwoDays = publishedCurriculumRevision2.weeks.flatMap(
      (week) => week.days,
    );
    const dayOneQuiz = revisionTwoDays[0]?.units.find(
      (unit) => unit.type === "quiz",
    );

    expect(
      dayOneQuiz?.questions.map(
        (question) => question.protectedEvaluation.correctOptionStableIds,
      ),
    ).toEqual([["q1-b"], ["q2-b"], ["q3-b"], ["q4-b"]]);

    for (const day of revisionTwoDays) {
      const reading = day.units.find((unit) => unit.type === "code-reading");
      expect(reading?.codeSnippet).toBeUndefined();
      if (day.dayNumber === 1) continue;

      const quiz = day.units.find((unit) => unit.type === "quiz");
      expect(
        quiz?.questions.every(
          (question) =>
            question.options === undefined &&
            question.protectedEvaluation.correctOptionStableIds === undefined,
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
