import { drizzle } from "drizzle-orm/node-sqlite";
import { createHash } from "node:crypto";
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

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

function sha256Json(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

function finalizeVersionedCurriculumBackfill(
  connection: DatabaseConnection,
): void {
  const snapshots = connection.sqlite
    .prepare(
      "SELECT id, snapshot_json FROM session_snapshots WHERE content_hash LIKE 'legacy-v1:%'",
    )
    .all() as Array<{ id: string; snapshot_json: string }>;
  const updateSnapshot = connection.sqlite.prepare(
    "UPDATE session_snapshots SET content_hash = ?, snapshot_json = ? WHERE id = ?",
  );
  for (const row of snapshots) {
    const snapshot = JSON.parse(row.snapshot_json) as Record<string, unknown>;
    const hashable = { ...snapshot };
    Reflect.deleteProperty(hashable, "contentHash");
    const contentHash = sha256Json(hashable);
    updateSnapshot.run(
      contentHash,
      JSON.stringify(canonicalize({ ...hashable, contentHash })),
      row.id,
    );
  }

  const legacyVersion = connection.sqlite
    .prepare("SELECT id FROM curriculum_versions WHERE id = 'legacy-v1'")
    .get();
  if (legacyVersion) {
    const graph = {
      days: connection.sqlite
        .prepare(
          "SELECT * FROM curriculum_days_v2 WHERE version_id = 'legacy-v1' ORDER BY week_id, order_index, id",
        )
        .all(),
      units: connection.sqlite
        .prepare(
          "SELECT * FROM curriculum_units WHERE version_id = 'legacy-v1' ORDER BY day_id, order_index, id",
        )
        .all(),
    };
    connection.sqlite
      .prepare(
        "UPDATE curriculum_versions SET content_hash = ? WHERE id = 'legacy-v1'",
      )
      .run(sha256Json(graph));
  }
}

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
      if (id === "0001_versioned_curriculum") {
        finalizeVersionedCurriculumBackfill(connection);
      }
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
