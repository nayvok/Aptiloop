import path from "node:path";
import { fileURLToPath } from "node:url";

import { createPortableDataBundle } from "@aptiloop/database";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

try {
  const destinationPath = parseDestination(process.argv.slice(2));
  const result = await createPortableDataBundle({
    projectRoot,
    ...(destinationPath ? { destinationPath } : {}),
  });
  process.stdout.write(
    `Portable Aptiloop data exported: ${path.relative(projectRoot, result.bundlePath)}\n` +
      `Payload SHA-256: ${result.manifest.payload.sha256}\n` +
      "Credentials, environment files, exercise workspaces, device paths, and transient provider capability state were excluded.\n",
  );
} catch (error) {
  process.stderr.write(`Portable data export failed: ${safeMessage(error)}\n`);
  process.exitCode = 1;
}

function parseDestination(arguments_: readonly string[]): string | undefined {
  let destination: string | undefined;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument !== "--destination") {
      throw new Error(`Unknown argument: ${argument}`);
    }
    if (destination !== undefined) {
      throw new Error("--destination may be supplied only once");
    }
    const value = arguments_[++index];
    if (!value) throw new Error("--destination requires a path");
    destination = value;
  }
  return destination;
}

function safeMessage(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message.slice(0, 1_000)
    : "Unknown export failure";
}
