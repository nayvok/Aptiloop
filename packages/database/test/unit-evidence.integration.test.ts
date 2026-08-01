import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  createCurriculumAuthoringRepository,
  createLearningRepository,
  migrateDatabase,
  openDatabase,
  seedDatabase,
  type DatabaseConnection,
  type LearningRepository,
} from "../src/index.js";

const cleanup: Array<() => void> = [];

afterEach(() => {
  while (cleanup.length > 0) cleanup.pop()?.();
});

function createTempDatabase(): {
  connection: DatabaseConnection;
  path: string;
  close: () => void;
} {
  const directory = mkdtempSync(join(tmpdir(), "dlh-unit-evidence-"));
  const path = join(directory, "test.sqlite");
  const connection = openDatabase(path);
  let open = true;
  const close = () => {
    if (!open) return;
    open = false;
    connection.close();
  };
  cleanup.push(() => {
    close();
    rmSync(directory, { recursive: true, force: true });
  });
  return { connection, path, close };
}

async function createStartedSession() {
  const database = createTempDatabase();
  migrateDatabase(database.connection);
  seedDatabase(database.connection, undefined, 1_000);
  let nextId = 0;
  const learning = createLearningRepository(database.connection, {
    id: () => `evidence-id-${++nextId}`,
    now: () => 2_000 + nextId,
  });
  const curriculumPath = await createCurriculumAuthoringRepository(
    database.connection,
  ).getActivePath("curriculum-foundation");
  const day = curriculumPath?.weeks[0]?.days[0];
  if (!day) throw new Error("Seeded Day 1 is missing");
  const session = await learning.startOrResumeVersionedSession({
    dayId: day.id,
  });
  return { ...database, learning, curriculumPath, day, session };
}

function unitOfType(
  setup: Awaited<ReturnType<typeof createStartedSession>>,
  type: string,
) {
  const unit = setup.day.units.find((candidate) => candidate.type === type);
  if (!unit) throw new Error(`Seeded ${type} unit is missing`);
  return unit;
}

function activateUnit(
  setup: Awaited<ReturnType<typeof createStartedSession>>,
  unitId: string,
): void {
  setup.connection.sqlite
    .prepare(
      `UPDATE unit_progress
       SET status = 'in_progress', started_at = 1_500, updated_at = 1_500
       WHERE session_id = ? AND unit_id = ?`,
    )
    .run(setup.session.session.id, unitId);
}

describe("versioned unit evidence migration", () => {
  it("creates the constrained evidence table and query indexes", () => {
    const { connection } = createTempDatabase();
    migrateDatabase(connection);

    expect(
      connection.sqlite
        .prepare(
          "SELECT 1 FROM __dlh_migrations WHERE id = '0003_unit_evidence'",
        )
        .get(),
    ).toBeDefined();
    const table = connection.sqlite
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'versioned_unit_evidence'",
      )
      .get() as { sql: string } | undefined;
    expect(table?.sql).toContain("correctness BETWEEN 0.0 AND 1.0");
    expect(
      connection.sqlite
        .prepare("PRAGMA index_list('versioned_unit_evidence')")
        .all()
        .map((row) => (row as { name: string }).name),
    ).toEqual(
      expect.arrayContaining([
        "versioned_unit_evidence_session_idx",
        "versioned_unit_evidence_session_unit_idx",
        "versioned_unit_evidence_session_type_idx",
      ]),
    );
  });
});

describe("versioned unit evidence repository", () => {
  it("records canonical JSON idempotently and lists filtered evidence", async () => {
    const setup = await createStartedSession();
    const recall = unitOfType(setup, "recall");
    const quiz = unitOfType(setup, "quiz");
    activateUnit(setup, recall.id);
    activateUnit(setup, quiz.id);

    const first = await setup.learning.recordVersionedUnitEvidence({
      sessionId: setup.session.session.id,
      unitId: recall.id,
      evidenceType: "recall-attempt",
      operationId: "recall-operation",
      questionId: "recall-question",
      payload: { answer: "object", details: { second: 2, first: 1 } },
      correctness: 0.75,
    });
    const retried = await setup.learning.recordVersionedUnitEvidence({
      sessionId: setup.session.session.id,
      unitId: recall.id,
      evidenceType: "recall-attempt",
      operationId: "recall-operation",
      questionId: "recall-question",
      payload: { details: { first: 1, second: 2 }, answer: "object" },
      correctness: 0.75,
    });
    expect(retried).toEqual(first);
    await expect(
      setup.learning.recordVersionedUnitEvidence({
        sessionId: setup.session.session.id,
        unitId: recall.id,
        evidenceType: "recall-attempt",
        operationId: "recall-operation",
        questionId: "recall-question",
        payload: { answer: "different" },
        correctness: 0.75,
      }),
    ).rejects.toThrow(/operation id.*different/i);

    await setup.learning.recordVersionedUnitEvidence({
      sessionId: setup.session.session.id,
      unitId: quiz.id,
      evidenceType: "quiz-answer",
      operationId: "quiz-operation",
      questionId: "quiz-question",
      payload: { selectedOptionIds: ["q1-b"] },
      correctness: 1,
    });
    expect(
      await setup.learning.listVersionedUnitEvidence(setup.session.session.id, {
        unitId: recall.id,
        evidenceType: "recall-attempt",
      }),
    ).toEqual([first]);
    expect(connectionCount(setup.connection, "recall-operation")).toBe(1);
  });

  it("rejects cross-session units and evidence/unit type mismatches", async () => {
    const setup = await createStartedSession();
    const recall = unitOfType(setup, "recall");
    const quiz = unitOfType(setup, "quiz");
    activateUnit(setup, quiz.id);

    await expect(
      setup.learning.recordVersionedUnitEvidence({
        sessionId: setup.session.session.id,
        unitId: quiz.id,
        evidenceType: "recall-attempt",
        operationId: "wrong-type",
        payload: { answer: "x" },
      }),
    ).rejects.toThrow(/requires a recall unit/i);
    await expect(
      setup.learning.recordVersionedUnitEvidence({
        sessionId: setup.session.session.id,
        unitId: recall.id,
        evidenceType: "recall-attempt",
        operationId: "locked-unit",
        payload: { answer: "x" },
      }),
    ).rejects.toThrow(/in-progress unit/i);

    setup.connection.sqlite
      .prepare(
        "UPDATE learning_sessions SET status = 'completed', completed_at = 3_000 WHERE id = ?",
      )
      .run(setup.session.session.id);
    setup.connection.sqlite
      .prepare(
        "UPDATE learner_state SET current_learning_session_id = NULL, updated_at = 3_000 WHERE id = 'default'",
      )
      .run();
    const secondDay = setup.curriculumPath?.weeks[0]?.days[1];
    if (!secondDay) throw new Error("Seeded Day 2 is missing");
    const second = await setup.learning.startOrResumeVersionedSession({
      dayId: secondDay.id,
    });
    await expect(
      setup.learning.recordVersionedUnitEvidence({
        sessionId: second.session.id,
        unitId: recall.id,
        evidenceType: "recall-attempt",
        operationId: "cross-session",
        payload: { answer: "x" },
      }),
    ).rejects.toThrow(/not a unit in the versioned session/i);
  });

  it("validates correctness, identifiers, JSON shape, and payload size", async () => {
    const setup = await createStartedSession();
    const recall = unitOfType(setup, "recall");
    activateUnit(setup, recall.id);
    const base = {
      sessionId: setup.session.session.id,
      unitId: recall.id,
      evidenceType: "recall-attempt" as const,
    };

    await expect(
      setup.learning.recordVersionedUnitEvidence({
        ...base,
        operationId: "invalid-correctness",
        payload: {},
        correctness: 1.01,
      }),
    ).rejects.toThrow(/between 0 and 1/i);
    await expect(
      setup.learning.recordVersionedUnitEvidence({
        ...base,
        operationId: "invalid-question",
        questionId: " ",
        payload: {},
      }),
    ).rejects.toThrow(/question id/i);
    await expect(
      setup.learning.recordVersionedUnitEvidence({
        ...base,
        operationId: "invalid-json",
        payload: { answer: undefined },
      }),
    ).rejects.toThrow(/non-json/i);
    await expect(
      setup.learning.recordVersionedUnitEvidence({
        ...base,
        operationId: "oversize",
        payload: { answer: "x".repeat(50_001) },
      }),
    ).rejects.toThrow(/exceeds 50000 bytes/i);
  });

  it("persists across restart and permits completed-session reads only", async () => {
    const setup = await createStartedSession();
    const summary = unitOfType(setup, "summary");
    activateUnit(setup, summary.id);
    const stored = await setup.learning.recordVersionedUnitEvidence({
      sessionId: setup.session.session.id,
      unitId: summary.id,
      evidenceType: "summary",
      operationId: "summary-operation",
      payload: { reflection: "I can explain value categories." },
      correctness: null,
    });
    setup.connection.sqlite
      .prepare(
        "UPDATE learning_sessions SET status = 'completed', completed_at = 3_000 WHERE id = ?",
      )
      .run(setup.session.session.id);
    setup.close();

    const reopened = openDatabase(setup.path);
    try {
      const repository: LearningRepository = createLearningRepository(reopened);
      expect(
        await repository.listVersionedUnitEvidence(setup.session.session.id),
      ).toEqual([stored]);
      await expect(
        repository.recordVersionedUnitEvidence({
          sessionId: setup.session.session.id,
          unitId: summary.id,
          evidenceType: "summary",
          operationId: "summary-after-completion",
          payload: { reflection: "Too late" },
        }),
      ).rejects.toThrow(/requires an active session/i);
    } finally {
      reopened.close();
    }
  });
});

function connectionCount(
  connection: DatabaseConnection,
  operationId: string,
): number {
  return (
    connection.sqlite
      .prepare(
        "SELECT count(*) AS count FROM versioned_unit_evidence WHERE operation_id = ?",
      )
      .get(operationId) as { count: number }
  ).count;
}
