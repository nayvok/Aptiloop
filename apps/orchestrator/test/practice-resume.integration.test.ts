import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";

const projectRoot = path.resolve("../..");
const roots: string[] = [];
const runtimes: Array<ReturnType<typeof createApp>> = [];

afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.close();
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function runtime(databasePath?: string, attemptsRoot?: string) {
  const databaseRoot = databasePath
    ? path.dirname(databasePath)
    : mkdtempSync(path.join(process.env.TEMP ?? projectRoot, "dlh-resume-db-"));
  const resolvedDatabasePath =
    databasePath ?? path.join(databaseRoot, "test.sqlite");
  const resolvedAttemptsRoot =
    attemptsRoot ??
    mkdtempSync(
      path.join(process.env.TEMP ?? projectRoot, "dlh-resume-attempt-"),
    );
  if (!databasePath) roots.push(databaseRoot);
  if (!attemptsRoot) roots.push(resolvedAttemptsRoot);
  mkdirSync(resolvedAttemptsRoot, { recursive: true });
  const created = createApp({
    projectRoot,
    databasePath: resolvedDatabasePath,
    exerciseAttemptsRoot: resolvedAttemptsRoot,
  });
  runtimes.push(created);
  return {
    ...created,
    databasePath: resolvedDatabasePath,
    attemptsRoot: resolvedAttemptsRoot,
  };
}

function request(
  app: ReturnType<typeof createApp>["app"],
  pathname: string,
  init?: RequestInit,
) {
  return app.request(pathname, {
    ...init,
    headers: {
      "X-DLH-Client": "web",
      "Content-Type": "application/json",
      Origin: "http://127.0.0.1:3000",
      ...init?.headers,
    },
  });
}

function collectKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, keys);
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      keys.add(key);
      collectKeys(item, keys);
    }
  }
  return keys;
}

describe("restart-safe versioned practice", () => {
  it("restores the exact current diff, latest test, and parsed review without leaking raw data", async () => {
    const first = runtime();
    const pathBody = (await (
      await request(first.app, "/api/learning/path")
    ).json()) as {
      curriculum: { weeks: Array<{ days: Array<{ id: string }> }> };
    };
    const dayId = pathBody.curriculum.weeks[0]?.days[0]?.id;
    if (!dayId) throw new Error("Missing seeded Day 1");
    const started = (await (
      await request(first.app, "/api/learning/sessions/v2", {
        method: "POST",
        body: JSON.stringify({ dayId, operationId: "practice-resume" }),
      })
    ).json()) as { session: { id: string } };
    const sessionId = started.session.id;

    const beforeAttempt = (await (
      await request(
        first.app,
        `/api/exercises/current?sessionId=${encodeURIComponent(sessionId)}`,
      )
    ).json()) as Record<string, unknown> & { id: string };
    expect(beforeAttempt).toMatchObject({
      sessionId,
      workspacePath: null,
      exerciseUnitId: expect.any(String),
      reviewUnitId: expect.any(String),
      exerciseUnitProgress: {
        status: expect.any(String),
        payload: { type: "exercise" },
      },
    });

    const attemptResponse = await request(
      first.app,
      `/api/exercises/${beforeAttempt.id}/attempts`,
      {
        method: "POST",
        body: JSON.stringify({ sessionId }),
      },
    );
    const { id: attemptId } = (await attemptResponse.json()) as { id: string };
    const attemptRow = first.state.connection.sqlite
      .prepare(
        "SELECT workspace_path AS workspacePath FROM exercise_attempts WHERE id = ?",
      )
      .get(attemptId) as { workspacePath: string };
    writeFileSync(
      path.join(attemptRow.workspacePath, "learner-note.txt"),
      "learner-authored change\n",
      "utf8",
    );

    const now = Date.now();
    first.state.connection.sqlite
      .prepare(
        `INSERT INTO test_runs
         (id, exercise_attempt_id, operation_id, status, exit_code, stdout,
          stderr, duration_ms, started_at, completed_at)
         VALUES ('test-latest', ?, 'operation-latest', 'passed', 0,
                 '12 tests passed', '', 42, ?, ?)`,
      )
      .run(attemptId, now, now + 5_000);
    first.state.connection.sqlite
      .prepare(
        `INSERT INTO reviews
         (id, session_id, exercise_attempt_id, provider_id, model_id, status,
          result_json, raw_response, created_at, completed_at)
         VALUES ('review-latest', ?, ?, 'mock', 'mock-deterministic', 'passed',
                 ?, 'RAW_PROVIDER_SECRET_MUST_NOT_LEAK', ?, ?)`,
      )
      .run(
        sessionId,
        attemptId,
        JSON.stringify({
          status: "passed",
          summary: "Решение соответствует критериям",
          findings: [],
          strengths: ["Сохранена чистая функция"],
          suggestedMasteryChanges: [],
        }),
        now + 6_000,
        now + 6_000,
      );

    const readState = async (app: ReturnType<typeof createApp>["app"]) => {
      const response = await request(
        app,
        `/api/exercises/current?sessionId=${encodeURIComponent(sessionId)}`,
      );
      expect(response.status).toBe(200);
      return (await response.json()) as Record<string, unknown> & {
        workspacePath: string;
        attempt: {
          diff: { patch: string; changed: boolean; truncated: boolean };
          latestTestRun: Record<string, unknown>;
          latestReview: Record<string, unknown>;
        };
      };
    };
    const beforeRestart = await readState(first.app);
    expect(beforeRestart.workspacePath).toBe(attemptRow.workspacePath);
    expect(beforeRestart.attempt.diff).toMatchObject({
      changed: true,
      truncated: false,
    });
    expect(beforeRestart.attempt.diff.patch).toContain("learner-note.txt");
    expect(beforeRestart.attempt.latestTestRun).toEqual({
      id: "test-latest",
      operationId: "operation-latest",
      status: "passed",
      exitCode: 0,
      output: "12 tests passed",
      workspaceCurrent: true,
    });
    expect(beforeRestart.attempt.latestReview).toEqual({
      id: "review-latest",
      status: "passed",
      summary: "Решение соответствует критериям",
      findings: [],
      strengths: ["Сохранена чистая функция"],
    });
    expect(collectKeys(beforeRestart)).not.toContain("rawResponse");
    expect(JSON.stringify(beforeRestart)).not.toContain("RAW_PROVIDER_SECRET");
    expect(collectKeys(beforeRestart)).not.toContain("referenceAnswer");
    expect(collectKeys(beforeRestart)).not.toContain("protectedEvaluation");

    await first.close();
    const index = runtimes.findIndex(
      (candidate) => candidate.app === first.app,
    );
    if (index >= 0) runtimes.splice(index, 1);
    const restarted = runtime(first.databasePath, first.attemptsRoot);
    const afterRestart = await readState(restarted.app);
    expect(afterRestart).toEqual(beforeRestart);

    const learnerNote = path.join(attemptRow.workspacePath, "learner-note.txt");
    writeFileSync(
      learnerNote,
      "learner-authored correction after review\n",
      "utf8",
    );
    utimesSync(learnerNote, new Date(now + 10_000), new Date(now + 10_000));
    const stale = await readState(restarted.app);
    expect(stale.attempt.latestTestRun).toMatchObject({
      id: "test-latest",
      status: "passed",
      workspaceCurrent: false,
    });
    expect(stale.attempt.latestReview).toBeNull();
    const rejectedStaleReview = await request(
      restarted.app,
      `/api/exercise-attempts/${encodeURIComponent(attemptId)}/reviews`,
      { method: "POST", body: "{}" },
    );
    expect(rejectedStaleReview.status).toBe(409);
    expect(await rejectedStaleReview.json()).toEqual({
      error: "Review requires a passing test run after the latest learner edit",
    });
  });
});
