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

const { apiMock, navigationState, setThemeMock } = vi.hoisted(() => {
  let search = "";
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());
  return {
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
        notify();
      }),
      setSearch: (next: string) => {
        search = next;
        notify();
      },
    },
  };
});

vi.mock("@/lib/api", () => ({
  ApiError: class ApiError extends Error {},
  api: apiMock,
}));
vi.mock("next-themes", () => ({
  useTheme: () => ({ setTheme: setThemeMock }),
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

  it("keeps interface choices as a Draft and applies them after one save", async () => {
    renderForm();
    await screen.findByRole("heading", { name: "Interface" });
    expect(setThemeMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText("Theme"));
    fireEvent.click(await screen.findByRole("option", { name: "Dark" }));
    expect(setThemeMock).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Save interface settings" }),
    );

    await waitFor(() => {
      const mutation = apiMock.mock.calls.find(
        ([path, init]) => path === "/settings" && init?.method === "PUT",
      );
      expect(JSON.parse(String(mutation?.[1]?.body))).toEqual({
        theme: "dark",
        uiLocale: "en-US",
      });
    });
    expect(setThemeMock).toHaveBeenCalledWith("dark");
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

    fireEvent.click(screen.getByRole("button", { name: "Add connection" }));
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

    fireEvent.click(screen.getByRole("button", { name: "Add connection" }));
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
});
