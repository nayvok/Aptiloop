import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { AgentProvider } from "@aptiloop/agent-core";
import {
  createLearningRepository,
  migrateDatabase,
  openDatabase,
  ProviderHubRepository,
  type DatabaseConnection,
} from "@aptiloop/database";
import type { ProviderId } from "@aptiloop/shared";
import { describe, expect, it, vi } from "vitest";

import {
  ProviderManagementService,
  normalizeProviderLoginAnswer,
  normalizeProviderLoginEvent,
  normalizeProviderLoginPrompt,
} from "../src/provider-management.js";
import { ProviderRuntime } from "../src/provider-runtime.js";

const promptId = "88a6558f-d070-478e-adbc-18678089cb43";
const githubPrompt = {
  type: "text",
  message: "GitHub Enterprise URL/domain (blank for github.com)",
  placeholder: "company.ghe.com",
} as const;
const openAiPrompt = {
  type: "select",
  message: "Select OpenAI Codex login method:",
  options: [
    { id: "browser", label: "Browser login (default)" },
    { id: "device_code", label: "Device code login (headless)" },
  ],
} as const;

describe("provider login boundary", () => {
  it("maps the exact GitHub prompt to the optional app-owned prompt", () => {
    const prompt = normalizeProviderLoginPrompt(
      "github-copilot-subscription",
      promptId,
      githubPrompt,
    );

    expect(prompt).toEqual({
      promptId,
      kind: "github-enterprise-domain",
      type: "text",
      optional: true,
      options: [],
    });
    expect(JSON.stringify(prompt)).not.toContain(githubPrompt.message);
    expect(JSON.stringify(prompt)).not.toContain(githubPrompt.placeholder);
    expect(normalizeProviderLoginAnswer(prompt, "")).toBe("");
    expect(normalizeProviderLoginAnswer(prompt, "   ")).toBe("");
  });

  it.each([
    "github.example.com",
    "localhost",
    "127.0.0.1",
    "https://github.example.com",
    "enterprise",
  ])("rejects the nonblank GitHub enterprise answer %j", (answer) => {
    const prompt = normalizeProviderLoginPrompt(
      "github-copilot-subscription",
      promptId,
      githubPrompt,
    );

    expect(() => normalizeProviderLoginAnswer(prompt, answer)).toThrow(
      "GitHub Enterprise sign-in is not supported by the current endpoint policy",
    );
  });

  it("maps the exact OpenAI prompt to finite app-owned choices", () => {
    const prompt = normalizeProviderLoginPrompt(
      "openai-subscription",
      promptId,
      openAiPrompt,
    );

    expect(prompt).toEqual({
      promptId,
      kind: "openai-codex-login-method",
      type: "select",
      optional: false,
      options: ["browser", "device_code"],
    });
    expect(JSON.stringify(prompt)).not.toContain("Browser login (default)");
    expect(JSON.stringify(prompt)).not.toContain(
      "Device code login (headless)",
    );
    expect(normalizeProviderLoginAnswer(prompt, "browser")).toBe("browser");
    expect(normalizeProviderLoginAnswer(prompt, "device_code")).toBe(
      "device_code",
    );
  });

  it.each(["", "   ", "forged", "Browser", "device-code"])(
    "rejects the invalid OpenAI choice %j",
    (answer) => {
      const prompt = normalizeProviderLoginPrompt(
        "openai-subscription",
        promptId,
        openAiPrompt,
      );

      expect(() => normalizeProviderLoginAnswer(prompt, answer)).toThrow();
    },
  );

  const promptDriftCases = [
    {
      name: "changed GitHub message",
      catalogId: "github-copilot-subscription",
      prompt: { ...githubPrompt, message: "Enter an enterprise domain" },
    },
    {
      name: "changed GitHub placeholder",
      catalogId: "github-copilot-subscription",
      prompt: { ...githubPrompt, placeholder: "github.example.com" },
    },
    {
      name: "changed OpenAI message",
      catalogId: "openai-subscription",
      prompt: { ...openAiPrompt, message: "Choose a login method" },
    },
    {
      name: "changed OpenAI label",
      catalogId: "openai-subscription",
      prompt: {
        ...openAiPrompt,
        options: [
          { id: "browser", label: "Browser sign-in" },
          openAiPrompt.options[1],
        ],
      },
    },
    {
      name: "OpenAI option description",
      catalogId: "openai-subscription",
      prompt: {
        ...openAiPrompt,
        options: [
          { ...openAiPrompt.options[0], description: "Provider copy" },
          openAiPrompt.options[1],
        ],
      },
    },
    {
      name: "reordered OpenAI options",
      catalogId: "openai-subscription",
      prompt: {
        ...openAiPrompt,
        options: [openAiPrompt.options[1], openAiPrompt.options[0]],
      },
    },
    {
      name: "cross-provider prompt",
      catalogId: "anthropic-subscription",
      prompt: openAiPrompt,
    },
  ] satisfies ReadonlyArray<{
    name: string;
    catalogId: Parameters<typeof normalizeProviderLoginPrompt>[0];
    prompt: Parameters<typeof normalizeProviderLoginPrompt>[2];
  }>;

  it.each(promptDriftCases)("rejects $name", ({ catalogId, prompt }) => {
    expect(() =>
      normalizeProviderLoginPrompt(catalogId, promptId, prompt),
    ).toThrow("Provider produced an unsupported sign-in prompt");
  });

  it("discards raw provider event copy", () => {
    const info = normalizeProviderLoginEvent("openai-subscription", {
      type: "info",
      message: "raw provider message with a secret",
      links: [
        {
          label: "raw provider label",
          url: "https://untrusted.example/sign-in",
        },
      ],
    });
    const progress = normalizeProviderLoginEvent("openai-subscription", {
      type: "progress",
      message: "raw provider progress",
    });

    expect(info).toEqual({ type: "progress" });
    expect(progress).toEqual({ type: "progress" });
    expect(JSON.stringify([info, progress])).not.toMatch(/raw provider/u);
  });

  it("accepts only app-allowlisted OpenAI and GitHub login URLs", () => {
    expect(
      normalizeProviderLoginEvent("openai-subscription", {
        type: "auth_url",
        url: "https://auth.openai.com/oauth/authorize?state=opaque",
        instructions: "raw provider instructions",
      }),
    ).toEqual({
      type: "auth_url",
      url: "https://auth.openai.com/oauth/authorize?state=opaque",
    });
    expect(
      normalizeProviderLoginEvent("openai-subscription", {
        type: "device_code",
        userCode: "OPENAI-CODE",
        verificationUri: "https://auth.openai.com/codex/device",
      }),
    ).toEqual({
      type: "device_code",
      userCode: "OPENAI-CODE",
      verificationUri: "https://auth.openai.com/codex/device",
    });
    expect(
      normalizeProviderLoginEvent("github-copilot-subscription", {
        type: "device_code",
        userCode: "GITHUB-CODE",
        verificationUri: "https://github.com/login/device",
      }),
    ).toEqual({
      type: "device_code",
      userCode: "GITHUB-CODE",
      verificationUri: "https://github.com/login/device",
    });
  });

  const rejectedUrlEvents = [
    {
      name: "alternate OpenAI host",
      catalogId: "openai-subscription",
      event: {
        type: "auth_url",
        url: "https://auth.openai.com.attacker.example/oauth/authorize",
      },
    },
    {
      name: "OpenAI HTTP URL",
      catalogId: "openai-subscription",
      event: {
        type: "auth_url",
        url: "http://auth.openai.com/oauth/authorize",
      },
    },
    {
      name: "OpenAI wrong auth path",
      catalogId: "openai-subscription",
      event: {
        type: "auth_url",
        url: "https://auth.openai.com/oauth/token?state=opaque",
      },
    },
    {
      name: "OpenAI auth fragment",
      catalogId: "openai-subscription",
      event: {
        type: "auth_url",
        url: "https://auth.openai.com/oauth/authorize?state=opaque#secret",
      },
    },
    {
      name: "OpenAI device query",
      catalogId: "openai-subscription",
      event: {
        type: "device_code",
        userCode: "CODE",
        verificationUri: "https://auth.openai.com/codex/device?next=evil",
      },
    },
    {
      name: "alternate GitHub host",
      catalogId: "github-copilot-subscription",
      event: {
        type: "device_code",
        userCode: "CODE",
        verificationUri: "https://github.com.attacker.example/login/device",
      },
    },
    {
      name: "GitHub HTTP URL",
      catalogId: "github-copilot-subscription",
      event: {
        type: "device_code",
        userCode: "CODE",
        verificationUri: "http://github.com/login/device",
      },
    },
    {
      name: "GitHub auth URL event",
      catalogId: "github-copilot-subscription",
      event: { type: "auth_url", url: "https://github.com/login/device" },
    },
    {
      name: "GitHub device fragment",
      catalogId: "github-copilot-subscription",
      event: {
        type: "device_code",
        userCode: "CODE",
        verificationUri: "https://github.com/login/device#secret",
      },
    },
  ] satisfies ReadonlyArray<{
    name: string;
    catalogId: Parameters<typeof normalizeProviderLoginEvent>[0];
    event: Parameters<typeof normalizeProviderLoginEvent>[1];
  }>;

  it.each(rejectedUrlEvents)("rejects $name", ({ catalogId, event }) => {
    expect(() => normalizeProviderLoginEvent(catalogId, event)).toThrow(
      "Provider returned an unsupported sign-in URL",
    );
  });

  it("bounds and trims the device code", () => {
    const maxCode = "A".repeat(128);
    expect(
      normalizeProviderLoginEvent("github-copilot-subscription", {
        type: "device_code",
        userCode: ` ${maxCode} `,
        verificationUri: "https://github.com/login/device",
      }),
    ).toMatchObject({ userCode: maxCode });

    for (const userCode of ["", "   ", "A".repeat(129)]) {
      expect(() =>
        normalizeProviderLoginEvent("github-copilot-subscription", {
          type: "device_code",
          userCode,
          verificationUri: "https://github.com/login/device",
        }),
      ).toThrow("Provider returned an invalid device code");
    }
  });

  it("quarantines a persisted enterprise credential before provider registration or dispatch", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "aptiloop-legacy-copilot-"));
    const databasePath = path.join(root, "restart.sqlite");
    const credentialPath = path.join(
      root,
      ".data",
      "provider-credentials.json",
    );
    const connectionId = "conn:pi:github-copilot:legacy";
    const storedCredential = JSON.stringify(
      {
        version: 1,
        credentials: {
          [connectionId]: {
            type: "oauth",
            refresh: "retained-refresh-secret",
            access: "retained-access-secret",
            expires: 1_900_000_000_000,
            enterpriseUrl: "legacy.ghe.example",
            retainedMarker: "must-survive-quarantine",
          },
        },
      },
      null,
      2,
    );
    let initialConnection: DatabaseConnection | null = null;
    let restartedConnection: DatabaseConnection | null = null;
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("Network access must not start"));

    try {
      initialConnection = openDatabase(databasePath);
      migrateDatabase(initialConnection);
      const initialRepository = createLearningRepository(initialConnection);
      await initialRepository.setSetting("providerHubManagedConnections", {
        version: 1,
        connections: [
          {
            connectionId,
            catalogId: "github-copilot-subscription",
            displayName: "Legacy GitHub Copilot",
            baseUrl: null,
            modelIds: [],
          },
        ],
      });
      const initialHub = new ProviderHubRepository(initialConnection);
      initialHub.saveConnection({
        connectionId,
        adapterId: "pi",
        providerType: "github-copilot",
        displayName: "Legacy GitHub Copilot",
        credentialRef: `credential:${connectionId}`,
        endpointProfileId: null,
        enabled: true,
        external: true,
        state: "degraded",
        observedCapabilities: {
          providerType: "github-copilot",
          adapterVersion: "0.84.1",
          observedAt: "2026-08-12T12:00:00.000Z",
          models: [
            {
              modelId: "copilot-model",
              available: true,
              contextTokens: 128_000,
              outputTokens: 16_000,
              typedToolCalls: "schema-constrained",
              parallelToolCalls: false,
              attachments: ["text"],
            },
          ],
          connection: {
            authenticated: true,
            streaming: true,
            cancellation: true,
          },
        },
        lastCheckedAt: "2026-08-12T12:00:00.000Z",
      });
      initialHub.saveRoleProfile({
        role: "course-designer",
        mode: "connection",
        connectionId,
        modelId: "copilot-model",
        requiredCapabilities: ["streaming", "models", "cancellation"],
        toolPolicyId: "apt.role.course-designer.v2",
        budgets: {
          maxInputBytes: 128_000,
          maxOutputBytes: 64_000,
          maxEvents: 100,
          maxToolCalls: 4,
          deadlineMs: 60_000,
        },
      });
      initialConnection.close();
      initialConnection = null;

      mkdirSync(path.dirname(credentialPath), { recursive: true });
      writeFileSync(credentialPath, storedCredential, "utf8");

      restartedConnection = openDatabase(databasePath, { fileMustExist: true });
      const repository = createLearningRepository(restartedConnection);
      const connectionProviders = new Map<string, AgentProvider>();
      const management = new ProviderManagementService({
        connection: restartedConnection,
        repository,
        projectRoot: root,
        connectionProviders,
      });

      await management.ensureLoaded();

      expect(connectionProviders.has(connectionId)).toBe(false);
      expect(readFileSync(credentialPath, "utf8")).toBe(storedCredential);
      expect(
        new ProviderHubRepository(restartedConnection)
          .listConnections()
          .find((connection) => connection.connectionId === connectionId),
      ).toMatchObject({
        enabled: false,
        state: "misconfigured",
        credentialRef: `credential:${connectionId}`,
        observedCapabilities: null,
      });
      expect(await management.describe()).toMatchObject({
        connections: [
          {
            connectionId,
            credentialConfigured: false,
            recoveryState: "reauthentication-required",
          },
        ],
      });

      const getStatus = vi.fn(async () => {
        throw new Error("Blocked provider status must not run");
      });
      const listModels = vi.fn(async () => {
        throw new Error("Blocked provider model discovery must not run");
      });
      const blockedProvider: AgentProvider = {
        id: "pi",
        getStatus,
        listModels,
        async createSession() {
          throw new Error("Blocked provider session must not be created");
        },
        async *streamMessage() {
          throw new Error("Blocked provider stream must not run");
        },
        async cancelSession() {},
      };
      const providers = Object.fromEntries(
        (["mock", "codex", "opencode", "pi"] as const).map((id) => [
          id,
          blockedProvider,
        ]),
      ) as Record<ProviderId, AgentProvider>;
      const runtime = new ProviderRuntime({
        connection: restartedConnection,
        providers,
        connectionProviders,
        ensureProviders: () => management.ensureLoaded(),
        developmentMode: false,
      });
      const hub = new ProviderHubRepository(restartedConnection);
      for (const connection of hub.listConnections()) {
        if (connection.connectionId === connectionId || !connection.enabled) {
          continue;
        }
        hub.saveConnection({
          ...connection,
          enabled: false,
          state: "disabled",
          observedCapabilities: null,
        });
      }

      await expect(
        runtime.resolveDispatch({
          role: "course-designer",
          payload: "This payload must never be dispatched.",
        }),
      ).rejects.toMatchObject({
        failure: { code: "connection_disabled" },
      });
      expect(getStatus).not.toHaveBeenCalled();
      expect(listModels).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(
        restartedConnection.sqlite
          .prepare("SELECT COUNT(*) AS count FROM provider_turn_provenance")
          .get(),
      ).toEqual({ count: 0 });
      expect(readFileSync(credentialPath, "utf8")).toBe(storedCredential);
    } finally {
      initialConnection?.close();
      restartedConnection?.close();
      fetchSpy.mockRestore();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
