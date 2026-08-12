import { createHash } from "node:crypto";

import { type AgentProvider } from "@aptiloop/agent-core";
import {
  CurriculumAuthoringRepository,
  migrateDatabase,
  openDatabase,
  type DatabaseConnection,
} from "@aptiloop/database";
import type {
  AgentEvent,
  AgentModel,
  AgentSession,
  CreateAgentSessionInput,
  ProviderId,
  ProviderStatus,
  StreamAgentMessageInput,
} from "@aptiloop/shared";
import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";

import {
  createCourseDesignerTools,
  registerCourseDesignerRoutes,
} from "../src/course-designer.js";
import { authoringDraftHash } from "../src/authoring-draft-hash.js";
import { registerCurriculumEditorRoutes } from "../src/curriculum-editor.js";
import { ProviderRuntime } from "../src/provider-runtime.js";

const timestamp = "2026-08-10T00:00:00.000Z";
const connections: DatabaseConnection[] = [];

const sha256 = (value: string) =>
  `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;

function collectKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap((item) => collectKeys(item));
  if (!value || typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>).flatMap(
    ([key, nested]) => [key, ...collectKeys(nested)],
  );
}

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
  readonly cancelCalls: string[] = [];
  readonly #proposal: string;
  createSessionGate?: Promise<void>;

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
    await this.createSessionGate;
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

  async cancelSession(sessionId: string): Promise<void> {
    this.cancelCalls.push(sessionId);
  }
}

async function createRuntime(
  proposal: unknown = completeProposal,
  options?: { beforeProposalCommit?: () => Promise<void> | void },
) {
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
      primaryLocale: "en-US",
    },
    title: "Draft revision",
  });
  const app = new Hono();
  registerCurriculumEditorRoutes(app, { connection });
  registerCourseDesignerRoutes(app, {
    connection,
    providerRuntime,
    ...options,
  });
  return { app, connection, mock, providerRuntime, repository, version };
}

function post(
  app: Hono,
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<Response> {
  return Promise.resolve(
    app.request(`http://127.0.0.1:8787${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
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
  it("cancels generation aborted during provider session creation without persisting a proposal", async () => {
    const runtime = await createRuntime();
    let releaseCreate!: () => void;
    runtime.mock.createSessionGate = new Promise<void>((resolve) => {
      releaseCreate = resolve;
    });
    const base = `/api/curriculum-editor/versions/${runtime.version.id}/designer`;
    const workflowId = await startWorkflow(runtime.app, base);
    const controller = new AbortController();
    const responsePromise = post(
      runtime.app,
      `${base}/workflows/${encodeURIComponent(workflowId)}/generate`,
      { operationId: "proposal:cancel-create" },
      controller.signal,
    );
    await expect.poll(() => runtime.mock.createInputs.length).toBe(1);
    controller.abort();
    releaseCreate();
    const response = await responsePromise;

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "cancelled" });
    expect(runtime.mock.streamInputs).toHaveLength(0);
    expect(runtime.mock.cancelCalls).toEqual(["session:1"]);
    expect(
      runtime.connection.sqlite
        .prepare(
          `SELECT status, failure_code AS failureCode
           FROM provider_turn_provenance WHERE role = 'course-designer'
           ORDER BY created_at DESC LIMIT 1`,
        )
        .get(),
    ).toEqual({ status: "cancelled", failureCode: "cancelled" });
    expect(
      runtime.connection.sqlite
        .prepare("SELECT count(*) AS count FROM course_draft_proposals")
        .get(),
    ).toEqual({ count: 0 });
    expect(
      runtime.connection.sqlite
        .prepare(
          "SELECT state, active_proposal_id AS activeProposalId FROM course_designer_workflows WHERE id = ?",
        )
        .get(workflowId),
    ).toEqual({ state: "CURRICULUM_PROPOSAL", activeProposalId: null });
  });

  it("cancels generation after provider completion without attribution or workflow transition", async () => {
    let releaseCommit!: () => void;
    const commitGate = new Promise<void>((resolve) => {
      releaseCommit = resolve;
    });
    let markProviderCompleted!: () => void;
    const providerCompleted = new Promise<void>((resolve) => {
      markProviderCompleted = resolve;
    });
    const runtime = await createRuntime(completeProposal, {
      beforeProposalCommit: async () => {
        markProviderCompleted();
        await commitGate;
      },
    });
    const base = `/api/curriculum-editor/versions/${runtime.version.id}/designer`;
    const workflowId = await startWorkflow(runtime.app, base);
    const controller = new AbortController();
    const responsePromise = post(
      runtime.app,
      `${base}/workflows/${encodeURIComponent(workflowId)}/generate`,
      { operationId: "proposal:cancel-before-commit" },
      controller.signal,
    );
    await providerCompleted;
    controller.abort();
    releaseCommit();
    const response = await responsePromise;

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "cancelled" });
    expect(runtime.mock.cancelCalls).toEqual(["session:1"]);
    expect(
      runtime.connection.sqlite
        .prepare(
          `SELECT status, failure_code AS failureCode
           FROM provider_turn_provenance WHERE role = 'course-designer'
           ORDER BY created_at DESC LIMIT 1`,
        )
        .get(),
    ).toEqual({ status: "cancelled", failureCode: "cancelled" });
    expect(
      runtime.connection.sqlite
        .prepare("SELECT count(*) AS count FROM course_draft_proposals")
        .get(),
    ).toEqual({ count: 0 });
    expect(
      runtime.connection.sqlite
        .prepare(
          "SELECT count(*) AS count FROM course_draft_proposal_attribution",
        )
        .get(),
    ).toEqual({ count: 0 });
    expect(
      runtime.connection.sqlite
        .prepare(
          "SELECT state, active_proposal_id AS activeProposalId FROM course_designer_workflows WHERE id = ?",
        )
        .get(workflowId),
    ).toEqual({ state: "CURRICULUM_PROPOSAL", activeProposalId: null });
  });

  it("restores only the exact pending disclosure for its draft workflow", async () => {
    const { app, connection, providerRuntime, repository, version } =
      await createRuntime();
    connection.sqlite
      .prepare(
        "UPDATE provider_hub_connections SET external = 1 WHERE connection_id = 'conn:mock'",
      )
      .run();
    const base = `/api/curriculum-editor/versions/${version.id}/designer`;
    const workflowId = await startWorkflow(app, base);
    const disclosurePath = `${base}/workflows/${encodeURIComponent(workflowId)}/disclosures`;

    const prepared = await post(app, disclosurePath, {
      operationId: "proposal:resume",
    });
    expect(prepared.status).toBe(200);
    const preparedBody = (await prepared.json()) as {
      required: boolean;
      disclosure: {
        operationId: string;
        scope: { entityIds: Record<string, string> };
      };
    };
    expect(preparedBody).toMatchObject({
      required: true,
      disclosure: {
        scope: {
          entityIds: {
            "course-revision": version.id,
            "course-designer-workflow": workflowId,
            "course-designer-authoring-operation": "proposal:resume",
          },
        },
      },
    });

    const restored = await get(app, disclosurePath);
    expect(restored.status).toBe(200);
    expect(await restored.json()).toMatchObject({
      pendingDisclosure: {
        operationId: "proposal:resume",
        workflowId,
        versionId: version.id,
        disclosure: {
          operationId: preparedBody.disclosure.operationId,
          status: "pending",
        },
      },
    });

    const duplicatePreparation = await post(app, disclosurePath, {
      operationId: "proposal:duplicate",
    });
    expect(duplicatePreparation.status).toBe(200);
    expect(
      (
        (await duplicatePreparation.json()) as {
          disclosure: { operationId: string };
        }
      ).disclosure.operationId,
    ).toBe(preparedBody.disclosure.operationId);
    expect(
      connection.sqlite
        .prepare(
          "SELECT COUNT(*) AS count FROM ai_disclosure_operations WHERE role = 'course-designer'",
        )
        .get(),
    ).toEqual({ count: 1 });

    const otherVersion = await repository.cloneRevision(version.id);
    const otherBase = `/api/curriculum-editor/versions/${otherVersion.id}/designer`;
    const otherWorkflowId = await startWorkflow(app, otherBase);
    const otherDisclosure = await get(
      app,
      `${otherBase}/workflows/${encodeURIComponent(otherWorkflowId)}/disclosures`,
    );
    expect(otherDisclosure.status).toBe(200);
    expect(await otherDisclosure.json()).toEqual({ pendingDisclosure: null });

    const crossVersion = await get(
      app,
      `${otherBase}/workflows/${encodeURIComponent(workflowId)}/disclosures`,
    );
    expect(crossVersion.status).toBe(404);
    expect(await crossVersion.json()).toMatchObject({
      code: "workflow_not_found",
    });
    const unknown = await get(
      app,
      `${base}/workflows/${encodeURIComponent("course-designer:unknown")}/disclosures`,
    );
    expect(unknown.status).toBe(404);

    providerRuntime.cancelDisclosure(preparedBody.disclosure.operationId);
    const cancelled = await get(app, disclosurePath);
    expect(cancelled.status).toBe(200);
    expect(await cancelled.json()).toEqual({ pendingDisclosure: null });

    const stalePreparation = await post(app, disclosurePath, {
      operationId: "proposal:stale",
    });
    const staleOperationId = (
      (await stalePreparation.json()) as {
        disclosure: { operationId: string };
      }
    ).disclosure.operationId;
    connection.sqlite
      .prepare(
        `INSERT INTO ai_disclosure_events
           (operation_id, sequence, status, occurred_at)
         VALUES (?, 1, 'expired', ?)`,
      )
      .run(staleOperationId, new Date().toISOString());
    const stale = await get(app, disclosurePath);
    expect(stale.status).toBe(200);
    expect(await stale.json()).toEqual({ pendingDisclosure: null });
  });

  it("binds disclosure and dispatch to one provider-safe authoring projection", async () => {
    const { app, connection, mock, providerRuntime, repository, version } =
      await createRuntime();
    connection.sqlite
      .prepare(
        "UPDATE provider_hub_connections SET external = 1 WHERE connection_id = 'conn:mock'",
      )
      .run();
    const week = await repository.addWeek({
      versionId: version.id,
      stableId: "provider-safe-week",
      title: "Legitimate provider-visible week",
    });
    const day = await repository.addDay({
      versionId: version.id,
      weekId: week.id,
      stableId: "provider-safe-day",
      title: "Legitimate provider-visible day",
      goal: "Keep legitimate draft structure available for proposals",
      estimatedMinutes: 15,
      depthLevel: "foundation",
    });
    await repository.addUnit({
      versionId: version.id,
      dayId: day.id,
      stableId: "provider-safe-unit",
      type: "recall",
      title: "Legitimate provider-visible activity",
      questions: [
        {
          id: "protected-question",
          kind: "multiple-choice",
          prompt: "Legitimate provider-visible question prompt",
          options: [
            { id: "option-a", label: "Visible option A" },
            { id: "option-b", label: "Visible option B" },
          ],
          correctOptionIds: ["PROTECTED_CORRECT_OPTION_MARKER"],
          referenceAnswer: "PROTECTED_QUESTION_ANSWER_MARKER",
          evaluationPoints: ["PROTECTED_EVALUATION_POINT_MARKER"],
          commonMistakes: ["PROTECTED_COMMON_MISTAKE_MARKER"],
          nested: {
            reference_answer: "PROTECTED_RECURSIVE_REFERENCE_MARKER",
            CORRECT_ANSWER: "PROTECTED_RECURSIVE_CORRECT_MARKER",
            rubric: "PROTECTED_RECURSIVE_RUBRIC_MARKER",
          },
          visibleRationale: "Legitimate provider-visible question context",
        },
      ],
      misconceptions: ["PROTECTED_UNIT_MISCONCEPTION_MARKER"],
      referenceAnswer: "PROTECTED_UNIT_ANSWER_MARKER",
      completionCriteria: [{ type: "attempts", minimum: 1 }],
      payload: {
        type: "recall",
        prompt: "Legitimate provider-visible recall prompt",
        nested: {
          expectedAnswer: "PROTECTED_RECURSIVE_EXPECTED_MARKER",
          safeContext: "Legitimate recursively nested provider context",
        },
      },
    });

    const base = `/api/curriculum-editor/versions/${version.id}/designer`;
    const workflowId = await startWorkflow(app, base);
    const disclosurePath = `${base}/workflows/${encodeURIComponent(workflowId)}/disclosures`;
    const prepared = await post(app, disclosurePath, {
      operationId: "proposal:provider-safe",
    });
    expect(prepared.status).toBe(200);
    const preparedBody = (await prepared.json()) as {
      required: true;
      disclosure: {
        operationId: string;
        scope: {
          byteCount: number;
          payloadSha256: string;
          exclusions: string[];
        };
      };
    };
    providerRuntime.approveDisclosure(preparedBody.disclosure.operationId);
    const generated = await post(
      app,
      `${base}/workflows/${encodeURIComponent(workflowId)}/generate`,
      {
        operationId: "proposal:provider-safe",
        disclosureOperationId: preparedBody.disclosure.operationId,
      },
    );
    expect(generated.status).toBe(200);
    expect(mock.streamInputs).toHaveLength(1);
    const transmitted = mock.streamInputs[0]?.message;
    expect(transmitted).toBeDefined();
    if (!transmitted) throw new Error("Provider payload was not captured");
    expect(Buffer.byteLength(transmitted, "utf8")).toBe(
      preparedBody.disclosure.scope.byteCount,
    );
    expect(sha256(transmitted)).toBe(
      preparedBody.disclosure.scope.payloadSha256,
    );
    expect(preparedBody.disclosure.scope.exclusions).toContain(
      "No learner evidence, credentials, or protected answers",
    );

    const payload = JSON.parse(transmitted) as {
      request: typeof workflowRequest;
      draft: {
        primaryLocale: string;
        version: { id: string };
        weeks: Array<{
          stableId: string;
          days: Array<{
            stableId: string;
            units: Array<{
              stableId: string;
              questions: Array<Record<string, unknown>>;
              payload: Record<string, unknown>;
            }>;
          }>;
        }>;
      };
    };
    expect(payload.request).toEqual(workflowRequest);
    expect(payload.draft.primaryLocale).toBe("en-US");
    expect(payload.draft.version.id).toBe(version.id);
    expect(payload.draft.weeks[0]?.stableId).toBe("provider-safe-week");
    const transmittedUnit = payload.draft.weeks[0]?.days[0]?.units[0];
    expect(transmittedUnit?.stableId).toBe("provider-safe-unit");
    expect(transmittedUnit?.questions[0]).toMatchObject({
      prompt: "Legitimate provider-visible question prompt",
      options: [{ label: "Visible option A" }, { label: "Visible option B" }],
      visibleRationale: "Legitimate provider-visible question context",
    });
    expect(transmittedUnit?.payload).toMatchObject({
      type: "recall",
      prompt: "Legitimate provider-visible recall prompt",
      nested: { safeContext: "Legitimate recursively nested provider context" },
    });

    const forbiddenKeys = new Set([
      "commonMistakes",
      "correctOptionIds",
      "evaluationPoints",
      "misconceptions",
      "referenceAnswer",
      "reference_answer",
      "CORRECT_ANSWER",
      "rubric",
      "expectedAnswer",
    ]);
    expect(
      collectKeys(payload).filter((key) => forbiddenKeys.has(key)),
    ).toEqual([]);
    for (const marker of [
      "PROTECTED_CORRECT_OPTION_MARKER",
      "PROTECTED_QUESTION_ANSWER_MARKER",
      "PROTECTED_EVALUATION_POINT_MARKER",
      "PROTECTED_COMMON_MISTAKE_MARKER",
      "PROTECTED_RECURSIVE_REFERENCE_MARKER",
      "PROTECTED_RECURSIVE_CORRECT_MARKER",
      "PROTECTED_RECURSIVE_RUBRIC_MARKER",
      "PROTECTED_UNIT_MISCONCEPTION_MARKER",
      "PROTECTED_UNIT_ANSWER_MARKER",
      "PROTECTED_RECURSIVE_EXPECTED_MARKER",
    ]) {
      expect(transmitted).not.toContain(marker);
    }

    const graph = await repository.getVersionGraph(version.id);
    const tools = createCourseDesignerTools(connection)("course-designer", {
      role: "course-designer",
      modelId: "mock-designer",
      systemPrompt: "Course Designer test prompt",
      metadata: {
        versionId: version.id,
        workflowId,
        draftHash: authoringDraftHash(graph),
        prompt: workflowRequest.goal,
        authoringOperationId: "proposal:provider-safe",
        providerOperationId: "provider-turn:provider-safe",
        approvedSources: workflowRequest.sources,
      },
    });
    const readDraft = tools.find(
      (tool) => tool.name === "course.readDraftSlice",
    );
    if (!readDraft) throw new Error("Course draft read tool was not installed");
    for (const section of ["all", "activities"] as const) {
      const result = await readDraft.execute("tool-call:read", { section });
      const text = result.content
        .filter((item) => item.type === "text")
        .map((item) => item.text)
        .join("");
      expect(text).toContain("Legitimate provider-visible activity");
      expect(text).toContain("Legitimate provider-visible question prompt");
      expect(text).toContain("Legitimate recursively nested provider context");
      for (const key of forbiddenKeys) expect(text).not.toContain(key);
      expect(text).not.toContain("PROTECTED_");
    }
  });

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
