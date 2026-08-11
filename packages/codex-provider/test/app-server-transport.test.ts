import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type {
  ChildProcessWithoutNullStreams,
  SpawnOptionsWithStdioTuple,
} from "node:child_process";

import { describe, expect, it, vi } from "vitest";

import { CodexAppServerTransport } from "../src/app-server-transport.js";

interface FakeServer {
  child: ChildProcessWithoutNullStreams;
  requests: Array<Record<string, unknown>>;
  send(message: unknown): void;
  writeStdout(value: string): void;
}

function createFakeServer(
  respond: (
    message: Record<string, unknown>,
    server: FakeServer,
  ) => unknown | undefined,
): FakeServer {
  const processEvents = new EventEmitter();
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const requests: Array<Record<string, unknown>> = [];
  const child = Object.assign(processEvents, {
    stdin,
    stdout,
    stderr,
    exitCode: null,
    signalCode: null,
    killed: false,
    kill: vi.fn(() => true),
    pid: 123,
  }) as unknown as ChildProcessWithoutNullStreams;
  const server: FakeServer = {
    child,
    requests,
    send(message) {
      stdout.write(`${JSON.stringify(message)}\n`);
    },
    writeStdout(value) {
      stdout.write(value);
    },
  };
  let buffer = "";
  stdin.setEncoding("utf8");
  stdin.on("data", (chunk: string) => {
    buffer += chunk;
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      const message = JSON.parse(line) as Record<string, unknown>;
      requests.push(message);
      if (typeof message.id === "number") {
        const result = respond(message, server);
        if (result !== undefined) server.send({ id: message.id, result });
      }
      newline = buffer.indexOf("\n");
    }
  });
  return server;
}

function standardResponse(message: Record<string, unknown>): unknown {
  switch (message.method) {
    case "initialize":
      return { userAgent: "fake" };
    case "account/read":
      return { account: { type: "chatgpt" }, requiresOpenaiAuth: true };
    case "model/list":
      return {
        data: [
          {
            id: "gpt-test",
            model: "gpt-test",
            displayName: "GPT Test",
            description: "Fake model",
            hidden: false,
            isDefault: true,
          },
        ],
        nextCursor: null,
      };
    case "thread/start":
    case "thread/resume":
      return { thread: { id: "thread-1" } };
    case "turn/start":
      return { turn: { id: "turn-1", status: "inProgress" } };
    case "turn/interrupt":
      return {};
    default:
      return {};
  }
}

describe("CodexAppServerTransport", () => {
  it("spawns app-server safely and performs the JSONL handshake", async () => {
    const server = createFakeServer(standardResponse);
    let capturedSpawnOptions:
      SpawnOptionsWithStdioTuple<"pipe", "pipe", "pipe"> | undefined;
    const spawn = vi.fn(
      (
        _command: string,
        _args: readonly string[],
        options: SpawnOptionsWithStdioTuple<"pipe", "pipe", "pipe">,
      ) => {
        capturedSpawnOptions = options;
        return server.child;
      },
    );
    const transport = new CodexAppServerTransport({
      spawn,
      environment: {
        PATH: "C:/tools",
        USERPROFILE: "C:/Users/learner",
        OPENAI_API_KEY: "provider-credential",
        DATABASE_URL: "C:/private/database.sqlite",
        OPENCODE_SERVER_PASSWORD: "must-not-cross-boundary",
        GITHUB_TOKEN: "must-not-cross-boundary",
      },
    });

    await transport.connect();

    expect(spawn).toHaveBeenCalledWith(
      "codex",
      ["app-server", "--listen", "stdio://"],
      expect.objectContaining({
        shell: false,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      }),
    );
    expect(capturedSpawnOptions?.env).toEqual({
      PATH: "C:/tools",
      USERPROFILE: "C:/Users/learner",
      OPENAI_API_KEY: "provider-credential",
    });
    expect(JSON.stringify(capturedSpawnOptions?.env)).not.toContain(
      "DATABASE_URL",
    );
    expect(JSON.stringify(capturedSpawnOptions?.env)).not.toContain("OPENCODE");
    expect(JSON.stringify(capturedSpawnOptions?.env)).not.toContain(
      "GITHUB_TOKEN",
    );
    expect(server.requests[0]).toMatchObject({
      id: 1,
      method: "initialize",
      params: {
        clientInfo: { name: "aptiloop", version: "0.1.0" },
      },
    });
    expect(server.requests[1]).toEqual({ method: "initialized" });
  });

  it("uses only the bounded account, model, thread and turn methods", async () => {
    const server = createFakeServer(standardResponse);
    const transport = new CodexAppServerTransport({
      spawn: () => server.child,
    });

    expect(await transport.readAccount()).toEqual({
      account: { type: "chatgpt" },
      requiresOpenaiAuth: true,
    });
    expect(await transport.listModels()).toHaveLength(1);
    await transport.startThread({
      sandbox: "read-only",
      approvalPolicy: "never",
    });
    await transport.resumeThread({
      threadId: "thread-1",
      sandbox: "workspace-write",
      approvalPolicy: "never",
    });
    await transport.startTurn({
      threadId: "thread-1",
      input: [{ type: "text", text: "Explain closures" }],
    });
    await transport.interruptTurn({ threadId: "thread-1", turnId: "turn-1" });

    expect(server.requests.map((request) => request.method)).toEqual([
      "initialize",
      "initialized",
      "account/read",
      "model/list",
      "thread/start",
      "thread/resume",
      "turn/start",
      "turn/interrupt",
    ]);
    expect(server.requests[4]).toMatchObject({
      params: { sandbox: "read-only", approvalPolicy: "never" },
    });
  });

  it("forwards notifications and refuses app-server initiated capabilities", async () => {
    const server = createFakeServer(standardResponse);
    const transport = new CodexAppServerTransport({
      spawn: () => server.child,
    });
    const listener = vi.fn();
    transport.subscribe(listener);
    await transport.connect();

    server.send({
      method: "item/agentMessage/delta",
      params: { threadId: "thread-1", turnId: "turn-1", delta: "Hello" },
    });
    server.send({
      id: "approval-1",
      method: "item/fileChange/requestApproval",
      params: { threadId: "thread-1" },
    });
    await new Promise((resolve) => setImmediate(resolve));

    expect(listener).toHaveBeenCalledWith({
      method: "item/agentMessage/delta",
      params: { threadId: "thread-1", turnId: "turn-1", delta: "Hello" },
    });
    expect(server.requests.at(-1)).toEqual({
      id: "approval-1",
      error: {
        code: -32601,
        message:
          "Client method is not available: item/fileChange/requestApproval",
      },
    });
  });

  it("sanitizes tool notifications before notifying subscribers", async () => {
    const server = createFakeServer(standardResponse);
    const transport = new CodexAppServerTransport({
      spawn: () => server.child,
    });
    const listener = vi.fn();
    transport.subscribe(listener);
    await transport.connect();

    server.send({
      method: "item/started",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        item: {
          id: "tool-1",
          type: "commandExecution",
          command: "type C:/secret.txt",
          argv: ["--token", "sk-proj-12345678901234567890"],
          cwd: "C:/private",
        },
      },
    });
    server.send({
      method: "item/completed",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        item: {
          id: "mcp-1",
          type: "mcpToolCall",
          server: "private-server",
          tool: "read_secret",
          arguments: { password: "hunter2" },
          result: { apiKey: "top-secret" },
          error: { message: "Bearer secret-token-value" },
          status: "completed",
        },
      },
    });
    await new Promise((resolve) => setImmediate(resolve));

    expect(listener).toHaveBeenNthCalledWith(1, {
      method: "item/started",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        item: {
          id: "tool-1",
          type: "commandExecution",
          status: "unknown",
        },
      },
    });
    expect(listener).toHaveBeenNthCalledWith(2, {
      method: "item/completed",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        item: {
          id: "mcp-1",
          type: "mcpToolCall",
          status: "completed",
        },
      },
    });
    expect(JSON.stringify(listener.mock.calls)).not.toMatch(
      /secret\.txt|sk-proj|C:\/private|private-server|read_secret|hunter2|top-secret|secret-token/,
    );
  });

  it("fails closed when an unterminated JSONL line exceeds the size limit", async () => {
    const server = createFakeServer(() => undefined);
    const transport = new CodexAppServerTransport({
      spawn: () => server.child,
      requestTimeoutMs: 5_000,
    });

    const connecting = transport.connect();
    await new Promise((resolve) => setImmediate(resolve));
    server.writeStdout("x".repeat(1024 * 1024 + 1));

    await expect(connecting).rejects.toMatchObject({
      code: "protocol",
      message: "Codex app-server response exceeded the safe size limit",
    });
    expect(server.child.kill).toHaveBeenCalledOnce();
  });

  it("does not expose raw JSON-RPC error messages", async () => {
    const token = "sk-proj-12345678901234567890";
    const server = createFakeServer((message, fakeServer) => {
      if (message.method === "account/read") {
        fakeServer.send({
          id: message.id,
          error: {
            code: -32_000,
            message: `password=hunter2 ${token}`,
          },
        });
        return undefined;
      }
      return standardResponse(message);
    });
    const transport = new CodexAppServerTransport({
      spawn: () => server.child,
    });

    const account = transport.readAccount();

    await expect(account).rejects.toMatchObject({
      code: "protocol",
      message: "Codex RPC request failed (-32000)",
    });
    await expect(account).rejects.not.toThrow(/hunter2|sk-proj/);
  });

  it("reports a missing executable as unavailable", async () => {
    const transport = new CodexAppServerTransport({
      spawn: () => {
        throw new Error("ENOENT");
      },
    });

    await expect(transport.connect()).rejects.toMatchObject({
      code: "unavailable",
    });
  });

  it("closes stdin and waits for a graceful app-server exit", async () => {
    const server = createFakeServer(standardResponse);
    const transport = new CodexAppServerTransport({
      spawn: () => server.child,
    });
    await transport.connect();
    server.child.stdin.once("finish", () => server.child.emit("exit", 0, null));

    await transport.shutdown();

    expect(server.child.stdin.writableEnded).toBe(true);
    expect(server.child.kill).not.toHaveBeenCalled();
  });
});
