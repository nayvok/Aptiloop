import { serve } from "@hono/node-server";

import { createApp } from "./app.js";
import { parseOrchestratorStartupConfig } from "./startup-boundary.js";

const startupConfig = parseOrchestratorStartupConfig(process.env);
const { hostname, port } = startupConfig;
const runtime = createApp({ startupConfig });

const server = serve(
  {
    fetch: runtime.app.fetch,
    port,
    hostname,
  },
  (info) => {
    console.log(
      `Dev Learning Harness orchestrator: http://${hostname}:${info.port}`,
    );
  },
);

const shutdown = () => {
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
