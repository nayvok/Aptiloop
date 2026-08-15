import { afterEach, describe, expect, it } from "vitest";

import {
  canonicalLearningKernelJson,
  type LearningKernelFactBody,
  type LearningKernelFactProvenance,
  type LearningKernelScope,
} from "@aptiloop/learning-core";

import {
  createCurriculumAuthoringRepository,
  createLearningKernelRepository,
  createLearningRepository,
  migrateDatabase,
  openDatabase,
  type DatabaseConnection,
} from "../src/index.js";
import { backfillLearningKernel } from "../src/learning-kernel-backfill.js";
import { seedDatabase } from "../src/development-fixtures.js";

const connections: DatabaseConnection[] = [];
const hash = (character: string) => `sha256:${character.repeat(64)}`;

async function setupFixture() {
  const connection = openDatabase(":memory:");
  connections.push(connection);
  migrateDatabase(connection);
  seedDatabase(connection, undefined, 1_000);
  let id = 0;
  const learning = createLearningRepository(connection, {
    id: () => `kernel-session-id-${++id}`,
    now: () => 2_000 + id,
  });
  const path = await createCurriculumAuthoringRepository(
    connection,
  ).getActivePath("curriculum-foundation");
  const day = path?.weeks[0]?.days[0];
  if (!day) throw new Error("Seeded Course lesson is unavailable");
  const session = await learning.startOrResumeVersionedSession({
    dayId: day.id,
    idempotencyKey: "kernel-session",
  });
  const context = connection.sqlite
    .prepare(
      `SELECT course_id, revision_id, lesson_id, adaptation_branch_id
       FROM session_course_contexts WHERE session_id = ?`,
    )
    .get(session.session.id) as {
    course_id: string;
    revision_id: string;
    lesson_id: string;
    adaptation_branch_id: string;
  };
  const activity = connection.sqlite
    .prepare(
      `SELECT activity.id, lesson.topics_json
       FROM course_activities activity
       JOIN course_lessons lesson ON lesson.id = activity.lesson_id
       WHERE activity.course_id = ? AND activity.revision_id = ?
             AND activity.lesson_id = ?
       ORDER BY activity.order_index, activity.id LIMIT 1`,
    )
    .get(context.course_id, context.revision_id, context.lesson_id) as {
    id: string;
    topics_json: string;
  };
  const knowledgeNodeId = (JSON.parse(activity.topics_json) as string[])[0];
  if (!knowledgeNodeId) throw new Error("Seeded lesson has no knowledge node");
  const scope: LearningKernelScope = {
    courseId: context.course_id,
    revisionId: context.revision_id,
    branchId: context.adaptation_branch_id,
    sessionId: session.session.id,
  };
  return { connection, scope, activityId: activity.id, knowledgeNodeId };
}

afterEach(() => {
  while (connections.length > 0) connections.pop()?.close();
});

function evidence(
  activityId: string,
  knowledgeNodeId: string,
  outcome: "unverified" | "correct",
  basisFactIds: readonly string[],
): LearningKernelFactBody {
  return {
    type: "evidence",
    activityId,
    knowledgeNodeIds: [knowledgeNodeId],
    dimension: "understanding",
    evidenceType: "recall",
    outcome,
    hintLevel: 0,
    basisFactIds,
  };
}

const learner: LearningKernelFactProvenance = {
  kind: "learner_submission",
  sourceId: "browser-operation",
  sourceHash: hash("a"),
};
const evaluator: LearningKernelFactProvenance = {
  kind: "deterministic_evaluator",
  sourceId: "objective-evaluator",
  sourceHash: hash("b"),
  evaluatorVersion: "objective-v1",
};

describe("LearningKernelRepository", () => {
  it("atomically persists append-only facts and byte-replayable projections", async () => {
    const setup = await setupFixture();
    const repository = createLearningKernelRepository(setup.connection, {
      now: () => Date.parse("2026-08-10T09:00:10.000Z"),
    });
    const attempt = repository.accept(setup.scope, {
      operationId: "kernel-attempt-operation",
      factId: "kernel-attempt-fact",
      observedAt: "2026-08-10T09:00:00.000Z",
      provenance: learner,
      body: evidence(setup.activityId, setup.knowledgeNodeId, "unverified", []),
    });
    const evaluated = repository.accept(setup.scope, {
      operationId: "kernel-evaluation-operation",
      factId: "kernel-evaluation-fact",
      observedAt: "2026-08-10T09:00:01.000Z",
      provenance: evaluator,
      body: evidence(setup.activityId, setup.knowledgeNodeId, "correct", [
        "kernel-attempt-fact",
      ]),
    });
    expect(evaluated.projection.factFrontier).toEqual([
      "kernel-attempt-fact",
      "kernel-evaluation-fact",
    ]);
    expect(
      evaluated.projection.masteryByKnowledgeNode[setup.knowledgeNodeId]
        ?.understanding.state.score,
    ).toBe(0.488);

    const stored = repository.readProjection(setup.scope);
    expect(canonicalLearningKernelJson(stored)).toBe(
      canonicalLearningKernelJson(evaluated.projection),
    );
    expect(repository.readFacts(setup.scope)).toEqual(evaluated.facts);
    const replayed = repository.reproject(
      setup.scope,
      "2026-08-10T09:00:01.000Z",
    );
    expect(replayed.projectionHash).toBe(evaluated.projection.projectionHash);

    const idempotent = repository.accept(setup.scope, {
      operationId: evaluated.acceptedFact!.operationId,
      factId: evaluated.acceptedFact!.id,
      observedAt: evaluated.acceptedFact!.occurredAt,
      provenance: evaluated.acceptedFact!.provenance,
      body: evaluated.acceptedFact!.body,
    });
    expect(idempotent).toMatchObject({ accepted: false, idempotent: true });
    expect(
      setup.connection.sqlite
        .prepare("SELECT count(*) AS count FROM learning_kernel_facts")
        .get(),
    ).toEqual({ count: 2 });
    expect(() =>
      setup.connection.sqlite
        .prepare(
          "UPDATE learning_kernel_facts SET canonical_json = '{}' WHERE id = ?",
        )
        .run(attempt.acceptedFact!.id),
    ).toThrow("Learning Kernel fact is append-only");
    expect(
      setup.connection.sqlite.prepare("PRAGMA foreign_key_check").all(),
    ).toEqual([]);
  });

  it("rolls back the accepted fact when projection persistence fails", async () => {
    const setup = await setupFixture();
    const repository = createLearningKernelRepository(setup.connection, {
      now: () => Date.parse("2026-08-10T09:00:10.000Z"),
    });
    setup.connection.sqlite.exec(`
      CREATE TRIGGER force_kernel_projection_rollback
      BEFORE INSERT ON learning_kernel_projection_history
      BEGIN SELECT RAISE(ABORT, 'forced Kernel projection rollback'); END;
    `);
    expect(() =>
      repository.accept(setup.scope, {
        operationId: "kernel-start-operation",
        factId: "kernel-start-fact",
        observedAt: "2026-08-10T09:00:00.000Z",
        provenance: learner,
        body: {
          type: "progress",
          activityId: setup.activityId,
          transition: "start",
        },
      }),
    ).toThrow("forced Kernel projection rollback");
    expect(
      setup.connection.sqlite
        .prepare("SELECT count(*) AS count FROM learning_kernel_facts")
        .get(),
    ).toEqual({ count: 0 });
    expect(
      setup.connection.sqlite
        .prepare("SELECT count(*) AS count FROM learning_kernel_projections")
        .get(),
    ).toEqual({ count: 0 });
  });

  it("fails closed when the stored projection diverges from replayed facts", async () => {
    const setup = await setupFixture();
    const repository = createLearningKernelRepository(setup.connection, {
      now: () => Date.parse("2026-08-10T09:00:10.000Z"),
    });
    repository.accept(setup.scope, {
      operationId: "kernel-divergence-operation",
      factId: "kernel-divergence-fact",
      observedAt: "2026-08-10T09:00:00.000Z",
      provenance: learner,
      body: evidence(setup.activityId, setup.knowledgeNodeId, "unverified", []),
    });
    const stored = repository.readProjection(setup.scope);
    if (!stored) throw new Error("Stored projection fixture is unavailable");
    const divergent = {
      ...stored,
      summary: {
        ...stored.summary,
        gapReasonCodes: ["tampered:legacy-read-model"],
      },
    };
    setup.connection.sqlite
      .prepare(
        `UPDATE learning_kernel_projections
         SET projection_json = ? WHERE session_id = ?`,
      )
      .run(canonicalLearningKernelJson(divergent), setup.scope.sessionId);

    expect(() => repository.readProjection(setup.scope)).toThrow(
      "Stored Learning Kernel projection diverges from append-only facts",
    );
  });

  it("replays an exact historical frontier after later facts are appended", async () => {
    const setup = await setupFixture();
    const repository = createLearningKernelRepository(setup.connection, {
      now: () => Date.parse("2026-08-10T09:00:10.000Z"),
    });
    const first = repository.accept(setup.scope, {
      operationId: "kernel-frontier-first-operation",
      factId: "kernel-frontier-first-fact",
      observedAt: "2026-08-10T09:00:00.000Z",
      provenance: learner,
      body: evidence(setup.activityId, setup.knowledgeNodeId, "unverified", []),
    });
    repository.accept(setup.scope, {
      operationId: "kernel-frontier-second-operation",
      factId: "kernel-frontier-second-fact",
      observedAt: "2026-08-10T09:00:01.000Z",
      provenance: evaluator,
      body: evidence(setup.activityId, setup.knowledgeNodeId, "correct", [
        "kernel-frontier-first-fact",
      ]),
    });

    const replayed = repository.reprojectFrontier(
      setup.scope,
      first.projection.observedAt,
      first.projection.summary.sourceFactIds,
    );
    expect(canonicalLearningKernelJson(replayed)).toBe(
      canonicalLearningKernelJson(first.projection),
    );
    expect(() =>
      repository.reprojectFrontier(setup.scope, first.projection.observedAt, [
        "kernel-frontier-second-fact",
      ]),
    ).toThrow();
  });

  it("reconstructs only facts proven accepted before a legacy boundary", async () => {
    const setup = await setupFixture();
    let acceptedAt = Date.parse("2026-08-10T09:00:10.000Z");
    const repository = createLearningKernelRepository(setup.connection, {
      now: () => acceptedAt,
    });
    repository.accept(setup.scope, {
      operationId: "kernel-accepted-frontier-first-operation",
      factId: "kernel-accepted-frontier-first-fact",
      observedAt: "2026-08-10T09:00:00.000Z",
      provenance: learner,
      body: evidence(setup.activityId, setup.knowledgeNodeId, "unverified", []),
    });
    acceptedAt += 2;
    repository.accept(setup.scope, {
      operationId: "kernel-accepted-frontier-later-operation",
      factId: "kernel-accepted-frontier-later-fact",
      observedAt: "2026-08-10T09:00:00.000Z",
      provenance: learner,
      body: evidence(setup.activityId, setup.knowledgeNodeId, "unverified", []),
    });

    expect(
      repository.readAcceptedFactFrontier(
        setup.scope,
        "2026-08-10T09:00:00.000Z",
        acceptedAt - 1,
      ),
    ).toEqual(["kernel-accepted-frontier-first-fact"]);
    expect(() =>
      repository.readAcceptedFactFrontier(
        setup.scope,
        "2026-08-10T09:00:00.000Z",
        acceptedAt,
      ),
    ).toThrow(
      "Learning Kernel accepted frontier is ambiguous at the persisted boundary",
    );
  });
});

it("backfills provable progress and quarantines non-authoritative summaries idempotently", async () => {
  const setup = await setupFixture();
  setup.connection.sqlite
    .prepare(
      `UPDATE unit_progress
       SET status = 'in_progress', started_at = 3000, updated_at = 3000
       WHERE session_id = ? AND unit_id = ?`,
    )
    .run(setup.scope.sessionId, setup.activityId);
  const summaryActivity = setup.connection.sqlite
    .prepare(
      `SELECT activity.id FROM course_activities activity
       JOIN session_course_contexts context
         ON context.course_id = activity.course_id
        AND context.revision_id = activity.revision_id
        AND context.lesson_id = activity.lesson_id
       WHERE context.session_id = ? AND activity.activity_type = 'summary'
       ORDER BY activity.order_index, activity.id LIMIT 1`,
    )
    .get(setup.scope.sessionId) as { id: string } | undefined;
  if (!summaryActivity)
    throw new Error("Seeded summary activity is unavailable");
  setup.connection.sqlite
    .prepare(
      `INSERT INTO versioned_unit_evidence
       (id, session_id, unit_id, evidence_type, operation_id, question_id,
        payload_json, correctness, created_at)
       VALUES ('legacy-summary', ?, ?, 'summary', 'legacy-summary-operation',
               NULL, '{}', NULL, 3100)`,
    )
    .run(setup.scope.sessionId, summaryActivity.id);

  expect(backfillLearningKernel(setup.connection, 4000)).toEqual({
    acceptedFacts: 1,
    quarantinedRows: 1,
  });
  expect(
    setup.connection.sqlite
      .prepare(
        `SELECT provenance_kind AS provenanceKind, body_type AS bodyType
         FROM learning_kernel_facts
         WHERE provenance_kind = 'migration'`,
      )
      .all(),
  ).toEqual([{ provenanceKind: "migration", bodyType: "progress" }]);
  expect(
    setup.connection.sqlite
      .prepare(
        `SELECT reason_code AS reasonCode
         FROM learning_kernel_migration_quarantine
         WHERE source_id = 'legacy-summary'`,
      )
      .get(),
  ).toEqual({ reasonCode: "SUMMARY_IS_NON_AUTHORITATIVE_PROJECTION" });
  expect(backfillLearningKernel(setup.connection, 4000)).toEqual({
    acceptedFacts: 0,
    quarantinedRows: 0,
  });
});
