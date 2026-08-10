import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  ftruncateSync,
  fsyncSync,
  linkSync,
  lstatSync,
  openSync,
  readSync,
  writeSync,
  type BigIntStats,
} from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

import {
  assertM1DatabaseMigrationAdmission,
  assertM1DatabaseJournalAbsent,
  assertM1DatabaseSidecars,
  assertM1TrustedPath,
  assertM1WritableDatabaseTarget,
  ensureM1TrustedDirectory,
  getM1LegacyCompatibleMigrationContract,
  getM2BaseMigrationContract,
  getM2MigrationContract,
  getM3MigrationContract,
  getM2PreCorrectionMigrationContract,
  getM2PreHardeningMigrationContract,
  getM2PostHardeningMigrationContract,
  sameM1FileIdentity,
  type M1FileIdentity,
} from "./active-database.js";
import {
  assertOwnedDatabaseArtifact,
  createExclusiveDatabaseBackup,
  removeOwnedDatabaseArtifact,
  type DatabaseBackupCheckpoint,
  type DatabaseBackupResult,
  type OwnedDatabaseArtifact,
} from "./backup.js";
import {
  executionFabricMigrationContract,
  getCurrentDatabaseMigrationContract,
  openDatabase,
  learningKernelMigrationContract,
  type CurrentDatabaseMigrationContract,
} from "./database.js";
import {
  inventoryPrivateData,
  type DatabaseInventoryHealth,
  type LogicalAgentMessageCounts,
  type LogicalReviewCounts,
  type LogicalSessionSnapshotInventory,
  type M2FoundationInventory,
  type MigrationLedgerInventory,
  type PrivateDataInventoryCandidate,
} from "./private-data-inventory.js";

export interface ApprovedM1BackupTestHooks {
  /** Runs immediately before SQLite copy; tests may introduce a sidecar race. */
  readonly beforeCopy?: (temporaryPath: string) => void;
  /** Runs after SQLite closes staging and after journal identity capture. */
  readonly beforeSidecarCleanup?: (stagedDatabasePath: string) => void;
  /** Runs after SQLite finishes the copy and before source revalidation. */
  readonly afterCopy?: () => void;
  /** Runs after every content check and immediately before no-overwrite promotion. */
  readonly beforePromotion?: () => void;
  /** Runs after the destination hard link exists and before ownership validation. */
  readonly afterPromotionLink?: (
    temporaryPath: string,
    destinationPath: string,
  ) => void;
}

export interface ApprovedM1BackupInput {
  projectRoot: string;
  sourcePath: string;
  destinationPath: string;
  /** @internal Deterministic adversarial seam; production callers leave unset. */
  testHooks?: ApprovedM1BackupTestHooks;
}
export interface ApprovedM2MigrationBackupTestHooks {
  /** Runs after the exact-byte restore rehearsal is copied but before inspection. */
  readonly afterRestoreCopy?: (restoredPath: string) => void;
  /** Runs after verification so tests can exercise identity/content races. */
  readonly beforeReturn?: (sourcePath: string, backupPath: string) => void;
}

export interface ApprovedM2MigrationBackupInput {
  readonly projectRoot: string;
  readonly sourcePath: string;
  readonly backupPath: string;
  readonly expectedBackupSha256: string;
  /** @internal Retains the verified app-owned recovery copy for migration. */
  readonly retainRecoveryCopy?: boolean;
  /** @internal Deterministic adversarial seam; production callers leave unset. */
  readonly testHooks?: ApprovedM2MigrationBackupTestHooks;
}

export interface ApprovedM2MigrationBackupVerification {
  readonly projectRoot: string;
  readonly sourcePath: string;
  readonly backupPath: string;
  readonly sourceIdentity: M1FileIdentity;
  readonly backupIdentity: M1FileIdentity;
  readonly sourceLogicalSha256: string;
  readonly backupLogicalSha256: string;
  readonly backupFileSha256: string;
  readonly backupPathSha256: string;
  readonly sourceContract: CurrentDatabaseMigrationContract;
  readonly recoveryCopy: OwnedDatabaseArtifact | null;
  readonly alreadyMigrated: boolean;
  readonly contract: CurrentDatabaseMigrationContract;
  readonly migrations: MigrationLedgerInventory;
  readonly agentMessages: LogicalAgentMessageCounts;
  readonly reviews: LogicalReviewCounts;
  readonly sessionSnapshots: LogicalSessionSnapshotInventory;
  readonly m2: M2FoundationInventory;
  readonly sourceM2: M2FoundationInventory;
}

export async function createApprovedM1Backup(
  input: ApprovedM1BackupInput,
): Promise<DatabaseBackupResult> {
  const projectRoot = path.resolve(input.projectRoot);
  const activeDatabase = path.resolve(
    projectRoot,
    ".data",
    "dev-learning-harness.sqlite",
  );
  const approvedBackupDirectory = path.resolve(
    projectRoot,
    ".data",
    "approved-backups",
  );
  const source = path.resolve(projectRoot, input.sourcePath);
  if (!samePath(source, activeDatabase)) {
    throw new Error(
      "Only .data/dev-learning-harness.sqlite is approved as the M1 backup source",
    );
  }

  const sourceBefore = assertM1WritableDatabaseTarget(source, {
    projectRoot,
    mustExist: true,
  });
  if (!sourceBefore?.identity) {
    throw new Error("The active database identity could not be established");
  }
  const sourceIdentity = sourceBefore.identity;
  const sourceAdmission = assertM1DatabaseMigrationAdmission(
    source,
    sourceBefore,
  );
  if (sourceAdmission.kind === "bootstrap-empty") {
    throw new Error("An empty active database cannot be approved for backup");
  }

  ensureM1TrustedDirectory({
    trustedRoot: projectRoot,
    directoryPath: approvedBackupDirectory,
    label: "Approved backup directory",
  });

  const destination = path.resolve(projectRoot, input.destinationPath);
  if (
    !samePath(path.dirname(destination), approvedBackupDirectory) ||
    path.extname(destination).toLowerCase() !== ".sqlite"
  ) {
    throw new Error(
      "Approved backup destination must be a .sqlite file directly under .data/approved-backups",
    );
  }
  assertDestinationMissing(projectRoot, approvedBackupDirectory, destination);

  const sourceInventoryBefore = inventoryPrivateData({
    databasePaths: [source],
  });
  const sourceCandidateBefore = sourceInventoryBefore.candidates[0];
  assertApprovedCandidate(
    sourceInventoryBefore.candidateCount,
    sourceCandidateBefore,
    "Active database",
    false,
    sourceAdmission.contract,
  );
  assertSourceIdentity(projectRoot, source, sourceIdentity);

  const temporaryPath = path.join(
    approvedBackupDirectory,
    `.aptiloop-pending-${randomUUID()}.sqlite`,
  );
  const missingTemporary = assertM1TrustedPath({
    trustedRoot: projectRoot,
    expectedPath: temporaryPath,
    candidatePath: temporaryPath,
    expectedType: "file",
    allowMissingLeaf: true,
    label: "Temporary approved backup",
  });
  if (missingTemporary.exists) {
    throw new Error("Random temporary backup artifact already exists");
  }

  let temporaryArtifact: OwnedDatabaseArtifact | undefined;
  let promotedArtifact: OwnedDatabaseArtifact | undefined;
  let promoted = false;
  try {
    const backupResult = await createExclusiveDatabaseBackup(
      source,
      temporaryPath,
      {
        checkpoint: (checkpoint, stagedDatabasePath) => {
          revalidateBackupCheckpoint(
            checkpoint,
            input,
            projectRoot,
            source,
            sourceIdentity,
            approvedBackupDirectory,
            temporaryPath,
            stagedDatabasePath,
          );
        },
      },
    );
    temporaryArtifact = backupResult.ownedArtifact;
    assertOwnedDatabaseArtifact(temporaryArtifact);

    const producedInventory = inventoryPrivateData({
      databasePaths: [temporaryPath],
    });
    const producedCandidate = producedInventory.candidates[0];
    assertApprovedCandidate(
      producedInventory.candidateCount,
      producedCandidate,
      "Produced backup",
      true,
      sourceAdmission.contract,
    );
    if (!sameLogicalSnapshot(sourceCandidateBefore, producedCandidate)) {
      throw new Error(
        "Produced backup does not match the approved source snapshot",
      );
    }
    assertOwnedDatabaseArtifact(temporaryArtifact);

    const sourceInventoryAfter = inventoryPrivateData({
      databasePaths: [source],
    });
    const sourceCandidateAfter = sourceInventoryAfter.candidates[0];
    assertApprovedCandidate(
      sourceInventoryAfter.candidateCount,
      sourceCandidateAfter,
      "Active database after backup",
      false,
      sourceAdmission.contract,
    );
    if (!sameSourceSnapshot(sourceCandidateBefore, sourceCandidateAfter)) {
      throw new Error("Active database changed while the approved backup ran");
    }
    assertSourceIdentity(projectRoot, source, sourceIdentity);

    input.testHooks?.beforePromotion?.();

    const finalSourceInventory = inventoryPrivateData({
      databasePaths: [source],
    });
    const finalSourceCandidate = finalSourceInventory.candidates[0];
    assertApprovedCandidate(
      finalSourceInventory.candidateCount,
      finalSourceCandidate,
      "Active database before promotion",
      false,
      sourceAdmission.contract,
    );
    if (!sameSourceSnapshot(sourceCandidateBefore, finalSourceCandidate)) {
      throw new Error("Active database changed before backup promotion");
    }
    assertSourceIdentity(projectRoot, source, sourceIdentity);
    const finalProducedInventory = inventoryPrivateData({
      databasePaths: [temporaryPath],
    });
    const finalProducedCandidate = finalProducedInventory.candidates[0];
    assertApprovedCandidate(
      finalProducedInventory.candidateCount,
      finalProducedCandidate,
      "Produced backup before promotion",
      true,
      sourceAdmission.contract,
    );
    if (
      producedCandidate.pathHash !== finalProducedCandidate.pathHash ||
      producedCandidate.classification !==
        finalProducedCandidate.classification ||
      !isDeepStrictEqual(
        producedCandidate.family,
        finalProducedCandidate.family,
      ) ||
      !isDeepStrictEqual(
        producedCandidate.health,
        finalProducedCandidate.health,
      ) ||
      !sameLogicalSnapshot(sourceCandidateBefore, finalProducedCandidate)
    ) {
      throw new Error("Produced backup changed or diverged before promotion");
    }
    assertOwnedDatabaseArtifact(temporaryArtifact);
    const validationBuffer = Buffer.allocUnsafe(64 * 1024);
    const prePromotionSnapshot = withStableOwnedDatabaseArtifact(
      temporaryArtifact,
      1n,
      validationBuffer,
      () => undefined,
    );
    assertSnapshotMatchesCandidate(
      prePromotionSnapshot,
      finalProducedCandidate,
      "Produced backup before promotion",
    );
    assertM1TrustedPath({
      trustedRoot: projectRoot,
      expectedPath: approvedBackupDirectory,
      candidatePath: approvedBackupDirectory,
      expectedType: "directory",
      label: "Approved backup directory",
    });
    assertDestinationMissing(projectRoot, approvedBackupDirectory, destination);

    try {
      linkSync(temporaryPath, destination);
    } catch (error) {
      if (hasErrorCode(error, "EEXIST")) {
        throw new Error(
          `Refusing to replace an existing backup: ${destination}`,
          { cause: error },
        );
      }
      throw error;
    }

    promotedArtifact = { ...temporaryArtifact, path: destination };
    assertPromotionLinkPair(temporaryArtifact, promotedArtifact);
    input.testHooks?.afterPromotionLink?.(temporaryPath, destination);
    assertPromotionLinkPair(temporaryArtifact, promotedArtifact);
    if (!removeOwnedDatabaseArtifact(temporaryArtifact)) {
      throw new Error("Temporary approved backup could not be removed safely");
    }
    temporaryArtifact = undefined;
    const ownedPromotedArtifact = promotedArtifact;

    withStableOwnedDatabaseArtifact(
      ownedPromotedArtifact,
      1n,
      validationBuffer,
      (promotedSnapshot) => {
        const promotedValidation = assertM1TrustedPath({
          trustedRoot: projectRoot,
          expectedPath: destination,
          candidatePath: destination,
          expectedType: "file",
          label: "Approved backup",
        });
        assertM1DatabaseSidecars({
          trustedRoot: projectRoot,
          databasePath: destination,
          label: "Approved backup",
          requireMissing: true,
        });
        if (
          !sameM1FileIdentity(promotedValidation.identity, {
            device: ownedPromotedArtifact.device,
            inode: ownedPromotedArtifact.inode,
            birthtimeNs: ownedPromotedArtifact.birthtimeNs,
          })
        ) {
          throw new Error("Approved backup identity changed during promotion");
        }

        const promotedInventory = inventoryPrivateData({
          databasePaths: [destination],
        });
        const promotedCandidate = promotedInventory.candidates[0];
        const sourceInventoryAfterPromotion = inventoryPrivateData({
          databasePaths: [source],
        });
        const sourceCandidateAfterPromotion =
          sourceInventoryAfterPromotion.candidates[0];

        if (
          prePromotionSnapshot.dev !== promotedSnapshot.dev ||
          prePromotionSnapshot.ino !== promotedSnapshot.ino ||
          prePromotionSnapshot.birthtimeNs !== promotedSnapshot.birthtimeNs ||
          prePromotionSnapshot.size !== promotedSnapshot.size ||
          prePromotionSnapshot.mtimeNs !== promotedSnapshot.mtimeNs ||
          prePromotionSnapshot.sha256 !== promotedSnapshot.sha256
        ) {
          throw new Error(
            "Promoted backup content or metadata changed after publication",
          );
        }
        assertSnapshotMatchesCandidate(
          promotedSnapshot,
          promotedCandidate,
          "Promoted backup",
        );
        assertApprovedCandidate(
          promotedInventory.candidateCount,
          promotedCandidate,
          "Promoted backup",
          true,
          sourceAdmission.contract,
        );
        assertApprovedCandidate(
          sourceInventoryAfterPromotion.candidateCount,
          sourceCandidateAfterPromotion,
          "Active database after promotion",
          false,
          sourceAdmission.contract,
        );
        if (
          !sameSourceSnapshot(
            sourceCandidateBefore,
            sourceCandidateAfterPromotion,
          )
        ) {
          throw new Error("Active database changed during backup promotion");
        }
        assertSourceIdentity(projectRoot, source, sourceIdentity);
        if (
          !sameLogicalSnapshot(
            sourceCandidateAfterPromotion,
            promotedCandidate,
          ) ||
          !sameLogicalSnapshot(finalProducedCandidate, promotedCandidate)
        ) {
          throw new Error(
            "Promoted backup diverged from the source or produced snapshot",
          );
        }
        if (
          finalProducedCandidate.classification !==
            promotedCandidate.classification ||
          !isDeepStrictEqual(
            finalProducedCandidate.family,
            promotedCandidate.family,
          ) ||
          !isDeepStrictEqual(
            finalProducedCandidate.health,
            promotedCandidate.health,
          )
        ) {
          throw new Error(
            "Promoted backup content, metadata, or health changed after publication",
          );
        }
      },
    );
    assertOwnedDatabaseArtifact(promotedArtifact);
    promoted = true;
    return {
      sourcePath: source,
      backupPath: destination,
      source: backupResult.source,
      backup: backupResult.backup,
    };
  } finally {
    if (!promoted && promotedArtifact) {
      removeOwnedDatabaseArtifact(promotedArtifact);
    }
    if (temporaryArtifact) removeOwnedDatabaseArtifact(temporaryArtifact);
  }
}
export function verifyApprovedM2MigrationBackup(
  input: ApprovedM2MigrationBackupInput,
): ApprovedM2MigrationBackupVerification {
  const projectRoot = path.resolve(input.projectRoot);
  const sourcePath = path.resolve(projectRoot, input.sourcePath);
  const activeDatabasePath = path.resolve(
    projectRoot,
    ".data",
    "dev-learning-harness.sqlite",
  );
  if (!samePath(sourcePath, activeDatabasePath)) {
    throw new Error(
      "M2 migration authorization applies only to .data/dev-learning-harness.sqlite",
    );
  }
  if (!/^[a-f0-9]{64}$/iu.test(input.expectedBackupSha256)) {
    throw new Error(
      "Approved backup SHA-256 must be exactly 64 hexadecimal characters",
    );
  }
  const expectedBackupSha256 = input.expectedBackupSha256.toLowerCase();
  const approvedBackupDirectory = path.resolve(
    projectRoot,
    ".data",
    "approved-backups",
  );
  assertM1TrustedPath({
    trustedRoot: projectRoot,
    expectedPath: approvedBackupDirectory,
    candidatePath: approvedBackupDirectory,
    expectedType: "directory",
    label: "Approved backup directory",
  });
  const backupPath = path.resolve(projectRoot, input.backupPath);
  if (
    !samePath(path.dirname(backupPath), approvedBackupDirectory) ||
    path.extname(backupPath).toLowerCase() !== ".sqlite" ||
    path.basename(backupPath).startsWith(".aptiloop-")
  ) {
    throw new Error(
      "M2 migration requires an explicit .sqlite backup directly under .data/approved-backups",
    );
  }

  const sourceTarget = assertM1WritableDatabaseTarget(sourcePath, {
    projectRoot,
    mustExist: true,
  });
  if (!sourceTarget?.identity) {
    throw new Error("The active database identity could not be established");
  }
  const sourceIdentity = sourceTarget.identity;
  const sourceAdmission = assertM1DatabaseMigrationAdmission(
    sourcePath,
    sourceTarget,
  );
  const preMigrationContract = getM1LegacyCompatibleMigrationContract();
  const baseMigrationContract = getM2BaseMigrationContract();
  const preCorrectionContract = getM2PreCorrectionMigrationContract();
  const preHardeningContract = getM2PreHardeningMigrationContract();
  const postHardeningContract = getM2PostHardeningMigrationContract();
  const postMigrationContract = getCurrentDatabaseMigrationContract();
  const coursePackContract = getM3MigrationContract();
  if (sourceAdmission.kind === "bootstrap-empty") {
    throw new Error("M2 migration authorization requires an existing database");
  }
  const sourceContract = sourceAdmission.contract;
  const alreadyMigrated = sameMigrationContract(
    sourceContract,
    postMigrationContract,
  );
  const postM2UpgradePending =
    sourceAdmission.kind === "legacy-compatible" &&
    [
      getM2MigrationContract(),
      coursePackContract,
      learningKernelMigrationContract,
      executionFabricMigrationContract,
    ].some((contract) => sameMigrationContract(sourceContract, contract));
  const correctionPending =
    sourceAdmission.kind === "legacy-compatible" &&
    sameMigrationContract(sourceContract, preCorrectionContract);
  const hardeningPending =
    sourceAdmission.kind === "legacy-compatible" &&
    sameMigrationContract(sourceContract, preHardeningContract);
  const quarantineImmutabilityPending =
    sourceAdmission.kind === "legacy-compatible" &&
    sameMigrationContract(sourceContract, postHardeningContract);
  const baseMigrated =
    sourceAdmission.kind === "legacy-compatible" &&
    sameMigrationContract(sourceContract, baseMigrationContract);
  const preMigration =
    sourceAdmission.kind === "legacy-compatible" &&
    sameMigrationContract(sourceContract, preMigrationContract);
  if (
    !preMigration &&
    !baseMigrated &&
    !correctionPending &&
    !hardeningPending &&
    !quarantineImmutabilityPending &&
    !postM2UpgradePending &&
    !alreadyMigrated
  ) {
    throw new Error(
      "Migration authorization requires an exact approved migration stage",
    );
  }

  const backupValidation = assertM1TrustedPath({
    trustedRoot: projectRoot,
    expectedPath: backupPath,
    candidatePath: backupPath,
    expectedType: "file",
    label: "Approved M2 migration backup",
  });
  if (!backupValidation.identity) {
    throw new Error(
      "Approved M2 migration backup identity could not be established",
    );
  }
  const backupIdentity = backupValidation.identity;
  assertM1DatabaseSidecars({
    trustedRoot: projectRoot,
    databasePath: backupPath,
    label: "Approved M2 migration backup",
    requireMissing: true,
  });

  const sourceCandidate = inspectApprovedCandidate(
    sourcePath,
    "Active database",
    false,
    sourceContract,
  );
  const allowedBackupContracts = postM2UpgradePending
    ? [sourceContract]
    : correctionPending
      ? [preCorrectionContract]
      : hardeningPending
        ? [preHardeningContract]
        : quarantineImmutabilityPending
          ? [postHardeningContract]
          : alreadyMigrated
            ? [
                preMigrationContract,
                preCorrectionContract,
                preHardeningContract,
                postHardeningContract,
                getM2MigrationContract(),
                coursePackContract,
                learningKernelMigrationContract,
                executionFabricMigrationContract,
                postMigrationContract,
              ]
            : [preMigrationContract];
  const inspectedBackup = inspectApprovedCandidateForContracts(
    backupPath,
    "Approved M2 migration backup",
    true,
    allowedBackupContracts,
  );
  const backupCandidate = inspectedBackup.candidate;
  const backupContract = inspectedBackup.contract;
  const coreBinding = alreadyMigrated
    ? readCoreMigrationBinding(sourcePath, postMigrationContract.schemaSha256)
    : null;
  const coreBindingMatches =
    coreBinding !== null &&
    coreBinding.source_schema_sha256 === backupContract.schemaSha256 &&
    coreBinding.source_logical_sha256 ===
      backupCandidate.health.logicalSha256 &&
    coreBinding.approved_backup_logical_sha256 ===
      backupCandidate.health.logicalSha256 &&
    coreBinding.approved_backup_sha256 === expectedBackupSha256 &&
    coreBinding.approved_backup_path_hash === backupCandidate.pathHash;
  if (backupCandidate.family.main.sha256 !== expectedBackupSha256) {
    throw new Error(
      "Approved M2 migration backup SHA-256 does not match authorization",
    );
  }
  const snapshotParity = isDeepStrictEqual(
    sourceCandidate.health.sessionSnapshots,
    backupCandidate.health.sessionSnapshots,
  );
  const sourceRun = sourceCandidate.health.m2.runs;
  const approvedM2V1Binding =
    sourceRun.sourceDatabaseDigest === backupCandidate.health.logicalSha256 &&
    sourceRun.approvedBackupLogicalSha256 ===
      backupCandidate.health.logicalSha256 &&
    sourceRun.approvedBackupSha256 === expectedBackupSha256 &&
    sourceRun.approvedBackupPathHash === backupCandidate.pathHash;
  const approvedM2V2Binding =
    sourceRun.m2V2Rows === 1 &&
    sourceRun.correctionSourceDatabaseDigest ===
      backupCandidate.health.logicalSha256 &&
    sourceRun.correctionApprovedBackupLogicalSha256 ===
      backupCandidate.health.logicalSha256 &&
    sourceRun.correctionApprovedBackupSha256 === expectedBackupSha256 &&
    sourceRun.correctionApprovedBackupPathHash === backupCandidate.pathHash;
  const approvedM2V3Binding =
    sourceRun.m2V3Rows === 1 &&
    sourceRun.hardeningSourceDatabaseDigest ===
      backupCandidate.health.logicalSha256 &&
    sourceRun.hardeningApprovedBackupLogicalSha256 ===
      backupCandidate.health.logicalSha256 &&
    sourceRun.hardeningApprovedBackupSha256 === expectedBackupSha256 &&
    sourceRun.hardeningApprovedBackupPathHash === backupCandidate.pathHash;
  const approvedM2V4Binding =
    sourceRun.m2V4Rows === 1 &&
    sourceRun.quarantineImmutabilitySourceDatabaseDigest ===
      backupCandidate.health.logicalSha256 &&
    sourceRun.quarantineImmutabilityApprovedBackupLogicalSha256 ===
      backupCandidate.health.logicalSha256 &&
    sourceRun.quarantineImmutabilityApprovedBackupSha256 ===
      expectedBackupSha256 &&
    sourceRun.quarantineImmutabilityApprovedBackupPathHash ===
      backupCandidate.pathHash;
  const lineageBindingValid =
    preMigration ||
    correctionPending ||
    hardeningPending ||
    quarantineImmutabilityPending ||
    postM2UpgradePending
      ? sameLogicalSnapshot(sourceCandidate, backupCandidate)
      : alreadyMigrated &&
          sameMigrationContract(backupContract, postMigrationContract)
        ? sameLogicalSnapshot(sourceCandidate, backupCandidate)
        : coreBindingMatches
          ? true
          : sameMigrationContract(backupContract, preMigrationContract)
            ? approvedM2V1Binding
            : sameMigrationContract(backupContract, preCorrectionContract)
              ? approvedM2V2Binding
              : sameMigrationContract(backupContract, preHardeningContract)
                ? approvedM2V3Binding
                : approvedM2V4Binding;
  if (!snapshotParity || !lineageBindingValid) {
    throw new Error(
      "Approved M2 migration backup does not match the active migration lineage",
    );
  }
  assertSourceIdentity(projectRoot, sourcePath, sourceIdentity);
  const backupArtifact: OwnedDatabaseArtifact = {
    path: backupPath,
    device: backupIdentity.device,
    inode: backupIdentity.inode,
    birthtimeNs: backupIdentity.birthtimeNs,
  };
  const backupSnapshot = withStableOwnedDatabaseArtifact(
    backupArtifact,
    1n,
    Buffer.allocUnsafe(64 * 1024),
    () => undefined,
  );
  if (backupSnapshot.sha256 !== expectedBackupSha256) {
    throw new Error("Approved M2 migration backup changed during verification");
  }
  const recoveryCopy = verifyWholeFileRecoveryCopy({
    projectRoot,
    approvedBackupDirectory,
    backupArtifact,
    backupCandidate,
    expectedBackupSha256,
    contract: backupContract,
    retainRecoveryCopy: input.retainRecoveryCopy === true,
    ...(input.testHooks === undefined ? {} : { testHooks: input.testHooks }),
  });

  input.testHooks?.beforeReturn?.(sourcePath, backupPath);
  const finalSourceCandidate = inspectApprovedCandidate(
    sourcePath,
    "Active database after authorization preflight",
    false,
    sourceContract,
  );
  const finalBackupCandidate = inspectApprovedCandidate(
    backupPath,
    "Approved M2 migration backup after recovery verification",
    true,
    backupContract,
  );
  const finalCoreBinding = alreadyMigrated
    ? readCoreMigrationBinding(sourcePath, postMigrationContract.schemaSha256)
    : null;
  const finalCoreBindingMatches =
    finalCoreBinding !== null &&
    finalCoreBinding.source_schema_sha256 === backupContract.schemaSha256 &&
    finalCoreBinding.source_logical_sha256 ===
      finalBackupCandidate.health.logicalSha256 &&
    finalCoreBinding.approved_backup_logical_sha256 ===
      finalBackupCandidate.health.logicalSha256 &&
    finalCoreBinding.approved_backup_sha256 === expectedBackupSha256 &&
    finalCoreBinding.approved_backup_path_hash ===
      finalBackupCandidate.pathHash;
  assertSourceIdentity(projectRoot, sourcePath, sourceIdentity);
  assertApprovedBackupIdentity(
    projectRoot,
    backupArtifact,
    expectedBackupSha256,
    finalBackupCandidate,
  );
  const finalSourceRun = finalSourceCandidate.health.m2.runs;
  const finalBindingValid =
    preMigration ||
    correctionPending ||
    hardeningPending ||
    quarantineImmutabilityPending ||
    postM2UpgradePending
      ? sameLogicalSnapshot(finalSourceCandidate, finalBackupCandidate)
      : alreadyMigrated &&
          sameMigrationContract(backupContract, postMigrationContract)
        ? sameLogicalSnapshot(finalSourceCandidate, finalBackupCandidate)
        : finalCoreBindingMatches
          ? true
          : sameMigrationContract(backupContract, preMigrationContract)
            ? finalSourceRun.sourceDatabaseDigest ===
                finalBackupCandidate.health.logicalSha256 &&
              finalSourceRun.approvedBackupLogicalSha256 ===
                finalBackupCandidate.health.logicalSha256 &&
              finalSourceRun.approvedBackupSha256 === expectedBackupSha256 &&
              finalSourceRun.approvedBackupPathHash ===
                finalBackupCandidate.pathHash
            : sameMigrationContract(backupContract, preCorrectionContract)
              ? finalSourceRun.m2V2Rows === 1 &&
                finalSourceRun.correctionSourceDatabaseDigest ===
                  finalBackupCandidate.health.logicalSha256 &&
                finalSourceRun.correctionApprovedBackupLogicalSha256 ===
                  finalBackupCandidate.health.logicalSha256 &&
                finalSourceRun.correctionApprovedBackupSha256 ===
                  expectedBackupSha256 &&
                finalSourceRun.correctionApprovedBackupPathHash ===
                  finalBackupCandidate.pathHash
              : sameMigrationContract(backupContract, preHardeningContract)
                ? finalSourceRun.m2V3Rows === 1 &&
                  finalSourceRun.hardeningSourceDatabaseDigest ===
                    finalBackupCandidate.health.logicalSha256 &&
                  finalSourceRun.hardeningApprovedBackupLogicalSha256 ===
                    finalBackupCandidate.health.logicalSha256 &&
                  finalSourceRun.hardeningApprovedBackupSha256 ===
                    expectedBackupSha256 &&
                  finalSourceRun.hardeningApprovedBackupPathHash ===
                    finalBackupCandidate.pathHash
                : finalSourceRun.m2V4Rows === 1 &&
                  finalSourceRun.quarantineImmutabilitySourceDatabaseDigest ===
                    finalBackupCandidate.health.logicalSha256 &&
                  finalSourceRun.quarantineImmutabilityApprovedBackupLogicalSha256 ===
                    finalBackupCandidate.health.logicalSha256 &&
                  finalSourceRun.quarantineImmutabilityApprovedBackupSha256 ===
                    expectedBackupSha256 &&
                  finalSourceRun.quarantineImmutabilityApprovedBackupPathHash ===
                    finalBackupCandidate.pathHash;
  if (
    !sameSourceSnapshot(sourceCandidate, finalSourceCandidate) ||
    !finalBindingValid ||
    !isDeepStrictEqual(
      sourceCandidate.health.sessionSnapshots,
      finalSourceCandidate.health.sessionSnapshots,
    ) ||
    !isDeepStrictEqual(
      sourceCandidate.health.sessionSnapshots,
      finalBackupCandidate.health.sessionSnapshots,
    )
  ) {
    throw new Error(
      "Active database or approved backup changed during M2 authorization",
    );
  }

  return {
    projectRoot,
    sourcePath,
    backupPath,
    sourceIdentity,
    backupIdentity,
    sourceLogicalSha256: finalSourceCandidate.health.logicalSha256,
    backupLogicalSha256: finalBackupCandidate.health.logicalSha256,
    backupFileSha256: expectedBackupSha256,
    backupPathSha256: finalBackupCandidate.pathHash,
    contract: backupContract,
    sourceContract,
    recoveryCopy,
    alreadyMigrated,
    migrations: finalBackupCandidate.health.migrations,
    agentMessages: finalBackupCandidate.health.agentMessages,
    reviews: finalBackupCandidate.health.reviews,
    sessionSnapshots: finalBackupCandidate.health.sessionSnapshots,
    m2: finalBackupCandidate.health.m2,
    sourceM2: finalSourceCandidate.health.m2,
  };
}

export function assertApprovedM2MigrationBackupUnchanged(
  verification: ApprovedM2MigrationBackupVerification,
): void {
  const candidate = inspectApprovedCandidate(
    verification.backupPath,
    "Approved M2 migration backup after migration",
    true,
    verification.contract,
  );
  const artifact: OwnedDatabaseArtifact = {
    path: verification.backupPath,
    device: verification.backupIdentity.device,
    inode: verification.backupIdentity.inode,
    birthtimeNs: verification.backupIdentity.birthtimeNs,
  };
  assertApprovedBackupIdentity(
    verification.projectRoot,
    artifact,
    verification.backupFileSha256,
    candidate,
  );
  if (
    candidate.health.logicalSha256 !== verification.backupLogicalSha256 ||
    !isDeepStrictEqual(
      candidate.health.sessionSnapshots,
      verification.sessionSnapshots,
    )
  ) {
    throw new Error("Approved M2 migration backup changed during migration");
  }
}

export function assertApprovedM2MigrationRecoveryCopyUnchanged(
  verification: ApprovedM2MigrationBackupVerification,
): void {
  const artifact = verification.recoveryCopy;
  if (artifact === null) {
    throw new Error("Authorized M2 migration recovery copy was not retained");
  }
  const snapshot = withStableOwnedDatabaseArtifact(
    artifact,
    1n,
    Buffer.allocUnsafe(64 * 1024),
    () => undefined,
  );
  if (snapshot.sha256 !== verification.backupFileSha256) {
    throw new Error("Authorized M2 migration recovery copy bytes changed");
  }
  const candidate = inspectApprovedCandidate(
    artifact.path,
    "Retained M2 migration recovery copy",
    true,
    verification.contract,
  );
  assertSnapshotMatchesCandidate(
    snapshot,
    candidate,
    "Retained M2 migration recovery copy",
  );
  if (
    candidate.health.logicalSha256 !== verification.backupLogicalSha256 ||
    !isDeepStrictEqual(
      candidate.health.sessionSnapshots,
      verification.sessionSnapshots,
    )
  ) {
    throw new Error("Authorized M2 migration recovery copy changed");
  }
}

export function releaseApprovedM2MigrationRecoveryCopy(
  verification: ApprovedM2MigrationBackupVerification,
): void {
  if (
    verification.recoveryCopy === null ||
    !removeOwnedDatabaseArtifact(verification.recoveryCopy)
  ) {
    throw new Error(
      "Authorized M2 migration recovery copy could not be removed safely",
    );
  }
}
interface CoreMigrationBinding {
  source_schema_sha256: string;
  source_logical_sha256: string;
  approved_backup_logical_sha256: string;
  approved_backup_sha256: string;
  approved_backup_path_hash: string;
}

function readCoreMigrationBinding(
  databasePath: string,
  targetSchemaSha256: string,
): CoreMigrationBinding | null {
  const connection = openDatabase(databasePath, {
    readonly: true,
    fileMustExist: true,
  });
  try {
    return (
      (connection.sqlite
        .prepare(
          `SELECT source_schema_sha256, source_logical_sha256,
                  approved_backup_logical_sha256, approved_backup_sha256,
                  approved_backup_path_hash
           FROM approved_core_migration_runs
           WHERE target_schema_sha256 = ?`,
        )
        .get(targetSchemaSha256) as CoreMigrationBinding | undefined) ?? null
    );
  } catch {
    return null;
  } finally {
    connection.close();
  }
}

function sameMigrationContract(
  left: CurrentDatabaseMigrationContract,
  right: CurrentDatabaseMigrationContract,
): boolean {
  return (
    left.schemaSha256 === right.schemaSha256 &&
    left.migrationIds.length === right.migrationIds.length &&
    left.migrationIds.every((id, index) => id === right.migrationIds[index])
  );
}

function inspectApprovedCandidateForContracts(
  databasePath: string,
  label: string,
  requireStandalone: boolean,
  contracts: readonly CurrentDatabaseMigrationContract[],
): {
  readonly candidate: PrivateDataInventoryCandidate & {
    health: DatabaseInventoryHealth;
  };
  readonly contract: CurrentDatabaseMigrationContract;
} {
  const inventory = inventoryPrivateData({ databasePaths: [databasePath] });
  const candidate = inventory.candidates[0];
  const contract = contracts.find(
    (candidateContract) =>
      candidate?.health.opened === true &&
      candidate.health.schemaSha256 === candidateContract.schemaSha256 &&
      candidate.health.migrations.ids.length ===
        candidateContract.migrationIds.length &&
      candidate.health.migrations.ids.every(
        (id, index) => id === candidateContract.migrationIds[index],
      ),
  );
  if (!contract) {
    throw new Error(`${label} does not match an approved backup contract`);
  }
  assertApprovedCandidate(
    inventory.candidateCount,
    candidate,
    label,
    requireStandalone,
    contract,
  );
  return { candidate, contract };
}

function inspectApprovedCandidate(
  databasePath: string,
  label: string,
  requireStandalone: boolean,
  contract: CurrentDatabaseMigrationContract,
): PrivateDataInventoryCandidate & { health: DatabaseInventoryHealth } {
  const inventory = inventoryPrivateData({ databasePaths: [databasePath] });
  const candidate = inventory.candidates[0];
  assertApprovedCandidate(
    inventory.candidateCount,
    candidate,
    label,
    requireStandalone,
    contract,
  );
  return candidate;
}

function assertApprovedBackupIdentity(
  projectRoot: string,
  artifact: OwnedDatabaseArtifact,
  expectedSha256: string,
  candidate: PrivateDataInventoryCandidate,
): void {
  const validation = assertM1TrustedPath({
    trustedRoot: projectRoot,
    expectedPath: artifact.path,
    candidatePath: artifact.path,
    expectedType: "file",
    label: "Approved M2 migration backup",
  });
  if (!sameM1FileIdentity(validation.identity, artifact)) {
    throw new Error("Approved M2 migration backup identity changed");
  }
  assertM1DatabaseSidecars({
    trustedRoot: projectRoot,
    databasePath: artifact.path,
    label: "Approved M2 migration backup",
    requireMissing: true,
  });
  const snapshot = withStableOwnedDatabaseArtifact(
    artifact,
    1n,
    Buffer.allocUnsafe(64 * 1024),
    () => undefined,
  );
  assertSnapshotMatchesCandidate(
    snapshot,
    candidate,
    "Approved M2 migration backup",
  );
  if (snapshot.sha256 !== expectedSha256) {
    throw new Error("Approved M2 migration backup SHA-256 changed");
  }
}

function verifyWholeFileRecoveryCopy(input: {
  readonly projectRoot: string;
  readonly approvedBackupDirectory: string;
  readonly backupArtifact: OwnedDatabaseArtifact;
  readonly backupCandidate: PrivateDataInventoryCandidate & {
    health: DatabaseInventoryHealth;
  };
  readonly expectedBackupSha256: string;
  readonly contract: CurrentDatabaseMigrationContract;
  readonly retainRecoveryCopy: boolean;
  readonly testHooks?: ApprovedM2MigrationBackupTestHooks;
}): OwnedDatabaseArtifact | null {
  const restoredPath = path.join(
    input.approvedBackupDirectory,
    `${input.retainRecoveryCopy ? ".aptiloop-migration-recovery" : ".aptiloop-restore-verification"}-${randomUUID()}.sqlite`,
  );
  assertDestinationMissing(
    input.projectRoot,
    input.approvedBackupDirectory,
    restoredPath,
  );
  const restoredArtifact = reserveOwnedRecoveryArtifact(restoredPath);
  let verificationFailure: { readonly error: unknown } | undefined;
  try {
    const sourceBefore = withStableOwnedDatabaseArtifact(
      input.backupArtifact,
      1n,
      Buffer.allocUnsafe(64 * 1024),
      () => undefined,
    );
    if (sourceBefore.sha256 !== input.expectedBackupSha256) {
      throw new Error("Approved backup changed before recovery verification");
    }
    copyWholeFileBytes(input.backupArtifact, restoredArtifact);
    input.testHooks?.afterRestoreCopy?.(restoredPath);
    const sourceAfter = withStableOwnedDatabaseArtifact(
      input.backupArtifact,
      1n,
      Buffer.allocUnsafe(64 * 1024),
      () => undefined,
    );
    const restoredSnapshot = withStableOwnedDatabaseArtifact(
      restoredArtifact,
      1n,
      Buffer.allocUnsafe(64 * 1024),
      () => undefined,
    );
    if (
      !sameOwnedStats(sourceBefore, sourceAfter) ||
      sourceBefore.sha256 !== sourceAfter.sha256 ||
      restoredSnapshot.sha256 !== input.expectedBackupSha256
    ) {
      throw new Error(
        "Whole-file recovery verification did not preserve backup bytes",
      );
    }
    const restoredCandidate = inspectApprovedCandidate(
      restoredPath,
      "Whole-file recovery verification copy",
      true,
      input.contract,
    );
    assertSnapshotMatchesCandidate(
      restoredSnapshot,
      restoredCandidate,
      "Whole-file recovery verification copy",
    );
    if (
      restoredCandidate.health.logicalSha256 !==
        input.backupCandidate.health.logicalSha256 ||
      !isDeepStrictEqual(restoredCandidate.health, input.backupCandidate.health)
    ) {
      throw new Error(
        "Whole-file recovery verification diverged from the approved backup",
      );
    }
  } catch (error) {
    verificationFailure = { error };
  }
  if (verificationFailure !== undefined) {
    if (!removeOwnedDatabaseArtifact(restoredArtifact)) {
      throw new Error(
        "Failed recovery verification copy could not be removed safely",
        { cause: verificationFailure.error },
      );
    }
    throw verificationFailure.error;
  }
  if (input.retainRecoveryCopy) return restoredArtifact;
  if (!removeOwnedDatabaseArtifact(restoredArtifact)) {
    throw new Error(
      "Whole-file recovery verification copy could not be removed safely",
    );
  }
  return null;
}

function reserveOwnedRecoveryArtifact(
  artifactPath: string,
): OwnedDatabaseArtifact {
  let descriptor: number | undefined;
  let artifact: OwnedDatabaseArtifact | undefined;
  try {
    descriptor = openSync(
      artifactPath,
      constants.O_CREAT |
        constants.O_EXCL |
        constants.O_RDWR |
        constants.O_NOFOLLOW,
      0o600,
    );
    const stats = fstatSync(descriptor, { bigint: true });
    if (!stats.isFile() || stats.nlink !== 1n) {
      throw new Error(
        "Recovery verification artifact is not exclusively owned",
      );
    }
    artifact = {
      path: artifactPath,
      device: stats.dev,
      inode: stats.ino,
      birthtimeNs: stats.birthtimeNs,
    };
    closeSync(descriptor);
    descriptor = undefined;
    assertOwnedDatabaseArtifact(artifact);
    return artifact;
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    if (artifact) removeOwnedDatabaseArtifact(artifact);
    if (hasErrorCode(error, "EEXIST")) {
      throw new Error(
        `Refusing to replace an existing recovery verification artifact: ${artifactPath}`,
        { cause: error },
      );
    }
    throw error;
  }
}

function copyWholeFileBytes(
  source: OwnedDatabaseArtifact,
  destination: OwnedDatabaseArtifact,
): void {
  assertOwnedDatabaseArtifact(source);
  assertOwnedDatabaseArtifact(destination);
  const sourceDescriptor = openSync(
    source.path,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  let destinationDescriptor: number | undefined;
  try {
    destinationDescriptor = openSync(
      destination.path,
      constants.O_WRONLY | constants.O_NOFOLLOW,
    );
    assertOwnedDescriptorStats(
      fstatSync(sourceDescriptor, { bigint: true }),
      source,
      1n,
    );
    assertOwnedDescriptorStats(
      fstatSync(destinationDescriptor, { bigint: true }),
      destination,
      1n,
    );
    ftruncateSync(destinationDescriptor, 0);
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let position = 0;
    for (;;) {
      const bytesRead = readSync(
        sourceDescriptor,
        buffer,
        0,
        buffer.length,
        position,
      );
      if (bytesRead === 0) break;
      let written = 0;
      while (written < bytesRead) {
        written += writeSync(
          destinationDescriptor,
          buffer,
          written,
          bytesRead - written,
          position + written,
        );
      }
      position += bytesRead;
    }
    ftruncateSync(destinationDescriptor, position);
    fsyncSync(destinationDescriptor);
    assertOwnedDescriptorStats(
      fstatSync(sourceDescriptor, { bigint: true }),
      source,
      1n,
    );
    assertOwnedDescriptorStats(
      fstatSync(destinationDescriptor, { bigint: true }),
      destination,
      1n,
    );
  } finally {
    closeSync(sourceDescriptor);
    if (destinationDescriptor !== undefined) closeSync(destinationDescriptor);
  }
  assertOwnedDatabaseArtifact(source);
  assertOwnedDatabaseArtifact(destination);
}

function revalidateBackupCheckpoint(
  checkpoint: DatabaseBackupCheckpoint,
  input: ApprovedM1BackupInput,
  projectRoot: string,
  source: string,
  sourceIdentity: M1FileIdentity,
  approvedBackupDirectory: string,
  temporaryPath: string,
  stagedDatabasePath?: string,
): void {
  if (checkpoint === "before-copy") {
    input.testHooks?.beforeCopy?.(temporaryPath);
  }
  if (checkpoint === "before-sidecar-cleanup") {
    if (stagedDatabasePath === undefined) {
      throw new Error(
        "Backup staging path was not provided at sidecar cleanup",
      );
    }
    input.testHooks?.beforeSidecarCleanup?.(stagedDatabasePath);
  }
  if (checkpoint === "after-copy") input.testHooks?.afterCopy?.();
  assertSourceIdentity(projectRoot, source, sourceIdentity);
  assertM1TrustedPath({
    trustedRoot: projectRoot,
    expectedPath: approvedBackupDirectory,
    candidatePath: approvedBackupDirectory,
    expectedType: "directory",
    label: "Approved backup directory",
  });
  const temporaryMustBeMissing =
    checkpoint === "before-source-inspection" ||
    checkpoint === "before-destination-create";
  const temporaryValidation = assertM1TrustedPath({
    trustedRoot: projectRoot,
    expectedPath: temporaryPath,
    candidatePath: temporaryPath,
    expectedType: "file",
    allowMissingLeaf: temporaryMustBeMissing,
    label: "Temporary approved backup",
  });
  if (temporaryMustBeMissing && temporaryValidation.exists) {
    throw new Error("Random temporary backup artifact already exists");
  }
  assertM1DatabaseSidecars({
    trustedRoot: projectRoot,
    databasePath: temporaryPath,
    label: "Temporary approved backup",
    requireMissing: true,
  });
}

function assertPromotionLinkPair(
  temporaryArtifact: OwnedDatabaseArtifact,
  promotedArtifact: OwnedDatabaseArtifact,
): void {
  assertOwnedDatabaseArtifact(temporaryArtifact);
  assertOwnedDatabaseArtifact(promotedArtifact);
  const temporaryStats = lstatSync(temporaryArtifact.path, { bigint: true });
  const promotedStats = lstatSync(promotedArtifact.path, { bigint: true });
  if (
    temporaryStats.nlink !== 2n ||
    promotedStats.nlink !== 2n ||
    temporaryStats.dev !== promotedStats.dev ||
    temporaryStats.ino !== promotedStats.ino ||
    temporaryStats.birthtimeNs !== promotedStats.birthtimeNs
  ) {
    throw new Error("Approved backup hard-link promotion identity changed");
  }
}

interface OwnedDatabaseSnapshot {
  readonly dev: bigint;
  readonly ino: bigint;
  readonly birthtimeNs: bigint;
  readonly size: bigint;
  readonly mtimeNs: bigint;
  readonly ctimeNs: bigint;
  readonly nlink: bigint;
  readonly sha256: string;
}

function withStableOwnedDatabaseArtifact(
  artifact: OwnedDatabaseArtifact,
  expectedLinkCount: bigint,
  buffer: Buffer,
  inspect: (snapshot: OwnedDatabaseSnapshot) => void,
): OwnedDatabaseSnapshot {
  assertOwnedDatabaseArtifact(artifact);
  const descriptor = openSync(
    artifact.path,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    const before = snapshotOwnedDatabaseDescriptor(
      descriptor,
      artifact,
      expectedLinkCount,
      buffer,
    );
    assertOwnedPathSnapshot(artifact, before);
    inspect(before);
    const after = snapshotOwnedDatabaseDescriptor(
      descriptor,
      artifact,
      expectedLinkCount,
      buffer,
    );
    if (!sameOwnedStats(before, after) || before.sha256 !== after.sha256) {
      throw new Error(
        "Approved backup owned inode changed during promotion validation",
      );
    }
    assertOwnedPathSnapshot(artifact, after);
    return after;
  } finally {
    closeSync(descriptor);
  }
}

function snapshotOwnedDatabaseDescriptor(
  descriptor: number,
  artifact: OwnedDatabaseArtifact,
  expectedLinkCount: bigint,
  buffer: Buffer,
): OwnedDatabaseSnapshot {
  const before = fstatSync(descriptor, { bigint: true });
  assertOwnedDescriptorStats(before, artifact, expectedLinkCount);
  const digest = createHash("sha256");
  let position = 0;
  for (;;) {
    const bytesRead = readSync(descriptor, buffer, 0, buffer.length, position);
    if (bytesRead === 0) break;
    digest.update(buffer.subarray(0, bytesRead));
    position += bytesRead;
  }
  const after = fstatSync(descriptor, { bigint: true });
  assertOwnedDescriptorStats(after, artifact, expectedLinkCount);
  if (!sameOwnedStats(before, after)) {
    throw new Error(
      "Approved backup owned inode changed while its content was read",
    );
  }
  return {
    dev: after.dev,
    ino: after.ino,
    birthtimeNs: after.birthtimeNs,
    size: after.size,
    mtimeNs: after.mtimeNs,
    ctimeNs: after.ctimeNs,
    nlink: after.nlink,
    sha256: digest.digest("hex"),
  };
}

function assertOwnedDescriptorStats(
  stats: BigIntStats,
  artifact: OwnedDatabaseArtifact,
  expectedLinkCount: bigint,
): void {
  if (
    !stats.isFile() ||
    stats.dev !== artifact.device ||
    stats.ino !== artifact.inode ||
    stats.birthtimeNs !== artifact.birthtimeNs ||
    stats.nlink !== expectedLinkCount
  ) {
    throw new Error(
      "Approved backup descriptor is not the exclusively owned inode",
    );
  }
}

function assertOwnedPathSnapshot(
  artifact: OwnedDatabaseArtifact,
  snapshot: OwnedDatabaseSnapshot,
): void {
  assertOwnedDatabaseArtifact(artifact);
  const stats = lstatSync(artifact.path, { bigint: true });
  if (!sameOwnedStats(stats, snapshot)) {
    throw new Error(
      "Approved backup path changed during owned-inode validation",
    );
  }
}

function sameOwnedStats(
  left: BigIntStats | OwnedDatabaseSnapshot,
  right: BigIntStats | OwnedDatabaseSnapshot,
): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.birthtimeNs === right.birthtimeNs &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs &&
    left.nlink === right.nlink
  );
}

function assertSnapshotMatchesCandidate(
  snapshot: OwnedDatabaseSnapshot,
  candidate: PrivateDataInventoryCandidate | undefined,
  label: string,
): void {
  const main = candidate?.family.main;
  if (
    !main?.present ||
    main.sha256 === null ||
    main.bytes !== Number(snapshot.size) ||
    main.modifiedAtMs !== Number(snapshot.mtimeNs) / 1_000_000 ||
    main.sha256 !== snapshot.sha256
  ) {
    throw new Error(`${label} is not the inventoried owned inode`);
  }
}

function assertSourceIdentity(
  projectRoot: string,
  source: string,
  expectedIdentity: M1FileIdentity,
): void {
  const current = assertM1WritableDatabaseTarget(source, {
    projectRoot,
    mustExist: true,
  });
  if (!sameM1FileIdentity(current?.identity ?? null, expectedIdentity)) {
    throw new Error("Active database identity changed during approved backup");
  }
  assertM1DatabaseJournalAbsent(source, "Active database");
}

function assertDestinationMissing(
  projectRoot: string,
  approvedBackupDirectory: string,
  destination: string,
): void {
  const validation = assertM1TrustedPath({
    trustedRoot: projectRoot,
    expectedPath: destination,
    candidatePath: destination,
    expectedType: "file",
    allowMissingLeaf: true,
    label: "Approved backup destination",
  });
  if (!samePath(validation.parentPath, approvedBackupDirectory)) {
    throw new Error("Approved backup destination has an unexpected parent");
  }
  if (validation.exists) {
    throw new Error(`Refusing to replace an existing backup: ${destination}`);
  }
  assertM1DatabaseSidecars({
    trustedRoot: projectRoot,
    databasePath: destination,
    label: "Approved backup destination",
    requireMissing: true,
  });
}

function assertApprovedCandidate(
  candidateCount: number,
  candidate: PrivateDataInventoryCandidate | undefined,
  label: string,
  requireStandalone: boolean,
  contract: CurrentDatabaseMigrationContract,
): asserts candidate is PrivateDataInventoryCandidate & {
  health: DatabaseInventoryHealth;
} {
  if (
    candidateCount !== 1 ||
    !candidate ||
    !candidate.sourceStable ||
    !candidate.health.opened ||
    !candidate.health.integrityOk ||
    !candidate.health.migrations.schemaCompatible ||
    candidate.health.foreignKeyViolationCount > 0 ||
    !candidate.health.migrations.tablePresent ||
    candidate.health.migrations.ids.join(",") !==
      contract.migrationIds.join(",") ||
    candidate.health.schemaSha256 !== contract.schemaSha256 ||
    !candidate.health.legacyCompatibility.coherent ||
    !candidate.health.agentMessages.tablePresent ||
    !candidate.health.agentMessages.schemaCompatible ||
    candidate.health.agentMessages.nonEmptyToolEventRows !== 0 ||
    candidate.health.agentMessages.invalidToolEventRows !== 0 ||
    candidate.health.agentMessages.rawEventRows !== 0 ||
    candidate.health.agentMessages.invalidRawEventRows !== 0 ||
    !candidate.health.reviews.tablePresent ||
    !candidate.health.reviews.schemaCompatible ||
    candidate.health.reviews.rawResponseRows !== 0 ||
    !candidate.health.sessionSnapshots.tablePresent ||
    !candidate.health.sessionSnapshots.schemaCompatible ||
    candidate.health.sessionSnapshots.storedContentHashRows !==
      candidate.health.sessionSnapshots.rows ||
    !hasApprovedM2Health(candidate.health.m2) ||
    candidate.health.sessionSnapshots.contentHashInventorySha256 === null ||
    candidate.health.sessionSnapshots.snapshotBytesInventorySha256 === null ||
    (requireStandalone &&
      (candidate.family.wal.present ||
        candidate.family.shm.present ||
        candidate.family.journal.present))
  ) {
    throw new Error(
      `${label} failed the read-only health and private-payload preflight`,
    );
  }
}

function hasApprovedM2Health(m2: M2FoundationInventory): boolean {
  if (!m2.present) return true;
  const run = m2.runs;
  const bootstrapLineage =
    run.sourceRowCount === run.intentionallyUnmappedRows &&
    run.mappedRows === 0 &&
    run.quarantinedRows === 0 &&
    run.approvedBackupLogicalSha256 === null &&
    run.approvedBackupSha256 === null &&
    run.approvedBackupPathHash === null;
  const migratedLineage =
    run.approvedBackupLogicalSha256 === run.sourceDatabaseDigest &&
    run.approvedBackupSha256 !== null &&
    run.approvedBackupPathHash !== null;
  return (
    m2.complete &&
    run.reconciled &&
    run.sourceDatabaseDigest !== null &&
    (bootstrapLineage || migratedLineage) &&
    m2.orphans.total === 0 &&
    m2.sessionContexts.unaccountedActiveSessionsMissingContextRows === 0 &&
    m2.sessionContexts.quarantinedActiveSessionSourceHashMismatchRows === 0 &&
    m2.provenance.quarantinedRevisionSourceHashMismatchRows === 0 &&
    m2.sessionContexts.snapshotMismatchRows === 0 &&
    m2.sessionContexts.snapshotStrictParseMismatchRows === 0 &&
    m2.sessionContexts.snapshotSchemaVersionMismatchRows === 0 &&
    m2.sessionContexts.snapshotEmbeddedIdentityMismatchRows === 0 &&
    m2.sessionContexts.snapshotEmbeddedContentHashMismatchRows === 0 &&
    m2.sessionContexts.snapshotCanonicalCoreHashMismatchRows === 0 &&
    m2.sessionContexts.snapshotBytesHashMissingRows === 0 &&
    m2.sessionContexts.snapshotBytesHashMismatchRows === 0 &&
    m2.evidence.invalidTypeRows === 0 &&
    m2.sourceSnapshots.invalidRetentionRows === 0 &&
    m2.sourceSnapshots.retentionMismatchRows === 0 &&
    m2.sourceSnapshots.contentHashInventorySha256 !== null &&
    m2.privatePayloads.inspected
  );
}

function sameLogicalSnapshot(
  left: PrivateDataInventoryCandidate,
  right: PrivateDataInventoryCandidate,
): boolean {
  return (
    left.health.opened &&
    right.health.opened &&
    left.health.logicalSha256 === right.health.logicalSha256
  );
}

function sameSourceSnapshot(
  left: PrivateDataInventoryCandidate,
  right: PrivateDataInventoryCandidate,
): boolean {
  if (!left.health.opened || !right.health.opened) return false;
  return (
    left.pathHash === right.pathHash &&
    left.health.logicalSha256 === right.health.logicalSha256
  );
}

function samePath(left: string, right: string): boolean {
  return process.platform === "win32"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}
