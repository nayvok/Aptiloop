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

import { SettingsForm } from "@/components/settings-form";

const { ApiErrorMock, apiMock, navigationState, setThemeMock } = vi.hoisted(
  () => {
    class ApiErrorMock extends Error {
      constructor(
        message: string,
        readonly status: number,
      ) {
        super(message);
        this.name = "ApiError";
      }
    }
    let search = "";
    let history = [""];
    let historyIndex = 0;
    const listeners = new Set<() => void>();
    const notify = () => listeners.forEach((listener) => listener());
    return {
      ApiErrorMock,
      apiMock: vi.fn(),
      setThemeMock: vi.fn(),
      navigationState: {
        getSnapshot: () => search,
        subscribe: (listener: () => void) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        push: vi.fn((href: string) => {
          search = new URL(href, "http://localhost").search;
          history = [...history.slice(0, historyIndex + 1), search];
          historyIndex += 1;
          notify();
        }),
        setSearch: (next: string) => {
          search = next;
          history = [next];
          historyIndex = 0;
          notify();
        },
        back: () => {
          if (historyIndex === 0) return;
          historyIndex -= 1;
          search = history[historyIndex]!;
          notify();
        },
        forward: () => {
          if (historyIndex >= history.length - 1) return;
          historyIndex += 1;
          search = history[historyIndex]!;
          notify();
        },
      },
    };
  },
);

vi.mock("@/lib/api", () => ({
  ApiError: ApiErrorMock,
  api: apiMock,
}));
vi.mock("next-themes", () => ({
  useTheme: () => ({ theme: "system", setTheme: setThemeMock }),
}));
vi.mock("next/navigation", async () => {
  const React = await import("react");
  return {
    usePathname: () => "/settings",
    useRouter: () => ({ push: navigationState.push }),
    useSearchParams: () =>
      new URLSearchParams(
        React.useSyncExternalStore(
          navigationState.subscribe,
          navigationState.getSnapshot,
          navigationState.getSnapshot,
        ),
      ),
  };
});

const budgets = {
  maxInputBytes: 128_000,
  maxOutputBytes: 256_000,
  maxEvents: 1_000,
  maxToolCalls: 4,
  deadlineMs: 120_000,
};
const settingsResponse = {
  workspaceRoot: "C:/trusted/exercises",
  zedExecutable: "zed",
  opencodeBaseUrl: "http://127.0.0.1:4096",
  theme: "system",
  ai: {
    connections: [
      {
        connectionId: "conn:mock",
        adapterId: "mock",
        providerType: "mock",
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
      {
        connectionId: "conn:pi:openai",
        adapterId: "pi",
        providerType: "openai",
        displayName: "OpenAI via Pi",
        enabled: true,
        external: true,
        state: "connected",
        lastCheckedAt: "2026-08-10T00:00:00.000Z",
        observedCapabilities: {
          providerType: "openai",
          adapterVersion: "test",
          observedAt: "2026-08-10T00:00:00.000Z",
          connection: {
            authenticated: true,
            streaming: true,
            cancellation: true,
          },
          models: [
            {
              modelId: "pi-exact",
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
    roleProfiles: [
      {
        role: "course-designer",
        mode: "no-ai",
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
    management: {
      catalog: [
        {
          id: "openai-api",
          providerType: "openai",
          displayName: "OpenAI API",
          authKind: "api-key",
          external: true,
          credentialLabel: "OpenAI API key",
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
      ],
      connections: [
        {
          connectionId: "conn:mock",
          catalogId: "ollama-local",
          authKind: "local" as const,
          credentialConfigured: false,
          baseUrl: "http://127.0.0.1:11434/v1",
          modelIds: ["mock-deterministic"],
        },
        {
          connectionId: "conn:pi:openai",
          catalogId: "openai-api",
          authKind: "api-key" as const,
          credentialConfigured: true,
          baseUrl: null,
          modelIds: ["pi-exact"],
        },
      ],
    },
  },
};

function renderForm() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <LocaleProvider initialLocale="en-US" syncSettings={false}>
        <SettingsForm />
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

function openTab(name: string) {
  fireEvent.mouseDown(screen.getByRole("tab", { name }), {
    button: 0,
    ctrlKey: false,
  });
}

beforeAll(() => {
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
});
beforeEach(() => {
  apiMock.mockReset();
  navigationState.push.mockClear();
  navigationState.setSearch("");
  setThemeMock.mockReset();
  window.localStorage.clear();
  window.sessionStorage.clear();
  document.cookie = "aptiloop.ui-locale=; Path=/; Max-Age=0";
  apiMock.mockImplementation((path: string, init?: RequestInit) => {
    if (path === "/settings" && init?.method === "PUT") {
      return Promise.resolve({ saved: true });
    }
    if (path === "/settings/locale" && init?.method === "PUT") {
      return Promise.resolve({ saved: true, uiLocale: "en-US" });
    }
    if (path === "/settings/ai" && init?.method === "PUT") {
      return Promise.resolve({
        saved: true,
        roleProfiles: settingsResponse.ai.roleProfiles,
      });
    }
    if (path === "/settings") return Promise.resolve(settingsResponse);
    throw new Error(`Unexpected API call: ${path}`);
  });
});

afterEach(cleanup);

describe("SettingsForm", () => {
  it("uses local tabs and keeps technical values progressively disclosed", async () => {
    renderForm();

    expect(
      await screen.findByRole("tab", { name: "Interface" }),
    ).toHaveAttribute("aria-selected", "true");
    for (const tab of ["AI roles", "Connections", "Core & local paths"]) {
      expect(screen.getByRole("tab", { name: tab })).toBeVisible();
    }
    expect(screen.queryByText("C:/trusted/exercises")).not.toBeInTheDocument();

    openTab("AI roles");
    expect(await screen.findByLabelText("Default model")).toHaveAttribute(
      "role",
      "combobox",
    );
    expect(screen.queryByLabelText("Course Designer")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Customize roles" }));
    for (const label of ["Course Designer", "Tutor", "Evaluator", "Reviewer"]) {
      expect(await screen.findByLabelText(label)).toHaveAttribute(
        "role",
        "combobox",
      );
    }

    openTab("Connections");
    expect(screen.getByText("Deterministic Mock")).toBeVisible();
    expect(screen.getByText("OpenAI via Pi")).toBeVisible();

    openTab("Core & local paths");
    expect(screen.queryByText("C:/trusted/exercises")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Technical details" }));
    expect(screen.getByText("C:/trusted/exercises")).toBeVisible();
    expect(screen.getByText("zed")).toBeVisible();
  });

  it("keeps locale as a draft while theme remains immediate", async () => {
    renderForm();
    await screen.findByRole("heading", { name: "Interface" });
    expect(setThemeMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText("Theme"));
    fireEvent.click(await screen.findByRole("option", { name: "Dark" }));
    expect(setThemeMock).toHaveBeenCalledWith("dark");

    fireEvent.click(screen.getByLabelText("Interface language"));
    fireEvent.click(
      await screen.findByRole("option", { name: "Русский (Россия)" }),
    );

    expect(screen.getByRole("heading", { name: "Interface" })).toBeVisible();
    expect(document.documentElement.lang).toBe("en-US");
    expect(window.localStorage.getItem("aptiloop:ui-locale")).toBeNull();
    expect(window.sessionStorage.getItem("aptiloop:ui-locale-draft")).toBe(
      "ru-RU",
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Interface language has unsaved changes.",
    );
    expect(screen.getByRole("button", { name: "Save language" })).toBeEnabled();
    expect(
      apiMock.mock.calls.some(
        ([path, init]) =>
          (path === "/settings" || path === "/settings/locale") &&
          init?.method === "PUT",
      ),
    ).toBe(false);
  });

  it("cancels the locale draft without changing or persisting the locale", async () => {
    renderForm();
    await screen.findByRole("heading", { name: "Interface" });

    fireEvent.click(screen.getByLabelText("Interface language"));
    fireEvent.click(
      await screen.findByRole("option", { name: "Русский (Россия)" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Cancel language changes" }),
    );

    expect(screen.getByLabelText("Interface language")).toHaveTextContent(
      "English (United States)",
    );
    expect(document.documentElement.lang).toBe("en-US");
    expect(window.localStorage.getItem("aptiloop:ui-locale")).toBeNull();
    expect(
      window.sessionStorage.getItem("aptiloop:ui-locale-draft"),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Save language" }),
    ).toBeDisabled();
    expect(apiMock).not.toHaveBeenCalled();
  });

  it("preserves an unsaved locale draft across section navigation and Back/Forward", async () => {
    renderForm();
    await screen.findByRole("heading", { name: "Interface" });

    fireEvent.click(screen.getByLabelText("Interface language"));
    fireEvent.click(
      await screen.findByRole("option", { name: "Русский (Россия)" }),
    );

    openTab("AI roles");
    expect(await screen.findByLabelText("Default model")).toBeVisible();
    expect(
      screen.queryByLabelText("Interface language"),
    ).not.toBeInTheDocument();

    navigationState.back();
    expect(
      await screen.findByLabelText("Interface language"),
    ).toHaveTextContent("Русский (Россия)");
    expect(document.documentElement.lang).toBe("en-US");
    expect(screen.getByRole("button", { name: "Save language" })).toBeEnabled();

    navigationState.forward();
    expect(await screen.findByLabelText("Default model")).toBeVisible();
    navigationState.back();
    expect(
      await screen.findByLabelText("Interface language"),
    ).toHaveTextContent("Русский (Россия)");
    expect(window.localStorage.getItem("aptiloop:ui-locale")).toBeNull();
  });

  it("restores an unsaved locale draft after a route unmount without changing the active locale", async () => {
    const first = renderForm();
    await screen.findByRole("heading", { name: "Interface" });

    fireEvent.click(screen.getByLabelText("Interface language"));
    fireEvent.click(
      await screen.findByRole("option", { name: "Русский (Россия)" }),
    );
    expect(window.sessionStorage.getItem("aptiloop:ui-locale-draft")).toBe(
      "ru-RU",
    );

    first.unmount();
    renderForm();

    expect(
      await screen.findByLabelText("Interface language"),
    ).toHaveTextContent("Русский (Россия)");
    expect(document.documentElement.lang).toBe("en-US");
    expect(window.localStorage.getItem("aptiloop:ui-locale")).toBeNull();
    expect(screen.getByRole("button", { name: "Save language" })).toBeEnabled();
    expect(apiMock).not.toHaveBeenCalled();
  });

  it("discards a malformed session locale draft without changing the active locale", async () => {
    window.sessionStorage.setItem("aptiloop:ui-locale-draft", "de-DE");

    renderForm();

    expect(
      await screen.findByLabelText("Interface language"),
    ).toHaveTextContent("English (United States)");
    expect(document.documentElement.lang).toBe("en-US");
    expect(
      window.sessionStorage.getItem("aptiloop:ui-locale-draft"),
    ).toBeNull();
    expect(apiMock).not.toHaveBeenCalled();
  });

  it("fails closed when session draft storage is blocked", async () => {
    const originalGetItem = Storage.prototype.getItem;
    const getItem = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(function (this: Storage, key) {
        if (this !== window.sessionStorage) {
          return originalGetItem.call(this, key);
        }
        throw new DOMException("Storage blocked", "SecurityError");
      });

    renderForm();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Browser storage is unavailable",
    );
    expect(screen.getByLabelText("Interface language")).toHaveTextContent(
      "English (United States)",
    );
    expect(document.documentElement.lang).toBe("en-US");
    expect(apiMock).not.toHaveBeenCalled();
    getItem.mockRestore();
  });

  it("saves the locale locally, survives a remount, and never mutates Core", async () => {
    const first = renderForm();
    await screen.findByRole("heading", { name: "Interface" });

    fireEvent.click(screen.getByLabelText("Interface language"));
    fireEvent.click(
      await screen.findByRole("option", { name: "Русский (Россия)" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save language" }));

    expect(
      await screen.findByRole("heading", { name: "Интерфейс" }),
    ).toBeVisible();
    expect(document.documentElement.lang).toBe("ru-RU");
    expect(window.localStorage.getItem("aptiloop:ui-locale")).toBe("ru-RU");
    expect(
      window.sessionStorage.getItem("aptiloop:ui-locale-draft"),
    ).toBeNull();
    expect(apiMock).not.toHaveBeenCalled();

    first.unmount();
    renderForm();

    expect(
      await screen.findByRole("heading", { name: "Интерфейс" }),
    ).toBeVisible();
    expect(screen.getByLabelText("Язык интерфейса")).toHaveTextContent(
      "Русский (Россия)",
    );
    expect(apiMock).not.toHaveBeenCalled();
  });

  it("keeps the active locale unchanged when browser storage blocks Save", async () => {
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new DOMException("Storage blocked", "SecurityError");
      });

    renderForm();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Browser storage is unavailable",
    );
    fireEvent.click(screen.getByLabelText("Interface language"));
    fireEvent.click(
      await screen.findByRole("option", { name: "Русский (Россия)" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save language" }));

    expect(screen.getByRole("heading", { name: "Interface" })).toBeVisible();
    expect(document.documentElement.lang).toBe("en-US");
    expect(screen.getByLabelText("Interface language")).toHaveTextContent(
      "Русский (Россия)",
    );
    expect(apiMock).not.toHaveBeenCalled();
    setItem.mockRestore();
  });

  it("saves all four exact role profiles as one strict mutation", async () => {
    renderForm();
    await screen.findByRole("tab", { name: "AI roles" });
    openTab("AI roles");
    fireEvent.click(
      await screen.findByRole("button", { name: "Customize roles" }),
    );
    const reviewer = await screen.findByLabelText("Reviewer");
    fireEvent.click(reviewer);
    fireEvent.click(
      await screen.findByRole("option", { name: "OpenAI via Pi · pi-exact" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save AI roles" }));

    await waitFor(() => {
      const mutation = apiMock.mock.calls.find(
        ([path, init]) => path === "/settings/ai" && init?.method === "PUT",
      );
      const body = JSON.parse(String(mutation?.[1]?.body)) as {
        roleProfiles: Array<Record<string, unknown>>;
      };
      expect(body.roleProfiles).toHaveLength(4);
      expect(body.roleProfiles).toContainEqual({
        role: "reviewer",
        mode: "connection",
        connectionId: "conn:pi:openai",
        modelId: "pi-exact",
      });
    });
  });

  it("keeps raw AI role save failures in closed technical details", async () => {
    apiMock.mockImplementation((path: string, init?: RequestInit) => {
      if (path === "/settings/ai" && init?.method === "PUT") {
        return Promise.reject(
          Object.assign(new Error("raw provider credential path"), {
            status: 503,
            failure: {
              code: "provider_unavailable",
              retryable: true,
              messageKey: "ai.failure.providerUnavailable",
              diagnosticId: "provider-hub:settings-save-1",
              recoveryAction: null,
            },
          }),
        );
      }
      if (path === "/settings") return Promise.resolve(settingsResponse);
      throw new Error(`Unexpected API call: ${path}`);
    });
    renderForm();
    await screen.findByRole("tab", { name: "AI roles" });
    openTab("AI roles");
    fireEvent.click(
      await screen.findByRole("button", { name: "Save AI roles" }),
    );

    const alert = await screen.findByRole("alert");
    expect(alert.querySelector("p")).toHaveTextContent(
      "The selected AI provider is unavailable.",
    );
    expect(alert).not.toHaveTextContent("raw provider credential path");
    expect(screen.getByText("provider-hub:settings-save-1")).not.toBeVisible();
  });

  it("creates a local connection from server-owned catalog fields", async () => {
    apiMock.mockImplementation((path: string, init?: RequestInit) => {
      if (path === "/settings/ai/connections" && init?.method === "POST") {
        return Promise.resolve({ created: true });
      }
      if (path === "/settings") return Promise.resolve(settingsResponse);
      throw new Error(`Unexpected API call: ${path}`);
    });
    renderForm();
    await screen.findByRole("tab", { name: "Connections" });
    openTab("Connections");

    fireEvent.click(
      await screen.findByRole("button", { name: "Add connection" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Add connection",
    });
    fireEvent.click(within(dialog).getByLabelText("Provider"));
    fireEvent.click(await screen.findByRole("option", { name: "Ollama" }));
    expect(
      screen.getByText(
        "Recommended for privacy: Ollama keeps model traffic on this computer.",
      ),
    ).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("Connection name"), {
      target: { value: "Local Ollama" },
    });
    fireEvent.change(within(dialog).getByLabelText("Exact model IDs"), {
      target: { value: "qwen2.5-coder, llama3.2" },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Add connection" }),
    );

    await waitFor(() => {
      const mutation = apiMock.mock.calls.find(
        ([path, init]) =>
          path === "/settings/ai/connections" && init?.method === "POST",
      );
      expect(JSON.parse(String(mutation?.[1]?.body))).toEqual({
        catalogId: "ollama-local",
        displayName: "Local Ollama",
        baseUrl: "http://127.0.0.1:11434/v1",
        modelIds: ["qwen2.5-coder", "llama3.2"],
      });
    });
  });

  it("offers a managed recovery path for metadata-less legacy connections", async () => {
    const legacySettings = structuredClone(settingsResponse);
    legacySettings.ai.management.connections = [];
    apiMock.mockImplementation((path: string) => {
      if (path === "/settings") return Promise.resolve(legacySettings);
      throw new Error(`Unexpected API call: ${path}`);
    });

    renderForm();
    await screen.findByRole("tab", { name: "Connections" });
    openTab("Connections");
    const details = await screen.findAllByRole("button", { name: "Details" });
    fireEvent.click(details[0]!);
    expect(
      screen.getByText(/read-only diagnostics.*managed connection/u),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Add managed connection" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Add connection",
    });
    expect(within(dialog).getByLabelText("Connection name")).toHaveValue(
      "Deterministic Mock",
    );
  });

  it("submits a custom external endpoint with explicit models and credentials", async () => {
    apiMock.mockImplementation((path: string, init?: RequestInit) => {
      if (path === "/settings/ai/connections" && init?.method === "POST") {
        return Promise.resolve({ created: true });
      }
      if (path === "/settings") return Promise.resolve(settingsResponse);
      throw new Error(`Unexpected API call: ${path}`);
    });
    renderForm();
    await screen.findByRole("tab", { name: "Connections" });
    openTab("Connections");

    fireEvent.click(
      await screen.findByRole("button", { name: "Add connection" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Add connection",
    });
    fireEvent.click(within(dialog).getByLabelText("Provider"));
    fireEvent.click(
      await screen.findByRole("option", {
        name: "Custom OpenAI-compatible HTTPS",
      }),
    );
    fireEvent.change(within(dialog).getByLabelText("Connection name"), {
      target: { value: "Reviewed gateway" },
    });
    fireEvent.change(within(dialog).getByLabelText(/Provider API key/u), {
      target: { value: "secret-api-key" },
    });
    fireEvent.change(
      within(dialog).getByLabelText(/External OpenAI-compatible HTTPS URL/u),
      { target: { value: "https://inference.example.com/openai/v1" } },
    );
    fireEvent.change(within(dialog).getByLabelText("Exact model IDs"), {
      target: { value: "reviewed-model" },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Add connection" }),
    );

    await waitFor(() => {
      const mutation = apiMock.mock.calls.find(
        ([path, init]) =>
          path === "/settings/ai/connections" && init?.method === "POST",
      );
      expect(JSON.parse(String(mutation?.[1]?.body))).toEqual({
        catalogId: "custom-openai-compatible",
        displayName: "Reviewed gateway",
        apiKey: "secret-api-key",
        baseUrl: "https://inference.example.com/openai/v1",
        modelIds: ["reviewed-model"],
      });
    });
  });

  it("keeps long provider values bounded until technical details are opened", async () => {
    const longConnectionId = `conn:${"provider-segment-".repeat(12)}`;
    const longDisplayName =
      `Reviewed ${"provider connection ".repeat(10)}`.trim();
    const longModelId = `vendor/${"model-segment-".repeat(12)}`;
    const longBaseUrl = `https://inference.example.com/${"nested-path/".repeat(12)}v1`;
    const response = structuredClone(settingsResponse);
    response.ai.connections = [
      {
        ...response.ai.connections[0]!,
        connectionId: longConnectionId,
        displayName: longDisplayName,
        observedCapabilities: {
          ...response.ai.connections[0]!.observedCapabilities!,
          models: [
            {
              ...response.ai.connections[0]!.observedCapabilities!.models[0]!,
              modelId: longModelId,
            },
          ],
        },
      },
    ];
    response.ai.management.connections = [
      {
        connectionId: longConnectionId,
        catalogId: "ollama-local",
        authKind: "local",
        credentialConfigured: false,
        baseUrl: longBaseUrl,
        modelIds: [longModelId],
      },
    ];
    apiMock.mockImplementation((path: string) => {
      if (path === "/settings") return Promise.resolve(response);
      throw new Error(`Unexpected API call: ${path}`);
    });

    renderForm();
    await screen.findByRole("tab", { name: "Connections" });
    openTab("Connections");

    const name = await screen.findByText(longDisplayName);
    expect(name).toHaveClass("truncate");
    expect(screen.queryByText(longConnectionId)).not.toBeInTheDocument();
    expect(screen.queryByText(longBaseUrl)).not.toBeInTheDocument();

    const row = name.closest("li");
    expect(row).not.toBeNull();
    fireEvent.click(within(row!).getByRole("button", { name: "Configure AI" }));

    expect(within(row!).getByText(longConnectionId)).toHaveClass(
      "[overflow-wrap:anywhere]",
    );
    expect(within(row!).getByText(longBaseUrl)).toHaveClass(
      "[overflow-wrap:anywhere]",
    );
    expect(within(row!).getByText(longModelId)).toHaveClass(
      "[overflow-wrap:anywhere]",
    );
  });

  it("requires confirmation before disabling and exposes local recovery", async () => {
    apiMock.mockImplementation((path: string, init?: RequestInit) => {
      if (
        path === "/settings/ai/connections/conn%3Amock/disable" &&
        init?.method === "POST"
      ) {
        return Promise.resolve({ disabled: true });
      }
      if (path === "/settings") return Promise.resolve(settingsResponse);
      throw new Error(`Unexpected API call: ${path}`);
    });
    renderForm();
    await screen.findByRole("tab", { name: "Connections" });
    openTab("Connections");

    const row = (await screen.findByText("Deterministic Mock")).closest("li");
    expect(row).not.toBeNull();
    fireEvent.click(within(row!).getByRole("button", { name: "Configure AI" }));
    fireEvent.click(within(row!).getByRole("button", { name: "Disable" }));

    const firstDialog = await screen.findByRole("alertdialog", {
      name: "Disable",
    });
    expect(within(firstDialog).getByText(/Off/u)).toHaveTextContent("Enable");
    expect(
      apiMock.mock.calls.some(([path]) => String(path).endsWith("/disable")),
    ).toBe(false);
    fireEvent.click(
      within(firstDialog).getByRole("button", { name: "Cancel" }),
    );
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();

    fireEvent.click(within(row!).getByRole("button", { name: "Disable" }));
    const confirmDialog = await screen.findByRole("alertdialog", {
      name: "Disable",
    });
    fireEvent.click(
      within(confirmDialog).getByRole("button", { name: "Disable" }),
    );

    await waitFor(() => {
      expect(apiMock).toHaveBeenCalledWith(
        "/settings/ai/connections/conn%3Amock/disable",
        { method: "POST", body: "{}" },
      );
    });
  });

  it("requires confirmation before removing a managed connection", async () => {
    apiMock.mockImplementation((path: string, init?: RequestInit) => {
      if (
        path === "/settings/ai/connections/conn%3Amock" &&
        init?.method === "DELETE"
      ) {
        return Promise.resolve({ removed: true });
      }
      if (path === "/settings") return Promise.resolve(settingsResponse);
      throw new Error(`Unexpected API call: ${path}`);
    });
    renderForm();
    await screen.findByRole("tab", { name: "Connections" });
    openTab("Connections");

    const row = (await screen.findByText("Deterministic Mock")).closest("li");
    expect(row).not.toBeNull();
    fireEvent.click(within(row!).getByRole("button", { name: "Configure AI" }));
    fireEvent.click(
      within(row!).getByRole("button", {
        name: "Remove connection: Deterministic Mock",
      }),
    );

    const dialog = await screen.findByRole("alertdialog", {
      name: "Remove this connection?",
    });
    expect(
      within(dialog).getByText(/Assigned AI roles will turn off/u),
    ).toBeVisible();
    expect(within(dialog).getByText(/history is retained/u)).toBeVisible();
    expect(
      apiMock.mock.calls.some(
        ([path, init]) =>
          path === "/settings/ai/connections/conn%3Amock" &&
          (init as RequestInit | undefined)?.method === "DELETE",
      ),
    ).toBe(false);

    fireEvent.click(
      within(dialog).getByRole("button", { name: "Remove connection" }),
    );
    await waitFor(() => {
      expect(apiMock).toHaveBeenCalledWith(
        "/settings/ai/connections/conn%3Amock",
        { method: "DELETE", body: "{}" },
      );
    });
  });

  it("keeps active-request removal conflicts safe and retryable", async () => {
    const privateServerMessage = "provider.internal.active-turn-detail";
    let removalAttempts = 0;
    apiMock.mockImplementation((path: string, init?: RequestInit) => {
      if (
        path === "/settings/ai/connections/conn%3Amock" &&
        init?.method === "DELETE"
      ) {
        removalAttempts += 1;
        return Promise.reject(new ApiErrorMock(privateServerMessage, 409));
      }
      if (path === "/settings") return Promise.resolve(settingsResponse);
      throw new Error(`Unexpected API call: ${path}`);
    });
    renderForm();
    await screen.findByRole("tab", { name: "Connections" });
    openTab("Connections");

    const row = (await screen.findByText("Deterministic Mock")).closest("li");
    expect(row).not.toBeNull();
    fireEvent.click(within(row!).getByRole("button", { name: "Configure AI" }));
    fireEvent.click(
      within(row!).getByRole("button", {
        name: "Remove connection: Deterministic Mock",
      }),
    );

    const dialog = await screen.findByRole("alertdialog", {
      name: "Remove this connection?",
    });
    const confirm = within(dialog).getByRole("button", {
      name: "Remove connection",
    });
    fireEvent.click(confirm);

    expect(
      await within(dialog).findByText(
        "An AI request is still using this connection. Stop the active request, then try removing the connection again.",
      ),
    ).toBeVisible();
    expect(within(dialog).queryByText(privateServerMessage)).toBeNull();
    expect(screen.getByRole("alertdialog")).toBe(dialog);
    expect(confirm).toBeEnabled();

    fireEvent.click(confirm);
    await waitFor(() => expect(removalAttempts).toBe(2));
    expect(screen.getByRole("alertdialog")).toBe(dialog);
  });
});
