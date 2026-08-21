import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  prepareCoursePackBytes,
  validateCoursePackBytes,
} from "@aptiloop/course-authoring-kit";
import {
  createDevelopmentCoursePackFixture,
  createProtectedMaterialCoursePackAuthoringDraftFixture,
  createSequentialCoursePackAuthoringDraftFixture,
} from "../../../packages/course-authoring-kit/test/fixture.js";
import {
  coursePackSourceBytesHash,
  createCourseFoundationRepository,
  createCoursePackRepository,
  createLearningRepository,
  migrateDatabase,
  openDatabase,
} from "@aptiloop/database";
import { CoursePackStagedValidationResponseSchema } from "@aptiloop/shared";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  registerCoursePackRoutes,
  type CoursePackRouteOptions,
} from "../src/course-packs.js";
import { registerCurriculumEditorRoutes } from "../src/curriculum-editor.js";
import { registerVersionedLearningRoutes } from "../src/learning-v2.js";
import { registerPersonalAdaptationRoutes } from "../src/personal-adaptations.js";

const cleanups: Array<() => Promise<void> | void> = [];
const encoder = new TextEncoder();

afterEach(async () => {
  vi.useRealTimers();
  while (cleanups.length > 0) await cleanups.pop()?.();
});

async function fixture(
  routeOptions: Pick<
    CoursePackRouteOptions,
    | "maxStagedDiagnostics"
    | "maxStagedReportBytes"
    | "maxStagedValidations"
    | "validationTtlMilliseconds"
  > = {},
) {
  const connection = openDatabase(":memory:");
  migrateDatabase(connection);
  cleanups.push(() => connection.close());
  const stagingRoot = await mkdtemp(
    path.join(tmpdir(), "aptiloop-course-pack-route-test-"),
  );
  cleanups.push(() => rm(stagingRoot, { recursive: true, force: true }));
  const app = new Hono();
  let sequence = 0;
  let currentTime = Date.UTC(2026, 7, 10);
  registerCoursePackRoutes(app, createCoursePackRepository(connection), {
    now: () => currentTime,
    id: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
    stagingRoot,
    ...routeOptions,
  });
  registerCurriculumEditorRoutes(app, { connection });
  registerPersonalAdaptationRoutes(app, { connection });
  registerVersionedLearningRoutes(app, {
    connection,
    repository: createLearningRepository(connection),
    courseFoundationRepository: createCourseFoundationRepository(connection),
  });
  return {
    app,
    connection,
    stagingRoot,
    advanceTime: (milliseconds: number) => {
      currentTime += milliseconds;
    },
  };
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
    const { app, connection, stagingRoot } = await fixture();
    const pack = createDevelopmentCoursePackFixture();
    const validationResponse = await app.request(
      "/api/course-packs/validate",
      jsonRequest(pack),
    );
    expect(validationResponse.status).toBe(200);
    const preview = CoursePackStagedValidationResponseSchema.parse(
      await validationResponse.json(),
    );
    if (!preview.valid) throw new Error("Course Pack validation failed");
    expect(preview).toMatchObject({
      valid: true,
      sourceKind: "course-pack",
      finalized: false,
      preview: {
        contentHash: pack.revision.contentHash,
        courseKey: pack.course.courseKey,
      },
    });
    expect(
      CoursePackStagedValidationResponseSchema.safeParse({
        ...preview,
        expiresAt: preview.expiresAt.replace("Z", "+00:00"),
      }).success,
    ).toBe(true);
    expect(await readdir(stagingRoot)).toHaveLength(1);

    const restored = await app.request(
      `/api/course-packs/validations/${preview.validationId}`,
    );
    expect(restored.status).toBe(200);
    expect(restored.headers.get("Cache-Control")).toContain("no-store");
    const restoredBody = CoursePackStagedValidationResponseSchema.parse(
      await restored.json(),
    );
    expect(Object.keys(restoredBody).toSorted()).toEqual([
      "expiresAt",
      "finalized",
      "preview",
      "report",
      "sourceKind",
      "storageAvailable",
      "valid",
      "validationId",
    ]);
    expect(restoredBody).toMatchObject({
      valid: true,
      sourceKind: "course-pack",
      finalized: false,
      storageAvailable: true,
      validationId: preview.validationId,
      preview: {
        contentHash: pack.revision.contentHash,
        courseKey: pack.course.courseKey,
      },
    });
    expect(restoredBody).not.toHaveProperty("pack");
    expect(restoredBody).not.toHaveProperty("canonicalJson");
    expect(restoredBody).not.toHaveProperty("sourceBytesHash");
    expect(restoredBody).not.toHaveProperty("directory");
    expect(restoredBody).not.toHaveProperty("filePath");
    expect(restoredBody).not.toHaveProperty("sourceFilePath");
    expect(restoredBody).not.toHaveProperty("preparedFilePath");
    expect(restoredBody).not.toHaveProperty("stagedBytesHash");
    expect(await readdir(stagingRoot)).toHaveLength(1);
    expect(
      await (
        await app.request(
          `/api/course-packs/validations/${preview.validationId}`,
        )
      ).json(),
    ).toEqual(restoredBody);
    expect(await (await app.request("/api/course-packs")).json()).toMatchObject(
      { packs: [] },
    );

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
    const replay = await app.request(
      `/api/course-packs/validations/${preview.validationId}/commit`,
      jsonRequest({
        operationId: "install-pack",
        action: "install",
        expectedContentHash: preview.preview.contentHash,
      }),
    );
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({
      result: {
        revisionId: pack.revision.revisionKey,
        installed: false,
        idempotent: true,
      },
    });
    expect(await readdir(stagingRoot)).toEqual([]);
    expect(
      connection.sqlite
        .prepare(
          "SELECT count(*) AS count FROM course_pack_lifecycle_events WHERE operation_id = ?",
        )
        .get("install-pack"),
    ).toEqual({ count: 1 });
    for (const mismatchBody of [
      {
        operationId: "install-pack",
        action: "open-as-draft",
        expectedContentHash: preview.preview.contentHash,
      },
      {
        operationId: "install-pack",
        action: "install",
        expectedContentHash: `sha256:${"e".repeat(64)}`,
      },
    ] as const) {
      const operationMismatch = await app.request(
        `/api/course-packs/validations/${preview.validationId}/commit`,
        jsonRequest(mismatchBody),
      );
      expect(operationMismatch.status).toBe(409);
      expect(await operationMismatch.json()).toMatchObject({
        code: "conflict",
      });
    }
    const otherValidation = await app.request(
      "/api/course-packs/validate",
      jsonRequest(pack),
    );
    const otherPreview = (await otherValidation.json()) as {
      validationId: string;
      preview: { contentHash: string };
    };
    const validationMismatch = await app.request(
      `/api/course-packs/validations/${otherPreview.validationId}/commit`,
      jsonRequest({
        operationId: "install-pack",
        action: "install",
        expectedContentHash: otherPreview.preview.contentHash,
      }),
    );
    expect(validationMismatch.status).toBe(409);
    expect(await validationMismatch.json()).toMatchObject({ code: "conflict" });
    expect(await readdir(stagingRoot)).toHaveLength(1);
    const freshOperationReplay = await app.request(
      `/api/course-packs/validations/${otherPreview.validationId}/commit`,
      jsonRequest({
        operationId: "install-pack-after-response-loss",
        action: "install",
        expectedContentHash: otherPreview.preview.contentHash,
      }),
    );
    expect(freshOperationReplay.status).toBe(200);
    expect(await freshOperationReplay.json()).toMatchObject({
      result: {
        revisionId: pack.revision.revisionKey,
        installed: false,
        idempotent: true,
      },
    });
    expect(await readdir(stagingRoot)).toEqual([]);
    const lostResponseReplay = await app.request(
      `/api/course-packs/validations/${otherPreview.validationId}/commit`,
      jsonRequest({
        operationId: "install-pack-after-response-loss",
        action: "install",
        expectedContentHash: otherPreview.preview.contentHash,
      }),
    );
    expect(lostResponseReplay.status).toBe(200);
    expect(await lostResponseReplay.json()).toMatchObject({
      result: { installed: false, idempotent: true },
    });
    expect(
      (
        await app.request(
          `/api/course-packs/validations/${preview.validationId}`,
        )
      ).status,
    ).toBe(404);
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
    const selected = await app.request(
      `/api/learning/courses/${encodeURIComponent(pack.course.courseKey)}/select`,
      jsonRequest({
        revisionId: pack.revision.revisionKey,
        operationId: "select-installed-pack",
      }),
    );
    expect(selected.status).toBe(200);
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
    expect(uninstall.status).toBe(409);
    expect(await uninstall.json()).toEqual({
      code: "active_session",
      error: "Course Pack revision is pinned by an active learning session",
    });
    const resumablePath = await app.request("/api/learning/path");
    expect(resumablePath.status).toBe(200);
    expect(await resumablePath.json()).toMatchObject({
      curriculum: {
        version: { id: pack.revision.revisionKey, status: "published" },
      },
      nextAction: { type: "resume", sessionId: startedBody.session.id },
    });
    expect(
      (
        await app.request(
          `/api/learning/sessions/v2/${encodeURIComponent(startedBody.session.id)}`,
        )
      ).status,
    ).toBe(200);

    connection.sqlite
      .prepare(
        `UPDATE learning_sessions
         SET status = 'completed', current_step = 'complete',
             completed_at = ?, updated_at = ?
         WHERE id = ? AND status = 'active'`,
      )
      .run(
        Date.UTC(2026, 7, 10, 1),
        Date.UTC(2026, 7, 10, 1),
        startedBody.session.id,
      );
    const uninstallAfterSession = await app.request(
      "/api/course-packs/uninstall",
      jsonRequest({
        operationId: "uninstall-pack-after-session",
        revisionId: pack.revision.revisionKey,
        confirmRevisionKey: pack.revision.revisionKey,
      }),
    );
    expect(uninstallAfterSession.status).toBe(200);
    expect(await uninstallAfterSession.json()).toMatchObject({
      result: { lifecycleAction: "uninstall", retainedEvidenceCount: 0 },
    });
    expect(await (await app.request("/api/learning/path")).json()).toEqual({
      curriculum: null,
      courseContext: null,
      nextAction: null,
    });
    const retainedSession = await app.request(
      `/api/learning/sessions/v2/${encodeURIComponent(startedBody.session.id)}`,
    );
    expect(retainedSession.status).toBe(200);
    expect(await retainedSession.json()).toMatchObject({
      session: { id: startedBody.session.id, status: "completed" },
    });
    const libraryAfterUninstall = (await (
      await app.request("/api/course-packs")
    ).json()) as { packs: unknown[] };
    expect(libraryAfterUninstall.packs).toEqual([
      expect.objectContaining({ lifecycleAction: "uninstall" }),
    ]);
  });

  it("finalizes a sequential draft and unlocks its next lesson through real progress", async () => {
    const { app, connection, stagingRoot } = await fixture();
    const draft = createSequentialCoursePackAuthoringDraftFixture();
    const sourceBytes = encoder.encode(JSON.stringify(draft));
    const expected = prepareCoursePackBytes(sourceBytes);
    if (!expected.valid) throw new Error(JSON.stringify(expected.report));

    const validationResponse = await app.request(
      "/api/course-packs/validate",
      jsonRequest(draft),
    );
    expect(validationResponse.status).toBe(200);
    const validation = CoursePackStagedValidationResponseSchema.parse(
      await validationResponse.json(),
    );
    if (!validation.valid) throw new Error(JSON.stringify(validation.report));
    expect(validation).toMatchObject({
      sourceKind: "authoring-draft",
      finalized: true,
      preview: {
        courseKey: draft.course.courseKey,
        revisionKey: draft.revision.revisionKey,
        contentHash: expected.contentHash,
        lessonCount: 3,
        requirements: {
          activityTypes: ["checkpoint", "recall", "study"],
          capabilities: [],
          environmentIds: [],
          checkIds: [],
        },
      },
    });

    const stagedDirectories = await readdir(stagingRoot);
    expect(stagedDirectories).toHaveLength(1);
    const stagedDirectory = path.join(stagingRoot, stagedDirectories[0]!);
    expect((await readdir(stagedDirectory)).toSorted()).toEqual([
      "pack.json",
      "source.json",
    ]);
    expect(
      new Uint8Array(await readFile(path.join(stagedDirectory, "source.json"))),
    ).toEqual(sourceBytes);
    expect(
      new Uint8Array(await readFile(path.join(stagedDirectory, "pack.json"))),
    ).toEqual(expected.preparedBytes);

    const commit = await app.request(
      `/api/course-packs/validations/${validation.validationId}/commit`,
      jsonRequest({
        operationId: "install-sequential-draft",
        action: "install",
        expectedContentHash: validation.preview.contentHash,
      }),
    );
    expect(commit.status).toBe(201);
    expect(await commit.json()).toMatchObject({
      result: {
        revisionId: draft.revision.revisionKey,
        revisionStatus: "published",
      },
    });
    expect(await readdir(stagingRoot)).toEqual([]);
    expect(
      connection.sqlite
        .prepare(
          `SELECT canonical_json, source_bytes_hash
           FROM course_pack_manifests WHERE revision_id = ?`,
        )
        .get(draft.revision.revisionKey),
    ).toEqual({
      canonical_json: expected.canonicalJson,
      source_bytes_hash: coursePackSourceBytesHash(sourceBytes),
    });

    const roadmapPath = `/api/learning/courses/${encodeURIComponent(draft.course.courseKey)}/revisions/${encodeURIComponent(draft.revision.revisionKey)}/path`;
    const roadmapResponse = await app.request(roadmapPath);
    expect(roadmapResponse.status).toBe(200);
    const roadmap = (await roadmapResponse.json()) as {
      curriculum: {
        weeks: Array<{
          days: Array<{
            id: string;
            stableId: string;
            status: string;
            units: Array<{
              id: string;
              stableId: string;
              type: string;
              status: string;
            }>;
          }>;
        }>;
      };
    };
    const lessons = roadmap.curriculum.weeks.flatMap((week) => week.days);
    expect(
      lessons.map(({ stableId, status }) => ({ stableId, status })),
    ).toEqual([
      { stableId: "foundation-lesson", status: "available" },
      { stableId: "practice-lesson", status: "locked" },
      { stableId: "reflection-lesson", status: "locked" },
    ]);

    const selected = await app.request(
      `/api/learning/courses/${encodeURIComponent(draft.course.courseKey)}/select`,
      jsonRequest({
        revisionId: draft.revision.revisionKey,
        operationId: "select-sequential-draft",
      }),
    );
    expect(selected.status).toBe(200);

    const rejectedLockedStart = await app.request(
      "/api/learning/sessions/v2",
      jsonRequest({
        dayId: lessons[1]!.id,
        operationId: "reject-locked-practice-lesson",
      }),
    );
    expect(rejectedLockedStart.status).not.toBe(201);
    expect(
      connection.sqlite
        .prepare("SELECT count(*) AS count FROM learning_sessions")
        .get(),
    ).toEqual({ count: 0 });

    const startedFirst = await app.request(
      "/api/learning/sessions/v2",
      jsonRequest({
        dayId: lessons[0]!.id,
        operationId: "start-foundation-lesson",
      }),
    );
    expect(startedFirst.status).toBe(201);
    const firstSession = (await startedFirst.json()) as {
      session: {
        id: string;
        status: string;
        snapshot: {
          units: Array<{ id: string; stableId: string; type: string }>;
        };
        unitProgress: Array<{ unitId: string; status: string }>;
      };
    };
    const checkpoint = firstSession.session.snapshot.units[0]!;
    expect(checkpoint).toMatchObject({
      stableId: "foundation-checkpoint",
      type: "checkpoint",
    });
    expect(firstSession.session.unitProgress).toEqual([
      expect.objectContaining({ unitId: checkpoint.id, status: "ready" }),
    ]);

    const checkpointEndpoint = `/api/learning/sessions/v2/${encodeURIComponent(firstSession.session.id)}/units/${encodeURIComponent(checkpoint.id)}`;
    const startedCheckpoint = await app.request(checkpointEndpoint, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        operationId: "start-foundation-checkpoint",
        status: "in_progress",
      }),
    });
    expect(startedCheckpoint.status).toBe(200);
    const completedCheckpoint = await app.request(checkpointEndpoint, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        operationId: "complete-foundation-checkpoint",
        status: "completed",
        payload: { type: "checkpoint", acknowledged: true },
      }),
    });
    expect(completedCheckpoint.status).toBe(200);
    expect(await completedCheckpoint.json()).toMatchObject({
      session: {
        id: firstSession.session.id,
        status: "completed",
        unitProgress: [{ unitId: checkpoint.id, status: "completed" }],
      },
    });

    const unlockedRoadmap = (await (
      await app.request(roadmapPath)
    ).json()) as typeof roadmap;
    const unlockedLessons = unlockedRoadmap.curriculum.weeks.flatMap(
      (week) => week.days,
    );
    expect(
      unlockedLessons.map(({ stableId, status }) => ({ stableId, status })),
    ).toEqual([
      { stableId: "foundation-lesson", status: "completed" },
      { stableId: "practice-lesson", status: "available" },
      { stableId: "reflection-lesson", status: "locked" },
    ]);
    const startedSecond = await app.request(
      "/api/learning/sessions/v2",
      jsonRequest({
        dayId: unlockedLessons[1]!.id,
        operationId: "start-practice-lesson",
      }),
    );
    expect(startedSecond.status).toBe(201);
    const secondSession = (await startedSecond.json()) as {
      session: {
        id: string;
        status: string;
        snapshot: {
          day: { stableId: string };
          units: Array<{ id: string; stableId: string; type: string }>;
        };
      };
    };
    expect(secondSession.session).toMatchObject({
      status: "active",
      snapshot: { day: { stableId: "practice-lesson" } },
    });
    const study = secondSession.session.snapshot.units[0]!;
    const studyEndpoint = `/api/learning/sessions/v2/${encodeURIComponent(secondSession.session.id)}/units/${encodeURIComponent(study.id)}`;
    expect(
      await app.request(studyEndpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operationId: "start-practice-study",
          status: "in_progress",
        }),
      }),
    ).toMatchObject({ status: 200 });
    const completedStudy = await app.request(studyEndpoint, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        operationId: "complete-practice-study",
        status: "completed",
        payload: { type: "study", checkedItemIds: [], notes: "" },
      }),
    });
    expect(completedStudy.status).toBe(200);
    expect(await completedStudy.json()).toMatchObject({
      session: { status: "completed" },
    });

    const reflectionRoadmap = (await (
      await app.request(roadmapPath)
    ).json()) as typeof roadmap;
    const reflectionLessons = reflectionRoadmap.curriculum.weeks.flatMap(
      (week) => week.days,
    );
    expect(
      reflectionLessons.map(({ stableId, status }) => ({ stableId, status })),
    ).toEqual([
      { stableId: "foundation-lesson", status: "completed" },
      { stableId: "practice-lesson", status: "completed" },
      { stableId: "reflection-lesson", status: "available" },
    ]);

    const startedThird = await app.request(
      "/api/learning/sessions/v2",
      jsonRequest({
        dayId: reflectionLessons[2]!.id,
        operationId: "start-reflection-lesson",
      }),
    );
    expect(startedThird.status).toBe(201);
    const thirdSession = (await startedThird.json()) as {
      session: {
        id: string;
        snapshot: {
          units: Array<{
            id: string;
            stableId: string;
            type: string;
            questions: Array<{ id: string; prompt: string }>;
          }>;
        };
      };
    };
    const recall = thirdSession.session.snapshot.units[0]!;
    expect(recall).toMatchObject({
      stableId: "reflection-recall",
      type: "recall",
      questions: [
        {
          id: "reflection-question",
          prompt: "Why can the sequence be replayed deterministically?",
        },
      ],
    });
    expect(recall.questions[0]).not.toHaveProperty("referenceAnswer");
    const recallEndpoint = `/api/learning/sessions/v2/${encodeURIComponent(thirdSession.session.id)}/units/${encodeURIComponent(recall.id)}`;
    expect(
      await app.request(recallEndpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operationId: "start-reflection-recall",
          status: "in_progress",
        }),
      }),
    ).toMatchObject({ status: 200 });
    const recallAttempt = await app.request(
      `${recallEndpoint}/recall-attempts`,
      jsonRequest({
        operationId: "answer-reflection-recall",
        questionId: recall.questions[0]!.id,
        answer:
          "Stable IDs and explicit acyclic prerequisite edges make replay deterministic.",
      }),
    );
    expect(recallAttempt.status).toBe(201);
    const completedRecall = await app.request(recallEndpoint, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        operationId: "complete-reflection-recall",
        status: "completed",
      }),
    });
    expect(completedRecall.status).toBe(200);
    expect(await completedRecall.json()).toMatchObject({
      session: { status: "completed" },
    });
    const completedRoadmap = (await (
      await app.request(roadmapPath)
    ).json()) as typeof roadmap;
    expect(
      completedRoadmap.curriculum.weeks
        .flatMap((week) => week.days)
        .map(({ stableId, status }) => ({ stableId, status })),
    ).toEqual([
      { stableId: "foundation-lesson", status: "completed" },
      { stableId: "practice-lesson", status: "completed" },
      { stableId: "reflection-lesson", status: "completed" },
    ]);
  });

  it("grades an imported quiz from the private immutable session snapshot", async () => {
    const { app } = await fixture();
    const draft = createProtectedMaterialCoursePackAuthoringDraftFixture();
    const validationResponse = await app.request(
      "/api/course-packs/validate",
      jsonRequest(draft),
    );
    const validation = CoursePackStagedValidationResponseSchema.parse(
      await validationResponse.json(),
    );
    if (!validation.valid) throw new Error(JSON.stringify(validation.report));
    const commit = await app.request(
      `/api/course-packs/validations/${validation.validationId}/commit`,
      jsonRequest({
        operationId: "install-protected-quiz",
        action: "install",
        expectedContentHash: validation.preview.contentHash,
      }),
    );
    expect(commit.status).toBe(201);
    expect(
      await app.request(
        `/api/learning/courses/${encodeURIComponent(draft.course.courseKey)}/select`,
        jsonRequest({
          revisionId: draft.revision.revisionKey,
          operationId: "select-protected-quiz",
        }),
      ),
    ).toMatchObject({ status: 200 });
    const roadmap = (await (
      await app.request(
        `/api/learning/courses/${encodeURIComponent(draft.course.courseKey)}/revisions/${encodeURIComponent(draft.revision.revisionKey)}/path`,
      )
    ).json()) as {
      curriculum: {
        weeks: Array<{ days: Array<{ id: string }> }>;
      };
    };
    const started = await app.request(
      "/api/learning/sessions/v2",
      jsonRequest({
        dayId: roadmap.curriculum.weeks[0]!.days[0]!.id,
        operationId: "start-protected-quiz",
      }),
    );
    expect(started.status).toBe(201);
    const learnerSession = (await started.json()) as {
      session: {
        id: string;
        snapshot: {
          units: Array<{
            id: string;
            questions: Array<{
              id: string;
              options: Array<{ id: string }>;
            }>;
          }>;
        };
      };
    };
    const quiz = learnerSession.session.snapshot.units[0]!;
    expect(quiz.questions[0]).not.toHaveProperty("correctOptionIds");
    expect(quiz.questions[0]).not.toHaveProperty("referenceAnswer");
    const quizEndpoint = `/api/learning/sessions/v2/${encodeURIComponent(learnerSession.session.id)}/units/${encodeURIComponent(quiz.id)}`;
    expect(
      await app.request(quizEndpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operationId: "start-protected-quiz-unit",
          status: "in_progress",
        }),
      }),
    ).toMatchObject({ status: 200 });
    const attempt = await app.request(
      `${quizEndpoint}/quiz-attempts`,
      jsonRequest({
        operationId: "answer-protected-quiz",
        answers: [
          {
            questionId: quiz.questions[0]!.id,
            selectedOptionId: "option-b",
          },
        ],
      }),
    );
    expect(attempt.status).toBe(201);
    expect(await attempt.json()).toMatchObject({
      attempt: {
        score: 1,
        results: [{ questionId: "protected-question", correct: true }],
      },
      session: {
        unitProgress: [expect.objectContaining({ status: "in_progress" })],
      },
    });
    const completed = await app.request(quizEndpoint, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        operationId: "complete-protected-quiz",
        status: "completed",
      }),
    });
    expect(completed.status).toBe(200);
    expect(await completed.json()).toMatchObject({
      session: { status: "completed" },
    });
  });

  it("keeps rejected draft graphs and unavailable requirements out of learning state", async () => {
    const { app, connection, stagingRoot } = await fixture();
    const rejectedGraph = createSequentialCoursePackAuthoringDraftFixture();
    rejectedGraph.lessons[1]!.prerequisiteLessonIds = ["missing-lesson"];
    const unavailableRequirement =
      createSequentialCoursePackAuthoringDraftFixture();
    unavailableRequirement.lessons[1]!.activities[0]!.capabilityIds = [
      "unsupported-capability",
    ];

    for (const [index, candidate, diagnosticCode] of [
      [0, rejectedGraph, "PACK_LESSON_GRAPH_REFERENCE_MISSING"],
      [1, unavailableRequirement, "PACK_REQUIREMENT_UNAVAILABLE"],
    ] as const) {
      const retainedClientSource = JSON.stringify(candidate);
      const response = await app.request(
        "/api/course-packs/validate",
        jsonRequest(candidate),
      );
      expect(response.status).toBe(200);
      const rejected = CoursePackStagedValidationResponseSchema.parse(
        await response.json(),
      );
      if (rejected.valid) throw new Error("Invalid draft was accepted");
      expect(rejected).toMatchObject({
        sourceKind: "authoring-draft",
        finalized: true,
      });
      expect(rejected.report.diagnostics.map(({ code }) => code)).toContain(
        diagnosticCode,
      );
      expect(JSON.stringify(candidate)).toBe(retainedClientSource);
      const restored = await app.request(
        `/api/course-packs/validations/${rejected.validationId}`,
      );
      expect(restored.status).toBe(200);
      expect(await restored.json()).toEqual(rejected);
      const invalidCommit = await app.request(
        `/api/course-packs/validations/${rejected.validationId}/commit`,
        jsonRequest({
          operationId: `reject-invalid-draft-${index}`,
          action: "install",
          expectedContentHash: `sha256:${"f".repeat(64)}`,
        }),
      );
      expect(invalidCommit.status).toBe(409);
      expect(
        (
          await app.request(
            `/api/course-packs/validations/${rejected.validationId}`,
          )
        ).status,
      ).toBe(200);
    }

    expect(await readdir(stagingRoot)).toEqual([]);
    expect(
      connection.sqlite
        .prepare("SELECT count(*) AS count FROM course_pack_quarantine")
        .get(),
    ).toEqual({ count: 2 });
    expect(
      connection.sqlite
        .prepare("SELECT count(*) AS count FROM course_pack_manifests")
        .get(),
    ).toEqual({ count: 0 });
    expect(
      connection.sqlite
        .prepare("SELECT count(*) AS count FROM learning_sessions")
        .get(),
    ).toEqual({ count: 0 });
  });

  it("rejects commit when the staged raw draft changes", async () => {
    const { app, connection, stagingRoot } = await fixture();
    const validationResponse = await app.request(
      "/api/course-packs/validate",
      jsonRequest(createSequentialCoursePackAuthoringDraftFixture()),
    );
    const validation = CoursePackStagedValidationResponseSchema.parse(
      await validationResponse.json(),
    );
    if (!validation.valid) throw new Error(JSON.stringify(validation.report));
    const [stagedDirectory] = await readdir(stagingRoot);
    if (!stagedDirectory) throw new Error("Staged Course Pack is missing");
    await writeFile(
      path.join(stagingRoot, stagedDirectory, "source.json"),
      "{}",
    );

    const commit = await app.request(
      `/api/course-packs/validations/${validation.validationId}/commit`,
      jsonRequest({
        operationId: "reject-changed-raw-draft",
        action: "install",
        expectedContentHash: validation.preview.contentHash,
      }),
    );
    expect(commit.status).toBe(409);
    expect(await commit.json()).toEqual({
      error: "Staged Course Pack changed after validation",
    });
    expect(await readdir(stagingRoot)).toEqual([]);
    expect(
      connection.sqlite
        .prepare("SELECT count(*) AS count FROM course_pack_manifests")
        .get(),
    ).toEqual({ count: 0 });
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
    const body = CoursePackStagedValidationResponseSchema.parse(
      await response.json(),
    );
    if (body.valid) throw new Error("Invalid Course Pack was accepted");
    expect(body).toMatchObject({
      valid: false,
      sourceKind: "course-pack",
      finalized: false,
    });
    expect(body.report.diagnostics.map((item) => item.code)).toContain(
      "PACK_AUTHORITY_FIELD",
    );
    expect(
      body.report.diagnostics.every(
        (diagnostic) =>
          (diagnostic.ruleId === null ||
            typeof diagnostic.ruleId === "string") &&
          [
            null,
            "json-value",
            "learner-markdown",
            "educational-code",
            "field-name",
          ].includes(diagnostic.context),
      ),
    ).toBe(true);
    const restored = await app.request(
      `/api/course-packs/validations/${body.validationId}`,
    );
    expect(restored.status).toBe(200);
    const restoredBody = CoursePackStagedValidationResponseSchema.parse(
      await restored.json(),
    );
    expect(restoredBody).toMatchObject({
      valid: false,
      sourceKind: "course-pack",
      finalized: false,
      validationId: body.validationId,
    });
    expect(Object.keys(restoredBody).toSorted()).toEqual([
      "expiresAt",
      "finalized",
      "report",
      "sourceKind",
      "storageAvailable",
      "valid",
      "validationId",
    ]);
    expect(restoredBody).not.toHaveProperty("preview");
    expect(restoredBody).not.toHaveProperty("pack");
    expect(restoredBody.report.diagnostics.map((item) => item.code)).toContain(
      "PACK_AUTHORITY_FIELD",
    );
    const invalidCommit = await app.request(
      `/api/course-packs/validations/${body.validationId}/commit`,
      jsonRequest({
        operationId: "invalid-pack-must-not-commit",
        action: "install",
        expectedContentHash: `sha256:${"f".repeat(64)}`,
      }),
    );
    expect(invalidCommit.status).toBe(409);
    expect(await invalidCommit.json()).toEqual({
      error: "Course Pack validation did not pass",
    });
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

  it("opens a distinct draft, publishes local edits, and preserves exact Pack export", async () => {
    const { app, connection } = await fixture();
    const pack = createDevelopmentCoursePackFixture();
    const validated = validateCoursePackBytes(
      encoder.encode(JSON.stringify(pack, null, 2)),
    );
    if (!validated.valid) throw new Error(JSON.stringify(validated.report));
    const validation = await app.request(
      "/api/course-packs/validate",
      jsonRequest(pack),
    );
    const preview = (await validation.json()) as {
      validationId: string;
      preview: { contentHash: string };
    };
    const commit = await app.request(
      `/api/course-packs/validations/${preview.validationId}/commit`,
      jsonRequest({
        operationId: "open-pack-as-draft",
        action: "open-as-draft",
        expectedContentHash: preview.preview.contentHash,
      }),
    );
    expect(commit.status).toBe(201);
    const committed = (await commit.json()) as {
      openPath: null;
      result: {
        revisionId: string;
        revisionStatus: "draft";
        action: "open-as-draft";
      };
    };
    const draftId = committed.result.revisionId;
    expect(committed).toMatchObject({
      openPath: null,
      result: { action: "open-as-draft", revisionStatus: "draft" },
    });
    expect(draftId).not.toBe(pack.revision.revisionKey);
    const adaptation = await app.request(
      `/api/curriculum-editor/courses/${encodeURIComponent(pack.course.courseKey)}/adaptation`,
    );
    expect(adaptation.status).toBe(200);
    expect(await adaptation.json()).toMatchObject({
      comparison: {
        status: "current",
        baseRevisionId: pack.revision.revisionKey,
        upstreamRevisionId: pack.revision.revisionKey,
        personalVersionId: draftId,
      },
    });
    expect(
      connection.sqlite
        .prepare(
          `SELECT parent_version_id, branch_kind, based_on_content_hash
           FROM curriculum_versions WHERE id = ?`,
        )
        .get(draftId),
    ).toEqual({
      parent_version_id: pack.revision.revisionKey,
      branch_kind: "personal",
      based_on_content_hash: pack.revision.contentHash,
    });

    const draftGraphResponse = await app.request(
      `/api/curriculum-editor/versions/${encodeURIComponent(draftId)}`,
    );
    expect(draftGraphResponse.status).toBe(200);
    const draftGraph = (await draftGraphResponse.json()) as {
      curriculum: {
        version: { id: string; parentVersionId: string | null };
        weeks: Array<{
          days: Array<{
            units: Array<{
              id: string;
              title: string;
              referenceAnswer: string | null;
            }>;
          }>;
        }>;
      };
    };
    expect(draftGraph.curriculum.version).toMatchObject({
      id: draftId,
      parentVersionId: pack.revision.revisionKey,
    });
    expect(
      draftGraph.curriculum.weeks[0]?.days[0]?.units[1]?.referenceAnswer,
    ).toBe(
      "The immutable snapshot, ordered accepted facts, model version, and explicit observed clock.",
    );
    const draftPackMetadata = connection.sqlite
      .prepare(
        `SELECT knowledge_node_ids_json, protected_material_json
         FROM course_activities
         WHERE revision_id = ? AND stable_id = 'recall-replay'`,
      )
      .get(draftId) as {
      knowledge_node_ids_json: string;
      protected_material_json: string;
    };
    expect(draftPackMetadata.knowledge_node_ids_json).toBe(
      '["deterministic-replay"]',
    );
    expect(draftPackMetadata.protected_material_json).toContain(
      "The immutable snapshot, ordered accepted facts",
    );
    const unit = draftGraph.curriculum.weeks[0]?.days[0]?.units[0];
    expect(unit).toBeDefined();
    const editedTitle = "Locally edited replay";
    const edit = await app.request(
      `/api/curriculum-editor/versions/${encodeURIComponent(draftId)}/units/${encodeURIComponent(unit!.id)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operationId: "edit-imported-draft",
          title: editedTitle,
        }),
      },
    );
    expect(edit.status).toBe(200);

    const validationEvidence = (await (
      await app.request(
        `/api/curriculum-editor/versions/${encodeURIComponent(draftId)}/validation`,
      )
    ).json()) as {
      report: {
        valid: boolean;
        validationHash: string;
        draftHash: string;
      };
    };
    expect(validationEvidence.report.valid).toBe(true);
    const reviewEvidence = (await (
      await app.request(
        `/api/curriculum-editor/versions/${encodeURIComponent(draftId)}/change-review`,
      )
    ).json()) as {
      review: {
        parentVersionId: string | null;
        changed: number;
        changeReviewHash: string;
      };
    };
    expect(reviewEvidence.review).toMatchObject({
      parentVersionId: pack.revision.revisionKey,
      changed: 1,
    });
    const publish = await app.request(
      `/api/curriculum-editor/versions/${encodeURIComponent(draftId)}/publish`,
      jsonRequest({
        operationId: "publish-imported-draft",
        validationHash: validationEvidence.report.validationHash,
        changeReviewHash: reviewEvidence.review.changeReviewHash,
        previewHash: validationEvidence.report.draftHash,
      }),
    );
    expect(publish.status).toBe(200);
    expect(await publish.json()).toMatchObject({
      version: { id: draftId, status: "published" },
    });
    expect(
      connection.sqlite
        .prepare(
          `SELECT knowledge_node_ids_json, protected_material_json
           FROM course_activities
           WHERE revision_id = ? AND stable_id = 'recall-replay'`,
        )
        .get(draftId),
    ).toEqual(draftPackMetadata);

    const exported = await app.request(
      `/api/course-packs/export?revisionId=${encodeURIComponent(pack.revision.revisionKey)}`,
    );
    expect(exported.status).toBe(200);
    expect(await exported.text()).toBe(`${validated.canonicalJson}\n`);
    const sourceGraph = (await (
      await app.request(
        `/api/curriculum-editor/versions/${encodeURIComponent(pack.revision.revisionKey)}`,
      )
    ).json()) as typeof draftGraph;
    expect(sourceGraph.curriculum.weeks[0]?.days[0]?.units[0]?.title).toBe(
      pack.lessons[0]?.activities[0]?.title,
    );
    const sourceUnitId = sourceGraph.curriculum.weeks[0]?.days[0]?.units[0]?.id;
    expect(sourceUnitId).toBeTypeOf("string");
    if (!sourceUnitId) throw new Error("Imported source unit is missing");
    const rejectedSourceEdit = await app.request(
      `/api/curriculum-editor/versions/${encodeURIComponent(pack.revision.revisionKey)}/units/${encodeURIComponent(sourceUnitId)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operationId: "edit-immutable-pack-source",
          title: "Must not change",
        }),
      },
    );
    expect(rejectedSourceEdit.status).toBe(409);
    expect(await rejectedSourceEdit.json()).toMatchObject({
      error: { code: "immutable_version" },
    });
    expect(
      connection.sqlite
        .prepare(
          `SELECT source.status AS source_status,
                  source.content_hash AS source_hash,
                  draft.status AS draft_status,
                  draft.content_hash AS draft_hash
           FROM curriculum_versions source
           JOIN curriculum_versions draft ON draft.id = ?
           WHERE source.id = ?`,
        )
        .get(draftId, pack.revision.revisionKey),
    ).toEqual({
      source_status: "archived",
      source_hash: pack.revision.contentHash,
      draft_status: "published",
      draft_hash: expect.not.stringMatching(
        new RegExp(pack.revision.contentHash.slice("sha256:".length), "u"),
      ),
    });
    expect(connection.sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual(
      [],
    );
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

  it("stages malformed JSON as bounded diagnostics without retaining source bytes", async () => {
    const { app, connection, stagingRoot } = await fixture();
    const response = await app.request("/api/course-packs/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: '{"format":',
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      valid: false;
      report: { diagnostics: Array<{ code: string }> };
    };
    expect(body.valid).toBe(false);
    expect(body.report.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "PACK_JSON_INVALID_JSON" }),
      ]),
    );
    expect(await readdir(stagingRoot)).toEqual([]);
    expect(
      connection.sqlite
        .prepare("SELECT count(*) AS count FROM course_pack_manifests")
        .get(),
    ).toEqual({ count: 0 });
  });

  it("atomically claims a staged validation before mixed-action commits", async () => {
    const { app, connection, stagingRoot } = await fixture();
    const pack = createDevelopmentCoursePackFixture();
    const validation = await app.request(
      "/api/course-packs/validate",
      jsonRequest(pack),
    );
    const preview = (await validation.json()) as {
      validationId: string;
      preview: { contentHash: string };
    };
    const commitPath = `/api/course-packs/validations/${preview.validationId}/commit`;
    const [install, openAsDraft] = await Promise.all([
      app.request(
        commitPath,
        jsonRequest({
          operationId: "mixed-install",
          action: "install",
          expectedContentHash: preview.preview.contentHash,
        }),
      ),
      app.request(
        commitPath,
        jsonRequest({
          operationId: "mixed-open",
          action: "open-as-draft",
          expectedContentHash: preview.preview.contentHash,
        }),
      ),
    ]);
    expect([install.status, openAsDraft.status].toSorted()).toEqual([201, 404]);
    const winner = install.status === 201 ? install : openAsDraft;
    const winnerBody = (await winner.json()) as {
      result: { action: "install" | "open-as-draft"; revisionId: string };
    };
    const lifecycle = connection.sqlite
      .prepare(
        `SELECT action, count(*) OVER () AS count
         FROM course_pack_lifecycle_events`,
      )
      .get() as { action: string; count: number };
    expect(lifecycle).toEqual({ action: winnerBody.result.action, count: 1 });
    expect(await readdir(stagingRoot)).toEqual([]);
    expect(connection.sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual(
      [],
    );
  });

  it("bounds invalid reports and evicts staged validations by LRU order", async () => {
    const { app } = await fixture({
      maxStagedDiagnostics: 100,
      maxStagedReportBytes: 4_096,
      maxStagedValidations: 2,
    });
    const invalid = {
      ...createDevelopmentCoursePackFixture(),
      attack: Array.from({ length: 150 }, (_, index) => ({
        command: `forbidden-${index}`,
      })),
    };
    const rawValidation = validateCoursePackBytes(
      encoder.encode(JSON.stringify(invalid)),
    );
    expect(rawValidation.valid).toBe(false);
    expect(rawValidation.report.diagnostics.length).toBeGreaterThan(100);
    const firstResponse = await app.request(
      "/api/course-packs/validate",
      jsonRequest(invalid),
    );
    const first = (await firstResponse.json()) as {
      validationId: string;
      report: { diagnostics: unknown[] };
    };
    expect(first.report.diagnostics.length).toBeLessThan(100);
    expect(
      Buffer.byteLength(JSON.stringify(first.report), "utf8"),
    ).toBeLessThanOrEqual(4_096);
    const second = (await (
      await app.request(
        "/api/course-packs/validate",
        jsonRequest({ ...invalid, marker: "second" }),
      )
    ).json()) as { validationId: string };
    expect(
      (await app.request(`/api/course-packs/validations/${first.validationId}`))
        .status,
    ).toBe(200);
    const third = (await (
      await app.request(
        "/api/course-packs/validate",
        jsonRequest({ ...invalid, marker: "third" }),
      )
    ).json()) as { validationId: string };
    expect(
      (
        await app.request(
          `/api/course-packs/validations/${second.validationId}`,
        )
      ).status,
    ).toBe(404);
    expect(
      (await app.request(`/api/course-packs/validations/${first.validationId}`))
        .status,
    ).toBe(200);
    expect(
      (await app.request(`/api/course-packs/validations/${third.validationId}`))
        .status,
    ).toBe(200);
  });

  it("removes staged bytes when the expiry timer fires without another request", async () => {
    vi.useFakeTimers();
    const { app, stagingRoot } = await fixture({
      validationTtlMilliseconds: 100,
    });
    const validation = await app.request(
      "/api/course-packs/validate",
      jsonRequest(createDevelopmentCoursePackFixture()),
    );
    expect(validation.status).toBe(200);
    expect(await readdir(stagingRoot)).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(101);
    await expect.poll(() => readdir(stagingRoot)).toEqual([]);
  });

  it("fails closed for expired, unknown, and malformed validation reads", async () => {
    const { app, stagingRoot, advanceTime } = await fixture();
    const validation = await app.request(
      "/api/course-packs/validate",
      jsonRequest(createDevelopmentCoursePackFixture()),
    );
    const body = (await validation.json()) as { validationId: string };
    expect(await readdir(stagingRoot)).toHaveLength(1);

    advanceTime(15 * 60 * 1_000 + 1);
    const expired = await app.request(
      `/api/course-packs/validations/${body.validationId}`,
    );
    expect(expired.status).toBe(404);
    expect(await expired.json()).toEqual({
      error: "Course Pack validation is missing or expired",
    });
    expect(await readdir(stagingRoot)).toEqual([]);

    const unknown = await app.request(
      "/api/course-packs/validations/00000000-0000-4000-8000-999999999999",
    );
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({
      error: "Course Pack validation is missing or expired",
    });

    const malformed = await app.request(
      "/api/course-packs/validations/not-a-validation-id",
    );
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({
      error: "Invalid Course Pack validation identifier",
    });
  });
});
