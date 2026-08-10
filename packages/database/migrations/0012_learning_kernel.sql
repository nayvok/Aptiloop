ALTER TABLE course_activities
  ADD COLUMN knowledge_node_ids_json TEXT NOT NULL DEFAULT '[]'
  CHECK(json_valid(knowledge_node_ids_json) AND substr(ltrim(knowledge_node_ids_json), 1, 1) = '[');

-- M4 persists accepted Learning Kernel facts and immutable projection history.
-- Facts remain append-only; a correction is another fact linked to its target.
-- Current projections are rebuildable caches, never a replacement for fact history.

CREATE TABLE learning_kernel_facts (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(trim(id)) BETWEEN 1 AND 500),
  schema_version INTEGER NOT NULL CHECK(schema_version = 1),
  operation_id TEXT NOT NULL UNIQUE CHECK(length(trim(operation_id)) BETWEEN 1 AND 500),
  course_id TEXT NOT NULL,
  revision_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  lesson_id TEXT NOT NULL,
  activity_id TEXT NOT NULL,
  body_type TEXT NOT NULL CHECK(body_type IN ('evidence', 'progress', 'correction', 'review')),
  provenance_kind TEXT NOT NULL CHECK(provenance_kind IN (
    'learner_submission', 'deterministic_evaluator', 'trusted_check',
    'reviewer', 'migration'
  )),
  supersedes_fact_id TEXT REFERENCES learning_kernel_facts(id) ON DELETE RESTRICT,
  occurred_at INTEGER NOT NULL,
  accepted_at INTEGER NOT NULL CHECK(accepted_at >= occurred_at),
  canonical_json TEXT NOT NULL CHECK(
    json_valid(canonical_json) AND substr(ltrim(canonical_json), 1, 1) = '{'
  ),
  fact_hash TEXT NOT NULL UNIQUE CHECK(
    length(fact_hash) = 71 AND substr(fact_hash, 1, 7) = 'sha256:'
    AND substr(fact_hash, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  UNIQUE(course_id, revision_id, id),
  FOREIGN KEY (session_id, course_id, revision_id, lesson_id)
    REFERENCES session_course_contexts(session_id, course_id, revision_id, lesson_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (course_id, revision_id, lesson_id, activity_id)
    REFERENCES course_activities(course_id, revision_id, lesson_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (course_id, branch_id)
    REFERENCES adaptation_branches(course_id, id) ON DELETE RESTRICT,
  CHECK(
    (body_type = 'correction' AND supersedes_fact_id IS NOT NULL)
    OR (body_type != 'correction' AND supersedes_fact_id IS NULL)
  )
);
CREATE INDEX learning_kernel_facts_replay_idx
  ON learning_kernel_facts(session_id, occurred_at, id);
CREATE INDEX learning_kernel_facts_scope_idx
  ON learning_kernel_facts(course_id, revision_id, branch_id, activity_id, occurred_at, id);

CREATE TABLE learning_kernel_projection_history (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(trim(id)) BETWEEN 1 AND 500),
  session_id TEXT NOT NULL REFERENCES session_course_contexts(session_id) ON DELETE RESTRICT,
  course_id TEXT NOT NULL,
  revision_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  model_version TEXT NOT NULL CHECK(model_version = 'baseline-1'),
  scheduler_version TEXT NOT NULL CHECK(scheduler_version = 'baseline-1'),
  observed_at INTEGER NOT NULL,
  fact_frontier_hash TEXT NOT NULL CHECK(
    length(fact_frontier_hash) = 71 AND substr(fact_frontier_hash, 1, 7) = 'sha256:'
    AND substr(fact_frontier_hash, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  projection_hash TEXT NOT NULL CHECK(
    length(projection_hash) = 71 AND substr(projection_hash, 1, 7) = 'sha256:'
    AND substr(projection_hash, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  projection_json TEXT NOT NULL CHECK(
    json_valid(projection_json) AND substr(ltrim(projection_json), 1, 1) = '{'
  ),
  created_at INTEGER NOT NULL,
  UNIQUE(session_id, model_version, projection_hash),
  FOREIGN KEY (course_id, revision_id)
    REFERENCES course_revisions(course_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (course_id, branch_id)
    REFERENCES adaptation_branches(course_id, id) ON DELETE RESTRICT
);

CREATE TABLE learning_kernel_migration_quarantine (
  source_table TEXT NOT NULL,
  source_id TEXT NOT NULL,
  reason_code TEXT NOT NULL CHECK(length(trim(reason_code)) BETWEEN 1 AND 200),
  source_snapshot_json TEXT NOT NULL CHECK(
    json_valid(source_snapshot_json)
    AND substr(ltrim(source_snapshot_json), 1, 1) = '{'
  ),
  quarantined_at INTEGER NOT NULL,
  PRIMARY KEY (source_table, source_id)
) WITHOUT ROWID;
CREATE INDEX learning_kernel_projection_history_scope_idx
  ON learning_kernel_projection_history(
    course_id, revision_id, branch_id, observed_at, id
  );

CREATE TABLE learning_kernel_projections (
  session_id TEXT PRIMARY KEY NOT NULL REFERENCES session_course_contexts(session_id) ON DELETE RESTRICT,
  course_id TEXT NOT NULL,
  revision_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  model_version TEXT NOT NULL CHECK(model_version = 'baseline-1'),
  scheduler_version TEXT NOT NULL CHECK(scheduler_version = 'baseline-1'),
  observed_at INTEGER NOT NULL,
  fact_frontier_hash TEXT NOT NULL CHECK(
    length(fact_frontier_hash) = 71 AND substr(fact_frontier_hash, 1, 7) = 'sha256:'
    AND substr(fact_frontier_hash, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  projection_hash TEXT NOT NULL CHECK(
    length(projection_hash) = 71 AND substr(projection_hash, 1, 7) = 'sha256:'
    AND substr(projection_hash, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  projection_json TEXT NOT NULL CHECK(
    json_valid(projection_json) AND substr(ltrim(projection_json), 1, 1) = '{'
  ),
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (course_id, revision_id)
    REFERENCES course_revisions(course_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (course_id, branch_id)
    REFERENCES adaptation_branches(course_id, id) ON DELETE RESTRICT
);
CREATE INDEX learning_kernel_projections_scope_idx
  ON learning_kernel_projections(course_id, revision_id, branch_id, session_id);

CREATE TABLE approved_core_migration_runs (
  target_schema_sha256 TEXT PRIMARY KEY NOT NULL CHECK(
    length(target_schema_sha256) = 64
    AND target_schema_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  source_schema_sha256 TEXT NOT NULL CHECK(
    length(source_schema_sha256) = 64
    AND source_schema_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  source_logical_sha256 TEXT NOT NULL CHECK(
    length(source_logical_sha256) = 64
    AND source_logical_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  approved_backup_logical_sha256 TEXT NOT NULL CHECK(
    length(approved_backup_logical_sha256) = 64
    AND approved_backup_logical_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  approved_backup_sha256 TEXT NOT NULL CHECK(
    length(approved_backup_sha256) = 64
    AND approved_backup_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  approved_backup_path_hash TEXT NOT NULL CHECK(
    length(approved_backup_path_hash) = 64
    AND approved_backup_path_hash NOT GLOB '*[^0-9a-f]*'
  ),
  completed_at INTEGER NOT NULL,
  CHECK(source_logical_sha256 = approved_backup_logical_sha256)
) WITHOUT ROWID;

CREATE TRIGGER learning_kernel_fact_immutable_update_guard
BEFORE UPDATE ON learning_kernel_facts
BEGIN SELECT RAISE(ABORT, 'Learning Kernel fact is append-only'); END;
CREATE TRIGGER learning_kernel_fact_immutable_delete_guard
BEFORE DELETE ON learning_kernel_facts
BEGIN SELECT RAISE(ABORT, 'Learning Kernel fact is append-only'); END;
CREATE TRIGGER learning_kernel_projection_history_immutable_update_guard
BEFORE UPDATE ON learning_kernel_projection_history
BEGIN SELECT RAISE(ABORT, 'Learning Kernel projection history is immutable'); END;
CREATE TRIGGER learning_kernel_projection_history_immutable_delete_guard
BEFORE DELETE ON learning_kernel_projection_history
BEGIN SELECT RAISE(ABORT, 'Learning Kernel projection history is immutable'); END;
CREATE TRIGGER learning_kernel_quarantine_immutable_update_guard
BEFORE UPDATE ON learning_kernel_migration_quarantine
BEGIN SELECT RAISE(ABORT, 'Learning Kernel quarantine record is immutable'); END;
CREATE TRIGGER learning_kernel_quarantine_immutable_delete_guard
BEFORE DELETE ON learning_kernel_migration_quarantine
BEGIN SELECT RAISE(ABORT, 'Learning Kernel quarantine record is immutable'); END;
CREATE TRIGGER approved_core_migration_run_immutable_update_guard
BEFORE UPDATE ON approved_core_migration_runs
BEGIN SELECT RAISE(ABORT, 'Approved Core migration run is immutable'); END;
CREATE TRIGGER approved_core_migration_run_immutable_delete_guard
BEFORE DELETE ON approved_core_migration_runs
BEGIN SELECT RAISE(ABORT, 'Approved Core migration run is immutable'); END;
