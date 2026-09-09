-- Permit the versioned Learning Kernel fact envelope to carry v1 legacy facts
-- and v2 migration-lineage facts without changing any existing row or index.
ALTER TABLE learning_kernel_facts RENAME TO learning_kernel_facts_v1;

CREATE TABLE learning_kernel_facts (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(trim(id)) BETWEEN 1 AND 500),
  schema_version INTEGER NOT NULL CHECK(schema_version IN (1, 2)),
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

INSERT INTO learning_kernel_facts (
  id, schema_version, operation_id, course_id, revision_id, branch_id,
  session_id, lesson_id, activity_id, body_type, provenance_kind,
  supersedes_fact_id, occurred_at, accepted_at, canonical_json, fact_hash
)
SELECT
  id, schema_version, operation_id, course_id, revision_id, branch_id,
  session_id, lesson_id, activity_id, body_type, provenance_kind,
  supersedes_fact_id, occurred_at, accepted_at, canonical_json, fact_hash
FROM learning_kernel_facts_v1;

DROP TRIGGER learning_kernel_fact_immutable_update_guard;
DROP TRIGGER learning_kernel_fact_immutable_delete_guard;
DROP INDEX learning_kernel_facts_replay_idx;
DROP INDEX learning_kernel_facts_scope_idx;
DROP TABLE learning_kernel_facts_v1;

CREATE INDEX learning_kernel_facts_replay_idx
  ON learning_kernel_facts(session_id, occurred_at, id);
CREATE INDEX learning_kernel_facts_scope_idx
  ON learning_kernel_facts(course_id, revision_id, branch_id, activity_id, occurred_at, id);

CREATE TRIGGER learning_kernel_fact_immutable_update_guard
BEFORE UPDATE ON learning_kernel_facts
BEGIN SELECT RAISE(ABORT, 'Learning Kernel fact is append-only'); END;
CREATE TRIGGER learning_kernel_fact_immutable_delete_guard
BEFORE DELETE ON learning_kernel_facts
BEGIN SELECT RAISE(ABORT, 'Learning Kernel fact is append-only'); END;

-- Persist the owner-approved Learning Design stage without losing populated
-- workflow rows. This table rebuild is performed with foreign-key checks
-- temporarily disabled by the migration runner; all child references retain
-- the same table name after the final rename.
CREATE TABLE course_designer_workflows_v2 (
  id TEXT PRIMARY KEY NOT NULL,
  version_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN (
    'DRAFT_REQUEST', 'DISCOVERY', 'DIAGNOSTIC', 'LEARNING_DESIGN',
    'CURRICULUM_PROPOSAL', 'USER_REVIEW', 'COMPILATION', 'VALIDATION',
    'PUBLISHED', 'FAILED'
  )),
  recovery_state TEXT CHECK (recovery_state IS NULL OR recovery_state IN (
    'DRAFT_REQUEST', 'DISCOVERY', 'DIAGNOSTIC', 'LEARNING_DESIGN',
    'CURRICULUM_PROPOSAL', 'USER_REVIEW', 'COMPILATION', 'VALIDATION',
    'PUBLISHED'
  )),
  request_json TEXT NOT NULL CHECK(json_valid(request_json)),
  diagnostic_json TEXT NOT NULL CHECK(json_valid(diagnostic_json)),
  learning_design_json TEXT NOT NULL CHECK(json_valid(learning_design_json)),
  revision_requests_json TEXT NOT NULL CHECK(json_valid(revision_requests_json)),
  active_proposal_id TEXT,
  authoring_operation_id TEXT NOT NULL,
  failure_code TEXT,
  failure_message TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (version_id) REFERENCES curriculum_versions(id) ON DELETE RESTRICT,
  UNIQUE (version_id, authoring_operation_id)
);

INSERT INTO course_designer_workflows_v2 (
  id, version_id, state, recovery_state, request_json, diagnostic_json,
  learning_design_json, revision_requests_json, active_proposal_id,
  authoring_operation_id, failure_code, failure_message, created_at, updated_at
)
SELECT
  id, version_id, state, recovery_state, request_json, diagnostic_json,
  'null',
  revision_requests_json, active_proposal_id, authoring_operation_id,
  failure_code, failure_message, created_at, updated_at
FROM course_designer_workflows;

DROP TRIGGER course_designer_workflows_request_immutable;
DROP TRIGGER course_designer_workflows_published_immutable;
DROP INDEX course_designer_workflows_version_updated_idx;
DROP TABLE course_designer_workflows;
ALTER TABLE course_designer_workflows_v2 RENAME TO course_designer_workflows;

CREATE INDEX course_designer_workflows_version_updated_idx
  ON course_designer_workflows(version_id, updated_at DESC, id);

CREATE TRIGGER course_designer_workflows_request_immutable
BEFORE UPDATE ON course_designer_workflows
WHEN NEW.version_id != OLD.version_id
  OR NEW.request_json != OLD.request_json
  OR NEW.authoring_operation_id != OLD.authoring_operation_id
  OR NEW.created_at != OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'Course Designer workflow request is immutable');
END;

CREATE TRIGGER course_designer_workflows_published_immutable
BEFORE UPDATE ON course_designer_workflows
WHEN OLD.state = 'PUBLISHED'
BEGIN
  SELECT RAISE(ABORT, 'Published Course Designer workflows are immutable');
END;
