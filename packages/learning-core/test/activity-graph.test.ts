import { UnitTypeSchema } from "@dlh/shared";
import { describe, expect, it } from "vitest";

import {
  validateActivityGraph,
  type ActivityGraphDefinition,
  type ActivityGraphIssueCode,
  type ActivityGraphNode,
} from "../src/activity-graph.js";

const COURSE_ID = "course-1";
const REVISION_ID = "revision-1";
const LESSON_ID = "lesson-1";
const REGISTERED_TYPES = UnitTypeSchema.options;

function activity(
  id: string,
  prerequisiteActivityIds: readonly string[] = [],
  overrides: Partial<ActivityGraphNode> = {},
): ActivityGraphNode {
  return {
    id,
    stableId: id,
    courseId: COURSE_ID,
    revisionId: REVISION_ID,
    lessonId: LESSON_ID,
    type: "study",
    required: true,
    prerequisiteActivityIds,
    ...overrides,
  };
}

function graph(
  activities: readonly ActivityGraphNode[],
  entryActivityIds: readonly string[] | undefined,
): ActivityGraphDefinition {
  return {
    courseId: COURSE_ID,
    revisionId: REVISION_ID,
    lessonId: LESSON_ID,
    activities,
    ...(entryActivityIds === undefined ? {} : { entryActivityIds }),
  };
}

function issueCodes(
  definition: ActivityGraphDefinition,
): ActivityGraphIssueCode[] {
  const result = validateActivityGraph(definition, REGISTERED_TYPES);
  return result.valid ? [] : result.issues.map((issue) => issue.code);
}

describe("Activity graph validation", () => {
  it("accepts a valid multi-entry DAG with deterministic topological order", () => {
    const activities = [
      activity("entry-a"),
      activity("entry-b"),
      activity("branch-a", ["entry-a"]),
      activity("branch-b", ["entry-b"]),
      activity("finish", ["branch-a", "branch-b"]),
    ];
    const expectedOrder = [
      "entry-a",
      "branch-a",
      "entry-b",
      "branch-b",
      "finish",
    ];

    const forward = validateActivityGraph(
      graph(activities, ["entry-b", "entry-a"]),
      REGISTERED_TYPES,
    );
    const reversed = validateActivityGraph(
      graph([...activities].reverse(), ["entry-a", "entry-b"]),
      REGISTERED_TYPES,
    );

    expect(forward).toEqual({
      valid: true,
      issues: [],
      topologicalOrder: expectedOrder,
    });
    expect(reversed).toEqual(forward);
  });

  it("normalizes duplicate supplied registry entries", () => {
    expect(
      validateActivityGraph(graph([activity("entry")], ["entry"]), [
        "study",
        "study",
        "",
      ]),
    ).toEqual({
      valid: true,
      issues: [],
      topologicalOrder: ["entry"],
    });
  });

  it.each([
    {
      name: "duplicate Activity IDs",
      definition: graph([activity("same"), activity("same")], ["same"]),
      code: "duplicate-activity-id",
    },
    {
      name: "duplicate stable Activity IDs",
      definition: graph(
        [
          activity("row-a", [], { stableId: "same-stable" }),
          activity("row-b", [], { stableId: "same-stable" }),
        ],
        ["row-a", "row-b"],
      ),
      code: "duplicate-stable-activity-id",
    },
    {
      name: "a missing prerequisite declaration",
      definition: graph(
        [
          {
            id: "missing-list",
            stableId: "missing-list",
            courseId: COURSE_ID,
            revisionId: REVISION_ID,
            lessonId: LESSON_ID,
            type: "study",
            required: true,
          },
        ],
        ["missing-list"],
      ),
      code: "missing-prerequisites",
    },
    {
      name: "a dangling prerequisite",
      definition: graph(
        [activity("entry"), activity("blocked", ["missing"])],
        ["entry"],
      ),
      code: "dangling-prerequisite",
    },
    {
      name: "a self prerequisite",
      definition: graph([activity("self", ["self"])], ["self"]),
      code: "self-prerequisite",
    },
    {
      name: "a duplicate prerequisite edge",
      definition: graph(
        [activity("entry"), activity("next", ["entry", "entry"])],
        ["entry"],
      ),
      code: "duplicate-prerequisite",
    },
    {
      name: "a prerequisite cycle",
      definition: graph(
        [
          activity("entry"),
          activity("cycle-a", ["cycle-b"]),
          activity("cycle-b", ["cycle-a"]),
        ],
        ["entry"],
      ),
      code: "cycle",
    },
    {
      name: "an entry node with prerequisites",
      definition: graph(
        [activity("entry"), activity("next", ["entry"])],
        ["entry", "next"],
      ),
      code: "entry-has-prerequisites",
    },
    {
      name: "an undeclared zero-prerequisite entry",
      definition: graph(
        [activity("entry-a"), activity("entry-b")],
        ["entry-a"],
      ),
      code: "entry-node-mismatch",
    },
    {
      name: "a dangling entry",
      definition: graph([activity("entry")], ["entry", "missing"]),
      code: "dangling-entry-activity",
    },
    {
      name: "duplicate entry IDs",
      definition: graph([activity("entry")], ["entry", "entry"]),
      code: "duplicate-entry-activity",
    },
    {
      name: "no declared entries",
      definition: graph([activity("entry")], []),
      code: "missing-entry-activities",
    },
    {
      name: "cross-revision ownership",
      definition: graph(
        [activity("entry", [], { revisionId: "revision-other" })],
        ["entry"],
      ),
      code: "revision-ownership-mismatch",
    },
    {
      name: "an unknown Activity type",
      definition: graph(
        [activity("entry", [], { type: "future-activity" })],
        ["entry"],
      ),
      code: "unknown-activity-type",
    },
  ] satisfies readonly {
    readonly name: string;
    readonly definition: ActivityGraphDefinition;
    readonly code: ActivityGraphIssueCode;
  }[])("rejects $name", ({ definition, code }) => {
    expect(issueCodes(definition)).toContain(code);
  });

  it("reports required Activities that cannot be reached from a valid entry", () => {
    const result = validateActivityGraph(
      graph(
        [
          activity("entry"),
          activity("cycle-a", ["cycle-b"]),
          activity("cycle-b", ["cycle-a"]),
        ],
        ["entry"],
      ),
      REGISTERED_TYPES,
    );
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "unreachable-required-activity",
          activityId: "cycle-a",
        }),
        expect.objectContaining({
          code: "unreachable-required-activity",
          activityId: "cycle-b",
        }),
      ]),
    );
  });
});
