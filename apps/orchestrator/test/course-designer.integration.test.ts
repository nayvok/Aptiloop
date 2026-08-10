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
import { ProviderRuntime } from "../src/provider-runtime.js";

const timestamp = "2026-08-10T00:00:00.000Z";
const connections: DatabaseConnection[] = [];

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

async function createRuntime() {
  const connection = openDatabase(":memory:");
  migrateDatabase(connection);
  connections.push(connection);
  const proposal = {
    summary: "Add a foundations week",
    changes: [
      {
        kind: "add-week",
        stableId: "foundations-week",
        title: "Foundations",
        description: "Build the prerequisite mental model.",
      },
    ],
  };
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
  registerCourseDesignerRoutes(app, { connection, providerRuntime });
  return { app, connection, mock, repository, version };
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

describe("Course Designer", () => {
  it("keeps generated changes reviewable until explicit apply", async () => {
    const { app, connection, mock, version } = await createRuntime();
    const base = `/api/curriculum-editor/versions/${version.id}/designer`;

    const generated = await post(app, `${base}/generate`, {
      operationId: "generate-foundations",
      prompt: "Add a foundations week",
    });
    expect(generated.status).toBe(200);
    const generatedBody = (await generated.json()) as {
      proposal: {
        id: string;
        status: string;
        proposal: { changes: unknown[] };
      };
    };
    expect(generatedBody.proposal).toMatchObject({
      status: "proposed",
      proposal: {
        changes: [{ kind: "add-week", stableId: "foundations-week" }],
      },
    });
    expect(
      connection.sqlite
        .prepare(
          "SELECT COUNT(*) AS count FROM curriculum_weeks WHERE version_id = ?",
        )
        .get(version.id),
    ).toEqual({ count: 0 });

    const retried = await post(app, `${base}/generate`, {
      operationId: "generate-foundations",
      prompt: "Add a foundations week",
    });
    expect(retried.status).toBe(200);
    expect(
      ((await retried.json()) as { proposal: { id: string } }).proposal.id,
    ).toBe(generatedBody.proposal.id);
    expect(mock.createInputs).toHaveLength(1);

    const applied = await post(
      app,
      `${base}/proposals/${encodeURIComponent(generatedBody.proposal.id)}/apply`,
      { operationId: "apply-foundations" },
    );
    expect(applied.status).toBe(200);
    expect(
      connection.sqlite
        .prepare(
          "SELECT stable_id, title FROM curriculum_weeks WHERE version_id = ?",
        )
        .all(version.id),
    ).toEqual([{ stable_id: "foundations-week", title: "Foundations" }]);
    expect(
      connection.sqlite
        .prepare("SELECT status FROM curriculum_versions WHERE id = ?")
        .get(version.id),
    ).toEqual({ status: "draft" });

    const duplicateApply = await post(
      app,
      `${base}/proposals/${encodeURIComponent(generatedBody.proposal.id)}/apply`,
      { operationId: "apply-foundations-again" },
    );
    expect(duplicateApply.status).toBe(409);
  });

  it("rejects stale proposals without partially applying them", async () => {
    const { app, connection, repository, version } = await createRuntime();
    const base = `/api/curriculum-editor/versions/${version.id}/designer`;
    const generated = await post(app, `${base}/generate`, {
      operationId: "generate-stale",
      prompt: "Add a foundations week",
    });
    const proposalId = (
      (await generated.json()) as { proposal: { id: string } }
    ).proposal.id;

    await repository.addWeek({
      versionId: version.id,
      stableId: "manual-week",
      title: "Manual change",
    });
    const applied = await post(
      app,
      `${base}/proposals/${encodeURIComponent(proposalId)}/apply`,
      { operationId: "apply-stale" },
    );

    expect(applied.status).toBe(409);
    expect(await applied.json()).toMatchObject({ code: "stale_proposal" });
    expect(
      connection.sqlite
        .prepare(
          "SELECT stable_id FROM curriculum_weeks WHERE version_id = ? ORDER BY stable_id",
        )
        .all(version.id),
    ).toEqual([{ stable_id: "manual-week" }]);
    expect(
      connection.sqlite
        .prepare("SELECT status FROM course_draft_proposals WHERE id = ?")
        .get(proposalId),
    ).toEqual({ status: "proposed" });
  });
});
