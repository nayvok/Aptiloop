import { describe, expect, it } from "vitest";

import { ReviewResultSchema } from "@dlh/shared";

import { MockAgentProvider } from "../src/mock-agent-provider.js";

const collect = async <T>(stream: AsyncIterable<T>): Promise<T[]> => {
  const values: T[] = [];
  for await (const value of stream) values.push(value);
  return values;
};

describe("MockAgentProvider", () => {
  it("streams a deterministic structured review", async () => {
    const provider = new MockAgentProvider({
      chunkSize: 7,
      now: () => new Date("2026-07-31T12:00:00.000Z"),
    });
    const session = await provider.createSession({
      role: "reviewer",
      modelId: "mock-deterministic",
      systemPrompt: "Review only",
    });
    const events = await collect(
      provider.streamMessage({
        sessionId: session.id,
        message: "Review this diff",
        responseFormat: "json",
      }),
    );
    const completed = events.find(
      (event) => event.type === "message.completed",
    );
    expect(completed?.type).toBe("message.completed");
    if (completed?.type === "message.completed")
      expect(
        ReviewResultSchema.parse(JSON.parse(completed.content)),
      ).toMatchObject({ status: "changes_requested" });
  });

  it("accepts a correction when server context records a prior review", async () => {
    const provider = new MockAgentProvider({ chunkSize: 1000 });
    const session = await provider.createSession({
      role: "reviewer",
      modelId: "mock-deterministic",
      systemPrompt: "Review only",
    });
    const events = await collect(
      provider.streamMessage({
        sessionId: session.id,
        message: JSON.stringify({ evidence: { priorReviewCount: 1 } }),
        responseFormat: "json",
      }),
    );
    const completed = events.find(
      (event) => event.type === "message.completed",
    );
    if (completed?.type !== "message.completed") {
      throw new Error("Mock review did not complete");
    }
    expect(
      ReviewResultSchema.parse(JSON.parse(completed.content)),
    ).toMatchObject({ status: "passed", findings: [] });
  });

  it("exposes deterministic error events", async () => {
    const provider = new MockAgentProvider();
    const session = await provider.createSession({
      role: "teacher",
      modelId: "mock-deterministic",
      systemPrompt: "Teach",
    });
    const events = await collect(
      provider.streamMessage({
        sessionId: session.id,
        message: "[[error]]",
        responseFormat: "text",
      }),
    );
    expect(events.map((event) => event.type)).toEqual([
      "error",
      "session.completed",
    ]);
  });

  it("asks a bounded interview question", async () => {
    const provider = new MockAgentProvider({ chunkSize: 1000 });
    const session = await provider.createSession({
      role: "interviewer",
      modelId: "mock-deterministic",
      systemPrompt: "Interview",
    });
    const events = await collect(
      provider.streamMessage({
        sessionId: session.id,
        message: "Start",
        responseFormat: "text",
      }),
    );
    const completed = events.find(
      (event) => event.type === "message.completed",
    );
    expect(completed).toMatchObject({
      type: "message.completed",
      content: expect.stringContaining("60 seconds"),
    });
  });
});
