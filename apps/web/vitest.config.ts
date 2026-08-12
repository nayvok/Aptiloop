import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname),
    },
  },
  test: {
    environment: "jsdom",
    include: ["test/**/*.test.{ts,tsx}"],
    // Keep the UI suite responsive while Turbo runs database and orchestrator
    // integration tests in parallel during the repository-level fast gate.
    maxWorkers: 2,
    setupFiles: ["./test/setup.ts"],
  },
});
