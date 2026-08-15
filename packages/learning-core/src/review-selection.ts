export interface Clock {
  now(): Date;
}

export interface ReviewTopic {
  readonly topicId: string;
  readonly mastery: number;
  readonly confidence: number;
  readonly repeatedErrorCount: number;
  readonly nextReviewAt: string;
  readonly lastReviewedAt: string | null;
}

export interface ReviewSelectionOptions {
  readonly limit: number;
  readonly includeNotDue?: boolean;
}

export interface SelectedReviewTopic {
  readonly topic: ReviewTopic;
  readonly due: boolean;
  readonly priority: number;
  readonly reasons: readonly (
    "due" | "overdue" | "repeated_errors" | "low_mastery" | "low_confidence"
  )[];
}

const DAY_MS = 86_400_000;

export function fixedClock(instant: string | Date): Clock {
  const timestamp = parseInstant(instant);
  return { now: () => new Date(timestamp) };
}

/** Selects review work without consulting ambient wall-clock time. */
export function selectReviewTopics(
  topics: readonly ReviewTopic[],
  options: ReviewSelectionOptions,
  clock: Clock,
): SelectedReviewTopic[] {
  if (!Number.isInteger(options.limit) || options.limit < 0) {
    throw new RangeError("limit must be a non-negative integer");
  }
  const now = clock.now().getTime();
  if (!Number.isFinite(now))
    throw new TypeError("clock returned an invalid date");

  const seen = new Set<string>();
  const ranked = topics.map((topic) => {
    assertTopic(topic);
    if (seen.has(topic.topicId))
      throw new TypeError(`duplicate topicId: ${topic.topicId}`);
    seen.add(topic.topicId);

    const dueAt = parseInstant(topic.nextReviewAt);
    const due = dueAt <= now;
    const overdueDays = due
      ? Math.min(365, Math.floor((now - dueAt) / DAY_MS))
      : 0;
    const priority =
      (due ? 1_000 : 0) +
      overdueDays * 2 +
      topic.repeatedErrorCount * 100 +
      (5 - topic.mastery) * 20 +
      (1 - topic.confidence) * 50;
    const reasons: SelectedReviewTopic["reasons"] = [
      ...(dueAt < now ? (["overdue"] as const) : due ? (["due"] as const) : []),
      ...(topic.repeatedErrorCount > 0 ? (["repeated_errors"] as const) : []),
      ...(topic.mastery < 3 ? (["low_mastery"] as const) : []),
      ...(topic.confidence < 0.6 ? (["low_confidence"] as const) : []),
    ];
    return { topic, due, priority: round(priority), reasons };
  });

  return ranked
    .filter((candidate) => candidate.due || options.includeNotDue === true)
    .sort(
      (left, right) =>
        Number(right.due) - Number(left.due) ||
        right.priority - left.priority ||
        nullableInstant(left.topic.lastReviewedAt) -
          nullableInstant(right.topic.lastReviewedAt) ||
        compareStrings(left.topic.topicId, right.topic.topicId),
    )
    .slice(0, options.limit);
}

function assertTopic(topic: ReviewTopic): void {
  if (!topic.topicId.trim()) throw new TypeError("topicId must not be empty");
  if (
    !Number.isFinite(topic.mastery) ||
    topic.mastery < 0 ||
    topic.mastery > 5
  ) {
    throw new RangeError("mastery must be between 0 and 5");
  }
  if (
    !Number.isFinite(topic.confidence) ||
    topic.confidence < 0 ||
    topic.confidence > 1
  ) {
    throw new RangeError("confidence must be between 0 and 1");
  }
  if (
    !Number.isInteger(topic.repeatedErrorCount) ||
    topic.repeatedErrorCount < 0
  ) {
    throw new RangeError("repeatedErrorCount must be a non-negative integer");
  }
  parseInstant(topic.nextReviewAt);
  if (topic.lastReviewedAt !== null) parseInstant(topic.lastReviewedAt);
}

function nullableInstant(value: string | null): number {
  return value === null ? Number.NEGATIVE_INFINITY : parseInstant(value);
}

function parseInstant(value: string | Date): number {
  const parsed = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(parsed))
    throw new TypeError(`invalid date: ${String(value)}`);
  return parsed;
}

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
