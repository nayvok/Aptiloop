import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentChat } from "@/components/agent-chat";
import { LocaleProvider } from "@/lib/i18n";

const mockAgentState = vi.hoisted(() => ({
  messages: [] as Array<{
    id: string;
    role: "user" | "assistant";
    content: string;
  }>,
  events: [] as Array<Record<string, unknown>>,
  streamFails: false,
  disclosureRequired: false,
  disclosureApproved: false,
  streamInputs: [] as Array<{
    role?: string;
    message: string;
    disclosureOperationId?: string;
  }>,
}));

vi.mock("@/lib/api", () => {
  class ApiError extends Error {
    constructor(
      message: string,
      readonly status: number,
      readonly failure?: {
        code: string;
        retryable: boolean;
        messageKey: string;
        diagnosticId: string;
        recoveryAction: string | null;
      },
    ) {
      super(message);
    }
  }
  return {
    ApiError,
    api: vi.fn((path: string, init?: RequestInit) => {
      if (path.startsWith("/agent/history")) {
        return Promise.resolve({ messages: mockAgentState.messages });
      }
      if (path === "/ai/disclosures" && init?.method === "POST") {
        if (!mockAgentState.disclosureRequired) {
          return Promise.resolve({ required: false });
        }
        return Promise.resolve({
          required: true,
          disclosure: {
            operationId: "disclosure-1",
            role: "tutor",
            scope: {
              destination: "OpenAI via Pi",
              purpose: "Tutor response",
              payloadCategories: ["learner-message"],
              exclusions: ["credentials", "protected-answers"],
              byteCount: 26,
              sha256: "a".repeat(64),
            },
          },
        });
      }
      if (path === "/ai/disclosures/disclosure-1/approve") {
        mockAgentState.disclosureApproved = true;
        return Promise.resolve({ status: "approved" });
      }
      if (path === "/ai/disclosures/disclosure-1/cancel") {
        return Promise.resolve({ status: "cancelled" });
      }
      return Promise.resolve({
        ai: {
          connections: [
            {
              connectionId: "conn:mock",
              displayName: "Deterministic Mock",
            },
          ],
          roleProfiles: [
            {
              role: "tutor",
              mode: "connection",
              connectionId: "conn:mock",
              modelId: "mock-deterministic",
            },
            {
              role: "evaluator",
              mode: "connection",
              connectionId: "conn:mock",
              modelId: "mock-deterministic",
            },
            {
              role: "reviewer",
              mode: "connection",
              connectionId: "conn:mock",
              modelId: "mock-deterministic",
            },
          ],
        },
      });
    }),
    streamAgent: vi.fn(async function* (input: {
      role?: string;
      message: string;
      disclosureOperationId?: string;
    }) {
      mockAgentState.streamInputs.push(input);
      if (
        mockAgentState.disclosureRequired &&
        (!mockAgentState.disclosureApproved ||
          input.disclosureOperationId !== "disclosure-1")
      ) {
        throw new Error("external request lacked exact disclosure approval");
      }
      if (mockAgentState.streamFails) {
        throw new Error("provider transport failed");
      }
      mockAgentState.messages = [
        { id: "user-message", role: "user", content: input.message },
      ];
      for (const event of mockAgentState.events) yield event;
    }),
  };
});

afterEach(cleanup);
beforeEach(() => {
  mockAgentState.messages = [];
  mockAgentState.streamFails = false;
  mockAgentState.disclosureRequired = false;
  mockAgentState.disclosureApproved = false;
  mockAgentState.streamInputs = [];
  mockAgentState.events = [
    { type: "message.delta", turnId: "turn-1", content: "Уточни механизм" },
    {
      type: "session.completed",
      turnId: "turn-1",
      reason: "completed",
    },
  ];
});

function renderAgentChat() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <LocaleProvider initialLocale="ru-RU" syncSettings={false}>
        <AgentChat />
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

describe("AgentChat", () => {
  it("keeps the learner message and renders streamed agent output", async () => {
    renderAgentChat();

    const input = screen.getByLabelText("Сообщение агенту");
    fireEvent.change(input, {
      target: { value: "Мой самостоятельный ответ" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Отправить" }));

    expect(screen.getByText("Мой самостоятельный ответ")).toBeInTheDocument();
    expect(await screen.findByText("Уточни механизм")).toBeInTheDocument();
  });

  it("requires exact one-time approval before an external AI request", async () => {
    mockAgentState.disclosureRequired = true;
    renderAgentChat();

    fireEvent.change(screen.getByLabelText("Сообщение агенту"), {
      target: { value: "Поясни замыкания" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Отправить" }));

    expect(
      await screen.findByRole("heading", {
        name: "Отправить данные внешнему AI?",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("OpenAI via Pi")).toBeInTheDocument();
    expect(screen.getByText(/learner-message · 26 bytes/u)).toBeInTheDocument();
    expect(mockAgentState.streamInputs).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Разрешить один раз" }));

    expect(await screen.findByText("Уточни механизм")).toBeInTheDocument();
    expect(mockAgentState.disclosureApproved).toBe(true);
    expect(mockAgentState.streamInputs).toEqual([
      {
        role: "teacher",
        message: "Поясни замыкания",
        disclosureOperationId: "disclosure-1",
      },
    ]);
  });

  it("keeps a completion-only provider answer visible", async () => {
    mockAgentState.events = [
      {
        type: "message.completed",
        turnId: "turn-1",
        content: "Полный ответ без дельт",
      },
      {
        type: "session.completed",
        turnId: "turn-1",
        reason: "completed",
      },
    ];
    renderAgentChat();

    fireEvent.change(screen.getByLabelText("Сообщение агенту"), {
      target: { value: "Объясни механизм" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Отправить" }));

    expect(await screen.findByText("Полный ответ без дельт")).toBeVisible();
    expect(
      screen.queryByText("Агент завершил ответ без текста."),
    ).not.toBeInTheDocument();
  });

  it("replaces accumulated deltas with authoritative completed content", async () => {
    mockAgentState.events = [
      { type: "message.delta", turnId: "turn-1", content: "Черновик" },
      {
        type: "message.completed",
        turnId: "turn-1",
        content: "Итоговый ответ",
      },
      {
        type: "session.completed",
        turnId: "turn-1",
        reason: "completed",
      },
    ];
    renderAgentChat();

    fireEvent.change(screen.getByLabelText("Сообщение агенту"), {
      target: { value: "Дай итог" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Отправить" }));

    expect(await screen.findByText("Итоговый ответ")).toBeVisible();
    expect(screen.queryByText("Черновик")).not.toBeInTheDocument();
  });

  it.each([
    {
      reason: "failed",
      events: [
        {
          type: "error",
          turnId: "turn-1",
          message: "untrusted provider detail",
        },
        {
          type: "session.completed",
          turnId: "turn-1",
          reason: "failed",
        },
      ],
      expected: "Не удалось получить ответ.",
    },
    {
      reason: "cancelled",
      events: [
        {
          type: "session.completed",
          turnId: "turn-1",
          reason: "cancelled",
        },
      ],
      expected: "Ответ остановлен.",
    },
  ])(
    "renders explicit $reason terminal state",
    async ({ events, expected }) => {
      mockAgentState.events = events;
      renderAgentChat();

      fireEvent.change(screen.getByLabelText("Сообщение агенту"), {
        target: { value: "Продолжай" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Отправить" }));

      expect(await screen.findByText(expected)).toBeVisible();
      expect(
        screen.queryByText("Агент завершил ответ без текста."),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText("untrusted provider detail"),
      ).not.toBeInTheDocument();
    },
  );

  it("switches agent role without hiding the learning boundary", () => {
    renderAgentChat();

    fireEvent.click(screen.getByRole("button", { name: "reviewer" }));
    expect(screen.getByRole("button", { name: "reviewer" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen.getByText(
        /Проверка решения работает только с зафиксированным diff/u,
      ),
    ).toBeInTheDocument();
  });

  it("shows a transport failure as an actionable assistant state", async () => {
    mockAgentState.streamFails = true;
    renderAgentChat();

    fireEvent.change(screen.getByLabelText("Сообщение агенту"), {
      target: { value: "Проверь мой ответ" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Отправить" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Не удалось получить ответ: provider transport failed",
    );
    expect(
      screen.getAllByText(
        "Не удалось получить ответ: provider transport failed",
      ),
    ).toHaveLength(2);
    expect(screen.queryByText("Ответ был отменён.")).not.toBeInTheDocument();
  });
});
