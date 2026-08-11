import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import z from "zod";
import { createLearningKernelRepository } from "@aptiloop/database";
import { learningKernelSha256 } from "@aptiloop/learning-core";

const runtimes: Array<ReturnType<typeof createApp>> = [];
const roots: string[] = [];

afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.close();
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function createRuntime(databasePath?: string) {
  const root = databasePath
    ? path.dirname(databasePath)
    : mkdtempSync(path.join(tmpdir(), "aptiloop-summary-v2-"));
  if (!databasePath) roots.push(root);
  const resolvedDatabasePath = databasePath ?? path.join(root, "test.sqlite");
  const runtime = createApp({
    projectRoot: path.resolve("../.."),
    databasePath: resolvedDatabasePath,
    databaseMode: "disposable",
  });
  const result = Object.assign(runtime, { databasePath: resolvedDatabasePath });
  runtimes.push(result);
  return result;
}

function request(
  app: ReturnType<typeof createApp>["app"],
  pathname: string,
  init?: RequestInit,
) {
  return app.request(`http://127.0.0.1:8787${pathname}`, {
    ...init,
    headers: {
      Host: "127.0.0.1:8787",
      "X-Aptiloop-Client": "web",
      "Content-Type": "application/json",
      Origin: "http://127.0.0.1:3000",
      ...init?.headers,
    },
  });
}

interface UnitProgress {
  unitId: string;
  status: string;
  payload: Record<string, unknown> & { type: string };
}

interface LearningSession {
  id: string;
  status: string;
  currentStep: string;
  snapshot: {
    day: { id: string; topics: string[] };
    units: Array<{ id: string; stableId: string; type: string }>;
  };
  unitProgress: UnitProgress[];
}

function count(runtime: ReturnType<typeof createApp>, table: string): number {
  const row = runtime.state.connection.sqlite
    .prepare(`SELECT count(*) AS count FROM ${table}`)
    .get() as { count: number };
  return row.count;
}

function findUnit(session: LearningSession, type: string) {
  const unit = session.snapshot.units.find(
    (candidate) => candidate.type === type,
  );
  if (!unit) throw new Error(`Missing ${type} unit`);
  return unit;
}

function preparePersistedSummaryFacts(
  runtime: ReturnType<typeof createApp>,
  session: LearningSession,
) {
  const sqlite = runtime.state.connection.sqlite;
  const now = Date.now();
  const recall = findUnit(session, "recall");
  const teacher = findUnit(session, "teacher-dialogue");
  const quiz = findUnit(session, "quiz");
  const codeReading = findUnit(session, "code-reading");
  const exercise = findUnit(session, "exercise");
  const summary = findUnit(session, "summary");
  const quizUnit = session.snapshot.units.find((unit) => unit.id === quiz.id);
  if (!quizUnit) throw new Error("Missing quiz fixture");

  const snapshotRow = sqlite
    .prepare("SELECT snapshot_json FROM session_snapshots WHERE session_id = ?")
    .get(session.id) as { snapshot_json: string };
  const privateSnapshot = JSON.parse(snapshotRow.snapshot_json) as {
    units: Array<{ id: string; questions: Array<{ id: string }> }>;
  };
  const privateQuiz = privateSnapshot.units.find((unit) => unit.id === quiz.id);
  const questionIds =
    privateQuiz?.questions.map((question) => question.id) ?? [];
  if (questionIds.length < 2)
    throw new Error("Quiz needs two fixture questions");

  sqlite.exec("BEGIN IMMEDIATE");
  try {
    sqlite
      .prepare(
        `UPDATE unit_progress
         SET status = CASE WHEN unit_id = ? THEN 'in_progress'
                           WHEN unit_id IN (
                             SELECT unit_id FROM unit_progress
                             WHERE session_id = ? AND rowid < (
                               SELECT rowid FROM unit_progress
                               WHERE session_id = ? AND unit_id = ?
                             )
                           ) THEN 'completed'
                           ELSE 'locked' END,
             started_at = ?, completed_at = CASE WHEN unit_id = ? THEN NULL ELSE ? END,
             updated_at = ?
         WHERE session_id = ?`,
      )
      .run(
        summary.id,
        session.id,
        session.id,
        summary.id,
        now,
        summary.id,
        now,
        now,
        session.id,
      );
    sqlite
      .prepare(
        "UPDATE learning_sessions SET current_step = ?, updated_at = ? WHERE id = ?",
      )
      .run(summary.stableId, now, session.id);
    sqlite
      .prepare(
        "UPDATE unit_progress SET progress_json = ? WHERE session_id = ? AND unit_id = ?",
      )
      .run(
        JSON.stringify({
          type: "teacher-dialogue",
          conversationId: "teacher-conversation",
          turnCount: 3,
          revisionAttemptIds: ["teacher-revision-1"],
        }),
        session.id,
        teacher.id,
      );
    sqlite
      .prepare(
        "UPDATE unit_progress SET progress_json = ? WHERE session_id = ? AND unit_id = ?",
      )
      .run(
        JSON.stringify({
          type: "quiz",
          attemptedQuestionIds: questionIds.slice(0, 2),
          correctQuestionIds: [questionIds[0]],
          score: 0.5,
        }),
        session.id,
        quiz.id,
      );
    sqlite
      .prepare(
        "UPDATE unit_progress SET progress_json = ? WHERE session_id = ? AND unit_id = ?",
      )
      .run(
        JSON.stringify({
          type: "exercise",
          attemptId: "summary-exercise-attempt",
          latestTestRunId: "summary-test-run",
          latestReviewId: "summary-review-passed",
        }),
        session.id,
        exercise.id,
      );
    sqlite
      .prepare(
        `INSERT INTO versioned_unit_evidence
         (id, session_id, unit_id, evidence_type, operation_id, question_id,
          payload_json, correctness, created_at)
         VALUES
         ('summary-recall-evidence', ?, ?, 'recall-attempt',
          'summary-fixture-recall', NULL, '{"answer":"own recall"}', NULL, ?),
         ('summary-code-evidence', ?, ?, 'code-reading-attempt',
          'summary-fixture-code', NULL,
          '{"prediction":"p","explanation":"e","verbalFix":"f"}', NULL, ?)`,
      )
      .run(session.id, recall.id, now, session.id, codeReading.id, now + 1);

    const exerciseRow = sqlite
      .prepare("SELECT id FROM exercises ORDER BY id LIMIT 1")
      .get() as { id: string } | undefined;
    if (!exerciseRow) throw new Error("Missing seeded exercise");
    sqlite
      .prepare(
        `INSERT INTO exercise_attempts
         (id, session_id, exercise_id, status, workspace_path, baseline_path,
          baseline_hash, started_at, completed_at, updated_at)
         VALUES ('summary-exercise-attempt', ?, ?, 'completed', '.', '.',
                 'summary-baseline', ?, ?, ?)`,
      )
      .run(session.id, exerciseRow.id, now, now, now);
    sqlite
      .prepare(
        `INSERT INTO test_runs
         (id, exercise_attempt_id, operation_id, status, exit_code, stdout,
          stderr, duration_ms, started_at, completed_at)
         VALUES ('summary-test-run', 'summary-exercise-attempt',
                 'summary-fixture-test', 'passed', 0, '', '', 10, ?, ?)`,
      )
      .run(now + 2, now + 3);
    const insertReview = sqlite.prepare(
      `INSERT INTO reviews
       (id, session_id, exercise_attempt_id, provider_id, model_id, status,
        result_json, raw_response, created_at, completed_at)
       VALUES (?, ?, 'summary-exercise-attempt', 'mock', 'mock-deterministic',
               ?, '{}', NULL, ?, ?)`,
    );
    insertReview.run(
      "summary-review-change-1",
      session.id,
      "changes_requested",
      now + 4,
      now + 4,
    );
    insertReview.run(
      "summary-review-change-2",
      session.id,
      "changes_requested",
      now + 5,
      now + 5,
    );
    insertReview.run(
      "summary-review-passed",
      session.id,
      "passed",
      now + 6,
      now + 6,
    );
    sqlite
      .prepare(
        `INSERT INTO hint_usages_v2
         (id, session_id, unit_id, question_attempt_id, exercise_attempt_id,
          level, reason, content, used_at)
         VALUES ('summary-hint', ?, ?, NULL, 'summary-exercise-attempt',
                 4, 'learner-request', NULL, ?)`,
      )
      .run(session.id, exercise.id, now + 7);
    sqlite.exec("COMMIT");
  } catch (error) {
    sqlite.exec("ROLLBACK");
    throw error;
  }
  const kernelRepository = createLearningKernelRepository(
    runtime.state.connection,
  );
  const scope = kernelRepository.resolveSessionScope(session.id);
  const progressByStableId = new Map(
    session.snapshot.units.map((unit) => [
      unit.stableId,
      sqlite
        .prepare(
          `SELECT status FROM unit_progress
           WHERE session_id = ? AND unit_id = ?`,
        )
        .get(session.id, unit.id) as { status: string },
    ]),
  );
  const activityByStableId = sqlite.prepare(
    `SELECT id FROM course_activities
     WHERE course_id = ? AND revision_id = ? AND stable_id = ?`,
  );
  let factSequence = 0;
  for (const unit of session.snapshot.units) {
    const status = progressByStableId.get(unit.stableId)?.status;
    if (status !== "completed" && status !== "in_progress") continue;
    const activity = activityByStableId.get(
      scope.courseId,
      scope.revisionId,
      unit.stableId,
    ) as { id: string };
    for (const transition of status === "completed"
      ? (["start", "complete"] as const)
      : (["start"] as const)) {
      const sequence = String(factSequence++).padStart(3, "0");
      const source = {
        sessionId: session.id,
        activityId: activity.id,
        transition,
      };
      kernelRepository.accept(scope, {
        operationId: `summary-fixture-${sequence}-${transition}`,
        factId: `summary-fixture-fact-${sequence}-${transition}`,
        observedAt: new Date(now - 1_000 + factSequence).toISOString(),
        provenance: {
          kind:
            transition === "complete"
              ? "deterministic_evaluator"
              : "learner_submission",
          sourceId: `summary-fixture-${sequence}`,
          sourceHash: learningKernelSha256(source),
          ...(transition === "complete"
            ? { evaluatorVersion: "summary-fixture-v1" }
            : {}),
        },
        body: { type: "progress", activityId: activity.id, transition },
      });
    }
  }
  return { summary, questionIds };
}

describe("versioned day summary", () => {
  it("derives and idempotently persists summary artifacts from server facts", async () => {
    const runtime = createRuntime();
    const pathResponse = await request(runtime.app, "/api/learning/path");
    const pathBody = (await pathResponse.json()) as {
      curriculum: { weeks: Array<{ days: Array<{ id: string }> }> };
    };
    const dayId = pathBody.curriculum.weeks[0]?.days[0]?.id;
    if (!dayId) throw new Error("Missing seeded Day 1");
    const startResponse = await request(
      runtime.app,
      "/api/learning/sessions/v2",
      {
        method: "POST",
        body: JSON.stringify({ dayId, operationId: "summary-start" }),
      },
    );
    expect(startResponse.status).toBe(201);
    const started = (await startResponse.json()) as {
      session: LearningSession;
    };
    const { summary: summaryUnit, questionIds } = preparePersistedSummaryFacts(
      runtime,
      started.session,
    );

    const fakeCompletion = await request(
      runtime.app,
      `/api/learning/sessions/v2/${started.session.id}/units/${summaryUnit.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          operationId: "fake-summary-completion",
          status: "completed",
          payload: { type: "summary", summaryId: "fake-summary-id" },
        }),
      },
    );
    expect(fakeCompletion.status).toBeGreaterThanOrEqual(400);

    const strictBody = await request(
      runtime.app,
      `/api/learning/sessions/v2/${started.session.id}/units/${summaryUnit.id}/summary`,
      {
        method: "POST",
        body: JSON.stringify({ operationId: "strict", extra: true }),
      },
    );
    expect(strictBody.status).toBe(400);

    const missingSummary = await request(
      runtime.app,
      `/api/learning/sessions/v2/${started.session.id}/units/${summaryUnit.id}/summary`,
    );
    expect(missingSummary.status).toBe(404);

    const summaryResponse = await request(
      runtime.app,
      `/api/learning/sessions/v2/${started.session.id}/units/${summaryUnit.id}/summary`,
      {
        method: "POST",
        body: JSON.stringify({ operationId: "summary-once" }),
      },
    );
    expect(summaryResponse.status).toBe(201);
    const body = (await summaryResponse.json()) as {
      evidence: { id: string };
      summary: {
        sessionId: string;
        masteryEvidence: unknown[];
        mistakeCandidates: unknown[];
        flashcardCandidates: unknown[];
        metrics: {
          quizScore: number;
          maxHintLevel: number;
          exerciseTestsPassed: boolean;
          reviewStatus: string;
          correctionCycleCount: number;
        };
      };
      session: LearningSession;
    };
    expect(body.summary).toMatchObject({
      sessionId: started.session.id,
      metrics: {
        quizScore: 0.5,
        maxHintLevel: 4,
        exerciseTestsPassed: true,
        reviewStatus: "passed",
        correctionCycleCount: 2,
      },
    });
    expect(body.summary.mistakeCandidates).toHaveLength(1);
    expect(body.summary.flashcardCandidates).toHaveLength(1);
    expect(JSON.stringify(body)).not.toContain("correctOptionIds");
    expect(JSON.stringify(body)).not.toContain("referenceAnswer");
    expect(body.summary.mistakeCandidates).toEqual([
      expect.objectContaining({ sourceId: questionIds[1] }),
    ]);
    const progress = body.session.unitProgress.find(
      (item) => item.unitId === summaryUnit.id,
    );
    expect(progress).toMatchObject({
      status: "in_progress",
      payload: { type: "summary", summaryId: body.evidence.id },
    });

    const counts = {
      summaryEvidence: count(runtime, "versioned_unit_evidence"),
      masteryEvidence: count(runtime, "mastery_evidence"),
      masteryScores: count(runtime, "mastery_scores"),
      mistakes: count(runtime, "mistakes"),
      flashcards: count(runtime, "flashcards"),
    };
    const retryResponse = await request(
      runtime.app,
      `/api/learning/sessions/v2/${started.session.id}/units/${summaryUnit.id}/summary`,
      {
        method: "POST",
        body: JSON.stringify({ operationId: "summary-once" }),
      },
    );
    expect(retryResponse.status).toBe(201);
    const retry = (await retryResponse.json()) as typeof body;
    expect(retry.evidence.id).toBe(body.evidence.id);
    expect(retry.summary).toEqual(body.summary);
    expect({
      summaryEvidence: count(runtime, "versioned_unit_evidence"),
      masteryEvidence: count(runtime, "mastery_evidence"),
      masteryScores: count(runtime, "mastery_scores"),
      mistakes: count(runtime, "mistakes"),
      flashcards: count(runtime, "flashcards"),
    }).toEqual(counts);

    await runtime.close();
    runtimes.splice(runtimes.indexOf(runtime), 1);
    const restarted = createRuntime(runtime.databasePath);
    const restoredResponse = await request(
      restarted.app,
      `/api/learning/sessions/v2/${started.session.id}/units/${summaryUnit.id}/summary`,
    );
    expect(restoredResponse.status).toBe(200);
    const restored = (await restoredResponse.json()) as typeof body;
    expect(restored.evidence.id).toBe(body.evidence.id);
    expect(restored.summary).toEqual(body.summary);
    expect(JSON.stringify(restored)).not.toContain("correctOptionIds");
    expect(JSON.stringify(restored)).not.toContain("referenceAnswer");

    const knowledgeResponse = await request(restarted.app, "/api/knowledge");
    const mistakesResponse = await request(restarted.app, "/api/mistakes");
    const cardsResponse = await request(restarted.app, "/api/flashcards");
    const [knowledge, mistakes, cards] = await Promise.all([
      knowledgeResponse.json(),
      mistakesResponse.json(),
      cardsResponse.json(),
    ]);
    expect(JSON.stringify(knowledge)).toContain(
      started.session.snapshot.day.topics[0]!,
    );
    expect((mistakes as { mistakes: unknown[] }).mistakes).toHaveLength(1);
    expect((cards as { flashcards: unknown[] }).flashcards).toHaveLength(1);

    const card = z
      .object({ id: z.string(), status: z.literal("candidate") })
      .parse((cards as { flashcards: unknown[] }).flashcards[0]);
    const unknownFlashcardField = await request(
      restarted.app,
      `/api/flashcards/${card.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({ status: "approved", unexpected: true }),
      },
    );
    expect(unknownFlashcardField.status).toBe(400);
    const unchangedCards = z
      .object({
        flashcards: z.array(z.object({ id: z.string(), status: z.string() })),
      })
      .parse(await (await request(restarted.app, "/api/flashcards")).json());
    expect(
      unchangedCards.flashcards.find((candidate) => candidate.id === card.id)
        ?.status,
    ).toBe("candidate");

    const completeResponse = await request(
      restarted.app,
      `/api/learning/sessions/v2/${started.session.id}/units/${summaryUnit.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          operationId: "complete-real-summary",
          status: "completed",
          payload: { type: "summary", summaryId: body.evidence.id },
        }),
      },
    );
    expect(completeResponse.status).toBe(200);
    const completed = (await completeResponse.json()) as {
      session: LearningSession;
    };
    expect(completed.session.status).toBe("completed");

    const completedSummaryResponse = await request(
      restarted.app,
      `/api/learning/sessions/v2/${started.session.id}/units/${summaryUnit.id}/summary`,
    );
    expect(completedSummaryResponse.status).toBe(200);
    const completedSummary =
      (await completedSummaryResponse.json()) as typeof body;
    expect(completedSummary.evidence.id).toBe(body.evidence.id);
    expect(completedSummary.summary).toEqual(body.summary);
  });
});
