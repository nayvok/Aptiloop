-- M3 adds immutable declarative Course Pack records beside the M2 Course graph.
-- Pack bytes are validated before this schema is touched; invalid raw content is
-- never retained. Quarantine stores only a bounded diagnostic and source hash.

CREATE TABLE course_pack_manifests (
  revision_id TEXT PRIMARY KEY NOT NULL
    REFERENCES course_revisions(id) ON DELETE RESTRICT,
  format_version INTEGER NOT NULL CHECK(format_version = 1),
  canonical_json TEXT NOT NULL
    CHECK(json_valid(canonical_json) AND substr(ltrim(canonical_json), 1, 1) = '{'),
  content_hash TEXT NOT NULL UNIQUE
    CHECK(length(content_hash) = 71 AND substr(content_hash, 1, 7) = 'sha256:'
      AND substr(content_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  source_bytes_hash TEXT NOT NULL
    CHECK(length(source_bytes_hash) = 71 AND substr(source_bytes_hash, 1, 7) = 'sha256:'
      AND substr(source_bytes_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  validation_report_json TEXT NOT NULL
    CHECK(json_valid(validation_report_json) AND substr(ltrim(validation_report_json), 1, 1) = '{'),
  validator_version TEXT NOT NULL CHECK(length(trim(validator_version)) BETWEEN 1 AND 64),
  imported_at INTEGER NOT NULL
);

CREATE TABLE course_pack_localizations (
  revision_id TEXT NOT NULL
    REFERENCES course_pack_manifests(revision_id) ON DELETE RESTRICT,
  locale TEXT NOT NULL CHECK(length(trim(locale)) BETWEEN 2 AND 35),
  release_complete INTEGER NOT NULL CHECK(release_complete IN (0, 1)),
  fields_json TEXT NOT NULL
    CHECK(json_valid(fields_json) AND substr(ltrim(fields_json), 1, 1) = '{'),
  PRIMARY KEY (revision_id, locale)
) WITHOUT ROWID;

CREATE TABLE course_pack_knowledge_nodes (
  revision_id TEXT NOT NULL
    REFERENCES course_pack_manifests(revision_id) ON DELETE RESTRICT,
  knowledge_node_id TEXT NOT NULL CHECK(length(trim(knowledge_node_id)) BETWEEN 1 AND 200),
  title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 500),
  description TEXT NOT NULL CHECK(length(trim(description)) BETWEEN 1 AND 50000),
  kind TEXT NOT NULL CHECK(kind IN ('concept', 'procedure', 'skill', 'misconception-family')),
  prerequisite_ids_json TEXT NOT NULL
    CHECK(json_valid(prerequisite_ids_json) AND substr(ltrim(prerequisite_ids_json), 1, 1) = '['),
  related_ids_json TEXT NOT NULL
    CHECK(json_valid(related_ids_json) AND substr(ltrim(related_ids_json), 1, 1) = '['),
  lifecycle TEXT NOT NULL CHECK(lifecycle IN ('active', 'superseded')),
  PRIMARY KEY (revision_id, knowledge_node_id)
) WITHOUT ROWID;

CREATE TABLE course_pack_lifecycle_events (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(trim(id)) BETWEEN 1 AND 200),
  revision_id TEXT NOT NULL
    REFERENCES course_pack_manifests(revision_id) ON DELETE RESTRICT,
  operation_id TEXT NOT NULL UNIQUE CHECK(length(trim(operation_id)) BETWEEN 1 AND 200),
  action TEXT NOT NULL CHECK(action IN ('install', 'open-as-draft', 'uninstall')),
  occurred_at INTEGER NOT NULL,
  details_json TEXT NOT NULL
    CHECK(json_valid(details_json) AND substr(ltrim(details_json), 1, 1) = '{')
);
CREATE INDEX course_pack_lifecycle_revision_time_idx
  ON course_pack_lifecycle_events(revision_id, occurred_at, id);

CREATE TABLE course_pack_quarantine (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(trim(id)) BETWEEN 1 AND 200),
  source_bytes_hash TEXT NOT NULL,
  validator_version TEXT NOT NULL CHECK(length(trim(validator_version)) BETWEEN 1 AND 64),
  report_json TEXT NOT NULL
    CHECK(json_valid(report_json) AND substr(ltrim(report_json), 1, 1) = '{'),
  created_at INTEGER NOT NULL,
  UNIQUE(source_bytes_hash, validator_version)
);

CREATE TRIGGER course_pack_manifests_immutable_update_guard
BEFORE UPDATE ON course_pack_manifests
BEGIN SELECT RAISE(ABORT, 'Course Pack manifest is immutable'); END;
CREATE TRIGGER course_pack_manifests_immutable_delete_guard
BEFORE DELETE ON course_pack_manifests
BEGIN SELECT RAISE(ABORT, 'Course Pack manifest is immutable'); END;
CREATE TRIGGER course_pack_localizations_immutable_update_guard
BEFORE UPDATE ON course_pack_localizations
BEGIN SELECT RAISE(ABORT, 'Course Pack localization is immutable'); END;
CREATE TRIGGER course_pack_localizations_immutable_delete_guard
BEFORE DELETE ON course_pack_localizations
BEGIN SELECT RAISE(ABORT, 'Course Pack localization is immutable'); END;
CREATE TRIGGER course_pack_knowledge_nodes_immutable_update_guard
BEFORE UPDATE ON course_pack_knowledge_nodes
BEGIN SELECT RAISE(ABORT, 'Course Pack knowledge node is immutable'); END;
CREATE TRIGGER course_pack_knowledge_nodes_immutable_delete_guard
BEFORE DELETE ON course_pack_knowledge_nodes
BEGIN SELECT RAISE(ABORT, 'Course Pack knowledge node is immutable'); END;
CREATE TRIGGER course_pack_lifecycle_events_append_only_update_guard
BEFORE UPDATE ON course_pack_lifecycle_events
BEGIN SELECT RAISE(ABORT, 'Course Pack lifecycle event is append-only'); END;
CREATE TRIGGER course_pack_lifecycle_events_append_only_delete_guard
BEFORE DELETE ON course_pack_lifecycle_events
BEGIN SELECT RAISE(ABORT, 'Course Pack lifecycle event is append-only'); END;
CREATE TRIGGER course_pack_quarantine_immutable_update_guard
BEFORE UPDATE ON course_pack_quarantine
BEGIN SELECT RAISE(ABORT, 'Course Pack quarantine record is immutable'); END;
CREATE TRIGGER course_pack_quarantine_immutable_delete_guard
BEFORE DELETE ON course_pack_quarantine
BEGIN SELECT RAISE(ABORT, 'Course Pack quarantine record is immutable'); END;

-- Every current published Course gets one local personal branch so M4 facts
-- have an explicit learner-owned scope. Imported packs create the same branch
-- transactionally in the Course Pack repository.
INSERT INTO adaptation_branches
  (id, course_id, owner, base_revision_id, head_revision_id, status,
   created_at, updated_at)
SELECT course.id, course.id, 'local', course.active_revision_id, NULL,
       'active', course.updated_at, course.updated_at
FROM courses course
WHERE course.active_revision_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM course_revisions revision
    WHERE revision.course_id = course.id
      AND revision.id = course.active_revision_id
      AND revision.branch_kind = 'upstream'
      AND revision.status = 'published'
  )
  AND NOT EXISTS (
    SELECT 1 FROM adaptation_branches branch
    WHERE branch.course_id = course.id AND branch.status = 'active'
  );

CREATE TRIGGER courses_personal_branch_insert_projection
AFTER INSERT ON courses
WHEN NEW.active_revision_id IS NOT NULL
 AND EXISTS (
   SELECT 1 FROM course_revisions revision
   WHERE revision.course_id = NEW.id AND revision.id = NEW.active_revision_id
     AND revision.branch_kind = 'upstream' AND revision.status = 'published'
 )
 AND NOT EXISTS (
   SELECT 1 FROM adaptation_branches branch
   WHERE branch.course_id = NEW.id AND branch.status = 'active'
 )
BEGIN
  INSERT INTO adaptation_branches
    (id, course_id, owner, base_revision_id, head_revision_id, status,
     created_at, updated_at)
  VALUES (NEW.id, NEW.id, 'local', NEW.active_revision_id, NULL, 'active',
          NEW.updated_at, NEW.updated_at);
END;

CREATE TRIGGER courses_personal_branch_update_projection
AFTER UPDATE OF active_revision_id ON courses
WHEN NEW.active_revision_id IS NOT NULL
 AND EXISTS (
   SELECT 1 FROM course_revisions revision
   WHERE revision.course_id = NEW.id AND revision.id = NEW.active_revision_id
     AND revision.branch_kind = 'upstream' AND revision.status = 'published'
 )
 AND NOT EXISTS (
   SELECT 1 FROM adaptation_branches branch
   WHERE branch.course_id = NEW.id AND branch.status = 'active'
 )
BEGIN
  INSERT INTO adaptation_branches
    (id, course_id, owner, base_revision_id, head_revision_id, status,
     created_at, updated_at)
  VALUES (NEW.id, NEW.id, 'local', NEW.active_revision_id, NULL, 'active',
          NEW.updated_at, NEW.updated_at);
END;
