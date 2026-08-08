# ADR 0008: Adaptive Studio and Calm Workshop

## Status

Proposed pending owner approval

## Date

2026-08-08

## Context

Course authoring must make pedagogy, finite graph structure, locales, provenance, validation, and immutable publication understandable without becoming an IDE. The current Curriculum Editor proves draft/clone/publish seams but exposes nested forms and raw JSON, has no Course Pack workflow or locale system, and is not yet Adaptive Studio. The recommended visual direction is Calm Workshop, but it has not been approved or implemented.

Related specifications: [Adaptive Studio](../design/adaptive-studio.md), [Course authoring](../product/course-authoring.md), [Language policy](../product/language-policy.md), [Information architecture](../design/information-architecture.md), [Activity renderers](../design/activity-renderers.md), [Accessibility](../design/accessibility.md), [Course Pack](../architecture/course-pack.md), and [Design system](../../DESIGN.md).

## Decision

If approved, Adaptive Studio will be a 70% editorial workspace and 30% developer instrument.

- Editorial work leads: course intent, outline, activity content, sources/capsules, skills, locales, Preview, validation, and revision history. Technical IDs, schemas, graph diagnostics, and environment/check references remain contextual instruments rather than the default canvas. An Advanced JSON editor is **Future** and is not part of Core Alpha.
- Manual authoring must work without AI. AI produces typed, scoped proposals showing target IDs, before/after values, provenance, and validation results. Apply changes only a draft; Reject is lossless; AI can never publish.
- Publication is a separate sequence: Validate, Preview, Review changes, then explicit immutable Publish. Applying an AI proposal and publishing never share a confirmation.
- The finite graph is always inspectable, and validation focuses the exact node/field. Published revisions are read-only and edited by cloning.
- UI catalogs must support `en-US` and `ru-RU`; UI locale is independent of the Course Pack's one primary course locale and optional translations.
- Primary product navigation is **Home / Courses / Review / Skills / Settings**. Studio is entered in Course context rather than added as another subsystem destination.
- Calm Workshop retains Geist Sans/Mono and the existing semantic OKLCH foundation while replacing generic dashboard/card composition with open editorial surfaces and contextual technical panels. Accessibility, keyboard operation, reduced motion, mobile one-pane editing, and non-color status cues are required.

## Consequences

- The current editor can migrate incrementally through shared frames and schema-driven controls rather than a big-bang rewrite.
- Authors receive explicit provenance and immutable consequences before publication.
- AI remains optional and cannot become a hidden authoring or release authority.
- The navigation and locale migration affects existing hardcoded Russian UI and must preserve deep-link compatibility during cutover.

## Alternatives

- **IDE-first Studio:** rejected because it overexposes implementation detail and weakens editorial review.
- **Chat-first authoring:** rejected because proposals, graph effects, citations, and publication diffs would be hidden in conversation state.
- **Keep the generic dashboard/card composition:** rejected by the proposal because it scales poorly to dense graph and inspector work.
- **Big-bang visual rewrite:** rejected; existing semantic tokens, learner flows, and activity bodies should migrate incrementally.

## Implementation status

**Implemented baseline:** the current editor supports strict draft CRUD, clone, delete confirmation, publish confirmation, and immutable published rows. The application has Geist fonts, semantic OKLCH light/dark tokens, and strong lesson activity bodies. Primary navigation, UI copy, pack flows, locale separation, proposal review, and Studio composition do not meet this proposal.

**Proposed pending owner approval:** Adaptive Studio, the 70/30 balance, Calm Workshop, and the navigation redesign are proposals, not implemented behavior.

**Future:** collaboration, multi-author review, remote catalogs, and autonomous course generation.

No major implementation is authorized until the owner approves this ADR and the complete Core Alpha audit/specification gate.
