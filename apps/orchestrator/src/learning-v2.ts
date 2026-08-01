import { createHash } from "node:crypto";

import {
  CurriculumAuthoringRepository,
  type DatabaseConnection,
  type LearningRepository,
  type VersionedSessionDetail,
} from "@dlh/database";
import {
  applyMasteryEvidenceBatch,
  createUnitProgression,
  createEmptyMasteryProfile,
  deriveDaySummary,
  isLessonComplete,
  transitionUnitProgression,
  type DaySummary,
  type EvidenceType,
  type HintLevel,
  type MasteryDimension,
  type MasteryProfile,
  type UnitDefinition,
  type UnitProgressionEvent,
} from "@dlh/learning-core";
import {
  CurriculumUnitSchema,
  SessionSnapshotSchema,
  UnitProgressPayloadSchema,
  UnitStatusSchema,
  type CurriculumUnit,
  type SessionSnapshot,
  type UnitProgress,
  type UnitProgressPayload,
  type UnitStatus,
} from "@dlh/shared";
import type { Hono } from "hono";
import { z } from "zod";

interface VersionedLearningState {
  connection: DatabaseConnection;
  repository: LearningRepository;
}

const startSessionSchema = z
  .object({
    dayId: z.string().trim().min(1).max(200),
    operationId: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

const updateUnitSchema = z
  .object({
    operationId: z.string().trim().min(1).max(200).optional(),
    status: UnitStatusSchema.exclude(["locked"]),
    payload: UnitProgressPayloadSchema.optional(),
  })
  .strict();

const operationIdSchema = z.string().trim().min(1).max(100);

const recallAttemptSchema = z
  .object({
    operationId: operationIdSchema,
    answer: z.string().trim().min(1).max(50_000),
  })
  .strict();

const quizAttemptSchema = z
  .object({
    operationId: operationIdSchema,
    answers: z
      .array(
        z
          .object({
            questionId: z.string().trim().min(1).max(200),
            selectedOptionId: z.string().trim().min(1).max(200),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict()
  .superRefine((input, context) => {
    const seen = new Set<string>();
    input.answers.forEach((answer, index) => {
      if (seen.has(answer.questionId)) {
        context.addIssue({
          code: "custom",
          path: ["answers", index, "questionId"],
          message: "A quiz question can only be answered once per attempt",
        });
      }
      seen.add(answer.questionId);
    });
  });

const codeReadingAttemptSchema = z
  .object({
    operationId: operationIdSchema,
    prediction: z.string().trim().min(1).max(50_000),
    explanation: z.string().trim().min(1).max(50_000),
    verbalFix: z.string().trim().min(1).max(50_000),
  })
  .strict();

const summaryRequestSchema = z
  .object({ operationId: operationIdSchema })
  .strict();

const summaryMasteryEvidenceSchema = z
  .object({
    id: z.string().min(1),
    topicId: z.string().min(1),
    dimension: z.enum([
      "understanding",
      "explanation",
      "codeReading",
      "implementation",
      "debugging",
      "interview",
    ]),
    type: z.enum([
      "recall",
      "explanation",
      "code_reading",
      "implementation",
      "debugging",
      "interview",
    ]),
    outcome: z.enum(["incorrect", "partial", "correct"]),
    occurredAt: z.iso.datetime(),
    hintLevel: z.number().int().min(0).max(5),
    errorKey: z.string().min(1).optional(),
  })
  .strict();

const daySummarySchema = z
  .object({
    sessionId: z.string().min(1),
    occurredAt: z.iso.datetime(),
    masteryEvidence: z.array(summaryMasteryEvidenceSchema),
    strengths: z.array(z.string()),
    gaps: z.array(z.string()),
    mistakeCandidates: z.array(
      z
        .object({
          fingerprint: z.string().min(1),
          summary: z.string().min(1),
          correction: z.string().min(1),
          sourceId: z.string().min(1),
        })
        .strict(),
    ),
    flashcardCandidates: z.array(
      z
        .object({
          front: z.string().min(1),
          back: z.string().min(1),
          sourceFingerprint: z.string().min(1).optional(),
        })
        .strict(),
    ),
    narrative: z.string(),
    metrics: z
      .object({
        topicCount: z.number().int().nonnegative(),
        evidenceCount: z.number().int().nonnegative(),
        correctEvidenceCount: z.number().int().nonnegative(),
        partialEvidenceCount: z.number().int().nonnegative(),
        incorrectEvidenceCount: z.number().int().nonnegative(),
        attemptedActivityCount: z.number().int().nonnegative(),
        quizScore: z.number().min(0).max(1),
        maxHintLevel: z.number().int().min(0).max(5),
        exerciseTestsPassed: z.boolean(),
        reviewStatus: z.enum(["passed", "changes_requested"]).nullable(),
        correctionCycleCount: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();

export function registerVersionedLearningRoutes(
  app: Hono,
  state: VersionedLearningState,
): void {
  app.get("/api/learning/path", async (context) => {
    const active = state.connection.sqlite
      .prepare(
        `SELECT c.id, c.slug, c.title, c.description, c.active_version_id
         FROM curricula c
         JOIN curriculum_versions v ON v.id = c.active_version_id
         WHERE v.status = 'published'
         ORDER BY c.updated_at DESC, c.id
         LIMIT 1`,
      )
      .get() as
      | {
          id: string;
          slug: string;
          title: string;
          description: string | null;
          active_version_id: string;
        }
      | undefined;
    if (!active) return context.json({ curriculum: null });

    const authoring = new CurriculumAuthoringRepository(state.connection);
    const graph = await authoring.getVersionGraph(active.active_version_id);
    const latestSessions = latestSessionsByDay(state.connection);
    const completedDayIds = completedVersionedDayIds(state.connection);
    const current = await state.repository.getCurrentVersionedSession();
    const orderedDayIds = graph.weeks.flatMap((week) =>
      week.days.map((day) => day.id),
    );

    return context.json({
      curriculum: {
        id: active.id,
        slug: active.slug,
        title: active.title,
        description: active.description,
        version: {
          id: graph.version.id,
          revision: graph.version.revision,
          contentHash: graph.version.contentHash,
          status: graph.version.status,
        },
        weeks: graph.weeks.map((week) => ({
          id: week.id,
          stableId: week.stableId,
          order: week.orderIndex + 1,
          title: week.title,
          description: week.description,
          days: week.days.map((day) => {
            const units = day.units.map((unit) =>
              CurriculumUnitSchema.parse({
                id: unit.id,
                stableId: unit.stableId,
                type: unit.type,
                order: unit.orderIndex + 1,
                title: unit.title,
                description: unit.description ?? unit.title,
                estimatedMinutes: unit.estimatedMinutes ?? 0,
                objectives: unit.objectives,
                checklist: unit.checklist,
                sources: unit.sources,
                questions: unit.questions,
                misconceptions: unit.misconceptions,
                referenceAnswer: unit.referenceAnswer,
                completionCriteria: unit.completionCriteria,
                unlockRules: unit.unlockRules,
                optional: unit.optional,
                depthLevel: unit.depthLevel ?? "foundation",
                payload: unit.payload,
              }),
            );
            const session = latestSessions.get(day.id);
            const dayIndex = orderedDayIds.indexOf(day.id);
            const precedingDaysCompleted = orderedDayIds
              .slice(0, dayIndex)
              .every((dayId) => completedDayIds.has(dayId));
            const dayStatus = completedDayIds.has(day.id)
              ? "completed"
              : current?.snapshot.day.id === day.id
                ? "in_progress"
                : dayIndex === 0 || precedingDaysCompleted
                  ? "available"
                  : "locked";
            const sessionProgress =
              current?.snapshot.day.id === day.id
                ? new Map(
                    current.unitProgress.map((item) => [item.unitId, item]),
                  )
                : null;
            const initial = new Map(
              createUnitProgression(toDefinitions(units)).map((item) => [
                item.unitId,
                item.status,
              ]),
            );
            return {
              id: day.id,
              stableId: day.stableId,
              order: day.orderIndex + 1,
              title: day.title,
              description: day.description,
              goal: day.goal,
              estimatedMinutes: day.estimatedMinutes,
              prerequisites: day.prerequisites,
              expectedOutcomes: day.expectedOutcomes,
              depthLevel: day.depthLevel,
              outOfScope: day.outOfScope,
              topics: day.topics,
              status: dayStatus,
              sessionId: session?.id ?? null,
              units: units.map((unit) => ({
                ...toLearnerUnit(unit),
                status:
                  session?.status === "completed"
                    ? unit.optional
                      ? "skipped"
                      : "completed"
                    : (sessionProgress?.get(unit.id)?.status ??
                      initial.get(unit.id) ??
                      "locked"),
              })),
            };
          }),
        })),
      },
    });
  });

  app.get("/api/learning/sessions/current", async (context) => {
    const current = await state.repository.getCurrentVersionedSession();
    return context.json({
      session: current ? toLearnerSession(current) : null,
    });
  });

  app.post("/api/learning/sessions/v2", async (context) => {
    const body = startSessionSchema.parse(await context.req.json());
    const current = await state.repository.getCurrentVersionedSession();
    if (current?.snapshot.day.id === body.dayId) {
      return context.json({ session: toLearnerSession(current) }, 201);
    }
    assertDayCanStart(state.connection, body.dayId);
    const detail = await state.repository.startOrResumeVersionedSession({
      dayId: body.dayId,
      idempotencyKey: body.operationId
        ? `learning-v2:${body.operationId}`
        : `learning-v2:day:${body.dayId}:active`,
    });
    return context.json({ session: toLearnerSession(detail) }, 201);
  });

  app.get("/api/learning/sessions/v2/:id", async (context) => {
    const detail = await state.repository.getVersionedSession(
      context.req.param("id"),
    );
    return context.json({ session: toLearnerSession(detail) });
  });

  app.post(
    "/api/learning/sessions/v2/:id/units/:unitId/recall-attempts",
    async (context) => {
      const body = recallAttemptSchema.parse(await context.req.json());
      const sessionId = context.req.param("id");
      const unitId = context.req.param("unitId");
      requireEvidenceTarget(
        await state.repository.getVersionedSession(sessionId),
        unitId,
        "recall",
      );
      const recorded = await state.repository.recordVersionedUnitEvidence({
        sessionId,
        unitId,
        evidenceType: "recall-attempt",
        operationId: body.operationId,
        payload: { answer: body.answer },
      });
      const attempts = await state.repository.listVersionedUnitEvidence(
        sessionId,
        { unitId, evidenceType: "recall-attempt" },
      );
      const first = attempts[0];
      if (!first) throw new Error("Persisted recall attempt disappeared");
      const firstAnswer = evidenceString(first.payload, "answer");
      await state.repository.updateUnitProgress({
        sessionId,
        unitId,
        status: "in_progress",
        progress: {
          type: "recall",
          firstAttemptId: first.id,
          draft: firstAnswer,
        },
      });
      return context.json(
        {
          evidence: {
            id: recorded.id,
            isFirstAttempt: recorded.id === first.id,
          },
          session: toLearnerSession(
            await state.repository.getVersionedSession(sessionId),
          ),
        },
        201,
      );
    },
  );

  app.post(
    "/api/learning/sessions/v2/:id/units/:unitId/quiz-attempts",
    async (context) => {
      const body = quizAttemptSchema.parse(await context.req.json());
      const sessionId = context.req.param("id");
      const unitId = context.req.param("unitId");
      requireEvidenceTarget(
        await state.repository.getVersionedSession(sessionId),
        unitId,
        "quiz",
      );
      const privateUnit = requirePrivateUnit(
        readPrivateSnapshot(state.connection, sessionId),
        unitId,
        "quiz",
      );
      const submitted = [];
      for (const answer of body.answers) {
        const question = privateUnit.questions.find(
          (candidate) => candidate.id === answer.questionId,
        );
        if (!question) throw new Error("Unknown quiz question");
        if (
          !question.options.some(
            (option) => option.id === answer.selectedOptionId,
          )
        ) {
          throw new Error("Unknown public quiz option");
        }
        const correct = question.correctOptionIds.includes(
          answer.selectedOptionId,
        );
        const evidence = await state.repository.recordVersionedUnitEvidence({
          sessionId,
          unitId,
          evidenceType: "quiz-answer",
          operationId: quizAnswerOperationId(
            body.operationId,
            answer.questionId,
          ),
          questionId: answer.questionId,
          payload: { selectedOptionId: answer.selectedOptionId },
          correctness: correct ? 1 : 0,
        });
        submitted.push({
          questionId: answer.questionId,
          correct,
          evidenceId: evidence.id,
        });
      }
      const evidence = await state.repository.listVersionedUnitEvidence(
        sessionId,
        { unitId, evidenceType: "quiz-answer" },
      );
      const latestByQuestion = new Map(
        evidence
          .filter((item) => item.questionId !== null)
          .map((item) => [item.questionId!, item]),
      );
      const attemptedQuestionIds = [...latestByQuestion.keys()];
      const correctQuestionIds = attemptedQuestionIds.filter(
        (questionId) => latestByQuestion.get(questionId)?.correctness === 1,
      );
      const score =
        attemptedQuestionIds.length === 0
          ? null
          : correctQuestionIds.length / attemptedQuestionIds.length;
      await state.repository.updateUnitProgress({
        sessionId,
        unitId,
        status: "in_progress",
        progress: {
          type: "quiz",
          attemptedQuestionIds,
          correctQuestionIds,
          score,
        },
      });
      return context.json(
        {
          attempt: {
            operationId: body.operationId,
            score,
            results: submitted.map(({ questionId, correct }) => ({
              questionId,
              correct,
            })),
          },
          session: toLearnerSession(
            await state.repository.getVersionedSession(sessionId),
          ),
        },
        201,
      );
    },
  );

  app.post(
    "/api/learning/sessions/v2/:id/units/:unitId/code-reading-attempts",
    async (context) => {
      const body = codeReadingAttemptSchema.parse(await context.req.json());
      const sessionId = context.req.param("id");
      const unitId = context.req.param("unitId");
      requireEvidenceTarget(
        await state.repository.getVersionedSession(sessionId),
        unitId,
        "code-reading",
      );
      const evidence = await state.repository.recordVersionedUnitEvidence({
        sessionId,
        unitId,
        evidenceType: "code-reading-attempt",
        operationId: body.operationId,
        payload: {
          prediction: body.prediction,
          explanation: body.explanation,
          verbalFix: body.verbalFix,
        },
      });
      await state.repository.updateUnitProgress({
        sessionId,
        unitId,
        status: "in_progress",
        progress: {
          type: "code-reading",
          prediction: body.prediction,
          explanation: body.explanation,
          verbalFix: body.verbalFix,
        },
      });
      return context.json(
        {
          evidence: { id: evidence.id },
          session: toLearnerSession(
            await state.repository.getVersionedSession(sessionId),
          ),
        },
        201,
      );
    },
  );

  app.get(
    "/api/learning/sessions/v2/:id/units/:unitId/summary",
    async (context) => {
      const sessionId = context.req.param("id");
      const unitId = context.req.param("unitId");
      const detail = await state.repository.getVersionedSession(sessionId);
      const persisted = readPersistedSummary(state.connection, detail, unitId);
      return context.json({
        summary: persisted.summary,
        evidence: { id: persisted.evidenceId },
        session: toLearnerSession(detail),
      });
    },
  );

  app.post(
    "/api/learning/sessions/v2/:id/units/:unitId/summary",
    async (context) => {
      const body = summaryRequestSchema.parse(await context.req.json());
      const sessionId = context.req.param("id");
      const unitId = context.req.param("unitId");
      const detail = await state.repository.getVersionedSession(sessionId);
      requireCurrentSummaryTarget(detail, unitId);

      const operationId = summaryOperationId(body.operationId);
      const existing = state.connection.sqlite
        .prepare(
          `SELECT id, session_id, unit_id, payload_json
           FROM versioned_unit_evidence
           WHERE operation_id = ? AND evidence_type = 'summary'`,
        )
        .get(operationId) as
        | {
            id: string;
            session_id: string;
            unit_id: string;
            payload_json: string;
          }
        | undefined;

      let summary: DaySummary;
      let evidenceId: string;
      if (existing) {
        if (existing.session_id !== sessionId || existing.unit_id !== unitId) {
          throw new Error(
            "Operation ID is already associated with a different summary",
          );
        }
        summary = parsePersistedSummary(existing.payload_json);
        evidenceId = existing.id;
      } else {
        const topicIds = ensureSnapshotTopics(
          state.connection,
          detail.snapshot.day.topics,
        );
        summary = await derivePersistedDaySummary(
          state.connection,
          state.repository,
          detail,
          topicIds,
        );
        const evidence = await state.repository.recordVersionedUnitEvidence({
          sessionId,
          unitId,
          evidenceType: "summary",
          operationId,
          payload: { summary },
        });
        evidenceId = evidence.id;
      }

      persistSummaryArtifacts(
        state.connection,
        detail,
        unitId,
        evidenceId,
        summary,
      );
      return context.json(
        {
          summary,
          evidence: { id: evidenceId },
          session: toLearnerSession(
            await state.repository.getVersionedSession(sessionId),
          ),
        },
        201,
      );
    },
  );

  app.patch("/api/learning/sessions/v2/:id/units/:unitId", async (context) => {
    const body = updateUnitSchema.parse(await context.req.json());
    const sessionId = context.req.param("id");
    const unitId = context.req.param("unitId");
    const detail = await state.repository.getVersionedSession(sessionId);
    if (detail.session.status !== "active") {
      throw new Error("Only an active session can change unit progress");
    }
    const unit = detail.snapshot.units.find(
      (candidate) => candidate.id === unitId,
    );
    const current = detail.unitProgress.find(
      (candidate) => candidate.unitId === unitId,
    );
    if (!unit || !current) throw new Error("Unknown session unit");
    if (body.payload && body.payload.type !== unit.type) {
      throw new Error("Unit progress payload type must match its unit type");
    }
    const payload = isServerOwnedEvidenceUnit(unit.type)
      ? current.payload
      : (body.payload ?? current.payload);

    if (body.status === current.status) {
      if (current.status === "completed") {
        await assertCompletionCriteria(
          state.connection,
          state.repository,
          sessionId,
          unit,
          payload,
          detail.unitProgress,
          detail.snapshot.units,
        );
      }
      await state.repository.updateUnitProgress({
        sessionId,
        unitId,
        status: current.status,
        progress: payload,
      });
      const unchanged = await state.repository.getVersionedSession(sessionId);
      return context.json({ session: toLearnerSession(unchanged) });
    }

    const event = transitionEvent(current.status, body.status, unitId);
    if (!event) throw new Error("Unit transition is not allowed");
    if (event.type === "complete") {
      await assertCompletionCriteria(
        state.connection,
        state.repository,
        sessionId,
        unit,
        payload,
        detail.unitProgress,
        detail.snapshot.units,
      );
    }
    const definitions = toDefinitions(detail.snapshot.units);
    const transition = transitionUnitProgression(
      definitions,
      detail.unitProgress.map((item) => ({
        unitId: item.unitId,
        status: item.status,
      })),
      event,
    );
    if (!transition.valid) {
      throw new Error(`Unit transition rejected: ${transition.reason}`);
    }

    const lessonComplete = isLessonComplete(definitions, transition.progress);
    persistTransition(
      state.connection,
      detail,
      transition.progress,
      unitId,
      payload,
      lessonComplete,
    );
    const updated = await state.repository.getVersionedSession(sessionId);
    return context.json({ session: toLearnerSession(updated) });
  });
}

function requireCurrentSummaryTarget(
  detail: VersionedSessionDetail,
  unitId: string,
): CurriculumUnit {
  if (detail.session.status !== "active") {
    throw new Error("Summary requires an active learning session");
  }
  const unit = detail.snapshot.units.find(
    (candidate) => candidate.id === unitId,
  );
  const progress = detail.unitProgress.find(
    (candidate) => candidate.unitId === unitId,
  );
  if (!unit || !progress) throw new Error("Unknown session unit");
  if (unit.type !== "summary") {
    throw new Error("This endpoint requires a summary unit");
  }
  if (
    progress.status !== "in_progress" ||
    detail.session.currentStep !== unit.stableId
  ) {
    throw new Error("Summary requires the current in-progress unit");
  }
  return unit;
}

function readPersistedSummary(
  connection: DatabaseConnection,
  detail: VersionedSessionDetail,
  unitId: string,
): { summary: DaySummary; evidenceId: string } {
  const unit = detail.snapshot.units.find(
    (candidate) => candidate.id === unitId,
  );
  const progress = detail.unitProgress.find(
    (candidate) => candidate.unitId === unitId,
  );
  if (!unit || !progress) throw new Error("Unknown session unit");
  if (unit.type !== "summary" || progress.payload.type !== "summary") {
    throw new Error("This endpoint requires a summary unit");
  }
  if (
    progress.status !== "completed" &&
    !(
      progress.status === "in_progress" &&
      detail.session.status === "active" &&
      detail.session.currentStep === unit.stableId
    )
  ) {
    throw new Error("Persisted summary is not available for this unit state");
  }
  if (!progress.payload.summaryId) {
    throw new Error("Summary not found for this session unit");
  }
  const evidence = connection.sqlite
    .prepare(
      `SELECT id, payload_json FROM versioned_unit_evidence
       WHERE id = ? AND session_id = ? AND unit_id = ?
         AND evidence_type = 'summary'`,
    )
    .get(progress.payload.summaryId, detail.session.id, unitId) as
    { id: string; payload_json: string } | undefined;
  if (!evidence) {
    throw new Error("Summary evidence not found for this session unit");
  }
  return {
    summary: parsePersistedSummary(evidence.payload_json),
    evidenceId: evidence.id,
  };
}

function summaryOperationId(operationId: string): string {
  return `summary:${createHash("sha256").update(operationId).digest("hex")}`;
}

function parsePersistedSummary(payloadJson: string): DaySummary {
  const payload = z
    .object({ summary: daySummarySchema })
    .strict()
    .parse(JSON.parse(payloadJson));
  return payload.summary as DaySummary;
}

function ensureSnapshotTopics(
  connection: DatabaseConnection,
  titles: readonly string[],
): string[] {
  const now = Date.now();
  const result: string[] = [];
  connection.sqlite.exec("BEGIN IMMEDIATE");
  try {
    for (const exactTitle of [...new Set(titles)].sort((left, right) =>
      left.localeCompare(right, "ru"),
    )) {
      const existing = connection.sqlite
        .prepare("SELECT id FROM topics WHERE title = ? ORDER BY id LIMIT 1")
        .get(exactTitle) as { id: string } | undefined;
      if (existing) {
        result.push(existing.id);
        continue;
      }
      const digest = createHash("sha256").update(exactTitle).digest("hex");
      const id = `topic-v2-${digest.slice(0, 24)}`;
      const slug = `topic-v2-${digest}`;
      connection.sqlite
        .prepare(
          `INSERT OR IGNORE INTO topics
           (id, slug, title, description, created_at, updated_at)
           VALUES (?, ?, ?, NULL, ?, ?)`,
        )
        .run(id, slug, exactTitle, now, now);
      const persisted = connection.sqlite
        .prepare("SELECT id FROM topics WHERE title = ? ORDER BY id LIMIT 1")
        .get(exactTitle) as { id: string } | undefined;
      if (!persisted) throw new Error("Snapshot topic could not be persisted");
      result.push(persisted.id);
    }
    connection.sqlite.exec("COMMIT");
    return result;
  } catch (error) {
    connection.sqlite.exec("ROLLBACK");
    throw error;
  }
}

async function derivePersistedDaySummary(
  connection: DatabaseConnection,
  repository: LearningRepository,
  detail: VersionedSessionDetail,
  topicIds: readonly string[],
): Promise<DaySummary> {
  const allEvidence = await repository.listVersionedUnitEvidence(
    detail.session.id,
  );
  const recallAttempted = allEvidence.some(
    (item) => item.evidenceType === "recall-attempt",
  );
  const codeReadingAttempted = allEvidence.some(
    (item) => item.evidenceType === "code-reading-attempt",
  );
  const teacherRevision = detail.unitProgress.some(
    (item) =>
      item.payload.type === "teacher-dialogue" &&
      item.payload.revisionAttemptIds.length > 0,
  );
  const quiz = detail.unitProgress.find((item) => item.payload.type === "quiz");
  if (quiz?.payload.type !== "quiz" || quiz.payload.score === null) {
    throw new Error("Summary requires persisted quiz progress with a score");
  }
  const correctQuestionIds = new Set(quiz.payload.correctQuestionIds);
  const incorrectQuestionIds = quiz.payload.attemptedQuestionIds.filter(
    (questionId) => !correctQuestionIds.has(questionId),
  );
  const exerciseProgress = detail.unitProgress.find(
    (item) => item.payload.type === "exercise" && item.payload.attemptId,
  );
  const attemptId =
    exerciseProgress?.payload.type === "exercise"
      ? exerciseProgress.payload.attemptId
      : null;
  const test = attemptId ? latestTestRun(connection, attemptId) : null;
  const review = connection.sqlite
    .prepare(
      `SELECT status FROM reviews
       WHERE session_id = ?
         AND (? IS NULL OR exercise_attempt_id = ?)
       ORDER BY created_at DESC, rowid DESC LIMIT 1`,
    )
    .get(detail.session.id, attemptId, attemptId) as
    { status: string } | undefined;
  const reviewStatus =
    review?.status === "passed" || review?.status === "changes_requested"
      ? review.status
      : null;
  const correctionRow = connection.sqlite
    .prepare(
      `SELECT count(*) AS count FROM reviews
       WHERE session_id = ? AND status = 'changes_requested'
         AND (? IS NULL OR exercise_attempt_id = ?)`,
    )
    .get(detail.session.id, attemptId, attemptId) as { count: number };
  const hintRow = connection.sqlite
    .prepare(
      "SELECT COALESCE(MAX(level), 0) AS level FROM hint_usages_v2 WHERE session_id = ?",
    )
    .get(detail.session.id) as { level: number };

  return deriveDaySummary({
    sessionId: detail.session.id,
    occurredAt: new Date().toISOString(),
    topicIds,
    maxHintLevel: hintRow.level as HintLevel,
    recallAttempted,
    teacherRevision,
    quizScore: quiz.payload.score,
    incorrectQuestionIds,
    codeReadingAttempted,
    exerciseTestsPassed: test?.status === "passed",
    reviewStatus,
    correctionCycleCount: correctionRow.count,
  });
}

function persistSummaryArtifacts(
  connection: DatabaseConnection,
  detail: VersionedSessionDetail,
  unitId: string,
  summaryEvidenceId: string,
  summary: DaySummary,
): void {
  const observedAt = Date.parse(summary.occurredAt);
  const topicIds = [
    ...new Set(summary.masteryEvidence.map((item) => item.topicId)),
  ];
  const primaryTopicId = topicIds[0];
  if (!primaryTopicId) {
    throw new Error("Summary requires at least one persisted topic");
  }

  connection.sqlite.exec("BEGIN IMMEDIATE");
  try {
    for (const topicId of topicIds) {
      let profile = reconstructMasteryProfile(connection, topicId);
      const evidence = summary.masteryEvidence
        .filter((item) => item.topicId === topicId)
        .sort(
          (left, right) =>
            Date.parse(left.occurredAt) - Date.parse(right.occurredAt) ||
            left.id.localeCompare(right.id),
        );
      for (const item of evidence) {
        const sourceId = `${summaryEvidenceId}:${item.id}`;
        const exists = connection.sqlite
          .prepare(
            `SELECT 1 FROM mastery_evidence
             WHERE session_id = ? AND topic_id = ? AND dimension = ?
               AND evidence_type = ? AND source_id = ?`,
          )
          .get(detail.session.id, topicId, item.dimension, item.type, sourceId);
        if (exists) continue;

        const before = profile[item.dimension].score;
        profile = applyMasteryEvidenceBatch(profile, [item]);
        const state = profile[item.dimension];
        const currentScore = readMasteryScore(
          connection,
          topicId,
          item.dimension,
        );
        const evidenceCount = (currentScore?.evidenceCount ?? 0) + 1;
        connection.sqlite
          .prepare(
            `INSERT INTO mastery_evidence
             (id, session_id, topic_id, dimension, evidence_type, source_id,
              delta, score_after, observed_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            deterministicId("mastery-evidence", sourceId),
            detail.session.id,
            topicId,
            item.dimension,
            item.type,
            sourceId,
            Math.round((state.score - before) * 100),
            Math.round(state.score * 100),
            Date.parse(item.occurredAt),
          );
        connection.sqlite
          .prepare(
            `INSERT INTO mastery_scores
             (id, topic_id, dimension, score, confidence, evidence_count,
              evidence_types_json, last_evidence_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(topic_id, dimension) DO UPDATE SET
               score = excluded.score,
               confidence = excluded.confidence,
               evidence_count = excluded.evidence_count,
               evidence_types_json = excluded.evidence_types_json,
               last_evidence_at = excluded.last_evidence_at,
               updated_at = excluded.updated_at`,
          )
          .run(
            deterministicId("mastery-score", `${topicId}:${item.dimension}`),
            topicId,
            item.dimension,
            Math.round(state.score * 100),
            Math.min(100, evidenceCount * 15),
            evidenceCount,
            JSON.stringify(state.successfulEvidenceTypes),
            state.lastEvidenceAt ? Date.parse(state.lastEvidenceAt) : null,
            observedAt,
          );
      }
    }

    const mistakeIds = new Map<string, string>();
    for (const candidate of summary.mistakeCandidates) {
      const existing = connection.sqlite
        .prepare(
          `SELECT id, source_id FROM mistakes
           WHERE fingerprint = ? ORDER BY first_seen_at, id LIMIT 1`,
        )
        .get(candidate.fingerprint) as
        { id: string; source_id: string } | undefined;
      if (!existing) {
        const id = deterministicId("mistake", candidate.fingerprint);
        connection.sqlite
          .prepare(
            `INSERT INTO mistakes
             (id, session_id, topic_id, source_type, source_id, summary,
              correction, fingerprint, occurrence_count, first_seen_at,
              last_seen_at, resolved_at)
             VALUES (?, ?, ?, 'summary', ?, ?, ?, ?, 1, ?, ?, NULL)`,
          )
          .run(
            id,
            detail.session.id,
            primaryTopicId,
            summaryEvidenceId,
            candidate.summary,
            candidate.correction,
            candidate.fingerprint,
            observedAt,
            observedAt,
          );
        mistakeIds.set(candidate.fingerprint, id);
      } else {
        if (existing.source_id !== summaryEvidenceId) {
          connection.sqlite
            .prepare(
              `UPDATE mistakes SET occurrence_count = occurrence_count + 1,
               source_type = 'summary', source_id = ?, summary = ?,
               correction = ?, last_seen_at = ?, resolved_at = NULL
               WHERE id = ?`,
            )
            .run(
              summaryEvidenceId,
              candidate.summary,
              candidate.correction,
              observedAt,
              existing.id,
            );
        }
        mistakeIds.set(candidate.fingerprint, existing.id);
      }
    }

    for (const card of summary.flashcardCandidates) {
      const key = `summary:${summaryEvidenceId}:${createHash("sha256")
        .update(`${card.front}\0${card.back}`)
        .digest("hex")}`;
      connection.sqlite
        .prepare(
          `INSERT OR IGNORE INTO flashcards
           (id, topic_id, source_mistake_id, front, back, status, due_at,
            interval_days, ease_factor, review_count, idempotency_key,
            created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'candidate', NULL, 0, 250, 0, ?, ?, ?)`,
        )
        .run(
          deterministicId("flashcard", key),
          primaryTopicId,
          card.sourceFingerprint
            ? (mistakeIds.get(card.sourceFingerprint) ?? null)
            : null,
          card.front,
          card.back,
          key,
          observedAt,
          observedAt,
        );
    }

    const progressResult = connection.sqlite
      .prepare(
        `UPDATE unit_progress SET progress_json = ?, updated_at = ?
         WHERE session_id = ? AND unit_id = ? AND unit_type = 'summary'
           AND status = 'in_progress'
           AND EXISTS (
             SELECT 1 FROM learning_sessions session
             WHERE session.id = unit_progress.session_id
               AND session.status = 'active'
           )`,
      )
      .run(
        JSON.stringify({ type: "summary", summaryId: summaryEvidenceId }),
        observedAt,
        detail.session.id,
        unitId,
      );
    if (progressResult.changes !== 1) {
      throw new Error("Summary progress could not be persisted");
    }
    connection.sqlite.exec("COMMIT");
  } catch (error) {
    connection.sqlite.exec("ROLLBACK");
    throw error;
  }
}

function reconstructMasteryProfile(
  connection: DatabaseConnection,
  topicId: string,
): MasteryProfile {
  let profile = createEmptyMasteryProfile();
  const rows = connection.sqlite
    .prepare(
      `SELECT dimension, score, evidence_types_json AS evidenceTypesJson,
              last_evidence_at AS lastEvidenceAt
       FROM mastery_scores WHERE topic_id = ?`,
    )
    .all(topicId) as Array<{
    dimension: MasteryDimension;
    score: number;
    evidenceTypesJson: string;
    lastEvidenceAt: number | null;
  }>;
  for (const row of rows) {
    if (!(row.dimension in profile)) continue;
    const evidenceTypes = z
      .array(
        z.enum([
          "recall",
          "explanation",
          "code_reading",
          "implementation",
          "debugging",
          "interview",
        ]),
      )
      .parse(JSON.parse(row.evidenceTypesJson)) as EvidenceType[];
    const lastEvidenceAt =
      row.lastEvidenceAt === null
        ? null
        : new Date(row.lastEvidenceAt).toISOString();
    profile = {
      ...profile,
      [row.dimension]: {
        score: Math.max(0, Math.min(5, row.score / 100)),
        successfulEvidenceTypes: evidenceTypes,
        successfulEvidenceDays:
          evidenceTypes.length > 0 && lastEvidenceAt
            ? [lastEvidenceAt.slice(0, 10)]
            : [],
        errorOccurrences: {},
        lastEvidenceAt,
      },
    };
  }
  return profile;
}

function readMasteryScore(
  connection: DatabaseConnection,
  topicId: string,
  dimension: MasteryDimension,
): { evidenceCount: number } | null {
  return (
    (connection.sqlite
      .prepare(
        `SELECT evidence_count AS evidenceCount FROM mastery_scores
         WHERE topic_id = ? AND dimension = ?`,
      )
      .get(topicId, dimension) as { evidenceCount: number } | undefined) ?? null
  );
}

function deterministicId(namespace: string, value: string): string {
  return `${namespace}-${createHash("sha256")
    .update(`${namespace}\0${value}`)
    .digest("hex")
    .slice(0, 32)}`;
}

function assertPersistedSummaryEvidence(
  connection: DatabaseConnection,
  sessionId: string,
  unitId: string,
  payload: UnitProgressPayload,
): void {
  if (payload.type !== "summary" || !payload.summaryId) {
    throw new Error("Summary completion requires persisted summary evidence");
  }
  const evidence = connection.sqlite
    .prepare(
      `SELECT 1 FROM versioned_unit_evidence
       WHERE id = ? AND session_id = ? AND unit_id = ?
         AND evidence_type = 'summary'`,
    )
    .get(payload.summaryId, sessionId, unitId);
  if (!evidence) {
    throw new Error("Summary ID does not match persisted session evidence");
  }
}

function requireEvidenceTarget(
  detail: VersionedSessionDetail,
  unitId: string,
  expectedType: "recall" | "quiz" | "code-reading",
): CurriculumUnit {
  if (detail.session.status !== "active") {
    throw new Error("New unit evidence requires an active session");
  }
  const unit = detail.snapshot.units.find(
    (candidate) => candidate.id === unitId,
  );
  const progress = detail.unitProgress.find(
    (candidate) => candidate.unitId === unitId,
  );
  if (!unit || !progress) throw new Error("Unknown session unit");
  if (unit.type !== expectedType) {
    throw new Error(`This evidence endpoint requires a ${expectedType} unit`);
  }
  if (
    progress.status !== "in_progress" ||
    detail.session.currentStep !== unit.stableId
  ) {
    throw new Error("New unit evidence requires the current in-progress unit");
  }
  return unit;
}

function readPrivateSnapshot(
  connection: DatabaseConnection,
  sessionId: string,
): SessionSnapshot {
  const row = connection.sqlite
    .prepare("SELECT snapshot_json FROM session_snapshots WHERE session_id = ?")
    .get(sessionId) as { snapshot_json: string } | undefined;
  if (!row) throw new Error("Unknown versioned session snapshot");
  return SessionSnapshotSchema.parse(JSON.parse(row.snapshot_json));
}

function requirePrivateUnit(
  snapshot: SessionSnapshot,
  unitId: string,
  expectedType: CurriculumUnit["type"],
): CurriculumUnit {
  const unit = snapshot.units.find((candidate) => candidate.id === unitId);
  if (!unit) throw new Error("Unknown private snapshot unit");
  if (unit.type !== expectedType) {
    throw new Error(`Snapshot unit type must be ${expectedType}`);
  }
  return unit;
}

function quizAnswerOperationId(
  operationId: string,
  questionId: string,
): string {
  return `quiz-answer:${createHash("sha256")
    .update(`${operationId}\0${questionId}`)
    .digest("hex")}`;
}

function evidenceString(payload: unknown, key: string): string {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Persisted evidence payload must be an object");
  }
  const value = (payload as Record<string, unknown>)[key];
  if (typeof value !== "string") {
    throw new Error(`Persisted evidence field ${key} must be a string`);
  }
  return value;
}

function completedVersionedDayIds(connection: DatabaseConnection): Set<string> {
  const rows = connection.sqlite
    .prepare(
      `SELECT DISTINCT curriculum_day_v2_id AS day_id
       FROM learning_sessions
       WHERE curriculum_day_v2_id IS NOT NULL AND status = 'completed'`,
    )
    .all() as Array<{ day_id: string }>;
  return new Set(rows.map((row) => row.day_id));
}

function assertDayCanStart(
  connection: DatabaseConnection,
  dayId: string,
): void {
  const day = connection.sqlite
    .prepare(
      `SELECT d.version_id, d.order_index AS day_order,
              w.order_index AS week_order
       FROM curriculum_days_v2 d
       JOIN curriculum_weeks w ON w.id = d.week_id
       JOIN curriculum_versions v ON v.id = d.version_id
       JOIN curricula c ON c.id = v.curriculum_id
       WHERE d.id = ? AND v.status = 'published'
         AND c.active_version_id = v.id`,
    )
    .get(dayId) as
    { version_id: string; day_order: number; week_order: number } | undefined;
  if (!day) {
    throw new Error(`Unknown active published curriculum day: ${dayId}`);
  }

  const incompletePredecessor = connection.sqlite
    .prepare(
      `SELECT previous.id
       FROM curriculum_days_v2 previous
       JOIN curriculum_weeks previous_week ON previous_week.id = previous.week_id
       WHERE previous.version_id = ?
         AND (previous_week.order_index < ? OR
              (previous_week.order_index = ? AND previous.order_index < ?))
         AND NOT EXISTS (
           SELECT 1 FROM learning_sessions session
           WHERE session.curriculum_day_v2_id = previous.id
             AND session.status = 'completed'
         )
       ORDER BY previous_week.order_index, previous.order_index
       LIMIT 1`,
    )
    .get(day.version_id, day.week_order, day.week_order, day.day_order) as
    { id: string } | undefined;
  if (incompletePredecessor) {
    throw new Error(
      "Learning day is locked until preceding days are completed",
    );
  }
}

function persistTransition(
  connection: DatabaseConnection,
  detail: VersionedSessionDetail,
  nextProgress: readonly { unitId: string; status: UnitStatus }[],
  changedUnitId: string,
  changedPayload: UnitProgressPayload,
  lessonComplete: boolean,
): void {
  const now = Date.now();
  connection.sqlite.exec("BEGIN IMMEDIATE");
  try {
    const updateProgress = connection.sqlite.prepare(
      `UPDATE unit_progress
       SET status = ?, progress_json = ?,
           started_at = CASE WHEN ? = 'in_progress'
             THEN COALESCE(started_at, ?) ELSE started_at END,
           completed_at = CASE WHEN ? = 'completed' THEN ? ELSE completed_at END,
           skipped_at = CASE WHEN ? = 'skipped' THEN ? ELSE skipped_at END,
           updated_at = ?
       WHERE session_id = ? AND unit_id = ?
         AND EXISTS (
           SELECT 1 FROM learning_sessions session
           WHERE session.id = unit_progress.session_id
             AND session.status = 'active'
         )`,
    );
    for (const next of nextProgress) {
      const previous = detail.unitProgress.find(
        (item) => item.unitId === next.unitId,
      );
      if (!previous) throw new Error("Session unit progress is incomplete");
      if (previous.status === next.status) continue;
      const progressPayload =
        next.unitId === changedUnitId ? changedPayload : previous.payload;
      const result = updateProgress.run(
        next.status,
        JSON.stringify(progressPayload),
        next.status,
        now,
        next.status,
        now,
        next.status,
        now,
        now,
        detail.session.id,
        next.unitId,
      );
      if (result.changes !== 1) {
        throw new Error("Versioned unit transition could not be persisted");
      }
    }

    if (!lessonComplete) {
      const currentProgress =
        nextProgress.find((item) => item.status === "in_progress") ??
        nextProgress.find((item) => item.status === "ready");
      const currentUnit = detail.snapshot.units.find(
        (unit) => unit.id === currentProgress?.unitId,
      );
      if (!currentUnit) {
        throw new Error("Current unit is missing from the snapshot");
      }
      const result = connection.sqlite
        .prepare(
          `UPDATE learning_sessions
           SET current_step = ?, updated_at = ?
           WHERE id = ? AND status = 'active'`,
        )
        .run(currentUnit.stableId, now, detail.session.id);
      if (result.changes !== 1) {
        throw new Error("Active versioned session could not be advanced");
      }
    } else {
      const result = connection.sqlite
        .prepare(
          `UPDATE learning_sessions
         SET status = 'completed', current_step = 'complete',
             completed_at = ?, updated_at = ?
         WHERE id = ? AND status = 'active'
           AND curriculum_day_v2_id IS NOT NULL`,
        )
        .run(now, now, detail.session.id);
      if (result.changes !== 1) {
        throw new Error("Only an active versioned session can be completed");
      }
      connection.sqlite
        .prepare(
          `UPDATE learner_state
           SET current_learning_session_id = NULL, updated_at = ?
           WHERE id = 'default' AND current_learning_session_id = ?`,
        )
        .run(now, detail.session.id);
    }
    connection.sqlite.exec("COMMIT");
  } catch (error) {
    connection.sqlite.exec("ROLLBACK");
    throw error;
  }
}

function latestSessionsByDay(
  connection: DatabaseConnection,
): Map<string, { id: string; status: string }> {
  const rows = connection.sqlite
    .prepare(
      `SELECT curriculum_day_v2_id AS day_id, id, status
       FROM learning_sessions
       WHERE curriculum_day_v2_id IS NOT NULL
       ORDER BY updated_at DESC`,
    )
    .all() as Array<{ day_id: string; id: string; status: string }>;
  const result = new Map<string, { id: string; status: string }>();
  for (const row of rows) {
    if (!result.has(row.day_id)) {
      result.set(row.day_id, { id: row.id, status: row.status });
    }
  }
  return result;
}

function toDefinitions(units: readonly CurriculumUnit[]): UnitDefinition[] {
  const idByStableId = new Map(units.map((unit) => [unit.stableId, unit.id]));
  return units.map((unit) => ({
    id: unit.id,
    optional: unit.optional,
    ...(unit.unlockRules.length
      ? {
          prerequisiteUnitIds: unit.unlockRules.map((rule) => {
            const id = idByStableId.get(rule.unitId);
            if (!id) throw new Error(`Unknown unlock unit: ${rule.unitId}`);
            return id;
          }),
        }
      : {}),
  }));
}

function transitionEvent(
  current: UnitStatus,
  target: Exclude<UnitStatus, "locked">,
  unitId: string,
): UnitProgressionEvent | null {
  if (current === "ready" && target === "in_progress") {
    return { type: "start", unitId };
  }
  if (current === "in_progress" && target === "ready") {
    return { type: "pause", unitId };
  }
  if (current === "in_progress" && target === "completed") {
    return { type: "complete", unitId };
  }
  if (
    (current === "ready" || current === "in_progress") &&
    target === "skipped"
  ) {
    return { type: "skip", unitId };
  }
  return null;
}

async function assertCompletionCriteria(
  connection: DatabaseConnection,
  repository: LearningRepository,
  sessionId: string,
  unit: CurriculumUnit,
  payload: UnitProgressPayload,
  allProgress: readonly UnitProgress[],
  allUnits: readonly CurriculumUnit[],
): Promise<void> {
  if (unit.type === "summary") {
    assertPersistedSummaryEvidence(connection, sessionId, unit.id, payload);
  }
  const failures = [];
  for (const criterion of unit.completionCriteria) {
    let failed: boolean;
    switch (criterion.type) {
      case "acknowledgement":
        failed = !("acknowledged" in payload && payload.acknowledged);
        break;
      case "checklist":
        failed = !(
          "checkedItemIds" in payload &&
          criterion.requiredItemIds.every((id) =>
            payload.checkedItemIds.includes(id),
          )
        );
        break;
      case "attempts":
        failed =
          unit.type === "recall"
            ? !(await hasPersistedRecallEvidence(
                repository,
                sessionId,
                unit,
                payload,
                criterion.minimum,
              ))
            : evidenceAttemptCount(unit, payload) < criterion.minimum;
        break;
      case "dialogue":
        failed = !(
          payload.type === "teacher-dialogue" &&
          payload.turnCount >= criterion.minimumTurns &&
          (!criterion.requiresRevision || payload.revisionAttemptIds.length > 0)
        );
        break;
      case "score":
        failed = !(await hasPersistedQuizEvidence(
          connection,
          repository,
          sessionId,
          unit,
          payload,
          criterion.minimum,
          criterion.minimumAttempts,
        ));
        break;
      case "fields":
        failed =
          criterion.required.some(
            (field) => !hasEvidenceField(payload, field),
          ) ||
          (unit.type === "code-reading" &&
            !(await hasPersistedCodeReadingEvidence(
              repository,
              sessionId,
              unit,
              payload,
            )));
        break;
      case "exercise":
        failed = !hasExerciseEvidence(
          connection,
          sessionId,
          unit,
          payload,
          allProgress,
          allUnits,
          criterion.passingTestsRequired,
          criterion.acceptedReviewRequired,
        );
        break;
      case "custom":
        failed = unit.type !== "summary";
        break;
    }
    if (failed) failures.push(criterion);
  }
  if (failures.length) {
    throw new Error("Unit completion criteria are not satisfied");
  }
}

function evidenceAttemptCount(
  unit: CurriculumUnit,
  payload: UnitProgressPayload,
): number {
  switch (payload.type) {
    case "recall":
      return payload.firstAttemptId && payload.draft.trim()
        ? Math.max(1, unit.questions.length)
        : 0;
    case "quiz":
      return payload.attemptedQuestionIds.length;
    case "teacher-dialogue":
      return payload.turnCount;
    case "code-reading":
      return [
        payload.prediction,
        payload.explanation,
        payload.verbalFix,
      ].filter((value) => value.trim()).length;
    default:
      return Object.values(payload).some(
        (value) => typeof value === "string" && value.trim(),
      )
        ? 1
        : 0;
  }
}

function hasEvidenceField(
  payload: UnitProgressPayload,
  field: string,
): boolean {
  const value = (payload as unknown as Record<string, unknown>)[field];
  return typeof value === "string" ? value.trim().length > 0 : value != null;
}

async function hasPersistedRecallEvidence(
  repository: LearningRepository,
  sessionId: string,
  unit: CurriculumUnit,
  payload: UnitProgressPayload,
  minimum: number,
): Promise<boolean> {
  if (payload.type !== "recall") return false;
  const evidence = await repository.listVersionedUnitEvidence(sessionId, {
    unitId: unit.id,
    evidenceType: "recall-attempt",
  });
  const first = evidence[0];
  if (!first) return false;
  return Boolean(
    payload.firstAttemptId === first.id &&
    payload.draft === evidenceString(first.payload, "answer") &&
    Math.max(1, unit.questions.length) >= minimum,
  );
}

async function hasPersistedQuizEvidence(
  connection: DatabaseConnection,
  repository: LearningRepository,
  sessionId: string,
  unit: CurriculumUnit,
  payload: UnitProgressPayload,
  minimumScore: number,
  minimumAttempts: number,
): Promise<boolean> {
  if (payload.type !== "quiz") return false;
  const privateUnit = requirePrivateUnit(
    readPrivateSnapshot(connection, sessionId),
    unit.id,
    "quiz",
  );
  const allowedQuestions = new Set(
    privateUnit.questions.map((question) => question.id),
  );
  const evidence = await repository.listVersionedUnitEvidence(sessionId, {
    unitId: unit.id,
    evidenceType: "quiz-answer",
  });
  const latest = new Map(
    evidence
      .filter(
        (item) =>
          item.questionId !== null && allowedQuestions.has(item.questionId),
      )
      .map((item) => [item.questionId!, item]),
  );
  const attempted = [...latest.keys()];
  const correct = attempted.filter(
    (questionId) => latest.get(questionId)?.correctness === 1,
  );
  const score =
    attempted.length === 0 ? null : correct.length / attempted.length;
  return Boolean(
    score !== null &&
    score >= minimumScore &&
    attempted.length >= minimumAttempts &&
    payload.score === score &&
    sameStringSet(payload.attemptedQuestionIds, attempted) &&
    sameStringSet(payload.correctQuestionIds, correct),
  );
}

async function hasPersistedCodeReadingEvidence(
  repository: LearningRepository,
  sessionId: string,
  unit: CurriculumUnit,
  payload: UnitProgressPayload,
): Promise<boolean> {
  if (payload.type !== "code-reading") return false;
  const evidence = await repository.listVersionedUnitEvidence(sessionId, {
    unitId: unit.id,
    evidenceType: "code-reading-attempt",
  });
  const latest = evidence.at(-1);
  return Boolean(
    latest &&
    payload.prediction === evidenceString(latest.payload, "prediction") &&
    payload.explanation === evidenceString(latest.payload, "explanation") &&
    payload.verbalFix === evidenceString(latest.payload, "verbalFix"),
  );
}

function sameStringSet(left: readonly string[], right: readonly string[]) {
  return (
    left.length === right.length &&
    new Set(left).size === left.length &&
    left.every((value) => right.includes(value))
  );
}

function ownedExerciseAttempt(
  connection: DatabaseConnection,
  sessionId: string,
  attemptId: string,
): { id: string } | null {
  return (
    (connection.sqlite
      .prepare(
        "SELECT id FROM exercise_attempts WHERE id = ? AND session_id = ?",
      )
      .get(attemptId, sessionId) as { id: string } | undefined) ?? null
  );
}

function latestTestRun(
  connection: DatabaseConnection,
  attemptId: string,
): { id: string; status: string } | null {
  return (
    (connection.sqlite
      .prepare(
        `SELECT id, status FROM test_runs
         WHERE exercise_attempt_id = ?
         ORDER BY started_at DESC, rowid DESC LIMIT 1`,
      )
      .get(attemptId) as { id: string; status: string } | undefined) ?? null
  );
}

function latestPassedReview(
  connection: DatabaseConnection,
  sessionId: string,
  attemptId: string,
): { id: string; status: string } | null {
  const review = connection.sqlite
    .prepare(
      `SELECT id, status FROM reviews
       WHERE session_id = ? AND exercise_attempt_id = ?
       ORDER BY created_at DESC, rowid DESC LIMIT 1`,
    )
    .get(sessionId, attemptId) as { id: string; status: string } | undefined;
  return review?.status === "passed" ? review : null;
}

function hasExerciseEvidence(
  connection: DatabaseConnection,
  sessionId: string,
  unit: CurriculumUnit,
  payload: UnitProgressPayload,
  allProgress: readonly UnitProgress[],
  allUnits: readonly CurriculumUnit[],
  passingTestsRequired: boolean,
  acceptedReviewRequired: boolean,
): boolean {
  if (payload.type === "exercise") {
    if (!payload.attemptId) return false;
    const attempt = ownedExerciseAttempt(
      connection,
      sessionId,
      payload.attemptId,
    );
    if (!attempt) return false;
    const latestTest = latestTestRun(connection, attempt.id);
    if (
      passingTestsRequired &&
      (!latestTest ||
        latestTest.id !== payload.latestTestRunId ||
        latestTest.status !== "passed")
    ) {
      return false;
    }
    if (acceptedReviewRequired) {
      const latestReview = latestPassedReview(
        connection,
        sessionId,
        attempt.id,
      );
      if (!latestReview || latestReview.id !== payload.latestReviewId) {
        return false;
      }
    }
    return true;
  }
  if (payload.type !== "review" || unit.payload.type !== "review") return false;
  // Published review payloads refer to the stable unit ID while persisted
  // progress is keyed by the immutable snapshot row ID.
  const exerciseStableId = unit.payload.exerciseUnitId;
  const snapshotExerciseUnitId = allUnits.find(
    (candidate) => candidate.stableId === exerciseStableId,
  )?.id;
  const exercise = allProgress.find(
    (item) =>
      item.unitId === snapshotExerciseUnitId &&
      item.payload.type === "exercise",
  );
  if (
    !payload.reviewId ||
    exercise?.payload.type !== "exercise" ||
    !exercise.payload.attemptId
  ) {
    return false;
  }
  const attempt = ownedExerciseAttempt(
    connection,
    sessionId,
    exercise.payload.attemptId,
  );
  if (!attempt) return false;
  const latestTest = latestTestRun(connection, attempt.id);
  if (
    passingTestsRequired &&
    (!latestTest ||
      latestTest.id !== exercise.payload.latestTestRunId ||
      latestTest.status !== "passed")
  ) {
    return false;
  }
  const latestReview = latestPassedReview(connection, sessionId, attempt.id);
  return Boolean(
    latestReview &&
    latestReview.id === payload.reviewId &&
    (!acceptedReviewRequired || payload.reviewStatus === "accepted"),
  );
}

function toLearnerUnit(unit: CurriculumUnit) {
  return {
    id: unit.id,
    stableId: unit.stableId,
    type: unit.type,
    title: unit.title,
    description: unit.description,
    order: unit.order,
    estimatedMinutes: unit.estimatedMinutes,
    objectives: unit.objectives,
    checklist: unit.checklist,
    sources: unit.sources,
    questions: unit.questions.map((question) => ({
      id: question.id,
      kind: question.kind,
      prompt: question.prompt,
      options: question.options,
    })),
    completionCriteria: unit.completionCriteria,
    unlockRules: unit.unlockRules,
    optional: unit.optional,
    depthLevel: unit.depthLevel,
    payload: unit.payload,
  };
}

function toLearnerSession(detail: VersionedSessionDetail) {
  return {
    ...detail.session,
    snapshot: {
      ...detail.snapshot,
      units: detail.snapshot.units.map(toLearnerUnit),
    },
    unitProgress: detail.unitProgress.map((progress) =>
      progress.payload.type === "quiz"
        ? {
            ...progress,
            payload: {
              type: "quiz" as const,
              attemptedQuestionIds: progress.payload.attemptedQuestionIds,
              score: progress.payload.score,
            },
          }
        : progress,
    ),
  };
}

function isServerOwnedEvidenceUnit(
  type: CurriculumUnit["type"],
): type is "recall" | "quiz" | "code-reading" {
  return type === "recall" || type === "quiz" || type === "code-reading";
}
