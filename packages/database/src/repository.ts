import { randomUUID } from "node:crypto";
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
