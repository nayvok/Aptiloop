export const UNIT_STATUSES = [
  "locked",
  "ready",
  "in_progress",
  "completed",
  "skipped",
] as const;

export type UnitProgressionStatus = (typeof UNIT_STATUSES)[number];

export interface UnitDefinition {
  readonly id: string;
  readonly optional: boolean;
  /**
   * Omit for the usual linear flow. An explicit empty list makes the unit
   * immediately available; explicit IDs model branching unlock rules.
   */
  readonly prerequisiteUnitIds?: readonly string[];
}
export interface ExplicitUnitPrerequisiteDefinition {
  readonly id: string;
  readonly stableId: string;
  readonly optional: boolean;
  readonly prerequisiteStableIds: readonly string[];
}

/** Resolves authored stable-ID edges into explicit runtime unit-ID edges. */
export function resolveExplicitUnitDefinitions(
  units: readonly ExplicitUnitPrerequisiteDefinition[],
): UnitDefinition[] {
  const idByStableId = new Map<string, string>();
  for (const unit of units) {
    if (!unit.stableId.trim()) {
      throw new TypeError("unit stable ID must not be empty");
    }
    if (idByStableId.has(unit.stableId)) {
      throw new TypeError(`duplicate unit stable ID: ${unit.stableId}`);
    }
    idByStableId.set(unit.stableId, unit.id);
  }
  return units.map((unit) => ({
    id: unit.id,
    optional: unit.optional,
    prerequisiteUnitIds: unit.prerequisiteStableIds.map((stableId) => {
      const id = idByStableId.get(stableId);
      if (id === undefined) {
        throw new TypeError(
          `unknown prerequisite stable ID ${stableId} for unit ${unit.id}`,
        );
      }
      return id;
    }),
  }));
}

export interface UnitProgressionItem {
  readonly unitId: string;
  readonly status: UnitProgressionStatus;
}

export type UnitProgressionEvent =
  | { readonly type: "start"; readonly unitId: string }
  | { readonly type: "pause"; readonly unitId: string }
  | { readonly type: "complete"; readonly unitId: string }
  | { readonly type: "skip"; readonly unitId: string };

export type UnitProgressionFailureReason =
  | "unit_not_found"
  | "invalid_progress_state"
  | "unit_locked"
  | "transition_not_allowed"
  | "required_unit_cannot_be_skipped";

export type UnitProgressionResult =
  | { readonly valid: true; readonly progress: readonly UnitProgressionItem[] }
  | {
      readonly valid: false;
      readonly progress: readonly UnitProgressionItem[];
      readonly reason: UnitProgressionFailureReason;
    };

export function createUnitProgression(
  units: readonly UnitDefinition[],
): UnitProgressionItem[] {
  const prerequisites = validateAndResolveDefinitions(units);
  return units.map((unit) => ({
    unitId: unit.id,
    status: prerequisites.get(unit.id)?.length === 0 ? "ready" : "locked",
  }));
}

export function transitionUnitProgression(
  units: readonly UnitDefinition[],
  progress: readonly UnitProgressionItem[],
  event: UnitProgressionEvent,
): UnitProgressionResult {
  const prerequisites = validateAndResolveDefinitions(units);
  if (!isValidProgress(units, progress)) {
    return { valid: false, progress, reason: "invalid_progress_state" };
  }

  const unitIndex = units.findIndex((unit) => unit.id === event.unitId);
  const progressIndex = progress.findIndex(
    (item) => item.unitId === event.unitId,
  );
  const unit = units[unitIndex];
  const current = progress[progressIndex];
  if (unitIndex < 0 || progressIndex < 0 || !unit || !current) {
    return { valid: false, progress, reason: "unit_not_found" };
  }

  if (event.type === "skip" && !unit.optional) {
    return {
      valid: false,
      progress,
      reason: "required_unit_cannot_be_skipped",
    };
  }
  if (event.type === "start" && current.status === "locked") {
    return { valid: false, progress, reason: "unit_locked" };
  }

  const targetStatus = targetStatusForEvent(current.status, event.type);
  if (targetStatus === null) {
    return { valid: false, progress, reason: "transition_not_allowed" };
  }

  const next = progress.map((item) =>
    item.unitId === event.unitId
      ? { ...item, status: targetStatus }
      : { ...item },
  );
  if (targetStatus === "completed" || targetStatus === "skipped") {
    unlockEligibleUnits(next, prerequisites);
  }
  return { valid: true, progress: next };
}

export function isLessonComplete(
  units: readonly UnitDefinition[],
  progress: readonly UnitProgressionItem[],
): boolean {
  validateAndResolveDefinitions(units);
  if (!isValidProgress(units, progress)) return false;
  const byUnitId = new Map(progress.map((item) => [item.unitId, item.status]));
  return units.every(
    (unit) => unit.optional || byUnitId.get(unit.id) === "completed",
  );
}

function targetStatusForEvent(
  current: UnitProgressionStatus,
  event: UnitProgressionEvent["type"],
): UnitProgressionStatus | null {
  switch (event) {
    case "start":
      return current === "ready" ? "in_progress" : null;
    case "pause":
      return current === "in_progress" ? "ready" : null;
    case "complete":
      return current === "in_progress" ? "completed" : null;
    case "skip":
      return current === "ready" || current === "in_progress"
        ? "skipped"
        : null;
  }
}

function unlockEligibleUnits(
  progress: UnitProgressionItem[],
  prerequisites: ReadonlyMap<string, readonly string[]>,
): void {
  const statuses = new Map(
    progress.map((item) => [item.unitId, item.status] as const),
  );
  progress.forEach((item, index) => {
    if (item.status !== "locked") return;
    const requiredIds = prerequisites.get(item.unitId) ?? [];
    if (
      requiredIds.every((id) => {
        const status = statuses.get(id);
        return status === "completed" || status === "skipped";
      })
    ) {
      progress[index] = { ...item, status: "ready" };
    }
  });
}

function isValidProgress(
  units: readonly UnitDefinition[],
  progress: readonly UnitProgressionItem[],
): boolean {
  if (units.length !== progress.length) return false;
  const unitById = new Map(units.map((unit) => [unit.id, unit] as const));
  const seen = new Set<string>();
  for (const item of progress) {
    const unit = unitById.get(item.unitId);
    if (
      !unit ||
      seen.has(item.unitId) ||
      !UNIT_STATUSES.includes(item.status)
    ) {
      return false;
    }
    if (item.status === "skipped" && !unit.optional) return false;
    seen.add(item.unitId);
  }
  return seen.size === unitById.size;
}

function validateAndResolveDefinitions(
  units: readonly UnitDefinition[],
): ReadonlyMap<string, readonly string[]> {
  const byId = new Map<string, UnitDefinition>();
  units.forEach((unit) => {
    if (!unit.id.trim()) throw new TypeError("unit ID must not be empty");
    if (byId.has(unit.id)) throw new TypeError(`duplicate unit ID: ${unit.id}`);
    byId.set(unit.id, unit);
  });

  const firstRequiredIndex = units.findIndex((unit) => !unit.optional);
  const prerequisites = new Map<string, readonly string[]>();
  units.forEach((unit, index) => {
    const explicit = unit.prerequisiteUnitIds;
    const resolved =
      explicit !== undefined
        ? [...explicit]
        : index === 0 || index === firstRequiredIndex
          ? []
          : [units[index - 1]!.id];
    const seen = new Set<string>();
    resolved.forEach((prerequisiteId) => {
      if (!byId.has(prerequisiteId)) {
        throw new TypeError(
          `unknown prerequisite ${prerequisiteId} for unit ${unit.id}`,
        );
      }
      if (prerequisiteId === unit.id) {
        throw new TypeError(`unit ${unit.id} cannot unlock itself`);
      }
      if (seen.has(prerequisiteId)) {
        throw new TypeError(
          `duplicate prerequisite ${prerequisiteId} for unit ${unit.id}`,
        );
      }
      seen.add(prerequisiteId);
    });
    prerequisites.set(unit.id, resolved);
  });
  assertAcyclic(prerequisites);
  return prerequisites;
}

function assertAcyclic(
  prerequisites: ReadonlyMap<string, readonly string[]>,
): void {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (unitId: string): void => {
    if (visiting.has(unitId)) {
      throw new TypeError(`cyclic unit prerequisites at ${unitId}`);
    }
    if (visited.has(unitId)) return;
    visiting.add(unitId);
    for (const prerequisiteId of prerequisites.get(unitId) ?? []) {
      visit(prerequisiteId);
    }
    visiting.delete(unitId);
    visited.add(unitId);
  };
  for (const unitId of prerequisites.keys()) visit(unitId);
}
