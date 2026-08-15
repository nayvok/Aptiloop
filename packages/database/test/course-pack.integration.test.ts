import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  canonicalCoursePackJson,
  finalizeCoursePack,
  validateCoursePackBytes,
  type CoursePackV1,
} from "@aptiloop/course-authoring-kit";
import { createDevelopmentCoursePackFixture } from "../../course-authoring-kit/test/fixture.js";

import {
  coursePackSourceBytesHash,
  CourseFoundationRepository,
  CoursePackRepository,
  createLearningRepository,
  migrateDatabase,
  openM1WritableDatabase,
  openDatabase,
  type DatabaseConnection,
} from "../src/index.js";
import { validateM1WritableDatabasePath } from "../src/cli/path.js";

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
      validationId: "11111111-1111-4111-8111-111111111111",
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
      validationId: "11111111-1111-4111-8111-111111111111",
      action: "install",
      sourceBytesHash: coursePackSourceBytesHash(sourceBytes),
      pack: validation.pack,
      canonicalJson: validation.canonicalJson,
      report: validation.report,
    });
    expect(replay).toMatchObject({ installed: false, idempotent: true });
    const byteReplay = repository.install({
      operationId: "install-development-pack-again",
      validationId: "11111111-1111-4111-8111-111111111112",
      action: "install",
      sourceBytesHash: coursePackSourceBytesHash(sourceBytes),
      pack: validation.pack,
      canonicalJson: validation.canonicalJson,
      report: validation.report,
    });
    expect(byteReplay).toMatchObject({ installed: false, idempotent: true });
    expect(() =>
      repository.install({
        operationId: "open-installed-pack-as-draft",
        validationId: "11111111-1111-4111-8111-111111111113",
        action: "open-as-draft",
        sourceBytesHash: coursePackSourceBytesHash(sourceBytes),
        pack: validation.pack,
        canonicalJson: validation.canonicalJson,
        report: validation.report,
      }),
    ).toThrow(/different lifecycle action/u);
    expect(
      database.sqlite
        .prepare("SELECT count(*) AS count FROM course_pack_lifecycle_events")
        .get(),
    ).toEqual({ count: 2 });
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
      validationId: "22222222-2222-4222-8222-222222222221",
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
        operationId: "install-original",
        validationId: "22222222-2222-4222-8222-222222222221",
        action: "install",
        sourceBytesHash: coursePackSourceBytesHash(conflict.sourceBytes),
        pack: conflict.validation.pack,
        canonicalJson: conflict.validation.canonicalJson,
        report: conflict.validation.report,
      }),
    ).toThrow(/different validation, action, or payload/u);
    expect(() =>
      repository.install({
        operationId: "install-conflict",
        validationId: "22222222-2222-4222-8222-222222222222",
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
        validationId: "22222222-2222-4222-8222-222222222223",
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

  it("keeps the imported manifest immutable and opens a distinct personal draft", () => {
    const database = connection();
    let id = 0;
    const repository = new CoursePackRepository(database, {
      now: () => Date.UTC(2026, 7, 10),
      id: () => `draft-event-${++id}`,
    });
    const pack = createDevelopmentCoursePackFixture();
    const { sourceBytes, validation } = validated(pack);
    const input = {
      validationId: "33333333-3333-4333-8333-333333333331",
      action: "open-as-draft" as const,
      sourceBytesHash: coursePackSourceBytesHash(sourceBytes),
      pack: validation.pack,
      canonicalJson: validation.canonicalJson,
      report: validation.report,
    };

    const opened = repository.install({
      ...input,
      operationId: "open-development-pack",
    });
    expect(opened).toMatchObject({
      courseId: pack.course.courseKey,
      action: "open-as-draft",
      revisionStatus: "draft",
      installed: true,
      idempotent: false,
    });
    expect(opened.revisionId).not.toBe(pack.revision.revisionKey);
    expect(repository.exportCanonicalJson(pack.revision.revisionKey)).toBe(
      validation.canonicalJson,
    );
    expect(
      database.sqlite
        .prepare(
          `SELECT status, content_hash, branch_kind, parent_version_id,
                  based_on_content_hash, adaptation_branch_id
           FROM curriculum_versions WHERE id IN (?, ?)
           ORDER BY id = ? DESC`,
        )
        .all(
          pack.revision.revisionKey,
          opened.revisionId,
          pack.revision.revisionKey,
        ),
    ).toEqual([
      {
        status: "archived",
        content_hash: pack.revision.contentHash,
        branch_kind: pack.revision.branchKind,
        parent_version_id: pack.revision.parentRevisionKey,
        based_on_content_hash: pack.revision.basedOnContentHash,
        adaptation_branch_id: null,
      },
      {
        status: "draft",
        content_hash: null,
        branch_kind: "personal",
        parent_version_id: pack.revision.revisionKey,
        based_on_content_hash: pack.revision.contentHash,
        adaptation_branch_id: expect.any(String),
      },
    ]);
    expect(repository.list()).toEqual([
      expect.objectContaining({
        revisionId: pack.revision.revisionKey,
        revisionStatus: "archived",
        lifecycleAction: "open-as-draft",
      }),
    ]);

    expect(
      repository.install({
        ...input,
        operationId: "open-development-pack",
      }),
    ).toEqual({ ...opened, installed: false, idempotent: true });
    expect(
      repository.install({
        ...input,
        operationId: "open-development-pack-again",
        validationId: "33333333-3333-4333-8333-333333333332",
      }),
    ).toEqual({ ...opened, installed: false, idempotent: true });
    expect(() =>
      repository.install({
        ...input,
        operationId: "install-after-open",
        validationId: "33333333-3333-4333-8333-333333333333",
        action: "install",
      }),
    ).toThrow(/different lifecycle action/u);
    expect(
      database.sqlite
        .prepare(
          `SELECT count(*) AS count FROM curriculum_versions
           WHERE curriculum_id = ?`,
        )
        .get(pack.course.courseKey),
    ).toEqual({ count: 2 });
    expect(
      database.sqlite
        .prepare("SELECT count(*) AS count FROM course_pack_lifecycle_events")
        .get(),
    ).toEqual({ count: 2 });
    expect(database.sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual(
      [],
    );
  });

  it("rejects a later Pack that would change the existing Course primary locale", () => {
    const database = connection();
    let id = 0;
    const repository = new CoursePackRepository(database, {
      now: () => Date.UTC(2026, 7, 10),
      id: () => `locale-event-${++id}`,
    });
    const original = createDevelopmentCoursePackFixture();
    const first = validated(original);
    repository.install({
      operationId: "install-locale-base",
      validationId: "44444444-4444-4444-8444-444444444441",
      action: "install",
      sourceBytesHash: coursePackSourceBytesHash(first.sourceBytes),
      pack: first.validation.pack,
      canonicalJson: first.validation.canonicalJson,
      report: first.validation.report,
    });
    const before = database.sqlite
      .prepare(
        `SELECT primary_locale, active_revision_id, updated_at
         FROM courses WHERE id = ?`,
      )
      .get(original.course.courseKey);

    const changed = structuredClone(original);
    changed.course.primaryLocale = "ru-RU";
    changed.course.availableLocales = ["ru-RU"];
    changed.revision.revisionKey = "development-kernel-basics/v2";
    changed.revision.revisionNumber = 2;
    changed.revision.parentRevisionKey = original.revision.revisionKey;
    for (const snapshot of changed.knowledge.sourceSnapshots) {
      snapshot.locale = "ru-RU";
    }
    for (const capsule of changed.knowledge.capsules) {
      capsule.primaryLocale = "ru-RU";
    }
    const second = finalizedAndValidated(changed);
    expect(() =>
      repository.install({
        operationId: "install-conflicting-locale",
        validationId: "44444444-4444-4444-8444-444444444442",
        action: "install",
        sourceBytesHash: coursePackSourceBytesHash(second.sourceBytes),
        pack: second.validation.pack,
        canonicalJson: second.validation.canonicalJson,
        report: second.validation.report,
      }),
    ).toThrow(/primary locale conflicts/u);
    expect(
      database.sqlite
        .prepare(
          `SELECT primary_locale, active_revision_id, updated_at
           FROM courses WHERE id = ?`,
        )
        .get(original.course.courseKey),
    ).toEqual(before);
    expect(repository.exportCanonicalJson(original.revision.revisionKey)).toBe(
      first.validation.canonicalJson,
    );
    expect(
      database.sqlite
        .prepare(
          `SELECT id, content_hash FROM course_revisions
           WHERE course_id = ? ORDER BY revision_number`,
        )
        .all(original.course.courseKey),
    ).toEqual([
      {
        id: original.revision.revisionKey,
        content_hash: original.revision.contentHash,
      },
    ]);
  });

  it("keeps learner activation separate from revision-scoped authoring branches", () => {
    const database = connection();
    let id = 0;
    const repository = new CoursePackRepository(database, {
      now: () => Date.UTC(2026, 7, 10),
      id: () => `branch-event-${++id}`,
    });
    const firstPack = createDevelopmentCoursePackFixture();
    const first = validated(firstPack);
    repository.install({
      operationId: "install-branch-base",
      validationId: "55555555-5555-4555-8555-555555555551",
      action: "install",
      sourceBytesHash: coursePackSourceBytesHash(first.sourceBytes),
      pack: first.validation.pack,
      canonicalJson: first.validation.canonicalJson,
      report: first.validation.report,
    });

    const secondPack = structuredClone(firstPack);
    secondPack.revision.revisionKey = "development-kernel-basics/v2";
    secondPack.revision.revisionNumber = 2;
    secondPack.revision.parentRevisionKey = firstPack.revision.revisionKey;
    const second = finalizedAndValidated(secondPack);
    const opened = repository.install({
      operationId: "open-second-pack",
      validationId: "55555555-5555-4555-8555-555555555552",
      action: "open-as-draft",
      sourceBytesHash: coursePackSourceBytesHash(second.sourceBytes),
      pack: second.validation.pack,
      canonicalJson: second.validation.canonicalJson,
      report: second.validation.report,
    });
    expect(
      database.sqlite
        .prepare(
          `SELECT base_revision_id, status FROM adaptation_branches
           WHERE course_id = ? ORDER BY created_at, id`,
        )
        .all(firstPack.course.courseKey),
    ).toEqual([
      { base_revision_id: firstPack.revision.revisionKey, status: "active" },
      { base_revision_id: secondPack.revision.revisionKey, status: "archived" },
    ]);
    expect(
      database.sqlite
        .prepare(
          `SELECT parent_version_id, based_on_content_hash, revision
           FROM curriculum_versions WHERE id = ?`,
        )
        .get(opened.revisionId),
    ).toEqual({
      parent_version_id: secondPack.revision.revisionKey,
      based_on_content_hash: second.validation.pack.revision.contentHash,
      revision: 3,
    });

    const thirdPack = structuredClone(secondPack);
    thirdPack.revision.revisionKey = "development-kernel-basics/v3";
    thirdPack.revision.revisionNumber = 3;
    thirdPack.revision.parentRevisionKey = secondPack.revision.revisionKey;
    const third = finalizedAndValidated(thirdPack);
    const thirdOpened = repository.install({
      operationId: "open-third-pack",
      validationId: "55555555-5555-4555-8555-555555555553",
      action: "open-as-draft",
      sourceBytesHash: coursePackSourceBytesHash(third.sourceBytes),
      pack: third.validation.pack,
      canonicalJson: third.validation.canonicalJson,
      report: third.validation.report,
    });
    expect(thirdOpened.revisionStatus).toBe("draft");
    expect(
      database.sqlite
        .prepare(
          `SELECT status FROM adaptation_branches
           WHERE course_id = ? AND base_revision_id = ?`,
        )
        .get(firstPack.course.courseKey, secondPack.revision.revisionKey),
    ).toEqual({ status: "archived" });
    expect(
      database.sqlite
        .prepare(
          `SELECT base_revision_id, status FROM adaptation_branches
           WHERE course_id = ? ORDER BY base_revision_id`,
        )
        .all(firstPack.course.courseKey),
    ).toEqual([
      { base_revision_id: firstPack.revision.revisionKey, status: "active" },
      { base_revision_id: secondPack.revision.revisionKey, status: "archived" },
      { base_revision_id: thirdPack.revision.revisionKey, status: "archived" },
    ]);
    expect(database.sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual(
      [],
    );
  });

  it("quarantines diagnostics only and explicitly uninstalls without deletion", () => {
    const database = connection();
    const ids = ["quarantine-record", "z-install-event", "a-uninstall-event"];
    let id = 0;
    const repository = new CoursePackRepository(database, {
      now: () => Date.UTC(2026, 7, 10),
      id: () => ids[id++]!,
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
      validationId: "66666666-6666-4666-8666-666666666661",
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
    expect(() =>
      repository.install({
        operationId: "reinstall-after-uninstall",
        validationId: "66666666-6666-4666-8666-666666666662",
        action: "install",
        sourceBytesHash: coursePackSourceBytesHash(sourceBytes),
        pack: validation.pack,
        canonicalJson: validation.canonicalJson,
        report: validation.report,
      }),
    ).toThrow(/different lifecycle action/u);
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

  it("selects a deterministic remaining Course after uninstall and passes exact-current admission", async () => {
    const projectRoot = mkdtempSync(
      join(tmpdir(), "aptiloop-course-uninstall-selection-"),
    );
    const dataDirectory = join(projectRoot, ".data");
    const databasePath = join(dataDirectory, "dev-learning-harness.sqlite");
    mkdirSync(dataDirectory);

    try {
      const database = openDatabase(databasePath);
      migrateDatabase(database);
      let id = 0;
      const now = Date.UTC(2026, 7, 13);
      const repository = new CoursePackRepository(database, {
        now: () => now,
        id: () => `selection-event-${++id}`,
      });
      const firstPack = createDevelopmentCoursePackFixture();
      const secondPack = structuredClone(firstPack);
      secondPack.course.courseKey = "another-deterministic-course";
      secondPack.course.title = "Another deterministic Course";
      secondPack.revision.revisionKey = "another-deterministic-course/v1";

      for (const [index, pack] of [
        firstPack,
        finalizeCoursePack(secondPack),
      ].entries()) {
        const current = validated(pack);
        repository.install({
          operationId: `install-selection-course-${index}`,
          validationId: `77777777-7777-4777-8777-77777777777${index}`,
          action: "install",
          sourceBytesHash: coursePackSourceBytesHash(current.sourceBytes),
          pack: current.validation.pack,
          canonicalJson: current.validation.canonicalJson,
          report: current.validation.report,
        });
      }

      const learning = createLearningRepository(database, {
        now: () => now,
      });
      await learning.selectCourse({
        courseId: firstPack.course.courseKey,
        revisionId: firstPack.revision.revisionKey,
      });
      await learning.selectCourse({
        courseId: secondPack.course.courseKey,
        revisionId: secondPack.revision.revisionKey,
      });

      repository.uninstall({
        operationId: "uninstall-selected-course",
        revisionId: secondPack.revision.revisionKey,
        confirmRevisionKey: secondPack.revision.revisionKey,
      });
      expect(
        database.sqlite
          .prepare(
            `SELECT course_id, active_revision_id, is_selected
             FROM learner_course_states ORDER BY course_id`,
          )
          .all(),
      ).toEqual([
        {
          course_id: firstPack.course.courseKey,
          active_revision_id: firstPack.revision.revisionKey,
          is_selected: 1,
        },
      ]);
      database.close();

      const reopened = openM1WritableDatabase(databasePath, {
        revalidateTarget: () =>
          validateM1WritableDatabasePath(databasePath, { projectRoot }),
      });
      try {
        expect(reopened.migrationAdmission?.kind).toBe("current");
        await expect(
          createLearningRepository(reopened).getSelectedCourseTarget(),
        ).resolves.toEqual({
          courseId: firstPack.course.courseKey,
          revisionId: firstPack.revision.revisionKey,
        });
      } finally {
        reopened.close();
      }
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});

function finalizedAndValidated(pack: CoursePackV1) {
  return validated(finalizeCoursePack(pack));
}
