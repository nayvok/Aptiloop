import { createHash } from "node:crypto";

const tutorMessageNamespace = "tutor-unit:v2";
const tutorMessageScopeTokenPattern = /^[a-f0-9]{64}$/u;

export type TutorMessageRole = "user" | "assistant";

export interface TutorTurnMessageScope {
  readonly unitScopeToken: string;
  readonly turnId: string;
  readonly role: TutorMessageRole;
}

export function tutorUnitScopeToken(unitId: string): string {
  return createHash("sha256").update(unitId, "utf8").digest("hex");
}

export function tutorUnitMessagePrefix(unitId: string): string {
  return `${tutorMessageNamespace}:${tutorUnitScopeToken(unitId)}:agent-turn:`;
}

export function tutorTurnMessageKey(
  unitId: string,
  turnId: string,
  role: TutorMessageRole,
): string {
  if (turnId.length === 0 || turnId.includes(":")) {
    throw new Error("Tutor turn IDs must be non-empty and colon-free");
  }
  return `${tutorUnitMessagePrefix(unitId)}${turnId}:${role}`;
}

export function parseTutorTurnMessageKey(
  value: string,
): TutorTurnMessageScope | null {
  const namespacePrefix = `${tutorMessageNamespace}:`;
  if (!value.startsWith(namespacePrefix)) return null;
  const remainder = value.slice(namespacePrefix.length);
  const scopeSeparator = remainder.indexOf(":agent-turn:");
  if (scopeSeparator < 0) return null;
  const unitScopeToken = remainder.slice(0, scopeSeparator);
  if (!tutorMessageScopeTokenPattern.test(unitScopeToken)) return null;
  const turnAndRole = remainder.slice(scopeSeparator + ":agent-turn:".length);
  const roleSeparator = turnAndRole.lastIndexOf(":");
  if (roleSeparator <= 0) return null;
  const turnId = turnAndRole.slice(0, roleSeparator);
  const role = turnAndRole.slice(roleSeparator + 1);
  if (turnId.includes(":") || (role !== "user" && role !== "assistant")) {
    return null;
  }
  return { unitScopeToken, turnId, role };
}

export function isTutorMessageKeyForUnit(
  value: string,
  unitId: string,
): boolean {
  return (
    parseTutorTurnMessageKey(value)?.unitScopeToken ===
    tutorUnitScopeToken(unitId)
  );
}
