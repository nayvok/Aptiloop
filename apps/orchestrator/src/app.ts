import { createHash, randomUUID } from "node:crypto";
import { mkdir, realpath, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createOpenAiPiAgentProvider,
  createOpenCodeZenPiAgentProvider,
  MockAgentProvider,
  parseReviewResult,
  ProviderHubError,
  type AgentProvider,
} from "@dlh/agent-core";
import { CodexProvider } from "@dlh/codex-provider";
import { weekOneCurriculum } from "@dlh/curriculum";
import {
  assertM1E2EDatabaseTarget,
  assertM1WritableDatabaseTarget,
  createCoursePackRepository,
  createCourseFoundationRepository,
  createLearningRepository,
  migrateDatabase,
  openDatabase,
  openM1WritableDatabase,
  withAsyncTransaction,
  seedCurriculum,
  type CourseFoundationRepository,
  type DatabaseConnection,
  type DatabaseMigrationAdmissionCapability,
  type LearningRepository,
  type M1DatabaseTargetValidation,
  type M1WritableDatabaseOpenOptions,
} from "@dlh/database";
import {
  buildZedOpenPlan,
  createCoreExecutionFabric,
  createExerciseAttemptWorkspace,
  ensureExerciseBaseline,
  fingerprintExerciseDiff,
  getExerciseDiff,
  LEGACY_NODE_ENVIRONMENT_ID,
  LEGACY_NODE_TEST_CHECK_ID,
  openInZed,
  resolveWorkspacePath,
  snapshotCompleteWorkspace,
  type ExecutionResult,
  type TrustedExecutionFabric,
} from "@dlh/exercise-core";
import { exportFlashcards } from "@dlh/learning-core";
import { validateOpenCodeEndpoint } from "@dlh/opencode-provider";
import { getLatestPrompt } from "@dlh/prompt-library";
import {
  AgentRoleSchema,
  AptiloopAiRoleSchema,
  type ReviewResult,
  type ProviderId,
} from "@dlh/shared";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";

import { registerVersionedLearningRoutes } from "./learning-v2.js";
import {
  createCourseDesignerTools,
  registerCourseDesignerRoutes,
} from "./course-designer.js";
import { registerCurriculumEditorRoutes } from "./curriculum-editor.js";
import { registerCoursePackRoutes } from "./course-packs.js";
import { registerPersonalAdaptationRoutes } from "./personal-adaptations.js";
import { registerInterviewV2Routes } from "./interview-v2.js";
import {
  apiRequestBoundaryError,
  createApiRequestBoundary,
} from "./http-boundary.js";
import {
  parseOrchestratorStartupConfig,
  type OrchestratorStartupConfig,
} from "./startup-boundary.js";
import {
  assertCourseScopedSessionSideEffectAllowed,
  CourseSessionContextError,
  legacyLearningMutationError,
  LegacyLearningMutationError,
} from "./learning-session-policy.js";
import {
  ProviderRuntime,
  providerFailureCode,
  providerFailurePayload,
  type ProviderDispatch,
} from "./provider-runtime.js";

const sourceRoot = fileURLToPath(new URL("../../..", import.meta.url));
const defaultOpenCodeEndpoint = "http://127.0.0.1:4096";
const defaultWebOrigin = "http://127.0.0.1:3000";
const safeAgentFailureMessage =
  "The agent response was rejected by safety policy.";
const safeAgentCancellationMessage = "The agent turn was cancelled.";
const activeAgentTurnConflictMessage =
  "An agent turn is already active for this session, role, provider, and model.";
const mutationMethods: Readonly<Record<string, true>> = {
  DELETE: true,
  PATCH: true,
  POST: true,
  PUT: true,
};
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
  databaseMode?: "active" | "disposable";
  /** @internal Deterministic database-open adversarial seam. */
  databaseTestHooks?: M1WritableDatabaseOpenOptions["testHooks"];
  connection?: DatabaseConnection;
  providers?: Partial<Record<ProviderId, AgentProvider>>;
  webOrigin?: string;
  developmentMode?: boolean;
  exerciseAttemptsRoot?: string;
  startupConfig?: OrchestratorStartupConfig;
}

interface AttemptRecord {
  id: string;
  sessionId: string;
  exerciseId: string;
  workspacePath: string;
  baselineHash: string;
  environmentId: string;
  workspaceHandleId: string;
  workspaceGeneration: number;
  sourceSnapshotHash: string;
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
  checkId: string | null;
  environmentId: string | null;
  environmentPackDigest: string | null;
  backendId: string | null;
  inputSnapshotHash: string | null;
  resultJson: string | null;
}

interface ReviewRecord {
  id: string;
  status: string;
  resultJson: string;
  createdAt: number;
  bundleId: string | null;
  evidenceSha256: string | null;
  workspaceSnapshotHash: string | null;
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
  courseFoundationRepository: CourseFoundationRepository;
  projectRoot: string;
  defaultWorkspaceRoot: string;
  exerciseAttemptsRoot: string;
  executionFabric: TrustedExecutionFabric;
  developmentMode: boolean;
  providers: Record<ProviderId, AgentProvider>;
  providerRuntime: ProviderRuntime;
  providerSessions: Map<string, ProviderSessionRecord>;
  activeProviderTurns: Map<
    string,
    { key: string; session: ProviderSessionRecord }
  >;
  activeProviderTurnReservations: Map<string, string>;
  interviewReservations: {
    start: boolean;
    interviewIds: Set<string>;
  };
}
type BrowserAgentEvent =
  | { type: "message.delta"; turnId: string; content: string }
  | { type: "message.completed"; turnId: string; content: string }
  | { type: "error"; turnId: string; message: string }
  | {
      type: "session.completed";
      turnId: string;
      reason: "completed" | "failed" | "cancelled";
    };

function resolveLauncherOwnedE2EDatabase(
  databasePath: string,
  projectRoot: string,
): M1DatabaseTargetValidation | null {
  const runId = process.env.E2E_RUN_ID;
  const configuredRunRoot = process.env.E2E_RUN_ROOT;
  const configuredDatabase = process.env.E2E_DATABASE_PATH;
  if (
    process.env.NODE_ENV !== "test" ||
    !runId ||
    !configuredRunRoot ||
    !configuredDatabase ||
    databasePath === ":memory:"
  ) {
    return null;
  }

  return assertM1E2EDatabaseTarget(databasePath, {
    projectRoot,
    runId,
    runRootPath: configuredRunRoot,
    configuredDatabasePath: configuredDatabase,
  });
}

const settingsSchema = z
  .object({
    workspaceRoot: z.string().min(1),
    zedExecutable: z.string().min(1),
    opencodeBaseUrl: z.string().url(),
    theme: z.enum(["system", "light", "dark"]),
    uiLocale: z.enum(["en-US", "ru-RU"]).nullable(),
  })
  .strict();
const settingsMutationSchema = z
  .object({
    theme: z.enum(["system", "light", "dark"]),
  })
  .strict();
const localeMutationSchema = z
  .object({
    uiLocale: z.enum(["en-US", "ru-RU"]),
  })
  .strict();
const aiSettingsMutationSchema = z
  .object({
    roleProfiles: z
      .array(
        z
          .object({
            role: AptiloopAiRoleSchema,
            mode: z.enum(["no-ai", "connection"]),
            connectionId: z.string().trim().min(1).max(200).nullable(),
            modelId: z.string().trim().min(1).max(300).nullable(),
          })
          .strict(),
      )
      .length(AptiloopAiRoleSchema.options.length),
  })
  .strict();

const chatSchema = z
  .object({
    role: AgentRoleSchema.default("teacher"),
    sessionId: z.string().min(1).optional(),
    message: z.string().trim().min(1).max(50_000),
    disclosureOperationId: z.string().trim().min(1).max(200).optional(),
  })
  .strict();
const disclosureRequestSchema = chatSchema.omit({
  disclosureOperationId: true,
});

export function createApp(options: AppOptions = {}) {
  const projectRoot = path.resolve(options.projectRoot ?? sourceRoot);
  loadRootEnvironment(projectRoot);
  const startupConfig =
    options.startupConfig ?? parseOrchestratorStartupConfig({});
  const databasePath =
    options.databasePath ??
    resolveDatabasePath(
      projectRoot,
      process.env.DATABASE_PATH ?? process.env.DATABASE_URL,
    ) ??
    path.join(projectRoot, ".data", "dev-learning-harness.sqlite");
  const launcherOwnedE2E =
    options.databaseMode === undefined
      ? resolveLauncherOwnedE2EDatabase(databasePath, projectRoot)
      : null;
  const databaseMode =
    options.databaseMode ?? (launcherOwnedE2E ? "disposable" : "active");
  const revalidateDatabaseTarget = ():
    M1DatabaseTargetValidation | undefined => {
    if (launcherOwnedE2E) {
      const current = resolveLauncherOwnedE2EDatabase(
        databasePath,
        projectRoot,
      );
      if (!current) {
        throw new Error("E2E database ownership changed during startup");
      }
      return current;
    }
    return assertM1WritableDatabaseTarget(databasePath, {
      projectRoot,
      mode: databaseMode,
      allowContainerPath:
        startupConfig.bindMode === "container-loopback-published",
    });
  };
  const initialDatabaseTarget = revalidateDatabaseTarget();
  if (options.connection && databaseMode !== "disposable") {
    throw new Error("Injected database connections require disposable mode");
  }
  let connection: DatabaseConnection;
  let migrationCapability: DatabaseMigrationAdmissionCapability | undefined;
  if (options.connection) {
    connection = options.connection;
  } else if (initialDatabaseTarget?.identity) {
    const writableConnection = openM1WritableDatabase(databasePath, {
      initialTarget: initialDatabaseTarget,
      revalidateTarget: revalidateDatabaseTarget,
      migrationMode:
        databaseMode === "disposable" ? "bootstrap" : "current-or-empty",
      ...(options.databaseTestHooks
        ? { testHooks: options.databaseTestHooks }
        : {}),
    });
    connection = writableConnection;
    if (writableConnection.migrationAdmission?.kind === "legacy-compatible") {
      migrationCapability =
        writableConnection.migrationAdmission.migrationCapability;
    }
  } else {
    if (databaseMode !== "disposable" || launcherOwnedE2E) {
      throw new Error("Writable database identity is required before opening");
    }
    connection = openDatabase(databasePath);
  }
  migrateDatabase(
    connection,
    path.join(projectRoot, "packages", "database", "migrations"),
    migrationCapability,
  );
  seedCurriculum(connection);

  const repository = createLearningRepository(connection);
  const courseFoundationRepository =
    createCourseFoundationRepository(connection);
  const allowedWebOrigin = validateWebOrigin(
    options.webOrigin ?? process.env.WEB_ORIGIN ?? defaultWebOrigin,
  );
  const apiRequestBoundary = createApiRequestBoundary(
    startupConfig,
    allowedWebOrigin,
  );
  const courseDesignerTools = createCourseDesignerTools(connection);
  const defaultProviders: Record<ProviderId, AgentProvider> = {
    mock: new MockAgentProvider(),
    codex: new CodexProvider({ cwd: projectRoot }),
    opencode: createOpenCodeZenPiAgentProvider({
      toolsForRole: courseDesignerTools,
    }),
    pi: createOpenAiPiAgentProvider({ toolsForRole: courseDesignerTools }),
  };
  const providers = { ...defaultProviders, ...options.providers };
  const providerRuntime = new ProviderRuntime({
    connection,
    providers,
    developmentMode: options.developmentMode === true,
  });
  const npmTest = npmTestCommand();
  const executionFabric = createCoreExecutionFabric({
    legacyNodeTestPlan: {
      executable: npmTest.executable,
      args: npmTest.args,
      timeoutMs: 120_000,
      maxOutputBytes: 1_000_000,
    },
  });
  const state: AppState = {
    connection,
    repository,
    courseFoundationRepository,
    executionFabric,
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
    developmentMode: options.developmentMode === true,
    providers,
    providerRuntime,
    providerSessions: new Map(),
    activeProviderTurns: new Map(),
    activeProviderTurnReservations: new Map(),
    interviewReservations: {
      start: false,
      interviewIds: new Set(),
    },
  };
  const app = new Hono();

  app.onError((error, context) => {
    if (error instanceof LegacyLearningMutationError) {
      return context.json(legacyLearningMutationError, 410);
    }
    if (error instanceof ProviderHubError) {
      const status =
        error.failure.code === "disclosure_required" ||
        error.failure.code === "disclosure_mismatch" ||
        error.failure.code === "ai_disabled"
          ? 409
          : error.failure.retryable
            ? 503
            : 400;
      return context.json(providerFailurePayload(error), status);
    }
    console.error("orchestrator_request_failed", {
      name: error.name,
      message: error.message,
    });
    const status = /unknown|not found/iu.test(error.message) ? 404 : 400;
    return context.json({ error: error.message }, status);
  });

  app.use("/api/*", async (context, next) => {
    context.header("Cache-Control", "no-store");
    const boundaryError = apiRequestBoundaryError(
      context.req.raw,
      apiRequestBoundary,
    );
    if (boundaryError) return context.json({ error: boundaryError }, 400);

    const isMutation =
      mutationMethods[context.req.method.toUpperCase()] === true;
    if (isMutation && context.req.header("X-DLH-Client") !== "web") {
      return context.json(
        { error: "Local browser client marker is required" },
        403,
      );
    }
    if (isMutation && context.req.header("Origin") !== allowedWebOrigin) {
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

  app.post("/api/ai/disclosures", async (context) => {
    const body = disclosureRequestSchema.parse(await context.req.json());
    const sessionRejection = await agentLearningSessionRejection(
      state,
      body.sessionId,
    );
    if (sessionRejection) {
      return context.json(
        { error: sessionRejection.error },
        sessionRejection.status,
      );
    }
    const preparation = await state.providerRuntime.prepareDisclosure({
      role: body.role,
      payload: body.message,
      payloadCategories: ["learner-message"],
      ...(body.sessionId
        ? { entityIds: { "learning-session": body.sessionId } }
        : {}),
      destinationPurpose: "optional learning assistance",
    });
    return context.json(preparation);
  });

  app.post("/api/ai/disclosures/:operationId/approve", async (context) => {
    z.object({})
      .strict()
      .parse(await context.req.json());
    const disclosure = state.providerRuntime.approveDisclosure(
      context.req.param("operationId"),
    );
    return context.json({ disclosure });
  });

  app.post("/api/ai/disclosures/:operationId/cancel", async (context) => {
    z.object({})
      .strict()
      .parse(await context.req.json());
    const disclosure = state.providerRuntime.cancelDisclosure(
      context.req.param("operationId"),
    );
    return context.json({ disclosure });
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
  registerCoursePackRoutes(app, createCoursePackRepository(connection));
  registerCurriculumEditorRoutes(app, state);
  registerPersonalAdaptationRoutes(app, state);
  registerCourseDesignerRoutes(app, state);
  registerInterviewV2Routes(app, state);

  app.post("/api/learning/sessions", (context) =>
    context.json(legacyLearningMutationError, 410),
  );

  app.get("/api/learning/sessions/:id", async (context) => {
    const detail = await state.repository.getSession(context.req.param("id"));
    return context.json(toSessionResponse(detail));
  });

  app.post("/api/learning/sessions/:id/answers", (context) =>
    context.json(legacyLearningMutationError, 410),
  );

  app.post("/api/learning/sessions/:id/complete", (context) =>
    context.json(legacyLearningMutationError, 410),
  );

  app.post("/api/agent/stream", async (context) => {
    const body = chatSchema.parse(await context.req.json());
    const sessionRejection = await agentLearningSessionRejection(
      state,
      body.sessionId,
    );
    if (sessionRejection) {
      return context.json(
        { error: sessionRejection.error },
        sessionRejection.status,
      );
    }
    const requestSignal = context.req.raw.signal;
    let setupAborted = requestSignal.aborted;
    const onSetupAbort = () => {
      setupAborted = true;
    };
    if (!setupAborted) {
      requestSignal.addEventListener("abort", onSetupAbort, { once: true });
      if (requestSignal.aborted) setupAborted = true;
    }
    if (setupAborted) {
      return context.json({ error: safeAgentCancellationMessage }, 409);
    }
    const inspection = await state.providerRuntime.inspectRole(body.role);
    const providerId = inspection.connection.adapterId;
    const modelId = inspection.modelId;
    const key = JSON.stringify([
      body.sessionId ?? null,
      body.role,
      inspection.connection.connectionId,
      modelId,
    ]);
    const turnId = randomUUID();
    const setupUserMessageIdempotencyKey = `agent-turn:${turnId}:user`;
    const setupAssistantMessageIdempotencyKey = `agent-turn:${turnId}:assistant`;
    if (state.activeProviderTurnReservations.has(key)) {
      return context.json({ error: activeAgentTurnConflictMessage }, 409);
    }
    state.activeProviderTurnReservations.set(key, turnId);

    let storedSession: ProviderSessionRecord;
    let createdProviderSession:
      { provider: AgentProvider; providerSessionId: string } | undefined;
    let createdSessionRecord: ProviderSessionRecord | undefined;
    let reusedSessionRecord: ProviderSessionRecord | undefined;
    let createdConversationId: string | undefined;
    let setupCleanup: Promise<void> | undefined;
    let dispatch: ProviderDispatch | undefined;
    let dispatchFinished = false;
    const finishDispatch = (
      status: "completed" | "failed" | "cancelled",
      failureCode: ReturnType<typeof providerFailureCode> | null,
    ) => {
      if (!dispatch || dispatchFinished) return;
      state.providerRuntime.finishDispatch(dispatch, status, failureCode);
      dispatchFinished = true;
    };
    const hasPersistedSetupMessage = (input: {
      conversationId: string;
      idempotencyKey: string;
      role: "user" | "assistant";
      content: string;
      status: "completed" | "failed" | "cancelled";
    }) =>
      state.connection.sqlite
        .prepare(
          `SELECT 1 AS found FROM agent_messages
           WHERE conversation_id = ? AND idempotency_key = ?
             AND role = ? AND content = ? AND status = ?
             AND tool_events_json = '[]' AND raw_event_json IS NULL`,
        )
        .get(
          input.conversationId,
          input.idempotencyKey,
          input.role,
          input.content,
          input.status,
        ) !== undefined;
    const cleanupFailedSetup = () => {
      setupCleanup ??= (async () => {
        let transcriptPersistenceFailed = false;
        let transcriptRollbackUnverified = false;
        try {
          if (createdSessionRecord) {
            evictProviderSession(state, key, createdSessionRecord);
            await createdSessionRecord.provider
              .cancelSession(createdSessionRecord.providerSessionId)
              .catch(() => {});
          } else if (createdProviderSession) {
            await createdProviderSession.provider
              .cancelSession(createdProviderSession.providerSessionId)
              .catch(() => {});
          } else if (reusedSessionRecord) {
            let userMessagePersisted = false;
            try {
              userMessagePersisted = hasPersistedSetupMessage({
                conversationId: reusedSessionRecord.conversationId,
                idempotencyKey: setupUserMessageIdempotencyKey,
                role: "user",
                content: body.message,
                status: "completed",
              });
            } catch {
              transcriptPersistenceFailed = true;
            }

            if (userMessagePersisted || transcriptPersistenceFailed) {
              evictProviderSession(state, key, reusedSessionRecord);
              await reusedSessionRecord.provider
                .cancelSession(reusedSessionRecord.providerSessionId)
                .catch(() => {});
            }

            if (userMessagePersisted) {
              const cancelled = setupAborted || requestSignal.aborted;
              const terminalContent = cancelled
                ? safeAgentCancellationMessage
                : safeAgentFailureMessage;
              const terminalStatus = cancelled ? "cancelled" : "failed";
              let terminalPersisted = false;
              try {
                await persistAgentResponse(state, {
                  conversationId: reusedSessionRecord.conversationId,
                  content: terminalContent,
                  status: terminalStatus,
                  idempotencyKey: setupAssistantMessageIdempotencyKey,
                });
                terminalPersisted = hasPersistedSetupMessage({
                  conversationId: reusedSessionRecord.conversationId,
                  idempotencyKey: setupAssistantMessageIdempotencyKey,
                  role: "assistant",
                  content: terminalContent,
                  status: terminalStatus,
                });
              } catch {
                try {
                  terminalPersisted = hasPersistedSetupMessage({
                    conversationId: reusedSessionRecord.conversationId,
                    idempotencyKey: setupAssistantMessageIdempotencyKey,
                    role: "assistant",
                    content: terminalContent,
                    status: terminalStatus,
                  });
                } catch {
                  terminalPersisted = false;
                }
              }
              if (!terminalPersisted) {
                transcriptPersistenceFailed = true;
                try {
                  state.connection.sqlite
                    .prepare(
                      `DELETE FROM agent_messages
                       WHERE conversation_id = ? AND idempotency_key = ?
                         AND role = 'user' AND content = ?
                         AND status = 'completed'
                         AND tool_events_json = '[]'
                         AND raw_event_json IS NULL`,
                    )
                    .run(
                      reusedSessionRecord.conversationId,
                      setupUserMessageIdempotencyKey,
                      body.message,
                    );
                  transcriptRollbackUnverified =
                    state.connection.sqlite
                      .prepare(
                        `SELECT 1 AS found FROM agent_messages
                         WHERE conversation_id = ? AND idempotency_key = ?`,
                      )
                      .get(
                        reusedSessionRecord.conversationId,
                        setupUserMessageIdempotencyKey,
                      ) !== undefined;
                } catch {
                  transcriptRollbackUnverified = true;
                }
              }
            }
          }
        } finally {
          try {
            if (createdConversationId) {
              state.connection.sqlite
                .prepare("DELETE FROM agent_conversations WHERE id = ?")
                .run(createdConversationId);
            }
          } finally {
            releaseAgentTurnReservation(state, key, turnId);
          }
        }
        if (transcriptPersistenceFailed || transcriptRollbackUnverified) {
          throw new Error(safeAgentFailureMessage);
        }
      })();
      return setupCleanup;
    };
    try {
      if (setupAborted || requestSignal.aborted) {
        throw new Error(safeAgentCancellationMessage);
      }
      dispatch = await state.providerRuntime.resolveDispatch({
        role: body.role,
        payload: body.message,
        ...(body.disclosureOperationId
          ? { disclosureOperationId: body.disclosureOperationId }
          : {}),
        metadata: body.sessionId ? { learningSessionId: body.sessionId } : {},
      });
      const { provider } = dispatch;
      if (setupAborted || requestSignal.aborted) {
        throw new Error(safeAgentCancellationMessage);
      }
      if (
        dispatch.connection.adapterId !== providerId ||
        dispatch.modelId !== modelId
      ) {
        throw new ProviderHubError(
          "misconfigured",
          "Role profile changed while the provider turn was starting",
        );
      }
      const existingSession = state.providerSessions.get(key);
      if (existingSession) {
        storedSession = existingSession;
        reusedSessionRecord = existingSession;
      } else {
        const session = await provider
          .createSession({
            role: body.role,
            modelId,
            systemPrompt: getLatestPrompt(body.role).systemPrompt,
            metadata: body.sessionId
              ? { learningSessionId: body.sessionId }
              : {},
          })
          .catch(() => {
            throw new Error(safeAgentFailureMessage);
          });
        createdProviderSession = {
          provider,
          providerSessionId: session.id,
        };
        if (setupAborted || requestSignal.aborted) {
          throw new Error(safeAgentCancellationMessage);
        }
        if (
          session.providerId !== providerId ||
          session.role !== body.role ||
          session.modelId !== modelId
        ) {
          throw new Error(safeAgentFailureMessage);
        }
        const conversation = await state.repository.createConversation({
          learningSessionId: body.sessionId ?? null,
          role: body.role,
          providerId,
          modelId,
          providerSessionId: null,
        });
        createdConversationId = conversation.id;
        if (setupAborted || requestSignal.aborted) {
          throw new Error(safeAgentCancellationMessage);
        }
        storedSession = {
          providerId,
          provider,
          providerSessionId: session.id,
          conversationId: conversation.id,
        };
        createdSessionRecord = storedSession;
        state.providerSessions.set(key, storedSession);
      }
      await state.repository.addMessage({
        conversationId: storedSession.conversationId,
        role: "user",
        content: body.message,
        idempotencyKey: setupUserMessageIdempotencyKey,
      });
      if (setupAborted || requestSignal.aborted) {
        throw new Error(safeAgentCancellationMessage);
      }
    } catch (error) {
      requestSignal.removeEventListener("abort", onSetupAbort);
      await cleanupFailedSetup();
      const cancelled = setupAborted || requestSignal.aborted;
      finishDispatch(
        cancelled ? "cancelled" : "failed",
        cancelled ? "cancelled" : providerFailureCode(error),
      );
      if (cancelled) {
        return context.json({ error: safeAgentCancellationMessage }, 409);
      }
      throw error;
    }

    const providerSessionId = storedSession.providerSessionId;
    const conversationId = storedSession.conversationId;
    if (setupAborted || requestSignal.aborted) {
      requestSignal.removeEventListener("abort", onSetupAbort);
      await cleanupFailedSetup();
      finishDispatch("cancelled", "cancelled");
      return context.json({ error: safeAgentCancellationMessage }, 409);
    }
    const activeDispatch = dispatch;
    if (!activeDispatch) {
      throw new ProviderHubError(
        "provider_error",
        "Provider dispatch was not initialized",
      );
    }
    try {
      context.header("X-DLH-Agent-Turn-Id", turnId);
      state.activeProviderTurns.set(turnId, { key, session: storedSession });
      return streamSSE(context, async (stream) => {
        let assistantContent = "";
        let terminalReason: "completed" | "failed" | "cancelled" | undefined;
        let status: "completed" | "failed" | "cancelled" = "failed";
        let messageCompleted = false;
        let completedClientEvent: BrowserAgentEvent | undefined;
        let responsePersisted = false;
        let providerStreamCompleted = false;
        const persistResponse = async () => {
          await persistAgentResponse(state, {
            conversationId,
            content: assistantContent,
            status,
          });
          responsePersisted = true;
        };
        try {
          if (setupAborted || requestSignal.aborted) {
            throw new Error(safeAgentCancellationMessage);
          }
          for await (const event of state.providerRuntime.stream(
            activeDispatch,
            providerSessionId,
            requestSignal,
            body.role === "reviewer" ? "json" : "text",
          )) {
            if (requestSignal.aborted) {
              throw new ProviderHubError(
                "cancelled",
                safeAgentCancellationMessage,
              );
            }
            let clientEvent: BrowserAgentEvent;
            switch (event.type) {
              case "message.delta": {
                if (messageCompleted) {
                  throw new ProviderHubError(
                    "invalid_output",
                    safeAgentFailureMessage,
                  );
                }
                assistantContent += event.delta;
                clientEvent = {
                  type: "message.delta",
                  turnId,
                  content: event.delta,
                };
                break;
              }
              case "message.completed": {
                if (messageCompleted) {
                  throw new ProviderHubError(
                    "invalid_output",
                    safeAgentFailureMessage,
                  );
                }
                messageCompleted = true;
                assistantContent = event.content;
                completedClientEvent = {
                  type: "message.completed",
                  turnId,
                  content: event.content,
                };
                continue;
              }
              case "session.completed":
                terminalReason = event.reason;
                if (event.reason === "failed") {
                  throw new Error(safeAgentFailureMessage);
                }
                continue;
              case "tool.started":
              case "tool.completed":
                continue;
              case "error":
                throw new ProviderHubError(
                  "provider_error",
                  safeAgentFailureMessage,
                );
            }
            await stream.writeSSE({ data: JSON.stringify(clientEvent) });
          }
          providerStreamCompleted = true;
          if (requestSignal.aborted) {
            throw new Error(safeAgentCancellationMessage);
          }

          if (terminalReason === "cancelled") {
            status = "cancelled";
            assistantContent = safeAgentCancellationMessage;
            evictProviderSession(state, key, storedSession);
          } else if (terminalReason === "completed") {
            if (!messageCompleted) throw new Error(safeAgentFailureMessage);
            status = "completed";
          } else {
            throw new Error(safeAgentFailureMessage);
          }

          await persistResponse();
          finishDispatch(status, status === "completed" ? null : "cancelled");
          if (status === "completed" && completedClientEvent) {
            await stream.writeSSE({
              data: JSON.stringify(completedClientEvent),
            });
          }
          await stream.writeSSE({
            data: JSON.stringify({
              type: "session.completed",
              turnId,
              reason: terminalReason,
            } satisfies BrowserAgentEvent),
          });
        } catch (error) {
          const cancelled =
            setupAborted ||
            requestSignal.aborted ||
            (error instanceof ProviderHubError &&
              error.failure.code === "cancelled");
          status = cancelled ? "cancelled" : "failed";
          assistantContent = cancelled
            ? safeAgentCancellationMessage
            : safeAgentFailureMessage;
          if (providerStreamCompleted) {
            await cancelAndEvictProviderSession(
              state,
              key,
              storedSession,
            ).catch(() => evictProviderSession(state, key, storedSession));
          } else {
            evictProviderSession(state, key, storedSession);
          }
          finishDispatch(
            status,
            cancelled ? "cancelled" : providerFailureCode(error),
          );

          let persistenceFailed = false;
          if (!responsePersisted) {
            try {
              await persistResponse();
            } catch {
              persistenceFailed = true;
              status = "failed";
              assistantContent = safeAgentFailureMessage;
            }
          }

          try {
            if (cancelled && !persistenceFailed) {
              await stream.writeSSE({
                data: JSON.stringify({
                  type: "session.completed",
                  turnId,
                  reason: "cancelled",
                } satisfies BrowserAgentEvent),
              });
            } else {
              await stream.writeSSE({
                data: JSON.stringify({
                  type: "error",
                  turnId,
                  message: safeAgentFailureMessage,
                } satisfies BrowserAgentEvent),
              });
              await stream.writeSSE({
                data: JSON.stringify({
                  type: "session.completed",
                  turnId,
                  reason: "failed",
                } satisfies BrowserAgentEvent),
              });
            }
          } catch {
            // The browser may have disconnected while the provider was cancelled.
          }
        } finally {
          const activeTurn = state.activeProviderTurns.get(turnId);
          if (activeTurn?.session === storedSession) {
            state.activeProviderTurns.delete(turnId);
          }
          if (status !== "completed") {
            evictProviderSession(state, key, storedSession);
          }
          releaseAgentTurnReservation(state, key, turnId);
        }
      });
    } catch (error) {
      requestSignal.removeEventListener("abort", onSetupAbort);
      const activeTurn = state.activeProviderTurns.get(turnId);
      if (activeTurn?.session === storedSession) {
        state.activeProviderTurns.delete(turnId);
      }
      await cleanupFailedSetup();
      const cancelled = setupAborted || requestSignal.aborted;
      finishDispatch(
        cancelled ? "cancelled" : "failed",
        cancelled ? "cancelled" : providerFailureCode(error),
      );
      if (cancelled) {
        return context.json({ error: safeAgentCancellationMessage }, 409);
      }
      throw error;
    }
  });

  app.delete("/api/agent/turns/:turnId", async (context) => {
    const turnId = context.req.param("turnId");
    const active = state.activeProviderTurns.get(turnId);
    if (!active) {
      return context.json({ error: "Unknown active agent turn" }, 404);
    }
    await cancelAndEvictProviderSession(
      state,
      active.key,
      active.session,
    ).catch(() => {
      throw new Error(safeAgentFailureMessage);
    });
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
      workspace: attempt
        ? {
            id: attempt.workspaceHandleId,
            generation: attempt.workspaceGeneration,
            environmentId: attempt.environmentId,
            trust: "trusted-local-unsandboxed" as const,
          }
        : null,
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
    assertCourseScopedSessionSideEffectAllowed(
      state.connection,
      body.sessionId,
    );
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
    if (existing)
      return context.json({
        id: existing.id,
        workspace: {
          id: existing.workspaceHandleId,
          generation: existing.workspaceGeneration,
        },
      });
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
    let sourceSnapshot;
    try {
      baseline = await ensureExerciseBaseline(isolated.workspacePath);
      sourceSnapshot = await snapshotCompleteWorkspace(isolated.workspacePath);
    } catch (error) {
      await rm(isolated.workspacePath, { recursive: true, force: true });
      throw error;
    }
    const workspaceHandleId = randomUUID();
    const now = Date.now();
    try {
      state.connection.sqlite
        .prepare(
          `INSERT INTO exercise_attempts
           (id, session_id, exercise_id, status, workspace_path, baseline_path,
            baseline_hash, environment_id, workspace_handle_id,
            workspace_generation, source_snapshot_hash, started_at,
            completed_at, updated_at)
           VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, 1, ?, ?, NULL, ?)`,
        )
        .run(
          id,
          body.sessionId,
          exercise.templateExerciseId,
          isolated.workspacePath,
          isolated.workspacePath,
          baseline.commit,
          LEGACY_NODE_ENVIRONMENT_ID,
          workspaceHandleId,
          sourceSnapshot.contentHash,
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
      if (raced)
        return context.json({
          id: raced.id,
          workspace: {
            id: raced.workspaceHandleId,
            generation: raced.workspaceGeneration,
          },
        });
      throw error;
    }
    return context.json(
      { id, workspace: { id: workspaceHandleId, generation: 1 } },
      201,
    );
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

  app.post("/api/exercise-attempts/:id/checks", async (context) => {
    const attempt = await requireAttempt(state, context.req.param("id"), true);
    const body = z
      .object({
        operationId: z.string().trim().min(1).max(200),
        checkIds: z.array(z.literal(LEGACY_NODE_TEST_CHECK_ID)).length(1),
      })
      .strict()
      .parse(await context.req.json());
    const checkId = body.checkIds[0]!;
    const inputSnapshot = await snapshotCompleteWorkspace(
      attempt.workspacePath,
    );
    const previousRun = findTestRunByOperation(
      state.connection,
      body.operationId,
    );
    if (previousRun) {
      if (
        previousRun.exerciseAttemptId !== attempt.id ||
        previousRun.environmentId !== attempt.environmentId ||
        previousRun.checkId !== checkId ||
        previousRun.inputSnapshotHash !== inputSnapshot.contentHash
      ) {
        return context.json(
          {
            error:
              "Operation ID has already been used for another check request",
          },
          409,
        );
      }
      return context.json(toTestRunResponse(previousRun));
    }
    const environment = state.executionFabric.describeEnvironment(
      attempt.environmentId,
    );
    const testRunId = randomUUID();
    const startedAt = Date.now();
    const runningResult = {
      schemaVersion: 1,
      operationId: body.operationId,
      status: "running",
      environmentId: environment.id,
      environmentPackDigest: environment.digest,
      inputSnapshotHash: inputSnapshot.contentHash,
    };
    state.connection.sqlite
      .prepare(
        `INSERT INTO test_runs
         (id, exercise_attempt_id, operation_id, status, exit_code, stdout,
          stderr, duration_ms, diff_fingerprint, diff_truncated, started_at,
          completed_at, check_id, environment_id, environment_pack_digest,
          backend_id, input_snapshot_hash, result_json)
         VALUES (?, ?, ?, 'running', NULL, '', '', NULL, NULL, 0, ?, NULL,
                 ?, ?, ?, 'local-native', ?, ?)`,
      )
      .run(
        testRunId,
        attempt.id,
        body.operationId,
        startedAt,
        checkId,
        environment.id,
        environment.digest,
        inputSnapshot.contentHash,
        JSON.stringify(runningResult),
      );
    try {
      const result = await state.executionFabric.run({
        operationId: body.operationId,
        attemptId: attempt.id,
        courseRevisionId: requireAttemptCourseRevisionId(
          state.connection,
          attempt.sessionId,
        ),
        activityId: attempt.exerciseId,
        workspacePath: attempt.workspacePath,
        environmentId: attempt.environmentId,
        checkIds: body.checkIds,
        expectedInputSnapshotHash: inputSnapshot.contentHash,
        signal: context.req.raw.signal,
      });
      const testedDiff = await getExerciseDiff(attempt.workspacePath, {
        expectedBaselineHash: attempt.baselineHash,
      });
      const diffFingerprint = fingerprintExerciseDiff(testedDiff);
      const publicResult = publicExecutionResult(result);
      const stdout = result.artifacts
        .map((artifact) => artifact.content)
        .join("\n");
      const stderr = result.diagnostics
        .filter((diagnostic) => diagnostic.severity === "error")
        .map((diagnostic) => diagnostic.message)
        .join("\n");
      const now = Date.now();
      await withAsyncTransaction(state.connection, async () => {
        state.connection.sqlite
          .prepare(
            `UPDATE test_runs
             SET status = ?, exit_code = ?, stdout = ?, stderr = ?,
                 duration_ms = ?, diff_fingerprint = ?, diff_truncated = ?,
                 result_json = ?, completed_at = ?
             WHERE id = ? AND status = 'running'`,
          )
          .run(
            result.status,
            result.status === "passed" ? 0 : 1,
            stdout,
            stderr,
            result.durationMs,
            diffFingerprint,
            testedDiff.truncated || result.truncated ? 1 : 0,
            JSON.stringify(publicResult),
            now,
            testRunId,
          );
        const insertArtifact = state.connection.sqlite.prepare(
          `INSERT INTO execution_artifacts
           (id, test_run_id, artifact_type, media_type, digest, size_bytes,
            retention, truncated, content, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        for (const artifact of result.artifacts) {
          insertArtifact.run(
            artifact.id,
            testRunId,
            artifact.type,
            artifact.mediaType,
            artifact.digest,
            artifact.sizeBytes,
            artifact.retention,
            artifact.truncated ? 1 : 0,
            artifact.content,
            now,
          );
        }
      });
      return context.json({
        id: testRunId,
        output: [stdout, stderr].filter(Boolean).join("\n"),
        exitCode: result.status === "passed" ? 0 : 1,
        status: result.status,
        operationId: body.operationId,
        result: publicResult,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Trusted check runner failed";
      state.connection.sqlite
        .prepare(
          `UPDATE test_runs
           SET status = 'backend_error', stderr = ?, result_json = ?,
               completed_at = ?
           WHERE id = ? AND status = 'running'`,
        )
        .run(
          message,
          JSON.stringify({
            ...runningResult,
            status: "backend_error",
            error: message,
          }),
          Date.now(),
          testRunId,
        );
      throw error;
    }
  });

  app.post("/api/exercise-attempts/:id/reviews", async (context) => {
    const attempt = await requireAttempt(state, context.req.param("id"), true);
    const body = z
      .object({
        operationId: z.string().trim().min(1).max(200),
        previewDisclosure: z.boolean().optional(),
        disclosureOperationId: z.string().trim().min(1).max(200).optional(),
      })
      .strict()
      .parse(await context.req.json());
    const prior = state.connection.sqlite
      .prepare(
        `SELECT r.id, r.exercise_attempt_id AS exerciseAttemptId,
                r.result_json AS resultJson, b.id AS bundleId,
                b.bundle_sha256 AS evidenceSha256,
                b.workspace_snapshot_hash AS workspaceSnapshotHash
         FROM reviews r
         LEFT JOIN review_evidence_bundles b ON b.review_id = r.id
         WHERE r.operation_id = ? LIMIT 1`,
      )
      .get(body.operationId) as
      | {
          id: string;
          exerciseAttemptId: string | null;
          resultJson: string | null;
          bundleId: string | null;
          evidenceSha256: string | null;
          workspaceSnapshotHash: string | null;
        }
      | undefined;
    if (prior) {
      if (prior.exerciseAttemptId !== attempt.id || !prior.resultJson) {
        return context.json(
          { error: "Operation ID has already been used for another review" },
          409,
        );
      }
      return context.json({
        id: prior.id,
        ...JSON.parse(prior.resultJson),
        evidenceBundle: prior.bundleId
          ? {
              id: prior.bundleId,
              sha256: prior.evidenceSha256,
              workspaceSnapshotHash: prior.workspaceSnapshotHash,
            }
          : null,
      });
    }
    const [before, beforeSnapshot] = await Promise.all([
      getExerciseDiff(attempt.workspacePath, {
        expectedBaselineHash: attempt.baselineHash,
      }),
      snapshotCompleteWorkspace(attempt.workspacePath),
    ]);
    const reviewedDiffFingerprint = fingerprintExerciseDiff(before);
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
      latestTest.diffFingerprint !== reviewedDiffFingerprint ||
      latestTest.inputSnapshotHash !== beforeSnapshot.contentHash
    ) {
      return context.json(
        {
          error:
            "Review requires a passing trusted check after the latest learner edit",
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
      workspaceSnapshotHash: beforeSnapshot.contentHash,
      testRun: latestTest,
      criteria: exercise.criteria,
      constraints: exercise.constraints,
      prompt: exercise.prompt,
      signal: context.req.raw.signal,
      ...(body.previewDisclosure ? { previewDisclosure: true } : {}),
      ...(body.disclosureOperationId
        ? { disclosureOperationId: body.disclosureOperationId }
        : {}),
    });
    if (review.kind === "disclosure") {
      return context.json(review, 202);
    }
    const [after, afterSnapshot] = await Promise.all([
      getExerciseDiff(attempt.workspacePath, {
        expectedBaselineHash: attempt.baselineHash,
      }),
      snapshotCompleteWorkspace(attempt.workspacePath),
    ]);
    if (
      before.patch !== after.patch ||
      before.truncated !== after.truncated ||
      before.baselineCommit !== after.baselineCommit ||
      beforeSnapshot.contentHash !== afterSnapshot.contentHash
    ) {
      throw new Error("Reviewer boundary violation: workspace changed");
    }
    const now = Date.now();
    const reviewId = randomUUID();
    const bundleId = randomUUID();
    const evidenceSha256 = `sha256:${createHash("sha256")
      .update(review.evidenceBundleJson)
      .digest("hex")}`;
    await withAsyncTransaction(state.connection, async () => {
      state.connection.sqlite
        .prepare(
          `INSERT INTO reviews
           (id, session_id, exercise_attempt_id, operation_id, provider_id,
            model_id, status, result_json, raw_response, created_at, completed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          reviewId,
          attempt.sessionId,
          attempt.id,
          body.operationId,
          review.providerId,
          review.modelId,
          review.result.status,
          JSON.stringify(review.result),
          null,
          now,
          now,
        );
      state.connection.sqlite
        .prepare(
          `INSERT INTO review_evidence_bundles
           (id, review_id, exercise_attempt_id, test_run_id,
            workspace_snapshot_hash, diff_fingerprint, bundle_sha256,
            bundle_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          bundleId,
          reviewId,
          attempt.id,
          latestTest.id,
          beforeSnapshot.contentHash,
          reviewedDiffFingerprint,
          evidenceSha256,
          review.evidenceBundleJson,
          now,
        );
    });
    return context.json({
      id: reviewId,
      ...review.result,
      evidenceBundle: {
        id: bundleId,
        sha256: evidenceSha256,
        workspaceSnapshotHash: beforeSnapshot.contentHash,
      },
    });
  });

  app.get(
    "/api/exercise-attempts/:id/review-bundles/:bundleId",
    async (context) => {
      const attempt = await requireAttempt(state, context.req.param("id"));
      const row = state.connection.sqlite
        .prepare(
          `SELECT id, workspace_snapshot_hash AS workspaceSnapshotHash,
                  bundle_sha256 AS evidenceSha256, bundle_json AS bundleJson,
                  created_at AS createdAt
           FROM review_evidence_bundles
           WHERE id = ? AND exercise_attempt_id = ?`,
        )
        .get(context.req.param("bundleId"), attempt.id) as
        | {
            id: string;
            workspaceSnapshotHash: string;
            evidenceSha256: string;
            bundleJson: string;
            createdAt: number;
          }
        | undefined;
      if (!row) return context.json({ error: "Unknown review capsule" }, 404);
      const observedSha256 = `sha256:${createHash("sha256")
        .update(row.bundleJson)
        .digest("hex")}`;
      if (observedSha256 !== row.evidenceSha256) {
        throw new Error("Review capsule integrity check failed");
      }
      return context.json({
        id: row.id,
        workspaceSnapshotHash: row.workspaceSnapshotHash,
        sha256: row.evidenceSha256,
        createdAt: row.createdAt,
        evidence: JSON.parse(row.bundleJson),
      });
    },
  );

  app.post("/api/exercise-attempts/:id/open", async (context) => {
    const attempt = await requireAttempt(state, context.req.param("id"), true);
    const configured = process.env.ZED_EXECUTABLE ?? "zed";
    const plan = buildZedOpenPlan(attempt.workspacePath, {
      executable: configured,
    });
    const result = await openInZed(plan);
    return context.json({
      opened: result.opened,
      message:
        result.error ??
        (result.opened
          ? "Editor opened for the trusted attempt workspace."
          : "Editor launch is unavailable."),
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
      .strict()
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
    const ai = await state.providerRuntime.settings();
    return context.json({ ...settings, ai });
  });

  app.put("/api/settings", async (context) => {
    const settings = settingsMutationSchema.parse(await context.req.json());
    await state.repository.setSetting("theme", settings.theme);
    return context.json({ saved: true });
  });
  app.put("/api/settings/locale", async (context) => {
    const settings = localeMutationSchema.parse(await context.req.json());
    await state.repository.setSetting("uiLocale", settings.uiLocale);
    return context.json({ saved: true, uiLocale: settings.uiLocale });
  });
  app.put("/api/settings/ai", async (context) => {
    const settings = aiSettingsMutationSchema.parse(await context.req.json());
    const roleProfiles = await state.providerRuntime.saveRoleProfiles(
      settings.roleProfiles,
    );
    return context.json({ saved: true, roleProfiles });
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

function isJsonContentType(contentType: string | undefined): boolean {
  return (
    contentType?.split(";", 1)[0]?.trim().toLowerCase() === "application/json"
  );
}

async function agentLearningSessionRejection(
  state: AppState,
  sessionId: string | undefined,
): Promise<{ status: 404 | 409; error: string } | null> {
  if (sessionId === undefined) return null;

  let requested: Awaited<ReturnType<LearningRepository["getVersionedSession"]>>;
  try {
    requested = await state.repository.getVersionedSession(sessionId);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith("Unknown versioned learning session:")
    ) {
      return { status: 404, error: error.message };
    }
    throw error;
  }
  if (requested.session.status !== "active") {
    return {
      status: 409,
      error: "Agent turns require an active versioned learning session",
    };
  }
  const current = await state.repository.getCurrentVersionedSession();
  if (current?.session.id !== requested.session.id) {
    return {
      status: 409,
      error:
        "Agent turns require the current active versioned learning session",
    };
  }
  try {
    assertCourseScopedSessionSideEffectAllowed(
      state.connection,
      requested.session.id,
    );
  } catch (error) {
    if (error instanceof CourseSessionContextError) {
      return { status: 409, error: error.message };
    }
    throw error;
  }
  return null;
}

function releaseAgentTurnReservation(
  state: AppState,
  key: string,
  turnId: string,
): void {
  if (state.activeProviderTurnReservations.get(key) === turnId) {
    state.activeProviderTurnReservations.delete(key);
  }
}

function evictProviderSession(
  state: AppState,
  key: string,
  session: ProviderSessionRecord,
): void {
  if (state.providerSessions.get(key) === session) {
    state.providerSessions.delete(key);
  }
  for (const [turnId, activeTurn] of state.activeProviderTurns) {
    if (activeTurn.session === session) {
      state.activeProviderTurns.delete(turnId);
    }
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
              workspace_path AS workspacePath, baseline_hash AS baselineHash,
              environment_id AS environmentId,
              workspace_handle_id AS workspaceHandleId,
              workspace_generation AS workspaceGeneration,
              source_snapshot_hash AS sourceSnapshotHash
       FROM exercise_attempts WHERE session_id = ? AND exercise_id = ?`,
    )
    .get(sessionId, exerciseId) as AttemptRecord | undefined;
}

async function requireAttempt(
  state: Pick<AppState, "connection" | "exerciseAttemptsRoot">,
  attemptId: string,
  forMutation = false,
): Promise<AttemptRecord> {
  const attempt = state.connection.sqlite
    .prepare(
      `SELECT id, session_id AS sessionId, exercise_id AS exerciseId,
              workspace_path AS workspacePath, baseline_hash AS baselineHash,
              environment_id AS environmentId,
              workspace_handle_id AS workspaceHandleId,
              workspace_generation AS workspaceGeneration,
              source_snapshot_hash AS sourceSnapshotHash
       FROM exercise_attempts WHERE id = ?`,
    )
    .get(attemptId) as AttemptRecord | undefined;
  if (!attempt) throw new Error("Unknown exercise attempt");
  if (forMutation) {
    assertCourseScopedSessionSideEffectAllowed(
      state.connection,
      attempt.sessionId,
    );
  }
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
  const currentSnapshot = await snapshotCompleteWorkspace(
    attempt.workspacePath,
  );
  const latestTest = findLatestTestRun(connection, attempt.id);
  const currentDiffFingerprint = fingerprintExerciseDiff(currentDiff);
  const testFresh = Boolean(
    latestTest &&
    latestTest.diffTruncated === 0 &&
    latestTest.diffFingerprint !== null &&
    latestTest.diffFingerprint === currentDiffFingerprint &&
    latestTest.inputSnapshotHash === currentSnapshot.contentHash,
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
    evidenceBundle: {
      id: string;
      sha256: string;
      workspaceSnapshotHash: string;
    } | null;
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
          evidenceBundle:
            latestReviewRecord.bundleId &&
            latestReviewRecord.evidenceSha256 &&
            latestReviewRecord.workspaceSnapshotHash
              ? {
                  id: latestReviewRecord.bundleId,
                  sha256: latestReviewRecord.evidenceSha256,
                  workspaceSnapshotHash:
                    latestReviewRecord.workspaceSnapshotHash,
                }
              : null,
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
      `SELECT r.id, r.status, r.result_json AS resultJson,
              r.created_at AS createdAt, b.id AS bundleId,
              b.bundle_sha256 AS evidenceSha256,
              b.workspace_snapshot_hash AS workspaceSnapshotHash
       FROM reviews r
       LEFT JOIN review_evidence_bundles b ON b.review_id = r.id
       WHERE r.exercise_attempt_id = ?
       ORDER BY r.created_at DESC, r.rowid DESC LIMIT 1`,
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
              started_at AS startedAt, completed_at AS completedAt,
              check_id AS checkId, environment_id AS environmentId,
              environment_pack_digest AS environmentPackDigest,
              backend_id AS backendId,
              input_snapshot_hash AS inputSnapshotHash,
              result_json AS resultJson
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
              started_at AS startedAt, completed_at AS completedAt,
              check_id AS checkId, environment_id AS environmentId,
              environment_pack_digest AS environmentPackDigest,
              backend_id AS backendId,
              input_snapshot_hash AS inputSnapshotHash,
              result_json AS resultJson
       FROM test_runs WHERE exercise_attempt_id = ?
       ORDER BY started_at DESC, rowid DESC LIMIT 1`,
    )
    .get(attemptId) as TestRunRecord | undefined;
}

function toTestRunResponse(run: TestRunRecord) {
  let result: unknown = null;
  if (run.resultJson !== null) {
    try {
      result = JSON.parse(run.resultJson);
    } catch {
      result = null;
    }
  }
  return {
    id: run.id,
    output: [run.stdout, run.stderr].filter(Boolean).join("\n"),
    exitCode: run.exitCode ?? -1,
    status: run.status,
    operationId: run.operationId,
    result,
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
function requireAttemptCourseRevisionId(
  connection: DatabaseConnection,
  sessionId: string,
): string {
  const row = connection.sqlite
    .prepare(
      `SELECT revision_id AS revisionId
       FROM session_course_contexts WHERE session_id = ?`,
    )
    .get(sessionId) as { revisionId: string } | undefined;
  if (!row)
    throw new Error("Exercise session has no immutable Course revision");
  return row.revisionId;
}

function publicExecutionResult(result: ExecutionResult) {
  return {
    ...result,
    artifacts: result.artifacts.map(
      ({ content: _content, ...artifact }) => artifact,
    ),
  };
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
    theme: "system" as const,
    uiLocale: null as "en-US" | "ru-RU" | null,
  };
  const entries = await Promise.all(
    Object.keys(defaults).map(async (key) => {
      const defaultValue = defaults[key as keyof typeof defaults];
      return [
        key,
        key === "zedExecutable" || key === "opencodeBaseUrl"
          ? defaultValue
          : ((await state.repository.getSetting(key)) ?? defaultValue),
      ];
    }),
  );
  return settingsSchema.parse(Object.fromEntries(entries));
}

async function requestExerciseReview(
  state: AppState,
  input: {
    attempt: AttemptRecord;
    diff: string;
    diffTruncated: boolean;
    workspaceSnapshotHash: string;
    testRun: TestRunRecord;
    criteria: string[];
    constraints: string[];
    prompt: string;
    signal: AbortSignal;
    previewDisclosure?: boolean;
    disclosureOperationId?: string;
  },
): Promise<
  | {
      kind: "review";
      providerId: ProviderId;
      modelId: string;
      result: ReviewResult;
      evidenceBundleJson: string;
    }
  | {
      kind: "disclosure";
      required: true;
      disclosure: Extract<
        Awaited<ReturnType<ProviderRuntime["prepareDisclosure"]>>,
        { required: true }
      >["disclosure"];
    }
> {
  const priorReviewCount = z
    .object({ count: z.number().int().nonnegative() })
    .parse(
      state.connection.sqlite
        .prepare(
          "SELECT count(*) AS count FROM reviews WHERE exercise_attempt_id = ?",
        )
        .get(input.attempt.id),
    ).count;
  const reviewPrompt = JSON.stringify({
    schemaVersion: 1,
    kind: "apt.review-evidence.v1",
    task: "Review the learner-authored change. Return only ReviewResult JSON.",
    exercise: {
      prompt: input.prompt,
      acceptanceCriteria: input.criteria,
      constraints: input.constraints,
    },
    workspace: {
      id: input.attempt.workspaceHandleId,
      generation: input.attempt.workspaceGeneration,
      sourceSnapshotHash: input.attempt.sourceSnapshotHash,
      inputSnapshotHash: input.workspaceSnapshotHash,
    },
    evidence: {
      priorReviewCount,
      gitDiff: input.diff,
      diffTruncated: input.diffTruncated,
      trustedCheck: {
        operationId: input.testRun.operationId,
        checkId: input.testRun.checkId,
        environmentId: input.testRun.environmentId,
        environmentPackDigest: input.testRun.environmentPackDigest,
        backendId: input.testRun.backendId,
        inputSnapshotHash: input.testRun.inputSnapshotHash,
        status: input.testRun.status,
        exitCode: input.testRun.exitCode,
        stdout: input.testRun.stdout,
        stderr: input.testRun.stderr,
        durationMs: input.testRun.durationMs,
        result:
          input.testRun.resultJson === null
            ? null
            : JSON.parse(input.testRun.resultJson),
      },
    },
  });
  if (input.previewDisclosure) {
    const preparation = await state.providerRuntime.prepareDisclosure({
      role: "reviewer",
      payload: reviewPrompt,
      payloadCategories: [
        "review-bundle",
        "learner-evidence",
        "workspace-diff",
      ],
      entityIds: {
        "exercise-attempt": input.attempt.id,
        "learning-session": input.attempt.sessionId,
      },
      exclusions: [
        "workspace files outside the complete diff",
        "protected answer keys",
      ],
      destinationPurpose: "evidence-only code review",
    });
    if (preparation.required) {
      return { kind: "disclosure", ...preparation };
    }
  }

  const dispatch = await state.providerRuntime.resolveDispatch({
    role: "reviewer",
    payload: reviewPrompt,
    ...(input.disclosureOperationId
      ? { disclosureOperationId: input.disclosureOperationId }
      : {}),
    metadata: {
      learningSessionId: input.attempt.sessionId,
      exerciseAttemptId: input.attempt.id,
      workspaceSnapshotHash: input.workspaceSnapshotHash,
    },
  });
  const providerId = dispatch.connection.adapterId;
  const { modelId, provider } = dispatch;
  const key = JSON.stringify([
    input.attempt.sessionId,
    "reviewer",
    dispatch.connection.connectionId,
    modelId,
  ]);
  let storedSession = state.providerSessions.get(key);
  let turnId: string | undefined;
  let terminalReason: "completed" | "failed" | "cancelled" | undefined;
  let providerStreamCompleted = false;
  let dispatchFinished = false;
  const finishDispatch = (
    status: "completed" | "failed" | "cancelled",
    failureCode: ReturnType<typeof providerFailureCode> | null,
  ) => {
    if (dispatchFinished) return;
    state.providerRuntime.finishDispatch(dispatch, status, failureCode);
    dispatchFinished = true;
  };
  const cancelTurn = async () => {
    if (storedSession) {
      await cancelAndEvictProviderSession(state, key, storedSession).catch(
        () => {
          if (storedSession) evictProviderSession(state, key, storedSession);
        },
      );
    }
  };

  try {
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
      if (
        session.providerId !== providerId ||
        session.role !== "reviewer" ||
        session.modelId !== modelId
      ) {
        await provider.cancelSession(session.id).catch(() => undefined);
        throw new ProviderHubError(
          "invalid_output",
          "Reviewer provider returned mismatched session metadata",
        );
      }
      const conversation = await state.repository.createConversation({
        learningSessionId: input.attempt.sessionId,
        role: "reviewer",
        providerId,
        modelId,
        providerSessionId: null,
      });
      storedSession = {
        providerId,
        provider,
        providerSessionId: session.id,
        conversationId: conversation.id,
      };
      state.providerSessions.set(key, storedSession);
    }

    await state.repository.addMessage({
      conversationId: storedSession.conversationId,
      role: "user",
      content: reviewPrompt,
    });
    let rawResponse = "";
    let messageCompleted = false;
    turnId = randomUUID();
    state.activeProviderTurns.set(turnId, { key, session: storedSession });
    for await (const event of state.providerRuntime.stream(
      dispatch,
      storedSession.providerSessionId,
      input.signal,
      "json",
    )) {
      switch (event.type) {
        case "message.delta":
          rawResponse += event.delta;
          break;
        case "message.completed":
          messageCompleted = true;
          rawResponse = event.content;
          break;
        case "session.completed":
          terminalReason = event.reason;
          break;
        case "tool.started":
        case "tool.completed":
          break;
        case "error":
          throw new ProviderHubError(
            "provider_error",
            "Reviewer provider returned an error",
          );
      }
    }
    providerStreamCompleted = true;
    if (terminalReason !== "completed" || !messageCompleted) {
      throw new ProviderHubError(
        terminalReason === "cancelled" ? "cancelled" : "invalid_output",
        "Reviewer provider did not return a complete result",
      );
    }
    const result = await parseReviewResult(rawResponse);
    await persistAgentResponse(state, {
      conversationId: storedSession.conversationId,
      content: JSON.stringify(result),
      status: "completed",
    });
    finishDispatch("completed", null);
    return {
      kind: "review",
      providerId,
      modelId,
      result,
      evidenceBundleJson: reviewPrompt,
    };
  } catch (error) {
    const cancelled =
      input.signal.aborted ||
      terminalReason === "cancelled" ||
      (error instanceof ProviderHubError && error.failure.code === "cancelled");
    if (providerStreamCompleted) {
      await cancelTurn();
    } else if (storedSession) {
      evictProviderSession(state, key, storedSession);
    }
    finishDispatch(
      cancelled ? "cancelled" : "failed",
      cancelled ? "cancelled" : providerFailureCode(error),
    );
    if (storedSession) {
      try {
        await persistAgentResponse(state, {
          conversationId: storedSession.conversationId,
          content: cancelled
            ? safeAgentCancellationMessage
            : safeAgentFailureMessage,
          status: cancelled ? "cancelled" : "failed",
        });
      } catch {
        // A transcript failure must not make an invalid review authoritative.
      }
    }
    throw new Error(
      cancelled ? safeAgentCancellationMessage : safeAgentFailureMessage,
      { cause: error },
    );
  } finally {
    if (turnId) {
      const active = state.activeProviderTurns.get(turnId);
      if (active?.session === storedSession) {
        state.activeProviderTurns.delete(turnId);
      }
    }
  }
}

async function persistAgentResponse(
  state: AppState,
  input: {
    conversationId: string;
    content: string;
    status: string;
    idempotencyKey?: string;
  },
): Promise<void> {
  await state.repository.addMessage({
    conversationId: input.conversationId,
    role: "assistant",
    content: input.content,
    status: input.status,
    ...(input.idempotencyKey === undefined
      ? {}
      : { idempotencyKey: input.idempotencyKey }),
  });
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
