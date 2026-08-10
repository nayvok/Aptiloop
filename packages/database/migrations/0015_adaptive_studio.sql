PRAGMA foreign_keys = ON;

ALTER TABLE curriculum_versions
  ADD COLUMN branch_kind TEXT NOT NULL DEFAULT 'upstream'
  CHECK (branch_kind IN ('upstream', 'personal'));
ALTER TABLE curriculum_versions
  ADD COLUMN based_on_content_hash TEXT;
ALTER TABLE curriculum_versions
  ADD COLUMN adaptation_branch_id TEXT;

DROP TRIGGER curriculum_versions_course_revision_insert_projection;
DROP TRIGGER curriculum_versions_course_revision_update_projection;

CREATE TRIGGER curriculum_versions_course_revision_insert_projection
AFTER INSERT ON curriculum_versions
BEGIN
  INSERT INTO course_revisions
    (id, course_id, revision_number, parent_revision_id, branch_kind, status,
     title, description, content_hash, based_on_content_hash, created_at,
     published_at, archived_at, updated_at)
  SELECT NEW.id, NEW.curriculum_id, NEW.revision, NEW.parent_version_id,
         NEW.branch_kind, NEW.status, NEW.title, NEW.description,
         NEW.content_hash, NEW.based_on_content_hash, NEW.created_at,
         NEW.published_at, NEW.archived_at, NEW.updated_at
  WHERE NEW.parent_version_id IS NULL OR EXISTS (
    SELECT 1 FROM course_revisions parent
    WHERE parent.course_id = NEW.curriculum_id
      AND parent.id = NEW.parent_version_id
  );
END;

CREATE TRIGGER curriculum_versions_course_revision_update_projection
AFTER UPDATE ON curriculum_versions
BEGIN
  UPDATE course_revisions
  SET revision_number = NEW.revision,
      parent_revision_id = NEW.parent_version_id,
      branch_kind = NEW.branch_kind,
      status = NEW.status,
      title = NEW.title,
      description = NEW.description,
      content_hash = NEW.content_hash,
      based_on_content_hash = NEW.based_on_content_hash,
      published_at = NEW.published_at,
      archived_at = NEW.archived_at,
      updated_at = NEW.updated_at
  WHERE course_id = NEW.curriculum_id AND id = NEW.id;
END;

DROP TRIGGER curriculum_versions_published_update_guard;
CREATE TRIGGER curriculum_versions_published_update_guard
BEFORE UPDATE ON curriculum_versions
WHEN OLD.status != 'draft' AND (
  NEW.curriculum_id IS NOT OLD.curriculum_id OR
  NEW.revision IS NOT OLD.revision OR
  NEW.parent_version_id IS NOT OLD.parent_version_id OR
  NEW.branch_kind IS NOT OLD.branch_kind OR
  NEW.based_on_content_hash IS NOT OLD.based_on_content_hash OR
  NEW.adaptation_branch_id IS NOT OLD.adaptation_branch_id OR
  NEW.title IS NOT OLD.title OR
  NEW.description IS NOT OLD.description OR
  NEW.content_hash IS NOT OLD.content_hash OR
  NEW.created_at IS NOT OLD.created_at OR
  NEW.published_at IS NOT OLD.published_at OR
  (NEW.status = OLD.status AND (
    NEW.archived_at IS NOT OLD.archived_at OR
    NEW.updated_at IS NOT OLD.updated_at
  )) OR
  NOT (
    NEW.status = OLD.status OR
    (OLD.status = 'published' AND NEW.status = 'archived')
  )
)
BEGIN SELECT RAISE(ABORT, 'published curriculum version is immutable'); END;

CREATE INDEX curriculum_versions_branch_status_idx
  ON curriculum_versions(curriculum_id, branch_kind, status, revision DESC);

CREATE TABLE adaptation_authoring_operations (
  operation_id TEXT PRIMARY KEY NOT NULL,
  course_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('create-branch', 'integrate-upstream')),
  strategy TEXT CHECK (strategy IS NULL OR strategy IN ('use-upstream', 'keep-personal')),
  result_version_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE RESTRICT,
  FOREIGN KEY (result_version_id) REFERENCES curriculum_versions(id) ON DELETE RESTRICT
);

CREATE INDEX adaptation_authoring_operations_course_idx
  ON adaptation_authoring_operations(course_id, created_at DESC, operation_id);

CREATE TABLE IF NOT EXISTS course_draft_proposals (
  id TEXT PRIMARY KEY NOT NULL,
  version_id TEXT NOT NULL,
  base_draft_hash TEXT NOT NULL CHECK (base_draft_hash GLOB 'sha256:[0-9a-f]*' AND length(base_draft_hash) = 71),
  prompt TEXT NOT NULL,
  proposal_json TEXT NOT NULL CHECK (json_valid(proposal_json)),
  authoring_operation_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('proposed', 'applied', 'rejected')),
  provider_operation_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  reviewed_at INTEGER,
  FOREIGN KEY (version_id) REFERENCES curriculum_versions(id) ON DELETE RESTRICT,
  UNIQUE (version_id, provider_operation_id),
  UNIQUE (version_id, authoring_operation_id)
);
CREATE INDEX IF NOT EXISTS course_draft_proposals_version_status_idx
  ON course_draft_proposals(version_id, status, created_at DESC, id);

CREATE TRIGGER IF NOT EXISTS course_draft_proposals_immutable_after_review
BEFORE UPDATE ON course_draft_proposals
WHEN OLD.status != 'proposed'
BEGIN
  SELECT RAISE(ABORT, 'Reviewed Course draft proposals are immutable');
END;

CREATE TRIGGER IF NOT EXISTS course_draft_proposals_payload_immutable
BEFORE UPDATE ON course_draft_proposals
WHEN NEW.version_id != OLD.version_id
  OR NEW.base_draft_hash != OLD.base_draft_hash
  OR NEW.prompt != OLD.prompt
  OR NEW.proposal_json != OLD.proposal_json
  OR NEW.authoring_operation_id != OLD.authoring_operation_id
  OR NEW.provider_operation_id != OLD.provider_operation_id
  OR NEW.created_at != OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'Course draft proposal payload is immutable');
END;
