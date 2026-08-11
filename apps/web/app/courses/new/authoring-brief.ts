import { CourseLocaleSchema } from "@aptiloop/shared";
import { z } from "zod";

export const AUTHORING_BRIEF_DESCRIPTION_MAX_LENGTH = 9_999;

export const AuthoringBriefSchema = z
  .object({
    topicGoal: z.string().trim().min(1).max(500),
    targetOutcome: z.string().trim().min(1).max(1_500),
    currentLevel: z.string().trim().min(1).max(300),
    primaryLocale: CourseLocaleSchema,
    pacing: z.string().trim().min(1).max(500),
    tools: z.string().trim().max(1_000),
    accessibility: z.string().trim().max(1_000),
    constraints: z.string().trim().max(2_500),
  })
  .strict();

export type AuthoringBrief = z.infer<typeof AuthoringBriefSchema>;

export const AuthoringBriefDraftSchema = z
  .object({
    topicGoal: z.string().max(500),
    targetOutcome: z.string().max(1_500),
    currentLevel: z.string().max(300),
    primaryLocale: z.string().max(35),
    pacing: z.string().max(500),
    tools: z.string().max(1_000),
    accessibility: z.string().max(1_000),
    constraints: z.string().max(2_500),
  })
  .strict();

export type AuthoringBriefDraft = z.infer<typeof AuthoringBriefDraftSchema>;

export function emptyAuthoringBriefDraft(): AuthoringBriefDraft {
  return {
    topicGoal: "",
    targetOutcome: "",
    currentLevel: "",
    primaryLocale: "",
    pacing: "",
    tools: "",
    accessibility: "",
    constraints: "",
  };
}

const descriptionPrefix = "Aptiloop authoring brief v2\n";
const briefFieldOrder = [
  "topicGoal",
  "targetOutcome",
  "currentLevel",
  "primaryLocale",
  "pacing",
  "tools",
  "accessibility",
  "constraints",
] as const satisfies readonly (keyof AuthoringBrief)[];

/**
 * Encodes validated fields with JavaScript UTF-16 code-unit lengths. This keeps
 * embedded newlines and sentinel-like text exact while remaining bounded by the
 * existing curriculum description contract.
 */
export function authoringBriefDescription(input: AuthoringBrief): string {
  const brief = AuthoringBriefSchema.parse(input);
  const description = briefFieldOrder.reduce(
    (result, key) => `${result}${key}:${brief[key].length}\n${brief[key]}`,
    descriptionPrefix,
  );
  if (description.length > AUTHORING_BRIEF_DESCRIPTION_MAX_LENGTH) {
    throw new RangeError(
      "Authoring brief description exceeds 9,999 characters",
    );
  }
  return description;
}

function parseLengthPrefixedBrief(description: string): AuthoringBrief | null {
  if (
    !description.startsWith(descriptionPrefix) ||
    description.length > AUTHORING_BRIEF_DESCRIPTION_MAX_LENGTH
  ) {
    return null;
  }
  let cursor = descriptionPrefix.length;
  const values: Partial<Record<keyof AuthoringBrief, string>> = {};
  for (const key of briefFieldOrder) {
    const fieldPrefix = `${key}:`;
    if (!description.startsWith(fieldPrefix, cursor)) return null;
    cursor += fieldPrefix.length;
    const newline = description.indexOf("\n", cursor);
    if (newline < 0) return null;
    const lengthText = description.slice(cursor, newline);
    if (!/^\d{1,5}$/u.test(lengthText)) return null;
    const length = Number(lengthText);
    cursor = newline + 1;
    const end = cursor + length;
    if (end > description.length) return null;
    values[key] = description.slice(cursor, end);
    cursor = end;
  }
  if (cursor !== description.length) return null;
  const parsed = AuthoringBriefSchema.safeParse(values);
  return parsed.success ? parsed.data : null;
}

function parseLegacyBrief(description: string): AuthoringBrief | null {
  const lines = description.split("\n");
  if (lines[0] !== "Authoring brief") return null;
  const read = (index: number, prefix: string) => {
    const line = lines[index];
    return line?.startsWith(prefix) ? line.slice(prefix.length).trim() : "";
  };
  const optional = (value: string) => (value === "Not specified" ? "" : value);
  const parsed = AuthoringBriefSchema.safeParse({
    topicGoal: read(1, "Topic / goal:"),
    targetOutcome: read(2, "Target outcome:"),
    currentLevel: read(3, "Current level:"),
    primaryLocale: read(4, "Primary locale:"),
    pacing: read(5, "Pacing:"),
    tools: optional(read(6, "Tools and access:")),
    accessibility: optional(read(7, "Accessibility:")),
    constraints: optional(read(8, "Constraints:")),
  });
  return parsed.success ? parsed.data : null;
}

export function parseAuthoringBriefDescription(
  description: string | null | undefined,
): AuthoringBrief | null {
  if (!description) return null;
  return description.startsWith(descriptionPrefix)
    ? parseLengthPrefixedBrief(description)
    : parseLegacyBrief(description);
}
