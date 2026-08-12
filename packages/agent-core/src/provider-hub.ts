import { randomUUID } from "node:crypto";

import {
  AiDisclosureSchema,
  AptiloopAiRoleSchema,
  ProviderConnectionSchema,
  RoleProfileSchema,
  ToolPolicySchema,
  type AiDisclosure,
  type AptiloopAiRole,
  type ProviderConnection,
  type ProviderHubFailure,
  type ProviderHubFailureCode,
  type ProviderId,
  type RoleProfile,
  type ToolPolicy,
} from "@aptiloop/shared";

import type { AgentProvider } from "./provider.js";

const FAILURE_MESSAGE_KEYS: Record<ProviderHubFailureCode, string> = {
  ai_disabled: "ai.failure.disabled",
  connection_not_found: "ai.failure.connectionNotFound",
  connection_disabled: "ai.failure.connectionDisabled",
  authentication_required: "ai.failure.authenticationRequired",
  misconfigured: "ai.failure.misconfigured",
  provider_unavailable: "ai.failure.providerUnavailable",
  model_unavailable: "ai.failure.modelUnavailable",
  capability_unknown: "ai.failure.capabilityUnknown",
  capability_missing: "ai.failure.capabilityMissing",
  tool_policy_unavailable: "ai.failure.toolPolicyUnavailable",
  disclosure_required: "ai.failure.disclosureRequired",
  disclosure_mismatch: "ai.failure.disclosureMismatch",
  invalid_output: "ai.failure.invalidOutput",
  budget_exceeded: "ai.failure.budgetExceeded",
  cancelled: "ai.failure.cancelled",
  timeout: "ai.failure.timeout",
  provider_error: "ai.failure.providerError",
};

export class ProviderHubError extends Error {
  readonly failure: ProviderHubFailure;

  constructor(
    code: ProviderHubFailureCode,
    message: string,
    options: {
      retryable?: boolean;
      recoveryAction?: string | null;
      cause?: unknown;
    } = {},
  ) {
    super(
      message,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = "ProviderHubError";
    this.failure = {
      code,
      retryable: options.retryable ?? false,
      messageKey: FAILURE_MESSAGE_KEYS[code],
      diagnosticId: `provider-hub:${randomUUID()}`,
      recoveryAction: options.recoveryAction ?? null,
    };
  }
}

export interface ProviderHubOptions {
  readonly providers: Partial<Record<ProviderId, AgentProvider>>;
  readonly providerForConnection?: (
    connection: ProviderConnection,
  ) => AgentProvider | undefined;
  readonly connections: readonly ProviderConnection[];
  readonly roleProfiles: readonly RoleProfile[];
  readonly toolPolicies: readonly ToolPolicy[];
  readonly developmentMode?: boolean;
  readonly now?: () => Date;
}

export interface ProviderHubInspection {
  readonly role: AptiloopAiRole;
  readonly profile: RoleProfile;
  readonly connection: ProviderConnection;
  readonly provider: AgentProvider;
  readonly toolPolicy: ToolPolicy;
}

export interface ResolvedProviderTurn extends ProviderHubInspection {
  readonly modelId: string;
  readonly disclosure: AiDisclosure | null;
}

export interface ResolveProviderTurnInput {
  readonly role: AptiloopAiRole;
  readonly payloadSha256?: string;
  readonly disclosure?: AiDisclosure | null;
  readonly signal?: AbortSignal;
}

export class ProviderHub {
  readonly #providers: Partial<Record<ProviderId, AgentProvider>>;
  readonly #providerForConnection:
    ((connection: ProviderConnection) => AgentProvider | undefined) | undefined;
  readonly #connections: ReadonlyMap<string, ProviderConnection>;
  readonly #roleProfiles: ReadonlyMap<AptiloopAiRole, RoleProfile>;
  readonly #toolPolicies: ReadonlyMap<string, ToolPolicy>;
  readonly #developmentMode: boolean;
  readonly #now: () => Date;

  constructor(options: ProviderHubOptions) {
    this.#providers = { ...options.providers };
    this.#providerForConnection = options.providerForConnection;
    this.#connections = uniqueMap(
      options.connections.map((input) => {
        const connection = ProviderConnectionSchema.parse(input);
        return [connection.connectionId, connection] as const;
      }),
      "provider connection",
    );
    this.#roleProfiles = uniqueMap(
      options.roleProfiles.map((input) => {
        const profile = RoleProfileSchema.parse(input);
        return [profile.role, profile] as const;
      }),
      "role profile",
    );
    this.#toolPolicies = uniqueMap(
      options.toolPolicies.map((input) => {
        const policy = ToolPolicySchema.parse(input);
        return [policy.toolPolicyId, policy] as const;
      }),
      "tool policy",
    );
    this.#developmentMode = options.developmentMode === true;
    this.#now = options.now ?? (() => new Date());
  }

  listConnections(): ProviderConnection[] {
    return [...this.#connections.values()];
  }

  listRoleProfiles(): RoleProfile[] {
    return [...this.#roleProfiles.values()];
  }

  profileFor(role: AptiloopAiRole): RoleProfile {
    const parsedRole = AptiloopAiRoleSchema.parse(role);
    const profile = this.#roleProfiles.get(parsedRole);
    if (!profile) {
      throw new ProviderHubError(
        "misconfigured",
        `No role profile is configured for ${parsedRole}`,
        { recoveryAction: "open-ai-settings" },
      );
    }
    return profile;
  }

  inspect(role: AptiloopAiRole): ProviderHubInspection {
    const profile = this.profileFor(role);
    if (profile.mode === "no-ai") {
      throw new ProviderHubError("ai_disabled", `AI is disabled for ${role}`, {
        recoveryAction: "open-ai-settings",
      });
    }
    const connectionId = profile.connectionId;
    if (!connectionId || !profile.modelId) {
      throw new ProviderHubError(
        "misconfigured",
        `Role profile ${role} has no exact connection and model`,
        { recoveryAction: "open-ai-settings" },
      );
    }
    const connection = this.#connections.get(connectionId);
    if (!connection) {
      throw new ProviderHubError(
        "connection_not_found",
        `Connection ${connectionId} does not exist`,
        { recoveryAction: "open-ai-settings" },
      );
    }
    if (!connection.enabled || connection.state === "disabled") {
      throw new ProviderHubError(
        "connection_disabled",
        `Connection ${connectionId} is disabled`,
        { recoveryAction: "open-ai-settings" },
      );
    }
    if (connection.adapterId === "mock" && !this.#developmentMode) {
      throw new ProviderHubError(
        "provider_unavailable",
        "Mock is restricted to tests, CI, and explicit development mode",
      );
    }
    const provider = this.#providerForConnection
      ? this.#providerForConnection(connection)
      : this.#providers[connection.adapterId];
    if (!provider || provider.id !== connection.adapterId) {
      throw new ProviderHubError(
        "provider_unavailable",
        `Adapter ${connection.adapterId} is unavailable`,
        { retryable: true, recoveryAction: "open-ai-settings" },
      );
    }
    const toolPolicy = this.#toolPolicies.get(profile.toolPolicyId);
    if (!toolPolicy || toolPolicy.role !== role) {
      throw new ProviderHubError(
        "tool_policy_unavailable",
        `Tool policy ${profile.toolPolicyId} is unavailable for ${role}`,
      );
    }
    return { role, profile, connection, provider, toolPolicy };
  }

  async resolveTurn(
    input: ResolveProviderTurnInput,
  ): Promise<ResolvedProviderTurn> {
    const inspected = this.inspect(input.role);
    const { connection, profile, provider } = inspected;
    const modelId = profile.modelId;
    if (modelId === null) {
      throw new ProviderHubError(
        "misconfigured",
        `Role profile ${input.role} has no exact model`,
      );
    }
    const status = await provider
      .getStatus(input.signal)
      .catch((error: unknown) => {
        throw new ProviderHubError(
          "provider_unavailable",
          `Provider ${connection.providerType} status is unavailable`,
          { retryable: true, cause: error },
        );
      });
    if (status.state !== "connected" && status.state !== "degraded") {
      const code = failureCodeForState(status.state);
      throw new ProviderHubError(
        code,
        status.message ??
          `Provider ${connection.providerType} is ${status.state}`,
        {
          retryable:
            status.state === "starting" || status.state === "unavailable",
          recoveryAction: "open-ai-settings",
        },
      );
    }
    const missingCapability = profile.requiredCapabilities.find(
      (capability) => !status.capabilities.includes(capability),
    );
    if (missingCapability) {
      throw new ProviderHubError(
        "capability_missing",
        `Provider ${connection.providerType} lacks ${missingCapability}`,
        { recoveryAction: "open-ai-settings" },
      );
    }
    const models = await provider
      .listModels(input.signal)
      .catch((error: unknown) => {
        throw new ProviderHubError(
          "provider_unavailable",
          `Models are unavailable for ${connection.providerType}`,
          { retryable: true, cause: error },
        );
      });
    const model = models.find(
      (candidate) =>
        candidate.id === modelId &&
        candidate.providerId === provider.id &&
        candidate.available,
    );
    if (!model) {
      throw new ProviderHubError(
        "model_unavailable",
        `Configured model ${modelId} is unavailable`,
        { recoveryAction: "open-ai-settings" },
      );
    }

    const disclosure = input.disclosure
      ? AiDisclosureSchema.parse(input.disclosure)
      : null;
    if (connection.external) {
      if (!disclosure || input.payloadSha256 === undefined) {
        throw new ProviderHubError(
          "disclosure_required",
          "External provider use requires an approved disclosure operation",
        );
      }
      const now = this.#now().getTime();
      const scope = disclosure.scope;
      if (
        disclosure.status !== "approved" ||
        Date.parse(disclosure.expiresAt) <= now ||
        scope.role !== input.role ||
        scope.connectionId !== connection.connectionId ||
        scope.providerType !== connection.providerType ||
        scope.modelId !== modelId ||
        scope.payloadSha256 !== input.payloadSha256
      ) {
        throw new ProviderHubError(
          "disclosure_mismatch",
          "Disclosure approval does not match this provider turn",
        );
      }
    }

    return {
      ...inspected,
      modelId,
      disclosure,
    };
  }
}

function failureCodeForState(
  state:
    | "disabled"
    | "starting"
    | "connected"
    | "degraded"
    | "authentication-required"
    | "unavailable"
    | "misconfigured"
    | "error",
): ProviderHubFailureCode {
  if (state === "authentication-required") return "authentication_required";
  if (state === "misconfigured") return "misconfigured";
  if (state === "disabled") return "connection_disabled";
  return state === "starting" || state === "unavailable"
    ? "provider_unavailable"
    : "provider_error";
}

function uniqueMap<K, V>(
  entries: readonly (readonly [K, V])[],
  label: string,
): ReadonlyMap<K, V> {
  const result = new Map<K, V>();
  for (const [key, value] of entries) {
    if (result.has(key)) throw new Error(`Duplicate ${label}: ${String(key)}`);
    result.set(key, value);
  }
  return result;
}
