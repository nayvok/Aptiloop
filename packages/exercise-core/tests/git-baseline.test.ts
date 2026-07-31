import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  ensureExerciseBaseline,
  getExerciseDiff,
} from "../src/git-baseline.js";

const temporaryDirectories: string[] = [];
const gitAvailable = hasGit();

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

describe.skipIf(!gitAvailable)("exercise Git baseline", () => {
  it("creates an idempotent repository scoped to one exercise", async () => {
    const root = await temporaryDirectory();
    await writeFile(path.join(root, "answer.ts"), "export const answer = 1;\n");

    const first = await ensureExerciseBaseline(root);
    const second = await ensureExerciseBaseline(root);
    expect(first.created).toBe(true);
    expect(second).toEqual({ ...first, created: false });
    const repositoryRoot = execFileSync(
      "git",
      ["-C", root, "rev-parse", "--show-toplevel"],
      { encoding: "utf8" },
    ).trim();
    expect(path.resolve(repositoryRoot)).toBe(path.resolve(root));
  });

  it("includes tracked, staged, and untracked files without invoking external diff", async () => {
    const root = await temporaryDirectory();
    const trackedPath = path.join(root, "answer.ts");
    await writeFile(trackedPath, "export const answer = 1;\n");
    await ensureExerciseBaseline(root);
    await writeFile(trackedPath, "export const answer = 2;\n");
    execFileSync("git", ["-C", root, "add", "answer.ts"]);
    await writeFile(path.join(root, "notes.txt"), "independent attempt\n");

    const diff = await getExerciseDiff(root);
    expect(diff.hasChanges).toBe(true);
    expect(diff.patch).toContain("-export const answer = 1;");
    expect(diff.patch).toContain("+export const answer = 2;");
    expect(diff.patch).toContain("new file mode 100644");
    expect(diff.patch).toContain("+independent attempt");
    expect(diff.untrackedFiles).toContain("notes.txt");

    const marker = path.join(root, "external-diff-was-run");
    const maliciousScript = path.join(root, "external.cjs");
    await writeFile(
      maliciousScript,
      `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'bad')`,
    );
    execFileSync("git", [
      "-C",
      root,
      "config",
      "diff.external",
      `${process.execPath} ${maliciousScript}`,
    ]);
    await getExerciseDiff(root);
    await expect(readFile(marker, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("caps review output", async () => {
    const root = await temporaryDirectory();
    await writeFile(path.join(root, "answer.ts"), "baseline\n");
    await ensureExerciseBaseline(root);
    await writeFile(path.join(root, "large.txt"), "x".repeat(10_000));
    const diff = await getExerciseDiff(root, 128);
    expect(Buffer.byteLength(diff.patch)).toBeLessThanOrEqual(128);
    expect(diff.truncated).toBe(true);
  });
});

function hasGit(): boolean {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "dlh-git-baseline-"));
  temporaryDirectories.push(directory);
  return directory;
}
