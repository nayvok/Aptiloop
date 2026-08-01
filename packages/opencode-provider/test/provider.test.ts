import type { Event, Part } from "@opencode-ai/sdk/v2";
import { describe, expect, it, vi } from "vitest";

import { OpenCodeAgentProvider } from "../src/provider.js";
import type {
  CreateOpenCodeSessionInput,
  OpenCodeHealth,
  OpenCodeMessageRecord,
  OpenCodeProviderSnapshot,
  OpenCodeSessionRecord,
  OpenCodeTransport,
  PromptOpenCodeSessionInput,
} from "../src/transport.js";

const NOW = new Date("2026-07-31T18:00:00.000Z");

function rawEvent(type: string, properties: object): Event {
  return { id: `evt-${type}`, type, properties } as unknown as Event;
}

function textPart(
  sessionID: string,
  messageID: string,
  id: string,
  text: string,
): Part {
  return {
    id,
    sessionID,
    messageID,
    type: "text",
    text,
  } as Part;
}

function completedToolPart(sessionID: string, messageID: string): Part {
  return {
    id: "part-tool",
    sessionID,
    messageID,
    type: "tool",
    callID: "call-1",
    tool: "read",
    state: {
      status: "completed",
      input: { file: "lesson.ts" },
      output: "source",
      title: "Read lesson.ts",
      metadata: {},
      time: { start: 1, end: 2 },
      attachments: [],
    },
  } as Part;
}

function finalMessage(
  sessionID = "ses-1",
  messageID = "msg-assistant",
  content = "Final answer",
): OpenCodeMessageRecord {
  return {
    id: messageID,
    sessionID,
    role: "assistant",
    parts: [textPart(sessionID, messageID, "part-final", content)],
  };
}

const providerSnapshot: OpenCodeProviderSnapshot = {
  providers: [
    {
      id: "anthropic",
      name: "Anthropic",
      models: [
        {
          id: "claude-sonnet",
          name: "Claude Sonnet",
          providerID: "anthropic",
          capabilities: {
            attachment: true,
            reasoning: true,
            temperature: true,
            toolcall: true,
          },
        },
      ],
    },
    {
      id: "openai",
      name: "OpenAI",
      models: [
        {
          id: "gpt-offline",
          name: "Offline model",
          providerID: "openai",
          capabilities: {
            attachment: false,
            reasoning: false,
            temperature: true,
            toolcall: true,
          },
        },
      ],
    },
  ],
  connectedProviderIDs: new Set(["anthropic"]),
  defaults: { anthropic: "claude-sonnet" },
};

class FakeOpenCodeTransport implements OpenCodeTransport {
  public readonly createCalls: CreateOpenCodeSessionInput[] = [];
  public readonly promptCalls: PromptOpenCodeSessionInput[] = [];
  public readonly abortCalls: string[] = [];
  public readonly messageCalls: string[] = [];
  public subscriptionSignal?: AbortSignal;
  public events: Event[] = [];
  public message = finalMessage();
  public messages: OpenCodeMessageRecord[] = [this.message];
  public healthResult: OpenCodeHealth = {
    healthy: true,
    version: "1.18.3",
  };
  public providers = providerSnapshot;
  public nextSession: OpenCodeSessionRecord = { id: "ses-1" };

  public async health(_signal?: AbortSignal): Promise<OpenCodeHealth> {
    return this.healthResult;
  }

  public async listProviders(
    _directory: string,
    _signal?: AbortSignal,
  ): Promise<OpenCodeProviderSnapshot> {
    return this.providers;
  }

  public async createSession(
    input: CreateOpenCodeSessionInput,
    _signal?: AbortSignal,
  ): Promise<OpenCodeSessionRecord> {
    this.createCalls.push(input);
    return this.nextSession;
  }

  public async promptAsync(
    input: PromptOpenCodeSessionInput,
    _signal?: AbortSignal,
  ): Promise<void> {
    this.promptCalls.push(input);
  }

  public async subscribe(
    _directory: string,
    signal: AbortSignal,
  ): Promise<AsyncIterable<Event>> {
    this.subscriptionSignal = signal;
    const events = this.events;
    return (async function* () {
      yield rawEvent("server.connected", {});
      for (const event of events) {
        yield event;
      }
    })();
  }

  public async getMessage(
    _sessionID: string,
    messageID: string,
    _directory: string,
    _signal?: AbortSignal,
  ): Promise<OpenCodeMessageRecord> {
    this.messageCalls.push(messageID);
    return this.message;
  }

  public async listMessages(
    _sessionID: string,
    _directory: string,
    _signal?: AbortSignal,
  ): Promise<ReadonlyArray<OpenCodeMessageRecord>> {
    return this.messages;
  }

  public async abortSession(
    sessionID: string,
    _directory: string,
    _signal?: AbortSignal,
  ): Promise<void> {
    this.abortCalls.push(sessionID);
  }
}

function createProvider(
  transport: FakeOpenCodeTransport,
  deadlines: {
    readonly requestTimeoutMs?: number;
    readonly turnTimeoutMs?: number;
  } = {},
): OpenCodeAgentProvider {
  return new OpenCodeAgentProvider({
    directory: "C:\\learning-workspace",
    transport,
    now: () => NOW,
    ...deadlines,
  });
}

async function createTeacherSession(
  provider: OpenCodeAgentProvider,
  role: "teacher" | "reviewer" = "teacher",
) {
  return provider.createSession({
    role,
    modelId: "anthropic/claude-sonnet",
    systemPrompt: "Teach with one question at a time.",
  });
}

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of source) {
    values.push(value);
  }
  return values;
}

describe("OpenCodeAgentProvider", () => {
  it("reports server health/version and exposes only runnable models", async () => {
    const provider = createProvider(new FakeOpenCodeTransport());

    await expect(provider.getStatus()).resolves.toEqual({
      providerId: "opencode",
      state: "connected",
      message: "OpenCode 1.18.3",
      checkedAt: NOW.toISOString(),
      capabilities: [
        "streaming",
        "models",
        "tools",
        "structured-output",
        "cancellation",
      ],
    });
    await expect(provider.listModels()).resolves.toEqual([
      expect.objectContaining({
        id: "anthropic/claude-sonnet",
        providerId: "opencode",
        available: true,
      }),
    ]);
  });

  it("bounds a provider-list request even when the transport ignores abort", async () => {
    vi.useFakeTimers();
    try {
      const transport = new FakeOpenCodeTransport();
      let requestSignal: AbortSignal | undefined;
      transport.listProviders = vi.fn(async (_directory, signal) => {
        requestSignal = signal;
        return new Promise<OpenCodeProviderSnapshot>(() => {});
      });
      const provider = createProvider(transport, { requestTimeoutMs: 25 });

      const pending = provider.listModels();
      const rejected = expect(pending).rejects.toMatchObject({
        code: "unavailable",
        retryable: true,
      });
      await vi.advanceTimersByTimeAsync(25);

      await rejected;
      expect(requestSignal?.aborted).toBe(true);
      expect(requestSignal?.reason).toMatchObject({ name: "TimeoutError" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("propagates caller cancellation into a provider-list request", async () => {
    const transport = new FakeOpenCodeTransport();
    let requestSignal: AbortSignal | undefined;
    transport.listProviders = vi.fn(async (_directory, signal) => {
      requestSignal = signal;
      return new Promise<OpenCodeProviderSnapshot>(() => {});
    });
    const provider = createProvider(transport);
    const controller = new AbortController();

    const pending = provider.listModels(controller.signal);
    controller.abort();

    await expect(pending).rejects.toMatchObject({ code: "unavailable" });
    expect(requestSignal?.aborted).toBe(true);
    expect(requestSignal?.reason).toMatchObject({ name: "AbortError" });
  });

  it("returns misconfigured status without contacting a real server", async () => {
    const provider = new OpenCodeAgentProvider({
      directory: "C:\\learning-workspace",
      env: {},
      now: () => NOW,
    });

    await expect(provider.getStatus()).resolves.toMatchObject({
      state: "misconfigured",
      checkedAt: NOW.toISOString(),
    });
  });

  it("creates a session only for a connected model", async () => {
    const provider = createProvider(new FakeOpenCodeTransport());

    await expect(createTeacherSession(provider)).resolves.toEqual({
      id: "ses-1",
      providerId: "opencode",
      role: "teacher",
      modelId: "anthropic/claude-sonnet",
      status: "active",
      createdAt: NOW.toISOString(),
    });

    await expect(
      provider.createSession({
        role: "teacher",
        modelId: "openai/gpt-offline",
        systemPrompt: "Teach.",
      }),
    ).rejects.toMatchObject({ code: "model_unavailable" });
  });

  it("bounds remote session creation when the sidecar stops responding", async () => {
    vi.useFakeTimers();
    try {
      const transport = new FakeOpenCodeTransport();
      let requestSignal: AbortSignal | undefined;
      transport.createSession = vi.fn(async (_input, signal) => {
        requestSignal = signal;
        return new Promise<OpenCodeSessionRecord>(() => {});
      });
      const provider = createProvider(transport, { requestTimeoutMs: 25 });

      const pending = createTeacherSession(provider);
      const rejected = expect(pending).rejects.toMatchObject({
        code: "provider_error",
        retryable: true,
      });
      await vi.advanceTimersByTimeAsync(25);

      await rejected;
      expect(requestSignal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("filters SSE by session, computes text deltas, and fetches the final message", async () => {
    const transport = new FakeOpenCodeTransport();
    transport.events = [
      rawEvent("session.idle", { sessionID: "another-session" }),
      rawEvent("message.updated", {
        sessionID: "ses-1",
        info: { id: "msg-assistant", sessionID: "ses-1", role: "assistant" },
      }),
      rawEvent("message.part.updated", {
        sessionID: "ses-1",
        time: 1,
        part: textPart("ses-1", "msg-assistant", "part-1", "Hel"),
      }),
      rawEvent("message.part.updated", {
        sessionID: "ses-1",
        time: 2,
        part: textPart("ses-1", "msg-assistant", "part-1", "Hello"),
      }),
      rawEvent("session.idle", { sessionID: "ses-1" }),
    ];
    const provider = createProvider(transport);
    await createTeacherSession(provider);

    const events = await collect(
      provider.streamMessage({
        sessionId: "ses-1",
        message: "Explain closures.",
        responseFormat: "text",
      }),
    );

    expect(events).toEqual([
      expect.objectContaining({
        type: "message.delta",
        delta: "Hel",
        sequence: 0,
      }),
      expect.objectContaining({
        type: "message.delta",
        delta: "lo",
        sequence: 1,
      }),
      expect.objectContaining({
        type: "message.completed",
        content: "Final answer",
        sequence: 2,
      }),
      expect.objectContaining({
        type: "session.completed",
        reason: "completed",
        sequence: 3,
      }),
    ]);
    expect(transport.promptCalls).toEqual([
      expect.objectContaining({
        sessionID: "ses-1",
        providerID: "anthropic",
        modelID: "claude-sonnet",
        prompt: "Explain closures.",
        responseFormat: "text",
        system: "Teach with one question at a time.",
      }),
    ]);
    expect(transport.messageCalls).toEqual(["msg-assistant"]);
    expect(transport.subscriptionSignal?.aborted).toBe(true);
  });

  it("falls back to the final message list when no message id event arrived", async () => {
    const transport = new FakeOpenCodeTransport();
    transport.events = [rawEvent("session.idle", { sessionID: "ses-1" })];
    transport.messages = [
      {
        id: "msg-user",
        sessionID: "ses-1",
        role: "user",
        parts: [textPart("ses-1", "msg-user", "part-user", "Question")],
      },
      finalMessage("ses-1", "msg-final", "Fetched from list"),
    ];
    const provider = createProvider(transport);
    await createTeacherSession(provider);

    const events = await collect(
      provider.streamMessage({
        sessionId: "ses-1",
        message: "Question",
        responseFormat: "text",
      }),
    );

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "message.completed",
        content: "Fetched from list",
      }),
    );
  });

  it("returns SDK structured output for JSON responses", async () => {
    const transport = new FakeOpenCodeTransport();
    transport.events = [rawEvent("session.idle", { sessionID: "ses-1" })];
    transport.messages = [
      {
        ...finalMessage("ses-1", "msg-json", ""),
        structured: { status: "passed", findings: [] },
      },
    ];
    const provider = createProvider(transport);
    await createTeacherSession(provider);

    const events = await collect(
      provider.streamMessage({
        sessionId: "ses-1",
        message: "Return JSON.",
        responseFormat: "json",
      }),
    );

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "message.completed",
        content: '{"status":"passed","findings":[]}',
      }),
    );
  });

  it("normalizes a completed tool part even when its running event was missed", async () => {
    const transport = new FakeOpenCodeTransport();
    transport.events = [
      rawEvent("message.part.updated", {
        sessionID: "ses-1",
        time: 2,
        part: completedToolPart("ses-1", "msg-assistant"),
      }),
      rawEvent("session.idle", { sessionID: "ses-1" }),
    ];
    const provider = createProvider(transport);
    await createTeacherSession(provider);

    const events = await collect(
      provider.streamMessage({
        sessionId: "ses-1",
        message: "Read the supplied lesson.",
        responseFormat: "text",
      }),
    );

    expect(events.slice(0, 2)).toEqual([
      expect.objectContaining({
        type: "tool.started",
        toolCallId: "call-1",
        input: { file: "lesson.ts" },
      }),
      expect.objectContaining({
        type: "tool.completed",
        toolCallId: "call-1",
        output: "source",
      }),
    ]);
  });

  it("keeps a successful OpenCode session active for another turn", async () => {
    const transport = new FakeOpenCodeTransport();
    transport.events = [rawEvent("session.idle", { sessionID: "ses-1" })];
    const provider = createProvider(transport);
    await createTeacherSession(provider);

    for (const message of ["First question", "Follow-up question"]) {
      const events = await collect(
        provider.streamMessage({
          sessionId: "ses-1",
          message,
          responseFormat: "text",
        }),
      );
      expect(events.at(-1)).toMatchObject({
        type: "session.completed",
        reason: "completed",
      });
    }

    expect(transport.promptCalls).toHaveLength(2);
  });

  it("aborts remote generation when the stream consumer closes early", async () => {
    const transport = new FakeOpenCodeTransport();
    transport.events = [
      rawEvent("message.part.updated", {
        sessionID: "ses-1",
        time: 1,
        part: textPart("ses-1", "msg-assistant", "part-1", "Partial"),
      }),
    ];
    const provider = createProvider(transport);
    await createTeacherSession(provider);

    const stream = provider.streamMessage({
      sessionId: "ses-1",
      message: "Question",
      responseFormat: "text",
    });
    const iterator = stream[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toMatchObject({
      value: expect.objectContaining({ type: "message.delta" }),
    });
    await iterator.return?.();

    expect(transport.abortCalls).toEqual(["ses-1"]);
  });

  it("denies mutation tools for reviewer sessions", async () => {
    const transport = new FakeOpenCodeTransport();
    transport.events = [rawEvent("session.idle", { sessionID: "ses-1" })];
    const provider = createProvider(transport);
    await createTeacherSession(provider, "reviewer");

    await collect(
      provider.streamMessage({
        sessionId: "ses-1",
        message: "Review this supplied diff.",
        responseFormat: "json",
      }),
    );

    expect(transport.promptCalls[0]?.tools).toEqual({
      apply_patch: false,
      bash: false,
      edit: false,
      patch: false,
      shell: false,
      write: false,
    });
    expect(transport.promptCalls[0]?.responseFormat).toBe("json");
    expect(transport.createCalls[0]?.permission).toEqual([
      { permission: "*", pattern: "*", action: "deny" },
    ]);
  });

  it("normalizes a session error and does not expose raw provider details", async () => {
    const transport = new FakeOpenCodeTransport();
    transport.events = [
      rawEvent("session.error", {
        sessionID: "ses-1",
        error: {
          name: "APIError",
          data: { message: "secret upstream body", isRetryable: true },
        },
      }),
    ];
    const provider = createProvider(transport);
    await createTeacherSession(provider);

    const events = await collect(
      provider.streamMessage({
        sessionId: "ses-1",
        message: "Question",
        responseFormat: "text",
      }),
    );

    expect(events).toEqual([
      expect.objectContaining({
        type: "error",
        error: {
          code: "provider_error",
          message: "OpenCode failed while generating a response",
          retryable: true,
        },
      }),
      expect.objectContaining({
        type: "session.completed",
        reason: "failed",
      }),
    ]);
    expect(JSON.stringify(events)).not.toContain("secret upstream body");
  });

  it("aborts the remote session and active SSE on cancellation", async () => {
    const transport = new FakeOpenCodeTransport();
    let subscribedSignal: AbortSignal | undefined;
    transport.subscribe = vi.fn(async (_directory, signal) => {
      subscribedSignal = signal;
      return {
        [Symbol.asyncIterator]() {
          return {
            next: () =>
              new Promise<IteratorResult<Event>>((_resolve, reject) => {
                signal.addEventListener(
                  "abort",
                  () => reject(new DOMException("Aborted", "AbortError")),
                  { once: true },
                );
              }),
          };
        },
      };
    });
    const provider = createProvider(transport);
    await createTeacherSession(provider);

    const stream = provider.streamMessage({
      sessionId: "ses-1",
      message: "Question",
      responseFormat: "text",
    });
    const iterator = stream[Symbol.asyncIterator]();
    const pendingEvent = iterator.next();
    await vi.waitFor(() => expect(subscribedSignal).toBeDefined());
    expect(transport.promptCalls).toEqual([]);
    await provider.cancelSession("ses-1");

    await expect(pendingEvent).resolves.toMatchObject({
      value: expect.objectContaining({
        type: "session.completed",
        reason: "cancelled",
      }),
    });
    expect(subscribedSignal?.aborted).toBe(true);
    expect(transport.abortCalls).toEqual(["ses-1"]);
  });

  it("fails a turn at its deadline when the event stream goes silent", async () => {
    vi.useFakeTimers();
    try {
      const transport = new FakeOpenCodeTransport();
      let subscriptionSignal: AbortSignal | undefined;
      transport.subscribe = vi.fn(async (_directory, signal) => {
        subscriptionSignal = signal;
        return {
          [Symbol.asyncIterator]() {
            let connected = false;
            return {
              next: () => {
                if (!connected) {
                  connected = true;
                  return Promise.resolve({
                    done: false as const,
                    value: rawEvent("server.connected", {}),
                  });
                }
                return new Promise<IteratorResult<Event>>(() => {});
              },
            };
          },
        };
      });
      const provider = createProvider(transport, {
        requestTimeoutMs: 25,
        turnTimeoutMs: 50,
      });
      await createTeacherSession(provider);

      const pending = collect(
        provider.streamMessage({
          sessionId: "ses-1",
          message: "Question",
          responseFormat: "text",
        }),
      );
      await vi.advanceTimersByTimeAsync(50);

      await expect(pending).resolves.toEqual([
        expect.objectContaining({
          type: "error",
          error: {
            code: "unavailable",
            message: "OpenCode response deadline was exceeded",
            retryable: true,
          },
        }),
        expect.objectContaining({
          type: "session.completed",
          reason: "failed",
        }),
      ]);
      expect(subscriptionSignal?.aborted).toBe(true);
      expect(transport.abortCalls).toEqual(["ses-1"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("bounds cancellation when the remote abort endpoint hangs", async () => {
    vi.useFakeTimers();
    try {
      const transport = new FakeOpenCodeTransport();
      const provider = createProvider(transport, { requestTimeoutMs: 25 });
      await createTeacherSession(provider);
      let abortSignal: AbortSignal | undefined;
      transport.abortSession = vi.fn(async (_sessionID, _directory, signal) => {
        abortSignal = signal;
        return new Promise<void>(() => {});
      });

      const pending = provider.cancelSession("ses-1");
      const rejected = expect(pending).rejects.toMatchObject({
        code: "provider_error",
        retryable: true,
      });
      await vi.advanceTimersByTimeAsync(25);

      await rejected;
      expect(abortSignal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("gracefully shuts down all active sessions once", async () => {
    const transport = new FakeOpenCodeTransport();
    const provider = createProvider(transport);
    await createTeacherSession(provider);

    await provider.shutdown();
    await provider.shutdown();

    expect(transport.abortCalls).toEqual(["ses-1"]);
    await expect(provider.getStatus()).resolves.toMatchObject({
      state: "unavailable",
    });
  });

  it("bounds shutdown and shares one completion promise", async () => {
    vi.useFakeTimers();
    try {
      const transport = new FakeOpenCodeTransport();
      const provider = createProvider(transport, { requestTimeoutMs: 25 });
      await createTeacherSession(provider);
      let abortSignal: AbortSignal | undefined;
      transport.abortSession = vi.fn(async (_sessionID, _directory, signal) => {
        abortSignal = signal;
        return new Promise<void>(() => {});
      });

      const first = provider.shutdown();
      const second = provider.shutdown();
      expect(second).toBe(first);
      await vi.advanceTimersByTimeAsync(25);

      await expect(first).resolves.toBeUndefined();
      expect(abortSignal?.aborted).toBe(true);
      expect(transport.abortSession).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("aborts a session whose remote creation finishes during shutdown", async () => {
    const transport = new FakeOpenCodeTransport();
    let resolveRemote: ((value: OpenCodeSessionRecord) => void) | undefined;
    transport.createSession = vi.fn(
      async () =>
        new Promise<OpenCodeSessionRecord>((resolveSession) => {
          resolveRemote = resolveSession;
        }),
    );
    const provider = createProvider(transport);

    const creating = createTeacherSession(provider);
    await vi.waitFor(() => expect(resolveRemote).toBeDefined());
    await provider.shutdown();
    resolveRemote?.({ id: "ses-late" });

    await expect(creating).rejects.toMatchObject({ code: "unavailable" });
    expect(transport.abortCalls).toEqual(["ses-late"]);
  });
});
