import {
  ClientError,
  CourseLessonSchema,
  CourseRevisionSchema,
  CourseSchema,
  EvidenceFactSchema,
  LearnerActivityDefinitionSchema,
  type Course,
  type CourseLesson,
  type CourseRevision,
  type EvidenceFact,
  type LearnerActivityDefinition,
} from "@aptiloop/shared";

import type { DatabaseConnection } from "./database.js";

export interface CourseRevisionSummary {
  readonly id: string;
  readonly revisionNumber: number;
  readonly status: CourseRevision["status"];
  readonly branchKind: CourseRevision["branchKind"];
  readonly contentHash: string | null;
}

export type CourseFoundationSummary = Course & {
  readonly revisions: readonly CourseRevisionSummary[];
};

export type CourseFoundationLesson = CourseLesson & {
  readonly activities: readonly LearnerActivityDefinition[];
};

export interface CourseFoundationRevision {
  readonly course: Course;
  readonly revision: CourseRevision;
  readonly lessons: readonly CourseFoundationLesson[];
}

export interface CourseSessionContext {
  readonly courseId: string;
  readonly revisionId: string;
  readonly lessonId: string;
  readonly sessionSnapshotId: string;
  readonly snapshotHash: string;
}

export interface CourseFoundationReconciliationTable {
  readonly sourceTable: string;
  readonly sourceRows: number;
  readonly mapped: number;
  readonly quarantined: number;
  readonly intentionallyUnmapped: number;
}

export interface CourseFoundationReconciliationReport {
  readonly transformVersion: "m2-v1";
  readonly runId: string | null;
  readonly sourceDatabaseDigest: string | null;
  readonly sourceRowsDigest: string | null;
  readonly sourceRows: number;
  readonly mapped: number;
  readonly quarantined: number;
  readonly intentionallyUnmapped: number;
  readonly accounted: boolean;
  readonly foreignKeyViolationCount: number;
  readonly tables: readonly CourseFoundationReconciliationTable[];
  readonly quarantineReasons: Readonly<Record<string, number>>;
}

type CourseRow = {
  id: string;
  stable_id: string;
  title: string;
  description: string | null;
  primary_locale: string;
  created_at: number;
  updated_at: number;
};

type RevisionRow = {
  id: string;
  course_id: string;
  revision_number: number;
  parent_revision_id: string | null;
  branch_kind: "upstream" | "personal";
  status: "draft" | "published" | "archived";
  content_hash: string | null;
  based_on_content_hash: string | null;
  created_at: number;
  published_at: number | null;
};

type LessonRow = {
  id: string;
  course_id: string;
  revision_id: string;
  stable_id: string;
  order_index: number;
  title: string;
  description: string;
  goal: string;
};

type ActivityRow = {
  id: string;
  course_id: string;
  revision_id: string;
  lesson_id: string;
  stable_id: string;
  activity_type:
    | "briefing"
    | "study"
    | "recall"
    | "teacher-dialogue"
    | "quiz"
    | "code-reading"
    | "exercise"
    | "review"
    | "interview"
    | "summary"
    | "checkpoint"
    | "spaced-review";
  order_index: number;
  title: string;
  description: string;
  required: number;
  capability_ids_json: string;
  completion_criteria_json: string;
  payload_json: string;
};

type EvidenceRow = {
  id: string;
  schema_version: number;
  operation_id: string;
  course_id: string;
  revision_id: string;
  lesson_id: string;
  session_id: string;
  activity_id: string;
  evidence_type:
    "recall-attempt" | "quiz-answer" | "code-reading-attempt" | "summary";
  question_id: string | null;
  correctness: number | null;
  occurred_at: number;
  recorded_at: number;
  payload_json: string;
  provenance_json: string;
};

function isoDateTime(value: number, label: string): string {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`Invalid stored ${label}`);
  }
  const result = new Date(value).toISOString();
  if (result === "Invalid Date") throw new Error(`Invalid stored ${label}`);
  return result;
}

function jsonArray(value: string, label: string): unknown[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // The storage boundary reports only the column label, never protected bytes.
  }
  throw new Error(`Invalid stored ${label}`);
}

function jsonObject(value: string, label: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      !Array.isArray(parsed)
    ) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // The storage boundary reports only the column label, never private bytes.
  }
  throw new Error(`Invalid stored ${label}`);
}

function mapCourse(row: CourseRow): Course {
  return CourseSchema.parse({
    id: row.id,
    stableId: row.stable_id,
    title: row.title,
    description: row.description,
    primaryLocale: row.primary_locale,
    createdAt: isoDateTime(row.created_at, "Course created_at"),
    updatedAt: isoDateTime(row.updated_at, "Course updated_at"),
  });
}

function mapRevision(row: RevisionRow): CourseRevision {
  return CourseRevisionSchema.parse({
    id: row.id,
    courseId: row.course_id,
    revisionNumber: row.revision_number,
    parentRevisionId: row.parent_revision_id,
    branchKind: row.branch_kind,
    status: row.status,
    contentHash: row.content_hash,
    basedOnContentHash: row.based_on_content_hash,
    createdAt: isoDateTime(row.created_at, "Course revision created_at"),
    publishedAt:
      row.published_at === null
        ? null
        : isoDateTime(row.published_at, "Course revision published_at"),
  });
}

export class CourseFoundationRepository {
  readonly #connection: DatabaseConnection;

  constructor(connection: DatabaseConnection) {
    this.#connection = connection;
  }

  async listCourses(): Promise<readonly CourseFoundationSummary[]> {
    const deletedCourseIds = new Set<string>();
    const hasCoursePackLifecycle = Boolean(
      this.#connection.sqlite
        .prepare(
          `SELECT 1 AS present FROM sqlite_schema
           WHERE type = 'table' AND name = 'course_pack_lifecycle_events'`,
        )
        .get(),
    );
    if (hasCoursePackLifecycle) {
      const deletedRows = this.#connection.sqlite
        .prepare(
          `SELECT course_id
           FROM (
             SELECT revision.course_id, event.action,
                    ROW_NUMBER() OVER (
                      PARTITION BY revision.course_id
                      ORDER BY event.occurred_at DESC, event.rowid DESC
                    ) AS lifecycle_rank
             FROM course_pack_lifecycle_events event
             JOIN course_pack_manifests manifest
               ON manifest.revision_id = event.revision_id
             JOIN course_revisions revision
               ON revision.id = manifest.revision_id
           )
           WHERE lifecycle_rank = 1 AND action = 'uninstall'`,
        )
        .all() as Array<{ course_id: string }>;
      for (const row of deletedRows) deletedCourseIds.add(row.course_id);
    }
    const courseRows = this.#connection.sqlite
      .prepare(
        `SELECT id, stable_id, title, description, primary_locale,
                created_at, updated_at
         FROM courses
         ORDER BY stable_id, id`,
      )
      .all() as CourseRow[];
    const revisionRows = this.#connection.sqlite
      .prepare(
        `SELECT id, course_id, revision_number, parent_revision_id,
                branch_kind, status, content_hash, based_on_content_hash,
                created_at, published_at
         FROM course_revisions
         ORDER BY course_id, revision_number, id`,
      )
      .all() as RevisionRow[];
    const revisionsByCourse = new Map<string, CourseRevisionSummary[]>();
    for (const row of revisionRows) {
      const revision = mapRevision(row);
      const summaries = revisionsByCourse.get(revision.courseId) ?? [];
      summaries.push({
        id: revision.id,
        revisionNumber: revision.revisionNumber,
        status: revision.status,
        branchKind: revision.branchKind,
        contentHash: revision.contentHash,
      });
      revisionsByCourse.set(revision.courseId, summaries);
    }
    return courseRows
      .filter((row) => !deletedCourseIds.has(row.id))
      .map((row) => ({
        ...mapCourse(row),
        revisions: revisionsByCourse.get(row.id) ?? [],
      }));
  }

  async getCourseRevision(
    revisionId: string,
  ): Promise<CourseFoundationRevision | null> {
    const revisionRow = this.#connection.sqlite
      .prepare(
        `SELECT id, course_id, revision_number, parent_revision_id,
                branch_kind, status, content_hash, based_on_content_hash,
                created_at, published_at
         FROM course_revisions
         WHERE id = ?`,
      )
      .get(revisionId) as RevisionRow | undefined;
    if (!revisionRow) return null;
    const courseRow = this.#connection.sqlite
      .prepare(
        `SELECT id, stable_id, title, description, primary_locale,
                created_at, updated_at
         FROM courses
         WHERE id = ?`,
      )
      .get(revisionRow.course_id) as CourseRow | undefined;
    if (!courseRow)
      throw new ClientError(400, "Stored Course revision has no parent Course");

    const lessonRows = this.#connection.sqlite
      .prepare(
        `SELECT lesson.id, lesson.course_id, lesson.revision_id,
                lesson.stable_id, lesson.order_index, lesson.title,
                lesson.description, lesson.goal
         FROM course_lessons AS lesson
         JOIN course_sections AS section
           ON section.course_id = lesson.course_id
          AND section.revision_id = lesson.revision_id
          AND section.id = lesson.section_id
         WHERE lesson.course_id = ? AND lesson.revision_id = ?
         ORDER BY section.order_index, lesson.order_index, lesson.id`,
      )
      .all(revisionRow.course_id, revisionRow.id) as LessonRow[];
    const activityRows = this.#connection.sqlite
      .prepare(
        `SELECT id, course_id, revision_id, lesson_id, stable_id,
                activity_type, order_index, title, description, required,
                capability_ids_json, completion_criteria_json, payload_json
         FROM course_activities
         WHERE course_id = ? AND revision_id = ?
         ORDER BY lesson_id, order_index, id`,
      )
      .all(revisionRow.course_id, revisionRow.id) as ActivityRow[];
    const lessonPrerequisiteRows = this.#connection.sqlite
      .prepare(
        `SELECT lesson_id, prerequisite_lesson_id
         FROM course_lesson_prerequisites
         WHERE course_id = ? AND revision_id = ?
         ORDER BY lesson_id, prerequisite_lesson_id`,
      )
      .all(revisionRow.course_id, revisionRow.id) as Array<{
      lesson_id: string;
      prerequisite_lesson_id: string;
    }>;
    const prerequisitesByLesson = new Map<string, string[]>();
    for (const row of lessonPrerequisiteRows) {
      const prerequisites = prerequisitesByLesson.get(row.lesson_id) ?? [];
      prerequisites.push(row.prerequisite_lesson_id);
      prerequisitesByLesson.set(row.lesson_id, prerequisites);
    }
    const prerequisiteRows = this.#connection.sqlite
      .prepare(
        `SELECT lesson_id, activity_id, prerequisite_activity_id
         FROM course_activity_prerequisites
         WHERE course_id = ? AND revision_id = ?
         ORDER BY lesson_id, activity_id, prerequisite_activity_id`,
      )
      .all(revisionRow.course_id, revisionRow.id) as Array<{
      lesson_id: string;
      activity_id: string;
      prerequisite_activity_id: string;
    }>;
    const prerequisitesByActivity = new Map<string, string[]>();
    for (const row of prerequisiteRows) {
      const prerequisites = prerequisitesByActivity.get(row.activity_id) ?? [];
      prerequisites.push(row.prerequisite_activity_id);
      prerequisitesByActivity.set(row.activity_id, prerequisites);
    }
    const activitiesByLesson = new Map<string, LearnerActivityDefinition[]>();
    for (const row of activityRows) {
      const activity = LearnerActivityDefinitionSchema.parse({
        id: row.id,
        courseId: row.course_id,
        revisionId: row.revision_id,
        lessonId: row.lesson_id,
        stableId: row.stable_id,
        type: row.activity_type,
        order: row.order_index,
        title: row.title,
        description: row.description,
        required: row.required === 1,
        prerequisiteActivityIds: prerequisitesByActivity.get(row.id) ?? [],
        capabilityIds: jsonArray(
          row.capability_ids_json,
          "Activity capability IDs",
        ),
        completionCriteria: jsonArray(
          row.completion_criteria_json,
          "Activity completion criteria",
        ),
        payload: jsonObject(row.payload_json, "Activity payload"),
      });
      const lessonActivities = activitiesByLesson.get(row.lesson_id) ?? [];
      lessonActivities.push(activity);
      activitiesByLesson.set(row.lesson_id, lessonActivities);
    }

    const lessons = lessonRows.map((row): CourseFoundationLesson => {
      const activities = activitiesByLesson.get(row.id) ?? [];
      const entryActivityIds = activities
        .filter((activity) => activity.prerequisiteActivityIds.length === 0)
        .map((activity) => activity.id);
      const lesson = CourseLessonSchema.parse({
        id: row.id,
        courseId: row.course_id,
        revisionId: row.revision_id,
        stableId: row.stable_id,
        order: row.order_index,
        title: row.title,
        description: row.description,
        goal: row.goal,
        prerequisiteLessonIds: prerequisitesByLesson.get(row.id) ?? [],
        entryActivityIds,
      });
      return { ...lesson, activities };
    });

    return {
      course: mapCourse(courseRow),
      revision: mapRevision(revisionRow),
      lessons,
    };
  }

  async getSessionContext(
    sessionId: string,
  ): Promise<CourseSessionContext | null> {
    const row = this.#connection.sqlite
      .prepare(
        `SELECT course_id, revision_id, lesson_id, session_snapshot_id,
                snapshot_hash
         FROM session_course_contexts
         WHERE session_id = ?`,
      )
      .get(sessionId) as
      | {
          course_id: string;
          revision_id: string;
          lesson_id: string;
          session_snapshot_id: string;
          snapshot_hash: string;
        }
      | undefined;
    return row
      ? {
          courseId: row.course_id,
          revisionId: row.revision_id,
          lessonId: row.lesson_id,
          sessionSnapshotId: row.session_snapshot_id,
          snapshotHash: row.snapshot_hash,
        }
      : null;
  }

  async listEvidence(sessionId: string): Promise<readonly EvidenceFact[]> {
    const rows = this.#connection.sqlite
      .prepare(
        `SELECT id, schema_version, operation_id, course_id, revision_id,
                lesson_id, session_id, activity_id, evidence_type, question_id,
                correctness, occurred_at, recorded_at, payload_json,
                provenance_json
         FROM evidence_facts
         WHERE session_id = ?
         ORDER BY occurred_at, id`,
      )
      .all(sessionId) as EvidenceRow[];
    return rows.map((row) =>
      EvidenceFactSchema.parse({
        id: row.id,
        schemaVersion: row.schema_version,
        operationId: row.operation_id,
        courseId: row.course_id,
        revisionId: row.revision_id,
        lessonId: row.lesson_id,
        sessionId: row.session_id,
        activityId: row.activity_id,
        type: row.evidence_type,
        questionId: row.question_id,
        correctness: row.correctness,
        occurredAt: isoDateTime(row.occurred_at, "Evidence occurred_at"),
        recordedAt: isoDateTime(row.recorded_at, "Evidence recorded_at"),
        payload: jsonObject(row.payload_json, "Evidence payload"),
        provenance: jsonObject(row.provenance_json, "Evidence provenance"),
      }),
    );
  }

  async reconciliationReport(): Promise<CourseFoundationReconciliationReport> {
    const runs = this.#connection.sqlite
      .prepare(
        `SELECT id, source_database_digest, source_rows_digest,
                source_row_count, mapped_count, quarantined_count,
                intentionally_unmapped_count
         FROM migration_runs
         WHERE transform_version = 'm2-v1'
         ORDER BY source_rows_digest, id`,
      )
      .all() as Array<{
      id: string;
      source_database_digest: string;
      source_rows_digest: string;
      source_row_count: number;
      mapped_count: number;
      quarantined_count: number;
      intentionally_unmapped_count: number;
    }>;
    if (runs.length > 1) {
      throw new Error("Multiple m2-v1 reconciliation runs are not allowed");
    }
    const tableRows = this.#connection.sqlite
      .prepare(
        `SELECT source_table,
                COUNT(*) AS source_rows,
                SUM(CASE WHEN status = 'mapped' THEN 1 ELSE 0 END) AS mapped,
                SUM(CASE WHEN status = 'quarantined' THEN 1 ELSE 0 END) AS quarantined,
                SUM(CASE WHEN status = 'intentionally_unmapped' THEN 1 ELSE 0 END) AS intentionally_unmapped
         FROM migration_provenance
         WHERE transform_version = 'm2-v1'
         GROUP BY source_table
         ORDER BY source_table`,
      )
      .all() as Array<{
      source_table: string;
      source_rows: number;
      mapped: number;
      quarantined: number;
      intentionally_unmapped: number;
    }>;
    const reasonRows = this.#connection.sqlite
      .prepare(
        `SELECT reason_code, COUNT(*) AS count
         FROM migration_quarantine
         GROUP BY reason_code
         ORDER BY reason_code`,
      )
      .all() as Array<{ reason_code: string; count: number }>;
    const foreignKeyViolationCount = this.#connection.sqlite
      .prepare("PRAGMA foreign_key_check")
      .all().length;
    const run = runs[0];
    const sourceRows = run?.source_row_count ?? 0;
    const mapped = run?.mapped_count ?? 0;
    const quarantined = run?.quarantined_count ?? 0;
    const intentionallyUnmapped = run?.intentionally_unmapped_count ?? 0;
    return {
      transformVersion: "m2-v1",
      runId: run?.id ?? null,
      sourceDatabaseDigest: run?.source_database_digest ?? null,
      sourceRowsDigest: run?.source_rows_digest ?? null,
      sourceRows,
      mapped,
      quarantined,
      intentionallyUnmapped,
      accounted: sourceRows === mapped + quarantined + intentionallyUnmapped,
      foreignKeyViolationCount,
      tables: tableRows.map((row) => ({
        sourceTable: row.source_table,
        sourceRows: row.source_rows,
        mapped: row.mapped,
        quarantined: row.quarantined,
        intentionallyUnmapped: row.intentionally_unmapped,
      })),
      quarantineReasons: Object.fromEntries(
        reasonRows.map((row) => [row.reason_code, row.count]),
      ),
    };
  }
}

export function createCourseFoundationRepository(
  connection: DatabaseConnection,
): CourseFoundationRepository {
  return new CourseFoundationRepository(connection);
}
