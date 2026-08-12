import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadRootDevelopmentEnvironment } from "../src/root-environment.js";

const roots: string[] = [];
const sentinelName = "APTILOOP_ENV_LOAD_SENTINEL";

afterEach(() => {
  delete process.env[sentinelName];
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("root environment boundary", () => {
  it.each([undefined, "production", "test"])(
    "does not load .env in %s mode",
    (nodeEnvironment) => {
      const root = rootWithSentinel();
      loadRootDevelopmentEnvironment(root, nodeEnvironment);
      expect(process.env[sentinelName]).toBeUndefined();
    },
  );

  it("loads optional overrides only in explicit development mode", () => {
    const root = rootWithSentinel();
    loadRootDevelopmentEnvironment(root, "development");
    expect(process.env[sentinelName]).toBe("development-only");
  });
});

function rootWithSentinel(): string {
  const root = mkdtempSync(path.join(tmpdir(), "aptiloop-env-boundary-"));
  roots.push(root);
  writeFileSync(
    path.join(root, ".env"),
    `${sentinelName}=development-only\n`,
    "utf8",
  );
  return root;
}
