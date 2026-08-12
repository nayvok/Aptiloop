import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ReviewActivityClient } from "@/components/review-activity-client";
import { LocaleProvider } from "@/lib/i18n";

const { apiMock, randomUUIDMock } = vi.hoisted(() => ({
  apiMock: vi.fn(),
  randomUUIDMock: vi.fn(),
}));

vi.mock("@/lib/api", () => ({ api: apiMock }));

const executionId = "execution/with-path";
const activity = {
  executionId,
  schemaVersion: 1,
  activitySnapshotHash: "a".repeat(64),
  executionContextHash: "b".repeat(64),
  title: "Lexical scope",
  description: "Explain the concept from the saved lesson snapshot.",
  prompt: "Why does a closure retain access to its lexical environment?",
  dueAt: "2026-01-02T00:00:00.000Z",
  sourceEvidenceAt: "2026-01-01T00:00:00.000Z",
  sourceActivityType: "recall",
  dimension: "understanding",
  activityKind: "recall",
  reasonCode: "low_mastery",
  response: {
    type: "free-response",
    minimumLength: 1,
    maximumLength: 50_000,
  },
} as const;

function renderActivity({
  onExit = vi.fn(),
  onComplete = vi.fn(),
}: {
  onExit?: () => void;
  onComplete?: (nextDueAt: string) => void;
} = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidateSpy = vi.spyOn(client, "invalidateQueries");
  render(
    <QueryClientProvider client={client}>
      <LocaleProvider initialLocale="ru-RU" syncSettings={false}>
        <ReviewActivityClient
          executionId={executionId}
          onExit={onExit}
          onComplete={onComplete}
        />
      </LocaleProvider>
    </QueryClientProvider>,
  );
  return { client, invalidateSpy, onComplete, onExit };
}

beforeEach(() => {
  apiMock.mockReset();
  randomUUIDMock.mockReset();
  randomUUIDMock
    .mockReturnValueOnce("review-operation-1")
    .mockReturnValueOnce("review-operation-2")
    .mockReturnValue("review-operation-later");
  vi.stubGlobal("crypto", { randomUUID: randomUUIDMock });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("typed Review Activity", () => {
  it("loads the exact encoded execution and renders learner-safe ActivityFrame content", async () => {
    apiMock.mockResolvedValue({ activity });

    renderActivity();

    expect(
      await screen.findByRole("heading", { name: "Lexical scope" }),
    ).toBeVisible();
    expect(apiMock).toHaveBeenCalledWith(
      "/learning/reviews/executions/execution%2Fwith-path",
    );
    expect(
      document.querySelector('[data-slot="activity-frame"]'),
    ).toHaveAttribute("data-activity-type", "review");
    expect(screen.getByText(activity.prompt)).toBeVisible();
    expect(screen.getByLabelText("Ваш ответ")).toHaveAttribute(
      "maxlength",
      "50000",
    );
    expect(screen.queryByText(executionId)).not.toBeInTheDocument();
    expect(
      screen.queryByText(activity.activitySnapshotHash),
    ).not.toBeInTheDocument();
  });

  it("rejects a blank response without making a submission", async () => {
    apiMock.mockResolvedValue({ activity });
    renderActivity();

    fireEvent.change(await screen.findByLabelText("Ваш ответ"), {
      target: { value: "   " },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Завершить повторение" }),
    );

    expect(screen.getByRole("alert", { name: "" })).toHaveTextContent(
      "Напишите ответ перед отправкой.",
    );
    expect(apiMock).toHaveBeenCalledTimes(1);
  });

  it("reuses an operation ID for an unchanged failed retry and replaces it after an edit", async () => {
    apiMock
      .mockResolvedValueOnce({ activity })
      .mockRejectedValueOnce(new Error("uncertain outcome"))
      .mockRejectedValueOnce(new Error("same retry failed"))
      .mockRejectedValueOnce(new Error("edited retry failed"));
    renderActivity();
    const response = await screen.findByLabelText("Ваш ответ");

    fireEvent.change(response, { target: { value: "  My answer  " } });
    fireEvent.click(
      screen.getByRole("button", { name: "Завершить повторение" }),
    );
    expect(
      await screen.findByText("Не удалось завершить повторение."),
    ).toBeVisible();
    expect(response).toHaveValue("  My answer  ");

    fireEvent.click(
      screen.getByRole("button", { name: "Завершить повторение" }),
    );
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(3));

    fireEvent.change(response, { target: { value: "My edited answer" } });
    fireEvent.click(
      screen.getByRole("button", { name: "Завершить повторение" }),
    );
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(4));

    const submissionBodies = apiMock.mock.calls
      .slice(1)
      .map((call) => JSON.parse((call[1] as RequestInit).body as string));
    expect(submissionBodies[0]).toEqual({
      operationId: "review-operation-1",
      executionContextHash: activity.executionContextHash,
      response: { type: "free-response", text: "My answer" },
    });
    expect(submissionBodies[1]).toEqual(submissionBodies[0]);
    expect(submissionBodies[2]).toEqual({
      operationId: "review-operation-2",
      executionContextHash: activity.executionContextHash,
      response: { type: "free-response", text: "My edited answer" },
    });
  });

  it("accepts an idempotent success, invalidates the queue, and leaves the activity", async () => {
    apiMock.mockResolvedValueOnce({ activity }).mockResolvedValueOnce({
      idempotent: true,
      completedReviewItemId: "review-completed",
      completionEvidenceId: "evidence-completed",
      nextReview: {
        id: "review-next",
        dueAt: "2026-01-09T00:00:00.000Z",
      },
    });
    const onComplete = vi.fn();
    const { invalidateSpy } = renderActivity({ onComplete });

    fireEvent.change(await screen.findByLabelText("Ваш ответ"), {
      target: { value: "My answer" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Завершить повторение" }),
    );

    await waitFor(() =>
      expect(onComplete).toHaveBeenCalledWith("2026-01-09T00:00:00.000Z"),
    );
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["learning-reviews"],
    });
    expect(apiMock).toHaveBeenLastCalledWith(
      "/learning/reviews/executions/execution%2Fwith-path/submissions",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("offers a safe return when the exact execution cannot load", async () => {
    apiMock.mockRejectedValue(new Error("stale execution"));
    const onExit = vi.fn();
    renderActivity({ onExit });

    expect(
      await screen.findByRole("heading", {
        name: "Активность повторения недоступна",
      }),
    ).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "Вернуться к очереди" }),
    );
    expect(onExit).toHaveBeenCalledOnce();
  });
});
