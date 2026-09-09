import type { DatabaseSync } from "node:sqlite";

import { ClientError } from "@aptiloop/shared";
import type { LearningKernelActivity } from "@aptiloop/learning-core";

/**
 * Workstream A shared restore helpers (transfer import + course upgrade
 * replay). Single home for the revision-activity projection query and the
 * kernel-fact row insert so the two restore paths cannot drift.
 */

export const KERNEL_RESTORE_STUB_DAY_ID = "transfer-session-day";

export function ensureKernelSessionStubDay(
  sqlite: DatabaseSync,
  now: number,
): void {
  sqlite
    .prepare(
      `INSERT OR IGNORE INTO curriculum_days
       (id, slug, week_number, day_number, title, summary, estimated_minutes,
        goals_json, sources_json, created_at, updated_at)
       VALUES (?, ?, 0, 0, ?, ?, 0, '[]', '[]', ?, ?)`,
    )
    .run(
      KERNEL_RESTORE_STUB_DAY_ID,
      KERNEL_RESTORE_STUB_DAY_ID,
      "Transferred session anchor",
      "Restored transfer/upgrade sessions anchor to this local-only day; never scheduled.",
      now,
      now,
    );
}

export function readRevisionActivities(
  sqlite: DatabaseSync,
  courseId: string,
  revisionId: string,
  lessonId: string,
): readonly LearningKernelActivity[] {
  const rows = sqlite
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
    .all(courseId, revisionId, lessonId) as Array<{
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
      knowledgeNodeIds: JSON.parse(row.knowledge_node_ids_json) as string[],
      prerequisiteUnitIds: [],
    };
    if (row.prerequisite_activity_id !== null) {
      existing.prerequisiteUnitIds.push(row.prerequisite_activity_id);
    }
    grouped.set(row.id, existing);
  }
  if (grouped.size === 0) {
    throw new ClientError(
      400,
      "Restored Learning Kernel lesson has no activities",
    );
  }
  return [...grouped.values()]
    .sort(
      (left, right) =>
        left.order - right.order || (left.id < right.id ? -1 : 1),
    )
    .map(({ order: _order, ...activity }) => activity);
}

export interface RestoredKernelFactRow {
  readonly id: string;
  readonly schemaVersion: number;
  readonly operationId: string;
  readonly courseId: string;
  readonly revisionId: string;
  readonly branchId: string;
  readonly sessionId: string;
  readonly lessonId: string;
  readonly activityId: string;
  readonly bodyType: string;
  readonly provenanceKind: string;
  readonly supersedesFactId: string | null;
  readonly occurredAt: number;
  readonly acceptedAt: number;
  readonly canonicalJson: string;
  readonly factHash: string;
}

export function insertRestoredKernelFact(
  sqlite: DatabaseSync,
  row: RestoredKernelFactRow,
  orIgnore: boolean,
): number {
  const result = sqlite
    .prepare(
      `INSERT ${orIgnore ? "OR IGNORE " : ""}INTO learning_kernel_facts
       (id, schema_version, operation_id, course_id, revision_id, branch_id,
        session_id, lesson_id, activity_id, body_type, provenance_kind,
        supersedes_fact_id, occurred_at, accepted_at, canonical_json, fact_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.id,
      row.schemaVersion,
      row.operationId,
      row.courseId,
      row.revisionId,
      row.branchId,
      row.sessionId,
      row.lessonId,
      row.activityId,
      row.bodyType,
      row.provenanceKind,
      row.supersedesFactId,
      row.occurredAt,
      row.acceptedAt,
      row.canonicalJson,
      row.factHash,
    );
  return Number(result.changes);
}
