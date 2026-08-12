import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ReviewClient } from "@/components/review-client";
import { LocaleProvider } from "@/lib/i18n";

const { pushMock, replaceMock, searchParamsRef } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  replaceMock: vi.fn(),
  searchParamsRef: { current: new URLSearchParams() },
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/review",
  useRouter: () => ({ push: pushMock, replace: replaceMock }),
  useSearchParams: () => searchParamsRef.current,
}));

vi.mock("@/components/flashcards-client", () => ({
  ReviewQueueClient: () => <div>Review queue</div>,
}));
vi.mock("@/components/mistakes-client", () => ({ MistakesClient: () => null }));
vi.mock("@/components/interview-client", () => ({
  InterviewClient: () => null,
}));
vi.mock("@/components/review-activity-client", () => ({
  ReviewActivityClient: ({
    executionId,
    onExit,
    onComplete,
  }: {
    executionId: string;
    onExit: () => void;
    onComplete: (nextDueAt: string) => void;
  }) => (
    <div>
      <p>Execution {executionId}</p>
      <button type="button" onClick={onExit}>
        Exit activity
      </button>
      <button type="button" onClick={() => onComplete("2026-01-09T00:00:00Z")}>
        Complete activity
      </button>
    </div>
  ),
}));

function renderReview() {
  return render(
    <LocaleProvider initialLocale="en-US" syncSettings={false}>
      <ReviewClient />
    </LocaleProvider>,
  );
}

beforeEach(() => {
  pushMock.mockReset();
  replaceMock.mockReset();
  searchParamsRef.current = new URLSearchParams();
});

afterEach(cleanup);

describe("Review item URL authority", () => {
  it("opens the one valid Due execution and removes only item when leaving", () => {
    searchParamsRef.current = new URLSearchParams(
      "item=execution%2Fwith-path&context=kept",
    );
    renderReview();

    expect(screen.getByText("Execution execution/with-path")).toBeVisible();
    expect(
      screen.queryByRole("navigation", { name: "Review" }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Exit activity" }));
    expect(pushMock).toHaveBeenCalledWith("/review?context=kept", {
      scroll: false,
    });
  });

  it("uses replacement navigation after completion", () => {
    searchParamsRef.current = new URLSearchParams(
      "item=execution-1&context=kept",
    );
    renderReview();

    fireEvent.click(screen.getByRole("button", { name: "Complete activity" }));
    expect(replaceMock).toHaveBeenCalledWith("/review?context=kept", {
      scroll: false,
    });
  });

  it("fails closed for duplicate item authority and preserves unrelated parameters", async () => {
    searchParamsRef.current = new URLSearchParams(
      "item=first&item=second&context=kept",
    );
    renderReview();

    expect(screen.getAllByText("Review queue").length).toBeGreaterThan(0);
    expect(screen.queryByText(/^Execution /u)).not.toBeInTheDocument();
    await waitFor(() =>
      expect(replaceMock).toHaveBeenCalledWith("/review?context=kept", {
        scroll: false,
      }),
    );
  });

  it("clears item when a non-Due destination is active", async () => {
    searchParamsRef.current = new URLSearchParams(
      "view=cards&item=execution-1&context=kept",
    );
    renderReview();

    expect(screen.queryByText(/^Execution /u)).not.toBeInTheDocument();
    await waitFor(() =>
      expect(replaceMock).toHaveBeenCalledWith(
        "/review?view=cards&context=kept",
        { scroll: false },
      ),
    );
  });
});
