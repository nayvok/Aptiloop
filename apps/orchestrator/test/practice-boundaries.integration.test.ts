import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { ReviewResultSchema } from "@dlh/shared";
import { afterEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";

const projectRoot = path.resolve("../..");
const cleanupRoots: string[] = [];
const runtimes: Array<ReturnType<typeof createApp>> = [];

afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.close();
  for (const root of cleanupRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function runtime() {
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
    exerciseAttemptsRoot: attemptsRoot,
  });
  runtimes.push(created);
  return created;
}

const request = (
  app: ReturnType<typeof createApp>["app"],
  requestPath: string,
  init?: RequestInit,
) =>
  app.request(requestPath, {
    ...init,
    headers: {
      "X-DLH-Client": "web",
      "Content-Type": "application/json",
      Origin: "http://127.0.0.1:3000",
      ...init?.headers,
    },
  });

async function createAttempt(runtimeValue: ReturnType<typeof createApp>) {
  const started = await request(runtimeValue.app, "/api/learning/sessions", {
    method: "POST",
    body: JSON.stringify({ dayNumber: 1 }),
  });
  const { id: sessionId } = (await started.json()) as { id: string };
  const exerciseResponse = await request(
    runtimeValue.app,
    `/api/exercises/current?sessionId=${sessionId}`,
  );
  const exercise = (await exerciseResponse.json()) as {
    id: string;
    workspacePath: string;
  };
  const attemptResponse = await request(
    runtimeValue.app,
    `/api/exercises/${exercise.id}/attempts`,
    {
      method: "POST",
      body: JSON.stringify({ sessionId }),
    },
  );
  const { id: attemptId } = (await attemptResponse.json()) as { id: string };
  const row = runtimeValue.state.connection.sqlite
    .prepare(
      "SELECT workspace_path AS workspacePath FROM exercise_attempts WHERE id = ?",
    )
    .get(attemptId) as { workspacePath: string };
  return { attemptId, exercise, sessionId, workspacePath: row.workspacePath };
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
    > & { id: string; criteria: string[]; workspacePath: string };
    expect(exercise).toMatchObject({
      id: "exercise-w1d1-normalize-profile-v2",
      workspacePath: "workspaces/exercises/week-01/day-01/normalize-profile",
    });
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

    const attemptResponse = await request(
      current.app,
      `/api/exercises/${exercise.id}/attempts`,
      {
        method: "POST",
        body: JSON.stringify({ sessionId }),
      },
    );
    expect(attemptResponse.status).toBe(201);
    const { id: attemptId } = (await attemptResponse.json()) as { id: string };
    const attempt = current.state.connection.sqlite
      .prepare(
        `SELECT exercise_id AS exerciseId, workspace_path AS workspacePath
         FROM exercise_attempts WHERE id = ?`,
      )
      .get(attemptId) as { exerciseId: string; workspacePath: string };
    expect(attempt.exerciseId).toBe("w1d1-normalize-profile");
    expect(attempt.workspacePath).toContain("practice-boundary-test-");
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
    expect(await resumed.json()).toEqual({ id: attempt.attemptId });
    expect(
      current.state.connection.sqlite
        .prepare("SELECT count(*) AS count FROM exercise_attempts")
        .get(),
    ).toEqual({ count: 1 });
  });

  it("accepts only a strict operation id and allowlisted command id", async () => {
    const current = runtime();
    const { attemptId } = await createAttempt(current);
    const rejected = await request(
      current.app,
      `/api/exercise-attempts/${attemptId}/commands`,
      {
        method: "POST",
        body: JSON.stringify({
          operationId: "test-operation-strict",
          commandId: "test",
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

  it("rejects review when there is no learner diff", async () => {
    const current = runtime();
    const { attemptId } = await createAttempt(current);
    const response = await request(
      current.app,
      `/api/exercise-attempts/${attemptId}/reviews`,
      { method: "POST", body: "{}" },
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
      `/api/exercise-attempts/${attemptId}/commands`,
      {
        method: "POST",
        body: JSON.stringify({
          operationId: "failed-test-operation",
          commandId: "test",
        }),
      },
    );
    expect(testResponse.status).toBe(200);
    expect((await testResponse.json()) as { status: string }).toMatchObject({
      status: "failed",
    });
    const retried = await request(
      current.app,
      `/api/exercise-attempts/${attemptId}/commands`,
      {
        method: "POST",
        body: JSON.stringify({
          operationId: "failed-test-operation",
          commandId: "test",
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
      { method: "POST", body: "{}" },
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
      `/api/exercise-attempts/${attemptId}/commands`,
      {
        method: "POST",
        body: JSON.stringify({
          operationId: "passing-test-operation",
          commandId: "test",
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
      { method: "POST", body: "{}" },
    );
    expect(reviewResponse.status).toBe(200);
    const reviewBody = (await reviewResponse.json()) as {
      id: string;
      [key: string]: unknown;
    };
    expect(reviewBody.id).toBeTruthy();
    const reviewResult: Record<string, unknown> = { ...reviewBody };
    delete reviewResult.id;
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

    const after = await request(
      current.app,
      `/api/exercise-attempts/${attemptId}/diff`,
    );
    expect((await after.json()) as { diff: string }).toEqual(beforeDiff);
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
