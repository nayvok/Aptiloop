import { createHash, randomUUID } from "node:crypto";
import {
  resolveExplicitUnitDefinitions,
  validateActivityGraph,
} from "@aptiloop/learning-core";
import {
  CourseEntityIdSchema,
  CourseLocaleSchema,
  UnitUnlockRuleSchema,
  type CourseLocale,
} from "@aptiloop/shared";

import { adaptationBranchIdForRevision } from "./adaptation-branch.js";
import { withTransaction, type DatabaseConnection } from "./database.js";
import type {
  CurriculumDayV2,
  CurriculumUnit,
  CurriculumVersion,
  CurriculumWeek,
} from "./schema.js";

export interface CurriculumAuthoringRepositoryOptions {
  now?: () => number;
  id?: () => string;
}

export class CourseIdentityConflictError extends Error {
  constructor(readonly conflict: "id" | "slug") {
    super(`Course ${conflict} already belongs to an existing Course`);
    this.name = "CourseIdentityConflictError";
  }
}

type AddWeekInput = {
  versionId: string;
  stableId: string;
  title: string;
  description?: string | null;
  orderIndex?: number;
};

type AddDayInput = {
  versionId: string;
  weekId: string;
  stableId: string;
  title: string;
  description?: string | null;
  goal: string;
  estimatedMinutes: number;
  prerequisites?: unknown[];
  expectedOutcomes?: unknown[];
  depthLevel: string;
  outOfScope?: unknown[];
  topics?: unknown[];
  orderIndex?: number;
};

type AddUnitInput = {
  versionId: string;
  dayId: string;
  stableId: string;
  type: string;
  title: string;
  description?: string | null;
  estimatedMinutes?: number | null;
  objectives?: unknown[];
  checklist?: unknown[];
  sources?: unknown[];
  questions?: unknown[];
  misconceptions?: unknown[];
  referenceAnswer?: unknown;
  completionCriteria: unknown[];
  unlockRules?: unknown[];
  optional?: boolean;
  depthLevel?: string | null;
  payload?: Record<string, unknown>;
  orderIndex?: number;
};

export interface CurriculumVersionGraph {
  primaryLocale: CourseLocale;
  version: CurriculumVersion;
  weeks: Array<
    CurriculumWeek & {
      days: Array<
        CurriculumDayV2 & {
          prerequisites: unknown[];
          expectedOutcomes: unknown[];
          outOfScope: unknown[];
          topics: unknown[];
          units: Array<
            CurriculumUnit & {
              objectives: unknown[];
              checklist: unknown[];
              sources: unknown[];
              questions: unknown[];
              misconceptions: unknown[];
              referenceAnswer: unknown;
              completionCriteria: unknown[];
              unlockRules: unknown[];
              payload: Record<string, unknown>;
            }
          >;
        }
      >;
    }
  >;
}

type VersionRow = {
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

type WeekRow = {
  id: string;
  version_id: string;
  stable_id: string;
  order_index: number;
  title: string;
  description: string | null;
  created_at: number;
  updated_at: number;
};

type DayRow = {
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

type UnitRow = {
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

const unitTypes = new Set([
  "briefing",
  "study",
  "recall",
  "teacher-dialogue",
  "quiz",
  "code-reading",
  "exercise",
  "review",
  "interview",
  "summary",
  "checkpoint",
  "spaced-review",
]);

function json(value: unknown, label: string): string {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new Error("undefined");
    return serialized;
  } catch (error) {
    throw new Error(`Invalid ${label}: value must be JSON-serializable`, {
      cause: error,
    });
  }
}

function parseArray(value: string, label: string): unknown[] {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) throw new Error(`Invalid stored ${label}`);
  return parsed;
}

function parseObject(value: string, label: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Invalid stored ${label}`);
  }
  return parsed as Record<string, unknown>;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function hashCanonicalJson(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function mapVersion(row: VersionRow): CurriculumVersion {
  return {
    id: row.id,
    curriculumId: row.curriculum_id,
    revision: row.revision,
    parentVersionId: row.parent_version_id,
    status: row.status,
    title: row.title,
    description: row.description,
    contentHash: row.content_hash,
    createdAt: row.created_at,
    publishedAt: row.published_at,
    archivedAt: row.archived_at,
    updatedAt: row.updated_at,
  };
}

function mapWeek(row: WeekRow): CurriculumWeek {
  return {
    id: row.id,
    versionId: row.version_id,
    stableId: row.stable_id,
    orderIndex: row.order_index,
    title: row.title,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapDay(row: DayRow): CurriculumDayV2 {
  return {
    id: row.id,
    versionId: row.version_id,
    weekId: row.week_id,
    stableId: row.stable_id,
    orderIndex: row.order_index,
    title: row.title,
    description: row.description,
    goal: row.goal,
    estimatedMinutes: row.estimated_minutes,
    prerequisitesJson: row.prerequisites_json,
    expectedOutcomesJson: row.expected_outcomes_json,
    depthLevel: row.depth_level,
    outOfScopeJson: row.out_of_scope_json,
    topicsJson: row.topics_json,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapUnit(row: UnitRow): CurriculumUnit {
  return {
    id: row.id,
    versionId: row.version_id,
    dayId: row.day_id,
    stableId: row.stable_id,
    type: row.type,
    orderIndex: row.order_index,
    title: row.title,
    description: row.description,
    estimatedMinutes: row.estimated_minutes,
    objectivesJson: row.objectives_json,
    checklistJson: row.checklist_json,
    sourcesJson: row.sources_json,
    questionsJson: row.questions_json,
    misconceptionsJson: row.misconceptions_json,
    referenceAnswerJson: row.reference_answer_json,
    completionCriteriaJson: row.completion_criteria_json,
    unlockRulesJson: row.unlock_rules_json,
    optional: row.optional === 1,
    depthLevel: row.depth_level,
    payloadJson: row.payload_json,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function loadVersionGraph(
  connection: DatabaseConnection,
  versionId: string,
): CurriculumVersionGraph {
  const versionRow = connection.sqlite
    .prepare("SELECT * FROM curriculum_versions WHERE id = ?")
    .get(versionId) as VersionRow | undefined;
  if (!versionRow) throw new Error(`Unknown curriculum version: ${versionId}`);
  const hasCoursesTable =
    connection.sqlite
      .prepare(
        "SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'courses'",
      )
      .get() !== undefined;
  const primaryLocale = hasCoursesTable
    ? (() => {
        const courseRow = connection.sqlite
          .prepare("SELECT primary_locale FROM courses WHERE id = ?")
          .get(versionRow.curriculum_id) as
          { primary_locale: CourseLocale } | undefined;
        if (!courseRow) {
          throw new Error(
            `Unknown Course for curriculum version: ${versionId}`,
          );
        }
        return CourseLocaleSchema.parse(courseRow.primary_locale);
      })()
    : CourseLocaleSchema.parse("und");
  const weekRows = connection.sqlite
    .prepare(
      "SELECT * FROM curriculum_weeks WHERE version_id = ? ORDER BY order_index, id",
    )
    .all(versionId) as WeekRow[];
  const dayRows = connection.sqlite
    .prepare(
      "SELECT * FROM curriculum_days_v2 WHERE version_id = ? ORDER BY order_index, id",
    )
    .all(versionId) as DayRow[];
  const unitRows = connection.sqlite
    .prepare(
      "SELECT * FROM curriculum_units WHERE version_id = ? ORDER BY order_index, id",
    )
    .all(versionId) as UnitRow[];
  return {
    primaryLocale,
    version: mapVersion(versionRow),
    weeks: weekRows.map((weekRow) => ({
      ...mapWeek(weekRow),
      days: dayRows
        .filter((dayRow) => dayRow.week_id === weekRow.id)
        .map((dayRow) => ({
          ...mapDay(dayRow),
          prerequisites: parseArray(
            dayRow.prerequisites_json,
            "day prerequisites",
          ),
          expectedOutcomes: parseArray(
            dayRow.expected_outcomes_json,
            "day outcomes",
          ),
          outOfScope: parseArray(dayRow.out_of_scope_json, "day out-of-scope"),
          topics: parseArray(dayRow.topics_json, "day topics"),
          units: unitRows
            .filter((unitRow) => unitRow.day_id === dayRow.id)
            .map((unitRow) => ({
              ...mapUnit(unitRow),
              objectives: parseArray(
                unitRow.objectives_json,
                "unit objectives",
              ),
              checklist: parseArray(unitRow.checklist_json, "unit checklist"),
              sources: parseArray(unitRow.sources_json, "unit sources"),
              questions: parseArray(unitRow.questions_json, "unit questions"),
              misconceptions: parseArray(
                unitRow.misconceptions_json,
                "unit misconceptions",
              ),
              referenceAnswer:
                unitRow.reference_answer_json === null
                  ? null
                  : (JSON.parse(unitRow.reference_answer_json) as unknown),
              completionCriteria: parseArray(
                unitRow.completion_criteria_json,
                "unit completion criteria",
              ),
              unlockRules: parseArray(
                unitRow.unlock_rules_json,
                "unit unlock rules",
              ),
              payload: parseObject(unitRow.payload_json, "unit payload"),
            })),
        })),
    })),
  };
}

interface ResolvedGraphPrerequisites {
  readonly lessonIdsByLessonId: ReadonlyMap<string, readonly string[]>;
  readonly activityIdsByActivityId: ReadonlyMap<string, readonly string[]>;
}

function resolveGraphPrerequisites(
  graph: CurriculumVersionGraph,
): ResolvedGraphPrerequisites {
  const lessons = graph.weeks.flatMap((week) => week.days);
  const lessonIdByStableId = new Map<string, string>();
  for (const lesson of lessons) {
    if (lessonIdByStableId.has(lesson.stableId)) {
      throw new Error(`Duplicate lesson stable ID: ${lesson.stableId}`);
    }
    lessonIdByStableId.set(lesson.stableId, lesson.id);
  }
  const lessonIdsByLessonId = new Map<string, readonly string[]>();
  for (const lesson of lessons) {
    const stableIds = CourseEntityIdSchema.array().parse(lesson.prerequisites);
    const prerequisiteIds = stableIds.map((stableId) => {
      const prerequisiteId = lessonIdByStableId.get(stableId);
      if (prerequisiteId === undefined || prerequisiteId === lesson.id) {
        throw new Error(`Invalid lesson prerequisite: ${stableId}`);
      }
      return prerequisiteId;
    });
    if (new Set(prerequisiteIds).size !== prerequisiteIds.length) {
      throw new Error(`Duplicate lesson prerequisite: ${lesson.id}`);
    }
    lessonIdsByLessonId.set(lesson.id, prerequisiteIds);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visitLesson = (lessonId: string): void => {
    if (visiting.has(lessonId)) {
      throw new Error(`Cyclic lesson prerequisite: ${lessonId}`);
    }
    if (visited.has(lessonId)) return;
    visiting.add(lessonId);
    for (const prerequisiteId of lessonIdsByLessonId.get(lessonId) ?? []) {
      visitLesson(prerequisiteId);
    }
    visiting.delete(lessonId);
    visited.add(lessonId);
  };
  for (const lesson of lessons) visitLesson(lesson.id);

  const activityIdsByActivityId = new Map<string, readonly string[]>();
  for (const lesson of lessons) {
    const resolved = resolveExplicitUnitDefinitions(
      lesson.units.map((unit) => ({
        id: unit.id,
        stableId: unit.stableId,
        optional: unit.optional,
        prerequisiteStableIds: UnitUnlockRuleSchema.array()
          .parse(unit.unlockRules)
          .map((rule) => rule.unitId),
      })),
    );
    for (const definition of resolved) {
      activityIdsByActivityId.set(
        definition.id,
        definition.prerequisiteUnitIds ?? [],
      );
    }
    const validation = validateActivityGraph(
      {
        courseId: graph.version.curriculumId,
        revisionId: graph.version.id,
        lessonId: lesson.id,
        entryActivityIds: resolved
          .filter(
            (definition) => (definition.prerequisiteUnitIds?.length ?? 0) === 0,
          )
          .map((definition) => definition.id),
        activities: lesson.units.map((unit) => ({
          id: unit.id,
          stableId: unit.stableId,
          courseId: graph.version.curriculumId,
          revisionId: graph.version.id,
          lessonId: lesson.id,
          type: unit.type,
          required: !unit.optional,
          prerequisiteActivityIds: activityIdsByActivityId.get(unit.id) ?? [],
        })),
      },
      [...unitTypes],
    );
    if (!validation.valid) {
      throw new Error(
        `Activity graph is invalid: ${validation.issues
          .map((issue) => issue.code)
          .join(", ")}`,
      );
    }
  }
  return { lessonIdsByLessonId, activityIdsByActivityId };
}

export function publicationContent(graph: CurriculumVersionGraph): unknown {
  return {
    curriculumId: graph.version.curriculumId,
    primaryLocale: graph.primaryLocale,
    revision: graph.version.revision,
    title: graph.version.title,
    description: graph.version.description,
    weeks: graph.weeks.map(({ createdAt: _c, updatedAt: _u, ...week }) => ({
      ...week,
      days: week.days.map(({ createdAt: _dc, updatedAt: _du, ...day }) => ({
        ...day,
        units: day.units.map(
          ({ createdAt: _uc, updatedAt: _uu, ...unit }) => unit,
        ),
      })),
    })),
  };
}

function hasCourseProjectionSchema(connection: DatabaseConnection): boolean {
  return (
    connection.sqlite
      .prepare(
        "SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'course_revisions'",
      )
      .get() !== undefined
  );
}

function isCoursePackManifestRevision(
  connection: DatabaseConnection,
  versionId: string,
): boolean {
  const hasManifestStorage =
    connection.sqlite
      .prepare(
        "SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'course_pack_manifests'",
      )
      .get() !== undefined;
  if (!hasManifestStorage) return false;
  return (
    connection.sqlite
      .prepare("SELECT 1 FROM course_pack_manifests WHERE revision_id = ?")
      .get(versionId) !== undefined
  );
}

/** Rebuilds every draft Course descendant and edge from one source revision. */
export function synchronizeDraftCourseProjectionWithinTransaction(
  connection: DatabaseConnection,
  graph: CurriculumVersionGraph,
): void {
  const target = connection.sqlite
    .prepare(
      `SELECT course_id, status FROM course_revisions
       WHERE id = ?`,
    )
    .get(graph.version.id) as { course_id: string; status: string } | undefined;
  if (
    target?.course_id !== graph.version.curriculumId ||
    target.status !== "draft"
  ) {
    throw new Error(
      "Draft Course revision projection is missing or mismatched",
    );
  }
  const resolved = resolveGraphPrerequisites(graph);
  const args = [graph.version.curriculumId, graph.version.id] as const;
  connection.sqlite
    .prepare(
      "DELETE FROM course_activity_prerequisites WHERE course_id = ? AND revision_id = ?",
    )
    .run(...args);
  connection.sqlite
    .prepare(
      "DELETE FROM course_activities WHERE course_id = ? AND revision_id = ?",
    )
    .run(...args);
  connection.sqlite
    .prepare(
      "DELETE FROM course_lesson_prerequisites WHERE course_id = ? AND revision_id = ?",
    )
    .run(...args);
  connection.sqlite
    .prepare(
      "DELETE FROM course_lessons WHERE course_id = ? AND revision_id = ?",
    )
    .run(...args);
  connection.sqlite
    .prepare(
      "DELETE FROM course_sections WHERE course_id = ? AND revision_id = ?",
    )
    .run(...args);
  connection.sqlite
    .prepare(
      `INSERT INTO course_sections
         (id, course_id, revision_id, stable_id, order_index, title,
          description, created_at, updated_at)
       SELECT week.id, revision.curriculum_id, week.version_id, week.stable_id,
              week.order_index, week.title, week.description,
              week.created_at, week.updated_at
       FROM curriculum_weeks week
       JOIN curriculum_versions revision ON revision.id = week.version_id
       WHERE week.version_id = ?`,
    )
    .run(graph.version.id);
  connection.sqlite
    .prepare(
      `INSERT INTO course_lessons
         (id, course_id, revision_id, section_id, stable_id, order_index,
          title, description, goal, estimated_minutes, expected_outcomes_json,
          depth_level, out_of_scope_json, topics_json, created_at, updated_at)
       SELECT lesson.id, revision.curriculum_id, lesson.version_id,
              lesson.week_id, lesson.stable_id, lesson.order_index, lesson.title,
              COALESCE(lesson.description, lesson.title), lesson.goal,
              lesson.estimated_minutes, lesson.expected_outcomes_json,
              lesson.depth_level, lesson.out_of_scope_json, lesson.topics_json,
              lesson.created_at, lesson.updated_at
       FROM curriculum_days_v2 lesson
       JOIN curriculum_versions revision ON revision.id = lesson.version_id
       WHERE lesson.version_id = ?`,
    )
    .run(graph.version.id);
  connection.sqlite
    .prepare(
      `INSERT INTO course_activities
         (id, course_id, revision_id, lesson_id, stable_id, activity_type,
          order_index, title, description, estimated_minutes, required,
          objectives_json, checklist_json, sources_json, questions_json,
          misconceptions_json, capability_ids_json, completion_criteria_json,
          payload_json, protected_material_json, depth_level, created_at, updated_at)
       SELECT activity.id, revision.curriculum_id, activity.version_id,
              activity.day_id, activity.stable_id, activity.type,
              activity.order_index, activity.title,
              COALESCE(activity.description, activity.title),
              activity.estimated_minutes,
              CASE activity.optional WHEN 0 THEN 1 ELSE 0 END,
              activity.objectives_json, activity.checklist_json,
              activity.sources_json, activity.questions_json,
              activity.misconceptions_json, '[]',
              activity.completion_criteria_json, activity.payload_json,
              json_object(
                'referenceAnswer',
                CASE WHEN activity.reference_answer_json IS NULL
                  THEN NULL ELSE json(activity.reference_answer_json) END,
                'questions', json(activity.questions_json)
              ),
              activity.depth_level, activity.created_at, activity.updated_at
       FROM curriculum_units activity
       JOIN curriculum_versions revision ON revision.id = activity.version_id
       WHERE activity.version_id = ?`,
    )
    .run(graph.version.id);
  const insertLessonPrerequisite = connection.sqlite.prepare(
    `INSERT INTO course_lesson_prerequisites
       (course_id, revision_id, lesson_id, prerequisite_lesson_id)
     VALUES (?, ?, ?, ?)`,
  );
  for (const [lessonId, prerequisiteIds] of resolved.lessonIdsByLessonId) {
    for (const prerequisiteId of prerequisiteIds) {
      insertLessonPrerequisite.run(...args, lessonId, prerequisiteId);
    }
  }
  const insertActivityPrerequisite = connection.sqlite.prepare(
    `INSERT INTO course_activity_prerequisites
       (course_id, revision_id, lesson_id, activity_id,
        prerequisite_activity_id)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const lessonIdByActivityId = new Map(
    graph.weeks.flatMap((week) =>
      week.days.flatMap((lesson) =>
        lesson.units.map((activity) => [activity.id, lesson.id] as const),
      ),
    ),
  );
  for (const [
    activityId,
    prerequisiteIds,
  ] of resolved.activityIdsByActivityId) {
    const lessonId = lessonIdByActivityId.get(activityId);
    if (lessonId === undefined) {
      throw new Error(`Activity has no owning lesson: ${activityId}`);
    }
    for (const prerequisiteId of prerequisiteIds) {
      insertActivityPrerequisite.run(
        ...args,
        lessonId,
        activityId,
        prerequisiteId,
      );
    }
  }
  const counts = connection.sqlite
    .prepare(
      `SELECT
         (SELECT count(*) FROM curriculum_weeks WHERE version_id = ?) AS source_sections,
         (SELECT count(*) FROM course_sections WHERE course_id = ? AND revision_id = ?) AS target_sections,
         (SELECT count(*) FROM curriculum_days_v2 WHERE version_id = ?) AS source_lessons,
         (SELECT count(*) FROM course_lessons WHERE course_id = ? AND revision_id = ?) AS target_lessons,
         (SELECT count(*) FROM curriculum_units WHERE version_id = ?) AS source_activities,
         (SELECT count(*) FROM course_activities WHERE course_id = ? AND revision_id = ?) AS target_activities`,
    )
    .get(
      graph.version.id,
      ...args,
      graph.version.id,
      ...args,
      graph.version.id,
      ...args,
    ) as Record<string, number>;
  if (
    counts.source_sections !== counts.target_sections ||
    counts.source_lessons !== counts.target_lessons ||
    counts.source_activities !== counts.target_activities
  ) {
    throw new Error("Draft Course projection row counts do not match source");
  }
}

export interface PublishDraftCurriculumVersionInput {
  readonly versionId: string;
  readonly publishedAt: number;
  readonly expectedContentHash?: string;
  readonly courseUpdatedAt?: number;
}

/** Publishes source and Course projections atomically inside an open transaction. */
export function publishDraftCurriculumVersionWithinTransaction(
  connection: DatabaseConnection,
  input: PublishDraftCurriculumVersionInput,
): CurriculumVersion {
  const graph = loadVersionGraph(connection, input.versionId);
  if (graph.version.status !== "draft") {
    throw new Error("Only a draft curriculum version can be published");
  }
  if (isCoursePackManifestRevision(connection, input.versionId)) {
    throw new Error("Imported Course Pack manifest revision is immutable");
  }
  const hasPersonalAdaptationColumns = Boolean(
    connection.sqlite
      .prepare(
        "SELECT 1 FROM pragma_table_info('curriculum_versions') WHERE name = 'branch_kind'",
      )
      .get(),
  );
  if (hasPersonalAdaptationColumns) {
    const branch = connection.sqlite
      .prepare("SELECT branch_kind FROM curriculum_versions WHERE id = ?")
      .get(input.versionId) as { branch_kind: string } | undefined;
    if (branch?.branch_kind !== "upstream") {
      throw new Error(
        "Personal revisions require the personal Publish workflow",
      );
    }
  }
  if (!graph.weeks.length || graph.weeks.some((week) => !week.days.length)) {
    throw new Error(
      "Published curriculum requires a non-empty week and day graph",
    );
  }
  const units = graph.weeks.flatMap((week) =>
    week.days.flatMap((day) => day.units),
  );
  if (!units.length || units.some((unit) => !unit.completionCriteria.length)) {
    throw new Error("Every published day needs units with completion criteria");
  }
  const generatedContentHash = hashCanonicalJson(publicationContent(graph));
  const contentHash = input.expectedContentHash ?? generatedContentHash;
  const hasCourseProjection = hasCourseProjectionSchema(connection);
  if (hasCourseProjection) {
    synchronizeDraftCourseProjectionWithinTransaction(connection, graph);
  }
  const archivePublished = hasPersonalAdaptationColumns
    ? connection.sqlite.prepare(
        `UPDATE curriculum_versions
         SET status = 'archived', archived_at = ?, updated_at = ?
         WHERE curriculum_id = ? AND branch_kind = 'upstream'
           AND status = 'published' AND id != ?`,
      )
    : connection.sqlite.prepare(
        `UPDATE curriculum_versions
         SET status = 'archived', archived_at = ?, updated_at = ?
         WHERE curriculum_id = ? AND status = 'published' AND id != ?`,
      );
  archivePublished.run(
    input.publishedAt,
    input.publishedAt,
    graph.version.curriculumId,
    input.versionId,
  );
  const result = connection.sqlite
    .prepare(
      `UPDATE curriculum_versions
       SET status = 'published', content_hash = ?, published_at = ?, updated_at = ?
       WHERE id = ? AND status = 'draft'`,
    )
    .run(contentHash, input.publishedAt, input.publishedAt, input.versionId);
  if (result.changes !== 1) {
    throw new Error("Draft changed while it was being published");
  }
  connection.sqlite
    .prepare(
      "UPDATE curricula SET active_version_id = ?, updated_at = ? WHERE id = ?",
    )
    .run(
      input.versionId,
      input.courseUpdatedAt ?? input.publishedAt,
      graph.version.curriculumId,
    );
  if (hasCourseProjection) {
    const activeBranch = connection.sqlite
      .prepare(
        `SELECT id, base_revision_id, head_revision_id
         FROM adaptation_branches
         WHERE course_id = ? AND status = 'active'
         ORDER BY id`,
      )
      .all(graph.version.curriculumId) as Array<{
      id: string;
      base_revision_id: string;
      head_revision_id: string | null;
    }>;
    if (activeBranch.length > 1) {
      throw new Error(
        "Course has ambiguous active personal adaptation branches",
      );
    }
    if (
      activeBranch.length === 1 &&
      activeBranch[0]!.base_revision_id !== input.versionId &&
      activeBranch[0]!.head_revision_id !== input.versionId
    ) {
      connection.sqlite
        .prepare(
          `UPDATE adaptation_branches
           SET status = 'archived', updated_at = ?
           WHERE course_id = ? AND id = ? AND status = 'active'`,
        )
        .run(
          input.courseUpdatedAt ?? input.publishedAt,
          graph.version.curriculumId,
          activeBranch[0]!.id,
        );
    }
    const matchingBranch = connection.sqlite
      .prepare(
        `SELECT id FROM adaptation_branches
         WHERE course_id = ? AND base_revision_id = ?
         ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, id`,
      )
      .get(graph.version.curriculumId, input.versionId) as
      { id: string } | undefined;
    if (matchingBranch) {
      connection.sqlite
        .prepare(
          `UPDATE adaptation_branches
           SET status = 'active', updated_at = ?
           WHERE course_id = ? AND id = ? AND status = 'archived'`,
        )
        .run(
          input.courseUpdatedAt ?? input.publishedAt,
          graph.version.curriculumId,
          matchingBranch.id,
        );
    } else {
      const branchId = adaptationBranchIdForRevision(
        graph.version.curriculumId,
        input.versionId,
      );
      connection.sqlite
        .prepare(
          `INSERT INTO adaptation_branches
           (id, course_id, owner, base_revision_id, head_revision_id, status,
            created_at, updated_at)
           VALUES (?, ?, 'local', ?, NULL, 'active', ?, ?)`,
        )
        .run(
          branchId,
          graph.version.curriculumId,
          input.versionId,
          input.courseUpdatedAt ?? input.publishedAt,
          input.courseUpdatedAt ?? input.publishedAt,
        );
    }
  }
  if (hasCourseProjection) {
    const target = connection.sqlite
      .prepare(
        `SELECT status, content_hash FROM course_revisions
         WHERE course_id = ? AND id = ?`,
      )
      .get(graph.version.curriculumId, input.versionId) as
      { status: string; content_hash: string | null } | undefined;
    if (target?.status !== "published" || target.content_hash !== contentHash) {
      throw new Error("Published Course projection does not match source");
    }
  }
  return loadVersionGraph(connection, input.versionId).version;
}

export class CurriculumAuthoringRepository {
  readonly #connection: DatabaseConnection;
  readonly #now: () => number;
  readonly #id: () => string;

  constructor(
    connection: DatabaseConnection,
    options: CurriculumAuthoringRepositoryOptions = {},
  ) {
    this.#connection = connection;
    this.#now = options.now ?? Date.now;
    this.#id = options.id ?? randomUUID;
  }

  async createDraft(input: {
    curriculum: {
      id: string;
      slug: string;
      title: string;
      description?: string | null;
      primaryLocale: CourseLocale;
    };
    title: string;
    description?: string | null;
  }): Promise<CurriculumVersion> {
    const primaryLocale = CourseLocaleSchema.parse(
      input.curriculum.primaryLocale,
    );
    const versionId = this.#id();
    withTransaction(this.#connection, () => {
      const now = this.#now();
      const collision = this.#connection.sqlite
        .prepare(
          `SELECT CASE
             WHEN EXISTS (
               SELECT 1 FROM courses WHERE id = ? OR slug = ? OR stable_id = ?
             ) OR EXISTS (
               SELECT 1 FROM curricula WHERE id = ? OR slug = ?
             )
               THEN 'id'
             WHEN EXISTS (
               SELECT 1 FROM courses WHERE id = ? OR slug = ? OR stable_id = ?
             ) OR EXISTS (
               SELECT 1 FROM curricula WHERE id = ? OR slug = ?
             )
               THEN 'slug'
             ELSE NULL
           END AS conflict`,
        )
        .get(
          input.curriculum.id,
          input.curriculum.id,
          input.curriculum.id,
          input.curriculum.id,
          input.curriculum.id,
          input.curriculum.slug,
          input.curriculum.slug,
          input.curriculum.slug,
          input.curriculum.slug,
          input.curriculum.slug,
        ) as { conflict: "id" | "slug" | null };
      if (collision.conflict) {
        throw new CourseIdentityConflictError(collision.conflict);
      }
      this.#connection.sqlite
        .prepare(
          `INSERT INTO curricula
           (id, slug, title, description, active_version_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, NULL, ?, ?)`,
        )
        .run(
          input.curriculum.id,
          input.curriculum.slug,
          input.curriculum.title,
          input.curriculum.description ?? null,
          now,
          now,
        );
      this.#connection.sqlite
        .prepare("UPDATE courses SET primary_locale = ? WHERE id = ?")
        .run(primaryLocale, input.curriculum.id);
      this.#insertDraftVersion({
        versionId,
        curriculumId: input.curriculum.id,
        title: input.title,
        description: input.description ?? null,
        parentVersionId: null,
        now,
      });
    });
    return this.#getVersion(versionId);
  }

  addWeek(input: AddWeekInput): CurriculumWeek {
    return this.#addWeek(input);
  }

  #addWeek(input: AddWeekInput): CurriculumWeek {
    this.#assertDraft(input.versionId);
    const id = this.#id();
    const now = this.#now();
    const orderIndex =
      input.orderIndex ??
      this.#nextOrder("curriculum_weeks", "version_id", input.versionId);
    this.#connection.sqlite
      .prepare(
        `INSERT INTO curriculum_weeks
         (id, version_id, stable_id, order_index, title, description, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.versionId,
        input.stableId,
        orderIndex,
        input.title,
        input.description ?? null,
        now,
        now,
      );
    return mapWeek(
      this.#connection.sqlite
        .prepare("SELECT * FROM curriculum_weeks WHERE id = ?")
        .get(id) as WeekRow,
    );
  }

  updateWeek(input: {
    versionId: string;
    targetStableId: string;
    title?: string;
    description?: string | null;
    orderIndex?: number;
  }): CurriculumWeek {
    this.#assertDraft(input.versionId);
    const current = this.#connection.sqlite
      .prepare(
        "SELECT * FROM curriculum_weeks WHERE version_id = ? AND stable_id = ?",
      )
      .get(input.versionId, input.targetStableId) as WeekRow | undefined;
    if (!current) throw new Error(`Unknown week: ${input.targetStableId}`);
    this.#connection.sqlite
      .prepare(
        `UPDATE curriculum_weeks
         SET title = ?, description = ?, order_index = ?, updated_at = ?
         WHERE id = ? AND version_id = ?`,
      )
      .run(
        input.title ?? current.title,
        input.description !== undefined
          ? input.description
          : current.description,
        input.orderIndex ?? current.order_index,
        this.#now(),
        current.id,
        input.versionId,
      );
    return mapWeek(
      this.#connection.sqlite
        .prepare("SELECT * FROM curriculum_weeks WHERE id = ?")
        .get(current.id) as WeekRow,
    );
  }

  addDay(input: AddDayInput): CurriculumDayV2 {
    return this.#addDay(input);
  }

  #addDay(input: AddDayInput): CurriculumDayV2 {
    this.#assertDraft(input.versionId);
    const week = this.#connection.sqlite
      .prepare("SELECT version_id FROM curriculum_weeks WHERE id = ?")
      .get(input.weekId) as { version_id: string } | undefined;
    if (!week || week.version_id !== input.versionId) {
      throw new Error("Week does not belong to the draft version");
    }
    const id = this.#id();
    const now = this.#now();
    const orderIndex =
      input.orderIndex ??
      this.#nextOrder("curriculum_days_v2", "week_id", input.weekId);
    this.#connection.sqlite
      .prepare(
        `INSERT INTO curriculum_days_v2
         (id, version_id, week_id, stable_id, order_index, title, description, goal,
          estimated_minutes, prerequisites_json, expected_outcomes_json, depth_level,
          out_of_scope_json, topics_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.versionId,
        input.weekId,
        input.stableId,
        orderIndex,
        input.title,
        input.description ?? null,
        input.goal,
        input.estimatedMinutes,
        json(input.prerequisites ?? [], "day prerequisites"),
        json(input.expectedOutcomes ?? [], "day outcomes"),
        input.depthLevel,
        json(input.outOfScope ?? [], "day out-of-scope"),
        json(input.topics ?? [], "day topics"),
        now,
        now,
      );
    return mapDay(
      this.#connection.sqlite
        .prepare("SELECT * FROM curriculum_days_v2 WHERE id = ?")
        .get(id) as DayRow,
    );
  }

  updateDay(input: {
    versionId: string;
    targetStableId: string;
    title?: string;
    description?: string | null;
    goal?: string;
    estimatedMinutes?: number;
    prerequisites?: unknown[];
    expectedOutcomes?: unknown[];
    depthLevel?: string;
    outOfScope?: unknown[];
    topics?: unknown[];
    orderIndex?: number;
  }): CurriculumDayV2 {
    this.#assertDraft(input.versionId);
    const current = this.#connection.sqlite
      .prepare(
        "SELECT * FROM curriculum_days_v2 WHERE version_id = ? AND stable_id = ?",
      )
      .get(input.versionId, input.targetStableId) as DayRow | undefined;
    if (!current) throw new Error(`Unknown day: ${input.targetStableId}`);
    this.#connection.sqlite
      .prepare(
        `UPDATE curriculum_days_v2
         SET title = ?, description = ?, goal = ?, estimated_minutes = ?,
             prerequisites_json = ?, expected_outcomes_json = ?, depth_level = ?,
             out_of_scope_json = ?, topics_json = ?, order_index = ?, updated_at = ?
         WHERE id = ? AND version_id = ?`,
      )
      .run(
        input.title ?? current.title,
        input.description !== undefined
          ? input.description
          : current.description,
        input.goal ?? current.goal,
        input.estimatedMinutes ?? current.estimated_minutes,
        input.prerequisites === undefined
          ? current.prerequisites_json
          : json(input.prerequisites, "day prerequisites"),
        input.expectedOutcomes === undefined
          ? current.expected_outcomes_json
          : json(input.expectedOutcomes, "day outcomes"),
        input.depthLevel ?? current.depth_level,
        input.outOfScope === undefined
          ? current.out_of_scope_json
          : json(input.outOfScope, "day out-of-scope"),
        input.topics === undefined
          ? current.topics_json
          : json(input.topics, "day topics"),
        input.orderIndex ?? current.order_index,
        this.#now(),
        current.id,
        input.versionId,
      );
    return mapDay(
      this.#connection.sqlite
        .prepare("SELECT * FROM curriculum_days_v2 WHERE id = ?")
        .get(current.id) as DayRow,
    );
  }

  addUnit(input: AddUnitInput): CurriculumUnit {
    return this.#addUnit(input);
  }

  #addUnit(input: AddUnitInput): CurriculumUnit {
    this.#assertDraft(input.versionId);
    if (!unitTypes.has(input.type))
      throw new Error(`Unknown unit type: ${input.type}`);
    if (!input.completionCriteria.length) {
      throw new Error("Unit completion criteria cannot be empty");
    }
    const day = this.#connection.sqlite
      .prepare("SELECT version_id FROM curriculum_days_v2 WHERE id = ?")
      .get(input.dayId) as { version_id: string } | undefined;
    if (!day || day.version_id !== input.versionId) {
      throw new Error("Day does not belong to the draft version");
    }
    const id = this.#id();
    const now = this.#now();
    const orderIndex =
      input.orderIndex ??
      this.#nextOrder("curriculum_units", "day_id", input.dayId);
    this.#connection.sqlite
      .prepare(
        `INSERT INTO curriculum_units
         (id, version_id, day_id, stable_id, type, order_index, title, description,
          estimated_minutes, objectives_json, checklist_json, sources_json, questions_json,
          misconceptions_json, reference_answer_json, completion_criteria_json,
          unlock_rules_json, optional, depth_level, payload_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.versionId,
        input.dayId,
        input.stableId,
        input.type,
        orderIndex,
        input.title,
        input.description ?? null,
        input.estimatedMinutes ?? null,
        json(input.objectives ?? [], "unit objectives"),
        json(input.checklist ?? [], "unit checklist"),
        json(input.sources ?? [], "unit sources"),
        json(input.questions ?? [], "unit questions"),
        json(input.misconceptions ?? [], "unit misconceptions"),
        input.referenceAnswer === undefined
          ? null
          : json(input.referenceAnswer, "unit reference answer"),
        json(input.completionCriteria, "unit completion criteria"),
        json(input.unlockRules ?? [], "unit unlock rules"),
        input.optional ? 1 : 0,
        input.depthLevel ?? null,
        json(input.payload ?? {}, "unit payload"),
        now,
        now,
      );
    return mapUnit(
      this.#connection.sqlite
        .prepare("SELECT * FROM curriculum_units WHERE id = ?")
        .get(id) as UnitRow,
    );
  }

  updateUnit(input: {
    versionId: string;
    targetStableId: string;
    type?: string;
    title?: string;
    description?: string | null;
    estimatedMinutes?: number | null;
    objectives?: unknown[];
    checklist?: unknown[];
    sources?: unknown[];
    questions?: unknown[];
    misconceptions?: unknown[];
    referenceAnswer?: unknown;
    completionCriteria?: unknown[];
    unlockRules?: unknown[];
    optional?: boolean;
    depthLevel?: string | null;
    payload?: Record<string, unknown>;
    orderIndex?: number;
  }): CurriculumUnit {
    this.#assertDraft(input.versionId);
    const current = this.#connection.sqlite
      .prepare(
        "SELECT * FROM curriculum_units WHERE version_id = ? AND stable_id = ?",
      )
      .get(input.versionId, input.targetStableId) as UnitRow | undefined;
    if (!current) throw new Error(`Unknown unit: ${input.targetStableId}`);
    const type = input.type ?? current.type;
    if (!unitTypes.has(type)) throw new Error(`Unknown unit type: ${type}`);
    const payload =
      input.payload === undefined
        ? parseObject(current.payload_json, "unit payload")
        : input.payload;
    if (payload.type !== type) {
      throw new Error("Unit payload type must match unit type");
    }
    const completionCriteria =
      input.completionCriteria === undefined
        ? parseArray(
            current.completion_criteria_json,
            "unit completion criteria",
          )
        : input.completionCriteria;
    if (completionCriteria.length === 0) {
      throw new Error("Unit completion criteria cannot be empty");
    }
    this.#connection.sqlite
      .prepare(
        `UPDATE curriculum_units
         SET type = ?, title = ?, description = ?, estimated_minutes = ?,
             objectives_json = ?, checklist_json = ?, sources_json = ?, questions_json = ?,
             misconceptions_json = ?, reference_answer_json = ?, completion_criteria_json = ?,
             unlock_rules_json = ?, optional = ?, depth_level = ?, payload_json = ?,
             order_index = ?, updated_at = ?
         WHERE id = ? AND version_id = ?`,
      )
      .run(
        type,
        input.title ?? current.title,
        input.description !== undefined
          ? input.description
          : current.description,
        input.estimatedMinutes !== undefined
          ? input.estimatedMinutes
          : current.estimated_minutes,
        input.objectives === undefined
          ? current.objectives_json
          : json(input.objectives, "unit objectives"),
        input.checklist === undefined
          ? current.checklist_json
          : json(input.checklist, "unit checklist"),
        input.sources === undefined
          ? current.sources_json
          : json(input.sources, "unit sources"),
        input.questions === undefined
          ? current.questions_json
          : json(input.questions, "unit questions"),
        input.misconceptions === undefined
          ? current.misconceptions_json
          : json(input.misconceptions, "unit misconceptions"),
        input.referenceAnswer !== undefined
          ? json(input.referenceAnswer, "unit reference answer")
          : current.reference_answer_json,
        json(completionCriteria, "unit completion criteria"),
        input.unlockRules === undefined
          ? current.unlock_rules_json
          : json(input.unlockRules, "unit unlock rules"),
        input.optional === undefined
          ? current.optional
          : input.optional
            ? 1
            : 0,
        input.depthLevel !== undefined ? input.depthLevel : current.depth_level,
        json(payload, "unit payload"),
        input.orderIndex ?? current.order_index,
        this.#now(),
        current.id,
        input.versionId,
      );
    return mapUnit(
      this.#connection.sqlite
        .prepare("SELECT * FROM curriculum_units WHERE id = ?")
        .get(current.id) as UnitRow,
    );
  }

  async reorderUnits(input: {
    versionId: string;
    dayId: string;
    orderedUnitIds: readonly string[];
  }): Promise<void> {
    this.#reorder(
      input.versionId,
      "curriculum_units",
      "day_id",
      input.dayId,
      input.orderedUnitIds,
    );
  }

  async reorderWeeks(input: {
    versionId: string;
    orderedWeekIds: readonly string[];
  }): Promise<void> {
    this.#reorder(
      input.versionId,
      "curriculum_weeks",
      "version_id",
      input.versionId,
      input.orderedWeekIds,
    );
  }

  async reorderDays(input: {
    versionId: string;
    weekId: string;
    orderedDayIds: readonly string[];
  }): Promise<void> {
    this.#reorder(
      input.versionId,
      "curriculum_days_v2",
      "week_id",
      input.weekId,
      input.orderedDayIds,
    );
  }

  getVersionGraph(versionId: string): CurriculumVersionGraph {
    return loadVersionGraph(this.#connection, versionId);
  }

  async getActivePath(
    curriculumId: string,
  ): Promise<CurriculumVersionGraph | null> {
    const curriculum = this.#connection.sqlite
      .prepare("SELECT active_version_id FROM curricula WHERE id = ?")
      .get(curriculumId) as { active_version_id: string | null } | undefined;
    return curriculum?.active_version_id
      ? this.getVersionGraph(curriculum.active_version_id)
      : null;
  }

  async publishVersion(versionId: string): Promise<CurriculumVersion> {
    return withTransaction(this.#connection, () =>
      publishDraftCurriculumVersionWithinTransaction(this.#connection, {
        versionId,
        publishedAt: this.#now(),
      }),
    );
  }

  cloneRevision(
    sourceVersionId: string,
    input: { title?: string; description?: string | null } = {},
  ): CurriculumVersion {
    return withTransaction(this.#connection, () => {
      const graph = loadVersionGraph(this.#connection, sourceVersionId);
      const versionId = this.#id();
      const now = this.#now();
      this.#insertDraftVersion({
        versionId,
        curriculumId: graph.version.curriculumId,
        title: input.title ?? graph.version.title,
        description: input.description ?? graph.version.description,
        parentVersionId: sourceVersionId,
        now,
      });
      const draft = this.#getVersion(versionId);
      for (const week of graph.weeks) {
        const newWeek = this.#addWeek({
          versionId: draft.id,
          stableId: week.stableId,
          title: week.title,
          description: week.description,
          orderIndex: week.orderIndex,
        });
        for (const day of week.days) {
          const newDay = this.#addDay({
            versionId: draft.id,
            weekId: newWeek.id,
            stableId: day.stableId,
            title: day.title,
            description: day.description,
            goal: day.goal,
            estimatedMinutes: day.estimatedMinutes,
            prerequisites: day.prerequisites,
            expectedOutcomes: day.expectedOutcomes,
            depthLevel: day.depthLevel,
            outOfScope: day.outOfScope,
            topics: day.topics,
            orderIndex: day.orderIndex,
          });
          for (const unit of day.units) {
            this.#addUnit({
              versionId: draft.id,
              dayId: newDay.id,
              stableId: unit.stableId,
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
              orderIndex: unit.orderIndex,
            });
          }
        }
      }
      return draft;
    });
  }

  #insertDraftVersion(input: {
    versionId: string;
    curriculumId: string;
    title: string;
    description: string | null;
    parentVersionId: string | null;
    now: number;
  }): void {
    const latest = this.#connection.sqlite
      .prepare(
        "SELECT COALESCE(MAX(revision), 0) AS revision FROM curriculum_versions WHERE curriculum_id = ?",
      )
      .get(input.curriculumId) as { revision: number };
    this.#connection.sqlite
      .prepare(
        `INSERT INTO curriculum_versions
         (id, curriculum_id, revision, parent_version_id, status, title, description,
          content_hash, created_at, published_at, archived_at, updated_at)
         VALUES (?, ?, ?, ?, 'draft', ?, ?, NULL, ?, NULL, NULL, ?)`,
      )
      .run(
        input.versionId,
        input.curriculumId,
        latest.revision + 1,
        input.parentVersionId,
        input.title,
        input.description,
        input.now,
        input.now,
      );
  }

  #assertDraft(versionId: string): void {
    const version = this.#connection.sqlite
      .prepare("SELECT status FROM curriculum_versions WHERE id = ?")
      .get(versionId) as { status: string } | undefined;
    if (!version) throw new Error(`Unknown curriculum version: ${versionId}`);
    if (version.status !== "draft") {
      throw new Error("Published curriculum version is immutable");
    }
    if (isCoursePackManifestRevision(this.#connection, versionId)) {
      throw new Error("Imported Course Pack manifest revision is immutable");
    }
  }

  #getVersion(versionId: string): CurriculumVersion {
    const row = this.#connection.sqlite
      .prepare("SELECT * FROM curriculum_versions WHERE id = ?")
      .get(versionId) as VersionRow | undefined;
    if (!row) throw new Error(`Unknown curriculum version: ${versionId}`);
    return mapVersion(row);
  }

  #nextOrder(table: string, parentColumn: string, parentId: string): number {
    const allowed = new Set([
      "curriculum_weeks:version_id",
      "curriculum_days_v2:week_id",
      "curriculum_units:day_id",
    ]);
    if (!allowed.has(`${table}:${parentColumn}`))
      throw new Error("Unsafe order query");
    const row = this.#connection.sqlite
      .prepare(
        `SELECT COALESCE(MAX(order_index), -1) + 1 AS next_order FROM ${table} WHERE ${parentColumn} = ?`,
      )
      .get(parentId) as { next_order: number };
    return row.next_order;
  }

  #reorder(
    versionId: string,
    table: "curriculum_weeks" | "curriculum_days_v2" | "curriculum_units",
    parentColumn: "version_id" | "week_id" | "day_id",
    parentId: string,
    orderedIds: readonly string[],
  ): void {
    this.#assertDraft(versionId);
    const allowed = new Set([
      "curriculum_weeks:version_id",
      "curriculum_days_v2:week_id",
      "curriculum_units:day_id",
    ]);
    if (!allowed.has(`${table}:${parentColumn}`))
      throw new Error("Unsafe reorder query");
    withTransaction(this.#connection, () => {
      const current = this.#connection.sqlite
        .prepare(
          `SELECT id FROM ${table} WHERE version_id = ? AND ${parentColumn} = ? ORDER BY order_index`,
        )
        .all(versionId, parentId) as Array<{ id: string }>;
      if (
        current.length !== orderedIds.length ||
        current.some((row) => !orderedIds.includes(row.id))
      ) {
        throw new Error("Ordered IDs must contain every sibling exactly once");
      }
      const offset = current.length + 1_000_000;
      this.#connection.sqlite
        .prepare(
          `UPDATE ${table} SET order_index = order_index + ? WHERE version_id = ? AND ${parentColumn} = ?`,
        )
        .run(offset, versionId, parentId);
      const update = this.#connection.sqlite.prepare(
        `UPDATE ${table} SET order_index = ?, updated_at = ? WHERE id = ? AND version_id = ? AND ${parentColumn} = ?`,
      );
      orderedIds.forEach((id, index) =>
        update.run(index, this.#now(), id, versionId, parentId),
      );
    });
  }
}

export function createCurriculumAuthoringRepository(
  connection: DatabaseConnection,
  options?: CurriculumAuthoringRepositoryOptions,
): CurriculumAuthoringRepository {
  return new CurriculumAuthoringRepository(connection, options);
}
