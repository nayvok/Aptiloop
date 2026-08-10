import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  truncateSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import type { SessionSnapshot } from "@dlh/shared";
import { afterEach, describe, expect, it } from "vitest";

import {
  createApprovedM1Backup,
  verifyApprovedM2MigrationBackup,
} from "../src/approved-backup.js";
import { backfillCourseFoundations } from "../src/course-foundation-backfill.js";
import { runM1MigrationCli } from "../src/cli/migrate.js";
import {
  canonicalJson,
  hashCanonicalJson,
} from "../src/authoring-repository.js";
import { migrateDatabase, openDatabase } from "../src/database.js";
import {
  databaseLogicalSha256,
  inventoryPrivateData,
} from "../src/private-data-inventory.js";

const roots: string[] = [];
const migrationsSource = fileURLToPath(
  new URL("../migrations", import.meta.url),
);

function temporaryRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), "aptiloop-m2-safety-"));
  roots.push(root);
  return root;
}

function sha256File(candidate: string): string {
  return createHash("sha256").update(readFileSync(candidate)).digest("hex");
}

function createExactPreM2Active(projectRoot: string): string {
  const migrationDirectory = path.join(projectRoot, "migrations-through-0005");
  mkdirSync(migrationDirectory);
  for (const filename of readdirSync(migrationsSource).filter((entry) =>
    /^000[0-5]_.*\.sql$/u.test(entry),
  )) {
    copyFileSync(
      path.join(migrationsSource, filename),
      path.join(migrationDirectory, filename),
    );
  }
  const databasePath = path.join(
    projectRoot,
    ".data",
    "dev-learning-harness.sqlite",
  );
  const connection = openDatabase(databasePath);
  try {
    migrateDatabase(connection, migrationDirectory);
    connection.sqlite.exec(`
    DROP INDEX unit_progress_session_order_idx;
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
    SELECT id, session_id, unit_id, unit_type, status, progress_json, started_at,
           completed_at, skipped_at, updated_at
    FROM unit_progress;
    DROP TABLE unit_progress;
    ALTER TABLE unit_progress_v2_contract RENAME TO unit_progress;
    CREATE INDEX unit_progress_session_order_idx
      ON unit_progress(session_id, updated_at);
      DROP INDEX learning_sessions_one_global_active_uq;
      DROP TRIGGER curriculum_versions_published_update_guard;
      DROP TRIGGER curriculum_versions_published_delete_guard;
      DROP TRIGGER curriculum_weeks_published_insert_guard;
      DROP TRIGGER curriculum_days_v2_published_insert_guard;
      DROP TRIGGER curriculum_units_published_insert_guard;
    `);
  } finally {
    connection.close();
  }
  const standalone = new DatabaseSync(databasePath);
  standalone.exec("PRAGMA journal_mode = DELETE");
  standalone.close();
  return databasePath;
}

async function createExactPreM6Fixture(): Promise<{
  projectRoot: string;
  source: string;
  backup: string;
  backupSha256: string;
}> {
  const projectRoot = temporaryRoot();
  const migrationDirectory = path.join(projectRoot, "migrations-through-0013");
  mkdirSync(migrationDirectory);
  for (const filename of readdirSync(migrationsSource).filter((entry) =>
    /^(?:000\d|001[0-3])_.*\.sql$/u.test(entry),
  )) {
    copyFileSync(
      path.join(migrationsSource, filename),
      path.join(migrationDirectory, filename),
    );
  }
  const source = path.join(projectRoot, ".data", "dev-learning-harness.sqlite");
  const connection = openDatabase(source);
  try {
    migrateDatabase(connection, migrationDirectory);
  } finally {
    connection.close();
  }
  const backup = path.join(
    projectRoot,
    ".data",
    "approved-backups",
    "approved-pre-m6.sqlite",
  );
  await createApprovedM1Backup({
    projectRoot,
    sourcePath: source,
    destinationPath: backup,
  });
  return {
    projectRoot,
    source,
    backup,
    backupSha256: sha256File(backup),
  };
}
function seedQuarantinedActiveSession(sqlite: DatabaseSync): void {
  const now = Date.UTC(2026, 7, 9);
  const activity = {
    id: "activity-v1",
    stableId: "activity-v1",
    type: "study" as const,
    title: "Legacy activity",
    description: "Preserved legacy activity",
    order: 1,
    estimatedMinutes: 5,
    objectives: [],
    checklist: [],
    sources: [],
    questions: [],
    misconceptions: [],
    referenceAnswer: null,
    completionCriteria: [{ type: "acknowledgement" as const }],
    unlockRules: [],
    optional: false,
    depthLevel: "foundation" as const,
    payload: { type: "study" as const, body: "Preserved legacy activity" },
  };
  const snapshotCore: Omit<SessionSnapshot, "contentHash"> = {
    schemaVersion: 2,
    curriculumId: "quarantine-course",
    curriculumVersionId: "legacy-v1",
    curriculumRevision: 1,
    curriculumTitle: "Quarantine course",
    week: {
      id: "section-v1",
      stableId: "section-v1",
      order: 1,
      title: "Legacy section",
      description: null,
    },
    day: {
      id: "lesson-v1",
      stableId: "lesson-v1",
      order: 1,
      title: "Legacy lesson",
      description: "Preserved legacy lesson",
      goal: "Preserve compatibility",
      estimatedMinutes: 5,
      prerequisites: [],
      expectedOutcomes: [],
      depthLevel: "foundation",
      outOfScope: [],
      topics: [],
    },
    units: [activity],
    capturedAt: "2026-08-09T00:00:00.000Z",
  };
  const contentHash = hashCanonicalJson(snapshotCore);
  const snapshotJson = canonicalJson({ ...snapshotCore, contentHash });
  sqlite.exec(`
    INSERT INTO curriculum_days
      (id, slug, week_number, day_number, title, summary, estimated_minutes,
       goals_json, sources_json, created_at, updated_at)
    VALUES ('legacy-day', 'legacy-day', 1, 1, 'Legacy day', 'Legacy', 5,
            '[]', '[]', ${now}, ${now});
    INSERT INTO curricula
      (id, slug, title, description, active_version_id, created_at, updated_at)
    VALUES ('quarantine-course', 'quarantine-course', 'Quarantine course', NULL,
            NULL, ${now}, ${now});
    INSERT INTO curriculum_versions
      (id, curriculum_id, revision, parent_version_id, status, title,
       description, content_hash, created_at, published_at, archived_at,
       updated_at)
    VALUES
      ('legacy-v1', 'quarantine-course', 1, NULL, 'published',
       'Legacy revision', NULL, 'legacy-v1', ${now}, ${now}, NULL, ${now}),
      ('current-v2', 'quarantine-course', 2, 'legacy-v1', 'published',
       'Current revision', NULL, '${"b".repeat(64)}', ${now + 1}, ${now + 1},
       NULL, ${now + 1});
    UPDATE curricula SET active_version_id = 'current-v2'
    WHERE id = 'quarantine-course';
    INSERT INTO curriculum_weeks
      (id, version_id, stable_id, order_index, title, description, created_at,
       updated_at)
    VALUES
      ('section-v1', 'legacy-v1', 'section-v1', 0, 'Legacy section', NULL,
       ${now}, ${now}),
      ('section-v2', 'current-v2', 'section-v2', 0, 'Current section', NULL,
       ${now + 1}, ${now + 1});
    INSERT INTO curriculum_days_v2
      (id, version_id, week_id, stable_id, order_index, title, description,
       goal, estimated_minutes, prerequisites_json, expected_outcomes_json,
       depth_level, out_of_scope_json, topics_json, created_at, updated_at)
    VALUES
      ('lesson-v1', 'legacy-v1', 'section-v1', 'lesson-v1', 0,
       'Legacy lesson', 'Preserved legacy lesson', 'Preserve compatibility', 5,
       '[]', '[]', 'foundation', '[]', '[]', ${now}, ${now}),
      ('lesson-v2', 'current-v2', 'section-v2', 'lesson-v2', 0,
       'Current lesson', 'Current lesson', 'Learn', 5, '[]', '[]', 'foundation',
       '[]', '[]', ${now + 1}, ${now + 1});
    INSERT INTO curriculum_units
      (id, version_id, day_id, stable_id, type, order_index, title, description,
       estimated_minutes, objectives_json, checklist_json, sources_json,
       questions_json, misconceptions_json, reference_answer_json,
       completion_criteria_json, unlock_rules_json, optional, depth_level,
       payload_json, created_at, updated_at)
    VALUES
      ('activity-v1', 'legacy-v1', 'lesson-v1', 'activity-v1', 'study', 0,
       'Legacy activity', 'Preserved legacy activity', 5, '[]', '[]', '[]',
       '[]', '[]', NULL, '[{"type":"acknowledgement"}]', '[]', 0,
       'foundation', '{"type":"study","body":"Preserved legacy activity"}',
       ${now}, ${now}),
      ('activity-v2', 'current-v2', 'lesson-v2', 'activity-v2', 'study', 0,
       'Current activity', 'Current activity', 5, '[]', '[]', '[]', '[]', '[]',
       NULL, '[{"type":"acknowledgement"}]', '[]', 0, 'foundation',
       '{"type":"study","body":"Current activity"}', ${now + 1},
       ${now + 1});
    INSERT INTO learning_sessions
      (id, day_id, status, current_step, started_at, completed_at, updated_at,
       curriculum_day_v2_id)
    VALUES ('quarantined-active-session', 'legacy-day', 'active', 'study',
            ${now}, NULL, ${now}, 'lesson-v1');
  `);
  sqlite
    .prepare(
      `INSERT INTO session_snapshots
       (id, session_id, schema_version, curriculum_id, curriculum_version_id,
        curriculum_day_id, content_hash, snapshot_json, created_at)
       VALUES ('quarantined-active-snapshot', 'quarantined-active-session', 2,
               'quarantine-course', 'legacy-v1', 'lesson-v1', ?, ?, ?)`,
    )
    .run(contentHash, snapshotJson, now);
}

async function createFixture(): Promise<{
  projectRoot: string;
  source: string;
  backup: string;
  backupSha256: string;
}> {
  const projectRoot = temporaryRoot();
  const source = createExactPreM2Active(projectRoot);
  const backup = path.join(
    projectRoot,
    ".data",
    "approved-backups",
    "approved-pre-m2.sqlite",
  );
  await createApprovedM1Backup({
    projectRoot,
    sourcePath: source,
    destinationPath: backup,
  });
  return { projectRoot, source, backup, backupSha256: sha256File(backup) };
}

async function createPreHardeningFixture(
  withQuarantinedActiveSession = false,
): Promise<{
  projectRoot: string;
  source: string;
  backup: string;
  backupSha256: string;
}> {
  const projectRoot = temporaryRoot();
  const source = createExactPreM2Active(projectRoot);
  const connection = openDatabase(source);
  if (withQuarantinedActiveSession) {
    seedQuarantinedActiveSession(connection.sqlite);
  }
  const timestamp = Date.UTC(2026, 7, 9);
  const sourceDatabaseDigest = databaseLogicalSha256(connection.sqlite);
  const foundationsSql = readFileSync(
    path.join(migrationsSource, "0006_course_foundations.sql"),
    "utf8",
  );
  const foundationsSections = foundationsSql.split(
    "-- dlh-course-foundations-backfill",
  );
  if (foundationsSections.length !== 2) {
    throw new Error("Course foundation fixture migration is malformed");
  }
  connection.sqlite.exec(foundationsSections[0]!);
  backfillCourseFoundations(connection, {
    sourceDatabaseDigest,
    approvedBackupLogicalSha256: sourceDatabaseDigest,
    approvedBackupSha256: "c".repeat(64),
    approvedBackupPathHash: "d".repeat(64),
  });
  connection.sqlite.exec(foundationsSections[1]!);
  connection.sqlite
    .prepare("INSERT INTO __dlh_migrations (id, applied_at) VALUES (?, ?)")
    .run("0006_course_foundations", timestamp);
  connection.sqlite.exec(
    readFileSync(
      path.join(migrationsSource, "0007_quarantined_course_compatibility.sql"),
      "utf8",
    ),
  );
  connection.sqlite
    .prepare("INSERT INTO __dlh_migrations (id, applied_at) VALUES (?, ?)")
    .run("0007_quarantined_course_compatibility", timestamp + 1);
  const correctionSourceDigest = databaseLogicalSha256(connection.sqlite);
  const sourceRowsDigest = createHash("sha256")
    .update(
      JSON.stringify({
        sourceLogicalSha256: correctionSourceDigest,
        migrationId: "0008_m2_acceptance_corrections",
      }),
    )
    .digest("hex");
  connection.sqlite.exec("PRAGMA foreign_keys = OFF");
  connection.sqlite.exec(
    readFileSync(
      path.join(migrationsSource, "0008_m2_acceptance_corrections.sql"),
      "utf8",
    ),
  );
  connection.sqlite
    .prepare(
      `INSERT INTO migration_runs
       (id, transform_version, source_database_digest, source_rows_digest,
        approved_backup_logical_sha256, approved_backup_sha256,
        approved_backup_path_hash, status, source_row_count, mapped_count,
        quarantined_count, intentionally_unmapped_count, started_at,
        completed_at)
       VALUES (?, 'm2-v2', ?, ?, NULL, NULL, NULL, 'completed', 0, 0, 0, 0,
               ?, ?)`,
    )
    .run(
      `m2-v2-${sourceRowsDigest.slice(0, 32)}`,
      correctionSourceDigest,
      sourceRowsDigest,
      timestamp + 2,
      timestamp + 2,
    );
  connection.sqlite
    .prepare("INSERT INTO __dlh_migrations (id, applied_at) VALUES (?, ?)")
    .run("0008_m2_acceptance_corrections", timestamp + 2);
  expect(connection.sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual(
    [],
  );
  connection.sqlite.exec("PRAGMA foreign_keys = ON");
  connection.close();
  const standalone = new DatabaseSync(source);
  standalone.exec("PRAGMA journal_mode = DELETE");
  standalone.close();
  const backup = path.join(
    projectRoot,
    ".data",
    "approved-backups",
    "approved-pre-hardening.sqlite",
  );
  await createApprovedM1Backup({
    projectRoot,
    sourcePath: source,
    destinationPath: backup,
  });
  return { projectRoot, source, backup, backupSha256: sha256File(backup) };
}
async function createPostHardeningFixture(): Promise<{
  projectRoot: string;
  source: string;
  backup: string;
  backupSha256: string;
}> {
  const fixture = await createPreHardeningFixture();
  const connection = openDatabase(fixture.source);
  const timestamp = Date.UTC(2026, 7, 9, 1);
  const sourceLogicalSha256 = databaseLogicalSha256(connection.sqlite);
  const sourceRowsDigest = createHash("sha256")
    .update(
      JSON.stringify({
        sourceLogicalSha256,
        migrationId: "0009_m2_acceptance_hardening",
      }),
    )
    .digest("hex");
  connection.sqlite.exec(
    readFileSync(
      path.join(migrationsSource, "0009_m2_acceptance_hardening.sql"),
      "utf8",
    ),
  );
  connection.sqlite
    .prepare(
      `INSERT INTO migration_runs
       (id, transform_version, source_database_digest, source_rows_digest,
        approved_backup_logical_sha256, approved_backup_sha256,
        approved_backup_path_hash, status, source_row_count, mapped_count,
        quarantined_count, intentionally_unmapped_count, started_at,
        completed_at)
       VALUES (?, 'm2-v3', ?, ?, NULL, NULL, NULL, 'completed', 0, 0, 0, 0,
               ?, ?)`,
    )
    .run(
      `m2-v3-${sourceRowsDigest.slice(0, 32)}`,
      sourceLogicalSha256,
      sourceRowsDigest,
      timestamp,
      timestamp,
    );
  connection.sqlite
    .prepare("INSERT INTO __dlh_migrations (id, applied_at) VALUES (?, ?)")
    .run("0009_m2_acceptance_hardening", timestamp);
  connection.close();
  const backup = path.join(
    fixture.projectRoot,
    ".data",
    "approved-backups",
    "approved-post-hardening.sqlite",
  );
  await createApprovedM1Backup({
    projectRoot: fixture.projectRoot,
    sourcePath: fixture.source,
    destinationPath: backup,
  });
  return {
    projectRoot: fixture.projectRoot,
    source: fixture.source,
    backup,
    backupSha256: sha256File(backup),
  };
}

afterEach(() => {
  while (roots.length) {
    const root = roots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

describe("authorized M2 active migration", () => {
  it("verifies exact-byte recovery and preserves pre-M2 compatibility", async () => {
    const fixture = await createFixture();
    const verification = verifyApprovedM2MigrationBackup({
      projectRoot: fixture.projectRoot,
      sourcePath: fixture.source,
      backupPath: fixture.backup,
      expectedBackupSha256: fixture.backupSha256,
    });

    expect(verification.alreadyMigrated).toBe(false);
    expect(verification.sourceLogicalSha256).toBe(
      verification.backupLogicalSha256,
    );
    expect(verification.migrations.ids).toEqual([
      "0000_initial",
      "0001_versioned_curriculum",
      "0002_snapshot_contract_and_hints",
      "0003_unit_evidence",
      "0004_unit_progress_compatibility",
      "0005_test_run_diff_fingerprint",
    ]);
    expect(verification.m2.present).toBe(false);
    expect(
      readdirSync(path.dirname(fixture.backup)).filter((entry) =>
        entry.startsWith(".aptiloop-restore-verification-"),
      ),
    ).toEqual([]);
  }, 30_000);

  it("applies the M2 migrations once and reports a truthful verified no-op on replay", async () => {
    const fixture = await createFixture();
    const argv = [
      "--authorize-m2",
      "--approved-backup",
      fixture.backup,
      "--backup-sha256",
      fixture.backupSha256,
    ];
    const statuses: string[] = [];
    const first = runM1MigrationCli({
      argv,
      projectRoot: fixture.projectRoot,
      writeStatus: (status) => statuses.push(status),
    });
    const afterFirst = inventoryPrivateData({
      databasePaths: [fixture.source],
    });
    const candidate = afterFirst.candidates[0];
    expect(candidate?.health.opened).toBe(true);
    if (!candidate?.health.opened)
      throw new Error("Migrated fixture did not open");
    expect(candidate.health.migrations.ids.at(-1)).toBe(
      "0016_course_designer_workflow",
    );
    expect(candidate.health.m2).toMatchObject({
      present: true,
      complete: true,
      orphans: { total: 0 },
      runs: {
        m2V1Rows: 1,
        m2V2Rows: 1,
        m2V3Rows: 1,
        m2V4Rows: 1,
        reconciled: true,
        approvedBackupSha256: fixture.backupSha256,
        quarantineImmutabilityApprovedBackupSha256: null,
      },
    });
    const logicalAfterFirst = candidate.health.logicalSha256;

    const second = runM1MigrationCli({
      argv,
      projectRoot: fixture.projectRoot,
      writeStatus: (status) => statuses.push(status),
    });
    const afterSecond = inventoryPrivateData({
      databasePaths: [fixture.source],
    });
    const replay = afterSecond.candidates[0];
    expect(replay?.health.opened).toBe(true);
    if (!replay?.health.opened)
      throw new Error("Replayed fixture did not open");

    expect(first).toContain("migrated with verified recovery backup");
    expect(second).toContain("already current; no migration performed");
    expect(replay.health.logicalSha256).toBe(logicalAfterFirst);
    expect(statuses).toEqual([first, second]);
    expect(sha256File(fixture.backup)).toBe(fixture.backupSha256);
    expect(
      readdirSync(path.dirname(fixture.backup)).filter((entry) =>
        entry.startsWith(".aptiloop-migration-recovery-"),
      ),
    ).toEqual([]);
  }, 30_000);

  it("backs up, migrates, and replays the exact pre-M6 contract", async () => {
    const fixture = await createExactPreM6Fixture();
    const argv = [
      "--authorize-current",
      "--approved-backup",
      fixture.backup,
      "--backup-sha256",
      fixture.backupSha256,
    ];

    const first = runM1MigrationCli({
      argv,
      projectRoot: fixture.projectRoot,
      writeStatus: () => undefined,
    });
    const migrated = inventoryPrivateData({
      databasePaths: [fixture.source],
    }).candidates[0];
    expect(migrated?.health.opened).toBe(true);
    if (!migrated?.health.opened) {
      throw new Error("Pre-M6 migrated fixture did not open");
    }
    const logicalAfterFirst = migrated.health.logicalSha256;

    const second = runM1MigrationCli({
      argv,
      projectRoot: fixture.projectRoot,
      writeStatus: () => undefined,
    });
    const replayed = inventoryPrivateData({
      databasePaths: [fixture.source],
    }).candidates[0];
    expect(replayed?.health.opened).toBe(true);
    if (!replayed?.health.opened) {
      throw new Error("Pre-M6 replayed fixture did not open");
    }

    expect(first).toContain("migrated with verified recovery backup");
    expect(second).toContain("already current; no migration performed");
    expect(migrated.health.migrations.ids.at(-1)).toBe(
      "0016_course_designer_workflow",
    );
    expect(replayed.health.logicalSha256).toBe(logicalAfterFirst);
    expect(sha256File(fixture.backup)).toBe(fixture.backupSha256);
  }, 15_000);

  it("rejects wrong hashes, wrong paths, stale sources, and partial markers", async () => {
    const fixture = await createFixture();
    const input = {
      projectRoot: fixture.projectRoot,
      sourcePath: fixture.source,
      backupPath: fixture.backup,
      expectedBackupSha256: fixture.backupSha256,
    };
    expect(() =>
      verifyApprovedM2MigrationBackup({
        ...input,
        expectedBackupSha256: "0".repeat(64),
      }),
    ).toThrow(/SHA-256/u);
    expect(() =>
      verifyApprovedM2MigrationBackup({
        ...input,
        backupPath: path.join(fixture.projectRoot, "unapproved.sqlite"),
      }),
    ).toThrow(/approved-backups/u);

    const stale = new DatabaseSync(fixture.source);
    stale.exec("PRAGMA user_version = 7");
    stale.close();
    expect(() => verifyApprovedM2MigrationBackup(input)).toThrow(
      /does not match|lineage/u,
    );

    const repaired = new DatabaseSync(fixture.source);
    repaired.exec(`
    PRAGMA user_version = 0;
    INSERT INTO __dlh_migrations (id, applied_at)
    VALUES ('0006_course_foundations', 1)
  `);
    repaired.close();
    expect(() => verifyApprovedM2MigrationBackup(input)).toThrow(
      /exact migration|pre-M2|completed M2/u,
    );
  }, 15_000);

  it("rejects a privacy-unsafe active source even with an approved backup", async () => {
    const fixture = await createFixture();
    const source = new DatabaseSync(fixture.source);
    source.exec(`
    INSERT INTO agent_conversations
      (id, learning_session_id, role, provider_id, model_id,
       provider_session_id, status, created_at, updated_at)
    VALUES ('unsafe-conversation', NULL, 'teacher', 'provider', 'model',
            NULL, 'active', 1, 1);
    INSERT INTO agent_messages
      (id, conversation_id, role, content, tool_events_json, raw_event_json,
       status, sequence, idempotency_key, created_at)
    VALUES ('unsafe-message', 'unsafe-conversation', 'assistant', 'redacted',
            '[]', '{"private":"payload"}', 'complete', 0, NULL, 1)
  `);
    source.close();

    expect(() =>
      verifyApprovedM2MigrationBackup({
        projectRoot: fixture.projectRoot,
        sourcePath: fixture.source,
        backupPath: fixture.backup,
        expectedBackupSha256: fixture.backupSha256,
      }),
    ).toThrow(/private|raw|approved/u);
  }, 15_000);

  it("rolls back every pending M2 migration when the backup changes before commit", async () => {
    const fixture = await createFixture();
    const originalBackupSha256 = fixture.backupSha256;

    expect(() =>
      runM1MigrationCli({
        argv: [
          "--authorize-m2",
          "--approved-backup",
          fixture.backup,
          "--backup-sha256",
          originalBackupSha256,
        ],
        projectRoot: fixture.projectRoot,
        testHooks: {
          beforeAuthorizedCommit: () => truncateSync(fixture.backup, 0),
        },
        writeStatus: () => undefined,
      }),
    ).toThrow(/backup|recovery|SHA-256/iu);

    const source = inventoryPrivateData({ databasePaths: [fixture.source] });
    const candidate = source.candidates[0];
    expect(candidate?.health.opened).toBe(true);
    if (!candidate?.health.opened) {
      throw new Error("Rolled-back fixture did not open");
    }
    expect(candidate.health.migrations.ids).toEqual([
      "0000_initial",
      "0001_versioned_curriculum",
      "0002_snapshot_contract_and_hints",
      "0003_unit_evidence",
      "0004_unit_progress_compatibility",
      "0005_test_run_diff_fingerprint",
    ]);
    expect(candidate.health.m2.present).toBe(false);

    const recoveryCopies = readdirSync(path.dirname(fixture.backup)).filter(
      (entry) => entry.startsWith(".aptiloop-migration-recovery-"),
    );
    expect(recoveryCopies).toHaveLength(1);
    expect(
      sha256File(path.join(path.dirname(fixture.backup), recoveryCopies[0]!)),
    ).toBe(originalBackupSha256);
  }, 15_000);

  it("admits exact 0008 only as a no-op until a backup-bound m2-v3 migration", async () => {
    const fixture = await createPreHardeningFixture();
    const defaultStatus = runM1MigrationCli({
      argv: [],
      projectRoot: fixture.projectRoot,
      writeStatus: () => undefined,
    });
    expect(defaultStatus).toContain("Legacy compatibility admitted");
    const before = inventoryPrivateData({ databasePaths: [fixture.source] });
    const beforeCandidate = before.candidates[0];
    expect(beforeCandidate?.health.opened).toBe(true);
    if (!beforeCandidate?.health.opened) {
      throw new Error("Pre-hardening fixture did not open");
    }
    expect(beforeCandidate.health.migrations.ids.at(-1)).toBe(
      "0008_m2_acceptance_corrections",
    );
    expect(beforeCandidate.health.m2.runs.m2V3Rows).toBe(0);

    runM1MigrationCli({
      argv: [
        "--authorize-m2",
        "--approved-backup",
        fixture.backup,
        "--backup-sha256",
        fixture.backupSha256,
      ],
      projectRoot: fixture.projectRoot,
      writeStatus: () => undefined,
    });
    const after = inventoryPrivateData({ databasePaths: [fixture.source] });
    const candidate = after.candidates[0];
    expect(candidate?.health.opened).toBe(true);
    if (!candidate?.health.opened) {
      throw new Error("Hardened fixture did not open");
    }
    expect(candidate.health.migrations.ids.at(-1)).toBe(
      "0016_course_designer_workflow",
    );
    expect(candidate.health.m2.runs).toMatchObject({
      m2V3Rows: 1,
      hardeningSourceDatabaseDigest: beforeCandidate.health.logicalSha256,
      hardeningApprovedBackupLogicalSha256:
        beforeCandidate.health.logicalSha256,
      hardeningApprovedBackupSha256: fixture.backupSha256,
      m2V4Rows: 1,
      quarantineImmutabilityApprovedBackupLogicalSha256: null,
      quarantineImmutabilityApprovedBackupSha256: null,
    });
  }, 15_000);
  it("migrates exact 0009 only with its exact approved backup", async () => {
    const fixture = await createPostHardeningFixture();
    const defaultStatus = runM1MigrationCli({
      argv: [],
      projectRoot: fixture.projectRoot,
      writeStatus: () => undefined,
    });
    expect(defaultStatus).toContain("Legacy compatibility admitted");
    const before = inventoryPrivateData({ databasePaths: [fixture.source] });
    const beforeCandidate = before.candidates[0];
    expect(beforeCandidate?.health.opened).toBe(true);
    if (!beforeCandidate?.health.opened) {
      throw new Error("Post-hardening source fixture did not open");
    }

    runM1MigrationCli({
      argv: [
        "--authorize-m2",
        "--approved-backup",
        fixture.backup,
        "--backup-sha256",
        fixture.backupSha256,
      ],
      projectRoot: fixture.projectRoot,
      writeStatus: () => undefined,
    });
    const inventory = inventoryPrivateData({
      databasePaths: [fixture.source],
    });
    const candidate = inventory.candidates[0];
    expect(candidate?.health.opened).toBe(true);
    if (!candidate?.health.opened) {
      throw new Error("Post-hardening fixture did not open");
    }
    expect(candidate.health.migrations.ids.at(-1)).toBe(
      "0016_course_designer_workflow",
    );
    expect(candidate.health.m2.runs).toMatchObject({
      m2V4Rows: 1,
      quarantineImmutabilitySourceDatabaseDigest:
        beforeCandidate.health.logicalSha256,
      quarantineImmutabilityApprovedBackupLogicalSha256:
        beforeCandidate.health.logicalSha256,
      quarantineImmutabilityApprovedBackupSha256: fixture.backupSha256,
    });
    expect(
      candidate.health.m2.sessionContexts
        .quarantinedActiveSessionSourceHashMismatchRows,
    ).toBe(0);
    expect(
      candidate.health.m2.provenance.quarantinedRevisionSourceHashMismatchRows,
    ).toBe(0);
  }, 15_000);
  it("rejects stale source rows behind quarantine compatibility", async () => {
    const fixture = await createPreHardeningFixture(true);
    const before = inventoryPrivateData({ databasePaths: [fixture.source] });
    const beforeCandidate = before.candidates[0];
    expect(beforeCandidate?.health.opened).toBe(true);
    if (!beforeCandidate?.health.opened) {
      throw new Error("Quarantine compatibility fixture did not open");
    }
    expect(beforeCandidate.health.m2.sessionContexts).toMatchObject({
      quarantinedActiveSessionsMissingContextRows: 1,
      quarantinedActiveSessionSourceHashMismatchRows: 0,
      unaccountedActiveSessionsMissingContextRows: 0,
    });

    const stale = new DatabaseSync(fixture.source);
    stale
      .prepare(
        `UPDATE curriculum_versions
       SET title = 'Mutated legacy revision'
       WHERE id = 'legacy-v1'`,
      )
      .run();
    stale.close();

    const after = inventoryPrivateData({ databasePaths: [fixture.source] });
    const afterCandidate = after.candidates[0];
    expect(afterCandidate?.health.opened).toBe(true);
    if (!afterCandidate?.health.opened) {
      throw new Error("Stale quarantine fixture did not open");
    }
    expect(
      afterCandidate.health.m2.sessionContexts
        .quarantinedActiveSessionSourceHashMismatchRows,
    ).toBe(1);
    expect(
      afterCandidate.health.m2.provenance
        .quarantinedRevisionSourceHashMismatchRows,
    ).toBe(1);
    expect(() =>
      runM1MigrationCli({
        argv: [],
        projectRoot: fixture.projectRoot,
        writeStatus: () => undefined,
      }),
    ).toThrow(/exact migration contract/u);
  }, 15_000);
  it("rejects non-text hashes behind quarantine compatibility", async () => {
    const fixture = await createPreHardeningFixture(true);
    const malformed = new DatabaseSync(fixture.source);
    malformed.exec(
      "DROP TRIGGER migration_provenance_append_only_update_guard",
    );
    malformed
      .prepare(
        `UPDATE migration_provenance
       SET source_row_hash = zeroblob(64)
       WHERE transform_version = 'm2-v1'
         AND source_table = 'curriculum_versions'
         AND source_primary_key = 'legacy-v1'`,
      )
      .run();
    malformed.close();

    const inventory = inventoryPrivateData({
      databasePaths: [fixture.source],
    });
    const candidate = inventory.candidates[0];
    expect(candidate?.health.opened).toBe(true);
    if (!candidate?.health.opened) {
      throw new Error("Malformed quarantine fixture did not open");
    }
    expect(
      candidate.health.m2.sessionContexts
        .quarantinedActiveSessionSourceHashMismatchRows,
    ).toBe(1);
    expect(
      candidate.health.m2.provenance.quarantinedRevisionSourceHashMismatchRows,
    ).toBe(1);
    expect(() =>
      runM1MigrationCli({
        argv: [],
        projectRoot: fixture.projectRoot,
        writeStatus: () => undefined,
      }),
    ).toThrow(/exact migration contract/u);
  }, 15_000);
});
