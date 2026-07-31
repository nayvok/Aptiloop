import { describe, expect, it } from "vitest";

import {
  AgentEventSchema,
  AgentRoleSchema,
  ReviewResultSchema,
} from "../src/index.js";

describe("shared contracts", () => {
  it("exposes all supported agent roles", () => {
    expect(AgentRoleSchema.options).toHaveLength(8);
  });

  it("rejects a passed review with an error finding", () => {
    const result = ReviewResultSchema.safeParse({
      status: "passed",
      summary: "Looks fine",
      findings: [
        {
          severity: "error",
          category: "correctness",
          message: "Broken",
          hintLevel: 1,
        },
      ],
      strengths: [],
      suggestedMasteryChanges: [],
    });
    expect(result.success).toBe(false);
  });

  it("validates normalized events", () => {
    expect(
      AgentEventSchema.parse({
        type: "message.delta",
        sessionId: "session-1",
        sequence: 0,
        timestamp: "2026-07-31T12:00:00.000Z",
        delta: "Hello",
      }),
    ).toMatchObject({ type: "message.delta", delta: "Hello" });
  });
});
