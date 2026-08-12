import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ExerciseClient } from "@/components/exercise-client";
import { ReviewQueueClient } from "@/components/flashcards-client";
import { KnowledgeClient } from "@/components/knowledge-client";
import { MistakesClient } from "@/components/mistakes-client";
import { ProviderHealth } from "@/components/provider-health";
import { LocaleProvider } from "@/lib/i18n";

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
    <QueryClientProvider client={client}>
      <LocaleProvider initialLocale="ru-RU" syncSettings={false}>
        {children}
      </LocaleProvider>
    </QueryClientProvider>,
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
      ai: {
        connections: [
          {
            connectionId: "conn:mock",
            displayName: "Deterministic Mock",
            enabled: true,
            state: "connected",
            observedCapabilities: {
              connection: {
                authenticated: true,
                streaming: true,
                cancellation: true,
              },
              models: [
                {
                  modelId: "mock-deterministic",
                  available: true,
                  typedToolCalls: "schema-constrained",
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
          },
          ...(["tutor", "evaluator", "reviewer"] as const).map((role) => ({
            role,
            mode: "connection" as const,
            connectionId: "conn:mock",
            modelId: "mock-deterministic",
            requiredCapabilities: ["streaming", "models", "cancellation"],
          })),
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
      (await screen.findAllByText(/Deterministic Mock · mock-deterministic/u))
        .length,
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
    expect(
      await screen.findByRole("heading", { name: "JavaScript" }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Lexical scope" }),
    ).toBeVisible();
    const reviewLink = screen.getByRole("link", {
      name: "Нужно повторить: Lexical scope",
    });
    expect(reviewLink).toHaveAttribute("href", "/review");
    expect(reviewLink).toHaveTextContent("Нужно повторить");
    expect(screen.getByText(/Подтверждений: 3/u)).toBeVisible();
  });

  it("keeps review tasks visible without source-session details and discloses history on request", async () => {
    const reviews = [
      {
        id: "review-pending",
        topic:
          "A very long pending topic that still needs deterministic review",
        knowledgeNodeId: "primitive values",
        dimension: "understanding",
        activityKind: "recall",
        reasonCode: "low_mastery",
        dueAt: "2026-01-01T00:00:00.000Z",
        state: "pending",
        isDue: true,
        sessionId: "session-review",
        activityId: "activity-review",
        execution: {
          id: "review-execution",
          type: "free-response",
          schemaVersion: 1,
          activitySnapshotHash: "a".repeat(64),
        },
      },
      {
        id: "review-completed",
        topic: "Completed review history",
        knowledgeNodeId: "knowledge-node-completed",
        dimension: "explanation",
        activityKind: "correction",
        reasonCode: "mistake",
        dueAt: "2025-12-20T00:00:00.000Z",
        state: "completed",
        isDue: false,
        sessionId: "session-history",
        activityId: "activity-history",
        execution: null,
      },
    ];
    apiMock.mockImplementation((path: string) => {
      if (path === "/learning/reviews") {
        return Promise.resolve({
          asOf: "2026-01-02T00:00:00.000Z",
          reviews,
        });
      }
      if (path.includes("/dismiss")) return Promise.resolve({ ok: true });
      throw new Error(`Unexpected API path: ${path}`);
    });

    renderWithQuery(<ReviewQueueClient />);

    expect(
      await screen.findByText(
        "A very long pending topic that still needs deterministic review",
      ),
    ).toBeVisible();
    expect(
      screen.queryByRole("link", { name: "Начать повторение" }),
    ).not.toBeInTheDocument();
    expect(
      document.querySelector('a[href^="/session?id="]'),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("session-review")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Completed review history"),
    ).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: /Полная детерминированная очередь/u,
      }),
    );
    expect(await screen.findByText("Completed review history")).toBeVisible();

    fireEvent.pointerDown(
      screen.getByRole("button", {
        name: /Убрать задание из очереди: A very long pending topic/u,
      }),
      { button: 0, ctrlKey: false },
    );
    fireEvent.click(
      await screen.findByRole("menuitem", {
        name: "Убрать задание из очереди",
      }),
    );
    const dialog = await screen.findByRole("alertdialog", {
      name: "Убрать задание из очереди",
    });
    expect(dialog).toHaveTextContent(
      "A very long pending topic that still needs deterministic review",
    );
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: "Убрать задание из очереди",
      }),
    );
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(
        expect.stringContaining("/reviews/review-pending/dismiss"),
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });

  it("starts only a typed due Review execution and never links its source session", async () => {
    apiMock.mockResolvedValue({
      asOf: "2026-01-02T00:00:00.000Z",
      reviews: [
        {
          id: "review-with-history-only",
          topic: "Historical source session",
          knowledgeNodeId: "knowledge-node-history-only",
          dimension: "understanding",
          activityKind: "recall",
          reasonCode: "mistake",
          dueAt: "2026-01-01T00:00:00.000Z",
          state: "pending",
          isDue: true,
          sessionId: "completed-source-session",
          activityId: "source-activity",
          execution: {
            id: "execution/with-path",
            type: "free-response",
            schemaVersion: 1,
            activitySnapshotHash: "b".repeat(64),
          },
        },
      ],
    });

    renderWithQuery(<ReviewQueueClient dueOnly />);

    expect(await screen.findByText("Historical source session")).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Начать повторение" }),
    ).toHaveAttribute("href", "/review?item=execution%2Fwith-path");
    expect(document.querySelector('a[href^="/session"]')).toBeNull();
    expect(screen.queryByText("completed-source-session")).toBeNull();
    expect(screen.queryByText("source-activity")).toBeNull();
  });

  it("keeps the Review dismissal confirmation open when the mutation fails", async () => {
    apiMock.mockImplementation((path: string) => {
      if (path === "/learning/reviews") {
        return Promise.resolve({
          asOf: "2026-01-02T00:00:00.000Z",
          reviews: [
            {
              id: "review-pending",
              topic: "Lexical scope",
              knowledgeNodeId: "lexical-scope",
              dimension: "understanding",
              activityKind: "recall",
              reasonCode: "mistake",
              dueAt: "2026-01-01T00:00:00.000Z",
              state: "pending",
              isDue: true,
              sessionId: "session-review",
              activityId: "activity-review",
              execution: null,
            },
          ],
        });
      }
      if (path.includes("/dismiss")) {
        return Promise.reject(new Error("write failed"));
      }
      throw new Error(`Unexpected API path: ${path}`);
    });

    renderWithQuery(<ReviewQueueClient />);
    fireEvent.pointerDown(
      await screen.findByRole("button", {
        name: "Убрать задание из очереди: Lexical scope",
      }),
      { button: 0, ctrlKey: false },
    );
    fireEvent.click(
      await screen.findByRole("menuitem", {
        name: "Убрать задание из очереди",
      }),
    );
    const dialog = await screen.findByRole("alertdialog", {
      name: "Убрать задание из очереди",
    });
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: "Убрать задание из очереди",
      }),
    );

    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(
        expect.stringContaining("/reviews/review-pending/dismiss"),
        expect.objectContaining({ method: "POST" }),
      ),
    );
    expect(dialog).toBeVisible();
  });

  it("uses server due classifications for Corrections", async () => {
    apiMock.mockResolvedValue({
      asOf: "2026-01-02T00:00:00.000Z",
      mistakes: [
        {
          id: "mistake-not-due",
          topic: "Past date without a due schedule",
          errorFamily: "missing-schedule",
          occurrenceCount: 1,
          reviewAt: "2025-12-01T00:00:00.000Z",
          isDue: false,
        },
        {
          id: "mistake-due",
          topic: "Kernel-scheduled correction",
          errorFamily: "scope-error",
          occurrenceCount: 2,
          reviewAt: "2026-01-01T00:00:00.000Z",
          isDue: true,
        },
      ],
    });

    renderWithQuery(<MistakesClient />);

    expect(
      await screen.findByText("Past date without a due schedule"),
    ).toBeVisible();
    expect(screen.getByText("Kernel-scheduled correction")).toBeVisible();
    expect(screen.getByText("Сейчас назначено: 1")).toBeVisible();
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
      workspace: {
        id: "workspace-1",
        generation: 1,
        environmentId: "apt.compat.node24.local.v1",
        trust: "trusted-local-unsandboxed",
      },
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
          result: null,
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
          evidenceBundle: null,
        },
      },
    });

    renderWithQuery(<ExerciseClient />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Diff от baseline/u }),
    );
    expect(await screen.findByText("+ learner change")).toBeInTheDocument();
    expect(screen.getByText(/all tests passed/u)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Reviewer/u }));
    expect(screen.getByText("Проверь пустой массив")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Запросить проверку" }),
    ).toBeDisabled();
  });
});
