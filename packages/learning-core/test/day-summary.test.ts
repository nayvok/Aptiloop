import { describe, expect, it } from "vitest";

import {
  applyMasteryEvidenceBatch,
  createEmptyMasteryProfile,
  deriveDaySummary,
  type DaySummaryInput,
} from "../src/index.js";

const baseInput: DaySummaryInput = {
  sessionId: "session-day-1",
  occurredAt: "2026-08-01T08:30:00.000Z",
  topicIds: ["scope", "values"],
  maxHintLevel: 0,
  recallAttempted: true,
  teacherRevision: true,
  quizScore: 0.75,
  incorrectQuestionIds: [],
  codeReadingAttempted: true,
  exerciseTestsPassed: true,
  reviewStatus: "passed",
  correctionCycleCount: 0,
};

describe("deriveDaySummary", () => {
  it.each([
    { score: 0.749, outcome: "partial" },
    { score: 0.75, outcome: "correct" },
    { score: 0.5, outcome: "partial" },
    { score: 0.499, outcome: "incorrect" },
  ] as const)(
    "classifies quiz score $score as $outcome",
    ({ score, outcome }) => {
      const summary = deriveDaySummary({ ...baseInput, quizScore: score });
      const quizEvidence = summary.masteryEvidence.filter((item) =>
        item.id.includes("day-summary-"),
      )[2];

      expect(quizEvidence?.outcome).toBe(outcome);
    },
  );

  it("keeps unverified recall, teacher revision, and code reading partial", () => {
    const summary = deriveDaySummary(baseInput);

    expect(
      summary.masteryEvidence
        .filter((item) => ["explanation", "code_reading"].includes(item.type))
        .map((item) => item.outcome),
    ).toEqual(["partial", "partial", "partial", "partial"]);
    expect(
      summary.masteryEvidence.filter(
        (item) => item.dimension === "understanding",
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "recall", outcome: "partial" }),
        expect.objectContaining({ type: "recall", outcome: "correct" }),
      ]),
    );
  });

  it("requires passed tests and passed review for correct implementation", () => {
    const cases = [
      {
        exerciseTestsPassed: true,
        reviewStatus: "passed" as const,
        outcome: "correct",
      },
      {
        exerciseTestsPassed: true,
        reviewStatus: null,
        outcome: "partial",
      },
      {
        exerciseTestsPassed: false,
        reviewStatus: "passed" as const,
        outcome: "partial",
      },
      {
        exerciseTestsPassed: true,
        reviewStatus: "changes_requested" as const,
        outcome: "incorrect",
      },
    ];

    for (const item of cases) {
      const summary = deriveDaySummary({
        ...baseInput,
        exerciseTestsPassed: item.exerciseTestsPassed,
        reviewStatus: item.reviewStatus,
      });
      expect(
        summary.masteryEvidence.find(
          (evidence) => evidence.dimension === "implementation",
        )?.outcome,
      ).toBe(item.outcome);
    }
  });

  it("credits debugging only after a correction cycle and accepted review", () => {
    const initialPass = deriveDaySummary(baseInput);
    const correctedPass = deriveDaySummary({
      ...baseInput,
      correctionCycleCount: 1,
    });
    const changesRequested = deriveDaySummary({
      ...baseInput,
      reviewStatus: "changes_requested",
      correctionCycleCount: 2,
    });
    const notReviewed = deriveDaySummary({
      ...baseInput,
      reviewStatus: null,
      correctionCycleCount: 2,
    });

    expect(debuggingOutcome(initialPass)).toBe("partial");
    expect(debuggingOutcome(correctedPass)).toBe("correct");
    expect(debuggingOutcome(changesRequested)).toBe("incorrect");
    expect(debuggingOutcome(notReviewed)).toBeUndefined();
  });

  it("passes the maximum hint level to every evidence item without changing outcomes", () => {
    const noHint = deriveDaySummary(baseInput);
    const withHint = deriveDaySummary({ ...baseInput, maxHintLevel: 5 });

    expect(withHint.masteryEvidence.every((item) => item.hintLevel === 5)).toBe(
      true,
    );
    expect(withHint.masteryEvidence.map((item) => item.outcome)).toEqual(
      noHint.masteryEvidence.map((item) => item.outcome),
    );

    const noHintProfile = applyMasteryEvidenceBatch(
      createEmptyMasteryProfile(),
      noHint.masteryEvidence,
    );
    const hintedProfile = applyMasteryEvidenceBatch(
      createEmptyMasteryProfile(),
      withHint.masteryEvidence,
    );
    expect(hintedProfile.implementation.score).toBeLessThan(
      noHintProfile.implementation.score,
    );
  });

  it("returns no evidence when no topics are available", () => {
    const summary = deriveDaySummary({
      ...baseInput,
      topicIds: [],
      recallAttempted: false,
      teacherRevision: false,
      codeReadingAttempted: false,
      reviewStatus: null,
    });

    expect(summary.masteryEvidence).toEqual([]);
    expect(summary.metrics.evidenceCount).toBe(0);
    expect(summary.narrative).toContain("пока нет подтверждений навыка");
  });

  it("produces stable IDs, ordering, mistakes, and flashcards", () => {
    const input: DaySummaryInput = {
      ...baseInput,
      topicIds: ["values", "scope", "values"],
      quizScore: 0.4,
      incorrectQuestionIds: ["question-b", "question-a", "question-a"],
      reviewStatus: "changes_requested",
    };
    const first = deriveDaySummary(input);
    const second = deriveDaySummary(input);

    expect(first).toEqual(second);
    expect(new Set(first.masteryEvidence.map((item) => item.id)).size).toBe(
      first.masteryEvidence.length,
    );
    expect(first.metrics.topicCount).toBe(2);
    expect(first.mistakeCandidates).toHaveLength(3);
    expect(first.flashcardCandidates).toHaveLength(2);
    expect(first.mistakeCandidates.map((item) => item.sourceId)).toEqual([
      "question-a",
      "question-b",
      "session-day-1",
    ]);
  });

  it("never accepts or emits answer text", () => {
    const summary = deriveDaySummary({
      ...baseInput,
      incorrectQuestionIds: ["question-1"],
      quizScore: 0,
    });
    const serialized = JSON.stringify(summary);

    expect(serialized).not.toContain("referenceAnswer");
    expect(serialized).not.toContain("correctAnswer");
  });

  it("validates score, hint, correction count, ISO instant, and identifiers", () => {
    expect(() => deriveDaySummary({ ...baseInput, quizScore: 1.01 })).toThrow(
      /quizScore/,
    );
    expect(() =>
      deriveDaySummary({ ...baseInput, maxHintLevel: 6 as 5 }),
    ).toThrow(/maxHintLevel/);
    expect(() =>
      deriveDaySummary({ ...baseInput, correctionCycleCount: -1 }),
    ).toThrow(/correctionCycleCount/);
    expect(() =>
      deriveDaySummary({ ...baseInput, occurredAt: "2026-08-01" }),
    ).toThrow(/occurredAt/);
    expect(() =>
      deriveDaySummary({ ...baseInput, topicIds: ["scope", " "] }),
    ).toThrow(/IDs/);
  });
});

function debuggingOutcome(
  summary: ReturnType<typeof deriveDaySummary>,
): string | undefined {
  return summary.masteryEvidence.find(
    (evidence) => evidence.dimension === "debugging",
  )?.outcome;
}
