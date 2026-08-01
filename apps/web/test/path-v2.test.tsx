import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DashboardClient } from "@/components/dashboard-client";

const { apiMock, pushMock } = vi.hoisted(() => ({
  apiMock: vi.fn(),
  pushMock: vi.fn(),
}));

vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

const unitTypes = [
  "briefing",
  "study",
  "recall",
  "teacher-dialogue",
  "quiz",
  "code-reading",
  "exercise",
  "review",
  "interview",
  "summary",
  "checkpoint",
  "spaced-review",
] as const;

function unit(type: (typeof unitTypes)[number], index: number) {
  const statuses = ["completed", "in_progress", "ready", "locked"] as const;
  return {
    id: `unit-${index + 1}`,
    stableId: `day-1-unit-${index + 1}`,
    type,
    order: index + 1,
    title: `Юнит ${index + 1}: ${type}`,
    description: `Описание ${type}`,
    estimatedMinutes: 10,
    objectives: [`Цель юнита ${index + 1}`],
    checklist: [],
    questions: [],
    payload: { type },
    status: statuses[index] ?? "locked",
  };
}

function day({
  id,
  order,
  status,
  sessionId = null,
}: {
  id: string;
  order: number;
  status: "completed" | "in_progress" | "available" | "locked";
  sessionId?: string | null;
}) {
  return {
    id,
    stableId: `day-${order}`,
    order,
    title: order === 1 ? "Значения, типы и scope" : "Функции и замыкания",
    description: `Описание дня ${order}`,
    goal: `Цель дня ${order}`,
    estimatedMinutes: 180,
    prerequisites: order === 1 ? [] : ["Завершить день 1"],
    expectedOutcomes: ["Объяснить механизм своими словами"],
    depthLevel: "foundation" as const,
    outOfScope: ["Оптимизация движка"],
    topics: ["JavaScript", "TypeScript"],
    status,
    sessionId,
    units:
      order === 1
        ? unitTypes.map(unit)
        : [
            {
              ...unit("briefing", 0),
              id: "day-2-unit-1",
              stableId: "day-2-briefing",
              status: "locked" as const,
            },
          ],
  };
}

function pathFixture(
  firstDay: ReturnType<typeof day> = day({
    id: "day-1-id",
    order: 1,
    status: "in_progress",
    sessionId: "session-active",
  }),
) {
  return {
    curriculum: {
      id: "curriculum-1",
      slug: "javascript-foundations",
      title: "JavaScript, TypeScript и React: восстановление фундамента",
      description: "Практический маршрут без преждевременных подсказок.",
      version: {
        id: "version-2",
        revision: 2,
        contentHash: "sha256-path-v2",
        status: "published" as const,
      },
      weeks: [
        {
          id: "week-1-id",
          stableId: "week-1",
          order: 1,
          title: "Фундамент языка",
          description: "Значения, функции и границы исполнения.",
          days: [firstDay, day({ id: "day-2-id", order: 2, status: "locked" })],
        },
      ],
    },
  };
}

function renderWithQuery(children: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>{children}</QueryClientProvider>,
    ),
  };
}

beforeEach(() => {
  apiMock.mockReset();
  pushMock.mockReset();
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: { randomUUID: vi.fn(() => "123e4567-e89b-42d3-a456-426614174000") },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("versioned learning path", () => {
  it("renders all 12 Day 1 unit types, explicit statuses, metadata, and a locked day", async () => {
    apiMock.mockResolvedValue(pathFixture());
    const { container } = renderWithQuery(<DashboardClient />);

    expect(await screen.findByText("Фундамент языка")).toBeInTheDocument();
    expect(
      container.querySelectorAll('[data-slot="curriculum-unit"]'),
    ).toHaveLength(13);
    for (const type of unitTypes) {
      expect(
        container.querySelector(`[data-unit-type="${type}"]`),
      ).toBeInTheDocument();
    }
    expect(screen.getAllByText(/^Готово ·/u).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/^Сейчас ·/u).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/^Доступно ·/u).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/^Заблокировано ·/u).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Глубина: foundation")).toHaveLength(2);
    expect(
      screen.getAllByText("Объяснить механизм своими словами"),
    ).toHaveLength(2);
    expect(screen.getAllByText("Оптимизация движка")).toHaveLength(2);
    expect(screen.getAllByText("JavaScript").length).toBeGreaterThan(0);
    expect(screen.getByText("1 из 13 юнитов завершено")).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Сначала завершите предыдущий день",
      }),
    ).toBeDisabled();

    const current = container.querySelector('[aria-current="step"]');
    expect(current).toHaveAttribute("data-status", "in_progress");
    expect(current).toHaveTextContent("Описание study");
    expect(screen.queryByText(/reference answer/iu)).not.toBeInTheDocument();
    expect(screen.queryByText(/evaluation points/iu)).not.toBeInTheDocument();
  });

  it("continues the active session without creating another one", async () => {
    apiMock.mockResolvedValue(pathFixture());
    renderWithQuery(<DashboardClient />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Продолжить занятие" }),
    );

    expect(pushMock).toHaveBeenCalledWith("/session?id=session-active");
    expect(apiMock).toHaveBeenCalledTimes(1);
  });

  it("starts the first available day with a client operation ID and invalidates queries", async () => {
    const available = day({
      id: "day-1-id",
      order: 1,
      status: "available",
    });
    available.units = available.units.map((candidate, index) => ({
      ...candidate,
      status: index === 0 ? ("ready" as const) : ("locked" as const),
    }));
    apiMock.mockImplementation((path: string) => {
      if (path === "/learning/path")
        return Promise.resolve(pathFixture(available));
      if (path === "/learning/sessions/v2") {
        return Promise.resolve({ session: { id: "session-new" } });
      }
      throw new Error(`Unexpected API path: ${path}`);
    });
    const { client } = renderWithQuery(<DashboardClient />);
    const invalidate = vi.spyOn(client, "invalidateQueries");

    fireEvent.click(
      await screen.findByRole("button", { name: "Начать занятие" }),
    );

    await vi.waitFor(() => {
      expect(apiMock).toHaveBeenCalledWith(
        "/learning/sessions/v2",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            dayId: "day-1-id",
            operationId: "123e4567-e89b-42d3-a456-426614174000",
          }),
        }),
      );
    });
    expect(await vi.waitFor(() => pushMock.mock.calls.length)).toBeTruthy();
    expect(pushMock).toHaveBeenCalledWith("/session?id=session-new");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["learning-path"] });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["learning-session-current"],
    });
  });

  it("rejects protected evaluation fields at the browser boundary", async () => {
    const leaked = pathFixture();
    Object.assign(leaked.curriculum.weeks[0]?.days[0]?.units[0] ?? {}, {
      referenceAnswer: "secret reference answer",
      evaluationPoints: ["secret evaluation points"],
      correctOptionIds: ["secret-option"],
    });
    apiMock.mockResolvedValue(leaked);

    renderWithQuery(<DashboardClient />);

    expect(
      await screen.findByText(/Protected curriculum field received/u),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("secret reference answer"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("secret evaluation points"),
    ).not.toBeInTheDocument();
  });

  it("announces loading and renders a retryable error", async () => {
    apiMock.mockReturnValueOnce(new Promise(() => undefined));
    const loading = renderWithQuery(<DashboardClient />);
    expect(screen.getByRole("status")).toHaveAccessibleName(
      "Загружаю учебный маршрут…",
    );
    loading.unmount();

    apiMock.mockRejectedValueOnce(new Error("Path endpoint is unavailable"));
    renderWithQuery(<DashboardClient />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Path endpoint is unavailable",
    );
    expect(screen.getByRole("button", { name: "Повторить" })).toBeEnabled();
  });
});
