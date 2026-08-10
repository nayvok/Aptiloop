import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const launcherPath = path.join(projectRoot, "scripts", "dev-local.mjs");

function runLauncher(nodeEnv) {
  const root = mkdtempSync(path.join(tmpdir(), "aptiloop-local-launch-"));
  const npmExecPath = path.join(root, "capture-npm-exec.mjs");
  writeFileSync(
    npmExecPath,
    "console.log(JSON.stringify({ nodeEnv: process.env.NODE_ENV, arguments: process.argv.slice(2) }));\n",
    "utf8",
  );

  const environment = {
    ...process.env,
    npm_execpath: npmExecPath,
  };
  if (nodeEnv === undefined) {
    delete environment.NODE_ENV;
  } else {
    environment.NODE_ENV = nodeEnv;
  }

  try {
    const result = spawnSync(process.execPath, [launcherPath], {
      cwd: root,
      env: environment,
      encoding: "utf8",
      timeout: 10_000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    const output = result.stdout
      .split(/\r?\n/u)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    assert.equal(output.length, 1, result.stdout);
    return output[0];
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("defaults the local workspace launcher to explicit development mode", () => {
  assert.deepEqual(runLauncher(undefined), {
    nodeEnv: "development",
    arguments: ["exec", "--", "turbo", "run", "dev", "--parallel"],
  });
});

test("preserves an explicitly configured non-development mode", () => {
  assert.deepEqual(runLauncher("production"), {
    nodeEnv: "production",
    arguments: ["exec", "--", "turbo", "run", "dev", "--parallel"],
  });
});
