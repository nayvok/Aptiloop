import { describe, expect, it } from "vitest";

import {
  createUnitProgression,
  isLessonComplete,
  transitionUnitProgression,
  type UnitDefinition,
} from "../src/unit-progression.js";

const units = [
  { id: "briefing", optional: false },
  { id: "study", optional: false },
  { id: "bonus", optional: true },
  {
    id: "summary",
    optional: false,
    prerequisiteUnitIds: ["study"],
  },
] as const satisfies readonly UnitDefinition[];

describe("unit progression", () => {
  it("starts with the first unit ready and later units locked", () => {
    const state = createUnitProgression(units);
    expect(state.map(({ status }) => status)).toEqual([
      "ready",
      "locked",
      "locked",
      "locked",
    ]);
    expect(isLessonComplete(units, state)).toBe(false);
  });

  it("cannot start a locked unit", () => {
    const state = createUnitProgression(units);
    expect(
      transitionUnitProgression(units, state, {
        type: "start",
        unitId: "study",
      }),
    ).toMatchObject({ valid: false, reason: "unit_locked" });
  });

  it("does not allow a required unit to be skipped", () => {
    const state = createUnitProgression(units);
    expect(
      transitionUnitProgression(units, state, {
        type: "skip",
        unitId: "briefing",
      }),
    ).toMatchObject({
      valid: false,
      reason: "required_unit_cannot_be_skipped",
    });
  });

  it("completes an in-progress unit and unlocks only eligible next units", () => {
    const initial = createUnitProgression(units);
    const started = transitionUnitProgression(units, initial, {
      type: "start",
      unitId: "briefing",
    });
    if (!started.valid) throw new Error("expected start to succeed");
    const completed = transitionUnitProgression(units, started.progress, {
      type: "complete",
      unitId: "briefing",
    });
    expect(completed.valid).toBe(true);
    if (!completed.valid) return;
    expect(completed.progress.map(({ status }) => status)).toEqual([
      "completed",
      "ready",
      "locked",
      "locked",
    ]);
  });

  it("completes a lesson only when every required unit is completed", () => {
    expect(
      isLessonComplete(units, [
        { unitId: "briefing", status: "completed" },
        { unitId: "study", status: "completed" },
        { unitId: "bonus", status: "ready" },
        { unitId: "summary", status: "completed" },
      ]),
    ).toBe(true);
    expect(
      isLessonComplete(units, [
        { unitId: "briefing", status: "completed" },
        { unitId: "study", status: "completed" },
        { unitId: "bonus", status: "skipped" },
        { unitId: "summary", status: "in_progress" },
      ]),
    ).toBe(false);
  });

  it("rejects invalid definitions and malformed persisted progress", () => {
    expect(() =>
      createUnitProgression([
        { id: "a", optional: false, prerequisiteUnitIds: ["missing"] },
      ]),
    ).toThrow("unknown prerequisite");
    expect(
      transitionUnitProgression(
        [{ id: "a", optional: false }],
        [
          { unitId: "a", status: "ready" },
          { unitId: "a", status: "locked" },
        ],
        { type: "start", unitId: "a" },
      ),
    ).toMatchObject({ valid: false, reason: "invalid_progress_state" });
  });
});
