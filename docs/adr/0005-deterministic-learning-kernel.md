# ADR 0005: Deterministic Learning Kernel

## Status

Approved Core Alpha target

## Date

2026-08-08

## Context

Mastery, progression, review scheduling, and completion are product state, not model opinion. They must be explainable and replayable from durable facts. The repository already contains pure progression, mastery, and day-summary rules, but persisted mastery reconstruction loses successful-day and repeated-error history, interview evidence does not establish technical correctness, and legacy routes can inject fixed outcomes.

Related specifications: [Learning Kernel](../architecture/learning-kernel.md), [Lesson Engine](../architecture/lesson-engine.md), [Knowledge system](../architecture/knowledge-system.md), and [Learning methodology baseline](../learning-methodology.md).

## Decision

The Learning Kernel is the sole authority for learning state and mastery.

- Inputs are validated, append-only, typed evidence tied to learner, course, immutable revision, session, activity, attempt, operation ID, source, and observed time.
- Pure, versioned reducers derive activity completion, skill/mastery state, review items, mistakes, summaries, and adaptation signals. Given the same kernel version and ordered evidence, replay produces the same result.
- The kernel records all facts required for replay, including successful evidence types, UTC learning days, repeated-error occurrences, hints, supersession, and provenance. Derived rows are caches, never the only source of truth.
- The application supplies an observed clock and deterministic ordering. Wall-clock reads, provider state, and UI state do not enter reducers implicitly.
- AI may generate feedback or typed evidence proposals, but cannot set mastery, mark completion, schedule review, or mutate learner state. Evaluative evidence is accepted only through an app-owned validated contract with explicit provenance.
- Interview completion/answer shape is not technical correctness. It cannot affect technical mastery unless a future evaluator produces validated correctness evidence.
- Personal adaptation consumes kernel outputs and writes an auditable learner-owned branch; it does not rewrite authored history.

## Consequences

- State can be audited, rebuilt, migrated, and explained without replaying model calls.
- Kernel rule versions and evidence schemas become durable compatibility boundaries.
- Corrections append superseding evidence or rebuild derived state; they do not edit historical facts invisibly.
- Provider-generated narrative may differ while authoritative learning state remains stable.

## Alternatives

- **Let an LLM assign mastery:** rejected because output is nondeterministic, provider-dependent, and hard to audit.
- **Persist only the latest mastery score:** rejected because it cannot reproduce caps, repeated-error penalties, or historical reasoning.
- **Treat activity completion as mastery:** rejected because completion and demonstrated skill are different facts.
- **Keep legacy fixed-outcome endpoints:** rejected as a target because they bypass evidence ownership.

## Implementation status

**Implemented baseline:** pure prerequisite progression, weighted mastery, hint multipliers, day summaries, typed versioned evidence, immutable first recall attempts, and transactional summary artifacts are implemented. Replay is incomplete because successful-day and error-count history is lossy; interview reports are form/completion observations only; legacy v1 writes remain a bypass.

**Approved Core Alpha target:** kernel ownership, complete replay evidence, explicit rule versioning, and removal of bypasses are normative but not fully implemented.

**Future:** population analytics, collaborative mastery, and model-generated evidence accepted without a deterministic app-owned validator.

No major implementation is authorized until the Core Alpha audit/specification set passes the owner approval gate.
