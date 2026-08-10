import { afterEach, describe, expect, it } from "vitest";

import {
  migrateDatabase,
  openDatabase,
  type DatabaseConnection,
} from "../src/database.js";

const connections: DatabaseConnection[] = [];

function currentConnection(): DatabaseConnection {
  const connection = openDatabase(":memory:");
  connections.push(connection);
  migrateDatabase(connection);
  return connection;
}

function insertTargetScopes(connection: DatabaseConnection): void {
  connection.sqlite.exec(`
    INSERT INTO courses
      (id, stable_id, slug, title, description, primary_locale,
       active_revision_id, created_at, updated_at)
    VALUES ('course', 'course', 'course', 'Course', NULL, 'en', NULL, 1, 1);
    INSERT INTO course_revisions
      (id, course_id, revision_number, parent_revision_id, branch_kind, status,
       title, description, content_hash, based_on_content_hash, created_at,
       published_at, archived_at, updated_at)
    VALUES
      ('draft-revision', 'course', 1, NULL, 'upstream', 'draft',
       'Draft', NULL, NULL, NULL, 1, NULL, NULL, 1),
      ('accepted-revision', 'course', 2, 'draft-revision', 'upstream', 'draft',
       'Accepted', NULL, NULL, NULL, 1, NULL, NULL, 1);
    INSERT INTO course_sections
      (id, course_id, revision_id, stable_id, order_index, title, description,
       created_at, updated_at)
    VALUES
      ('draft-section', 'course', 'draft-revision', 'section', 0, 'Section',
       NULL, 1, 1),
      ('accepted-section', 'course', 'accepted-revision', 'section', 0,
       'Section', NULL, 1, 1);
    INSERT INTO course_lessons
      (id, course_id, revision_id, section_id, stable_id, order_index, title,
       description, goal, estimated_minutes, expected_outcomes_json,
       depth_level, out_of_scope_json, topics_json, created_at, updated_at)
    VALUES
      ('draft-prerequisite-lesson', 'course', 'draft-revision',
       'draft-section', 'prerequisite-lesson', 0, 'Prerequisite',
       'Description', 'Goal', 5, '[]', 'foundation', '[]', '[]', 1, 1),
      ('draft-lesson', 'course', 'draft-revision', 'draft-section', 'lesson', 1,
       'Lesson', 'Description', 'Goal', 5, '[]', 'foundation', '[]', '[]', 1, 1),
      ('accepted-prerequisite-lesson', 'course', 'accepted-revision',
       'accepted-section', 'prerequisite-lesson', 0, 'Prerequisite',
       'Description', 'Goal', 5, '[]', 'foundation', '[]', '[]', 1, 1),
      ('accepted-lesson', 'course', 'accepted-revision', 'accepted-section',
       'lesson', 1, 'Lesson', 'Description', 'Goal', 5, '[]', 'foundation',
       '[]', '[]', 1, 1);
    INSERT INTO course_lesson_prerequisites
      (course_id, revision_id, lesson_id, prerequisite_lesson_id)
    VALUES
      ('course', 'draft-revision', 'draft-lesson',
       'draft-prerequisite-lesson'),
      ('course', 'accepted-revision', 'accepted-lesson',
       'accepted-prerequisite-lesson');
    INSERT INTO course_activities
      (id, course_id, revision_id, lesson_id, stable_id, activity_type,
       order_index, title, description, estimated_minutes, required,
       objectives_json, checklist_json, sources_json, questions_json,
       misconceptions_json, capability_ids_json, completion_criteria_json,
       payload_json, protected_material_json, depth_level, created_at,
       updated_at)
    VALUES
      ('draft-prerequisite-activity', 'course', 'draft-revision',
       'draft-lesson', 'prerequisite-activity', 'study', 0, 'Prerequisite',
       'Description', 5, 1, '[]', '[]', '[]', '[]', '[]', '[]',
       '[{"type":"acknowledgement"}]', '{}', '{}', 'foundation', 1, 1),
      ('draft-activity', 'course', 'draft-revision', 'draft-lesson', 'activity',
       'study', 1, 'Activity', 'Description', 5, 1, '[]', '[]', '[]', '[]',
       '[]', '[]', '[{"type":"acknowledgement"}]', '{}', '{}',
       'foundation', 1, 1),
      ('accepted-prerequisite-activity', 'course', 'accepted-revision',
       'accepted-lesson', 'prerequisite-activity', 'study', 0, 'Prerequisite',
       'Description', 5, 1, '[]', '[]', '[]', '[]', '[]', '[]',
       '[{"type":"acknowledgement"}]', '{}', '{}', 'foundation', 1, 1),
      ('accepted-activity', 'course', 'accepted-revision', 'accepted-lesson',
       'activity', 'study', 1, 'Activity', 'Description', 5, 1, '[]', '[]',
       '[]', '[]', '[]', '[]', '[{"type":"acknowledgement"}]', '{}', '{}',
       'foundation', 1, 1);
    INSERT INTO course_activity_prerequisites
      (course_id, revision_id, lesson_id, activity_id,
       prerequisite_activity_id)
    VALUES
      ('course', 'draft-revision', 'draft-lesson', 'draft-activity',
       'draft-prerequisite-activity'),
      ('course', 'accepted-revision', 'accepted-lesson', 'accepted-activity',
       'accepted-prerequisite-activity');
    UPDATE course_revisions
    SET status = 'published', content_hash = '${"a".repeat(64)}',
        published_at = 2, updated_at = 2
    WHERE id = 'accepted-revision';
  `);
}

function insertLegacyScopes(connection: DatabaseConnection): void {
  connection.sqlite.exec(`
    INSERT INTO curricula
      (id, slug, title, description, active_version_id, created_at, updated_at)
    VALUES ('legacy-course', 'legacy-course', 'Legacy Course', NULL, NULL, 1, 1);
    INSERT INTO curriculum_versions
      (id, curriculum_id, revision, parent_version_id, status, title,
       description, content_hash, created_at, published_at, archived_at,
       updated_at)
    VALUES
      ('draft-version', 'legacy-course', 1, NULL, 'draft', 'Draft', NULL, NULL,
       1, NULL, NULL, 1),
      ('accepted-version', 'legacy-course', 2, 'draft-version', 'draft',
       'Accepted', NULL, NULL, 1, NULL, NULL, 1);
    INSERT INTO curriculum_weeks
      (id, version_id, stable_id, order_index, title, description, created_at,
       updated_at)
    VALUES
      ('draft-week', 'draft-version', 'week', 0, 'Week', NULL, 1, 1),
      ('accepted-week', 'accepted-version', 'week', 0, 'Week', NULL, 1, 1);
    INSERT INTO curriculum_days_v2
      (id, version_id, week_id, stable_id, order_index, title, description, goal,
       estimated_minutes, prerequisites_json, expected_outcomes_json,
       depth_level, out_of_scope_json, topics_json, created_at, updated_at)
    VALUES
      ('draft-day', 'draft-version', 'draft-week', 'day', 0, 'Day',
       'Description', 'Goal', 5, '[]', '[]', 'foundation', '[]', '[]', 1, 1),
      ('accepted-day', 'accepted-version', 'accepted-week', 'day', 0, 'Day',
       'Description', 'Goal', 5, '[]', '[]', 'foundation', '[]', '[]', 1, 1);
    INSERT INTO curriculum_units
      (id, version_id, day_id, stable_id, type, order_index, title, description,
       estimated_minutes, objectives_json, checklist_json, sources_json,
       questions_json, misconceptions_json, reference_answer_json,
       completion_criteria_json, unlock_rules_json, optional, depth_level,
       payload_json, created_at, updated_at)
    VALUES
      ('draft-unit', 'draft-version', 'draft-day', 'unit', 'study', 0, 'Unit',
       'Description', 5, '[]', '[]', '[]', '[]', '[]', NULL,
       '[{"type":"acknowledgement"}]', '[]', 0, 'foundation', '{}', 1, 1),
      ('accepted-unit', 'accepted-version', 'accepted-day', 'unit', 'study', 0,
       'Unit', 'Description', 5, '[]', '[]', '[]', '[]', '[]', NULL,
       '[{"type":"acknowledgement"}]', '[]', 0, 'foundation', '{}', 1, 1);
    UPDATE curriculum_versions
    SET status = 'published', content_hash = '${"b".repeat(64)}',
        published_at = 2, updated_at = 2
    WHERE id = 'accepted-version';
  `);
}

afterEach(() => {
  while (connections.length > 0) connections.pop()?.close();
});

describe("M2 acceptance hardening migration", () => {
  it("rejects both directions of accepted target descendant scope moves", () => {
    const connection = currentConnection();
    insertTargetScopes(connection);
    const statements = [
      [
        "UPDATE course_sections SET revision_id = 'accepted-revision' WHERE id = 'draft-section'",
        "UPDATE course_sections SET revision_id = 'draft-revision' WHERE id = 'accepted-section'",
      ],
      [
        "UPDATE course_lessons SET revision_id = 'accepted-revision', section_id = 'accepted-section' WHERE id = 'draft-lesson'",
        "UPDATE course_lessons SET revision_id = 'draft-revision', section_id = 'draft-section' WHERE id = 'accepted-lesson'",
      ],
      [
        "UPDATE course_lesson_prerequisites SET revision_id = 'accepted-revision', lesson_id = 'accepted-lesson', prerequisite_lesson_id = 'accepted-prerequisite-lesson' WHERE revision_id = 'draft-revision'",
        "UPDATE course_lesson_prerequisites SET revision_id = 'draft-revision', lesson_id = 'draft-lesson', prerequisite_lesson_id = 'draft-prerequisite-lesson' WHERE revision_id = 'accepted-revision'",
      ],
      [
        "UPDATE course_activities SET revision_id = 'accepted-revision', lesson_id = 'accepted-lesson' WHERE id = 'draft-activity'",
        "UPDATE course_activities SET revision_id = 'draft-revision', lesson_id = 'draft-lesson' WHERE id = 'accepted-activity'",
      ],
      [
        "UPDATE course_activity_prerequisites SET revision_id = 'accepted-revision', lesson_id = 'accepted-lesson', activity_id = 'accepted-activity', prerequisite_activity_id = 'accepted-prerequisite-activity' WHERE revision_id = 'draft-revision'",
        "UPDATE course_activity_prerequisites SET revision_id = 'draft-revision', lesson_id = 'draft-lesson', activity_id = 'draft-activity', prerequisite_activity_id = 'draft-prerequisite-activity' WHERE revision_id = 'accepted-revision'",
      ],
    ] as const;

    for (const directions of statements) {
      for (const statement of directions) {
        expect(() => connection.sqlite.exec(statement)).toThrow(
          "accepted course revision descendants are immutable",
        );
      }
    }
    expect(connection.sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual(
      [],
    );
  });

  it("rejects both directions of published legacy descendant scope moves", () => {
    const connection = currentConnection();
    insertLegacyScopes(connection);
    const statements = [
      "UPDATE curriculum_weeks SET version_id = 'accepted-version' WHERE id = 'draft-week'",
      "UPDATE curriculum_weeks SET version_id = 'draft-version' WHERE id = 'accepted-week'",
      "UPDATE curriculum_days_v2 SET version_id = 'accepted-version', week_id = 'accepted-week' WHERE id = 'draft-day'",
      "UPDATE curriculum_days_v2 SET version_id = 'draft-version', week_id = 'draft-week' WHERE id = 'accepted-day'",
      "UPDATE curriculum_units SET version_id = 'accepted-version', day_id = 'accepted-day' WHERE id = 'draft-unit'",
      "UPDATE curriculum_units SET version_id = 'draft-version', day_id = 'draft-day' WHERE id = 'accepted-unit'",
    ];
    for (const statement of statements) {
      expect(() => connection.sqlite.exec(statement)).toThrow(
        "published curriculum version is immutable",
      );
    }
    expect(connection.sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual(
      [],
    );
  });

  it("freezes accepted timestamps except during published-to-archived transition", () => {
    const connection = currentConnection();
    insertTargetScopes(connection);
    expect(() =>
      connection.sqlite.exec(
        "UPDATE course_revisions SET updated_at = 3 WHERE id = 'accepted-revision'",
      ),
    ).toThrow("accepted course revision is immutable");
    expect(() =>
      connection.sqlite.exec(
        "UPDATE course_revisions SET archived_at = 3 WHERE id = 'accepted-revision'",
      ),
    ).toThrow("accepted course revision is immutable");

    connection.sqlite.exec(`
      UPDATE course_revisions
      SET status = 'archived', archived_at = 3, updated_at = 3
      WHERE id = 'accepted-revision'
    `);
    expect(() =>
      connection.sqlite.exec(
        "UPDATE course_revisions SET updated_at = 4 WHERE id = 'accepted-revision'",
      ),
    ).toThrow("accepted course revision is immutable");
    expect(
      connection.sqlite
        .prepare(
          "SELECT status, archived_at, updated_at FROM course_revisions WHERE id = 'accepted-revision'",
        )
        .get(),
    ).toEqual({ status: "archived", archived_at: 3, updated_at: 3 });
  });

  it("rejects cross-Course source parents before source or projection writes", () => {
    const connection = currentConnection();
    connection.sqlite.exec(`
      INSERT INTO curricula
        (id, slug, title, description, active_version_id, created_at, updated_at)
      VALUES
        ('course-a', 'course-a', 'Course A', NULL, NULL, 1, 1),
        ('course-b', 'course-b', 'Course B', NULL, NULL, 1, 1);
      INSERT INTO curriculum_versions
        (id, curriculum_id, revision, parent_version_id, status, title,
         description, content_hash, created_at, published_at, archived_at,
         updated_at)
      VALUES
        ('a-root', 'course-a', 1, NULL, 'draft', 'A root', NULL, NULL,
         1, NULL, NULL, 1),
        ('b-root', 'course-b', 1, NULL, 'draft', 'B root', NULL, NULL,
         1, NULL, NULL, 1),
        ('a-child', 'course-a', 2, 'a-root', 'draft', 'A child', NULL, NULL,
         1, NULL, NULL, 1);
    `);

    expect(() =>
      connection.sqlite.exec(`
        INSERT INTO curriculum_versions
          (id, curriculum_id, revision, parent_version_id, status, title,
           description, content_hash, created_at, published_at, archived_at,
           updated_at)
        VALUES ('cross-child', 'course-a', 3, 'b-root', 'draft', 'Cross', NULL,
                NULL, 1, NULL, NULL, 1)
      `),
    ).toThrow("curriculum version parent scope is invalid");
    expect(
      connection.sqlite
        .prepare("SELECT id FROM curriculum_versions WHERE id = 'cross-child'")
        .get(),
    ).toBeUndefined();
    expect(
      connection.sqlite
        .prepare("SELECT id FROM course_revisions WHERE id = 'cross-child'")
        .get(),
    ).toBeUndefined();

    expect(() =>
      connection.sqlite.exec(
        "UPDATE curriculum_versions SET parent_version_id = 'b-root' WHERE id = 'a-child'",
      ),
    ).toThrow("curriculum version parent scope is invalid");
    expect(
      connection.sqlite
        .prepare(
          "SELECT parent_version_id FROM curriculum_versions WHERE id = 'a-child'",
        )
        .get(),
    ).toEqual({ parent_version_id: "a-root" });
    expect(
      connection.sqlite
        .prepare(
          "SELECT parent_revision_id FROM course_revisions WHERE id = 'a-child'",
        )
        .get(),
    ).toEqual({ parent_revision_id: "a-root" });
  });

  it("removes the legacy-v1 published mutability exception", () => {
    const connection = currentConnection();
    connection.sqlite.exec(`
      INSERT INTO curricula
        (id, slug, title, description, active_version_id, created_at, updated_at)
      VALUES ('legacy-curriculum', 'legacy-curriculum', 'Legacy', NULL, NULL, 1, 1);
      PRAGMA ignore_check_constraints = ON;
      INSERT INTO curriculum_versions
        (id, curriculum_id, revision, parent_version_id, status, title,
         description, content_hash, created_at, published_at, archived_at,
         updated_at)
      VALUES ('legacy-v1', 'legacy-curriculum', 1, NULL, 'published', 'Legacy',
              NULL, 'legacy-v1', 1, 1, NULL, 1);
      PRAGMA ignore_check_constraints = OFF;
    `);
    expect(() =>
      connection.sqlite.exec(
        "UPDATE curriculum_versions SET title = 'Changed' WHERE id = 'legacy-v1'",
      ),
    ).toThrow("published curriculum version is immutable");
    expect(
      connection.sqlite
        .prepare("SELECT title FROM curriculum_versions WHERE id = 'legacy-v1'")
        .get(),
    ).toEqual({ title: "Legacy" });
  });

  it("rejects forged embedded snapshot scope before context synchronization", () => {
    const connection = currentConnection();
    insertLegacyScopes(connection);
    connection.sqlite.exec(`
      INSERT INTO curriculum_days
        (id, slug, week_number, day_number, title, summary, estimated_minutes,
         goals_json, sources_json, created_at, updated_at)
      VALUES ('old-day', 'old-day', 1, 1, 'Old day', 'Summary', 5, '[]', '[]', 1, 1);
      INSERT INTO learning_sessions
        (id, day_id, status, current_step, idempotency_key, started_at,
         completed_at, updated_at, curriculum_day_v2_id)
      VALUES ('snapshot-session', 'old-day', 'active', 'study', NULL, 1, NULL,
              1, 'draft-day');
    `);
    const contentHash = "e".repeat(64);
    const envelope = {
      schemaVersion: 2,
      contentHash,
      curriculumId: "legacy-course",
      curriculumVersionId: "draft-version",
      curriculumRevision: 1,
      day: { id: "draft-day" },
    };
    const insert = connection.sqlite.prepare(
      `INSERT INTO session_snapshots
         (id, session_id, schema_version, curriculum_id,
          curriculum_version_id, curriculum_day_id, content_hash,
          snapshot_json, created_at)
       VALUES (?, 'snapshot-session', 2, 'legacy-course', 'draft-version',
               'draft-day', ?, ?, 1)`,
    );
    expect(() =>
      insert.run(
        "forged-snapshot",
        contentHash,
        JSON.stringify({ ...envelope, curriculumId: "forged-course" }),
      ),
    ).toThrow("session snapshot course scope is invalid");
    expect(
      connection.sqlite
        .prepare(
          "SELECT session_id FROM session_course_contexts WHERE session_id = 'snapshot-session'",
        )
        .get(),
    ).toBeUndefined();

    insert.run("valid-envelope", contentHash, JSON.stringify(envelope));
    expect(
      connection.sqlite
        .prepare(
          "SELECT session_snapshot_id FROM session_course_contexts WHERE session_id = 'snapshot-session'",
        )
        .get(),
    ).toEqual({ session_snapshot_id: "valid-envelope" });
  });

  it("records exactly one immutable run for each final M2 stage", () => {
    const connection = currentConnection();
    for (const transformVersion of ["m2-v3", "m2-v4"] as const) {
      expect(
        connection.sqlite
          .prepare(
            "SELECT count(*) AS count FROM migration_runs WHERE transform_version = ?",
          )
          .get(transformVersion),
      ).toEqual({ count: 1 });
      expect(() =>
        connection.sqlite
          .prepare(
            "UPDATE migration_runs SET completed_at = completed_at + 1 WHERE transform_version = ?",
          )
          .run(transformVersion),
      ).toThrow("migration run is append-only");
      expect(() =>
        connection.sqlite
          .prepare("DELETE FROM migration_runs WHERE transform_version = ?")
          .run(transformVersion),
      ).toThrow("migration run is append-only");
    }
  });
});
