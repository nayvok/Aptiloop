import { describe, expect, it } from "vitest";

import { HINT_POLICIES, canAdvanceHint, getHintPolicy } from "../src/hints.js";

describe("hint policy", () => {
  it("defines a complete, increasingly revealing 0..5 scale", () => {
    expect(Object.keys(HINT_POLICIES)).toEqual(["0", "1", "2", "3", "4", "5"]);
    expect(
      Object.values(HINT_POLICIES).map(
        (policy) => policy.masteryCreditMultiplier,
      ),
    ).toEqual([1, 0.85, 0.7, 0.55, 0.4, 0.25]);
    expect(
      Object.values(HINT_POLICIES).filter((policy) => policy.revealsAnswer),
    ).toEqual([getHintPolicy(5)]);
  });

  it("requires an explicit learner request", () => {
    expect(
      canAdvanceHint({
        currentLevel: 0,
        unsuccessfulAttempts: 3,
        learnerRequestedHint: false,
      }),
    ).toEqual({ allowed: false, nextLevel: 0, reason: "hint_not_requested" });
  });

  it.each([
    [0, 0],
    [1, 1],
    [2, 2],
    [3, 3],
  ] as const)(
    "requires attempt %s before advancing from level %s",
    (attempts, level) => {
      expect(
        canAdvanceHint({
          currentLevel: level,
          unsuccessfulAttempts: attempts,
          learnerRequestedHint: true,
        }),
      ).toEqual({
        allowed: false,
        nextLevel: level,
        reason: "attempt_required",
      });
    },
  );

  it("advances one level and never skips ahead", () => {
    expect(
      canAdvanceHint({
        currentLevel: 1,
        unsuccessfulAttempts: 10,
        learnerRequestedHint: true,
      }),
    ).toEqual({ allowed: true, nextLevel: 2 });
  });

  it("locks the reference answer until explicitly allowed", () => {
    expect(
      canAdvanceHint({
        currentLevel: 4,
        unsuccessfulAttempts: 5,
        learnerRequestedHint: true,
      }),
    ).toEqual({ allowed: false, nextLevel: 4, reason: "reference_locked" });
    expect(
      canAdvanceHint({
        currentLevel: 4,
        unsuccessfulAttempts: 5,
        learnerRequestedHint: true,
        referenceAllowed: true,
      }),
    ).toEqual({ allowed: true, nextLevel: 5 });
  });

  it("does not advance beyond level 5", () => {
    expect(
      canAdvanceHint({
        currentLevel: 5,
        unsuccessfulAttempts: 99,
        learnerRequestedHint: true,
        referenceAllowed: true,
      }),
    ).toEqual({ allowed: false, nextLevel: 5, reason: "maximum_level" });
  });

  it("rejects invalid attempt counts", () => {
    expect(() =>
      canAdvanceHint({
        currentLevel: 0,
        unsuccessfulAttempts: -1,
        learnerRequestedHint: true,
      }),
    ).toThrow(RangeError);
  });
});
