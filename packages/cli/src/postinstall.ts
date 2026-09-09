import {
  installExactRelease,
  readInstalledPointer,
  readOwnVersion,
  resolveRuntimeRootFromEnv,
} from "./ensure-runtime.js";
import { findSourceCheckoutRoot } from "./config.js";
import { existsSync } from "node:fs";

/**
 * npm postinstall prefetch: install the exact matching runtime release when
 * the store is empty. Best-effort by contract: offline registries, blocked
 * network, `--ignore-scripts`, or any other failure MUST NOT fail `npm
 * install`. The first CLI command runs the same idempotent ensureRuntime.
 * Postinstall never inspects or reserves ports.
 */
async function main(): Promise<void> {
  const optOut = process.env.APTILOOP_NO_PREFETCH?.trim();
  if (optOut) return;
  const runtimeRoot = resolveRuntimeRootFromEnv();
  if (await readInstalledPointer(runtimeRoot)) return;
  if (findSourceCheckoutRoot(process.cwd(), { existsSync })) return;
  const version = readOwnVersion();
  if (version === "0.0.0-dev") return;
  await installExactRelease({ version, runtimeRoot });
}

void main().catch((error: unknown) => {
  process.stdout.write(
    `aptiloop: runtime prefetch skipped (${error instanceof Error ? error.message : String(error)}). The first aptiloop command will install the runtime.\n`,
  );
});
