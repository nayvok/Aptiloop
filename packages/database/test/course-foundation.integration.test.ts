import { afterEach, describe, expect, it } from "vitest";
import type { SessionSnapshot } from "@aptiloop/shared";

import {
  canonicalJson,
  CourseFoundationRepository,
  hashCanonicalJson,
  migrateDatabase,
  openDatabase,
  type DatabaseConnection,
} from "../src/index.js";

const connections: DatabaseConnection[] = [];

function currentConnection(): DatabaseConnection {
  const connection = openDatabase(":memory:");
  connections.push(connection);
  migrateDatabase(connection);
  return connection;
}

afterEach(() => {
  while (connections.length > 0) connections.pop()?.close();
});

function insertCourseGraph(
  connection: DatabaseConnection,
  fixture: {
    courseId: string;
    revisionId: string;
    sectionId: string;
    lessonId: string;
    activityId: string;
    stablePrefix: string;
    order: number;
  },
): void {
  const now = Date.UTC(2026, 0, 1) + fixture.order;
  connection.sqlite
    .prepare(
      `INSERT INTO courses
       (id, stable_id, slug, title, description, primary_locale,
        active_revision_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, 'en', NULL, ?, ?)`,
    )
    .run(
      fixture.courseId,
      fixture.stablePrefix,
      fixture.stablePrefix,
      `Course ${fixture.stablePrefix}`,
      now,
      now,
    );
  connection.sqlite
    .prepare(
      `INSERT INTO course_revisions
       (id, course_id, revision_number, parent_revision_id, branch_kind,
        status, title, description, content_hash, based_on_content_hash,
        created_at, published_at, archived_at, updated_at)
       VALUES (?, ?, 1, NULL, 'upstream', 'draft', ?, NULL, NULL, NULL,
               ?, NULL, NULL, ?)`,
    )
    .run(fixture.revisionId, fixture.courseId, "Revision 1", now, now);
  connection.sqlite
    .prepare(
      `INSERT INTO course_sections
       (id, course_id, revision_id, stable_id, order_index, title,
        description, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, 'Section', NULL, ?, ?)`,
    )
    .run(
      fixture.sectionId,
      fixture.courseId,
      fixture.revisionId,
      `${fixture.stablePrefix}-section`,
      now,
      now,
    );
  connection.sqlite
    .prepare(
      `INSERT INTO course_lessons
       (id, course_id, revision_id, section_id, stable_id, order_index,
        title, description, goal, estimated_minutes, expected_outcomes_json,
        depth_level, out_of_scope_json, topics_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, 'Lesson', 'Learner-safe description',
               'Complete the summary', 5, '[]', 'foundation', '[]', '[]', ?, ?)`,
    )
    .run(
      fixture.lessonId,
      fixture.courseId,
      fixture.revisionId,
      fixture.sectionId,
      `${fixture.stablePrefix}-lesson`,
      now,
      now,
    );
  connection.sqlite
    .prepare(
      `INSERT INTO course_activities
       (id, course_id, revision_id, lesson_id, stable_id, activity_type,
        order_index, title, description, estimated_minutes, required,
        objectives_json, checklist_json, sources_json, questions_json,
        misconceptions_json, capability_ids_json, completion_criteria_json,
        payload_json, protected_material_json, depth_level, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'summary', 0, 'Summary', 'Summarize the lesson',
               5, 1, '[]', '[]', '[]', '[]', '[]', '[]',
               '[{"type":"acknowledgement"}]',
               '{"type":"summary","prompts":[]}',
               '{"referenceAnswer":null,"questions":[]}',
               'foundation', ?, ?)`,
    )
    .run(
      fixture.activityId,
      fixture.courseId,
      fixture.revisionId,
      fixture.lessonId,
      `${fixture.stablePrefix}-activity`,
      now,
      now,
    );
  connection.sqlite
    .prepare("UPDATE courses SET active_revision_id = ? WHERE id = ?")
    .run(fixture.revisionId, fixture.courseId);
}

describe("CourseFoundationRepository", () => {
  it("orders Course summaries explicitly and isolates two revision graphs", async () => {
    const connection = currentConnection();
    insertCourseGraph(connection, {
      courseId: "course-z",
      revisionId: "revision-z",
      sectionId: "section-z",
      lessonId: "lesson-z",
      activityId: "activity-z",
      stablePrefix: "z-course",
      order: 2,
    });
    insertCourseGraph(connection, {
      courseId: "course-a",
      revisionId: "revision-a",
      sectionId: "section-a",
      lessonId: "lesson-a",
      activityId: "activity-a",
      stablePrefix: "a-course",
      order: 1,
    });

    const repository = new CourseFoundationRepository(connection);
    const courses = await repository.listCourses();
    expect(courses.map((course) => course.id)).toEqual([
      "course-a",
      "course-z",
    ]);
    expect(courses[0]?.revisions.map((revision) => revision.id)).toEqual([
      "revision-a",
    ]);

    const graph = await repository.getCourseRevision("revision-a");
    expect(graph?.course.id).toBe("course-a");
    expect(graph?.lessons.map((lesson) => lesson.id)).toEqual(["lesson-a"]);
    expect(
      graph?.lessons[0]?.activities.map((activity) => activity.id),
    ).toEqual(["activity-a"]);
    expect(JSON.stringify(graph)).not.toContain("referenceAnswer");
    expect(await repository.getCourseRevision("missing-revision")).toBeNull();
  });

  it("enforces composite ownership and published descendant immutability", () => {
    const connection = currentConnection();
    insertCourseGraph(connection, {
      courseId: "course-a",
      revisionId: "revision-a",
      sectionId: "section-a",
      lessonId: "lesson-a",
      activityId: "activity-a",
      stablePrefix: "a-course",
      order: 1,
    });
    insertCourseGraph(connection, {
      courseId: "course-b",
      revisionId: "revision-b",
      sectionId: "section-b",
      lessonId: "lesson-b",
      activityId: "activity-b",
      stablePrefix: "b-course",
      order: 2,
    });

    expect(() =>
      connection.sqlite
        .prepare(
          `INSERT INTO course_activity_prerequisites
           (course_id, revision_id, lesson_id, activity_id,
            prerequisite_activity_id)
           VALUES ('course-a', 'revision-a', 'lesson-a', 'activity-a',
                   'activity-b')`,
        )
        .run(),
    ).toThrow();

    connection.sqlite
      .prepare(
        `UPDATE course_revisions
         SET status = 'published', content_hash = ?, published_at = ?,
             updated_at = ?
         WHERE id = 'revision-a'`,
      )
      .run("a".repeat(64), Date.UTC(2026, 0, 2), Date.UTC(2026, 0, 2));
    expect(() =>
      connection.sqlite
        .prepare(
          "UPDATE course_activities SET title = 'Changed' WHERE id = 'activity-a'",
        )
        .run(),
    ).toThrow("accepted course revision descendants are immutable");
    expect(connection.sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual(
      [],
    );
  });

  it("returns explicit immutable session context and ordered learner-safe evidence", async () => {
    const connection = currentConnection();
    const now = Date.UTC(2026, 0, 1);
    const snapshotCore: Omit<SessionSnapshot, "contentHash"> = {
      schemaVersion: 2,
      curriculumId: "course-a",
      curriculumVersionId: "revision-a",
      curriculumRevision: 1,
      curriculumTitle: "Legacy Course",
      week: {
        id: "section-a",
        stableId: "section-a",
        order: 1,
        title: "Legacy section",
        description: null,
      },
      day: {
        id: "lesson-a",
        stableId: "lesson-a",
        order: 1,
        title: "Legacy lesson",
        description: "Learner-safe description",
        goal: "Complete summary",
        estimatedMinutes: 5,
        prerequisites: [],
        expectedOutcomes: [],
        depthLevel: "foundation",
        outOfScope: [],
        topics: [],
      },
      units: [
        {
          id: "activity-a",
          stableId: "activity-a",
          type: "summary",
          title: "Summary activity",
          description: "Write a summary",
          order: 1,
          estimatedMinutes: 5,
          objectives: [],
          checklist: [],
          sources: [],
          questions: [],
          misconceptions: [],
          referenceAnswer: null,
          completionCriteria: [{ type: "acknowledgement" }],
          unlockRules: [],
          optional: false,
          depthLevel: "foundation",
          payload: { type: "summary", prompts: [] },
        },
      ],
      capturedAt: new Date(now).toISOString(),
    };
    const snapshotHash = hashCanonicalJson(snapshotCore);
    const snapshotJson = canonicalJson({
      ...snapshotCore,
      contentHash: snapshotHash,
    });
    connection.sqlite.exec(`
      INSERT INTO curriculum_days
      (id, slug, week_number, day_number, title, summary, estimated_minutes,
       goals_json, sources_json, created_at, updated_at)
      VALUES ('legacy-day', 'legacy-day', 1, 1, 'Legacy day', 'Summary', 5,
              '[]', '[]', ${now}, ${now});
      INSERT INTO curricula
      (id, slug, title, description, active_version_id, created_at, updated_at)
      VALUES ('course-a', 'course-a', 'Legacy Course', NULL, NULL, ${now}, ${now});
      INSERT INTO curriculum_versions
      (id, curriculum_id, revision, parent_version_id, status, title,
       description, content_hash, created_at, published_at, archived_at,
       updated_at)
      VALUES ('revision-a', 'course-a', 1, NULL, 'draft', 'Legacy revision',
              NULL, NULL, ${now}, NULL, NULL, ${now});
      INSERT INTO curriculum_weeks
      (id, version_id, stable_id, order_index, title, description,
       created_at, updated_at)
      VALUES ('section-a', 'revision-a', 'section-a', 0, 'Legacy section',
              NULL, ${now}, ${now});
      INSERT INTO curriculum_days_v2
      (id, version_id, week_id, stable_id, order_index, title, description,
       goal, estimated_minutes, prerequisites_json, expected_outcomes_json,
       depth_level, out_of_scope_json, topics_json, created_at, updated_at)
      VALUES ('lesson-a', 'revision-a', 'section-a', 'lesson-a', 0,
              'Legacy lesson', 'Learner-safe description', 'Complete summary',
              5, '[]', '[]', 'foundation', '[]', '[]', ${now}, ${now});
      INSERT INTO curriculum_units
      (id, version_id, day_id, stable_id, type, order_index, title,
       description, estimated_minutes, objectives_json, checklist_json,
       sources_json, questions_json, misconceptions_json,
       reference_answer_json, completion_criteria_json, unlock_rules_json,
       optional, depth_level, payload_json, created_at, updated_at)
      VALUES ('activity-a', 'revision-a', 'lesson-a', 'activity-a', 'summary',
              0, 'Summary activity', 'Write a summary', 5, '[]', '[]', '[]',
              '[]', '[]', NULL, '[]', '[]', 0, 'foundation', '{}', ${now},
              ${now});
      UPDATE curriculum_versions
      SET status = 'published', content_hash = '${"b".repeat(64)}',
          published_at = ${now}
      WHERE id = 'revision-a';
      UPDATE curricula
      SET active_version_id = 'revision-a', updated_at = ${now}
      WHERE id = 'course-a';
      INSERT INTO learning_sessions
      (id, day_id, status, current_step, started_at, updated_at,
       curriculum_day_v2_id)
      VALUES ('session-a', 'legacy-day', 'completed', 'done', ${now}, ${now},
              'lesson-a');
      INSERT INTO session_snapshots
      (id, session_id, schema_version, curriculum_id, curriculum_version_id,
       curriculum_day_id, content_hash, snapshot_json, created_at)
      VALUES ('snapshot-a', 'session-a', 2, 'course-a', 'revision-a',
              'lesson-a', '${snapshotHash}',
              '${snapshotJson.replaceAll("'", "''")}', ${now});
      INSERT INTO evidence_facts
      (id, schema_version, operation_id, course_id, revision_id, lesson_id,
       session_id, activity_id, evidence_type, question_id, correctness,
       occurred_at, recorded_at, payload_json, provenance_json)
      VALUES ('evidence-b', 1, 'operation-b', 'course-a', 'revision-a',
              'lesson-a', 'session-a', 'activity-a', 'recall-attempt',
              'recall-question', 0.75, ${now - 1}, ${now},
              '{"answer":"learner-owned recall"}',
              '{"kind":"learner","sourceId":"session-a"}'),
             ('evidence-c', 1, 'operation-c', 'course-a', 'revision-a',
              'lesson-a', 'session-a', 'activity-a', 'summary', NULL, NULL,
              ${now}, ${now}, '{"summary":"learner-owned"}',
              '{"kind":"learner","sourceId":"session-a"}'),
             ('evidence-a', 1, 'operation-a', 'course-a', 'revision-a',
              'lesson-a', 'session-a', 'activity-a', 'quiz-answer',
              'quiz-question', 0, ${now}, ${now},
              '{"selectedOptionIds":["learner-option"]}',
              '{"kind":"learner","sourceId":"session-a"}');
    `);

    const repository = new CourseFoundationRepository(connection);
    expect(await repository.getSessionContext("session-a")).toEqual({
      courseId: "course-a",
      revisionId: "revision-a",
      lessonId: "lesson-a",
      sessionSnapshotId: "snapshot-a",
      snapshotHash,
    });
    expect(await repository.getSessionContext("missing-session")).toBeNull();
    const evidence = await repository.listEvidence("session-a");
    expect(
      evidence.map(({ id, type, questionId, correctness }) => ({
        id,
        type,
        questionId,
        correctness,
      })),
    ).toEqual([
      {
        id: "evidence-b",
        type: "recall-attempt",
        questionId: "recall-question",
        correctness: 0.75,
      },
      {
        id: "evidence-a",
        type: "quiz-answer",
        questionId: "quiz-question",
        correctness: 0,
      },
      {
        id: "evidence-c",
        type: "summary",
        questionId: null,
        correctness: null,
      },
    ]);
    expect(evidence.map((fact) => fact.payload)).toEqual([
      { answer: "learner-owned recall" },
      { selectedOptionIds: ["learner-option"] },
      { summary: "learner-owned" },
    ]);
    expect(JSON.stringify(evidence)).not.toContain(
      "protected-reference-answer",
    );
    expect(() =>
      connection.sqlite
        .prepare(
          "UPDATE evidence_facts SET payload_json = '{}' WHERE id = 'evidence-a'",
        )
        .run(),
    ).toThrow("evidence fact is append-only");
  });

  it("reports deterministic, fully accounted M2 provenance without payload bytes", async () => {
    const connection = currentConnection();
    const report = await new CourseFoundationRepository(
      connection,
    ).reconciliationReport();

    expect(report.accounted).toBe(true);
    expect(report.sourceRows).toBe(
      report.mapped + report.quarantined + report.intentionallyUnmapped,
    );
    expect(report.foreignKeyViolationCount).toBe(0);
    expect(JSON.stringify(report)).not.toContain("snapshot_json");
  });
});
