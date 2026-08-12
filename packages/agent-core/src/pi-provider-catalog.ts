import type { AgentTool } from "@earendil-works/pi-agent-core";
import {
  createModels,
  createProvider,
  type AuthInteraction,
  type Credential,
  type CredentialInfo,
  type CredentialStore,
  type Model,
  type Provider,
} from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import { githubCopilotProvider } from "@earendil-works/pi-ai/providers/github-copilot";
import { googleProvider } from "@earendil-works/pi-ai/providers/google";
import { groqProvider } from "@earendil-works/pi-ai/providers/groq";
import { mistralProvider } from "@earendil-works/pi-ai/providers/mistral";
import { nvidiaProvider } from "@earendil-works/pi-ai/providers/nvidia";
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { opencodeProvider } from "@earendil-works/pi-ai/providers/opencode";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import type { CreateAgentSessionInput } from "@aptiloop/shared";

import { PiAgentProvider } from "./pi-agent-provider.js";
import type { toAptiloopAiRole } from "./roles.js";

export const PI_PROVIDER_CATALOG = [
  {
    id: "openai-api",
    providerType: "openai",
    displayName: "OpenAI API",
    authKind: "api-key",
    external: true,
    credentialLabel: "OPENAI_API_KEY",
  },
  {
    id: "openai-subscription",
    providerType: "openai-codex",
    displayName: "OpenAI Codex subscription",
    authKind: "subscription",
    external: true,
    credentialLabel: "ChatGPT Plus or Pro",
    recommendation: "overall",
  },
  {
    id: "anthropic-api",
    providerType: "anthropic",
    displayName: "Anthropic API",
    authKind: "api-key",
    external: true,
    credentialLabel: "ANTHROPIC_API_KEY",
  },
  {
    id: "anthropic-subscription",
    providerType: "anthropic",
    displayName: "Claude subscription",
    authKind: "subscription",
    external: true,
    credentialLabel: "Claude Pro or Max",
  },
  {
    id: "nvidia-api",
    providerType: "nvidia",
    displayName: "NVIDIA NIM",
    authKind: "api-key",
    external: true,
    credentialLabel: "NVIDIA_API_KEY",
  },
  {
    id: "opencode-api",
    providerType: "opencode",
    displayName: "OpenCode Zen",
    authKind: "api-key",
    external: true,
    credentialLabel: "OPENCODE_API_KEY",
    recommendation: "free",
  },
  {
    id: "google-api",
    providerType: "google",
    displayName: "Google Gemini",
    authKind: "api-key",
    external: true,
    credentialLabel: "GEMINI_API_KEY",
  },
  {
    id: "openrouter-api",
    providerType: "openrouter",
    displayName: "OpenRouter",
    authKind: "api-key",
    external: true,
    credentialLabel: "OPENROUTER_API_KEY",
  },
  {
    id: "deepseek-api",
    providerType: "deepseek",
    displayName: "DeepSeek",
    authKind: "api-key",
    external: true,
    credentialLabel: "DEEPSEEK_API_KEY",
  },
  {
    id: "mistral-api",
    providerType: "mistral",
    displayName: "Mistral",
    authKind: "api-key",
    external: true,
    credentialLabel: "MISTRAL_API_KEY",
  },
  {
    id: "groq-api",
    providerType: "groq",
    displayName: "Groq",
    authKind: "api-key",
    external: true,
    credentialLabel: "GROQ_API_KEY",
  },
  {
    id: "github-copilot-subscription",
    providerType: "github-copilot",
    displayName: "GitHub Copilot subscription",
    authKind: "subscription",
    external: true,
    credentialLabel: "GitHub Copilot",
  },
  {
    id: "custom-openai-compatible",
    providerType: "openai-compatible",
    displayName: "Custom OpenAI-compatible HTTPS",
    authKind: "api-key",
    external: true,
    credentialLabel: "Provider API key",
    endpointKind: "external",
  },
  {
    id: "ollama-local",
    providerType: "ollama",
    displayName: "Ollama",
    authKind: "local",
    external: false,
    defaultBaseUrl: "http://127.0.0.1:11434/v1",
    endpointKind: "loopback",
    recommendation: "private",
  },
  {
    id: "lm-studio-local",
    providerType: "lm-studio",
    displayName: "LM Studio",
    authKind: "local",
    external: false,
    defaultBaseUrl: "http://127.0.0.1:1234/v1",
    endpointKind: "loopback",
  },
] as const;

export type PiProviderCatalogEntry = (typeof PI_PROVIDER_CATALOG)[number];
export type PiProviderCatalogId = PiProviderCatalogEntry["id"];
export type PiProviderAuthKind = PiProviderCatalogEntry["authKind"];

export interface CreateCatalogPiProviderInput {
  readonly catalogId: PiProviderCatalogId;
  readonly connectionId: string;
  readonly credentials: CredentialStore;
  readonly baseUrl?: string;
  readonly modelIds?: readonly string[];
  readonly toolsForRole?: (
    role: ReturnType<typeof toAptiloopAiRole>,
    input: CreateAgentSessionInput,
  ) => readonly AgentTool[];
}

export function getPiProviderCatalogEntry(
  catalogId: PiProviderCatalogId,
): PiProviderCatalogEntry {
  const entry = PI_PROVIDER_CATALOG.find(
    (candidate) => candidate.id === catalogId,
  );
  if (!entry)
    throw new Error(`Unsupported Pi provider catalog id: ${catalogId}`);
  return entry;
}

export function createCatalogPiAgentProvider(
  input: CreateCatalogPiProviderInput,
): PiAgentProvider {
  const entry = getPiProviderCatalogEntry(input.catalogId);
  const provider = createCatalogProvider(entry, input);
  const models = createModels({
    credentials: input.credentials,
    authContext: {
      env: async () => undefined,
      fileExists: async () => false,
    },
  });
  models.setProvider(provider);
  return new PiAgentProvider({
    models,
    providerType: provider.id,
    adapterVersion: "0.84.1",
    ...(input.toolsForRole ? { toolsForRole: input.toolsForRole } : {}),
  });
}

function createCatalogProvider(
  entry: PiProviderCatalogEntry,
  input: CreateCatalogPiProviderInput,
): Provider {
  switch (entry.id) {
    case "openai-api":
      return openaiProvider();
    case "openai-subscription":
      return openaiCodexProvider();
    case "anthropic-api":
    case "anthropic-subscription":
      return anthropicProvider();
    case "nvidia-api":
      return nvidiaProvider();
    case "opencode-api":
      return opencodeProvider();
    case "google-api":
      return googleProvider();
    case "openrouter-api":
      return openrouterProvider();
    case "deepseek-api":
      return deepseekProvider();
    case "mistral-api":
      return mistralProvider();
    case "groq-api":
      return groqProvider();
    case "github-copilot-subscription":
      return githubCopilotProvider();
    case "custom-openai-compatible":
      return createCompatibleProvider(entry, input);
    case "ollama-local":
    case "lm-studio-local":
      return createCompatibleProvider(entry, input);
  }
}

function createCompatibleProvider(
  entry: Extract<
    PiProviderCatalogEntry,
    { id: "custom-openai-compatible" | "ollama-local" | "lm-studio-local" }
  >,
  input: CreateCatalogPiProviderInput,
): Provider<"openai-completions"> {
  const baseUrl =
    input.baseUrl ??
    ("defaultBaseUrl" in entry ? entry.defaultBaseUrl : undefined);
  if (!baseUrl) {
    throw new Error(
      `OpenAI-compatible provider ${entry.id} requires a base URL`,
    );
  }
  const providerId = `apt-compatible-${input.connectionId.replace(/[^a-z0-9-]/gu, "-")}`;
  const models: Model<"openai-completions">[] = (input.modelIds ?? []).map(
    (modelId) => ({
      id: modelId,
      name: modelId,
      api: "openai-completions",
      provider: providerId,
      baseUrl,
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128_000,
      maxTokens: 32_000,
      compat: {
        supportsDeveloperRole: false,
        supportsReasoningEffort: false,
      },
    }),
  );
  return createProvider({
    id: providerId,
    name: entry.displayName,
    baseUrl,
    auth: {
      apiKey: {
        name: entry.displayName,
        resolve: async ({ credential }) =>
          entry.authKind === "local"
            ? { auth: {}, source: "loopback local server" }
            : credential?.key
              ? {
                  auth: { apiKey: credential.key },
                  source: "Aptiloop local credential store",
                }
              : undefined,
      },
    },
    models,
    api: openAICompletionsApi(),
  });
}

export type PiAuthInteraction = AuthInteraction;
export type PiCredentialStore = CredentialStore;
export type PiCredential = Credential;
export type PiCredentialInfo = CredentialInfo;
