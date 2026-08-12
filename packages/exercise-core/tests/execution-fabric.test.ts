import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  CORE_NODE_ENVIRONMENT_ID,
  CORE_NODE_TEST_CHECK_ID,
  CORE_PYTHON_ENVIRONMENT_ID,
  CORE_PYTHON_TEST_CHECK_ID,
  LEGACY_NODE_ENVIRONMENT_ID,
  LEGACY_NODE_TEST_CHECK_ID,
  createCoreExecutionFabric,
} from "../src/execution-fabric.js";
import { snapshotCompleteWorkspace } from "../src/workspace-snapshot.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function workspace() {
  const root = await mkdtemp(path.join(os.tmpdir(), "aptiloop-fabric-"));
  roots.push(root);
  await writeFile(path.join(root, "input.txt"), "learner input", "utf8");
  return root;
}

function fabric() {
  return createCoreExecutionFabric({
    legacyNodeTestPlan: {
      executable: process.execPath,
      args: ["-e", "process.stdout.write('trusted check passed')"],
      timeoutMs: 5_000,
      maxOutputBytes: 1_000,
    },
  });
}

describe("trusted Execution Fabric", () => {
  it("cancels and drains a hanging trusted check during shutdown", async () => {
    const current = createCoreExecutionFabric({
      legacyNodeTestPlan: {
        executable: process.execPath,
        args: ["-e", "setInterval(() => {}, 1000)"],
        timeoutMs: 60_000,
        maxOutputBytes: 1_000,
      },
    });
    const root = await workspace();
    const pending = current.run({
      operationId: "operation-shutdown",
      attemptId: "attempt-shutdown",
      courseRevisionId: "revision-1",
      activityId: "activity-shutdown",
      workspacePath: root,
      environmentId: LEGACY_NODE_ENVIRONMENT_ID,
      checkIds: [LEGACY_NODE_TEST_CHECK_ID],
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    const firstClose = current.close();
    const repeatedClose = current.close();
    expect(repeatedClose).toBe(firstClose);
    await expect(firstClose).resolves.toBeUndefined();
    await expect(pending).resolves.toMatchObject({ status: "cancelled" });
    await expect(
      current.run({
        operationId: "operation-after-shutdown",
        attemptId: "attempt-shutdown",
        courseRevisionId: "revision-1",
        activityId: "activity-shutdown",
        workspacePath: root,
        environmentId: LEGACY_NODE_ENVIRONMENT_ID,
        checkIds: [LEGACY_NODE_TEST_CHECK_ID],
      }),
    ).rejects.toThrow("Execution Fabric is shutting down");
  });

  it("resolves only installed environment and check IDs", async () => {
    const current = fabric();
    const descriptors = current.listEnvironments();

    expect(descriptors.map((descriptor) => descriptor.id)).toEqual([
      LEGACY_NODE_ENVIRONMENT_ID,
      CORE_NODE_ENVIRONMENT_ID,
      "apt.core.python3.local.v1",
    ]);
    expect(
      current.describeEnvironment(LEGACY_NODE_ENVIRONMENT_ID),
    ).toMatchObject({
      trust: "trusted-local-unsandboxed",
      checks: [{ id: LEGACY_NODE_TEST_CHECK_ID, contractVersion: 1 }],
      digest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
    });

    const root = await workspace();
    await expect(
      current.run({
        operationId: "operation-unknown-check",
        attemptId: "attempt-1",
        courseRevisionId: "revision-1",
        activityId: "activity-1",
        workspacePath: root,
        environmentId: LEGACY_NODE_ENVIRONMENT_ID,
        checkIds: [CORE_NODE_TEST_CHECK_ID],
      }),
    ).rejects.toThrow(
      `Unknown check ID for environment ${LEGACY_NODE_ENVIRONMENT_ID}: ${CORE_NODE_TEST_CHECK_ID}`,
    );
  });

  it("binds a structured result and artifacts to the exact input snapshot", async () => {
    const current = fabric();
    const root = await workspace();
    const input = await snapshotCompleteWorkspace(root);

    const result = await current.run({
      operationId: "operation-pass",
      attemptId: "attempt-1",
      courseRevisionId: "revision-1",
      activityId: "activity-1",
      workspacePath: root,
      environmentId: LEGACY_NODE_ENVIRONMENT_ID,
      checkIds: [LEGACY_NODE_TEST_CHECK_ID],
      expectedInputSnapshotHash: input.contentHash,
    });

    expect(result).toMatchObject({
      schemaVersion: 1,
      operationId: "operation-pass",
      backendId: "local-native",
      environmentId: LEGACY_NODE_ENVIRONMENT_ID,
      inputSnapshotHash: input.contentHash,
      status: "passed",
      checks: [
        {
          checkId: LEGACY_NODE_TEST_CHECK_ID,
          status: "passed",
          artifactIds: [`artifact:operation-pass:${LEGACY_NODE_TEST_CHECK_ID}`],
        },
      ],
      truncated: false,
    });
    expect(result.artifacts).toEqual([
      expect.objectContaining({
        id: `artifact:operation-pass:${LEGACY_NODE_TEST_CHECK_ID}`,
        type: "process-log",
        digest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
        content: "trusted check passed",
        truncated: false,
      }),
    ]);
  });

  it("rejects stale snapshots before spawning a trusted check", async () => {
    const current = fabric();
    const root = await workspace();
    const input = await snapshotCompleteWorkspace(root);
    await writeFile(
      path.join(root, "input.txt"),
      "changed after request",
      "utf8",
    );

    await expect(
      current.run({
        operationId: "operation-stale",
        attemptId: "attempt-1",
        courseRevisionId: "revision-1",
        activityId: "activity-1",
        workspacePath: root,
        environmentId: LEGACY_NODE_ENVIRONMENT_ID,
        checkIds: [LEGACY_NODE_TEST_CHECK_ID],
        expectedInputSnapshotHash: input.contentHash,
      }),
    ).rejects.toThrow("Execution request snapshot is stale");
  });

  it("returns an explicit unsupported result instead of changing environments", async () => {
    const current = fabric();
    const root = await workspace();

    const result = await current.run({
      operationId: "operation-unsupported",
      attemptId: "attempt-1",
      courseRevisionId: "revision-1",
      activityId: "activity-1",
      workspacePath: root,
      environmentId: CORE_NODE_ENVIRONMENT_ID,
      checkIds: [CORE_NODE_TEST_CHECK_ID],
    });

    expect(result).toMatchObject({
      environmentId: CORE_NODE_ENVIRONMENT_ID,
      status: "unsupported_environment",
      checks: [],
      artifacts: [],
      diagnostics: [
        {
          code: "unsupported_environment",
          severity: "error",
          message: "Node environment requires a valid package-lock.json",
        },
      ],
    });
  });
  it("normalizes trusted Node check success and failure", async () => {
    const current = fabric();
    const root = await workspace();
    await writeFile(
      path.join(root, "package-lock.json"),
      JSON.stringify({
        name: "execution-fixture",
        version: "1.0.0",
        lockfileVersion: 3,
        packages: {},
      }),
      "utf8",
    );
    const testPath = path.join(root, "contract.test.mjs");
    await writeFile(
      testPath,
      "import assert from 'node:assert/strict'; import test from 'node:test'; test('contract', () => assert.equal(1, 1));",
      "utf8",
    );

    const passed = await current.run({
      operationId: "operation-node-pass",
      attemptId: "attempt-node",
      courseRevisionId: "revision-1",
      activityId: "activity-node",
      workspacePath: root,
      environmentId: CORE_NODE_ENVIRONMENT_ID,
      checkIds: [CORE_NODE_TEST_CHECK_ID],
    });
    expect(passed).toMatchObject({
      status: "passed",
      checks: [{ checkId: CORE_NODE_TEST_CHECK_ID, status: "passed" }],
    });

    await writeFile(
      testPath,
      "import assert from 'node:assert/strict'; import test from 'node:test'; test('contract', () => assert.equal(1, 2));",
      "utf8",
    );
    const failed = await current.run({
      operationId: "operation-node-fail",
      attemptId: "attempt-node",
      courseRevisionId: "revision-1",
      activityId: "activity-node",
      workspacePath: root,
      environmentId: CORE_NODE_ENVIRONMENT_ID,
      checkIds: [CORE_NODE_TEST_CHECK_ID],
    });
    expect(failed).toMatchObject({
      status: "failed",
      checks: [{ checkId: CORE_NODE_TEST_CHECK_ID, status: "failed" }],
    });
  });

  it("normalizes trusted Python contract success and failure", async () => {
    const current = createCoreExecutionFabric({
      legacyNodeTestPlan: {
        executable: process.execPath,
        args: ["-e", "process.exit(0)"],
        timeoutMs: 5_000,
        maxOutputBytes: 1_000,
      },
      pythonTestPlan: {
        executable: process.execPath,
        args: [
          "-e",
          "const fs=require('node:fs'); const result=fs.readFileSync('python-result.txt','utf8').trim(); process.stdout.write(result); process.exit(result === 'pass' ? 0 : 1);",
        ],
        timeoutMs: 5_000,
        maxOutputBytes: 1_000,
      },
    });
    const root = await workspace();
    await writeFile(path.join(root, "requirements.lock"), "", "utf8");
    const resultPath = path.join(root, "python-result.txt");
    await writeFile(resultPath, "pass", "utf8");

    const passed = await current.run({
      operationId: "operation-python-pass",
      attemptId: "attempt-python",
      courseRevisionId: "revision-1",
      activityId: "activity-python",
      workspacePath: root,
      environmentId: CORE_PYTHON_ENVIRONMENT_ID,
      checkIds: [CORE_PYTHON_TEST_CHECK_ID],
    });
    expect(passed).toMatchObject({
      status: "passed",
      checks: [{ checkId: CORE_PYTHON_TEST_CHECK_ID, status: "passed" }],
    });

    await writeFile(resultPath, "fail", "utf8");
    const failed = await current.run({
      operationId: "operation-python-fail",
      attemptId: "attempt-python",
      courseRevisionId: "revision-1",
      activityId: "activity-python",
      workspacePath: root,
      environmentId: CORE_PYTHON_ENVIRONMENT_ID,
      checkIds: [CORE_PYTHON_TEST_CHECK_ID],
    });
    expect(failed).toMatchObject({
      status: "failed",
      checks: [{ checkId: CORE_PYTHON_TEST_CHECK_ID, status: "failed" }],
    });
  });
});
