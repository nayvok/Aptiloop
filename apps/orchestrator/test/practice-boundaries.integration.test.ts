import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import type { AgentProvider } from "@dlh/agent-core";

import {
  ReviewResultSchema,
  type AgentEvent,
  type AgentSession,
  type CreateAgentSessionInput,
  type ReviewResult,
} from "@dlh/shared";
import { afterEach, describe, expect, it } from "vitest";

import { createApp, type AppOptions } from "../src/app.js";

const projectRoot = path.resolve("../..");
const cleanupRoots: string[] = [];
const runtimes: Array<ReturnType<typeof createApp>> = [];

afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.close();
  for (const root of cleanupRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

const fencedReviewResult: ReviewResult = {
  status: "passed",
  summary: "The bounded review result is valid.",
  findings: [],
  strengths: ["The implementation satisfies the tested contract."],
  suggestedMasteryChanges: [],
};

const safeAgentFailure = "The agent response was rejected by safety policy.";

type ReviewerEventScript = (
  sessionId: string,
  response: string,
) => AsyncIterable<AgentEvent>;

class FencedReviewProvider implements AgentProvider {
  readonly id: "mock" | "pi";
  readonly createInputs: CreateAgentSessionInput[] = [];
  readonly cancelCalls: string[] = [];
  response = `\`\`\`json\n${JSON.stringify(fencedReviewResult)}\n\`\`\``;
  script?: ReviewerEventScript;

  constructor(id: "mock" | "pi" = "mock") {
    this.id = id;
  }

  async getStatus() {
    return {
      providerId: this.id,
      state: "connected" as const,
      checkedAt: new Date().toISOString(),
      capabilities: [
        "streaming" as const,
        "models" as const,
        "cancellation" as const,
      ],
    };
  }

  async listModels() {
    return [
      {
        id: "mock-deterministic",
        providerId: this.id,
        name: "Fenced review model",
        supportsStreaming: true,
        available: true,
      },
    ];
  }

  async createSession(input: CreateAgentSessionInput): Promise<AgentSession> {
    this.createInputs.push(input);
    return {
      id: "private-review-provider-handle",
      providerId: this.id,
      role: input.role,
      modelId: input.modelId,
      status: "active",
      createdAt: new Date().toISOString(),
      metadata: { privateProviderMetadata: "review-metadata-must-not-persist" },
    };
  }

  async *streamMessage(): AsyncIterable<AgentEvent> {
    const timestamp = new Date().toISOString();
    const raw = this.response;
    if (this.script) {
      yield* this.script("private-review-provider-handle", raw);
      return;
    }
    yield {
      type: "message.completed",
      sessionId: "private-review-provider-handle",
      sequence: 0,
      timestamp,
      content: raw,
    };
    yield {
      type: "session.completed",
      sessionId: "private-review-provider-handle",
      sequence: 1,
      timestamp,
      reason: "completed",
    };
  }

  async cancelSession(sessionId: string) {
    this.cancelCalls.push(sessionId);
  }
}

const reviewerCommitBoundaryCases: Array<[string, ReviewerEventScript]> = [
  [
    "delta-only completion",
    async function* (sessionId, response) {
      const timestamp = new Date().toISOString();
      yield {
        type: "message.delta",
        sessionId,
        sequence: 0,
        timestamp,
        delta: response,
      };
      yield {
        type: "session.completed",
        sessionId,
        sequence: 1,
        timestamp,
        reason: "completed",
      };
    },
  ],
  [
    "out-of-order sequence",
    async function* (sessionId, response) {
      const timestamp = new Date().toISOString();
      yield {
        type: "message.completed",
        sessionId,
        sequence: 1,
        timestamp,
        content: response,
      };
      yield {
        type: "session.completed",
        sessionId,
        sequence: 0,
        timestamp,
        reason: "completed",
      };
    },
  ],
];

function runtime(providers?: AppOptions["providers"]) {
  const databaseRoot = mkdtempSync(
    path.join(process.env.TEMP ?? projectRoot, "dlh-practice-db-"),
  );
  const attemptsParent = path.join(projectRoot, ".data");
  mkdirSync(attemptsParent, { recursive: true });
  const attemptsRoot = mkdtempSync(
    path.join(attemptsParent, "practice-boundary-test-"),
  );
  cleanupRoots.push(databaseRoot, attemptsRoot);
  const created = createApp({
    projectRoot,
    databasePath: path.join(databaseRoot, "test.sqlite"),
    databaseMode: "disposable",
    exerciseAttemptsRoot: attemptsRoot,
    ...(providers ? { providers } : {}),
  });
  runtimes.push(created);
  return created;
}

const request = (
  app: ReturnType<typeof createApp>["app"],
  requestPath: string,
  init?: RequestInit,
) =>
  app.request(`http://127.0.0.1:8787${requestPath}`, {
    ...init,
    headers: {
      Host: "127.0.0.1:8787",
      "X-DLH-Client": "web",
      "Content-Type": "application/json",
      Origin: "http://127.0.0.1:3000",
      ...init?.headers,
    },
  });

async function createAttempt(runtimeValue: ReturnType<typeof createApp>) {
  const day = runtimeValue.state.connection.sqlite
    .prepare(
      `SELECT day.id
       FROM curriculum_days_v2 day
       JOIN curriculum_versions version ON version.id = day.version_id
       WHERE version.status = 'published' AND version.id != 'legacy-v1'
       ORDER BY version.revision DESC, day.order_index, day.id
       LIMIT 1`,
    )
    .get() as { id: string } | undefined;
  if (!day) throw new Error("Missing seeded versioned curriculum day");
  const session =
    await runtimeValue.state.repository.startOrResumeVersionedSession({
      dayId: day.id,
    });
  const sessionId = session.session.id;
  runtimeValue.state.connection.sqlite
    .prepare(
      `UPDATE unit_progress
       SET status = 'ready', updated_at = ?
       WHERE session_id = ? AND unit_type = 'exercise'`,
    )
    .run(Date.now(), sessionId);
  const exerciseResponse = await request(
    runtimeValue.app,
    `/api/exercises/current?sessionId=${sessionId}`,
  );
  const exercise = (await exerciseResponse.json()) as { id: string };
  const attemptResponse = await request(
    runtimeValue.app,
    `/api/exercises/${exercise.id}/attempts`,
    {
      method: "POST",
      body: JSON.stringify({ sessionId }),
    },
  );
  const { id: attemptId, workspace } = (await attemptResponse.json()) as {
    id: string;
    workspace: { id: string; generation: number };
  };
  const row = runtimeValue.state.connection.sqlite
    .prepare(
      "SELECT workspace_path AS workspacePath FROM exercise_attempts WHERE id = ?",
    )
    .get(attemptId) as { workspacePath: string };
  return {
    attemptId,
    exercise,
    sessionId,
    workspace,
    workspacePath: row.workspacePath,
  };
}

describe("practice execution and reviewer boundaries", () => {
  it("resolves the Day 1 v2 snapshot to a trusted isolated exercise template", async () => {
    const current = runtime();
    const templateFile = path.join(
      projectRoot,
      "workspaces/exercises/week-01/day-01/normalize-profile/src/normalize-profile.ts",
    );
    const sourceBefore = readFileSync(templateFile, "utf8");
    const learningPath = (await (
      await request(current.app, "/api/learning/path")
    ).json()) as {
      curriculum: { weeks: Array<{ days: Array<{ id: string }> }> };
    };
    const dayId = learningPath.curriculum.weeks[0]?.days[0]?.id;
    expect(dayId).toBeTruthy();
    const started = await request(current.app, "/api/learning/sessions/v2", {
      method: "POST",
      body: JSON.stringify({ dayId, operationId: "practice-v2-day-1" }),
    });
    expect(started.status).toBe(201);
    const startedBody = (await started.json()) as {
      session: { id: string };
    };
    const sessionId = startedBody.session.id;

    const exerciseResponse = await request(
      current.app,
      `/api/exercises/current?sessionId=${sessionId}`,
    );
    expect(exerciseResponse.status).toBe(200);
    const exercise = (await exerciseResponse.json()) as Record<
      string,
      unknown
    > & { id: string; criteria: string[]; workspace: null };
    expect(exercise).toMatchObject({
      id: "exercise-w1d1-normalize-profile-v2",
      workspace: null,
    });
    expect(exercise).not.toHaveProperty("workspacePath");
    expect(exercise.criteria.length).toBeGreaterThan(0);
    expect(exercise).not.toHaveProperty("referenceAnswer");
    expect(exercise).not.toHaveProperty("referenceApproach");

    const rejectedLegacyAlias = await request(
      current.app,
      "/api/exercises/w1d1-normalize-profile/attempts",
      {
        method: "POST",
        body: JSON.stringify({ sessionId }),
      },
    );
    expect(rejectedLegacyAlias.status).not.toBe(201);

    const prematureAttempt = await request(
      current.app,
      `/api/exercises/${exercise.id}/attempts`,
      {
        method: "POST",
        body: JSON.stringify({ sessionId }),
      },
    );
    expect(prematureAttempt.status).toBe(409);
    expect(await prematureAttempt.json()).toEqual({
      error: "Практика ещё заблокирована. Завершите предыдущие шаги занятия.",
    });
    expect(
      current.state.connection.sqlite
        .prepare("SELECT count(*) AS count FROM exercise_attempts")
        .get(),
    ).toEqual({ count: 0 });
    expect(readFileSync(templateFile, "utf8")).toBe(sourceBefore);
  });

  it("creates an isolated resumable attempt without changing the source template", async () => {
    const current = runtime();
    const templateFile = path.join(
      projectRoot,
      "workspaces/exercises/week-01/day-01/normalize-profile/src/normalize-profile.ts",
    );
    const sourceBefore = readFileSync(templateFile, "utf8");
    const attempt = await createAttempt(current);

    expect(attempt.workspacePath).toContain("practice-boundary-test-");
    expect(attempt.workspacePath).not.toContain(
      "workspaces\\exercises\\week-01\\day-01",
    );
    expect(readFileSync(templateFile, "utf8")).toBe(sourceBefore);

    const resumed = await request(
      current.app,
      `/api/exercises/${attempt.exercise.id}/attempts`,
      {
        method: "POST",
        body: JSON.stringify({ sessionId: attempt.sessionId }),
      },
    );
    expect(await resumed.json()).toEqual({
      id: attempt.attemptId,
      workspace: attempt.workspace,
    });
    expect(
      current.state.connection.sqlite
        .prepare("SELECT count(*) AS count FROM exercise_attempts")
        .get(),
    ).toEqual({ count: 1 });
  });

  it("accepts only a strict operation ID and allowlisted check ID", async () => {
    const current = runtime();
    const { attemptId } = await createAttempt(current);
    const rejected = await request(
      current.app,
      `/api/exercise-attempts/${attemptId}/checks`,
      {
        method: "POST",
        body: JSON.stringify({
          operationId: "test-operation-strict",
          checkIds: ["apt.compat.node24.npm-test.v1"],
          cwd: "C:/browser-controlled",
        }),
      },
    );
    expect(rejected.status).toBe(400);
    expect(
      current.state.connection.sqlite
        .prepare("SELECT count(*) AS count FROM test_runs")
        .get(),
    ).toEqual({ count: 0 });
  });

  it("rejects a persisted attempt path that no longer matches its server-owned id", async () => {
    const current = runtime();
    const { attemptId } = await createAttempt(current);
    const outsideRoot = mkdtempSync(
      path.join(process.env.TEMP ?? projectRoot, "dlh-attempt-escape-"),
    );
    cleanupRoots.push(outsideRoot);
    current.state.connection.sqlite
      .prepare("UPDATE exercise_attempts SET workspace_path = ? WHERE id = ?")
      .run(outsideRoot, attemptId);

    const response = await request(
      current.app,
      `/api/exercise-attempts/${attemptId}/diff`,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Exercise attempt workspace is unavailable or untrusted",
    });
  });

  it("rejects review when there is no learner diff", async () => {
    const current = runtime();
    const { attemptId } = await createAttempt(current);
    const response = await request(
      current.app,
      `/api/exercise-attempts/${attemptId}/reviews`,
      { method: "POST", body: JSON.stringify({ operationId: randomUUID() }) },
    );
    expect(response.status).toBe(409);
    expect(
      current.state.connection.sqlite
        .prepare("SELECT count(*) AS count FROM reviews")
        .get(),
    ).toEqual({ count: 0 });
  });

  it("blocks review when the latest allowlisted test run failed", async () => {
    const current = runtime();
    const { attemptId, workspacePath } = await createAttempt(current);
    const learnerFile = path.join(workspacePath, "src", "normalize-profile.ts");
    writeFileSync(
      learnerFile,
      `${readFileSync(learnerFile, "utf8")}\n// learner attempt\n`,
    );
    const testResponse = await request(
      current.app,
      `/api/exercise-attempts/${attemptId}/checks`,
      {
        method: "POST",
        body: JSON.stringify({
          operationId: "failed-test-operation",
          checkIds: ["apt.compat.node24.npm-test.v1"],
        }),
      },
    );
    expect(testResponse.status).toBe(200);
    expect((await testResponse.json()) as { status: string }).toMatchObject({
      status: "failed",
    });
    const retried = await request(
      current.app,
      `/api/exercise-attempts/${attemptId}/checks`,
      {
        method: "POST",
        body: JSON.stringify({
          operationId: "failed-test-operation",
          checkIds: ["apt.compat.node24.npm-test.v1"],
        }),
      },
    );
    expect(await retried.json()).toMatchObject({
      operationId: "failed-test-operation",
      status: "failed",
    });
    expect(
      current.state.connection.sqlite
        .prepare(
          "SELECT count(*) AS count FROM test_runs WHERE operation_id = ?",
        )
        .get("failed-test-operation"),
    ).toEqual({ count: 1 });

    const reviewResponse = await request(
      current.app,
      `/api/exercise-attempts/${attemptId}/reviews`,
      { method: "POST", body: JSON.stringify({ operationId: randomUUID() }) },
    );
    expect(reviewResponse.status).toBe(409);
    expect(
      current.state.connection.sqlite
        .prepare("SELECT count(*) AS count FROM reviews")
        .get(),
    ).toEqual({ count: 0 });
  }, 30_000);

  it("uses the configured mock reviewer, persists structured output, and leaves the diff exact", async () => {
    const current = runtime();
    const { attemptId, workspacePath } = await createAttempt(current);
    const learnerFile = path.join(workspacePath, "src", "normalize-profile.ts");
    writeFileSync(learnerFile, passingImplementation, "utf8");

    const testResponse = await request(
      current.app,
      `/api/exercise-attempts/${attemptId}/checks`,
      {
        method: "POST",
        body: JSON.stringify({
          operationId: "passing-test-operation",
          checkIds: ["apt.compat.node24.npm-test.v1"],
        }),
      },
    );
    expect(await testResponse.json()).toMatchObject({ status: "passed" });
    const before = await request(
      current.app,
      `/api/exercise-attempts/${attemptId}/diff`,
    );
    const beforeDiff = (await before.json()) as { diff: string };

    const reviewResponse = await request(
      current.app,
      `/api/exercise-attempts/${attemptId}/reviews`,
      {
        method: "POST",
        body: JSON.stringify({ operationId: "first-review-operation" }),
      },
    );
    expect(reviewResponse.status).toBe(200);
    const reviewBody = (await reviewResponse.json()) as {
      id: string;
      [key: string]: unknown;
    };
    expect(reviewBody.id).toBeTruthy();
    const evidenceBundle = reviewBody.evidenceBundle as {
      id: string;
      sha256: string;
      workspaceSnapshotHash: string;
    };
    expect(evidenceBundle).toMatchObject({
      id: expect.any(String),
      sha256: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
      workspaceSnapshotHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
    });
    const capsuleResponse = await request(
      current.app,
      `/api/exercise-attempts/${attemptId}/review-bundles/${evidenceBundle.id}`,
    );
    expect(capsuleResponse.status).toBe(200);
    const capsule = (await capsuleResponse.json()) as Record<string, unknown>;
    expect(capsule).toMatchObject({
      id: evidenceBundle.id,
      sha256: evidenceBundle.sha256,
      workspaceSnapshotHash: evidenceBundle.workspaceSnapshotHash,
      evidence: {
        schemaVersion: 1,
        kind: "apt.review-evidence.v1",
      },
    });
    expect(JSON.stringify(capsule)).not.toContain(workspacePath);
    const retriedReview = await request(
      current.app,
      `/api/exercise-attempts/${attemptId}/reviews`,
      {
        method: "POST",
        body: JSON.stringify({ operationId: "first-review-operation" }),
      },
    );
    expect(await retriedReview.json()).toMatchObject({
      id: reviewBody.id,
      evidenceBundle,
    });
    const reviewResult: Record<string, unknown> = { ...reviewBody };
    delete reviewResult.id;
    delete reviewResult.evidenceBundle;
    const result = ReviewResultSchema.parse(reviewResult);
    expect(result.status).toBe("changes_requested");
    const persisted = current.state.connection.sqlite
      .prepare(
        `SELECT provider_id AS providerId, model_id AS modelId,
                status, result_json AS resultJson
         FROM reviews WHERE exercise_attempt_id = ?`,
      )
      .get(attemptId) as {
      providerId: string;
      modelId: string;
      status: string;
      resultJson: string;
    };
    expect(persisted).toMatchObject({
      providerId: "mock",
      modelId: "mock-deterministic",
      status: result.status,
    });
    expect(ReviewResultSchema.parse(JSON.parse(persisted.resultJson))).toEqual(
      result,
    );
    const afterFirstReview = await request(
      current.app,
      `/api/exercise-attempts/${attemptId}/diff`,
    );
    expect((await afterFirstReview.json()) as { diff: string }).toEqual(
      beforeDiff,
    );

    writeFileSync(
      learnerFile,
      `${passingImplementation}\n// learner correction after read-only review\n`,
      "utf8",
    );
    const correctedTest = await request(
      current.app,
      `/api/exercise-attempts/${attemptId}/checks`,
      {
        method: "POST",
        body: JSON.stringify({
          operationId: "corrected-test-operation",
          checkIds: ["apt.compat.node24.npm-test.v1"],
        }),
      },
    );
    expect(await correctedTest.json()).toMatchObject({ status: "passed" });
    const correctedBeforeReview = (await (
      await request(current.app, `/api/exercise-attempts/${attemptId}/diff`)
    ).json()) as { diff: string };
    const correctedReview = await request(
      current.app,
      `/api/exercise-attempts/${attemptId}/reviews`,
      { method: "POST", body: JSON.stringify({ operationId: randomUUID() }) },
    );
    expect(correctedReview.status).toBe(200);
    expect(await correctedReview.json()).toMatchObject({ status: "passed" });
    expect(
      current.state.connection.sqlite
        .prepare(
          "SELECT count(*) AS count FROM reviews WHERE exercise_attempt_id = ?",
        )
        .get(attemptId),
    ).toEqual({ count: 2 });

    const after = await request(
      current.app,
      `/api/exercise-attempts/${attemptId}/diff`,
    );
    expect((await after.json()) as { diff: string }).toEqual(
      correctedBeforeReview,
    );
  }, 30_000);

  it("invalidates an idempotent passing test when content changes without a newer mtime", async () => {
    const current = runtime();
    const { attemptId, sessionId, workspacePath } =
      await createAttempt(current);
    const learnerFile = path.join(workspacePath, "src", "normalize-profile.ts");
    writeFileSync(learnerFile, passingImplementation, "utf8");

    const testResponse = await request(
      current.app,
      `/api/exercise-attempts/${attemptId}/checks`,
      {
        method: "POST",
        body: JSON.stringify({
          operationId: "same-mtime-passing-test",
          checkIds: ["apt.compat.node24.npm-test.v1"],
        }),
      },
    );
    expect(await testResponse.json()).toMatchObject({ status: "passed" });
    const persisted = current.state.connection.sqlite
      .prepare(
        `SELECT diff_fingerprint AS diffFingerprint,
                diff_truncated AS diffTruncated
         FROM test_runs WHERE operation_id = ?`,
      )
      .get("same-mtime-passing-test") as {
      diffFingerprint: string | null;
      diffTruncated: number;
    };
    expect(persisted.diffFingerprint).toMatch(/^[0-9a-f]{64}$/u);
    expect(persisted.diffTruncated).toBe(0);

    const timestamps = statSync(learnerFile);
    writeFileSync(
      learnerFile,
      `${passingImplementation}\n// changed while preserving the tested mtime\n`,
      "utf8",
    );
    utimesSync(learnerFile, timestamps.atime, timestamps.mtime);

    const idempotentRetry = await request(
      current.app,
      `/api/exercise-attempts/${attemptId}/checks`,
      {
        method: "POST",
        body: JSON.stringify({
          operationId: "same-mtime-passing-test",
          checkIds: ["apt.compat.node24.npm-test.v1"],
        }),
      },
    );
    expect(idempotentRetry.status).toBe(409);
    expect(
      current.state.connection.sqlite
        .prepare(
          "SELECT count(*) AS count FROM test_runs WHERE operation_id = ?",
        )
        .get("same-mtime-passing-test"),
    ).toEqual({ count: 1 });

    const resumed = (await (
      await request(
        current.app,
        `/api/exercises/current?sessionId=${sessionId}`,
      )
    ).json()) as {
      attempt?: { latestTestRun?: { workspaceCurrent?: boolean } };
    };
    expect(resumed.attempt?.latestTestRun?.workspaceCurrent).toBe(false);

    const reviewResponse = await request(
      current.app,
      `/api/exercise-attempts/${attemptId}/reviews`,
      { method: "POST", body: JSON.stringify({ operationId: randomUUID() }) },
    );
    expect(reviewResponse.status).toBe(409);
    expect(await reviewResponse.json()).toEqual({
      error:
        "Review requires a passing trusted check after the latest learner edit",
    });
  }, 30_000);

  it("rejects review when the tested diff exceeds the complete-diff limit", async () => {
    const current = runtime();
    const { attemptId, workspacePath } = await createAttempt(current);
    const learnerFile = path.join(workspacePath, "src", "normalize-profile.ts");
    writeFileSync(learnerFile, passingImplementation, "utf8");
    writeFileSync(
      path.join(workspacePath, "oversized-evidence.txt"),
      "x".repeat(1_010_000),
      "utf8",
    );

    const testResponse = await request(
      current.app,
      `/api/exercise-attempts/${attemptId}/checks`,
      {
        method: "POST",
        body: JSON.stringify({
          operationId: "truncated-diff-test",
          checkIds: ["apt.compat.node24.npm-test.v1"],
        }),
      },
    );
    expect(await testResponse.json()).toMatchObject({ status: "passed" });
    expect(
      current.state.connection.sqlite
        .prepare(
          `SELECT diff_fingerprint AS diffFingerprint,
                  diff_truncated AS diffTruncated
           FROM test_runs WHERE operation_id = ?`,
        )
        .get("truncated-diff-test"),
    ).toEqual({ diffFingerprint: null, diffTruncated: 1 });

    const reviewResponse = await request(
      current.app,
      `/api/exercise-attempts/${attemptId}/reviews`,
      { method: "POST", body: JSON.stringify({ operationId: randomUUID() }) },
    );
    expect(reviewResponse.status).toBe(409);
    expect(await reviewResponse.json()).toEqual({
      error:
        "Review requires a complete diff; the current diff exceeds the review limit",
    });
  }, 30_000);

  it.each(reviewerCommitBoundaryCases)(
    "rejects reviewer %s without persisting authoritative output",
    async (label, script) => {
      const provider = new FencedReviewProvider();
      provider.script = script;
      const current = runtime({ mock: provider });
      const { attemptId, workspacePath } = await createAttempt(current);
      writeFileSync(
        path.join(workspacePath, "src", "normalize-profile.ts"),
        passingImplementation,
        "utf8",
      );
      const operationId = `review-stream-${label.replaceAll(" ", "-")}`;
      const testResponse = await request(
        current.app,
        `/api/exercise-attempts/${attemptId}/checks`,
        {
          method: "POST",
          body: JSON.stringify({
            operationId,
            checkIds: ["apt.compat.node24.npm-test.v1"],
          }),
        },
      );
      expect(await testResponse.json()).toMatchObject({ status: "passed" });

      const reviewResponse = await request(
        current.app,
        `/api/exercise-attempts/${attemptId}/reviews`,
        { method: "POST", body: JSON.stringify({ operationId: randomUUID() }) },
      );

      expect(reviewResponse.status).toBe(400);
      expect(await reviewResponse.json()).toEqual({ error: safeAgentFailure });
      expect(provider.cancelCalls).toEqual(["private-review-provider-handle"]);
      expect(current.state.providerSessions.size).toBe(0);
      expect(current.state.activeProviderTurns.size).toBe(0);
      expect(
        current.state.connection.sqlite
          .prepare("SELECT count(*) AS count FROM reviews")
          .get(),
      ).toEqual({ count: 0 });
      expect(
        current.state.connection.sqlite
          .prepare(
            `SELECT content, status FROM agent_messages
             WHERE role = 'assistant'`,
          )
          .get(),
      ).toEqual({ content: safeAgentFailure, status: "failed" });
      expect(
        current.state.connection.sqlite
          .prepare(
            `SELECT count(*) AS count FROM agent_messages
             WHERE role = 'assistant' AND status = 'completed'`,
          )
          .get(),
      ).toEqual({ count: 0 });
    },
    30_000,
  );

  it("stores only canonical validated review output and no raw provider handle", async () => {
    const provider = new FencedReviewProvider();
    const current = runtime({ mock: provider });
    const { attemptId, sessionId, workspacePath } =
      await createAttempt(current);
    const learnerFile = path.join(workspacePath, "src", "normalize-profile.ts");
    writeFileSync(learnerFile, passingImplementation, "utf8");
    const testResponse = await request(
      current.app,
      `/api/exercise-attempts/${attemptId}/checks`,
      {
        method: "POST",
        body: JSON.stringify({
          operationId: "canonical-review-test",
          checkIds: ["apt.compat.node24.npm-test.v1"],
        }),
      },
    );
    expect(await testResponse.json()).toMatchObject({ status: "passed" });

    const reviewResponse = await request(
      current.app,
      `/api/exercise-attempts/${attemptId}/reviews`,
      { method: "POST", body: JSON.stringify({ operationId: randomUUID() }) },
    );
    expect(reviewResponse.status).toBe(200);
    expect(await reviewResponse.json()).toMatchObject(fencedReviewResult);

    const persisted = current.state.connection.sqlite
      .prepare(
        `SELECT result_json AS resultJson, raw_response AS rawResponse
         FROM reviews WHERE exercise_attempt_id = ?`,
      )
      .get(attemptId) as { resultJson: string; rawResponse: string | null };
    expect(persisted.rawResponse).toBeNull();
    expect(JSON.parse(persisted.resultJson)).toEqual(fencedReviewResult);

    const historyResponse = await request(
      current.app,
      `/api/agent/history?role=reviewer&sessionId=${sessionId}`,
    );
    const history = (await historyResponse.json()) as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(history.messages.at(-1)).toEqual({
      id: expect.any(String),
      role: "assistant",
      content: JSON.stringify(fencedReviewResult),
    });
    expect(JSON.stringify(history)).not.toContain("```json");
    expect(JSON.stringify(history)).not.toContain(
      "private-review-provider-handle",
    );

    const assistant = current.state.connection.sqlite
      .prepare(
        `SELECT tool_events_json AS toolEventsJson,
                raw_event_json AS rawEventJson
         FROM agent_messages WHERE role = 'assistant'`,
      )
      .get() as { toolEventsJson: string; rawEventJson: string | null };
    expect(assistant).toEqual({ toolEventsJson: "[]", rawEventJson: null });
    expect(
      current.state.connection.sqlite
        .prepare(
          `SELECT provider_session_id AS providerSessionId
           FROM agent_conversations WHERE role = 'reviewer'`,
        )
        .get(),
    ).toEqual({ providerSessionId: null });

    provider.response = "💣".repeat(70_000);
    writeFileSync(
      learnerFile,
      `${passingImplementation}\n// force a new reviewed diff\n`,
      "utf8",
    );
    const boundedTest = await request(
      current.app,
      `/api/exercise-attempts/${attemptId}/checks`,
      {
        method: "POST",
        body: JSON.stringify({
          operationId: "bounded-review-output-test",
          checkIds: ["apt.compat.node24.npm-test.v1"],
        }),
      },
    );
    expect(await boundedTest.json()).toMatchObject({ status: "passed" });
    const boundedReview = await request(
      current.app,
      `/api/exercise-attempts/${attemptId}/reviews`,
      { method: "POST", body: JSON.stringify({ operationId: randomUUID() }) },
    );
    expect(boundedReview.status).toBe(400);
    expect(await boundedReview.json()).toEqual({ error: safeAgentFailure });
    expect(provider.cancelCalls).toEqual(["private-review-provider-handle"]);
    expect(
      current.state.connection.sqlite
        .prepare("SELECT count(*) AS count FROM reviews")
        .get(),
    ).toEqual({ count: 1 });
    expect(
      current.state.connection.sqlite
        .prepare(
          `SELECT content, status, tool_events_json AS toolEventsJson,
                  raw_event_json AS rawEventJson
           FROM agent_messages WHERE role = 'assistant'
           ORDER BY sequence DESC LIMIT 1`,
        )
        .get(),
    ).toEqual({
      content: safeAgentFailure,
      status: "failed",
      toolEventsJson: "[]",
      rawEventJson: null,
    });
  }, 30_000);

  it("requires exact disclosure approval before an external reviewer request", async () => {
    const provider = new FencedReviewProvider("pi");
    const current = runtime({ pi: provider });
    const settingsResponse = await request(current.app, "/api/settings");
    const settings = (await settingsResponse.json()) as {
      ai: {
        roleProfiles: Array<{
          role: "course-designer" | "tutor" | "evaluator" | "reviewer";
          mode: "no-ai" | "connection";
          connectionId: string | null;
          modelId: string | null;
          requiredCapabilities: string[];
          toolPolicyId: string;
          budgets: {
            maxInputBytes: number;
            maxOutputBytes: number;
            maxEvents: number;
            maxToolCalls: number;
            deadlineMs: number;
          };
        }>;
      };
    };
    const profiles = settings.ai.roleProfiles.map((profile) => ({
      role: profile.role,
      mode:
        profile.role === "reviewer" ? ("connection" as const) : profile.mode,
      connectionId:
        profile.role === "reviewer" ? "conn:pi:openai" : profile.connectionId,
      modelId:
        profile.role === "reviewer" ? "mock-deterministic" : profile.modelId,
    }));
    const saved = await request(current.app, "/api/settings/ai", {
      method: "PUT",
      body: JSON.stringify({ roleProfiles: profiles }),
    });
    expect(saved.status).toBe(200);

    const { attemptId, workspacePath } = await createAttempt(current);
    writeFileSync(
      path.join(workspacePath, "src", "normalize-profile.ts"),
      passingImplementation,
      "utf8",
    );
    const testResponse = await request(
      current.app,
      `/api/exercise-attempts/${attemptId}/checks`,
      {
        method: "POST",
        body: JSON.stringify({
          operationId: "review-disclosure-check",
          checkIds: ["apt.compat.node24.npm-test.v1"],
        }),
      },
    );
    expect(await testResponse.json()).toMatchObject({ status: "passed" });

    const operationId = "review-disclosure-turn";
    const preview = await request(
      current.app,
      `/api/exercise-attempts/${attemptId}/reviews`,
      {
        method: "POST",
        body: JSON.stringify({ operationId, previewDisclosure: true }),
      },
    );
    const previewText = await preview.text();
    expect(preview.status).toBe(202);
    const previewBody = JSON.parse(previewText) as {
      kind: string;
      required: boolean;
      disclosure: { operationId: string };
    };
    expect(previewBody).toMatchObject({
      kind: "disclosure",
      required: true,
      disclosure: { operationId: expect.any(String) },
    });
    expect(provider.createInputs).toHaveLength(0);

    const approval = await request(
      current.app,
      `/api/ai/disclosures/${previewBody.disclosure.operationId}/approve`,
      { method: "POST", body: JSON.stringify({}) },
    );
    expect(approval.status).toBe(200);
    const review = await request(
      current.app,
      `/api/exercise-attempts/${attemptId}/reviews`,
      {
        method: "POST",
        body: JSON.stringify({
          operationId,
          disclosureOperationId: previewBody.disclosure.operationId,
        }),
      },
    );
    expect(review.status).toBe(200);
    expect(await review.json()).toMatchObject(fencedReviewResult);
    expect(provider.createInputs).toHaveLength(1);
  }, 30_000);

  it("rejects an oversized complete reviewer capsule before session creation", async () => {
    const provider = new FencedReviewProvider();
    const current = runtime({ mock: provider });
    const { attemptId, workspacePath } = await createAttempt(current);
    const learnerFile = path.join(workspacePath, "src", "normalize-profile.ts");
    writeFileSync(learnerFile, passingImplementation, "utf8");
    const operationId = "oversized-review-capsule-test";
    const testResponse = await request(
      current.app,
      `/api/exercise-attempts/${attemptId}/checks`,
      {
        method: "POST",
        body: JSON.stringify({
          operationId,
          checkIds: ["apt.compat.node24.npm-test.v1"],
        }),
      },
    );
    expect(await testResponse.json()).toMatchObject({ status: "passed" });
    current.state.connection.sqlite
      .prepare("UPDATE test_runs SET stdout = ? WHERE operation_id = ?")
      .run("x".repeat(2_600_000), operationId);

    const reviewResponse = await request(
      current.app,
      `/api/exercise-attempts/${attemptId}/reviews`,
      { method: "POST", body: JSON.stringify({ operationId: randomUUID() }) },
    );
    expect(reviewResponse.status).toBe(400);
    expect(await reviewResponse.json()).toMatchObject({
      failure: { code: "budget_exceeded", retryable: false },
    });
    expect(provider.createInputs).toHaveLength(0);
    expect(current.state.providerSessions.size).toBe(0);
    expect(
      current.state.connection.sqlite
        .prepare("SELECT count(*) AS count FROM reviews")
        .get(),
    ).toEqual({ count: 0 });
  }, 30_000);
});

const passingImplementation = `export interface NormalizedProfile {
  readonly id: string;
  readonly displayName: string;
  readonly age?: number;
  readonly tags: readonly string[];
}

export interface ProfileValidationIssue {
  readonly field: "profile" | "id" | "displayName" | "age" | "tags";
  readonly message: string;
}

export type NormalizeProfileResult =
  | { readonly ok: true; readonly profile: NormalizedProfile }
  | { readonly ok: false; readonly issues: readonly ProfileValidationIssue[] };

export function normalizeProfile(input: unknown): NormalizeProfileResult {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, issues: [{ field: "profile", message: "Ожидался объект" }] };
  }
  const value = input as Record<string, unknown>;
  const issues: ProfileValidationIssue[] = [];
  if (typeof value.id !== "string" || value.id.trim() === "")
    issues.push({ field: "id", message: "Нужна непустая строка" });
  if (!("displayName" in value))
    issues.push({ field: "displayName", message: "Поле обязательно" });
  else if (typeof value.displayName !== "string")
    issues.push({ field: "displayName", message: "Ожидалась строка" });
  if ("age" in value && (!Number.isInteger(value.age) || (value.age as number) < 0))
    issues.push({ field: "age", message: "Нужно целое неотрицательное число" });
  if ("tags" in value && (!Array.isArray(value.tags) || value.tags.some((tag) => typeof tag !== "string")))
    issues.push({ field: "tags", message: "Ожидался массив строк" });
  if (issues.length > 0) return { ok: false, issues };
  const profile: { id: string; displayName: string; age?: number; tags: string[] } = {
    id: (value.id as string).trim(),
    displayName: (value.displayName as string).trim(),
    tags: Array.isArray(value.tags) ? value.tags.map((tag) => (tag as string).trim()) : [],
  };
  if ("age" in value) profile.age = value.age as number;
  return { ok: true, profile };
}
`;
