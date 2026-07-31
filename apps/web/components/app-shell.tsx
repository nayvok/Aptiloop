"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import {
  ArticleIcon,
  BrainIcon,
  CardsIcon,
  ChatCircleDotsIcon,
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
  { href: "/", label: "Обзор", icon: HouseIcon },
  { href: "/session", label: "Занятие", icon: PathIcon },
  { href: "/chat", label: "Агенты", icon: ChatCircleDotsIcon },
  { href: "/exercise", label: "Практика", icon: CodeIcon },
  { href: "/knowledge", label: "Карта знаний", icon: BrainIcon },
  { href: "/mistakes", label: "Ошибки", icon: ArticleIcon },
  { href: "/interview", label: "Интервью", icon: TargetIcon },
  { href: "/flashcards", label: "Карточки", icon: CardsIcon },
] as const;

const titles: Record<string, string> = Object.fromEntries(
  nav.map((item) => [item.href, item.label]),
);

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { resolvedTheme, setTheme } = useTheme();
  const title = titles[pathname] ?? "Dev Learning Harness";

  return (
    <div
      data-slot="app-shell"
      className="min-h-dvh bg-background text-foreground"
    >
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
                className={cn(
                  "flex min-h-10 items-center gap-3 rounded-md px-3 text-sm text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
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
          <Link
            href="/settings"
            className="flex min-h-10 items-center gap-3 rounded-md px-3 text-sm text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <GearSixIcon aria-hidden className="size-4.5" />
            Настройки
          </Link>
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
              variant="ghost"
              size="icon"
              onClick={() =>
                setTheme(resolvedTheme === "dark" ? "light" : "dark")
              }
            >
              <SunIcon aria-hidden className="hidden dark:block" />
              <MoonIcon aria-hidden className="block dark:hidden" />
            </Button>
          </div>
        </header>

        <nav
          aria-label="Мобильная навигация"
          className="flex gap-1 overflow-x-auto border-b border-border p-2 md:hidden"
        >
          {[
            ...nav,
            { href: "/settings", label: "Настройки", icon: GearSixIcon },
          ].map((item) => (
            <Button
              key={item.href}
              asChild
              variant={pathname === item.href ? "secondary" : "ghost"}
              size="sm"
              className="shrink-0"
            >
              <Link href={item.href}>
                <item.icon aria-hidden /> {item.label}
              </Link>
            </Button>
          ))}
        </nav>

        <main className="mx-auto w-full max-w-[1440px] p-4 md:p-6 lg:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
