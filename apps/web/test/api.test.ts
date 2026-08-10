import { describe, expect, it } from "vitest";

import { parseBrowserAgentEvent, streamAgent } from "@/lib/api";

const turnId = "turn-1";

describe("browser agent event parser", () => {
  it.each([
    { type: "message.delta", turnId, content: "часть" },
    { type: "message.completed", turnId, content: "полный ответ" },
    { type: "error", turnId, message: "safe error" },
    { type: "session.completed", turnId, reason: "completed" },
    { type: "session.completed", turnId, reason: "failed" },
    { type: "session.completed", turnId, reason: "cancelled" },
  ])("accepts the strict $type variant", (event) => {
    expect(parseBrowserAgentEvent(JSON.stringify(event))).toEqual(event);
  });

  it.each([
    "not-json",
    JSON.stringify({ type: "tool.started", turnId, name: "shell" }),
    JSON.stringify({ type: "message.delta", turnId, content: 42 }),
    JSON.stringify({ type: "message.completed", content: "missing turn" }),
    JSON.stringify({
      type: "error",
      turnId,
      message: "safe error",
      raw: "private provider payload",
    }),
    JSON.stringify({
      type: "session.completed",
      turnId,
      reason: "unknown",
    }),
  ])("rejects malformed or unknown browser data", (data) => {
    expect(parseBrowserAgentEvent(data)).toBeNull();
  });
});

describe("agent event stream", () => {
  it("fails closed on an invalid event without exposing its payload", async () => {
    const privatePayload = "private-provider-payload";
    const response = new Response(
      `data: ${JSON.stringify({ type: "tool.started", privatePayload })}\n\n`,
      { status: 200 },
    );
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => response;
    try {
      const stream = streamAgent({ role: "teacher", message: "Explain" });
      await expect(stream.next()).rejects.toThrow(
        "Agent stream returned an invalid event",
      );
      await expect(stream.next()).resolves.toEqual({
        done: true,
        value: undefined,
      });
    } catch (error) {
      expect(String(error)).not.toContain(privatePayload);
      throw error;
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
