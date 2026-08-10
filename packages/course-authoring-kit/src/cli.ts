#!/usr/bin/env node

import { readFile } from "node:fs/promises";

import {
  calculateCoursePackContentHash,
  canonicalCoursePackJson,
  CoursePackV1Schema,
  finalizeCoursePack,
  parseStrictJson,
  validateCoursePackBytes,
} from "./index.js";

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
  if (command === "validate") {
    const result = validateCoursePackBytes(bytes);
    console.log(JSON.stringify(result.report, null, 2));
    return result.valid ? 0 : 1;
  }

  const input = CoursePackV1Schema.parse(parseStrictJson(bytes));
  if (command === "hash") {
    console.log(calculateCoursePackContentHash(input));
    return 0;
  }
  if (command === "finalize") {
    console.log(canonicalCoursePackJson(finalizeCoursePack(input)));
    return 0;
  }

  const result = validateCoursePackBytes(bytes);
  if (!result.valid) {
    console.error(JSON.stringify(result.report, null, 2));
    return 1;
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
