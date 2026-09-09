import { describe, expect, it } from "vitest";

import { activityContractHash } from "../src/activity-contract.js";
import {
  LEARNING_KERNEL_MIGRATOR_VERSION,
  projectLearningKernel,
  type LearningKernelActivity,
  type LearningKernelFact,
  type LearningKernelMigrationProvenance,
  type LearningKernelNonMigrationProvenance,
  type LearningKernelScope,
} from "../src/index.js";

const scope: LearningKernelScope = {
  courseId: "course-1",
  revisionId: "revision-2",
  branchId: "branch-1",
  sessionId: "migration-session-1",
};

const activities: LearningKernelActivity[] = [
  {
    id: "activity-recall",
    optional: false,
    prerequisiteUnitIds: [],
    knowledgeNodeIds: ["node-1"],
  },
];

function baseContract() {
  return {
    type: "recall",
    schemaVersion: 1,
    required: true,
    payload: { type: "recall", prompt: "Recall the capital" },
    completionCriteria: [{ type: "attempts", minimum: 1 }],
    capabilityIds: ["cap-a"],
    knowledgeNodeIds: ["node-1"],
    protectedMaterial: { referenceAnswer: "Paris", questions: [] },
    checkIds: [],
    environmentIds: [],
  } as const;
}

describe("activityContractHash", () => {
  it("ignores container/display identity but covers task semantics", () => {
    const left = activityContractHash({
      ...baseContract(),
      payload: { type: "recall", prompt: "Recall the capital" },
    });
    expect(left).toMatch(/^sha256:[0-9a-f]{64}$/u);
    // Display/container-only differences keep the hash stable.
    const displayVariant = activityContractHash({
      ...baseContract(),
      payload: { type: "recall", prompt: "Recall the capital" },
    });
    expect(displayVariant).toBe(left);
  });

  it("changes when learner task semantics change", () => {
    const baseline = activityContractHash(baseContract());
    const variants = [
      activityContractHash({ ...baseContract(), type: "quiz" }),
      activityContractHash({ ...baseContract(), required: false }),
      activityContractHash({
        ...baseContract(),
        payload: { type: "recall", prompt: "Different prompt" },
      }),
      activityContractHash({
        ...baseContract(),
        completionCriteria: [{ type: "attempts", minimum: 2 }],
      }),
      activityContractHash({ ...baseContract(), capabilityIds: ["cap-b"] }),
      activityContractHash({ ...baseContract(), knowledgeNodeIds: ["node-2"] }),
      activityContractHash({
        ...baseContract(),
        protectedMaterial: { referenceAnswer: "London", questions: [] },
      }),
      activityContractHash({
        ...baseContract(),
        payload: {
          type: "exercise",
          exerciseId: "ex-1",
          acceptanceCriteria: ["passes"],
          template: "starter",
          testCommandId: "check-a",
          hintPolicy: "h",
          reviewPolicy: "r",
        },
      }),
    ];
    for (const variant of variants) {
      expect(variant).not.toBe(baseline);
    }
    // Trusted check ID derived from exercise payload participates.
    const withCheck = activityContractHash({
      ...baseContract(),
      payload: {
        type: "exercise",
        exerciseId: "ex-1",
        acceptanceCriteria: ["passes"],
        template: "starter",
        testCommandId: "check-a",
        hintPolicy: "h",
        reviewPolicy: "r",
      },
    });
    const withOtherCheck = activityContractHash({
      ...baseContract(),
      payload: {
        type: "exercise",
        exerciseId: "ex-1",
        acceptanceCriteria: ["passes"],
        template: "starter",
        testCommandId: "check-b",
        hintPolicy: "h",
        reviewPolicy: "r",
      },
    });
    expect(withCheck).not.toBe(withOtherCheck);
    expect(withCheck).not.toBe(baseline);
  });
});

describe("migration provenance v1/v2", () => {
  const original: LearningKernelNonMigrationProvenance = {
    kind: "deterministic_evaluator",
    sourceId: "objective-evaluator",
    sourceHash: `sha256:${"b".repeat(64)}`,
    evaluatorVersion: "objective-v1",
  };
  const contractHash = activityContractHash(baseContract());
  function basisFact(): LearningKernelFact {
    return {
      schemaVersion: 1,
      ...scope,
      id: "basis-1",
      operationId: "basis-op-1",
      occurredAt: "2026-01-01T00:00:00.000Z",
      provenance: {
        kind: "learner_submission",
        sourceId: "browser-operation",
        sourceHash: `sha256:${"a".repeat(64)}`,
      },
      body: {
        type: "evidence",
        activityId: "activity-recall",
        knowledgeNodeIds: ["node-1"],
        dimension: "understanding",
        evidenceType: "recall",
        outcome: "unverified",
        hintLevel: 0,
        basisFactIds: [],
      },
    };
  }

  function migrationFact(
    overrides: Partial<LearningKernelMigrationProvenance> = {},
  ): LearningKernelFact {
    return {
      schemaVersion: 2,
      ...scope,
      id: "migrated-fact-1",
      operationId: "migrate-op-1",
      occurredAt: "2026-02-01T00:00:00.000Z",
      provenance: {
        kind: "migration",
        sourceId: "upgrade-migrator",
        sourceHash: `sha256:${"c".repeat(64)}`,
        sourceRevisionId: "revision-1",
        sourceFactId: "source-fact-1",
        sourceFactHash: `sha256:${"d".repeat(64)}`,
        sourceContractHash: contractHash,
        targetContractHash: contractHash,
        migratorVersion: LEARNING_KERNEL_MIGRATOR_VERSION,
        originalProvenance: original,
        ...overrides,
      },
      body: {
        type: "evidence",
        activityId: "activity-recall",
        knowledgeNodeIds: ["node-1"],
        dimension: "understanding",
        evidenceType: "recall",
        outcome: "correct",
        hintLevel: 0,
        basisFactIds: ["basis-1"],
      },
    };
  }

  it("accepts v2 migration correct evidence with equal contract hashes", () => {
    const projection = projectLearningKernel({
      scope,
      activities,
      facts: [basisFact(), migrationFact()],
      observedAt: "2026-02-02T00:00:00.000Z",
    });
    expect(projection.factFrontier).toContain("migrated-fact-1");
  });

  it("rejects legacy v1 migration correct evidence", () => {
    const legacy: LearningKernelFact = {
      schemaVersion: 1,
      ...scope,
      id: "legacy-migration-1",
      operationId: "legacy-op-1",
      occurredAt: "2026-02-01T00:00:00.000Z",
      provenance: {
        kind: "migration",
        sourceId: "legacy",
        sourceHash: `sha256:${"e".repeat(64)}`,
        evaluatorVersion: "legacy-v1",
      },
      body: {
        type: "evidence",
        activityId: "activity-recall",
        knowledgeNodeIds: ["node-1"],
        dimension: "understanding",
        evidenceType: "recall",
        outcome: "correct",
        hintLevel: 0,
        basisFactIds: ["basis-1"],
      },
    };
    expect(() =>
      projectLearningKernel({
        scope,
        activities,
        facts: [basisFact(), legacy],
        observedAt: "2026-02-02T00:00:00.000Z",
      }),
    ).toThrow(/silently upgraded to correct/u);
  });

  it("rejects v2 migration with mismatched contract hashes", () => {
    expect(() =>
      projectLearningKernel({
        scope,
        activities,
        facts: [
          migrationFact({ targetContractHash: `sha256:${"f".repeat(64)}` }),
        ],
        observedAt: "2026-02-02T00:00:00.000Z",
      }),
    ).toThrow(/contract hashes must match/u);
  });

  it("rejects v2 migration with wrong migrator or nested migration", () => {
    expect(() =>
      projectLearningKernel({
        scope,
        activities,
        facts: [migrationFact({ migratorVersion: "other-1" as never })],
        observedAt: "2026-02-02T00:00:00.000Z",
      }),
    ).toThrow(/migrator version/u);
    expect(() =>
      projectLearningKernel({
        scope,
        activities,
        facts: [
          migrationFact({
            originalProvenance: {
              kind: "migration",
              sourceId: "x",
              sourceHash: `sha256:${"a".repeat(64)}`,
            } as never,
          }),
        ],
        observedAt: "2026-02-02T00:00:00.000Z",
      }),
    ).toThrow();
  });

  it("rejects schema/provenance mismatches", () => {
    const v2ShapeAsV1 = migrationFact();
    (v2ShapeAsV1 as { schemaVersion: 1 | 2 }).schemaVersion = 1;
    expect(() =>
      projectLearningKernel({
        scope,
        activities,
        facts: [v2ShapeAsV1],
        observedAt: "2026-02-02T00:00:00.000Z",
      }),
    ).toThrow(/schema v2|lineage/i);
  });
});
