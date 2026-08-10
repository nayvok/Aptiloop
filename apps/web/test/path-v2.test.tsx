import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HomeClient } from "@/components/home-client";
import { LocaleProvider, type UiLocale } from "@/lib/i18n";

const { apiMock, pushMock } = vi.hoisted(() => ({
  apiMock: vi.fn(),
  pushMock: vi.fn(),
}));

vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

const unitTypes = [
  "briefing",
  "study",
  "recall",
  "teacher-dialogue",
  "quiz",
  "code-reading",
  "exercise",
  "review",
  "interview",
  "summary",
  "checkpoint",
  "spaced-review",
] as const;

function unit(type: (typeof unitTypes)[number], index: number) {
  const statuses = ["completed", "in_progress", "ready", "locked"] as const;
  return {
    id: `unit-${index + 1}`,
    stableId: `lesson-1-unit-${index + 1}`,
    type,
    order: index + 1,
    title: `Activity ${index + 1}: ${type}`,
    description: `Description for ${type}`,
    estimatedMinutes: 10,
    objectives: [`Objective ${index + 1}`],
    checklist: [],
    status: statuses[index] ?? "locked",
  };
}

function lesson({
  id,
  order,
  status,
  sessionId = null,
}: {
  id: string;
  order: number;
  status: "completed" | "in_progress" | "available" | "locked";
  sessionId?: string | null;
}) {
  return {
    id,
    stableId: `lesson-${order}`,
    order,
    title: order === 1 ? "Values, types, and scope" : "Functions and closures",
    description: `Lesson ${order} description`,
    goal: `Lesson ${order} goal`,
    estimatedMinutes: 180,
    prerequisites: order === 1 ? [] : ["Complete lesson 1"],
    expectedOutcomes: ["Explain the mechanism independently"],
    depthLevel: "foundation" as const,
    outOfScope: ["Engine optimization"],
    topics: ["JavaScript", "TypeScript"],
    status,
    sessionId,
    units:
      order === 1
        ? unitTypes.map(unit)
        : [
            {
              ...unit("briefing", 0),
              id: "lesson-2-unit-1",
              stableId: "lesson-2-briefing",
              status: "locked" as const,
            },
          ],
  };
}

function pathFixture(
  firstLesson: ReturnType<typeof lesson> = lesson({
    id: "lesson-1-id",
    order: 1,
    status: "in_progress",
    sessionId: "session-active",
  }),
  selected = true,
) {
  return {
    courseContext: {
      courseId: "course-1",
      revisionId: "revision-2",
      selected,
    },
    curriculum: {
      id: "course-1",
      slug: "javascript-foundations",
      title: "JavaScript Foundations",
      description: "A practical path without premature hints.",
      version: {
        id: "revision-2",
        revision: 2,
        contentHash: "sha256-path-v2",
        status: "published" as const,
      },
      weeks: [
        {
          id: "module-1-id",
          stableId: "module-1",
          order: 1,
          title: "Language foundation",
          description: "Values, functions, and execution boundaries.",
          days: [
            firstLesson,
            lesson({ id: "lesson-2-id", order: 2, status: "locked" }),
          ],
        },
      ],
    },
  };
}

function renderWithQuery(children: ReactNode, locale: UiLocale = "en-US") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <LocaleProvider initialLocale={locale} syncSettings={false}>
          {children}
        </LocaleProvider>
      </QueryClientProvider>,
    ),
  };
}

function mockSettings(locale: UiLocale = "en-US") {
  return { uiLocale: locale };
}

beforeEach(() => {
  apiMock.mockReset();
  pushMock.mockReset();
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: { randomUUID: vi.fn(() => "123e4567-e89b-42d3-a456-426614174000") },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Aptiloop Home", () => {
  it("shows one next action, finite phases, and upcoming lessons", async () => {
    apiMock.mockImplementation((path: string) =>
      Promise.resolve(path === "/settings" ? mockSettings() : pathFixture()),
    );
    const { container } = renderWithQuery(<HomeClient />);

    expect(
      await screen.findByRole("heading", { name: "JavaScript Foundations" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Lesson 1 · Values, types, and scope"),
    ).toBeVisible();
    expect(screen.getByText("Activity 2: study")).toBeVisible();
    expect(
      screen.getByRole("button", { name: /Resume lesson/u }),
    ).toBeEnabled();
    expect(container.querySelectorAll('[data-slot="home"]')).toHaveLength(1);
    expect(
      screen.getByRole("heading", { name: "Learning phases" }),
    ).toBeVisible();
    expect(screen.getByText("Understand")).toBeVisible();
    expect(screen.getByText("Demonstrate")).toBeVisible();
    expect(screen.getByText("Practice and review")).toBeVisible();
    expect(screen.getByText(/Functions and closures/u)).toBeVisible();
    expect(screen.queryByText(/reference answer/iu)).not.toBeInTheDocument();
  });

  it("keeps Course content unchanged when UI locale is Russian", async () => {
    apiMock.mockImplementation((path: string) =>
      Promise.resolve(
        path === "/settings" ? mockSettings("ru-RU") : pathFixture(),
      ),
    );
    renderWithQuery(<HomeClient />, "ru-RU");

    expect(await screen.findByText("JavaScript Foundations")).toBeVisible();
    expect(screen.getByText("Следующее действие")).toBeVisible();
    expect(
      screen.getByText("Values, types, and scope", { exact: false }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: /Продолжить занятие/u }),
    ).toBeEnabled();
  });

  it("continues an active session without creating another", async () => {
    apiMock.mockImplementation((path: string) =>
      Promise.resolve(path === "/settings" ? mockSettings() : pathFixture()),
    );
    renderWithQuery(<HomeClient />);

    fireEvent.click(
      await screen.findByRole("button", { name: /Resume lesson/u }),
    );

    expect(pushMock).toHaveBeenCalledWith("/session?id=session-active");
    expect(apiMock).not.toHaveBeenCalledWith(
      "/learning/sessions/v2",
      expect.anything(),
    );
  });

  it("starts the first available lesson with an operation ID", async () => {
    const available = lesson({
      id: "lesson-1-id",
      order: 1,
      status: "available",
    });
    available.units = available.units.map((candidate, index) => ({
      ...candidate,
      status: index === 0 ? ("ready" as const) : ("locked" as const),
    }));
    apiMock.mockImplementation((path: string) => {
      if (path === "/settings") return Promise.resolve(mockSettings());
      if (path === "/learning/path")
        return Promise.resolve(pathFixture(available));
      if (path === "/learning/sessions/v2") {
        return Promise.resolve({ session: { id: "session-new" } });
      }
      throw new Error(`Unexpected API path: ${path}`);
    });
    renderWithQuery(<HomeClient />);

    fireEvent.click(
      await screen.findByRole("button", { name: /Start lesson/u }),
    );

    await vi.waitFor(() => {
      expect(apiMock).toHaveBeenCalledWith("/learning/sessions/v2", {
        method: "POST",
        body: JSON.stringify({
          dayId: "lesson-1-id",
          operationId: "123e4567-e89b-42d3-a456-426614174000",
        }),
      });
    });
    await vi.waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith("/session?id=session-new");
    });
  });

  it("requires explicit Course selection before starting its lesson", async () => {
    let selected = false;
    const endpoint = "/learning/courses/course-1/revisions/revision-2/path";
    apiMock.mockImplementation((path: string) => {
      if (path === "/settings") return Promise.resolve(mockSettings());
      if (path === endpoint)
        return Promise.resolve(pathFixture(undefined, selected));
      if (path === "/learning/courses/course-1/select") {
        selected = true;
        return Promise.resolve({
          selected: true,
          courseId: "course-1",
          revisionId: "revision-2",
        });
      }
      throw new Error(`Unexpected API path: ${path}`);
    });
    renderWithQuery(
      <HomeClient
        pathEndpoint={endpoint}
        selectionTarget={{ courseId: "course-1", revisionId: "revision-2" }}
      />,
    );

    expect(
      await screen.findByRole("button", { name: "Use this Course" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: /Resume lesson/u }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Use this Course" }));

    await vi.waitFor(() => {
      expect(apiMock).toHaveBeenCalledWith(
        "/learning/courses/course-1/select",
        {
          method: "POST",
          body: JSON.stringify({
            revisionId: "revision-2",
            operationId: "123e4567-e89b-42d3-a456-426614174000",
          }),
        },
      );
    });
    await vi.waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Resume lesson/u }),
      ).toBeEnabled();
    });
  });

  it("shows an actionable empty state without an active Course", async () => {
    apiMock.mockImplementation((path: string) =>
      Promise.resolve(
        path === "/settings"
          ? mockSettings()
          : { courseContext: null, curriculum: null },
      ),
    );
    renderWithQuery(<HomeClient />);

    expect(await screen.findByText("No active Course")).toBeVisible();
    expect(screen.getByRole("link", { name: "Open Courses" })).toHaveAttribute(
      "href",
      "/courses",
    );
  });

  it("rejects protected evaluation fields at the browser boundary", async () => {
    const leaked = pathFixture();
    Object.assign(leaked.curriculum.weeks[0]?.days[0]?.units[0] ?? {}, {
      referenceAnswer: "secret reference answer",
      evaluationPoints: ["secret evaluation points"],
    });
    apiMock.mockImplementation((path: string) =>
      Promise.resolve(path === "/settings" ? mockSettings() : leaked),
    );
    renderWithQuery(<HomeClient />);

    expect(
      await screen.findByText(/Protected curriculum field received/u),
    ).toBeVisible();
    expect(
      screen.queryByText("secret reference answer"),
    ).not.toBeInTheDocument();
  });

  it("announces loading and exposes a retryable error", async () => {
    apiMock.mockImplementation((path: string) => {
      if (path === "/settings") return Promise.resolve(mockSettings());
      return Promise.withResolvers<never>().promise;
    });
    const loading = renderWithQuery(<HomeClient />);
    expect(screen.getByRole("status")).toHaveAccessibleName(
      "Loading your learning path…",
    );
    loading.unmount();

    apiMock.mockImplementation((path: string) =>
      path === "/settings"
        ? Promise.resolve(mockSettings())
        : Promise.reject(new Error("Path endpoint is unavailable")),
    );
    renderWithQuery(<HomeClient />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Path endpoint is unavailable",
    );
    expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled();
  });
});
