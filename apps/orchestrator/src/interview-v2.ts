import { createHash, randomUUID } from "node:crypto";

import {
  ProviderHubError,
  type ResolvedProviderTurn,
} from "@aptiloop/agent-core";
import {
  canonicalJson,
  hashCanonicalJson,
  type DatabaseConnection,
} from "@aptiloop/database";
import { getLatestPrompt } from "@aptiloop/prompt-library";
import {
  InterviewDisclosureContinuationSchema,
  InterviewPendingDisclosureSchema,
  type AiDisclosure,
  SessionSnapshotSchema,
  type InterviewDisclosureContinuation,
  type InterviewPendingDisclosure,
} from "@aptiloop/shared";
import type { Hono } from "hono";
import { assertCourseScopedSessionSideEffectAllowed } from "./learning-session-policy.js";
import {
  providerFailureCode,
  type ProviderDispatch,
  type ProviderRuntime,
} from "./provider-runtime.js";
import { z } from "zod";

const OperationIdSchema = z.string().trim().min(8).max(200);
const LearningSessionIdSchema = z.string().trim().min(1);
const UnitIdSchema = z.string().trim().min(1);
const TopicSchema = z.string().trim().min(1).max(120);
const DifficultySchema = z.enum(["foundation", "interview-ready", "deep-dive"]);
const InterviewReadQuerySchema = z
  .object({ learningSessionId: LearningSessionIdSchema.optional() })
  .strict();
const InterviewPendingDisclosureQuerySchema = z
  .object({
    kind: z.tuple([z.enum(["start", "answer"])]),
    operationId: z.tuple([OperationIdSchema]),
    questionId: z.tuple([z.string().trim().min(1).max(200)]).optional(),
    learningSessionId: z.tuple([LearningSessionIdSchema]).optional(),
  })
  .strict()
  .superRefine((query, context) => {
    const kind = query.kind[0];
    if (kind === "start" && query.questionId) {
      context.addIssue({
        code: "custom",
        path: ["questionId"],
        message: "Start disclosure recovery does not accept a question ID",
      });
    }
    if (kind === "answer" && !query.questionId) {
      context.addIssue({
        code: "custom",
        path: ["questionId"],
        message: "Answer disclosure recovery requires a question ID",
      });
    }
  });

const InterviewSetupBaseSchema = z.object({
  operationId: OperationIdSchema,
  questionCount: z.number().int().min(1).max(12),
  disclosureOperationId: OperationIdSchema.optional(),
});

const StandaloneInterviewSetupRequestSchema = InterviewSetupBaseSchema.extend({
  topics: z.array(TopicSchema).min(1).max(12),
  difficulty: DifficultySchema,
}).strict();

const LinkedInterviewSetupRequestSchema = InterviewSetupBaseSchema.extend({
  learningSessionId: LearningSessionIdSchema,
  unitId: UnitIdSchema,
}).strict();

const InterviewSetupRequestSchema = z.union([
  StandaloneInterviewSetupRequestSchema,
  LinkedInterviewSetupRequestSchema,
]);

const InterviewCourseBindingSchema = z
  .object({
    learningSessionId: LearningSessionIdSchema,
    unitId: UnitIdSchema,
    courseId: z.string().trim().min(1),
    revisionId: z.string().trim().min(1),
    lessonId: z.string().trim().min(1),
    snapshotId: z.string().trim().min(1),
    snapshotHash: z.string().regex(/^[a-f0-9]{64}$/u),
    snapshotBytesHash: z.string().regex(/^[a-f0-9]{64}$/u),
  })
  .strict();
type InterviewCourseBinding = z.infer<typeof InterviewCourseBindingSchema>;

interface ResolvedInterviewSetup {
  readonly operationId: string;
  readonly topics: string[];
  readonly difficulty: z.infer<typeof DifficultySchema>;
  readonly questionCount: number;
  readonly learningSessionId?: string;
  readonly courseBinding?: InterviewCourseBinding;
}

const InterviewAnswerRequestSchema = z
  .object({
    operationId: OperationIdSchema,
    answer: z.string().trim().min(1).max(20_000),
    disclosureOperationId: OperationIdSchema.optional(),
  })
  .strict();

const InterviewFinishRequestSchema = z
  .object({ operationId: OperationIdSchema })
  .strict();
const InterviewAbandonRequestSchema = InterviewFinishRequestSchema;

const StoredSetupSchema = z.object({
  operationId: OperationIdSchema,
  topics: z.array(TopicSchema).min(1).max(12),
  difficulty: DifficultySchema,
  questionCount: z.number().int().min(1).max(12),
  learningSessionId: LearningSessionIdSchema.optional(),
  courseBinding: InterviewCourseBindingSchema.optional(),
  conversationId: z.string().min(1),
});

const InterviewEvidenceSchema = z.object({
  questionNumber: z.number().int().positive(),
  topic: TopicSchema,
  answerExcerpt: z.string().max(240),
  observation: z.string().min(1),
});

const InterviewReportSchema = z.object({
  interviewId: z.string().min(1),
  status: z.literal("completed"),
  summary: z.string().min(1),
  topics: z.array(TopicSchema),
  metrics: z.object({
    questionsAsked: z.number().int().nonnegative(),
    questionsAnswered: z.number().int().nonnegative(),
    completionRate: z.number().min(0).max(1),
  }),
  strengths: z.array(z.string().min(1)),
  growthAreas: z.array(z.string().min(1)),
  evidence: z.array(InterviewEvidenceSchema),
});
export type InterviewReport = z.infer<typeof InterviewReportSchema>;

const StoredStateSchema = z.object({
  schemaVersion: z.literal(1),
  setup: StoredSetupSchema,
  finishOperationId: OperationIdSchema.optional(),
  report: InterviewReportSchema.optional(),
});
type StoredState = z.infer<typeof StoredStateSchema>;

const InterviewStatusSchema = z.enum(["setup", "in_progress", "completed"]);
const interviewOperationConflictMessage =
  "An interview operation is already in progress. Retry this request.";

interface InterviewRow {
  id: string;
  learningSessionId: string | null;
  status: string;
  resultJson: string | null;
  startedAt: number;
  completedAt: number | null;
}

interface MessageRow {
  id: string;
  role: string;
  content: string;
  status: string;
  sequence: number;
  idempotencyKey: string | null;
  createdAt: number;
}

export interface InterviewV2State {
  connection: DatabaseConnection;
  providerRuntime: ProviderRuntime;
  interviewReservations: {
    start: boolean;
    interviewIds: Set<string>;
  };
}

class InterviewProviderFailure extends Error {
  constructor(
    readonly reason: "cancelled" | "failed",
    message: string,
  ) {
    super(message);
    this.name = "InterviewProviderFailure";
  }
}

export function registerInterviewV2Routes(
  app: Hono,
  state: InterviewV2State,
): void {
  app.post("/api/interviews/v2", async (context) => {
    const body = InterviewSetupRequestSchema.parse(await context.req.json());
    if (state.interviewReservations.start) {
      return context.json({ error: interviewOperationConflictMessage }, 409);
    }
    state.interviewReservations.start = true;
    try {
      const existingByOperation = findInterviewByOperation(
        state,
        body.operationId,
      );
      if (existingByOperation) {
        if (existingByOperation.learningSessionId) {
          assertCourseScopedSessionSideEffectAllowed(
            state.connection,
            existingByOperation.learningSessionId,
          );
        }
        const stored = parseStoredState(existingByOperation);
        assertStoredCourseBinding(state, stored.setup);
        assertSameSetupRequest(stored.setup, body);
        if (existingByOperation.status === "setup") {
          try {
            const selection = await readStoredInterviewerSelection(
              state,
              stored,
            );
            if (!body.disclosureOperationId) {
              const pending = await prepareInterviewDisclosure(state, {
                continuation: startDisclosureContinuation(
                  existingByOperation,
                  stored,
                ),
                payload: buildQuestionPrompt(stored, [], 1),
                payloadCategories: ["course-content"],
                destinationPurpose: "Generate one bounded interview question",
              });
              if (pending) return context.json(pending, 202);
            }
            await ensureOpeningQuestion(
              state,
              selection,
              existingByOperation,
              stored,
              context.req.raw.signal,
              body.disclosureOperationId,
            );
          } catch (error) {
            return providerFailureResponse(context, error);
          }
        }
        return context.json(
          readPublicInterview(state, existingByOperation.id),
          200,
        );
      }

      const requestedSetup = resolveInterviewSetup(state, body);
      const current = findCurrentInterview(state);
      if (current) {
        return context.json(
          {
            error: "Finish the current interview before starting another one.",
          },
          409,
        );
      }

      const learningSessionId = requestedSetup.learningSessionId ?? null;

      let selection: ResolvedProviderTurn;
      try {
        selection = await readInterviewerSelection(state);
      } catch (error) {
        return providerFailureResponse(context, error);
      }
      const interviewId = deterministicId("interview", body.operationId);
      const conversationId = `${interviewId}:conversation`;
      const now = Date.now();
      const stored = StoredStateSchema.parse({
        schemaVersion: 1,
        setup: { ...requestedSetup, conversationId },
      });

      state.connection.sqlite.exec("BEGIN IMMEDIATE");
      try {
        state.connection.sqlite
          .prepare(
            `INSERT INTO interview_sessions
           (id, learning_session_id, status, result_json, started_at, completed_at)
           VALUES (?, ?, 'setup', ?, ?, NULL)`,
          )
          .run(interviewId, learningSessionId, JSON.stringify(stored), now);
        state.connection.sqlite
          .prepare(
            `INSERT INTO agent_conversations
           (id, learning_session_id, role, provider_id, model_id,
            provider_session_id, status, created_at, updated_at)
           VALUES (?, ?, 'interviewer', ?, ?, NULL, 'active', ?, ?)`,
          )
          .run(
            conversationId,
            learningSessionId,
            selection.connection.adapterId,
            selection.modelId,
            now,
            now,
          );
        state.connection.sqlite.exec("COMMIT");
      } catch (error) {
        state.connection.sqlite.exec("ROLLBACK");
        throw error;
      }

      try {
        const interview = readInterviewRow(state, interviewId);
        if (!body.disclosureOperationId) {
          const pending = await prepareInterviewDisclosure(state, {
            continuation: startDisclosureContinuation(interview, stored),
            payload: buildQuestionPrompt(stored, [], 1),
            payloadCategories: ["course-content"],
            destinationPurpose: "Generate one bounded interview question",
          });
          if (pending) return context.json(pending, 202);
        }
        await ensureOpeningQuestion(
          state,
          selection,
          interview,
          stored,
          context.req.raw.signal,
          body.disclosureOperationId,
        );
      } catch (error) {
        cleanupFailedInterviewSetup(state, interviewId, conversationId);
        return providerFailureResponse(context, error);
      }
      return context.json(readPublicInterview(state, interviewId), 201);
    } finally {
      state.interviewReservations.start = false;
    }
  });

  app.get("/api/interviews/v2/current", (context) => {
    const query = InterviewReadQuerySchema.parse({
      learningSessionId: context.req.query("learningSessionId"),
    });
    const requestedLearningSessionId = query.learningSessionId
      ? readKnownLearningSessionId(state, query.learningSessionId)
      : null;
    if (query.learningSessionId && !requestedLearningSessionId) {
      return context.json({ error: "Learning session not found." }, 404);
    }
    const current = findCurrentInterview(
      state,
      requestedLearningSessionId ?? undefined,
    );
    return context.json({
      learningSessionId:
        requestedLearningSessionId ??
        (current?.learningSessionId
          ? LearningSessionIdSchema.parse(current.learningSessionId)
          : null),
      interview: current ? readPublicInterview(state, current.id) : null,
    });
  });

  app.get("/api/interviews/v2/:id/disclosures/pending", async (context) => {
    const query = InterviewPendingDisclosureQuerySchema.parse(
      context.req.queries(),
    );
    const learningSessionId = query.learningSessionId?.[0] ?? null;
    if (
      learningSessionId &&
      !readKnownLearningSessionId(state, learningSessionId)
    ) {
      return pendingDisclosureNotFound(context);
    }

    let interview: InterviewRow;
    try {
      interview = readInterviewRow(state, context.req.param("id"));
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.startsWith("Unknown interview:")
      ) {
        return pendingDisclosureNotFound(context);
      }
      throw error;
    }
    if (interview.learningSessionId !== learningSessionId) {
      return pendingDisclosureNotFound(context);
    }

    const stored = parseStoredState(interview);
    if ((stored.setup.learningSessionId ?? null) !== learningSessionId) {
      return pendingDisclosureNotFound(context);
    }
    const kind = query.kind[0];
    const operationId = query.operationId[0];
    let continuation: InterviewDisclosureContinuation;
    let payload: string;
    if (kind === "start") {
      if (
        interview.status !== "setup" ||
        stored.setup.operationId !== operationId ||
        readTranscript(state, stored.setup.conversationId).length !== 0
      ) {
        return pendingDisclosureNotFound(context);
      }
      continuation = startDisclosureContinuation(interview, stored);
      payload = buildQuestionPrompt(stored, [], 1);
    } else {
      const questionId = query.questionId?.[0];
      if (!questionId || interview.status !== "in_progress") {
        return pendingDisclosureNotFound(context);
      }
      const transcript = readTranscript(state, stored.setup.conversationId);
      const answer = findMessageByKey(
        state,
        messageKey(interview.id, "answer", operationId),
      );
      const answerIndex = answer
        ? transcript.findIndex((message) => message.id === answer.id)
        : -1;
      const answeredQuestion =
        answerIndex > 0 ? transcript[answerIndex - 1] : undefined;
      if (
        !answer ||
        answer.role !== "user" ||
        answeredQuestion?.role !== "assistant" ||
        answeredQuestion.id !== questionId ||
        findMessageByKey(
          state,
          messageKey(interview.id, "follow-up", operationId),
        ) ||
        countRole(transcript, "assistant") !== countRole(transcript, "user") ||
        countRole(transcript, "user") >= stored.setup.questionCount
      ) {
        return pendingDisclosureNotFound(context);
      }
      continuation = InterviewDisclosureContinuationSchema.parse({
        kind: "answer",
        learningSessionId,
        interviewId: interview.id,
        questionId,
        operationId,
      });
      payload = buildQuestionPrompt(
        stored,
        transcript,
        countRole(transcript, "user") + 1,
      );
    }

    const disclosure = await state.providerRuntime.findPendingDisclosure({
      role: "interviewer",
      payload,
      entityIds: interviewDisclosureEntityIds(continuation),
    });
    return disclosure
      ? context.json(toInterviewPendingDisclosure(continuation, disclosure))
      : pendingDisclosureNotFound(context);
  });

  app.get("/api/interviews/v2/:id", (context) => {
    const query = InterviewReadQuerySchema.parse({
      learningSessionId: context.req.query("learningSessionId"),
    });
    const interview = readPublicInterview(state, context.req.param("id"));
    if (
      query.learningSessionId &&
      interview.learningSessionId !== query.learningSessionId
    ) {
      return context.json({ error: "Interview not found." }, 404);
    }
    return context.json(interview);
  });

  app.post("/api/interviews/v2/:id/abandon", async (context) => {
    const body = InterviewAbandonRequestSchema.parse(await context.req.json());
    const interviewId = context.req.param("id");
    if (state.interviewReservations.interviewIds.has(interviewId)) {
      return context.json({ error: interviewOperationConflictMessage }, 409);
    }
    state.interviewReservations.interviewIds.add(interviewId);
    try {
      const interview = readInterviewRow(state, interviewId);
      const stored = parseStoredState(interview);
      if (
        interview.status !== "setup" ||
        stored.setup.operationId !== body.operationId ||
        readTranscript(state, stored.setup.conversationId).length !== 0
      ) {
        return context.json({ error: "Interview cannot be abandoned." }, 409);
      }
      state.connection.sqlite.exec("BEGIN IMMEDIATE");
      try {
        state.connection.sqlite
          .prepare("DELETE FROM interview_sessions WHERE id = ?")
          .run(interview.id);
        state.connection.sqlite
          .prepare("DELETE FROM agent_conversations WHERE id = ?")
          .run(stored.setup.conversationId);
        state.connection.sqlite.exec("COMMIT");
      } catch (error) {
        state.connection.sqlite.exec("ROLLBACK");
        throw error;
      }
      return context.json({
        abandoned: {
          interviewId: interview.id,
          operationId: stored.setup.operationId,
        },
      });
    } finally {
      state.interviewReservations.interviewIds.delete(interviewId);
    }
  });

  app.post("/api/interviews/v2/:id/answers", async (context) => {
    const body = InterviewAnswerRequestSchema.parse(await context.req.json());
    const interviewId = context.req.param("id");
    if (state.interviewReservations.interviewIds.has(interviewId)) {
      return context.json({ error: interviewOperationConflictMessage }, 409);
    }
    state.interviewReservations.interviewIds.add(interviewId);
    try {
      const interview = readInterviewRow(state, interviewId);
      if (interview.learningSessionId) {
        assertCourseScopedSessionSideEffectAllowed(
          state.connection,
          interview.learningSessionId,
        );
      }
      const stored = parseStoredState(interview);
      assertStoredCourseBinding(state, stored.setup);
      if (
        (stored.setup.learningSessionId ?? null) !== interview.learningSessionId
      ) {
        throw new Error(
          `Interview learning-session association is invalid: ${interview.id}`,
        );
      }
      if (interview.status !== "in_progress") {
        return context.json(
          { error: "Interview is not accepting answers." },
          409,
        );
      }

      const transcriptBefore = readTranscript(
        state,
        stored.setup.conversationId,
      );
      const askedBefore = countRole(transcriptBefore, "assistant");
      const answeredBefore = countRole(transcriptBefore, "user");
      const answerKey = messageKey(interview.id, "answer", body.operationId);
      const existingAnswer = findMessageByKey(state, answerKey);
      if (existingAnswer && existingAnswer.content !== body.answer) {
        return context.json(
          {
            error:
              "operationId was already used with different answer content.",
          },
          409,
        );
      }
      if (!existingAnswer && askedBefore !== answeredBefore + 1) {
        return context.json(
          { error: "There is no pending interview question." },
          409,
        );
      }
      const existingAnswerIndex = existingAnswer
        ? transcriptBefore.findIndex(
            (message) => message.id === existingAnswer.id,
          )
        : -1;
      const answeredQuestion = existingAnswer
        ? transcriptBefore[existingAnswerIndex - 1]
        : transcriptBefore.findLast((message) => message.role === "assistant");
      if (!answeredQuestion || answeredQuestion.role !== "assistant") {
        return context.json(
          { error: "There is no pending interview question." },
          409,
        );
      }

      if (!existingAnswer) {
        addMessage(state, {
          conversationId: stored.setup.conversationId,
          role: "user",
          content: body.answer,
          status: "completed",
          idempotencyKey: answerKey,
        });
      }

      const transcript = readTranscript(state, stored.setup.conversationId);
      const answered = countRole(transcript, "user");
      const questionKey = messageKey(
        interview.id,
        "follow-up",
        body.operationId,
      );
      if (
        answered < stored.setup.questionCount &&
        !findMessageByKey(state, questionKey)
      ) {
        try {
          const selection = await readStoredInterviewerSelection(state, stored);
          if (!body.disclosureOperationId) {
            const continuation = InterviewDisclosureContinuationSchema.parse({
              kind: "answer",
              learningSessionId: interview.learningSessionId,
              interviewId: interview.id,
              questionId: answeredQuestion.id,
              operationId: body.operationId,
            });
            const pending = await prepareInterviewDisclosure(state, {
              continuation,
              payload: buildQuestionPrompt(stored, transcript, answered + 1),
              payloadCategories: ["course-content", "learner-message"],
              destinationPurpose: "Generate one bounded follow-up question",
            });
            if (pending) return context.json(pending, 202);
          }
          const turn = await requestQuestion(
            state,
            selection,
            interview,
            stored,
            transcript,
            answered + 1,
            context.req.raw.signal,
            body.disclosureOperationId,
          );
          try {
            state.providerRuntime.assertDispatchCommitAllowed(turn.dispatch);
            addMessage(state, {
              conversationId: stored.setup.conversationId,
              role: "assistant",
              content: turn.question,
              status: "completed",
              idempotencyKey: questionKey,
            });
            turn.finishCompleted();
          } catch (error) {
            turn.finishFailed(error);
            throw error;
          }
        } catch (error) {
          recordProviderFailure(state, stored.setup.conversationId, error);
          return providerFailureResponse(context, error);
        }
      }

      return context.json(readPublicInterview(state, interview.id));
    } finally {
      state.interviewReservations.interviewIds.delete(interviewId);
    }
  });

  app.post("/api/interviews/v2/:id/finish", async (context) => {
    const body = InterviewFinishRequestSchema.parse(await context.req.json());
    const interviewId = context.req.param("id");
    if (state.interviewReservations.interviewIds.has(interviewId)) {
      return context.json({ error: interviewOperationConflictMessage }, 409);
    }
    state.interviewReservations.interviewIds.add(interviewId);
    try {
      const interview = readInterviewRow(state, interviewId);
      if (interview.learningSessionId) {
        assertCourseScopedSessionSideEffectAllowed(
          state.connection,
          interview.learningSessionId,
        );
      }
      const stored = parseStoredState(interview);
      assertStoredCourseBinding(state, stored.setup);
      if (interview.status === "completed" && stored.report) {
        return context.json({
          interview: readPublicInterview(state, interview.id),
          report: stored.report,
        });
      }
      if (interview.status !== "in_progress") {
        return context.json({ error: "Interview has not started." }, 409);
      }
      const transcript = readTranscript(state, stored.setup.conversationId);
      const asked = countRole(transcript, "assistant");
      const answered = countRole(transcript, "user");
      if (asked !== stored.setup.questionCount || answered !== asked) {
        return context.json(
          { error: "Answer every configured question before finishing." },
          409,
        );
      }

      const report = deriveReport(interview.id, stored.setup, transcript);
      const completedState = StoredStateSchema.parse({
        ...stored,
        finishOperationId: body.operationId,
        report,
      });
      const now = Date.now();
      state.connection.sqlite.exec("BEGIN IMMEDIATE");
      try {
        state.connection.sqlite
          .prepare(
            `UPDATE interview_sessions
           SET status = 'completed', result_json = ?, completed_at = ?
           WHERE id = ? AND status = 'in_progress'`,
          )
          .run(JSON.stringify(completedState), now, interview.id);
        state.connection.sqlite
          .prepare(
            `UPDATE agent_conversations
           SET status = 'completed', updated_at = ? WHERE id = ?`,
          )
          .run(now, stored.setup.conversationId);
        upsertInterviewUnitProgress(
          state,
          interview.learningSessionId,
          interview.id,
        );
        state.connection.sqlite.exec("COMMIT");
      } catch (error) {
        state.connection.sqlite.exec("ROLLBACK");
        throw error;
      }
      return context.json({
        interview: readPublicInterview(state, interview.id),
        report,
      });
    } finally {
      state.interviewReservations.interviewIds.delete(interviewId);
    }
  });
}

function upsertInterviewUnitProgress(
  state: InterviewV2State,
  learningSessionId: string | null,
  interviewId: string,
): void {
  if (!learningSessionId) return;
  const interview = readInterviewRow(state, interviewId);
  const stored = parseStoredState(interview);
  const binding = assertStoredCourseBinding(state, stored.setup);
  if (!binding) {
    throw new Error("Standalone interviews cannot update Course progress");
  }
  state.connection.sqlite
    .prepare(
      `UPDATE unit_progress
       SET progress_json = ?, updated_at = ?
       WHERE session_id = ? AND unit_id = ?
         AND EXISTS (
           SELECT 1 FROM learning_sessions session
           WHERE session.id = unit_progress.session_id
             AND session.status = 'active'
         )`,
    )
    .run(
      JSON.stringify({
        type: "interview",
        interviewSessionId: interviewId,
        reportId: interviewId,
      }),
      Date.now(),
      learningSessionId,
      binding.unitId,
    );
}

function startDisclosureContinuation(
  interview: InterviewRow,
  stored: StoredState,
): InterviewDisclosureContinuation {
  const learningSessionId = interview.learningSessionId
    ? LearningSessionIdSchema.parse(interview.learningSessionId)
    : null;
  if ((stored.setup.learningSessionId ?? null) !== learningSessionId) {
    throw new Error(
      `Interview learning-session association is invalid: ${interview.id}`,
    );
  }
  return InterviewDisclosureContinuationSchema.parse({
    kind: "start",
    learningSessionId,
    interviewId: interview.id,
    operationId: stored.setup.operationId,
  });
}

function interviewDisclosureEntityIds(
  continuation: InterviewDisclosureContinuation,
): Record<string, string> {
  return {
    "interview-action": continuation.kind,
    interview: disclosureEntityId("interview", continuation.interviewId),
    "interview-operation": disclosureEntityId(
      "operation",
      continuation.operationId,
    ),
    "interview-scope": continuation.learningSessionId
      ? "learning-session"
      : "standalone",
    ...(continuation.learningSessionId
      ? {
          "learning-session": disclosureEntityId(
            "learning-session",
            continuation.learningSessionId,
          ),
        }
      : {}),
    ...(continuation.kind === "answer"
      ? {
          "interview-question": disclosureEntityId(
            "question",
            continuation.questionId,
          ),
        }
      : {}),
  };
}

function disclosureEntityId(prefix: string, value: string): string {
  return `${prefix}:${createHash("sha256").update(value).digest("hex")}`;
}

async function prepareInterviewDisclosure(
  state: InterviewV2State,
  input: {
    continuation: InterviewDisclosureContinuation;
    payload: string;
    payloadCategories: AiDisclosure["scope"]["payloadCategories"];
    destinationPurpose: string;
  },
): Promise<InterviewPendingDisclosure | null> {
  const entityIds = interviewDisclosureEntityIds(input.continuation);
  const existing = await state.providerRuntime.findPendingDisclosure({
    role: "interviewer",
    payload: input.payload,
    entityIds,
  });
  if (existing) {
    return toInterviewPendingDisclosure(input.continuation, existing);
  }
  const preparation = await state.providerRuntime.prepareDisclosure({
    role: "interviewer",
    payload: input.payload,
    payloadCategories: input.payloadCategories,
    entityIds,
    exclusions: ["protected-evaluation", "credentials", "local-paths"],
    destinationPurpose: input.destinationPurpose,
  });
  return preparation.required
    ? toInterviewPendingDisclosure(input.continuation, preparation.disclosure)
    : null;
}

function toInterviewPendingDisclosure(
  continuation: InterviewDisclosureContinuation,
  disclosure: AiDisclosure,
): InterviewPendingDisclosure {
  return InterviewPendingDisclosureSchema.parse({
    kind: "disclosure",
    required: true,
    continuation,
    disclosure: {
      operationId: disclosure.operationId,
      status: disclosure.status,
      createdAt: disclosure.createdAt,
      expiresAt: disclosure.expiresAt,
      scope: {
        destination: disclosure.scope.destination,
        payloadCategories: disclosure.scope.payloadCategories,
        byteCount: disclosure.scope.byteCount,
        exclusions: disclosure.scope.exclusions,
      },
    },
  });
}

function pendingDisclosureNotFound(
  context: Parameters<Parameters<Hono["onError"]>[0]>[1],
) {
  return context.json(
    { error: "Pending interview disclosure not found." },
    404,
  );
}

function buildQuestionPrompt(
  stored: StoredState,
  transcript: MessageRow[],
  questionNumber: number,
): string {
  return JSON.stringify({
    task: "ask_one_interview_question",
    topics: stored.setup.topics,
    difficulty: stored.setup.difficulty,
    questionNumber,
    questionCount: stored.setup.questionCount,
    transcript: transcript.map(({ role, content }) => ({ role, content })),
    constraints: [
      "Ask exactly one bounded question.",
      "Include a time or answer-length limit.",
      "Do not reveal an answer, rubric, evaluation criteria, or hidden context.",
      "Use the learner's UI locale for prose; keep code and technical identifiers unchanged.",
    ],
  });
}

async function ensureOpeningQuestion(
  state: InterviewV2State,
  selection: ResolvedProviderTurn,
  interview: InterviewRow,
  stored: StoredState,
  signal: AbortSignal,
  disclosureOperationId?: string,
): Promise<void> {
  const key = messageKey(interview.id, "opening", stored.setup.operationId);
  if (findMessageByKey(state, key)) return;
  const turn = await requestQuestion(
    state,
    selection,
    interview,
    stored,
    [],
    1,
    signal,
    disclosureOperationId,
  );
  state.connection.sqlite.exec("BEGIN IMMEDIATE");
  let committed = false;
  try {
    state.providerRuntime.assertDispatchCommitAllowed(turn.dispatch);
    addMessage(state, {
      conversationId: stored.setup.conversationId,
      role: "assistant",
      content: turn.question,
      status: "completed",
      idempotencyKey: key,
    });
    state.connection.sqlite
      .prepare(
        "UPDATE interview_sessions SET status = 'in_progress' WHERE id = ?",
      )
      .run(interview.id);
    state.connection.sqlite.exec("COMMIT");
    committed = true;
    turn.finishCompleted();
  } catch (error) {
    if (!committed && state.connection.sqlite.isTransaction) {
      state.connection.sqlite.exec("ROLLBACK");
    }
    turn.finishFailed(error);
    throw error;
  }
}

async function requestQuestion(
  state: InterviewV2State,
  selection: ResolvedProviderTurn,
  interview: InterviewRow,
  stored: StoredState,
  transcript: MessageRow[],
  questionNumber: number,
  signal: AbortSignal,
  disclosureOperationId?: string,
): Promise<{
  readonly question: string;
  readonly dispatch: ProviderDispatch;
  readonly finishCompleted: () => void;
  readonly finishFailed: (error: unknown) => void;
}> {
  const prompt = buildQuestionPrompt(stored, transcript, questionNumber);
  const dispatch = await state.providerRuntime.resolveDispatch({
    role: "interviewer",
    payload: prompt,
    signal,
    ...(disclosureOperationId ? { disclosureOperationId } : {}),
    metadata: {
      interviewId: interview.id,
      questionNumber,
    },
  });
  if (
    dispatch.connection.connectionId !== selection.connection.connectionId ||
    dispatch.modelId !== selection.modelId
  ) {
    state.providerRuntime.finishDispatch(dispatch, "failed", "misconfigured");
    throw new InterviewProviderFailure(
      "failed",
      "Interviewer provider selection changed during the interview.",
    );
  }
  const provider = dispatch.provider;
  let providerSessionId: string | undefined;
  let terminal: "completed" | "failed" | "cancelled" | undefined;
  let streamStarted = false;
  let streamCompleted = false;
  let dispatchFinished = false;
  const finishDispatch = (
    status: "completed" | "failed" | "cancelled",
    failureCode: ReturnType<typeof providerFailureCode> | null,
  ) => {
    if (dispatchFinished) return;
    dispatchFinished = true;
    state.providerRuntime.finishDispatch(dispatch, status, failureCode);
  };
  try {
    const providerSession = await state.providerRuntime.runOwnedSetup(
      (setupSignal) =>
        provider.createSession(
          {
            role: "interviewer",
            modelId: dispatch.modelId,
            systemPrompt: getLatestPrompt("interviewer").systemPrompt,
            metadata: { interviewId: interview.id },
          },
          setupSignal,
        ),
      signal,
      (session) => provider.cancelSession(session.id),
      (ownedSession) => {
        providerSessionId = ownedSession.id;
      },
    );
    if (
      providerSession.providerId !== dispatch.connection.adapterId ||
      providerSession.role !== "interviewer" ||
      providerSession.modelId !== dispatch.modelId
    ) {
      throw new ProviderHubError(
        "invalid_output",
        "Interviewer provider returned mismatched session metadata",
      );
    }

    let content = "";
    let messageCompleted = false;
    streamStarted = true;
    for await (const event of state.providerRuntime.stream(
      dispatch,
      providerSession.id,
      signal,
      "text",
    )) {
      switch (event.type) {
        case "message.delta":
          content += event.delta;
          break;
        case "message.completed":
          messageCompleted = true;
          content = event.content;
          break;
        case "session.completed":
          terminal = event.reason;
          break;
        case "tool.started":
        case "tool.completed":
          break;
        case "error":
          throw new ProviderHubError(
            "provider_error",
            "Interviewer provider returned an error",
          );
      }
    }
    streamCompleted = true;
    if (signal.aborted || terminal === "cancelled") {
      throw new ProviderHubError(
        "cancelled",
        "Interview request was cancelled",
      );
    }
    if (terminal !== "completed" || !messageCompleted || !content.trim()) {
      throw new ProviderHubError(
        "invalid_output",
        "Interviewer provider did not return one complete question",
      );
    }
    const question = assertSafeQuestion(content.trim());
    return {
      question,
      dispatch,
      finishCompleted: () => finishDispatch("completed", null),
      finishFailed: (error) =>
        finishDispatch("failed", providerFailureCode(error)),
    };
  } catch (error) {
    const cancelled =
      signal.aborted ||
      terminal === "cancelled" ||
      (error instanceof ProviderHubError && error.failure.code === "cancelled");
    finishDispatch(
      cancelled ? "cancelled" : "failed",
      cancelled ? "cancelled" : providerFailureCode(error),
    );
    if (error instanceof ProviderHubError) throw error;
    throw new InterviewProviderFailure(
      cancelled ? "cancelled" : "failed",
      cancelled
        ? "Interview request was cancelled."
        : "Interviewer provider failed.",
    );
  } finally {
    if (providerSessionId && (!streamStarted || streamCompleted)) {
      await provider.cancelSession(providerSessionId).catch(() => undefined);
    }
  }
}

function assertSafeQuestion(value: string): string {
  const protectedPattern =
    /referenceAnswer|correctOptionIds|evaluationPoints|protectedEvaluation|(?:correct|reference) answer\s*:/iu;
  if (protectedPattern.test(value) || value.length > 20_000) {
    throw new InterviewProviderFailure(
      "failed",
      "Interviewer returned an unsafe response.",
    );
  }
  return value;
}

function deriveReport(
  interviewId: string,
  setup: StoredState["setup"],
  transcript: MessageRow[],
): InterviewReport {
  const questions = transcript.filter(
    (message) => message.role === "assistant",
  );
  const answers = transcript.filter((message) => message.role === "user");
  const evidence = answers.map((answer, index) => {
    const wordCount = answer.content
      .trim()
      .split(/\s+/u)
      .filter(Boolean).length;
    return {
      questionNumber: index + 1,
      topic: setup.topics[index % setup.topics.length]!,
      answerExcerpt: answer.content.slice(0, 240),
      observation:
        wordCount >= 20
          ? "Ответ содержит развёрнутое рассуждение; техническая корректность отдельно не оценивалась."
          : "Ответ краткий; техническая корректность отдельно не оценивалась.",
    };
  });
  const developed = evidence.filter((item) =>
    item.observation.startsWith("Ответ содержит"),
  ).length;
  const completionRate =
    questions.length === 0 ? 0 : Math.min(1, answers.length / questions.length);
  return InterviewReportSchema.parse({
    interviewId,
    status: "completed",
    summary:
      "Интервью завершено. Отчёт фиксирует полноту и форму ответов, но не подменяет проверку технической корректности экспертной оценкой.",
    topics: setup.topics,
    metrics: {
      questionsAsked: questions.length,
      questionsAnswered: answers.length,
      completionRate,
    },
    strengths:
      developed > 0
        ? [`${developed} ответ(а) содержат развёрнутое рассуждение.`]
        : ["Все запланированные вопросы получили сохранённый ответ."],
    growthAreas:
      developed < answers.length
        ? [
            "Раскрывать причинно-следственную цепочку и приводить минимальный пример.",
          ]
        : ["Подтвердить техническую корректность ответов отдельной проверкой."],
    evidence,
  });
}

function readPublicInterview(state: InterviewV2State, id: string) {
  const row = readInterviewRow(state, id);
  const stored = parseStoredState(row);
  const learningSessionId =
    row.learningSessionId === null
      ? null
      : LearningSessionIdSchema.parse(row.learningSessionId);
  if ((stored.setup.learningSessionId ?? null) !== learningSessionId) {
    throw new Error(`Interview learning-session association is invalid: ${id}`);
  }
  const transcript = readTranscript(state, stored.setup.conversationId);
  const questionsAsked = countRole(transcript, "assistant");
  const questionsAnswered = countRole(transcript, "user");
  return {
    id: row.id,
    learningSessionId,
    resumeOperationId: row.status === "setup" ? stored.setup.operationId : null,
    status: InterviewStatusSchema.parse(row.status),
    setup: {
      topics: stored.setup.topics,
      difficulty: stored.setup.difficulty,
      questionCount: stored.setup.questionCount,
    },
    transcript: transcript.map((message) => ({
      id: message.id,
      role: z.enum(["user", "assistant"]).parse(message.role),
      content: message.content,
      createdAt: new Date(message.createdAt).toISOString(),
    })),
    progress: {
      questionsAsked,
      questionsAnswered,
      readyToFinish:
        questionsAsked === stored.setup.questionCount &&
        questionsAnswered === questionsAsked,
    },
    report: stored.report ?? null,
    startedAt: new Date(row.startedAt).toISOString(),
    completedAt:
      row.completedAt === null ? null : new Date(row.completedAt).toISOString(),
  };
}

function readInterviewRow(state: InterviewV2State, id: string): InterviewRow {
  const row = state.connection.sqlite
    .prepare(
      `SELECT id, learning_session_id AS learningSessionId, status,
              result_json AS resultJson, started_at AS startedAt,
              completed_at AS completedAt
       FROM interview_sessions WHERE id = ?`,
    )
    .get(id) as InterviewRow | undefined;
  if (!row) throw new Error(`Unknown interview: ${id}`);
  InterviewStatusSchema.parse(row.status);
  return row;
}

function findCurrentInterview(
  state: InterviewV2State,
  learningSessionId?: string,
): InterviewRow | null {
  const row = learningSessionId
    ? state.connection.sqlite
        .prepare(
          `SELECT id, learning_session_id AS learningSessionId, status,
                  result_json AS resultJson, started_at AS startedAt,
                  completed_at AS completedAt
           FROM interview_sessions
           WHERE status IN ('setup', 'in_progress')
             AND learning_session_id = ?
           ORDER BY started_at DESC LIMIT 1`,
        )
        .get(learningSessionId)
    : state.connection.sqlite
        .prepare(
          `SELECT id, learning_session_id AS learningSessionId, status,
                  result_json AS resultJson, started_at AS startedAt,
                  completed_at AS completedAt
           FROM interview_sessions
           WHERE status IN ('setup', 'in_progress')
           ORDER BY started_at DESC LIMIT 1`,
        )
        .get();
  return (row ?? null) as InterviewRow | null;
}

function readKnownLearningSessionId(
  state: InterviewV2State,
  learningSessionId: string,
): string | null {
  const row = state.connection.sqlite
    .prepare("SELECT id FROM learning_sessions WHERE id = ?")
    .get(learningSessionId) as { id: string } | undefined;
  return row ? LearningSessionIdSchema.parse(row.id) : null;
}

function resolveInterviewSetup(
  state: InterviewV2State,
  request: z.infer<typeof InterviewSetupRequestSchema>,
): ResolvedInterviewSetup {
  if (!("learningSessionId" in request)) {
    return {
      operationId: request.operationId,
      topics: request.topics,
      difficulty: request.difficulty,
      questionCount: request.questionCount,
    };
  }
  assertCourseScopedSessionSideEffectAllowed(
    state.connection,
    request.learningSessionId,
  );
  const row = state.connection.sqlite
    .prepare(
      `SELECT session.current_step AS currentStep,
              progress.status AS progressStatus,
              snapshot.id AS snapshotId,
              snapshot.content_hash AS snapshotHash,
              snapshot.snapshot_json AS snapshotJson,
              context.course_id AS courseId,
              context.revision_id AS revisionId,
              context.lesson_id AS lessonId,
              context.snapshot_hash AS contextSnapshotHash,
              context.snapshot_bytes_hash AS snapshotBytesHash
       FROM learning_sessions session
       JOIN session_snapshots snapshot ON snapshot.session_id = session.id
       JOIN session_course_contexts context ON context.session_id = session.id
       JOIN unit_progress progress
         ON progress.session_id = session.id AND progress.unit_id = ?
       WHERE session.id = ? AND session.status = 'active'`,
    )
    .get(request.unitId, request.learningSessionId) as
    | {
        currentStep: string;
        progressStatus: string;
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
  if (!row) throw new Error("Unknown linked Interview unit");
  const snapshot = SessionSnapshotSchema.parse(JSON.parse(row.snapshotJson));
  const { contentHash, ...snapshotCore } = snapshot;
  const unit = snapshot.units.find(
    (candidate) => candidate.id === request.unitId,
  );
  if (
    !unit ||
    unit.type !== "interview" ||
    unit.payload.type !== "interview" ||
    row.progressStatus !== "in_progress" ||
    row.currentStep !== unit.stableId ||
    snapshot.curriculumId !== row.courseId ||
    snapshot.curriculumVersionId !== row.revisionId ||
    snapshot.day.id !== row.lessonId ||
    contentHash !== row.snapshotHash ||
    row.contextSnapshotHash !== row.snapshotHash ||
    hashCanonicalJson(snapshotCore) !== row.snapshotHash ||
    createHash("sha256").update(row.snapshotJson).digest("hex") !==
      row.snapshotBytesHash ||
    canonicalJson(snapshot) !== row.snapshotJson
  ) {
    throw new Error(
      "Linked Interview scope is not an exact current snapshot unit",
    );
  }
  const target = state.connection.sqlite
    .prepare(
      `SELECT activity_type AS activityType, stable_id AS stableId
       FROM course_activities
       WHERE course_id = ? AND revision_id = ? AND lesson_id = ? AND id = ?`,
    )
    .get(row.courseId, row.revisionId, row.lessonId, unit.id) as
    { activityType: string; stableId: string } | undefined;
  if (
    !target ||
    target.activityType !== "interview" ||
    target.stableId !== unit.stableId
  ) {
    throw new Error(
      "Linked Interview unit is not mapped to this Course revision",
    );
  }
  return {
    operationId: request.operationId,
    topics: [...unit.payload.topics],
    difficulty: unit.depthLevel,
    questionCount: request.questionCount,
    learningSessionId: request.learningSessionId,
    courseBinding: InterviewCourseBindingSchema.parse({
      learningSessionId: request.learningSessionId,
      unitId: unit.id,
      courseId: row.courseId,
      revisionId: row.revisionId,
      lessonId: row.lessonId,
      snapshotId: row.snapshotId,
      snapshotHash: row.snapshotHash,
      snapshotBytesHash: row.snapshotBytesHash,
    }),
  };
}

function assertStoredCourseBinding(
  state: InterviewV2State,
  setup: StoredState["setup"],
): InterviewCourseBinding | null {
  if (!setup.learningSessionId) {
    if (setup.courseBinding) {
      throw new Error(
        "Standalone interview contains a Course evidence binding",
      );
    }
    return null;
  }
  const binding = setup.courseBinding;
  if (!binding || binding.learningSessionId !== setup.learningSessionId) {
    throw new Error("Linked interview is missing its Course evidence binding");
  }
  const row = state.connection.sqlite
    .prepare(
      `SELECT snapshot.id AS snapshotId,
              snapshot.content_hash AS snapshotHash,
              snapshot.snapshot_json AS snapshotJson,
              context.course_id AS courseId,
              context.revision_id AS revisionId,
              context.lesson_id AS lessonId,
              context.snapshot_hash AS contextSnapshotHash,
              context.snapshot_bytes_hash AS snapshotBytesHash
       FROM session_snapshots snapshot
       JOIN session_course_contexts context ON context.session_id = snapshot.session_id
       JOIN unit_progress progress
         ON progress.session_id = snapshot.session_id AND progress.unit_id = ?
       WHERE snapshot.session_id = ? AND progress.unit_type = 'interview'`,
    )
    .get(binding.unitId, binding.learningSessionId) as
    | {
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
    !row ||
    row.snapshotId !== binding.snapshotId ||
    row.snapshotHash !== binding.snapshotHash ||
    row.contextSnapshotHash !== binding.snapshotHash ||
    row.snapshotBytesHash !== binding.snapshotBytesHash ||
    row.courseId !== binding.courseId ||
    row.revisionId !== binding.revisionId ||
    row.lessonId !== binding.lessonId ||
    createHash("sha256").update(row.snapshotJson).digest("hex") !==
      binding.snapshotBytesHash
  ) {
    throw new Error(
      "Linked interview Course evidence binding is stale or invalid",
    );
  }
  const snapshot = SessionSnapshotSchema.parse(JSON.parse(row.snapshotJson));
  const { contentHash, ...snapshotCore } = snapshot;
  const unit = snapshot.units.find(
    (candidate) => candidate.id === binding.unitId,
  );
  if (
    !unit ||
    unit.type !== "interview" ||
    unit.payload.type !== "interview" ||
    contentHash !== binding.snapshotHash ||
    hashCanonicalJson(snapshotCore) !== binding.snapshotHash ||
    snapshot.curriculumId !== binding.courseId ||
    snapshot.curriculumVersionId !== binding.revisionId ||
    snapshot.day.id !== binding.lessonId ||
    JSON.stringify(unit.payload.topics) !== JSON.stringify(setup.topics) ||
    unit.depthLevel !== setup.difficulty
  ) {
    throw new Error("Linked interview setup does not match its immutable unit");
  }
  return binding;
}

function findInterviewByOperation(
  state: InterviewV2State,
  operationId: string,
): InterviewRow | null {
  const id = deterministicId("interview", operationId);
  try {
    return readInterviewRow(state, id);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith("Unknown interview:")
    )
      return null;
    throw error;
  }
}

function parseStoredState(row: InterviewRow): StoredState {
  if (!row.resultJson) throw new Error(`Interview state is missing: ${row.id}`);
  return StoredStateSchema.parse(JSON.parse(row.resultJson));
}

function readTranscript(
  state: InterviewV2State,
  conversationId: string,
): MessageRow[] {
  return state.connection.sqlite
    .prepare(
      `SELECT id, role, content, status, sequence,
              idempotency_key AS idempotencyKey, created_at AS createdAt
       FROM agent_messages
       WHERE conversation_id = ?
         AND role IN ('user', 'assistant') AND status = 'completed'
       ORDER BY sequence ASC`,
    )
    .all(conversationId) as unknown as MessageRow[];
}

function readConversation(state: InterviewV2State, id: string) {
  const row = state.connection.sqlite
    .prepare(
      `SELECT provider_id AS providerId, model_id AS modelId
       FROM agent_conversations WHERE id = ? AND role = 'interviewer'`,
    )
    .get(id) as { providerId: string; modelId: string } | undefined;
  if (!row) throw new Error(`Unknown interview conversation: ${id}`);
  return row;
}

function addMessage(
  state: InterviewV2State,
  input: {
    conversationId: string;
    role: "user" | "assistant";
    content: string;
    status: "completed" | "failed" | "cancelled";
    idempotencyKey?: string;
  },
): void {
  if (input.idempotencyKey && findMessageByKey(state, input.idempotencyKey))
    return;
  const latest = state.connection.sqlite
    .prepare(
      "SELECT COALESCE(MAX(sequence), 0) AS sequence FROM agent_messages WHERE conversation_id = ?",
    )
    .get(input.conversationId) as { sequence: number };
  const now = Date.now();
  state.connection.sqlite
    .prepare(
      `INSERT INTO agent_messages
       (id, conversation_id, role, content, tool_events_json, raw_event_json,
        status, sequence, idempotency_key, created_at)
       VALUES (?, ?, ?, ?, '[]', NULL, ?, ?, ?, ?)`,
    )
    .run(
      randomUUID(),
      input.conversationId,
      input.role,
      input.content,
      input.status,
      latest.sequence + 1,
      input.idempotencyKey ?? null,
      now,
    );
  state.connection.sqlite
    .prepare("UPDATE agent_conversations SET updated_at = ? WHERE id = ?")
    .run(now, input.conversationId);
}

function findMessageByKey(
  state: InterviewV2State,
  idempotencyKey: string,
): MessageRow | null {
  return (state.connection.sqlite
    .prepare(
      `SELECT id, role, content, status, sequence,
              idempotency_key AS idempotencyKey, created_at AS createdAt
       FROM agent_messages WHERE idempotency_key = ?`,
    )
    .get(idempotencyKey) ?? null) as MessageRow | null;
}

function cleanupFailedInterviewSetup(
  state: InterviewV2State,
  interviewId: string,
  conversationId: string,
): void {
  state.connection.sqlite.exec("BEGIN IMMEDIATE");
  try {
    const deleted = state.connection.sqlite
      .prepare(
        "DELETE FROM interview_sessions WHERE id = ? AND status = 'setup'",
      )
      .run(interviewId);
    if (deleted.changes === 1) {
      state.connection.sqlite
        .prepare("DELETE FROM agent_conversations WHERE id = ?")
        .run(conversationId);
    }
    state.connection.sqlite.exec("COMMIT");
  } catch (error) {
    state.connection.sqlite.exec("ROLLBACK");
    throw error;
  }
}

function recordProviderFailure(
  state: InterviewV2State,
  conversationId: string,
  error: unknown,
): void {
  const status =
    error instanceof InterviewProviderFailure && error.reason === "cancelled"
      ? "cancelled"
      : "failed";
  addMessage(state, {
    conversationId,
    role: "assistant",
    content:
      status === "cancelled"
        ? "Запрос интервьюера был отменён."
        : "Интервьюер временно недоступен.",
    status,
  });
}

async function readInterviewerSelection(
  state: InterviewV2State,
): Promise<ResolvedProviderTurn> {
  return state.providerRuntime.inspectRole("interviewer");
}

async function readStoredInterviewerSelection(
  state: InterviewV2State,
  stored: StoredState,
): Promise<ResolvedProviderTurn> {
  const conversation = readConversation(state, stored.setup.conversationId);
  const selection = await state.providerRuntime.inspectRole("interviewer");
  if (
    selection.connection.adapterId !== conversation.providerId ||
    selection.modelId !== conversation.modelId
  ) {
    throw new InterviewProviderFailure(
      "failed",
      "Interviewer provider selection changed after this interview started.",
    );
  }
  return selection;
}

function assertSameSetup(
  stored: StoredState["setup"],
  request: ResolvedInterviewSetup,
): void {
  if (
    stored.difficulty !== request.difficulty ||
    stored.questionCount !== request.questionCount ||
    stored.learningSessionId !== request.learningSessionId ||
    JSON.stringify(stored.courseBinding ?? null) !==
      JSON.stringify(request.courseBinding ?? null) ||
    JSON.stringify(stored.topics) !== JSON.stringify(request.topics)
  ) {
    throw new Error(
      "operationId was already used with different interview setup.",
    );
  }
}

function assertSameSetupRequest(
  stored: StoredState["setup"],
  request: z.infer<typeof InterviewSetupRequestSchema>,
): void {
  if ("learningSessionId" in request) {
    if (
      stored.learningSessionId !== request.learningSessionId ||
      stored.courseBinding?.unitId !== request.unitId ||
      stored.questionCount !== request.questionCount
    ) {
      throw new Error(
        "operationId was already used with different interview setup.",
      );
    }
    return;
  }
  assertSameSetup(stored, {
    operationId: request.operationId,
    topics: request.topics,
    difficulty: request.difficulty,
    questionCount: request.questionCount,
  });
}

function countRole(transcript: MessageRow[], role: "user" | "assistant") {
  return transcript.filter((message) => message.role === role).length;
}

function deterministicId(prefix: string, operationId: string): string {
  return `${prefix}-${createHash("sha256").update(operationId).digest("hex").slice(0, 32)}`;
}

function messageKey(
  interviewId: string,
  kind: "opening" | "answer" | "follow-up",
  operationId: string,
): string {
  return `${interviewId}:${kind}:${createHash("sha256")
    .update(operationId)
    .digest("hex")}`;
}

function providerFailureResponse(
  context: Parameters<Parameters<Hono["onError"]>[0]>[1],
  error: unknown,
) {
  if (error instanceof ProviderHubError) {
    return context.json(
      {
        error: error.message,
        failure: error.failure,
        retryable: error.failure.retryable,
      },
      error.failure.code === "ai_disabled" ||
        error.failure.code === "disclosure_required" ||
        error.failure.code === "disclosure_mismatch"
        ? 409
        : 503,
    );
  }
  if (error instanceof InterviewProviderFailure) {
    return context.json(
      {
        error:
          error.reason === "cancelled"
            ? "Interview request was cancelled."
            : "Interviewer provider failed. Your transcript was preserved.",
        retryable: error.reason === "failed",
      },
      error.reason === "cancelled" ? 409 : 502,
    );
  }
  throw error;
}
