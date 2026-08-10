import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppShell } from "@/components/app-shell";
import { KnowledgeClient } from "@/components/knowledge-client";
import { ProviderHealth } from "@/components/provider-health";
import { Textarea } from "@/components/ui/textarea";
import { LocaleProvider } from "@/lib/i18n";

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
    <QueryClientProvider client={client}>
      <LocaleProvider initialLocale="ru-RU" syncSettings={false}>
        {children}
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  apiMock.mockReset();
  setThemeMock.mockReset();
  pathnameState.value = "/";
});

afterEach(cleanup);

describe("UI foundation", () => {
  it("renders the Textarea primitive with its slot and disabled state", () => {
    render(
      <label>
        Сообщение
        <Textarea disabled />
      </label>,
    );

    const textarea = screen.getByLabelText("Сообщение");
    expect(textarea).toHaveAttribute("data-slot", "textarea");
    expect(textarea).toBeDisabled();
  });

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
    expect(screen.getAllByRole("link", { name: "Главная" })).not.toHaveLength(
      0,
    );
    expect(
      screen.queryByRole("link", { name: "Агенты" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Инструменты разработчика" }),
    ).not.toBeInTheDocument();
    for (const current of document.querySelectorAll('[aria-current="page"]')) {
      expect(current).toHaveAttribute("href", "/");
    }

    expect(screen.getAllByRole("link", { name: "Настройки" })).not.toHaveLength(
      0,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Включить тему: светлая" }),
    );
    expect(setThemeMock).toHaveBeenCalledWith("light");
  });

  it("shows a compact AI status and role details in the popover", async () => {
    apiMock.mockResolvedValue({
      ai: {
        connections: [
          {
            connectionId: "conn:mock",
            displayName: "Deterministic Mock",
            state: "connected",
          },
          {
            connectionId: "conn:pi:openai",
            displayName: "OpenAI via Pi",
            state: "connected",
          },
        ],
        roleProfiles: [
          {
            role: "course-designer",
            mode: "no-ai",
            connectionId: null,
            modelId: null,
          },
          ...(["tutor", "evaluator"] as const).map((role) => ({
            role,
            mode: "connection" as const,
            connectionId: "conn:mock",
            modelId: "mock-deterministic",
          })),
          {
            role: "reviewer",
            mode: "connection",
            connectionId: "conn:pi:openai",
            modelId: "gpt-5.2",
          },
        ],
      },
    });

    renderWithQuery(<ProviderHealth />);

    const status = await screen.findByRole("button", {
      name: /Статус AI/u,
    });
    expect(status).toHaveTextContent("AI готов");
    expect(status).toHaveAttribute("data-state", "ready");

    fireEvent.click(status);
    expect(
      await screen.findByText("Необязательная AI-помощь"),
    ).toBeInTheDocument();
    expect(screen.getByText(/Готово ролей: 4 из 4/u)).toBeInTheDocument();
    expect(screen.getByText("Дизайнер курса")).toBeInTheDocument();
    expect(
      screen.getAllByText(/Deterministic Mock · mock-deterministic/u),
    ).toHaveLength(2);
    expect(screen.getByText(/OpenAI via Pi · gpt-5.2/u)).toBeInTheDocument();
    expect(
      screen.getByRole("link", {
        name: /Открыть диагностику разработчика/u,
      }),
    ).toHaveAttribute("href", "/settings/developer-tools");
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

    const progress = await screen.findAllByRole("progressbar", {
      name: "Lexical scope: Понимание",
    });
    expect(progress).toHaveLength(2);
    for (const bar of progress) {
      expect(bar).toHaveAttribute("aria-valuenow", "1.2");
      expect(bar).toHaveAttribute("aria-valuemax", "5");
      expect(bar).toHaveAttribute("aria-valuetext", "1.2 из 5");
    }
  });
});
