import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { MockAgentProvider, type AgentProvider } from "@dlh/agent-core";
import {
  createLearningRepository,
  migrateDatabase,
  openDatabase,
  type DatabaseConnection,
} from "@dlh/database";
import type { AgentEvent, AgentSession } from "@dlh/shared";
import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";

import {
  registerInterviewV2Routes,
  type InterviewV2State,
} from "../src/interview-v2.js";

const roots: string[] = [];
const connections: DatabaseConnection[] = [];

afterEach(() => {
  for (const connection of connections.splice(0)) connection.close();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function createState(provider: AgentProvider = new MockAgentProvider()) {
  const root = mkdtempSync(path.join(tmpdir(), "dlh-interview-v2-"));
  roots.push(root);
  const connection = openDatabase(path.join(root, "test.sqlite"));
  connections.push(connection);
  migrateDatabase(connection);
  const state: InterviewV2State = {
    connection,
    repository: createLearningRepository(connection),
    providers: {
      mock: provider,
      codex: provider,
      opencode: provider,
    },
  };
  return { state, root };
}

function createTestApp(state: InterviewV2State) {
  const app = new Hono();
  app.onError((error, context) => {
    if (error instanceof ZodError) {
      return context.json({ error: "Invalid request." }, 400);
    }
    const status = error.message.startsWith("Unknown interview:") ? 404 : 400;
    return context.json({ error: error.message }, status);
  });
  registerInterviewV2Routes(app, state);
  return app;
}

const request = (app: Hono, url: string, body?: unknown) =>
  body === undefined
    ? app.request(url)
    : app.request(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

function protectedKeys(value: unknown, path = "$"): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((child, index) =>
      protectedKeys(child, `${path}[${index}]`),
    );
  }
  if (!value || typeof value !== "object") return [];
  const forbidden = new Set([
    "referenceAnswer",
    "evaluationPoints",
    "correctOptionIds",
    "commonMistakes",
    "misconceptions",
    "protectedEvaluation",
  ]);
  return Object.entries(value as Record<string, unknown>).flatMap(
    ([key, child]) => [
      ...(forbidden.has(key) ? [`${path}.${key}`] : []),
      ...protectedKeys(child, `${path}.${key}`),
    ],
  );
}

class FailingInterviewer implements AgentProvider {
  readonly id = "mock" as const;

  async getStatus() {
    return {
      providerId: this.id,
      state: "error" as const,
      checkedAt: new Date().toISOString(),
      capabilities: [],
    };
  }

  async listModels() {
    return [];
  }

  async createSession(): Promise<AgentSession> {
    return {
      id: "failing-interviewer-session",
      providerId: this.id,
      role: "interviewer",
      modelId: "mock-deterministic",
      status: "active",
      createdAt: new Date().toISOString(),
    };
  }

  async *streamMessage(): AsyncIterable<AgentEvent> {
    const timestamp = new Date().toISOString();
    yield {
      type: "error",
      sessionId: "failing-interviewer-session",
      sequence: 0,
      timestamp,
      error: {
        code: "provider_error",
        message: "private provider diagnostic",
        retryable: true,
      },
    };
    yield {
      type: "session.completed",
      sessionId: "failing-interviewer-session",
      sequence: 1,
      timestamp,
      reason: "failed",
    };
  }

  async cancelSession() {}
}

describe("restart-safe interview v2", () => {
  it("writes interview unit progress into the linked learning session on finish", async () => {
    const { state } = createState();
    const app = createTestApp(state);
    const now = Date.now();
    state.connection.sqlite
      .prepare(
        `INSERT INTO curriculum_days
         (id, slug, week_number, day_number, title, summary,
          estimated_minutes, goals_json, sources_json, created_at, updated_at)
         VALUES ('interview-test-day', 'interview-test-day', 1, 1, 'Test',
                 'Test', 1, '[]', '[]', ?, ?)`,
      )
      .run(now, now);
    state.connection.sqlite
      .prepare(
        `INSERT INTO learning_sessions
         (id, day_id, status, current_step, idempotency_key, started_at,
          completed_at, updated_at, curriculum_day_v2_id)
         VALUES ('session-interview-1', 'interview-test-day', 'active',
                 'unit-interview-1', 'session-interview-operation', ?, NULL,
                 ?, NULL)`,
      )
      .run(now, now);
    state.connection.sqlite
      .prepare(
        `INSERT INTO unit_progress
         (id, session_id, unit_id, unit_type, status, progress_json,
          started_at, completed_at, skipped_at, updated_at)
         VALUES ('progress-interview-1', 'session-interview-1',
                 'unit-interview-1', 'interview', 'in_progress',
                 '{"type":"interview","interviewSessionId":null,"reportId":null}',
                 ?, NULL, NULL, ?)`,
      )
      .run(now, now);

    const started = await request(app, "/api/interviews/v2", {
      operationId: "setup-linked",
      topics: ["closures"],
      difficulty: "interview-ready",
      questionCount: 3,
    });
    expect(started.status).toBe(201);
    const { id } = (await started.json()) as { id: string };
    for (const [index, operationId] of [
      "linked-answer-0001",
      "linked-answer-0002",
      "linked-answer-0003",
    ].entries()) {
      const answered = await request(app, `/api/interviews/v2/${id}/answers`, {
        operationId,
        answer: `Ответ ${index + 1} о замыканиях и лексическом окружении.`,
      });
      expect(answered.status).toBe(200);
    }

    const finished = await request(app, `/api/interviews/v2/${id}/finish`, {
      operationId: "finish-linked",
    });
    expect(finished.status).toBe(200);
    const progress = state.connection.sqlite
      .prepare(
        `SELECT status, progress_json AS progressJson FROM unit_progress
         WHERE session_id = 'session-interview-1' AND unit_id = 'unit-interview-1'`,
      )
      .get() as { status: string; progressJson: string };
    expect(progress.status).toBe("in_progress");
    expect(JSON.parse(progress.progressJson)).toEqual({
      type: "interview",
      interviewSessionId: id,
      reportId: id,
    });
  });

  it("finishes standalone interviews without a learning session", async () => {
    const { state } = createState();
    const app = createTestApp(state);
    const started = await request(app, "/api/interviews/v2", {
      operationId: "setup-standalone",
      topics: ["closures"],
      difficulty: "foundation",
      questionCount: 1,
    });
    const { id } = (await started.json()) as { id: string };
    await request(app, `/api/interviews/v2/${id}/answers`, {
      operationId: "answer-standalone",
      answer: "Замыкание сохраняет лексическое окружение функции.",
    });

    const finished = await request(app, `/api/interviews/v2/${id}/finish`, {
      operationId: "finish-standalone",
    });
    expect(finished.status).toBe(200);
  });

  it("persists setup, one-at-a-time questions, answers, report and restart reads", async () => {
    const { state, root } = createState();
    const app = createTestApp(state);

    const started = await request(app, "/api/interviews/v2", {
      operationId: "setup-operation-0001",
      topics: ["closures", "event-loop"],
      difficulty: "interview-ready",
      questionCount: 2,
    });
    expect(started.status).toBe(201);
    const startedBody = (await started.json()) as {
      id: string;
      status: string;
      transcript: Array<{ role: string; content: string }>;
      progress: { readyToFinish: boolean };
    };
    expect(startedBody.status).toBe("in_progress");
    expect(startedBody.transcript).toHaveLength(1);
    expect(startedBody.transcript[0]?.role).toBe("assistant");
    expect(startedBody.progress.readyToFinish).toBe(false);

    const answeredFirst = await request(
      app,
      `/api/interviews/v2/${startedBody.id}/answers`,
      {
        operationId: "answer-operation-0001",
        answer:
          "A closure keeps access to its lexical environment after the outer function returns, which supports private state.",
      },
    );
    expect(answeredFirst.status).toBe(200);
    const firstBody = (await answeredFirst.json()) as {
      transcript: Array<{ role: string }>;
      progress: { questionsAsked: number; questionsAnswered: number };
    };
    expect(firstBody.transcript.map((message) => message.role)).toEqual([
      "assistant",
      "user",
      "assistant",
    ]);
    expect(firstBody.progress).toMatchObject({
      questionsAsked: 2,
      questionsAnswered: 1,
    });

    const answeredAgain = await request(
      app,
      `/api/interviews/v2/${startedBody.id}/answers`,
      {
        operationId: "answer-operation-0002",
        answer:
          "Microtasks drain after the current stack and before the next macrotask, so a resolved Promise runs before a timer.",
      },
    );
    expect(answeredAgain.status).toBe(200);
    const secondBody = (await answeredAgain.json()) as {
      transcript: unknown[];
      progress: { readyToFinish: boolean };
    };
    expect(secondBody.transcript).toHaveLength(4);
    expect(secondBody.progress.readyToFinish).toBe(true);

    const finished = await request(
      app,
      `/api/interviews/v2/${startedBody.id}/finish`,
      { operationId: "finish-operation-0001" },
    );
    expect(finished.status).toBe(200);
    const finishedBody = (await finished.json()) as {
      interview: { status: string; report: unknown };
      report: {
        status: string;
        metrics: Record<string, number>;
        evidence: unknown[];
      };
    };
    expect(finishedBody.report).toMatchObject({
      status: "completed",
      metrics: {
        questionsAsked: 2,
        questionsAnswered: 2,
        completionRate: 1,
      },
    });
    expect(finishedBody.report.evidence).toHaveLength(2);
    expect(protectedKeys(finishedBody)).toEqual([]);

    state.connection.close();
    connections.splice(connections.indexOf(state.connection), 1);
    const restartedConnection = openDatabase(path.join(root, "test.sqlite"), {
      fileMustExist: true,
    });
    connections.push(restartedConnection);
    const restartedState: InterviewV2State = {
      connection: restartedConnection,
      repository: createLearningRepository(restartedConnection),
      providers: {
        mock: new MockAgentProvider(),
        codex: new MockAgentProvider(),
        opencode: new MockAgentProvider(),
      },
    };
    const restartedApp = createTestApp(restartedState);
    const restored = await request(
      restartedApp,
      `/api/interviews/v2/${startedBody.id}`,
    );
    expect(restored.status).toBe(200);
    const restoredBody = (await restored.json()) as {
      status: string;
      transcript: unknown[];
      report: { metrics: { completionRate: number } };
    };
    expect(restoredBody.status).toBe("completed");
    expect(restoredBody.transcript).toHaveLength(4);
    expect(restoredBody.report.metrics.completionRate).toBe(1);
    expect(protectedKeys(restoredBody)).toEqual([]);

    const current = await request(restartedApp, "/api/interviews/v2/current");
    expect(await current.json()).toEqual({ interview: null });
  });

  it("keeps prior answers when the provider fails, then retries idempotently", async () => {
    const { state } = createState();
    const app = createTestApp(state);
    const setup = {
      operationId: "setup-operation-failure",
      topics: ["closures"],
      difficulty: "foundation",
      questionCount: 2,
    } as const;

    const started = await request(app, "/api/interviews/v2", setup);
    expect(started.status).toBe(201);
    const { id } = (await started.json()) as { id: string };

    state.providers.mock = new FailingInterviewer();
    const answer = {
      operationId: "answer-operation-failure",
      answer: "A closure retains access to bindings from its lexical scope.",
    } as const;
    const failed = await request(
      app,
      `/api/interviews/v2/${id}/answers`,
      answer,
    );
    expect(failed.status).toBe(502);
    const failedBody = (await failed.json()) as Record<string, unknown>;
    expect(failedBody).toEqual({
      error: "Interviewer provider failed. Your transcript was preserved.",
      retryable: true,
    });
    expect(JSON.stringify(failedBody)).not.toContain(
      "private provider diagnostic",
    );

    const restored = await request(app, `/api/interviews/v2/${id}`);
    const restoredBody = (await restored.json()) as {
      status: string;
      transcript: Array<{ role: string; content: string }>;
    };
    expect(restoredBody.status).toBe("in_progress");
    expect(restoredBody.transcript.map((message) => message.role)).toEqual([
      "assistant",
      "user",
    ]);
    expect(restoredBody.transcript[1]?.content).toBe(answer.answer);

    state.providers.mock = new MockAgentProvider();
    const retried = await request(
      app,
      `/api/interviews/v2/${id}/answers`,
      answer,
    );
    expect(retried.status).toBe(200);
    const retriedBody = (await retried.json()) as {
      id: string;
      status: string;
      transcript: unknown[];
    };
    expect(retriedBody.status).toBe("in_progress");
    expect(retriedBody.transcript).toHaveLength(3);

    const rejectedProviderOverride = await request(app, "/api/interviews/v2", {
      ...setup,
      operationId: "setup-operation-override",
      providerId: "codex",
      modelId: "browser-selected-model",
    });
    expect(rejectedProviderOverride.status).toBe(400);
  });
});
