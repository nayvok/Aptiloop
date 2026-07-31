import { migrateDatabase, openDatabase } from "../database.js";
import { getDatabasePath } from "./path.js";

const path = getDatabasePath();
const connection = openDatabase(path);
try {
  migrateDatabase(connection);
  process.stdout.write(`Database migrated: ${path}\n`);
} finally {
  connection.close();
}
