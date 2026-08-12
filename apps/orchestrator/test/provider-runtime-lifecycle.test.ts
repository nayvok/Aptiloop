import { MockAgentProvider } from "@aptiloop/agent-core/mock";
import {
  migrateDatabase,
  openDatabase,
  type DatabaseConnection,
} from "@aptiloop/database";
import type { AgentRole, AptiloopAiRole } from "@aptiloop/shared";
import { afterEach, describe, expect, it } from "vitest";

import {
  ProviderRuntime,
  type DevelopmentProviderFixture,
} from "../src/provider-runtime.js";

const connections: DatabaseConnection[] = [];

const lifecycleFixture = {
  connection: {
    connectionId: "conn:lifecycle-test",
    adapterId: "mock",
    providerType: "mock",
    displayName: "Lifecycle test provider",
    credentialRef: null,
    endpointProfileId: null,
    enabled: true,
    external: false,
    state: "connected",
    observedCapabilities: null,
    lastCheckedAt: null,
  },
  modelId: "mock-deterministic",
  assignedRoles: ["course-designer", "tutor", "evaluator", "reviewer"],
} as const satisfies DevelopmentProviderFixture;

const roleCases = [
  ["chat", "teacher", "tutor"],
  ["reviewer", "reviewer", "reviewer"],
  ["interview", "interviewer", "evaluator"],
  ["course designer", "course-designer", "course-designer"],
] as const satisfies ReadonlyArray<
  readonly [string, AgentRole, AptiloopAiRole]
>;

afterEach(() => {
  for (const connection of connections.splice(0)) connection.close();
});

function createRuntime(): ProviderRuntime {
  const connection = openDatabase(":memory:");
  connections.push(connection);
  migrateDatabase(connection);
  return new ProviderRuntime({
    connection,
    providers: { mock: new MockAgentProvider() },
    developmentMode: true,
    developmentFixture: lifecycleFixture,
  });
}

describe("provider connection lifecycle", () => {
  it.each(roleCases)(
    "fences removal and new dispatches for the %s role",
    async (_label, role, expectedHubRole) => {
      const runtime = createRuntime();
      const active = await runtime.resolveDispatch({
        role,
        payload: `lifecycle:${role}`,
      });

      expect(active.profile.role).toBe(expectedHubRole);
      expect(() =>
        runtime.beginConnectionRetirement(
          lifecycleFixture.connection.connectionId,
        ),
      ).toThrow("active AI request");
      expect(() => runtime.assertDispatchCommitAllowed(active)).not.toThrow();

      runtime.finishDispatch(active, "cancelled", "cancelled");
      expect(() => runtime.assertDispatchCommitAllowed(active)).toThrow(
        "no longer active",
      );

      const retiring = runtime.beginConnectionRetirement(
        lifecycleFixture.connection.connectionId,
      );
      await expect(
        runtime.resolveDispatch({
          role,
          payload: `blocked:${role}`,
        }),
      ).rejects.toMatchObject({
        failure: { code: "connection_disabled" },
      });

      retiring.rollback();
      const reopened = await runtime.resolveDispatch({
        role,
        payload: `reopened:${role}`,
      });
      runtime.finishDispatch(reopened, "completed");

      const removed = runtime.beginConnectionRetirement(
        lifecycleFixture.connection.connectionId,
      );
      removed.commit();
      await expect(
        runtime.resolveDispatch({
          role,
          payload: `removed:${role}`,
        }),
      ).rejects.toMatchObject({
        failure: { code: "connection_disabled" },
      });
    },
  );
});
