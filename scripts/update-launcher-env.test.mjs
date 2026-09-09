import assert from "node:assert/strict";
import test from "node:test";

import { stableLauncherEnvironment } from "./update-launcher-env.mjs";

test("stable launcher ignores inherited release and runtime authorities", () => {
  const environment = stableLauncherEnvironment(
    {
      APTILOOP_RELEASE_ROOT: "C:/old-release",
      APTILOOP_DATA_DIR: "C:/old-data",
      DATABASE_PATH: "C:/old.sqlite",
      DATABASE_URL: "C:/old.sqlite",
      APTILOOP_PORT: "39301",
      APTILOOP_ORCHESTRATOR_PORT: "39302",
      HOST: "0.0.0.0",
      PORT: "39302",
      WEB_ORIGIN: "http://127.0.0.1:39301",
      ORCHESTRATOR_URL: "http://127.0.0.1:39302",
      NODE_ENV: "production",
    },
    "C:/runtime",
    "C:/runtime/launcher.cjs",
  );

  assert.equal(environment.APTILOOP_RELEASE_ROOT, undefined);
  assert.equal(environment.DATABASE_PATH, undefined);
  assert.equal(environment.DATABASE_URL, undefined);
  assert.equal(environment.APTILOOP_DATA_DIR, undefined);
  assert.equal(environment.APTILOOP_RUNTIME_ROOT, "C:/runtime");
  assert.equal(
    environment.APTILOOP_RUNTIME_LAUNCHER,
    "C:/runtime/launcher.cjs",
  );
  assert.equal(environment.APTILOOP_BOOTSTRAP_ENTRY, "C:/runtime/launcher.cjs");
  assert.equal(environment.NODE_ENV, "production");
});
