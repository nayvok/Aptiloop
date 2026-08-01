import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InterviewClient } from "@/components/interview-client";

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));

vi.mock("@/lib/api", () => ({ api: apiMock }));

const now = "2026-08-01T00:00:00.000Z";

interface TranscriptMessage {
  id: string;
  role: "assistant" | "user";
  content: string;
  createdAt: string;
}

function interviewFixture({
  status = "in_progress",
  transcript = [
    {
      id: "question-1",
      role: "assistant" as const,
      content:
        "Чем lexical scope отличается от dynamic scope? Ответьте за две минуты.",
      createdAt: now,
    },
  ],
  questionCount = 2,
  report = null as ReturnType<typeof reportFixture> | null,
}: {
  status?: string;
  transcript?: TranscriptMessage[];
  questionCount?: number;
  report?: ReturnType<typeof reportFixture> | null;
} = {}) {
  const questionsAsked = transcript.filter(
    (message) => message.role === "assistant",
  ).length;
  const questionsAnswered = transcript.filter(
    (message) => message.role === "user",
  ).length;
  return {
    id: "interview-1",
    status,
    setup: {
      topics: ["JavaScript", "TypeScript"],
      difficulty: "interview-ready" as const,
      questionCount,
    },
    transcript,
    progress: {
      questionsAsked,
      questionsAnswered,
      readyToFinish:
        questionsAsked === questionCount &&
        questionsAnswered === questionsAsked,
    },
    report,
    startedAt: now,
    completedAt: status === "completed" ? now : null,
  };
}

function reportFixture() {
  return {
    interviewId: "interview-1",
    status: "completed" as const,
    summary:
      "Интервью завершено. Техническая корректность отдельно не оценивалась.",
    topics: ["JavaScript", "TypeScript"],
    metrics: {
      questionsAsked: 2,
      questionsAnswered: 2,
      completionRate: 1,
    },
    strengths: ["Оба ответа содержат рассуждение."],
    growthAreas: ["Добавлять минимальный пример."],
    evidence: [
      {
        questionNumber: 1,
        topic: "JavaScript",
        answerExcerpt: "Lexical scope определяется местом объявления.",
        observation: "Ответ содержит развёрнутое рассуждение.",
      },
      {
        questionNumber: 2,
        topic: "TypeScript",
        answerExcerpt: "Narrowing уточняет тип после проверки.",
        observation: "Ответ содержит развёрнутое рассуждение.",
      },
    ],
  };
}

function transcriptWithFirstAnswer() {
  return [
    {
      id: "question-1",
      role: "assistant" as const,
      content:
        "Чем lexical scope отличается от dynamic scope? Ответьте за две минуты.",
      createdAt: now,
    },
    {
      id: "answer-1",
      role: "user" as const,
      content: "Lexical scope определяется местом объявления функции.",
      createdAt: now,
    },
    {
      id: "question-2",
      role: "assistant" as const,
      content:
        "Как TypeScript narrowing меняет доступный тип? Ответьте за минуту.",
      createdAt: now,
    },
  ];
}

function transcriptComplete() {
  return [
    ...transcriptWithFirstAnswer(),
    {
      id: "answer-2",
      role: "user" as const,
      content: "Narrowing уточняет union после runtime-проверки.",
      createdAt: now,
    },
  ];
}

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
  window.localStorage.clear();
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

describe("versioned interview workflow", () => {
  it("runs setup, sequential questions, answers, finish and renders the persisted report", async () => {
    const opened = interviewFixture();
    const followedUp = interviewFixture({
      transcript: transcriptWithFirstAnswer(),
    });
    const ready = interviewFixture({ transcript: transcriptComplete() });
    const report = reportFixture();
    const completed = interviewFixture({
      status: "completed",
      transcript: transcriptComplete(),
      report,
    });
    apiMock
      .mockResolvedValueOnce({ interview: null })
      .mockResolvedValueOnce(opened)
      .mockResolvedValueOnce(followedUp)
      .mockResolvedValueOnce(ready)
      .mockResolvedValueOnce({ interview: completed, report });

    renderWithQuery(<InterviewClient />);

    fireEvent.change(await screen.findByLabelText("Темы через запятую"), {
      target: { value: "JavaScript, TypeScript" },
    });
    fireEvent.change(screen.getByLabelText("Количество вопросов"), {
      target: { value: "2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Начать интервью" }));

    expect(
      await screen.findByText(/Чем lexical scope отличается/u),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Чем lexical scope отличается от dynamic scope?",
    );
    expect(apiMock).toHaveBeenNthCalledWith(
      2,
      "/interviews/v2",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          operationId: "operation-1",
          topics: ["JavaScript", "TypeScript"],
          difficulty: "interview-ready",
          questionCount: 2,
        }),
      }),
    );

    fireEvent.change(screen.getByLabelText("Сообщение"), {
      target: {
        value: "Lexical scope определяется местом объявления функции.",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Отправить ответ" }));
    expect(
      await screen.findByText(/Как TypeScript narrowing/u),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Как TypeScript narrowing меняет доступный тип?",
    );
    expect(screen.getByRole("status")).not.toHaveTextContent(
      "Чем lexical scope отличается от dynamic scope?",
    );

    fireEvent.change(screen.getByLabelText("Сообщение"), {
      target: { value: "Narrowing уточняет union после runtime-проверки." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Отправить ответ" }));
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Завершить и открыть отчёт",
      }),
    );

    expect(await screen.findByText("Отчёт по интервью")).toBeInTheDocument();
    expect(
      screen.getByText("Оба ответа содержат рассуждение."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Добавлять минимальный пример."),
    ).toBeInTheDocument();
    expect(screen.getByText(/Lexical scope определяется/u)).toBeInTheDocument();
    expect(screen.getByText("100%")).toBeInTheDocument();
    expect(apiMock).toHaveBeenLastCalledWith(
      "/interviews/v2/interview-1/finish",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ operationId: "operation-4" }),
      }),
    );
  });

  it("restores the current interview and its pending question after remount", async () => {
    apiMock.mockResolvedValueOnce({
      interview: interviewFixture({ transcript: transcriptWithFirstAnswer() }),
    });

    renderWithQuery(<InterviewClient />);

    expect(
      await screen.findByText(/Как TypeScript narrowing/u),
    ).toBeInTheDocument();
    expect(screen.getByText("1 / 2")).toBeInTheDocument();
    expect(screen.getByLabelText("Сообщение")).toHaveValue("");
    expect(apiMock).toHaveBeenCalledWith("/interviews/v2/current");
  });

  it("keeps the answer and operation id available when the provider fails", async () => {
    apiMock
      .mockResolvedValueOnce({ interview: interviewFixture() })
      .mockRejectedValueOnce(
        new Error(
          "Interviewer provider failed. Your transcript was preserved.",
        ),
      )
      .mockResolvedValueOnce(
        interviewFixture({
          transcript: [
            {
              id: "question-1",
              role: "assistant" as const,
              content: "Чем lexical scope отличается?",
              createdAt: now,
            },
            {
              id: "answer-1",
              role: "user" as const,
              content: "Ответ, который нельзя потерять.",
              createdAt: now,
            },
          ],
        }),
      );
    renderWithQuery(<InterviewClient />);

    fireEvent.change(await screen.findByLabelText("Сообщение"), {
      target: { value: "Ответ, который нельзя потерять." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Отправить ответ" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Ответ сохранён в форме",
    );
    expect(screen.getByLabelText("Сообщение")).toHaveValue(
      "Ответ, который нельзя потерять.",
    );
    const persisted = JSON.parse(
      window.localStorage.getItem("dlh-interview-v2-pending-answer") ?? "null",
    ) as { operationId: string; answer: string };
    expect(persisted).toEqual(
      expect.objectContaining({
        operationId: "operation-1",
        answer: "Ответ, который нельзя потерять.",
      }),
    );
  });

  it("rejects protected fields recursively before leaked interview content is rendered", async () => {
    const leaked = interviewFixture() as ReturnType<typeof interviewFixture> & {
      nested?: { referenceAnswer: string };
    };
    leaked.nested = { referenceAnswer: "Скрытый эталон" };
    apiMock.mockResolvedValueOnce({ interview: leaked });

    renderWithQuery(<InterviewClient />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Protected interview field received",
    );
    expect(screen.queryByText("Скрытый эталон")).not.toBeInTheDocument();
  });

  it("renders chat bubbles, typing state and a single live pending question", async () => {
    let resolveAnswer!: (value: ReturnType<typeof interviewFixture>) => void;
    const nextQuestion = new Promise<ReturnType<typeof interviewFixture>>(
      (resolve) => {
        resolveAnswer = resolve;
      },
    );
    apiMock
      .mockResolvedValueOnce({ interview: interviewFixture() })
      .mockReturnValueOnce(nextQuestion);
    renderWithQuery(<InterviewClient />);

    expect(
      await screen.findByText(/Чем lexical scope отличается/u),
    ).toBeInTheDocument();
    expect(screen.getByText("Интервьюер")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Чем lexical scope отличается от dynamic scope?",
    );
    expect(screen.getAllByRole("status")).toHaveLength(1);

    fireEvent.change(screen.getByLabelText("Сообщение"), {
      target: {
        value: "Lexical scope определяется местом объявления функции.",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Отправить ответ" }));
    expect(await screen.findByText("Интервьюер печатает…")).toBeInTheDocument();
    resolveAnswer(
      interviewFixture({ transcript: transcriptWithFirstAnswer() }),
    );
    expect(
      await screen.findByText(/Как TypeScript narrowing/u),
    ).toBeInTheDocument();
    expect(screen.getByText("Вы")).toBeInTheDocument();
    expect(screen.queryByText("Интервьюер печатает…")).not.toBeInTheDocument();
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Как TypeScript narrowing меняет доступный тип?",
    );
  });

  it("sends with Enter and keeps Shift+Enter as a newline", async () => {
    apiMock.mockResolvedValueOnce({ interview: interviewFixture() });
    renderWithQuery(<InterviewClient />);
    const composer = await screen.findByLabelText("Сообщение");
    fireEvent.change(composer, { target: { value: "Мой ответ" } });
    fireEvent.keyDown(composer, { key: "Enter", shiftKey: true });
    expect(apiMock).not.toHaveBeenCalledWith(
      "/interviews/v2/interview-1/answers",
      expect.anything(),
    );
    fireEvent.keyDown(composer, { key: "Enter" });
    expect(apiMock).toHaveBeenCalledWith(
      "/interviews/v2/interview-1/answers",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("shows a retry control when a saved answer awaits the next question", async () => {
    apiMock.mockResolvedValueOnce({
      interview: interviewFixture({
        transcript: transcriptWithFirstAnswer().slice(0, 2),
      }),
    });
    window.localStorage.setItem(
      "dlh-interview-v2-pending-answer",
      JSON.stringify({
        interviewId: "interview-1",
        operationId: "operation-1",
        answer: "Lexical scope определяется местом объявления функции.",
      }),
    );

    renderWithQuery(<InterviewClient />);

    expect(
      await screen.findByRole("button", { name: "Повторить запрос" }),
    ).toBeInTheDocument();
  });
});
