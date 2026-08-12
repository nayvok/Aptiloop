import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { AgentProvider } from "@aptiloop/agent-core";
import { MockAgentProvider } from "@aptiloop/agent-core/mock";
import {
  canonicalJson,
  hashCanonicalJson,
  migrateDatabase,
  openDatabase,
  type DatabaseConnection,
} from "@aptiloop/database";
import type {
  AgentEvent,
  AgentSession,
  CreateAgentSessionInput,
  ProviderId,
  SessionSnapshot,
} from "@aptiloop/shared";
import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";

import {
  registerInterviewV2Routes,
  type InterviewV2State,
} from "../src/interview-v2.js";
import { ProviderRuntime } from "../src/provider-runtime.js";
import { testDevelopmentProviderFixture } from "./provider-development-fixture.js";

const roots: string[] = [];
const connections: DatabaseConnection[] = [];
const directAuthority = "127.0.0.1:8787";

afterEach(() => {
  for (const connection of connections.splice(0)) connection.close();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function createState(
  provider: AgentProvider = new MockAgentProvider(),
  now?: () => Date,
) {
  const root = mkdtempSync(path.join(tmpdir(), "aptiloop-interview-v2-"));
  roots.push(root);
  const connection = openDatabase(path.join(root, "test.sqlite"));
  connections.push(connection);
  migrateDatabase(connection);
  const providers = {
    mock: provider,
    codex: provider,
    opencode: provider,
    pi: provider,
  };
  const connectionProviders = new Map<string, AgentProvider>();
  const state: InterviewV2State = {
    connection,
    providerRuntime: new ProviderRuntime({
      connection,
      providers,
      connectionProviders,
      developmentMode: process.env.NODE_ENV !== "production",
      ...(process.env.NODE_ENV !== "production"
        ? { developmentFixture: testDevelopmentProviderFixture }
        : {}),
      ...(now ? { now } : {}),
    }),
    interviewReservations: {
      start: false,
      interviewIds: new Set(),
    },
  };
  return { state, root, providers, connectionProviders };
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

async function configureExternalInterviewer(
  state: InterviewV2State,
  providers: Record<ProviderId, AgentProvider>,
  connectionProviders: Map<string, AgentProvider>,
  provider: AgentProvider,
) {
  const connectionId = "conn:external-interviewer-test";
  state.connection.sqlite
    .prepare(
      `INSERT OR IGNORE INTO provider_hub_connections
        (connection_id, adapter_id, provider_type, display_name,
         credential_ref, endpoint_profile_id, enabled, external, state,
         observed_capabilities_json, last_checked_at, created_at, updated_at)
       VALUES (?, 'pi', 'openai', 'External interviewer test',
               'credential:test', NULL, 1, 1, 'degraded', NULL, NULL, 1, 1)`,
    )
    .run(connectionId);
  providers.pi = provider;
  connectionProviders.set(connectionId, provider);
  const settings = await state.providerRuntime.settings();
  await state.providerRuntime.saveRoleProfiles(
    settings.roleProfiles.map((profile) =>
      profile.role === "evaluator"
        ? {
            role: profile.role,
            mode: "connection" as const,
            connectionId,
            modelId: "pi-exact",
          }
        : {
            role: profile.role,
            mode: profile.mode,
            connectionId: profile.connectionId,
            modelId: profile.modelId,
          },
    ),
  );
}

const request = (app: Hono, url: string, body?: unknown) => {
  const absoluteUrl = `http://${directAuthority}${url}`;
  return body === undefined
    ? app.request(absoluteUrl, { headers: { Host: directAuthority } })
    : app.request(absoluteUrl, {
        method: "POST",
        headers: {
          Host: directAuthority,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
};

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

type InterviewEventScript = (sessionId: string) => AsyncIterable<AgentEvent>;

class TrackingInterviewer implements AgentProvider {
  readonly createInputs: CreateAgentSessionInput[] = [];
  readonly cancelCalls: string[] = [];
  failStream = false;
  listCalls = 0;
  beforeStream: (() => Promise<void>) | undefined;
  streamCalls = 0;
  activeStreams = 0;
  maxActiveStreams = 0;

  constructor(
    readonly id: ProviderId,
    readonly modelId: string,
    readonly script?: InterviewEventScript,
  ) {}

  async getStatus() {
    return {
      providerId: this.id,
      state: "connected" as const,
      checkedAt: new Date().toISOString(),
      capabilities: [
        "streaming" as const,
        "models" as const,
        "structured-output" as const,
        "cancellation" as const,
      ],
    };
  }

  async listModels() {
    this.listCalls += 1;
    return [
      {
        id: this.modelId,
        providerId: this.id,
        name: "Tracked interviewer model",
        supportsStreaming: true,
        available: true,
      },
    ];
  }

  async createSession(input: CreateAgentSessionInput): Promise<AgentSession> {
    this.createInputs.push(input);
    return {
      id: `${this.id}-tracked-session`,
      providerId: this.id,
      role: input.role,
      modelId: input.modelId,
      status: "active",
      createdAt: new Date().toISOString(),
    };
  }

  async *streamMessage(): AsyncIterable<AgentEvent> {
    const sessionId = `${this.id}-tracked-session`;
    const timestamp = new Date().toISOString();
    this.streamCalls += 1;
    this.activeStreams += 1;
    this.maxActiveStreams = Math.max(this.maxActiveStreams, this.activeStreams);
    try {
      await this.beforeStream?.();
      if (this.failStream) {
        yield {
          type: "error",
          sessionId,
          sequence: 0,
          timestamp,
          error: {
            code: "provider_error",
            message: "injected downstream interviewer failure",
            retryable: true,
          },
        };
        yield {
          type: "session.completed",
          sessionId,
          sequence: 1,
          timestamp,
          reason: "failed",
        };
        return;
      }
      if (this.script) {
        yield* this.script(sessionId);
        return;
      }
      yield {
        type: "message.completed",
        sessionId,
        sequence: 0,
        timestamp,
        content: "Объясните event loop не более чем за одну минуту.",
      };
      yield {
        type: "session.completed",
        sessionId,
        sequence: 1,
        timestamp,
        reason: "completed",
      };
    } finally {
      this.activeStreams -= 1;
    }
  }

  async cancelSession(sessionId: string) {
    this.cancelCalls.push(sessionId);
  }
}

function gateNextStream(provider: TrackingInterviewer) {
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  provider.beforeStream = async () => {
    markStarted();
    await blocked;
  };
  return { release, started };
}
const interviewerBoundaryCases: Array<[string, InterviewEventScript]> = [
  [
    "delta-only completion",
    async function* (sessionId) {
      const eventTimestamp = new Date().toISOString();
      yield {
        type: "message.delta",
        sessionId,
        sequence: 0,
        timestamp: eventTimestamp,
        delta: "Объясните event loop не более чем за одну минуту.",
      };
      yield {
        type: "session.completed",
        sessionId,
        sequence: 1,
        timestamp: eventTimestamp,
        reason: "completed",
      };
    },
  ],
  [
    "out-of-order sequence",
    async function* (sessionId) {
      const eventTimestamp = new Date().toISOString();
      yield {
        type: "message.completed",
        sessionId,
        sequence: 1,
        timestamp: eventTimestamp,
        content: "Объясните event loop не более чем за одну минуту.",
      };
      yield {
        type: "session.completed",
        sessionId,
        sequence: 0,
        timestamp: eventTimestamp,
        reason: "completed",
      };
    },
  ],
  [
    "post-completion",
    async function* (sessionId) {
      const eventTimestamp = new Date().toISOString();
      yield {
        type: "message.completed",
        sessionId,
        sequence: 0,
        timestamp: eventTimestamp,
        content: "Безопасный вопрос.",
      };
      yield {
        type: "message.delta",
        sessionId,
        sequence: 1,
        timestamp: eventTimestamp,
        delta: "private-post-completion",
      };
    },
  ],
  [
    "response-bytes",
    async function* (sessionId) {
      yield {
        type: "message.delta",
        sessionId,
        sequence: 0,
        timestamp: new Date().toISOString(),
        delta: "x".repeat(256_001),
      };
    },
  ],
  [
    "event-count",
    async function* (sessionId) {
      const eventTimestamp = new Date().toISOString();
      for (let sequence = 0; sequence < 1_001; sequence += 1) {
        yield {
          type: "message.delta",
          sessionId,
          sequence,
          timestamp: eventTimestamp,
          delta: "",
        };
      }
    },
  ],
];

describe("restart-safe interview v2", () => {
  it("serializes concurrent retries of the same interview start operation", async () => {
    const provider = new TrackingInterviewer("mock", "mock-deterministic");
    const { state } = createState(provider);
    const app = createTestApp(state);
    const gate = gateNextStream(provider);
    const setup = {
      operationId: "concurrent-start-operation",
      topics: ["event-loop"],
      difficulty: "foundation",
      questionCount: 2,
    } as const;

    const firstRequest = request(app, "/api/interviews/v2", setup);
    await gate.started;
    expect(provider.activeStreams).toBe(1);
    const concurrent = await request(app, "/api/interviews/v2", setup);
    expect(concurrent.status).toBe(409);
    expect(await concurrent.json()).toEqual({
      error:
        "An interview operation is already in progress. Retry this request.",
    });
    expect(provider.streamCalls).toBe(1);
    expect(provider.maxActiveStreams).toBe(1);

    gate.release();
    const first = await firstRequest;
    expect(first.status).toBe(201);
    const firstBody = await first.json();
    const retried = await request(app, "/api/interviews/v2", setup);
    expect(retried.status).toBe(200);
    expect(await retried.json()).toEqual(firstBody);
    expect(provider.streamCalls).toBe(1);
    expect(provider.activeStreams).toBe(0);
    expect(
      state.connection.sqlite
        .prepare("SELECT role FROM agent_messages WHERE role = 'assistant'")
        .all(),
    ).toEqual([{ role: "assistant" }]);
  });

  it.each(interviewerBoundaryCases)(
    "fails closed for an interviewer %s violation",
    async (label, script) => {
      const provider = new TrackingInterviewer(
        "mock",
        "mock-deterministic",
        script,
      );
      const { state } = createState(provider);
      const app = createTestApp(state);

      const response = await request(app, "/api/interviews/v2", {
        operationId: `boundary-${label}`,
        topics: ["event-loop"],
        difficulty: "foundation",
        questionCount: 1,
      });

      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({
        failure: { code: expect.any(String) },
      });
      expect(provider.cancelCalls).toEqual(["mock-tracked-session"]);
      expect(
        state.connection.sqlite
          .prepare("SELECT count(*) AS count FROM interview_sessions")
          .get(),
      ).toEqual({ count: 0 });
      expect(
        state.connection.sqlite
          .prepare("SELECT count(*) AS count FROM agent_messages")
          .get(),
      ).toEqual({ count: 0 });
    },
  );

  it("serializes concurrent retries of the same answer operation", async () => {
    const provider = new TrackingInterviewer("mock", "mock-deterministic");
    const { state } = createState(provider);
    const app = createTestApp(state);
    const started = await request(app, "/api/interviews/v2", {
      operationId: "same-answer-start",
      topics: ["event-loop"],
      difficulty: "foundation",
      questionCount: 2,
    });
    const interview = (await started.json()) as { id: string };
    const gate = gateNextStream(provider);
    const answer = {
      operationId: "same-answer-operation",
      answer: "Promise callbacks run after the current stack.",
    } as const;

    const firstRequest = request(
      app,
      `/api/interviews/v2/${interview.id}/answers`,
      answer,
    );
    await gate.started;
    expect(provider.activeStreams).toBe(1);
    const concurrent = await request(
      app,
      `/api/interviews/v2/${interview.id}/answers`,
      answer,
    );
    expect(concurrent.status).toBe(409);
    expect(await concurrent.json()).toEqual({
      error:
        "An interview operation is already in progress. Retry this request.",
    });
    expect(provider.streamCalls).toBe(2);
    expect(provider.maxActiveStreams).toBe(1);

    gate.release();
    const first = await firstRequest;
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    const retried = await request(
      app,
      `/api/interviews/v2/${interview.id}/answers`,
      answer,
    );
    expect(retried.status).toBe(200);
    expect(await retried.json()).toEqual(firstBody);
    expect(provider.streamCalls).toBe(2);
    expect(provider.activeStreams).toBe(0);
    expect(
      state.connection.sqlite
        .prepare("SELECT role FROM agent_messages ORDER BY sequence ASC")
        .all(),
    ).toEqual([{ role: "assistant" }, { role: "user" }, { role: "assistant" }]);
  });

  it("serializes distinct answer operations for one interview", async () => {
    const provider = new TrackingInterviewer("mock", "mock-deterministic");
    const { state } = createState(provider);
    const app = createTestApp(state);
    const started = await request(app, "/api/interviews/v2", {
      operationId: "distinct-answer-start",
      topics: ["event-loop"],
      difficulty: "foundation",
      questionCount: 2,
    });
    const interview = (await started.json()) as { id: string };
    const gate = gateNextStream(provider);
    const firstAnswer = {
      operationId: "distinct-answer-operation-one",
      answer: "The current stack completes before microtasks run.",
    } as const;
    const secondAnswer = {
      operationId: "distinct-answer-operation-two",
      answer: "A timer callback runs in a later task.",
    } as const;

    const firstRequest = request(
      app,
      `/api/interviews/v2/${interview.id}/answers`,
      firstAnswer,
    );
    await gate.started;
    expect(provider.activeStreams).toBe(1);
    const concurrent = await request(
      app,
      `/api/interviews/v2/${interview.id}/answers`,
      secondAnswer,
    );
    expect(concurrent.status).toBe(409);
    expect(await concurrent.json()).toEqual({
      error:
        "An interview operation is already in progress. Retry this request.",
    });
    expect(provider.streamCalls).toBe(2);
    expect(provider.maxActiveStreams).toBe(1);

    gate.release();
    const first = await firstRequest;
    expect(first.status).toBe(200);
    const later = await request(
      app,
      `/api/interviews/v2/${interview.id}/answers`,
      secondAnswer,
    );
    expect(later.status).toBe(200);
    const laterBody = await later.json();
    const persistedRetry = await request(
      app,
      `/api/interviews/v2/${interview.id}/answers`,
      secondAnswer,
    );
    expect(persistedRetry.status).toBe(200);
    expect(await persistedRetry.json()).toEqual(laterBody);
    expect(provider.streamCalls).toBe(2);
    expect(provider.activeStreams).toBe(0);
    expect(
      state.connection.sqlite
        .prepare("SELECT role FROM agent_messages ORDER BY sequence ASC")
        .all(),
    ).toEqual([
      { role: "assistant" },
      { role: "user" },
      { role: "assistant" },
      { role: "user" },
    ]);
  });
  it("writes interview unit progress into the linked learning session on finish", async () => {
    const { state } = createState();
    const app = createTestApp(state);
    const now = Date.now();
    const snapshotCore: Omit<SessionSnapshot, "contentHash"> = {
      schemaVersion: 2,
      curriculumId: "interview-curriculum",
      curriculumVersionId: "interview-version",
      curriculumRevision: 1,
      curriculumTitle: "Interview curriculum",
      week: {
        id: "interview-week",
        stableId: "interview-week",
        order: 1,
        title: "Interview week",
        description: null,
      },
      day: {
        id: "interview-day-v2",
        stableId: "interview-day",
        order: 1,
        title: "Interview day",
        description: "Practice interviews",
        goal: "Practice interviews",
        estimatedMinutes: 30,
        prerequisites: [],
        expectedOutcomes: [],
        depthLevel: "foundation",
        outOfScope: [],
        topics: [],
      },
      units: [
        {
          id: "unit-interview-1",
          stableId: "unit-interview-1",
          type: "interview",
          title: "Interview",
          description: "Practice an interview",
          order: 1,
          estimatedMinutes: 30,
          objectives: [],
          checklist: [],
          sources: [],
          questions: [],
          misconceptions: [],
          referenceAnswer: null,
          completionCriteria: [{ type: "acknowledgement" }],
          unlockRules: [],
          optional: false,
          depthLevel: "foundation",
          payload: { type: "interview", topics: ["closures"] },
        },
      ],
      capturedAt: new Date(now).toISOString(),
    };
    const snapshotHash = hashCanonicalJson(snapshotCore);
    const snapshotJson = canonicalJson({
      ...snapshotCore,
      contentHash: snapshotHash,
    });
    state.connection.sqlite
      .prepare(
        `INSERT INTO curriculum_days
         (id, slug, week_number, day_number, title, summary,
          estimated_minutes, goals_json, sources_json, created_at, updated_at)
         VALUES ('interview-test-day', 'interview-test-day', 1, 1, 'Test',
                 'Test', 1, '[]', '[]', ?, ?)`,
      )
      .run(now, now);
    state.connection.sqlite.exec(`
      INSERT INTO curricula
        (id, slug, title, description, active_version_id, created_at, updated_at)
      VALUES
        ('interview-curriculum', 'interview-curriculum', 'Interview curriculum',
         NULL, NULL, ${now}, ${now});
      INSERT INTO curriculum_versions
        (id, curriculum_id, revision, parent_version_id, status, title,
         description, content_hash, created_at, published_at, archived_at,
         updated_at)
      VALUES
        ('interview-version', 'interview-curriculum', 1, NULL, 'draft',
         'Interview version', NULL, NULL, ${now}, NULL, NULL, ${now});
      INSERT INTO curriculum_weeks
        (id, version_id, stable_id, order_index, title, description,
         created_at, updated_at)
      VALUES
        ('interview-week', 'interview-version', 'interview-week', 0,
         'Interview week', NULL, ${now}, ${now});
      INSERT INTO curriculum_days_v2
        (id, version_id, week_id, stable_id, order_index, title, description,
         goal, estimated_minutes, prerequisites_json, expected_outcomes_json,
         depth_level, out_of_scope_json, topics_json, created_at, updated_at)
      VALUES
        ('interview-day-v2', 'interview-version', 'interview-week',
         'interview-day', 0, 'Interview day', NULL, 'Practice interviews', 30,
         '[]', '[]', 'foundation', '[]', '[]', ${now}, ${now});
      INSERT INTO curriculum_units
        (id, version_id, day_id, stable_id, type, order_index, title,
         description, estimated_minutes, objectives_json, checklist_json,
         sources_json, questions_json, misconceptions_json,
         reference_answer_json, completion_criteria_json, unlock_rules_json,
         optional, depth_level, payload_json, created_at, updated_at)
      VALUES
        ('unit-interview-1', 'interview-version', 'interview-day-v2',
         'unit-interview-1', 'interview', 0, 'Interview',
         'Practice an interview', 30, '[]', '[]', '[]', '[]', '[]', NULL,
         '[{"type":"acknowledgement"}]', '[]', 0, 'foundation',
         '{"type":"interview","topics":["closures"]}', ${now}, ${now});
      UPDATE curriculum_versions
      SET status = 'published', content_hash = '${"a".repeat(64)}',
          published_at = ${now}
      WHERE id = 'interview-version';
      UPDATE curricula
      SET active_version_id = 'interview-version', updated_at = ${now}
      WHERE id = 'interview-curriculum';
    `);
    state.connection.sqlite
      .prepare(
        `INSERT INTO learning_sessions
         (id, day_id, status, current_step, idempotency_key, started_at,
          completed_at, updated_at, curriculum_day_v2_id)
         VALUES ('session-interview-1', 'interview-test-day', 'active',
                 'unit-interview-1', 'session-interview-operation', ?, NULL,
                 ?, 'interview-day-v2')`,
      )
      .run(now, now);
    state.connection.sqlite
      .prepare(
        `INSERT INTO learning_sessions
         (id, day_id, status, current_step, idempotency_key, started_at,
          completed_at, updated_at, curriculum_day_v2_id)
         VALUES ('session-interview-other', 'interview-test-day', 'completed',
                 'complete', 'session-interview-other-operation', ?, ?,
                 ?, 'interview-day-v2')`,
      )
      .run(now, now, now);
    state.connection.sqlite
      .prepare(
        `INSERT INTO session_snapshots
         (id, session_id, schema_version, curriculum_id, curriculum_version_id,
          curriculum_day_id, content_hash, snapshot_json, created_at)
         VALUES ('interview-snapshot', 'session-interview-1', 2,
                 'interview-curriculum', 'interview-version',
                 'interview-day-v2', ?, ?, ?)`,
      )
      .run(snapshotHash, snapshotJson, now);
    state.connection.sqlite
      .prepare(
        `INSERT INTO learner_state
         (id, current_learning_session_id, updated_at)
         VALUES ('default', 'session-interview-1', ?)
         ON CONFLICT(id) DO UPDATE SET
           current_learning_session_id = excluded.current_learning_session_id,
           updated_at = excluded.updated_at`,
      )
      .run(now);
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
      learningSessionId: "session-interview-1",
    });
    expect(started.status).toBe(201);
    const startedBody = (await started.json()) as {
      id: string;
      learningSessionId: string | null;
    };
    const { id } = startedBody;
    expect(startedBody.learningSessionId).toBe("session-interview-1");

    const scopedCurrent = await request(
      app,
      "/api/interviews/v2/current?learningSessionId=session-interview-1",
    );
    expect(scopedCurrent.status).toBe(200);
    expect(await scopedCurrent.json()).toMatchObject({
      learningSessionId: "session-interview-1",
      interview: {
        id,
        learningSessionId: "session-interview-1",
      },
    });

    const otherSessionCurrent = await request(
      app,
      "/api/interviews/v2/current?learningSessionId=session-interview-other",
    );
    expect(otherSessionCurrent.status).toBe(200);
    expect(await otherSessionCurrent.json()).toEqual({
      learningSessionId: "session-interview-other",
      interview: null,
    });

    const unknownSessionCurrent = await request(
      app,
      "/api/interviews/v2/current?learningSessionId=session-interview-missing",
    );
    expect(unknownSessionCurrent.status).toBe(404);
    expect(await unknownSessionCurrent.json()).toEqual({
      error: "Learning session not found.",
    });

    const mismatchedReport = await request(
      app,
      `/api/interviews/v2/${id}?learningSessionId=session-interview-other`,
    );
    expect(mismatchedReport.status).toBe(404);
    expect(await mismatchedReport.json()).toEqual({
      error: "Interview not found.",
    });
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
      learningSessionId: string | null;
      status: string;
      transcript: Array<{ role: string; content: string }>;
      progress: { readyToFinish: boolean };
    };
    expect(startedBody.status).toBe("in_progress");
    expect(startedBody.learningSessionId).toBeNull();
    expect(startedBody.transcript).toHaveLength(1);
    expect(startedBody.transcript[0]?.role).toBe("assistant");
    expect(startedBody.progress.readyToFinish).toBe(false);

    const answeredFirst = await request(
      app,
      `/api/interviews/v2/${startedBody.id}/answers`,
      {
        operationId: "answer-operation-0001",
        answer:
          "A closure keeps access to its lexical environment after the outer function returns, which supports private state without exposing it through a public object property.",
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
          "Microtasks drain after the current stack and before the next macrotask, so a resolved Promise runs before a timer within the same event loop turn.",
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
        growthAreas: string[];
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
    expect(finishedBody.report.growthAreas).toContain(
      "Подтвердить техническую корректность ответов отдельной проверкой.",
    );
    expect(finishedBody.report.growthAreas.join(" ")).not.toMatch(
      /\breview\b/iu,
    );
    expect(protectedKeys(finishedBody)).toEqual([]);

    state.connection.close();
    connections.splice(connections.indexOf(state.connection), 1);
    const restartedConnection = openDatabase(path.join(root, "test.sqlite"), {
      fileMustExist: true,
    });
    connections.push(restartedConnection);
    const restartedProviders = {
      mock: new MockAgentProvider(),
      codex: new MockAgentProvider(),
      opencode: new MockAgentProvider(),
      pi: new MockAgentProvider(),
    };
    const restartedState: InterviewV2State = {
      connection: restartedConnection,
      providerRuntime: new ProviderRuntime({
        connection: restartedConnection,
        providers: restartedProviders,
        developmentMode: true,
        developmentFixture: testDevelopmentProviderFixture,
      }),
      interviewReservations: {
        start: false,
        interviewIds: new Set(),
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
    expect(await current.json()).toEqual({
      learningSessionId: null,
      interview: null,
    });
  });

  it("keeps prior answers when the provider fails, then retries idempotently", async () => {
    const { state, providers } = createState();
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

    providers.mock = new FailingInterviewer();
    const answer = {
      operationId: "answer-operation-failure",
      answer: "A closure retains access to bindings from its lexical scope.",
    } as const;
    const failed = await request(
      app,
      `/api/interviews/v2/${id}/answers`,
      answer,
    );
    expect(failed.status).toBe(503);
    const failedBody = (await failed.json()) as Record<string, unknown>;
    expect(failedBody).toMatchObject({
      failure: { code: "provider_error", retryable: false },
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

    providers.mock = new MockAgentProvider();
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

  it("keeps production no-AI setup write-free and retryable", async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const mock = new TrackingInterviewer("mock", "mock-deterministic");
      const { state } = createState(mock);
      const app = createTestApp(state);
      const setup = {
        operationId: "production-no-ai-interview",
        topics: ["event-loop"],
        difficulty: "foundation" as const,
        questionCount: 1,
      };

      const blocked = await request(app, "/api/interviews/v2", setup);
      expect(blocked.status).toBe(409);
      expect(await blocked.json()).toMatchObject({
        failure: { code: "ai_disabled", retryable: false },
      });
      expect(mock.createInputs).toHaveLength(0);
      expect(mock.cancelCalls).toEqual([]);
      expect(
        state.connection.sqlite
          .prepare("SELECT count(*) AS count FROM interview_sessions")
          .get(),
      ).toEqual({ count: 0 });
      expect(
        state.connection.sqlite
          .prepare(
            "SELECT count(*) AS count FROM agent_conversations WHERE role = 'interviewer'",
          )
          .get(),
      ).toEqual({ count: 0 });
      const current = await request(app, "/api/interviews/v2/current");
      expect(await current.json()).toEqual({
        learningSessionId: null,
        interview: null,
      });
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
    }
  });

  it("removes failed downstream setup so the same operation can retry", async () => {
    const mock = new TrackingInterviewer("mock", "mock-deterministic");
    mock.failStream = true;
    const { state } = createState(mock);
    const app = createTestApp(state);
    const setup = {
      operationId: "downstream-interview-failure",
      topics: ["closures"],
      difficulty: "interview-ready" as const,
      questionCount: 1,
    };

    const failed = await request(app, "/api/interviews/v2", setup);
    expect(failed.status).toBe(503);
    expect(await failed.json()).toMatchObject({
      failure: { code: "provider_error", retryable: false },
    });
    expect(mock.createInputs).toHaveLength(1);
    expect(mock.cancelCalls).toEqual(["mock-tracked-session"]);
    expect(
      state.connection.sqlite
        .prepare("SELECT count(*) AS count FROM interview_sessions")
        .get(),
    ).toEqual({ count: 0 });
    expect(
      state.connection.sqlite
        .prepare(
          "SELECT count(*) AS count FROM agent_conversations WHERE role = 'interviewer'",
        )
        .get(),
    ).toEqual({ count: 0 });
    const current = await request(app, "/api/interviews/v2/current");
    expect(await current.json()).toEqual({
      learningSessionId: null,
      interview: null,
    });

    mock.failStream = false;
    const retried = await request(app, "/api/interviews/v2", setup);
    expect(retried.status).toBe(201);
    expect(await retried.json()).toMatchObject({ status: "in_progress" });
    expect(mock.createInputs).toHaveLength(2);
    expect(mock.cancelCalls).toEqual([
      "mock-tracked-session",
      "mock-tracked-session",
    ]);
  });

  it("requires and consumes exact disclosure for an external interviewer", async () => {
    const mock = new TrackingInterviewer("mock", "mock-deterministic");
    const pi = new TrackingInterviewer("pi", "pi-exact");
    const { state, providers, connectionProviders, root } = createState(mock);
    await configureExternalInterviewer(
      state,
      providers,
      connectionProviders,
      pi,
    );
    const app = createTestApp(state);
    const setup = {
      operationId: "external-interviewer-policy",
      topics: ["closures"],
      difficulty: "foundation" as const,
      questionCount: 1,
    };

    const preview = await request(app, "/api/interviews/v2", setup);
    expect(preview.status).toBe(202);
    const previewBody = (await preview.json()) as {
      continuation: {
        kind: string;
        learningSessionId: string | null;
        interviewId: string;
        operationId: string;
      };
      disclosure: {
        operationId: string;
        status: string;
        scope: Record<string, unknown>;
      };
    };
    expect(previewBody.disclosure.status).toBe("pending");
    expect(previewBody.continuation).toMatchObject({
      kind: "start",
      learningSessionId: null,
      operationId: setup.operationId,
    });
    expect(previewBody.disclosure.scope).toEqual({
      destination:
        "External interviewer test: Generate one bounded interview question",
      payloadCategories: ["course-content"],
      byteCount: expect.any(Number),
      exclusions: expect.any(Array),
    });
    expect(JSON.stringify(previewBody)).not.toContain("payloadSha256");
    expect(JSON.stringify(previewBody)).not.toContain("modelId");
    expect(pi.createInputs).toHaveLength(0);

    const repeated = await request(app, "/api/interviews/v2", setup);
    expect(repeated.status).toBe(202);
    expect(await repeated.json()).toMatchObject({
      disclosure: { operationId: previewBody.disclosure.operationId },
    });
    expect(
      state.connection.sqlite
        .prepare("SELECT count(*) AS count FROM ai_disclosure_operations")
        .get(),
    ).toEqual({ count: 1 });

    state.connection.close();
    connections.splice(connections.indexOf(state.connection), 1);
    const restartedConnection = openDatabase(path.join(root, "test.sqlite"), {
      fileMustExist: true,
    });
    connections.push(restartedConnection);
    const restartedProviders: Record<ProviderId, AgentProvider> = {
      mock,
      codex: mock,
      opencode: mock,
      pi,
    };
    const restartedConnectionProviders = new Map<string, AgentProvider>([
      ["conn:external-interviewer-test", pi],
    ]);
    const restartedState: InterviewV2State = {
      connection: restartedConnection,
      providerRuntime: new ProviderRuntime({
        connection: restartedConnection,
        providers: restartedProviders,
        connectionProviders: restartedConnectionProviders,
        developmentMode: true,
        developmentFixture: testDevelopmentProviderFixture,
      }),
      interviewReservations: { start: false, interviewIds: new Set() },
    };
    const restartedApp = createTestApp(restartedState);
    const recoveryPath = `/api/interviews/v2/${previewBody.continuation.interviewId}/disclosures/pending?kind=start&operationId=${setup.operationId}`;
    const recovered = await request(restartedApp, recoveryPath);
    expect(recovered.status).toBe(200);
    expect(await recovered.json()).toEqual(previewBody);

    const wrongOperation = await request(
      restartedApp,
      `/api/interviews/v2/${previewBody.continuation.interviewId}/disclosures/pending?kind=start&operationId=wrong-operation`,
    );
    expect(wrongOperation.status).toBe(404);
    const wrongInterview = await request(
      restartedApp,
      `/api/interviews/v2/interview-wrong/disclosures/pending?kind=start&operationId=${setup.operationId}`,
    );
    expect(wrongInterview.status).toBe(404);
    const unexpectedQuestion = await request(
      restartedApp,
      `${recoveryPath}&questionId=question-wrong`,
    );
    expect(unexpectedQuestion.status).toBe(400);
    const duplicateOperation = await request(
      restartedApp,
      `${recoveryPath}&operationId=${setup.operationId}`,
    );
    expect(duplicateOperation.status).toBe(400);
    const unknownQuery = await request(
      restartedApp,
      `${recoveryPath}&unexpected=1`,
    );
    expect(unknownQuery.status).toBe(400);

    restartedState.providerRuntime.approveDisclosure(
      previewBody.disclosure.operationId,
    );
    const approved = await request(restartedApp, "/api/interviews/v2", {
      ...setup,
      disclosureOperationId: previewBody.disclosure.operationId,
    });
    expect(approved.status).toBe(200);
    expect(pi.createInputs).toHaveLength(1);
    expect(mock.createInputs).toHaveLength(0);
    expect((await request(restartedApp, recoveryPath)).status).toBe(404);
  });

  it("recovers only the exact pending answer disclosure scope", async () => {
    const mock = new TrackingInterviewer("mock", "mock-deterministic");
    const pi = new TrackingInterviewer("pi", "pi-exact");
    const { state, providers, connectionProviders } = createState(mock);
    await configureExternalInterviewer(
      state,
      providers,
      connectionProviders,
      pi,
    );
    const app = createTestApp(state);
    const setup = {
      operationId: "external-answer-setup",
      topics: ["closures"],
      difficulty: "foundation" as const,
      questionCount: 2,
    };
    const startPreview = await request(app, "/api/interviews/v2", setup);
    const startPending = (await startPreview.json()) as {
      continuation: { interviewId: string };
      disclosure: { operationId: string };
    };
    state.providerRuntime.approveDisclosure(
      startPending.disclosure.operationId,
    );
    const started = await request(app, "/api/interviews/v2", {
      ...setup,
      disclosureOperationId: startPending.disclosure.operationId,
    });
    const startedBody = (await started.json()) as {
      id: string;
      transcript: Array<{ id: string; role: string }>;
    };
    const questionId = startedBody.transcript[0]?.id;
    expect(questionId).toBeTruthy();
    if (!questionId) throw new Error("Missing opening question fixture");

    const answer = {
      operationId: "external-answer-operation",
      answer:
        "A closure retains the lexical bindings that were visible where the function was declared.",
    };
    const answerPreview = await request(
      app,
      `/api/interviews/v2/${startedBody.id}/answers`,
      answer,
    );
    expect(answerPreview.status).toBe(202);
    const answerPending = (await answerPreview.json()) as {
      continuation: {
        kind: string;
        learningSessionId: string | null;
        interviewId: string;
        questionId: string;
        operationId: string;
      };
      disclosure: { operationId: string; status: string };
    };
    expect(answerPending.continuation).toEqual({
      kind: "answer",
      learningSessionId: null,
      interviewId: startedBody.id,
      questionId,
      operationId: answer.operationId,
    });

    const repeated = await request(
      app,
      `/api/interviews/v2/${startedBody.id}/answers`,
      answer,
    );
    expect(repeated.status).toBe(202);
    expect(await repeated.json()).toMatchObject({
      disclosure: { operationId: answerPending.disclosure.operationId },
    });
    expect(
      state.connection.sqlite
        .prepare("SELECT count(*) AS count FROM ai_disclosure_operations")
        .get(),
    ).toEqual({ count: 2 });

    const recoveryPath = `/api/interviews/v2/${startedBody.id}/disclosures/pending?kind=answer&operationId=${answer.operationId}&questionId=${questionId}`;
    const recovered = await request(app, recoveryPath);
    expect(recovered.status).toBe(200);
    expect(await recovered.json()).toEqual(answerPending);

    const wrongQuestion = await request(
      app,
      `/api/interviews/v2/${startedBody.id}/disclosures/pending?kind=answer&operationId=${answer.operationId}&questionId=question-wrong`,
    );
    expect(wrongQuestion.status).toBe(404);
    const wrongOperation = await request(
      app,
      `/api/interviews/v2/${startedBody.id}/disclosures/pending?kind=answer&operationId=answer-operation-wrong&questionId=${questionId}`,
    );
    expect(wrongOperation.status).toBe(404);
    const wrongInterview = await request(
      app,
      `/api/interviews/v2/interview-wrong/disclosures/pending?kind=answer&operationId=${answer.operationId}&questionId=${questionId}`,
    );
    expect(wrongInterview.status).toBe(404);

    const now = Date.now();
    state.connection.sqlite
      .prepare(
        `INSERT INTO curriculum_days
         (id, slug, week_number, day_number, title, summary,
          estimated_minutes, goals_json, sources_json, created_at, updated_at)
         VALUES ('known-other-day', 'known-other-day', 99, 99,
                 'Known other day', 'Known other day', 1, '[]', '[]', ?, ?)`,
      )
      .run(now, now);
    state.connection.sqlite
      .prepare(
        `INSERT INTO learning_sessions
         (id, day_id, status, current_step, idempotency_key, started_at,
          completed_at, updated_at)
         VALUES ('known-other-session', ?, 'completed', 'complete',
                 'known-other-session-operation', ?, ?, ?)`,
      )
      .run("known-other-day", now, now, now);
    const wrongSession = await request(
      app,
      `${recoveryPath}&learningSessionId=known-other-session`,
    );
    expect(wrongSession.status).toBe(404);

    state.providerRuntime.approveDisclosure(
      answerPending.disclosure.operationId,
    );
    const answered = await request(
      app,
      `/api/interviews/v2/${startedBody.id}/answers`,
      {
        ...answer,
        disclosureOperationId: answerPending.disclosure.operationId,
      },
    );
    expect(answered.status).toBe(200);
    expect((await request(app, recoveryPath)).status).toBe(404);
  });

  it("does not recover an expired staged start disclosure", async () => {
    let now = new Date("2026-08-11T00:00:00.000Z");
    const mock = new TrackingInterviewer("mock", "mock-deterministic");
    const pi = new TrackingInterviewer("pi", "pi-exact");
    const { state, providers, connectionProviders } = createState(
      mock,
      () => now,
    );
    await configureExternalInterviewer(
      state,
      providers,
      connectionProviders,
      pi,
    );
    const app = createTestApp(state);
    const setup = {
      operationId: "expiring-start-operation",
      topics: ["closures"],
      difficulty: "foundation" as const,
      questionCount: 1,
    };
    const preview = await request(app, "/api/interviews/v2", setup);
    const pending = (await preview.json()) as {
      continuation: { interviewId: string };
      disclosure: { operationId: string };
    };
    now = new Date("2026-08-11T00:06:00.000Z");
    const recovered = await request(
      app,
      `/api/interviews/v2/${pending.continuation.interviewId}/disclosures/pending?kind=start&operationId=${setup.operationId}`,
    );
    expect(recovered.status).toBe(404);

    state.providerRuntime.cancelDisclosure(pending.disclosure.operationId);
    const abandoned = await request(
      app,
      `/api/interviews/v2/${pending.continuation.interviewId}/abandon`,
      { operationId: setup.operationId },
    );
    expect(abandoned.status).toBe(200);
    expect(await abandoned.json()).toEqual({
      abandoned: {
        interviewId: pending.continuation.interviewId,
        operationId: setup.operationId,
      },
    });
    const restarted = await request(app, "/api/interviews/v2", {
      ...setup,
      operationId: "replacement-start-operation",
    });
    expect(restarted.status).toBe(202);
  });

  it("rejects an unavailable exact interviewer model before saving", async () => {
    const mock = new TrackingInterviewer("mock", "mock-deterministic");
    const { state } = createState(mock);
    const settings = await state.providerRuntime.settings();

    await expect(
      state.providerRuntime.saveRoleProfiles(
        settings.roleProfiles.map((profile) =>
          profile.role === "evaluator"
            ? {
                role: profile.role,
                mode: "connection" as const,
                connectionId: "conn:mock",
                modelId: "missing-interviewer-model",
              }
            : {
                role: profile.role,
                mode: profile.mode,
                connectionId: profile.connectionId,
                modelId: profile.modelId,
              },
        ),
      ),
    ).rejects.toMatchObject({ failure: { code: "model_unavailable" } });
    expect(mock.createInputs).toHaveLength(0);
  });
});
