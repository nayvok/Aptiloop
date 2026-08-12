import { createHash, randomUUID } from "node:crypto";

import {
  CORE_TOOL_POLICIES,
  ProviderHub,
  ProviderHubError,
  toAptiloopAiRole,
  type AgentProvider,
  type ResolvedProviderTurn,
} from "@aptiloop/agent-core";
import {
  ProviderHubRepository,
  type DatabaseConnection,
} from "@aptiloop/database";
import {
  AgentEventSchema,
  AiDisclosureSchema,
  AptiloopAiRoleSchema,
  RoleProfileSchema,
  type AgentEvent,
  type AgentRole,
  type AiDisclosure,
  type AptiloopAiRole,
  type DisclosurePayloadCategory,
  type JsonValue,
  type ProviderHubFailureCode,
  type ProviderId,
  type ProviderConnection,
  type RoleBudgets,
  type RoleProfile,
} from "@aptiloop/shared";

const sha256 = (payload: string) =>
  `sha256:${createHash("sha256").update(payload, "utf8").digest("hex")}`;

const DEFAULT_BUDGETS: Readonly<Record<AptiloopAiRole, RoleBudgets>> = {
  "course-designer": {
    maxInputBytes: 500_000,
    maxOutputBytes: 256_000,
    maxEvents: 1_000,
    maxToolCalls: 8,
    deadlineMs: 120_000,
  },
  tutor: {
    maxInputBytes: 128_000,
    maxOutputBytes: 256_000,
    maxEvents: 1_000,
    maxToolCalls: 4,
    deadlineMs: 120_000,
  },
  evaluator: {
    maxInputBytes: 2_500_000,
    maxOutputBytes: 256_000,
    maxEvents: 1_000,
    maxToolCalls: 4,
    deadlineMs: 120_000,
  },
  reviewer: {
    maxInputBytes: 2_500_000,
    maxOutputBytes: 256_000,
    maxEvents: 1_000,
    maxToolCalls: 4,
    deadlineMs: 120_000,
  },
};

const TOOL_POLICY_BY_ROLE: Readonly<Record<AptiloopAiRole, string>> = {
  "course-designer": "apt.role.course-designer.v2",
  tutor: "apt.role.tutor.v1",
  evaluator: "apt.role.evaluator.v1",
  reviewer: "apt.role.reviewer.v1",
};

const LEGACY_SYNTHETIC_CONNECTION_IDS = [
  "conn:pi:openai",
  "conn:pi:opencode-zen",
] as const;

export interface DevelopmentProviderFixture {
  readonly connection: ProviderConnection;
  readonly modelId: string;
  readonly assignedRoles: readonly AptiloopAiRole[];
}

export interface ProviderRuntimeOptions {
  readonly connection: DatabaseConnection;
  readonly providers: Partial<Record<ProviderId, AgentProvider>>;
  readonly connectionProviders?: ReadonlyMap<string, AgentProvider>;
  readonly ensureProviders?: () => Promise<void>;
  readonly developmentMode: boolean;
  readonly developmentFixture?: DevelopmentProviderFixture;
  readonly now?: () => Date;
}

export interface PrepareDisclosureInput {
  readonly role: AgentRole;
  readonly payload: string;
  readonly payloadCategories: readonly DisclosurePayloadCategory[];
  readonly entityIds?: Readonly<Record<string, string>>;
  readonly exclusions?: readonly string[];
  readonly destinationPurpose: string;
}

export interface FindPendingDisclosureInput {
  readonly role: AgentRole;
  readonly payload: string;
  readonly entityIds: Readonly<Record<string, string>>;
}

export type DisclosurePreparation =
  | { readonly required: false }
  | { readonly required: true; readonly disclosure: AiDisclosure };

export interface ResolveProviderDispatchInput {
  readonly role: AgentRole;
  readonly payload: string;
  readonly disclosureOperationId?: string;
  readonly metadata?: Readonly<Record<string, JsonValue>>;
  readonly signal?: AbortSignal;
}

export interface ProviderDispatch extends ResolvedProviderTurn {
  readonly operationId: string;
  readonly agentRole: AgentRole;
  readonly payload: string;
}

interface ProviderConnectionLifecycle {
  activeOperations: number;
  retiring: boolean;
  retired: boolean;
}

export interface ProviderConnectionRetirement {
  readonly commit: () => void;
  readonly rollback: () => void;
}

export interface ProviderRuntimeSettings {
  readonly connections: ReturnType<ProviderHub["listConnections"]>;
  readonly roleProfiles: ReturnType<ProviderHub["listRoleProfiles"]>;
}

interface ProviderSessionBudgetUsage {
  inputBytes: number;
  outputBytes: number;
  events: number;
  toolCalls: number;
}

export class ProviderRuntime {
  readonly #repository: ProviderHubRepository;
  readonly #providers: Partial<Record<ProviderId, AgentProvider>>;
  readonly #connectionProviders: ReadonlyMap<string, AgentProvider>;
  readonly #ensureProviders: () => Promise<void>;
  readonly #developmentMode: boolean;
  readonly #developmentFixture: DevelopmentProviderFixture | undefined;
  readonly #now: () => Date;
  readonly #sessionBudgetUsage = new Map<string, ProviderSessionBudgetUsage>();
  readonly #connectionLifecycles = new Map<
    string,
    ProviderConnectionLifecycle
  >();
  readonly #activeDispatchConnections = new Map<string, string>();
  readonly #activeStreamControllers = new Map<string, AbortController>();
  readonly #activeStreams = new Set<Promise<void>>();
  readonly #activeSetups = new Set<Promise<void>>();
  readonly #shutdownController = new AbortController();
  #closing: Promise<void> | null = null;
  #shuttingDown = false;

  constructor(options: ProviderRuntimeOptions) {
    this.#repository = new ProviderHubRepository(options.connection);
    this.#providers = options.providers;
    this.#connectionProviders = options.connectionProviders ?? new Map();
    this.#ensureProviders =
      options.ensureProviders ?? (() => Promise.resolve());
    this.#developmentMode = options.developmentMode;
    this.#developmentFixture = options.developmentFixture;
    if (this.#developmentFixture && !this.#developmentMode) {
      throw new Error("Development provider fixtures require development mode");
    }
    this.#now = options.now ?? (() => new Date());
    this.#seedConfiguration();
  }

  async settings(): Promise<ProviderRuntimeSettings> {
    await this.#refreshConnections();
    const hub = this.#hub();
    return {
      connections: hub
        .listConnections()
        .filter(
          (connection) =>
            !LEGACY_SYNTHETIC_CONNECTION_IDS.includes(
              connection.connectionId as (typeof LEGACY_SYNTHETIC_CONNECTION_IDS)[number],
            ) &&
            (this.#developmentMode || connection.adapterId !== "mock"),
        ),
      roleProfiles: hub.listRoleProfiles(),
    };
  }
  async inspectRole(
    role: AgentRole,
    signal?: AbortSignal,
  ): Promise<ResolvedProviderTurn> {
    return this.runSetup(async (combined) => {
      await this.#refreshConnections(combined);
      combined.throwIfAborted();
      const inspected = this.#hub().inspect(toAptiloopAiRole(role));
      const modelId = inspected.profile.modelId;
      if (!modelId) {
        throw new ProviderHubError(
          "misconfigured",
          `Role profile ${inspected.role} has no exact model`,
        );
      }
      return { ...inspected, modelId, disclosure: null };
    }, signal);
  }

  async saveRoleProfiles(
    input: readonly {
      role: AptiloopAiRole;
      mode: "no-ai" | "connection";
      connectionId: string | null;
      modelId: string | null;
    }[],
  ): Promise<RoleProfile[]> {
    const expectedRoles = new Set(AptiloopAiRoleSchema.options);
    if (input.length !== expectedRoles.size) {
      throw new ProviderHubError(
        "misconfigured",
        "Every Aptiloop AI role must have exactly one profile",
      );
    }
    await this.#refreshConnections();
    const connections = new Map(
      this.#repository
        .listConnections()
        .map((connection) => [connection.connectionId, connection] as const),
    );
    const profiles = input.map((candidate) => {
      const role = AptiloopAiRoleSchema.parse(candidate.role);
      if (!expectedRoles.delete(role)) {
        throw new ProviderHubError(
          "misconfigured",
          `Duplicate AI role profile: ${role}`,
        );
      }
      if (candidate.mode === "connection") {
        const connection = candidate.connectionId
          ? connections.get(candidate.connectionId)
          : undefined;
        if (!connection || !connection.enabled) {
          throw new ProviderHubError(
            "connection_not_found",
            `Connection ${candidate.connectionId ?? "(missing)"} is unavailable`,
          );
        }
        if (connection.adapterId === "mock" && !this.#developmentMode) {
          throw new ProviderHubError(
            "provider_unavailable",
            "Mock is restricted to tests, CI, and explicit development mode",
          );
        }
        const modelId = candidate.modelId;
        if (
          !modelId ||
          !connection.observedCapabilities?.models.some(
            (model) => model.modelId === modelId && model.available,
          )
        ) {
          throw new ProviderHubError(
            "model_unavailable",
            `Configured model ${modelId ?? "(missing)"} is unavailable`,
            { recoveryAction: "open-ai-settings" },
          );
        }
      }
      return RoleProfileSchema.parse({
        role,
        mode: candidate.mode,
        connectionId:
          candidate.mode === "connection" ? candidate.connectionId : null,
        modelId: candidate.mode === "connection" ? candidate.modelId : null,
        requiredCapabilities:
          candidate.mode === "connection"
            ? ["streaming", "models", "cancellation"]
            : [],
        toolPolicyId: TOOL_POLICY_BY_ROLE[role],
        budgets: DEFAULT_BUDGETS[role],
      });
    });
    if (expectedRoles.size > 0) {
      throw new ProviderHubError(
        "misconfigured",
        "One or more Aptiloop AI roles are missing",
      );
    }
    for (const profile of profiles) this.#repository.saveRoleProfile(profile);
    return profiles;
  }

  async prepareDisclosure(
    input: PrepareDisclosureInput,
  ): Promise<DisclosurePreparation> {
    await this.#refreshConnections();
    const role = toAptiloopAiRole(input.role);
    const inspected = this.#hub().inspect(role);
    const payloadBytes = Buffer.byteLength(input.payload, "utf8");
    if (payloadBytes > inspected.profile.budgets.maxInputBytes) {
      throw new ProviderHubError(
        "budget_exceeded",
        "Provider input exceeds the configured role budget",
      );
    }
    if (!inspected.connection.external) return { required: false };

    const now = this.#now();
    const disclosure = AiDisclosureSchema.parse({
      operationId: `disclosure:${randomUUID()}`,
      scope: {
        role,
        connectionId: inspected.connection.connectionId,
        providerType: inspected.connection.providerType,
        modelId: inspected.profile.modelId,
        destination: `${inspected.connection.displayName}: ${input.destinationPurpose}`,
        payloadCategories: [...input.payloadCategories],
        entityIds: { ...(input.entityIds ?? {}) },
        exclusions: [
          "credentials",
          "environment variables",
          "absolute local paths",
          "unrelated learner history",
          ...(input.exclusions ?? []),
        ],
        byteCount: payloadBytes,
        payloadSha256: sha256(input.payload),
      },
      status: "pending",
      createdAt: now.toISOString(),
      approvedAt: null,
      consumedAt: null,
      expiresAt: new Date(now.getTime() + 5 * 60_000).toISOString(),
    });
    this.#repository.createDisclosure(disclosure);
    return { required: true, disclosure };
  }

  async findPendingDisclosure(
    input: FindPendingDisclosureInput,
  ): Promise<AiDisclosure | null> {
    const inspected = await this.inspectRole(input.role);
    if (!inspected.connection.external) return null;
    const role = toAptiloopAiRole(input.role);
    const now = this.#now();
    const matches = this.#repository
      .findPendingDisclosures({
        role,
        payloadSha256: sha256(input.payload),
        connectionId: inspected.connection.connectionId,
        providerType: inspected.connection.providerType,
        modelId: inspected.modelId,
        entityIds: input.entityIds,
        now: now.toISOString(),
      })
      .filter(
        (candidate) =>
          candidate.status === "pending" &&
          Date.parse(candidate.expiresAt) > now.getTime() &&
          candidate.scope.connectionId === inspected.connection.connectionId &&
          candidate.scope.providerType === inspected.connection.providerType &&
          candidate.scope.modelId === inspected.modelId &&
          sameEntityIds(candidate.scope.entityIds, input.entityIds),
      );
    if (matches.length > 1) {
      throw new ProviderHubError(
        "disclosure_mismatch",
        "Multiple pending disclosures match the provider operation",
      );
    }
    return matches[0] ?? null;
  }

  approveDisclosure(operationId: string): AiDisclosure {
    return this.#repository.approveDisclosure(
      operationId,
      this.#now().toISOString(),
    );
  }

  cancelDisclosure(operationId: string): AiDisclosure {
    return this.#repository.cancelDisclosure(
      operationId,
      this.#now().toISOString(),
    );
  }

  async resolveDispatch(
    input: ResolveProviderDispatchInput,
  ): Promise<ProviderDispatch> {
    if (this.#shuttingDown) {
      throw new ProviderHubError(
        "provider_unavailable",
        "Provider runtime is shutting down",
      );
    }
    const signal = input.signal
      ? AbortSignal.any([input.signal, this.#shutdownController.signal])
      : this.#shutdownController.signal;
    return this.#trackSetup(async () => {
      await this.#refreshConnections(signal);
      signal.throwIfAborted();
      const role = toAptiloopAiRole(input.role);
      const profile = this.#hub().profileFor(role);
      if (profile.mode === "no-ai") {
        throw new ProviderHubError(
          "ai_disabled",
          `AI is disabled for ${role}`,
          { recoveryAction: "open-ai-settings" },
        );
      }
      const payloadBytes = Buffer.byteLength(input.payload, "utf8");
      if (payloadBytes > profile.budgets.maxInputBytes) {
        throw new ProviderHubError(
          "budget_exceeded",
          "Provider input exceeds the configured role budget",
        );
      }
      const disclosure = input.disclosureOperationId
        ? this.#repository.getDisclosure(input.disclosureOperationId)
        : null;
      const connectionId = profile.connectionId;
      if (!connectionId) {
        throw new ProviderHubError(
          "misconfigured",
          `Role profile ${role} has no exact connection`,
        );
      }
      const operationId = `provider-turn:${randomUUID()}`;
      this.#reserveConnectionOperation(connectionId, operationId);
      const now = this.#now().toISOString();
      try {
        const resolved = await this.#hub().resolveTurn({
          role,
          payloadSha256: sha256(input.payload),
          disclosure,
          signal,
        });
        signal.throwIfAborted();
        if (resolved.connection.connectionId !== connectionId) {
          throw new ProviderHubError(
            "misconfigured",
            "Provider connection changed while the turn was starting",
          );
        }
        this.#repository.dispatchProviderTurn(
          {
            operationId,
            connectionId: resolved.connection.connectionId,
            providerType: resolved.connection.providerType,
            adapterId: resolved.connection.adapterId,
            modelId: resolved.modelId,
            role,
            toolPolicyId: resolved.toolPolicy.toolPolicyId,
            capabilityObservedAt:
              resolved.connection.observedCapabilities?.observedAt ?? null,
            disclosureOperationId: resolved.disclosure?.operationId ?? null,
            metadata: input.metadata ? { ...input.metadata } : undefined,
          },
          now,
        );
        return {
          ...resolved,
          operationId,
          agentRole: input.role,
          payload: input.payload,
        };
      } catch (error) {
        this.#releaseConnectionOperation(operationId);
        throw error;
      }
    });
  }

  finishDispatch(
    dispatch: Pick<ProviderDispatch, "operationId">,
    status: "completed" | "failed" | "cancelled",
    failureCode: ProviderHubFailureCode | null = null,
  ): void {
    try {
      this.#repository.recordProviderTurnFinished(
        dispatch.operationId,
        status,
        this.#now().toISOString(),
        failureCode,
      );
    } finally {
      this.#releaseConnectionOperation(dispatch.operationId);
    }
  }

  beginConnectionRetirement(
    connectionId: string,
  ): ProviderConnectionRetirement {
    const lifecycle = this.#connectionLifecycle(connectionId);
    if (lifecycle.retiring || lifecycle.retired) {
      throw new ProviderHubError(
        "connection_disabled",
        "Provider connection removal is already in progress or complete",
      );
    }
    lifecycle.retiring = true;
    if (lifecycle.activeOperations > 0) {
      lifecycle.retiring = false;
      throw new ProviderHubError(
        "connection_disabled",
        "This connection has an active AI request. Stop it before removing the connection.",
      );
    }
    let settled = false;
    const settle = (retired: boolean) => {
      if (settled) return;
      settled = true;
      const current = this.#connectionLifecycles.get(connectionId);
      if (current !== lifecycle) return;
      current.retiring = false;
      current.retired = retired;
      if (!retired && current.activeOperations === 0) {
        this.#connectionLifecycles.delete(connectionId);
      }
    };
    return {
      commit: () => settle(true),
      rollback: () => settle(false),
    };
  }

  assertDispatchCommitAllowed(
    dispatch: Pick<ProviderDispatch, "connection" | "operationId">,
  ): void {
    const lifecycle = this.#connectionLifecycles.get(
      dispatch.connection.connectionId,
    );
    if (lifecycle?.retiring || lifecycle?.retired) {
      throw new ProviderHubError(
        "connection_disabled",
        "Provider connection was removed before the operation committed",
      );
    }
    if (!this.#activeDispatchConnections.has(dispatch.operationId)) {
      throw new ProviderHubError(
        "provider_error",
        "Provider operation is no longer active",
      );
    }
  }

  #connectionLifecycle(connectionId: string): ProviderConnectionLifecycle {
    const existing = this.#connectionLifecycles.get(connectionId);
    if (existing) return existing;
    const lifecycle: ProviderConnectionLifecycle = {
      activeOperations: 0,
      retiring: false,
      retired: false,
    };
    this.#connectionLifecycles.set(connectionId, lifecycle);
    return lifecycle;
  }

  #reserveConnectionOperation(
    connectionId: string,
    operationId: string,
  ): ProviderConnectionLifecycle {
    if (this.#shuttingDown) {
      throw new ProviderHubError(
        "provider_unavailable",
        "Provider runtime is shutting down",
      );
    }
    const lifecycle = this.#connectionLifecycle(connectionId);
    if (lifecycle.retiring || lifecycle.retired) {
      throw new ProviderHubError(
        "connection_disabled",
        "Provider connection removal is in progress or complete",
        { recoveryAction: "open-ai-settings" },
      );
    }
    lifecycle.activeOperations += 1;
    this.#activeDispatchConnections.set(operationId, connectionId);
    return lifecycle;
  }

  #releaseConnectionOperation(operationId: string): void {
    const connectionId = this.#activeDispatchConnections.get(operationId);
    if (!connectionId) return;
    this.#activeDispatchConnections.delete(operationId);
    const lifecycle = this.#connectionLifecycles.get(connectionId);
    if (!lifecycle) return;
    lifecycle.activeOperations = Math.max(0, lifecycle.activeOperations - 1);
    if (lifecycle.activeOperations === 0 && !lifecycle.retiring) {
      this.#connectionLifecycles.delete(connectionId);
    }
  }

  releaseSession(providerSessionId: string): void {
    this.#sessionBudgetUsage.delete(providerSessionId);
  }

  beginShutdown(): void {
    if (this.#shuttingDown) return;
    this.#shuttingDown = true;
    this.#shutdownController.abort(
      new DOMException("Provider runtime is shutting down", "AbortError"),
    );
    for (const controller of this.#activeStreamControllers.values()) {
      controller.abort(
        new DOMException("Provider runtime is shutting down", "AbortError"),
      );
    }
  }

  close(): Promise<void> {
    this.#closing ??= this.#close();
    return this.#closing;
  }

  async #close(): Promise<void> {
    this.beginShutdown();
    const active = [...this.#activeSetups, ...this.#activeStreams];
    if (active.length === 0) return;
    await Promise.allSettled(active);
  }

  async runSetup<T>(
    operation: (signal: AbortSignal) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const combined = signal
      ? AbortSignal.any([signal, this.#shutdownController.signal])
      : this.#shutdownController.signal;
    return this.#trackSetup(async () => {
      combined.throwIfAborted();
      const result = await operation(combined);
      combined.throwIfAborted();
      return result;
    });
  }

  async #trackSetup<T>(operation: () => Promise<T>): Promise<T> {
    let finish!: () => void;
    const active = new Promise<void>((resolve) => {
      finish = resolve;
    });
    this.#activeSetups.add(active);
    try {
      return await operation();
    } finally {
      this.#activeSetups.delete(active);
      finish();
    }
  }

  async *stream(
    dispatch: ProviderDispatch,
    providerSessionId: string,
    signal: AbortSignal,
    responseFormat: "text" | "json",
  ): AsyncGenerator<AgentEvent> {
    const { budgets } = dispatch.profile;
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(), budgets.deadlineMs);
    const streamController = new AbortController();
    const combined = AbortSignal.any([
      signal,
      deadline.signal,
      streamController.signal,
      this.#shutdownController.signal,
    ]);
    const usage = this.#sessionBudgetUsage.get(providerSessionId) ?? {
      inputBytes: 0,
      outputBytes: 0,
      events: 0,
      toolCalls: 0,
    };
    let eventCount = usage.events;
    let toolCalls = usage.toolCalls;
    let outputBytes = usage.outputBytes;
    let expectedSequence = 0;
    let completedContent: string | null = null;
    let terminal = false;
    let terminalReason: "completed" | "failed" | "cancelled" | null = null;
    let completedNormally = false;
    let cancellation: Promise<void> | null = null;
    let finishActiveStream!: () => void;
    const activeStream = new Promise<void>((resolve) => {
      finishActiveStream = resolve;
    });
    this.#activeStreams.add(activeStream);
    this.#activeStreamControllers.set(dispatch.operationId, streamController);
    const cancel = () => {
      cancellation ??= dispatch.provider
        .cancelSession(providerSessionId)
        .catch(() => undefined);
      return cancellation;
    };
    const onAbort = () => {
      void cancel();
    };
    const throwIfAborted = () => {
      if (!combined.aborted) return;
      throw new ProviderHubError(
        deadline.signal.aborted ? "timeout" : "cancelled",
        deadline.signal.aborted
          ? "Provider turn exceeded its deadline"
          : "Provider turn was cancelled",
      );
    };
    combined.addEventListener("abort", onAbort, { once: true });
    try {
      // AbortSignal listeners added after an abort do not fire. Fence explicitly
      // before the provider sees the payload and again after it stops yielding.
      throwIfAborted();
      const inputBytes = Buffer.byteLength(dispatch.payload, "utf8");
      if (usage.inputBytes + inputBytes > budgets.maxInputBytes) {
        throw new ProviderHubError(
          "budget_exceeded",
          "Provider session exceeded its cumulative input budget",
        );
      }
      usage.inputBytes += inputBytes;
      this.#sessionBudgetUsage.set(providerSessionId, usage);
      throwIfAborted();
      for await (const yielded of dispatch.provider.streamMessage({
        sessionId: providerSessionId,
        message: dispatch.payload,
        responseFormat,
      })) {
        throwIfAborted();
        eventCount += 1;
        usage.events = eventCount;
        if (eventCount > budgets.maxEvents) {
          throw new ProviderHubError(
            "budget_exceeded",
            "Provider turn exceeded its cumulative event budget",
          );
        }
        const event = AgentEventSchema.parse(yielded);
        if (
          event.sessionId !== providerSessionId ||
          event.sequence !== expectedSequence ||
          terminal
        ) {
          throw new ProviderHubError(
            "invalid_output",
            "Provider emitted an invalid event sequence",
          );
        }
        expectedSequence += 1;
        if (event.type === "tool.started") {
          toolCalls += 1;
          usage.toolCalls = toolCalls;
          if (toolCalls > budgets.maxToolCalls) {
            throw new ProviderHubError(
              "budget_exceeded",
              "Provider turn exceeded its cumulative tool-call budget",
            );
          }
          if (
            !dispatch.toolPolicy.allowedTools.includes(event.toolName as never)
          ) {
            throw new ProviderHubError(
              "tool_policy_unavailable",
              `Provider attempted denied tool ${event.toolName}`,
            );
          }
        }
        if (event.type === "message.delta") {
          if (completedContent !== null) {
            throw new ProviderHubError(
              "invalid_output",
              "Provider emitted content after completion",
            );
          }
          outputBytes += Buffer.byteLength(event.delta, "utf8");
          usage.outputBytes = outputBytes;
        } else if (event.type === "message.completed") {
          if (completedContent !== null) {
            throw new ProviderHubError(
              "invalid_output",
              "Provider emitted duplicate completion",
            );
          }
          completedContent = event.content;
          outputBytes += Buffer.byteLength(event.content, "utf8");
          usage.outputBytes = outputBytes;
        } else if (event.type === "session.completed") {
          terminal = true;
          terminalReason = event.reason;
        }
        if (outputBytes > budgets.maxOutputBytes) {
          throw new ProviderHubError(
            "budget_exceeded",
            "Provider turn exceeded its cumulative output budget",
          );
        }
        yield event;
      }
      throwIfAborted();
      if (!terminal) {
        throw new ProviderHubError(
          "invalid_output",
          "Provider turn ended without a terminal event",
        );
      }
      if (terminalReason === "completed" && completedContent === null) {
        throw new ProviderHubError(
          "invalid_output",
          "Provider completed without authoritative message content",
        );
      }
      completedNormally = true;
    } catch (error) {
      this.#sessionBudgetUsage.delete(providerSessionId);
      await cancel();
      if (error instanceof ProviderHubError) throw error;
      if (combined.aborted) {
        throw new ProviderHubError(
          deadline.signal.aborted ? "timeout" : "cancelled",
          deadline.signal.aborted
            ? "Provider turn exceeded its deadline"
            : "Provider turn was cancelled",
          { cause: error },
        );
      }
      throw new ProviderHubError("provider_error", "Provider turn failed", {
        retryable: true,
        cause: error,
      });
    } finally {
      clearTimeout(timer);
      combined.removeEventListener("abort", onAbort);
      if (!completedNormally) await cancel();
      if (
        this.#activeStreamControllers.get(dispatch.operationId) ===
        streamController
      ) {
        this.#activeStreamControllers.delete(dispatch.operationId);
      }
      this.#activeStreams.delete(activeStream);
      finishActiveStream();
    }
  }

  #hub(): ProviderHub {
    return new ProviderHub({
      providers: this.#providers,
      providerForConnection: (connection) =>
        this.#providerForConnection(connection),
      connections: this.#repository.listConnections(),
      roleProfiles: this.#repository.listRoleProfiles(),
      toolPolicies: this.#repository.listToolPolicies(),
      developmentMode: this.#developmentMode,
      now: this.#now,
    });
  }

  #seedConfiguration(): void {
    for (const policy of CORE_TOOL_POLICIES) {
      this.#repository.saveToolPolicy(policy);
    }
    const existingConnections = this.#repository.listConnections();
    if (
      this.#developmentFixture &&
      !existingConnections.some(
        ({ connectionId }) =>
          connectionId === this.#developmentFixture?.connection.connectionId,
      )
    ) {
      this.#repository.saveConnection(this.#developmentFixture.connection);
    }
    const existingProfiles = new Set(
      this.#repository.listRoleProfiles().map(({ role }) => role),
    );
    for (const role of AptiloopAiRoleSchema.options) {
      if (existingProfiles.has(role)) continue;
      const useDevelopmentFixture =
        this.#developmentFixture?.assignedRoles.includes(role) === true;
      this.#repository.saveRoleProfile({
        role,
        mode: useDevelopmentFixture ? "connection" : "no-ai",
        connectionId: useDevelopmentFixture
          ? this.#developmentFixture?.connection.connectionId
          : null,
        modelId: useDevelopmentFixture
          ? this.#developmentFixture?.modelId
          : null,
        requiredCapabilities: useDevelopmentFixture
          ? ["streaming", "models", "cancellation"]
          : [],
        toolPolicyId: TOOL_POLICY_BY_ROLE[role],
        budgets: DEFAULT_BUDGETS[role],
      });
    }
    this.#retireLegacySyntheticConfiguration();
    if (!this.#developmentMode) this.#retireDevelopmentProviderConnections();
  }

  #retireLegacySyntheticConfiguration(): void {
    for (const profile of this.#repository.listRoleProfiles()) {
      if (
        !profile.connectionId ||
        !LEGACY_SYNTHETIC_CONNECTION_IDS.includes(
          profile.connectionId as (typeof LEGACY_SYNTHETIC_CONNECTION_IDS)[number],
        )
      ) {
        continue;
      }
      this.#repository.saveRoleProfile({
        ...profile,
        mode: "no-ai",
        connectionId: null,
        modelId: null,
        requiredCapabilities: [],
      });
    }
    for (const connection of this.#repository.listConnections()) {
      if (
        !LEGACY_SYNTHETIC_CONNECTION_IDS.includes(
          connection.connectionId as (typeof LEGACY_SYNTHETIC_CONNECTION_IDS)[number],
        )
      ) {
        continue;
      }
      this.#repository.saveConnection({
        ...connection,
        enabled: false,
        state: "disabled",
        observedCapabilities: null,
        lastCheckedAt: this.#now().toISOString(),
      });
    }
  }

  #retireDevelopmentProviderConnections(): void {
    for (const profile of this.#repository.listRoleProfiles()) {
      if (!profile.connectionId) continue;
      const connection = this.#repository
        .listConnections()
        .find(({ connectionId }) => connectionId === profile.connectionId);
      if (connection?.adapterId !== "mock") continue;
      this.#repository.saveRoleProfile({
        ...profile,
        mode: "no-ai",
        connectionId: null,
        modelId: null,
        requiredCapabilities: [],
      });
    }
    for (const connection of this.#repository.listConnections()) {
      if (connection.adapterId !== "mock") continue;
      this.#repository.saveConnection({
        ...connection,
        enabled: false,
        state: "disabled",
        observedCapabilities: null,
        lastCheckedAt: this.#now().toISOString(),
      });
    }
  }

  async #refreshConnections(signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    await this.#ensureProviders();
    signal?.throwIfAborted();
    for (const connection of this.#repository.listConnections()) {
      if (!connection.enabled) {
        this.#repository.saveConnection({
          ...connection,
          state: "disabled",
          observedCapabilities: null,
          lastCheckedAt: this.#now().toISOString(),
        });
        continue;
      }
      const provider = this.#providerForConnection(connection);
      if (!provider) {
        this.#repository.saveConnection({
          ...connection,
          state: "unavailable",
          observedCapabilities: null,
          lastCheckedAt: this.#now().toISOString(),
        });
        continue;
      }
      if (connection.adapterId === "mock" && !this.#developmentMode) {
        this.#repository.saveConnection({
          ...connection,
          enabled: false,
          state: "disabled",
          observedCapabilities: null,
          lastCheckedAt: this.#now().toISOString(),
        });
        continue;
      }
      const checkedAt = this.#now().toISOString();
      try {
        const status = await provider.getStatus(signal);
        const models =
          status.state === "connected" || status.state === "degraded"
            ? await provider.listModels(signal)
            : [];
        signal?.throwIfAborted();
        this.#repository.saveConnection({
          ...connection,
          state: status.state,
          observedCapabilities: {
            providerType: connection.providerType,
            adapterVersion:
              connection.adapterId === "pi" ? "0.84.1" : "apt-adapter-v1",
            observedAt: checkedAt,
            models: models.map((model) => ({
              modelId: model.id,
              available: model.available,
              contextTokens: model.contextWindow ?? null,
              outputTokens: null,
              typedToolCalls: status.capabilities.includes("tools")
                ? "schema-constrained"
                : "none",
              parallelToolCalls: false,
              attachments: ["text"],
            })),
            connection: {
              authenticated: status.state === "connected",
              streaming: status.capabilities.includes("streaming"),
              cancellation: status.capabilities.includes("cancellation"),
            },
          },
          lastCheckedAt: checkedAt,
        });
      } catch {
        signal?.throwIfAborted();
        this.#repository.saveConnection({
          ...connection,
          state: "unavailable",
          observedCapabilities: null,
          lastCheckedAt: checkedAt,
        });
      }
    }
  }

  #providerForConnection(
    connection: ProviderConnection,
  ): AgentProvider | undefined {
    if (
      this.#developmentFixture &&
      connection.connectionId ===
        this.#developmentFixture.connection.connectionId
    ) {
      return this.#providers.mock;
    }
    return this.#connectionProviders.get(connection.connectionId);
  }
}

export function providerFailureCode(error: unknown): ProviderHubFailureCode {
  return error instanceof ProviderHubError
    ? error.failure.code
    : "provider_error";
}

export function providerFailurePayload(error: unknown) {
  const providerError =
    error instanceof ProviderHubError
      ? error
      : new ProviderHubError("provider_error", "Provider operation failed", {
          retryable: true,
          cause: error,
        });
  return {
    error: providerError.message,
    failure: providerError.failure,
  };
}

function sameEntityIds(
  left: Readonly<Record<string, string>>,
  right: Readonly<Record<string, string>>,
): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key) => left[key] === right[key])
  );
}
