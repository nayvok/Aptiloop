import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import {
  createUpdateManager,
  UpdateOperationSchema,
} from "../src/update-manager.js";

import {
  registerSystemRoutes,
  readAppVersion,
  resolveDeploymentProfile,
} from "../src/system.js";

function testApp(projectRoot: string): Hono {
  const app = new Hono();
  registerSystemRoutes(app, {
    projectRoot,
    webOrigin: "http://127.0.0.1:10101",
    orchestratorPort: 8787,
    databasePath: path.join(
      projectRoot,
      ".data",
      "dev-learning-harness.sqlite",
    ),
  });
  return app;
}

describe("resolveDeploymentProfile", () => {
  it("prefers explicit config over bind mode", () => {
    expect(resolveDeploymentProfile("compose", "direct")).toBe("compose");
    expect(
      resolveDeploymentProfile(undefined, "container-loopback-published"),
    ).toBe("compose");
    expect(resolveDeploymentProfile(undefined, "direct")).toBe(
      "source-checkout",
    );
    expect(() => resolveDeploymentProfile("cloud", "direct")).toThrow();
  });
  it("selects installed-release only from explicit installed state", () => {
    expect(resolveDeploymentProfile(undefined, "direct", true)).toBe(
      "installed-release",
    );
    expect(resolveDeploymentProfile(undefined, "direct", false)).toBe(
      "source-checkout",
    );
  });
});

describe("UpdateOperationSchema", () => {
  const operationId = "123e4567-e89b-12d3-a456-426614174000";
  const startedAt = "2026-09-01T00:00:00.000Z";
  const finishedAt = "2026-09-01T00:01:00.000Z";

  it("requires coherent phase and terminal timestamps", () => {
    expect(
      UpdateOperationSchema.safeParse({
        operationId,
        tag: "v0.1.0",
        state: "queued",
        phase: "backup",
        startedAt,
      }).success,
    ).toBe(false);
    expect(
      UpdateOperationSchema.safeParse({
        operationId,
        tag: "v0.1.0",
        state: "running",
        phase: "backup",
        startedAt,
        finishedAt,
      }).success,
    ).toBe(false);
    expect(
      UpdateOperationSchema.safeParse({
        operationId,
        tag: "v0.1.0",
        state: "succeeded",
        phase: "restart",
        startedAt,
      }).success,
    ).toBe(false);
    expect(
      UpdateOperationSchema.safeParse({
        operationId,
        tag: "v0.1.0",
        state: "succeeded",
        phase: "restart",
        startedAt,
        finishedAt,
      }).success,
    ).toBe(true);
  });
});

describe("update manager operation safety", () => {
  const firstOperationId = "123e4567-e89b-12d3-a456-426614174000";
  const secondOperationId = "123e4567-e89b-12d3-a456-426614174001";

  function managerFor(dataDir: string, workers: EventEmitter[]) {
    return createUpdateManager({
      dataDir,
      stableCliEntry: path.join(dataDir, "launcher.cjs"),
      detachedWorkerEntry: path.join(dataDir, "update-worker.mjs"),
      currentVersion: "0.1.0",
      databasePath: path.join(dataDir, "database.sqlite"),
      spawnProcess: (() => {
        const worker = new EventEmitter();
        (worker as EventEmitter & { unref: () => void }).unref = () =>
          undefined;
        workers.push(worker);
        return worker;
      }) as never,
    });
  }

  it("creates one queued operation for concurrent identical applies", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "aptiloop-update-race-"));
    const workers: EventEmitter[] = [];
    try {
      const manager = managerFor(root, workers);
      const operations = await Promise.all([
        manager.apply("v0.2.0", firstOperationId),
        manager.apply("v0.2.0", firstOperationId),
      ]);
      expect(operations[0]).toEqual(operations[1]);
      expect(workers).toHaveLength(1);
      await expect(manager.operation(firstOperationId)).resolves.toEqual(
        operations[0],
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails a distinct concurrent operation instead of queueing a second update", async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "aptiloop-update-distinct-"),
    );
    const workers: EventEmitter[] = [];
    try {
      const manager = managerFor(root, workers);
      const operations = await Promise.all([
        manager.apply("v0.2.0", firstOperationId),
        manager.apply("v0.2.1", secondOperationId),
      ]);
      expect(operations[0]).toMatchObject({
        operationId: firstOperationId,
        state: "queued",
      });
      expect(operations[1]).toMatchObject({
        operationId: secondOperationId,
        tag: "v0.2.1",
        state: "failed",
        phase: "rollback",
        finishedAt: expect.any(String),
      });
      expect(workers).toHaveLength(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("allows a retry after the previous worker records terminal failure", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "aptiloop-update-retry-"));
    const workers: EventEmitter[] = [];
    try {
      const manager = managerFor(root, workers);
      const queued = await manager.apply("v0.2.0", firstOperationId);
      await writeFile(
        path.join(root, "updates", "operations", `${firstOperationId}.json`),
        JSON.stringify({
          ...queued,
          state: "failed",
          phase: "rollback",
          finishedAt: new Date().toISOString(),
          message: "worker failed before cutover",
        }),
      );
      const retry = await manager.apply("v0.2.1", secondOperationId);
      expect(retry).toMatchObject({
        operationId: secondOperationId,
        state: "queued",
      });
      expect(workers).toHaveLength(2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects malformed persisted operation records", async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "aptiloop-update-malformed-"),
    );
    try {
      const operationId = firstOperationId;
      const operationPath = path.join(
        root,
        "updates",
        "operations",
        `${operationId}.json`,
      );
      await mkdir(path.dirname(operationPath), { recursive: true });
      await writeFile(
        operationPath,
        JSON.stringify({ operationId, state: "queued" }),
      );
      await expect(managerFor(root, []).operation(operationId)).rejects.toThrow(
        "Persisted update operation is invalid",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("records a failed terminal operation when worker spawning emits an error", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "aptiloop-update-spawn-"));
    const workers: EventEmitter[] = [];
    try {
      const manager = managerFor(root, workers);
      await manager.apply("v0.2.0", firstOperationId);
      workers[0]!.emit("error", new Error("worker missing"));
      await expect
        .poll(async () => manager.operation(firstOperationId), {
          timeout: 1_000,
        })
        .toMatchObject({
          state: "failed",
          phase: "rollback",
        });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("readAppVersion", () => {
  it("reads the version from a package.json root", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "aptiloop-version-test-"));
    try {
      await writeFile(
        path.join(root, "package.json"),
        JSON.stringify({ version: "9.9.9" }),
      );
      expect(readAppVersion(root, {})).toBe("9.9.9");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("prefers the explicit environment override", () => {
    expect(
      readAppVersion("/nonexistent", { APTILOOP_APP_VERSION: "1.2.3" }),
    ).toBe("1.2.3");
  });

  it("falls back to an explicit unknown marker", () => {
    expect(readAppVersion("/nonexistent", {})).toBe("0.0.0-dev");
  });
});

describe("system routes", () => {
  it("reports version metadata for the update channel", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "aptiloop-version-test-"));
    try {
      await writeFile(
        path.join(root, "package.json"),
        JSON.stringify({ version: "0.1.0" }),
      );
      const response = await testApp(root).request("/api/version");
      expect(response.status).toBe(200);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body.product).toBe("Aptiloop");
      expect(body.appVersion).toBe("0.1.0");
      expect(body.validatorVersion).toBe("m3-v3");
      expect(typeof body.migrationHead).toBe("string");
      expect(body.webOrigin).toBe("http://127.0.0.1:10101");
      expect(body.channel).toBe("github-releases");
      expect(body.deploymentProfile).toBe("source-checkout");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reports read-only runtime facts for Settings", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "aptiloop-runtime-test-"));
    try {
      const response = await testApp(root).request("/api/system/runtime");
      expect(response.status).toBe(200);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body.webOrigin).toBe("http://127.0.0.1:10101");
      expect(body.webPort).toBe(10101);
      expect(body.orchestratorPort).toBe(8787);
      expect(body.dataDir).toBe(path.join(root, ".data"));
      expect(body.deploymentProfile).toBe("source-checkout");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reports real autostart state without mutating", async () => {
    const response = await testApp(tmpdir()).request("/api/system/autostart");
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(typeof body.installed).toBe("boolean");
    expect(typeof body.enabled).toBe("boolean");
    expect(typeof body.detail).toBe("string");
  });
  it("refuses autostart mutation without a built CLI bundle", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "aptiloop-autostart-test-"));
    try {
      const response = await testApp(root).request("/api/system/autostart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operationId: "123e4567-e89b-12d3-a456-426614174000",
          autostart: true,
        }),
      });
      expect(response.status).toBe(409);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("refuses source-checkout update apply without mutating a pointer", async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "aptiloop-source-update-test-"),
    );
    try {
      const response = await testApp(root).request("/api/system/update/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operationId: "123e4567-e89b-12d3-a456-426614174000",
          tag: "v0.2.0",
        }),
      });
      expect(response.status).toBe(409);
      const body = (await response.json()) as { error?: string };
      expect(body.error).toContain("Source-checkout updates are disabled");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses in-memory update apply even for an installed profile", async () => {
    const app = new Hono();
    registerSystemRoutes(app, {
      projectRoot: "/tmp/aptiloop-installed",
      webOrigin: "http://127.0.0.1:10101",
      orchestratorPort: 8787,
      databasePath: ":memory:",
      installedRelease: true,
    });
    const response = await app.request("/api/system/update/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        operationId: "123e4567-e89b-12d3-a456-426614174000",
        tag: "v0.2.0",
      }),
    });
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error?: string };
    expect(body.error).toContain("file-backed database");
  });
});
