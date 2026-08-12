import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { redirectMock, studioPropsMock } = vi.hoisted(() => ({
  redirectMock: vi.fn(),
  studioPropsMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("@/lib/i18n", () => ({
  useI18n: () => ({
    t: (key: string) =>
      ({
        "nav.courses": "Courses",
        "courses.create.title": "Create Course",
        "authoring.entry.description": "Choose how to begin this Course.",
        "authoring.entry.assistedTitle": "Choose an assisted start",
        "authoring.entry.assistedDescription": "Choose based on your model.",
        "authoring.external.title": "Use an external model",
        "authoring.external.description": "Download exact V1 instructions.",
        "authoring.external.guidance": "Use broader external capabilities.",
        "authoring.external.badge": "Aptiloop sends nothing",
        "authoring.external.start": "Prepare external instructions",
        "authoring.connected.title": "Use the connected Course Designer",
        "authoring.connected.description": "Create a local Draft first.",
        "authoring.connected.guidance": "Readiness is checked next.",
        "authoring.connected.badge": "Capability check required",
        "authoring.connected.start": "Check and use connected model",
        "authoring.manual.fallback": "Create manually without AI",
        "authoring.manual.fallbackDescription": "Complete no-AI fallback.",
        "authoring.manual.start": "Create a blank Draft",
        "authoring.common.cancel": "Cancel",
        "authoring.common.continue": "Continue",
        "authoring.entry.continueHint": "Select a path to continue",
        "authoring.entry.continueReady": "Continue to the authoring brief",
      })[key] ?? key,
  }),
}));
vi.mock("@/components/curriculum-editor-client", () => ({
  CurriculumStudioClient: (props: unknown) => {
    studioPropsMock(props);
    return <div data-testid="studio-route" />;
  },
}));

import CourseStudioPage from "@/app/courses/studio/page";
import NewCoursePage from "@/app/courses/new/page";
import FlashcardsCompatibilityPage from "@/app/flashcards/page";
import KnowledgeCompatibilityPage from "@/app/knowledge/page";
import MistakesCompatibilityPage from "@/app/mistakes/page";
import CurriculumCompatibilityPage from "@/app/settings/curriculum/page";

beforeEach(() => {
  redirectMock.mockReset();
  studioPropsMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("Course authoring routes", () => {
  it("presents two assisted starts in a balanced grid and a quieter manual fallback", () => {
    const view = render(<NewCoursePage />);

    expect(
      view.container.querySelector('[data-slot="course-creation-paths"]'),
    ).toHaveClass("grid", "md:grid-cols-2");

    const external = screen.getByRole("radio", {
      name: /Use an external model/u,
    });
    const connected = screen.getByRole("radio", {
      name: /Use the connected Course Designer/u,
    });
    expect(screen.getAllByRole("radio")).toHaveLength(2);
    expect(external).not.toBeChecked();
    expect(connected).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();

    fireEvent.click(external);
    expect(screen.getByRole("link", { name: "Continue" })).toHaveAttribute(
      "href",
      "/courses/new/external",
    );

    fireEvent.click(connected);
    expect(screen.getByRole("link", { name: "Continue" })).toHaveAttribute(
      "href",
      "/courses/new/guided",
    );
    expect(
      screen.getByRole("link", { name: /Create a blank Draft/u }),
    ).toHaveAttribute("href", "/courses/new/manual");
    expect(screen.queryByLabelText(/file/u)).not.toBeInTheDocument();
  });

  it("forwards a validated revision and mode to Adaptive Studio", async () => {
    const tree = await CourseStudioPage({
      searchParams: Promise.resolve({
        version: "draft-target",
        mode: "designer",
      }),
    });
    render(tree);

    expect(screen.getByTestId("studio-route")).toBeInTheDocument();
    expect(studioPropsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        initialVersionId: "draft-target",
        initialMode: "designer",
        initialWorkspace: "designer",
      }),
    );
  });

  it("uses the requested Studio workspace as URL authority", async () => {
    const tree = await CourseStudioPage({
      searchParams: Promise.resolve({
        version: "draft-target",
        mode: "designer",
        tab: "history",
      }),
    });
    render(tree);

    expect(studioPropsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        initialVersionId: "draft-target",
        initialMode: "designer",
        initialWorkspace: "history",
      }),
    );
  });

  it("opens the learner Preview as its own URL-backed workspace", async () => {
    const tree = await CourseStudioPage({
      searchParams: Promise.resolve({
        version: "draft-target",
        mode: "manual",
        tab: "preview",
      }),
    });
    render(tree);

    expect(studioPropsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        initialVersionId: "draft-target",
        initialMode: "manual",
        initialWorkspace: "preview",
      }),
    );
  });

  it("redirects malformed or missing revision authority to Courses", async () => {
    redirectMock.mockImplementationOnce(() => {
      throw new Error("NEXT_REDIRECT");
    });

    await expect(
      CourseStudioPage({
        searchParams: Promise.resolve({
          version: ["draft-a", "draft-b"],
          mode: "automatic",
        }),
      }),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(redirectMock).toHaveBeenCalledWith("/courses");
    expect(studioPropsMock).not.toHaveBeenCalled();
  });

  it.each([
    ["/knowledge", KnowledgeCompatibilityPage, "/skills"],
    ["/mistakes", MistakesCompatibilityPage, "/review?view=mistakes"],
    ["/flashcards", FlashcardsCompatibilityPage, "/review?view=cards"],
    ["/settings/curriculum", CurriculumCompatibilityPage, "/courses"],
  ])("redirects the compatibility route %s to %s", (_route, page, target) => {
    page();

    expect(redirectMock).toHaveBeenCalledTimes(1);
    expect(redirectMock).toHaveBeenCalledWith(target);
  });
});
