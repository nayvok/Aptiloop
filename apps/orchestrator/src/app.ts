import { randomUUID } from "node:crypto";
import { mkdir, realpath, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  MockAgentProvider,
  parseReviewResult,
  type AgentProvider,
} from "@dlh/agent-core";
import { CodexProvider } from "@dlh/codex-provider";
import { weekOneCurriculum } from "@dlh/curriculum";
import {
  createLearningRepository,
  migrateDatabase,
  openDatabase,
  seedCurriculum,
  type DatabaseConnection,
  type LearningRepository,
} from "@dlh/database";
import {
  AllowedProcessRunner,
  buildZedOpenPlan,
  createExerciseAttemptWorkspace,
  ensureExerciseBaseline,
  fingerprintExerciseDiff,
  getExerciseDiff,
  openInZed,
  resolveWorkspacePath,
} from "@dlh/exercise-core";
import { exportFlashcards } from "@dlh/learning-core";
import {
  OpenCodeAgentProvider,
  validateOpenCodeEndpoint,
} from "@dlh/opencode-provider";
import { getLatestPrompt } from "@dlh/prompt-library";
import {
  AgentRoleSchema,
  ProviderIdSchema,
  type ReviewResult,
  type AgentEvent,
  type AgentRole,
  type ProviderId,
} from "@dlh/shared";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";

import { registerVersionedLearningRoutes } from "./learning-v2.js";
import { registerCurriculumEditorRoutes } from "./curriculum-editor.js";
import { registerInterviewV2Routes } from "./interview-v2.js";

const sourceRoot = fileURLToPath(new URL("../../..", import.meta.url));
const defaultOpenCodeEndpoint = "http://127.0.0.1:4096";
const defaultWebOrigin = "http://127.0.0.1:3000";
const mutationMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const dimensions = [
  "understanding",
  "explanation",
  "codeReading",
  "implementation",
  "debugging",
  "interview",
] as const;
const stepLabels = [
  ["review", "Повторение"],
  ["theory", "Теория"],
  ["socratic", "Диалог"],
  ["quiz", "Квиз"],
  ["practice", "Практика"],
  ["summary", "Итоги"],
] as const;

export interface AppOptions {
  projectRoot?: string;
  databasePath?: string;
  connection?: DatabaseConnection;
  providers?: Partial<Record<ProviderId, AgentProvider>>;
  webOrigin?: string;
  exerciseAttemptsRoot?: string;
}

interface AttemptRecord {
  id: string;
  sessionId: string;
  exerciseId: string;
  workspacePath: string;
  baselineHash: string;
}

interface ExerciseContext {
  sessionId: string;
  exercise: {
    id: string;
    templateExerciseId: string;
    title: string;
    prompt: string;
    difficulty: string;
    estimatedMinutes: number;
    workspacePath: string;
    constraints: string[];
    criteria: string[];
    topics: string[];
  };
}

interface TestRunRecord {
  id: string;
  exerciseAttemptId: string;
  operationId: string;
  status: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number | null;
  diffFingerprint: string | null;
  diffTruncated: number;
  startedAt: number;
  completedAt: number | null;
}

interface ReviewRecord {
  id: string;
  status: string;
  resultJson: string;
  createdAt: number;
}

interface ProviderSessionRecord {
  providerId: ProviderId;
  provider: AgentProvider;
  providerSessionId: string;
  conversationId: string;
}

interface AppState {
  connection: DatabaseConnection;
  repository: LearningRepository;
  projectRoot: string;
  defaultWorkspaceRoot: string;
  exerciseAttemptsRoot: string;
  providers: Record<ProviderId, AgentProvider>;
  providerSessions: Map<string, ProviderSessionRecord>;
  activeProviderTurns: Map<
    string,
    { key: string; session: ProviderSessionRecord }
  >;
}

const settingsSchema = z.object({
  workspaceRoot: z.string().min(1),
  zedExecutable: z.string().min(1),
  opencodeBaseUrl: z.string().url(),
  teacherProvider: ProviderIdSchema,
  teacherModel: z.string().min(1),
  reviewerProvider: ProviderIdSchema,
  reviewerModel: z.string().min(1),
  interviewerProvider: ProviderIdSchema,
  interviewerModel: z.string().min(1),
  curatorProvider: ProviderIdSchema,
  curatorModel: z.string().min(1),
  codexExpertProvider: ProviderIdSchema,
  codexExpertModel: z.string().min(1),
  theme: z.enum(["system", "light", "dark"]),
});
type AppSettings = z.infer<typeof settingsSchema>;
const settingsMutationSchema = settingsSchema.omit({
  workspaceRoot: true,
  zedExecutable: true,
});

const chatSchema = z.object({
  role: AgentRoleSchema.default("teacher"),
  providerId: ProviderIdSchema.optional(),
  modelId: z.string().min(1).optional(),
  sessionId: z.string().min(1).optional(),
  message: z.string().trim().min(1).max(50_000),
});

export function createApp(options: AppOptions = {}) {
  const projectRoot = path.resolve(options.projectRoot ?? sourceRoot);
  loadRootEnvironment(projectRoot);
  const databasePath =
    options.databasePath ??
    resolveDatabasePath(
      projectRoot,
      process.env.DATABASE_PATH ?? process.env.DATABASE_URL,
    ) ??
    path.join(projectRoot, ".data", "dev-learning-harness.sqlite");
  const connection = options.connection ?? openDatabase(databasePath);
  migrateDatabase(
    connection,
    path.join(projectRoot, "packages", "database", "migrations"),
  );
  seedCurriculum(connection);

  const repository = createLearningRepository(connection);
  const allowedWebOrigin = validateWebOrigin(
    options.webOrigin ?? process.env.WEB_ORIGIN ?? defaultWebOrigin,
  );
  const persistedOpenCodeEndpoint = readSettingSync<string>(
    connection,
    "opencodeBaseUrl",
  );
  const opencodeEndpoint = validateOpenCodeEndpoint(
    process.env.OPENCODE_ENDPOINT ??
      persistedOpenCodeEndpoint ??
      defaultOpenCodeEndpoint,
  );
  const defaultProviders: Record<ProviderId, AgentProvider> = {
    mock: new MockAgentProvider(),
    codex: new CodexProvider({ cwd: projectRoot }),
    opencode: new OpenCodeAgentProvider({
      directory: projectRoot,
      endpoint: opencodeEndpoint,
    }),
  };
  const state: AppState = {
    connection,
    repository,
    projectRoot,
    defaultWorkspaceRoot: path.resolve(
      projectRoot,
      process.env.WORKSPACE_ROOT ?? path.join("workspaces", "exercises"),
    ),
    exerciseAttemptsRoot: path.resolve(
      projectRoot,
      options.exerciseAttemptsRoot ??
        process.env.EXERCISE_ATTEMPTS_ROOT ??
        path.join(".data", "exercise-attempts"),
    ),
    providers: { ...defaultProviders, ...options.providers },
    providerSessions: new Map(),
    activeProviderTurns: new Map(),
  };
  const app = new Hono();

  app.onError((error, context) => {
    console.error("orchestrator_request_failed", {
      name: error.name,
      message: error.message,
    });
    const status = /unknown|not found/iu.test(error.message) ? 404 : 400;
    return context.json({ error: error.message }, status);
  });

  app.use("/api/*", async (context, next) => {
    const client = context.req.header("X-DLH-Client");
    if (client !== "web" && process.env.NODE_ENV !== "test") {
      return context.json(
        { error: "Missing trusted local client header" },
        403,
      );
    }
    const isMutation = mutationMethods.has(context.req.method.toUpperCase());
    const origin = context.req.header("Origin");
    if (
      (isMutation && !origin) ||
      (origin && !isAllowedWebOrigin(origin, allowedWebOrigin))
    ) {
      return context.json({ error: "Origin is not allowed" }, 403);
    }
    if (isMutation && !isJsonContentType(context.req.header("Content-Type"))) {
      return context.json({ error: "JSON content type is required" }, 415);
    }
    await next();
  });

  app.get("/health/ready", (context) =>
    context.json({ status: "ready", database: "connected" }),
  );

  app.get("/api/providers", async (context) => {
    const providers = await Promise.all(
      Object.values(state.providers).map(async (provider) => {
        const status = await provider.getStatus();
        const models =
          status.state === "connected"
            ? await provider.listModels().catch(() => [])
            : [];
        return {
          id: provider.id,
          label:
            provider.id === "mock"
              ? "Mock"
              : provider.id === "codex"
                ? "Codex"
                : "OpenCode",
          status: status.state,
          model: models[0]?.name,
          models,
          message: status.message,
        };
      }),
    );
    return context.json({ providers });
  });

  app.get("/api/dashboard", async (context) => {
    const dashboard = await state.repository.getDashboard();
    const completed = new Set(
      dashboard.days
        .filter((day) => day.sessionStatus === "completed")
        .map((day) => day.dayNumber),
    );
    const activeDay = dashboard.activeSession
      ? dashboard.days.find((day) => day.id === dashboard.activeSession?.dayId)
      : undefined;
    const todayNumber =
      activeDay?.dayNumber ??
      dashboard.days.find((day) => !completed.has(day.dayNumber))?.dayNumber ??
      7;
    const authoredDay = weekOneCurriculum.days.find(
      (day) => day.dayNumber === todayNumber,
    )!;
    const knowledge = await state.repository.getKnowledgeMap();
    const allScores = knowledge.flatMap((topic) => topic.mastery);
    const mastery = allScores.length
      ? allScores.reduce((sum, score) => sum + score.score / 100, 0) /
        allScores.length
      : 0;
    const recentMistakes = readMistakes(state.connection, 3);
    return context.json({
      week: {
        number: weekOneCurriculum.weekNumber,
        title: weekOneCurriculum.title,
        days: dashboard.days.map((day) => ({
          dayNumber: day.dayNumber,
          title: day.title,
          status: completed.has(day.dayNumber)
            ? "completed"
            : day.dayNumber === todayNumber
              ? "today"
              : "upcoming",
        })),
      },
      today: {
        dayNumber: authoredDay.dayNumber,
        title: authoredDay.title,
        description: authoredDay.summary,
        topics: authoredDay.topics.map((topic) => topic.title),
        estimatedMinutes: authoredDay.estimatedMinutes,
        progress: dashboard.activeSession ? 20 : 0,
        ...(dashboard.activeSession
          ? { sessionId: dashboard.activeSession.id }
          : {}),
      },
      stats: {
        mastery,
        unfinishedExercises: dashboard.activeSession ? 1 : 0,
        cardsDue: dashboard.dueFlashcards,
      },
      reviewTopics: knowledge.slice(0, 3).map((topic) => ({
        id: topic.topic.id,
        title: topic.topic.title,
        reason:
          topic.openMistakes > 0
            ? "Есть незакрытая ошибка"
            : "Нужна первая проверка активным воспроизведением",
      })),
      recentMistakes: recentMistakes.map((mistake) => ({
        id: mistake.id,
        title: mistake.topic,
        detail: mistake.summary,
        createdAt: new Date(mistake.lastSeenAt).toISOString(),
      })),
    });
  });

  registerVersionedLearningRoutes(app, state);
  registerCurriculumEditorRoutes(app, state);
  registerInterviewV2Routes(app, state);

  app.post("/api/learning/sessions", async (context) => {
    const input = z
      .object({ dayNumber: z.number().int().min(1).max(7) })
      .parse(await context.req.json());
    const day = weekOneCurriculum.days.find(
      (candidate) => candidate.dayNumber === input.dayNumber,
    );
    if (!day) throw new Error("Unknown curriculum day");
    const detail = await state.repository.startSession({
      dayId: day.id,
      idempotencyKey: `day:${day.id}:active`,
    });
    return context.json({ id: detail.session.id }, 201);
  });

  app.get("/api/learning/sessions/:id", async (context) => {
    const detail = await state.repository.getSession(context.req.param("id"));
    return context.json(toSessionResponse(detail));
  });

  app.post("/api/learning/sessions/:id/answers", async (context) => {
    const body = z
      .object({
        questionId: z.string().min(1),
        answer: z.string().trim().min(1).max(50_000),
      })
      .parse(await context.req.json());
    await state.repository.recordAnswer({
      sessionId: context.req.param("id"),
      questionId: body.questionId,
      answer: body.answer,
    });
    return context.json({ saved: true });
  });

  app.post("/api/learning/sessions/:id/complete", async (context) => {
    const session = await state.repository.getSession(context.req.param("id"));
    const topic = session.topics[0];
    const answer = session.questions[0]?.attempts.at(-1)?.answer;
    await state.repository.completeSession({
      sessionId: session.session.id,
      mastery: topic
        ? dimensions.map((dimension, index) => ({
            topicId: topic.id,
            dimension,
            evidenceType: index < 3 ? "explanation" : "exercise",
            sourceId: session.session.id,
            delta: index < 3 ? 45 : 30,
            score: index < 3 ? 120 : 90,
            confidence: 35,
            evidenceTypes: ["explanation", "exercise"],
          }))
        : [],
      mistakes:
        topic && answer
          ? [
              {
                topicId: topic.id,
                sourceType: "answer",
                sourceId: session.questions[0]?.id ?? session.session.id,
                summary: "Проверить точность причинно-следственной связи",
                correction:
                  "Сначала сформулировать механизм, затем следствие и короткий пример.",
                fingerprint: `${topic.id}:causal-chain`,
              },
            ]
          : [],
      flashcards: topic
        ? [
            {
              topicId: topic.id,
              sourceMistakeFingerprint: `${topic.id}:causal-chain`,
              front: `Как кратко объяснить тему «${topic.title}»?`,
              back: "Определение → механизм → следствие → минимальный пример.",
            },
          ]
        : [],
    });
    return context.json({ completed: true });
  });

  app.post("/api/agent/stream", async (context) => {
    const body = chatSchema.parse(await context.req.json());
    const settings = await readSettings(state);
    const configured = selectionForRole(settings, body.role);
    const providerId = body.providerId ?? configured.providerId;
    const provider = state.providers[providerId];
    const modelId =
      body.modelId ??
      (providerId === configured.providerId
        ? configured.modelId
        : await defaultModel(provider));
    const key = `${body.sessionId ?? "global"}:${body.role}:${providerId}:${modelId}`;
    let storedSession = state.providerSessions.get(key);
    if (!storedSession) {
      const session = await provider.createSession({
        role: body.role,
        modelId,
        systemPrompt: getLatestPrompt(body.role).systemPrompt,
        metadata: body.sessionId ? { learningSessionId: body.sessionId } : {},
      });
      const conversation = await state.repository.createConversation({
        learningSessionId: body.sessionId ?? null,
        role: body.role,
        providerId,
        modelId,
        providerSessionId: session.id,
      });
      storedSession = {
        providerId,
        provider,
        providerSessionId: session.id,
        conversationId: conversation.id,
      };
      state.providerSessions.set(key, storedSession);
    }
    const activeProviderSessionId = storedSession.providerSessionId;
    const conversationId = storedSession.conversationId;
    await state.repository.addMessage({
      conversationId,
      role: "user",
      content: body.message,
    });
    context.header("X-DLH-Agent-Session-Id", activeProviderSessionId);
    state.activeProviderTurns.set(activeProviderSessionId, {
      key,
      session: storedSession,
    });
    return streamSSE(context, async (stream) => {
      let assistantContent = "";
      let failedMessage: string | undefined;
      let terminalReason: "completed" | "failed" | "cancelled" | undefined;
      let streamThrew = false;
      const toolEvents: AgentEvent[] = [];
      const onAbort = () => {
        void cancelAndEvictProviderSession(state, key, storedSession).catch(
          () => {},
        );
      };
      context.req.raw.signal.addEventListener("abort", onAbort, { once: true });
      try {
        for await (const event of provider.streamMessage({
          sessionId: activeProviderSessionId,
          message: body.message,
          responseFormat: body.role === "reviewer" ? "json" : "text",
        })) {
          if (event.type === "message.delta") assistantContent += event.delta;
          if (event.type === "message.completed") {
            assistantContent = event.content;
          }
          if (event.type === "error") failedMessage = event.error.message;
          if (event.type === "session.completed") {
            terminalReason = event.reason;
          }
          if (
            event.type === "tool.started" ||
            event.type === "tool.completed"
          ) {
            toolEvents.push(event);
          }
          const clientEvent =
            event.type === "message.delta"
              ? { type: event.type, content: event.delta }
              : event.type === "error"
                ? { type: event.type, message: event.error.message }
                : event.type === "tool.started" ||
                    event.type === "tool.completed"
                  ? { type: event.type, name: event.toolName }
                  : event;
          await stream.writeSSE({ data: JSON.stringify(clientEvent) });
        }
      } catch (error) {
        streamThrew = true;
        throw error;
      } finally {
        context.req.raw.signal.removeEventListener("abort", onAbort);
        const activeTurn = state.activeProviderTurns.get(
          activeProviderSessionId,
        );
        if (activeTurn?.session === storedSession) {
          state.activeProviderTurns.delete(activeProviderSessionId);
        }
        if (
          streamThrew ||
          failedMessage ||
          terminalReason === "failed" ||
          terminalReason === "cancelled"
        ) {
          evictProviderSession(state, key, storedSession);
        }
        await persistAgentResponse(state, {
          conversationId,
          content: assistantContent || failedMessage || "Ответ был отменён.",
          toolEvents,
          status:
            terminalReason === "cancelled"
              ? "cancelled"
              : failedMessage || streamThrew || terminalReason === "failed"
                ? "failed"
                : "completed",
        });
      }
    });
  });

  app.delete("/api/agent/sessions/:id/turn", async (context) => {
    const providerSessionId = context.req.param("id");
    const active = state.activeProviderTurns.get(providerSessionId);
    if (!active) {
      return context.json({ error: "Unknown active agent session" }, 404);
    }
    await cancelAndEvictProviderSession(state, active.key, active.session);
    return context.json({ cancelled: true });
  });

  app.get("/api/agent/history", (context) => {
    const role = AgentRoleSchema.parse(context.req.query("role") ?? "teacher");
    const sessionId = context.req.query("sessionId");
    const conversation = sessionId
      ? state.connection.sqlite
          .prepare(
            `SELECT id FROM agent_conversations
             WHERE role = ? AND learning_session_id = ?
             ORDER BY updated_at DESC LIMIT 1`,
          )
          .get(role, sessionId)
      : state.connection.sqlite
          .prepare(
            `SELECT id FROM agent_conversations
             WHERE role = ? AND learning_session_id IS NULL
             ORDER BY updated_at DESC LIMIT 1`,
          )
          .get(role);
    if (!conversation) return context.json({ messages: [] });
    const { id } = conversation as { id: string };
    const messages = state.connection.sqlite
      .prepare(
        `SELECT id, role, content FROM agent_messages
         WHERE conversation_id = ? AND role IN ('user', 'assistant')
         ORDER BY sequence ASC`,
      )
      .all(id) as Array<{
      id: string;
      role: "user" | "assistant";
      content: string;
    }>;
    return context.json({ messages });
  });

  app.get("/api/exercises/current", async (context) => {
    let sessionId = context.req.query("sessionId");
    if (!sessionId) {
      const currentVersioned =
        await state.repository.getCurrentVersionedSession();
      sessionId = currentVersioned?.session.id;
    }
    if (!sessionId) {
      const dashboard = await state.repository.getDashboard();
      sessionId = dashboard.activeSession?.id;
    }
    if (!sessionId) throw new Error("No active learning session");
    const resolved = await resolveExerciseContext(state, sessionId);
    const { exercise } = resolved;
    const versioned = await readVersionedExerciseProgress(state, sessionId);
    const attempt = findAttemptByExercise(
      state.connection,
      resolved.sessionId,
      exercise.templateExerciseId,
    );
    const attemptEvidence = attempt
      ? await readAttemptEvidence(state.connection, attempt)
      : null;
    return context.json({
      sessionId: resolved.sessionId,
      exerciseUnitId: versioned?.exerciseUnitId ?? null,
      reviewUnitId: versioned?.reviewUnitId ?? null,
      exerciseUnitProgress: versioned?.exerciseUnitProgress ?? null,
      reviewUnitProgress: versioned?.reviewUnitProgress ?? null,
      id: exercise.id,
      title: exercise.title,
      prompt: exercise.prompt,
      difficulty: exercise.difficulty,
      estimatedMinutes: exercise.estimatedMinutes,
      criteria: exercise.criteria,
      constraints: exercise.constraints,
      topics: exercise.topics,
      // A versioned session only reveals the server-created isolated attempt
      // path. The trusted template path remains an implementation detail.
      workspacePath: versioned
        ? (attempt?.workspacePath ?? null)
        : exercise.workspacePath,
      ...(attempt
        ? {
            attempt: {
              id: attempt.id,
              changed: attemptEvidence?.diff.changed ?? false,
              testsRun: Boolean(attemptEvidence?.latestTestRun),
              diff: attemptEvidence?.diff ?? {
                patch: "",
                changed: false,
                truncated: false,
              },
              latestTestRun: attemptEvidence?.latestTestRun ?? null,
              latestReview: attemptEvidence?.latestReview ?? null,
            },
          }
        : {}),
    });
  });

  app.post("/api/exercises/:id/attempts", async (context) => {
    const body = z
      .object({ sessionId: z.string().min(1) })
      .strict()
      .parse(await context.req.json());
    const resolved = await resolveExerciseContext(
      state,
      body.sessionId,
      context.req.param("id"),
    );
    const { exercise } = resolved;
    const versioned = await readVersionedExerciseProgress(
      state,
      body.sessionId,
    );
    if (
      versioned &&
      versioned.exerciseUnitProgress.status !== "ready" &&
      versioned.exerciseUnitProgress.status !== "in_progress"
    ) {
      return context.json(
        {
          error:
            "Практика ещё заблокирована. Завершите предыдущие шаги занятия.",
        },
        409,
      );
    }
    const existing = findAttemptByExercise(
      state.connection,
      body.sessionId,
      exercise.templateExerciseId,
    );
    if (existing) return context.json({ id: existing.id });
    const absoluteWorkspace = await resolveExerciseWorkspace(
      state,
      exercise.workspacePath,
    );
    const id = randomUUID();
    await mkdir(state.exerciseAttemptsRoot, { recursive: true });
    const isolated = await createExerciseAttemptWorkspace({
      attemptsRoot: state.exerciseAttemptsRoot,
      attemptId: id,
      templateRoot: absoluteWorkspace,
    });
    let baseline;
    try {
      baseline = await ensureExerciseBaseline(isolated.workspacePath);
    } catch (error) {
      await rm(isolated.workspacePath, { recursive: true, force: true });
      throw error;
    }
    const now = Date.now();
    try {
      state.connection.sqlite
        .prepare(
          `INSERT INTO exercise_attempts
           (id, session_id, exercise_id, status, workspace_path, baseline_path, baseline_hash, started_at, completed_at, updated_at)
           VALUES (?, ?, ?, 'active', ?, ?, ?, ?, NULL, ?)`,
        )
        .run(
          id,
          body.sessionId,
          exercise.templateExerciseId,
          isolated.workspacePath,
          isolated.workspacePath,
          baseline.commit,
          now,
          now,
        );
    } catch (error) {
      await rm(isolated.workspacePath, { recursive: true, force: true });
      const raced = findAttemptByExercise(
        state.connection,
        body.sessionId,
        exercise.templateExerciseId,
      );
      if (raced) return context.json({ id: raced.id });
      throw error;
    }
    return context.json({ id }, 201);
  });

  app.get("/api/exercise-attempts/:id/diff", async (context) => {
    const attempt = await requireAttempt(state, context.req.param("id"));
    const diff = await getExerciseDiff(attempt.workspacePath, {
      expectedBaselineHash: attempt.baselineHash,
    });
    return context.json({
      diff: diff.patch,
      changed: diff.hasChanges,
      truncated: diff.truncated,
    });
  });

  app.post("/api/exercise-attempts/:id/commands", async (context) => {
    const attempt = await requireAttempt(state, context.req.param("id"));
    const body = z
      .object({
        operationId: z.string().trim().min(1).max(200),
        commandId: z.literal("test"),
      })
      .strict()
      .parse(await context.req.json());
    const previousRun = findTestRunByOperation(
      state.connection,
      body.operationId,
    );
    if (previousRun) {
      if (previousRun.exerciseAttemptId !== attempt.id) {
        return context.json(
          { error: "Operation ID has already been used" },
          409,
        );
      }
      return context.json(toTestRunResponse(previousRun));
    }
    const npmTest = npmTestCommand();
    const runner = new AllowedProcessRunner({
      test: {
        executable: npmTest.executable,
        args: npmTest.args,
        timeoutMs: 120_000,
      },
    });
    const testRunId = randomUUID();
    const startedAt = Date.now();
    state.connection.sqlite
      .prepare(
        `INSERT INTO test_runs
         (id, exercise_attempt_id, operation_id, status, exit_code, stdout, stderr, duration_ms, started_at, completed_at)
         VALUES (?, ?, ?, 'running', NULL, '', '', NULL, ?, NULL)`,
      )
      .run(testRunId, attempt.id, body.operationId, startedAt);
    try {
      const result = await runner.run(body.commandId, {
        cwd: attempt.workspacePath,
        signal: context.req.raw.signal,
      });
      const testedDiff = await getExerciseDiff(attempt.workspacePath, {
        expectedBaselineHash: attempt.baselineHash,
      });
      const diffFingerprint = fingerprintExerciseDiff(testedDiff);
      const now = Date.now();
      state.connection.sqlite
        .prepare(
          `UPDATE test_runs
           SET status = ?, exit_code = ?, stdout = ?, stderr = ?,
               duration_ms = ?, diff_fingerprint = ?, diff_truncated = ?,
               completed_at = ?
           WHERE id = ?`,
        )
        .run(
          result.exitCode === 0 ? "passed" : "failed",
          result.exitCode,
          result.stdout,
          result.stderr,
          result.durationMs,
          diffFingerprint,
          testedDiff.truncated ? 1 : 0,
          now,
          testRunId,
        );
      return context.json({
        id: testRunId,
        output: [result.stdout, result.stderr].filter(Boolean).join("\n"),
        exitCode: result.exitCode ?? -1,
        status: result.exitCode === 0 ? "passed" : "failed",
        operationId: body.operationId,
      });
    } catch (error) {
      state.connection.sqlite
        .prepare(
          `UPDATE test_runs
           SET status = 'failed', stderr = ?, completed_at = ?
           WHERE id = ? AND status = 'running'`,
        )
        .run(
          error instanceof Error ? error.message : "Test runner failed",
          Date.now(),
          testRunId,
        );
      throw error;
    }
  });

  app.post("/api/exercise-attempts/:id/reviews", async (context) => {
    z.object({})
      .strict()
      .parse(await context.req.json());
    const attempt = await requireAttempt(state, context.req.param("id"));
    const before = await getExerciseDiff(attempt.workspacePath, {
      expectedBaselineHash: attempt.baselineHash,
    });
    if (!before.hasChanges) {
      return context.json(
        { error: "Review requires a learner-authored diff" },
        409,
      );
    }
    if (before.truncated) {
      return context.json(
        {
          error:
            "Review requires a complete diff; the current diff exceeds the review limit",
        },
        409,
      );
    }
    const latestTest = findLatestTestRun(state.connection, attempt.id);
    if (
      !latestTest ||
      latestTest.status !== "passed" ||
      latestTest.diffTruncated !== 0 ||
      latestTest.diffFingerprint !== fingerprintExerciseDiff(before)
    ) {
      return context.json(
        {
          error:
            "Review requires a passing test run after the latest learner edit",
        },
        409,
      );
    }
    const resolved = await resolveExerciseContext(state, attempt.sessionId);
    const { exercise } = resolved;
    if (exercise.templateExerciseId !== attempt.exerciseId) {
      throw new Error("Exercise attempt does not belong to this session");
    }
    const review = await requestExerciseReview(state, {
      attempt,
      diff: before.patch,
      diffTruncated: before.truncated,
      testRun: latestTest,
      criteria: exercise.criteria,
      constraints: exercise.constraints,
      prompt: exercise.prompt,
      signal: context.req.raw.signal,
    });
    const after = await getExerciseDiff(attempt.workspacePath, {
      expectedBaselineHash: attempt.baselineHash,
    });
    if (
      before.patch !== after.patch ||
      before.truncated !== after.truncated ||
      before.baselineCommit !== after.baselineCommit
    ) {
      throw new Error("Reviewer boundary violation: workspace changed");
    }
    const now = Date.now();
    const reviewId = randomUUID();
    state.connection.sqlite
      .prepare(
        `INSERT INTO reviews
         (id, session_id, exercise_attempt_id, provider_id, model_id, status, result_json, raw_response, created_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        reviewId,
        attempt.sessionId,
        attempt.id,
        review.providerId,
        review.modelId,
        review.result.status,
        JSON.stringify(review.result),
        review.rawResponse,
        now,
        now,
      );
    return context.json({ id: reviewId, ...review.result });
  });

  app.post("/api/exercise-attempts/:id/open", async (context) => {
    const attempt = await requireAttempt(state, context.req.param("id"));
    const configured = process.env.ZED_EXECUTABLE ?? "zed";
    const plan = buildZedOpenPlan(attempt.workspacePath, {
      executable: configured,
    });
    const result = await openInZed(plan);
    return context.json({
      opened: result.opened,
      path: result.fallback.path,
      message: result.error ?? result.fallback.message,
    });
  });

  app.get("/api/knowledge", async (context) => {
    const knowledge = await state.repository.getKnowledgeMap();
    return context.json({
      topics: knowledge.map((item) => {
        const scores = Object.fromEntries(
          dimensions.map((dimension) => {
            const score = item.mastery.find(
              (candidate) => candidate.dimension === dimension,
            );
            return [dimension, score ? score.score / 100 : 0];
          }),
        );
        const evidenceCount = item.mastery.reduce(
          (sum, score) => sum + score.evidenceCount,
          0,
        );
        return {
          id: item.topic.id,
          title: item.topic.title,
          group: item.topic.description ?? "JavaScript / React",
          scores,
          evidenceCount,
          reviewDue: item.openMistakes > 0 || evidenceCount === 0,
        };
      }),
    });
  });

  app.get("/api/mistakes", (context) =>
    context.json({
      mistakes: readMistakes(state.connection, 100).map((mistake) => ({
        id: mistake.id,
        topic: mistake.topic,
        thought: mistake.summary,
        correction: mistake.correction,
        cause: mistake.sourceType,
        repeated: mistake.occurrenceCount > 1,
        reviewAt: new Date(
          mistake.lastSeenAt + 24 * 60 * 60 * 1000,
        ).toISOString(),
      })),
    }),
  );

  app.get("/api/flashcards", async (context) => {
    const cards = await state.repository.listFlashcards();
    return context.json({
      flashcards: cards.map((card) => ({
        id: card.id,
        topic: card.topicId ?? "Без темы",
        question: card.front,
        answer: card.back,
        status: toClientCardStatus(card.status),
      })),
    });
  });

  app.patch("/api/flashcards/:id", async (context) => {
    const body = z
      .object({ status: z.enum(["candidate", "approved", "rejected"]) })
      .parse(await context.req.json());
    const card = await state.repository.updateFlashcard(
      context.req.param("id"),
      {
        status: body.status === "rejected" ? "archived" : body.status,
      },
    );
    return context.json({ id: card.id, saved: true });
  });

  app.get("/api/flashcards/export", async (context) => {
    const format = z
      .enum(["markdown", "csv", "tsv"])
      .parse(context.req.query("format") ?? "markdown");
    const cards = await state.repository.listFlashcards();
    const body = exportFlashcards(
      cards.map((card) => ({
        id: card.id,
        front: card.front,
        back: card.back,
        tags: card.topicId ? [card.topicId] : [],
        status: toClientCardStatus(card.status),
      })),
      format,
    );
    const extension = format === "markdown" ? "md" : format;
    context.header(
      "Content-Type",
      format === "markdown"
        ? "text/markdown; charset=utf-8"
        : "text/plain; charset=utf-8",
    );
    context.header(
      "Content-Disposition",
      `attachment; filename="flashcards.${extension}"`,
    );
    return context.body(body);
  });

  app.get("/api/settings", async (context) => {
    const settings = await readSettings(state);
    const providers = await Promise.all(
      Object.values(state.providers).map(async (provider) => {
        const status = await provider.getStatus();
        const models =
          status.state === "connected"
            ? await provider.listModels().catch(() => [])
            : [];
        return { id: provider.id, status: status.state, models };
      }),
    );
    return context.json({ ...settings, providers });
  });

  app.put("/api/settings", async (context) => {
    const parsed = settingsMutationSchema.parse(await context.req.json());
    const body = {
      ...parsed,
      opencodeBaseUrl: validateOpenCodeEndpoint(parsed.opencodeBaseUrl),
    };
    const nextOpenCodeProvider = new OpenCodeAgentProvider({
      directory: state.projectRoot,
      endpoint: body.opencodeBaseUrl,
    });
    const activeOpenCodeEndpoint = validateOpenCodeEndpoint(
      process.env.OPENCODE_ENDPOINT ??
        readSettingSync<string>(state.connection, "opencodeBaseUrl") ??
        defaultOpenCodeEndpoint,
    );
    if (body.opencodeBaseUrl !== activeOpenCodeEndpoint) {
      const status = await nextOpenCodeProvider.getStatus().catch(() => null);
      if (status?.state !== "connected") {
        return context.json(
          {
            error: `OpenCode сервер недоступен по адресу ${body.opencodeBaseUrl}. Запустите sidecar или верните прежний адрес.`,
          },
          400,
        );
      }
    }
    await validateProviderModelSelections(
      { ...state.providers, opencode: nextOpenCodeProvider },
      body,
    );
    const previousOpenCodeProvider = state.providers.opencode;
    for (const [key, session] of state.providerSessions) {
      if (session.providerId === "opencode") {
        evictProviderSession(state, key, session);
      }
    }
    if (
      "shutdown" in previousOpenCodeProvider &&
      typeof previousOpenCodeProvider.shutdown === "function"
    ) {
      await previousOpenCodeProvider.shutdown();
    }
    await Promise.all(
      Object.entries(body).map(([key, value]) =>
        state.repository.setSetting(key, value),
      ),
    );
    state.providers.opencode = nextOpenCodeProvider;
    return context.json({ saved: true });
  });

  return {
    app,
    state,
    close: async () => {
      const providers = Object.values(state.providers);
      await Promise.allSettled(
        providers.map((provider) =>
          "shutdown" in provider && typeof provider.shutdown === "function"
            ? provider.shutdown()
            : Promise.resolve(),
        ),
      );
      connection.close();
    },
  };
}

async function validateProviderModelSelections(
  providers: Record<ProviderId, AgentProvider>,
  settings: z.infer<typeof settingsMutationSchema>,
): Promise<void> {
  const selections = [
    [settings.teacherProvider, settings.teacherModel],
    [settings.reviewerProvider, settings.reviewerModel],
    [settings.interviewerProvider, settings.interviewerModel],
    [settings.curatorProvider, settings.curatorModel],
    [settings.codexExpertProvider, settings.codexExpertModel],
  ] as const;
  const modelsByProvider = new Map<ProviderId, Set<string>>();

  for (const providerId of new Set(selections.map(([id]) => id))) {
    const provider = providers[providerId];
    const models = await provider.listModels().catch(() => {
      throw new Error(`Models are unavailable for provider ${providerId}`);
    });
    modelsByProvider.set(
      providerId,
      new Set(
        models
          .filter((model) => model.providerId === providerId && model.available)
          .map((model) => model.id),
      ),
    );
  }

  for (const [providerId, modelId] of selections) {
    if (!modelsByProvider.get(providerId)?.has(modelId)) {
      throw new Error(
        `Model ${modelId} is unavailable for provider ${providerId}`,
      );
    }
  }
}

function validateWebOrigin(origin: string): string {
  try {
    const url = new URL(origin);
    if (
      url.protocol !== "http:" ||
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
      url.username !== "" ||
      url.password !== "" ||
      url.pathname !== "/" ||
      url.search !== "" ||
      url.hash !== ""
    ) {
      throw new Error("WEB_ORIGIN must be an HTTP loopback origin");
    }
    return url.origin;
  } catch {
    throw new Error("WEB_ORIGIN must be an HTTP loopback origin");
  }
}

function isLoopbackOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
      url.username === "" &&
      url.password === "" &&
      url.pathname === "/" &&
      url.search === "" &&
      url.hash === ""
    );
  } catch {
    return false;
  }
}

function isAllowedWebOrigin(origin: string, allowedWebOrigin: string): boolean {
  if (origin === allowedWebOrigin) return true;
  if (!isLoopbackOrigin(origin) || !isLoopbackOrigin(allowedWebOrigin)) {
    return false;
  }
  try {
    return new URL(origin).port === new URL(allowedWebOrigin).port;
  } catch {
    return false;
  }
}

function isJsonContentType(contentType: string | undefined): boolean {
  return (
    contentType?.split(";", 1)[0]?.trim().toLowerCase() === "application/json"
  );
}

function evictProviderSession(
  state: AppState,
  key: string,
  session: ProviderSessionRecord,
): void {
  if (state.providerSessions.get(key) === session) {
    state.providerSessions.delete(key);
  }
  const activeTurn = state.activeProviderTurns.get(session.providerSessionId);
  if (activeTurn?.session === session) {
    state.activeProviderTurns.delete(session.providerSessionId);
  }
}

async function cancelAndEvictProviderSession(
  state: AppState,
  key: string,
  session: ProviderSessionRecord,
): Promise<void> {
  evictProviderSession(state, key, session);
  await session.provider.cancelSession(session.providerSessionId);
}

async function defaultModel(provider: AgentProvider): Promise<string> {
  const models = await provider.listModels();
  const model = models.find((candidate) => candidate.available);
  if (!model) throw new Error(`No available model for ${provider.id}`);
  return model.id;
}

function toSessionResponse(
  detail: Awaited<ReturnType<LearningRepository["getSession"]>>,
) {
  const question = detail.questions[0];
  if (!question) throw new Error("No question for this learning day");
  const savedAnswer = question.attempts.at(-1)?.answer;
  return {
    id: detail.session.id,
    dayNumber: detail.day.dayNumber,
    title: detail.day.title,
    status: detail.session.status,
    currentStep: detail.session.currentStep,
    steps: stepLabels.map(([id, label], index) => ({
      id,
      label,
      status:
        detail.session.status === "completed"
          ? "done"
          : index === 0
            ? "active"
            : "locked",
    })),
    question: {
      id: question.id,
      prompt: question.prompt,
      kind: question.kind,
    },
    ...(savedAnswer ? { savedAnswer } : {}),
  };
}

function findAttemptByExercise(
  connection: DatabaseConnection,
  sessionId: string,
  exerciseId: string,
): AttemptRecord | undefined {
  return connection.sqlite
    .prepare(
      `SELECT id, session_id AS sessionId, exercise_id AS exerciseId,
              workspace_path AS workspacePath, baseline_hash AS baselineHash
       FROM exercise_attempts WHERE session_id = ? AND exercise_id = ?`,
    )
    .get(sessionId, exerciseId) as AttemptRecord | undefined;
}

async function requireAttempt(
  state: Pick<AppState, "connection" | "exerciseAttemptsRoot">,
  attemptId: string,
): Promise<AttemptRecord> {
  const attempt = state.connection.sqlite
    .prepare(
      `SELECT id, session_id AS sessionId, exercise_id AS exerciseId,
              workspace_path AS workspacePath, baseline_hash AS baselineHash
       FROM exercise_attempts WHERE id = ?`,
    )
    .get(attemptId) as AttemptRecord | undefined;
  if (!attempt) throw new Error("Unknown exercise attempt");
  let storedRealPath: string;
  let trustedRealPath: string;
  try {
    const trustedWorkspace = await resolveWorkspacePath(
      state.exerciseAttemptsRoot,
      attempt.id,
      { mustExist: true, expectedType: "directory" },
    );
    [storedRealPath, trustedRealPath] = await Promise.all([
      realpath(attempt.workspacePath),
      realpath(trustedWorkspace),
    ]);
  } catch {
    throw new Error("Exercise attempt workspace is unavailable or untrusted");
  }
  if (path.relative(trustedRealPath, storedRealPath) !== "") {
    throw new Error("Exercise attempt workspace is unavailable or untrusted");
  }
  return { ...attempt, workspacePath: trustedRealPath };
}

async function readVersionedExerciseProgress(
  state: AppState,
  sessionId: string,
): Promise<{
  exerciseUnitId: string;
  reviewUnitId: string | null;
  exerciseUnitProgress: {
    status: string;
    payload: unknown;
  };
  reviewUnitProgress: { status: string; payload: unknown } | null;
} | null> {
  const hasSnapshot = Boolean(
    state.connection.sqlite
      .prepare("SELECT 1 FROM session_snapshots WHERE session_id = ? LIMIT 1")
      .get(sessionId),
  );
  if (!hasSnapshot) return null;

  const detail = await state.repository.getVersionedSession(sessionId);
  const exerciseUnit = detail.snapshot.units.find(
    (unit) => unit.type === "exercise",
  );
  if (!exerciseUnit) return null;
  const exerciseProgress = detail.unitProgress.find(
    (progress) => progress.unitId === exerciseUnit.id,
  );
  if (!exerciseProgress) return null;
  const reviewUnit = detail.snapshot.units.find(
    (unit) =>
      unit.payload.type === "review" &&
      unit.payload.exerciseUnitId === exerciseUnit.stableId,
  );
  const reviewProgress = reviewUnit
    ? detail.unitProgress.find((progress) => progress.unitId === reviewUnit.id)
    : undefined;
  return {
    exerciseUnitId: exerciseUnit.id,
    reviewUnitId: reviewUnit?.id ?? null,
    exerciseUnitProgress: {
      status: exerciseProgress.status,
      payload: exerciseProgress.payload,
    },
    reviewUnitProgress: reviewProgress
      ? { status: reviewProgress.status, payload: reviewProgress.payload }
      : null,
  };
}

async function readAttemptEvidence(
  connection: DatabaseConnection,
  attempt: AttemptRecord,
) {
  const currentDiff = await getExerciseDiff(attempt.workspacePath, {
    expectedBaselineHash: attempt.baselineHash,
  });
  const latestTest = findLatestTestRun(connection, attempt.id);
  const currentDiffFingerprint = fingerprintExerciseDiff(currentDiff);
  const testFresh = Boolean(
    latestTest &&
    latestTest.diffTruncated === 0 &&
    latestTest.diffFingerprint !== null &&
    latestTest.diffFingerprint === currentDiffFingerprint,
  );
  const latestReviewRecord = findLatestReview(connection, attempt.id);
  const reviewIsCurrent = Boolean(
    latestReviewRecord &&
    latestTest &&
    testFresh &&
    latestReviewRecord.createdAt >= latestTest.startedAt,
  );
  let latestReview: {
    id: string;
    status: ReviewResult["status"];
    summary: string;
    findings: ReviewResult["findings"];
    strengths: string[];
  } | null = null;
  if (latestReviewRecord && reviewIsCurrent) {
    try {
      const parsed = await parseReviewResult(latestReviewRecord.resultJson);
      if (parsed.status === latestReviewRecord.status) {
        latestReview = {
          id: latestReviewRecord.id,
          status: parsed.status,
          summary: parsed.summary,
          findings: parsed.findings,
          strengths: parsed.strengths,
        };
      }
    } catch {
      // Older rows may predate the structured review contract. They remain in
      // SQLite for audit, but are not exposed as trusted learner evidence.
    }
  }
  return {
    diff: {
      patch: currentDiff.patch,
      changed: currentDiff.hasChanges,
      truncated: currentDiff.truncated,
    },
    latestTestRun: latestTest
      ? { ...toTestRunResponse(latestTest), workspaceCurrent: testFresh }
      : null,
    latestReview,
  };
}

function findLatestReview(
  connection: DatabaseConnection,
  attemptId: string,
): ReviewRecord | undefined {
  return connection.sqlite
    .prepare(
      `SELECT id, status, result_json AS resultJson, created_at AS createdAt
       FROM reviews WHERE exercise_attempt_id = ?
       ORDER BY created_at DESC, rowid DESC LIMIT 1`,
    )
    .get(attemptId) as ReviewRecord | undefined;
}

function findTestRunByOperation(
  connection: DatabaseConnection,
  operationId: string,
): TestRunRecord | undefined {
  return connection.sqlite
    .prepare(
      `SELECT id, exercise_attempt_id AS exerciseAttemptId,
              operation_id AS operationId, status, exit_code AS exitCode,
              stdout, stderr, duration_ms AS durationMs,
              diff_fingerprint AS diffFingerprint,
              diff_truncated AS diffTruncated,
              started_at AS startedAt, completed_at AS completedAt
       FROM test_runs WHERE operation_id = ? LIMIT 1`,
    )
    .get(operationId) as TestRunRecord | undefined;
}

function findLatestTestRun(
  connection: DatabaseConnection,
  attemptId: string,
): TestRunRecord | undefined {
  return connection.sqlite
    .prepare(
      `SELECT id, exercise_attempt_id AS exerciseAttemptId,
              operation_id AS operationId, status, exit_code AS exitCode,
              stdout, stderr, duration_ms AS durationMs,
              diff_fingerprint AS diffFingerprint,
              diff_truncated AS diffTruncated,
              started_at AS startedAt, completed_at AS completedAt
       FROM test_runs WHERE exercise_attempt_id = ?
       ORDER BY started_at DESC, rowid DESC LIMIT 1`,
    )
    .get(attemptId) as TestRunRecord | undefined;
}

function toTestRunResponse(run: TestRunRecord) {
  return {
    id: run.id,
    output: [run.stdout, run.stderr].filter(Boolean).join("\n"),
    exitCode: run.exitCode ?? -1,
    status: run.status,
    operationId: run.operationId,
  };
}

function npmTestCommand(): { executable: string; args: string[] } {
  if (process.platform !== "win32") {
    return { executable: "npm", args: ["test"] };
  }
  const npmCli =
    process.env.npm_execpath ??
    path.join(
      path.dirname(process.execPath),
      "node_modules",
      "npm",
      "bin",
      "npm-cli.js",
    );
  return { executable: process.execPath, args: [npmCli, "test"] };
}

function readMistakes(connection: DatabaseConnection, limit: number) {
  return connection.sqlite
    .prepare(
      `SELECT m.id, t.title AS topic, m.summary, m.correction,
              m.source_type AS sourceType, m.occurrence_count AS occurrenceCount,
              m.last_seen_at AS lastSeenAt
       FROM mistakes m JOIN topics t ON t.id = m.topic_id
       ORDER BY m.last_seen_at DESC LIMIT ?`,
    )
    .all(limit) as Array<{
    id: string;
    topic: string;
    summary: string;
    correction: string;
    sourceType: string;
    occurrenceCount: number;
    lastSeenAt: number;
  }>;
}

function toClientCardStatus(status: string) {
  return status === "archived" || status === "suspended"
    ? ("rejected" as const)
    : (status as "candidate" | "approved");
}

async function readSettings(state: AppState) {
  const defaults = {
    workspaceRoot: state.defaultWorkspaceRoot,
    zedExecutable: process.env.ZED_EXECUTABLE ?? "zed",
    opencodeBaseUrl: validateOpenCodeEndpoint(
      process.env.OPENCODE_ENDPOINT ?? defaultOpenCodeEndpoint,
    ),
    teacherProvider: "mock" as const,
    teacherModel: "mock-deterministic",
    reviewerProvider: "mock" as const,
    reviewerModel: "mock-deterministic",
    interviewerProvider: "mock" as const,
    interviewerModel: "mock-deterministic",
    curatorProvider: "mock" as const,
    curatorModel: "mock-deterministic",
    codexExpertProvider: "mock" as const,
    codexExpertModel: "mock-deterministic",
    theme: "system" as const,
  };
  const entries = await Promise.all(
    Object.keys(defaults).map(async (key) => {
      const defaultValue = defaults[key as keyof typeof defaults];
      return [
        key,
        key === "zedExecutable"
          ? defaultValue
          : ((await state.repository.getSetting(key)) ?? defaultValue),
      ];
    }),
  );
  return settingsSchema.parse(Object.fromEntries(entries));
}

function selectionForRole(
  settings: AppSettings,
  role: AgentRole,
): { providerId: ProviderId; modelId: string } {
  switch (role) {
    case "teacher":
      return {
        providerId: settings.teacherProvider,
        modelId: settings.teacherModel,
      };
    case "reviewer":
      return {
        providerId: settings.reviewerProvider,
        modelId: settings.reviewerModel,
      };
    case "interviewer":
      return {
        providerId: settings.interviewerProvider,
        modelId: settings.interviewerModel,
      };
    case "codex-expert":
      return {
        providerId: settings.codexExpertProvider,
        modelId: settings.codexExpertModel,
      };
    case "curator":
    case "flashcard-generator":
    case "daily-summary":
    case "weekly-analysis":
      return {
        providerId: settings.curatorProvider,
        modelId: settings.curatorModel,
      };
  }
}

async function requestExerciseReview(
  state: AppState,
  input: {
    attempt: AttemptRecord;
    diff: string;
    diffTruncated: boolean;
    testRun: TestRunRecord;
    criteria: string[];
    constraints: string[];
    prompt: string;
    signal: AbortSignal;
  },
): Promise<{
  providerId: ProviderId;
  modelId: string;
  result: ReviewResult;
  rawResponse: string;
}> {
  const settings = await readSettings(state);
  const { providerId, modelId } = selectionForRole(settings, "reviewer");
  const provider = state.providers[providerId];
  const key = `${input.attempt.sessionId}:reviewer:${providerId}:${modelId}`;
  let storedSession = state.providerSessions.get(key);
  if (!storedSession) {
    const session = await provider.createSession({
      role: "reviewer",
      modelId,
      systemPrompt: getLatestPrompt("reviewer").systemPrompt,
      metadata: {
        learningSessionId: input.attempt.sessionId,
        exerciseAttemptId: input.attempt.id,
      },
    });
    const conversation = await state.repository.createConversation({
      learningSessionId: input.attempt.sessionId,
      role: "reviewer",
      providerId,
      modelId,
      providerSessionId: session.id,
    });
    storedSession = {
      providerId,
      provider,
      providerSessionId: session.id,
      conversationId: conversation.id,
    };
    state.providerSessions.set(key, storedSession);
  }

  const reviewPrompt = JSON.stringify({
    task: "Review the learner-authored change. Return only ReviewResult JSON.",
    exercise: {
      prompt: input.prompt,
      acceptanceCriteria: input.criteria,
      constraints: input.constraints,
    },
    evidence: {
      priorReviewCount: (
        state.connection.sqlite
          .prepare(
            "SELECT count(*) AS count FROM reviews WHERE exercise_attempt_id = ?",
          )
          .get(input.attempt.id) as { count: number }
      ).count,
      gitDiff: input.diff,
      diffTruncated: input.diffTruncated,
      latestTestRun: {
        operationId: input.testRun.operationId,
        status: input.testRun.status,
        exitCode: input.testRun.exitCode,
        stdout: input.testRun.stdout,
        stderr: input.testRun.stderr,
        durationMs: input.testRun.durationMs,
      },
    },
  });
  await state.repository.addMessage({
    conversationId: storedSession.conversationId,
    role: "user",
    content: reviewPrompt,
  });

  let rawResponse = "";
  let failure: string | undefined;
  let terminalReason: "completed" | "failed" | "cancelled" | undefined;
  const toolEvents: AgentEvent[] = [];
  state.activeProviderTurns.set(storedSession.providerSessionId, {
    key,
    session: storedSession,
  });
  const onAbort = () => {
    void cancelAndEvictProviderSession(state, key, storedSession).catch(
      () => {},
    );
  };
  if (input.signal.aborted) onAbort();
  else input.signal.addEventListener("abort", onAbort, { once: true });
  try {
    for await (const event of provider.streamMessage({
      sessionId: storedSession.providerSessionId,
      message: reviewPrompt,
      responseFormat: "json",
    })) {
      if (event.type === "message.delta") rawResponse += event.delta;
      if (event.type === "message.completed") rawResponse = event.content;
      if (event.type === "error") failure = event.error.message;
      if (event.type === "session.completed") terminalReason = event.reason;
      if (event.type === "tool.started" || event.type === "tool.completed") {
        toolEvents.push(event);
      }
    }
    if (failure || terminalReason !== "completed") {
      throw new Error(
        failure ??
          `Reviewer provider ended without success (${terminalReason ?? "unknown"})`,
      );
    }
    const result = await parseReviewResult(rawResponse);
    await persistAgentResponse(state, {
      conversationId: storedSession.conversationId,
      content: rawResponse,
      toolEvents,
      status: "completed",
    });
    return { providerId, modelId, result, rawResponse };
  } catch (error) {
    evictProviderSession(state, key, storedSession);
    await persistAgentResponse(state, {
      conversationId: storedSession.conversationId,
      content:
        rawResponse ||
        (error instanceof Error ? error.message : "Reviewer failed"),
      toolEvents,
      status: terminalReason === "cancelled" ? "cancelled" : "failed",
    });
    throw error;
  } finally {
    input.signal.removeEventListener("abort", onAbort);
    const active = state.activeProviderTurns.get(
      storedSession.providerSessionId,
    );
    if (active?.session === storedSession) {
      state.activeProviderTurns.delete(storedSession.providerSessionId);
    }
  }
}

async function persistAgentResponse(
  state: AppState,
  input: {
    conversationId: string;
    content: string;
    toolEvents: AgentEvent[];
    status: string;
  },
): Promise<void> {
  try {
    await state.repository.addMessage({
      conversationId: input.conversationId,
      role: "assistant",
      content: input.content,
      toolEvents: input.toolEvents,
      status: input.status,
    });
  } catch (error) {
    console.error("agent_message_persistence_failed", {
      name: error instanceof Error ? error.name : "UnknownError",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

function readSettingSync<T>(
  connection: DatabaseConnection,
  key: string,
): T | null {
  const row = connection.sqlite
    .prepare(
      "SELECT value_json AS valueJson FROM application_settings WHERE key = ?",
    )
    .get(key) as { valueJson: string } | undefined;
  return row ? (JSON.parse(row.valueJson) as T) : null;
}

function loadRootEnvironment(projectRoot: string): void {
  if (process.env.NODE_ENV === "test") return;
  try {
    process.loadEnvFile(path.join(projectRoot, ".env"));
  } catch (error) {
    if (!(
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    )) {
      throw error;
    }
  }
}

function resolveDatabasePath(
  projectRoot: string,
  configured: string | undefined,
): string | undefined {
  if (!configured) return undefined;
  const value = configured.startsWith("file:")
    ? configured.slice("file:".length)
    : configured;
  return value === ":memory:" || path.isAbsolute(value)
    ? value
    : path.resolve(projectRoot, value);
}

async function resolveExerciseWorkspace(
  state: AppState,
  curriculumPath: string,
): Promise<string> {
  const configuredRoot =
    (await state.repository.getSetting<string>("workspaceRoot")) ??
    state.defaultWorkspaceRoot;
  const workspaceRoot = path.isAbsolute(configuredRoot)
    ? configuredRoot
    : path.resolve(state.projectRoot, configuredRoot);
  const portablePath = curriculumPath.replaceAll("\\", "/");
  const prefix = "workspaces/exercises/";
  if (!portablePath.startsWith(prefix)) {
    throw new Error("Exercise path is outside the curriculum workspace");
  }
  return resolveWorkspacePath(
    workspaceRoot,
    portablePath.slice(prefix.length),
    {
      mustExist: true,
      expectedType: "directory",
    },
  );
}

async function resolveExerciseContext(
  state: AppState,
  sessionId: string,
  requestedExerciseId?: string,
): Promise<ExerciseContext> {
  const hasSnapshot = Boolean(
    state.connection.sqlite
      .prepare("SELECT 1 FROM session_snapshots WHERE session_id = ? LIMIT 1")
      .get(sessionId),
  );
  if (hasSnapshot) {
    const detail = await state.repository.getVersionedSession(sessionId);
    const unit = detail.snapshot.units.find(
      (candidate) =>
        candidate.payload.type === "exercise" &&
        (requestedExerciseId === undefined ||
          candidate.payload.exerciseId === requestedExerciseId),
    );
    if (!unit || unit.payload.type !== "exercise") {
      throw new Error("Exercise does not belong to this session snapshot");
    }
    const template = loadTrustedExerciseTemplate(
      state.connection,
      unit.payload.exerciseId,
    );
    return {
      sessionId: detail.session.id,
      exercise: {
        id: unit.payload.exerciseId,
        templateExerciseId: template.id,
        title: unit.title,
        prompt: unit.payload.template,
        difficulty: template.difficulty,
        estimatedMinutes: unit.estimatedMinutes,
        workspacePath: template.workspacePath,
        constraints: unit.payload.constraints,
        criteria: unit.payload.acceptanceCriteria,
        topics: detail.snapshot.day.topics,
      },
    };
  }

  const detail = await state.repository.getSession(sessionId);
  const exercise = requestedExerciseId
    ? detail.exercises.find((candidate) => candidate.id === requestedExerciseId)
    : detail.exercises[0];
  if (!exercise) throw new Error("Exercise does not belong to this session");
  return {
    sessionId: detail.session.id,
    exercise: {
      id: exercise.id,
      templateExerciseId: exercise.id,
      title: exercise.title,
      prompt: exercise.prompt,
      difficulty: exercise.difficulty,
      estimatedMinutes: exercise.estimatedMinutes,
      workspacePath: exercise.workspacePath,
      constraints: exercise.constraints,
      criteria: exercise.criteria.map((criterion) =>
        typeof criterion === "object" && criterion && "description" in criterion
          ? String(criterion.description)
          : String(criterion),
      ),
      topics: detail.topics.map((topic) => topic.title),
    },
  };
}

function loadTrustedExerciseTemplate(
  connection: DatabaseConnection,
  snapshotExerciseId: string,
): {
  id: string;
  difficulty: string;
  workspacePath: string;
} {
  const compatibilityMatch = /^exercise-(w\d+d\d+-.+)-v2$/u.exec(
    snapshotExerciseId,
  );
  const candidates = [
    snapshotExerciseId,
    ...(compatibilityMatch?.[1] ? [compatibilityMatch[1]] : []),
  ];
  for (const candidate of candidates) {
    const row = connection.sqlite
      .prepare(
        `SELECT id, difficulty, workspace_path AS workspacePath
         FROM exercises WHERE id = ? AND active = 1`,
      )
      .get(candidate) as
      { id: string; difficulty: string; workspacePath: string } | undefined;
    if (row) return row;
  }
  throw new Error(
    `No trusted exercise template is registered for ${snapshotExerciseId}`,
  );
}
