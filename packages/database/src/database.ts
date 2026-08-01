import { drizzle } from "drizzle-orm/node-sqlite";
import {
  SessionSnapshotSchema,
  UnitProgressPayloadSchema,
  UnitProgressSchema,
} from "@dlh/shared";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import {
  createInitialProgressPayload,
  normalizeSessionSnapshotV2,
  toIsoDateTime,
} from "./snapshot-contract.js";

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

function finalizeSnapshotContractV2(connection: DatabaseConnection): void {
  const snapshots = connection.sqlite
    .prepare(
      "SELECT id, snapshot_json FROM session_snapshots WHERE schema_version < 2",
    )
    .all() as Array<{ id: string; snapshot_json: string }>;
  const updateSnapshot = connection.sqlite.prepare(
    `UPDATE session_snapshots
     SET schema_version = 2, content_hash = ?, snapshot_json = ?
     WHERE id = ?`,
  );
  for (const row of snapshots) {
    const normalized = normalizeSessionSnapshotV2(
      JSON.parse(row.snapshot_json),
    );
    const hashable = { ...normalized };
    Reflect.deleteProperty(hashable, "contentHash");
    const contentHash = sha256Json(hashable);
    const snapshot = SessionSnapshotSchema.parse({ ...hashable, contentHash });
    updateSnapshot.run(
      contentHash,
      JSON.stringify(canonicalize(snapshot)),
      row.id,
    );
  }

  const progressRows = connection.sqlite
    .prepare(
      `SELECT id, unit_id, unit_type, status, progress_json, started_at,
              completed_at, skipped_at, updated_at
       FROM unit_progress`,
    )
    .all() as Array<{
    id: string;
    unit_id: string;
    unit_type: Parameters<typeof createInitialProgressPayload>[0];
    status: "locked" | "ready" | "in_progress" | "completed" | "skipped";
    progress_json: string;
    started_at: number | null;
    completed_at: number | null;
    skipped_at: number | null;
    updated_at: number;
  }>;
  const updateProgress = connection.sqlite.prepare(
    `UPDATE unit_progress
     SET progress_json = ?, started_at = ?, completed_at = ?, skipped_at = ?
     WHERE id = ?`,
  );
  for (const row of progressRows) {
    let storedPayload: unknown;
    try {
      storedPayload = JSON.parse(row.progress_json);
    } catch {
      storedPayload = null;
    }
    const parsedPayload = UnitProgressPayloadSchema.safeParse(storedPayload);
    const payload = parsedPayload.success
      ? parsedPayload.data
      : createInitialProgressPayload(row.unit_type);
    const startedAt =
      row.status === "in_progress" && row.started_at === null
        ? row.updated_at
        : row.started_at;
    const completedAt =
      row.status === "completed" && row.completed_at === null
        ? row.updated_at
        : row.completed_at;
    const skippedAt =
      row.status === "skipped" && row.skipped_at === null
        ? row.updated_at
        : row.skipped_at;
    const validated = UnitProgressSchema.parse({
      unitId: row.unit_id,
      unitType: row.unit_type,
      status: row.status,
      payload,
      startedAt: startedAt === null ? null : toIsoDateTime(startedAt),
      completedAt: completedAt === null ? null : toIsoDateTime(completedAt),
      skippedAt: skippedAt === null ? null : toIsoDateTime(skippedAt),
      updatedAt: toIsoDateTime(row.updated_at),
    });
    updateProgress.run(
      JSON.stringify(validated.payload),
      startedAt,
      completedAt,
      skippedAt,
      row.id,
    );
  }

  const storedSnapshots = connection.sqlite
    .prepare("SELECT snapshot_json FROM session_snapshots")
    .all() as Array<{ snapshot_json: string }>;
  for (const row of storedSnapshots) {
    SessionSnapshotSchema.parse(JSON.parse(row.snapshot_json));
  }
}

function ensureUnitProgressContract(connection: DatabaseConnection): void {
  const columns = connection.sqlite
    .prepare("PRAGMA table_info(unit_progress)")
    .all() as Array<{ name: string }>;
  if (
    !columns.length ||
    columns.some((column) => column.name === "unit_type")
  ) {
    return;
  }

  connection.sqlite.exec(`
    DROP INDEX IF EXISTS unit_progress_session_order_idx;
    CREATE TABLE unit_progress_v2_contract (
      id TEXT PRIMARY KEY NOT NULL,
      session_id TEXT NOT NULL REFERENCES learning_sessions(id) ON DELETE CASCADE,
      unit_id TEXT NOT NULL,
      unit_type TEXT NOT NULL CHECK(unit_type IN (
        'briefing', 'study', 'recall', 'teacher-dialogue', 'quiz', 'code-reading',
        'exercise', 'review', 'interview', 'summary', 'checkpoint', 'spaced-review'
      )),
      status TEXT NOT NULL CHECK(status IN ('locked','ready','in_progress','completed','skipped')),
      progress_json TEXT NOT NULL DEFAULT '{}',
      started_at INTEGER,
      completed_at INTEGER,
      skipped_at INTEGER,
      updated_at INTEGER NOT NULL,
      UNIQUE(session_id, unit_id)
    );
    INSERT INTO unit_progress_v2_contract
      (id, session_id, unit_id, unit_type, status, progress_json, started_at,
       completed_at, skipped_at, updated_at)
    SELECT p.id, p.session_id, p.unit_id,
           COALESCE((SELECT u.type FROM curriculum_units u WHERE u.id = p.unit_id), 'study'),
           p.status, p.progress_json, p.started_at, p.completed_at, p.skipped_at,
           p.updated_at
    FROM unit_progress p;
    DROP TABLE unit_progress;
    ALTER TABLE unit_progress_v2_contract RENAME TO unit_progress;
    CREATE INDEX unit_progress_session_order_idx
      ON unit_progress(session_id, updated_at);
  `);
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
      if (id === "0002_snapshot_contract_and_hints") {
        ensureUnitProgressContract(connection);
        finalizeSnapshotContractV2(connection);
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

  const versionedCurriculumApplied = connection.sqlite
    .prepare(
      "SELECT 1 FROM __dlh_migrations WHERE id = '0001_versioned_curriculum'",
    )
    .get();
  if (versionedCurriculumApplied) {
    connection.sqlite.exec("BEGIN IMMEDIATE");
    try {
      // Some prototype databases recorded an older form of migration 0001
      // where unit_progress did not yet contain unit_type. The rebuild is
      // lossless and no-ops on the current schema.
      ensureUnitProgressContract(connection);
      const snapshotContractApplied = connection.sqlite
        .prepare(
          "SELECT 1 FROM __dlh_migrations WHERE id = '0002_snapshot_contract_and_hints'",
        )
        .get();
      if (snapshotContractApplied) {
        // Older builds could record migration 0002 before its TypeScript
        // normalization hook ran. This repair is intentionally repeatable.
        finalizeSnapshotContractV2(connection);
      }
      connection.sqlite.exec("COMMIT");
    } catch (error) {
      connection.sqlite.exec("ROLLBACK");
      throw error;
    }
  }
}
