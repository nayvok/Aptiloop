import { openM1WritableDatabase } from "../active-database.js";
import { migrateDatabase } from "../database.js";
import { seedDatabase } from "../seed.js";
import {
  getM1WritableDatabasePath,
  validateM1WritableDatabasePath,
} from "./path.js";

const path = getM1WritableDatabasePath();
const connection = openM1WritableDatabase(path, {
  revalidateTarget: () => validateM1WritableDatabasePath(path),
});
try {
  migrateDatabase(
    connection,
    undefined,
    connection.migrationAdmission?.kind === "legacy-compatible"
      ? connection.migrationAdmission.migrationCapability
      : undefined,
  );
  const result = seedDatabase(connection);
  process.stdout.write(
    `Database seeded: ${path} (${result.days} days, ${result.topics} topics)\n`,
  );
} finally {
  connection.close();
}
