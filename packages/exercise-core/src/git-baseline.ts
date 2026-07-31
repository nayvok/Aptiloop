import { spawn } from "node:child_process";
import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { resolveWorkspacePath } from "./workspace-path.js";

const BASELINE_MARKER = "dev-learning-harness-baseline.json";
const DEFAULT_DIFF_CAP = 1_000_000;
const GIT_OUTPUT_CAP = 1_100_000;

export class ExerciseGitError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ExerciseGitError";
  }
}

export interface ExerciseBaseline {
  readonly exerciseRoot: string;
  readonly commit: string;
  readonly created: boolean;
}

export interface ExerciseDiff {
  readonly baselineCommit: string;
  readonly patch: string;
  readonly hasChanges: boolean;
  readonly untrackedFiles: readonly string[];
  readonly truncated: boolean;
}

interface BaselineMarker {
  readonly version: 1;
  readonly commit: string;
}

/** Creates one private Git repository per exercise and records an immutable baseline commit. */
export async function ensureExerciseBaseline(
  exerciseRoot: string,
): Promise<ExerciseBaseline> {
  const root = await requireExerciseDirectory(exerciseRoot);
  const gitDirectory = path.join(root, ".git");

  if (await pathExists(gitDirectory)) {
    const marker = await readBaselineMarker(root);
    await assertRepositoryRoot(root);
    await verifyCommit(root, marker.commit);
    return { exerciseRoot: root, commit: marker.commit, created: false };
  }

  await runGit(root, ["init", "--quiet", "--initial-branch=baseline", "."]);
  await mkdir(path.join(gitDirectory, "harness-disabled-hooks"), {
    recursive: true,
  });
  await runGit(root, ["add", "--all", "--", "."]);
  await runGit(root, [
    "-c",
    "user.name=Dev Learning Harness",
    "-c",
    "user.email=harness@localhost.invalid",
    "commit",
    "--quiet",
    "--allow-empty",
    "--no-verify",
    "-m",
    "chore: exercise baseline",
  ]);
  const commit = (
    await runGit(root, ["rev-parse", "--verify", "HEAD"])
  ).stdout.trim();
  if (!/^[0-9a-f]{40,64}$/u.test(commit))
    throw new ExerciseGitError("Git returned an invalid baseline commit id.");
  const marker: BaselineMarker = { version: 1, commit };
  await writeFile(
    path.join(gitDirectory, BASELINE_MARKER),
    `${JSON.stringify(marker)}\n`,
    {
      encoding: "utf8",
      flag: "wx",
    },
  );
  return { exerciseRoot: root, commit, created: true };
}

/**
 * Returns changes relative to the recorded baseline. Tracked/staged changes are
 * produced by Git with external diff and text-conversion disabled. Untracked
 * files are rendered locally so they cannot disappear from a review.
 */
export async function getExerciseDiff(
  exerciseRoot: string,
  maxOutputBytes = DEFAULT_DIFF_CAP,
): Promise<ExerciseDiff> {
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes <= 0) {
    throw new TypeError("maxOutputBytes must be a positive integer.");
  }
  const root = await requireExerciseDirectory(exerciseRoot);
  const marker = await readBaselineMarker(root);
  await assertRepositoryRoot(root);
  await verifyCommit(root, marker.commit);

  const tracked = await runGit(
    root,
    [
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--binary",
      "--src-prefix=a/",
      "--dst-prefix=b/",
      marker.commit,
      "--",
      ".",
    ],
    Math.min(GIT_OUTPUT_CAP, maxOutputBytes + 1),
  );
  const untrackedResult = await runGit(root, [
    "ls-files",
    "--others",
    "--exclude-standard",
    "-z",
    "--",
    ".",
  ]);
  const untrackedFiles = untrackedResult.stdout
    .split("\0")
    .filter((entry) => entry.length > 0)
    .sort((left, right) => left.localeCompare(right));

  let patch = tracked.stdout;
  let truncated = Buffer.byteLength(patch) > maxOutputBytes;
  if (truncated) patch = truncateUtf8(patch, maxOutputBytes);

  for (const relativePath of untrackedFiles) {
    if (truncated) break;
    const absolutePath = await resolveWorkspacePath(root, relativePath, {
      mustExist: true,
      expectedType: "file",
    });
    const remaining = maxOutputBytes - Buffer.byteLength(patch);
    const rendered = await renderUntrackedPatch(
      root,
      absolutePath,
      relativePath,
      remaining,
    );
    patch += rendered.patch;
    truncated = rendered.truncated;
  }

  return Object.freeze({
    baselineCommit: marker.commit,
    patch,
    hasChanges: patch.length > 0 || untrackedFiles.length > 0,
    untrackedFiles: Object.freeze(untrackedFiles),
    truncated,
  });
}

async function renderUntrackedPatch(
  root: string,
  absolutePath: string,
  relativePath: string,
  availableBytes: number,
): Promise<{ patch: string; truncated: boolean }> {
  if (availableBytes <= 0) return { patch: "", truncated: true };
  const itemStat = await stat(absolutePath);
  const displayPath = quoteGitPath(relativePath.replaceAll(path.sep, "/"));
  const mode =
    process.platform === "win32" || (itemStat.mode & constants.S_IXUSR) === 0
      ? "100644"
      : "100755";
  const header = `diff --git a/${displayPath} b/${displayPath}\nnew file mode ${mode}\n--- /dev/null\n+++ b/${displayPath}\n`;
  if (Buffer.byteLength(header) >= availableBytes) {
    return { patch: truncateUtf8(header, availableBytes), truncated: true };
  }

  const fileBudget = availableBytes - Buffer.byteLength(header);
  const handle = await open(absolutePath, "r");
  try {
    const buffer = Buffer.alloc(
      Math.min(fileBudget + 1, itemStat.size, 4 * 1024 * 1024),
    );
    const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, 0);
    const bytes = buffer.subarray(0, bytesRead);
    if (bytes.includes(0)) {
      const binaryLine = `Binary files /dev/null and b/${displayPath} differ\n`;
      const combined = header + binaryLine;
      return {
        patch: truncateUtf8(combined, availableBytes),
        truncated: Buffer.byteLength(combined) > availableBytes,
      };
    }

    const content = bytes.toString("utf8");
    const lines = content.split("\n");
    const completeLineCount = content.endsWith("\n")
      ? lines.length - 1
      : lines.length;
    const body = [
      `@@ -0,0 +1,${completeLineCount} @@`,
      ...lines
        .slice(0, content.endsWith("\n") ? -1 : undefined)
        .map((line) => `+${line}`),
      ...(content.length > 0 && !content.endsWith("\n")
        ? ["\\ No newline at end of file"]
        : []),
      "",
    ].join("\n");
    const combined = header + body;
    const incompleteRead = bytesRead < itemStat.size;
    return {
      patch: truncateUtf8(combined, availableBytes),
      truncated: incompleteRead || Buffer.byteLength(combined) > availableBytes,
    };
  } finally {
    await handle.close();
  }
}

async function requireExerciseDirectory(exerciseRoot: string): Promise<string> {
  if (!path.isAbsolute(exerciseRoot))
    throw new ExerciseGitError("Exercise root must be absolute.");
  try {
    const root = await realpath(exerciseRoot);
    if (!(await stat(root)).isDirectory())
      throw new ExerciseGitError("Exercise root is not a directory.");
    return root;
  } catch (error) {
    if (error instanceof ExerciseGitError) throw error;
    throw new ExerciseGitError(
      "Exercise root does not exist or cannot be inspected.",
      { cause: error },
    );
  }
}

async function assertRepositoryRoot(root: string): Promise<void> {
  const repositoryRoot = (
    await runGit(root, ["rev-parse", "--show-toplevel"])
  ).stdout.trim();
  const canonicalRepositoryRoot = await realpath(repositoryRoot);
  if (!samePath(root, canonicalRepositoryRoot)) {
    throw new ExerciseGitError(
      "Git repository is not scoped to this exercise directory.",
    );
  }
  const gitItem = await lstat(path.join(root, ".git"));
  if (!gitItem.isDirectory() || gitItem.isSymbolicLink()) {
    throw new ExerciseGitError(
      "Exercise .git must be a real directory, not a file, symlink, or reparse link.",
    );
  }
  const canonicalGitDirectory = await realpath(path.join(root, ".git"));
  if (!samePath(canonicalGitDirectory, path.join(root, ".git"))) {
    throw new ExerciseGitError("Exercise .git reparse points are not allowed.");
  }
}

async function readBaselineMarker(root: string): Promise<BaselineMarker> {
  try {
    const raw = await readFile(
      path.join(root, ".git", BASELINE_MARKER),
      "utf8",
    );
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("version" in parsed) ||
      parsed.version !== 1 ||
      !("commit" in parsed) ||
      typeof parsed.commit !== "string" ||
      !/^[0-9a-f]{40,64}$/u.test(parsed.commit)
    ) {
      throw new Error("invalid marker");
    }
    return { version: 1, commit: parsed.commit };
  } catch (error) {
    throw new ExerciseGitError(
      "Existing Git repository is not a harness-managed exercise baseline.",
      { cause: error },
    );
  }
}

async function verifyCommit(root: string, commit: string): Promise<void> {
  await runGit(root, ["cat-file", "-e", `${commit}^{commit}`]);
}

interface GitResult {
  readonly stdout: string;
  readonly stderr: string;
}

async function runGit(
  root: string,
  operationArgs: readonly string[],
  outputCap = GIT_OUTPUT_CAP,
): Promise<GitResult> {
  const nullDevice = process.platform === "win32" ? "NUL" : "/dev/null";
  const safeArgs = [
    "-c",
    "color.ui=false",
    "-c",
    "core.hooksPath=.git/harness-disabled-hooks",
    "-c",
    "diff.external=",
    ...operationArgs,
  ];
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_INDEX_FILE;
  delete env.GIT_OBJECT_DIRECTORY;
  delete env.GIT_ALTERNATE_OBJECT_DIRECTORIES;
  env.GIT_CONFIG_NOSYSTEM = "1";
  env.GIT_CONFIG_GLOBAL = nullDevice;
  env.GIT_TERMINAL_PROMPT = "0";
  env.GIT_PAGER = "cat";
  env.GIT_EXTERNAL_DIFF = "";

  return await new Promise<GitResult>((resolve, reject) => {
    const child = spawn("git", safeArgs, {
      cwd: root,
      env,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let exceeded = false;
    const append = (target: "stdout" | "stderr", chunk: Buffer): void => {
      const used = stdout.byteLength + stderr.byteLength;
      const kept = chunk.subarray(0, Math.max(0, outputCap - used));
      if (target === "stdout") stdout = Buffer.concat([stdout, kept]);
      else stderr = Buffer.concat([stderr, kept]);
      if (kept.byteLength < chunk.byteLength) {
        exceeded = true;
        child.kill("SIGKILL");
      }
    };
    child.stdout.on("data", (chunk: Buffer) => append("stdout", chunk));
    child.stderr.on("data", (chunk: Buffer) => append("stderr", chunk));
    child.once("error", (error) =>
      reject(new ExerciseGitError("Unable to start Git.", { cause: error })),
    );
    child.once("close", (code) => {
      const result = {
        stdout: stdout.toString("utf8"),
        stderr: stderr.toString("utf8"),
      };
      if (exceeded) {
        reject(
          new ExerciseGitError(
            "Git output exceeded the configured safety limit.",
          ),
        );
      } else if (code !== 0) {
        reject(
          new ExerciseGitError(
            `Git command failed (${code ?? "signal"}): ${result.stderr.trim()}`,
          ),
        );
      } else resolve(result);
    });
  });
}

function truncateUtf8(value: string, maxBytes: number): string {
  const buffer = Buffer.from(value);
  if (buffer.byteLength <= maxBytes) return value;
  return buffer
    .subarray(0, maxBytes)
    .toString("utf8")
    .replace(/\uFFFD$/u, "");
}

function quoteGitPath(relativePath: string): string {
  return /^[A-Za-z0-9_./-]+$/u.test(relativePath)
    ? relativePath
    : JSON.stringify(relativePath);
}

function samePath(left: string, right: string): boolean {
  return process.platform === "win32"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await lstat(target);
    return true;
  } catch {
    return false;
  }
}
