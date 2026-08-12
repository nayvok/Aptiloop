import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { LocaleProvider } from "@/lib/i18n";
import {
  ProviderConnectionManager,
  type ProviderConnectionSummary,
  type ProviderManagementSettings,
} from "@/components/provider-connection-manager";

const { apiMock } = vi.hoisted(() => ({
  apiMock: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  ApiError: class ApiError extends Error {},
  api: apiMock,
}));

const budgets = {
  maxInputBytes: 128_000,
  maxOutputBytes: 256_000,
  maxEvents: 1_000,
  maxToolCalls: 4,
  deadlineMs: 120_000,
};

const connectionResponse = {
  connections: [
    {
      connectionId: "conn:mock",
      adapterId: "mock",
      providerType: "ollama",
      displayName: "Deterministic Mock",
      enabled: true,
      external: false,
      state: "connected",
      lastCheckedAt: "2026-08-10T00:00:00.000Z",
      observedCapabilities: {
        providerType: "mock",
        adapterVersion: "test",
        observedAt: "2026-08-10T00:00:00.000Z",
        connection: {
          authenticated: true,
          streaming: true,
          cancellation: true,
        },
        models: [
          {
            modelId: "mock-deterministic",
            available: true,
            contextTokens: 128_000,
            outputTokens: 16_000,
            typedToolCalls: "schema-constrained" as const,
            parallelToolCalls: false,
            attachments: ["text"] as const,
          },
        ],
      },
    },
  ],
  management: {
    catalog: [
      {
        id: "ollama-local",
        providerType: "ollama",
        displayName: "Ollama",
        authKind: "local" as const,
        external: false,
        defaultBaseUrl: "http://127.0.0.1:11434/v1",
        endpointKind: "loopback" as const,
        recommendation: "private" as const,
      },
    ],
    connections: [
      {
        connectionId: "conn:mock",
        catalogId: "ollama-local",
        authKind: "local" as const,
        credentialConfigured: false,
        baseUrl: "http://127.0.0.1:11434/v1",
        modelIds: ["mock-deterministic"],
        providerType: "ollama",
      },
    ],
  },
  roleProfiles: [
    {
      role: "course-designer",
      mode: "no-ai" as const,
      connectionId: null,
      modelId: null,
      requiredCapabilities: [],
      toolPolicyId: "apt.role.course-designer.v1",
      budgets,
    },
    ...(["tutor", "evaluator", "reviewer"] as const).map((role) => ({
      role,
      mode: "connection" as const,
      connectionId: "conn:mock",
      modelId: "mock-deterministic",
      requiredCapabilities: ["streaming", "models", "cancellation"],
      toolPolicyId: `apt.role.${role}.v1`,
      budgets,
    })),
  ],
};

type ManagerResponse = {
  connections: ProviderConnectionSummary[];
  management: ProviderManagementSettings;
};

function subscriptionResponse({
  catalogId,
  providerType,
  displayName,
}: {
  catalogId: string;
  providerType: string;
  displayName: string;
}): ManagerResponse {
  const response = structuredClone(
    connectionResponse,
  ) as unknown as ManagerResponse;
  response.connections = [
    {
      connectionId: "conn:subscription",
      providerType,
      displayName,
      enabled: true,
      external: true,
      state: "authentication-required",
      lastCheckedAt: "2026-08-10T00:00:00.000Z",
      observedCapabilities: null,
    },
  ];
  response.management.catalog = [
    {
      id: catalogId,
      providerType,
      displayName,
      authKind: "subscription",
      external: true,
    },
  ];
  response.management.connections = [
    {
      connectionId: "conn:subscription",
      catalogId,
      authKind: "subscription",
      credentialConfigured: false,
      baseUrl: null,
      modelIds: [],
    },
  ];
  return response;
}

function renderManager(
  response: ManagerResponse = connectionResponse,
  initialLocale: "en-US" | "ru-RU" = "en-US",
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={client}>
      <LocaleProvider initialLocale={initialLocale} syncSettings={false}>
        <ProviderConnectionManager
          connections={response.connections}
          management={response.management}
        />
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

beforeAll(() => {
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
});

beforeEach(() => {
  apiMock.mockReset();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe("ProviderConnectionManager accessibility flows", () => {
  it("moves focus into the add-connection sheet, traps tab navigation, and returns focus to the trigger after Escape", async () => {
    renderManager();

    const trigger = await screen.findByRole("button", {
      name: "Add connection",
    });
    trigger.focus();
    expect(trigger).toHaveFocus();

    fireEvent.click(trigger);

    const sheet = await screen.findByRole("dialog", { name: "Add connection" });
    const provider = within(sheet).getByRole("combobox", { name: "Provider" });
    expect(provider).toHaveFocus();

    const close = within(sheet).getByRole("button", { name: "Close" });

    fireEvent.keyDown(provider, { key: "Tab", shiftKey: true });
    expect(close).toHaveFocus();
    fireEvent.keyDown(close, { key: "Tab" });
    expect(provider).toHaveFocus();

    fireEvent.keyDown(provider, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(trigger).toHaveFocus();
  });

  it("focuses the cancel button for a destructive confirmation dialog and returns focus to the trigger after Escape", async () => {
    renderManager();

    const configure = await screen.findByRole("button", {
      name: "Configure AI",
    });
    fireEvent.click(configure);

    const trigger = await screen.findByRole("button", { name: "Disable" });
    trigger.focus();
    expect(trigger).toHaveFocus();

    fireEvent.click(trigger);

    const dialog = await screen.findByRole("alertdialog", { name: "Disable" });
    const cancel = within(dialog).getByRole("button", { name: "Cancel" });
    const confirm = within(dialog).getByRole("button", { name: "Disable" });
    expect(cancel).toHaveFocus();
    expect(confirm).not.toHaveFocus();

    fireEvent.keyDown(cancel, { key: "Tab", shiftKey: true });
    expect(confirm).toHaveFocus();
    fireEvent.keyDown(confirm, { key: "Tab" });
    expect(cancel).toHaveFocus();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
    );
    expect(trigger).toHaveFocus();
  });

  it("rejects a GitHub Enterprise domain and submits the optional blank for github.com", async () => {
    const operationId = "cbeff842-1a3a-4d06-8cba-2523601ce9da";
    const promptId = "88a6558f-d070-478e-adbc-18678089cb43";
    const response = subscriptionResponse({
      catalogId: "github-copilot-subscription",
      providerType: "github-copilot",
      displayName: "GitHub Copilot subscription",
    });
    let answered = false;
    apiMock.mockImplementation((path: string, init?: RequestInit) => {
      if (path.endsWith("/login") && init?.method === "POST") {
        return Promise.resolve({ started: true, operationId });
      }
      if (
        path === `/settings/ai/login/${operationId}/answer` &&
        init?.method === "POST"
      ) {
        answered = true;
        return Promise.resolve({ accepted: true });
      }
      if (path === `/settings/ai/login/${operationId}`) {
        return Promise.resolve({
          operationId,
          connectionId: "conn:subscription",
          status: answered ? "completed" : "running",
          events: [],
          prompt: answered
            ? null
            : {
                promptId,
                kind: "github-enterprise-domain",
                type: "text",
                optional: true,
                options: [],
              },
          error: null,
        });
      }
      throw new Error(`Unexpected API call: ${path}`);
    });

    renderManager(response, "ru-RU");
    fireEvent.click(
      await screen.findByRole("button", { name: "Настроить AI" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Войти" }));

    const domain = await screen.findByLabelText("Домен GitHub Enterprise");
    expect(domain).toHaveAttribute("placeholder", "company.ghe.com");
    expect(domain).toHaveValue("");
    expect(
      screen.getByText(
        "Необязательно. Оставьте поле пустым для входа через github.com.",
      ),
    ).toBeVisible();
    const continueButton = screen.getByRole("button", {
      name: "Продолжить",
    });
    expect(continueButton).toBeEnabled();

    fireEvent.change(domain, { target: { value: "company.ghe.com" } });
    expect(domain).toHaveValue("company.ghe.com");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Домены GitHub Enterprise пока не поддерживаются. Оставьте поле пустым, чтобы использовать github.com.",
    );
    expect(continueButton).toBeDisabled();
    fireEvent.click(continueButton);
    expect(apiMock).not.toHaveBeenCalledWith(
      `/settings/ai/login/${operationId}/answer`,
      expect.objectContaining({ method: "POST" }),
    );

    fireEvent.change(domain, { target: { value: "" } });
    expect(domain).toHaveValue("");
    expect(
      screen.getByText(
        "Необязательно. Оставьте поле пустым для входа через github.com.",
      ),
    ).toBeVisible();
    expect(continueButton).toBeEnabled();
    fireEvent.click(continueButton);

    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(
        `/settings/ai/login/${operationId}/answer`,
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ promptId, answer: "" }),
        }),
      ),
    );
  });

  it("submits only the selected localized OpenAI sign-in option", async () => {
    const operationId = "7f6cb8a0-d2d4-49ad-8d03-30bacd89a0ed";
    const promptId = "07d73820-7e30-4c56-9466-a8edcb1f1ea8";
    const response = subscriptionResponse({
      catalogId: "openai-subscription",
      providerType: "openai-codex",
      displayName: "OpenAI subscription",
    });
    let answered = false;
    apiMock.mockImplementation((path: string, init?: RequestInit) => {
      if (path.endsWith("/login") && init?.method === "POST") {
        return Promise.resolve({ started: true, operationId });
      }
      if (
        path === `/settings/ai/login/${operationId}/answer` &&
        init?.method === "POST"
      ) {
        answered = true;
        return Promise.resolve({ accepted: true });
      }
      if (path === `/settings/ai/login/${operationId}`) {
        return Promise.resolve({
          operationId,
          connectionId: "conn:subscription",
          status: answered ? "completed" : "running",
          events: [],
          prompt: answered
            ? null
            : {
                promptId,
                kind: "openai-codex-login-method",
                type: "select",
                optional: false,
                options: ["browser", "device_code"],
              },
          error: null,
        });
      }
      throw new Error(`Unexpected API call: ${path}`);
    });

    renderManager(response, "ru-RU");
    fireEvent.click(
      await screen.findByRole("button", { name: "Настроить AI" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Войти" }));

    const loginMethod = await screen.findByRole("combobox", {
      name: "Способ авторизации OpenAI Codex",
    });
    expect(
      within(loginMethod).getByRole("option", {
        name: "Авторизация в браузере (рекомендуется)",
      }),
    ).toHaveValue("browser");
    expect(
      within(loginMethod).getByRole("option", {
        name: "Авторизация по коду устройства",
      }),
    ).toHaveValue("device_code");
    fireEvent.change(loginMethod, { target: { value: "device_code" } });
    expect(loginMethod).toHaveValue("device_code");
    fireEvent.click(screen.getByRole("button", { name: "Продолжить" }));

    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(
        `/settings/ai/login/${operationId}/answer`,
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ promptId, answer: "device_code" }),
        }),
      ),
    );
  });

  it("keeps provider-supplied sign-in text and failures out of the browser", async () => {
    const response = structuredClone(connectionResponse) as unknown as {
      connections: ProviderConnectionSummary[];
      management: ProviderManagementSettings;
    };
    response.management.catalog = [
      {
        id: "openai-subscription",
        providerType: "openai",
        displayName: "OpenAI subscription",
        authKind: "subscription",
        external: true,
      },
    ];
    response.management.connections = [
      {
        connectionId: "conn:mock",
        catalogId: "openai-subscription",
        authKind: "subscription",
        credentialConfigured: false,
        baseUrl: null,
        modelIds: [],
      },
    ];
    apiMock.mockImplementation((path: string, init?: RequestInit) => {
      if (path.endsWith("/login") && init?.method === "POST") {
        return Promise.resolve({ started: true, operationId: "login-1" });
      }
      if (path === "/settings/ai/login/login-1") {
        return Promise.resolve({
          operationId: "login-1",
          connectionId: "conn:mock",
          status: "failed",
          events: [
            { type: "info", message: "raw provider event with secret" },
            { type: "progress", message: "raw provider progress" },
          ],
          prompt: null,
          error: "raw provider failure with credential path",
        });
      }
      throw new Error(`Unexpected API call: ${path}`);
    });

    renderManager(response);
    fireEvent.click(
      await screen.findByRole("button", { name: "Configure AI" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Sign in" }));

    expect(
      await screen.findAllByText("Provider sign-in failed"),
    ).not.toHaveLength(0);
    expect(
      screen.queryByText("Provider sign-in is in progress."),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/raw provider/u)).not.toBeInTheDocument();
    expect(screen.queryByText(/credential path/u)).not.toBeInTheDocument();
  });

  it("fails closed when a login status contains an unapproved provider URL", async () => {
    const operationId = "435068f2-d4d8-4db2-8520-c64659bd52c5";
    const response = subscriptionResponse({
      catalogId: "openai-subscription",
      providerType: "openai-codex",
      displayName: "OpenAI subscription",
    });
    apiMock.mockImplementation((path: string, init?: RequestInit) => {
      if (path.endsWith("/login") && init?.method === "POST") {
        return Promise.resolve({ started: true, operationId });
      }
      if (path === `/settings/ai/login/${operationId}`) {
        return Promise.resolve({
          operationId,
          connectionId: "conn:subscription",
          status: "running",
          events: [
            {
              type: "auth_url",
              url: "https://auth.openai.com.attacker.example/oauth/authorize",
            },
          ],
          prompt: null,
          error: null,
        });
      }
      throw new Error(`Unexpected API call: ${path}`);
    });

    renderManager(response);
    fireEvent.click(
      await screen.findByRole("button", { name: "Configure AI" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Sign in" }));

    expect(
      await screen.findAllByText("Provider sign-in failed"),
    ).not.toHaveLength(0);
    expect(screen.queryByRole("link", { name: "Open sign-in" })).toBeNull();
    expect(screen.queryByText(/attacker\.example/u)).not.toBeInTheDocument();
  });
});
