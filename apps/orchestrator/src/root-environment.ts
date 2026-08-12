import path from "node:path";

export function loadRootDevelopmentEnvironment(
  projectRoot: string,
  nodeEnvironment = process.env.NODE_ENV,
): void {
  if (nodeEnvironment !== "development") return;
  try {
    process.loadEnvFile(path.join(projectRoot, ".env"));
  } catch (error) {
    if (!(
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    )) {
      throw error;
    }
  }
}
