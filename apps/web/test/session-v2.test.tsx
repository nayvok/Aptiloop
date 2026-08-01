import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SessionClient } from "@/components/session-client";

const { apiMock, pushMock, searchState, streamAgentMock } = vi.hoisted(() => ({
  apiMock: vi.fn(),
  pushMock: vi.fn(),
  searchState: { value: "id=session-v2" },
  streamAgentMock: vi.fn(async function* () {
    yield { type: "message.delta", content: "Уточняющий вопрос Teacher" };
  }),
}));

vi.mock("@/lib/api", () => ({
  api: apiMock,
  streamAgent: streamAgentMock,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () => new URLSearchParams(searchState.value),
}));

const now = "2026-08-01T00:00:00.000Z";
type UnitType =
  | "briefing"
  | "study"
  | "recall"
  | "teacher-dialogue"
  | "quiz"
  | "code-reading"
  | "exercise"
  | "review"
  | "interview"
  | "summary"
  | "checkpoint"
  | "spaced-review";
type UnitStatus = "locked" | "ready" | "in_progress" | "completed" | "skipped";

type ProgressPayloadFixture =
  | { type: "briefing"; acknowledged: boolean; checkedItemIds: string[] }
  | { type: "study"; checkedItemIds: string[]; notes: string }
  | { type: "recall"; draft: string; firstAttemptId: string | null }
  | {
      type: "teacher-dialogue";
      conversationId: string | null;
      turnCount: number;
      revisionAttemptIds: string[];
    }
  | {
      type: "quiz";
      attemptedQuestionIds: string[];
      correctQuestionIds: string[];
      score: number | null;
    }
  | {
      type: "code-reading";
      prediction: string;
      explanation: string;
      verbalFix: string;
    }
  | {
      type: "exercise";
      attemptId: string | null;
      latestTestRunId: string | null;
      latestReviewId: string | null;
    }
  | {
      type: "review";
      reviewId: string | null;
      reviewStatus: "pending" | "accepted" | "changes_requested" | null;
      reviewedDiffHash: string | null;
    }
  | {
      type: "interview";
      interviewSessionId: string | null;
      reportId: string | null;
    }
  | { type: "summary"; summaryId: string | null }
  | { type: "checkpoint"; acknowledged: boolean }
  | { type: "spaced-review"; reviewedTopicIds: string[] };

function unitPayload(type: UnitType) {
  switch (type) {
    case "briefing":
      return { type, scope: ["Без оптимизаций движка"] };
    case "study":
      return { type, body: "Прочитайте источник и повторите пример." };
    case "recall":
      return { type, prompt: "Объясните механизм по памяти." };
    case "teacher-dialogue":
      return {
        type,
        openingPrompt: "Найдите слабое место исходного объяснения.",
        minimumTurns: 1,
        requiresRevision: true,
      };
    case "quiz":
      return {
        type,
        questionIds: ["quiz-q1", "quiz-q2"],
        minimumScore: 0.5,
      };
    case "code-reading":
      return {
        type,
        snippet: "const next = { ...original };",
      };
    case "exercise":
      return {
        type,
        exerciseId: "exercise-1",
        acceptanceCriteria: ["Не мутировать input"],
        constraints: ["Без any"],
        template: "export function solve() {}",
        testCommandId: "test:exercise-1",
        hintPolicy: "progressive-0-to-5",
        reviewPolicy: "diff-and-tests-read-only",
      };
    case "review":
      return { type, exerciseUnitId: "exercise-unit" };
    case "interview":
      return { type, topics: ["scope"] };
    case "summary":
      return { type, prompts: ["Что изменилось в модели?"] };
    case "checkpoint":
      return { type, label: "Подтвердите checkpoint" };
    case "spaced-review":
      return { type, topicIds: ["scope"] };
  }
}

function progressPayload(type: UnitType): ProgressPayloadFixture {
  switch (type) {
    case "briefing":
      return { type, acknowledged: false, checkedItemIds: [] };
    case "study":
      return { type, checkedItemIds: [], notes: "" };
    case "recall":
      return { type, draft: "", firstAttemptId: null };
    case "teacher-dialogue":
      return {
        type,
        conversationId: null,
        turnCount: 0,
        revisionAttemptIds: [],
      };
    case "quiz":
      return {
        type,
        attemptedQuestionIds: [],
        correctQuestionIds: [],
        score: null,
      };
    case "code-reading":
      return { type, prediction: "", explanation: "", verbalFix: "" };
    case "exercise":
      return {
        type,
        attemptId: null,
        latestTestRunId: null,
        latestReviewId: null,
      };
    case "review":
      return {
        type,
        reviewId: null,
        reviewStatus: null,
        reviewedDiffHash: null,
      };
    case "interview":
      return { type, interviewSessionId: null, reportId: null };
    case "summary":
      return { type, summaryId: null };
    case "checkpoint":
      return { type, acknowledged: false };
    case "spaced-review":
      return { type, reviewedTopicIds: [] };
  }
}

function questions(type: UnitType) {
  if (type === "quiz") {
    return [
      {
        id: "quiz-q1",
        kind: "multiple-choice",
        prompt: "Что является примитивом?",
        options: [
          { id: "q1-a", label: "string" },
          { id: "q1-b", label: "object" },
        ],
      },
      {
        id: "quiz-q2",
        kind: "multiple-choice",
        prompt: "Что делает spread объекта?",
        options: [
          { id: "q2-a", label: "Shallow copy" },
          { id: "q2-b", label: "Deep copy" },
        ],
      },
    ];
  }
  if (type === "recall") {
    return [
      {
        id: "recall-q1",
        kind: "explain",
        prompt: "Чем binding отличается от значения?",
        options: [],
      },
    ];
  }
  if (type === "code-reading") {
    return [
      {
        id: "code-q1",
        kind: "predict-output",
        prompt: "Что изменится в original и почему?",
        options: [],
      },
    ];
  }
  return [];
}

function makeUnit(type: UnitType) {
  return {
    id: `unit-${type}`,
    stableId: `day-1-${type}`,
    type,
    title: `Юнит ${type}`,
    description: `Описание ${type}`,
    order: 1,
    estimatedMinutes: 10,
    objectives: ["Объяснить механизм"],
    checklist:
      type === "briefing" || type === "study"
        ? [
            {
              id: `${type}-required`,
              label: "Обязательный пункт",
              required: true,
            },
            {
              id: `${type}-optional`,
              label: "Дополнительный пункт",
              required: false,
            },
          ]
        : [],
    sources:
      type === "study"
        ? [
            {
              id: "source-mdn",
              title: "MDN: JavaScript data types",
              url: "https://developer.mozilla.org/docs/Web/JavaScript/Data_structures",
              kind: "documentation",
              required: true,
              estimatedMinutes: 12,
              learningGoal: "Разделить binding и value",
            },
          ]
        : [],
    questions: questions(type),
    completionCriteria:
      type === "briefing"
        ? [
            { type: "acknowledgement" },
            { type: "checklist", requiredItemIds: [`${type}-required`] },
          ]
        : type === "study"
          ? [{ type: "checklist", requiredItemIds: [`${type}-required`] }]
          : type === "quiz"
            ? [{ type: "score", minimum: 0.5, minimumAttempts: 2 }]
            : [{ type: "attempts", minimum: 1 }],
    unlockRules: [],
    optional: false,
    depthLevel: "foundation",
    payload: unitPayload(type),
  };
}

function makeSession(
  type: UnitType,
  status: UnitStatus = "in_progress",
  payload: ProgressPayloadFixture = progressPayload(type),
) {
  return {
    id: "session-v2",
    status: status === "completed" ? "completed" : "active",
    currentStep: status === "completed" ? "complete" : `day-1-${type}`,
    snapshot: {
      schemaVersion: 2,
      contentHash: "sha256-session",
      curriculumId: "curriculum-1",
      curriculumVersionId: "curriculum-version-2",
      curriculumRevision: 2,
      curriculumTitle: "JavaScript foundations",
      week: {
        id: "week-id",
        stableId: "week-1",
        order: 1,
        title: "Фундамент языка",
        description: "Первая неделя",
      },
      day: {
        id: "day-id",
        stableId: "day-1",
        order: 1,
        title: "Значения, типы и объекты",
        description: "Описание дня",
        goal: "Построить точную причинную модель",
        estimatedMinutes: 180,
        prerequisites: [],
        expectedOutcomes: ["Объяснить механизм"],
        depthLevel: "foundation",
        outOfScope: ["Оптимизация движка"],
        topics: ["JavaScript"],
      },
      units: [makeUnit(type)],
      capturedAt: now,
    },
    unitProgress: [
      {
        unitId: `unit-${type}`,
        unitType: type,
        status,
        payload,
        startedAt: status === "ready" ? null : now,
        completedAt: status === "completed" ? now : null,
        skippedAt: null,
        updatedAt: now,
      },
    ],
  };
}

type SessionFixture = ReturnType<typeof makeSession>;

function replaceProgress(
  session: SessionFixture,
  status: UnitStatus,
  payload: ProgressPayloadFixture,
): SessionFixture {
  const currentProgress = session.unitProgress[0];
  if (!currentProgress) throw new Error("Fixture progress is missing");
  return {
    ...session,
    status: status === "completed" ? "completed" : "active",
    currentStep: status === "completed" ? "complete" : session.currentStep,
    unitProgress: [
      {
        ...currentProgress,
        status,
        payload,
        startedAt: status === "ready" ? null : now,
        completedAt: status === "completed" ? now : null,
      },
    ],
  };
}

function makeSummaryResponse(
  session: SessionFixture,
  evidenceId = "summary-1",
) {
  return {
    summary: {
      sessionId: session.id,
      occurredAt: now,
      masteryEvidence: [],
      strengths: ["Тесты и read-only review пройдены"],
      gaps: ["Точнее объяснять shallow copy"],
      mistakeCandidates: [
        {
          fingerprint: "mistake-shallow-copy",
          summary: "Смешаны shallow и deep copy",
          correction: "Spread копирует только верхний уровень",
          sourceId: "quiz-q2",
        },
      ],
      flashcardCandidates: [
        {
          front: "Что копирует object spread?",
          back: "Только верхний уровень объекта.",
          sourceFingerprint: "mistake-shallow-copy",
        },
      ],
      narrative: "День завершён на основе сохранённого evidence.",
      metrics: {
        topicCount: 1,
        evidenceCount: 6,
        correctEvidenceCount: 3,
        partialEvidenceCount: 2,
        incorrectEvidenceCount: 1,
        attemptedActivityCount: 5,
        quizScore: 0.5,
        maxHintLevel: 2,
        exerciseTestsPassed: true,
        reviewStatus: "passed",
        correctionCycleCount: 1,
      },
    },
    evidence: { id: evidenceId },
    session,
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
  streamAgentMock.mockClear();
  searchState.value = "id=session-v2";
  let id = 0;
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: { randomUUID: vi.fn(() => `operation-${++id}`) },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("guided versioned session", () => {
  it("resolves the current session when the URL has no id and shows Path when it is null", async () => {
    searchState.value = "";
    apiMock.mockResolvedValue({ session: null });
    renderWithQuery(<SessionClient />);

    expect(
      await screen.findByText("Активного занятия нет"),
    ).toBeInTheDocument();
    expect(apiMock).toHaveBeenCalledWith("/learning/sessions/current");
    fireEvent.click(screen.getByRole("button", { name: "Открыть Path" }));
    expect(pushMock).toHaveBeenCalledWith("/");
  });

  it("starts a ready unit and completes briefing only after acknowledgement and required checklist", async () => {
    const ready = makeSession("briefing", "ready");
    const active = replaceProgress(
      ready,
      "in_progress",
      progressPayload("briefing"),
    );
    const completePayload = {
      type: "briefing" as const,
      acknowledged: true,
      checkedItemIds: ["briefing-required"],
    };
    const completed = replaceProgress(active, "completed", completePayload);
    apiMock
      .mockResolvedValueOnce({ session: ready })
      .mockResolvedValueOnce({ session: active })
      .mockResolvedValueOnce({ session: completed });
    renderWithQuery(<SessionClient />);

    fireEvent.click(await screen.findByRole("button", { name: "Начать юнит" }));
    expect(
      await screen.findByLabelText("Цель и границы дня понятны"),
    ).toBeEnabled();
    const finish = screen.getByRole("button", { name: /Завершить briefing/u });
    expect(finish).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/Обязательный пункт/u));
    fireEvent.click(screen.getByLabelText("Цель и границы дня понятны"));
    expect(finish).toBeEnabled();
    fireEvent.click(finish);

    await vi.waitFor(() => {
      expect(apiMock).toHaveBeenLastCalledWith(
        "/learning/sessions/v2/session-v2/units/unit-briefing",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({
            status: "completed",
            payload: completePayload,
            operationId: "operation-2",
          }),
        }),
      );
    });
    expect(
      await screen.findByText("Юнит завершён и сохранён"),
    ).toBeInTheDocument();
  });

  it("persists study notes with same-status PATCH and gates completion on required checklist", async () => {
    const session = makeSession("study");
    const savedPayload = {
      type: "study" as const,
      checkedItemIds: ["study-required"],
      notes: "Binding хранит связь с value",
    };
    const saved = replaceProgress(session, "in_progress", savedPayload);
    apiMock
      .mockResolvedValueOnce({ session })
      .mockResolvedValueOnce({ session: saved });
    renderWithQuery(<SessionClient />);

    const complete = await screen.findByRole("button", {
      name: /Завершить study/u,
    });
    expect(complete).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/Обязательный пункт/u));
    fireEvent.change(screen.getByLabelText("Заметки"), {
      target: { value: savedPayload.notes },
    });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить заметки" }));

    await vi.waitFor(() => {
      expect(apiMock).toHaveBeenLastCalledWith(
        "/learning/sessions/v2/session-v2/units/unit-study",
        expect.objectContaining({
          body: JSON.stringify({
            status: "in_progress",
            payload: savedPayload,
            operationId: "operation-1",
          }),
        }),
      );
    });
  });

  it("submits recall evidence to the dedicated endpoint and preserves the returned first attempt", async () => {
    const session = makeSession("recall");
    const savedPayload = {
      type: "recall" as const,
      draft: "Binding — это имя, связанное со значением, а не само значение.",
      firstAttemptId: "recall-evidence-1",
    };
    const saved = replaceProgress(session, "in_progress", savedPayload);
    apiMock.mockResolvedValueOnce({ session }).mockResolvedValueOnce({
      evidence: {
        id: "recall-evidence-1",
        operationId: "operation-1",
        questionId: "recall-q1",
        payload: { answer: savedPayload.draft },
        correctness: null,
        createdAt: now,
      },
      session: saved,
    });
    renderWithQuery(<SessionClient />);

    fireEvent.change(await screen.findByLabelText("Объяснение по памяти"), {
      target: { value: savedPayload.draft },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Сохранить первую попытку" }),
    );

    await vi.waitFor(() => {
      expect(apiMock).toHaveBeenLastCalledWith(
        "/learning/sessions/v2/session-v2/units/unit-recall/recall-attempts",
        expect.objectContaining({
          body: JSON.stringify({
            operationId: "operation-1",
            answer: savedPayload.draft,
          }),
        }),
      );
    });
    expect(
      await screen.findByRole("button", { name: /Завершить recall/u }),
    ).toBeEnabled();
    expect(screen.getByLabelText("Объяснение по памяти")).toBeDisabled();
  });

  it("restores Teacher history by session and persists a learner revision after the real stream", async () => {
    const session = makeSession("teacher-dialogue");
    const revisedPayload = {
      type: "teacher-dialogue" as const,
      conversationId: null,
      turnCount: 1,
      revisionAttemptIds: ["operation-1"],
    };
    const revised = replaceProgress(session, "in_progress", revisedPayload);
    apiMock.mockImplementation((path: string) => {
      if (path === "/learning/sessions/v2/session-v2") {
        return Promise.resolve({ session });
      }
      if (path === "/agent/history?role=teacher&sessionId=session-v2") {
        return Promise.resolve({
          messages: [
            {
              id: "history-1",
              role: "assistant",
              content: "Что значит общая ссылка?",
            },
          ],
        });
      }
      if (
        path === "/learning/sessions/v2/session-v2/units/unit-teacher-dialogue"
      ) {
        return Promise.resolve({ session: revised });
      }
      throw new Error(`Unexpected API path: ${path}`);
    });
    renderWithQuery(<SessionClient />);

    expect(
      await screen.findByText("Что значит общая ссылка?"),
    ).toBeInTheDocument();
    const revision =
      "Общая ссылка означает, что оба binding указывают на один объект.";
    fireEvent.change(screen.getByLabelText("Уточнённое объяснение"), {
      target: { value: revision },
    });
    fireEvent.click(screen.getByRole("button", { name: "Отправить revision" }));

    await vi.waitFor(() => expect(streamAgentMock).toHaveBeenCalledTimes(1));
    expect(streamAgentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "teacher",
        sessionId: "session-v2",
        message: expect.stringContaining(revision),
      }),
      expect.any(AbortSignal),
    );
    await vi.waitFor(() => {
      expect(apiMock).toHaveBeenCalledWith(
        "/learning/sessions/v2/session-v2/units/unit-teacher-dialogue",
        expect.objectContaining({
          body: JSON.stringify({
            status: "in_progress",
            payload: revisedPayload,
            operationId: "operation-3",
          }),
        }),
      );
    });
    expect(
      await screen.findByRole("button", { name: /Завершить диалог/u }),
    ).toBeEnabled();
  });

  it("renders every public quiz option and trusts the server score without exposing an answer key", async () => {
    const session = makeSession("quiz");
    const scoredPayload = {
      type: "quiz" as const,
      attemptedQuestionIds: ["quiz-q1", "quiz-q2"],
      correctQuestionIds: ["quiz-q1"],
      score: 0.5,
    };
    const scored = replaceProgress(session, "in_progress", scoredPayload);
    apiMock.mockResolvedValueOnce({ session }).mockResolvedValueOnce({
      attempt: {
        operationId: "operation-1",
        score: 0.5,
        results: [
          { questionId: "quiz-q1", correct: true },
          { questionId: "quiz-q2", correct: false },
        ],
      },
      session: scored,
    });
    const { container } = renderWithQuery(<SessionClient />);

    expect(await screen.findByLabelText("string")).toBeInTheDocument();
    expect(screen.getByLabelText("object")).toBeInTheDocument();
    expect(screen.getByLabelText("Shallow copy")).toBeInTheDocument();
    expect(screen.getByLabelText("Deep copy")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("string"));
    fireEvent.click(screen.getByLabelText("Deep copy"));
    fireEvent.click(screen.getByRole("button", { name: "Проверить ответы" }));

    expect(
      await screen.findByText("Серверная оценка: 50%. Порог: 50%."),
    ).toBeInTheDocument();
    expect(screen.getByText("Верно")).toBeInTheDocument();
    expect(screen.getByText("Нужно повторить")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(
      /correctOptionIds|referenceAnswer/u,
    );
    expect(apiMock).toHaveBeenLastCalledWith(
      "/learning/sessions/v2/session-v2/units/unit-quiz/quiz-attempts",
      expect.objectContaining({
        body: JSON.stringify({
          operationId: "operation-1",
          answers: [
            { questionId: "quiz-q1", selectedOptionId: "q1-a" },
            { questionId: "quiz-q2", selectedOptionId: "q2-b" },
          ],
        }),
      }),
    );
  });

  it("persists all three code-reading fields through its evidence endpoint", async () => {
    const session = makeSession("code-reading");
    const savedPayload = {
      type: "code-reading" as const,
      prediction: "original изменится",
      explanation: "spread копирует только внешний объект",
      verbalFix: "скопировать вложенный profile",
    };
    const saved = replaceProgress(session, "in_progress", savedPayload);
    apiMock.mockResolvedValueOnce({ session }).mockResolvedValueOnce({
      evidence: {
        id: "code-evidence-1",
        operationId: "operation-1",
        payload: savedPayload,
        createdAt: now,
      },
      session: saved,
    });
    renderWithQuery(<SessionClient />);

    fireEvent.change(await screen.findByLabelText("Предсказание"), {
      target: { value: savedPayload.prediction },
    });
    fireEvent.change(screen.getByLabelText("Объяснение механизма"), {
      target: { value: savedPayload.explanation },
    });
    fireEvent.change(screen.getByLabelText("Исправление словами"), {
      target: { value: savedPayload.verbalFix },
    });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить разбор" }));

    await vi.waitFor(() => {
      expect(apiMock).toHaveBeenLastCalledWith(
        "/learning/sessions/v2/session-v2/units/unit-code-reading/code-reading-attempts",
        expect.objectContaining({
          body: JSON.stringify({
            operationId: "operation-1",
            ...savedPayload,
            type: undefined,
          }),
        }),
      );
    });
  });

  it("rejects protected fields recursively before rendering leaked content", async () => {
    const leaked = makeSession("briefing");
    Object.assign(leaked.snapshot.units[0]?.payload ?? {}, {
      nested: { protectedEvaluation: "server-only rubric" },
    });
    apiMock.mockResolvedValue({ session: leaked });
    renderWithQuery(<SessionClient />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Protected curriculum field received",
    );
    expect(screen.queryByText("server-only rubric")).not.toBeInTheDocument();
  });

  it("hands exercise and review units off to Practice with the session entity id", async () => {
    apiMock.mockResolvedValue({ session: makeSession("exercise") });
    renderWithQuery(<SessionClient />);

    const shell = await screen.findByText("Acceptance criteria");
    expect(
      within(shell.parentElement!).getByText("Не мутировать input"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Открыть практику" }));
    expect(pushMock).toHaveBeenCalledWith("/exercise?sessionId=session-v2");
  });

  it("creates the server-derived summary and completes the day with its persisted evidence id", async () => {
    const initial = makeSession("summary");
    const summarized = replaceProgress(initial, "in_progress", {
      type: "summary",
      summaryId: "summary-1",
    });
    const completed = replaceProgress(summarized, "completed", {
      type: "summary",
      summaryId: "summary-1",
    });
    apiMock
      .mockResolvedValueOnce({ session: initial })
      .mockResolvedValueOnce(makeSummaryResponse(summarized))
      .mockResolvedValueOnce({ session: completed });
    renderWithQuery(<SessionClient />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Сформировать итог" }),
    );
    expect(
      await screen.findByText("День завершён на основе сохранённого evidence."),
    ).toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument();
    expect(
      screen.getByText(/В журнал добавлено ошибок: 1/u),
    ).toBeInTheDocument();
    expect(apiMock).toHaveBeenNthCalledWith(
      2,
      "/learning/sessions/v2/session-v2/units/unit-summary/summary",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ operationId: "operation-1" }),
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Завершить день" }));
    await vi.waitFor(() => {
      expect(apiMock).toHaveBeenLastCalledWith(
        "/learning/sessions/v2/session-v2/units/unit-summary",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({
            status: "completed",
            payload: { type: "summary", summaryId: "summary-1" },
            operationId: "operation-2",
          }),
        }),
      );
    });
  });

  it("restores a persisted summary after restart without generating it again", async () => {
    const summarized = makeSession("summary", "in_progress", {
      type: "summary",
      summaryId: "summary-restored",
    });
    apiMock.mockImplementation((path: string) => {
      if (path === "/learning/sessions/v2/session-v2") {
        return Promise.resolve({ session: summarized });
      }
      if (
        path === "/learning/sessions/v2/session-v2/units/unit-summary/summary"
      ) {
        return Promise.resolve(
          makeSummaryResponse(summarized, "summary-restored"),
        );
      }
      throw new Error(`Unexpected API path: ${path}`);
    });
    const { container } = renderWithQuery(<SessionClient />);

    expect(
      await screen.findByText("День завершён на основе сохранённого evidence."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Сформировать итог" }),
    ).not.toBeInTheDocument();
    expect(container.textContent).not.toMatch(
      /correctOptionIds|referenceAnswer/u,
    );
  });

  it("announces loading and renders a retryable contract or network error", async () => {
    apiMock.mockReturnValueOnce(new Promise(() => undefined));
    const loading = renderWithQuery(<SessionClient />);
    expect(screen.getByRole("status")).toHaveAccessibleName(
      "Загружаю занятие…",
    );
    loading.unmount();

    apiMock.mockRejectedValueOnce(new Error("Session endpoint unavailable"));
    renderWithQuery(<SessionClient />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Session endpoint unavailable",
    );
    expect(screen.getByRole("button", { name: "Повторить" })).toBeEnabled();
  });
});
