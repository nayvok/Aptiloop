import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentChat } from "@/components/agent-chat";

const mockAgentState = vi.hoisted(() => ({
  messages: [] as Array<{
    id: string;
    role: "user" | "assistant";
    content: string;
  }>,
}));

vi.mock("@/lib/api", () => ({
  api: vi.fn((path: string) => {
    if (path.startsWith("/agent/history")) {
      return Promise.resolve({ messages: mockAgentState.messages });
    }
    return Promise.resolve({
      teacherProvider: "mock",
      teacherModel: "mock-deterministic",
      reviewerProvider: "mock",
      reviewerModel: "mock-deterministic",
      interviewerProvider: "mock",
      interviewerModel: "mock-deterministic",
      curatorProvider: "mock",
      curatorModel: "mock-deterministic",
      codexExpertProvider: "mock",
      codexExpertModel: "mock-deterministic",
    });
  }),
  streamAgent: vi.fn(async function* (input: { message: string }) {
    mockAgentState.messages = [
      { id: "user-message", role: "user", content: input.message },
      {
        id: "assistant-message",
        role: "assistant",
        content: "Уточни механизм",
      },
    ];
    yield { type: "message.delta", content: "Уточни механизм" };
    yield { type: "session.completed" };
  }),
}));

afterEach(cleanup);
beforeEach(() => {
  mockAgentState.messages = [];
});

function renderAgentChat() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <AgentChat />
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

  it("switches agent role without hiding the learning boundary", () => {
    renderAgentChat();

    fireEvent.click(screen.getByRole("button", { name: "reviewer" }));
    expect(screen.getByRole("button", { name: "reviewer" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen.getByText(/Reviewer работает только с зафиксированным diff/u),
    ).toBeInTheDocument();
  });
});
