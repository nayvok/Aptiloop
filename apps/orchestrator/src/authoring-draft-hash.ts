import { createHash } from "node:crypto";

import type { CurriculumVersionGraph } from "@dlh/database";

export function authoringDraftHash(graph: CurriculumVersionGraph): string {
  return `sha256:${createHash("sha256")
    .update(
      JSON.stringify({
        version: {
          id: graph.version.id,
          curriculumId: graph.version.curriculumId,
          revision: graph.version.revision,
          parentVersionId: graph.version.parentVersionId,
          title: graph.version.title,
          description: graph.version.description,
        },
        weeks: graph.weeks.map((week) => ({
          stableId: week.stableId,
          orderIndex: week.orderIndex,
          title: week.title,
          description: week.description,
          days: week.days.map((day) => ({
            stableId: day.stableId,
            orderIndex: day.orderIndex,
            title: day.title,
            description: day.description,
            goal: day.goal,
            estimatedMinutes: day.estimatedMinutes,
            prerequisites: day.prerequisites,
            expectedOutcomes: day.expectedOutcomes,
            depthLevel: day.depthLevel,
            outOfScope: day.outOfScope,
            topics: day.topics,
            units: day.units.map((unit) => ({
              stableId: unit.stableId,
              orderIndex: unit.orderIndex,
              type: unit.type,
              title: unit.title,
              description: unit.description,
              estimatedMinutes: unit.estimatedMinutes,
              objectives: unit.objectives,
              checklist: unit.checklist,
              sources: unit.sources,
              questions: unit.questions,
              misconceptions: unit.misconceptions,
              referenceAnswer: unit.referenceAnswer,
              completionCriteria: unit.completionCriteria,
              unlockRules: unit.unlockRules,
              optional: unit.optional,
              depthLevel: unit.depthLevel,
              payload: unit.payload,
            })),
          })),
        })),
      }),
    )
    .digest("hex")}`;
}
