import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { MockAgentProvider } from "@dlh/agent-core";
import { afterEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";

const runtimes: Array<ReturnType<typeof createApp>> = [];
const roots: string[] = [];

afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.close();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function runtime(options: Parameters<typeof createApp>[0] = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "dlh-orchestrator-"));
  roots.push(root);
  const created = createApp({
    projectRoot: path.resolve("../.."),
    databasePath: path.join(root, "test.sqlite"),
    ...options,
  });
  runtimes.push(created);
  return created;
}

const request = (
  app: ReturnType<typeof createApp>["app"],
  path: string,
  init?: RequestInit,
) =>
  app.request(path, {
    ...init,
    headers: {
      "X-DLH-Client": "web",
      "Content-Type": "application/json",
      Origin: "http://127.0.0.1:3000",
      ...init?.headers,
    },
  });

describe("orchestrator vertical flow", () => {
  it("serves a seeded dashboard and creates a resumable session", async () => {
    const { app } = runtime();
    const dashboard = await request(app, "/api/dashboard");
    expect(dashboard.status).toBe(200);
    const dashboardBody = (await dashboard.json()) as {
      week: { days: unknown[] };
    };
    expect(dashboardBody.week.days).toHaveLength(7);

    const started = await request(app, "/api/learning/sessions", {
      method: "POST",
      body: JSON.stringify({ dayNumber: 1 }),
    });
    expect(started.status).toBe(201);
    const { id } = (await started.json()) as { id: string };
    const session = await request(app, `/api/learning/sessions/${id}`);
    const sessionBody = (await session.json()) as {
      question: { prompt: string };
    };
    expect(sessionBody.question.prompt).toBeTruthy();
  });

  it("streams normalized mock events", async () => {
    const { app } = runtime();
    const response = await request(app, "/api/agent/stream", {
      method: "POST",
      body: JSON.stringify({ role: "teacher", message: "Мой ответ" }),
    });
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('"type":"message.delta"');
    expect(body).toContain('"content"');

    const history = await request(app, "/api/agent/history?role=teacher");
    expect(history.status).toBe(200);
    const historyBody = (await history.json()) as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(historyBody.messages).toHaveLength(2);
    expect(historyBody.messages[0]).toMatchObject({
      role: "user",
      content: "Мой ответ",
    });
    expect(historyBody.messages[1]?.role).toBe("assistant");
  });

  it("accepts only the exact configured browser origin", async () => {
    const { app } = runtime();
    const alternateLoopback = await request(app, "/api/learning/sessions", {
      method: "POST",
      headers: { Origin: "http://localhost:3000" },
      body: JSON.stringify({ dayNumber: 1 }),
    });
    expect(alternateLoopback.status).toBe(403);

    const missingOrigin = await app.request("/api/learning/sessions", {
      method: "POST",
      headers: {
        "X-DLH-Client": "web",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ dayNumber: 1 }),
    });
    expect(missingOrigin.status).toBe(403);

    const exactOrigin = await request(app, "/api/learning/sessions", {
      method: "POST",
      body: JSON.stringify({ dayNumber: 1 }),
    });
    expect(exactOrigin.status).toBe(201);
  });

  it("requires a JSON content type for mutations", async () => {
    const { app } = runtime();
    const response = await request(app, "/api/learning/sessions", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ dayNumber: 1 }),
    });
    expect(response.status).toBe(415);

    const dashboard = await request(app, "/api/dashboard", {
      headers: { "Content-Type": "text/plain" },
    });
    expect(dashboard.status).toBe(200);
  });

  it("configures a fresh OpenCode provider with the loopback default", async () => {
    const previousEndpoint = process.env.OPENCODE_ENDPOINT;
    delete process.env.OPENCODE_ENDPOINT;
    try {
      const { state } = runtime();
      const status = await state.providers.opencode.getStatus();
      expect(status.state).not.toBe("misconfigured");
    } finally {
      if (previousEndpoint === undefined) delete process.env.OPENCODE_ENDPOINT;
      else process.env.OPENCODE_ENDPOINT = previousEndpoint;
    }
  });

  it("uses strict OpenCode endpoint validation and ignores browser executable changes", async () => {
    const { app, state } = runtime();
    const settingsResponse = await request(app, "/api/settings");
    const settings = (await settingsResponse.json()) as Record<string, unknown>;
    const configuredExecutable = settings.zedExecutable;
    delete settings.providers;

    const invalidEndpoint = await request(app, "/api/settings", {
      method: "PUT",
      body: JSON.stringify({
        ...settings,
        opencodeBaseUrl: "http://127.0.0.1:4096/api?token=secret",
      }),
    });
    expect(invalidEndpoint.status).toBe(400);
    expect(await state.repository.getSetting("opencodeBaseUrl")).toBeNull();

    const saved = await request(app, "/api/settings", {
      method: "PUT",
      body: JSON.stringify({
        ...settings,
        zedExecutable: "browser-controlled-program",
      }),
    });
    expect(saved.status).toBe(200);
    expect(await state.repository.getSetting("zedExecutable")).toBeNull();

    const updated = await request(app, "/api/settings");
    const updatedSettings = (await updated.json()) as Record<string, unknown>;
    expect(updatedSettings.zedExecutable).toBe(configuredExecutable);
  });

  it("evicts cancelled and failed agent sessions so the same chat can retry", async () => {
    const { app, state } = runtime({
      providers: {
        mock: new MockAgentProvider({ chunkSize: 1, delayMs: 20 }),
      },
    });
    const first = await request(app, "/api/agent/stream", {
      method: "POST",
      body: JSON.stringify({ role: "teacher", message: "Первый ответ" }),
    });
    expect(first.status).toBe(200);
    const firstBody = first.text();
    await new Promise((resolve) => setTimeout(resolve, 60));
    const firstSession = [...state.providerSessions.values()][0];
    const exposedSessionId = first.headers.get("X-DLH-Agent-Session-Id");
    expect(firstSession).toBeDefined();
    expect(exposedSessionId).toBe(firstSession?.providerSessionId);

    const cancelled = await request(
      app,
      `/api/agent/sessions/${exposedSessionId}/turn`,
      { method: "DELETE" },
    );
    expect(cancelled.status).toBe(200);
    expect(await firstBody).toContain('"reason":"cancelled"');
    expect(state.providerSessions.size).toBe(0);
    const cancelledMessage = state.connection.sqlite
      .prepare(
        `SELECT status FROM agent_messages
         WHERE role = 'assistant' ORDER BY sequence DESC LIMIT 1`,
      )
      .get() as { status: string };
    expect(cancelledMessage.status).toBe("cancelled");

    const retry = await request(app, "/api/agent/stream", {
      method: "POST",
      body: JSON.stringify({ role: "teacher", message: "Повтор" }),
    });
    expect(retry.status).toBe(200);
    await retry.text();
    const retrySession = [...state.providerSessions.values()][0];
    expect(retrySession?.providerSessionId).not.toBe(
      firstSession?.providerSessionId,
    );

    const failed = await request(app, "/api/agent/stream", {
      method: "POST",
      body: JSON.stringify({ role: "curator", message: "[[error]]" }),
    });
    expect(failed.status).toBe(200);
    expect(await failed.text()).toContain('"reason":"failed"');
    expect(
      [...state.providerSessions.keys()].some((key) =>
        key.startsWith("global:curator:"),
      ),
    ).toBe(false);

    const afterFailure = await request(app, "/api/agent/stream", {
      method: "POST",
      body: JSON.stringify({ role: "curator", message: "Повтор" }),
    });
    expect(afterFailure.status).toBe(200);
    expect(await afterFailure.text()).toContain('"reason":"completed"');
  });
});
