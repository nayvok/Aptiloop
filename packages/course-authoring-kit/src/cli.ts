#!/usr/bin/env node

import { readFile } from "node:fs/promises";

import { prepareCoursePackBytes } from "./index.js";

const usage = `Usage: aptiloop-course-pack <validate|canonicalize|hash|finalize> <pack.json>`;

async function main(argv: readonly string[]): Promise<number> {
  const [command, filePath, ...extra] = argv;
  if (
    extra.length > 0 ||
    filePath === undefined ||
    !["validate", "canonicalize", "hash", "finalize"].includes(command ?? "")
  ) {
    console.error(usage);
    return 2;
  }

  const bytes = new Uint8Array(await readFile(filePath));
  const result = prepareCoursePackBytes(bytes);
  if (command === "validate") {
    console.log(JSON.stringify(result.report, null, 2));
    return result.valid ? 0 : 1;
  }
  if (!result.valid) {
    console.error(JSON.stringify(result.report, null, 2));
    return 1;
  }
  if (command === "hash") {
    console.log(result.contentHash);
    return 0;
  }
  console.log(result.canonicalJson);
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : "Unknown failure");
    process.exitCode = 1;
  },
);
