import { mkdtempSync, promises as fsp, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  acquireInstanceLock,
  candidatePortPairs,
  isAddrInUseMessage,
  probeAptiloopInstance,
  readPersistedPortConfig,
  releaseInstanceLock,
  resetPersistedPortConfig,
  resolvePortPlan,
  writePersistedPortConfig,
} from "../src/ports.js";

function tempDir(): string {
  return mkdtempSync(path.join(tmpdir(), "aptiloop-ports-"));
}

describe("resolvePortPlan", () => {
  it("uses preferred defaults as auto when nothing pins ports", () => {
    expect(resolvePortPlan({ env: {} })).toEqual({
      webPort: 10101,
      orchestratorPort: 8787,
      mode: "auto",
      source: "default",
    });
  });

  it("pins the pair on explicit flags and never hops", () => {
    const plan = resolvePortPlan({ flags: { web: 10101 }, env: {} });
    expect(plan.mode).toBe("fixed");
    expect(plan.source).toBe("flag");
    expect(candidatePortPairs(plan)).toHaveLength(1);
  });

  it("pins the pair on environment overrides", () => {
    const plan = resolvePortPlan({ env: { APTILOOP_PORT: "10101" } });
    expect(plan.mode).toBe("fixed");
    expect(plan.source).toBe("env");
    expect(candidatePortPairs(plan)).toHaveLength(1);
  });

  it("pins the pair on user-fixed persisted config", () => {
    const plan = resolvePortPlan({
      env: {},
      persisted: { webPort: 10101, orchestratorPort: 8787, portsMode: "fixed" },
    });
    expect(plan.mode).toBe("fixed");
    expect(plan.source).toBe("persisted");
  });

  it("stays auto on persisted-auto config", () => {
    const plan = resolvePortPlan({
      env: {},
      persisted: { webPort: 10105, orchestratorPort: 8791, portsMode: "auto" },
    });
    expect(plan).toMatchObject({
      webPort: 10105,
      mode: "auto",
      source: "persisted",
    });
  });

  it("pins a successfully selected automatic pair until reset", () => {
    const plan = resolvePortPlan({
      env: {},
      persisted: {
        webPort: 10105,
        orchestratorPort: 8791,
        portsMode: "auto",
        autoFallbackArmed: false,
      },
    });
    expect(plan).toMatchObject({
      webPort: 10105,
      orchestratorPort: 8791,
      mode: "fixed",
      source: "persisted",
    });
    expect(candidatePortPairs(plan)).toEqual([
      { webPort: 10105, orchestratorPort: 8791 },
    ]);
  });
});

describe("candidatePortPairs", () => {
  it("walks a bounded deterministic range for auto plans", () => {
    const plan = resolvePortPlan({ env: {} });
    const pairs = candidatePortPairs(plan, 2);
    expect(pairs).toEqual([
      { webPort: 10101, orchestratorPort: 8787 },
      { webPort: 10102, orchestratorPort: 8788 },
      { webPort: 10103, orchestratorPort: 8789 },
    ]);
  });
});

describe("persisted port config", () => {
  it("round-trips atomically and resets to preferred auto", async () => {
    const dir = tempDir();
    try {
      expect(await readPersistedPortConfig(dir)).toBeNull();
      await writePersistedPortConfig(dir, {
        webPort: 10105,
        orchestratorPort: 8791,
        portsMode: "auto",
      });
      expect(await readPersistedPortConfig(dir)).toMatchObject({
        webPort: 10105,
        orchestratorPort: 8791,
        portsMode: "auto",
      });
      const reset = await resetPersistedPortConfig(dir);
      expect(reset).toEqual({
        webPort: 10101,
        orchestratorPort: 8787,
        portsMode: "auto",
      });
      expect(await readPersistedPortConfig(dir)).toEqual(reset);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects out-of-range persistence", async () => {
    const dir = tempDir();
    try {
      await expect(
        writePersistedPortConfig(dir, {
          webPort: 99999,
          orchestratorPort: 8787,
          portsMode: "auto",
        }),
      ).rejects.toThrow("out-of-range");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("probeAptiloopInstance", () => {
  it("identifies an Aptiloop version endpoint and ignores strangers", async () => {
    const aptiloop = createServer((req, res) => {
      if (req.url === "/api/version") {
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            product: "Aptiloop",
            appVersion: "0.3.1",
            webOrigin: `http://127.0.0.1:${aptiloopPort}`,
            deploymentProfile: "installed-release",
          }),
        );
        return;
      }
      res.statusCode = 404;
      res.end();
    });
    await new Promise<void>((resolve) =>
      aptiloop.listen(0, "127.0.0.1", resolve),
    );
    const aptiloopPort = (aptiloop.address() as { port: number }).port;
    const stranger = createServer((req, res) => {
      res.statusCode = 200;
      res.end("not aptiloop");
    });
    await new Promise<void>((resolve) =>
      stranger.listen(0, "127.0.0.1", resolve),
    );
    const strangerPort = (stranger.address() as { port: number }).port;
    try {
      expect(
        await probeAptiloopInstance(`http://127.0.0.1:${aptiloopPort}`),
      ).toMatchObject({
        version: "0.3.1",
      });
      expect(
        await probeAptiloopInstance(`http://127.0.0.1:${strangerPort}`),
      ).toBeNull();
      expect(await probeAptiloopInstance("http://127.0.0.1:1")).toBeNull();
    } finally {
      aptiloop.close();
      stranger.close();
    }
  });

  it("rejects legacy or guessed version shapes for reuse detection", async () => {
    const legacy = createServer((req, res) => {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ app: "0.2.0" }));
    });
    await new Promise<void>((resolve) =>
      legacy.listen(0, "127.0.0.1", resolve),
    );
    const port = (legacy.address() as { port: number }).port;
    try {
      expect(
        await probeAptiloopInstance(`http://127.0.0.1:${port}`),
      ).toBeNull();
    } finally {
      legacy.close();
    }
  });
});
describe("isAddrInUseMessage", () => {
  it("classifies only bind collisions as collisions", () => {
    expect(
      isAddrInUseMessage(
        "listen EADDRINUSE: address already in use 127.0.0.1:10101",
      ),
    ).toBe(true);
    expect(isAddrInUseMessage("Error: address in use")).toBe(true);
    expect(
      isAddrInUseMessage(
        "Error: Only one usage of each socket address is normally permitted",
      ),
    ).toBe(true);
    expect(isAddrInUseMessage("Error: Cannot find module './server.js'")).toBe(
      false,
    );
    expect(isAddrInUseMessage("TypeError: fetch failed")).toBe(false);
    expect(isAddrInUseMessage("")).toBe(false);
  });
});

describe("acquireInstanceLock", () => {
  it("is create-only, rejects live duplicates, and recovers stale locks", async () => {
    const dir = tempDir();
    try {
      await acquireInstanceLock(dir);
      await expect(acquireInstanceLock(dir)).rejects.toThrow("Already running");
      await releaseInstanceLock(dir);
      await acquireInstanceLock(dir);
      await releaseInstanceLock(dir);
      await fsp.mkdir(path.join(dir, "runtime-state"), { recursive: true });
      await fsp.writeFile(
        path.join(dir, "runtime-state", "instance.lock"),
        JSON.stringify({ pid: 2_147_483_647, startedAt: "stale" }),
        { flag: "w" },
      );
      await acquireInstanceLock(dir);
      await releaseInstanceLock(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("never releases a peer-owned lock", async () => {
    const dir = tempDir();
    try {
      await fsp.mkdir(path.join(dir, "runtime-state"), { recursive: true });
      const lockFile = path.join(dir, "runtime-state", "instance.lock");
      await fsp.writeFile(
        lockFile,
        JSON.stringify({ pid: 2_147_483_647, startedAt: "peer" }),
      );
      await releaseInstanceLock(dir);
      expect(await fsp.readFile(lockFile, "utf8")).toContain("peer");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
