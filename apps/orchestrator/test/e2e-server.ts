import { serve } from "@hono/node-server";
import { MockAgentProvider } from "@aptiloop/agent-core/mock";
import { assertM1E2EDatabaseTarget } from "@aptiloop/database";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createApp } from "../src/app.js";
import { parseOrchestratorStartupConfig } from "../src/startup-boundary.js";
import { seedDevelopmentDatabase } from "./development-database-fixture.js";
import { testDevelopmentProviderFixture } from "./provider-development-fixture.js";

if (process.env.NODE_ENV !== "test") {
  throw new Error("The E2E orchestrator requires NODE_ENV=test");
}

const projectRoot = fileURLToPath(new URL("../../..", import.meta.url));
const runId = requireEnvironment("E2E_RUN_ID");
const runRoot = path.resolve(requireEnvironment("E2E_RUN_ROOT"));
const databasePath = path.resolve(requireEnvironment("E2E_DATABASE_PATH"));
const configuredDatabasePath = path.resolve(
  requireEnvironment("DATABASE_PATH"),
);
const configuredDatabaseUrl = path.resolve(requireEnvironment("DATABASE_URL"));
requirePositiveIntegerEnvironment("E2E_LAUNCHER_PID");
requireEnvironment("E2E_LOCK_TOKEN");

if (
  configuredDatabasePath !== databasePath ||
  configuredDatabaseUrl !== databasePath
) {
  throw new Error(
    "The E2E orchestrator database variables must identify one exact launcher-owned database",
  );
}

assertM1E2EDatabaseTarget(databasePath, {
  projectRoot,
  runId,
  runRootPath: runRoot,
  configuredDatabasePath: databasePath,
});

const startupConfig = parseOrchestratorStartupConfig(process.env);
const { hostname, port } = startupConfig;
const runtime = createApp({
  projectRoot,
  databasePath,
  startupConfig,
  developmentMode: true,
  developmentDatabaseInitializer: seedDevelopmentDatabase,
  providers: { mock: new MockAgentProvider() },
  developmentProviderFixture: testDevelopmentProviderFixture,
});

const server = serve(
  {
    fetch: runtime.app.fetch,
    port,
    hostname,
  },
  (info) => {
    console.log(`Aptiloop E2E orchestrator: http://${hostname}:${info.port}`);
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

function requireEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required for the launcher-owned E2E runtime`);
  }
  return value;
}

function requirePositiveIntegerEnvironment(name: string): number {
  const value = requireEnvironment(name);
  if (!/^[1-9]\d*$/u.test(value)) {
    throw new Error(`${name} must be a positive integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}
