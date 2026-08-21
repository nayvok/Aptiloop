import type {
  EvidenceOutcome,
  EvidenceType,
  MasteryDimension,
  MasteryEvidence,
} from "./mastery.js";
import type { HintLevel } from "./hints.js";

export interface DaySummaryInput {
  readonly sessionId: string;
  readonly occurredAt: string;
  readonly topicIds: readonly string[];
  readonly maxHintLevel: HintLevel;
  readonly recallAttempted: boolean;
  readonly teacherRevision: boolean;
  readonly quizScore: number;
  readonly incorrectQuestionIds: readonly string[];
  readonly codeReadingAttempted: boolean;
  readonly exerciseAttempted: boolean;
  readonly exerciseTestsPassed: boolean;
  /** A validated Reviewer receipt proves participation, never correctness. */
  readonly reviewReceiptAccepted: boolean;
}

export type DaySummaryMessageKey =
  | "daySummary.flashcard.ruleBack"
  | "daySummary.flashcard.ruleFront"
  | "daySummary.gap.codeReadingPartial"
  | "daySummary.gap.exerciseNotConfirmed"
  | "daySummary.gap.quizIncorrect"
  | "daySummary.gap.quizPartial"
  | "daySummary.gap.recallUnverified"
  | "daySummary.gap.teacherRevisionPartial"
  | "daySummary.legacy.untranslated"
  | "daySummary.mistake.quizCorrection"
  | "daySummary.mistake.quizSummary"
  | "daySummary.narrative.evidence"
  | "daySummary.narrative.noEvidence"
  | "daySummary.strength.exercisePassed"
  | "daySummary.strength.quizConfident";

/** A locale-neutral presentation directive resolved by the UI catalog. */
export interface DaySummaryMessage {
  readonly key: DaySummaryMessageKey;
  readonly params?: Readonly<Record<string, string | number>>;
}

export interface MistakeCandidate {
  readonly fingerprint: string;
  readonly summary: DaySummaryMessage;
  readonly correction: DaySummaryMessage;
  readonly sourceId: string;
}

export interface FlashcardCandidate {
  readonly front: DaySummaryMessage;
  readonly back: DaySummaryMessage;
  readonly sourceFingerprint?: string;
}

/** A topic-scoped evidence item that remains assignable to MasteryEvidence. */
export interface DaySummaryMasteryEvidence extends MasteryEvidence {
  readonly topicId: string;
}

export interface DaySummaryMetrics {
  readonly topicCount: number;
  readonly evidenceCount: number;
  readonly correctEvidenceCount: number;
  readonly partialEvidenceCount: number;
  readonly incorrectEvidenceCount: number;
  readonly attemptedActivityCount: number;
  readonly quizScore: number;
  readonly maxHintLevel: HintLevel;
  readonly exerciseTestsPassed: boolean;
  readonly reviewReceiptAccepted: boolean;
  /** @deprecated Reviewer output is advisory; retained as a fixed DTO field. */
  readonly reviewStatus: null;
  /** @deprecated Reviewer output is advisory; retained as a fixed DTO field. */
  readonly correctionCycleCount: 0;
}

export interface DaySummary {
  readonly sessionId: string;
  readonly occurredAt: string;
  readonly masteryEvidence: readonly DaySummaryMasteryEvidence[];
  readonly strengths: readonly DaySummaryMessage[];
  readonly gaps: readonly DaySummaryMessage[];
  readonly mistakeCandidates: readonly MistakeCandidate[];
  readonly flashcardCandidates: readonly FlashcardCandidate[];
  readonly narrative: DaySummaryMessage;
  readonly metrics: DaySummaryMetrics;
}

type ActivityKey =
  | "recall"
  | "teacher-revision"
  | "quiz"
  | "code-reading"
  | "implementation"
  | "debugging";

interface EvidenceTemplate {
  readonly activity: ActivityKey;
  readonly dimension: MasteryDimension;
  readonly type: EvidenceType;
  readonly outcome: EvidenceOutcome;
  readonly errorKey?: string;
}

/**
 * Derives a conservative, repeatable summary from persisted session facts.
 * It deliberately does not accept answer or reference-answer text.
 */
export function deriveDaySummary(input: DaySummaryInput): DaySummary {
  assertInput(input);

  const topicIds = uniqueSortedNonEmpty(input.topicIds);
  const questionIds = uniqueSortedNonEmpty(input.incorrectQuestionIds);
  const quizOutcome = toQuizOutcome(input.quizScore);
  const templates = buildEvidenceTemplates(input, quizOutcome);
  const masteryEvidence = topicIds.flatMap((topicId) =>
    templates.map((template) => toMasteryEvidence(input, topicId, template)),
  );

  const mistakeCandidates = buildMistakeCandidates(input, questionIds);
  const flashcardCandidates = mistakeCandidates.map((candidate) => ({
    front: message("daySummary.flashcard.ruleFront"),
    back: message("daySummary.flashcard.ruleBack"),
    sourceFingerprint: candidate.fingerprint,
  }));
  const strengths = buildStrengths(input, quizOutcome);
  const gaps = buildGaps(input, quizOutcome);
  const metrics = buildMetrics(input, topicIds.length, masteryEvidence);

  return {
    sessionId: input.sessionId,
    occurredAt: input.occurredAt,
    masteryEvidence,
    strengths,
    gaps,
    mistakeCandidates,
    flashcardCandidates,
    narrative: buildNarrative(metrics),
    metrics,
  };
}

function buildEvidenceTemplates(
  input: DaySummaryInput,
  quizOutcome: EvidenceOutcome,
): EvidenceTemplate[] {
  const templates: EvidenceTemplate[] = [];

  if (input.recallAttempted) {
    templates.push({
      activity: "recall",
      dimension: "understanding",
      type: "recall",
      outcome: "partial",
    });
  }
  if (input.teacherRevision) {
    templates.push({
      activity: "teacher-revision",
      dimension: "explanation",
      type: "explanation",
      outcome: "partial",
    });
  }
  templates.push({
    activity: "quiz",
    dimension: "understanding",
    type: "recall",
    outcome: quizOutcome,
    ...(quizOutcome === "correct" ? {} : { errorKey: "quiz-threshold" }),
  });
  if (input.codeReadingAttempted) {
    templates.push({
      activity: "code-reading",
      dimension: "codeReading",
      type: "code_reading",
      outcome: "partial",
    });
  }

  if (input.exerciseAttempted) {
    const implementationOutcome = toImplementationOutcome(input);
    templates.push({
      activity: "implementation",
      dimension: "implementation",
      type: "implementation",
      outcome: implementationOutcome,
      ...(implementationOutcome === "correct"
        ? {}
        : { errorKey: "implementation-not-verified" }),
    });
  }

  return templates;
}

function toMasteryEvidence(
  input: DaySummaryInput,
  topicId: string,
  template: EvidenceTemplate,
): DaySummaryMasteryEvidence {
  const stableSource = `${input.sessionId}\u0000${topicId}\u0000${template.activity}`;
  return {
    id: `day-summary-${fingerprint(stableSource)}`,
    dimension: template.dimension,
    type: template.type,
    outcome: template.outcome,
    occurredAt: input.occurredAt,
    hintLevel: input.maxHintLevel,
    topicId,
    ...(template.errorKey === undefined
      ? {}
      : { errorKey: `${template.errorKey}:${fingerprint(topicId)}` }),
  };
}

function buildStrengths(
  input: DaySummaryInput,
  quizOutcome: EvidenceOutcome,
): DaySummaryMessage[] {
  const strengths: DaySummaryMessage[] = [];
  if (quizOutcome === "correct") {
    strengths.push(message("daySummary.strength.quizConfident"));
  }
  if (input.exerciseTestsPassed) {
    strengths.push(message("daySummary.strength.exercisePassed"));
  }
  return strengths;
}

function buildGaps(
  input: DaySummaryInput,
  quizOutcome: EvidenceOutcome,
): DaySummaryMessage[] {
  const gaps: DaySummaryMessage[] = [];
  if (input.recallAttempted) {
    gaps.push(message("daySummary.gap.recallUnverified"));
  }
  if (input.teacherRevision) {
    gaps.push(message("daySummary.gap.teacherRevisionPartial"));
  }
  if (quizOutcome !== "correct") {
    gaps.push(
      quizOutcome === "partial"
        ? message("daySummary.gap.quizPartial")
        : message("daySummary.gap.quizIncorrect"),
    );
  }
  if (input.codeReadingAttempted) {
    gaps.push(message("daySummary.gap.codeReadingPartial"));
  }
  if (!input.exerciseTestsPassed) {
    gaps.push(message("daySummary.gap.exerciseNotConfirmed"));
  }
  return gaps;
}

function buildMistakeCandidates(
  input: DaySummaryInput,
  questionIds: readonly string[],
): MistakeCandidate[] {
  const quizMistakes = questionIds.map((questionId) => ({
    fingerprint: `mistake-quiz-${fingerprint(questionId)}`,
    summary: message("daySummary.mistake.quizSummary"),
    correction: message("daySummary.mistake.quizCorrection"),
    sourceId: questionId,
  }));

  return quizMistakes;
}

function buildMetrics(
  input: DaySummaryInput,
  topicCount: number,
  evidence: readonly MasteryEvidence[],
): DaySummaryMetrics {
  return {
    topicCount,
    evidenceCount: evidence.length,
    correctEvidenceCount: countOutcome(evidence, "correct"),
    partialEvidenceCount: countOutcome(evidence, "partial"),
    incorrectEvidenceCount: countOutcome(evidence, "incorrect"),
    attemptedActivityCount:
      Number(input.recallAttempted) +
      Number(input.teacherRevision) +
      1 +
      Number(input.codeReadingAttempted) +
      Number(input.exerciseAttempted) +
      Number(input.reviewReceiptAccepted),
    quizScore: input.quizScore,
    maxHintLevel: input.maxHintLevel,
    exerciseTestsPassed: input.exerciseTestsPassed,
    reviewReceiptAccepted: input.reviewReceiptAccepted,
    reviewStatus: null,
    correctionCycleCount: 0,
  };
}

function buildNarrative(metrics: DaySummaryMetrics): DaySummaryMessage {
  if (metrics.evidenceCount === 0) {
    return message("daySummary.narrative.noEvidence");
  }
  return message("daySummary.narrative.evidence", {
    evidenceCount: metrics.evidenceCount,
    correctCount: metrics.correctEvidenceCount,
    partialCount: metrics.partialEvidenceCount,
    incorrectCount: metrics.incorrectEvidenceCount,
  });
}

function message(
  key: DaySummaryMessageKey,
  params?: Record<string, string | number>,
): DaySummaryMessage {
  return params === undefined ? { key } : { key, params };
}

function toQuizOutcome(score: number): EvidenceOutcome {
  if (score >= 0.75) return "correct";
  if (score >= 0.5) return "partial";
  return "incorrect";
}

function toImplementationOutcome(input: DaySummaryInput): EvidenceOutcome {
  return input.exerciseTestsPassed ? "correct" : "partial";
}

function countOutcome(
  evidence: readonly MasteryEvidence[],
  outcome: EvidenceOutcome,
): number {
  return evidence.filter((item) => item.outcome === outcome).length;
}

function uniqueSortedNonEmpty(values: readonly string[]): string[] {
  const normalized = values.map((value) => value.trim());
  if (normalized.some((value) => value.length === 0)) {
    throw new TypeError("IDs must not be empty");
  }
  return [...new Set(normalized)].sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
}

function assertInput(input: DaySummaryInput): void {
  if (!input.sessionId.trim()) {
    throw new TypeError("sessionId must not be empty");
  }
  const parsedInstant = Date.parse(input.occurredAt);
  if (
    !Number.isFinite(parsedInstant) ||
    new Date(parsedInstant).toISOString() !== input.occurredAt
  ) {
    throw new TypeError("occurredAt must be an ISO instant");
  }
  if (
    !Number.isInteger(input.maxHintLevel) ||
    input.maxHintLevel < 0 ||
    input.maxHintLevel > 5
  ) {
    throw new RangeError("maxHintLevel must be an integer between 0 and 5");
  }
  if (
    !Number.isFinite(input.quizScore) ||
    input.quizScore < 0 ||
    input.quizScore > 1
  ) {
    throw new RangeError("quizScore must be between 0 and 1");
  }
  if (
    !input.exerciseAttempted &&
    (input.exerciseTestsPassed || input.reviewReceiptAccepted)
  ) {
    throw new TypeError(
      "exercise results require exerciseAttempted to be true",
    );
  }
}

// FNV-1a over UTF-16 code units is sufficient for stable local identifiers.
function fingerprint(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).padStart(7, "0");
}
