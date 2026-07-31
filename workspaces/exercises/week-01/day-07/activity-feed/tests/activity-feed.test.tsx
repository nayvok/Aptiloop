import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  ActivityFeed,
  groupActivitiesByUtcDate,
  parseActivities,
  type Activity,
} from "../src";

const activities: readonly Activity[] = [
  {
    type: "lesson.completed",
    id: "activity-1",
    occurredAt: "2026-07-31T08:00:00.000Z",
    lessonTitle: "Closures",
  },
  {
    type: "answer.submitted",
    id: "activity-2",
    occurredAt: "2026-07-30T22:00:00.000Z",
    questionTitle: "Event loop",
    correct: false,
  },
  {
    type: "review.created",
    id: "activity-3",
    occurredAt: "2026-07-31T10:00:00.000Z",
    topicTitle: "Type narrowing",
  },
];

describe("parseActivities", () => {
  it("validates unknown input before returning domain activities", () => {
    expect(parseActivities(activities)).toEqual({ ok: true, activities });
  });

  it("rejects one invalid member instead of leaking a partial model", () => {
    const result = parseActivities([
      activities[0],
      { type: "answer.submitted", id: "bad", occurredAt: null, correct: "yes" },
    ]);

    expect(result.ok).toBe(false);
  });
});

describe("groupActivitiesByUtcDate", () => {
  it("groups duplicate dates stably without sorting the input", () => {
    const original = structuredClone(activities);
    const groups = groupActivitiesByUtcDate(activities);

    expect(groups.map((group) => group.date)).toEqual([
      "2026-07-31",
      "2026-07-30",
    ]);
    expect(groups[0]?.activities.map((activity) => activity.id)).toEqual([
      "activity-1",
      "activity-3",
    ]);
    expect(activities).toEqual(original);
  });

  it("returns an empty collection for an empty feed", () => {
    expect(groupActivitiesByUtcDate([])).toEqual([]);
  });
});

describe("ActivityFeed", () => {
  it("renders an honest empty state", () => {
    const markup = renderToStaticMarkup(<ActivityFeed activities={[]} />);
    expect(markup).toContain("Активности пока нет");
  });

  it("renders dates and branch-specific labels without derived state", () => {
    const markup = renderToStaticMarkup(
      <ActivityFeed activities={activities} />,
    );

    expect(markup).toContain("2026-07-31");
    expect(markup).toContain("Closures");
    expect(markup).toContain("Type narrowing");
  });
});
