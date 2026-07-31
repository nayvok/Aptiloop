import {
  createTimestampedDatabaseBackups,
  discoverDatabaseCandidates,
} from "../backup.js";
import { resolve } from "node:path";

const backupDirectory = resolve(
  process.cwd(),
  process.env.DATABASE_BACKUP_DIR ?? ".data/backups",
);
const candidates = discoverDatabaseCandidates(
  process.cwd(),
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
