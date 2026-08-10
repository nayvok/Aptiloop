CREATE TABLE environment_packs (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(trim(id)) BETWEEN 1 AND 200),
  version TEXT NOT NULL CHECK(length(trim(version)) BETWEEN 1 AND 100),
  digest TEXT NOT NULL UNIQUE CHECK(
    length(digest) = 71 AND digest GLOB 'sha256:*'
    AND substr(digest, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  runtime_kind TEXT NOT NULL CHECK(runtime_kind IN ('node', 'python')),
  runtime_version TEXT NOT NULL CHECK(length(trim(runtime_version)) BETWEEN 1 AND 100),
  manifest_json TEXT NOT NULL CHECK(json_valid(manifest_json)),
  trust_mode TEXT NOT NULL CHECK(trust_mode = 'trusted-local-unsandboxed'),
  network_policy TEXT NOT NULL CHECK(network_policy = 'inherit-local-trusted'),
  installed_at INTEGER NOT NULL,
  UNIQUE(id, version)
) WITHOUT ROWID;

CREATE TABLE trusted_checks (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(trim(id)) BETWEEN 1 AND 200),
  environment_id TEXT NOT NULL REFERENCES environment_packs(id) ON DELETE RESTRICT,
  contract_version INTEGER NOT NULL CHECK(contract_version = 1),
  result_kind TEXT NOT NULL CHECK(result_kind IN ('tests', 'static-analysis', 'build')),
  descriptor_json TEXT NOT NULL CHECK(json_valid(descriptor_json)),
  UNIQUE(environment_id, id)
) WITHOUT ROWID;

INSERT INTO environment_packs
  (id, version, digest, runtime_kind, runtime_version, manifest_json,
   trust_mode, network_policy, installed_at)
VALUES
  ('apt.compat.node24.local.v1', '1.0.0',
   'sha256:8a714b40eb7d8c64ea6ef2844577bbffd509f7edf7225b2bd26bd2656a0b68b8',
   'node', '24',
   '{"schemaVersion":1,"id":"apt.compat.node24.local.v1","version":"1.0.0","runtime":{"kind":"node","version":"24","lockfile":"package-lock.json","isolated":false},"checks":[{"id":"apt.compat.node24.npm-test.v1","contractVersion":1,"title":"Compatibility Node test","resultKind":"tests","artifactTypes":["process-log"]}],"network":"inherit-local-trusted","trust":"trusted-local-unsandboxed"}',
   'trusted-local-unsandboxed', 'inherit-local-trusted', 0),
  ('apt.core.node24.local.v1', '1.0.0',
   'sha256:8a54430d47e8ef44ed5ef81de311f7d240901fad4631f82f66943a6f2a56d72b',
   'node', '24',
   '{"schemaVersion":1,"id":"apt.core.node24.local.v1","version":"1.0.0","runtime":{"kind":"node","version":"24","lockfile":"package-lock.json","isolated":true},"checks":[{"id":"apt.core.node24.node-test.v1","contractVersion":1,"title":"Node built-in test runner","resultKind":"tests","artifactTypes":["process-log"]}],"network":"inherit-local-trusted","trust":"trusted-local-unsandboxed"}',
   'trusted-local-unsandboxed', 'inherit-local-trusted', 0),
  ('apt.core.python3.local.v1', '1.0.0',
   'sha256:ec0c0cf06e3df5e426bd8733158347debea819b8e3a8c5f30370814e66520125',
   'python', '3',
   '{"schemaVersion":1,"id":"apt.core.python3.local.v1","version":"1.0.0","runtime":{"kind":"python","version":"3","lockfile":"requirements.lock","isolated":true},"checks":[{"id":"apt.core.python3.unittest.v1","contractVersion":1,"title":"Python unittest","resultKind":"tests","artifactTypes":["process-log"]}],"network":"inherit-local-trusted","trust":"trusted-local-unsandboxed"}',
   'trusted-local-unsandboxed', 'inherit-local-trusted', 0);

INSERT INTO trusted_checks
  (id, environment_id, contract_version, result_kind, descriptor_json)
VALUES
  ('apt.compat.node24.npm-test.v1', 'apt.compat.node24.local.v1', 1, 'tests',
   '{"id":"apt.compat.node24.npm-test.v1","contractVersion":1,"title":"Compatibility Node test","resultKind":"tests","artifactTypes":["process-log"]}'),
  ('apt.core.node24.node-test.v1', 'apt.core.node24.local.v1', 1, 'tests',
   '{"id":"apt.core.node24.node-test.v1","contractVersion":1,"title":"Node built-in test runner","resultKind":"tests","artifactTypes":["process-log"]}'),
  ('apt.core.python3.unittest.v1', 'apt.core.python3.local.v1', 1, 'tests',
   '{"id":"apt.core.python3.unittest.v1","contractVersion":1,"title":"Python unittest","resultKind":"tests","artifactTypes":["process-log"]}');

ALTER TABLE exercise_attempts ADD COLUMN environment_id TEXT;
ALTER TABLE exercise_attempts ADD COLUMN workspace_handle_id TEXT;
ALTER TABLE exercise_attempts ADD COLUMN workspace_generation INTEGER;
ALTER TABLE exercise_attempts ADD COLUMN source_snapshot_hash TEXT;
UPDATE exercise_attempts
SET environment_id = 'apt.compat.node24.local.v1',
    workspace_handle_id = lower(hex(randomblob(16))),
    workspace_generation = 1,
    source_snapshot_hash = 'git-commit:' || baseline_hash;
CREATE UNIQUE INDEX exercise_attempts_workspace_handle_uq
  ON exercise_attempts(workspace_handle_id);

ALTER TABLE test_runs ADD COLUMN check_id TEXT;
ALTER TABLE test_runs ADD COLUMN environment_id TEXT;
ALTER TABLE test_runs ADD COLUMN environment_pack_digest TEXT;
ALTER TABLE test_runs ADD COLUMN backend_id TEXT;
ALTER TABLE test_runs ADD COLUMN input_snapshot_hash TEXT;
ALTER TABLE test_runs ADD COLUMN result_json TEXT;
UPDATE test_runs
SET check_id = 'apt.compat.node24.npm-test.v1',
    environment_id = 'apt.compat.node24.local.v1',
    backend_id = 'local-native',
    environment_pack_digest = 'sha256:8a714b40eb7d8c64ea6ef2844577bbffd509f7edf7225b2bd26bd2656a0b68b8',
    input_snapshot_hash = CASE
      WHEN diff_fingerprint IS NULL THEN NULL
      ELSE 'legacy-git-diff:' || diff_fingerprint
    END;

ALTER TABLE reviews ADD COLUMN operation_id TEXT;
CREATE UNIQUE INDEX reviews_operation_id_uq
  ON reviews(operation_id) WHERE operation_id IS NOT NULL;

CREATE TABLE execution_artifacts (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(trim(id)) BETWEEN 1 AND 500),
  test_run_id TEXT NOT NULL REFERENCES test_runs(id) ON DELETE RESTRICT,
  artifact_type TEXT NOT NULL CHECK(artifact_type IN ('process-log', 'check-report')),
  media_type TEXT NOT NULL CHECK(length(trim(media_type)) BETWEEN 1 AND 200),
  digest TEXT NOT NULL CHECK(
    length(digest) = 71 AND digest GLOB 'sha256:*'
    AND substr(digest, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  size_bytes INTEGER NOT NULL CHECK(size_bytes >= 0),
  retention TEXT NOT NULL CHECK(retention = 'attempt'),
  truncated INTEGER NOT NULL CHECK(truncated IN (0, 1)),
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(test_run_id, id)
) WITHOUT ROWID;

CREATE TABLE review_evidence_bundles (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(trim(id)) BETWEEN 1 AND 200),
  review_id TEXT NOT NULL UNIQUE REFERENCES reviews(id) ON DELETE RESTRICT,
  exercise_attempt_id TEXT NOT NULL REFERENCES exercise_attempts(id) ON DELETE RESTRICT,
  test_run_id TEXT NOT NULL REFERENCES test_runs(id) ON DELETE RESTRICT,
  workspace_snapshot_hash TEXT NOT NULL CHECK(
    length(workspace_snapshot_hash) = 71
    AND workspace_snapshot_hash GLOB 'sha256:*'
    AND substr(workspace_snapshot_hash, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  diff_fingerprint TEXT NOT NULL,
  bundle_sha256 TEXT NOT NULL CHECK(
    length(bundle_sha256) = 71 AND bundle_sha256 GLOB 'sha256:*'
    AND substr(bundle_sha256, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  bundle_json TEXT NOT NULL CHECK(json_valid(bundle_json)),
  created_at INTEGER NOT NULL
) WITHOUT ROWID;

CREATE TABLE execution_migration_quarantine (
  source_table TEXT NOT NULL,
  source_id TEXT NOT NULL,
  reason_code TEXT NOT NULL CHECK(length(trim(reason_code)) BETWEEN 1 AND 100),
  source_snapshot_json TEXT NOT NULL CHECK(json_valid(source_snapshot_json)),
  quarantined_at INTEGER NOT NULL,
  PRIMARY KEY (source_table, source_id)
) WITHOUT ROWID;

INSERT INTO execution_migration_quarantine
  (source_table, source_id, reason_code, source_snapshot_json, quarantined_at)
SELECT 'test_runs', id, 'missing-complete-workspace-snapshot',
       json_object('id', id, 'exerciseAttemptId', exercise_attempt_id,
                   'operationId', operation_id, 'status', status,
                   'diffFingerprint', diff_fingerprint),
       COALESCE(completed_at, started_at)
FROM test_runs
WHERE input_snapshot_hash IS NULL OR input_snapshot_hash LIKE 'legacy-git-diff:%';

CREATE TRIGGER environment_packs_immutable_update_guard
BEFORE UPDATE ON environment_packs
BEGIN SELECT RAISE(ABORT, 'Environment Pack is immutable'); END;
CREATE TRIGGER environment_packs_immutable_delete_guard
BEFORE DELETE ON environment_packs
BEGIN SELECT RAISE(ABORT, 'Environment Pack is immutable'); END;
CREATE TRIGGER trusted_checks_immutable_update_guard
BEFORE UPDATE ON trusted_checks
BEGIN SELECT RAISE(ABORT, 'Trusted check is immutable'); END;
CREATE TRIGGER trusted_checks_immutable_delete_guard
BEFORE DELETE ON trusted_checks
BEGIN SELECT RAISE(ABORT, 'Trusted check is immutable'); END;
CREATE TRIGGER execution_artifacts_immutable_update_guard
BEFORE UPDATE ON execution_artifacts
BEGIN SELECT RAISE(ABORT, 'Execution artifact is immutable'); END;
CREATE TRIGGER execution_artifacts_immutable_delete_guard
BEFORE DELETE ON execution_artifacts
BEGIN SELECT RAISE(ABORT, 'Execution artifact is immutable'); END;
CREATE TRIGGER review_evidence_bundles_immutable_update_guard
BEFORE UPDATE ON review_evidence_bundles
BEGIN SELECT RAISE(ABORT, 'Review evidence bundle is immutable'); END;
CREATE TRIGGER review_evidence_bundles_immutable_delete_guard
BEFORE DELETE ON review_evidence_bundles
BEGIN SELECT RAISE(ABORT, 'Review evidence bundle is immutable'); END;
CREATE TRIGGER execution_migration_quarantine_immutable_update_guard
BEFORE UPDATE ON execution_migration_quarantine
BEGIN SELECT RAISE(ABORT, 'Execution migration quarantine is immutable'); END;
CREATE TRIGGER execution_migration_quarantine_immutable_delete_guard
BEFORE DELETE ON execution_migration_quarantine
BEGIN SELECT RAISE(ABORT, 'Execution migration quarantine is immutable'); END;

