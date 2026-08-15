import { createHash, randomUUID } from "node:crypto";
import { mkdir, realpath, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseReviewResult,
  ProviderHubError,
  type AgentProvider,
} from "@aptiloop/agent-core";
import {
  assertM1E2EDatabaseTarget,
  assertM1WritableDatabaseTarget,
  createCoursePackRepository,
  createCourseFoundationRepository,
  createLearningRepository,
  learnerCourseStateTriggerGuardMigrationContract,
  migrateDatabase,
  openDatabase,
  openM1WritableDatabase,
  withTransaction,
  type CourseFoundationRepository,
  type DatabaseConnection,
  type DatabaseMigrationAdmissionCapability,
  type LearningRepository,
  type M1DatabaseTargetValidation,
  type M1WritableDatabaseOpenOptions,
} from "@aptiloop/database";
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
} from "@aptiloop/exercise-core";
import { validateOpenCodeEndpoint } from "@aptiloop/opencode-provider/config";
import { getLatestPrompt } from "@aptiloop/prompt-library";
import {
  AgentRoleSchema,
  AptiloopAiRoleSchema,
  AptiloopToolNameSchema,
  type AptiloopToolName,
  type ReviewResult,
  type ProviderId,
} from "@aptiloop/shared";
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
  HttpRequestAdmission,
  RequestBodyAdmissionError,
  readBoundedRequestBody,
  requestWithReplayedBody,
  resolveHttpResourceLimits,
  responseWithRelease,
  responseWithTrackedWork,
  trackedWorkForResponse,
  type HttpResourceLimitOverrides,
} from "./http-resource-admission.js";
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
  hasAuthoritativeAcceptedReview,
  validateReviewResultAgainstEvidence,
} from "./review-authority.js";
import {
  ProviderRuntime,
  providerFailureCode,
  providerFailurePayload,
  type ProviderConnectionRetirement,
  type ProviderDispatch,
} from "./provider-runtime.js";
import {
  CreateProviderConnectionSchema,
  ProviderLoginAnswerSchema,
  ProviderManagementService,
  SetProviderApiKeySchema,
} from "./provider-management.js";
import { loadRootDevelopmentEnvironment } from "./root-environment.js";
import {
  tutorTurnMessageKey,
  tutorUnitMessagePrefix,
} from "./tutor-message-scope.js";

const sourceRoot = fileURLToPath(new URL("../../..", import.meta.url));
const defaultOpenCodeEndpoint = "http://127.0.0.1:4096";
const defaultWebOrigin = "http://127.0.0.1:3000";
const safeAgentFailureMessage =
  "The agent response was rejected by safety policy.";
const safeAgentCancellationMessage = "The agent turn was cancelled.";
const activeAgentTurnConflictMessage =
  "An agent turn is already active for this session, role, provider, and model.";
const exact0018StartupMigrationMessage =
  "Database is exactly at migration 0018_learner_course_state_trigger_guard and cannot start until migration 0019_provider_connection_retirement is explicitly authorized. Keep the application stopped, use an approved backup, then run `npm run db:migrate -- --authorize-current --approved-backup <path> --backup-sha256 <sha256>` from the repository root.";
const mutationMethods: Readonly<Record<string, true>> = {
  DELETE: true,
  PATCH: true,
  POST: true,
  PUT: true,
};
const knownClientFailurePrefixes = [
  "Course ",
  "Current ",
  "Evidence ",
  "Exercise ",
  "Learning ",
  "New ",
  "No ",
  "Only ",
  "Path ",
  "Persisted ",
  "Review ",
  "Session ",
  "Snapshot ",
  "Stored ",
  "Summary ",
  "This ",
  "Unit ",
  "Unknown ",
  "Versioned ",
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
  /** @internal Explicit development/test provider fixture. */
  developmentProviderFixture?: ConstructorParameters<
    typeof ProviderRuntime
  >[0]["developmentFixture"];
  /** @internal Explicit development/test database fixture initializer. */
  developmentDatabaseInitializer?: (connection: DatabaseConnection) => void;
  /** @internal Exact provider instances for disposable integration tests. */
  connectionProviders?: ReadonlyMap<string, AgentProvider>;
  /** @internal Trusted execution lifecycle seam for integration tests. */
  executionFabric?: TrustedExecutionFabric;
  exerciseAttemptsRoot?: string;
  startupConfig?: OrchestratorStartupConfig;
  httpResourceLimits?: HttpResourceLimitOverrides;
  /** @internal Deterministic HTTP admission seams for disposable tests. */
  httpAdmissionTestHooks?: {
    afterAcquire?: () => Promise<void> | void;
  };
  /** @internal Deterministic cancellation fence seams. */
  cancellationTestHooks?: {
    afterTrustedCheckRun?: () => Promise<void> | void;
    beforeReviewCommit?: () => Promise<void> | void;
  };
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
  bundleJson: string | null;
  bundleTestRunId: string | null;
  workspaceSnapshotHash: string | null;
  bundleDiffFingerprint: string | null;
  testRunId: string | null;
  testOperationId: string | null;
  testStatus: string | null;
  testCheckId: string | null;
  testEnvironmentId: string | null;
  testEnvironmentPackDigest: string | null;
  testBackendId: string | null;
  testInputSnapshotHash: string | null;
  testDiffFingerprint: string | null;
  testDiffTruncated: number | null;
}

interface ProviderSessionRecord {
  providerId: ProviderId;
  connectionId: string;
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
  providers: Partial<Record<ProviderId, AgentProvider>>;
  providerRuntime: ProviderRuntime;
  providerManagement: ProviderManagementService;
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
  activeExecutionOperations: Set<Promise<void>>;
  shuttingDown: boolean;
}
type BrowserAgentEvent =
  | { type: "message.delta"; turnId: string; content: string }
  | { type: "message.completed"; turnId: string; content: string }
  | {
      type: "tool.summary";
      turnId: string;
      name: AptiloopToolName;
      status: "started" | "completed";
    }
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
    uiLocale: z.enum(["en-US", "ru-RU"]).optional(),
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
    role: z.literal("teacher"),
    sessionId: z.string().trim().min(1).max(200),
    unitId: z.string().trim().min(1).max(200),
    message: z.string().trim().min(1).max(50_000),
    disclosureOperationId: z.string().trim().min(1).max(200).optional(),
  })
  .strict();
const disclosureRequestSchema = chatSchema.omit({
  disclosureOperationId: true,
});
export function createApp(options: AppOptions = {}) {
  const projectRoot = path.resolve(options.projectRoot ?? sourceRoot);
  loadRootDevelopmentEnvironment(projectRoot);
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
  const developmentMode = options.developmentMode === true;
  if (
    options.developmentDatabaseInitializer &&
    !developmentMode &&
    databaseMode !== "disposable"
  ) {
    throw new Error(
      "Development database fixtures require development or disposable test mode",
    );
  }
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
      if (
        writableConnection.migrationAdmission.contract.schemaSha256 ===
          learnerCourseStateTriggerGuardMigrationContract.schemaSha256 &&
        writableConnection.migrationAdmission.contract.migrationIds.length ===
          learnerCourseStateTriggerGuardMigrationContract.migrationIds.length &&
        writableConnection.migrationAdmission.contract.migrationIds.every(
          (id, index) =>
            id ===
            learnerCourseStateTriggerGuardMigrationContract.migrationIds[index],
        )
      ) {
        writableConnection.close();
        throw new Error(exact0018StartupMigrationMessage);
      }
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
  options.developmentDatabaseInitializer?.(connection);

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
  const httpResourceLimits = resolveHttpResourceLimits(
    options.httpResourceLimits,
  );
  const httpRequestAdmission = new HttpRequestAdmission(httpResourceLimits);
  if (options.httpAdmissionTestHooks && databaseMode !== "disposable") {
    throw new Error("HTTP admission test hooks require disposable mode");
  }
  const courseDesignerTools = createCourseDesignerTools(connection);
  const providers = { ...options.providers };
  const connectionProviders = new Map<string, AgentProvider>(
    options.connectionProviders,
  );
  const providerManagement = new ProviderManagementService({
    connection,
    repository,
    projectRoot:
      databaseMode === "disposable" ? path.dirname(databasePath) : projectRoot,
    connectionProviders,
    toolsForRole: courseDesignerTools,
  });
  const providerRuntime = new ProviderRuntime({
    connection,
    providers,
    connectionProviders,
    ensureProviders: () => providerManagement.ensureLoaded(),
    developmentMode,
    ...(options.developmentProviderFixture
      ? { developmentFixture: options.developmentProviderFixture }
      : {}),
  });
  const npmTest = npmTestCommand();
  const executionFabric =
    options.executionFabric ??
    createCoreExecutionFabric({
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
    developmentMode,
    providers,
    providerRuntime,
    providerManagement,
    providerSessions: new Map(),
    activeProviderTurns: new Map(),
    activeProviderTurnReservations: new Map(),
    interviewReservations: {
      start: false,
      interviewIds: new Set(),
    },
    activeExecutionOperations: new Set(),
    shuttingDown: false,
  };
  const app = new Hono();

  app.onError((error, context) => {
    const unknownError: unknown = error;
    if (unknownError instanceof LegacyLearningMutationError) {
      return context.json(legacyLearningMutationError, 410);
    }
    if (unknownError instanceof ProviderHubError) {
      const status =
        unknownError.failure.code === "disclosure_required" ||
        unknownError.failure.code === "disclosure_mismatch" ||
        unknownError.failure.code === "ai_disabled"
          ? 409
          : unknownError.failure.retryable
            ? 503
            : 400;
      return context.json(providerFailurePayload(unknownError), status);
    }
    if (isMalformedJsonError(unknownError)) {
      return context.json({ error: "Invalid JSON request body" }, 400);
    }
    if (unknownError instanceof z.ZodError) {
      return context.json({ error: "Request body is invalid" }, 400);
    }
    if (unknownError instanceof CourseSessionContextError) {
      return context.json({ error: unknownError.message }, 409);
    }
    if (
      unknownError instanceof Error &&
      (unknownError.message === safeAgentFailureMessage ||
        unknownError.message === safeAgentCancellationMessage ||
        isKnownClientFailure(unknownError.message))
    ) {
      const status = /^unknown\b|\bnot found\b/iu.test(unknownError.message)
        ? 404
        : 400;
      return context.json({ error: unknownError.message }, status);
    }
    const diagnosticId = randomUUID();
    console.error("orchestrator_request_failed", {
      diagnosticId,
      errorName:
        unknownError instanceof Error ? unknownError.name : "NonErrorThrown",
    });
    return context.json({ error: "Internal server error", diagnosticId }, 500);
  });

  app.use("/api/*", async (context, next) => {
    context.header("Cache-Control", "no-store");
    if (state.shuttingDown) {
      return context.json({ error: "Orchestrator is shutting down" }, 503);
    }
    const boundaryError = apiRequestBoundaryError(
      context.req.raw,
      apiRequestBoundary,
    );
    if (boundaryError) return context.json({ error: boundaryError }, 400);

    const isMutation =
      mutationMethods[context.req.method.toUpperCase()] === true;
    if (isMutation && context.req.header("X-Aptiloop-Client") !== "web") {
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

    const requestClass =
      context.req.path === "/api/agent/stream" ? "stream" : "request";
    const releaseAdmission = httpRequestAdmission.tryAcquire(requestClass);
    if (!releaseAdmission) {
      context.header(
        "Retry-After",
        String(httpResourceLimits.retryAfterSeconds),
      );
      return context.json({ error: "HTTP request capacity is exhausted" }, 429);
    }

    const release = releaseAdmission;
    let responseOwnsAdmission = false;
    try {
      await options.httpAdmissionTestHooks?.afterAcquire?.();
      if (isMutation && context.req.path !== "/api/course-packs/validate") {
        try {
          const body = await readBoundedRequestBody(
            context.req.raw,
            httpResourceLimits.maxRequestBodyBytes,
          );
          context.req.raw = requestWithReplayedBody(context.req.raw, body);
        } catch (error) {
          if (error instanceof RequestBodyAdmissionError) {
            return context.json({ error: error.message }, error.status);
          }
          throw error;
        }
      }
      await next();
      if (
        requestClass === "stream" &&
        context.res.headers
          .get("Content-Type")
          ?.toLowerCase()
          .startsWith("text/event-stream")
      ) {
        const trackedWork = trackedWorkForResponse(context.res);
        if (trackedWork) {
          void trackedWork.then(release, release);
        } else {
          context.res = responseWithRelease(context.res, release);
        }
        responseOwnsAdmission = true;
      }
    } finally {
      if (!responseOwnsAdmission) release();
    }
  });

  app.get("/health/ready", (context) =>
    state.shuttingDown
      ? context.json({ status: "stopping", database: "connected" }, 503)
      : context.json({ status: "ready", database: "connected" }),
  );

  app.post("/api/ai/disclosures", async (context) => {
    const body = disclosureRequestSchema.parse(await context.req.json());
    const admission = await tutorLessonScopeAdmission(state, body, true);
    if ("rejection" in admission) {
      return context.json(
        { error: admission.rejection.error },
        admission.rejection.status,
      );
    }
    const preparation = await state.providerRuntime.prepareDisclosure({
      role: body.role,
      payload: admission.payload,
      payloadCategories: [
        "course-content",
        "learner-message",
        "learner-evidence",
      ],
      entityIds: admission.entityIds,
      destinationPurpose: "lesson-scoped Tutor assistance",
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

  app.get("/api/dashboard", (context) =>
    context.json(
      { error: "Legacy dashboard retired; use /api/home and /api/courses" },
      410,
    ),
  );

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
    const admission = await tutorLessonScopeAdmission(state, body, true);
    if ("rejection" in admission) {
      return context.json(
        { error: admission.rejection.error },
        admission.rejection.status,
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
    let inspection: Awaited<ReturnType<ProviderRuntime["inspectRole"]>>;
    try {
      inspection = await state.providerRuntime.inspectRole(
        body.role,
        requestSignal,
      );
    } catch (error) {
      requestSignal.removeEventListener("abort", onSetupAbort);
      if (
        setupAborted ||
        requestSignal.aborted ||
        (error instanceof DOMException && error.name === "AbortError")
      ) {
        return context.json({ error: safeAgentCancellationMessage }, 409);
      }
      throw error;
    }
    const providerId = inspection.connection.adapterId;
    const modelId = inspection.modelId;
    const reservationKey = JSON.stringify([
      body.sessionId,
      body.unitId,
      body.role,
      inspection.connection.connectionId,
      modelId,
    ]);
    const turnId = randomUUID();
    const useFreshProviderSession = inspection.connection.external;
    const key = useFreshProviderSession
      ? JSON.stringify([reservationKey, turnId])
      : reservationKey;
    const setupUserMessageIdempotencyKey = tutorTurnMessageKey(
      body.unitId,
      turnId,
      "user",
    );
    const setupAssistantMessageIdempotencyKey = tutorTurnMessageKey(
      body.unitId,
      turnId,
      "assistant",
    );
    if (state.activeProviderTurnReservations.has(reservationKey)) {
      return context.json({ error: activeAgentTurnConflictMessage }, 409);
    }
    state.activeProviderTurnReservations.set(reservationKey, turnId);

    let storedSession: ProviderSessionRecord | undefined;
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
      dispatchFinished = true;
      state.providerRuntime.finishDispatch(dispatch, status, failureCode);
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
                persistAgentResponse(state, {
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
            if (createdConversationId && !reusedSessionRecord) {
              state.connection.sqlite
                .prepare("DELETE FROM agent_conversations WHERE id = ?")
                .run(createdConversationId);
            }
          } finally {
            releaseAgentTurnReservation(state, reservationKey, turnId);
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
        payload: admission.payload,
        signal: requestSignal,
        ...(body.disclosureOperationId
          ? { disclosureOperationId: body.disclosureOperationId }
          : {}),
        metadata: {
          learningSessionId: body.sessionId,
          learningUnitId: body.unitId,
        },
      });
      const { provider } = dispatch;
      const connectionId = dispatch.connection.connectionId;
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
        try {
          await state.providerRuntime.runSetup(async (setupSignal) => {
            setupSignal.throwIfAborted();
            state.repository.addMessage({
              conversationId: existingSession.conversationId,
              role: "user",
              content: body.message,
              idempotencyKey: setupUserMessageIdempotencyKey,
            });
            setupSignal.throwIfAborted();
          }, requestSignal);
        } catch (error) {
          if (requestSignal.aborted) setupAborted = true;
          await cleanupFailedSetup();
          throw error;
        }
      } else {
        await state.providerRuntime
          .runOwnedSetup(
            (signal) =>
              provider.createSession(
                {
                  role: body.role,
                  modelId,
                  systemPrompt: getLatestPrompt(body.role).systemPrompt,
                  metadata: {
                    learningSessionId: body.sessionId,
                    learningUnitId: body.unitId,
                  },
                },
                signal,
              ),
            requestSignal,
            (session) => provider.cancelSession(session.id),
            async (ownedSession, setupSignal) => {
              try {
                if (
                  ownedSession.providerId !== providerId ||
                  ownedSession.role !== body.role ||
                  ownedSession.modelId !== modelId
                ) {
                  throw new Error(safeAgentFailureMessage);
                }
                createdProviderSession = {
                  provider,
                  providerSessionId: ownedSession.id,
                };
                setupSignal.throwIfAborted();
                const conversation = await state.repository.createConversation({
                  learningSessionId: body.sessionId,
                  role: body.role,
                  providerId,
                  modelId,
                  providerSessionId: null,
                });
                createdConversationId = conversation.id;
                setupSignal.throwIfAborted();
                state.repository.addMessage({
                  conversationId: conversation.id,
                  role: "user",
                  content: body.message,
                  idempotencyKey: setupUserMessageIdempotencyKey,
                });
                setupSignal.throwIfAborted();
                const adoptedSession: ProviderSessionRecord = {
                  providerId,
                  connectionId,
                  provider,
                  providerSessionId: ownedSession.id,
                  conversationId: conversation.id,
                };
                storedSession = adoptedSession;
                createdSessionRecord = adoptedSession;
                state.providerSessions.set(key, adoptedSession);
              } catch (error) {
                if (setupSignal.aborted) setupAborted = true;
                try {
                  if (createdConversationId) {
                    state.connection.sqlite
                      .prepare("DELETE FROM agent_conversations WHERE id = ?")
                      .run(createdConversationId);
                  }
                } finally {
                  createdConversationId = undefined;
                  createdProviderSession = undefined;
                  createdSessionRecord = undefined;
                }
                throw error;
              }
            },
          )
          .catch((error: unknown) => {
            if (
              setupAborted ||
              requestSignal.aborted ||
              (error instanceof DOMException && error.name === "AbortError")
            ) {
              throw new Error(safeAgentCancellationMessage);
            }
            throw new Error(safeAgentFailureMessage);
          });
        if (setupAborted || requestSignal.aborted) {
          throw new Error(safeAgentCancellationMessage);
        }
      }
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

    const activeSession = storedSession;
    if (!activeSession) {
      requestSignal.removeEventListener("abort", onSetupAbort);
      await cleanupFailedSetup();
      finishDispatch("failed", "provider_error");
      throw new ProviderHubError(
        "provider_error",
        "Provider session was not adopted",
      );
    }
    const providerSessionId = activeSession.providerSessionId;
    const conversationId = activeSession.conversationId;
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
      context.header("X-Aptiloop-Agent-Turn-Id", turnId);
      state.activeProviderTurns.set(turnId, { key, session: activeSession });
      let finishResponseWork!: () => void;
      const responseWork = new Promise<void>((resolve) => {
        finishResponseWork = resolve;
      });
      const response = streamSSE(context, async (stream) => {
        let assistantContent = "";
        let terminalReason: "completed" | "failed" | "cancelled" | undefined;
        let status: "completed" | "failed" | "cancelled" = "failed";
        let messageCompleted = false;
        let completedClientEvent: BrowserAgentEvent | undefined;
        const activeToolSummaries = new Map<string, AptiloopToolName>();
        let responsePersisted = false;
        let providerStreamCompleted = false;
        const persistResponse = () => {
          persistAgentResponse(state, {
            conversationId,
            content: assistantContent,
            status,
            idempotencyKey: setupAssistantMessageIdempotencyKey,
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
            "text",
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
                if (activeToolSummaries.size > 0) {
                  throw new ProviderHubError(
                    "invalid_output",
                    safeAgentFailureMessage,
                  );
                }
                terminalReason = event.reason;
                if (event.reason === "failed") {
                  throw new Error(safeAgentFailureMessage);
                }
                continue;
              case "tool.started": {
                const name = AptiloopToolNameSchema.safeParse(event.toolName);
                if (
                  !name.success ||
                  activeToolSummaries.has(event.toolCallId)
                ) {
                  throw new ProviderHubError(
                    "invalid_output",
                    safeAgentFailureMessage,
                  );
                }
                activeToolSummaries.set(event.toolCallId, name.data);
                clientEvent = {
                  type: "tool.summary",
                  turnId,
                  name: name.data,
                  status: "started",
                };
                break;
              }
              case "tool.completed": {
                const name = AptiloopToolNameSchema.safeParse(event.toolName);
                const startedName = activeToolSummaries.get(event.toolCallId);
                if (!name.success || startedName !== name.data) {
                  throw new ProviderHubError(
                    "invalid_output",
                    safeAgentFailureMessage,
                  );
                }
                activeToolSummaries.delete(event.toolCallId);
                clientEvent = {
                  type: "tool.summary",
                  turnId,
                  name: name.data,
                  status: "completed",
                };
                break;
              }
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
            evictProviderSession(state, key, activeSession);
          } else if (terminalReason === "completed") {
            if (!messageCompleted) throw new Error(safeAgentFailureMessage);
            status = "completed";
          } else {
            throw new Error(safeAgentFailureMessage);
          }

          state.providerRuntime.assertDispatchCommitAllowed(activeDispatch);
          persistResponse();
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
              activeSession,
            ).catch(() => evictProviderSession(state, key, activeSession));
          } else {
            evictProviderSession(state, key, activeSession);
          }
          finishDispatch(
            status,
            cancelled ? "cancelled" : providerFailureCode(error),
          );

          let persistenceFailed = false;
          if (!responsePersisted) {
            try {
              persistResponse();
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
          if (activeTurn?.session === activeSession) {
            state.activeProviderTurns.delete(turnId);
          }
          if (
            useFreshProviderSession &&
            state.providerSessions.get(key) === activeSession
          ) {
            await cancelAndEvictProviderSession(
              state,
              key,
              activeSession,
            ).catch(() => evictProviderSession(state, key, activeSession));
          } else if (status !== "completed") {
            evictProviderSession(state, key, activeSession);
          }
          releaseAgentTurnReservation(state, reservationKey, turnId);
          finishResponseWork();
        }
      });
      return responseWithTrackedWork(response, responseWork);
    } catch (error) {
      requestSignal.removeEventListener("abort", onSetupAbort);
      const activeTurn = state.activeProviderTurns.get(turnId);
      if (activeTurn?.session === activeSession) {
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
    const sessionId = z
      .string()
      .trim()
      .min(1)
      .parse(context.req.query("sessionId"));
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
      lessonContext: versioned?.lessonContext ?? null,
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
    if (state.shuttingDown) {
      return context.json({ error: "Orchestrator is shutting down" }, 503);
    }
    const finishExecutionOperation = beginActiveExecutionOperation(state);
    try {
      const attempt = await requireAttempt(
        state,
        context.req.param("id"),
        true,
      );
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
        await options.cancellationTestHooks?.afterTrustedCheckRun?.();
        context.req.raw.signal.throwIfAborted();
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
        withTransaction(state.connection, () => {
          context.req.raw.signal.throwIfAborted();
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
        const cancelled = context.req.raw.signal.aborted;
        const message = cancelled
          ? "Trusted check was cancelled"
          : error instanceof Error
            ? error.message
            : "Trusted check runner failed";
        state.connection.sqlite
          .prepare(
            `UPDATE test_runs
           SET status = ?, stderr = ?, result_json = ?,
               completed_at = ?
           WHERE id = ? AND status = 'running'`,
          )
          .run(
            cancelled ? "cancelled" : "backend_error",
            message,
            JSON.stringify({
              ...runningResult,
              status: cancelled ? "cancelled" : "backend_error",
              error: message,
            }),
            Date.now(),
            testRunId,
          );
        if (cancelled) {
          return context.json(
            {
              id: testRunId,
              output: message,
              exitCode: 1,
              status: "cancelled",
              operationId: body.operationId,
              result: {
                ...runningResult,
                status: "cancelled",
                error: message,
              },
            },
            400,
          );
        }
        throw error;
      }
    } finally {
      finishExecutionOperation();
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
        `SELECT r.id, r.status AS reviewStatus,
                r.exercise_attempt_id AS exerciseAttemptId,
                r.result_json AS resultJson, b.id AS bundleId,
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
         WHERE r.operation_id = ? LIMIT 1`,
      )
      .get(body.operationId) as
      | {
          id: string;
          reviewStatus: string;
          exerciseAttemptId: string | null;
          resultJson: string | null;
          bundleId: string | null;
          bundleSha256: string | null;
          bundleJson: string | null;
          bundleTestRunId: string | null;
          bundleWorkspaceSnapshotHash: string | null;
          bundleDiffFingerprint: string | null;
          testRunId: string | null;
          testOperationId: string | null;
          testStatus: string | null;
          testCheckId: string | null;
          testEnvironmentId: string | null;
          testEnvironmentPackDigest: string | null;
          testBackendId: string | null;
          testInputSnapshotHash: string | null;
          testDiffFingerprint: string | null;
          testDiffTruncated: number | null;
        }
      | undefined;
    if (prior) {
      if (prior.exerciseAttemptId !== attempt.id || !prior.resultJson) {
        return context.json(
          { error: "Operation ID has already been used for another review" },
          409,
        );
      }
      const [currentDiff, currentSnapshot] = await Promise.all([
        getExerciseDiff(attempt.workspacePath, {
          expectedBaselineHash: attempt.baselineHash,
        }),
        snapshotCompleteWorkspace(attempt.workspacePath),
      ]);
      context.req.raw.signal.throwIfAborted();
      const currentDiffFingerprint = fingerprintExerciseDiff(currentDiff);
      const completionEligible = hasAuthoritativeAcceptedReview({
        ...prior,
        resultJson: prior.resultJson,
      });
      if (
        !completionEligible ||
        currentDiff.truncated ||
        currentDiffFingerprint === null ||
        currentDiffFingerprint !== prior.bundleDiffFingerprint ||
        currentSnapshot.contentHash !== prior.bundleWorkspaceSnapshotHash
      ) {
        return context.json(
          { error: "Review operation evidence is stale for current workspace" },
          409,
        );
      }
      return context.json({
        id: prior.id,
        ...JSON.parse(prior.resultJson),
        completionEligible,
        evidenceBundle: prior.bundleId
          ? {
              id: prior.bundleId,
              sha256: prior.bundleSha256,
              workspaceSnapshotHash: prior.bundleWorkspaceSnapshotHash,
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
      operationId: body.operationId,
      diff: before.patch,
      diffTruncated: before.truncated,
      workspaceSnapshotHash: beforeSnapshot.contentHash,
      testRun: latestTest,
      criteria: exercise.criteria,
      constraints: exercise.constraints,
      prompt: exercise.prompt,
      approvedTopicIds: exercise.topics,
      signal: context.req.raw.signal,
      ...(body.previewDisclosure ? { previewDisclosure: true } : {}),
      ...(body.disclosureOperationId
        ? { disclosureOperationId: body.disclosureOperationId }
        : {}),
    });
    if (review.kind === "disclosure") {
      return context.json(review, 202);
    }
    try {
      await options.cancellationTestHooks?.beforeReviewCommit?.();
      context.req.raw.signal.throwIfAborted();
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
      withTransaction(state.connection, () => {
        context.req.raw.signal.throwIfAborted();
        review.persistCompletedAssistant();
        context.req.raw.signal.throwIfAborted();
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
            review.authorityStatus,
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
        context.req.raw.signal.throwIfAborted();
      });
      await review.finishCompleted();
      return context.json({
        id: reviewId,
        ...review.result,
        completionEligible: review.authorityStatus === "accepted",
        evidenceBundle: {
          id: bundleId,
          sha256: evidenceSha256,
          workspaceSnapshotHash: beforeSnapshot.contentHash,
        },
      });
    } catch (error) {
      return await review.fail(error);
    }
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

  app.get("/api/knowledge", (context) =>
    context.redirect("/api/learning/skills", 308),
  );
  app.get("/api/mistakes", (context) =>
    context.redirect("/api/learning/mistakes", 308),
  );
  app.get("/api/flashcards", (context) =>
    context.redirect("/api/learning/reviews", 308),
  );
  app.patch("/api/flashcards/:id", (context) =>
    context.json(
      {
        error:
          "Legacy flashcard mutation is retired; use the deterministic Review workflow",
      },
      410,
    ),
  );
  app.get("/api/flashcards/export", (context) =>
    context.json(
      {
        error:
          "Legacy flashcard export is retired; use the deterministic Review workflow",
      },
      410,
    ),
  );

  app.get("/api/settings", async (context) => {
    const settings = await readSettings(state);
    const [ai, management] = await Promise.all([
      state.providerRuntime.settings(),
      state.providerManagement.describe(),
    ]);
    return context.json({ ...settings, ai: { ...ai, management } });
  });

  app.put("/api/settings", async (context) => {
    const settings = settingsMutationSchema.parse(await context.req.json());
    await state.repository.setSettings([
      ["theme", settings.theme],
      ...(settings.uiLocale
        ? ([["uiLocale", settings.uiLocale]] as const)
        : []),
    ]);
    return context.json(
      settings.uiLocale
        ? { saved: true, uiLocale: settings.uiLocale }
        : { saved: true },
    );
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
  app.post("/api/settings/ai/connections", async (context) => {
    try {
      const input = CreateProviderConnectionSchema.parse(
        await context.req.json(),
      );
      const connection = await state.providerManagement.create(input);
      return context.json({ created: true, connection }, 201);
    } catch (error) {
      return context.json({ error: safeProviderManagementMessage(error) }, 400);
    }
  });
  app.put(
    "/api/settings/ai/connections/:connectionId/credential",
    async (context) => {
      try {
        const { apiKey } = SetProviderApiKeySchema.parse(
          await context.req.json(),
        );
        await state.providerManagement.setApiKey(
          context.req.param("connectionId"),
          apiKey,
        );
        return context.json({ saved: true });
      } catch (error) {
        return context.json(
          { error: safeProviderManagementMessage(error) },
          400,
        );
      }
    },
  );
  app.post(
    "/api/settings/ai/connections/:connectionId/disable",
    async (context) => {
      try {
        await state.providerManagement.disable(
          context.req.param("connectionId"),
        );
        return context.json({ disabled: true });
      } catch (error) {
        return context.json(
          { error: safeProviderManagementMessage(error) },
          400,
        );
      }
    },
  );
  app.delete("/api/settings/ai/connections/:connectionId", async (context) => {
    const connectionId = context.req.param("connectionId");
    let retirement: ProviderConnectionRetirement | undefined;
    try {
      retirement =
        state.providerRuntime.beginConnectionRetirement(connectionId);
      await state.providerManagement.remove(connectionId);
      retirement.commit();
      retirement = undefined;
      await cancelProviderSessionsForConnection(state, connectionId);
      return context.json({ removed: true });
    } catch (error) {
      const status =
        error instanceof ProviderHubError &&
        error.failure.code === "connection_disabled"
          ? 409
          : 400;
      return context.json(
        { error: safeProviderManagementMessage(error) },
        status,
      );
    } finally {
      retirement?.rollback();
    }
  });
  app.post(
    "/api/settings/ai/connections/:connectionId/enable",
    async (context) => {
      try {
        await state.providerManagement.enableLocal(
          context.req.param("connectionId"),
        );
        return context.json({ enabled: true });
      } catch (error) {
        return context.json(
          { error: safeProviderManagementMessage(error) },
          400,
        );
      }
    },
  );
  app.post(
    "/api/settings/ai/connections/:connectionId/login",
    async (context) => {
      try {
        const operationId = await state.providerManagement.startLogin(
          context.req.param("connectionId"),
        );
        return context.json({ started: true, operationId }, 202);
      } catch (error) {
        return context.json(
          { error: safeProviderManagementMessage(error) },
          400,
        );
      }
    },
  );
  app.get("/api/settings/ai/login/:operationId", (context) => {
    try {
      return context.json(
        state.providerManagement.loginStatus(context.req.param("operationId")),
      );
    } catch (error) {
      return context.json({ error: safeProviderManagementMessage(error) }, 404);
    }
  });
  app.post("/api/settings/ai/login/:operationId/answer", async (context) => {
    try {
      const answer = ProviderLoginAnswerSchema.parse(await context.req.json());
      state.providerManagement.answerLogin(
        context.req.param("operationId"),
        answer.promptId,
        answer.answer,
      );
      return context.json({ accepted: true });
    } catch (error) {
      return context.json({ error: safeProviderManagementMessage(error) }, 400);
    }
  });
  app.post("/api/settings/ai/login/:operationId/cancel", (context) => {
    state.providerManagement.cancelLogin(context.req.param("operationId"));
    return context.json({ cancelled: true });
  });

  let closePromise: Promise<void> | null = null;
  const beginShutdown = () => {
    if (state.shuttingDown) return;
    state.shuttingDown = true;
    httpRequestAdmission.beginShutdown();
    state.executionFabric.beginShutdown();
    state.providerRuntime.beginShutdown();
    state.providerManagement.beginShutdown();
  };
  return {
    app,
    state,
    beginShutdown,
    close: () => {
      closePromise ??= (async () => {
        beginShutdown();
        await Promise.all([
          state.executionFabric.close(),
          state.providerRuntime.close(),
          state.providerManagement.close(),
        ]);
        await drainActiveExecutionOperations(state);
        // Runtime shutdown settles active provider work first. Any remaining
        // cached sessions are then cancelled exactly once while SQLite is open,
        // before admitted HTTP handlers and response producers are drained.
        await cancelAndEvictProviderSessions(state);
        await httpRequestAdmission.drain();
        const providers = Object.values(state.providers);
        await Promise.allSettled(
          providers.map((provider) =>
            "shutdown" in provider && typeof provider.shutdown === "function"
              ? provider.shutdown()
              : Promise.resolve(),
          ),
        );
        connection.close();
      })();
      return closePromise;
    },
  };
}

async function drainActiveExecutionOperations(state: AppState): Promise<void> {
  const active = [...state.activeExecutionOperations];
  if (active.length === 0) return;
  const drained = Promise.allSettled(active).then(() => undefined);
  const timeout = new Promise<never>((_, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Active trusted execution shutdown timed out")),
      5_000,
    );
    timer.unref();
    void drained.finally(() => clearTimeout(timer));
  });
  await Promise.race([drained, timeout]);
}

async function cancelAndEvictProviderSessions(state: AppState): Promise<void> {
  const sessions = [...state.providerSessions.entries()];
  if (sessions.length === 0) return;
  await Promise.allSettled(
    sessions.map(([key, session]) =>
      cancelAndEvictProviderSession(state, key, session),
    ),
  );
}

function beginActiveExecutionOperation(state: AppState): () => void {
  let finish!: () => void;
  const operation = new Promise<void>((resolve) => {
    finish = resolve;
  });
  state.activeExecutionOperations.add(operation);
  return () => {
    if (!state.activeExecutionOperations.delete(operation)) return;
    finish();
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

function isKnownClientFailure(message: string): boolean {
  return knownClientFailurePrefixes.some((prefix) =>
    message.startsWith(prefix),
  );
}

function isMalformedJsonError(error: unknown): error is SyntaxError {
  return (
    error instanceof SyntaxError &&
    ("cause" in error || /\bJSON\b/iu.test(error.message))
  );
}

interface TutorLessonScopeInput {
  readonly role: "teacher";
  readonly sessionId: string;
  readonly unitId: string;
  readonly message: string;
}

type TutorLessonScopeAdmission =
  | {
      readonly payload: string;
      readonly entityIds: Readonly<Record<string, string>>;
    }
  | {
      readonly rejection: {
        readonly status: 404 | 409;
        readonly error: string;
      };
    };

async function tutorLessonScopeAdmission(
  state: AppState,
  input: TutorLessonScopeInput,
  includePriorDialogue: boolean,
): Promise<TutorLessonScopeAdmission> {
  let requested: Awaited<ReturnType<LearningRepository["getVersionedSession"]>>;
  try {
    requested = await state.repository.getVersionedSession(input.sessionId);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith("Unknown versioned learning session:")
    ) {
      return { rejection: { status: 404, error: error.message } };
    }
    throw error;
  }
  if (requested.session.status !== "active") {
    return {
      rejection: {
        status: 409,
        error: "Tutor turns require an active versioned learning session",
      },
    };
  }
  try {
    assertCourseScopedSessionSideEffectAllowed(
      state.connection,
      requested.session.id,
    );
  } catch (error) {
    if (error instanceof CourseSessionContextError) {
      return { rejection: { status: 409, error: error.message } };
    }
    throw error;
  }

  const unit = requested.snapshot.units.find(
    (candidate) => candidate.id === input.unitId,
  );
  if (!unit) {
    return {
      rejection: {
        status: 404,
        error: "Tutor unit does not belong to this session snapshot",
      },
    };
  }
  if (unit.payload.type !== "teacher-dialogue") {
    return {
      rejection: {
        status: 409,
        error: "Tutor turns require a teacher-dialogue unit",
      },
    };
  }
  const progress = requested.unitProgress.find(
    (candidate) => candidate.unitId === unit.id,
  );
  if (
    !progress ||
    progress.unitType !== "teacher-dialogue" ||
    progress.status !== "in_progress"
  ) {
    return {
      rejection: {
        status: 409,
        error: "Tutor turns require an in-progress teacher-dialogue unit",
      },
    };
  }

  const sessionContext =
    await state.courseFoundationRepository.getSessionContext(
      requested.session.id,
    );
  if (!sessionContext) {
    return {
      rejection: {
        status: 409,
        error: "Tutor session is missing immutable Course context",
      },
    };
  }
  const priorDialogue = includePriorDialogue
    ? readBoundedTutorDialogue(state, input.sessionId, input.unitId)
    : [];
  const payload = JSON.stringify({
    schemaVersion: 1,
    task: "answer-within-lesson-scope",
    scope: {
      course: {
        id: sessionContext.courseId,
        revisionId: sessionContext.revisionId,
        title: requested.snapshot.curriculumTitle,
      },
      lesson: {
        id: sessionContext.lessonId,
        order: requested.snapshot.day.order,
        title: requested.snapshot.day.title,
        description: requested.snapshot.day.description,
        goal: requested.snapshot.day.goal,
        depthLevel: requested.snapshot.day.depthLevel,
        expectedOutcomes: requested.snapshot.day.expectedOutcomes,
        topics: requested.snapshot.day.topics,
        outOfScope: requested.snapshot.day.outOfScope,
      },
      unit: {
        id: unit.id,
        stableId: unit.stableId,
        title: unit.title,
        description: unit.description,
        objectives: unit.objectives,
        depthLevel: unit.depthLevel,
        openingPrompt: unit.payload.openingPrompt,
      },
    },
    priorDialogue,
    learnerMessage: input.message,
  });
  return {
    payload,
    entityIds: {
      course: sessionContext.courseId,
      revision: sessionContext.revisionId,
      lesson: sessionContext.lessonId,
      "learning-session": requested.session.id,
      "learning-unit": unit.id,
    },
  };
}

function readBoundedTutorDialogue(
  state: AppState,
  sessionId: string,
  unitId: string,
): readonly { readonly role: "learner" | "tutor"; readonly content: string }[] {
  const rows = state.connection.sqlite
    .prepare(
      `SELECT message.role, message.content
       FROM agent_messages message
       JOIN agent_conversations conversation
         ON conversation.id = message.conversation_id
       WHERE conversation.learning_session_id = ?
         AND conversation.role = 'teacher'
         AND message.status = 'completed'
         AND message.role IN ('user', 'assistant')
         AND message.idempotency_key LIKE ? ESCAPE '\\'
       ORDER BY message.created_at DESC, message.sequence DESC
       LIMIT 20`,
    )
    .all(sessionId, `${tutorUnitMessagePrefix(unitId)}%`) as Array<{
    role: "user" | "assistant";
    content: string;
  }>;
  return rows.reverse().map((row) => ({
    role: row.role === "user" ? "learner" : "tutor",
    content: row.content,
  }));
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
    state.providerRuntime.releaseSession(session.providerSessionId);
  }
  for (const [turnId, activeTurn] of state.activeProviderTurns) {
    if (activeTurn.session === session) {
      state.activeProviderTurns.delete(turnId);
    }
  }
}

async function cancelProviderSessionsForConnection(
  state: AppState,
  connectionId: string,
): Promise<void> {
  const matches = [...state.providerSessions.entries()].filter(
    ([, session]) => session.connectionId === connectionId,
  );
  await Promise.allSettled(
    matches.map(([key, session]) =>
      cancelAndEvictProviderSession(state, key, session),
    ),
  );
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
  lessonContext: {
    courseId: string;
    revisionId: string;
    courseTitle: string;
    lessonOrder: number;
    lessonTitle: string;
  };
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
  const persistedContext =
    await state.courseFoundationRepository.getSessionContext(sessionId);
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
    lessonContext: {
      courseId: persistedContext?.courseId ?? detail.snapshot.curriculumId,
      revisionId:
        persistedContext?.revisionId ?? detail.snapshot.curriculumVersionId,
      courseTitle: detail.snapshot.curriculumTitle,
      lessonOrder: detail.snapshot.day.order,
      lessonTitle: detail.snapshot.day.title,
    },
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
    completionEligible: boolean;
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
      const completionEligible = hasAuthoritativeAcceptedReview({
        reviewStatus: latestReviewRecord.status,
        resultJson: latestReviewRecord.resultJson,
        bundleSha256: latestReviewRecord.evidenceSha256,
        bundleJson: latestReviewRecord.bundleJson,
        bundleTestRunId: latestReviewRecord.bundleTestRunId,
        bundleWorkspaceSnapshotHash: latestReviewRecord.workspaceSnapshotHash,
        bundleDiffFingerprint: latestReviewRecord.bundleDiffFingerprint,
        testRunId: latestReviewRecord.testRunId,
        testOperationId: latestReviewRecord.testOperationId,
        testStatus: latestReviewRecord.testStatus,
        testCheckId: latestReviewRecord.testCheckId,
        testEnvironmentId: latestReviewRecord.testEnvironmentId,
        testEnvironmentPackDigest: latestReviewRecord.testEnvironmentPackDigest,
        testBackendId: latestReviewRecord.testBackendId,
        testInputSnapshotHash: latestReviewRecord.testInputSnapshotHash,
        testDiffFingerprint: latestReviewRecord.testDiffFingerprint,
        testDiffTruncated: latestReviewRecord.testDiffTruncated,
      });
      if (completionEligible) {
        latestReview = {
          id: latestReviewRecord.id,
          status: parsed.status,
          completionEligible,
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
              b.bundle_json AS bundleJson,
              b.test_run_id AS bundleTestRunId,
              b.workspace_snapshot_hash AS workspaceSnapshotHash,
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
function redactAttemptWorkspacePath<T>(value: T, workspacePath: string): T {
  const pathVariants = new Set([
    workspacePath,
    workspacePath.replaceAll("\\", "/"),
    workspacePath.replaceAll("/", "\\"),
  ]);
  const visit = (current: unknown): unknown => {
    if (typeof current === "string") {
      let redacted = current;
      for (const pathVariant of pathVariants) {
        redacted = redacted.replaceAll(pathVariant, "<workspace>");
      }
      return redacted;
    }
    if (Array.isArray(current)) return current.map(visit);
    if (current !== null && typeof current === "object") {
      return Object.fromEntries(
        Object.entries(current).map(([key, nested]) => [key, visit(nested)]),
      );
    }
    return current;
  };
  return visit(value) as T;
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
    operationId: string;
    diff: string;
    diffTruncated: boolean;
    workspaceSnapshotHash: string;
    testRun: TestRunRecord;
    criteria: string[];
    constraints: string[];
    prompt: string;
    approvedTopicIds: string[];
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
      authorityStatus: "accepted";
      evidenceBundleJson: string;
      persistCompletedAssistant: () => void;
      finishCompleted: () => Promise<void>;
      fail: (error: unknown) => Promise<never>;
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
      approvedTopicIds: input.approvedTopicIds,
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
        stdout: redactAttemptWorkspacePath(
          input.testRun.stdout,
          input.attempt.workspacePath,
        ),
        stderr: redactAttemptWorkspacePath(
          input.testRun.stderr,
          input.attempt.workspacePath,
        ),
        durationMs: input.testRun.durationMs,
        result:
          input.testRun.resultJson === null
            ? null
            : redactAttemptWorkspacePath(
                JSON.parse(input.testRun.resultJson),
                input.attempt.workspacePath,
              ),
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
    signal: input.signal,
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
    `reviewer:${input.attempt.id}:${input.operationId}`,
    dispatch.connection.connectionId,
    modelId,
    randomUUID(),
  ]);
  // Reviewer sessions are deliberately operation-scoped. Pi retains session
  // context internally, so reusing a provider session could retransmit evidence
  // from a prior review without including it in the current disclosure.
  let storedSession: ProviderSessionRecord | undefined;
  let provisionalSession:
    { provider: AgentProvider; providerSessionId: string } | undefined;
  let turnId: string | undefined;
  let terminalReason: "completed" | "failed" | "cancelled" | undefined;
  let providerStreamStarted = false;
  let providerStreamCompleted = false;
  let dispatchFinished = false;
  const finishDispatch = (
    status: "completed" | "failed" | "cancelled",
    failureCode: ReturnType<typeof providerFailureCode> | null,
  ) => {
    if (dispatchFinished) return;
    dispatchFinished = true;
    state.providerRuntime.finishDispatch(dispatch, status, failureCode);
  };
  const cancelTurn = async () => {
    if (provisionalSession) {
      const pending = provisionalSession;
      provisionalSession = undefined;
      await pending.provider
        .cancelSession(pending.providerSessionId)
        .catch(() => undefined);
    }
    if (storedSession) {
      await cancelAndEvictProviderSession(state, key, storedSession).catch(
        () => {
          if (storedSession) evictProviderSession(state, key, storedSession);
        },
      );
    }
  };
  const throwIfCancelled = () => {
    if (!input.signal.aborted) return;
    throw new ProviderHubError("cancelled", "Reviewer turn was cancelled");
  };
  const failTurn = async (error: unknown): Promise<never> => {
    const cancelled =
      input.signal.aborted ||
      terminalReason === "cancelled" ||
      (error instanceof ProviderHubError && error.failure.code === "cancelled");
    if (providerStreamCompleted || !providerStreamStarted) {
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
        persistAgentResponse(state, {
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
  };

  try {
    throwIfCancelled();
    if (!storedSession) {
      await state.providerRuntime.runOwnedSetup(
        (signal) =>
          provider.createSession(
            {
              role: "reviewer",
              modelId,
              systemPrompt: getLatestPrompt("reviewer").systemPrompt,
              metadata: {
                learningSessionId: input.attempt.sessionId,
                exerciseAttemptId: input.attempt.id,
                reviewOperationId: input.operationId,
              },
            },
            signal,
          ),
        input.signal,
        (session) => provider.cancelSession(session.id),
        async (ownedSession, setupSignal) => {
          let conversationId: string | undefined;
          try {
            if (
              ownedSession.providerId !== providerId ||
              ownedSession.role !== "reviewer" ||
              ownedSession.modelId !== modelId
            ) {
              throw new ProviderHubError(
                "invalid_output",
                "Reviewer provider returned mismatched session metadata",
              );
            }
            provisionalSession = {
              provider,
              providerSessionId: ownedSession.id,
            };
            setupSignal.throwIfAborted();
            const conversation = await state.repository.createConversation({
              learningSessionId: input.attempt.sessionId,
              role: "reviewer",
              providerId,
              modelId,
              providerSessionId: null,
            });
            conversationId = conversation.id;
            setupSignal.throwIfAborted();
            state.repository.addMessage({
              conversationId,
              role: "user",
              content: reviewPrompt,
            });
            setupSignal.throwIfAborted();
            const adoptedSession: ProviderSessionRecord = {
              providerId,
              connectionId: dispatch.connection.connectionId,
              provider,
              providerSessionId: ownedSession.id,
              conversationId,
            };
            storedSession = adoptedSession;
            state.providerSessions.set(key, adoptedSession);
            provisionalSession = undefined;
          } catch (error) {
            try {
              if (conversationId) {
                state.connection.sqlite
                  .prepare("DELETE FROM agent_conversations WHERE id = ?")
                  .run(conversationId);
              }
            } finally {
              provisionalSession = undefined;
            }
            throw error;
          }
        },
      );
      if (input.signal.aborted) {
        await cancelTurn();
        throwIfCancelled();
      }
    } else {
      await state.providerRuntime.runSetup(async (setupSignal) => {
        let messageId: string | undefined;
        try {
          setupSignal.throwIfAborted();
          const message = state.repository.addMessage({
            conversationId: storedSession!.conversationId,
            role: "user",
            content: reviewPrompt,
          });
          messageId = message.id;
          setupSignal.throwIfAborted();
        } catch (error) {
          if (messageId) {
            state.connection.sqlite
              .prepare("DELETE FROM agent_messages WHERE id = ?")
              .run(messageId);
          }
          if (storedSession) {
            const failedSession = storedSession;
            await cancelAndEvictProviderSession(
              state,
              key,
              failedSession,
            ).catch(() => evictProviderSession(state, key, failedSession));
            storedSession = undefined;
          }
          throw error;
        }
      }, input.signal);
    }

    throwIfCancelled();
    if (!storedSession) {
      throw new ProviderHubError(
        "provider_error",
        "Reviewer provider session was not adopted",
      );
    }
    let rawResponse = "";
    let messageCompleted = false;
    turnId = randomUUID();
    state.activeProviderTurns.set(turnId, { key, session: storedSession });
    providerStreamStarted = true;
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
    throwIfCancelled();
    if (terminalReason !== "completed" || !messageCompleted) {
      throw new ProviderHubError(
        terminalReason === "cancelled" ? "cancelled" : "invalid_output",
        "Reviewer provider did not return a complete result",
      );
    }
    const parsedResult = await parseReviewResult(rawResponse);
    const { result, authorityStatus } = validateReviewResultAgainstEvidence(
      parsedResult,
      {
        diff: input.diff,
        approvedTopicIds: input.approvedTopicIds,
      },
    );
    throwIfCancelled();
    const conversationId = storedSession.conversationId;
    return {
      kind: "review",
      providerId,
      modelId,
      result,
      authorityStatus,
      evidenceBundleJson: reviewPrompt,
      persistCompletedAssistant: () => {
        state.providerRuntime.assertDispatchCommitAllowed(dispatch);
        throwIfCancelled();
        persistAgentResponse(state, {
          conversationId,
          content: JSON.stringify(result),
          status: "completed",
        });
        state.providerRuntime.assertDispatchCommitAllowed(dispatch);
        throwIfCancelled();
      },
      finishCompleted: async () => {
        finishDispatch("completed", null);
        await cancelTurn();
      },
      fail: failTurn,
    };
  } catch (error) {
    return await failTurn(error);
  } finally {
    if (turnId) {
      const active = state.activeProviderTurns.get(turnId);
      if (active?.session === storedSession) {
        state.activeProviderTurns.delete(turnId);
      }
    }
  }
}

function persistAgentResponse(
  state: AppState,
  input: {
    conversationId: string;
    content: string;
    status: string;
    idempotencyKey?: string;
  },
): string {
  const message = state.repository.addMessage({
    conversationId: input.conversationId,
    role: "assistant",
    content: input.content,
    status: input.status,
    ...(input.idempotencyKey === undefined
      ? {}
      : { idempotencyKey: input.idempotencyKey }),
  });
  return message.id;
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

function safeProviderManagementMessage(error: unknown): string {
  if (error instanceof z.ZodError) {
    return error.issues[0]?.message ?? "Provider configuration is invalid";
  }
  return error instanceof Error && error.message.trim()
    ? error.message.slice(0, 500)
    : "Provider configuration failed";
}
