import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
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

import {
  normalizeTechnicalModelSearch,
  SettingsForm,
} from "@/components/settings-form";
import { LocaleProvider } from "@/lib/i18n";

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
  useTheme: () => ({ theme: "light", setTheme: setThemeMock }),
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

const roleProfiles = [
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
];

const settingsResponse = {
  workspaceRoot: "C:/trusted/exercises",
  zedExecutable: "zed",
  opencodeBaseUrl: "http://127.0.0.1:4096",
  theme: "system" as const,
  uiLocale: "ru-RU" as const,
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
    roleProfiles,
    management: {
      catalog: [],
      connections: [],
    },
  },
};

function renderSettings(response = settingsResponse) {
  apiMock.mockImplementation((path: string, init?: RequestInit) => {
    if (path === "/settings/ai" && init?.method === "PUT") {
      const submitted = JSON.parse(String(init.body)) as {
        roleProfiles: typeof roleProfiles;
      };
      return Promise.resolve({
        saved: true,
        roleProfiles: submitted.roleProfiles.map((profile) => ({
          ...roleProfiles.find((candidate) => candidate.role === profile.role)!,
          ...profile,
        })),
      });
    }
    if (path === "/settings") return Promise.resolve(response);
    throw new Error(`Unexpected API call: ${path}`);
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return Object.assign(
    render(
      <QueryClientProvider client={client}>
        <LocaleProvider initialLocale="en-US" syncSettings={false}>
          <SettingsForm />
        </LocaleProvider>
      </QueryClientProvider>,
    ),
    { client },
  );
}

function openSection(name: string) {
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
  document.documentElement.lang = "en-US";
  window.localStorage.clear();
  document.cookie = "aptiloop.ui-locale=; Path=/; Max-Age=0";
});

afterEach(cleanup);

describe("Settings v2", () => {
  it("normalizes technical model IDs independently from the host locale", () => {
    const localeLowercase = vi
      .spyOn(String.prototype, "toLocaleLowerCase")
      .mockReturnValue("nvıdıa");

    expect(normalizeTechnicalModelSearch(" NVIDIA-NIM ")).toBe("nvidia-nim");
    expect(localeLowercase).not.toHaveBeenCalled();
    localeLowercase.mockRestore();
  });

  it("binds Interface to browser preferences without loading Core settings", async () => {
    renderSettings();

    expect(
      await screen.findByRole("heading", { level: 2, name: "Interface" }),
    ).toBeVisible();
    expect(document.documentElement.lang).toBe("en-US");
    expect(setThemeMock).not.toHaveBeenCalled();
    expect(apiMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Theme")).toHaveTextContent("Light");
  });

  it("keeps Interface usable when Core settings are unavailable", async () => {
    apiMock.mockRejectedValue(new Error("Core unavailable"));
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

    render(
      <QueryClientProvider client={client}>
        <LocaleProvider initialLocale="en-US" syncSettings={false}>
          <SettingsForm />
        </LocaleProvider>
      </QueryClientProvider>,
    );

    expect(
      await screen.findByRole("heading", { name: "Interface" }),
    ).toBeVisible();
    expect(document.documentElement.lang).toBe("en-US");
    expect(screen.getByLabelText("Theme")).toHaveTextContent("Light");
    expect(screen.getByLabelText("Interface language")).toHaveTextContent(
      "English (United States)",
    );
    expect(apiMock).not.toHaveBeenCalled();
  });

  it("renders deliberate desktop navigation and a compact mobile section control", async () => {
    const { container } = renderSettings();
    await screen.findByRole("heading", { name: "Interface" });

    const localNavigation = container.querySelector(
      '[data-slot="settings-local-navigation"]',
    );
    expect(localNavigation).toHaveClass("hidden", "xl:block");
    const desktopTablist = within(localNavigation as HTMLElement).getByRole(
      "tablist",
      { name: "Settings" },
    );
    expect(desktopTablist).toHaveAttribute("aria-orientation", "vertical");
    expect(desktopTablist).toHaveAttribute("data-variant", "rail");
    expect(desktopTablist).not.toHaveClass("border", "bg-background");
    for (const tab of within(localNavigation as HTMLElement).getAllByRole(
      "tab",
    )) {
      expect(tab).toHaveClass(
        "min-h-10",
        "border-0",
        "whitespace-normal",
        "after:hidden",
      );
    }
    expect(
      container.querySelector('[data-slot="settings-selected-pane"]'),
    ).toHaveClass("min-w-0", "xl:max-w-[68rem]");
    const interfaceSurface = container.querySelector(
      '[data-slot="settings-selected-pane"] [data-slot="field-group"]',
    );
    expect(interfaceSurface).toHaveClass(
      "gap-0",
      "rounded-xl",
      "bg-surface-soft/50",
    );
    expect(interfaceSurface).not.toHaveClass("border", "divide-y");
    expect(
      container.querySelector('[data-slot="settings-interface-footer"]'),
    ).toHaveClass("border-t", "border-border/35", "py-3.5");
    const mobileControl = container.querySelector(
      '[data-slot="settings-mobile-section-control"]',
    );
    expect(mobileControl).toHaveClass("xl:hidden");
    expect(
      within(mobileControl as HTMLElement).getByLabelText("Settings"),
    ).toHaveAttribute("role", "combobox");
  });

  it("uses URL-backed sections and reacts to browser history changes", async () => {
    navigationState.setSearch("?section=connections&source=recovery");
    const { container } = renderSettings();

    expect(
      await screen.findByRole("tab", { name: "Connections" }),
    ).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByText("Deterministic Mock")).toBeVisible();

    openSection("AI roles");
    await screen.findByLabelText("Default model");
    expect(navigationState.push).toHaveBeenLastCalledWith(
      "/settings?section=ai&source=recovery",
      { scroll: false },
    );

    act(() =>
      navigationState.setSearch("?section=connections&source=recovery"),
    );
    expect(
      await screen.findByRole("tab", { name: "Connections" }),
    ).toHaveAttribute("aria-selected", "true");

    const mobileControl = container.querySelector(
      '[data-slot="settings-mobile-section-control"]',
    );
    expect(mobileControl).not.toBeNull();
    fireEvent.click(
      within(mobileControl as HTMLElement).getByRole("combobox", {
        name: "Settings",
      }),
    );
    fireEvent.click(
      await screen.findByRole("option", { name: "Core & local paths" }),
    );
    expect(navigationState.push).toHaveBeenLastCalledWith(
      "/settings?section=advanced&source=recovery",
      { scroll: false },
    );
  });

  it("applies one default AI profile while keeping per-role overrides optional", async () => {
    const { client } = renderSettings();
    client.setQueryData(["settings"], structuredClone(settingsResponse));
    client.setQueryData(
      ["settings", "provider-health"],
      structuredClone(settingsResponse),
    );
    await screen.findByRole("tab", { name: "AI roles" });
    openSection("AI roles");

    const defaultProfile = await screen.findByLabelText("Default model");
    expect(defaultProfile).toHaveTextContent("Mixed configuration");
    expect(screen.queryByLabelText("Reviewer")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Customize roles" }));
    expect(await screen.findByLabelText("Course Designer")).toHaveTextContent(
      "AI Off",
    );
    expect(screen.getByLabelText("Reviewer")).toHaveTextContent(
      "Deterministic Mock · mock-deterministic",
    );

    fireEvent.click(defaultProfile);
    fireEvent.click(
      await screen.findByRole("option", {
        name: "OpenAI via Pi · pi-exact",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save AI roles" }));

    await waitFor(() => {
      const mutation = apiMock.mock.calls.find(
        ([path, init]) => path === "/settings/ai" && init?.method === "PUT",
      );
      const body = JSON.parse(String(mutation?.[1]?.body)) as {
        roleProfiles: Array<{
          mode: string;
          connectionId: string | null;
          modelId: string | null;
        }>;
      };
      expect(body.roleProfiles).toHaveLength(4);
      expect(body.roleProfiles).toEqual(
        body.roleProfiles.map((profile) => ({
          ...profile,
          mode: "connection",
          connectionId: "conn:pi:openai",
          modelId: "pi-exact",
        })),
      );
    });

    expect(await screen.findByLabelText("Reviewer")).toHaveAttribute(
      "role",
      "combobox",
    );
    await waitFor(() => {
      const shellSettings = client.getQueryData<typeof settingsResponse>([
        "settings",
      ]);
      expect(shellSettings?.ai.roleProfiles).toEqual(
        shellSettings?.ai.roleProfiles.map((profile) => ({
          ...profile,
          mode: "connection",
          connectionId: "conn:pi:openai",
          modelId: "pi-exact",
        })),
      );
      expect(client.getQueryState(["settings"])?.isInvalidated).toBe(true);
      const providerSettings = client.getQueryData<typeof settingsResponse>([
        "settings",
        "provider-health",
      ]);
      expect(providerSettings?.ai.roleProfiles).toEqual(
        providerSettings?.ai.roleProfiles.map((profile) => ({
          ...profile,
          mode: "connection",
          connectionId: "conn:pi:openai",
          modelId: "pi-exact",
        })),
      );
    });
  });

  it("searches a bounded model list and explains unavailable selections", async () => {
    const response = structuredClone(settingsResponse);
    response.ai.connections[0]!.observedCapabilities!.connection.authenticated = false;
    response.ai.connections[1]!.state = "degraded";
    response.ai.connections[1]!.observedCapabilities!.models = Array.from(
      { length: 60 },
      (_, index) => ({
        modelId: `pi-catalog-${String(index).padStart(2, "0")}`,
        available: true,
        contextTokens: 128_000,
        outputTokens: 16_000,
        typedToolCalls: "schema-constrained" as const,
        parallelToolCalls: false,
        attachments: ["text"] as const,
      }),
    );
    navigationState.setSearch("?section=ai");
    renderSettings(response);

    fireEvent.click(await screen.findByLabelText("Default model"));
    const search = await screen.findByPlaceholderText(
      "Search connections and model IDs…",
    );
    const listbox = screen.getByRole("listbox", {
      name: "Search connections and model IDs…",
    });
    expect(listbox).toHaveClass("max-h-72", "overflow-y-auto");

    fireEvent.change(search, { target: { value: "mock-deterministic" } });
    const unauthenticatedModel = await within(listbox).findByRole("option", {
      name: /mock-deterministic.*Authentication required/u,
    });
    expect(unauthenticatedModel).toBeDisabled();
    expect(unauthenticatedModel).toHaveAttribute("aria-disabled", "true");

    fireEvent.change(search, { target: { value: "pi-catalog-59" } });
    const degradedModel = await within(listbox).findByRole("option", {
      name: /pi-catalog-59.*Needs canary/u,
    });
    expect(degradedModel).toBeDisabled();
    expect(within(listbox).getAllByRole("option")).toHaveLength(1);
  });

  it("keeps a failed provider explicit instead of switching the default to Off", async () => {
    const response = structuredClone(settingsResponse);
    response.ai.connections[0]!.state = "error";
    for (const profile of response.ai.roleProfiles) {
      Object.assign(profile, {
        mode: "connection" as const,
        connectionId: "conn:mock",
        modelId: "mock-deterministic",
      });
    }
    renderSettings(response);
    await screen.findByRole("tab", { name: "AI roles" });
    openSection("AI roles");

    const defaultProfile = await screen.findByLabelText("Default model");
    expect(defaultProfile).toHaveTextContent(
      "Deterministic Mock · mock-deterministic",
    );
    expect(screen.getByText("Unavailable")).toBeVisible();
    expect(defaultProfile).not.toHaveTextContent("AI Off");
  });

  it("checks the exact model and every persisted capability for default and role badges", async () => {
    const response = structuredClone(settingsResponse);
    for (const profile of response.ai.roleProfiles) {
      Object.assign(profile, {
        mode: "connection" as const,
        connectionId: "conn:mock",
        modelId: "mock-deterministic",
        requiredCapabilities: ["streaming", "models", "cancellation"],
      });
    }
    response.ai.connections[0]!.observedCapabilities!.connection.streaming = false;
    navigationState.setSearch("?section=ai");
    const { container } = renderSettings(response);

    await screen.findByLabelText("Default model");
    await waitFor(() =>
      expect({
        selection: screen.getByLabelText("Default model").textContent,
        readiness: Array.from(
          container.querySelectorAll("[data-assignment-readiness]"),
        ).map((element) => element.getAttribute("data-assignment-readiness")),
      }).toEqual({
        selection: "Deterministic Mock · mock-deterministic",
        readiness: ["unsupported"],
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Customize roles" }));
    const reviewerField = screen
      .getByLabelText("Reviewer")
      .closest('[data-slot="field"]');
    expect(reviewerField).not.toBeNull();
    expect(
      reviewerField!.querySelector('[data-assignment-readiness="unsupported"]'),
    ).toHaveTextContent("Capability unavailable");
  });

  it("keeps unobserved and unrepresentable requirements explicitly unknown", async () => {
    const response = structuredClone(settingsResponse);
    for (const profile of response.ai.roleProfiles) {
      Object.assign(profile, {
        mode: "connection" as const,
        connectionId: "conn:mock",
        modelId: "mock-deterministic",
        requiredCapabilities: ["structured-output"],
      });
    }
    navigationState.setSearch("?section=ai");
    const view = renderSettings(response);

    await screen.findByLabelText("Default model");
    await waitFor(() =>
      expect(
        Array.from(
          view.container.querySelectorAll("[data-assignment-readiness]"),
        ).map((element) => element.getAttribute("data-assignment-readiness")),
      ).toContain("unknown"),
    );

    view.unmount();
    Object.assign(response.ai.connections[0]!, { observedCapabilities: null });
    const next = renderSettings(response);
    await screen.findByLabelText("Default model");
    await waitFor(() =>
      expect(
        Array.from(
          next.container.querySelectorAll("[data-assignment-readiness]"),
        ).map((element) => element.getAttribute("data-assignment-readiness")),
      ).toContain("unknown"),
    );
  });
});
