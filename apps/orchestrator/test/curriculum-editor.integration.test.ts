import {
  migrateDatabase,
  openDatabase,
  type DatabaseConnection,
} from "@dlh/database";
import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";

import { registerCurriculumEditorRoutes } from "../src/curriculum-editor.js";

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
        },
        title: "JavaScript revision 1",
      },
    );
    expect(draftResponse.status).toBe(201);
    const draft = await body<{
      version: { id: string; revision: number; status: string };
    }>(draftResponse);
    expect(draft.version).toMatchObject({ revision: 1, status: "draft" });

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
        },
        title: "JavaScript revision 1",
      },
    );
    expect(retriedDraft.status).toBe(200);
    expect((await body<typeof draft>(retriedDraft)).version.id).toBe(
      draft.version.id,
    );

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
    expect(publishResponse.status).toBe(200);
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
      versions: Array<{ id: string; revision: number }>;
    }>(await request(app, "/api/curriculum-editor/versions"));
    expect(versions.versions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: draft.version.id, revision: 1 }),
        expect.objectContaining({ id: clone.version.id, revision: 2 }),
      ]),
    );
  });

  it("rejects unknown fields and invalid publish graphs without leaking SQL details", async () => {
    const { app } = runtime();
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
});
