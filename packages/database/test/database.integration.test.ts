import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  createLearningRepository,
  migrateDatabase,
  openDatabase,
  type DatabaseConnection,
} from "../src/index.js";
import { seedDatabase } from "../src/development-fixtures.js";

const cleanup: Array<() => void> = [];

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "aptiloop-database-"));
  const connection = openDatabase(join(directory, "test.sqlite"));
  migrateDatabase(connection);
  cleanup.push(() => {
    connection.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return connection;
}

afterEach(() => {
  while (cleanup.length) cleanup.pop()?.();
});

describe("SQLite database", () => {
  it("enables foreign keys and WAL and applies migration idempotently", () => {
    const connection = fixture();
    migrateDatabase(connection);

    const foreignKeys = connection.sqlite
      .prepare("PRAGMA foreign_keys")
      .get() as {
      foreign_keys: number;
    };
    const journal = connection.sqlite.prepare("PRAGMA journal_mode").get() as {
      journal_mode: string;
    };
    const migrations = connection.sqlite
      .prepare("SELECT id FROM __dlh_migrations ORDER BY id")
      .all() as Array<{ id: string }>;
    expect(foreignKeys.foreign_keys).toBe(1);
    expect(journal.journal_mode).toBe("wal");
    expect(migrations.map((migration) => migration.id)).toEqual([
      "0000_initial",
      "0001_versioned_curriculum",
      "0002_snapshot_contract_and_hints",
      "0003_unit_evidence",
      "0004_unit_progress_compatibility",
      "0005_test_run_diff_fingerprint",
      "0006_course_foundations",
      "0007_quarantined_course_compatibility",
      "0008_m2_acceptance_corrections",
      "0009_m2_acceptance_hardening",
      "0010_m2_quarantine_immutability",
      "0011_course_pack_lifecycle",
      "0012_learning_kernel",
      "0013_execution_fabric",
      "0014_provider_hub",
      "0015_adaptive_studio",
      "0016_course_designer_workflow",
      "0017_learner_course_state",
      "0018_learner_course_state_trigger_guard",
      "0019_provider_connection_retirement",
    ]);
    expect(() =>
      connection.sqlite
        .prepare(
          `INSERT INTO questions
           (id, day_id, kind, prompt, order_index, key_points_json, reveal_after_attempts, created_at, updated_at)
           VALUES ('bad', 'missing', 'explain', 'bad', 0, '[]', 2, 0, 0)`,
        )
        .run(),
    ).toThrow();
  });

  it("seeds curriculum idempotently without replacing user history", () => {
    const connection = fixture();
    const first = seedDatabase(connection, undefined, 1_000);
    const second = seedDatabase(connection, undefined, 2_000);

    expect(second).toEqual(first);
    expect(first.days).toBe(7);
    expect(count(connection, "curriculum_days")).toBe(7);
    expect(count(connection, "questions")).toBeGreaterThan(7);
    expect(count(connection, "provider_configurations")).toBe(0);
  });

  it("runs start-answer-reveal-complete flow transactionally and idempotently", async () => {
    const connection = fixture();
    seedDatabase(connection, undefined, 1_000);
    let nextId = 0;
    const repository = createLearningRepository(connection, {
      now: () => 2_000,
      id: () => `generated-${++nextId}`,
    });

    const started = await repository.startSession({
      dayId: "week-01-day-01",
      idempotencyKey: "start-day-one",
    });
    const startedAgain = await repository.startSession({
      dayId: "week-01-day-01",
      idempotencyKey: "start-day-one",
    });
    expect(startedAgain.session.id).toBe(started.session.id);
    expect(started.questions[0]?.canRevealReference).toBe(false);

    const questionId = started.questions[0]?.id;
    const topicId = started.topics[0]?.id;
    expect(questionId).toBeTruthy();
    expect(topicId).toBeTruthy();
    if (!questionId || !topicId) throw new Error("Seed fixture is incomplete");

    const answer = await repository.recordAnswer({
      sessionId: started.session.id,
      questionId,
      answer: "Первая самостоятельная попытка",
      idempotencyKey: "answer-one",
    });
    const duplicate = await repository.recordAnswer({
      sessionId: started.session.id,
      questionId,
      answer: "Повтор HTTP запроса",
      idempotencyKey: "answer-one",
    });
    expect(duplicate.id).toBe(answer.id);
    expect(
      await repository.getReferenceAnswer(started.session.id, questionId),
    ).toBeNull();
    await repository.recordAnswer({
      sessionId: started.session.id,
      questionId,
      answer: "Вторая самостоятельная попытка",
    });
    expect(
      await repository.getReferenceAnswer(started.session.id, questionId),
    ).not.toBeNull();

    const completion = {
      sessionId: started.session.id,
      mastery: [
        {
          topicId,
          dimension: "understanding",
          evidenceType: "answer",
          delta: 1,
          score: 1,
          confidence: 60,
          evidenceTypes: ["answer"],
        },
      ],
      mistakes: [
        {
          topicId,
          sourceType: "question",
          sourceId: questionId,
          summary: "Смешаны binding и value",
          correction: "Разделить binding и хранимое значение",
          fingerprint: "binding-vs-value",
        },
      ],
      flashcards: [
        {
          topicId,
          sourceMistakeFingerprint: "binding-vs-value",
          front: "Что хранит binding?",
          back: "Значение, в том числе ссылочное значение объекта.",
        },
      ],
      completedAt: 3_000,
    } as const;
    const completed = await repository.completeSession(completion);
    await repository.completeSession(completion);

    expect(completed.session.status).toBe("completed");
    expect(count(connection, "mastery_evidence")).toBe(1);
    expect(count(connection, "mistakes")).toBe(1);
    expect(count(connection, "flashcards")).toBe(1);
    const knowledge = await repository.getKnowledgeMap();
    expect(
      knowledge.find((item) => item.topic.id === topicId)?.mastery[0]?.score,
    ).toBe(1);
  });

  it("persists card, configuration, settings and conversation data", async () => {
    const connection = fixture();
    seedDatabase(connection, undefined, 1_000);
    const repository = createLearningRepository(connection, {
      now: () => 2_000,
    });

    await repository.setProviderConfiguration({
      providerId: "codex",
      enabled: true,
      teacherModelId: "gpt-test",
      options: { sandbox: "read-only" },
    });
    await repository.setSetting("theme", { value: "dark" });
    const conversation = await repository.createConversation({
      role: "teacher",
      providerId: "mock",
      modelId: "mock-teacher",
    });
    const message = await repository.addMessage({
      conversationId: conversation.id,
      role: "assistant",
      content: "Проверь причинную цепочку.",
      idempotencyKey: "message-1",
    });
    const repeated = await repository.addMessage({
      conversationId: conversation.id,
      role: "assistant",
      content: "duplicate",
      idempotencyKey: "message-1",
    });

    expect(
      (await repository.listProviderConfigurations()).find(
        (item) => item.providerId === "codex",
      )?.enabled,
    ).toBe(true);
    expect(await repository.getSetting("theme")).toEqual({ value: "dark" });
    expect(repeated.id).toBe(message.id);
  });
});

function count(connection: DatabaseConnection, table: string): number {
  const allowed = new Set([
    "curriculum_days",
    "questions",
    "provider_configurations",
    "mastery_evidence",
    "mistakes",
    "flashcards",
  ]);
  if (!allowed.has(table)) throw new Error(`Unsafe table in test: ${table}`);
  const row = connection.sqlite
    .prepare(`SELECT count(*) AS count FROM ${table}`)
    .get() as {
    count: number;
  };
  return row.count;
}
