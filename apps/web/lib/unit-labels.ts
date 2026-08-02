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

export const unitTypeLabels: Record<UnitType, string> = {
  briefing: "Брифинг",
  study: "Изучение",
  recall: "Воспроизведение по памяти",
  "teacher-dialogue": "Разбор с преподавателем",
  quiz: "Короткая проверка",
  "code-reading": "Чтение кода",
  exercise: "Практическое задание",
  review: "Проверка решения",
  interview: "Интервью",
  summary: "Итоги дня",
  checkpoint: "Контрольная точка",
  "spaced-review": "Интервальное повторение",
};

export const unitStatusLabels: Record<UnitStatus, string> = {
  locked: "Заблокировано",
  ready: "Доступно",
  in_progress: "Сейчас",
  completed: "Готово",
  skipped: "Пропущено",
};

export type UnitTypeLabel = keyof typeof unitTypeLabels;

export type DepthLevel = "foundation" | "interview-ready" | "deep-dive";

export const depthLabels: Record<DepthLevel, string> = {
  foundation: "Фундамент",
  "interview-ready": "Для собеседования",
  "deep-dive": "Углублённо",
};

export function depthLabel(depth: DepthLevel | string): string {
  if (depth in depthLabels) return depthLabels[depth as DepthLevel];
  return depth;
}

export const sourceKindLabels: Record<string, string> = {
  book: "Книга",
  documentation: "Документация",
  docs: "Документация",
  video: "Видео",
  article: "Статья",
  note: "Локальная заметка",
  "local-note": "Локальная заметка",
  course: "Курс",
  podcast: "Подкаст",
};

export function sourceKindLabel(kind: string): string {
  return sourceKindLabels[kind] ?? kind;
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

export const evidenceLabel = "Подтверждения навыка";
export const aiReadyLabel = "AI готов";
export const teacherReadyLabel = "Преподаватель готов";
