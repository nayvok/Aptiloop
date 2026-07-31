import { serve } from "@hono/node-server";

import { createApp } from "./app.js";

const port = Number.parseInt(process.env.PORT ?? "8787", 10);
const hostname = process.env.HOST ?? "127.0.0.1";
const runtime = createApp();

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
