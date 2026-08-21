import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import { seedDevelopmentDatabase } from "./development-database-fixture.js";
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
    developmentDatabaseInitializer: seedDevelopmentDatabase,
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

function daySummaryFingerprint(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).padStart(7, "0");
}

function insertAuthoritativeSummaryReview(
  runtime: ReturnType<typeof createApp>,
  input: {
    reviewId: string;
    sessionId: string;
    exerciseAttemptId: string;
    testRunId: string;
    testOperationId: string;
    resultStatus: "passed" | "changes_requested";
    createdAt: number;
  },
): void {
  const workspaceSnapshotHash = `sha256:${createHash("sha256")
    .update(`${input.reviewId}:workspace`, "utf8")
    .digest("hex")}`;
  const diffFingerprint = createHash("sha256")
    .update(`${input.reviewId}:diff`, "utf8")
    .digest("hex");
  const checkId = "apt.compat.node24.npm-test.v1";
  const environmentId = "apt.compat.node24.local.v1";
  const environmentPackDigest =
    "sha256:8a714b40eb7d8c64ea6ef2844577bbffd509f7edf7225b2bd26bd2656a0b68b8";
  const backendId = "local-native";
  const gitDiff = [
    "diff --git a/src/example.ts b/src/example.ts",
    "--- a/src/example.ts",
    "+++ b/src/example.ts",
    "@@ -1 +1 @@",
    "-export const value = 1;",
    "+export const value = 2;",
    "",
  ].join("\n");
  const resultJson = JSON.stringify({
    status: input.resultStatus,
    summary: "Advisory result over the same deterministic evidence.",
    findings:
      input.resultStatus === "changes_requested"
        ? [
            {
              severity: "warning",
              category: "readability",
              file: "src/example.ts",
              line: 1,
              message: "Consider a clearer local name.",
              hintLevel: 0,
            },
          ]
        : [],
    strengths: [],
    suggestedMasteryChanges: [],
  });
  const bundleJson = JSON.stringify({
    schemaVersion: 1,
    kind: "apt.review-evidence.v1",
    task: "Review the bounded learner diff.",
    exercise: {
      prompt: "Update the example value.",
      acceptanceCriteria: [],
      constraints: [],
      approvedTopicIds: [],
    },
    workspace: { inputSnapshotHash: workspaceSnapshotHash },
    evidence: {
      gitDiff,
      diffTruncated: false,
      trustedCheck: {
        operationId: input.testOperationId,
        checkId,
        environmentId,
        environmentPackDigest,
        backendId,
        inputSnapshotHash: workspaceSnapshotHash,
        status: "passed",
      },
    },
  });
  const bundleSha256 = `sha256:${createHash("sha256")
    .update(bundleJson, "utf8")
    .digest("hex")}`;
  const sqlite = runtime.state.connection.sqlite;
  const updated = sqlite
    .prepare(
      `UPDATE test_runs
       SET status = 'passed', exit_code = 0, diff_fingerprint = ?,
           diff_truncated = 0, check_id = ?, environment_id = ?,
           environment_pack_digest = ?, backend_id = ?,
           input_snapshot_hash = ?, result_json = ?
       WHERE id = ? AND exercise_attempt_id = ?`,
    )
    .run(
      diffFingerprint,
      checkId,
      environmentId,
      environmentPackDigest,
      backendId,
      workspaceSnapshotHash,
      JSON.stringify({ schemaVersion: 1, status: "passed" }),
      input.testRunId,
      input.exerciseAttemptId,
    );
  if (updated.changes !== 1) throw new Error("Missing Summary test fixture");
  sqlite
    .prepare(
      `INSERT INTO reviews
       (id, session_id, exercise_attempt_id, provider_id, model_id, status,
        result_json, raw_response, created_at, completed_at)
       VALUES (?, ?, ?, 'mock', 'mock-reviewer', 'accepted', ?, NULL, ?, ?)`,
    )
    .run(
      input.reviewId,
      input.sessionId,
      input.exerciseAttemptId,
      resultJson,
      input.createdAt,
      input.createdAt,
    );
  sqlite
    .prepare(
      `INSERT INTO review_evidence_bundles
       (id, review_id, exercise_attempt_id, test_run_id,
        workspace_snapshot_hash, diff_fingerprint, bundle_sha256, bundle_json,
        created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      `${input.reviewId}-bundle`,
      input.reviewId,
      input.exerciseAttemptId,
      input.testRunId,
      workspaceSnapshotHash,
      diffFingerprint,
      bundleSha256,
      bundleJson,
      input.createdAt,
    );
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
      "accepted",
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
  it("keeps Summary mastery independent from the advisory Reviewer verdict", async () => {
    const summarize = async (
      resultStatus: "passed" | "changes_requested",
      fixtureId: string,
    ) => {
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
          body: JSON.stringify({
            dayId,
            operationId: `summary-verdict-start-${fixtureId}`,
          }),
        },
      );
      const started = (await startResponse.json()) as {
        session: LearningSession;
      };
      const { summary } = preparePersistedSummaryFacts(
        runtime,
        started.session,
      );
      insertAuthoritativeSummaryReview(runtime, {
        reviewId: `summary-authoritative-${fixtureId}`,
        sessionId: started.session.id,
        exerciseAttemptId: "summary-exercise-attempt",
        testRunId: "summary-test-run",
        testOperationId: "summary-fixture-test",
        resultStatus,
        createdAt: Date.now() + 10_000,
      });
      const response = await request(
        runtime.app,
        `/api/learning/sessions/v2/${started.session.id}/units/${summary.id}/summary`,
        {
          method: "POST",
          body: JSON.stringify({
            operationId: `summary-verdict-${fixtureId}`,
          }),
        },
      );
      expect(response.status).toBe(201);
      return (await response.json()) as {
        session: LearningSession;
        summary: {
          masteryEvidence: Array<{
            dimension: string;
            type: string;
            outcome: string;
            hintLevel: number;
            topicId: string;
            errorKey?: string;
          }>;
          strengths: Array<{
            key: string;
            params?: Record<string, string | number>;
          }>;
          gaps: Array<{
            key: string;
            params?: Record<string, string | number>;
          }>;
          mistakeCandidates: Array<{ fingerprint: string; sourceId: string }>;
          metrics: {
            correctEvidenceCount: number;
            partialEvidenceCount: number;
            incorrectEvidenceCount: number;
            attemptedActivityCount: number;
            exerciseTestsPassed: boolean;
            reviewReceiptAccepted: boolean;
            reviewStatus: null;
            correctionCycleCount: 0;
          };
        };
      };
    };

    const passed = await summarize("passed", "passed");
    const changesRequested = await summarize(
      "changes_requested",
      "changes-requested",
    );
    const masterySemantics = (result: typeof passed) =>
      result.summary.masteryEvidence.map(({ dimension, type, outcome }) => ({
        dimension,
        type,
        outcome,
      }));

    expect(masterySemantics(changesRequested)).toEqual(
      masterySemantics(passed),
    );
    expect(changesRequested.summary.strengths).toEqual(
      passed.summary.strengths,
    );
    expect(changesRequested.summary.gaps).toEqual(passed.summary.gaps);
    expect(changesRequested.summary.mistakeCandidates).toEqual(
      passed.summary.mistakeCandidates,
    );
    expect(changesRequested.summary.metrics).toEqual(passed.summary.metrics);
    const progressionSemantics = (result: typeof passed) =>
      result.session.unitProgress.map(({ unitId, status, payload }) => ({
        unitId,
        status,
        payload,
      }));
    expect(progressionSemantics(changesRequested)).toEqual(
      progressionSemantics(passed),
    );
    expect(changesRequested.summary.metrics).toMatchObject({
      exerciseTestsPassed: true,
      reviewReceiptAccepted: true,
      reviewStatus: null,
      correctionCycleCount: 0,
    });
    expect(
      changesRequested.summary.masteryEvidence.some(
        (evidence) => evidence.dimension === "debugging",
      ),
    ).toBe(false);
    expect(
      changesRequested.summary.mistakeCandidates.some((mistake) =>
        mistake.fingerprint.startsWith("mistake-review-"),
      ),
    ).toBe(false);
  });

  it("migrates persisted legacy summary prose into locale-neutral messages", async () => {
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
        body: JSON.stringify({ dayId, operationId: "legacy-summary-start" }),
      },
    );
    expect(startResponse.status).toBe(201);
    const started = (await startResponse.json()) as {
      session: LearningSession;
    };
    const { summary } = preparePersistedSummaryFacts(runtime, started.session);
    insertAuthoritativeSummaryReview(runtime, {
      reviewId: "legacy-summary-review",
      sessionId: started.session.id,
      exerciseAttemptId: "summary-exercise-attempt",
      testRunId: "summary-test-run",
      testOperationId: "summary-fixture-test",
      resultStatus: "passed",
      createdAt: Date.now() + 10_000,
    });
    const response = await request(
      runtime.app,
      `/api/learning/sessions/v2/${started.session.id}/units/${summary.id}/summary`,
      {
        method: "POST",
        body: JSON.stringify({ operationId: "legacy-summary-read" }),
      },
    );
    expect(response.status).toBe(201);
    const created = (await response.json()) as {
      evidence: { id: string };
      summary: {
        metrics: {
          evidenceCount: number;
          correctEvidenceCount: number;
          partialEvidenceCount: number;
          incorrectEvidenceCount: number;
        };
      };
    };

    const evidenceRow = runtime.state.connection.sqlite
      .prepare(
        "SELECT payload_json FROM versioned_unit_evidence WHERE id = ? AND evidence_type = 'summary'",
      )
      .get(created.evidence.id) as { payload_json: string };
    const payload = JSON.parse(evidenceRow.payload_json) as {
      authority: unknown;
      summary: Record<string, unknown>;
    };
    const metrics = created.summary.metrics;
    const legacyPayload = {
      authority: payload.authority,
      summary: {
        ...payload.summary,
        strengths: [
          "Квиз пройден на уровне уверенного понимания.",
          "Реализация прошла разрешённые проверки.",
        ],
        gaps: [
          "Воспроизведение по памяти выполнено, но его корректность отдельно не подтверждена.",
          "Неизвестное историческое пояснение.",
        ],
        mistakeCandidates: [
          {
            fingerprint: "mistake-quiz-legacy",
            summary: "В квизе выбран неверный или неполный ответ.",
            correction:
              "Восстановить проверяемое правило своими словами и подтвердить новым примером.",
            sourceId: "question-legacy",
          },
        ],
        flashcardCandidates: [
          {
            front: "Восстановите правило, проверенное вопросом квиза.",
            back: "Сформулируйте правило своими словами и приведите собственный пример.",
            sourceFingerprint: "mistake-quiz-legacy",
          },
        ],
        narrative: `Собрано подтверждений навыка: ${metrics.evidenceCount}. Подтверждено: ${metrics.correctEvidenceCount}. Частично: ${metrics.partialEvidenceCount}. Требует работы: ${metrics.incorrectEvidenceCount}.`,
      },
    };
    const sqlite = runtime.state.connection.sqlite;
    sqlite
      .prepare(
        `INSERT INTO versioned_unit_evidence
         (id, session_id, unit_id, evidence_type, operation_id, question_id,
          payload_json, correctness, created_at)
         VALUES ('legacy-summary-evidence', ?, ?, 'summary',
                 'summary:' || ? , NULL, ?, NULL, ?)`,
      )
      .run(
        started.session.id,
        summary.id,
        createHash("sha256").update("legacy-summary-operation").digest("hex"),
        JSON.stringify(legacyPayload),
        Date.now() + 1,
      );
    const progressRow = sqlite
      .prepare(
        "SELECT progress_json FROM unit_progress WHERE session_id = ? AND unit_id = ?",
      )
      .get(started.session.id, summary.id) as {
      progress_json: string | null;
    };
    const progress = JSON.parse(progressRow.progress_json ?? "{}") as {
      type?: string;
    };
    sqlite
      .prepare(
        "UPDATE unit_progress SET progress_json = ? WHERE session_id = ? AND unit_id = ?",
      )
      .run(
        JSON.stringify({
          ...progress,
          type: "summary",
          summaryId: "legacy-summary-evidence",
        }),
        started.session.id,
        summary.id,
      );

    const rereadResponse = await request(
      runtime.app,
      `/api/learning/sessions/v2/${started.session.id}/units/${summary.id}/summary`,
    );
    expect(rereadResponse.status).toBe(200);
    const reread = (await rereadResponse.json()) as {
      summary: {
        strengths: Array<{ key: string }>;
        gaps: Array<{ key: string; params?: { text: string } }>;
        mistakeCandidates: Array<{ summary: { key: string } }>;
        flashcardCandidates: Array<{ front: { key: string } }>;
        narrative: {
          key: string;
          params?: Record<string, string | number>;
        };
      };
    };
    expect(reread.summary.strengths).toEqual([
      { key: "daySummary.strength.quizConfident" },
      { key: "daySummary.strength.exercisePassed" },
    ]);
    expect(reread.summary.gaps[0]).toEqual({
      key: "daySummary.gap.recallUnverified",
    });
    expect(reread.summary.gaps[1]).toEqual({
      key: "daySummary.legacy.untranslated",
      params: { text: "Неизвестное историческое пояснение." },
    });
    expect(reread.summary.mistakeCandidates[0]?.summary).toEqual({
      key: "daySummary.mistake.quizSummary",
    });
    expect(reread.summary.flashcardCandidates[0]?.front).toEqual({
      key: "daySummary.flashcard.ruleFront",
    });
    expect(reread.summary.narrative).toEqual({
      key: "daySummary.narrative.evidence",
      params: {
        evidenceCount: metrics.evidenceCount,
        correctCount: metrics.correctEvidenceCount,
        partialCount: metrics.partialEvidenceCount,
        incorrectCount: metrics.incorrectEvidenceCount,
      },
    });
  });

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
    const sharedTitle = started.session.snapshot.day.topics[0]!;
    const otherCourseDigest = createHash("sha256")
      .update(`other-course\0other-revision\0${sharedTitle}`)
      .digest("hex");
    const otherCourseTopicId = `topic-v2-${otherCourseDigest.slice(0, 24)}`;
    runtime.state.connection.sqlite
      .prepare(
        `INSERT INTO topics
         (id, slug, title, description, created_at, updated_at)
         VALUES (?, ?, ?, NULL, ?, ?)`,
      )
      .run(
        otherCourseTopicId,
        `topic-v2-${otherCourseDigest}`,
        sharedTitle,
        Date.now(),
        Date.now(),
      );
    const currentSessionRow = runtime.state.connection.sqlite
      .prepare("SELECT day_id AS dayId FROM learning_sessions WHERE id = ?")
      .get(started.session.id) as { dayId: string };
    const collisionFingerprint = `mistake-quiz-${daySummaryFingerprint(
      questionIds[1]!,
    )}`;
    runtime.state.connection.sqlite
      .prepare(
        `INSERT INTO learning_sessions
         (id, day_id, status, current_step, idempotency_key, started_at,
          completed_at, updated_at)
         VALUES ('other-course-session', ?, 'completed', 'summary', NULL,
                 ?, ?, ?)`,
      )
      .run(currentSessionRow.dayId, Date.now(), Date.now(), Date.now());
    runtime.state.connection.sqlite
      .prepare(
        `INSERT INTO mistakes
         (id, session_id, topic_id, source_type, source_id, summary,
          correction, fingerprint, occurrence_count, first_seen_at,
          last_seen_at, resolved_at)
         VALUES ('other-course-mistake', 'other-course-session', ?, 'summary',
                 'other-course-summary', 'Other summary', 'Other correction',
                 ?, 7, ?, ?, NULL)`,
      )
      .run(otherCourseTopicId, collisionFingerprint, Date.now(), Date.now());
    runtime.state.connection.sqlite
      .prepare(
        `INSERT INTO mastery_scores
         (id, topic_id, dimension, score, confidence, evidence_count,
          evidence_types_json, last_evidence_at, updated_at)
         VALUES ('legacy-summary-mastery', ?, 'understanding', 500, 100, 99,
                 '["recall"]', ?, ?)`,
      )
      .run(otherCourseTopicId, Date.now(), Date.now());
    runtime.state.connection.sqlite
      .prepare(
        `INSERT INTO flashcards
         (id, topic_id, source_mistake_id, front, back, status, due_at,
          interval_days, ease_factor, review_count, idempotency_key,
          created_at, updated_at)
         VALUES ('legacy-summary-card', ?, 'other-course-mistake',
                 'Legacy question', 'Legacy answer', 'approved', NULL,
                 1, 250, 7, 'legacy-summary-card', ?, ?)`,
      )
      .run(otherCourseTopicId, Date.now(), Date.now());
    const legacyReadModelCounts = {
      topics: count(runtime, "topics"),
      masteryEvidence: count(runtime, "mastery_evidence"),
      masteryScores: count(runtime, "mastery_scores"),
      mistakes: count(runtime, "mistakes"),
      flashcards: count(runtime, "flashcards"),
    };

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

    const [summaryResponse, concurrentSummaryResponse] = await Promise.all([
      request(
        runtime.app,
        `/api/learning/sessions/v2/${started.session.id}/units/${summaryUnit.id}/summary`,
        {
          method: "POST",
          body: JSON.stringify({ operationId: "summary-once" }),
        },
      ),
      request(
        runtime.app,
        `/api/learning/sessions/v2/${started.session.id}/units/${summaryUnit.id}/summary`,
        {
          method: "POST",
          body: JSON.stringify({ operationId: "summary-concurrent" }),
        },
      ),
    ]);
    expect(summaryResponse.status).toBe(201);
    expect(concurrentSummaryResponse.status).toBe(201);
    const body = (await summaryResponse.json()) as {
      evidence: { id: string };
      summary: {
        sessionId: string;
        occurredAt: string;
        masteryEvidence: unknown[];
        mistakeCandidates: unknown[];
        flashcardCandidates: unknown[];
        metrics: {
          quizScore: number;
          maxHintLevel: number;
          exerciseTestsPassed: boolean;
          reviewReceiptAccepted: boolean;
          reviewStatus: null;
          correctionCycleCount: number;
        };
      };
      authority: {
        scope: {
          courseId: string;
          revisionId: string;
          branchId: string;
          sessionId: string;
        };
        modelVersion: string;
        observedAt: string;
        projectionHash: string;
        sourceFactIds: string[];
      };
      session: LearningSession;
    };
    const concurrent = (await concurrentSummaryResponse.json()) as typeof body;
    expect(concurrent.evidence.id).toBe(body.evidence.id);
    expect(concurrent.summary).toEqual(body.summary);
    expect(concurrent.authority).toEqual(body.authority);
    expect(
      runtime.state.connection.sqlite
        .prepare(
          `SELECT count(*) AS count FROM versioned_unit_evidence
           WHERE session_id = ? AND unit_id = ? AND evidence_type = 'summary'`,
        )
        .get(started.session.id, summaryUnit.id),
    ).toEqual({ count: 1 });
    expect(body.summary).toMatchObject({
      sessionId: started.session.id,
      metrics: {
        quizScore: 0.5,
        maxHintLevel: 4,
        exerciseTestsPassed: true,
        reviewReceiptAccepted: false,
        reviewStatus: null,
        correctionCycleCount: 0,
      },
    });
    expect(body.summary.mistakeCandidates).toHaveLength(1);
    expect(body.summary.flashcardCandidates).toHaveLength(1);
    expect(
      runtime.state.connection.sqlite
        .prepare(
          `SELECT status FROM reviews WHERE id = 'summary-review-passed'`,
        )
        .get(),
    ).toEqual({ status: "accepted" });
    expect(body.summary.metrics.reviewStatus).toBeNull();
    expect(body.authority.scope).toMatchObject({
      sessionId: started.session.id,
    });
    expect(body.authority.modelVersion).toBe("baseline-1");
    expect(body.authority.projectionHash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(body.authority.sourceFactIds.length).toBeGreaterThan(0);
    const kernelRepository = createLearningKernelRepository(
      runtime.state.connection,
    );
    const replayedAuthority = kernelRepository.reprojectFrontier(
      body.authority.scope,
      body.authority.observedAt,
      body.authority.sourceFactIds,
    );
    expect(replayedAuthority.projectionHash).toBe(
      body.authority.projectionHash,
    );
    const summaryTopicIds = new Set(
      body.summary.masteryEvidence.map(
        (item) => z.object({ topicId: z.string() }).parse(item).topicId,
      ),
    );
    expect(summaryTopicIds).not.toContain(otherCourseTopicId);
    expect(
      runtime.state.connection.sqlite
        .prepare("SELECT count(*) AS count FROM topics WHERE title = ?")
        .get(sharedTitle),
    ).toEqual({ count: 1 });
    expect(
      runtime.state.connection.sqlite
        .prepare(
          `SELECT source_id AS sourceId, occurrence_count AS occurrenceCount
           FROM mistakes WHERE id = 'other-course-mistake'`,
        )
        .get(),
    ).toEqual({ sourceId: "other-course-summary", occurrenceCount: 7 });
    expect(
      runtime.state.connection.sqlite
        .prepare(
          `SELECT count(*) AS count FROM mistakes
           WHERE session_id = ? AND fingerprint = ?`,
        )
        .get(started.session.id, collisionFingerprint),
    ).toEqual({ count: 0 });
    expect({
      topics: count(runtime, "topics"),
      masteryEvidence: count(runtime, "mastery_evidence"),
      masteryScores: count(runtime, "mastery_scores"),
      mistakes: count(runtime, "mistakes"),
      flashcards: count(runtime, "flashcards"),
    }).toEqual(legacyReadModelCounts);
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
      payload: { type: "summary", summaryId: null },
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
    const concurrentRetryResponse = await request(
      runtime.app,
      `/api/learning/sessions/v2/${started.session.id}/units/${summaryUnit.id}/summary`,
      {
        method: "POST",
        body: JSON.stringify({ operationId: "summary-concurrent" }),
      },
    );
    expect(concurrentRetryResponse.status).toBe(201);
    const concurrentRetry =
      (await concurrentRetryResponse.json()) as typeof body;
    expect(concurrentRetry.evidence.id).toBe(body.evidence.id);
    expect(concurrentRetry.summary).toEqual(body.summary);
    expect(concurrentRetry.authority).toEqual(body.authority);
    expect({
      summaryEvidence: count(runtime, "versioned_unit_evidence"),
      masteryEvidence: count(runtime, "mastery_evidence"),
      masteryScores: count(runtime, "mastery_scores"),
      mistakes: count(runtime, "mistakes"),
      flashcards: count(runtime, "flashcards"),
    }).toEqual(counts);

    const lateActivity = kernelRepository.listActivities(
      body.authority.scope,
    )[0];
    if (!lateActivity) throw new Error("Missing Kernel activity for late fact");
    kernelRepository.accept(body.authority.scope, {
      operationId: "summary-late-backdated-operation",
      factId: "summary-late-backdated-fact",
      observedAt: body.summary.occurredAt,
      provenance: {
        kind: "learner_submission",
        sourceId: "summary-late-backdated-source",
        sourceHash: learningKernelSha256("summary-late-backdated-source"),
      },
      body: {
        type: "evidence",
        activityId: lateActivity.id,
        knowledgeNodeIds: lateActivity.knowledgeNodeIds,
        dimension: "understanding",
        evidenceType: "recall",
        outcome: "unverified",
        hintLevel: 0,
        basisFactIds: [],
      },
    });
    const envelopedAfterLaterFact = await request(
      runtime.app,
      `/api/learning/sessions/v2/${started.session.id}/units/${summaryUnit.id}/summary`,
      {
        method: "POST",
        body: JSON.stringify({ operationId: "summary-after-later-fact" }),
      },
    );
    expect(envelopedAfterLaterFact.status).toBe(201);
    const enveloped = (await envelopedAfterLaterFact.json()) as typeof body;
    expect(enveloped.summary).toEqual(body.summary);
    expect(enveloped.authority).toEqual(body.authority);

    const storedSummary = runtime.state.connection.sqlite
      .prepare(
        `SELECT payload_json AS payloadJson
         FROM versioned_unit_evidence WHERE id = ?`,
      )
      .get(body.evidence.id) as { payloadJson: string };
    const legacyPayload = JSON.parse(storedSummary.payloadJson) as {
      summary: unknown;
    };
    const appendOnlyTrigger = runtime.state.connection.sqlite
      .prepare(
        `SELECT sql FROM sqlite_schema
         WHERE type = 'trigger'
           AND name = 'versioned_unit_evidence_append_only_update_guard'`,
      )
      .get() as { sql: string };
    runtime.state.connection.sqlite.exec(
      "DROP TRIGGER versioned_unit_evidence_append_only_update_guard",
    );
    runtime.state.connection.sqlite
      .prepare(
        `UPDATE versioned_unit_evidence SET payload_json = ? WHERE id = ?`,
      )
      .run(
        JSON.stringify({ summary: legacyPayload.summary }),
        body.evidence.id,
      );
    runtime.state.connection.sqlite.exec(appendOnlyTrigger.sql);

    await runtime.close();
    runtimes.splice(runtimes.indexOf(runtime), 1);
    const restarted = createRuntime(runtime.databasePath);
    const restoredResponse = await request(
      restarted.app,
      `/api/learning/sessions/v2/${started.session.id}/units/${summaryUnit.id}/summary`,
      {
        method: "POST",
        body: JSON.stringify({ operationId: "summary-after-restart" }),
      },
    );
    expect(restoredResponse.status).toBe(201);
    const restored = (await restoredResponse.json()) as typeof body;
    expect(restored.evidence.id).toBe(body.evidence.id);
    expect(restored.summary).toEqual(body.summary);
    expect(restored.authority).toEqual(body.authority);
    expect(
      JSON.parse(
        (
          restarted.state.connection.sqlite
            .prepare(
              `SELECT payload_json AS payloadJson
               FROM versioned_unit_evidence WHERE id = ?`,
            )
            .get(body.evidence.id) as { payloadJson: string }
        ).payloadJson,
      ),
    ).not.toHaveProperty("authority");
    expect(JSON.stringify(restored)).not.toContain("correctOptionIds");
    expect(JSON.stringify(restored)).not.toContain("referenceAnswer");

    const knowledgeResponse = await request(
      restarted.app,
      "/api/learning/skills",
    );
    const mistakesResponse = await request(
      restarted.app,
      "/api/learning/mistakes",
    );
    const cardsResponse = await request(restarted.app, "/api/learning/reviews");
    const [knowledge, mistakes, cards] = await Promise.all([
      knowledgeResponse.json(),
      mistakesResponse.json(),
      cardsResponse.json(),
    ]);
    const activeSkills = z
      .array(z.object({ id: z.string(), evidenceCount: z.number() }))
      .parse((knowledge as { topics: unknown[] }).topics);
    const expectedKnowledgeNodeIds = [
      ...new Set(
        createLearningKernelRepository(restarted.state.connection)
          .listActivities(body.authority.scope)
          .flatMap((activity) => activity.knowledgeNodeIds),
      ),
    ].sort();
    expect(activeSkills).toEqual(
      expectedKnowledgeNodeIds.map((id) => ({ id, evidenceCount: 0 })),
    );
    expect(activeSkills.map((skill) => skill.id)).not.toContain(
      otherCourseTopicId,
    );
    expect((mistakes as { mistakes: unknown[] }).mistakes).toEqual([]);
    expect((cards as { reviews: unknown[] }).reviews).toEqual([]);

    expect((await request(restarted.app, "/api/knowledge")).status).toBe(308);
    expect((await request(restarted.app, "/api/mistakes")).status).toBe(308);
    expect((await request(restarted.app, "/api/flashcards")).status).toBe(308);
    expect(
      (
        await request(restarted.app, "/api/flashcards/legacy-row", {
          method: "PATCH",
          body: JSON.stringify({ status: "approved" }),
        })
      ).status,
    ).toBe(410);

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
    expect(
      completeResponse.status,
      JSON.stringify(await completeResponse.clone().json()),
    ).toBe(200);
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
