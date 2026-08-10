CREATE TABLE provider_hub_connections (
  connection_id TEXT PRIMARY KEY NOT NULL CHECK(length(trim(connection_id)) BETWEEN 1 AND 200),
  adapter_id TEXT NOT NULL CHECK(adapter_id IN ('mock', 'opencode', 'codex', 'pi')),
  provider_type TEXT NOT NULL CHECK(length(trim(provider_type)) BETWEEN 1 AND 100),
  display_name TEXT NOT NULL CHECK(length(trim(display_name)) BETWEEN 1 AND 200),
  credential_ref TEXT CHECK(credential_ref IS NULL OR length(trim(credential_ref)) BETWEEN 1 AND 200),
  endpoint_profile_id TEXT CHECK(endpoint_profile_id IS NULL OR length(trim(endpoint_profile_id)) BETWEEN 1 AND 200),
  enabled INTEGER NOT NULL CHECK(enabled IN (0, 1)),
  external INTEGER NOT NULL CHECK(external IN (0, 1)),
  state TEXT NOT NULL CHECK(state IN ('disabled', 'starting', 'connected', 'degraded', 'authentication-required', 'unavailable', 'misconfigured', 'error')),
  observed_capabilities_json TEXT CHECK(observed_capabilities_json IS NULL OR (json_valid(observed_capabilities_json) AND json_type(observed_capabilities_json) = 'object')),
  last_checked_at TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX provider_hub_connections_adapter_idx
  ON provider_hub_connections(adapter_id, enabled);

CREATE TABLE provider_hub_role_profiles (
  role TEXT PRIMARY KEY NOT NULL CHECK(role IN ('course-designer', 'tutor', 'evaluator', 'reviewer')),
  mode TEXT NOT NULL CHECK(mode IN ('no-ai', 'connection')),
  connection_id TEXT REFERENCES provider_hub_connections(connection_id) ON DELETE RESTRICT,
  model_id TEXT,
  required_capabilities_json TEXT NOT NULL CHECK(json_valid(required_capabilities_json) AND json_type(required_capabilities_json) = 'array'),
  tool_policy_id TEXT NOT NULL CHECK(length(trim(tool_policy_id)) BETWEEN 1 AND 200),
  budgets_json TEXT NOT NULL CHECK(json_valid(budgets_json) AND json_type(budgets_json) = 'object'),
  updated_at INTEGER NOT NULL,
  CHECK(
    (mode = 'no-ai' AND connection_id IS NULL AND model_id IS NULL) OR
    (mode = 'connection' AND connection_id IS NOT NULL AND length(trim(model_id)) BETWEEN 1 AND 300)
  )
);

CREATE TABLE provider_hub_tool_policies (
  tool_policy_id TEXT PRIMARY KEY NOT NULL CHECK(length(trim(tool_policy_id)) BETWEEN 1 AND 200),
  role TEXT NOT NULL CHECK(role IN ('course-designer', 'tutor', 'evaluator', 'reviewer')),
  allowed_tools_json TEXT NOT NULL CHECK(json_valid(allowed_tools_json) AND json_type(allowed_tools_json) = 'array'),
  updated_at INTEGER NOT NULL
);

CREATE TABLE ai_disclosure_operations (
  operation_id TEXT PRIMARY KEY NOT NULL CHECK(length(trim(operation_id)) BETWEEN 1 AND 200),
  role TEXT NOT NULL CHECK(role IN ('course-designer', 'tutor', 'evaluator', 'reviewer')),
  connection_id TEXT NOT NULL REFERENCES provider_hub_connections(connection_id) ON DELETE RESTRICT,
  provider_type TEXT NOT NULL CHECK(length(trim(provider_type)) BETWEEN 1 AND 100),
  model_id TEXT NOT NULL CHECK(length(trim(model_id)) BETWEEN 1 AND 300),
  destination TEXT NOT NULL CHECK(length(trim(destination)) BETWEEN 1 AND 500),
  payload_categories_json TEXT NOT NULL CHECK(json_valid(payload_categories_json) AND json_type(payload_categories_json) = 'array'),
  entity_ids_json TEXT NOT NULL CHECK(json_valid(entity_ids_json) AND json_type(entity_ids_json) = 'object'),
  exclusions_json TEXT NOT NULL CHECK(json_valid(exclusions_json) AND json_type(exclusions_json) = 'array'),
  byte_count INTEGER NOT NULL CHECK(byte_count BETWEEN 0 AND 2500000),
  payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256) = 71 AND substr(payload_sha256, 1, 7) = 'sha256:' AND substr(payload_sha256, 8) NOT GLOB '*[^0-9a-f]*'),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX ai_disclosure_operations_connection_idx
  ON ai_disclosure_operations(connection_id, created_at);

CREATE TABLE ai_disclosure_events (
  operation_id TEXT NOT NULL REFERENCES ai_disclosure_operations(operation_id) ON DELETE RESTRICT,
  sequence INTEGER NOT NULL CHECK(sequence >= 0),
  status TEXT NOT NULL CHECK(status IN ('pending', 'approved', 'cancelled', 'consumed', 'expired')),
  occurred_at TEXT NOT NULL,
  PRIMARY KEY(operation_id, sequence)
);
CREATE INDEX ai_disclosure_events_status_idx
  ON ai_disclosure_events(status, occurred_at);

CREATE TABLE provider_turn_provenance (
  operation_id TEXT PRIMARY KEY NOT NULL CHECK(length(trim(operation_id)) BETWEEN 1 AND 200),
  connection_id TEXT NOT NULL REFERENCES provider_hub_connections(connection_id) ON DELETE RESTRICT,
  provider_type TEXT NOT NULL CHECK(length(trim(provider_type)) BETWEEN 1 AND 100),
  adapter_id TEXT NOT NULL CHECK(adapter_id IN ('mock', 'opencode', 'codex', 'pi')),
  model_id TEXT NOT NULL CHECK(length(trim(model_id)) BETWEEN 1 AND 300),
  role TEXT NOT NULL CHECK(role IN ('course-designer', 'tutor', 'evaluator', 'reviewer')),
  tool_policy_id TEXT NOT NULL CHECK(length(trim(tool_policy_id)) BETWEEN 1 AND 200),
  capability_observed_at TEXT,
  disclosure_operation_id TEXT REFERENCES ai_disclosure_operations(operation_id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK(status IN ('started', 'completed', 'failed', 'cancelled')),
  failure_code TEXT,
  metadata_json TEXT CHECK(metadata_json IS NULL OR (json_valid(metadata_json) AND json_type(metadata_json) = 'object')),
  created_at TEXT NOT NULL,
  completed_at TEXT,
  CHECK(
    (status = 'started' AND completed_at IS NULL AND failure_code IS NULL) OR
    (status = 'completed' AND completed_at IS NOT NULL AND failure_code IS NULL) OR
    (status IN ('failed', 'cancelled') AND completed_at IS NOT NULL)
  )
);
CREATE INDEX provider_turn_provenance_connection_idx
  ON provider_turn_provenance(connection_id, created_at);

CREATE TRIGGER ai_disclosure_operations_immutable_update
BEFORE UPDATE ON ai_disclosure_operations
BEGIN SELECT RAISE(ABORT, 'AI disclosure operation is immutable'); END;
CREATE TRIGGER ai_disclosure_operations_immutable_delete
BEFORE DELETE ON ai_disclosure_operations
BEGIN SELECT RAISE(ABORT, 'AI disclosure operation is immutable'); END;
CREATE TRIGGER ai_disclosure_events_immutable_update
BEFORE UPDATE ON ai_disclosure_events
BEGIN SELECT RAISE(ABORT, 'AI disclosure event is immutable'); END;
CREATE TRIGGER ai_disclosure_events_immutable_delete
BEFORE DELETE ON ai_disclosure_events
BEGIN SELECT RAISE(ABORT, 'AI disclosure event is immutable'); END;
CREATE TRIGGER provider_turn_provenance_terminal_update
BEFORE UPDATE ON provider_turn_provenance
WHEN NOT (
  OLD.status = 'started' AND
  NEW.status IN ('completed', 'failed', 'cancelled') AND
  OLD.operation_id IS NEW.operation_id AND
  OLD.connection_id IS NEW.connection_id AND
  OLD.provider_type IS NEW.provider_type AND
  OLD.adapter_id IS NEW.adapter_id AND
  OLD.model_id IS NEW.model_id AND
  OLD.role IS NEW.role AND
  OLD.tool_policy_id IS NEW.tool_policy_id AND
  OLD.capability_observed_at IS NEW.capability_observed_at AND
  OLD.disclosure_operation_id IS NEW.disclosure_operation_id AND
  OLD.metadata_json IS NEW.metadata_json AND
  OLD.created_at IS NEW.created_at
)
BEGIN SELECT RAISE(ABORT, 'Provider turn provenance is immutable'); END;
CREATE TRIGGER provider_turn_provenance_immutable_delete
BEFORE DELETE ON provider_turn_provenance
BEGIN SELECT RAISE(ABORT, 'Provider turn provenance is immutable'); END;
