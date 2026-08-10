import { randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  ftruncateSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readSync,
  realpathSync,
  rmdirSync,
  unlinkSync,
  writeSync,
  type BigIntStats,
} from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { DatabaseSync, backup as sqliteBackup } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { openDatabase } from "./database.js";

const backupSidecarSuffixes = ["-wal", "-shm", "-journal"] as const;

export interface DatabaseHealth {
  integrity: string[];
  foreignKeyViolations: Array<Record<string, unknown>>;
}

export interface DatabaseBackupResult {
  sourcePath: string;
  backupPath: string;
  source: DatabaseHealth;
  backup: DatabaseHealth;
}

export interface OwnedDatabaseArtifact {
  readonly path: string;
  readonly device: bigint;
  readonly inode: bigint;
  readonly birthtimeNs: bigint;
}

interface OwnedDirectoryArtifact {
  readonly path: string;
  readonly device: bigint;
  readonly inode: bigint;
  readonly birthtimeNs: bigint;
}

export type DatabaseBackupCheckpoint =
  | "before-source-inspection"
  | "before-destination-create"
  | "after-destination-create"
  | "before-copy"
  | "before-sidecar-cleanup"
  | "after-copy"
  | "before-backup-inspection"
  | "after-backup-inspection";

export interface ExclusiveDatabaseBackupOptions {
  readonly checkpoint?: (
    checkpoint: DatabaseBackupCheckpoint,
    stagedDatabasePath?: string,
  ) => void;
}

export interface ExclusiveDatabaseBackupResult extends DatabaseBackupResult {
  readonly ownedArtifact: OwnedDatabaseArtifact;
}

export function resolveDatabaseProjectRoot(
  databaseModuleUrl: string,
  configuredRoot?: string,
): string {
  return configuredRoot
    ? resolve(configuredRoot)
    : fileURLToPath(new URL("../../../", databaseModuleUrl));
}

export function inspectDatabase(path: string): DatabaseHealth {
  if (path === ":memory:")
    throw new Error("An in-memory database cannot be inspected as a file");
  const resolvedPath = resolve(path);
  assertRollbackJournalAbsent(resolvedPath, "Inspected database");
  const connection = openDatabase(resolvedPath, {
    readonly: true,
    fileMustExist: true,
    beforeOpen: () =>
      assertRollbackJournalAbsent(resolvedPath, "Inspected database"),
  });
  try {
    const integrityRows = connection.sqlite
      .prepare("PRAGMA integrity_check")
      .all() as Array<Record<string, unknown>>;
    const integrity = integrityRows.map((row) => String(Object.values(row)[0]));
    const foreignKeyViolations = connection.sqlite
      .prepare("PRAGMA foreign_key_check")
      .all() as Array<Record<string, unknown>>;
    return { integrity, foreignKeyViolations };
  } finally {
    connection.close();
  }
}

function assertHealthy(health: DatabaseHealth, label: string): void {
  if (
    health.integrity.length !== 1 ||
    health.integrity[0]?.toLowerCase() !== "ok"
  ) {
    throw new Error(
      `${label} failed SQLite integrity_check: ${health.integrity.join("; ")}`,
    );
  }
  if (health.foreignKeyViolations.length) {
    throw new Error(
      `${label} failed SQLite foreign_key_check with ${health.foreignKeyViolations.length} violation(s)`,
    );
  }
}

export async function createExclusiveDatabaseBackup(
  sourcePath: string,
  destinationPath: string,
  options: ExclusiveDatabaseBackupOptions = {},
): Promise<ExclusiveDatabaseBackupResult> {
  if (sourcePath === ":memory:" || destinationPath === ":memory:") {
    throw new Error("SQLite file backup requires source and destination paths");
  }
  const source = resolve(sourcePath);
  const destination = resolve(destinationPath);
  if (pathKey(source) === pathKey(destination)) {
    throw new Error("Backup destination must differ from its source");
  }

  options.checkpoint?.("before-source-inspection");
  assertRealRegularFile(source, "Source database");
  const sourceHealth = inspectDatabase(source);
  assertHealthy(sourceHealth, "Source database");
  options.checkpoint?.("before-destination-create");
  mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });

  let ownedArtifact: OwnedDatabaseArtifact | undefined;
  let stagingDirectory: OwnedDirectoryArtifact | undefined;
  let stagedArtifact: OwnedDatabaseArtifact | undefined;
  let generatedJournal: OwnedDatabaseArtifact | undefined;
  try {
    ownedArtifact = reserveDatabaseArtifact(destination);
    options.checkpoint?.("after-destination-create");
    assertOwnedDatabaseArtifact(ownedArtifact);
    assertNoExistingBackupSidecars(destination);

    stagingDirectory = reserveOwnedStagingDirectory(dirname(destination));
    const stagedDatabasePath = join(stagingDirectory.path, "backup.sqlite");
    stagedArtifact = reserveDatabaseArtifact(stagedDatabasePath);
    const connection = openDatabase(source, {
      readonly: true,
      fileMustExist: true,
      beforeOpen: () => assertRollbackJournalAbsent(source, "Source database"),
    });
    try {
      options.checkpoint?.("before-copy");
      assertNoExistingBackupSidecars(destination);
      assertOwnedDirectoryArtifact(stagingDirectory);
      await sqliteBackup(connection.sqlite, stagedDatabasePath);
    } finally {
      connection.close();
    }

    generatedJournal = captureGeneratedBackupJournal(
      stagedDatabasePath,
      stagingDirectory,
    );
    options.checkpoint?.("before-sidecar-cleanup", stagedDatabasePath);
    removeCapturedBackupJournal(generatedJournal);
    generatedJournal = undefined;
    assertNoExistingBackupSidecars(stagedDatabasePath);
    normalizeOwnedBackupJournalMode(stagedArtifact);
    generatedJournal = captureGeneratedBackupJournal(
      stagedDatabasePath,
      stagingDirectory,
    );
    removeCapturedBackupJournal(generatedJournal);
    generatedJournal = undefined;
    assertNoExistingBackupSidecars(stagedDatabasePath);
    copyOwnedDatabaseBytes(stagedArtifact, ownedArtifact);
    assertNoExistingBackupSidecars(destination);

    options.checkpoint?.("after-copy");
    assertOwnedDatabaseArtifact(ownedArtifact);
    options.checkpoint?.("before-backup-inspection");
    const backupHealth = inspectDatabase(destination);
    assertHealthy(backupHealth, "Backup database");
    assertOwnedDatabaseArtifact(ownedArtifact);
    options.checkpoint?.("after-backup-inspection");
    cleanupOwnedStagingArtifacts(stagedArtifact, stagingDirectory);
    stagedArtifact = undefined;
    stagingDirectory = undefined;
    return {
      sourcePath: source,
      backupPath: destination,
      source: sourceHealth,
      backup: backupHealth,
      ownedArtifact,
    };
  } catch (error) {
    if (generatedJournal) removeOwnedDatabaseArtifact(generatedJournal);
    if (stagedArtifact) removeOwnedDatabaseArtifact(stagedArtifact);
    if (stagingDirectory) removeOwnedDirectoryIfEmpty(stagingDirectory);
    if (ownedArtifact) removeOwnedDatabaseArtifact(ownedArtifact);
    throw error;
  }
}

export async function createDatabaseBackup(
  sourcePath: string,
  destinationPath: string,
): Promise<DatabaseBackupResult> {
  const result = await createExclusiveDatabaseBackup(
    sourcePath,
    destinationPath,
  );
  return {
    sourcePath: result.sourcePath,
    backupPath: result.backupPath,
    source: result.source,
    backup: result.backup,
  };
}

export function assertOwnedDatabaseArtifact(
  artifact: OwnedDatabaseArtifact,
): void {
  const stats = lstatOwnedFile(artifact.path);
  if (
    stats.dev !== artifact.device ||
    stats.ino !== artifact.inode ||
    stats.birthtimeNs !== artifact.birthtimeNs
  ) {
    throw new Error("Exclusive backup artifact identity changed unexpectedly");
  }
}

/** Removes only the exact file created by this process, never a replacement. */
export function removeOwnedDatabaseArtifact(
  artifact: OwnedDatabaseArtifact,
): boolean {
  let stats: BigIntStats;
  try {
    stats = lstatSync(artifact.path, { bigint: true });
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return true;
    return false;
  }
  if (stats.isSymbolicLink() || !stats.isFile()) return false;
  if (
    stats.dev !== artifact.device ||
    stats.ino !== artifact.inode ||
    stats.birthtimeNs !== artifact.birthtimeNs
  ) {
    return false;
  }
  try {
    unlinkSync(artifact.path);
    return true;
  } catch {
    return false;
  }
}

export function discoverDatabaseCandidates(
  cwd: string,
  configuredPath?: string,
): string[] {
  const candidates = new Set<string>();
  if (configuredPath && configuredPath !== ":memory:") {
    candidates.add(resolve(cwd, configuredPath.replace(/^file:/, "")));
  }
  candidates.add(resolve(cwd, ".data/dev-learning-harness.sqlite"));
  candidates.add(resolve(cwd, "data/dev-learning-harness.sqlite"));
  return [...candidates].filter((candidate) => {
    try {
      return lstatSync(candidate).isFile();
    } catch {
      return false;
    }
  });
}

export async function createTimestampedDatabaseBackups(input: {
  sources: readonly string[];
  backupDirectory: string;
  now?: Date;
}): Promise<DatabaseBackupResult[]> {
  const timestamp = (input.now ?? new Date())
    .toISOString()
    .replaceAll(/[:.]/g, "-");
  const backupDirectory = isAbsolute(input.backupDirectory)
    ? input.backupDirectory
    : resolve(input.backupDirectory);
  return Promise.all(
    input.sources.map((source, index) =>
      createDatabaseBackup(
        source,
        join(
          backupDirectory,
          `${timestamp}-${index + 1}-${randomUUID()}.sqlite`,
        ),
      ),
    ),
  );
}

function reserveDatabaseArtifact(path: string): OwnedDatabaseArtifact {
  let descriptor: number | undefined;
  let artifact: OwnedDatabaseArtifact | undefined;
  try {
    descriptor = openSync(
      path,
      constants.O_CREAT |
        constants.O_EXCL |
        constants.O_RDWR |
        constants.O_NOFOLLOW,
      0o600,
    );
    const stats = fstatSync(descriptor, { bigint: true });
    artifact = {
      path,
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
      throw new Error(`Refusing to replace an existing backup: ${path}`, {
        cause: error,
      });
    }
    throw error;
  }
}

function reserveOwnedStagingDirectory(
  parentPath: string,
): OwnedDirectoryArtifact {
  const directoryPath = mkdtempSync(
    join(parentPath, ".aptiloop-backup-stage-"),
  );
  try {
    chmodSync(directoryPath, 0o700);
    const stats = lstatSync(directoryPath, { bigint: true });
    if (
      stats.isSymbolicLink() ||
      !stats.isDirectory() ||
      pathKey(realpathSync.native(directoryPath)) !==
        pathKey(resolve(directoryPath))
    ) {
      throw new Error("Backup staging directory is not a real directory");
    }
    return {
      path: directoryPath,
      device: stats.dev,
      inode: stats.ino,
      birthtimeNs: stats.birthtimeNs,
    };
  } catch (error) {
    try {
      rmdirSync(directoryPath);
    } catch {
      // Preserve unexpected contents rather than deleting an unowned entry.
    }
    throw error;
  }
}

function assertOwnedDirectoryArtifact(artifact: OwnedDirectoryArtifact): void {
  const stats = lstatSync(artifact.path, { bigint: true });
  if (
    stats.isSymbolicLink() ||
    !stats.isDirectory() ||
    stats.dev !== artifact.device ||
    stats.ino !== artifact.inode ||
    stats.birthtimeNs !== artifact.birthtimeNs ||
    pathKey(realpathSync.native(artifact.path)) !==
      pathKey(resolve(artifact.path))
  ) {
    throw new Error("Exclusive backup staging directory identity changed");
  }
}

function removeOwnedDirectoryIfEmpty(
  artifact: OwnedDirectoryArtifact,
): boolean {
  try {
    assertOwnedDirectoryArtifact(artifact);
    rmdirSync(artifact.path);
    return true;
  } catch {
    return false;
  }
}

function cleanupOwnedStagingArtifacts(
  artifact: OwnedDatabaseArtifact,
  directory: OwnedDirectoryArtifact,
): void {
  if (!removeOwnedDatabaseArtifact(artifact)) {
    throw new Error(
      "Owned backup staging artifact could not be removed safely",
    );
  }
  if (!removeOwnedDirectoryIfEmpty(directory)) {
    throw new Error(
      "Owned backup staging directory could not be removed safely",
    );
  }
}

function copyOwnedDatabaseBytes(
  source: OwnedDatabaseArtifact,
  destination: OwnedDatabaseArtifact,
): void {
  assertOwnedDatabaseArtifact(source);
  assertOwnedDatabaseArtifact(destination);
  let sourceDescriptor: number | undefined;
  let destinationDescriptor: number | undefined;
  try {
    sourceDescriptor = openSync(
      source.path,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    destinationDescriptor = openSync(
      destination.path,
      constants.O_WRONLY | constants.O_NOFOLLOW,
    );
    assertDescriptorIdentity(sourceDescriptor, source);
    assertDescriptorIdentity(destinationDescriptor, destination);
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
    assertDescriptorIdentity(sourceDescriptor, source);
    assertDescriptorIdentity(destinationDescriptor, destination);
  } finally {
    if (sourceDescriptor !== undefined) closeSync(sourceDescriptor);
    if (destinationDescriptor !== undefined) closeSync(destinationDescriptor);
  }
  assertOwnedDatabaseArtifact(source);
  assertOwnedDatabaseArtifact(destination);
}

function assertDescriptorIdentity(
  descriptor: number,
  artifact: OwnedDatabaseArtifact,
): void {
  const stats = fstatSync(descriptor, { bigint: true });
  if (
    !stats.isFile() ||
    stats.dev !== artifact.device ||
    stats.ino !== artifact.inode ||
    stats.birthtimeNs !== artifact.birthtimeNs
  ) {
    throw new Error("Exclusive backup artifact descriptor identity changed");
  }
}

function assertRealRegularFile(candidate: string, label: string): void {
  let stats: BigIntStats;
  try {
    stats = lstatSync(candidate, { bigint: true });
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      throw new Error(`${label} does not exist`, { cause: error });
    }
    throw new Error(`${label} cannot be safely inspected`, { cause: error });
  }
  if (
    stats.isSymbolicLink() ||
    !stats.isFile() ||
    !hasCanonicalLeaf(candidate)
  ) {
    throw new Error(`${label} must be a real regular file`);
  }
}

function lstatOwnedFile(candidate: string): BigIntStats {
  const stats = lstatSync(candidate, { bigint: true });
  if (
    stats.isSymbolicLink() ||
    !stats.isFile() ||
    !hasCanonicalLeaf(candidate)
  ) {
    throw new Error("Exclusive backup artifact is not a real regular file");
  }
  return stats;
}

function hasCanonicalLeaf(candidate: string): boolean {
  const resolved = resolve(candidate);
  const canonicalParent = realpathSync.native(dirname(resolved));
  const expectedCanonicalPath = join(canonicalParent, basename(resolved));
  return (
    pathKey(realpathSync.native(resolved)) === pathKey(expectedCanonicalPath)
  );
}

function normalizeOwnedBackupJournalMode(
  artifact: OwnedDatabaseArtifact,
): void {
  assertOwnedDatabaseArtifact(artifact);
  assertRollbackJournalAbsent(artifact.path, "Backup staging database");
  const sqlite = new DatabaseSync(artifact.path, {
    readOnly: false,
    enableForeignKeyConstraints: false,
    enableDoubleQuotedStringLiterals: false,
    allowExtension: false,
    timeout: 5_000,
  });
  try {
    assertOwnedDatabaseArtifact(artifact);
    const result = sqlite.prepare("PRAGMA journal_mode = DELETE").get() as
      Record<string, unknown> | undefined;
    if (result?.journal_mode !== "delete") {
      throw new Error("Backup journal mode could not be made standalone");
    }
    assertOwnedDatabaseArtifact(artifact);
  } finally {
    sqlite.close();
  }
  assertOwnedDatabaseArtifact(artifact);
}

function assertRollbackJournalAbsent(
  databasePath: string,
  label: string,
): void {
  try {
    lstatSync(`${databasePath}-journal`);
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return;
    throw new Error(`${label} rollback journal cannot be safely inspected`, {
      cause: error,
    });
  }
  throw new Error(
    `${label} rollback journal must be absent before SQLite open`,
  );
}

function assertNoExistingBackupSidecars(databasePath: string): void {
  for (const suffix of backupSidecarSuffixes) {
    try {
      lstatSync(`${databasePath}${suffix}`);
    } catch (error) {
      if (hasErrorCode(error, "ENOENT")) continue;
      throw new Error("Temporary backup sidecars cannot be safely inspected", {
        cause: error,
      });
    }
    throw new Error("Temporary backup sidecars must not pre-exist or remain");
  }
}

function captureGeneratedBackupJournal(
  databasePath: string,
  stagingDirectory: OwnedDirectoryArtifact,
): OwnedDatabaseArtifact | undefined {
  assertOwnedDirectoryArtifact(stagingDirectory);
  const journalPath = `${databasePath}-journal`;
  if (pathKey(dirname(journalPath)) !== pathKey(stagingDirectory.path)) {
    throw new Error(
      "Generated SQLite journal escaped its owned staging directory",
    );
  }
  let stats: BigIntStats;
  try {
    stats = lstatSync(journalPath, { bigint: true });
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return undefined;
    throw new Error("Generated SQLite journal cannot be safely inspected", {
      cause: error,
    });
  }
  if (
    stats.isSymbolicLink() ||
    !stats.isFile() ||
    !hasCanonicalLeaf(journalPath)
  ) {
    throw new Error("Generated SQLite journal is not a real regular file");
  }
  return {
    path: journalPath,
    device: stats.dev,
    inode: stats.ino,
    birthtimeNs: stats.birthtimeNs,
  };
}

function removeCapturedBackupJournal(
  journalArtifact: OwnedDatabaseArtifact | undefined,
): void {
  if (
    journalArtifact !== undefined &&
    !removeOwnedDatabaseArtifact(journalArtifact)
  ) {
    throw new Error("Generated SQLite journal identity changed before cleanup");
  }
}

function pathKey(candidate: string): string {
  return process.platform === "win32" ? candidate.toLowerCase() : candidate;
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}
