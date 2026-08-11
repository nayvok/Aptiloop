import { createHash } from "node:crypto";
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

import { createSanitizedChildEnvironment } from "./child-environment.js";
import { AllowedProcessRunner } from "./process-runner.js";
import { resolveWorkspacePath } from "./workspace-path.js";

// Retained for existing attempt repositories; renaming would orphan their baseline evidence.
const BASELINE_MARKER = "dev-learning-harness-baseline.json";
const DEFAULT_DIFF_CAP = 1_000_000;
const GIT_OUTPUT_CAP = 1_100_000;
const DEFAULT_GIT_TIMEOUT_MS = 30_000;

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

/** Hashes a complete diff. Truncated evidence deliberately has no fingerprint. */
export function fingerprintExerciseDiff(
  diff: Pick<ExerciseDiff, "baselineCommit" | "patch" | "truncated">,
): string | null {
  if (diff.truncated) return null;
  return (
    createHash("sha256")
      // Stable persisted fingerprint domain separator; changing it invalidates prior evidence.
      .update("dlh-exercise-diff-v1\0", "utf8")
      .update(diff.baselineCommit, "utf8")
      .update("\0", "utf8")
      .update(diff.patch, "utf8")
      .digest("hex")
  );
}

export interface ExerciseGitOperationOptions {
  readonly signal?: AbortSignal;
  readonly gitTimeoutMs?: number;
}

interface BaselineMarker {
  readonly version: 1;
  readonly commit: string;
}

export type GetExerciseDiffOptions = ExerciseGitOperationOptions &
  (
    | {
        readonly expectedBaselineHash: string;
        readonly expectedBaselineCommit?: never;
        readonly allowMarkerBaseline?: false;
        readonly maxOutputBytes?: number;
      }
    | {
        readonly expectedBaselineCommit: string;
        readonly expectedBaselineHash?: never;
        readonly allowMarkerBaseline?: false;
        readonly maxOutputBytes?: number;
      }
    | {
        readonly allowMarkerBaseline: true;
        readonly expectedBaselineHash?: never;
        readonly expectedBaselineCommit?: never;
        readonly maxOutputBytes?: number;
      }
  );

/** Creates one private Git repository per exercise and records an immutable baseline commit. */
export async function ensureExerciseBaseline(
  exerciseRoot: string,
  options: ExerciseGitOperationOptions = {},
): Promise<ExerciseBaseline> {
  const gitOptions = normalizeGitOperationOptions(options);
  const root = await requireExerciseDirectory(exerciseRoot);
  const gitDirectory = path.join(root, ".git");

  if (await pathExists(gitDirectory)) {
    const marker = await readBaselineMarker(root);
    await assertRepositoryRoot(root, gitOptions);
    await verifyCommit(root, marker.commit, gitOptions);
    return { exerciseRoot: root, commit: marker.commit, created: false };
  }

  await runGit(
    root,
    ["init", "--quiet", "--initial-branch=baseline", "."],
    gitOptions,
  );
  await mkdir(path.join(gitDirectory, "harness-disabled-hooks"), {
    recursive: true,
  });
  await runGit(root, ["add", "--all", "--", "."], gitOptions);
  await runGit(
    root,
    [
      "-c",
      "user.name=Aptiloop",
      "-c",
      "user.email=aptiloop@localhost.invalid",
      "commit",
      "--quiet",
      "--allow-empty",
      "--no-verify",
      "-m",
      "chore: exercise baseline",
    ],
    gitOptions,
  );
  const commit = (
    await runGit(root, ["rev-parse", "--verify", "HEAD"], gitOptions)
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
  options?: GetExerciseDiffOptions,
): Promise<ExerciseDiff> {
  const gitOptions = normalizeGitOperationOptions(options);
  const maxOutputBytes = options?.maxOutputBytes ?? DEFAULT_DIFF_CAP;
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes <= 0) {
    throw new TypeError("maxOutputBytes must be a positive integer.");
  }
  const root = await requireExerciseDirectory(exerciseRoot);
  await assertRepositoryRoot(root, gitOptions);
  const marker = await readBaselineMarker(root);
  const expectedBaseline =
    options === undefined
      ? undefined
      : "expectedBaselineHash" in options
        ? options.expectedBaselineHash
        : "expectedBaselineCommit" in options
          ? options.expectedBaselineCommit
          : undefined;
  if (expectedBaseline === undefined && options?.allowMarkerBaseline !== true) {
    throw new ExerciseGitError(
      "Expected baseline identity is required unless marker fallback is explicitly allowed.",
    );
  }
  const baselineCommit = expectedBaseline ?? marker.commit;
  if (!/^[0-9a-f]{40,64}$/u.test(baselineCommit)) {
    throw new ExerciseGitError("Server-owned baseline identity is invalid.");
  }
  if (expectedBaseline !== undefined && marker.commit !== expectedBaseline) {
    throw new ExerciseGitError(
      "Exercise marker does not match the server-owned baseline.",
    );
  }
  await verifyCommit(root, baselineCommit, gitOptions);

  const tracked = await runGit(
    root,
    [
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--binary",
      "--src-prefix=a/",
      "--dst-prefix=b/",
      baselineCommit,
      "--",
      ".",
    ],
    {
      ...gitOptions,
      outputCap: Math.min(GIT_OUTPUT_CAP, maxOutputBytes + 1),
    },
  );
  const untrackedResult = await runGit(
    root,
    ["ls-files", "--others", "--exclude-standard", "-z", "--", "."],
    gitOptions,
  );
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
    baselineCommit,
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

async function assertRepositoryRoot(
  root: string,
  options: NormalizedGitOperationOptions,
): Promise<void> {
  const repositoryRoot = (
    await runGit(root, ["rev-parse", "--show-toplevel"], options)
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
    const markerPath = path.join(root, ".git", BASELINE_MARKER);
    const markerItem = await lstat(markerPath);
    if (!markerItem.isFile() || markerItem.isSymbolicLink()) {
      throw new Error("baseline marker must be a regular file");
    }
    const canonicalMarkerPath = await realpath(markerPath);
    if (!samePath(markerPath, canonicalMarkerPath)) {
      throw new Error("baseline marker reparse points are not allowed");
    }
    const raw = await readFile(canonicalMarkerPath, "utf8");
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

async function verifyCommit(
  root: string,
  commit: string,
  options: NormalizedGitOperationOptions,
): Promise<void> {
  await runGit(root, ["cat-file", "-e", `${commit}^{commit}`], options);
}

interface GitResult {
  readonly stdout: string;
  readonly stderr: string;
}

interface NormalizedGitOperationOptions {
  readonly signal?: AbortSignal;
  readonly gitTimeoutMs: number;
}

interface RunGitOptions extends NormalizedGitOperationOptions {
  readonly outputCap?: number;
}

async function runGit(
  root: string,
  operationArgs: readonly string[],
  options: RunGitOptions,
): Promise<GitResult> {
  const outputCap = options.outputCap ?? GIT_OUTPUT_CAP;
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
  const baseEnv = createSanitizedChildEnvironment();
  const runner = new AllowedProcessRunner(
    {
      git: {
        executable: "git",
        args: safeArgs,
        env: {
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_CONFIG_GLOBAL: nullDevice,
          GIT_TERMINAL_PROMPT: "0",
          GIT_PAGER: "cat",
          GIT_EXTERNAL_DIFF: "",
        },
        timeoutMs: options.gitTimeoutMs,
        maxOutputBytes: outputCap,
      },
    },
    { baseEnv },
  );
  const result = await runner.run("git", {
    cwd: root,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });

  if (result.terminationReason === "spawn_error") {
    throw new ExerciseGitError("Unable to start Git.", {
      cause: new Error(result.stderr),
    });
  }
  if (result.terminationReason === "output_limit") {
    throw new ExerciseGitError(
      "Git output exceeded the configured safety limit.",
    );
  }
  if (result.terminationReason === "timeout") {
    throw new ExerciseGitError("Git command exceeded the configured timeout.");
  }
  if (result.terminationReason === "cancelled") {
    throw new ExerciseGitError("Git command was cancelled.");
  }
  if (result.exitCode !== 0) {
    throw new ExerciseGitError(
      `Git command failed (${result.exitCode ?? "signal"}): ${result.stderr.trim()}`,
    );
  }
  return { stdout: result.stdout, stderr: result.stderr };
}

function normalizeGitOperationOptions(
  options: ExerciseGitOperationOptions | undefined,
): NormalizedGitOperationOptions {
  const gitTimeoutMs = options?.gitTimeoutMs ?? DEFAULT_GIT_TIMEOUT_MS;
  if (!Number.isSafeInteger(gitTimeoutMs) || gitTimeoutMs <= 0) {
    throw new TypeError("gitTimeoutMs must be a positive integer.");
  }
  return {
    gitTimeoutMs,
    ...(options?.signal === undefined ? {} : { signal: options.signal }),
  };
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
