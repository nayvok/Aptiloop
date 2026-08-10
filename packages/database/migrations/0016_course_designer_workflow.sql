PRAGMA foreign_keys = ON;

UPDATE provider_hub_role_profiles
SET tool_policy_id = 'apt.role.course-designer.v2', updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE role = 'course-designer';

CREATE TABLE course_designer_workflows (
  id TEXT PRIMARY KEY NOT NULL,
  version_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN (
    'DRAFT_REQUEST', 'DISCOVERY', 'DIAGNOSTIC', 'CURRICULUM_PROPOSAL',
    'USER_REVIEW', 'COMPILATION', 'VALIDATION', 'PUBLISHED', 'FAILED'
  )),
  recovery_state TEXT CHECK (recovery_state IS NULL OR recovery_state IN (
    'DRAFT_REQUEST', 'DISCOVERY', 'DIAGNOSTIC', 'CURRICULUM_PROPOSAL',
    'USER_REVIEW', 'COMPILATION', 'VALIDATION', 'PUBLISHED'
  )),
  request_json TEXT NOT NULL CHECK (json_valid(request_json)),
  diagnostic_json TEXT NOT NULL CHECK (json_valid(diagnostic_json)),
  revision_requests_json TEXT NOT NULL CHECK (json_valid(revision_requests_json)),
  active_proposal_id TEXT,
  authoring_operation_id TEXT NOT NULL,
  failure_code TEXT,
  failure_message TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (version_id) REFERENCES curriculum_versions(id) ON DELETE RESTRICT,
  UNIQUE (version_id, authoring_operation_id)
);

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

CREATE TABLE course_designer_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workflow_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  from_state TEXT,
  to_state TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  created_at INTEGER NOT NULL,
  FOREIGN KEY (workflow_id) REFERENCES course_designer_workflows(id) ON DELETE RESTRICT,
  UNIQUE (workflow_id, operation_id)
);

CREATE INDEX course_designer_events_workflow_idx
  ON course_designer_events(workflow_id, id);

CREATE TRIGGER course_designer_events_immutable_update
BEFORE UPDATE ON course_designer_events
BEGIN
  SELECT RAISE(ABORT, 'Course Designer events are immutable');
END;

CREATE TRIGGER course_designer_events_immutable_delete
BEFORE DELETE ON course_designer_events
BEGIN
  SELECT RAISE(ABORT, 'Course Designer events are immutable');
END;

CREATE TABLE course_draft_proposal_attribution (
  proposal_id TEXT PRIMARY KEY NOT NULL,
  workflow_id TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  provider_type TEXT NOT NULL,
  model_id TEXT NOT NULL,
  prompt_template_id TEXT NOT NULL,
  prompt_template_version TEXT NOT NULL,
  disclosure_operation_id TEXT,
  diff_json TEXT NOT NULL CHECK (json_valid(diff_json)),
  provenance_json TEXT NOT NULL CHECK (json_valid(provenance_json)),
  validation_json TEXT NOT NULL CHECK (json_valid(validation_json)),
  created_at INTEGER NOT NULL,
  FOREIGN KEY (proposal_id) REFERENCES course_draft_proposals(id) ON DELETE RESTRICT,
  FOREIGN KEY (workflow_id) REFERENCES course_designer_workflows(id) ON DELETE RESTRICT
);

CREATE INDEX course_draft_proposal_attribution_workflow_idx
  ON course_draft_proposal_attribution(workflow_id, created_at DESC, proposal_id);

CREATE TRIGGER course_draft_proposal_attribution_immutable_update
BEFORE UPDATE ON course_draft_proposal_attribution
BEGIN
  SELECT RAISE(ABORT, 'Course proposal attribution is immutable');
END;

CREATE TRIGGER course_draft_proposal_attribution_immutable_delete
BEFORE DELETE ON course_draft_proposal_attribution
BEGIN
  SELECT RAISE(ABORT, 'Course proposal attribution is immutable');
END;
