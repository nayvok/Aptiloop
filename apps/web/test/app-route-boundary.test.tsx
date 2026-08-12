import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  RouteErrorBoundary,
  RouteNotFoundBoundary,
} from "@/components/app-route-boundary";
import GlobalError, {
  resolveGlobalErrorLocale,
  resolveGlobalErrorTheme,
} from "@/app/global-error";
import { LocaleProvider, type UiLocale } from "@/lib/i18n";

const back = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ back }),
}));

function renderBoundary(locale: UiLocale, children: ReactNode) {
  return render(
    <LocaleProvider initialLocale={locale} syncSettings={false}>
      {children}
    </LocaleProvider>,
  );
}

afterEach(() => {
  cleanup();
  back.mockReset();
  window.localStorage.clear();
  document.cookie = "aptiloop.ui-locale=; Path=/; Max-Age=0";
  document.documentElement.classList.remove("dark");
  document.documentElement.lang = "en-US";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("App Router recovery boundaries", () => {
  it("prefers the saved UI locale over the operating-system language", () => {
    vi.spyOn(window.navigator, "language", "get").mockReturnValue("en-US");
    window.localStorage.setItem("aptiloop:ui-locale", "ru-RU");
    document.cookie = "aptiloop.ui-locale=en-US; Path=/";

    expect(resolveGlobalErrorLocale()).toBe("ru-RU");
  });

  it("falls back from blocked storage to the validated locale cookie", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Storage blocked", "SecurityError");
    });
    vi.spyOn(window.navigator, "language", "get").mockReturnValue("en-US");
    document.cookie = "aptiloop.ui-locale=ru-RU; Path=/";

    expect(resolveGlobalErrorLocale()).toBe("ru-RU");
  });

  it("applies a saved dark theme to the global recovery shell", () => {
    window.localStorage.setItem("theme", "dark");
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: false }) as MediaQueryList),
    );

    expect(resolveGlobalErrorTheme()).toBe("dark");
  });

  it("resolves a saved system theme through the dark media preference", () => {
    window.localStorage.setItem("theme", "system");
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true }) as MediaQueryList),
    );

    expect(resolveGlobalErrorTheme()).toBe("dark");
  });

  it("hydrates deterministic recovery markup before applying saved preferences", async () => {
    window.localStorage.setItem("aptiloop:ui-locale", "ru-RU");
    window.localStorage.setItem("theme", "dark");
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: false }) as MediaQueryList),
    );
    const error = Object.assign(new Error("boom"), { digest: "next_42" });
    const reset = vi.fn();
    const recovery = <GlobalError error={error} reset={reset} />;

    const serverMarkup = renderToString(recovery);
    expect(serverMarkup).toContain('<html lang="en-US"');
    expect(serverMarkup).not.toContain('class="dark"');
    expect(serverMarkup).toContain("This page could not be shown");

    const serverDocument = new DOMParser().parseFromString(
      `<!doctype html>${serverMarkup}`,
      "text/html",
    );
    const recoverableErrors: unknown[] = [];
    let root: ReturnType<typeof hydrateRoot> | undefined;

    await act(async () => {
      root = hydrateRoot(serverDocument, recovery, {
        onRecoverableError: (hydrationError) => {
          recoverableErrors.push(hydrationError);
        },
      });
    });

    expect(recoverableErrors).toEqual([]);
    expect(serverDocument.documentElement.getAttribute("lang")).toBe("ru-RU");
    expect(serverDocument.documentElement.classList.contains("dark")).toBe(
      true,
    );
    expect(serverDocument.body.textContent).toContain(
      "Не удалось показать эту страницу",
    );

    await act(async () => root?.unmount());
  });

  it("keeps unexpected error recovery localized without exposing an exception message", () => {
    const reset = vi.fn();
    renderBoundary(
      "en-US",
      <RouteErrorBoundary
        error={Object.assign(new Error("secret=do-not-render"), {
          digest: "next_42",
        })}
        reset={reset}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "This page could not be shown" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Try again" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Go to Home" })).toHaveAttribute(
      "href",
      "/",
    );
    expect(screen.queryByText("secret=do-not-render")).not.toBeInTheDocument();
    expect(screen.getByText("Error reference: next_42")).toBeInTheDocument();
    expect(
      screen.getByText("Technical details").closest("details"),
    ).not.toHaveAttribute("open");

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    fireEvent.click(screen.getByRole("button", { name: "Go back" }));
    expect(reset).toHaveBeenCalledOnce();
    expect(back).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByText("Technical details"));
    expect(screen.getByText("Error reference: next_42")).toBeVisible();
  });

  it("does not disclose an unsafe digest and localizes the missing-route recovery", () => {
    renderBoundary(
      "ru-RU",
      <>
        <RouteErrorBoundary
          error={Object.assign(new Error("secret=do-not-render"), {
            digest: "digest with unsafe spaces",
          })}
          reset={vi.fn()}
        />
        <RouteNotFoundBoundary />
      </>,
    );

    expect(screen.queryByText(/secret=do-not-render/u)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Технические подробности" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Эта страница недоступна" }),
    ).toBeVisible();
    expect(screen.getAllByRole("button", { name: "Назад" })).toHaveLength(2);
    for (const link of screen.getAllByRole("link", { name: "На главную" })) {
      expect(link).toHaveAttribute("href", "/");
    }
  });
});
