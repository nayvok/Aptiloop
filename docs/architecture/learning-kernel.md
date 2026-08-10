# Learning Kernel

**Document status:** M4 deterministic fact acceptance, replay, and projections are an **Implemented baseline**. Later model versions, additional evaluators, PostgreSQL, and federated behavior retain their labels below.
**Definition:** the Learning Kernel is the deterministic authority for accepted learning facts, lesson state, evidence, mastery, mistakes, review items, and summaries. It is not an AI agent.

## Non-negotiable authority boundary

**Approved Core Alpha target.** Given the same immutable revision/session snapshot, prior accepted facts, command, and observed clock value, the kernel produces byte-equivalent normalized facts and derived state. It performs no network, filesystem, provider, prompt, database, or UI work.

A browser may submit learner actions. A model may produce a typed proposal through an Aptiloop tool. Neither may:

- choose `completed`, `unlocked`, mastery score/delta, review schedule, or next activity;
- assert a test/check passed;
- provide or see protected evaluation before the relevant attempt;
- choose command/executable/args/cwd/environment;
- mutate accepted evidence or a published revision;
- turn unvalidated natural language into authoritative evidence.

## Implemented baseline

**Implemented baseline.** `packages/learning-core/src/kernel.ts` exports the pure, runtime-dependency-free `reduceLearningKernel` and `projectLearningKernel` contracts. Closed facts carry scope, operation identity, explicit observed time, typed provenance, and one of `evidence | progress | correction | review`. The reducer validates authority and links, sorts without locale/row-order dependence, preserves superseded history, and produces canonical SHA-256-bound progression, mastery, mistake, review, next-action, and summary projections under model/scheduler version `baseline-1`.

**Implemented baseline.** Migration `0012_learning_kernel` persists append-only facts, immutable projection history, the current rebuildable projection cache, and immutable migration quarantine/provenance. `LearningKernelRepository.accept` atomically inserts one fact and its projection, rejects conflicting operation replay, rolls both back on persistence failure, and replays stored facts to the same canonical bytes/hash. Stable Course/revision/branch/session/lesson/activity ownership is enforced by repository validation and composite foreign keys.

**Implemented baseline.** Versioned learner routes adapt recall, Teacher, quiz, code reading, exercise/trusted-check, review, interview, summary, and progress operations into kernel facts. Objective correctness requires deterministic evaluator or trusted-check provenance; learner/model narrative remains `unverified`. The compatibility unit PATCH may request a target state, but the kernel validates the legal transition and owns the resulting terminal state/next action. Summary artifacts are derived from accepted server facts and persist idempotently.

**Implemented baseline limitations.** Legacy rows are backfilled only where their meaning is provable; ambiguous/non-authoritative summaries remain immutable quarantine records and older projections stay readable. Interview completion/form remains non-technical evidence and cannot change mastery without a separately approved typed evaluator. Git-ignored exercise state remains outside trusted-check/review freshness.

## Kernel inputs

**Implemented baseline.** The kernel receives explicit values; it never calls `Date.now()` itself.

```ts
type KernelCommand = {
  commandId: string;
  occurredAt: string; // observed app clock, ISO instant
  actor: "learner" | "author" | "system";
  sessionId: string;
  activityId: string;
  action: RegisteredLearnerAction;
};

type AcceptedFact = {
  factId: string;
  schemaVersion: number;
  operationId: string;
  courseId: string;
  revisionId: string;
  lessonId: string;
  sessionId: string;
  activityId: string;
  type: RegisteredFactType;
  occurredAt: string;
  recordedAt: string;
  payload: CanonicalJson;
  provenance: FactProvenance;
};
```

`FactProvenance` distinguishes learner submission, deterministic evaluator, trusted check, read-only reviewer result, source/capsule, and migration. It includes source IDs/hashes and evaluator/check version. Model/provider identity may be recorded as provenance but never raises confidence by itself.

Required invariants:

- IDs are non-empty and scoped to the pinned revision/session.
- Operation IDs are idempotent: identical replay is stable; different replay conflicts.
- Facts are append-only. Correction adds a superseding fact; it does not edit history.
- Fact schemas are closed/versioned. Unknown types or versions stop projection.
- Protected evaluator material is read only inside the trusted evaluator after the learner attempt is persisted.
- `occurredAt` ordering ties break by fact ID; projection never depends on SQLite row order or locale collation.
- Numeric rounding, hash, sort, and canonical JSON rules are specified and portable across SQLite/PostgreSQL adapters.

## Deterministic evaluation

| Evidence source            | Kernel treatment                                                                                                                                                |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First learner recall       | Attempt evidence. Correctness remains `unverified` unless a registered deterministic/typed evaluator evaluates it after persistence.                            |
| Quiz/objective question    | Server evaluator compares stable option IDs to protected answer keys; emits objective correctness.                                                              |
| Code reading               | Structured attempt; correctness only when a registered evaluator emits a validated result.                                                                      |
| Trusted check              | Execution Fabric emits immutable check ID/version, status, and canonical allowed-workspace manifest/content hash. Browser/model cannot forge it.                |
| Reviewer                   | Typed finding/review result bound to the same workspace hash, bounded review patch, and trusted check. Reviewer is evidence-only and cannot read/apply changes. |
| Teacher/Tutor conversation | Learning interaction/revision evidence, not correctness merely because a model responded.                                                                       |
| Interview                  | Completion/form evidence unless a separate typed technical evaluator with rubric/citations emits validated evidence.                                            |
| Source/Capsule use         | Provenance/context evidence, not proof of learner mastery.                                                                                                      |
| Migrated legacy row        | Retained with migration provenance and confidence limits; never silently upgraded to stronger evidence.                                                         |

A provider/tool failure emits no learning success fact. A malformed or oversized result is a typed failure, not partial credit. Every required/terminal Core Alpha Activity has a deterministic/manual evaluator path; unknown app-owned non-AI evaluation contracts block validation, while missing optional AI only withholds the optional observation.

## Mastery model

**Implemented baseline** under model version `baseline-1`. The kernel preserves the six current dimensions:

- understanding;
- explanation;
- code reading;
- implementation;
- debugging;
- interview.

The kernel stores the complete replay state for each `(learner, Course branch, knowledge node, dimension)`:

- score and model version;
- all applied evidence IDs or a verifiable projection checkpoint;
- successful evidence types;
- successful UTC days;
- per-error occurrence counts;
- last evidence instant;
- confidence/coverage derived from evidence diversity and recency, never caller-supplied;
- projection hash.

Current weights/hint penalties may be retained as kernel model version `baseline-1`, but the version and constants must be explicit. Changing rules creates a new model version and a deterministic reprojection; it never mutates evidence. A score alone is not sufficient persisted state.

### Mastery constraints

- Scores stay within the model range.
- Positive credit is attenuated by accepted hint level; negative evidence is never converted to positive by hints.
- Repeated same-error evidence receives a deterministic penalty.
- Advanced mastery requires diversity across evidence type and day.
- Unverified/model-only narrative cannot produce `correct`.
- Suggested mastery changes from a reviewer/model are non-authoritative proposals; the kernel derives any delta from accepted fact type/outcome.
- Reprojection from genesis or a signed/checksummed checkpoint must reproduce the stored projection hash.

## Mistakes and ReviewItems

**Implemented baseline.** `Mistake` is a deduplicated observation keyed by a stable fingerprint of Course branch + knowledge node + error family, with occurrence facts and correction status. `ReviewItem` is a scheduled action derived from gaps/mistakes/recency and contains:

- stable item ID and source fact IDs;
- Course branch and knowledge-node scope;
- review activity kind;
- reason code;
- due instant and scheduler version;
- state `pending | completed | dismissed | superseded`;
- completion evidence ID when completed.

Scheduling is deterministic from facts plus an explicit observed clock. A model may suggest wording/content, but not set due dates, dismiss an item, or mark it complete.

## Summary contract

A summary is a projection, not a new source of truth. It references the exact fact IDs used, kernel model version, projection hash, strengths/gaps reason codes, mistake/review candidates, and localized presentation keys. Narrative text may be rendered deterministically or generated as an optional non-authoritative supplement. Re-running a summary operation returns the same projection for the same fact frontier.

**Implemented baseline.** Summary is part of the canonical kernel projection and references the exact fact frontier/projection hash. The versioned summary route reconstructs inputs from persisted facts, reuses an existing operation ID, and transactionally persists summary/mastery/mistake/card artifacts without allowing browser or model narrative to assert mastery.

## Storage boundary

**Implemented baseline for SQLite; Approved Core Alpha target for a future PostgreSQL adapter.** Repositories persist accepted facts and projections in one application transaction. The domain depends on repository ports, not SQLite row shapes. PostgreSQL compatibility requires:

- explicit string/UUID identity, never implicit row order;
- integer or exact decimal score representation with specified rounding;
- UTC ISO instants at the boundary;
- canonical JSON and portable hashes;
- uniqueness on operation ID within its command scope and on source fact application;
- foreign keys proving Course/revision/session/activity/knowledge ownership;
- transaction isolation sufficient to reject concurrent conflicting replays.

SQLite remains the Core Alpha implementation. A database transaction rollback handles an uncommitted attempt; a verified backup/restore remains the recovery path for committed schema migrations.

## Migration and cutover

**Implemented baseline.** Migration `0012_learning_kernel` creates the target fact/projection/quarantine/run tables and adds knowledge-node ownership to Course activities. Repository reconciliation backfills provable legacy progress with source-table/row provenance, quarantines ambiguous summaries, and is idempotent. New versioned learner operations write kernel facts before their derived projections; old evidence/projection tables remain readable compatibility history. Rollback switches readers or restores an explicitly approved whole-file backup; it never edits or deletes accepted fact history.

**Future.** Federated profiles, probabilistic/ML mastery models, cloud synchronization, cohort analytics, and model-controlled adaptive state machines are outside Core Alpha.
