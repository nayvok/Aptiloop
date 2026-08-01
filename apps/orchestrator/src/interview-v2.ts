import { createHash, randomUUID } from "node:crypto";

import type { AgentProvider } from "@dlh/agent-core";
import type { DatabaseConnection, LearningRepository } from "@dlh/database";
import { getLatestPrompt } from "@dlh/prompt-library";
import {
  ProviderIdSchema,
  type AgentEvent,
  type ProviderId,
} from "@dlh/shared";
import type { Hono } from "hono";
import { z } from "zod";

const OperationIdSchema = z.string().trim().min(8).max(200);
const TopicSchema = z.string().trim().min(1).max(120);
const DifficultySchema = z.enum(["foundation", "interview-ready", "deep-dive"]);

export const InterviewSetupRequestSchema = z
  .object({
    operationId: OperationIdSchema,
    topics: z.array(TopicSchema).min(1).max(12),
    difficulty: DifficultySchema,
    questionCount: z.number().int().min(1).max(12),
  })
  .strict();

export const InterviewAnswerRequestSchema = z
  .object({
    operationId: OperationIdSchema,
    answer: z.string().trim().min(1).max(20_000),
  })
  .strict();

export const InterviewFinishRequestSchema = z
  .object({ operationId: OperationIdSchema })
  .strict();

const StoredSetupSchema = z.object({
  operationId: OperationIdSchema,
  topics: z.array(TopicSchema).min(1).max(12),
  difficulty: DifficultySchema,
  questionCount: z.number().int().min(1).max(12),
  conversationId: z.string().min(1),
});

const InterviewEvidenceSchema = z.object({
  questionNumber: z.number().int().positive(),
  topic: TopicSchema,
  answerExcerpt: z.string().max(240),
  observation: z.string().min(1),
});

export const InterviewReportSchema = z.object({
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
  repository: Pick<LearningRepository, "getSetting">;
  providers: Record<ProviderId, AgentProvider>;
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
    const existingByOperation = findInterviewByOperation(
      state,
      body.operationId,
    );
    if (existingByOperation) {
      const stored = parseStoredState(existingByOperation);
      assertSameSetup(stored.setup, body);
      if (existingByOperation.status === "setup") {
        try {
          await ensureOpeningQuestion(
            state,
            existingByOperation,
            stored,
            context.req.raw.signal,
          );
        } catch (error) {
          recordProviderFailure(state, stored.setup.conversationId, error);
          return providerFailureResponse(context, error);
        }
      }
      return context.json(
        readPublicInterview(state, existingByOperation.id),
        200,
      );
    }

    const current = findCurrentInterview(state);
    if (current) {
      return context.json(
        { error: "Finish the current interview before starting another one." },
        409,
      );
    }

    const selection = await readInterviewerSelection(state);
    const interviewId = deterministicId("interview", body.operationId);
    const conversationId = `${interviewId}:conversation`;
    const now = Date.now();
    const learningSessionId = findCurrentLearningSessionId(state);
    const stored = StoredStateSchema.parse({
      schemaVersion: 1,
      setup: { ...body, conversationId },
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
          selection.providerId,
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
      await ensureOpeningQuestion(
        state,
        readInterviewRow(state, interviewId),
        stored,
        context.req.raw.signal,
      );
    } catch (error) {
      recordProviderFailure(state, stored.setup.conversationId, error);
      return providerFailureResponse(context, error);
    }
    return context.json(readPublicInterview(state, interviewId), 201);
  });

  app.get("/api/interviews/v2/current", (context) => {
    const current = findCurrentInterview(state);
    return context.json({
      interview: current ? readPublicInterview(state, current.id) : null,
    });
  });

  app.get("/api/interviews/v2/:id", (context) => {
    return context.json(readPublicInterview(state, context.req.param("id")));
  });

  app.post("/api/interviews/v2/:id/answers", async (context) => {
    const body = InterviewAnswerRequestSchema.parse(await context.req.json());
    const interview = readInterviewRow(state, context.req.param("id"));
    const stored = parseStoredState(interview);
    if (interview.status !== "in_progress") {
      return context.json(
        { error: "Interview is not accepting answers." },
        409,
      );
    }

    const transcriptBefore = readTranscript(state, stored.setup.conversationId);
    const askedBefore = countRole(transcriptBefore, "assistant");
    const answeredBefore = countRole(transcriptBefore, "user");
    const answerKey = messageKey(interview.id, "answer", body.operationId);
    const existingAnswer = findMessageByKey(state, answerKey);
    if (existingAnswer && existingAnswer.content !== body.answer) {
      return context.json(
        {
          error: "operationId was already used with different answer content.",
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
    const questionKey = messageKey(interview.id, "follow-up", body.operationId);
    if (
      answered < stored.setup.questionCount &&
      !findMessageByKey(state, questionKey)
    ) {
      try {
        const question = await requestQuestion(
          state,
          interview,
          stored,
          transcript,
          answered + 1,
          context.req.raw.signal,
        );
        addMessage(state, {
          conversationId: stored.setup.conversationId,
          role: "assistant",
          content: question,
          status: "completed",
          idempotencyKey: questionKey,
        });
      } catch (error) {
        recordProviderFailure(state, stored.setup.conversationId, error);
        return providerFailureResponse(context, error);
      }
    }

    return context.json(readPublicInterview(state, interview.id));
  });

  app.post("/api/interviews/v2/:id/finish", async (context) => {
    const body = InterviewFinishRequestSchema.parse(await context.req.json());
    const interview = readInterviewRow(state, context.req.param("id"));
    const stored = parseStoredState(interview);
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
      state.connection.sqlite.exec("COMMIT");
    } catch (error) {
      state.connection.sqlite.exec("ROLLBACK");
      throw error;
    }
    return context.json({
      interview: readPublicInterview(state, interview.id),
      report,
    });
  });
}

async function ensureOpeningQuestion(
  state: InterviewV2State,
  interview: InterviewRow,
  stored: StoredState,
  signal: AbortSignal,
): Promise<void> {
  const key = messageKey(interview.id, "opening", stored.setup.operationId);
  if (findMessageByKey(state, key)) return;
  const question = await requestQuestion(
    state,
    interview,
    stored,
    [],
    1,
    signal,
  );
  state.connection.sqlite.exec("BEGIN IMMEDIATE");
  try {
    addMessage(state, {
      conversationId: stored.setup.conversationId,
      role: "assistant",
      content: question,
      status: "completed",
      idempotencyKey: key,
    });
    state.connection.sqlite
      .prepare(
        "UPDATE interview_sessions SET status = 'in_progress' WHERE id = ?",
      )
      .run(interview.id);
    state.connection.sqlite.exec("COMMIT");
  } catch (error) {
    state.connection.sqlite.exec("ROLLBACK");
    throw error;
  }
}

async function requestQuestion(
  state: InterviewV2State,
  interview: InterviewRow,
  stored: StoredState,
  transcript: MessageRow[],
  questionNumber: number,
  signal: AbortSignal,
): Promise<string> {
  const conversation = readConversation(state, stored.setup.conversationId);
  const providerId = ProviderIdSchema.parse(conversation.providerId);
  const provider = state.providers[providerId];
  if (!provider) {
    throw new InterviewProviderFailure("failed", "Interviewer is unavailable.");
  }
  let providerSession: Awaited<ReturnType<AgentProvider["createSession"]>>;
  try {
    providerSession = await provider.createSession({
      role: "interviewer",
      modelId: conversation.modelId,
      systemPrompt: getLatestPrompt("interviewer").systemPrompt,
      metadata: { interviewId: interview.id },
    });
  } catch {
    throw new InterviewProviderFailure(
      "failed",
      "Interviewer provider could not start a session.",
    );
  }
  state.connection.sqlite
    .prepare(
      `UPDATE agent_conversations
       SET provider_session_id = ?, updated_at = ? WHERE id = ?`,
    )
    .run(providerSession.id, Date.now(), stored.setup.conversationId);

  const prompt = JSON.stringify({
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
    ],
  });
  let content = "";
  let terminal: "completed" | "failed" | "cancelled" | undefined;
  let providerMessage = "Interviewer provider failed.";
  const cancel = () => {
    void provider.cancelSession(providerSession.id).catch(() => {});
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    if (signal.aborted) cancel();
    for await (const event of provider.streamMessage({
      sessionId: providerSession.id,
      message: prompt,
      responseFormat: "text",
    })) {
      collectProviderEvent(event, {
        append: (delta) => {
          content += delta;
        },
        replace: (value) => {
          content = value;
        },
        fail: (message) => {
          providerMessage = message;
        },
        complete: (reason) => {
          terminal = reason;
        },
      });
    }
  } catch {
    throw new InterviewProviderFailure(
      signal.aborted ? "cancelled" : "failed",
      signal.aborted ? "Interview request was cancelled." : providerMessage,
    );
  } finally {
    signal.removeEventListener("abort", cancel);
  }
  if (signal.aborted || terminal === "cancelled") {
    throw new InterviewProviderFailure(
      "cancelled",
      "Interview request was cancelled.",
    );
  }
  if (terminal !== "completed" || !content.trim()) {
    throw new InterviewProviderFailure("failed", providerMessage);
  }
  return assertSafeQuestion(content.trim());
}

function collectProviderEvent(
  event: AgentEvent,
  handlers: {
    append(value: string): void;
    replace(value: string): void;
    fail(message: string): void;
    complete(reason: "completed" | "failed" | "cancelled"): void;
  },
): void {
  if (event.type === "message.delta") handlers.append(event.delta);
  if (event.type === "message.completed") handlers.replace(event.content);
  if (event.type === "error") handlers.fail(event.error.message);
  if (event.type === "session.completed") handlers.complete(event.reason);
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
        : ["Подтвердить техническую корректность ответов отдельным review."],
    evidence,
  });
}

function readPublicInterview(state: InterviewV2State, id: string) {
  const row = readInterviewRow(state, id);
  const stored = parseStoredState(row);
  const transcript = readTranscript(state, stored.setup.conversationId);
  const questionsAsked = countRole(transcript, "assistant");
  const questionsAnswered = countRole(transcript, "user");
  return {
    id: row.id,
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

function findCurrentInterview(state: InterviewV2State): InterviewRow | null {
  return (state.connection.sqlite
    .prepare(
      `SELECT id, learning_session_id AS learningSessionId, status,
              result_json AS resultJson, started_at AS startedAt,
              completed_at AS completedAt
       FROM interview_sessions
       WHERE status IN ('setup', 'in_progress')
       ORDER BY started_at DESC LIMIT 1`,
    )
    .get() ?? null) as InterviewRow | null;
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

async function readInterviewerSelection(state: InterviewV2State): Promise<{
  providerId: ProviderId;
  modelId: string;
}> {
  const providerId = ProviderIdSchema.parse(
    (await state.repository.getSetting("interviewerProvider")) ?? "mock",
  );
  const modelId = z
    .string()
    .min(1)
    .parse(
      (await state.repository.getSetting("interviewerModel")) ??
        "mock-deterministic",
    );
  if (!state.providers[providerId]) {
    throw new Error(
      `Configured interviewer provider is unavailable: ${providerId}`,
    );
  }
  return { providerId, modelId };
}

function findCurrentLearningSessionId(state: InterviewV2State): string | null {
  const row = state.connection.sqlite
    .prepare(
      "SELECT id FROM learning_sessions WHERE status = 'active' ORDER BY updated_at DESC LIMIT 1",
    )
    .get() as { id: string } | undefined;
  return row?.id ?? null;
}

function assertSameSetup(
  stored: StoredState["setup"],
  request: z.infer<typeof InterviewSetupRequestSchema>,
): void {
  if (
    stored.difficulty !== request.difficulty ||
    stored.questionCount !== request.questionCount ||
    JSON.stringify(stored.topics) !== JSON.stringify(request.topics)
  ) {
    throw new Error(
      "operationId was already used with different interview setup.",
    );
  }
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
