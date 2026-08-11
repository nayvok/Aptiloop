import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { publishedCurriculumV2 } from "@aptiloop/curriculum";
import { SessionSnapshotSchema, type SessionSnapshot } from "@aptiloop/shared";
import { afterEach, describe, expect, it } from "vitest";

import {
  canonicalJson,
  createLearningRepository,
  hashCanonicalJson,
  migrateDatabase,
  openDatabase,
  seedVersionedCurriculum,
  type M2SessionContextInventory,
} from "../src/index.js";
import { inventoryPrivateData } from "../src/private-data-inventory.js";

const cleanup: Array<() => void> = [];
const protectedSnapshotMarker = "protected-inventory-snapshot-marker";

afterEach(() => {
  while (cleanup.length > 0) cleanup.pop()?.();
});

function withoutContentHash(
  snapshot: SessionSnapshot,
): Omit<SessionSnapshot, "contentHash"> {
  const core = { ...snapshot } as Partial<SessionSnapshot>;
  Reflect.deleteProperty(core, "contentHash");
  return core as Omit<SessionSnapshot, "contentHash">;
}

describe("mapped session context inventory", () => {
  it("counts strict snapshot authority mismatches without returning snapshot bytes", async () => {
    const root = mkdtempSync(join(tmpdir(), "aptiloop-context-inventory-"));
    const databasePath = join(root, "current.sqlite");
    const connection = openDatabase(databasePath);
    cleanup.push(() => {
      connection.close();
      rmSync(root, { recursive: true, force: true });
    });
    migrateDatabase(connection);
    seedVersionedCurriculum(connection, publishedCurriculumV2);
    const lesson = connection.sqlite
      .prepare(
        `SELECT day.id
         FROM curriculum_days_v2 day
         JOIN curricula course ON course.active_version_id = day.version_id
         ORDER BY day.order_index, day.id
         LIMIT 1`,
      )
      .get() as { id: string } | undefined;
    if (!lesson) throw new Error("Missing versioned lesson fixture");
    const learning = createLearningRepository(connection, {
      id: (() => {
        let id = 0;
        return () => `context-inventory-${++id}`;
      })(),
      now: () => Date.UTC(2026, 7, 9),
    });
    const started = await learning.startOrResumeVersionedSession({
      dayId: lesson.id,
    });
    const sessionId = started.session.id;
    const stored = connection.sqlite
      .prepare(
        `SELECT id, schema_version AS schemaVersion, content_hash AS contentHash,
                snapshot_json AS snapshotJson
         FROM session_snapshots WHERE session_id = ?`,
      )
      .get(sessionId) as {
      id: string;
      schemaVersion: number;
      contentHash: string;
      snapshotJson: string;
    };
    const originalSnapshot = SessionSnapshotSchema.parse(
      JSON.parse(stored.snapshotJson),
    );
    const originalCore = withoutContentHash(originalSnapshot);

    connection.sqlite.exec(`
      DROP TRIGGER session_snapshots_immutable_update_guard;
      DROP TRIGGER session_course_contexts_immutable_update_guard;
    `);
    const updateSnapshot = connection.sqlite.prepare(
      `UPDATE session_snapshots
       SET schema_version = ?, content_hash = ?, snapshot_json = ?
       WHERE id = ?`,
    );
    const updateContext = connection.sqlite.prepare(
      `UPDATE session_course_contexts
       SET snapshot_hash = ?, snapshot_bytes_hash = ?
       WHERE session_id = ?`,
    );
    const sha256 = (value: string) =>
      createHash("sha256").update(value).digest("hex");
    const persistRaw = (
      snapshotJson: string,
      storedHash: string,
      schemaVersion = 2,
    ) => {
      updateSnapshot.run(schemaVersion, storedHash, snapshotJson, stored.id);
      updateContext.run(storedHash, sha256(snapshotJson), sessionId);
    };
    const persistCanonical = (core: Record<string, unknown>) => {
      const contentHash = hashCanonicalJson(core);
      persistRaw(canonicalJson({ ...core, contentHash }), contentHash);
    };
    const restore = () =>
      persistRaw(stored.snapshotJson, stored.contentHash, stored.schemaVersion);
    const inspect = (): M2SessionContextInventory => {
      const report = inventoryPrivateData({ databasePaths: [databasePath] });
      expect(JSON.stringify(report)).not.toContain(protectedSnapshotMarker);
      const candidate = report.candidates[0];
      expect(candidate?.health.opened).toBe(true);
      if (!candidate?.health.opened) {
        throw new Error("Mapped context fixture could not be inventoried");
      }
      return candidate.health.m2.sessionContexts;
    };
    const expectOnly = (
      field: keyof Pick<
        M2SessionContextInventory,
        | "snapshotStrictParseMismatchRows"
        | "snapshotSchemaVersionMismatchRows"
        | "snapshotEmbeddedIdentityMismatchRows"
        | "snapshotEmbeddedContentHashMismatchRows"
        | "snapshotCanonicalCoreHashMismatchRows"
      >,
    ) => {
      const health = inspect();
      expect(health).toMatchObject({
        snapshotMismatchRows: 0,
        snapshotBytesHashMissingRows: 0,
        snapshotBytesHashMismatchRows: 0,
        snapshotStrictParseMismatchRows:
          field === "snapshotStrictParseMismatchRows" ? 1 : 0,
        snapshotSchemaVersionMismatchRows:
          field === "snapshotSchemaVersionMismatchRows" ? 1 : 0,
        snapshotEmbeddedIdentityMismatchRows:
          field === "snapshotEmbeddedIdentityMismatchRows" ? 1 : 0,
        snapshotEmbeddedContentHashMismatchRows:
          field === "snapshotEmbeddedContentHashMismatchRows" ? 1 : 0,
        snapshotCanonicalCoreHashMismatchRows:
          field === "snapshotCanonicalCoreHashMismatchRows" ? 1 : 0,
      });
    };

    expect(inspect()).toMatchObject({
      snapshotMismatchRows: 0,
      snapshotBytesHashMissingRows: 0,
      snapshotBytesHashMismatchRows: 0,
      snapshotStrictParseMismatchRows: 0,
      snapshotSchemaVersionMismatchRows: 0,
      snapshotEmbeddedIdentityMismatchRows: 0,
      snapshotEmbeddedContentHashMismatchRows: 0,
      snapshotCanonicalCoreHashMismatchRows: 0,
    });

    persistCanonical({
      ...originalCore,
      unexpectedProtectedField: protectedSnapshotMarker,
    });
    expectOnly("snapshotStrictParseMismatchRows");

    restore();
    persistRaw(stored.snapshotJson, stored.contentHash, 3);
    expectOnly("snapshotSchemaVersionMismatchRows");

    restore();
    persistCanonical({ ...originalCore, curriculumRevision: 99 });
    expectOnly("snapshotEmbeddedIdentityMismatchRows");

    restore();
    persistRaw(
      canonicalJson({ ...originalCore, contentHash: "0".repeat(64) }),
      stored.contentHash,
    );
    expectOnly("snapshotEmbeddedContentHashMismatchRows");

    restore();
    persistRaw(
      canonicalJson({
        ...originalSnapshot,
        curriculumTitle: protectedSnapshotMarker,
      }),
      stored.contentHash,
    );
    expectOnly("snapshotCanonicalCoreHashMismatchRows");

    restore();
  });
});
