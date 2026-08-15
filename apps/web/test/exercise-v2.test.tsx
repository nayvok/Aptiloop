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
  const tree = (content: ReactNode) => (
    <QueryClientProvider client={client}>
      <LocaleProvider initialLocale="ru-RU" syncSettings={false}>
        {content}
      </LocaleProvider>
    </QueryClientProvider>
  );
  const view = render(tree(children));
  return {
    client,
    rerenderWithQuery: (content: ReactNode) => view.rerender(tree(content)),
    ...view,
  };
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
  reviewEvidence?: boolean;
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
            completionEligible: true,
            summary:
              review === "passed" ? "Решение принято" : "Нужно исправление",
            findings: review === "passed" ? [] : [finding()],
            strengths: ["Понятные имена"],
            evidenceBundle: options?.reviewEvidence
              ? {
                  id: "bundle-v1",
                  sha256: `sha256:${"a".repeat(64)}`,
                  workspaceSnapshotHash: `sha256:${"b".repeat(64)}`,
                }
              : null,
          }
        : null,
    },
  };
}

async function toggleEvidenceDisclosure() {
  const trigger = await screen.findByRole("button", {
    name: /Diff от baseline/u,
  });
  fireEvent.click(trigger, { detail: 0 });
  return trigger;
}

async function toggleReviewerDisclosure() {
  const trigger = await screen.findByRole("button", { name: /Reviewer/u });
  fireEvent.click(trigger, { detail: 0 });
  return trigger;
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
  it("keeps localized exercise orientation while loading and after failure", async () => {
    apiMock.mockReturnValueOnce(new Promise(() => undefined));
    const loading = renderWithQuery(<ExerciseClient />);
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Практическое задание",
      }),
    ).toBeVisible();
    expect(screen.getByText("Загружаю практику…")).toBeVisible();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    loading.unmount();

    apiMock.mockRejectedValueOnce(new Error("raw exercise endpoint failure"));
    renderWithQuery(<ExerciseClient />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Не удалось загрузить это упражнение.",
    );
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Практическое задание",
      }),
    ).toBeVisible();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(
      screen.queryByText("raw exercise endpoint failure"),
    ).not.toBeInTheDocument();
  });

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
    await toggleEvidenceDisclosure();
    expect(
      await screen.findByText("+ current learner change"),
    ).toBeInTheDocument();
    expect(screen.getByText(/12 passed/u)).toBeInTheDocument();
    await toggleReviewerDisclosure();
    expect(screen.getByText("Нужно исправление")).toBeInTheDocument();
    first.unmount();

    renderWithQuery(<ExerciseClient />);
    await toggleEvidenceDisclosure();
    expect(
      await screen.findByText("+ current learner change"),
    ).toBeInTheDocument();
    await toggleReviewerDisclosure();
    expect(screen.getByText("Нужно исправление")).toBeInTheDocument();
    expect(apiMock).toHaveBeenCalledTimes(2);
  });

  it("does not carry local evidence across session query identities", async () => {
    const sessionA = exerciseState({ diff: "+ server session A change" });
    const sessionB = {
      ...exerciseState({ diff: "+ server session B change" }),
      sessionId: "session-b",
      title: "Session B exercise",
    };
    apiMock.mockImplementation((requestPath: string, _init?: RequestInit) => {
      if (requestPath === "/exercises/current?sessionId=session-v2") {
        return Promise.resolve(sessionA);
      }
      if (requestPath === "/exercise-attempts/attempt-v2/diff") {
        return Promise.resolve({
          diff: "+ local session A change",
          changed: true,
          truncated: false,
        });
      }
      if (requestPath === "/exercises/current?sessionId=session-b") {
        return Promise.resolve(sessionB);
      }
      throw new Error(`Unexpected API path: ${requestPath}`);
    });
    const view = renderWithQuery(<ExerciseClient />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Обновить Git diff" }),
    );
    await toggleEvidenceDisclosure();
    expect(await screen.findByText("+ local session A change")).toBeVisible();

    view.client.setQueryData(["exercise", "session-b"], sessionB);
    searchState.value = "sessionId=session-b";
    view.rerenderWithQuery(<ExerciseClient />);

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: sessionB.title,
      }),
    ).toBeVisible();
    const evidenceTrigger = await screen.findByRole("button", {
      name: /Diff от baseline/u,
    });
    if (evidenceTrigger.getAttribute("aria-expanded") !== "true") {
      fireEvent.click(evidenceTrigger, { detail: 0 });
    }
    expect(await screen.findByText("+ server session B change")).toBeVisible();
    expect(
      screen.queryByText("+ local session A change"),
    ).not.toBeInTheDocument();
  });

  it("does not let an aborted old-owner check clear or notify the new exercise", async () => {
    const sessionA = exerciseState();
    const sessionB = {
      ...exerciseState(),
      sessionId: "session-b",
      title: "Session B exercise",
    };
    let resolveOldCheck!: (value: unknown) => void;
    let oldSignal: AbortSignal | null = null;
    apiMock.mockImplementation((requestPath: string, init?: RequestInit) => {
      if (requestPath === "/exercises/current?sessionId=session-v2") {
        return Promise.resolve(sessionA);
      }
      if (requestPath === "/exercises/current?sessionId=session-b") {
        return Promise.resolve(sessionB);
      }
      if (requestPath.endsWith("/checks")) {
        oldSignal = init?.signal ?? null;
        return new Promise((resolve) => {
          resolveOldCheck = resolve;
        });
      }
      throw new Error(`Unexpected API path: ${requestPath}`);
    });
    const view = renderWithQuery(<ExerciseClient />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Запустить тесты" }),
    );
    await vi.waitFor(() => expect(oldSignal).not.toBeNull());

    view.client.setQueryData(["exercise", "session-b"], sessionB);
    searchState.value = "sessionId=session-b";
    view.rerenderWithQuery(<ExerciseClient />);
    expect(
      await screen.findByRole("heading", { level: 1, name: sessionB.title }),
    ).toBeVisible();
    expect(oldSignal).not.toBeNull();
    await vi.waitFor(() =>
      expect((oldSignal as unknown as AbortSignal).aborted).toBe(true),
    );
    resolveOldCheck({
      id: "late-old-test",
      operationId: "late-old-operation",
      status: "passed",
      exitCode: 0,
      output: "old owner late pass",
      result: null,
    });

    await vi.waitFor(() =>
      expect(screen.queryByText("old owner late pass")).not.toBeInTheDocument(),
    );
    expect(
      screen.queryByText("Остановлено. Результат этой операции не применён."),
    ).not.toBeInTheDocument();
  });

  it("cancels an old-owner pending review disclosure on navigation", async () => {
    const sessionA = exerciseState();
    const sessionB = {
      ...exerciseState(),
      sessionId: "session-b",
      title: "Session B exercise",
    };
    apiMock.mockImplementation((requestPath: string) => {
      if (requestPath === "/exercises/current?sessionId=session-v2") {
        return Promise.resolve(sessionA);
      }
      if (requestPath === "/exercises/current?sessionId=session-b") {
        return Promise.resolve(sessionB);
      }
      if (requestPath.endsWith("/diff")) {
        return Promise.resolve({
          diff: "+ current learner change",
          changed: true,
          truncated: false,
        });
      }
      if (requestPath.endsWith("/reviews")) {
        return Promise.resolve({
          kind: "disclosure",
          required: true,
          disclosure: {
            operationId: "review-disclosure-old-owner",
            status: "pending",
            scope: {
              destination: "Mock provider",
              payloadCategories: ["workspace-diff"],
              byteCount: 128,
              exclusions: ["protected answers"],
            },
          },
        });
      }
      if (requestPath === "/ai/disclosures/review-disclosure-old-owner") {
        return Promise.resolve({ cancelled: true });
      }
      throw new Error(`Unexpected API path: ${requestPath}`);
    });
    const view = renderWithQuery(<ExerciseClient />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Запросить проверку" }),
    );
    expect(await screen.findByRole("alertdialog")).toBeVisible();

    view.client.setQueryData(["exercise", "session-b"], sessionB);
    searchState.value = "sessionId=session-b";
    view.rerenderWithQuery(<ExerciseClient />);
    expect(
      await screen.findByRole("heading", { level: 1, name: sessionB.title }),
    ).toBeVisible();
    await vi.waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(
        "/ai/disclosures/review-disclosure-old-owner",
        { method: "DELETE" },
      ),
    );
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("keeps technical evidence and reviewer details collapsed until keyboard activation", async () => {
    const restored = exerciseState({
      review: "passed",
      reviewEvidence: true,
    });
    apiMock.mockResolvedValue(restored);
    renderWithQuery(<ExerciseClient />);

    const evidenceTrigger = await screen.findByRole("button", {
      name: /Diff от baseline/u,
    });
    expect(evidenceTrigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("exercise-diff")).not.toBeInTheDocument();
    evidenceTrigger.focus();
    expect(evidenceTrigger).toHaveFocus();
    fireEvent.click(evidenceTrigger, { detail: 0 });
    expect(evidenceTrigger).toHaveAttribute("aria-expanded", "true");
    expect(await screen.findByTestId("exercise-diff")).toHaveTextContent(
      "+ current learner change",
    );

    const reviewerTrigger = screen.getByRole("button", { name: /Reviewer/u });
    expect(reviewerTrigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Решение принято")).not.toBeInTheDocument();
    expect(
      screen.queryByText(`sha256:${"a".repeat(64)}`),
    ).not.toBeInTheDocument();
    reviewerTrigger.focus();
    expect(reviewerTrigger).toHaveFocus();
    fireEvent.click(reviewerTrigger, { detail: 0 });
    expect(reviewerTrigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Решение принято")).toBeInTheDocument();
    expect(screen.getByText(`sha256:${"a".repeat(64)}`)).toBeInTheDocument();
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

  it("keeps one primary action while evidence advances through review and acceptance", async () => {
    apiMock.mockResolvedValue(exerciseState());
    const reviewStage = renderWithQuery(<ExerciseClient />);

    const requestReview = await screen.findByRole("button", {
      name: "Запросить проверку",
    });
    expect(requestReview).toHaveAttribute("aria-current", "step");
    expect(requestReview).toHaveAttribute("data-variant", "default");
    expect(
      screen.getByRole("button", { name: "Обновить Git diff" }),
    ).toHaveAttribute("data-variant", "ghost");
    expect(
      screen.getByRole("button", { name: "Запустить тесты" }),
    ).toHaveAttribute("data-variant", "ghost");
    expect(
      reviewStage.container.querySelectorAll('button[data-variant="default"]'),
    ).toHaveLength(1);

    const focusSurface = reviewStage.container.querySelector(
      '[data-slot="exercise-focus-surface"]',
    );
    expect(focusSurface).toContainElement(
      reviewStage.container.querySelector('[data-slot="exercise-workspace"]'),
    );
    expect(focusSurface).toContainElement(
      reviewStage.container.querySelector('[data-slot="exercise-evidence"]'),
    );
    expect(focusSurface).not.toContainElement(
      reviewStage.container.querySelector('[data-slot="exercise-review"]'),
    );
    reviewStage.unmount();

    apiMock.mockResolvedValue(exerciseState({ review: "changes_requested" }));
    const correctionStage = renderWithQuery(<ExerciseClient />);
    const acceptAdvisoryReview = await screen.findByRole("button", {
      name: "Продолжить",
    });
    expect(
      screen.getByText("Совет Reviewer: нужны изменения"),
    ).toBeInTheDocument();
    await toggleReviewerDisclosure();
    expect(
      screen.getByText(
        "Квитанция доказательств проверена. Можно продолжить независимо от рекомендательного вердикта.",
      ),
    ).toBeInTheDocument();
    expect(acceptAdvisoryReview).toHaveAttribute("aria-current", "step");
    expect(acceptAdvisoryReview).toHaveAttribute("data-variant", "default");
    expect(
      screen.getByRole("button", { name: "Запросить проверку" }),
    ).toHaveAttribute("data-variant", "ghost");
    expect(
      correctionStage.container.querySelectorAll(
        'button[data-variant="default"]',
      ),
    ).toHaveLength(1);
    correctionStage.unmount();

    apiMock.mockResolvedValue(exerciseState({ review: "passed" }));
    const acceptanceStage = renderWithQuery(<ExerciseClient />);
    const accept = await screen.findByRole("button", {
      name: "Продолжить",
    });
    expect(screen.getByText("Совет Reviewer: пройдено")).toBeInTheDocument();
    await toggleReviewerDisclosure();
    expect(
      screen.getByText(
        "Квитанция доказательств проверена. Можно продолжить независимо от рекомендательного вердикта.",
      ),
    ).toBeInTheDocument();
    expect(accept).toHaveAttribute("aria-current", "step");
    expect(accept).toHaveAttribute("data-variant", "default");
    expect(
      acceptanceStage.container.querySelector(
        '[data-slot="exercise-action-sequence"]',
      ),
    ).toContainElement(accept);
    expect(
      acceptanceStage.container.querySelectorAll(
        'button[data-variant="default"]',
      ),
    ).toHaveLength(1);
  });

  it("keeps changes_requested advisory while deterministic receipt permits completion", async () => {
    let diffReads = 0;
    let reviews = 0;
    apiMock.mockImplementation((requestPath: string, init?: RequestInit) => {
      if (requestPath.includes("/exercises/current")) {
        return Promise.resolve(
          reviews === 0
            ? exerciseState()
            : exerciseState({ review: "changes_requested" }),
        );
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
          completionEligible: true,
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
      if (
        requestPath.includes("/learning/sessions/v2/") &&
        init?.method === "PATCH"
      ) {
        return Promise.resolve({ session: { id: "session-v2" } });
      }
      throw new Error(`Unexpected API path: ${requestPath}`);
    });
    renderWithQuery(<ExerciseClient />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Запросить проверку" }),
    );
    expect(
      await screen.findByText("Совет Reviewer: нужны изменения"),
    ).toBeInTheDocument();
    await toggleReviewerDisclosure();
    expect(await screen.findByText("Исправьте empty case")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Продолжить" })).toBeEnabled();

    expect(screen.getByRole("button", { name: "Продолжить" })).toHaveAttribute(
      "aria-current",
      "step",
    );
    expect(reviews).toBe(1);
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
        name: "Продолжить",
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

  it("stops trusted checks and ignores a late result", async () => {
    let resolveCheck!: (value: unknown) => void;
    let checkSignal: AbortSignal | null = null;
    apiMock.mockImplementation((requestPath: string, init?: RequestInit) => {
      if (requestPath.includes("/exercises/current")) {
        return Promise.resolve(
          exerciseState({ testStatus: "failed", review: null }),
        );
      }
      if (requestPath.endsWith("/checks")) {
        checkSignal = init?.signal ?? null;
        return new Promise((resolve) => {
          resolveCheck = resolve;
        });
      }
      throw new Error(`Unexpected API path: ${requestPath}`);
    });
    renderWithQuery(<ExerciseClient />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Запустить тесты" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Остановить тесты" }),
    );

    expect(checkSignal).not.toBeNull();
    expect((checkSignal as unknown as AbortSignal).aborted).toBe(true);
    resolveCheck({
      id: "late-test",
      operationId: "late-operation",
      status: "passed",
      exitCode: 0,
      output: "late pass",
      result: null,
    });
    expect(
      await screen.findByText(
        "Остановлено. Результат этой операции не применён.",
      ),
    ).toBeVisible();
    expect(screen.queryByText("late pass")).not.toBeInTheDocument();
  });

  it("stops a reviewer request and keeps late output non-authoritative", async () => {
    let resolveReview!: (value: unknown) => void;
    let reviewSignal: AbortSignal | null = null;
    apiMock.mockImplementation((requestPath: string, init?: RequestInit) => {
      if (requestPath.includes("/exercises/current")) {
        return Promise.resolve(exerciseState());
      }
      if (requestPath.endsWith("/diff")) {
        return Promise.resolve({
          diff: "+ current learner change",
          changed: true,
          truncated: false,
        });
      }
      if (requestPath.endsWith("/reviews")) {
        reviewSignal = init?.signal ?? null;
        return new Promise((resolve) => {
          resolveReview = resolve;
        });
      }
      throw new Error(`Unexpected API path: ${requestPath}`);
    });
    renderWithQuery(<ExerciseClient />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Запросить проверку" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Остановить проверку" }),
    );

    expect(reviewSignal).not.toBeNull();
    expect((reviewSignal as unknown as AbortSignal).aborted).toBe(true);
    resolveReview({
      id: "late-review",
      status: "passed",
      completionEligible: true,
      summary: "late reviewer output",
      findings: [],
      strengths: ["late"],
      suggestedMasteryChanges: [],
      evidenceBundle: {
        id: "late-bundle",
        sha256: `sha256:${"a".repeat(64)}`,
        workspaceSnapshotHash: `sha256:${"b".repeat(64)}`,
      },
    });
    expect(
      await screen.findByText(
        "Остановлено. Результат этой операции не применён.",
      ),
    ).toBeVisible();
    expect(screen.queryByText("late reviewer output")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Продолжить" }),
    ).not.toBeInTheDocument();
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
