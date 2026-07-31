import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const timestamps = {
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
};

export const topics = sqliteTable("topics", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  description: text("description"),
  ...timestamps,
});

export const curriculumDays = sqliteTable(
  "curriculum_days",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull().unique(),
    weekNumber: integer("week_number").notNull(),
    dayNumber: integer("day_number").notNull(),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    estimatedMinutes: integer("estimated_minutes").notNull(),
    goalsJson: text("goals_json").notNull(),
    sourcesJson: text("sources_json").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("curriculum_days_week_day_uq").on(
      table.weekNumber,
      table.dayNumber,
    ),
  ],
);

export const curriculumDayTopics = sqliteTable(
  "curriculum_day_topics",
  {
    dayId: text("day_id")
      .notNull()
      .references(() => curriculumDays.id, { onDelete: "cascade" }),
    topicId: text("topic_id")
      .notNull()
      .references(() => topics.id, { onDelete: "cascade" }),
    orderIndex: integer("order_index").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.dayId, table.topicId] }),
    index("curriculum_day_topics_topic_idx").on(table.topicId),
  ],
);

export const questions = sqliteTable(
  "questions",
  {
    id: text("id").primaryKey(),
    dayId: text("day_id")
      .notNull()
      .references(() => curriculumDays.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    prompt: text("prompt").notNull(),
    expectedSeconds: integer("expected_seconds"),
    orderIndex: integer("order_index").notNull(),
    referenceAnswer: text("reference_answer"),
    keyPointsJson: text("key_points_json").notNull(),
    revealAfterAttempts: integer("reveal_after_attempts").notNull(),
    active: integer("active", { mode: "boolean" }).notNull(),
    ...timestamps,
  },
  (table) => [index("questions_day_idx").on(table.dayId, table.orderIndex)],
);

export const exercises = sqliteTable(
  "exercises",
  {
    id: text("id").primaryKey(),
    dayId: text("day_id")
      .notNull()
      .references(() => curriculumDays.id, { onDelete: "cascade" }),
    slug: text("slug").notNull().unique(),
    title: text("title").notNull(),
    prompt: text("prompt").notNull(),
    difficulty: text("difficulty").notNull(),
    estimatedMinutes: integer("estimated_minutes").notNull(),
    workspacePath: text("workspace_path").notNull(),
    constraintsJson: text("constraints_json").notNull(),
    criteriaJson: text("criteria_json").notNull(),
    allowedOperationsJson: text("allowed_operations_json").notNull(),
    active: integer("active", { mode: "boolean" }).notNull(),
    ...timestamps,
  },
  (table) => [index("exercises_day_idx").on(table.dayId)],
);

export const learningSessions = sqliteTable(
  "learning_sessions",
  {
    id: text("id").primaryKey(),
    dayId: text("day_id")
      .notNull()
      .references(() => curriculumDays.id, { onDelete: "restrict" }),
    status: text("status")
      .$type<"active" | "completed" | "abandoned">()
      .notNull(),
    currentStep: text("current_step").notNull(),
    idempotencyKey: text("idempotency_key").unique(),
    startedAt: integer("started_at").notNull(),
    completedAt: integer("completed_at"),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("learning_sessions_status_idx").on(table.status, table.updatedAt),
    uniqueIndex("learning_sessions_one_active_day_uq")
      .on(table.dayId)
      .where(sql`${table.status} = 'active'`),
    check(
      "learning_sessions_status_check",
      sql`${table.status} in ('active', 'completed', 'abandoned')`,
    ),
  ],
);

export const answerAttempts = sqliteTable(
  "answer_attempts",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => learningSessions.id, { onDelete: "cascade" }),
    questionId: text("question_id")
      .notNull()
      .references(() => questions.id, { onDelete: "restrict" }),
    attemptNumber: integer("attempt_number").notNull(),
    answer: text("answer").notNull(),
    correctness: integer("correctness"),
    feedback: text("feedback"),
    idempotencyKey: text("idempotency_key").unique(),
    submittedAt: integer("submitted_at").notNull(),
  },
  (table) => [
    uniqueIndex("answer_attempts_session_question_number_uq").on(
      table.sessionId,
      table.questionId,
      table.attemptNumber,
    ),
    index("answer_attempts_question_idx").on(
      table.questionId,
      table.submittedAt,
    ),
    check("answer_attempts_number_check", sql`${table.attemptNumber} > 0`),
    check(
      "answer_attempts_correctness_check",
      sql`${table.correctness} is null or ${table.correctness} between 0 and 100`,
    ),
  ],
);

export const exerciseAttempts = sqliteTable(
  "exercise_attempts",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => learningSessions.id, { onDelete: "cascade" }),
    exerciseId: text("exercise_id")
      .notNull()
      .references(() => exercises.id, { onDelete: "restrict" }),
    status: text("status").notNull(),
    workspacePath: text("workspace_path").notNull(),
    baselinePath: text("baseline_path").notNull(),
    baselineHash: text("baseline_hash").notNull(),
    startedAt: integer("started_at").notNull(),
    completedAt: integer("completed_at"),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("exercise_attempts_session_exercise_uq").on(
      table.sessionId,
      table.exerciseId,
    ),
  ],
);

export const testRuns = sqliteTable(
  "test_runs",
  {
    id: text("id").primaryKey(),
    exerciseAttemptId: text("exercise_attempt_id")
      .notNull()
      .references(() => exerciseAttempts.id, { onDelete: "cascade" }),
    operationId: text("operation_id").notNull(),
    status: text("status").notNull(),
    exitCode: integer("exit_code"),
    stdout: text("stdout").notNull(),
    stderr: text("stderr").notNull(),
    durationMs: integer("duration_ms"),
    startedAt: integer("started_at").notNull(),
    completedAt: integer("completed_at"),
  },
  (table) => [
    index("test_runs_attempt_idx").on(table.exerciseAttemptId, table.startedAt),
  ],
);

export const reviews = sqliteTable(
  "reviews",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => learningSessions.id, { onDelete: "cascade" }),
    exerciseAttemptId: text("exercise_attempt_id").references(
      () => exerciseAttempts.id,
      {
        onDelete: "set null",
      },
    ),
    providerId: text("provider_id").notNull(),
    modelId: text("model_id").notNull(),
    status: text("status").notNull(),
    resultJson: text("result_json"),
    rawResponse: text("raw_response"),
    createdAt: integer("created_at").notNull(),
    completedAt: integer("completed_at"),
  },
  (table) => [
    index("reviews_session_idx").on(table.sessionId, table.createdAt),
  ],
);

export const hints = sqliteTable(
  "hints",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => learningSessions.id, { onDelete: "cascade" }),
    questionId: text("question_id").references(() => questions.id, {
      onDelete: "restrict",
    }),
    exerciseId: text("exercise_id").references(() => exercises.id, {
      onDelete: "restrict",
    }),
    level: integer("level").notNull(),
    content: text("content"),
    usedAt: integer("used_at").notNull(),
  },
  (table) => [
    index("hints_session_idx").on(table.sessionId, table.usedAt),
    check("hints_level_check", sql`${table.level} between 0 and 3`),
    check(
      "hints_target_check",
      sql`${table.questionId} is not null or ${table.exerciseId} is not null`,
    ),
  ],
);

export const mistakes = sqliteTable(
  "mistakes",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => learningSessions.id, { onDelete: "cascade" }),
    topicId: text("topic_id")
      .notNull()
      .references(() => topics.id, { onDelete: "restrict" }),
    sourceType: text("source_type").notNull(),
    sourceId: text("source_id").notNull(),
    summary: text("summary").notNull(),
    correction: text("correction").notNull(),
    fingerprint: text("fingerprint").notNull(),
    occurrenceCount: integer("occurrence_count").notNull(),
    firstSeenAt: integer("first_seen_at").notNull(),
    lastSeenAt: integer("last_seen_at").notNull(),
    resolvedAt: integer("resolved_at"),
  },
  (table) => [
    uniqueIndex("mistakes_session_fingerprint_uq").on(
      table.sessionId,
      table.fingerprint,
    ),
    index("mistakes_topic_idx").on(table.topicId, table.lastSeenAt),
  ],
);

export const masteryScores = sqliteTable(
  "mastery_scores",
  {
    id: text("id").primaryKey(),
    topicId: text("topic_id")
      .notNull()
      .references(() => topics.id, { onDelete: "cascade" }),
    dimension: text("dimension").notNull(),
    score: integer("score").notNull(),
    confidence: integer("confidence").notNull(),
    evidenceCount: integer("evidence_count").notNull(),
    evidenceTypesJson: text("evidence_types_json").notNull(),
    lastEvidenceAt: integer("last_evidence_at"),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("mastery_scores_topic_dimension_uq").on(
      table.topicId,
      table.dimension,
    ),
    check("mastery_scores_score_check", sql`${table.score} between 0 and 500`),
    check(
      "mastery_scores_confidence_check",
      sql`${table.confidence} between 0 and 100`,
    ),
  ],
);

export const masteryEvidence = sqliteTable(
  "mastery_evidence",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => learningSessions.id, { onDelete: "cascade" }),
    topicId: text("topic_id")
      .notNull()
      .references(() => topics.id, { onDelete: "cascade" }),
    dimension: text("dimension").notNull(),
    evidenceType: text("evidence_type").notNull(),
    sourceId: text("source_id").notNull(),
    delta: integer("delta").notNull(),
    scoreAfter: integer("score_after").notNull(),
    observedAt: integer("observed_at").notNull(),
  },
  (table) => [
    uniqueIndex("mastery_evidence_session_topic_dimension_type_uq").on(
      table.sessionId,
      table.topicId,
      table.dimension,
      table.evidenceType,
      table.sourceId,
    ),
  ],
);

export const flashcards = sqliteTable(
  "flashcards",
  {
    id: text("id").primaryKey(),
    topicId: text("topic_id").references(() => topics.id, {
      onDelete: "set null",
    }),
    sourceMistakeId: text("source_mistake_id").references(() => mistakes.id, {
      onDelete: "set null",
    }),
    front: text("front").notNull(),
    back: text("back").notNull(),
    status: text("status")
      .$type<"candidate" | "approved" | "suspended" | "archived">()
      .notNull(),
    dueAt: integer("due_at"),
    intervalDays: integer("interval_days").notNull(),
    easeFactor: integer("ease_factor").notNull(),
    reviewCount: integer("review_count").notNull(),
    idempotencyKey: text("idempotency_key").unique(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("flashcards_status_due_idx").on(table.status, table.dueAt),
    check(
      "flashcards_status_check",
      sql`${table.status} in ('candidate', 'approved', 'suspended', 'archived')`,
    ),
  ],
);

export const interviewSessions = sqliteTable(
  "interview_sessions",
  {
    id: text("id").primaryKey(),
    learningSessionId: text("learning_session_id").references(
      () => learningSessions.id,
      {
        onDelete: "set null",
      },
    ),
    status: text("status").notNull(),
    resultJson: text("result_json"),
    startedAt: integer("started_at").notNull(),
    completedAt: integer("completed_at"),
  },
  (table) => [
    index("interview_sessions_learning_idx").on(table.learningSessionId),
  ],
);

export const agentConversations = sqliteTable(
  "agent_conversations",
  {
    id: text("id").primaryKey(),
    learningSessionId: text("learning_session_id").references(
      () => learningSessions.id,
      {
        onDelete: "set null",
      },
    ),
    role: text("role").notNull(),
    providerId: text("provider_id").notNull(),
    modelId: text("model_id").notNull(),
    providerSessionId: text("provider_session_id"),
    status: text("status").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("agent_conversations_learning_idx").on(
      table.learningSessionId,
      table.updatedAt,
    ),
  ],
);

export const agentMessages = sqliteTable(
  "agent_messages",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => agentConversations.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    content: text("content").notNull(),
    toolEventsJson: text("tool_events_json").notNull(),
    rawEventJson: text("raw_event_json"),
    status: text("status").notNull(),
    sequence: integer("sequence").notNull(),
    idempotencyKey: text("idempotency_key").unique(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("agent_messages_conversation_sequence_uq").on(
      table.conversationId,
      table.sequence,
    ),
  ],
);

export const providerConfigurations = sqliteTable(
  "provider_configurations",
  {
    providerId: text("provider_id").primaryKey(),
    enabled: integer("enabled", { mode: "boolean" }).notNull(),
    endpoint: text("endpoint"),
    teacherModelId: text("teacher_model_id"),
    reviewerModelId: text("reviewer_model_id"),
    interviewerModelId: text("interviewer_model_id"),
    optionsJson: text("options_json").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    check(
      "provider_configurations_enabled_check",
      sql`${table.enabled} in (0, 1)`,
    ),
  ],
);

export const applicationSettings = sqliteTable("application_settings", {
  key: text("key").primaryKey(),
  valueJson: text("value_json").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

// Short aliases keep repository call sites readable while preserving the explicit SQL table names.
export const mastery = masteryScores;
export const conversations = agentConversations;
export const messages = agentMessages;
export const providerConfigs = providerConfigurations;
export const settings = applicationSettings;

export const schema = {
  topics,
  curriculumDays,
  curriculumDayTopics,
  questions,
  exercises,
  learningSessions,
  answerAttempts,
  exerciseAttempts,
  testRuns,
  reviews,
  hints,
  mistakes,
  masteryScores,
  masteryEvidence,
  flashcards,
  interviewSessions,
  agentConversations,
  agentMessages,
  providerConfigurations,
  applicationSettings,
};

export type Topic = typeof topics.$inferSelect;
export type CurriculumDay = typeof curriculumDays.$inferSelect;
export type Question = typeof questions.$inferSelect;
export type Exercise = typeof exercises.$inferSelect;
export type LearningSession = typeof learningSessions.$inferSelect;
export type AnswerAttempt = typeof answerAttempts.$inferSelect;
export type Flashcard = typeof flashcards.$inferSelect;
export type MasteryScore = typeof masteryScores.$inferSelect;
