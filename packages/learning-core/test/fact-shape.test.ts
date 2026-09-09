import { describe, expect, it } from "vitest";

import {
  collectLearningKernelFactShapeIssues,
  LEARNING_KERNEL_MIGRATOR_VERSION,
  type LearningKernelFact,
  type LearningKernelFactProvenance,
} from "../src/index.js";

const hash = `sha256:${"a".repeat(64)}`;
const learner: LearningKernelFactProvenance = {
  kind: "learner_submission",
  sourceId: "browser-operation",
  sourceHash: hash,
};

function validFact(): LearningKernelFact {
  return {
    schemaVersion: 1,
    courseId: "course-1",
    revisionId: "revision-1",
    branchId: "branch-1",
    sessionId: "session-1",
    id: "fact-1",
    operationId: "operation-1",
    occurredAt: "2026-09-09T00:00:00.000Z",
    provenance: learner,
    body: {
      type: "evidence",
      activityId: "activity-1",
      knowledgeNodeIds: ["node-1"],
      dimension: "understanding",
      evidenceType: "recall",
      outcome: "unverified",
      hintLevel: 0,
      basisFactIds: [],
    },
  };
}

describe("collectLearningKernelFactShapeIssues", () => {
  it("accepts a structurally valid v1 fact with no issues", () => {
    expect(collectLearningKernelFactShapeIssues(validFact())).toEqual([]);
  });

  it("rejects an unknown fact body type as an unknown type", () => {
    const fact = validFact() as unknown as Record<string, unknown>;
    const body = fact.body as Record<string, unknown>;
    body.type = "quantum-evidence";
    const issues = collectLearningKernelFactShapeIssues(fact);
    expect(issues).toEqual([
      {
        code: "unknown-type",
        path: "/body/type",
        message: "Unknown Learning Kernel fact type: quantum-evidence",
      },
    ]);
  });

  it("rejects unknown evidence dimension, type, and outcome precisely", () => {
    const fact = validFact();
    const body = {
      ...fact.body,
      dimension: "telepathy",
      evidenceType: "vibes",
      outcome: "ascended",
    } as unknown as LearningKernelFact["body"];
    const issues = collectLearningKernelFactShapeIssues({
      ...fact,
      body,
    });
    expect(issues.map((issue) => [issue.code, issue.path])).toEqual([
      ["unknown-type", "/body/dimension"],
      ["unknown-type", "/body/evidenceType"],
      ["unknown-type", "/body/outcome"],
    ]);
  });

  it("rejects an unknown provenance kind and unknown schema version", () => {
    const fact = {
      ...validFact(),
      provenance: { ...learner, kind: "oracle" },
    } as unknown as LearningKernelFact;
    expect(
      collectLearningKernelFactShapeIssues(fact).map((issue) => [
        issue.code,
        issue.path,
      ]),
    ).toEqual([["unknown-type", "/provenance/kind"]]);
    expect(
      collectLearningKernelFactShapeIssues({
        ...validFact(),
        schemaVersion: 99,
      } as unknown as LearningKernelFact).map((issue) => issue.path),
    ).toEqual(["/schemaVersion"]);
  });

  it("rejects unknown fields and malformed evidence authority", () => {
    const fact = validFact() as unknown as Record<string, unknown>;
    fact.extraField = "nope";
    const unknownFieldIssues = collectLearningKernelFactShapeIssues(fact);
    expect(unknownFieldIssues).toHaveLength(1);
    expect(unknownFieldIssues[0]).toMatchObject({
      code: "invalid-shape",
      path: "",
    });
    expect(unknownFieldIssues[0]!.message).toContain("extraField");

    const asserting = validFact();
    const issues = collectLearningKernelFactShapeIssues({
      ...asserting,
      body: { ...asserting.body, outcome: "correct" },
    });
    expect(issues.map((issue) => [issue.code, issue.path])).toEqual([
      ["invalid-shape", "/body/basisFactIds"],
      ["invalid-shape", "/body/outcome"],
    ]);
  });

  it("accepts a v2 migration fact and rejects a v1 migration provenance", () => {
    const original = {
      kind: "learner_submission",
      sourceId: "browser-operation",
      sourceHash: hash,
    };
    const migrated = {
      ...validFact(),
      schemaVersion: 2,
      provenance: {
        kind: "migration",
        sourceId: "legacy-source",
        sourceHash: hash,
        sourceRevisionId: "legacy-revision",
        sourceFactId: "legacy-fact",
        sourceFactHash: hash,
        sourceContractHash: hash,
        targetContractHash: hash,
        migratorVersion: LEARNING_KERNEL_MIGRATOR_VERSION,
        originalProvenance: original,
      },
    } as LearningKernelFact;
    expect(collectLearningKernelFactShapeIssues(migrated)).toEqual([]);
    const wrongVersion = {
      ...migrated,
      schemaVersion: 1,
    } as LearningKernelFact;
    expect(
      collectLearningKernelFactShapeIssues(wrongVersion).map(
        (issue) => issue.path,
      ),
    ).toEqual(["/provenance"]);
  });
});
