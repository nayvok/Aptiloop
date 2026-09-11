import { readFileSync } from "node:fs";
import path from "node:path";
import { serve } from "@hono/node-server";
import { fileURLToPath } from "node:url";
import { MockAgentProvider } from "@aptiloop/agent-core/mock";
import { validateCoursePackBytes } from "@aptiloop/course-authoring-kit";
import {
  coursePackSourceBytesHash,
  createCoursePackRepository,
  type DatabaseConnection,
} from "@aptiloop/database";
import { seedDevelopmentDatabase } from "@aptiloop/database/development-fixtures";

import { createApp } from "./app.js";
import { parseOrchestratorStartupConfig } from "./startup-boundary.js";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

const DEVELOPMENT_TOUR_LOCALES = ["en", "ru"] as const;

/**
 * Installs the repository's Aptiloop Dev Tour Course Pack presets so a fresh
 * development profile opens with the two tour Courses instead of the legacy
 * development curriculum. Installation goes through the same validated
 * Course Pack repository boundary as the /courses/import route and is
 * skipped for already-installed Courses, so restarts are idempotent.
 */
function installDevelopmentTourCourses(connection: DatabaseConnection): void {
  const repository = createCoursePackRepository(connection);
  const installedCourseKeys = new Set(
    repository.list().map((item) => item.courseKey),
  );
  for (const locale of DEVELOPMENT_TOUR_LOCALES) {
    const courseKey = `aptiloop-dev-tour-${locale}`;
    if (installedCourseKeys.has(courseKey)) continue;
    const sourceBytes = new TextEncoder().encode(
      readFileSync(
        path.join(
          projectRoot,
          "packages",
          "curriculum",
          "fixtures",
          "course-packs",
          `aptiloop-dev-tour-${locale}.course-pack.json`,
        ),
        "utf8",
      ),
    );
    const validation = validateCoursePackBytes(sourceBytes);
    if (!validation.valid || !validation.pack) {
      throw new Error(
        `The Aptiloop Dev Tour ${locale} preset failed Course Pack validation`,
      );
    }
    repository.install({
      operationId: `aptiloop-dev-tour-install-${locale}`,
      validationId: `aptiloop-dev-tour-install-${locale}`,
      action: "install",
      sourceBytesHash: coursePackSourceBytesHash(sourceBytes),
      pack: validation.pack,
      canonicalJson: validation.canonicalJson,
      report: validation.report,
    });
  }
}

if (process.env.NODE_ENV !== "development") {
  throw new Error("The development orchestrator requires NODE_ENV=development");
}

// A fresh development profile installs the Aptiloop Dev Tour presets and
// stays otherwise empty, like a clean install. Set
// APTILOOP_DEV_SEED_CURRICULUM=1 to additionally opt in to the legacy
// development curriculum fixtures, or run `npm run db:seed` explicitly.
const seedRequested = process.env.APTILOOP_DEV_SEED_CURRICULUM === "1";

const startupConfig = parseOrchestratorStartupConfig(process.env);
const { hostname, port } = startupConfig;
const runtime = createApp({
  startupConfig,
  developmentMode: true,
  developmentDatabaseInitializer: seedRequested
    ? (connection) => {
        installDevelopmentTourCourses(connection);
        seedDevelopmentDatabase(connection);
      }
    : installDevelopmentTourCourses,
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
