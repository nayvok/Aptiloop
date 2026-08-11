import {
  CurriculumAuthoringRepository,
  migrateDatabase,
  openDatabase,
  type DatabaseConnection,
} from "@aptiloop/database";
import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";

import { registerCurriculumEditorRoutes } from "../src/curriculum-editor.js";
import { registerPersonalAdaptationRoutes } from "../src/personal-adaptations.js";

const connections: DatabaseConnection[] = [];
const authority = "127.0.0.1:8787";

afterEach(() => {
  while (connections.length) connections.pop()?.close();
});

function runtime() {
  const connection = openDatabase(":memory:");
  migrateDatabase(connection);
  connections.push(connection);
  const app = new Hono();
  const state = { connection };
  registerCurriculumEditorRoutes(app, state);
  registerPersonalAdaptationRoutes(app, state);
  return { app, connection };
}

function request(
  app: Hono,
  path: string,
  method: "GET" | "POST" | "PATCH" = "GET",
  requestBody?: Record<string, unknown>,
): Promise<Response> {
  return Promise.resolve(
    app.request(`http://${authority}${path}`, {
      method,
      headers: {
        Host: authority,
        ...(requestBody ? { "Content-Type": "application/json" } : {}),
      },
      ...(requestBody ? { body: JSON.stringify(requestBody) } : {}),
    }),
  );
}

async function body<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

async function createPublishedCourse(connection: DatabaseConnection) {
  const repository = new CurriculumAuthoringRepository(connection);
  const version = await repository.createDraft({
    curriculum: {
      id: "course-adaptation-test",
      slug: "adaptation-test",
      title: "Adaptation test",
      description: "Personal branch integration fixture",
      primaryLocale: "en-US",
    },
    title: "Upstream revision 1",
  });
  const week = await repository.addWeek({
    versionId: version.id,
    stableId: "week-core",
    title: "Core",
  });
  const day = await repository.addDay({
    versionId: version.id,
    weekId: week.id,
    stableId: "day-core",
    title: "Core day",
    goal: "Complete the core activity",
    estimatedMinutes: 15,
    depthLevel: "foundation",
  });
  await repository.addUnit({
    versionId: version.id,
    dayId: day.id,
    stableId: "unit-core",
    type: "briefing",
    title: "Original activity",
    completionCriteria: [{ type: "acknowledgement" }],
    payload: { type: "briefing", scope: [] },
  });
  return repository.publishVersion(version.id);
}

async function releaseDraft(app: Hono, versionId: string) {
  const validation = await body<{
    report: {
      validationHash: string;
      draftHash: string;
      valid: boolean;
    };
  }>(
    await request(
      app,
      `/api/curriculum-editor/versions/${versionId}/validation`,
    ),
  );
  const review = await body<{
    review: { changeReviewHash: string };
  }>(
    await request(
      app,
      `/api/curriculum-editor/versions/${versionId}/change-review`,
    ),
  );
  expect(validation.report.valid).toBe(true);
  return request(
    app,
    `/api/curriculum-editor/versions/${versionId}/publish`,
    "POST",
    {
      operationId: `publish-${versionId}`,
      validationHash: validation.report.validationHash,
      changeReviewHash: review.review.changeReviewHash,
      previewHash: validation.report.draftHash,
    },
  );
}

interface AdaptationResponse {
  branch: {
    id: string;
    baseRevisionId: string;
    headRevisionId: string | null;
  } | null;
  revisions: Array<{
    id: string;
    branchKind: "upstream" | "personal";
    status: "draft" | "published" | "archived";
    contentHash: string | null;
  }>;
  comparison: {
    status: "current" | "clean" | "conflict";
    baseRevisionId: string;
    upstreamRevisionId: string;
    personalVersionId: string | null;
    baseDraftHash: string;
    upstreamDraftHash: string;
    personalDraftHash: string | null;
    conflicts: string[];
  };
}

describe("personal adaptation authoring", () => {
  it("keeps personal Publish separate and integrates newer upstream explicitly", async () => {
    const { app, connection } = runtime();
    const upstreamOne = await createPublishedCourse(connection);

    const createResponse = await request(
      app,
      `/api/curriculum-editor/versions/${upstreamOne.id}/adaptation`,
      "POST",
      { operationId: "create-personal-branch" },
    );
    expect(createResponse.status).toBe(200);
    const created = await body<{
      version: { id: string; branchKind: string; basedOnContentHash: string };
      branch: { id: string; baseRevisionId: string };
    }>(createResponse);
    expect(created.version).toMatchObject({
      branchKind: "personal",
      basedOnContentHash: upstreamOne.contentHash,
    });
    expect(created.branch.baseRevisionId).toBe(upstreamOne.id);

    const retried = await body<typeof created>(
      await request(
        app,
        `/api/curriculum-editor/versions/${upstreamOne.id}/adaptation`,
        "POST",
        { operationId: "create-personal-branch" },
      ),
    );
    expect(retried.version.id).toBe(created.version.id);

    const personalGraph = await new CurriculumAuthoringRepository(
      connection,
    ).getVersionGraph(created.version.id);
    const personalUnit = personalGraph.weeks[0]!.days[0]!.units[0]!;
    expect(
      (
        await request(
          app,
          `/api/curriculum-editor/versions/${created.version.id}/units/${personalUnit.id}`,
          "PATCH",
          { operationId: "edit-personal-unit", title: "My preferred activity" },
        )
      ).status,
    ).toBe(200);
    const personalPublish = await releaseDraft(app, created.version.id);
    const personalPublishBody =
      await body<Record<string, unknown>>(personalPublish);
    expect(personalPublish.status, JSON.stringify(personalPublishBody)).toBe(
      200,
    );

    const activeAfterPersonal = connection.sqlite
      .prepare("SELECT active_version_id FROM curricula WHERE id = ?")
      .get(upstreamOne.curriculumId) as { active_version_id: string };
    expect(activeAfterPersonal.active_version_id).toBe(upstreamOne.id);
    expect(
      connection.sqlite
        .prepare(
          "SELECT head_revision_id FROM adaptation_branches WHERE id = ?",
        )
        .get(created.branch.id),
    ).toEqual({ head_revision_id: created.version.id });

    const repository = new CurriculumAuthoringRepository(connection);
    const upstreamTwo = await repository.cloneRevision(upstreamOne.id, {
      title: "Upstream revision 2",
    });
    const upstreamTwoGraph = await repository.getVersionGraph(upstreamTwo.id);
    const upstreamUnit = upstreamTwoGraph.weeks[0]!.days[0]!.units[0]!;
    expect(
      (
        await request(
          app,
          `/api/curriculum-editor/versions/${upstreamTwo.id}/units/${upstreamUnit.id}`,
          "PATCH",
          {
            operationId: "edit-upstream-unit",
            title: "Improved upstream activity",
          },
        )
      ).status,
    ).toBe(200);
    expect((await releaseDraft(app, upstreamTwo.id)).status).toBe(200);
    expect(
      connection.sqlite
        .prepare("SELECT status FROM curriculum_versions WHERE id = ?")
        .get(created.version.id),
    ).toEqual({ status: "published" });

    const overview = await body<AdaptationResponse>(
      await request(
        app,
        `/api/curriculum-editor/courses/${upstreamOne.curriculumId}/adaptation`,
      ),
    );
    expect(overview.comparison.status).toBe("conflict");
    expect(overview.comparison.conflicts).toContain("unit:unit-core");

    const revisionsBeforeStale = overview.revisions.length;
    const integrateInput = {
      operationId: "integrate-upstream-two",
      strategy: "use-upstream" as const,
      ...overview.comparison,
      conflicts: undefined,
      status: undefined,
    };
    const integration = await request(
      app,
      `/api/curriculum-editor/courses/${upstreamOne.curriculumId}/adaptation/integrate`,
      "POST",
      integrateInput,
    );
    expect(integration.status).toBe(200);
    const integrated = await body<{
      version: { id: string; branchKind: string; basedOnContentHash: string };
      strategy: string;
    }>(integration);
    expect(integrated).toMatchObject({
      version: {
        branchKind: "personal",
        basedOnContentHash: expect.any(String),
      },
      strategy: "use-upstream",
    });

    const retriedIntegration = await body<typeof integrated>(
      await request(
        app,
        `/api/curriculum-editor/courses/${upstreamOne.curriculumId}/adaptation/integrate`,
        "POST",
        integrateInput,
      ),
    );
    expect(retriedIntegration.version.id).toBe(integrated.version.id);

    const staleResponse = await request(
      app,
      `/api/curriculum-editor/courses/${upstreamOne.curriculumId}/adaptation/integrate`,
      "POST",
      { ...integrateInput, operationId: "stale-integration-attempt" },
    );
    expect(staleResponse.status).toBe(409);
    expect(await body<{ code: string }>(staleResponse)).toMatchObject({
      code: "stale_comparison",
    });

    const finalOverview = await body<AdaptationResponse>(
      await request(
        app,
        `/api/curriculum-editor/courses/${upstreamOne.curriculumId}/adaptation`,
      ),
    );
    expect(finalOverview.revisions).toHaveLength(revisionsBeforeStale + 1);
    expect(
      connection.sqlite
        .prepare("SELECT active_version_id FROM curricula WHERE id = ?")
        .get(upstreamOne.curriculumId),
    ).toEqual({ active_version_id: upstreamTwo.id });
    expect(
      connection.sqlite
        .prepare(
          "SELECT head_revision_id FROM adaptation_branches WHERE id = ?",
        )
        .get(created.branch.id),
    ).toEqual({ head_revision_id: created.version.id });
  });
});
