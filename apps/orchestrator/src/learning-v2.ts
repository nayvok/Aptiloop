import { createHash } from "node:crypto";

import {
  CurriculumAuthoringRepository,
  hashCanonicalJson,
  type CourseFoundationRepository,
  createLearningKernelRepository,
  type CourseFoundationRevision,
  type DatabaseConnection,
  type LearningRepository,
  type VersionedSessionDetail,
  withAsyncTransaction,
  withTransaction,
  type LearningKernelRepository,
} from "@dlh/database";
import {
  applyMasteryEvidenceBatch,
  createUnitProgression,
  createEmptyMasteryProfile,
  learningKernelSha256,
  deriveDaySummary,
  isLessonComplete,
  resolveExplicitUnitDefinitions,
  transitionUnitProgression,
  type LearningKernelEvidenceBody,
  type LearningKernelFactProvenance,
  type LearningKernelScope,
  type DaySummary,
  type EvidenceType,
  type HintLevel,
  type MasteryDimension,
  type MasteryProfile,
  type UnitDefinition,
  type UnitProgressionEvent,
} from "@dlh/learning-core";
import {
  CourseEntityIdSchema,
  UnitUnlockRuleSchema,
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
import {
  assertLearningRevisionMutationAllowed,
  assertLearningSessionMutationAllowed,
} from "./learning-session-policy.js";

interface VersionedLearningState {
  connection: DatabaseConnection;
  repository: LearningRepository;
  courseFoundationRepository: CourseFoundationRepository;
  now?: () => number;
}

const startSessionSchema = z
  .object({
    dayId: z.string().trim().min(1).max(200),
    operationId: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

const updateUnitSchema = z
  .object({
    operationId: z.string().trim().min(1).max(200),
    status: UnitStatusSchema.exclude(["locked"]),
    payload: UnitProgressPayloadSchema.optional(),
  })
  .strict();

const operationIdSchema = z.string().trim().min(1).max(100);

const recallAttemptSchema = z
  .object({
    operationId: operationIdSchema,
    questionId: z.string().trim().min(1).max(200),
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

const kernelTransitionSchema = z
  .object({
    operationId: operationIdSchema,
    transition: z.enum(["start", "pause"]),
  })
  .strict();

const kernelReviewDismissSchema = z
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
  const kernelRepository = createLearningKernelRepository(
    state.connection,
    state.now === undefined ? {} : { now: state.now },
  );
  const observedAt = () => new Date(state.now?.() ?? Date.now()).toISOString();
  app.use("/api/learning/sessions/v2/:id/*", async (context, next) => {
    if (context.req.method !== "GET" && context.req.method !== "HEAD") {
      assertLearningSessionMutationAllowed(
        state.connection,
        context.req.param("id"),
      );
      await requireVerifiedSessionDetail(state, context.req.param("id"));
    }
    await next();
  });

  app.get("/api/learning/courses", async (context) => {
    return context.json({ courses: await readCourseCollection(state) });
  });

  app.get(
    "/api/learning/courses/:courseId/revisions/:revisionId/path",
    async (context) => {
      const courseId = CourseEntityIdSchema.parse(
        context.req.param("courseId"),
      );
      const revisionId = CourseEntityIdSchema.parse(
        context.req.param("revisionId"),
      );
      return context.json(await readLearnerPath(state, courseId, revisionId));
    },
  );

  app.get("/api/learning/path", async (context) => {
    const target = await readCompatibilityCourseTarget(state);
    return context.json(
      target
        ? await readLearnerPath(state, target.courseId, target.revisionId)
        : { curriculum: null, courseContext: null },
    );
  });

  app.get("/api/learning/sessions/current", async (context) => {
    const current = await state.repository.getCurrentVersionedSession();
    return context.json({
      session: current ? await toLearnerSession(state, current) : null,
    });
  });

  app.post("/api/learning/sessions/v2", async (context) => {
    const body = startSessionSchema.parse(await context.req.json());
    const current = await state.repository.getCurrentVersionedSession();
    if (current) {
      await requireSessionCourseContext(state, current);
      if (current.snapshot.day.id === body.dayId) {
        return context.json(
          { session: await toLearnerSession(state, current) },
          201,
        );
      }
    }
    const target = await requireCourseTargetForLesson(state, body.dayId);
    assertLearningRevisionMutationAllowed(target.revisionId);
    await assertDayCanStart(state, target);
    const detail = await state.repository.startOrResumeVersionedSession({
      dayId: body.dayId,
      idempotencyKey: body.operationId
        ? `learning-v2:${body.operationId}`
        : `learning-v2:day:${body.dayId}:active`,
    });
    return context.json(
      { session: await toLearnerSession(state, detail) },
      201,
    );
  });

  app.get("/api/learning/sessions/v2/:id", async (context) => {
    const detail = await requireVerifiedSessionDetail(
      state,
      context.req.param("id"),
    );
    return context.json({ session: await toLearnerSession(state, detail) });
  });

  app.get("/api/learning/sessions/v2/:id/kernel", (context) => {
    const scope = kernelRepository.resolveSessionScope(context.req.param("id"));
    return context.json({
      scope,
      projection: kernelRepository.reproject(scope, observedAt()),
    });
  });

  app.post(
    "/api/learning/sessions/v2/:id/kernel/activities/:activityId/transitions",
    async (context) => {
      const body = kernelTransitionSchema.parse(await context.req.json());
      const activityId = operationIdSchema.parse(
        context.req.param("activityId"),
      );
      const scope = kernelRepository.resolveSessionScope(
        context.req.param("id"),
      );
      const operationId = `kernel:${body.operationId}`;
      const at =
        readKernelFactObservedAt(state.connection, operationId) ?? observedAt();
      const result = kernelRepository.accept(scope, {
        operationId,
        factId: `kernel-fact:${body.operationId}`,
        observedAt: at,
        provenance: learnerKernelProvenance(body.operationId, {
          scope,
          activityId,
          transition: body.transition,
          observedAt: at,
        }),
        body: {
          type: "progress",
          activityId,
          transition: body.transition,
        },
      });
      return context.json(
        { idempotent: result.idempotent, projection: result.projection },
        result.accepted ? 201 : 200,
      );
    },
  );

  app.post(
    "/api/learning/sessions/v2/:id/kernel/activities/:activityId/reviews/:reviewItemId/dismiss",
    async (context) => {
      const body = kernelReviewDismissSchema.parse(await context.req.json());
      const activityId = operationIdSchema.parse(
        context.req.param("activityId"),
      );
      const reviewItemId = operationIdSchema.parse(
        context.req.param("reviewItemId"),
      );
      const scope = kernelRepository.resolveSessionScope(
        context.req.param("id"),
      );
      const operationId = `kernel:${body.operationId}`;
      const at =
        readKernelFactObservedAt(state.connection, operationId) ?? observedAt();
      const result = kernelRepository.accept(scope, {
        operationId,
        factId: `kernel-fact:${body.operationId}`,
        observedAt: at,
        provenance: learnerKernelProvenance(body.operationId, {
          scope,
          activityId,
          reviewItemId,
          observedAt: at,
        }),
        body: {
          type: "review",
          activityId,
          reviewItemId,
          transition: "dismiss",
        },
      });
      return context.json(
        { idempotent: result.idempotent, projection: result.projection },
        result.accepted ? 201 : 200,
      );
    },
  );

  app.get(
    "/api/learning/sessions/v2/:id/teacher-transcript",
    async (context) => {
      const sessionId = context.req.param("id");
      await requireVerifiedSessionDetail(state, sessionId);
      const messages = state.connection.sqlite
        .prepare(
          `SELECT m.id, m.role, m.content
           FROM agent_messages m
           JOIN agent_conversations c ON c.id = m.conversation_id
           WHERE c.learning_session_id = ? AND c.role = 'teacher'
             AND m.role IN ('user', 'assistant') AND m.status = 'completed'
           ORDER BY c.created_at ASC, m.sequence ASC`,
        )
        .all(sessionId) as Array<{
        id: string;
        role: "user" | "assistant";
        content: string;
      }>;
      return context.json({
        messages: messages.map((message) => ({
          ...message,
          content:
            message.role === "user"
              ? learnerTeacherMessage(message.content)
              : message.content,
        })),
      });
    },
  );

  app.post(
    "/api/learning/sessions/v2/:id/units/:unitId/recall-attempts",
    async (context) =>
      withAsyncTransaction(state.connection, async () => {
        const body = recallAttemptSchema.parse(await context.req.json());
        const sessionId = context.req.param("id");
        const unitId = context.req.param("unitId");
        const unit = requireEvidenceTarget(
          await state.repository.getVersionedSession(sessionId),
          unitId,
          "recall",
        );
        if (
          !unit.questions.some((question) => question.id === body.questionId)
        ) {
          throw new Error("Unknown recall question");
        }
        const recorded = await state.repository.recordVersionedUnitEvidence({
          sessionId,
          unitId,
          evidenceType: "recall-attempt",
          operationId: body.operationId,
          questionId: body.questionId,
          payload: { answer: body.answer },
        });
        acceptKernelLearnerEvidence(kernelRepository, state.connection, {
          sessionId,
          activityId: unit.stableId,
          operationId: body.operationId,
          sourceId: recorded.id,
          observedAt: toObservedAt(recorded.createdAt),
          source: recorded,
          body: {
            type: "evidence",
            dimension: "understanding",
            evidenceType: "recall",
            outcome: "unverified",
            hintLevel: readLegacyHintLevel(state.connection, sessionId, unitId),
          },
        });
        const attempts = await state.repository.listVersionedUnitEvidence(
          sessionId,
          { unitId, evidenceType: "recall-attempt" },
        );
        const firstByQuestion = firstRecallEvidenceByQuestion(unit, attempts);
        const first = firstByQuestion.get(body.questionId);
        if (!first) throw new Error("Persisted recall attempt disappeared");
        const answers = unit.questions.flatMap((question) => {
          const evidence = firstByQuestion.get(question.id);
          return evidence
            ? [
                {
                  questionId: question.id,
                  firstAttemptId: evidence.id,
                  draft: evidenceString(evidence.payload, "answer"),
                },
              ]
            : [];
        });
        const legacyFirst = answers[0];
        await state.repository.updateUnitProgress({
          sessionId,
          unitId,
          status: "in_progress",
          progress: {
            type: "recall",
            answers,
            firstAttemptId: legacyFirst?.firstAttemptId ?? null,
            draft: legacyFirst?.draft ?? "",
          },
        });
        return context.json(
          {
            evidence: {
              id: recorded.id,
              isFirstAttempt: recorded.id === first.id,
              questionId: body.questionId,
            },
            session: await toLearnerSession(
              state,
              await state.repository.getVersionedSession(sessionId),
            ),
          },
          201,
        );
      }),
  );

  app.post(
    "/api/learning/sessions/v2/:id/units/:unitId/quiz-attempts",
    async (context) =>
      withAsyncTransaction(state.connection, async () => {
        const body = quizAttemptSchema.parse(await context.req.json());
        const sessionId = context.req.param("id");
        const unitId = context.req.param("unitId");
        const unit = requireEvidenceTarget(
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
          const answerOperationId = quizAnswerOperationId(
            body.operationId,
            answer.questionId,
          );
          const evidence = await state.repository.recordVersionedUnitEvidence({
            sessionId,
            unitId,
            evidenceType: "quiz-answer",
            operationId: answerOperationId,
            questionId: answer.questionId,
            payload: { selectedOptionId: answer.selectedOptionId },
            correctness: correct ? 1 : 0,
          });
          const occurredAt = toObservedAt(evidence.createdAt);
          const kernelBody = {
            type: "evidence" as const,
            dimension: "understanding" as const,
            evidenceType: "recall" as const,
            outcome: "unverified" as const,
            hintLevel: readLegacyHintLevel(state.connection, sessionId, unitId),
          };
          const learnerFactId = acceptKernelLearnerEvidence(
            kernelRepository,
            state.connection,
            {
              sessionId,
              activityId: unit.stableId,
              operationId: answerOperationId,
              sourceId: evidence.id,
              observedAt: occurredAt,
              source: evidence,
              body: kernelBody,
            },
          );
          acceptKernelEvaluatorEvidence(kernelRepository, state.connection, {
            sessionId,
            activityId: unit.stableId,
            operationId: answerOperationId,
            sourceId: evidence.id,
            observedAt: occurredAt,
            source: { evidence, correct },
            body: kernelBody,
            basisFactId: learnerFactId,
            outcome: correct ? "correct" : "incorrect",
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
            session: await toLearnerSession(
              state,
              await state.repository.getVersionedSession(sessionId),
            ),
          },
          201,
        );
      }),
  );

  app.post(
    "/api/learning/sessions/v2/:id/units/:unitId/code-reading-attempts",
    async (context) =>
      withAsyncTransaction(state.connection, async () => {
        const body = codeReadingAttemptSchema.parse(await context.req.json());
        const sessionId = context.req.param("id");
        const unitId = context.req.param("unitId");
        const unit = requireEvidenceTarget(
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
        acceptKernelLearnerEvidence(kernelRepository, state.connection, {
          sessionId,
          activityId: unit.stableId,
          operationId: body.operationId,
          sourceId: evidence.id,
          observedAt: toObservedAt(evidence.createdAt),
          source: evidence,
          body: {
            type: "evidence",
            dimension: "codeReading",
            evidenceType: "code_reading",
            outcome: "unverified",
            hintLevel: readLegacyHintLevel(state.connection, sessionId, unitId),
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
            session: await toLearnerSession(
              state,
              await state.repository.getVersionedSession(sessionId),
            ),
          },
          201,
        );
      }),
  );

  app.get(
    "/api/learning/sessions/v2/:id/units/:unitId/summary",
    async (context) => {
      const sessionId = context.req.param("id");
      const unitId = context.req.param("unitId");
      const detail = await requireVerifiedSessionDetail(state, sessionId);
      const persisted = readPersistedSummary(state.connection, detail, unitId);
      return context.json({
        summary: persisted.summary,
        evidence: { id: persisted.evidenceId },
        session: await toLearnerSession(state, detail),
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
          session: await toLearnerSession(
            state,
            await state.repository.getVersionedSession(sessionId),
          ),
        },
        201,
      );
    },
  );

  app.patch("/api/learning/sessions/v2/:id/units/:unitId", async (context) =>
    withAsyncTransaction(state.connection, async () => {
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
        return context.json({
          session: await toLearnerSession(state, unchanged),
        });
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
      acceptLegacyKernelProgress(kernelRepository, state.connection, {
        sessionId,
        stableActivityId: unit.stableId,
        operationId: body.operationId,
        transition: event.type,
        observedAt: observedAt(),
        source: { current, target: body.status, payload },
      });
      const updated = await state.repository.getVersionedSession(sessionId);
      return context.json({ session: await toLearnerSession(state, updated) });
    }),
  );
}

interface PathCourseTarget {
  courseId: string;
  revisionId: string;
}

async function readCourseCollection(state: VersionedLearningState) {
  const courses = await state.courseFoundationRepository.listCourses();
  return courses
    .map((course) => ({
      id: course.id,
      stableId: course.stableId,
      title: course.title,
      description: course.description,
      primaryLocale: course.primaryLocale,
      revisions: [...course.revisions]
        .sort(
          (left, right) =>
            left.revisionNumber - right.revisionNumber ||
            (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
        )
        .map((revision) => ({
          id: revision.id,
          revisionNumber: revision.revisionNumber,
          status: revision.status,
          branchKind: revision.branchKind,
          contentHash: revision.contentHash,
        })),
    }))
    .sort((left, right) =>
      left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
    );
}

async function requireOwnedCourseRevision(
  state: VersionedLearningState,
  courseId: string,
  revisionId: string,
  publishedOnly: boolean,
): Promise<CourseFoundationRevision> {
  const target =
    await state.courseFoundationRepository.getCourseRevision(revisionId);
  if (!target) throw new Error(`Unknown Course revision: ${revisionId}`);
  if (
    target.course.id !== courseId ||
    target.revision.id !== revisionId ||
    target.revision.courseId !== courseId
  ) {
    throw new Error("Course and revision IDs do not match");
  }
  if (publishedOnly && target.revision.status !== "published") {
    throw new Error("Course path requires a published revision");
  }
  assertFoundationRevisionOwnership(target);
  return target;
}

function assertFoundationRevisionOwnership(
  target: CourseFoundationRevision,
): void {
  const lessonIds = new Set(target.lessons.map((lesson) => lesson.id));
  if (lessonIds.size !== target.lessons.length) {
    throw new Error("Course revision contains duplicate lesson IDs");
  }
  const revisionActivityIds = new Set<string>();
  for (const lesson of target.lessons) {
    if (
      lesson.courseId !== target.course.id ||
      lesson.revisionId !== target.revision.id ||
      lesson.prerequisiteLessonIds.some(
        (prerequisiteId) => !lessonIds.has(prerequisiteId),
      )
    ) {
      throw new Error("Course revision contains an invalid lesson scope");
    }
    const lessonActivityIds = new Set(
      lesson.activities.map((activity) => activity.id),
    );
    if (lessonActivityIds.size !== lesson.activities.length) {
      throw new Error("Course lesson contains duplicate activity IDs");
    }
    for (const entryActivityId of lesson.entryActivityIds) {
      if (!lessonActivityIds.has(entryActivityId)) {
        throw new Error("Course lesson entry activity is out of scope");
      }
    }
    for (const activity of lesson.activities) {
      if (
        activity.courseId !== target.course.id ||
        activity.revisionId !== target.revision.id ||
        activity.lessonId !== lesson.id ||
        revisionActivityIds.has(activity.id)
      ) {
        throw new Error("Course revision contains an invalid activity scope");
      }
      revisionActivityIds.add(activity.id);
      if (
        activity.prerequisiteActivityIds.some(
          (prerequisiteId) => !lessonActivityIds.has(prerequisiteId),
        )
      ) {
        throw new Error("Course activity prerequisite is out of lesson scope");
      }
    }
  }
}

function requireTargetLesson(
  target: CourseFoundationRevision,
  expectedLesson: {
    readonly id: string;
    readonly prerequisites: readonly unknown[];
    readonly units: readonly {
      readonly id: string;
      readonly stableId: string;
      readonly type: string;
      readonly optional: boolean;
      readonly unlockRules: readonly unknown[];
    }[];
  },
  lessonIdByStableId: ReadonlyMap<string, string>,
) {
  const lesson = target.lessons.find(
    (candidate) => candidate.id === expectedLesson.id,
  );
  if (!lesson) throw new Error("Course revision does not own the lesson");
  const expectedDefinitions = resolveExplicitUnitDefinitions(
    expectedLesson.units.map((activity) => ({
      id: activity.id,
      stableId: activity.stableId,
      optional: activity.optional,
      prerequisiteStableIds: UnitUnlockRuleSchema.array()
        .parse(activity.unlockRules)
        .map((rule) => rule.unitId),
    })),
  );
  const expectedPrerequisitesByActivityId = new Map(
    expectedDefinitions.map((definition) => [
      definition.id,
      definition.prerequisiteUnitIds ?? [],
    ]),
  );
  const expectedLessonPrerequisites = CourseEntityIdSchema.array()
    .parse(expectedLesson.prerequisites)
    .map((stableId) => {
      const id = lessonIdByStableId.get(stableId);
      if (id === undefined) {
        throw new Error(`Unknown source lesson prerequisite: ${stableId}`);
      }
      return id;
    });
  if (
    !sameStringSequence(
      [...lesson.prerequisiteLessonIds].sort(),
      expectedLessonPrerequisites.sort(),
    ) ||
    !sameStringSequence(
      lesson.activities.map((activity) => activity.id),
      expectedLesson.units.map((activity) => activity.id),
    ) ||
    lesson.activities.some((activity, index) => {
      const expected = expectedLesson.units[index];
      return (
        expected === undefined ||
        activity.type !== expected.type ||
        !sameStringSequence(
          [...activity.prerequisiteActivityIds].sort(),
          [
            ...(expectedPrerequisitesByActivityId.get(activity.id) ?? []),
          ].sort(),
        )
      );
    })
  ) {
    throw new Error("Course lesson graph does not match the source lesson");
  }
  return lesson;
}

interface VerifiedCourseLessonTarget extends PathCourseTarget {
  readonly revision: CourseFoundationRevision;
  readonly lesson: CourseFoundationRevision["lessons"][number];
}

async function requireCourseTargetForLesson(
  state: VersionedLearningState,
  lessonId: string,
): Promise<VerifiedCourseLessonTarget> {
  const source = state.connection.sqlite
    .prepare(
      `SELECT lesson.version_id, revision.curriculum_id
       FROM curriculum_days_v2 lesson
       JOIN curriculum_versions revision ON revision.id = lesson.version_id
       JOIN curricula course ON course.id = revision.curriculum_id
       WHERE lesson.id = ? AND revision.status = 'published'
         AND course.active_version_id = revision.id`,
    )
    .get(lessonId) as { version_id: string; curriculum_id: string } | undefined;
  if (!source) throw new Error(`Unknown Course lesson: ${lessonId}`);
  const ownedTarget = await requireOwnedCourseRevision(
    state,
    source.curriculum_id,
    source.version_id,
    true,
  );
  const graph = await new CurriculumAuthoringRepository(
    state.connection,
  ).getVersionGraph(source.version_id);
  const sourceLessons = graph.weeks.flatMap((week) => week.days);
  const sourceLesson = sourceLessons.find((lesson) => lesson.id === lessonId);
  if (sourceLesson === undefined) {
    throw new Error("Published curriculum graph is incomplete");
  }
  const lesson = requireTargetLesson(
    ownedTarget,
    sourceLesson,
    new Map(
      sourceLessons.map((candidate) => [candidate.stableId, candidate.id]),
    ),
  );
  return {
    courseId: source.curriculum_id,
    revisionId: source.version_id,
    revision: ownedTarget,
    lesson,
  };
}

async function readCompatibilityCourseTarget(
  state: VersionedLearningState,
): Promise<PathCourseTarget | null> {
  const current = await state.repository.getCurrentVersionedSession();
  if (current) {
    const context = await requireSessionCourseContext(state, current);
    return { courseId: context.courseId, revisionId: context.revisionId };
  }

  const mappings = state.connection.sqlite
    .prepare(
      `SELECT course.id AS course_id, course.active_version_id AS revision_id
       FROM curricula course
       JOIN curriculum_versions revision
         ON revision.id = course.active_version_id
       WHERE revision.status = 'published'
       ORDER BY course.updated_at DESC, course.id, revision.revision, revision.id`,
    )
    .all() as Array<{ course_id: string; revision_id: string }>;
  const mapping = mappings[0];
  if (!mapping) return null;
  const target = await state.courseFoundationRepository.getCourseRevision(
    mapping.revision_id,
  );
  if (target !== null) {
    await requireOwnedCourseRevision(
      state,
      mapping.course_id,
      mapping.revision_id,
      true,
    );
  } else if (
    !hasQuarantinedRevisionCompatibility(
      state,
      mapping.course_id,
      mapping.revision_id,
    )
  ) {
    throw new Error(`Unknown Course revision: ${mapping.revision_id}`);
  }
  return { courseId: mapping.course_id, revisionId: mapping.revision_id };
}

async function readLearnerPath(
  state: VersionedLearningState,
  courseId: string,
  revisionId: string,
) {
  const currentDetail = await state.repository.getCurrentVersionedSession();
  const currentContext = currentDetail
    ? await requireSessionCourseContext(state, currentDetail)
    : null;
  const pinnedToCurrentSession =
    currentDetail !== null &&
    currentContext !== null &&
    currentContext.courseId === courseId &&
    currentContext.revisionId === revisionId;
  const candidateTarget =
    await state.courseFoundationRepository.getCourseRevision(revisionId);
  const target =
    candidateTarget === null
      ? null
      : await requireOwnedCourseRevision(state, courseId, revisionId, false);
  if (
    target !== null &&
    target.revision.status !== "published" &&
    (!pinnedToCurrentSession || target.revision.status !== "archived")
  ) {
    throw new Error("Course path requires a published revision");
  }
  if (
    target === null &&
    !hasQuarantinedRevisionCompatibility(state, courseId, revisionId)
  ) {
    throw new Error(`Unknown Course revision: ${revisionId}`);
  }
  const sourceCourse = state.connection.sqlite
    .prepare(
      `SELECT course.id, course.slug, course.title, course.description
       FROM curricula course
       JOIN curriculum_versions revision
         ON revision.id = ? AND revision.curriculum_id = course.id
       WHERE course.id = ? AND revision.status IN ('published', 'archived')`,
    )
    .get(revisionId, courseId) as
    | {
        id: string;
        slug: string;
        title: string;
        description: string | null;
      }
    | undefined;
  if (!sourceCourse) {
    throw new Error("Course revision has no compatible published source");
  }

  const authoring = new CurriculumAuthoringRepository(state.connection);
  const graph = await authoring.getVersionGraph(revisionId);
  if (
    graph.version.curriculumId !== courseId ||
    graph.version.id !== revisionId ||
    (graph.version.status !== "published" &&
      (!pinnedToCurrentSession || graph.version.status !== "archived")) ||
    (target !== null &&
      (graph.version.revision !== target.revision.revisionNumber ||
        graph.version.contentHash !== target.revision.contentHash))
  ) {
    throw new Error("Course revision does not match its compatible source");
  }
  const sourceLessons = graph.weeks.flatMap((week) => week.days);
  if (
    target !== null &&
    !sameStringSequence(
      target.lessons.map((lesson) => lesson.id),
      sourceLessons.map((lesson) => lesson.id),
    )
  ) {
    throw new Error("Course lessons do not match the compatible source");
  }
  if (target !== null) {
    const lessonIdByStableId = new Map(
      sourceLessons.map((lesson) => [lesson.stableId, lesson.id]),
    );
    for (const lesson of sourceLessons) {
      requireTargetLesson(target, lesson, lessonIdByStableId);
    }
  }

  const latestSessions = await latestSessionsByDayStableId(
    state,
    courseId,
    revisionId,
  );
  const completedDayStableIds = await completedVersionedDayStableIds(
    state,
    courseId,
    revisionId,
  );
  const current = pinnedToCurrentSession ? currentDetail : null;

  return {
    courseContext: { courseId, revisionId },
    curriculum: {
      id: sourceCourse.id,
      slug: sourceCourse.slug,
      title: sourceCourse.title,
      description: sourceCourse.description,
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
          const session = latestSessions.get(day.stableId);
          const currentDay =
            current !== null && current.snapshot.day.id === day.id;
          const prerequisitesCompleted = CourseEntityIdSchema.array()
            .parse(day.prerequisites)
            .every((stableId) => completedDayStableIds.has(stableId));
          const dayStatus = completedDayStableIds.has(day.stableId)
            ? "completed"
            : currentDay
              ? "in_progress"
              : prerequisitesCompleted
                ? "available"
                : "locked";
          const sessionProgress =
            currentDay && current
              ? new Map(
                  current.unitProgress.flatMap((item) => {
                    const snapshotUnit = current.snapshot.units.find(
                      (unit) => unit.id === item.unitId,
                    );
                    return snapshotUnit ? [[snapshotUnit.stableId, item]] : [];
                  }),
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
            description: day.description ?? day.title,
            goal: day.goal,
            estimatedMinutes: day.estimatedMinutes,
            prerequisites: day.prerequisites,
            expectedOutcomes: day.expectedOutcomes,
            depthLevel: day.depthLevel,
            outOfScope: day.outOfScope,
            topics: day.topics,
            status: dayStatus,
            sessionId:
              currentDay && current
                ? current.session.id
                : (session?.id ?? null),
            units: units.map((unit) => ({
              ...toLearnerUnit(unit),
              status:
                session?.status === "completed"
                  ? unit.optional
                    ? "skipped"
                    : "completed"
                  : (sessionProgress?.get(unit.stableId)?.status ??
                    initial.get(unit.id) ??
                    "locked"),
            })),
          };
        }),
      })),
    },
  };
}

async function requireVerifiedSessionDetail(
  state: VersionedLearningState,
  sessionId: string,
): Promise<VersionedSessionDetail> {
  const detail = await state.repository.getVersionedSession(sessionId);
  await requireSessionCourseContext(state, detail);
  return detail;
}

async function requireSessionCourseContext(
  state: VersionedLearningState,
  detail: VersionedSessionDetail,
) {
  const persistedContext =
    await state.courseFoundationRepository.getSessionContext(detail.session.id);
  const sourceSnapshot = state.connection.sqlite
    .prepare(
      `SELECT id, curriculum_id, curriculum_version_id, curriculum_day_id,
              content_hash, snapshot_json
       FROM session_snapshots WHERE session_id = ?`,
    )
    .get(detail.session.id) as
    | {
        id: string;
        curriculum_id: string | null;
        curriculum_version_id: string | null;
        curriculum_day_id: string | null;
        content_hash: string;
        snapshot_json: string;
      }
    | undefined;
  if (!sourceSnapshot) {
    throw new Error("Learning session source snapshot is missing");
  }
  const compatibilityContext =
    persistedContext === null &&
    sourceSnapshot.curriculum_id !== null &&
    sourceSnapshot.curriculum_version_id !== null &&
    sourceSnapshot.curriculum_day_id !== null &&
    hasQuarantinedSessionCompatibility(
      state,
      detail.session.id,
      sourceSnapshot.curriculum_id,
      sourceSnapshot.curriculum_version_id,
      sourceSnapshot.curriculum_day_id,
    )
      ? {
          courseId: sourceSnapshot.curriculum_id,
          revisionId: sourceSnapshot.curriculum_version_id,
          lessonId: sourceSnapshot.curriculum_day_id,
          sessionSnapshotId: sourceSnapshot.id,
          snapshotHash: sourceSnapshot.content_hash,
        }
      : null;
  const context = persistedContext ?? compatibilityContext;
  if (context === null) {
    throw new Error("Learning session has no Course context");
  }
  const storedSnapshot = SessionSnapshotSchema.parse(
    JSON.parse(sourceSnapshot.snapshot_json),
  );
  const { contentHash: embeddedHash, ...snapshotCore } = storedSnapshot;
  if (
    sourceSnapshot.id !== context.sessionSnapshotId ||
    sourceSnapshot.curriculum_id !== context.courseId ||
    sourceSnapshot.curriculum_version_id !== context.revisionId ||
    sourceSnapshot.curriculum_day_id !== context.lessonId ||
    sourceSnapshot.content_hash !== context.snapshotHash ||
    embeddedHash !== context.snapshotHash ||
    (persistedContext !== null &&
      hashCanonicalJson(snapshotCore) !== context.snapshotHash) ||
    detail.snapshot.contentHash !== context.snapshotHash ||
    detail.snapshot.curriculumId !== context.courseId ||
    detail.snapshot.curriculumVersionId !== context.revisionId ||
    detail.snapshot.day.id !== context.lessonId ||
    detail.session.curriculumDayV2Id !== context.lessonId
  ) {
    throw new Error(
      "Learning session Course context does not match its snapshot",
    );
  }

  if (persistedContext !== null) {
    const target = await requireOwnedCourseRevision(
      state,
      context.courseId,
      context.revisionId,
      false,
    );
    const lesson = requireTargetLesson(
      target,
      {
        id: context.lessonId,
        prerequisites: storedSnapshot.day.prerequisites,
        units: storedSnapshot.units,
      },
      new Map(
        target.lessons.map((candidate) => [candidate.stableId, candidate.id]),
      ),
    );
    const activityIds = lesson.activities.map((activity) => activity.id);
    if (
      !sameStringSequence(
        activityIds,
        detail.snapshot.units.map((unit) => unit.id),
      ) ||
      !sameStringSet(
        activityIds,
        detail.unitProgress.map((progress) => progress.unitId),
      ) ||
      lesson.activities.some((activity, index) => {
        const snapshotUnit = detail.snapshot.units[index];
        const progress = detail.unitProgress.find(
          (candidate) => candidate.unitId === activity.id,
        );
        return (
          snapshotUnit?.type !== activity.type ||
          progress?.unitType !== activity.type
        );
      })
    ) {
      throw new Error(
        "Learning session activities do not match its Course lesson",
      );
    }
  }

  return {
    courseId: context.courseId,
    revisionId: context.revisionId,
    lessonId: context.lessonId,
    sessionSnapshotId: context.sessionSnapshotId,
    snapshotHash: context.snapshotHash,
  };
}

type QuarantinedSourceTable =
  "curriculum_versions" | "curriculum_days_v2" | "session_snapshots";

function matchesQuarantinedSourceRow(
  state: VersionedLearningState,
  table: QuarantinedSourceTable,
  sourcePrimaryKey: string,
  sourceRowHash: string,
): boolean {
  const row = state.connection.sqlite
    .prepare(`SELECT * FROM ${table} WHERE id = ?`)
    .get(sourcePrimaryKey) as Record<string, unknown> | undefined;
  return row !== undefined && hashCanonicalJson(row) === sourceRowHash;
}

function hasQuarantinedRevisionCompatibility(
  state: VersionedLearningState,
  courseId: string,
  revisionId: string,
): boolean {
  const provenance = state.connection.sqlite
    .prepare(
      `SELECT provenance.source_row_hash
       FROM migration_provenance provenance
       JOIN curriculum_versions revision
         ON revision.id = provenance.source_primary_key
        AND revision.id = ?
        AND revision.curriculum_id = ?
       WHERE provenance.transform_version = 'm2-v1'
         AND provenance.source_table = 'curriculum_versions'
         AND provenance.status = 'quarantined'`,
    )
    .get(revisionId, courseId) as { source_row_hash: string } | undefined;
  return (
    provenance !== undefined &&
    matchesQuarantinedSourceRow(
      state,
      "curriculum_versions",
      revisionId,
      provenance.source_row_hash,
    )
  );
}

function hasQuarantinedSessionCompatibility(
  state: VersionedLearningState,
  sessionId: string,
  courseId: string,
  revisionId: string,
  lessonId?: string,
): boolean {
  const provenance = state.connection.sqlite
    .prepare(
      `SELECT revision_provenance.source_row_hash AS revision_row_hash,
              lesson_provenance.source_row_hash AS lesson_row_hash,
              snapshot_provenance.source_row_hash AS snapshot_row_hash,
              lesson.id AS lesson_id, snapshot.id AS snapshot_id
       FROM session_snapshots snapshot
       JOIN curriculum_versions revision
         ON revision.id = snapshot.curriculum_version_id
        AND revision.curriculum_id = snapshot.curriculum_id
       JOIN curriculum_days_v2 lesson
         ON lesson.id = snapshot.curriculum_day_id
        AND lesson.version_id = revision.id
       JOIN migration_provenance revision_provenance
         ON revision_provenance.transform_version = 'm2-v1'
        AND revision_provenance.source_table = 'curriculum_versions'
        AND revision_provenance.source_primary_key = revision.id
        AND revision_provenance.status = 'quarantined'
       JOIN migration_provenance lesson_provenance
         ON lesson_provenance.transform_version = 'm2-v1'
        AND lesson_provenance.source_table = 'curriculum_days_v2'
        AND lesson_provenance.source_primary_key = lesson.id
        AND lesson_provenance.status = 'quarantined'
       JOIN migration_provenance snapshot_provenance
         ON snapshot_provenance.transform_version = 'm2-v1'
        AND snapshot_provenance.source_table = 'session_snapshots'
        AND snapshot_provenance.source_primary_key = snapshot.id
        AND snapshot_provenance.status = 'quarantined'
       WHERE snapshot.session_id = ?
         AND snapshot.curriculum_id = ?
         AND snapshot.curriculum_version_id = ?
         AND (? IS NULL OR snapshot.curriculum_day_id = ?)`,
    )
    .get(
      sessionId,
      courseId,
      revisionId,
      lessonId ?? null,
      lessonId ?? null,
    ) as
    | {
        revision_row_hash: string;
        lesson_row_hash: string;
        snapshot_row_hash: string;
        lesson_id: string;
        snapshot_id: string;
      }
    | undefined;
  return (
    provenance !== undefined &&
    matchesQuarantinedSourceRow(
      state,
      "curriculum_versions",
      revisionId,
      provenance.revision_row_hash,
    ) &&
    matchesQuarantinedSourceRow(
      state,
      "curriculum_days_v2",
      provenance.lesson_id,
      provenance.lesson_row_hash,
    ) &&
    matchesQuarantinedSourceRow(
      state,
      "session_snapshots",
      provenance.snapshot_id,
      provenance.snapshot_row_hash,
    )
  );
}

function sameStringSequence(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
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

async function completedVersionedDayStableIds(
  state: VersionedLearningState,
  courseId: string,
  revisionId: string,
): Promise<Set<string>> {
  const rows = state.connection.sqlite
    .prepare(
      `SELECT session.id, day.id AS lesson_id, day.stable_id AS stable_id,
              revision.id AS revision_id
       FROM learning_sessions session
       JOIN curriculum_days_v2 day ON day.id = session.curriculum_day_v2_id
       JOIN curriculum_versions revision ON revision.id = day.version_id
       WHERE session.status = 'completed' AND revision.curriculum_id = ?
         AND revision.id = ?
       ORDER BY session.updated_at DESC, session.id DESC`,
    )
    .all(courseId, revisionId) as Array<{
    id: string;
    lesson_id: string;
    stable_id: string;
    revision_id: string;
  }>;
  const completed = new Set<string>();
  for (const row of rows) {
    const detail = await state.repository.getVersionedSession(row.id);
    const context = await requireSessionCourseContext(state, detail);
    if (
      context.courseId !== courseId ||
      context.revisionId !== revisionId ||
      context.revisionId !== row.revision_id ||
      context.lessonId !== row.lesson_id
    ) {
      throw new Error("Completed session has an invalid Course lesson scope");
    }
    completed.add(row.stable_id);
  }
  return completed;
}

async function assertDayCanStart(
  state: VersionedLearningState,
  target: VerifiedCourseLessonTarget,
): Promise<void> {
  const stableIdByLessonId = new Map(
    target.revision.lessons.map((lesson) => [lesson.id, lesson.stableId]),
  );
  const prerequisiteStableIds = target.lesson.prerequisiteLessonIds.map(
    (prerequisiteId) => {
      const stableId = stableIdByLessonId.get(prerequisiteId);
      if (stableId === undefined) {
        throw new Error(
          `Course prerequisite is outside the pinned revision: ${prerequisiteId}`,
        );
      }
      return stableId;
    },
  );
  const completed = await completedVersionedDayStableIds(
    state,
    target.courseId,
    target.revisionId,
  );
  if (prerequisiteStableIds.some((stableId) => !completed.has(stableId))) {
    throw new Error(
      "Learning day is locked until its declared prerequisites are completed",
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
  withTransaction(connection, () => {
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
  });
}

async function latestSessionsByDayStableId(
  state: VersionedLearningState,
  courseId: string,
  revisionId: string,
): Promise<Map<string, { id: string; status: string }>> {
  const rows = state.connection.sqlite
    .prepare(
      `SELECT day.id AS lesson_id, day.stable_id AS stable_id,
              session.id, session.status
       FROM learning_sessions session
       JOIN curriculum_days_v2 day ON day.id = session.curriculum_day_v2_id
       JOIN curriculum_versions revision ON revision.id = day.version_id
       WHERE revision.curriculum_id = ? AND revision.id = ?
       ORDER BY session.updated_at DESC, session.id DESC`,
    )
    .all(courseId, revisionId) as Array<{
    lesson_id: string;
    stable_id: string;
    id: string;
    status: string;
  }>;
  const result = new Map<string, { id: string; status: string }>();
  for (const row of rows) {
    if (result.has(row.stable_id)) continue;
    const detail = await state.repository.getVersionedSession(row.id);
    const context = await requireSessionCourseContext(state, detail);
    if (
      context.courseId !== courseId ||
      context.revisionId !== revisionId ||
      context.lessonId !== row.lesson_id
    ) {
      throw new Error("Path session has an invalid Course revision scope");
    }
    result.set(row.stable_id, { id: row.id, status: row.status });
  }
  return result;
}

function toDefinitions(units: readonly CurriculumUnit[]): UnitDefinition[] {
  return resolveExplicitUnitDefinitions(
    units.map((unit) => ({
      id: unit.id,
      stableId: unit.stableId,
      optional: unit.optional,
      prerequisiteStableIds: unit.unlockRules.map((rule) => rule.unitId),
    })),
  );
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
            : unit.type === "interview"
              ? !(
                  "interviewSessionId" in payload &&
                  typeof payload.interviewSessionId === "string" &&
                  payload.interviewSessionId !== "" &&
                  "reportId" in payload &&
                  typeof payload.reportId === "string" &&
                  payload.reportId !== "" &&
                  countCompletedInterviewAnswers(
                    connection,
                    payload.interviewSessionId,
                  ) >= (criterion.minimum ?? 1)
                )
              : evidenceAttemptCount(unit, payload) < criterion.minimum;
        break;
      case "dialogue":
        failed = !hasPersistedTeacherDialogue(
          connection,
          sessionId,
          payload,
          criterion.minimumTurns,
          criterion.requiresRevision,
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

const interviewStoredSetupSchema = z.object({
  schemaVersion: z.literal(1),
  setup: z.object({ conversationId: z.string().trim().min(1) }).passthrough(),
});

function countCompletedInterviewAnswers(
  connection: DatabaseConnection,
  interviewSessionId: string,
): number {
  const row = connection.sqlite
    .prepare(
      "SELECT result_json AS resultJson FROM interview_sessions WHERE id = ?",
    )
    .get(interviewSessionId) as { resultJson: string | null } | undefined;
  if (!row?.resultJson) return 0;
  const parsed = interviewStoredSetupSchema.safeParse(
    JSON.parse(row.resultJson),
  );
  if (!parsed.success) return 0;
  const count = connection.sqlite
    .prepare(
      `SELECT COUNT(*) AS count FROM agent_messages
       WHERE conversation_id = ? AND role = 'user' AND status = 'completed'`,
    )
    .get(parsed.data.setup.conversationId) as { count: number };
  return count.count;
}

function evidenceAttemptCount(
  unit: CurriculumUnit,
  payload: UnitProgressPayload,
): number {
  switch (payload.type) {
    case "recall":
      return payload.answers.length;
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

function hasPersistedTeacherDialogue(
  connection: DatabaseConnection,
  sessionId: string,
  payload: UnitProgressPayload,
  minimumTurns: number,
  requiresRevision: boolean,
): boolean {
  if (payload.type !== "teacher-dialogue") return false;
  const requiredTurns = Math.max(minimumTurns, requiresRevision ? 2 : 1);
  if (
    payload.turnCount < requiredTurns ||
    payload.revisionAttemptIds.length < requiredTurns
  ) {
    return false;
  }
  const counts = connection.sqlite
    .prepare(
      `SELECT
         SUM(CASE WHEN m.role = 'user' THEN 1 ELSE 0 END) AS learner_turns,
         SUM(CASE WHEN m.role = 'assistant' THEN 1 ELSE 0 END) AS teacher_turns
       FROM agent_messages m
       JOIN agent_conversations c ON c.id = m.conversation_id
       WHERE c.learning_session_id = ? AND c.role = 'teacher'
         AND m.role IN ('user', 'assistant') AND m.status = 'completed'`,
    )
    .get(sessionId) as
    { learner_turns: number | null; teacher_turns: number | null } | undefined;
  return (
    (counts?.learner_turns ?? 0) >= requiredTurns &&
    (counts?.teacher_turns ?? 0) >= requiredTurns
  );
}

function learnerTeacherMessage(content: string): string {
  const markers = [
    "\n\nОтвет ученика на уточнение Teacher:\n",
    "\n\nУточнённое объяснение ученика:\n",
  ];
  for (const marker of markers) {
    const index = content.lastIndexOf(marker);
    if (index >= 0) return content.slice(index + marker.length).trim();
  }
  return content;
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
  const firstByQuestion = firstRecallEvidenceByQuestion(unit, evidence);
  const payloadByQuestion = new Map(
    payload.answers.map((answer) => [answer.questionId, answer]),
  );
  const requiredQuestionIds = unit.questions.map((question) => question.id);
  if (requiredQuestionIds.length < minimum) return false;
  return requiredQuestionIds.every((questionId) => {
    const first = firstByQuestion.get(questionId);
    const answer = payloadByQuestion.get(questionId);
    return Boolean(
      first &&
      answer &&
      answer.firstAttemptId === first.id &&
      answer.draft === evidenceString(first.payload, "answer") &&
      answer.draft.trim(),
    );
  });
}

function firstRecallEvidenceByQuestion(
  unit: CurriculumUnit,
  evidence: Awaited<
    ReturnType<LearningRepository["listVersionedUnitEvidence"]>
  >,
): Map<string, (typeof evidence)[number]> {
  const firstByQuestion = new Map<string, (typeof evidence)[number]>();
  for (const item of evidence) {
    if (item.questionId && !firstByQuestion.has(item.questionId)) {
      firstByQuestion.set(item.questionId, item);
    }
  }
  // A legacy recall attempt had no question_id. It represented only the first
  // visible question; mapping it to every question would fabricate evidence.
  const firstQuestionId = unit.questions[0]?.id;
  const legacy = evidence.find((item) => item.questionId === null);
  if (firstQuestionId && legacy && !firstByQuestion.has(firstQuestionId)) {
    firstByQuestion.set(firstQuestionId, legacy);
  }
  return firstByQuestion;
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

async function toLearnerSession(
  state: VersionedLearningState,
  detail: VersionedSessionDetail,
) {
  const courseContext = await requireSessionCourseContext(state, detail);
  return {
    ...detail.session,
    courseContext,
    snapshot: {
      ...detail.snapshot,
      units: detail.snapshot.units.map(toLearnerUnit),
    },
    unitProgress: detail.unitProgress.map((progress) => {
      if (progress.payload.type !== "quiz") return progress;
      return {
        ...progress,
        payload: {
          type: "quiz" as const,
          attemptedQuestionIds: progress.payload.attemptedQuestionIds,
          score: progress.payload.score,
        },
      };
    }),
  };
}

function learnerKernelProvenance(
  sourceId: string,
  value: unknown,
): LearningKernelFactProvenance {
  return {
    kind: "learner_submission",
    sourceId,
    sourceHash: learningKernelSha256(value),
  };
}

interface LegacyKernelEvidenceInput {
  readonly sessionId: string;
  readonly activityId: string;
  readonly operationId: string;
  readonly sourceId: string;
  readonly observedAt: string;
  readonly source: unknown;
  readonly body: Omit<
    LearningKernelEvidenceBody,
    "activityId" | "knowledgeNodeIds" | "basisFactIds"
  >;
}

function acceptKernelLearnerEvidence(
  repository: LearningKernelRepository,
  connection: DatabaseConnection,
  input: LegacyKernelEvidenceInput,
): string {
  const operationId = `kernel:${input.operationId}:learner`;
  const existingFactId = readKernelFactId(connection, operationId);
  if (existingFactId) return existingFactId;
  const scope = repository.resolveSessionScope(input.sessionId);
  const activity = resolveLegacyKernelActivity(
    connection,
    scope,
    input.activityId,
  );
  repository.accept(scope, {
    operationId,
    factId: `kernel-fact:${input.sourceId}:learner`,
    observedAt: input.observedAt,
    provenance: learnerKernelProvenance(input.sourceId, input.source),
    body: {
      ...input.body,
      activityId: activity.id,
      knowledgeNodeIds: activity.knowledgeNodeIds,
      basisFactIds: [],
    },
  });
  return `kernel-fact:${input.sourceId}:learner`;
}

function acceptKernelEvaluatorEvidence(
  repository: LearningKernelRepository,
  connection: DatabaseConnection,
  input: LegacyKernelEvidenceInput & {
    readonly basisFactId: string;
    readonly outcome: "correct" | "incorrect";
  },
): void {
  const operationId = `kernel:${input.operationId}:evaluator`;
  if (readKernelFactId(connection, operationId)) return;
  const scope = repository.resolveSessionScope(input.sessionId);
  const activity = resolveLegacyKernelActivity(
    connection,
    scope,
    input.activityId,
  );
  const evaluation = {
    sourceId: input.sourceId,
    basisFactId: input.basisFactId,
    outcome: input.outcome,
    evaluatorVersion: "legacy-quiz-key-v1",
  };
  repository.accept(scope, {
    operationId,
    factId: `kernel-fact:${input.sourceId}:verified`,
    observedAt: input.observedAt,
    provenance: {
      kind: "deterministic_evaluator",
      sourceId: input.sourceId,
      sourceHash: learningKernelSha256(input.source),
      evaluatorVersion: evaluation.evaluatorVersion,
      checkFactId: input.basisFactId,
    },
    body: {
      ...input.body,
      activityId: activity.id,
      knowledgeNodeIds: activity.knowledgeNodeIds,
      basisFactIds: [input.basisFactId],
      outcome: input.outcome,
      ...(input.outcome === "incorrect"
        ? { errorFamily: "legacy-quiz-answer" }
        : {}),
    },
  });
}

function readKernelFactId(
  connection: DatabaseConnection,
  operationId: string,
): string | null {
  const row = connection.sqlite
    .prepare(`SELECT id FROM learning_kernel_facts WHERE operation_id = ?`)
    .get(operationId) as { id: string } | undefined;
  return row?.id ?? null;
}

function readKernelFactObservedAt(
  connection: DatabaseConnection,
  operationId: string,
): string | null {
  const row = connection.sqlite
    .prepare(
      `SELECT occurred_at FROM learning_kernel_facts WHERE operation_id = ?`,
    )
    .get(operationId) as { occurred_at: number } | undefined;
  return row ? new Date(row.occurred_at).toISOString() : null;
}

function resolveLegacyKernelActivity(
  connection: DatabaseConnection,
  scope: LearningKernelScope,
  stableActivityId: string,
): { readonly id: string; readonly knowledgeNodeIds: readonly string[] } {
  const row = connection.sqlite
    .prepare(
      `SELECT activity.id,
              CASE WHEN activity.knowledge_node_ids_json = '[]'
                   THEN lesson.topics_json
                   ELSE activity.knowledge_node_ids_json END AS knowledge_node_ids_json
       FROM course_activities activity
       JOIN course_lessons lesson
         ON lesson.course_id = activity.course_id
        AND lesson.revision_id = activity.revision_id
        AND lesson.id = activity.lesson_id
       WHERE activity.course_id = ? AND activity.revision_id = ?
         AND activity.stable_id = ?`,
    )
    .get(scope.courseId, scope.revisionId, stableActivityId) as
    { id: string; knowledge_node_ids_json: string } | undefined;
  if (!row) throw new Error("Session activity has no Course activity mapping");
  return {
    id: row.id,
    knowledgeNodeIds: z
      .array(operationIdSchema)
      .parse(JSON.parse(row.knowledge_node_ids_json)),
  };
}

function toObservedAt(value: unknown): string {
  const date =
    typeof value === "string" || typeof value === "number"
      ? new Date(value)
      : new Date();
  if (Number.isNaN(date.getTime())) {
    throw new Error("Evidence timestamp is invalid");
  }
  return date.toISOString();
}

function readLegacyHintLevel(
  connection: DatabaseConnection,
  sessionId: string,
  unitId: string,
): HintLevel {
  const row = connection.sqlite
    .prepare(
      `SELECT COALESCE(MAX(level), 0) AS level
       FROM hint_usages_v2
       WHERE session_id = ? AND unit_id = ?`,
    )
    .get(sessionId, unitId) as { level: number };
  return z.number().int().min(0).max(5).parse(row.level) as HintLevel;
}
interface LegacyKernelProgressInput {
  readonly sessionId: string;
  readonly stableActivityId: string;
  readonly operationId: string;
  readonly transition: "start" | "pause" | "complete" | "skip";
  readonly observedAt: string;
  readonly source: unknown;
}

function acceptLegacyKernelProgress(
  repository: LearningKernelRepository,
  connection: DatabaseConnection,
  input: LegacyKernelProgressInput,
): void {
  const scope = repository.resolveSessionScope(input.sessionId);
  const activity = resolveLegacyKernelActivity(
    connection,
    scope,
    input.stableActivityId,
  );
  const sourceHash = learningKernelSha256(input.source);
  repository.accept(scope, {
    operationId: `kernel:${input.operationId}:progress`,
    factId: `kernel-fact:${input.operationId}:progress`,
    observedAt: input.observedAt,
    provenance:
      input.transition === "complete"
        ? {
            kind: "deterministic_evaluator",
            sourceId: input.operationId,
            sourceHash,
            evaluatorVersion: "legacy-completion-criteria-v1",
          }
        : {
            kind: "learner_submission",
            sourceId: input.operationId,
            sourceHash,
          },
    body: {
      type: "progress",
      activityId: activity.id,
      transition: input.transition,
    },
  });
}

function isServerOwnedEvidenceUnit(
  type: CurriculumUnit["type"],
): type is "recall" | "quiz" | "code-reading" {
  return type === "recall" || type === "quiz" || type === "code-reading";
}
