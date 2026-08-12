import type { DevelopmentProviderFixture } from "../src/provider-runtime.js";

export const testDevelopmentProviderFixture = {
  connection: {
    connectionId: "conn:mock",
    adapterId: "mock",
    providerType: "mock",
    displayName: "Deterministic Mock",
    credentialRef: null,
    endpointProfileId: null,
    enabled: true,
    external: false,
    state: "connected",
    observedCapabilities: null,
    lastCheckedAt: null,
  },
  modelId: "mock-deterministic",
  assignedRoles: ["tutor", "evaluator", "reviewer"],
} as const satisfies DevelopmentProviderFixture;
