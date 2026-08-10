import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ExerciseClient } from "@/components/exercise-client";
import { LocaleProvider } from "@/lib/i18n";

const { apiMock, pushMock, searchState } = vi.hoisted(() => ({
  apiMock: vi.fn(),
  pushMock: vi.fn(),
  searchState: { value: "sessionId=session-v2" },
}));

vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () => new URLSearchParams(searchState.value),
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

function finding() {
  return {
    severity: "warning" as const,
    category: "edge_case" as const,
    message: "Добавьте проверку пустого массива",
    hintLevel: 1,
  };
}

function exerciseState(options?: {
  diff?: string;
  testStatus?: "passed" | "failed";
  workspaceCurrent?: boolean;
  review?: "passed" | "changes_requested" | null;
}) {
  const diff = options?.diff ?? "+ current learner change";
  const testStatus = options?.testStatus ?? "passed";
  const review = options?.review ?? null;
  return {
    sessionId: "session-v2",
    exerciseUnitId: "unit-exercise",
    reviewUnitId: "unit-review",
    exerciseUnitProgress: {
      status: "in_progress",
      payload: {
        type: "exercise",
        attemptId: "attempt-v2",
        latestTestRunId: "test-v1",
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
    id: "exercise-w1d1-normalize-profile-v2",
    title: "Normalize profile",
    prompt: "Нормализуйте unknown без any",
    difficulty: "foundation",
    estimatedMinutes: 45,
    criteria: ["Все поля проверены"],
    constraints: ["Без any"],
    topics: ["unknown", "type guards"],
    workspace: {
      id: "workspace-v2",
      generation: 1,
      environmentId: "apt.compat.node24.local.v1",
      trust: "trusted-local-unsandboxed",
    },
    attempt: {
      id: "attempt-v2",
      changed: true,
      testsRun: true,
      diff: { patch: diff, changed: true, truncated: false },
      latestTestRun: {
        id: "test-v1",
        operationId: "operation-test-v1",
        status: testStatus,
        exitCode: testStatus === "passed" ? 0 : 1,
        output: testStatus === "passed" ? "12 passed" : "1 failed",
        result: null,
        workspaceCurrent: options?.workspaceCurrent ?? true,
      },
      latestReview: review
        ? {
            id: "review-v1",
            status: review,
            summary:
              review === "passed" ? "Решение принято" : "Нужно исправление",
            findings: review === "passed" ? [] : [finding()],
            strengths: ["Понятные имена"],
            evidenceBundle: null,
          }
        : null,
    },
  };
}

beforeEach(() => {
  apiMock.mockReset();
  pushMock.mockReset();
  searchState.value = "sessionId=session-v2";
  let operation = 0;
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: { randomUUID: vi.fn(() => `operation-${++operation}`) },
  });
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("restart-safe v2 practice", () => {
  it("keeps practice locked until the exercise unit is available", async () => {
    const locked = {
      ...exerciseState(),
      attempt: undefined,
      workspace: null,
      exerciseUnitProgress: {
        status: "locked",
        payload: {
          type: "exercise",
          attemptId: null,
          latestTestRunId: null,
          latestReviewId: null,
        },
      },
    };
    apiMock.mockResolvedValue(locked);
    renderWithQuery(<ExerciseClient />);

    expect(
      await screen.findByText("Текущий шаг ещё не практика"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Нормализуйте unknown без any"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Создать попытку" }),
    ).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Вернуться к занятию" }),
    );
    expect(pushMock).toHaveBeenCalledWith("/session?id=session-v2");
  });

  it("restores diff, latest passed test, and review after a full remount", async () => {
    const restored = exerciseState({ review: "changes_requested" });
    apiMock.mockResolvedValue(restored);

    const first = renderWithQuery(<ExerciseClient />);
    expect(
      await screen.findByText("+ current learner change"),
    ).toBeInTheDocument();
    expect(screen.getByText(/12 passed/u)).toBeInTheDocument();
    expect(screen.getByText("Нужно исправление")).toBeInTheDocument();
    first.unmount();

    renderWithQuery(<ExerciseClient />);
    expect(
      await screen.findByText("+ current learner change"),
    ).toBeInTheDocument();
    expect(screen.getByText("Нужно исправление")).toBeInTheDocument();
    expect(apiMock).toHaveBeenCalledTimes(2);
  });

  it("copies the server-owned workspace ID on demand", async () => {
    apiMock.mockResolvedValue(exerciseState());
    renderWithQuery(<ExerciseClient />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Скопировать ID" }),
    );

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("workspace-v2");
    expect(
      await screen.findByText("Идентификатор рабочей области скопирован."),
    ).toBeInTheDocument();
  });

  it("keeps review disabled when the latest test failed or predates the current files", async () => {
    apiMock.mockResolvedValue(exerciseState({ testStatus: "failed" }));
    const failed = renderWithQuery(<ExerciseClient />);
    expect(
      await screen.findByRole("button", { name: "Запросить проверку" }),
    ).toBeDisabled();
    expect(screen.getByText("Тесты не прошли")).toBeInTheDocument();
    failed.unmount();

    apiMock.mockResolvedValue(
      exerciseState({ testStatus: "passed", workspaceCurrent: false }),
    );
    renderWithQuery(<ExerciseClient />);
    expect(
      await screen.findByRole("button", { name: "Запросить проверку" }),
    ).toBeDisabled();
    expect(screen.getByText("Код изменён после теста")).toBeInTheDocument();
  });

  it("requires a new diff, passing test, and review after changes_requested", async () => {
    let diffReads = 0;
    let reviews = 0;
    apiMock.mockImplementation((requestPath: string) => {
      if (requestPath.includes("/exercises/current")) {
        return Promise.resolve(exerciseState());
      }
      if (requestPath.endsWith("/diff")) {
        diffReads += 1;
        const patch =
          diffReads === 1
            ? "+ current learner change"
            : "+ corrected learner change";
        return Promise.resolve({
          diff: patch,
          changed: true,
          truncated: false,
        });
      }
      if (requestPath.endsWith("/checks")) {
        return Promise.resolve({
          id: "test-v2",
          operationId: "operation-test-v2",
          status: "passed",
          exitCode: 0,
          output: "12 passed after correction",
          result: null,
        });
      }
      if (requestPath.endsWith("/reviews")) {
        reviews += 1;
        return Promise.resolve({
          id: `review-v${reviews}`,
          status: reviews === 1 ? "changes_requested" : "passed",
          summary:
            reviews === 1 ? "Исправьте empty case" : "Исправление принято",
          findings: reviews === 1 ? [finding()] : [],
          strengths: ["Чистая функция"],
          suggestedMasteryChanges: [],
          evidenceBundle: {
            id: `bundle-v${reviews}`,
            sha256: `sha256:${"a".repeat(64)}`,
            workspaceSnapshotHash: `sha256:${"b".repeat(64)}`,
          },
        });
      }
      throw new Error(`Unexpected API path: ${requestPath}`);
    });
    renderWithQuery(<ExerciseClient />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Запросить проверку" }),
    );
    expect(await screen.findByText("Исправьте empty case")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Принять проверку и продолжить" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Запросить проверку" }),
    ).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Запустить тесты" }));
    expect(
      await screen.findByText("+ corrected learner change"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Запросить проверку" }));
    expect(await screen.findByText("Исправление принято")).toBeInTheDocument();
    expect(reviews).toBe(2);
    expect(
      screen.getByRole("button", { name: "Принять проверку и продолжить" }),
    ).toBeEnabled();
  });

  it("completes exercise and review with only server-issued evidence IDs", async () => {
    const restored = exerciseState({ review: "passed" });
    const patches: Array<{ path: string; body: Record<string, unknown> }> = [];
    apiMock.mockImplementation((requestPath: string, init?: RequestInit) => {
      if (requestPath.includes("/exercises/current")) {
        return Promise.resolve(restored);
      }
      if (
        requestPath.includes("/learning/sessions/v2/") &&
        init?.method === "PATCH"
      ) {
        patches.push({
          path: requestPath,
          body: JSON.parse(String(init.body)) as Record<string, unknown>,
        });
        return Promise.resolve({ session: { id: "session-v2" } });
      }
      throw new Error(`Unexpected API path: ${requestPath}`);
    });
    renderWithQuery(<ExerciseClient />);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Принять проверку и продолжить",
      }),
    );

    await vi.waitFor(() =>
      expect(pushMock).toHaveBeenCalledWith("/session?id=session-v2"),
    );
    expect(patches).toHaveLength(3);
    expect(patches[0]).toMatchObject({
      path: "/learning/sessions/v2/session-v2/units/unit-exercise",
      body: {
        status: "completed",
        payload: {
          type: "exercise",
          attemptId: "attempt-v2",
          latestTestRunId: "test-v1",
          latestReviewId: null,
        },
      },
    });
    expect(patches[1]).toMatchObject({
      path: "/learning/sessions/v2/session-v2/units/unit-review",
      body: { status: "in_progress" },
    });
    expect(patches[2]).toMatchObject({
      path: "/learning/sessions/v2/session-v2/units/unit-review",
      body: {
        status: "completed",
        payload: {
          type: "review",
          reviewId: "review-v1",
          reviewStatus: "accepted",
          reviewedDiffHash: "review:review-v1:test:test-v1",
        },
      },
    });
  });

  it("resolves the server current session and rejects protected leaks before rendering", async () => {
    searchState.value = "";
    apiMock.mockImplementation((requestPath: string) => {
      if (requestPath === "/learning/sessions/current") {
        return Promise.resolve({ session: { id: "session-v2" } });
      }
      const leaked = exerciseState();
      Object.assign(leaked, { rawResponse: "secret provider payload" });
      return Promise.resolve(leaked);
    });
    renderWithQuery(<ExerciseClient />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Получено защищённое поле учебного материала",
    );
    expect(
      screen.queryByText("secret provider payload"),
    ).not.toBeInTheDocument();
    expect(apiMock).toHaveBeenCalledWith("/learning/sessions/current");
  });
});
