# Lesson Engine

**Document status:** Approved Core Alpha target with an evidenced Implemented baseline.
**Purpose:** execute a finite Course activity graph while keeping transition authority out of the browser and model runtime.

## Implemented baseline

**Implemented baseline.** Current curriculum contracts define twelve closed unit types, unit statuses, discriminated payloads, completion criteria, and unlock references (`packages/shared/src/curriculum.ts:63-86,147-186,188-294`). The pure progression module validates duplicate/unknown/self prerequisites, rejects cycles, and allows only defined start/pause/complete/skip transitions (`packages/learning-core/src/unit-progression.ts:47-101,116-153,177-238`). Required units determine lesson completion (`packages/learning-core/src/unit-progression.ts:104-113`).

**Implemented baseline.** Versioned lesson routes load the immutable session snapshot, reject inactive sessions and mismatched payload types, check completion criteria, run the pure transition, and persist the result (`apps/orchestrator/src/learning-v2.ts:690-770`). Recall, quiz, code-reading, and summary evidence use server-owned endpoints and idempotent operation IDs (`apps/orchestrator/src/learning-v2.ts:43-109`; `packages/database/src/repository.ts:870-968`).

**Implemented baseline.** Limitation: the browser still submits a desired status to the generic unit PATCH endpoint, which the server maps to an event (`apps/orchestrator/src/learning-v2.ts:690-735`). The target accepts learner actions, not caller-selected state. Legacy session endpoints bypass this engine and inject fixed completion artifacts (`apps/orchestrator/src/app.ts:374-453`).

## Activity graph

**Approved Core Alpha target.** A LessonDefinition is a finite directed acyclic graph captured in an immutable CourseRevision and copied to a LessonSession snapshot:

```ts
type LessonDefinition = {
  lessonId: string;
  revisionId: string;
  entryActivityIds: readonly string[];
  activities: readonly ActivityDefinition[];
};

type ActivityDefinition = {
  activityId: string;
  type: KnownActivityType;
  required: boolean;
  prerequisiteActivityIds: readonly string[];
  capabilityIds: readonly string[];
  completionCriteria: readonly CompletionCriterion[];
  payload: KnownActivityPayload;
};
```

Publication validation requires:

- finite bounded node/edge counts;
- unique stable activity IDs;
- all edges resolve within the same lesson/revision;
- no cycles, self-edges, duplicate edges, or unreachable required nodes;
- at least one entry activity;
- each required node lies on a reachable path;
- activity type, payload, completion criteria, evidence schema, renderer, and capability profile are registered;
- every check/environment/source/knowledge reference resolves;
- no completion criterion depends on a model-selected transition or an untyped text assertion.

Unknown activity types or capabilities block publication. Preserving unknown JSON for a future version is not permission to execute or publish it.

## Activity Registry

**Approved Core Alpha target.** The app owns a closed registry. A registration supplies:

- stable `type` and schema version;
- strict definition/payload validator;
- learner-action schemas;
- reducer from `(activity state, accepted action/fact)` to proposed facts;
- completion predicate over persisted facts;
- evidence projector for the Learning Kernel;
- learner-safe context projector that excludes protected evaluation;
- renderer capability and no-AI/manual behavior;
- declared external capabilities, trusted check IDs, and environment IDs.

Registration is application code reviewed with Aptiloop. Course Packs cannot add registry entries, code, plugins, scripts, commands, or schemas.

Core Alpha may migrate current types one at a time. Until registered, a current type remains on the compatibility path and cannot be published as Course Pack V1. This is an incremental adapter strategy, not a monolithic renderer rewrite.

## State machine and authority

**Approved Core Alpha target.** Persisted activity status remains the closed union:

`locked → ready → in_progress → completed`

with `in_progress → ready` for pause and `ready|in_progress → skipped` only for optional activities. Terminal state is immutable inside a session; a retry creates a typed attempt/evidence record, not an illegal status rewind.

The public application command expresses intent:

```ts
type LessonCommand =
  | { type: "begin-activity"; sessionId: string; activityId: string; operationId: string }
  | { type: "pause-activity"; sessionId: string; activityId: string; operationId: string }
  | { type: "submit-action"; sessionId: string; activityId: string; operationId: string; action: LearnerAction }
  | { type: "skip-optional"; sessionId: string; activityId: string; operationId: string };
```

The engine, in one transaction:

1. loads the immutable session snapshot and current activity/evidence state;
2. authenticates local intent and validates the command/action schema;
3. verifies that the activity is current and its prerequisites/capabilities are satisfied;
4. dispatches to the registered activity reducer;
5. asks the Learning Kernel to validate/normalize derived facts;
6. evaluates completion criteria from persisted accepted facts;
7. computes the only legal transition and newly ready nodes;
8. appends action/evidence records with idempotency keys;
9. persists progress and derived review/mastery effects atomically;
10. returns the new projection.

The browser cannot send `completed`, unlock another node, provide mastery deltas, choose a test command plan, or supply protected evaluation. A model cannot call a transition API. Typed AI tools may return bounded content or evaluation proposals; application validation converts an accepted result into facts, and the kernel decides effects.

## Evidence and completion

Completion criteria are closed, versioned predicates such as acknowledgment, required checklist items, first written attempt, minimum objective score, required structured fields, a trusted check result, and accepted read-only review. Custom string keys are not publishable in Core Alpha unless mapped to a registered predicate.

Every accepted action produces or references append-only facts with:

- operation ID and stable fact ID;
- Course/revision/lesson/session/activity IDs;
- attempt/question/check/review identity where applicable;
- fact type and schema version;
- occurred/recorded timestamps from an app-owned clock;
- normalized payload and provenance;
- evaluator/check/source identity;
- content/diff hash when freshness matters.

**Implemented baseline.** Current versioned evidence is append-only and operation-ID idempotent; conflicting replay is rejected, and evidence must target an in-progress activity of the expected type (`packages/database/src/repository.ts:887-968`). Current accepted evidence types are limited to recall, quiz, code-reading, and summary (`packages/database/migrations/0003_unit_evidence.sql:1-24`). Teacher, interview, exercise, review, and hint facts therefore need target adapters before the engine can treat them uniformly.

## Exercise and review boundary

**Approved Core Alpha target.** Activities reference only a trusted `environmentId` and `checkId`. The Execution Fabric owns executable, args, cwd, environment, isolation, timeout, output budget, and result normalization. Neither Course Pack, browser, nor model can select arbitrary values.

Reviewer is read-only. It receives a bounded review bundle and may submit only a typed review result. It cannot patch, edit, apply, run a command, select a state transition, or publish. The engine accepts a review fact only if the trusted check result matches the current complete diff/content fingerprint.

**Implemented baseline.** Current browser command input is strict `{operationId, commandId: "test"}`, and the orchestrator owns the executable plan (`apps/orchestrator/src/app.ts:779-821`). Review requires a non-empty, non-truncated diff and a passing test bound to the same diff fingerprint; the diff is compared again after review (`apps/orchestrator/src/app.ts:870-953`). Preserve these controls.

## Snapshots, resume, and adaptation

A LessonSession pins one immutable CourseRevision and its activity definitions, protected evaluation, source/capsule hashes, capability contract, and renderer schema versions. Resume reads only the snapshot plus append-only actions/facts; a later Course publication or personal adaptation never changes an existing session.

Personal adaptation creates a new `personal` CourseRevision derived from the upstream hash. It may change future lesson definitions after validation and publication to the personal branch. It cannot rewrite prior sessions, evidence, or mastery history.

## Failure behavior

- Missing/unknown activity, capability, renderer, environment, check, source snapshot, or schema version: block publication; fail session start if discovered in an unvalidated legacy snapshot.
- Provider unavailable: preserve lesson state and return a typed blocked/retry/manual-alternative state. Never mark completion and never silently use Mock.
- No-AI mode: registered manual paths remain usable. An AI-required activity without a validated manual alternative is visibly blocked, not auto-completed.
- Duplicate operation with identical payload: return the prior result. Same operation ID with different payload: conflict.
- Reducer/validation/storage failure: commit nothing; retain prior progress.
- Unknown persisted event: stop projection and surface migration-required; do not coerce it.

## Incremental cutover

1. Wrap current snapshot units in ActivityDefinition adapters without changing stored IDs.
2. Route current server-owned recall/quiz/code-reading/summary endpoints through the action/fact contract.
3. Add typed adapters for teacher, exercise, review, interview, and hints.
4. Change the generic UI command from desired status to learner intent.
5. Move direct SQL writes behind transaction-scoped repositories.
6. Dual-project existing sessions and compare state/evidence before making the new engine authoritative.
7. Retire legacy fixed-completion routes only after all callers and persisted rows are accounted for.

**Future.** Cyclic/open-ended agent workflows, third-party activity plugins, model-authored runtime state machines, and distributed/multi-user lesson execution are out of scope.