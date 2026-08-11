import { createHash } from "node:crypto";

import {
  validateActivityGraph,
  type ActivityGraphIssue,
} from "@aptiloop/learning-core";
import {
  ActivityDefinitionSchema,
  SessionSnapshotSchema,
  UnitTypeSchema,
  type SessionSnapshot,
} from "@aptiloop/shared";

import type { DatabaseConnection } from "./database.js";

export const COURSE_FOUNDATION_TRANSFORM_VERSION = "m2-v1" as const;
const currentSessionSnapshotSchemaVersion = 2;
const strictSessionSnapshotSchema = SessionSnapshotSchema.strict();

export interface CourseFoundationBackfillBinding {
  readonly sourceDatabaseDigest: string;
  readonly approvedBackupLogicalSha256?: string;
  readonly approvedBackupSha256?: string;
  readonly approvedBackupPathHash?: string;
}

type SourceStatus = "mapped" | "quarantined" | "intentionally_unmapped";

type CandidateScope = {
  courseId?: string | undefined;
  revisionId?: string | undefined;
  lessonId?: string | undefined;
  activityId?: string | undefined;
};

type SourcePlan = CandidateScope & {
  table: string;
  primaryKey: string;
  rowHash: string;
  status: SourceStatus;
  targetEntityType?: string;
  targetId?: string;
  reasonCode?: string;
  diagnostic?: string;
};

type InvalidReason = {
  reasonCode: string;
  diagnostic: string;
};

type CurriculumRow = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  active_version_id: string | null;
  created_at: number;
  updated_at: number;
};

type RevisionRow = {
  id: string;
  curriculum_id: string;
  revision: number;
  parent_version_id: string | null;
  status: "draft" | "published" | "archived";
  title: string;
  description: string | null;
  content_hash: string | null;
  created_at: number;
  published_at: number | null;
  archived_at: number | null;
  updated_at: number;
};

type SectionRow = {
  id: string;
  version_id: string;
  stable_id: string;
  order_index: number;
  title: string;
  description: string | null;
  created_at: number;
  updated_at: number;
};

type LessonRow = {
  id: string;
  version_id: string;
  week_id: string;
  stable_id: string;
  order_index: number;
  title: string;
  description: string | null;
  goal: string;
  estimated_minutes: number;
  prerequisites_json: string;
  expected_outcomes_json: string;
  depth_level: string;
  out_of_scope_json: string;
  topics_json: string;
  created_at: number;
  updated_at: number;
};

type ActivityRow = {
  id: string;
  version_id: string;
  day_id: string;
  stable_id: string;
  type: string;
  order_index: number;
  title: string;
  description: string | null;
  estimated_minutes: number | null;
  objectives_json: string;
  checklist_json: string;
  sources_json: string;
  questions_json: string;
  misconceptions_json: string;
  reference_answer_json: string | null;
  completion_criteria_json: string;
  unlock_rules_json: string;
  optional: number;
  depth_level: string | null;
  payload_json: string;
  created_at: number;
  updated_at: number;
};

type SessionRow = {
  id: string;
  curriculum_day_v2_id: string | null;
};

type SessionSnapshotRow = {
  id: string;
  session_id: string;
  schema_version: number;
  curriculum_id: string | null;
  curriculum_version_id: string | null;
  curriculum_day_id: string | null;
  content_hash: string;
  snapshot_json: string;
  created_at: number;
};

type VersionedEvidenceRow = {
  id: string;
  session_id: string;
  unit_id: string;
  evidence_type: string;
  operation_id: string;
  question_id: string | null;
  payload_json: string;
  correctness: number | null;
  created_at: number;
};

type AnswerAttemptRow = {
  id: string;
  session_id: string;
  question_id: string;
  attempt_number: number;
  answer: string;
  correctness: number | null;
  feedback: string | null;
  idempotency_key: string | null;
  submitted_at: number;
};

type EvidenceInsert = {
  sourceTable: "versioned_unit_evidence" | "answer_attempts";
  sourcePrimaryKey: string;
  sourceRowHash: string;
  id: string;
  operationId: string;
  courseId: string;
  revisionId: string;
  lessonId: string;
  sessionId: string;
  activityId: string;
  evidenceType:
    "recall-attempt" | "quiz-answer" | "code-reading-attempt" | "summary";
  questionId: string | null;
  correctness: number | null;
  occurredAt: number;
  recordedAt: number;
  payloadJson: string;
};

const evidenceActivityType: Record<string, string | undefined> = {
  "recall-attempt": "recall",
  "quiz-answer": "quiz",
  "code-reading-attempt": "code-reading",
  summary: "summary",
};

const genericQuarantineTables = [
  "exercise_attempts",
  "test_runs",
  "reviews",
  "mastery_evidence",
  "hints",
  "hint_usages_v2",
  "mistakes",
  "flashcards",
  "interview_sessions",
  "agent_conversations",
  "agent_messages",
] as const;

const genericProjectionTables = [
  "mastery_scores",
  "unit_progress",
  "learner_state",
] as const;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
function inspectStrictSessionSnapshot(
  value: unknown,
): { snapshot: SessionSnapshot; coreHash: string } | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const raw = JSON.parse(value) as unknown;
    const parsed = strictSessionSnapshotSchema.safeParse(raw);
    if (!parsed.success || canonicalJson(raw) !== canonicalJson(parsed.data)) {
      return undefined;
    }
    const snapshotCore = { ...parsed.data } as Record<string, unknown>;
    Reflect.deleteProperty(snapshotCore, "contentHash");
    return {
      snapshot: parsed.data,
      coreHash: sha256(canonicalJson(snapshotCore)),
    };
  } catch {
    return undefined;
  }
}

function hashRow(row: Record<string, unknown>): string {
  return sha256(canonicalJson(row));
}

function isId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,199}$/u.test(value)
  );
}

function isStableId(value: unknown): value is string {
  return (
    typeof value === "string" && /^[a-z0-9][a-z0-9._/-]{0,199}$/u.test(value)
  );
}

function isText(value: unknown, maximum = 50_000): value is string {
  return (
    typeof value === "string" &&
    value === value.trim() &&
    value.length > 0 &&
    value.length <= maximum
  );
}

function isOptionalText(value: unknown, maximum = 50_000): boolean {
  return (
    value === null || (typeof value === "string" && value.length <= maximum)
  );
}

function isInteger(
  value: unknown,
  minimum = Number.MIN_SAFE_INTEGER,
): value is number {
  return Number.isSafeInteger(value) && Number(value) >= minimum;
}

function isHash(value: unknown): value is string {
  return (
    typeof value === "string" &&
    (/^[0-9a-f]{64}$/u.test(value) || /^sha256:[0-9a-f]{64}$/u.test(value))
  );
}

function parseArray(value: unknown): unknown[] | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function parseObject(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed !== null &&
      typeof parsed === "object" &&
      !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function safeSourcePrimaryKey(value: unknown, rowHash: string): string {
  const candidate = String(value ?? "");
  return candidate.trim().length > 0 && candidate.length <= 500
    ? candidate
    : `sha256:${rowHash}`;
}

function boundedDiagnostic(value: string): string {
  return value.length <= 500 ? value : `${value.slice(0, 497)}...`;
}

function activityGraphDiagnostic(
  issues: readonly ActivityGraphIssue[],
): string {
  const shown = issues
    .slice(0, 3)
    .map(
      (issue) =>
        `${issue.code}${issue.activityId === null ? "" : ` (${issue.activityId})`}: ${issue.message}`,
    )
    .join("; ");
  const omitted = issues.length > 3 ? `; ${issues.length - 3} more` : "";
  return boundedDiagnostic(
    `Activity graph rejected with ${issues.length} issue(s): ${shown}${omitted}`,
  );
}

function rows<T>(
  connection: DatabaseConnection,
  table: string,
  orderBy: string,
): T[] {
  return connection.sqlite
    .prepare(`SELECT * FROM ${table} ORDER BY ${orderBy}`)
    .all() as T[];
}

function recordMap<T extends { id: string }>(
  source: readonly T[],
): Map<string, T> {
  return new Map(source.map((row) => [row.id, row]));
}

function addInvalid(
  invalid: Map<string, InvalidReason>,
  id: string,
  reasonCode: string,
  diagnostic: string,
): boolean {
  if (invalid.has(id)) return false;
  invalid.set(id, { reasonCode, diagnostic: boundedDiagnostic(diagnostic) });
  return true;
}

function invalidGraphRemainder(
  nodes: readonly string[],
  prerequisites: ReadonlyMap<string, readonly string[]>,
): Set<string> {
  const indegree = new Map(nodes.map((id) => [id, 0]));
  const dependents = new Map<string, string[]>();
  for (const id of nodes) {
    for (const prerequisite of prerequisites.get(id) ?? []) {
      if (!indegree.has(prerequisite)) continue;
      indegree.set(id, (indegree.get(id) ?? 0) + 1);
      const list = dependents.get(prerequisite) ?? [];
      list.push(id);
      dependents.set(prerequisite, list);
    }
  }
  const queue = [...indegree.entries()]
    .filter(([, count]) => count === 0)
    .map(([id]) => id)
    .sort();
  let visited = 0;
  while (queue.length > 0) {
    const id = queue.shift()!;
    visited += 1;
    for (const dependent of (dependents.get(id) ?? []).sort()) {
      const next = (indegree.get(dependent) ?? 0) - 1;
      indegree.set(dependent, next);
      if (next === 0) {
        queue.push(dependent);
        queue.sort();
      }
    }
  }
  if (visited === nodes.length) return new Set();
  return new Set(
    [...indegree.entries()].filter(([, count]) => count > 0).map(([id]) => id),
  );
}

function exactStoredRow(
  connection: DatabaseConnection,
  table: string,
  idColumn: string,
  id: string,
): Record<string, unknown> | undefined {
  return connection.sqlite
    .prepare(`SELECT * FROM ${table} WHERE ${idColumn} = ?`)
    .get(id) as Record<string, unknown> | undefined;
}

function assertInsertedRow(
  connection: DatabaseConnection,
  table: string,
  idColumn: string,
  id: string,
  expected: Record<string, unknown>,
): void {
  const stored = exactStoredRow(connection, table, idColumn, id);
  if (!stored || canonicalJson(stored) !== canonicalJson(expected)) {
    throw new Error(`Course foundation target collision in ${table}`);
  }
}

export function backfillCourseFoundations(
  connection: DatabaseConnection,
  binding: CourseFoundationBackfillBinding,
): void {
  if (!/^[0-9a-f]{64}$/u.test(binding.sourceDatabaseDigest)) {
    throw new Error("Course foundation source database digest is invalid");
  }
  if (
    binding.approvedBackupLogicalSha256 !== undefined &&
    binding.approvedBackupLogicalSha256 !== binding.sourceDatabaseDigest
  ) {
    throw new Error(
      "Approved backup does not match the pre-migration database",
    );
  }
  for (const hash of [
    binding.approvedBackupLogicalSha256,
    binding.approvedBackupSha256,
    binding.approvedBackupPathHash,
  ]) {
    if (hash !== undefined && !/^[0-9a-f]{64}$/u.test(hash)) {
      throw new Error("Approved backup binding hash is invalid");
    }
  }

  const curricula = rows<CurriculumRow>(connection, "curricula", "id");
  const revisions = rows<RevisionRow>(connection, "curriculum_versions", "id");
  const sections = rows<SectionRow>(connection, "curriculum_weeks", "id");
  const lessons = rows<LessonRow>(connection, "curriculum_days_v2", "id");
  const activities = rows<ActivityRow>(connection, "curriculum_units", "id");
  const sessions = rows<SessionRow>(connection, "learning_sessions", "id");
  const snapshots = rows<SessionSnapshotRow>(
    connection,
    "session_snapshots",
    "id",
  );
  const versionedEvidence = rows<VersionedEvidenceRow>(
    connection,
    "versioned_unit_evidence",
    "id",
  );
  const answerAttempts = rows<AnswerAttemptRow>(
    connection,
    "answer_attempts",
    "id",
  );

  const curriculaById = recordMap(curricula);
  const revisionsById = recordMap(revisions);
  const sectionsById = recordMap(sections);
  const lessonsById = recordMap(lessons);
  const activitiesById = recordMap(activities);
  const sessionsById = recordMap(sessions);

  const courseInvalid = new Map<string, InvalidReason>();
  const revisionInvalid = new Map<string, InvalidReason>();
  const sectionInvalid = new Map<string, InvalidReason>();
  const lessonInvalid = new Map<string, InvalidReason>();
  const activityInvalid = new Map<string, InvalidReason>();
  const lessonPrerequisiteIds = new Map<string, string[]>();
  const activityPrerequisiteIds = new Map<string, string[]>();
  const parsedActivity = new Map<
    string,
    {
      objectives: unknown[];
      checklist: unknown[];
      sources: unknown[];
      questions: unknown[];
      misconceptions: unknown[];
      completionCriteria: unknown[];
      payload: Record<string, unknown>;
      referenceAnswer: unknown;
    }
  >();

  for (const course of curricula) {
    if (
      !isId(course.id) ||
      !isStableId(course.slug) ||
      !isText(course.title, 500) ||
      !(course.description === null || isText(course.description)) ||
      !isInteger(course.created_at, 0) ||
      !isInteger(course.updated_at, course.created_at)
    ) {
      addInvalid(
        courseInvalid,
        course.id,
        "MALFORMED_COURSE",
        "Course metadata cannot be represented by the target contract.",
      );
      continue;
    }
    if (course.active_version_id !== null) {
      const active = revisionsById.get(course.active_version_id);
      if (!active || active.curriculum_id !== course.id) {
        addInvalid(
          courseInvalid,
          course.id,
          "CROSS_SCOPE_ACTIVE_REVISION",
          "The active revision does not belong to this Course.",
        );
      }
    }
  }

  for (const revision of revisions) {
    if (
      !isId(revision.id) ||
      !isId(revision.curriculum_id) ||
      !isInteger(revision.revision, 1) ||
      !["draft", "published", "archived"].includes(revision.status) ||
      !isText(revision.title, 500) ||
      !isOptionalText(revision.description) ||
      (revision.content_hash !== null && !isHash(revision.content_hash)) ||
      (revision.status === "draft" && revision.content_hash !== null) ||
      (revision.status !== "draft" && !isHash(revision.content_hash)) ||
      (revision.status === "draft" && revision.published_at !== null) ||
      (revision.status !== "draft" && revision.published_at === null) ||
      !isInteger(revision.created_at, 0) ||
      !isInteger(revision.updated_at, revision.created_at) ||
      (revision.published_at !== null &&
        !isInteger(revision.published_at, revision.created_at)) ||
      (revision.archived_at !== null &&
        (revision.published_at === null ||
          !isInteger(revision.archived_at, revision.published_at)))
    ) {
      addInvalid(
        revisionInvalid,
        revision.id,
        "MALFORMED_REVISION",
        "Course revision metadata or its immutable content hash is malformed.",
      );
      continue;
    }
    if (revision.parent_version_id === revision.id) {
      addInvalid(
        revisionInvalid,
        revision.id,
        "MALFORMED_REVISION",
        "A Course revision cannot be its own parent.",
      );
    }
  }
  const revisionParentIds = new Map<string, readonly string[]>();
  for (const revision of revisions) {
    revisionParentIds.set(
      revision.id,
      revision.parent_version_id === null ? [] : [revision.parent_version_id],
    );
  }
  const revisionCycle = invalidGraphRemainder(
    revisions
      .filter((revision) => !revisionInvalid.has(revision.id))
      .map((revision) => revision.id),
    revisionParentIds,
  );
  for (const id of [...revisionCycle].sort()) {
    addInvalid(
      revisionInvalid,
      id,
      "REVISION_PARENT_CYCLE",
      "The Course revision parent graph is cyclic or depends on a cycle.",
    );
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const revision of revisions) {
      if (revisionInvalid.has(revision.id)) continue;
      if (
        !curriculaById.has(revision.curriculum_id) ||
        courseInvalid.has(revision.curriculum_id)
      ) {
        changed =
          addInvalid(
            revisionInvalid,
            revision.id,
            "PARENT_COURSE_QUARANTINED",
            "The parent Course is missing or quarantined.",
          ) || changed;
        continue;
      }
      if (revision.revision > 1 && revision.parent_version_id === null) {
        changed =
          addInvalid(
            revisionInvalid,
            revision.id,
            "MISSING_PARENT_REVISION",
            "A non-root revision requires an explicit parent revision.",
          ) || changed;
        continue;
      }
      if (revision.parent_version_id !== null) {
        const parent = revisionsById.get(revision.parent_version_id);
        if (
          !parent ||
          parent.curriculum_id !== revision.curriculum_id ||
          revisionInvalid.has(parent.id) ||
          parent.id === revision.id
        ) {
          changed =
            addInvalid(
              revisionInvalid,
              revision.id,
              "CROSS_SCOPE_PARENT_REVISION",
              "The parent revision is missing, cross-Course, self-referential, or quarantined.",
            ) || changed;
        }
      }
    }
    for (const course of curricula) {
      if (courseInvalid.has(course.id) || course.active_version_id === null)
        continue;
      if (revisionInvalid.has(course.active_version_id)) {
        changed =
          addInvalid(
            courseInvalid,
            course.id,
            "ACTIVE_REVISION_QUARANTINED",
            "The active revision is quarantined.",
          ) || changed;
      }
    }
  }

  for (const section of sections) {
    const revision = revisionsById.get(section.version_id);
    if (
      !isId(section.id) ||
      !revision ||
      revisionInvalid.has(section.version_id) ||
      courseInvalid.has(revision.curriculum_id) ||
      !isStableId(section.stable_id) ||
      !isInteger(section.order_index, 0) ||
      !isText(section.title, 500) ||
      !isOptionalText(section.description) ||
      !isInteger(section.created_at, 0) ||
      !isInteger(section.updated_at, section.created_at)
    ) {
      addInvalid(
        sectionInvalid,
        section.id,
        revision ? "PARENT_REVISION_QUARANTINED" : "MISSING_PARENT_REVISION",
        "Course section metadata or revision ownership is invalid.",
      );
    }
  }

  const lessonByRevisionStable = new Map<string, LessonRow>();
  for (const lesson of lessons) {
    lessonByRevisionStable.set(
      `${lesson.version_id}\u0000${lesson.stable_id}`,
      lesson,
    );
  }
  for (const lesson of lessons) {
    const revision = revisionsById.get(lesson.version_id);
    const section = sectionsById.get(lesson.week_id);
    const prerequisites = parseArray(lesson.prerequisites_json);
    const outcomes = parseArray(lesson.expected_outcomes_json);
    const outOfScope = parseArray(lesson.out_of_scope_json);
    const topics = parseArray(lesson.topics_json);
    if (
      !isId(lesson.id) ||
      !revision ||
      revisionInvalid.has(lesson.version_id) ||
      !section ||
      section.version_id !== lesson.version_id ||
      sectionInvalid.has(section.id) ||
      !isStableId(lesson.stable_id) ||
      !isInteger(lesson.order_index, 0) ||
      !isText(lesson.title, 500) ||
      !isText(lesson.description) ||
      !isText(lesson.goal) ||
      !isInteger(lesson.estimated_minutes, 1) ||
      !isText(lesson.depth_level, 100) ||
      !isInteger(lesson.created_at, 0) ||
      !isInteger(lesson.updated_at, lesson.created_at) ||
      !prerequisites ||
      !outcomes?.every((item) => typeof item === "string") ||
      !outOfScope?.every((item) => typeof item === "string") ||
      !topics?.every((item) => typeof item === "string") ||
      !prerequisites.every((item) => isId(item))
    ) {
      addInvalid(
        lessonInvalid,
        lesson.id,
        "MALFORMED_LESSON",
        "Course lesson metadata, JSON arrays, or section ownership is invalid.",
      );
      continue;
    }
    const unique = new Set(prerequisites as string[]);
    if (unique.size !== prerequisites.length || unique.has(lesson.stable_id)) {
      addInvalid(
        lessonInvalid,
        lesson.id,
        "MALFORMED_LESSON_PREREQUISITES",
        "Lesson prerequisites contain duplicates or a self-reference.",
      );
      continue;
    }
    const resolved: string[] = [];
    for (const stableId of unique) {
      const target = lessonByRevisionStable.get(
        `${lesson.version_id}\u0000${stableId}`,
      );
      if (!target) {
        addInvalid(
          lessonInvalid,
          lesson.id,
          "UNRESOLVED_LESSON_PREREQUISITE",
          "A lesson prerequisite does not resolve in the same revision.",
        );
        break;
      }
      resolved.push(target.id);
    }
    lessonPrerequisiteIds.set(lesson.id, resolved.sort());
  }

  changed = true;
  while (changed) {
    changed = false;
    for (const lesson of lessons) {
      if (lessonInvalid.has(lesson.id)) continue;
      if (
        (lessonPrerequisiteIds.get(lesson.id) ?? []).some((id) =>
          lessonInvalid.has(id),
        )
      ) {
        changed =
          addInvalid(
            lessonInvalid,
            lesson.id,
            "LESSON_PREREQUISITE_QUARANTINED",
            "A lesson prerequisite is quarantined.",
          ) || changed;
      }
    }
  }
  const lessonCycle = invalidGraphRemainder(
    lessons
      .filter((lesson) => !lessonInvalid.has(lesson.id))
      .map((lesson) => lesson.id),
    lessonPrerequisiteIds,
  );
  for (const id of [...lessonCycle].sort()) {
    addInvalid(
      lessonInvalid,
      id,
      "LESSON_PREREQUISITE_CYCLE",
      "The lesson prerequisite graph is cyclic or depends on a cycle.",
    );
  }

  const activityByLessonStable = new Map<string, ActivityRow>();
  const activitiesByLesson = new Map<string, ActivityRow[]>();
  for (const activity of activities) {
    activityByLessonStable.set(
      `${activity.day_id}\u0000${activity.stable_id}`,
      activity,
    );
    const members = activitiesByLesson.get(activity.day_id) ?? [];
    members.push(activity);
    activitiesByLesson.set(activity.day_id, members);
  }
  for (const members of activitiesByLesson.values()) {
    members.sort(
      (left, right) =>
        left.order_index - right.order_index || left.id.localeCompare(right.id),
    );
  }

  for (const activity of activities) {
    const revision = revisionsById.get(activity.version_id);
    const lesson = lessonsById.get(activity.day_id);
    const objectives = parseArray(activity.objectives_json);
    const checklist = parseArray(activity.checklist_json);
    const sources = parseArray(activity.sources_json);
    const questions = parseArray(activity.questions_json);
    const misconceptions = parseArray(activity.misconceptions_json);
    const completionCriteria = parseArray(activity.completion_criteria_json);
    const unlockRules = parseArray(activity.unlock_rules_json);
    const payload = parseObject(activity.payload_json);
    let referenceAnswer: unknown = null;
    let referenceAnswerValid = true;
    if (activity.reference_answer_json !== null) {
      try {
        referenceAnswer = JSON.parse(activity.reference_answer_json) as unknown;
      } catch {
        referenceAnswerValid = false;
      }
    }
    const activityTypeValid = UnitTypeSchema.safeParse(activity.type).success;
    if (
      !isId(activity.id) ||
      !revision ||
      revisionInvalid.has(activity.version_id) ||
      !lesson ||
      lesson.version_id !== activity.version_id ||
      lessonInvalid.has(activity.day_id) ||
      !isStableId(activity.stable_id) ||
      !activityTypeValid ||
      !isInteger(activity.order_index, 0) ||
      !isText(activity.title, 500) ||
      !isText(activity.description) ||
      (activity.estimated_minutes !== null &&
        !isInteger(activity.estimated_minutes, 1)) ||
      ![0, 1].includes(activity.optional) ||
      !isOptionalText(activity.depth_level, 100) ||
      !isInteger(activity.created_at, 0) ||
      !isInteger(activity.updated_at, activity.created_at) ||
      !objectives ||
      !checklist ||
      !sources?.every(
        (item) =>
          item !== null && typeof item === "object" && !Array.isArray(item),
      ) ||
      !questions?.every(
        (item) =>
          item !== null && typeof item === "object" && !Array.isArray(item),
      ) ||
      !misconceptions ||
      !completionCriteria ||
      !unlockRules ||
      !payload ||
      !referenceAnswerValid
    ) {
      addInvalid(
        activityInvalid,
        activity.id,
        activityTypeValid ? "MALFORMED_ACTIVITY" : "UNKNOWN_ACTIVITY_TYPE",
        activityTypeValid
          ? "Activity metadata, JSON payloads, or lesson ownership is invalid."
          : "The migrated Activity type is not in the closed UnitType set.",
      );
      continue;
    }

    const prerequisites: string[] = [];
    for (const [ruleIndex, rule] of unlockRules.entries()) {
      if (
        rule === null ||
        typeof rule !== "object" ||
        Array.isArray(rule) ||
        !("type" in rule) ||
        rule.type !== "unit-completed" ||
        !("unitId" in rule) ||
        !isId(rule.unitId)
      ) {
        addInvalid(
          activityInvalid,
          activity.id,
          "MALFORMED_ACTIVITY_PREREQUISITE",
          "An Activity prerequisite is not an exact unit-completed reference.",
        );
        prerequisites.push(
          `unresolved:${sha256(canonicalJson([activity.id, ruleIndex, rule]))}`,
        );
        continue;
      }
      const target = activityByLessonStable.get(
        `${activity.day_id}\u0000${rule.unitId}`,
      );
      if (!target) {
        addInvalid(
          activityInvalid,
          activity.id,
          "UNRESOLVED_ACTIVITY_PREREQUISITE",
          "An Activity prerequisite does not resolve to an Activity in the same Lesson.",
        );
        prerequisites.push(
          `unresolved:${sha256(canonicalJson([activity.day_id, rule.unitId]))}`,
        );
        continue;
      }
      prerequisites.push(target.id);
    }
    prerequisites.sort();
    activityPrerequisiteIds.set(activity.id, prerequisites);

    const sharedDefinition = ActivityDefinitionSchema.safeParse({
      id: activity.id,
      courseId: revision.curriculum_id,
      revisionId: activity.version_id,
      lessonId: activity.day_id,
      stableId: activity.stable_id,
      type: activity.type,
      order: activity.order_index,
      title: activity.title,
      description: activity.description,
      required: activity.optional === 0,
      prerequisiteActivityIds: prerequisites,
      capabilityIds: [],
      completionCriteria,
      payload,
      protectedMaterial: {
        referenceAnswer,
        questions,
      },
    });
    if (!sharedDefinition.success) {
      addInvalid(
        activityInvalid,
        activity.id,
        "MALFORMED_ACTIVITY",
        "Activity content does not satisfy the closed shared Activity contract.",
      );
      continue;
    }
    parsedActivity.set(activity.id, {
      objectives,
      checklist,
      sources,
      questions,
      misconceptions,
      completionCriteria,
      payload,
      referenceAnswer,
    });
  }

  for (const lesson of lessons) {
    const revision = revisionsById.get(lesson.version_id);
    if (!revision || lessonInvalid.has(lesson.id)) continue;
    const lessonActivities = activitiesByLesson.get(lesson.id) ?? [];
    const graph = validateActivityGraph(
      {
        courseId: revision.curriculum_id,
        revisionId: lesson.version_id,
        lessonId: lesson.id,
        entryActivityIds: lessonActivities
          .filter(
            (activity) =>
              (activityPrerequisiteIds.get(activity.id) ?? []).length === 0,
          )
          .map((activity) => activity.id),
        activities: lessonActivities.map((activity) => ({
          id: activity.id,
          stableId: activity.stable_id,
          courseId: revisionsById.get(activity.version_id)?.curriculum_id ?? "",
          revisionId: activity.version_id,
          lessonId: activity.day_id,
          type: activity.type,
          required: activity.optional === 0,
          prerequisiteActivityIds:
            activityPrerequisiteIds.get(activity.id) ?? [],
        })),
      },
      UnitTypeSchema.options,
    );
    if (!graph.valid) {
      const diagnostic = activityGraphDiagnostic(graph.issues);
      addInvalid(
        lessonInvalid,
        lesson.id,
        "INVALID_ACTIVITY_GRAPH",
        diagnostic,
      );
      const issuesByActivity = new Map<string, ActivityGraphIssue[]>();
      for (const issue of graph.issues) {
        if (issue.activityId === null) continue;
        const activityIssues = issuesByActivity.get(issue.activityId) ?? [];
        activityIssues.push(issue);
        issuesByActivity.set(issue.activityId, activityIssues);
      }
      for (const activity of lessonActivities) {
        const activityIssues = issuesByActivity.get(activity.id);
        addInvalid(
          activityInvalid,
          activity.id,
          "INVALID_ACTIVITY_GRAPH",
          activityIssues === undefined
            ? diagnostic
            : activityGraphDiagnostic(activityIssues),
        );
      }
      continue;
    }
    const invalidMember = lessonActivities.find((activity) =>
      activityInvalid.has(activity.id),
    );
    if (invalidMember) {
      addInvalid(
        lessonInvalid,
        lesson.id,
        "ACTIVITY_GRAPH_MEMBER_QUARANTINED",
        `Activity graph member ${invalidMember.id} is quarantined.`,
      );
    }
  }

  changed = true;
  while (changed) {
    changed = false;
    for (const activity of activities) {
      if (activityInvalid.has(activity.id)) continue;
      if (
        (activityPrerequisiteIds.get(activity.id) ?? []).some((id) =>
          activityInvalid.has(id),
        )
      ) {
        changed =
          addInvalid(
            activityInvalid,
            activity.id,
            "ACTIVITY_PREREQUISITE_QUARANTINED",
            "An Activity prerequisite is quarantined.",
          ) || changed;
      }
    }
  }

  changed = true;
  while (changed) {
    changed = false;
    for (const activity of activities) {
      if (activityInvalid.has(activity.id)) continue;
      if (
        lessonInvalid.has(activity.day_id) ||
        (activityPrerequisiteIds.get(activity.id) ?? []).some((id) =>
          activityInvalid.has(id),
        )
      ) {
        changed =
          addInvalid(
            activityInvalid,
            activity.id,
            "ACTIVITY_SCOPE_QUARANTINED",
            "The Activity's Lesson or prerequisite Activity is quarantined.",
          ) || changed;
      }
    }
    for (const lesson of lessons) {
      if (lessonInvalid.has(lesson.id)) continue;
      const hasRunnableActivity = activities.some(
        (activity) =>
          activity.day_id === lesson.id && !activityInvalid.has(activity.id),
      );
      if (
        !hasRunnableActivity ||
        (lessonPrerequisiteIds.get(lesson.id) ?? []).some((id) =>
          lessonInvalid.has(id),
        )
      ) {
        changed =
          addInvalid(
            lessonInvalid,
            lesson.id,
            hasRunnableActivity
              ? "LESSON_PREREQUISITE_QUARANTINED"
              : "LESSON_HAS_NO_VALID_ACTIVITY",
            hasRunnableActivity
              ? "A prerequisite Lesson is quarantined."
              : "The Lesson has no Activity satisfying the closed shared contract.",
          ) || changed;
      }
    }
  }

  const plans: SourcePlan[] = [];
  const planKeys = new Set<string>();
  let migrationTimestamp = 0;
  const addPlan = (
    table: string,
    sourcePrimaryKey: unknown,
    row: Record<string, unknown>,
    plan: Omit<SourcePlan, "table" | "primaryKey" | "rowHash">,
  ): SourcePlan => {
    const rowHash = hashRow(row);
    const primaryKey = safeSourcePrimaryKey(sourcePrimaryKey, rowHash);
    const key = `${table}\u0000${primaryKey}`;
    if (planKeys.has(key))
      throw new Error("Duplicate M2 source provenance identity");
    planKeys.add(key);
    for (const [column, value] of Object.entries(row)) {
      if (
        column.endsWith("_at") &&
        typeof value === "number" &&
        Number.isSafeInteger(value)
      ) {
        migrationTimestamp = Math.max(migrationTimestamp, value);
      }
    }
    const entry = { table, primaryKey, rowHash, ...plan };
    plans.push(entry);
    return entry;
  };

  for (const course of curricula) {
    const row = course as unknown as Record<string, unknown>;
    const invalid = courseInvalid.get(course.id);
    addPlan(
      "curricula",
      course.id,
      row,
      invalid
        ? {
            status: "quarantined",
            ...invalid,
            courseId: isId(course.id) ? course.id : undefined,
          }
        : {
            status: "mapped",
            targetEntityType: "course",
            targetId: course.id,
            courseId: course.id,
            reasonCode: "MAPPED_LOCALE_UNDETERMINED",
            diagnostic:
              "The source schema has no Course locale; the explicit BCP 47 value und is retained.",
          },
    );
  }
  for (const revision of revisions) {
    const invalid = revisionInvalid.get(revision.id);
    addPlan(
      "curriculum_versions",
      revision.id,
      revision as unknown as Record<string, unknown>,
      invalid
        ? {
            status: "quarantined",
            ...invalid,
            courseId: isId(revision.curriculum_id)
              ? revision.curriculum_id
              : undefined,
            revisionId: isId(revision.id) ? revision.id : undefined,
          }
        : {
            status: "mapped",
            targetEntityType: "course-revision",
            targetId: revision.id,
            courseId: revision.curriculum_id,
            revisionId: revision.id,
          },
    );
  }
  for (const section of sections) {
    const revision = revisionsById.get(section.version_id);
    const invalid = sectionInvalid.get(section.id);
    addPlan(
      "curriculum_weeks",
      section.id,
      section as unknown as Record<string, unknown>,
      invalid
        ? {
            status: "quarantined",
            ...invalid,
            courseId: revision?.curriculum_id,
            revisionId: isId(section.version_id)
              ? section.version_id
              : undefined,
          }
        : {
            status: "mapped",
            targetEntityType: "course-section",
            targetId: section.id,
            courseId: revision!.curriculum_id,
            revisionId: section.version_id,
          },
    );
  }
  for (const lesson of lessons) {
    const revision = revisionsById.get(lesson.version_id);
    const invalid = lessonInvalid.get(lesson.id);
    addPlan(
      "curriculum_days_v2",
      lesson.id,
      lesson as unknown as Record<string, unknown>,
      invalid
        ? {
            status: "quarantined",
            ...invalid,
            courseId: revision?.curriculum_id,
            revisionId: isId(lesson.version_id) ? lesson.version_id : undefined,
            lessonId: isId(lesson.id) ? lesson.id : undefined,
          }
        : {
            status: "mapped",
            targetEntityType: "course-lesson",
            targetId: lesson.id,
            courseId: revision!.curriculum_id,
            revisionId: lesson.version_id,
            lessonId: lesson.id,
          },
    );
  }
  for (const activity of activities) {
    const revision = revisionsById.get(activity.version_id);
    const invalid = activityInvalid.get(activity.id);
    addPlan(
      "curriculum_units",
      activity.id,
      activity as unknown as Record<string, unknown>,
      invalid
        ? {
            status: "quarantined",
            ...invalid,
            courseId: revision?.curriculum_id,
            revisionId: isId(activity.version_id)
              ? activity.version_id
              : undefined,
            lessonId: isId(activity.day_id) ? activity.day_id : undefined,
            activityId: isId(activity.id) ? activity.id : undefined,
          }
        : {
            status: "mapped",
            targetEntityType: "course-activity",
            targetId: activity.id,
            courseId: revision!.curriculum_id,
            revisionId: activity.version_id,
            lessonId: activity.day_id,
            activityId: activity.id,
          },
    );
    const sourceItems = parseArray(activity.sources_json) ?? [];
    for (const [index, source] of sourceItems.entries()) {
      const sourceRow = { unit_id: activity.id, source_index: index, source };
      addPlan(
        "curriculum_units.sources_json",
        `${activity.id}:${index}`,
        sourceRow,
        invalid
          ? {
              status: "quarantined",
              reasonCode: "SOURCE_PARENT_QUARANTINED",
              diagnostic:
                "A source declaration belongs to a quarantined Activity.",
              courseId: revision?.curriculum_id,
              revisionId: isId(activity.version_id)
                ? activity.version_id
                : undefined,
              lessonId: isId(activity.day_id) ? activity.day_id : undefined,
              activityId: isId(activity.id) ? activity.id : undefined,
            }
          : {
              status: "quarantined",
              reasonCode: "SOURCE_CAPTURE_UNAVAILABLE",
              diagnostic:
                "A live source declaration lacks immutable captured content and approved rights provenance.",
              courseId: revision!.curriculum_id,
              revisionId: activity.version_id,
              lessonId: activity.day_id,
              activityId: activity.id,
            },
      );
    }
  }

  const snapshotBySession = new Map(
    snapshots.map((snapshot) => [snapshot.session_id, snapshot]),
  );
  const validContextBySession = new Map<
    string,
    {
      snapshot: SessionSnapshotRow;
      courseId: string;
      revisionId: string;
      lessonId: string;
    }
  >();
  const snapshotInvalid = new Map<string, InvalidReason>();
  for (const snapshot of snapshots) {
    const session = sessionsById.get(snapshot.session_id);
    const revision = snapshot.curriculum_version_id
      ? revisionsById.get(snapshot.curriculum_version_id)
      : undefined;
    const lesson = snapshot.curriculum_day_id
      ? lessonsById.get(snapshot.curriculum_day_id)
      : undefined;
    const validatedSnapshot = inspectStrictSessionSnapshot(
      snapshot.snapshot_json,
    );
    const expectedActivities = lesson
      ? (activitiesByLesson.get(lesson.id) ?? [])
      : [];
    const snapshotActivitySequenceMatches =
      validatedSnapshot !== undefined &&
      revision !== undefined &&
      lesson !== undefined &&
      expectedActivities.length === validatedSnapshot.snapshot.units.length &&
      expectedActivities.every((activity, index) => {
        const unit = validatedSnapshot.snapshot.units[index];
        return (
          !activityInvalid.has(activity.id) &&
          activity.version_id === revision.id &&
          activity.day_id === lesson.id &&
          unit?.id === activity.id &&
          unit.type === activity.type
        );
      });
    if (
      !isId(snapshot.id) ||
      !session ||
      !isId(snapshot.curriculum_id) ||
      !isId(snapshot.curriculum_version_id) ||
      !isId(snapshot.curriculum_day_id) ||
      !revision ||
      revision.curriculum_id !== snapshot.curriculum_id ||
      revisionInvalid.has(revision.id) ||
      !lesson ||
      lesson.version_id !== revision.id ||
      lessonInvalid.has(lesson.id) ||
      session.curriculum_day_v2_id !== lesson.id ||
      snapshot.schema_version !== currentSessionSnapshotSchemaVersion ||
      !isHash(snapshot.content_hash) ||
      !validatedSnapshot ||
      !snapshotActivitySequenceMatches ||
      validatedSnapshot.snapshot.schemaVersion !== snapshot.schema_version ||
      validatedSnapshot.snapshot.curriculumId !== snapshot.curriculum_id ||
      validatedSnapshot.snapshot.curriculumVersionId !== revision.id ||
      validatedSnapshot.snapshot.curriculumRevision !== revision.revision ||
      validatedSnapshot.snapshot.day.id !== lesson.id ||
      validatedSnapshot.snapshot.contentHash !== snapshot.content_hash ||
      validatedSnapshot.coreHash !== snapshot.content_hash ||
      !isInteger(snapshot.created_at)
    ) {
      snapshotInvalid.set(snapshot.id, {
        reasonCode: "MALFORMED_SESSION_CONTEXT",
        diagnostic:
          "The session snapshot is malformed or has cross-scope Course, revision, lesson, or session references.",
      });
    } else {
      validContextBySession.set(snapshot.session_id, {
        snapshot,
        courseId: snapshot.curriculum_id,
        revisionId: revision.id,
        lessonId: lesson.id,
      });
    }
  }
  for (const snapshot of snapshots) {
    const context = validContextBySession.get(snapshot.session_id);
    const invalid = snapshotInvalid.get(snapshot.id);
    addPlan(
      "session_snapshots",
      snapshot.id,
      snapshot as unknown as Record<string, unknown>,
      invalid
        ? {
            status: "quarantined",
            ...invalid,
            courseId: isId(snapshot.curriculum_id)
              ? snapshot.curriculum_id
              : undefined,
            revisionId: isId(snapshot.curriculum_version_id)
              ? snapshot.curriculum_version_id
              : undefined,
            lessonId: isId(snapshot.curriculum_day_id)
              ? snapshot.curriculum_day_id
              : undefined,
          }
        : {
            status: "mapped",
            targetEntityType: "session-course-context",
            targetId: snapshot.session_id,
            courseId: context!.courseId,
            revisionId: context!.revisionId,
            lessonId: context!.lessonId,
          },
    );
  }
  for (const session of sessions) {
    const context = validContextBySession.get(session.id);
    addPlan(
      "learning_sessions",
      session.id,
      session as unknown as Record<string, unknown>,
      context
        ? {
            status: "mapped",
            targetEntityType: "session-course-context",
            targetId: session.id,
            courseId: context.courseId,
            revisionId: context.revisionId,
            lessonId: context.lessonId,
          }
        : {
            status: "quarantined",
            reasonCode: snapshotBySession.has(session.id)
              ? "SESSION_SNAPSHOT_QUARANTINED"
              : "MISSING_SESSION_SNAPSHOT",
            diagnostic: snapshotBySession.has(session.id)
              ? "The session's immutable Course context snapshot is quarantined."
              : "The session has no immutable Course context snapshot.",
          },
    );
  }

  const evidenceCandidates: EvidenceInsert[] = [];
  const evidenceInvalidPlans: Array<{
    table: string;
    primaryKey: string;
    row: Record<string, unknown>;
    reason: InvalidReason;
    scope?: CandidateScope | undefined;
  }> = [];
  for (const evidence of versionedEvidence) {
    const row = evidence as unknown as Record<string, unknown>;
    const rowHash = hashRow(row);
    const context = validContextBySession.get(evidence.session_id);
    const activity = activitiesById.get(evidence.unit_id);
    const payload = parseObject(evidence.payload_json);
    const expectedType = evidenceActivityType[evidence.evidence_type];
    if (
      !isId(evidence.id) ||
      !context ||
      !activity ||
      activityInvalid.has(activity.id) ||
      activity.version_id !== context.revisionId ||
      activity.day_id !== context.lessonId ||
      !expectedType ||
      activity.type !== expectedType ||
      !isId(evidence.operation_id) ||
      (evidence.question_id !== null && !isId(evidence.question_id)) ||
      (evidence.correctness !== null &&
        (typeof evidence.correctness !== "number" ||
          evidence.correctness < 0 ||
          evidence.correctness > 1)) ||
      !isInteger(evidence.created_at) ||
      !payload
    ) {
      evidenceInvalidPlans.push({
        table: "versioned_unit_evidence",
        primaryKey: evidence.id,
        row,
        reason: {
          reasonCode: expectedType
            ? "MALFORMED_OR_CROSS_SCOPE_EVIDENCE"
            : "UNKNOWN_EVIDENCE_TYPE",
          diagnostic: expectedType
            ? "Evidence payload, Activity type, or immutable session ownership is invalid."
            : "The evidence type is not in the closed migrated Evidence type set.",
        },
        scope: context
          ? {
              courseId: context.courseId,
              revisionId: context.revisionId,
              lessonId: context.lessonId,
              activityId: isId(evidence.unit_id) ? evidence.unit_id : undefined,
            }
          : undefined,
      });
      continue;
    }
    evidenceCandidates.push({
      sourceTable: "versioned_unit_evidence",
      sourcePrimaryKey: evidence.id,
      sourceRowHash: rowHash,
      id: evidence.id,
      operationId: evidence.operation_id,
      courseId: context.courseId,
      revisionId: context.revisionId,
      lessonId: context.lessonId,
      sessionId: evidence.session_id,
      activityId: evidence.unit_id,
      evidenceType: evidence.evidence_type as EvidenceInsert["evidenceType"],
      questionId: evidence.question_id,
      correctness: evidence.correctness,
      occurredAt: evidence.created_at,
      recordedAt: evidence.created_at,
      payloadJson: canonicalJson(payload),
    });
  }
  for (const answer of answerAttempts) {
    const row = answer as unknown as Record<string, unknown>;
    const rowHash = hashRow(row);
    const context = validContextBySession.get(answer.session_id);
    const activityId = `legacy-question:${answer.question_id}`;
    const activity = activitiesById.get(activityId);
    const evidenceType =
      activity?.type === "quiz"
        ? "quiz-answer"
        : activity?.type === "code-reading"
          ? "code-reading-attempt"
          : undefined;
    const operationId = isId(answer.idempotency_key)
      ? answer.idempotency_key
      : `answer-attempt:${answer.id}`;
    if (
      !isId(answer.id) ||
      !context ||
      !activity ||
      activityInvalid.has(activity.id) ||
      activity.version_id !== context.revisionId ||
      activity.day_id !== context.lessonId ||
      !evidenceType ||
      !isId(operationId) ||
      !isInteger(answer.attempt_number, 1) ||
      typeof answer.answer !== "string" ||
      (answer.correctness !== null &&
        (!isInteger(answer.correctness, 0) || answer.correctness > 100)) ||
      !isOptionalText(answer.feedback) ||
      !isInteger(answer.submitted_at)
    ) {
      evidenceInvalidPlans.push({
        table: "answer_attempts",
        primaryKey: answer.id,
        row,
        reason: {
          reasonCode: "ANSWER_EVIDENCE_OWNERSHIP_UNPROVEN",
          diagnostic:
            "The answer attempt cannot be tied exactly to an approved Activity type in its immutable session context.",
        },
        scope: context
          ? {
              courseId: context.courseId,
              revisionId: context.revisionId,
              lessonId: context.lessonId,
              activityId: isId(activityId) ? activityId : undefined,
            }
          : undefined,
      });
      continue;
    }
    evidenceCandidates.push({
      sourceTable: "answer_attempts",
      sourcePrimaryKey: answer.id,
      sourceRowHash: rowHash,
      id: answer.id,
      operationId,
      courseId: context.courseId,
      revisionId: context.revisionId,
      lessonId: context.lessonId,
      sessionId: answer.session_id,
      activityId,
      evidenceType,
      questionId: answer.question_id,
      correctness:
        answer.correctness === null ? null : answer.correctness / 100,
      occurredAt: answer.submitted_at,
      recordedAt: answer.submitted_at,
      payloadJson: canonicalJson({
        answer: answer.answer,
        attemptNumber: answer.attempt_number,
        correctness: answer.correctness,
        feedback: answer.feedback,
      }),
    });
  }

  const evidenceCollisions = new Set<EvidenceInsert>();
  for (const field of ["id", "operationId"] as const) {
    const groups = new Map<string, EvidenceInsert[]>();
    for (const evidence of evidenceCandidates) {
      const list = groups.get(evidence[field]) ?? [];
      list.push(evidence);
      groups.set(evidence[field], list);
    }
    for (const group of groups.values()) {
      if (group.length > 1)
        group.forEach((candidate) => evidenceCollisions.add(candidate));
    }
  }
  const mappedEvidence = evidenceCandidates.filter(
    (candidate) => !evidenceCollisions.has(candidate),
  );
  for (const invalid of evidenceInvalidPlans) {
    addPlan(invalid.table, invalid.primaryKey, invalid.row, {
      status: "quarantined",
      ...invalid.reason,
      ...invalid.scope,
    });
  }
  for (const evidence of evidenceCandidates) {
    const sourceRow =
      evidence.sourceTable === "versioned_unit_evidence"
        ? (versionedEvidence.find(
            (row) => row.id === evidence.sourcePrimaryKey,
          )! as unknown as Record<string, unknown>)
        : (answerAttempts.find(
            (row) => row.id === evidence.sourcePrimaryKey,
          )! as unknown as Record<string, unknown>);
    if (evidenceCollisions.has(evidence)) {
      addPlan(evidence.sourceTable, evidence.sourcePrimaryKey, sourceRow, {
        status: "quarantined",
        reasonCode: "EVIDENCE_IDENTITY_COLLISION",
        diagnostic:
          "The target Evidence ID or operation ID is not globally unique.",
        courseId: evidence.courseId,
        revisionId: evidence.revisionId,
        lessonId: evidence.lessonId,
        activityId: evidence.activityId,
      });
    } else {
      addPlan(evidence.sourceTable, evidence.sourcePrimaryKey, sourceRow, {
        status: "mapped",
        targetEntityType: "evidence-fact",
        targetId: evidence.id,
        courseId: evidence.courseId,
        revisionId: evidence.revisionId,
        lessonId: evidence.lessonId,
        activityId: evidence.activityId,
      });
    }
  }

  const legacyDays = rows<Record<string, unknown>>(
    connection,
    "curriculum_days",
    "id",
  );
  for (const row of legacyDays) {
    const id = String(row.id ?? "");
    const targetId = `legacy-day:${id}`;
    const target = lessonsById.get(targetId);
    addPlan(
      "curriculum_days",
      id,
      row,
      target && !lessonInvalid.has(targetId)
        ? { status: "mapped", targetEntityType: "course-lesson", targetId }
        : {
            status: "quarantined",
            reasonCode: "LEGACY_LESSON_PROJECTION_QUARANTINED",
            diagnostic:
              "The preserved legacy lesson projection is missing or quarantined.",
          },
    );
  }
  for (const table of ["questions", "exercises"] as const) {
    const prefix =
      table === "questions" ? "legacy-question:" : "legacy-exercise:";
    for (const row of rows<Record<string, unknown>>(connection, table, "id")) {
      const id = String(row.id ?? "");
      const targetId = `${prefix}${id}`;
      const target = activitiesById.get(targetId);
      addPlan(
        table,
        id,
        row,
        target && !activityInvalid.has(targetId)
          ? { status: "mapped", targetEntityType: "course-activity", targetId }
          : {
              status: "quarantined",
              reasonCode: "LEGACY_ACTIVITY_PROJECTION_QUARANTINED",
              diagnostic:
                "The preserved legacy Activity projection is missing or quarantined.",
            },
      );
    }
  }
  for (const row of rows<Record<string, unknown>>(connection, "topics", "id")) {
    addPlan("topics", row.id, row, {
      status: "intentionally_unmapped",
      reasonCode: "REPRESENTED_IN_LESSON_METADATA",
      diagnostic:
        "Legacy topic identity remains preserved in lesson topic metadata without inventing a target entity.",
    });
  }
  for (const row of rows<Record<string, unknown>>(
    connection,
    "curriculum_day_topics",
    "day_id, topic_id",
  )) {
    addPlan(
      "curriculum_day_topics",
      `${String(row.day_id)}:${String(row.topic_id)}`,
      row,
      {
        status: "intentionally_unmapped",
        reasonCode: "REPRESENTED_IN_LESSON_METADATA",
        diagnostic:
          "Legacy lesson-topic membership remains represented in migrated lesson metadata.",
      },
    );
  }

  for (const table of genericQuarantineTables) {
    for (const row of rows<Record<string, unknown>>(connection, table, "id")) {
      addPlan(table, row.id, row, {
        status: "quarantined",
        reasonCode:
          table === "mistakes" || table === "flashcards"
            ? "REVIEW_SOURCE_EVIDENCE_UNPROVEN"
            : "UNAPPROVED_HISTORICAL_FACT_TYPE",
        diagnostic:
          table === "mistakes" || table === "flashcards"
            ? "The review-like row has no provable approved source Evidence ownership."
            : "The historical fact does not establish an exact approved Evidence type and immutable Course scope.",
      });
    }
  }
  for (const table of genericProjectionTables) {
    for (const row of rows<Record<string, unknown>>(connection, table, "id")) {
      addPlan(table, row.id, row, {
        status: "intentionally_unmapped",
        reasonCode: "LEGACY_DERIVED_PROJECTION",
        diagnostic:
          "The legacy derived projection is preserved but is not translated into an authoritative target fact.",
      });
    }
  }

  plans.sort(
    (left, right) =>
      left.table.localeCompare(right.table) ||
      left.primaryKey.localeCompare(right.primaryKey),
  );
  const sourceRowsDigest = sha256(
    canonicalJson(
      plans.map((plan) => [plan.table, plan.primaryKey, plan.rowHash]),
    ),
  );
  const runId = `${COURSE_FOUNDATION_TRANSFORM_VERSION}:${sourceRowsDigest}`;
  const counts = {
    mapped: plans.filter((plan) => plan.status === "mapped").length,
    quarantined: plans.filter((plan) => plan.status === "quarantined").length,
    intentionallyUnmapped: plans.filter(
      (plan) => plan.status === "intentionally_unmapped",
    ).length,
  };

  connection.sqlite
    .prepare(
      `INSERT INTO migration_runs
       (id, transform_version, source_database_digest, source_rows_digest,
        approved_backup_logical_sha256, approved_backup_sha256,
        approved_backup_path_hash, status, source_row_count, mapped_count,
        quarantined_count, intentionally_unmapped_count, started_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      runId,
      COURSE_FOUNDATION_TRANSFORM_VERSION,
      binding.sourceDatabaseDigest,
      sourceRowsDigest,
      binding.approvedBackupLogicalSha256 ?? null,
      binding.approvedBackupSha256 ?? null,
      binding.approvedBackupPathHash ?? null,
      plans.length,
      counts.mapped,
      counts.quarantined,
      counts.intentionallyUnmapped,
      migrationTimestamp,
      migrationTimestamp,
    );

  const insertCourse = connection.sqlite.prepare(
    `INSERT INTO courses
     (id, stable_id, slug, title, description, primary_locale,
      active_revision_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'und', ?, ?, ?)`,
  );
  for (const course of curricula.filter((row) => !courseInvalid.has(row.id))) {
    insertCourse.run(
      course.id,
      course.slug,
      course.slug,
      course.title,
      course.description,
      course.active_version_id,
      course.created_at,
      course.updated_at,
    );
  }

  const insertRevision = connection.sqlite.prepare(
    `INSERT INTO course_revisions
     (id, course_id, revision_number, parent_revision_id, branch_kind, status,
      title, description, content_hash, based_on_content_hash, created_at,
      published_at, archived_at, updated_at)
     VALUES (?, ?, ?, NULL, 'upstream', ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
  );
  for (const revision of revisions.filter(
    (row) => !revisionInvalid.has(row.id),
  )) {
    insertRevision.run(
      revision.id,
      revision.curriculum_id,
      revision.revision,
      revision.status,
      revision.title,
      revision.description,
      revision.content_hash,
      revision.created_at,
      revision.published_at,
      revision.archived_at,
      revision.updated_at,
    );
  }

  const insertSection = connection.sqlite.prepare(
    `INSERT INTO course_sections
     (id, course_id, revision_id, stable_id, order_index, title, description,
      created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const section of sections.filter((row) => !sectionInvalid.has(row.id))) {
    const revision = revisionsById.get(section.version_id)!;
    insertSection.run(
      section.id,
      revision.curriculum_id,
      section.version_id,
      section.stable_id,
      section.order_index,
      section.title,
      section.description,
      section.created_at,
      section.updated_at,
    );
  }

  const insertLesson = connection.sqlite.prepare(
    `INSERT INTO course_lessons
     (id, course_id, revision_id, section_id, stable_id, order_index, title,
      description, goal, estimated_minutes, expected_outcomes_json, depth_level,
      out_of_scope_json, topics_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const lesson of lessons.filter((row) => !lessonInvalid.has(row.id))) {
    const revision = revisionsById.get(lesson.version_id)!;
    insertLesson.run(
      lesson.id,
      revision.curriculum_id,
      lesson.version_id,
      lesson.week_id,
      lesson.stable_id,
      lesson.order_index,
      lesson.title,
      lesson.description,
      lesson.goal,
      lesson.estimated_minutes,
      canonicalJson(parseArray(lesson.expected_outcomes_json)!),
      lesson.depth_level,
      canonicalJson(parseArray(lesson.out_of_scope_json)!),
      canonicalJson(parseArray(lesson.topics_json)!),
      lesson.created_at,
      lesson.updated_at,
    );
  }
  const insertLessonPrerequisite = connection.sqlite.prepare(
    `INSERT INTO course_lesson_prerequisites
     (course_id, revision_id, lesson_id, prerequisite_lesson_id)
     VALUES (?, ?, ?, ?)`,
  );
  for (const lesson of lessons.filter((row) => !lessonInvalid.has(row.id))) {
    const revision = revisionsById.get(lesson.version_id)!;
    for (const prerequisite of lessonPrerequisiteIds.get(lesson.id) ?? []) {
      insertLessonPrerequisite.run(
        revision.curriculum_id,
        lesson.version_id,
        lesson.id,
        prerequisite,
      );
    }
  }

  const insertActivity = connection.sqlite.prepare(
    `INSERT INTO course_activities
     (id, course_id, revision_id, lesson_id, stable_id, activity_type,
      order_index, title, description, estimated_minutes, required,
      objectives_json, checklist_json, sources_json, questions_json,
      misconceptions_json, capability_ids_json, completion_criteria_json,
      payload_json, protected_material_json, depth_level, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, ?, ?, ?)`,
  );
  for (const activity of activities.filter(
    (row) => !activityInvalid.has(row.id),
  )) {
    const revision = revisionsById.get(activity.version_id)!;
    const parsed = parsedActivity.get(activity.id)!;
    insertActivity.run(
      activity.id,
      revision.curriculum_id,
      activity.version_id,
      activity.day_id,
      activity.stable_id,
      activity.type,
      activity.order_index,
      activity.title,
      activity.description,
      activity.estimated_minutes,
      activity.optional === 0 ? 1 : 0,
      canonicalJson(parsed.objectives),
      canonicalJson(parsed.checklist),
      canonicalJson(parsed.sources),
      canonicalJson(parsed.questions),
      canonicalJson(parsed.misconceptions),
      canonicalJson(parsed.completionCriteria),
      canonicalJson(parsed.payload),
      canonicalJson({
        questions: parsed.questions,
        referenceAnswer: parsed.referenceAnswer,
      }),
      activity.depth_level,
      activity.created_at,
      activity.updated_at,
    );
  }
  const insertActivityPrerequisite = connection.sqlite.prepare(
    `INSERT INTO course_activity_prerequisites
     (course_id, revision_id, lesson_id, activity_id, prerequisite_activity_id)
     VALUES (?, ?, ?, ?, ?)`,
  );
  for (const activity of activities.filter(
    (row) => !activityInvalid.has(row.id),
  )) {
    const revision = revisionsById.get(activity.version_id)!;
    for (const prerequisite of activityPrerequisiteIds.get(activity.id) ?? []) {
      insertActivityPrerequisite.run(
        revision.curriculum_id,
        activity.version_id,
        activity.day_id,
        activity.id,
        prerequisite,
      );
    }
  }

  const insertContext = connection.sqlite.prepare(
    `INSERT INTO session_course_contexts
     (session_id, course_id, revision_id, lesson_id, session_snapshot_id,
      snapshot_hash, snapshot_bytes_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const [sessionId, context] of [
    ...validContextBySession.entries(),
  ].sort()) {
    insertContext.run(
      sessionId,
      context.courseId,
      context.revisionId,
      context.lessonId,
      context.snapshot.id,
      context.snapshot.content_hash,
      sha256(context.snapshot.snapshot_json),
      context.snapshot.created_at,
    );
  }

  const insertEvidence = connection.sqlite.prepare(
    `INSERT INTO evidence_facts
     (id, schema_version, operation_id, course_id, revision_id, lesson_id,
      session_id, activity_id, evidence_type, question_id, correctness,
      occurred_at, recorded_at, payload_json, provenance_json)
     VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const evidence of mappedEvidence.sort(
    (left, right) =>
      left.occurredAt - right.occurredAt || left.id.localeCompare(right.id),
  )) {
    insertEvidence.run(
      evidence.id,
      evidence.operationId,
      evidence.courseId,
      evidence.revisionId,
      evidence.lessonId,
      evidence.sessionId,
      evidence.activityId,
      evidence.evidenceType,
      evidence.questionId,
      evidence.correctness,
      evidence.occurredAt,
      evidence.recordedAt,
      evidence.payloadJson,
      canonicalJson({
        kind: "migration",
        sourceTable: evidence.sourceTable,
        sourcePrimaryKey: evidence.sourcePrimaryKey,
        sourceRowHash: evidence.sourceRowHash,
        transformVersion: COURSE_FOUNDATION_TRANSFORM_VERSION,
      }),
    );
  }

  const insertProvenance = connection.sqlite.prepare(
    `INSERT INTO migration_provenance
     (id, run_id, source_database_digest, source_table, source_primary_key,
      source_row_hash, target_entity_type, target_id, transform_version, status,
      reason_code, diagnostic, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertQuarantine = connection.sqlite.prepare(
    `INSERT INTO migration_quarantine
     (id, provenance_id, run_id, source_table, source_primary_key,
      source_row_hash, candidate_course_id, candidate_revision_id,
      candidate_lesson_id, candidate_activity_id, reason_code, diagnostic,
      resolution_status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unresolved', ?)`,
  );
  for (const plan of plans) {
    const provenanceId = `${COURSE_FOUNDATION_TRANSFORM_VERSION}:${sha256(
      canonicalJson([plan.table, plan.primaryKey]),
    )}`;
    insertProvenance.run(
      provenanceId,
      runId,
      binding.sourceDatabaseDigest,
      plan.table,
      plan.primaryKey,
      plan.rowHash,
      plan.targetEntityType ?? null,
      plan.targetId ?? null,
      COURSE_FOUNDATION_TRANSFORM_VERSION,
      plan.status,
      plan.reasonCode ?? null,
      plan.diagnostic ?? null,
      migrationTimestamp,
    );
    if (plan.status === "quarantined") {
      insertQuarantine.run(
        `${COURSE_FOUNDATION_TRANSFORM_VERSION}:q:${sha256(
          canonicalJson([plan.table, plan.primaryKey]),
        )}`,
        provenanceId,
        runId,
        plan.table,
        plan.primaryKey,
        plan.rowHash,
        plan.courseId ?? null,
        plan.revisionId ?? null,
        plan.lessonId ?? null,
        plan.activityId ?? null,
        plan.reasonCode!,
        plan.diagnostic!,
        migrationTimestamp,
      );
    }
  }

  const storedRun = exactStoredRow(connection, "migration_runs", "id", runId);
  if (!storedRun || Number(storedRun.source_row_count) !== plans.length) {
    throw new Error(
      "Course foundation reconciliation run was not persisted exactly",
    );
  }
  const foreignKeyViolations = connection.sqlite
    .prepare("PRAGMA foreign_key_check")
    .all();
  if (foreignKeyViolations.length > 0) {
    throw new Error(
      "Course foundation backfill produced a foreign-key violation",
    );
  }

  for (const course of curricula.filter((row) => !courseInvalid.has(row.id))) {
    assertInsertedRow(connection, "courses", "id", course.id, {
      id: course.id,
      stable_id: course.slug,
      slug: course.slug,
      title: course.title,
      description: course.description,
      primary_locale: "und",
      active_revision_id: course.active_version_id,
      created_at: course.created_at,
      updated_at: course.updated_at,
    });
  }
}
