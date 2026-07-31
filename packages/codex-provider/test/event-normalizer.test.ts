import { describe, expect, it } from "vitest";

import { CodexEventNormalizer } from "../src/event-normalizer.js";

describe("CodexEventNormalizer", () => {
  it("maps failed turns to an error followed by a failed terminal event", () => {
    const normalizer = new CodexEventNormalizer("session-1", {
      now: () => new Date("2026-07-31T18:00:00.000Z"),
    });

    expect(
      normalizer.normalize({
        method: "turn/completed",
        params: {
          threadId: "thread-1",
          turn: {
            id: "turn-1",
            status: "failed",
            error: { message: "Model failed" },
          },
        },
      }),
    ).toEqual([
      {
        type: "error",
        error: {
          code: "provider_error",
          message: "Model failed",
          retryable: false,
        },
        sessionId: "session-1",
        sequence: 0,
        timestamp: "2026-07-31T18:00:00.000Z",
      },
      {
        type: "session.completed",
        reason: "failed",
        sessionId: "session-1",
        sequence: 1,
        timestamp: "2026-07-31T18:00:00.000Z",
      },
    ]);
  });
});
