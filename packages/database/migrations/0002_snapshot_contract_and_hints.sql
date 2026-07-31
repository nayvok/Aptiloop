CREATE TABLE IF NOT EXISTS hint_usages_v2 (
  id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL REFERENCES learning_sessions(id) ON DELETE CASCADE,
  unit_id TEXT NOT NULL,
  question_attempt_id TEXT REFERENCES answer_attempts(id) ON DELETE SET NULL,
  exercise_attempt_id TEXT REFERENCES exercise_attempts(id) ON DELETE SET NULL,
  level INTEGER NOT NULL CHECK(level BETWEEN 0 AND 5),
  reason TEXT NOT NULL CHECK(length(trim(reason)) > 0),
  content TEXT,
  used_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS hint_usages_v2_session_unit_idx
  ON hint_usages_v2(session_id, unit_id, used_at);
CREATE INDEX IF NOT EXISTS hint_usages_v2_exercise_attempt_idx
  ON hint_usages_v2(exercise_attempt_id, used_at);
