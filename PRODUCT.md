# Aptiloop Product Contract

## Document status

This is the current product-level contract for Core Alpha. It distinguishes **Implemented baseline** behavior from approved target and release gates; implementation evidence never implies legal or distribution acceptance.

- **Implemented baseline** — observed current behavior.
- **Approved Core Alpha target** — binding target for later implementation.
- **Proposed pending owner approval** — unresolved recommendation.
- **Future** — explicitly deferred.

## Positioning

**Approved Core Alpha target**

Aptiloop is a local-first learning workbench for people who want durable technical skill rather than passive content completion. It turns an authored Course into a finite sequence and graph of evidence-producing activities: recall, explanation, prediction, implementation, trusted checks, evidence-only review, correction, and spaced review.

Aptiloop is not an IDE, chat wrapper, course marketplace, autonomous coding agent, or learning-management system. AI may assist within explicit typed roles, but the deterministic Learning Kernel—not a model—owns learning state and mastery.

## Audience

**Approved Core Alpha target**

Core Alpha serves one local learner who:

- is building or refreshing practical software-development skill;
- prefers deliberate practice and verifiable evidence over gamification;
- may learn without an external AI provider;
- writes code in a chosen external editor or workspace rather than an embedded IDE;
- authors a personal Course, installs a trusted Course Pack, or adapts one locally;
- expects private learning history and course material to remain on the device by default.

Core Alpha does not encode a named person, employer, geography, schedule, experience level, or proprietary curriculum as the product persona.

## Product promise

**Approved Core Alpha target**

Aptiloop always makes four things clear:

1. what the learner should do next;
2. what evidence has actually been recorded;
3. which conclusions are deterministic and which came from optional AI;
4. what remains local and what would leave the device after an explicit action.

The product must never represent answer length, completion, provider output, or a single successful attempt as verified mastery.

## Product model

**Approved Core Alpha target**

- `Course` is the top-level entity.
- A Course has immutable published `Course Revision` objects.
- A learner changes a published Course through a personal `Adaptation Branch`; source revisions remain unchanged.
- A revision contains a finite `Activity Graph`. The graph has explicit entry nodes, prerequisites, completion conditions, and terminal outcomes.
- The deterministic `Learning Kernel` owns activity state, evidence reduction, mastery, review scheduling, and next-action selection.
- `Source Snapshots` preserve acquired source material; `Knowledge Capsules` are bounded, attributable learning material derived for a Course Revision.
- A declarative, validated `Course Pack` transports course structure and content. It contains no commands, scripts, secrets, executable plugins, or provider credentials.
- The application owns typed tools, roles, policies, data, and permissions. Pi is only a model/runtime dependency behind that boundary.

## Core Alpha experience

**Approved Core Alpha target**

Primary navigation is:

- **Home** — current Course, next action, recent evidence, and recovery states;
- **Courses** — installed Courses, revisions, personal adaptations, import, and authoring entry points;
- **Review** — due review work, mistakes, flashcards, and interview practice;
- **Skills** — mastery dimensions and evidence history;
- **Settings** — language, appearance, runtime, providers, privacy, and diagnostics.

The complete learner journey is defined in [User journeys](docs/product/user-journeys.md). Core Alpha scope is defined in [Core Alpha scope](docs/product/core-alpha-scope.md).

## Course creation and acquisition

**Approved Core Alpha target**

Two paths are required and produce the same validated Course model:

1. **Embedded authoring:** create a local Draft manually or through the optional restart-safe guided Course Designer, then follow Initial Brief -> Discovery -> optional Diagnostic -> Course Proposal -> explicit User Review -> Compilation -> deterministic Validation/Repair -> learner-safe Preview -> Change review -> explicit Publish. Proposal confirmation or Apply never publishes.
2. **External authoring:** download the self-contained, commit-pinned Authoring Kit skill and follow the same discovery/proposal/review lifecycle with any chosen external model. After explicit proposal approval, the model emits a hashless declarative Authoring Draft; Aptiloop derives runtime requirements, canonicalizes and hashes it locally, applies the same validation and learner Preview, then requires explicit immutable Install or Open as local Draft.

Manual authoring must be complete without AI. An AI proposal can change only a draft and can never publish, install, run checks, or grant permissions. Aptiloop intentionally ships without bundled Courses: a fresh profile starts empty, and the learner creates a personal Course or explicitly imports a trusted Course Pack. Repository fixtures remain development evidence only. Any future first-party or sample Course requires separate content, provenance, safety, licensing, and ownership approval.

See [Course authoring](docs/product/course-authoring.md).

## Privacy

**Approved Core Alpha target**

- Local storage is the default for Course material, source snapshots, knowledge capsules, learner state, evidence, mistakes, mastery, transcripts, workspaces, and credentials.
- Private data is never uploaded, synchronized, published, or shared without an explicit user action that identifies the destination and payload.
- External-provider use is opt-in and shows what context is sent. Failure is explicit; a real provider never silently falls back to Mock.
- Mock is for tests, CI, and development only. It is not a production learning provider or a substitute for a failed configured provider.
- Course Packs exclude credentials, private learner state, provider sessions, absolute local paths, and arbitrary runtime authority.

## Language and locale

**Approved Core Alpha target**

The interface supports `en-US` and `ru-RU`. UI locale is independent from a Course's one required primary locale. Optional Course translations are explicit resources; they do not change identifiers, graph semantics, evidence types, code, or trusted check IDs. Retained Russian development Course content and historical documents are not application-string fallbacks or production Course localization evidence.

**Implemented baseline**

Course creation keeps the primary Course locale as explicit Draft metadata. The manual and assisted creation forms offer a localized common-locale selector plus a validated custom BCP 47 path; neither form derives or mutates the Course locale from the local interface preference.

See [Language policy](docs/product/language-policy.md) and [Terminology](docs/product/terminology.md).

## Non-goals

**Approved Core Alpha target**

- cloud accounts, collaboration, classrooms, organizations, permissions, sync, or multi-user state;
- a marketplace, public publishing service, or production course catalog;
- an embedded IDE, terminal, general shell, or arbitrary command runner;
- autonomous edits or Reviewer-applied patches;
- arbitrary AI filesystem, shell, network, credential, or plugin access;
- open-ended agent autonomy or model-owned learning decisions;
- silent provider substitution;
- mobile-native applications;
- PostgreSQL deployment in Core Alpha, while preserving PostgreSQL-compatible boundaries;
- arbitrary executable Course Pack hooks, scripts, or plugins;
- claims of technical correctness without an approved evidence path.

## Future

- multi-user and synchronized deployments;
- a public Course Pack ecosystem or marketplace;
- organization administration and instructor analytics;
- additional UI locales beyond `en-US` and `ru-RU`;
- hosted provider brokerage;
- PostgreSQL operation after the persistence boundary is proven;
- mobile-native clients;
- optional first-party or sample Course distribution after separate content, provenance, safety, licensing, and ownership approval.

## Implemented baseline

The runnable repository now carries the Aptiloop package and product identity. M1–M11 are an **Implemented baseline** around the established vertical slice: strict Course/revision/Activity/source/capsule/adaptation/session/evidence contracts; immutable Course Pack V1 validation, Preview, transactional install/open-as-draft, canonical export and preserved-history uninstall; append-only replay-complete Learning Kernel facts and deterministic projections; finite app-owned trusted local Execution Fabric; the constrained Provider Hub and typed role policies; complete `en-US`/`ru-RU` application catalogs; the closed Activity Frame registry; Adaptive Studio; and Course/session cutover with retained compatibility data.

M10 resolves the `course-designer` RoleProfile through Provider Hub, projects only the selected Draft plus explicitly approved source records, exposes only the finite app-owned Course Designer tools, validates one typed stable-ID proposal, and records provider/model/prompt/source attribution and deterministic validation diagnostics. Proposal revision, rejection, confirmation, Apply, and failed-state recovery are explicit persisted operations; only the separate Preview/Change review/manual Publish gate can transition to `PUBLISHED`. M11 removes the global learner pointer from target reads and writes, permits one active session per Course, preserves exact Course/revision context for side effects, freezes v1 mutations, retires the hardcoded dashboard, and retains historical data and compatibility storage without destructive rewriting. This baseline is not the complete Core Alpha product: artifact-specific legal review and release evidence remain later gates. User-authored and explicitly imported Course content is the normal product path, not a missing release artifact.

The current web experience implements the Calm Workshop shell with five primary destinations, a stable desktop rail and mobile bottom navigation, entity-aware breadcrumbs, responsive light/dark layouts, URL-restored route state where specified, visible focus, semantic structure, and reduced-motion handling. This is implementation evidence, not complete WCAG 2.2 conformance or release acceptance.

The dated 2026-08-12 UI/UX/runtime hardening and 2026-08-13 production-readiness polish are an **Implemented baseline**. Pending-disclosure recovery for Course Designer and Interview has integration and component-remount evidence only. Course Designer recovery-preview freshness remains narrower than Interview recovery and is documented in the Provider Hub boundary. A fresh authenticated OpenCode Zen Tutor request was observed on the production-readiness working tree; it is not evidence for commit `b542b32` or for the unexercised roles/recovery paths.

Due-review scheduling, due reasons, evidence provenance, and the typed Review-surface executor are implemented. The server resolves one opaque execution identity to the exact Course/revision/session snapshot, persists the learner's bounded free response as participation evidence without asserting correctness or mastery, completes the exact due cycle, and creates a deterministic successor. Source-session identity remains provenance and is never exposed as a fabricated `/session` shortcut.

The M12 technical preflight recorded on 2026-08-10 is dated historical **Implemented baseline** evidence for the tree reviewed at that time, not evidence for later changes or release acceptance. That run covered clean install, fast verification, 4/4 E2E, loopback local-process/Compose launches, non-overwriting backup/restore/rollback, trusted Node/Python checks, SBOM/dependency policy, distribution-content inspection, responsive browser QA, hosted CI, and an authenticated OpenCode Zen smoke without fallback. The public source repository is licensed under Apache-2.0 but remains distinct from a tagged Core Alpha release. Third-party notices, content/fixture terms, trademark review, artifact authorization, and owner sign-off remain release gates.

## Approval gates

**Approved Core Alpha target**

The Core Alpha release cannot be called accepted or published until all applicable gates are closed with evidence:

1. product terms, scope, journeys, and language policy;
2. domain and persistence contracts, additive migration, rollback, and representative-data rehearsal;
3. Course Pack schema, validation, provenance, and hostile-input handling;
4. Learning Kernel ownership and deterministic replay;
5. execution environments and trusted check contracts;
6. Pi/provider capability, credential, typed-tool, and no-fallback boundaries;
7. privacy and security threat controls;
8. manual-first Adaptive Studio and publish gates;
9. responsive, accessible `en-US`/`ru-RU` experience;
10. clean dependency audit or documented approved exceptions;
11. third-party licensing, content provenance, notices/SBOM, and trademark review;
12. passing fast verification, E2E, migration rehearsal, and required runtime smokes.

**Approved Core Alpha target**

Use the Calm Workshop visual direction while retaining Geist Sans/Mono and the current semantic OKLCH foundation.

**Implemented baseline**

Copyright 2026 Yan Yushkov (`nayvok`). First-party repository materials that the copyright holder has authority to license are available under Apache-2.0, unless a file or directory states otherwise. User/imported Courses, private data, credentials, exports, and third-party components are outside that project grant. No proprietary Aptiloop module exists; any future proprietary module must be new and clearly separate.
