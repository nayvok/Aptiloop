import { spawnSync } from "node:child_process";

import { ensureRuntime, resolveRuntimeRootFromEnv } from "./ensure-runtime.js";
async function main(): Promise<void> {
  const runtime = await ensureRuntime();
  const runtimeRoot = resolveRuntimeRootFromEnv();
  const bootstrapEntry =
    process.env.APTILOOP_BOOTSTRAP_ENTRY?.trim() ?? process.argv[1];
  const child = spawnSync(
    process.execPath,
    [runtime.cliEntry, ...process.argv.slice(2)],
    {
      stdio: "inherit",
      shell: false,
      windowsHide: true,
      env: {
        ...process.env,
        APTILOOP_RUNTIME_ROOT: runtimeRoot,
        APTILOOP_RELEASE_ROOT: runtime.releaseRoot,
        APTILOOP_CLI_ENTRY: runtime.cliEntry,
        ...(bootstrapEntry
          ? {
              APTILOOP_BOOTSTRAP_ENTRY: bootstrapEntry,
              APTILOOP_RUNTIME_LAUNCHER: bootstrapEntry,
            }
          : {}),
      },
    },
  );
  if (child.error) throw child.error;
  process.exit(child.status ?? 1);
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `aptiloop: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
