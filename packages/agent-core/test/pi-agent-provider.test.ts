import { describe, expect, it, vi } from "vitest";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import {
  type AssistantMessage,
  type AuthInteraction,
  type Model,
  type Models,
  type CredentialStore,
} from "@earendil-works/pi-ai";

import {
  createOpenCodeZenPiAgentProvider,
  PiAgentProvider,
} from "../src/pi-agent-provider.js";
import { createCatalogPiAgentProvider } from "../src/pi-provider-catalog.js";

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
  it("exposes the pinned OpenCode Zen catalog without probing the network", async () => {
    const previousApiKey = process.env.OPENCODE_API_KEY;
    delete process.env.OPENCODE_API_KEY;
    try {
      const provider = createOpenCodeZenPiAgentProvider();
      await expect(provider.getStatus()).resolves.toMatchObject({
        providerId: "opencode",
        state: "authentication-required",
      });
      await expect(provider.listModels()).resolves.toContainEqual(
        expect.objectContaining({
          id: "deepseek-v4-flash-free",
          providerId: "opencode",
          available: false,
        }),
      );
    } finally {
      if (previousApiKey === undefined) delete process.env.OPENCODE_API_KEY;
      else process.env.OPENCODE_API_KEY = previousApiKey;
    }
  });

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

  it("delegates subscription login and logout through the scoped Pi model store", async () => {
    const models = fakeModels() as unknown as Omit<
      Models,
      "getProvider" | "login" | "logout"
    > & {
      getProvider: () => {
        id: string;
        auth: { oauth: { name: string } };
      };
      login: ReturnType<typeof vi.fn>;
      logout: ReturnType<typeof vi.fn>;
    };
    models.getProvider = () => ({
      id: "openai-codex",
      auth: { oauth: { name: "OpenAI subscription" } },
    });
    models.login = vi.fn(async () => ({
      type: "oauth" as const,
      access: "access-token",
      refresh: "refresh-token",
      expires: Date.now() + 60_000,
    }));
    models.logout = vi.fn(async () => undefined);
    const provider = new PiAgentProvider({
      models: models as unknown as Models,
      providerType: "openai-codex",
    });
    const interaction = {
      onEvent: vi.fn(),
      prompt: vi.fn(),
    } as unknown as AuthInteraction;

    await expect(provider.login("oauth", interaction)).resolves.toMatchObject({
      type: "oauth",
      access: "access-token",
    });
    expect(models.login).toHaveBeenCalledWith(
      "openai-codex",
      "oauth",
      interaction,
    );
    await provider.logout();
    expect(models.logout).toHaveBeenCalledWith("openai-codex", undefined);
  });

  it("builds a scoped custom HTTPS provider with exact configured models", async () => {
    const readCredential = vi.fn(async () => ({
      type: "api_key" as const,
      key: "custom-provider-secret",
    }));
    const credentials: CredentialStore = {
      read: readCredential,
      list: async () => [{ providerId: "custom", type: "api_key" }],
      modify: async (_providerId, operation) =>
        operation(await readCredential()),
      delete: async () => undefined,
    };
    const provider = createCatalogPiAgentProvider({
      catalogId: "custom-openai-compatible",
      connectionId: "conn:custom:reviewed",
      credentials,
      baseUrl: "https://inference.example.com/openai/v1",
      modelIds: ["reviewed-model"],
    });

    await expect(provider.getStatus()).resolves.toMatchObject({
      state: "degraded",
      capabilities: expect.arrayContaining(["streaming", "models"]),
    });
    await expect(provider.listModels()).resolves.toEqual([
      expect.objectContaining({
        id: "reviewed-model",
        available: true,
      }),
    ]);
    expect(readCredential).toHaveBeenCalled();
    expect(
      JSON.stringify({
        status: await provider.getStatus(),
        models: await provider.listModels(),
      }),
    ).not.toContain("custom-provider-secret");
  });

  it("does not treat ambient provider environment variables as managed credentials", async () => {
    const sentinel = "ambient-key-must-not-activate-managed-provider";
    const previous = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = sentinel;
    const readCredential = vi.fn(async () => undefined);
    const credentials: CredentialStore = {
      read: readCredential,
      list: async () => [],
      modify: async (_providerId, operation) => operation(undefined),
      delete: async () => undefined,
    };
    try {
      const provider = createCatalogPiAgentProvider({
        catalogId: "openai-api",
        connectionId: "conn:managed:without-credential",
        credentials,
      });

      await expect(provider.getStatus()).resolves.toMatchObject({
        state: "authentication-required",
      });
      await expect(provider.listModels()).resolves.toEqual(
        expect.arrayContaining([expect.objectContaining({ available: false })]),
      );
      expect(
        JSON.stringify({
          status: await provider.getStatus(),
          models: await provider.listModels(),
        }),
      ).not.toContain(sentinel);
      expect(readCredential).toHaveBeenCalled();
    } finally {
      if (previous === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previous;
    }
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
