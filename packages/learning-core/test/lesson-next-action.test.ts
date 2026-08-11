import { describe, expect, it } from "vitest";

import { selectLessonNextAction } from "../src/lesson-next-action.js";

describe("Course lesson next action", () => {
  it("resumes the single persisted active session", () => {
    expect(
      selectLessonNextAction([
        { lessonId: "lesson-1", status: "completed", sessionId: null },
        {
          lessonId: "lesson-2",
          status: "in_progress",
          sessionId: "session-2",
        },
        { lessonId: "lesson-3", status: "locked", sessionId: null },
      ]),
    ).toEqual({
      type: "resume",
      lessonId: "lesson-2",
      sessionId: "session-2",
    });
  });

  it("starts the single available lesson", () => {
    expect(
      selectLessonNextAction([
        { lessonId: "lesson-1", status: "available", sessionId: null },
        { lessonId: "lesson-2", status: "locked", sessionId: null },
      ]),
    ).toEqual({ type: "start", lessonId: "lesson-1" });
  });

  it.each([
    {
      name: "multiple active lessons",
      progress: [
        {
          lessonId: "lesson-1",
          status: "in_progress" as const,
          sessionId: "session-1",
        },
        {
          lessonId: "lesson-2",
          status: "in_progress" as const,
          sessionId: "session-2",
        },
      ],
    },
    {
      name: "an active lesson without an active session",
      progress: [
        {
          lessonId: "lesson-1",
          status: "in_progress" as const,
          sessionId: null,
        },
      ],
    },
    {
      name: "multiple available lessons",
      progress: [
        {
          lessonId: "lesson-1",
          status: "available" as const,
          sessionId: null,
        },
        {
          lessonId: "lesson-2",
          status: "available" as const,
          sessionId: null,
        },
      ],
    },
    {
      name: "a stale session attached to an available lesson",
      progress: [
        {
          lessonId: "lesson-1",
          status: "available" as const,
          sessionId: "session-abandoned",
        },
      ],
    },
  ])("fails closed for $name", ({ progress }) => {
    expect(selectLessonNextAction(progress)).toBeNull();
  });
});
