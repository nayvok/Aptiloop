import { describe, expect, it } from "vitest";

import {
  AgentEventSchema,
  AgentRoleSchema,
  CurriculumSourceSchema,
  CurriculumDaySchema,
  CurriculumVersionSchema,
  DepthLevelSchema,
  SessionSnapshotSchema,
  UnitProgressSchema,
  ReviewResultSchema,
} from "../src/index.js";

describe("shared contracts", () => {
  it("uses the documented depth levels and permits an explicit missing source", () => {
    expect(DepthLevelSchema.options).toEqual([
      "foundation",
      "interview-ready",
      "deep-dive",
    ]);
    expect(
      CurriculumSourceSchema.parse({
        id: "source-required-js-values",
        title: "Источник нужно назначить",
        url: null,
        kind: "source-required",
      }),
    ).toMatchObject({ required: true, estimatedMinutes: 0 });
  });

  it("exposes all supported agent roles", () => {
    expect(AgentRoleSchema.options).toHaveLength(8);
  });

  it("rejects a passed review with an error finding", () => {
    const result = ReviewResultSchema.safeParse({
      status: "passed",
      summary: "Looks fine",
      findings: [
        {
          severity: "error",
          category: "correctness",
          message: "Broken",
          hintLevel: 1,
        },
      ],
      strengths: [],
      suggestedMasteryChanges: [],
    });
    expect(result.success).toBe(false);
  });

  it("validates normalized events", () => {
    expect(
      AgentEventSchema.parse({
        type: "message.delta",
        sessionId: "session-1",
        sequence: 0,
        timestamp: "2026-07-31T12:00:00.000Z",
        delta: "Hello",
      }),
    ).toMatchObject({ type: "message.delta", delta: "Hello" });
  });

  it("validates an ordered versioned curriculum and historical snapshot", () => {
    const day = {
      id: "day-row-v2",
      stableId: "week-01-day-01",
      order: 1,
      title: "Values",
      description: "Build a precise mental model.",
      goal: "Explain values and references.",
      estimatedMinutes: 180,
      prerequisites: [],
      expectedOutcomes: ["Explain equality without guessing."],
      depthLevel: "interview-ready",
      outOfScope: ["Engine internals"],
      topics: ["values", "references"],
      units: [
        {
          id: "unit-row-v2",
          stableId: "day-01-briefing",
          type: "briefing",
          title: "Briefing",
          description: "Understand today's contract.",
          order: 1,
          estimatedMinutes: 5,
          objectives: ["Know the goal."],
          checklist: [{ id: "goal", label: "Read the goal", required: true }],
          sources: [
            {
              id: "mdn-data-types",
              title: "Data structures",
              url: "https://developer.mozilla.org/docs/Web/JavaScript/Data_structures",
              kind: "documentation",
            },
          ],
          questions: [],
          misconceptions: [],
          referenceAnswer: null,
          completionCriteria: [{ type: "acknowledgement" }],
          unlockRules: [],
          optional: false,
          depthLevel: "interview-ready",
          payload: { type: "briefing", scope: ["values"] },
        },
      ],
    } as const;

    expect(CurriculumDaySchema.parse(day).units).toHaveLength(1);
    expect(
      CurriculumVersionSchema.parse({
        id: "curriculum-v2",
        curriculumId: "js-ts-react",
        revision: 2,
        parentVersionId: "curriculum-v1",
        status: "published",
        title: "Foundation recovery",
        description: "A guided learning path.",
        contentHash: "sha256:abc",
        createdAt: "2026-07-31T08:00:00.000Z",
        publishedAt: "2026-07-31T09:00:00.000Z",
        archivedAt: null,
        weeks: [
          {
            id: "week-row-v2",
            stableId: "week-01",
            order: 1,
            title: "Foundation",
            description: "Week one",
            days: [day],
          },
        ],
      }).status,
    ).toBe("published");

    expect(
      SessionSnapshotSchema.parse({
        schemaVersion: 1,
        contentHash: "sha256:snapshot",
        curriculumId: "js-ts-react",
        curriculumVersionId: "curriculum-v2",
        curriculumRevision: 2,
        curriculumTitle: "Foundation recovery",
        week: {
          id: "week-row-v2",
          stableId: "week-01",
          order: 1,
          title: "Foundation",
          description: "Week one",
        },
        day: {
          id: day.id,
          stableId: day.stableId,
          order: day.order,
          title: day.title,
          description: day.description,
          goal: day.goal,
          estimatedMinutes: day.estimatedMinutes,
          prerequisites: day.prerequisites,
          expectedOutcomes: day.expectedOutcomes,
          depthLevel: day.depthLevel,
          outOfScope: day.outOfScope,
          topics: day.topics,
        },
        units: day.units,
        capturedAt: "2026-07-31T10:00:00.000Z",
      }).day.stableId,
    ).toBe("week-01-day-01");
  });

  it("rejects duplicate authored order and a published version without its timestamp", () => {
    const unit = {
      id: "unit-1",
      stableId: "briefing",
      type: "briefing",
      title: "Briefing",
      description: "Briefing",
      order: 1,
      estimatedMinutes: 5,
      objectives: [],
      checklist: [],
      sources: [],
      questions: [],
      misconceptions: [],
      referenceAnswer: null,
      completionCriteria: [{ type: "acknowledgement" }],
      unlockRules: [],
      optional: false,
      depthLevel: "foundation",
      payload: { type: "briefing", scope: [] },
    } as const;
    expect(
      CurriculumDaySchema.safeParse({
        id: "day-1",
        stableId: "day-1",
        order: 1,
        title: "Day",
        description: "Day",
        goal: "Goal",
        estimatedMinutes: 10,
        prerequisites: [],
        expectedOutcomes: [],
        depthLevel: "foundation",
        outOfScope: [],
        topics: [],
        units: [unit, { ...unit, id: "unit-2", stableId: "study" }],
      }).success,
    ).toBe(false);
    expect(
      CurriculumVersionSchema.safeParse({
        id: "v1",
        curriculumId: "curriculum",
        revision: 1,
        parentVersionId: null,
        status: "published",
        title: "Version",
        description: "Version",
        contentHash: "sha256:x",
        createdAt: "2026-07-31T08:00:00.000Z",
        publishedAt: null,
        archivedAt: null,
        weeks: [],
      }).success,
    ).toBe(false);
  });

  it("validates type-specific unit progress and rejects a mismatched payload", () => {
    expect(
      UnitProgressSchema.parse({
        unitId: "quiz-unit",
        unitType: "quiz",
        status: "in_progress",
        payload: {
          type: "quiz",
          attemptedQuestionIds: ["q1", "q2"],
          correctQuestionIds: ["q1"],
          score: 0.5,
        },
        startedAt: "2026-07-31T10:00:00.000Z",
        completedAt: null,
        skippedAt: null,
        updatedAt: "2026-07-31T10:05:00.000Z",
      }).payload.type,
    ).toBe("quiz");

    expect(
      UnitProgressSchema.safeParse({
        unitId: "quiz-unit",
        unitType: "quiz",
        status: "in_progress",
        payload: { type: "study", checkedItemIds: [] },
        startedAt: "2026-07-31T10:00:00.000Z",
        completedAt: null,
        skippedAt: null,
        updatedAt: "2026-07-31T10:05:00.000Z",
      }).success,
    ).toBe(false);
  });
});
