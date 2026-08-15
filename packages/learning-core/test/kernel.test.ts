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
  type LearningKernelEvidenceBody,
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
): LearningKernelEvidenceBody {
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
  return reduceWithActivities(activities, facts, value);
}

function reduceWithActivities(
  activityDefinitions: readonly LearningKernelActivity[],
  facts: readonly LearningKernelFact[],
  value: LearningKernelCommand,
) {
  return reduceLearningKernel({
    scope,
    activities: activityDefinitions,
    facts,
    command: value,
  });
}

function scheduledReviewFixture() {
  const attempt = reduce(
    [],
    command(
      "operation-review-seed-attempt",
      "fact-review-seed-attempt",
      "2026-08-10T09:00:00.000Z",
      learner,
      evidence("unverified", []),
    ),
  );
  const incorrect = reduce(
    attempt.facts,
    command(
      "operation-review-seed-error",
      "fact-review-seed-error",
      "2026-08-10T09:00:01.000Z",
      evaluator,
      evidence("incorrect", ["fact-review-seed-attempt"], "wrong-key"),
    ),
  );
  const review = incorrect.projection.reviewItems.find(
    (item) => item.reasonCode === "mistake",
  );
  if (!review) throw new Error("Expected a scheduled mistake Review item");
  return { attempt, incorrect, review };
}

function reviewSubmission(
  reviewItemId: string,
  observedAt: string,
): LearningKernelCommand {
  return command(
    "operation-review-submit",
    "fact-review-submit",
    observedAt,
    learner,
    {
      type: "review",
      activityId: "activity-recall",
      reviewItemId,
      transition: "submit",
      response: "The callback closes over the lexical binding.",
      activitySnapshotHash: `sha256:${"c".repeat(64)}`,
      executionContextHash: `sha256:${"e".repeat(64)}`,
    },
  );
}

function reviewCompletion(
  reviewItemId: string,
  observedAt: string,
  provenance: LearningKernelFactProvenance = evaluator,
  completionEvidenceFactId = "fact-review-submit",
): LearningKernelCommand {
  return command(
    "operation-review-complete",
    "fact-review-complete",
    observedAt,
    provenance,
    {
      type: "review",
      activityId: "activity-recall",
      reviewItemId,
      transition: "complete",
      completionEvidenceFactId,
    },
  );
}

describe("Learning Kernel", () => {
  it("preserves deterministic mastery output when evidence is indexed across nodes and dimensions", () => {
    const indexedActivities: LearningKernelActivity[] = [
      {
        id: "activity-indexed",
        optional: false,
        prerequisiteUnitIds: [],
        knowledgeNodeIds: ["node-a", "node-b", "node-unverified"],
      },
    ];
    const indexedEvidence = (
      id: string,
      occurredAt: string,
      provenance: LearningKernelFactProvenance,
      knowledgeNodeIds: readonly string[],
      dimension: "understanding" | "debugging",
      evidenceType: "recall" | "debugging",
      outcome: "unverified" | "incorrect" | "correct",
      basisFactIds: readonly string[],
    ): LearningKernelFact => ({
      schemaVersion: 1,
      id,
      operationId: `operation-${id}`,
      ...scope,
      occurredAt,
      provenance,
      body: {
        type: "evidence",
        activityId: "activity-indexed",
        knowledgeNodeIds,
        dimension,
        evidenceType,
        outcome,
        hintLevel: 0,
        basisFactIds,
        ...(outcome === "incorrect" ? { errorFamily: "wrong-branch" } : {}),
      },
    });
    const facts = [
      indexedEvidence(
        "fact-00-attempt",
        "2026-08-10T09:00:00.000Z",
        learner,
        ["node-a", "node-b", "node-unverified"],
        "understanding",
        "recall",
        "unverified",
        [],
      ),
      indexedEvidence(
        "fact-01-understanding",
        "2026-08-10T09:00:01.000Z",
        evaluator,
        ["node-a", "node-b"],
        "understanding",
        "recall",
        "correct",
        ["fact-00-attempt"],
      ),
      indexedEvidence(
        "fact-02-debugging",
        "2026-08-10T09:00:02.000Z",
        evaluator,
        ["node-a"],
        "debugging",
        "debugging",
        "incorrect",
        ["fact-00-attempt"],
      ),
    ];

    const projection = projectLearningKernel({
      scope,
      activities: indexedActivities,
      facts,
      observedAt: "2026-08-10T10:00:00.000Z",
    });

    expect(Object.keys(projection.masteryByKnowledgeNode)).toEqual([
      "node-a",
      "node-b",
      "node-unverified",
    ]);
    expect(
      projection.masteryByKnowledgeNode["node-a"]?.understanding,
    ).toMatchObject({
      state: { score: 0.488 },
      sourceFactIds: ["fact-01-understanding"],
    });
    expect(
      projection.masteryByKnowledgeNode["node-a"]?.debugging,
    ).toMatchObject({
      state: { score: 0 },
      sourceFactIds: ["fact-02-debugging"],
    });
    expect(
      projection.masteryByKnowledgeNode["node-b"]?.understanding.sourceFactIds,
    ).toEqual(["fact-01-understanding"]);
    expect(
      projection.masteryByKnowledgeNode["node-unverified"]?.understanding,
    ).toMatchObject({
      state: { score: 0 },
      sourceFactIds: [],
    });
    expect(projection.projectionHash).toBe(
      "sha256:9adbf0d65e5817f7ed8a3aae4c4ff1e434539a0721bd49287b2b69dd3e244599",
    );
  });

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

  it("rejects a same-time correction that sorts before its target", () => {
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
    const target = reduce(
      attempt.facts,
      command(
        "operation-target",
        "z-target",
        "2026-08-10T09:00:01.000Z",
        evaluator,
        evidence("incorrect", ["fact-attempt"], "wrong-key"),
      ),
    );

    expect(() =>
      reduce(
        target.facts,
        command(
          "operation-correction",
          "a-correction",
          "2026-08-10T09:00:01.000Z",
          evaluator,
          {
            type: "correction",
            supersedesFactId: "z-target",
            replacement: evidence(
              "correct",
              ["fact-attempt"],
              "wrong-key",
            ) as Extract<LearningKernelFactBody, { type: "evidence" }>,
          },
        ),
      ),
    ).toThrow("Correction precedes its target: z-target");
  });

  it("replays a legacy same-time correction under pinned baseline-1 bytes", () => {
    const legacyFacts: LearningKernelFact[] = [
      {
        schemaVersion: 1,
        ...scope,
        id: "fact-attempt",
        operationId: "operation-attempt",
        occurredAt: "2026-08-10T09:00:00.000Z",
        provenance: learner,
        body: evidence("unverified", []),
      },
      {
        schemaVersion: 1,
        ...scope,
        id: "z-target",
        operationId: "operation-target",
        occurredAt: "2026-08-10T09:00:01.000Z",
        provenance: evaluator,
        body: evidence("incorrect", ["fact-attempt"], "wrong-key"),
      },
      {
        schemaVersion: 1,
        ...scope,
        id: "a-correction",
        operationId: "operation-correction",
        occurredAt: "2026-08-10T09:00:01.000Z",
        provenance: evaluator,
        body: {
          type: "correction",
          supersedesFactId: "z-target",
          replacement: evidence("correct", ["fact-attempt"], "wrong-key"),
        },
      },
    ];

    const projection = projectLearningKernel({
      scope,
      activities,
      facts: legacyFacts,
      observedAt: "2026-08-10T10:00:00.000Z",
    });

    expect(projection.modelVersion).toBe("baseline-1");
    expect(projection.factFrontier).toEqual([
      "fact-attempt",
      "a-correction",
      "z-target",
    ]);
    expect(projection.projectionHash).toBe(
      "sha256:f057ba08206d8bdde4b8e81e1a06c4e853a17679d7d2b5c0182c69e6ee2a12e6",
    );
  });

  it("replays a legacy correction identity mismatch but rejects it as a new command", () => {
    const semanticActivities = activities.map((activity) =>
      activity.id === "activity-recall"
        ? { ...activity, knowledgeNodeIds: ["node-1", "node-2"] }
        : activity,
    );
    const attempt = reduceWithActivities(
      semanticActivities,
      [],
      command(
        "operation-legacy-attempt",
        "fact-legacy-attempt",
        "2026-08-10T09:00:00.000Z",
        learner,
        evidence("unverified", []),
      ),
    );
    const target = reduceWithActivities(
      semanticActivities,
      attempt.facts,
      command(
        "operation-legacy-target",
        "fact-legacy-target",
        "2026-08-10T09:00:01.000Z",
        evaluator,
        evidence("incorrect", ["fact-legacy-attempt"], "wrong-key"),
      ),
    );
    const mismatchedReplacement = {
      ...evidence("correct", ["fact-legacy-attempt"], "wrong-key"),
      knowledgeNodeIds: ["node-2"],
    } satisfies LearningKernelEvidenceBody;
    const correction = command(
      "operation-legacy-correction",
      "fact-legacy-correction",
      "2026-08-10T09:00:02.000Z",
      evaluator,
      {
        type: "correction",
        supersedesFactId: "fact-legacy-target",
        replacement: mismatchedReplacement,
      },
    );

    expect(() =>
      reduceWithActivities(semanticActivities, target.facts, correction),
    ).toThrow("Correction replacement must preserve evidence identity");

    const legacyFact: LearningKernelFact = {
      schemaVersion: 1,
      ...scope,
      id: correction.factId,
      operationId: correction.operationId,
      occurredAt: correction.observedAt,
      provenance: correction.provenance,
      body: correction.body,
    };
    expect(() =>
      projectLearningKernel({
        scope,
        activities: semanticActivities,
        facts: [...target.facts, legacyFact],
        observedAt: correction.observedAt,
      }),
    ).not.toThrow();
  });

  it("accepts a same-time correction that sorts after its target", () => {
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
    const target = reduce(
      attempt.facts,
      command(
        "operation-target",
        "a-target",
        "2026-08-10T09:00:01.000Z",
        evaluator,
        evidence("incorrect", ["fact-attempt"], "wrong-key"),
      ),
    );
    const corrected = reduce(
      target.facts,
      command(
        "operation-correction",
        "z-correction",
        "2026-08-10T09:00:01.000Z",
        evaluator,
        {
          type: "correction",
          supersedesFactId: "a-target",
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
      "a-target",
      "z-correction",
    ]);
    expect(
      corrected.projection.masteryByKnowledgeNode["node-1"]?.understanding.state
        .score,
    ).toBe(0.488);
  });

  it.each([
    ["activity", { activityId: "activity-apply" }],
    ["knowledge nodes", { knowledgeNodeIds: ["node-2"] }],
    ["dimension", { dimension: "implementation" }],
    ["evidence type", { evidenceType: "explanation" }],
  ] as const)(
    "rejects a correction that changes the target evidence %s",
    (_field, replacementOverride) => {
      const semanticActivities = activities.map((activity) =>
        activity.id === "activity-recall"
          ? { ...activity, knowledgeNodeIds: ["node-1", "node-2"] }
          : activity,
      );
      const attempt = reduceWithActivities(
        semanticActivities,
        [],
        command(
          "operation-semantic-attempt",
          "fact-semantic-attempt",
          "2026-08-10T09:00:00.000Z",
          learner,
          evidence("unverified", []),
        ),
      );
      const target = reduceWithActivities(
        semanticActivities,
        attempt.facts,
        command(
          "operation-semantic-target",
          "fact-semantic-target",
          "2026-08-10T09:00:01.000Z",
          evaluator,
          evidence("incorrect", ["fact-semantic-attempt"], "wrong-key"),
        ),
      );
      const replacement = {
        ...evidence("correct", ["fact-semantic-attempt"], "wrong-key"),
        ...replacementOverride,
      } as Extract<LearningKernelFactBody, { type: "evidence" }>;

      expect(() =>
        reduceWithActivities(
          semanticActivities,
          target.facts,
          command(
            "operation-semantic-correction",
            "fact-semantic-correction",
            "2026-08-10T09:00:02.000Z",
            evaluator,
            {
              type: "correction",
              supersedesFactId: "fact-semantic-target",
              replacement,
            },
          ),
        ),
      ).toThrow("Correction replacement must preserve evidence identity");
    },
  );

  it("enforces canonical ordering for same-time evidence basis facts", () => {
    const attempt = reduce(
      [],
      command(
        "operation-attempt",
        "m-attempt",
        "2026-08-10T09:00:00.000Z",
        learner,
        evidence("unverified", []),
      ),
    );

    expect(() =>
      reduce(
        attempt.facts,
        command(
          "operation-evaluate-before",
          "a-evaluation",
          "2026-08-10T09:00:00.000Z",
          evaluator,
          evidence("correct", ["m-attempt"]),
        ),
      ),
    ).toThrow("Evidence basis fact is unavailable or not earlier: m-attempt");

    const accepted = reduce(
      attempt.facts,
      command(
        "operation-evaluate-after",
        "z-evaluation",
        "2026-08-10T09:00:00.000Z",
        evaluator,
        evidence("correct", ["m-attempt"]),
      ),
    );
    expect(accepted.facts.map((fact) => fact.id)).toEqual([
      "m-attempt",
      "z-evaluation",
    ]);
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

  it("completes a due Review cycle from learner participation and schedules the next cycle", () => {
    const { incorrect, review } = scheduledReviewFixture();
    const masteryBefore =
      incorrect.projection.masteryByKnowledgeNode["node-1"]?.understanding;
    const submitted = reduce(
      incorrect.facts,
      reviewSubmission(review.id, review.dueAt),
    );
    expect(
      submitted.projection.reviewItems.find((item) => item.id === review.id),
    ).toMatchObject({ state: "pending", completionEvidenceId: null });

    const completed = reduce(
      submitted.facts,
      reviewCompletion(review.id, "2026-08-13T09:00:02.000Z"),
    );
    const completedCycle = completed.projection.reviewItems.find(
      (item) => item.id === review.id,
    );
    const successor = completed.projection.reviewItems.find(
      (item) =>
        item.id !== review.id &&
        item.reasonCode === review.reasonCode &&
        item.state === "pending" &&
        item.sourceFactIds.includes("fact-review-complete"),
    );
    expect(completedCycle).toMatchObject({
      state: "completed",
      completionEvidenceId: "fact-review-submit",
      sourceFactIds: expect.arrayContaining([
        "fact-review-submit",
        "fact-review-complete",
      ]),
    });
    expect(successor).toMatchObject({
      dueAt: "2026-08-16T09:00:02.000Z",
      state: "pending",
      completionEvidenceId: null,
    });
    expect(successor?.id).not.toBe(review.id);
    expect(
      completed.projection.masteryByKnowledgeNode["node-1"]?.understanding,
    ).toEqual(masteryBefore);

    const completionFact = completed.acceptedFact!;
    const replay = reduce(completed.facts, {
      operationId: completionFact.operationId,
      factId: completionFact.id,
      observedAt: completionFact.occurredAt,
      provenance: completionFact.provenance,
      body: completionFact.body,
    });
    expect(replay).toMatchObject({ accepted: false, idempotent: true });
    expect(replay.projection.projectionHash).toBe(
      completed.projection.projectionHash,
    );
  });

  it("binds a repeated Review series to its latest effective source activity", () => {
    const firstAttempt = reduce(
      [],
      command(
        "operation-review-source-first-attempt",
        "fact-a-review-source-first-attempt",
        "2026-08-10T09:00:00.000Z",
        learner,
        evidence("unverified", []),
      ),
    );
    const firstEvaluation = reduce(
      firstAttempt.facts,
      command(
        "operation-review-source-first-evaluation",
        "fact-a-review-source-first-evaluation",
        "2026-08-10T09:00:01.000Z",
        evaluator,
        evidence(
          "incorrect",
          ["fact-a-review-source-first-attempt"],
          "repeated-gap",
        ),
      ),
    );
    const secondAttempt = reduce(
      firstEvaluation.facts,
      command(
        "operation-review-source-second-attempt",
        "fact-z-review-source-second-attempt",
        "2026-08-10T10:00:00.000Z",
        learner,
        {
          ...evidence("unverified", []),
          activityId: "activity-apply",
        },
      ),
    );
    const secondEvaluation = reduce(
      secondAttempt.facts,
      command(
        "operation-review-source-second-evaluation",
        "fact-z-review-source-second-evaluation",
        "2026-08-10T10:00:01.000Z",
        evaluator,
        {
          ...evidence(
            "incorrect",
            ["fact-z-review-source-second-attempt"],
            "repeated-gap",
          ),
          activityId: "activity-apply",
        },
      ),
    );
    const review = secondEvaluation.projection.reviewItems.find(
      (item) => item.reasonCode === "mistake",
    );
    if (!review) throw new Error("Expected a repeated mistake Review item");

    const submitted = reduce(
      secondEvaluation.facts,
      command(
        "operation-review-source-submit",
        "fact-review-source-submit",
        review.dueAt,
        learner,
        {
          type: "review",
          activityId: "activity-apply",
          reviewItemId: review.id,
          transition: "submit",
          response: "The later exercise exposed the repeated gap.",
          activitySnapshotHash: `sha256:${"d".repeat(64)}`,
          executionContextHash: `sha256:${"f".repeat(64)}`,
        },
      ),
    );
    expect(submitted.acceptedFact?.body).toMatchObject({
      type: "review",
      activityId: "activity-apply",
    });
  });

  it("rejects a Review submission before the deterministic due instant", () => {
    const { incorrect, review } = scheduledReviewFixture();
    expect(() =>
      reduce(
        incorrect.facts,
        reviewSubmission(review.id, "2026-08-13T09:00:00.999Z"),
      ),
    ).toThrow("cannot be submitted before it is due");
  });

  it("rejects forged or unbound Review completion", () => {
    const { incorrect, review } = scheduledReviewFixture();
    const submitted = reduce(
      incorrect.facts,
      reviewSubmission(review.id, review.dueAt),
    );
    expect(() =>
      reduce(
        submitted.facts,
        reviewCompletion(review.id, "2026-08-13T09:00:02.000Z", learner),
      ),
    ).toThrow("Only a deterministic evaluator may complete");
    expect(() =>
      reduce(
        incorrect.facts,
        reviewCompletion(
          review.id,
          "2026-08-13T09:00:02.000Z",
          evaluator,
          "missing-submit",
        ),
      ),
    ).toThrow("must cite an earlier learner Review submission");

    const otherReview = submitted.projection.reviewItems.find(
      (item) => item.id !== review.id && item.reasonCode === "low_mastery",
    );
    if (!otherReview) throw new Error("Expected the related mastery Review");
    expect(() =>
      reduce(
        submitted.facts,
        reviewCompletion(otherReview.id, "2026-08-13T09:00:02.000Z"),
      ),
    ).toThrow("must match the exact Review item and activity");
  });

  it("preserves the legacy baseline projection when no executor facts exist", () => {
    const { incorrect } = scheduledReviewFixture();
    const projected = projectLearningKernel({
      scope,
      activities,
      facts: incorrect.facts,
      observedAt: "2026-08-13T09:00:01.000Z",
    });
    expect(projected.projectionHash).toBe(
      "sha256:e90c52ac42ed3b42b1510d34cd0c1ac00f42a06be8aa20c89a4973dc1d2275de",
    );
    expect(projected.reviewItems).toEqual([
      expect.objectContaining({
        reasonCode: "low_mastery",
        state: "pending",
        completionEvidenceId: null,
      }),
      expect.objectContaining({
        reasonCode: "mistake",
        state: "pending",
        completionEvidenceId: null,
      }),
    ]);
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
