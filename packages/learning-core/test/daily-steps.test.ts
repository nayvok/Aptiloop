import { describe, expect, it } from "vitest";

import {
  DAILY_STEP_KINDS,
  createDailySteps,
  transitionDailyStep,
  validateDailySteps,
  type DailyStep,
} from "../src/daily-steps.js";

describe("daily step state machine", () => {
  it("creates the complete daily learning flow with only the first step ready", () => {
    const steps = createDailySteps();
    expect(steps.map((step) => step.kind)).toEqual(DAILY_STEP_KINDS);
    expect(steps.map((step) => step.status)).toEqual([
      "ready",
      ...Array.from({ length: DAILY_STEP_KINDS.length - 1 }, () => "locked"),
    ]);
    expect(validateDailySteps(steps)).toBe(true);
    expect(() => createDailySteps(["review", "review"])).toThrow(
      "duplicate daily step",
    );
  });

  it("allows ready -> in_progress -> completed and unlocks one successor", () => {
    const initial = createDailySteps(["review", "theory"]);
    const started = transitionDailyStep(initial, initial[0]!.id, "in_progress");
    expect(started.valid).toBe(true);
    if (!started.valid) return;
    expect(started.steps.map((step) => step.status)).toEqual([
      "in_progress",
      "locked",
    ]);

    const completed = transitionDailyStep(
      started.steps,
      started.steps[0]!.id,
      "completed",
    );
    expect(completed.valid).toBe(true);
    if (!completed.valid) return;
    expect(completed.steps.map((step) => step.status)).toEqual([
      "completed",
      "ready",
    ]);
  });

  it("allows pausing an in-progress step back to ready", () => {
    const initial = createDailySteps(["review"]);
    const started = transitionDailyStep(initial, initial[0]!.id, "in_progress");
    if (!started.valid) throw new Error("expected transition to be valid");
    const paused = transitionDailyStep(started.steps, initial[0]!.id, "ready");
    expect(paused.valid).toBe(true);
  });

  it("allows skipping only optional steps", () => {
    const required = createDailySteps(["review"]);
    expect(
      transitionDailyStep(required, required[0]!.id, "skipped"),
    ).toMatchObject({
      valid: false,
      reason: "required_step_cannot_be_skipped",
    });

    const optional = createDailySteps(["review", "theory"], ["review"]);
    const skipped = transitionDailyStep(optional, optional[0]!.id, "skipped");
    expect(skipped.valid).toBe(true);
    if (skipped.valid) expect(skipped.steps[1]?.status).toBe("ready");
  });

  it("does not allow locked, terminal, or out-of-order transitions", () => {
    const steps = createDailySteps(["review", "theory"]);
    expect(
      transitionDailyStep(steps, steps[1]!.id, "in_progress"),
    ).toMatchObject({
      valid: false,
      reason: "prerequisite_incomplete",
    });
    expect(transitionDailyStep(steps, steps[0]!.id, "completed")).toMatchObject(
      {
        valid: false,
        reason: "transition_not_allowed",
      },
    );

    const started = transitionDailyStep(steps, steps[0]!.id, "in_progress");
    if (!started.valid) throw new Error("expected transition to be valid");
    const completed = transitionDailyStep(
      started.steps,
      steps[0]!.id,
      "completed",
    );
    if (!completed.valid) throw new Error("expected transition to be valid");
    expect(
      transitionDailyStep(completed.steps, steps[0]!.id, "in_progress"),
    ).toMatchObject({
      valid: false,
      reason: "transition_not_allowed",
    });
  });

  it("rejects unknown steps without changing input", () => {
    const steps = createDailySteps(["review"]);
    const result = transitionDailyStep(steps, "missing", "in_progress");
    expect(result).toEqual({ valid: false, steps, reason: "step_not_found" });
  });

  it.each([
    [
      [
        { id: "a", kind: "review", status: "ready" },
        { id: "b", kind: "theory", status: "ready" },
      ],
      "two active steps",
    ],
    [
      [
        { id: "a", kind: "review", status: "locked" },
        { id: "b", kind: "theory", status: "completed" },
      ],
      "completed after unresolved",
    ],
    [[{ id: "a", kind: "review", status: "skipped" }], "required skipped"],
    [
      [
        { id: "a", kind: "review", status: "locked" },
        { id: "b", kind: "theory", status: "ready" },
      ],
      "locked before active",
    ],
  ] as const)("detects an invalid session: %s", (candidate, _description) => {
    expect(validateDailySteps(candidate as readonly DailyStep[])).toBe(false);
    expect(
      transitionDailyStep(
        candidate as readonly DailyStep[],
        "a",
        "in_progress",
      ),
    ).toMatchObject({
      valid: false,
      reason: "invalid_session_state",
    });
  });
});
