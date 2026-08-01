import { describe, expect, it } from "vitest";

import { CodexEventNormalizer } from "../src/event-normalizer.js";

describe("CodexEventNormalizer", () => {
  it("maps failed turns to an error followed by a failed terminal event", () => {
    const normalizer = new CodexEventNormalizer("session-1", {
      now: () => new Date("2026-07-31T18:00:00.000Z"),
    });

    expect(
      normalizer.normalize({
        method: "turn/completed",
        params: {
          threadId: "thread-1",
          turn: {
            id: "turn-1",
            status: "failed",
            error: { message: "Model failed" },
          },
        },
      }),
    ).toEqual([
      {
        type: "error",
        error: {
          code: "provider_error",
          message: "Codex reported an error",
          retryable: false,
        },
        sessionId: "session-1",
        sequence: 0,
        timestamp: "2026-07-31T18:00:00.000Z",
      },
      {
        type: "session.completed",
        reason: "failed",
        sessionId: "session-1",
        sequence: 1,
        timestamp: "2026-07-31T18:00:00.000Z",
      },
    ]);
  });

  it("keeps tool lifecycle metadata without exposing command or terminal data", () => {
    const normalizer = new CodexEventNormalizer("session-1", {
      now: () => new Date("2026-07-31T18:00:00.000Z"),
    });

    const started = normalizer.normalize({
      method: "item/started",
      params: {
        item: {
          id: "tool-1",
          type: "commandExecution",
          command: "curl -H 'Authorization: Bearer secret-token-value'",
          argv: ["--token", "sk-proj-12345678901234567890"],
          cwd: "C:/Users/private/workspace",
        },
      },
    });
    const completed = normalizer.normalize({
      method: "item/completed",
      params: {
        item: {
          id: "tool-1",
          type: "commandExecution",
          status: "completed",
          exitCode: 0,
          aggregatedOutput: "password=hunter2\nprivate terminal output",
        },
      },
    });

    expect(started[0]).toMatchObject({
      type: "tool.started",
      toolCallId: "tool-1",
      toolName: "commandExecution",
      input: { kind: "command" },
    });
    expect(completed[0]).toMatchObject({
      type: "tool.completed",
      toolCallId: "tool-1",
      toolName: "commandExecution",
      output: { status: "completed", exitCode: 0 },
    });
    expect(JSON.stringify([...started, ...completed])).not.toMatch(
      /curl|Authorization|secret-token|sk-proj|Users|hunter2|terminal output/,
    );
  });

  it("never exposes raw MCP names, arguments, results or errors", () => {
    const normalizer = new CodexEventNormalizer("session-1");
    const started = normalizer.normalize({
      method: "item/started",
      params: {
        item: {
          id: "mcp-1",
          type: "mcpToolCall",
          server: "private-filesystem",
          tool: "read_secret",
          arguments: { path: "C:/secret.txt", apiKey: "top-secret" },
        },
      },
    });
    const completed = normalizer.normalize({
      method: "item/completed",
      params: {
        item: {
          id: "mcp-1",
          type: "mcpToolCall",
          status: "failed",
          result: { content: "github_pat_12345678901234567890" },
          error: { message: "password=hunter2" },
        },
      },
    });

    expect(started[0]).toMatchObject({
      type: "tool.started",
      toolName: "mcpToolCall",
      input: { kind: "mcp" },
    });
    expect(completed[0]).toMatchObject({
      type: "tool.completed",
      toolName: "mcpToolCall",
      output: { status: "failed" },
    });
    expect(JSON.stringify([...started, ...completed])).not.toMatch(
      /private-filesystem|read_secret|secret\.txt|top-secret|github_pat|hunter2/,
    );
  });

  it("redacts secret-like strings and replaces raw provider errors", () => {
    const normalizer = new CodexEventNormalizer("session-1");
    const token = "sk-proj-12345678901234567890";

    const message = normalizer.normalize({
      method: "item/agentMessage/delta",
      params: { delta: `Do not expose ${token} or password=hunter2` },
    });
    const error = normalizer.normalize({
      method: "error",
      params: {
        willRetry: false,
        error: { message: `Request failed with ${token}` },
      },
    });

    expect(message[0]).toMatchObject({
      type: "message.delta",
      delta: "Do not expose [REDACTED] or password=[REDACTED]",
    });
    expect(error[0]).toMatchObject({
      type: "error",
      error: {
        code: "provider_error",
        message: "Codex reported an error",
        retryable: false,
      },
    });
    expect(JSON.stringify([...message, ...error])).not.toContain(token);
    expect(JSON.stringify([...message, ...error])).not.toContain("hunter2");
  });
});
