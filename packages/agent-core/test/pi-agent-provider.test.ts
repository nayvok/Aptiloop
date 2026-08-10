import { describe, expect, it } from "vitest";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import {
  type AssistantMessage,
  type Model,
  type Models,
} from "@earendil-works/pi-ai";

import { PiAgentProvider } from "../src/pi-agent-provider.js";

const model: Model<"openai-responses"> = {
  id: "gpt-test",
  name: "GPT Test",
  api: "openai-responses",
  provider: "openai",
  baseUrl: "https://example.invalid/v1",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128_000,
  maxTokens: 16_000,
};

const usage = {
  input: 2,
  output: 1,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 3,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function fakeModels(): Models {
  const fake = {
    getProvider: (providerId: string) =>
      providerId === "openai" ? { id: "openai" } : undefined,
    checkAuth: async () => ({ type: "api_key" as const, source: "test" }),
    getModels: () => [model],
    getAvailable: async () => [model],
    streamSimple: () => {
      const partial: AssistantMessage = {
        role: "assistant",
        content: [],
        api: model.api,
        provider: model.provider,
        model: model.id,
        usage,
        stopReason: "pending",
        timestamp: 1,
      };
      const final: AssistantMessage = {
        ...partial,
        content: [{ type: "text", text: "Pi response" }],
        stopReason: "stop",
      };
      return {
        async *[Symbol.asyncIterator]() {
          yield { type: "start" as const, partial };
          yield { type: "text_start" as const, contentIndex: 0, partial };
          yield {
            type: "text_delta" as const,
            contentIndex: 0,
            delta: "Pi response",
            partial: final,
          };
          yield {
            type: "text_end" as const,
            contentIndex: 0,
            content: "Pi response",
            partial: final,
          };
          yield {
            type: "done" as const,
            reason: "stop" as const,
            message: final,
          };
        },
        async result() {
          return final;
        },
      };
    },
  };
  return fake as unknown as Models;
}

async function collect<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const events: T[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

describe("PiAgentProvider", () => {
  it("normalizes a Pi turn and only reports connected after an observed request", async () => {
    const provider = new PiAgentProvider({
      models: fakeModels(),
      providerType: "openai",
      now: () => new Date("2026-08-10T12:00:00.000Z"),
    });
    await expect(provider.getStatus()).resolves.toMatchObject({
      providerId: "pi",
      state: "degraded",
      message: expect.stringContaining("no authenticated request"),
    });
    await expect(provider.listModels()).resolves.toEqual([
      expect.objectContaining({
        id: "gpt-test",
        providerId: "pi",
        available: true,
      }),
    ]);

    const session = await provider.createSession({
      role: "reviewer",
      modelId: "gpt-test",
      systemPrompt: "Use only Aptiloop reviewer tools.",
    });
    const events = await collect(
      provider.streamMessage({
        sessionId: session.id,
        message: "Review the bounded evidence.",
        responseFormat: "text",
      }),
    );

    expect(events.map((event) => event.type)).toEqual([
      "message.delta",
      "message.completed",
      "session.completed",
    ]);
    expect(events[1]).toMatchObject({
      type: "message.completed",
      content: "Pi response",
    });
    await expect(provider.getStatus()).resolves.toMatchObject({
      state: "connected",
      message: expect.stringContaining("Last authenticated request succeeded"),
    });
  });

  it("rejects provider tools outside the Aptiloop role policy", async () => {
    const provider = new PiAgentProvider({
      models: fakeModels(),
      providerType: "openai",
      toolsForRole: () => [{ name: "bash" } as AgentTool],
    });

    await expect(
      provider.createSession({
        role: "reviewer",
        modelId: "gpt-test",
        systemPrompt: "Review only.",
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });
});
