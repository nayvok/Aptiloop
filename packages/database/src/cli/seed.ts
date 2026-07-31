import { migrateDatabase, openDatabase } from "../database.js";
import { seedDatabase } from "../seed.js";
import { getDatabasePath } from "./path.js";

const path = getDatabasePath();
const connection = openDatabase(path);
try {
  migrateDatabase(connection);
  const result = seedDatabase(connection);
  process.stdout.write(
    `Database seeded: ${path} (${result.days} days, ${result.topics} topics)\n`,
  );
} finally {
  connection.close();
}
