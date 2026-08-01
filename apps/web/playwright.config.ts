import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

const root = path.resolve(import.meta.dirname, "../..");
const webOrigin = "http://127.0.0.1:3100";
const orchestratorOrigin = "http://127.0.0.1:8887";

export default defineConfig({
  testDir: "./e2e",
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
      command: "npm run dev --workspace=@dlh/orchestrator",
      cwd: root,
      url: `${orchestratorOrigin}/health/ready`,
      reuseExistingServer: false,
      env: {
        ...process.env,
        DATABASE_URL: ":memory:",
        EXERCISE_ATTEMPTS_ROOT: path.join(
          root,
          ".data",
          "e2e-exercise-attempts",
        ),
        NODE_ENV: "test",
        PORT: "8887",
        WEB_ORIGIN: webOrigin,
      },
      timeout: 120_000,
    },
    {
      command: "npm run dev --workspace=@dlh/web",
      cwd: root,
      url: webOrigin,
      reuseExistingServer: false,
      env: {
        ...process.env,
        NEXT_DIST_DIR: ".next-e2e",
        ORCHESTRATOR_URL: orchestratorOrigin,
        PORT: "3100",
      },
      timeout: 120_000,
    },
  ],
});
