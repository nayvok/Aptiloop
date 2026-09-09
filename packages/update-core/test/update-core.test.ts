import { describe, expect, it } from "vitest";

import {
  validateArchiveEntryPath,
  validateArchiveInventory,
} from "../src/archive.js";
import { parseSha256Sums, verifyDigestForAsset } from "../src/checksum.js";
import {
  BOOTSTRAP_PROTOCOL,
  checkBootstrapCompatibility,
  parseVersionManifest,
} from "../src/manifest.js";
import {
  assetNameForPlatform,
  parseGithubRelease,
  selectReleaseAsset,
} from "../src/release.js";
import {
  compareVersions,
  normalizeVersion,
  parseTagVersion,
} from "../src/version.js";

describe("parseTagVersion", () => {
  it("accepts exact vMAJOR.MINOR.PATCH tags", () => {
    expect(parseTagVersion("v0.3.1")).toBe("0.3.1");
    expect(parseTagVersion("v1.0.0-rc.1")).toBe("1.0.0-rc.1");
  });

  it("rejects missing v prefix and malformed tags", () => {
    expect(() => parseTagVersion("0.3.1")).toThrow("Invalid release tag");
    expect(() => parseTagVersion("v1.2")).toThrow("Invalid release tag");
    expect(() => parseTagVersion("v1.2.3.4")).toThrow("Invalid release tag");
    expect(() => parseTagVersion("latest")).toThrow("Invalid release tag");
  });
});

describe("normalizeVersion/compareVersions", () => {
  it("compares numerically, not lexically", () => {
    expect(compareVersions("0.3.1", "0.3.10")).toBe(1);
    expect(compareVersions("0.3.10", "0.3.1")).toBe(-1);
    expect(compareVersions("0.3.1", "0.3.1")).toBe(0);
  });

  it("ranks stable above its own prerelease", () => {
    expect(compareVersions("1.0.0-rc.1", "1.0.0")).toBe(1);
    expect(compareVersions("1.0.0", "1.0.0-rc.1")).toBe(-1);
  });

  it("rejects non-semver input", () => {
    expect(() => normalizeVersion("1.2")).toThrow("Invalid version");
  });
});

describe("assetNameForPlatform", () => {
  it("selects the exact asset per OS/arch", () => {
    expect(assetNameForPlatform("win32", "x64")).toBe(
      "aptiloop-runtime-win32-x64.zip",
    );
    expect(assetNameForPlatform("darwin", "arm64")).toBe(
      "aptiloop-runtime-darwin-arm64.tar.gz",
    );
    expect(assetNameForPlatform("linux", "x64")).toBe(
      "aptiloop-runtime-linux-x64.tar.gz",
    );
  });

  it("fails before download on unsupported pairs", () => {
    expect(() => assetNameForPlatform("win32", "arm64")).toThrow(
      "Unsupported platform",
    );
    expect(() => assetNameForPlatform("freebsd", "x64")).toThrow(
      "Unsupported platform",
    );
  });
});

describe("parseGithubRelease/selectReleaseAsset", () => {
  const payload = (overrides = {}) => ({
    tag_name: "v0.3.1",
    name: "Aptiloop 0.3.1",
    body: "Notes",
    published_at: "2026-09-01T00:00:00Z",
    assets: [
      {
        name: "aptiloop-runtime-linux-x64.tar.gz",
        size: 10,
        browser_download_url: "https://example/a",
      },
      {
        name: "SHA256SUMS",
        size: 3,
        browser_download_url: "https://example/s",
      },
    ],
    ...overrides,
  });

  it("parses tag/version and keeps only well-formed assets", () => {
    const release = parseGithubRelease(payload());
    expect(release.version).toBe("0.3.1");
    expect(release.assets).toHaveLength(2);
  });
  it("rejects a response for a different requested tag", () => {
    expect(() =>
      parseGithubRelease(payload({ tag_name: "v0.3.2" }), "v0.3.1"),
    ).toThrow("tag mismatch");
  });

  it("rejects duplicate exact runtime assets", () => {
    const release = parseGithubRelease(
      payload({
        assets: [
          {
            name: "aptiloop-runtime-linux-x64.tar.gz",
            size: 10,
            browser_download_url: "https://example/a",
          },
          {
            name: "aptiloop-runtime-linux-x64.tar.gz",
            size: 11,
            browser_download_url: "https://example/b",
          },
        ],
      }),
    );
    expect(() => selectReleaseAsset(release, "linux", "x64")).toThrow(
      "duplicate",
    );
  });

  it("selects the single exact platform asset", () => {
    const release = parseGithubRelease(payload());
    expect(selectReleaseAsset(release, "linux", "x64").name).toBe(
      "aptiloop-runtime-linux-x64.tar.gz",
    );
    expect(() => selectReleaseAsset(release, "darwin", "arm64")).toThrow(
      "has no runtime asset",
    );
  });
});

describe("parseSha256Sums/verifyDigestForAsset", () => {
  it("verifies exact digests and refuses missing entries", () => {
    const sums = parseSha256Sums(`abc${"0".repeat(61)}  asset.tar.gz\n`);
    expect(sums.get("asset.tar.gz")).toBe(`abc${"0".repeat(61)}`);
    expect(() =>
      verifyDigestForAsset(sums, "other.tar.gz", `abc${"0".repeat(61)}`),
    ).toThrow("no SHA-256 entry");
    expect(() =>
      verifyDigestForAsset(sums, "asset.tar.gz", `f`.repeat(64)),
    ).toThrow("SHA-256 mismatch");
    verifyDigestForAsset(sums, "asset.tar.gz", `ABC${"0".repeat(61)}`);
  });
});

describe("validateArchiveEntryPath/validateArchiveInventory", () => {
  it("rejects traversal, absolute, drive-letter, and device names", () => {
    expect(() => validateArchiveEntryPath("../evil")).toThrow("unsafe segment");
    expect(() => validateArchiveEntryPath("/abs")).toThrow("absolute");
    expect(() => validateArchiveEntryPath("C:/win")).toThrow("absolute");
    expect(() => validateArchiveEntryPath("a\\b")).toThrow("backslash");
    expect(() => validateArchiveEntryPath("nul")).toThrow("device name");
    expect(() => validateArchiveEntryPath("COM1.txt")).toThrow("device name");
    expect(validateArchiveEntryPath("server/launcher.cjs")).toBe(
      "server/launcher.cjs",
    );
  });

  it("rejects symlinks, duplicates, and over-limit inventories", () => {
    expect(() =>
      validateArchiveInventory([{ path: "a", symlink: true, size: 1 }]),
    ).toThrow("symlink");
    expect(() =>
      validateArchiveInventory([
        { path: "a", symlink: false, size: 1 },
        { path: "a", symlink: false, size: 1 },
      ]),
    ).toThrow("duplicate");
    expect(() =>
      validateArchiveInventory([{ path: "a", symlink: false, size: 10 }], {
        maxEntries: 8,
        maxTotalBytes: 5,
        maxEntryBytes: 64,
      }),
    ).toThrow("exceeding");
  });
});

describe("parseVersionManifest/checkBootstrapCompatibility", () => {
  const files = { "runtime-cli.cjs": "a".repeat(64) };
  it("requires a complete file hash inventory", () => {
    expect(() =>
      parseVersionManifest({
        version: "0.3.1",
        bootstrapProtocol: 1,
        minBootstrapProtocol: 1,
      }),
    ).toThrow("files");
  });
  it("parses a valid manifest and rejects bad protocol ranges", () => {
    const manifest = parseVersionManifest({
      version: "0.3.1",
      bootstrapProtocol: 1,
      minBootstrapProtocol: 1,
      files,
    });
    expect(manifest.version).toBe("0.3.1");
    expect(() =>
      parseVersionManifest({
        version: "0.3.1",
        bootstrapProtocol: 1,
        minBootstrapProtocol: 2,
        files,
      }),
    ).toThrow("minBootstrapProtocol");
  });

  it("forwards newer compatible runtimes and never downgrades", () => {
    const manifest = parseVersionManifest({
      files,
      version: "0.4.0",
      bootstrapProtocol: BOOTSTRAP_PROTOCOL,
      minBootstrapProtocol: 1,
    });
    expect(checkBootstrapCompatibility("0.3.1", manifest)).toMatchObject({
      kind: "compatible",
      forward: true,
    });
    expect(checkBootstrapCompatibility("0.5.0", manifest)).toMatchObject({
      kind: "downgrade",
    });
  });

  it("asks to upgrade npm first when protocols diverge", () => {
    const manifest = parseVersionManifest({
      version: "0.4.0",
      bootstrapProtocol: 99,
      minBootstrapProtocol: 99,
      files,
    });
    const result = checkBootstrapCompatibility("0.3.1", manifest);
    expect(result.kind).toBe("incompatible");
    if (result.kind === "incompatible") {
      expect(result.reason).toMatch("Upgrade the aptiloop npm package");
    }
  });
});
