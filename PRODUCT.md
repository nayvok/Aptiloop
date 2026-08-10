# Aptiloop Product Contract

## Document status

This is the product-level contract for the Core Alpha audit. It distinguishes the runnable Dev Learning Harness from the Aptiloop target and does not assert that migration has happened.

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

1. **Embedded authoring:** create a local Draft manually or through the optional restart-safe guided Course Designer, edit in Adaptive Studio, validate, Preview, complete Change review, and explicitly Publish an immutable revision. Guided confirmation or proposal Apply never publishes.
2. **External authoring:** use the version-matched Authoring Kit with any text editor or external AI generator to produce one declarative Course Pack JSON document, validate/canonicalize it locally, then import it into Aptiloop for the same schema/safety validation, learner Preview, and explicit immutable installation or local Draft creation.

Manual authoring must be complete without AI. An AI proposal can change only a draft and can never publish, install, run checks, or grant permissions. No production course ships as part of Core Alpha; repository fixtures remain development evidence only.

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

The interface supports `en-US` and `ru-RU`. UI locale is independent from a Course's one required primary locale. Optional Course translations are explicit resources; they do not change identifiers, graph semantics, evidence types, code, or trusted check IDs. Current Russian documentation and hardcoded UI are migration findings, not proof of locale compliance.

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
- production course distribution after content, provenance, safety, and licensing gates are approved.

## Implemented baseline

The runnable repository remains Dev Learning Harness. M1–M5 are an **Implemented baseline** around the established vertical slice: strict Course/revision/Activity/source/capsule/adaptation/session/evidence contracts; immutable Course Pack V1 validation, Preview, transactional install/open-as-draft, canonical export and preserved-history uninstall; append-only replay-complete Learning Kernel facts and deterministic projections; and finite app-owned trusted local Execution Fabric with compatibility Node plus Core Node/Python contracts. The M6 **Implemented baseline** adds exact-version constrained Pi dependencies, server-owned Provider Hub/RoleProfile/capability/failure contracts, active role caller cutover, finite app-owned typed role policies, exact one-time disclosure UI, cumulative budgets, immutable disclosure operations/events, and minimized provider-turn provenance.

This baseline is not the complete Core Alpha product. M6 routes active learning chat, interview, and evidence-only review through persisted Provider Hub RoleProfiles; exact one-time disclosure UI, common cumulative AI budgets, and private-context/environment plus per-role adversarial matrices are implemented. M6 acceptance is evidenced by an authenticated OpenCode Zen `deepseek-v4-flash-free` request through constrained Pi, exact disclosure consumption, persisted minimal provider/model provenance, and observed cancellation using synthetic text in a disposable database. This evidence does not establish general production provider readiness. Manual target Course authoring and personal-adaptation application in Adaptive Studio, approved production Source Snapshot/Capsule content, complete UI locale separation, target navigation/identity, third-party environment review, licensing decisions, and release evidence remain later gates.

## Approval gates

Core Alpha cannot be called approved or implemented until all applicable gates are closed with evidence:

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
11. project/content/third-party licensing and legal review;
12. passing fast verification, E2E, migration rehearsal, and required runtime smokes.

**Approved Core Alpha target:** use the Calm Workshop visual direction while retaining Geist Sans/Mono and the current semantic OKLCH foundation. The engineering licensing direction is approved, but license application and public distribution remain deferred pending professional legal review; no license is granted by this document.
