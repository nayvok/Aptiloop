-- Preserve the explicit legacy/versioned compatibility path only for source
-- revisions that the completed M2 reconciliation quarantined. Unknown or
-- unaccounted Course identities still fail closed.

DROP TRIGGER session_snapshots_course_context_insert_guard;
DROP TRIGGER session_snapshots_course_context_insert_sync;
DROP TRIGGER versioned_unit_evidence_course_scope_insert_guard;
DROP TRIGGER versioned_unit_evidence_course_scope_insert_sync;

CREATE TRIGGER session_snapshots_course_context_insert_guard
BEFORE INSERT ON session_snapshots
WHEN NEW.curriculum_id IS NULL OR NEW.curriculum_version_id IS NULL OR NEW.curriculum_day_id IS NULL
  OR NOT EXISTS (
    SELECT 1 FROM learning_sessions session
    WHERE session.id = NEW.session_id
      AND session.curriculum_day_v2_id = NEW.curriculum_day_id
  )
  OR (
    NOT EXISTS (
      SELECT 1 FROM course_lessons lesson
      WHERE lesson.course_id = NEW.curriculum_id
        AND lesson.revision_id = NEW.curriculum_version_id
        AND lesson.id = NEW.curriculum_day_id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM migration_provenance provenance
      JOIN curriculum_versions revision
        ON revision.id = provenance.source_primary_key
       AND revision.id = NEW.curriculum_version_id
       AND revision.curriculum_id = NEW.curriculum_id
      JOIN curriculum_days_v2 lesson
        ON lesson.id = NEW.curriculum_day_id
       AND lesson.version_id = revision.id
      WHERE provenance.transform_version = 'm2-v1'
        AND provenance.source_table = 'curriculum_versions'
        AND provenance.status = 'quarantined'
    )
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
  WHERE EXISTS (
    SELECT 1 FROM course_lessons lesson
    WHERE lesson.course_id = NEW.curriculum_id
      AND lesson.revision_id = NEW.curriculum_version_id
      AND lesson.id = NEW.curriculum_day_id
  );
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
  JOIN migration_provenance provenance
    ON provenance.transform_version = 'm2-v1'
   AND provenance.source_table = 'curriculum_versions'
   AND provenance.source_primary_key = revision.id
   AND provenance.status = 'quarantined'
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
