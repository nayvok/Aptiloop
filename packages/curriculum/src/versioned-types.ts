export type VersionedCurriculumStatus = "draft" | "published" | "archived";

export type CurriculumDepthLevel =
  "foundation" | "interview-ready" | "deep-dive";

export type CurriculumUnitType =
  | "briefing"
  | "study"
  | "recall"
  | "teacher-dialogue"
  | "quiz"
  | "code-reading"
  | "exercise"
  | "review"
  | "interview"
  | "summary"
  | "checkpoint"
  | "spaced-review";

export type VersionedSourceKind =
  | "documentation"
  | "article"
  | "video"
  | "book"
  | "course"
  | "repository"
  | "source-required";

export interface VersionedCurriculumSource {
  readonly id: string;
  readonly title: string;
  readonly url: string | null;
  readonly kind: VersionedSourceKind;
  readonly required: boolean;
  readonly estimatedMinutes: number;
  readonly learningGoal: string;
  readonly examplesToRepeat: readonly string[];
  readonly note?: string;
}

export interface ProtectedQuestionEvaluation {
  /** Server-side evaluation material. Never include this object in learner/Teacher prompts before an attempt. */
  readonly referenceAnswer: string;
  readonly evaluationPoints: readonly string[];
}

export interface VersionedCurriculumQuestion {
  readonly stableId: string;
  readonly kind:
    | "explain"
    | "compare"
    | "predict-output"
    | "find-bug"
    | "multiple-choice"
    | "design-choice";
  readonly prompt: string;
  readonly options?: readonly {
    readonly stableId: string;
    readonly label: string;
  }[];
  readonly misconceptions: readonly string[];
  readonly protectedEvaluation: ProtectedQuestionEvaluation;
}

export interface UnitCompletionCriterion {
  readonly stableId: string;
  readonly description: string;
  readonly evidence:
    | "acknowledgement"
    | "checklist"
    | "written-attempt"
    | "dialogue-revision"
    | "quiz-score"
    | "code-reading-attempt"
    | "exercise-attempt"
    | "accepted-review"
    | "summary-commit";
  readonly minimum?: number;
}

export interface UnitUnlockRule {
  readonly kind: "day-start" | "all-completed";
  readonly requiredUnitStableIds: readonly string[];
}

export interface VersionedExercisePayload {
  readonly exerciseStableId: string;
  readonly workspacePath: string;
  readonly testCommandId: string;
  readonly brief: string;
  readonly acceptanceCriteria: readonly string[];
  readonly constraints: readonly string[];
  readonly hintPolicy: "progressive-0-to-5";
  readonly reviewPolicy: "diff-and-tests-read-only";
}

export interface VersionedCurriculumUnit {
  readonly stableId: string;
  readonly type: CurriculumUnitType;
  readonly order: number;
  readonly title: string;
  readonly description: string;
  readonly estimatedMinutes: number;
  readonly required: boolean;
  readonly depthLevel: CurriculumDepthLevel;
  readonly objectives: readonly string[];
  readonly checklist: readonly string[];
  readonly sources: readonly VersionedCurriculumSource[];
  readonly questions: readonly VersionedCurriculumQuestion[];
  readonly misconceptions: readonly string[];
  readonly completionCriteria: readonly UnitCompletionCriterion[];
  readonly unlockRule: UnitUnlockRule;
  readonly exercise?: VersionedExercisePayload;
}

export interface VersionedCurriculumDay {
  readonly stableId: string;
  readonly dayNumber: number;
  readonly order: number;
  readonly slug: string;
  readonly title: string;
  readonly description: string;
  readonly goal: string;
  readonly estimatedMinutes: number;
  readonly prerequisites: readonly string[];
  readonly expectedOutcomes: readonly string[];
  readonly depthLevel: CurriculumDepthLevel;
  readonly outOfScope: readonly string[];
  readonly topics: readonly string[];
  readonly misconceptions: readonly string[];
  readonly completionCriteria: readonly string[];
  readonly units: readonly VersionedCurriculumUnit[];
}

export interface VersionedCurriculumWeek {
  readonly stableId: string;
  readonly weekNumber: number;
  readonly order: number;
  readonly title: string;
  readonly description: string;
  readonly status: "published" | "draft";
  readonly days: readonly VersionedCurriculumDay[];
}

export interface DraftRoadmapWeek {
  readonly stableId: string;
  readonly weekNumber: number;
  readonly order: number;
  readonly status: "draft";
  readonly title: string;
  readonly topics: readonly string[];
}

export interface VersionedCurriculumVersion {
  readonly id: string;
  readonly curriculumId: string;
  readonly revision: number;
  readonly parentVersionId: string | null;
  readonly status: VersionedCurriculumStatus;
  readonly title: string;
  readonly description: string;
  readonly contentHash: string;
  readonly createdAt: string;
  readonly publishedAt: string | null;
  readonly archivedAt: string | null;
  readonly weeks: readonly VersionedCurriculumWeek[];
  readonly draftRoadmap: readonly DraftRoadmapWeek[];
}

export interface LegacyCurriculumVersionReference {
  readonly id: string;
  readonly curriculumId: string;
  readonly revision: number;
  readonly status: "archived";
  readonly title: string;
  readonly publishedAt: string;
  readonly archivedAt: string;
  readonly preservedExport: "weekOneCurriculum";
}

export type LearnerQuestion = Omit<
  VersionedCurriculumQuestion,
  "protectedEvaluation"
>;

export type LearnerUnit = Omit<VersionedCurriculumUnit, "questions"> & {
  readonly questions: readonly LearnerQuestion[];
};

export function toLearnerQuestion(
  question: VersionedCurriculumQuestion,
): LearnerQuestion {
  return {
    stableId: question.stableId,
    kind: question.kind,
    prompt: question.prompt,
    misconceptions: question.misconceptions,
    ...(question.options === undefined ? {} : { options: question.options }),
  };
}

/** Safe authored content for Study/Recall/Interview prompts before an answer is persisted. */
export function toLearnerUnit(unit: VersionedCurriculumUnit): LearnerUnit {
  return {
    ...unit,
    questions: unit.questions.map(toLearnerQuestion),
  };
}
