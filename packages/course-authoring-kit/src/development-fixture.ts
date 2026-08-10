import { finalizeCoursePack, type CoursePackV1 } from "./course-pack.js";

const PLACEHOLDER_HASH = `sha256:${"0".repeat(64)}`;

/** Synthetic local-only fixture. It is not a production Course. */
export function createDevelopmentCoursePackFixture(): CoursePackV1 {
  return finalizeCoursePack({
    format: "aptiloop.course-pack",
    formatVersion: 1,
    course: {
      courseKey: "development-kernel-basics",
      title: "Deterministic Learning Basics",
      description: "A synthetic local fixture for Course Pack contract tests.",
      primaryLocale: "en-US",
      availableLocales: ["en-US"],
      subjectTags: ["determinism", "learning"],
      provenance: {
        contentStatus: "development-fixture",
        author: "Aptiloop development fixture",
        origin: "original",
        ownership: "owned",
        licenseSpdx: null,
        termsUrl: "https://example.invalid/aptiloop-development-fixture-terms",
        attribution: "Synthetic test content; not a production Course.",
        createdAt: "2026-08-10T00:00:00.000Z",
        notes: "Used only for local validation and import tests.",
      },
    },
    revision: {
      revisionKey: "development-kernel-basics/v1",
      revisionNumber: 1,
      parentRevisionKey: null,
      branchKind: "upstream",
      basedOnContentHash: null,
      contentHash: PLACEHOLDER_HASH,
    },
    requirements: {
      activityTypes: ["recall", "study"],
      capabilities: [],
      environmentIds: [],
      checkIds: [],
    },
    knowledge: {
      nodes: [
        {
          knowledgeNodeId: "deterministic-replay",
          title: "Deterministic replay",
          description:
            "Reconstructing the same projection from the same facts.",
          kind: "concept",
          prerequisiteKnowledgeNodeIds: [],
          relatedKnowledgeNodeIds: [],
          lifecycle: "active",
        },
      ],
      sourceSnapshots: [],
      capsules: [],
    },
    localizations: [],
    lessons: [
      {
        lessonId: "replay-lesson",
        order: 0,
        title: "Replay from facts",
        description: "Learn why durable facts determine projections.",
        goal: "Explain deterministic replay without relying on model output.",
        estimatedMinutes: 10,
        knowledgeNodeIds: ["deterministic-replay"],
        entryActivityIds: ["study-replay"],
        activities: [
          {
            activityId: "study-replay",
            schemaVersion: 1,
            order: 0,
            type: "study",
            title: "Study replay",
            description: "Read the learner-safe explanation.",
            estimatedMinutes: 4,
            required: true,
            prerequisiteActivityIds: [],
            capabilityIds: [],
            knowledgeNodeIds: ["deterministic-replay"],
            sourceSnapshotIds: [],
            completionCriteria: [{ type: "acknowledgement" }],
            payload: {
              type: "study",
              body: "A deterministic projection is a pure function of ordered facts and an explicit model version.",
            },
            protectedMaterial: { referenceAnswer: null, questions: [] },
          },
          {
            activityId: "recall-replay",
            schemaVersion: 1,
            order: 1,
            type: "recall",
            title: "Recall replay",
            description: "Answer before viewing protected feedback.",
            estimatedMinutes: 6,
            required: true,
            prerequisiteActivityIds: ["study-replay"],
            capabilityIds: [],
            knowledgeNodeIds: ["deterministic-replay"],
            sourceSnapshotIds: [],
            completionCriteria: [{ type: "attempts", minimum: 1 }],
            payload: {
              type: "recall",
              prompt: "What inputs make a learning projection reproducible?",
            },
            protectedMaterial: {
              referenceAnswer:
                "The immutable snapshot, ordered accepted facts, model version, and explicit observed clock.",
              questions: [],
            },
          },
        ],
      },
    ],
  });
}
