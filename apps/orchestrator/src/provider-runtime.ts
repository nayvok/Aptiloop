import { createHash, randomUUID } from "node:crypto";

import {
  CORE_TOOL_POLICIES,
  ProviderHub,
  ProviderHubError,
  toAptiloopAiRole,
  type AgentProvider,
  type ResolvedProviderTurn,
} from "@dlh/agent-core";
import { ProviderHubRepository, type DatabaseConnection } from "@dlh/database";
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
  type RoleBudgets,
  type RoleProfile,
} from "@dlh/shared";

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

export interface ProviderRuntimeOptions {
  readonly connection: DatabaseConnection;
  readonly providers: Record<ProviderId, AgentProvider>;
  readonly developmentMode: boolean;
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

export type DisclosurePreparation =
  | { readonly required: false }
  | { readonly required: true; readonly disclosure: AiDisclosure };

export interface ResolveProviderDispatchInput {
  readonly role: AgentRole;
  readonly payload: string;
  readonly disclosureOperationId?: string;
  readonly metadata?: Readonly<Record<string, JsonValue>>;
}

export interface ProviderDispatch extends ResolvedProviderTurn {
  readonly operationId: string;
  readonly agentRole: AgentRole;
  readonly payload: string;
}

export interface ProviderRuntimeSettings {
  readonly connections: ReturnType<ProviderHub["listConnections"]>;
  readonly roleProfiles: ReturnType<ProviderHub["listRoleProfiles"]>;
}

export class ProviderRuntime {
  readonly #repository: ProviderHubRepository;
  readonly #providers: Record<ProviderId, AgentProvider>;
  readonly #developmentMode: boolean;
  readonly #now: () => Date;

  constructor(options: ProviderRuntimeOptions) {
    this.#repository = new ProviderHubRepository(options.connection);
    this.#providers = options.providers;
    this.#developmentMode =
      options.developmentMode ||
      process.env.NODE_ENV === "development" ||
      process.env.NODE_ENV === "test";
    this.#now = options.now ?? (() => new Date());
    this.#seedConfiguration();
  }

  async settings(): Promise<ProviderRuntimeSettings> {
    await this.#refreshConnections();
    const hub = this.#hub();
    return {
      connections: hub.listConnections(),
      roleProfiles: hub.listRoleProfiles(),
    };
  }
  async inspectRole(role: AgentRole): Promise<ResolvedProviderTurn> {
    await this.#refreshConnections();
    const inspected = this.#hub().inspect(toAptiloopAiRole(role));
    const modelId = inspected.profile.modelId;
    if (!modelId) {
      throw new ProviderHubError(
        "misconfigured",
        `Role profile ${inspected.role} has no exact model`,
      );
    }
    return { ...inspected, modelId, disclosure: null };
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
    await this.#refreshConnections();
    const role = toAptiloopAiRole(input.role);
    const profile = this.#hub().profileFor(role);
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
    const resolved = await this.#hub().resolveTurn({
      role,
      payloadSha256: sha256(input.payload),
      disclosure,
    });
    const operationId = `provider-turn:${randomUUID()}`;
    const now = this.#now().toISOString();
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
  }

  finishDispatch(
    dispatch: Pick<ProviderDispatch, "operationId">,
    status: "completed" | "failed" | "cancelled",
    failureCode: ProviderHubFailureCode | null = null,
  ): void {
    this.#repository.recordProviderTurnFinished(
      dispatch.operationId,
      status,
      this.#now().toISOString(),
      failureCode,
    );
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
    const combined = AbortSignal.any([signal, deadline.signal]);
    let eventCount = 0;
    let toolCalls = 0;
    let outputBytes = 0;
    let expectedSequence = 0;
    let completedContent: string | null = null;
    let terminal = false;
    let terminalReason: "completed" | "failed" | "cancelled" | null = null;
    let completedNormally = false;
    let cancellation: Promise<void> | null = null;
    const cancel = () => {
      cancellation ??= dispatch.provider
        .cancelSession(providerSessionId)
        .catch(() => undefined);
      return cancellation;
    };
    const onAbort = () => {
      void cancel();
    };
    combined.addEventListener("abort", onAbort, { once: true });
    try {
      for await (const yielded of dispatch.provider.streamMessage({
        sessionId: providerSessionId,
        message: dispatch.payload,
        responseFormat,
      })) {
        if (combined.aborted) {
          throw new ProviderHubError(
            deadline.signal.aborted ? "timeout" : "cancelled",
            deadline.signal.aborted
              ? "Provider turn exceeded its deadline"
              : "Provider turn was cancelled",
          );
        }
        eventCount += 1;
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
        } else if (event.type === "message.completed") {
          if (completedContent !== null) {
            throw new ProviderHubError(
              "invalid_output",
              "Provider emitted duplicate completion",
            );
          }
          completedContent = event.content;
          outputBytes += Buffer.byteLength(event.content, "utf8");
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
    }
  }

  #hub(): ProviderHub {
    return new ProviderHub({
      providers: this.#providers,
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
      !existingConnections.some(
        ({ connectionId }) => connectionId === "conn:mock",
      )
    ) {
      this.#repository.saveConnection({
        connectionId: "conn:mock",
        adapterId: "mock",
        providerType: "mock",
        displayName: "Deterministic Mock",
        credentialRef: null,
        endpointProfileId: null,
        enabled: this.#developmentMode,
        external: false,
        state: this.#developmentMode ? "connected" : "disabled",
        observedCapabilities: null,
        lastCheckedAt: null,
      });
    }
    if (
      !existingConnections.some(
        ({ connectionId }) => connectionId === "conn:pi:openai",
      )
    ) {
      this.#repository.saveConnection({
        connectionId: "conn:pi:openai",
        adapterId: "pi",
        providerType: "openai",
        displayName: "OpenAI via Pi",
        credentialRef: "credential:openai:provider-owned",
        endpointProfileId: null,
        enabled: true,
        external: true,
        state: "degraded",
        observedCapabilities: null,
        lastCheckedAt: null,
      });
    }
    if (
      !existingConnections.some(
        ({ connectionId }) => connectionId === "conn:pi:opencode-zen",
      )
    ) {
      this.#repository.saveConnection({
        connectionId: "conn:pi:opencode-zen",
        adapterId: "opencode",
        providerType: "opencode",
        displayName: "OpenCode Zen via Pi",
        credentialRef: "credential:opencode:provider-owned",
        endpointProfileId: null,
        enabled: true,
        external: true,
        state: "degraded",
        observedCapabilities: null,
        lastCheckedAt: null,
      });
    }
    const existingProfiles = new Set(
      this.#repository.listRoleProfiles().map(({ role }) => role),
    );
    for (const role of AptiloopAiRoleSchema.options) {
      if (existingProfiles.has(role)) continue;
      const useMock = this.#developmentMode && role !== "course-designer";
      this.#repository.saveRoleProfile({
        role,
        mode: useMock ? "connection" : "no-ai",
        connectionId: useMock ? "conn:mock" : null,
        modelId: useMock ? "mock-deterministic" : null,
        requiredCapabilities: useMock
          ? ["streaming", "models", "cancellation"]
          : [],
        toolPolicyId: TOOL_POLICY_BY_ROLE[role],
        budgets: DEFAULT_BUDGETS[role],
      });
    }
  }

  async #refreshConnections(): Promise<void> {
    for (const connection of this.#repository.listConnections()) {
      const provider = this.#providers[connection.adapterId];
      if (!provider) continue;
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
        const status = await provider.getStatus();
        const models =
          status.state === "connected" || status.state === "degraded"
            ? await provider.listModels().catch(() => [])
            : [];
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
        this.#repository.saveConnection({
          ...connection,
          state: "unavailable",
          observedCapabilities: null,
          lastCheckedAt: checkedAt,
        });
      }
    }
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
