import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import { seedDevelopmentDatabase } from "./development-database-fixture.js";

const projectRoot = path.resolve("../..");
const roots: string[] = [];
const runtimes: Array<ReturnType<typeof createApp>> = [];

afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.close();
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function runtime(
  seed: boolean,
  label: string,
): ReturnType<typeof createApp> & {
  databasePath: string;
  attemptsRoot: string;
} {
  const databaseRoot = mkdtempSync(
    path.join(
      process.env.TEMP ?? projectRoot,
      `aptiloop-transfer-db-${label}-`,
    ),
  );
  const attemptsRoot = mkdtempSync(
    path.join(
      process.env.TEMP ?? projectRoot,
      `aptiloop-transfer-at-${label}-`,
    ),
  );
  roots.push(databaseRoot, attemptsRoot);
  const created = createApp({
    projectRoot,
    databasePath: path.join(databaseRoot, "test.sqlite"),
    databaseMode: "disposable",
    exerciseAttemptsRoot: attemptsRoot,
    webOrigin: "http://127.0.0.1:3000",
    ...(seed
      ? { developmentDatabaseInitializer: seedDevelopmentDatabase }
      : {}),
  });
  runtimes.push(created);
  return Object.assign(created, {
    databasePath: path.join(databaseRoot, "test.sqlite"),
    attemptsRoot,
  });
}

function request(
  app: ReturnType<typeof createApp>["app"],
  pathname: string,
  init?: RequestInit,
) {
  return app.request(`http://127.0.0.1:8787${pathname}`, {
    ...init,
    headers: {
      Host: "127.0.0.1:8787",
      "X-Aptiloop-Client": "web",
      "Content-Type": "application/json",
      Origin: "http://127.0.0.1:3000",
      ...init?.headers,
    },
  });
}

function runGit(cwd: string, args: readonly string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

async function jsonOrThrow(response: Response, step: string): Promise<unknown> {
  const text = await response.text();
  if (response.status !== 200 && response.status !== 201) {
    throw new Error(
      `${step} failed (${response.status}): ${text.slice(0, 400)}`,
    );
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(
      `${step} returned non-JSON (${response.status}): ${text.slice(0, 400)}`,
    );
  }
}

describe("course transfer with active attempt restore", () => {
  it("fails closed when the Course has no transferable content revision", async () => {
    const source = runtime(true, "src");
    const courseRow = source.state.connection.sqlite
      .prepare(`SELECT id FROM courses ORDER BY id LIMIT 1`)
      .get() as { id: string };
    const exportResponse = await request(
      source.app,
      "/api/course-transfer/export",
      {
        method: "POST",
        body: JSON.stringify({
          courseKeys: [courseRow.id],
          includeHistory: true,
          scopeNote: "Local smoke transfer probe",
          operationId: randomUUID(),
        }),
      },
    );
    // Seeded development revisions carry preserved legacy content hashes and
    // are not representable as re-verifiable v1 revision snapshots.
    expect(exportResponse.status).toBe(409);
    expect(await exportResponse.json()).toMatchObject({
      error: expect.stringContaining("no transferable content revision"),
    });
  });

  // Blocked on the v1 transfer contract: the only Courses that own `exercises`
  // rows (required for attempt materialization) are seeded development
  // Courses, and their revisions are not transferable in v1 (no pack manifest,
  // legacy content hash). A full export -> validate -> commit route test with
  // an active attempt needs an owner decision on either transferable seeded
  // revisions or a learnerScope-only envelope for locally installed Courses.
  it.skip("exports an active attempt and restores it as real ordered Git commits with source identities", async () => {
    const source = runtime(true, "src");

    const pathBody = (await jsonOrThrow(
      await request(source.app, "/api/learning/path"),
      "GET /api/learning/path",
    )) as {
      curriculum: { weeks: Array<{ days: Array<{ id: string }> }> };
    };
    const dayId = pathBody.curriculum.weeks[0]?.days[0]?.id;
    if (!dayId) throw new Error("Missing seeded Day 1");
    const started = (await jsonOrThrow(
      await request(source.app, "/api/learning/sessions/v2", {
        method: "POST",
        body: JSON.stringify({ dayId, operationId: "transfer-smoke" }),
      }),
      "POST /api/learning/sessions/v2",
    )) as { session: { id: string } };
    const sessionId = started.session.id;

    const beforeAttempt = (await jsonOrThrow(
      await request(
        source.app,
        `/api/exercises/current?sessionId=${encodeURIComponent(sessionId)}`,
      ),
      "GET /api/exercises/current",
    )) as Record<string, unknown> & { id: string };
    source.state.connection.sqlite
      .prepare(
        `UPDATE unit_progress
         SET status = 'ready', updated_at = ?
         WHERE session_id = ? AND unit_type = 'exercise'`,
      )
      .run(Date.now(), sessionId);
    const attemptResponse = await request(
      source.app,
      `/api/exercises/${beforeAttempt.id}/attempts`,
      { method: "POST", body: JSON.stringify({ sessionId }) },
    );
    const { id: attemptId } = (await jsonOrThrow(
      attemptResponse,
      "POST /api/exercises/:id/attempts",
    )) as { id: string };
    const attemptRow = source.state.connection.sqlite
      .prepare(
        `SELECT workspace_path AS workspacePath, baseline_hash AS baselineHash
         FROM exercise_attempts WHERE id = ?`,
      )
      .get(attemptId) as {
      workspacePath: string;
      baselineHash: string;
    };

    writeFileSync(
      path.join(attemptRow.workspacePath, "learner-step.md"),
      "learner-authored transfer step\n",
      "utf8",
    );
    runGit(attemptRow.workspacePath, ["add", "--all", "--", "."]);
    runGit(attemptRow.workspacePath, [
      "-c",
      "user.name=Ada Lovelace",
      "-c",
      "user.email=ada@example.test",
      "commit",
      "--no-verify",
      "--quiet",
      "--allow-empty",
      "-m",
      "learner transfer step",
    ]);

    const courseRow = source.state.connection.sqlite
      .prepare(`SELECT id FROM courses ORDER BY id LIMIT 1`)
      .get() as { id: string };
    const operationId = randomUUID();
    const exportResponse = await request(
      source.app,
      "/api/course-transfer/export",
      {
        method: "POST",
        body: JSON.stringify({
          courseKeys: [courseRow.id],
          includeHistory: true,
          scopeNote: "Local smoke transfer to a second disposable profile",
          operationId,
        }),
      },
    );
    const envelopeText = (await jsonOrThrow(
      exportResponse,
      "POST /api/course-transfer/export",
    )) as string;
    const envelope = JSON.parse(envelopeText) as {
      manifest: { operationId: string; attemptSnapshotCount: number };
      learnerScope: {
        attemptSnapshots: Array<{
          attemptId: string;
          baselineCommit: string;
          learnerCommits: Array<{
            sourceCommit: string;
            authorName: string;
            authorEmail: string;
            subject: string;
          }>;
        }>;
      };
    };
    expect(envelope.manifest.operationId).toBe(operationId);
    expect(envelope.manifest.attemptSnapshotCount).toBe(1);
    const snapshot = envelope.learnerScope.attemptSnapshots[0]!;
    expect(snapshot.attemptId).toBe(attemptId);
    expect(snapshot.learnerCommits).toHaveLength(1);
    expect(snapshot.learnerCommits[0]).toMatchObject({
      authorName: "Ada Lovelace",
      authorEmail: "ada@example.test",
      subject: "learner transfer step",
    });

    const target = runtime(true, "dst");
    const validateResponse = await request(
      target.app,
      "/api/course-transfer/validate",
      { method: "POST", body: envelopeText },
    );
    expect(validateResponse.status).toBe(200);
    const validated = (await validateResponse.json()) as {
      valid: boolean;
      validationId: string;
      envelopeHash: string;
    };
    expect(validated.valid).toBe(true);

    const commitResponse = await request(
      target.app,
      `/api/course-transfer/validations/${validated.validationId}/commit`,
      {
        method: "POST",
        body: JSON.stringify({
          operationId,
          expectedEnvelopeHash: validated.envelopeHash,
        }),
      },
    );
    expect(commitResponse.status).toBe(200);
    const committed = (await commitResponse.json()) as {
      restoredAttempts: number;
    };
    expect(committed.restoredAttempts).toBe(1);

    const restoredRow = target.state.connection.sqlite
      .prepare(
        `SELECT status, workspace_path AS workspacePath,
                baseline_hash AS baselineHash
         FROM exercise_attempts WHERE id = ?`,
      )
      .get(attemptId) as
      | {
          status: string;
          workspacePath: string;
          baselineHash: string;
        }
      | undefined;
    expect(restoredRow).toBeDefined();
    expect(restoredRow!.status).toBe("active");
    expect(existsSync(restoredRow!.workspacePath)).toBe(true);
    expect(restoredRow!.baselineHash).not.toBe(snapshot.baselineCommit);

    const restoredLog = runGit(restoredRow!.workspacePath, [
      "log",
      "--reverse",
      "--format=%P%x00%an%x00%ae%x00%B",
      `${restoredRow!.baselineHash}..HEAD`,
    ]);
    const fields = restoredLog
      .split("\u0000")
      .map((part) => part.replace(/\r?\n$/u, ""))
      .filter((part) => part.length > 0);
    expect(fields).toHaveLength(4);
    const [parentCommit, authorName, authorEmail, body] = fields as string[];
    expect(parentCommit).toBe(restoredRow!.baselineHash);
    expect(authorName).toBe("Ada Lovelace");
    expect(authorEmail).toBe("ada@example.test");
    expect(body).toContain(
      `Aptiloop imported learner commit ${snapshot.learnerCommits[0]!.sourceCommit}`,
    );
    expect(
      readFileSync(
        path.join(restoredRow!.workspacePath, "learner-step.md"),
        "utf8",
      ),
    ).toBe("learner-authored transfer step\n");
  });
});
