import {
  createTimestampedDatabaseBackups,
  discoverDatabaseCandidates,
  resolveDatabaseProjectRoot,
} from "../backup.js";
import { resolve } from "node:path";

const projectRoot = resolveDatabaseProjectRoot(
  new URL("../backup.js", import.meta.url).href,
  process.env.DATABASE_PROJECT_ROOT,
);
const backupDirectory = resolve(
  projectRoot,
  process.env.DATABASE_BACKUP_DIR ?? ".data/backups",
);
const candidates = discoverDatabaseCandidates(
  projectRoot,
  process.env.DATABASE_URL,
);
if (!candidates.length) throw new Error("No SQLite database candidates found");

const results = createTimestampedDatabaseBackups({
  sources: candidates,
  backupDirectory,
});
for (const result of results) {
  process.stdout.write(`Database backup verified: ${result.backupPath}\n`);
}
