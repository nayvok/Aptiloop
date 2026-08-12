"use client";

import {
  ArrowCounterClockwiseIcon,
  BooksIcon,
  ChartLineUpIcon,
  DesktopIcon,
  GearSixIcon,
  HouseIcon,
  MoonIcon,
  SidebarSimpleIcon,
  SunIcon,
} from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useTheme } from "next-themes";
import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useState,
} from "react";

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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { type MessageKey, useI18n } from "@/lib/i18n";
import {
  type PrimaryRouteHref,
  type RouteContext,
  resolveRouteContext,
} from "@/lib/route-context";
import { resolveRouteTitleKey } from "@/lib/route-title";
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
const sidebarCookieKey = "aptiloop.sidebar-collapsed";

function mirrorSidebarPreference(collapsed: boolean) {
  try {
    document.documentElement.dataset.sidebarCollapsed = String(collapsed);
    document.cookie = `${sidebarCookieKey}=${String(collapsed)}; Path=/; Max-Age=31536000; SameSite=Strict`;
  } catch {
    // Cookie restrictions should not prevent the in-memory preference.
  }
}

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
      aria-label={label}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex h-12 w-full items-center overflow-hidden rounded-control text-base font-normal text-muted-foreground outline-none transition-colors duration-150 hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar motion-reduce:transition-none",
        collapsed ? "w-12 self-center justify-center gap-0 px-0" : "gap-3 px-2",
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
      <span data-slot="sidebar-link-label" className="min-w-0 truncate">
        {label}
      </span>
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

function SidebarBrand({ collapsed }: { collapsed: boolean }) {
  const { t } = useI18n();
  const label = `${t("brand.name")} · ${t("nav.home")}`;
  return (
    <Link
      href="/"
      aria-label={label}
      data-slot="sidebar-brand"
      className={cn(
        "flex h-12 items-center rounded-control text-xl font-semibold tracking-[-0.025em] outline-none transition-colors hover:bg-accent/70 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar",
        collapsed ? "w-12 justify-center px-0" : "min-w-0 flex-1 gap-2.5 px-1",
      )}
    >
      <AptiloopMark className="size-9 text-primary" />
      <span data-slot="sidebar-brand-label" className="truncate">
        {t("brand.name")}
      </span>
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
      className="size-11 shrink-0 rounded-control text-muted-foreground shadow-none hover:text-foreground"
      onClick={onClick}
    >
      <SidebarSimpleIcon weight={collapsed ? "regular" : "fill"} />
    </Button>
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={8}>
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

export function AppShell({
  children,
  initialSidebarCollapsed = false,
}: {
  children: React.ReactNode;
  initialSidebarCollapsed?: boolean;
}) {
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
  const immersiveSession = pathname === "/session";
  const { resolvedTheme, theme, setTheme } = useTheme();
  const { t } = useI18n();
  const routeTitleKey = resolveRouteTitleKey(pathname, searchParams);
  const documentTitle = routeTitleKey
    ? `${t(routeTitleKey)} · ${t("brand.name")}`
    : t("brand.name");
  const [themeMounted, setThemeMounted] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    initialSidebarCollapsed,
  );
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
      const stored = window.localStorage.getItem(sidebarStorageKey);
      if (stored === "true" || stored === "false") {
        const storedCollapsed = stored === "true";
        setSidebarCollapsed(storedCollapsed);
        mirrorSidebarPreference(storedCollapsed);
      }
    } catch {
      // A blocked storage API should not prevent shell navigation.
    }
  }, []);

  useEffect(() => {
    const synchronizeSidebar = (event: StorageEvent) => {
      if (event.key !== sidebarStorageKey) return;
      const nextCollapsed = event.newValue === "true";
      setSidebarCollapsed(nextCollapsed);
      mirrorSidebarPreference(nextCollapsed);
    };

    window.addEventListener("storage", synchronizeSidebar);
    return () => window.removeEventListener("storage", synchronizeSidebar);
  }, []);

  useEffect(() => {
    if (resolvedTheme !== "light" && resolvedTheme !== "dark") return;
    const color = resolvedTheme === "dark" ? "#0f1013" : "#fcfcfd";
    for (const meta of document.querySelectorAll<HTMLMetaElement>(
      'meta[name="theme-color"]',
    )) {
      meta.content = color;
    }
  }, [pathname, resolvedTheme]);

  const toggleSidebar = () => {
    setSidebarCollapsed((current) => {
      const nextCollapsed = !current;
      try {
        window.localStorage.setItem(sidebarStorageKey, String(nextCollapsed));
      } catch {
        // Keep the in-memory preference when storage is unavailable.
      }
      mirrorSidebarPreference(nextCollapsed);
      return nextCollapsed;
    });
  };

  const changeTheme = () => {
    setTheme(nextTheme);
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
      <title>{documentTitle}</title>
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
            sidebarCollapsed
              ? "w-[var(--shell-rail-collapsed)]"
              : "w-[var(--shell-rail-expanded)]",
          )}
        >
          <header
            data-slot="sidebar-header"
            className={cn(
              "flex h-[var(--shell-bar-size)] shrink-0 items-center border-b border-border/60",
              sidebarCollapsed ? "justify-center px-3" : "justify-start px-4",
            )}
          >
            <SidebarBrand collapsed={sidebarCollapsed} />
          </header>

          <nav
            id="desktop-sidebar-navigation"
            aria-label={t("a11y.primaryNavigation")}
            className="flex min-h-0 flex-1 flex-col px-3 py-4"
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
          data-slot="shell-content"
          className={cn(
            "transition-[padding] duration-150 motion-reduce:transition-none",
            sidebarCollapsed
              ? "md:pl-[var(--shell-rail-collapsed)]"
              : "md:pl-[var(--shell-rail-expanded)]",
          )}
        >
          <header
            data-slot="utility-header"
            className="sticky top-0 z-20 h-[var(--shell-bar-size)] border-b border-border/70 bg-background"
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
                <div
                  data-slot="desktop-sidebar-toggle"
                  className="hidden md:block"
                >
                  <SidebarToggle
                    collapsed={sidebarCollapsed}
                    label={collapseLabel}
                    onClick={toggleSidebar}
                  />
                </div>
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
                      onClick={changeTheme}
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
            className={cn(
              "w-full pb-28 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
              immersiveSession
                ? "min-h-[calc(100dvh-var(--shell-bar-size))] px-0 pt-0 md:pb-0"
                : "mx-auto max-w-[1440px] px-4 py-8 sm:px-7 sm:py-10 md:pb-12 lg:px-11 lg:py-8",
            )}
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
