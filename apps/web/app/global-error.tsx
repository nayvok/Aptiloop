"use client";

import { useEffect, useState } from "react";

import { RouteErrorBoundary } from "@/components/app-route-boundary";
import {
  isUiLocale,
  LocaleProvider,
  type UiLocale,
  uiLocaleStorageKey,
} from "@/lib/i18n";

type ThemePreference = "light" | "dark" | "system";
export type GlobalErrorTheme = Exclude<ThemePreference, "system">;

function isThemePreference(value: unknown): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

export function resolveGlobalErrorLocale(): UiLocale {
  if (typeof window === "undefined") return "en-US";
  try {
    const stored = window.localStorage.getItem(uiLocaleStorageKey);
    if (isUiLocale(stored)) return stored;
  } catch {
    // The cookie mirror and browser language remain safe fallbacks.
  }

  const prefix = "aptiloop.ui-locale=";
  for (const part of document.cookie.split(";")) {
    const candidate = part.trim();
    if (!candidate.startsWith(prefix)) continue;
    const value = candidate.slice(prefix.length);
    if (isUiLocale(value)) return value;
    break;
  }

  return /^ru(?:-|$)/iu.test(window.navigator.language) ? "ru-RU" : "en-US";
}

export function resolveGlobalErrorTheme(): GlobalErrorTheme {
  if (typeof window === "undefined") return "light";

  let preference: ThemePreference = "system";
  try {
    const stored = window.localStorage.getItem("theme");
    if (isThemePreference(stored)) preference = stored;
  } catch {
    // A blocked preference store falls back to the operating-system theme.
  }

  if (preference !== "system") return preference;
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  } catch {
    return "light";
  }
}

export default function GlobalError({
  error,
  reset,
}: Readonly<{
  error: Error & { digest?: string };
  reset: () => void;
}>) {
  const [locale, setLocale] = useState<UiLocale>("en-US");
  const [theme, setTheme] = useState<GlobalErrorTheme>("light");

  useEffect(() => {
    const nextLocale = resolveGlobalErrorLocale();
    const nextTheme = resolveGlobalErrorTheme();
    setLocale(nextLocale);
    setTheme(nextTheme);
    document.documentElement.lang = nextLocale;
    document.documentElement.classList.toggle("dark", nextTheme === "dark");
  }, []);

  return (
    <html
      lang={locale}
      className={theme === "dark" ? "dark" : undefined}
      suppressHydrationWarning
    >
      <head>
        <title>Aptiloop</title>
      </head>
      <body className="min-h-dvh bg-background px-4 py-8 text-foreground sm:px-6 sm:py-10">
        <LocaleProvider initialLocale={locale} syncSettings={false}>
          <main id="main-content" tabIndex={-1} className="outline-none">
            <RouteErrorBoundary error={error} reset={reset} />
          </main>
        </LocaleProvider>
      </body>
    </html>
  );
}
