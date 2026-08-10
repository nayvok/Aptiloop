-- M11 follow-up: only a current target-session context may advance Course learner state.
DROP TRIGGER session_course_contexts_learner_state_insert;

CREATE TRIGGER session_course_contexts_learner_state_insert
AFTER INSERT ON session_course_contexts
WHEN EXISTS (
  SELECT 1
  FROM learning_sessions session
  WHERE session.id = NEW.session_id
    AND session.status = 'active'
) AND EXISTS (
  SELECT 1
  FROM course_revisions revision
  WHERE revision.course_id = NEW.course_id
    AND revision.id = NEW.revision_id
    AND revision.status = 'published'
)
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
