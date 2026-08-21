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
  exerciseAttempted: true,
  exerciseTestsPassed: true,
  reviewReceiptAccepted: true,
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

  it("derives implementation evidence only from trusted tests on an exercise attempt", () => {
    const cases = [
      {
        exerciseAttempted: true,
        exerciseTestsPassed: true,
        outcome: "correct",
      },
      {
        exerciseAttempted: true,
        exerciseTestsPassed: false,
        outcome: "partial",
      },
      {
        exerciseAttempted: false,
        exerciseTestsPassed: false,
        outcome: undefined,
      },
    ];

    for (const item of cases) {
      const summary = deriveDaySummary({
        ...baseInput,
        exerciseAttempted: item.exerciseAttempted,
        exerciseTestsPassed: item.exerciseTestsPassed,
        reviewReceiptAccepted: item.exerciseAttempted,
      });
      expect(
        summary.masteryEvidence.find(
          (evidence) => evidence.dimension === "implementation",
        )?.outcome,
      ).toBe(item.outcome);
    }
  });

  it("does not emit phantom implementation credit without an exercise attempt", () => {
    const summary = deriveDaySummary({
      ...baseInput,
      exerciseAttempted: false,
      exerciseTestsPassed: false,
      reviewReceiptAccepted: false,
    });

    expect(
      summary.masteryEvidence.some(
        (evidence) => evidence.dimension === "implementation",
      ),
    ).toBe(false);
    expect(summary.metrics.attemptedActivityCount).toBe(4);
  });

  it("treats a Reviewer receipt as participation without emitting correctness evidence", () => {
    const reviewed = deriveDaySummary(baseInput);
    const notReviewed = deriveDaySummary({
      ...baseInput,
      reviewReceiptAccepted: false,
    });

    expect(reviewed.masteryEvidence).toEqual(notReviewed.masteryEvidence);
    expect(reviewed.strengths).toEqual(notReviewed.strengths);
    expect(reviewed.gaps).toEqual(notReviewed.gaps);
    expect(reviewed.mistakeCandidates).toEqual(notReviewed.mistakeCandidates);
    expect(reviewed.metrics.attemptedActivityCount).toBe(
      notReviewed.metrics.attemptedActivityCount + 1,
    );
    expect(reviewed.metrics.reviewReceiptAccepted).toBe(true);
    expect(reviewed.metrics.reviewStatus).toBeNull();
    expect(reviewed.metrics.correctionCycleCount).toBe(0);
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
      reviewReceiptAccepted: false,
    });

    expect(summary.masteryEvidence).toEqual([]);
    expect(summary.metrics.evidenceCount).toBe(0);
    expect(summary.narrative).toEqual({
      key: "daySummary.narrative.noEvidence",
    });
  });

  it("emits locale-neutral presentation messages without authored prose", () => {
    const summary = deriveDaySummary({
      ...baseInput,
      quizScore: 0,
      exerciseTestsPassed: false,
      incorrectQuestionIds: ["question-1"],
    });
    const serialized = JSON.stringify(summary);

    expect(summary.narrative.key).toBe("daySummary.narrative.evidence");
    expect(summary.narrative.params).toMatchObject({
      evidenceCount: expect.any(Number),
      correctCount: expect.any(Number),
      partialCount: expect.any(Number),
      incorrectCount: expect.any(Number),
    });
    expect(
      summary.strengths.every((item) => item.key.startsWith("daySummary.")),
    ).toBe(true);
    expect(
      summary.gaps.every((item) => item.key.startsWith("daySummary.")),
    ).toBe(true);
    expect(serialized).not.toContain("Квиз");
    expect(serialized).not.toContain("подтверждений");
  });

  it("produces stable IDs, ordering, mistakes, and flashcards", () => {
    const input: DaySummaryInput = {
      ...baseInput,
      topicIds: ["values", "scope", "values"],
      quizScore: 0.4,
      incorrectQuestionIds: ["question-b", "question-a", "question-a"],
    };
    const first = deriveDaySummary(input);
    const second = deriveDaySummary(input);

    expect(first).toEqual(second);
    expect(new Set(first.masteryEvidence.map((item) => item.id)).size).toBe(
      first.masteryEvidence.length,
    );
    expect(first.metrics.topicCount).toBe(2);
    expect(first.mistakeCandidates).toHaveLength(2);
    expect(first.flashcardCandidates).toHaveLength(2);
    expect(first.mistakeCandidates.map((item) => item.sourceId)).toEqual([
      "question-a",
      "question-b",
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
      deriveDaySummary({ ...baseInput, occurredAt: "2026-08-01" }),
    ).toThrow(/occurredAt/);
    expect(() =>
      deriveDaySummary({ ...baseInput, topicIds: ["scope", " "] }),
    ).toThrow(/IDs/);
    expect(() =>
      deriveDaySummary({ ...baseInput, exerciseAttempted: false }),
    ).toThrow(/exerciseAttempted/);
  });
});
