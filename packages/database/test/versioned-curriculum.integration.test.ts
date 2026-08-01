import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { SessionSnapshotSchema, UnitProgressSchema } from "@dlh/shared";
import {
  activeCurriculumVersion,
  publishedCurriculumRevision2,
  publishedCurriculumV2,
  publishedCurriculumV3,
} from "@dlh/curriculum";

import {
  createCurriculumAuthoringRepository,
  createDatabaseBackup,
  createLearningRepository,
  migrateDatabase,
  openDatabase,
  discoverDatabaseCandidates,
  resolveDatabaseProjectRoot,
  seedDatabase,
  seedVersionedCurriculum,
  type DatabaseConnection,
} from "../src/index.js";

const cleanup: Array<() => void> = [];
const migrationsDirectory = fileURLToPath(
  new URL("../migrations", import.meta.url),
);

function tempConnection(): { connection: DatabaseConnection; path: string } {
  const directory = mkdtempSync(join(tmpdir(), "dlh-database-v2-"));
  const path = join(directory, "test.sqlite");
  const connection = openDatabase(path);
  cleanup.push(() => {
    connection.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return { connection, path };
}

afterEach(() => {
  while (cleanup.length) cleanup.pop()?.();
});

describe("versioned curriculum migration", () => {
  it("preserves legacy rows and snapshots an existing active session", () => {
    const { connection } = tempConnection();
    connection.sqlite.exec(
      readFileSync(join(migrationsDirectory, "0000_initial.sql"), "utf8"),
    );
    connection.sqlite.exec(`
      INSERT INTO curriculum_days
        (id, slug, week_number, day_number, title, summary, estimated_minutes,
         goals_json, sources_json, created_at, updated_at)
      VALUES ('legacy-day', 'legacy-day', 1, 1, 'Legacy day', 'History', 60,
              '["goal"]', '[]', 10, 10);
      INSERT INTO questions
        (id, day_id, kind, prompt, order_index, reference_answer, key_points_json,
         reveal_after_attempts, active, created_at, updated_at)
      VALUES ('legacy-question', 'legacy-day', 'explain', 'Explain', 0, 'Protected',
              '["point"]', 2, 1, 10, 10);
      INSERT INTO learning_sessions
        (id, day_id, status, current_step, started_at, updated_at)
      VALUES ('legacy-session', 'legacy-day', 'active', 'questions', 20, 20);
      INSERT INTO answer_attempts
        (id, session_id, question_id, attempt_number, answer, submitted_at)
      VALUES ('legacy-answer', 'legacy-session', 'legacy-question', 1, 'mine', 30);
    `);

    migrateDatabase(connection);

    expect(count(connection, "curriculum_days")).toBe(1);
    expect(count(connection, "answer_attempts")).toBe(1);
    expect(count(connection, "curriculum_days_v2")).toBe(1);
    expect(count(connection, "curriculum_units")).toBe(1);
    const snapshot = connection.sqlite
      .prepare(
        "SELECT snapshot_json, content_hash FROM session_snapshots WHERE session_id = 'legacy-session'",
      )
      .get() as { snapshot_json: string; content_hash: string } | undefined;
    expect(snapshot).toBeDefined();
    expect(
      SessionSnapshotSchema.parse(
        JSON.parse(snapshot?.snapshot_json ?? "null"),
      ),
    ).toMatchObject({
      schemaVersion: 2,
      day: { stableId: "legacy-day" },
    });
    expect(snapshot?.content_hash).toBeTruthy();
    expect(
      connection.sqlite
        .prepare("SELECT current_learning_session_id FROM learner_state")
        .get(),
    ).toEqual({ current_learning_session_id: "legacy-session" });
  });

  it("repairs a legacy snapshot even when migration 0002 is already recorded", async () => {
    const { connection } = tempConnection();
    connection.sqlite.exec(
      readFileSync(join(migrationsDirectory, "0000_initial.sql"), "utf8"),
    );
    connection.sqlite.exec(`
      INSERT INTO curriculum_days
        (id, slug, week_number, day_number, title, summary, estimated_minutes,
         goals_json, sources_json, created_at, updated_at)
      VALUES ('legacy-day', 'legacy-day', 1, 1, 'Legacy day', 'History', 60,
              '["goal"]', '[]', 10, 10);
      INSERT INTO learning_sessions
        (id, day_id, status, current_step, started_at, updated_at)
      VALUES ('legacy-session', 'legacy-day', 'active', 'questions', 20, 20);
    `);
    migrateDatabase(connection);
    connection.sqlite.exec(`
      DROP INDEX IF EXISTS unit_progress_session_order_idx;
      CREATE TABLE unit_progress_legacy_contract (
        id TEXT PRIMARY KEY NOT NULL,
        session_id TEXT NOT NULL REFERENCES learning_sessions(id) ON DELETE CASCADE,
        unit_id TEXT NOT NULL,
        status TEXT NOT NULL,
        progress_json TEXT NOT NULL DEFAULT '{}',
        started_at INTEGER,
        completed_at INTEGER,
        skipped_at INTEGER,
        updated_at INTEGER NOT NULL,
        UNIQUE(session_id, unit_id)
      );
      INSERT INTO unit_progress_legacy_contract
        (id, session_id, unit_id, status, progress_json, started_at,
         completed_at, skipped_at, updated_at)
      SELECT id, session_id, unit_id, status, progress_json, started_at,
             completed_at, skipped_at, updated_at
      FROM unit_progress;
      DROP TABLE unit_progress;
      ALTER TABLE unit_progress_legacy_contract RENAME TO unit_progress;
      CREATE INDEX unit_progress_session_order_idx
        ON unit_progress(session_id, updated_at);
    `);
    connection.sqlite
      .prepare(
        `UPDATE session_snapshots
         SET schema_version = 1,
             snapshot_json = '{"week":{"id":"w","title":"Week"},"day":{"id":"legacy-day","stableId":"legacy-day","title":"Legacy"},"units":[],"capturedAt":20}'
         WHERE session_id = 'legacy-session'`,
      )
      .run();
    connection.sqlite
      .prepare(
        "UPDATE unit_progress SET progress_json = '{}' WHERE session_id = 'legacy-session'",
      )
      .run();

    migrateDatabase(connection);

    const repaired = connection.sqlite
      .prepare(
        "SELECT schema_version, snapshot_json FROM session_snapshots WHERE session_id = 'legacy-session'",
      )
      .get() as { schema_version: number; snapshot_json: string };
    expect(repaired.schema_version).toBe(2);
    expect(
      connection.sqlite
        .prepare("PRAGMA table_info(unit_progress)")
        .all()
        .some((column) => (column as { name: string }).name === "unit_type"),
    ).toBe(true);
    expect(
      SessionSnapshotSchema.parse(JSON.parse(repaired.snapshot_json)),
    ).toMatchObject({ schemaVersion: 2, day: { stableId: "legacy-day" } });
    const learning = createLearningRepository(connection);
    expect(await learning.getCurrentVersionedSession()).toBeNull();
    expect(
      (await learning.getVersionedSession("legacy-session")).session.id,
    ).toBe("legacy-session");
  });
});

describe("curriculum authoring", () => {
  it("publishes an ordered immutable graph and clones a draft revision", async () => {
    const { connection } = tempConnection();
    migrateDatabase(connection);
    let id = 0;
    const repository = createCurriculumAuthoringRepository(connection, {
      id: () => `id-${++id}`,
      now: () => 100,
    });
    const draft = await repository.createDraft({
      curriculum: {
        id: "curriculum-js",
        slug: "javascript",
        title: "JavaScript",
        description: "Foundation",
      },
      title: "First revision",
    });
    const week = await repository.addWeek({
      versionId: draft.id,
      stableId: "week-1",
      title: "Week one",
    });
    const day = await repository.addDay({
      versionId: draft.id,
      weekId: week.id,
      stableId: "day-1",
      title: "Values",
      description: "Values and bindings",
      goal: "Explain values",
      estimatedMinutes: 60,
      depthLevel: "interview-ready",
    });
    const first = await repository.addUnit({
      versionId: draft.id,
      dayId: day.id,
      stableId: "summary",
      type: "summary",
      title: "Summary",
      description: "Finish",
      completionCriteria: [{ type: "acknowledgement" }],
      depthLevel: "foundation",
      payload: { type: "summary", prompts: [] },
    });
    const second = await repository.addUnit({
      versionId: draft.id,
      dayId: day.id,
      stableId: "briefing",
      type: "briefing",
      title: "Briefing",
      description: "Begin",
      completionCriteria: [{ type: "acknowledgement" }],
      depthLevel: "foundation",
      payload: { type: "briefing", scope: [] },
    });
    await repository.reorderUnits({
      versionId: draft.id,
      dayId: day.id,
      orderedUnitIds: [second.id, first.id],
    });

    const published = await repository.publishVersion(draft.id);
    expect(published.status).toBe("published");
    expect(published.contentHash).toMatch(/^[a-f0-9]{64}$/);
    const path = await repository.getActivePath("curriculum-js");
    expect(path?.weeks[0]?.days[0]?.units.map((unit) => unit.stableId)).toEqual(
      ["briefing", "summary"],
    );
    await expect(
      repository.addUnit({
        versionId: draft.id,
        dayId: day.id,
        stableId: "late",
        type: "study",
        title: "Late mutation",
        description: "Late",
        completionCriteria: [{ type: "acknowledgement" }],
        depthLevel: "foundation",
        payload: { type: "study", body: "Late" },
      }),
    ).rejects.toThrow(/immutable/i);

    const clone = await repository.cloneRevision(published.id, {
      title: "Second revision",
    });
    expect(clone).toMatchObject({
      curriculumId: "curriculum-js",
      parentVersionId: published.id,
      revision: 2,
      status: "draft",
    });
    const clonePath = await repository.getVersionGraph(clone.id);
    expect(
      clonePath.weeks[0]?.days[0]?.units.map((unit) => unit.stableId),
    ).toEqual(["briefing", "summary"]);
  });
});

describe("snapshot sessions", () => {
  it("resumes the global current session and keeps its authored snapshot", async () => {
    const { connection } = tempConnection();
    migrateDatabase(connection);
    let id = 0;
    const authoring = createCurriculumAuthoringRepository(connection, {
      id: () => `author-${++id}`,
      now: () => 100,
    });
    const draft = await authoring.createDraft({
      curriculum: { id: "c", slug: "c", title: "Course" },
      title: "v1",
    });
    const week = await authoring.addWeek({
      versionId: draft.id,
      stableId: "w1",
      title: "Week",
    });
    const day = await authoring.addDay({
      versionId: draft.id,
      weekId: week.id,
      stableId: "d1",
      title: "Day before publish",
      goal: "Learn",
      estimatedMinutes: 30,
      depthLevel: "foundation",
    });
    const unit = await authoring.addUnit({
      versionId: draft.id,
      dayId: day.id,
      stableId: "u1",
      type: "briefing",
      title: "Start",
      description: "Start here",
      completionCriteria: [{ type: "acknowledgement" }],
      depthLevel: "foundation",
      payload: { type: "briefing", scope: [] },
    });
    const published = await authoring.publishVersion(draft.id);

    const learning = createLearningRepository(connection, {
      id: () => `session-${++id}`,
      now: () => 200,
    });
    const started = await learning.startOrResumeVersionedSession({
      dayId: day.id,
      idempotencyKey: "start-d1",
    });
    expect(started.unitProgress).toEqual([
      expect.objectContaining({ unitId: unit.id, status: "ready" }),
    ]);
    expect(SessionSnapshotSchema.parse(started.snapshot)).toEqual(
      started.snapshot,
    );
    expect(UnitProgressSchema.parse(started.unitProgress[0])).toEqual(
      started.unitProgress[0],
    );
    const resumed = await learning.getCurrentVersionedSession();
    expect(resumed?.session.id).toBe(started.session.id);

    const revision = await authoring.cloneRevision(published.id, {
      title: "v2",
    });
    const revisionGraph = await authoring.getVersionGraph(revision.id);
    const revisionDay = revisionGraph.weeks[0]?.days[0];
    if (!revisionDay) throw new Error("Cloned graph is incomplete");
    connection.sqlite
      .prepare(
        "UPDATE curriculum_days_v2 SET title = 'Changed later' WHERE id = ?",
      )
      .run(revisionDay.id);
    await authoring.publishVersion(revision.id);
    const restored = await learning.getVersionedSession(started.session.id);
    expect(restored.snapshot.day.title).toBe("Day before publish");
    await learning.updateUnitProgress({
      sessionId: started.session.id,
      unitId: unit.id,
      status: "in_progress",
      progress: {
        type: "briefing",
        acknowledged: true,
        checkedItemIds: [],
      },
    });
    expect(
      (await learning.getVersionedSession(started.session.id)).unitProgress[0],
    ).toMatchObject({
      status: "in_progress",
      payload: { type: "briefing", acknowledged: true },
    });
  });
});

describe("versioned curriculum seed", () => {
  it("is immutable and idempotent and exposes the 12-unit Day 1 path", async () => {
    const { connection } = tempConnection();
    migrateDatabase(connection);

    seedVersionedCurriculum(connection, publishedCurriculumV2);
    const immutableParentBefore = connection.sqlite
      .prepare(
        `SELECT id, curriculum_id, revision, parent_version_id, status,
                content_hash, created_at, published_at, updated_at
         FROM curriculum_versions WHERE id = 'curriculum-foundation-v2-r1'`,
      )
      .get();

    const first = seedDatabase(connection, undefined, 1_000);
    const seededCurriculum = connection.sqlite
      .prepare(
        "SELECT updated_at FROM curricula WHERE id = 'curriculum-foundation'",
      )
      .get() as { updated_at: number };
    // Authored release timestamps may lie in the future; the wall-clock marker
    // used by the path's "most recently activated" selection must not.
    expect(seededCurriculum.updated_at).toBeLessThanOrEqual(Date.now());
    const versionsBefore = connection.sqlite
      .prepare(
        `SELECT id, curriculum_id, revision, parent_version_id, status,
                content_hash, created_at, published_at, updated_at
         FROM curriculum_versions
         WHERE id IN ('curriculum-foundation-v2-r1', 'curriculum-foundation-v2-r2',
                      'curriculum-foundation-v2-r3', 'curriculum-foundation-v2-r4')
         ORDER BY revision`,
      )
      .all();
    const second = seedDatabase(connection, undefined, 2_000);
    const versionsAfter = connection.sqlite
      .prepare(
        `SELECT id, curriculum_id, revision, parent_version_id, status,
                content_hash, created_at, published_at, updated_at
         FROM curriculum_versions
         WHERE id IN ('curriculum-foundation-v2-r1', 'curriculum-foundation-v2-r2',
                      'curriculum-foundation-v2-r3', 'curriculum-foundation-v2-r4')
         ORDER BY revision`,
      )
      .all();

    expect(second).toEqual(first);
    expect(versionsAfter).toEqual(versionsBefore);
    expect(versionsBefore).toHaveLength(4);
    expect(versionsBefore[0]).toMatchObject({
      id: "curriculum-foundation-v2-r1",
      curriculum_id: "curriculum-foundation",
      revision: 1,
    });
    expect(versionsBefore[0]).toEqual(immutableParentBefore);
    expect(versionsBefore[1]).toMatchObject({
      id: "curriculum-foundation-v2-r2",
      curriculum_id: "curriculum-foundation",
      revision: 2,
      parent_version_id: "curriculum-foundation-v2-r1",
      content_hash:
        "920a36a5484ba88f01477a28a281fcc781935ef4124ef8ace7b689536d543427",
    });
    expect(versionsBefore[2]).toMatchObject({
      id: "curriculum-foundation-v2-r3",
      curriculum_id: "curriculum-foundation",
      revision: 3,
      parent_version_id: "curriculum-foundation-v2-r2",
    });
    expect(versionsBefore[3]).toMatchObject({
      id: "curriculum-foundation-v2-r4",
      curriculum_id: "curriculum-foundation",
      revision: 4,
      parent_version_id: "curriculum-foundation-v2-r3",
      status: "published",
    });
    const authoring = createCurriculumAuthoringRepository(connection);
    const path = await authoring.getActivePath("curriculum-foundation");
    const dayOne = path?.weeks[0]?.days.find(
      (day) => day.stableId === "w1d1-values-types-objects",
    );
    expect(path?.version.id).toBe("curriculum-foundation-v2-r4");
    expect(dayOne?.units).toHaveLength(12);
    expect(dayOne?.units[0]).toMatchObject({
      stableId: "w1d1-u01-briefing",
      orderIndex: 0,
    });
  });

  it("upgrades an existing immutable r2 database to r3 without moving its active session", async () => {
    const { connection } = tempConnection();
    migrateDatabase(connection);
    seedVersionedCurriculum(connection, publishedCurriculumV2);
    seedVersionedCurriculum(connection, publishedCurriculumRevision2);

    const authoring = createCurriculumAuthoringRepository(connection);
    let id = 0;
    const learning = createLearningRepository(connection, {
      id: () => `existing-r2-${++id}`,
      now: () => 2_000,
    });
    const r2Path = await authoring.getActivePath("curriculum-foundation");
    const r2Day = r2Path?.weeks[0]?.days[0];
    if (!r2Day) throw new Error("Seeded r2 Day 1 is missing");
    const r2Session = await learning.startOrResumeVersionedSession({
      dayId: r2Day.id,
    });
    const immutableR2Before = connection.sqlite
      .prepare(
        `SELECT id, revision, parent_version_id, status, content_hash,
                created_at, published_at, updated_at
         FROM curriculum_versions WHERE id = ?`,
      )
      .get(publishedCurriculumRevision2.id);

    seedVersionedCurriculum(connection);

    const versionsAfterUpgrade = connection.sqlite
      .prepare(
        `SELECT id, revision, parent_version_id, status, content_hash,
                created_at, published_at, updated_at
         FROM curriculum_versions
         WHERE curriculum_id = 'curriculum-foundation'
         ORDER BY revision`,
      )
      .all();
    const activePath = await authoring.getActivePath("curriculum-foundation");
    const preservedSession = await learning.getVersionedSession(
      r2Session.session.id,
    );

    expect(versionsAfterUpgrade).toHaveLength(4);
    expect(versionsAfterUpgrade[1]).toEqual(immutableR2Before);
    expect(versionsAfterUpgrade[2]).toMatchObject({
      id: "curriculum-foundation-v2-r3",
      revision: 3,
      parent_version_id: publishedCurriculumRevision2.id,
      status: "published",
      content_hash: publishedCurriculumV3.contentHash,
    });
    expect(versionsAfterUpgrade[3]).toMatchObject({
      id: "curriculum-foundation-v2-r4",
      revision: 4,
      parent_version_id: publishedCurriculumV3.id,
      status: "published",
      content_hash: activeCurriculumVersion.contentHash,
    });
    expect(activePath?.version.id).toBe(activeCurriculumVersion.id);
    expect(preservedSession.snapshot.curriculumVersionId).toBe(
      publishedCurriculumRevision2.id,
    );

    seedVersionedCurriculum(connection);
    expect(
      connection.sqlite
        .prepare(
          `SELECT id, revision, parent_version_id, status, content_hash,
                  created_at, published_at, updated_at
           FROM curriculum_versions
           WHERE curriculum_id = 'curriculum-foundation'
           ORDER BY revision`,
        )
        .all(),
    ).toEqual(versionsAfterUpgrade);
  });

  it("records persisted hint usage at levels zero through five", async () => {
    const { connection } = tempConnection();
    migrateDatabase(connection);
    seedDatabase(connection, undefined, 1_000);
    let id = 0;
    const learning = createLearningRepository(connection, {
      id: () => `hint-${++id}`,
      now: () => 2_000,
    });
    const authoring = createCurriculumAuthoringRepository(connection);
    const path = await authoring.getActivePath("curriculum-foundation");
    const day = path?.weeks[0]?.days[0];
    const unit = day?.units[0];
    if (!day || !unit) throw new Error("Seeded Day 1 is missing");
    const session = await learning.startOrResumeVersionedSession({
      dayId: day.id,
    });
    const storedSnapshot = SessionSnapshotSchema.parse(
      JSON.parse(
        (
          connection.sqlite
            .prepare(
              "SELECT snapshot_json FROM session_snapshots WHERE session_id = ?",
            )
            .get(session.session.id) as { snapshot_json: string }
        ).snapshot_json,
      ),
    );
    const storedProtectedQuestion = storedSnapshot.units
      .flatMap((candidate) => candidate.questions)
      .find((question) => question.referenceAnswer !== null);
    const exposedQuestion = session.snapshot.units
      .flatMap((candidate) => candidate.questions)
      .find((question) => question.id === storedProtectedQuestion?.id);
    expect(storedProtectedQuestion?.referenceAnswer).toBeTruthy();
    expect(exposedQuestion?.referenceAnswer).toBeNull();
    expect(exposedQuestion?.evaluationPoints).toEqual([]);

    const storedQuiz = storedSnapshot.units.find(
      (candidate) => candidate.type === "quiz",
    );
    const exposedQuiz = session.snapshot.units.find(
      (candidate) => candidate.id === storedQuiz?.id,
    );
    expect(storedQuiz?.questions).toHaveLength(4);
    expect(storedQuiz?.questions[0]).toMatchObject({
      kind: "multiple-choice",
      options: [
        { id: "q1-a", label: "null" },
        { id: "q1-b", label: "object" },
        { id: "q1-c", label: "undefined" },
      ],
      correctOptionIds: ["q1-b"],
    });
    expect(exposedQuiz?.questions[0]).toMatchObject({
      kind: "multiple-choice",
      correctOptionIds: [],
      referenceAnswer: null,
      evaluationPoints: [],
    });
    expect(exposedQuiz?.questions[0]?.options).toEqual(
      storedQuiz?.questions[0]?.options,
    );
    expect(
      exposedQuiz?.questions[0]?.options.every(
        (option) => Object.keys(option).sort().join(",") === "id,label",
      ),
    ).toBe(true);

    await learning.recordHintUsage({
      sessionId: session.session.id,
      unitId: unit.id,
      level: 0,
      reason: "Learner requested orientation",
    });
    await learning.recordHintUsage({
      sessionId: session.session.id,
      unitId: unit.id,
      level: 5,
      reason: "Explicit give-up after an attempt",
    });
    await expect(
      learning.recordHintUsage({
        sessionId: session.session.id,
        unitId: unit.id,
        level: 6,
        reason: "Invalid",
      }),
    ).rejects.toThrow(/level/i);
    expect(await learning.listHintUsages(session.session.id)).toEqual([
      expect.objectContaining({ level: 0, unitId: unit.id }),
      expect.objectContaining({ level: 5, unitId: unit.id }),
    ]);
  });

  it("seeds authored code-reading snippets into learner snapshots", async () => {
    for (const authoredDay of activeCurriculumVersion.weeks.flatMap(
      (week) => week.days,
    )) {
      const { connection } = tempConnection();
      migrateDatabase(connection);
      seedDatabase(connection, undefined, 1_000);
      let id = 0;
      const learning = createLearningRepository(connection, {
        id: () => `code-reading-${authoredDay.dayNumber}-${++id}`,
        now: () => 2_000,
      });
      const authoring = createCurriculumAuthoringRepository(connection);
      const path = await authoring.getActivePath("curriculum-foundation");
      const authoredReading = authoredDay.units.find(
        (unit) => unit.type === "code-reading",
      );
      const seededDay = path?.weeks
        .flatMap((week) => week.days)
        .find((day) => day.stableId === authoredDay.stableId);
      if (!authoredReading?.codeSnippet || !seededDay) {
        throw new Error(`Code reading is missing for ${authoredDay.stableId}`);
      }

      const session = await learning.startOrResumeVersionedSession({
        dayId: seededDay.id,
      });
      const snapshotReading = session.snapshot.units.find(
        (unit) => unit.type === "code-reading",
      );

      expect(snapshotReading?.payload).toEqual({
        type: "code-reading",
        snippet: authoredReading.codeSnippet,
      });
    }
  });
});

describe("database backup", () => {
  it("uses a consistent SQLite backup and verifies both copies", () => {
    const { connection, path } = tempConnection();
    migrateDatabase(connection);
    connection.sqlite
      .prepare(
        "INSERT INTO application_settings (key, value_json, updated_at) VALUES ('test', '{}', 1)",
      )
      .run();
    const destination = join(join(path, ".."), "backup.sqlite");

    const result = createDatabaseBackup(path, destination);

    expect(result.source.integrity).toEqual(["ok"]);
    expect(result.source.foreignKeyViolations).toEqual([]);
    expect(result.backup.integrity).toEqual(["ok"]);
    const backup = openDatabase(destination, {
      readonly: true,
      fileMustExist: true,
    });
    try {
      expect(
        backup.sqlite
          .prepare(
            "SELECT value_json FROM application_settings WHERE key = 'test'",
          )
          .get(),
      ).toEqual({ value_json: "{}" });
    } finally {
      backup.close();
    }
  });

  it("discovers root databases when invoked from the database workspace", () => {
    const directory = mkdtempSync(join(tmpdir(), "dlh-backup-root-"));
    cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
    const candidate = join(directory, ".data", "dev-learning-harness.sqlite");
    const connection = openDatabase(candidate);
    connection.close();
    const moduleUrl = pathToFileURL(
      join(directory, "packages", "database", "src", "backup.ts"),
    ).href;

    const projectRoot = resolveDatabaseProjectRoot(moduleUrl);

    expect(resolve(projectRoot)).toBe(resolve(directory));
    expect(discoverDatabaseCandidates(projectRoot)).toEqual([candidate]);
  });
});

function count(connection: DatabaseConnection, table: string): number {
  const allowed = new Set([
    "curriculum_days",
    "answer_attempts",
    "curriculum_days_v2",
    "curriculum_units",
  ]);
  if (!allowed.has(table)) throw new Error(`Unsafe table in test: ${table}`);
  return (
    connection.sqlite
      .prepare(`SELECT count(*) AS count FROM ${table}`)
      .get() as {
      count: number;
    }
  ).count;
}
