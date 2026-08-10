-- M2 acceptance corrections are additive to the applied 0006/0007 history.
-- This migration preserves upstream revision lineage and closes compatibility
-- authority to exact historical snapshots that carry immutable m2-v1
-- quarantine provenance.

-- Normalize the admitted M1 repair schema and clean installs to one exact,
-- fail-closed contract before applying the Course corrections below.
DROP INDEX IF EXISTS unit_progress_session_order_idx;
CREATE TABLE unit_progress_m2_contract (
  id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL REFERENCES learning_sessions(id) ON DELETE CASCADE,
  unit_id TEXT NOT NULL,
  unit_type TEXT NOT NULL CHECK(unit_type IN (
    'briefing', 'study', 'recall', 'teacher-dialogue', 'quiz', 'code-reading',
    'exercise', 'review', 'interview', 'summary', 'checkpoint', 'spaced-review'
  )),
  status TEXT NOT NULL CHECK(status IN ('locked', 'ready', 'in_progress', 'completed', 'skipped')),
  progress_json TEXT NOT NULL DEFAULT '{}',
  started_at INTEGER,
  completed_at INTEGER,
  skipped_at INTEGER,
  updated_at INTEGER NOT NULL,
  UNIQUE(session_id, unit_id)
);
INSERT INTO unit_progress_m2_contract
  (id, session_id, unit_id, unit_type, status, progress_json, started_at,
   completed_at, skipped_at, updated_at)
SELECT id, session_id, unit_id, unit_type, status, progress_json, started_at,
       completed_at, skipped_at, updated_at
FROM unit_progress;
DROP TABLE unit_progress;
ALTER TABLE unit_progress_m2_contract RENAME TO unit_progress;
CREATE INDEX unit_progress_session_order_idx
  ON unit_progress(session_id, updated_at);

-- M1 admits one active Course session plus quarantined legacy history.
DROP INDEX IF EXISTS learning_sessions_one_global_active_uq;

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

DROP TRIGGER course_revisions_accepted_update_guard;
DROP TRIGGER course_revisions_accepted_delete_guard;
DROP TRIGGER curriculum_versions_course_revision_insert_projection;
DROP TRIGGER curriculum_versions_course_revision_update_projection;
DROP TRIGGER curricula_course_update_projection;
DROP TRIGGER curriculum_weeks_course_section_insert_projection;
DROP TRIGGER curriculum_days_v2_course_lesson_insert_projection;
DROP TRIGGER curriculum_units_course_activity_insert_projection;
DROP TRIGGER session_snapshots_course_context_insert_guard;
DROP TRIGGER session_snapshots_course_context_insert_sync;
DROP TRIGGER versioned_unit_evidence_course_scope_insert_guard;
DROP TRIGGER versioned_unit_evidence_course_scope_insert_sync;

PRAGMA legacy_alter_table = ON;
ALTER TABLE course_revisions RENAME TO course_revisions_m2_previous;

CREATE TABLE course_revisions (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(trim(id)) BETWEEN 1 AND 200),
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
  revision_number INTEGER NOT NULL CHECK(revision_number > 0),
  parent_revision_id TEXT,
  branch_kind TEXT NOT NULL CHECK(branch_kind IN ('upstream', 'personal')),
  status TEXT NOT NULL CHECK(status IN ('draft', 'published', 'archived')),
  title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 500),
  description TEXT CHECK(description IS NULL OR length(description) <= 50000),
  content_hash TEXT CHECK(content_hash IS NULL OR ((length(content_hash) = 64 AND content_hash NOT GLOB '*[^0-9a-f]*') OR (length(content_hash) = 71 AND substr(content_hash, 1, 7) = 'sha256:' AND substr(content_hash, 8) NOT GLOB '*[^0-9a-f]*'))),
  based_on_content_hash TEXT CHECK(based_on_content_hash IS NULL OR ((length(based_on_content_hash) = 64 AND based_on_content_hash NOT GLOB '*[^0-9a-f]*') OR (length(based_on_content_hash) = 71 AND substr(based_on_content_hash, 1, 7) = 'sha256:' AND substr(based_on_content_hash, 8) NOT GLOB '*[^0-9a-f]*'))),
  created_at INTEGER NOT NULL,
  published_at INTEGER,
  archived_at INTEGER,
  updated_at INTEGER NOT NULL,
  UNIQUE(course_id, id),
  UNIQUE(course_id, revision_number),
  FOREIGN KEY (course_id, parent_revision_id)
    REFERENCES course_revisions(course_id, id)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  CHECK(parent_revision_id IS NULL OR parent_revision_id != id),
  CHECK(revision_number = 1 OR parent_revision_id IS NOT NULL),
  CHECK(
    (branch_kind = 'upstream' AND based_on_content_hash IS NULL) OR
    (branch_kind = 'personal' AND parent_revision_id IS NOT NULL AND based_on_content_hash IS NOT NULL)
  ),
  CHECK(
    (status = 'draft' AND content_hash IS NULL AND published_at IS NULL) OR
    (status IN ('published', 'archived') AND content_hash IS NOT NULL AND published_at IS NOT NULL)
  ),
  CHECK(updated_at >= created_at),
  CHECK(published_at IS NULL OR published_at >= created_at),
  CHECK(archived_at IS NULL OR (published_at IS NOT NULL AND archived_at >= published_at))
);

INSERT INTO course_revisions
  (id, course_id, revision_number, parent_revision_id, branch_kind, status,
   title, description, content_hash, based_on_content_hash, created_at,
   published_at, archived_at, updated_at)
SELECT revision.id, revision.course_id, revision.revision_number,
       CASE
         WHEN source.parent_version_id IS NOT NULL
          AND parent.id IS NOT NULL
          AND parent.course_id = revision.course_id
         THEN source.parent_version_id
         ELSE revision.parent_revision_id
       END,
       revision.branch_kind, revision.status, revision.title,
       revision.description, revision.content_hash,
       revision.based_on_content_hash, revision.created_at,
       revision.published_at, revision.archived_at, revision.updated_at
FROM course_revisions_m2_previous revision
LEFT JOIN curriculum_versions source ON source.id = revision.id
LEFT JOIN course_revisions_m2_previous parent
  ON parent.id = source.parent_version_id;

DROP TABLE course_revisions_m2_previous;
PRAGMA legacy_alter_table = OFF;
CREATE INDEX course_revisions_status_idx
  ON course_revisions(course_id, status, revision_number, id);

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
  NOT (NEW.status = OLD.status OR (OLD.status = 'published' AND NEW.status = 'archived'))
)
BEGIN SELECT RAISE(ABORT, 'accepted course revision is immutable'); END;
CREATE TRIGGER course_revisions_accepted_delete_guard
BEFORE DELETE ON course_revisions WHEN OLD.status != 'draft'
BEGIN SELECT RAISE(ABORT, 'accepted course revision is immutable'); END;

CREATE TRIGGER curricula_course_update_projection
AFTER UPDATE OF title, description, active_version_id, updated_at ON curricula
BEGIN
  UPDATE courses
  SET title = NEW.title,
      description = NEW.description,
      active_revision_id = (
        SELECT revision.id FROM course_revisions revision
        WHERE revision.course_id = NEW.id
          AND revision.id = NEW.active_version_id
      ),
      updated_at = NEW.updated_at
  WHERE id = NEW.id;
END;

CREATE TRIGGER curriculum_versions_course_revision_insert_projection
AFTER INSERT ON curriculum_versions
BEGIN
  INSERT INTO course_revisions
    (id, course_id, revision_number, parent_revision_id, branch_kind, status,
     title, description, content_hash, based_on_content_hash, created_at,
     published_at, archived_at, updated_at)
  SELECT NEW.id, NEW.curriculum_id, NEW.revision, NEW.parent_version_id,
         'upstream', NEW.status, NEW.title, NEW.description, NEW.content_hash,
         NULL, NEW.created_at, NEW.published_at, NEW.archived_at, NEW.updated_at
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
      status = NEW.status,
      title = NEW.title,
      description = NEW.description,
      content_hash = NEW.content_hash,
      published_at = NEW.published_at,
      archived_at = NEW.archived_at,
      updated_at = NEW.updated_at
  WHERE course_id = NEW.curriculum_id AND id = NEW.id;
END;

CREATE TRIGGER curriculum_weeks_course_section_insert_projection
AFTER INSERT ON curriculum_weeks
BEGIN
  INSERT INTO course_sections
    (id, course_id, revision_id, stable_id, order_index, title, description,
     created_at, updated_at)
  SELECT NEW.id, revision.curriculum_id, NEW.version_id, NEW.stable_id,
         NEW.order_index, NEW.title, NEW.description, NEW.created_at,
         NEW.updated_at
  FROM curriculum_versions revision
  JOIN course_revisions target
    ON target.course_id = revision.curriculum_id AND target.id = revision.id
  WHERE revision.id = NEW.version_id;
END;

CREATE TRIGGER curriculum_days_v2_course_lesson_insert_projection
AFTER INSERT ON curriculum_days_v2
BEGIN
  INSERT INTO course_lessons
    (id, course_id, revision_id, section_id, stable_id, order_index, title,
     description, goal, estimated_minutes, expected_outcomes_json, depth_level,
     out_of_scope_json, topics_json, created_at, updated_at)
  SELECT NEW.id, revision.curriculum_id, NEW.version_id, NEW.week_id,
         NEW.stable_id, NEW.order_index, NEW.title,
         COALESCE(NEW.description, NEW.title), NEW.goal, NEW.estimated_minutes,
         NEW.expected_outcomes_json, NEW.depth_level, NEW.out_of_scope_json,
         NEW.topics_json, NEW.created_at, NEW.updated_at
  FROM curriculum_versions revision
  JOIN course_revisions target
    ON target.course_id = revision.curriculum_id AND target.id = revision.id
  WHERE revision.id = NEW.version_id;
  INSERT INTO course_lesson_prerequisites
    (course_id, revision_id, lesson_id, prerequisite_lesson_id)
  SELECT revision.curriculum_id, NEW.version_id, NEW.id, prerequisite.id
  FROM curriculum_versions revision
  JOIN course_revisions target
    ON target.course_id = revision.curriculum_id AND target.id = revision.id
  JOIN json_each(NEW.prerequisites_json) reference
  JOIN course_lessons prerequisite
    ON prerequisite.course_id = revision.curriculum_id
   AND prerequisite.revision_id = NEW.version_id
   AND prerequisite.stable_id = reference.value
  WHERE revision.id = NEW.version_id;
END;

CREATE TRIGGER curriculum_units_course_activity_insert_projection
AFTER INSERT ON curriculum_units
BEGIN
  INSERT INTO course_activities
    (id, course_id, revision_id, lesson_id, stable_id, activity_type,
     order_index, title, description, estimated_minutes, required,
     objectives_json, checklist_json, sources_json, questions_json,
     misconceptions_json, capability_ids_json, completion_criteria_json,
     payload_json, protected_material_json, depth_level, created_at, updated_at)
  SELECT NEW.id, revision.curriculum_id, NEW.version_id, NEW.day_id,
         NEW.stable_id, NEW.type, NEW.order_index, NEW.title,
         COALESCE(NEW.description, NEW.title), NEW.estimated_minutes,
         CASE NEW.optional WHEN 0 THEN 1 ELSE 0 END, NEW.objectives_json,
         NEW.checklist_json, NEW.sources_json, NEW.questions_json,
         NEW.misconceptions_json, '[]', NEW.completion_criteria_json,
         NEW.payload_json,
         json_object(
           'referenceAnswer',
           CASE WHEN NEW.reference_answer_json IS NULL
             THEN NULL ELSE json(NEW.reference_answer_json) END,
           'questions', json(NEW.questions_json)
         ),
         NEW.depth_level, NEW.created_at, NEW.updated_at
  FROM curriculum_versions revision
  JOIN course_revisions target
    ON target.course_id = revision.curriculum_id AND target.id = revision.id
  WHERE revision.id = NEW.version_id;
  INSERT INTO course_activity_prerequisites
    (course_id, revision_id, lesson_id, activity_id,
     prerequisite_activity_id)
  SELECT revision.curriculum_id, NEW.version_id, NEW.day_id, NEW.id,
         prerequisite.id
  FROM curriculum_versions revision
  JOIN course_revisions target
    ON target.course_id = revision.curriculum_id AND target.id = revision.id
  JOIN json_each(NEW.unlock_rules_json) rule
  JOIN course_activities prerequisite
    ON prerequisite.course_id = revision.curriculum_id
   AND prerequisite.revision_id = NEW.version_id
   AND prerequisite.lesson_id = NEW.day_id
   AND prerequisite.stable_id = json_extract(rule.value, '$.unitId')
  WHERE revision.id = NEW.version_id;
END;

CREATE TRIGGER session_snapshots_course_context_insert_guard
BEFORE INSERT ON session_snapshots
WHEN NEW.curriculum_id IS NULL OR NEW.curriculum_version_id IS NULL OR NEW.curriculum_day_id IS NULL
  OR NOT EXISTS (
    SELECT 1 FROM learning_sessions session
    WHERE session.id = NEW.session_id
      AND session.curriculum_day_v2_id = NEW.curriculum_day_id
  )
  OR NOT EXISTS (
    SELECT 1 FROM course_lessons lesson
    WHERE lesson.course_id = NEW.curriculum_id
      AND lesson.revision_id = NEW.curriculum_version_id
      AND lesson.id = NEW.curriculum_day_id
  )
BEGIN SELECT RAISE(ABORT, 'session snapshot course scope is invalid'); END;

CREATE TRIGGER session_snapshots_course_context_insert_sync
AFTER INSERT ON session_snapshots
BEGIN
  INSERT INTO session_course_contexts
    (session_id, course_id, revision_id, lesson_id, session_snapshot_id,
     snapshot_hash, snapshot_bytes_hash, created_at)
  SELECT NEW.session_id, NEW.curriculum_id, NEW.curriculum_version_id,
         NEW.curriculum_day_id, NEW.id, NEW.content_hash,
         dlh_sha256_text(NEW.snapshot_json), NEW.created_at
  FROM course_lessons lesson
  WHERE lesson.course_id = NEW.curriculum_id
    AND lesson.revision_id = NEW.curriculum_version_id
    AND lesson.id = NEW.curriculum_day_id;
END;

CREATE TRIGGER versioned_unit_evidence_course_scope_insert_guard
BEFORE INSERT ON versioned_unit_evidence
WHEN NOT EXISTS (
  SELECT 1 FROM session_course_contexts context
  JOIN course_activities activity
    ON activity.course_id = context.course_id
   AND activity.revision_id = context.revision_id
   AND activity.lesson_id = context.lesson_id
   AND activity.id = NEW.unit_id
  WHERE context.session_id = NEW.session_id
    AND activity.activity_type = CASE NEW.evidence_type
      WHEN 'recall-attempt' THEN 'recall'
      WHEN 'quiz-answer' THEN 'quiz'
      WHEN 'code-reading-attempt' THEN 'code-reading'
      WHEN 'summary' THEN 'summary'
      ELSE NULL END
)
AND NOT EXISTS (
  SELECT 1
  FROM session_snapshots snapshot
  JOIN curriculum_versions revision
    ON revision.id = snapshot.curriculum_version_id
   AND revision.curriculum_id = snapshot.curriculum_id
  JOIN curriculum_days_v2 lesson
    ON lesson.id = snapshot.curriculum_day_id
   AND lesson.version_id = revision.id
  JOIN curriculum_units activity
    ON activity.id = NEW.unit_id
   AND activity.version_id = revision.id
   AND activity.day_id = lesson.id
  JOIN migration_provenance revision_provenance
    ON revision_provenance.transform_version = 'm2-v1'
   AND revision_provenance.source_table = 'curriculum_versions'
   AND revision_provenance.source_primary_key = revision.id
   AND revision_provenance.status = 'quarantined'
  JOIN migration_provenance lesson_provenance
    ON lesson_provenance.transform_version = 'm2-v1'
   AND lesson_provenance.source_table = 'curriculum_days_v2'
   AND lesson_provenance.source_primary_key = lesson.id
   AND lesson_provenance.status = 'quarantined'
  JOIN migration_provenance snapshot_provenance
    ON snapshot_provenance.transform_version = 'm2-v1'
   AND snapshot_provenance.source_table = 'session_snapshots'
   AND snapshot_provenance.source_primary_key = snapshot.id
   AND snapshot_provenance.status = 'quarantined'
  WHERE snapshot.session_id = NEW.session_id
    AND activity.type = CASE NEW.evidence_type
      WHEN 'recall-attempt' THEN 'recall'
      WHEN 'quiz-answer' THEN 'quiz'
      WHEN 'code-reading-attempt' THEN 'code-reading'
      WHEN 'summary' THEN 'summary'
      ELSE NULL END
)
BEGIN SELECT RAISE(ABORT, 'versioned evidence course scope is invalid'); END;

CREATE TRIGGER versioned_unit_evidence_course_scope_insert_sync
AFTER INSERT ON versioned_unit_evidence
BEGIN
  INSERT INTO evidence_facts
    (id, schema_version, operation_id, course_id, revision_id, lesson_id,
     session_id, activity_id, evidence_type, question_id, correctness,
     occurred_at, recorded_at, payload_json, provenance_json)
  SELECT NEW.id, 1, NEW.operation_id, context.course_id, context.revision_id,
         context.lesson_id, NEW.session_id, NEW.unit_id, NEW.evidence_type,
         NEW.question_id, NEW.correctness, NEW.created_at, NEW.created_at,
         NEW.payload_json, json_object('kind', 'learner', 'sourceId', NEW.id)
  FROM session_course_contexts context
  WHERE context.session_id = NEW.session_id;
END;
