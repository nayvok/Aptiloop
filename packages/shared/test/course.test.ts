import { describe, expect, it } from "vitest";

import {
  ActivityDefinitionSchema,
  ActivityEvidenceOwnershipSchema,
  AdaptationBranchSchema,
  CourseRevisionSchema,
  CourseLessonSchema,
  CourseSchema,
  EvidenceFactSchema,
  KnowledgeCapsuleSchema,
  LearnerActivityDefinitionSchema,
  ReviewItemOwnershipSchema,
  ReviewItemSchema,
  SourceSnapshotSchema,
  StableIdentityReuseInputSchema,
  toLearnerActivityDefinition,
} from "../src/index.js";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const INSTANT = "2026-08-09T12:00:00.000Z";

const course = {
  id: "course-row",
  stableId: "course-stable",
  title: "Course",
  description: null,
  primaryLocale: "und",
  createdAt: INSTANT,
  updatedAt: INSTANT,
} as const;

const recallActivity = {
  id: "activity-recall",
  courseId: course.id,
  revisionId: "revision-1",
  lessonId: "lesson-1",
  stableId: "recall",
  type: "recall",
  order: 0,
  title: "Recall",
  description: "Explain the concept from memory.",
  required: true,
  prerequisiteActivityIds: [],
  capabilityIds: [],
  completionCriteria: [{ type: "attempts", minimum: 1 }],
  payload: { type: "recall", prompt: "What did you learn?" },
  protectedMaterial: { referenceAnswer: null, questions: [] },
} as const;

const evidence = {
  id: "evidence-1",
  schemaVersion: 1,
  operationId: "operation-1",
  courseId: course.id,
  revisionId: recallActivity.revisionId,
  lessonId: recallActivity.lessonId,
  sessionId: "session-1",
  activityId: recallActivity.id,
  type: "recall-attempt",
  questionId: "question-1",
  correctness: 0.75,
  occurredAt: INSTANT,
  recordedAt: INSTANT,
  payload: { answer: "A value is data with a type." },
  provenance: {
    kind: "migration",
    sourceTable: "versioned_unit_evidence",
    sourcePrimaryKey: "legacy-evidence-1",
    sourceRowHash: HASH_A,
    transformVersion: "m2-v1",
  },
} as const;

const reviewItem = {
  id: "review-item-1",
  courseId: course.id,
  revisionId: recallActivity.revisionId,
  sourceEvidenceId: evidence.id,
  kind: "activity-review",
  status: "pending",
  dueAt: INSTANT,
  payload: { reason: "first-attempt" },
  schedulerVersion: "m2-v1",
  createdAt: INSTANT,
} as const;

describe("Course foundation contracts", () => {
  it("accepts bounded strict Course and published revision contracts", () => {
    expect(CourseSchema.parse(course).primaryLocale).toBe("und");
    expect(
      CourseRevisionSchema.parse({
        id: "revision-1",
        courseId: course.id,
        revisionNumber: 1,
        parentRevisionId: null,
        branchKind: "upstream",
        status: "published",
        contentHash: HASH_A,
        basedOnContentHash: null,
        createdAt: INSTANT,
        publishedAt: INSTANT,
      }).contentHash,
    ).toBe(HASH_A);
    expect(
      CourseRevisionSchema.safeParse({
        id: "revision-personal",
        courseId: course.id,
        revisionNumber: 2,
        parentRevisionId: "revision-1",
        branchKind: "personal",
        status: "published",
        contentHash: `sha256:${HASH_B}`,
        basedOnContentHash: `sha256:${HASH_A}`,
        createdAt: INSTANT,
        publishedAt: INSTANT,
      }).success,
    ).toBe(true);
  });

  it("validates explicit lesson entries and learner-owned adaptation lineage", () => {
    expect(
      CourseLessonSchema.safeParse({
        id: "lesson-1",
        courseId: course.id,
        revisionId: "revision-1",
        stableId: "lesson-1",
        order: 0,
        title: "Lesson",
        description: "A finite lesson.",
        goal: "Explain the value model.",
        prerequisiteLessonIds: [],
        entryActivityIds: [recallActivity.id],
      }).success,
    ).toBe(true);
    expect(
      CourseLessonSchema.safeParse({
        id: "lesson-1",
        courseId: course.id,
        revisionId: "revision-1",
        stableId: "lesson-1",
        order: 0,
        title: "Lesson",
        description: "A finite lesson.",
        goal: "Explain the value model.",
        prerequisiteLessonIds: [],
        entryActivityIds: [recallActivity.id, recallActivity.id],
      }).success,
    ).toBe(false);
    expect(
      AdaptationBranchSchema.safeParse({
        id: "branch-1",
        courseId: course.id,
        owner: "local",
        baseRevisionId: "revision-1",
        headRevisionId: "revision-personal",
        status: "active",
        createdAt: INSTANT,
        updatedAt: INSTANT,
      }).success,
    ).toBe(true);
    expect(
      AdaptationBranchSchema.safeParse({
        id: "branch-1",
        courseId: course.id,
        owner: "learner-supplied",
        baseRevisionId: "revision-1",
        headRevisionId: "revision-1",
        status: "active",
        createdAt: INSTANT,
        updatedAt: INSTANT,
      }).success,
    ).toBe(false);
  });

  it("rejects unknown fields, malformed IDs, and invalid revision state", () => {
    expect(CourseSchema.safeParse({ ...course, extra: true }).success).toBe(
      false,
    );
    expect(
      CourseSchema.safeParse({ ...course, stableId: "Bad stable id" }).success,
    ).toBe(false);
    expect(
      CourseRevisionSchema.safeParse({
        id: "revision-1",
        courseId: course.id,
        revisionNumber: 1,
        parentRevisionId: null,
        branchKind: "personal",
        status: "published",
        contentHash: "not-a-hash",
        basedOnContentHash: null,
        createdAt: INSTANT,
        publishedAt: null,
      }).success,
    ).toBe(false);
  });

  it("keeps protected material out of the learner-safe Activity projection", () => {
    const parsed = ActivityDefinitionSchema.parse(recallActivity);
    const learnerActivity = toLearnerActivityDefinition(parsed);
    expect(learnerActivity).not.toHaveProperty("protectedMaterial");
    expect(
      LearnerActivityDefinitionSchema.safeParse(recallActivity).success,
    ).toBe(false);
    expect(
      ActivityDefinitionSchema.safeParse({
        ...recallActivity,
        payload: {
          ...recallActivity.payload,
          referenceAnswer: "Protected answer",
        },
      }).success,
    ).toBe(false);
  });

  it("rejects unknown Activity types and mismatched registered payloads", () => {
    expect(
      ActivityDefinitionSchema.safeParse({
        ...recallActivity,
        type: "future-renderer",
        payload: { type: "future-renderer" },
      }).success,
    ).toBe(false);
    expect(
      ActivityDefinitionSchema.safeParse({
        ...recallActivity,
        type: "quiz",
      }).success,
    ).toBe(false);
    expect(
      ActivityDefinitionSchema.safeParse({
        ...recallActivity,
        type: "quiz",
        payload: {
          type: "quiz",
          questionIds: ["malformed question id"],
          minimumScore: 0.8,
        },
      }).success,
    ).toBe(false);
    expect(
      ActivityDefinitionSchema.safeParse({
        ...recallActivity,
        completionCriteria: [{ type: "attempts", minimum: 1, unknown: true }],
      }).success,
    ).toBe(false);
  });

  it("accepts immutable Source Snapshots and citation-closed capsules", () => {
    const snapshot = {
      snapshotId: "snapshot-1",
      courseId: course.id,
      revisionId: "revision-1",
      sourceAuthorityId: "mdn",
      canonicalUrl: "https://developer.mozilla.org/docs/Web/JavaScript",
      retrievedAt: INSTANT,
      retrievalMethod: "manual-import",
      mediaType: "text/html",
      locale: "en-US",
      contentHash: HASH_A,
      content: "Captured source excerpt.",
      title: "JavaScript",
      authorPublisher: "MDN",
      publishedOrUpdatedAt: null,
      attribution: null,
      licenseSpdx: null,
      termsUrl: null,
      locatorMap: [{ type: "text", heading: "Values", paragraphIndex: 0 }],
    } as const;
    expect(SourceSnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(
      SourceSnapshotSchema.safeParse({
        ...snapshot,
        retrievalMethod: "migration",
      }).success,
    ).toBe(true);
    expect(
      SourceSnapshotSchema.safeParse({
        ...snapshot,
        supersedesSnapshotId: snapshot.snapshotId,
      }).success,
    ).toBe(false);

    expect(
      KnowledgeCapsuleSchema.safeParse({
        capsuleId: "capsule-1",
        courseId: course.id,
        revisionId: "revision-1",
        schemaVersion: 1,
        knowledgeNodeIds: ["values"],
        primaryLocale: "en-US",
        claims: [
          {
            claimId: "claim-1",
            statement: "JavaScript values have types.",
            citationIds: ["citation-1"],
            confidence: "direct",
          },
        ],
        citations: [
          {
            citationId: "citation-1",
            snapshotId: snapshot.snapshotId,
            locator: snapshot.locatorMap[0],
            quoteHash: HASH_B,
          },
        ],
        conflicts: [],
        createdBy: "manual",
        validationHash: HASH_A,
        createdAt: INSTANT,
      }).success,
    ).toBe(true);
    expect(
      KnowledgeCapsuleSchema.safeParse({
        capsuleId: "capsule-2",
        courseId: course.id,
        revisionId: "revision-1",
        schemaVersion: 1,
        knowledgeNodeIds: [],
        primaryLocale: "en-US",
        claims: [
          {
            claimId: "claim-1",
            statement: "Uncited claim.",
            citationIds: ["missing-citation"],
            confidence: "direct",
          },
        ],
        citations: [],
        conflicts: [],
        createdBy: "manual",
        validationHash: HASH_A,
        createdAt: INSTANT,
      }).success,
    ).toBe(false);
  });

  it("enforces typed Evidence and Review ownership", () => {
    expect(EvidenceFactSchema.safeParse(evidence).success).toBe(true);
    expect(
      EvidenceFactSchema.parse({
        ...evidence,
        questionId: null,
        correctness: null,
      }),
    ).toMatchObject({ questionId: null, correctness: null });
    expect(
      EvidenceFactSchema.safeParse({
        ...evidence,
        correctness: 1.01,
      }).success,
    ).toBe(false);
    const { questionId, ...evidenceWithoutQuestionId } = evidence;
    expect(questionId).toBe("question-1");
    expect(
      EvidenceFactSchema.safeParse(evidenceWithoutQuestionId).success,
    ).toBe(false);
    expect(
      EvidenceFactSchema.safeParse({
        ...evidence,
        protectedReference: "answer",
      }).success,
    ).toBe(false);
    expect(ReviewItemSchema.safeParse(reviewItem).success).toBe(true);
    expect(
      ActivityEvidenceOwnershipSchema.safeParse({
        activity: recallActivity,
        evidence,
      }).success,
    ).toBe(true);
    expect(
      ReviewItemOwnershipSchema.safeParse({
        reviewItem,
        sourceEvidence: evidence,
      }).success,
    ).toBe(true);
    expect(
      ActivityEvidenceOwnershipSchema.safeParse({
        activity: { ...recallActivity, revisionId: "revision-other" },
        evidence,
      }).success,
    ).toBe(false);
    expect(
      ReviewItemOwnershipSchema.safeParse({
        reviewItem: { ...reviewItem, courseId: "course-other" },
        sourceEvidence: evidence,
      }).success,
    ).toBe(false);
    expect(
      EvidenceFactSchema.safeParse({
        ...evidence,
        type: "teacher-opinion",
      }).success,
    ).toBe(false);
    expect(
      ReviewItemSchema.safeParse({
        ...reviewItem,
        kind: "recall",
      }).success,
    ).toBe(false);
    expect(
      EvidenceFactSchema.safeParse({
        ...evidence,
        provenance: { ...evidence.provenance, unboundedDiagnostic: "x" },
      }).success,
    ).toBe(false);
  });

  it("rejects stale scoped stable-ID reuse with a different semantic hash", () => {
    const existing = {
      entityType: "activity",
      courseId: course.id,
      revisionId: "revision-1",
      stableId: "recall",
      semanticHash: HASH_A,
    } as const;
    expect(
      StableIdentityReuseInputSchema.safeParse({
        existing,
        candidate: { ...existing, semanticHash: `sha256:${HASH_A}` },
      }).success,
    ).toBe(true);
    expect(
      StableIdentityReuseInputSchema.safeParse({
        existing,
        candidate: { ...existing, semanticHash: HASH_B },
      }).success,
    ).toBe(false);
  });
});
