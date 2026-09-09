import { learningKernelSha256 } from "./canonical-hash.js";

export interface ActivityContractInput {
  readonly type: string;
  readonly schemaVersion?: number | undefined;
  readonly required: boolean;
  readonly payload: unknown;
  readonly completionCriteria: unknown;
  readonly capabilityIds?: readonly string[] | undefined;
  readonly knowledgeNodeIds?: readonly string[] | undefined;
  readonly protectedMaterial?: unknown;
  readonly checkIds?: readonly string[] | undefined;
  readonly environmentIds?: readonly string[] | undefined;
}

function sortedStrings(values: readonly string[] | undefined): string[] {
  return [...(values ?? [])].sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
}

function derivedCheckIds(input: ActivityContractInput): string[] {
  if (input.checkIds !== undefined) return sortedStrings(input.checkIds);
  const payload = input.payload as Record<string, unknown> | null;
  if (
    payload !== null &&
    typeof payload === "object" &&
    typeof payload["testCommandId"] === "string" &&
    payload["testCommandId"].length > 0
  ) {
    return [payload["testCommandId"] as string];
  }
  return [];
}

function derivedEnvironmentIds(input: ActivityContractInput): string[] {
  if (input.environmentIds !== undefined)
    return sortedStrings(input.environmentIds);
  const payload = input.payload as Record<string, unknown> | null;
  if (
    payload !== null &&
    typeof payload === "object" &&
    typeof payload["environmentId"] === "string" &&
    (payload["environmentId"] as string).length > 0
  ) {
    return [payload["environmentId"] as string];
  }
  return [];
}

/**
 * Deterministic contract over canonical learner task semantics.
 *
 * Covers type/schema/required, the learner-visible task payload, completion
 * criteria, knowledge/capability targets, the protected evaluation hash, and
 * trusted environment/check IDs. Omits revision/container IDs
 * (activity/lesson/course/revision/stable identity, order) and pure display
 * metadata (title/description/estimatedMinutes, prerequisites, sources).
 * Stable ID alone never carries progress: callers must compare both the
 * stable ID and this hash.
 */
export function activityContractHash(input: ActivityContractInput): string {
  const protectedHash =
    input.protectedMaterial === undefined
      ? null
      : learningKernelSha256(input.protectedMaterial);
  const contract = {
    capabilityIds: sortedStrings(input.capabilityIds),
    checkIds: derivedCheckIds(input),
    completionCriteria: input.completionCriteria,
    environmentIds: derivedEnvironmentIds(input),
    knowledgeNodeIds: sortedStrings(input.knowledgeNodeIds),
    payload: input.payload,
    protectedHash,
    required: input.required,
    schemaVersion: input.schemaVersion ?? 1,
    type: input.type,
  };
  return learningKernelSha256(contract);
}
