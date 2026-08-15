import {
  applyMasteryEvidence,
  createEmptyMasteryProfile,
  MASTERY_DIMENSIONS,
  type EvidenceOutcome,
  type EvidenceType,
  type MasteryDimension,
  type MasteryProfile,
} from "./mastery.js";
import {
  createUnitProgression,
  transitionUnitProgression,
  type UnitDefinition,
  type UnitProgressionItem,
} from "./unit-progression.js";
import type { HintLevel } from "./hints.js";
import { ReviewPrefixProjection } from "./review-prefix.js";

export const LEARNING_KERNEL_FACT_SCHEMA_VERSION = 1 as const;
export const LEARNING_KERNEL_MODEL_VERSION = "baseline-1" as const;
export const LEARNING_KERNEL_SCHEDULER_VERSION = "baseline-1" as const;

const DAY_MILLISECONDS = 86_400_000;
const MASTERY_REVIEW_INTERVAL_MILLISECONDS = 3 * DAY_MILLISECONDS;
/** `baseline-1` schedules the next explicit Review cycle three days later. */
const REVIEW_SUCCESSOR_INTERVAL_MILLISECONDS = 3 * DAY_MILLISECONDS;
const MAX_REVIEW_RESPONSE_LENGTH = 50_000;

export interface LearningKernelScope {
  readonly courseId: string;
  readonly revisionId: string;
  readonly branchId: string;
  readonly sessionId: string;
}

export interface LearningKernelActivity extends UnitDefinition {
  readonly knowledgeNodeIds: readonly string[];
}

export type FactProvenanceKind =
  | "learner_submission"
  | "deterministic_evaluator"
  | "trusted_check"
  | "reviewer"
  | "migration";

export interface LearningKernelFactProvenance {
  readonly kind: FactProvenanceKind;
  readonly sourceId: string;
  readonly sourceHash: string;
  readonly evaluatorVersion?: string;
  readonly checkId?: string;
  readonly checkVersion?: string;
  readonly workspaceHash?: string;
  readonly checkFactId?: string;
}

export type LearningKernelEvidenceOutcome = EvidenceOutcome | "unverified";

export interface LearningKernelEvidenceBody {
  readonly type: "evidence";
  readonly activityId: string;
  readonly knowledgeNodeIds: readonly string[];
  readonly dimension: MasteryDimension;
  readonly evidenceType: EvidenceType;
  readonly outcome: LearningKernelEvidenceOutcome;
  readonly hintLevel: HintLevel;
  readonly basisFactIds: readonly string[];
  readonly errorFamily?: string;
}

export interface LearningKernelProgressBody {
  readonly type: "progress";
  readonly activityId: string;
  readonly transition: "start" | "pause" | "complete" | "skip";
}

export interface LearningKernelCorrectionBody {
  readonly type: "correction";
  readonly supersedesFactId: string;
  readonly replacement: LearningKernelEvidenceBody;
}

export interface LearningKernelReviewDismissBody {
  readonly type: "review";
  readonly activityId: string;
  readonly reviewItemId: string;
  readonly transition: "dismiss";
}

export interface LearningKernelReviewSubmitBody {
  readonly type: "review";
  readonly activityId: string;
  readonly reviewItemId: string;
  readonly transition: "submit";
  readonly response: string;
  readonly activitySnapshotHash: string;
  readonly executionContextHash: string;
}

export interface LearningKernelReviewCompleteBody {
  readonly type: "review";
  readonly activityId: string;
  readonly reviewItemId: string;
  readonly transition: "complete";
  readonly completionEvidenceFactId: string;
}

export type LearningKernelReviewBody =
  | LearningKernelReviewDismissBody
  | LearningKernelReviewSubmitBody
  | LearningKernelReviewCompleteBody;

export type LearningKernelFactBody =
  | LearningKernelEvidenceBody
  | LearningKernelProgressBody
  | LearningKernelCorrectionBody
  | LearningKernelReviewBody;

export interface LearningKernelFact extends LearningKernelScope {
  readonly schemaVersion: typeof LEARNING_KERNEL_FACT_SCHEMA_VERSION;
  readonly id: string;
  readonly operationId: string;
  readonly occurredAt: string;
  readonly provenance: LearningKernelFactProvenance;
  readonly body: LearningKernelFactBody;
}

export interface LearningKernelCommand {
  readonly operationId: string;
  readonly factId: string;
  readonly observedAt: string;
  readonly provenance: LearningKernelFactProvenance;
  readonly body: LearningKernelFactBody;
}

export interface LearningKernelMasteryDimensionProjection {
  readonly state: MasteryProfile[MasteryDimension];
  readonly confidence: number;
  readonly coverage: number;
  readonly sourceFactIds: readonly string[];
}

export type LearningKernelMasteryProjection = Readonly<
  Record<MasteryDimension, LearningKernelMasteryDimensionProjection>
>;

export interface LearningKernelMistake {
  readonly fingerprint: string;
  readonly courseId: string;
  readonly revisionId: string;
  readonly branchId: string;
  readonly knowledgeNodeId: string;
  readonly errorFamily: string;
  readonly occurrenceFactIds: readonly string[];
  readonly latestOccurrenceAt: string;
  readonly status: "open" | "corrected";
  readonly correctedByFactId: string | null;
}

export interface LearningKernelReviewItem {
  readonly id: string;
  readonly sourceFactIds: readonly string[];
  readonly courseId: string;
  readonly revisionId: string;
  readonly branchId: string;
  readonly knowledgeNodeId: string;
  readonly dimension: MasteryDimension;
  readonly activityKind: "recall" | "correction";
  readonly reasonCode: "mistake" | "low_mastery";
  readonly dueAt: string;
  readonly schedulerVersion: typeof LEARNING_KERNEL_SCHEDULER_VERSION;
  readonly state: "pending" | "completed" | "dismissed" | "superseded";
  readonly completionEvidenceId: string | null;
}

export type LearningKernelNextAction =
  | {
      readonly type: "activity";
      readonly activityId: string;
      readonly reasonCode: "resume" | "ready";
    }
  | {
      readonly type: "review";
      readonly reviewItemId: string;
      readonly reasonCode: "due_review";
    }
  | null;

export interface LearningKernelSummaryProjection {
  readonly modelVersion: typeof LEARNING_KERNEL_MODEL_VERSION;
  readonly projectionHash: string;
  readonly sourceFactIds: readonly string[];
  readonly strengthReasonCodes: readonly string[];
  readonly gapReasonCodes: readonly string[];
  readonly mistakeIds: readonly string[];
  readonly reviewItemIds: readonly string[];
}

export interface LearningKernelProjection {
  readonly modelVersion: typeof LEARNING_KERNEL_MODEL_VERSION;
  readonly schedulerVersion: typeof LEARNING_KERNEL_SCHEDULER_VERSION;
  readonly observedAt: string;
  readonly factFrontier: readonly string[];
  readonly progress: readonly UnitProgressionItem[];
  readonly masteryByKnowledgeNode: Readonly<
    Record<string, LearningKernelMasteryProjection>
  >;
  readonly mistakes: readonly LearningKernelMistake[];
  readonly reviewItems: readonly LearningKernelReviewItem[];
  readonly nextAction: LearningKernelNextAction;
  readonly projectionHash: string;
  readonly summary: LearningKernelSummaryProjection;
}

export interface LearningKernelProjectionInput {
  readonly scope: LearningKernelScope;
  readonly activities: readonly LearningKernelActivity[];
  readonly facts: readonly LearningKernelFact[];
  readonly observedAt: string;
}

export interface LearningKernelReductionInput extends Omit<
  LearningKernelProjectionInput,
  "observedAt"
> {
  readonly command: LearningKernelCommand;
}

export interface LearningKernelReductionResult {
  readonly accepted: boolean;
  readonly idempotent: boolean;
  readonly acceptedFact: LearningKernelFact | null;
  readonly facts: readonly LearningKernelFact[];
  readonly projection: LearningKernelProjection;
}

export class LearningKernelValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LearningKernelValidationError";
  }
}

export class LearningKernelConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LearningKernelConflictError";
  }
}

export function reduceLearningKernel(
  input: LearningKernelReductionInput,
): LearningKernelReductionResult {
  assertScope(input.scope);
  const observedAt = parseIsoInstant(input.command.observedAt);
  const candidate: LearningKernelFact = {
    schemaVersion: LEARNING_KERNEL_FACT_SCHEMA_VERSION,
    ...input.scope,
    id: assertIdentifier(input.command.factId, "command.factId"),
    operationId: assertIdentifier(
      input.command.operationId,
      "command.operationId",
    ),
    occurredAt: observedAt,
    provenance: input.command.provenance,
    body: input.command.body,
  };
  const existingOperation = input.facts.find(
    (fact) => fact.operationId === candidate.operationId,
  );
  if (existingOperation) {
    if (canonicalJson(existingOperation) !== canonicalJson(candidate)) {
      throw new LearningKernelConflictError(
        "Learning Kernel operation ID is already bound to different input",
      );
    }
    const facts = sortFacts(input.facts);
    return {
      accepted: false,
      idempotent: true,
      acceptedFact: existingOperation,
      facts,
      projection: projectLearningKernel({
        scope: input.scope,
        activities: input.activities,
        facts,
        observedAt,
      }),
    };
  }
  if (input.facts.some((fact) => fact.id === candidate.id)) {
    throw new LearningKernelConflictError(
      "Learning Kernel fact ID is already bound to a different operation",
    );
  }
  validateNewCommandLinks(candidate, input.facts);
  const facts = sortFacts([...input.facts, candidate]);
  const projection = projectLearningKernel({
    scope: input.scope,
    activities: input.activities,
    facts,
    observedAt,
  });
  return {
    accepted: true,
    idempotent: false,
    acceptedFact: candidate,
    facts,
    projection,
  };
}

export function projectLearningKernel(
  input: LearningKernelProjectionInput,
): LearningKernelProjection {
  assertScope(input.scope);
  const observedAt = parseIsoInstant(input.observedAt);
  const observedTimestamp = Date.parse(observedAt);
  const activities = validateActivities(input.activities);
  const facts = sortFacts(input.facts);
  const factById = validateFacts(
    facts,
    input.scope,
    activities,
    observedTimestamp,
  );
  const effectiveEvidence = effectiveEvidenceFacts(facts, factById);
  const progress = projectProgress(activities, facts);
  const masteryByKnowledgeNode = projectMastery(
    effectiveEvidence,
    observedTimestamp,
  );
  const mistakes = projectMistakes(input.scope, effectiveEvidence);
  const reviewItems = projectReviewItems(
    input.scope,
    masteryByKnowledgeNode,
    effectiveEvidence,
    mistakes,
    facts,
    factById,
  );
  const nextAction = selectNextAction(
    progress,
    activities,
    reviewItems,
    observedTimestamp,
  );
  const factFrontier = facts.map((fact) => fact.id);
  const hashInput = {
    modelVersion: LEARNING_KERNEL_MODEL_VERSION,
    schedulerVersion: LEARNING_KERNEL_SCHEDULER_VERSION,
    scope: input.scope,
    observedAt,
    factFrontier,
    progress,
    masteryByKnowledgeNode,
    mistakes,
    reviewItems,
    nextAction,
  };
  const projectionHash = sha256Canonical(hashInput);
  const summary = projectSummary(
    projectionHash,
    factFrontier,
    masteryByKnowledgeNode,
    mistakes,
    reviewItems,
  );
  return {
    modelVersion: LEARNING_KERNEL_MODEL_VERSION,
    schedulerVersion: LEARNING_KERNEL_SCHEDULER_VERSION,
    observedAt,
    factFrontier,
    progress,
    masteryByKnowledgeNode,
    mistakes,
    reviewItems,
    nextAction,
    projectionHash,
    summary,
  };
}

function validateActivities(
  activities: readonly LearningKernelActivity[],
): LearningKernelActivity[] {
  createUnitProgression(activities);
  const seenKnowledgeNodes = new Set<string>();
  return activities.map((activity) => {
    assertExactKeys(
      activity,
      ["id", "optional", "prerequisiteUnitIds", "knowledgeNodeIds"],
      `activity ${activity.id}`,
    );
    const knowledgeNodeIds = uniqueSortedIdentifiers(
      activity.knowledgeNodeIds,
      `activity ${activity.id} knowledge node`,
    );
    for (const knowledgeNodeId of knowledgeNodeIds) {
      seenKnowledgeNodes.add(knowledgeNodeId);
    }
    return {
      id: activity.id,
      optional: activity.optional,
      ...(activity.prerequisiteUnitIds === undefined
        ? {}
        : { prerequisiteUnitIds: [...activity.prerequisiteUnitIds] }),
      knowledgeNodeIds,
    };
  });
}

function validateFacts(
  facts: readonly LearningKernelFact[],
  scope: LearningKernelScope,
  activities: readonly LearningKernelActivity[],
  observedTimestamp: number,
): ReadonlyMap<string, LearningKernelFact> {
  const factById = new Map<string, LearningKernelFact>();
  const operationIds = new Set<string>();
  const activityById = new Map(
    activities.map((activity) => [activity.id, activity] as const),
  );
  for (const fact of facts) {
    assertExactKeys(
      fact,
      [
        "schemaVersion",
        "courseId",
        "revisionId",
        "branchId",
        "sessionId",
        "id",
        "operationId",
        "occurredAt",
        "provenance",
        "body",
      ],
      `fact ${String(fact.id)}`,
    );
    if (fact.schemaVersion !== LEARNING_KERNEL_FACT_SCHEMA_VERSION) {
      throw new LearningKernelValidationError(
        `Unsupported Learning Kernel fact schema: ${String(fact.schemaVersion)}`,
      );
    }
    assertFactScope(fact, scope);
    assertIdentifier(fact.id, "fact.id");
    assertIdentifier(fact.operationId, "fact.operationId");
    const occurredAt = Date.parse(parseIsoInstant(fact.occurredAt));
    if (occurredAt > observedTimestamp) {
      throw new LearningKernelValidationError(
        `Fact ${fact.id} occurs after the observed clock`,
      );
    }
    if (factById.has(fact.id)) {
      throw new LearningKernelConflictError(`Duplicate fact ID: ${fact.id}`);
    }
    if (operationIds.has(fact.operationId)) {
      throw new LearningKernelConflictError(
        `Duplicate fact operation ID: ${fact.operationId}`,
      );
    }
    assertProvenance(fact.provenance);
    validateFactBody(fact, activityById, factById);
    factById.set(fact.id, fact);
    operationIds.add(fact.operationId);
  }
  validateFactLinks(facts, factById);
  return factById;
}

function validateFactBody(
  fact: LearningKernelFact,
  activityById: ReadonlyMap<string, LearningKernelActivity>,
  priorFactById: ReadonlyMap<string, LearningKernelFact>,
): void {
  const body = fact.body;
  switch (body.type) {
    case "evidence":
      validateEvidenceBody(body, fact.provenance, activityById, priorFactById);
      return;
    case "progress": {
      assertExactKeys(
        body,
        ["type", "activityId", "transition"],
        "progress body",
      );
      const activity = activityById.get(
        assertIdentifier(body.activityId, "progress.activityId"),
      );
      if (!activity) {
        throw new LearningKernelValidationError(
          `Unknown progress activity: ${body.activityId}`,
        );
      }
      if (!["start", "pause", "complete", "skip"].includes(body.transition)) {
        throw new LearningKernelValidationError(
          `Unknown progress transition: ${String(body.transition)}`,
        );
      }
      if (
        (body.transition === "complete" || body.transition === "skip") &&
        fact.provenance.kind !== "deterministic_evaluator" &&
        fact.provenance.kind !== "migration"
      ) {
        throw new LearningKernelValidationError(
          "Only a deterministic evaluator may emit terminal progress",
        );
      }
      return;
    }
    case "correction":
      assertExactKeys(
        body,
        ["type", "supersedesFactId", "replacement"],
        "correction body",
      );
      assertIdentifier(body.supersedesFactId, "correction.supersedesFactId");
      if (
        fact.provenance.kind !== "deterministic_evaluator" &&
        fact.provenance.kind !== "migration"
      ) {
        throw new LearningKernelValidationError(
          "Only a deterministic evaluator or migration may correct a fact",
        );
      }
      validateEvidenceBody(
        body.replacement,
        fact.provenance,
        activityById,
        priorFactById,
      );
      return;
    case "review":
      if (
        !activityById.has(
          assertIdentifier(body.activityId, "review.activityId"),
        )
      ) {
        throw new LearningKernelValidationError(
          `Unknown review activity: ${body.activityId}`,
        );
      }
      assertIdentifier(body.reviewItemId, "review.reviewItemId");
      switch (body.transition) {
        case "dismiss":
          assertExactKeys(
            body,
            ["type", "activityId", "reviewItemId", "transition"],
            "review dismiss body",
          );
          if (fact.provenance.kind !== "learner_submission") {
            throw new LearningKernelValidationError(
              "Only a learner submission may dismiss a review item",
            );
          }
          return;
        case "submit":
          assertExactKeys(
            body,
            [
              "type",
              "activityId",
              "reviewItemId",
              "transition",
              "response",
              "activitySnapshotHash",
              "executionContextHash",
            ],
            "review submit body",
          );
          if (fact.provenance.kind !== "learner_submission") {
            throw new LearningKernelValidationError(
              "Only a learner submission may submit a review response",
            );
          }
          if (
            typeof body.response !== "string" ||
            body.response.trim() === "" ||
            body.response.length > MAX_REVIEW_RESPONSE_LENGTH
          ) {
            throw new LearningKernelValidationError(
              `review.response must be a non-blank string of at most ${MAX_REVIEW_RESPONSE_LENGTH} characters`,
            );
          }
          assertHash(body.activitySnapshotHash, "review.activitySnapshotHash");
          assertHash(body.executionContextHash, "review.executionContextHash");
          return;
        case "complete": {
          assertExactKeys(
            body,
            [
              "type",
              "activityId",
              "reviewItemId",
              "transition",
              "completionEvidenceFactId",
            ],
            "review complete body",
          );
          if (fact.provenance.kind !== "deterministic_evaluator") {
            throw new LearningKernelValidationError(
              "Only a deterministic evaluator may complete a review item",
            );
          }
          assertIdentifier(
            body.completionEvidenceFactId,
            "review.completionEvidenceFactId",
          );
          const submission = priorFactById.get(body.completionEvidenceFactId);
          if (
            !submission ||
            submission.body.type !== "review" ||
            submission.body.transition !== "submit" ||
            submission.provenance.kind !== "learner_submission"
          ) {
            throw new LearningKernelValidationError(
              "Review completion must cite an earlier learner Review submission",
            );
          }
          if (
            submission.body.reviewItemId !== body.reviewItemId ||
            submission.body.activityId !== body.activityId
          ) {
            throw new LearningKernelValidationError(
              "Review completion submission must match the exact Review item and activity",
            );
          }
          return;
        }
        default:
          throw new LearningKernelValidationError("Unknown review transition");
      }
    default:
      throw new LearningKernelValidationError(
        `Unknown Learning Kernel fact type: ${String((body as { type?: unknown }).type)}`,
      );
  }
}

function validateEvidenceBody(
  body: LearningKernelEvidenceBody,
  provenance: LearningKernelFactProvenance,
  activityById: ReadonlyMap<string, LearningKernelActivity>,
  priorFactById: ReadonlyMap<string, LearningKernelFact>,
): void {
  assertExactKeys(
    body,
    [
      "type",
      "activityId",
      "knowledgeNodeIds",
      "dimension",
      "evidenceType",
      "outcome",
      "hintLevel",
      "basisFactIds",
      "errorFamily",
    ],
    "evidence body",
  );
  const activity = activityById.get(
    assertIdentifier(body.activityId, "evidence.activityId"),
  );
  if (!activity) {
    throw new LearningKernelValidationError(
      `Unknown evidence activity: ${body.activityId}`,
    );
  }
  const knowledgeNodeIds = uniqueSortedIdentifiers(
    body.knowledgeNodeIds,
    "evidence knowledge node",
  );
  if (
    knowledgeNodeIds.length === 0 ||
    knowledgeNodeIds.some((id) => !activity.knowledgeNodeIds.includes(id))
  ) {
    throw new LearningKernelValidationError(
      "Evidence knowledge nodes must be a non-empty subset of the activity scope",
    );
  }
  if (!MASTERY_DIMENSIONS.includes(body.dimension)) {
    throw new LearningKernelValidationError(
      `Unknown mastery dimension: ${String(body.dimension)}`,
    );
  }
  if (
    ![
      "recall",
      "explanation",
      "code_reading",
      "implementation",
      "debugging",
      "interview",
    ].includes(body.evidenceType)
  ) {
    throw new LearningKernelValidationError(
      `Unknown evidence type: ${String(body.evidenceType)}`,
    );
  }
  if (
    !["unverified", "incorrect", "partial", "correct"].includes(body.outcome)
  ) {
    throw new LearningKernelValidationError(
      `Unknown evidence outcome: ${String(body.outcome)}`,
    );
  }
  if (
    !Number.isInteger(body.hintLevel) ||
    body.hintLevel < 0 ||
    body.hintLevel > 5
  ) {
    throw new LearningKernelValidationError(
      "Evidence hint level must be 0 through 5",
    );
  }
  const basisFactIds = uniqueSortedIdentifiers(
    body.basisFactIds,
    "evidence basis fact",
  );
  if (body.errorFamily !== undefined) {
    assertIdentifier(body.errorFamily, "evidence.errorFamily");
  }
  if (body.outcome !== "unverified" && basisFactIds.length === 0) {
    throw new LearningKernelValidationError(
      "Verified evidence requires at least one persisted basis fact",
    );
  }
  for (const basisFactId of basisFactIds) {
    if (!priorFactById.has(basisFactId)) {
      throw new LearningKernelValidationError(
        `Evidence basis fact is unavailable or not earlier: ${basisFactId}`,
      );
    }
  }
  assertEvidenceAuthority(body, provenance, priorFactById);
}

function assertEvidenceAuthority(
  body: LearningKernelEvidenceBody,
  provenance: LearningKernelFactProvenance,
  priorFactById: ReadonlyMap<string, LearningKernelFact>,
): void {
  switch (provenance.kind) {
    case "learner_submission":
      if (body.outcome !== "unverified") {
        throw new LearningKernelValidationError(
          "Learner submissions cannot assert correctness",
        );
      }
      return;
    case "deterministic_evaluator":
      if (body.outcome === "unverified") {
        throw new LearningKernelValidationError(
          "Deterministic evaluator evidence must have an evaluated outcome",
        );
      }
      return;
    case "trusted_check":
      if (
        body.outcome === "unverified" ||
        body.outcome === "partial" ||
        (body.evidenceType !== "implementation" &&
          body.evidenceType !== "debugging")
      ) {
        throw new LearningKernelValidationError(
          "Trusted checks emit correct or incorrect implementation/debugging evidence",
        );
      }
      return;
    case "reviewer": {
      if (body.outcome === "correct" || body.outcome === "unverified") {
        throw new LearningKernelValidationError(
          "A reviewer cannot independently emit correct mastery evidence",
        );
      }
      const checkFact = provenance.checkFactId
        ? priorFactById.get(provenance.checkFactId)
        : undefined;
      if (
        !checkFact ||
        checkFact.provenance.kind !== "trusted_check" ||
        checkFact.provenance.workspaceHash !== provenance.workspaceHash
      ) {
        throw new LearningKernelValidationError(
          "Reviewer evidence must bind to an earlier trusted check with the same workspace hash",
        );
      }
      return;
    }
    case "migration":
      if (body.outcome === "correct") {
        throw new LearningKernelValidationError(
          "Migrated evidence cannot be silently upgraded to correct",
        );
      }
  }
}

function validateFactLinks(
  facts: readonly LearningKernelFact[],
  factById: ReadonlyMap<string, LearningKernelFact>,
): void {
  const superseded = new Set<string>();
  for (const fact of facts) {
    if (fact.body.type !== "correction") continue;
    const target = factById.get(fact.body.supersedesFactId);
    if (!target || target.body.type !== "evidence") {
      throw new LearningKernelValidationError(
        `Correction target is not an evidence fact: ${fact.body.supersedesFactId}`,
      );
    }
    if (superseded.has(target.id)) {
      throw new LearningKernelConflictError(
        `Evidence fact already has a correction: ${target.id}`,
      );
    }
    if (Date.parse(target.occurredAt) > Date.parse(fact.occurredAt)) {
      throw new LearningKernelValidationError(
        `Correction precedes its target: ${target.id}`,
      );
    }
    superseded.add(target.id);
  }
}

function validateNewCommandLinks(
  candidate: LearningKernelFact,
  existingFacts: readonly LearningKernelFact[],
): void {
  const existingById = new Map(existingFacts.map((fact) => [fact.id, fact]));
  const body = candidate.body;
  if (body.type === "evidence") {
    assertNewEvidenceBasisPrecedes(body, candidate, existingById);
    return;
  }
  if (body.type !== "correction") return;

  assertNewEvidenceBasisPrecedes(body.replacement, candidate, existingById);
  const target = existingById.get(body.supersedesFactId);
  if (!target || target.body.type !== "evidence") {
    throw new LearningKernelValidationError(
      `Correction target is not an evidence fact: ${body.supersedesFactId}`,
    );
  }
  if (
    existingFacts.some(
      (fact) =>
        fact.body.type === "correction" &&
        fact.body.supersedesFactId === target.id,
    )
  ) {
    throw new LearningKernelConflictError(
      `Evidence fact already has a correction: ${target.id}`,
    );
  }
  if (compareFactsByCanonicalOrder(target, candidate) >= 0) {
    throw new LearningKernelValidationError(
      `Correction precedes its target: ${target.id}`,
    );
  }
  assertCorrectionPreservesEvidenceIdentity(target.body, body.replacement);
}

function assertNewEvidenceBasisPrecedes(
  body: LearningKernelEvidenceBody,
  candidate: LearningKernelFact,
  existingById: ReadonlyMap<string, LearningKernelFact>,
): void {
  if (!Array.isArray(body.basisFactIds)) return;
  for (const basisFactId of body.basisFactIds) {
    const basisFact = existingById.get(basisFactId);
    if (!basisFact || compareFactsByCanonicalOrder(basisFact, candidate) >= 0) {
      throw new LearningKernelValidationError(
        `Evidence basis fact is unavailable or not earlier: ${basisFactId}`,
      );
    }
  }
}

function assertCorrectionPreservesEvidenceIdentity(
  target: LearningKernelEvidenceBody,
  replacement: LearningKernelEvidenceBody,
): void {
  if (
    target.activityId !== replacement.activityId ||
    target.dimension !== replacement.dimension ||
    target.evidenceType !== replacement.evidenceType ||
    target.errorFamily !== replacement.errorFamily ||
    !haveSameIdentifiers(target.knowledgeNodeIds, replacement.knowledgeNodeIds)
  ) {
    throw new LearningKernelValidationError(
      "Correction replacement must preserve evidence identity",
    );
  }
}

function haveSameIdentifiers(
  left: readonly string[],
  right: readonly string[],
): boolean {
  if (left.length !== right.length) return false;
  const rightIds = new Set(right);
  return left.every((id) => rightIds.has(id));
}

function assertProvenance(provenance: LearningKernelFactProvenance): void {
  assertExactKeys(
    provenance,
    [
      "kind",
      "sourceId",
      "sourceHash",
      "evaluatorVersion",
      "checkId",
      "checkVersion",
      "workspaceHash",
      "checkFactId",
    ],
    "fact provenance",
  );
  if (
    ![
      "learner_submission",
      "deterministic_evaluator",
      "trusted_check",
      "reviewer",
      "migration",
    ].includes(provenance.kind)
  ) {
    throw new LearningKernelValidationError(
      `Unknown fact provenance: ${String(provenance.kind)}`,
    );
  }
  assertIdentifier(provenance.sourceId, "provenance.sourceId");
  assertHash(provenance.sourceHash, "provenance.sourceHash");
  if (
    (provenance.kind === "deterministic_evaluator" ||
      provenance.kind === "migration") &&
    !provenance.evaluatorVersion
  ) {
    throw new LearningKernelValidationError(
      "Evaluator and migration provenance require a version",
    );
  }
  if (provenance.kind === "trusted_check") {
    assertIdentifier(provenance.checkId, "provenance.checkId");
    assertIdentifier(provenance.checkVersion, "provenance.checkVersion");
    assertHash(provenance.workspaceHash, "provenance.workspaceHash");
  }
  if (provenance.kind === "reviewer") {
    assertIdentifier(provenance.checkFactId, "provenance.checkFactId");
    assertHash(provenance.workspaceHash, "provenance.workspaceHash");
  }
}

interface EffectiveEvidenceFact {
  readonly fact: LearningKernelFact;
  readonly body: LearningKernelEvidenceBody;
}

function effectiveEvidenceFacts(
  facts: readonly LearningKernelFact[],
  factById: ReadonlyMap<string, LearningKernelFact>,
): EffectiveEvidenceFact[] {
  const superseded = new Set(
    facts.flatMap((fact) =>
      fact.body.type === "correction" ? [fact.body.supersedesFactId] : [],
    ),
  );
  return facts.flatMap((fact): EffectiveEvidenceFact[] => {
    if (fact.body.type === "evidence" && !superseded.has(fact.id)) {
      return [{ fact, body: fact.body }];
    }
    if (fact.body.type === "correction") {
      if (!factById.has(fact.body.supersedesFactId)) return [];
      return [{ fact, body: fact.body.replacement }];
    }
    return [];
  });
}

function projectProgress(
  activities: readonly LearningKernelActivity[],
  facts: readonly LearningKernelFact[],
): readonly UnitProgressionItem[] {
  let progress = createUnitProgression(activities);
  for (const fact of facts) {
    if (fact.body.type !== "progress") continue;
    const result = transitionUnitProgression(activities, progress, {
      type: fact.body.transition,
      unitId: fact.body.activityId,
    });
    if (!result.valid) {
      throw new LearningKernelValidationError(
        `Invalid progress fact ${fact.id}: ${result.reason}`,
      );
    }
    progress = [...result.progress];
  }
  return progress;
}

function projectMastery(
  evidence: readonly EffectiveEvidenceFact[],
  observedTimestamp: number,
): Readonly<Record<string, LearningKernelMasteryProjection>> {
  const evidenceByNodeAndDimension = indexMasteryEvidence(evidence);
  const nodeIds = [...evidenceByNodeAndDimension.keys()].sort(compareStrings);
  return Object.fromEntries(
    nodeIds.map((knowledgeNodeId) => {
      const evidenceByDimension =
        evidenceByNodeAndDimension.get(knowledgeNodeId);
      if (!evidenceByDimension) {
        throw new LearningKernelValidationError(
          "Mastery projection lost its knowledge-node evidence index",
        );
      }
      const byDimension = Object.fromEntries(
        MASTERY_DIMENSIONS.map((dimension) => {
          const source = evidenceByDimension.get(dimension) ?? [];
          let profile = createEmptyMasteryProfile();
          for (const item of source) {
            profile = applyMasteryEvidence(profile, {
              id: `${item.fact.id}:${knowledgeNodeId}`,
              dimension,
              type: item.body.evidenceType,
              outcome: item.body.outcome as EvidenceOutcome,
              occurredAt: item.fact.occurredAt,
              hintLevel: item.body.hintLevel,
              ...(item.body.errorFamily === undefined
                ? {}
                : { errorKey: item.body.errorFamily }),
            }).profile;
          }
          const state = profile[dimension];
          return [
            dimension,
            {
              state,
              confidence: masteryConfidence(state, observedTimestamp),
              coverage: masteryCoverage(state),
              sourceFactIds: source.map((item) => item.fact.id),
            } satisfies LearningKernelMasteryDimensionProjection,
          ];
        }),
      ) as unknown as LearningKernelMasteryProjection;
      return [knowledgeNodeId, byDimension] as const;
    }),
  );
}

function indexMasteryEvidence(
  evidence: readonly EffectiveEvidenceFact[],
): Map<string, Map<MasteryDimension, EffectiveEvidenceFact[]>> {
  const evidenceByNodeAndDimension = new Map<
    string,
    Map<MasteryDimension, EffectiveEvidenceFact[]>
  >();
  for (const item of evidence) {
    for (const knowledgeNodeId of item.body.knowledgeNodeIds) {
      let evidenceByDimension = evidenceByNodeAndDimension.get(knowledgeNodeId);
      if (!evidenceByDimension) {
        evidenceByDimension = new Map();
        evidenceByNodeAndDimension.set(knowledgeNodeId, evidenceByDimension);
      }
      if (item.body.outcome === "unverified") continue;
      const source = evidenceByDimension.get(item.body.dimension);
      if (source) {
        source.push(item);
      } else {
        evidenceByDimension.set(item.body.dimension, [item]);
      }
    }
  }
  return evidenceByNodeAndDimension;
}

function projectMistakes(
  scope: LearningKernelScope,
  evidence: readonly EffectiveEvidenceFact[],
): LearningKernelMistake[] {
  const groups = new Map<
    string,
    {
      knowledgeNodeId: string;
      errorFamily: string;
      occurrences: EffectiveEvidenceFact[];
      corrections: EffectiveEvidenceFact[];
    }
  >();
  for (const item of evidence) {
    if (!item.body.errorFamily || item.body.outcome === "unverified") continue;
    for (const knowledgeNodeId of item.body.knowledgeNodeIds) {
      const key = `${knowledgeNodeId}\u0000${item.body.errorFamily}`;
      const group = groups.get(key) ?? {
        knowledgeNodeId,
        errorFamily: item.body.errorFamily,
        occurrences: [],
        corrections: [],
      };
      if (item.body.outcome === "correct") group.corrections.push(item);
      else group.occurrences.push(item);
      groups.set(key, group);
    }
  }
  return [...groups.values()]
    .filter((group) => group.occurrences.length > 0)
    .map((group) => {
      const latest = group.occurrences.at(-1)!;
      const correction = group.corrections.find(
        (item) =>
          Date.parse(item.fact.occurredAt) >=
          Date.parse(latest.fact.occurredAt),
      );
      return {
        fingerprint: mistakeFingerprint(
          scope,
          group.knowledgeNodeId,
          group.errorFamily,
        ),
        courseId: scope.courseId,
        revisionId: scope.revisionId,
        branchId: scope.branchId,
        knowledgeNodeId: group.knowledgeNodeId,
        errorFamily: group.errorFamily,
        occurrenceFactIds: group.occurrences.map((item) => item.fact.id),
        latestOccurrenceAt: latest.fact.occurredAt,
        status: correction ? "corrected" : "open",
        correctedByFactId: correction?.fact.id ?? null,
      } satisfies LearningKernelMistake;
    })
    .sort((left, right) => compareStrings(left.fingerprint, right.fingerprint));
}

function projectReviewItems(
  scope: LearningKernelScope,
  masteryByKnowledgeNode: Readonly<
    Record<string, LearningKernelMasteryProjection>
  >,
  evidence: readonly EffectiveEvidenceFact[],
  mistakes: readonly LearningKernelMistake[],
  facts: readonly LearningKernelFact[],
  factById: ReadonlyMap<string, LearningKernelFact>,
): LearningKernelReviewItem[] {
  const hasExecutableReviewFacts = facts.some(
    (fact) =>
      fact.body.type === "review" &&
      (fact.body.transition === "submit" ||
        fact.body.transition === "complete"),
  );
  if (!hasExecutableReviewFacts) {
    return projectLegacyReviewItems(
      scope,
      masteryByKnowledgeNode,
      evidence,
      mistakes,
      facts,
      factById,
    );
  }

  const nonReviewFacts = facts.filter((fact) => fact.body.type !== "review");
  const baseItems = projectLegacyReviewItems(
    scope,
    masteryByKnowledgeNode,
    evidence,
    mistakes,
    nonReviewFacts,
    factById,
  );
  const byId = new Map(baseItems.map((item) => [item.id, item] as const));
  const baseItemIds = new Set(byId.keys());
  const seriesByItemId = new Map(
    baseItems.map((item) => [item.id, item.id] as const),
  );
  const touchedSeries = new Set<string>();
  const reviewPrefix = new ReviewPrefixProjection({
    masteryReviewIntervalMilliseconds: MASTERY_REVIEW_INTERVAL_MILLISECONDS,
    mistakeReviewItemId: (knowledgeNodeId, errorFamily) =>
      `review-${mistakeFingerprint(scope, knowledgeNodeId, errorFamily).slice("sha256:".length)}`,
  });

  for (const fact of facts) {
    reviewPrefix.accept(fact);
    if (fact.body.type !== "review") continue;
    const current = byId.get(fact.body.reviewItemId);
    if (!current) {
      throw new LearningKernelValidationError(
        `Unknown review item: ${fact.body.reviewItemId}`,
      );
    }
    const seriesId = seriesByItemId.get(current.id) ?? current.id;
    let item = current;
    if (baseItemIds.has(current.id) && !touchedSeries.has(seriesId)) {
      const snapshot = reviewPrefix.project(current);
      if (!snapshot) {
        throw new LearningKernelValidationError(
          `Review item was unavailable at fact ${fact.id}`,
        );
      }
      item = snapshot;
      byId.set(item.id, item);
    }

    switch (fact.body.transition) {
      case "dismiss":
        if (item.state === "pending") {
          byId.set(item.id, { ...item, state: "dismissed" });
        }
        touchedSeries.add(seriesId);
        break;
      case "submit":
        assertReviewActivityMatches(item, fact.body.activityId, factById);
        assertExecutableReviewCycle(item, fact.occurredAt, "submit");
        touchedSeries.add(seriesId);
        break;
      case "complete": {
        assertReviewActivityMatches(item, fact.body.activityId, factById);
        assertExecutableReviewCycle(item, fact.occurredAt, "complete");
        const submission = factById.get(fact.body.completionEvidenceFactId);
        if (
          !submission ||
          submission.body.type !== "review" ||
          submission.body.transition !== "submit" ||
          submission.body.reviewItemId !== item.id
        ) {
          throw new LearningKernelValidationError(
            "Review completion evidence belongs to another Review cycle",
          );
        }
        const sourceFactIds = uniqueSorted([
          ...item.sourceFactIds,
          submission.id,
          fact.id,
        ]);
        byId.set(item.id, {
          ...item,
          sourceFactIds,
          state: "completed",
          completionEvidenceId: submission.id,
        });
        const successorId = reviewSuccessorId(scope, item.id, fact.id);
        if (byId.has(successorId)) {
          throw new LearningKernelConflictError(
            `Duplicate Review successor ID: ${successorId}`,
          );
        }
        const successor: LearningKernelReviewItem = {
          ...item,
          id: successorId,
          sourceFactIds,
          dueAt: addMilliseconds(
            fact.occurredAt,
            REVIEW_SUCCESSOR_INTERVAL_MILLISECONDS,
          ),
          state: "pending",
          completionEvidenceId: null,
        };
        byId.set(successor.id, successor);
        seriesByItemId.set(successor.id, seriesId);
        touchedSeries.add(seriesId);
        break;
      }
    }
  }

  // Accepted non-Review evidence remains an independent completion route. If
  // it resolved the legacy series after an explicit Review action, apply it to
  // the newest surviving cycle without fabricating another interval.
  for (const finalItem of baseItems) {
    const seriesId = seriesByItemId.get(finalItem.id) ?? finalItem.id;
    if (finalItem.state !== "completed" || !touchedSeries.has(seriesId)) {
      continue;
    }
    const latest = latestReviewSeriesItem(byId, seriesByItemId, seriesId);
    if (!latest || latest.state === "completed") continue;
    byId.set(latest.id, {
      ...latest,
      state: "completed",
      completionEvidenceId: finalItem.completionEvidenceId,
    });
  }

  return [...byId.values()].sort(compareReviewItems);
}

/** Preserves the exact `baseline-1` projection for all pre-executor facts. */
function projectLegacyReviewItems(
  scope: LearningKernelScope,
  masteryByKnowledgeNode: Readonly<
    Record<string, LearningKernelMasteryProjection>
  >,
  evidence: readonly EffectiveEvidenceFact[],
  mistakes: readonly LearningKernelMistake[],
  facts: readonly LearningKernelFact[],
  factById: ReadonlyMap<string, LearningKernelFact>,
): LearningKernelReviewItem[] {
  const items: LearningKernelReviewItem[] = mistakes.map((mistake) => {
    const occurrenceCount = mistake.occurrenceFactIds.length;
    const delayDays = Math.max(1, 4 - Math.min(occurrenceCount, 3));
    return {
      id: `review-${mistake.fingerprint.slice("sha256:".length)}`,
      sourceFactIds: mistake.occurrenceFactIds,
      courseId: scope.courseId,
      revisionId: scope.revisionId,
      branchId: scope.branchId,
      knowledgeNodeId: mistake.knowledgeNodeId,
      dimension: dimensionForErrorFamily(mistake.errorFamily, evidence),
      activityKind: "correction",
      reasonCode: "mistake",
      dueAt: addMilliseconds(
        mistake.latestOccurrenceAt,
        delayDays * DAY_MILLISECONDS,
      ),
      schedulerVersion: LEARNING_KERNEL_SCHEDULER_VERSION,
      state: mistake.status === "corrected" ? "completed" : "pending",
      completionEvidenceId: mistake.correctedByFactId,
    };
  });

  for (const [knowledgeNodeId, mastery] of Object.entries(
    masteryByKnowledgeNode,
  ).sort(([left], [right]) => compareStrings(left, right))) {
    for (const dimension of MASTERY_DIMENSIONS) {
      const projection = mastery[dimension];
      if (projection.sourceFactIds.length === 0) continue;
      const latest = latestEvidenceByIds(evidence, projection.sourceFactIds);
      const completed = projection.state.score >= 3;
      items.push({
        id: `review-${sha256Canonical({
          scope: {
            courseId: scope.courseId,
            revisionId: scope.revisionId,
            branchId: scope.branchId,
          },
          knowledgeNodeId,
          dimension,
          reasonCode: "low_mastery",
        }).slice("sha256:".length)}`,
        sourceFactIds: projection.sourceFactIds,
        courseId: scope.courseId,
        revisionId: scope.revisionId,
        branchId: scope.branchId,
        knowledgeNodeId,
        dimension,
        activityKind: "recall",
        reasonCode: "low_mastery",
        dueAt: addMilliseconds(
          latest.fact.occurredAt,
          MASTERY_REVIEW_INTERVAL_MILLISECONDS,
        ),
        schedulerVersion: LEARNING_KERNEL_SCHEDULER_VERSION,
        state: completed ? "completed" : "pending",
        completionEvidenceId: completed ? latest.fact.id : null,
      });
    }
  }
  const byId = new Map(items.map((item) => [item.id, item] as const));
  for (const fact of facts) {
    if (fact.body.type !== "review") continue;
    const item = byId.get(fact.body.reviewItemId);
    if (!item) {
      throw new LearningKernelValidationError(
        `Unknown review item: ${fact.body.reviewItemId}`,
      );
    }
    if (item.state === "pending") {
      byId.set(item.id, { ...item, state: "dismissed" });
    }
  }
  for (const fact of facts) {
    if (fact.body.type !== "correction") continue;
    const target = factById.get(fact.body.supersedesFactId);
    if (
      target?.body.type !== "evidence" ||
      !target.body.errorFamily ||
      target.body.outcome === "unverified"
    ) {
      continue;
    }
    for (const knowledgeNodeId of target.body.knowledgeNodeIds) {
      const fingerprint = mistakeFingerprint(
        scope,
        knowledgeNodeId,
        target.body.errorFamily,
      );
      const reviewItemId = `review-${fingerprint.slice("sha256:".length)}`;
      if (byId.has(reviewItemId)) continue;
      byId.set(reviewItemId, {
        id: reviewItemId,
        sourceFactIds: [target.id, fact.id],
        courseId: scope.courseId,
        revisionId: scope.revisionId,
        branchId: scope.branchId,
        knowledgeNodeId,
        dimension: target.body.dimension,
        activityKind: "correction",
        reasonCode: "mistake",
        dueAt: addMilliseconds(target.occurredAt, 3 * DAY_MILLISECONDS),
        schedulerVersion: LEARNING_KERNEL_SCHEDULER_VERSION,
        state: "superseded",
        completionEvidenceId: null,
      });
    }
  }
  return [...byId.values()].sort(compareReviewItems);
}

function reviewSuccessorId(
  scope: LearningKernelScope,
  predecessorReviewItemId: string,
  completionFactId: string,
): string {
  return `review-${sha256Canonical({
    scope,
    predecessorReviewItemId,
    completionFactId,
    schedulerVersion: LEARNING_KERNEL_SCHEDULER_VERSION,
  }).slice("sha256:".length)}`;
}

function assertReviewActivityMatches(
  item: LearningKernelReviewItem,
  activityId: string,
  factById: ReadonlyMap<string, LearningKernelFact>,
): void {
  const latestSource = item.sourceFactIds
    .map((id) => factById.get(id))
    .filter((fact): fact is LearningKernelFact => fact !== undefined)
    .sort(
      (left, right) =>
        compareStrings(right.occurredAt, left.occurredAt) ||
        compareStrings(right.id, left.id),
    )[0];
  const sourceActivityId =
    latestSource?.body.type === "correction"
      ? latestSource.body.replacement.activityId
      : latestSource?.body.type === "evidence" ||
          latestSource?.body.type === "review"
        ? latestSource.body.activityId
        : null;
  if (!sourceActivityId) {
    throw new LearningKernelValidationError(
      "Review item has no resolvable source activity",
    );
  }
  if (sourceActivityId !== activityId) {
    throw new LearningKernelValidationError(
      "Review fact activity does not match the scheduled Review item",
    );
  }
}

function latestReviewSeriesItem(
  items: ReadonlyMap<string, LearningKernelReviewItem>,
  seriesByItemId: ReadonlyMap<string, string>,
  seriesId: string,
): LearningKernelReviewItem | null {
  return (
    [...items.values()]
      .filter((item) => seriesByItemId.get(item.id) === seriesId)
      .sort(
        (left, right) =>
          compareStrings(right.dueAt, left.dueAt) ||
          compareStrings(right.id, left.id),
      )[0] ?? null
  );
}

function compareReviewItems(
  left: LearningKernelReviewItem,
  right: LearningKernelReviewItem,
): number {
  return (
    Date.parse(left.dueAt) - Date.parse(right.dueAt) ||
    compareStrings(left.id, right.id)
  );
}

function assertExecutableReviewCycle(
  item: LearningKernelReviewItem,
  observedAt: string,
  transition: "submit" | "complete",
): void {
  if (item.state !== "pending") {
    throw new LearningKernelConflictError(
      `Only a pending Review item may be ${transition === "submit" ? "submitted" : "completed"}`,
    );
  }
  if (!isLearningKernelReviewDue(item, observedAt)) {
    throw new LearningKernelValidationError(
      `A Review item cannot be ${transition === "submit" ? "submitted" : "completed"} before it is due`,
    );
  }
}

function selectNextAction(
  progress: readonly UnitProgressionItem[],
  activities: readonly LearningKernelActivity[],
  reviewItems: readonly LearningKernelReviewItem[],
  observedTimestamp: number,
): LearningKernelNextAction {
  const activityOrder = new Map(
    activities.map((activity, index) => [activity.id, index] as const),
  );
  const inProgress = [...progress]
    .filter((item) => item.status === "in_progress")
    .sort(
      (left, right) =>
        (activityOrder.get(left.unitId) ?? 0) -
        (activityOrder.get(right.unitId) ?? 0),
    )[0];
  if (inProgress) {
    return {
      type: "activity",
      activityId: inProgress.unitId,
      reasonCode: "resume",
    };
  }
  const dueReview = reviewItems.find((item) =>
    isLearningKernelReviewDueAt(item, observedTimestamp),
  );
  if (dueReview) {
    return {
      type: "review",
      reviewItemId: dueReview.id,
      reasonCode: "due_review",
    };
  }
  const ready = [...progress]
    .filter((item) => item.status === "ready")
    .sort(
      (left, right) =>
        (activityOrder.get(left.unitId) ?? 0) -
        (activityOrder.get(right.unitId) ?? 0),
    )[0];
  return ready
    ? { type: "activity", activityId: ready.unitId, reasonCode: "ready" }
    : null;
}

/** Resolves due state against the explicit server-observed clock. */
export function isLearningKernelReviewDue(
  review: LearningKernelReviewItem,
  observedAt: string,
): boolean {
  return isLearningKernelReviewDueAt(
    review,
    Date.parse(parseIsoInstant(observedAt)),
  );
}

function isLearningKernelReviewDueAt(
  review: LearningKernelReviewItem,
  observedTimestamp: number,
): boolean {
  return (
    review.state === "pending" &&
    Date.parse(parseIsoInstant(review.dueAt)) <= observedTimestamp
  );
}

function projectSummary(
  projectionHash: string,
  factFrontier: readonly string[],
  masteryByKnowledgeNode: Readonly<
    Record<string, LearningKernelMasteryProjection>
  >,
  mistakes: readonly LearningKernelMistake[],
  reviewItems: readonly LearningKernelReviewItem[],
): LearningKernelSummaryProjection {
  const strengthReasonCodes: string[] = [];
  const gapReasonCodes: string[] = [];
  for (const [knowledgeNodeId, mastery] of Object.entries(
    masteryByKnowledgeNode,
  ).sort(([left], [right]) => compareStrings(left, right))) {
    for (const dimension of MASTERY_DIMENSIONS) {
      const projection = mastery[dimension];
      if (projection.sourceFactIds.length === 0) continue;
      if (projection.state.score >= 3 && projection.confidence >= 0.6) {
        strengthReasonCodes.push(
          `mastery_supported:${knowledgeNodeId}:${dimension}`,
        );
      } else {
        gapReasonCodes.push(`mastery_gap:${knowledgeNodeId}:${dimension}`);
      }
    }
  }
  for (const mistake of mistakes) {
    if (mistake.status === "open") {
      gapReasonCodes.push(`open_mistake:${mistake.fingerprint}`);
    }
  }
  return {
    modelVersion: LEARNING_KERNEL_MODEL_VERSION,
    projectionHash,
    sourceFactIds: factFrontier,
    strengthReasonCodes,
    gapReasonCodes,
    mistakeIds: mistakes.map((mistake) => mistake.fingerprint),
    reviewItemIds: reviewItems.map((item) => item.id),
  };
}

function masteryConfidence(
  state: MasteryProfile[MasteryDimension],
  observedTimestamp: number,
): number {
  if (state.lastEvidenceAt === null) return 0;
  const age = Math.max(0, observedTimestamp - Date.parse(state.lastEvidenceAt));
  const recency =
    age <= 7 * DAY_MILLISECONDS
      ? 1
      : age <= 30 * DAY_MILLISECONDS
        ? 0.65
        : 0.25;
  const typeDiversity = Math.min(1, state.successfulEvidenceTypes.length / 2);
  const dayDiversity = Math.min(1, state.successfulEvidenceDays.length / 2);
  return round(typeDiversity * 0.4 + dayDiversity * 0.35 + recency * 0.25);
}

function masteryCoverage(state: MasteryProfile[MasteryDimension]): number {
  return round(
    Math.min(
      1,
      state.successfulEvidenceTypes.length / 3 +
        state.successfulEvidenceDays.length / 6,
    ),
  );
}

function latestEvidenceByIds(
  evidence: readonly EffectiveEvidenceFact[],
  ids: readonly string[],
): EffectiveEvidenceFact {
  const idSet = new Set(ids);
  const matching = evidence.filter((item) => idSet.has(item.fact.id));
  const latest = matching.at(-1);
  if (!latest) {
    throw new LearningKernelValidationError(
      "Mastery projection lost its source evidence",
    );
  }
  return latest;
}

function dimensionForErrorFamily(
  errorFamily: string,
  evidence: readonly EffectiveEvidenceFact[],
): MasteryDimension {
  return (
    evidence.find((item) => item.body.errorFamily === errorFamily)?.body
      .dimension ?? "understanding"
  );
}

function mistakeFingerprint(
  scope: LearningKernelScope,
  knowledgeNodeId: string,
  errorFamily: string,
): string {
  return sha256Canonical({
    courseId: scope.courseId,
    revisionId: scope.revisionId,
    branchId: scope.branchId,
    knowledgeNodeId,
    errorFamily,
  });
}

function assertFactScope(
  fact: LearningKernelFact,
  scope: LearningKernelScope,
): void {
  for (const key of [
    "courseId",
    "revisionId",
    "branchId",
    "sessionId",
  ] as const) {
    if (fact[key] !== scope[key]) {
      throw new LearningKernelValidationError(
        `Fact ${fact.id} is outside the pinned ${key}`,
      );
    }
  }
}

function assertScope(scope: LearningKernelScope): void {
  assertExactKeys(
    scope,
    ["courseId", "revisionId", "branchId", "sessionId"],
    "kernel scope",
  );
  assertIdentifier(scope.courseId, "scope.courseId");
  assertIdentifier(scope.revisionId, "scope.revisionId");
  assertIdentifier(scope.branchId, "scope.branchId");
  assertIdentifier(scope.sessionId, "scope.sessionId");
}

function assertIdentifier(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "" || value.length > 500) {
    throw new LearningKernelValidationError(
      `${label} must be a non-empty string`,
    );
  }
  return value;
}

function assertHash(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
    throw new LearningKernelValidationError(`${label} must be a SHA-256 hash`);
  }
}

function uniqueSortedIdentifiers(
  values: readonly string[],
  label: string,
): string[] {
  if (!Array.isArray(values)) {
    throw new LearningKernelValidationError(`${label} IDs must be an array`);
  }
  const seen = new Set<string>();
  for (const value of values) {
    assertIdentifier(value, label);
    if (seen.has(value)) {
      throw new LearningKernelValidationError(
        `Duplicate ${label} ID: ${value}`,
      );
    }
    seen.add(value);
  }
  return [...seen].sort(compareStrings);
}

function assertExactKeys(
  value: object,
  allowedKeys: readonly string[],
  label: string,
): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new LearningKernelValidationError(`${label} must be an object`);
  }
  const allowed = new Set(allowedKeys);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new LearningKernelValidationError(
      `${label} contains unknown fields: ${unknown.sort(compareStrings).join(", ")}`,
    );
  }
}

function parseIsoInstant(value: string): string {
  if (typeof value !== "string") {
    throw new LearningKernelValidationError(
      "Observed clock must be an ISO instant",
    );
  }
  const timestamp = Date.parse(value);
  if (
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toISOString() !== value
  ) {
    throw new LearningKernelValidationError(
      `Invalid canonical ISO instant: ${value}`,
    );
  }
  return value;
}

function addMilliseconds(value: string, milliseconds: number): string {
  return new Date(Date.parse(value) + milliseconds).toISOString();
}

function sortFacts(facts: readonly LearningKernelFact[]): LearningKernelFact[] {
  return [...facts].sort(compareFactsByCanonicalOrder);
}

function compareFactsByCanonicalOrder(
  left: LearningKernelFact,
  right: LearningKernelFact,
): number {
  return (
    Date.parse(left.occurredAt) - Date.parse(right.occurredAt) ||
    compareStrings(left.id, right.id)
  );
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareStrings);
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000) / 1_000;
}

export function canonicalLearningKernelJson(value: unknown): string {
  return canonicalJson(value);
}

export function learningKernelSha256(value: unknown): string {
  return sha256Canonical(value);
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new LearningKernelValidationError(
        "Canonical JSON rejects non-finite numbers",
      );
    }
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    const entries = Object.keys(object)
      .filter((key) => object[key] !== undefined)
      .sort(compareStrings)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`);
    return `{${entries.join(",")}}`;
  }
  throw new LearningKernelValidationError(
    `Canonical JSON rejects ${typeof value}`,
  );
}

function sha256Canonical(value: unknown): string {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const bitLength = bytes.length * 8;
  const paddedLength = ((bytes.length + 9 + 63) >>> 6) << 6;
  const message = new Uint8Array(paddedLength);
  message.set(bytes);
  message[bytes.length] = 0x80;
  const view = new DataView(message.buffer);
  view.setUint32(
    paddedLength - 8,
    Math.floor(bitLength / 0x1_0000_0000),
    false,
  );
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;
  const words = new Uint32Array(64);

  for (let offset = 0; offset < message.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(offset + index * 4, false);
    }
    for (let index = 16; index < 64; index += 1) {
      const w15 = words[index - 15]!;
      const w2 = words[index - 2]!;
      const s0 = rotateRight(w15, 7) ^ rotateRight(w15, 18) ^ (w15 >>> 3);
      const s1 = rotateRight(w2, 17) ^ rotateRight(w2, 19) ^ (w2 >>> 10);
      words[index] = (words[index - 16]! + s0 + words[index - 7]! + s1) >>> 0;
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;
    for (let index = 0; index < 64; index += 1) {
      const s1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temp1 =
        (h + s1 + choice + SHA256_CONSTANTS[index]! + words[index]!) >>> 0;
      const s0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }
  return `sha256:${[h0, h1, h2, h3, h4, h5, h6, h7]
    .map((word) => word.toString(16).padStart(8, "0"))
    .join("")}`;
}

function rotateRight(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

const SHA256_CONSTANTS = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
