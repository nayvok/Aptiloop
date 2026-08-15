import { getHintPolicy, type HintLevel } from "./hints.js";

export const MASTERY_DIMENSIONS = [
  "understanding",
  "explanation",
  "codeReading",
  "implementation",
  "debugging",
  "interview",
] as const;

export type MasteryDimension = (typeof MASTERY_DIMENSIONS)[number];
export type EvidenceType =
  | "recall"
  | "explanation"
  | "code_reading"
  | "implementation"
  | "debugging"
  | "interview";
export type EvidenceOutcome = "incorrect" | "partial" | "correct";

export interface MasteryEvidence {
  readonly id: string;
  readonly dimension: MasteryDimension;
  readonly type: EvidenceType;
  readonly outcome: EvidenceOutcome;
  readonly occurredAt: string;
  readonly hintLevel: HintLevel;
  readonly errorKey?: string;
}

export interface MasteryDimensionState {
  readonly score: number;
  readonly successfulEvidenceTypes: readonly EvidenceType[];
  readonly successfulEvidenceDays: readonly string[];
  readonly errorOccurrences: Readonly<Record<string, number>>;
  readonly lastEvidenceAt: string | null;
}

export type MasteryProfile = Readonly<
  Record<MasteryDimension, MasteryDimensionState>
>;

export interface MasteryUpdate {
  readonly profile: MasteryProfile;
  readonly appliedDelta: number;
  readonly baseDelta: number;
  readonly repeatedErrorPenalty: number;
  readonly cappedByEvidenceConstraint: boolean;
}

const OUTCOME_DELTA: Readonly<Record<EvidenceOutcome, number>> = {
  incorrect: -0.55,
  partial: 0.2,
  correct: 0.65,
};

const EVIDENCE_WEIGHT: Readonly<Record<EvidenceType, number>> = {
  recall: 0.75,
  explanation: 0.9,
  code_reading: 0.9,
  implementation: 1,
  debugging: 1,
  interview: 0.85,
};

const SCORE_MIN = 0;
const SCORE_MAX = 5;
const ADVANCED_SCORE_THRESHOLD = 4;

export function createEmptyMasteryProfile(initialScore = 0): MasteryProfile {
  assertScore(initialScore);
  return Object.fromEntries(
    MASTERY_DIMENSIONS.map((dimension) => [
      dimension,
      {
        score: initialScore,
        successfulEvidenceTypes: [],
        successfulEvidenceDays: [],
        errorOccurrences: {},
        lastEvidenceAt: null,
      } satisfies MasteryDimensionState,
    ]),
  ) as unknown as MasteryProfile;
}

export function applyMasteryEvidence(
  profile: MasteryProfile,
  evidence: MasteryEvidence,
): MasteryUpdate {
  assertEvidence(evidence);
  const current = profile[evidence.dimension];
  assertDimensionState(current);

  const baseDelta = round(
    OUTCOME_DELTA[evidence.outcome] * EVIDENCE_WEIGHT[evidence.type],
  );
  const hintMultiplier = getHintPolicy(
    evidence.hintLevel,
  ).masteryCreditMultiplier;
  const positiveDelta = baseDelta > 0 ? baseDelta * hintMultiplier : baseDelta;

  const previousErrorCount = evidence.errorKey
    ? (current.errorOccurrences[evidence.errorKey] ?? 0)
    : 0;
  const isError =
    evidence.outcome !== "correct" && evidence.errorKey !== undefined;
  const repeatedErrorPenalty =
    isError && previousErrorCount > 0
      ? Math.min(0.25 * previousErrorCount, 0.75)
      : 0;

  const successfulEvidenceTypes =
    evidence.outcome === "correct"
      ? uniqueSorted([...current.successfulEvidenceTypes, evidence.type])
      : [...current.successfulEvidenceTypes];
  const evidenceDay = toUtcDay(evidence.occurredAt);
  const successfulEvidenceDays =
    evidence.outcome === "correct"
      ? uniqueSorted([...current.successfulEvidenceDays, evidenceDay])
      : [...current.successfulEvidenceDays];
  const errorOccurrences = { ...current.errorOccurrences };
  if (isError && evidence.errorKey) {
    errorOccurrences[evidence.errorKey] = previousErrorCount + 1;
  }

  const uncappedScore = clamp(
    current.score + positiveDelta - repeatedErrorPenalty,
    SCORE_MIN,
    SCORE_MAX,
  );
  const hasAdvancedEvidence =
    successfulEvidenceTypes.length >= 2 && successfulEvidenceDays.length >= 2;
  const cappedByEvidenceConstraint =
    uncappedScore > ADVANCED_SCORE_THRESHOLD && !hasAdvancedEvidence;
  const score = round(
    cappedByEvidenceConstraint ? ADVANCED_SCORE_THRESHOLD : uncappedScore,
  );

  const nextState: MasteryDimensionState = {
    score,
    successfulEvidenceTypes,
    successfulEvidenceDays,
    errorOccurrences,
    lastEvidenceAt: maxIsoInstant(current.lastEvidenceAt, evidence.occurredAt),
  };

  return {
    profile: { ...profile, [evidence.dimension]: nextState },
    appliedDelta: round(score - current.score),
    baseDelta,
    repeatedErrorPenalty,
    cappedByEvidenceConstraint,
  };
}

export function applyMasteryEvidenceBatch(
  profile: MasteryProfile,
  evidence: readonly MasteryEvidence[],
): MasteryProfile {
  const ordered = [...evidence].sort(
    (left, right) =>
      parseInstant(left.occurredAt) - parseInstant(right.occurredAt) ||
      compareStrings(left.id, right.id),
  );
  return ordered.reduce(
    (current, item) => applyMasteryEvidence(current, item).profile,
    profile,
  );
}

function assertEvidence(evidence: MasteryEvidence): void {
  if (!evidence.id.trim()) throw new TypeError("evidence.id must not be empty");
  parseInstant(evidence.occurredAt);
  if (evidence.errorKey !== undefined && !evidence.errorKey.trim()) {
    throw new TypeError("evidence.errorKey must not be empty");
  }
}

function assertDimensionState(state: MasteryDimensionState): void {
  assertScore(state.score);
  if (state.lastEvidenceAt !== null) parseInstant(state.lastEvidenceAt);
  for (const count of Object.values(state.errorOccurrences)) {
    if (!Number.isInteger(count) || count < 0) {
      throw new RangeError(
        "error occurrence counts must be non-negative integers",
      );
    }
  }
}

function assertScore(score: number): void {
  if (!Number.isFinite(score) || score < SCORE_MIN || score > SCORE_MAX) {
    throw new RangeError("mastery score must be between 0 and 5");
  }
}

function maxIsoInstant(previous: string | null, next: string): string {
  if (previous === null) return next;
  return parseInstant(previous) > parseInstant(next) ? previous : next;
}

function parseInstant(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed))
    throw new TypeError(`invalid ISO date: ${value}`);
  return parsed;
}

function toUtcDay(value: string): string {
  return new Date(parseInstant(value)).toISOString().slice(0, 10);
}

function uniqueSorted<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort();
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
