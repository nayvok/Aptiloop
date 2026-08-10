import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  createCurriculumAuthoringRepository,
  hashCanonicalJson,
  createLearningKernelRepository,
  type DatabaseConnection,
} from "@dlh/database";
import { learningKernelSha256 } from "@dlh/learning-core";
import { SessionSnapshotSchema } from "@dlh/shared";
import type { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { createApp } from "../src/app.js";

const runtimes: Array<ReturnType<typeof createApp>> = [];
const roots: string[] = [];
const ClonedRevisionResponseSchema = z.object({
  version: z.object({ id: z.string() }),
});
const RevisionGraphIdentitySchema = z.object({
  curriculum: z.object({
    weeks: z.array(
      z.object({
        days: z.array(
          z.object({ units: z.array(z.object({ id: z.string() })) }),
        ),
      }),
    ),
  }),
});
const ValidationResponseSchema = z.object({
  report: z.object({
    validationHash: z.string(),
    draftHash: z.string(),
  }),
});
const ChangeReviewResponseSchema = z.object({
  review: z.object({ changeReviewHash: z.string() }),
});

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
    databaseMode: "disposable",
  });
  runtimes.push(created);
  return {
    ...created,
    databasePath: databasePath ?? path.join(root, "test.sqlite"),
  };
}

function request(app: Hono, pathname: string, init?: RequestInit) {
  return app.request(`http://127.0.0.1:8787${pathname}`, {
    ...init,
    headers: {
      Host: "127.0.0.1:8787",
      "X-DLH-Client": "web",
      "Content-Type": "application/json",
      Origin: "http://127.0.0.1:3000",
      ...init?.headers,
    },
  });
}
async function cloneAndPublishActiveRevision(
  app: Hono,
  parentRevisionId: string,
  operationPrefix: string,
  mutateFirstUnit = false,
): Promise<string> {
  const cloned = await request(
    app,
    `/api/curriculum-editor/versions/${parentRevisionId}/clone`,
    {
      method: "POST",
      body: JSON.stringify({
        operationId: `${operationPrefix}-clone`,
        title: `${operationPrefix} revision`,
      }),
    },
  );
  if (cloned.status !== 201) {
    throw new Error(`Revision clone failed: ${cloned.status}`);
  }
  const clone = ClonedRevisionResponseSchema.parse(await cloned.json());
  if (mutateFirstUnit) {
    const graph = RevisionGraphIdentitySchema.parse(
      await (
        await request(
          app,
          `/api/curriculum-editor/versions/${clone.version.id}`,
        )
      ).json(),
    );
    const firstUnitId = graph.curriculum.weeks[0]?.days[0]?.units[0]?.id;
    if (!firstUnitId) throw new Error("Cloned revision has no first unit");
    const changed = await request(
      app,
      `/api/curriculum-editor/versions/${clone.version.id}/units/${firstUnitId}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          operationId: `${operationPrefix}-change-unit`,
          title: `${operationPrefix} changed activity`,
        }),
      },
    );
    if (changed.status !== 200) {
      throw new Error(`Revision activity change failed: ${changed.status}`);
    }
  }
  const validation = ValidationResponseSchema.parse(
    await (
      await request(
        app,
        `/api/curriculum-editor/versions/${clone.version.id}/validation`,
      )
    ).json(),
  );
  const review = ChangeReviewResponseSchema.parse(
    await (
      await request(
        app,
        `/api/curriculum-editor/versions/${clone.version.id}/change-review`,
      )
    ).json(),
  );
  const published = await request(
    app,
    `/api/curriculum-editor/versions/${clone.version.id}/publish`,
    {
      method: "POST",
      body: JSON.stringify({
        operationId: `${operationPrefix}-publish`,
        validationHash: validation.report.validationHash,
        changeReviewHash: review.review.changeReviewHash,
        previewHash: validation.report.draftHash,
      }),
    },
  );
  if (published.status !== 200) {
    throw new Error(`Revision publish failed: ${published.status}`);
  }
  return clone.version.id;
}

type QuarantinedSourceTable =
  "curriculum_versions" | "curriculum_days_v2" | "session_snapshots";

function sourceRowHash(
  connection: DatabaseConnection,
  table: QuarantinedSourceTable,
  id: string,
): string {
  const row = connection.sqlite
    .prepare(`SELECT * FROM ${table} WHERE id = ?`)
    .get(id) as Record<string, unknown> | undefined;
  if (!row) throw new Error(`Missing ${table} source row: ${id}`);
  return hashCanonicalJson(row);
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
  courseContext: {
    courseId: string;
    revisionId: string;
    lessonId: string;
    sessionSnapshotId: string;
    snapshotHash: string;
  };
  snapshot: {
    contentHash: string;
    curriculumId: string;
    curriculumVersionId: string;
    day: { id: string };
    units: LearnerUnit[];
  };
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
        answers: unit.questions.map((question, index) => ({
          questionId: question.id,
          draft: `Самостоятельный ответ ${index + 1} до подсказки`,
          firstAttemptId: `${unit.stableId}-attempt-${index + 1}`,
        })),
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

async function completePrecedingDaysForDaySeven(
  state: ReturnType<typeof createApp>["state"],
  dayIds: readonly string[],
) {
  const now = Date.now();
  for (const [index, dayId] of dayIds.entries()) {
    const detail = await state.repository.startOrResumeVersionedSession({
      dayId,
      idempotencyKey: `day-seven-prerequisite-operation-${index + 1}`,
    });
    state.connection.sqlite
      .prepare(
        `UPDATE learning_sessions
         SET status = 'completed', current_step = 'complete', completed_at = ?,
             updated_at = ?
         WHERE id = ?`,
      )
      .run(now, now, detail.session.id);
  }
}

function insertCompletedInterviewEvidence(
  state: ReturnType<typeof createApp>["state"],
  sessionId: string,
  interviewId: string,
  answerCount: number,
) {
  const conversationId = `${interviewId}-conversation`;
  state.connection.sqlite
    .prepare(
      `INSERT INTO interview_sessions
       (id, learning_session_id, status, result_json, started_at, completed_at)
       VALUES (?, ?, 'completed', ?, 1000, 2000)`,
    )
    .run(
      interviewId,
      sessionId,
      JSON.stringify({
        schemaVersion: 1,
        setup: {
          conversationId,
          topics: [],
          difficulty: "interview-ready",
          questionCount: 3,
          operationId: `${interviewId}-operation`,
        },
        report: { status: "completed" },
      }),
    );
  state.connection.sqlite
    .prepare(
      `INSERT INTO agent_conversations
       (id, learning_session_id, role, provider_id, model_id,
        provider_session_id, status, created_at, updated_at)
       VALUES (?, ?, 'interviewer', 'mock', 'mock-deterministic', NULL,
               'completed', 1000, 1000)`,
    )
    .run(conversationId, sessionId);
  const insertMessage = state.connection.sqlite.prepare(
    `INSERT INTO agent_messages
     (id, conversation_id, role, content, tool_events_json, raw_event_json,
      status, sequence, idempotency_key, created_at)
     VALUES (?, ?, 'user', ?, '[]', NULL, 'completed', ?, NULL, ?)`,
  );
  for (let index = 1; index <= answerCount; index += 1) {
    insertMessage.run(
      `${interviewId}-answer-${index}`,
      conversationId,
      `Ответ ${index}`,
      index,
      1000 + index,
    );
  }
}

async function startDaySevenAtInterview(
  runtime: ReturnType<typeof createRuntime>,
) {
  const session = await startDaySeven(runtime);
  const interviewUnit = session.snapshot.units.find(
    (unit) => unit.type === "interview",
  );
  if (!interviewUnit) throw new Error("Day 7 interview unit is missing");
  runtime.state.connection.sqlite
    .prepare(
      `UPDATE unit_progress
       SET status = 'completed', completed_at = ?, updated_at = ?
       WHERE session_id = ? AND unit_id != ?`,
    )
    .run(Date.now(), Date.now(), session.id, interviewUnit.id);
  runtime.state.connection.sqlite
    .prepare(
      `UPDATE unit_progress
       SET status = 'in_progress', started_at = ?, updated_at = ?
       WHERE session_id = ? AND unit_id = ?`,
    )
    .run(Date.now(), Date.now(), session.id, interviewUnit.id);
  const kernel = createLearningKernelRepository(runtime.state.connection);
  const scope = kernel.resolveSessionScope(session.id);
  const activities = kernel.listActivities(scope);
  const baseTime = Date.now() - activities.length * 4;
  let sequence = 0;
  for (const [index, activity] of activities.entries()) {
    const sourceId = `interview-fixture-${session.id}-${activity.id}`;
    const sourceHash = learningKernelSha256({ sourceId });
    kernel.accept(scope, {
      operationId: `${sourceId}-start`,
      factId: `${sourceId}-start-fact`,
      observedAt: new Date(baseTime + sequence++).toISOString(),
      provenance: {
        kind: "learner_submission",
        sourceId,
        sourceHash,
      },
      body: { type: "progress", activityId: activity.id, transition: "start" },
    });
    if (session.snapshot.units[index]?.id === interviewUnit.id) break;
    kernel.accept(scope, {
      operationId: `${sourceId}-complete`,
      factId: `${sourceId}-complete-fact`,
      observedAt: new Date(baseTime + sequence++).toISOString(),
      provenance: {
        kind: "deterministic_evaluator",
        sourceId,
        sourceHash,
        evaluatorVersion: "interview-fixture-v1",
      },
      body: {
        type: "progress",
        activityId: activity.id,
        transition: "complete",
      },
    });
  }
  return { session, interviewUnit };
}

async function startDaySeven(runtime: ReturnType<typeof createRuntime>) {
  const path = (await (
    await request(runtime.app, "/api/learning/path")
  ).json()) as {
    curriculum: {
      weeks: Array<{ days: Array<{ id: string; stableId: string }> }>;
    };
  };
  const days = path.curriculum.weeks[0]!.days;
  const daySeven = days.find(
    (day) => day.stableId === "w1d7-integration-checkpoint",
  );
  if (!daySeven) throw new Error("Day 7 fixture is missing");
  await completePrecedingDaysForDaySeven(
    runtime.state,
    days.filter((day) => day.id !== daySeven.id).map((day) => day.id),
  );
  const started = await request(runtime.app, "/api/learning/sessions/v2", {
    method: "POST",
    body: JSON.stringify({
      dayId: daySeven.id,
      operationId: "day7-interview-test",
    }),
  });
  expect(started.status).toBe(201);
  return ((await started.json()) as { session: LearnerSession }).session;
}

describe("versioned learning API", () => {
  it("exposes deterministic kernel state and idempotent learner transitions", async () => {
    const runtime = createRuntime();
    const learningPath = (await (
      await request(runtime.app, "/api/learning/path")
    ).json()) as {
      curriculum: { weeks: Array<{ days: Array<{ id: string }> }> };
    };
    const day = learningPath.curriculum.weeks[0]?.days[0];
    if (!day) throw new Error("Seeded learning day is unavailable");
    const started = await request(runtime.app, "/api/learning/sessions/v2", {
      method: "POST",
      body: JSON.stringify({
        dayId: day.id,
        operationId: "direct-kernel-session",
      }),
    });
    expect(started.status).toBe(201);
    const session = ((await started.json()) as { session: LearnerSession })
      .session;
    const initial = await request(
      runtime.app,
      `/api/learning/sessions/v2/${session.id}/kernel`,
    );
    expect(initial.status).toBe(200);
    const initialBody = (await initial.json()) as {
      projection: {
        projectionHash: string;
        nextAction: { type: string; activityId?: string };
      };
    };
    expect(initialBody.projection.nextAction.type).toBe("activity");
    const activityId = initialBody.projection.nextAction.activityId;
    if (!activityId) throw new Error("Kernel did not select an activity");
    const endpoint = `/api/learning/sessions/v2/${session.id}/kernel/activities/${activityId}/transitions`;
    const transitionBody = JSON.stringify({
      operationId: "direct-kernel-start",
      transition: "start",
    });
    const first = await request(runtime.app, endpoint, {
      method: "POST",
      body: transitionBody,
    });
    expect(first.status, await first.clone().text()).toBe(201);
    const firstBody = (await first.json()) as {
      idempotent: boolean;
      projection: {
        projectionHash: string;
        progress: Array<{ unitId: string; status: string }>;
      };
    };
    expect(firstBody.idempotent).toBe(false);
    expect(firstBody.projection.progress).toContainEqual({
      unitId: activityId,
      status: "in_progress",
    });

    const replay = await request(runtime.app, endpoint, {
      method: "POST",
      body: transitionBody,
    });
    expect(replay.status, await replay.clone().text()).toBe(200);
    const replayBody = (await replay.json()) as typeof firstBody;
    expect(replayBody.idempotent).toBe(true);
    expect(replayBody.projection.projectionHash).toBe(
      firstBody.projection.projectionHash,
    );

    const forgedComplete = await request(runtime.app, endpoint, {
      method: "POST",
      body: JSON.stringify({
        operationId: "direct-kernel-forged-complete",
        transition: "complete",
      }),
    });
    expect(forgedComplete.status).toBe(400);
    const factCount = runtime.state.connection.sqlite
      .prepare(
        `SELECT COUNT(*) AS count FROM learning_kernel_facts
         WHERE operation_id = 'kernel:direct-kernel-start'`,
      )
      .get() as { count: number };
    expect(factCount.count).toBe(1);
  });

  it("completes the interview unit only with three persisted answers and a report", async () => {
    const runtime = createRuntime();
    const { session, interviewUnit } = await startDaySevenAtInterview(runtime);
    const endpoint = `/api/learning/sessions/v2/${session.id}/units/${interviewUnit.id}`;

    const forged = await request(runtime.app, endpoint, {
      method: "PATCH",
      body: JSON.stringify({
        operationId: "day7-interview-forged-complete",
        status: "completed",
        payload: {
          type: "interview",
          interviewSessionId: "fake",
          reportId: "fake",
        },
      }),
    });
    expect(forged.status).toBe(400);

    insertCompletedInterviewEvidence(
      runtime.state,
      session.id,
      "day7-real-interview",
      3,
    );
    const complete = await request(runtime.app, endpoint, {
      method: "PATCH",
      body: JSON.stringify({
        operationId: "day7-interview-real-complete",
        status: "completed",
        payload: {
          type: "interview",
          interviewSessionId: "day7-real-interview",
          reportId: "day7-real-interview",
        },
      }),
    });
    expect(complete.status).toBe(200);
  });

  it("rejects interview completion with fewer than three answers or no report", async () => {
    const runtime = createRuntime();
    const { session, interviewUnit } = await startDaySevenAtInterview(runtime);
    const endpoint = `/api/learning/sessions/v2/${session.id}/units/${interviewUnit.id}`;
    insertCompletedInterviewEvidence(
      runtime.state,
      session.id,
      "day7-incomplete-interview",
      2,
    );

    const incomplete = await request(runtime.app, endpoint, {
      method: "PATCH",
      body: JSON.stringify({
        operationId: "day7-interview-incomplete-complete",
        status: "completed",
        payload: {
          type: "interview",
          interviewSessionId: "day7-incomplete-interview",
          reportId: "day7-incomplete-interview",
        },
      }),
    });
    expect(incomplete.status).toBe(400);

    insertCompletedInterviewEvidence(
      runtime.state,
      session.id,
      "day7-no-report-interview",
      3,
    );
    const missingReport = await request(runtime.app, endpoint, {
      method: "PATCH",
      body: JSON.stringify({
        operationId: "day7-interview-no-report-complete",
        status: "completed",
        payload: {
          type: "interview",
          interviewSessionId: "day7-no-report-interview",
          reportId: "",
        },
      }),
    });
    expect(missingReport.status).toBe(400);
  });

  it("completes the full day 7 from briefing through interview to summary", async () => {
    const runtime = createRuntime();
    let session = await startDaySeven(runtime);
    let exerciseAttemptId: string | null = null;

    for (const unit of session.snapshot.units) {
      const endpoint = `/api/learning/sessions/v2/${session.id}/units/${unit.id}`;
      const started = await request(runtime.app, endpoint, {
        method: "PATCH",
        body: JSON.stringify({
          operationId: `day7-start-${unit.id}`,
          status: "in_progress",
        }),
      });
      expect(started.status, await started.clone().text()).toBe(200);

      let payload = completionPayload(unit);
      if (unit.type === "recall") {
        for (const [index, question] of unit.questions.entries()) {
          const response = await request(
            runtime.app,
            `${endpoint}/recall-attempts`,
            {
              method: "POST",
              body: JSON.stringify({
                operationId: `day7-recall-attempt-${index + 1}`,
                questionId: question.id,
                answer: `Самостоятельный ответ ${index + 1}`,
              }),
            },
          );
          expect(response.status, await response.clone().text()).toBe(201);
          session = ((await response.json()) as { session: LearnerSession })
            .session;
        }
        payload = unitProgressPayload(session, unit.id);
      }

      if (unit.type === "teacher-dialogue") {
        const conversationId = "day7-teacher-conversation";
        runtime.state.connection.sqlite
          .prepare(
            `INSERT INTO agent_conversations
             (id, learning_session_id, role, provider_id, model_id,
              provider_session_id, status, created_at, updated_at)
             VALUES (?, ?, 'teacher', 'mock', 'mock-deterministic', NULL,
                     'completed', 1000, 1000)`,
          )
          .run(conversationId, session.id);
        const insert = runtime.state.connection.sqlite.prepare(
          `INSERT INTO agent_messages
           (id, conversation_id, role, content, tool_events_json, raw_event_json,
            status, sequence, idempotency_key, created_at)
           VALUES (?, ?, ?, ?, '[]', NULL, 'completed', ?, NULL, ?)`,
        );
        insert.run(
          "day7-teacher-user-1",
          conversationId,
          "user",
          "Первый ответ",
          1,
          1001,
        );
        insert.run(
          "day7-teacher-assistant-1",
          conversationId,
          "assistant",
          "Уточните",
          2,
          1002,
        );
        insert.run(
          "day7-teacher-user-2",
          conversationId,
          "user",
          "Уточнённый ответ",
          3,
          1003,
        );
        insert.run(
          "day7-teacher-assistant-2",
          conversationId,
          "assistant",
          "Достаточно",
          4,
          1004,
        );
        payload = {
          type: "teacher-dialogue",
          conversationId,
          turnCount: 2,
          revisionAttemptIds: ["day7-teacher-user-1", "day7-teacher-user-2"],
        };
      }

      if (unit.type === "quiz") {
        const privateUnit = privateSnapshot(
          runtime.state.connection,
          session.id,
        ).units.find((candidate) => candidate.id === unit.id)!;
        const response = await request(
          runtime.app,
          `${endpoint}/quiz-attempts`,
          {
            method: "POST",
            body: JSON.stringify({
              operationId: "day7-quiz-attempt",
              answers: privateUnit.questions.map((question) => ({
                questionId: question.id,
                selectedOptionId: question.correctOptionIds[0],
              })),
            }),
          },
        );
        expect(response.status, await response.clone().text()).toBe(201);
        session = ((await response.json()) as { session: LearnerSession })
          .session;
        payload = unitProgressPayload(session, unit.id);
      }

      if (unit.type === "code-reading") {
        const response = await request(
          runtime.app,
          `${endpoint}/code-reading-attempts`,
          {
            method: "POST",
            body: JSON.stringify({
              operationId: "day7-code-reading-attempt",
              prediction: "Предсказание до запуска",
              explanation: "Объяснение механизма",
              verbalFix: "Исправление сформулировано",
            }),
          },
        );
        expect(response.status).toBe(201);
        session = ((await response.json()) as { session: LearnerSession })
          .session;
        payload = unitProgressPayload(session, unit.id);
      }

      if (unit.type === "exercise") {
        const exercise = runtime.state.connection.sqlite
          .prepare("SELECT id FROM exercises ORDER BY id LIMIT 1")
          .get() as { id: string };
        exerciseAttemptId = "day7-exercise-attempt";
        const now = Date.now();
        runtime.state.connection.sqlite
          .prepare(
            `INSERT INTO exercise_attempts
           (id, session_id, exercise_id, status, workspace_path, baseline_path,
            baseline_hash, started_at, completed_at, updated_at)
           VALUES (?, ?, ?, 'active', 'test-workspace', 'test-baseline',
                   'baseline-hash', ?, NULL, ?)`,
          )
          .run(exerciseAttemptId, session.id, exercise.id, now, now);
        runtime.state.connection.sqlite
          .prepare(
            `INSERT INTO test_runs
           (id, exercise_attempt_id, operation_id, status, exit_code, stdout,
            stderr, duration_ms, started_at, completed_at)
           VALUES ('day7-test-run', ?, 'day7-test-operation', 'passed', 0,
                   '', '', 1, ?, ?)`,
          )
          .run(exerciseAttemptId, now, now);
        payload = {
          type: "exercise",
          attemptId: exerciseAttemptId,
          latestTestRunId: "day7-test-run",
          latestReviewId: null,
        };
      }

      if (unit.type === "review") {
        if (!exerciseAttemptId) throw new Error("Exercise evidence is missing");
        const now = Date.now();
        runtime.state.connection.sqlite
          .prepare(
            `INSERT INTO reviews
           (id, session_id, exercise_attempt_id, provider_id, model_id, status,
            result_json, raw_response, created_at, completed_at)
           VALUES ('day7-review', ?, ?, 'mock', 'mock-reviewer', 'passed',
                   '{"status":"passed","findings":[]}', NULL, ?, ?)`,
          )
          .run(session.id, exerciseAttemptId, now, now);
        payload = {
          type: "review",
          reviewId: "day7-review",
          reviewStatus: "accepted",
          reviewedDiffHash: "sha256-day7-review-diff",
        };
      }

      if (unit.type === "interview") {
        insertCompletedInterviewEvidence(
          runtime.state,
          session.id,
          "day7-full-interview",
          3,
        );
        payload = {
          type: "interview",
          interviewSessionId: "day7-full-interview",
          reportId: "day7-full-interview",
        };
      }

      if (unit.type === "summary") {
        const response = await request(runtime.app, `${endpoint}/summary`, {
          method: "POST",
          body: JSON.stringify({ operationId: "day7-summary" }),
        });
        expect(response.status).toBe(201);
        session = ((await response.json()) as { session: LearnerSession })
          .session;
        payload = unitProgressPayload(session, unit.id);
      }

      const complete = await request(runtime.app, endpoint, {
        method: "PATCH",
        body: JSON.stringify({
          operationId: `day7-complete-${unit.id}`,
          status: "completed",
          payload,
        }),
      });
      expect(complete.status, `complete ${unit.stableId}`).toBe(200);
      session = ((await complete.json()) as { session: LearnerSession })
        .session;
    }

    expect(session.status).toBe("completed");
    expect(session.currentStep).toBe("complete");
    const current = await request(
      runtime.app,
      "/api/learning/sessions/current",
    );
    expect(await current.json()).toEqual({ session: null });
  });

  it("lists every Course and keeps path responses learner-safe", async () => {
    const { app } = createRuntime();
    const coursesResponse = await request(app, "/api/learning/courses");
    expect(coursesResponse.status).toBe(200);
    const coursesBody = (await coursesResponse.json()) as {
      courses: Array<{
        id: string;
        stableId: string;
        title: string;
        description: string | null;
        primaryLocale: string;
        revisions: Array<{
          id: string;
          revisionNumber: number;
          status: string;
          branchKind: string;
          contentHash: string;
        }>;
      }>;
    };
    expect(coursesBody.courses.map((course) => course.id)).toEqual(
      [...coursesBody.courses.map((course) => course.id)].sort(),
    );
    expect(coursesBody.courses.map((course) => course.id)).toEqual(
      expect.arrayContaining([
        "curriculum-foundation",
        "curriculum-legacy-bridge",
      ]),
    );
    for (const course of coursesBody.courses) {
      expect(
        course.revisions.map((revision) => revision.revisionNumber),
      ).toEqual(
        [...course.revisions.map((revision) => revision.revisionNumber)].sort(
          (left, right) => left - right,
        ),
      );
    }

    const foundation = coursesBody.courses.find(
      (course) => course.id === "curriculum-foundation",
    );
    const publishedRevision = foundation?.revisions.find(
      (revision) => revision.status === "published",
    );
    if (!foundation || !publishedRevision) {
      throw new Error("Published foundation Course fixture is missing");
    }
    const explicitPathResponse = await request(
      app,
      `/api/learning/courses/${foundation.id}/revisions/${publishedRevision.id}/path`,
    );
    expect(explicitPathResponse.status).toBe(200);
    const explicitPath = (await explicitPathResponse.json()) as {
      courseContext: { courseId: string; revisionId: string };
      curriculum: { id: string; version: { id: string } };
    };
    expect(explicitPath.courseContext).toEqual({
      courseId: foundation.id,
      revisionId: publishedRevision.id,
    });
    expect(explicitPath.curriculum).toMatchObject({
      id: foundation.id,
      version: { id: publishedRevision.id },
    });

    const compatibilityPathResponse = await request(app, "/api/learning/path");
    expect(compatibilityPathResponse.status).toBe(200);
    const compatibilityPath =
      (await compatibilityPathResponse.json()) as Record<string, unknown>;
    const keys = collectKeys({ coursesBody, explicitPath, compatibilityPath });
    for (const forbidden of [
      "referenceAnswer",
      "evaluationPoints",
      "correctOptionIds",
      "correctQuestionIds",
      "commonMistakes",
      "misconceptions",
      "protectedEvaluation",
      "protectedMaterial",
      "path",
      "command",
      "provider",
      "credential",
      "executable",
    ]) {
      expect(keys).not.toContain(forbidden);
    }

    const mismatched = await request(
      app,
      `/api/learning/courses/curriculum-legacy-bridge/revisions/${publishedRevision.id}/path`,
    );
    expect(mismatched.status).toBe(400);
    const legacy = coursesBody.courses.find(
      (course) => course.id === "curriculum-legacy-bridge",
    );
    if (!legacy) throw new Error("Archived legacy Course fixture is missing");
    const archivedRevision = legacy.revisions.find(
      (revision) => revision.status === "archived",
    );
    if (!archivedRevision) {
      throw new Error("Archived legacy Course fixture is missing");
    }
    const archived = await request(
      app,
      `/api/learning/courses/${legacy.id}/revisions/${archivedRevision.id}/path`,
    );
    expect(archived.status).toBe(400);

    const current = await request(app, "/api/learning/sessions/current");
    expect(current.status).toBe(200);
    expect(await current.json()).toEqual({ session: null });
  });

  it("rejects a locked day and resumes the active day idempotently", async () => {
    const { app, state } = createRuntime();
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
      error:
        "Learning day is locked until its declared prerequisites are completed",
    });

    const first = await request(app, "/api/learning/sessions/v2", {
      method: "POST",
      body: JSON.stringify({ dayId: dayOne!.id, operationId: "start-day-1" }),
    });
    expect(first.status).toBe(201);
    const firstSession = ((await first.json()) as { session: LearnerSession })
      .session;
    const snapshotBinding = state.connection.sqlite
      .prepare(
        "SELECT id, content_hash FROM session_snapshots WHERE session_id = ?",
      )
      .get(firstSession.id) as { id: string; content_hash: string };
    expect(firstSession.courseContext).toEqual({
      courseId: firstSession.snapshot.curriculumId,
      revisionId: firstSession.snapshot.curriculumVersionId,
      lessonId: firstSession.snapshot.day.id,
      sessionSnapshotId: snapshotBinding.id,
      snapshotHash: snapshotBinding.content_hash,
    });

    const replay = await request(app, "/api/learning/sessions/v2", {
      method: "POST",
      body: JSON.stringify({ dayId: dayOne!.id, operationId: "start-day-1" }),
    });
    expect(replay.status).toBe(201);
    const replaySession = ((await replay.json()) as { session: LearnerSession })
      .session;
    expect(replaySession.id).toBe(firstSession.id);
    expect(replaySession.courseContext).toEqual(firstSession.courseContext);

    const current = (
      (await (await request(app, "/api/learning/sessions/current")).json()) as {
        session: LearnerSession;
      }
    ).session;
    expect(current.id).toBe(firstSession.id);
    expect(current.status).toBe("active");
    expect(current.courseContext).toEqual(firstSession.courseContext);
  });

  it("rejects a frozen legacy-v1 target before creating a session", async () => {
    const { app, state } = createRuntime();
    const identifiers = [
      "legacy-v1",
      "legacy-start-week",
      "legacy-start-lesson",
      "legacy-start-activity",
    ][Symbol.iterator]();
    const authoring = createCurriculumAuthoringRepository(state.connection, {
      id: () => {
        const next = identifiers.next();
        if (next.done) throw new Error("Legacy fixture exhausted IDs");
        return next.value;
      },
      now: () => 10_000,
    });
    const draft = await authoring.createDraft({
      curriculum: {
        id: "legacy-start-course",
        slug: "legacy-start-course",
        title: "Legacy start Course",
      },
      title: "Frozen legacy revision",
    });
    const week = await authoring.addWeek({
      versionId: draft.id,
      stableId: "legacy-start-week",
      title: "Legacy week",
    });
    const lesson = await authoring.addDay({
      versionId: draft.id,
      weekId: week.id,
      stableId: "legacy-start-lesson",
      title: "Legacy lesson",
      goal: "Stay read-only",
      estimatedMinutes: 10,
      depthLevel: "foundation",
    });
    await authoring.addUnit({
      versionId: draft.id,
      dayId: lesson.id,
      stableId: "legacy-start-activity",
      type: "briefing",
      title: "Legacy activity",
      completionCriteria: [{ type: "acknowledgement" }],
      depthLevel: "foundation",
      payload: { type: "briefing", scope: [] },
    });
    await authoring.publishVersion(draft.id);
    const countSessions = () =>
      z
        .object({ count: z.number().int().nonnegative() })
        .parse(
          state.connection.sqlite
            .prepare("SELECT count(*) AS count FROM learning_sessions")
            .get(),
        ).count;
    const before = countSessions();

    const response = await request(app, "/api/learning/sessions/v2", {
      method: "POST",
      body: JSON.stringify({
        dayId: lesson.id,
        operationId: "reject-frozen-legacy-target",
      }),
    });

    expect(response.status).toBe(410);
    expect(await response.json()).toEqual({
      error:
        "Legacy learning mutations are frozen; use /api/learning/sessions/v2",
    });
    expect(countSessions()).toBe(before);
  });

  it("resumes only explicitly quarantined legacy session bindings", async () => {
    const { app, state } = createRuntime();
    const pathBody = z
      .object({
        curriculum: z.object({
          weeks: z.array(
            z.object({ days: z.array(z.object({ id: z.string() })) }),
          ),
        }),
      })
      .parse(await (await request(app, "/api/learning/path")).json());
    const lessonId = pathBody.curriculum.weeks[0]!.days[0]!.id;
    const startedResponse = await request(app, "/api/learning/sessions/v2", {
      method: "POST",
      body: JSON.stringify({
        dayId: lessonId,
        operationId: "quarantined-session-compatibility",
      }),
    });
    expect(startedResponse.status).toBe(201);
    const sessionResponseSchema = z.object({
      session: z.object({
        id: z.string(),
        courseContext: z.object({
          courseId: z.string(),
          revisionId: z.string(),
          lessonId: z.string(),
          sessionSnapshotId: z.string(),
          snapshotHash: z.string(),
        }),
      }),
    });
    const session = sessionResponseSchema.parse(
      await startedResponse.json(),
    ).session;

    expect(() =>
      state.connection.sqlite
        .prepare("DELETE FROM session_course_contexts WHERE session_id = ?")
        .run(session.id),
    ).toThrow(/immutable/u);
    state.connection.sqlite.exec(
      "DROP TRIGGER session_course_contexts_immutable_delete_guard",
    );
    state.connection.sqlite
      .prepare("DELETE FROM session_course_contexts WHERE session_id = ?")
      .run(session.id);
    const unaccounted = await request(app, "/api/learning/sessions/current");
    expect(unaccounted.status).toBe(400);
    expect(await unaccounted.json()).toEqual({
      error: "Learning session has no Course context",
    });

    const snapshot = z
      .object({ id: z.string() })
      .parse(
        state.connection.sqlite
          .prepare("SELECT id FROM session_snapshots WHERE session_id = ?")
          .get(session.id),
      );
    const run = z
      .object({ id: z.string(), source_database_digest: z.string() })
      .parse(
        state.connection.sqlite
          .prepare(
            `SELECT id, source_database_digest FROM migration_runs
             WHERE transform_version = 'm2-v1'`,
          )
          .get(),
      );
    const insertProvenance = state.connection.sqlite.prepare(
      `INSERT INTO migration_provenance
       (id, run_id, source_database_digest, source_table, source_primary_key,
        source_row_hash, target_entity_type, target_id, transform_version,
        status, reason_code, diagnostic, created_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, 'm2-v1', 'quarantined', ?, ?, ?)`,
    );
    const sources = [
      [
        "curriculum_versions",
        session.courseContext.revisionId,
        "CROSS_SCOPE_PARENT_REVISION",
      ],
      ["curriculum_days_v2", lessonId, "MALFORMED_LESSON"],
      ["session_snapshots", snapshot.id, "MALFORMED_SESSION_CONTEXT"],
    ] as const;
    sources.forEach(([sourceTable, sourceId, reasonCode], index) => {
      insertProvenance.run(
        `compatibility-provenance-${index}`,
        run.id,
        run.source_database_digest,
        sourceTable,
        sourceId,
        sourceRowHash(state.connection, sourceTable, sourceId),
        reasonCode,
        "Explicit test quarantine for legacy compatibility",
        index + 1,
      );
    });

    const compatible = await request(app, "/api/learning/sessions/current");
    expect(compatible.status).toBe(200);
    const compatibleSession = sessionResponseSchema.parse(
      await compatible.json(),
    ).session;
    expect(compatibleSession.courseContext).toEqual(session.courseContext);
  });

  it("fails closed when resume bindings lose their snapshot hash or activity IDs", async () => {
    const { app, state } = createRuntime();
    const pathBody = (await (
      await request(app, "/api/learning/path")
    ).json()) as {
      curriculum: { weeks: Array<{ days: Array<{ id: string }> }> };
    };
    const lesson = pathBody.curriculum.weeks[0]!.days[0]!;
    const started = await request(app, "/api/learning/sessions/v2", {
      method: "POST",
      body: JSON.stringify({
        dayId: lesson.id,
        operationId: "resume-integrity-session",
      }),
    });
    expect(started.status).toBe(201);
    const startedBody = (await started.json()) as {
      session: LearnerSession;
    };
    const session = startedBody.session;
    const sourceSnapshot = state.connection.sqlite
      .prepare(
        "SELECT content_hash FROM session_snapshots WHERE session_id = ?",
      )
      .get(session.id) as { content_hash: string };

    state.connection.sqlite.exec(
      "DROP TRIGGER session_snapshots_immutable_update_guard",
    );
    state.connection.sqlite
      .prepare(
        "UPDATE session_snapshots SET content_hash = ? WHERE session_id = ?",
      )
      .run("0".repeat(64), session.id);
    const hashMismatch = await request(
      app,
      `/api/learning/sessions/v2/${session.id}`,
    );
    expect(hashMismatch.status).toBe(400);

    state.connection.sqlite
      .prepare(
        "UPDATE session_snapshots SET content_hash = ? WHERE session_id = ?",
      )
      .run(sourceSnapshot.content_hash, session.id);
    const firstProgress = state.connection.sqlite
      .prepare(
        `SELECT id FROM unit_progress
         WHERE session_id = ? ORDER BY id LIMIT 1`,
      )
      .get(session.id) as { id: string };
    state.connection.sqlite
      .prepare("UPDATE unit_progress SET unit_id = ? WHERE id = ?")
      .run("cross-scope-activity", firstProgress.id);
    const activityMismatch = await request(
      app,
      `/api/learning/sessions/v2/${session.id}`,
    );
    expect(activityMismatch.status).toBe(400);
  });

  it("reads only an exact quarantined compatibility path after the current session ends", async () => {
    const { app, state } = createRuntime();
    const initialPath = z
      .object({
        courseContext: z.object({
          courseId: z.string(),
          revisionId: z.string(),
        }),
        curriculum: z.object({
          weeks: z.array(
            z.object({ days: z.array(z.object({ id: z.string() })) }),
          ),
        }),
      })
      .parse(await (await request(app, "/api/learning/path")).json());
    const lessonId = initialPath.curriculum.weeks[0]!.days[0]!.id;
    const started = await request(app, "/api/learning/sessions/v2", {
      method: "POST",
      body: JSON.stringify({
        dayId: lessonId,
        operationId: "quarantined-path-current-session",
      }),
    });
    expect(started.status).toBe(201);
    const session = z
      .object({
        session: z.object({
          id: z.string(),
          courseContext: z.object({
            courseId: z.string(),
            revisionId: z.string(),
            lessonId: z.string(),
            sessionSnapshotId: z.string(),
          }),
        }),
      })
      .parse(await started.json()).session;

    state.connection.sqlite.exec(
      "DROP TRIGGER session_course_contexts_immutable_delete_guard",
    );
    state.connection.sqlite
      .prepare("DELETE FROM session_course_contexts WHERE session_id = ?")
      .run(session.id);
    const endedAt = Date.now();
    state.connection.sqlite
      .prepare(
        `UPDATE learning_sessions
         SET status = 'abandoned', updated_at = ?
         WHERE id = ?`,
      )
      .run(endedAt, session.id);
    state.connection.sqlite
      .prepare(
        `UPDATE learner_state
         SET current_learning_session_id = NULL, updated_at = ?
         WHERE id = 'default'`,
      )
      .run(endedAt);
    expect(
      await (await request(app, "/api/learning/sessions/current")).json(),
    ).toEqual({ session: null });

    state.connection.sqlite.exec(
      `PRAGMA foreign_keys = OFF;
       DROP TRIGGER course_revisions_accepted_delete_guard;`,
    );
    state.connection.sqlite
      .prepare("DELETE FROM course_revisions WHERE id = ?")
      .run(session.courseContext.revisionId);
    state.connection.sqlite.exec("PRAGMA foreign_keys = ON;");
    const unaccounted = await request(app, "/api/learning/path");
    expect(unaccounted.status).toBe(404);
    expect(await unaccounted.json()).toEqual({
      error: `Unknown Course revision: ${session.courseContext.revisionId}`,
    });

    const migrationRun = z
      .object({ id: z.string(), source_database_digest: z.string() })
      .parse(
        state.connection.sqlite
          .prepare(
            `SELECT id, source_database_digest FROM migration_runs
             WHERE transform_version = 'm2-v1'`,
          )
          .get(),
      );
    const insertProvenance = state.connection.sqlite.prepare(
      `INSERT INTO migration_provenance
       (id, run_id, source_database_digest, source_table, source_primary_key,
        source_row_hash, target_entity_type, target_id, transform_version,
        status, reason_code, diagnostic, created_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, 'm2-v1', 'quarantined', ?, ?, ?)`,
    );
    const sources = [
      [
        "curriculum_versions",
        session.courseContext.revisionId,
        "CROSS_SCOPE_PARENT_REVISION",
      ],
      ["curriculum_days_v2", lessonId, "MALFORMED_LESSON"],
      [
        "session_snapshots",
        session.courseContext.sessionSnapshotId,
        "MALFORMED_SESSION_CONTEXT",
      ],
    ] as const;
    sources.forEach(([sourceTable, sourceId, reasonCode], index) => {
      insertProvenance.run(
        `quarantined-path-provenance-${index}`,
        migrationRun.id,
        migrationRun.source_database_digest,
        sourceTable,
        sourceId,
        sourceRowHash(state.connection, sourceTable, sourceId),
        reasonCode,
        "Explicit test quarantine for exact legacy path compatibility",
        endedAt + index + 1,
      );
    });

    const compatible = await request(app, "/api/learning/path");
    expect(compatible.status).toBe(200);
    const compatiblePath = z
      .object({
        courseContext: z.object({
          courseId: z.string(),
          revisionId: z.string(),
        }),
        curriculum: z.object({
          id: z.string(),
          version: z.object({ id: z.string() }),
        }),
      })
      .parse(await compatible.json());
    expect(compatiblePath.courseContext).toEqual({
      courseId: session.courseContext.courseId,
      revisionId: session.courseContext.revisionId,
    });
    expect(compatiblePath.curriculum).toMatchObject({
      id: session.courseContext.courseId,
      version: { id: session.courseContext.revisionId },
    });

    state.connection.sqlite.exec(
      `DROP TRIGGER curriculum_versions_quarantined_update_guard;
       DROP TRIGGER curriculum_versions_published_update_guard;`,
    );
    state.connection.sqlite
      .prepare(
        `UPDATE curriculum_versions SET updated_at = updated_at + 1
         WHERE id = ?`,
      )
      .run(session.courseContext.revisionId);
    const tampered = await request(app, "/api/learning/path");
    expect(tampered.status).toBe(404);
    expect(await tampered.json()).toEqual({
      error: `Unknown Course revision: ${session.courseContext.revisionId}`,
    });
  });

  it("keeps an active session bound to its exact Course revision", async () => {
    const { app } = createRuntime();
    const initialPath = (await (
      await request(app, "/api/learning/path")
    ).json()) as {
      courseContext: { courseId: string; revisionId: string };
      curriculum: {
        version: { id: string; revision: number };
        weeks: Array<{
          days: Array<{
            id: string;
            stableId: string;
            units: Array<{ id: string; stableId: string; status: string }>;
          }>;
        }>;
      };
    };
    const initialDay = initialPath.curriculum.weeks[0]!.days[0]!;
    const started = await request(app, "/api/learning/sessions/v2", {
      method: "POST",
      body: JSON.stringify({
        dayId: initialDay.id,
        operationId: "pinned-revision-session",
      }),
    });
    expect(started.status).toBe(201);
    const startedSession = (
      (await started.json()) as { session: LearnerSession }
    ).session;

    const nextRevisionId = await cloneAndPublishActiveRevision(
      app,
      initialPath.courseContext.revisionId,
      "pinned-next",
    );
    const resumedPath = (await (
      await request(app, "/api/learning/path")
    ).json()) as typeof initialPath;
    const resumedDay = resumedPath.curriculum.weeks[0]!.days[0]!;
    expect(resumedPath.courseContext).toEqual({
      courseId: startedSession.courseContext.courseId,
      revisionId: startedSession.courseContext.revisionId,
    });
    expect(resumedDay.id).toBe(initialDay.id);
    expect(resumedDay).toMatchObject({
      status: "in_progress",
      sessionId: startedSession.id,
    });
    expect(resumedDay.units[0]?.status).toBe("ready");
    expect(
      resumedDay.units.slice(1).every((unit) => unit.status === "locked"),
    ).toBe(true);

    const nextRevisionResponse = await request(
      app,
      `/api/learning/courses/${initialPath.courseContext.courseId}/revisions/${nextRevisionId}/path`,
    );
    expect(nextRevisionResponse.status).toBe(200);
    const nextRevisionPath =
      (await nextRevisionResponse.json()) as typeof initialPath;
    const nextRevisionDay = nextRevisionPath.curriculum.weeks[0]!.days[0]!;
    expect(nextRevisionPath.courseContext.revisionId).toBe(nextRevisionId);
    expect(nextRevisionDay.id).not.toBe(initialDay.id);
    expect(nextRevisionDay.stableId).toBe(initialDay.stableId);

    const crossRevisionActivity = await request(
      app,
      `/api/learning/sessions/v2/${startedSession.id}/units/${nextRevisionDay.units[0]!.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          operationId: "cross-revision-activity-start",
          status: "in_progress",
        }),
      },
    );
    expect(crossRevisionActivity.status).toBe(404);
    const unchanged = (await (
      await request(app, `/api/learning/sessions/v2/${startedSession.id}`)
    ).json()) as { session: LearnerSession };
    expect(unchanged.session.courseContext).toEqual(
      startedSession.courseContext,
    );
    expect(unchanged.session.unitProgress[0]?.status).toBe("ready");
  });

  it("does not transfer changed lesson completion across Course revisions", async () => {
    const { app, state } = createRuntime();
    const completeSession = (sessionId: string) => {
      const completedAt = Date.now();
      state.connection.sqlite
        .prepare(
          `UPDATE learning_sessions
           SET status = 'completed', current_step = 'complete', completed_at = ?,
               updated_at = ?
           WHERE id = ?`,
        )
        .run(completedAt, completedAt, sessionId);
    };
    const RevisionPathSchema = z.object({
      courseContext: z.object({
        courseId: z.string(),
        revisionId: z.string(),
      }),
      curriculum: z.object({
        version: z.object({
          id: z.string(),
          revision: z.number(),
          contentHash: z.string(),
        }),
        weeks: z.array(
          z.object({
            days: z.array(
              z.object({
                id: z.string(),
                stableId: z.string(),
                status: z.string(),
                units: z.array(
                  z.object({
                    id: z.string(),
                    stableId: z.string(),
                    title: z.string(),
                    status: z.string(),
                  }),
                ),
              }),
            ),
          }),
        ),
      }),
    });
    const SessionIdResponseSchema = z.object({
      session: z.object({ id: z.string() }),
    });

    const sourceResponse = await request(app, "/api/learning/path");
    expect(sourceResponse.status).toBe(200);
    const sourcePath = RevisionPathSchema.parse(await sourceResponse.json());
    const sourceDays = sourcePath.curriculum.weeks[0]!.days;
    const sourceDayOne = sourceDays[0]!;
    const sourceStarted = await request(app, "/api/learning/sessions/v2", {
      method: "POST",
      body: JSON.stringify({
        dayId: sourceDayOne.id,
        operationId: "complete-source-revision-day-one",
      }),
    });
    expect(sourceStarted.status).toBe(201);
    const sourceSession = SessionIdResponseSchema.parse(
      await sourceStarted.json(),
    ).session;
    completeSession(sourceSession.id);

    const nextRevisionId = await cloneAndPublishActiveRevision(
      app,
      sourcePath.courseContext.revisionId,
      "isolated-next",
      true,
    );
    const nextResponse = await request(app, "/api/learning/path");
    expect(nextResponse.status).toBe(200);
    const nextPath = RevisionPathSchema.parse(await nextResponse.json());
    const nextDays = nextPath.curriculum.weeks[0]!.days;
    const nextDayOne = nextDays[0]!;
    const nextDayTwo = nextDays[1]!;

    expect(nextPath.courseContext.revisionId).toBe(nextRevisionId);
    expect(nextPath.curriculum.version.contentHash).not.toBe(
      sourcePath.curriculum.version.contentHash,
    );
    expect(nextDayOne.id).not.toBe(sourceDayOne.id);
    expect(nextDayOne.stableId).toBe(sourceDayOne.stableId);
    expect(nextDayOne.units[0]!.title).not.toBe(sourceDayOne.units[0]!.title);
    expect(nextDayOne.status).toBe("available");
    expect(nextDayTwo.status).toBe("locked");

    const crossRevisionUnlock = await request(
      app,
      "/api/learning/sessions/v2",
      {
        method: "POST",
        body: JSON.stringify({
          dayId: nextDayTwo.id,
          operationId: "cross-revision-day-two",
        }),
      },
    );
    expect(crossRevisionUnlock.status).toBe(400);
    expect(await crossRevisionUnlock.json()).toEqual({
      error:
        "Learning day is locked until its declared prerequisites are completed",
    });

    const nextStarted = await request(app, "/api/learning/sessions/v2", {
      method: "POST",
      body: JSON.stringify({
        dayId: nextDayOne.id,
        operationId: "complete-next-revision-day-one",
      }),
    });
    expect(nextStarted.status).toBe(201);
    const nextSession = SessionIdResponseSchema.parse(
      await nextStarted.json(),
    ).session;
    completeSession(nextSession.id);

    const exactRevisionPath = RevisionPathSchema.parse(
      await (await request(app, "/api/learning/path")).json(),
    );
    expect(exactRevisionPath.curriculum.weeks[0]!.days[0]!.status).toBe(
      "completed",
    );
    expect(exactRevisionPath.curriculum.weeks[0]!.days[1]!.status).toBe(
      "available",
    );
    const exactRevisionUnlock = await request(
      app,
      "/api/learning/sessions/v2",
      {
        method: "POST",
        body: JSON.stringify({
          dayId: nextDayTwo.id,
          operationId: "exact-revision-day-two",
        }),
      },
    );
    expect(exactRevisionUnlock.status).toBe(201);
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
      {
        method: "PATCH",
        body: JSON.stringify({
          operationId: "locked-activity-start",
          status: "in_progress",
        }),
      },
    );
    expect(lockedStart.status).toBe(400);
    expect(await lockedStart.json()).toEqual({
      error: "Unit transition is not allowed",
    });

    const firstUnit = session.snapshot.units[0]!;
    const startedUnit = await request(
      firstRuntime.app,
      `/api/learning/sessions/v2/${session.id}/units/${firstUnit.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          operationId: "first-activity-start",
          status: "in_progress",
        }),
      },
    );
    expect(startedUnit.status, await startedUnit.clone().text()).toBe(200);

    const missingEvidence = await request(
      firstRuntime.app,
      `/api/learning/sessions/v2/${session.id}/units/${firstUnit.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          operationId: "first-activity-missing-evidence-complete",
          status: "completed",
        }),
      },
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
          operationId: "first-activity-complete",
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
        {
          method: "PATCH",
          body: JSON.stringify({
            operationId: `day1-start-${unit.id}`,
            status: "in_progress",
          }),
        },
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
            body: JSON.stringify({
              operationId: `day1-forged-complete-${unit.id}`,
              status: "completed",
              payload,
            }),
          },
        );
        expect(forged.status, `forged ${unit.stableId}`).toBe(400);
        expect(await forged.json()).toEqual({
          error: "Unit completion criteria are not satisfied",
        });
      }

      if (unit.type === "recall") {
        const [firstQuestion, ...remainingQuestions] = unit.questions;
        if (!firstQuestion || remainingQuestions.length === 0) {
          throw new Error("Recall fixture requires multiple questions");
        }
        const unexpectedField = await request(
          restartedRuntime.app,
          `/api/learning/sessions/v2/${session.id}/units/${unit.id}/recall-attempts`,
          {
            method: "POST",
            body: JSON.stringify({
              operationId: "day1-recall-invalid",
              questionId: firstQuestion.id,
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
              questionId: firstQuestion.id,
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
        const incompleteCompletion = await request(
          restartedRuntime.app,
          `/api/learning/sessions/v2/${session.id}/units/${unit.id}`,
          {
            method: "PATCH",
            body: JSON.stringify({
              operationId: `day1-incomplete-recall-${unit.id}`,
              status: "completed",
              payload: unitProgressPayload(firstBody.session, unit.id),
            }),
          },
        );
        expect(incompleteCompletion.status).toBe(400);
        expect(await incompleteCompletion.json()).toEqual({
          error: "Unit completion criteria are not satisfied",
        });

        const distinctAnswers = new Map<string, string>([
          [firstQuestion.id, "Первый самостоятельный ответ до любой подсказки"],
        ]);
        for (const [index, question] of remainingQuestions.entries()) {
          const answer = `Отдельный ответ ${index + 2} на вопрос ${question.id}`;
          distinctAnswers.set(question.id, answer);
          const response = await request(
            restartedRuntime.app,
            `/api/learning/sessions/v2/${session.id}/units/${unit.id}/recall-attempts`,
            {
              method: "POST",
              body: JSON.stringify({
                operationId: `day1-recall-${index + 2}`,
                questionId: question.id,
                answer,
              }),
            },
          );
          expect(response.status).toBe(201);
          const responseBody = (await response.json()) as {
            evidence: {
              id: string;
              questionId: string;
              isFirstAttempt: boolean;
            };
            session: LearnerSession;
          };
          expect(responseBody.evidence).toMatchObject({
            questionId: question.id,
            isFirstAttempt: true,
          });
          session = responseBody.session;
        }

        const revision = await request(
          restartedRuntime.app,
          `/api/learning/sessions/v2/${session.id}/units/${unit.id}/recall-attempts`,
          {
            method: "POST",
            body: JSON.stringify({
              operationId: "day1-recall-revision",
              questionId: firstQuestion.id,
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
          answers: expect.arrayContaining(
            [...distinctAnswers].map(([questionId, draft]) =>
              expect.objectContaining({ questionId, draft }),
            ),
          ),
        });
        expect((payload as { answers: unknown[] }).answers).toHaveLength(
          unit.questions.length,
        );

        const reloaded = await request(
          restartedRuntime.app,
          `/api/learning/sessions/v2/${session.id}`,
        );
        expect(reloaded.status).toBe(200);
        const reloadedSession = (await reloaded.json()) as {
          session: LearnerSession;
        };
        expect(
          unitProgressPayload(reloadedSession.session, unit.id),
        ).toMatchObject(payload);
      }

      if (unit.type === "teacher-dialogue") {
        const conversationId = "day1-teacher-conversation";
        restartedRuntime.state.connection.sqlite
          .prepare(
            `INSERT INTO agent_conversations
             (id, learning_session_id, role, provider_id, model_id,
              provider_session_id, status, created_at, updated_at)
             VALUES (?, ?, 'teacher', 'mock', 'mock-deterministic', ?,
                     'active', 1000, 1000)`,
          )
          .run(conversationId, session.id, "provider-teacher-session");
        const insertMessage = restartedRuntime.state.connection.sqlite.prepare(
          `INSERT INTO agent_messages
           (id, conversation_id, role, content, tool_events_json,
            raw_event_json, status, sequence, idempotency_key, created_at)
           VALUES (?, ?, ?, ?, '[]', NULL, 'completed', ?, NULL, ?)`,
        );
        insertMessage.run(
          "teacher-user-1",
          conversationId,
          "user",
          "Первое уточнённое объяснение",
          1,
          1001,
        );
        insertMessage.run(
          "teacher-assistant-1",
          conversationId,
          "assistant",
          "Почему это следует из общей ссылки?",
          2,
          1002,
        );
        const firstTurnPayload = {
          type: "teacher-dialogue",
          conversationId,
          turnCount: 1,
          revisionAttemptIds: ["teacher-user-1"],
        };
        const incomplete = await request(
          restartedRuntime.app,
          `/api/learning/sessions/v2/${session.id}/units/${unit.id}`,
          {
            method: "PATCH",
            body: JSON.stringify({
              operationId: `day1-incomplete-teacher-${unit.id}`,
              status: "completed",
              payload: firstTurnPayload,
            }),
          },
        );
        expect(incomplete.status).toBe(400);

        insertMessage.run(
          "teacher-user-2",
          conversationId,
          "user",
          "Ответ ученика на уточнение Teacher",
          3,
          1003,
        );
        insertMessage.run(
          "teacher-assistant-2",
          conversationId,
          "assistant",
          "Теперь причинная цепочка полная.",
          4,
          1004,
        );
        payload = {
          ...firstTurnPayload,
          turnCount: 2,
          revisionAttemptIds: ["teacher-user-1", "teacher-user-2"],
        };

        const transcript = await request(
          restartedRuntime.app,
          `/api/learning/sessions/v2/${session.id}/teacher-transcript`,
        );
        expect(transcript.status).toBe(200);
        expect(await transcript.json()).toMatchObject({
          messages: [
            { id: "teacher-user-1", role: "user" },
            { id: "teacher-assistant-1", role: "assistant" },
            { id: "teacher-user-2", role: "user" },
            { id: "teacher-assistant-2", role: "assistant" },
          ],
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
        expect(retriedQuiz.status, await retriedQuiz.clone().text()).toBe(201);
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
              operationId: `day1-stale-test-${unit.id}`,
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
              operationId: `day1-stale-review-${unit.id}`,
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
              operationId: `day1-fake-summary-${unit.id}`,
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
            operationId: `day1-complete-${unit.id}`,
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
