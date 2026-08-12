import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  ftruncateSync,
  linkSync,
  lstatSync,
  openSync,
  readSync,
  writeFileSync,
  writeSync,
  type BigIntStats,
} from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";

import {
  assertM1DatabaseMigrationAdmission,
  assertM1DatabaseSidecars,
  assertM1TrustedPath,
  assertM1WritableDatabaseTarget,
  ensureM1TrustedDirectory,
  sameM1FileIdentity,
  type M1FileIdentity,
} from "./active-database.js";
import {
  assertOwnedDatabaseArtifact,
  createExclusiveDatabaseBackup,
  inspectDatabase,
  removeOwnedDatabaseArtifact,
  type OwnedDatabaseArtifact,
} from "./backup.js";
import {
  assertExactDatabaseMigrationContract,
  getCurrentDatabaseMigrationContract,
  openDatabase,
  type CurrentDatabaseMigrationContract,
} from "./database.js";
import {
  databaseLogicalSha256,
  databaseSchemaSha256,
} from "./private-data-inventory.js";

export const portableDataBundleExtension = ".aptiloop-data";
export const portableDataBundleMediaType =
  "application/vnd.aptiloop.data+octet-stream";

const bundleMagic = Buffer.from("APTILOOP-DATA\u0000", "ascii");
const manifestLengthBytes = 4;
const maxManifestBytes = 64 * 1024;
const maxDatabaseBytes = 4 * 1024 * 1024 * 1024;
const minimumSqliteBytes = 512;
const portableSanitizationPolicy = "aptiloop-portable-profile-v1" as const;
const portableIncludes = [
  "courses-and-authored-content",
  "learning-state-and-evidence",
  "review-and-transcript-history",
  "application-preferences",
  "provider-and-model-metadata",
] as const;
const portableExcludes = [
  "provider-credentials",
  "environment-files",
  "exercise-workspaces-and-attempt-files",
  "absolute-local-paths",
  "provider-session-identifiers",
  "pending-provider-disclosures",
  "unfinished-provider-turns",
  "legacy-provider-options",
  "raw-provider-payloads",
  "provider-auto-reconnect-state",
] as const;
const managedProviderCatalogIds = new Set([
  "openai-api",
  "openai-subscription",
  "anthropic-api",
  "anthropic-subscription",
  "nvidia-api",
  "opencode-api",
  "google-api",
  "openrouter-api",
  "deepseek-api",
  "mistral-api",
  "groq-api",
  "github-copilot-subscription",
  "custom-openai-compatible",
  "ollama-local",
  "lm-studio-local",
]);
const portableExportDirectoryRelativePath = path.join(
  ".data",
  "portable-exports",
);
const activeDatabaseRelativePath = path.join(
  ".data",
  "dev-learning-harness.sqlite",
);

export interface PortableDataBundleManifest {
  readonly format: "aptiloop-local-data";
  readonly formatVersion: 1;
  readonly sanitizationPolicy: typeof portableSanitizationPolicy;
  readonly createdAt: string;
  readonly payload: {
    readonly kind: "sqlite";
    readonly bytes: number;
    readonly sha256: string;
    readonly logicalSha256: string;
    readonly schemaSha256: string;
    readonly migrationIds: readonly string[];
  };
  readonly includes: typeof portableIncludes;
  readonly excludes: typeof portableExcludes;
}

export interface CreatePortableDataBundleInput {
  readonly projectRoot: string;
  readonly destinationPath?: string;
  readonly now?: Date;
  /** @internal Deterministic adversarial test seam. */
  readonly testHooks?: {
    readonly afterSnapshot?: (snapshotPath: string) => void;
    readonly beforePromotion?: (destinationPath: string) => void;
  };
}

export interface PortableDataBundleResult {
  readonly bundlePath: string;
  readonly fileName: string;
  readonly bytes: number;
  readonly manifest: PortableDataBundleManifest;
}

export interface RestorePortableDataBundleInput {
  readonly projectRoot: string;
  readonly sourcePath: string;
  /** @internal Deterministic adversarial test seam. */
  readonly testHooks?: {
    readonly beforePromotion?: (activeDatabasePath: string) => void;
  };
}

export interface RestorePortableDataBundleResult {
  readonly sourcePath: string;
  readonly activeDatabasePath: string;
  readonly manifest: PortableDataBundleManifest;
}

export interface ParsedPortableDataBundle {
  readonly manifest: PortableDataBundleManifest;
  readonly payloadOffset: number;
  readonly totalBytes: number;
}

export async function createPortableDataBundle(
  input: CreatePortableDataBundleInput,
): Promise<PortableDataBundleResult> {
  const projectRoot = path.resolve(input.projectRoot);
  const databasePath = path.join(projectRoot, activeDatabaseRelativePath);
  const databaseValidation = assertM1WritableDatabaseTarget(databasePath, {
    projectRoot,
    mustExist: true,
  });
  if (!databaseValidation?.identity) {
    throw new Error("The active database identity could not be established");
  }
  const sourceIdentity = databaseValidation.identity;
  const sourceAdmission = assertM1DatabaseMigrationAdmission(
    databasePath,
    databaseValidation,
  );
  if (sourceAdmission.kind !== "current") {
    throw new Error(
      "Portable data export requires the exact current database contract",
    );
  }

  const exportDirectory = path.join(
    projectRoot,
    portableExportDirectoryRelativePath,
  );
  ensureM1TrustedDirectory({
    trustedRoot: projectRoot,
    directoryPath: exportDirectory,
    label: "Portable export directory",
  });
  const now = input.now ?? new Date();
  const destinationPath = resolvePortableExportDestination(
    projectRoot,
    exportDirectory,
    input.destinationPath ?? defaultPortableBundleName(now),
  );
  assertMissingTrustedFile(
    projectRoot,
    destinationPath,
    exportDirectory,
    "Portable data bundle destination",
  );

  const snapshotPath = path.join(
    exportDirectory,
    `.aptiloop-portable-snapshot-${randomUUID()}.sqlite`,
  );
  const temporaryBundlePath = path.join(
    exportDirectory,
    `.aptiloop-portable-bundle-${randomUUID()}.tmp`,
  );
  const rebuiltSnapshotPath = path.join(
    exportDirectory,
    `.aptiloop-portable-rebuilt-${randomUUID()}.sqlite`,
  );
  let snapshotArtifact: OwnedDatabaseArtifact | undefined;
  let rebuiltSnapshotArtifact: OwnedDatabaseArtifact | undefined;
  let temporaryBundleArtifact: OwnedDatabaseArtifact | undefined;
  let promotedBundleArtifact: OwnedDatabaseArtifact | undefined;
  let completed = false;
  try {
    const snapshot = await createExclusiveDatabaseBackup(
      databasePath,
      snapshotPath,
    );
    snapshotArtifact = snapshot.ownedArtifact;
    input.testHooks?.afterSnapshot?.(snapshotPath);
    assertActiveDatabaseUnchanged(
      projectRoot,
      databasePath,
      sourceIdentity,
      sourceAdmission.logicalSha256,
    );

    const contract = getCurrentDatabaseMigrationContract();
    sanitizePortableSnapshot(snapshotPath, contract, now);
    assertPortableDatabasePolicyFile(snapshotPath, contract);
    rebuiltSnapshotArtifact = rebuildPortableDatabase(
      snapshotPath,
      rebuiltSnapshotPath,
      contract,
    );
    const payload = inspectPortableDatabase(rebuiltSnapshotPath, contract, {
      requireCompact: true,
    });
    const manifest: PortableDataBundleManifest = {
      format: "aptiloop-local-data",
      formatVersion: 1,
      sanitizationPolicy: portableSanitizationPolicy,
      createdAt: now.toISOString(),
      payload,
      includes: portableIncludes,
      excludes: portableExcludes,
    };
    const manifestBytes = encodePortableManifest(manifest);
    const temporaryDescriptor = openSync(
      temporaryBundlePath,
      constants.O_CREAT |
        constants.O_EXCL |
        constants.O_WRONLY |
        constants.O_NOFOLLOW,
      0o600,
    );
    try {
      temporaryBundleArtifact = ownedArtifactFromDescriptor(
        temporaryBundlePath,
        temporaryDescriptor,
      );
      writeFileSync(temporaryDescriptor, bundleMagic);
      const length = Buffer.alloc(manifestLengthBytes);
      length.writeUInt32BE(manifestBytes.length, 0);
      writeFileSync(temporaryDescriptor, length);
      writeFileSync(temporaryDescriptor, manifestBytes);
      copyFileRangeToDescriptor(
        rebuiltSnapshotPath,
        0,
        payload.bytes,
        temporaryDescriptor,
        bundleMagic.length + manifestLengthBytes + manifestBytes.length,
      );
      fsyncSync(temporaryDescriptor);
    } finally {
      closeSync(temporaryDescriptor);
    }
    const parsed = parsePortableDataBundleFile(temporaryBundlePath);
    if (!portableManifestsEqual(parsed.manifest, manifest)) {
      throw new Error("Portable data bundle manifest changed while writing");
    }
    verifyPortablePayload(temporaryBundlePath, parsed);
    if (!temporaryBundleArtifact) {
      throw new Error("Portable data bundle artifact ownership was lost");
    }
    assertOwnedDatabaseArtifact(temporaryBundleArtifact);
    assertActiveDatabaseUnchanged(
      projectRoot,
      databasePath,
      sourceIdentity,
      sourceAdmission.logicalSha256,
    );
    input.testHooks?.beforePromotion?.(destinationPath);
    assertMissingTrustedFile(
      projectRoot,
      destinationPath,
      exportDirectory,
      "Portable data bundle destination",
    );
    try {
      linkSync(temporaryBundlePath, destinationPath);
    } catch (error) {
      if (hasErrorCode(error, "EEXIST")) {
        throw new Error(
          `Refusing to replace an existing file: ${destinationPath}`,
          { cause: error },
        );
      }
      throw error;
    }
    promotedBundleArtifact = {
      ...temporaryBundleArtifact,
      path: destinationPath,
    };
    assertOwnedDatabaseArtifact(promotedBundleArtifact);
    if (!removeOwnedDatabaseArtifact(temporaryBundleArtifact)) {
      throw new Error("Portable data bundle staging file changed unexpectedly");
    }
    temporaryBundleArtifact = undefined;
    const destinationValidation = assertM1TrustedPath({
      trustedRoot: projectRoot,
      expectedPath: destinationPath,
      candidatePath: destinationPath,
      expectedType: "file",
      label: "Portable data bundle",
    });
    if (!destinationValidation.identity) {
      throw new Error("Portable data bundle identity could not be established");
    }
    parsePortableDataBundleFile(destinationPath);
    const stats = lstatSync(destinationPath, { bigint: true });
    completed = true;
    return {
      bundlePath: destinationPath,
      fileName: path.basename(destinationPath),
      bytes: numberFromBigInt(stats.size, "Portable data bundle size"),
      manifest,
    };
  } finally {
    if (!completed && promotedBundleArtifact) {
      removeOwnedDatabaseArtifact(promotedBundleArtifact);
    }
    if (temporaryBundleArtifact) {
      removeOwnedDatabaseArtifact(temporaryBundleArtifact);
    }
    if (snapshotArtifact) removeOwnedDatabaseArtifact(snapshotArtifact);
    if (rebuiltSnapshotArtifact)
      removeOwnedDatabaseArtifact(rebuiltSnapshotArtifact);
  }
}

export async function restorePortableDataBundle(
  input: RestorePortableDataBundleInput,
): Promise<RestorePortableDataBundleResult> {
  const projectRoot = path.resolve(input.projectRoot);
  const sourcePath = path.resolve(input.sourcePath);
  const sourceStats = assertPortableSource(sourcePath);
  const sourceIdentity = fileIdentity(sourceStats);
  const parsed = parsePortableDataBundleFile(sourcePath);
  verifyPortablePayload(sourcePath, parsed);

  const dataDirectory = path.join(projectRoot, ".data");
  ensureM1TrustedDirectory({
    trustedRoot: projectRoot,
    directoryPath: dataDirectory,
    label: "Active database directory",
  });
  const activeDatabasePath = path.join(projectRoot, activeDatabaseRelativePath);
  assertRestoreDestinationMissing(projectRoot, activeDatabasePath);

  const stagingPath = path.join(
    dataDirectory,
    `.aptiloop-restore-${randomUUID()}.sqlite`,
  );
  let stagingArtifact: OwnedDatabaseArtifact | undefined;
  let promotedArtifact: OwnedDatabaseArtifact | undefined;
  let completed = false;
  try {
    const stagingDescriptor = openSync(
      stagingPath,
      constants.O_CREAT |
        constants.O_EXCL |
        constants.O_WRONLY |
        constants.O_NOFOLLOW,
      0o600,
    );
    try {
      stagingArtifact = ownedArtifactFromDescriptor(
        stagingPath,
        stagingDescriptor,
      );
      copyBundlePayload(
        sourcePath,
        parsed.payloadOffset,
        parsed.manifest.payload.bytes,
        stagingDescriptor,
      );
      fsyncSync(stagingDescriptor);
    } finally {
      closeSync(stagingDescriptor);
    }
    assertSourceUnchanged(sourcePath, sourceIdentity);
    if (!stagingArtifact) {
      throw new Error("Restore staging ownership was lost");
    }
    assertOwnedDatabaseArtifact(stagingArtifact);
    verifyRestoredDatabase(stagingPath, parsed.manifest);
    input.testHooks?.beforePromotion?.(activeDatabasePath);
    assertSourceUnchanged(sourcePath, sourceIdentity);
    assertRestoreDestinationMissing(projectRoot, activeDatabasePath);
    try {
      linkSync(stagingPath, activeDatabasePath);
    } catch (error) {
      if (hasErrorCode(error, "EEXIST")) {
        throw new Error(
          "Restore is create-only: the active database appeared while restore was running",
          { cause: error },
        );
      }
      throw error;
    }
    promotedArtifact = { ...stagingArtifact, path: activeDatabasePath };
    assertOwnedDatabaseArtifact(promotedArtifact);
    if (!removeOwnedDatabaseArtifact(stagingArtifact)) {
      throw new Error("Restore staging file changed unexpectedly");
    }
    stagingArtifact = undefined;
    assertM1WritableDatabaseTarget(activeDatabasePath, {
      projectRoot,
      mustExist: true,
    });
    assertM1DatabaseSidecars({
      trustedRoot: projectRoot,
      databasePath: activeDatabasePath,
      label: "Restored active database",
      requireMissing: true,
    });
    verifyRestoredDatabase(activeDatabasePath, parsed.manifest);
    completed = true;
    return {
      sourcePath,
      activeDatabasePath,
      manifest: parsed.manifest,
    };
  } finally {
    if (!completed && promotedArtifact) {
      removeOwnedDatabaseArtifact(promotedArtifact);
    }
    if (stagingArtifact) removeOwnedDatabaseArtifact(stagingArtifact);
  }
}

export function parsePortableDataBundleFile(
  sourcePath: string,
): ParsedPortableDataBundle {
  const descriptor = openSync(
    sourcePath,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    const stats = fstatSync(descriptor, { bigint: true });
    if (!stats.isFile() || stats.nlink !== 1n) {
      throw new Error("Portable data bundle must be one regular file");
    }
    const totalBytes = numberFromBigInt(
      stats.size,
      "Portable data bundle size",
    );
    const prefixLength = bundleMagic.length + manifestLengthBytes;
    if (totalBytes < prefixLength + minimumSqliteBytes) {
      throw new Error("Portable data bundle is truncated");
    }
    const prefix = Buffer.alloc(prefixLength);
    readExactly(descriptor, prefix, 0);
    if (!prefix.subarray(0, bundleMagic.length).equals(bundleMagic)) {
      throw new Error("Portable data bundle signature is invalid");
    }
    const manifestBytes = prefix.readUInt32BE(bundleMagic.length);
    if (manifestBytes < 2 || manifestBytes > maxManifestBytes) {
      throw new Error("Portable data bundle manifest size is invalid");
    }
    const payloadOffset = prefixLength + manifestBytes;
    if (payloadOffset + minimumSqliteBytes > totalBytes) {
      throw new Error("Portable data bundle payload is truncated");
    }
    const manifestBuffer = Buffer.alloc(manifestBytes);
    readExactly(descriptor, manifestBuffer, prefixLength);
    let decoded: unknown;
    try {
      decoded = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(manifestBuffer),
      );
    } catch (error) {
      throw new Error("Portable data bundle manifest is not valid JSON", {
        cause: error,
      });
    }
    const manifest = parsePortableManifest(decoded);
    if (payloadOffset + manifest.payload.bytes !== totalBytes) {
      throw new Error("Portable data bundle payload size does not match");
    }
    return { manifest, payloadOffset, totalBytes };
  } finally {
    closeSync(descriptor);
  }
}

function sanitizePortableSnapshot(
  snapshotPath: string,
  contract: CurrentDatabaseMigrationContract,
  now: Date,
): void {
  const connection = openDatabase(snapshotPath, {
    fileMustExist: true,
  });
  try {
    assertExactDatabaseMigrationContract(connection.sqlite, contract);
    runChanges(
      connection.sqlite
        .prepare(
          `UPDATE agent_conversations SET provider_session_id = NULL
           WHERE provider_session_id IS NOT NULL`,
        )
        .run(),
    );
    clearProviderTurnMetadata(connection.sqlite);
    runChanges(
      connection.sqlite
        .prepare(
          `UPDATE provider_turn_provenance
           SET status = 'cancelled', failure_code = 'cancelled', completed_at = ?
           WHERE status = 'started'`,
        )
        .run(now.toISOString()),
    );
    const pendingDisclosures = connection.sqlite
      .prepare(
        `SELECT operation.operation_id AS operationId
         FROM ai_disclosure_operations operation
         JOIN ai_disclosure_events event
           ON event.operation_id = operation.operation_id
         WHERE event.sequence = (
           SELECT MAX(latest.sequence) FROM ai_disclosure_events latest
           WHERE latest.operation_id = operation.operation_id
         ) AND event.status IN ('pending', 'approved')
         ORDER BY operation.operation_id`,
      )
      .all() as Array<{ operationId: string }>;
    const appendDisclosure = connection.sqlite.prepare(
      `INSERT INTO ai_disclosure_events
        (operation_id, sequence, status, occurred_at)
       VALUES (?, (
         SELECT COALESCE(MAX(sequence), -1) + 1
         FROM ai_disclosure_events WHERE operation_id = ?
       ), 'cancelled', ?)`,
    );
    for (const { operationId } of pendingDisclosures) {
      appendDisclosure.run(operationId, operationId, now.toISOString());
    }
    runChanges(
      connection.sqlite
        .prepare(
          `DELETE FROM application_settings WHERE key IN (
             'workspaceRoot', 'zedExecutable', 'opencodeBaseUrl'
           )`,
        )
        .run(),
    );
    runChanges(
      connection.sqlite
        .prepare(
          `DELETE FROM application_settings WHERE key NOT IN (
             'curriculum.activeWeekId', 'theme', 'uiLocale',
             'providerHubManagedConnections'
           )`,
        )
        .run(),
    );
    sanitizeManagedProviderSettings(connection.sqlite);
    runChanges(
      connection.sqlite
        .prepare(
          `UPDATE exercise_attempts
           SET workspace_path = 'portable-excluded/' || id,
               baseline_path = 'portable-excluded/' || id`,
        )
        .run(),
    );
    sanitizeExerciseTemplatePaths(connection.sqlite);
    runChanges(
      connection.sqlite
        .prepare(
          `UPDATE provider_configurations
           SET enabled = 0, endpoint = NULL, options_json = '{}'
           WHERE enabled != 0 OR endpoint IS NOT NULL OR options_json != '{}'`,
        )
        .run(),
    );
    runChanges(
      connection.sqlite
        .prepare(
          `UPDATE agent_messages
           SET tool_events_json = '[]', raw_event_json = NULL
           WHERE tool_events_json != '[]' OR raw_event_json IS NOT NULL`,
        )
        .run(),
    );
    runChanges(
      connection.sqlite
        .prepare(
          `UPDATE reviews SET raw_response = NULL
           WHERE raw_response IS NOT NULL`,
        )
        .run(),
    );
    runChanges(
      connection.sqlite
        .prepare(
          `UPDATE provider_hub_connections
           SET credential_ref = NULL, endpoint_profile_id = NULL,
               enabled = 0, state = 'disabled',
               observed_capabilities_json = NULL, last_checked_at = NULL
           WHERE credential_ref IS NOT NULL OR endpoint_profile_id IS NOT NULL
              OR enabled != 0 OR state != 'disabled'
              OR observed_capabilities_json IS NOT NULL
              OR last_checked_at IS NOT NULL`,
        )
        .run(),
    );
    connection.sqlite.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    connection.sqlite.exec("PRAGMA journal_mode = DELETE");
    assertExactDatabaseMigrationContract(connection.sqlite, contract);
  } finally {
    connection.close();
  }
}

function clearProviderTurnMetadata(sqlite: DatabaseSync): void {
  if (
    !sqlite
      .prepare(
        `SELECT 1 FROM provider_turn_provenance
         WHERE metadata_json IS NOT NULL LIMIT 1`,
      )
      .get()
  ) {
    return;
  }
  const triggerName = "provider_turn_provenance_terminal_update";
  const trigger = sqlite
    .prepare(
      `SELECT sql FROM sqlite_schema
       WHERE type = 'trigger' AND name = ?`,
    )
    .get(triggerName) as { sql?: unknown } | undefined;
  if (typeof trigger?.sql !== "string" || trigger.sql.trim() === "") {
    throw new Error("Provider turn provenance guard is unavailable");
  }
  sqlite.exec(`DROP TRIGGER ${quoteSqlIdentifier(triggerName)}`);
  try {
    sqlite
      .prepare(
        `UPDATE provider_turn_provenance SET metadata_json = NULL
         WHERE metadata_json IS NOT NULL`,
      )
      .run();
  } finally {
    sqlite.exec(trigger.sql);
  }
}

function assertActiveDatabaseUnchanged(
  projectRoot: string,
  databasePath: string,
  expectedIdentity: M1FileIdentity,
  expectedLogicalSha256: string,
): void {
  const validation = assertM1WritableDatabaseTarget(databasePath, {
    projectRoot,
    mustExist: true,
  });
  if (!sameM1FileIdentity(validation?.identity ?? null, expectedIdentity)) {
    throw new Error("Active database identity changed during export");
  }
  const admission = validation
    ? assertM1DatabaseMigrationAdmission(databasePath, validation)
    : null;
  if (
    admission?.kind !== "current" ||
    admission.logicalSha256 !== expectedLogicalSha256
  ) {
    throw new Error("Active database changed during export");
  }
}

function rebuildPortableDatabase(
  sanitizedPath: string,
  rebuiltPath: string,
  contract: CurrentDatabaseMigrationContract,
): OwnedDatabaseArtifact {
  const descriptor = openSync(
    rebuiltPath,
    constants.O_CREAT |
      constants.O_EXCL |
      constants.O_RDWR |
      constants.O_NOFOLLOW,
    0o600,
  );
  let artifact: OwnedDatabaseArtifact;
  try {
    artifact = ownedArtifactFromDescriptor(rebuiltPath, descriptor);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  try {
    assertOwnedDatabaseArtifact(artifact);
    const source = openDatabase(sanitizedPath, {
      readonly: true,
      fileMustExist: true,
    });
    try {
      assertExactDatabaseMigrationContract(source.sqlite, contract);
      assertPortableDatabasePolicy(source.sqlite);
      ftruncatePortableArtifact(artifact);
      source.sqlite.prepare("VACUUM INTO ?").run(rebuiltPath);
    } finally {
      source.close();
    }
    assertOwnedDatabaseArtifact(artifact);
    assertNoPortableSidecars(rebuiltPath);
    inspectPortableDatabase(rebuiltPath, contract, {
      requireCompact: true,
      requirePolicy: true,
    });
    return artifact;
  } catch (error) {
    removeOwnedDatabaseArtifact(artifact);
    throw error;
  }
}

function ftruncatePortableArtifact(artifact: OwnedDatabaseArtifact): void {
  const descriptor = openSync(
    artifact.path,
    constants.O_WRONLY | constants.O_NOFOLLOW,
  );
  try {
    const stats = fstatSync(descriptor, { bigint: true });
    if (
      !stats.isFile() ||
      stats.dev !== artifact.device ||
      stats.ino !== artifact.inode ||
      stats.birthtimeNs !== artifact.birthtimeNs
    ) {
      throw new Error("Portable database rebuild descriptor identity changed");
    }
    ftruncateSync(descriptor, 0);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function assertNoPortableSidecars(databasePath: string): void {
  for (const suffix of ["-wal", "-shm", "-journal"] as const) {
    try {
      lstatSync(`${databasePath}${suffix}`);
    } catch (error) {
      if (hasErrorCode(error, "ENOENT")) continue;
      throw new Error("Portable database sidecar could not be inspected", {
        cause: error,
      });
    }
    throw new Error("Portable database payload has an unexpected sidecar");
  }
}

function assertPortableDatabasePolicyFile(
  databasePath: string,
  contract: CurrentDatabaseMigrationContract,
): void {
  const connection = openDatabase(databasePath, {
    readonly: true,
    fileMustExist: true,
  });
  try {
    assertExactDatabaseMigrationContract(connection.sqlite, contract);
    assertPortableDatabasePolicy(connection.sqlite);
  } finally {
    connection.close();
  }
}

function assertPortableDatabasePolicy(sqlite: DatabaseSync): void {
  const violations: string[] = [];
  const count = (sql: string): number => {
    const row = sqlite.prepare(sql).get() as { count?: unknown } | undefined;
    const value = row?.count;
    return typeof value === "number" ? value : Number(value ?? 0);
  };
  if (
    count(
      `SELECT count(*) AS count FROM agent_conversations
       WHERE provider_session_id IS NOT NULL`,
    ) !== 0
  ) {
    violations.push("provider session identifiers");
  }
  if (
    count(
      `SELECT count(*) AS count FROM provider_configurations
       WHERE enabled != 0 OR endpoint IS NOT NULL OR options_json != '{}'`,
    ) !== 0
  ) {
    violations.push("legacy provider configuration");
  }
  if (
    count(
      `SELECT count(*) AS count FROM provider_hub_connections
       WHERE credential_ref IS NOT NULL OR endpoint_profile_id IS NOT NULL
          OR enabled != 0 OR state != 'disabled'
          OR observed_capabilities_json IS NOT NULL OR last_checked_at IS NOT NULL`,
    ) !== 0
  ) {
    violations.push("provider reconnect or credential metadata");
  }
  if (
    count(
      `SELECT count(*) AS count FROM provider_hub_connections
       WHERE adapter_id != 'pi'`,
    ) !== 0
  ) {
    violations.push("legacy or development provider connections");
  }
  if (
    count(
      `SELECT count(*) AS count FROM agent_messages
       WHERE tool_events_json != '[]' OR raw_event_json IS NOT NULL`,
    ) !== 0 ||
    count(
      `SELECT count(*) AS count FROM reviews
       WHERE raw_response IS NOT NULL`,
    ) !== 0
  ) {
    violations.push("raw provider payloads");
  }
  if (
    count(
      `SELECT count(*) AS count FROM provider_turn_provenance
       WHERE status = 'started'`,
    ) !== 0
  ) {
    violations.push("unfinished provider turns");
  }
  if (
    count(
      `SELECT count(*) AS count FROM provider_turn_provenance
       WHERE metadata_json IS NOT NULL`,
    ) !== 0
  ) {
    violations.push("provider turn metadata");
  }
  if (
    count(
      `SELECT count(*) AS count
       FROM ai_disclosure_operations operation
       JOIN ai_disclosure_events event ON event.operation_id = operation.operation_id
       WHERE event.sequence = (
         SELECT MAX(latest.sequence) FROM ai_disclosure_events latest
         WHERE latest.operation_id = operation.operation_id
       ) AND event.status IN ('pending', 'approved')`,
    ) !== 0
  ) {
    violations.push("pending provider disclosures");
  }
  const settings = sqlite
    .prepare(`SELECT key, value_json AS valueJson FROM application_settings`)
    .all() as Array<{ key: string; valueJson: string }>;
  const allowedSettings = new Set([
    "curriculum.activeWeekId",
    "theme",
    "uiLocale",
    "providerHubManagedConnections",
  ]);
  for (const setting of settings) {
    if (!allowedSettings.has(setting.key)) {
      violations.push(`unrecognized application setting ${setting.key}`);
    }
    const parsedSetting = parseJsonForPolicy(setting.valueJson);
    if (containsAbsoluteDevicePath(parsedSetting, false)) {
      violations.push(`device path in application setting ${setting.key}`);
    }
    if (
      setting.key === "providerHubManagedConnections" &&
      !isPortableManagedProviderSettings(parsedSetting)
    ) {
      violations.push("managed provider settings");
    }
  }
  for (const pathRow of sqlite
    .prepare(
      `SELECT 'exercise_attempts.workspace_path' AS location, workspace_path AS value
       FROM exercise_attempts
       UNION ALL
       SELECT 'exercise_attempts.baseline_path', baseline_path FROM exercise_attempts
       UNION ALL
       SELECT 'exercises.workspace_path', workspace_path FROM exercises`,
    )
    .iterate() as Iterable<{ location: string; value: string }>) {
    if (isAbsoluteDevicePath(pathRow.value, true)) {
      violations.push(`device path in ${pathRow.location}`);
    }
  }
  for (const field of portableStructuredFields(sqlite)) {
    for (const row of sqlite
      .prepare(
        `SELECT ${quoteSqlIdentifier(field.column)} AS value
         FROM ${quoteSqlIdentifier(field.table)}
         WHERE ${quoteSqlIdentifier(field.column)} IS NOT NULL`,
      )
      .iterate() as Iterable<{ value: unknown }>) {
      const value = row.value;
      if (typeof value !== "string") continue;
      const parsed = field.json ? parseJsonForPolicy(value) : value;
      if (containsAbsoluteDevicePath(parsed, !field.json)) {
        violations.push(`device path in ${field.table}.${field.column}`);
        break;
      }
    }
  }
  if (violations.length !== 0) {
    throw new Error(
      `Portable database policy validation failed: ${violations.slice(0, 5).join(", ")}`,
    );
  }
}

function portableStructuredFields(
  sqlite: DatabaseSync,
): Array<{ table: string; column: string; json: boolean }> {
  const result: Array<{ table: string; column: string; json: boolean }> = [];
  const tables = sqlite
    .prepare(
      `SELECT name FROM sqlite_schema
       WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
       ORDER BY name`,
    )
    .all() as Array<{ name: string }>;
  for (const { name: table } of tables) {
    const columns = sqlite
      .prepare(`PRAGMA table_info(${quoteSqlIdentifier(table)})`)
      .all() as Array<{ name: string; type: string }>;
    for (const column of columns) {
      const lower = column.name.toLowerCase();
      const json = lower.endsWith("_json") || lower === "canonical_json";
      if (
        json ||
        lower.includes("path") ||
        lower.includes("directory") ||
        lower.includes("executable")
      ) {
        result.push({ table, column: column.name, json });
      }
    }
  }
  return result;
}

function parseJsonForPolicy(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error("Portable database contains invalid structured JSON", {
      cause: error,
    });
  }
}

const pathBearingJsonKeyTokens = new Set([
  "baseline",
  "cwd",
  "dir",
  "directory",
  "directories",
  "executable",
  "file",
  "files",
  "folder",
  "folders",
  "path",
  "paths",
  "root",
  "roots",
  "workspace",
  "workspaces",
]);

function containsAbsoluteDevicePath(
  value: unknown,
  pathContext: boolean,
): boolean {
  if (typeof value === "string")
    return isAbsoluteDevicePath(value, pathContext);
  if (Array.isArray(value)) {
    return value.some((entry) =>
      containsAbsoluteDevicePath(entry, pathContext),
    );
  }
  if (isPlainObject(value)) {
    return Object.entries(value).some(([key, entry]) =>
      containsAbsoluteDevicePath(
        entry,
        pathContext || isPathBearingJsonKey(key),
      ),
    );
  }
  return false;
}

function isAbsoluteDevicePath(value: string, pathContext: boolean): boolean {
  const trimmed = value.trim();
  if (trimmed === "") return false;
  return (
    /^[a-z]:[\\/]/iu.test(trimmed) ||
    /^\\\\[?.]\\/u.test(trimmed) ||
    /^\\\\[^\\/]+(?:[\\/][^\\/]+)?/u.test(trimmed) ||
    /^\\(?!\\)/u.test(trimmed) ||
    /^file:\/{2,3}/iu.test(trimmed) ||
    (pathContext &&
      (/^\/(?!\/)/u.test(trimmed) ||
        /^\/\/[^/]+(?:\/[^/]+)?/u.test(trimmed) ||
        /^\\(?!\\)/u.test(trimmed)))
  );
}

function isPathBearingJsonKey(value: string): boolean {
  const tokens = value
    .replaceAll(/([a-z0-9])([A-Z])/gu, "$1_$2")
    .toLowerCase()
    .split(/[_-]+/u);
  return tokens.some((token) => pathBearingJsonKeyTokens.has(token));
}

function isPortableManagedProviderSettings(value: unknown): boolean {
  if (
    !isPlainObject(value) ||
    value.version !== 1 ||
    !Array.isArray(value.connections) ||
    value.connections.length > 50 ||
    !hasExactKeys(value, ["connections", "version"])
  ) {
    return false;
  }
  const connectionIds = new Set<string>();
  return value.connections.every((candidate) => {
    if (
      !isPlainObject(candidate) ||
      !hasExactKeys(candidate, [
        "baseUrl",
        "catalogId",
        "connectionId",
        "displayName",
        "modelIds",
      ]) ||
      typeof candidate.connectionId !== "string" ||
      !/^[a-z0-9][a-z0-9._:-]{0,199}$/u.test(candidate.connectionId) ||
      connectionIds.has(candidate.connectionId) ||
      typeof candidate.catalogId !== "string" ||
      !managedProviderCatalogIds.has(candidate.catalogId) ||
      typeof candidate.displayName !== "string" ||
      candidate.displayName.trim() !== candidate.displayName ||
      candidate.displayName.length === 0 ||
      candidate.displayName.length > 200 ||
      !Array.isArray(candidate.modelIds) ||
      candidate.modelIds.length > 50 ||
      !candidate.modelIds.every(
        (modelId) =>
          typeof modelId === "string" &&
          modelId.trim() === modelId &&
          modelId.length > 0 &&
          modelId.length <= 300,
      ) ||
      (candidate.baseUrl !== null &&
        (typeof candidate.baseUrl !== "string" ||
          !isPortableLoopbackUrl(candidate.baseUrl)))
    ) {
      return false;
    }
    connectionIds.add(candidate.connectionId);
    return true;
  });
}

function quoteSqlIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function sanitizeManagedProviderSettings(sqlite: DatabaseSync): void {
  const row = sqlite
    .prepare(
      `SELECT value_json AS valueJson FROM application_settings
       WHERE key = 'providerHubManagedConnections'`,
    )
    .get() as { valueJson: string } | undefined;
  if (!row) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.valueJson);
  } catch (error) {
    throw new Error("Managed provider settings are not valid JSON", {
      cause: error,
    });
  }
  if (!isPortableManagedProviderSettingsShape(parsed)) {
    throw new Error("Managed provider settings have an unsupported shape");
  }
  const connectionIds = new Set<string>();
  const connections = parsed.connections.map((candidate) => {
    if (!isPlainObject(candidate)) {
      throw new Error("Managed provider connection has an invalid shape");
    }
    assertExactKeys(candidate, [
      "baseUrl",
      "catalogId",
      "connectionId",
      "displayName",
      "modelIds",
    ]);
    if (
      typeof candidate.connectionId !== "string" ||
      !/^[a-z0-9][a-z0-9._:-]{0,199}$/u.test(candidate.connectionId) ||
      connectionIds.has(candidate.connectionId) ||
      typeof candidate.catalogId !== "string" ||
      !managedProviderCatalogIds.has(candidate.catalogId) ||
      typeof candidate.displayName !== "string" ||
      candidate.displayName.trim() !== candidate.displayName ||
      candidate.displayName.length === 0 ||
      candidate.displayName.length > 200 ||
      !Array.isArray(candidate.modelIds) ||
      candidate.modelIds.length > 50 ||
      !candidate.modelIds.every(
        (modelId) =>
          typeof modelId === "string" &&
          modelId.trim() === modelId &&
          modelId.length > 0 &&
          modelId.length <= 300,
      )
    ) {
      throw new Error("Managed provider connection values are invalid");
    }
    connectionIds.add(candidate.connectionId);
    return {
      connectionId: candidate.connectionId,
      catalogId: candidate.catalogId,
      displayName: candidate.displayName,
      baseUrl:
        typeof candidate.baseUrl === "string" &&
        isPortableLoopbackUrl(candidate.baseUrl)
          ? candidate.baseUrl
          : null,
      modelIds: candidate.modelIds,
    };
  });
  sqlite
    .prepare(
      `UPDATE application_settings SET value_json = ?
       WHERE key = 'providerHubManagedConnections'`,
    )
    .run(JSON.stringify({ version: 1, connections }));
}

function sanitizeExerciseTemplatePaths(sqlite: DatabaseSync): number {
  const rows = sqlite
    .prepare(`SELECT id, workspace_path AS workspacePath FROM exercises`)
    .all() as Array<{ id: string; workspacePath: string }>;
  const updateExercise = sqlite.prepare(
    `UPDATE exercises SET workspace_path = ? WHERE id = ?`,
  );
  let cleared = 0;
  for (const row of rows) {
    const portablePath = portableExerciseTemplatePath(row.workspacePath);
    if (!portablePath) {
      throw new Error(
        `Exercise template ${row.id} has a non-portable workspace path`,
      );
    }
    if (portablePath !== row.workspacePath) {
      updateExercise.run(portablePath, row.id);
      cleared += 1;
    }
  }
  return cleared;
}

function portableExerciseTemplatePath(value: string): string | null {
  const normalized = value.replaceAll("\\", "/");
  const marker = "/workspaces/exercises/";
  const relative = normalized.startsWith("workspaces/exercises/")
    ? normalized
    : normalized.toLowerCase().includes(marker)
      ? normalized.slice(normalized.toLowerCase().lastIndexOf(marker) + 1)
      : null;
  if (
    !relative ||
    isAbsoluteDevicePath(relative, true) ||
    relative.split("/").some((segment) => segment === ".." || segment === "")
  ) {
    return null;
  }
  return relative;
}

function isPortableLoopbackUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "http:" &&
      ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) &&
      url.username === "" &&
      url.password === "" &&
      (url.pathname === "/v1" || url.pathname === "/v1/") &&
      url.search === "" &&
      url.hash === ""
    );
  } catch {
    return false;
  }
}

function isPortableManagedProviderSettingsShape(
  value: unknown,
): value is Record<string, unknown> & { connections: unknown[]; version: 1 } {
  return (
    isPlainObject(value) &&
    value.version === 1 &&
    Array.isArray(value.connections) &&
    value.connections.length <= 50 &&
    hasExactKeys(value, ["connections", "version"])
  );
}

function inspectPortableDatabase(
  databasePath: string,
  contract: CurrentDatabaseMigrationContract,
  options: {
    readonly requireCompact?: boolean;
    readonly requirePolicy?: boolean;
  } = {},
): PortableDataBundleManifest["payload"] {
  const health = inspectDatabase(databasePath);
  if (
    health.integrity.length !== 1 ||
    health.integrity[0]?.toLowerCase() !== "ok" ||
    health.foreignKeyViolations.length !== 0
  ) {
    throw new Error("Portable database snapshot failed SQLite health checks");
  }
  const connection = openDatabase(databasePath, {
    readonly: true,
    fileMustExist: true,
  });
  try {
    assertExactDatabaseMigrationContract(connection.sqlite, contract);
    if (options.requirePolicy !== false) {
      assertPortableDatabasePolicy(connection.sqlite);
    }
    if (options.requireCompact === true) {
      const row = connection.sqlite.prepare("PRAGMA freelist_count").get() as
        { freelist_count?: unknown } | undefined;
      if (row?.freelist_count !== 0) {
        throw new Error("Portable database payload contains free pages");
      }
      const journal = connection.sqlite.prepare("PRAGMA journal_mode").get() as
        { journal_mode?: unknown } | undefined;
      if (String(journal?.journal_mode ?? "").toLowerCase() !== "delete") {
        throw new Error("Portable database payload is not standalone");
      }
    }
    const bytes = numberFromBigInt(
      lstatSync(databasePath, { bigint: true }).size,
      "Portable database size",
    );
    if (bytes < minimumSqliteBytes || bytes > maxDatabaseBytes) {
      throw new Error("Portable database payload size is unsupported");
    }
    return {
      kind: "sqlite",
      bytes,
      sha256: sha256File(databasePath),
      logicalSha256: databaseLogicalSha256(connection.sqlite),
      schemaSha256: databaseSchemaSha256(connection.sqlite),
      migrationIds: [...contract.migrationIds],
    };
  } finally {
    connection.close();
  }
}

function verifyPortablePayload(
  sourcePath: string,
  parsed: ParsedPortableDataBundle,
): void {
  const hash = createHash("sha256");
  const descriptor = openSync(
    sourcePath,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let position = parsed.payloadOffset;
    let remaining = parsed.manifest.payload.bytes;
    while (remaining > 0) {
      const length = Math.min(buffer.length, remaining);
      const bytesRead = readSync(descriptor, buffer, 0, length, position);
      if (bytesRead === 0) {
        throw new Error("Portable data bundle payload ended unexpectedly");
      }
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
      remaining -= bytesRead;
    }
  } finally {
    closeSync(descriptor);
  }
  if (hash.digest("hex") !== parsed.manifest.payload.sha256) {
    throw new Error("Portable data bundle payload SHA-256 does not match");
  }
}

function verifyRestoredDatabase(
  databasePath: string,
  manifest: PortableDataBundleManifest,
): void {
  const contract: CurrentDatabaseMigrationContract = {
    migrationIds: manifest.payload.migrationIds,
    schemaSha256: manifest.payload.schemaSha256,
  };
  const current = getCurrentDatabaseMigrationContract();
  if (
    current.schemaSha256 !== contract.schemaSha256 ||
    current.migrationIds.length !== contract.migrationIds.length ||
    !current.migrationIds.every(
      (migrationId, index) => migrationId === contract.migrationIds[index],
    )
  ) {
    throw new Error(
      "Portable data bundle requires a different Aptiloop database version",
    );
  }
  const payload = inspectPortableDatabase(databasePath, contract, {
    requireCompact: true,
    requirePolicy: true,
  });
  if (
    payload.bytes !== manifest.payload.bytes ||
    payload.sha256 !== manifest.payload.sha256 ||
    payload.logicalSha256 !== manifest.payload.logicalSha256
  ) {
    throw new Error("Restored database does not match the portable bundle");
  }
}

function parsePortableManifest(value: unknown): PortableDataBundleManifest {
  if (!isPlainObject(value)) {
    throw new Error("Portable data bundle manifest must be an object");
  }
  assertExactKeys(value, [
    "createdAt",
    "excludes",
    "format",
    "formatVersion",
    "includes",
    "payload",
    "sanitizationPolicy",
  ]);
  if (
    value.format !== "aptiloop-local-data" ||
    value.formatVersion !== 1 ||
    value.sanitizationPolicy !== portableSanitizationPolicy ||
    typeof value.createdAt !== "string" ||
    !isCanonicalIsoDate(value.createdAt) ||
    !isPlainObject(value.payload)
  ) {
    throw new Error("Portable data bundle manifest header is invalid");
  }
  assertExactKeys(value.payload, [
    "bytes",
    "kind",
    "logicalSha256",
    "migrationIds",
    "schemaSha256",
    "sha256",
  ]);
  if (
    !stringArraysEqual(value.includes, portableIncludes) ||
    !stringArraysEqual(value.excludes, portableExcludes) ||
    value.payload.kind !== "sqlite" ||
    !isSafeIntegerBetween(
      value.payload.bytes,
      minimumSqliteBytes,
      maxDatabaseBytes,
    ) ||
    !isSha256(value.payload.sha256) ||
    !isSha256(value.payload.logicalSha256) ||
    !isSha256(value.payload.schemaSha256) ||
    !isMigrationIds(value.payload.migrationIds)
  ) {
    throw new Error("Portable data bundle manifest values are invalid");
  }
  return value as unknown as PortableDataBundleManifest;
}

function encodePortableManifest(manifest: PortableDataBundleManifest): Buffer {
  const bytes = Buffer.from(JSON.stringify(manifest), "utf8");
  if (bytes.length > maxManifestBytes) {
    throw new Error("Portable data bundle manifest is too large");
  }
  return bytes;
}

function resolvePortableExportDestination(
  projectRoot: string,
  exportDirectory: string,
  configuredPath: string,
): string {
  const candidate = path.isAbsolute(configuredPath)
    ? path.resolve(configuredPath)
    : configuredPath.includes(path.sep) || configuredPath.includes("/")
      ? path.resolve(projectRoot, configuredPath)
      : path.resolve(exportDirectory, configuredPath);
  if (
    path.dirname(candidate) !== exportDirectory ||
    path.extname(candidate).toLowerCase() !== portableDataBundleExtension ||
    !/^[a-z0-9][a-z0-9._-]{0,199}\.aptiloop-data$/iu.test(
      path.basename(candidate),
    ) ||
    path.basename(candidate).startsWith(".aptiloop-")
  ) {
    throw new Error(
      "Portable export destination must be a named .aptiloop-data file directly under .data/portable-exports",
    );
  }
  return candidate;
}

function assertMissingTrustedFile(
  projectRoot: string,
  expectedPath: string,
  expectedParent: string,
  label: string,
): void {
  const validation = assertM1TrustedPath({
    trustedRoot: projectRoot,
    expectedPath,
    candidatePath: expectedPath,
    expectedType: "file",
    allowMissingLeaf: true,
    label,
  });
  if (validation.parentPath !== expectedParent) {
    throw new Error(`${label} has an unexpected parent`);
  }
  if (validation.exists) {
    throw new Error(`Refusing to replace an existing file: ${expectedPath}`);
  }
}

function assertRestoreDestinationMissing(
  projectRoot: string,
  activeDatabasePath: string,
): void {
  const validation = assertM1TrustedPath({
    trustedRoot: projectRoot,
    expectedPath: activeDatabasePath,
    candidatePath: activeDatabasePath,
    expectedType: "file",
    allowMissingLeaf: true,
    label: "Restore destination",
  });
  if (validation.exists) {
    throw new Error(
      "Restore is create-only: the active database already exists. Keep the app stopped, preserve the existing .data directory, and restore into a fresh installation.",
    );
  }
  assertM1DatabaseSidecars({
    trustedRoot: projectRoot,
    databasePath: activeDatabasePath,
    label: "Restore destination",
    requireMissing: true,
  });
}

function assertPortableSource(sourcePath: string) {
  const stats = lstatSync(sourcePath, { bigint: true });
  if (
    stats.isSymbolicLink() ||
    !stats.isFile() ||
    stats.nlink !== 1n ||
    path.extname(sourcePath).toLowerCase() !== portableDataBundleExtension
  ) {
    throw new Error(
      "Portable data source must be one real .aptiloop-data file without links",
    );
  }
  return stats;
}

function copyBundlePayload(
  sourcePath: string,
  payloadOffset: number,
  payloadBytes: number,
  destinationDescriptor: number,
): void {
  copyFileRangeToDescriptor(
    sourcePath,
    payloadOffset,
    payloadBytes,
    destinationDescriptor,
    0,
  );
}

function copyFileRangeToDescriptor(
  sourcePath: string,
  sourceOffset: number,
  bytes: number,
  destinationDescriptor: number,
  destinationOffset: number,
): void {
  const sourceDescriptor = openSync(
    sourcePath,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let sourcePosition = sourceOffset;
    let destinationPosition = destinationOffset;
    let remaining = bytes;
    while (remaining > 0) {
      const length = Math.min(buffer.length, remaining);
      const bytesRead = readSync(
        sourceDescriptor,
        buffer,
        0,
        length,
        sourcePosition,
      );
      if (bytesRead === 0) {
        throw new Error("Portable data payload ended unexpectedly");
      }
      let written = 0;
      while (written < bytesRead) {
        written += writeSync(
          destinationDescriptor,
          buffer,
          written,
          bytesRead - written,
          destinationPosition + written,
        );
      }
      sourcePosition += bytesRead;
      destinationPosition += bytesRead;
      remaining -= bytesRead;
    }
  } finally {
    closeSync(sourceDescriptor);
  }
}

function readExactly(
  descriptor: number,
  buffer: Buffer,
  position: number,
): void {
  let offset = 0;
  while (offset < buffer.length) {
    const bytesRead = readSync(
      descriptor,
      buffer,
      offset,
      buffer.length - offset,
      position + offset,
    );
    if (bytesRead === 0) {
      throw new Error("Portable data bundle ended unexpectedly");
    }
    offset += bytesRead;
  }
}

function sha256File(candidate: string): string {
  const digest = createHash("sha256");
  const descriptor = openSync(
    candidate,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let position = 0;
    for (;;) {
      const bytesRead = readSync(
        descriptor,
        buffer,
        0,
        buffer.length,
        position,
      );
      if (bytesRead === 0) break;
      digest.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
  } finally {
    closeSync(descriptor);
  }
  return digest.digest("hex");
}

function defaultPortableBundleName(now: Date): string {
  return `aptiloop-data-${now.toISOString().replaceAll(/[:.]/gu, "-")}${portableDataBundleExtension}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function assertExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): void {
  if (!hasExactKeys(value, expected)) {
    throw new Error("Portable data bundle manifest contains unknown fields");
  }
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

function isCanonicalIsoDate(value: string): boolean {
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.toISOString() === value;
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
}

function isMigrationIds(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= 1_000 &&
    value.every(
      (candidate) =>
        typeof candidate === "string" &&
        /^[0-9]{4}_[a-z0-9][a-z0-9_]{0,199}$/u.test(candidate),
    )
  );
}

function isSafeIntegerBetween(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= minimum &&
    value <= maximum
  );
}

function stringArraysEqual(
  value: unknown,
  expected: readonly string[],
): boolean {
  return (
    Array.isArray(value) &&
    value.length === expected.length &&
    value.every((entry, index) => entry === expected[index])
  );
}

function portableManifestsEqual(
  left: PortableDataBundleManifest,
  right: PortableDataBundleManifest,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function runChanges(result: { changes: number | bigint }): number {
  return typeof result.changes === "bigint"
    ? numberFromBigInt(result.changes, "SQLite change count")
    : result.changes;
}

function numberFromBigInt(value: bigint, label: string): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${label} is outside the supported range`);
  }
  return Number(value);
}

function fileIdentity(stats: BigIntStats) {
  return {
    device: stats.dev,
    inode: stats.ino,
    birthtimeNs: stats.birthtimeNs,
    size: stats.size,
    mtimeNs: stats.mtimeNs,
  };
}

function ownedArtifactFromDescriptor(
  artifactPath: string,
  descriptor: number,
): OwnedDatabaseArtifact {
  const stats = fstatSync(descriptor, { bigint: true });
  if (!stats.isFile()) {
    throw new Error("Portable data staging artifact is not a regular file");
  }
  return {
    path: artifactPath,
    device: stats.dev,
    inode: stats.ino,
    birthtimeNs: stats.birthtimeNs,
  };
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}

function assertSourceUnchanged(
  sourcePath: string,
  expected: ReturnType<typeof fileIdentity>,
): void {
  const stats = assertPortableSource(sourcePath);
  const observed = fileIdentity(stats);
  if (
    observed.device !== expected.device ||
    observed.inode !== expected.inode ||
    observed.birthtimeNs !== expected.birthtimeNs ||
    observed.size !== expected.size ||
    observed.mtimeNs !== expected.mtimeNs
  ) {
    throw new Error("Portable data source changed during restore");
  }
}
