import { type AgentProvider } from "@dlh/agent-core";
import {
  CurriculumAuthoringRepository,
  migrateDatabase,
  openDatabase,
  type DatabaseConnection,
} from "@dlh/database";
import type {
  AgentEvent,
  AgentModel,
  AgentSession,
  CreateAgentSessionInput,
  ProviderId,
  ProviderStatus,
  StreamAgentMessageInput,
} from "@dlh/shared";
import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";

import { registerCourseDesignerRoutes } from "../src/course-designer.js";
import { registerCurriculumEditorRoutes } from "../src/curriculum-editor.js";
import { ProviderRuntime } from "../src/provider-runtime.js";

const timestamp = "2026-08-10T00:00:00.000Z";
const connections: DatabaseConnection[] = [];

const completeProposal = {
  summary: "Add a finite foundations slice",
  changes: [
    {
      kind: "add-week",
      stableId: "foundations-week",
      title: "Foundations",
      description: "Build the prerequisite mental model.",
    },
    {
      kind: "add-day",
      parentStableId: "foundations-week",
      stableId: "foundations-day",
      title: "Recall foundations",
      goal: "Recall the core model from memory.",
      estimatedMinutes: 20,
      expectedOutcomes: ["Explain the core model"],
      depthLevel: "foundation",
    },
    {
      kind: "add-unit",
      parentStableId: "foundations-day",
      stableId: "foundations-recall",
      type: "recall",
      title: "Recall the model",
      completionCriteria: [{ type: "acknowledgement" }],
      payload: { type: "recall", prompt: "Recall the core model" },
    },
  ],
};

const workflowRequest = {
  goal: "Build a foundations learning slice",
  targetOutcome: "Explain the core model without notes",
  currentLevel: "Beginner",
  constraints: ["Complete in one session"],
  sources: [
    {
      id: "source:1",
      title: "Owner-provided notes",
      kind: "provided-text",
      locator: "The core model has three explicit parts.",
      attribution: "Repository owner",
      approved: true,
    },
  ],
  activityPreferences: ["recall"],
  runtimeRequirements: ["No runtime required"],
};

afterEach(() => {
  while (connections.length > 0) connections.pop()?.close();
});

class ProposalProvider implements AgentProvider {
  readonly id: ProviderId;
  readonly createInputs: CreateAgentSessionInput[] = [];
  readonly streamInputs: StreamAgentMessageInput[] = [];
  readonly #proposal: string;

  constructor(id: ProviderId, proposal: unknown) {
    this.id = id;
    this.#proposal = JSON.stringify(proposal);
  }

  async getStatus(): Promise<ProviderStatus> {
    return {
      providerId: this.id,
      state: "connected",
      checkedAt: timestamp,
      capabilities: ["streaming", "models", "cancellation", "tools"],
    };
  }

  async listModels(): Promise<AgentModel[]> {
    const modelIds =
      this.id === "mock"
        ? ["mock-deterministic", "mock-designer"]
        : [`${this.id}-designer`];
    return modelIds.map((modelId) => ({
      id: modelId,
      providerId: this.id,
      name: "Course Designer test model",
      supportsStreaming: true,
      available: true,
    }));
  }

  async createSession(input: CreateAgentSessionInput): Promise<AgentSession> {
    this.createInputs.push(input);
    return {
      id: `session:${this.createInputs.length}`,
      providerId: this.id,
      role: input.role,
      modelId: input.modelId,
      status: "active",
      createdAt: timestamp,
      metadata: input.metadata,
    };
  }

  async *streamMessage(
    input: StreamAgentMessageInput,
  ): AsyncIterable<AgentEvent> {
    this.streamInputs.push(input);
    yield {
      type: "message.completed",
      sessionId: input.sessionId,
      sequence: 0,
      timestamp,
      content: this.#proposal,
    };
    yield {
      type: "session.completed",
      sessionId: input.sessionId,
      sequence: 1,
      timestamp,
      reason: "completed",
    };
  }

  async cancelSession(): Promise<void> {}
}

async function createRuntime(proposal: unknown = completeProposal) {
  const connection = openDatabase(":memory:");
  migrateDatabase(connection);
  connections.push(connection);
  const mock = new ProposalProvider("mock", proposal);
  const providers = {
    mock,
    codex: new ProposalProvider("codex", proposal),
    opencode: new ProposalProvider("opencode", proposal),
    pi: new ProposalProvider("pi", proposal),
  };
  const providerRuntime = new ProviderRuntime({
    connection,
    providers,
    developmentMode: true,
  });
  const settings = await providerRuntime.settings();
  await providerRuntime.saveRoleProfiles(
    settings.roleProfiles.map((profile) =>
      profile.role === "course-designer"
        ? {
            role: profile.role,
            mode: "connection" as const,
            connectionId: "conn:mock",
            modelId: "mock-designer",
          }
        : {
            role: profile.role,
            mode: profile.mode,
            connectionId: profile.connectionId,
            modelId: profile.modelId,
          },
    ),
  );

  const repository = new CurriculumAuthoringRepository(connection);
  const version = await repository.createDraft({
    curriculum: {
      id: "course-designer-test",
      slug: "course-designer-test",
      title: "Course Designer Test",
    },
    title: "Draft revision",
  });
  const app = new Hono();
  registerCurriculumEditorRoutes(app, { connection });
  registerCourseDesignerRoutes(app, { connection, providerRuntime });
  return { app, connection, mock, providerRuntime, repository, version };
}

function post(app: Hono, path: string, body: unknown): Promise<Response> {
  return Promise.resolve(
    app.request(`http://127.0.0.1:8787${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

function get(app: Hono, path: string): Promise<Response> {
  return Promise.resolve(
    app.request(`http://127.0.0.1:8787${path}`, { method: "GET" }),
  );
}

async function startWorkflow(app: Hono, base: string): Promise<string> {
  const created = await post(app, `${base}/workflows`, {
    operationId: "workflow:create",
    request: workflowRequest,
  });
  expect(created.status).toBe(200);
  const workflowId = (
    (await created.json()) as { workflow: { id: string; state: string } }
  ).workflow.id;
  for (const [operationId, action, state] of [
    ["workflow:submit", "submit-request", "DISCOVERY"],
    ["workflow:discover", "complete-discovery", "DIAGNOSTIC"],
    ["workflow:skip", "skip-diagnostic", "CURRICULUM_PROPOSAL"],
  ] as const) {
    const response = await post(
      app,
      `${base}/workflows/${encodeURIComponent(workflowId)}/advance`,
      { operationId, action },
    );
    expect(response.status).toBe(200);
    expect(
      ((await response.json()) as { workflow: { state: string } }).workflow
        .state,
    ).toBe(state);
  }
  return workflowId;
}

describe("Course Designer", () => {
  it("runs the finite review workflow and publishes only through the manual gate", async () => {
    const { app, connection, mock, version } = await createRuntime();
    const base = `/api/curriculum-editor/versions/${version.id}/designer`;
    const workflowId = await startWorkflow(app, base);

    const generated = await post(
      app,
      `${base}/workflows/${encodeURIComponent(workflowId)}/generate`,
      { operationId: "proposal:generate" },
    );
    expect(generated.status).toBe(200);
    const generatedBody = (await generated.json()) as {
      workflow: { state: string; activeProposalId: string };
      proposal: {
        id: string;
        status: string;
        attribution: {
          providerType: string;
          modelId: string;
          promptTemplateVersion: string;
          provenance: { sourceIds: string[] };
          validation: { valid: boolean };
        };
      };
    };
    expect(generatedBody.workflow.state).toBe("USER_REVIEW");
    expect(generatedBody.proposal).toMatchObject({
      status: "proposed",
      attribution: {
        providerType: "mock",
        modelId: "mock-designer",
        promptTemplateVersion: "v1.1.0",
        provenance: { sourceIds: ["source:1"] },
        validation: { valid: true },
      },
    });
    expect(
      connection.sqlite
        .prepare(
          "SELECT COUNT(*) AS count FROM curriculum_weeks WHERE version_id = ?",
        )
        .get(version.id),
    ).toEqual({ count: 0 });
    expect(mock.createInputs[0]?.systemPrompt).toContain(
      "Propose a finite typed patch",
    );
    expect(mock.createInputs[0]?.metadata).toMatchObject({
      workflowId,
      approvedSources: [{ id: "source:1", approved: true }],
    });

    const prematureApply = await post(
      app,
      `${base}/workflows/${encodeURIComponent(workflowId)}/proposals/${encodeURIComponent(generatedBody.proposal.id)}/apply`,
      { operationId: "proposal:premature-apply" },
    );
    expect(prematureApply.status).toBe(409);

    const confirmed = await post(
      app,
      `${base}/workflows/${encodeURIComponent(workflowId)}/advance`,
      { operationId: "proposal:confirm", action: "confirm-proposal" },
    );
    expect(confirmed.status).toBe(200);
    expect(
      ((await confirmed.json()) as { workflow: { state: string } }).workflow
        .state,
    ).toBe("COMPILATION");

    const applied = await post(
      app,
      `${base}/workflows/${encodeURIComponent(workflowId)}/proposals/${encodeURIComponent(generatedBody.proposal.id)}/apply`,
      { operationId: "proposal:apply" },
    );
    expect(applied.status).toBe(200);
    const appliedBody = (await applied.json()) as {
      workflow: { state: string };
      validation: { valid: boolean; validationHash: string };
    };
    expect(appliedBody.workflow.state).toBe("VALIDATION");
    expect(appliedBody.validation.valid).toBe(true);

    const validation = (await (
      await get(app, `/api/curriculum-editor/versions/${version.id}/validation`)
    ).json()) as { report: { validationHash: string } };
    const review = (await (
      await get(
        app,
        `/api/curriculum-editor/versions/${version.id}/change-review`,
      )
    ).json()) as { review: { changeReviewHash: string } };
    const preview = (await (
      await get(app, `/api/curriculum-editor/versions/${version.id}/preview`)
    ).json()) as { preview: { draftHash: string } };
    const published = await post(
      app,
      `/api/curriculum-editor/versions/${version.id}/publish`,
      {
        operationId: "publish:manual",
        validationHash: validation.report.validationHash,
        changeReviewHash: review.review.changeReviewHash,
        previewHash: preview.preview.draftHash,
      },
    );
    expect(published.status).toBe(200);
    expect(
      connection.sqlite
        .prepare("SELECT state FROM course_designer_workflows WHERE id = ?")
        .get(workflowId),
    ).toEqual({ state: "PUBLISHED" });
    expect(
      connection.sqlite
        .prepare(
          "SELECT event_type FROM course_designer_events WHERE workflow_id = ? ORDER BY id",
        )
        .all(workflowId),
    ).toEqual(
      [
        "created",
        "request-submitted",
        "discovery-completed",
        "diagnostic-skipped",
        "proposal-generated",
        "proposal-confirmed",
        "proposal-compiled",
        "published",
      ].map((event_type) => ({ event_type })),
    );
    expect(() =>
      connection.sqlite
        .prepare(
          "UPDATE course_draft_proposal_attribution SET model_id = 'changed' WHERE proposal_id = ?",
        )
        .run(generatedBody.proposal.id),
    ).toThrow("Course proposal attribution is immutable");
  });

  it("audits revision, rejection, and stale compilation without draft mutation", async () => {
    const proposal = {
      summary: "Add a foundations week",
      changes: [
        {
          kind: "add-week",
          stableId: "foundations-week",
          title: "Foundations",
        },
      ],
    };
    const { app, connection, mock, repository, version } =
      await createRuntime(proposal);
    const base = `/api/curriculum-editor/versions/${version.id}/designer`;
    const workflowId = await startWorkflow(app, base);
    const first = await post(
      app,
      `${base}/workflows/${encodeURIComponent(workflowId)}/generate`,
      { operationId: "proposal:first" },
    );
    const firstBody = (await first.json()) as { proposal: { id: string } };

    const revision = await post(
      app,
      `${base}/workflows/${encodeURIComponent(workflowId)}/advance`,
      {
        operationId: "proposal:revision",
        action: "request-revision",
        revisionRequest: "Use a more specific title.",
      },
    );
    expect(revision.status).toBe(200);
    expect(
      ((await revision.json()) as { workflow: { state: string } }).workflow
        .state,
    ).toBe("CURRICULUM_PROPOSAL");
    expect(
      connection.sqlite
        .prepare("SELECT status FROM course_draft_proposals WHERE id = ?")
        .get(firstBody.proposal.id),
    ).toEqual({ status: "rejected" });

    const second = await post(
      app,
      `${base}/workflows/${encodeURIComponent(workflowId)}/generate`,
      { operationId: "proposal:second" },
    );
    const secondBody = (await second.json()) as { proposal: { id: string } };
    expect(secondBody.proposal.id).not.toBe(firstBody.proposal.id);
    expect(mock.createInputs).toHaveLength(2);

    const rejected = await post(
      app,
      `${base}/workflows/${encodeURIComponent(workflowId)}/advance`,
      { operationId: "proposal:reject-second", action: "reject-proposal" },
    );
    expect(rejected.status).toBe(200);
    expect(
      connection.sqlite
        .prepare("SELECT status FROM course_draft_proposals WHERE id = ?")
        .get(secondBody.proposal.id),
    ).toEqual({ status: "rejected" });
    const third = await post(
      app,
      `${base}/workflows/${encodeURIComponent(workflowId)}/generate`,
      { operationId: "proposal:third" },
    );
    const thirdBody = (await third.json()) as { proposal: { id: string } };
    expect(mock.createInputs).toHaveLength(3);

    await repository.addWeek({
      versionId: version.id,
      stableId: "manual-week",
      title: "Manual change",
    });
    await post(
      app,
      `${base}/workflows/${encodeURIComponent(workflowId)}/advance`,
      { operationId: "proposal:confirm-third", action: "confirm-proposal" },
    );
    const stale = await post(
      app,
      `${base}/workflows/${encodeURIComponent(workflowId)}/proposals/${encodeURIComponent(thirdBody.proposal.id)}/apply`,
      { operationId: "proposal:apply-stale" },
    );
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ code: "stale_proposal" });
    expect(
      connection.sqlite
        .prepare(
          "SELECT stable_id FROM curriculum_weeks WHERE version_id = ? ORDER BY stable_id",
        )
        .all(version.id),
    ).toEqual([{ stable_id: "manual-week" }]);
  });

  it("persists FAILED recovery without silently falling back", async () => {
    const { app, connection, version } = await createRuntime({
      summary: "Invalid empty proposal",
      changes: [],
    });
    const base = `/api/curriculum-editor/versions/${version.id}/designer`;
    const workflowId = await startWorkflow(app, base);
    const failed = await post(
      app,
      `${base}/workflows/${encodeURIComponent(workflowId)}/generate`,
      { operationId: "proposal:invalid" },
    );
    expect(failed.status).toBe(409);
    expect(await failed.json()).toMatchObject({ code: "invalid_output" });
    expect(
      connection.sqlite
        .prepare(
          "SELECT state, recovery_state, failure_code FROM course_designer_workflows WHERE id = ?",
        )
        .get(workflowId),
    ).toEqual({
      state: "FAILED",
      recovery_state: "CURRICULUM_PROPOSAL",
      failure_code: "invalid_output",
    });

    const retry = await post(
      app,
      `${base}/workflows/${encodeURIComponent(workflowId)}/retry`,
      { operationId: "proposal:retry" },
    );
    expect(retry.status).toBe(200);
    expect(
      ((await retry.json()) as { workflow: { state: string } }).workflow.state,
    ).toBe("CURRICULUM_PROPOSAL");
  });

  it("applies targeted edits reproducibly from the same provider output", async () => {
    const targetedProposal = {
      summary: "Clarify the foundations week",
      changes: [
        {
          kind: "update-week",
          targetStableId: "foundations-week",
          title: "Foundations clarified",
          description: "A deterministic targeted revision.",
        },
      ],
    };
    const left = await createRuntime(targetedProposal);
    const right = await createRuntime(targetedProposal);
    for (const runtime of [left, right]) {
      await runtime.repository.addWeek({
        versionId: runtime.version.id,
        stableId: "foundations-week",
        title: "Foundations",
      });
    }

    const compile = async (
      runtime: Awaited<ReturnType<typeof createRuntime>>,
      prefix: string,
    ) => {
      const base = `/api/curriculum-editor/versions/${runtime.version.id}/designer`;
      const workflowId = await startWorkflow(runtime.app, base);
      const generated = await post(
        runtime.app,
        `${base}/workflows/${encodeURIComponent(workflowId)}/generate`,
        { operationId: `${prefix}:generate` },
      );
      const generatedBody = (await generated.json()) as {
        proposal: { id: string; proposal: unknown };
      };
      await post(
        runtime.app,
        `${base}/workflows/${encodeURIComponent(workflowId)}/advance`,
        { operationId: `${prefix}:confirm`, action: "confirm-proposal" },
      );
      const applied = await post(
        runtime.app,
        `${base}/workflows/${encodeURIComponent(workflowId)}/proposals/${encodeURIComponent(generatedBody.proposal.id)}/apply`,
        { operationId: `${prefix}:apply` },
      );
      expect(applied.status).toBe(200);
      return {
        proposal: generatedBody.proposal.proposal,
        body: (await applied.json()) as {
          validation: {
            draftHash: string;
            validationHash: string;
            valid: boolean;
            errors: number;
            warnings: number;
            diagnostics: unknown[];
          };
        },
      };
    };

    const leftResult = await compile(left, "left");
    const rightResult = await compile(right, "right");
    expect(leftResult.proposal).toEqual(rightResult.proposal);
    expect({
      valid: leftResult.body.validation.valid,
      errors: leftResult.body.validation.errors,
      warnings: leftResult.body.validation.warnings,
      diagnostics: leftResult.body.validation.diagnostics,
    }).toEqual({
      valid: rightResult.body.validation.valid,
      errors: rightResult.body.validation.errors,
      warnings: rightResult.body.validation.warnings,
      diagnostics: rightResult.body.validation.diagnostics,
    });
    expect(leftResult.body.validation.draftHash).toMatch(
      /^sha256:[a-f0-9]{64}$/u,
    );
    expect(rightResult.body.validation.validationHash).toMatch(
      /^sha256:[a-f0-9]{64}$/u,
    );
    for (const runtime of [left, right]) {
      expect(
        runtime.connection.sqlite
          .prepare(
            "SELECT title, description FROM curriculum_weeks WHERE version_id = ? AND stable_id = 'foundations-week'",
          )
          .get(runtime.version.id),
      ).toEqual({
        title: "Foundations clarified",
        description: "A deterministic targeted revision.",
      });
    }
  });

  it("fails explicitly while offline instead of switching to Mock", async () => {
    const { app, connection, mock, providerRuntime, version } =
      await createRuntime();
    const settings = await providerRuntime.settings();
    await providerRuntime.saveRoleProfiles(
      settings.roleProfiles.map((profile) =>
        profile.role === "course-designer"
          ? {
              role: profile.role,
              mode: "no-ai" as const,
              connectionId: null,
              modelId: null,
            }
          : {
              role: profile.role,
              mode: profile.mode,
              connectionId: profile.connectionId,
              modelId: profile.modelId,
            },
      ),
    );
    const base = `/api/curriculum-editor/versions/${version.id}/designer`;
    const workflowId = await startWorkflow(app, base);
    const failed = await post(
      app,
      `${base}/workflows/${encodeURIComponent(workflowId)}/generate`,
      { operationId: "offline:generate" },
    );
    expect(failed.status).toBe(409);
    expect(await failed.json()).toMatchObject({ code: "ai_disabled" });
    expect(mock.createInputs).toHaveLength(0);
    expect(
      connection.sqlite
        .prepare(
          "SELECT state, failure_code FROM course_designer_workflows WHERE id = ?",
        )
        .get(workflowId),
    ).toEqual({ state: "FAILED", failure_code: "ai_disabled" });
  });
});
