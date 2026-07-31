export type HintLevel = 0 | 1 | 2 | 3 | 4 | 5;

export interface HintPolicy {
  readonly level: HintLevel;
  readonly name:
    "none" | "reflection" | "direction" | "concept" | "scaffold" | "reference";
  readonly description: string;
  readonly revealsAnswer: boolean;
  readonly masteryCreditMultiplier: number;
}

export const HINT_POLICIES: Readonly<Record<HintLevel, HintPolicy>> = {
  0: {
    level: 0,
    name: "none",
    description: "No assistance was used.",
    revealsAnswer: false,
    masteryCreditMultiplier: 1,
  },
  1: {
    level: 1,
    name: "reflection",
    description:
      "Ask the learner to restate the goal or inspect their assumptions.",
    revealsAnswer: false,
    masteryCreditMultiplier: 0.85,
  },
  2: {
    level: 2,
    name: "direction",
    description:
      "Point to the relevant area without naming the missing concept.",
    revealsAnswer: false,
    masteryCreditMultiplier: 0.7,
  },
  3: {
    level: 3,
    name: "concept",
    description: "Name the relevant concept and ask the learner to apply it.",
    revealsAnswer: false,
    masteryCreditMultiplier: 0.55,
  },
  4: {
    level: 4,
    name: "scaffold",
    description:
      "Provide a partial structure or a closely related worked example.",
    revealsAnswer: false,
    masteryCreditMultiplier: 0.4,
  },
  5: {
    level: 5,
    name: "reference",
    description:
      "Show the reference explanation only after prior attempts are exhausted.",
    revealsAnswer: true,
    masteryCreditMultiplier: 0.25,
  },
};

export interface HintAdvanceInput {
  readonly currentLevel: HintLevel;
  readonly unsuccessfulAttempts: number;
  readonly learnerRequestedHint: boolean;
  readonly referenceAllowed?: boolean;
}

export type HintAdvanceDecision =
  | { readonly allowed: true; readonly nextLevel: HintLevel }
  | {
      readonly allowed: false;
      readonly nextLevel: HintLevel;
      readonly reason:
        | "hint_not_requested"
        | "attempt_required"
        | "reference_locked"
        | "maximum_level";
    };

export function getHintPolicy(level: HintLevel): HintPolicy {
  return HINT_POLICIES[level];
}

/**
 * Hints are deliberately progressive: every new level requires another failed
 * independent attempt. Level 5 additionally requires an explicit caller grant.
 */
export function canAdvanceHint(input: HintAdvanceInput): HintAdvanceDecision {
  if (
    !Number.isInteger(input.unsuccessfulAttempts) ||
    input.unsuccessfulAttempts < 0
  ) {
    throw new RangeError("unsuccessfulAttempts must be a non-negative integer");
  }

  if (input.currentLevel === 5) {
    return { allowed: false, nextLevel: 5, reason: "maximum_level" };
  }

  if (!input.learnerRequestedHint) {
    return {
      allowed: false,
      nextLevel: input.currentLevel,
      reason: "hint_not_requested",
    };
  }

  const nextLevel = (input.currentLevel + 1) as HintLevel;
  if (input.unsuccessfulAttempts < nextLevel) {
    return {
      allowed: false,
      nextLevel: input.currentLevel,
      reason: "attempt_required",
    };
  }

  if (nextLevel === 5 && input.referenceAllowed !== true) {
    return {
      allowed: false,
      nextLevel: input.currentLevel,
      reason: "reference_locked",
    };
  }

  return { allowed: true, nextLevel };
}
