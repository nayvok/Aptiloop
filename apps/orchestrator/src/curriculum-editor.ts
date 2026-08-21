import { createHash } from "node:crypto";

import {
  CourseIdentityConflictError,
  CurriculumAuthoringRepository,
  hashCanonicalJson,
  withTransaction,
  type CurriculumVersionGraph,
  type DatabaseConnection,
} from "@aptiloop/database";
import {
  resolveExplicitUnitDefinitions,
  validateActivityGraph,
} from "@aptiloop/learning-core";
import {
  CurriculumSourceSchema,
  CurriculumUnitSchema,
  CourseLocaleSchema,
  DepthLevelSchema,
  UnitChecklistItemSchema,
  UnitCompletionCriterionSchema,
  UnitPayloadSchema,
  UnitQuestionSchema,
  UnitTypeSchema,
  UnitUnlockRuleSchema,
} from "@aptiloop/shared";
import type { Context, Hono } from "hono";
import { z } from "zod";
import { authoringDraftHash } from "./authoring-draft-hash.js";
import {
  isPersonalAdaptation,
  publishPersonalAdaptation,
} from "./personal-adaptations.js";

export { authoringDraftHash } from "./authoring-draft-hash.js";

export interface CurriculumEditorState {
  connection: DatabaseConnection;
}

const idSchema = z.string().trim().min(1).max(200);
const operationIdSchema = z.string().trim().min(1).max(200);
const shortTextSchema = z.string().trim().min(1).max(500);
const descriptionSchema = z.string().trim().max(10_000).nullable();
const textListSchema = z.array(shortTextSchema).max(500);

const createDraftSchema = z
  .object({
    operationId: operationIdSchema,
    curriculum: z
      .object({
        id: idSchema,
        slug: z
          .string()
          .trim()
          .min(1)
          .max(200)
          .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
        title: shortTextSchema,
        description: descriptionSchema.optional(),
        primaryLocale: CourseLocaleSchema,
      })
      .strict(),
    title: shortTextSchema,
    description: descriptionSchema.optional(),
  })
  .strict();

const cloneSchema = z
  .object({
    operationId: operationIdSchema,
    title: shortTextSchema.optional(),
    description: descriptionSchema.optional(),
  })
  .strict();

const addWeekSchema = z
  .object({
    operationId: operationIdSchema,
    stableId: idSchema,
    title: shortTextSchema,
    description: descriptionSchema.optional(),
    orderIndex: z.number().int().nonnegative().optional(),
  })
  .strict();

const updateWeekSchema = z
  .object({
    operationId: operationIdSchema,
    stableId: idSchema.optional(),
    title: shortTextSchema.optional(),
    description: descriptionSchema.optional(),
  })
  .strict()
  .refine((input) => Object.keys(input).some((key) => key !== "operationId"), {
    message: "At least one week field is required",
  });

const addDaySchema = z
  .object({
    operationId: operationIdSchema,
    stableId: idSchema,
    title: shortTextSchema,
    description: descriptionSchema.optional(),
    goal: z.string().trim().min(1).max(10_000),
    estimatedMinutes: z.number().int().min(1).max(10_000),
    prerequisites: textListSchema.optional(),
    expectedOutcomes: textListSchema.optional(),
    depthLevel: DepthLevelSchema,
    outOfScope: textListSchema.optional(),
    topics: textListSchema.optional(),
    orderIndex: z.number().int().nonnegative().optional(),
  })
  .strict();

const updateDaySchema = z
  .object({
    operationId: operationIdSchema,
    stableId: idSchema.optional(),
    title: shortTextSchema.optional(),
    description: descriptionSchema.optional(),
    goal: z.string().trim().min(1).max(10_000).optional(),
    estimatedMinutes: z.number().int().min(1).max(10_000).optional(),
    prerequisites: textListSchema.optional(),
    expectedOutcomes: textListSchema.optional(),
    depthLevel: DepthLevelSchema.optional(),
    outOfScope: textListSchema.optional(),
    topics: textListSchema.optional(),
  })
  .strict()
  .refine((input) => Object.keys(input).some((key) => key !== "operationId"), {
    message: "At least one day field is required",
  });

const addUnitSchema = z
  .object({
    operationId: operationIdSchema,
    stableId: idSchema,
    type: UnitTypeSchema,
    title: shortTextSchema,
    description: descriptionSchema.optional(),
    estimatedMinutes: z.number().int().min(1).max(10_000).nullable().optional(),
    objectives: textListSchema.optional(),
    checklist: z.array(UnitChecklistItemSchema).max(500).optional(),
    sources: z.array(CurriculumSourceSchema).max(500).optional(),
    questions: z.array(UnitQuestionSchema).max(500).optional(),
    misconceptions: textListSchema.optional(),
    referenceAnswer: z.string().trim().min(1).max(50_000).nullable().optional(),
    completionCriteria: z.array(UnitCompletionCriterionSchema).min(1).max(50),
    unlockRules: z.array(UnitUnlockRuleSchema).max(500).optional(),
    optional: z.boolean().optional(),
    depthLevel: DepthLevelSchema.nullable().optional(),
    payload: UnitPayloadSchema,
    orderIndex: z.number().int().nonnegative().optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.type !== input.payload.type) {
      context.addIssue({
        code: "custom",
        path: ["payload", "type"],
        message: "Unit payload type must match unit type",
      });
    }
  });

const updateUnitSchema = z
  .object({
    operationId: operationIdSchema,
    stableId: idSchema.optional(),
    type: UnitTypeSchema.optional(),
    title: shortTextSchema.optional(),
    description: descriptionSchema.optional(),
    estimatedMinutes: z.number().int().min(1).max(10_000).nullable().optional(),
    objectives: textListSchema.optional(),
    checklist: z.array(UnitChecklistItemSchema).max(500).optional(),
    sources: z.array(CurriculumSourceSchema).max(500).optional(),
    questions: z.array(UnitQuestionSchema).max(500).optional(),
    misconceptions: textListSchema.optional(),
    referenceAnswer: z.string().trim().min(1).max(50_000).nullable().optional(),
    completionCriteria: z
      .array(UnitCompletionCriterionSchema)
      .min(1)
      .max(50)
      .optional(),
    unlockRules: z.array(UnitUnlockRuleSchema).max(500).optional(),
    optional: z.boolean().optional(),
    depthLevel: DepthLevelSchema.nullable().optional(),
    payload: UnitPayloadSchema.optional(),
  })
  .strict()
  .refine((input) => Object.keys(input).some((key) => key !== "operationId"), {
    message: "At least one unit field is required",
  });

const reorderSchema = z
  .object({
    operationId: operationIdSchema,
    orderedIds: z.array(idSchema).max(500),
  })
  .strict()
  .superRefine((input, context) => {
    if (new Set(input.orderedIds).size !== input.orderedIds.length) {
      context.addIssue({
        code: "custom",
        path: ["orderedIds"],
        message: "Ordered IDs must be unique",
      });
    }
  });

const mutationSchema = z.object({ operationId: operationIdSchema }).strict();
const publishSchema = mutationSchema
  .extend({
    validationHash: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
    changeReviewHash: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
    previewHash: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
  })
  .strict();

interface AuthoringDiagnostic {
  readonly code: string;
  readonly severity: "error" | "warning";
  readonly path: string;
  readonly message: string;
}

export interface AuthoringValidationReport {
  readonly validatorVersion: "m9-v1";
  readonly versionId: string;
  readonly draftHash: string;
  readonly validationHash: string;
  readonly valid: boolean;
  readonly errors: number;
  readonly warnings: number;
  readonly diagnostics: readonly AuthoringDiagnostic[];
}

interface AuthoringChangeReview {
  readonly versionId: string;
  readonly parentVersionId: string | null;
  readonly draftHash: string;
  readonly changeReviewHash: string;
  readonly added: number;
  readonly changed: number;
  readonly removed: number;
  readonly changes: readonly AuthoringChange[];
  readonly ready: boolean;
}

interface AuthoringChange {
  readonly operation: "added" | "changed" | "removed";
  readonly entityType: "week" | "day" | "unit";
  readonly stableId: string;
}

class EditorError extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function deterministicIds(operationId: string, scope: string): () => string {
  let index = 0;
  return () =>
    `ce-${createHash("sha256")
      .update(`${scope}\0${operationId}\0${index++}`)
      .digest("hex")
      .slice(0, 40)}`;
}

interface BoundOperationIds {
  readonly resultId: string;
  readonly resultPrefix: string;
  readonly ids: () => string;
}

function boundOperationIds(
  operationId: string,
  scope: string,
  requestIdentity: unknown,
): BoundOperationIds {
  const operationHash = createHash("sha256")
    .update(`${scope}\0${operationId}`)
    .digest("hex")
    .slice(0, 40);
  const requestHash = hashCanonicalJson(requestIdentity);
  const resultPrefix = `ceo-${operationHash}-`;
  const resultId = `${resultPrefix}${requestHash}`;
  let index = 0;
  return {
    resultId,
    resultPrefix,
    ids: () => {
      const current = index++;
      if (current === 0) return resultId;
      return `ce-${createHash("sha256")
        .update(`${scope}\0${operationId}\0${requestHash}\0${current}`)
        .digest("hex")
        .slice(0, 40)}`;
    },
  };
}

async function readBody<T>(context: Context, schema: z.ZodType<T>): Promise<T> {
  let value: unknown;
  try {
    value = await context.req.json();
  } catch {
    throw new EditorError(
      400,
      "invalid_json",
      "Request body must be valid JSON",
    );
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new EditorError(400, "invalid_request", "Request body is invalid");
  }
  return parsed.data;
}

function routeId(context: Context, name: string): string {
  const parsed = idSchema.safeParse(context.req.param(name));
  if (!parsed.success) {
    throw new EditorError(
      400,
      "invalid_request",
      "Route identifier is invalid",
    );
  }
  return parsed.data;
}

function editorRepository(
  state: CurriculumEditorState,
  operationId?: string,
  scope?: string,
): CurriculumAuthoringRepository {
  return new CurriculumAuthoringRepository(
    state.connection,
    operationId && scope
      ? { id: deterministicIds(operationId, scope) }
      : undefined,
  );
}

function versionStatus(
  connection: DatabaseConnection,
  versionId: string,
): "draft" | "published" | "archived" | null {
  const row = connection.sqlite
    .prepare("SELECT status FROM curriculum_versions WHERE id = ?")
    .get(versionId) as
    { status: "draft" | "published" | "archived" } | undefined;
  return row?.status ?? null;
}

function priorBoundOperationResult(
  connection: DatabaseConnection,
  binding: BoundOperationIds,
  legacyResultId: string,
): string | null {
  if (versionStatus(connection, legacyResultId)) return legacyResultId;
  const rows = connection.sqlite
    .prepare(
      `SELECT id FROM curriculum_versions
       WHERE id LIKE ? ORDER BY id`,
    )
    .all(`${binding.resultPrefix}%`) as Array<{ id: string }>;
  if (rows.length === 0) return null;
  if (rows.length !== 1 || rows[0]?.id !== binding.resultId) {
    throw new EditorError(
      409,
      "operation_conflict",
      "Operation ID was already used for a different authoring request",
    );
  }
  return binding.resultId;
}

function assertDraft(connection: DatabaseConnection, versionId: string): void {
  const status = versionStatus(connection, versionId);
  if (!status)
    throw new EditorError(404, "not_found", "Curriculum version was not found");
  if (status !== "draft") {
    throw new EditorError(
      409,
      "immutable_version",
      "Published curriculum versions cannot be edited",
    );
  }
}

function assertOwnedEntity(
  connection: DatabaseConnection,
  table: "curriculum_weeks" | "curriculum_days_v2" | "curriculum_units",
  id: string,
  versionId: string,
): void {
  const row = connection.sqlite
    .prepare(`SELECT version_id FROM ${table} WHERE id = ?`)
    .get(id) as { version_id: string } | undefined;
  if (!row || row.version_id !== versionId) {
    throw new EditorError(404, "not_found", "Curriculum item was not found");
  }
}

function updateEntity(
  connection: DatabaseConnection,
  table: "curriculum_weeks" | "curriculum_days_v2" | "curriculum_units",
  id: string,
  versionId: string,
  updates: ReadonlyArray<
    readonly [column: string, value: string | number | null]
  >,
): void {
  assertDraft(connection, versionId);
  assertOwnedEntity(connection, table, id, versionId);
  if (!updates.length) return;
  const assignments = updates.map(([column]) => `${column} = ?`).join(", ");
  connection.sqlite
    .prepare(
      `UPDATE ${table} SET ${assignments}, updated_at = ? WHERE id = ? AND version_id = ?`,
    )
    .run(...updates.map(([, value]) => value), Date.now(), id, versionId);
}

function deleteEntity(
  connection: DatabaseConnection,
  table: "curriculum_weeks" | "curriculum_days_v2" | "curriculum_units",
  id: string,
  versionId: string,
): void {
  assertDraft(connection, versionId);
  assertOwnedEntity(connection, table, id, versionId);
  connection.sqlite
    .prepare(`DELETE FROM ${table} WHERE id = ? AND version_id = ?`)
    .run(id, versionId);
}

function assertGraphContracts(graph: CurriculumVersionGraph): void {
  for (const week of graph.weeks) {
    for (const day of week.days) {
      const definitions = resolveExplicitUnitDefinitions(
        day.units.map((unit) => ({
          id: unit.id,
          stableId: unit.stableId,
          optional: unit.optional,
          prerequisiteStableIds: UnitUnlockRuleSchema.array()
            .parse(unit.unlockRules)
            .map((rule) => rule.unitId),
        })),
      );
      const prerequisiteIdsByActivityId = new Map(
        definitions.map((definition) => [
          definition.id,
          definition.prerequisiteUnitIds ?? [],
        ]),
      );
      for (const unit of day.units) {
        CurriculumUnitSchema.parse({
          id: unit.id,
          stableId: unit.stableId,
          type: unit.type,
          order: unit.orderIndex + 1,
          title: unit.title,
          description: unit.description ?? unit.title,
          estimatedMinutes: unit.estimatedMinutes ?? 0,
          objectives: unit.objectives,
          checklist: unit.checklist,
          sources: unit.sources,
          questions: unit.questions,
          misconceptions: unit.misconceptions,
          referenceAnswer: unit.referenceAnswer,
          completionCriteria: unit.completionCriteria,
          unlockRules: unit.unlockRules,
          optional: unit.optional,
          depthLevel: unit.depthLevel ?? "foundation",
          payload: unit.payload,
        });
      }
      const validation = validateActivityGraph(
        {
          courseId: graph.version.curriculumId,
          revisionId: graph.version.id,
          lessonId: day.id,
          entryActivityIds: definitions
            .filter(
              (definition) =>
                (definition.prerequisiteUnitIds?.length ?? 0) === 0,
            )
            .map((definition) => definition.id),
          activities: day.units.map((unit) => ({
            id: unit.id,
            stableId: unit.stableId,
            courseId: graph.version.curriculumId,
            revisionId: graph.version.id,
            lessonId: day.id,
            type: unit.type,
            required: !unit.optional,
            prerequisiteActivityIds:
              prerequisiteIdsByActivityId.get(unit.id) ?? [],
          })),
        },
        UnitTypeSchema.options,
      );
      if (!validation.valid) {
        throw new Error(
          `Activity graph is invalid: ${validation.issues
            .map((issue) => issue.code)
            .join(", ")}`,
        );
      }
    }
  }
}

function updateUnitAndValidate(
  state: CurriculumEditorState,
  versionId: string,
  mutation: () => void,
): CurriculumVersionGraph {
  return withTransaction(state.connection, () => {
    mutation();
    const graph = editorRepository(state).getVersionGraph(versionId);
    assertGraphContracts(graph);
    return toEditorDto(graph);
  });
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

function toEditorDto<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => toEditorDto(item)) as T;
  }
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== "primaryLocale" && !key.endsWith("Json"))
      .map(([key, nested]) => [key, toEditorDto(nested)]),
  ) as T;
}
function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function authoringValidationReport(
  graph: CurriculumVersionGraph,
): AuthoringValidationReport {
  const diagnostics: AuthoringDiagnostic[] = [];
  if (graph.version.status !== "draft") {
    diagnostics.push({
      code: "immutable_revision",
      severity: "error",
      path: "version.status",
      message: "Only a draft revision can enter the release pipeline",
    });
  }
  if (graph.weeks.length === 0) {
    diagnostics.push({
      code: "missing_week",
      severity: "error",
      path: "weeks",
      message: "At least one week is required",
    });
  }
  graph.weeks.forEach((week, weekIndex) => {
    if (week.days.length === 0) {
      diagnostics.push({
        code: "missing_day",
        severity: "error",
        path: `weeks[${weekIndex}].days`,
        message: "Every week requires at least one day",
      });
    }
    week.days.forEach((day, dayIndex) => {
      const path = `weeks[${weekIndex}].days[${dayIndex}]`;
      if (day.units.length === 0) {
        diagnostics.push({
          code: "missing_activity",
          severity: "error",
          path: `${path}.units`,
          message: "Every day requires at least one activity",
        });
      }
      if (day.expectedOutcomes.length === 0) {
        diagnostics.push({
          code: "missing_expected_outcome",
          severity: "warning",
          path: `${path}.expectedOutcomes`,
          message: "No learner outcome is declared",
        });
      }
      day.units.forEach((unit, unitIndex) => {
        if (unit.completionCriteria.length === 0) {
          diagnostics.push({
            code: "missing_completion_criterion",
            severity: "error",
            path: `${path}.units[${unitIndex}].completionCriteria`,
            message: "Every activity requires a completion criterion",
          });
        }
      });
    });
  });
  try {
    assertGraphContracts(graph);
  } catch (error) {
    diagnostics.push({
      code: "invalid_activity_graph",
      severity: "error",
      path: "weeks",
      message:
        error instanceof Error ? error.message : "Activity graph is invalid",
    });
  }
  const draftHash = authoringDraftHash(graph);
  const errors = diagnostics.filter(
    ({ severity }) => severity === "error",
  ).length;
  const warnings = diagnostics.length - errors;
  const reportBody = {
    validatorVersion: "m9-v1" as const,
    versionId: graph.version.id,
    draftHash,
    valid: errors === 0,
    errors,
    warnings,
    diagnostics,
  };
  return {
    ...reportBody,
    validationHash: sha256(JSON.stringify(reportBody)),
  };
}

function markDesignerWorkflowsPublished(
  connection: DatabaseConnection,
  versionId: string,
  operationId: string,
): void {
  const rows = connection.sqlite
    .prepare(
      `SELECT id FROM course_designer_workflows
       WHERE version_id = ? AND state = 'VALIDATION'`,
    )
    .all(versionId) as unknown as Array<{ id: string }>;
  if (rows.length === 0) return;
  const now = Date.now();
  withTransaction(connection, () => {
    const update = connection.sqlite.prepare(
      `UPDATE course_designer_workflows
       SET state = 'PUBLISHED', recovery_state = NULL, updated_at = ?
       WHERE id = ? AND state = 'VALIDATION'`,
    );
    const insert = connection.sqlite.prepare(
      `INSERT OR IGNORE INTO course_designer_events
       (workflow_id, operation_id, event_type, from_state, to_state,
        payload_json, created_at)
       VALUES (?, ?, 'published', 'VALIDATION', 'PUBLISHED', ?, ?)`,
    );
    for (const row of rows) {
      if (update.run(now, row.id).changes === 1) {
        insert.run(
          row.id,
          `publish:${operationId}`,
          JSON.stringify({ versionId }),
          now,
        );
      }
    }
  });
}

function comparableAuthoringEntities(
  graph: CurriculumVersionGraph,
): ReadonlyMap<string, string> {
  const entities = new Map<string, string>();
  for (const week of graph.weeks) {
    entities.set(
      `week:${week.stableId}`,
      JSON.stringify({ title: week.title, description: week.description }),
    );
    for (const day of week.days) {
      entities.set(
        `day:${day.stableId}`,
        JSON.stringify({
          title: day.title,
          description: day.description,
          goal: day.goal,
          estimatedMinutes: day.estimatedMinutes,
          prerequisites: day.prerequisites,
          expectedOutcomes: day.expectedOutcomes,
          depthLevel: day.depthLevel,
          outOfScope: day.outOfScope,
          topics: day.topics,
        }),
      );
      for (const unit of day.units) {
        entities.set(
          `unit:${unit.stableId}`,
          JSON.stringify({
            type: unit.type,
            title: unit.title,
            description: unit.description,
            estimatedMinutes: unit.estimatedMinutes,
            objectives: unit.objectives,
            checklist: unit.checklist,
            sources: unit.sources,
            questions: unit.questions,
            misconceptions: unit.misconceptions,
            referenceAnswer: unit.referenceAnswer,
            completionCriteria: unit.completionCriteria,
            unlockRules: unit.unlockRules,
            optional: unit.optional,
            depthLevel: unit.depthLevel,
            payload: unit.payload,
          }),
        );
      }
    }
  }
  return entities;
}

async function authoringChangeReview(
  repository: CurriculumAuthoringRepository,
  graph: CurriculumVersionGraph,
): Promise<AuthoringChangeReview> {
  const current = comparableAuthoringEntities(graph);
  const parent = graph.version.parentVersionId
    ? comparableAuthoringEntities(
        await repository.getVersionGraph(graph.version.parentVersionId),
      )
    : new Map<string, string>();
  const changes: AuthoringChange[] = [];
  const describe = (
    key: string,
    operation: AuthoringChange["operation"],
  ): AuthoringChange => {
    const separator = key.indexOf(":");
    const entityType = key.slice(0, separator);
    const stableId = key.slice(separator + 1);
    if (
      (entityType !== "week" &&
        entityType !== "day" &&
        entityType !== "unit") ||
      !stableId
    ) {
      throw new Error("Authoring change identity is invalid");
    }
    return { operation, entityType, stableId };
  };
  for (const [key, value] of current) {
    if (!parent.has(key)) changes.push(describe(key, "added"));
    else if (parent.get(key) !== value) changes.push(describe(key, "changed"));
  }
  for (const key of parent.keys()) {
    if (!current.has(key)) changes.push(describe(key, "removed"));
  }
  changes.sort(
    (left, right) =>
      (left.entityType < right.entityType
        ? -1
        : left.entityType > right.entityType
          ? 1
          : 0) ||
      (left.stableId < right.stableId
        ? -1
        : left.stableId > right.stableId
          ? 1
          : 0) ||
      (left.operation < right.operation
        ? -1
        : left.operation > right.operation
          ? 1
          : 0),
  );
  const draftHash = authoringDraftHash(graph);
  const reviewBody = {
    versionId: graph.version.id,
    parentVersionId: graph.version.parentVersionId,
    draftHash,
    added: changes.filter(({ operation }) => operation === "added").length,
    changed: changes.filter(({ operation }) => operation === "changed").length,
    removed: changes.filter(({ operation }) => operation === "removed").length,
    changes,
    ready: authoringValidationReport(graph).valid,
  };
  return {
    ...reviewBody,
    changeReviewHash: sha256(JSON.stringify(reviewBody)),
  };
}

function learnerSafePreview(graph: CurriculumVersionGraph) {
  return {
    versionId: graph.version.id,
    title: graph.version.title,
    description: graph.version.description,
    draftHash: authoringDraftHash(graph),
    weeks: graph.weeks.map((week) => ({
      stableId: week.stableId,
      title: week.title,
      description: week.description,
      days: week.days.map((day) => ({
        stableId: day.stableId,
        title: day.title,
        description: day.description,
        goal: day.goal,
        estimatedMinutes: day.estimatedMinutes,
        expectedOutcomes: day.expectedOutcomes,
        topics: day.topics,
        activities: day.units.map((unit) => ({
          stableId: unit.stableId,
          type: unit.type,
          title: unit.title,
          description: unit.description,
          estimatedMinutes: unit.estimatedMinutes,
          objectives: unit.objectives,
          checklist: unit.checklist,
          sources: unit.sources,
          optional: unit.optional,
        })),
      })),
    })),
  };
}

function valuesFrom<T extends object>(
  input: T,
  mappings: ReadonlyArray<
    readonly [
      key: keyof T,
      column: string,
      encode?: (value: unknown) => unknown,
    ]
  >,
): Array<readonly [string, string | number | null]> {
  const record = input as Record<PropertyKey, unknown>;
  return mappings.flatMap(([key, column, encode]) =>
    Object.prototype.hasOwnProperty.call(record, key)
      ? [
          [
            column,
            (encode ? encode(record[key]) : record[key]) as
              string | number | null,
          ] as const,
        ]
      : [],
  );
}

async function graphOrNotFound(
  repository: CurriculumAuthoringRepository,
  versionId: string,
): Promise<CurriculumVersionGraph> {
  try {
    return await repository.getVersionGraph(versionId);
  } catch {
    throw new EditorError(404, "not_found", "Curriculum version was not found");
  }
}

async function handle(
  context: Context,
  action: () => Promise<Response>,
): Promise<Response> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof EditorError) {
      if (error.status === 400)
        return context.json(
          { error: { code: error.code, message: error.message } },
          400,
        );
      if (error.status === 404)
        return context.json(
          { error: { code: error.code, message: error.message } },
          404,
        );
      return context.json(
        { error: { code: error.code, message: error.message } },
        409,
      );
    }
    if (error instanceof CourseIdentityConflictError) {
      return context.json(
        {
          error: {
            code: "course_identity_conflict",
            message: "A Course with that ID or slug already exists",
          },
        },
        409,
      );
    }
    if (error instanceof z.ZodError) {
      return context.json(
        {
          error: {
            code: "validation_failed",
            message: "The curriculum change is not internally consistent",
          },
        },
        409,
      );
    }
    const message = error instanceof Error ? error.message : "";
    if (message.includes("immutable") || message.includes("Only a draft")) {
      return context.json(
        {
          error: {
            code: "immutable_version",
            message: "Published curriculum versions cannot be edited",
          },
        },
        409,
      );
    }
    if (
      message.includes("completion criteria") ||
      message.includes("Published curriculum requires") ||
      message.includes("Every published day") ||
      message.includes("prerequisite") ||
      message.includes("Ordered IDs")
    ) {
      return context.json(
        {
          error: {
            code: "validation_failed",
            message:
              message === "legacy lesson prerequisite is invalid"
                ? "Lesson prerequisite is invalid"
                : message,
          },
        },
        409,
      );
    }
    throw error;
  }
}

export function registerCurriculumEditorRoutes(
  app: Hono,
  state: CurriculumEditorState,
): void {
  app.get("/api/curriculum-editor/versions", (context) =>
    handle(context, async () => {
      const rows = state.connection.sqlite
        .prepare(
          `SELECT v.id, v.curriculum_id AS curriculumId, c.slug AS curriculumSlug,
                  course.primary_locale AS primaryLocale,
                  v.revision, v.parent_version_id AS parentVersionId,
                  v.branch_kind AS branchKind,
                  v.based_on_content_hash AS basedOnContentHash,
                  v.adaptation_branch_id AS adaptationBranchId, v.status,
                  v.title, v.description, v.content_hash AS contentHash,
                  v.created_at AS createdAt, v.published_at AS publishedAt,
                  v.archived_at AS archivedAt, v.updated_at AS updatedAt
           FROM curriculum_versions v
           JOIN curricula c ON c.id = v.curriculum_id
           JOIN courses course ON course.id = v.curriculum_id
           ORDER BY c.slug, v.revision DESC, v.id`,
        )
        .all();
      return context.json({ versions: rows });
    }),
  );

  app.get("/api/curriculum-editor/versions/:versionId", (context) =>
    handle(context, async () => {
      const graph = await graphOrNotFound(
        editorRepository(state),
        routeId(context, "versionId"),
      );
      return context.json({ curriculum: toEditorDto(graph) });
    }),
  );

  app.post("/api/curriculum-editor/versions", (context) =>
    handle(context, async () => {
      const input = await readBody(context, createDraftSchema);
      const scope = "create-draft";
      const binding = boundOperationIds(input.operationId, scope, {
        curriculum: {
          id: input.curriculum.id,
          slug: input.curriculum.slug,
          title: input.curriculum.title,
          description: input.curriculum.description ?? null,
          primaryLocale: input.curriculum.primaryLocale,
        },
        title: input.title,
        description: input.description ?? null,
      });
      const legacyVersionId = deterministicIds(input.operationId, scope)();
      const priorVersionId = priorBoundOperationResult(
        state.connection,
        binding,
        legacyVersionId,
      );
      const repository = new CurriculumAuthoringRepository(state.connection, {
        id: binding.ids,
      });
      if (priorVersionId) {
        return context.json({
          version: (await repository.getVersionGraph(priorVersionId)).version,
        });
      }
      const version = await repository.createDraft({
        curriculum: {
          id: input.curriculum.id,
          slug: input.curriculum.slug,
          title: input.curriculum.title,
          ...(input.curriculum.description !== undefined
            ? { description: input.curriculum.description }
            : {}),
          primaryLocale: input.curriculum.primaryLocale,
        },
        title: input.title,
        ...(input.description !== undefined
          ? { description: input.description }
          : {}),
      });
      return context.json({ version }, 201);
    }),
  );

  app.post("/api/curriculum-editor/versions/:versionId/clone", (context) =>
    handle(context, async () => {
      const input = await readBody(context, cloneSchema);
      const sourceVersionId = routeId(context, "versionId");
      const scope = `clone:${sourceVersionId}`;
      const binding = boundOperationIds(input.operationId, scope, {
        title:
          input.title === undefined
            ? { mode: "inherit" }
            : { mode: "set", value: input.title },
        description:
          input.description === undefined
            ? { mode: "inherit" }
            : { mode: "set", value: input.description },
      });
      const legacyVersionId = deterministicIds(input.operationId, scope)();
      const priorVersionId = priorBoundOperationResult(
        state.connection,
        binding,
        legacyVersionId,
      );
      const repository = new CurriculumAuthoringRepository(state.connection, {
        id: binding.ids,
      });
      if (priorVersionId) {
        return context.json({
          version: (await repository.getVersionGraph(priorVersionId)).version,
        });
      }
      const source = state.connection.sqlite
        .prepare(
          `SELECT status, branch_kind AS branchKind
           FROM curriculum_versions WHERE id = ?`,
        )
        .get(sourceVersionId) as
        | {
            status: "draft" | "published" | "archived";
            branchKind: "upstream" | "personal";
          }
        | undefined;
      if (!source) {
        throw new EditorError(
          404,
          "not_found",
          "Curriculum version was not found",
        );
      }
      if (source.status !== "published" || source.branchKind !== "upstream") {
        throw new EditorError(
          409,
          "invalid_clone_source",
          "Only a published upstream revision can be cloned into a generic Draft",
        );
      }
      const version = await repository.cloneRevision(sourceVersionId, {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined
          ? { description: input.description }
          : {}),
      });
      return context.json({ version }, 201);
    }),
  );

  app.get("/api/curriculum-editor/versions/:versionId/validation", (context) =>
    handle(context, async () => {
      const graph = await graphOrNotFound(
        editorRepository(state),
        routeId(context, "versionId"),
      );
      return context.json({ report: authoringValidationReport(graph) });
    }),
  );

  app.get("/api/curriculum-editor/versions/:versionId/preview", (context) =>
    handle(context, async () => {
      const graph = await graphOrNotFound(
        editorRepository(state),
        routeId(context, "versionId"),
      );
      return context.json({ preview: learnerSafePreview(graph) });
    }),
  );

  app.get(
    "/api/curriculum-editor/versions/:versionId/change-review",
    (context) =>
      handle(context, async () => {
        const repository = editorRepository(state);
        const graph = await graphOrNotFound(
          repository,
          routeId(context, "versionId"),
        );
        return context.json({
          review: await authoringChangeReview(repository, graph),
        });
      }),
  );

  app.post("/api/curriculum-editor/versions/:versionId/publish", (context) =>
    handle(context, async () => {
      const input = await readBody(context, publishSchema);
      const versionId = routeId(context, "versionId");
      const repository = editorRepository(state);
      const status = versionStatus(state.connection, versionId);
      if (!status)
        throw new EditorError(
          404,
          "not_found",
          "Curriculum version was not found",
        );
      const graph = await repository.getVersionGraph(versionId);
      const validation = authoringValidationReport(graph);
      const review = await authoringChangeReview(repository, graph);
      if (!validation.valid) {
        throw new EditorError(
          409,
          "validation_failed",
          "Draft validation must pass before publication",
        );
      }
      if (
        input.validationHash !== validation.validationHash ||
        input.changeReviewHash !== review.changeReviewHash ||
        input.previewHash !== validation.draftHash
      ) {
        throw new EditorError(
          409,
          "release_evidence_stale",
          "Validation and change review must match the current draft",
        );
      }
      const version =
        status === "published"
          ? graph.version
          : isPersonalAdaptation(state.connection, versionId)
            ? publishPersonalAdaptation(state.connection, versionId)
            : await repository.publishVersion(versionId);
      markDesignerWorkflowsPublished(
        state.connection,
        versionId,
        input.operationId,
      );
      return context.json({ version });
    }),
  );

  app.post("/api/curriculum-editor/versions/:versionId/weeks", (context) =>
    handle(context, async () => {
      const input = await readBody(context, addWeekSchema);
      const versionId = routeId(context, "versionId");
      const scope = `add-week:${versionId}`;
      const repository = editorRepository(state, input.operationId, scope);
      const id = deterministicIds(input.operationId, scope)();
      const existing = state.connection.sqlite
        .prepare(
          "SELECT id FROM curriculum_weeks WHERE id = ? AND version_id = ?",
        )
        .get(id, versionId);
      if (existing) {
        const graph = toEditorDto(await repository.getVersionGraph(versionId));
        return context.json({
          week: graph.weeks.find((week) => week.id === id),
        });
      }
      const week = await repository.addWeek({
        versionId,
        stableId: input.stableId,
        title: input.title,
        ...(input.description !== undefined
          ? { description: input.description }
          : {}),
        ...(input.orderIndex !== undefined
          ? { orderIndex: input.orderIndex }
          : {}),
      });
      return context.json({ week }, 201);
    }),
  );

  app.patch(
    "/api/curriculum-editor/versions/:versionId/weeks/:weekId",
    (context) =>
      handle(context, async () => {
        const input = await readBody(context, updateWeekSchema);
        const versionId = routeId(context, "versionId");
        const weekId = routeId(context, "weekId");
        updateEntity(
          state.connection,
          "curriculum_weeks",
          weekId,
          versionId,
          valuesFrom(input, [
            ["stableId", "stable_id"],
            ["title", "title"],
            ["description", "description"],
          ]),
        );
        const graph = toEditorDto(
          await editorRepository(state).getVersionGraph(versionId),
        );
        return context.json({
          week: graph.weeks.find((week) => week.id === weekId),
        });
      }),
  );

  app.delete(
    "/api/curriculum-editor/versions/:versionId/weeks/:weekId",
    (context) =>
      handle(context, async () => {
        await readBody(context, mutationSchema);
        deleteEntity(
          state.connection,
          "curriculum_weeks",
          routeId(context, "weekId"),
          routeId(context, "versionId"),
        );
        return context.json({ deleted: true });
      }),
  );

  app.post(
    "/api/curriculum-editor/versions/:versionId/weeks/reorder",
    (context) =>
      handle(context, async () => {
        const input = await readBody(context, reorderSchema);
        const versionId = routeId(context, "versionId");
        await editorRepository(state).reorderWeeks({
          versionId,
          orderedWeekIds: input.orderedIds,
        });
        return context.json({
          curriculum: toEditorDto(
            await editorRepository(state).getVersionGraph(versionId),
          ),
        });
      }),
  );

  app.post(
    "/api/curriculum-editor/versions/:versionId/weeks/:weekId/days",
    (context) =>
      handle(context, async () => {
        const input = await readBody(context, addDaySchema);
        const versionId = routeId(context, "versionId");
        const weekId = routeId(context, "weekId");
        const scope = `add-day:${versionId}:${weekId}`;
        const repository = editorRepository(state, input.operationId, scope);
        const id = deterministicIds(input.operationId, scope)();
        const existing = state.connection.sqlite
          .prepare(
            "SELECT id FROM curriculum_days_v2 WHERE id = ? AND version_id = ?",
          )
          .get(id, versionId);
        if (existing) {
          const graph = toEditorDto(
            await repository.getVersionGraph(versionId),
          );
          return context.json({
            day: graph.weeks
              .flatMap((week) => week.days)
              .find((day) => day.id === id),
          });
        }
        await repository.addDay({
          versionId,
          weekId,
          stableId: input.stableId,
          title: input.title,
          goal: input.goal,
          estimatedMinutes: input.estimatedMinutes,
          depthLevel: input.depthLevel,
          ...(input.description !== undefined
            ? { description: input.description }
            : {}),
          ...(input.prerequisites !== undefined
            ? { prerequisites: input.prerequisites }
            : {}),
          ...(input.expectedOutcomes !== undefined
            ? { expectedOutcomes: input.expectedOutcomes }
            : {}),
          ...(input.outOfScope !== undefined
            ? { outOfScope: input.outOfScope }
            : {}),
          ...(input.topics !== undefined ? { topics: input.topics } : {}),
          ...(input.orderIndex !== undefined
            ? { orderIndex: input.orderIndex }
            : {}),
        });
        const graph = toEditorDto(await repository.getVersionGraph(versionId));
        const day = graph.weeks
          .flatMap((week) => week.days)
          .find((item) => item.id === id);
        if (!day) throw new Error("Created curriculum day was not found");
        return context.json({ day }, 201);
      }),
  );

  app.patch(
    "/api/curriculum-editor/versions/:versionId/days/:dayId",
    (context) =>
      handle(context, async () => {
        const input = await readBody(context, updateDaySchema);
        const versionId = routeId(context, "versionId");
        const dayId = routeId(context, "dayId");
        updateEntity(
          state.connection,
          "curriculum_days_v2",
          dayId,
          versionId,
          valuesFrom(input, [
            ["stableId", "stable_id"],
            ["title", "title"],
            ["description", "description"],
            ["goal", "goal"],
            ["estimatedMinutes", "estimated_minutes"],
            ["prerequisites", "prerequisites_json", json],
            ["expectedOutcomes", "expected_outcomes_json", json],
            ["depthLevel", "depth_level"],
            ["outOfScope", "out_of_scope_json", json],
            ["topics", "topics_json", json],
          ]),
        );
        const graph = toEditorDto(
          await editorRepository(state).getVersionGraph(versionId),
        );
        return context.json({
          day: graph.weeks
            .flatMap((week) => week.days)
            .find((day) => day.id === dayId),
        });
      }),
  );

  app.delete(
    "/api/curriculum-editor/versions/:versionId/days/:dayId",
    (context) =>
      handle(context, async () => {
        await readBody(context, mutationSchema);
        deleteEntity(
          state.connection,
          "curriculum_days_v2",
          routeId(context, "dayId"),
          routeId(context, "versionId"),
        );
        return context.json({ deleted: true });
      }),
  );

  app.post(
    "/api/curriculum-editor/versions/:versionId/weeks/:weekId/days/reorder",
    (context) =>
      handle(context, async () => {
        const input = await readBody(context, reorderSchema);
        const versionId = routeId(context, "versionId");
        const weekId = routeId(context, "weekId");
        await editorRepository(state).reorderDays({
          versionId,
          weekId,
          orderedDayIds: input.orderedIds,
        });
        return context.json({
          curriculum: toEditorDto(
            await editorRepository(state).getVersionGraph(versionId),
          ),
        });
      }),
  );

  app.post(
    "/api/curriculum-editor/versions/:versionId/days/:dayId/units",
    (context) =>
      handle(context, async () => {
        const input = await readBody(context, addUnitSchema);
        const versionId = routeId(context, "versionId");
        const dayId = routeId(context, "dayId");
        const scope = `add-unit:${versionId}:${dayId}`;
        const repository = editorRepository(state, input.operationId, scope);
        const id = deterministicIds(input.operationId, scope)();
        const existing = state.connection.sqlite
          .prepare(
            "SELECT id FROM curriculum_units WHERE id = ? AND version_id = ?",
          )
          .get(id, versionId);
        if (existing) {
          const graph = toEditorDto(
            await repository.getVersionGraph(versionId),
          );
          return context.json({
            unit: graph.weeks
              .flatMap((week) => week.days)
              .flatMap((day) => day.units)
              .find((unit) => unit.id === id),
          });
        }
        await repository.addUnit({
          versionId,
          dayId,
          stableId: input.stableId,
          type: input.type,
          title: input.title,
          completionCriteria: input.completionCriteria,
          ...(input.description !== undefined
            ? { description: input.description }
            : {}),
          ...(input.estimatedMinutes !== undefined
            ? { estimatedMinutes: input.estimatedMinutes }
            : {}),
          ...(input.objectives !== undefined
            ? { objectives: input.objectives }
            : {}),
          ...(input.checklist !== undefined
            ? { checklist: input.checklist }
            : {}),
          ...(input.sources !== undefined ? { sources: input.sources } : {}),
          ...(input.questions !== undefined
            ? { questions: input.questions }
            : {}),
          ...(input.misconceptions !== undefined
            ? { misconceptions: input.misconceptions }
            : {}),
          ...(input.referenceAnswer !== undefined
            ? { referenceAnswer: input.referenceAnswer }
            : {}),
          ...(input.unlockRules !== undefined
            ? { unlockRules: input.unlockRules }
            : {}),
          ...(input.optional !== undefined ? { optional: input.optional } : {}),
          ...(input.depthLevel !== undefined
            ? { depthLevel: input.depthLevel }
            : {}),
          ...(input.payload !== undefined
            ? { payload: input.payload as Record<string, unknown> }
            : {}),
          ...(input.orderIndex !== undefined
            ? { orderIndex: input.orderIndex }
            : {}),
        });
        const graph = toEditorDto(await repository.getVersionGraph(versionId));
        const unit = graph.weeks
          .flatMap((week) => week.days)
          .flatMap((item) => item.units)
          .find((item) => item.id === id);
        if (!unit) throw new Error("Created curriculum unit was not found");
        return context.json({ unit }, 201);
      }),
  );

  app.patch(
    "/api/curriculum-editor/versions/:versionId/units/:unitId",
    (context) =>
      handle(context, async () => {
        const input = await readBody(context, updateUnitSchema);
        const versionId = routeId(context, "versionId");
        const unitId = routeId(context, "unitId");
        const graph = updateUnitAndValidate(state, versionId, () =>
          updateEntity(
            state.connection,
            "curriculum_units",
            unitId,
            versionId,
            valuesFrom(input, [
              ["stableId", "stable_id"],
              ["type", "type"],
              ["title", "title"],
              ["description", "description"],
              ["estimatedMinutes", "estimated_minutes"],
              ["objectives", "objectives_json", json],
              ["checklist", "checklist_json", json],
              ["sources", "sources_json", json],
              ["questions", "questions_json", json],
              ["misconceptions", "misconceptions_json", json],
              [
                "referenceAnswer",
                "reference_answer_json",
                (value) => (value === null ? null : json(value)),
              ],
              ["completionCriteria", "completion_criteria_json", json],
              ["unlockRules", "unlock_rules_json", json],
              ["optional", "optional", (value) => (value ? 1 : 0)],
              ["depthLevel", "depth_level"],
              ["payload", "payload_json", json],
            ]),
          ),
        );
        return context.json({
          unit: graph.weeks
            .flatMap((week) => week.days)
            .flatMap((day) => day.units)
            .find((unit) => unit.id === unitId),
        });
      }),
  );

  app.delete(
    "/api/curriculum-editor/versions/:versionId/units/:unitId",
    (context) =>
      handle(context, async () => {
        await readBody(context, mutationSchema);
        deleteEntity(
          state.connection,
          "curriculum_units",
          routeId(context, "unitId"),
          routeId(context, "versionId"),
        );
        return context.json({ deleted: true });
      }),
  );

  app.post(
    "/api/curriculum-editor/versions/:versionId/days/:dayId/units/reorder",
    (context) =>
      handle(context, async () => {
        const input = await readBody(context, reorderSchema);
        const versionId = routeId(context, "versionId");
        const dayId = routeId(context, "dayId");
        await editorRepository(state).reorderUnits({
          versionId,
          dayId,
          orderedUnitIds: input.orderedIds,
        });
        return context.json({
          curriculum: toEditorDto(
            await editorRepository(state).getVersionGraph(versionId),
          ),
        });
      }),
  );
}
