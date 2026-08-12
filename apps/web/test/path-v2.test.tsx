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
  const currentStep = firstLesson.units.find(
    (candidate) => candidate.status === "in_progress",
  )?.stableId;
  return {
    nextAction:
      firstLesson.status === "in_progress" &&
      firstLesson.sessionId !== null &&
      currentStep
        ? {
            type: "resume" as const,
            lessonId: firstLesson.id,
            sessionId: firstLesson.sessionId,
            currentStep,
          }
        : firstLesson.status === "available"
          ? { type: "start" as const, lessonId: firstLesson.id }
          : null,
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
    expect(
      container.querySelectorAll('[data-slot="home-primary-action"]'),
    ).toHaveLength(1);
    expect(container.querySelectorAll('[data-slot="home"]')).toHaveLength(1);
    expect(
      screen.getByRole("heading", { name: "Learning phases" }),
    ).toBeVisible();
    expect(screen.getByText("Understand")).toBeVisible();
    expect(screen.getByText("Demonstrate")).toBeVisible();
    expect(screen.getByText("Practice and review")).toBeVisible();
    expect(screen.getByText(/Functions and closures/u)).toBeVisible();
    expect(screen.queryByText("Evidence basis")).not.toBeInTheDocument();
    expect(screen.queryByText("Published revision 2")).not.toBeInTheDocument();
    expect(screen.queryByText("sha256-path-v2")).not.toBeInTheDocument();
    expect(screen.queryByText(/reference answer/iu)).not.toBeInTheDocument();
  });

  it("keeps long external Course, day, and unit titles inside their columns", async () => {
    const fixture = pathFixture();
    const longToken = "CourseTitleWithoutNaturalBreaks".repeat(8);
    fixture.curriculum.title = longToken;
    fixture.curriculum.description = longToken;
    const firstDay = fixture.curriculum.weeks[0]?.days[0];
    if (!firstDay)
      throw new Error("Expected the fixture to contain a first day");
    firstDay.title = longToken;
    const currentUnit = firstDay.units.find(
      (candidate) => candidate.status === "in_progress",
    );
    if (!currentUnit) throw new Error("Expected an in-progress unit");
    currentUnit.title = longToken;

    apiMock.mockImplementation((path: string) =>
      Promise.resolve(path === "/settings" ? mockSettings() : fixture),
    );
    const { container } = renderWithQuery(<HomeClient />);

    expect(
      await screen.findByRole("heading", { name: longToken }),
    ).toBeVisible();
    expect(
      container.querySelector('[data-slot="home-course-header"]'),
    ).toHaveClass("min-w-0", "[overflow-wrap:anywhere]");
    expect(
      screen.getByRole("heading", { name: `Lesson 1 · ${longToken}` })
        .parentElement,
    ).toHaveClass("min-w-0", "[overflow-wrap:anywhere]");
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

  it("starts the server-selected available lesson with an operation ID", async () => {
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
        surface="revision"
        pathEndpoint={endpoint}
        selectionTarget={{ courseId: "course-1", revisionId: "revision-2" }}
      />,
    );

    expect(
      await screen.findByRole("button", { name: "Use this Course" }),
    ).toBeEnabled();
    expect(
      screen.getByText("Course preview · Published revision 2"),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Browse Courses" }),
    ).toHaveAttribute("href", "/courses");
    expect(
      screen.queryByRole("heading", { level: 1, name: "Home" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    expect(
      document.querySelector('[data-slot="course-selection-callout"]'),
    ).toBeInTheDocument();
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
      expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
    });
  });

  it("renders an ordered learner roadmap and continues the exact current revision", async () => {
    const endpoint = "/learning/courses/course-1/revisions/revision-2/path";
    apiMock.mockImplementation((path: string) => {
      if (path === endpoint) return Promise.resolve(pathFixture());
      throw new Error(`Unexpected API path: ${path}`);
    });

    const { container } = renderWithQuery(
      <HomeClient
        surface="revision"
        pathEndpoint={endpoint}
        selectionTarget={{ courseId: "course-1", revisionId: "revision-2" }}
      />,
    );

    expect(
      await screen.findByRole("heading", { name: "JavaScript Foundations" }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Course roadmap" }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Language foundation" }),
    ).toBeVisible();
    const lessonNodes = Array.from(
      container.querySelectorAll('[data-slot="course-roadmap-lesson"]'),
    );
    expect(
      lessonNodes.map((node) => node.querySelector("h4")?.textContent),
    ).toEqual([
      "Lesson 1 · Values, types, and scope",
      "Lesson 2 · Functions and closures",
    ]);
    expect(lessonNodes[0]).toHaveAttribute("data-status", "in_progress");
    expect(lessonNodes[0]).toHaveAttribute("data-current", "true");
    expect(lessonNodes[0]).not.toHaveAttribute("aria-current");
    expect(lessonNodes[1]).toHaveAttribute("data-status", "locked");
    expect(
      container.querySelector(
        '[data-slot="course-roadmap-phase"][data-current="true"]',
      ),
    ).toHaveAttribute("data-status", "in_progress");
    expect(
      container.querySelector(
        '[data-slot="course-roadmap-activity"][aria-current="step"]',
      ),
    ).toHaveTextContent("Activity 2: study");
    expect(container.querySelectorAll('[aria-current="step"]')).toHaveLength(1);
    expect(
      container.querySelector('[data-slot="course-roadmap-heading"]'),
    ).toBeInTheDocument();
    expect(
      container.querySelector('[data-slot="course-roadmap-context"]'),
    ).toBeInTheDocument();
    expect(
      container.querySelector('[data-slot="course-roadmap-summary"]'),
    ).toBeInTheDocument();
    const technicalDetails = screen
      .getByText("Technical details")
      .closest("details");
    expect(technicalDetails).not.toHaveAttribute("open");

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(pushMock).toHaveBeenCalledWith("/session?id=session-active");
    expect(apiMock).not.toHaveBeenCalledWith(
      "/learning/sessions/v2",
      expect.anything(),
    );
  });

  it("starts only the one unambiguous server-available lesson", async () => {
    const endpoint = "/learning/courses/course-1/revisions/revision-2/path";
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
      if (path === endpoint) return Promise.resolve(pathFixture(available));
      if (path === "/learning/sessions/v2") {
        return Promise.resolve({ session: { id: "session-new" } });
      }
      throw new Error(`Unexpected API path: ${path}`);
    });

    const { container } = renderWithQuery(
      <HomeClient
        surface="revision"
        pathEndpoint={endpoint}
        selectionTarget={{ courseId: "course-1", revisionId: "revision-2" }}
      />,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Start lesson" }),
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
    expect(container.querySelectorAll('[aria-current="step"]')).toHaveLength(1);
  });

  it("renders no next-action CTA when multiple lessons are server-available", async () => {
    const endpoint = "/learning/courses/course-1/revisions/revision-2/path";
    const first = lesson({
      id: "lesson-1-id",
      order: 1,
      status: "available",
    });
    first.units = first.units.map((candidate, index) => ({
      ...candidate,
      status: index === 0 ? ("ready" as const) : ("locked" as const),
    }));
    const ambiguous = pathFixture(first);
    const second = ambiguous.curriculum.weeks[0]?.days[1];
    if (!second) throw new Error("Expected a second lesson");
    second.status = "available";
    second.sessionId = null;
    const secondEntry = second.units[0];
    if (!secondEntry) throw new Error("Expected a second lesson entry unit");
    secondEntry.status = "ready";
    ambiguous.nextAction = null;
    apiMock.mockResolvedValue(ambiguous);

    const { container } = renderWithQuery(
      <HomeClient
        surface="revision"
        pathEndpoint={endpoint}
        selectionTarget={{ courseId: "course-1", revisionId: "revision-2" }}
      />,
    );

    expect(
      await screen.findByText("Course revision unavailable"),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Start lesson" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Continue" }),
    ).not.toBeInTheDocument();
    expect(container.querySelectorAll('[aria-current="step"]')).toHaveLength(0);
    expect(apiMock).not.toHaveBeenCalledWith(
      "/learning/sessions/v2",
      expect.anything(),
    );
  });

  it("rejects a start action when the server also marks another lesson available", async () => {
    const endpoint = "/learning/courses/course-1/revisions/revision-2/path";
    const first = lesson({
      id: "lesson-1-id",
      order: 1,
      status: "available",
    });
    const inconsistent = pathFixture(first);
    const second = inconsistent.curriculum.weeks[0]?.days[1];
    if (!second) throw new Error("Expected a second lesson");
    second.status = "available";
    second.sessionId = null;
    apiMock.mockResolvedValue(inconsistent);

    renderWithQuery(
      <HomeClient
        surface="revision"
        pathEndpoint={endpoint}
        selectionTarget={{ courseId: "course-1", revisionId: "revision-2" }}
      />,
    );

    expect(
      await screen.findByText(/exactly one available lesson/u),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Start lesson" }),
    ).not.toBeInTheDocument();
  });

  it("resumes the exact persisted current step instead of the first ready child", async () => {
    const fixture = pathFixture();
    const day = fixture.curriculum.weeks[0]?.days[0];
    if (!day) throw new Error("Expected the current lesson");
    day.units = day.units.map((candidate, index) => ({
      ...candidate,
      status:
        index === 0 || index === 2
          ? ("ready" as const)
          : index === 1
            ? ("completed" as const)
            : ("locked" as const),
    }));
    const exactStep = day.units[2];
    if (!exactStep) throw new Error("Expected an authoritative current step");
    fixture.nextAction = {
      type: "resume",
      lessonId: day.id,
      sessionId: "session-active",
      currentStep: exactStep.stableId,
    };
    apiMock.mockImplementation((path: string) =>
      Promise.resolve(path === "/settings" ? mockSettings() : fixture),
    );

    const { container } = renderWithQuery(<HomeClient />);

    expect(
      await screen.findByRole("button", { name: /Resume lesson/u }),
    ).toBeEnabled();
    expect(screen.getByText(exactStep.title)).toBeVisible();
    expect(
      container.querySelectorAll('[data-slot="home-primary-action"]'),
    ).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /Resume lesson/u }));
    expect(pushMock).toHaveBeenCalledWith("/session?id=session-active");
  });

  it("rejects a resume action whose current step is outside the active lesson", async () => {
    const fixture = pathFixture();
    if (fixture.nextAction?.type !== "resume") {
      throw new Error("Expected a resume action fixture");
    }
    fixture.nextAction.currentStep = "missing-current-step";
    apiMock.mockImplementation((path: string) =>
      Promise.resolve(path === "/settings" ? mockSettings() : fixture),
    );

    renderWithQuery(<HomeClient />);

    expect(
      await screen.findByText("Aptiloop Core is unavailable."),
    ).toBeVisible();
    const diagnostic = screen.getByText(/persisted current step/u);
    expect(diagnostic).not.toBeVisible();
    fireEvent.click(screen.getByText("Technical details"));
    expect(diagnostic).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /Resume lesson/u }),
    ).not.toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("does not invent a current activity when several children are ready", async () => {
    const endpoint = "/learning/courses/course-1/revisions/revision-2/path";
    const available = lesson({
      id: "lesson-1-id",
      order: 1,
      status: "available",
    });
    available.units = available.units.map((candidate, index) => ({
      ...candidate,
      status: index < 2 ? ("ready" as const) : ("locked" as const),
    }));
    apiMock.mockResolvedValue(pathFixture(available));

    const { container } = renderWithQuery(
      <HomeClient
        surface="revision"
        pathEndpoint={endpoint}
        selectionTarget={{ courseId: "course-1", revisionId: "revision-2" }}
      />,
    );

    expect(
      await screen.findByRole("button", { name: "Start lesson" }),
    ).toBeEnabled();
    expect(
      container.querySelector(
        '[data-slot="course-roadmap-activity"][aria-current="step"]',
      ),
    ).not.toBeInTheDocument();
    expect(
      container.querySelector(
        '[data-slot="course-roadmap-lesson"][aria-current="step"]',
      ),
    ).toHaveAttribute("data-status", "available");
    expect(container.querySelectorAll('[aria-current="step"]')).toHaveLength(1);
  });

  it("masks ready child activities when their lesson is locked", async () => {
    const endpoint = "/learning/courses/course-1/revisions/revision-2/path";
    const fixture = pathFixture();
    const lockedLesson = fixture.curriculum.weeks[0]?.days[1];
    const leakedReadyUnit = lockedLesson?.units[0];
    if (!lockedLesson || !leakedReadyUnit) {
      throw new Error("Expected a locked lesson with an entry unit");
    }
    leakedReadyUnit.status = "ready";
    apiMock.mockResolvedValue(fixture);

    const { container } = renderWithQuery(
      <HomeClient
        surface="revision"
        pathEndpoint={endpoint}
        selectionTarget={{ courseId: "course-1", revisionId: "revision-2" }}
      />,
    );

    await screen.findByRole("heading", { name: "JavaScript Foundations" });
    const lockedLessonNode = container.querySelector(
      '[data-slot="course-roadmap-lesson"][data-status="locked"]',
    );
    expect(lockedLessonNode).toBeInTheDocument();
    expect(
      lockedLessonNode?.querySelector('[data-status="ready"]'),
    ).not.toBeInTheDocument();
    expect(
      lockedLessonNode?.querySelector('[data-slot="course-roadmap-activity"]'),
    ).toHaveAttribute("data-status", "locked");
  });

  it("keeps revision identity while the exact preview path is loading", () => {
    const endpoint = "/learning/courses/course-1/revisions/revision-2/path";
    apiMock.mockImplementation(() => Promise.withResolvers<never>().promise);

    renderWithQuery(
      <HomeClient
        surface="revision"
        pathEndpoint={endpoint}
        selectionTarget={{ courseId: "course-1", revisionId: "revision-2" }}
      />,
    );

    expect(
      screen.getByRole("heading", { level: 1, name: "Preview revision" }),
    ).toBeVisible();
    expect(screen.getByRole("status")).toHaveAccessibleName(
      "Loading revisions",
    );
    expect(
      screen.getByRole("link", { name: "Browse Courses" }),
    ).toHaveAttribute("href", "/courses");
    expect(
      screen.queryByRole("heading", { level: 1, name: "Home" }),
    ).not.toBeInTheDocument();
    expect(apiMock).toHaveBeenCalledWith(endpoint);
  });

  it("keeps revision identity and recovery when the exact preview path fails", async () => {
    const endpoint = "/learning/courses/course-1/revisions/revision-2/path";
    apiMock.mockRejectedValue(new Error("Revision path is unavailable"));

    renderWithQuery(
      <HomeClient
        surface="revision"
        pathEndpoint={endpoint}
        selectionTarget={{ courseId: "course-1", revisionId: "revision-2" }}
      />,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Course revision unavailable",
    );
    expect(
      document
        .querySelector('[data-slot="course-revision-preview-error"]')
        ?.querySelector('[data-slot="query-error"]'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 1, name: "Preview revision" }),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Browse Courses" }),
    ).toHaveAttribute("href", "/courses");
    expect(screen.getByText("Technical details")).toBeVisible();
    expect(
      screen.queryByRole("heading", { level: 1, name: "Home" }),
    ).not.toBeInTheDocument();
    expect(apiMock).toHaveBeenCalledWith(endpoint);
  });

  it("fails closed when the preview payload belongs to another revision", async () => {
    const endpoint = "/learning/courses/course-1/revisions/revision-2/path";
    const incompatible = pathFixture(undefined, false);
    incompatible.courseContext.revisionId = "revision-other";
    apiMock.mockResolvedValue(incompatible);

    renderWithQuery(
      <HomeClient
        surface="revision"
        pathEndpoint={endpoint}
        selectionTarget={{ courseId: "course-1", revisionId: "revision-2" }}
      />,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Course revision unavailable",
    );
    expect(
      screen.queryByRole("heading", { name: "JavaScript Foundations" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Use this Course" }),
    ).not.toBeInTheDocument();
    expect(apiMock).toHaveBeenCalledWith(endpoint);
    expect(apiMock).not.toHaveBeenCalledWith(
      "/learning/courses/course-1/select",
      expect.anything(),
    );
  });

  it("shows an actionable empty state without an active Course", async () => {
    apiMock.mockImplementation((path: string) =>
      Promise.resolve(
        path === "/settings"
          ? mockSettings()
          : { courseContext: null, curriculum: null, nextAction: null },
      ),
    );
    renderWithQuery(<HomeClient />);

    expect(await screen.findByText("No active Course")).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Choose a Course" }),
    ).toHaveAttribute("href", "/courses#course-library-title");
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
      await screen.findByText("Aptiloop Core is unavailable."),
    ).toBeVisible();
    const diagnostic = screen.getByText(/Protected curriculum field received/u);
    expect(diagnostic).not.toBeVisible();
    fireEvent.click(screen.getByText("Technical details"));
    expect(diagnostic).toBeVisible();
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
    expect(
      screen.getByRole("heading", { level: 1, name: "Home" }),
    ).toBeVisible();
    expect(screen.getByRole("status")).toHaveAccessibleName(
      "Loading your learning path…",
    );
    loading.unmount();

    apiMock.mockClear();
    let pathAttempts = 0;
    apiMock.mockImplementation((path: string) => {
      if (path === "/settings") return Promise.resolve(mockSettings());
      pathAttempts += 1;
      return pathAttempts === 1
        ? Promise.reject(new Error("Path endpoint is unavailable"))
        : Promise.resolve(pathFixture());
    });
    renderWithQuery(<HomeClient />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Path endpoint is unavailable",
    );
    expect(
      screen.getByRole("heading", { level: 1, name: "Home" }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(
      await screen.findByRole("heading", { name: "JavaScript Foundations" }),
    ).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(
      apiMock.mock.calls.filter(([path]) => path === "/learning/path"),
    ).toHaveLength(2);
  });
});
