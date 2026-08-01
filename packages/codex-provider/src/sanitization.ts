const SAFE_TOOL_STATUSES = new Set([
  "pending",
  "inProgress",
  "running",
  "completed",
  "failed",
  "cancelled",
  "interrupted",
  "declined",
]);

export function safeToolStatus(value: unknown): string {
  return typeof value === "string" && SAFE_TOOL_STATUSES.has(value)
    ? value
    : "unknown";
}

export function redactSensitiveText(value: string): string {
  return value
    .replace(
      /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
      "[REDACTED]",
    )
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, "[REDACTED]")
    .replace(
      /\b(?:github_pat_[A-Za-z0-9_]{16,}|gh[oprsu]_[A-Za-z0-9]{16,}|glpat-[A-Za-z0-9_-]{16,}|sk-(?:proj-)?[A-Za-z0-9_-]{16,})\b/g,
      "[REDACTED]",
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{16,}\b/gi, "Bearer [REDACTED]")
    .replace(
      /\b(password|passwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token)\s*[:=]\s*(?:"[^"]+"|'[^']+'|[^\s,;]+)/gi,
      "$1=[REDACTED]",
    );
}
