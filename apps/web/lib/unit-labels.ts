import type { MessageKey } from "@/lib/i18n";

export type UnitType =
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

export type UnitStatus =
  "locked" | "ready" | "in_progress" | "completed" | "skipped";

export const unitTypeMessageKeys: Readonly<Record<UnitType, MessageKey>> = {
  briefing: "unit.type.briefing",
  study: "unit.type.study",
  recall: "unit.type.recall",
  "teacher-dialogue": "unit.type.teacherDialogue",
  quiz: "unit.type.quiz",
  "code-reading": "unit.type.codeReading",
  exercise: "unit.type.exercise",
  review: "unit.type.review",
  interview: "unit.type.interview",
  summary: "unit.type.summary",
  checkpoint: "unit.type.checkpoint",
  "spaced-review": "unit.type.spacedReview",
};

export const unitStatusMessageKeys: Readonly<Record<UnitStatus, MessageKey>> = {
  locked: "unit.status.locked",
  ready: "unit.status.ready",
  in_progress: "unit.status.inProgress",
  completed: "unit.status.completed",
  skipped: "unit.status.skipped",
};

export type UnitTypeLabel = keyof typeof unitTypeMessageKeys;

export type DepthLevel = "foundation" | "interview-ready" | "deep-dive";

export const depthMessageKeys: Readonly<Record<DepthLevel, MessageKey>> = {
  foundation: "unit.depth.foundation",
  "interview-ready": "unit.depth.interviewReady",
  "deep-dive": "unit.depth.deepDive",
};

export function depthMessageKey(depth: DepthLevel | string): MessageKey | null {
  return depth in depthMessageKeys
    ? depthMessageKeys[depth as DepthLevel]
    : null;
}

const sourceKindMessageKeys: Readonly<Record<string, MessageKey>> = {
  book: "source.book",
  documentation: "source.documentation",
  docs: "source.documentation",
  video: "source.video",
  article: "source.article",
  note: "source.note",
  "local-note": "source.note",
  course: "source.course",
  podcast: "source.podcast",
};

export function sourceKindMessageKey(kind: string): MessageKey | null {
  return sourceKindMessageKeys[kind] ?? null;
}

export const activityTone: Record<UnitType, string> = {
  briefing: "study",
  study: "study",
  recall: "recall",
  "teacher-dialogue": "teacher",
  quiz: "quiz",
  "code-reading": "code-reading",
  exercise: "practice",
  review: "review",
  interview: "interview",
  summary: "summary",
  checkpoint: "practice",
  "spaced-review": "practice",
};

export function activityColorClass(type: UnitType): string {
  return `text-activity-${activityTone[type]}`;
}

export function activitySurfaceClass(type: UnitType): string {
  return `bg-activity-${activityTone[type]}-surface`;
}

export function activityBorderClass(type: UnitType): string {
  return `border-activity-${activityTone[type]}/40`;
}
