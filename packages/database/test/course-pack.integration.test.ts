import { afterEach, describe, expect, it } from "vitest";

import {
  canonicalCoursePackJson,
  createDevelopmentCoursePackFixture,
  finalizeCoursePack,
  validateCoursePackBytes,
  type CoursePackV1,
} from "@dlh/course-authoring-kit";

import {
  coursePackSourceBytesHash,
  CourseFoundationRepository,
  CoursePackRepository,
  migrateDatabase,
  openDatabase,
  type DatabaseConnection,
} from "../src/index.js";

const connections: DatabaseConnection[] = [];
const encoder = new TextEncoder();

function connection(): DatabaseConnection {
  const value = openDatabase(":memory:");
  migrateDatabase(value);
  connections.push(value);
  return value;
}

afterEach(() => {
  while (connections.length > 0) connections.pop()?.close();
});

function validated(pack: CoursePackV1) {
  const sourceBytes = encoder.encode(JSON.stringify(pack, null, 2));
  const validation = validateCoursePackBytes(sourceBytes);
  if (!validation.valid) {
    throw new Error(JSON.stringify(validation.report));
  }
  return { sourceBytes, validation };
}

describe("CoursePackRepository", () => {
  it("installs, reads, exports, and re-imports one immutable revision", async () => {
    const database = connection();
    let id = 0;
    const repository = new CoursePackRepository(database, {
      now: () => Date.UTC(2026, 7, 10),
      id: () => `pack-event-${++id}`,
    });
    const pack = createDevelopmentCoursePackFixture();
    const { sourceBytes, validation } = validated(pack);

    const installed = repository.install({
      operationId: "install-development-pack",
      action: "install",
      sourceBytesHash: coursePackSourceBytesHash(sourceBytes),
      pack: validation.pack,
      canonicalJson: validation.canonicalJson,
      report: validation.report,
    });
    expect(installed).toMatchObject({
      courseId: pack.course.courseKey,
      revisionId: pack.revision.revisionKey,
      revisionStatus: "published",
      installed: true,
      idempotent: false,
    });
    expect(repository.list()).toHaveLength(1);
    expect(repository.read(pack.revision.revisionKey)).toEqual(pack);
    expect(repository.exportCanonicalJson(pack.revision.revisionKey)).toBe(
      canonicalCoursePackJson(pack),
    );

    const graph = await new CourseFoundationRepository(
      database,
    ).getCourseRevision(pack.revision.revisionKey);
    expect(graph?.lessons.map((lesson) => lesson.stableId)).toEqual([
      "replay-lesson",
    ]);
    expect(
      graph?.lessons[0]?.activities.map((activity) => activity.stableId),
    ).toEqual(["study-replay", "recall-replay"]);
    expect(JSON.stringify(graph)).not.toContain(
      "The immutable snapshot, ordered accepted facts",
    );
    expect(
      database.sqlite
        .prepare(
          `SELECT status FROM adaptation_branches
           WHERE course_id = ? AND base_revision_id = ?`,
        )
        .get(pack.course.courseKey, pack.revision.revisionKey),
    ).toEqual({ status: "active" });
    expect(
      database.sqlite
        .prepare(
          `SELECT knowledge_node_ids_json AS knowledgeNodeIdsJson
           FROM course_activities WHERE revision_id = ?
           ORDER BY order_index LIMIT 1`,
        )
        .get(pack.revision.revisionKey),
    ).toEqual({ knowledgeNodeIdsJson: '["deterministic-replay"]' });

    const replay = repository.install({
      operationId: "install-development-pack",
      action: "install",
      sourceBytesHash: coursePackSourceBytesHash(sourceBytes),
      pack: validation.pack,
      canonicalJson: validation.canonicalJson,
      report: validation.report,
    });
    expect(replay).toMatchObject({ installed: false, idempotent: true });
    const byteReplay = repository.install({
      operationId: "install-development-pack-again",
      action: "install",
      sourceBytesHash: coursePackSourceBytesHash(sourceBytes),
      pack: validation.pack,
      canonicalJson: validation.canonicalJson,
      report: validation.report,
    });
    expect(byteReplay).toMatchObject({ installed: false, idempotent: true });
    expect(
      database.sqlite
        .prepare("SELECT count(*) AS count FROM course_pack_lifecycle_events")
        .get(),
    ).toEqual({ count: 1 });
    expect(database.sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual(
      [],
    );
  });

  it("rejects revision collisions and rolls back every active row on failure", () => {
    const database = connection();
    const repository = new CoursePackRepository(database, {
      now: () => Date.UTC(2026, 7, 10),
      id: () => "pack-event",
    });
    const original = createDevelopmentCoursePackFixture();
    const first = validated(original);
    repository.install({
      operationId: "install-original",
      action: "install",
      sourceBytesHash: coursePackSourceBytesHash(first.sourceBytes),
      pack: first.validation.pack,
      canonicalJson: first.validation.canonicalJson,
      report: first.validation.report,
    });

    const changed = structuredClone(original);
    changed.course.title = "Conflicting identity";
    const finalized = finalizeCoursePack(changed);
    const conflict = validated(finalized);
    expect(() =>
      repository.install({
        operationId: "install-conflict",
        action: "install",
        sourceBytesHash: coursePackSourceBytesHash(conflict.sourceBytes),
        pack: conflict.validation.pack,
        canonicalJson: conflict.validation.canonicalJson,
        report: conflict.validation.report,
      }),
    ).toThrow(/identity is already bound/u);
    expect(repository.list()).toHaveLength(1);

    const localized = structuredClone(createDevelopmentCoursePackFixture());
    localized.course.courseKey = "rollback-course";
    localized.revision.revisionKey = "rollback-course/v1";
    localized.course.availableLocales = ["en-US", "ru-RU"];
    localized.localizations = [
      {
        locale: "ru-RU",
        releaseComplete: false,
        fields: { "course/title": "Проверка отката" },
      },
    ];
    const rollbackPack = finalizedAndValidated(localized);
    database.sqlite.exec(`
      CREATE TRIGGER force_course_pack_rollback
      BEFORE INSERT ON course_pack_localizations
      BEGIN SELECT RAISE(ABORT, 'forced Course Pack rollback'); END;
    `);
    expect(() =>
      repository.install({
        operationId: "install-rollback",
        action: "install",
        sourceBytesHash: coursePackSourceBytesHash(rollbackPack.sourceBytes),
        pack: rollbackPack.validation.pack,
        canonicalJson: rollbackPack.validation.canonicalJson,
        report: rollbackPack.validation.report,
      }),
    ).toThrow("forced Course Pack rollback");
    expect(
      database.sqlite
        .prepare("SELECT id FROM courses WHERE id = 'rollback-course'")
        .get(),
    ).toBeUndefined();
    expect(
      database.sqlite
        .prepare(
          "SELECT revision_id FROM course_pack_manifests WHERE revision_id = 'rollback-course/v1'",
        )
        .get(),
    ).toBeUndefined();
  });

  it("quarantines diagnostics only and explicitly uninstalls without deletion", () => {
    const database = connection();
    let id = 0;
    const repository = new CoursePackRepository(database, {
      now: () => Date.UTC(2026, 7, 10),
      id: () => `record-${++id}`,
    });
    const invalidBytes = encoder.encode('{"format":1,"format":2}');
    const invalid = validateCoursePackBytes(invalidBytes);
    expect(invalid.valid).toBe(false);
    repository.recordQuarantine(
      coursePackSourceBytesHash(invalidBytes),
      invalid.report,
    );
    expect(
      database.sqlite
        .prepare(
          `SELECT source_bytes_hash, report_json
           FROM course_pack_quarantine`,
        )
        .all(),
    ).toEqual([
      {
        source_bytes_hash: coursePackSourceBytesHash(invalidBytes),
        report_json: expect.not.stringContaining('"format":1'),
      },
    ]);
    expect(repository.list()).toEqual([]);

    const pack = createDevelopmentCoursePackFixture();
    const { sourceBytes, validation } = validated(pack);
    repository.install({
      operationId: "install-for-uninstall",
      action: "install",
      sourceBytesHash: coursePackSourceBytesHash(sourceBytes),
      pack: validation.pack,
      canonicalJson: validation.canonicalJson,
      report: validation.report,
    });
    expect(() =>
      repository.uninstall({
        operationId: "uninstall-wrong-confirmation",
        revisionId: pack.revision.revisionKey,
        confirmRevisionKey: "wrong",
      }),
    ).toThrow(/confirmation/u);
    const uninstalled = repository.uninstall({
      operationId: "uninstall-pack",
      revisionId: pack.revision.revisionKey,
      confirmRevisionKey: pack.revision.revisionKey,
    });
    expect(uninstalled).toEqual({
      revisionId: pack.revision.revisionKey,
      lifecycleAction: "uninstall",
      retainedEvidenceCount: 0,
      idempotent: false,
    });
    expect(repository.list()[0]).toMatchObject({
      revisionStatus: "archived",
      lifecycleAction: "uninstall",
    });
    expect(repository.exportCanonicalJson(pack.revision.revisionKey)).toBe(
      canonicalCoursePackJson(pack),
    );
    expect(() =>
      database.sqlite
        .prepare(
          "UPDATE course_pack_manifests SET canonical_json = '{}' WHERE revision_id = ?",
        )
        .run(pack.revision.revisionKey),
    ).toThrow("Course Pack manifest is immutable");
  });
});

function finalizedAndValidated(pack: CoursePackV1) {
  return validated(finalizeCoursePack(pack));
}
