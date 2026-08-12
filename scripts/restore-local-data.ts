import path from "node:path";
import { fileURLToPath } from "node:url";

import { restorePortableDataBundle } from "@aptiloop/database";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

try {
  const sourcePath = parseSource(process.argv.slice(2));
  const result = await restorePortableDataBundle({ projectRoot, sourcePath });
  process.stdout.write(
    `Portable Aptiloop data restored: ${path.relative(projectRoot, result.activeDatabasePath)}\n` +
      `Payload SHA-256: ${result.manifest.payload.sha256}\n` +
      "Provider credentials and excluded workspace files must be configured separately.\n",
  );
} catch (error) {
  process.stderr.write(`Portable data restore failed: ${safeMessage(error)}\n`);
  process.exitCode = 1;
}

function parseSource(arguments_: readonly string[]): string {
  let source: string | undefined;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument !== "--source") {
      throw new Error(`Unknown argument: ${argument}`);
    }
    if (source !== undefined) {
      throw new Error("--source may be supplied only once");
    }
    const value = arguments_[++index];
    if (!value) throw new Error("--source requires a path");
    source = value;
  }
  if (!source) {
    throw new Error("Restore requires --source <bundle.aptiloop-data>");
  }
  return source;
}

function safeMessage(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message.slice(0, 1_000)
    : "Unknown restore failure";
}
