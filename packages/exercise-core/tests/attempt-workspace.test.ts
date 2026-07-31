import {
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

import { createExerciseAttemptWorkspace } from "../src/attempt-workspace.js";

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

describe("createExerciseAttemptWorkspace", () => {
  it("creates isolated copies and excludes repository and generated directories", async () => {
    const root = await temporaryDirectory();
    const templateRoot = path.join(root, "template");
    const attemptsRoot = path.join(root, "attempts");
    await mkdir(path.join(templateRoot, "src"), { recursive: true });
    await mkdir(attemptsRoot);
    await writeFile(path.join(templateRoot, "src", "answer.ts"), "template\n");
    for (const excluded of [".git", "node_modules", "build"]) {
      await mkdir(path.join(templateRoot, excluded));
      await writeFile(
        path.join(templateRoot, excluded, "ignored.txt"),
        "ignored",
      );
    }

    const first = await createExerciseAttemptWorkspace({
      attemptsRoot,
      attemptId: "attempt-1",
      templateRoot,
    });
    const second = await createExerciseAttemptWorkspace({
      attemptsRoot,
      attemptId: "attempt-2",
      templateRoot,
    });
    await writeFile(
      path.join(first.workspacePath, "src", "answer.ts"),
      "first\n",
    );

    await expect(
      readFile(path.join(templateRoot, "src", "answer.ts"), "utf8"),
    ).resolves.toBe("template\n");
    await expect(
      readFile(path.join(second.workspacePath, "src", "answer.ts"), "utf8"),
    ).resolves.toBe("template\n");
    for (const excluded of [".git", "node_modules", "build"]) {
      await expect(
        lstat(path.join(first.workspacePath, excluded)),
      ).rejects.toMatchObject({ code: "ENOENT" });
    }
  });

  it("rejects attempt path escapes", async () => {
    const root = await temporaryDirectory();
    const templateRoot = path.join(root, "template");
    const attemptsRoot = path.join(root, "attempts");
    await mkdir(templateRoot);
    await mkdir(attemptsRoot);
    await writeFile(path.join(templateRoot, "answer.ts"), "template\n");

    await expect(
      createExerciseAttemptWorkspace({
        attemptsRoot,
        attemptId: "../outside",
        templateRoot,
      }),
    ).rejects.toThrow();
    await expect(lstat(path.join(root, "outside"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("rejects template reparse points instead of copying outside content", async () => {
    const root = await temporaryDirectory();
    const templateRoot = path.join(root, "template");
    const attemptsRoot = path.join(root, "attempts");
    const outside = path.join(root, "outside");
    await mkdir(templateRoot);
    await mkdir(attemptsRoot);
    await mkdir(outside);
    await writeFile(path.join(outside, "secret.txt"), "secret");
    await symlink(
      outside,
      path.join(templateRoot, "linked"),
      process.platform === "win32" ? "junction" : "dir",
    );

    await expect(
      createExerciseAttemptWorkspace({
        attemptsRoot,
        attemptId: "attempt-1",
        templateRoot,
      }),
    ).rejects.toThrow("reparse");
  });
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(
    path.join(tmpdir(), "dlh-attempt-workspace-"),
  );
  temporaryDirectories.push(directory);
  return directory;
}
