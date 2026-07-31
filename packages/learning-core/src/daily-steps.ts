export const DAILY_STEP_KINDS = [
  "review",
  "theory",
  "socratic",
  "quiz",
  "practice",
  "zed_work",
  "first_attempt",
  "review_feedback",
  "self_correction",
  "summary",
] as const;

export type DailyStepKind = (typeof DAILY_STEP_KINDS)[number];
export type DailyStepStatus =
  "locked" | "ready" | "in_progress" | "completed" | "skipped";

export interface DailyStep {
  readonly id: string;
  readonly kind: DailyStepKind;
  readonly status: DailyStepStatus;
  readonly optional?: boolean;
}

export type DailyStepTransitionResult =
  | { readonly valid: true; readonly steps: readonly DailyStep[] }
  | {
      readonly valid: false;
      readonly steps: readonly DailyStep[];
      readonly reason:
        | "step_not_found"
        | "invalid_session_state"
        | "transition_not_allowed"
        | "prerequisite_incomplete"
        | "required_step_cannot_be_skipped";
    };

export function createDailySteps(
  kinds: readonly DailyStepKind[] = DAILY_STEP_KINDS,
  optionalKinds: readonly DailyStepKind[] = [],
): DailyStep[] {
  if (kinds.length === 0) return [];
  const seenKinds = new Set<DailyStepKind>();
  return kinds.map((kind, index) => {
    if (seenKinds.has(kind))
      throw new TypeError(`duplicate daily step: ${kind}`);
    seenKinds.add(kind);
    const id = `${String(index + 1).padStart(2, "0")}-${kind}`;
    return {
      id,
      kind,
      status: index === 0 ? "ready" : "locked",
      optional: optionalKinds.includes(kind),
    };
  });
}

export function validateDailySteps(steps: readonly DailyStep[]): boolean {
  const ids = new Set<string>();
  let phase: "terminal" | "active" | "locked" = "terminal";

  for (const step of steps) {
    if (!step.id.trim() || ids.has(step.id)) return false;
    ids.add(step.id);
    if (step.status === "skipped" && step.optional !== true) return false;

    if (isTerminal(step.status)) {
      if (phase !== "terminal") return false;
      continue;
    }
    if (step.status === "ready" || step.status === "in_progress") {
      if (phase !== "terminal") return false;
      phase = "active";
      continue;
    }
    if (step.status === "locked") {
      if (phase === "terminal") return false;
      phase = "locked";
    }
  }

  return true;
}

export function transitionDailyStep(
  steps: readonly DailyStep[],
  stepId: string,
  targetStatus: DailyStepStatus,
): DailyStepTransitionResult {
  if (!validateDailySteps(steps)) {
    return { valid: false, steps, reason: "invalid_session_state" };
  }

  const index = steps.findIndex((step) => step.id === stepId);
  if (index < 0) return { valid: false, steps, reason: "step_not_found" };
  const step = steps[index];
  if (!step) return { valid: false, steps, reason: "step_not_found" };

  if (index > 0 && !isTerminal(steps[index - 1]?.status)) {
    return { valid: false, steps, reason: "prerequisite_incomplete" };
  }
  if (targetStatus === "skipped" && step.optional !== true) {
    return { valid: false, steps, reason: "required_step_cannot_be_skipped" };
  }
  if (!allowedTargets(step.status).includes(targetStatus)) {
    return { valid: false, steps, reason: "transition_not_allowed" };
  }

  const next = steps.map((item, itemIndex) =>
    itemIndex === index ? { ...item, status: targetStatus } : { ...item },
  );
  const successor = next[index + 1];
  if (isTerminal(targetStatus) && successor?.status === "locked") {
    next[index + 1] = { ...successor, status: "ready" };
  }

  return { valid: true, steps: next };
}

function allowedTargets(status: DailyStepStatus): readonly DailyStepStatus[] {
  switch (status) {
    case "locked":
      return [];
    case "ready":
      return ["in_progress", "skipped"];
    case "in_progress":
      return ["ready", "completed", "skipped"];
    case "completed":
    case "skipped":
      return [];
  }
}

function isTerminal(status: DailyStepStatus | undefined): boolean {
  return status === "completed" || status === "skipped";
}
