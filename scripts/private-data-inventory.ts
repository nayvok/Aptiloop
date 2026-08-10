import {
  inventoryHasBlockingHealth,
  inventoryPrivateData,
} from "../packages/database/src/private-data-inventory.js";

const usage = `Usage: npm run db:inventory -- [--root <directory>]... [--db <sqlite-file>]...

At least one explicit --root or --db is required. Roots are scanned recursively
without following symbolic links. SQLite main files, WAL/SHM sidecars, and
backup files are fingerprinted; inspection runs only against a disposable copy.
The JSON report contains metadata and aggregate counts, never learner content.
`;

const roots: string[] = [];
const databasePaths: string[] = [];
let compact = false;
let help = false;

for (let index = 2; index < process.argv.length; index += 1) {
  const argument = process.argv[index];
  if (argument === "--help" || argument === "-h") {
    help = true;
    continue;
  }
  if (argument === "--compact") {
    compact = true;
    continue;
  }
  if (argument === "--root" || argument === "--db") {
    const value = process.argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${argument} requires one path`);
    }
    if (argument === "--root") roots.push(value);
    else databasePaths.push(value);
    index += 1;
    continue;
  }
  throw new Error(`Unknown private-data inventory option: ${argument}`);
}

if (help) {
  process.stdout.write(usage);
} else {
  const inventory = inventoryPrivateData({ roots, databasePaths });
  process.stdout.write(
    `${JSON.stringify(inventory, null, compact ? undefined : 2)}\n`,
  );
  if (inventoryHasBlockingHealth(inventory)) process.exitCode = 2;
}
