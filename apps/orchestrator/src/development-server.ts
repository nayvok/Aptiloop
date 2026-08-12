import { serve } from "@hono/node-server";
import { MockAgentProvider } from "@aptiloop/agent-core/mock";
import { seedDevelopmentDatabase } from "@aptiloop/database/development-fixtures";

import { createApp } from "./app.js";
import { parseOrchestratorStartupConfig } from "./startup-boundary.js";

if (process.env.NODE_ENV !== "development") {
  throw new Error("The development orchestrator requires NODE_ENV=development");
}

const startupConfig = parseOrchestratorStartupConfig(process.env);
const { hostname, port } = startupConfig;
const runtime = createApp({
  startupConfig,
  developmentMode: true,
  developmentDatabaseInitializer: seedDevelopmentDatabase,
  providers: { mock: new MockAgentProvider() },
  developmentProviderFixture: {
    connection: {
      connectionId: "conn:development-provider",
      adapterId: "mock",
      providerType: "mock",
      displayName: "Development provider",
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
  },
});

const server = serve(
  {
    fetch: runtime.app.fetch,
    port,
    hostname,
  },
  (info) => {
    console.log(
      `Aptiloop development orchestrator: http://${hostname}:${info.port}`,
    );
  },
);

let shuttingDown = false;
const shutdown = () => {
  if (shuttingDown) return;
  shuttingDown = true;
  runtime.beginShutdown();
  server.close(async () => {
    try {
      await runtime.close();
      process.exit(0);
    } catch (error) {
      console.error("orchestrator_shutdown_failed", error);
      process.exit(1);
    }
  });
};

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
