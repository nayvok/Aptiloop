import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppShell } from "@/components/app-shell";
import { KnowledgeClient } from "@/components/knowledge-client";
import { ProviderHealth } from "@/components/provider-health";
import { SettingsForm } from "@/components/settings-form";

const { apiMock, pathnameState, setThemeMock } = vi.hoisted(() => ({
  apiMock: vi.fn(),
  pathnameState: { value: "/" },
  setThemeMock: vi.fn(),
}));

vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("next/navigation", () => ({
  usePathname: () => pathnameState.value,
}));
vi.mock("next-themes", () => ({
  useTheme: () => ({
    theme: "system",
    resolvedTheme: "light",
    setTheme: setThemeMock,
  }),
}));

function renderWithQuery(children: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  );
}

const settingsResponse = {
  workspaceRoot: "C:/trusted/exercises",
  zedExecutable: "zed",
  opencodeBaseUrl: "http://127.0.0.1:4096",
  teacherProvider: "mock",
  teacherModel: "mock-deterministic",
  reviewerProvider: "codex",
  reviewerModel: "gpt-review",
  interviewerProvider: "mock",
  interviewerModel: "mock-deterministic",
  curatorProvider: "mock",
  curatorModel: "mock-deterministic",
  codexExpertProvider: "codex",
  codexExpertModel: "gpt-expert",
  theme: "system",
  providers: [
    {
      id: "mock",
      status: "connected",
      models: [{ id: "mock-deterministic", name: "Mock" }],
    },
    {
      id: "codex",
      status: "connected",
      models: [{ id: "gpt-review", name: "GPT Review" }],
    },
  ],
} as const;

beforeEach(() => {
  apiMock.mockReset();
  setThemeMock.mockReset();
  pathnameState.value = "/";
});

afterEach(cleanup);

describe("UI foundation", () => {
  it("exposes a skip target and the product IA without Agents in primary navigation", async () => {
    apiMock.mockResolvedValue({ providers: [] });

    renderWithQuery(
      <AppShell>
        <p>Основное содержимое</p>
      </AppShell>,
    );

    expect(
      screen.getByRole("link", { name: "К основному содержимому" }),
    ).toHaveAttribute("href", "#main-content");
    expect(screen.getByRole("main")).toHaveAttribute("id", "main-content");
    expect(screen.getAllByRole("link", { name: "Путь" })).not.toHaveLength(0);
    expect(
      screen.queryByRole("link", { name: "Агенты" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Инструменты разработчика" }),
    ).toHaveAttribute("href", "/settings/developer-tools");
    for (const current of document.querySelectorAll('[aria-current="page"]')) {
      expect(current).toHaveAttribute("href", "/");
    }

    fireEvent.click(screen.getByRole("button", { name: "Переключить тему" }));
    expect(setThemeMock).toHaveBeenCalledWith("light");
  });

  it("applies theme immediately and omits server-owned paths from mutations", async () => {
    apiMock.mockImplementation((path: string, init?: RequestInit) => {
      if (path === "/settings" && init) return Promise.resolve({ saved: true });
      if (path === "/settings") return Promise.resolve(settingsResponse);
      return Promise.resolve({ providers: [] });
    });

    renderWithQuery(<SettingsForm />);

    expect(await screen.findByText("C:/trusted/exercises")).toBeInTheDocument();
    expect(
      screen.queryByDisplayValue("C:/trusted/exercises"),
    ).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("zed")).not.toBeInTheDocument();

    const theme = screen.getByLabelText("Тема");
    fireEvent.change(theme, {
      target: { value: "light" },
    });
    fireEvent.change(theme, {
      target: { value: "system" },
    });
    fireEvent.change(theme, {
      target: { value: "dark" },
    });
    expect(setThemeMock).toHaveBeenCalledWith("light");
    expect(setThemeMock).toHaveBeenCalledWith("system");
    expect(setThemeMock).toHaveBeenCalledWith("dark");

    fireEvent.change(screen.getByLabelText("OpenCode server"), {
      target: { value: "https://example.com" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Сохранить настройки" }),
    );
    const endpoint = await screen.findByLabelText("OpenCode server");
    await waitFor(() =>
      expect(endpoint).toHaveAttribute("aria-invalid", "true"),
    );
    expect(endpoint.getAttribute("aria-describedby")).toContain(
      "opencodeBaseUrl-error",
    );

    fireEvent.change(endpoint, { target: { value: "http://127.0.0.1:4096" } });
    fireEvent.click(
      screen.getByRole("button", { name: "Сохранить настройки" }),
    );

    await waitFor(() => {
      const mutation = apiMock.mock.calls.find(
        ([path, init]) => path === "/settings" && init?.method === "PUT",
      );
      expect(mutation).toBeDefined();
      const body = JSON.parse(String(mutation?.[1]?.body)) as Record<
        string,
        unknown
      >;
      expect(body).not.toHaveProperty("workspaceRoot");
      expect(body).not.toHaveProperty("zedExecutable");
      expect(body.theme).toBe("dark");
    });
  });

  it("summarizes every provider instead of choosing the first connection", async () => {
    apiMock.mockResolvedValue({
      providers: [
        { id: "mock", label: "Mock", status: "connected", model: "Mock" },
        { id: "codex", label: "Codex", status: "connected", model: "GPT" },
        {
          id: "opencode",
          label: "OpenCode",
          status: "error",
          message: "sidecar stopped",
        },
      ],
    });

    renderWithQuery(<ProviderHealth />);

    const status = await screen.findByRole("status", {
      name: /Mock: connected.*Codex: connected.*OpenCode: error/u,
    });
    expect(status).toHaveTextContent("2/3 подключено");
    expect(status).toHaveAttribute("data-variant", "warning");
  });

  it("gives every knowledge dimension an explicit progress name and scale", async () => {
    apiMock.mockResolvedValue({
      topics: [
        {
          id: "scope",
          title: "Lexical scope",
          group: "JavaScript",
          scores: {
            understanding: 1.2,
            explanation: 1,
            codeReading: 0.8,
            implementation: 0.9,
            debugging: 0.5,
            interview: 0.7,
          },
          evidenceCount: 3,
          reviewDue: false,
        },
      ],
    });

    renderWithQuery(<KnowledgeClient />);

    const progress = await screen.findByRole("progressbar", {
      name: "Lexical scope: Понимание",
    });
    expect(progress).toHaveAttribute("aria-valuenow", "1.2");
    expect(progress).toHaveAttribute("aria-valuemax", "5");
    expect(progress).toHaveAttribute("aria-valuetext", "1.2 из 5");
  });
});
