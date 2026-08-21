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

**Implemented baseline.** Versioned learner routes adapt accepted activity outcomes and progress operations into kernel facts. Objective correctness requires deterministic evaluator or trusted-check provenance; learner/model narrative remains `unverified`. The compatibility unit PATCH may request a target state, but the kernel validates the legal transition and owns the resulting terminal state/next action. The Summary route separately persists one unit-scoped presentation payload idempotently and includes an exact `(Course, revision, branch, session)` authority envelope with Kernel model version, observed projection clock, projection hash, and canonical source-fact frontier. Existing-unit resolution, presentation-input capture, frontier projection, and evidence insertion execute in one synchronous database transaction, so parallel operation IDs converge on one immutable Summary rather than capturing mismatched states. Every read and Summary completion replays that frontier and fails closed on missing facts, reordered identity, scope mismatch, or hash divergence. Summary generation does not mutate unit progress or any legacy topic/mastery/mistake/flashcard table; only the explicit completion transition binds its evidence ID into unit progress.

**Implemented baseline.** Limitations: legacy rows are backfilled only where their meaning is provable; ambiguous/non-authoritative summaries remain immutable quarantine records and older projections stay readable. Interview completion/form remains non-technical evidence and cannot change mastery without a separately approved typed evaluator.

## Kernel inputs

**Implemented baseline.** The kernel receives explicit values; it never calls `Date.now()` itself.

```ts
interface LearningKernelScope {
  readonly courseId: string;
  readonly revisionId: string;
  readonly branchId: string;
  readonly sessionId: string;
}

interface LearningKernelCommand {
  readonly operationId: string;
  readonly factId: string;
  readonly observedAt: string; // app-observed ISO instant
  readonly provenance: LearningKernelFactProvenance;
  readonly body: LearningKernelFactBody;
}

interface LearningKernelFact extends LearningKernelScope {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly operationId: string;
  readonly occurredAt: string;
  readonly provenance: LearningKernelFactProvenance;
  readonly body: LearningKernelFactBody;
}
```

`LearningKernelFactProvenance.kind` is the closed union `learner_submission | deterministic_evaluator | trusted_check | reviewer | migration`. It carries `sourceId`/`sourceHash` and optional evaluator/check/workspace/check-fact fields. Provider identity is not a provenance kind and cannot raise confidence by itself.

Required invariants:

- IDs are non-empty and scoped to the pinned revision/session.
- Operation IDs are idempotent: identical replay is stable; different replay conflicts.
- Facts are append-only. Correction adds a superseding fact; it does not edit history.
- Fact schemas are closed/versioned. Unknown types or versions stop projection.
- Protected evaluator material is read only inside the trusted evaluator after the learner attempt is persisted.
- `occurredAt` ordering ties break by fact ID; projection never depends on SQLite row order or locale collation.
- Numeric rounding, hash, sort, and canonical JSON rules are specified and portable across SQLite/PostgreSQL adapters.

## Course Pack lesson graph projection

**Implemented baseline.** Course Pack V1 minor 1 carries an explicit, finite lesson prerequisite DAG in `lesson.prerequisiteLessonIds`; missing fields in legacy minor-0 Packs are interpreted as `[]`, never as an inferred sequential chain. Import revalidates the Pack against the installed registry, writes the exact lesson and Activity nodes/edges to both the curriculum read model and Course Foundation snapshot inside one transaction, and compares stable-ID node/edge sets before the revision can be published.

Roadmap availability is derived from those persisted prerequisite IDs: a lesson is available only after every prerequisite lesson is complete. One unambiguous available lesson produces the deterministic Course-level Start action. Intentional parallel branches remain simultaneously available and therefore require explicit learner selection rather than collection-order guessing; an active lesson remains the sole resumable action. The Learning Kernel continues to own deterministic Activity selection inside that lesson.

## Deterministic evaluation

| Evidence source            | Kernel treatment                                                                                                                                                                                                                             |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First learner recall       | Attempt evidence. Correctness remains `unverified` unless a registered deterministic/typed evaluator evaluates it after persistence.                                                                                                         |
| Quiz/objective question    | Server evaluator compares stable option IDs to protected answer keys; emits objective correctness.                                                                                                                                           |
| Code reading               | Structured attempt; correctness only when a registered evaluator emits a validated result.                                                                                                                                                   |
| Trusted check              | Execution Fabric emits immutable check ID/version, status, and canonical allowed-workspace manifest/content hash. Browser/model cannot forge it.                                                                                             |
| Reviewer                   | Typed advisory finding/result bound to the same workspace hash, bounded review patch, and trusted check. A validated receipt proves participation only; Reviewer output never supplies correctness or mastery and cannot read/apply changes. |
| Teacher/Tutor conversation | Learning interaction/revision evidence, not correctness merely because a model responded.                                                                                                                                                    |
| Interview                  | Completion/form evidence unless a separate typed technical evaluator with rubric/citations emits validated evidence.                                                                                                                         |
| Source/Capsule use         | Provenance/context evidence, not proof of learner mastery.                                                                                                                                                                                   |
| Migrated legacy row        | Retained with migration provenance and confidence limits; never silently upgraded to stronger evidence.                                                                                                                                      |

A provider/tool failure emits no learning success fact. A malformed or oversized result is a typed failure, not partial credit. Course Pack V1 validation rejects unknown requirements and required AI-only terminal paths under its installed registry. Adaptive Studio's current publication gate validates its current Unit schemas, completion-criterion presence, finite graph, validation hash, Preview hash, and Change-review hash; it does not by itself certify broader content quality, provenance, licensing, or future registry closure. Any future Aptiloop-supplied first-party/sample Course requires those separate gates; the application intentionally bundles none.

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

**Implemented baseline.** The kernel schedules due Review Items and preserves source fact/session provenance without treating that provenance as executable authority. The Review-surface executor resolves an opaque execution identity to the exact immutable scope and snapshot, accepts a bounded learner free response, and appends learner `submit` plus deterministic `complete` facts atomically. Participation does not assert correctness or mastery. Completion retains the exact completed cycle and derives a distinct successor due three days later under scheduler `baseline-1`. Later accepted evidence may independently complete or supersede an item, and learner intent may dismiss one; an originating lesson session is never reopened.

## Summary contract

A summary is a projection, not a new source of truth. It references the exact fact IDs used, kernel model version, projection hash, strengths/gaps reason codes, mistake/review candidates, and localized presentation keys. Narrative text may be rendered deterministically or generated as an optional non-authoritative supplement. Re-running a summary operation returns the same projection for the same fact frontier.

**Implemented baseline.** The canonical Kernel projection is the sole authority for progression, mastery, mistakes, Review Items, next action, and Summary provenance. The versioned Summary HTTP route remains a presentation compatibility adapter: it reconstructs localized narrative and non-authoritative candidate material from server-owned unit evidence, progress, trusted checks, accepted Review receipts with exact immutable evidence binding, and hints, then binds that payload to the exact Kernel authority envelope above. Trusted deterministic checks alone supply implementation correctness. An accepted Reviewer receipt contributes only to attempted-activity accounting; the advisory model verdict, findings, suggested mastery changes, and correction count cannot change Summary strengths, gaps, mistake candidates, debugging evidence, or mastery evidence. A legacy Summary payload without an envelope remains readable only when its stored `occurredAt` deterministically reconstructs an exact non-empty Kernel frontier and its presentation metrics do not encode a Reviewer verdict or correction-derived outcome; it is never rewritten in place. Older payloads that encoded `reviewStatus`, correction-derived debugging evidence, or Reviewer-created mistakes fail closed and require a future additive reconciliation instead of silently preserving model-derived semantics. Rows already present in `topics`, `mastery_evidence`, `mastery_scores`, `mistakes`, and `flashcards` are preserved compatibility history. New Summary operations and active product routes do not write or update them, and no current Skills, Mistakes, or Review surface reads them as authority.

**Implemented baseline.** Current clients read `/api/learning/skills`, `/api/learning/mistakes`, and `/api/learning/reviews`, all projected from exact selected Course/revision/branch/session Kernel scopes. Retired `/api/knowledge`, `/api/mistakes`, and `/api/flashcards` GETs are permanent redirects to those Kernel-backed resources. Legacy flashcard mutation/export routes return `410`; they cannot change or export the obsolete table as if it controlled Review state.

**Approved Core Alpha target.** An additive reconciliation migration may remove the compatibility tables only after inventory, backup, parity evidence, and rollback approval. Existing globally titled compatibility topics and historical rows remain preserved until then; their presence grants no authority and does not justify destructive rewriting. The production-unused `LearningRepository.completeSession`, `getKnowledgeMap`, `listFlashcards`, and `updateFlashcard` methods remain legacy/test compatibility APIs and are explicit removal candidates for that migration; they are not active application authority.

## Storage boundary

**Implemented baseline.** SQLite repositories persist accepted facts and projections in one application transaction. The domain depends on repository ports, not SQLite row shapes.

**Approved Core Alpha target.** A future PostgreSQL adapter requires:

- explicit string/UUID identity, never implicit row order;
- integer or exact decimal score representation with specified rounding;
- UTC ISO instants at the boundary;
- canonical JSON and portable hashes;
- uniqueness on operation ID within its command scope and on source fact application;
- foreign keys proving Course/revision/session/activity/knowledge ownership;
- transaction isolation sufficient to reject concurrent conflicting replays.

SQLite remains the Core Alpha implementation. A database transaction rollback handles an uncommitted attempt; a verified backup/restore remains the recovery path for committed schema migrations.

## Migration and cutover

**Implemented baseline.** Migration `0012_learning_kernel` creates the target fact/projection/quarantine/run tables and adds knowledge-node ownership to Course activities. Repository reconciliation backfills provable legacy progress with source-table/row provenance, quarantines ambiguous summaries, and is idempotent. New versioned learner operations write kernel facts before their derived projections. `LearningKernelRepository.readProjection` verifies canonical stored bytes and replays the persisted fact frontier before returning the cache; historical-frontier replay ignores later facts but rejects missing, duplicate, or reordered frontier identity. Old tables remain compatibility history/materialization only. Rollback switches readers or restores an explicitly approved whole-file backup; it never edits or deletes accepted fact history.

**Future.** Federated profiles, probabilistic/ML mastery models, cloud synchronization, cohort analytics, and model-controlled adaptive state machines are outside Core Alpha.
