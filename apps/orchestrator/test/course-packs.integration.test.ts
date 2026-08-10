import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  createDevelopmentCoursePackFixture,
  validateCoursePackBytes,
} from "@dlh/course-authoring-kit";
import {
  createCourseFoundationRepository,
  createCoursePackRepository,
  createLearningRepository,
  migrateDatabase,
  openDatabase,
} from "@dlh/database";
import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";

import { registerCoursePackRoutes } from "../src/course-packs.js";
import { registerVersionedLearningRoutes } from "../src/learning-v2.js";

const cleanups: Array<() => Promise<void> | void> = [];
const encoder = new TextEncoder();

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

async function fixture() {
  const connection = openDatabase(":memory:");
  migrateDatabase(connection);
  cleanups.push(() => connection.close());
  const stagingRoot = await mkdtemp(
    path.join(tmpdir(), "aptiloop-course-pack-route-test-"),
  );
  cleanups.push(() => rm(stagingRoot, { recursive: true, force: true }));
  const app = new Hono();
  let sequence = 0;
  registerCoursePackRoutes(app, createCoursePackRepository(connection), {
    now: () => Date.UTC(2026, 7, 10) + sequence,
    id: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
    stagingRoot,
  });
  registerVersionedLearningRoutes(app, {
    connection,
    repository: createLearningRepository(connection),
    courseFoundationRepository: createCourseFoundationRepository(connection),
  });
  return { app, connection, stagingRoot };
}

function jsonRequest(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

describe("Course Pack HTTP lifecycle", () => {
  it("validates, previews, commits, exports, and explicitly uninstalls", async () => {
    const { app, stagingRoot } = await fixture();
    const pack = createDevelopmentCoursePackFixture();
    const validationResponse = await app.request(
      "/api/course-packs/validate",
      jsonRequest(pack),
    );
    expect(validationResponse.status).toBe(200);
    const preview = (await validationResponse.json()) as {
      valid: true;
      validationId: string;
      preview: { contentHash: string; courseKey: string };
    };
    expect(preview).toMatchObject({
      valid: true,
      preview: {
        contentHash: pack.revision.contentHash,
        courseKey: pack.course.courseKey,
      },
    });
    expect(await readdir(stagingRoot)).toHaveLength(1);

    const mismatch = await app.request(
      `/api/course-packs/validations/${preview.validationId}/commit`,
      jsonRequest({
        operationId: "install-pack",
        action: "install",
        expectedContentHash: `sha256:${"f".repeat(64)}`,
      }),
    );
    expect(mismatch.status).toBe(409);
    expect(await readdir(stagingRoot)).toHaveLength(1);

    const commit = await app.request(
      `/api/course-packs/validations/${preview.validationId}/commit`,
      jsonRequest({
        operationId: "install-pack",
        action: "install",
        expectedContentHash: preview.preview.contentHash,
      }),
    );
    expect(commit.status).toBe(201);
    expect(await commit.json()).toMatchObject({
      result: {
        revisionId: pack.revision.revisionKey,
        revisionStatus: "published",
      },
    });
    expect(await readdir(stagingRoot)).toEqual([]);
    const opened = await app.request(
      `/api/learning/courses/${encodeURIComponent(pack.course.courseKey)}/revisions/${encodeURIComponent(pack.revision.revisionKey)}/path`,
    );
    expect(opened.status).toBe(200);
    const openedBody = await opened.json();
    expect(openedBody).toMatchObject({
      curriculum: {
        id: pack.course.courseKey,
        title: pack.course.title,
        version: { id: pack.revision.revisionKey, status: "published" },
        weeks: [
          {
            days: [
              {
                stableId: "replay-lesson",
                status: "available",
                units: [
                  { stableId: "study-replay", status: "ready" },
                  { stableId: "recall-replay", status: "locked" },
                ],
              },
            ],
          },
        ],
      },
    });
    const lessonId = (
      openedBody as {
        curriculum: { weeks: Array<{ days: Array<{ id: string }> }> };
      }
    ).curriculum.weeks[0]?.days[0]?.id;
    expect(lessonId).toBeTypeOf("string");
    const started = await app.request(
      "/api/learning/sessions/v2",
      jsonRequest({ dayId: lessonId, operationId: "start-installed-pack" }),
    );
    expect(started.status).toBe(201);
    const startedBody = (await started.json()) as { session: { id: string } };
    const kernel = await app.request(
      `/api/learning/sessions/v2/${startedBody.session.id}/kernel`,
    );
    expect(kernel.status).toBe(200);
    const kernelBody = (await kernel.json()) as {
      projection: {
        nextAction: { type: string; activityId?: string };
        projectionHash: string;
        summary: { sourceFactIds: string[] };
      };
    };
    expect(kernelBody).toMatchObject({
      scope: {
        courseId: pack.course.courseKey,
        revisionId: pack.revision.revisionKey,
      },
      projection: {
        summary: { sourceFactIds: [] },
      },
    });
    const kernelActivityId = kernelBody.projection.nextAction.activityId;
    expect(kernelActivityId).toBeTypeOf("string");
    const transitionEndpoint = `/api/learning/sessions/v2/${startedBody.session.id}/kernel/activities/${kernelActivityId}/transitions`;
    const transitionBody = {
      operationId: "start-installed-pack-activity",
      transition: "start",
    };
    const transitioned = await app.request(
      transitionEndpoint,
      jsonRequest(transitionBody),
    );
    expect(transitioned.status).toBe(201);
    const transitionedBody = (await transitioned.json()) as {
      idempotent: boolean;
      projection: { projectionHash: string };
    };
    expect(transitionedBody.idempotent).toBe(false);
    const replayedTransition = await app.request(
      transitionEndpoint,
      jsonRequest(transitionBody),
    );
    expect(replayedTransition.status).toBe(200);
    expect(await replayedTransition.json()).toMatchObject({
      idempotent: true,
      projection: {
        projectionHash: transitionedBody.projection.projectionHash,
      },
    });

    const library = await app.request("/api/course-packs");
    expect(await library.json()).toMatchObject({
      storageAvailable: true,
      packs: [{ revisionId: pack.revision.revisionKey }],
    });
    const exported = await app.request(
      `/api/course-packs/export?revisionId=${encodeURIComponent(pack.revision.revisionKey)}`,
    );
    expect(exported.status).toBe(200);
    expect(exported.headers.get("Content-Disposition")).toContain(
      "development-kernel-basics-v1.course-pack.json",
    );
    const exportedBytes = encoder.encode(await exported.text());
    const reimported = validateCoursePackBytes(exportedBytes);
    expect(reimported.valid).toBe(true);
    expect(reimported.contentHash).toBe(pack.revision.contentHash);

    const wrongUninstall = await app.request(
      "/api/course-packs/uninstall",
      jsonRequest({
        operationId: "uninstall-wrong",
        revisionId: pack.revision.revisionKey,
        confirmRevisionKey: "wrong",
      }),
    );
    expect(wrongUninstall.status).toBe(409);

    const uninstall = await app.request(
      "/api/course-packs/uninstall",
      jsonRequest({
        operationId: "uninstall-pack",
        revisionId: pack.revision.revisionKey,
        confirmRevisionKey: pack.revision.revisionKey,
      }),
    );
    expect(uninstall.status).toBe(200);
    expect(await uninstall.json()).toMatchObject({
      result: { lifecycleAction: "uninstall", retainedEvidenceCount: 0 },
    });
    const libraryAfterUninstall = (await (
      await app.request("/api/course-packs")
    ).json()) as { packs: unknown[] };
    expect(libraryAfterUninstall.packs).toEqual([
      expect.objectContaining({ lifecycleAction: "uninstall" }),
    ]);
  });

  it("returns bounded diagnostics and removes invalid staging bytes", async () => {
    const { app, connection, stagingRoot } = await fixture();
    const invalid = {
      ...createDevelopmentCoursePackFixture(),
      command: "npm test",
    };
    const response = await app.request(
      "/api/course-packs/validate",
      jsonRequest(invalid),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      valid: false;
      report: { diagnostics: Array<{ code: string }> };
    };
    expect(body.valid).toBe(false);
    expect(body.report.diagnostics.map((item) => item.code)).toContain(
      "PACK_AUTHORITY_FIELD",
    );
    expect(await readdir(stagingRoot)).toEqual([]);
    expect(
      connection.sqlite
        .prepare("SELECT count(*) AS count FROM course_pack_quarantine")
        .get(),
    ).toEqual({ count: 1 });
    expect(
      connection.sqlite
        .prepare("SELECT count(*) AS count FROM course_pack_manifests")
        .get(),
    ).toEqual({ count: 0 });
  });

  it("rejects declared oversize before reading a request body", async () => {
    const { app } = await fixture();
    const response = await app.request("/api/course-packs/validate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": "1048577",
      },
      body: "{}",
    });
    expect(response.status).toBe(413);
  });
});
