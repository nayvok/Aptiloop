import { describe, expect, it } from "vitest";

import {
  createAgentEventNormalizer,
  normalizeAgentEvents,
} from "../src/event-normalizer.js";

describe("agent event normalizer", () => {
  it("maps provider aliases and assigns monotonic sequence numbers", () => {
    const events = normalizeAgentEvents("s1", [
      { type: "text-delta", text: "A" },
      { type: "content_block_delta", delta: "B" },
      { type: "done" },
    ]);
    expect(events.map((event) => event.type)).toEqual([
      "message.delta",
      "message.delta",
      "session.completed",
    ]);
    expect(events.map((event) => event.sequence)).toEqual([0, 1, 2]);
  });

  it("ignores malformed and unknown events", () => {
    const normalizer = createAgentEventNormalizer("s1");
    expect(normalizer.normalize(null)).toEqual([]);
    expect(normalizer.normalize({ type: "text-delta", text: 42 })).toEqual([]);
    expect(normalizer.normalize({ type: "unknown" })).toEqual([]);
  });
});
