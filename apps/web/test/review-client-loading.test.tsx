import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ReviewClient } from "@/components/review-client";
import { LocaleProvider } from "@/lib/i18n";

const { suspendedInterview } = vi.hoisted(() => ({
  suspendedInterview: Promise.withResolvers<never>().promise,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/review",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams("view=interviews"),
}));

vi.mock("@/components/flashcards-client", () => ({
  ReviewQueueClient: () => null,
}));
vi.mock("@/components/mistakes-client", () => ({
  MistakesClient: () => null,
}));
vi.mock("@/components/interview-client", () => ({
  InterviewClient: () => {
    throw suspendedInterview;
  },
}));

afterEach(() => cleanup());

describe("Review loading policy", () => {
  it("keeps one destination navigation and uses one panel loader for an embedded Interview", () => {
    const { container } = render(
      <LocaleProvider initialLocale="en-US" syncSettings={false}>
        <ReviewClient />
      </LocaleProvider>,
    );

    expect(
      container.querySelectorAll('[data-slot="review-destination-navigation"]'),
    ).toHaveLength(1);
    expect(screen.getAllByRole("navigation", { name: "Review" })).toHaveLength(
      1,
    );
    expect(
      screen.getByRole("status", { name: "Loading interview…" }),
    ).toHaveAttribute("data-variant", "panel");
    expect(
      container.querySelectorAll('[data-slot="loading-state"]'),
    ).toHaveLength(1);
    expect(
      container.querySelector('[data-slot="review-loading-state"]'),
    ).not.toBeInTheDocument();
    expect(
      container.querySelector('[data-slot="skeleton"]'),
    ).not.toBeInTheDocument();
  });
});
