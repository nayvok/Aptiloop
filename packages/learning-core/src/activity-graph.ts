export const MAX_ACTIVITY_GRAPH_NODES = 500;
export const MAX_ACTIVITY_PREREQUISITES = 100;
export const MAX_ACTIVITY_GRAPH_EDGES = 5_000;

export interface ActivityGraphNode {
  readonly id: string;
  readonly stableId: string;
  readonly courseId: string;
  readonly revisionId: string;
  readonly lessonId: string;
  readonly type: string;
  readonly required: boolean;
  readonly prerequisiteActivityIds?: readonly string[];
}

export interface ActivityGraphDefinition {
  readonly courseId: string;
  readonly revisionId: string;
  readonly lessonId: string;
  readonly entryActivityIds?: readonly string[];
  readonly activities: readonly ActivityGraphNode[];
}

export type ActivityGraphIssueCode =
  | "activity-limit-exceeded"
  | "entry-limit-exceeded"
  | "edge-limit-exceeded"
  | "missing-activity-id"
  | "duplicate-activity-id"
  | "missing-stable-activity-id"
  | "duplicate-stable-activity-id"
  | "missing-prerequisites"
  | "prerequisite-limit-exceeded"
  | "dangling-prerequisite"
  | "self-prerequisite"
  | "duplicate-prerequisite"
  | "cycle"
  | "missing-entry-activities"
  | "duplicate-entry-activity"
  | "dangling-entry-activity"
  | "entry-has-prerequisites"
  | "entry-node-mismatch"
  | "unreachable-required-activity"
  | "course-ownership-mismatch"
  | "revision-ownership-mismatch"
  | "lesson-ownership-mismatch"
  | "unknown-activity-type";

export interface ActivityGraphIssue {
  readonly code: ActivityGraphIssueCode;
  readonly activityId: string | null;
  readonly relatedActivityId: string | null;
  readonly path: readonly (number | string)[];
  readonly message: string;
}

export type ActivityGraphValidationResult =
  | {
      readonly valid: true;
      readonly issues: readonly [];
      readonly topologicalOrder: readonly string[];
    }
  | {
      readonly valid: false;
      readonly issues: readonly ActivityGraphIssue[];
    };

interface NormalizedNode {
  readonly source: ActivityGraphNode;
  readonly index: number;
  readonly prerequisites: readonly string[];
}

/**
 * Validates a finite lesson graph without consulting storage or ambient state.
 * Callers pass the installed registry explicitly (normally UnitTypeSchema.options)
 * so learning-core does not define a second Activity type registry.
 */
export function validateActivityGraph(
  graph: ActivityGraphDefinition,
  registeredActivityTypes: readonly string[],
): ActivityGraphValidationResult {
  const issues: ActivityGraphIssue[] = [];
  const knownTypes = new Set(
    registeredActivityTypes.filter((type) => type.length > 0).sort(compareIds),
  );
  const sourceActivities: readonly ActivityGraphNode[] = Array.isArray(
    graph.activities,
  )
    ? graph.activities
    : [];

  if (sourceActivities.length > MAX_ACTIVITY_GRAPH_NODES) {
    addIssue(issues, {
      code: "activity-limit-exceeded",
      activityId: null,
      path: ["activities"],
      message: `Activity graph exceeds ${MAX_ACTIVITY_GRAPH_NODES} nodes`,
    });
  }

  const activities = sourceActivities.slice(0, MAX_ACTIVITY_GRAPH_NODES);
  const nodesById = new Map<string, NormalizedNode>();
  const stableActivityIds = new Set<string>();
  let edgeCount = 0;

  activities.forEach((activity, index) => {
    const id = typeof activity.id === "string" ? activity.id : "";
    if (id.length === 0) {
      addIssue(issues, {
        code: "missing-activity-id",
        activityId: null,
        path: ["activities", index, "id"],
        message: "Activity ID is required",
      });
    } else if (nodesById.has(id)) {
      addIssue(issues, {
        code: "duplicate-activity-id",
        activityId: id,
        path: ["activities", index, "id"],
        message: `Duplicate Activity ID: ${id}`,
      });
    }

    const stableId =
      typeof activity.stableId === "string" ? activity.stableId : "";
    if (stableId.length === 0) {
      addIssue(issues, {
        code: "missing-stable-activity-id",
        activityId: id || null,
        path: ["activities", index, "stableId"],
        message: `Activity ${id || "<missing>"} requires a stable ID`,
      });
    } else if (stableActivityIds.has(stableId)) {
      addIssue(issues, {
        code: "duplicate-stable-activity-id",
        activityId: id || null,
        relatedActivityId: stableId,
        path: ["activities", index, "stableId"],
        message: `Duplicate stable Activity ID: ${stableId}`,
      });
    } else {
      stableActivityIds.add(stableId);
    }

    if (activity.courseId !== graph.courseId) {
      addIssue(issues, {
        code: "course-ownership-mismatch",
        activityId: id || null,
        path: ["activities", index, "courseId"],
        message: `Activity ${id || "<missing>"} belongs to another Course`,
      });
    }
    if (activity.revisionId !== graph.revisionId) {
      addIssue(issues, {
        code: "revision-ownership-mismatch",
        activityId: id || null,
        path: ["activities", index, "revisionId"],
        message: `Activity ${id || "<missing>"} belongs to another revision`,
      });
    }
    if (activity.lessonId !== graph.lessonId) {
      addIssue(issues, {
        code: "lesson-ownership-mismatch",
        activityId: id || null,
        path: ["activities", index, "lessonId"],
        message: `Activity ${id || "<missing>"} belongs to another lesson`,
      });
    }
    if (typeof activity.type !== "string" || !knownTypes.has(activity.type)) {
      addIssue(issues, {
        code: "unknown-activity-type",
        activityId: id || null,
        path: ["activities", index, "type"],
        message: `Unknown Activity type: ${String(activity.type)}`,
      });
    }

    let prerequisites: readonly string[];
    if (!Array.isArray(activity.prerequisiteActivityIds)) {
      addIssue(issues, {
        code: "missing-prerequisites",
        activityId: id || null,
        path: ["activities", index, "prerequisiteActivityIds"],
        message: `Activity ${id || "<missing>"} must declare prerequisiteActivityIds`,
      });
      prerequisites = [];
    } else {
      if (
        activity.prerequisiteActivityIds.length > MAX_ACTIVITY_PREREQUISITES
      ) {
        addIssue(issues, {
          code: "prerequisite-limit-exceeded",
          activityId: id || null,
          path: ["activities", index, "prerequisiteActivityIds"],
          message: `Activity ${id || "<missing>"} exceeds ${MAX_ACTIVITY_PREREQUISITES} prerequisites`,
        });
      }
      prerequisites = activity.prerequisiteActivityIds.slice(
        0,
        MAX_ACTIVITY_PREREQUISITES,
      );
    }

    edgeCount += prerequisites.length;
    if (id.length > 0 && !nodesById.has(id)) {
      nodesById.set(id, { source: activity, index, prerequisites });
    }
  });

  if (edgeCount > MAX_ACTIVITY_GRAPH_EDGES) {
    addIssue(issues, {
      code: "edge-limit-exceeded",
      activityId: null,
      path: ["activities"],
      message: `Activity graph exceeds ${MAX_ACTIVITY_GRAPH_EDGES} prerequisite edges`,
    });
  }

  const dependencies = new Map<string, Set<string>>();
  const dependents = new Map<string, Set<string>>();
  for (const id of nodesById.keys()) {
    dependencies.set(id, new Set());
    dependents.set(id, new Set());
  }

  for (const [activityId, node] of nodesById) {
    const seenPrerequisites = new Set<string>();
    node.prerequisites.forEach((prerequisiteId, prerequisiteIndex) => {
      const path = [
        "activities",
        node.index,
        "prerequisiteActivityIds",
        prerequisiteIndex,
      ] as const;
      if (seenPrerequisites.has(prerequisiteId)) {
        addIssue(issues, {
          code: "duplicate-prerequisite",
          activityId,
          relatedActivityId: prerequisiteId,
          path,
          message: `Activity ${activityId} repeats prerequisite ${prerequisiteId}`,
        });
        return;
      }
      seenPrerequisites.add(prerequisiteId);

      if (prerequisiteId === activityId) {
        addIssue(issues, {
          code: "self-prerequisite",
          activityId,
          relatedActivityId: prerequisiteId,
          path,
          message: `Activity ${activityId} cannot depend on itself`,
        });
        return;
      }
      if (!nodesById.has(prerequisiteId)) {
        addIssue(issues, {
          code: "dangling-prerequisite",
          activityId,
          relatedActivityId: prerequisiteId,
          path,
          message: `Activity ${activityId} references missing prerequisite ${prerequisiteId}`,
        });
        return;
      }

      dependencies.get(activityId)?.add(prerequisiteId);
      dependents.get(prerequisiteId)?.add(activityId);
    });
  }

  if (
    Array.isArray(graph.entryActivityIds) &&
    graph.entryActivityIds.length > MAX_ACTIVITY_GRAPH_NODES
  ) {
    addIssue(issues, {
      code: "entry-limit-exceeded",
      activityId: null,
      path: ["entryActivityIds"],
      message: `Activity graph exceeds ${MAX_ACTIVITY_GRAPH_NODES} entry IDs`,
    });
  }

  const entryActivityIds = Array.isArray(graph.entryActivityIds)
    ? graph.entryActivityIds.slice(0, MAX_ACTIVITY_GRAPH_NODES)
    : [];
  if (!Array.isArray(graph.entryActivityIds) || entryActivityIds.length === 0) {
    addIssue(issues, {
      code: "missing-entry-activities",
      activityId: null,
      path: ["entryActivityIds"],
      message: "Activity graph requires at least one declared entry Activity",
    });
  }

  const declaredEntries = new Set<string>();
  const validEntries = new Set<string>();
  entryActivityIds.forEach((entryId, entryIndex) => {
    if (declaredEntries.has(entryId)) {
      addIssue(issues, {
        code: "duplicate-entry-activity",
        activityId: entryId,
        path: ["entryActivityIds", entryIndex],
        message: `Duplicate entry Activity ID: ${entryId}`,
      });
      return;
    }
    declaredEntries.add(entryId);

    const entry = nodesById.get(entryId);
    if (!entry) {
      addIssue(issues, {
        code: "dangling-entry-activity",
        activityId: entryId,
        path: ["entryActivityIds", entryIndex],
        message: `Entry Activity does not exist: ${entryId}`,
      });
      return;
    }
    if (entry.prerequisites.length > 0) {
      addIssue(issues, {
        code: "entry-has-prerequisites",
        activityId: entryId,
        path: ["entryActivityIds", entryIndex],
        message: `Entry Activity ${entryId} declares prerequisites`,
      });
      return;
    }
    validEntries.add(entryId);
  });

  for (const [activityId, node] of nodesById) {
    if (node.prerequisites.length === 0 && !declaredEntries.has(activityId)) {
      addIssue(issues, {
        code: "entry-node-mismatch",
        activityId,
        path: ["entryActivityIds"],
        message: `Zero-prerequisite Activity ${activityId} is not declared as an entry`,
      });
    }
  }

  const topologicalOrder = topologicalSort(nodesById, dependencies, dependents);
  if (topologicalOrder.length !== nodesById.size) {
    const orderedIds = new Set(topologicalOrder);
    const blockedId = [...nodesById.keys()]
      .filter((id) => !orderedIds.has(id))
      .sort(compareIds)[0];
    addIssue(issues, {
      code: "cycle",
      activityId: blockedId ?? null,
      path: ["activities"],
      message: blockedId
        ? `Activity graph contains a cycle involving ${blockedId}`
        : "Activity graph contains a cycle",
    });
  }

  const reachable = reachableActivities(validEntries, dependents);
  for (const [activityId, node] of nodesById) {
    if (node.source.required && !reachable.has(activityId)) {
      addIssue(issues, {
        code: "unreachable-required-activity",
        activityId,
        path: ["activities", node.index],
        message: `Required Activity ${activityId} is unreachable from declared entries`,
      });
    }
  }

  issues.sort(compareIssues);
  if (issues.length > 0) return { valid: false, issues };
  return { valid: true, issues: [], topologicalOrder };
}

function topologicalSort(
  nodesById: ReadonlyMap<string, NormalizedNode>,
  dependencies: ReadonlyMap<string, ReadonlySet<string>>,
  dependents: ReadonlyMap<string, ReadonlySet<string>>,
): string[] {
  const remainingDependencyCount = new Map<string, number>();
  for (const id of nodesById.keys()) {
    remainingDependencyCount.set(id, dependencies.get(id)?.size ?? 0);
  }

  const ready = [...nodesById.keys()]
    .filter((id) => remainingDependencyCount.get(id) === 0)
    .sort(compareIds);
  const order: string[] = [];
  while (ready.length > 0) {
    const current = ready.shift();
    if (current === undefined) break;
    order.push(current);
    const nextIds = [...(dependents.get(current) ?? [])].sort(compareIds);
    for (const nextId of nextIds) {
      const remaining = (remainingDependencyCount.get(nextId) ?? 0) - 1;
      remainingDependencyCount.set(nextId, remaining);
      if (remaining === 0) {
        ready.push(nextId);
        ready.sort(compareIds);
      }
    }
  }
  return order;
}

function reachableActivities(
  entries: ReadonlySet<string>,
  dependents: ReadonlyMap<string, ReadonlySet<string>>,
): Set<string> {
  const reachable = new Set<string>();
  const pending = [...entries].sort(compareIds);
  while (pending.length > 0) {
    const activityId = pending.shift();
    if (activityId === undefined || reachable.has(activityId)) continue;
    reachable.add(activityId);
    const nextIds = [...(dependents.get(activityId) ?? [])].sort(compareIds);
    pending.push(...nextIds);
  }
  return reachable;
}

function addIssue(
  issues: ActivityGraphIssue[],
  issue: Omit<ActivityGraphIssue, "relatedActivityId"> & {
    readonly relatedActivityId?: string | null;
  },
): void {
  issues.push({ relatedActivityId: null, ...issue });
}

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareIssues(
  left: ActivityGraphIssue,
  right: ActivityGraphIssue,
): number {
  return (
    compareIds(left.code, right.code) ||
    compareIds(left.activityId ?? "", right.activityId ?? "") ||
    compareIds(left.relatedActivityId ?? "", right.relatedActivityId ?? "") ||
    compareIds(left.path.join("."), right.path.join(".")) ||
    compareIds(left.message, right.message)
  );
}
