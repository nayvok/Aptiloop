import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { createApprovedM1Backup } from "../src/approved-backup.js";
import {
  canonicalJson,
  hashCanonicalJson,
} from "../src/authoring-repository.js";
import { runM1MigrationCli } from "../src/cli/migrate.js";
import {
  migrateDatabase,
  openDatabase,
  type DatabaseConnection,
} from "../src/database.js";

const roots: string[] = [];
const migrationsSource = fileURLToPath(
  new URL("../migrations", import.meta.url),
);

interface LegacyActivityFixture {
  readonly id: string;
  readonly stableId: string;
  readonly prerequisiteStableIds: readonly string[];
}

interface LegacyRevisionFixture {
  readonly id: string;
  readonly revision: number;
  readonly parentId: string | null;
  readonly sectionId: string;
  readonly lessonId: string;
  readonly activities: readonly LegacyActivityFixture[];
}

function temporaryRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), "aptiloop-course-backfill-"));
  roots.push(root);
  return root;
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function installExactPreM2ActiveContract(connection: DatabaseConnection): void {
  connection.sqlite.exec(`
    DROP INDEX unit_progress_session_order_idx;
    CREATE TABLE unit_progress_v2_contract (
      id TEXT PRIMARY KEY NOT NULL,
      session_id TEXT NOT NULL REFERENCES learning_sessions(id) ON DELETE CASCADE,
      unit_id TEXT NOT NULL,
      unit_type TEXT NOT NULL CHECK(unit_type IN (
        'briefing', 'study', 'recall', 'teacher-dialogue', 'quiz', 'code-reading',
        'exercise', 'review', 'interview', 'summary', 'checkpoint', 'spaced-review'
      )),
      status TEXT NOT NULL CHECK(status IN ('locked','ready','in_progress','completed','skipped')),
      progress_json TEXT NOT NULL DEFAULT '{}',
      started_at INTEGER,
      completed_at INTEGER,
      skipped_at INTEGER,
      updated_at INTEGER NOT NULL,
      UNIQUE(session_id, unit_id)
    );
    INSERT INTO unit_progress_v2_contract
      (id, session_id, unit_id, unit_type, status, progress_json, started_at,
       completed_at, skipped_at, updated_at)
    SELECT id, session_id, unit_id, unit_type, status, progress_json, started_at,
           completed_at, skipped_at, updated_at
    FROM unit_progress;
    DROP TABLE unit_progress;
    ALTER TABLE unit_progress_v2_contract RENAME TO unit_progress;
    CREATE INDEX unit_progress_session_order_idx
      ON unit_progress(session_id, updated_at);
    DROP INDEX learning_sessions_one_global_active_uq;
    DROP TRIGGER curriculum_versions_published_update_guard;
    DROP TRIGGER curriculum_versions_published_delete_guard;
    DROP TRIGGER curriculum_weeks_published_insert_guard;
    DROP TRIGGER curriculum_days_v2_published_insert_guard;
    DROP TRIGGER curriculum_units_published_insert_guard;
  `);
}

function insertLegacyCourse(
  connection: DatabaseConnection,
  courseId: string,
  activeRevisionId: string,
  revisions: readonly LegacyRevisionFixture[],
): void {
  connection.sqlite
    .prepare(
      `INSERT INTO curricula
       (id, slug, title, description, active_version_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, 2)`,
    )
    .run(
      courseId,
      courseId,
      `Legacy ${courseId}`,
      "Exact pre-M2 Course fixture",
      activeRevisionId,
    );

  const insertRevision = connection.sqlite.prepare(
    `INSERT INTO curriculum_versions
     (id, curriculum_id, revision, parent_version_id, status, title,
      description, content_hash, created_at, published_at, archived_at,
      updated_at)
     VALUES (?, ?, ?, ?, 'draft', ?, ?, NULL, ?, NULL, NULL, ?)`,
  );
  const insertSection = connection.sqlite.prepare(
    `INSERT INTO curriculum_weeks
     (id, version_id, stable_id, order_index, title, description,
      created_at, updated_at)
     VALUES (?, ?, ?, 0, ?, ?, ?, ?)`,
  );
  const insertLesson = connection.sqlite.prepare(
    `INSERT INTO curriculum_days_v2
     (id, version_id, week_id, stable_id, order_index, title, description,
      goal, estimated_minutes, prerequisites_json, expected_outcomes_json,
      depth_level, out_of_scope_json, topics_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, ?, ?, ?, 30, '[]', '[]', 'foundation', '[]',
             '[]', ?, ?)`,
  );
  const insertActivity = connection.sqlite.prepare(
    `INSERT INTO curriculum_units
     (id, version_id, day_id, stable_id, type, order_index, title,
      description, estimated_minutes, objectives_json, checklist_json,
      sources_json, questions_json, misconceptions_json, reference_answer_json,
      completion_criteria_json, unlock_rules_json, optional, depth_level,
      payload_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'summary', ?, ?, ?, 5, '[]', '[]', '[]', '[]', '[]',
             NULL, ?, ?, 0, 'foundation', ?, ?, ?)`,
  );

  for (const revision of revisions) {
    insertRevision.run(
      revision.id,
      courseId,
      revision.revision,
      revision.parentId,
      `Revision ${revision.revision}`,
      "Valid exact pre-M2 revision",
      revision.revision,
      revision.revision,
    );
    insertSection.run(
      revision.sectionId,
      revision.id,
      `${revision.id}-section`,
      "Section",
      "Section description",
      revision.revision,
      revision.revision,
    );
    insertLesson.run(
      revision.lessonId,
      revision.id,
      revision.sectionId,
      `${revision.id}-lesson`,
      "Lesson",
      "Lesson description",
      "Complete the Activity graph",
      revision.revision,
      revision.revision,
    );
    revision.activities.forEach((activity, index) => {
      insertActivity.run(
        activity.id,
        revision.id,
        revision.lessonId,
        activity.stableId,
        index,
        `Activity ${index + 1}`,
        "Summarize the lesson",
        canonicalJson([{ type: "acknowledgement" }]),
        canonicalJson(
          activity.prerequisiteStableIds.map((unitId) => ({
            type: "unit-completed",
            unitId,
          })),
        ),
        canonicalJson({ type: "summary", prompts: [] }),
        revision.revision,
        revision.revision,
      );
    });
  }
}

function activitySeries(
  prefix: string,
  count: number,
): LegacyActivityFixture[] {
  return Array.from({ length: count }, (_, index) => {
    const suffix = String(index).padStart(3, "0");
    return {
      id: `${prefix}-unit-${suffix}`,
      stableId: `${prefix}-stable-${suffix}`,
      prerequisiteStableIds: [],
    };
  });
}

function insertInvalidContextAndEvidence(connection: DatabaseConnection): void {
  const snapshotRoots = activitySeries("per-node-root", 101);
  const snapshotActivities: LegacyActivityFixture[] = [
    ...snapshotRoots,
    {
      id: "per-node-dependent",
      stableId: "per-node-dependent",
      prerequisiteStableIds: snapshotRoots.map((activity) => activity.stableId),
    },
  ];
  const content = {
    schemaVersion: 2,
    curriculumId: "per-node-course",
    curriculumVersionId: "per-node-revision",
    curriculumRevision: 1,
    curriculumTitle: "Legacy per-node-course",
    week: {
      id: "per-node-section",
      stableId: "per-node-revision-section",
      order: 1,
      title: "Section",
      description: "Section description",
    },
    day: {
      id: "per-node-lesson",
      stableId: "per-node-revision-lesson",
      order: 1,
      title: "Lesson",
      description: "Lesson description",
      goal: "Complete the Activity graph",
      estimatedMinutes: 30,
      prerequisites: [],
      expectedOutcomes: [],
      depthLevel: "foundation",
      outOfScope: [],
      topics: [],
    },
    units: snapshotActivities.map((activity, index) => ({
      id: activity.id,
      stableId: activity.stableId,
      type: "summary",
      title: `Activity ${index + 1}`,
      description: "Summarize the lesson",
      order: index + 1,
      estimatedMinutes: 5,
      objectives: [],
      checklist: [],
      sources: [],
      questions: [],
      misconceptions: [],
      referenceAnswer: null,
      completionCriteria: [{ type: "acknowledgement" }],
      unlockRules: activity.prerequisiteStableIds.map((unitId) => ({
        type: "unit-completed",
        unitId,
      })),
      optional: false,
      depthLevel: "foundation",
      payload: { type: "summary", prompts: [] },
    })),
    capturedAt: "1970-01-01T00:00:00.001Z",
  };
  const contentHash = hashCanonicalJson(content);
  const snapshotJson = canonicalJson({ ...content, contentHash });

  connection.sqlite.exec(`
    INSERT INTO curriculum_days
      (id, slug, week_number, day_number, title, summary, estimated_minutes,
       goals_json, sources_json, created_at, updated_at)
    VALUES ('context-source-day', 'context-source-day', 99, 1, 'Context day',
            'Context summary', 30, '[]', '[]', 1, 1);
    INSERT INTO learning_sessions
      (id, day_id, status, current_step, idempotency_key, started_at,
       completed_at, updated_at, curriculum_day_v2_id)
    VALUES ('invalid-graph-session', 'context-source-day', 'completed', 'done',
            'invalid-graph-session', 1, 2, 2, 'per-node-lesson');
  `);
  connection.sqlite
    .prepare(
      `INSERT INTO session_snapshots
       (id, session_id, schema_version, curriculum_id, curriculum_version_id,
        curriculum_day_id, content_hash, snapshot_json, created_at)
       VALUES ('invalid-graph-snapshot', 'invalid-graph-session', 2,
               'per-node-course', 'per-node-revision', 'per-node-lesson',
               ?, ?, 1)`,
    )
    .run(contentHash, snapshotJson);
  connection.sqlite.exec(`
    INSERT INTO versioned_unit_evidence
      (id, session_id, unit_id, evidence_type, operation_id, question_id,
       payload_json, correctness, created_at)
    VALUES ('invalid-graph-evidence', 'invalid-graph-session',
            'per-node-root-unit-000', 'summary', 'invalid-graph-operation', NULL,
            '{"summary":"captured"}', NULL, 2);
  `);
}

function createExactPreM2Fixture(projectRoot: string): string {
  const migrationDirectory = path.join(projectRoot, "migrations-through-0005");
  mkdirSync(migrationDirectory);
  for (const filename of readdirSync(migrationsSource).filter((entry) =>
    /^000[0-5]_.*\.sql$/u.test(entry),
  )) {
    copyFileSync(
      path.join(migrationsSource, filename),
      path.join(migrationDirectory, filename),
    );
  }

  const databasePath = path.join(
    projectRoot,
    ".data",
    "dev-learning-harness.sqlite",
  );
  const connection = openDatabase(databasePath);
  try {
    migrateDatabase(connection, migrationDirectory);
    installExactPreM2ActiveContract(connection);

    insertLegacyCourse(connection, "lineage-course", "lineage-revision-2", [
      {
        id: "lineage-revision-1",
        revision: 1,
        parentId: null,
        sectionId: "lineage-section-1",
        lessonId: "lineage-lesson-1",
        activities: [
          {
            id: "lineage-activity-1",
            stableId: "lineage-activity",
            prerequisiteStableIds: [],
          },
        ],
      },
      {
        id: "lineage-revision-2",
        revision: 2,
        parentId: "lineage-revision-1",
        sectionId: "lineage-section-2",
        lessonId: "lineage-lesson-2",
        activities: [
          {
            id: "lineage-activity-2",
            stableId: "lineage-activity",
            prerequisiteStableIds: [],
          },
        ],
      },
    ]);

    insertLegacyCourse(connection, "node-limit-course", "node-limit-revision", [
      {
        id: "node-limit-revision",
        revision: 1,
        parentId: null,
        sectionId: "node-limit-section",
        lessonId: "node-limit-lesson",
        activities: activitySeries("node-limit", 501),
      },
    ]);

    const perNodeRoots = activitySeries("per-node-root", 101);
    insertLegacyCourse(connection, "per-node-course", "per-node-revision", [
      {
        id: "per-node-revision",
        revision: 1,
        parentId: null,
        sectionId: "per-node-section",
        lessonId: "per-node-lesson",
        activities: [
          ...perNodeRoots,
          {
            id: "per-node-dependent",
            stableId: "per-node-dependent",
            prerequisiteStableIds: perNodeRoots.map(
              (activity) => activity.stableId,
            ),
          },
        ],
      },
    ]);

    const edgeRoots = activitySeries("edge-root", 100);
    const edgeDependents = Array.from({ length: 51 }, (_, index) => {
      const suffix = String(index).padStart(3, "0");
      return {
        id: `edge-dependent-unit-${suffix}`,
        stableId: `edge-dependent-stable-${suffix}`,
        prerequisiteStableIds: edgeRoots.map((activity) => activity.stableId),
      };
    });
    insertLegacyCourse(connection, "edge-limit-course", "edge-limit-revision", [
      {
        id: "edge-limit-revision",
        revision: 1,
        parentId: null,
        sectionId: "edge-limit-section",
        lessonId: "edge-limit-lesson",
        activities: [...edgeRoots, ...edgeDependents],
      },
    ]);

    insertInvalidContextAndEvidence(connection);
  } finally {
    connection.close();
  }

  const standalone = new DatabaseSync(databasePath);
  standalone.exec("PRAGMA journal_mode = DELETE");
  standalone.close();
  return databasePath;
}

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

describe("Course foundation backfill graph admission", () => {
  it("preserves revision lineage and fully quarantines oversized Activity graphs", async () => {
    const projectRoot = temporaryRoot();
    const sourcePath = createExactPreM2Fixture(projectRoot);
    const backupPath = path.join(
      projectRoot,
      ".data",
      "approved-backups",
      "approved-pre-m2.sqlite",
    );
    await createApprovedM1Backup({
      projectRoot,
      sourcePath,
      destinationPath: backupPath,
    });
    const backupSha256 = sha256(readFileSync(backupPath));

    runM1MigrationCli({
      projectRoot,
      argv: [
        "--authorize-m2",
        "--approved-backup",
        backupPath,
        "--backup-sha256",
        backupSha256,
      ],
      writeStatus: () => undefined,
    });

    const connection = openDatabase(sourcePath, {
      readonly: true,
      fileMustExist: true,
    });
    try {
      const migrations = connection.sqlite
        .prepare("SELECT id FROM __dlh_migrations ORDER BY id")
        .all() as Array<{ id: string }>;
      expect(migrations.at(-1)?.id).toBe("0014_provider_hub");

      expect(
        connection.sqlite
          .prepare(
            `SELECT revision_number, parent_revision_id
               FROM course_revisions
               WHERE course_id = 'lineage-course'
               ORDER BY revision_number`,
          )
          .all(),
      ).toEqual([
        { revision_number: 1, parent_revision_id: null },
        {
          revision_number: 2,
          parent_revision_id: "lineage-revision-1",
        },
      ]);
      expect(
        connection.sqlite
          .prepare(
            `SELECT id FROM course_activities
               WHERE revision_id IN ('lineage-revision-1', 'lineage-revision-2')
               ORDER BY id`,
          )
          .all(),
      ).toEqual([{ id: "lineage-activity-1" }, { id: "lineage-activity-2" }]);

      expect(
        connection.sqlite
          .prepare(
            `SELECT id FROM course_lessons
               WHERE id IN ('node-limit-lesson', 'per-node-lesson',
                            'edge-limit-lesson')`,
          )
          .all(),
      ).toEqual([]);
      expect(
        connection.sqlite
          .prepare(
            `SELECT id FROM course_activities
               WHERE lesson_id IN ('node-limit-lesson', 'per-node-lesson',
                                   'edge-limit-lesson')`,
          )
          .all(),
      ).toEqual([]);

      const activityAccounting = connection.sqlite
        .prepare(
          `SELECT COUNT(*) AS source_count,
                    SUM(status = 'mapped') AS mapped_count,
                    SUM(status = 'quarantined') AS quarantined_count
             FROM migration_provenance
             WHERE transform_version = 'm2-v1'
               AND source_table = 'curriculum_units'`,
        )
        .get() as {
        source_count: number;
        mapped_count: number;
        quarantined_count: number;
      };
      expect(activityAccounting).toEqual({
        source_count: 756,
        mapped_count: 2,
        quarantined_count: 754,
      });

      const activityDiagnostics = connection.sqlite
        .prepare(
          `SELECT COUNT(*) AS source_count,
                    SUM(diagnostic IS NULL) AS missing_count,
                    MAX(length(diagnostic)) AS maximum_length
             FROM migration_provenance
             WHERE transform_version = 'm2-v1'
               AND source_table = 'curriculum_units'
               AND status = 'quarantined'`,
        )
        .get() as {
        source_count: number;
        missing_count: number;
        maximum_length: number;
      };
      expect(activityDiagnostics.source_count).toBe(754);
      expect(activityDiagnostics.missing_count).toBe(0);
      expect(activityDiagnostics.maximum_length).toBeLessThanOrEqual(500);
      expect(
        connection.sqlite
          .prepare(
            `SELECT COUNT(DISTINCT diagnostic) AS count
               FROM migration_provenance
               WHERE transform_version = 'm2-v1'
                 AND source_table = 'curriculum_units'
                 AND source_primary_key LIKE 'node-limit-unit-%'`,
          )
          .get(),
      ).toEqual({ count: 1 });

      const lessonDiagnostics = connection.sqlite
        .prepare(
          `SELECT source_primary_key, reason_code, diagnostic
             FROM migration_provenance
             WHERE transform_version = 'm2-v1'
               AND source_table = 'curriculum_days_v2'
               AND source_primary_key IN ('node-limit-lesson', 'per-node-lesson',
                                          'edge-limit-lesson')
             ORDER BY source_primary_key`,
        )
        .all() as Array<{
        source_primary_key: string;
        reason_code: string;
        diagnostic: string;
      }>;
      expect(lessonDiagnostics).toHaveLength(3);
      expect(
        lessonDiagnostics.every(
          (row) =>
            row.reason_code === "INVALID_ACTIVITY_GRAPH" &&
            row.diagnostic.length <= 500,
        ),
      ).toBe(true);
      expect(
        lessonDiagnostics.find(
          (row) => row.source_primary_key === "node-limit-lesson",
        )?.diagnostic,
      ).toContain("activity-limit-exceeded");
      expect(
        lessonDiagnostics.find(
          (row) => row.source_primary_key === "per-node-lesson",
        )?.diagnostic,
      ).toContain("prerequisite-limit-exceeded");
      expect(
        lessonDiagnostics.find(
          (row) => row.source_primary_key === "edge-limit-lesson",
        )?.diagnostic,
      ).toContain("edge-limit-exceeded");

      expect(
        connection.sqlite
          .prepare(
            `SELECT source_table, status
               FROM migration_provenance
               WHERE transform_version = 'm2-v1'
                 AND source_primary_key IN (
                   'invalid-graph-session', 'invalid-graph-snapshot',
                   'invalid-graph-evidence'
                 )
               ORDER BY source_table`,
          )
          .all(),
      ).toEqual([
        { source_table: "learning_sessions", status: "quarantined" },
        { source_table: "session_snapshots", status: "quarantined" },
        {
          source_table: "versioned_unit_evidence",
          status: "quarantined",
        },
      ]);
      expect(
        connection.sqlite
          .prepare(
            "SELECT session_id FROM session_course_contexts WHERE session_id = 'invalid-graph-session'",
          )
          .get(),
      ).toBeUndefined();
      expect(
        connection.sqlite
          .prepare(
            "SELECT id FROM evidence_facts WHERE id = 'invalid-graph-evidence'",
          )
          .get(),
      ).toBeUndefined();

      const run = connection.sqlite
        .prepare(
          `SELECT id, source_row_count, mapped_count, quarantined_count,
                    intentionally_unmapped_count
             FROM migration_runs
             WHERE transform_version = 'm2-v1'`,
        )
        .get() as {
        id: string;
        source_row_count: number;
        mapped_count: number;
        quarantined_count: number;
        intentionally_unmapped_count: number;
      };
      const provenanceCount = connection.sqlite
        .prepare(
          "SELECT COUNT(*) AS count FROM migration_provenance WHERE run_id = ?",
        )
        .get(run.id) as { count: number };
      const quarantineCount = connection.sqlite
        .prepare(
          "SELECT COUNT(*) AS count FROM migration_quarantine WHERE run_id = ?",
        )
        .get(run.id) as { count: number };
      expect(provenanceCount.count).toBe(run.source_row_count);
      expect(
        run.mapped_count +
          run.quarantined_count +
          run.intentionally_unmapped_count,
      ).toBe(run.source_row_count);
      expect(quarantineCount.count).toBe(run.quarantined_count);
      expect(
        connection.sqlite.prepare("PRAGMA foreign_key_check").all(),
      ).toEqual([]);
    } finally {
      connection.close();
    }
  }, 60_000);
});
