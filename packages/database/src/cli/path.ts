import { fileURLToPath } from "node:url";
import { isAbsolute, resolve } from "node:path";

import {
  assertM1WritableDatabaseTarget,
  type M1DatabaseTargetValidation,
} from "../active-database.js";

interface DatabasePathInput {
  configuredPath?: string;
  projectRoot?: string;
}

const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));

export function getDatabasePath(input: DatabasePathInput = {}): string {
  const projectRoot = resolve(input.projectRoot ?? repositoryRoot);
  const configured =
    input.configuredPath ??
    process.env.DATABASE_URL ??
    ".data/dev-learning-harness.sqlite";
  const path = configured.startsWith("file:")
    ? configured.slice("file:".length)
    : configured;
  if (path === ":memory:") return path;
  return isAbsolute(path) ? resolve(path) : resolve(projectRoot, path);
}

export function getM1WritableDatabasePath(
  input: DatabasePathInput = {},
): string {
  const projectRoot = resolve(input.projectRoot ?? repositoryRoot);
  const databasePath = getDatabasePath({ ...input, projectRoot });
  validateM1WritableDatabasePath(databasePath, { projectRoot });
  return databasePath;
}

export function validateM1WritableDatabasePath(
  databasePath: string,
  input: Pick<DatabasePathInput, "projectRoot"> = {},
): M1DatabaseTargetValidation {
  const projectRoot = resolve(input.projectRoot ?? repositoryRoot);
  const validation = assertM1WritableDatabaseTarget(databasePath, {
    projectRoot,
  });
  if (!validation) {
    throw new Error("Writable CLI database identity could not be established");
  }
  return validation;
}
