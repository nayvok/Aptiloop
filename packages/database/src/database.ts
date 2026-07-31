import { drizzle } from "drizzle-orm/node-sqlite";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

function createDrizzleDatabase(sqlite: DatabaseSync) {
  return drizzle({ client: sqlite });
}

export type Database = ReturnType<typeof createDrizzleDatabase>;

export interface DatabaseConnection {
  readonly db: Database;
  readonly sqlite: DatabaseSync;
  close(): void;
}

export interface OpenDatabaseOptions {
  readonly?: boolean;
  fileMustExist?: boolean;
  timeoutMs?: number;
}

export function openDatabase(
  filename: string,
  options: OpenDatabaseOptions = {},
): DatabaseConnection {
  if (
    options.fileMustExist &&
    filename !== ":memory:" &&
    !existsSync(filename)
  ) {
    throw new Error(`SQLite database does not exist: ${filename}`);
  }
  if (filename !== ":memory:" && !options.readonly) {
    mkdirSync(dirname(filename), { recursive: true });
  }

  const sqlite = new DatabaseSync(filename, {
    readOnly: options.readonly ?? false,
    enableForeignKeyConstraints: true,
    enableDoubleQuotedStringLiterals: false,
    allowExtension: false,
    timeout: options.timeoutMs ?? 5_000,
  });
  sqlite.exec("PRAGMA foreign_keys = ON");
  if (!options.readonly && filename !== ":memory:") {
    sqlite.exec("PRAGMA journal_mode = WAL");
    sqlite.exec("PRAGMA synchronous = NORMAL");
  }

  return {
    db: createDrizzleDatabase(sqlite),
    sqlite,
    close: () => sqlite.close(),
  };
}

export const createDatabase = openDatabase;

export function withTransaction<T>(
  connection: DatabaseConnection,
  callback: () => T,
): T {
  connection.sqlite.exec("BEGIN IMMEDIATE");
  try {
    const result = callback();
    connection.sqlite.exec("COMMIT");
    return result;
  } catch (error) {
    connection.sqlite.exec("ROLLBACK");
    throw error;
  }
}

const migrationsDirectory = fileURLToPath(
  new URL("../migrations", import.meta.url),
);

export function migrateDatabase(
  connection: DatabaseConnection,
  directory = migrationsDirectory,
): void {
  connection.sqlite.exec(`
    CREATE TABLE IF NOT EXISTS __dlh_migrations (
      id TEXT PRIMARY KEY NOT NULL,
      applied_at INTEGER NOT NULL
    );
  `);

  const migrationFiles = readdirSync(directory)
    .filter((file) => file.endsWith(".sql"))
    .sort((left, right) => left.localeCompare(right));
  for (const file of migrationFiles) {
    const id = file.slice(0, -".sql".length);
    connection.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const alreadyApplied = connection.sqlite
        .prepare("SELECT 1 FROM __dlh_migrations WHERE id = ?")
        .get(id);
      if (alreadyApplied) {
        connection.sqlite.exec("COMMIT");
        continue;
      }
      connection.sqlite.exec(readFileSync(join(directory, file), "utf8"));
      connection.sqlite
        .prepare("INSERT INTO __dlh_migrations (id, applied_at) VALUES (?, ?)")
        .run(id, Date.now());
      connection.sqlite.exec("COMMIT");
    } catch (error) {
      connection.sqlite.exec("ROLLBACK");
      throw error;
    }
  }
}
