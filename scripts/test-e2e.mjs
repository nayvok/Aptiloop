import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nextEnvPath = path.join(root, "apps", "web", "next-env.d.ts");
const originalNextEnv = await readFile(nextEnvPath, "utf8");
const npmCli = process.env.npm_execpath;

if (!npmCli) {
  throw new Error("npm_execpath is required to run the isolated E2E suite");
}

let exitCode = 1;
try {
  exitCode = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [npmCli, "run", "test:e2e", "--workspace=@dlh/web"],
      {
        cwd: root,
        env: process.env,
        shell: false,
        stdio: "inherit",
      },
    );
    child.once("error", reject);
    child.once("close", (code) => resolve(code ?? 1));
  });
} finally {
  await writeFile(nextEnvPath, originalNextEnv, "utf8");
}

process.exitCode = exitCode;
