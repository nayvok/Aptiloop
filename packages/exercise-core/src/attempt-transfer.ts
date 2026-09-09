import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";

import { AllowedProcessRunner } from "./process-runner.js";
import {
  getExerciseDiff,
  getExerciseLearnerCommitHistory,
  getExerciseUncommittedDiff,
  listIgnoredExerciseFiles,
  type ExerciseDiff,
  type ExerciseLearnerCommit,
} from "./git-baseline.js";
import { validateWorkspaceSubpath } from "./workspace-path.js";
import { snapshotCompleteWorkspace } from "./workspace-snapshot.js";

export const ATTEMPT_TRANSFER_DIFF_BUDGET = 4 * 1024 * 1024;
export const ATTEMPT_TRANSFER_BLOB_BUDGET = 1 * 1024 * 1024;
export const ATTEMPT_TRANSFER_TOTAL_BUDGET = 64 * 1024 * 1024;
export const ATTEMPT_TRANSFER_MAX_BLOBS = 32;

export class AttemptTransferError extends Error {
  readonly code:
    | "PATH_ESCAPE"
    | "REPARSE_ESCAPE"
    | "SECRET_FILE"
    | "HASH_MISMATCH"
    | "TRUNCATED_DIFF"
    | "BASELINE_MISMATCH"
    | "INVALID_SNAPSHOT";
  constructor(
    code: AttemptTransferError["code"],
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AttemptTransferError";
    this.code = code;
  }
}
export interface AttemptTransferBlob {
  readonly path: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly contentBase64: string;
}

export interface AttemptTransferCommit extends ExerciseLearnerCommit {}
export interface AttemptTransferSnapshot {
  readonly trustedTemplateId: string;
  readonly baselineCommit: string;
  readonly learnerCommits: readonly AttemptTransferCommit[];
  readonly workingTreeDiff: string;
  readonly untrackedBlobs: readonly AttemptTransferBlob[];
  readonly treeHash: string;
  readonly diffHash: string;
}
const GIT_SHA_PATTERN = /^[0-9a-f]{40}$/u;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const SECRET_PATH_PATTERN =
  /(?:^|[._\-/])(?:api[_-]?key|authorization|bearer|credential|password|secret|token)(?:[._\-/]|$)|^(?:gh[opusr]_|sk-|xox[baprs]-)/iu;
const SECRET_BASENAME_PATTERN =
  /^(?:\.env(?:\..*)?|.*\.(?:pem|key|pfx|p12|kdbx)|id_(?:rsa|ed25519|ecdsa)(?:\.pub)?|credentials\.json|secrets\.json)$/iu;
const SECRET_CONTENT_PATTERN =
  /(?:\b(?:sk-[A-Za-z0-9_-]{16,}|gh[opusr]_[A-Za-z0-9_-]{16,}|xox[baprs]-[A-Za-z0-9-]{16,})\b)|(?:\b(?:api[_-]?key|authorization|bearer|credential|password|secret|token)\b\s*[:=]\s*["']?[A-Za-z0-9_./+=:-]{8,})/iu;

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function sha256Prefixed(bytes: Uint8Array | string): string {
  const input =
    typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  return `sha256:${sha256Hex(input)}`;
}

function assertGitSha(value: string, label: string): void {
  if (!GIT_SHA_PATTERN.test(value)) {
    throw new AttemptTransferError("INVALID_SNAPSHOT", `${label} is malformed`);
  }
}

function assertSha256(value: string, label: string): void {
  if (!SHA256_PATTERN.test(value)) {
    throw new AttemptTransferError("INVALID_SNAPSHOT", `${label} is malformed`);
  }
}

function isGitInternalPath(relativePath: string): boolean {
  return relativePath.split("/")[0] === ".git";
}

function assertAllowedBlobPath(relativePath: string): readonly string[] {
  let segments: readonly string[];
  try {
    segments = validateWorkspaceSubpath(relativePath);
  } catch (error) {
    throw new AttemptTransferError(
      "PATH_ESCAPE",
      `Attempt blob path escapes containment: ${relativePath}`,
      { cause: error },
    );
  }
  const normalized = segments.join("/");
  if (isGitInternalPath(normalized)) {
    throw new AttemptTransferError(
      "PATH_ESCAPE",
      `Attempt blob cannot carry git internals: ${relativePath}`,
    );
  }
  const basename = segments[segments.length - 1] ?? "";
  if (
    SECRET_PATH_PATTERN.test(normalized) ||
    SECRET_PATH_PATTERN.test(basename) ||
    SECRET_BASENAME_PATTERN.test(basename)
  ) {
    throw new AttemptTransferError(
      "SECRET_FILE",
      `Attempt blob looks like a secret and is rejected: ${relativePath}`,
    );
  }
  return segments;
}

function assertNoSecretContent(bytes: Uint8Array, label: string): void {
  const text = Buffer.from(bytes).toString("utf8");
  if (SECRET_CONTENT_PATTERN.test(text)) {
    throw new AttemptTransferError(
      "SECRET_FILE",
      `Attempt ${label} contains secret-like content`,
    );
  }
}

async function assertNoReparseAncestors(
  canonicalRoot: string,
  absolutePath: string,
): Promise<void> {
  const relative = path.relative(canonicalRoot, absolutePath);
  if (
    relative === "" ||
    relative.startsWith("..") ||
    path.isAbsolute(relative)
  ) {
    throw new AttemptTransferError(
      "PATH_ESCAPE",
      "Attempt path escapes its workspace root",
    );
  }
  let current = canonicalRoot;
  for (const segment of relative.split(path.sep)) {
    if (!segment) continue;
    current = path.join(current, segment);
    const stats = await lstat(current).catch(() => null);
    if (stats === null) break;
    if (
      stats.isSymbolicLink() ||
      (!stats.isDirectory() && current !== absolutePath)
    ) {
      throw new AttemptTransferError(
        "REPARSE_ESCAPE",
        "Attempt path has a symlink or non-directory ancestor",
      );
    }
    const resolved = await realpath(current).catch(() => current);
    const resolvedRelative = path.relative(canonicalRoot, resolved);
    if (
      resolvedRelative !== "" &&
      (resolvedRelative.startsWith("..") || path.isAbsolute(resolvedRelative))
    ) {
      throw new AttemptTransferError(
        "REPARSE_ESCAPE",
        "Attempt path resolves outside its workspace root",
      );
    }
  }
}

function decodeGitQuotedToken(raw: string): string {
  if (!raw.startsWith('"')) return raw;
  if (!raw.endsWith('"') || raw.length < 2) {
    throw new AttemptTransferError(
      "INVALID_SNAPSHOT",
      "Attempt patch has an unterminated Git quoted path",
    );
  }
  const bytes: number[] = [];
  const appendCharacter = (value: string): void => {
    bytes.push(...Buffer.from(value, "utf8"));
  };
  for (let index = 1; index < raw.length - 1; index += 1) {
    const char = raw[index]!;
    if (char !== "\\") {
      appendCharacter(char);
      continue;
    }
    const escaped = raw[++index];
    if (escaped === undefined) {
      throw new AttemptTransferError(
        "INVALID_SNAPSHOT",
        "Attempt patch has an incomplete Git path escape",
      );
    }
    const simpleEscapes: Record<string, number> = {
      a: 0x07,
      b: 0x08,
      t: 0x09,
      n: 0x0a,
      v: 0x0b,
      f: 0x0c,
      r: 0x0d,
      "\\": 0x5c,
      '"': 0x22,
    };
    const replacement = simpleEscapes[escaped];
    if (replacement !== undefined) {
      bytes.push(replacement);
      continue;
    }
    if (!/[0-7]/u.test(escaped)) {
      throw new AttemptTransferError(
        "INVALID_SNAPSHOT",
        "Attempt patch has an invalid Git path escape",
      );
    }
    let octal = escaped;
    while (octal.length < 3 && /[0-7]/u.test(raw[index + 1] ?? "")) {
      octal += raw[++index];
    }
    bytes.push(Number.parseInt(octal, 8));
  }
  return Buffer.from(bytes).toString("utf8");
}

function tokenizeGitPathFields(raw: string): string[] {
  const tokens: string[] = [];
  let index = 0;
  while (index < raw.length) {
    while (/\s/u.test(raw[index] ?? "")) index += 1;
    if (index >= raw.length) break;
    if (raw[index] === '"') {
      const start = index;
      index += 1;
      let escaped = false;
      let closed = false;
      while (index < raw.length) {
        const char = raw[index]!;
        index += 1;
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === '"') {
          closed = true;
          break;
        }
      }
      if (escaped || !closed) {
        throw new AttemptTransferError(
          "INVALID_SNAPSHOT",
          "Attempt patch has an unterminated Git quoted path",
        );
      }
      tokens.push(decodeGitQuotedToken(raw.slice(start, index)));
      continue;
    }
    const start = index;
    while (index < raw.length && !/\s/u.test(raw[index]!)) index += 1;
    tokens.push(raw.slice(start, index));
  }
  return tokens;
}

function parsePatchPathToken(token: string, prefix: "a" | "b"): string | null {
  if (token === "/dev/null") return null;
  if (!token.startsWith(`${prefix}/`)) {
    throw new AttemptTransferError(
      "PATH_ESCAPE",
      `Attempt patch path has an invalid Git prefix: ${token}`,
    );
  }
  return token.slice(prefix.length + 1);
}

function parsePatchMetadataPath(raw: string, prefix: "a" | "b"): string | null {
  const [token] = tokenizeGitPathFields(raw.trim());
  if (token === undefined) {
    throw new AttemptTransferError(
      "INVALID_SNAPSHOT",
      "Attempt patch has an empty Git path",
    );
  }
  return parsePatchPathToken(token, prefix);
}

function patchPaths(patch: string): string[] {
  const paths: string[] = [];
  for (const line of patch.split("\n")) {
    if (line.startsWith("diff --git ")) {
      const tokens = tokenizeGitPathFields(line.slice("diff --git ".length));
      if (tokens.length !== 2) {
        throw new AttemptTransferError(
          "INVALID_SNAPSHOT",
          "Attempt patch has an invalid diff header",
        );
      }
      const left = parsePatchPathToken(tokens[0]!, "a");
      const right = parsePatchPathToken(tokens[1]!, "b");
      if (left !== null) paths.push(left);
      if (right !== null) paths.push(right);
    } else if (line.startsWith("--- ")) {
      const parsed = parsePatchMetadataPath(line.slice(4), "a");
      if (parsed !== null) paths.push(parsed);
    } else if (line.startsWith("+++ ")) {
      const parsed = parsePatchMetadataPath(line.slice(4), "b");
      if (parsed !== null) paths.push(parsed);
    }
  }
  return [...new Set(paths)];
}
function removeUntrackedPatchSections(
  patch: string,
  untracked: ReadonlySet<string>,
): string {
  const sections = patch.split(/(?=^diff --git )/mu);
  return sections
    .filter((section) => {
      const header = section.split("\n", 1)[0] ?? "";
      if (!header.startsWith("diff --git ")) return true;
      const paths = patchPaths(`${header}\n`);
      return !paths.some((candidate) => untracked.has(candidate));
    })
    .join("");
}

async function runGitApply(root: string, patch: string): Promise<void> {
  if (patch.length === 0) return;
  const runner = new AllowedProcessRunner(
    {
      "git-apply": {
        executable: "git",
        args: [
          "-c",
          "color.ui=false",
          "-c",
          "core.hooksPath=.git/harness-disabled-hooks",
          "-c",
          "diff.external=",
          "apply",
          "--recount",
          "--whitespace=nowarn",
          "--",
          "-",
        ],
        timeoutMs: 30_000,
        maxOutputBytes: 64 * 1024,
      },
    },
    { baseEnv: process.env },
  );
  const result = await runner.run("git-apply", {
    cwd: root,
    input: patch,
  });
  if (result.terminationReason === "exit" && result.exitCode === 0) return;
  const details = `${result.stderr}\n${result.stdout}`.trim();
  throw new AttemptTransferError(
    "INVALID_SNAPSHOT",
    `Trusted Git patch was rejected (${result.terminationReason})${
      details.length > 0 ? `: ${details}` : ""
    }`,
  );
}
async function runTrustedGitCommand(
  root: string,
  args: readonly string[],
  input?: string,
): Promise<string> {
  const runner = new AllowedProcessRunner(
    {
      "git-transfer-command": {
        executable: "git",
        args,
        timeoutMs: 30_000,
        maxOutputBytes: 64 * 1024,
      },
    },
    { baseEnv: process.env },
  );
  const result = await runner.run("git-transfer-command", {
    cwd: root,
    ...(input === undefined ? {} : { input }),
  });
  if (result.terminationReason === "exit" && result.exitCode === 0) {
    return result.stdout;
  }
  const details = `${result.stderr}\n${result.stdout}`.trim();
  throw new AttemptTransferError(
    "INVALID_SNAPSHOT",
    `Trusted Git command was rejected (${result.terminationReason})${
      details.length > 0 ? `: ${details}` : ""
    }`,
  );
}
async function assertNoSymlinkEscape(
  workspaceRoot: string,
  absolutePath: string,
  canonicalRoot: string,
): Promise<void> {
  await assertNoReparseAncestors(canonicalRoot, absolutePath);
  const stats = await lstat(absolutePath).catch(() => null);
  if (stats?.isSymbolicLink() === true) {
    throw new AttemptTransferError(
      "REPARSE_ESCAPE",
      "Attempt workspace symlinks/reparse points are not portable",
    );
  }
  if (stats === null) return;
  const real = await realpath(absolutePath).catch(() => absolutePath);
  const relative = path.relative(canonicalRoot, real);
  if (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  ) {
    return;
  }
  void workspaceRoot;
  throw new AttemptTransferError(
    "REPARSE_ESCAPE",
    "Attempt path resolves outside its workspace root",
  );
}
async function ensureSafeDirectory(
  canonicalRoot: string,
  segments: readonly string[],
): Promise<string> {
  let current = canonicalRoot;
  for (const segment of segments) {
    current = path.join(current, segment);
    const existing = await lstat(current).catch(() => null);
    if (existing === null) {
      try {
        await mkdir(current);
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code !== "EEXIST") throw error;
      }
    }
    const stats = await lstat(current).catch(() => null);
    if (stats === null || !stats.isDirectory() || stats.isSymbolicLink()) {
      throw new AttemptTransferError(
        "REPARSE_ESCAPE",
        "Attempt restore ancestor is not a real directory",
      );
    }
    const resolved = await realpath(current).catch(() => current);
    const relative = path.relative(canonicalRoot, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new AttemptTransferError(
        "REPARSE_ESCAPE",
        "Attempt restore ancestor resolves outside its root",
      );
    }
  }
  return current;
}

/**
 * Filesystem/Git authority for portable attempt snapshots. Never executes
 * imported content: snapshot reads the live workspace through the trusted
 * git baseline seam, restore writes only regular files after containment,
 * reparse, secret, and hash checks.
 */
export async function snapshotExerciseAttempt(options: {
  workspaceRoot: string;
  trustedTemplateId: string;
  baselineCommit: string;
  untrackedFiles?: readonly string[];
}): Promise<AttemptTransferSnapshot> {
  const trustedTemplateId = options.trustedTemplateId.trim();
  if (trustedTemplateId.length === 0 || trustedTemplateId.length > 200) {
    throw new AttemptTransferError(
      "INVALID_SNAPSHOT",
      "Trusted template identity is malformed",
    );
  }
  assertGitSha(options.baselineCommit, "Baseline commit");
  if (!path.isAbsolute(options.workspaceRoot)) {
    throw new AttemptTransferError(
      "PATH_ESCAPE",
      "Attempt workspace root must be absolute",
    );
  }
  const canonicalRoot = await realpath(options.workspaceRoot).catch(() => {
    throw new AttemptTransferError(
      "PATH_ESCAPE",
      "Attempt workspace root is unavailable",
    );
  });
  const rootStats = await lstat(canonicalRoot);
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    throw new AttemptTransferError(
      "REPARSE_ESCAPE",
      "Attempt workspace root must be a real directory",
    );
  }
  const diff = await getExerciseDiff(canonicalRoot, {
    expectedBaselineCommit: options.baselineCommit,
    maxOutputBytes: ATTEMPT_TRANSFER_DIFF_BUDGET,
  });
  if (diff.truncated) {
    throw new AttemptTransferError(
      "TRUNCATED_DIFF",
      "Attempt working-tree diff is truncated and cannot be transferred",
    );
  }
  if (diff.baselineCommit !== options.baselineCommit) {
    throw new AttemptTransferError(
      "BASELINE_MISMATCH",
      "Attempt baseline commit does not match the trusted template baseline",
    );
  }
  const ignoredFiles = await listIgnoredExerciseFiles(canonicalRoot, {
    expectedBaselineCommit: options.baselineCommit,
  });
  for (const relativePath of ignoredFiles) {
    const segments = assertAllowedBlobPath(relativePath);
    const absolutePath = path.join(canonicalRoot, ...segments);
    await assertNoSymlinkEscape(canonicalRoot, absolutePath, canonicalRoot);
    const stats = await lstat(absolutePath);
    if (stats.size <= ATTEMPT_TRANSFER_BLOB_BUDGET) {
      assertNoSecretContent(
        await readFile(absolutePath),
        `ignored file ${relativePath}`,
      );
    }
    throw new AttemptTransferError(
      "SECRET_FILE",
      `Ignored workspace file is not representable in transfer evidence: ${relativePath}`,
    );
  }
  const learnerCommits = (
    await getExerciseLearnerCommitHistory(canonicalRoot, {
      expectedBaselineCommit: options.baselineCommit,
      maxCommits: 32,
      maxPatchBytes: ATTEMPT_TRANSFER_DIFF_BUDGET,
    })
  ).map((commit) => ({ ...commit }));
  for (const commit of learnerCommits) {
    assertGitSha(commit.sourceCommit, "Learner source commit");
    assertGitSha(commit.parentCommit, "Learner parent commit");
    if (
      sha256Prefixed(commit.patch) !== commit.patchHash ||
      Buffer.byteLength(commit.patch, "utf8") > ATTEMPT_TRANSFER_DIFF_BUDGET
    ) {
      throw new AttemptTransferError(
        "HASH_MISMATCH",
        `Learner commit patch hash does not match: ${commit.sourceCommit}`,
      );
    }
    for (const relativePath of patchPaths(commit.patch)) {
      const segments = assertAllowedBlobPath(relativePath);
      await assertNoSymlinkEscape(
        canonicalRoot,
        path.join(canonicalRoot, ...segments),
        canonicalRoot,
      );
    }
    assertNoSecretContent(
      Buffer.from(commit.patch, "utf8"),
      `learner commit ${commit.sourceCommit}`,
    );
  }
  const workingPatch =
    learnerCommits.length === 0
      ? diff.patch
      : (
          await getExerciseUncommittedDiff(canonicalRoot, {
            expectedBaselineCommit: options.baselineCommit,
            maxOutputBytes: ATTEMPT_TRANSFER_DIFF_BUDGET,
          })
        ).patch;
  for (const relativePath of patchPaths(workingPatch)) {
    const segments = assertAllowedBlobPath(relativePath);
    await assertNoSymlinkEscape(
      canonicalRoot,
      path.join(canonicalRoot, ...segments),
      canonicalRoot,
    );
  }
  assertNoSecretContent(
    Buffer.from(workingPatch, "utf8"),
    "working-tree patch",
  );
  const requested = options.untrackedFiles ?? diff.untrackedFiles;
  if (requested.length > ATTEMPT_TRANSFER_MAX_BLOBS) {
    throw new AttemptTransferError(
      "INVALID_SNAPSHOT",
      "Attempt carries too many untracked blobs",
    );
  }
  const listedUntracked = new Set(diff.untrackedFiles);
  const requestedSet = new Set<string>();
  for (const relativePath of requested) {
    const segments = assertAllowedBlobPath(relativePath);
    const normalized = segments.join("/");
    if (!listedUntracked.has(normalized)) {
      throw new AttemptTransferError(
        "INVALID_SNAPSHOT",
        `Attempt blob is not an untracked workspace file: ${relativePath}`,
      );
    }
    if (requestedSet.has(normalized)) {
      throw new AttemptTransferError(
        "INVALID_SNAPSHOT",
        `Duplicate attempt blob: ${relativePath}`,
      );
    }
    requestedSet.add(normalized);
  }
  const workingTreeDiff = removeUntrackedPatchSections(
    workingPatch,
    requestedSet,
  );
  const diffBytes = Buffer.byteLength(workingTreeDiff, "utf8");
  if (diffBytes > ATTEMPT_TRANSFER_DIFF_BUDGET) {
    throw new AttemptTransferError(
      "TRUNCATED_DIFF",
      "Attempt working-tree diff exceeds its byte budget",
    );
  }
  const blobs: AttemptTransferBlob[] = [];
  let totalBytes = learnerCommits.reduce(
    (total, commit) => total + Buffer.byteLength(commit.patch, "utf8"),
    diffBytes,
  );
  for (const relativePath of requestedSet) {
    const segments = assertAllowedBlobPath(relativePath);
    const absolutePath = path.join(canonicalRoot, ...segments);
    await assertNoSymlinkEscape(canonicalRoot, absolutePath, canonicalRoot);
    const content = await readFile(absolutePath).catch(() => {
      throw new AttemptTransferError(
        "INVALID_SNAPSHOT",
        `Attempt blob is unreadable: ${relativePath}`,
      );
    });
    assertNoSecretContent(content, `blob ${relativePath}`);
    if (content.length > ATTEMPT_TRANSFER_BLOB_BUDGET) {
      throw new AttemptTransferError(
        "INVALID_SNAPSHOT",
        `Attempt blob exceeds its byte budget: ${relativePath}`,
      );
    }
    totalBytes += content.length;
    if (totalBytes > ATTEMPT_TRANSFER_TOTAL_BUDGET) {
      throw new AttemptTransferError(
        "INVALID_SNAPSHOT",
        "Attempt snapshot exceeds the 64 MiB total budget",
      );
    }
    blobs.push({
      path: segments.join("/"),
      sizeBytes: content.length,
      sha256: `sha256:${sha256Hex(content)}`,
      contentBase64: Buffer.from(content).toString("base64"),
    });
  }
  blobs.sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
  const diffHash = sha256Prefixed(workingTreeDiff);
  const workspaceSnapshot = await snapshotCompleteWorkspace(canonicalRoot, {
    maxFileBytes: ATTEMPT_TRANSFER_BLOB_BUDGET,
    maxTotalBytes: ATTEMPT_TRANSFER_TOTAL_BUDGET,
  });
  return {
    trustedTemplateId,
    baselineCommit: diff.baselineCommit,
    learnerCommits,
    workingTreeDiff,
    untrackedBlobs: blobs,
    treeHash: workspaceSnapshot.contentHash,
    diffHash,
  };
}

function isCanonicalBase64(value: string): boolean {
  return (
    value.length % 4 === 0 &&
    /^[A-Za-z0-9+/]*={0,2}$/u.test(value) &&
    Buffer.from(value, "base64").toString("base64") === value
  );
}

/** Verifies hashes/sizes and restores regular files only. Never executes. */
export async function restoreExerciseAttempt(options: {
  destinationRoot: string;
  snapshot: AttemptTransferSnapshot;
  expectedBaselineCommit?: string | undefined;
}): Promise<{ restoredFiles: number; totalBytes: number }> {
  const snapshot = options.snapshot;
  assertGitSha(snapshot.baselineCommit, "Baseline commit");
  assertSha256(snapshot.treeHash, "Tree hash");
  const diffBytes = Buffer.byteLength(snapshot.workingTreeDiff, "utf8");
  if (diffBytes > ATTEMPT_TRANSFER_DIFF_BUDGET) {
    throw new AttemptTransferError(
      "TRUNCATED_DIFF",
      "Attempt working-tree diff exceeds its byte budget",
    );
  }
  let totalBytes = diffBytes;
  let expectedParent = snapshot.baselineCommit;
  for (const commit of snapshot.learnerCommits) {
    assertGitSha(commit.sourceCommit, "Learner source commit");
    assertGitSha(commit.parentCommit, "Learner parent commit");
    if (commit.parentCommit !== expectedParent) {
      throw new AttemptTransferError(
        "INVALID_SNAPSHOT",
        "Learner commit history is not a linear chain from the trusted baseline",
      );
    }
    if (sha256Prefixed(commit.patch) !== commit.patchHash) {
      throw new AttemptTransferError(
        "HASH_MISMATCH",
        `Learner commit patch hash does not match: ${commit.sourceCommit}`,
      );
    }
    if (
      Buffer.byteLength(commit.patch, "utf8") > ATTEMPT_TRANSFER_DIFF_BUDGET
    ) {
      throw new AttemptTransferError(
        "TRUNCATED_DIFF",
        "Learner commit patch exceeds its byte budget",
      );
    }
    assertNoSecretContent(
      Buffer.from(commit.patch, "utf8"),
      `learner commit ${commit.sourceCommit}`,
    );
    totalBytes += Buffer.byteLength(commit.patch, "utf8");
    expectedParent = commit.sourceCommit;
  }
  if (totalBytes > ATTEMPT_TRANSFER_TOTAL_BUDGET) {
    throw new AttemptTransferError(
      "INVALID_SNAPSHOT",
      "Attempt snapshot exceeds the 64 MiB total budget",
    );
  }
  if (sha256Prefixed(snapshot.workingTreeDiff) !== snapshot.diffHash) {
    throw new AttemptTransferError(
      "HASH_MISMATCH",
      "Attempt working-tree diff hash does not match",
    );
  }
  const destination = options.destinationRoot;
  if (!path.isAbsolute(destination)) {
    throw new AttemptTransferError(
      "PATH_ESCAPE",
      "Attempt restore root must be absolute",
    );
  }
  const canonicalRoot = await realpath(destination).catch(() => {
    throw new AttemptTransferError(
      "PATH_ESCAPE",
      "Attempt restore root is unavailable; caller must create a fresh template copy",
    );
  });
  const rootStats = await lstat(canonicalRoot);
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    throw new AttemptTransferError(
      "REPARSE_ESCAPE",
      "Attempt restore root must be a real directory",
    );
  }
  const baselineBefore = await getExerciseDiffForTransfer(
    canonicalRoot,
    snapshot.baselineCommit,
  );
  if (
    baselineBefore.patch.length > 0 ||
    baselineBefore.untrackedFiles.length > 0
  ) {
    throw new AttemptTransferError(
      "INVALID_SNAPSHOT",
      "Attempt restore destination is not a clean trusted-template copy",
    );
  }
  for (const commit of snapshot.learnerCommits) {
    for (const relativePath of patchPaths(commit.patch)) {
      const segments = assertAllowedBlobPath(relativePath);
      await assertNoSymlinkEscape(
        canonicalRoot,
        path.join(canonicalRoot, ...segments),
        canonicalRoot,
      );
    }
  }
  const diffPaths = patchPaths(snapshot.workingTreeDiff);
  for (const relativePath of diffPaths) {
    if (
      snapshot.workingTreeDiff.includes("new file mode 120000") ||
      snapshot.workingTreeDiff.includes("new mode 120000") ||
      snapshot.workingTreeDiff.includes("old mode 120000")
    ) {
      throw new AttemptTransferError(
        "REPARSE_ESCAPE",
        "Symlink entries are not allowed in an attempt patch",
      );
    }
    const segments = assertAllowedBlobPath(relativePath);
    await assertNoSymlinkEscape(
      canonicalRoot,
      path.join(canonicalRoot, ...segments),
      canonicalRoot,
    );
  }
  assertNoSecretContent(
    Buffer.from(snapshot.workingTreeDiff, "utf8"),
    "working-tree patch",
  );
  const decodedBlobs: Array<{
    readonly path: string;
    readonly segments: readonly string[];
    readonly bytes: Buffer;
    readonly sha256: string;
  }> = [];
  const seen = new Set<string>();
  for (const blob of snapshot.untrackedBlobs) {
    const segments = assertAllowedBlobPath(blob.path);
    const normalized = segments.join("/");
    if (seen.has(normalized)) {
      throw new AttemptTransferError(
        "INVALID_SNAPSHOT",
        `Duplicate attempt blob: ${blob.path}`,
      );
    }
    seen.add(normalized);
    if (diffPaths.includes(normalized)) {
      throw new AttemptTransferError(
        "INVALID_SNAPSHOT",
        `Attempt patch and blob overlap: ${blob.path}`,
      );
    }
    if (!isCanonicalBase64(blob.contentBase64)) {
      throw new AttemptTransferError(
        "INVALID_SNAPSHOT",
        `Attempt blob is not canonical base64: ${blob.path}`,
      );
    }
    const decoded = Buffer.from(blob.contentBase64, "base64");
    if (decoded.length !== blob.sizeBytes) {
      throw new AttemptTransferError(
        "HASH_MISMATCH",
        `Attempt blob size does not match decoded bytes: ${blob.path}`,
      );
    }
    if (decoded.length > ATTEMPT_TRANSFER_BLOB_BUDGET) {
      throw new AttemptTransferError(
        "INVALID_SNAPSHOT",
        `Attempt blob exceeds its byte budget: ${blob.path}`,
      );
    }
    const observedHash = `sha256:${sha256Hex(decoded)}`;
    if (observedHash !== blob.sha256) {
      throw new AttemptTransferError(
        "HASH_MISMATCH",
        `Attempt blob hash does not match: ${blob.path}`,
      );
    }
    assertNoSecretContent(decoded, `blob ${blob.path}`);
    totalBytes += decoded.length;
    if (totalBytes > ATTEMPT_TRANSFER_TOTAL_BUDGET) {
      throw new AttemptTransferError(
        "INVALID_SNAPSHOT",
        "Attempt snapshot exceeds the 64 MiB total budget",
      );
    }
    await assertNoSymlinkEscape(
      canonicalRoot,
      path.join(canonicalRoot, ...segments),
      canonicalRoot,
    );
    decodedBlobs.push({
      path: normalized,
      segments,
      bytes: decoded,
      sha256: observedHash,
    });
  }
  for (const commit of snapshot.learnerCommits) {
    if (
      commit.patch.includes("new file mode 120000") ||
      commit.patch.includes("new mode 120000") ||
      commit.patch.includes("old mode 120000")
    ) {
      throw new AttemptTransferError(
        "REPARSE_ESCAPE",
        "Symlink entries are not allowed in learner commit patches",
      );
    }
    await runGitApply(canonicalRoot, commit.patch);
    for (const relativePath of patchPaths(commit.patch)) {
      const segments = assertAllowedBlobPath(relativePath);
      await assertNoSymlinkEscape(
        canonicalRoot,
        path.join(canonicalRoot, ...segments),
        canonicalRoot,
      );
    }
    await runTrustedGitCommand(canonicalRoot, [
      "-c",
      "color.ui=false",
      "-c",
      "core.hooksPath=.git/harness-disabled-hooks",
      "add",
      "--all",
      "--",
      ".",
    ]);
    await runTrustedGitCommand(
      canonicalRoot,
      [
        "-c",
        "color.ui=false",
        "-c",
        "commit.gpgSign=false",
        "-c",
        "tag.gpgSign=false",
        "-c",
        "core.hooksPath=.git/harness-disabled-hooks",
        "-c",
        "user.name=Aptiloop transfer",
        "-c",
        "user.email=transfer@localhost.invalid",
        "commit",
        "--no-verify",
        "--no-gpg-sign",
        "--quiet",
        "--allow-empty",
        "--file",
        "-",
      ],
      `Aptiloop imported learner commit ${commit.sourceCommit}\n\n${commit.subject}\n`,
    );
    const restoredHead = (
      await runTrustedGitCommand(canonicalRoot, [
        "-c",
        "color.ui=false",
        "-c",
        "core.hooksPath=.git/harness-disabled-hooks",
        "rev-parse",
        "--verify",
        "HEAD",
      ])
    ).trim();
    assertGitSha(restoredHead, "Restored learner commit");
    const restoredMessage = await runTrustedGitCommand(canonicalRoot, [
      "-c",
      "color.ui=false",
      "-c",
      "core.hooksPath=.git/harness-disabled-hooks",
      "log",
      "-1",
      "--format=%B",
      "HEAD",
    ]);
    if (!restoredMessage.includes(commit.sourceCommit)) {
      throw new AttemptTransferError(
        "HASH_MISMATCH",
        `Restored learner commit ${restoredHead} lost source mapping`,
      );
    }
  }
  await runGitApply(canonicalRoot, snapshot.workingTreeDiff);
  for (const relativePath of diffPaths) {
    const segments = assertAllowedBlobPath(relativePath);
    await assertNoSymlinkEscape(
      canonicalRoot,
      path.join(canonicalRoot, ...segments),
      canonicalRoot,
    );
  }
  for (const blob of decodedBlobs) {
    const parent = await ensureSafeDirectory(
      canonicalRoot,
      blob.segments.slice(0, -1),
    );
    const absolutePath = path.join(parent, blob.segments.at(-1)!);
    try {
      await writeFile(absolutePath, blob.bytes, { flag: "wx" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "EEXIST") {
        throw new AttemptTransferError(
          "INVALID_SNAPSHOT",
          `Restore target already exists: ${blob.path}`,
        );
      }
      throw error;
    }
  }
  const restoredUncommitted = await getExerciseUncommittedDiff(canonicalRoot, {
    expectedBaselineCommit: snapshot.baselineCommit,
    maxOutputBytes: ATTEMPT_TRANSFER_DIFF_BUDGET,
  });
  if (
    restoredUncommitted.truncated ||
    restoredUncommitted.patch !== snapshot.workingTreeDiff ||
    sha256Prefixed(restoredUncommitted.patch) !== snapshot.diffHash
  ) {
    throw new AttemptTransferError(
      "HASH_MISMATCH",
      "Restored uncommitted diff does not match exported evidence",
    );
  }
  if (snapshot.learnerCommits.length === 0) {
    const after = await getExerciseDiffForTransfer(
      canonicalRoot,
      snapshot.baselineCommit,
    );
    if (after.truncated) {
      throw new AttemptTransferError(
        "TRUNCATED_DIFF",
        "Restored attempt diff is truncated",
      );
    }
    const restoredDiff = removeUntrackedPatchSections(
      after.patch,
      new Set(decodedBlobs.map((blob) => blob.path)),
    );
    if (restoredDiff !== snapshot.workingTreeDiff) {
      throw new AttemptTransferError(
        "HASH_MISMATCH",
        "Restored workspace diff does not match exported evidence",
      );
    }
  }
  const restoredTreeHash = (
    await snapshotCompleteWorkspace(canonicalRoot, {
      maxFileBytes: ATTEMPT_TRANSFER_BLOB_BUDGET,
      maxTotalBytes: ATTEMPT_TRANSFER_TOTAL_BUDGET,
    })
  ).contentHash;
  if (restoredTreeHash !== snapshot.treeHash) {
    throw new AttemptTransferError(
      "HASH_MISMATCH",
      "Restored workspace tree does not match exported evidence",
    );
  }
  return { restoredFiles: decodedBlobs.length, totalBytes };
}

async function getExerciseDiffForTransfer(
  root: string,
  baselineCommit: string,
): Promise<ExerciseDiff> {
  return getExerciseDiff(root, {
    expectedBaselineCommit: baselineCommit,
    maxOutputBytes: ATTEMPT_TRANSFER_DIFF_BUDGET,
  });
}
