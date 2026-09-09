import { createHash } from "node:crypto";
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ensureExerciseBaseline } from "../src/git-baseline.js";
import {
  restoreExerciseAttempt,
  snapshotExerciseAttempt,
} from "../src/attempt-transfer.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map(
        async (directory) =>
          await rm(directory, { recursive: true, force: true }),
      ),
  );
});

describe("portable exercise attempt evidence", () => {
  it("round-trips tracked edits and untracked blobs onto a clean template", async () => {
    const { workspace, destination, baseline } = await fixture();
    await writeFile(path.join(workspace, "answer.ts"), "changed\n");
    await mkdir(path.join(workspace, "notes"));
    await writeFile(path.join(workspace, "notes", "draft file.txt"), "draft\n");

    const snapshot = await snapshotExerciseAttempt({
      workspaceRoot: workspace,
      trustedTemplateId: "exercise-template-1",
      baselineCommit: baseline,
    });
    const result = await restoreExerciseAttempt({
      destinationRoot: destination,
      snapshot,
      expectedBaselineCommit: baseline,
    });
    expect(result.restoredFiles).toBe(1);
    expect(result.totalBytes).toBeGreaterThan(6);
    await expect(
      readFile(path.join(destination, "answer.ts"), "utf8"),
    ).resolves.toBe("changed\n");
    await expect(
      readFile(path.join(destination, "notes", "draft file.txt"), "utf8"),
    ).resolves.toBe("draft\n");
  });

  it("rejects tampered patch and blob evidence before writing", async () => {
    const { workspace, destination, baseline } = await fixture();
    await writeFile(path.join(workspace, "answer.ts"), "changed\n");
    const snapshot = await snapshotExerciseAttempt({
      workspaceRoot: workspace,
      trustedTemplateId: "exercise-template-1",
      baselineCommit: baseline,
    });
    const tamperedPatch = `${snapshot.workingTreeDiff} "+tampered"`;
    await expect(
      restoreExerciseAttempt({
        destinationRoot: destination,
        expectedBaselineCommit: baseline,
        snapshot: {
          ...snapshot,
          workingTreeDiff: tamperedPatch,
          diffHash: sha256(tamperedPatch),
        },
      }),
    ).rejects.toThrow("Trusted Git patch was rejected");
    await expect(
      readFile(path.join(destination, "answer.ts"), "utf8"),
    ).resolves.toBe("template\n");
  });

  it("rejects patch paths that escape the workspace", async () => {
    const { destination, baseline } = await fixture();
    const patch = "diff --git a/../outside b/../outside\n";
    await expect(
      restoreExerciseAttempt({
        destinationRoot: destination,
        expectedBaselineCommit: baseline,
        snapshot: {
          trustedTemplateId: "exercise-template-1",
          baselineCommit: baseline,
          learnerCommits: [],
          workingTreeDiff: patch,
          untrackedBlobs: [],
          diffHash: sha256(patch),
          treeHash: sha256("tree"),
        },
      }),
    ).rejects.toThrow("escapes");
  });

  it("rejects secret-like patch content", async () => {
    const { destination, baseline } = await fixture();
    const patch = [
      "diff --git a/answer.ts b/answer.ts",
      "--- a/answer.ts",
      "+++ b/answer.ts",
      "@@ -1 +1 @@",
      '-const token = "sk-test-secret-value";',
      '+const token = "safe";',
      "",
    ].join("\n");
    await expect(
      restoreExerciseAttempt({
        destinationRoot: destination,
        expectedBaselineCommit: baseline,
        snapshot: {
          trustedTemplateId: "exercise-template-1",
          baselineCommit: baseline,
          learnerCommits: [],
          workingTreeDiff: patch,
          untrackedBlobs: [],
          diffHash: sha256(patch),
          treeHash: sha256("tree"),
        },
      }),
    ).rejects.toThrow("secret-like");
  });

  it("rejects a reparse-point ancestor before creating blob files", async () => {
    const { destination, baseline, root } = await fixture();
    const outside = path.join(root, "outside");
    await mkdir(outside);
    await symlink(
      outside,
      path.join(destination, "linked"),
      process.platform === "win32" ? "junction" : "dir",
    );
    const content = Buffer.from("draft\n");
    const blob = {
      path: "linked/draft.txt",
      sizeBytes: content.length,
      sha256: `sha256:${createHash("sha256").update(content).digest("hex")}`,
      contentBase64: content.toString("base64"),
    };
    const patch = "";
    await expect(
      restoreExerciseAttempt({
        destinationRoot: destination,
        expectedBaselineCommit: baseline,
        snapshot: {
          trustedTemplateId: "exercise-template-1",
          baselineCommit: baseline,
          learnerCommits: [],
          workingTreeDiff: patch,
          untrackedBlobs: [blob],
          diffHash: sha256(patch),
          treeHash: sha256(
            JSON.stringify({
              baselineCommit: baseline,
              diffHash: sha256(patch),
              blobs: [[blob.path, blob.sha256]],
            }),
          ),
        },
      }),
    ).rejects.toThrow(/symlink|reparse|outside/i);
    await expect(lstat(path.join(outside, "draft.txt"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
  it("rejects ignored secret-like files that are absent from transfer evidence", async () => {
    const { workspace, baseline } = await fixture();
    await writeFile(path.join(workspace, ".gitignore"), ".env\n");
    await writeFile(
      path.join(workspace, ".env"),
      "TOKEN=sk-test-secret-value\n",
    );
    await expect(
      snapshotExerciseAttempt({
        workspaceRoot: workspace,
        trustedTemplateId: "exercise-template-1",
        baselineCommit: baseline,
      }),
    ).rejects.toThrow(/ignored workspace file|secret/i);
  });
});

async function fixture(): Promise<{
  root: string;
  workspace: string;
  destination: string;
  baseline: string;
}> {
  const root = await mkdtemp(path.join(tmpdir(), "aptiloop-attempt-transfer-"));
  temporaryDirectories.push(root);
  const workspace = path.join(root, "workspace");
  const destination = path.join(root, "destination");
  await mkdir(workspace);
  await writeFile(path.join(workspace, "answer.ts"), "template\n");
  const baseline = (await ensureExerciseBaseline(workspace)).commit;
  await cp(workspace, destination, { recursive: true });
  return { root, workspace, destination, baseline };
}

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
