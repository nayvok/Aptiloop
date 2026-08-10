import type { MessageKey } from "@/lib/i18n";
import type { UnitStatus, UnitType } from "@/lib/unit-labels";

export type LearningBlockId = "study" | "check" | "practice";

export interface BlockUnit {
  id: string;
  type: UnitType;
  title: string;
  estimatedMinutes: number;
  /** Status comes from the path DTO or is derived from session progress. */
  status?: UnitStatus;
}

export type BlockStatus = "completed" | "in_progress" | "ready" | "locked";

export interface LearningBlock {
  id: LearningBlockId;
  label: MessageKey;
  units: BlockUnit[];
  status: BlockStatus;
  completedCount: number;
  totalCount: number;
  /** One-based current step index; null after the block is complete. */
  currentStepIndex: number | null;
  currentUnit: BlockUnit | null;
  estimatedMinutes: number;
  remainingMinutes: number;
}

const BLOCK_LABELS: Readonly<Record<LearningBlockId, MessageKey>> = {
  study: "home.phase.study",
  check: "home.phase.check",
  practice: "home.phase.practice",
};

const BLOCK_UNIT_TYPES: Record<LearningBlockId, ReadonlySet<UnitType>> = {
  study: new Set(["briefing", "study"]),
  check: new Set([
    "recall",
    "teacher-dialogue",
    "quiz",
    "code-reading",
    "interview",
  ]),
  practice: new Set([
    "exercise",
    "review",
    "summary",
    "checkpoint",
    "spaced-review",
  ]),
};

export const BLOCK_ORDER: readonly LearningBlockId[] = [
  "study",
  "check",
  "practice",
];

export function blockForUnitType(type: UnitType): LearningBlockId {
  for (const block of BLOCK_ORDER) {
    if (BLOCK_UNIT_TYPES[block].has(type)) return block;
  }
  return "practice";
}

function blockStatus(
  units: readonly BlockUnit[],
  statusFor: (unit: BlockUnit) => UnitStatus,
): { status: BlockStatus; completedCount: number } {
  const completedCount = units.filter((unit) => {
    const status = statusFor(unit);
    return status === "completed" || status === "skipped";
  }).length;
  const firstOpen = units.find((unit) => {
    const status = statusFor(unit);
    return status !== "completed" && status !== "skipped";
  });
  let status: BlockStatus = units.length === 0 ? "locked" : "completed";
  if (firstOpen) {
    const firstStatus = statusFor(firstOpen);
    status =
      firstStatus === "in_progress"
        ? "in_progress"
        : firstStatus === "ready"
          ? "ready"
          : "locked";
  }
  return { status, completedCount };
}

export function groupDayIntoBlocks(
  units: readonly BlockUnit[],
  statusFor: (unit: BlockUnit) => UnitStatus,
): LearningBlock[] {
  return BLOCK_ORDER.map((blockId) => {
    const blockUnits = units.filter((unit) =>
      BLOCK_UNIT_TYPES[blockId].has(unit.type),
    );
    const { status, completedCount } = blockStatus(blockUnits, statusFor);
    const firstOpenIndex = blockUnits.findIndex((unit) => {
      const unitStatus = statusFor(unit);
      return unitStatus !== "completed" && unitStatus !== "skipped";
    });
    const currentUnit =
      firstOpenIndex >= 0 ? (blockUnits[firstOpenIndex] ?? null) : null;
    const estimatedMinutes = blockUnits.reduce(
      (sum, unit) => sum + unit.estimatedMinutes,
      0,
    );
    const remainingMinutes = blockUnits
      .filter((unit) => {
        const unitStatus = statusFor(unit);
        return unitStatus !== "completed" && unitStatus !== "skipped";
      })
      .reduce((sum, unit) => sum + unit.estimatedMinutes, 0);
    return {
      id: blockId,
      label: BLOCK_LABELS[blockId],
      units: blockUnits,
      status,
      completedCount,
      totalCount: blockUnits.length,
      currentStepIndex: firstOpenIndex >= 0 ? firstOpenIndex + 1 : null,
      currentUnit,
      estimatedMinutes,
      remainingMinutes,
    };
  });
}

/**
 * Current unit for the day: in_progress → first ready → last completed → first.
 * Same logic as session-client, shared by Path and Session.
 */
export function focusedUnit(
  units: readonly BlockUnit[],
  statusFor: (unit: BlockUnit) => UnitStatus,
): BlockUnit | null {
  return (
    units.find((unit) => statusFor(unit) === "in_progress") ??
    units.find((unit) => statusFor(unit) === "ready") ??
    [...units]
      .reverse()
      .find(
        (unit) =>
          statusFor(unit) === "completed" || statusFor(unit) === "skipped",
      ) ??
    units[0] ??
    null
  );
}

export function remainingDayMinutes(blocks: readonly LearningBlock[]): number {
  return blocks.reduce((sum, block) => sum + block.remainingMinutes, 0);
}

export function completedBlockCount(blocks: readonly LearningBlock[]): number {
  return blocks.filter(
    (block) => block.status === "completed" && block.totalCount > 0,
  ).length;
}
