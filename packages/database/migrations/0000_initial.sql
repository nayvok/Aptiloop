CREATE TABLE IF NOT EXISTS topics (
  id TEXT PRIMARY KEY NOT NULL, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL,
  description TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS curriculum_days (
  id TEXT PRIMARY KEY NOT NULL, slug TEXT NOT NULL UNIQUE, week_number INTEGER NOT NULL,
  day_number INTEGER NOT NULL, title TEXT NOT NULL, summary TEXT NOT NULL,
  estimated_minutes INTEGER NOT NULL, goals_json TEXT NOT NULL, sources_json TEXT NOT NULL,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  UNIQUE (week_number, day_number)
);
CREATE TABLE IF NOT EXISTS curriculum_day_topics (
  day_id TEXT NOT NULL REFERENCES curriculum_days(id) ON DELETE CASCADE,
  topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  order_index INTEGER NOT NULL, PRIMARY KEY (day_id, topic_id)
);
CREATE INDEX IF NOT EXISTS curriculum_day_topics_topic_idx ON curriculum_day_topics(topic_id);
CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY NOT NULL, day_id TEXT NOT NULL REFERENCES curriculum_days(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, prompt TEXT NOT NULL, expected_seconds INTEGER, order_index INTEGER NOT NULL,
  reference_answer TEXT, key_points_json TEXT NOT NULL, reveal_after_attempts INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS questions_day_idx ON questions(day_id, order_index);
CREATE TABLE IF NOT EXISTS exercises (
  id TEXT PRIMARY KEY NOT NULL, day_id TEXT NOT NULL REFERENCES curriculum_days(id) ON DELETE CASCADE,
  slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL, prompt TEXT NOT NULL, difficulty TEXT NOT NULL,
  estimated_minutes INTEGER NOT NULL, workspace_path TEXT NOT NULL, constraints_json TEXT NOT NULL,
  criteria_json TEXT NOT NULL, allowed_operations_json TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS exercises_day_idx ON exercises(day_id);
CREATE TABLE IF NOT EXISTS learning_sessions (
  id TEXT PRIMARY KEY NOT NULL, day_id TEXT NOT NULL REFERENCES curriculum_days(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK(status IN ('active','completed','abandoned')),
  current_step TEXT NOT NULL, idempotency_key TEXT UNIQUE, started_at INTEGER NOT NULL,
  completed_at INTEGER, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS learning_sessions_status_idx ON learning_sessions(status, updated_at);
CREATE UNIQUE INDEX IF NOT EXISTS learning_sessions_one_active_day_uq
  ON learning_sessions(day_id) WHERE status = 'active';
CREATE TABLE IF NOT EXISTS answer_attempts (
  id TEXT PRIMARY KEY NOT NULL, session_id TEXT NOT NULL REFERENCES learning_sessions(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE RESTRICT,
  attempt_number INTEGER NOT NULL CHECK(attempt_number > 0), answer TEXT NOT NULL,
  correctness INTEGER CHECK(correctness BETWEEN 0 AND 100), feedback TEXT,
  idempotency_key TEXT UNIQUE, submitted_at INTEGER NOT NULL,
  UNIQUE(session_id, question_id, attempt_number)
);
CREATE INDEX IF NOT EXISTS answer_attempts_question_idx ON answer_attempts(question_id, submitted_at);
CREATE TABLE IF NOT EXISTS exercise_attempts (
  id TEXT PRIMARY KEY NOT NULL, session_id TEXT NOT NULL REFERENCES learning_sessions(id) ON DELETE CASCADE,
  exercise_id TEXT NOT NULL REFERENCES exercises(id) ON DELETE RESTRICT,
  status TEXT NOT NULL, workspace_path TEXT NOT NULL, baseline_path TEXT NOT NULL,
  baseline_hash TEXT NOT NULL, started_at INTEGER NOT NULL, completed_at INTEGER, updated_at INTEGER NOT NULL,
  UNIQUE(session_id, exercise_id)
);
CREATE TABLE IF NOT EXISTS test_runs (
  id TEXT PRIMARY KEY NOT NULL, exercise_attempt_id TEXT NOT NULL REFERENCES exercise_attempts(id) ON DELETE CASCADE,
  operation_id TEXT NOT NULL, status TEXT NOT NULL, exit_code INTEGER, stdout TEXT NOT NULL,
  stderr TEXT NOT NULL, duration_ms INTEGER, started_at INTEGER NOT NULL, completed_at INTEGER
);
CREATE INDEX IF NOT EXISTS test_runs_attempt_idx ON test_runs(exercise_attempt_id, started_at);
CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY NOT NULL, session_id TEXT NOT NULL REFERENCES learning_sessions(id) ON DELETE CASCADE,
  exercise_attempt_id TEXT REFERENCES exercise_attempts(id) ON DELETE SET NULL,
  provider_id TEXT NOT NULL, model_id TEXT NOT NULL, status TEXT NOT NULL,
  result_json TEXT, raw_response TEXT, created_at INTEGER NOT NULL, completed_at INTEGER
);
CREATE INDEX IF NOT EXISTS reviews_session_idx ON reviews(session_id, created_at);
CREATE TABLE IF NOT EXISTS hints (
  id TEXT PRIMARY KEY NOT NULL, session_id TEXT NOT NULL REFERENCES learning_sessions(id) ON DELETE CASCADE,
  question_id TEXT REFERENCES questions(id) ON DELETE RESTRICT,
  exercise_id TEXT REFERENCES exercises(id) ON DELETE RESTRICT,
  level INTEGER NOT NULL CHECK(level BETWEEN 0 AND 3), content TEXT, used_at INTEGER NOT NULL,
  CHECK(question_id IS NOT NULL OR exercise_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS hints_session_idx ON hints(session_id, used_at);
CREATE TABLE IF NOT EXISTS mistakes (
  id TEXT PRIMARY KEY NOT NULL, session_id TEXT NOT NULL REFERENCES learning_sessions(id) ON DELETE CASCADE,
  topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE RESTRICT,
  source_type TEXT NOT NULL, source_id TEXT NOT NULL, summary TEXT NOT NULL, correction TEXT NOT NULL,
  fingerprint TEXT NOT NULL, occurrence_count INTEGER NOT NULL, first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL, resolved_at INTEGER, UNIQUE(session_id, fingerprint)
);
CREATE INDEX IF NOT EXISTS mistakes_topic_idx ON mistakes(topic_id, last_seen_at);
CREATE TABLE IF NOT EXISTS mastery_scores (
  id TEXT PRIMARY KEY NOT NULL, topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  dimension TEXT NOT NULL, score INTEGER NOT NULL CHECK(score BETWEEN 0 AND 500),
  confidence INTEGER NOT NULL CHECK(confidence BETWEEN 0 AND 100), evidence_count INTEGER NOT NULL,
  evidence_types_json TEXT NOT NULL, last_evidence_at INTEGER, updated_at INTEGER NOT NULL,
  UNIQUE(topic_id, dimension)
);
CREATE TABLE IF NOT EXISTS mastery_evidence (
  id TEXT PRIMARY KEY NOT NULL, session_id TEXT NOT NULL REFERENCES learning_sessions(id) ON DELETE CASCADE,
  topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE, dimension TEXT NOT NULL,
  evidence_type TEXT NOT NULL, source_id TEXT NOT NULL, delta INTEGER NOT NULL, score_after INTEGER NOT NULL,
  observed_at INTEGER NOT NULL, UNIQUE(session_id, topic_id, dimension, evidence_type, source_id)
);
CREATE TABLE IF NOT EXISTS flashcards (
  id TEXT PRIMARY KEY NOT NULL, topic_id TEXT REFERENCES topics(id) ON DELETE SET NULL,
  source_mistake_id TEXT REFERENCES mistakes(id) ON DELETE SET NULL, front TEXT NOT NULL,
  back TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('candidate','approved','suspended','archived')),
  due_at INTEGER, interval_days INTEGER NOT NULL, ease_factor INTEGER NOT NULL,
  review_count INTEGER NOT NULL, idempotency_key TEXT UNIQUE, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS flashcards_status_due_idx ON flashcards(status, due_at);
CREATE TABLE IF NOT EXISTS interview_sessions (
  id TEXT PRIMARY KEY NOT NULL, learning_session_id TEXT REFERENCES learning_sessions(id) ON DELETE SET NULL,
  status TEXT NOT NULL, result_json TEXT, started_at INTEGER NOT NULL, completed_at INTEGER
);
CREATE INDEX IF NOT EXISTS interview_sessions_learning_idx ON interview_sessions(learning_session_id);
CREATE TABLE IF NOT EXISTS agent_conversations (
  id TEXT PRIMARY KEY NOT NULL, learning_session_id TEXT REFERENCES learning_sessions(id) ON DELETE SET NULL,
  role TEXT NOT NULL, provider_id TEXT NOT NULL, model_id TEXT NOT NULL, provider_session_id TEXT,
  status TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS agent_conversations_learning_idx ON agent_conversations(learning_session_id, updated_at);
CREATE TABLE IF NOT EXISTS agent_messages (
  id TEXT PRIMARY KEY NOT NULL, conversation_id TEXT NOT NULL REFERENCES agent_conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL, content TEXT NOT NULL, tool_events_json TEXT NOT NULL, raw_event_json TEXT,
  status TEXT NOT NULL, sequence INTEGER NOT NULL, idempotency_key TEXT UNIQUE, created_at INTEGER NOT NULL,
  UNIQUE(conversation_id, sequence)
);
CREATE TABLE IF NOT EXISTS provider_configurations (
  provider_id TEXT PRIMARY KEY NOT NULL, enabled INTEGER NOT NULL CHECK(enabled IN (0,1)), endpoint TEXT,
  teacher_model_id TEXT, reviewer_model_id TEXT, interviewer_model_id TEXT,
  options_json TEXT NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS application_settings (
  key TEXT PRIMARY KEY NOT NULL, value_json TEXT NOT NULL, updated_at INTEGER NOT NULL
);
