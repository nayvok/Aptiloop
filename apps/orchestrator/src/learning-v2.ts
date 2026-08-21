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
  withTransaction,
  type LearningKernelRepository,
} from "@aptiloop/database";
import {
  canonicalLearningKernelJson,
  createUnitProgression,
  learningKernelSha256,
  projectCompletedLessonProgress,
  deriveDaySummary,
  isLessonComplete,
  isLearningKernelReviewDue,
  resolveExplicitUnitDefinitions,
  selectLessonNextAction,
  transitionUnitProgression,
  LearningKernelConflictError,
  type LearningKernelEvidenceBody,
  type LearningKernelFact,
  type LearningKernelFactProvenance,
  type LearningKernelScope,
  type DaySummary,
  type HintLevel,
  type LearningKernelProjection,
  type LearningKernelReviewItem,
  type LessonProgressionStatus,
  type MasteryDimension,
  type UnitDefinition,
  type UnitProgressionEvent,
} from "@aptiloop/learning-core";
import {
  CourseEntityIdSchema,
  LearningKnowledgeNodeIdSchema,
  LearningMistakesResponseSchema,
  LearningPathNextActionSchema,
  LearningReviewActivityResponseSchema,
  LearningReviewsResponseSchema,
  LearningReviewSubmissionResponseSchema,
  LearningReviewSubmissionSchema,
  UnitUnlockRuleSchema,
  CurriculumUnitSchema,
  SessionSnapshotSchema,
  UnitProgressPayloadSchema,
  UnitStatusSchema,
  type CurriculumUnit,
  type LearningPathNextAction,
  type LearningReviewSubmission,
  type LearningReviewSubmissionResponse,
  type SessionSnapshot,
  type UnitProgress,
  type UnitProgressPayload,
  type UnitStatus,
} from "@aptiloop/shared";
import type { Hono } from "hono";
import { z } from "zod";
import {
  assertLearningRevisionMutationAllowed,
  assertLearningSessionMutationAllowed,
} from "./learning-session-policy.js";
import {
  tutorTurnMessageKey,
  tutorUnitMessagePrefix,
} from "./tutor-message-scope.js";
import {
  hasAuthoritativeAcceptedReview,
  type PersistedReviewAuthorityBinding,
} from "./review-authority.js";

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
const selectCourseSchema = z
  .object({
    revisionId: CourseEntityIdSchema,
    operationId: operationIdSchema.optional(),
  })
  .strict();

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
        reviewReceiptAccepted: z.boolean().optional(),
        reviewStatus: z.null(),
        correctionCycleCount: z.literal(0),
      })
      .strict(),
  })
  .strict();

const canonicalSummaryAuthoritySchema = z
  .object({
    scope: z
      .object({
        courseId: z.string().min(1),
        revisionId: z.string().min(1),
        branchId: z.string().min(1),
        sessionId: z.string().min(1),
      })
      .strict(),
    modelVersion: z.literal("baseline-1"),
    observedAt: z.iso.datetime(),
    projectionHash: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
    sourceFactIds: z.array(z.string().min(1)).min(1),
  })
  .strict();

type CanonicalSummaryAuthority = z.infer<
  typeof canonicalSummaryAuthoritySchema
>;

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

  app.get("/api/learning/skills", async (context) =>
    context.json({
      topics: await readKernelSkills(state, kernelRepository),
    }),
  );

  app.get("/api/learning/mistakes", async (context) => {
    const asOf = observedAt();
    return context.json(
      LearningMistakesResponseSchema.parse({
        asOf,
        mistakes: await readKernelMistakes(state, kernelRepository, asOf),
      }),
    );
  });

  app.get("/api/learning/reviews", async (context) => {
    const asOf = observedAt();
    return context.json(
      LearningReviewsResponseSchema.parse({
        asOf,
        reviews: await readKernelReviews(state, kernelRepository, asOf),
      }),
    );
  });

  app.get("/api/learning/reviews/executions/:executionId", async (context) => {
    const asOf = observedAt();
    const execution = await requireReviewExecution(
      state,
      kernelRepository,
      CourseEntityIdSchema.parse(context.req.param("executionId")),
      asOf,
    );
    assertReviewExecutionAvailable(execution, asOf);
    return context.json(
      LearningReviewActivityResponseSchema.parse({
        activity: toLearningReviewActivity(state, execution),
      }),
    );
  });

  app.post(
    "/api/learning/reviews/executions/:executionId/submissions",
    async (context) => {
      const executionId = CourseEntityIdSchema.parse(
        context.req.param("executionId"),
      );
      const body = LearningReviewSubmissionSchema.parse(
        await context.req.json(),
      );
      const at = observedAt();
      const replay = await readExistingReviewSubmission(
        state,
        kernelRepository,
        executionId,
        body,
        at,
      );
      if (replay) return context.json(replay, 200);
      const execution = await requireReviewExecution(
        state,
        kernelRepository,
        executionId,
        at,
      );
      assertReviewExecutionAvailable(execution, at);
      if (body.executionContextHash !== execution.executionContextHash) {
        throw new LearningKernelConflictError(
          "Review execution context is stale or mismatched",
        );
      }

      const result = withTransaction(state.connection, () => {
        const submitFactId = reviewSubmitFactId(body.operationId);
        const submit = kernelRepository.accept(execution.scope, {
          operationId: reviewSubmitOperationId(body.operationId),
          factId: submitFactId,
          observedAt: at,
          provenance: learnerKernelProvenance(executionId, {
            executionId,
            operationId: body.operationId,
            activitySnapshotHash: execution.snapshot.contentHash,
            response: body.response,
          }),
          body: {
            type: "review",
            activityId: execution.activity.id,
            reviewItemId: execution.review.id,
            transition: "submit",
            response: body.response.text,
            activitySnapshotHash: kernelHash(execution.snapshot.contentHash),
            executionContextHash: body.executionContextHash,
          },
        });
        const complete = kernelRepository.accept(execution.scope, {
          operationId: reviewCompleteOperationId(body.operationId),
          factId: reviewCompleteFactId(body.operationId),
          observedAt: at,
          provenance: {
            kind: "deterministic_evaluator",
            sourceId: executionId,
            sourceHash: learningKernelSha256({
              executionId,
              submitFactId,
              activitySnapshotHash: execution.snapshot.contentHash,
              evaluatorVersion: "review-participation-v1",
            }),
            evaluatorVersion: "review-participation-v1",
          },
          body: {
            type: "review",
            activityId: execution.activity.id,
            reviewItemId: execution.review.id,
            transition: "complete",
            completionEvidenceFactId: submitFactId,
          },
        });
        const result = {
          idempotent: submit.idempotent && complete.idempotent,
          projection: complete.projection,
          submitFactId,
          completeFactId: reviewCompleteFactId(body.operationId),
        };
        return {
          idempotent: result.idempotent,
          response: buildReviewSubmissionResponse(
            result.projection,
            execution.review.id,
            result.submitFactId,
            result.completeFactId,
            result.idempotent,
            true,
          ),
        };
      });
      return context.json(result.response, result.idempotent ? 200 : 201);
    },
  );

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
      return context.json(
        await readLearnerPath(
          state,
          kernelRepository,
          observedAt(),
          courseId,
          revisionId,
        ),
      );
    },
  );

  app.post("/api/learning/courses/:courseId/select", async (context) => {
    const courseId = CourseEntityIdSchema.parse(context.req.param("courseId"));
    const body = selectCourseSchema.parse(await context.req.json());
    await requireOwnedCourseRevision(state, courseId, body.revisionId, true);
    await state.repository.selectCourse({
      courseId,
      revisionId: body.revisionId,
    });
    return context.json({
      selected: true,
      courseId,
      revisionId: body.revisionId,
    });
  });

  app.get("/api/learning/path", async (context) => {
    const target = await readCompatibilityCourseTarget(state);
    return context.json(
      target
        ? await readLearnerPath(
            state,
            kernelRepository,
            observedAt(),
            target.courseId,
            target.revisionId,
          )
        : { curriculum: null, courseContext: null, nextAction: null },
    );
  });

  app.get("/api/learning/sessions/current", async (context) => {
    const courseId = context.req.query("courseId");
    const current = await state.repository.getCurrentVersionedSession(
      courseId === undefined ? undefined : CourseEntityIdSchema.parse(courseId),
    );
    return context.json({
      session: current ? await toLearnerSession(state, current) : null,
    });
  });

  app.post("/api/learning/sessions/v2", async (context) => {
    const body = startSessionSchema.parse(await context.req.json());
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
    "/api/learning/sessions/v2/:id/units/:unitId/teacher-transcript",
    async (context) => {
      const sessionId = context.req.param("id");
      const unitId = context.req.param("unitId");
      const detail = await requireVerifiedSessionDetail(state, sessionId);
      const unit = detail.snapshot.units.find((item) => item.id === unitId);
      if (!unit || unit.type !== "teacher-dialogue") {
        throw new Error("Unknown teacher-dialogue unit");
      }
      const messages = state.connection.sqlite
        .prepare(
          `SELECT m.id, m.role, m.content
           FROM agent_messages m
           JOIN agent_conversations c ON c.id = m.conversation_id
           WHERE c.learning_session_id = ? AND c.role = 'teacher'
             AND m.role IN ('user', 'assistant') AND m.status = 'completed'
             AND m.idempotency_key LIKE ? ESCAPE '\\'
           ORDER BY c.created_at ASC, m.sequence ASC`,
        )
        .all(sessionId, `${tutorUnitMessagePrefix(unitId)}%`) as Array<{
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
    async (context) => {
      const body = recallAttemptSchema.parse(await context.req.json());
      const result = withTransaction(state.connection, () => {
        const sessionId = context.req.param("id");
        const unitId = context.req.param("unitId");
        const unit = requireEvidenceTarget(
          state.repository.getVersionedSession(sessionId),
          unitId,
          "recall",
        );
        if (
          !unit.questions.some((question) => question.id === body.questionId)
        ) {
          throw new Error("Unknown recall question");
        }
        const recorded = state.repository.recordVersionedUnitEvidence({
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
        const attempts = state.repository.listVersionedUnitEvidence(sessionId, {
          unitId,
          evidenceType: "recall-attempt",
        });
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
        state.repository.updateUnitProgress({
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
        return {
          evidence: {
            id: recorded.id,
            isFirstAttempt: recorded.id === first.id,
            questionId: body.questionId,
          },
          detail: state.repository.getVersionedSession(sessionId),
        };
      });
      return context.json(
        {
          evidence: result.evidence,
          session: await toLearnerSession(state, result.detail),
        },
        201,
      );
    },
  );

  app.post(
    "/api/learning/sessions/v2/:id/units/:unitId/quiz-attempts",
    async (context) => {
      const body = quizAttemptSchema.parse(await context.req.json());
      const result = withTransaction(state.connection, () => {
        const sessionId = context.req.param("id");
        const unitId = context.req.param("unitId");
        const unit = requireEvidenceTarget(
          state.repository.getVersionedSession(sessionId),
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
          const evidence = state.repository.recordVersionedUnitEvidence({
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
        const evidence = state.repository.listVersionedUnitEvidence(sessionId, {
          unitId,
          evidenceType: "quiz-answer",
        });
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
        state.repository.updateUnitProgress({
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
        return {
          attempt: {
            operationId: body.operationId,
            score,
            results: submitted.map(({ questionId, correct }) => ({
              questionId,
              correct,
            })),
          },
          detail: state.repository.getVersionedSession(sessionId),
        };
      });
      return context.json(
        {
          attempt: result.attempt,
          session: await toLearnerSession(state, result.detail),
        },
        201,
      );
    },
  );

  app.post(
    "/api/learning/sessions/v2/:id/units/:unitId/code-reading-attempts",
    async (context) => {
      const body = codeReadingAttemptSchema.parse(await context.req.json());
      const result = withTransaction(state.connection, () => {
        const sessionId = context.req.param("id");
        const unitId = context.req.param("unitId");
        const unit = requireEvidenceTarget(
          state.repository.getVersionedSession(sessionId),
          unitId,
          "code-reading",
        );
        const evidence = state.repository.recordVersionedUnitEvidence({
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
        state.repository.updateUnitProgress({
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
        return {
          evidence: { id: evidence.id },
          detail: state.repository.getVersionedSession(sessionId),
        };
      });
      return context.json(
        {
          evidence: result.evidence,
          session: await toLearnerSession(state, result.detail),
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
      const detail = await requireVerifiedSessionDetail(state, sessionId);
      const persisted = readPersistedSummary(
        state.connection,
        kernelRepository,
        detail,
        unitId,
      );
      return context.json({
        summary: persisted.summary,
        authority: persisted.authority,
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
      const result = withTransaction(state.connection, () => {
        const detail = state.repository.getVersionedSession(sessionId);
        requireCurrentSummaryTarget(detail, unitId);

        const operationId = summaryOperationId(body.operationId);
        const existingByOperation = state.connection.sqlite
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
        const existingForUnit = state.connection.sqlite
          .prepare(
            `SELECT id, session_id, unit_id, payload_json
             FROM versioned_unit_evidence
             WHERE session_id = ? AND unit_id = ? AND evidence_type = 'summary'
             ORDER BY created_at, id`,
          )
          .all(sessionId, unitId) as Array<{
          id: string;
          session_id: string;
          unit_id: string;
          payload_json: string;
        }>;
        if (existingForUnit.length > 1) {
          throw new Error(
            "Summary evidence identity is ambiguous for this unit",
          );
        }
        if (
          existingByOperation &&
          (existingByOperation.session_id !== sessionId ||
            existingByOperation.unit_id !== unitId)
        ) {
          throw new Error(
            "Operation ID is already associated with a different summary",
          );
        }
        const existing = existingByOperation ?? existingForUnit[0];
        if (
          existingByOperation &&
          existingForUnit[0] &&
          existingByOperation.id !== existingForUnit[0].id
        ) {
          throw new Error(
            "Summary evidence identity conflicts with operation ID",
          );
        }

        if (existing) {
          const persisted = parsePersistedSummary(existing.payload_json);
          return {
            summary: persisted.summary,
            authority: verifyPersistedSummaryAuthority(
              kernelRepository,
              detail,
              persisted.authority ??
                projectCanonicalSummaryAuthority(
                  kernelRepository,
                  detail,
                  persisted.summary.occurredAt,
                  readSummaryEvidenceCreatedAt(state.connection, existing.id),
                ),
            ),
            evidenceId: existing.id,
          };
        }

        const topicIds = resolveSummaryKnowledgeNodeIds(
          kernelRepository,
          detail,
        );
        const summary = derivePersistedDaySummary(
          state.connection,
          state.repository,
          detail,
          topicIds,
        );
        const authority = projectCanonicalSummaryAuthority(
          kernelRepository,
          detail,
          summary.occurredAt,
        );
        const evidence = state.repository.recordVersionedUnitEvidence({
          sessionId,
          unitId,
          evidenceType: "summary",
          operationId,
          payload: { summary, authority },
        });
        return { summary, authority, evidenceId: evidence.id };
      });

      return context.json(
        {
          summary: result.summary,
          authority: result.authority,
          evidence: { id: result.evidenceId },
          session: await toLearnerSession(
            state,
            await state.repository.getVersionedSession(sessionId),
          ),
        },
        201,
      );
    },
  );

  app.patch("/api/learning/sessions/v2/:id/units/:unitId", async (context) => {
    const body = updateUnitSchema.parse(await context.req.json());
    const result = withTransaction(state.connection, () => {
      const sessionId = context.req.param("id");
      const unitId = context.req.param("unitId");
      const detail = state.repository.getVersionedSession(sessionId);
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
        : unit.type === "summary" && body.status === "completed"
          ? body.payload
          : (body.payload ?? current.payload);
      if (!payload) throw new Error("Unit progress payload is required");

      if (body.status === current.status) {
        if (current.status === "completed") {
          assertCompletionCriteria(
            state.connection,
            state.repository,
            sessionId,
            unit,
            payload,
            detail.unitProgress,
            detail.snapshot.units,
            kernelRepository,
          );
        }
        state.repository.updateUnitProgress({
          sessionId,
          unitId,
          status: current.status,
          progress: payload,
        });
        return state.repository.getVersionedSession(sessionId);
      }

      const event = transitionEvent(current.status, body.status, unitId);
      if (!event) throw new Error("Unit transition is not allowed");
      if (event.type === "complete") {
        assertCompletionCriteria(
          state.connection,
          state.repository,
          sessionId,
          unit,
          payload,
          detail.unitProgress,
          detail.snapshot.units,
          kernelRepository,
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
      return state.repository.getVersionedSession(sessionId);
    });
    return context.json({ session: await toLearnerSession(state, result) });
  });
}

interface PathCourseTarget {
  courseId: string;
  revisionId: string;
}

interface RevisionLearningSummary {
  state: "not-started" | "in-progress" | "completed";
  completedLessons: number;
  totalLessons: number;
  progressPercent: number;
  lastActivityAt: string | null;
}

interface RevisionLearningSummaryRow {
  course_id: string;
  revision_id: string;
  total_lessons: number;
  completed_lessons: number;
  has_active_session: number;
  last_activity_at: number | null;
}

function courseRevisionKey(courseId: string, revisionId: string): string {
  return `${courseId}\u0000${revisionId}`;
}

function readRevisionLearningSummaries(
  state: VersionedLearningState,
): Map<string, RevisionLearningSummary> {
  const rows = state.connection.sqlite
    .prepare(
      `WITH lesson_totals AS (
         SELECT course_id, revision_id, COUNT(*) AS total_lessons
         FROM course_lessons
         GROUP BY course_id, revision_id
       ), session_totals AS (
         SELECT context.course_id, context.revision_id,
                COUNT(DISTINCT CASE
                  WHEN session.status = 'completed' THEN context.lesson_id
                END) AS completed_lessons,
                MAX(CASE WHEN session.status = 'active' THEN 1 ELSE 0 END)
                  AS has_active_session,
                MAX(session.updated_at) AS last_activity_at
         FROM session_course_contexts context
         JOIN learning_sessions session ON session.id = context.session_id
         GROUP BY context.course_id, context.revision_id
       )
       SELECT revision.course_id, revision.id AS revision_id,
              COALESCE(lesson.total_lessons, 0) AS total_lessons,
              COALESCE(session.completed_lessons, 0) AS completed_lessons,
              COALESCE(session.has_active_session, 0) AS has_active_session,
              session.last_activity_at
       FROM course_revisions revision
       LEFT JOIN lesson_totals lesson
         ON lesson.course_id = revision.course_id
        AND lesson.revision_id = revision.id
       LEFT JOIN session_totals session
         ON session.course_id = revision.course_id
        AND session.revision_id = revision.id`,
    )
    .all() as unknown as RevisionLearningSummaryRow[];

  return new Map(
    rows.map((row) => {
      const totalLessons = row.total_lessons;
      const completedLessons = Math.min(row.completed_lessons, totalLessons);
      const progressPercent =
        totalLessons === 0
          ? 0
          : Math.min(
              100,
              Math.max(0, Math.round((completedLessons / totalLessons) * 100)),
            );
      const summary: RevisionLearningSummary = {
        state:
          totalLessons > 0 && completedLessons === totalLessons
            ? "completed"
            : row.has_active_session === 1
              ? "in-progress"
              : "not-started",
        completedLessons,
        totalLessons,
        progressPercent,
        lastActivityAt:
          row.last_activity_at === null
            ? null
            : new Date(row.last_activity_at).toISOString(),
      };
      return [
        courseRevisionKey(row.course_id, row.revision_id),
        summary,
      ] as const;
    }),
  );
}

function requireRevisionLearningSummary(
  summaries: ReadonlyMap<string, RevisionLearningSummary>,
  courseId: string,
  revisionId: string,
): RevisionLearningSummary {
  const summary = summaries.get(courseRevisionKey(courseId, revisionId));
  if (!summary) {
    throw new Error(
      `Missing learning summary for Course revision ${revisionId}`,
    );
  }
  return summary;
}

async function readCourseCollection(state: VersionedLearningState) {
  const courses = await state.courseFoundationRepository.listCourses();
  const summaries = readRevisionLearningSummaries(state);
  const states = new Map(
    (
      state.connection.sqlite
        .prepare(
          `SELECT course_id, active_revision_id, current_learning_session_id,
                  is_selected
           FROM learner_course_states`,
        )
        .all() as Array<{
        course_id: string;
        active_revision_id: string;
        current_learning_session_id: string | null;
        is_selected: number;
      }>
    ).map((entry) => [entry.course_id, entry]),
  );
  return courses
    .map((course) => {
      const learnerState = states.get(course.id);
      return {
        id: course.id,
        stableId: course.stableId,
        title: course.title,
        description: course.description,
        primaryLocale: course.primaryLocale,
        selected: learnerState?.is_selected === 1,
        activeRevisionId: learnerState?.active_revision_id ?? null,
        currentSessionId: learnerState?.current_learning_session_id ?? null,
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
            learningSummary: requireRevisionLearningSummary(
              summaries,
              course.id,
              revision.id,
            ),
          })),
      };
    })
    .sort((left, right) =>
      left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
    );
}

interface KernelProjectionRecord {
  readonly scope: LearningKernelScope;
  readonly projection: LearningKernelProjection;
}

const masteryDimensions = [
  "understanding",
  "explanation",
  "codeReading",
  "implementation",
  "debugging",
  "interview",
] as const satisfies readonly MasteryDimension[];

async function readSelectedKernelProjections(
  state: VersionedLearningState,
  kernelRepository: LearningKernelRepository,
): Promise<KernelProjectionRecord[]> {
  const target = await state.repository.getSelectedCourseTarget();
  if (!target) return [];
  const rows = state.connection.sqlite
    .prepare(
      `SELECT session_id, course_id, revision_id, branch_id
       FROM learning_kernel_projections
       WHERE course_id = ? AND revision_id = ?
       ORDER BY observed_at, session_id`,
    )
    .all(target.courseId, target.revisionId) as Array<{
    session_id: string;
    course_id: string;
    revision_id: string;
    branch_id: string;
  }>;
  return rows.flatMap((row) => {
    const scope = {
      sessionId: row.session_id,
      courseId: row.course_id,
      revisionId: row.revision_id,
      branchId: row.branch_id,
    } satisfies LearningKernelScope;
    const projection = kernelRepository.readProjection(scope);
    return projection ? [{ scope, projection }] : [];
  });
}

function readKnowledgeNode(
  state: VersionedLearningState,
  revisionId: string,
  knowledgeNodeId: string,
): { title: string; group: string } {
  const node = state.connection.sqlite
    .prepare(
      `SELECT title, description
       FROM course_pack_knowledge_nodes
       WHERE revision_id = ? AND knowledge_node_id = ?`,
    )
    .get(revisionId, knowledgeNodeId) as
    { title: string; description: string } | undefined;
  return {
    title: node?.title ?? knowledgeNodeId,
    group: node?.description ?? "Course knowledge node",
  };
}

async function readKernelSkills(
  state: VersionedLearningState,
  kernelRepository: LearningKernelRepository,
) {
  const records = await readSelectedKernelProjections(state, kernelRepository);
  const target = await state.repository.getSelectedCourseTarget();
  if (!target) return [];
  const topics = new Map<
    string,
    {
      scores: Record<MasteryDimension, number>;
      latestAt: Record<MasteryDimension, string>;
      evidence: Set<string>;
      reviewDue: boolean;
    }
  >();
  const getTopic = (knowledgeNodeId: string) => {
    let topic = topics.get(knowledgeNodeId);
    if (!topic) {
      topic = {
        scores: Object.fromEntries(
          masteryDimensions.map((dimension) => [dimension, 0]),
        ) as Record<MasteryDimension, number>,
        latestAt: Object.fromEntries(
          masteryDimensions.map((dimension) => [dimension, ""]),
        ) as Record<MasteryDimension, string>,
        evidence: new Set<string>(),
        reviewDue: false,
      };
      topics.set(knowledgeNodeId, topic);
    }
    return topic;
  };
  const now = Date.now();
  for (const { projection } of records) {
    for (const [knowledgeNodeId, mastery] of Object.entries(
      projection.masteryByKnowledgeNode,
    )) {
      const topic = getTopic(knowledgeNodeId);
      for (const dimension of masteryDimensions) {
        const candidate = mastery[dimension];
        candidate.sourceFactIds.forEach((id) => topic.evidence.add(id));
        const latestAt =
          candidate.state.lastEvidenceAt ?? projection.observedAt;
        if (latestAt >= topic.latestAt[dimension]) {
          topic.latestAt[dimension] = latestAt;
          topic.scores[dimension] = candidate.state.score;
        }
      }
    }
    for (const review of projection.reviewItems) {
      if (review.state === "pending" && Date.parse(review.dueAt) <= now) {
        getTopic(review.knowledgeNodeId).reviewDue = true;
      }
    }
  }
  return [...topics.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, topic]) => ({
      id,
      ...readKnowledgeNode(state, target.revisionId, id),
      scores: topic.scores,
      evidenceCount: topic.evidence.size,
      reviewDue: topic.reviewDue,
    }));
}

async function readKernelMistakes(
  state: VersionedLearningState,
  kernelRepository: LearningKernelRepository,
  asOf: string,
) {
  const records = await readSelectedKernelProjections(state, kernelRepository);
  const target = await state.repository.getSelectedCourseTarget();
  if (!target) return [];
  const mistakes = new Map<
    string,
    LearningKernelProjection["mistakes"][number]
  >();
  const reviews: LearningKernelReviewItem[] = [];
  for (const { projection } of records) {
    for (const mistake of projection.mistakes) {
      const current = mistakes.get(mistake.fingerprint);
      if (!current || current.latestOccurrenceAt < mistake.latestOccurrenceAt) {
        mistakes.set(mistake.fingerprint, mistake);
      }
    }
    reviews.push(...projection.reviewItems);
  }
  return [...mistakes.values()]
    .filter((mistake) => mistake.status === "open")
    .sort((left, right) =>
      right.latestOccurrenceAt.localeCompare(left.latestOccurrenceAt),
    )
    .map((mistake) => {
      const scheduledReview = reviews
        .filter(
          (review) =>
            review.knowledgeNodeId === mistake.knowledgeNodeId &&
            review.reasonCode === "mistake" &&
            review.state === "pending",
        )
        .sort(
          (left, right) =>
            left.dueAt.localeCompare(right.dueAt) ||
            left.id.localeCompare(right.id),
        )[0];
      return {
        id: mistake.fingerprint,
        topic: readKnowledgeNode(
          state,
          target.revisionId,
          mistake.knowledgeNodeId,
        ).title,
        errorFamily: mistake.errorFamily,
        occurrenceCount: mistake.occurrenceFactIds.length,
        reviewAt: scheduledReview?.dueAt ?? mistake.latestOccurrenceAt,
        isDue:
          scheduledReview !== undefined &&
          isLearningKernelReviewDue(scheduledReview, asOf),
      };
    });
}

async function readKernelReviews(
  state: VersionedLearningState,
  kernelRepository: LearningKernelRepository,
  asOf: string,
) {
  const records = await readSelectedKernelProjections(state, kernelRepository);
  const target = await state.repository.getSelectedCourseTarget();
  if (!target) return [];
  const latest = new Map<
    string,
    {
      review: LearningKernelReviewItem;
      scope: LearningKernelScope;
      observedAt: string;
    }
  >();
  for (const { scope, projection } of records) {
    for (const review of projection.reviewItems) {
      const key = reviewScopeKey(scope, review.id);
      const current = latest.get(key);
      if (!current || current.observedAt <= projection.observedAt) {
        latest.set(key, {
          review,
          scope,
          observedAt: projection.observedAt,
        });
      }
    }
  }
  return [...latest.values()]
    .sort(
      (left, right) =>
        left.review.dueAt.localeCompare(right.review.dueAt) ||
        left.review.id.localeCompare(right.review.id),
    )
    .map(({ review, scope }) => {
      const source = readReviewSource(state.connection, scope, review);
      const activityId = source?.activityId ?? null;
      const isDue = isLearningKernelReviewDue(review, asOf);
      const snapshot = activityId
        ? readVerifiedReviewSnapshot(state, scope, activityId)
        : null;
      return {
        id: review.id,
        topic: readKnowledgeNode(
          state,
          target.revisionId,
          review.knowledgeNodeId,
        ).title,
        knowledgeNodeId: review.knowledgeNodeId,
        dimension: review.dimension,
        activityKind: review.activityKind,
        reasonCode: review.reasonCode,
        dueAt: review.dueAt,
        state: review.state,
        isDue,
        sessionId: scope.sessionId,
        activityId,
        execution:
          isDue && activityId && snapshot
            ? {
                id: reviewExecutionId(scope, review.id),
                type: "free-response" as const,
                schemaVersion: 1 as const,
                activitySnapshotHash: snapshot.snapshot.contentHash,
              }
            : null,
      };
    });
}

interface ReviewExecution {
  readonly scope: LearningKernelScope;
  readonly review: LearningKernelReviewItem;
  readonly activity: CurriculumUnit;
  readonly snapshot: SessionSnapshot;
  readonly sourceEvidenceAt: string;
  readonly executionContextHash: string;
}

async function requireReviewExecution(
  state: VersionedLearningState,
  kernelRepository: LearningKernelRepository,
  executionId: string,
  asOf: string,
): Promise<ReviewExecution> {
  const records = await readSelectedKernelProjections(state, kernelRepository);
  const matches: ReviewExecution[] = [];
  for (const { scope } of records) {
    const projection = kernelRepository.reproject(scope, asOf);
    for (const review of projection.reviewItems) {
      if (reviewExecutionId(scope, review.id) !== executionId) continue;
      const source = readReviewSource(state.connection, scope, review);
      if (!source) throw new Error("Review source activity is unavailable");
      const verified = readVerifiedReviewSnapshot(
        state,
        scope,
        source.activityId,
      );
      if (!verified) throw new Error("Review activity snapshot is unavailable");
      matches.push({
        scope,
        review,
        activity: verified.activity,
        snapshot: verified.snapshot,
        sourceEvidenceAt: source.occurredAt,
        executionContextHash: reviewExecutionContextHash({
          executionId,
          scope,
          reviewItemId: review.id,
          source,
          activityId: verified.activity.id,
          activitySnapshotHash: verified.snapshot.contentHash,
        }),
      });
    }
  }
  if (matches.length !== 1) {
    throw new Error(
      matches.length === 0
        ? "Unknown Review execution"
        : "Review execution identity is ambiguous",
    );
  }
  return matches[0]!;
}

function assertReviewExecutionAvailable(
  execution: ReviewExecution,
  asOf: string,
): void {
  if (!isLearningKernelReviewDue(execution.review, asOf)) {
    throw new Error("Review execution is no longer pending and due");
  }
}

function toLearningReviewActivity(
  state: VersionedLearningState,
  execution: ReviewExecution,
) {
  const node = readKnowledgeNode(
    state,
    execution.scope.revisionId,
    execution.review.knowledgeNodeId,
  );
  return {
    executionId: reviewExecutionId(execution.scope, execution.review.id),
    schemaVersion: 1 as const,
    activitySnapshotHash: execution.snapshot.contentHash,
    executionContextHash: execution.executionContextHash,
    title: node.title,
    description: execution.activity.description,
    prompt:
      execution.activity.type === "recall" &&
      execution.activity.payload.type === "recall"
        ? execution.activity.payload.prompt
        : (execution.activity.questions[0]?.prompt ??
          execution.activity.description),
    dueAt: execution.review.dueAt,
    sourceEvidenceAt: execution.sourceEvidenceAt,
    sourceActivityType: execution.activity.type,
    dimension: execution.review.dimension,
    activityKind: execution.review.activityKind,
    reasonCode: execution.review.reasonCode,
    response: {
      type: "free-response" as const,
      minimumLength: 1 as const,
      maximumLength: 50_000 as const,
    },
  };
}

async function readExistingReviewSubmission(
  state: VersionedLearningState,
  kernelRepository: LearningKernelRepository,
  executionId: string,
  submission: LearningReviewSubmission,
  asOf: string,
): Promise<LearningReviewSubmissionResponse | null> {
  const submitOperationId = reviewSubmitOperationId(submission.operationId);
  const completeOperationId = reviewCompleteOperationId(submission.operationId);
  const submitFactId = reviewSubmitFactId(submission.operationId);
  const completeFactId = reviewCompleteFactId(submission.operationId);
  const rows = state.connection.sqlite
    .prepare(
      `SELECT id, operation_id, session_id, course_id, revision_id, branch_id
       FROM learning_kernel_facts
       WHERE id IN (?, ?) OR operation_id IN (?, ?)
       ORDER BY id`,
    )
    .all(
      submitFactId,
      completeFactId,
      submitOperationId,
      completeOperationId,
    ) as Array<{
    id: string;
    operation_id: string;
    session_id: string;
    course_id: string;
    revision_id: string;
    branch_id: string;
  }>;
  if (rows.length === 0) return null;

  const submitRow = rows.find(
    (row) => row.id === submitFactId && row.operation_id === submitOperationId,
  );
  const completeRow = rows.find(
    (row) =>
      row.id === completeFactId && row.operation_id === completeOperationId,
  );
  if (!submitRow || !completeRow || rows.length !== 2) {
    throw reviewSubmissionConflict();
  }
  const scope = {
    courseId: submitRow.course_id,
    revisionId: submitRow.revision_id,
    branchId: submitRow.branch_id,
    sessionId: submitRow.session_id,
  } satisfies LearningKernelScope;
  if (
    completeRow.course_id !== scope.courseId ||
    completeRow.revision_id !== scope.revisionId ||
    completeRow.branch_id !== scope.branchId ||
    completeRow.session_id !== scope.sessionId
  ) {
    throw reviewSubmissionConflict();
  }
  const selected = await readSelectedKernelProjections(state, kernelRepository);
  if (!selected.some((record) => sameKernelScope(record.scope, scope))) {
    throw new Error("Unknown Review execution");
  }

  const facts = kernelRepository.readFacts(scope);
  const submit = facts.find((fact) => fact.id === submitFactId);
  const complete = facts.find((fact) => fact.id === completeFactId);
  if (
    !submit ||
    !complete ||
    submit.operationId !== submitOperationId ||
    complete.operationId !== completeOperationId ||
    submit.body.type !== "review" ||
    submit.body.transition !== "submit" ||
    submit.body.executionContextHash !== submission.executionContextHash ||
    complete.body.type !== "review" ||
    complete.body.transition !== "complete" ||
    complete.body.reviewItemId !== submit.body.reviewItemId ||
    complete.body.activityId !== submit.body.activityId ||
    complete.body.completionEvidenceFactId !== submit.id ||
    complete.occurredAt !== submit.occurredAt ||
    reviewExecutionId(scope, submit.body.reviewItemId) !== executionId
  ) {
    throw reviewSubmissionConflict();
  }
  const verified = readVerifiedReviewSnapshot(
    state,
    scope,
    submit.body.activityId,
  );
  if (!verified) throw new Error("Review activity snapshot is unavailable");

  const expectedSubmit: LearningKernelFact = {
    schemaVersion: 1,
    ...scope,
    id: submitFactId,
    operationId: submitOperationId,
    occurredAt: submit.occurredAt,
    provenance: learnerKernelProvenance(executionId, {
      executionId,
      operationId: submission.operationId,
      activitySnapshotHash: verified.snapshot.contentHash,
      response: submission.response,
    }),
    body: {
      type: "review",
      activityId: verified.activity.id,
      reviewItemId: submit.body.reviewItemId,
      transition: "submit",
      response: submission.response.text,
      activitySnapshotHash: kernelHash(verified.snapshot.contentHash),
      executionContextHash: submission.executionContextHash,
    },
  };
  const expectedComplete: LearningKernelFact = {
    schemaVersion: 1,
    ...scope,
    id: completeFactId,
    operationId: completeOperationId,
    occurredAt: submit.occurredAt,
    provenance: {
      kind: "deterministic_evaluator",
      sourceId: executionId,
      sourceHash: learningKernelSha256({
        executionId,
        submitFactId,
        activitySnapshotHash: verified.snapshot.contentHash,
        evaluatorVersion: "review-participation-v1",
      }),
      evaluatorVersion: "review-participation-v1",
    },
    body: {
      type: "review",
      activityId: verified.activity.id,
      reviewItemId: submit.body.reviewItemId,
      transition: "complete",
      completionEvidenceFactId: submitFactId,
    },
  };
  if (
    canonicalLearningKernelJson(submit) !==
    canonicalLearningKernelJson(expectedSubmit)
  ) {
    throw reviewSubmissionConflict();
  }
  if (
    canonicalLearningKernelJson(complete) !==
    canonicalLearningKernelJson(expectedComplete)
  ) {
    throw reviewSubmissionConflict();
  }
  return buildReviewSubmissionResponse(
    kernelRepository.reproject(scope, asOf),
    submit.body.reviewItemId,
    submitFactId,
    completeFactId,
    true,
    false,
  );
}

function buildReviewSubmissionResponse(
  projection: LearningKernelProjection,
  completedReviewItemId: string,
  submitFactId: string,
  completeFactId: string,
  idempotent: boolean,
  requirePendingSuccessor: boolean,
): LearningReviewSubmissionResponse {
  const completed = projection.reviewItems.find(
    (review) => review.id === completedReviewItemId,
  );
  const nextReview = projection.reviewItems
    .filter(
      (review) =>
        review.id !== completedReviewItemId &&
        (!requirePendingSuccessor || review.state === "pending") &&
        review.sourceFactIds.includes(completeFactId),
    )
    .sort(
      (left, right) =>
        left.dueAt.localeCompare(right.dueAt) ||
        left.id.localeCompare(right.id),
    )[0];
  if (
    completed?.state !== "completed" ||
    completed.completionEvidenceId !== submitFactId ||
    !nextReview
  ) {
    throw new Error(
      "Review submission did not produce a completed cycle and successor",
    );
  }
  return LearningReviewSubmissionResponseSchema.parse({
    idempotent,
    completedReviewItemId: completed.id,
    completionEvidenceId: submitFactId,
    nextReview: { id: nextReview.id, dueAt: nextReview.dueAt },
  });
}

function sameKernelScope(
  left: LearningKernelScope,
  right: LearningKernelScope,
): boolean {
  return (
    left.courseId === right.courseId &&
    left.revisionId === right.revisionId &&
    left.branchId === right.branchId &&
    left.sessionId === right.sessionId
  );
}

function reviewSubmissionConflict(): LearningKernelConflictError {
  return new LearningKernelConflictError(
    "Learning Kernel operation ID is already bound to different input",
  );
}

function readVerifiedReviewSnapshot(
  state: VersionedLearningState,
  scope: LearningKernelScope,
  activityId: string,
): { snapshot: SessionSnapshot; activity: CurriculumUnit } | null {
  const row = state.connection.sqlite
    .prepare(
      `SELECT context.course_id, context.revision_id, context.lesson_id,
              context.snapshot_hash, snapshot.content_hash,
              snapshot.snapshot_json
       FROM session_course_contexts context
       JOIN session_snapshots snapshot ON snapshot.session_id = context.session_id
       WHERE context.session_id = ?`,
    )
    .get(scope.sessionId) as
    | {
        course_id: string;
        revision_id: string;
        lesson_id: string;
        snapshot_hash: string;
        content_hash: string;
        snapshot_json: string;
      }
    | undefined;
  if (
    !row ||
    row.course_id !== scope.courseId ||
    row.revision_id !== scope.revisionId ||
    row.snapshot_hash !== row.content_hash
  ) {
    return null;
  }
  const snapshot = SessionSnapshotSchema.parse(JSON.parse(row.snapshot_json));
  const { contentHash: embeddedHash, ...snapshotCore } = snapshot;
  if (
    embeddedHash !== row.snapshot_hash ||
    hashCanonicalJson(snapshotCore) !== row.snapshot_hash ||
    snapshot.curriculumId !== scope.courseId ||
    snapshot.curriculumVersionId !== scope.revisionId ||
    snapshot.day.id !== row.lesson_id
  ) {
    return null;
  }
  const activity = snapshot.units.find((unit) => unit.id === activityId);
  if (!activity) return null;
  const target = state.connection.sqlite
    .prepare(
      `SELECT activity_type, stable_id FROM course_activities
       WHERE course_id = ? AND revision_id = ? AND lesson_id = ? AND id = ?`,
    )
    .get(scope.courseId, scope.revisionId, row.lesson_id, activityId) as
    { activity_type: string; stable_id: string } | undefined;
  return target &&
    target.activity_type === activity.type &&
    target.stable_id === activity.stableId
    ? { snapshot, activity }
    : null;
}

function readReviewSource(
  connection: DatabaseConnection,
  scope: LearningKernelScope,
  review: LearningKernelReviewItem,
): {
  readonly factId: string;
  readonly factHash: string;
  readonly activityId: string;
  readonly occurredAt: string;
} | null {
  if (review.sourceFactIds.length === 0) return null;
  const rows = connection.sqlite
    .prepare(
      `SELECT canonical_json, fact_hash, occurred_at FROM learning_kernel_facts
       WHERE session_id = ? AND course_id = ? AND revision_id = ?
         AND branch_id = ?
         AND id IN (${review.sourceFactIds.map(() => "?").join(", ")})
       ORDER BY occurred_at DESC, id DESC`,
    )
    .all(
      scope.sessionId,
      scope.courseId,
      scope.revisionId,
      scope.branchId,
      ...review.sourceFactIds,
    ) as Array<{
    canonical_json: string;
    fact_hash: string;
    occurred_at: number;
  }>;
  const row = rows[0];
  if (!row) return null;
  const fact = JSON.parse(row.canonical_json) as LearningKernelFact;
  if (
    canonicalLearningKernelJson(fact) !== row.canonical_json ||
    learningKernelSha256(fact) !== row.fact_hash ||
    Date.parse(fact.occurredAt) !== row.occurred_at
  ) {
    throw new Error("Stored Learning Kernel fact is inconsistent");
  }
  const activityId =
    fact.body.type === "correction"
      ? fact.body.replacement.activityId
      : fact.body.type === "evidence" || fact.body.type === "review"
        ? fact.body.activityId
        : null;
  return activityId
    ? {
        factId: fact.id,
        factHash: row.fact_hash,
        activityId,
        occurredAt: fact.occurredAt,
      }
    : null;
}

function reviewExecutionContextHash(input: {
  readonly executionId: string;
  readonly scope: LearningKernelScope;
  readonly reviewItemId: string;
  readonly source: {
    readonly factId: string;
    readonly factHash: string;
    readonly activityId: string;
    readonly occurredAt: string;
  };
  readonly activityId: string;
  readonly activitySnapshotHash: string;
}): string {
  return learningKernelSha256({
    schemaVersion: 1,
    executionId: input.executionId,
    scope: {
      courseId: input.scope.courseId,
      revisionId: input.scope.revisionId,
      branchId: input.scope.branchId,
      sessionId: input.scope.sessionId,
    },
    reviewItemId: input.reviewItemId,
    sourceFactId: input.source.factId,
    sourceFactHash: input.source.factHash,
    sourceOccurredAt: input.source.occurredAt,
    activityId: input.activityId,
    activitySnapshotHash: input.activitySnapshotHash,
  });
}

function reviewScopeKey(scope: LearningKernelScope, reviewItemId: string) {
  return `${scope.courseId}\0${scope.revisionId}\0${scope.branchId}\0${scope.sessionId}\0${reviewItemId}`;
}

function reviewExecutionId(
  scope: LearningKernelScope,
  reviewItemId: string,
): string {
  return `review-execution-${createHash("sha256")
    .update(
      JSON.stringify({
        schemaVersion: 1,
        scope: {
          courseId: scope.courseId,
          revisionId: scope.revisionId,
          branchId: scope.branchId,
          sessionId: scope.sessionId,
        },
        reviewItemId,
        schedulerVersion: "baseline-1",
      }),
    )
    .digest("hex")}`;
}

function reviewSubmitOperationId(operationId: string) {
  return `kernel:review:submit:${reviewOperationDigest(operationId)}`;
}
function reviewCompleteOperationId(operationId: string) {
  return `kernel:review:complete:${reviewOperationDigest(operationId)}`;
}
function reviewSubmitFactId(operationId: string) {
  return `kernel-fact:review:1-submit:${reviewOperationDigest(operationId)}`;
}
function reviewCompleteFactId(operationId: string) {
  return `kernel-fact:review:2-complete:${reviewOperationDigest(operationId)}`;
}

function reviewOperationDigest(operationId: string) {
  return createHash("sha256").update(operationId).digest("hex");
}

function kernelHash(value: string): string {
  return value.startsWith("sha256:") ? value : `sha256:${value}`;
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
       WHERE lesson.id = ? AND revision.status = 'published'`,
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
  const selected = await state.repository.getSelectedCourseTarget();
  if (!selected) return null;

  const current = await state.repository.getCurrentVersionedSession(
    selected.courseId,
  );
  if (current) {
    const context = await requireSessionCourseContext(state, current);
    if (
      context.courseId !== selected.courseId ||
      context.revisionId !== selected.revisionId
    ) {
      throw new Error(
        "Selected Course state conflicts with its active session",
      );
    }
    return selected;
  }

  const target = await state.courseFoundationRepository.getCourseRevision(
    selected.revisionId,
  );
  if (target !== null) {
    await requireOwnedCourseRevision(
      state,
      selected.courseId,
      selected.revisionId,
      true,
    );
  } else if (
    !hasQuarantinedRevisionCompatibility(
      state,
      selected.courseId,
      selected.revisionId,
    )
  ) {
    throw new Error(`Unknown Course revision: ${selected.revisionId}`);
  }
  return selected;
}

async function readLearnerPath(
  state: VersionedLearningState,
  kernelRepository: LearningKernelRepository,
  observedAt: string,
  courseId: string,
  revisionId: string,
) {
  const selected = await state.repository.getSelectedCourseTarget();
  const currentDetail =
    await state.repository.getCurrentVersionedSession(courseId);
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
  const currentKernel = current
    ? requireCurrentPathKernelState(kernelRepository, current, observedAt)
    : null;

  const curriculum = {
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
        const dayStatus: LessonProgressionStatus = completedDayStableIds.has(
          day.stableId,
        )
          ? "completed"
          : currentDay
            ? "in_progress"
            : prerequisitesCompleted
              ? "available"
              : "locked";
        const kernelProgress =
          currentDay && currentKernel
            ? new Map(
                currentKernel.projection.progress.map((item) => [
                  item.unitId,
                  item.status,
                ]),
              )
            : null;
        const initial = new Map(
          createUnitProgression(toDefinitions(units)).map((item) => [
            item.unitId,
            item.status,
          ]),
        );
        const completedProgress =
          session?.status === "completed"
            ? completedLessonPathProgress(
                kernelRepository,
                session.id,
                observedAt,
                units,
              )
            : null;
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
          sessionId: currentDay && current ? current.session.id : null,
          units: units.map((unit) => ({
            ...toLearnerUnit(unit),
            status:
              session?.status === "completed"
                ? (completedProgress?.get(unit.id) ?? "locked")
                : (kernelProgress?.get(unit.id) ??
                  initial.get(unit.id) ??
                  "locked"),
          })),
        };
      }),
    })),
  };
  const lessonAction = selectLessonNextAction(
    curriculum.weeks.flatMap((week) =>
      week.days.map((day) => ({
        lessonId: day.id,
        status: day.status,
        sessionId: day.sessionId,
      })),
    ),
  );
  let nextAction: LearningPathNextAction = null;
  if (lessonAction?.type === "start") {
    nextAction = lessonAction;
  } else if (
    lessonAction?.type === "resume" &&
    currentKernel !== null &&
    currentKernel.currentStep !== null
  ) {
    nextAction = {
      ...lessonAction,
      currentStep: currentKernel.currentStep,
    };
  }

  return {
    courseContext: {
      courseId,
      revisionId,
      selected:
        selected?.courseId === courseId && selected.revisionId === revisionId,
    },
    curriculum,
    nextAction: LearningPathNextActionSchema.parse(nextAction),
  };
}

function completedLessonPathProgress(
  kernelRepository: LearningKernelRepository,
  sessionId: string,
  observedAt: string,
  units: readonly CurriculumUnit[],
): ReadonlyMap<string, UnitStatus> {
  const scope = kernelRepository.resolveSessionScope(sessionId);
  const projection = kernelRepository.reproject(scope, observedAt);
  const projected = projectCompletedLessonProgress(
    toDefinitions(units),
    projection.progress,
  );
  return new Map(projected.map((item) => [item.unitId, item.status]));
}

function requireCurrentPathKernelState(
  kernelRepository: LearningKernelRepository,
  detail: VersionedSessionDetail,
  observedAt: string,
): {
  projection: LearningKernelProjection;
  currentStep: string | null;
} {
  if (detail.session.status !== "active") {
    throw new Error("Current Course path session is not active");
  }
  const scope = kernelRepository.resolveSessionScope(detail.session.id);
  const projection = kernelRepository.reproject(scope, observedAt);
  const snapshotById = new Map(
    detail.snapshot.units.map((unit) => [unit.id, unit]),
  );
  const persistedStep = detail.snapshot.units.find(
    (unit) => unit.stableId === detail.session.currentStep,
  );
  if (!persistedStep) {
    throw new Error("Current Course path step is outside its session snapshot");
  }
  const kernelProgressIds = new Set(
    projection.progress.map((item) => item.unitId),
  );
  if (
    projection.progress.length !== snapshotById.size ||
    kernelProgressIds.size !== snapshotById.size ||
    projection.progress.some((item) => !snapshotById.has(item.unitId))
  ) {
    throw new Error(
      "Learning Kernel progress does not match the session snapshot",
    );
  }
  if (projection.nextAction?.type !== "activity") {
    return { projection, currentStep: null };
  }
  const kernelStep = snapshotById.get(projection.nextAction.activityId);
  if (!kernelStep || kernelStep.stableId !== detail.session.currentStep) {
    throw new Error(
      "Persisted current step conflicts with the Learning Kernel next action",
    );
  }
  const kernelProgress = projection.progress.find(
    (item) => item.unitId === kernelStep.id,
  );
  const expectedStatus =
    projection.nextAction.reasonCode === "resume" ? "in_progress" : "ready";
  if (kernelProgress?.status !== expectedStatus) {
    throw new Error(
      "Learning Kernel next action has an invalid progress state",
    );
  }
  return { projection, currentStep: kernelStep.stableId };
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
  kernelRepository: LearningKernelRepository,
  detail: VersionedSessionDetail,
  unitId: string,
): {
  summary: DaySummary;
  authority: CanonicalSummaryAuthority;
  evidenceId: string;
} {
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
      `SELECT id, payload_json, created_at FROM versioned_unit_evidence
       WHERE id = ? AND session_id = ? AND unit_id = ?
         AND evidence_type = 'summary'`,
    )
    .get(progress.payload.summaryId, detail.session.id, unitId) as
    { id: string; payload_json: string; created_at: number } | undefined;
  if (!evidence) {
    throw new Error("Summary evidence not found for this session unit");
  }
  const persisted = parsePersistedSummary(evidence.payload_json);
  const authority =
    persisted.authority ??
    projectCanonicalSummaryAuthority(
      kernelRepository,
      detail,
      persisted.summary.occurredAt,
      evidence.created_at,
    );
  return {
    summary: persisted.summary,
    authority: verifyPersistedSummaryAuthority(
      kernelRepository,
      detail,
      authority,
    ),
    evidenceId: evidence.id,
  };
}

function summaryOperationId(operationId: string): string {
  return `summary:${createHash("sha256").update(operationId).digest("hex")}`;
}

function parsePersistedSummary(payloadJson: string): {
  summary: DaySummary;
  authority: CanonicalSummaryAuthority | null;
} {
  const payload = z
    .object({
      summary: daySummarySchema,
      authority: canonicalSummaryAuthoritySchema.optional(),
    })
    .strict()
    .parse(JSON.parse(payloadJson));
  return {
    summary: payload.summary as DaySummary,
    authority: payload.authority ?? null,
  };
}

function projectCanonicalSummaryAuthority(
  kernelRepository: LearningKernelRepository,
  detail: VersionedSessionDetail,
  observedAt: string,
  acceptedBefore?: number,
): CanonicalSummaryAuthority {
  const scope = kernelRepository.resolveSessionScope(detail.session.id);
  if (
    scope.courseId !== detail.snapshot.curriculumId ||
    scope.revisionId !== detail.snapshot.curriculumVersionId ||
    scope.sessionId !== detail.session.id
  ) {
    throw new Error("Summary Kernel authority does not match session scope");
  }
  const sourceFactIds =
    acceptedBefore === undefined
      ? kernelRepository
          .readFacts(scope)
          .filter(
            (fact) => Date.parse(fact.occurredAt) <= Date.parse(observedAt),
          )
          .map((fact) => fact.id)
      : [
          ...kernelRepository.readAcceptedFactFrontier(
            scope,
            observedAt,
            acceptedBefore,
          ),
        ];
  if (sourceFactIds.length === 0) {
    throw new Error("Summary Kernel authority has an empty fact frontier");
  }
  const projection = kernelRepository.reprojectFrontier(
    scope,
    observedAt,
    sourceFactIds,
  );
  return {
    scope,
    modelVersion: projection.summary.modelVersion,
    observedAt: projection.observedAt,
    projectionHash: projection.summary.projectionHash,
    sourceFactIds: [...projection.summary.sourceFactIds],
  };
}

function readSummaryEvidenceCreatedAt(
  connection: DatabaseConnection,
  evidenceId: string,
): number {
  const row = connection.sqlite
    .prepare(
      `SELECT created_at FROM versioned_unit_evidence
       WHERE id = ? AND evidence_type = 'summary'`,
    )
    .get(evidenceId) as { created_at: number } | undefined;
  if (!row) throw new Error("Summary evidence acceptance boundary is missing");
  return row.created_at;
}

function verifyPersistedSummaryAuthority(
  kernelRepository: LearningKernelRepository,
  detail: VersionedSessionDetail,
  authority: CanonicalSummaryAuthority,
): CanonicalSummaryAuthority {
  const scope = kernelRepository.resolveSessionScope(detail.session.id);
  if (
    authority.scope.courseId !== scope.courseId ||
    authority.scope.revisionId !== scope.revisionId ||
    authority.scope.branchId !== scope.branchId ||
    authority.scope.sessionId !== scope.sessionId
  ) {
    throw new Error("Persisted Summary authority belongs to another scope");
  }
  const projection = kernelRepository.reprojectFrontier(
    scope,
    authority.observedAt,
    authority.sourceFactIds,
  );
  if (
    projection.summary.modelVersion !== authority.modelVersion ||
    projection.observedAt !== authority.observedAt ||
    projection.summary.projectionHash !== authority.projectionHash ||
    !sameStringSequence(
      projection.summary.sourceFactIds,
      authority.sourceFactIds,
    )
  ) {
    throw new Error(
      "Persisted Summary authority diverges from the Learning Kernel",
    );
  }
  return authority;
}

function resolveSummaryKnowledgeNodeIds(
  kernelRepository: LearningKernelRepository,
  detail: VersionedSessionDetail,
): string[] {
  const scope = kernelRepository.resolveSessionScope(detail.session.id);
  const knowledgeNodeIds = [
    ...new Set(
      kernelRepository
        .listActivities(scope)
        .flatMap((activity) => activity.knowledgeNodeIds),
    ),
  ].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  if (knowledgeNodeIds.length === 0) {
    throw new Error("Summary requires exact Course knowledge-node scope");
  }
  return knowledgeNodeIds;
}

function derivePersistedDaySummary(
  connection: DatabaseConnection,
  repository: LearningRepository,
  detail: VersionedSessionDetail,
  topicIds: readonly string[],
): DaySummary {
  const allEvidence = repository.listVersionedUnitEvidence(detail.session.id);
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
  const review = attemptId
    ? latestReviewAuthorityBinding(connection, detail.session.id, attemptId)
    : null;
  const reviewReceiptAccepted =
    review !== null && hasAuthoritativeAcceptedReview(review);
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
    exerciseAttempted: attemptId !== null,
    exerciseTestsPassed: test?.status === "passed",
    reviewReceiptAccepted,
  });
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

function assertCompletionCriteria(
  connection: DatabaseConnection,
  repository: LearningRepository,
  sessionId: string,
  unit: CurriculumUnit,
  payload: UnitProgressPayload,
  allProgress: readonly UnitProgress[],
  allUnits: readonly CurriculumUnit[],
  kernelRepository: LearningKernelRepository,
): void {
  if (unit.type === "summary") {
    assertPersistedSummaryEvidence(connection, sessionId, unit.id, payload);
    const summaryDetail = repository.getVersionedSession(sessionId);
    readPersistedSummary(
      connection,
      kernelRepository,
      {
        ...summaryDetail,
        unitProgress: summaryDetail.unitProgress.map((progress) =>
          progress.unitId === unit.id ? { ...progress, payload } : progress,
        ),
      },
      unit.id,
    );
  }
  const failures = [];
  for (const criterion of unit.completionCriteria) {
    let failed: boolean;
    switch (criterion.type) {
      case "acknowledgement":
        failed = !(
          ("acknowledged" in payload && payload.acknowledged) ||
          (unit.type === "study" && payload.type === "study")
        );
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
            ? !hasPersistedRecallEvidence(
                repository,
                sessionId,
                unit,
                payload,
                criterion.minimum,
              )
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
                    sessionId,
                    unit.id,
                    payload.interviewSessionId,
                    payload.reportId,
                  ) >= (criterion.minimum ?? 1)
                )
              : evidenceAttemptCount(payload) < criterion.minimum;
        break;
      case "dialogue":
        failed = !hasPersistedTeacherDialogue(
          connection,
          sessionId,
          unit.id,
          payload,
          criterion.minimumTurns,
          criterion.requiresRevision,
        );
        break;
      case "score":
        failed = !hasPersistedQuizEvidence(
          connection,
          repository,
          sessionId,
          unit,
          payload,
          criterion.minimum,
          criterion.minimumAttempts,
        );
        break;
      case "fields":
        failed =
          criterion.required.some(
            (field) => !hasEvidenceField(payload, field),
          ) ||
          (unit.type === "code-reading" &&
            !hasPersistedCodeReadingEvidence(
              repository,
              sessionId,
              unit,
              payload,
            ));
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
  setup: z.object({
    conversationId: z.string().trim().min(1),
    learningSessionId: z.string().trim().min(1),
    courseBinding: z.object({
      learningSessionId: z.string().trim().min(1),
      unitId: z.string().trim().min(1),
      courseId: z.string().trim().min(1),
      revisionId: z.string().trim().min(1),
      lessonId: z.string().trim().min(1),
      snapshotId: z.string().trim().min(1),
      snapshotHash: z.string().regex(/^[a-f0-9]{64}$/u),
      snapshotBytesHash: z.string().regex(/^[a-f0-9]{64}$/u),
    }),
  }),
  report: z
    .object({
      interviewId: z.string().trim().min(1),
      status: z.literal("completed"),
    })
    .passthrough(),
});

function countCompletedInterviewAnswers(
  connection: DatabaseConnection,
  learningSessionId: string,
  unitId: string,
  interviewSessionId: string,
  reportId: string,
): number {
  const row = connection.sqlite
    .prepare(
      `SELECT interview.learning_session_id AS learningSessionId,
              interview.status,
              interview.result_json AS resultJson,
              snapshot.id AS snapshotId,
              snapshot.content_hash AS snapshotHash,
              snapshot.snapshot_json AS snapshotJson,
              context.course_id AS courseId,
              context.revision_id AS revisionId,
              context.lesson_id AS lessonId,
              context.snapshot_hash AS contextSnapshotHash,
              context.snapshot_bytes_hash AS snapshotBytesHash
       FROM interview_sessions interview
       JOIN session_snapshots snapshot
         ON snapshot.session_id = interview.learning_session_id
       JOIN session_course_contexts context
         ON context.session_id = interview.learning_session_id
       JOIN unit_progress progress
         ON progress.session_id = interview.learning_session_id
        AND progress.unit_id = ? AND progress.unit_type = 'interview'
       WHERE interview.id = ?`,
    )
    .get(unitId, interviewSessionId) as
    | {
        learningSessionId: string;
        status: string;
        resultJson: string | null;
        snapshotId: string;
        snapshotHash: string;
        snapshotJson: string;
        courseId: string;
        revisionId: string;
        lessonId: string;
        contextSnapshotHash: string;
        snapshotBytesHash: string;
      }
    | undefined;
  if (
    !row?.resultJson ||
    row.status !== "completed" ||
    row.learningSessionId !== learningSessionId ||
    reportId !== interviewSessionId
  ) {
    return 0;
  }
  const parsed = interviewStoredSetupSchema.safeParse(
    JSON.parse(row.resultJson),
  );
  if (!parsed.success) return 0;
  const binding = parsed.data.setup.courseBinding;
  if (
    parsed.data.setup.learningSessionId !== learningSessionId ||
    parsed.data.report.interviewId !== interviewSessionId ||
    binding.learningSessionId !== learningSessionId ||
    binding.unitId !== unitId ||
    binding.courseId !== row.courseId ||
    binding.revisionId !== row.revisionId ||
    binding.lessonId !== row.lessonId ||
    binding.snapshotId !== row.snapshotId ||
    binding.snapshotHash !== row.snapshotHash ||
    binding.snapshotHash !== row.contextSnapshotHash ||
    binding.snapshotBytesHash !== row.snapshotBytesHash ||
    createHash("sha256").update(row.snapshotJson).digest("hex") !==
      binding.snapshotBytesHash
  ) {
    return 0;
  }
  const snapshot = SessionSnapshotSchema.safeParse(
    JSON.parse(row.snapshotJson),
  );
  if (!snapshot.success) return 0;
  const { contentHash, ...snapshotCore } = snapshot.data;
  const unit = snapshot.data.units.find((candidate) => candidate.id === unitId);
  if (
    !unit ||
    unit.type !== "interview" ||
    contentHash !== binding.snapshotHash ||
    hashCanonicalJson(snapshotCore) !== binding.snapshotHash ||
    snapshot.data.curriculumId !== binding.courseId ||
    snapshot.data.curriculumVersionId !== binding.revisionId ||
    snapshot.data.day.id !== binding.lessonId
  ) {
    return 0;
  }
  const count = connection.sqlite
    .prepare(
      `SELECT COUNT(*) AS count FROM agent_messages
       WHERE conversation_id = ? AND role = 'user' AND status = 'completed'`,
    )
    .get(parsed.data.setup.conversationId) as { count: number };
  return count.count;
}

function evidenceAttemptCount(payload: UnitProgressPayload): number {
  switch (payload.type) {
    case "briefing":
      return payload.acknowledged
        ? Math.max(1, payload.checkedItemIds.length)
        : payload.checkedItemIds.length;
    case "study":
      return payload.checkedItemIds.length + (payload.notes.trim() ? 1 : 0);
    case "recall":
      return payload.answers.length;
    case "teacher-dialogue":
      return payload.turnCount;
    case "quiz":
      return payload.attemptedQuestionIds.length;
    case "code-reading":
      return [
        payload.prediction,
        payload.explanation,
        payload.verbalFix,
      ].filter((value) => value.trim()).length;
    case "exercise":
      return payload.attemptId === null ? 0 : 1;
    case "review":
      return payload.reviewId === null ? 0 : 1;
    case "interview":
      return payload.reportId === null ? 0 : 1;
    case "summary":
      return payload.summaryId === null ? 0 : 1;
    case "checkpoint":
      return payload.acknowledged ? 1 : 0;
    case "spaced-review":
      return payload.reviewedTopicIds.length;
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
  unitId: string,
  payload: UnitProgressPayload,
  minimumTurns: number,
  requiresRevision: boolean,
): boolean {
  if (payload.type !== "teacher-dialogue") return false;
  const requiredTurns = Math.max(minimumTurns, requiresRevision ? 2 : 1);
  const turnIds = [...new Set(payload.revisionAttemptIds)];
  if (payload.turnCount < requiredTurns || turnIds.length < requiredTurns) {
    return false;
  }
  const completedTurnCount = turnIds.filter((turnId) => {
    const counts = connection.sqlite
      .prepare(
        `SELECT
         SUM(CASE WHEN m.role = 'user' THEN 1 ELSE 0 END) AS learner_turns,
         SUM(CASE WHEN m.role = 'assistant' THEN 1 ELSE 0 END) AS teacher_turns
       FROM agent_messages m
       JOIN agent_conversations c ON c.id = m.conversation_id
       WHERE c.learning_session_id = ? AND c.role = 'teacher'
         AND m.status = 'completed'
         AND m.idempotency_key IN (?, ?)`,
      )
      .get(
        sessionId,
        tutorTurnMessageKey(unitId, turnId, "user"),
        tutorTurnMessageKey(unitId, turnId, "assistant"),
      ) as
      | { learner_turns: number | null; teacher_turns: number | null }
      | undefined;
    return counts?.learner_turns === 1 && counts.teacher_turns === 1;
  }).length;
  return completedTurnCount >= requiredTurns;
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

function hasPersistedRecallEvidence(
  repository: LearningRepository,
  sessionId: string,
  unit: CurriculumUnit,
  payload: UnitProgressPayload,
  minimum: number,
): boolean {
  if (payload.type !== "recall") return false;
  const evidence = repository.listVersionedUnitEvidence(sessionId, {
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

function hasPersistedQuizEvidence(
  connection: DatabaseConnection,
  repository: LearningRepository,
  sessionId: string,
  unit: CurriculumUnit,
  payload: UnitProgressPayload,
  minimumScore: number,
  minimumAttempts: number,
): boolean {
  if (payload.type !== "quiz") return false;
  const privateUnit = requirePrivateUnit(
    readPrivateSnapshot(connection, sessionId),
    unit.id,
    "quiz",
  );
  const allowedQuestions = new Set(
    privateUnit.questions.map((question) => question.id),
  );
  const evidence = repository.listVersionedUnitEvidence(sessionId, {
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

function hasPersistedCodeReadingEvidence(
  repository: LearningRepository,
  sessionId: string,
  unit: CurriculumUnit,
  payload: UnitProgressPayload,
): boolean {
  if (payload.type !== "code-reading") return false;
  const evidence = repository.listVersionedUnitEvidence(sessionId, {
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

function latestAcceptedReviewReceipt(
  connection: DatabaseConnection,
  sessionId: string,
  attemptId: string,
): { id: string } | null {
  const review = latestReviewAuthorityBinding(connection, sessionId, attemptId);
  return review && hasAuthoritativeAcceptedReview(review)
    ? { id: review.id }
    : null;
}

function latestReviewAuthorityBinding(
  connection: DatabaseConnection,
  sessionId: string,
  attemptId: string,
): ({ id: string } & PersistedReviewAuthorityBinding) | null {
  return (
    (connection.sqlite
      .prepare(
        `SELECT r.id, r.status AS reviewStatus,
              r.result_json AS resultJson,
              b.bundle_sha256 AS bundleSha256,
              b.bundle_json AS bundleJson,
              b.test_run_id AS bundleTestRunId,
              b.workspace_snapshot_hash AS bundleWorkspaceSnapshotHash,
              b.diff_fingerprint AS bundleDiffFingerprint,
              t.id AS testRunId, t.operation_id AS testOperationId,
              t.status AS testStatus, t.check_id AS testCheckId,
              t.environment_id AS testEnvironmentId,
              t.environment_pack_digest AS testEnvironmentPackDigest,
              t.backend_id AS testBackendId,
              t.input_snapshot_hash AS testInputSnapshotHash,
              t.diff_fingerprint AS testDiffFingerprint,
              t.diff_truncated AS testDiffTruncated
       FROM reviews r
       LEFT JOIN review_evidence_bundles b ON b.review_id = r.id
       LEFT JOIN test_runs t ON t.id = b.test_run_id
       WHERE r.session_id = ? AND r.exercise_attempt_id = ?
       ORDER BY r.created_at DESC, r.rowid DESC LIMIT 1`,
      )
      .get(sessionId, attemptId) as
      ({ id: string } & PersistedReviewAuthorityBinding) | undefined) ?? null
  );
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
      const latestReview = latestAcceptedReviewReceipt(
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
  const latestReview = latestAcceptedReviewReceipt(
    connection,
    sessionId,
    attempt.id,
  );
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
    knowledgeNodeIds: LearningKnowledgeNodeIdSchema.array().parse(
      JSON.parse(row.knowledge_node_ids_json),
    ),
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
