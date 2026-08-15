import { describe, expect, it, vi } from "vitest";

import { parseBrowserAgentEvent, streamAgent } from "@/lib/api";

const turnId = "turn-1";
const encoder = new TextEncoder();

function streamResponse(
  reads: Array<ReadableStreamReadResult<Uint8Array>>,
  options?: { cancel?: () => Promise<void> },
) {
  const reader = {
    read: vi.fn(async () => reads.shift() ?? { done: true, value: undefined }),
    cancel: vi.fn(options?.cancel ?? (async () => undefined)),
    releaseLock: vi.fn(),
  };
  const response = {
    ok: true,
    body: { getReader: () => reader },
  } as unknown as Response;

  return { reader, response };
}

describe("browser agent event parser", () => {
  it.each([
    { type: "message.delta", turnId, content: "часть" },
    { type: "message.completed", turnId, content: "полный ответ" },
    {
      type: "tool.summary",
      turnId,
      name: "lesson.readLearnerSafeContext",
      status: "started",
    },
    {
      type: "tool.summary",
      turnId,
      name: "lesson.readLearnerSafeContext",
      status: "completed",
    },
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
    JSON.stringify({
      type: "tool.summary",
      turnId,
      name: "shell",
      status: "started",
    }),
    JSON.stringify({
      type: "tool.summary",
      turnId,
      name: "lesson.readLearnerSafeContext",
      status: "completed",
      output: "private provider payload",
    }),
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
  it("cancels and releases the reader when a consumer stops after an event", async () => {
    const event = { type: "message.delta", turnId, content: "part" } as const;
    const { reader, response } = streamResponse([
      {
        done: false,
        value: encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
      },
    ]);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => response;

    try {
      const stream = streamAgent({ role: "teacher", message: "Explain" });
      for await (const received of stream) {
        expect(received).toEqual(event);
        break;
      }

      expect(reader.cancel).toHaveBeenCalledOnce();
      expect(reader.releaseLock).toHaveBeenCalledOnce();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("releases but does not cancel a naturally completed reader", async () => {
    const event = {
      type: "message.completed",
      turnId,
      content: "complete",
    } as const;
    const { reader, response } = streamResponse([
      {
        done: false,
        value: encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
      },
      { done: true, value: undefined },
    ]);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => response;

    try {
      const stream = streamAgent({ role: "teacher", message: "Explain" });
      const events = [];
      for await (const received of stream) {
        events.push(received);
      }
      expect(events).toEqual([event]);

      expect(reader.cancel).not.toHaveBeenCalled();
      expect(reader.releaseLock).toHaveBeenCalledOnce();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("keeps the invalid-event failure when reader cancellation fails", async () => {
    const { reader, response } = streamResponse(
      [
        {
          done: false,
          value: encoder.encode(
            `data: ${JSON.stringify({ type: "tool.started" })}\n\n`,
          ),
        },
      ],
      { cancel: async () => Promise.reject(new Error("cancel failed")) },
    );
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => response;

    try {
      const stream = streamAgent({ role: "teacher", message: "Explain" });
      await expect(stream.next()).rejects.toThrow(
        "Agent stream returned an invalid event",
      );

      expect(reader.cancel).toHaveBeenCalledOnce();
      expect(reader.releaseLock).toHaveBeenCalledOnce();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

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
