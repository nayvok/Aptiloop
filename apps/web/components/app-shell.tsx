"use client";

import {
  ArrowCounterClockwiseIcon,
  BooksIcon,
  ChartLineUpIcon,
  GearSixIcon,
  HouseIcon,
  MoonIcon,
  SunIcon,
} from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

import { ProviderHealth } from "@/components/provider-health";
import { Button } from "@/components/ui/button";
import { type MessageKey, useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const nav = [
  { href: "/", label: "nav.home", icon: HouseIcon },
  { href: "/courses", label: "nav.courses", icon: BooksIcon },
  {
    href: "/review",
    label: "nav.review",
    icon: ArrowCounterClockwiseIcon,
  },
  { href: "/skills", label: "nav.skills", icon: ChartLineUpIcon },
  { href: "/settings", label: "nav.settings", icon: GearSixIcon },
] as const satisfies ReadonlyArray<{
  href: string;
  label: MessageKey;
  icon: typeof HouseIcon;
}>;

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

function currentLabel(pathname: string): MessageKey {
  if (pathname.startsWith("/courses")) return "nav.courses";
  if (
    pathname.startsWith("/review") ||
    pathname.startsWith("/mistakes") ||
    pathname.startsWith("/flashcards") ||
    pathname.startsWith("/interview")
  ) {
    return "nav.review";
  }
  if (pathname.startsWith("/skills") || pathname.startsWith("/knowledge")) {
    return "nav.skills";
  }
  if (pathname.startsWith("/settings") || pathname.startsWith("/chat")) {
    return "nav.settings";
  }
  return "nav.home";
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  const { t } = useI18n();
  const [themeMounted, setThemeMounted] = useState(false);
  const visibleTheme = themeMounted ? theme : "system";
  const nextTheme =
    visibleTheme === "system"
      ? "light"
      : visibleTheme === "light"
        ? "dark"
        : "system";
  const translatedTheme = t(`shell.theme.${nextTheme}` as MessageKey);

  useEffect(() => {
    setThemeMounted(true);
  }, []);

  return (
    <div
      data-slot="app-shell"
      className="min-h-dvh bg-background text-foreground"
    >
      <a
        href="#main-content"
        className="sr-only fixed left-3 top-3 z-50 rounded-md bg-primary px-4 py-3 text-sm font-medium text-primary-foreground outline-none focus:not-sr-only focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background"
      >
        {t("a11y.skipToContent")}
      </a>

      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 border-r border-border bg-sidebar md:flex md:flex-col">
        <div className="flex h-16 items-center gap-3 border-b border-border px-5">
          <div className="grid size-9 place-items-center rounded-lg border border-primary/25 bg-primary text-base font-semibold text-primary-foreground">
            A
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold tracking-[-0.01em]">
              {t("brand.name")}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {t("brand.tagline")}
            </p>
          </div>
        </div>
        <nav
          aria-label={t("a11y.primaryNavigation")}
          className="flex flex-1 flex-col gap-1 p-3"
        >
          {nav.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                data-slot="sidebar-link"
                data-active={active}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm text-muted-foreground outline-none transition-colors duration-200 hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
                  active && "bg-accent font-medium text-accent-foreground",
                )}
              >
                <item.icon
                  aria-hidden
                  className="size-[1.125rem] shrink-0"
                  weight={active ? "fill" : "regular"}
                />
                {t(item.label)}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-border px-5 py-4 text-xs leading-5 text-muted-foreground">
          <p>Core Alpha · local-first</p>
        </div>
      </aside>

      <div className="md:pl-60">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-4 border-b border-border bg-background/95 px-4 backdrop-blur md:px-6">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground md:hidden">
              {t("brand.name")}
            </p>
            <h1 className="truncate text-base font-semibold">
              {t(currentLabel(pathname))}
            </h1>
          </div>
          <div className="flex items-center gap-1.5">
            <ProviderHealth />
            <Button
              aria-label={t("shell.theme.change", {
                theme: translatedTheme,
              })}
              title={t("shell.theme.current", {
                theme: t(`shell.theme.${visibleTheme}` as MessageKey),
              })}
              variant="ghost"
              size="icon"
              onClick={() => setTheme(nextTheme)}
            >
              <SunIcon aria-hidden className="hidden dark:block" />
              <MoonIcon aria-hidden className="block dark:hidden" />
            </Button>
          </div>
        </header>

        <main
          id="main-content"
          tabIndex={-1}
          className="mx-auto w-full max-w-[1280px] p-4 pb-28 outline-none sm:p-6 sm:pb-28 lg:p-8 md:pb-8"
        >
          {children}
        </main>
      </div>

      <nav
        aria-label={t("a11y.mobileNavigation")}
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-border bg-sidebar/98 px-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] pt-1 backdrop-blur md:hidden"
      >
        {nav.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-h-14 min-w-0 flex-col items-center justify-center gap-0.5 rounded-md px-1 py-1 text-center text-[0.6875rem] leading-4 text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                active && "bg-accent font-medium text-accent-foreground",
              )}
            >
              <item.icon
                aria-hidden
                className="size-5"
                weight={active ? "fill" : "regular"}
              />
              <span className="truncate text-xs">{t(item.label)}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
