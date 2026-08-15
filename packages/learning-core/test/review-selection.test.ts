import { describe, expect, it } from "vitest";

import {
  fixedClock,
  selectReviewTopics,
  type ReviewTopic,
} from "../src/review-selection.js";

const clock = fixedClock("2026-07-10T12:00:00.000Z");

const baseTopic: ReviewTopic = {
  topicId: "closures",
  mastery: 3,
  confidence: 0.7,
  repeatedErrorCount: 0,
  nextReviewAt: "2026-07-10T12:00:00.000Z",
  lastReviewedAt: "2026-07-01T12:00:00.000Z",
};

describe("review topic selection", () => {
  it("uses the injected clock and includes a topic due exactly now", () => {
    const selected = selectReviewTopics([baseTopic], { limit: 1 }, clock);
    expect(selected).toHaveLength(1);
    expect(selected[0]?.due).toBe(true);
    expect(selected[0]?.reasons).toContain("due");
    expect(selected[0]?.reasons).not.toContain("overdue");
  });

  it("excludes future topics by default", () => {
    const future = { ...baseTopic, nextReviewAt: "2026-07-11T12:00:00.000Z" };
    expect(selectReviewTopics([future], { limit: 1 }, clock)).toEqual([]);
  });

  it("can fill from not-yet-due topics when explicitly requested", () => {
    const future = { ...baseTopic, nextReviewAt: "2026-07-11T12:00:00.000Z" };
    expect(
      selectReviewTopics([future], { limit: 1, includeNotDue: true }, clock)[0]
        ?.due,
    ).toBe(false);
  });

  it("prioritizes repeated errors over otherwise comparable due topics", () => {
    const selected = selectReviewTopics(
      [
        { ...baseTopic, topicId: "weak", mastery: 1.5 },
        {
          ...baseTopic,
          topicId: "repeat",
          mastery: 4.5,
          repeatedErrorCount: 2,
        },
      ],
      { limit: 2 },
      clock,
    );
    expect(selected.map((item) => item.topic.topicId)).toEqual([
      "repeat",
      "weak",
    ]);
    expect(selected[0]?.reasons).toContain("repeated_errors");
  });

  it("uses older review time and topic id as stable tie breakers", () => {
    const selected = selectReviewTopics(
      [
        {
          ...baseTopic,
          topicId: "z",
          lastReviewedAt: "2026-07-03T00:00:00.000Z",
        },
        { ...baseTopic, topicId: "b", lastReviewedAt: null },
        { ...baseTopic, topicId: "a", lastReviewedAt: null },
      ],
      { limit: 3 },
      clock,
    );
    expect(selected.map((item) => item.topic.topicId)).toEqual(["a", "b", "z"]);
  });

  it("uses portable code-unit ordering for equal-priority topic IDs", () => {
    const selected = selectReviewTopics(
      [
        { ...baseTopic, topicId: "ä" },
        { ...baseTopic, topicId: "z" },
      ],
      { limit: 2 },
      clock,
    );

    expect(selected.map((item) => item.topic.topicId)).toEqual(["z", "ä"]);
  });

  it("never mutates the input order", () => {
    const topics = [
      { ...baseTopic, topicId: "second", repeatedErrorCount: 0 },
      { ...baseTopic, topicId: "first", repeatedErrorCount: 2 },
    ];
    selectReviewTopics(topics, { limit: 2 }, clock);
    expect(topics.map((topic) => topic.topicId)).toEqual(["second", "first"]);
  });

  it("rejects duplicate topics and invalid values", () => {
    expect(() =>
      selectReviewTopics([baseTopic, baseTopic], { limit: 2 }, clock),
    ).toThrow("duplicate topicId");
    expect(() =>
      selectReviewTopics([{ ...baseTopic, mastery: 6 }], { limit: 1 }, clock),
    ).toThrow(RangeError);
    expect(() => selectReviewTopics([], { limit: -1 }, clock)).toThrow(
      RangeError,
    );
  });

  it("returns the same ranking for the same stable clock", () => {
    const topics = [
      baseTopic,
      { ...baseTopic, topicId: "promises", confidence: 0.2 },
    ];
    const first = selectReviewTopics(topics, { limit: 2 }, clock);
    const second = selectReviewTopics(topics, { limit: 2 }, clock);
    expect(second).toEqual(first);
  });
});
