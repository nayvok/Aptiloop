import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { SessionSnapshot } from "@dlh/shared";
import { afterEach, describe, expect, it } from "vitest";

import {
  canonicalJson,
  hashCanonicalJson,
  openDatabase,
  type DatabaseConnection,
} from "../src/index.js";
import { backfillCourseFoundations } from "../src/course-foundation-backfill.js";

const migrationsDirectory = fileURLToPath(
  new URL("../migrations", import.meta.url),
);
const connections: DatabaseConnection[] = [];
const protectedSnapshotMarker = "protected-snapshot-marker";

const studyUnit: SessionSnapshot["units"][number] = {
  id: "activity-study-r2",
  stableId: "activity-study-r2",
  type: "study" as const,
  title: "Study",
  description: "Read the material",
  order: 1,
  estimatedMinutes: 5,
  objectives: [],
  checklist: [],
  sources: [],
  questions: [],
  misconceptions: [],
  referenceAnswer: protectedSnapshotMarker,
  completionCriteria: [{ type: "acknowledgement" as const }],
  unlockRules: [],
  optional: false,
  depthLevel: "foundation" as const,
  payload: { type: "study" as const, body: "Read the material" },
};
const summaryUnit: SessionSnapshot["units"][number] = {
  ...studyUnit,
  id: "activity-summary-r2",
  stableId: "activity-summary-r2",
  type: "summary" as const,
  title: "Summary",
  description: "Summarize the material",
  order: 2,
  referenceAnswer: null,
  payload: { type: "summary" as const, prompts: [] },
};
const snapshotCore: Omit<SessionSnapshot, "contentHash"> = {
  schemaVersion: 2,
  curriculumId: "course-snapshot",
  curriculumVersionId: "revision-r2",
  curriculumRevision: 2,
  curriculumTitle: "Snapshot Course",
  week: {
    id: "section-r2",
    stableId: "section-r2",
    order: 1,
    title: "Section",
    description: null,
  },
  day: {
    id: "lesson-r2",
    stableId: "lesson-r2",
    order: 1,
    title: "Lesson",
    description: "Learn safely",
    goal: "Complete the lesson",
    estimatedMinutes: 10,
    prerequisites: [],
    expectedOutcomes: [],
    depthLevel: "foundation" as const,
    outOfScope: [],
    topics: [],
  },
  units: [studyUnit, summaryUnit],
  capturedAt: "2026-08-09T00:00:00.000Z",
};

afterEach(() => {
  while (connections.length > 0) connections.pop()?.close();
});

function createPreM2Fixture(): DatabaseConnection {
  const connection = openDatabase(":memory:");
  connections.push(connection);
  for (const id of [
    "0000_initial",
    "0001_versioned_curriculum",
    "0002_snapshot_contract_and_hints",
    "0003_unit_evidence",
    "0004_unit_progress_compatibility",
    "0005_test_run_diff_fingerprint",
  ]) {
    connection.sqlite.exec(
      readFileSync(join(migrationsDirectory, `${id}.sql`), "utf8"),
    );
  }
  const now = Date.UTC(2026, 7, 9);
  connection.sqlite.exec(`
    INSERT INTO curriculum_days
      (id, slug, week_number, day_number, title, summary, estimated_minutes,
       goals_json, sources_json, created_at, updated_at)
    VALUES ('legacy-day', 'legacy-day', 1, 1, 'Legacy day', 'Legacy', 10,
            '[]', '[]', ${now}, ${now});
    INSERT INTO curricula
      (id, slug, title, description, active_version_id, created_at, updated_at)
    VALUES ('course-snapshot', 'course-snapshot', 'Snapshot Course', NULL, NULL,
            ${now}, ${now});
    INSERT INTO curriculum_versions
      (id, curriculum_id, revision, parent_version_id, status, title,
       description, content_hash, created_at, published_at, archived_at,
       updated_at)
    VALUES
      ('revision-r1', 'course-snapshot', 1, NULL, 'draft', 'Revision 1',
       NULL, '${"a".repeat(64)}', ${now}, NULL, NULL, ${now}),
      ('revision-r2', 'course-snapshot', 2, 'revision-r1', 'draft',
       'Revision 2', NULL, '${"b".repeat(64)}', ${now + 1}, NULL, NULL,
       ${now + 1});
    UPDATE curricula SET active_version_id = 'revision-r2'
    WHERE id = 'course-snapshot';
    INSERT INTO curriculum_weeks
      (id, version_id, stable_id, order_index, title, description, created_at,
       updated_at)
    VALUES ('section-r2', 'revision-r2', 'section-r2', 0, 'Section', NULL,
            ${now + 1}, ${now + 1});
    INSERT INTO curriculum_days_v2
      (id, version_id, week_id, stable_id, order_index, title, description,
       goal, estimated_minutes, prerequisites_json, expected_outcomes_json,
       depth_level, out_of_scope_json, topics_json, created_at, updated_at)
    VALUES ('lesson-r2', 'revision-r2', 'section-r2', 'lesson-r2', 0,
            'Lesson', 'Learn safely', 'Complete the lesson', 10, '[]', '[]',
            'foundation', '[]', '[]', ${now + 1}, ${now + 1});
    INSERT INTO curriculum_units
      (id, version_id, day_id, stable_id, type, order_index, title, description,
       estimated_minutes, objectives_json, checklist_json, sources_json,
       questions_json, misconceptions_json, reference_answer_json,
       completion_criteria_json, unlock_rules_json, optional, depth_level,
       payload_json, created_at, updated_at)
    VALUES
      ('activity-study-r2', 'revision-r2', 'lesson-r2', 'activity-study-r2',
       'study', 0, 'Study', 'Read the material', 5, '[]', '[]', '[]', '[]',
       '[]', '${JSON.stringify(protectedSnapshotMarker)}',
       '[{"type":"acknowledgement"}]', '[]', 0, 'foundation',
       '{"type":"study","body":"Read the material"}', ${now + 1},
       ${now + 1}),
      ('activity-summary-r2', 'revision-r2', 'lesson-r2',
       'activity-summary-r2', 'summary', 1, 'Summary',
       'Summarize the material', 5, '[]', '[]', '[]', '[]', '[]', NULL,
       '[{"type":"acknowledgement"}]', '[]', 0, 'foundation',
       '{"type":"summary","prompts":[]}', ${now + 1}, ${now + 1});
    UPDATE curriculum_versions
    SET status = 'published', published_at = ${now + 1}
    WHERE id IN ('revision-r1', 'revision-r2');
  `);
  return connection;
}

function canonicalSnapshot(core: Record<string, unknown>): {
  contentHash: string;
  snapshotJson: string;
} {
  const contentHash = hashCanonicalJson(core);
  return {
    contentHash,
    snapshotJson: canonicalJson({ ...core, contentHash }),
  };
}

function insertSnapshotCandidate(
  connection: DatabaseConnection,
  input: {
    id: string;
    core?: Record<string, unknown>;
    snapshotJson?: string;
    storedContentHash?: string;
    schemaVersion?: number;
  },
): void {
  const canonical = canonicalSnapshot(input.core ?? snapshotCore);
  const now = Date.UTC(2026, 7, 9);
  connection.sqlite
    .prepare(
      `INSERT INTO learning_sessions
       (id, day_id, status, current_step, started_at, completed_at, updated_at,
        curriculum_day_v2_id)
       VALUES (?, 'legacy-day', 'completed', 'done', ?, ?, ?, 'lesson-r2')`,
    )
    .run(input.id, now, now, now);
  connection.sqlite
    .prepare(
      `INSERT INTO session_snapshots
       (id, session_id, schema_version, curriculum_id, curriculum_version_id,
        curriculum_day_id, content_hash, snapshot_json, created_at)
       VALUES (?, ?, ?, 'course-snapshot', 'revision-r2', 'lesson-r2', ?, ?, ?)`,
    )
    .run(
      `snapshot:${input.id}`,
      input.id,
      input.schemaVersion ?? 2,
      input.storedContentHash ?? canonical.contentHash,
      input.snapshotJson ?? canonical.snapshotJson,
      now,
    );
}

describe("Course foundation snapshot backfill", () => {
  it("maps only a strict canonical revision-2 snapshot with an exact Activity sequence", () => {
    const connection = createPreM2Fixture();
    insertSnapshotCandidate(connection, { id: "session-valid" });
    insertSnapshotCandidate(connection, {
      id: "session-malformed",
      snapshotJson: '{"malformed":',
    });
    insertSnapshotCandidate(connection, {
      id: "session-unknown-field",
      core: {
        ...snapshotCore,
        unexpectedProtectedField: protectedSnapshotMarker,
      },
    });
    insertSnapshotCandidate(connection, {
      id: "session-identity-mismatch",
      core: { ...snapshotCore, curriculumId: "other-course" },
    });
    insertSnapshotCandidate(connection, {
      id: "session-revision-number-mismatch",
      core: { ...snapshotCore, curriculumRevision: 3 },
    });
    insertSnapshotCandidate(connection, {
      id: "session-hash-mismatch",
      storedContentHash: "0".repeat(64),
    });
    insertSnapshotCandidate(connection, {
      id: "session-extra-activity",
      core: {
        ...snapshotCore,
        units: [
          ...snapshotCore.units,
          {
            ...studyUnit,
            id: "activity-extra",
            stableId: "activity-extra",
            order: 3,
          },
        ],
      },
    });
    insertSnapshotCandidate(connection, {
      id: "session-missing-activity",
      core: { ...snapshotCore, units: [studyUnit] },
    });
    insertSnapshotCandidate(connection, {
      id: "session-retyped-activity",
      core: {
        ...snapshotCore,
        units: [
          {
            ...studyUnit,
            type: "summary" as const,
            payload: { type: "summary" as const, prompts: [] },
          },
          summaryUnit,
        ],
      },
    });
    insertSnapshotCandidate(connection, {
      id: "session-schema-mismatch",
      schemaVersion: 3,
    });

    const migration = readFileSync(
      join(migrationsDirectory, "0006_course_foundations.sql"),
      "utf8",
    );
    const [beforeBackfill] = migration.split(
      "-- dlh-course-foundations-backfill",
    );
    if (!beforeBackfill) throw new Error("Missing Course backfill boundary");
    connection.sqlite.exec("BEGIN IMMEDIATE");
    connection.sqlite.exec(beforeBackfill);
    backfillCourseFoundations(connection, {
      sourceDatabaseDigest: "f".repeat(64),
    });
    connection.sqlite.exec("COMMIT");

    expect(
      connection.sqlite
        .prepare(
          "SELECT session_id FROM session_course_contexts ORDER BY session_id",
        )
        .all(),
    ).toEqual([{ session_id: "session-valid" }]);
    const provenance = connection.sqlite
      .prepare(
        `SELECT source_primary_key AS sourcePrimaryKey, status, reason_code AS reasonCode,
                diagnostic
         FROM migration_provenance
         WHERE source_table = 'session_snapshots'
         ORDER BY source_primary_key`,
      )
      .all() as Array<Record<string, unknown>>;
    expect(
      provenance.find(
        (row) => row.sourcePrimaryKey === "snapshot:session-valid",
      )?.status,
    ).toBe("mapped");
    expect(
      provenance
        .filter((row) => row.sourcePrimaryKey !== "snapshot:session-valid")
        .every(
          (row) =>
            row.status === "quarantined" &&
            row.reasonCode === "MALFORMED_SESSION_CONTEXT",
        ),
    ).toBe(true);
    expect(JSON.stringify(provenance)).not.toContain(protectedSnapshotMarker);
  });
});
