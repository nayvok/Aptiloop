import {
  closeSync,
  constants,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  type BigIntStats,
} from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";

import {
  assertExactDatabaseMigrationContract,
  adaptiveStudioMigrationContract,
  courseDesignerWorkflowMigrationContract,
  courseFoundationsBaseMigrationContract,
  courseFoundationsMigrationContract,
  coursePackMigrationContract,
  executionFabricMigrationContract,
  courseFoundationsPreCorrectionMigrationContract,
  courseFoundationsPreHardeningMigrationContract,
  courseFoundationsPostHardeningMigrationContract,
  getCurrentDatabaseMigrationContract,
  learningKernelMigrationContract,
  learnerCourseStateMigrationContract,
  providerHubMigrationContract,
  legacyCompatibleMigrationContract,
  openDatabaseWithWritableTargetGuard,
  type CurrentDatabaseMigrationContract,
  type DatabaseConnection,
  type DatabaseMigrationAdmissionCapability,
} from "./database.js";
import {
  inspectOpenedDatabaseHealth,
  inventoryPrivateData,
  type DatabaseInventoryHealth,
  type M2FoundationInventory,
} from "./private-data-inventory.js";

export type M1PathSafetyErrorCode =
  | "LEXICAL_MISMATCH"
  | "PATH_ESCAPE"
  | "MISSING_COMPONENT"
  | "REPARSE_COMPONENT"
  | "WRONG_TYPE"
  | "UNEXPECTED_ENTRY"
  | "INSPECTION_FAILED";

export class M1PathSafetyError extends Error {
  readonly code: M1PathSafetyErrorCode;

  constructor(
    code: M1PathSafetyErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "M1PathSafetyError";
    this.code = code;
  }
}

export interface M1FileIdentity {
  readonly device: bigint;
  readonly inode: bigint;
  readonly birthtimeNs: bigint;
}

export interface M1TrustedPathInput {
  readonly trustedRoot: string;
  readonly expectedPath: string;
  readonly candidatePath: string;
  readonly expectedType: "file" | "directory";
  readonly allowMissingLeaf?: boolean;
  readonly label: string;
}

export interface M1TrustedPathValidation {
  readonly trustedRoot: string;
  readonly path: string;
  readonly parentPath: string;
  readonly exists: boolean;
  readonly identity: M1FileIdentity | null;
}

export type M1DatabasePathAuthority = "active" | "container" | "e2e";

export interface M1DatabaseTargetValidation extends M1TrustedPathValidation {
  readonly databaseAuthority: M1DatabasePathAuthority;
}

export interface M1DatabaseTargetOptions {
  projectRoot: string;
  mode?: "active" | "disposable";
  allowContainerPath?: boolean;
  mustExist?: boolean;
}

export interface M1E2EDatabaseTargetOptions {
  readonly projectRoot: string;
  readonly runId: string;
  readonly configuredDatabasePath?: string;
  readonly runRootPath: string;
}

const activeDatabaseRelativePath = path.join(
  ".data",
  "dev-learning-harness.sqlite",
);
const containerDatabasePath = path.resolve(
  path.parse(process.cwd()).root,
  "data",
  "dev-learning-harness.sqlite",
);
const databaseSidecarSuffixes = ["-wal", "-shm", "-journal"] as const;
export function getM1LegacyCompatibleMigrationContract(): CurrentDatabaseMigrationContract {
  return legacyCompatibleMigrationContract;
}
export function getM2BaseMigrationContract(): CurrentDatabaseMigrationContract {
  return courseFoundationsBaseMigrationContract;
}
export function getM2PreCorrectionMigrationContract(): CurrentDatabaseMigrationContract {
  return courseFoundationsPreCorrectionMigrationContract;
}
export function getM2PreHardeningMigrationContract(): CurrentDatabaseMigrationContract {
  return courseFoundationsPreHardeningMigrationContract;
}
export function getM2PostHardeningMigrationContract(): CurrentDatabaseMigrationContract {
  return courseFoundationsPostHardeningMigrationContract;
}
export function getM2MigrationContract(): CurrentDatabaseMigrationContract {
  return courseFoundationsMigrationContract;
}
export function getM3MigrationContract(): CurrentDatabaseMigrationContract {
  return coursePackMigrationContract;
}

/**
 * Validates one exact app-owned path without accepting a shared link merely
 * because it canonicalizes to the same place as the expected path.
 */
export function assertM1TrustedPath(
  input: M1TrustedPathInput,
): M1TrustedPathValidation {
  const trustedRoot = path.resolve(input.trustedRoot);
  const expectedPath = path.resolve(input.expectedPath);
  const candidatePath = path.resolve(input.candidatePath);
  if (!samePath(candidatePath, expectedPath)) {
    throw new M1PathSafetyError(
      "LEXICAL_MISMATCH",
      `${input.label} does not match its app-owned path.`,
    );
  }
  assertContained(trustedRoot, expectedPath, input.label);

  const root = inspectTrustedRoot(trustedRoot, `${input.label} trusted root`);
  let lexicalCursor = trustedRoot;
  let canonicalCursor = root.canonicalPath;
  const relativePath = path.relative(trustedRoot, expectedPath);
  const segments = relativePath === "" ? [] : relativePath.split(path.sep);
  let currentStats = root.stats;

  if (segments.length === 0 && input.expectedType !== "directory") {
    throw new M1PathSafetyError(
      "WRONG_TYPE",
      `${input.label} has an unexpected filesystem object type.`,
    );
  }
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]!;
    lexicalCursor = path.join(lexicalCursor, segment);
    canonicalCursor = path.join(canonicalCursor, segment);
    const isLeaf = index === segments.length - 1;
    const stats = inspectOptionalComponent(
      lexicalCursor,
      canonicalCursor,
      isLeaf ? input.expectedType : "directory",
      input.label,
    );
    if (!stats) {
      if (isLeaf && input.allowMissingLeaf === true) {
        return {
          trustedRoot,
          path: expectedPath,
          parentPath: path.dirname(expectedPath),
          exists: false,
          identity: null,
        };
      }
      throw new M1PathSafetyError(
        "MISSING_COMPONENT",
        `${input.label} has a missing trusted path component.`,
      );
    }
    currentStats = stats;
  }

  return {
    trustedRoot,
    path: expectedPath,
    parentPath: path.dirname(expectedPath),
    exists: true,
    identity: identityOf(currentStats),
  };
}

/** Creates only missing real directories, checking every component after each mkdir. */
export function ensureM1TrustedDirectory(input: {
  readonly trustedRoot: string;
  readonly directoryPath: string;
  readonly label: string;
  readonly mode?: number;
}): M1TrustedPathValidation {
  const trustedRoot = path.resolve(input.trustedRoot);
  const directoryPath = path.resolve(input.directoryPath);
  assertContained(trustedRoot, directoryPath, input.label);
  assertM1TrustedPath({
    trustedRoot,
    expectedPath: trustedRoot,
    candidatePath: trustedRoot,
    expectedType: "directory",
    label: `${input.label} trusted root`,
  });

  const relativePath = path.relative(trustedRoot, directoryPath);
  const segments = relativePath === "" ? [] : relativePath.split(path.sep);
  let cursor = trustedRoot;
  for (const segment of segments) {
    cursor = path.join(cursor, segment);
    const validation = assertM1TrustedPath({
      trustedRoot,
      expectedPath: cursor,
      candidatePath: cursor,
      expectedType: "directory",
      allowMissingLeaf: true,
      label: input.label,
    });
    if (!validation.exists) {
      try {
        mkdirSync(cursor, { recursive: false, mode: input.mode ?? 0o700 });
      } catch (error) {
        if (!hasErrorCode(error, "EEXIST")) {
          throw new M1PathSafetyError(
            "INSPECTION_FAILED",
            `${input.label} could not be created safely.`,
            { cause: error },
          );
        }
      }
    }
    assertM1TrustedPath({
      trustedRoot,
      expectedPath: cursor,
      candidatePath: cursor,
      expectedType: "directory",
      label: input.label,
    });
  }

  return assertM1TrustedPath({
    trustedRoot,
    expectedPath: directoryPath,
    candidatePath: directoryPath,
    expectedType: "directory",
    label: input.label,
  });
}

export function assertM1WritableDatabaseTarget(
  databasePath: string,
  options: M1DatabaseTargetOptions,
): M1DatabaseTargetValidation | undefined {
  if (options.mode === "disposable") return undefined;
  if (databasePath === ":memory:") {
    throw new M1PathSafetyError(
      "LEXICAL_MISMATCH",
      "The M1 runtime and database CLI may write only the active database",
    );
  }

  const projectRoot = path.resolve(options.projectRoot);
  const candidate = path.resolve(databasePath);
  const activeDatabase = path.resolve(projectRoot, activeDatabaseRelativePath);
  if (samePath(candidate, activeDatabase)) {
    ensureM1TrustedDirectory({
      trustedRoot: projectRoot,
      directoryPath: path.dirname(activeDatabase),
      label: "Active database directory",
    });
    return {
      ...assertOrReserveDatabaseFamily({
        trustedRoot: projectRoot,
        expectedPath: activeDatabase,
        candidatePath: candidate,
        mustExist: options.mustExist === true,
        label: "Active database",
      }),
      databaseAuthority: "active",
    };
  }

  if (
    options.allowContainerPath === true &&
    samePath(candidate, containerDatabasePath)
  ) {
    const containerRoot = path.parse(containerDatabasePath).root;
    ensureM1TrustedDirectory({
      trustedRoot: containerRoot,
      directoryPath: path.dirname(containerDatabasePath),
      label: "Container database directory",
    });
    return {
      ...assertOrReserveDatabaseFamily({
        trustedRoot: containerRoot,
        expectedPath: containerDatabasePath,
        candidatePath: candidate,
        mustExist: options.mustExist === true,
        label: "Container database",
      }),
      databaseAuthority: "container",
    };
  }

  throw new M1PathSafetyError(
    "LEXICAL_MISMATCH",
    "The M1 runtime and database CLI may write only .data/dev-learning-harness.sqlite",
  );
}

export function assertM1E2EDatabaseTarget(
  databasePath: string,
  options: M1E2EDatabaseTargetOptions,
): M1DatabaseTargetValidation {
  if (!/^[a-z0-9][a-z0-9-]{7,127}$/u.test(options.runId)) {
    throw new M1PathSafetyError(
      "LEXICAL_MISMATCH",
      "The E2E database run id is invalid.",
    );
  }
  const projectRoot = path.resolve(options.projectRoot);
  const expectedRunRoot = path.resolve(
    projectRoot,
    ".data",
    "e2e-runs",
    options.runId,
  );
  assertM1TrustedPath({
    trustedRoot: projectRoot,
    expectedPath: expectedRunRoot,
    candidatePath: options.runRootPath,
    expectedType: "directory",
    label: "E2E run root",
  });
  const expectedDatabase = path.join(expectedRunRoot, "database.sqlite");
  if (options.configuredDatabasePath !== undefined) {
    assertM1TrustedPath({
      trustedRoot: projectRoot,
      expectedPath: expectedDatabase,
      candidatePath: options.configuredDatabasePath,
      expectedType: "file",
      allowMissingLeaf: true,
      label: "Configured E2E database",
    });
  }
  return {
    ...assertOrReserveDatabaseFamily({
      trustedRoot: projectRoot,
      expectedPath: expectedDatabase,
      candidatePath: databasePath,
      mustExist: false,
      label: "E2E database",
    }),
    databaseAuthority: "e2e",
  };
}

export function sameM1FileIdentity(
  left: M1FileIdentity | null,
  right: M1FileIdentity | null,
): boolean {
  return (
    left !== null &&
    right !== null &&
    left.device === right.device &&
    left.inode === right.inode &&
    left.birthtimeNs === right.birthtimeNs
  );
}

export interface M1WritableDatabaseOpenOptions {
  readonly initialTarget?: M1DatabaseTargetValidation;
  readonly revalidateTarget: () => M1DatabaseTargetValidation | undefined;
  readonly migrationMode?: "current-or-empty" | "bootstrap";
  /** @internal Deterministic adversarial seam; production callers leave unset. */
  readonly testHooks?: { readonly beforeOpen?: () => void };
}

type AdmittedDatabaseMigrationContract = {
  readonly contract: CurrentDatabaseMigrationContract;
  readonly logicalSha256: string;
};

export type M1DatabaseMigrationAdmission =
  | { readonly kind: "bootstrap-empty" }
  | ({ readonly kind: "current" } & AdmittedDatabaseMigrationContract)
  | ({
      readonly kind: "legacy-compatible";
      readonly migrationCapability: DatabaseMigrationAdmissionCapability;
    } & AdmittedDatabaseMigrationContract);

export interface M1WritableDatabaseConnection extends DatabaseConnection {
  readonly migrationAdmission: M1DatabaseMigrationAdmission | undefined;
}

export function openM1WritableDatabase(
  databasePath: string,
  options: M1WritableDatabaseOpenOptions,
): M1WritableDatabaseConnection {
  const initialTarget = options.initialTarget ?? options.revalidateTarget();
  if (!initialTarget?.identity) {
    throw new M1PathSafetyError(
      "MISSING_COMPONENT",
      "Writable database identity could not be established before opening.",
    );
  }
  let migrationAdmission: M1DatabaseMigrationAdmission | undefined;
  if (options.migrationMode !== "bootstrap") {
    migrationAdmission = assertM1DatabaseMigrationAdmission(
      databasePath,
      initialTarget,
    );
    const admittedTarget = options.revalidateTarget();
    if (
      admittedTarget?.databaseAuthority !== initialTarget.databaseAuthority ||
      !sameM1FileIdentity(
        initialTarget.identity,
        admittedTarget?.identity ?? null,
      )
    ) {
      throw new M1PathSafetyError(
        "REPARSE_COMPONENT",
        "Writable database identity changed during migration admission.",
      );
    }
  }
  options.testHooks?.beforeOpen?.();
  const connection = openDatabaseWithWritableTargetGuard(
    databasePath,
    (sqlite) => {
      const openedTarget = options.revalidateTarget();
      if (
        openedTarget?.databaseAuthority !== initialTarget.databaseAuthority ||
        !sameM1FileIdentity(
          initialTarget.identity,
          openedTarget?.identity ?? null,
        )
      ) {
        throw new M1PathSafetyError(
          "REPARSE_COMPONENT",
          "Writable database identity changed while it was opened.",
        );
      }
      if (migrationAdmission?.kind === "bootstrap-empty") {
        assertOpenedDatabaseRemainedEmpty(sqlite);
      } else if (migrationAdmission !== undefined) {
        assertOpenedDatabaseMatchesAdmission(sqlite, migrationAdmission);
      }
    },
    {
      beforeOpen: () => {
        const preOpenTarget = options.revalidateTarget();
        if (
          preOpenTarget?.databaseAuthority !==
            initialTarget.databaseAuthority ||
          !sameM1FileIdentity(
            initialTarget.identity,
            preOpenTarget?.identity ?? null,
          )
        ) {
          throw new M1PathSafetyError(
            "REPARSE_COMPONENT",
            "Writable database identity changed immediately before opening.",
          );
        }
        assertM1DatabaseJournalAbsent(databasePath, "Writable database");
      },
    },
  );
  return Object.assign(connection, { migrationAdmission });
}

export function assertM1DatabaseMigrationAdmission(
  databasePath: string,
  target: M1DatabaseTargetValidation,
): M1DatabaseMigrationAdmission {
  const allowLegacyCompatibility = hasLegacyCompatibilityAuthority(
    target,
    databasePath,
  );
  assertM1DatabaseJournalAbsent(databasePath, "Writable database");
  let mainStats: BigIntStats;
  try {
    mainStats = lstatSync(databasePath, { bigint: true });
  } catch (error) {
    throw new Error("Writable database cannot be inspected before admission", {
      cause: error,
    });
  }
  if (
    mainStats.size === 0n &&
    databaseSidecarSuffixes.every(
      (suffix) => !hasPathEntry(`${databasePath}${suffix}`),
    )
  ) {
    return { kind: "bootstrap-empty" };
  }

  const currentContract = getCurrentDatabaseMigrationContract();
  const inventory = inventoryPrivateData({ databasePaths: [databasePath] });
  const candidate = inventory.candidates[0];
  if (
    inventory.candidateCount !== 1 ||
    candidate === undefined ||
    !candidate.sourceStable ||
    !candidate.health.opened ||
    !candidate.health.integrityOk ||
    candidate.health.foreignKeyViolationCount !== 0 ||
    !candidate.health.migrations.tablePresent ||
    !candidate.health.migrations.schemaCompatible
  ) {
    throw new Error(
      "Existing writable database failed exact migration-contract admission",
    );
  }

  if (
    matchesMigrationIds(candidate.health.migrations.ids, currentContract) &&
    candidate.health.schemaSha256 === currentContract.schemaSha256 &&
    hasCurrentDatabaseHealth(candidate.health, false)
  ) {
    return {
      kind: "current",
      contract: currentContract,
      logicalSha256: candidate.health.logicalSha256,
    };
  }

  if (
    allowLegacyCompatibility &&
    candidate.health.legacyCompatibility.coherent &&
    matchesMigrationIds(
      candidate.health.migrations.ids,
      learnerCourseStateMigrationContract,
    ) &&
    candidate.health.schemaSha256 ===
      learnerCourseStateMigrationContract.schemaSha256 &&
    hasCurrentDatabaseHealth(candidate.health)
  ) {
    const migrationCapability: DatabaseMigrationAdmissionCapability = {
      kind: "legacy-compatible-noop",
      contract: learnerCourseStateMigrationContract,
      logicalSha256: candidate.health.logicalSha256,
    };
    return {
      kind: "legacy-compatible",
      contract: learnerCourseStateMigrationContract,
      logicalSha256: candidate.health.logicalSha256,
      migrationCapability,
    };
  }

  if (
    allowLegacyCompatibility &&
    candidate.health.legacyCompatibility.coherent &&
    matchesMigrationIds(
      candidate.health.migrations.ids,
      courseDesignerWorkflowMigrationContract,
    ) &&
    candidate.health.schemaSha256 ===
      courseDesignerWorkflowMigrationContract.schemaSha256 &&
    hasCurrentDatabaseHealth(candidate.health)
  ) {
    const migrationCapability: DatabaseMigrationAdmissionCapability = {
      kind: "legacy-compatible-noop",
      contract: courseDesignerWorkflowMigrationContract,
      logicalSha256: candidate.health.logicalSha256,
    };
    return {
      kind: "legacy-compatible",
      contract: courseDesignerWorkflowMigrationContract,
      logicalSha256: candidate.health.logicalSha256,
      migrationCapability,
    };
  }

  if (
    allowLegacyCompatibility &&
    candidate.health.legacyCompatibility.coherent &&
    matchesMigrationIds(
      candidate.health.migrations.ids,
      adaptiveStudioMigrationContract,
    ) &&
    candidate.health.schemaSha256 ===
      adaptiveStudioMigrationContract.schemaSha256 &&
    hasCurrentDatabaseHealth(candidate.health)
  ) {
    const migrationCapability: DatabaseMigrationAdmissionCapability = {
      kind: "legacy-compatible-noop",
      contract: adaptiveStudioMigrationContract,
      logicalSha256: candidate.health.logicalSha256,
    };
    return {
      kind: "legacy-compatible",
      contract: adaptiveStudioMigrationContract,
      logicalSha256: candidate.health.logicalSha256,
      migrationCapability,
    };
  }

  if (
    allowLegacyCompatibility &&
    candidate.health.legacyCompatibility.coherent &&
    matchesMigrationIds(
      candidate.health.migrations.ids,
      providerHubMigrationContract,
    ) &&
    candidate.health.schemaSha256 ===
      providerHubMigrationContract.schemaSha256 &&
    hasCurrentDatabaseHealth(candidate.health)
  ) {
    const migrationCapability: DatabaseMigrationAdmissionCapability = {
      kind: "legacy-compatible-noop",
      contract: providerHubMigrationContract,
      logicalSha256: candidate.health.logicalSha256,
    };
    return {
      kind: "legacy-compatible",
      contract: providerHubMigrationContract,
      logicalSha256: candidate.health.logicalSha256,
      migrationCapability,
    };
  }

  if (
    allowLegacyCompatibility &&
    candidate.health.legacyCompatibility.coherent &&
    matchesMigrationIds(
      candidate.health.migrations.ids,
      executionFabricMigrationContract,
    ) &&
    candidate.health.schemaSha256 ===
      executionFabricMigrationContract.schemaSha256 &&
    hasCurrentDatabaseHealth(candidate.health)
  ) {
    const migrationCapability: DatabaseMigrationAdmissionCapability = {
      kind: "legacy-compatible-noop",
      contract: executionFabricMigrationContract,
      logicalSha256: candidate.health.logicalSha256,
    };
    return {
      kind: "legacy-compatible",
      contract: executionFabricMigrationContract,
      logicalSha256: candidate.health.logicalSha256,
      migrationCapability,
    };
  }

  if (
    allowLegacyCompatibility &&
    candidate.health.legacyCompatibility.coherent &&
    matchesMigrationIds(
      candidate.health.migrations.ids,
      learningKernelMigrationContract,
    ) &&
    candidate.health.schemaSha256 ===
      learningKernelMigrationContract.schemaSha256 &&
    hasCurrentDatabaseHealth(candidate.health)
  ) {
    const migrationCapability: DatabaseMigrationAdmissionCapability = {
      kind: "legacy-compatible-noop",
      contract: learningKernelMigrationContract,
      logicalSha256: candidate.health.logicalSha256,
    };
    return {
      kind: "legacy-compatible",
      contract: learningKernelMigrationContract,
      logicalSha256: candidate.health.logicalSha256,
      migrationCapability,
    };
  }

  if (
    allowLegacyCompatibility &&
    candidate.health.legacyCompatibility.coherent &&
    matchesMigrationIds(
      candidate.health.migrations.ids,
      coursePackMigrationContract,
    ) &&
    candidate.health.schemaSha256 ===
      coursePackMigrationContract.schemaSha256 &&
    hasCurrentDatabaseHealth(candidate.health)
  ) {
    const migrationCapability: DatabaseMigrationAdmissionCapability = {
      kind: "legacy-compatible-noop",
      contract: coursePackMigrationContract,
      logicalSha256: candidate.health.logicalSha256,
    };
    return {
      kind: "legacy-compatible",
      contract: coursePackMigrationContract,
      logicalSha256: candidate.health.logicalSha256,
      migrationCapability,
    };
  }

  if (
    allowLegacyCompatibility &&
    candidate.health.legacyCompatibility.coherent &&
    matchesMigrationIds(
      candidate.health.migrations.ids,
      courseFoundationsMigrationContract,
    ) &&
    candidate.health.schemaSha256 ===
      courseFoundationsMigrationContract.schemaSha256 &&
    hasCurrentDatabaseHealth(candidate.health)
  ) {
    const migrationCapability: DatabaseMigrationAdmissionCapability = {
      kind: "legacy-compatible-noop",
      contract: courseFoundationsMigrationContract,
      logicalSha256: candidate.health.logicalSha256,
    };
    return {
      kind: "legacy-compatible",
      contract: courseFoundationsMigrationContract,
      logicalSha256: candidate.health.logicalSha256,
      migrationCapability,
    };
  }

  if (
    allowLegacyCompatibility &&
    candidate.health.legacyCompatibility.coherent &&
    matchesMigrationIds(
      candidate.health.migrations.ids,
      courseFoundationsPostHardeningMigrationContract,
    ) &&
    candidate.health.schemaSha256 ===
      courseFoundationsPostHardeningMigrationContract.schemaSha256 &&
    hasExactCourseFoundationsHealth(candidate.health.m2) &&
    candidate.health.m2.runs.rows === 3 &&
    candidate.health.m2.runs.m2V2Rows === 1 &&
    candidate.health.m2.runs.m2V3Rows === 1 &&
    candidate.health.m2.runs.m2V4Rows === 0 &&
    candidate.health.m2.runs.correctionSourceDatabaseDigest !== null &&
    candidate.health.m2.runs.hardeningSourceDatabaseDigest !== null &&
    ((candidate.health.m2.runs.correctionApprovedBackupLogicalSha256 === null &&
      candidate.health.m2.runs.correctionApprovedBackupSha256 === null &&
      candidate.health.m2.runs.correctionApprovedBackupPathHash === null) ||
      (candidate.health.m2.runs.correctionApprovedBackupLogicalSha256 ===
        candidate.health.m2.runs.correctionSourceDatabaseDigest &&
        candidate.health.m2.runs.correctionApprovedBackupSha256 !== null &&
        candidate.health.m2.runs.correctionApprovedBackupPathHash !== null)) &&
    ((candidate.health.m2.runs.hardeningApprovedBackupLogicalSha256 === null &&
      candidate.health.m2.runs.hardeningApprovedBackupSha256 === null &&
      candidate.health.m2.runs.hardeningApprovedBackupPathHash === null) ||
      (candidate.health.m2.runs.hardeningApprovedBackupLogicalSha256 ===
        candidate.health.m2.runs.hardeningSourceDatabaseDigest &&
        candidate.health.m2.runs.hardeningApprovedBackupSha256 !== null &&
        candidate.health.m2.runs.hardeningApprovedBackupPathHash !== null))
  ) {
    const migrationCapability: DatabaseMigrationAdmissionCapability = {
      kind: "legacy-compatible-noop",
      contract: courseFoundationsPostHardeningMigrationContract,
      logicalSha256: candidate.health.logicalSha256,
    };
    return {
      kind: "legacy-compatible",
      contract: courseFoundationsPostHardeningMigrationContract,
      logicalSha256: candidate.health.logicalSha256,
      migrationCapability,
    };
  }

  if (
    allowLegacyCompatibility &&
    candidate.health.legacyCompatibility.coherent &&
    matchesMigrationIds(
      candidate.health.migrations.ids,
      courseFoundationsPreHardeningMigrationContract,
    ) &&
    candidate.health.schemaSha256 ===
      courseFoundationsPreHardeningMigrationContract.schemaSha256 &&
    hasExactCourseFoundationsHealth(candidate.health.m2) &&
    candidate.health.m2.runs.rows === 2 &&
    candidate.health.m2.runs.m2V2Rows === 1 &&
    candidate.health.m2.runs.m2V3Rows === 0 &&
    candidate.health.m2.runs.correctionSourceDatabaseDigest !== null &&
    ((candidate.health.m2.runs.correctionApprovedBackupLogicalSha256 === null &&
      candidate.health.m2.runs.correctionApprovedBackupSha256 === null &&
      candidate.health.m2.runs.correctionApprovedBackupPathHash === null) ||
      (candidate.health.m2.runs.correctionApprovedBackupLogicalSha256 ===
        candidate.health.m2.runs.correctionSourceDatabaseDigest &&
        candidate.health.m2.runs.correctionApprovedBackupSha256 !== null &&
        candidate.health.m2.runs.correctionApprovedBackupPathHash !== null))
  ) {
    const migrationCapability: DatabaseMigrationAdmissionCapability = {
      kind: "legacy-compatible-noop",
      contract: courseFoundationsPreHardeningMigrationContract,
      logicalSha256: candidate.health.logicalSha256,
    };
    return {
      kind: "legacy-compatible",
      contract: courseFoundationsPreHardeningMigrationContract,
      logicalSha256: candidate.health.logicalSha256,
      migrationCapability,
    };
  }

  if (
    allowLegacyCompatibility &&
    candidate.health.legacyCompatibility.coherent &&
    matchesMigrationIds(
      candidate.health.migrations.ids,
      courseFoundationsBaseMigrationContract,
    ) &&
    candidate.health.schemaSha256 ===
      courseFoundationsBaseMigrationContract.schemaSha256 &&
    hasExactCourseFoundationsHealth(candidate.health.m2) &&
    candidate.health.m2.runs.rows === 1 &&
    candidate.health.m2.runs.m2V2Rows === 0 &&
    candidate.health.m2.runs.m2V3Rows === 0
  ) {
    const migrationCapability: DatabaseMigrationAdmissionCapability = {
      kind: "legacy-compatible-noop",
      contract: courseFoundationsBaseMigrationContract,
      logicalSha256: candidate.health.logicalSha256,
    };
    return {
      kind: "legacy-compatible",
      contract: courseFoundationsBaseMigrationContract,
      logicalSha256: candidate.health.logicalSha256,
      migrationCapability,
    };
  }

  if (
    allowLegacyCompatibility &&
    candidate.health.legacyCompatibility.coherent &&
    matchesMigrationIds(
      candidate.health.migrations.ids,
      courseFoundationsPreCorrectionMigrationContract,
    ) &&
    candidate.health.schemaSha256 ===
      courseFoundationsPreCorrectionMigrationContract.schemaSha256 &&
    hasExactCourseFoundationsHealth(candidate.health.m2) &&
    candidate.health.m2.runs.rows === 1 &&
    candidate.health.m2.runs.m2V2Rows === 0 &&
    candidate.health.m2.runs.m2V3Rows === 0
  ) {
    const migrationCapability: DatabaseMigrationAdmissionCapability = {
      kind: "legacy-compatible-noop",
      contract: courseFoundationsPreCorrectionMigrationContract,
      logicalSha256: candidate.health.logicalSha256,
    };
    return {
      kind: "legacy-compatible",
      contract: courseFoundationsPreCorrectionMigrationContract,
      logicalSha256: candidate.health.logicalSha256,
      migrationCapability,
    };
  }

  if (
    allowLegacyCompatibility &&
    candidate.health.legacyCompatibility.coherent &&
    matchesMigrationIds(
      candidate.health.migrations.ids,
      legacyCompatibleMigrationContract,
    ) &&
    candidate.health.schemaSha256 ===
      legacyCompatibleMigrationContract.schemaSha256
  ) {
    const migrationCapability: DatabaseMigrationAdmissionCapability = {
      kind: "legacy-compatible-noop",
      contract: legacyCompatibleMigrationContract,
      logicalSha256: candidate.health.logicalSha256,
    };
    return {
      kind: "legacy-compatible",
      contract: legacyCompatibleMigrationContract,
      logicalSha256: candidate.health.logicalSha256,
      migrationCapability,
    };
  }

  throw new Error(
    `Existing writable database matches neither approved exact migration contract (schema ${candidate.health.schemaSha256}; legacy coherence ${candidate.health.legacyCompatibility.coherent ? "coherent" : "incoherent"}; migrations ${candidate.health.migrations.ids.join(",")})`,
  );
}

function hasExactCourseFoundationsHealth(m2: M2FoundationInventory): boolean {
  return (
    m2.complete &&
    m2.runs.m2V1Rows === 1 &&
    m2.runs.reconciled &&
    m2.runs.sourceDatabaseDigest !== null &&
    m2.runs.approvedBackupLogicalSha256 === m2.runs.sourceDatabaseDigest &&
    m2.runs.approvedBackupSha256 !== null &&
    m2.runs.approvedBackupPathHash !== null &&
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

function hasCurrentDatabaseHealth(
  health: DatabaseInventoryHealth,
  requireLegacyCoherence = true,
): boolean {
  const m2 = health.m2;
  const runs = m2.runs;
  const bootstrapLineage =
    runs.sourceRowCount === runs.intentionallyUnmappedRows &&
    runs.mappedRows === 0 &&
    runs.quarantinedRows === 0 &&
    runs.approvedBackupLogicalSha256 === null &&
    runs.approvedBackupSha256 === null &&
    runs.approvedBackupPathHash === null;
  const migratedLineage =
    runs.approvedBackupLogicalSha256 === runs.sourceDatabaseDigest &&
    runs.approvedBackupSha256 !== null &&
    runs.approvedBackupPathHash !== null;
  const correctionBootstrap =
    runs.correctionApprovedBackupLogicalSha256 === null &&
    runs.correctionApprovedBackupSha256 === null &&
    runs.correctionApprovedBackupPathHash === null;
  const correctionMigrated =
    runs.correctionApprovedBackupLogicalSha256 ===
      runs.correctionSourceDatabaseDigest &&
    runs.correctionApprovedBackupSha256 !== null &&
    runs.correctionApprovedBackupPathHash !== null;
  const hardeningBootstrap =
    runs.hardeningApprovedBackupLogicalSha256 === null &&
    runs.hardeningApprovedBackupSha256 === null &&
    runs.hardeningApprovedBackupPathHash === null;
  const hardeningMigrated =
    runs.hardeningApprovedBackupLogicalSha256 ===
      runs.hardeningSourceDatabaseDigest &&
    runs.hardeningApprovedBackupSha256 !== null &&
    runs.hardeningApprovedBackupPathHash !== null;
  const quarantineImmutabilityBootstrap =
    runs.quarantineImmutabilityApprovedBackupLogicalSha256 === null &&
    runs.quarantineImmutabilityApprovedBackupSha256 === null &&
    runs.quarantineImmutabilityApprovedBackupPathHash === null;
  const quarantineImmutabilityMigrated =
    runs.quarantineImmutabilityApprovedBackupLogicalSha256 ===
      runs.quarantineImmutabilitySourceDatabaseDigest &&
    runs.quarantineImmutabilityApprovedBackupSha256 !== null &&
    runs.quarantineImmutabilityApprovedBackupPathHash !== null;
  return (
    health.integrityOk &&
    health.foreignKeyViolationCount === 0 &&
    (!requireLegacyCoherence || health.legacyCompatibility.coherent) &&
    (requireLegacyCoherence || hasHealthyLearnerCourseState(health)) &&
    health.agentMessages.tablePresent &&
    health.agentMessages.schemaCompatible &&
    health.agentMessages.nonEmptyToolEventRows === 0 &&
    health.agentMessages.invalidToolEventRows === 0 &&
    health.agentMessages.rawEventRows === 0 &&
    health.agentMessages.invalidRawEventRows === 0 &&
    health.reviews.tablePresent &&
    health.reviews.schemaCompatible &&
    health.reviews.rawResponseRows === 0 &&
    health.sessionSnapshots.tablePresent &&
    health.sessionSnapshots.schemaCompatible &&
    health.sessionSnapshots.storedContentHashRows ===
      health.sessionSnapshots.rows &&
    health.sessionSnapshots.contentHashInventorySha256 !== null &&
    health.sessionSnapshots.snapshotBytesInventorySha256 !== null &&
    m2.present &&
    m2.complete &&
    runs.rows === 4 &&
    runs.m2V1Rows === 1 &&
    runs.m2V2Rows === 1 &&
    runs.m2V3Rows === 1 &&
    runs.m2V4Rows === 1 &&
    runs.reconciled &&
    runs.sourceDatabaseDigest !== null &&
    runs.correctionSourceDatabaseDigest !== null &&
    runs.hardeningSourceDatabaseDigest !== null &&
    runs.quarantineImmutabilitySourceDatabaseDigest !== null &&
    (bootstrapLineage || migratedLineage) &&
    (correctionBootstrap || correctionMigrated) &&
    (hardeningBootstrap || hardeningMigrated) &&
    (quarantineImmutabilityBootstrap || quarantineImmutabilityMigrated) &&
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
function hasHealthyLearnerCourseState(
  health: DatabaseInventoryHealth,
): boolean {
  const state = health.learnerCourseState;
  return (
    state.tablePresent &&
    state.schemaCompatible &&
    state.selectedRows <= 1 &&
    (state.rows === 0 || state.selectedRows === 1) &&
    state.invalidRevisionRows === 0 &&
    state.invalidSessionRows === 0 &&
    state.untrackedActiveSessionRows === 0
  );
}

function hasLegacyCompatibilityAuthority(
  target: M1DatabaseTargetValidation,
  databasePath: string,
): boolean {
  if (!samePath(target.path, path.resolve(databasePath))) return false;
  if (target.databaseAuthority === "active") {
    return samePath(
      target.path,
      path.resolve(target.trustedRoot, activeDatabaseRelativePath),
    );
  }
  return (
    target.databaseAuthority === "container" &&
    samePath(target.path, containerDatabasePath)
  );
}

function matchesMigrationIds(
  actualIds: readonly string[],
  contract: CurrentDatabaseMigrationContract,
): boolean {
  return (
    actualIds.length === contract.migrationIds.length &&
    actualIds.every((id, index) => id === contract.migrationIds[index])
  );
}

function assertOpenedDatabaseRemainedEmpty(sqlite: DatabaseSync): void {
  const pageCount = sqlite.prepare("PRAGMA page_count").get() as
    { page_count?: unknown } | undefined;
  const schemaCount = sqlite
    .prepare("SELECT count(*) AS count FROM sqlite_schema")
    .get() as { count?: unknown } | undefined;
  if (
    sqliteInteger(pageCount?.page_count) !== 0 ||
    sqliteInteger(schemaCount?.count) !== 0
  ) {
    throw new Error(
      "Reserved writable database did not remain empty before bootstrap",
    );
  }
}

function assertOpenedDatabaseMatchesAdmission(
  sqlite: DatabaseSync,
  admission: Exclude<M1DatabaseMigrationAdmission, { kind: "bootstrap-empty" }>,
): void {
  try {
    assertExactDatabaseMigrationContract(sqlite, admission.contract);
    const health = inspectOpenedDatabaseHealth(sqlite);
    if (
      admission.kind === "current"
        ? !hasCurrentDatabaseHealth(health, false)
        : !health.legacyCompatibility.coherent
    ) {
      throw new Error("Opened database health invariants changed");
    }
    if (health.logicalSha256 !== admission.logicalSha256) {
      throw new Error("Opened database logical snapshot changed");
    }
    if (!health.integrityOk || health.foreignKeyViolationCount !== 0) {
      throw new Error("Opened database health contract changed");
    }
  } catch (error) {
    throw new Error(
      "Opened writable database no longer matches its admitted exact contract",
      { cause: error },
    );
  }
}

function sqliteInteger(value: unknown): number {
  if (typeof value === "bigint") return Number(value);
  return typeof value === "number" && Number.isSafeInteger(value)
    ? value
    : Number.NaN;
}

function hasPathEntry(candidate: string): boolean {
  try {
    lstatSync(candidate);
    return true;
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return false;
    throw new Error("Writable database sidecars cannot be inspected", {
      cause: error,
    });
  }
}

export function assertM1DatabaseJournalAbsent(
  databasePath: string,
  label = "Database",
): void {
  try {
    lstatSync(`${databasePath}-journal`);
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return;
    throw new M1PathSafetyError(
      "INSPECTION_FAILED",
      `${label} rollback journal could not be safely inspected.`,
      { cause: error },
    );
  }
  throw new M1PathSafetyError(
    "UNEXPECTED_ENTRY",
    `${label} rollback journal must be absent before SQLite open.`,
  );
}

export function assertM1DatabaseSidecars(input: {
  readonly trustedRoot: string;
  readonly databasePath: string;
  readonly label: string;
  readonly requireMissing?: boolean;
}): void {
  for (const suffix of databaseSidecarSuffixes) {
    const sidecarPath = `${input.databasePath}${suffix}`;
    const validation = assertM1TrustedPath({
      trustedRoot: input.trustedRoot,
      expectedPath: sidecarPath,
      candidatePath: sidecarPath,
      expectedType: "file",
      allowMissingLeaf: true,
      label: `${input.label} sidecar`,
    });
    if (input.requireMissing === true && validation.exists) {
      throw new M1PathSafetyError(
        "UNEXPECTED_ENTRY",
        `${input.label} has an unexpected SQLite sidecar.`,
      );
    }
  }
}

function assertOrReserveDatabaseFamily(input: {
  trustedRoot: string;
  expectedPath: string;
  candidatePath: string;
  mustExist: boolean;
  label: string;
}): M1TrustedPathValidation {
  const initial = assertDatabaseFamily(input);
  if (initial.exists || input.mustExist) return initial;
  assertM1DatabaseSidecars({
    trustedRoot: input.trustedRoot,
    databasePath: input.expectedPath,
    label: input.label,
    requireMissing: true,
  });

  let descriptor: number | undefined;
  try {
    descriptor = openSync(
      initial.path,
      constants.O_CREAT |
        constants.O_EXCL |
        constants.O_RDWR |
        constants.O_NOFOLLOW,
      0o600,
    );
  } catch (error) {
    if (!hasErrorCode(error, "EEXIST")) {
      throw new M1PathSafetyError(
        "INSPECTION_FAILED",
        `${input.label} could not be reserved safely.`,
        { cause: error },
      );
    }
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }

  return assertDatabaseFamily({ ...input, mustExist: true });
}

function assertDatabaseFamily(input: {
  trustedRoot: string;
  expectedPath: string;
  candidatePath: string;
  mustExist: boolean;
  label: string;
}): M1TrustedPathValidation {
  const main = assertM1TrustedPath({
    trustedRoot: input.trustedRoot,
    expectedPath: input.expectedPath,
    candidatePath: input.candidatePath,
    expectedType: "file",
    allowMissingLeaf: !input.mustExist,
    label: input.label,
  });
  assertM1DatabaseSidecars({
    trustedRoot: input.trustedRoot,
    databasePath: input.expectedPath,
    label: input.label,
  });
  return main;
}

function inspectOptionalComponent(
  candidate: string,
  expectedCanonicalPath: string,
  expectedType: "file" | "directory",
  label: string,
): BigIntStats | undefined {
  let stats: BigIntStats;
  try {
    stats = lstatSync(candidate, { bigint: true });
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return undefined;
    throw new M1PathSafetyError(
      "INSPECTION_FAILED",
      `${label} cannot be safely inspected.`,
      { cause: error },
    );
  }
  return inspectStats(
    candidate,
    expectedCanonicalPath,
    stats,
    expectedType,
    label,
  );
}

function inspectTrustedRoot(
  candidate: string,
  label: string,
): { stats: BigIntStats; canonicalPath: string } {
  let stats: BigIntStats;
  try {
    stats = lstatSync(candidate, { bigint: true });
  } catch (error) {
    throw new M1PathSafetyError(
      hasErrorCode(error, "ENOENT") ? "MISSING_COMPONENT" : "INSPECTION_FAILED",
      `${label} does not exist or cannot be safely inspected.`,
      { cause: error },
    );
  }
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new M1PathSafetyError(
      stats.isSymbolicLink() ? "REPARSE_COMPONENT" : "WRONG_TYPE",
      `${label} must be a real directory.`,
    );
  }

  let canonicalParent: string;
  let canonicalPath: string;
  try {
    canonicalParent = realpathSync.native(path.dirname(candidate));
    canonicalPath = realpathSync.native(candidate);
  } catch (error) {
    throw new M1PathSafetyError(
      "INSPECTION_FAILED",
      `${label} cannot be safely canonicalized.`,
      { cause: error },
    );
  }
  const expectedCanonicalPath = path.resolve(
    canonicalParent,
    path.basename(candidate),
  );
  if (!samePath(canonicalPath, expectedCanonicalPath)) {
    throw new M1PathSafetyError(
      "REPARSE_COMPONENT",
      `${label} contains a junction or reparse point.`,
    );
  }
  return { stats, canonicalPath };
}

function inspectStats(
  candidate: string,
  expectedCanonicalPath: string,
  stats: BigIntStats,
  expectedType: "file" | "directory",
  label: string,
): BigIntStats {
  if (stats.isSymbolicLink()) {
    throw new M1PathSafetyError(
      "REPARSE_COMPONENT",
      `${label} contains a symbolic link or reparse point.`,
    );
  }
  let canonical: string;
  try {
    canonical = realpathSync.native(candidate);
  } catch (error) {
    throw new M1PathSafetyError(
      "INSPECTION_FAILED",
      `${label} cannot be safely canonicalized.`,
      { cause: error },
    );
  }
  // realpath catches Windows junctions and other reparse points that lstat may
  // not expose as symbolic links. The canonical trusted root deliberately
  // tolerates links above the root while rejecting every component below it.
  if (!samePath(expectedCanonicalPath, canonical)) {
    throw new M1PathSafetyError(
      "REPARSE_COMPONENT",
      `${label} contains a symbolic link, junction, or reparse point.`,
    );
  }
  const correctType =
    expectedType === "file" ? stats.isFile() : stats.isDirectory();
  if (!correctType) {
    throw new M1PathSafetyError(
      "WRONG_TYPE",
      `${label} has an unexpected filesystem object type.`,
    );
  }
  if (expectedType === "file" && stats.nlink !== 1n) {
    throw new M1PathSafetyError(
      "UNEXPECTED_ENTRY",
      `${label} must not have hard-link aliases.`,
    );
  }
  return stats;
}

function identityOf(stats: BigIntStats): M1FileIdentity {
  return {
    device: stats.dev,
    inode: stats.ino,
    birthtimeNs: stats.birthtimeNs,
  };
}

function assertContained(root: string, candidate: string, label: string): void {
  const relativePath = path.relative(root, candidate);
  if (
    relativePath === "" ||
    (!relativePath.startsWith(`..${path.sep}`) &&
      relativePath !== ".." &&
      !path.isAbsolute(relativePath))
  ) {
    return;
  }
  throw new M1PathSafetyError(
    "PATH_ESCAPE",
    `${label} escapes its trusted root.`,
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
