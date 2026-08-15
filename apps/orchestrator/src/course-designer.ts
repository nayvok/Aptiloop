import { randomUUID } from "node:crypto";

import {
  AgentProviderError,
  ProviderHubError,
  type PiAgentProviderOptions,
} from "@aptiloop/agent-core";
import {
  CurriculumAuthoringRepository,
  ProviderHubRepository,
  withTransaction,
  type CurriculumVersionGraph,
  type DatabaseConnection,
} from "@aptiloop/database";
import { getLatestPrompt } from "@aptiloop/prompt-library";
import {
  CourseDesignerPendingDisclosureSchema,
  CourseDesignerRequestSchema,
  CourseDesignerPendingDisclosureResponseSchema,
  CourseDesignerWorkflowSchema,
  CourseDraftProposalDiffSchema,
  CourseDraftProposalSchema,
  type CourseDesignerDiagnostic,
  type CourseDesignerRequest,
  type CourseDesignerWorkflow,
  type CourseDesignerWorkflowState,
  type CourseDraftProposal,
  type CourseDraftProposalDiff,
  type JsonValue,
} from "@aptiloop/shared";
import type { Context, Hono } from "hono";
import { Type } from "typebox";
import { z } from "zod";

import { authoringDraftHash } from "./authoring-draft-hash.js";
import { authoringValidationReport } from "./curriculum-editor.js";
import {
  type ProviderDispatch,
  type ProviderRuntime,
  providerFailureCode,
} from "./provider-runtime.js";

const idSchema = z.string().trim().min(1).max(200);
const textSchema = z.string().trim().min(1).max(50_000);
const emptyDiagnostic: CourseDesignerDiagnostic = {
  questions: [],
  answers: {},
  skipped: false,
};

type ToolsForRole = NonNullable<PiAgentProviderOptions["toolsForRole"]>;

type ProposalStatus = "proposed" | "applied" | "rejected";

interface ProposalRow {
  id: string;
  version_id: string;
  base_draft_hash: string;
  prompt: string;
  proposal_json: string;
  authoring_operation_id: string;
  status: ProposalStatus;
  provider_operation_id: string;
  created_at: number;
  reviewed_at: number | null;
}

interface AttributionRow {
  proposal_id: string;
  workflow_id: string;
  connection_id: string;
  provider_type: string;
  model_id: string;
  prompt_template_id: string;
  prompt_template_version: string;
  disclosure_operation_id: string | null;
  diff_json: string;
  provenance_json: string;
  validation_json: string;
  created_at: number;
}

interface WorkflowRow {
  id: string;
  version_id: string;
  state: CourseDesignerWorkflowState;
  recovery_state: Exclude<CourseDesignerWorkflowState, "FAILED"> | null;
  request_json: string;
  diagnostic_json: string;
  revision_requests_json: string;
  active_proposal_id: string | null;
  authoring_operation_id: string;
  failure_code: string | null;
  failure_message: string | null;
  created_at: number;
  updated_at: number;
}

interface DisclosureOperationRow {
  operation_id: string;
}

const toolMetadataSchema = z
  .object({
    versionId: idSchema,
    workflowId: idSchema,
    draftHash: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
    prompt: textSchema,
    authoringOperationId: idSchema,
    providerOperationId: idSchema,
    approvedSources: CourseDesignerRequestSchema.shape.sources,
  })
  .strict();

const proposalChangeParameters = Type.Union([
  Type.Object(
    {
      kind: Type.Literal("add-week"),
      stableId: Type.String(),
      title: Type.String(),
      description: Type.Optional(Type.Union([Type.String(), Type.Null()])),
      orderIndex: Type.Optional(Type.Integer({ minimum: 0 })),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("update-week"),
      targetStableId: Type.String(),
      title: Type.Optional(Type.String()),
      description: Type.Optional(Type.Union([Type.String(), Type.Null()])),
      orderIndex: Type.Optional(Type.Integer({ minimum: 0 })),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("add-day"),
      parentStableId: Type.String(),
      stableId: Type.String(),
      title: Type.String(),
      description: Type.Optional(Type.Union([Type.String(), Type.Null()])),
      goal: Type.String(),
      estimatedMinutes: Type.Integer({ minimum: 1, maximum: 10_000 }),
      prerequisites: Type.Optional(Type.Array(Type.String())),
      expectedOutcomes: Type.Optional(Type.Array(Type.String())),
      depthLevel: Type.String(),
      outOfScope: Type.Optional(Type.Array(Type.String())),
      topics: Type.Optional(Type.Array(Type.String())),
      orderIndex: Type.Optional(Type.Integer({ minimum: 0 })),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("update-day"),
      targetStableId: Type.String(),
      title: Type.Optional(Type.String()),
      description: Type.Optional(Type.Union([Type.String(), Type.Null()])),
      goal: Type.Optional(Type.String()),
      estimatedMinutes: Type.Optional(
        Type.Integer({ minimum: 1, maximum: 10_000 }),
      ),
      prerequisites: Type.Optional(Type.Array(Type.String())),
      expectedOutcomes: Type.Optional(Type.Array(Type.String())),
      depthLevel: Type.Optional(Type.String()),
      outOfScope: Type.Optional(Type.Array(Type.String())),
      topics: Type.Optional(Type.Array(Type.String())),
      orderIndex: Type.Optional(Type.Integer({ minimum: 0 })),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("add-unit"),
      parentStableId: Type.String(),
      stableId: Type.String(),
      type: Type.String(),
      title: Type.String(),
      description: Type.Optional(Type.Union([Type.String(), Type.Null()])),
      estimatedMinutes: Type.Optional(
        Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
      ),
      objectives: Type.Optional(Type.Array(Type.String())),
      checklist: Type.Optional(Type.Array(Type.Unknown())),
      sources: Type.Optional(Type.Array(Type.Unknown())),
      questions: Type.Optional(Type.Array(Type.Unknown())),
      misconceptions: Type.Optional(Type.Array(Type.String())),
      referenceAnswer: Type.Optional(Type.Union([Type.String(), Type.Null()])),
      completionCriteria: Type.Array(Type.Unknown(), { minItems: 1 }),
      unlockRules: Type.Optional(Type.Array(Type.Unknown())),
      optional: Type.Optional(Type.Boolean()),
      depthLevel: Type.Optional(Type.Union([Type.String(), Type.Null()])),
      payload: Type.Unknown(),
      orderIndex: Type.Optional(Type.Integer({ minimum: 0 })),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("update-unit"),
      targetStableId: Type.String(),
      type: Type.Optional(Type.String()),
      title: Type.Optional(Type.String()),
      description: Type.Optional(Type.Union([Type.String(), Type.Null()])),
      estimatedMinutes: Type.Optional(
        Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
      ),
      objectives: Type.Optional(Type.Array(Type.String())),
      checklist: Type.Optional(Type.Array(Type.Unknown())),
      sources: Type.Optional(Type.Array(Type.Unknown())),
      questions: Type.Optional(Type.Array(Type.Unknown())),
      misconceptions: Type.Optional(Type.Array(Type.String())),
      referenceAnswer: Type.Optional(Type.Union([Type.String(), Type.Null()])),
      completionCriteria: Type.Optional(
        Type.Array(Type.Unknown(), { minItems: 1 }),
      ),
      unlockRules: Type.Optional(Type.Array(Type.Unknown())),
      optional: Type.Optional(Type.Boolean()),
      depthLevel: Type.Optional(Type.Union([Type.String(), Type.Null()])),
      payload: Type.Optional(Type.Unknown()),
      orderIndex: Type.Optional(Type.Integer({ minimum: 0 })),
    },
    { additionalProperties: false },
  ),
]);

const proposalToolParameters = Type.Object(
  {
    proposal: Type.Object(
      {
        summary: Type.String({ minLength: 1, maxLength: 50_000 }),
        changes: Type.Array(proposalChangeParameters, {
          minItems: 1,
          maxItems: 50,
        }),
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
const readSourcesToolParameters = Type.Object(
  { sourceIds: Type.Array(Type.String(), { maxItems: 100 }) },
  { additionalProperties: false },
);
const readDraftToolInputSchema = z
  .object({ section: z.enum(["all", "outline", "activities"]) })
  .strict();
const readSourcesToolInputSchema = z
  .object({ sourceIds: z.array(idSchema).max(100) })
  .strict();
const proposalToolInputSchema = z
  .object({ proposal: CourseDraftProposalSchema })
  .strict();

function parseJson(value: string): unknown {
  return JSON.parse(value) as unknown;
}

function proposalDto(connection: DatabaseConnection, row: ProposalRow) {
  const attribution = connection.sqlite
    .prepare(
      "SELECT * FROM course_draft_proposal_attribution WHERE proposal_id = ?",
    )
    .get(row.id) as AttributionRow | undefined;
  return {
    id: row.id,
    versionId: row.version_id,
    baseDraftHash: row.base_draft_hash,
    prompt: row.prompt,
    proposal: CourseDraftProposalSchema.parse(parseJson(row.proposal_json)),
    status: row.status,
    authoringOperationId: row.authoring_operation_id,
    providerOperationId: row.provider_operation_id,
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at,
    attribution: attribution
      ? {
          workflowId: attribution.workflow_id,
          connectionId: attribution.connection_id,
          providerType: attribution.provider_type,
          modelId: attribution.model_id,
          promptTemplateId: attribution.prompt_template_id,
          promptTemplateVersion: attribution.prompt_template_version,
          disclosureOperationId: attribution.disclosure_operation_id,
          diffs: parseJson(attribution.diff_json),
          provenance: parseJson(attribution.provenance_json),
          validation: parseJson(attribution.validation_json),
        }
      : null,
  };
}

function workflowDto(row: WorkflowRow): CourseDesignerWorkflow {
  return CourseDesignerWorkflowSchema.parse({
    id: row.id,
    versionId: row.version_id,
    state: row.state,
    recoveryState: row.recovery_state,
    request: parseJson(row.request_json),
    diagnostic: parseJson(row.diagnostic_json),
    revisionRequests: parseJson(row.revision_requests_json),
    activeProposalId: row.active_proposal_id,
    authoringOperationId: row.authoring_operation_id,
    failureCode: row.failure_code,
    failureMessage: row.failure_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function pendingDesignerDisclosure(
  connection: DatabaseConnection,
  input: {
    versionId: string;
    workflowId: string;
    now?: number;
  },
) {
  const repository = new ProviderHubRepository(connection);
  const rows = connection.sqlite
    .prepare(
      `SELECT operation.operation_id
       FROM ai_disclosure_operations operation
       JOIN ai_disclosure_events event
         ON event.operation_id = operation.operation_id
        AND event.sequence = (
          SELECT MAX(latest.sequence)
          FROM ai_disclosure_events latest
          WHERE latest.operation_id = operation.operation_id
        )
       WHERE operation.role = 'course-designer'
         AND event.status = 'pending'
       ORDER BY operation.created_at DESC, operation.operation_id DESC`,
    )
    .all() as unknown as DisclosureOperationRow[];
  const now = input.now ?? Date.now();
  const matches = rows.flatMap(({ operation_id }) => {
    const disclosure = repository.getDisclosure(operation_id);
    if (!disclosure || Date.parse(disclosure.expiresAt) <= now) return [];
    const entities = disclosure.scope.entityIds;
    const operationId = entities["course-designer-authoring-operation"];
    if (
      entities["course-revision"] !== input.versionId ||
      entities["course-designer-workflow"] !== input.workflowId ||
      !operationId
    ) {
      return [];
    }
    return [
      CourseDesignerPendingDisclosureSchema.parse({
        operationId,
        workflowId: input.workflowId,
        versionId: input.versionId,
        disclosure,
      }),
    ];
  });
  if (matches.length > 1) {
    throw new CourseDesignerError(
      409,
      "ambiguous_pending_disclosure",
      "Course Designer has more than one pending disclosure for this workflow",
    );
  }
  return matches[0] ?? null;
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

const protectedAuthoringKeys = new Set(
  [
    "answer",
    "answerkey",
    "commonMistakes",
    "correctAnswer",
    "correctIndex",
    "correctOptionIds",
    "correctOptionStableIds",
    "correctQuestionIds",
    "evaluationPoints",
    "expectedAnswer",
    "expectedOutput",
    "gradingRubric",
    "misconceptions",
    "modelAnswer",
    "protectedEvaluation",
    "protectedMaterial",
    "referenceAnswer",
    "referenceSolution",
    "rubric",
    "solution",
  ].map((key) => key.toLowerCase()),
);

function isProtectedAuthoringKey(key: string): boolean {
  return protectedAuthoringKeys.has(
    key.replaceAll(/[^a-z0-9]/giu, "").toLowerCase(),
  );
}

function providerSafeAuthoringValue(value: unknown): JsonValue {
  if (Array.isArray(value)) {
    return value.map((item) => providerSafeAuthoringValue(item));
  }
  if (value === null || typeof value !== "object") {
    return value as JsonValue;
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !isProtectedAuthoringKey(key))
      .map(([key, nested]) => [key, providerSafeAuthoringValue(nested)]),
  );
}

function providerSafeUnit(
  unit: CurriculumVersionGraph["weeks"][number]["days"][number]["units"][number],
): Record<string, JsonValue> {
  return providerSafeAuthoringValue({
    id: unit.id,
    versionId: unit.versionId,
    dayId: unit.dayId,
    stableId: unit.stableId,
    type: unit.type,
    orderIndex: unit.orderIndex,
    title: unit.title,
    description: unit.description,
    estimatedMinutes: unit.estimatedMinutes,
    objectives: unit.objectives,
    checklist: unit.checklist,
    sources: unit.sources,
    questions: unit.questions,
    completionCriteria: unit.completionCriteria,
    unlockRules: unit.unlockRules,
    optional: unit.optional,
    depthLevel: unit.depthLevel,
    payload: unit.payload,
  }) as Record<string, JsonValue>;
}

function providerSafeAuthoringGraph(
  graph: CurriculumVersionGraph,
): Record<string, JsonValue> {
  return {
    primaryLocale: graph.primaryLocale,
    version: {
      id: graph.version.id,
      curriculumId: graph.version.curriculumId,
      revision: graph.version.revision,
      parentVersionId: graph.version.parentVersionId,
      status: graph.version.status,
      title: graph.version.title,
      description: graph.version.description,
      contentHash: graph.version.contentHash,
      createdAt: graph.version.createdAt,
      publishedAt: graph.version.publishedAt,
      archivedAt: graph.version.archivedAt,
      updatedAt: graph.version.updatedAt,
    },
    weeks: graph.weeks.map((week) => ({
      id: week.id,
      versionId: week.versionId,
      stableId: week.stableId,
      orderIndex: week.orderIndex,
      title: week.title,
      description: week.description,
      createdAt: week.createdAt,
      updatedAt: week.updatedAt,
      days: week.days.map((day) => ({
        id: day.id,
        versionId: day.versionId,
        weekId: day.weekId,
        stableId: day.stableId,
        orderIndex: day.orderIndex,
        title: day.title,
        description: day.description,
        goal: day.goal,
        estimatedMinutes: day.estimatedMinutes,
        depthLevel: day.depthLevel,
        createdAt: day.createdAt,
        updatedAt: day.updatedAt,
        prerequisites: providerSafeAuthoringValue(day.prerequisites),
        expectedOutcomes: providerSafeAuthoringValue(day.expectedOutcomes),
        outOfScope: providerSafeAuthoringValue(day.outOfScope),
        topics: providerSafeAuthoringValue(day.topics),
        units: day.units.map((unit) => providerSafeUnit(unit)),
      })),
    })),
  };
}

function graphSlice(graph: CurriculumVersionGraph, section: string): unknown {
  const safeGraph = providerSafeAuthoringGraph(graph);
  if (section === "outline") {
    return {
      version: safeGraph.version,
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
          topics: providerSafeAuthoringValue(day.topics),
        })),
      })),
    };
  }
  if (section === "activities") {
    return graph.weeks.flatMap((week) =>
      week.days.map((day) => ({
        dayStableId: day.stableId,
        units: day.units.map((unit) => providerSafeUnit(unit)),
      })),
    );
  }
  return safeGraph;
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
        name: "course.readApprovedSources",
        label: "Read approved Course sources",
        description:
          "Read only source references explicitly approved in this authoring request. This tool never fetches a URL or filesystem path.",
        parameters: readSourcesToolParameters,
        executionMode: "sequential",
        execute: async (_toolCallId, parameters, signal) => {
          signal?.throwIfAborted();
          const { sourceIds } = readSourcesToolInputSchema.parse(parameters);
          const byId = new Map(
            metadata.approvedSources.map((source) => [source.id, source]),
          );
          const sources = sourceIds.map((sourceId) => {
            const source = byId.get(sourceId);
            if (!source) throw new Error(`Source ${sourceId} is not approved`);
            return source;
          });
          return {
            content: [
              { type: "text" as const, text: JSON.stringify({ sources }) },
            ],
            details: { workflowId: metadata.workflowId, sourceIds },
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
          signal?.throwIfAborted();
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
  /** @internal Deterministic cancellation fence seam. */
  beforeProposalCommit?: () => Promise<void> | void;
}

const createWorkflowSchema = z
  .object({
    operationId: idSchema,
    request: CourseDesignerRequestSchema,
  })
  .strict();
const workflowOperationSchema = z.object({ operationId: idSchema }).strict();
const generationSchema = workflowOperationSchema
  .extend({ disclosureOperationId: idSchema.optional() })
  .strict();
const advanceSchema = z.discriminatedUnion("action", [
  workflowOperationSchema
    .extend({ action: z.literal("submit-request") })
    .strict(),
  workflowOperationSchema
    .extend({ action: z.literal("complete-discovery") })
    .strict(),
  workflowOperationSchema
    .extend({
      action: z.literal("answer-diagnostic"),
      answers: z.record(idSchema, textSchema),
    })
    .strict(),
  workflowOperationSchema
    .extend({ action: z.literal("skip-diagnostic") })
    .strict(),
  workflowOperationSchema
    .extend({ action: z.literal("confirm-proposal") })
    .strict(),
  workflowOperationSchema
    .extend({ action: z.literal("reject-proposal") })
    .strict(),
  workflowOperationSchema
    .extend({
      action: z.literal("request-revision"),
      revisionRequest: textSchema,
    })
    .strict(),
]);

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

function routeVersionId(context: Context): string {
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

function routeWorkflowId(context: Context): string {
  const parsed = idSchema.safeParse(context.req.param("workflowId"));
  if (!parsed.success) {
    throw new CourseDesignerError(
      400,
      "invalid_request",
      "Workflow ID is invalid",
    );
  }
  return parsed.data;
}

function routeProposalId(context: Context): string {
  const parsed = idSchema.safeParse(context.req.param("proposalId"));
  if (!parsed.success) {
    throw new CourseDesignerError(
      400,
      "invalid_request",
      "Proposal ID is invalid",
    );
  }
  return parsed.data;
}

async function route<T>(
  context: Context,
  work: () => Promise<T>,
): Promise<Response> {
  try {
    return context.json(await work());
  } catch (error) {
    if (context.req.raw.signal.aborted) {
      return context.json(
        {
          error: "Course Designer provider turn was cancelled",
          code: "cancelled",
        },
        409,
      );
    }
    if (error instanceof CourseDesignerError) {
      return context.json(
        { error: error.message, code: error.code },
        error.status,
      );
    }
    if (error instanceof ProviderHubError) {
      return context.json(
        {
          error: "Course Designer provider turn failed",
          code: error.failure.code,
          failure: error.failure,
        },
        409,
      );
    }
    throw error;
  }
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

function readWorkflow(
  connection: DatabaseConnection,
  workflowId: string,
  versionId?: string,
): WorkflowRow {
  const row = connection.sqlite
    .prepare(
      versionId
        ? "SELECT * FROM course_designer_workflows WHERE id = ? AND version_id = ?"
        : "SELECT * FROM course_designer_workflows WHERE id = ?",
    )
    .get(...(versionId ? [workflowId, versionId] : [workflowId])) as
    WorkflowRow | undefined;
  if (!row) {
    throw new CourseDesignerError(
      404,
      "workflow_not_found",
      "Course Designer workflow was not found",
    );
  }
  return row;
}

function transitionWithinTransaction(
  connection: DatabaseConnection,
  row: WorkflowRow,
  input: {
    operationId: string;
    eventType: string;
    toState: CourseDesignerWorkflowState;
    payload?: unknown;
    recoveryState?: Exclude<CourseDesignerWorkflowState, "FAILED"> | null;
    diagnostic?: CourseDesignerDiagnostic;
    revisionRequests?: readonly string[];
    activeProposalId?: string | null;
    failureCode?: string | null;
    failureMessage?: string | null;
  },
): WorkflowRow {
  const now = Date.now();
  const result = connection.sqlite
    .prepare(
      `UPDATE course_designer_workflows
       SET state = ?, recovery_state = ?, diagnostic_json = ?,
           revision_requests_json = ?, active_proposal_id = ?, failure_code = ?,
           failure_message = ?, updated_at = ?
       WHERE id = ? AND state = ?`,
    )
    .run(
      input.toState,
      input.recoveryState === undefined
        ? input.toState === "FAILED"
          ? row.recovery_state
          : null
        : input.recoveryState,
      JSON.stringify(
        input.diagnostic ??
          (parseJson(row.diagnostic_json) as CourseDesignerDiagnostic),
      ),
      JSON.stringify(
        input.revisionRequests ??
          (parseJson(row.revision_requests_json) as string[]),
      ),
      input.activeProposalId === undefined
        ? row.active_proposal_id
        : input.activeProposalId,
      input.failureCode === undefined ? null : input.failureCode,
      input.failureMessage === undefined ? null : input.failureMessage,
      now,
      row.id,
      row.state,
    );
  if (result.changes !== 1) {
    throw new CourseDesignerError(
      409,
      "workflow_state_changed",
      "Course Designer workflow state changed concurrently",
    );
  }
  connection.sqlite
    .prepare(
      `INSERT INTO course_designer_events
       (workflow_id, operation_id, event_type, from_state, to_state, payload_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.id,
      input.operationId,
      input.eventType,
      row.state,
      input.toState,
      JSON.stringify(input.payload ?? {}),
      now,
    );
  return readWorkflow(connection, row.id);
}

function transitionWorkflow(
  connection: DatabaseConnection,
  row: WorkflowRow,
  expectedState: CourseDesignerWorkflowState,
  input: Parameters<typeof transitionWithinTransaction>[2],
): WorkflowRow {
  const prior = connection.sqlite
    .prepare(
      "SELECT 1 FROM course_designer_events WHERE workflow_id = ? AND operation_id = ?",
    )
    .get(row.id, input.operationId);
  if (prior) return readWorkflow(connection, row.id);
  if (row.state !== expectedState) {
    throw new CourseDesignerError(
      409,
      "invalid_workflow_transition",
      `Action requires ${expectedState}; workflow is ${row.state}`,
    );
  }
  return withTransaction(connection, () =>
    transitionWithinTransaction(connection, row, input),
  );
}

function createDiagnostic(
  request: CourseDesignerRequest,
): CourseDesignerDiagnostic {
  const questions: CourseDesignerDiagnostic["questions"] = [];
  if (request.sources.length === 0) {
    questions.push({
      id: "diagnostic:no-sources",
      prompt: "Should the draft proceed without an approved source reference?",
    });
  }
  if (request.constraints.length === 0) {
    questions.push({
      id: "diagnostic:constraints",
      prompt:
        "Are there time, scope, safety, or accessibility constraints to add?",
    });
  }
  if (request.activityPreferences.length === 0) {
    questions.push({
      id: "diagnostic:activities",
      prompt: "Which evidence-producing activity types should be emphasized?",
    });
  }
  return { questions, answers: {}, skipped: false };
}

function designerPayload(
  graph: CurriculumVersionGraph,
  workflow: CourseDesignerWorkflow,
): string {
  return JSON.stringify({
    task: "Propose a finite typed change set for this Course Draft.",
    request: workflow.request,
    diagnostic: workflow.diagnostic,
    revisionRequests: workflow.revisionRequests,
    constraints: {
      apply: false,
      publish: false,
      fetchSources: false,
      stableTargetIds: true,
      allowedChangeKinds: [
        "add-week",
        "update-week",
        "add-day",
        "update-day",
        "add-unit",
        "update-unit",
      ],
    },
    draft: providerSafeAuthoringGraph(graph),
  });
}

function jsonRecord(value: unknown): Record<string, JsonValue> {
  return JSON.parse(JSON.stringify(value)) as Record<string, JsonValue>;
}

function proposalDiffs(
  graph: CurriculumVersionGraph,
  proposal: CourseDraftProposal,
): CourseDraftProposalDiff[] {
  const weeks = new Map(graph.weeks.map((week) => [week.stableId, week]));
  const days = new Map(
    graph.weeks.flatMap((week) =>
      week.days.map((day) => [day.stableId, day] as const),
    ),
  );
  const units = new Map(
    graph.weeks.flatMap((week) =>
      week.days.flatMap((day) =>
        day.units.map((unit) => [unit.stableId, unit] as const),
      ),
    ),
  );
  return CourseDraftProposalDiffSchema.array().parse(
    proposal.changes.map((change) => {
      const targetStableId =
        "targetStableId" in change ? change.targetStableId : change.stableId;
      const beforeEntity =
        change.kind === "update-week"
          ? weeks.get(change.targetStableId)
          : change.kind === "update-day"
            ? days.get(change.targetStableId)
            : change.kind === "update-unit"
              ? units.get(change.targetStableId)
              : undefined;
      const changeBody = jsonRecord(change);
      delete changeBody.kind;
      delete changeBody.targetStableId;
      delete changeBody.parentStableId;
      const before = beforeEntity ? jsonRecord(beforeEntity) : null;
      return {
        kind: change.kind,
        targetStableId,
        before,
        after: before ? { ...before, ...changeBody } : changeBody,
      };
    }),
  );
}

function validateProposal(
  graph: CurriculumVersionGraph,
  proposal: CourseDraftProposal,
): {
  valid: boolean;
  errors: number;
  warnings: number;
  diagnostics: Array<{
    code: string;
    severity: "error" | "warning";
    targetStableId: string;
    message: string;
  }>;
} {
  const weekIds = new Set(graph.weeks.map((week) => week.stableId));
  const dayIds = new Set(
    graph.weeks.flatMap((week) => week.days.map((day) => day.stableId)),
  );
  const unitIds = new Set(
    graph.weeks.flatMap((week) =>
      week.days.flatMap((day) => day.units.map((unit) => unit.stableId)),
    ),
  );
  const allIds = new Set([...weekIds, ...dayIds, ...unitIds]);
  const diagnostics: Array<{
    code: string;
    severity: "error" | "warning";
    targetStableId: string;
    message: string;
  }> = [];
  for (const change of proposal.changes) {
    if ("stableId" in change) {
      if (allIds.has(change.stableId)) {
        diagnostics.push({
          code: "stable_id_conflict",
          severity: "error",
          targetStableId: change.stableId,
          message: "Stable ID already identifies an authored entity",
        });
      } else {
        allIds.add(change.stableId);
        if (change.kind === "add-week") weekIds.add(change.stableId);
        if (change.kind === "add-day") dayIds.add(change.stableId);
        if (change.kind === "add-unit") unitIds.add(change.stableId);
      }
      if (change.kind === "add-day" && !weekIds.has(change.parentStableId)) {
        diagnostics.push({
          code: "missing_parent",
          severity: "error",
          targetStableId: change.stableId,
          message: `Week ${change.parentStableId} does not exist`,
        });
      }
      if (change.kind === "add-unit" && !dayIds.has(change.parentStableId)) {
        diagnostics.push({
          code: "missing_parent",
          severity: "error",
          targetStableId: change.stableId,
          message: `Day ${change.parentStableId} does not exist`,
        });
      }
      continue;
    }
    const exists =
      change.kind === "update-week"
        ? weekIds.has(change.targetStableId)
        : change.kind === "update-day"
          ? dayIds.has(change.targetStableId)
          : unitIds.has(change.targetStableId);
    if (!exists) {
      diagnostics.push({
        code: "unknown_target",
        severity: "error",
        targetStableId: change.targetStableId,
        message: "Proposal references an unknown stable target ID",
      });
    }
  }
  if (proposal.changes.length > 25) {
    diagnostics.push({
      code: "large_change_set",
      severity: "warning",
      targetStableId: graph.version.id,
      message: "Review this large proposal in smaller bounded slices",
    });
  }
  const errors = diagnostics.filter(
    ({ severity }) => severity === "error",
  ).length;
  return {
    valid: errors === 0,
    errors,
    warnings: diagnostics.length - errors,
    diagnostics,
  };
}

async function runDesignerTurn(
  state: CourseDesignerState,
  dispatch: ProviderDispatch,
  graph: CurriculumVersionGraph,
  workflow: CourseDesignerWorkflow,
  authoringOperationId: string,
  signal: AbortSignal,
): Promise<{ proposal: ProposalRow; providerSessionId: string }> {
  const promptDefinition = getLatestPrompt("course-designer");
  const prompt = workflow.request.goal;
  let providerSessionId: string | null = null;
  let completedContent: string | null = null;
  try {
    signal.throwIfAborted();
    await state.providerRuntime.runOwnedSetup(
      (setupSignal) =>
        dispatch.provider.createSession(
          {
            role: "course-designer",
            modelId: dispatch.modelId,
            systemPrompt: promptDefinition.systemPrompt,
            metadata: {
              versionId: graph.version.id,
              workflowId: workflow.id,
              draftHash: authoringDraftHash(graph),
              prompt,
              authoringOperationId,
              providerOperationId: dispatch.operationId,
              approvedSources: JSON.parse(
                JSON.stringify(workflow.request.sources),
              ) as JsonValue,
            },
          },
          setupSignal,
        ),
      signal,
      (session) => dispatch.provider.cancelSession(session.id),
      (ownedSession) => {
        providerSessionId = ownedSession.id;
      },
    );
    const ownedSessionId = providerSessionId;
    if (!ownedSessionId) {
      throw new ProviderHubError(
        "provider_error",
        "Course Designer provider session ownership failed",
      );
    }
    signal.throwIfAborted();
    for await (const event of state.providerRuntime.stream(
      dispatch,
      ownedSessionId,
      signal,
      "json",
    )) {
      if (event.type === "message.completed") completedContent = event.content;
    }
    signal.throwIfAborted();

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
        signal.throwIfAborted();
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
    signal.throwIfAborted();
    return { proposal, providerSessionId: ownedSessionId };
  } catch (error) {
    if (signal.aborted) {
      state.connection.sqlite
        .prepare(
          `DELETE FROM course_draft_proposals
           WHERE version_id = ? AND provider_operation_id = ?
             AND authoring_operation_id = ? AND status = 'proposed'
             AND NOT EXISTS (
               SELECT 1 FROM course_draft_proposal_attribution
               WHERE proposal_id = course_draft_proposals.id
             )`,
        )
        .run(graph.version.id, dispatch.operationId, authoringOperationId);
    }
    state.providerRuntime.finishDispatch(
      dispatch,
      signal.aborted ? "cancelled" : "failed",
      signal.aborted ? "cancelled" : providerFailureCode(error),
    );
    if (error instanceof SyntaxError) {
      throw new AgentProviderError(
        "invalid_output",
        "Course Designer returned invalid JSON",
        false,
        { cause: error },
      );
    }
    throw error;
  } finally {
    if (providerSessionId) {
      await dispatch.provider
        .cancelSession(providerSessionId)
        .catch(() => undefined);
    }
  }
}

function persistAttribution(
  connection: DatabaseConnection,
  input: {
    proposal: ProposalRow;
    workflow: CourseDesignerWorkflow;
    dispatch: ProviderDispatch;
    graph: CurriculumVersionGraph;
  },
): void {
  const prompt = getLatestPrompt("course-designer");
  const proposal = CourseDraftProposalSchema.parse(
    parseJson(input.proposal.proposal_json),
  );
  connection.sqlite
    .prepare(
      `INSERT OR IGNORE INTO course_draft_proposal_attribution
       (proposal_id, workflow_id, connection_id, provider_type, model_id,
        prompt_template_id, prompt_template_version, disclosure_operation_id,
        diff_json, provenance_json, validation_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.proposal.id,
      input.workflow.id,
      input.dispatch.connection.connectionId,
      input.dispatch.connection.providerType,
      input.dispatch.modelId,
      prompt.id,
      prompt.version,
      input.dispatch.disclosure?.operationId ?? null,
      JSON.stringify(proposalDiffs(input.graph, proposal)),
      JSON.stringify({
        sourceIds: input.workflow.request.sources.map(({ id }) => id),
        sources: input.workflow.request.sources,
        authoringRequestOperationId: input.workflow.authoringOperationId,
        providerOperationId: input.dispatch.operationId,
      }),
      JSON.stringify(validateProposal(input.graph, proposal)),
      Date.now(),
    );
}

function applyChange(
  repository: CurriculumAuthoringRepository,
  versionId: string,
  change: CourseDraftProposal["changes"][number],
): void {
  if (change.kind === "add-week") {
    repository.addWeek({
      versionId,
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
  if (change.kind === "update-week") {
    repository.updateWeek({
      versionId,
      targetStableId: change.targetStableId,
      ...(change.title !== undefined ? { title: change.title } : {}),
      ...(change.description !== undefined
        ? { description: change.description }
        : {}),
      ...(change.orderIndex !== undefined
        ? { orderIndex: change.orderIndex }
        : {}),
    });
    return;
  }

  const graph = repository.getVersionGraph(versionId);
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
    repository.addDay({
      versionId,
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
  if (change.kind === "update-day") {
    repository.updateDay({
      versionId,
      targetStableId: change.targetStableId,
      ...(change.title !== undefined ? { title: change.title } : {}),
      ...(change.description !== undefined
        ? { description: change.description }
        : {}),
      ...(change.goal !== undefined ? { goal: change.goal } : {}),
      ...(change.estimatedMinutes !== undefined
        ? { estimatedMinutes: change.estimatedMinutes }
        : {}),
      ...(change.prerequisites !== undefined
        ? { prerequisites: change.prerequisites }
        : {}),
      ...(change.expectedOutcomes !== undefined
        ? { expectedOutcomes: change.expectedOutcomes }
        : {}),
      ...(change.depthLevel !== undefined
        ? { depthLevel: change.depthLevel }
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
  if (change.kind === "update-unit") {
    repository.updateUnit({
      versionId,
      targetStableId: change.targetStableId,
      ...(change.type !== undefined ? { type: change.type } : {}),
      ...(change.title !== undefined ? { title: change.title } : {}),
      ...(change.description !== undefined
        ? { description: change.description }
        : {}),
      ...(change.estimatedMinutes !== undefined
        ? { estimatedMinutes: change.estimatedMinutes }
        : {}),
      ...(change.objectives !== undefined
        ? { objectives: change.objectives }
        : {}),
      ...(change.checklist !== undefined
        ? { checklist: change.checklist }
        : {}),
      ...(change.sources !== undefined ? { sources: change.sources } : {}),
      ...(change.questions !== undefined
        ? { questions: change.questions }
        : {}),
      ...(change.misconceptions !== undefined
        ? { misconceptions: change.misconceptions }
        : {}),
      ...(change.referenceAnswer !== undefined
        ? { referenceAnswer: change.referenceAnswer }
        : {}),
      ...(change.completionCriteria !== undefined
        ? { completionCriteria: change.completionCriteria }
        : {}),
      ...(change.unlockRules !== undefined
        ? { unlockRules: change.unlockRules }
        : {}),
      ...(change.optional !== undefined ? { optional: change.optional } : {}),
      ...(change.depthLevel !== undefined
        ? { depthLevel: change.depthLevel }
        : {}),
      ...(change.payload !== undefined
        ? { payload: change.payload as Record<string, unknown> }
        : {}),
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
  repository.addUnit({
    versionId,
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

function reconcilePublishedWorkflow(
  connection: DatabaseConnection,
  row: WorkflowRow,
): WorkflowRow {
  if (row.state !== "VALIDATION") return row;
  const version = connection.sqlite
    .prepare("SELECT status FROM curriculum_versions WHERE id = ?")
    .get(row.version_id) as { status: string } | undefined;
  if (version?.status !== "published") return row;
  return transitionWorkflow(connection, row, "VALIDATION", {
    operationId: `publish-reconcile:${row.id}`,
    eventType: "published",
    toState: "PUBLISHED",
    payload: { versionId: row.version_id },
  });
}

function failWorkflow(
  connection: DatabaseConnection,
  row: WorkflowRow,
  operationId: string,
  recoveryState: Exclude<CourseDesignerWorkflowState, "FAILED">,
  error: unknown,
): void {
  const current = readWorkflow(connection, row.id);
  if (current.state === "FAILED" || current.state === "PUBLISHED") return;
  transitionWorkflow(connection, current, current.state, {
    operationId: `failure:${operationId}`,
    eventType: "failed",
    toState: "FAILED",
    recoveryState,
    failureCode: providerFailureCode(error),
    failureMessage: "Course Designer provider turn failed",
    payload: { code: providerFailureCode(error), recoveryState },
  });
}

export function registerCourseDesignerRoutes(
  app: Hono,
  state: CourseDesignerState,
): void {
  app.get(
    "/api/curriculum-editor/versions/:versionId/designer/workflows",
    (context) =>
      route(context, async () => {
        const versionId = routeVersionId(context);
        const rows = state.connection.sqlite
          .prepare(
            `SELECT * FROM course_designer_workflows
             WHERE version_id = ? ORDER BY updated_at DESC, id`,
          )
          .all(versionId) as unknown as WorkflowRow[];
        return {
          workflows: rows.map((row) =>
            workflowDto(reconcilePublishedWorkflow(state.connection, row)),
          ),
        };
      }),
  );

  app.post(
    "/api/curriculum-editor/versions/:versionId/designer/workflows",
    (context) =>
      route(context, async () => {
        const input = await readJson(context, createWorkflowSchema);
        const versionId = routeVersionId(context);
        const repository = new CurriculumAuthoringRepository(state.connection);
        assertDraft(await repository.getVersionGraph(versionId));
        const existing = state.connection.sqlite
          .prepare(
            `SELECT * FROM course_designer_workflows
             WHERE version_id = ? AND authoring_operation_id = ?`,
          )
          .get(versionId, input.operationId) as WorkflowRow | undefined;
        if (existing) return { workflow: workflowDto(existing) };
        const now = Date.now();
        const id = `course-designer:${randomUUID()}`;
        withTransaction(state.connection, () => {
          state.connection.sqlite
            .prepare(
              `INSERT INTO course_designer_workflows
               (id, version_id, state, recovery_state, request_json,
                diagnostic_json, revision_requests_json, active_proposal_id,
                authoring_operation_id, failure_code, failure_message,
                created_at, updated_at)
               VALUES (?, ?, 'DRAFT_REQUEST', NULL, ?, ?, '[]', NULL, ?, NULL, NULL, ?, ?)`,
            )
            .run(
              id,
              versionId,
              JSON.stringify(input.request),
              JSON.stringify(emptyDiagnostic),
              input.operationId,
              now,
              now,
            );
          state.connection.sqlite
            .prepare(
              `INSERT INTO course_designer_events
               (workflow_id, operation_id, event_type, from_state, to_state,
                payload_json, created_at)
               VALUES (?, ?, 'created', NULL, 'DRAFT_REQUEST', '{}', ?)`,
            )
            .run(id, input.operationId, now);
        });
        return { workflow: workflowDto(readWorkflow(state.connection, id)) };
      }),
  );

  app.get(
    "/api/curriculum-editor/versions/:versionId/designer/workflows/:workflowId",
    (context) =>
      route(context, async () => {
        const row = readWorkflow(
          state.connection,
          routeWorkflowId(context),
          routeVersionId(context),
        );
        return {
          workflow: workflowDto(
            reconcilePublishedWorkflow(state.connection, row),
          ),
        };
      }),
  );

  app.post(
    "/api/curriculum-editor/versions/:versionId/designer/workflows/:workflowId/advance",
    (context) =>
      route(context, async () => {
        const input = await readJson(context, advanceSchema);
        let row = readWorkflow(
          state.connection,
          routeWorkflowId(context),
          routeVersionId(context),
        );
        if (input.action === "submit-request") {
          row = transitionWorkflow(state.connection, row, "DRAFT_REQUEST", {
            operationId: input.operationId,
            eventType: "request-submitted",
            toState: "DISCOVERY",
          });
        } else if (input.action === "complete-discovery") {
          const request = CourseDesignerRequestSchema.parse(
            parseJson(row.request_json),
          );
          const diagnostic = createDiagnostic(request);
          row = transitionWorkflow(state.connection, row, "DISCOVERY", {
            operationId: input.operationId,
            eventType: "discovery-completed",
            toState: "DIAGNOSTIC",
            diagnostic,
            payload: { questionCount: diagnostic.questions.length },
          });
        } else if (input.action === "answer-diagnostic") {
          const diagnostic = parseJson(
            row.diagnostic_json,
          ) as CourseDesignerDiagnostic;
          const missing = diagnostic.questions.filter(
            ({ id }) => input.answers[id] === undefined,
          );
          if (missing.length > 0) {
            throw new CourseDesignerError(
              400,
              "diagnostic_incomplete",
              "Every diagnostic question requires an answer",
            );
          }
          row = transitionWorkflow(state.connection, row, "DIAGNOSTIC", {
            operationId: input.operationId,
            eventType: "diagnostic-answered",
            toState: "CURRICULUM_PROPOSAL",
            diagnostic: {
              ...diagnostic,
              answers: input.answers,
              skipped: false,
            },
          });
        } else if (input.action === "skip-diagnostic") {
          const diagnostic = parseJson(
            row.diagnostic_json,
          ) as CourseDesignerDiagnostic;
          row = transitionWorkflow(state.connection, row, "DIAGNOSTIC", {
            operationId: input.operationId,
            eventType: "diagnostic-skipped",
            toState: "CURRICULUM_PROPOSAL",
            diagnostic: { ...diagnostic, answers: {}, skipped: true },
          });
        } else if (input.action === "confirm-proposal") {
          if (!row.active_proposal_id) {
            throw new CourseDesignerError(
              409,
              "missing_proposal",
              "Workflow has no active proposal to confirm",
            );
          }
          row = transitionWorkflow(state.connection, row, "USER_REVIEW", {
            operationId: input.operationId,
            eventType: "proposal-confirmed",
            toState: "COMPILATION",
            payload: { proposalId: row.active_proposal_id },
          });
        } else {
          const revisions = parseJson(row.revision_requests_json) as string[];
          const prior = state.connection.sqlite
            .prepare(
              "SELECT 1 FROM course_designer_events WHERE workflow_id = ? AND operation_id = ?",
            )
            .get(row.id, input.operationId);
          if (!prior) {
            if (row.state !== "USER_REVIEW") {
              throw new CourseDesignerError(
                409,
                "invalid_workflow_transition",
                `Action requires USER_REVIEW; workflow is ${row.state}`,
              );
            }
            const proposalId = row.active_proposal_id;
            withTransaction(state.connection, () => {
              if (proposalId) {
                state.connection.sqlite
                  .prepare(
                    `UPDATE course_draft_proposals
                     SET status = 'rejected', reviewed_at = ?
                     WHERE id = ? AND status = 'proposed'`,
                  )
                  .run(Date.now(), proposalId);
              }
              const revisionRequested = input.action === "request-revision";
              row = transitionWithinTransaction(state.connection, row, {
                operationId: input.operationId,
                eventType: revisionRequested
                  ? "revision-requested"
                  : "proposal-rejected",
                toState: "CURRICULUM_PROPOSAL",
                revisionRequests: revisionRequested
                  ? [...revisions, input.revisionRequest]
                  : revisions,
                activeProposalId: null,
                payload: revisionRequested
                  ? { proposalId, revisionRequest: input.revisionRequest }
                  : { proposalId },
              });
            });
          } else {
            row = readWorkflow(state.connection, row.id);
          }
        }
        return { workflow: workflowDto(row) };
      }),
  );

  app.post(
    "/api/curriculum-editor/versions/:versionId/designer/workflows/:workflowId/retry",
    (context) =>
      route(context, async () => {
        const input = await readJson(context, workflowOperationSchema);
        const row = readWorkflow(
          state.connection,
          routeWorkflowId(context),
          routeVersionId(context),
        );
        if (!row.recovery_state) {
          throw new CourseDesignerError(
            409,
            "missing_recovery_state",
            "Failed workflow has no recovery state",
          );
        }
        return {
          workflow: workflowDto(
            transitionWorkflow(state.connection, row, "FAILED", {
              operationId: input.operationId,
              eventType: "retried",
              toState: row.recovery_state,
              payload: { recoveryState: row.recovery_state },
            }),
          ),
        };
      }),
  );

  app.post(
    "/api/curriculum-editor/versions/:versionId/designer/workflows/:workflowId/disclosures",
    (context) =>
      route(context, async () => {
        const input = await readJson(context, workflowOperationSchema);
        const versionId = routeVersionId(context);
        const row = readWorkflow(
          state.connection,
          routeWorkflowId(context),
          versionId,
        );
        if (row.state !== "CURRICULUM_PROPOSAL") {
          throw new CourseDesignerError(
            409,
            "invalid_workflow_transition",
            `Disclosure requires CURRICULUM_PROPOSAL; workflow is ${row.state}`,
          );
        }
        const graph = await new CurriculumAuthoringRepository(
          state.connection,
        ).getVersionGraph(versionId);
        assertDraft(graph);
        const workflow = workflowDto(row);
        const pendingDisclosure = pendingDesignerDisclosure(state.connection, {
          versionId,
          workflowId: workflow.id,
        });
        if (pendingDisclosure) {
          return {
            required: true as const,
            disclosure: pendingDisclosure.disclosure,
          };
        }
        return state.providerRuntime.prepareDisclosure({
          role: "course-designer",
          payload: designerPayload(graph, workflow),
          payloadCategories: ["course-content", "learner-message"],
          entityIds: {
            "course-revision": versionId,
            "course-designer-workflow": workflow.id,
            "course-designer-authoring-operation": input.operationId,
          },
          exclusions: [
            "No URL or repository source is fetched by Course Designer",
            "No learner evidence, credentials, or protected answers",
          ],
          destinationPurpose: "optional Course draft authoring assistance",
        });
      }),
  );

  app.get(
    "/api/curriculum-editor/versions/:versionId/designer/workflows/:workflowId/disclosures",
    (context) =>
      route(context, async () => {
        const versionId = routeVersionId(context);
        const row = readWorkflow(
          state.connection,
          routeWorkflowId(context),
          versionId,
        );
        return CourseDesignerPendingDisclosureResponseSchema.parse({
          pendingDisclosure:
            row.state === "CURRICULUM_PROPOSAL"
              ? pendingDesignerDisclosure(state.connection, {
                  versionId,
                  workflowId: row.id,
                })
              : null,
        });
      }),
  );

  app.post(
    "/api/curriculum-editor/versions/:versionId/designer/workflows/:workflowId/generate",
    (context) =>
      route(context, async () => {
        const input = await readJson(context, generationSchema);
        const versionId = routeVersionId(context);
        let row = readWorkflow(
          state.connection,
          routeWorkflowId(context),
          versionId,
        );
        const existingProposal = state.connection.sqlite
          .prepare(
            `SELECT * FROM course_draft_proposals
             WHERE version_id = ? AND authoring_operation_id = ?`,
          )
          .get(versionId, input.operationId) as ProposalRow | undefined;
        if (
          existingProposal &&
          row.state === "USER_REVIEW" &&
          row.active_proposal_id === existingProposal.id
        ) {
          return {
            workflow: workflowDto(row),
            proposal: proposalDto(state.connection, existingProposal),
          };
        }
        if (row.state !== "CURRICULUM_PROPOSAL") {
          throw new CourseDesignerError(
            409,
            "invalid_workflow_transition",
            `Generation requires CURRICULUM_PROPOSAL; workflow is ${row.state}`,
          );
        }
        if (existingProposal) {
          throw new CourseDesignerError(
            409,
            "incomplete_provider_operation",
            "This authoring operation did not complete attribution; retry with a new operation ID",
          );
        }
        const repository = new CurriculumAuthoringRepository(state.connection);
        const graph = await repository.getVersionGraph(versionId);
        assertDraft(graph);
        const workflow = workflowDto(row);
        const payload = designerPayload(graph, workflow);
        try {
          const prompt = getLatestPrompt("course-designer");
          const dispatch = await state.providerRuntime.resolveDispatch({
            role: "course-designer",
            payload,
            signal: context.req.raw.signal,
            ...(input.disclosureOperationId
              ? { disclosureOperationId: input.disclosureOperationId }
              : {}),
            metadata: {
              authoringOperationId: input.operationId,
              workflowId: workflow.id,
              versionId,
              draftHash: authoringDraftHash(graph),
              promptTemplateId: prompt.id,
              promptTemplateVersion: prompt.version,
            },
          });
          const turn = await runDesignerTurn(
            state,
            dispatch,
            graph,
            workflow,
            input.operationId,
            context.req.raw.signal,
          );
          const { proposal } = turn;
          try {
            await state.beforeProposalCommit?.();
            context.req.raw.signal.throwIfAborted();
            const parsedProposal = CourseDraftProposalSchema.parse(
              parseJson(proposal.proposal_json),
            );
            const validation = validateProposal(graph, parsedProposal);
            withTransaction(state.connection, () => {
              state.providerRuntime.assertDispatchCommitAllowed(dispatch);
              context.req.raw.signal.throwIfAborted();
              persistAttribution(state.connection, {
                proposal,
                workflow,
                dispatch,
                graph,
              });
              row = transitionWithinTransaction(state.connection, row, {
                operationId: input.operationId,
                eventType: "proposal-generated",
                toState: "USER_REVIEW",
                activeProposalId: proposal.id,
                payload: {
                  proposalId: proposal.id,
                  valid: validation.valid,
                  errors: validation.errors,
                  warnings: validation.warnings,
                },
              });
              state.providerRuntime.assertDispatchCommitAllowed(dispatch);
              context.req.raw.signal.throwIfAborted();
            });
            state.providerRuntime.finishDispatch(dispatch, "completed");
            return {
              workflow: workflowDto(row),
              proposal: proposalDto(state.connection, proposal),
            };
          } catch (error) {
            if (context.req.raw.signal.aborted) {
              state.connection.sqlite
                .prepare(
                  `DELETE FROM course_draft_proposals
                   WHERE id = ? AND status = 'proposed'
                     AND NOT EXISTS (
                       SELECT 1 FROM course_draft_proposal_attribution
                       WHERE proposal_id = course_draft_proposals.id
                     )`,
                )
                .run(proposal.id);
              state.providerRuntime.finishDispatch(
                dispatch,
                "cancelled",
                "cancelled",
              );
            } else {
              state.providerRuntime.finishDispatch(
                dispatch,
                "failed",
                providerFailureCode(error),
              );
            }
            throw error;
          }
        } catch (error) {
          if (!context.req.raw.signal.aborted) {
            failWorkflow(
              state.connection,
              row,
              input.operationId,
              "CURRICULUM_PROPOSAL",
              error,
            );
          }
          throw error;
        }
      }),
  );

  app.get(
    "/api/curriculum-editor/versions/:versionId/designer/proposals",
    (context) =>
      route(context, async () => {
        const rows = state.connection.sqlite
          .prepare(
            `SELECT * FROM course_draft_proposals
             WHERE version_id = ? ORDER BY created_at DESC, id`,
          )
          .all(routeVersionId(context)) as unknown as ProposalRow[];
        return {
          proposals: rows.map((row) => proposalDto(state.connection, row)),
        };
      }),
  );

  app.post(
    "/api/curriculum-editor/versions/:versionId/designer/workflows/:workflowId/proposals/:proposalId/apply",
    (context) =>
      route(context, async () => {
        const input = await readJson(context, workflowOperationSchema);
        const versionId = routeVersionId(context);
        let workflow = readWorkflow(
          state.connection,
          routeWorkflowId(context),
          versionId,
        );
        const prior = state.connection.sqlite
          .prepare(
            "SELECT 1 FROM course_designer_events WHERE workflow_id = ? AND operation_id = ?",
          )
          .get(workflow.id, input.operationId);
        const proposalId = routeProposalId(context);
        const row = state.connection.sqlite
          .prepare(
            `SELECT * FROM course_draft_proposals
             WHERE id = ? AND version_id = ?`,
          )
          .get(proposalId, versionId) as ProposalRow | undefined;
        if (!row) {
          throw new CourseDesignerError(
            404,
            "not_found",
            "Proposal was not found",
          );
        }
        if (prior) {
          return {
            workflow: workflowDto(readWorkflow(state.connection, workflow.id)),
            proposal: proposalDto(state.connection, row),
            curriculum: await new CurriculumAuthoringRepository(
              state.connection,
            ).getVersionGraph(versionId),
          };
        }
        if (
          workflow.state !== "COMPILATION" ||
          workflow.active_proposal_id !== proposalId
        ) {
          throw new CourseDesignerError(
            409,
            "invalid_workflow_transition",
            "The active proposal must be explicitly confirmed before compilation",
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
        const graph = await repository.getVersionGraph(versionId);
        assertDraft(graph);
        if (authoringDraftHash(graph) !== row.base_draft_hash) {
          throw new CourseDesignerError(
            409,
            "stale_proposal",
            "Course draft changed after this proposal was created",
          );
        }
        const proposal = CourseDraftProposalSchema.parse(
          parseJson(row.proposal_json),
        );
        const proposalValidation = validateProposal(graph, proposal);
        if (!proposalValidation.valid) {
          throw new CourseDesignerError(
            409,
            "invalid_proposal",
            "Proposal contains invalid stable targets or parent references",
          );
        }

        try {
          const result = withTransaction(state.connection, () => {
            for (const change of proposal.changes) {
              applyChange(repository, versionId, change);
            }
            state.connection.sqlite
              .prepare(
                `UPDATE course_draft_proposals
                 SET status = 'applied', reviewed_at = ?
                 WHERE id = ? AND status = 'proposed'`,
              )
              .run(Date.now(), row.id);
            const curriculum = repository.getVersionGraph(versionId);
            const report = authoringValidationReport(curriculum);
            workflow = transitionWithinTransaction(state.connection, workflow, {
              operationId: input.operationId,
              eventType: "proposal-compiled",
              toState: "VALIDATION",
              payload: {
                proposalId,
                validationHash: report.validationHash,
                valid: report.valid,
                errors: report.errors,
                warnings: report.warnings,
              },
            });
            return { curriculum, report };
          });
          const updated = state.connection.sqlite
            .prepare("SELECT * FROM course_draft_proposals WHERE id = ?")
            .get(row.id) as unknown as ProposalRow;
          return {
            workflow: workflowDto(workflow),
            proposal: proposalDto(state.connection, updated),
            curriculum: result.curriculum,
            validation: result.report,
          };
        } catch (error) {
          failWorkflow(
            state.connection,
            workflow,
            input.operationId,
            "COMPILATION",
            error,
          );
          throw error;
        }
      }),
  );
}
