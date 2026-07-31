import { lstat, realpath, stat } from "node:fs/promises";
import path from "node:path";

export type WorkspacePathErrorCode =
  | "INVALID_ROOT"
  | "INVALID_PATH"
  | "PATH_ESCAPE"
  | "REPARSE_ESCAPE"
  | "NOT_FOUND"
  | "WRONG_TYPE";

export class WorkspacePathError extends Error {
  readonly code: WorkspacePathErrorCode;

  constructor(
    code: WorkspacePathErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "WorkspacePathError";
    this.code = code;
  }
}

export interface ResolveWorkspacePathOptions {
  mustExist?: boolean;
  expectedType?: "any" | "file" | "directory";
}

const WINDOWS_RESERVED_NAME =
  /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu;
// eslint-disable-next-line no-control-regex -- portable paths reject the full ASCII control range.
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;

/**
 * Validates an untrusted, portable path relative to a workspace.
 *
 * Both slash styles are treated as separators on every OS. Windows-only path
 * forms are rejected on POSIX as well so a value cannot become unsafe after a
 * workspace is moved between machines.
 */
export function validateWorkspaceSubpath(input: string): readonly string[] {
  if (
    input.length === 0 ||
    input.trim() !== input ||
    CONTROL_CHARACTER.test(input)
  ) {
    throw new WorkspacePathError(
      "INVALID_PATH",
      "Workspace path is empty or contains control/outer whitespace characters.",
    );
  }

  if (
    path.posix.isAbsolute(input) ||
    path.win32.isAbsolute(input) ||
    /^[a-z]:/iu.test(input) ||
    /^(?:\\\\|\/\/)/u.test(input) ||
    /^(?:\\\\|\/\/)[?.](?:\\|\/)/u.test(input)
  ) {
    throw new WorkspacePathError(
      "INVALID_PATH",
      "Absolute, drive-qualified, UNC, and device paths are not allowed.",
    );
  }

  const segments = input.split(/[\\/]/u);
  for (const segment of segments) {
    if (segment.length === 0 || segment === "." || segment === "..") {
      throw new WorkspacePathError(
        "INVALID_PATH",
        "Empty, current-directory, and parent-directory path segments are not allowed.",
      );
    }
    if (segment.includes(":")) {
      throw new WorkspacePathError(
        "INVALID_PATH",
        "Colon characters are not allowed (drive and NTFS alternate data stream protection).",
      );
    }
    if (
      segment.endsWith(".") ||
      segment.endsWith(" ") ||
      WINDOWS_RESERVED_NAME.test(segment)
    ) {
      throw new WorkspacePathError(
        "INVALID_PATH",
        "Ambiguous or reserved Windows path segments are not allowed.",
      );
    }
  }

  return segments;
}

export async function resolveWorkspacePath(
  workspaceRoot: string,
  untrustedSubpath: string,
  options: ResolveWorkspacePathOptions = {},
): Promise<string> {
  if (!path.isAbsolute(workspaceRoot)) {
    throw new WorkspacePathError(
      "INVALID_ROOT",
      "Workspace root must be an absolute path.",
    );
  }

  let root: string;
  try {
    root = await realpath(workspaceRoot);
    const rootStat = await stat(root);
    if (!rootStat.isDirectory()) {
      throw new WorkspacePathError(
        "INVALID_ROOT",
        "Workspace root is not a directory.",
      );
    }
  } catch (error) {
    if (error instanceof WorkspacePathError) throw error;
    throw new WorkspacePathError(
      "INVALID_ROOT",
      "Workspace root does not exist or cannot be inspected.",
      { cause: error },
    );
  }

  const segments = validateWorkspaceSubpath(untrustedSubpath);
  const candidate = path.resolve(root, ...segments);
  assertContained(root, candidate, "PATH_ESCAPE");

  let cursor = root;
  let exists = true;
  for (const segment of segments) {
    cursor = path.join(cursor, segment);
    try {
      const item = await lstat(cursor);
      if (item.isSymbolicLink()) {
        const target = await realpath(cursor);
        assertContained(root, target, "REPARSE_ESCAPE");
      }
      // realpath also resolves Windows junctions and other reparse points that
      // Node may not expose through isSymbolicLink().
      const resolvedCursor = await realpath(cursor);
      assertContained(root, resolvedCursor, "REPARSE_ESCAPE");
    } catch (error) {
      if (error instanceof WorkspacePathError) throw error;
      if (isNotFoundError(error)) {
        exists = false;
        break;
      }
      throw new WorkspacePathError(
        "INVALID_PATH",
        "Workspace path cannot be safely inspected.",
        { cause: error },
      );
    }
  }

  if ((options.mustExist ?? false) && !exists) {
    throw new WorkspacePathError("NOT_FOUND", "Workspace path does not exist.");
  }

  if (
    exists &&
    options.expectedType !== undefined &&
    options.expectedType !== "any"
  ) {
    const candidateStat = await stat(candidate);
    const hasExpectedType =
      options.expectedType === "file"
        ? candidateStat.isFile()
        : candidateStat.isDirectory();
    if (!hasExpectedType) {
      throw new WorkspacePathError(
        "WRONG_TYPE",
        `Workspace path is not a ${options.expectedType}.`,
      );
    }
  }

  return candidate;
}

function assertContained(
  root: string,
  candidate: string,
  code: "PATH_ESCAPE" | "REPARSE_ESCAPE",
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
  throw new WorkspacePathError(
    code,
    "Resolved path escapes the workspace root.",
  );
}

function isNotFoundError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
