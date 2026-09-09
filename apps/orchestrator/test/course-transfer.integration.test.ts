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

import {
  canonicalJson,
  finalizeCoursePackAuthoringDraft,
} from "@aptiloop/course-authoring-kit";
import { createRegistryMismatchCoursePackAuthoringDraftFixture } from "../../../packages/course-authoring-kit/test/fixture.js";
import {
  canonicalLearningKernelJson,
  learningKernelSha256,
  type LearningKernelFact,
} from "@aptiloop/learning-core";
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
  it("exports learnerScope-only progress and fails closed on a target without the installed revision", async () => {
    const source = runtime(true, "src");
    const courseRow = source.state.connection.sqlite
      .prepare(`SELECT id FROM courses ORDER BY id LIMIT 1`)
      .get() as { id: string };
    // Seeded development revisions carry preserved legacy content hashes and
    // are not representable as re-verifiable v1 revision snapshots, so the
    // transfer exports learnerScope-only progress bound to the locally
    // installed published revision (ADR 0012 decision 1).
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
    if (exportResponse.status !== 200) {
      throw new Error(`export failed: ${await exportResponse.text()}`);
    }
    const envelopeText = await exportResponse.text();
    const envelope = JSON.parse(envelopeText) as {
      manifest: {
        operationId: string;
        mode: string;
        originatingAppVersion: string;
        learnerScopeCourses: Array<{
          courseKey: string;
          revisionKey: string;
          revisionContentHash: string;
        }>;
      };
    };
    expect(envelope.manifest.mode).toBe("learnerScope");
    expect(envelope.manifest.originatingAppVersion).toMatch(/^\d+\.\d+\.\d+$/u);
    expect(envelope.manifest.learnerScopeCourses).toHaveLength(1);
    expect(envelope.manifest.learnerScopeCourses[0]).toMatchObject({
      courseKey: courseRow.id,
      revisionContentHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
    });

    // The preview and import surfaces the mode and app version explicitly.
    const target = runtime(false, "dst-empty");
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
      preview: { mode: string; appVersionMatches: boolean };
    };
    expect(validated.valid).toBe(true);
    expect(validated.preview.mode).toBe("learnerScope");
    expect(validated.preview.appVersionMatches).toBe(true);

    // The target does not hold the exact installed revision: commit fails
    // closed with a precise diagnostic instead of attaching progress to a
    // mismatched Course.
    const commitResponse = await request(
      target.app,
      `/api/course-transfer/validations/${validated.validationId}/commit`,
      {
        method: "POST",
        body: JSON.stringify({
          operationId: envelope.manifest.operationId,
          expectedEnvelopeHash: validated.envelopeHash,
        }),
      },
    );
    expect(commitResponse.status).toBe(409);
    const rejection = (await commitResponse.json()) as {
      diagnostics: Array<{ code: string; path: string }>;
    };
    expect(rejection.diagnostics[0]).toMatchObject({
      code: "TRANSFER_INSTALLED_REVISION_UNRESOLVED",
      path: "/manifest/learnerScopeCourses/0",
    });
  });

  it("reports an originating app version mismatch as a non-blocking preview warning", async () => {
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
          scopeNote: "Version mismatch probe",
          operationId: randomUUID(),
        }),
      },
    );
    if (exportResponse.status !== 200) {
      throw new Error(`export failed: ${await exportResponse.text()}`);
    }
    const envelopeText = await exportResponse.text();
    const previousVersion = process.env.APTILOOP_APP_VERSION;
    process.env.APTILOOP_APP_VERSION = "9.9.9";
    let target: ReturnType<typeof runtime>;
    try {
      target = runtime(true, "dst-version");
    } finally {
      if (previousVersion === undefined) {
        delete process.env.APTILOOP_APP_VERSION;
      } else {
        process.env.APTILOOP_APP_VERSION = previousVersion;
      }
    }
    const validateResponse = await request(
      target.app,
      "/api/course-transfer/validate",
      { method: "POST", body: envelopeText },
    );
    expect(validateResponse.status).toBe(200);
    const validated = (await validateResponse.json()) as {
      valid: boolean;
      preview: {
        mode: string;
        originatingAppVersion: string;
        appVersionMatches: boolean;
      };
    };
    // App version is metadata only: the mismatch warns but never blocks.
    expect(validated.valid).toBe(true);
    expect(validated.preview.mode).toBe("learnerScope");
    expect(validated.preview.originatingAppVersion).toMatch(/^\d+\.\d+\.\d+$/u);
    expect(validated.preview.originatingAppVersion).not.toBe("9.9.9");
    expect(validated.preview.appVersionMatches).toBe(false);
  });

  it("exports an active attempt and restores it as real ordered Git commits with source identities", async () => {
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
    if (exportResponse.status !== 200) {
      throw new Error(`export failed: ${await exportResponse.text()}`);
    }
    const envelopeText = await exportResponse.text();
    const envelope = JSON.parse(envelopeText) as {
      manifest: {
        operationId: string;
        attemptSnapshotCount: number;
        mode: string;
      };
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
    expect(envelope.manifest.mode).toBe("learnerScope");
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

describe("course transfer precise import diagnostics", () => {
  it("fails closed with a precise code for an unknown transfer format", async () => {
    const app = runtime(false, "fmt").app;
    const response = await request(app, "/api/course-transfer/validate", {
      method: "POST",
      body: JSON.stringify({
        format: "aptiloop.course-transfer-v9",
        formatVersion: 1,
      }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      valid: boolean;
      diagnostics: Array<{ code: string; path: string }>;
    };
    expect(body.valid).toBe(false);
    expect(body.diagnostics[0]).toMatchObject({
      code: "TRANSFER_FORMAT_UNKNOWN",
      path: "/format",
    });
  });

  it("fails closed with re-export guidance for an older format version", async () => {
    const app = runtime(false, "oldver").app;
    const response = await request(app, "/api/course-transfer/validate", {
      method: "POST",
      body: JSON.stringify({
        format: "aptiloop.course-transfer-v1",
        formatVersion: 0,
      }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      valid: boolean;
      diagnostics: Array<{ code: string; message: string }>;
    };
    expect(body.valid).toBe(false);
    expect(body.diagnostics[0]).toMatchObject({
      code: "TRANSFER_FORMAT_OLDER",
      path: "/formatVersion",
    });
    expect(body.diagnostics[0]!.message).toContain("re-export");
  });

  it("fails closed with update guidance for a newer format version", async () => {
    const app = runtime(false, "newver").app;
    const response = await request(app, "/api/course-transfer/validate", {
      method: "POST",
      body: JSON.stringify({
        format: "aptiloop.course-transfer-v1",
        formatVersion: 99,
      }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      valid: boolean;
      diagnostics: Array<{ code: string; message: string }>;
    };
    expect(body.valid).toBe(false);
    expect(body.diagnostics[0]).toMatchObject({
      code: "TRANSFER_FORMAT_NEWER",
      path: "/formatVersion",
    });
    expect(body.diagnostics[0]!.message).toContain("update the app");
  });

  it("surfaces the exact pack validation diagnostics on transfer import", async () => {
    const app = runtime(false, "packdiag").app;
    const response = await request(app, "/api/course-transfer/validate", {
      method: "POST",
      body: JSON.stringify({
        format: "aptiloop.course-transfer-v1",
        formatVersion: 1,
        manifest: {
          format: "aptiloop.course-transfer-v1",
          formatVersion: 1,
          createdAt: "2026-09-09T00:00:00.000Z",
          operationId: "fmt-probe",
          courseKeys: ["course-unknown"],
          includeHistory: true,
          scopeNote: "probe",
          packCount: 1,
          revisionSnapshotCount: 0,
          revisionSnapshotByteCount: 0,
          mode: "full",
          originatingAppVersion: "0.1.0",
          learnerScopeCourses: [],
          factCount: 0,
          sessionCount: 0,
          skippedSessionCount: 0,
          attemptSnapshotCount: 0,
          attemptByteCount: 0,
          droppedPendingTurnCount: 0,
          excluded: [],
        },
        packs: [
          {
            courseKey: "course-unknown",
            revisionKey: "revision-unknown",
            revisionNumber: 1,
            contentHash:
              "sha256:0000000000000000000000000000000000000000000000000000000000000000",
            canonicalJson: "{}",
          },
        ],
        revisionSnapshots: [],
        learnerScope: {
          bindings: [],
          facts: [],
          snapshots: [],
          checkpoints: [],
          sessionRefs: [],
          reviewItems: [],
          learnerCoursePointers: [],
          attemptSnapshots: [],
        },
      }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      valid: boolean;
      diagnostics: Array<{
        code: string;
        path: string;
        entityId: string | null;
      }>;
    };
    expect(body.valid).toBe(false);
    const packDiagnostics = body.diagnostics.filter((diagnostic) =>
      diagnostic.path.startsWith("/packs/revision-unknown"),
    );
    expect(packDiagnostics.length).toBeGreaterThan(0);
    // The root cause is surfaced precisely, not flattened into a generic
    // "pack invalid" message: the canonical pack body is not a valid Course
    // Pack, so the returned code names the exact pack rule that failed.
    expect(
      packDiagnostics.some(
        (diagnostic) =>
          diagnostic.code.startsWith("PACK_") &&
          diagnostic.entityId === "revision-unknown",
      ),
    ).toBe(true);
  });

  it("names the exact unknown trusted check requirement in pack diagnostics", async () => {
    const app = runtime(false, "reqdiag").app;
    const pack = finalizeCoursePackAuthoringDraft(
      createRegistryMismatchCoursePackAuthoringDraftFixture(),
    );
    const response = await request(app, "/api/course-transfer/validate", {
      method: "POST",
      body: JSON.stringify({
        format: "aptiloop.course-transfer-v1",
        formatVersion: 1,
        manifest: {
          format: "aptiloop.course-transfer-v1",
          formatVersion: 1,
          createdAt: "2026-09-09T00:00:00.000Z",
          operationId: "req-probe",
          courseKeys: [pack.course.courseKey],
          includeHistory: true,
          scopeNote: "probe",
          packCount: 1,
          revisionSnapshotCount: 0,
          revisionSnapshotByteCount: 0,
          mode: "full",
          originatingAppVersion: "0.1.0",
          learnerScopeCourses: [],
          factCount: 0,
          sessionCount: 0,
          skippedSessionCount: 0,
          attemptSnapshotCount: 0,
          attemptByteCount: 0,
          droppedPendingTurnCount: 0,
          excluded: [],
        },
        packs: [
          {
            courseKey: pack.course.courseKey,
            revisionKey: pack.revision.revisionKey,
            revisionNumber: pack.revision.revisionNumber,
            contentHash: pack.revision.contentHash,
            canonicalJson: canonicalJson(pack),
          },
        ],
        revisionSnapshots: [],
        learnerScope: {
          bindings: [],
          facts: [],
          snapshots: [],
          checkpoints: [],
          sessionRefs: [],
          reviewItems: [],
          learnerCoursePointers: [],
          attemptSnapshots: [],
        },
      }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      valid: boolean;
      diagnostics: Array<{
        code: string;
        path: string;
        entityId: string | null;
      }>;
    };
    expect(body.valid).toBe(false);
    // ADR 0012 decision 3: an unknown trusted check ID fails closed with the
    // precise code, pack-relative path, and the unknown ID as the entity.
    expect(
      body.diagnostics.find(
        (diagnostic) => diagnostic.code === "PACK_REQUIREMENT_UNAVAILABLE",
      ),
    ).toMatchObject({
      path: `/packs/${pack.revision.revisionKey}/requirements/checkIds/0`,
      entityId: "missing-check",
    });
  });

  it("fails closed with precise diagnostics for unknown kernel fact types", async () => {
    const app = runtime(false, "factdiag").app;
    const baseFact: LearningKernelFact = {
      schemaVersion: 1,
      courseId: "course-1",
      revisionId: "revision-1",
      branchId: "branch-1",
      sessionId: "session-1",
      id: "fact-unknown-type",
      operationId: "operation-unknown-type",
      occurredAt: "2026-09-09T00:00:00.000Z",
      provenance: {
        kind: "learner_submission",
        sourceId: "browser-operation",
        sourceHash: `sha256:${"a".repeat(64)}`,
      },
      body: {
        type: "evidence",
        activityId: "activity-1",
        knowledgeNodeIds: ["node-1"],
        dimension: "understanding",
        evidenceType: "recall",
        outcome: "unverified",
        hintLevel: 0,
        basisFactIds: [],
      },
    };
    const unknownType: LearningKernelFact = {
      ...baseFact,
      body: {
        ...baseFact.body,
        evidenceType: "telepathy",
      } as unknown as LearningKernelFact["body"],
    };
    const unknownShape = {
      ...baseFact,
      id: "fact-unknown-shape",
      operationId: "operation-unknown-shape",
      mysticPower: 9001,
    };
    const factEntry = (fact: LearningKernelFact) => ({
      id: fact.id,
      operationId: fact.operationId,
      courseId: fact.courseId,
      revisionId: fact.revisionId,
      branchId: fact.branchId,
      sessionId: fact.sessionId,
      lessonId: "lesson-1",
      activityId: "activity-1",
      bodyType: fact.body.type,
      occurredAt: fact.occurredAt,
      acceptedAt: fact.occurredAt,
      canonicalJson: canonicalLearningKernelJson(fact),
      factHash: learningKernelSha256(fact),
    });
    const response = await request(app, "/api/course-transfer/validate", {
      method: "POST",
      body: JSON.stringify({
        format: "aptiloop.course-transfer-v1",
        formatVersion: 1,
        manifest: {
          format: "aptiloop.course-transfer-v1",
          formatVersion: 1,
          createdAt: "2026-09-09T00:00:00.000Z",
          operationId: "fact-probe",
          courseKeys: ["course-unknown"],
          includeHistory: true,
          scopeNote: "probe",
          packCount: 1,
          revisionSnapshotCount: 0,
          revisionSnapshotByteCount: 0,
          mode: "full",
          originatingAppVersion: "0.1.0",
          learnerScopeCourses: [],
          factCount: 2,
          sessionCount: 0,
          skippedSessionCount: 0,
          attemptSnapshotCount: 0,
          attemptByteCount: 0,
          droppedPendingTurnCount: 0,
          excluded: [],
        },
        packs: [
          {
            courseKey: "course-unknown",
            revisionKey: "revision-unknown",
            revisionNumber: 1,
            contentHash:
              "sha256:0000000000000000000000000000000000000000000000000000000000000000",
            canonicalJson: "{}",
          },
        ],
        revisionSnapshots: [],
        learnerScope: {
          bindings: [],
          facts: [factEntry(unknownType), factEntry(unknownShape)],
          snapshots: [],
          checkpoints: [],
          sessionRefs: [],
          reviewItems: [],
          learnerCoursePointers: [],
          attemptSnapshots: [],
        },
      }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      valid: boolean;
      diagnostics: Array<{
        code: string;
        path: string;
        entityId: string | null;
        message: string;
      }>;
    };
    expect(body.valid).toBe(false);
    // ADR 0012 decision 3: an unknown evidence type is named precisely with
    // the fact entity and the in-fact path, never flattened or skipped.
    expect(
      body.diagnostics.find(
        (diagnostic) => diagnostic.code === "TRANSFER_FACT_UNKNOWN_TYPE",
      ),
    ).toMatchObject({
      path: "/learnerScope/facts/fact-unknown-type/body/evidenceType",
      entityId: "fact-unknown-type",
      message: "Unknown evidence type: telepathy",
    });
    expect(
      body.diagnostics.find(
        (diagnostic) => diagnostic.code === "TRANSFER_FACT_SHAPE_INVALID",
      ),
    ).toMatchObject({
      path: "/learnerScope/facts/fact-unknown-shape",
      entityId: "fact-unknown-shape",
      message: "fact contains unknown fields: mysticPower",
    });
  });
});
