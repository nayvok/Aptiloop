import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { AgentProvider } from "@aptiloop/agent-core";
import { MockAgentProvider } from "@aptiloop/agent-core/mock";
import {
  AptiloopToolNameSchema,
  type AgentEvent,
  type AgentModel,
  type AgentSession,
  type CreateAgentSessionInput,
  type ProviderId,
  type ProviderStatus,
  type StreamAgentMessageInput,
} from "@aptiloop/shared";
import type { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createApp, type AppOptions } from "../src/app.js";
import { tutorTurnMessageKey } from "../src/tutor-message-scope.js";
import { seedDevelopmentDatabase } from "./development-database-fixture.js";
import { testDevelopmentProviderFixture } from "./provider-development-fixture.js";

const safeFailure = "The agent response was rejected by safety policy.";
const safeCancellation = "The agent turn was cancelled.";
const providerHandle = "provider-handle-must-not-leak";
const providerMetadata = "provider-metadata-must-not-leak";
const rawToolPayload = "raw-tool-payload-must-not-leak";
const timestamp = "2026-08-08T00:00:00.000Z";
const roots: string[] = [];
const runtimes: Array<{ close(): Promise<void> }> = [];
const runtimeStates = new WeakMap<
  Hono,
  ReturnType<typeof createApp>["state"]
>();

const browserEventSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("message.delta"),
      turnId: z.string().uuid(),
      content: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal("message.completed"),
      turnId: z.string().uuid(),
      content: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal("tool.summary"),
      turnId: z.string().uuid(),
      name: AptiloopToolNameSchema,
      status: z.enum(["started", "completed"]),
    })
    .strict(),
  z
    .object({
      type: z.literal("error"),
      turnId: z.string().uuid(),
      message: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal("session.completed"),
      turnId: z.string().uuid(),
      reason: z.enum(["completed", "failed", "cancelled"]),
    })
    .strict(),
]);

type EventScript = (sessionId: string) => AsyncIterable<AgentEvent>;

interface ScriptedProviderOptions {
  id?: ProviderId;
  modelId?: string;
  sessionId?: string;
  script?: EventScript;
  beforeCreate?: (signal?: AbortSignal) => Promise<void>;
  beforeStatus?: (signal?: AbortSignal) => Promise<void>;
  onCancel?: (sessionId: string) => Promise<void> | void;
}

class ScriptedProvider implements AgentProvider {
  readonly id: ProviderId;
  readonly modelId: string;
  readonly sessionId: string;
  readonly createInputs: CreateAgentSessionInput[] = [];
  readonly streamInputs: StreamAgentMessageInput[] = [];
  readonly cancelCalls: string[] = [];
  listCalls = 0;
  statusCalls = 0;
  readonly #script: EventScript;
  readonly #beforeCreate: ((signal?: AbortSignal) => Promise<void>) | undefined;
  readonly #beforeStatus: ((signal?: AbortSignal) => Promise<void>) | undefined;
  readonly #onCancel: ((sessionId: string) => Promise<void> | void) | undefined;

  constructor(options: ScriptedProviderOptions = {}) {
    this.id = options.id ?? "mock";
    this.modelId = options.modelId ?? "mock-deterministic";
    this.sessionId = options.sessionId ?? providerHandle;
    this.#script = options.script ?? completedScript;
    this.#beforeCreate = options.beforeCreate;
    this.#beforeStatus = options.beforeStatus;
    this.#onCancel = options.onCancel;
  }

  async getStatus(signal?: AbortSignal): Promise<ProviderStatus> {
    this.statusCalls += 1;
    await this.#beforeStatus?.(signal);
    signal?.throwIfAborted();
    return {
      providerId: this.id,
      state: "connected",
      checkedAt: timestamp,
      capabilities: ["streaming", "models", "cancellation"],
    };
  }

  async listModels(): Promise<AgentModel[]> {
    this.listCalls += 1;
    return [
      {
        id: this.modelId,
        providerId: this.id,
        name: `${this.id} test model`,
        supportsStreaming: true,
        available: true,
      },
    ];
  }

  async createSession(
    input: CreateAgentSessionInput,
    signal?: AbortSignal,
  ): Promise<AgentSession> {
    this.createInputs.push(input);
    await this.#beforeCreate?.(signal);
    const session: AgentSession = {
      id: this.sessionId,
      providerId: this.id,
      role: input.role,
      modelId: input.modelId,
      status: "active",
      createdAt: timestamp,
      metadata: { privateProviderMetadata: providerMetadata },
    };
    if (signal?.aborted) {
      await this.cancelSession(session.id);
      signal.throwIfAborted();
    }
    return session;
  }

  streamMessage(input: StreamAgentMessageInput): AsyncIterable<AgentEvent> {
    this.streamInputs.push(input);
    return this.#script(input.sessionId);
  }

  async cancelSession(sessionId: string): Promise<void> {
    this.cancelCalls.push(sessionId);
    await this.#onCancel?.(sessionId);
  }
}

async function* completedScript(sessionId: string): AsyncIterable<AgentEvent> {
  yield {
    type: "message.delta",
    sessionId,
    sequence: 0,
    timestamp,
    delta: "Safe answer",
  };
  yield {
    type: "message.completed",
    sessionId,
    sequence: 1,
    timestamp,
    content: "Safe answer",
  };
  yield {
    type: "session.completed",
    sessionId,
    sequence: 2,
    timestamp,
    reason: "completed",
  };
}
async function* authoritativeReplacementScript(
  sessionId: string,
): AsyncIterable<AgentEvent> {
  yield {
    type: "message.delta",
    sessionId,
    sequence: 0,
    timestamp,
    delta: "d".repeat(130_000),
  };
  yield {
    type: "message.completed",
    sessionId,
    sequence: 1,
    timestamp,
    content: "f".repeat(130_000),
  };
  yield {
    type: "session.completed",
    sessionId,
    sequence: 2,
    timestamp,
    reason: "completed",
  };
}

async function* cumulativeSessionOutputScript(
  sessionId: string,
): AsyncIterable<AgentEvent> {
  yield {
    type: "message.completed",
    sessionId,
    sequence: 0,
    timestamp,
    content: "c".repeat(140_000),
  };
  yield {
    type: "session.completed",
    sessionId,
    sequence: 1,
    timestamp,
    reason: "completed",
  };
}

async function* toolScript(sessionId: string): AsyncIterable<AgentEvent> {
  yield {
    type: "tool.started",
    sessionId,
    sequence: 0,
    timestamp,
    toolCallId: "private-tool-call-id",
    toolName: "private-provider-tool",
    input: { secret: rawToolPayload },
  };
}

async function* allowlistedToolScript(
  sessionId: string,
): AsyncIterable<AgentEvent> {
  yield {
    type: "tool.started",
    sessionId,
    sequence: 0,
    timestamp,
    toolCallId: "allowlisted-tool-call",
    toolName: "lesson.readLearnerSafeContext",
    input: { secret: rawToolPayload },
  };
  yield {
    type: "tool.completed",
    sessionId,
    sequence: 1,
    timestamp,
    toolCallId: "allowlisted-tool-call",
    toolName: "lesson.readLearnerSafeContext",
    output: { secret: rawToolPayload },
  };
  yield {
    type: "message.completed",
    sessionId,
    sequence: 2,
    timestamp,
    content: "Learner-safe answer",
  };
  yield {
    type: "session.completed",
    sessionId,
    sequence: 3,
    timestamp,
    reason: "completed",
  };
}

async function* oversizedScript(sessionId: string): AsyncIterable<AgentEvent> {
  yield {
    type: "message.delta",
    sessionId,
    sequence: 0,
    timestamp,
    delta: "💣".repeat(70_000),
  };
}

async function* excessiveEventsScript(
  sessionId: string,
): AsyncIterable<AgentEvent> {
  for (let sequence = 0; sequence < 1_100; sequence += 1) {
    yield {
      type: "message.delta",
      sessionId,
      sequence,
      timestamp,
      delta: "",
    };
  }
}

async function* excessiveToolCallsScript(
  sessionId: string,
): AsyncIterable<AgentEvent> {
  for (let sequence = 0; sequence < 5; sequence += 1) {
    yield {
      type: "tool.started",
      sessionId,
      sequence,
      timestamp,
      toolCallId: `tool-call-${sequence}`,
      toolName: "lesson.readLearnerSafeContext",
      input: {},
    };
  }
}

const adversarialEventCases: Array<
  [string, (sessionId: string) => AgentEvent[], string]
> = [
  [
    "scalar event",
    () => ["scalar-event-secret" as unknown as AgentEvent],
    "scalar-event-secret",
  ],
  [
    "object-valued terminal reason",
    (sessionId) => [
      {
        type: "session.completed",
        sessionId,
        sequence: 0,
        timestamp,
        reason: { privateReason: "object-reason-secret" },
      } as unknown as AgentEvent,
    ],
    "object-reason-secret",
  ],
  [
    "unknown event type",
    (sessionId) => [
      {
        type: "provider.private",
        sessionId,
        sequence: 0,
        timestamp,
        payload: "unknown-type-secret",
      } as unknown as AgentEvent,
    ],
    "unknown-type-secret",
  ],
  [
    "wrong provider session",
    () => [
      {
        type: "message.delta",
        sessionId: "wrong-session-secret",
        sequence: 0,
        timestamp,
        delta: "wrong-session-secret",
      },
    ],
    "wrong-session-secret",
  ],
  [
    "malformed base fields",
    (sessionId) => [
      {
        type: "message.delta",
        sessionId,
        sequence: -1,
        timestamp: "malformed-timestamp-secret",
        delta: "malformed-timestamp-secret",
      } as unknown as AgentEvent,
    ],
    "malformed-timestamp-secret",
  ],
  [
    "delta after authoritative completion",
    (sessionId) => [
      {
        type: "message.completed",
        sessionId,
        sequence: 0,
        timestamp,
        content: "bounded-completion",
      },
      {
        type: "message.delta",
        sessionId,
        sequence: 1,
        timestamp,
        delta: "post-completion-secret",
      },
    ],
    "post-completion-secret",
  ],
  [
    "post-terminal event",
    (sessionId) => [
      {
        type: "session.completed",
        sessionId,
        sequence: 0,
        timestamp,
        reason: "completed",
      },
      {
        type: "error",
        sessionId,
        sequence: 1,
        timestamp,
        error: {
          code: "provider_error",
          message: "post-terminal-secret",
          retryable: false,
        },
      },
    ],
    "post-terminal-secret",
  ],
  [
    "out-of-order sequence",
    (sessionId) => [
      {
        type: "message.delta",
        sessionId,
        sequence: 7,
        timestamp,
        delta: "out-of-order-sequence-secret",
      },
      {
        type: "session.completed",
        sessionId,
        sequence: 2,
        timestamp,
        reason: "completed",
      },
    ],
    "out-of-order-sequence-secret",
  ],
  [
    "completed terminal without message completion",
    (sessionId) => [
      {
        type: "session.completed",
        sessionId,
        sequence: 0,
        timestamp,
        reason: "completed",
      },
    ],
    "terminal-only-secret",
  ],
];

const budgetCases: Array<[string, EventScript]> = [
  ["UTF-8 response bytes", oversizedScript],
  ["event count", excessiveEventsScript],
  ["tool-call count", excessiveToolCallsScript],
];

afterEach(async () => {
  vi.restoreAllMocks();
  for (const runtime of runtimes.splice(0)) await runtime.close();
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function runtime(options: AppOptions = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "aptiloop-agent-policy-"));
  roots.push(root);
  const developmentMode = options.developmentMode ?? true;
  const created = createApp({
    projectRoot: path.resolve("../.."),
    databasePath: path.join(root, "test.sqlite"),
    databaseMode: "disposable",
    developmentDatabaseInitializer: seedDevelopmentDatabase,
    ...options,
    developmentMode,
    ...(developmentMode
      ? { developmentProviderFixture: testDevelopmentProviderFixture }
      : {}),
  });
  runtimes.push(created);
  runtimeStates.set(created.app, created.state);
  return created;
}

async function startActiveVersionedSession(
  current: Pick<ReturnType<typeof createApp>, "state">,
  idempotencyKey: string,
  dayOffset = 0,
): Promise<string> {
  const day = current.state.connection.sqlite
    .prepare(
      `SELECT day.id
       FROM curriculum_days_v2 day
       JOIN curriculum_weeks week ON week.id = day.week_id
       JOIN curriculum_versions version ON version.id = day.version_id
       JOIN curricula curriculum ON curriculum.id = version.curriculum_id
       WHERE version.status = 'published'
         AND version.id = curriculum.active_version_id
       ORDER BY curriculum.id, week.order_index, day.order_index, day.id
       LIMIT 1 OFFSET ?`,
    )
    .get(dayOffset) as { id: string } | undefined;
  if (!day) throw new Error("Missing seeded versioned curriculum day");
  const detail = await current.state.repository.startOrResumeVersionedSession({
    dayId: day.id,
    idempotencyKey,
  });
  return detail.session.id;
}

const request = async (app: Hono, requestPath: string, init?: RequestInit) => {
  let requestInit = init;
  if (
    ["/api/agent/stream", "/api/ai/disclosures"].includes(requestPath) &&
    typeof init?.body === "string"
  ) {
    const candidate = JSON.parse(init.body) as Record<string, unknown>;
    if (candidate.role === "teacher") {
      const state = runtimeStates.get(app);
      if (!state) throw new Error("Missing test runtime state");
      if (typeof candidate.sessionId !== "string") {
        candidate.sessionId = await startActiveVersionedSession(
          { state },
          `agent-policy-${randomUUID()}`,
        );
      }
      if (typeof candidate.unitId !== "string") {
        try {
          const detail = state.repository.getVersionedSession(
            String(candidate.sessionId),
          );
          const unit = detail.snapshot.units.find(
            (item) => item.type === "teacher-dialogue",
          );
          candidate.unitId = unit?.id ?? "missing-tutor-unit";
          const progress = detail.unitProgress.find(
            (item) => item.unitId === unit?.id,
          );
          if (
            detail.session.status === "active" &&
            unit &&
            progress?.status !== "in_progress"
          ) {
            state.repository.updateUnitProgress({
              sessionId: detail.session.id,
              unitId: unit.id,
              status: "in_progress",
            });
          }
        } catch {
          candidate.unitId = "missing-tutor-unit";
        }
      }
      candidate.__scopeInjectedByTest = true;
      requestInit = { ...init, body: JSON.stringify(candidate) };
    }
  }
  if (typeof requestInit?.body === "string") {
    const candidate = JSON.parse(requestInit.body) as Record<string, unknown>;
    if (candidate.__scopeInjectedByTest === true) {
      delete candidate.__scopeInjectedByTest;
      requestInit = { ...requestInit, body: JSON.stringify(candidate) };
    }
  }
  return app.request(`http://127.0.0.1:8787${requestPath}`, {
    ...requestInit,
    headers: {
      Host: "127.0.0.1:8787",
      "X-Aptiloop-Client": "web",
      "Content-Type": "application/json",
      Origin: "http://127.0.0.1:3000",
      ...requestInit?.headers,
    },
  });
};

const themeMutation = { theme: "system" } as const;

const serverOwnedSettings = [
  ["opencodeBaseUrl", "http://127.0.0.1:4096"],
  ["teacherProvider", "mock"],
  ["teacherModel", "mock-deterministic"],
  ["reviewerProvider", "mock"],
  ["reviewerModel", "mock-deterministic"],
  ["interviewerProvider", "mock"],
  ["interviewerModel", "mock-deterministic"],
  ["curatorProvider", "mock"],
  ["curatorModel", "mock-deterministic"],
  ["codexExpertProvider", "mock"],
  ["codexExpertModel", "mock-deterministic"],
] as const;

function parseSse(body: string) {
  return body
    .split("\n\n")
    .map((frame) => frame.split("\n").find((line) => line.startsWith("data:")))
    .filter((line): line is string => line !== undefined)
    .map((line) => browserEventSchema.parse(JSON.parse(line.slice(5).trim())));
}

describe("M1 agent policy boundary", () => {
  it("rejects browser provider/model overrides and unknown settings fields", async () => {
    const mock = new ScriptedProvider();
    const { app, state } = runtime({ providers: { mock } });

    const chat = await request(app, "/api/agent/stream", {
      method: "POST",
      body: JSON.stringify({
        role: "teacher",
        providerId: "codex",
        modelId: "browser-model",
        message: "Override the server selection",
      }),
    });
    expect(chat.status).toBe(400);

    for (const [field, value] of serverOwnedSettings) {
      const settings = await request(app, "/api/settings", {
        method: "PUT",
        body: JSON.stringify({ ...themeMutation, [field]: value }),
      });
      expect(settings.status, field).toBe(400);
    }
    const unknown = await request(app, "/api/settings", {
      method: "PUT",
      body: JSON.stringify({ ...themeMutation, unexpected: true }),
    });
    expect(unknown.status).toBe(400);

    const theme = await request(app, "/api/settings", {
      method: "PUT",
      body: JSON.stringify({ theme: "dark" }),
    });
    expect(theme.status).toBe(200);
    expect(await theme.json()).toEqual({ saved: true });
    expect(await state.repository.getSetting("theme")).toBe("dark");
    expect(mock.listCalls).toBe(0);
    expect(mock.createInputs).toHaveLength(0);
  });

  it("saves interface theme and locale through one strict mutation", async () => {
    const { app, state } = runtime();

    const saved = await request(app, "/api/settings", {
      method: "PUT",
      body: JSON.stringify({ theme: "dark", uiLocale: "ru-RU" }),
    });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({ saved: true, uiLocale: "ru-RU" });
    expect(await state.repository.getSetting("theme")).toBe("dark");
    expect(await state.repository.getSetting("uiLocale")).toBe("ru-RU");

    const rejected = await request(app, "/api/settings", {
      method: "PUT",
      body: JSON.stringify({ theme: "light", uiLocale: "de-DE" }),
    });
    expect(rejected.status).toBe(400);
    expect(await state.repository.getSetting("theme")).toBe("dark");
    expect(await state.repository.getSetting("uiLocale")).toBe("ru-RU");
  });

  it("rejects unknown, legacy, completed, and noncurrent sessions before provider access", async () => {
    const unknownMock = new ScriptedProvider();
    const unknown = runtime({ providers: { mock: unknownMock } });
    const unknownResponse = await request(unknown.app, "/api/agent/stream", {
      method: "POST",
      body: JSON.stringify({
        role: "teacher",
        sessionId: "unknown-versioned-session",
        message: "Unknown session",
      }),
    });
    expect(unknownResponse.status).toBe(404);
    expect(await unknownResponse.json()).toEqual({
      error: "Unknown versioned learning session: unknown-versioned-session",
    });

    const legacyMock = new ScriptedProvider();
    const legacy = runtime({ providers: { mock: legacyMock } });
    const legacyDay = legacy.state.connection.sqlite
      .prepare("SELECT id FROM curriculum_days ORDER BY day_number LIMIT 1")
      .get() as { id: string } | undefined;
    if (!legacyDay) throw new Error("Missing seeded legacy curriculum day");
    const legacySession = await legacy.state.repository.startSession({
      dayId: legacyDay.id,
      idempotencyKey: "agent-policy-legacy-session",
    });
    const legacyResponse = await request(legacy.app, "/api/agent/stream", {
      method: "POST",
      body: JSON.stringify({
        role: "teacher",
        sessionId: legacySession.session.id,
        message: "Legacy session",
      }),
    });
    expect(legacyResponse.status).toBe(404);
    expect(await legacyResponse.json()).toEqual({
      error: `Unknown versioned learning session: ${legacySession.session.id}`,
    });

    const completedMock = new ScriptedProvider();
    const completed = runtime({ providers: { mock: completedMock } });
    const completedId = await startActiveVersionedSession(
      completed,
      "agent-policy-completed-session",
    );
    completed.state.connection.sqlite
      .prepare(
        `UPDATE learning_sessions
         SET status = 'completed', completed_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(Date.now(), Date.now(), completedId);
    const completedResponse = await request(
      completed.app,
      "/api/agent/stream",
      {
        method: "POST",
        body: JSON.stringify({
          role: "teacher",
          sessionId: completedId,
          message: "Completed session",
        }),
      },
    );
    expect(completedResponse.status).toBe(409);
    expect(await completedResponse.json()).toEqual({
      error: "Tutor turns require an active versioned learning session",
    });

    const noncurrentMock = new ScriptedProvider();
    const noncurrent = runtime({ providers: { mock: noncurrentMock } });
    const noncurrentId = await startActiveVersionedSession(
      noncurrent,
      "agent-policy-noncurrent-session",
    );
    const now = Date.now();
    noncurrent.state.connection.sqlite
      .prepare(
        `UPDATE learning_sessions
         SET status = 'completed', completed_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(now, now, noncurrentId);
    noncurrent.state.connection.sqlite
      .prepare(
        `UPDATE learner_state SET current_learning_session_id = NULL,
         updated_at = ? WHERE id = 'default'`,
      )
      .run(now);
    const currentId = await startActiveVersionedSession(
      noncurrent,
      "agent-policy-current-session",
      1,
    );
    noncurrent.state.connection.sqlite.exec(
      "DROP INDEX IF EXISTS learning_sessions_one_global_active_uq",
    );
    noncurrent.state.connection.sqlite
      .prepare(
        `UPDATE learning_sessions
         SET status = 'active', completed_at = NULL, updated_at = ?
         WHERE id = ?`,
      )
      .run(Date.now(), noncurrentId);
    expect(currentId).not.toBe(noncurrentId);
    const noncurrentResponse = await request(
      noncurrent.app,
      "/api/agent/stream",
      {
        method: "POST",
        body: JSON.stringify({
          role: "teacher",
          sessionId: noncurrentId,
          message: "Noncurrent session",
        }),
      },
    );
    expect(noncurrentResponse.status).toBe(409);
    expect(await noncurrentResponse.json()).toEqual({
      error:
        "Course-scoped side effects require the Course's current active session",
    });

    for (const provider of [
      unknownMock,
      legacyMock,
      completedMock,
      noncurrentMock,
    ]) {
      expect(provider.listCalls).toBe(0);
      expect(provider.createInputs).toHaveLength(0);
      expect(provider.cancelCalls).toEqual([]);
    }
  });

  it("streams against the exact current active versioned learning session", async () => {
    const mock = new ScriptedProvider();
    const current = runtime({ providers: { mock } });
    const sessionId = await startActiveVersionedSession(
      current,
      "agent-policy-valid-session",
    );

    const response = await request(current.app, "/api/agent/stream", {
      method: "POST",
      body: JSON.stringify({
        role: "teacher",
        sessionId,
        message: "Authorized session",
      }),
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('"reason":"completed"');
    expect(mock.createInputs).toHaveLength(1);
    expect(mock.createInputs[0]?.metadata).toEqual({
      learningSessionId: sessionId,
      learningUnitId: expect.any(String),
    });
    expect(
      current.state.connection.sqlite
        .prepare(
          `SELECT learning_session_id AS learningSessionId
           FROM agent_conversations WHERE role = 'teacher'`,
        )
        .get(),
    ).toEqual({ learningSessionId: sessionId });
  });

  it("keeps Tutor transcript and prior dialogue in the exact unit scope", async () => {
    const mock = new ScriptedProvider();
    const current = runtime({ providers: { mock } });
    const sessionId = await startActiveVersionedSession(
      current,
      "agent-policy-exact-tutor-unit-scope",
    );
    const detail = current.state.repository.getVersionedSession(sessionId);
    const unit = detail.snapshot.units.find(
      (candidate) => candidate.type === "teacher-dialogue",
    );
    if (!unit || unit.payload.type !== "teacher-dialogue") {
      throw new Error("Missing Tutor unit fixture");
    }
    current.state.repository.updateUnitProgress({
      sessionId,
      unitId: unit.id,
      status: "in_progress",
    });

    const first = await request(current.app, "/api/agent/stream", {
      method: "POST",
      body: JSON.stringify({
        role: "teacher",
        sessionId,
        unitId: unit.id,
        message: "Exact unit first turn",
      }),
    });
    expect(first.status).toBe(200);
    const firstEvents = parseSse(await first.text());
    const firstTurnId = firstEvents[0]?.turnId;
    if (!firstTurnId) throw new Error("Missing first Tutor turn ID");
    const conversationId = [...current.state.providerSessions.values()][0]
      ?.conversationId;
    if (!conversationId) throw new Error("Missing Tutor conversation");

    const siblingUnitId = `${unit.id}:advanced`;
    current.state.repository.addMessage({
      conversationId,
      role: "user",
      content: "sibling-unit-user-sentinel",
      idempotencyKey: tutorTurnMessageKey(
        siblingUnitId,
        "sibling-turn",
        "user",
      ),
    });
    current.state.repository.addMessage({
      conversationId,
      role: "assistant",
      content: "sibling-unit-assistant-sentinel",
      idempotencyKey: tutorTurnMessageKey(
        siblingUnitId,
        "sibling-turn",
        "assistant",
      ),
    });
    current.state.repository.addMessage({
      conversationId,
      role: "user",
      content: "legacy-raw-prefix-sentinel",
      idempotencyKey: `tutor-unit:${unit.id}:agent-turn:legacy-turn:user`,
    });

    const transcript = await request(
      current.app,
      `/api/learning/sessions/v2/${encodeURIComponent(sessionId)}/units/${encodeURIComponent(unit.id)}/teacher-transcript`,
    );
    expect(transcript.status).toBe(200);
    const transcriptText = JSON.stringify(await transcript.json());
    expect(transcriptText).toContain("Exact unit first turn");
    expect(transcriptText).not.toContain("sibling-unit");
    expect(transcriptText).not.toContain("legacy-raw-prefix-sentinel");

    const second = await request(current.app, "/api/agent/stream", {
      method: "POST",
      body: JSON.stringify({
        role: "teacher",
        sessionId,
        unitId: unit.id,
        message: "Exact unit second turn",
      }),
    });
    expect(second.status).toBe(200);
    await second.text();
    const providerPayload = JSON.parse(
      mock.streamInputs[1]?.message ?? "null",
    ) as { priorDialogue?: Array<{ content: string }> };
    const priorDialogue = JSON.stringify(providerPayload.priorDialogue ?? []);
    expect(priorDialogue).toContain("Exact unit first turn");
    expect(priorDialogue).not.toContain("sibling-unit");
    expect(priorDialogue).not.toContain("legacy-raw-prefix-sentinel");
  });

  it("cancels and drains a hanging provider stream before closing SQLite", async () => {
    let markStreamStarted!: () => void;
    const streamStarted = new Promise<void>((resolve) => {
      markStreamStarted = resolve;
    });
    let releaseStream!: () => void;
    const streamRelease = new Promise<void>((resolve) => {
      releaseStream = resolve;
    });
    const lifecycle: string[] = [];
    const mock = new ScriptedProvider({
      script: async function* (sessionId) {
        lifecycle.push("stream-started");
        markStreamStarted();
        await streamRelease;
        yield {
          type: "message.delta",
          sessionId,
          sequence: 0,
          timestamp,
          delta: "cancelled stream must not reach the client",
        };
      },
      onCancel: () => {
        lifecycle.push("provider-cancelled");
        releaseStream();
      },
    });
    const current = runtime({ providers: { mock } });
    const closeDatabase = current.state.connection.close.bind(
      current.state.connection,
    );
    vi.spyOn(current.state.connection, "close").mockImplementation(() => {
      lifecycle.push("database-closed");
      closeDatabase();
    });
    const sessionId = await startActiveVersionedSession(
      current,
      "agent-policy-shutdown-stream",
    );
    const responsePromise = request(current.app, "/api/agent/stream", {
      method: "POST",
      body: JSON.stringify({
        role: "teacher",
        sessionId,
        message: "Wait until shutdown",
      }),
    });
    await streamStarted;

    current.beginShutdown();
    await current.close();
    const response = await responsePromise;

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('"reason":"cancelled"');
    expect(mock.cancelCalls).toEqual([providerHandle]);
    expect(lifecycle).toEqual([
      "stream-started",
      "provider-cancelled",
      "database-closed",
    ]);
    runtimes.splice(runtimes.indexOf(current), 1);
  });

  it("aborts and drains hanging provider session setup before closing SQLite", async () => {
    let markSetupStarted!: () => void;
    const setupStarted = new Promise<void>((resolve) => {
      markSetupStarted = resolve;
    });
    const lifecycle: string[] = [];
    const mock = new ScriptedProvider({
      beforeCreate: (signal) =>
        new Promise<void>((_resolve, reject) => {
          lifecycle.push("setup-started");
          markSetupStarted();
          signal?.addEventListener(
            "abort",
            () => {
              lifecycle.push("setup-aborted");
              reject(signal.reason);
            },
            { once: true },
          );
        }),
    });
    const current = runtime({ providers: { mock } });
    const closeDatabase = current.state.connection.close.bind(
      current.state.connection,
    );
    vi.spyOn(current.state.connection, "close").mockImplementation(() => {
      lifecycle.push("database-closed");
      closeDatabase();
    });
    const sessionId = await startActiveVersionedSession(
      current,
      "agent-policy-shutdown-setup",
    );
    const responsePromise = request(current.app, "/api/agent/stream", {
      method: "POST",
      body: JSON.stringify({
        role: "teacher",
        sessionId,
        message: "Wait during setup",
      }),
    });
    await setupStarted;

    current.beginShutdown();
    await current.close();
    await expect(responsePromise).resolves.toMatchObject({ status: 400 });

    expect(current.state.providerSessions.size).toBe(0);
    expect(current.state.activeProviderTurnReservations.size).toBe(0);
    expect(lifecycle).toEqual([
      "setup-started",
      "setup-aborted",
      "database-closed",
    ]);
    runtimes.splice(runtimes.indexOf(current), 1);
  });

  it("drains shutdown-gated conversation creation before closing SQLite", async () => {
    let markSetupStarted!: () => void;
    const setupStarted = new Promise<void>((resolve) => {
      markSetupStarted = resolve;
    });
    let releaseSetup!: () => void;
    const setupRelease = new Promise<void>((resolve) => {
      releaseSetup = resolve;
    });
    const lifecycle: string[] = [];
    let conversationsAtClose: number | undefined;
    const mock = new ScriptedProvider({
      onCancel: () => {
        lifecycle.push("provider-cancelled");
      },
    });
    const current = runtime({ providers: { mock } });
    const closeDatabase = current.state.connection.close.bind(
      current.state.connection,
    );
    vi.spyOn(current.state.connection, "close").mockImplementation(() => {
      conversationsAtClose = (
        current.state.connection.sqlite
          .prepare(
            "SELECT count(*) AS count FROM agent_conversations WHERE role = 'teacher'",
          )
          .get() as { count: number }
      ).count;
      lifecycle.push("database-closed");
      closeDatabase();
    });
    const createConversation = current.state.repository.createConversation.bind(
      current.state.repository,
    );
    vi.spyOn(
      current.state.repository,
      "createConversation",
    ).mockImplementationOnce(async (input) => {
      lifecycle.push("repository-started");
      markSetupStarted();
      await setupRelease;
      return createConversation(input);
    });
    const sessionId = await startActiveVersionedSession(
      current,
      "agent-policy-shutdown-create-conversation",
    );
    const responsePromise = request(current.app, "/api/agent/stream", {
      method: "POST",
      body: JSON.stringify({
        role: "teacher",
        sessionId,
        message: "Wait during repository setup",
      }),
    });
    await setupStarted;

    current.beginShutdown();
    const closePromise = current.close();
    expect(lifecycle).toEqual(["repository-started"]);
    releaseSetup();
    const response = await responsePromise;
    lifecycle.push("handler-settled");
    await closePromise;

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: safeCancellation });
    expect(mock.cancelCalls).toEqual([providerHandle]);
    expect(current.state.providerSessions.size).toBe(0);
    expect(current.state.activeProviderTurns.size).toBe(0);
    expect(current.state.activeProviderTurnReservations.size).toBe(0);
    expect(conversationsAtClose).toBe(0);
    expect(lifecycle).toEqual([
      "repository-started",
      "provider-cancelled",
      "handler-settled",
      "database-closed",
    ]);
    runtimes.splice(runtimes.indexOf(current), 1);
  });

  it("aborts and drains initial provider inspection before closing SQLite", async () => {
    let markInspectionStarted!: () => void;
    const inspectionStarted = new Promise<void>((resolve) => {
      markInspectionStarted = resolve;
    });
    const lifecycle: string[] = [];
    const mock = new ScriptedProvider({
      beforeStatus: (signal) =>
        new Promise<void>((_resolve, reject) => {
          lifecycle.push("inspection-started");
          markInspectionStarted();
          signal?.addEventListener(
            "abort",
            () => {
              lifecycle.push("inspection-aborted");
              reject(signal.reason);
            },
            { once: true },
          );
        }),
    });
    const current = runtime({ providers: { mock } });
    const closeDatabase = current.state.connection.close.bind(
      current.state.connection,
    );
    vi.spyOn(current.state.connection, "close").mockImplementation(() => {
      lifecycle.push("database-closed");
      closeDatabase();
    });
    const sessionId = await startActiveVersionedSession(
      current,
      "agent-policy-shutdown-inspection",
    );
    const responsePromise = request(current.app, "/api/agent/stream", {
      method: "POST",
      body: JSON.stringify({
        role: "teacher",
        sessionId,
        message: "Wait during inspection",
      }),
    });
    await inspectionStarted;

    current.beginShutdown();
    await current.close();
    await expect(responsePromise).resolves.toMatchObject({ status: 409 });

    expect(mock.createInputs).toHaveLength(0);
    expect(current.state.providerSessions.size).toBe(0);
    expect(current.state.activeProviderTurnReservations.size).toBe(0);
    expect(lifecycle).toEqual([
      "inspection-started",
      "inspection-aborted",
      "database-closed",
    ]);
    runtimes.splice(runtimes.indexOf(current), 1);
  });

  it.each(["createConversation", "addMessage"] as const)(
    "cancels a new provider session when %s fails during setup",
    async (failurePoint) => {
      const mock = new ScriptedProvider();
      const current = runtime({ providers: { mock } });
      const sessionId = await startActiveVersionedSession(
        current,
        `agent-policy-${failurePoint}-failure`,
      );
      if (failurePoint === "createConversation") {
        vi.spyOn(
          current.state.repository,
          "createConversation",
        ).mockRejectedValueOnce(new Error("injected conversation failure"));
      } else {
        vi.spyOn(current.state.repository, "addMessage").mockImplementationOnce(
          () => {
            throw new Error("injected message failure");
          },
        );
      }

      const response = await request(current.app, "/api/agent/stream", {
        method: "POST",
        body: JSON.stringify({
          role: "teacher",
          sessionId,
          message: "Fail setup safely",
        }),
      });
      expect(response.status).toBe(400);
      expect(mock.createInputs).toHaveLength(1);
      expect(mock.cancelCalls).toEqual([providerHandle]);
      expect(current.state.providerSessions.size).toBe(0);
      expect(current.state.activeProviderTurns.size).toBe(0);
      expect(current.state.activeProviderTurnReservations.size).toBe(0);
      expect(
        current.state.connection.sqlite
          .prepare(
            "SELECT count(*) AS count FROM agent_conversations WHERE role = 'teacher'",
          )
          .get(),
      ).toEqual({ count: 0 });
    },
  );

  it("rejects a pre-aborted turn before any provider access", async () => {
    const mock = new ScriptedProvider();
    const current = runtime({ providers: { mock } });
    const controller = new AbortController();
    controller.abort();

    const response = await request(current.app, "/api/agent/stream", {
      method: "POST",
      signal: controller.signal,
      body: JSON.stringify({ role: "teacher", message: "Already cancelled" }),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: safeCancellation });
    expect(mock.listCalls).toBe(0);
    expect(mock.createInputs).toHaveLength(0);
    expect(mock.cancelCalls).toEqual([]);
    expect(current.state.providerSessions.size).toBe(0);
    expect(current.state.activeProviderTurns.size).toBe(0);
    expect(current.state.activeProviderTurnReservations.size).toBe(0);
    expect(
      current.state.connection.sqlite
        .prepare(
          "SELECT count(*) AS count FROM agent_conversations WHERE role = 'teacher'",
        )
        .get(),
    ).toEqual({ count: 0 });
  });

  it.each(["createSession", "createConversation"] as const)(
    "cancels exactly once when aborted during delayed %s setup",
    async (phase) => {
      let releaseSetup!: () => void;
      const setupGate = new Promise<void>((resolve) => {
        releaseSetup = resolve;
      });
      let markSetupStarted!: () => void;
      const setupStarted = new Promise<void>((resolve) => {
        markSetupStarted = resolve;
      });
      const mock = new ScriptedProvider({
        ...(phase === "createSession"
          ? {
              beforeCreate: async () => {
                markSetupStarted();
                await setupGate;
              },
            }
          : {}),
      });
      const current = runtime({ providers: { mock } });
      if (phase === "createConversation") {
        const createConversation =
          current.state.repository.createConversation.bind(
            current.state.repository,
          );
        vi.spyOn(
          current.state.repository,
          "createConversation",
        ).mockImplementationOnce(async (input) => {
          markSetupStarted();
          await setupGate;
          return createConversation(input);
        });
      }
      const controller = new AbortController();
      const responsePromise = request(current.app, "/api/agent/stream", {
        method: "POST",
        signal: controller.signal,
        body: JSON.stringify({ role: "teacher", message: "Cancel setup" }),
      });

      await setupStarted;
      controller.abort();
      releaseSetup();
      const response = await responsePromise;
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: safeCancellation });
      expect(mock.createInputs).toHaveLength(1);
      expect(mock.cancelCalls).toEqual([providerHandle]);
      expect(current.state.providerSessions.size).toBe(0);
      expect(current.state.activeProviderTurns.size).toBe(0);
      expect(current.state.activeProviderTurnReservations.size).toBe(0);
      expect(
        current.state.connection.sqlite
          .prepare(
            "SELECT count(*) AS count FROM agent_conversations WHERE role = 'teacher'",
          )
          .get(),
      ).toEqual({ count: 0 });
      expect(
        current.state.connection.sqlite
          .prepare("SELECT count(*) AS count FROM agent_messages")
          .get(),
      ).toEqual({ count: 0 });
    },
  );

  it("pairs a delayed reused-session user commit with a cancelled terminal", async () => {
    let streamCount = 0;
    const mock = new ScriptedProvider({
      script: async function* (sessionId) {
        streamCount += 1;
        const content =
          streamCount === 1 ? "Established answer" : "Safe continuation";
        yield {
          type: "message.completed",
          sessionId,
          sequence: 0,
          timestamp,
          content,
        };
        yield {
          type: "session.completed",
          sessionId,
          sequence: 1,
          timestamp,
          reason: "completed",
        };
      },
    });
    const current = runtime({ providers: { mock } });

    const established = await request(current.app, "/api/agent/stream", {
      method: "POST",
      body: JSON.stringify({
        role: "teacher",
        message: "Establish reusable session",
      }),
    });
    expect(established.status).toBe(200);
    expect(await established.text()).toContain("Established answer");
    expect(mock.createInputs).toHaveLength(1);
    expect(current.state.providerSessions.size).toBe(1);
    const establishedConversationId = z
      .string()
      .uuid()
      .parse([...current.state.providerSessions.values()][0]?.conversationId);

    const controller = new AbortController();
    const originalRunSetup = current.state.providerRuntime.runSetup.bind(
      current.state.providerRuntime,
    );
    let setupCalls = 0;
    vi.spyOn(current.state.providerRuntime, "runSetup").mockImplementation(
      async (operation, signal, onAbortedResult) => {
        const result = await originalRunSetup(
          operation,
          signal,
          onAbortedResult,
        );
        setupCalls += 1;
        if (setupCalls === 2) {
          controller.abort();
        }
        return result;
      },
    );

    const abortedResponsePromise = request(current.app, "/api/agent/stream", {
      method: "POST",
      signal: controller.signal,
      body: JSON.stringify({
        role: "teacher",
        message: "Abort after committed setup",
      }),
    });

    const aborted = await abortedResponsePromise;
    expect(aborted.status).toBe(409);
    expect(await aborted.json()).toEqual({ error: safeCancellation });
    expect(streamCount).toBe(1);
    expect(mock.createInputs).toHaveLength(1);
    expect(mock.cancelCalls).toEqual([providerHandle]);
    expect(current.state.providerSessions.size).toBe(0);
    expect(current.state.activeProviderTurns.size).toBe(0);
    expect(current.state.activeProviderTurnReservations.size).toBe(0);
    expect(
      current.state.connection.sqlite
        .prepare(
          `SELECT role, content, status, sequence,
                  tool_events_json AS toolEventsJson,
                  raw_event_json AS rawEventJson
           FROM agent_messages WHERE conversation_id = ?
           ORDER BY sequence ASC`,
        )
        .all(establishedConversationId),
    ).toEqual([
      {
        role: "user",
        content: "Establish reusable session",
        status: "completed",
        sequence: 1,
        toolEventsJson: "[]",
        rawEventJson: null,
      },
      {
        role: "assistant",
        content: "Established answer",
        status: "completed",
        sequence: 2,
        toolEventsJson: "[]",
        rawEventJson: null,
      },
      {
        role: "user",
        content: "Abort after committed setup",
        status: "completed",
        sequence: 3,
        toolEventsJson: "[]",
        rawEventJson: null,
      },
      {
        role: "assistant",
        content: safeCancellation,
        status: "cancelled",
        sequence: 4,
        toolEventsJson: "[]",
        rawEventJson: null,
      },
    ]);

    const continuation = await request(current.app, "/api/agent/stream", {
      method: "POST",
      body: JSON.stringify({
        role: "teacher",
        message: "Continue after cancelled setup",
      }),
    });
    expect(continuation.status).toBe(200);
    expect(await continuation.text()).toContain("Safe continuation");
    expect(streamCount).toBe(2);
    expect(mock.createInputs).toHaveLength(2);
    expect(mock.cancelCalls).toEqual([providerHandle]);
    expect(current.state.providerSessions.size).toBe(1);
    expect(current.state.activeProviderTurns.size).toBe(0);
    expect(current.state.activeProviderTurnReservations.size).toBe(0);
    const continuationConversationId = z
      .string()
      .uuid()
      .parse([...current.state.providerSessions.values()][0]?.conversationId);
    expect(continuationConversationId).not.toBe(establishedConversationId);
    expect(
      current.state.connection.sqlite
        .prepare(
          `SELECT role, content, status, sequence,
                  tool_events_json AS toolEventsJson,
                  raw_event_json AS rawEventJson
           FROM agent_messages WHERE conversation_id = ?
           ORDER BY sequence ASC`,
        )
        .all(continuationConversationId),
    ).toEqual([
      {
        role: "user",
        content: "Continue after cancelled setup",
        status: "completed",
        sequence: 1,
        toolEventsJson: "[]",
        rawEventJson: null,
      },
      {
        role: "assistant",
        content: "Safe continuation",
        status: "completed",
        sequence: 2,
        toolEventsJson: "[]",
        rawEventJson: null,
      },
    ]);
    expect(
      current.state.connection.sqlite
        .prepare("SELECT count(*) AS count FROM agent_messages")
        .get(),
    ).toEqual({ count: 6 });
  });

  it("reports failure when a reused-session cancellation terminal cannot persist", async () => {
    const mock = new ScriptedProvider();
    const current = runtime({ providers: { mock } });
    const established = await request(current.app, "/api/agent/stream", {
      method: "POST",
      body: JSON.stringify({
        role: "teacher",
        message: "Establish session before persistence failure",
      }),
    });
    expect(established.status).toBe(200);
    await established.text();
    const conversationId = z
      .string()
      .uuid()
      .parse([...current.state.providerSessions.values()][0]?.conversationId);

    const originalAddMessage = current.state.repository.addMessage.bind(
      current.state.repository,
    );
    const controller = new AbortController();
    vi.spyOn(current.state.repository, "addMessage").mockImplementation(
      (input) => {
        if (input.role === "assistant" && input.status === "cancelled") {
          throw new Error("injected cancellation persistence failure");
        }
        const row = originalAddMessage(input);
        return row;
      },
    );
    const originalRunSetup = current.state.providerRuntime.runSetup.bind(
      current.state.providerRuntime,
    );
    let setupCalls = 0;
    vi.spyOn(current.state.providerRuntime, "runSetup").mockImplementation(
      async (operation, signal, onAbortedResult) => {
        const result = await originalRunSetup(
          operation,
          signal,
          onAbortedResult,
        );
        setupCalls += 1;
        if (setupCalls === 2) {
          controller.abort();
        }
        return result;
      },
    );

    const responsePromise = request(current.app, "/api/agent/stream", {
      method: "POST",
      signal: controller.signal,
      body: JSON.stringify({
        role: "teacher",
        message: "Abort before failed terminal persistence",
      }),
    });
    const response = await responsePromise;
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: safeFailure });
    expect(mock.cancelCalls).toEqual([providerHandle]);
    expect(current.state.providerSessions.size).toBe(0);
    expect(current.state.activeProviderTurns.size).toBe(0);
    expect(current.state.activeProviderTurnReservations.size).toBe(0);
    expect(
      current.state.connection.sqlite
        .prepare(
          `SELECT role, content, status, sequence,
                  tool_events_json AS toolEventsJson,
                  raw_event_json AS rawEventJson
           FROM agent_messages WHERE conversation_id = ?
           ORDER BY sequence ASC`,
        )
        .all(conversationId),
    ).toEqual([
      {
        role: "user",
        content: "Establish session before persistence failure",
        status: "completed",
        sequence: 1,
        toolEventsJson: "[]",
        rawEventJson: null,
      },
      {
        role: "assistant",
        content: "Safe answer",
        status: "completed",
        sequence: 2,
        toolEventsJson: "[]",
        rawEventJson: null,
      },
    ]);
  });

  it("keeps an aborted stream cancelled when the provider later completes", async () => {
    let releaseProvider!: () => void;
    const providerGate = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    let markProviderStarted!: () => void;
    const providerStarted = new Promise<void>((resolve) => {
      markProviderStarted = resolve;
    });
    const mock = new ScriptedProvider({
      script: async function* (sessionId) {
        markProviderStarted();
        await providerGate;
        yield {
          type: "message.completed",
          sessionId,
          sequence: 0,
          timestamp,
          content: "completion-after-abort-secret",
        };
        yield {
          type: "session.completed",
          sessionId,
          sequence: 1,
          timestamp,
          reason: "completed",
        };
      },
    });
    const current = runtime({ providers: { mock } });
    const controller = new AbortController();
    const response = await request(current.app, "/api/agent/stream", {
      method: "POST",
      signal: controller.signal,
      body: JSON.stringify({ role: "teacher", message: "Cancel streaming" }),
    });
    expect(response.status).toBe(200);
    const bodyPromise = response.text();
    await providerStarted;

    controller.abort();
    releaseProvider();
    const body = await bodyPromise;

    expect(body).toContain('"reason":"cancelled"');
    expect(body).not.toContain("completion-after-abort-secret");
    expect(mock.cancelCalls).toEqual([providerHandle]);
    expect(
      current.state.connection.sqlite
        .prepare(
          "SELECT content, status FROM agent_messages WHERE role = 'assistant'",
        )
        .get(),
    ).toEqual({ content: safeCancellation, status: "cancelled" });
    expect(current.state.activeProviderTurnReservations.size).toBe(0);
  });

  it("requires one-time disclosure for an exact external role", async () => {
    const mock = new ScriptedProvider();
    const { app, state } = runtime({ providers: { mock } });
    state.connection.sqlite
      .prepare(
        "UPDATE provider_hub_connections SET external = 1 WHERE connection_id = 'conn:mock'",
      )
      .run();
    const settings = await state.providerRuntime.settings();
    await state.providerRuntime.saveRoleProfiles(
      settings.roleProfiles.map((profile) =>
        profile.role === "tutor"
          ? {
              role: profile.role,
              mode: "connection" as const,
              connectionId: "conn:mock",
              modelId: "mock-deterministic",
            }
          : {
              role: profile.role,
              mode: profile.mode,
              connectionId: profile.connectionId,
              modelId: profile.modelId,
            },
      ),
    );

    const response = await request(app, "/api/agent/stream", {
      method: "POST",
      body: JSON.stringify({ role: "teacher", message: "External turn" }),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      failure: { code: "disclosure_required", retryable: false },
    });
    expect(mock.createInputs).toHaveLength(0);
  });

  it("rejects an unavailable exact role model without saving the profile", async () => {
    const mock = new ScriptedProvider();
    const { state } = runtime({ providers: { mock } });
    const settings = await state.providerRuntime.settings();

    await expect(
      state.providerRuntime.saveRoleProfiles(
        settings.roleProfiles.map((profile) =>
          profile.role === "tutor"
            ? {
                role: profile.role,
                mode: "connection" as const,
                connectionId: "conn:mock",
                modelId: "missing-mock-model",
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

  it("keeps non-development runtime in honest no-AI mode", async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const blockedMock = new ScriptedProvider();
      const blocked = runtime({
        providers: { mock: blockedMock },
        developmentMode: false,
      });
      const savedSettings = await request(blocked.app, "/api/settings", {
        method: "PUT",
        body: JSON.stringify(themeMutation),
      });
      expect(savedSettings.status).toBe(200);
      expect(await savedSettings.json()).toEqual({ saved: true });

      const settingsResponse = await request(blocked.app, "/api/settings");
      expect(settingsResponse.status).toBe(200);
      const settings = z
        .object({
          ai: z.object({
            roleProfiles: z.array(
              z.object({
                mode: z.literal("no-ai"),
                connectionId: z.null(),
                modelId: z.null(),
              }),
            ),
          }),
        })
        .parse(await settingsResponse.json());
      expect(settings.ai.roleProfiles).toHaveLength(4);
      expect(blockedMock.statusCalls).toBe(0);
      expect(blockedMock.listCalls).toBe(0);

      const blockedResponse = await request(blocked.app, "/api/agent/stream", {
        method: "POST",
        body: JSON.stringify({ role: "teacher", message: "Production turn" }),
      });
      expect(blockedResponse.status).toBe(409);
      expect(await blockedResponse.json()).toMatchObject({
        failure: { code: "ai_disabled", retryable: false },
      });
      expect(blockedMock.createInputs).toHaveLength(0);
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
    }
  });

  it("emits only the browser allowlist and persists no provider handle or raw event", async () => {
    const mock = new ScriptedProvider();
    const { app, state } = runtime({ providers: { mock } });

    const response = await request(app, "/api/agent/stream", {
      method: "POST",
      body: JSON.stringify({ role: "teacher", message: "Safe DTO" }),
    });
    expect(response.status).toBe(200);
    const turnId = z
      .string()
      .uuid()
      .parse(response.headers.get("X-Aptiloop-Agent-Turn-Id"));
    expect(response.headers.get("X-Aptiloop-Agent-Session-Id")).toBeNull();
    const body = await response.text();
    const events = parseSse(body);
    expect(events).toHaveLength(3);
    expect(events.every((event) => event.turnId === turnId)).toBe(true);
    expect(Object.keys(events[0]!).sort()).toEqual([
      "content",
      "turnId",
      "type",
    ]);
    expect(body).not.toContain(providerHandle);
    expect(body).not.toContain(providerMetadata);

    const conversation = z
      .object({ providerSessionId: z.string().nullable() })
      .parse(
        state.connection.sqlite
          .prepare(
            `SELECT provider_session_id AS providerSessionId
             FROM agent_conversations WHERE role = 'teacher'`,
          )
          .get(),
      );
    expect(conversation.providerSessionId).toBeNull();
    const messages = z
      .array(
        z.object({
          content: z.string(),
          toolEventsJson: z.string(),
          rawEventJson: z.string().nullable(),
        }),
      )
      .parse(
        state.connection.sqlite
          .prepare(
            `SELECT content, tool_events_json AS toolEventsJson,
                    raw_event_json AS rawEventJson
             FROM agent_messages ORDER BY sequence`,
          )
          .all(),
      );
    expect(messages).toHaveLength(2);
    expect(messages.every((message) => message.toolEventsJson === "[]")).toBe(
      true,
    );
    expect(messages.every((message) => message.rawEventJson === null)).toBe(
      true,
    );
    expect(JSON.stringify(messages)).not.toContain(providerHandle);
    expect(JSON.stringify(messages)).not.toContain(providerMetadata);
  });

  it("rejects a provider tool event, cancels it, and stores only a fixed error", async () => {
    const mock = new ScriptedProvider({ script: toolScript });
    const { app, state } = runtime({ providers: { mock } });

    const response = await request(app, "/api/agent/stream", {
      method: "POST",
      body: JSON.stringify({ role: "teacher", message: "No tools" }),
    });
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(parseSse(body).map((event) => event.type)).toEqual([
      "error",
      "session.completed",
    ]);
    expect(body).toContain(safeFailure);
    expect(body).not.toContain(rawToolPayload);
    expect(body).not.toContain("private-provider-tool");
    expect(body).not.toContain(providerHandle);
    expect(mock.cancelCalls).toEqual([providerHandle]);

    const assistant = z
      .object({
        content: z.string(),
        status: z.string(),
        toolEventsJson: z.string(),
        rawEventJson: z.string().nullable(),
      })
      .parse(
        state.connection.sqlite
          .prepare(
            `SELECT content, status, tool_events_json AS toolEventsJson,
                    raw_event_json AS rawEventJson
             FROM agent_messages WHERE role = 'assistant'`,
          )
          .get(),
      );
    expect(assistant).toEqual({
      content: safeFailure,
      status: "failed",
      toolEventsJson: "[]",
      rawEventJson: null,
    });
    expect(JSON.stringify(assistant)).not.toContain(rawToolPayload);
  });

  it("emits only typed summaries for allowlisted tool activity", async () => {
    const mock = new ScriptedProvider({ script: allowlistedToolScript });
    const { app, state } = runtime({ providers: { mock } });

    const response = await request(app, "/api/agent/stream", {
      method: "POST",
      body: JSON.stringify({ role: "teacher", message: "Use safe context" }),
    });
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(parseSse(body)).toEqual([
      expect.objectContaining({
        type: "tool.summary",
        name: "lesson.readLearnerSafeContext",
        status: "started",
      }),
      expect.objectContaining({
        type: "tool.summary",
        name: "lesson.readLearnerSafeContext",
        status: "completed",
      }),
      expect.objectContaining({
        type: "message.completed",
        content: "Learner-safe answer",
      }),
      expect.objectContaining({
        type: "session.completed",
        reason: "completed",
      }),
    ]);
    expect(body).not.toContain(rawToolPayload);
    expect(body).not.toContain("allowlisted-tool-call");

    const assistant = z
      .object({
        toolEventsJson: z.string(),
        rawEventJson: z.string().nullable(),
      })
      .parse(
        state.connection.sqlite
          .prepare(
            `SELECT tool_events_json AS toolEventsJson,
                    raw_event_json AS rawEventJson
             FROM agent_messages WHERE role = 'assistant'`,
          )
          .get(),
      );
    expect(assistant).toEqual({ toolEventsJson: "[]", rawEventJson: null });
  });

  it.each(adversarialEventCases)(
    "fails closed for a provider %s",
    async (_label, events, secret) => {
      const mock = new ScriptedProvider({
        script: async function* (sessionId) {
          yield* events(sessionId);
        },
      });
      const { app, state } = runtime({ providers: { mock } });

      const response = await request(app, "/api/agent/stream", {
        method: "POST",
        body: JSON.stringify({ role: "teacher", message: "Validate events" }),
      });
      expect(response.status).toBe(200);
      const body = await response.text();
      expect(parseSse(body)).toEqual([
        {
          type: "error",
          turnId: expect.any(String),
          message: safeFailure,
        },
        {
          type: "session.completed",
          turnId: expect.any(String),
          reason: "failed",
        },
      ]);
      expect(body).toContain(safeFailure);
      expect(body).not.toContain(secret);
      expect(body).not.toMatch(
        /provider\.private|provider_error|wrong-session|malformed-|object-reason|scalar-event|post-terminal/u,
      );
      expect(body).not.toContain(providerHandle);
      expect(mock.cancelCalls).toEqual([providerHandle]);
      expect(state.providerSessions.size).toBe(0);
      expect(state.activeProviderTurns.size).toBe(0);
      expect(state.activeProviderTurnReservations.size).toBe(0);
      expect(
        state.connection.sqlite
          .prepare(
            "SELECT content, status FROM agent_messages WHERE role = 'assistant'",
          )
          .get(),
      ).toEqual({ content: safeFailure, status: "failed" });
    },
  );

  it("does not disclose environment or unrelated private context to a role turn", async () => {
    const environmentSentinel = "environment-secret-must-not-reach-provider";
    const privateContextSentinel = "private-context-must-not-reach-provider";
    const previousOpenAiKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = environmentSentinel;
    try {
      const mock = new ScriptedProvider();
      const { app, state } = runtime({ providers: { mock } });
      await state.repository.setSetting(
        "privateContextSentinel",
        privateContextSentinel,
      );

      const response = await request(app, "/api/agent/stream", {
        method: "POST",
        body: JSON.stringify({
          role: "teacher",
          message: "Explain this bounded learner question",
        }),
      });
      await response.text();

      expect(response.status).toBe(200);
      expect(mock.streamInputs).toHaveLength(1);
      const providerPayload = z
        .object({
          task: z.literal("answer-within-lesson-scope"),
          scope: z.object({
            lesson: z.object({ topics: z.array(z.string()) }),
            unit: z.object({
              id: z.string(),
              openingPrompt: z.string(),
            }),
          }),
          learnerMessage: z.literal("Explain this bounded learner question"),
        })
        .parse(JSON.parse(mock.streamInputs[0]?.message ?? ""));
      expect(providerPayload.scope.lesson.topics.length).toBeGreaterThan(0);
      const providerView = JSON.stringify({
        createInputs: mock.createInputs,
        streamInputs: mock.streamInputs,
      });
      expect(providerView).not.toContain(environmentSentinel);
      expect(providerView).not.toContain(privateContextSentinel);
    } finally {
      if (previousOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previousOpenAiKey;
    }
  });

  it.each(budgetCases)(
    "cancels a turn that exceeds the %s budget",
    async (_label, script) => {
      const mock = new ScriptedProvider({ script });
      const { app, state } = runtime({ providers: { mock } });

      const response = await request(app, "/api/agent/stream", {
        method: "POST",
        body: JSON.stringify({ role: "teacher", message: "Bound this turn" }),
      });
      const body = await response.text();

      expect(response.status).toBe(200);
      expect(body).toContain(safeFailure);
      expect(mock.cancelCalls).toEqual([providerHandle]);
      const assistant = z
        .object({ content: z.string(), status: z.string() })
        .parse(
          state.connection.sqlite
            .prepare(
              "SELECT content, status FROM agent_messages WHERE role = 'assistant'",
            )
            .get(),
        );
      expect(assistant).toEqual({ content: safeFailure, status: "failed" });
    },
  );

  it("counts superseded deltas toward the cumulative output budget", async () => {
    const mock = new ScriptedProvider({
      script: authoritativeReplacementScript,
    });
    const { app, state } = runtime({ providers: { mock } });

    const response = await request(app, "/api/agent/stream", {
      method: "POST",
      body: JSON.stringify({ role: "teacher", message: "Replace the draft" }),
    });
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain(safeFailure);
    expect(mock.cancelCalls).toEqual([providerHandle]);
    expect(
      state.connection.sqlite
        .prepare(
          "SELECT content, status FROM agent_messages WHERE role = 'assistant'",
        )
        .get(),
    ).toEqual({ content: safeFailure, status: "failed" });
  });

  it("enforces cumulative output budgets across sequential turns in one provider session", async () => {
    const mock = new ScriptedProvider({
      script: cumulativeSessionOutputScript,
    });
    const { app, state } = runtime({ providers: { mock } });

    const first = await request(app, "/api/agent/stream", {
      method: "POST",
      body: JSON.stringify({ role: "teacher", message: "First bounded turn" }),
    });
    expect(first.status).toBe(200);
    expect(await first.text()).toContain("c".repeat(1_000));

    const second = await request(app, "/api/agent/stream", {
      method: "POST",
      body: JSON.stringify({ role: "teacher", message: "Second bounded turn" }),
    });
    expect(second.status).toBe(400);
    expect(await second.json()).toMatchObject({
      failure: { code: "budget_exceeded" },
    });
    expect(mock.createInputs).toHaveLength(1);
    expect(mock.cancelCalls).toEqual([]);
    expect(
      state.connection.sqlite
        .prepare(
          "SELECT status FROM agent_messages WHERE role = 'assistant' ORDER BY rowid",
        )
        .all(),
    ).toEqual([{ status: "completed" }]);
  });

  it("rejects a concurrent turn without disturbing sequential session reuse", async () => {
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let markFirstStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    let streamCount = 0;
    const mock = new ScriptedProvider({
      script: async function* (sessionId) {
        streamCount += 1;
        const currentStream = streamCount;
        if (currentStream === 1) {
          markFirstStarted();
          await firstGate;
        }
        yield {
          type: "message.completed",
          sessionId,
          sequence: 0,
          timestamp,
          content: `Sequential answer ${currentStream}`,
        };
        yield {
          type: "session.completed",
          sessionId,
          sequence: 1,
          timestamp,
          reason: "completed",
        };
      },
    });
    const { app, state } = runtime({ providers: { mock } });

    const first = await request(app, "/api/agent/stream", {
      method: "POST",
      body: JSON.stringify({
        role: "teacher",
        message: "First turn",
      }),
    });
    expect(first.status).toBe(200);
    const firstTurnId = z
      .string()
      .uuid()
      .parse(first.headers.get("X-Aptiloop-Agent-Turn-Id"));
    const firstBody = first.text();
    await firstStarted;

    const concurrent = await request(app, "/api/agent/stream", {
      method: "POST",
      body: JSON.stringify({
        role: "teacher",
        message: "Concurrent turn",
      }),
    });
    expect(concurrent.status).toBe(409);
    expect(await concurrent.json()).toEqual({
      error:
        "An agent turn is already active for this session, role, provider, and model.",
    });
    expect(concurrent.headers.get("X-Aptiloop-Agent-Turn-Id")).toBeNull();
    expect(mock.createInputs).toHaveLength(1);
    expect(mock.cancelCalls).toEqual([]);
    expect(state.providerSessions.size).toBe(1);
    expect(state.activeProviderTurns.has(firstTurnId)).toBe(true);
    expect(state.activeProviderTurnReservations.size).toBe(1);

    releaseFirst();
    expect(await firstBody).toContain("Sequential answer 1");
    expect(mock.cancelCalls).toEqual([]);
    expect(state.providerSessions.size).toBe(1);
    expect(state.activeProviderTurnReservations.size).toBe(0);

    const sequential = await request(app, "/api/agent/stream", {
      method: "POST",
      body: JSON.stringify({
        role: "teacher",
        message: "Later sequential turn",
      }),
    });
    expect(sequential.status).toBe(200);
    expect(await sequential.text()).toContain("Sequential answer 2");
    expect(mock.createInputs).toHaveLength(1);
    expect(mock.cancelCalls).toEqual([]);
    expect(streamCount).toBe(2);
    expect(state.providerSessions.size).toBe(1);
    expect(state.activeProviderTurnReservations.size).toBe(0);
  });

  it("holds the turn reservation through terminal assistant persistence", async () => {
    let releaseProvider!: () => void;
    const providerGate = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    let markProviderCompleted!: () => void;
    const providerCompleted = new Promise<void>((resolve) => {
      markProviderCompleted = resolve;
    });
    const mock = new ScriptedProvider({
      script: async function* (sessionId) {
        yield {
          type: "message.completed",
          sessionId,
          sequence: 0,
          timestamp,
          content: "Safe answer",
        };
        markProviderCompleted();
        await providerGate;
        yield {
          type: "session.completed",
          sessionId,
          sequence: 1,
          timestamp,
          reason: "completed",
        };
      },
    });
    const { app, state } = runtime({ providers: { mock } });

    const first = await request(app, "/api/agent/stream", {
      method: "POST",
      body: JSON.stringify({
        role: "teacher",
        message: "First persisted turn",
      }),
    });
    expect(first.status).toBe(200);
    const firstBody = first.text();
    await providerCompleted;
    expect(state.activeProviderTurnReservations.size).toBe(1);

    const concurrent = await request(app, "/api/agent/stream", {
      method: "POST",
      body: JSON.stringify({
        role: "teacher",
        message: "Blocked concurrent turn",
      }),
    });
    expect(concurrent.status).toBe(409);
    expect(await concurrent.json()).toEqual({
      error:
        "An agent turn is already active for this session, role, provider, and model.",
    });
    expect(
      state.connection.sqlite
        .prepare(
          "SELECT role, content FROM agent_messages ORDER BY sequence ASC",
        )
        .all(),
    ).toEqual([{ role: "user", content: "First persisted turn" }]);

    releaseProvider();
    expect(await firstBody).toContain("Safe answer");
    expect(state.activeProviderTurnReservations.size).toBe(0);

    const later = await request(app, "/api/agent/stream", {
      method: "POST",
      body: JSON.stringify({
        role: "teacher",
        message: "Later persisted turn",
      }),
    });
    expect(later.status).toBe(200);
    expect(await later.text()).toContain("Safe answer");
    expect(
      state.connection.sqlite
        .prepare(
          "SELECT role, content FROM agent_messages ORDER BY sequence ASC",
        )
        .all(),
    ).toEqual([
      { role: "user", content: "First persisted turn" },
      { role: "assistant", content: "Safe answer" },
      { role: "user", content: "Later persisted turn" },
      { role: "assistant", content: "Safe answer" },
    ]);
  });

  it("fails the browser turn when terminal assistant persistence fails", async () => {
    const mock = new ScriptedProvider();
    const { app, state } = runtime({ providers: { mock } });
    const originalAddMessage = state.repository.addMessage.bind(
      state.repository,
    );
    vi.spyOn(state.repository, "addMessage").mockImplementation((input) => {
      if (input.role === "assistant") {
        throw new Error("simulated persistence failure");
      }
      return originalAddMessage(input);
    });

    const response = await request(app, "/api/agent/stream", {
      method: "POST",
      body: JSON.stringify({
        role: "teacher",
        message: "Do not acknowledge an unpersisted answer",
      }),
    });
    expect(response.status).toBe(200);
    expect(parseSse(await response.text())).toEqual([
      {
        type: "message.delta",
        turnId: expect.any(String),
        content: "Safe answer",
      },
      {
        type: "error",
        turnId: expect.any(String),
        message: safeFailure,
      },
      {
        type: "session.completed",
        turnId: expect.any(String),
        reason: "failed",
      },
    ]);
    expect(
      state.connection.sqlite
        .prepare(
          "SELECT role, content FROM agent_messages ORDER BY sequence ASC",
        )
        .all(),
    ).toEqual([
      {
        role: "user",
        content: "Do not acknowledge an unpersisted answer",
      },
    ]);
    expect(mock.cancelCalls).toEqual([providerHandle]);
    expect(state.providerSessions.size).toBe(0);
    expect(state.activeProviderTurnReservations.size).toBe(0);
  });

  it("cancels a cached Tutor provider session when its connection is removed", async () => {
    const mock = new ScriptedProvider();
    const { app, state } = runtime({ providers: { mock } });
    const response = await request(app, "/api/agent/stream", {
      method: "POST",
      body: JSON.stringify({ role: "teacher", message: "Cache this turn" }),
    });
    expect(response.status).toBe(200);
    await response.text();
    expect(state.providerSessions.size).toBe(1);
    expect([...state.providerSessions.values()][0]?.connectionId).toBe(
      "conn:mock",
    );

    vi.spyOn(state.providerManagement, "remove").mockResolvedValue();
    const removed = await request(
      app,
      `/api/settings/ai/connections/${encodeURIComponent("conn:mock")}`,
      { method: "DELETE", body: "{}" },
    );

    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual({ removed: true });
    expect(mock.cancelCalls).toEqual([providerHandle]);
    expect(state.providerSessions.size).toBe(0);
  });

  it("cancels an externally scoped nested-key session by explicit connection ownership", async () => {
    const mock = new ScriptedProvider({ sessionId: "nested-provider-session" });
    const { app, state } = runtime({ providers: { mock } });
    const nestedKey = JSON.stringify([
      JSON.stringify([
        "learning-session",
        "learning-unit",
        "teacher",
        "conn:mock",
        "mock-deterministic",
      ]),
      randomUUID(),
    ]);
    state.providerSessions.set(nestedKey, {
      providerId: "mock",
      connectionId: "conn:mock",
      provider: mock,
      providerSessionId: mock.sessionId,
      conversationId: randomUUID(),
    });

    vi.spyOn(state.providerManagement, "remove").mockResolvedValue();
    const removed = await request(
      app,
      `/api/settings/ai/connections/${encodeURIComponent("conn:mock")}`,
      { method: "DELETE", body: "{}" },
    );

    expect(removed.status).toBe(200);
    expect(mock.cancelCalls).toEqual(["nested-provider-session"]);
    expect(state.providerSessions.size).toBe(0);
  });

  it("cancels only through the opaque app-owned turn route", async () => {
    const mock = new MockAgentProvider({ chunkSize: 1, delayMs: 20 });
    const { app, state } = runtime({ providers: { mock } });
    const response = await request(app, "/api/agent/stream", {
      method: "POST",
      body: JSON.stringify({ role: "teacher", message: "Cancel this turn" }),
    });
    expect(response.status).toBe(200);
    const body = response.text();
    await new Promise((resolve) => setTimeout(resolve, 60));
    const turnId = z
      .string()
      .uuid()
      .parse(response.headers.get("X-Aptiloop-Agent-Turn-Id"));
    const activeSession = [...state.providerSessions.values()][0];
    expect(activeSession).toBeDefined();
    expect(turnId).not.toBe(activeSession?.providerSessionId);

    const cancelled = await request(app, `/api/agent/turns/${turnId}`, {
      method: "DELETE",
    });
    expect(cancelled.status).toBe(200);
    expect(await cancelled.json()).toEqual({ cancelled: true });
    expect(await body).toContain('"reason":"cancelled"');
    expect(state.providerSessions.size).toBe(0);

    const removedProviderRoute = await request(
      app,
      `/api/agent/sessions/${activeSession?.providerSessionId}/turn`,
      { method: "DELETE" },
    );
    expect(removedProviderRoute.status).toBe(404);
  }, 15_000);
});
