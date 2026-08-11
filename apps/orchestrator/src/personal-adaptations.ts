import {
  CurriculumAuthoringRepository,
  hashCanonicalJson,
  publicationContent,
  synchronizeDraftCourseProjectionWithinTransaction,
  type CurriculumVersionGraph,
  type DatabaseConnection,
} from "@aptiloop/database";
import type { Context, Hono } from "hono";
import { z } from "zod";

import { authoringDraftHash } from "./authoring-draft-hash.js";

const idSchema = z.string().trim().min(1).max(200);
const createSchema = z.object({ operationId: idSchema }).strict();
const integrateSchema = z
  .object({
    operationId: idSchema,
    strategy: z.enum(["use-upstream", "keep-personal"]),
    baseRevisionId: idSchema,
    upstreamRevisionId: idSchema,
    personalVersionId: idSchema.nullable(),
    baseDraftHash: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
    upstreamDraftHash: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
    personalDraftHash: z
      .string()
      .regex(/^sha256:[0-9a-f]{64}$/u)
      .nullable(),
  })
  .strict();

type BranchKind = "upstream" | "personal";
type VersionStatus = "draft" | "published" | "archived";

interface VersionMetadataRow {
  id: string;
  curriculum_id: string;
  revision: number;
  parent_version_id: string | null;
  branch_kind: BranchKind;
  status: VersionStatus;
  title: string;
  description: string | null;
  content_hash: string | null;
  based_on_content_hash: string | null;
  adaptation_branch_id: string | null;
  created_at: number;
  published_at: number | null;
  archived_at: number | null;
  updated_at: number;
}

interface AdaptationBranchRow {
  id: string;
  course_id: string;
  owner: "local";
  base_revision_id: string;
  head_revision_id: string | null;
  status: "active" | "archived";
  created_at: number;
  updated_at: number;
}

class AdaptationError extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function versionDto(row: VersionMetadataRow) {
  return {
    id: row.id,
    curriculumId: row.curriculum_id,
    revision: row.revision,
    parentVersionId: row.parent_version_id,
    branchKind: row.branch_kind,
    status: row.status,
    title: row.title,
    description: row.description,
    contentHash: row.content_hash,
    basedOnContentHash: row.based_on_content_hash,
    adaptationBranchId: row.adaptation_branch_id,
    createdAt: row.created_at,
    publishedAt: row.published_at,
    archivedAt: row.archived_at,
    updatedAt: row.updated_at,
  };
}

function inheritCoursePackActivityMetadata(
  connection: DatabaseConnection,
  sourceRevisionId: string | null,
  targetRevisionId: string,
): void {
  if (sourceRevisionId === null) return;
  const manifest = connection.sqlite
    .prepare("SELECT 1 FROM course_pack_manifests WHERE revision_id = ?")
    .get(sourceRevisionId);
  if (!manifest) return;
  const sourceRows = connection.sqlite
    .prepare(
      `SELECT stable_id, capability_ids_json, knowledge_node_ids_json,
              protected_material_json
       FROM course_activities WHERE revision_id = ?`,
    )
    .all(sourceRevisionId) as Array<{
    stable_id: string;
    capability_ids_json: string;
    knowledge_node_ids_json: string;
    protected_material_json: string;
  }>;
  const targetRows = connection.sqlite
    .prepare(
      `SELECT id, stable_id, protected_material_json
       FROM course_activities WHERE revision_id = ?`,
    )
    .all(targetRevisionId) as Array<{
    id: string;
    stable_id: string;
    protected_material_json: string;
  }>;
  if (sourceRows.length !== targetRows.length) {
    throw new Error("Imported Course Pack draft metadata is incomplete");
  }
  const sourceByStableId = new Map(
    sourceRows.map((row) => [row.stable_id, row]),
  );
  const update = connection.sqlite.prepare(
    `UPDATE course_activities
     SET capability_ids_json = ?, knowledge_node_ids_json = ?,
         protected_material_json = ?
     WHERE id = ? AND revision_id = ?`,
  );
  for (const target of targetRows) {
    const source = sourceByStableId.get(target.stable_id);
    if (!source) {
      throw new Error("Imported Course Pack draft metadata is incomplete");
    }
    const sourceProtected = JSON.parse(
      source.protected_material_json,
    ) as Record<string, unknown>;
    const targetProtected = JSON.parse(
      target.protected_material_json,
    ) as Record<string, unknown>;
    const sourceQuestions = new Map(
      (Array.isArray(sourceProtected.questions)
        ? sourceProtected.questions
        : []
      ).flatMap((question) =>
        question &&
        typeof question === "object" &&
        "id" in question &&
        typeof question.id === "string"
          ? [[question.id, question as Record<string, unknown>] as const]
          : [],
      ),
    );
    const targetQuestions = Array.isArray(targetProtected.questions)
      ? targetProtected.questions
      : [];
    const protectedMaterial = {
      ...sourceProtected,
      ...targetProtected,
      questions: targetQuestions.map((question) => {
        if (
          !question ||
          typeof question !== "object" ||
          !("id" in question) ||
          typeof question.id !== "string"
        ) {
          return question;
        }
        return {
          ...(sourceQuestions.get(question.id) ?? {}),
          ...question,
        };
      }),
    };
    if (
      update.run(
        source.capability_ids_json,
        source.knowledge_node_ids_json,
        JSON.stringify(protectedMaterial),
        target.id,
        targetRevisionId,
      ).changes !== 1
    ) {
      throw new Error("Imported Course Pack draft metadata is incomplete");
    }
  }
}

function branchDto(row: AdaptationBranchRow) {
  return {
    id: row.id,
    courseId: row.course_id,
    owner: row.owner,
    baseRevisionId: row.base_revision_id,
    headRevisionId: row.head_revision_id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function readJson<T>(context: Context, schema: z.ZodType<T>): Promise<T> {
  const parsed = schema.safeParse(await context.req.json());
  if (!parsed.success) {
    throw new AdaptationError(
      400,
      "invalid_request",
      "Request body is invalid",
    );
  }
  return parsed.data;
}

function routeId(context: Context, name: string): string {
  const parsed = idSchema.safeParse(context.req.param(name));
  if (!parsed.success) {
    throw new AdaptationError(400, "invalid_request", `${name} is invalid`);
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
    if (error instanceof AdaptationError) {
      return context.json(
        { error: error.message, code: error.code },
        error.status,
      );
    }
    throw error;
  }
}

function versionMetadata(
  connection: DatabaseConnection,
  versionId: string,
): VersionMetadataRow {
  const row = connection.sqlite
    .prepare("SELECT * FROM curriculum_versions WHERE id = ?")
    .get(versionId) as unknown as VersionMetadataRow | undefined;
  if (!row)
    throw new AdaptationError(404, "not_found", "Revision was not found");
  return row;
}

function courseVersions(
  connection: DatabaseConnection,
  courseId: string,
): VersionMetadataRow[] {
  return connection.sqlite
    .prepare(
      `SELECT * FROM curriculum_versions
       WHERE curriculum_id = ? ORDER BY revision DESC, id`,
    )
    .all(courseId) as unknown as VersionMetadataRow[];
}

function activeBranch(
  connection: DatabaseConnection,
  courseId: string,
): AdaptationBranchRow | null {
  return (
    (connection.sqlite
      .prepare(
        `SELECT * FROM adaptation_branches
         WHERE course_id = ? AND status = 'active' ORDER BY id LIMIT 1`,
      )
      .get(courseId) as unknown as AdaptationBranchRow | undefined) ?? null
  );
}

function ensureBranch(
  connection: DatabaseConnection,
  source: VersionMetadataRow,
): AdaptationBranchRow {
  const existing = activeBranch(connection, source.curriculum_id);
  if (existing) return existing;
  const now = Date.now();
  connection.sqlite
    .prepare(
      `INSERT INTO adaptation_branches
       (id, course_id, owner, base_revision_id, head_revision_id, status,
        created_at, updated_at)
       VALUES (?, ?, 'local', ?, NULL, 'active', ?, ?)`,
    )
    .run(source.curriculum_id, source.curriculum_id, source.id, now, now);
  return activeBranch(connection, source.curriculum_id)!;
}

function priorOperation(
  connection: DatabaseConnection,
  input: {
    operationId: string;
    courseId: string;
    kind: "create-branch" | "integrate-upstream";
    strategy?: "use-upstream" | "keep-personal";
  },
): VersionMetadataRow | null {
  const row = connection.sqlite
    .prepare(
      `SELECT version.*, operation.course_id AS operation_course_id,
              operation.kind AS operation_kind,
              operation.strategy AS operation_strategy
       FROM adaptation_authoring_operations operation
       JOIN curriculum_versions version ON version.id = operation.result_version_id
       WHERE operation.operation_id = ?`,
    )
    .get(input.operationId) as unknown as
    | (VersionMetadataRow & {
        operation_course_id: string;
        operation_kind: string;
        operation_strategy: string | null;
      })
    | undefined;
  if (!row) return null;
  if (
    row.operation_course_id !== input.courseId ||
    row.operation_kind !== input.kind ||
    row.operation_strategy !== (input.strategy ?? null)
  ) {
    throw new AdaptationError(
      409,
      "operation_conflict",
      "Operation ID was already used for a different adaptation request",
    );
  }
  return row;
}

async function clonePersonalDraft(
  connection: DatabaseConnection,
  input: {
    sourceVersionId: string;
    baseRevision: VersionMetadataRow;
    branch: AdaptationBranchRow;
    operationId: string;
    operationKind: "create-branch" | "integrate-upstream";
    title?: string;
    strategy?: "use-upstream" | "keep-personal";
  },
): Promise<VersionMetadataRow> {
  const retried = priorOperation(connection, {
    operationId: input.operationId,
    courseId: input.baseRevision.curriculum_id,
    kind: input.operationKind,
    ...(input.strategy ? { strategy: input.strategy } : {}),
  });
  if (retried) return retried;

  const repository = new CurriculumAuthoringRepository(connection);
  connection.sqlite.exec("BEGIN IMMEDIATE");
  try {
    const draft = await repository.cloneRevision(input.sourceVersionId, {
      ...(input.title ? { title: input.title } : {}),
    });
    const result = connection.sqlite
      .prepare(
        `UPDATE curriculum_versions
         SET branch_kind = 'personal', based_on_content_hash = ?,
             adaptation_branch_id = ?, updated_at = ?
         WHERE id = ? AND status = 'draft'`,
      )
      .run(
        input.baseRevision.content_hash,
        input.branch.id,
        Date.now(),
        draft.id,
      );
    if (result.changes !== 1) {
      throw new Error("Personal adaptation draft could not be classified");
    }
    connection.sqlite
      .prepare(
        `INSERT INTO adaptation_authoring_operations
         (operation_id, course_id, kind, strategy, result_version_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.operationId,
        input.baseRevision.curriculum_id,
        input.operationKind,
        input.strategy ?? null,
        draft.id,
        Date.now(),
      );
    connection.sqlite.exec("COMMIT");
    return versionMetadata(connection, draft.id);
  } catch (error) {
    connection.sqlite.exec("ROLLBACK");
    throw error;
  }
}

function entityMap(graph: CurriculumVersionGraph): Map<string, string> {
  const values = new Map<string, string>();
  for (const week of graph.weeks) {
    values.set(
      `week:${week.stableId}`,
      JSON.stringify({
        stableId: week.stableId,
        orderIndex: week.orderIndex,
        title: week.title,
        description: week.description,
      }),
    );
    for (const day of week.days) {
      values.set(
        `day:${day.stableId}`,
        JSON.stringify({
          parentStableId: week.stableId,
          stableId: day.stableId,
          orderIndex: day.orderIndex,
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
        values.set(
          `unit:${unit.stableId}`,
          JSON.stringify({
            parentStableId: day.stableId,
            stableId: unit.stableId,
            orderIndex: unit.orderIndex,
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
  return values;
}

function changedKeys(
  base: Map<string, string>,
  candidate: Map<string, string>,
): Set<string> {
  const keys = new Set([...base.keys(), ...candidate.keys()]);
  const changed = new Set<string>();
  for (const key of keys) {
    if (base.get(key) !== candidate.get(key)) changed.add(key);
  }
  return changed;
}

async function comparison(connection: DatabaseConnection, courseId: string) {
  const versions = courseVersions(connection, courseId);
  const branch = activeBranch(connection, courseId);
  const upstream =
    versions.find(
      (version) =>
        version.branch_kind === "upstream" && version.status === "published",
    ) ??
    (branch
      ? versions.find(
          (version) =>
            version.id === branch.base_revision_id &&
            version.branch_kind === "upstream" &&
            version.status === "archived",
        )
      : undefined);
  if (!upstream) {
    throw new AdaptationError(
      404,
      "not_found",
      "Published upstream revision was not found",
    );
  }
  if (!branch) {
    return {
      status: "current" as const,
      branch: null,
      base: upstream,
      upstream,
      personal: null,
      baseDraftHash: authoringDraftHash(
        await new CurriculumAuthoringRepository(connection).getVersionGraph(
          upstream.id,
        ),
      ),
      upstreamDraftHash: authoringDraftHash(
        await new CurriculumAuthoringRepository(connection).getVersionGraph(
          upstream.id,
        ),
      ),
      personalDraftHash: null,
      conflicts: [] as string[],
    };
  }
  const base = versionMetadata(connection, branch.base_revision_id);
  const personal =
    versions.find(
      (version) =>
        version.branch_kind === "personal" && version.status === "draft",
    ) ??
    (branch.head_revision_id
      ? versionMetadata(connection, branch.head_revision_id)
      : null);
  const repository = new CurriculumAuthoringRepository(connection);
  const [baseGraph, upstreamGraph, personalGraph] = await Promise.all([
    repository.getVersionGraph(base.id),
    repository.getVersionGraph(upstream.id),
    personal ? repository.getVersionGraph(personal.id) : Promise.resolve(null),
  ]);
  const upstreamChanges = changedKeys(
    entityMap(baseGraph),
    entityMap(upstreamGraph),
  );
  const personalChanges = personalGraph
    ? changedKeys(entityMap(baseGraph), entityMap(personalGraph))
    : new Set<string>();
  const conflicts = [...upstreamChanges]
    .filter((key) => personalChanges.has(key))
    .sort();
  return {
    status:
      upstream.id === base.id
        ? ("current" as const)
        : conflicts.length > 0
          ? ("conflict" as const)
          : ("clean" as const),
    branch,
    base,
    upstream,
    personal,
    baseDraftHash: authoringDraftHash(baseGraph),
    upstreamDraftHash: authoringDraftHash(upstreamGraph),
    personalDraftHash: personalGraph ? authoringDraftHash(personalGraph) : null,
    conflicts,
  };
}

export async function publishPersonalAdaptation(
  connection: DatabaseConnection,
  versionId: string,
): Promise<ReturnType<typeof versionDto>> {
  const metadata = versionMetadata(connection, versionId);
  if (metadata.branch_kind !== "personal" || metadata.status !== "draft") {
    throw new AdaptationError(
      409,
      "not_personal_draft",
      "Only a personal adaptation draft can use personal Publish",
    );
  }
  const repository = new CurriculumAuthoringRepository(connection);
  connection.sqlite.exec("BEGIN IMMEDIATE");
  try {
    const graph = await repository.getVersionGraph(versionId);
    synchronizeDraftCourseProjectionWithinTransaction(connection, graph);
    inheritCoursePackActivityMetadata(
      connection,
      metadata.parent_version_id,
      versionId,
    );
    const contentHash = hashCanonicalJson(publicationContent(graph));
    const now = Date.now();
    connection.sqlite
      .prepare(
        `UPDATE curriculum_versions
         SET status = 'archived', archived_at = ?, updated_at = ?
         WHERE curriculum_id = ? AND branch_kind = 'personal'
           AND status = 'published' AND id != ?`,
      )
      .run(now, now, metadata.curriculum_id, versionId);
    const published = connection.sqlite
      .prepare(
        `UPDATE curriculum_versions
         SET status = 'published', content_hash = ?, published_at = ?, updated_at = ?
         WHERE id = ? AND status = 'draft' AND branch_kind = 'personal'`,
      )
      .run(contentHash, now, now, versionId);
    if (published.changes !== 1) {
      throw new Error("Personal adaptation draft changed during Publish");
    }
    connection.sqlite
      .prepare(
        `UPDATE adaptation_branches
         SET head_revision_id = ?, updated_at = ?
         WHERE id = ? AND course_id = ? AND status = 'active'`,
      )
      .run(
        versionId,
        now,
        metadata.adaptation_branch_id,
        metadata.curriculum_id,
      );
    connection.sqlite.exec("COMMIT");
    return versionDto(versionMetadata(connection, versionId));
  } catch (error) {
    connection.sqlite.exec("ROLLBACK");
    throw error;
  }
}

export function isPersonalAdaptation(
  connection: DatabaseConnection,
  versionId: string,
): boolean {
  return versionMetadata(connection, versionId).branch_kind === "personal";
}

export function registerPersonalAdaptationRoutes(
  app: Hono,
  state: { connection: DatabaseConnection },
): void {
  app.get("/api/curriculum-editor/courses/:courseId/adaptation", (context) =>
    route(context, async () => {
      const courseId = routeId(context, "courseId");
      const versions = courseVersions(state.connection, courseId);
      if (versions.length === 0) {
        throw new AdaptationError(404, "not_found", "Course was not found");
      }
      const comparisonResult = await comparison(state.connection, courseId);
      return {
        branch: comparisonResult.branch
          ? branchDto(comparisonResult.branch)
          : null,
        revisions: versions.map(versionDto),
        comparison: {
          status: comparisonResult.status,
          baseRevisionId: comparisonResult.base.id,
          upstreamRevisionId: comparisonResult.upstream.id,
          personalVersionId: comparisonResult.personal?.id ?? null,
          baseDraftHash: comparisonResult.baseDraftHash,
          upstreamDraftHash: comparisonResult.upstreamDraftHash,
          personalDraftHash: comparisonResult.personalDraftHash,
          conflicts: comparisonResult.conflicts,
        },
      };
    }),
  );

  app.post("/api/curriculum-editor/versions/:versionId/adaptation", (context) =>
    route(context, async () => {
      const input = await readJson(context, createSchema);
      const source = versionMetadata(
        state.connection,
        routeId(context, "versionId"),
      );
      if (source.branch_kind !== "upstream" || source.status !== "published") {
        throw new AdaptationError(
          409,
          "invalid_adaptation_base",
          "Personal adaptation must start from a published upstream revision",
        );
      }
      if (!source.content_hash) {
        throw new AdaptationError(
          409,
          "missing_base_hash",
          "Published upstream revision has no content hash",
        );
      }
      const branch = ensureBranch(state.connection, source);
      const draft = await clonePersonalDraft(state.connection, {
        sourceVersionId: source.id,
        baseRevision: source,
        branch,
        operationId: input.operationId,
        operationKind: "create-branch",
        title: `${source.title} — Personal adaptation`,
      });
      return { version: versionDto(draft), branch: branchDto(branch) };
    }),
  );

  app.post(
    "/api/curriculum-editor/courses/:courseId/adaptation/integrate",
    (context) =>
      route(context, async () => {
        const input = await readJson(context, integrateSchema);
        const courseId = routeId(context, "courseId");
        const retried = priorOperation(state.connection, {
          operationId: input.operationId,
          courseId,
          kind: "integrate-upstream",
          strategy: input.strategy,
        });
        if (retried) {
          return {
            version: versionDto(retried),
            strategy: input.strategy,
            priorConflicts: [] as string[],
          };
        }
        const current = await comparison(state.connection, courseId);
        if (
          current.base.id !== input.baseRevisionId ||
          current.upstream.id !== input.upstreamRevisionId ||
          (current.personal?.id ?? null) !== input.personalVersionId ||
          current.baseDraftHash !== input.baseDraftHash ||
          current.upstreamDraftHash !== input.upstreamDraftHash ||
          current.personalDraftHash !== input.personalDraftHash
        ) {
          throw new AdaptationError(
            409,
            "stale_comparison",
            "Adaptation comparison changed before integration",
          );
        }
        if (!current.branch) {
          throw new AdaptationError(
            409,
            "missing_branch",
            "Personal adaptation branch does not exist",
          );
        }
        if (current.status === "current") {
          throw new AdaptationError(
            409,
            "upstream_current",
            "Personal adaptation already uses the current upstream revision",
          );
        }
        if (input.strategy === "keep-personal" && !current.personal) {
          throw new AdaptationError(
            409,
            "missing_personal_revision",
            "There is no personal revision to preserve",
          );
        }
        const sourceVersionId =
          input.strategy === "use-upstream"
            ? current.upstream.id
            : current.personal!.id;
        const draft = await clonePersonalDraft(state.connection, {
          sourceVersionId,
          baseRevision: current.upstream,
          branch: current.branch,
          operationId: input.operationId,
          operationKind: "integrate-upstream",
          strategy: input.strategy,
          title:
            input.strategy === "use-upstream"
              ? `${current.upstream.title} — Personal adaptation`
              : `${current.personal!.title} — Integrated upstream`,
        });
        return {
          version: versionDto(draft),
          strategy: input.strategy,
          priorConflicts: current.conflicts,
        };
      }),
  );
}
