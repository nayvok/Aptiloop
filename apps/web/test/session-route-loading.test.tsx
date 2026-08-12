import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import SessionPage from "@/app/session/page";
import { LocaleProvider } from "@/lib/i18n";

const { suspendedSession } = vi.hoisted(() => ({
  suspendedSession: Promise.withResolvers<never>().promise,
}));

vi.mock("@/components/session-client", () => ({
  SessionClient: () => {
    throw suspendedSession;
  },
}));

afterEach(() => cleanup());

describe("Session route loading policy", () => {
  it("keeps route orientation without adding a second viewport-height child", () => {
    const { container } = render(
      <LocaleProvider initialLocale="en-US" syncSettings={false}>
        <SessionPage />
      </LocaleProvider>,
    );

    const orientation = container.querySelector(
      '[data-slot="session-route-loading"]',
    );
    const loader = screen.getByRole("status", { name: "Loading lesson…" });
    expect(orientation).toHaveClass("px-4", "py-8", "sm:py-10");
    expect(loader).toHaveAttribute("data-variant", "page");
    expect(loader).toHaveClass("min-h-[18rem]", "sm:min-h-[22rem]");
    expect(loader).not.toHaveClass(
      "min-h-[calc(100dvh-var(--shell-bar-size,4.5rem))]",
    );
  });
});
