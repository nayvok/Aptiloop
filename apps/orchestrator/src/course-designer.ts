import { randomUUID } from "node:crypto";

import {
  AgentProviderError,
  ProviderHubError,
  type PiAgentProviderOptions,
} from "@dlh/agent-core";
import {
  CurriculumAuthoringRepository,
  type CurriculumVersionGraph,
  type DatabaseConnection,
} from "@dlh/database";
import {
  CourseDraftProposalSchema,
  type CourseDraftProposal,
} from "@dlh/shared";
import type { Context, Hono } from "hono";
import { Type } from "typebox";
import { z } from "zod";

import { authoringDraftHash } from "./curriculum-editor.js";
import {
  type ProviderDispatch,
  type ProviderRuntime,
  providerFailureCode,
} from "./provider-runtime.js";

const idSchema = z.string().trim().min(1).max(200);

type ToolsForRole = NonNullable<PiAgentProviderOptions["toolsForRole"]>;

interface ProposalRow {
  id: string;
  version_id: string;
  base_draft_hash: string;
  prompt: string;
  proposal_json: string;
  authoring_operation_id: string;
  status: "proposed" | "applied" | "rejected";
  provider_operation_id: string;
  created_at: number;
  reviewed_at: number | null;
}

const toolMetadataSchema = z
  .object({
    versionId: idSchema,
    draftHash: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
    prompt: z.string().trim().min(1).max(50_000),
    authoringOperationId: idSchema,
    providerOperationId: idSchema,
  })
  .passthrough();

const proposalToolParameters = Type.Object(
  {
    proposal: Type.Object(
      {
        summary: Type.String({ minLength: 1, maxLength: 10_000 }),
        changes: Type.Array(Type.Unknown(), { minItems: 1, maxItems: 50 }),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

const readDraftToolParameters = Type.Object(
  {
    section: Type.Union(
      [
        Type.Literal("all"),
        Type.Literal("outline"),
        Type.Literal("activities"),
      ],
      { default: "all" },
    ),
  },
  { additionalProperties: false },
);
const readDraftToolInputSchema = z
  .object({ section: z.enum(["all", "outline", "activities"]) })
  .strict();
const proposalToolInputSchema = z
  .object({ proposal: CourseDraftProposalSchema })
  .strict();

function proposalDto(row: ProposalRow) {
  return {
    id: row.id,
    versionId: row.version_id,
    baseDraftHash: row.base_draft_hash,
    prompt: row.prompt,
    proposal: CourseDraftProposalSchema.parse(JSON.parse(row.proposal_json)),
    status: row.status,
    authoringOperationId: row.authoring_operation_id,
    providerOperationId: row.provider_operation_id,
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at,
  };
}

function insertProposal(
  connection: DatabaseConnection,
  input: {
    versionId: string;
    draftHash: string;
    prompt: string;
    authoringOperationId: string;
    providerOperationId: string;
    proposal: CourseDraftProposal;
  },
): ProposalRow {
  const existing = connection.sqlite
    .prepare(
      `SELECT * FROM course_draft_proposals
       WHERE version_id = ? AND authoring_operation_id = ?`,
    )
    .get(input.versionId, input.authoringOperationId) as
    ProposalRow | undefined;
  if (existing) return existing;

  const row: ProposalRow = {
    id: `course-proposal:${randomUUID()}`,
    version_id: input.versionId,
    base_draft_hash: input.draftHash,
    prompt: input.prompt,
    authoring_operation_id: input.authoringOperationId,
    proposal_json: JSON.stringify(input.proposal),
    status: "proposed",
    provider_operation_id: input.providerOperationId,
    created_at: Date.now(),
    reviewed_at: null,
  };
  connection.sqlite
    .prepare(
      `INSERT INTO course_draft_proposals (
         id, version_id, base_draft_hash, prompt, proposal_json,
         authoring_operation_id, status, provider_operation_id, created_at,
         reviewed_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    )
    .run(
      row.id,
      row.version_id,
      row.base_draft_hash,
      row.prompt,
      row.proposal_json,
      row.authoring_operation_id,
      row.status,
      row.provider_operation_id,
      row.created_at,
    );
  return row;
}

function graphSlice(graph: CurriculumVersionGraph, section: string): unknown {
  if (section === "outline") {
    return {
      version: graph.version,
      weeks: graph.weeks.map((week) => ({
        id: week.id,
        stableId: week.stableId,
        title: week.title,
        description: week.description,
        days: week.days.map((day) => ({
          id: day.id,
          stableId: day.stableId,
          title: day.title,
          goal: day.goal,
          topics: day.topics,
        })),
      })),
    };
  }
  if (section === "activities") {
    return graph.weeks.flatMap((week) =>
      week.days.map((day) => ({
        dayStableId: day.stableId,
        units: day.units,
      })),
    );
  }
  return graph;
}

export function createCourseDesignerTools(
  connection: DatabaseConnection,
): ToolsForRole {
  return (role, input) => {
    if (role !== "course-designer") return [];
    const metadata = toolMetadataSchema.parse(input.metadata ?? {});
    return [
      {
        name: "course.readDraftSlice",
        label: "Read Course draft",
        description:
          "Read the current immutable input slice of the selected Course draft.",
        parameters: readDraftToolParameters,
        executionMode: "sequential",
        execute: async (_toolCallId, parameters, signal) => {
          signal?.throwIfAborted();
          const toolInput = readDraftToolInputSchema.parse(parameters);
          const graph = await new CurriculumAuthoringRepository(
            connection,
          ).getVersionGraph(metadata.versionId);
          if (authoringDraftHash(graph) !== metadata.draftHash) {
            throw new Error("Course draft changed during the provider turn");
          }
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(graphSlice(graph, toolInput.section)),
              },
            ],
            details: {
              versionId: metadata.versionId,
              section: toolInput.section,
            },
          };
        },
      },
      {
        name: "course.proposeDraftPatch",
        label: "Propose Course draft patch",
        description:
          "Submit a validated, reviewable proposal. This tool never applies or publishes it.",
        parameters: proposalToolParameters,
        executionMode: "sequential",
        execute: async (_toolCallId, parameters, signal) => {
          signal?.throwIfAborted();
          const proposal = proposalToolInputSchema.parse(parameters).proposal;
          const row = insertProposal(connection, { ...metadata, proposal });
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  proposalId: row.id,
                  status: row.status,
                  applied: false,
                  published: false,
                }),
              },
            ],
            details: { proposalId: row.id },
            terminate: true,
          };
        },
      },
    ];
  };
}

export interface CourseDesignerState {
  connection: DatabaseConnection;
  providerRuntime: ProviderRuntime;
}

const generationSchema = z
  .object({
    operationId: idSchema,
    prompt: z.string().trim().min(1).max(50_000),
    disclosureOperationId: idSchema.optional(),
  })
  .strict();
const disclosureSchema = generationSchema
  .omit({ disclosureOperationId: true })
  .strict();
const reviewSchema = z.object({ operationId: idSchema }).strict();

class CourseDesignerError extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function readJson<T>(context: Context, schema: z.ZodType<T>): Promise<T> {
  const parsed = schema.safeParse(await context.req.json());
  if (!parsed.success) {
    throw new CourseDesignerError(
      400,
      "invalid_request",
      "Request body is invalid",
    );
  }
  return parsed.data;
}

function versionId(context: Context): string {
  const parsed = idSchema.safeParse(context.req.param("versionId"));
  if (!parsed.success) {
    throw new CourseDesignerError(
      400,
      "invalid_request",
      "Version ID is invalid",
    );
  }
  return parsed.data;
}

function designerPayload(
  graph: CurriculumVersionGraph,
  prompt: string,
): string {
  return JSON.stringify({
    task: prompt,
    constraints: {
      apply: false,
      publish: false,
      allowedChangeKinds: ["add-week", "add-day", "add-unit"],
    },
    draft: graph,
  });
}

function assertDraft(graph: CurriculumVersionGraph): void {
  if (graph.version.status !== "draft") {
    throw new CourseDesignerError(
      409,
      "immutable_version",
      "Course Designer can only propose changes to a draft revision",
    );
  }
}

async function route<T>(
  context: Context,
  work: () => Promise<T>,
): Promise<Response> {
  try {
    return context.json(await work());
  } catch (error) {
    if (error instanceof CourseDesignerError) {
      return context.json(
        { error: error.message, code: error.code },
        error.status,
      );
    }
    throw error;
  }
}

async function runDesignerTurn(
  state: CourseDesignerState,
  dispatch: ProviderDispatch,
  graph: CurriculumVersionGraph,
  prompt: string,
  authoringOperationId: string,
  signal: AbortSignal,
): Promise<ProposalRow> {
  let providerSessionId: string | null = null;
  let completedContent: string | null = null;
  try {
    const session = await dispatch.provider.createSession({
      role: "course-designer",
      modelId: dispatch.modelId,
      systemPrompt:
        "You are Aptiloop Course Designer. Inspect only the supplied draft. Use course.readDraftSlice when needed, then call course.proposeDraftPatch with a finite typed proposal. Never apply or publish changes. Stable IDs identify meaning and must not be reused.",
      metadata: {
        versionId: graph.version.id,
        draftHash: authoringDraftHash(graph),
        prompt,
        authoringOperationId,
        providerOperationId: dispatch.operationId,
      },
    });
    providerSessionId = session.id;
    for await (const event of state.providerRuntime.stream(
      dispatch,
      providerSessionId,
      signal,
      "json",
    )) {
      if (event.type === "message.completed") completedContent = event.content;
    }

    let proposal = state.connection.sqlite
      .prepare(
        `SELECT * FROM course_draft_proposals
         WHERE version_id = ? AND provider_operation_id = ?`,
      )
      .get(graph.version.id, dispatch.operationId) as ProposalRow | undefined;
    if (!proposal && completedContent) {
      const parsed = CourseDraftProposalSchema.safeParse(
        JSON.parse(completedContent) as unknown,
      );
      if (parsed.success) {
        proposal = insertProposal(state.connection, {
          versionId: graph.version.id,
          draftHash: authoringDraftHash(graph),
          authoringOperationId,
          prompt,
          providerOperationId: dispatch.operationId,
          proposal: parsed.data,
        });
      }
    }
    if (!proposal) {
      throw new ProviderHubError(
        "invalid_output",
        "Course Designer completed without a valid draft proposal",
      );
    }
    state.providerRuntime.finishDispatch(dispatch, "completed");
    return proposal;
  } catch (error) {
    state.providerRuntime.finishDispatch(
      dispatch,
      signal.aborted ? "cancelled" : "failed",
      providerFailureCode(error),
    );
    if (providerSessionId && signal.aborted) {
      await dispatch.provider
        .cancelSession(providerSessionId)
        .catch(() => undefined);
    }
    if (error instanceof SyntaxError) {
      throw new AgentProviderError(
        "invalid_output",
        "Course Designer returned invalid JSON",
        false,
        { cause: error },
      );
    }
    throw error;
  }
}

async function applyChange(
  repository: CurriculumAuthoringRepository,
  versionIdValue: string,
  change: CourseDraftProposal["changes"][number],
): Promise<void> {
  if (change.kind === "add-week") {
    await repository.addWeek({
      versionId: versionIdValue,
      stableId: change.stableId,
      title: change.title,
      ...(change.description !== undefined
        ? { description: change.description }
        : {}),
      ...(change.orderIndex !== undefined
        ? { orderIndex: change.orderIndex }
        : {}),
    });
    return;
  }

  const graph = await repository.getVersionGraph(versionIdValue);
  if (change.kind === "add-day") {
    const parent = graph.weeks.find(
      (week) => week.stableId === change.parentStableId,
    );
    if (!parent) {
      throw new CourseDesignerError(
        409,
        "missing_parent",
        `Week ${change.parentStableId} does not exist`,
      );
    }
    await repository.addDay({
      versionId: versionIdValue,
      weekId: parent.id,
      stableId: change.stableId,
      title: change.title,
      goal: change.goal,
      estimatedMinutes: change.estimatedMinutes,
      depthLevel: change.depthLevel,
      ...(change.description !== undefined
        ? { description: change.description }
        : {}),
      ...(change.prerequisites !== undefined
        ? { prerequisites: change.prerequisites }
        : {}),
      ...(change.expectedOutcomes !== undefined
        ? { expectedOutcomes: change.expectedOutcomes }
        : {}),
      ...(change.outOfScope !== undefined
        ? { outOfScope: change.outOfScope }
        : {}),
      ...(change.topics !== undefined ? { topics: change.topics } : {}),
      ...(change.orderIndex !== undefined
        ? { orderIndex: change.orderIndex }
        : {}),
    });
    return;
  }

  const parent = graph.weeks
    .flatMap((week) => week.days)
    .find((day) => day.stableId === change.parentStableId);
  if (!parent) {
    throw new CourseDesignerError(
      409,
      "missing_parent",
      `Day ${change.parentStableId} does not exist`,
    );
  }
  await repository.addUnit({
    versionId: versionIdValue,
    dayId: parent.id,
    stableId: change.stableId,
    type: change.type,
    title: change.title,
    completionCriteria: change.completionCriteria,
    payload: change.payload as Record<string, unknown>,
    ...(change.description !== undefined
      ? { description: change.description }
      : {}),
    ...(change.estimatedMinutes !== undefined
      ? { estimatedMinutes: change.estimatedMinutes }
      : {}),
    ...(change.objectives !== undefined
      ? { objectives: change.objectives }
      : {}),
    ...(change.checklist !== undefined ? { checklist: change.checklist } : {}),
    ...(change.sources !== undefined ? { sources: change.sources } : {}),
    ...(change.questions !== undefined ? { questions: change.questions } : {}),
    ...(change.misconceptions !== undefined
      ? { misconceptions: change.misconceptions }
      : {}),
    ...(change.referenceAnswer !== undefined
      ? { referenceAnswer: change.referenceAnswer }
      : {}),
    ...(change.unlockRules !== undefined
      ? { unlockRules: change.unlockRules }
      : {}),
    ...(change.optional !== undefined ? { optional: change.optional } : {}),
    ...(change.depthLevel !== undefined
      ? { depthLevel: change.depthLevel }
      : {}),
    ...(change.orderIndex !== undefined
      ? { orderIndex: change.orderIndex }
      : {}),
  });
}

export function registerCourseDesignerRoutes(
  app: Hono,
  state: CourseDesignerState,
): void {
  app.get(
    "/api/curriculum-editor/versions/:versionId/designer/proposals",
    (context) =>
      route(context, async () => {
        const rows = state.connection.sqlite
          .prepare(
            `SELECT * FROM course_draft_proposals
           WHERE version_id = ? ORDER BY created_at DESC, id`,
          )
          .all(versionId(context)) as unknown as ProposalRow[];
        return { proposals: rows.map(proposalDto) };
      }),
  );

  app.post(
    "/api/curriculum-editor/versions/:versionId/designer/disclosures",
    (context) =>
      route(context, async () => {
        const input = await readJson(context, disclosureSchema);
        const id = versionId(context);
        const graph = await new CurriculumAuthoringRepository(
          state.connection,
        ).getVersionGraph(id);
        assertDraft(graph);
        return state.providerRuntime.prepareDisclosure({
          role: "course-designer",
          payload: designerPayload(graph, input.prompt),
          payloadCategories: ["course-content", "learner-message"],
          entityIds: { "course-revision": id },
          destinationPurpose: "optional Course draft authoring assistance",
        });
      }),
  );

  app.post(
    "/api/curriculum-editor/versions/:versionId/designer/generate",
    (context) =>
      route(context, async () => {
        const input = await readJson(context, generationSchema);
        const id = versionId(context);
        const repository = new CurriculumAuthoringRepository(state.connection);
        const graph = await repository.getVersionGraph(id);
        assertDraft(graph);
        const existingProposal = state.connection.sqlite
          .prepare(
            `SELECT * FROM course_draft_proposals
             WHERE version_id = ? AND authoring_operation_id = ?`,
          )
          .get(id, input.operationId) as unknown as ProposalRow | undefined;
        if (existingProposal) {
          return { proposal: proposalDto(existingProposal) };
        }
        const dispatch = await state.providerRuntime.resolveDispatch({
          role: "course-designer",
          payload: designerPayload(graph, input.prompt),
          ...(input.disclosureOperationId
            ? { disclosureOperationId: input.disclosureOperationId }
            : {}),
          metadata: {
            authoringOperationId: input.operationId,
            versionId: id,
            draftHash: authoringDraftHash(graph),
          },
        });
        const proposal = await runDesignerTurn(
          state,
          dispatch,
          graph,
          input.prompt,
          input.operationId,
          context.req.raw.signal,
        );
        return { proposal: proposalDto(proposal) };
      }),
  );

  app.post(
    "/api/curriculum-editor/versions/:versionId/designer/proposals/:proposalId/apply",
    (context) =>
      route(context, async () => {
        await readJson(context, reviewSchema);
        const id = versionId(context);
        const proposalId = idSchema.parse(context.req.param("proposalId"));
        const row = state.connection.sqlite
          .prepare(
            `SELECT * FROM course_draft_proposals WHERE id = ? AND version_id = ?`,
          )
          .get(proposalId, id) as ProposalRow | undefined;
        if (!row) {
          throw new CourseDesignerError(
            404,
            "not_found",
            "Proposal was not found",
          );
        }
        if (row.status !== "proposed") {
          throw new CourseDesignerError(
            409,
            "proposal_reviewed",
            "Proposal has already been reviewed",
          );
        }
        const repository = new CurriculumAuthoringRepository(state.connection);
        const graph = await repository.getVersionGraph(id);
        assertDraft(graph);
        if (authoringDraftHash(graph) !== row.base_draft_hash) {
          throw new CourseDesignerError(
            409,
            "stale_proposal",
            "Course draft changed after this proposal was created",
          );
        }
        const proposal = CourseDraftProposalSchema.parse(
          JSON.parse(row.proposal_json),
        );

        state.connection.sqlite.exec("BEGIN IMMEDIATE");
        try {
          for (const change of proposal.changes) {
            await applyChange(repository, id, change);
          }
          state.connection.sqlite
            .prepare(
              `UPDATE course_draft_proposals
               SET status = 'applied', reviewed_at = ?
               WHERE id = ? AND status = 'proposed'`,
            )
            .run(Date.now(), row.id);
          state.connection.sqlite.exec("COMMIT");
        } catch (error) {
          state.connection.sqlite.exec("ROLLBACK");
          throw error;
        }
        const updated = state.connection.sqlite
          .prepare("SELECT * FROM course_draft_proposals WHERE id = ?")
          .get(row.id) as unknown as ProposalRow;
        return {
          proposal: proposalDto(updated),
          curriculum: await repository.getVersionGraph(id),
        };
      }),
  );

  app.post(
    "/api/curriculum-editor/versions/:versionId/designer/proposals/:proposalId/reject",
    (context) =>
      route(context, async () => {
        await readJson(context, reviewSchema);
        const id = versionId(context);
        const proposalId = idSchema.parse(context.req.param("proposalId"));
        const result = state.connection.sqlite
          .prepare(
            `UPDATE course_draft_proposals
             SET status = 'rejected', reviewed_at = ?
             WHERE id = ? AND version_id = ? AND status = 'proposed'`,
          )
          .run(Date.now(), proposalId, id);
        if (result.changes !== 1) {
          const exists = state.connection.sqlite
            .prepare(
              "SELECT status FROM course_draft_proposals WHERE id = ? AND version_id = ?",
            )
            .get(proposalId, id) as { status: string } | undefined;
          if (!exists) {
            throw new CourseDesignerError(
              404,
              "not_found",
              "Proposal was not found",
            );
          }
          throw new CourseDesignerError(
            409,
            "proposal_reviewed",
            "Proposal has already been reviewed",
          );
        }
        const row = state.connection.sqlite
          .prepare("SELECT * FROM course_draft_proposals WHERE id = ?")
          .get(proposalId) as unknown as ProposalRow;
        return { proposal: proposalDto(row) };
      }),
  );
}
