import { fileURLToPath } from "node:url";
import { isAbsolute, resolve } from "node:path";

export function getDatabasePath(
  input: {
    configuredPath?: string;
    projectRoot?: string;
  } = {},
): string {
  const projectRoot = input.projectRoot
    ? resolve(input.projectRoot)
    : process.env.DATABASE_PROJECT_ROOT
      ? resolve(process.env.DATABASE_PROJECT_ROOT)
      : fileURLToPath(new URL("../../../../", import.meta.url));
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
