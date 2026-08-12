import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { LoadingState } from "@/components/ui/loading-state";
import { LocaleProvider, type UiLocale } from "@/lib/i18n";

function renderLoadingState(
  locale: UiLocale,
  props: React.ComponentProps<typeof LoadingState>,
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <LocaleProvider initialLocale={locale} syncSettings={false}>
        <LoadingState {...props} />
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => cleanup());

describe("LoadingState", () => {
  it("announces a localized page load without exposing decorative motion", () => {
    const { container } = renderLoadingState("en-US", {
      label: "session.loading",
    });

    const status = screen.getByRole("status", { name: "Loading lesson…" });
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveAttribute("aria-atomic", "true");
    expect(status).toHaveAttribute("data-variant", "page");
    expect(status).toHaveTextContent("Loading lesson…");

    const spinner = container.querySelector('[data-slot="spinner"]');
    expect(spinner).toHaveAttribute("aria-hidden", "true");
    expect(spinner).toHaveClass("animate-spin", "motion-reduce:animate-none");
  });

  it("supports a compact Russian panel state", () => {
    renderLoadingState("ru-RU", {
      label: "interview.loading",
      variant: "panel",
    });

    expect(
      screen.getByRole("status", { name: "Загружаю интервью…" }),
    ).toHaveAttribute("data-variant", "panel");
  });
});
