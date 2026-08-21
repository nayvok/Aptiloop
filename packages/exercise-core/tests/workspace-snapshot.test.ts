import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { snapshotCompleteWorkspace } from "../src/workspace-snapshot.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function workspace() {
  const root = await mkdtemp(path.join(os.tmpdir(), "aptiloop-snapshot-"));
  roots.push(root);
  return root;
}

describe("complete workspace snapshots", () => {
  it("hashes hidden, ignored, untracked, and build files deterministically", async () => {
    const root = await workspace();
    await mkdir(path.join(root, ".git"));
    await mkdir(path.join(root, "build"));
    await mkdir(path.join(root, "node_modules"));
    await writeFile(path.join(root, ".hidden"), "hidden-v1", "utf8");
    await writeFile(
      path.join(root, ".gitignore"),
      "ignored.log\nbuild/\n",
      "utf8",
    );
    await writeFile(path.join(root, "ignored.log"), "ignored-v1", "utf8");
    await writeFile(path.join(root, "untracked.txt"), "untracked-v1", "utf8");
    await writeFile(path.join(root, "build", "result.js"), "build-v1", "utf8");
    await writeFile(
      path.join(root, ".git", "HEAD"),
      "ignored metadata",
      "utf8",
    );
    await writeFile(
      path.join(root, "node_modules", "dependency.js"),
      "installed environment input",
      "utf8",
    );

    const first = await snapshotCompleteWorkspace(root);
    const second = await snapshotCompleteWorkspace(root);

    expect(second).toEqual(first);
    expect(first.files.map((file) => file.documentId)).toEqual([
      ".gitignore",
      ".hidden",
      "build/result.js",
      "ignored.log",
      "untracked.txt",
    ]);
    expect(first.files).not.toContainEqual(
      expect.objectContaining({ documentId: ".git/HEAD" }),
    );
    expect(first.files).not.toContainEqual(
      expect.objectContaining({ documentId: "node_modules/dependency.js" }),
    );

    await writeFile(path.join(root, ".hidden"), "hidden-v2", "utf8");
    const changed = await snapshotCompleteWorkspace(root);
    expect(changed.contentHash).not.toBe(first.contentHash);
  });

  it("orders snapshot entries by Unicode code units instead of locale collation", async () => {
    const root = await workspace();
    await writeFile(path.join(root, "alpha.txt"), "lower", "utf8");
    await writeFile(path.join(root, "Bravo.txt"), "upper", "utf8");

    const snapshot = await snapshotCompleteWorkspace(root);

    expect(snapshot.files.map((file) => file.documentId)).toEqual([
      "Bravo.txt",
      "alpha.txt",
    ]);
  });

  it("fails closed when a complete snapshot exceeds a declared limit", async () => {
    const root = await workspace();
    await writeFile(path.join(root, "large.txt"), "12345", "utf8");

    await expect(
      snapshotCompleteWorkspace(root, { maxFileBytes: 4 }),
    ).rejects.toThrow("Workspace file exceeds the size limit: large.txt");
    await expect(
      snapshotCompleteWorkspace(root, { maxTotalBytes: 4 }),
    ).rejects.toThrow("Workspace exceeds the total byte limit");
  });
});
