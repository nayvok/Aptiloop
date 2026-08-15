import type { MessageKey } from "@/lib/i18n";

type RouteTitleSearchParams = Pick<URLSearchParams, "get">;

const trailingSlashPattern = /\/+$/u;

const reviewTitleKeys = {
  due: "review.view.due",
  mistakes: "review.view.mistakes",
  cards: "review.view.cards",
  interviews: "review.view.interviews",
} as const satisfies Readonly<Record<string, MessageKey>>;

const settingsTitleKeys = {
  interface: "settings.section.interface",
  ai: "settings.section.ai",
  connections: "settings.section.connections",
  advanced: "settings.section.local",
} as const satisfies Readonly<Record<string, MessageKey>>;

function normalizePathname(pathname: string): string {
  if (pathname === "/") return pathname;
  return pathname.replace(trailingSlashPattern, "") || "/";
}

function isAtOrBelow(pathname: string, route: string): boolean {
  return pathname === route || pathname.startsWith(`${route}/`);
}

function allowlistedTitle(
  value: string | null,
  titles: Readonly<Record<string, MessageKey>>,
): MessageKey | null {
  return value === null ? null : (titles[value] ?? null);
}

/**
 * Resolves a localized, privacy-safe browser title label.
 *
 * The result is derived only from known route shapes and controlled enum
 * values. Entity names, identifiers, and arbitrary query values never become
 * document-title content.
 */
export function resolveRouteTitleKey(
  rawPathname: string,
  searchParams?: RouteTitleSearchParams,
): MessageKey | null {
  const pathname = normalizePathname(rawPathname);

  if (pathname === "/") return "nav.home";

  if (isAtOrBelow(pathname, "/session")) return "shell.route.lesson";
  if (isAtOrBelow(pathname, "/exercise")) return "unit.type.exercise";

  if (pathname === "/flashcards") return "review.view.cards";
  if (pathname === "/mistakes") return "review.view.mistakes";
  if (pathname === "/knowledge") return "nav.skills";
  if (pathname === "/settings/curriculum") return "nav.courses";

  if (isAtOrBelow(pathname, "/courses/new/external")) {
    return "authoring.external.title";
  }
  if (isAtOrBelow(pathname, "/courses/new/guided")) {
    return "authoring.connected.title";
  }
  if (isAtOrBelow(pathname, "/courses/new/manual")) {
    return "authoring.manual.fallback";
  }
  if (isAtOrBelow(pathname, "/courses/new")) return "courses.create.title";
  if (isAtOrBelow(pathname, "/courses/intake")) {
    return "courses.intake.title";
  }
  if (isAtOrBelow(pathname, "/courses/import")) {
    return "courses.import.title";
  }
  if (isAtOrBelow(pathname, "/courses/studio")) {
    return "shell.route.studio";
  }
  if (isAtOrBelow(pathname, "/courses")) {
    return pathname.includes("/revisions/")
      ? "home.courseRoadmap"
      : pathname === "/courses"
        ? "nav.courses"
        : "shell.route.course";
  }

  if (isAtOrBelow(pathname, "/interview")) return "interview.title";
  if (isAtOrBelow(pathname, "/review")) {
    return (
      allowlistedTitle(searchParams?.get("view") ?? null, reviewTitleKeys) ??
      "nav.review"
    );
  }
  if (isAtOrBelow(pathname, "/skills")) return "nav.skills";

  if (isAtOrBelow(pathname, "/settings/developer-tools")) {
    return "ui.developerTools.title";
  }
  if (isAtOrBelow(pathname, "/settings")) {
    return (
      allowlistedTitle(
        searchParams?.get("section") ?? null,
        settingsTitleKeys,
      ) ?? "nav.settings"
    );
  }

  return null;
}
