import { existsSync, mkdirSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

import { openDatabase } from "./database.js";

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

export function inspectDatabase(path: string): DatabaseHealth {
  if (path === ":memory:")
    throw new Error("An in-memory database cannot be inspected as a file");
  const connection = openDatabase(resolve(path), {
    readonly: true,
    fileMustExist: true,
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

export function createDatabaseBackup(
  sourcePath: string,
  destinationPath: string,
): DatabaseBackupResult {
  if (sourcePath === ":memory:" || destinationPath === ":memory:") {
    throw new Error("SQLite file backup requires source and destination paths");
  }
  const source = resolve(sourcePath);
  const destination = resolve(destinationPath);
  if (source.toLowerCase() === destination.toLowerCase()) {
    throw new Error("Backup destination must differ from its source");
  }
  if (!existsSync(source))
    throw new Error(`SQLite database does not exist: ${source}`);
  if (existsSync(destination)) {
    throw new Error(`Refusing to replace an existing backup: ${destination}`);
  }

  const sourceHealth = inspectDatabase(source);
  assertHealthy(sourceHealth, "Source database");
  mkdirSync(dirname(destination), { recursive: true });
  const connection = openDatabase(source, {
    readonly: true,
    fileMustExist: true,
  });
  try {
    // VACUUM INTO is SQLite's consistent compact file-copy operation and includes
    // committed WAL state. Binding the path avoids executable SQL construction.
    connection.sqlite.prepare("VACUUM INTO ?").run(destination);
  } finally {
    connection.close();
  }
  const backupHealth = inspectDatabase(destination);
  assertHealthy(backupHealth, "Backup database");
  return {
    sourcePath: source,
    backupPath: destination,
    source: sourceHealth,
    backup: backupHealth,
  };
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
  return [...candidates].filter(existsSync);
}

export function createTimestampedDatabaseBackups(input: {
  sources: readonly string[];
  backupDirectory: string;
  now?: Date;
}): DatabaseBackupResult[] {
  const timestamp = (input.now ?? new Date())
    .toISOString()
    .replaceAll(/[:.]/g, "-");
  const backupDirectory = isAbsolute(input.backupDirectory)
    ? input.backupDirectory
    : resolve(input.backupDirectory);
  return input.sources.map((source, index) =>
    createDatabaseBackup(
      source,
      join(backupDirectory, `${timestamp}-${index + 1}-${randomUUID()}.sqlite`),
    ),
  );
}
