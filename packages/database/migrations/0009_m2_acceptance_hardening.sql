-- Accepted revision metadata is frozen. The sole mutable transition is an
-- atomic published-to-archived status change with its archival timestamps.
DROP TRIGGER course_revisions_accepted_update_guard;
CREATE TRIGGER course_revisions_accepted_update_guard
BEFORE UPDATE ON course_revisions
WHEN OLD.status != 'draft' AND (
  NEW.course_id IS NOT OLD.course_id OR
  NEW.revision_number IS NOT OLD.revision_number OR
  NEW.parent_revision_id IS NOT OLD.parent_revision_id OR
  NEW.branch_kind IS NOT OLD.branch_kind OR
  NEW.title IS NOT OLD.title OR
  NEW.description IS NOT OLD.description OR
  NEW.content_hash IS NOT OLD.content_hash OR
  NEW.based_on_content_hash IS NOT OLD.based_on_content_hash OR
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
BEGIN SELECT RAISE(ABORT, 'accepted course revision is immutable'); END;

-- The legacy-v1 quarantine identity is historical data, not a mutability
-- exception. All published/archived source revisions use the same guard.
DROP TRIGGER curriculum_versions_published_update_guard;
CREATE TRIGGER curriculum_versions_published_update_guard
BEFORE UPDATE ON curriculum_versions
WHEN OLD.status != 'draft' AND (
  NEW.curriculum_id IS NOT OLD.curriculum_id OR
  NEW.revision IS NOT OLD.revision OR
  NEW.parent_version_id IS NOT OLD.parent_version_id OR
  NEW.title IS NOT OLD.title OR
  NEW.description IS NOT OLD.description OR
  NEW.content_hash IS NOT OLD.content_hash OR
  NEW.created_at IS NOT OLD.created_at OR
  NEW.published_at IS NOT OLD.published_at OR
  NOT (
    NEW.status = OLD.status OR
    (OLD.status = 'published' AND NEW.status = 'archived')
  )
)
BEGIN SELECT RAISE(ABORT, 'published curriculum version is immutable'); END;

-- Source lineage must be valid before projection. Otherwise an accepted
-- source row could exist without its target Course Revision projection.
CREATE TRIGGER curriculum_versions_parent_scope_insert_guard
BEFORE INSERT ON curriculum_versions
WHEN NEW.parent_version_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM curriculum_versions parent
  WHERE parent.id = NEW.parent_version_id
    AND parent.curriculum_id = NEW.curriculum_id
)
BEGIN SELECT RAISE(ABORT, 'curriculum version parent scope is invalid'); END;
CREATE TRIGGER curriculum_versions_parent_scope_update_guard
BEFORE UPDATE OF curriculum_id, parent_version_id ON curriculum_versions
WHEN NEW.parent_version_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM curriculum_versions parent
  WHERE parent.id = NEW.parent_version_id
    AND parent.curriculum_id = NEW.curriculum_id
)
BEGIN SELECT RAISE(ABORT, 'curriculum version parent scope is invalid'); END;

-- Fail closed on obvious forged snapshot envelopes before the target context
-- sync trigger can grant Course scope. Canonical byte/hash checks remain in
-- the application-owned snapshot boundary.
DROP TRIGGER session_snapshots_course_context_insert_guard;
CREATE TRIGGER session_snapshots_course_context_insert_guard
BEFORE INSERT ON session_snapshots
WHEN NEW.schema_version != 2
  OR NOT json_valid(NEW.snapshot_json)
  OR CASE WHEN json_valid(NEW.snapshot_json) THEN (
    json_type(NEW.snapshot_json, '$') != 'object'
    OR json_extract(NEW.snapshot_json, '$.schemaVersion') IS NOT NEW.schema_version
    OR json_extract(NEW.snapshot_json, '$.curriculumId') IS NOT NEW.curriculum_id
    OR json_extract(NEW.snapshot_json, '$.curriculumVersionId') IS NOT NEW.curriculum_version_id
    OR json_extract(NEW.snapshot_json, '$.day.id') IS NOT NEW.curriculum_day_id
    OR json_extract(NEW.snapshot_json, '$.contentHash') IS NOT NEW.content_hash
  ) ELSE 1 END
  OR NEW.curriculum_id IS NULL
  OR NEW.curriculum_version_id IS NULL
  OR NEW.curriculum_day_id IS NULL
  OR NOT EXISTS (
    SELECT 1 FROM learning_sessions session
    WHERE session.id = NEW.session_id
      AND session.curriculum_day_v2_id = NEW.curriculum_day_id
  )
  OR NOT EXISTS (
    SELECT 1 FROM curriculum_versions revision
    WHERE revision.id = NEW.curriculum_version_id
      AND revision.curriculum_id = NEW.curriculum_id
      AND revision.revision = json_extract(
        NEW.snapshot_json,
        '$.curriculumRevision'
      )
  )
  OR NOT EXISTS (
    SELECT 1 FROM course_lessons lesson
    WHERE lesson.course_id = NEW.curriculum_id
      AND lesson.revision_id = NEW.curriculum_version_id
      AND lesson.id = NEW.curriculum_day_id
  )
BEGIN SELECT RAISE(ABORT, 'session snapshot course scope is invalid'); END;

-- Harden accepted Course descendants against draft-to-accepted scope moves.
-- Insert and delete behavior remains owned by the existing guards.
DROP TRIGGER course_sections_accepted_update_guard;
CREATE TRIGGER course_sections_accepted_update_guard
BEFORE UPDATE ON course_sections
WHEN EXISTS (
  SELECT 1 FROM course_revisions revision
  WHERE revision.course_id = OLD.course_id
    AND revision.id = OLD.revision_id
    AND revision.status != 'draft'
) OR EXISTS (
  SELECT 1 FROM course_revisions revision
  WHERE revision.course_id = NEW.course_id
    AND revision.id = NEW.revision_id
    AND revision.status != 'draft'
)
BEGIN SELECT RAISE(ABORT, 'accepted course revision descendants are immutable'); END;

DROP TRIGGER course_lessons_accepted_update_guard;
CREATE TRIGGER course_lessons_accepted_update_guard
BEFORE UPDATE ON course_lessons
WHEN EXISTS (
  SELECT 1 FROM course_revisions revision
  WHERE revision.course_id = OLD.course_id
    AND revision.id = OLD.revision_id
    AND revision.status != 'draft'
) OR EXISTS (
  SELECT 1 FROM course_revisions revision
  WHERE revision.course_id = NEW.course_id
    AND revision.id = NEW.revision_id
    AND revision.status != 'draft'
)
BEGIN SELECT RAISE(ABORT, 'accepted course revision descendants are immutable'); END;

DROP TRIGGER course_lesson_prerequisites_accepted_update_guard;
CREATE TRIGGER course_lesson_prerequisites_accepted_update_guard
BEFORE UPDATE ON course_lesson_prerequisites
WHEN EXISTS (
  SELECT 1 FROM course_revisions revision
  WHERE revision.course_id = OLD.course_id
    AND revision.id = OLD.revision_id
    AND revision.status != 'draft'
) OR EXISTS (
  SELECT 1 FROM course_revisions revision
  WHERE revision.course_id = NEW.course_id
    AND revision.id = NEW.revision_id
    AND revision.status != 'draft'
)
BEGIN SELECT RAISE(ABORT, 'accepted course revision descendants are immutable'); END;

DROP TRIGGER course_activities_accepted_update_guard;
CREATE TRIGGER course_activities_accepted_update_guard
BEFORE UPDATE ON course_activities
WHEN EXISTS (
  SELECT 1 FROM course_revisions revision
  WHERE revision.course_id = OLD.course_id
    AND revision.id = OLD.revision_id
    AND revision.status != 'draft'
) OR EXISTS (
  SELECT 1 FROM course_revisions revision
  WHERE revision.course_id = NEW.course_id
    AND revision.id = NEW.revision_id
    AND revision.status != 'draft'
)
BEGIN SELECT RAISE(ABORT, 'accepted course revision descendants are immutable'); END;

DROP TRIGGER course_activity_prerequisites_accepted_update_guard;
CREATE TRIGGER course_activity_prerequisites_accepted_update_guard
BEFORE UPDATE ON course_activity_prerequisites
WHEN EXISTS (
  SELECT 1 FROM course_revisions revision
  WHERE revision.course_id = OLD.course_id
    AND revision.id = OLD.revision_id
    AND revision.status != 'draft'
) OR EXISTS (
  SELECT 1 FROM course_revisions revision
  WHERE revision.course_id = NEW.course_id
    AND revision.id = NEW.revision_id
    AND revision.status != 'draft'
)
BEGIN SELECT RAISE(ABORT, 'accepted course revision descendants are immutable'); END;

-- Legacy source rows retain their existing insert/delete semantics, but an
-- UPDATE cannot use a draft source to enter a published or archived revision.
DROP TRIGGER curriculum_weeks_published_update_guard;
CREATE TRIGGER curriculum_weeks_published_update_guard
BEFORE UPDATE ON curriculum_weeks
WHEN EXISTS (
  SELECT 1 FROM curriculum_versions version
  WHERE version.id = OLD.version_id AND version.status != 'draft'
) OR EXISTS (
  SELECT 1 FROM curriculum_versions version
  WHERE version.id = NEW.version_id AND version.status != 'draft'
)
BEGIN SELECT RAISE(ABORT, 'published curriculum version is immutable'); END;

DROP TRIGGER curriculum_days_v2_published_update_guard;
CREATE TRIGGER curriculum_days_v2_published_update_guard
BEFORE UPDATE ON curriculum_days_v2
WHEN EXISTS (
  SELECT 1 FROM curriculum_versions version
  WHERE version.id = OLD.version_id AND version.status != 'draft'
) OR EXISTS (
  SELECT 1 FROM curriculum_versions version
  WHERE version.id = NEW.version_id AND version.status != 'draft'
)
BEGIN SELECT RAISE(ABORT, 'published curriculum version is immutable'); END;

DROP TRIGGER curriculum_units_published_update_guard;
CREATE TRIGGER curriculum_units_published_update_guard
BEFORE UPDATE ON curriculum_units
WHEN EXISTS (
  SELECT 1 FROM curriculum_versions version
  WHERE version.id = OLD.version_id AND version.status != 'draft'
) OR EXISTS (
  SELECT 1 FROM curriculum_versions version
  WHERE version.id = NEW.version_id AND version.status != 'draft'
)
BEGIN SELECT RAISE(ABORT, 'published curriculum version is immutable'); END;
