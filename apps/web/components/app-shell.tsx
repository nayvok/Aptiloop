"use client";

import {
  ArrowCounterClockwiseIcon,
  BooksIcon,
  CaretLeftIcon,
  CaretRightIcon,
  ChartLineUpIcon,
  DesktopIcon,
  GearSixIcon,
  HouseIcon,
  MoonIcon,
  SunIcon,
} from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useTheme } from "next-themes";
import { Fragment, useCallback, useLayoutEffect, useState } from "react";
import { toast } from "sonner";

import { ProviderHealth } from "@/components/provider-health";
import {
  PageRouteContextProvider,
  type PageRouteContextRegistration,
} from "@/components/page-route-context";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { type MessageKey, useI18n } from "@/lib/i18n";
import { api } from "@/lib/api";
import {
  type PrimaryRouteHref,
  type RouteContext,
  resolveRouteContext,
} from "@/lib/route-context";
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
  href: PrimaryRouteHref;
  label: MessageKey;
  icon: typeof HouseIcon;
}>;

type NavItem = (typeof nav)[number];

const desktopPrimaryNav = nav.slice(0, -1);
const settingsNavItem = nav[4];
const sidebarStorageKey = "aptiloop:sidebar-collapsed";

function AptiloopMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      data-slot="aptiloop-mark"
      className={cn(
        "grid shrink-0 place-items-center text-foreground",
        className,
      )}
    >
      <svg viewBox="0 0 40 40" className="size-[86%]" fill="none">
        <path
          d="M7.4 29.9 17.8 10.8a2.5 2.5 0 0 1 4.4 0l10.4 19.1a2.45 2.45 0 0 1-3.35 3.3l-7.3-4.25"
          stroke="currentColor"
          strokeWidth="2.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="m21.95 28.95-8.45 4.9a4.05 4.05 0 0 1-6.1-3.95"
          stroke="currentColor"
          strokeWidth="2.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

function SidebarLink({
  item,
  label,
  active,
  collapsed,
}: {
  item: NavItem;
  label: string;
  active: boolean;
  collapsed: boolean;
}) {
  const Icon = item.icon;
  const link = (
    <Link
      data-slot="sidebar-link"
      data-active={active}
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex h-14 w-full items-center gap-3 overflow-hidden rounded-control px-2 text-base font-normal text-muted-foreground outline-none transition-colors duration-150 hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar motion-reduce:transition-none",
        active && "bg-accent text-foreground",
      )}
    >
      {active ? (
        <span
          aria-hidden
          data-slot="sidebar-active-indicator"
          className="absolute inset-y-2 left-0 w-[3px] rounded-r-full bg-primary"
        />
      ) : null}
      <span
        aria-hidden
        data-slot="sidebar-icon-column"
        className="grid size-8 shrink-0 place-items-center"
      >
        <Icon className="size-5" weight="regular" />
      </span>
      {collapsed ? (
        <span className="sr-only">{label}</span>
      ) : (
        <span className="min-w-0 truncate">{label}</span>
      )}
    </Link>
  );

  if (!collapsed) return link;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right" sideOffset={10}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

function SidebarBrand() {
  const { t } = useI18n();
  const label = `${t("brand.name")} · ${t("nav.home")}`;
  return (
    <Link
      href="/"
      aria-label={label}
      className="flex h-12 min-w-0 flex-1 items-center gap-3 rounded-control px-1 text-xl font-semibold tracking-[-0.025em] outline-none transition-colors hover:bg-accent/70 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar"
    >
      <AptiloopMark className="size-10 text-primary" />
      <span className="truncate">{t("brand.name")}</span>
    </Link>
  );
}

function SidebarToggle({
  collapsed,
  label,
  onClick,
}: {
  collapsed: boolean;
  label: string;
  onClick: () => void;
}) {
  const button = (
    <Button
      type="button"
      aria-controls="desktop-sidebar-navigation"
      aria-expanded={!collapsed}
      aria-label={label}
      variant="ghost"
      size="icon"
      className="size-11 shrink-0 rounded-control text-muted-foreground shadow-none hover:text-foreground md:size-11"
      onClick={onClick}
    >
      {collapsed ? <CaretRightIcon /> : <CaretLeftIcon />}
    </Button>
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="right" sideOffset={10}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

function RouteBreadcrumbs({ context }: { context: RouteContext }) {
  const { t } = useI18n();

  return (
    <Breadcrumb
      aria-label={t("a11y.breadcrumbs")}
      className="min-w-0 text-base"
    >
      <BreadcrumbList className="min-w-0 flex-nowrap">
        {context.breadcrumbs.map((breadcrumb, index) => {
          const current = index === context.breadcrumbs.length - 1;
          const content =
            breadcrumb.text === undefined
              ? t(breadcrumb.label)
              : breadcrumb.text;
          return (
            <Fragment key={`${breadcrumb.href ?? "current"}:${content}`}>
              {index > 0 ? <BreadcrumbSeparator /> : null}
              <BreadcrumbItem className="min-w-0">
                {current ? (
                  <BreadcrumbPage className="truncate font-medium text-foreground">
                    {content}
                  </BreadcrumbPage>
                ) : (
                  <BreadcrumbLink asChild>
                    <Link
                      className="inline-flex min-h-11 min-w-0 items-center truncate rounded-control px-1 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                      href={breadcrumb.href ?? "/"}
                    >
                      {content}
                    </Link>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const routeKey = `${pathname}?${searchParams.toString()}`;
  const [pageRouteContext, setPageRouteContext] = useState<{
    routeKey: string;
    context: RouteContext;
  } | null>(null);
  const registerPageRouteContext = useCallback<PageRouteContextRegistration>(
    (registeredRouteKey, context) => {
      setPageRouteContext({ routeKey: registeredRouteKey, context });
      return () =>
        setPageRouteContext((current) =>
          current?.routeKey === registeredRouteKey ? null : current,
        );
    },
    [],
  );
  const routeContext =
    pageRouteContext?.routeKey === routeKey
      ? pageRouteContext.context
      : resolveRouteContext(pathname, searchParams);
  const queryClient = useQueryClient();
  const { theme, setTheme } = useTheme();
  const { t } = useI18n();
  const [themeMounted, setThemeMounted] = useState(false);
  const [themeSaving, setThemeSaving] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const visibleTheme =
    themeMounted &&
    (theme === "system" || theme === "light" || theme === "dark")
      ? theme
      : "system";
  const nextTheme =
    visibleTheme === "system"
      ? "light"
      : visibleTheme === "light"
        ? "dark"
        : "system";
  const translatedTheme = t(`shell.theme.${nextTheme}` as MessageKey);
  const currentTheme = t(`shell.theme.${visibleTheme}` as MessageKey);

  useLayoutEffect(() => {
    setThemeMounted(true);
    try {
      setSidebarCollapsed(
        window.localStorage.getItem(sidebarStorageKey) === "true",
      );
    } catch {
      // A blocked storage API should not prevent shell navigation.
    }
  }, []);

  const toggleSidebar = () => {
    setSidebarCollapsed((current) => {
      const nextCollapsed = !current;
      try {
        window.localStorage.setItem(sidebarStorageKey, String(nextCollapsed));
      } catch {
        // Keep the in-memory preference when storage is unavailable.
      }
      return nextCollapsed;
    });
  };

  const changeTheme = async () => {
    if (themeSaving) return;
    const previousTheme = visibleTheme;
    setThemeSaving(true);
    setTheme(nextTheme);
    try {
      await api<{ saved: true }>("/settings", {
        method: "PUT",
        body: JSON.stringify({ theme: nextTheme }),
      });
      await queryClient.invalidateQueries({
        queryKey: ["settings", "page"],
      });
    } catch (error) {
      setTheme(previousTheme);
      toast.error(
        error instanceof Error ? error.message : t("settings.saveError"),
      );
    } finally {
      setThemeSaving(false);
    }
  };

  const themeIcon =
    visibleTheme === "light" ? (
      <SunIcon aria-hidden />
    ) : visibleTheme === "dark" ? (
      <MoonIcon aria-hidden />
    ) : (
      <DesktopIcon aria-hidden />
    );
  const collapseLabel = t(
    sidebarCollapsed ? "shell.sidebar.expand" : "shell.sidebar.collapse",
  );
  const homeLabel = t("nav.home");

  return (
    <PageRouteContextProvider
      register={registerPageRouteContext}
      routeKey={routeKey}
    >
      <div
        data-slot="app-shell"
        data-sidebar-collapsed={sidebarCollapsed}
        className="min-h-dvh bg-background text-foreground"
      >
        <a
          href="#main-content"
          className="sr-only fixed top-3 left-3 z-50 rounded-control bg-primary px-4 py-3 text-sm font-medium text-primary-foreground outline-none focus:not-sr-only focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background"
        >
          {t("a11y.skipToContent")}
        </a>

        <aside
          data-slot="sidebar"
          data-state={sidebarCollapsed ? "collapsed" : "expanded"}
          className={cn(
            "fixed inset-y-0 left-0 z-30 hidden border-r border-border/70 bg-sidebar transition-[width] duration-150 motion-reduce:transition-none md:flex md:flex-col",
            sidebarCollapsed ? "w-[4.5rem]" : "w-[17.5rem]",
          )}
        >
          <header
            data-slot="sidebar-header"
            className={cn(
              "flex h-[5.75rem] shrink-0 items-center border-b border-border/60",
              sidebarCollapsed
                ? "justify-center px-3"
                : "justify-between gap-2 px-5",
            )}
          >
            {sidebarCollapsed ? null : <SidebarBrand />}
            <SidebarToggle
              collapsed={sidebarCollapsed}
              label={collapseLabel}
              onClick={toggleSidebar}
            />
          </header>

          <nav
            id="desktop-sidebar-navigation"
            aria-label={t("a11y.primaryNavigation")}
            className="flex min-h-0 flex-1 flex-col px-3 py-5"
          >
            <div
              data-slot="sidebar-primary-navigation"
              className="flex flex-col gap-1.5"
            >
              {desktopPrimaryNav.map((item) => (
                <SidebarLink
                  key={item.href}
                  item={item}
                  label={t(item.label)}
                  active={routeContext.sectionHref === item.href}
                  collapsed={sidebarCollapsed}
                />
              ))}
            </div>

            <Separator className="mx-1 mt-5" />

            <div
              data-slot="sidebar-lower-navigation"
              className="mt-auto flex flex-col gap-1.5"
            >
              <SidebarLink
                item={settingsNavItem}
                label={t(settingsNavItem.label)}
                active={routeContext.sectionHref === settingsNavItem.href}
                collapsed={sidebarCollapsed}
              />
            </div>
          </nav>
        </aside>

        <div
          className={cn(
            "transition-[padding] duration-150 motion-reduce:transition-none",
            sidebarCollapsed ? "md:pl-[4.5rem]" : "md:pl-[17.5rem]",
          )}
        >
          <header
            data-slot="utility-header"
            className="sticky top-0 z-20 h-[4.5rem] border-b border-border/70 bg-background md:h-[5.75rem]"
          >
            <div className="mx-auto flex h-full w-full max-w-[1440px] items-center justify-between gap-3 px-4 sm:px-7 lg:px-11">
              <div className="flex min-w-0 flex-1 items-center gap-2.5">
                <Link
                  href="/"
                  aria-label={`${t("brand.name")} · ${homeLabel}`}
                  className="grid size-11 shrink-0 place-items-center rounded-control outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background md:hidden"
                >
                  <AptiloopMark className="size-9 text-primary" />
                </Link>
                <RouteBreadcrumbs context={routeContext} />
              </div>

              <div
                data-slot="desktop-utilities"
                className="flex shrink-0 items-center gap-2"
              >
                <ProviderHealth compactOnMobile />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      aria-label={t("shell.theme.change", {
                        theme: translatedTheme,
                      })}
                      variant="outline"
                      size="icon"
                      className="size-11 rounded-control text-muted-foreground shadow-none hover:text-foreground md:size-11"
                      disabled={themeSaving}
                      aria-busy={themeSaving}
                      onClick={() => void changeTheme()}
                    >
                      {themeIcon}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" sideOffset={8}>
                    {t("shell.theme.current", { theme: currentTheme })}
                  </TooltipContent>
                </Tooltip>
              </div>
            </div>
          </header>

          <main
            id="main-content"
            tabIndex={-1}
            className="mx-auto w-full max-w-[1440px] px-4 py-8 pb-28 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-7 sm:py-10 md:pb-12 lg:px-11 lg:py-8"
          >
            {children}
          </main>
        </div>

        <nav
          data-slot="mobile-navigation"
          aria-label={t("a11y.mobileNavigation")}
          className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-border/70 bg-background/95 px-1 pt-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] backdrop-blur md:hidden"
        >
          {nav.map((item) => {
            const active = routeContext.sectionHref === item.href;
            return (
              <Link
                key={item.href}
                data-active={active}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex min-h-16 min-w-0 flex-col items-center justify-center gap-1 rounded-control px-0.5 py-1 text-center text-[0.625rem] leading-3 font-medium text-muted-foreground outline-none transition-colors duration-150 hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none min-[360px]:text-[0.6875rem]",
                  active && "bg-accent font-semibold text-foreground",
                )}
              >
                {active ? (
                  <span
                    aria-hidden
                    className="absolute top-0 h-0.5 w-6 rounded-full bg-primary"
                  />
                ) : null}
                <item.icon
                  aria-hidden
                  className="size-5 shrink-0"
                  weight={active ? "fill" : "regular"}
                />
                <span className="max-w-full">{t(item.label)}</span>
              </Link>
            );
          })}
        </nav>
      </div>
    </PageRouteContextProvider>
  );
}
