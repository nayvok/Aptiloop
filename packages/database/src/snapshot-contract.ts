import {
  CurriculumSourceSchema,
  SessionSnapshotSchema,
  UnitCompletionCriterionSchema,
  UnitPayloadSchema,
  UnitProgressPayloadSchema,
  UnitQuestionSchema,
  UnitTypeSchema,
  type SessionSnapshot,
  type UnitPayload,
  type UnitProgressPayload,
  type UnitType,
} from "@aptiloop/shared";

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const array = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];
const text = (value: unknown, fallback: string): string =>
  typeof value === "string" && value.trim() ? value : fallback;
const number = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

export function toIsoDateTime(
  value: number | string | null | undefined,
): string {
  if (typeof value === "string" && !Number.isNaN(Date.parse(value))) {
    return new Date(value).toISOString();
  }
  return new Date(typeof value === "number" ? value : 0).toISOString();
}

export function createInitialProgressPayload(
  type: UnitType,
): UnitProgressPayload {
  return UnitProgressPayloadSchema.parse({ type });
}

function fallbackUnitPayload(input: {
  type: UnitType;
  title: string;
  description: string;
  stableId: string;
  questionIds: string[];
  topics: string[];
  previousUnitId: string | null;
}): UnitPayload {
  switch (input.type) {
    case "briefing":
      return { type: "briefing", scope: [], outOfScope: [] };
    case "study":
      return { type: "study", body: input.description };
    case "recall":
      return { type: "recall", prompt: input.description };
    case "teacher-dialogue":
      return {
        type: "teacher-dialogue",
        openingPrompt: input.description,
        minimumTurns: 1,
        requiresRevision: true,
      };
    case "quiz":
      return {
        type: "quiz",
        questionIds: input.questionIds,
        minimumScore: 0,
      };
    case "code-reading":
      return { type: "code-reading", snippet: input.description };
    case "exercise":
      return {
        type: "exercise",
        exerciseId: input.stableId,
        acceptanceCriteria: ["Complete the preserved legacy exercise"],
        constraints: [],
        template: input.description,
        testCommandId: `legacy-${input.stableId}`,
        hintPolicy: "progressive-0-to-5",
        reviewPolicy: "diff-and-tests-read-only",
      };
    case "review":
      return {
        type: "review",
        exerciseUnitId: input.previousUnitId ?? input.stableId,
      };
    case "interview":
      return {
        type: "interview",
        topics: input.topics.length ? input.topics : [input.title],
      };
    case "summary":
      return { type: "summary", prompts: [] };
    case "checkpoint":
      return { type: "checkpoint", label: input.title };
    case "spaced-review":
      return {
        type: "spaced-review",
        topicIds: input.topics.length ? input.topics : [input.stableId],
      };
  }
}

export function normalizeSessionSnapshotV2(raw: unknown): SessionSnapshot {
  const root = object(raw);
  const week = object(root.week);
  const day = object(root.day);
  const topics = array(day.topics).filter(
    (item): item is string => typeof item === "string" && item.length > 0,
  );
  const storedUnits = array(root.units);
  const rawUnits = storedUnits.length
    ? storedUnits
    : [
        {
          id: `${text(day.id, "legacy-day")}-legacy-unit`,
          stableId: `${text(day.stableId, "legacy-day")}-legacy-unit`,
          type: "study",
          title: text(day.title, "Legacy day"),
          description: text(
            day.description,
            "Preserved legacy learning content",
          ),
        },
      ];
  const normalizedUnits = rawUnits.map((rawUnit, index) => {
    const unit = object(rawUnit);
    const typeResult = UnitTypeSchema.safeParse(unit.type);
    const type = typeResult.success ? typeResult.data : "study";
    const id = text(unit.id, `legacy-unit-${index + 1}`);
    const stableId = text(unit.stableId, id);
    const title = text(unit.title, `Legacy unit ${index + 1}`);
    const description = text(unit.description, title);
    const checklist = array(unit.checklist).map((item, itemIndex) => {
      if (typeof item === "string") {
        return {
          id: `${stableId}-check-${itemIndex + 1}`,
          label: item,
          required: true,
        };
      }
      const candidate = object(item);
      return {
        id: text(candidate.id, `${stableId}-check-${itemIndex + 1}`),
        label: text(candidate.label, `Legacy checklist item ${itemIndex + 1}`),
        required: candidate.required !== false,
      };
    });
    let questions = array(unit.questions).flatMap((candidate) => {
      const parsed = UnitQuestionSchema.safeParse(candidate);
      return parsed.success ? [parsed.data] : [];
    });
    if (type === "quiz" && !questions.length) {
      questions = [
        {
          id: `${stableId}-legacy-question`,
          kind: "explain",
          prompt: description,
          options: [],
          correctOptionIds: [],
          referenceAnswer: null,
          evaluationPoints: [],
          commonMistakes: [],
        },
      ];
    }
    const completionCriteria = array(unit.completionCriteria).flatMap(
      (candidate) => {
        const parsed = UnitCompletionCriterionSchema.safeParse(candidate);
        return parsed.success ? [parsed.data] : [];
      },
    );
    const previousUnitId =
      index > 0
        ? text(object(rawUnits[index - 1]).stableId, `legacy-unit-${index}`)
        : null;
    const payloadResult = UnitPayloadSchema.safeParse(unit.payload);
    const payload = payloadResult.success
      ? payloadResult.data
      : fallbackUnitPayload({
          type,
          title,
          description,
          stableId,
          questionIds: questions.map((question) => question.id),
          topics,
          previousUnitId,
        });
    return {
      id,
      stableId,
      type,
      title,
      description,
      order: Math.max(
        1,
        number(unit.order, number(unit.orderIndex, index) + 1),
      ),
      estimatedMinutes: Math.max(0, number(unit.estimatedMinutes, 0)),
      objectives: array(unit.objectives).filter(
        (item): item is string =>
          typeof item === "string" && item.trim().length > 0,
      ),
      checklist,
      sources: array(unit.sources).flatMap((candidate) => {
        const parsed = CurriculumSourceSchema.safeParse(candidate);
        return parsed.success ? [parsed.data] : [];
      }),
      questions,
      misconceptions: array(unit.misconceptions).filter(
        (item): item is string =>
          typeof item === "string" && item.trim().length > 0,
      ),
      referenceAnswer:
        typeof unit.referenceAnswer === "string" ? unit.referenceAnswer : null,
      completionCriteria: completionCriteria.length
        ? completionCriteria
        : [{ type: "acknowledgement" as const }],
      unlockRules:
        previousUnitId === null
          ? []
          : [{ type: "unit-completed" as const, unitId: previousUnitId }],
      optional: unit.optional === true || unit.optional === 1,
      depthLevel:
        unit.depthLevel === "interview-ready" || unit.depthLevel === "deep-dive"
          ? unit.depthLevel
          : "foundation",
      payload,
    };
  });

  return SessionSnapshotSchema.parse({
    schemaVersion: 2,
    contentHash: text(root.contentHash, "legacy-snapshot"),
    curriculumId: text(root.curriculumId, "legacy-curriculum"),
    curriculumVersionId: text(root.curriculumVersionId, "legacy-v1"),
    curriculumRevision: Math.max(1, number(root.curriculumRevision, 1)),
    curriculumTitle: text(root.curriculumTitle, "Legacy curriculum"),
    week: {
      id: text(week.id, "legacy-week"),
      stableId: text(week.stableId, "legacy-week"),
      order: Math.max(1, number(week.order, number(week.orderIndex, 0) + 1)),
      title: text(week.title, "Legacy week"),
      description:
        week.description === null
          ? null
          : text(week.description, "Preserved legacy curriculum week"),
    },
    day: {
      id: text(day.id, "legacy-day"),
      stableId: text(day.stableId, "legacy-day"),
      order: Math.max(1, number(day.order, number(day.orderIndex, 0) + 1)),
      title: text(day.title, "Legacy day"),
      description: text(day.description, text(day.title, "Legacy day")),
      goal: text(day.goal, text(day.description, "Complete the legacy day")),
      estimatedMinutes: Math.max(1, number(day.estimatedMinutes, 1)),
      prerequisites: array(day.prerequisites).filter(
        (item): item is string => typeof item === "string" && item.length > 0,
      ),
      expectedOutcomes: array(day.expectedOutcomes).filter(
        (item): item is string =>
          typeof item === "string" && item.trim().length > 0,
      ),
      depthLevel:
        day.depthLevel === "interview-ready" || day.depthLevel === "deep-dive"
          ? day.depthLevel
          : "foundation",
      outOfScope: array(day.outOfScope).filter(
        (item): item is string =>
          typeof item === "string" && item.trim().length > 0,
      ),
      topics,
    },
    units: normalizedUnits,
    capturedAt: toIsoDateTime(root.capturedAt as number | string | undefined),
  });
}
