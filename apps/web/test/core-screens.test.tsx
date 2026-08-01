import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ExerciseClient } from "@/components/exercise-client";
import { KnowledgeClient } from "@/components/knowledge-client";
import { ProviderHealth } from "@/components/provider-health";

const { apiMock, pushMock } = vi.hoisted(() => ({
  apiMock: vi.fn(),
  pushMock: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: apiMock,
  streamAgent: vi.fn(async function* () {
    yield { type: "message.delta", content: "Вопрос Teacher" };
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () =>
    new URLSearchParams("id=session-1&sessionId=session-1"),
}));

function renderWithQuery(children: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  );
}

beforeEach(() => {
  apiMock.mockReset();
  pushMock.mockReset();
});

afterEach(cleanup);

describe("core learning screens", () => {
  it("shows the connected provider and active model", async () => {
    apiMock.mockResolvedValue({
      providers: [
        {
          id: "mock",
          label: "Mock",
          status: "connected",
          model: "Deterministic Mock",
        },
      ],
    });

    renderWithQuery(<ProviderHealth />);
    expect(await screen.findByText(/Deterministic Mock/u)).toBeInTheDocument();
  });

  it("renders knowledge dimensions and evidence", async () => {
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
          reviewDue: true,
        },
      ],
    });

    renderWithQuery(<KnowledgeClient />);
    expect(await screen.findByText("Lexical scope")).toBeInTheDocument();
    expect(screen.getByText("повторить")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("reveals a diff before allowing a structured review", async () => {
    apiMock.mockImplementation((requestPath: string) => {
      if (requestPath.includes("/diff")) {
        return Promise.resolve({ diff: "+ learner change", changed: true });
      }
      if (requestPath.includes("/reviews")) {
        return Promise.resolve({
          status: "changes_requested",
          summary: "Проверь пустой массив",
          findings: [
            {
              severity: "warning",
              category: "edge_case",
              message: "Нужен empty case",
              hintLevel: 1,
            },
          ],
          strengths: ["Чистая функция"],
        });
      }
      return Promise.resolve({
        id: "exercise-1",
        title: "Normalize profile",
        prompt: "Нормализуй unknown без any",
        difficulty: "easy",
        estimatedMinutes: 45,
        criteria: ["Проверены поля"],
        constraints: ["Без any"],
        topics: ["unknown"],
        workspacePath: "workspaces/exercises/week-01/day-01/normalize-profile",
        attempt: { id: "attempt-1", changed: false, testsRun: false },
      });
    });

    renderWithQuery(<ExerciseClient />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Показать Git diff" }),
    );
    expect(await screen.findByText("+ learner change")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Запросить review" }));
    expect(
      await screen.findByText("Проверь пустой массив"),
    ).toBeInTheDocument();
  });
});
