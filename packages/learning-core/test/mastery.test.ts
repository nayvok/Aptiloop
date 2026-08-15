import { describe, expect, it } from "vitest";

import {
  MASTERY_DIMENSIONS,
  applyMasteryEvidence,
  applyMasteryEvidenceBatch,
  createEmptyMasteryProfile,
  type MasteryEvidence,
  type MasteryProfile,
} from "../src/mastery.js";

const correctImplementation: MasteryEvidence = {
  id: "evidence-1",
  dimension: "implementation",
  type: "implementation",
  outcome: "correct",
  occurredAt: "2026-07-01T09:00:00.000Z",
  hintLevel: 0,
};

describe("deterministic mastery", () => {
  it("creates all six dimensions in the 0..5 range", () => {
    const profile = createEmptyMasteryProfile(2.5);
    expect(Object.keys(profile)).toEqual(MASTERY_DIMENSIONS);
    expect(Object.values(profile).every((state) => state.score === 2.5)).toBe(
      true,
    );
    expect(() => createEmptyMasteryProfile(5.1)).toThrow(RangeError);
  });

  it.each([
    ["recall", 0.488],
    ["explanation", 0.585],
    ["implementation", 0.65],
    ["interview", 0.553],
  ] as const)("weights correct %s evidence", (type, expectedDelta) => {
    const result = applyMasteryEvidence(createEmptyMasteryProfile(2), {
      ...correctImplementation,
      type,
    });
    expect(result.appliedDelta).toBe(expectedDelta);
  });

  it.each([
    [0, 0.65],
    [1, 0.553],
    [2, 0.455],
    [3, 0.358],
    [4, 0.26],
    [5, 0.163],
  ] as const)(
    "reduces positive credit at hint level %s",
    (hintLevel, expectedDelta) => {
      const result = applyMasteryEvidence(createEmptyMasteryProfile(2), {
        ...correctImplementation,
        hintLevel,
      });
      expect(result.appliedDelta).toBe(expectedDelta);
    },
  );

  it("does not soften incorrect evidence when a hint was used", () => {
    const noHint = applyMasteryEvidence(createEmptyMasteryProfile(2), {
      ...correctImplementation,
      outcome: "incorrect",
      hintLevel: 0,
    });
    const reference = applyMasteryEvidence(createEmptyMasteryProfile(2), {
      ...correctImplementation,
      outcome: "incorrect",
      hintLevel: 5,
    });
    expect(noHint.appliedDelta).toBe(-0.55);
    expect(reference.appliedDelta).toBe(-0.55);
  });

  it("penalizes recurrence of the same error, with a bounded penalty", () => {
    let profile = createEmptyMasteryProfile(4);
    const deltas: number[] = [];
    for (let occurrence = 1; occurrence <= 5; occurrence += 1) {
      const update = applyMasteryEvidence(profile, {
        ...correctImplementation,
        id: `error-${occurrence}`,
        outcome: "incorrect",
        errorKey: "mutates-input",
      });
      profile = update.profile;
      deltas.push(update.repeatedErrorPenalty);
    }
    expect(deltas).toEqual([0, 0.25, 0.5, 0.75, 0.75]);
    expect(profile.implementation.errorOccurrences["mutates-input"]).toBe(5);
  });

  it("does not treat distinct errors as repeated", () => {
    const first = applyMasteryEvidence(createEmptyMasteryProfile(3), {
      ...correctImplementation,
      outcome: "incorrect",
      errorKey: "error-a",
    });
    const second = applyMasteryEvidence(first.profile, {
      ...correctImplementation,
      id: "evidence-2",
      outcome: "incorrect",
      errorKey: "error-b",
    });
    expect(second.repeatedErrorPenalty).toBe(0);
  });

  it("caps mastery at 4 without two evidence types on different days", () => {
    const initial = createEmptyMasteryProfile(3.8);
    const first = applyMasteryEvidence(initial, correctImplementation);
    expect(first.profile.implementation.score).toBe(4);
    expect(first.cappedByEvidenceConstraint).toBe(true);

    const sameDayDifferentType = applyMasteryEvidence(first.profile, {
      ...correctImplementation,
      id: "evidence-2",
      type: "debugging",
      occurredAt: "2026-07-01T15:00:00.000Z",
    });
    expect(sameDayDifferentType.profile.implementation.score).toBe(4);
    expect(sameDayDifferentType.cappedByEvidenceConstraint).toBe(true);

    const secondDay = applyMasteryEvidence(sameDayDifferentType.profile, {
      ...correctImplementation,
      id: "evidence-3",
      type: "debugging",
      occurredAt: "2026-07-02T09:00:00.000Z",
    });
    expect(secondDay.profile.implementation.score).toBe(4.65);
    expect(secondDay.cappedByEvidenceConstraint).toBe(false);
  });

  it("does not count partial evidence toward the advanced mastery constraint", () => {
    const partial = applyMasteryEvidence(createEmptyMasteryProfile(3.9), {
      ...correctImplementation,
      outcome: "partial",
      type: "debugging",
    });
    expect(partial.profile.implementation.successfulEvidenceTypes).toEqual([]);
    expect(partial.profile.implementation.successfulEvidenceDays).toEqual([]);
  });

  it("clamps scores at both boundaries", () => {
    const atBottom = applyMasteryEvidence(createEmptyMasteryProfile(0.1), {
      ...correctImplementation,
      outcome: "incorrect",
    });
    expect(atBottom.profile.implementation.score).toBe(0);

    const qualified = withAdvancedEvidence(createEmptyMasteryProfile(4.9));
    const atTop = applyMasteryEvidence(qualified, {
      ...correctImplementation,
      id: "top",
      occurredAt: "2026-07-03T09:00:00.000Z",
    });
    expect(atTop.profile.implementation.score).toBe(5);
  });

  it("applies a batch in chronological order with a stable id tie-breaker", () => {
    const evidence: MasteryEvidence[] = [
      {
        ...correctImplementation,
        id: "b",
        outcome: "incorrect",
        errorKey: "same",
        occurredAt: "2026-07-02T09:00:00.000Z",
      },
      {
        ...correctImplementation,
        id: "a",
        outcome: "incorrect",
        errorKey: "same",
        occurredAt: "2026-07-01T09:00:00.000Z",
      },
    ];
    const result = applyMasteryEvidenceBatch(
      createEmptyMasteryProfile(3),
      evidence,
    );
    expect(result.implementation.score).toBe(1.65);
    expect(result.implementation.lastEvidenceAt).toBe(
      "2026-07-02T09:00:00.000Z",
    );
  });

  it("uses portable code-unit ordering for equal-time evidence IDs", () => {
    const occurredAt = "2026-07-01T09:00:00.000Z";
    const result = applyMasteryEvidenceBatch(createEmptyMasteryProfile(), [
      {
        ...correctImplementation,
        id: "ä",
        outcome: "correct",
        occurredAt,
      },
      {
        ...correctImplementation,
        id: "z",
        outcome: "incorrect",
        occurredAt,
      },
    ]);

    expect(result.implementation.score).toBe(0.65);
  });

  it("rejects malformed dates and empty error keys", () => {
    expect(() =>
      applyMasteryEvidence(createEmptyMasteryProfile(), {
        ...correctImplementation,
        occurredAt: "not-a-date",
      }),
    ).toThrow(TypeError);
    expect(() =>
      applyMasteryEvidence(createEmptyMasteryProfile(), {
        ...correctImplementation,
        outcome: "incorrect",
        errorKey: " ",
      }),
    ).toThrow(TypeError);
  });
});

function withAdvancedEvidence(profile: MasteryProfile): MasteryProfile {
  return {
    ...profile,
    implementation: {
      ...profile.implementation,
      successfulEvidenceTypes: ["implementation", "debugging"],
      successfulEvidenceDays: ["2026-07-01", "2026-07-02"],
    },
  };
}
