import { createHash } from "node:crypto";

import {
  canonicalJson,
  hashCanonicalJson,
  type DatabaseConnection,
} from "@dlh/database";
import { SessionSnapshotSchema } from "@dlh/shared";

const currentSessionSnapshotSchemaVersion = 2;
const strictSessionSnapshotSchema = SessionSnapshotSchema.strict();

export const legacyLearningMutationError = {
  error: "Legacy learning mutations are frozen; use /api/learning/sessions/v2",
} as const;

export class LegacyLearningMutationError extends Error {
  constructor() {
    super(legacyLearningMutationError.error);
    this.name = "LegacyLearningMutationError";
  }
}

export function assertLearningRevisionMutationAllowed(
  curriculumVersionId: string,
): void {
  if (curriculumVersionId === "legacy-v1") {
    throw new LegacyLearningMutationError();
  }
}
export class CourseSessionContextError extends Error {
  constructor(message = "Learning session lacks verified Course context") {
    super(message);
    this.name = "CourseSessionContextError";
  }
}

interface SessionMutationAuthority {
  readonly sessionId: unknown;
  readonly curriculumDayV2Id: unknown;
  readonly snapshotId: unknown;
  readonly snapshotSessionId: unknown;
  readonly schemaVersion: unknown;
  readonly snapshotCourseId: unknown;
  readonly curriculumVersionId: unknown;
  readonly snapshotLessonId: unknown;
  readonly snapshotContentHash: unknown;
  readonly snapshotJson: unknown;
  readonly contextSessionId: unknown;
  readonly contextCourseId: unknown;
  readonly contextRevisionId: unknown;
  readonly contextLessonId: unknown;
  readonly contextSnapshotId: unknown;
  readonly contextSnapshotHash: unknown;
  readonly contextSnapshotBytesHash: unknown;
  readonly targetRevisionNumber: unknown;
  readonly hasCourseContext: number;
  readonly hasQuarantinedSnapshotAuthority: number;
}

export function assertLearningSessionMutationAllowed(
  connection: DatabaseConnection,
  sessionId: string,
): void {
  const row = readSessionMutationAuthority(connection, sessionId);
  if (!row) return;
  assertVersionedSession(row);
  if (!row.hasCourseContext && !row.hasQuarantinedSnapshotAuthority) {
    throw new CourseSessionContextError();
  }
}

export function assertCourseScopedSessionSideEffectAllowed(
  connection: DatabaseConnection,
  sessionId: string,
): void {
  const row = readSessionMutationAuthority(connection, sessionId);
  if (!row) {
    throw new CourseSessionContextError(
      "Course-scoped side effects require a mapped Course session context",
    );
  }
  assertVersionedSession(row);
  if (!hasVerifiedMappedCourseContext(connection, row, sessionId)) {
    throw new CourseSessionContextError(
      "Course-scoped side effects require a mapped Course session context",
    );
  }
  if (!isCurrentCourseSession(connection, row, sessionId)) {
    throw new CourseSessionContextError(
      "Course-scoped side effects require the Course's current active session",
    );
  }
}

function readSessionMutationAuthority(
  connection: DatabaseConnection,
  sessionId: string,
): SessionMutationAuthority | undefined {
  return connection.sqlite
    .prepare(
      `SELECT session.id AS sessionId,
              session.curriculum_day_v2_id AS curriculumDayV2Id,
              snapshot.id AS snapshotId,
              snapshot.session_id AS snapshotSessionId,
              snapshot.schema_version AS schemaVersion,
              snapshot.curriculum_id AS snapshotCourseId,
              snapshot.curriculum_version_id AS curriculumVersionId,
              snapshot.curriculum_day_id AS snapshotLessonId,
              snapshot.content_hash AS snapshotContentHash,
              snapshot.snapshot_json AS snapshotJson,
              context.session_id AS contextSessionId,
              context.course_id AS contextCourseId,
              context.revision_id AS contextRevisionId,
              context.lesson_id AS contextLessonId,
              context.session_snapshot_id AS contextSnapshotId,
              context.snapshot_hash AS contextSnapshotHash,
              context.snapshot_bytes_hash AS contextSnapshotBytesHash,
              target_revision.revision_number AS targetRevisionNumber,
              CASE WHEN context.session_id = session.id
                     AND snapshot.session_id = session.id
                     AND context.session_snapshot_id = snapshot.id
                     AND context.course_id = snapshot.curriculum_id
                     AND context.revision_id = snapshot.curriculum_version_id
                     AND context.lesson_id = snapshot.curriculum_day_id
                     AND context.snapshot_hash = snapshot.content_hash
                     AND session.curriculum_day_v2_id = snapshot.curriculum_day_id
                   THEN 1 ELSE 0 END AS hasCourseContext,
              EXISTS (
                SELECT 1
                FROM curriculum_versions revision
                JOIN curriculum_days_v2 lesson
                  ON lesson.id = snapshot.curriculum_day_id
                 AND lesson.version_id = revision.id
                JOIN migration_provenance revision_provenance
                  ON revision_provenance.transform_version = 'm2-v1'
                 AND revision_provenance.source_table = 'curriculum_versions'
                 AND revision_provenance.source_primary_key = revision.id
                 AND revision_provenance.status = 'quarantined'
                JOIN migration_provenance lesson_provenance
                  ON lesson_provenance.transform_version = 'm2-v1'
                 AND lesson_provenance.source_table = 'curriculum_days_v2'
                 AND lesson_provenance.source_primary_key = lesson.id
                 AND lesson_provenance.status = 'quarantined'
                JOIN migration_provenance snapshot_provenance
                  ON snapshot_provenance.transform_version = 'm2-v1'
                 AND snapshot_provenance.source_table = 'session_snapshots'
                 AND snapshot_provenance.source_primary_key = snapshot.id
                 AND snapshot_provenance.status = 'quarantined'
                WHERE revision.id = snapshot.curriculum_version_id
                  AND revision.curriculum_id = snapshot.curriculum_id
                  AND session.curriculum_day_v2_id = lesson.id
              ) AS hasQuarantinedSnapshotAuthority
       FROM learning_sessions session
       LEFT JOIN session_snapshots snapshot ON snapshot.session_id = session.id
       LEFT JOIN session_course_contexts context ON context.session_id = session.id
       LEFT JOIN course_revisions target_revision
         ON target_revision.id = context.revision_id
        AND target_revision.course_id = context.course_id
       WHERE session.id = ?`,
    )
    .get(sessionId) as SessionMutationAuthority | undefined;
}

function hasVerifiedMappedCourseContext(
  connection: DatabaseConnection,
  row: SessionMutationAuthority,
  requestedSessionId: string,
): boolean {
  if (
    row.hasCourseContext !== 1 ||
    row.sessionId !== requestedSessionId ||
    typeof row.curriculumDayV2Id !== "string" ||
    typeof row.snapshotId !== "string" ||
    row.snapshotSessionId !== requestedSessionId ||
    row.schemaVersion !== currentSessionSnapshotSchemaVersion ||
    typeof row.snapshotCourseId !== "string" ||
    typeof row.curriculumVersionId !== "string" ||
    typeof row.snapshotLessonId !== "string" ||
    typeof row.snapshotContentHash !== "string" ||
    typeof row.snapshotJson !== "string" ||
    row.contextSessionId !== requestedSessionId ||
    row.contextCourseId !== row.snapshotCourseId ||
    row.contextRevisionId !== row.curriculumVersionId ||
    row.contextLessonId !== row.snapshotLessonId ||
    row.contextSnapshotId !== row.snapshotId ||
    row.contextSnapshotHash !== row.snapshotContentHash ||
    typeof row.contextSnapshotBytesHash !== "string" ||
    typeof row.targetRevisionNumber !== "number" ||
    !Number.isSafeInteger(row.targetRevisionNumber) ||
    row.targetRevisionNumber < 1 ||
    row.curriculumDayV2Id !== row.snapshotLessonId ||
    createHash("sha256").update(row.snapshotJson).digest("hex") !==
      row.contextSnapshotBytesHash
  ) {
    return false;
  }

  try {
    const raw = JSON.parse(row.snapshotJson) as unknown;
    const parsed = strictSessionSnapshotSchema.safeParse(raw);
    if (!parsed.success || canonicalJson(raw) !== canonicalJson(parsed.data)) {
      return false;
    }
    const { contentHash, ...snapshotCore } = parsed.data;
    if (
      parsed.data.schemaVersion !== row.schemaVersion ||
      parsed.data.curriculumId !== row.snapshotCourseId ||
      parsed.data.curriculumVersionId !== row.curriculumVersionId ||
      parsed.data.curriculumRevision !== row.targetRevisionNumber ||
      parsed.data.day.id !== row.snapshotLessonId ||
      contentHash !== row.snapshotContentHash ||
      hashCanonicalJson(snapshotCore) !== row.snapshotContentHash
    ) {
      return false;
    }
    const targetActivities = connection.sqlite
      .prepare(
        `SELECT id, activity_type AS activityType
         FROM course_activities
         WHERE course_id = ? AND revision_id = ? AND lesson_id = ?
         ORDER BY order_index, id`,
      )
      .all(
        row.snapshotCourseId,
        row.curriculumVersionId,
        row.snapshotLessonId,
      ) as Array<{ id: unknown; activityType: unknown }>;
    return (
      targetActivities.length === parsed.data.units.length &&
      targetActivities.every(
        (activity, index) =>
          activity.id === parsed.data.units[index]?.id &&
          activity.activityType === parsed.data.units[index]?.type,
      )
    );
  } catch {
    return false;
  }
}

function isCurrentCourseSession(
  connection: DatabaseConnection,
  row: SessionMutationAuthority,
  sessionId: string,
): boolean {
  if (
    typeof row.contextCourseId !== "string" ||
    typeof row.contextRevisionId !== "string"
  ) {
    return false;
  }
  return Boolean(
    connection.sqlite
      .prepare(
        `SELECT 1
         FROM learner_course_states
         WHERE course_id = ? AND active_revision_id = ?
           AND current_learning_session_id = ?`,
      )
      .get(row.contextCourseId, row.contextRevisionId, sessionId),
  );
}

function assertVersionedSession(row: SessionMutationAuthority): void {
  if (
    typeof row.curriculumDayV2Id !== "string" ||
    typeof row.schemaVersion !== "number" ||
    !Number.isSafeInteger(row.schemaVersion) ||
    row.schemaVersion < 2 ||
    typeof row.curriculumVersionId !== "string"
  ) {
    throw new LegacyLearningMutationError();
  }
  assertLearningRevisionMutationAllowed(row.curriculumVersionId);
}
