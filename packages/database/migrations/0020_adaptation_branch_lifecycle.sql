-- Preserve every historical personal branch while making future branch identity
-- revision-scoped and enforcing one unambiguous active branch per Course.

CREATE TABLE adaptation_branch_lifecycle_migration_guard (
  invalid INTEGER NOT NULL
    CONSTRAINT adaptation_branch_lifecycle_preflight CHECK (invalid = 0)
);

INSERT INTO adaptation_branch_lifecycle_migration_guard (invalid)
SELECT 1
WHERE EXISTS (
  SELECT 1
  FROM adaptation_branches branch
  LEFT JOIN course_revisions base
    ON base.course_id = branch.course_id
   AND base.id = branch.base_revision_id
  WHERE base.id IS NULL
     OR base.branch_kind != 'upstream'
     OR base.status = 'draft'
     OR (
       branch.head_revision_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
         FROM curriculum_versions head
         WHERE head.curriculum_id = branch.course_id
           AND head.id = branch.head_revision_id
           AND head.branch_kind = 'personal'
           AND head.status IN ('published', 'archived')
           AND head.adaptation_branch_id = branch.id
       )
     )
)
OR EXISTS (
  SELECT course_id
  FROM adaptation_branches
  WHERE status = 'active'
  GROUP BY course_id
  HAVING count(*) > 1
)
OR EXISTS (
  SELECT 1
  FROM courses course
  JOIN course_revisions revision
    ON revision.course_id = course.id
   AND revision.id = course.active_revision_id
  WHERE revision.branch_kind = 'upstream'
    AND revision.status = 'published'
    AND NOT EXISTS (
      SELECT 1 FROM adaptation_branches branch
      WHERE branch.course_id = course.id AND branch.status = 'active'
    )
)
OR EXISTS (
  SELECT 1
  FROM session_course_contexts context
  WHERE (
    SELECT count(*)
    FROM (
      SELECT branch_id FROM learning_kernel_facts fact
      WHERE fact.session_id = context.session_id
        AND fact.course_id = context.course_id
        AND fact.revision_id = context.revision_id
      UNION
      SELECT branch_id FROM learning_kernel_projection_history history
      WHERE history.session_id = context.session_id
        AND history.course_id = context.course_id
        AND history.revision_id = context.revision_id
      UNION
      SELECT branch_id FROM learning_kernel_projections projection
      WHERE projection.session_id = context.session_id
        AND projection.course_id = context.course_id
        AND projection.revision_id = context.revision_id
    ) persisted_scope
  ) > 1
  OR (
    NOT EXISTS (
      SELECT branch_id FROM learning_kernel_facts fact
      WHERE fact.session_id = context.session_id
        AND fact.course_id = context.course_id
        AND fact.revision_id = context.revision_id
      UNION
      SELECT branch_id FROM learning_kernel_projection_history history
      WHERE history.session_id = context.session_id
        AND history.course_id = context.course_id
        AND history.revision_id = context.revision_id
      UNION
      SELECT branch_id FROM learning_kernel_projections projection
      WHERE projection.session_id = context.session_id
        AND projection.course_id = context.course_id
        AND projection.revision_id = context.revision_id
    )
    AND (
      SELECT count(*) FROM adaptation_branches branch
      WHERE branch.course_id = context.course_id
        AND (
          branch.base_revision_id = context.revision_id
          OR branch.head_revision_id = context.revision_id
        )
    ) != 1
  )
);

DROP TABLE adaptation_branch_lifecycle_migration_guard;

DROP TRIGGER adaptation_branches_scope_insert_guard;
DROP TRIGGER adaptation_branches_scope_update_guard;
DROP TRIGGER courses_personal_branch_insert_projection;
DROP TRIGGER courses_personal_branch_update_projection;
DROP TRIGGER session_course_contexts_immutable_update_guard;
DROP TRIGGER session_snapshots_course_context_insert_sync;

ALTER TABLE session_course_contexts
  ADD COLUMN adaptation_branch_id TEXT
  REFERENCES adaptation_branches(id) ON DELETE RESTRICT;

UPDATE session_course_contexts AS context
SET adaptation_branch_id = COALESCE(
  (
    SELECT branch_id
    FROM (
      SELECT branch_id FROM learning_kernel_facts fact
      WHERE fact.session_id = context.session_id
        AND fact.course_id = context.course_id
        AND fact.revision_id = context.revision_id
      UNION
      SELECT branch_id FROM learning_kernel_projection_history history
      WHERE history.session_id = context.session_id
        AND history.course_id = context.course_id
        AND history.revision_id = context.revision_id
      UNION
      SELECT branch_id FROM learning_kernel_projections projection
      WHERE projection.session_id = context.session_id
        AND projection.course_id = context.course_id
        AND projection.revision_id = context.revision_id
    ) persisted_scope
    LIMIT 1
  ),
  (
    SELECT branch.id FROM adaptation_branches branch
    WHERE branch.course_id = context.course_id
      AND (branch.base_revision_id = context.revision_id
           OR branch.head_revision_id = context.revision_id)
    LIMIT 1
  )
);

CREATE INDEX session_course_contexts_adaptation_branch_idx
  ON session_course_contexts(course_id, adaptation_branch_id, session_id);

CREATE UNIQUE INDEX adaptation_branches_one_active_course_uq
  ON adaptation_branches(course_id) WHERE status = 'active';

CREATE TRIGGER adaptation_branches_scope_insert_guard
BEFORE INSERT ON adaptation_branches
WHEN NOT EXISTS (
  SELECT 1 FROM course_revisions base
  WHERE base.course_id = NEW.course_id
    AND base.id = NEW.base_revision_id
    AND base.branch_kind = 'upstream'
    AND base.status IN ('published', 'archived')
) OR (
  NEW.head_revision_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM curriculum_versions head
    WHERE head.curriculum_id = NEW.course_id
      AND head.id = NEW.head_revision_id
      AND head.branch_kind = 'personal'
      AND head.status IN ('published', 'archived')
      AND head.adaptation_branch_id = NEW.id
  )
)
BEGIN SELECT RAISE(ABORT, 'adaptation branch revision scope is invalid'); END;

CREATE TRIGGER adaptation_branches_scope_update_guard
BEFORE UPDATE OF course_id, owner, base_revision_id, head_revision_id
ON adaptation_branches
WHEN NEW.course_id IS NOT OLD.course_id
  OR NEW.owner IS NOT OLD.owner
  OR NEW.base_revision_id IS NOT OLD.base_revision_id
  OR (
    NEW.head_revision_id IS NOT OLD.head_revision_id
    AND NEW.head_revision_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM curriculum_versions head
      WHERE head.curriculum_id = NEW.course_id
        AND head.id = NEW.head_revision_id
        AND head.branch_kind = 'personal'
        AND head.status IN ('published', 'archived')
        AND head.adaptation_branch_id = NEW.id
    )
  )
BEGIN SELECT RAISE(ABORT, 'adaptation branch revision scope is invalid'); END;

CREATE TRIGGER session_course_contexts_adaptation_branch_insert_guard
BEFORE INSERT ON session_course_contexts
WHEN NEW.adaptation_branch_id IS NULL
  OR NOT EXISTS (
    SELECT 1 FROM adaptation_branches branch
    WHERE branch.course_id = NEW.course_id
      AND branch.id = NEW.adaptation_branch_id
      AND branch.status = 'active'
      AND (
        branch.base_revision_id = NEW.revision_id
        OR branch.head_revision_id = NEW.revision_id
      )
  )
BEGIN SELECT RAISE(ABORT, 'session course context adaptation branch is invalid'); END;

CREATE TRIGGER session_course_contexts_immutable_update_guard
BEFORE UPDATE ON session_course_contexts
BEGIN SELECT RAISE(ABORT, 'session course context is immutable'); END;

CREATE TRIGGER learning_kernel_fact_session_branch_insert_guard
BEFORE INSERT ON learning_kernel_facts
WHEN NOT EXISTS (
  SELECT 1 FROM session_course_contexts context
  WHERE context.session_id = NEW.session_id
    AND context.course_id = NEW.course_id
    AND context.revision_id = NEW.revision_id
    AND context.adaptation_branch_id = NEW.branch_id
)
BEGIN SELECT RAISE(ABORT, 'Learning Kernel fact branch is not pinned to its session'); END;

CREATE TRIGGER learning_kernel_projection_history_session_branch_insert_guard
BEFORE INSERT ON learning_kernel_projection_history
WHEN NOT EXISTS (
  SELECT 1 FROM session_course_contexts context
  WHERE context.session_id = NEW.session_id
    AND context.course_id = NEW.course_id
    AND context.revision_id = NEW.revision_id
    AND context.adaptation_branch_id = NEW.branch_id
)
BEGIN SELECT RAISE(ABORT, 'Learning Kernel projection branch is not pinned to its session'); END;

CREATE TRIGGER learning_kernel_projection_session_branch_insert_guard
BEFORE INSERT ON learning_kernel_projections
WHEN NOT EXISTS (
  SELECT 1 FROM session_course_contexts context
  WHERE context.session_id = NEW.session_id
    AND context.course_id = NEW.course_id
    AND context.revision_id = NEW.revision_id
    AND context.adaptation_branch_id = NEW.branch_id
)
BEGIN SELECT RAISE(ABORT, 'Learning Kernel projection branch is not pinned to its session'); END;

CREATE TRIGGER learning_kernel_projection_session_branch_update_guard
BEFORE UPDATE OF session_id, course_id, revision_id, branch_id
ON learning_kernel_projections
WHEN NOT EXISTS (
  SELECT 1 FROM session_course_contexts context
  WHERE context.session_id = NEW.session_id
    AND context.course_id = NEW.course_id
    AND context.revision_id = NEW.revision_id
    AND context.adaptation_branch_id = NEW.branch_id
)
BEGIN SELECT RAISE(ABORT, 'Learning Kernel projection branch is not pinned to its session'); END;

CREATE TRIGGER session_snapshots_course_context_insert_sync
AFTER INSERT ON session_snapshots
BEGIN
  INSERT INTO session_course_contexts
    (session_id, course_id, revision_id, lesson_id, adaptation_branch_id,
     session_snapshot_id, snapshot_hash, snapshot_bytes_hash, created_at)
  SELECT NEW.session_id, NEW.curriculum_id, NEW.curriculum_version_id,
         NEW.curriculum_day_id,
         (
           SELECT branch.id FROM adaptation_branches branch
           WHERE branch.course_id = NEW.curriculum_id
             AND branch.status = 'active'
             AND (
               branch.base_revision_id = NEW.curriculum_version_id
               OR branch.head_revision_id = NEW.curriculum_version_id
             )
         ),
         NEW.id, NEW.content_hash, dlh_sha256_text(NEW.snapshot_json),
         NEW.created_at
  FROM course_lessons lesson
  WHERE lesson.course_id = NEW.curriculum_id
    AND lesson.revision_id = NEW.curriculum_version_id
    AND lesson.id = NEW.curriculum_day_id;
END;

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
  VALUES ('branch:' || lower(hex(randomblob(16))), NEW.id, 'local',
          NEW.active_revision_id, NULL, 'active', NEW.updated_at,
          NEW.updated_at);
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
  VALUES ('branch:' || lower(hex(randomblob(16))), NEW.id, 'local',
          NEW.active_revision_id, NULL, 'active', NEW.updated_at,
          NEW.updated_at);
END;
