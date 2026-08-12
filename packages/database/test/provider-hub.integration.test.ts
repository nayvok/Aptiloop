import { afterEach, describe, expect, it } from "vitest";

import {
  ProviderHubRepository,
  migrateDatabase,
  openDatabase,
  type DatabaseConnection,
} from "../src/index.js";

const connections: DatabaseConnection[] = [];

function fixture() {
  const connection = openDatabase(":memory:");
  migrateDatabase(connection);
  connections.push(connection);
  return { connection, repository: new ProviderHubRepository(connection) };
}

afterEach(() => {
  while (connections.length) connections.pop()?.close();
});

const payloadSha256 = `sha256:${"a".repeat(64)}`;

function seedConfiguration(repository: ProviderHubRepository) {
  repository.saveConnection({
    connectionId: "conn:pi:openai",
    adapterId: "pi",
    providerType: "openai",
    displayName: "OpenAI via Pi",
    credentialRef: "credential:openai:default",
    endpointProfileId: null,
    enabled: true,
    external: true,
    state: "degraded",
    observedCapabilities: {
      providerType: "openai",
      adapterVersion: "0.84.1",
      observedAt: "2026-08-10T12:00:00.000Z",
      models: [
        {
          modelId: "gpt-5.4",
          available: true,
          contextTokens: 1_000_000,
          outputTokens: 128_000,
          typedToolCalls: "schema-constrained",
          parallelToolCalls: false,
          attachments: ["text"],
        },
      ],
      connection: {
        authenticated: true,
        streaming: true,
        cancellation: true,
      },
    },
    lastCheckedAt: "2026-08-10T12:00:00.000Z",
  });
  repository.saveToolPolicy({
    toolPolicyId: "apt.role.reviewer.v1",
    role: "reviewer",
    allowedTools: ["review.readBundle", "review.submitResult"],
  });
  repository.saveRoleProfile({
    role: "reviewer",
    mode: "connection",
    connectionId: "conn:pi:openai",
    modelId: "gpt-5.4",
    requiredCapabilities: ["streaming", "tools", "cancellation"],
    toolPolicyId: "apt.role.reviewer.v1",
    budgets: {
      maxInputBytes: 2_500_000,
      maxOutputBytes: 100_000,
      maxEvents: 1_000,
      maxToolCalls: 2,
      deadlineMs: 60_000,
    },
  });
}

describe("ProviderHubRepository", () => {
  it("round-trips secret-free connection, role, and tool policy records", () => {
    const { repository } = fixture();
    seedConfiguration(repository);

    expect(repository.listConnections()).toEqual([
      expect.objectContaining({
        connectionId: "conn:pi:openai",
        adapterId: "pi",
        providerType: "openai",
        credentialRef: "credential:openai:default",
      }),
    ]);
    expect(repository.listRoleProfiles()).toEqual([
      expect.objectContaining({
        role: "reviewer",
        connectionId: "conn:pi:openai",
        modelId: "gpt-5.4",
      }),
    ]);
    expect(repository.listToolPolicies()).toEqual([
      {
        toolPolicyId: "apt.role.reviewer.v1",
        role: "reviewer",
        allowedTools: ["review.readBundle", "review.submitResult"],
      },
    ]);
  });

  it("retires a connection atomically while preserving its audit history", () => {
    const { connection, repository } = fixture();
    seedConfiguration(repository);
    repository.createDisclosure({
      operationId: "disclosure:retirement",
      scope: {
        role: "reviewer",
        connectionId: "conn:pi:openai",
        providerType: "openai",
        modelId: "gpt-5.4",
        destination: "OpenAI API",
        payloadCategories: ["review-bundle"],
        entityIds: { bundle: "bundle:retirement" },
        exclusions: ["credentials"],
        byteCount: 1024,
        payloadSha256,
      },
      status: "pending",
      createdAt: "2026-08-10T12:01:00.000Z",
      approvedAt: null,
      consumedAt: null,
      expiresAt: "2026-08-10T12:11:00.000Z",
    });
    repository.recordProviderTurnStarted(
      {
        operationId: "turn:retirement",
        connectionId: "conn:pi:openai",
        providerType: "openai",
        adapterId: "pi",
        modelId: "gpt-5.4",
        role: "reviewer",
        toolPolicyId: "apt.role.reviewer.v1",
        capabilityObservedAt: "2026-08-10T12:00:00.000Z",
        disclosureOperationId: "disclosure:retirement",
      },
      "2026-08-10T12:02:00.000Z",
    );

    const retiredAt = "2026-08-10T12:03:00.000Z";
    repository.retireConnection({
      connectionId: "conn:pi:openai",
      retiredAt,
      applicationSetting: {
        key: "providerHubManagedConnections",
        valueJson: '{"version":1,"connections":[]}',
        updatedAt: Date.parse(retiredAt),
      },
    });

    expect(repository.listConnections()).toEqual([]);
    expect(repository.listConnections({ includeRetired: true })).toEqual([
      expect.objectContaining({
        connectionId: "conn:pi:openai",
        credentialRef: null,
        enabled: false,
        observedCapabilities: null,
        state: "disabled",
      }),
    ]);
    expect(repository.listRoleProfiles()).toEqual([
      expect.objectContaining({
        role: "reviewer",
        mode: "no-ai",
        connectionId: null,
        modelId: null,
        requiredCapabilities: [],
        toolPolicyId: "apt.role.reviewer.v1",
        budgets: {
          maxInputBytes: 2_500_000,
          maxOutputBytes: 100_000,
          maxEvents: 1_000,
          maxToolCalls: 2,
          deadlineMs: 60_000,
        },
      }),
    ]);
    expect(
      connection.sqlite
        .prepare(
          `SELECT retired_at, credential_ref, observed_capabilities_json
           FROM provider_hub_connections WHERE connection_id = ?`,
        )
        .get("conn:pi:openai"),
    ).toEqual({
      retired_at: retiredAt,
      credential_ref: null,
      observed_capabilities_json: null,
    });
    expect(repository.getDisclosure("disclosure:retirement")).toMatchObject({
      operationId: "disclosure:retirement",
      scope: { connectionId: "conn:pi:openai" },
    });
    expect(
      connection.sqlite
        .prepare(
          `SELECT connection_id, status
           FROM provider_turn_provenance WHERE operation_id = ?`,
        )
        .get("turn:retirement"),
    ).toEqual({ connection_id: "conn:pi:openai", status: "started" });
    expect(
      connection.sqlite
        .prepare(
          `SELECT value_json, updated_at
           FROM application_settings WHERE key = ?`,
        )
        .get("providerHubManagedConnections"),
    ).toEqual({
      value_json: '{"version":1,"connections":[]}',
      updated_at: Date.parse(retiredAt),
    });
    expect(() =>
      repository.saveConnection({
        ...repository.listConnections({ includeRetired: true })[0]!,
        enabled: true,
        state: "degraded",
      }),
    ).toThrow(/retired/u);
  });

  it("rolls back role reset and retirement when setting persistence fails", () => {
    const { connection, repository } = fixture();
    seedConfiguration(repository);
    connection.sqlite
      .prepare(
        `INSERT INTO application_settings (key, value_json, updated_at)
         VALUES (?, ?, ?)`,
      )
      .run("providerHubManagedConnections", '{"version":1}', 1);
    connection.sqlite.exec(`
      CREATE TRIGGER application_settings_retirement_test_guard
      BEFORE UPDATE ON application_settings
      BEGIN SELECT RAISE(ABORT, 'setting write failed'); END;
    `);

    expect(() =>
      repository.retireConnection({
        connectionId: "conn:pi:openai",
        retiredAt: "2026-08-10T12:03:00.000Z",
        applicationSetting: {
          key: "providerHubManagedConnections",
          valueJson: '{"version":1,"connections":[]}',
          updatedAt: 2,
        },
      }),
    ).toThrow(/setting write failed/u);

    expect(repository.listConnections()).toEqual([
      expect.objectContaining({
        connectionId: "conn:pi:openai",
        enabled: true,
        state: "degraded",
      }),
    ]);
    expect(repository.listRoleProfiles()).toEqual([
      expect.objectContaining({
        mode: "connection",
        connectionId: "conn:pi:openai",
        modelId: "gpt-5.4",
      }),
    ]);
    expect(
      connection.sqlite
        .prepare(
          `SELECT value_json, updated_at
           FROM application_settings WHERE key = ?`,
        )
        .get("providerHubManagedConnections"),
    ).toEqual({ value_json: '{"version":1}', updated_at: 1 });
  });

  it("validates retirement metadata before starting its transaction", () => {
    const { repository } = fixture();
    seedConfiguration(repository);

    expect(() =>
      repository.retireConnection({
        connectionId: "conn:pi:openai",
        retiredAt: "not-a-date",
      }),
    ).toThrow(/canonical ISO date-time/u);
    expect(() =>
      repository.retireConnection({
        connectionId: "conn:pi:openai",
        retiredAt: "2026-08-10T12:03:00.000Z",
        applicationSetting: {
          key: "providerHubManagedConnections",
          valueJson: "not-json",
          updatedAt: 1,
        },
      }),
    ).toThrow(/valid JSON/u);
    expect(repository.listConnections()).toHaveLength(1);
  });

  it("persists an append-only disclosure approval and one-time consumption", () => {
    const { connection, repository } = fixture();
    seedConfiguration(repository);
    repository.createDisclosure({
      operationId: "disclosure:1",
      scope: {
        role: "reviewer",
        connectionId: "conn:pi:openai",
        providerType: "openai",
        modelId: "gpt-5.4",
        destination: "OpenAI API",
        payloadCategories: ["review-bundle", "learner-evidence"],
        entityIds: {
          attempt: "attempt:1",
          bundle: "bundle:1",
        },
        exclusions: ["credentials", "protected answer keys"],
        byteCount: 2048,
        payloadSha256,
      },
      status: "pending",
      createdAt: "2026-08-10T11:55:00.000Z",
      approvedAt: null,
      consumedAt: null,
      expiresAt: "2026-08-10T12:05:00.000Z",
    });

    expect(
      repository.approveDisclosure("disclosure:1", "2026-08-10T11:56:00.000Z"),
    ).toMatchObject({
      status: "approved",
      approvedAt: "2026-08-10T11:56:00.000Z",
    });
    expect(
      repository.consumeDisclosure("disclosure:1", "2026-08-10T11:57:00.000Z"),
    ).toMatchObject({
      status: "consumed",
      consumedAt: "2026-08-10T11:57:00.000Z",
    });
    expect(() =>
      repository.consumeDisclosure("disclosure:1", "2026-08-10T11:58:00.000Z"),
    ).toThrow(/expected approved/u);
    expect(() =>
      connection.sqlite
        .prepare(
          "UPDATE ai_disclosure_operations SET destination = ? WHERE operation_id = ?",
        )
        .run("different destination", "disclosure:1"),
    ).toThrow(/immutable/u);
  });

  it("rejects approval or consumption after the exact disclosure expires", () => {
    const { repository } = fixture();
    seedConfiguration(repository);
    repository.createDisclosure({
      operationId: "disclosure:expired",
      scope: {
        role: "reviewer",
        connectionId: "conn:pi:openai",
        providerType: "openai",
        modelId: "gpt-5.4",
        destination: "OpenAI API",
        payloadCategories: ["review-bundle"],
        entityIds: { bundle: "bundle:expired" },
        exclusions: [],
        byteCount: 50,
        payloadSha256,
      },
      status: "pending",
      createdAt: "2026-08-10T11:00:00.000Z",
      approvedAt: null,
      consumedAt: null,
      expiresAt: "2026-08-10T11:05:00.000Z",
    });

    expect(() =>
      repository.approveDisclosure(
        "disclosure:expired",
        "2026-08-10T11:06:00.000Z",
      ),
    ).toThrow(/expired/u);
  });

  it("allows exactly one terminal update to provider turn provenance", () => {
    const { connection, repository } = fixture();
    seedConfiguration(repository);
    repository.recordProviderTurnStarted(
      {
        operationId: "turn:1",
        connectionId: "conn:pi:openai",
        providerType: "openai",
        adapterId: "pi",
        modelId: "gpt-5.4",
        role: "reviewer",
        toolPolicyId: "apt.role.reviewer.v1",
        capabilityObservedAt: "2026-08-10T12:00:00.000Z",
        disclosureOperationId: null,
      },
      "2026-08-10T12:01:00.000Z",
    );
    repository.recordProviderTurnFinished(
      "turn:1",
      "completed",
      "2026-08-10T12:01:10.000Z",
    );

    expect(() =>
      repository.recordProviderTurnFinished(
        "turn:1",
        "cancelled",
        "2026-08-10T12:01:11.000Z",
      ),
    ).toThrow(/not active/u);
    expect(() =>
      connection.sqlite
        .prepare(
          "UPDATE provider_turn_provenance SET model_id = ? WHERE operation_id = ?",
        )
        .run("different", "turn:1"),
    ).toThrow(/immutable/u);
  });
});
