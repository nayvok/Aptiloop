import { describe, expect, it } from "vitest";

import { resolveRouteTitleKey } from "@/lib/route-title";

describe("route title privacy boundary", () => {
  it.each([
    ["/", "nav.home"],
    ["/courses", "nav.courses"],
    ["/courses/new", "courses.create.title"],
    ["/courses/new/manual", "authoring.manual.fallback"],
    ["/courses/new/external", "authoring.external.title"],
    ["/courses/new/guided", "authoring.connected.title"],
    ["/courses/import", "courses.import.title"],
    [
      "/courses/intake/123e4567-e89b-42d3-a456-426614174001",
      "courses.intake.title",
    ],
    ["/courses/studio", "shell.route.studio"],
    ["/session", "shell.route.lesson"],
    ["/exercise", "unit.type.exercise"],
    ["/interview", "interview.title"],
    ["/review", "nav.review"],
    ["/skills", "nav.skills"],
    ["/settings", "nav.settings"],
    ["/settings/developer-tools", "ui.developerTools.title"],
    ["/chat", "chat.page.title"],
  ])("maps %s to the static label %s", (pathname, expected) => {
    expect(resolveRouteTitleKey(pathname)).toBe(expected);
  });

  it.each([
    ["view=due", "review.view.due"],
    ["view=mistakes", "review.view.mistakes"],
    ["view=cards", "review.view.cards"],
    ["view=interviews", "review.view.interviews"],
  ])("accepts the controlled Review query %s", (query, expected) => {
    expect(resolveRouteTitleKey("/review", new URLSearchParams(query))).toBe(
      expected,
    );
  });

  it.each([
    ["section=interface", "settings.section.interface"],
    ["section=ai", "settings.section.ai"],
    ["section=connections", "settings.section.connections"],
    ["section=advanced", "settings.section.local"],
  ])("accepts the controlled Settings query %s", (query, expected) => {
    expect(resolveRouteTitleKey("/settings", new URLSearchParams(query))).toBe(
      expected,
    );
  });

  it("never returns entity names, identifiers, or arbitrary query values", () => {
    const privateCourse = "Private oncology notes";
    const privateSession = "session-secret-123";

    expect(
      resolveRouteTitleKey(
        `/courses/${encodeURIComponent(privateCourse)}/revisions/revision-secret`,
        new URLSearchParams(`title=${encodeURIComponent(privateCourse)}`),
      ),
    ).toBe("home.courseRoadmap");
    expect(
      resolveRouteTitleKey(
        "/session",
        new URLSearchParams(`id=${privateSession}`),
      ),
    ).toBe("shell.route.lesson");
    expect(
      resolveRouteTitleKey(
        "/review",
        new URLSearchParams(`view=${encodeURIComponent(privateCourse)}`),
      ),
    ).toBe("nav.review");
    expect(
      resolveRouteTitleKey(
        "/settings",
        new URLSearchParams(`section=${privateSession}`),
      ),
    ).toBe("nav.settings");
  });

  it("normalizes trailing slashes and leaves unknown routes untitled", () => {
    expect(resolveRouteTitleKey("/courses/import///")).toBe(
      "courses.import.title",
    );
    expect(
      resolveRouteTitleKey("/not-an-aptiloop-route/private-id"),
    ).toBeNull();
  });
});
