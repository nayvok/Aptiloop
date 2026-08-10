import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { canonicalJson, hashCanonicalJson } from "@dlh/database";
import { SessionSnapshotSchema, type SessionSnapshot } from "@dlh/shared";
import { afterEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import {
  assertCourseScopedSessionSideEffectAllowed,
  assertLearningSessionMutationAllowed,
  CourseSessionContextError,
} from "../src/learning-session-policy.js";

const runtimes: Array<{ close(): Promise<void> }> = [];
const roots: string[] = [];
const protectedSnapshotMarker = "protected-policy-snapshot-marker";

afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.close();
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function runtime() {
  const root = mkdtempSync(path.join(tmpdir(), "dlh-session-policy-"));
  roots.push(root);
  const created = createApp({
    projectRoot: path.resolve("../.."),
    databasePath: path.join(root, "test.sqlite"),
    databaseMode: "disposable",
  });
  runtimes.push(created);
  return created;
}

function withoutContentHash(
  snapshot: SessionSnapshot,
): Omit<SessionSnapshot, "contentHash"> {
  const core = { ...snapshot } as Partial<SessionSnapshot>;
  Reflect.deleteProperty(core, "contentHash");
  return core as Omit<SessionSnapshot, "contentHash">;
}

describe("Course-scoped learning session side-effect authority", () => {
  it("accepts only exact canonical snapshot bytes and the mapped ordered Activity sequence", async () => {
    const current = runtime();
    const lesson = current.state.connection.sqlite
      .prepare(
        `SELECT lesson.id
         FROM course_lessons lesson
         JOIN courses course
           ON course.id = lesson.course_id
          AND course.active_revision_id = lesson.revision_id
         JOIN course_revisions revision
           ON revision.course_id = lesson.course_id
          AND revision.id = lesson.revision_id
         WHERE revision.status = 'published'
         ORDER BY lesson.order_index, lesson.id
         LIMIT 1`,
      )
      .get() as { id: string } | undefined;
    if (!lesson) throw new Error("Missing mapped Course lesson fixture");
    const started =
      await current.state.repository.startOrResumeVersionedSession({
        dayId: lesson.id,
      });
    const sessionId = started.session.id;
    const stored = current.state.connection.sqlite
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
    expect(() =>
      assertCourseScopedSessionSideEffectAllowed(
        current.state.connection,
        sessionId,
      ),
    ).not.toThrow();

    current.state.connection.sqlite.exec(`
      DROP TRIGGER session_snapshots_immutable_update_guard;
      DROP TRIGGER session_course_contexts_immutable_update_guard;
    `);
    const updateSnapshot = current.state.connection.sqlite.prepare(
      `UPDATE session_snapshots
       SET schema_version = ?, content_hash = ?, snapshot_json = ?
       WHERE id = ?`,
    );
    const updateContext = current.state.connection.sqlite.prepare(
      `UPDATE session_course_contexts
       SET snapshot_hash = ?, snapshot_bytes_hash = ?
       WHERE session_id = ?`,
    );
    const sha256 = (value: string) =>
      createHash("sha256").update(value).digest("hex");
    const persistRaw = (
      snapshotJson: string,
      storedHash: string,
      options: {
        schemaVersion?: number;
        contextHash?: string;
        bytesHash?: string;
      } = {},
    ) => {
      updateSnapshot.run(
        options.schemaVersion ?? 2,
        storedHash,
        snapshotJson,
        stored.id,
      );
      updateContext.run(
        options.contextHash ?? storedHash,
        options.bytesHash ?? sha256(snapshotJson),
        sessionId,
      );
    };
    const persistCanonical = (core: Record<string, unknown>) => {
      const contentHash = hashCanonicalJson(core);
      persistRaw(canonicalJson({ ...core, contentHash }), contentHash);
    };
    const originalCore = withoutContentHash(originalSnapshot);
    const restore = () =>
      persistRaw(stored.snapshotJson, stored.contentHash, {
        schemaVersion: stored.schemaVersion,
      });
    const expectRejected = (label: string, tamper: () => void) => {
      restore();
      tamper();
      let rejection: unknown;
      try {
        assertCourseScopedSessionSideEffectAllowed(
          current.state.connection,
          sessionId,
        );
      } catch (error) {
        rejection = error;
      }
      expect(rejection, label).toBeInstanceOf(CourseSessionContextError);
      expect((rejection as Error).message, label).not.toContain(
        protectedSnapshotMarker,
      );
    };

    expectRejected("malformed snapshot JSON", () => {
      persistRaw('{"malformed":', stored.contentHash);
    });
    expectRejected("unknown snapshot field", () => {
      persistCanonical({
        ...originalCore,
        unexpectedProtectedField: protectedSnapshotMarker,
      });
    });
    expectRejected("schema version mismatch", () => {
      persistRaw(stored.snapshotJson, stored.contentHash, { schemaVersion: 3 });
    });
    expectRejected("embedded Course identity mismatch", () => {
      persistCanonical({ ...originalCore, curriculumId: "forged-course" });
    });
    expectRejected("embedded content hash mismatch", () => {
      persistRaw(
        canonicalJson({
          ...originalCore,
          contentHash: "0".repeat(64),
        }),
        stored.contentHash,
      );
    });
    expectRejected("canonical snapshot core hash mismatch", () => {
      persistRaw(
        canonicalJson({
          ...originalSnapshot,
          curriculumTitle: `${originalSnapshot.curriculumTitle} tampered`,
        }),
        stored.contentHash,
      );
    });
    expectRejected("snapshot byte hash mismatch", () => {
      const core = {
        ...originalCore,
        curriculumTitle: `${originalCore.curriculumTitle} rebound`,
      };
      const contentHash = hashCanonicalJson(core);
      const snapshotJson = canonicalJson({ ...core, contentHash });
      persistRaw(snapshotJson, contentHash, {
        bytesHash: sha256(stored.snapshotJson),
      });
    });
    expectRejected("extra Activity", () => {
      const template = originalCore.units[0];
      if (!template) throw new Error("Missing snapshot Activity fixture");
      persistCanonical({
        ...originalCore,
        units: [
          ...originalCore.units,
          {
            ...template,
            id: "forged-extra-activity",
            stableId: "forged-extra-activity",
            order: originalCore.units.length + 1,
            referenceAnswer: protectedSnapshotMarker,
          },
        ],
      });
    });
    expectRejected("missing Activity", () => {
      if (originalCore.units.length < 2) {
        throw new Error(
          "Snapshot Activity fixture must contain two Activities",
        );
      }
      persistCanonical({
        ...originalCore,
        units: originalCore.units.slice(0, -1),
      });
    });
    expectRejected("retyped Activity", () => {
      const [first, ...rest] = originalCore.units;
      if (!first) throw new Error("Missing snapshot Activity fixture");
      const retyped =
        first.type === "study"
          ? {
              ...first,
              type: "summary" as const,
              payload: { type: "summary" as const, prompts: [] },
            }
          : {
              ...first,
              type: "study" as const,
              payload: {
                type: "study" as const,
                body: protectedSnapshotMarker,
              },
            };
      persistCanonical({ ...originalCore, units: [retyped, ...rest] });
    });
    expectRejected("reordered Activities", () => {
      const [first, second, ...rest] = originalCore.units;
      if (!first || !second) {
        throw new Error(
          "Snapshot Activity fixture must contain two Activities",
        );
      }
      persistCanonical({
        ...originalCore,
        units: [second, first, ...rest],
      });
    });

    restore();
    expect(() =>
      assertCourseScopedSessionSideEffectAllowed(
        current.state.connection,
        sessionId,
      ),
    ).not.toThrow();

    current.state.connection.sqlite.exec(
      "DROP TRIGGER session_course_contexts_immutable_delete_guard",
    );
    current.state.connection.sqlite
      .prepare("DELETE FROM session_course_contexts WHERE session_id = ?")
      .run(sessionId);
    const migrationRun = current.state.connection.sqlite
      .prepare(
        `SELECT id, source_database_digest AS sourceDatabaseDigest
         FROM migration_runs WHERE transform_version = 'm2-v1'`,
      )
      .get() as { id: string; sourceDatabaseDigest: string };
    const insertQuarantine = current.state.connection.sqlite.prepare(
      `INSERT INTO migration_provenance
       (id, run_id, source_database_digest, source_table, source_primary_key,
        source_row_hash, target_entity_type, target_id, transform_version,
        status, reason_code, diagnostic, created_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, 'm2-v1', 'quarantined', ?, ?, ?)`,
    );
    const quarantinedSources = [
      [
        "curriculum_versions",
        originalSnapshot.curriculumVersionId,
        "CROSS_SCOPE_PARENT_REVISION",
      ],
      ["curriculum_days_v2", originalSnapshot.day.id, "MALFORMED_LESSON"],
      ["session_snapshots", stored.id, "MALFORMED_SESSION_CONTEXT"],
    ] as const;
    quarantinedSources.forEach(([sourceTable, sourceId, reasonCode], index) => {
      insertQuarantine.run(
        `policy-quarantine-${index}`,
        migrationRun.id,
        migrationRun.sourceDatabaseDigest,
        sourceTable,
        sourceId,
        "0".repeat(64),
        reasonCode,
        "Explicit test quarantine",
        index + 1,
      );
    });
    expect(() =>
      assertLearningSessionMutationAllowed(current.state.connection, sessionId),
    ).not.toThrow();
    expect(() =>
      assertCourseScopedSessionSideEffectAllowed(
        current.state.connection,
        sessionId,
      ),
    ).toThrow(CourseSessionContextError);
  });
});
