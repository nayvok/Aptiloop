"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import {
  ArticleIcon,
  BrainIcon,
  CardsIcon,
  CodeIcon,
  GearSixIcon,
  HouseIcon,
  MoonIcon,
  PathIcon,
  SunIcon,
  TargetIcon,
} from "@phosphor-icons/react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ProviderHealth } from "@/components/provider-health";

const nav = [
  { href: "/", label: "Путь", icon: HouseIcon },
  { href: "/session", label: "Занятие", icon: PathIcon },
  { href: "/exercise", label: "Практика", icon: CodeIcon },
  { href: "/knowledge", label: "Карта знаний", icon: BrainIcon },
  { href: "/mistakes", label: "Ошибки", icon: ArticleIcon },
  { href: "/interview", label: "Интервью", icon: TargetIcon },
  { href: "/flashcards", label: "Карточки", icon: CardsIcon },
] as const;

const titles: Record<string, string> = Object.fromEntries(
  [
    ...nav,
    { href: "/settings", label: "Настройки" },
    {
      href: "/settings/developer-tools",
      label: "Инструменты разработчика",
    },
    { href: "/chat", label: "Agent Playground" },
  ].map((item) => [item.href, item.label]),
);

const settingsNav = [
  { href: "/settings", label: "Настройки" },
  {
    href: "/settings/developer-tools",
    label: "Инструменты разработчика",
  },
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  const [themeMounted, setThemeMounted] = useState(false);
  const title = titles[pathname] ?? "Dev Learning Harness";
  const visibleTheme = themeMounted ? theme : "system";
  const nextTheme =
    visibleTheme === "system"
      ? "light"
      : visibleTheme === "light"
        ? "dark"
        : "system";
  const mobileSettings =
    pathname === "/settings/developer-tools"
      ? {
          href: "/settings/developer-tools",
          label: "Dev tools",
          icon: GearSixIcon,
        }
      : { href: "/settings", label: "Настройки", icon: GearSixIcon };

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
        К основному содержимому
      </a>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-border bg-sidebar md:flex md:flex-col">
        <div className="flex h-16 items-center gap-3 border-b border-border px-5">
          <div className="grid size-8 place-items-center rounded-md bg-primary text-sm font-bold text-primary-foreground">
            DL
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">
              Dev Learning Harness
            </p>
            <p className="text-xs text-muted-foreground">
              Неделя 01 · фундамент
            </p>
          </div>
        </div>
        <nav
          aria-label="Основная навигация"
          className="flex flex-1 flex-col gap-1 p-3"
        >
          {nav.map((item) => {
            const active =
              item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                data-slot="sidebar-link"
                data-active={active}
                href={item.href}
                aria-current={pathname === item.href ? "page" : undefined}
                className={cn(
                  "flex min-h-11 items-center gap-3 rounded-md px-3 text-sm text-muted-foreground outline-none transition-colors duration-200 hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
                  active && "bg-accent font-medium text-accent-foreground",
                )}
              >
                <item.icon
                  aria-hidden
                  className="size-4.5 shrink-0"
                  weight={active ? "fill" : "regular"}
                />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-border p-3">
          {settingsNav.map((item, index) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-11 items-center gap-3 rounded-md px-3 text-sm text-muted-foreground outline-none transition-colors duration-200 hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
                  index === 1 && "pl-10 text-xs",
                  active && "bg-accent font-medium text-accent-foreground",
                )}
              >
                {index === 0 ? (
                  <GearSixIcon aria-hidden className="size-4.5" />
                ) : null}
                {item.label}
              </Link>
            );
          })}
        </div>
      </aside>

      <div className="md:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-4 border-b border-border bg-background/95 px-4 backdrop-blur md:px-6">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">
              Рабочая область / {title}
            </p>
            <h1 className="truncate text-base font-semibold">{title}</h1>
          </div>
          <div className="flex items-center gap-2">
            <ProviderHealth />
            <Button
              aria-label="Переключить тему"
              title={`Тема: ${visibleTheme === "dark" ? "тёмная" : visibleTheme === "light" ? "светлая" : "системная"}`}
              variant="ghost"
              size="icon"
              onClick={() => setTheme(nextTheme)}
            >
              <SunIcon aria-hidden className="hidden dark:block" />
              <MoonIcon aria-hidden className="block dark:hidden" />
            </Button>
          </div>
        </header>

        <nav
          aria-label="Мобильная навигация"
          className="grid grid-cols-4 gap-1 border-b border-border bg-sidebar p-2 md:hidden"
        >
          {[...nav, mobileSettings].map((item) => {
            const active = pathname === item.href;
            return (
              <Button
                key={item.href}
                asChild
                variant={active ? "secondary" : "ghost"}
                size="sm"
                className="h-auto min-h-11 min-w-0 whitespace-normal px-1 py-1.5 text-center text-[0.6875rem] leading-4"
              >
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className="flex-col gap-0.5"
                >
                  <item.icon aria-hidden className="size-4" />
                  <span className="line-clamp-2">{item.label}</span>
                </Link>
              </Button>
            );
          })}
        </nav>

        <main
          id="main-content"
          tabIndex={-1}
          className="mx-auto w-full max-w-[1440px] p-4 outline-none md:p-6 lg:p-8"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
