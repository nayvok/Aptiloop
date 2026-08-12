import { describe, expect, it } from "vitest";

import {
  AgentEventSchema,
  AgentRoleSchema,
  CurriculumSourceSchema,
  CurriculumDaySchema,
  CurriculumVersionSchema,
  CourseEntityIdSchema,
  CourseOperationIdSchema,
  CourseDesignerPendingDisclosureResponseSchema,
  DepthLevelSchema,
  LearningKnowledgeNodeIdSchema,
  LearningMistakesResponseSchema,
  LearningPathNextActionSchema,
  LearningReviewsResponseSchema,
  ProviderLoginPromptSchema,
  ProviderLoginStatusSchema,
  SessionSnapshotSchema,
  UnitQuestionSchema,
  UnitProgressSchema,
  ReviewResultSchema,
} from "../src/index.js";

describe("shared contracts", () => {
  it("accepts bounded semantic knowledge-node IDs without weakening entity IDs", () => {
    const longSemanticId = `semantic ${"x".repeat(120)}`;
    expect(LearningKnowledgeNodeIdSchema.parse("primitive values")).toBe(
      "primitive values",
    );
    expect(LearningKnowledgeNodeIdSchema.parse(longSemanticId)).toBe(
      longSemanticId,
    );
    expect(
      LearningKnowledgeNodeIdSchema.safeParse(` ${longSemanticId}`).success,
    ).toBe(false);
    expect(LearningKnowledgeNodeIdSchema.safeParse("   ").success).toBe(false);
    expect(
      LearningKnowledgeNodeIdSchema.safeParse("x".repeat(501)).success,
    ).toBe(false);
    expect(CourseEntityIdSchema.safeParse("primitive values").success).toBe(
      false,
    );
    expect(CourseOperationIdSchema.safeParse("primitive values").success).toBe(
      false,
    );
  });

  it("binds a pending Course Designer disclosure to one exact workflow operation", () => {
    const pendingDisclosure = {
      operationId: "proposal:resume",
      workflowId: "course-designer:workflow-1",
      versionId: "revision-1",
      disclosure: {
        operationId: "disclosure:operation-1",
        scope: {
          role: "course-designer",
          connectionId: "connection-1",
          providerType: "openai",
          modelId: "model-1",
          destination: "Provider: optional Course draft authoring assistance",
          payloadCategories: ["course-content", "learner-message"],
          entityIds: {
            "course-revision": "revision-1",
            "course-designer-workflow": "course-designer:workflow-1",
            "course-designer-authoring-operation": "proposal:resume",
          },
          exclusions: ["credentials"],
          byteCount: 128,
          payloadSha256: `sha256:${"a".repeat(64)}`,
        },
        status: "pending",
        createdAt: "2026-08-11T00:00:00.000Z",
        approvedAt: null,
        consumedAt: null,
        expiresAt: "2026-08-11T00:05:00.000Z",
      },
    } as const;
    expect(
      CourseDesignerPendingDisclosureResponseSchema.parse({
        pendingDisclosure,
      }),
    ).toEqual({ pendingDisclosure });
    expect(
      CourseDesignerPendingDisclosureResponseSchema.safeParse({
        pendingDisclosure: { ...pendingDisclosure, versionId: "revision-2" },
      }).success,
    ).toBe(false);
    expect(
      CourseDesignerPendingDisclosureResponseSchema.safeParse({
        pendingDisclosure: {
          ...pendingDisclosure,
          disclosure: { ...pendingDisclosure.disclosure, status: "approved" },
        },
      }).success,
    ).toBe(false);
  });

  it("validates explicit Course path start and resume actions", () => {
    expect(
      LearningPathNextActionSchema.parse({
        type: "start",
        lessonId: "lesson-1",
      }),
    ).toEqual({ type: "start", lessonId: "lesson-1" });
    expect(
      LearningPathNextActionSchema.parse({
        type: "resume",
        lessonId: "lesson-1",
        sessionId: "session-1",
        currentStep: "lesson-1-activity-2",
      }),
    ).toMatchObject({
      type: "resume",
      sessionId: "session-1",
      currentStep: "lesson-1-activity-2",
    });
    expect(
      LearningPathNextActionSchema.safeParse({
        type: "resume",
        lessonId: "lesson-1",
        sessionId: "session-1",
      }).success,
    ).toBe(false);
  });

  it("binds Review due state to the server clock and exposes only typed execution", () => {
    const response = {
      asOf: "2026-08-11T12:00:00.000Z",
      reviews: [
        {
          id: "review-1",
          topic: "Closures",
          knowledgeNodeId: "primitive values",
          dimension: "understanding",
          activityKind: "recall",
          reasonCode: "mistake",
          dueAt: "2026-08-11T12:00:00.000Z",
          state: "pending",
          isDue: true,
          sessionId: "session-1",
          activityId: "activity-1",
          execution: {
            id: "review-execution-1",
            type: "free-response",
            schemaVersion: 1,
            activitySnapshotHash: "a".repeat(64),
          },
        },
      ],
    } as const;
    expect(LearningReviewsResponseSchema.parse(response)).toEqual(response);
    expect(
      LearningReviewsResponseSchema.safeParse({
        ...response,
        reviews: [{ ...response.reviews[0], isDue: false }],
      }).success,
    ).toBe(false);
    expect(
      LearningReviewsResponseSchema.safeParse({
        ...response,
        reviews: [
          {
            ...response.reviews[0],
            execution: {
              ...response.reviews[0].execution,
              href: "/session?id=session-1",
            },
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("rejects a future Correction classified as due", () => {
    expect(
      LearningMistakesResponseSchema.safeParse({
        asOf: "2026-08-11T12:00:00.000Z",
        mistakes: [
          {
            id: "mistake-1",
            topic: "Closures",
            errorFamily: "scope-error",
            occurrenceCount: 1,
            reviewAt: "2026-08-12T12:00:00.000Z",
            isDue: true,
          },
        ],
      }).success,
    ).toBe(false);
  });

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
    expect(AgentRoleSchema.options).toHaveLength(9);
  });

  it("keeps provider login prompts inside the Aptiloop-owned prompt registry", () => {
    expect(
      ProviderLoginPromptSchema.parse({
        promptId: "88a6558f-d070-478e-adbc-18678089cb43",
        kind: "github-enterprise-domain",
        type: "text",
        optional: true,
        options: [],
      }),
    ).toMatchObject({ kind: "github-enterprise-domain", optional: true });
    expect(
      ProviderLoginPromptSchema.safeParse({
        promptId: "88a6558f-d070-478e-adbc-18678089cb43",
        kind: "openai-codex-login-method",
        type: "select",
        optional: false,
        options: ["raw-provider-option"],
      }).success,
    ).toBe(false);
    expect(
      ProviderLoginPromptSchema.safeParse({
        promptId: "88a6558f-d070-478e-adbc-18678089cb43",
        kind: "github-enterprise-domain",
        type: "text",
        optional: false,
        options: [],
        message: "raw provider prompt",
      }).success,
    ).toBe(false);
  });

  it("rejects raw provider fields from the browser login status contract", () => {
    const status = {
      operationId: "88a6558f-d070-478e-adbc-18678089cb43",
      connectionId: "connection:github",
      status: "running",
      events: [{ type: "progress" }],
      prompt: null,
      error: null,
    } as const;

    expect(ProviderLoginStatusSchema.parse(status)).toEqual(status);
    expect(
      ProviderLoginStatusSchema.safeParse({
        ...status,
        events: [{ type: "progress", message: "raw provider secret" }],
      }).success,
    ).toBe(false);
    expect(
      ProviderLoginStatusSchema.safeParse({
        ...status,
        providerMessage: "raw provider secret",
      }).success,
    ).toBe(false);
  });

  it("allows only pinned provider authorization and device URLs", () => {
    const baseStatus = {
      operationId: "88a6558f-d070-478e-adbc-18678089cb43",
      connectionId: "connection:provider",
      status: "running",
      prompt: null,
      error: null,
    } as const;

    for (const event of [
      {
        type: "auth_url",
        url: "https://auth.openai.com/oauth/authorize?state=opaque",
      },
      {
        type: "auth_url",
        url: "https://claude.ai/oauth/authorize?state=opaque",
      },
      {
        type: "device_code",
        userCode: "CODE",
        verificationUri: "https://auth.openai.com/codex/device",
      },
      {
        type: "device_code",
        userCode: "CODE",
        verificationUri: "https://github.com/login/device",
      },
    ]) {
      expect(
        ProviderLoginStatusSchema.safeParse({
          ...baseStatus,
          events: [event],
        }).success,
      ).toBe(true);
    }

    for (const event of [
      {
        type: "auth_url",
        url: "https://auth.openai.com.attacker.example/oauth/authorize",
      },
      {
        type: "auth_url",
        url: "https://auth.openai.com/oauth/token?state=opaque",
      },
      {
        type: "auth_url",
        url: "https://claude.ai/oauth/authorize#secret",
      },
      {
        type: "device_code",
        userCode: "CODE",
        verificationUri: "https://github.com/login/device?next=evil",
      },
      {
        type: "device_code",
        userCode: "CODE",
        verificationUri: "https://auth.openai.com/codex/device#secret",
      },
    ]) {
      expect(
        ProviderLoginStatusSchema.safeParse({
          ...baseStatus,
          events: [event],
        }).success,
      ).toBe(false);
    }
  });

  it("keeps quiz options public and validates the protected answer key", () => {
    expect(
      UnitQuestionSchema.parse({
        id: "quiz-q1",
        kind: "multiple-choice",
        prompt: "What is typeof null?",
        options: [
          { id: "q1-a", label: "null" },
          { id: "q1-b", label: "object" },
        ],
        correctOptionIds: ["q1-b"],
      }),
    ).toMatchObject({
      kind: "multiple-choice",
      options: [
        { id: "q1-a", label: "null" },
        { id: "q1-b", label: "object" },
      ],
      correctOptionIds: ["q1-b"],
    });
    expect(
      UnitQuestionSchema.parse({ id: "legacy-q", prompt: "Explain" }),
    ).toMatchObject({
      kind: "explain",
      options: [],
      correctOptionIds: [],
    });
    expect(
      UnitQuestionSchema.safeParse({
        id: "quiz-q2",
        kind: "multiple-choice",
        prompt: "Choose",
        options: [{ id: "q2-a", label: "A" }],
        correctOptionIds: ["q2-missing"],
      }).success,
    ).toBe(false);
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
