import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { SessionSnapshotSchema } from "@dlh/shared";
import { afterEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";

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
    : mkdtempSync(path.join(tmpdir(), "dlh-learning-v2-"));
  if (!databasePath) roots.push(root);
  const created = createApp({
    projectRoot: path.resolve("../.."),
    databasePath: databasePath ?? path.join(root, "test.sqlite"),
  });
  runtimes.push(created);
  return {
    ...created,
    databasePath: databasePath ?? path.join(root, "test.sqlite"),
  };
}

function request(
  app: ReturnType<typeof createApp>["app"],
  pathname: string,
  init?: RequestInit,
) {
  return app.request(pathname, {
    ...init,
    headers: {
      "X-DLH-Client": "web",
      "Content-Type": "application/json",
      Origin: "http://127.0.0.1:3000",
      ...init?.headers,
    },
  });
}

interface LearnerUnit {
  id: string;
  stableId: string;
  type: string;
  status: string;
  checklist: Array<{ id: string }>;
  questions: Array<{
    id: string;
    prompt: string;
    options: Array<{ id: string; label: string }>;
  }>;
}

interface LearnerSession {
  id: string;
  status: string;
  currentStep: string;
  snapshot: { day: { id: string }; units: LearnerUnit[] };
  unitProgress: Array<{
    unitId: string;
    status: string;
    payload: Record<string, unknown> & { type: string };
  }>;
}

function collectKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, keys);
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      keys.add(key);
      collectKeys(item, keys);
    }
  }
  return keys;
}

function unitProgressPayload(session: LearnerSession, unitId: string) {
  const progress = session.unitProgress.find((item) => item.unitId === unitId);
  if (!progress) throw new Error(`Missing progress for ${unitId}`);
  return progress.payload;
}

function privateSnapshot(
  connection: ReturnType<typeof createApp>["state"]["connection"],
  sessionId: string,
) {
  const row = connection.sqlite
    .prepare("SELECT snapshot_json FROM session_snapshots WHERE session_id = ?")
    .get(sessionId) as { snapshot_json: string };
  return SessionSnapshotSchema.parse(JSON.parse(row.snapshot_json));
}

function completionPayload(unit: LearnerUnit): Record<string, unknown> {
  switch (unit.type) {
    case "briefing":
      return {
        type: unit.type,
        acknowledged: true,
        checkedItemIds: unit.checklist.map((item) => item.id),
      };
    case "study":
      return {
        type: unit.type,
        checkedItemIds: unit.checklist.map((item) => item.id),
        notes: "Проверено самостоятельно",
      };
    case "recall":
      return {
        type: unit.type,
        draft: "Самостоятельный first attempt до подсказки",
        firstAttemptId: `${unit.stableId}-attempt-1`,
      };
    case "teacher-dialogue":
      return {
        type: unit.type,
        conversationId: `${unit.stableId}-conversation`,
        turnCount: 1,
        revisionAttemptIds: [`${unit.stableId}-revision-1`],
      };
    case "quiz":
      return {
        type: unit.type,
        attemptedQuestionIds: unit.questions.map((question) => question.id),
        correctQuestionIds: unit.questions.map((question) => question.id),
        score: 1,
      };
    case "code-reading":
      return {
        type: unit.type,
        prediction: "Предсказание сохранено до запуска",
        explanation: "Механизм объяснён",
        verbalFix: "Исправление сформулировано",
      };
    case "exercise":
      return {
        type: unit.type,
        attemptId: `${unit.stableId}-attempt`,
        latestTestRunId: `${unit.stableId}-tests`,
        latestReviewId: null,
      };
    case "review":
      return {
        type: unit.type,
        reviewId: `${unit.stableId}-review`,
        reviewStatus: "accepted",
        reviewedDiffHash: "sha256-review-diff",
      };
    case "interview":
      return {
        type: unit.type,
        interviewSessionId: `${unit.stableId}-session`,
        reportId: `${unit.stableId}-report`,
      };
    case "summary":
      return { type: unit.type, summaryId: `${unit.stableId}-summary` };
    case "checkpoint":
      return { type: unit.type, acknowledged: true };
    case "spaced-review":
      return { type: unit.type, reviewedTopicIds: ["topic-reviewed"] };
    default:
      throw new Error(`Missing test evidence for ${unit.type}`);
  }
}

describe("versioned learning API", () => {
  it("returns a learner-safe path and no current session initially", async () => {
    const { app } = createRuntime();
    const pathResponse = await request(app, "/api/learning/path");
    expect(pathResponse.status).toBe(200);
    const body = (await pathResponse.json()) as Record<string, unknown>;
    const keys = collectKeys(body);
    expect(keys).not.toContain("referenceAnswer");
    expect(keys).not.toContain("evaluationPoints");
    expect(keys).not.toContain("correctOptionIds");
    expect(keys).not.toContain("correctQuestionIds");
    expect(keys).not.toContain("commonMistakes");
    expect(keys).not.toContain("misconceptions");
    expect(keys).not.toContain("protectedEvaluation");

    const current = await request(app, "/api/learning/sessions/current");
    expect(current.status).toBe(200);
    expect(await current.json()).toEqual({ session: null });
  });

  it("rejects a locked day and resumes the active day idempotently", async () => {
    const { app } = createRuntime();
    const pathBody = (await (
      await request(app, "/api/learning/path")
    ).json()) as {
      curriculum: { weeks: Array<{ days: Array<{ id: string }> }> };
    };
    const [dayOne, dayTwo] = pathBody.curriculum.weeks[0]!.days;

    const locked = await request(app, "/api/learning/sessions/v2", {
      method: "POST",
      body: JSON.stringify({ dayId: dayTwo!.id, operationId: "locked-day" }),
    });
    expect(locked.status).toBe(400);
    expect(await locked.json()).toEqual({
      error: "Learning day is locked until preceding days are completed",
    });

    const first = await request(app, "/api/learning/sessions/v2", {
      method: "POST",
      body: JSON.stringify({ dayId: dayOne!.id, operationId: "start-day-1" }),
    });
    expect(first.status).toBe(201);
    const firstSession = ((await first.json()) as { session: LearnerSession })
      .session;

    const replay = await request(app, "/api/learning/sessions/v2", {
      method: "POST",
      body: JSON.stringify({ dayId: dayOne!.id, operationId: "start-day-1" }),
    });
    expect(replay.status).toBe(201);
    const replaySession = ((await replay.json()) as { session: LearnerSession })
      .session;
    expect(replaySession.id).toBe(firstSession.id);

    const current = (
      (await (await request(app, "/api/learning/sessions/current")).json()) as {
        session: LearnerSession;
      }
    ).session;
    expect(current.id).toBe(firstSession.id);
    expect(current.status).toBe("active");
  });

  it("enforces evidence, unlocks units, persists reloads, and completes safely", async () => {
    const firstRuntime = createRuntime();
    const pathBody = (await (
      await request(firstRuntime.app, "/api/learning/path")
    ).json()) as {
      curriculum: { weeks: Array<{ days: Array<{ id: string }> }> };
    };
    const dayOne = pathBody.curriculum.weeks[0]!.days[0]!;
    const startedResponse = await request(
      firstRuntime.app,
      "/api/learning/sessions/v2",
      {
        method: "POST",
        body: JSON.stringify({ dayId: dayOne.id, operationId: "full-day-1" }),
      },
    );
    let session = (
      (await startedResponse.json()) as {
        session: LearnerSession;
      }
    ).session;
    expect(session.unitProgress[0]?.status).toBe("ready");
    expect(session.unitProgress[1]?.status).toBe("locked");

    const lockedUnit = session.snapshot.units[1]!;
    const lockedStart = await request(
      firstRuntime.app,
      `/api/learning/sessions/v2/${session.id}/units/${lockedUnit.id}`,
      { method: "PATCH", body: JSON.stringify({ status: "in_progress" }) },
    );
    expect(lockedStart.status).toBe(400);
    expect(await lockedStart.json()).toEqual({
      error: "Unit transition is not allowed",
    });

    const firstUnit = session.snapshot.units[0]!;
    const startedUnit = await request(
      firstRuntime.app,
      `/api/learning/sessions/v2/${session.id}/units/${firstUnit.id}`,
      { method: "PATCH", body: JSON.stringify({ status: "in_progress" }) },
    );
    expect(startedUnit.status).toBe(200);

    const missingEvidence = await request(
      firstRuntime.app,
      `/api/learning/sessions/v2/${session.id}/units/${firstUnit.id}`,
      { method: "PATCH", body: JSON.stringify({ status: "completed" }) },
    );
    expect(missingEvidence.status).toBe(400);
    expect(await missingEvidence.json()).toEqual({
      error: "Unit completion criteria are not satisfied",
    });

    const completedFirst = await request(
      firstRuntime.app,
      `/api/learning/sessions/v2/${session.id}/units/${firstUnit.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          status: "completed",
          payload: completionPayload(firstUnit),
        }),
      },
    );
    session = ((await completedFirst.json()) as { session: LearnerSession })
      .session;
    expect(session.unitProgress[0]?.status).toBe("completed");
    expect(session.unitProgress[1]?.status).toBe("ready");
    expect(session.currentStep).toBe(session.snapshot.units[1]?.stableId);

    const persisted = await firstRuntime.state.repository.getVersionedSession(
      session.id,
    );
    expect(persisted.unitProgress[0]?.status).toBe("completed");
    expect(persisted.unitProgress[1]?.status).toBe("ready");

    await firstRuntime.close();
    const closedRuntimeIndex = runtimes.findIndex(
      (candidate) => candidate.app === firstRuntime.app,
    );
    if (closedRuntimeIndex >= 0) runtimes.splice(closedRuntimeIndex, 1);
    const restartedRuntime = createRuntime(firstRuntime.databasePath);
    const reloaded = (
      (await (
        await request(
          restartedRuntime.app,
          `/api/learning/sessions/v2/${session.id}`,
        )
      ).json()) as { session: LearnerSession }
    ).session;
    expect(reloaded.unitProgress[0]?.status).toBe("completed");
    expect(reloaded.unitProgress[1]?.status).toBe("ready");
    session = reloaded;

    let exerciseArtifacts: { attemptId: string; testRunId: string } | undefined;
    for (const unit of session.snapshot.units.slice(1)) {
      const start = await request(
        restartedRuntime.app,
        `/api/learning/sessions/v2/${session.id}/units/${unit.id}`,
        { method: "PATCH", body: JSON.stringify({ status: "in_progress" }) },
      );
      expect(start.status, `start ${unit.stableId}`).toBe(200);
      session = ((await start.json()) as { session: LearnerSession }).session;
      let payload = completionPayload(unit);

      if (
        ["recall", "quiz", "code-reading", "exercise", "review"].includes(
          unit.type,
        )
      ) {
        const forged = await request(
          restartedRuntime.app,
          `/api/learning/sessions/v2/${session.id}/units/${unit.id}`,
          {
            method: "PATCH",
            body: JSON.stringify({ status: "completed", payload }),
          },
        );
        expect(forged.status, `forged ${unit.stableId}`).toBe(400);
        expect(await forged.json()).toEqual({
          error: "Unit completion criteria are not satisfied",
        });
      }

      if (unit.type === "recall") {
        const unexpectedField = await request(
          restartedRuntime.app,
          `/api/learning/sessions/v2/${session.id}/units/${unit.id}/recall-attempts`,
          {
            method: "POST",
            body: JSON.stringify({
              operationId: "day1-recall-invalid",
              answer: "Ответ",
              referenceAnswer: "browser must not supply this",
            }),
          },
        );
        expect(unexpectedField.status).toBe(400);
        const firstAttempt = await request(
          restartedRuntime.app,
          `/api/learning/sessions/v2/${session.id}/units/${unit.id}/recall-attempts`,
          {
            method: "POST",
            body: JSON.stringify({
              operationId: "day1-recall-first",
              answer: "Первый самостоятельный ответ до любой подсказки",
            }),
          },
        );
        expect(firstAttempt.status).toBe(201);
        const firstBody = (await firstAttempt.json()) as {
          evidence: { id: string; isFirstAttempt: boolean };
          session: LearnerSession;
        };
        expect(firstBody.evidence.isFirstAttempt).toBe(true);

        const revision = await request(
          restartedRuntime.app,
          `/api/learning/sessions/v2/${session.id}/units/${unit.id}/recall-attempts`,
          {
            method: "POST",
            body: JSON.stringify({
              operationId: "day1-recall-revision",
              answer: "Уточнённый ответ после самостоятельной проверки",
            }),
          },
        );
        const revisionBody = (await revision.json()) as {
          evidence: { id: string; isFirstAttempt: boolean };
          session: LearnerSession;
        };
        expect(revisionBody.evidence.isFirstAttempt).toBe(false);
        session = revisionBody.session;
        payload = unitProgressPayload(session, unit.id);
        expect(payload).toMatchObject({
          firstAttemptId: firstBody.evidence.id,
          draft: "Первый самостоятельный ответ до любой подсказки",
        });
      }

      if (unit.type === "quiz") {
        const privateUnit = privateSnapshot(
          restartedRuntime.state.connection,
          session.id,
        ).units.find((candidate) => candidate.id === unit.id)!;
        const answers = privateUnit.questions.map((question) => ({
          questionId: question.id,
          selectedOptionId: question.correctOptionIds[0]!,
        }));
        const quizAttempt = await request(
          restartedRuntime.app,
          `/api/learning/sessions/v2/${session.id}/units/${unit.id}/quiz-attempts`,
          {
            method: "POST",
            body: JSON.stringify({ operationId: "day1-quiz", answers }),
          },
        );
        expect(quizAttempt.status).toBe(201);
        const quizBody = (await quizAttempt.json()) as {
          attempt: {
            operationId: string;
            score: number;
            results: Array<{ questionId: string; correct: boolean }>;
          };
          session: LearnerSession;
        };
        expect(quizBody.attempt).toMatchObject({
          operationId: "day1-quiz",
          score: 1,
        });
        expect(quizBody.attempt.results.every((result) => result.correct)).toBe(
          true,
        );
        const quizKeys = collectKeys(quizBody);
        expect(quizKeys).not.toContain("correctOptionIds");
        expect(quizKeys).not.toContain("correctQuestionIds");
        expect(quizKeys).not.toContain("referenceAnswer");
        expect(quizKeys).not.toContain("evaluationPoints");

        const retriedQuiz = await request(
          restartedRuntime.app,
          `/api/learning/sessions/v2/${session.id}/units/${unit.id}/quiz-attempts`,
          {
            method: "POST",
            body: JSON.stringify({ operationId: "day1-quiz", answers }),
          },
        );
        const retriedBody = (await retriedQuiz.json()) as typeof quizBody;
        expect(retriedBody.attempt).toEqual(quizBody.attempt);
        const evidenceCount = restartedRuntime.state.connection.sqlite
          .prepare(
            `SELECT COUNT(*) AS count FROM versioned_unit_evidence
             WHERE session_id = ? AND unit_id = ? AND evidence_type = 'quiz-answer'`,
          )
          .get(session.id, unit.id) as { count: number };
        expect(evidenceCount.count).toBe(answers.length);
        session = retriedBody.session;
        payload = unitProgressPayload(session, unit.id);
      }

      if (unit.type === "code-reading") {
        const codeAttempt = await request(
          restartedRuntime.app,
          `/api/learning/sessions/v2/${session.id}/units/${unit.id}/code-reading-attempts`,
          {
            method: "POST",
            body: JSON.stringify({
              operationId: "day1-code-reading",
              prediction: "original увидит изменённое вложенное имя",
              explanation: "spread скопировал только внешний объект",
              verbalFix: "создать новый вложенный profile",
            }),
          },
        );
        expect(codeAttempt.status).toBe(201);
        const codeBody = (await codeAttempt.json()) as {
          evidence: { id: string };
          session: LearnerSession;
        };
        expect(codeBody.evidence.id).toBeTruthy();
        session = codeBody.session;
        payload = unitProgressPayload(session, unit.id);
      }

      if (unit.type === "exercise") {
        const exercise = restartedRuntime.state.connection.sqlite
          .prepare("SELECT id FROM exercises ORDER BY id LIMIT 1")
          .get() as { id: string };
        exerciseArtifacts = {
          attemptId: "day1-versioned-exercise-attempt",
          testRunId: "day1-versioned-latest-test-run",
        };
        const now = Date.now();
        restartedRuntime.state.connection.sqlite
          .prepare(
            `INSERT INTO exercise_attempts
             (id, session_id, exercise_id, status, workspace_path, baseline_path,
              baseline_hash, started_at, completed_at, updated_at)
             VALUES (?, ?, ?, 'active', 'test-workspace', 'test-baseline',
                     'baseline-hash', ?, NULL, ?)`,
          )
          .run(exerciseArtifacts.attemptId, session.id, exercise.id, now, now);
        restartedRuntime.state.connection.sqlite
          .prepare(
            `INSERT INTO test_runs
             (id, exercise_attempt_id, operation_id, status, exit_code, stdout,
              stderr, duration_ms, started_at, completed_at)
             VALUES (?, ?, 'day1-test-operation', 'passed', 0, '', '', 1, ?, ?)`,
          )
          .run(
            "day1-versioned-old-test-run",
            exerciseArtifacts.attemptId,
            now,
            now,
          );
        restartedRuntime.state.connection.sqlite
          .prepare(
            `INSERT INTO test_runs
             (id, exercise_attempt_id, operation_id, status, exit_code, stdout,
              stderr, duration_ms, started_at, completed_at)
             VALUES (?, ?, 'day1-latest-test-operation', 'failed', 1, '', '',
                     1, ?, ?)`,
          )
          .run(
            exerciseArtifacts.testRunId,
            exerciseArtifacts.attemptId,
            now + 1,
            now + 1,
          );
        const staleTestEvidence = await request(
          restartedRuntime.app,
          `/api/learning/sessions/v2/${session.id}/units/${unit.id}`,
          {
            method: "PATCH",
            body: JSON.stringify({
              status: "completed",
              payload: {
                type: "exercise",
                attemptId: exerciseArtifacts.attemptId,
                latestTestRunId: "day1-versioned-old-test-run",
                latestReviewId: null,
              },
            }),
          },
        );
        expect(staleTestEvidence.status).toBe(400);
        restartedRuntime.state.connection.sqlite
          .prepare(
            "UPDATE test_runs SET status = 'passed', exit_code = 0 WHERE id = ?",
          )
          .run(exerciseArtifacts.testRunId);
        payload = {
          type: "exercise",
          attemptId: exerciseArtifacts.attemptId,
          latestTestRunId: exerciseArtifacts.testRunId,
          latestReviewId: null,
        };
      }

      if (unit.type === "review") {
        if (!exerciseArtifacts) throw new Error("Exercise evidence is missing");
        const oldReviewId = "day1-versioned-old-review";
        const reviewId = "day1-versioned-latest-review";
        const now = Date.now();
        restartedRuntime.state.connection.sqlite
          .prepare(
            `INSERT INTO reviews
             (id, session_id, exercise_attempt_id, provider_id, model_id, status,
              result_json, raw_response, created_at, completed_at)
             VALUES (?, ?, ?, 'mock', 'mock-reviewer', 'passed',
                     '{"status":"passed","findings":[]}', NULL, ?, ?)`,
          )
          .run(oldReviewId, session.id, exerciseArtifacts.attemptId, now, now);
        restartedRuntime.state.connection.sqlite
          .prepare(
            `INSERT INTO reviews
             (id, session_id, exercise_attempt_id, provider_id, model_id, status,
              result_json, raw_response, created_at, completed_at)
             VALUES (?, ?, ?, 'mock', 'mock-reviewer', 'changes_requested',
                     '{"status":"changes_requested","findings":[]}', NULL, ?, ?)`,
          )
          .run(
            reviewId,
            session.id,
            exerciseArtifacts.attemptId,
            now + 1,
            now + 1,
          );
        const staleReviewEvidence = await request(
          restartedRuntime.app,
          `/api/learning/sessions/v2/${session.id}/units/${unit.id}`,
          {
            method: "PATCH",
            body: JSON.stringify({
              status: "completed",
              payload: {
                type: "review",
                reviewId: oldReviewId,
                reviewStatus: "accepted",
                reviewedDiffHash: "sha256-stale-review-diff",
              },
            }),
          },
        );
        expect(staleReviewEvidence.status).toBe(400);
        restartedRuntime.state.connection.sqlite
          .prepare(
            `UPDATE reviews SET status = 'passed',
             result_json = '{"status":"passed","findings":[]}' WHERE id = ?`,
          )
          .run(reviewId);
        payload = {
          type: "review",
          reviewId,
          reviewStatus: "accepted",
          reviewedDiffHash: "sha256-review-diff",
        };
      }

      if (unit.type === "summary") {
        const fakeSummary = await request(
          restartedRuntime.app,
          `/api/learning/sessions/v2/${session.id}/units/${unit.id}`,
          {
            method: "PATCH",
            body: JSON.stringify({
              status: "completed",
              payload: { type: "summary", summaryId: "fake-summary-id" },
            }),
          },
        );
        expect(fakeSummary.status).toBe(400);
        const summaryResponse = await request(
          restartedRuntime.app,
          `/api/learning/sessions/v2/${session.id}/units/${unit.id}/summary`,
          {
            method: "POST",
            body: JSON.stringify({ operationId: "day1-summary" }),
          },
        );
        expect(summaryResponse.status).toBe(201);
        const summaryBody = (await summaryResponse.json()) as {
          evidence: { id: string };
          session: LearnerSession;
        };
        session = summaryBody.session;
        payload = {
          type: "summary",
          summaryId: summaryBody.evidence.id,
        };
      }

      const complete = await request(
        restartedRuntime.app,
        `/api/learning/sessions/v2/${session.id}/units/${unit.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            status: "completed",
            payload,
          }),
        },
      );
      expect(complete.status, `complete ${unit.stableId}`).toBe(200);
      session = ((await complete.json()) as { session: LearnerSession })
        .session;
    }

    expect(session.status).toBe("completed");
    expect(session.currentStep).toBe("complete");
    const current = await request(
      restartedRuntime.app,
      "/api/learning/sessions/current",
    );
    expect(await current.json()).toEqual({ session: null });
    const learnerState = restartedRuntime.state.connection.sqlite
      .prepare(
        "SELECT current_learning_session_id FROM learner_state WHERE id = 'default'",
      )
      .get() as { current_learning_session_id: string | null };
    expect(learnerState.current_learning_session_id).toBeNull();

    const finalPath = (await (
      await request(restartedRuntime.app, "/api/learning/path")
    ).json()) as {
      curriculum: {
        weeks: Array<{ days: Array<{ status: string }> }>;
      };
    };
    expect(finalPath.curriculum.weeks[0]!.days[0]!.status).toBe("completed");
    expect(finalPath.curriculum.weeks[0]!.days[1]!.status).toBe("available");
  });
});
