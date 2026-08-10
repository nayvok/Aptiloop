import { fileURLToPath } from "node:url";

import { createApprovedM1Backup } from "../packages/database/src/approved-backup.js";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
let sourceArgument: string | undefined;
let destinationArgument: string | undefined;

for (let index = 2; index < process.argv.length; index += 1) {
  const argument = process.argv[index];
  if (argument !== "--source" && argument !== "--destination") {
    throw new Error(`Unknown approved-backup option: ${argument}`);
  }
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${argument} requires one path`);
  }
  if (argument === "--source") sourceArgument = value;
  else destinationArgument = value;
  index += 1;
}

if (!sourceArgument || !destinationArgument) {
  throw new Error(
    "Approved backup requires one explicit --source and --destination",
  );
}

createApprovedM1Backup({
  projectRoot,
  sourcePath: sourceArgument,
  destinationPath: destinationArgument,
}).then((result) => {
  process.stdout.write(`Approved backup verified: ${result.backupPath}\n`);
});
