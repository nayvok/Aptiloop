import {
  copyFile,
  lstat,
  mkdir,
  readdir,
  realpath,
  rm,
  stat,
} from "node:fs/promises";
import path from "node:path";

import {
  resolveWorkspacePath,
  validateWorkspaceSubpath,
  WorkspacePathError,
} from "./workspace-path.js";

const EXCLUDED_DIRECTORIES = new Set([".git", "node_modules", "build"]);

export class ExerciseAttemptWorkspaceError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ExerciseAttemptWorkspaceError";
  }
}

export interface CreateExerciseAttemptWorkspaceOptions {
  readonly attemptsRoot: string;
  readonly attemptId: string;
  readonly templateRoot: string;
}

export interface ExerciseAttemptWorkspace {
  readonly workspacePath: string;
  readonly templateRoot: string;
}

/** Copies a trusted template into a new, isolated workspace owned by one attempt. */
export async function createExerciseAttemptWorkspace(
  options: CreateExerciseAttemptWorkspaceOptions,
): Promise<ExerciseAttemptWorkspace> {
  const attemptSegments = validateWorkspaceSubpath(options.attemptId);
  if (attemptSegments.length !== 1) {
    throw new WorkspacePathError(
      "INVALID_PATH",
      "Attempt id must be one portable path segment.",
    );
  }

  const templateRoot = await requireRealDirectory(
    options.templateRoot,
    "Template root",
  );
  const attemptsRoot = await requireRealDirectory(
    options.attemptsRoot,
    "Attempts root",
  );
  const workspacePath = await resolveWorkspacePath(
    attemptsRoot,
    attemptSegments[0]!,
  );

  try {
    await mkdir(workspacePath, { recursive: false });
  } catch (error) {
    throw new ExerciseAttemptWorkspaceError(
      "Attempt workspace already exists or cannot be created.",
      { cause: error },
    );
  }

  try {
    const canonicalWorkspace = await realpath(workspacePath);
    assertContained(attemptsRoot, canonicalWorkspace);
    await copyDirectory(templateRoot, templateRoot, canonicalWorkspace);
    return Object.freeze({
      workspacePath: canonicalWorkspace,
      templateRoot,
    });
  } catch (error) {
    await rm(workspacePath, { recursive: true, force: true });
    if (error instanceof ExerciseAttemptWorkspaceError) throw error;
    throw new ExerciseAttemptWorkspaceError(
      "Exercise template cannot be copied safely.",
      { cause: error },
    );
  }
}

async function copyDirectory(
  templateRoot: string,
  sourceDirectory: string,
  destinationDirectory: string,
): Promise<void> {
  const entries = await readdir(sourceDirectory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && EXCLUDED_DIRECTORIES.has(entry.name)) continue;

    const sourcePath = path.join(sourceDirectory, entry.name);
    const item = await lstat(sourcePath);
    if (item.isSymbolicLink()) {
      throw new ExerciseAttemptWorkspaceError(
        "Exercise template reparse links are not allowed.",
      );
    }
    const canonicalSource = await realpath(sourcePath);
    assertContained(templateRoot, canonicalSource);
    if (!samePath(sourcePath, canonicalSource)) {
      throw new ExerciseAttemptWorkspaceError(
        "Exercise template reparse points are not allowed.",
      );
    }

    const destinationPath = path.join(destinationDirectory, entry.name);
    if (item.isDirectory()) {
      await mkdir(destinationPath);
      await copyDirectory(templateRoot, canonicalSource, destinationPath);
    } else if (item.isFile()) {
      await copyFile(canonicalSource, destinationPath);
    } else {
      throw new ExerciseAttemptWorkspaceError(
        "Exercise templates may contain only regular files and directories.",
      );
    }
  }
}

async function requireRealDirectory(
  value: string,
  label: string,
): Promise<string> {
  if (!path.isAbsolute(value)) {
    throw new ExerciseAttemptWorkspaceError(`${label} must be absolute.`);
  }
  try {
    const item = await lstat(value);
    if (!item.isDirectory() || item.isSymbolicLink()) {
      throw new ExerciseAttemptWorkspaceError(
        `${label} must be a real directory, not a reparse link.`,
      );
    }
    const canonical = await realpath(value);
    if (!samePath(value, canonical) || !(await stat(canonical)).isDirectory()) {
      throw new ExerciseAttemptWorkspaceError(
        `${label} reparse points are not allowed.`,
      );
    }
    return canonical;
  } catch (error) {
    if (error instanceof ExerciseAttemptWorkspaceError) throw error;
    throw new ExerciseAttemptWorkspaceError(
      `${label} does not exist or cannot be inspected.`,
      { cause: error },
    );
  }
}

function assertContained(root: string, candidate: string): void {
  const relative = path.relative(root, candidate);
  if (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  ) {
    return;
  }
  throw new ExerciseAttemptWorkspaceError(
    "Exercise template reparse point escapes its canonical root.",
  );
}

function samePath(left: string, right: string): boolean {
  return process.platform === "win32"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}
