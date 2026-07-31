import { createHash, randomUUID } from "node:crypto";

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

export interface CurriculumVersionGraph {
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
        .sort(([left], [right]) => left.localeCompare(right))
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
    };
    title: string;
    description?: string | null;
    parentVersionId?: string | null;
  }): Promise<CurriculumVersion> {
    const versionId = this.#id();
    withTransaction(this.#connection, () => {
      const now = this.#now();
      this.#connection.sqlite
        .prepare(
          `INSERT INTO curricula
           (id, slug, title, description, active_version_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, NULL, ?, ?)
           ON CONFLICT(id) DO UPDATE SET title = excluded.title,
             description = excluded.description, updated_at = excluded.updated_at`,
        )
        .run(
          input.curriculum.id,
          input.curriculum.slug,
          input.curriculum.title,
          input.curriculum.description ?? null,
          now,
          now,
        );
      const latest = this.#connection.sqlite
        .prepare(
          "SELECT COALESCE(MAX(revision), 0) AS revision FROM curriculum_versions WHERE curriculum_id = ?",
        )
        .get(input.curriculum.id) as { revision: number };
      this.#connection.sqlite
        .prepare(
          `INSERT INTO curriculum_versions
           (id, curriculum_id, revision, parent_version_id, status, title, description,
            content_hash, created_at, published_at, archived_at, updated_at)
           VALUES (?, ?, ?, ?, 'draft', ?, ?, NULL, ?, NULL, NULL, ?)`,
        )
        .run(
          versionId,
          input.curriculum.id,
          latest.revision + 1,
          input.parentVersionId ?? null,
          input.title,
          input.description ?? null,
          now,
          now,
        );
    });
    return this.#getVersion(versionId);
  }

  async addWeek(input: {
    versionId: string;
    stableId: string;
    title: string;
    description?: string | null;
    orderIndex?: number;
  }): Promise<CurriculumWeek> {
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

  async addDay(input: {
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
  }): Promise<CurriculumDayV2> {
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

  async addUnit(input: {
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
  }): Promise<CurriculumUnit> {
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

  async getVersionGraph(versionId: string): Promise<CurriculumVersionGraph> {
    const version = this.#getVersion(versionId);
    const weekRows = this.#connection.sqlite
      .prepare(
        "SELECT * FROM curriculum_weeks WHERE version_id = ? ORDER BY order_index, id",
      )
      .all(versionId) as WeekRow[];
    const dayRows = this.#connection.sqlite
      .prepare(
        "SELECT * FROM curriculum_days_v2 WHERE version_id = ? ORDER BY order_index, id",
      )
      .all(versionId) as DayRow[];
    const unitRows = this.#connection.sqlite
      .prepare(
        "SELECT * FROM curriculum_units WHERE version_id = ? ORDER BY order_index, id",
      )
      .all(versionId) as UnitRow[];
    return {
      version,
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
            outOfScope: parseArray(
              dayRow.out_of_scope_json,
              "day out-of-scope",
            ),
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
    const graph = await this.getVersionGraph(versionId);
    if (graph.version.status !== "draft") {
      throw new Error("Only a draft curriculum version can be published");
    }
    if (!graph.weeks.length || graph.weeks.some((week) => !week.days.length)) {
      throw new Error(
        "Published curriculum requires a non-empty week and day graph",
      );
    }
    const units = graph.weeks.flatMap((week) =>
      week.days.flatMap((day) => day.units),
    );
    if (
      !units.length ||
      units.some((unit) => !unit.completionCriteria.length)
    ) {
      throw new Error(
        "Every published day needs units with completion criteria",
      );
    }
    const content = {
      curriculumId: graph.version.curriculumId,
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
    const contentHash = hashCanonicalJson(content);
    withTransaction(this.#connection, () => {
      const now = this.#now();
      this.#connection.sqlite
        .prepare(
          `UPDATE curriculum_versions
           SET status = 'archived', archived_at = ?, updated_at = ?
           WHERE curriculum_id = ? AND status = 'published' AND id != ?`,
        )
        .run(now, now, graph.version.curriculumId, versionId);
      const result = this.#connection.sqlite
        .prepare(
          `UPDATE curriculum_versions
           SET status = 'published', content_hash = ?, published_at = ?, updated_at = ?
           WHERE id = ? AND status = 'draft'`,
        )
        .run(contentHash, now, now, versionId);
      if (result.changes !== 1)
        throw new Error("Draft changed while it was being published");
      this.#connection.sqlite
        .prepare(
          "UPDATE curricula SET active_version_id = ?, updated_at = ? WHERE id = ?",
        )
        .run(versionId, now, graph.version.curriculumId);
    });
    return this.#getVersion(versionId);
  }

  async cloneRevision(
    sourceVersionId: string,
    input: { title?: string; description?: string | null } = {},
  ): Promise<CurriculumVersion> {
    const graph = await this.getVersionGraph(sourceVersionId);
    const curriculum = this.#connection.sqlite
      .prepare(
        "SELECT id, slug, title, description FROM curricula WHERE id = ?",
      )
      .get(graph.version.curriculumId) as {
      id: string;
      slug: string;
      title: string;
      description: string | null;
    };
    const draft = await this.createDraft({
      curriculum,
      title: input.title ?? graph.version.title,
      description: input.description ?? graph.version.description,
      parentVersionId: sourceVersionId,
    });
    for (const week of graph.weeks) {
      const newWeek = await this.addWeek({
        versionId: draft.id,
        stableId: week.stableId,
        title: week.title,
        description: week.description,
        orderIndex: week.orderIndex,
      });
      for (const day of week.days) {
        const newDay = await this.addDay({
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
          await this.addUnit({
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
  }

  #assertDraft(versionId: string): void {
    const version = this.#connection.sqlite
      .prepare("SELECT status FROM curriculum_versions WHERE id = ?")
      .get(versionId) as { status: string } | undefined;
    if (!version) throw new Error(`Unknown curriculum version: ${versionId}`);
    if (version.status !== "draft") {
      throw new Error("Published curriculum version is immutable");
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
