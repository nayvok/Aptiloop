import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  adaptationBranchLifecycleMigrationContract,
  assertM1DatabaseMigrationAdmission,
  createApprovedM1Backup,
  getCurrentDatabaseMigrationContract,
  migrateDatabase,
  openDatabase,
} from "../src/index.js";
import { runM1MigrationCli } from "../src/cli/migrate.js";
import { validateM1WritableDatabasePath } from "../src/cli/path.js";
import { verifyApprovedM2MigrationBackup } from "../src/approved-backup.js";

const roots: string[] = [];
const migrationsSource = fileURLToPath(
  new URL("../migrations", import.meta.url),
);

afterEach(() => {
  while (roots.length > 0) {
    rmSync(roots.pop()!, { recursive: true, force: true });
  }
});

function temporaryRoot(prefix: string): string {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  roots.push(root);
  mkdirSync(path.join(root, ".data", "approved-backups"), {
    recursive: true,
  });
  return root;
}

function fileSha256(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

async function preFactSchemaFixture(): Promise<{
  projectRoot: string;
  databasePath: string;
  backupPath: string;
  backupSha256: string;
}> {
  const projectRoot = temporaryRoot("aptiloop-pre-fact-schema-");
  const migrationDirectory = path.join(projectRoot, "migrations-through-0020");
  mkdirSync(migrationDirectory);
  for (const filename of readdirSync(migrationsSource).filter((entry) =>
    /^(?:000\d|001\d|0020)_.*\.sql$/u.test(entry),
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
  } finally {
    connection.close();
  }
  const backupPath = path.join(
    projectRoot,
    ".data",
    "approved-backups",
    "approved-pre-fact-schema.sqlite",
  );
  await createApprovedM1Backup({
    projectRoot,
    sourcePath: databasePath,
    destinationPath: backupPath,
  });
  return {
    projectRoot,
    databasePath,
    backupPath,
    backupSha256: fileSha256(backupPath),
  };
}

function authorizedArguments(fixture: {
  backupPath: string;
  backupSha256: string;
}): string[] {
  return [
    "--authorize-current",
    "--approved-backup",
    fixture.backupPath,
    "--backup-sha256",
    fixture.backupSha256,
  ];
}

describe("pre-fact-schema migration authorization", () => {
  it("admits the exact 0000-0020 predecessor and advances it to the current contract", async () => {
    const fixture = await preFactSchemaFixture();
    const target = validateM1WritableDatabasePath(fixture.databasePath, {
      projectRoot: fixture.projectRoot,
    });
    const admission = assertM1DatabaseMigrationAdmission(
      fixture.databasePath,
      target,
    );
    expect(admission.kind).toBe("legacy-compatible");
    if (admission.kind !== "legacy-compatible") {
      throw new Error("Expected legacy-compatible admission");
    }
    expect(admission.contract.schemaSha256).toBe(
      adaptationBranchLifecycleMigrationContract.schemaSha256,
    );
    expect(admission.contract.migrationIds.at(-1)).toBe(
      "0020_adaptation_branch_lifecycle",
    );

    // Confirm the authorized-migration preflight accepts the exact 0000-0020
    // predecessor and its approved backup before the real migration (throws on
    // any mismatch, so no migration can be launched on an unverified cutover).
    verifyApprovedM2MigrationBackup({
      projectRoot: fixture.projectRoot,
      sourcePath: fixture.databasePath,
      backupPath: fixture.backupPath,
      expectedBackupSha256: fixture.backupSha256,
    });

    const status = runM1MigrationCli({
      argv: authorizedArguments(fixture),
      projectRoot: fixture.projectRoot,
      writeStatus: () => undefined,
    });
    expect(status).toContain("Database migrated with verified recovery backup");

    const current = getCurrentDatabaseMigrationContract();
    const reopened = openDatabase(fixture.databasePath);
    try {
      const lastId = reopened.sqlite
        .prepare("SELECT id FROM __dlh_migrations ORDER BY id DESC LIMIT 1")
        .get() as { id?: unknown };
      expect(lastId?.id).toBe(current.migrationIds.at(-1));
      const reopenedTarget = validateM1WritableDatabasePath(
        fixture.databasePath,
        { projectRoot: fixture.projectRoot },
      );
      expect(
        assertM1DatabaseMigrationAdmission(fixture.databasePath, reopenedTarget)
          .kind,
      ).toBe("current");
    } finally {
      reopened.close();
    }

    const rerunStatus = runM1MigrationCli({
      argv: authorizedArguments(fixture),
      projectRoot: fixture.projectRoot,
      writeStatus: () => undefined,
    });
    expect(rerunStatus).toContain(
      "Database already current; no migration performed",
    );
  });
});
