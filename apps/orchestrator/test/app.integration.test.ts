import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";

const runtimes: Array<ReturnType<typeof createApp>> = [];
const roots: string[] = [];

afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.close();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function runtime() {
  const root = mkdtempSync(path.join(tmpdir(), "dlh-orchestrator-"));
  roots.push(root);
  const created = createApp({
    projectRoot: path.resolve("../.."),
    databasePath: path.join(root, "test.sqlite"),
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

  it("rejects non-loopback browser origins", async () => {
    const { app } = runtime();
    const response = await request(app, "/api/dashboard", {
      headers: { Origin: "https://example.com" },
    });
    expect(response.status).toBe(403);
  });
});
