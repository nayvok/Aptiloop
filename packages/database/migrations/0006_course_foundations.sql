CREATE TABLE courses (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(trim(id)) BETWEEN 1 AND 200),
  stable_id TEXT NOT NULL UNIQUE CHECK(length(trim(stable_id)) BETWEEN 1 AND 200),
  slug TEXT NOT NULL UNIQUE CHECK(length(trim(slug)) BETWEEN 1 AND 200),
  title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 500),
  description TEXT CHECK(description IS NULL OR length(description) <= 50000),
  primary_locale TEXT NOT NULL CHECK(length(trim(primary_locale)) BETWEEN 2 AND 35),
  active_revision_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (id, active_revision_id)
    REFERENCES course_revisions(course_id, id)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  CHECK(updated_at >= created_at)
);

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
  CHECK(
    (branch_kind = 'upstream' AND parent_revision_id IS NULL AND based_on_content_hash IS NULL) OR
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
CREATE INDEX course_revisions_status_idx
  ON course_revisions(course_id, status, revision_number, id);

CREATE TABLE course_sections (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(trim(id)) BETWEEN 1 AND 200),
  course_id TEXT NOT NULL,
  revision_id TEXT NOT NULL,
  stable_id TEXT NOT NULL CHECK(length(trim(stable_id)) BETWEEN 1 AND 200),
  order_index INTEGER NOT NULL CHECK(order_index >= 0),
  title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 500),
  description TEXT CHECK(description IS NULL OR length(description) <= 50000),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(course_id, revision_id, id),
  UNIQUE(course_id, revision_id, stable_id),
  UNIQUE(course_id, revision_id, order_index),
  FOREIGN KEY (course_id, revision_id)
    REFERENCES course_revisions(course_id, id) ON DELETE RESTRICT,
  CHECK(updated_at >= created_at)
);
CREATE INDEX course_sections_revision_order_idx
  ON course_sections(course_id, revision_id, order_index, id);

CREATE TABLE course_lessons (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(trim(id)) BETWEEN 1 AND 200),
  course_id TEXT NOT NULL,
  revision_id TEXT NOT NULL,
  section_id TEXT NOT NULL,
  stable_id TEXT NOT NULL CHECK(length(trim(stable_id)) BETWEEN 1 AND 200),
  order_index INTEGER NOT NULL CHECK(order_index >= 0),
  title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 500),
  description TEXT NOT NULL CHECK(length(trim(description)) BETWEEN 1 AND 50000),
  goal TEXT NOT NULL CHECK(length(trim(goal)) BETWEEN 1 AND 50000),
  estimated_minutes INTEGER NOT NULL CHECK(estimated_minutes > 0),
  expected_outcomes_json TEXT NOT NULL CHECK(json_valid(expected_outcomes_json) AND substr(ltrim(expected_outcomes_json), 1, 1) = '['),
  depth_level TEXT NOT NULL CHECK(length(trim(depth_level)) BETWEEN 1 AND 100),
  out_of_scope_json TEXT NOT NULL CHECK(json_valid(out_of_scope_json) AND substr(ltrim(out_of_scope_json), 1, 1) = '['),
  topics_json TEXT NOT NULL CHECK(json_valid(topics_json) AND substr(ltrim(topics_json), 1, 1) = '['),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(course_id, revision_id, id),
  UNIQUE(course_id, revision_id, stable_id),
  UNIQUE(course_id, revision_id, section_id, order_index),
  FOREIGN KEY (course_id, revision_id)
    REFERENCES course_revisions(course_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (course_id, revision_id, section_id)
    REFERENCES course_sections(course_id, revision_id, id) ON DELETE RESTRICT,
  CHECK(updated_at >= created_at)
);
CREATE INDEX course_lessons_revision_order_idx
  ON course_lessons(course_id, revision_id, section_id, order_index, id);

CREATE TABLE course_lesson_prerequisites (
  course_id TEXT NOT NULL,
  revision_id TEXT NOT NULL,
  lesson_id TEXT NOT NULL,
  prerequisite_lesson_id TEXT NOT NULL,
  PRIMARY KEY (course_id, revision_id, lesson_id, prerequisite_lesson_id),
  FOREIGN KEY (course_id, revision_id, lesson_id)
    REFERENCES course_lessons(course_id, revision_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (course_id, revision_id, prerequisite_lesson_id)
    REFERENCES course_lessons(course_id, revision_id, id) ON DELETE RESTRICT,
  CHECK(lesson_id != prerequisite_lesson_id)
) WITHOUT ROWID;
CREATE INDEX course_lesson_prerequisites_target_idx
  ON course_lesson_prerequisites(course_id, revision_id, prerequisite_lesson_id, lesson_id);

CREATE TABLE course_activities (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(trim(id)) BETWEEN 1 AND 200),
  course_id TEXT NOT NULL,
  revision_id TEXT NOT NULL,
  lesson_id TEXT NOT NULL,
  stable_id TEXT NOT NULL CHECK(length(trim(stable_id)) BETWEEN 1 AND 200),
  activity_type TEXT NOT NULL CHECK(activity_type IN (
    'briefing', 'study', 'recall', 'teacher-dialogue', 'quiz', 'code-reading',
    'exercise', 'review', 'interview', 'summary', 'checkpoint', 'spaced-review'
  )),
  order_index INTEGER NOT NULL CHECK(order_index >= 0),
  title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 500),
  description TEXT NOT NULL CHECK(length(trim(description)) BETWEEN 1 AND 50000),
  estimated_minutes INTEGER CHECK(estimated_minutes IS NULL OR estimated_minutes > 0),
  required INTEGER NOT NULL CHECK(required IN (0, 1)),
  objectives_json TEXT NOT NULL CHECK(json_valid(objectives_json) AND substr(ltrim(objectives_json), 1, 1) = '['),
  checklist_json TEXT NOT NULL CHECK(json_valid(checklist_json) AND substr(ltrim(checklist_json), 1, 1) = '['),
  sources_json TEXT NOT NULL CHECK(json_valid(sources_json) AND substr(ltrim(sources_json), 1, 1) = '['),
  questions_json TEXT NOT NULL CHECK(json_valid(questions_json) AND substr(ltrim(questions_json), 1, 1) = '['),
  misconceptions_json TEXT NOT NULL CHECK(json_valid(misconceptions_json) AND substr(ltrim(misconceptions_json), 1, 1) = '['),
  capability_ids_json TEXT NOT NULL CHECK(json_valid(capability_ids_json) AND substr(ltrim(capability_ids_json), 1, 1) = '['),
  completion_criteria_json TEXT NOT NULL CHECK(json_valid(completion_criteria_json) AND substr(ltrim(completion_criteria_json), 1, 1) = '['),
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json) AND substr(ltrim(payload_json), 1, 1) = '{'),
  protected_material_json TEXT NOT NULL CHECK(json_valid(protected_material_json) AND substr(ltrim(protected_material_json), 1, 1) = '{'),
  depth_level TEXT CHECK(depth_level IS NULL OR length(trim(depth_level)) BETWEEN 1 AND 100),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(course_id, revision_id, id),
  UNIQUE(course_id, revision_id, lesson_id, id),
  UNIQUE(course_id, revision_id, stable_id),
  UNIQUE(course_id, revision_id, lesson_id, order_index),
  FOREIGN KEY (course_id, revision_id)
    REFERENCES course_revisions(course_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (course_id, revision_id, lesson_id)
    REFERENCES course_lessons(course_id, revision_id, id) ON DELETE RESTRICT,
  CHECK(updated_at >= created_at)
);
CREATE INDEX course_activities_lesson_order_idx
  ON course_activities(course_id, revision_id, lesson_id, order_index, id);
CREATE INDEX course_activities_type_idx
  ON course_activities(course_id, revision_id, activity_type, id);

CREATE TABLE course_activity_prerequisites (
  course_id TEXT NOT NULL,
  revision_id TEXT NOT NULL,
  lesson_id TEXT NOT NULL,
  activity_id TEXT NOT NULL,
  prerequisite_activity_id TEXT NOT NULL,
  PRIMARY KEY (course_id, revision_id, lesson_id, activity_id, prerequisite_activity_id),
  FOREIGN KEY (course_id, revision_id, lesson_id, activity_id)
    REFERENCES course_activities(course_id, revision_id, lesson_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (course_id, revision_id, lesson_id, prerequisite_activity_id)
    REFERENCES course_activities(course_id, revision_id, lesson_id, id) ON DELETE RESTRICT,
  CHECK(activity_id != prerequisite_activity_id)
) WITHOUT ROWID;
CREATE INDEX course_activity_prerequisites_target_idx
  ON course_activity_prerequisites(course_id, revision_id, lesson_id, prerequisite_activity_id, activity_id);

CREATE TABLE source_snapshots (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(trim(id)) BETWEEN 1 AND 200),
  course_id TEXT NOT NULL,
  revision_id TEXT NOT NULL,
  source_authority_id TEXT NOT NULL CHECK(length(trim(source_authority_id)) BETWEEN 1 AND 200),
  canonical_url TEXT NOT NULL CHECK(length(canonical_url) <= 4000 AND lower(substr(canonical_url, 1, 8)) = 'https://'),
  retrieved_at INTEGER NOT NULL,
  retrieval_method TEXT NOT NULL CHECK(retrieval_method IN ('official-http', 'manual-import', 'migration')),
  media_type TEXT NOT NULL CHECK(length(trim(media_type)) BETWEEN 3 AND 255),
  locale TEXT CHECK(locale IS NULL OR length(trim(locale)) BETWEEN 2 AND 35),
  content_hash TEXT NOT NULL CHECK(
    (length(content_hash) = 64 AND content_hash NOT GLOB '*[^0-9a-f]*') OR
    (length(content_hash) = 71 AND substr(content_hash, 1, 7) = 'sha256:' AND substr(content_hash, 8) NOT GLOB '*[^0-9a-f]*')
  ),
  title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 500),
  author_publisher TEXT CHECK(author_publisher IS NULL OR length(trim(author_publisher)) BETWEEN 1 AND 500),
  published_or_updated_at TEXT CHECK(published_or_updated_at IS NULL OR length(published_or_updated_at) <= 100),
  attribution TEXT CHECK(attribution IS NULL OR length(trim(attribution)) BETWEEN 1 AND 50000),
  license_spdx TEXT CHECK(license_spdx IS NULL OR length(trim(license_spdx)) BETWEEN 1 AND 500),
  terms_url TEXT CHECK(terms_url IS NULL OR (length(terms_url) <= 4000 AND lower(substr(terms_url, 1, 8)) = 'https://')),
  content TEXT CHECK(content IS NULL OR length(content) <= 100000),
  locator_map_json TEXT NOT NULL CHECK(json_valid(locator_map_json) AND substr(ltrim(locator_map_json), 1, 1) = '['),
  retention_mode TEXT NOT NULL CHECK(retention_mode IN ('full', 'extract', 'metadata-only')),
  supersedes_snapshot_id TEXT CHECK(supersedes_snapshot_id IS NULL OR (supersedes_snapshot_id <> id AND length(trim(supersedes_snapshot_id)) BETWEEN 1 AND 200)),
  created_at INTEGER NOT NULL,
  CHECK(
    (retention_mode IN ('full', 'extract') AND content IS NOT NULL) OR
    (retention_mode = 'metadata-only' AND content IS NULL)
  ),
  UNIQUE(course_id, revision_id, id),
  UNIQUE(course_id, revision_id, source_authority_id, content_hash),
  FOREIGN KEY (course_id, revision_id)
    REFERENCES course_revisions(course_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (course_id, revision_id, supersedes_snapshot_id)
    REFERENCES source_snapshots(course_id, revision_id, id) ON DELETE RESTRICT
);
CREATE INDEX source_snapshots_revision_idx
  ON source_snapshots(course_id, revision_id, source_authority_id, id);

CREATE TABLE knowledge_capsules (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(trim(id)) BETWEEN 1 AND 200),
  schema_version INTEGER NOT NULL CHECK(schema_version > 0),
  course_id TEXT NOT NULL,
  revision_id TEXT NOT NULL,
  knowledge_node_ids_json TEXT NOT NULL CHECK(json_valid(knowledge_node_ids_json) AND substr(ltrim(knowledge_node_ids_json), 1, 1) = '['),
  primary_locale TEXT NOT NULL CHECK(length(trim(primary_locale)) BETWEEN 2 AND 35),
  claims_json TEXT NOT NULL CHECK(json_valid(claims_json) AND substr(ltrim(claims_json), 1, 1) = '['),
  citations_json TEXT NOT NULL CHECK(json_valid(citations_json) AND substr(ltrim(citations_json), 1, 1) = '['),
  conflicts_json TEXT NOT NULL CHECK(json_valid(conflicts_json) AND substr(ltrim(conflicts_json), 1, 1) = '['),
  created_by TEXT NOT NULL CHECK(created_by IN ('manual', 'typed-ai-proposal', 'migration')),
  validation_hash TEXT NOT NULL CHECK(length(validation_hash) = 64 AND validation_hash NOT GLOB '*[^0-9a-f]*'),
  created_at INTEGER NOT NULL,
  UNIQUE(course_id, revision_id, id),
  FOREIGN KEY (course_id, revision_id)
    REFERENCES course_revisions(course_id, id) ON DELETE RESTRICT
);
CREATE INDEX knowledge_capsules_revision_idx
  ON knowledge_capsules(course_id, revision_id, id);

CREATE TABLE knowledge_capsule_sources (
  course_id TEXT NOT NULL,
  revision_id TEXT NOT NULL,
  capsule_id TEXT NOT NULL,
  source_snapshot_id TEXT NOT NULL,
  PRIMARY KEY (course_id, revision_id, capsule_id, source_snapshot_id),
  FOREIGN KEY (course_id, revision_id, capsule_id)
    REFERENCES knowledge_capsules(course_id, revision_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (course_id, revision_id, source_snapshot_id)
    REFERENCES source_snapshots(course_id, revision_id, id) ON DELETE RESTRICT
) WITHOUT ROWID;

CREATE TABLE adaptation_branches (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(trim(id)) BETWEEN 1 AND 200),
  course_id TEXT NOT NULL,
  owner TEXT NOT NULL CHECK(owner = 'local'),
  base_revision_id TEXT NOT NULL,
  head_revision_id TEXT,
  status TEXT NOT NULL CHECK(status IN ('active', 'archived')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(course_id, id),
  FOREIGN KEY (course_id, base_revision_id)
    REFERENCES course_revisions(course_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (course_id, head_revision_id)
    REFERENCES course_revisions(course_id, id) ON DELETE RESTRICT
);
CREATE INDEX adaptation_branches_course_status_idx
  ON adaptation_branches(course_id, status, id);

CREATE TABLE session_course_contexts (
  session_id TEXT PRIMARY KEY NOT NULL REFERENCES learning_sessions(id) ON DELETE RESTRICT,
  course_id TEXT NOT NULL,
  revision_id TEXT NOT NULL,
  lesson_id TEXT NOT NULL,
  session_snapshot_id TEXT NOT NULL UNIQUE REFERENCES session_snapshots(id) ON DELETE RESTRICT,
  snapshot_hash TEXT NOT NULL CHECK(length(trim(snapshot_hash)) > 0),
  snapshot_bytes_hash TEXT CHECK(snapshot_bytes_hash IS NULL OR (length(snapshot_bytes_hash) = 64 AND snapshot_bytes_hash NOT GLOB '*[^0-9a-f]*')),
  created_at INTEGER NOT NULL,
  UNIQUE(session_id, course_id, revision_id, lesson_id),
  FOREIGN KEY (course_id, revision_id)
    REFERENCES course_revisions(course_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (course_id, revision_id, lesson_id)
    REFERENCES course_lessons(course_id, revision_id, id) ON DELETE RESTRICT
);
CREATE INDEX session_course_contexts_revision_idx
  ON session_course_contexts(course_id, revision_id, lesson_id, session_id);

CREATE TABLE evidence_facts (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(trim(id)) BETWEEN 1 AND 200),
  schema_version INTEGER NOT NULL CHECK(schema_version > 0),
  operation_id TEXT NOT NULL UNIQUE CHECK(length(trim(operation_id)) BETWEEN 1 AND 200),
  course_id TEXT NOT NULL,
  revision_id TEXT NOT NULL,
  lesson_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  activity_id TEXT NOT NULL,
  evidence_type TEXT NOT NULL CHECK(evidence_type IN ('recall-attempt', 'quiz-answer', 'code-reading-attempt', 'summary')),
  question_id TEXT CHECK(question_id IS NULL OR length(trim(question_id)) BETWEEN 1 AND 200),
  correctness REAL CHECK(correctness IS NULL OR correctness BETWEEN 0.0 AND 1.0),
  occurred_at INTEGER NOT NULL,
  recorded_at INTEGER NOT NULL,
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json) AND substr(ltrim(payload_json), 1, 1) = '{'),
  provenance_json TEXT NOT NULL CHECK(json_valid(provenance_json) AND substr(ltrim(provenance_json), 1, 1) = '{'),
  UNIQUE(course_id, revision_id, id),
  FOREIGN KEY (session_id, course_id, revision_id, lesson_id)
    REFERENCES session_course_contexts(session_id, course_id, revision_id, lesson_id) ON DELETE RESTRICT,
  FOREIGN KEY (course_id, revision_id, lesson_id, activity_id)
    REFERENCES course_activities(course_id, revision_id, lesson_id, id) ON DELETE RESTRICT,
  CHECK(recorded_at >= occurred_at)
);
CREATE INDEX evidence_facts_session_time_idx
  ON evidence_facts(session_id, occurred_at, id);
CREATE INDEX evidence_facts_activity_time_idx
  ON evidence_facts(course_id, revision_id, activity_id, occurred_at, id);
CREATE INDEX evidence_facts_type_time_idx
  ON evidence_facts(course_id, evidence_type, occurred_at, id);

CREATE TABLE review_items (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(trim(id)) BETWEEN 1 AND 200),
  course_id TEXT NOT NULL,
  revision_id TEXT NOT NULL,
  source_evidence_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('mistake-correction', 'flashcard', 'spaced-review', 'activity-review')),
  status TEXT NOT NULL CHECK(status IN ('pending', 'completed', 'dismissed', 'superseded')),
  due_at INTEGER NOT NULL,
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json) AND substr(ltrim(payload_json), 1, 1) = '{'),
  scheduler_version TEXT NOT NULL CHECK(length(trim(scheduler_version)) BETWEEN 1 AND 100),
  created_at INTEGER NOT NULL,
  UNIQUE(course_id, revision_id, id),
  UNIQUE(course_id, revision_id, source_evidence_id, kind),
  FOREIGN KEY (course_id, revision_id, source_evidence_id)
    REFERENCES evidence_facts(course_id, revision_id, id) ON DELETE RESTRICT
);
CREATE INDEX review_items_course_due_idx
  ON review_items(course_id, status, due_at, id);

CREATE TABLE migration_runs (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(trim(id)) BETWEEN 1 AND 200),
  transform_version TEXT NOT NULL CHECK(length(trim(transform_version)) BETWEEN 1 AND 100),
  source_database_digest TEXT NOT NULL CHECK(length(source_database_digest) = 64 AND source_database_digest NOT GLOB '*[^0-9a-f]*'),
  source_rows_digest TEXT NOT NULL CHECK(length(source_rows_digest) = 64 AND source_rows_digest NOT GLOB '*[^0-9a-f]*'),
  approved_backup_logical_sha256 TEXT CHECK(approved_backup_logical_sha256 IS NULL OR (length(approved_backup_logical_sha256) = 64 AND approved_backup_logical_sha256 NOT GLOB '*[^0-9a-f]*')),
  approved_backup_sha256 TEXT CHECK(approved_backup_sha256 IS NULL OR (length(approved_backup_sha256) = 64 AND approved_backup_sha256 NOT GLOB '*[^0-9a-f]*')),
  approved_backup_path_hash TEXT CHECK(approved_backup_path_hash IS NULL OR (length(approved_backup_path_hash) = 64 AND approved_backup_path_hash NOT GLOB '*[^0-9a-f]*')),
  status TEXT NOT NULL CHECK(status = 'completed'),
  source_row_count INTEGER NOT NULL CHECK(source_row_count >= 0),
  mapped_count INTEGER NOT NULL CHECK(mapped_count >= 0),
  quarantined_count INTEGER NOT NULL CHECK(quarantined_count >= 0),
  intentionally_unmapped_count INTEGER NOT NULL CHECK(intentionally_unmapped_count >= 0),
  started_at INTEGER NOT NULL,
  completed_at INTEGER NOT NULL,
  UNIQUE(transform_version, source_rows_digest),
  CHECK(source_row_count = mapped_count + quarantined_count + intentionally_unmapped_count),
  CHECK(completed_at >= started_at),
  CHECK(approved_backup_logical_sha256 IS NULL OR approved_backup_logical_sha256 = source_database_digest)
);

CREATE TABLE migration_provenance (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(trim(id)) BETWEEN 1 AND 200),
  run_id TEXT NOT NULL REFERENCES migration_runs(id) ON DELETE RESTRICT,
  source_database_digest TEXT NOT NULL CHECK(length(source_database_digest) = 64 AND source_database_digest NOT GLOB '*[^0-9a-f]*'),
  source_table TEXT NOT NULL CHECK(length(trim(source_table)) BETWEEN 1 AND 200),
  source_primary_key TEXT NOT NULL CHECK(length(trim(source_primary_key)) BETWEEN 1 AND 500),
  source_row_hash TEXT NOT NULL CHECK(length(source_row_hash) = 64 AND source_row_hash NOT GLOB '*[^0-9a-f]*'),
  target_entity_type TEXT CHECK(target_entity_type IS NULL OR length(trim(target_entity_type)) BETWEEN 1 AND 100),
  target_id TEXT CHECK(target_id IS NULL OR length(trim(target_id)) BETWEEN 1 AND 200),
  transform_version TEXT NOT NULL CHECK(length(trim(transform_version)) BETWEEN 1 AND 100),
  status TEXT NOT NULL CHECK(status IN ('mapped', 'quarantined', 'intentionally_unmapped')),
  reason_code TEXT CHECK(reason_code IS NULL OR length(trim(reason_code)) BETWEEN 1 AND 100),
  diagnostic TEXT CHECK(diagnostic IS NULL OR length(diagnostic) <= 500),
  created_at INTEGER NOT NULL,
  UNIQUE(source_table, source_primary_key, transform_version),
  CHECK((status = 'mapped') = (target_entity_type IS NOT NULL AND target_id IS NOT NULL)),
  CHECK(status = 'mapped' OR reason_code IS NOT NULL)
);
CREATE INDEX migration_provenance_run_status_idx
  ON migration_provenance(run_id, status, source_table, source_primary_key);
CREATE INDEX migration_provenance_target_idx
  ON migration_provenance(target_entity_type, target_id, transform_version);

CREATE TABLE migration_quarantine (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(trim(id)) BETWEEN 1 AND 200),
  provenance_id TEXT NOT NULL UNIQUE REFERENCES migration_provenance(id) ON DELETE RESTRICT,
  run_id TEXT NOT NULL REFERENCES migration_runs(id) ON DELETE RESTRICT,
  source_table TEXT NOT NULL CHECK(length(trim(source_table)) BETWEEN 1 AND 200),
  source_primary_key TEXT NOT NULL CHECK(length(trim(source_primary_key)) BETWEEN 1 AND 500),
  source_row_hash TEXT NOT NULL CHECK(length(source_row_hash) = 64 AND source_row_hash NOT GLOB '*[^0-9a-f]*'),
  candidate_course_id TEXT CHECK(candidate_course_id IS NULL OR length(trim(candidate_course_id)) BETWEEN 1 AND 200),
  candidate_revision_id TEXT CHECK(candidate_revision_id IS NULL OR length(trim(candidate_revision_id)) BETWEEN 1 AND 200),
  candidate_lesson_id TEXT CHECK(candidate_lesson_id IS NULL OR length(trim(candidate_lesson_id)) BETWEEN 1 AND 200),
  candidate_activity_id TEXT CHECK(candidate_activity_id IS NULL OR length(trim(candidate_activity_id)) BETWEEN 1 AND 200),
  reason_code TEXT NOT NULL CHECK(length(trim(reason_code)) BETWEEN 1 AND 100),
  diagnostic TEXT NOT NULL CHECK(length(diagnostic) BETWEEN 1 AND 500),
  resolution_status TEXT NOT NULL CHECK(resolution_status = 'unresolved'),
  created_at INTEGER NOT NULL,
  UNIQUE(source_table, source_primary_key, provenance_id)
);
CREATE INDEX migration_quarantine_reason_idx
  ON migration_quarantine(reason_code, source_table, source_primary_key);

-- dlh-course-foundations-backfill

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

CREATE TRIGGER course_sections_accepted_insert_guard
BEFORE INSERT ON course_sections WHEN EXISTS (SELECT 1 FROM course_revisions r WHERE r.course_id = NEW.course_id AND r.id = NEW.revision_id AND r.status != 'draft')
BEGIN SELECT RAISE(ABORT, 'accepted course revision descendants are immutable'); END;
CREATE TRIGGER course_sections_accepted_update_guard
BEFORE UPDATE ON course_sections WHEN EXISTS (SELECT 1 FROM course_revisions r WHERE r.course_id = OLD.course_id AND r.id = OLD.revision_id AND r.status != 'draft')
BEGIN SELECT RAISE(ABORT, 'accepted course revision descendants are immutable'); END;
CREATE TRIGGER course_sections_accepted_delete_guard
BEFORE DELETE ON course_sections WHEN EXISTS (SELECT 1 FROM course_revisions r WHERE r.course_id = OLD.course_id AND r.id = OLD.revision_id AND r.status != 'draft')
BEGIN SELECT RAISE(ABORT, 'accepted course revision descendants are immutable'); END;

CREATE TRIGGER course_lessons_accepted_insert_guard
BEFORE INSERT ON course_lessons WHEN EXISTS (SELECT 1 FROM course_revisions r WHERE r.course_id = NEW.course_id AND r.id = NEW.revision_id AND r.status != 'draft')
BEGIN SELECT RAISE(ABORT, 'accepted course revision descendants are immutable'); END;
CREATE TRIGGER course_lessons_accepted_update_guard
BEFORE UPDATE ON course_lessons WHEN EXISTS (SELECT 1 FROM course_revisions r WHERE r.course_id = OLD.course_id AND r.id = OLD.revision_id AND r.status != 'draft')
BEGIN SELECT RAISE(ABORT, 'accepted course revision descendants are immutable'); END;
CREATE TRIGGER course_lessons_accepted_delete_guard
BEFORE DELETE ON course_lessons WHEN EXISTS (SELECT 1 FROM course_revisions r WHERE r.course_id = OLD.course_id AND r.id = OLD.revision_id AND r.status != 'draft')
BEGIN SELECT RAISE(ABORT, 'accepted course revision descendants are immutable'); END;

CREATE TRIGGER course_lesson_prerequisites_accepted_insert_guard
BEFORE INSERT ON course_lesson_prerequisites WHEN EXISTS (SELECT 1 FROM course_revisions r WHERE r.course_id = NEW.course_id AND r.id = NEW.revision_id AND r.status != 'draft')
BEGIN SELECT RAISE(ABORT, 'accepted course revision descendants are immutable'); END;
CREATE TRIGGER course_lesson_prerequisites_accepted_update_guard
BEFORE UPDATE ON course_lesson_prerequisites WHEN EXISTS (SELECT 1 FROM course_revisions r WHERE r.course_id = OLD.course_id AND r.id = OLD.revision_id AND r.status != 'draft')
BEGIN SELECT RAISE(ABORT, 'accepted course revision descendants are immutable'); END;
CREATE TRIGGER course_lesson_prerequisites_accepted_delete_guard
BEFORE DELETE ON course_lesson_prerequisites WHEN EXISTS (SELECT 1 FROM course_revisions r WHERE r.course_id = OLD.course_id AND r.id = OLD.revision_id AND r.status != 'draft')
BEGIN SELECT RAISE(ABORT, 'accepted course revision descendants are immutable'); END;

CREATE TRIGGER course_activities_accepted_insert_guard
BEFORE INSERT ON course_activities WHEN EXISTS (SELECT 1 FROM course_revisions r WHERE r.course_id = NEW.course_id AND r.id = NEW.revision_id AND r.status != 'draft')
BEGIN SELECT RAISE(ABORT, 'accepted course revision descendants are immutable'); END;
CREATE TRIGGER course_activities_accepted_update_guard
BEFORE UPDATE ON course_activities WHEN EXISTS (SELECT 1 FROM course_revisions r WHERE r.course_id = OLD.course_id AND r.id = OLD.revision_id AND r.status != 'draft')
BEGIN SELECT RAISE(ABORT, 'accepted course revision descendants are immutable'); END;
CREATE TRIGGER course_activities_accepted_delete_guard
BEFORE DELETE ON course_activities WHEN EXISTS (SELECT 1 FROM course_revisions r WHERE r.course_id = OLD.course_id AND r.id = OLD.revision_id AND r.status != 'draft')
BEGIN SELECT RAISE(ABORT, 'accepted course revision descendants are immutable'); END;

CREATE TRIGGER course_activity_prerequisites_accepted_insert_guard
BEFORE INSERT ON course_activity_prerequisites WHEN EXISTS (SELECT 1 FROM course_revisions r WHERE r.course_id = NEW.course_id AND r.id = NEW.revision_id AND r.status != 'draft')
BEGIN SELECT RAISE(ABORT, 'accepted course revision descendants are immutable'); END;
CREATE TRIGGER course_activity_prerequisites_accepted_update_guard
BEFORE UPDATE ON course_activity_prerequisites WHEN EXISTS (SELECT 1 FROM course_revisions r WHERE r.course_id = OLD.course_id AND r.id = OLD.revision_id AND r.status != 'draft')
BEGIN SELECT RAISE(ABORT, 'accepted course revision descendants are immutable'); END;
CREATE TRIGGER course_activity_prerequisites_accepted_delete_guard
BEFORE DELETE ON course_activity_prerequisites WHEN EXISTS (SELECT 1 FROM course_revisions r WHERE r.course_id = OLD.course_id AND r.id = OLD.revision_id AND r.status != 'draft')
BEGIN SELECT RAISE(ABORT, 'accepted course revision descendants are immutable'); END;

CREATE TRIGGER source_snapshots_accepted_insert_guard
BEFORE INSERT ON source_snapshots WHEN EXISTS (SELECT 1 FROM course_revisions r WHERE r.course_id = NEW.course_id AND r.id = NEW.revision_id AND r.status != 'draft')
BEGIN SELECT RAISE(ABORT, 'accepted course revision descendants are immutable'); END;
CREATE TRIGGER source_snapshots_immutable_update_guard BEFORE UPDATE ON source_snapshots
BEGIN SELECT RAISE(ABORT, 'source snapshot is immutable'); END;
CREATE TRIGGER source_snapshots_immutable_delete_guard BEFORE DELETE ON source_snapshots
BEGIN SELECT RAISE(ABORT, 'source snapshot is immutable'); END;

CREATE TRIGGER knowledge_capsules_accepted_insert_guard
BEFORE INSERT ON knowledge_capsules WHEN EXISTS (SELECT 1 FROM course_revisions r WHERE r.course_id = NEW.course_id AND r.id = NEW.revision_id AND r.status != 'draft')
BEGIN SELECT RAISE(ABORT, 'accepted course revision descendants are immutable'); END;
CREATE TRIGGER knowledge_capsules_immutable_update_guard BEFORE UPDATE ON knowledge_capsules
BEGIN SELECT RAISE(ABORT, 'knowledge capsule is immutable'); END;
CREATE TRIGGER knowledge_capsules_immutable_delete_guard BEFORE DELETE ON knowledge_capsules
BEGIN SELECT RAISE(ABORT, 'knowledge capsule is immutable'); END;
CREATE TRIGGER knowledge_capsule_sources_immutable_insert_guard
BEFORE INSERT ON knowledge_capsule_sources WHEN EXISTS (SELECT 1 FROM course_revisions r WHERE r.course_id = NEW.course_id AND r.id = NEW.revision_id AND r.status != 'draft')
BEGIN SELECT RAISE(ABORT, 'accepted course revision descendants are immutable'); END;
CREATE TRIGGER knowledge_capsule_sources_immutable_update_guard BEFORE UPDATE ON knowledge_capsule_sources
BEGIN SELECT RAISE(ABORT, 'knowledge capsule source link is immutable'); END;
CREATE TRIGGER knowledge_capsule_sources_immutable_delete_guard BEFORE DELETE ON knowledge_capsule_sources
BEGIN SELECT RAISE(ABORT, 'knowledge capsule source link is immutable'); END;

CREATE TRIGGER adaptation_branches_scope_insert_guard
BEFORE INSERT ON adaptation_branches
WHEN NOT EXISTS (SELECT 1 FROM course_revisions base WHERE base.course_id = NEW.course_id AND base.id = NEW.base_revision_id AND base.status != 'draft')
  OR (NEW.head_revision_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM course_revisions head WHERE head.course_id = NEW.course_id AND head.id = NEW.head_revision_id AND head.branch_kind = 'personal'))
BEGIN SELECT RAISE(ABORT, 'adaptation branch revision scope is invalid'); END;
CREATE TRIGGER adaptation_branches_scope_update_guard
BEFORE UPDATE OF course_id, owner, base_revision_id, head_revision_id ON adaptation_branches
WHEN NEW.course_id IS NOT OLD.course_id OR NEW.owner IS NOT OLD.owner OR NEW.base_revision_id IS NOT OLD.base_revision_id
  OR (NEW.head_revision_id IS NOT OLD.head_revision_id AND NEW.head_revision_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM course_revisions head WHERE head.course_id = NEW.course_id AND head.id = NEW.head_revision_id AND head.branch_kind = 'personal'))
BEGIN SELECT RAISE(ABORT, 'adaptation branch revision scope is invalid'); END;

CREATE TRIGGER session_course_contexts_immutable_update_guard BEFORE UPDATE ON session_course_contexts
BEGIN SELECT RAISE(ABORT, 'session course context is immutable'); END;
CREATE TRIGGER session_course_contexts_immutable_delete_guard BEFORE DELETE ON session_course_contexts
BEGIN SELECT RAISE(ABORT, 'session course context is immutable'); END;
CREATE TRIGGER evidence_facts_append_only_update_guard BEFORE UPDATE ON evidence_facts
BEGIN SELECT RAISE(ABORT, 'evidence fact is append-only'); END;
CREATE TRIGGER evidence_facts_append_only_delete_guard BEFORE DELETE ON evidence_facts
BEGIN SELECT RAISE(ABORT, 'evidence fact is append-only'); END;
CREATE TRIGGER review_items_scope_update_guard
BEFORE UPDATE OF course_id, revision_id, source_evidence_id, kind, scheduler_version, created_at ON review_items
BEGIN SELECT RAISE(ABORT, 'review item source identity is immutable'); END;
CREATE TRIGGER review_items_delete_guard BEFORE DELETE ON review_items
BEGIN SELECT RAISE(ABORT, 'review item is retained as a derived fact'); END;

CREATE TRIGGER migration_runs_append_only_update_guard BEFORE UPDATE ON migration_runs
BEGIN SELECT RAISE(ABORT, 'migration run is append-only'); END;
CREATE TRIGGER migration_runs_append_only_delete_guard BEFORE DELETE ON migration_runs
BEGIN SELECT RAISE(ABORT, 'migration run is append-only'); END;
CREATE TRIGGER migration_provenance_append_only_update_guard BEFORE UPDATE ON migration_provenance
BEGIN SELECT RAISE(ABORT, 'migration provenance is append-only'); END;
CREATE TRIGGER migration_provenance_append_only_delete_guard BEFORE DELETE ON migration_provenance
BEGIN SELECT RAISE(ABORT, 'migration provenance is append-only'); END;
CREATE TRIGGER migration_quarantine_append_only_update_guard BEFORE UPDATE ON migration_quarantine
BEGIN SELECT RAISE(ABORT, 'migration quarantine is append-only'); END;
CREATE TRIGGER migration_quarantine_append_only_delete_guard BEFORE DELETE ON migration_quarantine
BEGIN SELECT RAISE(ABORT, 'migration quarantine is append-only'); END;

CREATE TRIGGER session_snapshots_course_context_insert_guard
BEFORE INSERT ON session_snapshots
WHEN NEW.curriculum_id IS NULL OR NEW.curriculum_version_id IS NULL OR NEW.curriculum_day_id IS NULL
  OR NOT EXISTS (SELECT 1 FROM course_lessons lesson WHERE lesson.course_id = NEW.curriculum_id AND lesson.revision_id = NEW.curriculum_version_id AND lesson.id = NEW.curriculum_day_id)
  OR NOT EXISTS (SELECT 1 FROM learning_sessions session WHERE session.id = NEW.session_id AND session.curriculum_day_v2_id = NEW.curriculum_day_id)
BEGIN SELECT RAISE(ABORT, 'session snapshot course scope is invalid'); END;
CREATE TRIGGER session_snapshots_course_context_insert_sync
AFTER INSERT ON session_snapshots
BEGIN
  INSERT INTO session_course_contexts
    (session_id, course_id, revision_id, lesson_id, session_snapshot_id, snapshot_hash, snapshot_bytes_hash, created_at)
  VALUES
    (NEW.session_id, NEW.curriculum_id, NEW.curriculum_version_id, NEW.curriculum_day_id, NEW.id, NEW.content_hash, dlh_sha256_text(NEW.snapshot_json), NEW.created_at);
END;
CREATE TRIGGER session_snapshots_immutable_update_guard BEFORE UPDATE ON session_snapshots
BEGIN SELECT RAISE(ABORT, 'session snapshot is immutable'); END;
CREATE TRIGGER session_snapshots_immutable_delete_guard BEFORE DELETE ON session_snapshots
BEGIN SELECT RAISE(ABORT, 'session snapshot is immutable'); END;

CREATE TRIGGER versioned_unit_evidence_course_scope_insert_guard
BEFORE INSERT ON versioned_unit_evidence
WHEN NOT EXISTS (
  SELECT 1 FROM session_course_contexts context
  JOIN course_activities activity
    ON activity.course_id = context.course_id AND activity.revision_id = context.revision_id
   AND activity.lesson_id = context.lesson_id AND activity.id = NEW.unit_id
  WHERE context.session_id = NEW.session_id
    AND activity.activity_type = CASE NEW.evidence_type
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
    (id, schema_version, operation_id, course_id, revision_id, lesson_id, session_id, activity_id, evidence_type, question_id, correctness, occurred_at, recorded_at, payload_json, provenance_json)
  SELECT NEW.id, 1, NEW.operation_id, context.course_id, context.revision_id,
         context.lesson_id, NEW.session_id, NEW.unit_id, NEW.evidence_type,
         NEW.question_id, NEW.correctness, NEW.created_at, NEW.created_at,
         NEW.payload_json,
         json_object('kind', 'learner', 'sourceId', NEW.id)
  FROM session_course_contexts context WHERE context.session_id = NEW.session_id;
END;
CREATE TRIGGER versioned_unit_evidence_append_only_update_guard BEFORE UPDATE ON versioned_unit_evidence
BEGIN SELECT RAISE(ABORT, 'versioned evidence is append-only'); END;
CREATE TRIGGER versioned_unit_evidence_append_only_delete_guard BEFORE DELETE ON versioned_unit_evidence
BEGIN SELECT RAISE(ABORT, 'versioned evidence is append-only'); END;


-- The legacy authoring/seed seam remains the writable compatibility surface in
-- M2. Keep its validated rows projected into the additive Course foundation so
-- new disposable data and newly published legacy revisions stay runnable.
CREATE TRIGGER curricula_course_insert_projection
AFTER INSERT ON curricula
BEGIN
  INSERT INTO courses
    (id, stable_id, slug, title, description, primary_locale,
     active_revision_id, created_at, updated_at)
  VALUES
    (NEW.id, NEW.slug, NEW.slug, NEW.title, NEW.description, 'und', NULL,
     NEW.created_at, NEW.updated_at);
END;
CREATE TRIGGER curricula_course_update_projection
AFTER UPDATE OF title, description, active_version_id, updated_at ON curricula
BEGIN
  UPDATE courses
  SET title = NEW.title,
      description = NEW.description,
      active_revision_id = NEW.active_version_id,
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
  VALUES
    (NEW.id, NEW.curriculum_id, NEW.revision, NULL, 'upstream', NEW.status,
     NEW.title, NEW.description, NEW.content_hash, NULL, NEW.created_at,
     NEW.published_at, NEW.archived_at, NEW.updated_at);
END;
CREATE TRIGGER curriculum_versions_course_revision_update_projection
AFTER UPDATE ON curriculum_versions
BEGIN
  UPDATE course_revisions
  SET revision_number = NEW.revision,
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
  FROM curriculum_versions revision WHERE revision.id = NEW.version_id;
END;
CREATE TRIGGER curriculum_weeks_course_section_update_projection
AFTER UPDATE ON curriculum_weeks
BEGIN
  UPDATE course_sections
  SET stable_id = NEW.stable_id,
      order_index = NEW.order_index,
      title = NEW.title,
      description = NEW.description,
      updated_at = NEW.updated_at
  WHERE revision_id = NEW.version_id AND id = NEW.id;
END;

CREATE TRIGGER curriculum_days_v2_course_lesson_reference_insert_guard
BEFORE INSERT ON curriculum_days_v2
WHEN EXISTS (
  SELECT 1 FROM json_each(NEW.prerequisites_json) prerequisite
  WHERE prerequisite.type != 'text'
     OR prerequisite.value = NEW.stable_id
     OR NOT EXISTS (
       SELECT 1 FROM curriculum_days_v2 candidate
       WHERE candidate.version_id = NEW.version_id
         AND candidate.stable_id = prerequisite.value
     )
)
OR (SELECT count(*) FROM json_each(NEW.prerequisites_json)) !=
   (SELECT count(DISTINCT value) FROM json_each(NEW.prerequisites_json))
BEGIN SELECT RAISE(ABORT, 'legacy lesson prerequisite is invalid'); END;
CREATE TRIGGER curriculum_days_v2_course_lesson_reference_update_guard
BEFORE UPDATE OF version_id, stable_id, prerequisites_json ON curriculum_days_v2
WHEN EXISTS (
  SELECT 1 FROM json_each(NEW.prerequisites_json) prerequisite
  WHERE prerequisite.type != 'text'
     OR prerequisite.value = NEW.stable_id
     OR NOT EXISTS (
       SELECT 1 FROM curriculum_days_v2 candidate
       WHERE candidate.version_id = NEW.version_id
         AND candidate.stable_id = prerequisite.value
         AND candidate.id != NEW.id
     )
)
OR (SELECT count(*) FROM json_each(NEW.prerequisites_json)) !=
   (SELECT count(DISTINCT value) FROM json_each(NEW.prerequisites_json))
BEGIN SELECT RAISE(ABORT, 'legacy lesson prerequisite is invalid'); END;
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
  FROM curriculum_versions revision WHERE revision.id = NEW.version_id;
  INSERT INTO course_lesson_prerequisites
    (course_id, revision_id, lesson_id, prerequisite_lesson_id)
  SELECT revision.curriculum_id, NEW.version_id, NEW.id, prerequisite.id
  FROM curriculum_versions revision
  JOIN json_each(NEW.prerequisites_json) reference
  JOIN course_lessons prerequisite
    ON prerequisite.course_id = revision.curriculum_id
   AND prerequisite.revision_id = NEW.version_id
   AND prerequisite.stable_id = reference.value
  WHERE revision.id = NEW.version_id;
END;
CREATE TRIGGER curriculum_days_v2_course_lesson_update_projection
AFTER UPDATE ON curriculum_days_v2
BEGIN
  UPDATE course_lessons
  SET section_id = NEW.week_id,
      stable_id = NEW.stable_id,
      order_index = NEW.order_index,
      title = NEW.title,
      description = COALESCE(NEW.description, NEW.title),
      goal = NEW.goal,
      estimated_minutes = NEW.estimated_minutes,
      expected_outcomes_json = NEW.expected_outcomes_json,
      depth_level = NEW.depth_level,
      out_of_scope_json = NEW.out_of_scope_json,
      topics_json = NEW.topics_json,
      updated_at = NEW.updated_at
  WHERE revision_id = NEW.version_id AND id = NEW.id;
  DELETE FROM course_lesson_prerequisites
  WHERE revision_id = NEW.version_id AND lesson_id = NEW.id;
  INSERT INTO course_lesson_prerequisites
    (course_id, revision_id, lesson_id, prerequisite_lesson_id)
  SELECT revision.curriculum_id, NEW.version_id, NEW.id, prerequisite.id
  FROM curriculum_versions revision
  JOIN json_each(NEW.prerequisites_json) reference
  JOIN course_lessons prerequisite
    ON prerequisite.course_id = revision.curriculum_id
   AND prerequisite.revision_id = NEW.version_id
   AND prerequisite.stable_id = reference.value
  WHERE revision.id = NEW.version_id;
END;

CREATE TRIGGER curriculum_units_course_activity_reference_insert_guard
BEFORE INSERT ON curriculum_units
WHEN EXISTS (
  SELECT 1 FROM json_each(NEW.unlock_rules_json) rule
  WHERE json_extract(rule.value, '$.type') != 'unit-completed'
     OR json_extract(rule.value, '$.unitId') = NEW.stable_id
     OR NOT EXISTS (
       SELECT 1 FROM curriculum_units candidate
       WHERE candidate.version_id = NEW.version_id
         AND candidate.day_id = NEW.day_id
         AND candidate.stable_id = json_extract(rule.value, '$.unitId')
     )
)
OR (SELECT count(*) FROM json_each(NEW.unlock_rules_json)) !=
   (SELECT count(DISTINCT json_extract(value, '$.unitId'))
    FROM json_each(NEW.unlock_rules_json))
BEGIN SELECT RAISE(ABORT, 'legacy activity prerequisite is invalid'); END;
CREATE TRIGGER curriculum_units_course_activity_reference_update_guard
BEFORE UPDATE OF version_id, day_id, stable_id, unlock_rules_json ON curriculum_units
WHEN EXISTS (
  SELECT 1 FROM json_each(NEW.unlock_rules_json) rule
  WHERE json_extract(rule.value, '$.type') != 'unit-completed'
     OR json_extract(rule.value, '$.unitId') = NEW.stable_id
     OR NOT EXISTS (
       SELECT 1 FROM curriculum_units candidate
       WHERE candidate.version_id = NEW.version_id
         AND candidate.day_id = NEW.day_id
         AND candidate.stable_id = json_extract(rule.value, '$.unitId')
         AND candidate.id != NEW.id
     )
)
OR (SELECT count(*) FROM json_each(NEW.unlock_rules_json)) !=
   (SELECT count(DISTINCT json_extract(value, '$.unitId'))
    FROM json_each(NEW.unlock_rules_json))
BEGIN SELECT RAISE(ABORT, 'legacy activity prerequisite is invalid'); END;
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
  FROM curriculum_versions revision WHERE revision.id = NEW.version_id;
  INSERT INTO course_activity_prerequisites
    (course_id, revision_id, lesson_id, activity_id,
     prerequisite_activity_id)
  SELECT revision.curriculum_id, NEW.version_id, NEW.day_id, NEW.id,
         prerequisite.id
  FROM curriculum_versions revision
  JOIN json_each(NEW.unlock_rules_json) rule
  JOIN course_activities prerequisite
    ON prerequisite.course_id = revision.curriculum_id
   AND prerequisite.revision_id = NEW.version_id
   AND prerequisite.lesson_id = NEW.day_id
   AND prerequisite.stable_id = json_extract(rule.value, '$.unitId')
  WHERE revision.id = NEW.version_id;
END;
CREATE TRIGGER curriculum_units_course_activity_update_projection
AFTER UPDATE ON curriculum_units
BEGIN
  UPDATE course_activities
  SET lesson_id = NEW.day_id,
      stable_id = NEW.stable_id,
      activity_type = NEW.type,
      order_index = NEW.order_index,
      title = NEW.title,
      description = COALESCE(NEW.description, NEW.title),
      estimated_minutes = NEW.estimated_minutes,
      required = CASE NEW.optional WHEN 0 THEN 1 ELSE 0 END,
      objectives_json = NEW.objectives_json,
      checklist_json = NEW.checklist_json,
      sources_json = NEW.sources_json,
      questions_json = NEW.questions_json,
      misconceptions_json = NEW.misconceptions_json,
      completion_criteria_json = NEW.completion_criteria_json,
      payload_json = NEW.payload_json,
      protected_material_json = json_object(
        'referenceAnswer',
        CASE WHEN NEW.reference_answer_json IS NULL
          THEN NULL ELSE json(NEW.reference_answer_json) END,
        'questions', json(NEW.questions_json)
      ),
      depth_level = NEW.depth_level,
      updated_at = NEW.updated_at
  WHERE revision_id = NEW.version_id AND id = NEW.id;
  DELETE FROM course_activity_prerequisites
  WHERE revision_id = NEW.version_id AND activity_id = NEW.id;
  INSERT INTO course_activity_prerequisites
    (course_id, revision_id, lesson_id, activity_id,
     prerequisite_activity_id)
  SELECT revision.curriculum_id, NEW.version_id, NEW.day_id, NEW.id,
         prerequisite.id
  FROM curriculum_versions revision
  JOIN json_each(NEW.unlock_rules_json) rule
  JOIN course_activities prerequisite
    ON prerequisite.course_id = revision.curriculum_id
   AND prerequisite.revision_id = NEW.version_id
   AND prerequisite.lesson_id = NEW.day_id
   AND prerequisite.stable_id = json_extract(rule.value, '$.unitId')
  WHERE revision.id = NEW.version_id;
END;