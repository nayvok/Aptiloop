import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  assertM1DatabaseMigrationAdmission,
  openM1WritableDatabase,
  sameM1FileIdentity,
  type M1DatabaseMigrationAdmission,
} from "../active-database.js";

import {
  assertApprovedM2MigrationBackupUnchanged,
  assertApprovedM2MigrationRecoveryCopyUnchanged,
  releaseApprovedM2MigrationRecoveryCopy,
  verifyApprovedM2MigrationBackup,
} from "../approved-backup.js";
import {
  applyApprovedM2Migrations,
  getCurrentDatabaseMigrationContract,
  migrateDatabase,
} from "../database.js";
import {
  getM1WritableDatabasePath,
  validateM1WritableDatabasePath,
} from "./path.js";

interface M1MigrationCliTestHooks {
  /** Runs inside the outer transaction immediately before backup revalidation. */
  readonly beforeAuthorizedCommit?: () => void;
}

export interface M1MigrationCliInput {
  readonly argv?: readonly string[];
  readonly projectRoot?: string;
  readonly configuredPath?: string;
  readonly writeStatus?: (status: string) => void;
  /** @internal Deterministic adversarial seam; production callers leave unset. */
  readonly testHooks?: M1MigrationCliTestHooks;
}

interface M2MigrationArguments {
  readonly approvedBackupPath: string;
  readonly expectedBackupSha256: string;
}

export function formatM1MigrationStatus(
  databasePath: string,
  admission: M1DatabaseMigrationAdmission | undefined,
): string {
  if (admission?.kind === "legacy-compatible") {
    return `Legacy compatibility admitted; no migration performed: ${databasePath}`;
  }
  if (admission?.kind === "current") {
    return `Database already current; no migration performed: ${databasePath}`;
  }
  return `Database migrated: ${databasePath}`;
}

export function runM1MigrationCli(input: M1MigrationCliInput = {}): string {
  const projectRoot = path.resolve(
    input.projectRoot ??
      fileURLToPath(new URL("../../../../", import.meta.url)),
  );
  const databasePath = getM1WritableDatabasePath({
    projectRoot,
    ...(input.configuredPath === undefined
      ? {}
      : { configuredPath: input.configuredPath }),
  });
  const arguments_ = parseM2MigrationArguments(
    input.argv ?? process.argv.slice(2),
  );
  const status = arguments_
    ? runAuthorizedCourseFoundationsMigration(
        projectRoot,
        databasePath,
        arguments_,
        input.testHooks,
      )
    : runDefaultMigration(databasePath, projectRoot);
  if (input.writeStatus) input.writeStatus(status);
  else process.stdout.write(`${status}\n`);
  return status;
}

function runDefaultMigration(
  databasePath: string,
  projectRoot: string,
): string {
  const connection = openM1WritableDatabase(databasePath, {
    revalidateTarget: () =>
      validateM1WritableDatabasePath(databasePath, { projectRoot }),
  });
  try {
    migrateDatabase(
      connection,
      undefined,
      connection.migrationAdmission?.kind === "legacy-compatible"
        ? connection.migrationAdmission.migrationCapability
        : undefined,
    );
    return formatM1MigrationStatus(databasePath, connection.migrationAdmission);
  } finally {
    connection.close();
  }
}

function runAuthorizedCourseFoundationsMigration(
  projectRoot: string,
  databasePath: string,
  arguments_: M2MigrationArguments,
  testHooks?: M1MigrationCliTestHooks,
): string {
  const verificationInput = {
    projectRoot,
    sourcePath: databasePath,
    backupPath: arguments_.approvedBackupPath,
    expectedBackupSha256: arguments_.expectedBackupSha256,
  } as const;
  const initial = verifyApprovedM2MigrationBackup(verificationInput);
  if (initial.alreadyMigrated) {
    assertApprovedM2MigrationBackupUnchanged(initial);
    return `Database already current; no migration performed: ${databasePath}`;
  }

  const initialTarget = validateM1WritableDatabasePath(databasePath, {
    projectRoot,
  });
  const connection = openM1WritableDatabase(databasePath, {
    initialTarget,
    revalidateTarget: () =>
      validateM1WritableDatabasePath(databasePath, { projectRoot }),
  });
  try {
    const reverified = verifyApprovedM2MigrationBackup({
      ...verificationInput,
      retainRecoveryCopy: true,
    });
    if (
      reverified.alreadyMigrated ||
      reverified.recoveryCopy === null ||
      !sameM1FileIdentity(initial.sourceIdentity, reverified.sourceIdentity) ||
      !sameM1FileIdentity(initial.backupIdentity, reverified.backupIdentity) ||
      initial.sourceLogicalSha256 !== reverified.sourceLogicalSha256 ||
      initial.backupLogicalSha256 !== reverified.backupLogicalSha256 ||
      connection.migrationAdmission?.kind !== "legacy-compatible" ||
      connection.migrationAdmission.contract.schemaSha256 !==
        reverified.sourceContract.schemaSha256 ||
      connection.migrationAdmission.contract.migrationIds.length !==
        reverified.sourceContract.migrationIds.length ||
      !connection.migrationAdmission.contract.migrationIds.every(
        (id, index) => id === reverified.sourceContract.migrationIds[index],
      )
    ) {
      throw new Error(
        "M2 migration source or approved backup changed before the authorized write",
      );
    }
    applyApprovedM2Migrations(
      connection,
      {
        kind: "approved-backup-m2",
        sourceContract: reverified.sourceContract,
        sourceLogicalSha256: reverified.sourceLogicalSha256,
        targetContract: getCurrentDatabaseMigrationContract(),
        approvedBackupLogicalSha256: reverified.backupLogicalSha256,
        approvedBackupSha256: reverified.backupFileSha256,
        approvedBackupPathHash: reverified.backupPathSha256,
      },
      {
        assertBackupUnchangedBeforeCommit: () => {
          testHooks?.beforeAuthorizedCommit?.();
          assertApprovedM2MigrationRecoveryCopyUnchanged(reverified);
          assertApprovedM2MigrationBackupUnchanged(reverified);
        },
      },
    );
    assertApprovedM2MigrationBackupUnchanged(reverified);
    assertApprovedM2MigrationRecoveryCopyUnchanged(reverified);
    releaseApprovedM2MigrationRecoveryCopy(reverified);
  } finally {
    connection.close();
  }

  const completed = verifyApprovedM2MigrationBackup(verificationInput);
  if (!completed.alreadyMigrated) {
    throw new Error(
      "Authorized migration did not reach its exact current contract",
    );
  }
  const completedTarget = validateM1WritableDatabasePath(databasePath, {
    projectRoot,
  });
  const admission = assertM1DatabaseMigrationAdmission(
    databasePath,
    completedTarget,
  );
  const targetContract = getCurrentDatabaseMigrationContract();
  if (
    admission.kind !== "current" ||
    admission.contract.schemaSha256 !== targetContract.schemaSha256 ||
    admission.contract.migrationIds.length !==
      targetContract.migrationIds.length ||
    !admission.contract.migrationIds.every(
      (id, index) => id === targetContract.migrationIds[index],
    )
  ) {
    throw new Error("Post-migration active database was not exactly admitted");
  }
  assertApprovedM2MigrationBackupUnchanged(completed);
  return `Database migrated with verified recovery backup: ${databasePath}`;
}

function parseM2MigrationArguments(
  argv: readonly string[],
): M2MigrationArguments | null {
  if (argv.length === 0) return null;
  let authorized = false;
  let approvedBackupPath: string | undefined;
  let expectedBackupSha256: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--authorize-current" || argument === "--authorize-m2") {
      if (authorized)
        throw new Error("Migration authorization may be supplied only once");
      authorized = true;
      continue;
    }
    if (argument === "--approved-backup" || argument === "--backup-sha256") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${argument} requires one explicit value`);
      }
      if (argument === "--approved-backup") {
        if (approvedBackupPath !== undefined) {
          throw new Error("--approved-backup may be supplied only once");
        }
        approvedBackupPath = value;
      } else {
        if (expectedBackupSha256 !== undefined) {
          throw new Error("--backup-sha256 may be supplied only once");
        }
        expectedBackupSha256 = value;
      }
      index += 1;
      continue;
    }
    throw new Error(`Unknown migration option: ${argument}`);
  }
  if (!authorized || !approvedBackupPath || !expectedBackupSha256) {
    throw new Error(
      "Explicit migration requires --authorize-current, --approved-backup, and --backup-sha256",
    );
  }
  return { approvedBackupPath, expectedBackupSha256 };
}

const invokedPath = process.argv[1];
if (
  invokedPath !== undefined &&
  path.resolve(invokedPath) === path.resolve(fileURLToPath(import.meta.url))
) {
  runM1MigrationCli();
}
