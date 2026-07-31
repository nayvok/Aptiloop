import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

const root = path.resolve(import.meta.dirname, "../..");

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3000",
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
      url: "http://127.0.0.1:8787/health/ready",
      reuseExistingServer: !process.env.CI,
      env: {
        ...process.env,
        DATABASE_URL: ":memory:",
        NODE_ENV: "test",
      },
      timeout: 120_000,
    },
    {
      command: "npm run dev --workspace=@dlh/web",
      cwd: root,
      url: "http://127.0.0.1:3000",
      reuseExistingServer: !process.env.CI,
      env: {
        ...process.env,
        ORCHESTRATOR_URL: "http://127.0.0.1:8787",
      },
      timeout: 120_000,
    },
  ],
});
