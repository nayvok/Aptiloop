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
  recall: "Воспроизведение",
  "teacher-dialogue": "Диалог с Teacher",
  quiz: "Квиз",
  "code-reading": "Чтение кода",
  exercise: "Упражнение",
  review: "Review",
  interview: "Интервью",
  summary: "Итоги",
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
