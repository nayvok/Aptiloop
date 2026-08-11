import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  resolveWorkspacePath,
  validateWorkspaceSubpath,
  WorkspacePathError,
} from "../src/workspace-path.js";

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

describe("validateWorkspaceSubpath", () => {
  it.each([
    "../secret",
    "src/../secret",
    "src\\..\\secret",
    "/etc/passwd",
    "C:\\Windows\\system.ini",
    "C:relative-drive-path",
    "\\\\server\\share\\file",
    "\\\\?\\C:\\Windows",
    "//./C:/Windows",
    "src/file.ts:payload",
    "src//file.ts",
    "src/./file.ts",
    "src/NUL.txt",
    "src/trailing. ",
    "src/zero\0byte",
  ])("rejects cross-platform unsafe path %j", (unsafePath) => {
    expect(() => validateWorkspaceSubpath(unsafePath)).toThrow(
      WorkspacePathError,
    );
  });

  it("normalizes both separator styles into safe segments", () => {
    expect(validateWorkspaceSubpath("src\\nested/file.ts")).toEqual([
      "src",
      "nested",
      "file.ts",
    ]);
  });
});

describe("resolveWorkspacePath", () => {
  it("resolves an ordinary nested path inside the canonical root", async () => {
    const root = await temporaryDirectory();
    await mkdir(path.join(root, "src"));
    await writeFile(path.join(root, "src", "answer.ts"), "export {};\n");

    await expect(
      resolveWorkspacePath(root, "src/answer.ts", {
        mustExist: true,
        expectedType: "file",
      }),
    ).resolves.toBe(path.join(root, "src", "answer.ts"));
  });

  it("allows a missing descendant only when existence is not required", async () => {
    const root = await temporaryDirectory();
    await expect(resolveWorkspacePath(root, "src/future.ts")).resolves.toBe(
      path.join(root, "src", "future.ts"),
    );
    await expect(
      resolveWorkspacePath(root, "src/future.ts", { mustExist: true }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("blocks a symlink or Windows junction that resolves outside the root", async () => {
    const root = await temporaryDirectory();
    const outside = await temporaryDirectory();
    await writeFile(path.join(outside, "secret.txt"), "secret");
    await symlink(
      outside,
      path.join(root, "escape"),
      process.platform === "win32" ? "junction" : "dir",
    );

    await expect(
      resolveWorkspacePath(root, "escape/secret.txt", { mustExist: true }),
    ).rejects.toMatchObject({
      code: "REPARSE_ESCAPE",
    });
  });
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(
    path.join(tmpdir(), "aptiloop-workspace-path-"),
  );
  temporaryDirectories.push(directory);
  return directory;
}
