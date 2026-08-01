import type { AgentEvent } from "@dlh/shared";
import { describe, expect, it, vi } from "vitest";

import { CodexProvider } from "../src/codex-provider.js";
import type {
  CodexAccountResponse,
  CodexModel,
  CodexNotification,
  CodexTransport,
  InterruptTurnParams,
  NotificationListener,
  ResumeThreadParams,
  StartThreadParams,
  StartTurnParams,
} from "../src/protocol.js";

class FakeTransport implements CodexTransport {
  account: CodexAccountResponse = {
    account: { type: "chatgpt" },
    requiresOpenaiAuth: true,
  };
  models: CodexModel[] = [
    {
      id: "model-id",
      model: "gpt-test",
      displayName: "GPT Test",
      description: "For tests",
      hidden: false,
      isDefault: true,
    },
  ];
  readonly startThread = vi.fn(async (_params: StartThreadParams) => ({
    thread: { id: "thread-1" },
  }));
  readonly resumeThread = vi.fn(async (params: ResumeThreadParams) => ({
    thread: { id: params.threadId },
  }));
  readonly startTurn = vi.fn(async (_params: StartTurnParams) => ({
    turn: { id: "turn-1", status: "inProgress" },
  }));
  readonly interruptTurn = vi.fn(
    async (_params: InterruptTurnParams) => undefined,
  );
  readonly shutdown = vi.fn(async () => undefined);
  readonly #listeners = new Set<NotificationListener>();

  async connect(): Promise<void> {}
  async readAccount(): Promise<CodexAccountResponse> {
    return this.account;
  }
  async listModels(): Promise<CodexModel[]> {
    return this.models;
  }
  subscribe(listener: NotificationListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
  emit(notification: CodexNotification): void {
    for (const listener of this.#listeners) listener(notification);
  }
}

const now = () => new Date("2026-07-31T18:00:00.000Z");

describe("CodexProvider", () => {
  it("reports missing authentication as misconfigured", async () => {
    const transport = new FakeTransport();
    transport.account = { account: null, requiresOpenaiAuth: true };
    const provider = new CodexProvider({ transport, now });

    await expect(provider.getStatus()).resolves.toMatchObject({
      providerId: "codex",
      state: "misconfigured",
      checkedAt: "2026-07-31T18:00:00.000Z",
    });
  });

  it("maps discovered Codex models without hard-coding model names", async () => {
    const provider = new CodexProvider({ transport: new FakeTransport(), now });

    await expect(provider.listModels()).resolves.toEqual([
      {
        id: "gpt-test",
        providerId: "codex",
        name: "GPT Test",
        description: "For tests",
        supportsStreaming: true,
        available: true,
      },
    ]);
  });

  it("creates reviewer threads with enforced read-only/never settings", async () => {
    const transport = new FakeTransport();
    const provider = new CodexProvider({ transport, now });

    const session = await provider.createSession({
      role: "reviewer",
      modelId: "gpt-test",
      systemPrompt: "Review only. Do not edit.",
      metadata: { cwd: "C:/workspace" },
    });

    expect(transport.startThread).toHaveBeenCalledWith({
      model: "gpt-test",
      cwd: "C:/workspace",
      developerInstructions: "Review only. Do not edit.",
      sandbox: "read-only",
      approvalPolicy: "never",
    });
    expect(session.metadata).toMatchObject({
      codexThreadId: "thread-1",
      sandbox: "read-only",
      approvalPolicy: "never",
    });
  });

  it("normalizes streamed messages and safe tool lifecycle events", async () => {
    const transport = new FakeTransport();
    const provider = new CodexProvider({ transport, now });
    const session = await provider.createSession({
      role: "reviewer",
      modelId: "gpt-test",
      systemPrompt: "Review only",
    });

    const collect = (async () => {
      const events: AgentEvent[] = [];
      for await (const event of provider.streamMessage({
        sessionId: session.id,
        message: "Review the diff",
        responseFormat: "text",
      }))
        events.push(event);
      return events;
    })();
    await vi.waitFor(() => expect(transport.startTurn).toHaveBeenCalledOnce());
    transport.emit({
      method: "item/started",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        item: {
          type: "commandExecution",
          id: "tool-1",
          command: "git diff",
          cwd: "C:/workspace",
        },
      },
    });
    transport.emit({
      method: "item/agentMessage/delta",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "msg-1",
        delta: "Looks",
      },
    });
    transport.emit({
      method: "item/completed",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        item: {
          type: "commandExecution",
          id: "tool-1",
          status: "completed",
          exitCode: 0,
          aggregatedOutput: "diff",
        },
      },
    });
    transport.emit({
      method: "item/completed",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        item: { type: "agentMessage", id: "msg-1", text: "Looks good" },
      },
    });
    transport.emit({
      method: "turn/completed",
      params: {
        threadId: "thread-1",
        turn: { id: "turn-1", status: "completed" },
      },
    });

    const events = await collect;
    expect(events.map((event) => event.type)).toEqual([
      "tool.started",
      "message.delta",
      "tool.completed",
      "message.completed",
      "session.completed",
    ]);
    expect(events.map((event) => event.sequence)).toEqual([0, 1, 2, 3, 4]);
    expect(events[0]).toMatchObject({
      type: "tool.started",
      toolName: "commandExecution",
      input: { kind: "command" },
    });
    expect(events[2]).toMatchObject({
      type: "tool.completed",
      toolName: "commandExecution",
      output: { status: "completed", exitCode: 0 },
    });
    expect(JSON.stringify(events)).not.toMatch(/git diff|C:\/workspace|"diff"/);
    expect(transport.startTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        approvalPolicy: "never",
        sandboxPolicy: { type: "readOnly", networkAccess: false },
      }),
    );
  });

  it("interrupts the active turn instead of killing the process", async () => {
    const transport = new FakeTransport();
    const provider = new CodexProvider({ transport, now });
    const session = await provider.createSession({
      role: "codex-expert",
      modelId: "gpt-test",
      systemPrompt: "Analyze architecture",
    });
    const stream = provider.streamMessage({
      sessionId: session.id,
      message: "Analyze",
      responseFormat: "text",
    });
    const iterator = stream[Symbol.asyncIterator]();
    const pending = iterator.next();
    await vi.waitFor(() => expect(transport.startTurn).toHaveBeenCalledOnce());

    await provider.cancelSession(session.id);
    expect(transport.interruptTurn).toHaveBeenCalledWith({
      threadId: "thread-1",
      turnId: "turn-1",
    });

    transport.emit({
      method: "turn/completed",
      params: {
        threadId: "thread-1",
        turn: { id: "turn-1", status: "interrupted" },
      },
    });
    await pending;
  });
});
