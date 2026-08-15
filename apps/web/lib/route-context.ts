import type { MessageKey } from "@/lib/i18n";

export type PrimaryRouteHref =
  "/" | "/courses" | "/review" | "/skills" | "/settings";

export type RouteBreadcrumb =
  | {
      href?: string;
      label: MessageKey;
      text?: never;
    }
  | {
      href?: string;
      label?: never;
      text: string;
    };

export type RouteContext = {
  breadcrumbs: readonly RouteBreadcrumb[];
  sectionHref: PrimaryRouteHref | null;
};

const trailingSlashPattern = /\/+$/u;

function normalizePathname(pathname: string): string {
  if (pathname === "/") return pathname;
  return pathname.replace(trailingSlashPattern, "") || "/";
}

function isAtOrBelow(pathname: string, route: string): boolean {
  return pathname === route || pathname.startsWith(`${route}/`);
}

function section(
  sectionHref: PrimaryRouteHref,
  sectionLabel: MessageKey,
  leafLabel?: MessageKey,
): RouteContext {
  if (!leafLabel) {
    return {
      sectionHref,
      breadcrumbs: [{ label: sectionLabel }],
    };
  }

  return {
    sectionHref,
    breadcrumbs: [
      { href: sectionHref, label: sectionLabel },
      { label: leafLabel },
    ],
  };
}

function courseCreation(leafLabel: MessageKey): RouteContext {
  return {
    sectionHref: "/courses",
    breadcrumbs: [
      { href: "/courses", label: "nav.courses" },
      { href: "/courses/new", label: "courses.create.title" },
      { label: leafLabel },
    ],
  };
}

/**
 * Keeps global navigation, utility-header breadcrumbs, and deep learning routes
 * on one information-architecture model. Unknown routes deliberately do not
 * masquerade as Home.
 */
export function resolveRouteContext(
  rawPathname: string,
  _searchParams?: Pick<URLSearchParams, "get">,
): RouteContext {
  const pathname = normalizePathname(rawPathname);

  if (pathname === "/") return section("/", "nav.home");

  if (isAtOrBelow(pathname, "/session")) {
    return section("/courses", "nav.courses", "shell.route.lesson");
  }
  if (isAtOrBelow(pathname, "/exercise")) {
    return section("/courses", "nav.courses", "unit.type.exercise");
  }

  if (isAtOrBelow(pathname, "/settings/curriculum")) {
    return section("/courses", "nav.courses");
  }
  if (isAtOrBelow(pathname, "/courses")) {
    if (isAtOrBelow(pathname, "/courses/new/external")) {
      return courseCreation("authoring.external.title");
    }
    if (isAtOrBelow(pathname, "/courses/new/manual")) {
      return courseCreation("authoring.manual.fallback");
    }
    if (isAtOrBelow(pathname, "/courses/new/guided")) {
      return courseCreation("authoring.connected.title");
    }
    if (isAtOrBelow(pathname, "/courses/new")) {
      return section("/courses", "nav.courses", "courses.create.title");
    }
    if (isAtOrBelow(pathname, "/courses/intake")) {
      return {
        sectionHref: "/courses",
        breadcrumbs: [
          { href: "/courses", label: "nav.courses" },
          { href: "/courses/import", label: "courses.import.title" },
          { label: "courses.intake.title" },
        ],
      };
    }
    if (isAtOrBelow(pathname, "/courses/import")) {
      return section("/courses", "nav.courses", "courses.import.title");
    }
    if (
      isAtOrBelow(pathname, "/courses/studio") ||
      pathname.includes("/studio/") ||
      pathname.endsWith("/studio")
    ) {
      return section("/courses", "nav.courses", "shell.route.studio");
    }
    if (pathname.includes("/revisions/")) {
      return section("/courses", "nav.courses", "home.courseRoadmap");
    }
    return section(
      "/courses",
      "nav.courses",
      pathname === "/courses" ? undefined : "shell.route.course",
    );
  }

  if (isAtOrBelow(pathname, "/interview")) {
    return section("/review", "nav.review", "interview.title");
  }
  if (isAtOrBelow(pathname, "/mistakes")) {
    return section("/review", "nav.review", "review.view.mistakes");
  }
  if (isAtOrBelow(pathname, "/flashcards")) {
    return section("/review", "nav.review", "review.view.cards");
  }
  if (isAtOrBelow(pathname, "/review")) {
    return section("/review", "nav.review");
  }

  if (isAtOrBelow(pathname, "/skills") || isAtOrBelow(pathname, "/knowledge")) {
    return section("/skills", "nav.skills");
  }

  if (isAtOrBelow(pathname, "/settings/developer-tools")) {
    return section("/settings", "nav.settings", "ui.developerTools.title");
  }
  if (isAtOrBelow(pathname, "/settings")) {
    return section("/settings", "nav.settings");
  }

  return {
    sectionHref: null,
    breadcrumbs: [{ label: "brand.name" }],
  };
}
