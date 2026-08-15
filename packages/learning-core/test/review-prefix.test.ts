import { describe, expect, it } from "vitest";

import {
  canonicalLearningKernelJson,
  learningKernelSha256,
  projectLearningKernel,
  reduceLearningKernel,
  type LearningKernelActivity,
  type LearningKernelCommand,
  type LearningKernelEvidenceBody,
  type LearningKernelFact,
  type LearningKernelFactBody,
  type LearningKernelFactProvenance,
  type LearningKernelReviewItem,
  type LearningKernelScope,
} from "../src/index.js";
import { ReviewPrefixProjection } from "../src/review-prefix.js";

const scope: LearningKernelScope = {
  courseId: "course-review-prefix",
  revisionId: "revision-review-prefix",
  branchId: "branch-review-prefix",
  sessionId: "session-review-prefix",
};

const activities: LearningKernelActivity[] = [
  {
    id: "activity-review-prefix",
    optional: false,
    prerequisiteUnitIds: [],
    knowledgeNodeIds: ["node-main", "узел-α", "узел-β"],
  },
];

const learner: LearningKernelFactProvenance = {
  kind: "learner_submission",
  sourceId: "browser-operation",
  sourceHash: `sha256:${"a".repeat(64)}`,
};

const evaluator: LearningKernelFactProvenance = {
  kind: "deterministic_evaluator",
  sourceId: "review-prefix-evaluator",
  sourceHash: `sha256:${"b".repeat(64)}`,
  evaluatorVersion: "review-prefix-v1",
};

function evidence(
  knowledgeNodeId: string,
  outcome: LearningKernelEvidenceBody["outcome"],
  basisFactIds: readonly string[],
  errorFamily?: string,
): LearningKernelEvidenceBody {
  return {
    type: "evidence",
    activityId: "activity-review-prefix",
    knowledgeNodeIds: [knowledgeNodeId],
    dimension: "understanding",
    evidenceType: "recall",
    outcome,
    hintLevel: 0,
    basisFactIds,
    ...(errorFamily === undefined ? {} : { errorFamily }),
  };
}

function fact(
  id: string,
  occurredAt: string,
  provenance: LearningKernelFactProvenance,
  body: LearningKernelFactBody,
): LearningKernelFact {
  return {
    schemaVersion: 1,
    ...scope,
    id,
    operationId: `operation-${id}`,
    occurredAt,
    provenance,
    body,
  };
}

function command(
  id: string,
  observedAt: string,
  provenance: LearningKernelFactProvenance,
  body: LearningKernelFactBody,
): LearningKernelCommand {
  return {
    operationId: `operation-${id}`,
    factId: id,
    observedAt,
    provenance,
    body,
  };
}

function reduce(
  facts: readonly LearningKernelFact[],
  next: LearningKernelCommand,
) {
  return reduceLearningKernel({ scope, activities, facts, command: next });
}

function successorId(predecessorId: string, completionFactId: string): string {
  return `review-${learningKernelSha256({
    scope,
    predecessorReviewItemId: predecessorId,
    completionFactId,
    schedulerVersion: "baseline-1",
  }).slice("sha256:".length)}`;
}

function mistakeReviewId(knowledgeNodeId: string, errorFamily: string): string {
  return `review-${learningKernelSha256({
    courseId: scope.courseId,
    revisionId: scope.revisionId,
    branchId: scope.branchId,
    knowledgeNodeId,
    errorFamily,
  }).slice("sha256:".length)}`;
}

function prefixFixture() {
  const facts: LearningKernelFact[] = [
    fact(
      "fact-attempt-α",
      "2026-08-10T07:59:00.000Z",
      learner,
      evidence("узел-α", "unverified", []),
    ),
    // Historical baseline-1 data may contain a same-time correction whose ID
    // sorts before its target. Projection must preserve those accepted bytes.
    fact("a-correction-α", "2026-08-10T08:00:00.000Z", evaluator, {
      type: "correction",
      supersedesFactId: "z-target-α",
      replacement: evidence(
        "узел-α",
        "correct",
        ["fact-attempt-α"],
        "ошибка-α",
      ),
    }),
    fact(
      "z-target-α",
      "2026-08-10T08:00:00.000Z",
      evaluator,
      evidence("узел-α", "incorrect", ["fact-attempt-α"], "ошибка-α"),
    ),
    fact(
      "fact-attempt-β",
      "2026-08-10T08:29:00.000Z",
      learner,
      evidence("узел-β", "unverified", []),
    ),
    fact("b-correction-β", "2026-08-10T08:30:00.000Z", evaluator, {
      type: "correction",
      supersedesFactId: "y-target-β",
      replacement: evidence(
        "узел-β",
        "correct",
        ["fact-attempt-β"],
        "ошибка-β",
      ),
    }),
    fact(
      "y-target-β",
      "2026-08-10T08:30:00.000Z",
      evaluator,
      evidence("узел-β", "incorrect", ["fact-attempt-β"], "ошибка-β"),
    ),
    fact(
      "fact-main-attempt",
      "2026-08-10T09:00:00.000Z",
      learner,
      evidence("node-main", "unverified", []),
    ),
    fact(
      "fact-main-error",
      "2026-08-10T09:00:01.000Z",
      evaluator,
      evidence("node-main", "incorrect", ["fact-main-attempt"], "ошибка-цикла"),
    ),
  ];

  const scheduled = projectLearningKernel({
    scope,
    activities,
    facts,
    observedAt: "2026-08-13T09:00:01.000Z",
  });
  const original = scheduled.reviewItems.find(
    (item) =>
      item.reasonCode === "mistake" && item.knowledgeNodeId === "node-main",
  );
  if (!original) throw new Error("Expected the main mistake Review item");

  const submittedOne = reduce(
    facts,
    command("fact-submit-1", original.dueAt, learner, {
      type: "review",
      activityId: "activity-review-prefix",
      reviewItemId: original.id,
      transition: "submit",
      response: "First response",
      activitySnapshotHash: `sha256:${"c".repeat(64)}`,
      executionContextHash: `sha256:${"d".repeat(64)}`,
    }),
  );
  const completedOne = reduce(
    submittedOne.facts,
    command("fact-complete-1", "2026-08-13T09:00:03.000Z", evaluator, {
      type: "review",
      activityId: "activity-review-prefix",
      reviewItemId: original.id,
      transition: "complete",
      completionEvidenceFactId: "fact-submit-1",
    }),
  );
  const successorOneId = successorId(original.id, "fact-complete-1");
  const successorOne = completedOne.projection.reviewItems.find(
    (item) => item.id === successorOneId,
  );
  if (!successorOne) throw new Error("Expected the first Review successor");

  const submittedTwo = reduce(
    completedOne.facts,
    command("fact-submit-2", successorOne.dueAt, learner, {
      type: "review",
      activityId: "activity-review-prefix",
      reviewItemId: successorOne.id,
      transition: "submit",
      response: "Second response",
      activitySnapshotHash: `sha256:${"e".repeat(64)}`,
      executionContextHash: `sha256:${"f".repeat(64)}`,
    }),
  );
  const completedTwo = reduce(
    submittedTwo.facts,
    command("fact-complete-2", "2026-08-16T09:00:05.000Z", evaluator, {
      type: "review",
      activityId: "activity-review-prefix",
      reviewItemId: successorOne.id,
      transition: "complete",
      completionEvidenceFactId: "fact-submit-2",
    }),
  );
  const corrected = reduce(
    completedTwo.facts,
    command("fact-main-correction", "2026-08-16T09:00:06.000Z", evaluator, {
      type: "correction",
      supersedesFactId: "fact-main-error",
      replacement: evidence(
        "node-main",
        "correct",
        ["fact-main-attempt"],
        "ошибка-цикла",
      ),
    }),
  );

  return { corrected, original };
}

describe("Review prefix projection", () => {
  it.each([false, true])(
    "matches the legacy prefix oracle for corrections, equal timestamps, non-ASCII IDs, and input order reversed=%s",
    (reverseInput) => {
      const { corrected, original } = prefixFixture();
      const replayFacts = reverseInput
        ? [...corrected.facts].reverse()
        : corrected.facts;
      const firstReviewFact = replayFacts.find(
        (item) => item.id === "fact-submit-1",
      );
      if (!firstReviewFact) throw new Error("Expected the first Review fact");
      const priorNonReviewFacts = replayFacts.filter(
        (candidate) =>
          candidate.body.type !== "review" &&
          (Date.parse(candidate.occurredAt) <
            Date.parse(firstReviewFact.occurredAt) ||
            (candidate.occurredAt === firstReviewFact.occurredAt &&
              candidate.id < firstReviewFact.id)),
      );
      const legacyPrefix = projectLearningKernel({
        scope,
        activities,
        facts: priorNonReviewFacts,
        observedAt: firstReviewFact.occurredAt,
      }).reviewItems.find((item) => item.id === original.id);
      if (!legacyPrefix) throw new Error("Expected the legacy Review prefix");

      const finalNonReviewFacts = replayFacts.filter(
        (item) => item.body.type !== "review",
      );
      const finalBaseItem = projectLearningKernel({
        scope,
        activities,
        facts: finalNonReviewFacts,
        observedAt: corrected.acceptedFact!.occurredAt,
      }).reviewItems.find((item) => item.id === original.id);
      if (!finalBaseItem)
        throw new Error("Expected the final base Review item");

      const prefix = new ReviewPrefixProjection({
        masteryReviewIntervalMilliseconds: 3 * 86_400_000,
        mistakeReviewItemId: mistakeReviewId,
      });
      const sortedFacts = [...replayFacts].sort(
        (left, right) =>
          Date.parse(left.occurredAt) - Date.parse(right.occurredAt) ||
          (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
      );
      for (const candidate of sortedFacts) {
        if (candidate.id === firstReviewFact.id) break;
        prefix.accept(candidate);
      }

      expect(prefix.project(finalBaseItem)).toEqual(legacyPrefix);
      const replay = projectLearningKernel({
        scope,
        activities,
        facts: replayFacts,
        observedAt: corrected.acceptedFact!.occurredAt,
      });
      expect(replay.projectionHash).toBe(
        "sha256:63bd3a9c34ca98c5afbddd63651d5efeb4b0cfa21d976c3428b96b6cbf1c1cb5",
      );
      expect(canonicalLearningKernelJson(replay)).toBe(
        canonicalLearningKernelJson(corrected.projection),
      );
    },
  );

  it("does not invent a superseded mistake item for an unverified target", () => {
    const reviewItemId = mistakeReviewId("node-main", "unverified-error");
    const executableReviewItemId = mistakeReviewId(
      "node-main",
      "executable-error",
    );
    const executableAttempt = fact(
      "fact-executable-attempt",
      "2026-08-07T09:00:00.000Z",
      learner,
      evidence("node-main", "unverified", []),
    );
    const executableError = fact(
      "fact-executable-error",
      "2026-08-07T09:00:01.000Z",
      evaluator,
      evidence(
        "node-main",
        "incorrect",
        [executableAttempt.id],
        "executable-error",
      ),
    );
    const target = fact(
      "fact-unverified-target",
      "2026-08-08T09:00:00.000Z",
      learner,
      evidence("node-main", "unverified", [], "unverified-error"),
    );
    const correction = fact(
      "fact-unverified-correction",
      "2026-08-08T09:00:01.000Z",
      evaluator,
      {
        type: "correction",
        supersedesFactId: target.id,
        replacement: evidence(
          "node-main",
          "correct",
          [target.id],
          "unverified-error",
        ),
      },
    );
    const dismissed = fact(
      "a-fact-unverified-dismiss",
      "2026-08-10T09:00:01.000Z",
      learner,
      {
        type: "review",
        activityId: "activity-review-prefix",
        reviewItemId,
        transition: "dismiss",
      },
    );
    const executableSubmission = fact(
      "b-fact-executable-submit",
      "2026-08-10T09:00:01.000Z",
      learner,
      {
        type: "review",
        activityId: "activity-review-prefix",
        reviewItemId: executableReviewItemId,
        transition: "submit",
        response: "Executable review response",
        activitySnapshotHash: `sha256:${"c".repeat(64)}`,
        executionContextHash: `sha256:${"d".repeat(64)}`,
      },
    );
    const laterError = fact(
      "z-fact-unverified-later-error",
      "2026-08-10T09:00:01.000Z",
      evaluator,
      evidence("node-main", "incorrect", [target.id], "unverified-error"),
    );

    const legacyPrefix = projectLearningKernel({
      scope,
      activities,
      facts: [target, correction],
      observedAt: dismissed.occurredAt,
    });
    expect(
      legacyPrefix.reviewItems.find((item) => item.id === reviewItemId),
    ).toBeUndefined();

    const finalBaseItem = projectLearningKernel({
      scope,
      activities,
      facts: [target, correction, laterError],
      observedAt: laterError.occurredAt,
    }).reviewItems.find((item) => item.id === reviewItemId);
    if (!finalBaseItem)
      throw new Error("Expected the final mistake Review item");

    const prefix = new ReviewPrefixProjection({
      masteryReviewIntervalMilliseconds: 3 * 86_400_000,
      mistakeReviewItemId: mistakeReviewId,
    });
    prefix.accept(target);
    prefix.accept(correction);
    expect(prefix.project(finalBaseItem)).toBeNull();

    expect(() =>
      projectLearningKernel({
        scope,
        activities,
        facts: [
          executableAttempt,
          executableError,
          target,
          correction,
          dismissed,
          executableSubmission,
          laterError,
        ],
        observedAt: laterError.occurredAt,
      }),
    ).toThrow(/Review item was unavailable/);
  });

  it("visits a long interleaved history once instead of rebuilding every prefix", () => {
    const seriesCount = 64;
    const prefix = new ReviewPrefixProjection({
      masteryReviewIntervalMilliseconds: 3 * 86_400_000,
      mistakeReviewItemId: mistakeReviewId,
    });
    const longHistory: LearningKernelFact[] = [];

    for (let index = 0; index < seriesCount; index += 1) {
      const errorFamily = `error-${index}`;
      const reviewItemId = mistakeReviewId("node-main", errorFamily);
      const attempt = fact(
        `fact-attempt-${index}`,
        new Date(Date.UTC(2026, 7, 10, 9, 0, index * 2)).toISOString(),
        learner,
        evidence("node-main", "unverified", []),
      );
      const error = fact(
        `fact-error-${index}`,
        new Date(Date.UTC(2026, 7, 10, 9, 0, index * 2 + 1)).toISOString(),
        evaluator,
        evidence("node-main", "incorrect", [attempt.id], errorFamily),
      );
      const review = fact(
        `fact-review-${index}`,
        new Date(Date.UTC(2026, 7, 13, 9, 0, index * 2 + 1)).toISOString(),
        learner,
        {
          type: "review",
          activityId: "activity-review-prefix",
          reviewItemId,
          transition: "submit",
          response: `Response ${index}`,
          activitySnapshotHash: `sha256:${"c".repeat(64)}`,
          executionContextHash: `sha256:${"d".repeat(64)}`,
        },
      );
      longHistory.push(attempt, error, review);
      prefix.accept(attempt);
      prefix.accept(error);
      prefix.accept(review);
      const item: LearningKernelReviewItem = {
        id: reviewItemId,
        sourceFactIds: [`fact-error-${index}`],
        courseId: scope.courseId,
        revisionId: scope.revisionId,
        branchId: scope.branchId,
        knowledgeNodeId: "node-main",
        dimension: "understanding",
        activityKind: "correction",
        reasonCode: "mistake",
        dueAt: "2026-08-13T09:00:00.000Z",
        schedulerVersion: "baseline-1",
        state: "pending",
        completionEvidenceId: null,
      };
      expect(prefix.project(item)?.id).toBe(reviewItemId);
    }

    expect(() =>
      projectLearningKernel({
        scope,
        activities,
        facts: longHistory,
        observedAt: longHistory.at(-1)!.occurredAt,
      }),
    ).not.toThrow();
    const legacyPrefixFactVisits = seriesCount * longHistory.length;
    expect(prefix.work()).toEqual({
      factsVisited: seriesCount * 3,
      effectiveEvidenceMutations: seriesCount * 2,
      snapshotsProjected: seriesCount,
      evidenceEntriesRead: seriesCount * 2,
    });
    expect(legacyPrefixFactVisits).toBe(12_288);
    expect(prefix.work().factsVisited * seriesCount).toBe(
      legacyPrefixFactVisits,
    );
  });
});
