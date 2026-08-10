import { randomUUID } from "node:crypto";
import { isIP } from "node:net";

import {
  createCatalogPiAgentProvider,
  getPiProviderCatalogEntry,
  PI_PROVIDER_CATALOG,
  type AgentProvider,
  type PiAgentProvider,
  type PiAuthInteraction,
  type PiProviderAuthKind,
} from "@dlh/agent-core";
import {
  ProviderHubRepository,
  type DatabaseConnection,
  type LearningRepository,
} from "@dlh/database";
import type { ProviderConnection } from "@dlh/shared";
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

export const ProviderCatalogIdSchema = z.enum(catalogIds);
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
    answer: z.string().min(1).max(20_000),
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
  readonly now?: () => Date;
}

type LoginEvent = Parameters<PiAuthInteraction["notify"]>[0];
type LoginPrompt = Parameters<PiAuthInteraction["prompt"]>[0];

interface PendingLoginPrompt {
  readonly promptId: string;
  readonly type: LoginPrompt["type"];
  readonly message: string;
  readonly placeholder: string | null;
  readonly options: ReadonlyArray<{
    readonly id: string;
    readonly label: string;
    readonly description?: string;
  }>;
  readonly resolve: (answer: string) => void;
  readonly reject: (error: Error) => void;
}

interface LoginOperation {
  readonly operationId: string;
  readonly connectionId: string;
  readonly createdAt: number;
  readonly abortController: AbortController;
  readonly events: LoginEvent[];
  status: "running" | "completed" | "failed" | "cancelled";
  error: string | null;
  prompt: PendingLoginPrompt | null;
}

const SETTINGS_KEY = "providerHubManagedConnections";
const LOGIN_TTL_MS = 10 * 60_000;

export class ProviderManagementService {
  readonly #repository: LearningRepository;
  readonly #hubRepository: ProviderHubRepository;
  readonly #credentials: LocalPiCredentialStore;
  readonly #connectionProviders: Map<string, AgentProvider>;
  readonly #toolsForRole: ProviderManagementOptions["toolsForRole"];
  readonly #now: () => Date;
  readonly #configs = new Map<string, ManagedProviderConnection>();
  readonly #piProviders = new Map<string, PiAgentProvider>();
  readonly #loginOperations = new Map<string, LoginOperation>();
  #loading: Promise<void> | null = null;

  constructor(options: ProviderManagementOptions) {
    this.#repository = options.repository;
    this.#hubRepository = new ProviderHubRepository(options.connection);
    this.#credentials = new LocalPiCredentialStore(options.projectRoot);
    this.#connectionProviders = options.connectionProviders;
    this.#toolsForRole = options.toolsForRole;
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
          return {
            connectionId: config.connectionId,
            catalogId: config.catalogId,
            authKind: entry.authKind,
            credentialConfigured:
              entry.authKind === "local" ||
              (await this.#credentials.has(config.connectionId)),
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
  }

  async setApiKey(connectionId: string, apiKey: string): Promise<void> {
    await this.ensureLoaded();
    const config = this.#requiredConfig(connectionId);
    const entry = getPiProviderCatalogEntry(config.catalogId);
    if (entry.authKind !== "api-key") {
      throw new Error(
        `${entry.displayName} does not use API-key authentication`,
      );
    }
    await this.#credentials.setApiKey(connectionId, apiKey);
    const provider = this.#registerProvider(config);
    this.#connectionProviders.set(connectionId, provider);
    this.#enableConnection(config, entry.authKind);
  }

  async enableLocal(connectionId: string): Promise<void> {
    await this.ensureLoaded();
    const config = this.#requiredConfig(connectionId);
    const entry = getPiProviderCatalogEntry(config.catalogId);
    if (entry.authKind !== "local") {
      throw new Error(`${entry.displayName} requires credentials to reconnect`);
    }
    const provider = this.#registerProvider(config);
    this.#connectionProviders.set(connectionId, provider);
    this.#enableConnection(config, entry.authKind);
  }

  async disable(connectionId: string): Promise<void> {
    await this.ensureLoaded();
    const config = this.#requiredConfig(connectionId);
    const current = this.#requiredConnection(connectionId);
    await this.#credentials.delete(connectionId);
    this.#connectionProviders.delete(connectionId);
    this.#piProviders.delete(connectionId);
    this.#hubRepository.saveConnection({
      ...current,
      enabled: false,
      state: "disabled",
      observedCapabilities: null,
      lastCheckedAt: this.#now().toISOString(),
      credentialRef: null,
    });
    const operation = [...this.#loginOperations.values()].find(
      (candidate) =>
        candidate.connectionId === config.connectionId &&
        candidate.status === "running",
    );
    operation?.abortController.abort();
  }

  async startLogin(connectionId: string): Promise<string> {
    await this.ensureLoaded();
    this.#pruneLoginOperations();
    const config = this.#requiredConfig(connectionId);
    const entry = getPiProviderCatalogEntry(config.catalogId);
    if (entry.authKind !== "subscription") {
      throw new Error(`${entry.displayName} does not use subscription sign-in`);
    }
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
    };
    this.#loginOperations.set(operationId, operation);
    const interaction: PiAuthInteraction = {
      signal: operation.abortController.signal,
      notify: (event) => {
        operation.events.push(sanitizeLoginEvent(event));
        if (operation.events.length > 50) operation.events.shift();
      },
      prompt: (prompt) => this.#waitForPrompt(operation, prompt),
    };
    void provider
      .login("oauth", interaction)
      .then(() => {
        operation.status = "completed";
        operation.prompt = null;
        this.#enableConnection(config, entry.authKind);
      })
      .catch((error: unknown) => {
        operation.prompt?.reject(new Error("Sign-in stopped"));
        operation.prompt = null;
        operation.status = operation.abortController.signal.aborted
          ? "cancelled"
          : "failed";
        operation.error =
          operation.status === "failed" ? safeMessage(error) : null;
      });
    return operationId;
  }

  loginStatus(operationId: string) {
    this.#pruneLoginOperations();
    const operation = this.#loginOperations.get(operationId);
    if (!operation) throw new Error("Unknown or expired sign-in operation");
    return {
      operationId: operation.operationId,
      connectionId: operation.connectionId,
      status: operation.status,
      events: operation.events.map((event) => ({ ...event })),
      prompt: operation.prompt
        ? {
            promptId: operation.prompt.promptId,
            type: operation.prompt.type,
            message: operation.prompt.message,
            placeholder: operation.prompt.placeholder,
            options: operation.prompt.options.map((option) => ({ ...option })),
          }
        : null,
      error: operation.error,
    };
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
    operation.prompt = null;
    prompt.resolve(answer);
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
    for (const config of settings.connections) {
      this.#configs.set(config.connectionId, config);
      const connection = this.#hubRepository
        .listConnections()
        .find((candidate) => candidate.connectionId === config.connectionId);
      if (!connection?.enabled) continue;
      const provider = this.#registerProvider(config);
      this.#connectionProviders.set(config.connectionId, provider);
    }
  }

  #registerProvider(config: ManagedProviderConnection): PiAgentProvider {
    const existing = this.#piProviders.get(config.connectionId);
    if (existing) return existing;
    const provider = createCatalogPiAgentProvider({
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
    const current = this.#requiredConnection(config.connectionId);
    this.#hubRepository.saveConnection({
      ...current,
      enabled: true,
      state: "degraded",
      credentialRef:
        authKind === "local" ? null : `credential:${config.connectionId}`,
      observedCapabilities: null,
      lastCheckedAt: this.#now().toISOString(),
    });
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
      const onAbort = () => {
        operation.abortController.signal.removeEventListener("abort", onAbort);
        reject(new Error("Sign-in cancelled"));
      };
      operation.abortController.signal.addEventListener("abort", onAbort, {
        once: true,
      });
      operation.prompt = {
        promptId,
        type: rawPrompt.type,
        message: rawPrompt.message.slice(0, 2_000),
        placeholder:
          "placeholder" in rawPrompt
            ? (rawPrompt.placeholder?.slice(0, 500) ?? null)
            : null,
        options:
          rawPrompt.type === "select"
            ? rawPrompt.options.slice(0, 20).map((option) => ({ ...option }))
            : [],
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

function sanitizeLoginEvent(event: LoginEvent): LoginEvent {
  if (event.type === "auth_url") {
    const url = new URL(event.url);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new Error("Provider returned an unsafe sign-in URL");
    }
    return {
      ...event,
      url: url.toString(),
      ...(event.instructions
        ? { instructions: event.instructions.slice(0, 2_000) }
        : {}),
    };
  }
  if (event.type === "device_code") {
    const url = new URL(event.verificationUri);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new Error("Provider returned an unsafe verification URL");
    }
    return { ...event, verificationUri: url.toString() };
  }
  if (event.type === "info") {
    return {
      ...event,
      message: event.message.slice(0, 2_000),
      ...(event.links
        ? { links: event.links.slice(0, 10).map((link) => ({ ...link })) }
        : {}),
    };
  }
  return { ...event, message: event.message.slice(0, 2_000) };
}

function safeMessage(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message.slice(0, 500)
    : "Provider sign-in failed";
}
