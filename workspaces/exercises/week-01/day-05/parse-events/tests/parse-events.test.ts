import { describe, expect, it } from "vitest";

import { describeDomainEvent, parseDomainEvent } from "../src/parse-events";

describe("parseDomainEvent", () => {
  it("parses a fully validated user.registered event", () => {
    const result = parseDomainEvent({
      type: "user.registered",
      id: "evt-1",
      occurredAt: "2026-07-31T08:00:00.000Z",
      userId: "user-1",
      displayName: "Ada",
    });

    expect(result).toEqual({
      ok: true,
      event: {
        type: "user.registered",
        id: "evt-1",
        occurredAt: "2026-07-31T08:00:00.000Z",
        userId: "user-1",
        displayName: "Ada",
      },
    });
  });

  it("keeps score=0 instead of treating it as a missing value", () => {
    const result = parseDomainEvent({
      type: "lesson.completed",
      id: "evt-2",
      occurredAt: "2026-07-31T09:00:00.000Z",
      userId: "user-1",
      lessonId: "js-values",
      score: 0,
    });

    expect(result).toMatchObject({ ok: true, event: { score: 0 } });
  });

  it.each([
    null,
    [],
    { type: "unknown.event", id: "evt-3" },
    { type: "review.scheduled", id: 3, occurredAt: "now" },
  ])("rejects invalid input without throwing: %j", (input) => {
    expect(() => parseDomainEvent(input)).not.toThrow();
    expect(parseDomainEvent(input).ok).toBe(false);
  });

  it("does not accept inherited required fields", () => {
    const input = Object.create({ userId: "inherited" }) as Record<
      string,
      unknown
    >;
    Object.assign(input, {
      type: "user.registered",
      id: "evt-4",
      occurredAt: "2026-07-31T08:00:00.000Z",
      displayName: "Ada",
    });

    expect(parseDomainEvent(input).ok).toBe(false);
  });
});

describe("describeDomainEvent", () => {
  it("handles a parsed union branch", () => {
    expect(
      describeDomainEvent({
        type: "review.scheduled",
        id: "evt-5",
        occurredAt: "2026-07-31T08:00:00.000Z",
        userId: "user-1",
        topicId: "closures",
        dueAt: "2026-08-02T08:00:00.000Z",
      }),
    ).toContain("closures");
  });
});
