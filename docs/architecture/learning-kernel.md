# Learning Kernel

**Document status:** Approved Core Alpha target with an evidenced Implemented baseline.
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

**Implemented baseline.** `learning-core` has no runtime dependencies and exports pure rules (`packages/learning-core/package.json:1-24`). Its progression reducer validates graph definitions and legal transitions (`packages/learning-core/src/unit-progression.ts:47-113,177-238`). Its mastery reducer uses a closed six-dimension, six-evidence-type model; applies deterministic outcome weights, hint multipliers, repeated-error penalties, a 0..5 clamp, and a two-successful-types/two-UTC-days gate above score 4 (`packages/learning-core/src/mastery.ts:3-69,87-170`). Batch ordering is timestamp then evidence ID (`packages/learning-core/src/mastery.ts:157-169`).

**Implemented baseline.** Day summary derives conservative evidence, mistakes, cards, metrics, and narrative from persisted booleans/scores/IDs rather than answer or reference-answer text (`packages/learning-core/src/day-summary.ts:9-22,84-122`). Orchestrator reconstructs summary inputs from persisted evidence/progress/test/review/hints and persists summary/mastery/mistake/card artifacts in a transaction (`apps/orchestrator/src/learning-v2.ts:899-975,977-1045`).

**Implemented baseline.** Gaps: persisted mastery reconstruction retains only score, evidence types, and one last day; it resets repeated-error counts and loses earlier successful UTC days (`apps/orchestrator/src/learning-v2.ts:1175-1224`). Recall, Teacher revision, and code reading are deliberately partial evidence without objective correctness in the summary (`packages/learning-core/src/day-summary.ts:124-186,228-269`). Current interview report measures completion/form, not technical correctness, so it must not be described as mastery evidence. Legacy completion routes inject fixed mastery and bypass the reducer (`apps/orchestrator/src/app.ts:409-451`).

## Kernel inputs

**Approved Core Alpha target.** The kernel receives explicit values; it never calls `Date.now()` itself.

```ts
type KernelCommand = {
  commandId: string;
  occurredAt: string;          // observed app clock, ISO instant
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

| Evidence source | Kernel treatment |
|---|---|
| First learner recall | Attempt evidence. Correctness remains `unverified` unless a registered deterministic/typed evaluator evaluates it after persistence. |
| Quiz/objective question | Server evaluator compares stable option IDs to protected answer keys; emits objective correctness. |
| Code reading | Structured attempt; correctness only when a registered evaluator emits a validated result. |
| Trusted check | Execution Fabric emits immutable check ID/version, status, and content/diff hash. Browser/model cannot forge it. |
| Reviewer | Typed finding/review result bound to the same complete diff and trusted check. Reviewer is read-only and cannot apply changes. |
| Teacher/Tutor conversation | Learning interaction/revision evidence, not correctness merely because a model responded. |
| Interview | Completion/form evidence unless a separate typed technical evaluator with rubric/citations emits validated evidence. |
| Source/Capsule use | Provenance/context evidence, not proof of learner mastery. |
| Migrated legacy row | Retained with migration provenance and confidence limits; never silently upgraded to stronger evidence. |

A provider/tool failure emits no learning success fact. A malformed or oversized result is a typed failure, not partial credit. Every required/terminal Core Alpha Activity has a deterministic/manual evaluator path; unknown app-owned non-AI evaluation contracts block validation, while missing optional AI only withholds the optional observation.

## Mastery model

**Approved Core Alpha target.** Preserve the useful current dimensions unless a versioned Course Pack declares a supported subset:

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

**Approved Core Alpha target.** `Mistake` is a deduplicated observation keyed by a stable fingerprint of Course branch + knowledge node + error family, with occurrence facts and correction status. `ReviewItem` is a scheduled action derived from gaps/mistakes/recency and contains:

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

**Implemented baseline.** Current summary operation reuses an existing operation ID, derives from persisted facts when absent, then transactionally persists artifacts (`apps/orchestrator/src/learning-v2.ts:620-687`). Preserve the idempotent/transactional behavior while removing the unobserved `new Date()` from the derivation path (`apps/orchestrator/src/learning-v2.ts:961-974`).

## Storage boundary

**Approved Core Alpha target.** Repositories persist accepted facts and projections in one application transaction. The domain depends on repository ports, not Drizzle/SQLite. PostgreSQL compatibility requires:

- explicit string/UUID identity, never implicit row order;
- integer or exact decimal score representation with specified rounding;
- UTC ISO instants at the boundary;
- canonical JSON and portable hashes;
- uniqueness on operation ID within its command scope and on source fact application;
- foreign keys proving Course/revision/session/activity/knowledge ownership;
- transaction isolation sufficient to reject concurrent conflicting replays.

SQLite remains the Core Alpha implementation. A database transaction rollback handles an uncommitted attempt; a verified backup/restore remains the recovery path for committed schema migrations.

## Migration and cutover

1. Define versioned target fact schemas and adapters for current `versioned_unit_evidence`, exercise/test/review, hints, Teacher, and interview records.
2. Backfill with source table/row provenance. Quarantine untyped/orphaned records; never default an unknown activity/evidence type.
3. Persist full mastery replay state, including successful days and error occurrence counts.
4. Dual-project target mastery/summary against current reducers and explain every mismatch.
5. Make kernel output the only source for new mastery/mistakes/review items.
6. Remove fixed legacy completion writes only after their callers are gone and their historical rows remain readable.

**Future.** Federated profiles, probabilistic/ML mastery models, cloud synchronization, cohort analytics, and model-controlled adaptive state machines are outside Core Alpha.