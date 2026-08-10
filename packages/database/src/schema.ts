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
    environmentId: text("environment_id"),
    workspaceHandleId: text("workspace_handle_id"),
    workspaceGeneration: integer("workspace_generation"),
    sourceSnapshotHash: text("source_snapshot_hash"),
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
    diffFingerprint: text("diff_fingerprint"),
    diffTruncated: integer("diff_truncated", { mode: "boolean" })
      .notNull()
      .default(false),
    checkId: text("check_id"),
    environmentId: text("environment_id"),
    environmentPackDigest: text("environment_pack_digest"),
    backendId: text("backend_id"),
    inputSnapshotHash: text("input_snapshot_hash"),
    resultJson: text("result_json"),
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
    operationId: text("operation_id"),
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
    uniqueIndex("reviews_operation_id_uq").on(table.operationId),
  ],
);

export const environmentPacks = sqliteTable("environment_packs", {
  id: text("id").primaryKey(),
  version: text("version").notNull(),
  digest: text("digest").notNull().unique(),
  runtimeKind: text("runtime_kind").$type<"node" | "python">().notNull(),
  runtimeVersion: text("runtime_version").notNull(),
  manifestJson: text("manifest_json").notNull(),
  trustMode: text("trust_mode").$type<"trusted-local-unsandboxed">().notNull(),
  networkPolicy: text("network_policy")
    .$type<"inherit-local-trusted">()
    .notNull(),
  installedAt: integer("installed_at").notNull(),
});

export const trustedChecks = sqliteTable(
  "trusted_checks",
  {
    id: text("id").primaryKey(),
    environmentId: text("environment_id")
      .notNull()
      .references(() => environmentPacks.id, { onDelete: "restrict" }),
    contractVersion: integer("contract_version").notNull(),
    resultKind: text("result_kind")
      .$type<"tests" | "static-analysis" | "build">()
      .notNull(),
    descriptorJson: text("descriptor_json").notNull(),
  },
  (table) => [
    uniqueIndex("trusted_checks_environment_id_uq").on(
      table.environmentId,
      table.id,
    ),
  ],
);

export const executionArtifacts = sqliteTable(
  "execution_artifacts",
  {
    id: text("id").primaryKey(),
    testRunId: text("test_run_id")
      .notNull()
      .references(() => testRuns.id, { onDelete: "restrict" }),
    artifactType: text("artifact_type")
      .$type<"process-log" | "check-report">()
      .notNull(),
    mediaType: text("media_type").notNull(),
    digest: text("digest").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    retention: text("retention").$type<"attempt">().notNull(),
    truncated: integer("truncated", { mode: "boolean" }).notNull(),
    content: text("content").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("execution_artifacts_test_run_id_uq").on(
      table.testRunId,
      table.id,
    ),
  ],
);

export const reviewEvidenceBundles = sqliteTable("review_evidence_bundles", {
  id: text("id").primaryKey(),
  reviewId: text("review_id")
    .notNull()
    .unique()
    .references(() => reviews.id, { onDelete: "restrict" }),
  exerciseAttemptId: text("exercise_attempt_id")
    .notNull()
    .references(() => exerciseAttempts.id, { onDelete: "restrict" }),
  testRunId: text("test_run_id")
    .notNull()
    .references(() => testRuns.id, { onDelete: "restrict" }),
  workspaceSnapshotHash: text("workspace_snapshot_hash").notNull(),
  diffFingerprint: text("diff_fingerprint").notNull(),
  bundleSha256: text("bundle_sha256").notNull(),
  bundleJson: text("bundle_json").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const executionMigrationQuarantine = sqliteTable(
  "execution_migration_quarantine",
  {
    sourceTable: text("source_table").notNull(),
    sourceId: text("source_id").notNull(),
    reasonCode: text("reason_code").notNull(),
    sourceSnapshotJson: text("source_snapshot_json").notNull(),
    quarantinedAt: integer("quarantined_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.sourceTable, table.sourceId] })],
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

export const courses = sqliteTable(
  "courses",
  {
    id: text("id").primaryKey(),
    stableId: text("stable_id").notNull().unique(),
    slug: text("slug").notNull().unique(),
    title: text("title").notNull(),
    description: text("description"),
    primaryLocale: text("primary_locale").notNull(),
    activeRevisionId: text("active_revision_id"),
    ...timestamps,
  },
  (table) => [
    check("courses_id_check", sql`length(trim(${table.id})) between 1 and 200`),
    check(
      "courses_primary_locale_check",
      sql`length(trim(${table.primaryLocale})) between 2 and 35`,
    ),
  ],
);

export const courseRevisions = sqliteTable(
  "course_revisions",
  {
    id: text("id").primaryKey(),
    courseId: text("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "restrict" }),
    revisionNumber: integer("revision_number").notNull(),
    parentRevisionId: text("parent_revision_id"),
    branchKind: text("branch_kind").$type<"upstream" | "personal">().notNull(),
    status: text("status")
      .$type<"draft" | "published" | "archived">()
      .notNull(),
    title: text("title").notNull(),
    description: text("description"),
    contentHash: text("content_hash"),
    basedOnContentHash: text("based_on_content_hash"),
    createdAt: integer("created_at").notNull(),
    publishedAt: integer("published_at"),
    archivedAt: integer("archived_at"),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("course_revisions_course_id_id_uq").on(
      table.courseId,
      table.id,
    ),
    uniqueIndex("course_revisions_course_number_uq").on(
      table.courseId,
      table.revisionNumber,
    ),
    index("course_revisions_status_idx").on(
      table.courseId,
      table.status,
      table.revisionNumber,
      table.id,
    ),
  ],
);

export const courseSections = sqliteTable(
  "course_sections",
  {
    id: text("id").primaryKey(),
    courseId: text("course_id").notNull(),
    revisionId: text("revision_id")
      .notNull()
      .references(() => courseRevisions.id, { onDelete: "restrict" }),
    stableId: text("stable_id").notNull(),
    orderIndex: integer("order_index").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("course_sections_scope_id_uq").on(
      table.courseId,
      table.revisionId,
      table.id,
    ),
    uniqueIndex("course_sections_scope_stable_uq").on(
      table.courseId,
      table.revisionId,
      table.stableId,
    ),
    uniqueIndex("course_sections_scope_order_uq").on(
      table.courseId,
      table.revisionId,
      table.orderIndex,
    ),
    index("course_sections_revision_order_idx").on(
      table.courseId,
      table.revisionId,
      table.orderIndex,
      table.id,
    ),
  ],
);

export const courseLessons = sqliteTable(
  "course_lessons",
  {
    id: text("id").primaryKey(),
    courseId: text("course_id").notNull(),
    revisionId: text("revision_id")
      .notNull()
      .references(() => courseRevisions.id, { onDelete: "restrict" }),
    sectionId: text("section_id")
      .notNull()
      .references(() => courseSections.id, { onDelete: "restrict" }),
    stableId: text("stable_id").notNull(),
    orderIndex: integer("order_index").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    goal: text("goal").notNull(),
    estimatedMinutes: integer("estimated_minutes").notNull(),
    expectedOutcomesJson: text("expected_outcomes_json").notNull(),
    depthLevel: text("depth_level").notNull(),
    outOfScopeJson: text("out_of_scope_json").notNull(),
    topicsJson: text("topics_json").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("course_lessons_scope_id_uq").on(
      table.courseId,
      table.revisionId,
      table.id,
    ),
    uniqueIndex("course_lessons_scope_stable_uq").on(
      table.courseId,
      table.revisionId,
      table.stableId,
    ),
    uniqueIndex("course_lessons_section_order_uq").on(
      table.courseId,
      table.revisionId,
      table.sectionId,
      table.orderIndex,
    ),
    index("course_lessons_revision_order_idx").on(
      table.courseId,
      table.revisionId,
      table.sectionId,
      table.orderIndex,
      table.id,
    ),
  ],
);

export const courseLessonPrerequisites = sqliteTable(
  "course_lesson_prerequisites",
  {
    courseId: text("course_id").notNull(),
    revisionId: text("revision_id").notNull(),
    lessonId: text("lesson_id").notNull(),
    prerequisiteLessonId: text("prerequisite_lesson_id").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.courseId,
        table.revisionId,
        table.lessonId,
        table.prerequisiteLessonId,
      ],
    }),
    index("course_lesson_prerequisites_target_idx").on(
      table.courseId,
      table.revisionId,
      table.prerequisiteLessonId,
      table.lessonId,
    ),
  ],
);

export const courseActivities = sqliteTable(
  "course_activities",
  {
    id: text("id").primaryKey(),
    courseId: text("course_id").notNull(),
    revisionId: text("revision_id")
      .notNull()
      .references(() => courseRevisions.id, { onDelete: "restrict" }),
    lessonId: text("lesson_id")
      .notNull()
      .references(() => courseLessons.id, { onDelete: "restrict" }),
    stableId: text("stable_id").notNull(),
    activityType: text("activity_type")
      .$type<
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
        | "spaced-review"
      >()
      .notNull(),
    orderIndex: integer("order_index").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    estimatedMinutes: integer("estimated_minutes"),
    required: integer("required", { mode: "boolean" }).notNull(),
    objectivesJson: text("objectives_json").notNull(),
    checklistJson: text("checklist_json").notNull(),
    sourcesJson: text("sources_json").notNull(),
    questionsJson: text("questions_json").notNull(),
    misconceptionsJson: text("misconceptions_json").notNull(),
    capabilityIdsJson: text("capability_ids_json").notNull(),
    knowledgeNodeIdsJson: text("knowledge_node_ids_json").notNull(),
    completionCriteriaJson: text("completion_criteria_json").notNull(),
    payloadJson: text("payload_json").notNull(),
    protectedMaterialJson: text("protected_material_json").notNull(),
    depthLevel: text("depth_level"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("course_activities_scope_id_uq").on(
      table.courseId,
      table.revisionId,
      table.id,
    ),
    uniqueIndex("course_activities_lesson_id_uq").on(
      table.courseId,
      table.revisionId,
      table.lessonId,
      table.id,
    ),
    uniqueIndex("course_activities_scope_stable_uq").on(
      table.courseId,
      table.revisionId,
      table.stableId,
    ),
    uniqueIndex("course_activities_lesson_order_uq").on(
      table.courseId,
      table.revisionId,
      table.lessonId,
      table.orderIndex,
    ),
    index("course_activities_lesson_order_idx").on(
      table.courseId,
      table.revisionId,
      table.lessonId,
      table.orderIndex,
      table.id,
    ),
  ],
);

export const courseActivityPrerequisites = sqliteTable(
  "course_activity_prerequisites",
  {
    courseId: text("course_id").notNull(),
    revisionId: text("revision_id").notNull(),
    lessonId: text("lesson_id").notNull(),
    activityId: text("activity_id").notNull(),
    prerequisiteActivityId: text("prerequisite_activity_id").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.courseId,
        table.revisionId,
        table.lessonId,
        table.activityId,
        table.prerequisiteActivityId,
      ],
    }),
    index("course_activity_prerequisites_target_idx").on(
      table.courseId,
      table.revisionId,
      table.lessonId,
      table.prerequisiteActivityId,
      table.activityId,
    ),
  ],
);

export const sourceSnapshots = sqliteTable(
  "source_snapshots",
  {
    id: text("id").primaryKey(),
    courseId: text("course_id").notNull(),
    revisionId: text("revision_id")
      .notNull()
      .references(() => courseRevisions.id, { onDelete: "restrict" }),
    sourceAuthorityId: text("source_authority_id").notNull(),
    canonicalUrl: text("canonical_url").notNull(),
    retrievedAt: integer("retrieved_at").notNull(),
    retrievalMethod: text("retrieval_method")
      .$type<"official-http" | "manual-import" | "migration">()
      .notNull(),
    mediaType: text("media_type").notNull(),
    locale: text("locale"),
    contentHash: text("content_hash").notNull(),
    title: text("title").notNull(),
    authorPublisher: text("author_publisher"),
    publishedOrUpdatedAt: text("published_or_updated_at"),
    attribution: text("attribution"),
    licenseSpdx: text("license_spdx"),
    termsUrl: text("terms_url"),
    content: text("content"),
    locatorMapJson: text("locator_map_json").notNull(),
    retentionMode: text("retention_mode")
      .$type<"full" | "extract" | "metadata-only">()
      .notNull(),
    supersedesSnapshotId: text("supersedes_snapshot_id"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("source_snapshots_scope_id_uq").on(
      table.courseId,
      table.revisionId,
      table.id,
    ),
    index("source_snapshots_revision_idx").on(
      table.courseId,
      table.revisionId,
      table.sourceAuthorityId,
      table.id,
    ),
  ],
);

export const knowledgeCapsules = sqliteTable(
  "knowledge_capsules",
  {
    id: text("id").primaryKey(),
    schemaVersion: integer("schema_version").notNull(),
    courseId: text("course_id").notNull(),
    revisionId: text("revision_id")
      .notNull()
      .references(() => courseRevisions.id, { onDelete: "restrict" }),
    knowledgeNodeIdsJson: text("knowledge_node_ids_json").notNull(),
    primaryLocale: text("primary_locale").notNull(),
    claimsJson: text("claims_json").notNull(),
    citationsJson: text("citations_json").notNull(),
    conflictsJson: text("conflicts_json").notNull(),
    createdBy: text("created_by")
      .$type<"manual" | "typed-ai-proposal" | "migration">()
      .notNull(),
    validationHash: text("validation_hash").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("knowledge_capsules_scope_id_uq").on(
      table.courseId,
      table.revisionId,
      table.id,
    ),
    index("knowledge_capsules_revision_idx").on(
      table.courseId,
      table.revisionId,
      table.id,
    ),
  ],
);

export const knowledgeCapsuleSources = sqliteTable(
  "knowledge_capsule_sources",
  {
    courseId: text("course_id").notNull(),
    revisionId: text("revision_id").notNull(),
    capsuleId: text("capsule_id").notNull(),
    sourceSnapshotId: text("source_snapshot_id").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.courseId,
        table.revisionId,
        table.capsuleId,
        table.sourceSnapshotId,
      ],
    }),
  ],
);

export const adaptationBranches = sqliteTable(
  "adaptation_branches",
  {
    id: text("id").primaryKey(),
    courseId: text("course_id").notNull(),
    owner: text("owner").$type<"local">().notNull(),
    baseRevisionId: text("base_revision_id").notNull(),
    headRevisionId: text("head_revision_id"),
    status: text("status").$type<"active" | "archived">().notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("adaptation_branches_scope_id_uq").on(table.courseId, table.id),
    index("adaptation_branches_course_status_idx").on(
      table.courseId,
      table.status,
      table.id,
    ),
  ],
);

export const sessionCourseContexts = sqliteTable(
  "session_course_contexts",
  {
    sessionId: text("session_id")
      .primaryKey()
      .references(() => learningSessions.id, { onDelete: "restrict" }),
    courseId: text("course_id").notNull(),
    revisionId: text("revision_id").notNull(),
    lessonId: text("lesson_id").notNull(),
    sessionSnapshotId: text("session_snapshot_id")
      .notNull()
      .unique()
      .references(() => sessionSnapshots.id, { onDelete: "restrict" }),
    snapshotHash: text("snapshot_hash").notNull(),
    snapshotBytesHash: text("snapshot_bytes_hash"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("session_course_contexts_scope_uq").on(
      table.sessionId,
      table.courseId,
      table.revisionId,
      table.lessonId,
    ),
    index("session_course_contexts_revision_idx").on(
      table.courseId,
      table.revisionId,
      table.lessonId,
      table.sessionId,
    ),
  ],
);

export const evidenceFacts = sqliteTable(
  "evidence_facts",
  {
    id: text("id").primaryKey(),
    schemaVersion: integer("schema_version").notNull(),
    operationId: text("operation_id").notNull().unique(),
    courseId: text("course_id").notNull(),
    revisionId: text("revision_id").notNull(),
    lessonId: text("lesson_id").notNull(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessionCourseContexts.sessionId, {
        onDelete: "restrict",
      }),
    activityId: text("activity_id")
      .notNull()
      .references(() => courseActivities.id, { onDelete: "restrict" }),
    evidenceType: text("evidence_type")
      .$type<
        "recall-attempt" | "quiz-answer" | "code-reading-attempt" | "summary"
      >()
      .notNull(),
    questionId: text("question_id"),
    correctness: real("correctness"),
    occurredAt: integer("occurred_at").notNull(),
    recordedAt: integer("recorded_at").notNull(),
    payloadJson: text("payload_json").notNull(),
    provenanceJson: text("provenance_json").notNull(),
  },
  (table) => [
    uniqueIndex("evidence_facts_scope_id_uq").on(
      table.courseId,
      table.revisionId,
      table.id,
    ),
    index("evidence_facts_session_time_idx").on(
      table.sessionId,
      table.occurredAt,
      table.id,
    ),
    index("evidence_facts_activity_time_idx").on(
      table.courseId,
      table.revisionId,
      table.activityId,
      table.occurredAt,
      table.id,
    ),
  ],
);

export const reviewItems = sqliteTable(
  "review_items",
  {
    id: text("id").primaryKey(),
    courseId: text("course_id").notNull(),
    revisionId: text("revision_id").notNull(),
    sourceEvidenceId: text("source_evidence_id")
      .notNull()
      .references(() => evidenceFacts.id, { onDelete: "restrict" }),
    kind: text("kind")
      .$type<
        "mistake-correction" | "flashcard" | "spaced-review" | "activity-review"
      >()
      .notNull(),
    status: text("status")
      .$type<"pending" | "completed" | "dismissed" | "superseded">()
      .notNull(),
    dueAt: integer("due_at").notNull(),
    payloadJson: text("payload_json").notNull(),
    schedulerVersion: text("scheduler_version").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("review_items_scope_id_uq").on(
      table.courseId,
      table.revisionId,
      table.id,
    ),
    uniqueIndex("review_items_source_kind_uq").on(
      table.courseId,
      table.revisionId,
      table.sourceEvidenceId,
      table.kind,
    ),
    index("review_items_course_due_idx").on(
      table.courseId,
      table.status,
      table.dueAt,
      table.id,
    ),
  ],
);

export const migrationRuns = sqliteTable(
  "migration_runs",
  {
    id: text("id").primaryKey(),
    transformVersion: text("transform_version").notNull(),
    sourceDatabaseDigest: text("source_database_digest").notNull(),
    sourceRowsDigest: text("source_rows_digest").notNull(),
    approvedBackupLogicalSha256: text("approved_backup_logical_sha256"),
    approvedBackupSha256: text("approved_backup_sha256"),
    approvedBackupPathHash: text("approved_backup_path_hash"),
    status: text("status").$type<"completed">().notNull(),
    sourceRowCount: integer("source_row_count").notNull(),
    mappedCount: integer("mapped_count").notNull(),
    quarantinedCount: integer("quarantined_count").notNull(),
    intentionallyUnmappedCount: integer(
      "intentionally_unmapped_count",
    ).notNull(),
    startedAt: integer("started_at").notNull(),
    completedAt: integer("completed_at").notNull(),
  },
  (table) => [
    uniqueIndex("migration_runs_transform_rows_uq").on(
      table.transformVersion,
      table.sourceRowsDigest,
    ),
  ],
);

export const migrationProvenance = sqliteTable(
  "migration_provenance",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => migrationRuns.id, { onDelete: "restrict" }),
    sourceDatabaseDigest: text("source_database_digest").notNull(),
    sourceTable: text("source_table").notNull(),
    sourcePrimaryKey: text("source_primary_key").notNull(),
    sourceRowHash: text("source_row_hash").notNull(),
    targetEntityType: text("target_entity_type"),
    targetId: text("target_id"),
    transformVersion: text("transform_version").notNull(),
    status: text("status")
      .$type<"mapped" | "quarantined" | "intentionally_unmapped">()
      .notNull(),
    reasonCode: text("reason_code"),
    diagnostic: text("diagnostic"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("migration_provenance_source_transform_uq").on(
      table.sourceTable,
      table.sourcePrimaryKey,
      table.transformVersion,
    ),
    index("migration_provenance_run_status_idx").on(
      table.runId,
      table.status,
      table.sourceTable,
      table.sourcePrimaryKey,
    ),
    index("migration_provenance_target_idx").on(
      table.targetEntityType,
      table.targetId,
      table.transformVersion,
    ),
  ],
);

export const migrationQuarantine = sqliteTable(
  "migration_quarantine",
  {
    id: text("id").primaryKey(),
    provenanceId: text("provenance_id")
      .notNull()
      .unique()
      .references(() => migrationProvenance.id, { onDelete: "restrict" }),
    runId: text("run_id")
      .notNull()
      .references(() => migrationRuns.id, { onDelete: "restrict" }),
    sourceTable: text("source_table").notNull(),
    sourcePrimaryKey: text("source_primary_key").notNull(),
    sourceRowHash: text("source_row_hash").notNull(),
    candidateCourseId: text("candidate_course_id"),
    candidateRevisionId: text("candidate_revision_id"),
    candidateLessonId: text("candidate_lesson_id"),
    candidateActivityId: text("candidate_activity_id"),
    reasonCode: text("reason_code").notNull(),
    diagnostic: text("diagnostic").notNull(),
    resolutionStatus: text("resolution_status").$type<"unresolved">().notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("migration_quarantine_reason_idx").on(
      table.reasonCode,
      table.sourceTable,
      table.sourcePrimaryKey,
    ),
  ],
);

export const coursePackManifests = sqliteTable("course_pack_manifests", {
  revisionId: text("revision_id")
    .primaryKey()
    .references(() => courseRevisions.id, { onDelete: "restrict" }),
  formatVersion: integer("format_version").notNull(),
  canonicalJson: text("canonical_json").notNull(),
  contentHash: text("content_hash").notNull().unique(),
  sourceBytesHash: text("source_bytes_hash").notNull(),
  validationReportJson: text("validation_report_json").notNull(),
  validatorVersion: text("validator_version").notNull(),
  importedAt: integer("imported_at").notNull(),
});

export const coursePackLocalizations = sqliteTable(
  "course_pack_localizations",
  {
    revisionId: text("revision_id")
      .notNull()
      .references(() => coursePackManifests.revisionId, {
        onDelete: "restrict",
      }),
    locale: text("locale").notNull(),
    releaseComplete: integer("release_complete", { mode: "boolean" }).notNull(),
    fieldsJson: text("fields_json").notNull(),
  },
  (table) => [primaryKey({ columns: [table.revisionId, table.locale] })],
);

export const coursePackKnowledgeNodes = sqliteTable(
  "course_pack_knowledge_nodes",
  {
    revisionId: text("revision_id")
      .notNull()
      .references(() => coursePackManifests.revisionId, {
        onDelete: "restrict",
      }),
    knowledgeNodeId: text("knowledge_node_id").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    kind: text("kind")
      .$type<"concept" | "procedure" | "skill" | "misconception-family">()
      .notNull(),
    prerequisiteIdsJson: text("prerequisite_ids_json").notNull(),
    relatedIdsJson: text("related_ids_json").notNull(),
    lifecycle: text("lifecycle").$type<"active" | "superseded">().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.revisionId, table.knowledgeNodeId] }),
  ],
);

export const coursePackLifecycleEvents = sqliteTable(
  "course_pack_lifecycle_events",
  {
    id: text("id").primaryKey(),
    revisionId: text("revision_id")
      .notNull()
      .references(() => coursePackManifests.revisionId, {
        onDelete: "restrict",
      }),
    operationId: text("operation_id").notNull().unique(),
    action: text("action")
      .$type<"install" | "open-as-draft" | "uninstall">()
      .notNull(),
    occurredAt: integer("occurred_at").notNull(),
    detailsJson: text("details_json").notNull(),
  },
  (table) => [
    index("course_pack_lifecycle_revision_time_idx").on(
      table.revisionId,
      table.occurredAt,
      table.id,
    ),
  ],
);

export const coursePackQuarantine = sqliteTable(
  "course_pack_quarantine",
  {
    id: text("id").primaryKey(),
    sourceBytesHash: text("source_bytes_hash").notNull(),
    validatorVersion: text("validator_version").notNull(),
    reportJson: text("report_json").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("course_pack_quarantine_source_validator_uq").on(
      table.sourceBytesHash,
      table.validatorVersion,
    ),
  ],
);

export const learningKernelFacts = sqliteTable(
  "learning_kernel_facts",
  {
    id: text("id").primaryKey(),
    schemaVersion: integer("schema_version").notNull(),
    operationId: text("operation_id").notNull().unique(),
    courseId: text("course_id").notNull(),
    revisionId: text("revision_id").notNull(),
    branchId: text("branch_id").notNull(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessionCourseContexts.sessionId, {
        onDelete: "restrict",
      }),
    lessonId: text("lesson_id").notNull(),
    activityId: text("activity_id").notNull(),
    bodyType: text("body_type")
      .$type<"evidence" | "progress" | "correction">()
      .notNull(),
    provenanceKind: text("provenance_kind")
      .$type<
        | "learner_submission"
        | "deterministic_evaluator"
        | "trusted_check"
        | "reviewer"
        | "migration"
      >()
      .notNull(),
    supersedesFactId: text("supersedes_fact_id"),
    occurredAt: integer("occurred_at").notNull(),
    acceptedAt: integer("accepted_at").notNull(),
    canonicalJson: text("canonical_json").notNull(),
    factHash: text("fact_hash").notNull().unique(),
  },
  (table) => [
    index("learning_kernel_facts_replay_idx").on(
      table.sessionId,
      table.occurredAt,
      table.id,
    ),
    index("learning_kernel_facts_scope_idx").on(
      table.courseId,
      table.revisionId,
      table.branchId,
      table.activityId,
      table.occurredAt,
      table.id,
    ),
  ],
);

export const learningKernelProjectionHistory = sqliteTable(
  "learning_kernel_projection_history",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessionCourseContexts.sessionId, {
        onDelete: "restrict",
      }),
    courseId: text("course_id").notNull(),
    revisionId: text("revision_id").notNull(),
    branchId: text("branch_id").notNull(),
    modelVersion: text("model_version").$type<"baseline-1">().notNull(),
    schedulerVersion: text("scheduler_version").$type<"baseline-1">().notNull(),
    observedAt: integer("observed_at").notNull(),
    factFrontierHash: text("fact_frontier_hash").notNull(),
    projectionHash: text("projection_hash").notNull(),
    projectionJson: text("projection_json").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("learning_kernel_projection_history_hash_uq").on(
      table.sessionId,
      table.modelVersion,
      table.projectionHash,
    ),
    index("learning_kernel_projection_history_scope_idx").on(
      table.courseId,
      table.revisionId,
      table.branchId,
      table.observedAt,
      table.id,
    ),
  ],
);

export const learningKernelProjections = sqliteTable(
  "learning_kernel_projections",
  {
    sessionId: text("session_id")
      .primaryKey()
      .references(() => sessionCourseContexts.sessionId, {
        onDelete: "restrict",
      }),
    courseId: text("course_id").notNull(),
    revisionId: text("revision_id").notNull(),
    branchId: text("branch_id").notNull(),
    modelVersion: text("model_version").$type<"baseline-1">().notNull(),
    schedulerVersion: text("scheduler_version").$type<"baseline-1">().notNull(),
    observedAt: integer("observed_at").notNull(),
    factFrontierHash: text("fact_frontier_hash").notNull(),
    projectionHash: text("projection_hash").notNull(),
    projectionJson: text("projection_json").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("learning_kernel_projections_scope_idx").on(
      table.courseId,
      table.revisionId,
      table.branchId,
      table.sessionId,
    ),
  ],
);

export const learningKernelMigrationQuarantine = sqliteTable(
  "learning_kernel_migration_quarantine",
  {
    sourceTable: text("source_table").notNull(),
    sourceId: text("source_id").notNull(),
    reasonCode: text("reason_code").notNull(),
    sourceSnapshotJson: text("source_snapshot_json").notNull(),
    quarantinedAt: integer("quarantined_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.sourceTable, table.sourceId] })],
);

export const approvedCoreMigrationRuns = sqliteTable(
  "approved_core_migration_runs",
  {
    targetSchemaSha256: text("target_schema_sha256").primaryKey(),
    sourceSchemaSha256: text("source_schema_sha256").notNull(),
    sourceLogicalSha256: text("source_logical_sha256").notNull(),
    approvedBackupLogicalSha256: text(
      "approved_backup_logical_sha256",
    ).notNull(),
    approvedBackupSha256: text("approved_backup_sha256").notNull(),
    approvedBackupPathHash: text("approved_backup_path_hash").notNull(),
    completedAt: integer("completed_at").notNull(),
  },
);

export const providerHubConnections = sqliteTable(
  "provider_hub_connections",
  {
    connectionId: text("connection_id").primaryKey(),
    adapterId: text("adapter_id")
      .$type<"mock" | "opencode" | "codex" | "pi">()
      .notNull(),
    providerType: text("provider_type").notNull(),
    displayName: text("display_name").notNull(),
    credentialRef: text("credential_ref"),
    endpointProfileId: text("endpoint_profile_id"),
    enabled: integer("enabled", { mode: "boolean" }).notNull(),
    external: integer("external", { mode: "boolean" }).notNull(),
    state: text("state")
      .$type<
        | "disabled"
        | "starting"
        | "connected"
        | "degraded"
        | "authentication-required"
        | "unavailable"
        | "misconfigured"
        | "error"
      >()
      .notNull(),
    observedCapabilitiesJson: text("observed_capabilities_json"),
    lastCheckedAt: text("last_checked_at"),
    ...timestamps,
  },
  (table) => [
    index("provider_hub_connections_adapter_idx").on(
      table.adapterId,
      table.enabled,
    ),
  ],
);

export const providerHubRoleProfiles = sqliteTable(
  "provider_hub_role_profiles",
  {
    role: text("role")
      .$type<"course-designer" | "tutor" | "evaluator" | "reviewer">()
      .primaryKey(),
    mode: text("mode").$type<"no-ai" | "connection">().notNull(),
    connectionId: text("connection_id").references(
      () => providerHubConnections.connectionId,
      { onDelete: "restrict" },
    ),
    modelId: text("model_id"),
    requiredCapabilitiesJson: text("required_capabilities_json").notNull(),
    toolPolicyId: text("tool_policy_id").notNull(),
    budgetsJson: text("budgets_json").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    check(
      "provider_hub_role_profiles_mode_check",
      sql`(${table.mode} = 'no-ai' AND ${table.connectionId} IS NULL AND ${table.modelId} IS NULL) OR (${table.mode} = 'connection' AND ${table.connectionId} IS NOT NULL AND length(trim(${table.modelId})) BETWEEN 1 AND 300)`,
    ),
  ],
);

export const providerHubToolPolicies = sqliteTable(
  "provider_hub_tool_policies",
  {
    toolPolicyId: text("tool_policy_id").primaryKey(),
    role: text("role")
      .$type<"course-designer" | "tutor" | "evaluator" | "reviewer">()
      .notNull(),
    allowedToolsJson: text("allowed_tools_json").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
);

export const aiDisclosureOperations = sqliteTable(
  "ai_disclosure_operations",
  {
    operationId: text("operation_id").primaryKey(),
    role: text("role")
      .$type<"course-designer" | "tutor" | "evaluator" | "reviewer">()
      .notNull(),
    connectionId: text("connection_id")
      .notNull()
      .references(() => providerHubConnections.connectionId, {
        onDelete: "restrict",
      }),
    providerType: text("provider_type").notNull(),
    modelId: text("model_id").notNull(),
    destination: text("destination").notNull(),
    payloadCategoriesJson: text("payload_categories_json").notNull(),
    entityIdsJson: text("entity_ids_json").notNull(),
    exclusionsJson: text("exclusions_json").notNull(),
    byteCount: integer("byte_count").notNull(),
    payloadSha256: text("payload_sha256").notNull(),
    createdAt: text("created_at").notNull(),
    expiresAt: text("expires_at").notNull(),
  },
  (table) => [
    index("ai_disclosure_operations_connection_idx").on(
      table.connectionId,
      table.createdAt,
    ),
  ],
);

export const aiDisclosureEvents = sqliteTable(
  "ai_disclosure_events",
  {
    operationId: text("operation_id")
      .notNull()
      .references(() => aiDisclosureOperations.operationId, {
        onDelete: "restrict",
      }),
    sequence: integer("sequence").notNull(),
    status: text("status")
      .$type<"pending" | "approved" | "cancelled" | "consumed" | "expired">()
      .notNull(),
    occurredAt: text("occurred_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.operationId, table.sequence] }),
    index("ai_disclosure_events_status_idx").on(table.status, table.occurredAt),
  ],
);

export const providerTurnProvenance = sqliteTable(
  "provider_turn_provenance",
  {
    operationId: text("operation_id").primaryKey(),
    connectionId: text("connection_id")
      .notNull()
      .references(() => providerHubConnections.connectionId, {
        onDelete: "restrict",
      }),
    providerType: text("provider_type").notNull(),
    adapterId: text("adapter_id")
      .$type<"mock" | "opencode" | "codex" | "pi">()
      .notNull(),
    modelId: text("model_id").notNull(),
    role: text("role")
      .$type<"course-designer" | "tutor" | "evaluator" | "reviewer">()
      .notNull(),
    toolPolicyId: text("tool_policy_id").notNull(),
    capabilityObservedAt: text("capability_observed_at"),
    disclosureOperationId: text("disclosure_operation_id").references(
      () => aiDisclosureOperations.operationId,
      { onDelete: "restrict" },
    ),
    status: text("status")
      .$type<"started" | "completed" | "failed" | "cancelled">()
      .notNull(),
    failureCode: text("failure_code"),
    metadataJson: text("metadata_json"),
    createdAt: text("created_at").notNull(),
    completedAt: text("completed_at"),
  },
  (table) => [
    index("provider_turn_provenance_connection_idx").on(
      table.connectionId,
      table.createdAt,
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
  environmentPacks,
  trustedChecks,
  executionArtifacts,
  reviewEvidenceBundles,
  executionMigrationQuarantine,
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
  courses,
  courseRevisions,
  courseSections,
  courseLessons,
  courseLessonPrerequisites,
  courseActivities,
  courseActivityPrerequisites,
  sourceSnapshots,
  knowledgeCapsules,
  knowledgeCapsuleSources,
  adaptationBranches,
  sessionCourseContexts,
  evidenceFacts,
  reviewItems,
  coursePackManifests,
  coursePackLocalizations,
  coursePackKnowledgeNodes,
  coursePackLifecycleEvents,
  coursePackQuarantine,
  learningKernelFacts,
  learningKernelProjectionHistory,
  learningKernelProjections,
  learningKernelMigrationQuarantine,
  approvedCoreMigrationRuns,
  providerHubConnections,
  providerHubRoleProfiles,
  providerHubToolPolicies,
  aiDisclosureOperations,
  aiDisclosureEvents,
  providerTurnProvenance,
  migrationRuns,
  migrationProvenance,
  migrationQuarantine,
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
export type StoredEnvironmentPack = typeof environmentPacks.$inferSelect;
export type StoredTrustedCheck = typeof trustedChecks.$inferSelect;
export type StoredExecutionArtifact = typeof executionArtifacts.$inferSelect;
export type StoredReviewEvidenceBundle =
  typeof reviewEvidenceBundles.$inferSelect;
export type StoredExecutionMigrationQuarantine =
  typeof executionMigrationQuarantine.$inferSelect;
export type StoredCourse = typeof courses.$inferSelect;
export type StoredCourseRevision = typeof courseRevisions.$inferSelect;
export type StoredCourseSection = typeof courseSections.$inferSelect;
export type StoredCourseLesson = typeof courseLessons.$inferSelect;
export type StoredCourseActivity = typeof courseActivities.$inferSelect;
export type StoredSourceSnapshot = typeof sourceSnapshots.$inferSelect;
export type StoredKnowledgeCapsule = typeof knowledgeCapsules.$inferSelect;
export type StoredAdaptationBranch = typeof adaptationBranches.$inferSelect;
export type StoredSessionCourseContext =
  typeof sessionCourseContexts.$inferSelect;
export type StoredEvidenceFact = typeof evidenceFacts.$inferSelect;
export type StoredReviewItem = typeof reviewItems.$inferSelect;
export type StoredCoursePackManifest = typeof coursePackManifests.$inferSelect;
export type StoredCoursePackLocalization =
  typeof coursePackLocalizations.$inferSelect;
export type StoredCoursePackKnowledgeNode =
  typeof coursePackKnowledgeNodes.$inferSelect;
export type StoredCoursePackLifecycleEvent =
  typeof coursePackLifecycleEvents.$inferSelect;
export type StoredCoursePackQuarantine =
  typeof coursePackQuarantine.$inferSelect;
export type StoredLearningKernelFact = typeof learningKernelFacts.$inferSelect;
export type StoredLearningKernelProjection =
  typeof learningKernelProjections.$inferSelect;
export type StoredLearningKernelProjectionHistory =
  typeof learningKernelProjectionHistory.$inferSelect;
export type StoredLearningKernelMigrationQuarantine =
  typeof learningKernelMigrationQuarantine.$inferSelect;
export type ApprovedCoreMigrationRun =
  typeof approvedCoreMigrationRuns.$inferSelect;
export type MigrationRun = typeof migrationRuns.$inferSelect;
export type MigrationProvenance = typeof migrationProvenance.$inferSelect;
export type MigrationQuarantine = typeof migrationQuarantine.$inferSelect;
