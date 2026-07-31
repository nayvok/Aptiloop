export type Activity =
  | {
      readonly type: "lesson.completed";
      readonly id: string;
      readonly occurredAt: string;
      readonly lessonTitle: string;
    }
  | {
      readonly type: "answer.submitted";
      readonly id: string;
      readonly occurredAt: string;
      readonly questionTitle: string;
      readonly correct: boolean;
    }
  | {
      readonly type: "review.created";
      readonly id: string;
      readonly occurredAt: string;
      readonly topicTitle: string;
    };

export type ParseActivitiesResult =
  | { readonly ok: true; readonly activities: readonly Activity[] }
  | { readonly ok: false; readonly issues: readonly string[] };

export function parseActivities(_input: unknown): ParseActivitiesResult {
  // TODO: проверить массив, discriminator и каждое поле выбранной ветки.
  return { ok: false, issues: ["TODO: parser is not implemented"] };
}
