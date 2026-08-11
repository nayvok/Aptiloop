import { describe, expect, it } from "vitest";

import {
  canonicalLearningKernelJson,
  isLearningKernelReviewDue,
  learningKernelSha256,
  LearningKernelConflictError,
  LearningKernelValidationError,
  projectLearningKernel,
  reduceLearningKernel,
  type LearningKernelActivity,
  type LearningKernelCommand,
  type LearningKernelFact,
  type LearningKernelFactBody,
  type LearningKernelFactProvenance,
  type LearningKernelScope,
} from "../src/index.js";

const scope: LearningKernelScope = {
  courseId: "course-1",
  revisionId: "revision-1",
  branchId: "branch-1",
  sessionId: "session-1",
};
const activities: LearningKernelActivity[] = [
  {
    id: "activity-recall",
    optional: false,
    prerequisiteUnitIds: [],
    knowledgeNodeIds: ["node-1"],
  },
  {
    id: "activity-apply",
    optional: false,
    prerequisiteUnitIds: ["activity-recall"],
    knowledgeNodeIds: ["node-1"],
  },
];
const learner: LearningKernelFactProvenance = {
  kind: "learner_submission",
  sourceId: "browser-operation",
  sourceHash: `sha256:${"a".repeat(64)}`,
};
const evaluator: LearningKernelFactProvenance = {
  kind: "deterministic_evaluator",
  sourceId: "objective-evaluator",
  sourceHash: `sha256:${"b".repeat(64)}`,
  evaluatorVersion: "objective-v1",
};

function command(
  operationId: string,
  factId: string,
  observedAt: string,
  provenance: LearningKernelFactProvenance,
  body: LearningKernelFactBody,
): LearningKernelCommand {
  return { operationId, factId, observedAt, provenance, body };
}

function evidence(
  outcome: "unverified" | "incorrect" | "partial" | "correct",
  basisFactIds: readonly string[],
  errorFamily?: string,
): LearningKernelFactBody {
  return {
    type: "evidence",
    activityId: "activity-recall",
    knowledgeNodeIds: ["node-1"],
    dimension: "understanding",
    evidenceType: "recall",
    outcome,
    hintLevel: 0,
    basisFactIds,
    ...(errorFamily === undefined ? {} : { errorFamily }),
  };
}

function reduce(
  facts: readonly LearningKernelFact[],
  value: LearningKernelCommand,
) {
  return reduceLearningKernel({ scope, activities, facts, command: value });
}

describe("Learning Kernel", () => {
  it("keeps learner narrative unverified until persisted evaluator evidence arrives", () => {
    const attempt = reduce(
      [],
      command(
        "operation-attempt",
        "fact-attempt",
        "2026-08-10T09:00:00.000Z",
        learner,
        evidence("unverified", []),
      ),
    );
    expect(
      attempt.projection.masteryByKnowledgeNode["node-1"]?.understanding.state
        .score,
    ).toBe(0);
    expect(attempt.projection.mistakes).toEqual([]);

    const evaluated = reduce(
      attempt.facts,
      command(
        "operation-evaluation",
        "fact-evaluation",
        "2026-08-10T09:00:01.000Z",
        evaluator,
        evidence("correct", ["fact-attempt"]),
      ),
    );
    const understanding =
      evaluated.projection.masteryByKnowledgeNode["node-1"]?.understanding;
    expect(understanding?.state.score).toBe(0.488);
    expect(understanding?.sourceFactIds).toEqual(["fact-evaluation"]);
    expect(understanding?.confidence).toBe(0.625);
    expect(evaluated.projection.summary.sourceFactIds).toEqual([
      "fact-attempt",
      "fact-evaluation",
    ]);
  });

  it("owns terminal progression and next-action selection", () => {
    const started = reduce(
      [],
      command(
        "operation-start",
        "fact-start",
        "2026-08-10T09:00:00.000Z",
        learner,
        {
          type: "progress",
          activityId: "activity-recall",
          transition: "start",
        },
      ),
    );
    expect(started.projection.nextAction).toEqual({
      type: "activity",
      activityId: "activity-recall",
      reasonCode: "resume",
    });
    expect(() =>
      reduce(
        started.facts,
        command(
          "operation-browser-complete",
          "fact-browser-complete",
          "2026-08-10T09:00:01.000Z",
          learner,
          {
            type: "progress",
            activityId: "activity-recall",
            transition: "complete",
          },
        ),
      ),
    ).toThrow("Only a deterministic evaluator may emit terminal progress");

    const completed = reduce(
      started.facts,
      command(
        "operation-complete",
        "fact-complete",
        "2026-08-10T09:00:01.000Z",
        evaluator,
        {
          type: "progress",
          activityId: "activity-recall",
          transition: "complete",
        },
      ),
    );
    expect(completed.projection.progress).toEqual([
      { unitId: "activity-recall", status: "completed" },
      { unitId: "activity-apply", status: "ready" },
    ]);
    expect(completed.projection.nextAction).toEqual({
      type: "activity",
      activityId: "activity-apply",
      reasonCode: "ready",
    });
  });

  it("deduplicates mistakes, schedules review, and resolves by later evidence", () => {
    const attemptOne = reduce(
      [],
      command(
        "operation-attempt-1",
        "fact-attempt-1",
        "2026-08-10T09:00:00.000Z",
        learner,
        evidence("unverified", []),
      ),
    );
    const errorOne = reduce(
      attemptOne.facts,
      command(
        "operation-error-1",
        "fact-error-1",
        "2026-08-10T09:00:01.000Z",
        evaluator,
        evidence("incorrect", ["fact-attempt-1"], "closure-scope"),
      ),
    );
    const attemptTwo = reduce(
      errorOne.facts,
      command(
        "operation-attempt-2",
        "fact-attempt-2",
        "2026-08-11T09:00:00.000Z",
        learner,
        evidence("unverified", []),
      ),
    );
    const errorTwo = reduce(
      attemptTwo.facts,
      command(
        "operation-error-2",
        "fact-error-2",
        "2026-08-11T09:00:01.000Z",
        evaluator,
        evidence("partial", ["fact-attempt-2"], "closure-scope"),
      ),
    );
    expect(errorTwo.projection.mistakes).toHaveLength(1);
    expect(errorTwo.projection.mistakes[0]).toMatchObject({
      errorFamily: "closure-scope",
      occurrenceFactIds: ["fact-error-1", "fact-error-2"],
      status: "open",
    });
    const mistakeReview = errorTwo.projection.reviewItems.find(
      (item) => item.reasonCode === "mistake",
    );
    expect(mistakeReview).toMatchObject({
      dueAt: "2026-08-13T09:00:01.000Z",
      state: "pending",
      completionEvidenceId: null,
    });
    if (!mistakeReview) throw new Error("Expected a scheduled mistake review");
    expect(
      isLearningKernelReviewDue(mistakeReview, "2026-08-13T09:00:00.999Z"),
    ).toBe(false);
    expect(
      isLearningKernelReviewDue(mistakeReview, "2026-08-13T09:00:01.000Z"),
    ).toBe(true);

    const attemptThree = reduce(
      errorTwo.facts,
      command(
        "operation-attempt-3",
        "fact-attempt-3",
        "2026-08-13T09:00:00.000Z",
        learner,
        evidence("unverified", []),
      ),
    );
    const corrected = reduce(
      attemptThree.facts,
      command(
        "operation-correct",
        "fact-correct",
        "2026-08-13T09:00:01.000Z",
        evaluator,
        evidence("correct", ["fact-attempt-3"], "closure-scope"),
      ),
    );
    expect(corrected.projection.mistakes[0]).toMatchObject({
      status: "corrected",
      correctedByFactId: "fact-correct",
    });
    expect(
      corrected.projection.reviewItems.find(
        (item) => item.reasonCode === "mistake",
      ),
    ).toMatchObject({
      state: "completed",
      completionEvidenceId: "fact-correct",
    });
  });

  it("appends a correction, supersedes projected evidence, and preserves history", () => {
    const attempt = reduce(
      [],
      command(
        "operation-attempt",
        "fact-attempt",
        "2026-08-10T09:00:00.000Z",
        learner,
        evidence("unverified", []),
      ),
    );
    const incorrect = reduce(
      attempt.facts,
      command(
        "operation-evaluate",
        "fact-evaluate",
        "2026-08-10T09:00:01.000Z",
        evaluator,
        evidence("incorrect", ["fact-attempt"], "wrong-key"),
      ),
    );
    const corrected = reduce(
      incorrect.facts,
      command(
        "operation-correction",
        "fact-correction",
        "2026-08-10T09:00:02.000Z",
        evaluator,
        {
          type: "correction",
          supersedesFactId: "fact-evaluate",
          replacement: evidence(
            "correct",
            ["fact-attempt"],
            "wrong-key",
          ) as Extract<LearningKernelFactBody, { type: "evidence" }>,
        },
      ),
    );
    expect(corrected.facts.map((fact) => fact.id)).toEqual([
      "fact-attempt",
      "fact-evaluate",
      "fact-correction",
    ]);
    expect(
      corrected.projection.masteryByKnowledgeNode["node-1"]?.understanding.state
        .score,
    ).toBe(0.488);
    expect(corrected.projection.mistakes).toEqual([]);
    expect(corrected.projection.reviewItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reasonCode: "mistake",
          state: "superseded",
          sourceFactIds: ["fact-evaluate", "fact-correction"],
        }),
        expect.objectContaining({
          reasonCode: "low_mastery",
          state: "pending",
        }),
      ]),
    );
    expect(corrected.projection.reviewItems).toHaveLength(2);
  });

  it("lets only the learner dismiss a pending deterministic review item", () => {
    const attempt = reduce(
      [],
      command(
        "operation-attempt",
        "fact-attempt",
        "2026-08-10T09:00:00.000Z",
        learner,
        evidence("unverified", []),
      ),
    );
    const incorrect = reduce(
      attempt.facts,
      command(
        "operation-error",
        "fact-error",
        "2026-08-10T09:00:01.000Z",
        evaluator,
        evidence("incorrect", ["fact-attempt"], "wrong-key"),
      ),
    );
    const reviewItemId = incorrect.projection.reviewItems.find(
      (item) => item.reasonCode === "mistake",
    )!.id;
    const dismissed = reduce(
      incorrect.facts,
      command(
        "operation-dismiss",
        "fact-dismiss",
        "2026-08-10T09:00:02.000Z",
        learner,
        {
          type: "review",
          activityId: "activity-recall",
          reviewItemId,
          transition: "dismiss",
        },
      ),
    );
    expect(
      dismissed.projection.reviewItems.find((item) => item.id === reviewItemId),
    ).toMatchObject({ state: "dismissed", completionEvidenceId: null });
    expect(() =>
      reduce(
        incorrect.facts,
        command(
          "operation-forged-dismiss",
          "fact-forged-dismiss",
          "2026-08-10T09:00:02.000Z",
          evaluator,
          {
            type: "review",
            activityId: "activity-recall",
            reviewItemId,
            transition: "dismiss",
          },
        ),
      ),
    ).toThrow("Only a learner submission may dismiss");
  });

  it("is byte-stable under fact input order and enforces operation idempotency", () => {
    const first = reduce(
      [],
      command(
        "operation-attempt",
        "fact-attempt",
        "2026-08-10T09:00:00.000Z",
        learner,
        evidence("unverified", []),
      ),
    );
    const second = reduce(
      first.facts,
      command(
        "operation-evaluate",
        "fact-evaluate",
        "2026-08-10T09:00:01.000Z",
        evaluator,
        evidence("correct", ["fact-attempt"]),
      ),
    );
    const replay = reduce(second.facts, {
      operationId: second.acceptedFact!.operationId,
      factId: second.acceptedFact!.id,
      observedAt: second.acceptedFact!.occurredAt,
      provenance: second.acceptedFact!.provenance,
      body: second.acceptedFact!.body,
    });
    expect(replay).toMatchObject({ accepted: false, idempotent: true });
    expect(replay.projection.projectionHash).toBe(
      second.projection.projectionHash,
    );

    const reversed = projectLearningKernel({
      scope,
      activities,
      facts: [...second.facts].reverse(),
      observedAt: "2026-08-10T09:00:01.000Z",
    });
    expect(canonicalLearningKernelJson(reversed)).toBe(
      canonicalLearningKernelJson(second.projection),
    );
    expect(() =>
      reduce(
        second.facts,
        command(
          "operation-evaluate",
          "different-fact",
          "2026-08-10T09:00:02.000Z",
          evaluator,
          evidence("partial", ["fact-attempt"]),
        ),
      ),
    ).toThrow(LearningKernelConflictError);
    expect(learningKernelSha256({ b: 2, a: 1 })).toBe(
      "sha256:43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777",
    );
  });

  it("fails closed for unknown facts, missing basis, forged reviewer success, and future facts", () => {
    expect(() =>
      reduce(
        [],
        command(
          "operation-evaluate",
          "fact-evaluate",
          "2026-08-10T09:00:00.000Z",
          evaluator,
          evidence("correct", []),
        ),
      ),
    ).toThrow("requires at least one persisted basis fact");
    expect(() =>
      reduce(
        [],
        command(
          "operation-unknown",
          "fact-unknown",
          "2026-08-10T09:00:00.000Z",
          learner,
          { type: "model_success" } as unknown as LearningKernelFactBody,
        ),
      ),
    ).toThrow(LearningKernelValidationError);

    const attempt = reduce(
      [],
      command(
        "operation-attempt",
        "fact-attempt",
        "2026-08-10T09:00:00.000Z",
        learner,
        evidence("unverified", []),
      ),
    );
    expect(() =>
      reduce(
        attempt.facts,
        command(
          "operation-review",
          "fact-review",
          "2026-08-10T09:00:01.000Z",
          {
            kind: "reviewer",
            sourceId: "reviewer",
            sourceHash: `sha256:${"c".repeat(64)}`,
            workspaceHash: `sha256:${"d".repeat(64)}`,
            checkFactId: "missing-check",
          },
          evidence("correct", ["fact-attempt"]),
        ),
      ),
    ).toThrow("reviewer cannot independently emit correct");

    const futureFact = {
      ...attempt.facts[0]!,
      occurredAt: "2026-08-11T09:00:00.000Z",
    };
    expect(() =>
      projectLearningKernel({
        scope,
        activities,
        facts: [futureFact],
        observedAt: "2026-08-10T09:00:00.000Z",
      }),
    ).toThrow("occurs after the observed clock");
  });
});
