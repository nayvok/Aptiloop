import { randomUUID } from "node:crypto";
import {
  SessionSnapshotSchema,
  UnitProgressPayloadSchema,
  UnitProgressSchema,
  UnitSchema,
  UnitStatusSchema,
  UnitTypeSchema,
  type SessionSnapshot,
  type UnitProgress as ContractUnitProgress,
  type UnitProgressPayload,
  type UnitStatus,
} from "@dlh/shared";
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  lte,
  or,
  sql,
  type SQL,
} from "drizzle-orm";

import { withTransaction, type DatabaseConnection } from "./database.js";
import {
  canonicalJson,
  CurriculumAuthoringRepository,
  hashCanonicalJson,
} from "./authoring-repository.js";
import {
  agentConversations,
  agentMessages,
  answerAttempts,
  applicationSettings,
  curriculumDays,
  curriculumDayTopics,
  exercises,
  flashcards,
  learningSessions,
  masteryScores,
  mistakes,
  providerConfigurations,
  questions,
  topics,
  type AnswerAttempt,
  type Flashcard,
  type LearningSession,
} from "./schema.js";
import {
  createInitialProgressPayload,
  toIsoDateTime,
} from "./snapshot-contract.js";
import {
  expectedUnitTypeForEvidence,
  parseEvidencePayload,
  serializeEvidencePayload,
  validateEvidenceCorrectness,
  validateEvidenceIdentifier,
  VERSIONED_EVIDENCE_TYPES,
  type ListVersionedUnitEvidenceFilter,
  type RecordVersionedUnitEvidenceInput,
  type VersionedEvidenceType,
  type VersionedUnitEvidenceRecord,
} from "./unit-evidence.js";

export type IdFactory = () => string;
export type Clock = () => number;

export interface RepositoryOptions {
  now?: Clock;
  id?: IdFactory;
}

export interface DashboardData {
  days: Array<{
    id: string;
    slug: string;
    dayNumber: number;
    title: string;
    estimatedMinutes: number;
    sessionStatus: string | null;
  }>;
  activeSession: LearningSession | null;
  dueFlashcards: number;
  openMistakes: number;
  completedDays: number;
  totalDays: number;
}

export interface SessionQuestion {
  id: string;
  kind: string;
  prompt: string;
  expectedSeconds: number | null;
  orderIndex: number;
  attempts: AnswerAttempt[];
  canRevealReference: boolean;
}

export interface SessionDetail {
  session: LearningSession;
  day: {
    id: string;
    slug: string;
    dayNumber: number;
    title: string;
    summary: string;
    estimatedMinutes: number;
    goals: string[];
    sources: unknown[];
  };
  topics: Array<{ id: string; slug: string; title: string }>;
  questions: SessionQuestion[];
  exercises: Array<{
    id: string;
    slug: string;
    title: string;
    prompt: string;
    difficulty: string;
    estimatedMinutes: number;
    workspacePath: string;
    constraints: string[];
    criteria: unknown[];
    allowedOperations: string[];
  }>;
}

export interface MasteryObservation {
  topicId: string;
  dimension: string;
  evidenceType: string;
  sourceId?: string;
  delta: number;
  score: number;
  confidence: number;
  evidenceTypes: readonly string[];
  observedAt?: number;
}

export interface MistakeInput {
  topicId: string;
  sourceType: string;
  sourceId: string;
  summary: string;
  correction: string;
  fingerprint: string;
}

export interface FlashcardCandidateInput {
  topicId?: string | null;
  sourceMistakeFingerprint?: string;
  front: string;
  back: string;
  idempotencyKey?: string;
}

export interface CompleteSessionInput {
  sessionId: string;
  mastery?: readonly MasteryObservation[];
  mistakes?: readonly MistakeInput[];
  flashcards?: readonly FlashcardCandidateInput[];
  completedAt?: number;
}

export interface VersionedSessionDetail {
  session: LearningSession;
  snapshot: SessionSnapshot;
  unitProgress: ContractUnitProgress[];
}

function parseJson<T>(
  value: string,
  label: string,
  guard: (input: unknown) => input is T,
): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`Invalid JSON stored in ${label}`);
  }
  if (!guard(parsed)) throw new Error(`Invalid value stored in ${label}`);
  return parsed;
}

function stringifyJson(value: unknown, label: string): string {
  try {
    const result = JSON.stringify(value);
    if (result === undefined) throw new Error("value is not JSON-serializable");
    return result;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "unknown serialization error";
    throw new Error(`Cannot serialize ${label}: ${message}`, { cause: error });
  }
}

const isStringArray = (input: unknown): input is string[] =>
  Array.isArray(input) && input.every((item) => typeof item === "string");
const isUnknownArray = (input: unknown): input is unknown[] =>
  Array.isArray(input);

interface VersionedUnitEvidenceRow {
  id: string;
  session_id: string;
  unit_id: string;
  evidence_type: VersionedEvidenceType;
  operation_id: string;
  question_id: string | null;
  payload_json: string;
  correctness: number | null;
  created_at: number;
}

function toVersionedUnitEvidenceRecord(
  row: VersionedUnitEvidenceRow,
): VersionedUnitEvidenceRecord {
  if (!VERSIONED_EVIDENCE_TYPES.includes(row.evidence_type)) {
    throw new Error("Invalid evidence type stored in versioned unit evidence");
  }
  return {
    id: row.id,
    sessionId: row.session_id,
    unitId: row.unit_id,
    evidenceType: row.evidence_type,
    operationId: row.operation_id,
    questionId: row.question_id,
    payload: parseEvidencePayload(row.payload_json),
    correctness: validateEvidenceCorrectness(row.correctness),
    createdAt: row.created_at,
  };
}

export class LearningRepository {
  readonly #connection: DatabaseConnection;
  readonly #now: Clock;
  readonly #id: IdFactory;

  constructor(connection: DatabaseConnection, options: RepositoryOptions = {}) {
    this.#connection = connection;
    this.#now = options.now ?? Date.now;
    this.#id = options.id ?? randomUUID;
  }

  async getDashboard(): Promise<DashboardData> {
    const now = this.#now();
    const days = await this.#connection.db
      .select({
        id: curriculumDays.id,
        slug: curriculumDays.slug,
        dayNumber: curriculumDays.dayNumber,
        title: curriculumDays.title,
        estimatedMinutes: curriculumDays.estimatedMinutes,
        sessionStatus: learningSessions.status,
      })
      .from(curriculumDays)
      .leftJoin(
        learningSessions,
        sql`${learningSessions.id} = (
          SELECT ls.id FROM learning_sessions ls
          WHERE ls.day_id = ${curriculumDays.id}
          ORDER BY ls.started_at DESC LIMIT 1
        )`,
      )
      .orderBy(asc(curriculumDays.weekNumber), asc(curriculumDays.dayNumber));

    const [activeSession] = await this.#connection.db
      .select()
      .from(learningSessions)
      .where(eq(learningSessions.status, "active"))
      .orderBy(desc(learningSessions.updatedAt))
      .limit(1);
    const [due] = await this.#connection.db
      .select({ count: sql<number>`count(*)` })
      .from(flashcards)
      .where(
        and(
          eq(flashcards.status, "approved"),
          or(isNull(flashcards.dueAt), lte(flashcards.dueAt, now)),
        ),
      );
    const [openMistakeCount] = await this.#connection.db
      .select({ count: sql<number>`count(*)` })
      .from(mistakes)
      .where(isNull(mistakes.resolvedAt));
    const [completed] = await this.#connection.db
      .select({ count: sql<number>`count(distinct ${learningSessions.dayId})` })
      .from(learningSessions)
      .where(eq(learningSessions.status, "completed"));

    return {
      days,
      activeSession: activeSession ?? null,
      dueFlashcards: due?.count ?? 0,
      openMistakes: openMistakeCount?.count ?? 0,
      completedDays: completed?.count ?? 0,
      totalDays: days.length,
    };
  }

  async startSession(input: {
    dayId: string;
    idempotencyKey?: string;
  }): Promise<SessionDetail> {
    const id = withTransaction(this.#connection, () => {
      if (input.idempotencyKey) {
        const existing = this.#connection.sqlite
          .prepare("SELECT id FROM learning_sessions WHERE idempotency_key = ?")
          .get(input.idempotencyKey) as { id: string } | undefined;
        if (existing) return existing.id;
      }
      const day = this.#connection.sqlite
        .prepare("SELECT id FROM curriculum_days WHERE id = ?")
        .get(input.dayId);
      if (!day) throw new Error(`Unknown curriculum day: ${input.dayId}`);
      const globalActive = this.#connection.sqlite
        .prepare(
          "SELECT id, day_id FROM learning_sessions WHERE status = 'active' ORDER BY updated_at DESC LIMIT 1",
        )
        .get() as { id: string; day_id: string } | undefined;
      if (globalActive && globalActive.day_id !== input.dayId) {
        throw new Error(
          `Another learning session is already active: ${globalActive.id}`,
        );
      }
      const active = this.#connection.sqlite
        .prepare(
          "SELECT id FROM learning_sessions WHERE day_id = ? AND status = 'active' ORDER BY started_at DESC LIMIT 1",
        )
        .get(input.dayId) as { id: string } | undefined;
      if (active) return active.id;

      const now = this.#now();
      const newId = this.#id();
      this.#connection.sqlite
        .prepare(
          `INSERT INTO learning_sessions
           (id, day_id, status, current_step, idempotency_key, started_at, completed_at, updated_at)
           VALUES (?, ?, 'active', 'questions', ?, ?, NULL, ?)`,
        )
        .run(newId, input.dayId, input.idempotencyKey ?? null, now, now);
      this.#connection.sqlite
        .prepare(
          `INSERT INTO learner_state (id, current_learning_session_id, updated_at)
           VALUES ('default', ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             current_learning_session_id = excluded.current_learning_session_id,
             updated_at = excluded.updated_at`,
        )
        .run(newId, now);
      return newId;
    });
    return this.getSession(id);
  }

  async getSession(sessionId: string): Promise<SessionDetail> {
    const [row] = await this.#connection.db
      .select({ session: learningSessions, day: curriculumDays })
      .from(learningSessions)
      .innerJoin(curriculumDays, eq(curriculumDays.id, learningSessions.dayId))
      .where(eq(learningSessions.id, sessionId))
      .limit(1);
    if (!row) throw new Error(`Unknown learning session: ${sessionId}`);

    const topicRows = await this.#connection.db
      .select({ id: topics.id, slug: topics.slug, title: topics.title })
      .from(curriculumDayTopics)
      .innerJoin(topics, eq(topics.id, curriculumDayTopics.topicId))
      .where(eq(curriculumDayTopics.dayId, row.day.id))
      .orderBy(asc(curriculumDayTopics.orderIndex));
    const questionRows = await this.#connection.db
      .select()
      .from(questions)
      .where(and(eq(questions.dayId, row.day.id), eq(questions.active, true)))
      .orderBy(asc(questions.orderIndex));
    const questionIds = questionRows.map((question) => question.id);
    const attempts = questionIds.length
      ? await this.#connection.db
          .select()
          .from(answerAttempts)
          .where(
            and(
              eq(answerAttempts.sessionId, sessionId),
              inArray(answerAttempts.questionId, questionIds),
            ),
          )
          .orderBy(asc(answerAttempts.submittedAt))
      : [];
    const exerciseRows = await this.#connection.db
      .select()
      .from(exercises)
      .where(and(eq(exercises.dayId, row.day.id), eq(exercises.active, true)));

    return {
      session: row.session,
      day: {
        id: row.day.id,
        slug: row.day.slug,
        dayNumber: row.day.dayNumber,
        title: row.day.title,
        summary: row.day.summary,
        estimatedMinutes: row.day.estimatedMinutes,
        goals: parseJson(
          row.day.goalsJson,
          "curriculum_days.goals_json",
          isStringArray,
        ),
        sources: parseJson(
          row.day.sourcesJson,
          "curriculum_days.sources_json",
          isUnknownArray,
        ),
      },
      topics: topicRows,
      questions: questionRows.map((question) => {
        const questionAttempts = attempts.filter(
          (attempt) => attempt.questionId === question.id,
        );
        return {
          id: question.id,
          kind: question.kind,
          prompt: question.prompt,
          expectedSeconds: question.expectedSeconds,
          orderIndex: question.orderIndex,
          attempts: questionAttempts,
          canRevealReference:
            questionAttempts.length >= question.revealAfterAttempts,
        };
      }),
      exercises: exerciseRows.map((exercise) => ({
        id: exercise.id,
        slug: exercise.slug,
        title: exercise.title,
        prompt: exercise.prompt,
        difficulty: exercise.difficulty,
        estimatedMinutes: exercise.estimatedMinutes,
        workspacePath: exercise.workspacePath,
        constraints: parseJson(
          exercise.constraintsJson,
          "exercises.constraints_json",
          isStringArray,
        ),
        criteria: parseJson(
          exercise.criteriaJson,
          "exercises.criteria_json",
          isUnknownArray,
        ),
        allowedOperations: parseJson(
          exercise.allowedOperationsJson,
          "exercises.allowed_operations_json",
          isStringArray,
        ),
      })),
    };
  }

  async startOrResumeVersionedSession(input: {
    dayId: string;
    idempotencyKey?: string;
  }): Promise<VersionedSessionDetail> {
    const current = await this.getCurrentVersionedSession();
    if (current) {
      if (current.snapshot.day.id !== input.dayId) {
        throw new Error(
          `Another learning session is already active: ${current.session.id}`,
        );
      }
      return current;
    }

    if (input.idempotencyKey) {
      const existing = this.#connection.sqlite
        .prepare(
          "SELECT id, curriculum_day_v2_id FROM learning_sessions WHERE idempotency_key = ?",
        )
        .get(input.idempotencyKey) as
        { id: string; curriculum_day_v2_id: string | null } | undefined;
      if (existing) {
        if (existing.curriculum_day_v2_id !== input.dayId) {
          throw new Error(
            "Idempotency key is already associated with another day",
          );
        }
        return this.getVersionedSession(existing.id);
      }
    }

    const dayRow = this.#connection.sqlite
      .prepare(
        `SELECT d.*, w.stable_id AS week_stable_id, w.title AS week_title,
                w.order_index AS week_order_index,
                v.curriculum_id, v.revision, v.status AS version_status,
                v.content_hash AS version_content_hash, c.title AS curriculum_title,
                c.active_version_id
         FROM curriculum_days_v2 d
         JOIN curriculum_weeks w ON w.id = d.week_id
         JOIN curriculum_versions v ON v.id = d.version_id
         JOIN curricula c ON c.id = v.curriculum_id
         WHERE d.id = ?`,
      )
      .get(input.dayId) as
      | (Record<string, unknown> & {
          id: string;
          version_id: string;
          stable_id: string;
          title: string;
          description: string | null;
          goal: string;
          estimated_minutes: number;
          prerequisites_json: string;
          expected_outcomes_json: string;
          depth_level: string;
          out_of_scope_json: string;
          topics_json: string;
          week_id: string;
          week_stable_id: string;
          week_title: string;
          week_order_index: number;
          curriculum_id: string;
          revision: number;
          version_status: string;
          version_content_hash: string;
          curriculum_title: string;
          active_version_id: string | null;
        })
      | undefined;
    if (!dayRow)
      throw new Error(`Unknown versioned curriculum day: ${input.dayId}`);
    if (
      dayRow.version_status !== "published" ||
      dayRow.active_version_id !== dayRow.version_id
    ) {
      throw new Error(
        "A learning session can only start from the active published version",
      );
    }

    const authoring = new CurriculumAuthoringRepository(this.#connection);
    const graph = await authoring.getVersionGraph(dayRow.version_id);
    const week = graph.weeks.find(
      (candidate) => candidate.id === dayRow.week_id,
    );
    const day = week?.days.find((candidate) => candidate.id === dayRow.id);
    if (!week || !day)
      throw new Error("Published curriculum graph is incomplete");
    const capturedAt = this.#now();
    const snapshotUnits = day.units.map((unit) =>
      UnitSchema.parse({
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
      }),
    );
    const snapshotCore = {
      schemaVersion: 2,
      curriculumId: dayRow.curriculum_id,
      curriculumVersionId: dayRow.version_id,
      curriculumRevision: dayRow.revision,
      curriculumTitle: dayRow.curriculum_title,
      week: {
        id: week.id,
        stableId: week.stableId,
        order: week.orderIndex + 1,
        title: week.title,
        description: week.description,
      },
      day: {
        id: day.id,
        stableId: day.stableId,
        order: day.orderIndex + 1,
        title: day.title,
        description: day.description ?? day.goal,
        goal: day.goal,
        estimatedMinutes: day.estimatedMinutes,
        prerequisites: day.prerequisites,
        expectedOutcomes: day.expectedOutcomes,
        depthLevel: day.depthLevel,
        outOfScope: day.outOfScope,
        topics: day.topics,
      },
      units: snapshotUnits,
      capturedAt: toIsoDateTime(capturedAt),
    };
    const contentHash = hashCanonicalJson(snapshotCore);
    const snapshot = SessionSnapshotSchema.parse({
      ...snapshotCore,
      contentHash,
    });
    const sessionId = this.#id();
    withTransaction(this.#connection, () => {
      const compatibilityDay = this.#connection.sqlite
        .prepare("SELECT id FROM curriculum_days WHERE id = ?")
        .get(day.id);
      if (!compatibilityDay) {
        const minimum = this.#connection.sqlite
          .prepare(
            "SELECT COALESCE(MIN(week_number), 0) - 1 AS week_number FROM curriculum_days",
          )
          .get() as { week_number: number };
        this.#connection.sqlite
          .prepare(
            `INSERT INTO curriculum_days
             (id, slug, week_number, day_number, title, summary, estimated_minutes,
              goals_json, sources_json, created_at, updated_at)
             VALUES (?, ?, ?, 1, ?, ?, ?, ?, '[]', ?, ?)`,
          )
          .run(
            day.id,
            `versioned-${day.id}`,
            minimum.week_number,
            day.title,
            day.description ?? day.goal,
            day.estimatedMinutes,
            stringifyJson(day.expectedOutcomes, "snapshot goals"),
            capturedAt,
            capturedAt,
          );
      }
      const firstRequired =
        day.units.find((unit) => !unit.optional) ?? day.units[0];
      if (!firstRequired) throw new Error("Cannot start a day without units");
      this.#connection.sqlite
        .prepare(
          `INSERT INTO learning_sessions
           (id, day_id, status, current_step, idempotency_key, started_at,
            completed_at, updated_at, curriculum_day_v2_id)
           VALUES (?, ?, 'active', ?, ?, ?, NULL, ?, ?)`,
        )
        .run(
          sessionId,
          day.id,
          firstRequired.stableId,
          input.idempotencyKey ?? null,
          capturedAt,
          capturedAt,
          day.id,
        );
      this.#connection.sqlite
        .prepare(
          `INSERT INTO session_snapshots
           (id, session_id, schema_version, curriculum_id, curriculum_version_id,
            curriculum_day_id, content_hash, snapshot_json, created_at)
           VALUES (?, ?, 2, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          this.#id(),
          sessionId,
          dayRow.curriculum_id,
          dayRow.version_id,
          day.id,
          contentHash,
          canonicalJson(snapshot),
          capturedAt,
        );
      const insertProgress = this.#connection.sqlite.prepare(
        `INSERT INTO unit_progress
         (id, session_id, unit_id, unit_type, status, progress_json, started_at,
          completed_at, skipped_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?)`,
      );
      for (const unit of day.units) {
        const unitType = UnitTypeSchema.parse(unit.type);
        insertProgress.run(
          this.#id(),
          sessionId,
          unit.id,
          unitType,
          unit.id === firstRequired.id ? "ready" : "locked",
          JSON.stringify(createInitialProgressPayload(unitType)),
          capturedAt,
        );
      }
      this.#connection.sqlite
        .prepare(
          `INSERT INTO learner_state (id, current_learning_session_id, updated_at)
           VALUES ('default', ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             current_learning_session_id = excluded.current_learning_session_id,
             updated_at = excluded.updated_at`,
        )
        .run(sessionId, capturedAt);
    });
    return this.getVersionedSession(sessionId);
  }

  async getCurrentVersionedSession(): Promise<VersionedSessionDetail | null> {
    const current = this.#connection.sqlite
      .prepare(
        `SELECT s.id FROM learner_state l
         JOIN learning_sessions s ON s.id = l.current_learning_session_id
         JOIN session_snapshots snapshot ON snapshot.session_id = s.id
         WHERE l.id = 'default' AND s.status = 'active'
           AND snapshot.schema_version >= 2
           AND snapshot.curriculum_version_id != 'legacy-v1'`,
      )
      .get() as { id: string } | undefined;
    return current ? this.getVersionedSession(current.id) : null;
  }

  async getVersionedSession(
    sessionId: string,
  ): Promise<VersionedSessionDetail> {
    const sessionRow = this.#connection.sqlite
      .prepare("SELECT * FROM learning_sessions WHERE id = ?")
      .get(sessionId) as
      | {
          id: string;
          day_id: string;
          status: "active" | "completed" | "abandoned";
          current_step: string;
          idempotency_key: string | null;
          started_at: number;
          completed_at: number | null;
          updated_at: number;
          curriculum_day_v2_id: string | null;
        }
      | undefined;
    const snapshotRow = this.#connection.sqlite
      .prepare(
        "SELECT snapshot_json FROM session_snapshots WHERE session_id = ?",
      )
      .get(sessionId) as { snapshot_json: string } | undefined;
    if (!sessionRow || !snapshotRow) {
      throw new Error(`Unknown versioned learning session: ${sessionId}`);
    }
    const storedSnapshot = SessionSnapshotSchema.parse(
      JSON.parse(snapshotRow.snapshot_json),
    );
    const parsed = SessionSnapshotSchema.parse({
      ...storedSnapshot,
      units: storedSnapshot.units.map((unit) => ({
        ...unit,
        referenceAnswer: null,
        questions: unit.questions.map((question) => ({
          ...question,
          correctOptionIds: [],
          referenceAnswer: null,
          evaluationPoints: [],
        })),
      })),
    });
    const progressRows = this.#connection.sqlite
      .prepare(`SELECT p.* FROM unit_progress p WHERE p.session_id = ?`)
      .all(sessionId) as Array<{
      id: string;
      session_id: string;
      unit_id: string;
      unit_type: string;
      status: UnitStatus;
      progress_json: string;
      started_at: number | null;
      completed_at: number | null;
      skipped_at: number | null;
      updated_at: number;
    }>;
    return {
      session: {
        id: sessionRow.id,
        dayId: sessionRow.day_id,
        status: sessionRow.status,
        currentStep: sessionRow.current_step,
        idempotencyKey: sessionRow.idempotency_key,
        startedAt: sessionRow.started_at,
        completedAt: sessionRow.completed_at,
        updatedAt: sessionRow.updated_at,
        curriculumDayV2Id: sessionRow.curriculum_day_v2_id,
      },
      snapshot: parsed,
      unitProgress: progressRows
        .map((row) =>
          UnitProgressSchema.parse({
            unitId: row.unit_id,
            unitType: row.unit_type,
            status: row.status,
            payload: JSON.parse(row.progress_json),
            startedAt:
              row.started_at === null ? null : toIsoDateTime(row.started_at),
            completedAt:
              row.completed_at === null
                ? null
                : toIsoDateTime(row.completed_at),
            skippedAt:
              row.skipped_at === null ? null : toIsoDateTime(row.skipped_at),
            updatedAt: toIsoDateTime(row.updated_at),
          }),
        )
        .sort(
          (left, right) =>
            parsed.units.findIndex((unit) => unit.id === left.unitId) -
            parsed.units.findIndex((unit) => unit.id === right.unitId),
        ),
    };
  }

  async updateUnitProgress(input: {
    sessionId: string;
    unitId: string;
    status: UnitStatus;
    progress?: UnitProgressPayload;
  }): Promise<VersionedSessionDetail["unitProgress"][number]> {
    const now = this.#now();
    const unitRow = this.#connection.sqlite
      .prepare(
        "SELECT unit_type, progress_json FROM unit_progress WHERE session_id = ? AND unit_id = ?",
      )
      .get(input.sessionId, input.unitId) as
      { unit_type: string; progress_json: string } | undefined;
    if (!unitRow) throw new Error("Unknown session unit progress");
    const unitType = UnitTypeSchema.parse(unitRow.unit_type);
    const status = UnitStatusSchema.parse(input.status);
    const payload = UnitProgressPayloadSchema.parse(
      input.progress ?? JSON.parse(unitRow.progress_json),
    );
    if (payload.type !== unitType) {
      throw new Error("Unit progress payload type must match its unit type");
    }
    const result = this.#connection.sqlite
      .prepare(
        `UPDATE unit_progress
         SET status = ?, progress_json = ?,
             started_at = CASE WHEN ? = 'in_progress' THEN COALESCE(started_at, ?) ELSE started_at END,
             completed_at = CASE WHEN ? = 'completed' THEN ? ELSE completed_at END,
             skipped_at = CASE WHEN ? = 'skipped' THEN ? ELSE skipped_at END,
             updated_at = ?
         WHERE session_id = ? AND unit_id = ?
           AND EXISTS (SELECT 1 FROM learning_sessions s
                       WHERE s.id = unit_progress.session_id AND s.status = 'active')`,
      )
      .run(
        status,
        stringifyJson(payload, "unit progress"),
        status,
        now,
        status,
        now,
        status,
        now,
        now,
        input.sessionId,
        input.unitId,
      );
    if (result.changes !== 1)
      throw new Error("Unknown active session unit progress");
    const detail = await this.getVersionedSession(input.sessionId);
    const progress = detail.unitProgress.find(
      (item) => item.unitId === input.unitId,
    );
    if (!progress) throw new Error("Updated unit progress disappeared");
    return progress;
  }

  async recordVersionedUnitEvidence(
    input: RecordVersionedUnitEvidenceInput,
  ): Promise<VersionedUnitEvidenceRecord> {
    const sessionId = validateEvidenceIdentifier(input.sessionId, "Session ID");
    const unitId = validateEvidenceIdentifier(input.unitId, "Unit ID");
    const operationId = validateEvidenceIdentifier(
      input.operationId,
      "Operation ID",
    );
    const questionId =
      input.questionId === undefined || input.questionId === null
        ? null
        : validateEvidenceIdentifier(input.questionId, "Question ID");
    const expectedUnitType = expectedUnitTypeForEvidence(input.evidenceType);
    const correctness = validateEvidenceCorrectness(input.correctness);
    const serializedPayload = serializeEvidencePayload(input.payload);

    return withTransaction(this.#connection, () => {
      const existing = this.#connection.sqlite
        .prepare(
          `SELECT id, session_id, unit_id, evidence_type, operation_id,
                  question_id, payload_json, correctness, created_at
           FROM versioned_unit_evidence WHERE operation_id = ?`,
        )
        .get(operationId) as VersionedUnitEvidenceRow | undefined;
      if (existing) {
        if (
          existing.session_id !== sessionId ||
          existing.unit_id !== unitId ||
          existing.evidence_type !== input.evidenceType ||
          existing.question_id !== questionId ||
          existing.payload_json !== serializedPayload.json ||
          existing.correctness !== correctness
        ) {
          throw new Error(
            "Operation ID is already associated with different unit evidence",
          );
        }
        return toVersionedUnitEvidenceRecord(existing);
      }

      const target = this.#connection.sqlite
        .prepare(
          `SELECT p.unit_type, p.status AS unit_status, s.status
           FROM unit_progress p
           JOIN learning_sessions s ON s.id = p.session_id
           WHERE p.session_id = ? AND p.unit_id = ?
             AND s.curriculum_day_v2_id IS NOT NULL`,
        )
        .get(sessionId, unitId) as
        { unit_type: string; unit_status: string; status: string } | undefined;
      if (!target) {
        throw new Error(
          "Evidence target is not a unit in the versioned session",
        );
      }
      if (target.status !== "active") {
        throw new Error("New unit evidence requires an active session");
      }
      if (target.unit_type !== expectedUnitType) {
        throw new Error(
          `Evidence type ${input.evidenceType} requires a ${expectedUnitType} unit`,
        );
      }
      if (target.unit_status !== "in_progress") {
        throw new Error("New unit evidence requires an in-progress unit");
      }

      const row: VersionedUnitEvidenceRow = {
        id: this.#id(),
        session_id: sessionId,
        unit_id: unitId,
        evidence_type: input.evidenceType,
        operation_id: operationId,
        question_id: questionId,
        payload_json: serializedPayload.json,
        correctness,
        created_at: this.#now(),
      };
      this.#connection.sqlite
        .prepare(
          `INSERT INTO versioned_unit_evidence
           (id, session_id, unit_id, evidence_type, operation_id, question_id,
            payload_json, correctness, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          row.id,
          row.session_id,
          row.unit_id,
          row.evidence_type,
          row.operation_id,
          row.question_id,
          row.payload_json,
          row.correctness,
          row.created_at,
        );
      return toVersionedUnitEvidenceRecord(row);
    });
  }

  async listVersionedUnitEvidence(
    sessionIdInput: string,
    filter: ListVersionedUnitEvidenceFilter = {},
  ): Promise<VersionedUnitEvidenceRecord[]> {
    const sessionId = validateEvidenceIdentifier(sessionIdInput, "Session ID");
    const unitId =
      filter.unitId === undefined
        ? undefined
        : validateEvidenceIdentifier(filter.unitId, "Unit ID");
    if (
      filter.evidenceType !== undefined &&
      !VERSIONED_EVIDENCE_TYPES.includes(filter.evidenceType)
    ) {
      throw new Error("Unsupported versioned evidence type");
    }
    const session = this.#connection.sqlite
      .prepare(
        `SELECT s.status
         FROM learning_sessions s
         WHERE s.id = ? AND s.status IN ('active', 'completed')
           AND s.curriculum_day_v2_id IS NOT NULL
           AND EXISTS (
             SELECT 1 FROM unit_progress p WHERE p.session_id = s.id
           )`,
      )
      .get(sessionId);
    if (!session) {
      throw new Error("Unknown active or completed versioned session");
    }

    const select = `SELECT id, session_id, unit_id, evidence_type, operation_id,
                           question_id, payload_json, correctness, created_at
                    FROM versioned_unit_evidence`;
    const order = " ORDER BY created_at ASC, id ASC";
    let rows: VersionedUnitEvidenceRow[];
    if (unitId !== undefined && filter.evidenceType !== undefined) {
      rows = this.#connection.sqlite
        .prepare(
          `${select} WHERE session_id = ? AND unit_id = ? AND evidence_type = ?${order}`,
        )
        .all(
          sessionId,
          unitId,
          filter.evidenceType,
        ) as unknown as VersionedUnitEvidenceRow[];
    } else if (unitId !== undefined) {
      rows = this.#connection.sqlite
        .prepare(`${select} WHERE session_id = ? AND unit_id = ?${order}`)
        .all(sessionId, unitId) as unknown as VersionedUnitEvidenceRow[];
    } else if (filter.evidenceType !== undefined) {
      rows = this.#connection.sqlite
        .prepare(`${select} WHERE session_id = ? AND evidence_type = ?${order}`)
        .all(
          sessionId,
          filter.evidenceType,
        ) as unknown as VersionedUnitEvidenceRow[];
    } else {
      rows = this.#connection.sqlite
        .prepare(`${select} WHERE session_id = ?${order}`)
        .all(sessionId) as unknown as VersionedUnitEvidenceRow[];
    }
    return rows.map(toVersionedUnitEvidenceRecord);
  }

  async recordHintUsage(input: {
    sessionId: string;
    unitId: string;
    level: number;
    reason: string;
    questionAttemptId?: string | null;
    exerciseAttemptId?: string | null;
    content?: string | null;
  }) {
    if (!Number.isInteger(input.level) || input.level < 0 || input.level > 5) {
      throw new Error("Hint level must be an integer between 0 and 5");
    }
    if (!input.reason.trim()) throw new Error("Hint usage reason is required");
    const progress = this.#connection.sqlite
      .prepare(
        "SELECT 1 FROM unit_progress WHERE session_id = ? AND unit_id = ?",
      )
      .get(input.sessionId, input.unitId);
    if (!progress)
      throw new Error("Hint unit does not belong to the session snapshot");
    if (input.questionAttemptId) {
      const attempt = this.#connection.sqlite
        .prepare(
          "SELECT 1 FROM answer_attempts WHERE id = ? AND session_id = ?",
        )
        .get(input.questionAttemptId, input.sessionId);
      if (!attempt)
        throw new Error("Question attempt does not belong to the session");
    }
    if (input.exerciseAttemptId) {
      const attempt = this.#connection.sqlite
        .prepare(
          "SELECT 1 FROM exercise_attempts WHERE id = ? AND session_id = ?",
        )
        .get(input.exerciseAttemptId, input.sessionId);
      if (!attempt)
        throw new Error("Exercise attempt does not belong to the session");
    }
    const id = this.#id();
    this.#connection.sqlite
      .prepare(
        `INSERT INTO hint_usages_v2
         (id, session_id, unit_id, question_attempt_id, exercise_attempt_id,
          level, reason, content, used_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.sessionId,
        input.unitId,
        input.questionAttemptId ?? null,
        input.exerciseAttemptId ?? null,
        input.level,
        input.reason.trim(),
        input.content ?? null,
        this.#now(),
      );
    return this.#connection.sqlite
      .prepare(
        `SELECT id, session_id AS sessionId, unit_id AS unitId,
                question_attempt_id AS questionAttemptId,
                exercise_attempt_id AS exerciseAttemptId, level, reason, content,
                used_at AS usedAt
         FROM hint_usages_v2 WHERE id = ?`,
      )
      .get(id);
  }

  async listHintUsages(sessionId: string) {
    return this.#connection.sqlite
      .prepare(
        `SELECT id, session_id AS sessionId, unit_id AS unitId,
                question_attempt_id AS questionAttemptId,
                exercise_attempt_id AS exerciseAttemptId, level, reason, content,
                used_at AS usedAt
         FROM hint_usages_v2 WHERE session_id = ? ORDER BY used_at, id`,
      )
      .all(sessionId);
  }

  async getReferenceAnswer(
    sessionId: string,
    questionId: string,
  ): Promise<{
    answer: string;
    keyPoints: string[];
  } | null> {
    const [question] = await this.#connection.db
      .select()
      .from(questions)
      .where(eq(questions.id, questionId))
      .limit(1);
    if (!question?.referenceAnswer) return null;
    const [count] = await this.#connection.db
      .select({ value: sql<number>`count(*)` })
      .from(answerAttempts)
      .where(
        and(
          eq(answerAttempts.sessionId, sessionId),
          eq(answerAttempts.questionId, questionId),
        ),
      );
    if ((count?.value ?? 0) < question.revealAfterAttempts) return null;
    return {
      answer: question.referenceAnswer,
      keyPoints: parseJson(
        question.keyPointsJson,
        "questions.key_points_json",
        isStringArray,
      ),
    };
  }

  async recordAnswer(input: {
    sessionId: string;
    questionId: string;
    answer: string;
    correctness?: number | null;
    feedback?: string | null;
    idempotencyKey?: string;
  }): Promise<AnswerAttempt> {
    if (!input.answer.trim()) throw new Error("Answer must not be empty");
    if (input.idempotencyKey) {
      const [existing] = await this.#connection.db
        .select()
        .from(answerAttempts)
        .where(eq(answerAttempts.idempotencyKey, input.idempotencyKey))
        .limit(1);
      if (existing) return existing;
    }

    const result = withTransaction(this.#connection, () => {
      const session = this.#connection.sqlite
        .prepare(
          "SELECT day_id AS dayId, status FROM learning_sessions WHERE id = ?",
        )
        .get(input.sessionId) as { dayId: string; status: string } | undefined;
      if (!session)
        throw new Error(`Unknown learning session: ${input.sessionId}`);
      if (session.status !== "active")
        throw new Error("Answers can only be added to an active session");
      const question = this.#connection.sqlite
        .prepare("SELECT day_id AS dayId FROM questions WHERE id = ?")
        .get(input.questionId) as { dayId: string } | undefined;
      if (!question || question.dayId !== session.dayId) {
        throw new Error("Question does not belong to the session day");
      }
      const row = this.#connection.sqlite
        .prepare(
          "SELECT COALESCE(MAX(attempt_number), 0) + 1 AS number FROM answer_attempts WHERE session_id = ? AND question_id = ?",
        )
        .get(input.sessionId, input.questionId) as { number: number };
      const attempt: AnswerAttempt = {
        id: this.#id(),
        sessionId: input.sessionId,
        questionId: input.questionId,
        attemptNumber: row.number,
        answer: input.answer.trim(),
        correctness: input.correctness ?? null,
        feedback: input.feedback ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        submittedAt: this.#now(),
      };
      this.#connection.sqlite
        .prepare(
          `INSERT INTO answer_attempts
           (id, session_id, question_id, attempt_number, answer, correctness, feedback, idempotency_key, submitted_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          attempt.id,
          attempt.sessionId,
          attempt.questionId,
          attempt.attemptNumber,
          attempt.answer,
          attempt.correctness,
          attempt.feedback,
          attempt.idempotencyKey,
          attempt.submittedAt,
        );
      this.#connection.sqlite
        .prepare("UPDATE learning_sessions SET updated_at = ? WHERE id = ?")
        .run(attempt.submittedAt, input.sessionId);
      return attempt;
    });
    return result;
  }

  async completeSession(input: CompleteSessionInput): Promise<SessionDetail> {
    const completedAt = input.completedAt ?? this.#now();
    withTransaction(this.#connection, () => {
      const session = this.#connection.sqlite
        .prepare("SELECT status FROM learning_sessions WHERE id = ?")
        .get(input.sessionId) as { status: string } | undefined;
      if (!session)
        throw new Error(`Unknown learning session: ${input.sessionId}`);
      if (session.status === "completed") return;
      if (session.status !== "active")
        throw new Error("Only an active session can be completed");

      const mistakeIds = new Map<string, string>();
      for (const item of input.mistakes ?? []) {
        const id = this.#id();
        this.#connection.sqlite
          .prepare(
            `INSERT INTO mistakes
             (id, session_id, topic_id, source_type, source_id, summary, correction, fingerprint,
              occurrence_count, first_seen_at, last_seen_at, resolved_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, NULL)
             ON CONFLICT(session_id, fingerprint) DO UPDATE SET
               occurrence_count = mistakes.occurrence_count + 1,
               last_seen_at = excluded.last_seen_at,
               summary = excluded.summary,
               correction = excluded.correction`,
          )
          .run(
            id,
            input.sessionId,
            item.topicId,
            item.sourceType,
            item.sourceId,
            item.summary,
            item.correction,
            item.fingerprint,
            completedAt,
            completedAt,
          );
        const persisted = this.#connection.sqlite
          .prepare(
            "SELECT id FROM mistakes WHERE session_id = ? AND fingerprint = ?",
          )
          .get(input.sessionId, item.fingerprint) as { id: string };
        mistakeIds.set(item.fingerprint, persisted.id);
      }

      for (const [observationIndex, observation] of (
        input.mastery ?? []
      ).entries()) {
        const evidenceId = this.#id();
        const inserted = this.#connection.sqlite
          .prepare(
            `INSERT INTO mastery_evidence
             (id, session_id, topic_id, dimension, evidence_type, source_id, delta, score_after, observed_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(session_id, topic_id, dimension, evidence_type, source_id) DO NOTHING`,
          )
          .run(
            evidenceId,
            input.sessionId,
            observation.topicId,
            observation.dimension,
            observation.evidenceType,
            observation.sourceId ?? String(observationIndex),
            observation.delta,
            observation.score,
            observation.observedAt ?? completedAt,
          );
        if (Number(inserted.changes) === 0) continue;
        this.#connection.sqlite
          .prepare(
            `INSERT INTO mastery_scores
             (id, topic_id, dimension, score, confidence, evidence_count, evidence_types_json,
              last_evidence_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)
             ON CONFLICT(topic_id, dimension) DO UPDATE SET
               score = excluded.score,
               confidence = excluded.confidence,
               evidence_count = mastery_scores.evidence_count + 1,
               evidence_types_json = excluded.evidence_types_json,
               last_evidence_at = excluded.last_evidence_at,
               updated_at = excluded.updated_at`,
          )
          .run(
            this.#id(),
            observation.topicId,
            observation.dimension,
            observation.score,
            observation.confidence,
            JSON.stringify(observation.evidenceTypes),
            observation.observedAt ?? completedAt,
            completedAt,
          );
      }

      for (const card of input.flashcards ?? []) {
        const key =
          card.idempotencyKey ??
          `${input.sessionId}:${card.front}:${card.back}`;
        this.#connection.sqlite
          .prepare(
            `INSERT OR IGNORE INTO flashcards
             (id, topic_id, source_mistake_id, front, back, status, due_at, interval_days,
              ease_factor, review_count, idempotency_key, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 'candidate', NULL, 0, 250, 0, ?, ?, ?)`,
          )
          .run(
            this.#id(),
            card.topicId ?? null,
            card.sourceMistakeFingerprint
              ? (mistakeIds.get(card.sourceMistakeFingerprint) ?? null)
              : null,
            card.front,
            card.back,
            key,
            completedAt,
            completedAt,
          );
      }

      this.#connection.sqlite
        .prepare(
          "UPDATE learning_sessions SET status = 'completed', current_step = 'complete', completed_at = ?, updated_at = ? WHERE id = ?",
        )
        .run(completedAt, completedAt, input.sessionId);
    });
    return this.getSession(input.sessionId);
  }

  async listFlashcards(
    input: { status?: Flashcard["status"]; dueBefore?: number } = {},
  ): Promise<Flashcard[]> {
    const filters: SQL[] = [];
    if (input.status) filters.push(eq(flashcards.status, input.status));
    if (input.dueBefore !== undefined) {
      filters.push(
        or(isNull(flashcards.dueAt), lte(flashcards.dueAt, input.dueBefore))!,
      );
    }
    return this.#connection.db
      .select()
      .from(flashcards)
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(asc(flashcards.dueAt), asc(flashcards.createdAt));
  }

  async updateFlashcard(
    id: string,
    patch: Partial<
      Pick<
        Flashcard,
        "front" | "back" | "status" | "dueAt" | "intervalDays" | "easeFactor"
      >
    >,
  ): Promise<Flashcard> {
    const [row] = await this.#connection.db
      .update(flashcards)
      .set({ ...patch, updatedAt: this.#now() })
      .where(eq(flashcards.id, id))
      .returning();
    if (!row) throw new Error(`Unknown flashcard: ${id}`);
    return row;
  }

  async getKnowledgeMap(): Promise<
    Array<{
      topic: {
        id: string;
        slug: string;
        title: string;
        description: string | null;
      };
      mastery: Array<{
        dimension: string;
        score: number;
        confidence: number;
        evidenceCount: number;
        evidenceTypes: string[];
        lastEvidenceAt: number | null;
      }>;
      openMistakes: number;
    }>
  > {
    const topicRows = await this.#connection.db
      .select()
      .from(topics)
      .orderBy(asc(topics.title));
    const scores = await this.#connection.db.select().from(masteryScores);
    const openMistakes = await this.#connection.db
      .select({ topicId: mistakes.topicId, count: sql<number>`count(*)` })
      .from(mistakes)
      .where(isNull(mistakes.resolvedAt))
      .groupBy(mistakes.topicId);
    return topicRows.map((topic) => ({
      topic: {
        id: topic.id,
        slug: topic.slug,
        title: topic.title,
        description: topic.description,
      },
      mastery: scores
        .filter((score) => score.topicId === topic.id)
        .map((score) => ({
          dimension: score.dimension,
          score: score.score,
          confidence: score.confidence,
          evidenceCount: score.evidenceCount,
          evidenceTypes: parseJson(
            score.evidenceTypesJson,
            "mastery_scores.evidence_types_json",
            isStringArray,
          ),
          lastEvidenceAt: score.lastEvidenceAt,
        })),
      openMistakes:
        openMistakes.find((item) => item.topicId === topic.id)?.count ?? 0,
    }));
  }

  async createConversation(input: {
    learningSessionId?: string | null;
    role: string;
    providerId: string;
    modelId: string;
    providerSessionId?: string | null;
  }) {
    const now = this.#now();
    const [row] = await this.#connection.db
      .insert(agentConversations)
      .values({
        id: this.#id(),
        status: "active",
        createdAt: now,
        updatedAt: now,
        ...input,
      })
      .returning();
    if (!row) throw new Error("Failed to create conversation");
    return row;
  }

  async addMessage(input: {
    conversationId: string;
    role: string;
    content: string;
    toolEvents?: unknown[];
    rawEvent?: unknown;
    status?: string;
    idempotencyKey?: string;
  }) {
    const now = this.#now();
    const toolEventsJson = stringifyJson(
      input.toolEvents ?? [],
      "message tool events",
    );
    const rawEventJson =
      input.rawEvent === undefined
        ? null
        : stringifyJson(input.rawEvent, "raw provider event");
    const id = withTransaction(this.#connection, () => {
      if (input.idempotencyKey) {
        const existing = this.#connection.sqlite
          .prepare("SELECT id FROM agent_messages WHERE idempotency_key = ?")
          .get(input.idempotencyKey) as { id: string } | undefined;
        if (existing) return existing.id;
      }
      const conversation = this.#connection.sqlite
        .prepare("SELECT id FROM agent_conversations WHERE id = ?")
        .get(input.conversationId);
      if (!conversation)
        throw new Error(`Unknown conversation: ${input.conversationId}`);
      const latest = this.#connection.sqlite
        .prepare(
          "SELECT COALESCE(MAX(sequence), 0) AS sequence FROM agent_messages WHERE conversation_id = ?",
        )
        .get(input.conversationId) as { sequence: number };
      const newId = this.#id();
      this.#connection.sqlite
        .prepare(
          `INSERT INTO agent_messages
           (id, conversation_id, role, content, tool_events_json, raw_event_json, status,
            sequence, idempotency_key, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          newId,
          input.conversationId,
          input.role,
          input.content,
          toolEventsJson,
          rawEventJson,
          input.status ?? "completed",
          latest.sequence + 1,
          input.idempotencyKey ?? null,
          now,
        );
      this.#connection.sqlite
        .prepare("UPDATE agent_conversations SET updated_at = ? WHERE id = ?")
        .run(now, input.conversationId);
      return newId;
    });
    const [row] = await this.#connection.db
      .select()
      .from(agentMessages)
      .where(eq(agentMessages.id, id))
      .limit(1);
    if (!row) throw new Error("Failed to save message");
    return row;
  }

  async setProviderConfiguration(input: {
    providerId: string;
    enabled: boolean;
    endpoint?: string | null;
    teacherModelId?: string | null;
    reviewerModelId?: string | null;
    interviewerModelId?: string | null;
    options?: Record<string, unknown>;
  }) {
    const values = {
      providerId: input.providerId,
      enabled: input.enabled,
      endpoint: input.endpoint ?? null,
      teacherModelId: input.teacherModelId ?? null,
      reviewerModelId: input.reviewerModelId ?? null,
      interviewerModelId: input.interviewerModelId ?? null,
      optionsJson: stringifyJson(input.options ?? {}, "provider options"),
      updatedAt: this.#now(),
    };
    const [row] = await this.#connection.db
      .insert(providerConfigurations)
      .values(values)
      .onConflictDoUpdate({
        target: providerConfigurations.providerId,
        set: values,
      })
      .returning();
    return row;
  }

  async listProviderConfigurations() {
    return this.#connection.db
      .select()
      .from(providerConfigurations)
      .orderBy(asc(providerConfigurations.providerId));
  }

  async setSetting(key: string, value: unknown): Promise<void> {
    const values = {
      key,
      valueJson: stringifyJson(value, `setting ${key}`),
      updatedAt: this.#now(),
    };
    await this.#connection.db
      .insert(applicationSettings)
      .values(values)
      .onConflictDoUpdate({ target: applicationSettings.key, set: values });
  }

  async getSetting<T>(key: string): Promise<T | null> {
    const [row] = await this.#connection.db
      .select()
      .from(applicationSettings)
      .where(eq(applicationSettings.key, key))
      .limit(1);
    if (!row) return null;
    return JSON.parse(row.valueJson) as T;
  }
}

export function createLearningRepository(
  connection: DatabaseConnection,
  options?: RepositoryOptions,
): LearningRepository {
  return new LearningRepository(connection, options);
}
