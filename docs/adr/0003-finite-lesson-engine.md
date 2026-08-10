# ADR 0003: Finite Lesson Engine

## Status

Approved Core Alpha target

## Date

2026-08-08

## Context

A learning session must be resumable, inspectable, and deterministically complete. An open-ended agent conversation cannot be the lesson state machine: it has no stable completion semantics, can hide state in provider context, and cannot guarantee replay. The current versioned path already provides useful unit progression, evidence, and resume seams, while legacy routes and activity-specific UI remain inconsistent.

Related specifications: [Lesson Engine](../architecture/lesson-engine.md), [User journeys](../product/user-journeys.md), [Course Pack](../architecture/course-pack.md), [Learning Kernel](../architecture/learning-kernel.md), and [Activity renderers](../design/activity-renderers.md).

## Decision

The Lesson Engine executes the finite activity graph pinned by a `CourseRevision` and session snapshot.

- Every activity has a stable ID, declared type, validated payload, explicit prerequisites, finite lifecycle, and deterministic completion predicate.
- The app owns legal Activity states (`locked`, `ready`, `in_progress`, `completed`, and `skipped`). Failure and cancellation are typed outcomes/events, not alternate status values. The browser and models request actions; they do not assign authoritative status.
- Activity results become typed evidence. The deterministic Learning Kernel, not the renderer or provider, decides mastery and learning state.
- A session pins authored content in a creation-time hashed snapshot; target migrations preserve those historical bytes. Resume reconstructs the next legal action from persisted snapshot, activity progress, and evidence rather than provider memory.
- Personal adaptation is a learner-owned branch or overlay derived from evidence. It may choose among revision-declared options or create separately versioned proposals; it never mutates the shared Course Revision.
- AI-assisted activities are bounded turns with typed inputs/outputs and explicit unavailable states. A provider failure cannot silently complete, skip, or reclassify an activity.
- Renderers share a stable activity frame for context, status, evidence, capability, response, and actions. Renderer presentation does not own domain transitions.

## Consequences

- Lesson progress is replayable, testable, and provider-independent.
- New activity types require a schema, renderer, completion rule, evidence contract, accessibility states, and migration policy; a prompt alone is insufficient.
- Graph validation must reject cycles, missing targets, impossible prerequisites, and unreachable required activities before publication.
- Long-running or creative work must still expose finite checkpoints and explicit learner-controlled continuation.

## Alternatives

- **Agent loop as lesson controller:** rejected because provider behavior is nondeterministic and provider state is not the product ledger.
- **Renderer-owned progress:** rejected because UI retries and concurrent requests would create divergent state.
- **Linear hardcoded day sequence:** rejected because it cannot express validated prerequisites or adaptation while preserving stable semantics.
- **Mutable live course lookup during a session:** rejected because later author edits would change historical learning behavior.

## Implementation status

**Implemented baseline:** versioned v2 sessions snapshot a finite unit graph, server-owned progression checks prerequisites and completion, typed evidence is append-only, and session resume is durable. The UI currently dispatches many unit types from a large switch; exercise and interview flows are partly separate; legacy v1 routes can bypass v2 evidence rules.

**Approved Core Alpha target:** the finite engine contract is normative. A generalized Lesson Engine, activity registry, and personal adaptation branch are not yet complete.

**Future:** collaborative lessons, live multi-user activities, and unbounded autonomous lesson agents.

No major implementation is authorized until the Core Alpha audit/specification set passes the owner approval gate.
