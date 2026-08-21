import { randomUUID } from "node:crypto";
import { isIP } from "node:net";

import {
  createCatalogPiAgentProvider,
  getPiProviderCatalogEntry,
  PI_PROVIDER_CATALOG,
  type AgentProvider,
  type PiAgentProvider,
  type PiAuthInteraction,
  type PiCredential,
  type PiProviderAuthKind,
} from "@aptiloop/agent-core";
import {
  ProviderHubRepository,
  type DatabaseConnection,
  type LearningRepository,
} from "@aptiloop/database";
import {
  ProviderLoginStatusSchema,
  type ProviderConnection,
  type ProviderLoginEvent,
  type ProviderLoginPrompt,
  type ProviderLoginStatus,
} from "@aptiloop/shared";
import { z } from "zod";

import { LocalPiCredentialStore } from "./local-pi-credential-store.js";

const catalogIds = [
  "openai-api",
  "openai-subscription",
  "anthropic-api",
  "anthropic-subscription",
  "nvidia-api",
  "opencode-api",
  "google-api",
  "openrouter-api",
  "deepseek-api",
  "mistral-api",
  "groq-api",
  "github-copilot-subscription",
  "custom-openai-compatible",
  "ollama-local",
  "lm-studio-local",
] as const;

const ProviderCatalogIdSchema = z.enum(catalogIds);
const StableConnectionIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[a-z0-9][a-z0-9._:-]*$/u);
const ModelIdSchema = z.string().trim().min(1).max(300);

const ManagedProviderConnectionSchema = z
  .object({
    connectionId: StableConnectionIdSchema,
    catalogId: ProviderCatalogIdSchema,
    displayName: z.string().trim().min(1).max(200),
    baseUrl: z.string().url().max(500).nullable(),
    modelIds: z.array(ModelIdSchema).max(50),
  })
  .strict();
type ManagedProviderConnection = z.infer<
  typeof ManagedProviderConnectionSchema
>;

const ManagedProviderSettingsSchema = z
  .object({
    version: z.literal(1),
    connections: z.array(ManagedProviderConnectionSchema).max(50),
  })
  .strict();

export const CreateProviderConnectionSchema = z
  .object({
    catalogId: ProviderCatalogIdSchema,
    displayName: z.string().trim().min(1).max(200),
    apiKey: z.string().trim().min(8).max(20_000).optional(),
    baseUrl: z.string().trim().url().max(500).optional(),
    modelIds: z.array(ModelIdSchema).max(50).default([]),
  })
  .strict();
export type CreateProviderConnectionInput = z.infer<
  typeof CreateProviderConnectionSchema
>;

export const SetProviderApiKeySchema = z
  .object({ apiKey: z.string().trim().min(8).max(20_000) })
  .strict();
export const ProviderLoginAnswerSchema = z
  .object({
    promptId: z.string().uuid(),
    answer: z.string().max(20_000),
  })
  .strict();

interface ProviderManagementOptions {
  readonly connection: DatabaseConnection;
  readonly repository: LearningRepository;
  readonly projectRoot: string;
  readonly connectionProviders: Map<string, AgentProvider>;
  readonly toolsForRole?: Parameters<
    typeof createCatalogPiAgentProvider
  >[0]["toolsForRole"];
  /** @internal Deterministic provider seam for boundary tests. */
  readonly createProvider?: typeof createCatalogPiAgentProvider;
  /** @internal Deterministic credential-store seam for boundary tests. */
  readonly credentialStore?: LocalPiCredentialStore;
  readonly now?: () => Date;
}

type LoginEvent = Parameters<PiAuthInteraction["notify"]>[0];
type LoginPrompt = Parameters<PiAuthInteraction["prompt"]>[0];

interface PendingLoginPrompt {
  readonly promptId: string;
  readonly view: ProviderLoginPrompt;
  readonly resolve: (answer: string) => void;
  readonly reject: (error: Error) => void;
}

interface LoginOperation {
  readonly operationId: string;
  readonly connectionId: string;
  readonly createdAt: number;
  readonly abortController: AbortController;
  readonly events: ProviderLoginEvent[];
  status: "running" | "completed" | "failed" | "cancelled";
  error: "provider-sign-in-failed" | null;
  prompt: PendingLoginPrompt | null;
  completion: Promise<void>;
}

const SETTINGS_KEY = "providerHubManagedConnections";
const LOGIN_TTL_MS = 10 * 60_000;

export class ProviderManagementService {
  readonly #repository: LearningRepository;
  readonly #hubRepository: ProviderHubRepository;
  readonly #credentials: LocalPiCredentialStore;
  readonly #connectionProviders: Map<string, AgentProvider>;
  readonly #toolsForRole: ProviderManagementOptions["toolsForRole"];
  readonly #createProvider: typeof createCatalogPiAgentProvider;
  readonly #now: () => Date;
  readonly #configs = new Map<string, ManagedProviderConnection>();
  readonly #piProviders = new Map<string, PiAgentProvider>();
  readonly #blockedLegacyCredentialIds = new Set<string>();
  readonly #blockedConnectionIdentityIds = new Set<string>();
  readonly #loginOperations = new Map<string, LoginOperation>();
  readonly #connectionMutationTails = new Map<string, Promise<void>>();
  readonly #retiringConnectionIds = new Set<string>();
  #loading: Promise<void> | null = null;
  #closing: Promise<void> | null = null;
  #shuttingDown = false;

  constructor(options: ProviderManagementOptions) {
    this.#repository = options.repository;
    this.#hubRepository = new ProviderHubRepository(options.connection);
    this.#credentials =
      options.credentialStore ??
      new LocalPiCredentialStore(options.projectRoot);
    this.#connectionProviders = options.connectionProviders;
    this.#toolsForRole = options.toolsForRole;
    this.#createProvider =
      options.createProvider ?? createCatalogPiAgentProvider;
    this.#now = options.now ?? (() => new Date());
  }

  ensureLoaded(): Promise<void> {
    this.#loading ??= this.#load();
    return this.#loading;
  }

  async describe() {
    await this.ensureLoaded();
    return {
      catalog: PI_PROVIDER_CATALOG.map((entry) => ({ ...entry })),
      connections: await Promise.all(
        [...this.#configs.values()].map(async (config) => {
          const entry = getPiProviderCatalogEntry(config.catalogId);
          const blockedLegacyCredential = this.#blockedLegacyCredentialIds.has(
            config.connectionId,
          );
          return {
            connectionId: config.connectionId,
            catalogId: config.catalogId,
            authKind: entry.authKind,
            credentialConfigured:
              !blockedLegacyCredential &&
              (entry.authKind === "local" ||
                (await this.#credentials.has(config.connectionId))),
            recoveryState: blockedLegacyCredential
              ? ("reauthentication-required" as const)
              : null,
            baseUrl: config.baseUrl,
            modelIds: [...config.modelIds],
          };
        }),
      ),
    };
  }

  async create(
    rawInput: CreateProviderConnectionInput,
  ): Promise<ProviderConnection> {
    await this.ensureLoaded();
    const input = CreateProviderConnectionSchema.parse(rawInput);
    const entry = getPiProviderCatalogEntry(input.catalogId);
    if (entry.authKind === "api-key" && !input.apiKey) {
      throw new Error(`${entry.displayName} requires an API key`);
    }
    if (entry.authKind !== "api-key" && input.apiKey) {
      throw new Error(`${entry.displayName} does not accept an API key`);
    }
    const endpointKind =
      "endpointKind" in entry ? entry.endpointKind : undefined;
    if (endpointKind && input.modelIds.length === 0) {
      throw new Error(
        "An OpenAI-compatible provider requires at least one exact model id",
      );
    }
    if (!endpointKind && (input.baseUrl || input.modelIds.length > 0)) {
      throw new Error(
        "Built-in providers own their endpoint and model catalog",
      );
    }
    const configuredBaseUrl =
      input.baseUrl ??
      ("defaultBaseUrl" in entry ? entry.defaultBaseUrl : undefined);
    const baseUrl =
      endpointKind === "loopback"
        ? validateLoopbackOpenAiBaseUrl(configuredBaseUrl)
        : endpointKind === "external"
          ? validateExternalOpenAiBaseUrl(configuredBaseUrl)
          : null;
    const modelIds = endpointKind ? uniqueModelIds(input.modelIds) : [];
    const connectionId = `conn:pi:${input.catalogId}:${randomUUID()}`;
    const config = ManagedProviderConnectionSchema.parse({
      connectionId,
      catalogId: input.catalogId,
      displayName: input.displayName,
      baseUrl,
      modelIds,
    });

    return this.#withConnectionMutation(connectionId, async () => {
      this.#assertConnectionWritable(connectionId);
      if (input.apiKey)
        await this.#credentials.setApiKey(connectionId, input.apiKey);
      this.#configs.set(connectionId, config);
      try {
        await this.#persistConfigs();
        const provider = this.#registerProvider(config);
        const now = this.#now().toISOString();
        const connection = this.#hubRepository.saveConnection({
          connectionId,
          adapterId: "pi",
          providerType: entry.providerType,
          displayName: config.displayName,
          credentialRef:
            entry.authKind === "local" ? null : `credential:${connectionId}`,
          endpointProfileId: baseUrl ? `endpoint:${connectionId}` : null,
          enabled: true,
          external: entry.external,
          state:
            entry.authKind === "subscription"
              ? "authentication-required"
              : "degraded",
          observedCapabilities: null,
          lastCheckedAt: now,
        });
        this.#connectionProviders.set(connectionId, provider);
        return connection;
      } catch (error) {
        this.#configs.delete(connectionId);
        this.#piProviders.delete(connectionId);
        this.#connectionProviders.delete(connectionId);
        await this.#credentials.delete(connectionId).catch(() => undefined);
        await this.#persistConfigs().catch(() => undefined);
        throw error;
      }
    });
  }

  beginShutdown(): void {
    if (this.#shuttingDown) return;
    this.#shuttingDown = true;
    for (const operation of this.#loginOperations.values()) {
      if (operation.status !== "running") continue;
      operation.status = "cancelled";
      operation.abortController.abort();
      operation.prompt?.reject(new Error("Provider sign-in stopped"));
      operation.prompt = null;
    }
  }

  close(): Promise<void> {
    this.#closing ??= this.#close();
    return this.#closing;
  }

  async #close(): Promise<void> {
    this.beginShutdown();
    await Promise.allSettled(
      [...this.#loginOperations.values()].map(
        (operation) => operation.completion,
      ),
    );
  }

  async setApiKey(connectionId: string, apiKey: string): Promise<void> {
    await this.ensureLoaded();
    await this.#withConnectionMutation(connectionId, async () => {
      this.#assertConnectionWritable(connectionId);
      const config = this.#requiredConfig(connectionId);
      const entry = getPiProviderCatalogEntry(config.catalogId);
      if (entry.authKind !== "api-key") {
        throw new Error(
          `${entry.displayName} does not use API-key authentication`,
        );
      }
      this.#assertConnectionIdentity(
        config,
        this.#requiredConnection(connectionId),
      );
      await this.#credentials.setApiKey(connectionId, apiKey);
      this.#assertConnectionWritable(connectionId);
      const provider = this.#registerProvider(config);
      this.#connectionProviders.set(connectionId, provider);
      this.#enableConnection(config, entry.authKind);
    });
  }

  async enableLocal(connectionId: string): Promise<void> {
    await this.ensureLoaded();
    await this.#withConnectionMutation(connectionId, async () => {
      this.#assertConnectionWritable(connectionId);
      const config = this.#requiredConfig(connectionId);
      const entry = getPiProviderCatalogEntry(config.catalogId);
      if (entry.authKind !== "local") {
        throw new Error(
          `${entry.displayName} requires credentials to reconnect`,
        );
      }
      this.#assertConnectionIdentity(
        config,
        this.#requiredConnection(connectionId),
      );
      const provider = this.#registerProvider(config);
      this.#connectionProviders.set(connectionId, provider);
      this.#enableConnection(config, entry.authKind);
    });
  }

  async disable(connectionId: string): Promise<void> {
    await this.ensureLoaded();
    await this.#withConnectionMutation(connectionId, async () => {
      this.#assertConnectionWritable(connectionId);
      const config = this.#requiredConfig(connectionId);
      const current = this.#requiredConnection(connectionId);
      this.#assertConnectionIdentity(config, current);
      await this.#abortAndAwaitLogins(connectionId, false);
      await this.#credentials.delete(connectionId);
      this.#blockedLegacyCredentialIds.delete(connectionId);
      this.#connectionProviders.delete(connectionId);
      this.#piProviders.delete(connectionId);
      this.#hubRepository.saveConnection({
        ...this.#catalogConnectionIdentity(config),
        enabled: false,
        state: "disabled",
        credentialRef: null,
        observedCapabilities: null,
        lastCheckedAt: this.#now().toISOString(),
      });
    });
  }

  async remove(connectionId: string): Promise<void> {
    await this.ensureLoaded();
    const parsedConnectionId = StableConnectionIdSchema.parse(connectionId);
    if (this.#retiringConnectionIds.has(parsedConnectionId)) {
      throw new Error("Provider connection is being removed");
    }
    this.#retiringConnectionIds.add(parsedConnectionId);
    try {
      await this.#withConnectionMutation(parsedConnectionId, async () => {
        const config = this.#requiredConfig(parsedConnectionId);
        const nextConfigs = new Map(this.#configs);
        nextConfigs.delete(parsedConnectionId);
        const persistedSettings = ManagedProviderSettingsSchema.parse({
          version: 1,
          connections: [...nextConfigs.values()],
        });

        await this.#abortAndAwaitLogins(parsedConnectionId, true);
        await this.#credentials.delete(parsedConnectionId);
        if (await this.#credentials.has(parsedConnectionId)) {
          throw new Error("Provider credential removal could not be verified");
        }
        try {
          const now = this.#now();
          this.#hubRepository.retireConnection({
            connectionId: parsedConnectionId,
            retiredAt: now.toISOString(),
            applicationSetting: {
              key: SETTINGS_KEY,
              valueJson: JSON.stringify(persistedSettings),
              updatedAt: now.getTime(),
            },
          });
        } catch (error) {
          // The connection stays active when its database transition fails. For
          // non-local providers it is now explicitly unauthenticated because its
          // local credential has already been erased.
          const entry = getPiProviderCatalogEntry(config.catalogId);
          const current = this.#requiredConnection(parsedConnectionId);
          this.#connectionProviders.delete(parsedConnectionId);
          this.#piProviders.delete(parsedConnectionId);
          if (entry.authKind !== "local") {
            this.#hubRepository.saveConnection({
              ...this.#catalogConnectionIdentity(config),
              enabled: current.enabled,
              credentialRef: null,
              state: "authentication-required",
              observedCapabilities: null,
              lastCheckedAt: this.#now().toISOString(),
            });
          }
          throw error;
        }

        this.#configs.delete(parsedConnectionId);
        this.#blockedLegacyCredentialIds.delete(parsedConnectionId);
        this.#blockedConnectionIdentityIds.delete(parsedConnectionId);
        this.#connectionProviders.delete(parsedConnectionId);
        this.#piProviders.delete(parsedConnectionId);
      });
    } finally {
      this.#retiringConnectionIds.delete(parsedConnectionId);
    }
  }

  async startLogin(connectionId: string): Promise<string> {
    await this.ensureLoaded();
    return this.#withConnectionMutation(connectionId, async () => {
      this.#assertConnectionWritable(connectionId);
      this.#pruneLoginOperations();
      const config = this.#requiredConfig(connectionId);
      const entry = getPiProviderCatalogEntry(config.catalogId);
      if (entry.authKind !== "subscription") {
        throw new Error(
          `${entry.displayName} does not use subscription sign-in`,
        );
      }
      this.#assertConnectionIdentity(
        config,
        this.#requiredConnection(connectionId),
      );
      if (
        [...this.#loginOperations.values()].some(
          (candidate) =>
            candidate.connectionId === connectionId &&
            candidate.status === "running",
        )
      ) {
        throw new Error(
          "A sign-in operation is already running for this connection",
        );
      }
      const provider = this.#registerProvider(config);
      this.#connectionProviders.set(connectionId, provider);
      const operationId = randomUUID();
      const operation: LoginOperation = {
        operationId,
        connectionId,
        createdAt: this.#now().getTime(),
        abortController: new AbortController(),
        events: [],
        status: "running",
        error: null,
        prompt: null,
        completion: Promise.resolve(),
      };
      this.#loginOperations.set(operationId, operation);
      const interaction: PiAuthInteraction = {
        signal: operation.abortController.signal,
        notify: (event) => {
          operation.events.push(
            normalizeProviderLoginEvent(config.catalogId, event),
          );
          if (operation.events.length > 50) operation.events.shift();
        },
        prompt: (prompt) => this.#waitForPrompt(operation, prompt),
      };
      const login = provider.login("oauth", interaction);
      operation.completion = login.then(
        () => undefined,
        () => undefined,
      );
      void login
        .then(() =>
          this.#withConnectionMutation(connectionId, async () => {
            this.#assertConnectionWritable(connectionId);
            if (
              operation.status !== "running" ||
              this.#loginOperations.get(operationId) !== operation
            ) {
              throw new Error("Provider sign-in is no longer active");
            }
            operation.status = "completed";
            operation.prompt = null;
            this.#blockedLegacyCredentialIds.delete(config.connectionId);
            this.#enableConnection(config, entry.authKind);
          }),
        )
        .catch((error: unknown) => {
          operation.prompt?.reject(new Error("Sign-in stopped"));
          operation.prompt = null;
          operation.status =
            operation.abortController.signal.aborted ||
            this.#retiringConnectionIds.has(connectionId)
              ? "cancelled"
              : "failed";
          operation.error =
            operation.status === "failed" ? "provider-sign-in-failed" : null;
          void error;
        });
      return operationId;
    });
  }

  loginStatus(operationId: string): ProviderLoginStatus {
    this.#pruneLoginOperations();
    const operation = this.#loginOperations.get(operationId);
    if (!operation) throw new Error("Unknown or expired sign-in operation");
    return ProviderLoginStatusSchema.parse({
      operationId: operation.operationId,
      connectionId: operation.connectionId,
      status: operation.status,
      events: operation.events.map((event) => ({ ...event })),
      prompt: operation.prompt ? operation.prompt.view : null,
      error: operation.error,
    });
  }

  answerLogin(operationId: string, promptId: string, answer: string): void {
    const operation = this.#loginOperations.get(operationId);
    if (!operation || operation.status !== "running") {
      throw new Error("Sign-in operation is not active");
    }
    const prompt = operation.prompt;
    if (!prompt || prompt.promptId !== promptId) {
      throw new Error("Sign-in prompt is no longer active");
    }
    const normalizedAnswer = normalizeProviderLoginAnswer(prompt.view, answer);
    operation.prompt = null;
    prompt.resolve(normalizedAnswer);
  }

  cancelLogin(operationId: string): void {
    const operation = this.#loginOperations.get(operationId);
    if (!operation || operation.status !== "running") return;
    operation.abortController.abort();
    operation.prompt?.reject(new Error("Sign-in cancelled"));
    operation.prompt = null;
    operation.status = "cancelled";
  }

  async #load(): Promise<void> {
    const raw = await this.#repository.getSetting<unknown>(SETTINGS_KEY);
    const settings = raw
      ? ManagedProviderSettingsSchema.parse(raw)
      : { version: 1 as const, connections: [] };
    const connections = new Map(
      this.#hubRepository
        .listConnections()
        .map((connection) => [connection.connectionId, connection] as const),
    );
    for (const config of settings.connections) {
      this.#configs.set(config.connectionId, config);
      const connection = connections.get(config.connectionId);
      if (!hasValidPersistedProviderConfig(config)) {
        this.#quarantineManagedConnection(config.connectionId, connection);
        continue;
      }
      if (
        connection &&
        !this.#hasExpectedConnectionIdentity(config, connection)
      ) {
        this.#quarantineManagedConnection(config.connectionId, connection);
        continue;
      }
      const credential = await this.#credentials.read(config.connectionId);
      if (hasUnsupportedLegacyGitHubCredential(config, credential)) {
        this.#blockedLegacyCredentialIds.add(config.connectionId);
        this.#piProviders.delete(config.connectionId);
        this.#connectionProviders.delete(config.connectionId);
        if (connection) {
          this.#hubRepository.saveConnection({
            ...connection,
            enabled: false,
            state: "misconfigured",
            observedCapabilities: null,
            lastCheckedAt: this.#now().toISOString(),
          });
        }
        continue;
      }
      if (!connection?.enabled) continue;
      const provider = this.#registerProvider(config);
      this.#connectionProviders.set(config.connectionId, provider);
    }
  }

  #registerProvider(config: ManagedProviderConnection): PiAgentProvider {
    this.#assertConnectionWritable(config.connectionId);
    const existing = this.#piProviders.get(config.connectionId);
    if (existing) return existing;
    const provider = this.#createProvider({
      catalogId: config.catalogId,
      connectionId: config.connectionId,
      credentials: this.#credentials.scope(config.connectionId),
      ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}),
      modelIds: config.modelIds,
      ...(this.#toolsForRole ? { toolsForRole: this.#toolsForRole } : {}),
    });
    this.#piProviders.set(config.connectionId, provider);
    return provider;
  }

  #enableConnection(
    config: ManagedProviderConnection,
    authKind: PiProviderAuthKind,
  ): void {
    this.#assertConnectionWritable(config.connectionId);
    const current = this.#requiredConnection(config.connectionId);
    this.#assertConnectionIdentity(config, current);
    this.#hubRepository.saveConnection({
      ...this.#catalogConnectionIdentity(config),
      enabled: true,
      state: "degraded",
      credentialRef:
        authKind === "local" ? null : `credential:${config.connectionId}`,
      observedCapabilities: null,
      lastCheckedAt: this.#now().toISOString(),
    });
  }

  #catalogConnectionIdentity(
    config: ManagedProviderConnection,
  ): ProviderConnection {
    const entry = getPiProviderCatalogEntry(config.catalogId);
    return {
      connectionId: config.connectionId,
      adapterId: "pi",
      providerType: entry.providerType,
      displayName: config.displayName,
      credentialRef:
        entry.authKind === "local" ? null : `credential:${config.connectionId}`,
      endpointProfileId: config.baseUrl
        ? `endpoint:${config.connectionId}`
        : null,
      enabled: false,
      external: entry.external,
      state: "disabled",
      observedCapabilities: null,
      lastCheckedAt: null,
    };
  }

  #hasExpectedConnectionIdentity(
    config: ManagedProviderConnection,
    connection: ProviderConnection,
  ): boolean {
    const expected = this.#catalogConnectionIdentity(config);
    return (
      connection.connectionId === expected.connectionId &&
      connection.adapterId === expected.adapterId &&
      connection.providerType === expected.providerType &&
      connection.displayName === expected.displayName &&
      connection.external === expected.external &&
      connection.endpointProfileId === expected.endpointProfileId
    );
  }

  #assertConnectionIdentity(
    config: ManagedProviderConnection,
    connection: ProviderConnection,
  ): void {
    if (
      this.#blockedConnectionIdentityIds.has(config.connectionId) ||
      !this.#hasExpectedConnectionIdentity(config, connection)
    ) {
      throw new Error(
        "Managed provider connection metadata does not match the reviewed catalog",
      );
    }
  }

  #assertConnectionWritable(connectionId: string): void {
    if (this.#shuttingDown) {
      throw new Error("Provider management is shutting down");
    }
    if (this.#retiringConnectionIds.has(connectionId)) {
      throw new Error("Provider connection is being removed");
    }
    if (this.#blockedConnectionIdentityIds.has(connectionId)) {
      throw new Error(
        "Managed provider connection metadata does not match the reviewed catalog",
      );
    }
  }

  #quarantineManagedConnection(
    connectionId: string,
    connection: ProviderConnection | undefined,
  ): void {
    this.#blockedConnectionIdentityIds.add(connectionId);
    this.#piProviders.delete(connectionId);
    this.#connectionProviders.delete(connectionId);
    if (!connection) return;
    this.#hubRepository.saveConnection({
      ...connection,
      enabled: false,
      state: "misconfigured",
      credentialRef: null,
      observedCapabilities: null,
      lastCheckedAt: this.#now().toISOString(),
    });
  }

  async #abortAndAwaitLogins(
    connectionId: string,
    removeOperations: boolean,
  ): Promise<void> {
    const matches = [...this.#loginOperations.entries()].filter(
      ([, operation]) => operation.connectionId === connectionId,
    );
    for (const [, operation] of matches) {
      if (operation.status === "running") {
        operation.status = "cancelled";
        operation.abortController.abort();
        operation.prompt?.reject(new Error("Connection removed"));
        operation.prompt = null;
      }
    }
    await Promise.allSettled(
      matches.map(([, operation]) => operation.completion),
    );
    if (removeOperations) {
      for (const [operationId] of matches) {
        this.#loginOperations.delete(operationId);
      }
    }
  }

  async #withConnectionMutation<T>(
    connectionId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.#connectionMutationTails.get(connectionId);
    const waitForPrevious = previous ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.#connectionMutationTails.set(connectionId, current);
    await waitForPrevious;
    try {
      return await operation();
    } finally {
      release();
      if (this.#connectionMutationTails.get(connectionId) === current) {
        this.#connectionMutationTails.delete(connectionId);
      }
    }
  }

  #requiredConfig(connectionId: string): ManagedProviderConnection {
    const parsedId = StableConnectionIdSchema.parse(connectionId);
    const config = this.#configs.get(parsedId);
    if (!config) throw new Error("Managed provider connection was not found");
    return config;
  }

  #requiredConnection(connectionId: string): ProviderConnection {
    const connection = this.#hubRepository
      .listConnections()
      .find((candidate) => candidate.connectionId === connectionId);
    if (!connection) throw new Error("Provider connection was not found");
    return connection;
  }

  async #persistConfigs(): Promise<void> {
    await this.#repository.setSetting(SETTINGS_KEY, {
      version: 1,
      connections: [...this.#configs.values()],
    });
  }

  #waitForPrompt(
    operation: LoginOperation,
    rawPrompt: LoginPrompt,
  ): Promise<string> {
    if (operation.prompt) {
      throw new Error("Provider produced overlapping sign-in prompts");
    }
    return new Promise<string>((resolve, reject) => {
      const promptId = randomUUID();
      const normalizedPrompt = normalizeProviderLoginPrompt(
        this.#requiredConfig(operation.connectionId).catalogId,
        promptId,
        rawPrompt,
      );
      const onAbort = () => {
        operation.abortController.signal.removeEventListener("abort", onAbort);
        reject(new Error("Sign-in cancelled"));
      };
      operation.abortController.signal.addEventListener("abort", onAbort, {
        once: true,
      });
      operation.prompt = {
        promptId,
        view: normalizedPrompt,
        resolve: (answer) => {
          operation.abortController.signal.removeEventListener(
            "abort",
            onAbort,
          );
          resolve(answer);
        },
        reject: (error) => {
          operation.abortController.signal.removeEventListener(
            "abort",
            onAbort,
          );
          reject(error);
        },
      };
    });
  }

  #pruneLoginOperations(): void {
    const cutoff = this.#now().getTime() - LOGIN_TTL_MS;
    for (const [operationId, operation] of this.#loginOperations) {
      if (operation.createdAt >= cutoff) continue;
      operation.abortController.abort();
      this.#loginOperations.delete(operationId);
    }
  }
}

function hasUnsupportedLegacyGitHubCredential(
  config: ManagedProviderConnection,
  credential: PiCredential | undefined,
): boolean {
  return (
    config.catalogId === "github-copilot-subscription" &&
    credential?.type === "oauth" &&
    typeof credential.enterpriseUrl === "string" &&
    credential.enterpriseUrl.trim().length > 0
  );
}

function hasValidPersistedProviderConfig(
  config: ManagedProviderConnection,
): boolean {
  const entry = getPiProviderCatalogEntry(config.catalogId);
  const endpointKind = "endpointKind" in entry ? entry.endpointKind : undefined;
  try {
    if (!endpointKind) {
      return config.baseUrl === null && config.modelIds.length === 0;
    }
    if (config.baseUrl === null || config.modelIds.length === 0) return false;
    if (uniqueModelIds(config.modelIds).length !== config.modelIds.length) {
      return false;
    }
    if (endpointKind === "loopback") {
      return validateLoopbackOpenAiBaseUrl(config.baseUrl) === config.baseUrl;
    }
    return validateExternalOpenAiBaseUrl(config.baseUrl) === config.baseUrl;
  } catch {
    return false;
  }
}

function uniqueModelIds(modelIds: readonly string[]): string[] {
  const result = [...new Set(modelIds.map((modelId) => modelId.trim()))];
  if (result.length !== modelIds.length) {
    throw new Error("Local model ids must be unique");
  }
  return result;
}

function validateLoopbackOpenAiBaseUrl(value: string | undefined): string {
  if (!value) throw new Error("A local provider requires a loopback base URL");
  const url = new URL(value);
  const hostname = url.hostname.toLowerCase();
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !["/v1", "/v1/"].includes(url.pathname)
  ) {
    throw new Error(
      "Local model endpoints must be loopback HTTP URLs ending in /v1",
    );
  }
  url.pathname = "/v1";
  return url.toString().replace(/\/$/u, "");
}

function validateExternalOpenAiBaseUrl(value: string | undefined): string {
  if (!value) {
    throw new Error(
      "A custom OpenAI-compatible provider requires an HTTPS base URL",
    );
  }
  const url = new URL(value);
  const hostname = url.hostname.toLowerCase();
  const unwrappedHostname = hostname.replace(/^\[|\]$/gu, "");
  const pathname = url.pathname.replace(/\/+$/u, "");
  const deniedSuffixes = [
    ".localhost",
    ".local",
    ".internal",
    ".lan",
    ".home",
    ".arpa",
    ".test",
    ".invalid",
  ];
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    isIP(unwrappedHostname) !== 0 ||
    !hostname.includes(".") ||
    hostname === "localhost" ||
    deniedSuffixes.some((suffix) => hostname.endsWith(suffix)) ||
    !pathname.endsWith("/v1")
  ) {
    throw new Error(
      "Custom provider endpoints must be public HTTPS hostnames on port 443 with a path ending in /v1",
    );
  }
  url.pathname = pathname;
  return url.toString();
}

export function normalizeProviderLoginPrompt(
  catalogId: (typeof catalogIds)[number],
  promptId: string,
  rawPrompt: LoginPrompt,
): ProviderLoginPrompt {
  if (
    catalogId === "github-copilot-subscription" &&
    rawPrompt.type === "text" &&
    rawPrompt.message ===
      "GitHub Enterprise URL/domain (blank for github.com)" &&
    rawPrompt.placeholder === "company.ghe.com"
  ) {
    return {
      promptId,
      kind: "github-enterprise-domain",
      type: "text",
      optional: true,
      options: [],
    };
  }
  if (
    catalogId === "openai-subscription" &&
    rawPrompt.type === "select" &&
    rawPrompt.message === "Select OpenAI Codex login method:" &&
    rawPrompt.options.length === 2 &&
    rawPrompt.options[0]?.id === "browser" &&
    rawPrompt.options[0].label === "Browser login (default)" &&
    rawPrompt.options[0].description === undefined &&
    rawPrompt.options[1]?.id === "device_code" &&
    rawPrompt.options[1].label === "Device code login (headless)" &&
    rawPrompt.options[1].description === undefined
  ) {
    return {
      promptId,
      kind: "openai-codex-login-method",
      type: "select",
      optional: false,
      options: ["browser", "device_code"],
    };
  }
  if (
    ["openai-subscription", "anthropic-subscription"].includes(catalogId) &&
    rawPrompt.type === "manual_code" &&
    rawPrompt.message ===
      "Complete login in your browser, or paste the authorization code / redirect URL here:"
  ) {
    return {
      promptId,
      kind: "oauth-authorization-code",
      type: "manual_code",
      optional: false,
      options: [],
    };
  }
  throw new Error("Provider produced an unsupported sign-in prompt");
}

export function normalizeProviderLoginAnswer(
  prompt: ProviderLoginPrompt,
  answer: string,
): string {
  const normalizedAnswer = answer.trim();
  if (prompt.kind === "github-enterprise-domain") {
    if (normalizedAnswer.length > 0) {
      throw new Error(
        "GitHub Enterprise sign-in is not supported by the current endpoint policy",
      );
    }
    return "";
  }
  if (!normalizedAnswer) {
    throw new Error("Sign-in prompt requires an answer");
  }
  if (
    prompt.type === "select" &&
    !prompt.options.includes(
      normalizedAnswer as (typeof prompt.options)[number],
    )
  ) {
    throw new Error("Sign-in prompt answer is not an allowed option");
  }
  return normalizedAnswer;
}

export function normalizeProviderLoginEvent(
  catalogId: (typeof catalogIds)[number],
  event: LoginEvent,
): ProviderLoginEvent {
  if (event.type === "auth_url") {
    const url = validateProviderLoginUrl(catalogId, event.url, "auth");
    return {
      type: "auth_url",
      url,
    };
  }
  if (event.type === "device_code") {
    const userCode = event.userCode.trim();
    if (!userCode || userCode.length > 128) {
      throw new Error("Provider returned an invalid device code");
    }
    return {
      type: "device_code",
      userCode,
      verificationUri: validateProviderLoginUrl(
        catalogId,
        event.verificationUri,
        "device",
      ),
    };
  }
  return { type: "progress" };
}

function validateProviderLoginUrl(
  catalogId: (typeof catalogIds)[number],
  value: string,
  purpose: "auth" | "device",
): string {
  const url = new URL(value);
  const expected =
    catalogId === "openai-subscription" && purpose === "auth"
      ? { hostname: "auth.openai.com", pathname: "/oauth/authorize" }
      : catalogId === "openai-subscription" && purpose === "device"
        ? { hostname: "auth.openai.com", pathname: "/codex/device" }
        : catalogId === "anthropic-subscription" && purpose === "auth"
          ? { hostname: "claude.ai", pathname: "/oauth/authorize" }
          : catalogId === "github-copilot-subscription" && purpose === "device"
            ? { hostname: "github.com", pathname: "/login/device" }
            : null;
  if (
    !expected ||
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.hostname.toLowerCase() !== expected.hostname ||
    url.pathname !== expected.pathname ||
    url.hash ||
    (purpose === "device" && url.search)
  ) {
    throw new Error("Provider returned an unsupported sign-in URL");
  }
  return url.toString();
}
