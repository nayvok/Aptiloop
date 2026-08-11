import { drizzle } from "drizzle-orm/node-sqlite";
import {
  SessionSnapshotSchema,
  UnitProgressPayloadSchema,
  UnitProgressSchema,
} from "@aptiloop/shared";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import {
  backfillCourseFoundations,
  type CourseFoundationBackfillBinding,
} from "./course-foundation-backfill.js";
import { backfillLearningKernel } from "./learning-kernel-backfill.js";
import {
  createInitialProgressPayload,
  normalizeSessionSnapshotV2,
  toIsoDateTime,
} from "./snapshot-contract.js";
import {
  databaseLogicalSha256,
  databaseSchemaSha256,
  inspectLegacyCompatibilityHealth,
} from "./private-data-inventory.js";

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
  /** Runs synchronously immediately before the DatabaseSync constructor. */
  beforeOpen?: () => void;
}

export function openDatabase(
  filename: string,
  options: OpenDatabaseOptions = {},
): DatabaseConnection {
  return openDatabaseInternal(filename, options);
}

export function openDatabaseWithWritableTargetGuard(
  filename: string,
  guard: (sqlite: DatabaseSync) => void,
  options: Omit<OpenDatabaseOptions, "readonly"> = {},
): DatabaseConnection {
  return openDatabaseInternal(
    filename,
    { ...options, readonly: false, fileMustExist: true },
    guard,
    true,
  );
}

function openDatabaseInternal(
  filename: string,
  options: OpenDatabaseOptions,
  writableTargetGuard?: (sqlite: DatabaseSync) => void,
  skipWritableDirectoryCreation = false,
): DatabaseConnection {
  if (
    options.fileMustExist &&
    filename !== ":memory:" &&
    !existsSync(filename)
  ) {
    throw new Error(`SQLite database does not exist: ${filename}`);
  }
  if (
    filename !== ":memory:" &&
    !options.readonly &&
    !skipWritableDirectoryCreation
  ) {
    mkdirSync(dirname(filename), { recursive: true });
  }
  options.beforeOpen?.();

  const sqlite = new DatabaseSync(filename, {
    readOnly: options.readonly ?? false,
    enableForeignKeyConstraints: true,
    enableDoubleQuotedStringLiterals: false,
    allowExtension: false,
    timeout: options.timeoutMs ?? 5_000,
  });
  try {
    sqlite.function("dlh_sha256_text", { deterministic: true }, (value) => {
      if (typeof value !== "string") {
        throw new Error("dlh_sha256_text requires a string");
      }
      return createHash("sha256").update(value).digest("hex");
    });
    if (!options.readonly && filename !== ":memory:") {
      writableTargetGuard?.(sqlite);
    }
    sqlite.exec("PRAGMA foreign_keys = ON");
    if (!options.readonly && filename !== ":memory:") {
      sqlite.exec("PRAGMA journal_mode = WAL");
      sqlite.exec("PRAGMA synchronous = NORMAL");
    }
  } catch (error) {
    sqlite.close();
    throw error;
  }

  return {
    db: createDrizzleDatabase(sqlite),
    sqlite,
    close: () => sqlite.close(),
  };
}

let nestedTransactionId = 0;

export function withTransaction<T>(
  connection: DatabaseConnection,
  callback: () => T,
): T {
  if (connection.sqlite.isTransaction) {
    const savepoint = `aptiloop_nested_${nestedTransactionId++}`;
    connection.sqlite.exec(`SAVEPOINT ${savepoint}`);
    try {
      const result = callback();
      connection.sqlite.exec(`RELEASE SAVEPOINT ${savepoint}`);
      return result;
    } catch (error) {
      connection.sqlite.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
      connection.sqlite.exec(`RELEASE SAVEPOINT ${savepoint}`);
      throw error;
    }
  }
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

export async function withAsyncTransaction<T>(
  connection: DatabaseConnection,
  callback: () => Promise<T>,
): Promise<T> {
  if (connection.sqlite.isTransaction) {
    throw new Error(
      "Concurrent asynchronous database transactions are not allowed",
    );
  }
  connection.sqlite.exec("BEGIN IMMEDIATE");
  try {
    const result = await callback();
    connection.sqlite.exec("COMMIT");
    return result;
  } catch (error) {
    connection.sqlite.exec("ROLLBACK");
    throw error;
  }
}

const sourceMigrationsDirectory = fileURLToPath(
  new URL("../migrations", import.meta.url),
);
const bundledWorkspaceMigrationsDirectory = fileURLToPath(
  new URL("../../../packages/database/migrations", import.meta.url),
);
const migrationsDirectory = existsSync(sourceMigrationsDirectory)
  ? sourceMigrationsDirectory
  : bundledWorkspaceMigrationsDirectory;

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

interface MigrationDefinition {
  readonly id: string;
  readonly path: string;
}

export interface CurrentDatabaseMigrationContract {
  readonly migrationIds: readonly string[];
  readonly schemaSha256: string;
}

export interface DatabaseMigrationAdmissionCapability {
  readonly kind: "legacy-compatible-noop";
  readonly contract: CurrentDatabaseMigrationContract;
  readonly logicalSha256: string;
}

export interface ApprovedM2MigrationCapability {
  readonly kind: "approved-backup-m2";
  readonly sourceContract: CurrentDatabaseMigrationContract;
  readonly sourceLogicalSha256: string;
  readonly targetContract: CurrentDatabaseMigrationContract;
  readonly approvedBackupLogicalSha256: string;
  readonly approvedBackupSha256: string;
  readonly approvedBackupPathHash: string;
}

export interface ApprovedM2MigrationTransactionGuard {
  readonly assertBackupUnchangedBeforeCommit: () => void;
}

const courseFoundationsMigrationId = "0006_course_foundations";
const courseFoundationsCorrectionMigrationId = "0008_m2_acceptance_corrections";
const courseFoundationsHardeningMigrationId = "0009_m2_acceptance_hardening";
const courseFoundationsQuarantineImmutabilityMigrationId =
  "0010_m2_quarantine_immutability";
const coursePackMigrationId = "0011_course_pack_lifecycle";
const learningKernelMigrationId = "0012_learning_kernel";
const executionFabricMigrationId = "0013_execution_fabric";
const providerHubMigrationId = "0014_provider_hub";
const adaptiveStudioMigrationId = "0015_adaptive_studio";
const courseDesignerWorkflowMigrationId = "0016_course_designer_workflow";
const learnerCourseStateMigrationId = "0017_learner_course_state";
const learnerCourseStateTriggerGuardMigrationId =
  "0018_learner_course_state_trigger_guard";
const legacyCompatibleMigrationIds = [
  "0000_initial",
  "0001_versioned_curriculum",
  "0002_snapshot_contract_and_hints",
  "0003_unit_evidence",
  "0004_unit_progress_compatibility",
  "0005_test_run_diff_fingerprint",
] as const;
export const legacyCompatibleMigrationContract: CurrentDatabaseMigrationContract =
  {
    migrationIds: legacyCompatibleMigrationIds,
    schemaSha256:
      "828f6e9accaa02ee3d274ec67fc5f58a32f69084855d698e13ad6ae5f331371c",
  };
export const courseFoundationsBaseMigrationContract: CurrentDatabaseMigrationContract =
  {
    migrationIds: [
      ...legacyCompatibleMigrationIds,
      courseFoundationsMigrationId,
    ],
    schemaSha256:
      "6643f21da9260fc1a529b4a37bd8e7ad4ccba3d004f45729bd3da5971fe4c714",
  };
export const courseFoundationsPreCorrectionMigrationContract: CurrentDatabaseMigrationContract =
  {
    migrationIds: [
      ...courseFoundationsBaseMigrationContract.migrationIds,
      "0007_quarantined_course_compatibility",
    ],
    schemaSha256:
      "e4084e674f5dcf437b134e7c1415f366735dd4350d6076aff3c1300b879a6ffd",
  };
export const courseFoundationsPreHardeningMigrationContract: CurrentDatabaseMigrationContract =
  {
    migrationIds: [
      ...courseFoundationsPreCorrectionMigrationContract.migrationIds,
      courseFoundationsCorrectionMigrationId,
    ],
    schemaSha256:
      "4ded6a016d789d4cddd58f8e7cbc5493abf4b8deefd9ffde9118704c57f1b8d0",
  };
export const courseFoundationsPostHardeningMigrationContract: CurrentDatabaseMigrationContract =
  {
    migrationIds: [
      ...courseFoundationsPreHardeningMigrationContract.migrationIds,
      courseFoundationsHardeningMigrationId,
    ],
    schemaSha256:
      "01002fb9a918c214c25a9d89c2f825796a052c3eb954f7229d888af0de95726c",
  };
export const courseFoundationsMigrationContract: CurrentDatabaseMigrationContract =
  {
    migrationIds: [
      ...courseFoundationsPostHardeningMigrationContract.migrationIds,
      courseFoundationsQuarantineImmutabilityMigrationId,
    ],
    schemaSha256:
      "a6a1543e468e3dbb90494bc6e5d5598933e22dd0cf49a9830f82ee695eda5a01",
  };
export const coursePackMigrationContract: CurrentDatabaseMigrationContract = {
  migrationIds: [
    ...courseFoundationsMigrationContract.migrationIds,
    coursePackMigrationId,
  ],
  schemaSha256:
    "e5fb0311fa41a8e3edd6977ac1ae968cb1f06b4a3c79c486b18daa0627531459",
};
export const learningKernelMigrationContract: CurrentDatabaseMigrationContract =
  {
    migrationIds: [
      ...coursePackMigrationContract.migrationIds,
      learningKernelMigrationId,
    ],
    schemaSha256:
      "491f824f741e648168373404a6a97f88440edbc3515f49b749b5aaf097c39312",
  };
export const executionFabricMigrationContract: CurrentDatabaseMigrationContract =
  {
    migrationIds: [
      ...learningKernelMigrationContract.migrationIds,
      executionFabricMigrationId,
    ],
    schemaSha256:
      "1e32db9cc459f342b32808f3594f79b785f89de8872cc9438e9d890711104da7",
  };
export const providerHubMigrationContract: CurrentDatabaseMigrationContract = {
  migrationIds: [
    ...executionFabricMigrationContract.migrationIds,
    providerHubMigrationId,
  ],
  schemaSha256:
    "dce93b3d8714eac8ab01bce0d98f136e6cb5bc4205674d4cea618a7ccfb24409",
};
export const adaptiveStudioMigrationContract: CurrentDatabaseMigrationContract =
  {
    migrationIds: [
      ...providerHubMigrationContract.migrationIds,
      adaptiveStudioMigrationId,
    ],
    schemaSha256:
      "4bc021f2fa2807738aa429c58d743d9f8cbe441824b8f063dde9e5fc50d0e55f",
  };
export const courseDesignerWorkflowMigrationContract: CurrentDatabaseMigrationContract =
  {
    migrationIds: [
      ...adaptiveStudioMigrationContract.migrationIds,
      courseDesignerWorkflowMigrationId,
    ],
    schemaSha256:
      "f23afd4470b6f221273fb15a0f783f08104650cf0fdda728b4f44409e73585aa",
  };
export const learnerCourseStateMigrationContract: CurrentDatabaseMigrationContract =
  {
    migrationIds: [
      ...courseDesignerWorkflowMigrationContract.migrationIds,
      learnerCourseStateMigrationId,
    ],
    schemaSha256:
      "645c60da903dc657446c2587767035f567ce1925b500010e6f35489857a5ffa9",
  };
export const learnerCourseStateTriggerGuardMigrationContract: CurrentDatabaseMigrationContract =
  {
    migrationIds: [
      ...learnerCourseStateMigrationContract.migrationIds,
      learnerCourseStateTriggerGuardMigrationId,
    ],
    schemaSha256:
      "d517a45b89090fba10a6c8db268edf1cef08eb3ad5f67e09f89b00a20be86c40",
  };
const approvedM2SourceMigrationContracts = [
  legacyCompatibleMigrationContract,
  courseFoundationsBaseMigrationContract,
  courseFoundationsPreCorrectionMigrationContract,
  courseFoundationsPreHardeningMigrationContract,
  courseFoundationsPostHardeningMigrationContract,
  courseFoundationsMigrationContract,
  coursePackMigrationContract,
  learningKernelMigrationContract,
  executionFabricMigrationContract,
  providerHubMigrationContract,
  adaptiveStudioMigrationContract,
  courseDesignerWorkflowMigrationContract,
  learnerCourseStateMigrationContract,
] as const;
const approvedM2StageContracts: Readonly<
  Record<string, CurrentDatabaseMigrationContract>
> = {
  [courseFoundationsMigrationId]: courseFoundationsBaseMigrationContract,
  "0007_quarantined_course_compatibility":
    courseFoundationsPreCorrectionMigrationContract,
  [courseFoundationsCorrectionMigrationId]:
    courseFoundationsPreHardeningMigrationContract,
  [courseFoundationsHardeningMigrationId]:
    courseFoundationsPostHardeningMigrationContract,
  [courseFoundationsQuarantineImmutabilityMigrationId]:
    courseFoundationsMigrationContract,
  [coursePackMigrationId]: coursePackMigrationContract,
  [learningKernelMigrationId]: learningKernelMigrationContract,
  [executionFabricMigrationId]: executionFabricMigrationContract,
  [providerHubMigrationId]: providerHubMigrationContract,
  [adaptiveStudioMigrationId]: adaptiveStudioMigrationContract,
  [courseDesignerWorkflowMigrationId]: courseDesignerWorkflowMigrationContract,
  [learnerCourseStateMigrationId]: learnerCourseStateMigrationContract,
  [learnerCourseStateTriggerGuardMigrationId]:
    learnerCourseStateTriggerGuardMigrationContract,
};

const courseFoundationsBackfillMarker = "-- dlh-course-foundations-backfill";

function readMigrationDefinitions(directory: string): MigrationDefinition[] {
  return readdirSync(directory)
    .filter((file) => file.endsWith(".sql"))
    .sort((left, right) => left.localeCompare(right))
    .map((file) => ({
      id: file.slice(0, -".sql".length),
      path: join(directory, file),
    }));
}

function hasExactMigrationLedger(
  sqlite: DatabaseSync,
  expectedIds: readonly string[],
): boolean {
  try {
    const table = sqlite
      .prepare(
        "SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = '__dlh_migrations' LIMIT 1",
      )
      .get();
    if (!table) return false;
    const rows = sqlite
      .prepare("SELECT id FROM __dlh_migrations ORDER BY id")
      .all() as Array<{ id?: unknown }>;
    return (
      rows.length === expectedIds.length &&
      rows.every((row, index) => row.id === expectedIds[index])
    );
  } catch {
    return false;
  }
}

function executeMigrationDefinition(
  connection: DatabaseConnection,
  definition: MigrationDefinition,
  binding?: Omit<CourseFoundationBackfillBinding, "sourceDatabaseDigest">,
): void {
  const sql = readFileSync(definition.path, "utf8");
  if (definition.id !== courseFoundationsMigrationId) {
    connection.sqlite.exec(sql);
    if (definition.id === "0001_versioned_curriculum") {
      finalizeVersionedCurriculumBackfill(connection);
    }
    if (definition.id === "0002_snapshot_contract_and_hints") {
      ensureUnitProgressContract(connection);
      finalizeSnapshotContractV2(connection);
    }
    if (definition.id === "0012_learning_kernel") {
      backfillLearningKernel(connection);
    }
    return;
  }

  const sections = sql.split(courseFoundationsBackfillMarker);
  if (
    sections.length !== 2 ||
    sections.some((section) => section.trim() === "")
  ) {
    throw new Error("Course foundation migration backfill boundary is invalid");
  }
  const sourceDatabaseDigest = databaseLogicalSha256(connection.sqlite);
  connection.sqlite.exec(sections[0]!);
  backfillCourseFoundations(connection, {
    sourceDatabaseDigest,
    ...binding,
  });
  connection.sqlite.exec(sections[1]!);
}

function applyMigrationDefinitions(
  connection: DatabaseConnection,
  definitions: readonly MigrationDefinition[],
): void {
  connection.sqlite.exec(`
    CREATE TABLE IF NOT EXISTS __dlh_migrations (
      id TEXT PRIMARY KEY NOT NULL,
      applied_at INTEGER NOT NULL
    );
  `);

  for (const definition of definitions) {
    const alreadyApplied = connection.sqlite
      .prepare("SELECT 1 FROM __dlh_migrations WHERE id = ?")
      .get(definition.id);
    if (alreadyApplied) continue;

    const rebuildsReferencedTable =
      definition.id === courseFoundationsCorrectionMigrationId;
    const transformVersion =
      definition.id === courseFoundationsCorrectionMigrationId
        ? "m2-v2"
        : definition.id === courseFoundationsHardeningMigrationId
          ? "m2-v3"
          : definition.id === courseFoundationsQuarantineImmutabilityMigrationId
            ? "m2-v4"
            : undefined;
    if (rebuildsReferencedTable) {
      connection.sqlite.exec("PRAGMA foreign_keys = OFF");
    }
    let transactionStarted = false;
    try {
      connection.sqlite.exec("BEGIN IMMEDIATE");
      transactionStarted = true;
      const sourceLogicalSha256 =
        transformVersion === undefined
          ? undefined
          : databaseLogicalSha256(connection.sqlite);
      executeMigrationDefinition(connection, definition);
      const timestamp = Date.now();
      if (transformVersion !== undefined && sourceLogicalSha256 !== undefined) {
        recordM2MigrationRun(
          connection.sqlite,
          definition.id,
          transformVersion,
          sourceLogicalSha256,
          timestamp,
        );
      }
      connection.sqlite
        .prepare("INSERT INTO __dlh_migrations (id, applied_at) VALUES (?, ?)")
        .run(definition.id, timestamp);
      if (rebuildsReferencedTable) {
        assertNoForeignKeyViolations(connection.sqlite);
      }
      connection.sqlite.exec("COMMIT");
      transactionStarted = false;
    } catch (error) {
      if (transactionStarted) connection.sqlite.exec("ROLLBACK");
      throw error;
    } finally {
      if (rebuildsReferencedTable) {
        connection.sqlite.exec("PRAGMA foreign_keys = ON");
      }
    }
  }
}

function assertNoForeignKeyViolations(sqlite: DatabaseSync): void {
  const violation = sqlite.prepare("PRAGMA foreign_key_check").get();
  if (violation !== undefined) {
    throw new Error(
      "Course foundation correction created a foreign-key violation",
    );
  }
}

function recordM2MigrationRun(
  sqlite: DatabaseSync,
  migrationId: string,
  transformVersion: "m2-v2" | "m2-v3" | "m2-v4",
  sourceLogicalSha256: string,
  timestamp: number,
  binding?: Pick<
    ApprovedM2MigrationCapability,
    | "approvedBackupLogicalSha256"
    | "approvedBackupSha256"
    | "approvedBackupPathHash"
  >,
): void {
  const sourceRowsDigest = createHash("sha256")
    .update(JSON.stringify({ sourceLogicalSha256, migrationId }))
    .digest("hex");
  const backupMatchesSource =
    binding?.approvedBackupLogicalSha256 === sourceLogicalSha256;
  sqlite
    .prepare(
      `INSERT INTO migration_runs
         (id, transform_version, source_database_digest, source_rows_digest,
          approved_backup_logical_sha256, approved_backup_sha256,
          approved_backup_path_hash, status, source_row_count, mapped_count,
          quarantined_count, intentionally_unmapped_count, started_at,
          completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'completed', 0, 0, 0, 0, ?, ?)`,
    )
    .run(
      `${transformVersion}-${sourceRowsDigest.slice(0, 32)}`,
      transformVersion,
      sourceLogicalSha256,
      sourceRowsDigest,
      backupMatchesSource ? binding?.approvedBackupLogicalSha256 : null,
      backupMatchesSource ? binding?.approvedBackupSha256 : null,
      backupMatchesSource ? binding?.approvedBackupPathHash : null,
      timestamp,
      timestamp,
    );
}

export function applyApprovedM2Migrations(
  connection: DatabaseConnection,
  capability: ApprovedM2MigrationCapability,
  transactionGuard: ApprovedM2MigrationTransactionGuard,
  directory = migrationsDirectory,
): void {
  if (capability.kind !== "approved-backup-m2") {
    throw new Error("Approved M2 migration capability is invalid");
  }
  const definitions = readMigrationDefinitions(directory);
  const foundationsIndex = definitions.findIndex(
    (definition) => definition.id === courseFoundationsMigrationId,
  );
  const finalM2Index = definitions.findIndex(
    (definition) =>
      definition.id === courseFoundationsQuarantineImmutabilityMigrationId,
  );
  const sourceLength = capability.sourceContract.migrationIds.length;
  const targetStageContract =
    approvedM2StageContracts[definitions.at(-1)?.id ?? ""];
  if (
    foundationsIndex <= 0 ||
    finalM2Index < foundationsIndex ||
    !targetStageContract ||
    sourceLength < foundationsIndex ||
    sourceLength >= definitions.length
  ) {
    throw new Error("Approved migration definition sequence is invalid");
  }

  const sourceDefinitions = definitions.slice(0, sourceLength);
  const pendingDefinitions = definitions.slice(sourceLength);
  const sourceDefinitionIds = sourceDefinitions.map(
    (definition) => definition.id,
  );
  const exactTargetContract = buildCurrentMigrationContract(definitions);
  const sourceContractMatches = approvedM2SourceMigrationContracts.some(
    (contract) =>
      contract.schemaSha256 === capability.sourceContract.schemaSha256 &&
      contract.migrationIds.length === sourceDefinitionIds.length &&
      contract.migrationIds.every(
        (id, index) =>
          id === sourceDefinitionIds[index] &&
          id === capability.sourceContract.migrationIds[index],
      ),
  );
  const targetContractMatches =
    capability.targetContract.schemaSha256 ===
      targetStageContract.schemaSha256 &&
    capability.targetContract.schemaSha256 ===
      exactTargetContract.schemaSha256 &&
    capability.targetContract.migrationIds.length ===
      targetStageContract.migrationIds.length &&
    capability.targetContract.migrationIds.length ===
      exactTargetContract.migrationIds.length &&
    capability.targetContract.migrationIds.every(
      (id, index) =>
        id === targetStageContract.migrationIds[index] &&
        id === exactTargetContract.migrationIds[index],
    );
  if (
    pendingDefinitions.length === 0 ||
    !sourceContractMatches ||
    !targetContractMatches
  ) {
    throw new Error(
      `Approved migration exact contracts are invalid (pending: ${pendingDefinitions.length}; source received ${capability.sourceContract.schemaSha256}; target expected ${exactTargetContract.schemaSha256}, received ${capability.targetContract.schemaSha256})`,
    );
  }
  assertExactDatabaseMigrationContract(
    connection.sqlite,
    capability.sourceContract,
  );
  if (
    databaseLogicalSha256(connection.sqlite) !==
      capability.sourceLogicalSha256 ||
    !inspectLegacyCompatibilityHealth(connection.sqlite).coherent ||
    !/^[a-f0-9]{64}$/u.test(capability.approvedBackupLogicalSha256) ||
    !/^[a-f0-9]{64}$/u.test(capability.approvedBackupSha256) ||
    !/^[a-f0-9]{64}$/u.test(capability.approvedBackupPathHash)
  ) {
    throw new Error(
      "Database no longer matches its admitted M2 source and approved backup",
    );
  }

  const sourceMigrationId =
    capability.sourceContract.migrationIds[sourceLength - 1];
  if (sourceMigrationId === courseFoundationsMigrationId) {
    const runs = connection.sqlite
      .prepare(
        `SELECT source_database_digest, approved_backup_logical_sha256,
                approved_backup_sha256, approved_backup_path_hash
         FROM migration_runs
         WHERE transform_version = 'm2-v1' AND status = 'completed'`,
      )
      .all() as Array<{
      source_database_digest: string;
      approved_backup_logical_sha256: string | null;
      approved_backup_sha256: string | null;
      approved_backup_path_hash: string | null;
    }>;
    const run = runs[0];
    if (
      runs.length !== 1 ||
      run === undefined ||
      run.source_database_digest !== capability.approvedBackupLogicalSha256 ||
      run.approved_backup_logical_sha256 !==
        capability.approvedBackupLogicalSha256 ||
      run.approved_backup_sha256 !== capability.approvedBackupSha256 ||
      run.approved_backup_path_hash !== capability.approvedBackupPathHash
    ) {
      throw new Error(
        "Existing Course foundations are not bound to the approved backup",
      );
    }
  } else if (
    capability.approvedBackupLogicalSha256 !== capability.sourceLogicalSha256
  ) {
    throw new Error(
      "Approved backup does not match the exact M2 source contract",
    );
  }

  const stageContracts = pendingDefinitions.map((definition) => {
    const contract = approvedM2StageContracts[definition.id];
    if (contract === undefined) {
      throw new Error(
        `Migration ${definition.id} has no approved exact M2 stage contract`,
      );
    }
    return contract;
  });
  connection.sqlite.exec("PRAGMA foreign_keys = OFF");
  let transactionStarted = false;
  try {
    connection.sqlite.exec("BEGIN IMMEDIATE");
    transactionStarted = true;
    assertExactDatabaseMigrationContract(
      connection.sqlite,
      capability.sourceContract,
    );
    if (
      databaseLogicalSha256(connection.sqlite) !==
      capability.sourceLogicalSha256
    ) {
      throw new Error("Database changed before the approved M2 migration");
    }

    for (const [index, definition] of pendingDefinitions.entries()) {
      const sourceLogicalSha256 = databaseLogicalSha256(connection.sqlite);
      executeMigrationDefinition(
        connection,
        definition,
        definition.id === courseFoundationsMigrationId
          ? {
              approvedBackupLogicalSha256:
                capability.approvedBackupLogicalSha256,
              approvedBackupSha256: capability.approvedBackupSha256,
              approvedBackupPathHash: capability.approvedBackupPathHash,
            }
          : undefined,
      );
      const timestamp = Date.now();
      const transformVersion =
        definition.id === courseFoundationsCorrectionMigrationId
          ? "m2-v2"
          : definition.id === courseFoundationsHardeningMigrationId
            ? "m2-v3"
            : definition.id ===
                courseFoundationsQuarantineImmutabilityMigrationId
              ? "m2-v4"
              : undefined;
      if (transformVersion !== undefined) {
        recordM2MigrationRun(
          connection.sqlite,
          definition.id,
          transformVersion,
          sourceLogicalSha256,
          timestamp,
          capability,
        );
      }
      connection.sqlite
        .prepare("INSERT INTO __dlh_migrations (id, applied_at) VALUES (?, ?)")
        .run(definition.id, timestamp);
      assertNoForeignKeyViolations(connection.sqlite);
      assertExactDatabaseMigrationContract(
        connection.sqlite,
        stageContracts[index]!,
      );
    }

    assertExactDatabaseMigrationContract(
      connection.sqlite,
      capability.targetContract,
    );
    connection.sqlite
      .prepare(
        `INSERT INTO approved_core_migration_runs
         (target_schema_sha256, source_schema_sha256, source_logical_sha256,
          approved_backup_logical_sha256, approved_backup_sha256,
          approved_backup_path_hash, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        capability.targetContract.schemaSha256,
        capability.sourceContract.schemaSha256,
        capability.sourceLogicalSha256,
        capability.approvedBackupLogicalSha256,
        capability.approvedBackupSha256,
        capability.approvedBackupPathHash,
        Date.now(),
      );
    transactionGuard.assertBackupUnchangedBeforeCommit();
    connection.sqlite.exec("COMMIT");
    transactionStarted = false;
  } catch (error) {
    if (transactionStarted) connection.sqlite.exec("ROLLBACK");
    throw error;
  } finally {
    connection.sqlite.exec("PRAGMA foreign_keys = ON");
  }
}

function buildCurrentMigrationContract(
  definitions: readonly MigrationDefinition[],
): CurrentDatabaseMigrationContract {
  const connection = openDatabase(":memory:");
  try {
    applyMigrationDefinitions(connection, definitions);
    return {
      migrationIds: definitions.map((definition) => definition.id),
      schemaSha256: databaseSchemaSha256(connection.sqlite),
    };
  } finally {
    connection.close();
  }
}

export function getCurrentDatabaseMigrationContract(
  directory = migrationsDirectory,
): CurrentDatabaseMigrationContract {
  return buildCurrentMigrationContract(readMigrationDefinitions(directory));
}

export function assertExactDatabaseMigrationContract(
  sqlite: DatabaseSync,
  contract: CurrentDatabaseMigrationContract,
): void {
  const exactLedger = hasExactMigrationLedger(sqlite, contract.migrationIds);
  const observedSchemaSha256 = databaseSchemaSha256(sqlite);
  if (!exactLedger || observedSchemaSha256 !== contract.schemaSha256) {
    throw new Error(
      `Database must match its admitted exact migration ledger and schema (ledger: ${String(exactLedger)}; expected schema: ${contract.schemaSha256}; observed schema: ${observedSchemaSha256})`,
    );
  }
}

export function assertCurrentDatabaseMigrationContract(
  sqlite: DatabaseSync,
  contract: CurrentDatabaseMigrationContract,
): void {
  try {
    assertExactDatabaseMigrationContract(sqlite, contract);
  } catch (error) {
    throw new Error(
      "Database must match the current migration ledger and schema before M1 writes",
      { cause: error },
    );
  }
}

export function migrateDatabase(
  connection: DatabaseConnection,
  directory = migrationsDirectory,
  admission?: DatabaseMigrationAdmissionCapability,
): void {
  if (admission !== undefined) {
    if (admission.kind !== "legacy-compatible-noop") {
      throw new Error("Database migration admission capability is invalid");
    }
    assertExactDatabaseMigrationContract(connection.sqlite, admission.contract);
    if (
      databaseLogicalSha256(connection.sqlite) !== admission.logicalSha256 ||
      !inspectLegacyCompatibilityHealth(connection.sqlite).coherent
    ) {
      throw new Error(
        "Database no longer matches its admitted legacy-compatible snapshot",
      );
    }
    return;
  }
  const definitions = readMigrationDefinitions(directory);

  const contract = buildCurrentMigrationContract(definitions);
  if (hasExactMigrationLedger(connection.sqlite, contract.migrationIds)) {
    assertCurrentDatabaseMigrationContract(connection.sqlite, contract);
    return;
  }

  const courseFoundationIndex = definitions.findIndex(
    (definition) => definition.id === courseFoundationsMigrationId,
  );
  if (courseFoundationIndex >= 0) {
    for (
      let sourceLength = courseFoundationIndex;
      sourceLength < definitions.length;
      sourceLength += 1
    ) {
      const sourceDefinitions = definitions.slice(0, sourceLength);
      const sourceIds = sourceDefinitions.map((definition) => definition.id);
      if (hasExactMigrationLedger(connection.sqlite, sourceIds)) {
        assertCurrentDatabaseMigrationContract(
          connection.sqlite,
          buildCurrentMigrationContract(sourceDefinitions),
        );
        throw new Error(
          "Existing M2 data requires an explicit approved-backup migration capability",
        );
      }
    }
  }

  applyMigrationDefinitions(connection, definitions);
  assertCurrentDatabaseMigrationContract(connection.sqlite, contract);
}
