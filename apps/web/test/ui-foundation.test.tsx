import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppShell } from "@/components/app-shell";
import { usePageRouteContext } from "@/components/page-route-context";
import { KnowledgeClient } from "@/components/knowledge-client";
import { PageHeader } from "@/components/page-header";
import { ProviderHealth } from "@/components/provider-health";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LocaleProvider } from "@/lib/i18n";
import { type RouteContext, resolveRouteContext } from "@/lib/route-context";

const { apiMock, pathnameState, setThemeMock } = vi.hoisted(() => ({
  apiMock: vi.fn(),
  pathnameState: { value: "/" },
  setThemeMock: vi.fn(),
}));

vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("next/navigation", () => ({
  usePathname: () => pathnameState.value,
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next-themes", () => ({
  useTheme: () => ({
    theme: "system",
    resolvedTheme: "light",
    setTheme: setThemeMock,
  }),
}));

function renderWithQuery(children: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <LocaleProvider initialLocale="ru-RU" syncSettings={false}>
        <TooltipProvider delayDuration={0}>{children}</TooltipProvider>
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

const entityLessonContext: RouteContext = {
  sectionHref: "/courses",
  breadcrumbs: [
    { href: "/courses", label: "nav.courses" },
    {
      href: "/courses/course-a/revisions/revision-a",
      text: "Deterministic Learning",
    },
    { text: "Урок 1 · Replay from facts" },
  ],
};

function EntityLessonFixture() {
  usePageRouteContext(entityLessonContext);
  return <p>Занятие</p>;
}

beforeEach(() => {
  apiMock.mockReset();
  setThemeMock.mockReset();
  pathnameState.value = "/";
  window.localStorage.clear();
  document.cookie =
    "aptiloop.sidebar-collapsed=; Path=/; Max-Age=0; SameSite=Strict";
  delete document.documentElement.dataset.sidebarCollapsed;
  delete document.documentElement.dataset.sidebarHydrated;
});

afterEach(cleanup);

describe("UI foundation", () => {
  it("renders the Textarea primitive with its slot and disabled state", () => {
    render(
      <label>
        Сообщение
        <Textarea disabled />
      </label>,
    );

    const textarea = screen.getByLabelText("Сообщение");
    expect(textarea).toHaveAttribute("data-slot", "textarea");
    expect(textarea).toBeDisabled();
  });

  it("exposes a skip target and the product IA without Agents in primary navigation", async () => {
    apiMock.mockResolvedValue({ providers: [] });

    renderWithQuery(
      <AppShell>
        <p>Основное содержимое</p>
      </AppShell>,
    );

    expect(
      screen.getByRole("link", { name: "К основному содержимому" }),
    ).toHaveAttribute("href", "#main-content");
    const main = screen.getByRole("main");
    expect(main).toHaveAttribute("id", "main-content");
    expect(main).toHaveClass(
      "focus-visible:ring-2",
      "focus-visible:ring-inset",
      "focus-visible:ring-ring",
    );
    const utilityHeader = document.querySelector(
      '[data-slot="utility-header"]',
    );
    expect(
      within(utilityHeader as HTMLElement).getByRole("link", {
        name: "Aptiloop · Главная",
      }),
    ).toHaveClass("size-11");
    expect(screen.getAllByRole("link", { name: "Главная" })).not.toHaveLength(
      0,
    );
    expect(
      screen.queryByRole("link", { name: "Агенты" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Инструменты разработчика" }),
    ).not.toBeInTheDocument();
    for (const current of document.querySelectorAll('a[aria-current="page"]')) {
      expect(current).toHaveAttribute("href", "/");
    }

    expect(screen.getAllByRole("link", { name: "Настройки" })).not.toHaveLength(
      0,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Включить тему: Светлая" }),
    );
    expect(setThemeMock).toHaveBeenCalledWith("light");
    expect(document.title).toBe("Главная · Aptiloop");
    expect(
      apiMock.mock.calls.some(
        ([path, init]) => path === "/settings" && init?.method === "PUT",
      ),
    ).toBe(false);
  });

  it("renders the compact desktop shell and keeps its rail preference local", () => {
    apiMock.mockReturnValue(new Promise(() => {}));

    const { container } = renderWithQuery(
      <AppShell>
        <p>Основное содержимое</p>
      </AppShell>,
    );

    const sidebar = container.querySelector('[data-slot="sidebar"]');
    expect(sidebar).toHaveAttribute("data-state", "expanded");
    expect(sidebar).toHaveClass("w-[var(--shell-rail-expanded)]");
    expect(container.querySelector('[data-slot="sidebar-header"]')).toHaveClass(
      "h-[var(--shell-bar-size)]",
      "after:h-px",
    );
    expect(container.querySelector('[data-slot="utility-header"]')).toHaveClass(
      "h-[var(--shell-bar-size)]",
      "after:h-px",
    );
    expect(sidebar).not.toHaveClass("border-r");
    expect(
      container.querySelector('[data-slot="utility-header-content"]'),
    ).toHaveClass("w-full", "px-4", "sm:px-6", "lg:px-6");
    expect(
      container.querySelector('[data-slot="utility-header-content"]'),
    ).not.toHaveClass("mx-auto", "max-w-[1440px]", "lg:px-11");
    expect(container.querySelector('[data-slot="shell-content"]')).toHaveClass(
      "md:pl-[var(--shell-rail-expanded)]",
    );
    expect(
      within(sidebar as HTMLElement).getByRole("link", {
        name: "Aptiloop · Главная",
      }),
    ).toHaveAttribute("href", "/");
    expect(sidebar?.querySelector('[data-slot="aptiloop-mark"]')).toHaveClass(
      "text-primary",
    );
    expect(
      sidebar?.querySelector('[data-slot="aptiloop-mark"]'),
    ).not.toHaveClass("bg-primary");
    const homeLink = within(sidebar as HTMLElement).getByRole("link", {
      name: "Главная",
    });
    expect(homeLink).toHaveClass(
      "bg-accent",
      "text-foreground",
      "gap-3",
      "px-2",
      "h-12",
    );
    expect(
      homeLink.querySelector('[data-slot="sidebar-icon-column"]'),
    ).toHaveClass("size-8");
    expect(
      homeLink.querySelector('[data-slot="sidebar-active-indicator"]'),
    ).toHaveClass("w-[3px]", "bg-primary");
    expect(
      within(
        container.querySelector(
          '[data-slot="sidebar-lower-navigation"]',
        ) as HTMLElement,
      ).getByRole("link", { name: "Настройки" }),
    ).toHaveAttribute("href", "/settings");
    expect(
      within(
        container.querySelector(
          '[data-slot="sidebar-lower-navigation"]',
        ) as HTMLElement,
      ).queryByRole("button"),
    ).not.toBeInTheDocument();
    expect(
      container.querySelector('[data-slot="sidebar-footer"]'),
    ).not.toBeInTheDocument();
    expect(
      sidebar?.querySelector('[data-slot="separator"]'),
    ).not.toBeInTheDocument();
    const utilityHeader = container.querySelector(
      '[data-slot="utility-header"]',
    ) as HTMLElement;
    const desktopToggle = within(utilityHeader).getByRole("button", {
      name: "Свернуть боковую панель",
    });
    expect(
      within(
        container.querySelector('[data-slot="sidebar-header"]') as HTMLElement,
      ).queryByRole("button", { name: "Свернуть боковую панель" }),
    ).not.toBeInTheDocument();
    expect(desktopToggle).toHaveAttribute("aria-expanded", "true");
    expect(desktopToggle).toHaveClass("size-11", "md:size-11");
    const breadcrumbs = within(utilityHeader).getByRole("navigation", {
      name: "Навигационная цепочка",
    });
    expect(
      desktopToggle.compareDocumentPosition(breadcrumbs) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      container.querySelectorAll('[data-slot="provider-health"]'),
    ).toHaveLength(1);
    expect(screen.getByRole("main")).toHaveClass("lg:px-6");
    expect(screen.getByRole("main")).not.toHaveClass(
      "mx-auto",
      "max-w-[1440px]",
      "lg:px-11",
    );

    fireEvent.click(desktopToggle);

    expect(sidebar).toHaveAttribute("data-state", "collapsed");
    expect(sidebar).toHaveClass("w-[var(--shell-rail-collapsed)]");
    expect(container.querySelector('[data-slot="shell-content"]')).toHaveClass(
      "md:pl-[var(--shell-rail-collapsed)]",
    );
    expect(window.localStorage.getItem("aptiloop:sidebar-collapsed")).toBe(
      "true",
    );
    expect(document.cookie).toContain("aptiloop.sidebar-collapsed=true");
    expect(
      within(utilityHeader).getByRole("button", {
        name: "Развернуть боковую панель",
      }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(
      within(utilityHeader).getByRole("button", {
        name: "Развернуть боковую панель",
      }),
    ).toHaveClass("size-11", "rounded-control");
    expect(sidebar).toHaveClass("w-[var(--shell-rail-collapsed)]");

    const collapsedCoursesLink = within(sidebar as HTMLElement).getByRole(
      "link",
      { name: "Курсы" },
    );
    expect(
      within(sidebar as HTMLElement).getByRole("link", {
        name: "Aptiloop · Главная",
      }),
    ).toHaveClass("h-12", "w-12", "justify-center");
    expect(
      sidebar?.querySelector('[data-slot="aptiloop-mark"]'),
    ).toBeInTheDocument();
    expect(collapsedCoursesLink).not.toHaveAttribute("title");
    expect(collapsedCoursesLink).toHaveClass(
      "h-12",
      "w-12",
      "self-center",
      "justify-center",
      "gap-0",
      "px-0",
    );
    expect(
      sidebar?.querySelectorAll('[data-slot="collapsed-rail-label"]'),
    ).toHaveLength(0);
    expect(
      within(
        container.querySelector('[data-slot="sidebar-header"]') as HTMLElement,
      ).queryByRole("button", { name: "Развернуть боковую панель" }),
    ).not.toBeInTheDocument();
    expect(
      within(
        container.querySelector(
          '[data-slot="desktop-utilities"]',
        ) as HTMLElement,
      ).queryByRole("button", { name: "Язык интерфейса" }),
    ).not.toBeInTheDocument();
  });

  it("hydrates a layout-derived collapsed rail and follows cross-tab storage changes", () => {
    apiMock.mockReturnValue(new Promise(() => {}));
    window.localStorage.setItem("aptiloop:sidebar-collapsed", "true");

    const { container } = renderWithQuery(
      <AppShell initialSidebarCollapsed>
        <p>Основное содержимое</p>
      </AppShell>,
    );

    const sidebar = container.querySelector('[data-slot="sidebar"]');
    expect(sidebar).toHaveAttribute("data-state", "collapsed");
    expect(sidebar).toHaveClass("w-[var(--shell-rail-collapsed)]");

    fireEvent(
      window,
      new StorageEvent("storage", {
        key: "aptiloop:sidebar-collapsed",
        newValue: "false",
      }),
    );

    expect(sidebar).toHaveAttribute("data-state", "expanded");
    expect(sidebar).toHaveClass("w-[var(--shell-rail-expanded)]");
    expect(document.cookie).toContain("aptiloop.sidebar-collapsed=false");
  });

  it.each([
    { initialSidebarCollapsed: false, stored: "true", expected: "collapsed" },
    { initialSidebarCollapsed: true, stored: "false", expected: "expanded" },
  ])(
    "reconciles a $expected rail before marking sidebar hydration complete",
    async ({ initialSidebarCollapsed, stored, expected }) => {
      apiMock.mockReturnValue(new Promise(() => {}));
      window.localStorage.setItem("aptiloop:sidebar-collapsed", stored);
      document.documentElement.dataset.sidebarHydrated = "false";

      const { container } = renderWithQuery(
        <AppShell initialSidebarCollapsed={initialSidebarCollapsed}>
          <p>Основное содержимое</p>
        </AppShell>,
      );

      expect(container.querySelector('[data-slot="sidebar"]')).toHaveAttribute(
        "data-state",
        expected,
      );
      expect(document.documentElement).toHaveAttribute(
        "data-sidebar-collapsed",
        stored,
      );
      expect(document.documentElement).toHaveAttribute(
        "data-sidebar-hydrated",
        "false",
      );
      await waitFor(() =>
        expect(document.documentElement).toHaveAttribute(
          "data-sidebar-hydrated",
          "true",
        ),
      );
      expect(document.cookie).toContain(`aptiloop.sidebar-collapsed=${stored}`);
    },
  );

  it("gives an open lesson the immersive shell surface with mobile nav clearance", () => {
    apiMock.mockReturnValue(new Promise(() => {}));
    pathnameState.value = "/session";

    renderWithQuery(
      <AppShell>
        <p>Занятие</p>
      </AppShell>,
    );

    const main = screen.getByRole("main");
    expect(main).toHaveClass(
      "min-h-[calc(100dvh-var(--shell-bar-size))]",
      "px-0",
      "pt-0",
      "pb-28",
      "md:pb-0",
    );
    expect(main).not.toHaveClass("max-w-[1440px]", "lg:py-8");
    expect(document.title).toBe("Урок · Aptiloop");
  });

  it.each([
    {
      pathname: "/session",
      sectionHref: "/courses",
      labels: ["nav.courses", "shell.route.lesson"],
    },
    {
      pathname: "/exercise",
      sectionHref: "/courses",
      labels: ["nav.courses", "unit.type.exercise"],
    },
    {
      pathname: "/courses/new",
      sectionHref: "/courses",
      labels: ["nav.courses", "courses.create.title"],
    },
    {
      pathname: "/courses/new/manual",
      sectionHref: "/courses",
      labels: [
        "nav.courses",
        "courses.create.title",
        "authoring.manual.fallback",
      ],
    },
    {
      pathname: "/courses/new/external",
      sectionHref: "/courses",
      labels: [
        "nav.courses",
        "courses.create.title",
        "authoring.external.title",
      ],
    },
    {
      pathname: "/courses/new/guided",
      sectionHref: "/courses",
      labels: [
        "nav.courses",
        "courses.create.title",
        "authoring.connected.title",
      ],
    },
    {
      pathname: "/courses/import",
      sectionHref: "/courses",
      labels: ["nav.courses", "courses.import.title"],
    },
    {
      pathname: "/courses/intake/123e4567-e89b-42d3-a456-426614174001",
      sectionHref: "/courses",
      labels: ["nav.courses", "courses.import.title", "courses.intake.title"],
    },
    {
      pathname: "/courses/studio",
      sectionHref: "/courses",
      labels: ["nav.courses", "shell.route.studio"],
    },
    {
      pathname: "/settings/curriculum",
      sectionHref: "/courses",
      labels: ["nav.courses"],
    },
    {
      pathname: "/interview",
      sectionHref: "/review",
      labels: ["nav.review", "interview.title"],
    },
    {
      pathname: "/chat",
      sectionHref: "/settings",
      labels: ["nav.settings", "chat.page.title"],
    },
    {
      pathname: "/settings",
      sectionHref: "/settings",
      labels: ["nav.settings"],
    },
  ])(
    "maps $pathname to $sectionHref without a second navigation model",
    ({ pathname, sectionHref, labels }) => {
      const context = resolveRouteContext(pathname);
      expect(context.sectionHref).toBe(sectionHref);
      expect(context.breadcrumbs.map((breadcrumb) => breadcrumb.label)).toEqual(
        labels,
      );
    },
  );

  it("renders a Courses-owned lesson breadcrumb and active navigation", () => {
    apiMock.mockReturnValue(new Promise(() => {}));
    pathnameState.value = "/session";

    renderWithQuery(
      <AppShell>
        <p>Занятие</p>
      </AppShell>,
    );

    const primaryNavigation = screen.getByRole("navigation", {
      name: "Основная навигация",
    });
    expect(
      within(primaryNavigation).getByRole("link", { name: "Курсы" }),
    ).toHaveAttribute("aria-current", "page");
    expect(
      within(primaryNavigation).getByRole("link", { name: "Главная" }),
    ).not.toHaveAttribute("aria-current");

    const mobileNavigation = screen.getByRole("navigation", {
      name: "Мобильная навигация",
    });
    expect(
      within(mobileNavigation).getByRole("link", { name: "Курсы" }),
    ).toHaveAttribute("aria-current", "page");
    expect(
      within(mobileNavigation).getByRole("link", { name: "Главная" }),
    ).not.toHaveAttribute("aria-current");

    const breadcrumbs = screen.getByRole("navigation", {
      name: "Навигационная цепочка",
    });
    expect(
      within(breadcrumbs).queryByRole("link", { name: "Главная" }),
    ).not.toBeInTheDocument();
    const coursesBreadcrumb = within(breadcrumbs).getByRole("link", {
      name: "Курсы",
    });
    expect(coursesBreadcrumb).toHaveAttribute("href", "/courses");
    expect(coursesBreadcrumb).toHaveClass("inline-flex", "min-h-11");
    const currentBreadcrumb = within(breadcrumbs).getByText("Урок");
    expect(currentBreadcrumb).toHaveAttribute("aria-current", "page");
    expect(currentBreadcrumb).not.toHaveAttribute("role");
    expect(currentBreadcrumb).not.toHaveAttribute("aria-disabled");
  });

  it("uses validated entity labels supplied by the open lesson", async () => {
    apiMock.mockReturnValue(new Promise(() => {}));
    pathnameState.value = "/session";

    renderWithQuery(
      <AppShell>
        <EntityLessonFixture />
      </AppShell>,
    );

    const breadcrumbs = screen.getByRole("navigation", {
      name: "Навигационная цепочка",
    });
    expect(
      await within(breadcrumbs).findByRole("link", {
        name: "Deterministic Learning",
      }),
    ).toHaveAttribute("href", "/courses/course-a/revisions/revision-a");
    expect(
      within(breadcrumbs).getByText("Урок 1 · Replay from facts"),
    ).toHaveAttribute("aria-current", "page");
    expect(within(breadcrumbs).queryByText("Урок")).not.toBeInTheDocument();
  });

  it.each(["sessionId=session-a", "sessionId="])(
    "keeps Interview in Review until the server validates %s",
    (query) => {
      const context = resolveRouteContext(
        "/interview",
        new URLSearchParams(query),
      );

      expect(context.sectionHref).toBe("/review");
      expect(context.breadcrumbs.map((item) => item.label)).toEqual([
        "nav.review",
        "interview.title",
      ]);
    },
  );

  it("uses the open page header as the document heading", () => {
    render(
      <PageHeader
        title="Курсы"
        description="Локальная библиотека и способы создания."
      />,
    );

    expect(
      screen.getByRole("heading", { level: 1, name: "Курсы" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Локальная библиотека и способы создания."),
    ).toBeInTheDocument();
  });

  it("shows a compact AI status and role details in the popover", async () => {
    apiMock.mockResolvedValue({
      ai: {
        connections: [
          {
            connectionId: "conn:mock",
            displayName: "Deterministic Mock",
            enabled: true,
            state: "connected",
            observedCapabilities: {
              connection: {
                authenticated: true,
                streaming: true,
                cancellation: true,
              },
              models: [
                {
                  modelId: "mock-deterministic",
                  available: true,
                  typedToolCalls: "schema-constrained",
                },
              ],
            },
          },
          {
            connectionId: "conn:pi:openai",
            displayName: "OpenAI via Pi",
            enabled: true,
            state: "connected",
            observedCapabilities: {
              connection: {
                authenticated: true,
                streaming: true,
                cancellation: true,
              },
              models: [
                {
                  modelId: "gpt-5.2",
                  available: true,
                  typedToolCalls: "schema-constrained",
                },
              ],
            },
          },
        ],
        roleProfiles: [
          {
            role: "course-designer",
            mode: "no-ai",
            connectionId: null,
            modelId: null,
            requiredCapabilities: [],
          },
          ...(["tutor", "evaluator"] as const).map((role) => ({
            role,
            mode: "connection" as const,
            connectionId: "conn:mock",
            modelId: "mock-deterministic",
            requiredCapabilities: ["streaming", "models", "cancellation"],
          })),
          {
            role: "reviewer",
            mode: "connection",
            connectionId: "conn:pi:openai",
            modelId: "gpt-5.2",
            requiredCapabilities: ["streaming", "models", "cancellation"],
          },
        ],
      },
    });

    renderWithQuery(<ProviderHealth compactOnMobile />);

    const status = await screen.findByRole("button", {
      name: /Статус AI/u,
    });
    expect(status).toHaveTextContent("AI готов");
    expect(status).toHaveAttribute("data-state", "ready");
    expect(status).toHaveClass("size-11", "min-[680px]:w-auto");
    expect(
      status.querySelector('[data-slot="provider-health-label"]'),
    ).toHaveClass("sr-only", "min-[680px]:not-sr-only");

    fireEvent.click(status);
    expect(
      await screen.findByText("Необязательная AI-помощь"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Готово настроенных AI-ролей: 3 из 3/u),
    ).toBeInTheDocument();
    expect(screen.getByText("Дизайнер курса")).toBeInTheDocument();
    expect(
      screen.getAllByText(/Deterministic Mock · mock-deterministic/u),
    ).toHaveLength(2);
    expect(screen.getByText(/OpenAI via Pi · gpt-5.2/u)).toBeInTheDocument();
    expect(
      screen.getByRole("link", {
        name: /Открыть диагностику разработчика/u,
      }),
    ).toHaveAttribute("href", "/settings/developer-tools");
  });

  it.each([
    {
      connectionState: "degraded",
      modelId: "gpt-5.2",
      modelAvailable: true,
      expectedState: "degraded",
      detail: "Нужна проверка",
    },
    {
      connectionState: "connected",
      modelId: null,
      modelAvailable: true,
      expectedState: "problem",
      detail: "Модель не выбрана",
    },
    {
      connectionState: "connected",
      modelId: "gpt-5.2",
      modelAvailable: false,
      expectedState: "problem",
      detail: "Недоступно",
    },
  ])(
    "keeps $connectionState with model $modelId out of the ready AI state",
    async ({
      connectionState,
      modelId,
      modelAvailable,
      expectedState,
      detail,
    }) => {
      apiMock.mockResolvedValue({
        ai: {
          connections: [
            {
              connectionId: "conn:pi:openai",
              displayName: "OpenAI via Pi",
              enabled: true,
              state: connectionState,
              observedCapabilities: {
                connection: {
                  authenticated: true,
                  streaming: true,
                  cancellation: true,
                },
                models: [
                  {
                    modelId: "gpt-5.2",
                    available: modelAvailable,
                    typedToolCalls: "schema-constrained",
                  },
                ],
              },
            },
          ],
          roleProfiles: [
            {
              role: "course-designer",
              mode: "connection",
              connectionId: "conn:pi:openai",
              modelId,
              requiredCapabilities: ["streaming", "models", "cancellation"],
            },
            ...(["tutor", "evaluator", "reviewer"] as const).map((role) => ({
              role,
              mode: "no-ai" as const,
              connectionId: null,
              modelId: null,
              requiredCapabilities: [],
            })),
          ],
        },
      });

      renderWithQuery(<ProviderHealth />);

      const status = await screen.findByRole("button", {
        name: /Статус AI/u,
      });
      expect(status).toHaveAttribute("data-state", expectedState);
      expect(status).not.toHaveTextContent("AI готов");

      fireEvent.click(status);
      expect(
        await screen.findByText(new RegExp(detail, "u")),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/Готово настроенных AI-ролей: 0 из 1/u),
      ).toBeInTheDocument();
    },
  );

  it("contains Sheet scrolling inside the overlay", () => {
    renderWithQuery(
      <Sheet open>
        <SheetContent>
          <SheetTitle>План занятия</SheetTitle>
        </SheetContent>
      </Sheet>,
    );

    expect(screen.getByRole("dialog", { name: "План занятия" })).toHaveClass(
      "overscroll-contain",
    );
  });

  it("lets composed views preserve heading hierarchy in accordions", () => {
    renderWithQuery(
      <Accordion type="single" collapsible>
        <AccordionItem value="lesson">
          <AccordionTrigger headingLevel={4}>Lesson details</AccordionTrigger>
          <AccordionContent>Activity list</AccordionContent>
        </AccordionItem>
      </Accordion>,
    );

    const heading = screen.getByRole("heading", {
      level: 4,
      name: "Lesson details",
    });
    const trigger = within(heading).getByRole("button", {
      name: "Lesson details",
    });
    expect(trigger).toHaveClass("motion-reduce:transition-none");
    fireEvent.click(trigger);
    expect(screen.getByText("Activity list")).toBeVisible();
  });

  it("keeps mastery disclosures until the content region fits the table", async () => {
    apiMock.mockResolvedValue({
      topics: [
        {
          id: "scope",
          title: "Lexical scope",
          group: "JavaScript",
          scores: {
            understanding: 1.2,
            explanation: 1,
            codeReading: 0.8,
            implementation: 0.9,
            debugging: 0.5,
            interview: 0.7,
          },
          evidenceCount: 3,
          reviewDue: false,
        },
      ],
    });

    renderWithQuery(<KnowledgeClient />);

    const skillGroup = (
      await screen.findByRole("heading", { name: "JavaScript" })
    ).closest("section");
    expect(skillGroup).toHaveAttribute("data-slot", "skill-group");
    expect(skillGroup).not.toHaveClass("rounded-2xl");
    expect(skillGroup).not.toHaveClass("bg-card");
    const topicList = skillGroup?.querySelector(
      '[data-slot="skill-topic-list"]',
    );
    expect(topicList).toHaveClass("min-w-0");
    const disclosures = topicList?.querySelector(
      '[data-slot="skill-topic-disclosures"]',
    );
    expect(disclosures).toHaveClass("grid", "gap-2", "min-[1180px]:hidden");
    expect(disclosures).not.toHaveClass("xl:hidden");
    const tableRegion = topicList?.querySelector(
      '[data-slot="skill-topic-table"]',
    );
    expect(tableRegion).toHaveClass("hidden", "min-[1180px]:block");
    expect(tableRegion).not.toHaveClass("xl:block");

    const table = screen.getByRole("table");
    expect(
      within(table).getByRole("columnheader", { name: "Тема" }),
    ).toBeInTheDocument();
    expect(within(table).getByText("1,2")).toBeInTheDocument();
    const disclosure = screen.getByRole("button", {
      name: /Lexical scope: Для каждой темы шесть независимых измерений/u,
    });
    expect(disclosure).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(disclosure);
    expect(disclosure).toHaveAttribute("aria-expanded", "true");

    const progress = await screen.findByRole("progressbar", {
      name: "Lexical scope: Понимание",
    });
    expect(screen.getAllByRole("progressbar")).toHaveLength(6);
    expect(progress).toHaveAttribute("aria-valuenow", "1.2");
    expect(progress).toHaveAttribute("aria-valuemax", "5");
    expect(progress).toHaveAttribute("aria-valuetext", "1,2 из 5");
  });

  it("directs the zero-evidence state to Courses", async () => {
    apiMock.mockResolvedValue({ topics: [] });

    renderWithQuery(<KnowledgeClient />);

    expect(
      await screen.findByText("Подтверждений навыков пока нет"),
    ).toBeVisible();
    expect(
      screen.getByText(
        "Выполните активность, которая записывает подтверждение. Посещение страниц не считается освоением.",
      ),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "Курсы" })).toHaveAttribute(
      "href",
      "/courses",
    );
  });
});
