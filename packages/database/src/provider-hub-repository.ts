import {
  AiDisclosureSchema,
  ProviderCapabilityProfileSchema,
  ProviderConnectionSchema,
  ProviderTurnProvenanceSchema,
  RoleProfileSchema,
  ToolPolicySchema,
  type AiDisclosure,
  type AiDisclosureStatus,
  type ProviderConnection,
  type ProviderHubFailureCode,
  type ProviderTurnProvenance,
  type RoleProfile,
  type ToolPolicy,
} from "@aptiloop/shared";

import type { DatabaseConnection } from "./database.js";

interface ProviderConnectionRow {
  connection_id: string;
  adapter_id: string;
  provider_type: string;
  display_name: string;
  credential_ref: string | null;
  endpoint_profile_id: string | null;
  enabled: number;
  external: number;
  state: string;
  observed_capabilities_json: string | null;
  last_checked_at: string | null;
}

interface RoleProfileRow {
  role: string;
  mode: string;
  connection_id: string | null;
  model_id: string | null;
  required_capabilities_json: string;
  tool_policy_id: string;
  budgets_json: string;
}

interface ToolPolicyRow {
  tool_policy_id: string;
  role: string;
  allowed_tools_json: string;
}

interface DisclosureRow {
  operation_id: string;
  role: string;
  connection_id: string;
  provider_type: string;
  model_id: string;
  destination: string;
  payload_categories_json: string;
  entity_ids_json: string;
  exclusions_json: string;
  byte_count: number;
  payload_sha256: string;
  created_at: string;
  expires_at: string;
  status: string;
  occurred_at: string;
  sequence: number;
}

export class ProviderHubRepository {
  readonly #connection: DatabaseConnection;

  constructor(connection: DatabaseConnection) {
    this.#connection = connection;
  }

  saveConnection(input: ProviderConnection): ProviderConnection {
    const connection = ProviderConnectionSchema.parse(input);
    const now = Date.now();
    this.#connection.sqlite
      .prepare(
        `INSERT INTO provider_hub_connections
          (connection_id, adapter_id, provider_type, display_name,
           credential_ref, endpoint_profile_id, enabled, external, state,
           observed_capabilities_json, last_checked_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(connection_id) DO UPDATE SET
           adapter_id = excluded.adapter_id,
           provider_type = excluded.provider_type,
           display_name = excluded.display_name,
           credential_ref = excluded.credential_ref,
           endpoint_profile_id = excluded.endpoint_profile_id,
           enabled = excluded.enabled,
           external = excluded.external,
           state = excluded.state,
           observed_capabilities_json = excluded.observed_capabilities_json,
           last_checked_at = excluded.last_checked_at,
           updated_at = excluded.updated_at`,
      )
      .run(
        connection.connectionId,
        connection.adapterId,
        connection.providerType,
        connection.displayName,
        connection.credentialRef,
        connection.endpointProfileId,
        connection.enabled ? 1 : 0,
        connection.external ? 1 : 0,
        connection.state,
        connection.observedCapabilities
          ? JSON.stringify(connection.observedCapabilities)
          : null,
        connection.lastCheckedAt,
        now,
        now,
      );
    return connection;
  }

  listConnections(): ProviderConnection[] {
    const rows = this.#connection.sqlite
      .prepare(
        `SELECT connection_id, adapter_id, provider_type, display_name,
                credential_ref, endpoint_profile_id, enabled, external, state,
                observed_capabilities_json, last_checked_at
         FROM provider_hub_connections
         ORDER BY display_name, connection_id`,
      )
      .all() as unknown as ProviderConnectionRow[];
    return rows.map(toProviderConnection);
  }

  saveRoleProfile(input: RoleProfile): RoleProfile {
    const profile = RoleProfileSchema.parse(input);
    this.#connection.sqlite
      .prepare(
        `INSERT INTO provider_hub_role_profiles
          (role, mode, connection_id, model_id, required_capabilities_json,
           tool_policy_id, budgets_json, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(role) DO UPDATE SET
           mode = excluded.mode,
           connection_id = excluded.connection_id,
           model_id = excluded.model_id,
           required_capabilities_json = excluded.required_capabilities_json,
           tool_policy_id = excluded.tool_policy_id,
           budgets_json = excluded.budgets_json,
           updated_at = excluded.updated_at`,
      )
      .run(
        profile.role,
        profile.mode,
        profile.connectionId,
        profile.modelId,
        JSON.stringify(profile.requiredCapabilities),
        profile.toolPolicyId,
        JSON.stringify(profile.budgets),
        Date.now(),
      );
    return profile;
  }

  listRoleProfiles(): RoleProfile[] {
    const rows = this.#connection.sqlite
      .prepare(
        `SELECT role, mode, connection_id, model_id,
                required_capabilities_json, tool_policy_id, budgets_json
         FROM provider_hub_role_profiles ORDER BY role`,
      )
      .all() as unknown as RoleProfileRow[];
    return rows.map((row) =>
      RoleProfileSchema.parse({
        role: row.role,
        mode: row.mode,
        connectionId: row.connection_id,
        modelId: row.model_id,
        requiredCapabilities: JSON.parse(row.required_capabilities_json),
        toolPolicyId: row.tool_policy_id,
        budgets: JSON.parse(row.budgets_json),
      }),
    );
  }

  saveToolPolicy(input: ToolPolicy): ToolPolicy {
    const policy = ToolPolicySchema.parse(input);
    this.#connection.sqlite
      .prepare(
        `INSERT INTO provider_hub_tool_policies
          (tool_policy_id, role, allowed_tools_json, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(tool_policy_id) DO UPDATE SET
           role = excluded.role,
           allowed_tools_json = excluded.allowed_tools_json,
           updated_at = excluded.updated_at`,
      )
      .run(
        policy.toolPolicyId,
        policy.role,
        JSON.stringify(policy.allowedTools),
        Date.now(),
      );
    return policy;
  }

  listToolPolicies(): ToolPolicy[] {
    const rows = this.#connection.sqlite
      .prepare(
        `SELECT tool_policy_id, role, allowed_tools_json
         FROM provider_hub_tool_policies ORDER BY tool_policy_id`,
      )
      .all() as unknown as ToolPolicyRow[];
    return rows.map((row) =>
      ToolPolicySchema.parse({
        toolPolicyId: row.tool_policy_id,
        role: row.role,
        allowedTools: JSON.parse(row.allowed_tools_json),
      }),
    );
  }

  createDisclosure(input: AiDisclosure): AiDisclosure {
    const disclosure = AiDisclosureSchema.parse(input);
    if (disclosure.status !== "pending") {
      throw new Error("A disclosure operation must start pending");
    }
    if (disclosure.approvedAt !== null || disclosure.consumedAt !== null) {
      throw new Error("A pending disclosure cannot have approval timestamps");
    }
    const { scope } = disclosure;
    this.#transaction(() => {
      this.#connection.sqlite
        .prepare(
          `INSERT INTO ai_disclosure_operations
            (operation_id, role, connection_id, provider_type, model_id,
             destination, payload_categories_json, entity_ids_json,
             exclusions_json, byte_count, payload_sha256, created_at, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          disclosure.operationId,
          scope.role,
          scope.connectionId,
          scope.providerType,
          scope.modelId,
          scope.destination,
          JSON.stringify(scope.payloadCategories),
          JSON.stringify(scope.entityIds),
          JSON.stringify(scope.exclusions),
          scope.byteCount,
          scope.payloadSha256,
          disclosure.createdAt,
          disclosure.expiresAt,
        );
      this.#appendDisclosureEvent(
        disclosure.operationId,
        0,
        "pending",
        disclosure.createdAt,
      );
    });
    return disclosure;
  }

  getDisclosure(operationId: string): AiDisclosure | null {
    const row = this.#connection.sqlite
      .prepare(
        `SELECT operation.operation_id, operation.role, operation.connection_id,
                operation.provider_type, operation.model_id,
                operation.destination, operation.payload_categories_json,
                operation.entity_ids_json, operation.exclusions_json,
                operation.byte_count, operation.payload_sha256,
                operation.created_at, operation.expires_at,
                event.status, event.occurred_at, event.sequence
         FROM ai_disclosure_operations operation
         JOIN ai_disclosure_events event
           ON event.operation_id = operation.operation_id
         WHERE operation.operation_id = ?
         ORDER BY event.sequence DESC LIMIT 1`,
      )
      .get(operationId) as DisclosureRow | undefined;
    return row ? this.#toDisclosure(row) : null;
  }

  findPendingDisclosures(input: {
    role: AiDisclosure["scope"]["role"];
    payloadSha256: AiDisclosure["scope"]["payloadSha256"];
    connectionId: string;
    providerType: string;
    modelId: string;
    entityIds: Readonly<Record<string, string>>;
    now: string;
  }): AiDisclosure[] {
    const rows = this.#connection.sqlite
      .prepare(
        `SELECT operation.operation_id AS operationId
         FROM ai_disclosure_operations operation
         JOIN ai_disclosure_events event
           ON event.operation_id = operation.operation_id
         WHERE operation.role = ?
           AND operation.payload_sha256 = ?
           AND operation.connection_id = ?
           AND operation.provider_type = ?
           AND operation.model_id = ?
           AND operation.entity_ids_json = ?
           AND operation.expires_at > ?
           AND event.sequence = (
             SELECT MAX(latest.sequence)
             FROM ai_disclosure_events latest
             WHERE latest.operation_id = operation.operation_id
           )
           AND event.status = 'pending'
         ORDER BY operation.created_at ASC, operation.operation_id ASC
         LIMIT 2`,
      )
      .all(
        input.role,
        input.payloadSha256,
        input.connectionId,
        input.providerType,
        input.modelId,
        JSON.stringify(input.entityIds),
        input.now,
      ) as unknown as Array<{ operationId: string }>;
    return rows.map(({ operationId }) => {
      const disclosure = this.getDisclosure(operationId);
      if (!disclosure) {
        throw new Error(`Unknown disclosure operation: ${operationId}`);
      }
      return disclosure;
    });
  }

  approveDisclosure(operationId: string, occurredAt: string): AiDisclosure {
    return this.#transitionDisclosure(
      operationId,
      "pending",
      "approved",
      occurredAt,
    );
  }

  cancelDisclosure(operationId: string, occurredAt: string): AiDisclosure {
    return this.#transitionDisclosure(
      operationId,
      "pending",
      "cancelled",
      occurredAt,
    );
  }

  consumeDisclosure(operationId: string, occurredAt: string): AiDisclosure {
    return this.#transitionDisclosure(
      operationId,
      "approved",
      "consumed",
      occurredAt,
    );
  }

  dispatchProviderTurn(
    provenanceInput: ProviderTurnProvenance,
    createdAt: string,
  ): void {
    const provenance = ProviderTurnProvenanceSchema.parse(provenanceInput);
    this.#transaction(() => {
      if (provenance.disclosureOperationId) {
        const disclosure = this.getDisclosure(provenance.disclosureOperationId);
        if (!disclosure) {
          throw new Error(
            `Unknown disclosure operation: ${provenance.disclosureOperationId}`,
          );
        }
        if (disclosure.status !== "approved") {
          throw new Error(
            `Disclosure ${disclosure.operationId} is ${disclosure.status}, expected approved`,
          );
        }
        if (Date.parse(disclosure.expiresAt) <= Date.parse(createdAt)) {
          throw new Error(`Disclosure ${disclosure.operationId} has expired`);
        }
        const row = this.#connection.sqlite
          .prepare(
            `SELECT MAX(sequence) AS sequence FROM ai_disclosure_events
             WHERE operation_id = ?`,
          )
          .get(disclosure.operationId) as { sequence: number };
        this.#appendDisclosureEvent(
          disclosure.operationId,
          row.sequence + 1,
          "consumed",
          createdAt,
        );
      }
      this.#insertProviderTurnStarted(provenance, createdAt);
    });
  }

  recordProviderTurnStarted(
    provenanceInput: ProviderTurnProvenance,
    createdAt: string,
  ): void {
    const provenance = ProviderTurnProvenanceSchema.parse(provenanceInput);
    this.#insertProviderTurnStarted(provenance, createdAt);
  }

  recordProviderTurnFinished(
    operationId: string,
    status: "completed" | "failed" | "cancelled",
    completedAt: string,
    failureCode: ProviderHubFailureCode | null = null,
  ): void {
    if (status === "completed" && failureCode !== null) {
      throw new Error("A completed provider turn cannot have a failure code");
    }
    if (status === "failed" && failureCode === null) {
      throw new Error("A failed provider turn requires a failure code");
    }
    const result = this.#connection.sqlite
      .prepare(
        `UPDATE provider_turn_provenance
         SET status = ?, failure_code = ?, completed_at = ?
         WHERE operation_id = ? AND status = 'started'`,
      )
      .run(status, failureCode, completedAt, operationId);
    if (result.changes !== 1) {
      throw new Error(`Provider turn ${operationId} is not active`);
    }
  }

  #insertProviderTurnStarted(
    provenance: ProviderTurnProvenance,
    createdAt: string,
  ): void {
    this.#connection.sqlite
      .prepare(
        `INSERT INTO provider_turn_provenance
          (operation_id, connection_id, provider_type, adapter_id, model_id,
           role, tool_policy_id, capability_observed_at,
           disclosure_operation_id, status, failure_code, metadata_json,
           created_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'started', NULL, ?, ?, NULL)`,
      )
      .run(
        provenance.operationId,
        provenance.connectionId,
        provenance.providerType,
        provenance.adapterId,
        provenance.modelId,
        provenance.role,
        provenance.toolPolicyId,
        provenance.capabilityObservedAt,
        provenance.disclosureOperationId,
        provenance.metadata ? JSON.stringify(provenance.metadata) : null,
        createdAt,
      );
  }

  #transitionDisclosure(
    operationId: string,
    expected: AiDisclosureStatus,
    next: AiDisclosureStatus,
    occurredAt: string,
  ): AiDisclosure {
    let transitioned: AiDisclosure | null = null;
    this.#transaction(() => {
      const current = this.getDisclosure(operationId);
      if (!current)
        throw new Error(`Unknown disclosure operation: ${operationId}`);
      if (current.status !== expected) {
        throw new Error(
          `Disclosure ${operationId} is ${current.status}, expected ${expected}`,
        );
      }
      if (
        (next === "approved" || next === "consumed") &&
        Date.parse(current.expiresAt) <= Date.parse(occurredAt)
      ) {
        throw new Error(`Disclosure ${operationId} has expired`);
      }
      const row = this.#connection.sqlite
        .prepare(
          `SELECT MAX(sequence) AS sequence FROM ai_disclosure_events
           WHERE operation_id = ?`,
        )
        .get(operationId) as { sequence: number };
      this.#appendDisclosureEvent(
        operationId,
        row.sequence + 1,
        next,
        occurredAt,
      );
      transitioned = this.getDisclosure(operationId);
    });
    if (!transitioned)
      throw new Error("Disclosure transition was not persisted");
    return transitioned;
  }

  #appendDisclosureEvent(
    operationId: string,
    sequence: number,
    status: AiDisclosureStatus,
    occurredAt: string,
  ): void {
    this.#connection.sqlite
      .prepare(
        `INSERT INTO ai_disclosure_events
          (operation_id, sequence, status, occurred_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(operationId, sequence, status, occurredAt);
  }

  #toDisclosure(row: DisclosureRow): AiDisclosure {
    const approved = this.#eventTime(row.operation_id, "approved");
    const consumed = this.#eventTime(row.operation_id, "consumed");
    return AiDisclosureSchema.parse({
      operationId: row.operation_id,
      scope: {
        role: row.role,
        connectionId: row.connection_id,
        providerType: row.provider_type,
        modelId: row.model_id,
        destination: row.destination,
        payloadCategories: JSON.parse(row.payload_categories_json),
        entityIds: JSON.parse(row.entity_ids_json),
        exclusions: JSON.parse(row.exclusions_json),
        byteCount: row.byte_count,
        payloadSha256: row.payload_sha256,
      },
      status: row.status,
      createdAt: row.created_at,
      approvedAt: approved,
      consumedAt: consumed,
      expiresAt: row.expires_at,
    });
  }

  #eventTime(operationId: string, status: AiDisclosureStatus): string | null {
    const row = this.#connection.sqlite
      .prepare(
        `SELECT occurred_at FROM ai_disclosure_events
         WHERE operation_id = ? AND status = ?
         ORDER BY sequence DESC LIMIT 1`,
      )
      .get(operationId, status) as { occurred_at: string } | undefined;
    return row?.occurred_at ?? null;
  }

  #transaction<T>(operation: () => T): T {
    this.#connection.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.#connection.sqlite.exec("COMMIT");
      return result;
    } catch (error) {
      this.#connection.sqlite.exec("ROLLBACK");
      throw error;
    }
  }
}

function toProviderConnection(row: ProviderConnectionRow): ProviderConnection {
  const capabilities = row.observed_capabilities_json
    ? ProviderCapabilityProfileSchema.parse(
        JSON.parse(row.observed_capabilities_json),
      )
    : null;
  return ProviderConnectionSchema.parse({
    connectionId: row.connection_id,
    adapterId: row.adapter_id,
    providerType: row.provider_type,
    displayName: row.display_name,
    credentialRef: row.credential_ref,
    endpointProfileId: row.endpoint_profile_id,
    enabled: row.enabled === 1,
    external: row.external === 1,
    state: row.state,
    observedCapabilities: capabilities,
    lastCheckedAt: row.last_checked_at,
  });
}
