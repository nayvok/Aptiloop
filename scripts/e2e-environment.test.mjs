import assert from "node:assert/strict";
import test from "node:test";

import { createE2EEnvironment } from "./e2e-environment.mjs";
import { createOwnerWatchdogPolicy } from "./e2e-owner-watchdog.mjs";

const callerSentinel = "CALLER_ENVIRONMENT_MUST_NOT_CROSS_E2E_BOUNDARY";

test("copies only process-launch and deliberate CI/Playwright variables", () => {
  const environment = createE2EEnvironment({
    ALL_PROXY: callerSentinel,
    CODEX_HOME: callerSentinel,
    CI: "1",
    DATABASE_PATH: callerSentinel,
    DATABASE_URL: callerSentinel,
    E2E_RUN_ID: callerSentinel,
    HOST: callerSentinel,
    HTTP_PROXY: callerSentinel,
    HTTPS_PROXY: callerSentinel,
    NEXT_DIST_DIR: callerSentinel,
    NODE_ENV: callerSentinel,
    NODE_OPTIONS: `--import=${callerSentinel}`,
    NO_PROXY: callerSentinel,
    OPENCODE_ENDPOINT: callerSentinel,
    OPENCODE_SERVER_PASSWORD: callerSentinel,
    OPENCODE_SERVER_USERNAME: callerSentinel,
    OPENAI_API_KEY: callerSentinel,
    ORCHESTRATOR_BIND_MODE: callerSentinel,
    ORCHESTRATOR_URL: callerSentinel,
    PATH: "C:/trusted/bin",
    PLAYWRIGHT_BROWSERS_PATH: "C:/trusted/playwright",
    WORKSPACE_ROOT: callerSentinel,
    PORT: callerSentinel,
    WEB_ORIGIN: callerSentinel,
  });

  assert.deepEqual(environment, {
    CI: "1",
    PATH: "C:/trusted/bin",
    PLAYWRIGHT_BROWSERS_PATH: "C:/trusted/playwright",
  });
  assert.equal(JSON.stringify(environment).includes(callerSentinel), false);
});

test("uses explicit isolated values instead of adversarial caller values", () => {
  const environment = createE2EEnvironment(
    {
      DATABASE_URL: callerSentinel,
      HTTP_PROXY: callerSentinel,
      NODE_ENV: callerSentinel,
      NODE_OPTIONS: callerSentinel,
      OPENCODE_ENDPOINT: callerSentinel,
      OPENCODE_SERVER_PASSWORD: callerSentinel,
      ORCHESTRATOR_BIND_MODE: "container-loopback-published",
      PATH: "C:/trusted/bin",
    },
    {
      DATABASE_URL: "C:/owned-run/database.sqlite",
      NODE_ENV: "test",
      OPENCODE_ENDPOINT: "http://127.0.0.1:4096",
      ORCHESTRATOR_BIND_MODE: "direct",
    },
  );

  assert.deepEqual(environment, {
    DATABASE_URL: "C:/owned-run/database.sqlite",
    NODE_ENV: "test",
    OPENCODE_ENDPOINT: "http://127.0.0.1:4096",
    ORCHESTRATOR_BIND_MODE: "direct",
    PATH: "C:/trusted/bin",
  });
  assert.equal(JSON.stringify(environment).includes(callerSentinel), false);
});

test("requires sustained ownership failures after service startup", () => {
  const policy = createOwnerWatchdogPolicy();

  assert.equal(policy.observe(false), false);
  assert.equal(policy.observe(false), false);
  assert.equal(policy.observe(true), false);
  assert.equal(policy.observe(false), false);
  assert.equal(policy.observe(false), false);
  assert.equal(policy.observe(false), true);
});

test("fails closed on an initial ownership failure", () => {
  const policy = createOwnerWatchdogPolicy();

  assert.equal(policy.observe(false, { initial: true }), true);
});
