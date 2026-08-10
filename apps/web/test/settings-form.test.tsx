import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
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

const { apiMock, setThemeMock } = vi.hoisted(() => ({
  apiMock: vi.fn(),
  setThemeMock: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  ApiError: class ApiError extends Error {},
  api: apiMock,
}));
vi.mock("next-themes", () => ({
  useTheme: () => ({ setTheme: setThemeMock }),
}));

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
          models: [{ modelId: "mock-deterministic", available: true }],
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
          models: [{ modelId: "pi-exact", available: true }],
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

beforeAll(() => {
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
});
beforeEach(() => {
  apiMock.mockReset();
  setThemeMock.mockReset();
  apiMock.mockImplementation((path: string, init?: RequestInit) => {
    if (path === "/settings" && init?.method === "PUT") {
      return Promise.resolve({ saved: true });
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
  it("shows explicit role controls and observed connections", async () => {
    renderForm();

    expect(
      await screen.findByRole("heading", { name: "Interface" }),
    ).toBeVisible();
    expect(screen.getByRole("heading", { name: "AI roles" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Connections" })).toBeVisible();
    for (const label of ["Course Designer", "Tutor", "Evaluator", "Reviewer"]) {
      expect(await screen.findByLabelText(label)).toHaveAttribute(
        "role",
        "combobox",
      );
    }
    expect(screen.getByText("Deterministic Mock")).toBeVisible();
    expect(screen.getByText("OpenAI via Pi")).toBeVisible();
    expect(screen.getByText("C:/trusted/exercises")).toBeVisible();
    expect(screen.getByText("zed")).toBeVisible();
  });

  it("applies theme only after user input and submits theme alone", async () => {
    renderForm();
    await screen.findByRole("heading", { name: "Interface" });
    expect(setThemeMock).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Theme"), {
      target: { value: "dark" },
    });
    expect(setThemeMock).toHaveBeenCalledWith("dark");
    fireEvent.click(
      screen.getByRole("button", { name: "Save interface settings" }),
    );

    await waitFor(() => {
      const mutation = apiMock.mock.calls.find(
        ([path, init]) => path === "/settings" && init?.method === "PUT",
      );
      expect(JSON.parse(String(mutation?.[1]?.body))).toEqual({
        theme: "dark",
      });
    });
  });

  it("saves all four exact role profiles as one strict mutation", async () => {
    renderForm();
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
});
