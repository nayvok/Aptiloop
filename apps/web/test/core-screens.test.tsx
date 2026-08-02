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
    apiMock.mockImplementation((path: string) => {
      if (path === "/providers") {
        return Promise.resolve({
          providers: [
            {
              id: "mock",
              label: "Mock",
              status: "connected",
              model: "Deterministic Mock",
            },
          ],
        });
      }
      if (path === "/settings") {
        return Promise.resolve({
          teacherProvider: "mock",
          teacherModel: "Deterministic Mock",
          reviewerProvider: "mock",
          reviewerModel: "Deterministic Mock",
          interviewerProvider: "mock",
          interviewerModel: "Deterministic Mock",
          curatorProvider: "mock",
          curatorModel: "Deterministic Mock",
          codexExpertProvider: "mock",
          codexExpertModel: "Deterministic Mock",
        });
      }
      throw new Error(`Unexpected API path: ${path}`);
    });

    renderWithQuery(<ProviderHealth />);
    const status = await screen.findByRole("button", {
      name: /Статус AI/u,
    });
    expect(status).toHaveTextContent("AI готов");
    expect(status).toHaveAttribute("data-state", "ready");
    fireEvent.click(status);
    expect(
      (await screen.findAllByText(/Mock · Deterministic Mock/u)).length,
    ).toBeGreaterThan(0);
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

  it("restores persisted practice evidence after mounting", async () => {
    apiMock.mockResolvedValue({
      sessionId: "session-1",
      exerciseUnitId: "unit-exercise",
      reviewUnitId: "unit-review",
      exerciseUnitProgress: {
        status: "in_progress",
        payload: {
          type: "exercise",
          attemptId: "attempt-1",
          latestTestRunId: "test-1",
          latestReviewId: null,
        },
      },
      reviewUnitProgress: {
        status: "locked",
        payload: {
          type: "review",
          reviewId: null,
          reviewStatus: null,
          reviewedDiffHash: null,
        },
      },
      id: "exercise-1",
      title: "Normalize profile",
      prompt: "Нормализуй unknown без any",
      difficulty: "easy",
      estimatedMinutes: 45,
      criteria: ["Проверены поля"],
      constraints: ["Без any"],
      topics: ["unknown"],
      workspacePath: "C:/attempts/attempt-1",
      attempt: {
        id: "attempt-1",
        changed: true,
        testsRun: true,
        diff: {
          patch: "+ learner change",
          changed: true,
          truncated: false,
        },
        latestTestRun: {
          id: "test-1",
          operationId: "test-operation-1",
          status: "passed",
          exitCode: 0,
          output: "all tests passed",
          workspaceCurrent: true,
        },
        latestReview: {
          id: "review-1",
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
        },
      },
    });

    renderWithQuery(<ExerciseClient />);
    expect(await screen.findByText("+ learner change")).toBeInTheDocument();
    expect(screen.getByText(/all tests passed/u)).toBeInTheDocument();
    expect(screen.getByText("Проверь пустой массив")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Запросить проверку" }),
    ).toBeDisabled();
  });
});
