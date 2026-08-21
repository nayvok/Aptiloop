import { createHash } from "node:crypto";
import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";

export interface WorkspaceSnapshotFile {
  readonly documentId: string;
  readonly sizeBytes: number;
  readonly sha256: string;
}

export interface CompleteWorkspaceSnapshot {
  readonly schemaVersion: 1;
  readonly contentHash: string;
  readonly files: readonly WorkspaceSnapshotFile[];
  readonly totalBytes: number;
}

export interface WorkspaceSnapshotLimits {
  readonly maxFiles?: number;
  readonly maxFileBytes?: number;
  readonly maxTotalBytes?: number;
}

const DEFAULT_MAX_FILES = 1_000;
const DEFAULT_MAX_FILE_BYTES = 5_000_000;
const DEFAULT_MAX_TOTAL_BYTES = 20_000_000;
const EXCLUDED_ROOT_ENTRIES = new Set([".git", "node_modules"]);

export async function snapshotCompleteWorkspace(
  workspaceRoot: string,
  limits: WorkspaceSnapshotLimits = {},
): Promise<CompleteWorkspaceSnapshot> {
  if (!path.isAbsolute(workspaceRoot)) {
    throw new Error("Workspace snapshot root must be absolute");
  }
  const canonicalRoot = await realpath(workspaceRoot);
  const rootStats = await lstat(canonicalRoot);
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    throw new Error("Workspace snapshot root must be a real directory");
  }

  const maxFiles = positiveLimit(
    limits.maxFiles,
    DEFAULT_MAX_FILES,
    "maxFiles",
  );
  const maxFileBytes = positiveLimit(
    limits.maxFileBytes,
    DEFAULT_MAX_FILE_BYTES,
    "maxFileBytes",
  );
  const maxTotalBytes = positiveLimit(
    limits.maxTotalBytes,
    DEFAULT_MAX_TOTAL_BYTES,
    "maxTotalBytes",
  );
  const files: WorkspaceSnapshotFile[] = [];
  const caseFoldedDocumentIds = new Set<string>();
  let totalBytes = 0;

  const visit = async (directory: string, segments: readonly string[]) => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
    );
    for (const entry of entries) {
      if (segments.length === 0 && EXCLUDED_ROOT_ENTRIES.has(entry.name)) {
        continue;
      }
      const itemSegments = [...segments, entry.name];
      const documentId = itemSegments.join("/");
      const caseFolded = documentId.toLocaleLowerCase("en-US");
      if (caseFoldedDocumentIds.has(caseFolded)) {
        throw new Error(
          `Workspace contains a case-folded path collision: ${documentId}`,
        );
      }
      caseFoldedDocumentIds.add(caseFolded);

      const absolutePath = path.join(directory, entry.name);
      const stats = await lstat(absolutePath);
      if (stats.isSymbolicLink()) {
        throw new Error(`Workspace links are not allowed: ${documentId}`);
      }
      const canonicalPath = await realpath(absolutePath);
      assertContained(canonicalRoot, canonicalPath, documentId);
      if (stats.isDirectory()) {
        await visit(absolutePath, itemSegments);
        continue;
      }
      if (!stats.isFile()) {
        throw new Error(
          `Workspace contains an unsupported entry: ${documentId}`,
        );
      }
      if (stats.size > maxFileBytes) {
        throw new Error(`Workspace file exceeds the size limit: ${documentId}`);
      }
      if (files.length >= maxFiles) {
        throw new Error("Workspace exceeds the file count limit");
      }
      totalBytes += stats.size;
      if (totalBytes > maxTotalBytes) {
        throw new Error("Workspace exceeds the total byte limit");
      }
      const bytes = await readFile(absolutePath);
      files.push({
        documentId,
        sizeBytes: bytes.byteLength,
        sha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
      });
    }
  };

  await visit(canonicalRoot, []);
  files.sort((left, right) =>
    left.documentId < right.documentId
      ? -1
      : left.documentId > right.documentId
        ? 1
        : 0,
  );
  const canonicalManifest = JSON.stringify({
    schemaVersion: 1,
    files,
    totalBytes,
  });
  return {
    schemaVersion: 1,
    contentHash: `sha256:${createHash("sha256")
      .update(canonicalManifest)
      .digest("hex")}`,
    files,
    totalBytes,
  };
}

function positiveLimit(
  value: number | undefined,
  fallback: number,
  name: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
  return resolved;
}

function assertContained(
  root: string,
  candidate: string,
  documentId: string,
): void {
  const relative = path.relative(root, candidate);
  if (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  ) {
    return;
  }
  throw new Error(`Workspace entry escapes its root: ${documentId}`);
}
