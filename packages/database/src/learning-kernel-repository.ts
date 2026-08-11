import {
  canonicalLearningKernelJson,
  learningKernelSha256,
  LearningKernelConflictError,
  projectLearningKernel,
  reduceLearningKernel,
  type LearningKernelActivity,
  type LearningKernelCommand,
  type LearningKernelFact,
  type LearningKernelProjection,
  type LearningKernelReductionResult,
  type LearningKernelScope,
} from "@aptiloop/learning-core";

import { withTransaction, type DatabaseConnection } from "./database.js";

const REQUIRED_KERNEL_TABLES = [
  "learning_kernel_facts",
  "learning_kernel_projection_history",
  "learning_kernel_projections",
] as const;

export interface LearningKernelRepositoryOptions {
  readonly now?: () => number;
}

interface SessionScopeRow {
  course_id: string;
  revision_id: string;
  lesson_id: string;
  branch_id: string;
}

interface StoredKernelFactRow {
  canonical_json: string;
  fact_hash: string;
}

export class LearningKernelRepository {
  readonly #connection: DatabaseConnection;
  readonly #now: () => number;

  constructor(
    connection: DatabaseConnection,
    options: LearningKernelRepositoryOptions = {},
  ) {
    this.#connection = connection;
    this.#now = options.now ?? Date.now;
  }

  hasStorage(): boolean {
    const rows = this.#connection.sqlite
      .prepare(
        `SELECT name FROM sqlite_schema
         WHERE type = 'table' AND name IN (${REQUIRED_KERNEL_TABLES.map(() => "?").join(", ")})`,
      )
      .all(...REQUIRED_KERNEL_TABLES) as Array<{ name: string }>;
    return rows.length === REQUIRED_KERNEL_TABLES.length;
  }

  resolveSessionScope(sessionId: string): LearningKernelScope {
    this.#assertStorage();
    const rows = this.#connection.sqlite
      .prepare(
        `SELECT context.course_id, context.revision_id, branch.id AS branch_id
         FROM session_course_contexts context
         JOIN adaptation_branches branch
           ON branch.course_id = context.course_id
          AND branch.status = 'active'
         WHERE context.session_id = ?
         ORDER BY branch.id`,
      )
      .all(sessionId) as Array<{
      course_id: string;
      revision_id: string;
      branch_id: string;
    }>;
    if (rows.length !== 1) {
      throw new Error(
        rows.length === 0
          ? "Learning Kernel session has no active personal adaptation branch"
          : "Learning Kernel session has multiple active personal adaptation branches",
      );
    }
    const row = rows[0]!;
    return {
      courseId: row.course_id,
      revisionId: row.revision_id,
      branchId: row.branch_id,
      sessionId,
    };
  }

  listActivities(
    scope: LearningKernelScope,
  ): readonly LearningKernelActivity[] {
    const session = this.#requireSessionScope(scope);
    return this.#readActivities(scope, session.lesson_id);
  }

  accept(
    scope: LearningKernelScope,
    command: LearningKernelCommand,
  ): LearningKernelReductionResult {
    this.#assertStorage();
    return withTransaction(this.#connection, () => {
      const session = this.#requireSessionScope(scope);
      this.#assertGlobalIdentity(scope, command);
      const activities = this.#readActivities(scope, session.lesson_id);
      const facts = this.readFacts(scope);
      const result = reduceLearningKernel({
        scope,
        activities,
        facts,
        command,
      });
      if (result.accepted && result.acceptedFact) {
        const acceptedAt = this.#now();
        const occurredAt = Date.parse(result.acceptedFact.occurredAt);
        if (!Number.isFinite(occurredAt) || acceptedAt < occurredAt) {
          throw new Error(
            "Learning Kernel acceptance clock precedes the observed command clock",
          );
        }
        this.#insertFact(result.acceptedFact, session.lesson_id, acceptedAt);
        this.#persistProjection(scope, result.projection, acceptedAt);
      } else {
        this.#verifyCurrentProjection(scope, result.projection);
      }
      return result;
    });
  }

  readFacts(scope: LearningKernelScope): readonly LearningKernelFact[] {
    if (!this.hasStorage()) return [];
    const rows = this.#connection.sqlite
      .prepare(
        `SELECT canonical_json, fact_hash FROM learning_kernel_facts
         WHERE session_id = ? AND course_id = ? AND revision_id = ?
               AND branch_id = ?
         ORDER BY occurred_at, id`,
      )
      .all(
        scope.sessionId,
        scope.courseId,
        scope.revisionId,
        scope.branchId,
      ) as unknown as StoredKernelFactRow[];
    return rows.map((row) => {
      const parsed = JSON.parse(row.canonical_json) as LearningKernelFact;
      if (canonicalLearningKernelJson(parsed) !== row.canonical_json) {
        throw new Error("Stored Learning Kernel fact is not canonical");
      }
      if (learningKernelSha256(parsed) !== row.fact_hash) {
        throw new Error("Stored Learning Kernel fact hash is inconsistent");
      }
      return parsed;
    });
  }

  readProjection(scope: LearningKernelScope): LearningKernelProjection | null {
    if (!this.hasStorage()) return null;
    const row = this.#connection.sqlite
      .prepare(
        `SELECT projection_json, projection_hash
         FROM learning_kernel_projections
         WHERE session_id = ? AND course_id = ? AND revision_id = ?
               AND branch_id = ?`,
      )
      .get(
        scope.sessionId,
        scope.courseId,
        scope.revisionId,
        scope.branchId,
      ) as { projection_json: string; projection_hash: string } | undefined;
    if (!row) return null;
    const projection = JSON.parse(
      row.projection_json,
    ) as LearningKernelProjection;
    if (
      canonicalLearningKernelJson(projection) !== row.projection_json ||
      projection.projectionHash !== row.projection_hash
    ) {
      throw new Error("Stored Learning Kernel projection is inconsistent");
    }
    return projection;
  }

  reproject(
    scope: LearningKernelScope,
    observedAt: string,
  ): LearningKernelProjection {
    this.#assertStorage();
    const session = this.#requireSessionScope(scope);
    const projection = projectLearningKernel({
      scope,
      activities: this.#readActivities(scope, session.lesson_id),
      facts: this.readFacts(scope),
      observedAt,
    });
    return projection;
  }

  #requireSessionScope(scope: LearningKernelScope): SessionScopeRow {
    const row = this.#connection.sqlite
      .prepare(
        `SELECT context.course_id, context.revision_id, context.lesson_id,
                branch.id AS branch_id
         FROM session_course_contexts context
         JOIN adaptation_branches branch
           ON branch.course_id = context.course_id AND branch.id = ?
         WHERE context.session_id = ? AND context.course_id = ?
               AND context.revision_id = ? AND branch.status = 'active'`,
      )
      .get(
        scope.branchId,
        scope.sessionId,
        scope.courseId,
        scope.revisionId,
      ) as SessionScopeRow | undefined;
    if (!row) {
      throw new Error(
        "Learning Kernel scope is not bound to the persisted session and adaptation branch",
      );
    }
    return row;
  }

  #assertGlobalIdentity(
    scope: LearningKernelScope,
    command: LearningKernelCommand,
  ): void {
    const operation = this.#connection.sqlite
      .prepare(
        `SELECT session_id, course_id, revision_id, branch_id
         FROM learning_kernel_facts WHERE operation_id = ?`,
      )
      .get(command.operationId) as
      | {
          session_id: string;
          course_id: string;
          revision_id: string;
          branch_id: string;
        }
      | undefined;
    if (
      operation &&
      (operation.session_id !== scope.sessionId ||
        operation.course_id !== scope.courseId ||
        operation.revision_id !== scope.revisionId ||
        operation.branch_id !== scope.branchId)
    ) {
      throw new LearningKernelConflictError(
        "Learning Kernel operation ID belongs to another scope",
      );
    }
    const fact = this.#connection.sqlite
      .prepare(`SELECT operation_id FROM learning_kernel_facts WHERE id = ?`)
      .get(command.factId) as { operation_id: string } | undefined;
    if (fact && fact.operation_id !== command.operationId) {
      throw new LearningKernelConflictError(
        "Learning Kernel fact ID belongs to another operation",
      );
    }
  }

  #readActivities(
    scope: LearningKernelScope,
    lessonId: string,
  ): readonly LearningKernelActivity[] {
    const rows = this.#connection.sqlite
      .prepare(
        `SELECT activity.id, activity.required, activity.order_index,
                CASE WHEN activity.knowledge_node_ids_json = '[]'
                     THEN lesson.topics_json
                     ELSE activity.knowledge_node_ids_json END AS knowledge_node_ids_json,
                prerequisite.prerequisite_activity_id
         FROM course_activities activity
         JOIN course_lessons lesson
           ON lesson.course_id = activity.course_id
          AND lesson.revision_id = activity.revision_id
          AND lesson.id = activity.lesson_id
         LEFT JOIN course_activity_prerequisites prerequisite
           ON prerequisite.course_id = activity.course_id
          AND prerequisite.revision_id = activity.revision_id
          AND prerequisite.lesson_id = activity.lesson_id
          AND prerequisite.activity_id = activity.id
         WHERE activity.course_id = ? AND activity.revision_id = ?
               AND activity.lesson_id = ?
         ORDER BY activity.order_index, activity.id,
                  prerequisite.prerequisite_activity_id`,
      )
      .all(scope.courseId, scope.revisionId, lessonId) as Array<{
      id: string;
      required: number;
      order_index: number;
      knowledge_node_ids_json: string;
      prerequisite_activity_id: string | null;
    }>;
    const grouped = new Map<
      string,
      {
        id: string;
        optional: boolean;
        order: number;
        knowledgeNodeIds: string[];
        prerequisiteUnitIds: string[];
      }
    >();
    for (const row of rows) {
      const existing = grouped.get(row.id) ?? {
        id: row.id,
        optional: row.required !== 1,
        order: row.order_index,
        knowledgeNodeIds: parseStringArray(
          row.knowledge_node_ids_json,
          `activity ${row.id} knowledge nodes`,
        ),
        prerequisiteUnitIds: [],
      };
      if (row.prerequisite_activity_id !== null) {
        existing.prerequisiteUnitIds.push(row.prerequisite_activity_id);
      }
      grouped.set(row.id, existing);
    }
    if (grouped.size === 0) {
      throw new Error("Learning Kernel session lesson has no activities");
    }
    return [...grouped.values()]
      .sort(
        (left, right) => left.order - right.order || compare(left.id, right.id),
      )
      .map(({ order: _order, ...activity }) => activity);
  }

  #insertFact(
    fact: LearningKernelFact,
    lessonId: string,
    acceptedAt: number,
  ): void {
    const canonical = canonicalLearningKernelJson(fact);
    const activityId =
      fact.body.type === "correction"
        ? fact.body.replacement.activityId
        : fact.body.activityId;
    this.#connection.sqlite
      .prepare(
        `INSERT INTO learning_kernel_facts
         (id, schema_version, operation_id, course_id, revision_id, branch_id,
          session_id, lesson_id, activity_id, body_type, provenance_kind,
          supersedes_fact_id, occurred_at, accepted_at, canonical_json,
          fact_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        fact.id,
        fact.schemaVersion,
        fact.operationId,
        fact.courseId,
        fact.revisionId,
        fact.branchId,
        fact.sessionId,
        lessonId,
        activityId,
        fact.body.type,
        fact.provenance.kind,
        fact.body.type === "correction" ? fact.body.supersedesFactId : null,
        Date.parse(fact.occurredAt),
        acceptedAt,
        canonical,
        learningKernelSha256(fact),
      );
  }

  #persistProjection(
    scope: LearningKernelScope,
    projection: LearningKernelProjection,
    acceptedAt: number,
  ): void {
    const projectionJson = canonicalLearningKernelJson(projection);
    const factFrontierHash = learningKernelSha256(projection.factFrontier);
    const historyId = `kernel-projection-${projection.projectionHash.slice("sha256:".length)}`;
    this.#connection.sqlite
      .prepare(
        `INSERT INTO learning_kernel_projection_history
         (id, session_id, course_id, revision_id, branch_id, model_version,
          scheduler_version, observed_at, fact_frontier_hash, projection_hash,
          projection_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        historyId,
        scope.sessionId,
        scope.courseId,
        scope.revisionId,
        scope.branchId,
        projection.modelVersion,
        projection.schedulerVersion,
        Date.parse(projection.observedAt),
        factFrontierHash,
        projection.projectionHash,
        projectionJson,
        acceptedAt,
      );
    this.#connection.sqlite
      .prepare(
        `INSERT INTO learning_kernel_projections
         (session_id, course_id, revision_id, branch_id, model_version,
          scheduler_version, observed_at, fact_frontier_hash, projection_hash,
          projection_json, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(session_id) DO UPDATE SET
          course_id = excluded.course_id,
          revision_id = excluded.revision_id,
          branch_id = excluded.branch_id,
          model_version = excluded.model_version,
          scheduler_version = excluded.scheduler_version,
          observed_at = excluded.observed_at,
          fact_frontier_hash = excluded.fact_frontier_hash,
          projection_hash = excluded.projection_hash,
          projection_json = excluded.projection_json,
          updated_at = excluded.updated_at`,
      )
      .run(
        scope.sessionId,
        scope.courseId,
        scope.revisionId,
        scope.branchId,
        projection.modelVersion,
        projection.schedulerVersion,
        Date.parse(projection.observedAt),
        factFrontierHash,
        projection.projectionHash,
        projectionJson,
        acceptedAt,
      );
  }

  #verifyCurrentProjection(
    scope: LearningKernelScope,
    projection: LearningKernelProjection,
  ): void {
    const stored = this.readProjection(scope);
    if (
      !stored ||
      stored.projectionHash !== projection.projectionHash ||
      canonicalLearningKernelJson(stored) !==
        canonicalLearningKernelJson(projection)
    ) {
      throw new Error(
        "Idempotent Learning Kernel replay does not match the persisted projection",
      );
    }
  }

  #assertStorage(): void {
    if (!this.hasStorage()) {
      throw new Error(
        "Learning Kernel storage is unavailable until the approved M4 migration is applied",
      );
    }
  }
}

export function createLearningKernelRepository(
  connection: DatabaseConnection,
  options: LearningKernelRepositoryOptions = {},
): LearningKernelRepository {
  return new LearningKernelRepository(connection, options);
}

function parseStringArray(value: string, label: string): string[] {
  const parsed = JSON.parse(value) as unknown;
  if (
    !Array.isArray(parsed) ||
    parsed.some((item) => typeof item !== "string" || item.trim() === "")
  ) {
    throw new Error(`${label} must be a JSON string array`);
  }
  return [...new Set(parsed)].sort(compare);
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
