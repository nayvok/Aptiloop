import path from "node:path";
import { createE2EEnvironment } from "../../scripts/e2e-environment.mjs";
import { defineConfig, devices } from "@playwright/test";

const root = path.resolve(import.meta.dirname, "../..");
const webRoot = path.join(root, "apps", "web");
const runsRoot = path.join(root, ".data", "e2e-runs");
const runId = requiredEnvironment("E2E_RUN_ID");
const runRoot = path.resolve(requiredEnvironment("E2E_RUN_ROOT"));
const expectedRunRoot = path.resolve(runsRoot, runId);

if (!/^[a-z0-9][a-z0-9-]{7,127}$/u.test(runId) || runRoot !== expectedRunRoot) {
  throw new Error(
    "E2E_RUN_ROOT must be the launcher-owned directory for E2E_RUN_ID",
  );
}

const databasePath = exactRunPath(
  "E2E_DATABASE_PATH",
  path.join(runRoot, "database.sqlite"),
);
const attemptsRoot = exactRunPath(
  "E2E_ATTEMPTS_ROOT",
  path.join(runRoot, "exercise-attempts"),
);
const nextDistDir = requiredEnvironment("NEXT_DIST_DIR");
if (path.resolve(webRoot, nextDistDir) !== path.join(runRoot, "next")) {
  throw new Error(
    "NEXT_DIST_DIR must resolve to the launcher-owned E2E run root",
  );
}

const webOrigin = requiredOrigin("E2E_WEB_ORIGIN");
const orchestratorOrigin = requiredOrigin("E2E_ORCHESTRATOR_ORIGIN");
const webPort = requiredPort("E2E_WEB_PORT");
const orchestratorPort = requiredPort("E2E_ORCHESTRATOR_PORT");
if (
  new URL(webOrigin).port !== String(webPort) ||
  new URL(orchestratorOrigin).port !== String(orchestratorPort)
) {
  throw new Error("E2E service origins and ports must match");
}

const serviceOwnerEnvironment = {
  E2E_ATTEMPTS_ROOT: attemptsRoot,
  E2E_DATABASE_PATH: databasePath,
  E2E_LAUNCHER_PID: requiredEnvironment("E2E_LAUNCHER_PID"),
  E2E_LOCK_TOKEN: requiredEnvironment("E2E_LOCK_TOKEN"),
  E2E_ORCHESTRATOR_ORIGIN: orchestratorOrigin,
  E2E_ORCHESTRATOR_PORT: String(orchestratorPort),
  E2E_RUN_ID: runId,
  E2E_RUN_ROOT: runRoot,
  E2E_WEB_ORIGIN: webOrigin,
  E2E_WEB_PORT: String(webPort),
};

export default defineConfig({
  testDir: "./e2e",
  outputDir: path.join(runRoot, "playwright-results"),
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: webOrigin,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      name: "orchestrator",
      command: "node scripts/test-e2e.mjs --service orchestrator",
      cwd: root,
      url: `${orchestratorOrigin}/health/ready`,
      reuseExistingServer: false,
      stdout: "pipe",
      stderr: "pipe",
      gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
      env: createE2EEnvironment(process.env, {
        ...serviceOwnerEnvironment,
        DATABASE_PATH: databasePath,
        DATABASE_URL: databasePath,
        EXERCISE_ATTEMPTS_ROOT: attemptsRoot,
        HOST: "127.0.0.1",
        NODE_ENV: "test",
        OPENCODE_ENDPOINT: "http://127.0.0.1:4096",
        ORCHESTRATOR_BIND_MODE: "direct",
        PORT: String(orchestratorPort),
        WEB_ORIGIN: webOrigin,
      }),
      timeout: 120_000,
    },
    {
      name: "web",
      command: "node scripts/test-e2e.mjs --service web",
      cwd: root,
      url: webOrigin,
      reuseExistingServer: false,
      stdout: "pipe",
      stderr: "pipe",
      gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
      env: createE2EEnvironment(process.env, {
        ...serviceOwnerEnvironment,
        NEXT_DIST_DIR: nextDistDir,
        NODE_ENV: "development",
        ORCHESTRATOR_URL: orchestratorOrigin,
        ORCHESTRATOR_BIND_MODE: "direct",
        PORT: String(webPort),
      }),
      timeout: 120_000,
    },
  ],
});

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} must be provided by scripts/test-e2e.mjs`);
  }
  return value;
}

function exactRunPath(name: string, expected: string): string {
  const value = path.resolve(requiredEnvironment(name));
  if (value !== path.resolve(expected)) {
    throw new Error(`${name} must stay inside the launcher-owned E2E run root`);
  }
  return value;
}

function requiredOrigin(name: string): string {
  const value = requiredEnvironment(name);
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error(`${name} must be an HTTP loopback origin`);
  }
  return url.origin;
}

function requiredPort(name: string): number {
  const value = requiredEnvironment(name);
  const port = Number.parseInt(value, 10);
  if (
    String(port) !== value ||
    !Number.isSafeInteger(port) ||
    port < 1 ||
    port > 65_535
  ) {
    throw new Error(`${name} must be a valid TCP port`);
  }
  return port;
}
