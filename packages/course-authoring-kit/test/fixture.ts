import {
  CoursePackAuthoringDraftV1Schema,
  finalizeCoursePack,
  finalizeCoursePackAuthoringDraft,
  type CoursePackAuthoringDraftV1,
  type CoursePackV1,
} from "../src/index.js";

const PLACEHOLDER_HASH = `sha256:${"0".repeat(64)}`;

/** Synthetic test-only fixture. It is never generated or imported by production code. */
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

export const validCoursePack = createDevelopmentCoursePackFixture;

/** Minimal current hashless draft with one independently completable lesson. */
export function createCoursePackAuthoringDraftFixture(): CoursePackAuthoringDraftV1 {
  return CoursePackAuthoringDraftV1Schema.parse({
    format: "aptiloop.course-pack-authoring-draft",
    formatVersion: 1,
    formatMinorVersion: 1,
    course: {
      courseKey: "authoring-contract-fixture",
      title: "Course Authoring Contract",
      description: "A synthetic hashless draft for bounded contract tests.",
      primaryLocale: "en-US",
      availableLocales: ["en-US"],
      subjectTags: ["authoring", "determinism"],
      provenance: {
        contentStatus: "development-fixture",
        author: "Aptiloop development fixture",
        origin: "original",
        ownership: "owned",
        licenseSpdx: "Apache-2.0",
        termsUrl: null,
        attribution: "Synthetic test content; not a production Course.",
        createdAt: "2026-08-20T00:00:00.000Z",
        notes: "Used only for deterministic Course Pack authoring tests.",
      },
    },
    revision: {
      revisionKey: "authoring-contract-fixture/v1",
      revisionNumber: 1,
      parentRevisionKey: null,
      branchKind: "upstream",
      basedOnContentHash: null,
    },
    knowledge: {
      nodes: [
        {
          knowledgeNodeId: "deterministic-sequence",
          title: "Deterministic sequence",
          description: "A stable prerequisite order with explicit identities.",
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
        lessonId: "minimal-lesson",
        order: 0,
        title: "Confirm the foundation",
        description: "Confirm the minimum deterministic Course boundary.",
        goal: "Acknowledge the explicit Course foundation.",
        estimatedMinutes: 2,
        knowledgeNodeIds: ["deterministic-sequence"],
        prerequisiteLessonIds: [],
        entryActivityIds: ["minimal-checkpoint"],
        activities: [
          {
            activityId: "minimal-checkpoint",
            schemaVersion: 1,
            order: 0,
            type: "checkpoint",
            title: "Foundation checkpoint",
            description: "Confirm the deterministic foundation.",
            estimatedMinutes: 2,
            required: true,
            prerequisiteActivityIds: [],
            capabilityIds: [],
            knowledgeNodeIds: ["deterministic-sequence"],
            sourceSnapshotIds: [],
            completionCriteria: [{ type: "acknowledgement" }],
            payload: {
              type: "checkpoint",
              label: "Confirm the deterministic foundation",
            },
            protectedMaterial: { referenceAnswer: null, questions: [] },
          },
        ],
      },
    ],
  });
}

/** Three current lessons in a stable prerequisite chain. */
export function createSequentialCoursePackAuthoringDraftFixture(): CoursePackAuthoringDraftV1 {
  const draft = createCoursePackAuthoringDraftFixture();
  const foundation = draft.lessons[0]!;
  foundation.lessonId = "foundation-lesson";
  foundation.title = "Establish the foundation";
  foundation.description = "Confirm the deterministic foundation first.";
  foundation.goal = "Acknowledge the deterministic foundation.";
  foundation.entryActivityIds = ["foundation-checkpoint"];
  foundation.activities[0] = {
    ...foundation.activities[0]!,
    activityId: "foundation-checkpoint",
    title: "Foundation checkpoint",
    description: "Confirm the deterministic foundation.",
    payload: {
      type: "checkpoint",
      label: "Confirm the deterministic foundation",
    },
  };

  const practice = structuredClone(foundation);
  practice.lessonId = "practice-lesson";
  practice.order = 1;
  practice.title = "Practice the sequence";
  practice.description = "Apply the deterministic sequence after foundation.";
  practice.goal = "Describe the stable sequence in your own words.";
  practice.estimatedMinutes = 4;
  practice.prerequisiteLessonIds = ["foundation-lesson"];
  practice.entryActivityIds = ["practice-study"];
  practice.activities = [
    {
      ...practice.activities[0]!,
      activityId: "practice-study",
      type: "study",
      title: "Study the sequence",
      description: "Read the ordered sequence.",
      estimatedMinutes: 4,
      payload: {
        type: "study",
        body: "Practice the deterministic sequence.",
      },
    },
  ];

  const reflection = structuredClone(practice);
  reflection.lessonId = "reflection-lesson";
  reflection.order = 2;
  reflection.title = "Reflect on determinism";
  reflection.description = "Recall why the explicit sequence is stable.";
  reflection.goal = "Explain what makes the lesson sequence deterministic.";
  reflection.estimatedMinutes = 5;
  reflection.prerequisiteLessonIds = ["practice-lesson"];
  reflection.entryActivityIds = ["reflection-recall"];
  reflection.activities = [
    {
      ...reflection.activities[0]!,
      activityId: "reflection-recall",
      type: "recall",
      title: "Recall the sequence",
      description: "Explain the deterministic prerequisite order.",
      estimatedMinutes: 5,
      completionCriteria: [{ type: "attempts", minimum: 1 }],
      payload: {
        type: "recall",
        prompt: "What makes the lesson sequence deterministic?",
      },
      protectedMaterial: {
        referenceAnswer:
          "Stable lesson identities and an explicit acyclic prerequisite graph.",
        questions: [
          {
            id: "reflection-question",
            kind: "explain",
            prompt: "Why can the sequence be replayed deterministically?",
            options: [],
            correctOptionIds: [],
            referenceAnswer:
              "Every prerequisite is explicit, stable, present, and acyclic.",
            evaluationPoints: ["Mentions explicit stable prerequisites"],
            commonMistakes: ["Relying only on display order"],
          },
        ],
      },
    },
  ];
  draft.lessons = [foundation, practice, reflection];
  return CoursePackAuthoringDraftV1Schema.parse(draft);
}

export function createSequentialCoursePackFixture(): CoursePackV1 {
  return finalizeCoursePackAuthoringDraft(
    createSequentialCoursePackAuthoringDraftFixture(),
  );
}

/** Four lessons whose middle branches converge on a synthesis lesson. */
export function createBranchingCoursePackAuthoringDraftFixture(): CoursePackAuthoringDraftV1 {
  const draft = createSequentialCoursePackAuthoringDraftFixture();
  const reflection = draft.lessons[2]!;
  reflection.prerequisiteLessonIds = ["foundation-lesson"];
  const synthesis = structuredClone(draft.lessons[1]!);
  synthesis.lessonId = "synthesis-lesson";
  synthesis.order = 3;
  synthesis.title = "Synthesize both branches";
  synthesis.description = "Join practice and reflection into one explanation.";
  synthesis.goal = "Synthesize both deterministic branches.";
  synthesis.prerequisiteLessonIds = ["practice-lesson", "reflection-lesson"];
  synthesis.entryActivityIds = ["synthesis-study"];
  synthesis.activities[0] = {
    ...synthesis.activities[0]!,
    activityId: "synthesis-study",
    title: "Synthesize the branches",
    description: "Connect both prerequisite branches.",
    completionCriteria: [{ type: "acknowledgement" }],
    payload: {
      type: "study",
      body: "Both branches converge through explicit stable prerequisites.",
    },
  };
  draft.lessons.push(synthesis);
  return CoursePackAuthoringDraftV1Schema.parse(draft);
}

/** Multiple activity types with realistic fenced and dedicated React code. */
export function createMultipleActivityTypesCoursePackAuthoringDraftFixture(): CoursePackAuthoringDraftV1 {
  const draft = createCoursePackAuthoringDraftFixture();
  const lesson = draft.lessons[0]!;
  lesson.lessonId = "multi-activity-lesson";
  lesson.title = "Read and recall React code";
  lesson.description = "Study realistic TypeScript and React examples safely.";
  lesson.goal = "Explain an explicit React event handler.";
  lesson.estimatedMinutes = 12;
  lesson.entryActivityIds = ["multi-checkpoint"];
  lesson.activities = [
    {
      ...lesson.activities[0]!,
      activityId: "multi-checkpoint",
      order: 0,
      title: "Start the example",
      description: "Confirm readiness for the example.",
      payload: { type: "checkpoint", label: "Start the React example" },
    },
    {
      ...lesson.activities[0]!,
      activityId: "multi-study",
      order: 1,
      type: "study",
      title: "Study fenced React",
      description: "Read a fenced learner-visible React example.",
      prerequisiteActivityIds: ["multi-checkpoint"],
      payload: {
        type: "study",
        body: [
          "JavaScript keeps the transformation explicit:",
          "",
          "```js",
          "const doubled = values.map((value) => value * 2);",
          "```",
          "",
          "TypeScript names the handler contract:",
          "",
          "```ts",
          "type RunAction = () => void;",
          "const runAction: RunAction = () => recordAttempt();",
          "```",
          "",
          "React passes that handler declaratively:",
          "",
          "```tsx",
          "export function Action() {",
          "  return <button onClick={() => runAction()}>Run</button>;",
          "}",
          "```",
        ].join("\n"),
      },
    },
    {
      ...lesson.activities[0]!,
      activityId: "multi-code-reading",
      order: 2,
      type: "code-reading",
      title: "Read the handler",
      description: "Inspect the dedicated educational code field.",
      prerequisiteActivityIds: ["multi-study"],
      completionCriteria: [
        {
          type: "fields",
          required: ["explanation", "prediction", "verbalFix"],
        },
      ],
      payload: {
        type: "code-reading",
        snippet:
          "export const Action = () => <button onClick={() => runAction()}>Run</button>;",
      },
    },
    {
      ...lesson.activities[0]!,
      activityId: "multi-recall",
      order: 3,
      type: "recall",
      title: "Recall the handler",
      description: "Explain why the handler is inert Course content.",
      prerequisiteActivityIds: ["multi-code-reading"],
      completionCriteria: [{ type: "attempts", minimum: 1 }],
      payload: {
        type: "recall",
        prompt: "Where is the React handler represented?",
      },
      protectedMaterial: {
        referenceAnswer:
          "Inside declarative educational code, never authority.",
        questions: [],
      },
    },
  ];
  return CoursePackAuthoringDraftV1Schema.parse(draft);
}

/** Quiz fixture keeping answer material server-side and reference-linked. */
export function createProtectedMaterialCoursePackAuthoringDraftFixture(): CoursePackAuthoringDraftV1 {
  const draft = createCoursePackAuthoringDraftFixture();
  const lesson = draft.lessons[0]!;
  lesson.entryActivityIds = ["protected-quiz"];
  lesson.activities = [
    {
      ...lesson.activities[0]!,
      activityId: "protected-quiz",
      type: "quiz",
      title: "Protected graph question",
      description: "Choose the property required for deterministic replay.",
      completionCriteria: [{ type: "score", minimum: 1, minimumAttempts: 1 }],
      payload: {
        type: "quiz",
        questionIds: ["protected-question"],
        minimumScore: 1,
      },
      protectedMaterial: {
        referenceAnswer: "The prerequisite graph must be explicit and acyclic.",
        questions: [
          {
            id: "protected-question",
            kind: "multiple-choice",
            prompt: "Which graph property enables deterministic replay?",
            options: [
              { id: "option-a", label: "Implicit model ordering" },
              { id: "option-b", label: "Explicit acyclic prerequisites" },
            ],
            correctOptionIds: ["option-b"],
            referenceAnswer:
              "The correct property is an explicit acyclic prerequisite graph.",
            evaluationPoints: ["Selects the explicit graph invariant"],
            commonMistakes: ["Treating display order as an edge"],
          },
        ],
      },
    },
  ];
  return CoursePackAuthoringDraftV1Schema.parse(draft);
}

/** Structurally valid draft whose derived trusted check is unavailable. */
export function createRegistryMismatchCoursePackAuthoringDraftFixture(): CoursePackAuthoringDraftV1 {
  const draft = createCoursePackAuthoringDraftFixture();
  const lesson = draft.lessons[0]!;
  lesson.entryActivityIds = ["registry-exercise"];
  lesson.activities = [
    {
      ...lesson.activities[0]!,
      activityId: "registry-exercise",
      type: "exercise",
      title: "Unavailable trusted check",
      description: "Reference a check absent from the current registry.",
      completionCriteria: [
        {
          type: "exercise",
          passingTestsRequired: true,
          acceptedReviewRequired: true,
        },
      ],
      payload: {
        type: "exercise",
        exerciseId: "registry-exercise",
        acceptanceCriteria: ["Return the deterministic value"],
        constraints: ["Keep the function pure"],
        template: "export const value: number = 1;",
        testCommandId: "missing-check",
        hintPolicy: "Hints describe the invariant only.",
        reviewPolicy: "Review checks the declared acceptance criterion.",
      },
    },
  ];
  return CoursePackAuthoringDraftV1Schema.parse(draft);
}

export interface BrokenLessonGraphDraftFixtures {
  readonly missing: CoursePackAuthoringDraftV1;
  readonly self: CoursePackAuthoringDraftV1;
  readonly cycle: CoursePackAuthoringDraftV1;
}

/** Shape-valid current drafts for each fail-closed lesson graph boundary. */
export function createBrokenLessonGraphCoursePackAuthoringDraftFixtures(): BrokenLessonGraphDraftFixtures {
  const missing = createSequentialCoursePackAuthoringDraftFixture();
  missing.lessons[1]!.prerequisiteLessonIds = ["missing-lesson"];
  const self = createSequentialCoursePackAuthoringDraftFixture();
  self.lessons[1]!.prerequisiteLessonIds = ["practice-lesson"];
  const cycle = createSequentialCoursePackAuthoringDraftFixture();
  cycle.lessons[0]!.prerequisiteLessonIds = ["reflection-lesson"];
  return { missing, self, cycle };
}

export interface MissingContentTermsDraftFixtures {
  readonly course: CoursePackAuthoringDraftV1;
  readonly source: CoursePackAuthoringDraftV1;
}

/** Shape-valid drafts that isolate Course and Source terms blockers. */
export function createMissingContentTermsCoursePackAuthoringDraftFixtures(): MissingContentTermsDraftFixtures {
  const course = createCoursePackAuthoringDraftFixture();
  course.course.provenance.licenseSpdx = null;
  course.course.provenance.termsUrl = null;

  const source = createCoursePackAuthoringDraftFixture();
  source.knowledge.sourceSnapshots = [
    {
      snapshotId: "missing-source-terms",
      sourceAuthorityId: "example-authority",
      canonicalUrl: "https://example.invalid/source",
      retrievedAt: "2026-08-20T00:00:00.000Z",
      retrievalMethod: "manual-import",
      mediaType: "text/plain",
      locale: "en-US",
      contentHash: PLACEHOLDER_HASH,
      content: null,
      title: "Source without declared terms",
      authorPublisher: "Example publisher",
      publishedOrUpdatedAt: null,
      attribution: "Example publisher",
      licenseSpdx: null,
      termsUrl: null,
      locatorMap: [],
      retentionMode: "metadata-only",
      supersedesSnapshotId: null,
      privacyClass: "public",
    },
  ];
  return {
    course: CoursePackAuthoringDraftV1Schema.parse(course),
    source: CoursePackAuthoringDraftV1Schema.parse(source),
  };
}
