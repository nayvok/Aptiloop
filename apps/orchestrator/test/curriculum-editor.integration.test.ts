import {
  createCurriculumAuthoringRepository,
  migrateDatabase,
  openDatabase,
  type DatabaseConnection,
} from "@aptiloop/database";
import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";

import {
  authoringDraftHash,
  registerCurriculumEditorRoutes,
} from "../src/curriculum-editor.js";

const connections: DatabaseConnection[] = [];
const directAuthority = "127.0.0.1:8787";

afterEach(() => {
  while (connections.length) connections.pop()?.close();
});

function runtime() {
  const connection = openDatabase(":memory:");
  migrateDatabase(connection);
  connections.push(connection);
  const app = new Hono();
  registerCurriculumEditorRoutes(app, { connection });
  return { app, connection };
}

function request(app: Hono, path: string): Promise<Response>;
function request(
  app: Hono,
  path: string,
  method: "POST" | "PATCH" | "DELETE",
  body: Record<string, unknown>,
): Promise<Response>;
function request(
  app: Hono,
  path: string,
  method?: "POST" | "PATCH" | "DELETE",
  requestBody?: Record<string, unknown>,
) {
  const url = `http://${directAuthority}${path}`;
  if (method === undefined) {
    return app.request(url, { headers: { Host: directAuthority } });
  }
  return app.request(url, {
    method,
    headers: {
      Host: directAuthority,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });
}

async function body<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

describe("curriculum editor routes", () => {
  it("authors, reorders, publishes, and clones an immutable revision", async () => {
    const { app, connection } = runtime();

    const draftResponse = await request(
      app,
      "/api/curriculum-editor/versions",
      "POST",
      {
        operationId: "create-js-curriculum",
        curriculum: {
          id: "curriculum-js-editor-test",
          slug: "javascript-editor-test",
          title: "JavaScript",
          description: "Local learning path",
          primaryLocale: "ru-RU",
        },
        title: "JavaScript revision 1",
      },
    );
    expect(draftResponse.status).toBe(201);
    const draft = await body<{
      version: { id: string; revision: number; status: string };
    }>(draftResponse);
    expect(draft.version).toMatchObject({ revision: 1, status: "draft" });
    expect(
      connection.sqlite
        .prepare("SELECT primary_locale FROM courses WHERE id = ?")
        .get("curriculum-js-editor-test"),
    ).toEqual({ primary_locale: "ru-RU" });
    const courseAfterCreate = connection.sqlite
      .prepare(
        `SELECT id, slug, title, description, primary_locale, active_revision_id,
                created_at, updated_at
         FROM courses WHERE id = ?`,
      )
      .get("curriculum-js-editor-test");
    const versionsAfterCreate = connection.sqlite
      .prepare(
        "SELECT COUNT(*) AS count FROM curriculum_versions WHERE curriculum_id = ?",
      )
      .get("curriculum-js-editor-test");
    const serverGraph = await createCurriculumAuthoringRepository(
      connection,
    ).getVersionGraph(draft.version.id);
    expect(serverGraph.primaryLocale).toBe("ru-RU");
    expect(authoringDraftHash(serverGraph)).not.toBe(
      authoringDraftHash({ ...serverGraph, primaryLocale: "en-US" }),
    );

    const retriedDraft = await request(
      app,
      "/api/curriculum-editor/versions",
      "POST",
      {
        operationId: "create-js-curriculum",
        curriculum: {
          id: "curriculum-js-editor-test",
          slug: "javascript-editor-test",
          title: "JavaScript",
          description: "Local learning path",
          primaryLocale: "ru-RU",
        },
        title: "JavaScript revision 1",
      },
    );
    expect(retriedDraft.status).toBe(200);
    expect((await body<typeof draft>(retriedDraft)).version.id).toBe(
      draft.version.id,
    );
    expect(
      connection.sqlite
        .prepare(
          `SELECT id, slug, title, description, primary_locale, active_revision_id,
                  created_at, updated_at
           FROM courses WHERE id = ?`,
        )
        .get("curriculum-js-editor-test"),
    ).toEqual(courseAfterCreate);
    expect(
      connection.sqlite
        .prepare(
          "SELECT COUNT(*) AS count FROM curriculum_versions WHERE curriculum_id = ?",
        )
        .get("curriculum-js-editor-test"),
    ).toEqual(versionsAfterCreate);

    const mismatchedCreateRetry = await request(
      app,
      "/api/curriculum-editor/versions",
      "POST",
      {
        operationId: "create-js-curriculum",
        curriculum: {
          id: "curriculum-js-editor-test",
          slug: "javascript-editor-test",
          title: "Different Course title",
          description: "Local learning path",
          primaryLocale: "en-US",
        },
        title: "Different revision title",
      },
    );
    expect(mismatchedCreateRetry.status).toBe(409);
    expect(await mismatchedCreateRetry.json()).toEqual({
      error: {
        code: "operation_conflict",
        message:
          "Operation ID was already used for a different authoring request",
      },
    });
    expect(
      connection.sqlite
        .prepare(
          `SELECT id, slug, title, description, primary_locale, active_revision_id,
                  created_at, updated_at
           FROM courses WHERE id = ?`,
        )
        .get("curriculum-js-editor-test"),
    ).toEqual(courseAfterCreate);
    expect(
      connection.sqlite
        .prepare(
          "SELECT COUNT(*) AS count FROM curriculum_versions WHERE curriculum_id = ?",
        )
        .get("curriculum-js-editor-test"),
    ).toEqual(versionsAfterCreate);

    const weekResponse = await request(
      app,
      `/api/curriculum-editor/versions/${draft.version.id}/weeks`,
      "POST",
      {
        operationId: "add-week-one",
        stableId: "week-1",
        title: "Foundation",
      },
    );
    expect(weekResponse.status).toBe(201);
    const week = await body<{ week: { id: string } }>(weekResponse);

    const disposableWeekResponse = await request(
      app,
      `/api/curriculum-editor/versions/${draft.version.id}/weeks`,
      "POST",
      {
        operationId: "add-disposable-week",
        stableId: "week-disposable",
        title: "Disposable",
      },
    );
    const disposableWeek = await body<{ week: { id: string } }>(
      disposableWeekResponse,
    );
    expect(
      (
        await request(
          app,
          `/api/curriculum-editor/versions/${draft.version.id}/weeks/reorder`,
          "POST",
          {
            operationId: "reorder-weeks",
            orderedIds: [disposableWeek.week.id, week.week.id],
          },
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await request(
          app,
          `/api/curriculum-editor/versions/${draft.version.id}/weeks/${disposableWeek.week.id}`,
          "PATCH",
          { operationId: "rename-disposable-week", title: "Temporary" },
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await request(
          app,
          `/api/curriculum-editor/versions/${draft.version.id}/weeks/${disposableWeek.week.id}`,
          "DELETE",
          { operationId: "delete-disposable-week" },
        )
      ).status,
    ).toBe(200);

    const dayResponse = await request(
      app,
      `/api/curriculum-editor/versions/${draft.version.id}/weeks/${week.week.id}/days`,
      "POST",
      {
        operationId: "add-day-one",
        stableId: "day-1",
        title: "Values and bindings",
        description: "Learn the runtime model",
        goal: "Explain values, bindings, and coercion",
        estimatedMinutes: 90,
        prerequisites: [],
        expectedOutcomes: ["Explain binding semantics"],
        depthLevel: "foundation",
        topics: ["Values"],
      },
    );
    expect(dayResponse.status).toBe(201);
    const day = await body<{
      day: {
        id: string;
        prerequisites: unknown[];
        expectedOutcomes: unknown[];
        topics: unknown[];
      };
    }>(dayResponse);
    expect(day.day).toMatchObject({
      prerequisites: [],
      expectedOutcomes: ["Explain binding semantics"],
      topics: ["Values"],
    });
    expect(day.day).not.toHaveProperty("prerequisitesJson");
    const disposableDayResponse = await request(
      app,
      `/api/curriculum-editor/versions/${draft.version.id}/weeks/${week.week.id}/days`,
      "POST",
      {
        operationId: "add-disposable-day",
        stableId: "day-disposable",
        title: "Disposable day",
        goal: "Temporary goal",
        estimatedMinutes: 10,
        depthLevel: "foundation",
      },
    );
    const disposableDay = await body<{ day: { id: string } }>(
      disposableDayResponse,
    );
    expect(
      (
        await request(
          app,
          `/api/curriculum-editor/versions/${draft.version.id}/weeks/${week.week.id}/days/reorder`,
          "POST",
          {
            operationId: "reorder-days",
            orderedIds: [disposableDay.day.id, day.day.id],
          },
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await request(
          app,
          `/api/curriculum-editor/versions/${draft.version.id}/days/${disposableDay.day.id}`,
          "PATCH",
          { operationId: "rename-disposable-day", title: "Temporary day" },
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await request(
          app,
          `/api/curriculum-editor/versions/${draft.version.id}/days/${disposableDay.day.id}`,
          "DELETE",
          { operationId: "delete-disposable-day" },
        )
      ).status,
    ).toBe(200);
    const patchedDay = await request(
      app,
      `/api/curriculum-editor/versions/${draft.version.id}/days/${day.day.id}`,
      "PATCH",
      { operationId: "refine-day", estimatedMinutes: 100 },
    );
    expect(patchedDay.status).toBe(200);

    const makeUnit = async (
      operationId: string,
      stableId: string,
      type: "briefing" | "study" | "summary",
      title: string,
    ) => {
      const response = await request(
        app,
        `/api/curriculum-editor/versions/${draft.version.id}/days/${day.day.id}/units`,
        "POST",
        {
          operationId,
          stableId,
          type,
          title,
          estimatedMinutes: 10,
          objectives: [title],
          completionCriteria: [{ type: "acknowledgement" }],
          payload:
            type === "briefing"
              ? { type, scope: [] }
              : type === "summary"
                ? { type, prompts: [] }
                : { type, body: title },
        },
      );
      expect(response.status).toBe(201);
      const created = await body<{
        unit: {
          id: string;
          stableId: string;
          completionCriteria: unknown[];
          payload: Record<string, unknown>;
        };
      }>(response);
      expect(created.unit.completionCriteria).toEqual([
        { type: "acknowledgement" },
      ]);
      expect(created.unit.payload).toMatchObject({ type });
      expect(created.unit).not.toHaveProperty("completionCriteriaJson");
      return created;
    };

    const briefing = await makeUnit(
      "add-briefing",
      "briefing",
      "briefing",
      "Briefing",
    );
    const study = await makeUnit("add-study", "study", "study", "Study");
    const summary = await makeUnit(
      "add-summary",
      "summary",
      "summary",
      "Summary",
    );
    expect(
      (
        await request(
          app,
          `/api/curriculum-editor/versions/${draft.version.id}/units/${summary.unit.id}`,
          "PATCH",
          {
            operationId: "link-summary",
            unlockRules: [
              { type: "unit-completed", unitId: briefing.unit.stableId },
            ],
          },
        )
      ).status,
    ).toBe(200);
    const temporary = await makeUnit(
      "add-temporary",
      "temporary",
      "study",
      "Temporary",
    );
    expect(
      (
        await request(
          app,
          `/api/curriculum-editor/versions/${draft.version.id}/units/${temporary.unit.id}`,
          "PATCH",
          { operationId: "rename-temporary", title: "Temporary updated" },
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await request(
          app,
          `/api/curriculum-editor/versions/${draft.version.id}/units/${temporary.unit.id}`,
          "DELETE",
          { operationId: "delete-temporary" },
        )
      ).status,
    ).toBe(200);

    const reorder = await request(
      app,
      `/api/curriculum-editor/versions/${draft.version.id}/days/${day.day.id}/units/reorder`,
      "POST",
      {
        operationId: "reorder-units",
        orderedIds: [study.unit.id, briefing.unit.id, summary.unit.id],
      },
    );
    expect(reorder.status).toBe(200);

    const validation = await body<{
      report: {
        valid: boolean;
        errors: number;
        validationHash: string;
        draftHash: string;
      };
    }>(
      await request(
        app,
        `/api/curriculum-editor/versions/${draft.version.id}/validation`,
      ),
    );
    expect(validation.report).toMatchObject({ valid: true, errors: 0 });
    expect(validation.report.validationHash).toMatch(/^sha256:[a-f0-9]{64}$/u);

    const preview = await body<{
      preview: { title: string; draftHash: string; weeks: unknown[] };
    }>(
      await request(
        app,
        `/api/curriculum-editor/versions/${draft.version.id}/preview`,
      ),
    );
    expect(preview.preview).toMatchObject({
      title: "JavaScript revision 1",
      draftHash: validation.report.draftHash,
    });
    expect(JSON.stringify(preview)).not.toContain("referenceAnswer");
    expect(JSON.stringify(preview)).not.toContain("correctIndex");

    const review = await body<{
      review: {
        ready: boolean;
        added: number;
        changed: number;
        removed: number;
        changes: Array<{
          operation: "added" | "changed" | "removed";
          entityType: "week" | "day" | "unit";
          stableId: string;
        }>;
        changeReviewHash: string;
      };
    }>(
      await request(
        app,
        `/api/curriculum-editor/versions/${draft.version.id}/change-review`,
      ),
    );
    expect(review.review).toMatchObject({
      ready: true,
      added: 5,
      changed: 0,
      removed: 0,
    });
    expect(review.review.changes).toEqual(
      expect.arrayContaining([
        { operation: "added", entityType: "week", stableId: "week-1" },
        { operation: "added", entityType: "day", stableId: "day-1" },
        { operation: "added", entityType: "unit", stableId: "study" },
      ]),
    );

    const stalePublish = await request(
      app,
      `/api/curriculum-editor/versions/${draft.version.id}/publish`,
      "POST",
      {
        operationId: "publish-with-stale-evidence",
        previewHash: preview.preview.draftHash,
        validationHash: `sha256:${"0".repeat(64)}`,
        changeReviewHash: review.review.changeReviewHash,
      },
    );
    expect(stalePublish.status).toBe(409);
    expect(await stalePublish.json()).toMatchObject({
      error: { code: "release_evidence_stale" },
    });

    const publishResponse = await request(
      app,
      `/api/curriculum-editor/versions/${draft.version.id}/publish`,
      "POST",
      {
        operationId: "publish-revision-one",
        validationHash: validation.report.validationHash,
        changeReviewHash: review.review.changeReviewHash,
        previewHash: preview.preview.draftHash,
      },
    );
    const publishFailure =
      publishResponse.status === 200
        ? null
        : await publishResponse.clone().json();
    expect(publishResponse.status, JSON.stringify(publishFailure)).toBe(200);
    const published = await body<{
      version: { id: string; status: string; contentHash: string };
    }>(publishResponse);
    expect(published.version.status).toBe("published");
    expect(published.version.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(
      connection.sqlite
        .prepare(
          `SELECT stable_id FROM course_activities
           WHERE course_id = ? AND revision_id = ?
           ORDER BY order_index, id`,
        )
        .all("curriculum-js-editor-test", draft.version.id),
    ).toEqual([
      { stable_id: "study" },
      { stable_id: "briefing" },
      { stable_id: "summary" },
    ]);
    expect(
      connection.sqlite
        .prepare(
          `SELECT prerequisite_activity_id FROM course_activity_prerequisites
           WHERE course_id = ? AND revision_id = ? AND activity_id = ?`,
        )
        .all("curriculum-js-editor-test", draft.version.id, summary.unit.id),
    ).toEqual([{ prerequisite_activity_id: briefing.unit.id }]);
    expect(
      connection.sqlite
        .prepare(
          `SELECT status, content_hash FROM course_revisions
           WHERE course_id = ? AND id = ?`,
        )
        .get("curriculum-js-editor-test", draft.version.id),
    ).toEqual({
      status: "published",
      content_hash: published.version.contentHash,
    });

    const publishedGraphResponse = await request(
      app,
      `/api/curriculum-editor/versions/${draft.version.id}`,
    );
    const publishedGraph = await body<{
      curriculum: {
        version: { id: string; status: string };
        weeks: Array<{
          days: Array<{
            id: string;
            stableId: string;
            estimatedMinutes: number;
            units: Array<{ id: string; stableId: string; title: string }>;
          }>;
        }>;
      };
    }>(publishedGraphResponse);
    expect(
      publishedGraph.curriculum.weeks[0]?.days[0]?.units.map(
        (unit) => unit.stableId,
      ),
    ).toEqual(["study", "briefing", "summary"]);
    expect(publishedGraph.curriculum.weeks[0]?.days[0]?.estimatedMinutes).toBe(
      100,
    );

    const immutableEdit = await request(
      app,
      `/api/curriculum-editor/versions/${draft.version.id}/units/${study.unit.id}`,
      "PATCH",
      { operationId: "try-edit-published", title: "Changed after publish" },
    );
    expect(immutableEdit.status).toBe(409);
    expect(await immutableEdit.json()).toEqual({
      error: {
        code: "immutable_version",
        message: "Published curriculum versions cannot be edited",
      },
    });

    const courseBeforeIdentityCollisions = connection.sqlite
      .prepare(
        `SELECT id, slug, title, description, primary_locale, active_revision_id,
                created_at, updated_at
         FROM courses WHERE id = ?`,
      )
      .get("curriculum-js-editor-test");
    const curriculumBeforeIdentityCollisions = connection.sqlite
      .prepare(
        `SELECT id, slug, title, description, active_version_id,
                created_at, updated_at
         FROM curricula WHERE id = ?`,
      )
      .get("curriculum-js-editor-test");
    const versionCountBeforeIdentityCollisions = connection.sqlite
      .prepare(
        "SELECT COUNT(*) AS count FROM curriculum_versions WHERE curriculum_id = ?",
      )
      .get("curriculum-js-editor-test");

    const idCollision = await request(
      app,
      "/api/curriculum-editor/versions",
      "POST",
      {
        operationId: "create-collision-existing-id",
        curriculum: {
          id: "curriculum-js-editor-test",
          slug: "replacement-javascript-editor-test",
          title: "Replacement Course",
          description: "Must not replace existing metadata",
          primaryLocale: "en-US",
        },
        title: "Replacement revision",
      },
    );
    expect(idCollision.status).toBe(409);
    expect(await idCollision.json()).toEqual({
      error: {
        code: "course_identity_conflict",
        message: "A Course with that ID or slug already exists",
      },
    });

    const slugCollision = await request(
      app,
      "/api/curriculum-editor/versions",
      "POST",
      {
        operationId: "create-collision-existing-slug",
        curriculum: {
          id: "replacement-curriculum-js-editor-test",
          slug: "javascript-editor-test",
          title: "Slug replacement Course",
          description: "Must not create a partial Course",
          primaryLocale: "en-US",
        },
        title: "Slug replacement revision",
      },
    );
    expect(slugCollision.status).toBe(409);
    expect(await slugCollision.json()).toEqual({
      error: {
        code: "course_identity_conflict",
        message: "A Course with that ID or slug already exists",
      },
    });
    expect(
      connection.sqlite
        .prepare(
          `SELECT id, slug, title, description, primary_locale, active_revision_id,
                  created_at, updated_at
           FROM courses WHERE id = ?`,
        )
        .get("curriculum-js-editor-test"),
    ).toEqual(courseBeforeIdentityCollisions);
    expect(
      connection.sqlite
        .prepare(
          `SELECT id, slug, title, description, active_version_id,
                  created_at, updated_at
           FROM curricula WHERE id = ?`,
        )
        .get("curriculum-js-editor-test"),
    ).toEqual(curriculumBeforeIdentityCollisions);
    expect(
      connection.sqlite
        .prepare(
          "SELECT COUNT(*) AS count FROM curriculum_versions WHERE curriculum_id = ?",
        )
        .get("curriculum-js-editor-test"),
    ).toEqual(versionCountBeforeIdentityCollisions);
    expect(
      connection.sqlite
        .prepare(
          `SELECT COUNT(*) AS count FROM curricula
           WHERE id = 'replacement-curriculum-js-editor-test'
              OR slug = 'replacement-javascript-editor-test'`,
        )
        .get(),
    ).toEqual({ count: 0 });

    const cloneResponse = await request(
      app,
      `/api/curriculum-editor/versions/${draft.version.id}/clone`,
      "POST",
      { operationId: "clone-revision-two", title: "JavaScript revision 2" },
    );
    expect(cloneResponse.status).toBe(201);
    const clone = await body<{
      version: {
        id: string;
        revision: number;
        parentVersionId: string;
        status: string;
      };
    }>(cloneResponse);
    expect(clone.version).toMatchObject({
      revision: 2,
      parentVersionId: draft.version.id,
      status: "draft",
    });
    expect(
      connection.sqlite
        .prepare(
          `SELECT id, slug, title, description, primary_locale, active_revision_id,
                  created_at, updated_at
           FROM courses WHERE id = ?`,
        )
        .get("curriculum-js-editor-test"),
    ).toEqual(courseBeforeIdentityCollisions);
    const cloneRowsBeforeRetry = connection.sqlite
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM curriculum_versions WHERE id = ?) AS versions,
           (SELECT COUNT(*) FROM curriculum_weeks WHERE version_id = ?) AS weeks,
           (SELECT COUNT(*) FROM curriculum_days_v2 WHERE version_id = ?) AS days,
           (SELECT COUNT(*) FROM curriculum_units WHERE version_id = ?) AS units`,
      )
      .get(
        clone.version.id,
        clone.version.id,
        clone.version.id,
        clone.version.id,
      );

    const cloneRetry = await request(
      app,
      `/api/curriculum-editor/versions/${draft.version.id}/clone`,
      "POST",
      { operationId: "clone-revision-two", title: "JavaScript revision 2" },
    );
    expect(cloneRetry.status).toBe(200);
    expect((await body<typeof clone>(cloneRetry)).version.id).toBe(
      clone.version.id,
    );
    expect(
      connection.sqlite
        .prepare(
          `SELECT
             (SELECT COUNT(*) FROM curriculum_versions WHERE id = ?) AS versions,
             (SELECT COUNT(*) FROM curriculum_weeks WHERE version_id = ?) AS weeks,
             (SELECT COUNT(*) FROM curriculum_days_v2 WHERE version_id = ?) AS days,
             (SELECT COUNT(*) FROM curriculum_units WHERE version_id = ?) AS units`,
        )
        .get(
          clone.version.id,
          clone.version.id,
          clone.version.id,
          clone.version.id,
        ),
    ).toEqual(cloneRowsBeforeRetry);

    const mismatchedCloneRetry = await request(
      app,
      `/api/curriculum-editor/versions/${draft.version.id}/clone`,
      "POST",
      {
        operationId: "clone-revision-two",
        title: "Different clone title",
      },
    );
    expect(mismatchedCloneRetry.status).toBe(409);
    expect(await mismatchedCloneRetry.json()).toEqual({
      error: {
        code: "operation_conflict",
        message:
          "Operation ID was already used for a different authoring request",
      },
    });
    expect(
      connection.sqlite
        .prepare(
          `SELECT
             (SELECT COUNT(*) FROM curriculum_versions WHERE id = ?) AS versions,
             (SELECT COUNT(*) FROM curriculum_weeks WHERE version_id = ?) AS weeks,
             (SELECT COUNT(*) FROM curriculum_days_v2 WHERE version_id = ?) AS days,
             (SELECT COUNT(*) FROM curriculum_units WHERE version_id = ?) AS units`,
        )
        .get(
          clone.version.id,
          clone.version.id,
          clone.version.id,
          clone.version.id,
        ),
    ).toEqual(cloneRowsBeforeRetry);

    const draftSourceClone = await request(
      app,
      `/api/curriculum-editor/versions/${clone.version.id}/clone`,
      "POST",
      { operationId: "clone-draft-source" },
    );
    expect(draftSourceClone.status).toBe(409);
    expect(await draftSourceClone.json()).toEqual({
      error: {
        code: "invalid_clone_source",
        message:
          "Only a published upstream revision can be cloned into a generic Draft",
      },
    });

    connection.sqlite
      .prepare(
        `INSERT INTO curriculum_versions
         (id, curriculum_id, revision, parent_version_id, status, title,
          description, content_hash, created_at, published_at, archived_at,
          updated_at, branch_kind, based_on_content_hash, adaptation_branch_id)
         VALUES ('published-personal-source', ?, 3, ?, 'published',
                 'Published personal source', NULL, ?, 300, 300, NULL, 300,
                 'personal', ?, NULL)`,
      )
      .run(
        "curriculum-js-editor-test",
        draft.version.id,
        published.version.contentHash,
        published.version.contentHash,
      );
    const personalSourceClone = await request(
      app,
      "/api/curriculum-editor/versions/published-personal-source/clone",
      "POST",
      { operationId: "clone-personal-source" },
    );
    expect(personalSourceClone.status).toBe(409);
    expect(await personalSourceClone.json()).toEqual({
      error: {
        code: "invalid_clone_source",
        message:
          "Only a published upstream revision can be cloned into a generic Draft",
      },
    });

    const cloneGraph = await body<typeof publishedGraph>(
      await request(app, `/api/curriculum-editor/versions/${clone.version.id}`),
    );
    const cloneDay = cloneGraph.curriculum.weeks[0]?.days[0];
    if (!cloneDay) throw new Error("Cloned day is missing");
    const invalidSelfPrerequisite = await request(
      app,
      `/api/curriculum-editor/versions/${clone.version.id}/days/${cloneDay.id}`,
      "PATCH",
      {
        operationId: "make-self-prerequisite",
        prerequisites: [cloneDay.stableId],
      },
    );
    expect(invalidSelfPrerequisite.status).toBe(409);
    expect(await invalidSelfPrerequisite.json()).toEqual({
      error: {
        code: "validation_failed",
        message: "Lesson prerequisite is invalid",
      },
    });
    const cloneStudyId = cloneGraph.curriculum.weeks[0]?.days[0]?.units[0]?.id;
    expect(cloneStudyId).toBeTruthy();
    const invalidPartialUnit = await request(
      app,
      `/api/curriculum-editor/versions/${clone.version.id}/units/${cloneStudyId}`,
      "PATCH",
      { operationId: "invalid-partial-unit", type: "quiz" },
    );
    expect(invalidPartialUnit.status).toBe(409);
    const cloneAfterInvalidPatch = await body<typeof publishedGraph>(
      await request(app, `/api/curriculum-editor/versions/${clone.version.id}`),
    );
    expect(
      cloneAfterInvalidPatch.curriculum.weeks[0]?.days[0]?.units[0],
    ).toMatchObject({ stableId: "study", title: "Study" });
    expect(
      (
        await request(
          app,
          `/api/curriculum-editor/versions/${clone.version.id}/units/${cloneStudyId}`,
          "PATCH",
          { operationId: "change-clone-only", title: "Study in revision 2" },
        )
      ).status,
    ).toBe(200);

    const originalAfterClone = await body<typeof publishedGraph>(
      await request(app, `/api/curriculum-editor/versions/${draft.version.id}`),
    );
    expect(originalAfterClone).toEqual(publishedGraph);

    const versions = await body<{
      versions: Array<{
        id: string;
        revision: number;
        primaryLocale: string;
        branchKind: string;
        parentVersionId: string | null;
      }>;
    }>(await request(app, "/api/curriculum-editor/versions"));
    expect(versions.versions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: draft.version.id,
          revision: 1,
          primaryLocale: "ru-RU",
          branchKind: "upstream",
          parentVersionId: null,
        }),
        expect.objectContaining({
          id: clone.version.id,
          revision: 2,
          primaryLocale: "ru-RU",
          branchKind: "upstream",
          parentVersionId: draft.version.id,
        }),
      ]),
    );
  });

  it("rejects unknown fields and invalid publish graphs without leaking SQL details", async () => {
    const { app, connection } = runtime();
    const invalidLocale = await request(
      app,
      "/api/curriculum-editor/versions",
      "POST",
      {
        operationId: "invalid-locale",
        curriculum: {
          id: "curriculum-invalid-locale",
          slug: "curriculum-invalid-locale",
          title: "Invalid locale",
          primaryLocale: "not_a_locale",
        },
        title: "Invalid locale",
      },
    );
    expect(invalidLocale.status).toBe(400);
    expect(await invalidLocale.json()).toEqual({
      error: { code: "invalid_request", message: "Request body is invalid" },
    });
    expect(
      connection.sqlite
        .prepare("SELECT COUNT(*) AS count FROM courses WHERE id = ?")
        .get("curriculum-invalid-locale"),
    ).toEqual({ count: 0 });

    const missingLocale = await request(
      app,
      "/api/curriculum-editor/versions",
      "POST",
      {
        operationId: "missing-locale",
        curriculum: {
          id: "curriculum-missing-locale",
          slug: "curriculum-missing-locale",
          title: "Missing locale",
        },
        title: "Missing locale",
      },
    );
    expect(missingLocale.status).toBe(400);
    expect(await missingLocale.json()).toEqual({
      error: { code: "invalid_request", message: "Request body is invalid" },
    });
    expect(
      connection.sqlite
        .prepare("SELECT COUNT(*) AS count FROM courses WHERE id = ?")
        .get("curriculum-missing-locale"),
    ).toEqual({ count: 0 });

    const invalid = await request(
      app,
      "/api/curriculum-editor/versions",
      "POST",
      {
        operationId: "invalid-request",
        curriculum: {
          id: "curriculum-invalid",
          slug: "curriculum-invalid",
          title: "Invalid",
          primaryLocale: "en-US",
        },
        title: "Invalid",
        workspacePath: "C:/private",
      },
    );
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({
      error: { code: "invalid_request", message: "Request body is invalid" },
    });

    const draftResponse = await request(
      app,
      "/api/curriculum-editor/versions",
      "POST",
      {
        operationId: "empty-draft",
        curriculum: {
          id: "curriculum-empty",
          slug: "curriculum-empty",
          title: "Empty",
          primaryLocale: "en-US",
        },
        title: "Empty draft",
      },
    );
    const draft = await body<{ version: { id: string } }>(draftResponse);
    const invalidValidation = await body<{
      report: { validationHash: string; valid: boolean };
    }>(
      await request(
        app,
        `/api/curriculum-editor/versions/${draft.version.id}/validation`,
      ),
    );
    const invalidReview = await body<{
      review: { changeReviewHash: string };
    }>(
      await request(
        app,
        `/api/curriculum-editor/versions/${draft.version.id}/change-review`,
      ),
    );
    expect(invalidValidation.report.valid).toBe(false);

    const publish = await request(
      app,
      `/api/curriculum-editor/versions/${draft.version.id}/publish`,
      "POST",
      {
        operationId: "publish-empty",
        validationHash: invalidValidation.report.validationHash,
        changeReviewHash: invalidReview.review.changeReviewHash,
        previewHash: invalidValidation.report.validationHash,
      },
    );
    expect(publish.status).toBe(409);
    expect(await publish.json()).toMatchObject({
      error: { code: "validation_failed" },
    });
  });

  it("propagates unexpected storage failures instead of masking them as client errors", async () => {
    const connection = openDatabase(":memory:");
    migrateDatabase(connection);
    let closed = false;
    const closeOnce = () => {
      if (!closed) {
        closed = true;
        connection.close();
      }
    };
    try {
      const app = new Hono();
      app.onError((error, context) => {
        console.error(error);
        return context.json({ error: "Internal server error" }, 500);
      });
      registerCurriculumEditorRoutes(app, { connection });
      closeOnce();
      const response = await request(app, "/api/curriculum-editor/versions");
      expect(response.status).toBe(500);
    } finally {
      closeOnce();
    }
  });
});
