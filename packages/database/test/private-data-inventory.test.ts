import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import { createApprovedM1Backup } from "../src/approved-backup.js";
import {
  databaseLogicalSha256,
  inventoryPrivateData,
} from "../src/private-data-inventory.js";

const cleanup: Array<() => void> = [];

afterEach(() => {
  while (cleanup.length) cleanup.pop()?.();
});

describe("private-data inventory", () => {
  it("reads WAL-visible logical payload counts without mutating the source family", () => {
    const directory = mkdtempSync(join(tmpdir(), "aptiloop-inventory-"));
    const path = join(directory, "wal-visible.sqlite");
    const sqlite = new DatabaseSync(path);
    cleanup.push(() => {
      sqlite.close();
      rmSync(directory, { recursive: true, force: true });
    });
    sqlite.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA wal_autocheckpoint = 0;
      CREATE TABLE __dlh_migrations (
        id TEXT PRIMARY KEY NOT NULL,
        applied_at INTEGER NOT NULL
      );
      CREATE TABLE agent_messages (
        id TEXT PRIMARY KEY NOT NULL,
        tool_events_json TEXT NOT NULL,
        raw_event_json TEXT
      );
      CREATE TABLE reviews (
        id TEXT PRIMARY KEY NOT NULL,
        raw_response TEXT
      );
      INSERT INTO __dlh_migrations (id, applied_at)
      VALUES ('0000_initial', 1);
      PRAGMA wal_checkpoint(TRUNCATE);
      INSERT INTO agent_messages (id, tool_events_json, raw_event_json)
      VALUES (
        'message-1',
        '[{"input":"inventory-secret","output":"inventory-secret"}]',
        '{"provider":"inventory-secret"}'
      );
      INSERT INTO reviews (id, raw_response)
      VALUES ('review-1', 'inventory-secret');
    `);

    const before = fingerprintFamily(path);
    const first = inventoryPrivateData({ databasePaths: [path] });
    const afterFirst = fingerprintFamily(path);
    const second = inventoryPrivateData({ databasePaths: [path] });
    const afterSecond = fingerprintFamily(path);

    expect(first).toEqual(second);
    expect(first.candidateCount).toBe(1);
    const candidate = first.candidates[0];
    expect(candidate?.sourceStable).toBe(true);
    expect(candidate?.health.opened).toBe(true);
    if (!candidate?.health.opened) {
      throw new Error("Disposable WAL database could not be inventoried");
    }
    expect(candidate.health.migrations.ids).toEqual(["0000_initial"]);
    expect(candidate.health.agentMessages).toMatchObject({
      rows: 1,
      nonEmptyToolEventRows: 1,
      invalidToolEventRows: 0,
      rawEventRows: 1,
      invalidRawEventRows: 0,
      schemaCompatible: false,
    });
    expect(candidate.health.agentMessages.toolEventBytes).toBeGreaterThan(2);
    expect(candidate.health.agentMessages.rawEventBytes).toBeGreaterThan(0);
    expect(candidate.health.reviews).toMatchObject({
      rows: 1,
      rawResponseRows: 1,
    });
    expect(candidate.health.reviews.rawResponseBytes).toBeGreaterThan(0);
    expect(JSON.stringify(first)).not.toContain("inventory-secret");
    expect(afterFirst).toEqual(before);
    expect(afterSecond).toEqual(before);
  });

  it("binds rowid identity to otherwise identical row values", () => {
    const sqlite = new DatabaseSync(":memory:");
    try {
      sqlite.exec(`
        CREATE TABLE evidence (value TEXT NOT NULL);
        INSERT INTO evidence (rowid, value) VALUES (1, 'alpha'), (2, 'beta');
      `);
      const before = databaseLogicalSha256(sqlite);

      sqlite.exec(`
        UPDATE evidence SET rowid = 3 WHERE rowid = 1;
        UPDATE evidence SET rowid = 1 WHERE rowid = 2;
        UPDATE evidence SET rowid = 2 WHERE rowid = 3;
      `);

      expect(
        sqlite.prepare("SELECT value FROM evidence ORDER BY value").all(),
      ).toEqual([{ value: "alpha" }, { value: "beta" }]);
      expect(databaseLogicalSha256(sqlite)).not.toBe(before);
    } finally {
      sqlite.close();
    }
  });

  it("fails closed when every hidden rowid alias is shadowed", () => {
    const sqlite = new DatabaseSync(":memory:");
    try {
      sqlite.exec(`
        CREATE TABLE shadowed_rowid (
          rowid TEXT NOT NULL,
          _rowid_ TEXT NOT NULL,
          oid TEXT NOT NULL
        );
        INSERT INTO shadowed_rowid (rowid, _rowid_, oid)
        VALUES ('declared-rowid', 'declared-underscore', 'declared-oid');
      `);
      expect(() => databaseLogicalSha256(sqlite)).toThrow(
        /cannot access a rowid table's hidden rowid/u,
      );
    } finally {
      sqlite.close();
    }
  });

  it("discovers backup WAL families from an explicit root", () => {
    const directory = mkdtempSync(join(tmpdir(), "aptiloop-inventory-root-"));
    const backupDirectory = join(directory, "approved-backups");
    mkdirSync(backupDirectory);
    const path = join(backupDirectory, "snapshot.sqlite");
    const sqlite = new DatabaseSync(path);
    cleanup.push(() => {
      sqlite.close();
      rmSync(directory, { recursive: true, force: true });
    });
    sqlite.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE inventory_fixture (id TEXT PRIMARY KEY NOT NULL);
      INSERT INTO inventory_fixture (id) VALUES ('metadata-only');
    `);

    const inventory = inventoryPrivateData({ roots: [directory] });

    expect(inventory.candidateCount).toBe(1);
    expect(inventory.candidates[0]).toMatchObject({
      classification: "backup",
      sourceStable: true,
      family: {
        main: { present: true },
        wal: { present: true },
        shm: { present: true },
      },
      health: { opened: true, integrityOk: true },
    });
    expect(
      inventory.candidates[0]?.origins.some((origin) =>
        origin.endsWith("approved-backups/snapshot.sqlite"),
      ),
    ).toBe(true);
  });

  it("rejects a stale migration ledger with a missing required table", async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "aptiloop-backup-policy-"));
    const dataDirectory = join(projectRoot, ".data");
    const source = join(dataDirectory, "dev-learning-harness.sqlite");
    const destination = join(
      dataDirectory,
      "approved-backups",
      "incomplete.sqlite",
    );
    mkdirSync(dataDirectory, { recursive: true });
    cleanup.push(() => rmSync(projectRoot, { recursive: true, force: true }));

    const sqlite = new DatabaseSync(source);
    sqlite.exec(`
      CREATE TABLE __dlh_migrations (
        id TEXT PRIMARY KEY NOT NULL,
        applied_at INTEGER NOT NULL
      );
      CREATE TABLE agent_messages (
        id TEXT PRIMARY KEY NOT NULL,
        tool_events_json TEXT NOT NULL,
        raw_event_json TEXT
      );
      INSERT INTO __dlh_migrations (id, applied_at) VALUES
        ('0000_initial', 1),
        ('0001_versioned_curriculum', 2),
        ('0002_snapshot_contract_and_hints', 3),
        ('0003_unit_evidence', 4),
        ('0004_unit_progress_compatibility', 5),
        ('0005_test_run_diff_fingerprint', 6);
    `);
    sqlite.close();

    await expect(
      createApprovedM1Backup({
        projectRoot,
        sourcePath: source,
        destinationPath: destination,
      }),
    ).rejects.toThrow(/exact migration contract|preflight/u);
    expect(existsSync(destination)).toBe(false);
  });
});

function fingerprintFamily(path: string) {
  return [path, `${path}-wal`, `${path}-shm`].map((candidate) => {
    if (!existsSync(candidate)) return { present: false } as const;
    const bytes = readFileSync(candidate);
    const stats = statSync(candidate);
    return {
      present: true,
      bytes: stats.size,
      modifiedAtMs: stats.mtimeMs,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    } as const;
  });
}
