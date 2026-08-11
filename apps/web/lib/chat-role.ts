export const CHAT_ROLES = [
  "teacher",
  "reviewer",
  "interviewer",
  "curator",
  "codex-expert",
] as const;

export type ChatRole = (typeof CHAT_ROLES)[number];

export const DEFAULT_CHAT_ROLE: ChatRole = "teacher";

const CHAT_ROLE_SET = new Set<string>(CHAT_ROLES);

export function isChatRole(value: unknown): value is ChatRole {
  return typeof value === "string" && CHAT_ROLE_SET.has(value);
}

export function resolveChatRole(roleValues: readonly string[]): {
  role: ChatRole;
  needsCanonicalization: boolean;
} {
  if (roleValues.length === 1 && isChatRole(roleValues[0])) {
    return { role: roleValues[0], needsCanonicalization: false };
  }
  return { role: DEFAULT_CHAT_ROLE, needsCanonicalization: true };
}

export function chatRoleHref(
  pathname: string,
  currentSearch: string,
  role: ChatRole,
): string {
  const next = new URLSearchParams(currentSearch);
  next.set("role", role);
  return `${pathname}?${next.toString()}`;
}
