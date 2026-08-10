-- M11 replaces the singleton learner_state cursor with one explicit state row per Course.
CREATE TABLE learner_course_states (
  course_id TEXT PRIMARY KEY NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
  active_revision_id TEXT NOT NULL,
  current_learning_session_id TEXT REFERENCES learning_sessions(id) ON DELETE SET NULL,
  is_selected INTEGER NOT NULL DEFAULT 0 CHECK(is_selected IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (course_id, active_revision_id)
    REFERENCES course_revisions(course_id, id) ON DELETE RESTRICT,
  CHECK(updated_at >= created_at)
);
CREATE UNIQUE INDEX learner_course_states_selected_idx
  ON learner_course_states(is_selected) WHERE is_selected = 1;
CREATE INDEX learner_course_states_current_session_idx
  ON learner_course_states(current_learning_session_id)
  WHERE current_learning_session_id IS NOT NULL;

INSERT INTO learner_course_states (
  course_id, active_revision_id, current_learning_session_id,
  is_selected, created_at, updated_at
)
SELECT
  context.course_id,
  context.revision_id,
  session.id,
  1,
  session.started_at,
  session.updated_at
FROM learner_state legacy
JOIN learning_sessions session ON session.id = legacy.current_learning_session_id
JOIN session_course_contexts context ON context.session_id = session.id
WHERE legacy.id = 'default' AND session.status = 'active'
ON CONFLICT(course_id) DO NOTHING;

INSERT INTO learner_course_states (
  course_id, active_revision_id, current_learning_session_id,
  is_selected, created_at, updated_at
)
SELECT
  course.id,
  course.active_revision_id,
  NULL,
  CASE WHEN NOT EXISTS (SELECT 1 FROM learner_course_states WHERE is_selected = 1)
         AND course.id = (
           SELECT fallback.id
           FROM courses fallback
           JOIN course_revisions revision
             ON revision.course_id = fallback.id
            AND revision.id = fallback.active_revision_id
           WHERE revision.status = 'published'
           ORDER BY fallback.updated_at DESC, fallback.id
           LIMIT 1
         )
       THEN 1 ELSE 0 END,
  course.created_at,
  course.updated_at
FROM courses course
JOIN course_revisions revision
  ON revision.course_id = course.id
 AND revision.id = course.active_revision_id
WHERE revision.status = 'published'
ON CONFLICT(course_id) DO NOTHING;

CREATE TRIGGER learner_course_states_scope_insert_guard
BEFORE INSERT ON learner_course_states
WHEN NOT EXISTS (
  SELECT 1 FROM course_revisions revision
  WHERE revision.course_id = NEW.course_id
    AND revision.id = NEW.active_revision_id
    AND revision.status = 'published'
) OR (
  NEW.current_learning_session_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM learning_sessions session
    JOIN session_course_contexts context ON context.session_id = session.id
    WHERE session.id = NEW.current_learning_session_id
      AND session.status = 'active'
      AND context.course_id = NEW.course_id
      AND context.revision_id = NEW.active_revision_id
  )
)
BEGIN SELECT RAISE(ABORT, 'learner Course state scope is invalid'); END;

CREATE TRIGGER learner_course_states_scope_update_guard
BEFORE UPDATE OF course_id, active_revision_id, current_learning_session_id ON learner_course_states
WHEN NOT EXISTS (
  SELECT 1 FROM course_revisions revision
  WHERE revision.course_id = NEW.course_id
    AND revision.id = NEW.active_revision_id
    AND revision.status = 'published'
) OR (
  NEW.current_learning_session_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM learning_sessions session
    JOIN session_course_contexts context ON context.session_id = session.id
    WHERE session.id = NEW.current_learning_session_id
      AND session.status = 'active'
      AND context.course_id = NEW.course_id
      AND context.revision_id = NEW.active_revision_id
  )
)
BEGIN SELECT RAISE(ABORT, 'learner Course state scope is invalid'); END;

CREATE TRIGGER session_course_contexts_learner_state_insert
AFTER INSERT ON session_course_contexts
BEGIN
  INSERT INTO learner_course_states (
    course_id, active_revision_id, current_learning_session_id,
    is_selected, created_at, updated_at
  ) VALUES (
    NEW.course_id, NEW.revision_id, NEW.session_id,
    CASE WHEN EXISTS (SELECT 1 FROM learner_course_states WHERE is_selected = 1)
      THEN 0 ELSE 1 END,
    NEW.created_at, NEW.created_at
  )
  ON CONFLICT(course_id) DO UPDATE SET
    active_revision_id = excluded.active_revision_id,
    current_learning_session_id = excluded.current_learning_session_id,
    updated_at = MAX(learner_course_states.created_at, excluded.updated_at);
END;

CREATE TRIGGER learning_sessions_learner_course_state_complete
AFTER UPDATE OF status ON learning_sessions
WHEN OLD.status = 'active' AND NEW.status != 'active'
BEGIN
  UPDATE learner_course_states
  SET active_revision_id = COALESCE(
        (
          SELECT course.active_revision_id
          FROM courses course
          JOIN course_revisions revision
            ON revision.course_id = course.id
           AND revision.id = course.active_revision_id
          WHERE course.id = learner_course_states.course_id
            AND revision.status = 'published'
        ),
        active_revision_id
      ),
      current_learning_session_id = NULL,
      updated_at = MAX(created_at, NEW.updated_at)
  WHERE current_learning_session_id = NEW.id;
END;
