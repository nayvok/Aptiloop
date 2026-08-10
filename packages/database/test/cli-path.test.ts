import {
  copyFileSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, type TestContext } from "vitest";

import { openM1WritableDatabase } from "../src/active-database.js";
import { migrateDatabase, openDatabase } from "../src/database.js";
import { databaseLogicalSha256 } from "../src/private-data-inventory.js";
import { formatM1MigrationStatus } from "../src/cli/migrate.js";
import { seedDatabase } from "../src/seed.js";
import {
  getDatabasePath,
  getM1WritableDatabasePath,
  validateM1WritableDatabasePath,
} from "../src/cli/path.js";

const roots: string[] = [];
const migrationsSource = fileURLToPath(
  new URL("../migrations", import.meta.url),
);

function temporaryRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

function databaseFamilyBytes(databasePath: string): Array<Buffer | null> {
  return ["", "-wal", "-shm", "-journal"].map((suffix) => {
    const candidate = `${databasePath}${suffix}`;
    return existsSync(candidate) ? readFileSync(candidate) : null;
  });
}

function createLegacyCompatibleDatabase(projectRoot: string): string {
  const dataDirectory = join(projectRoot, ".data");
  const databasePath = join(dataDirectory, "dev-learning-harness.sqlite");
  mkdirSync(dataDirectory);
  const migrationDirectory = join(projectRoot, "migrations-through-0005");
  mkdirSync(migrationDirectory);
  for (const filename of readdirSync(migrationsSource).filter((entry) =>
    /^000[0-5]_.*\.sql$/u.test(entry),
  )) {
    copyFileSync(
      join(migrationsSource, filename),
      join(migrationDirectory, filename),
    );
  }
  const connection = openDatabase(databasePath);
  try {
    migrateDatabase(connection, migrationDirectory);
    seedDatabase(connection, undefined, 1_000);
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
      INSERT INTO curricula
        (id, slug, title, description, active_version_id, created_at, updated_at)
      VALUES
        ('legacy-curriculum', 'legacy-curriculum', 'Legacy curriculum', NULL,
         'legacy-v1', 1, 1);
      INSERT INTO curriculum_versions
        (id, curriculum_id, revision, parent_version_id, status, title,
         description, content_hash, created_at, published_at, archived_at,
         updated_at)
      VALUES
        ('legacy-v1', 'legacy-curriculum', 1, NULL, 'draft',
         'Legacy version', NULL, 'legacy-v1', 1, NULL, NULL, 1);
      INSERT INTO curriculum_weeks
        (id, version_id, stable_id, order_index, title, description,
         created_at, updated_at)
      VALUES
        ('legacy-week-v2', 'legacy-v1', 'legacy-week', 0, 'Legacy week',
         NULL, 1, 1);
      INSERT INTO curriculum_days_v2
        (id, version_id, week_id, stable_id, order_index, title, description,
         goal, estimated_minutes, prerequisites_json, expected_outcomes_json,
         depth_level, out_of_scope_json, topics_json, created_at, updated_at)
      VALUES
        ('legacy-day-v2', 'legacy-v1', 'legacy-week-v2', 'legacy-day', 0,
         'Legacy day', NULL, 'Legacy goal', 30, '[]', '[]', 'foundation',
         '[]', '[]', 1, 1);
      UPDATE curriculum_versions
      SET status = 'published', published_at = 1
      WHERE id = 'legacy-v1';
    `);
    const days = connection.sqlite
      .prepare("SELECT id FROM curriculum_days ORDER BY id LIMIT 2")
      .all() as Array<{ id?: unknown }>;
    const nonLegacy = connection.sqlite
      .prepare(
        `SELECT versions.id AS version_id,
                versions.curriculum_id AS curriculum_id,
                days.id AS day_id
         FROM curriculum_versions AS versions
         JOIN curriculum_days_v2 AS days ON days.version_id = versions.id
         WHERE versions.id != 'legacy-v1'
         ORDER BY versions.id, days.id
         LIMIT 1`,
      )
      .get() as
      | { version_id?: unknown; curriculum_id?: unknown; day_id?: unknown }
      | undefined;
    if (
      typeof days[0]?.id !== "string" ||
      typeof days[1]?.id !== "string" ||
      typeof nonLegacy?.version_id !== "string" ||
      typeof nonLegacy.curriculum_id !== "string" ||
      typeof nonLegacy.day_id !== "string"
    ) {
      throw new Error("Legacy fixture requires seeded legacy and v2 days");
    }
    const insertSession = connection.sqlite.prepare(
      `INSERT INTO learning_sessions
       (id, day_id, status, current_step, started_at, updated_at,
        curriculum_day_v2_id)
       VALUES (?, ?, 'active', 'practice', 1, 1, ?)`,
    );
    insertSession.run("legacy-active", days[0].id, "legacy-day-v2");
    insertSession.run("v2-active", days[1].id, nonLegacy.day_id);
    const insertSnapshot = connection.sqlite.prepare(
      `INSERT INTO session_snapshots
       (id, session_id, schema_version, curriculum_id, curriculum_version_id,
        curriculum_day_id, content_hash, snapshot_json, created_at)
       VALUES (?, ?, 2, ?, ?, ?, ?, '{}', 1)`,
    );
    insertSnapshot.run(
      "legacy-snapshot",
      "legacy-active",
      "legacy-curriculum",
      "legacy-v1",
      "legacy-day-v2",
      "legacy-content",
    );
    insertSnapshot.run(
      "v2-snapshot",
      "v2-active",
      nonLegacy.curriculum_id,
      nonLegacy.version_id,
      nonLegacy.day_id,
      "v2-content",
    );
    connection.sqlite
      .prepare(
        `INSERT INTO learner_state
         (id, current_learning_session_id, updated_at)
         VALUES ('default', 'v2-active', 1)
         ON CONFLICT(id) DO UPDATE SET
           current_learning_session_id = excluded.current_learning_session_id,
           updated_at = excluded.updated_at`,
      )
      .run();
  } finally {
    connection.close();
  }
  const standalone = new DatabaseSync(databasePath);
  standalone.exec("PRAGMA journal_mode = DELETE");
  standalone.close();
  return databasePath;
}

describe("migration CLI status", () => {
  const databasePath = "/trusted/.data/dev-learning-harness.sqlite";

  it("does not call legacy compatibility a migration", () => {
    expect(
      formatM1MigrationStatus(databasePath, {
        kind: "legacy-compatible",
        contract: {
          migrationIds: [],
          schemaSha256: "schema",
        },
        logicalSha256: "logical",
        migrationCapability: {
          kind: "legacy-compatible-noop",
          contract: { migrationIds: [], schemaSha256: "schema" },
          logicalSha256: "logical",
        },
      }),
    ).toBe(
      `Legacy compatibility admitted; no migration performed: ${databasePath}`,
    );
  });

  it("distinguishes an already-current database from a fresh migration", () => {
    expect(
      formatM1MigrationStatus(databasePath, {
        kind: "current",
        contract: {
          migrationIds: [],
          schemaSha256: "schema",
        },
        logicalSha256: "logical",
      }),
    ).toBe(`Database already current; no migration performed: ${databasePath}`);
    expect(
      formatM1MigrationStatus(databasePath, {
        kind: "bootstrap-empty",
      }),
    ).toBe(`Database migrated: ${databasePath}`);
  });
});

function compatibilityRows(sqlite: DatabaseSync): Record<string, unknown> {
  return {
    legacy: sqlite
      .prepare("SELECT id, title FROM curriculum_days ORDER BY id")
      .all(),
    versioned: sqlite
      .prepare(
        "SELECT id, revision, title FROM curriculum_versions ORDER BY id",
      )
      .all(),
    activeSessions: sqlite
      .prepare(
        "SELECT id, day_id, status FROM learning_sessions WHERE status = 'active' ORDER BY id",
      )
      .all(),
  };
}

function mutateStandaloneDatabase(databasePath: string, sql: string): void {
  const sqlite = new DatabaseSync(databasePath);
  try {
    sqlite.exec(sql);
  } finally {
    sqlite.close();
  }
}

function tryCreateLink(
  context: TestContext,
  target: string,
  linkPath: string,
  type: "file" | "directory",
): boolean {
  try {
    symlinkSync(
      target,
      linkPath,
      type === "directory"
        ? process.platform === "win32"
          ? "junction"
          : "dir"
        : "file",
    );
    return true;
  } catch (error) {
    const code =
      error instanceof Error && "code" in error
        ? (error as NodeJS.ErrnoException).code
        : undefined;
    if (
      ["EACCES", "EINVAL", "ENOSYS", "ENOTSUP", "EPERM"].includes(code ?? "")
    ) {
      return context.skip(
        "Filesystem links are not supported on this platform",
      );
    }
    throw error;
  }
}

function tryCreateHardLink(
  context: TestContext,
  target: string,
  linkPath: string,
): boolean {
  try {
    linkSync(target, linkPath);
    return true;
  } catch (error) {
    const code =
      error instanceof Error && "code" in error
        ? (error as NodeJS.ErrnoException).code
        : undefined;
    if (
      ["EACCES", "EINVAL", "ENOSYS", "ENOTSUP", "EPERM"].includes(code ?? "")
    ) {
      return context.skip(
        "Filesystem hard links are not supported on this platform",
      );
    }
    throw error;
  }
}

afterEach(() => {
  while (roots.length) {
    const root = roots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

describe("database CLI path", () => {
  it("resolves the default database from the project root, not workspace cwd", () => {
    const projectRoot = temporaryRoot("aptiloop-cli-root-");
    expect(getDatabasePath({ projectRoot })).toBe(
      resolve(projectRoot, ".data/dev-learning-harness.sqlite"),
    );
  });

  it("keeps explicit absolute, file and in-memory database paths", () => {
    const projectRoot = temporaryRoot("aptiloop-cli-explicit-");
    const absolute = resolve(projectRoot, "fixtures/user.sqlite");
    expect(getDatabasePath({ configuredPath: absolute, projectRoot })).toBe(
      absolute,
    );
    expect(
      getDatabasePath({ configuredPath: `file:${absolute}`, projectRoot }),
    ).toBe(absolute);
    expect(getDatabasePath({ configuredPath: ":memory:", projectRoot })).toBe(
      ":memory:",
    );
  });

  it("rejects every writable CLI target except the active database", () => {
    const projectRoot = temporaryRoot("aptiloop-cli-active-");
    expect(getM1WritableDatabasePath({ projectRoot })).toBe(
      resolve(projectRoot, ".data/dev-learning-harness.sqlite"),
    );
    expect(() =>
      getM1WritableDatabasePath({
        configuredPath: resolve(
          projectRoot,
          "data/dev-learning-harness.sqlite",
        ),
        projectRoot,
      }),
    ).toThrow("may write only .data/dev-learning-harness.sqlite");
    expect(() =>
      getM1WritableDatabasePath({ configuredPath: ":memory:", projectRoot }),
    ).toThrow("may write only the active database");
  });

  it("rejects a linked active file before changing its external target", (context) => {
    const projectRoot = temporaryRoot("aptiloop-cli-linked-file-");
    const externalRoot = temporaryRoot("aptiloop-cli-external-file-");
    const dataDirectory = join(projectRoot, ".data");
    const activePath = join(dataDirectory, "dev-learning-harness.sqlite");
    const externalPath = join(externalRoot, "external.sqlite");
    const original = Buffer.from("external database", "utf8");
    mkdirSync(dataDirectory);
    writeFileSync(externalPath, original, { flag: "wx" });
    if (!tryCreateLink(context, externalPath, activePath, "file")) return;

    expect(() => getM1WritableDatabasePath({ projectRoot })).toThrow(
      /symbolic link|reparse point/u,
    );
    expect(readFileSync(externalPath)).toEqual(original);
  });

  it("rejects a hardlinked active database before writable open", (context) => {
    const projectRoot = temporaryRoot("aptiloop-cli-hardlink-file-");
    const aliasRoot = temporaryRoot("aptiloop-cli-hardlink-alias-");
    const activePath = resolve(
      projectRoot,
      ".data/dev-learning-harness.sqlite",
    );
    const connection = openDatabase(activePath);
    try {
      migrateDatabase(connection);
    } finally {
      connection.close();
    }
    const aliasPath = join(aliasRoot, "active-alias.sqlite");
    if (!tryCreateHardLink(context, activePath, aliasPath)) return;
    const before = readFileSync(aliasPath);

    expect(() => getM1WritableDatabasePath({ projectRoot })).toThrow(
      /hard-link aliases/u,
    );
    expect(readFileSync(aliasPath)).toEqual(before);
  }, 30_000);

  it("rejects a linked data ancestor before changing an external target", (context) => {
    const projectRoot = temporaryRoot("aptiloop-cli-linked-data-");
    const externalData = temporaryRoot("aptiloop-cli-external-data-");
    const externalPath = join(externalData, "dev-learning-harness.sqlite");
    const original = Buffer.from("external database", "utf8");
    writeFileSync(externalPath, original, { flag: "wx" });
    if (
      !tryCreateLink(
        context,
        externalData,
        join(projectRoot, ".data"),
        "directory",
      )
    ) {
      return;
    }

    expect(() => getM1WritableDatabasePath({ projectRoot })).toThrow(
      /symbolic link|junction|reparse point/u,
    );
    expect(readFileSync(externalPath)).toEqual(original);
  });

  it("admits only the named legacy contract and leaves legacy and v2 rows unchanged", () => {
    const projectRoot = temporaryRoot("aptiloop-cli-legacy-compatible-");
    const databasePath = createLegacyCompatibleDatabase(projectRoot);
    const beforeReader = new DatabaseSync(databasePath, { readOnly: true });
    const beforeLogical = databaseLogicalSha256(beforeReader);
    const beforeRows = compatibilityRows(beforeReader);
    beforeReader.close();

    const connection = openM1WritableDatabase(databasePath, {
      revalidateTarget: () =>
        validateM1WritableDatabasePath(databasePath, { projectRoot }),
    });
    try {
      expect(connection.migrationAdmission?.kind).toBe("legacy-compatible");
      expect(() => migrateDatabase(connection)).toThrow(
        /current migration ledger and schema/u,
      );
      if (connection.migrationAdmission?.kind !== "legacy-compatible") {
        throw new Error("Named legacy admission capability is missing");
      }
      migrateDatabase(
        connection,
        undefined,
        connection.migrationAdmission.migrationCapability,
      );
      expect(databaseLogicalSha256(connection.sqlite)).toBe(beforeLogical);
      expect(compatibilityRows(connection.sqlite)).toEqual(beforeRows);
    } finally {
      connection.close();
    }
  });

  for (const nearMiss of [
    {
      name: "an extra ledger entry",
      sql: `INSERT INTO __dlh_migrations (id, applied_at)
            VALUES ('9999_unapproved', 1)`,
    },
    {
      name: "a missing ledger entry",
      sql: `DELETE FROM __dlh_migrations
            WHERE id = '0005_test_run_diff_fingerprint'`,
    },
    {
      name: "an extra schema object",
      sql: "CREATE TABLE unapproved_extra (value TEXT NOT NULL)",
    },
    {
      name: "a missing schema object",
      sql: "DROP INDEX questions_day_idx",
    },
  ]) {
    it(`rejects legacy compatibility with ${nearMiss.name} before writable PRAGMAs`, () => {
      const projectRoot = temporaryRoot("aptiloop-cli-legacy-near-miss-");
      const databasePath = createLegacyCompatibleDatabase(projectRoot);
      mutateStandaloneDatabase(databasePath, nearMiss.sql);
      const before = databaseFamilyBytes(databasePath);

      expect(() =>
        openM1WritableDatabase(databasePath, {
          revalidateTarget: () =>
            validateM1WritableDatabasePath(databasePath, { projectRoot }),
        }),
      ).toThrow(/exact migration contract/u);

      expect(databaseFamilyBytes(databasePath)).toEqual(before);
      expect(existsSync(`${databasePath}-wal`)).toBe(false);
      expect(existsSync(`${databasePath}-shm`)).toBe(false);
    }, 30_000);
  }
  for (const dataNearMiss of [
    {
      name: "two nonlegacy active snapshots",
      sql: `UPDATE session_snapshots
            SET curriculum_id = (
                  SELECT curriculum_id FROM curriculum_versions
                  WHERE id != 'legacy-v1' ORDER BY id LIMIT 1
                ),
                curriculum_version_id = (
                  SELECT id FROM curriculum_versions
                  WHERE id != 'legacy-v1' ORDER BY id LIMIT 1
                ),
                curriculum_day_id = (
                  SELECT days.id
                  FROM curriculum_days_v2 AS days
                  WHERE days.version_id = (
                    SELECT id FROM curriculum_versions
                    WHERE id != 'legacy-v1' ORDER BY id LIMIT 1
                  )
                  ORDER BY days.id LIMIT 1
                )
            WHERE session_id = 'legacy-active';
            UPDATE learning_sessions
            SET curriculum_day_v2_id = (
              SELECT curriculum_day_id FROM session_snapshots
              WHERE session_id = 'legacy-active'
            )
            WHERE id = 'legacy-active'`,
    },
    {
      name: "a learner pointer that does not select the nonlegacy active row",
      sql: `UPDATE learner_state
            SET current_learning_session_id = 'legacy-active'
            WHERE id = 'default'`,
    },
    {
      name: "a null versioned day on the current-version active row",
      sql: `UPDATE learning_sessions
            SET curriculum_day_v2_id = NULL
            WHERE id = 'v2-active'`,
    },
    {
      name: "a session day that differs from its versioned snapshot day",
      sql: `UPDATE learning_sessions
            SET curriculum_day_v2_id = (
              SELECT id FROM curriculum_days_v2
              WHERE id != (
                SELECT curriculum_day_id FROM session_snapshots
                WHERE session_id = 'v2-active'
              )
              ORDER BY id LIMIT 1
            )
            WHERE id = 'v2-active'`,
    },
    {
      name: "a schema-version-one current-version snapshot",
      sql: `UPDATE session_snapshots
            SET schema_version = 1
            WHERE session_id = 'v2-active'`,
    },
  ]) {
    it(`rejects legacy compatibility with ${dataNearMiss.name} before writable PRAGMAs`, () => {
      const projectRoot = temporaryRoot("aptiloop-cli-legacy-data-near-miss-");
      const databasePath = createLegacyCompatibleDatabase(projectRoot);
      mutateStandaloneDatabase(databasePath, dataNearMiss.sql);
      const before = databaseFamilyBytes(databasePath);

      expect(() =>
        openM1WritableDatabase(databasePath, {
          revalidateTarget: () =>
            validateM1WritableDatabasePath(databasePath, { projectRoot }),
        }),
      ).toThrow(/exact migration contract/u);

      expect(databaseFamilyBytes(databasePath)).toEqual(before);
      expect(existsSync(`${databasePath}-wal`)).toBe(false);
      expect(existsSync(`${databasePath}-shm`)).toBe(false);
    }, 30_000);
  }

  it("rechecks admitted legacy data before writable PRAGMAs", () => {
    const projectRoot = temporaryRoot("aptiloop-cli-legacy-data-recheck-");
    const databasePath = createLegacyCompatibleDatabase(projectRoot);
    let changedBytes: Array<Buffer | null> | undefined;

    expect(() =>
      openM1WritableDatabase(databasePath, {
        revalidateTarget: () =>
          validateM1WritableDatabasePath(databasePath, { projectRoot }),
        testHooks: {
          beforeOpen: () => {
            mutateStandaloneDatabase(
              databasePath,
              `UPDATE learner_state
               SET current_learning_session_id = 'legacy-active'
               WHERE id = 'default'`,
            );
            changedBytes = databaseFamilyBytes(databasePath);
          },
        },
      }),
    ).toThrow(
      "Opened writable database no longer matches its admitted exact contract",
    );

    expect(changedBytes).toBeDefined();
    expect(databaseFamilyBytes(databasePath)).toEqual(changedBytes);
    expect(existsSync(`${databasePath}-wal`)).toBe(false);
    expect(existsSync(`${databasePath}-shm`)).toBe(false);
  });

  it("rejects a stale exact-path database before a CLI writable open", () => {
    const projectRoot = temporaryRoot("aptiloop-cli-stale-");
    const dataDirectory = join(projectRoot, ".data");
    const databasePath = join(dataDirectory, "dev-learning-harness.sqlite");
    mkdirSync(dataDirectory);
    const stale = new DatabaseSync(databasePath);
    stale.exec(`
      CREATE TABLE __dlh_migrations (
        id TEXT PRIMARY KEY NOT NULL,
        applied_at INTEGER NOT NULL
      );
      INSERT INTO __dlh_migrations (id, applied_at) VALUES ('0000_initial', 1);
      CREATE TABLE stale_payload (value TEXT NOT NULL);
      INSERT INTO stale_payload (value) VALUES ('must remain unchanged');
    `);
    stale.close();
    const before = databaseFamilyBytes(databasePath);

    expect(() =>
      openM1WritableDatabase(databasePath, {
        revalidateTarget: () =>
          validateM1WritableDatabasePath(databasePath, { projectRoot }),
      }),
    ).toThrow(/exact migration contract/u);

    expect(databaseFamilyBytes(databasePath)).toEqual(before);
  });

  it("rechecks an admitted current inode before writable SQLite pragmas", () => {
    const projectRoot = temporaryRoot("aptiloop-cli-same-inode-");
    const dataDirectory = join(projectRoot, ".data");
    const databasePath = join(dataDirectory, "dev-learning-harness.sqlite");
    mkdirSync(dataDirectory);
    const bootstrap = openDatabase(databasePath);
    migrateDatabase(bootstrap);
    bootstrap.close();
    const standalone = new DatabaseSync(databasePath);
    standalone.exec("PRAGMA journal_mode = DELETE");
    standalone.close();
    const admittedIdentity = lstatSync(databasePath, { bigint: true });
    let staleBytes: Array<Buffer | null> | undefined;

    expect(() =>
      openM1WritableDatabase(databasePath, {
        revalidateTarget: () =>
          validateM1WritableDatabasePath(databasePath, { projectRoot }),
        testHooks: {
          beforeOpen: () => {
            const stale = new DatabaseSync(databasePath);
            stale
              .prepare("DELETE FROM __dlh_migrations WHERE id = ?")
              .run("0005_test_run_diff_fingerprint");
            stale.close();
            const changedIdentity = lstatSync(databasePath, { bigint: true });
            expect(changedIdentity.dev).toBe(admittedIdentity.dev);
            expect(changedIdentity.ino).toBe(admittedIdentity.ino);
            staleBytes = databaseFamilyBytes(databasePath);
          },
        },
      }),
    ).toThrow("no longer matches its admitted exact contract");

    expect(staleBytes).toBeDefined();
    expect(databaseFamilyBytes(databasePath)).toEqual(staleBytes);
    expect(existsSync(`${databasePath}-wal`)).toBe(false);
    expect(existsSync(`${databasePath}-shm`)).toBe(false);
  });

  it("revalidates a reserved target before writable SQLite pragmas", (context) => {
    const projectRoot = temporaryRoot("aptiloop-cli-open-swap-");
    const externalData = temporaryRoot("aptiloop-cli-open-external-");
    const dataDirectory = join(projectRoot, ".data");
    const displacedData = join(projectRoot, ".data-displaced");
    const externalPath = join(externalData, "dev-learning-harness.sqlite");
    const external = new DatabaseSync(externalPath);
    external.exec("CREATE TABLE external_sentinel (value TEXT NOT NULL)");
    external.close();
    const before = readFileSync(externalPath);
    const databasePath = getM1WritableDatabasePath({ projectRoot });

    const probeLink = join(projectRoot, "junction-probe");
    if (!tryCreateLink(context, externalData, probeLink, "directory")) return;
    rmSync(probeLink, { force: true });

    expect(() =>
      openM1WritableDatabase(databasePath, {
        revalidateTarget: () =>
          validateM1WritableDatabasePath(databasePath, { projectRoot }),
        testHooks: {
          beforeOpen: () => {
            renameSync(dataDirectory, displacedData);
            symlinkSync(
              externalData,
              dataDirectory,
              process.platform === "win32" ? "junction" : "dir",
            );
          },
        },
      }),
    ).toThrow(/symbolic link|junction|reparse point/u);

    expect(readFileSync(externalPath)).toEqual(before);
    expect(existsSync(`${externalPath}-wal`)).toBe(false);
    expect(existsSync(`${externalPath}-shm`)).toBe(false);
  });
});
