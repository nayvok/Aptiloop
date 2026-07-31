export interface UserRegisteredEvent {
  readonly type: "user.registered";
  readonly id: string;
  readonly occurredAt: string;
  readonly userId: string;
  readonly displayName: string;
}

export interface LessonCompletedEvent {
  readonly type: "lesson.completed";
  readonly id: string;
  readonly occurredAt: string;
  readonly userId: string;
  readonly lessonId: string;
  readonly score: number;
}

export interface ReviewScheduledEvent {
  readonly type: "review.scheduled";
  readonly id: string;
  readonly occurredAt: string;
  readonly userId: string;
  readonly topicId: string;
  readonly dueAt: string;
}

export type DomainEvent =
  UserRegisteredEvent | LessonCompletedEvent | ReviewScheduledEvent;

export type ParseResult =
  | { readonly ok: true; readonly event: DomainEvent }
  | { readonly ok: false; readonly issues: readonly string[] };

export function parseDomainEvent(_input: unknown): ParseResult {
  // TODO: доказать record-shaped форму, проверить discriminator и поля его ветки.
  return { ok: false, issues: ["TODO: parser is not implemented"] };
}

export function describeDomainEvent(event: DomainEvent): string {
  switch (event.type) {
    case "user.registered":
      throw new Error("TODO: describe user.registered");
    case "lesson.completed":
      throw new Error("TODO: describe lesson.completed");
    case "review.scheduled":
      throw new Error("TODO: describe review.scheduled");
    default:
      return assertNever(event);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unexpected event: ${String(value)}`);
}
