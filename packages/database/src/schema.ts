import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  real,
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
    curriculumDayV2Id: text("curriculum_day_v2_id").references(
      () => curriculumDaysV2.id,
      { onDelete: "restrict" },
    ),
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

export const curricula = sqliteTable("curricula", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  description: text("description"),
  activeVersionId: text("active_version_id"),
  ...timestamps,
});

export const curriculumVersions = sqliteTable(
  "curriculum_versions",
  {
    id: text("id").primaryKey(),
    curriculumId: text("curriculum_id")
      .notNull()
      .references(() => curricula.id, { onDelete: "restrict" }),
    revision: integer("revision").notNull(),
    parentVersionId: text("parent_version_id"),
    status: text("status")
      .$type<"draft" | "published" | "archived">()
      .notNull(),
    title: text("title").notNull(),
    description: text("description"),
    contentHash: text("content_hash"),
    createdAt: integer("created_at").notNull(),
    publishedAt: integer("published_at"),
    archivedAt: integer("archived_at"),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("curriculum_versions_curriculum_revision_uq").on(
      table.curriculumId,
      table.revision,
    ),
    index("curriculum_versions_status_idx").on(
      table.curriculumId,
      table.status,
      table.revision,
    ),
    check("curriculum_versions_revision_check", sql`${table.revision} > 0`),
  ],
);

export const curriculumWeeks = sqliteTable(
  "curriculum_weeks",
  {
    id: text("id").primaryKey(),
    versionId: text("version_id")
      .notNull()
      .references(() => curriculumVersions.id, { onDelete: "cascade" }),
    stableId: text("stable_id").notNull(),
    orderIndex: integer("order_index").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("curriculum_weeks_version_stable_uq").on(
      table.versionId,
      table.stableId,
    ),
    uniqueIndex("curriculum_weeks_version_order_uq").on(
      table.versionId,
      table.orderIndex,
    ),
  ],
);

export const curriculumDaysV2 = sqliteTable(
  "curriculum_days_v2",
  {
    id: text("id").primaryKey(),
    versionId: text("version_id")
      .notNull()
      .references(() => curriculumVersions.id, { onDelete: "cascade" }),
    weekId: text("week_id")
      .notNull()
      .references(() => curriculumWeeks.id, { onDelete: "cascade" }),
    stableId: text("stable_id").notNull(),
    orderIndex: integer("order_index").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    goal: text("goal").notNull(),
    estimatedMinutes: integer("estimated_minutes").notNull(),
    prerequisitesJson: text("prerequisites_json").notNull(),
    expectedOutcomesJson: text("expected_outcomes_json").notNull(),
    depthLevel: text("depth_level").notNull(),
    outOfScopeJson: text("out_of_scope_json").notNull(),
    topicsJson: text("topics_json").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("curriculum_days_v2_version_stable_uq").on(
      table.versionId,
      table.stableId,
    ),
    uniqueIndex("curriculum_days_v2_week_order_uq").on(
      table.weekId,
      table.orderIndex,
    ),
    index("curriculum_days_v2_version_idx").on(
      table.versionId,
      table.weekId,
      table.orderIndex,
    ),
  ],
);

export const curriculumUnits = sqliteTable(
  "curriculum_units",
  {
    id: text("id").primaryKey(),
    versionId: text("version_id")
      .notNull()
      .references(() => curriculumVersions.id, { onDelete: "cascade" }),
    dayId: text("day_id")
      .notNull()
      .references(() => curriculumDaysV2.id, { onDelete: "cascade" }),
    stableId: text("stable_id").notNull(),
    type: text("type").notNull(),
    orderIndex: integer("order_index").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    estimatedMinutes: integer("estimated_minutes"),
    objectivesJson: text("objectives_json").notNull(),
    checklistJson: text("checklist_json").notNull(),
    sourcesJson: text("sources_json").notNull(),
    questionsJson: text("questions_json").notNull(),
    misconceptionsJson: text("misconceptions_json").notNull(),
    referenceAnswerJson: text("reference_answer_json"),
    completionCriteriaJson: text("completion_criteria_json").notNull(),
    unlockRulesJson: text("unlock_rules_json").notNull(),
    optional: integer("optional", { mode: "boolean" }).notNull(),
    depthLevel: text("depth_level"),
    payloadJson: text("payload_json").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("curriculum_units_version_stable_uq").on(
      table.versionId,
      table.stableId,
    ),
    uniqueIndex("curriculum_units_day_order_uq").on(
      table.dayId,
      table.orderIndex,
    ),
    index("curriculum_units_version_day_idx").on(
      table.versionId,
      table.dayId,
      table.orderIndex,
    ),
  ],
);

export const sessionSnapshots = sqliteTable(
  "session_snapshots",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .unique()
      .references(() => learningSessions.id, { onDelete: "cascade" }),
    schemaVersion: integer("schema_version").notNull(),
    curriculumId: text("curriculum_id").references(() => curricula.id, {
      onDelete: "restrict",
    }),
    curriculumVersionId: text("curriculum_version_id").references(
      () => curriculumVersions.id,
      { onDelete: "restrict" },
    ),
    curriculumDayId: text("curriculum_day_id").references(
      () => curriculumDaysV2.id,
      { onDelete: "restrict" },
    ),
    contentHash: text("content_hash").notNull(),
    snapshotJson: text("snapshot_json").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("session_snapshots_version_idx").on(
      table.curriculumVersionId,
      table.curriculumDayId,
    ),
  ],
);

export const unitProgress = sqliteTable(
  "unit_progress",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => learningSessions.id, { onDelete: "cascade" }),
    unitId: text("unit_id").notNull(),
    unitType: text("unit_type").notNull(),
    status: text("status")
      .$type<"locked" | "ready" | "in_progress" | "completed" | "skipped">()
      .notNull(),
    progressJson: text("progress_json").notNull(),
    startedAt: integer("started_at"),
    completedAt: integer("completed_at"),
    skippedAt: integer("skipped_at"),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("unit_progress_session_unit_uq").on(
      table.sessionId,
      table.unitId,
    ),
    index("unit_progress_session_order_idx").on(
      table.sessionId,
      table.updatedAt,
    ),
  ],
);

export const learnerState = sqliteTable("learner_state", {
  id: text("id").primaryKey(),
  currentLearningSessionId: text("current_learning_session_id").references(
    () => learningSessions.id,
    { onDelete: "set null" },
  ),
  updatedAt: integer("updated_at").notNull(),
});

export const hintUsagesV2 = sqliteTable(
  "hint_usages_v2",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => learningSessions.id, { onDelete: "cascade" }),
    unitId: text("unit_id").notNull(),
    questionAttemptId: text("question_attempt_id").references(
      () => answerAttempts.id,
      { onDelete: "set null" },
    ),
    exerciseAttemptId: text("exercise_attempt_id").references(
      () => exerciseAttempts.id,
      { onDelete: "set null" },
    ),
    level: integer("level").notNull(),
    reason: text("reason").notNull(),
    content: text("content"),
    usedAt: integer("used_at").notNull(),
  },
  (table) => [
    index("hint_usages_v2_session_unit_idx").on(
      table.sessionId,
      table.unitId,
      table.usedAt,
    ),
    index("hint_usages_v2_exercise_attempt_idx").on(
      table.exerciseAttemptId,
      table.usedAt,
    ),
    check("hint_usages_v2_level_check", sql`${table.level} between 0 and 5`),
  ],
);

export const versionedUnitEvidence = sqliteTable(
  "versioned_unit_evidence",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => learningSessions.id, { onDelete: "cascade" }),
    unitId: text("unit_id").notNull(),
    evidenceType: text("evidence_type")
      .$type<
        "recall-attempt" | "quiz-answer" | "code-reading-attempt" | "summary"
      >()
      .notNull(),
    operationId: text("operation_id").notNull().unique(),
    questionId: text("question_id"),
    payloadJson: text("payload_json").notNull(),
    correctness: real("correctness"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("versioned_unit_evidence_session_idx").on(
      table.sessionId,
      table.createdAt,
      table.id,
    ),
    index("versioned_unit_evidence_session_unit_idx").on(
      table.sessionId,
      table.unitId,
      table.createdAt,
      table.id,
    ),
    index("versioned_unit_evidence_session_type_idx").on(
      table.sessionId,
      table.evidenceType,
      table.createdAt,
      table.id,
    ),
    check(
      "versioned_unit_evidence_type_check",
      sql`${table.evidenceType} in ('recall-attempt', 'quiz-answer', 'code-reading-attempt', 'summary')`,
    ),
    check(
      "versioned_unit_evidence_operation_id_check",
      sql`length(trim(${table.operationId})) between 1 and 200`,
    ),
    check(
      "versioned_unit_evidence_question_id_check",
      sql`${table.questionId} is null or length(trim(${table.questionId})) between 1 and 200`,
    ),
    check(
      "versioned_unit_evidence_correctness_check",
      sql`${table.correctness} is null or ${table.correctness} between 0.0 and 1.0`,
    ),
  ],
);

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
  curricula,
  curriculumVersions,
  curriculumWeeks,
  curriculumDaysV2,
  curriculumUnits,
  sessionSnapshots,
  unitProgress,
  learnerState,
  hintUsagesV2,
  versionedUnitEvidence,
};

export type Topic = typeof topics.$inferSelect;
export type CurriculumDay = typeof curriculumDays.$inferSelect;
export type Question = typeof questions.$inferSelect;
export type Exercise = typeof exercises.$inferSelect;
export type LearningSession = typeof learningSessions.$inferSelect;
export type AnswerAttempt = typeof answerAttempts.$inferSelect;
export type Flashcard = typeof flashcards.$inferSelect;
export type MasteryScore = typeof masteryScores.$inferSelect;
export type Curriculum = typeof curricula.$inferSelect;
export type CurriculumVersion = typeof curriculumVersions.$inferSelect;
export type CurriculumWeek = typeof curriculumWeeks.$inferSelect;
export type CurriculumDayV2 = typeof curriculumDaysV2.$inferSelect;
export type CurriculumUnit = typeof curriculumUnits.$inferSelect;
export type SessionSnapshot = typeof sessionSnapshots.$inferSelect;
export type UnitProgress = typeof unitProgress.$inferSelect;
export type LearnerState = typeof learnerState.$inferSelect;
export type HintUsageV2 = typeof hintUsagesV2.$inferSelect;
export type VersionedUnitEvidence = typeof versionedUnitEvidence.$inferSelect;
