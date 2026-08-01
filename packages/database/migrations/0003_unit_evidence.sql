CREATE TABLE versioned_unit_evidence (
  id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL REFERENCES learning_sessions(id) ON DELETE CASCADE,
  unit_id TEXT NOT NULL,
  evidence_type TEXT NOT NULL CHECK(
    evidence_type IN (
      'recall-attempt',
      'quiz-answer',
      'code-reading-attempt',
      'summary'
    )
  ),
  operation_id TEXT NOT NULL UNIQUE CHECK(
    length(trim(operation_id)) BETWEEN 1 AND 200
  ),
  question_id TEXT CHECK(
    question_id IS NULL OR length(trim(question_id)) BETWEEN 1 AND 200
  ),
  payload_json TEXT NOT NULL,
  correctness REAL CHECK(
    correctness IS NULL OR correctness BETWEEN 0.0 AND 1.0
  ),
  created_at INTEGER NOT NULL
);

CREATE INDEX versioned_unit_evidence_session_idx
  ON versioned_unit_evidence(session_id, created_at, id);
CREATE INDEX versioned_unit_evidence_session_unit_idx
  ON versioned_unit_evidence(session_id, unit_id, created_at, id);
CREATE INDEX versioned_unit_evidence_session_type_idx
  ON versioned_unit_evidence(session_id, evidence_type, created_at, id);
