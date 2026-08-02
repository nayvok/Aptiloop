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
  readonly exerciseTestsPassed: boolean;
  readonly reviewStatus: "passed" | "changes_requested" | null;
  readonly correctionCycleCount: number;
}

export interface MistakeCandidate {
  readonly fingerprint: string;
  readonly summary: string;
  readonly correction: string;
  readonly sourceId: string;
}

export interface FlashcardCandidate {
  readonly front: string;
  readonly back: string;
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
  readonly reviewStatus: "passed" | "changes_requested" | null;
  readonly correctionCycleCount: number;
}

export interface DaySummary {
  readonly sessionId: string;
  readonly occurredAt: string;
  readonly masteryEvidence: readonly DaySummaryMasteryEvidence[];
  readonly strengths: readonly string[];
  readonly gaps: readonly string[];
  readonly mistakeCandidates: readonly MistakeCandidate[];
  readonly flashcardCandidates: readonly FlashcardCandidate[];
  readonly narrative: string;
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
  const flashcardCandidates = mistakeCandidates
    .filter((candidate) => candidate.sourceId !== input.sessionId)
    .map((candidate) => ({
      front: "Восстановите правило, проверенное вопросом квиза.",
      back: "Сформулируйте правило своими словами и приведите собственный пример.",
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

  const debuggingOutcome = toDebuggingOutcome(input);
  if (debuggingOutcome !== null) {
    templates.push({
      activity: "debugging",
      dimension: "debugging",
      type: "debugging",
      outcome: debuggingOutcome,
      ...(debuggingOutcome === "correct"
        ? {}
        : { errorKey: "review-not-resolved" }),
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
): string[] {
  const strengths: string[] = [];
  if (quizOutcome === "correct") {
    strengths.push("Квиз пройден на уровне уверенного понимания.");
  }
  if (input.exerciseTestsPassed && input.reviewStatus === "passed") {
    strengths.push(
      "Реализация прошла разрешённые проверки и проверку решения.",
    );
  }
  if (input.correctionCycleCount > 0 && input.reviewStatus === "passed") {
    strengths.push("Замечания проверки решения устранены в цикле исправлений.");
  }
  return strengths;
}

function buildGaps(
  input: DaySummaryInput,
  quizOutcome: EvidenceOutcome,
): string[] {
  const gaps: string[] = [];
  if (input.recallAttempted) {
    gaps.push(
      "Воспроизведение по памяти выполнено, но его корректность отдельно не подтверждена.",
    );
  }
  if (input.teacherRevision) {
    gaps.push(
      "Объяснение уточнено после преподавателя, но остаётся частичным подтверждением навыка.",
    );
  }
  if (quizOutcome !== "correct") {
    gaps.push(
      quizOutcome === "partial"
        ? "Квиз показывает частичное понимание; ошибки нужно разобрать."
        : "Квиз показывает пробелы; тему нужно восстановить и проверить заново.",
    );
  }
  if (input.codeReadingAttempted) {
    gaps.push(
      "Чтение кода выполнено, но без отдельной проверки корректности засчитано частично.",
    );
  }
  if (!input.exerciseTestsPassed || input.reviewStatus !== "passed") {
    gaps.push(
      "Реализация ещё не подтверждена одновременно тестами и проверкой решения.",
    );
  }
  if (input.reviewStatus === "changes_requested") {
    gaps.push(
      "Проверка решения запросила изменения; нужен новый цикл исправления и проверки.",
    );
  } else if (
    input.reviewStatus === "passed" &&
    input.correctionCycleCount === 0
  ) {
    gaps.push(
      "Отдельное подтверждение навыка по debugging пока не подтверждено исправлением.",
    );
  }
  return gaps;
}

function buildMistakeCandidates(
  input: DaySummaryInput,
  questionIds: readonly string[],
): MistakeCandidate[] {
  const quizMistakes = questionIds.map((questionId) => ({
    fingerprint: `mistake-quiz-${fingerprint(questionId)}`,
    summary: "В квизе выбран неверный или неполный ответ.",
    correction:
      "Восстановить проверяемое правило своими словами и подтвердить новым примером.",
    sourceId: questionId,
  }));

  if (input.reviewStatus !== "changes_requested") return quizMistakes;
  return [
    ...quizMistakes,
    {
      fingerprint: `mistake-review-${fingerprint(input.sessionId)}`,
      summary: "Проверка решения запросила изменения в реализации.",
      correction:
        "Исправить замечания во внешнем редакторе, повторить разрешённые тесты и review.",
      sourceId: input.sessionId,
    },
  ];
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
      1 +
      Number(input.reviewStatus !== null),
    quizScore: input.quizScore,
    maxHintLevel: input.maxHintLevel,
    exerciseTestsPassed: input.exerciseTestsPassed,
    reviewStatus: input.reviewStatus,
    correctionCycleCount: input.correctionCycleCount,
  };
}

function buildNarrative(metrics: DaySummaryMetrics): string {
  if (metrics.evidenceCount === 0) {
    return "По занятию пока нет подтверждений навыка: темы для оценки не определены.";
  }
  return [
    `Собрано подтверждений навыка: ${metrics.evidenceCount}.`,
    `Подтверждено: ${metrics.correctEvidenceCount}.`,
    `Частично: ${metrics.partialEvidenceCount}.`,
    `Требует работы: ${metrics.incorrectEvidenceCount}.`,
  ].join(" ");
}

function toQuizOutcome(score: number): EvidenceOutcome {
  if (score >= 0.75) return "correct";
  if (score >= 0.5) return "partial";
  return "incorrect";
}

function toImplementationOutcome(input: DaySummaryInput): EvidenceOutcome {
  if (input.exerciseTestsPassed && input.reviewStatus === "passed") {
    return "correct";
  }
  if (input.reviewStatus === "changes_requested") return "incorrect";
  return "partial";
}

function toDebuggingOutcome(input: DaySummaryInput): EvidenceOutcome | null {
  if (input.reviewStatus === null) return null;
  if (input.reviewStatus === "changes_requested") return "incorrect";
  return input.correctionCycleCount > 0 ? "correct" : "partial";
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
    left.localeCompare(right, "en"),
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
    !Number.isInteger(input.correctionCycleCount) ||
    input.correctionCycleCount < 0
  ) {
    throw new RangeError("correctionCycleCount must be a non-negative integer");
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
