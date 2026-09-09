import { serve } from "@hono/node-server";
import { fileURLToPath } from "node:url";

import { runM1MigrationCli } from "@aptiloop/database";
import { createApp } from "./app.js";
import { parseOrchestratorStartupConfig } from "./startup-boundary.js";
const projectRoot = fileURLToPath(new URL("../../..", import.meta.url));
if (process.env.APTILOOP_MIGRATE_ONLY === "1") {
  try {
    const configuredPath =
      process.env.DATABASE_PATH ?? process.env.DATABASE_URL;
    if (configuredPath !== undefined) {
      runM1MigrationCli({
        projectRoot,
        configuredPath,
        argv: process.argv.slice(2),
      });
    } else {
      runM1MigrationCli({ projectRoot, argv: process.argv.slice(2) });
    }
    process.exit(0);
  } catch (error) {
    console.error(
      `aptiloop candidate migration failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
}

const startupConfig = parseOrchestratorStartupConfig(process.env);
const { hostname, port } = startupConfig;
const runtime = createApp({
  startupConfig,
  developmentMode: false,
});

const server = serve(
  {
    fetch: runtime.app.fetch,
    port,
    hostname,
  },
  (info) => {
    console.log(`Aptiloop orchestrator: http://${hostname}:${info.port}`);
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
