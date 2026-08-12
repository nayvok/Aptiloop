import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentChat } from "@/components/agent-chat";
import type { ChatRole } from "@/lib/chat-role";
import { LocaleProvider } from "@/lib/i18n";

const { ApiErrorMock, mockAgentState } = vi.hoisted(() => {
  class TestApiError extends Error {
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
    ApiErrorMock: TestApiError,
    mockAgentState: {
      messages: [] as Array<{
        id: string;
        role: "user" | "assistant";
        content: string;
      }>,
      events: [] as Array<Record<string, unknown>>,
      streamFails: false,
      waitForAbort: false,
      streamSignals: [] as AbortSignal[],
      historyError: null as Error | null,
      historyGate: null as Promise<void> | null,
      disclosureRequired: false,
      aiOff: false,
      connectionEnabled: true,
      connectionState: "connected",
      authenticated: true,
      streaming: true,
      modelAvailable: true,
      assignedModelId: "mock-deterministic" as string | null,
      disclosureApproved: false,
      approvalError: null as Error | null,
      cancellationError: null as Error | null,
      streamInputs: [] as Array<{
        role?: string;
        message: string;
        disclosureOperationId?: string;
      }>,
    },
  };
});

vi.mock("@/lib/api", () => {
  return {
    ApiError: ApiErrorMock,
    api: vi.fn(async (path: string, init?: RequestInit) => {
      if (path.startsWith("/agent/history")) {
        if (mockAgentState.historyGate) await mockAgentState.historyGate;
        if (mockAgentState.historyError) throw mockAgentState.historyError;
        return { messages: mockAgentState.messages };
      }
      if (path === "/ai/disclosures" && init?.method === "POST") {
        if (!mockAgentState.disclosureRequired) {
          return Promise.resolve({ required: false });
        }
        const disclosure = {
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
        };
        return Promise.resolve({
          required: true,
          disclosure,
        });
      }
      if (path === "/ai/disclosures/disclosure-1/approve") {
        if (mockAgentState.approvalError) throw mockAgentState.approvalError;
        mockAgentState.disclosureApproved = true;
        return Promise.resolve({ status: "approved" });
      }
      if (path === "/ai/disclosures/disclosure-1/cancel") {
        if (mockAgentState.cancellationError)
          throw mockAgentState.cancellationError;
        return Promise.resolve({ status: "cancelled" });
      }
      return Promise.resolve({
        ai: {
          connections: [
            {
              connectionId: "conn:mock",
              adapterId: "mock",
              displayName: "Deterministic Mock",
              enabled: mockAgentState.connectionEnabled,
              state: mockAgentState.connectionState,
              observedCapabilities: {
                connection: {
                  authenticated: mockAgentState.authenticated,
                  streaming: mockAgentState.streaming,
                  cancellation: true,
                },
                models: [
                  {
                    modelId: "mock-deterministic",
                    available: mockAgentState.modelAvailable,
                  },
                ],
              },
            },
          ],
          roleProfiles: [
            {
              role: "tutor",
              mode: mockAgentState.aiOff ? "no-ai" : "connection",
              connectionId: mockAgentState.aiOff ? null : "conn:mock",
              modelId: mockAgentState.aiOff
                ? null
                : mockAgentState.assignedModelId,
            },
            {
              role: "evaluator",
              mode: mockAgentState.aiOff ? "no-ai" : "connection",
              connectionId: mockAgentState.aiOff ? null : "conn:mock",
              modelId: mockAgentState.aiOff
                ? null
                : mockAgentState.assignedModelId,
            },
            {
              role: "reviewer",
              mode: mockAgentState.aiOff ? "no-ai" : "connection",
              connectionId: mockAgentState.aiOff ? null : "conn:mock",
              modelId: mockAgentState.aiOff
                ? null
                : mockAgentState.assignedModelId,
            },
          ],
        },
      });
    }),
    streamAgent: vi.fn(async function* (
      input: {
        role?: string;
        message: string;
        disclosureOperationId?: string;
      },
      signal: AbortSignal,
    ) {
      mockAgentState.streamInputs.push(input);
      mockAgentState.streamSignals.push(signal);
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
      if (mockAgentState.waitForAbort) {
        yield {
          type: "message.delta",
          turnId: "turn-1",
          content: "Начало ответа",
        };
        await new Promise<void>((resolve) => {
          if (signal.aborted) resolve();
          else
            signal.addEventListener("abort", () => resolve(), { once: true });
        });
        yield {
          type: "message.delta",
          turnId: "turn-1",
          content: " ПОЗДНЯЯ ДЕЛЬТА",
        };
        yield {
          type: "session.completed",
          turnId: "turn-1",
          reason: "completed",
        };
        return;
      }
      for (const event of mockAgentState.events) yield event;
    }),
  };
});

afterEach(cleanup);
beforeEach(() => {
  mockAgentState.messages = [];
  mockAgentState.streamFails = false;
  mockAgentState.waitForAbort = false;
  mockAgentState.streamSignals = [];
  mockAgentState.historyError = null;
  mockAgentState.historyGate = null;
  mockAgentState.disclosureRequired = false;
  mockAgentState.disclosureApproved = false;
  mockAgentState.approvalError = null;
  mockAgentState.cancellationError = null;
  mockAgentState.aiOff = false;
  mockAgentState.connectionEnabled = true;
  mockAgentState.connectionState = "connected";
  mockAgentState.authenticated = true;
  mockAgentState.streaming = true;
  mockAgentState.modelAvailable = true;
  mockAgentState.assignedModelId = "mock-deterministic";
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

  function AgentChatHarness() {
    const [role, setRole] = useState<ChatRole>("teacher");
    return <AgentChat key={role} role={role} onRoleChange={setRole} />;
  }

  return render(
    <QueryClientProvider client={queryClient}>
      <LocaleProvider initialLocale="ru-RU" syncSettings={false}>
        <AgentChatHarness />
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

describe("AgentChat", () => {
  it("shows an explicit loading state while history is pending", async () => {
    mockAgentState.historyGate = new Promise(() => undefined);
    renderAgentChat();

    expect(
      await screen.findAllByText("Загружаю диалог…", {
        selector: '[role="status"]',
      }),
    ).toHaveLength(2);
    expect(
      screen.queryByText("Сначала сформулируй свой вопрос или ответ"),
    ).not.toBeInTheDocument();
  });

  it("shows an explicit empty state and the reload recovery limitation", async () => {
    renderAgentChat();

    expect(
      await screen.findByText("Сначала сформулируй свой вопрос или ответ"),
    ).toBeVisible();
    expect(
      screen.getByText(
        "Перезагрузка не восстанавливает неотправленный черновик или формируемый ответ.",
      ),
    ).toBeVisible();
  });

  it("uses safe history copy and keeps bounded diagnostics closed", async () => {
    mockAgentState.historyError = new ApiErrorMock(
      `safe history diagnostic ${"x".repeat(800)}`,
      503,
      {
        code: "provider_unavailable",
        retryable: true,
        messageKey: "provider.unavailable",
        diagnosticId: "diagnostic-history-1",
        recoveryAction: null,
      },
    );
    renderAgentChat();

    const alert = await screen.findByRole("alert");
    expect(
      within(alert).getByText("История диалога временно недоступна."),
    ).toBeVisible();
    const details = within(alert)
      .getByText("Технические подробности")
      .closest("details");
    expect(details).not.toHaveAttribute("open");
    expect(details?.textContent).not.toContain("safe history diagnostic");
    expect(details?.textContent).toContain("diagnostic-history-1");
    expect(details?.textContent).toContain("Статус HTTP: 503");
    expect(details?.textContent).toContain(
      "Идентификатор диагностики: diagnostic-history-1",
    );
    expect(details?.textContent.length).toBeLessThanOrEqual(630);
    expect(
      within(alert).getByRole("button", { name: "Повторить" }),
    ).toBeEnabled();
    expect(
      screen.queryByText("Сначала сформулируй свой вопрос или ответ"),
    ).not.toBeInTheDocument();
  });

  it("keeps the learner message and renders streamed agent output", async () => {
    renderAgentChat();

    const input = screen.getByLabelText("Сообщение агенту");
    fireEvent.change(input, {
      target: { value: "Мой самостоятельный ответ" },
    });
    fireEvent.click(await screen.findByRole("button", { name: "Отправить" }));
    await screen.findByText("Ответ готов");

    expect(screen.getByText("Мой самостоятельный ответ")).toBeInTheDocument();
    expect(await screen.findByText("Уточни механизм")).toBeInTheDocument();
  });

  it("nests assistant Markdown headings below the chat page heading", async () => {
    mockAgentState.events = [
      {
        type: "message.completed",
        turnId: "turn-1",
        content: "# First\n## Second\n### Third",
      },
      {
        type: "session.completed",
        turnId: "turn-1",
        reason: "completed",
      },
    ];
    renderAgentChat();

    fireEvent.change(screen.getByLabelText("Сообщение агенту"), {
      target: { value: "Show the hierarchy" },
    });
    fireEvent.click(await screen.findByRole("button", { name: "Отправить" }));

    const firstHeading = await screen.findByRole("heading", {
      level: 2,
      name: "First",
    });
    expect(firstHeading.tagName).toBe("H2");
    expect(screen.getByText("Second").tagName).toBe("H3");
    expect(screen.getByText("Third").tagName).toBe("H4");
  });

  it("keeps AI Off non-mutating and links to configuration", async () => {
    mockAgentState.aiOff = true;
    const view = renderAgentChat();

    expect(
      await screen.findByRole("link", { name: "Настроить AI" }),
    ).toHaveAttribute("href", "/settings?section=ai");
    expect(screen.getByLabelText("Сообщение агенту")).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "Отправить" }),
    ).not.toBeInTheDocument();
    expect(
      view.container.querySelector('[data-slot="agent-chat"]'),
    ).toHaveClass("min-h-0", "flex-1", "overflow-hidden");
    expect(
      view.container.querySelector('[data-slot="message-scroller"]'),
    ).toHaveClass("min-h-0", "flex-1");
    expect(view.container.querySelector("form")).toHaveClass("shrink-0");
  });

  it.each([
    { state: "degraded", authenticated: true },
    { state: "connected", authenticated: false },
  ])(
    "routes $state connection recovery to Connections",
    async ({ state, authenticated }) => {
      mockAgentState.connectionState = state;
      mockAgentState.authenticated = authenticated;
      renderAgentChat();

      expect(
        await screen.findByRole("link", { name: "Настроить AI" }),
      ).toHaveAttribute("href", "/settings?section=connections");
      expect(screen.getByLabelText("Сообщение агенту")).toBeDisabled();
    },
  );

  it("routes a missing assigned model to AI roles", async () => {
    mockAgentState.assignedModelId = "missing-model";
    renderAgentChat();

    expect(
      await screen.findByRole("link", { name: "Настроить AI" }),
    ).toHaveAttribute("href", "/settings?section=ai");
    expect(screen.getByLabelText("Сообщение агенту")).toBeDisabled();
  });

  it("requires exact one-time approval before an external AI request", async () => {
    mockAgentState.disclosureRequired = true;
    renderAgentChat();

    fireEvent.change(screen.getByLabelText("Сообщение агенту"), {
      target: { value: "Поясни замыкания" },
    });
    fireEvent.click(await screen.findByRole("button", { name: "Отправить" }));

    expect(
      await screen.findByRole("heading", {
        name: "Отправить данные внешнему AI?",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("OpenAI via Pi")).toBeInTheDocument();
    expect(screen.getByText(/learner-message · 26 Б/u)).toBeInTheDocument();
    expect(mockAgentState.streamInputs).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Разрешить один раз" }));
    await screen.findByText("Ответ готов");

    expect(await screen.findByText("Уточни механизм")).toBeInTheDocument();
    expect(mockAgentState.disclosureApproved).toBe(true);
    expect(mockAgentState.streamInputs).toHaveLength(1);
    expect(mockAgentState.streamInputs[0]).toMatchObject({
      role: "teacher",
      message: "Поясни замыкания",
      disclosureOperationId: "disclosure-1",
    });
  });

  it("keeps the exact pending approval open when approval fails", async () => {
    mockAgentState.disclosureRequired = true;
    mockAgentState.approvalError = new ApiErrorMock(
      "credential=secret-value",
      503,
      {
        code: "provider_unavailable",
        retryable: true,
        messageKey: "provider.unavailable",
        diagnosticId: "diagnostic-approval-1",
        recoveryAction: null,
      },
    );
    renderAgentChat();

    fireEvent.change(screen.getByLabelText("Сообщение агенту"), {
      target: { value: "Не потеряй эту операцию" },
    });
    fireEvent.click(await screen.findByRole("button", { name: "Отправить" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Разрешить один раз" }),
    );

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toBeVisible();
    expect(dialog).toHaveTextContent(
      "Не удалось отправить запрос. Сообщение сохранено для повторной отправки.",
    );
    expect(dialog).toHaveTextContent("diagnostic-approval-1");
    expect(dialog).not.toHaveTextContent("credential=secret-value");
    expect(mockAgentState.streamInputs).toHaveLength(0);
    expect(
      within(dialog).getByRole("button", { name: "Разрешить один раз" }),
    ).toBeEnabled();
  });

  it("reopens the exact disclosure when cancellation cannot be confirmed", async () => {
    mockAgentState.disclosureRequired = true;
    mockAgentState.cancellationError = new ApiErrorMock(
      "credential=cancel-secret",
      503,
      {
        code: "provider_unavailable",
        retryable: true,
        messageKey: "provider.unavailable",
        diagnosticId: "diagnostic-cancel-1",
        recoveryAction: null,
      },
    );
    renderAgentChat();

    fireEvent.change(screen.getByLabelText("Сообщение агенту"), {
      target: { value: "Отмени безопасно" },
    });
    fireEvent.click(await screen.findByRole("button", { name: "Отправить" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Не отправлять" }),
    );

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent(
      "Не удалось отменить ожидающее разрешение на отправку внешнему AI. Данные не отправлены — повтори попытку.",
    );
    expect(dialog).toHaveTextContent("diagnostic-cancel-1");
    expect(dialog).not.toHaveTextContent("credential=cancel-secret");
    expect(mockAgentState.streamInputs).toHaveLength(0);
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
    fireEvent.click(await screen.findByRole("button", { name: "Отправить" }));
    await screen.findByText("Ответ готов");

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
    fireEvent.click(await screen.findByRole("button", { name: "Отправить" }));
    await screen.findByText("Ответ готов");

    expect(await screen.findByText("Итоговый ответ")).toBeVisible();
    expect(screen.queryByText("Черновик")).not.toBeInTheDocument();
  });

  it("wraps long unbroken learner and assistant content", async () => {
    const learnerToken = `learner-${"a".repeat(300)}`;
    const assistantToken = `assistant-${"b".repeat(300)}`;
    mockAgentState.events = [
      {
        type: "message.completed",
        turnId: "turn-1",
        content: assistantToken,
      },
      {
        type: "session.completed",
        turnId: "turn-1",
        reason: "completed",
      },
    ];
    renderAgentChat();

    fireEvent.change(screen.getByLabelText("Сообщение агенту"), {
      target: { value: learnerToken },
    });
    fireEvent.click(await screen.findByRole("button", { name: "Отправить" }));

    const learnerMessage = await screen.findByRole("article", { name: "Ты" });
    expect(within(learnerMessage).getByText(learnerToken)).toHaveClass(
      "[overflow-wrap:anywhere]",
    );
    expect(
      (await screen.findByText(assistantToken)).closest("div"),
    ).toHaveClass("[overflow-wrap:anywhere]", "min-w-0", "max-w-[72ch]");
  });

  it("stops the active stream, ignores late deltas, and resets controls", async () => {
    mockAgentState.waitForAbort = true;
    renderAgentChat();

    fireEvent.change(screen.getByLabelText("Сообщение агенту"), {
      target: { value: "Останови этот ответ" },
    });
    fireEvent.click(await screen.findByRole("button", { name: "Отправить" }));

    expect(await screen.findByText("Начало ответа")).toBeVisible();
    const stop = screen.getByRole("button", { name: "Остановить ответ" });
    expect(mockAgentState.streamSignals).toHaveLength(1);
    expect(mockAgentState.streamSignals[0]?.aborted).toBe(false);

    fireEvent.click(stop);

    await waitFor(() => {
      expect(mockAgentState.streamSignals[0]?.aborted).toBe(true);
      expect(screen.getAllByText("Ответ остановлен.")).toHaveLength(2);
    });
    expect(screen.queryByText(/ПОЗДНЯЯ ДЕЛЬТА/u)).not.toBeInTheDocument();
    expect(
      screen.getByText("Ответ остановлен.", { selector: 'p[role="status"]' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Остановить ответ" }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Сообщение агенту")).toBeEnabled();
    fireEvent.change(screen.getByLabelText("Сообщение агенту"), {
      target: { value: "Следующий вопрос" },
    });
    expect(screen.getByRole("button", { name: "Отправить" })).toBeEnabled();
  });

  it("discloses only allowlisted tool names and lifecycle status", async () => {
    mockAgentState.events = [
      {
        type: "tool.summary",
        turnId: "turn-1",
        name: "lesson.readLearnerSafeContext",
        status: "started",
        toolCallId: "private-call-id",
        args: { protected: "private-argument" },
      },
      {
        type: "tool.summary",
        turnId: "turn-1",
        name: "lesson.readLearnerSafeContext",
        status: "completed",
        output: "private-output",
      },
      {
        type: "message.completed",
        turnId: "turn-1",
        content: "Готово",
      },
      {
        type: "session.completed",
        turnId: "turn-1",
        reason: "completed",
      },
    ];
    renderAgentChat();

    fireEvent.change(screen.getByLabelText("Сообщение агенту"), {
      target: { value: "Покажи границу" },
    });
    fireEvent.click(await screen.findByRole("button", { name: "Отправить" }));
    await screen.findByText("Ответ готов");
    fireEvent.click(
      screen.getByRole("button", { name: "События инструментов (2)" }),
    );

    expect(
      screen.getByText("lesson.readLearnerSafeContext · started"),
    ).toBeVisible();
    expect(
      screen.getByText("lesson.readLearnerSafeContext · completed"),
    ).toBeVisible();
    expect(screen.queryByText(/private-call-id/u)).not.toBeInTheDocument();
    expect(screen.queryByText(/private-argument/u)).not.toBeInTheDocument();
    expect(screen.queryByText(/private-output/u)).not.toBeInTheDocument();
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
      liveStatus: "Ответ не получен",
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
      liveStatus: "Ответ остановлен.",
    },
  ])(
    "renders explicit $reason terminal state",
    async ({ events, expected, liveStatus }) => {
      mockAgentState.events = events;
      renderAgentChat();

      fireEvent.change(screen.getByLabelText("Сообщение агенту"), {
        target: { value: "Продолжай" },
      });
      fireEvent.click(await screen.findByRole("button", { name: "Отправить" }));
      const assistantMessage = await screen.findByRole("article", {
        name: "Тьютор",
      });

      expect(await within(assistantMessage).findByText(expected)).toBeVisible();
      expect(
        screen.getByText(liveStatus, { selector: 'p[role="status"]' }),
      ).toBeInTheDocument();
      expect(
        screen.queryByText("Агент завершил ответ без текста."),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText("untrusted provider detail"),
      ).not.toBeInTheDocument();
    },
  );

  it("switches agent role without hiding the learning boundary", async () => {
    renderAgentChat();

    fireEvent.click(screen.getByRole("button", { name: "Ревьюер решения" }));
    expect(
      screen.getByRole("button", { name: "Ревьюер решения" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      await screen.findByText(
        /Проверка решения работает только с зафиксированным diff/u,
      ),
    ).toBeInTheDocument();
  });

  it("shows a transport failure once and preserves the retry input", async () => {
    mockAgentState.streamFails = true;
    renderAgentChat();

    fireEvent.change(screen.getByLabelText("Сообщение агенту"), {
      target: { value: "Проверь мой ответ" },
    });
    fireEvent.click(await screen.findByRole("button", { name: "Отправить" }));

    const alert = await screen.findByRole("alert");
    expect(
      within(alert).getByText(
        "Не удалось получить ответ. Сообщение сохранено для повторной отправки.",
      ),
    ).toBeVisible();
    expect(
      screen.queryByText("provider transport failed"),
    ).not.toBeInTheDocument();
    expect(
      within(alert).queryByText("Технические подробности"),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Сообщение агенту")).toHaveValue(
      "Проверь мой ответ",
    );
    expect(screen.getByRole("button", { name: "Повторить" })).toBeEnabled();
    expect(screen.queryByText("Ответ был отменён.")).not.toBeInTheDocument();
  });
});
