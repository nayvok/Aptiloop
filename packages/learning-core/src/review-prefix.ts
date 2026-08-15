import {
  applyMasteryEvidence,
  createEmptyMasteryProfile,
  type MasteryDimension,
} from "./mastery.js";
import type {
  LearningKernelEvidenceBody,
  LearningKernelFact,
  LearningKernelReviewItem,
} from "./kernel.js";

interface EffectiveEvidenceEntry {
  readonly fact: LearningKernelFact;
  readonly body: LearningKernelEvidenceBody;
}

type EvidenceFact = LearningKernelFact & {
  readonly body: LearningKernelEvidenceBody;
};

type CorrectionFact = LearningKernelFact & {
  readonly body: Extract<
    LearningKernelFact["body"],
    { readonly type: "correction" }
  >;
};

interface CorrectionEntry {
  readonly fact: CorrectionFact;
}

export interface ReviewPrefixWork {
  readonly factsVisited: number;
  readonly effectiveEvidenceMutations: number;
  readonly snapshotsProjected: number;
  readonly evidenceEntriesRead: number;
}

export interface ReviewPrefixProjectionOptions {
  readonly masteryReviewIntervalMilliseconds: number;
  readonly mistakeReviewItemId: (
    knowledgeNodeId: string,
    errorFamily: string,
  ) => string;
}

/**
 * Incrementally maintains the exact effective-evidence prefix needed when an
 * executable Review series is first touched. The class is internal to the
 * Learning Kernel package; its work counters make the linear prefix scan
 * observable without relying on wall-clock timing in tests.
 */
export class ReviewPrefixProjection {
  readonly #activeByFactId = new Map<string, EffectiveEvidenceEntry>();
  readonly #factsById = new Map<string, LearningKernelFact>();
  readonly #pendingCorrectionByTargetId = new Map<string, CorrectionEntry>();
  readonly #masteryByNodeAndDimension = new Map<
    string,
    Map<string, EffectiveEvidenceEntry>
  >();
  readonly #mistakeByReviewItemId = new Map<
    string,
    Map<string, EffectiveEvidenceEntry>
  >();
  readonly #evidenceByErrorFamily = new Map<
    string,
    Map<string, EffectiveEvidenceEntry>
  >();
  readonly #supersededFallbackByReviewItemId = new Map<
    string,
    {
      readonly correction: CorrectionEntry;
      readonly target: LearningKernelFact & {
        readonly body: LearningKernelEvidenceBody;
      };
    }
  >();
  readonly #options: ReviewPrefixProjectionOptions;
  #factsVisited = 0;
  #effectiveEvidenceMutations = 0;
  #snapshotsProjected = 0;
  #evidenceEntriesRead = 0;

  constructor(options: ReviewPrefixProjectionOptions) {
    this.#options = options;
  }

  accept(fact: LearningKernelFact): void {
    this.#factsVisited += 1;
    if (fact.body.type === "review") return;
    this.#factsById.set(fact.id, fact);
    if (isEvidenceFact(fact)) {
      const pending = this.#pendingCorrectionByTargetId.get(fact.id);
      if (pending) {
        this.#pendingCorrectionByTargetId.delete(fact.id);
        this.#activateCorrection(pending, fact);
      } else {
        this.#addEffective({ fact, body: fact.body });
      }
      return;
    }
    if (!isCorrectionFact(fact)) return;

    const correction: CorrectionEntry = { fact };
    const target = this.#factsById.get(fact.body.supersedesFactId);
    if (target && isEvidenceFact(target)) {
      this.#removeEffective(target.id);
      this.#activateCorrection(correction, target);
    } else {
      // `baseline-1` accepts historical equal-time corrections that sort
      // before their target. They become effective only after that target is
      // also inside the prefix, while retaining the correction's fact order.
      this.#pendingCorrectionByTargetId.set(
        fact.body.supersedesFactId,
        correction,
      );
    }
  }

  project(item: LearningKernelReviewItem): LearningKernelReviewItem | null {
    this.#snapshotsProjected += 1;
    return item.reasonCode === "mistake"
      ? this.#projectMistake(item)
      : this.#projectLowMastery(item);
  }

  work(): ReviewPrefixWork {
    return {
      factsVisited: this.#factsVisited,
      effectiveEvidenceMutations: this.#effectiveEvidenceMutations,
      snapshotsProjected: this.#snapshotsProjected,
      evidenceEntriesRead: this.#evidenceEntriesRead,
    };
  }

  #activateCorrection(correction: CorrectionEntry, target: EvidenceFact): void {
    this.#addEffective({
      fact: correction.fact,
      body: correction.fact.body.replacement,
    });
    if (target.body.outcome === "unverified") return;
    for (const knowledgeNodeId of target.body.knowledgeNodeIds) {
      if (!target.body.errorFamily) continue;
      const reviewItemId = this.#options.mistakeReviewItemId(
        knowledgeNodeId,
        target.body.errorFamily,
      );
      const previous = this.#supersededFallbackByReviewItemId.get(reviewItemId);
      if (
        !previous ||
        compareFacts(correction.fact, previous.correction.fact) < 0
      ) {
        this.#supersededFallbackByReviewItemId.set(reviewItemId, {
          correction,
          target,
        });
      }
    }
  }

  #addEffective(entry: EffectiveEvidenceEntry): void {
    this.#activeByFactId.set(entry.fact.id, entry);
    this.#effectiveEvidenceMutations += 1;
    if (entry.body.outcome !== "unverified") {
      for (const knowledgeNodeId of entry.body.knowledgeNodeIds) {
        setIndexed(
          this.#masteryByNodeAndDimension,
          masteryKey(knowledgeNodeId, entry.body.dimension),
          entry,
        );
        if (entry.body.errorFamily) {
          setIndexed(
            this.#mistakeByReviewItemId,
            this.#options.mistakeReviewItemId(
              knowledgeNodeId,
              entry.body.errorFamily,
            ),
            entry,
          );
        }
      }
    }
    if (entry.body.errorFamily) {
      setIndexed(this.#evidenceByErrorFamily, entry.body.errorFamily, entry);
    }
  }

  #removeEffective(factId: string): void {
    const entry = this.#activeByFactId.get(factId);
    if (!entry) return;
    this.#activeByFactId.delete(factId);
    this.#effectiveEvidenceMutations += 1;
    if (entry.body.outcome !== "unverified") {
      for (const knowledgeNodeId of entry.body.knowledgeNodeIds) {
        deleteIndexed(
          this.#masteryByNodeAndDimension,
          masteryKey(knowledgeNodeId, entry.body.dimension),
          factId,
        );
        if (entry.body.errorFamily) {
          deleteIndexed(
            this.#mistakeByReviewItemId,
            this.#options.mistakeReviewItemId(
              knowledgeNodeId,
              entry.body.errorFamily,
            ),
            factId,
          );
        }
      }
    }
    if (entry.body.errorFamily) {
      deleteIndexed(
        this.#evidenceByErrorFamily,
        entry.body.errorFamily,
        factId,
      );
    }
  }

  #projectLowMastery(
    item: LearningKernelReviewItem,
  ): LearningKernelReviewItem | null {
    const evidence = sortedEntries(
      this.#masteryByNodeAndDimension.get(
        masteryKey(item.knowledgeNodeId, item.dimension),
      ),
    );
    this.#evidenceEntriesRead += evidence.length;
    if (evidence.length === 0) return null;

    let profile = createEmptyMasteryProfile();
    for (const entry of evidence) {
      profile = applyMasteryEvidence(profile, {
        id: `${entry.fact.id}:${item.knowledgeNodeId}`,
        dimension: item.dimension,
        type: entry.body.evidenceType,
        outcome: entry.body.outcome as Exclude<
          LearningKernelEvidenceBody["outcome"],
          "unverified"
        >,
        occurredAt: entry.fact.occurredAt,
        hintLevel: entry.body.hintLevel,
        ...(entry.body.errorFamily === undefined
          ? {}
          : { errorKey: entry.body.errorFamily }),
      }).profile;
    }
    const latest = evidence.at(-1)!;
    const completed = profile[item.dimension].score >= 3;
    return {
      ...item,
      sourceFactIds: evidence.map((entry) => entry.fact.id),
      dueAt: addMilliseconds(
        latest.fact.occurredAt,
        this.#options.masteryReviewIntervalMilliseconds,
      ),
      state: completed ? "completed" : "pending",
      completionEvidenceId: completed ? latest.fact.id : null,
    };
  }

  #projectMistake(
    item: LearningKernelReviewItem,
  ): LearningKernelReviewItem | null {
    const evidence = sortedEntries(this.#mistakeByReviewItemId.get(item.id));
    this.#evidenceEntriesRead += evidence.length;
    const occurrences = evidence.filter(
      (entry) => entry.body.outcome !== "correct",
    );
    if (occurrences.length > 0) {
      const latest = occurrences.at(-1)!;
      const correction = evidence.find(
        (entry) =>
          entry.body.outcome === "correct" &&
          Date.parse(entry.fact.occurredAt) >=
            Date.parse(latest.fact.occurredAt),
      );
      const errorFamily = latest.body.errorFamily;
      if (!errorFamily) return null;
      const dimensionSource = sortedEntries(
        this.#evidenceByErrorFamily.get(errorFamily),
      );
      this.#evidenceEntriesRead += dimensionSource.length;
      const occurrenceCount = occurrences.length;
      const delayDays = Math.max(1, 4 - Math.min(occurrenceCount, 3));
      return {
        ...item,
        sourceFactIds: occurrences.map((entry) => entry.fact.id),
        dimension: dimensionSource[0]?.body.dimension ?? "understanding",
        dueAt: addMilliseconds(latest.fact.occurredAt, delayDays * 86_400_000),
        state: correction ? "completed" : "pending",
        completionEvidenceId: correction?.fact.id ?? null,
      };
    }

    const fallback = this.#supersededFallbackByReviewItemId.get(item.id);
    if (!fallback) return null;
    return {
      ...item,
      sourceFactIds: [fallback.target.id, fallback.correction.fact.id],
      dimension: fallback.target.body.dimension,
      dueAt: addMilliseconds(fallback.target.occurredAt, 3 * 86_400_000),
      state: "superseded",
      completionEvidenceId: null,
    };
  }
}

function masteryKey(
  knowledgeNodeId: string,
  dimension: MasteryDimension,
): string {
  return `${knowledgeNodeId}\u0000${dimension}`;
}

function isEvidenceFact(fact: LearningKernelFact): fact is EvidenceFact {
  return fact.body.type === "evidence";
}

function isCorrectionFact(fact: LearningKernelFact): fact is CorrectionFact {
  return fact.body.type === "correction";
}

function setIndexed(
  index: Map<string, Map<string, EffectiveEvidenceEntry>>,
  key: string,
  entry: EffectiveEvidenceEntry,
): void {
  const entries = index.get(key);
  if (entries) {
    entries.set(entry.fact.id, entry);
  } else {
    index.set(key, new Map([[entry.fact.id, entry]]));
  }
}

function deleteIndexed(
  index: Map<string, Map<string, EffectiveEvidenceEntry>>,
  key: string,
  factId: string,
): void {
  const entries = index.get(key);
  if (!entries) return;
  entries.delete(factId);
  if (entries.size === 0) index.delete(key);
}

function sortedEntries(
  entries: ReadonlyMap<string, EffectiveEvidenceEntry> | undefined,
): EffectiveEvidenceEntry[] {
  return entries
    ? [...entries.values()].sort((a, b) => compareFacts(a.fact, b.fact))
    : [];
}

function compareFacts(
  left: LearningKernelFact,
  right: LearningKernelFact,
): number {
  return (
    Date.parse(left.occurredAt) - Date.parse(right.occurredAt) ||
    compareStrings(left.id, right.id)
  );
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function addMilliseconds(value: string, milliseconds: number): string {
  return new Date(Date.parse(value) + milliseconds).toISOString();
}
