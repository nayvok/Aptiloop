import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  downloadAsset,
  compareVersions,
  parseSha256Sums,
} from "../src/update.js";
import { selectRuntimeAction } from "../src/ensure-runtime.js";
import {
  defaultOsDataDir,
  defaultRuntimeRoot,
  findSourceCheckoutRoot,
  parsePort,
  resolveDataDir,
  resolvePorts,
  resolveRuntimeConfig,
  resolveRuntimeRoot,
} from "../src/config.js";

describe("parsePort", () => {
  it("returns the fallback for empty input", () => {
    expect(parsePort(undefined, "APTILOOP_PORT", 10101)).toBe(10101);
    expect(parsePort("  ", "APTILOOP_PORT", 10101)).toBe(10101);
  });

  it("accepts a valid override", () => {
    expect(parsePort("10202", "APTILOOP_PORT", 10101)).toBe(10202);
  });

  it("rejects out-of-range ports", () => {
    expect(() => parsePort("0", "APTILOOP_PORT", 10101)).toThrow(
      "APTILOOP_PORT must be an integer TCP port 1-65535",
    );
    expect(() => parsePort("99999", "APTILOOP_PORT", 10101)).toThrow(
      "APTILOOP_PORT must be an integer TCP port 1-65535",
    );
    expect(() => parsePort("abc", "APTILOOP_PORT", 10101)).toThrow(
      "APTILOOP_PORT must be an integer TCP port 1-65535",
    );
  });
});

describe("resolvePorts", () => {
  it("prefers explicit flags over environment over defaults", () => {
    expect(
      resolvePorts({ web: 11111, env: { APTILOOP_PORT: "12222" } }),
    ).toEqual({ web: 11111, orchestrator: 8787 });
    expect(resolvePorts({ env: { APTILOOP_PORT: "12222" } })).toEqual({
      web: 12222,
      orchestrator: 8787,
    });
    expect(resolvePorts({ env: {} })).toEqual({
      web: 10101,
      orchestrator: 8787,
    });
  });
});

describe("resolveDataDir", () => {
  it("orders explicit > env > persisted pointer > checkout > OS default", () => {
    expect(
      resolveDataDir({
        explicit: path.join("custom-root", "custom"),
        env: { APTILOOP_DATA_DIR: path.join("env-root", "env") },
        persisted: path.join("pointer-root", "pointer"),
        sourceCheckoutRoot: path.join("repo-root", "repo"),
      }),
    ).toBe(path.resolve(path.join("custom-root", "custom")));
    expect(
      resolveDataDir({
        env: { APTILOOP_DATA_DIR: path.join("env-root", "env") },
        persisted: path.join("pointer-root", "pointer"),
        sourceCheckoutRoot: path.join("repo-root", "repo"),
      }),
    ).toBe(path.resolve(path.join("env-root", "env")));
    expect(
      resolveDataDir({
        env: {},
        persisted: path.join("pointer-root", "pointer"),
        sourceCheckoutRoot: path.join("repo-root", "repo"),
      }),
    ).toBe(path.resolve(path.join("pointer-root", "pointer")));
    expect(
      resolveDataDir({
        env: {},
        sourceCheckoutRoot: path.join("repo-root", "repo"),
      }),
    ).toBe(path.join("repo-root", "repo", ".data"));
    expect(
      resolveDataDir({ env: {}, sourceCheckoutRoot: null }).length,
    ).toBeGreaterThan(0);
  });
});

describe("resolveRuntimeConfig", () => {
  const fsProbe = { existsSync: () => false };

  it("builds loopback origins and runtime paths", () => {
    const config = resolveRuntimeConfig({
      env: {},
      cwd: path.join("nowhere-root", "nowhere"),
      fs: fsProbe,
    });
    expect(config.webOrigin).toBe("http://127.0.0.1:10101");
    expect(config.orchestratorUrl).toBe("http://127.0.0.1:8787");
    expect(config.pidFile).toBe(
      path.join(config.dataDir, "runtime-state", "aptiloop.pid"),
    );
    expect(config.lockFile).toBe(
      path.join(config.dataDir, "runtime-state", "instance.lock"),
    );
    expect(config.sourceCheckoutRoot).toBeNull();
  });

  it("detects a source checkout for the repo-local data dir", () => {
    const root = path.resolve(path.join("checkout-root", "repo"));
    const markers = new Set([
      path.join(root, "apps", "orchestrator"),
      path.join(root, "apps", "web"),
      path.join(root, "scripts"),
    ]);
    const config = resolveRuntimeConfig({
      env: {},
      cwd: path.join(root, "apps", "web"),
      fs: {
        existsSync: (candidate) => markers.has(candidate),
      },
    });
    expect(config.sourceCheckoutRoot).toBe(root);
    expect(config.dataDir).toBe(path.join(root, ".data"));
  });
});

describe("defaultOsDataDir", () => {
  it("uses platform homes", () => {
    expect(defaultOsDataDir("win32")).toContain("Aptiloop");
    expect(defaultOsDataDir("darwin")).toContain("Application Support");
    expect(defaultOsDataDir("linux")).toContain(".local");
  });
});

describe("defaultRuntimeRoot", () => {
  it("separates immutable runtime from learner data per platform", () => {
    expect(defaultRuntimeRoot("darwin")).toContain(
      path.join("Application Support", "Aptiloop", "runtime"),
    );
    expect(defaultRuntimeRoot("linux")).toContain(
      path.join("aptiloop", "runtime"),
    );
    expect(defaultRuntimeRoot("win32")).toContain(
      path.join("Aptiloop", "runtime"),
    );
  });

  it("prefers APTILOOP_RUNTIME_ROOT and XDG_DATA_HOME", () => {
    expect(
      resolveRuntimeRoot({ env: { APTILOOP_RUNTIME_ROOT: "/custom/rt" } }),
    ).toBe(path.resolve("/custom/rt"));
    expect(
      resolveRuntimeRoot({
        env: { XDG_DATA_HOME: "/xdg" },
        platformName: "linux",
      }),
    ).toBe(path.join("/xdg", "aptiloop", "runtime"));
  });
});

describe("findSourceCheckoutRoot", () => {
  it("returns null without markers", () => {
    expect(
      findSourceCheckoutRoot("/nowhere", { existsSync: () => false }),
    ).toBeNull();
  });
});

describe("compareVersions", () => {
  it("orders semver triples", () => {
    expect(compareVersions("0.1.0", "0.2.0")).toBe(1);
    expect(compareVersions("0.2.0", "0.1.0")).toBe(-1);
    expect(compareVersions("0.1.0", "0.1.0")).toBe(0);
  });
});
describe("selectRuntimeAction", () => {
  const manifest = {
    version: "0.3.0",
    bootstrapProtocol: 1,
    minBootstrapProtocol: 1,
    files: { "runtime-cli.cjs": "a".repeat(64) },
  } as const;

  it("installs the exact bootstrap version when installed runtime is older", () => {
    expect(selectRuntimeAction("0.3.0", "0.2.0", manifest)).toBe("install");
  });
  it("reuses an equal compatible runtime", () => {
    expect(selectRuntimeAction("0.3.0", "0.3.0", manifest)).toBe("reuse");
  });
  it("forwards a newer compatible runtime without downgrading", () => {
    expect(selectRuntimeAction("0.3.0", "0.4.0", manifest)).toBe("forward");
  });
  it("fails closed when the runtime protocol is incompatible", () => {
    expect(() =>
      selectRuntimeAction("0.3.0", "0.4.0", {
        ...manifest,
        bootstrapProtocol: 2,
        minBootstrapProtocol: 2,
      }),
    ).toThrow("Upgrade the aptiloop npm package");
  });
});

describe("parseSha256Sums", () => {
  it("parses BSD-style checksum lines", () => {
    const sums = parseSha256Sums(
      `${"a".repeat(64)}  bundle.tar.gz\n${"b".repeat(64)} *other.zip\n`,
    );
    expect(sums.get("bundle.tar.gz")).toBe("a".repeat(64));
    expect(sums.get("other.zip")).toBe("b".repeat(64));
  });
});
describe("downloadAsset", () => {
  it("preserves an existing destination when create-only open fails", async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), "aptiloop-download-"));
    const destination = path.join(dir, "asset.bin");
    await fs.writeFile(destination, "existing", "utf8");
    await expect(
      downloadAsset("data:text/plain,download", destination),
    ).rejects.toThrow();
    await expect(fs.readFile(destination, "utf8")).resolves.toBe("existing");
    await fs.rm(dir, { recursive: true, force: true });
  });
});
