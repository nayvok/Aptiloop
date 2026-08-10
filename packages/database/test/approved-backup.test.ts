import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it, type TestContext } from "vitest";

import { createApprovedM1Backup } from "../src/approved-backup.js";
import {
  getCurrentDatabaseMigrationContract,
  migrateDatabase,
  openDatabase,
} from "../src/database.js";
import { createLearningRepository } from "../src/repository.js";
import { seedDatabase } from "../src/seed.js";
import { inventoryPrivateData } from "../src/private-data-inventory.js";

const roots: string[] = [];

function temporaryRoot(prefix: string): string {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

function createCleanDatabase(databasePath: string): void {
  const connection = openDatabase(databasePath);
  try {
    migrateDatabase(connection);
  } finally {
    connection.close();
  }
}

function createCleanProject(): {
  projectRoot: string;
  source: string;
  approvedDirectory: string;
} {
  const projectRoot = temporaryRoot("aptiloop-approved-backup-");
  const source = path.join(projectRoot, ".data", "dev-learning-harness.sqlite");
  createCleanDatabase(source);
  return {
    projectRoot,
    source,
    approvedDirectory: path.join(projectRoot, ".data", "approved-backups"),
  };
}

async function createCoherentCurrentSession(
  databasePath: string,
): Promise<void> {
  const connection = openDatabase(databasePath);
  let nextId = 0;
  try {
    seedDatabase(connection, undefined, 1_000);
    const day = connection.sqlite
      .prepare(
        `SELECT days.id
         FROM curriculum_days_v2 AS days
         JOIN curriculum_versions AS versions ON versions.id = days.version_id
         JOIN curricula ON curricula.id = versions.curriculum_id
         WHERE versions.status = 'published'
           AND curricula.active_version_id = versions.id
         ORDER BY versions.revision DESC, days.order_index, days.id
         LIMIT 1`,
      )
      .get() as { id?: unknown } | undefined;
    if (typeof day?.id !== "string") {
      throw new Error("Current-session fixture requires a published day");
    }
    const repository = createLearningRepository(connection, {
      id: () => `approved-backup-fixture-${++nextId}`,
      now: () => 2_000,
    });
    await repository.startOrResumeVersionedSession({ dayId: day.id });
  } finally {
    connection.close();
  }
}

function hashFile(candidate: string): string {
  return createHash("sha256").update(readFileSync(candidate)).digest("hex");
}

function logicalDatabaseState(candidate: string): string {
  const inventory = inventoryPrivateData({ databasePaths: [candidate] });
  const inspected = inventory.candidates[0];
  if (!inspected?.health.opened) {
    throw new Error("Database inventory candidate is not healthy");
  }
  return inspected.health.logicalSha256;
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

function pendingArtifacts(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory).filter(
    (entry) =>
      entry.startsWith(".aptiloop-pending-") ||
      entry.startsWith(".aptiloop-backup-stage-"),
  );
}

afterEach(() => {
  while (roots.length) {
    const root = roots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

describe("approved M1 backup", () => {
  it("promotes only an inventoried clean snapshot", async () => {
    const { projectRoot, source, approvedDirectory } = createCleanProject();
    const destination = path.join(approvedDirectory, "clean.sqlite");

    const result = await createApprovedM1Backup({
      projectRoot,
      sourcePath: source,
      destinationPath: destination,
    });

    expect(result.backupPath).toBe(destination);
    expect(existsSync(destination)).toBe(true);
    expect(lstatSync(destination, { bigint: true }).nlink).toBe(1n);
    expect(pendingArtifacts(approvedDirectory)).toEqual([]);
    for (const suffix of ["-wal", "-shm", "-journal"]) {
      expect(existsSync(`${destination}${suffix}`)).toBe(false);
    }
    const inventory = inventoryPrivateData({ databasePaths: [destination] });
    const candidate = inventory.candidates[0];
    expect(candidate?.sourceStable).toBe(true);
    expect(candidate?.health.opened).toBe(true);
    if (!candidate?.health.opened) {
      throw new Error("Approved backup could not be inventoried");
    }
    expect(candidate.health.agentMessages).toMatchObject({
      schemaCompatible: true,
      nonEmptyToolEventRows: 0,
      invalidToolEventRows: 0,
      invalidRawEventRows: 0,
      rawEventRows: 0,
    });
    expect(candidate.health.reviews).toMatchObject({
      schemaCompatible: true,
      rawResponseRows: 0,
    });
  });

  it("promotes a current-contract source with a coherent active session", async () => {
    const { projectRoot, source, approvedDirectory } = createCleanProject();
    const destination = path.join(approvedDirectory, "current-session.sqlite");
    await createCoherentCurrentSession(source);

    await expect(
      createApprovedM1Backup({
        projectRoot,
        sourcePath: source,
        destinationPath: destination,
      }),
    ).resolves.toMatchObject({ backupPath: destination });

    expect(existsSync(destination)).toBe(true);
    expect(pendingArtifacts(approvedDirectory)).toEqual([]);
  });

  it("rejects a current-contract active session with a mismatched learner pointer before promotion", async () => {
    const { projectRoot, source, approvedDirectory } = createCleanProject();
    const destination = path.join(approvedDirectory, "pointer-mismatch.sqlite");
    await createCoherentCurrentSession(source);
    const sqlite = new DatabaseSync(source, {
      allowExtension: false,
      enableForeignKeyConstraints: false,
    });
    try {
      sqlite
        .prepare(
          `UPDATE learner_state
           SET current_learning_session_id = NULL, updated_at = 3_000
           WHERE id = 'default'`,
        )
        .run();
    } finally {
      sqlite.close();
    }

    const contract = getCurrentDatabaseMigrationContract();
    const inventory = inventoryPrivateData({ databasePaths: [source] });
    const candidate = inventory.candidates[0];
    expect(candidate?.health.opened).toBe(true);
    if (!candidate?.health.opened) {
      throw new Error("Current-contract fixture could not be inventoried");
    }
    expect(candidate.health.integrityOk).toBe(true);
    expect(candidate.health.foreignKeyViolationCount).toBe(0);
    expect(candidate.health.migrations.ids).toEqual(contract.migrationIds);
    expect(candidate.health.schemaSha256).toBe(contract.schemaSha256);
    expect(candidate.health.legacyCompatibility).toMatchObject({
      coherent: false,
      activeSessionCount: 1,
      nonLegacyActiveSessionCount: 1,
    });

    await expect(
      createApprovedM1Backup({
        projectRoot,
        sourcePath: source,
        destinationPath: destination,
      }),
    ).rejects.toThrow(
      "Existing writable database matches neither approved exact migration contract",
    );

    expect(existsSync(destination)).toBe(false);
    expect(pendingArtifacts(approvedDirectory)).toEqual([]);
  });

  it("rejects but never removes a sidecar introduced before copying", async () => {
    const { projectRoot, source, approvedDirectory } = createCleanProject();
    const destination = path.join(approvedDirectory, "blocked.sqlite");
    const attackerBytes = Buffer.from("attacker-owned-sidecar", "utf8");
    let sidecarPath: string | undefined;

    await expect(
      createApprovedM1Backup({
        projectRoot,
        sourcePath: source,
        destinationPath: destination,
        testHooks: {
          beforeCopy: (temporaryPath) => {
            sidecarPath = `${temporaryPath}-journal`;
            writeFileSync(sidecarPath, attackerBytes, { flag: "wx" });
          },
        },
      }),
    ).rejects.toThrow(/sidecar/iu);

    if (!sidecarPath) throw new Error("The pre-copy hook did not run");
    expect(readFileSync(sidecarPath)).toEqual(attackerBytes);
    expect(existsSync(sidecarPath.slice(0, -"-journal".length))).toBe(false);
    expect(existsSync(destination)).toBe(false);
  });

  for (const hookThrows of [false, true]) {
    it(`preserves a journal planted after SQLite close on the ${
      hookThrows ? "catch" : "success"
    } cleanup path`, async () => {
      const { projectRoot, source, approvedDirectory } = createCleanProject();
      const destination = path.join(
        approvedDirectory,
        hookThrows ? "journal-catch.sqlite" : "journal-success.sqlite",
      );
      const sourceBefore = hashFile(source);
      const attackerBytes = Buffer.from("attacker-owned-late-journal", "utf8");
      let plantedJournal: string | undefined;

      await expect(
        createApprovedM1Backup({
          projectRoot,
          sourcePath: source,
          destinationPath: destination,
          testHooks: {
            beforeSidecarCleanup: (stagedDatabasePath) => {
              plantedJournal = `${stagedDatabasePath}-journal`;
              if (existsSync(plantedJournal)) {
                renameSync(plantedJournal, `${plantedJournal}.sqlite-owned`);
              }
              writeFileSync(plantedJournal, attackerBytes, { flag: "wx" });
              if (hookThrows) throw new Error("forced checkpoint failure");
            },
          },
        }),
      ).rejects.toThrow(
        hookThrows ? "forced checkpoint failure" : /sidecar|identity/iu,
      );

      if (!plantedJournal)
        throw new Error("The sidecar cleanup hook did not run");
      expect(readFileSync(plantedJournal)).toEqual(attackerBytes);
      expect(hashFile(source)).toBe(sourceBefore);
      expect(existsSync(destination)).toBe(false);
    });
  }

  it("never promotes a transient source state restored after copying", async () => {
    const { projectRoot, source, approvedDirectory } = createCleanProject();
    const destination = path.join(approvedDirectory, "transient.sqlite");
    const sourceIdentity = lstatSync(source, { bigint: true });
    const approvedState = logicalDatabaseState(source);
    const probe = new DatabaseSync(source, {
      allowExtension: false,
      enableForeignKeyConstraints: false,
    });
    const current = probe.prepare("PRAGMA user_version").get() as
      { user_version?: unknown } | undefined;
    probe.close();
    const approvedVersion = Number(current?.user_version);
    const transientVersion = approvedVersion === 1 ? 2 : 1;
    const setUserVersion = (value: number) => {
      const sqlite = new DatabaseSync(source, {
        allowExtension: false,
        enableForeignKeyConstraints: false,
      });
      try {
        sqlite.exec(`PRAGMA user_version = ${value}`);
      } finally {
        sqlite.close();
      }
    };

    await expect(
      createApprovedM1Backup({
        projectRoot,
        sourcePath: source,
        destinationPath: destination,
        testHooks: {
          beforeCopy: () => setUserVersion(transientVersion),
          afterCopy: () => setUserVersion(approvedVersion),
        },
      }),
    ).rejects.toThrow("does not match the approved source snapshot");

    const finalIdentity = lstatSync(source, { bigint: true });
    expect(finalIdentity.dev).toBe(sourceIdentity.dev);
    expect(finalIdentity.ino).toBe(sourceIdentity.ino);
    expect(logicalDatabaseState(source)).toBe(approvedState);
    expect(existsSync(destination)).toBe(false);
    expect(pendingArtifacts(approvedDirectory)).toEqual([]);
  });

  it("removes the temporary copy when raw payload appears after copying", async () => {
    const { projectRoot, source, approvedDirectory } = createCleanProject();
    const destination = path.join(approvedDirectory, "mutated.sqlite");

    await expect(
      createApprovedM1Backup({
        projectRoot,
        sourcePath: source,
        destinationPath: destination,
        testHooks: {
          afterCopy: () => {
            const sqlite = new DatabaseSync(source, {
              allowExtension: false,
              enableForeignKeyConstraints: false,
            });
            try {
              sqlite
                .prepare(
                  `INSERT INTO agent_messages (
                   id, conversation_id, role, content, tool_events_json,
                   raw_event_json, status, sequence, created_at
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                )
                .run(
                  "message-after-copy",
                  "missing-conversation",
                  "assistant",
                  "private",
                  "[]",
                  '{"secret":"must-not-approve"}',
                  "completed",
                  1,
                  1,
                );
            } finally {
              sqlite.close();
            }
          },
        },
      }),
    ).rejects.toThrow(/failed the read-only health|changed while/u);

    expect(existsSync(destination)).toBe(false);
    expect(pendingArtifacts(approvedDirectory)).toEqual([]);
  });

  it("rejects a source file replacement after copying", async () => {
    const { projectRoot, source, approvedDirectory } = createCleanProject();
    const replacementRoot = temporaryRoot("aptiloop-replacement-source-");
    const replacement = path.join(replacementRoot, "replacement.sqlite");
    const displaced = path.join(projectRoot, ".data", "displaced.sqlite");
    const destination = path.join(approvedDirectory, "replaced.sqlite");
    createCleanDatabase(replacement);

    await expect(
      createApprovedM1Backup({
        projectRoot,
        sourcePath: source,
        destinationPath: destination,
        testHooks: {
          afterCopy: () => {
            renameSync(source, displaced);
            renameSync(replacement, source);
          },
        },
      }),
    ).rejects.toThrow("identity changed during approved backup");

    expect(existsSync(destination)).toBe(false);
    expect(pendingArtifacts(approvedDirectory)).toEqual([]);
  });

  it("rejects a persisted logical content change before promotion", async () => {
    const { projectRoot, source, approvedDirectory } = createCleanProject();
    const destination = path.join(approvedDirectory, "changed.sqlite");
    const before = logicalDatabaseState(source);

    await expect(
      createApprovedM1Backup({
        projectRoot,
        sourcePath: source,
        destinationPath: destination,
        testHooks: {
          beforePromotion: () => {
            const sqlite = new DatabaseSync(source, {
              allowExtension: false,
              enableForeignKeyConstraints: false,
            });
            try {
              const current = sqlite.prepare("PRAGMA user_version").get() as
                { user_version?: unknown } | undefined;
              const next = Number(current?.user_version) === 1 ? 2 : 1;
              sqlite.exec(`PRAGMA user_version = ${next}`);
            } finally {
              sqlite.close();
            }
          },
        },
      }),
    ).rejects.toThrow("Active database changed before backup promotion");

    expect(logicalDatabaseState(source)).not.toBe(before);
    expect(existsSync(destination)).toBe(false);
    expect(pendingArtifacts(approvedDirectory)).toEqual([]);
  });

  it("does not overwrite a target that appears before promotion", async () => {
    const { projectRoot, source, approvedDirectory } = createCleanProject();
    const destination = path.join(approvedDirectory, "appeared.sqlite");
    const preexisting = Buffer.from("pre-existing target", "utf8");

    await expect(
      createApprovedM1Backup({
        projectRoot,
        sourcePath: source,
        destinationPath: destination,
        testHooks: {
          beforePromotion: () => {
            writeFileSync(destination, preexisting, { flag: "wx" });
          },
        },
      }),
    ).rejects.toThrow("Refusing to replace an existing backup");

    expect(readFileSync(destination)).toEqual(preexisting);
    expect(pendingArtifacts(approvedDirectory)).toEqual([]);
  });

  it("rejects in-place content mutation after the promotion link", async () => {
    const { projectRoot, source, approvedDirectory } = createCleanProject();
    const destination = path.join(approvedDirectory, "mutated-link.sqlite");
    const sourceBefore = hashFile(source);
    let preservedOwnedLink = false;

    await expect(
      createApprovedM1Backup({
        projectRoot,
        sourcePath: source,
        destinationPath: destination,
        testHooks: {
          afterPromotionLink: (_temporaryPath, destinationPath) => {
            const before = lstatSync(destinationPath, { bigint: true });
            const mutated = readFileSync(destinationPath);
            mutated[0] = (mutated[0] ?? 0) ^ 0xff;
            writeFileSync(destinationPath, mutated, { flag: "r+" });
            const after = lstatSync(destinationPath, { bigint: true });
            preservedOwnedLink =
              before.dev === after.dev &&
              before.ino === after.ino &&
              before.birthtimeNs === after.birthtimeNs &&
              before.nlink === 2n &&
              after.nlink === 2n &&
              before.size === after.size;
          },
        },
      }),
    ).rejects.toThrow(
      "Promoted backup content or metadata changed after publication",
    );

    expect(preservedOwnedLink).toBe(true);
    expect(hashFile(source)).toBe(sourceBefore);
    expect(existsSync(destination)).toBe(false);
    expect(pendingArtifacts(approvedDirectory)).toEqual([]);
  });

  it("rejects in-place truncation after the promotion link", async () => {
    const { projectRoot, source, approvedDirectory } = createCleanProject();
    const destination = path.join(approvedDirectory, "truncated-link.sqlite");
    const sourceBefore = hashFile(source);
    let preservedOwnedLink = false;

    await expect(
      createApprovedM1Backup({
        projectRoot,
        sourcePath: source,
        destinationPath: destination,
        testHooks: {
          afterPromotionLink: (_temporaryPath, destinationPath) => {
            const before = lstatSync(destinationPath, { bigint: true });
            truncateSync(destinationPath, Number(before.size / 2n));
            const after = lstatSync(destinationPath, { bigint: true });
            preservedOwnedLink =
              before.dev === after.dev &&
              before.ino === after.ino &&
              before.birthtimeNs === after.birthtimeNs &&
              before.nlink === 2n &&
              after.nlink === 2n &&
              after.size < before.size;
          },
        },
      }),
    ).rejects.toThrow(
      "Promoted backup content or metadata changed after publication",
    );

    expect(preservedOwnedLink).toBe(true);
    expect(hashFile(source)).toBe(sourceBefore);
    expect(existsSync(destination)).toBe(false);
    expect(pendingArtifacts(approvedDirectory)).toEqual([]);
  });

  it("rejects a promotion alias created inside the hard-link window", async () => {
    const { projectRoot, source, approvedDirectory } = createCleanProject();
    const destination = path.join(approvedDirectory, "raced.sqlite");
    const aliasRoot = temporaryRoot("aptiloop-promotion-alias-");
    const alias = path.join(aliasRoot, "raced-alias.sqlite");

    await expect(
      createApprovedM1Backup({
        projectRoot,
        sourcePath: source,
        destinationPath: destination,
        testHooks: {
          afterPromotionLink: (_temporaryPath, destinationPath) => {
            linkSync(destinationPath, alias);
          },
        },
      }),
    ).rejects.toThrow("hard-link promotion identity changed");

    expect(existsSync(destination)).toBe(false);
    expect(existsSync(alias)).toBe(true);
    expect(lstatSync(alias, { bigint: true }).nlink).toBe(1n);
    expect(pendingArtifacts(approvedDirectory)).toEqual([]);
  });

  it("rejects a linked active file without changing the external database", async (context) => {
    const projectRoot = temporaryRoot("aptiloop-linked-active-");
    const externalRoot = temporaryRoot("aptiloop-external-active-");
    const dataDirectory = path.join(projectRoot, ".data");
    const externalDatabase = path.join(externalRoot, "external.sqlite");
    const source = path.join(dataDirectory, "dev-learning-harness.sqlite");
    mkdirSync(dataDirectory);
    createCleanDatabase(externalDatabase);
    const before = hashFile(externalDatabase);
    if (!tryCreateLink(context, externalDatabase, source, "file")) return;

    await expect(
      createApprovedM1Backup({
        projectRoot,
        sourcePath: source,
        destinationPath: path.join(
          dataDirectory,
          "approved-backups",
          "linked-source.sqlite",
        ),
      }),
    ).rejects.toThrow(/symbolic link|reparse point/u);

    expect(hashFile(externalDatabase)).toBe(before);
  });

  it("rejects a linked data ancestor without changing the external database", async (context) => {
    const projectRoot = temporaryRoot("aptiloop-linked-data-");
    const externalData = temporaryRoot("aptiloop-external-data-");
    const externalDatabase = path.join(
      externalData,
      "dev-learning-harness.sqlite",
    );
    createCleanDatabase(externalDatabase);
    const before = hashFile(externalDatabase);
    if (
      !tryCreateLink(
        context,
        externalData,
        path.join(projectRoot, ".data"),
        "directory",
      )
    ) {
      return;
    }

    await expect(
      createApprovedM1Backup({
        projectRoot,
        sourcePath: path.join(
          projectRoot,
          ".data",
          "dev-learning-harness.sqlite",
        ),
        destinationPath: path.join(
          projectRoot,
          ".data",
          "approved-backups",
          "linked-data.sqlite",
        ),
      }),
    ).rejects.toThrow(/symbolic link|junction|reparse point/u);

    expect(hashFile(externalDatabase)).toBe(before);
    expect(existsSync(path.join(externalData, "approved-backups"))).toBe(false);
  });

  it("rejects a linked approved directory without writing outside the project", async (context) => {
    const { projectRoot, source } = createCleanProject();
    const externalDirectory = temporaryRoot("aptiloop-external-backups-");
    const approvedDirectory = path.join(
      projectRoot,
      ".data",
      "approved-backups",
    );
    const sentinel = path.join(externalDirectory, "sentinel.bin");
    writeFileSync(sentinel, "outside", { flag: "wx" });
    const before = hashFile(sentinel);
    if (
      !tryCreateLink(context, externalDirectory, approvedDirectory, "directory")
    ) {
      return;
    }

    await expect(
      createApprovedM1Backup({
        projectRoot,
        sourcePath: source,
        destinationPath: path.join(
          approvedDirectory,
          "linked-directory.sqlite",
        ),
      }),
    ).rejects.toThrow(/symbolic link|junction|reparse point/u);

    expect(hashFile(sentinel)).toBe(before);
    expect(readdirSync(externalDirectory)).toEqual(["sentinel.bin"]);
  });

  it("rejects a linked destination without changing its external target", async (context) => {
    const { projectRoot, source, approvedDirectory } = createCleanProject();
    mkdirSync(approvedDirectory);
    const externalRoot = temporaryRoot("aptiloop-external-target-");
    const externalTarget = path.join(externalRoot, "external.sqlite");
    const destination = path.join(approvedDirectory, "linked.sqlite");
    writeFileSync(externalTarget, "outside target", { flag: "wx" });
    const before = hashFile(externalTarget);
    if (!tryCreateLink(context, externalTarget, destination, "file")) return;

    await expect(
      createApprovedM1Backup({
        projectRoot,
        sourcePath: source,
        destinationPath: destination,
      }),
    ).rejects.toThrow(/symbolic link|reparse point/u);

    expect(hashFile(externalTarget)).toBe(before);
    expect(pendingArtifacts(approvedDirectory)).toEqual([]);
  });
});
