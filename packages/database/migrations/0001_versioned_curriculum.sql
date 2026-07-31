CREATE TABLE IF NOT EXISTS curricula (
  id TEXT PRIMARY KEY NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT,
  active_version_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS curriculum_versions (
  id TEXT PRIMARY KEY NOT NULL,
  curriculum_id TEXT NOT NULL REFERENCES curricula(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL CHECK(revision > 0),
  parent_version_id TEXT REFERENCES curriculum_versions(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK(status IN ('draft', 'published', 'archived')),
  title TEXT NOT NULL,
  description TEXT,
  content_hash TEXT,
  created_at INTEGER NOT NULL,
  published_at INTEGER,
  archived_at INTEGER,
  updated_at INTEGER NOT NULL,
  UNIQUE(curriculum_id, revision),
  CHECK(status = 'draft' OR content_hash IS NOT NULL),
  CHECK(status != 'published' OR published_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS curriculum_versions_status_idx
  ON curriculum_versions(curriculum_id, status, revision);

CREATE TABLE IF NOT EXISTS curriculum_weeks (
  id TEXT PRIMARY KEY NOT NULL,
  version_id TEXT NOT NULL REFERENCES curriculum_versions(id) ON DELETE CASCADE,
  stable_id TEXT NOT NULL,
  order_index INTEGER NOT NULL CHECK(order_index >= 0),
  title TEXT NOT NULL,
  description TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(version_id, stable_id),
  UNIQUE(version_id, order_index)
);

CREATE TABLE IF NOT EXISTS curriculum_days_v2 (
  id TEXT PRIMARY KEY NOT NULL,
  version_id TEXT NOT NULL REFERENCES curriculum_versions(id) ON DELETE CASCADE,
  week_id TEXT NOT NULL REFERENCES curriculum_weeks(id) ON DELETE CASCADE,
  stable_id TEXT NOT NULL,
  order_index INTEGER NOT NULL CHECK(order_index >= 0),
  title TEXT NOT NULL,
  description TEXT,
  goal TEXT NOT NULL,
  estimated_minutes INTEGER NOT NULL CHECK(estimated_minutes > 0),
  prerequisites_json TEXT NOT NULL DEFAULT '[]',
  expected_outcomes_json TEXT NOT NULL DEFAULT '[]',
  depth_level TEXT NOT NULL,
  out_of_scope_json TEXT NOT NULL DEFAULT '[]',
  topics_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(version_id, stable_id),
  UNIQUE(week_id, order_index)
);
CREATE INDEX IF NOT EXISTS curriculum_days_v2_version_idx
  ON curriculum_days_v2(version_id, week_id, order_index);

CREATE TABLE IF NOT EXISTS curriculum_units (
  id TEXT PRIMARY KEY NOT NULL,
  version_id TEXT NOT NULL REFERENCES curriculum_versions(id) ON DELETE CASCADE,
  day_id TEXT NOT NULL REFERENCES curriculum_days_v2(id) ON DELETE CASCADE,
  stable_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN (
    'briefing', 'study', 'recall', 'teacher-dialogue', 'quiz', 'code-reading',
    'exercise', 'review', 'interview', 'summary', 'checkpoint', 'spaced-review'
  )),
  order_index INTEGER NOT NULL CHECK(order_index >= 0),
  title TEXT NOT NULL,
  description TEXT,
  estimated_minutes INTEGER,
  objectives_json TEXT NOT NULL DEFAULT '[]',
  checklist_json TEXT NOT NULL DEFAULT '[]',
  sources_json TEXT NOT NULL DEFAULT '[]',
  questions_json TEXT NOT NULL DEFAULT '[]',
  misconceptions_json TEXT NOT NULL DEFAULT '[]',
  reference_answer_json TEXT,
  completion_criteria_json TEXT NOT NULL,
  unlock_rules_json TEXT NOT NULL DEFAULT '[]',
  optional INTEGER NOT NULL DEFAULT 0 CHECK(optional IN (0, 1)),
  depth_level TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(version_id, stable_id),
  UNIQUE(day_id, order_index)
);
CREATE INDEX IF NOT EXISTS curriculum_units_version_day_idx
  ON curriculum_units(version_id, day_id, order_index);

ALTER TABLE learning_sessions ADD COLUMN curriculum_day_v2_id TEXT
  REFERENCES curriculum_days_v2(id) ON DELETE RESTRICT;

CREATE TABLE IF NOT EXISTS session_snapshots (
  id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL UNIQUE REFERENCES learning_sessions(id) ON DELETE CASCADE,
  schema_version INTEGER NOT NULL CHECK(schema_version > 0),
  curriculum_id TEXT REFERENCES curricula(id) ON DELETE RESTRICT,
  curriculum_version_id TEXT REFERENCES curriculum_versions(id) ON DELETE RESTRICT,
  curriculum_day_id TEXT REFERENCES curriculum_days_v2(id) ON DELETE RESTRICT,
  content_hash TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS session_snapshots_version_idx
  ON session_snapshots(curriculum_version_id, curriculum_day_id);

CREATE TABLE IF NOT EXISTS unit_progress (
  id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL REFERENCES learning_sessions(id) ON DELETE CASCADE,
  unit_id TEXT NOT NULL,
  unit_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('locked', 'ready', 'in_progress', 'completed', 'skipped')),
  progress_json TEXT NOT NULL DEFAULT '{}',
  started_at INTEGER,
  completed_at INTEGER,
  skipped_at INTEGER,
  updated_at INTEGER NOT NULL,
  UNIQUE(session_id, unit_id)
);
CREATE INDEX IF NOT EXISTS unit_progress_session_order_idx
  ON unit_progress(session_id, updated_at);

-- 0000 allowed one active session per day. Keep the newest legacy session active
-- and retain older histories as abandoned before enforcing the v2 global invariant.
UPDATE learning_sessions
SET status = 'abandoned', updated_at = MAX(updated_at, unixepoch() * 1000)
WHERE status = 'active'
  AND id != (
    SELECT id FROM learning_sessions
    WHERE status = 'active'
    ORDER BY updated_at DESC, id DESC LIMIT 1
  );
CREATE UNIQUE INDEX IF NOT EXISTS learning_sessions_one_global_active_uq
  ON learning_sessions(status) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS learner_state (
  id TEXT PRIMARY KEY NOT NULL CHECK(id = 'default'),
  current_learning_session_id TEXT REFERENCES learning_sessions(id) ON DELETE SET NULL,
  updated_at INTEGER NOT NULL
);

-- Published graph rows are immutable even when callers bypass the authoring repository.
CREATE TRIGGER IF NOT EXISTS curriculum_versions_published_update_guard
BEFORE UPDATE ON curriculum_versions
WHEN OLD.status != 'draft'
  AND NOT (OLD.id = 'legacy-v1' AND OLD.content_hash = 'legacy-v1')
  AND (
  NEW.curriculum_id IS NOT OLD.curriculum_id OR
  NEW.revision IS NOT OLD.revision OR
  NEW.parent_version_id IS NOT OLD.parent_version_id OR
  NEW.title IS NOT OLD.title OR
  NEW.description IS NOT OLD.description OR
  NEW.content_hash IS NOT OLD.content_hash OR
  NEW.created_at IS NOT OLD.created_at OR
  NEW.published_at IS NOT OLD.published_at OR
  NOT (NEW.status = OLD.status OR (OLD.status = 'published' AND NEW.status = 'archived'))
)
BEGIN SELECT RAISE(ABORT, 'published curriculum version is immutable'); END;
CREATE TRIGGER IF NOT EXISTS curriculum_versions_published_delete_guard
BEFORE DELETE ON curriculum_versions
WHEN OLD.status != 'draft'
BEGIN SELECT RAISE(ABORT, 'published curriculum version is immutable'); END;
CREATE TRIGGER IF NOT EXISTS curriculum_weeks_published_update_guard
BEFORE UPDATE ON curriculum_weeks
WHEN EXISTS (SELECT 1 FROM curriculum_versions v WHERE v.id = OLD.version_id AND v.status != 'draft')
BEGIN SELECT RAISE(ABORT, 'published curriculum version is immutable'); END;
CREATE TRIGGER IF NOT EXISTS curriculum_weeks_published_delete_guard
BEFORE DELETE ON curriculum_weeks
WHEN EXISTS (SELECT 1 FROM curriculum_versions v WHERE v.id = OLD.version_id AND v.status != 'draft')
BEGIN SELECT RAISE(ABORT, 'published curriculum version is immutable'); END;
CREATE TRIGGER IF NOT EXISTS curriculum_days_v2_published_update_guard
BEFORE UPDATE ON curriculum_days_v2
WHEN EXISTS (SELECT 1 FROM curriculum_versions v WHERE v.id = OLD.version_id AND v.status != 'draft')
BEGIN SELECT RAISE(ABORT, 'published curriculum version is immutable'); END;
CREATE TRIGGER IF NOT EXISTS curriculum_days_v2_published_delete_guard
BEFORE DELETE ON curriculum_days_v2
WHEN EXISTS (SELECT 1 FROM curriculum_versions v WHERE v.id = OLD.version_id AND v.status != 'draft')
BEGIN SELECT RAISE(ABORT, 'published curriculum version is immutable'); END;
CREATE TRIGGER IF NOT EXISTS curriculum_units_published_update_guard
BEFORE UPDATE ON curriculum_units
WHEN EXISTS (SELECT 1 FROM curriculum_versions v WHERE v.id = OLD.version_id AND v.status != 'draft')
BEGIN SELECT RAISE(ABORT, 'published curriculum version is immutable'); END;
CREATE TRIGGER IF NOT EXISTS curriculum_units_published_delete_guard
BEFORE DELETE ON curriculum_units
WHEN EXISTS (SELECT 1 FROM curriculum_versions v WHERE v.id = OLD.version_id AND v.status != 'draft')
BEGIN SELECT RAISE(ABORT, 'published curriculum version is immutable'); END;

-- Preserve the old graph as an immutable published revision without deleting or rewriting it.
INSERT OR IGNORE INTO curricula
  (id, slug, title, description, active_version_id, created_at, updated_at)
SELECT 'legacy-curriculum', 'legacy-curriculum', 'Legacy curriculum',
       'Imported from the pre-versioned curriculum', 'legacy-v1',
       MIN(created_at), MAX(updated_at)
FROM curriculum_days
HAVING COUNT(*) > 0;

INSERT OR IGNORE INTO curriculum_versions
  (id, curriculum_id, revision, parent_version_id, status, title, description,
   content_hash, created_at, published_at, archived_at, updated_at)
SELECT 'legacy-v1', 'legacy-curriculum', 1, NULL, 'published', 'Legacy revision',
       'Imported from the pre-versioned curriculum', 'legacy-v1',
       MIN(created_at), MIN(created_at), NULL, MAX(updated_at)
FROM curriculum_days
HAVING COUNT(*) > 0;

INSERT OR IGNORE INTO curriculum_weeks
  (id, version_id, stable_id, order_index, title, description, created_at, updated_at)
SELECT 'legacy-week-' || printf('%04d', week_number), 'legacy-v1',
       'week-' || printf('%04d', week_number), week_number - 1,
       'Week ' || week_number, NULL, MIN(created_at), MAX(updated_at)
FROM curriculum_days
GROUP BY week_number;

INSERT OR IGNORE INTO curriculum_days_v2
  (id, version_id, week_id, stable_id, order_index, title, description, goal,
   estimated_minutes, prerequisites_json, expected_outcomes_json, depth_level,
   out_of_scope_json, topics_json, created_at, updated_at)
SELECT 'legacy-day:' || d.id, 'legacy-v1',
       'legacy-week-' || printf('%04d', d.week_number), d.id, d.day_number - 1,
       d.title, d.summary, d.summary, d.estimated_minutes, '[]', d.goals_json,
       'foundation', '[]',
       COALESCE((SELECT json_group_array(t.slug)
                 FROM curriculum_day_topics dt
                 JOIN topics t ON t.id = dt.topic_id
                 WHERE dt.day_id = d.id ORDER BY dt.order_index), '[]'),
       d.created_at, d.updated_at
FROM curriculum_days d;

INSERT OR IGNORE INTO curriculum_units
  (id, version_id, day_id, stable_id, type, order_index, title, description,
   estimated_minutes, objectives_json, checklist_json, sources_json, questions_json,
   misconceptions_json, reference_answer_json, completion_criteria_json,
   unlock_rules_json, optional, depth_level, payload_json, created_at, updated_at)
SELECT 'legacy-question:' || q.id, 'legacy-v1', 'legacy-day:' || q.day_id,
       q.id, CASE WHEN q.kind = 'code-reading' THEN 'code-reading' ELSE 'quiz' END,
       q.order_index, q.prompt, NULL,
       CASE WHEN q.expected_seconds IS NULL THEN NULL ELSE MAX(1, q.expected_seconds / 60) END,
       q.key_points_json, '[]', '[]', json_array(json_object('id', q.id, 'prompt', q.prompt)),
       '[]', CASE WHEN q.reference_answer IS NULL THEN NULL ELSE json_quote(q.reference_answer) END,
       json_array(json_object('kind', 'attempt-count', 'minimum', q.reveal_after_attempts)),
       '[]', 0, 'foundation', json_object('legacyQuestionId', q.id),
       q.created_at, q.updated_at
FROM questions q;

INSERT OR IGNORE INTO curriculum_units
  (id, version_id, day_id, stable_id, type, order_index, title, description,
   estimated_minutes, objectives_json, checklist_json, sources_json, questions_json,
   misconceptions_json, reference_answer_json, completion_criteria_json,
   unlock_rules_json, optional, depth_level, payload_json, created_at, updated_at)
SELECT 'legacy-exercise:' || e.id, 'legacy-v1', 'legacy-day:' || e.day_id,
       e.id, 'exercise', 10000 + ROW_NUMBER() OVER (PARTITION BY e.day_id ORDER BY e.id),
       e.title, e.prompt, e.estimated_minutes, '[]', '[]', '[]', '[]', '[]', NULL,
       e.criteria_json, '[]', 0, 'foundation',
       json_object('legacyExerciseId', e.id, 'workspacePath', e.workspace_path,
                   'constraints', json(e.constraints_json),
                   'allowedOperations', json(e.allowed_operations_json)),
       e.created_at, e.updated_at
FROM exercises e;

UPDATE learning_sessions
SET curriculum_day_v2_id = 'legacy-day:' || day_id
WHERE curriculum_day_v2_id IS NULL;

INSERT OR IGNORE INTO session_snapshots
  (id, session_id, schema_version, curriculum_id, curriculum_version_id,
   curriculum_day_id, content_hash, snapshot_json, created_at)
SELECT 'legacy-snapshot:' || s.id, s.id, 1, 'legacy-curriculum', 'legacy-v1', d.id,
       'legacy-v1:' || s.day_id,
       json_object(
         'schemaVersion', 1,
         'contentHash', 'legacy-v1:' || s.day_id,
         'curriculumId', 'legacy-curriculum',
         'curriculumVersionId', 'legacy-v1',
         'curriculumRevision', 1,
         'curriculumTitle', 'Legacy curriculum',
         'week', json_object('id', w.id, 'stableId', w.stable_id, 'title', w.title),
         'day', json_object('id', d.id, 'stableId', d.stable_id, 'title', d.title,
                            'description', d.description, 'goal', d.goal,
                            'estimatedMinutes', d.estimated_minutes,
                            'depthLevel', d.depth_level),
         'units', json(COALESCE((
           SELECT json_group_array(json_object(
             'id', u.id, 'stableId', u.stable_id, 'type', u.type,
             'orderIndex', u.order_index, 'title', u.title,
             'description', u.description, 'optional', json(u.optional),
             'completionCriteria', json(u.completion_criteria_json),
             'payload', json(u.payload_json)))
           FROM curriculum_units u WHERE u.day_id = d.id ORDER BY u.order_index
         ), '[]')),
         'capturedAt', s.started_at
       ),
       s.started_at
FROM learning_sessions s
JOIN curriculum_days_v2 d ON d.stable_id = s.day_id AND d.version_id = 'legacy-v1'
JOIN curriculum_weeks w ON w.id = d.week_id;

INSERT OR IGNORE INTO unit_progress
  (id, session_id, unit_id, unit_type, status, progress_json, started_at, completed_at, skipped_at, updated_at)
SELECT 'legacy-progress:' || s.id || ':' || u.id, s.id, u.id, u.type,
       CASE WHEN s.status = 'completed' THEN 'completed' ELSE
         CASE WHEN u.order_index = (SELECT MIN(u2.order_index) FROM curriculum_units u2 WHERE u2.day_id = u.day_id)
              THEN 'ready' ELSE 'locked' END END,
       '{}', NULL, CASE WHEN s.status = 'completed' THEN s.completed_at ELSE NULL END, NULL, s.updated_at
FROM learning_sessions s
JOIN curriculum_days_v2 d ON d.stable_id = s.day_id AND d.version_id = 'legacy-v1'
JOIN curriculum_units u ON u.day_id = d.id;

INSERT INTO learner_state (id, current_learning_session_id, updated_at)
VALUES (
  'default',
  (SELECT id FROM learning_sessions WHERE status = 'active' ORDER BY updated_at DESC LIMIT 1),
  COALESCE((SELECT MAX(updated_at) FROM learning_sessions), unixepoch() * 1000)
)
ON CONFLICT(id) DO UPDATE SET
  current_learning_session_id = excluded.current_learning_session_id,
  updated_at = excluded.updated_at;

CREATE TRIGGER IF NOT EXISTS curriculum_weeks_published_insert_guard
BEFORE INSERT ON curriculum_weeks
WHEN EXISTS (SELECT 1 FROM curriculum_versions v WHERE v.id = NEW.version_id AND v.status != 'draft')
BEGIN SELECT RAISE(ABORT, 'published curriculum version is immutable'); END;
CREATE TRIGGER IF NOT EXISTS curriculum_days_v2_published_insert_guard
BEFORE INSERT ON curriculum_days_v2
WHEN EXISTS (SELECT 1 FROM curriculum_versions v WHERE v.id = NEW.version_id AND v.status != 'draft')
BEGIN SELECT RAISE(ABORT, 'published curriculum version is immutable'); END;
CREATE TRIGGER IF NOT EXISTS curriculum_units_published_insert_guard
BEFORE INSERT ON curriculum_units
WHEN EXISTS (SELECT 1 FROM curriculum_versions v WHERE v.id = NEW.version_id AND v.status != 'draft')
BEGIN SELECT RAISE(ABORT, 'published curriculum version is immutable'); END;
