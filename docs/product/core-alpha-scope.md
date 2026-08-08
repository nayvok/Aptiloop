# Core Alpha Scope

## Document status

**Approved Core Alpha target** for product scope. This document defines what Core Alpha must prove after M0. It is not an implementation claim.

Status labels used throughout the specification set:

- **Implemented baseline**
- **Approved Core Alpha target**
- **Proposed pending owner approval**
- **Future**

## M0 boundary

**Implemented baseline**

M0 is documentation, audit, and approval preparation on `docs/core-alpha-audit`. The runnable code remains Dev Learning Harness. Current package names, hardcoded Russian UI, legacy routes, bundled curriculum, Curriculum Editor, provider adapters, and data model have not been renamed or migrated to Aptiloop.

The current baseline has valuable seams to preserve incrementally: Next.js → Hono boundaries, strict shared contracts, SQLite repositories and migrations, versioned curriculum revisions, immutable learning-session snapshots, deterministic learning-core rules, typed unit evidence, isolated exercise attempts, allowlisted tests, Git-diff freshness, read-only review, and restart-safe flows.

The baseline is not Core Alpha-compliant merely because a similar workflow exists. In particular, Course Packs, a Course top entity, personal adaptations, Source Snapshots, Knowledge Capsules, Pi typed-tool policy, general Execution Fabric, Node/Python environment contracts, complete locale separation, target navigation, and Adaptive Studio do not yet exist.

## Objective

**Approved Core Alpha target**

Prove a complete local-first learning loop for one user and one installed Course without depending on cloud accounts, a production course catalog, autonomous coding agents, or arbitrary executable content.

Core Alpha succeeds when a user can create or import a safe declarative Course, publish an immutable revision, learn through its finite activity graph, complete a trusted practice/review/correction cycle, resume after restart, and inspect deterministic evidence and mastery while retaining explicit control over private data and optional AI.

## Product constraints

**Approved Core Alpha target**

1. Local-first, single-user operation.
2. SQLite is the active store. Domain and repository boundaries remain compatible with a later PostgreSQL implementation.
3. `Course` is the top-level entity.
4. Published Course Revisions are immutable.
5. Personal changes occur on a learner-owned Adaptation Branch.
6. Every runnable revision is a finite Activity Graph.
7. The deterministic Learning Kernel owns state, mastery, review scheduling, evidence reduction, and next-action selection.
8. Course material is represented by Source Snapshots and Knowledge Capsules with provenance.
9. Course Packs are declarative, versioned, bounded, validated, and non-executable.
10. No production Course is included in Core Alpha; development fixtures are not release content.
11. UI locale supports `en-US` and `ru-RU` and remains independent of one primary Course locale.
12. Pi is only a model/runtime layer behind app-owned typed tools and policies.
13. No AI role receives arbitrary filesystem, shell, network, credential, or edit tools.
14. Reviewer is read-only and cannot return or apply a patch through a mutation path.
15. Execution uses a generic app-owned fabric, trusted check IDs, and declared Node or Python environment contracts.
16. A real-provider failure is explicit. It never silently falls back to Mock.
17. Mock is restricted to tests, CI, and development.
18. Private data never leaves the device without an explicit user action that identifies payload and destination.

## In scope

### Course lifecycle

**Approved Core Alpha target**

- Create a Course in Adaptive Studio.
- Import a declarative external Course Pack as untrusted data.
- Use the version-matched Authoring Kit for external manual or AI-assisted Course Pack creation; Kit and importer share schemas, validation codes, canonical hashes, and no-execution rules.
- Validate schema, references, graph structure, locale declarations, sources, content hashes, environments, and trusted check IDs.
- Preview before installation or publication.
- Publish a draft as an immutable Course Revision.
- Clone a published revision for a new source revision.
- Create and maintain a personal Adaptation Branch without mutating the source revision.
- Export an explicitly selected Course Pack without credentials or learner-private data.
- Show provenance, validation result, compatibility requirements, revision identity, and content hash.

### Learning lifecycle

**Approved Core Alpha target**

- Choose an installed Course and resume or start its next activity.
- Resolve a deterministic next action from graph state and prerequisites.
- Record first attempt before revealing protected feedback or strong hints.
- Support bounded content, recall, explanation, assessment, code-reading, practice, trusted checks, read-only review, correction, summary, and spaced-review activity contracts needed by the complete journey.
- Preserve immutable session/revision context so later course changes do not rewrite prior evidence.
- Derive summary, mistakes, review items, and mastery from persisted facts.
- Resume safely after application restart.
- Expose evidence provenance and the difference between deterministic results and optional model observations.

### Execution lifecycle

**Approved Core Alpha target**

- Create an isolated learner-owned workspace from a trusted installed environment/template definition.
- Keep Course Pack data separate from executable runtime configuration.
- Resolve only app-owned trusted check IDs to fixed `shell: false` process plans.
- Support declared Node and Python environment contracts.
- Bound path access, inherited environment, runtime, output, cancellation, and cleanup.
- Use the typed embedded editor for bounded declared document sets and an app-owned external-editor adapter for larger workspaces; neither path grants browser command authority.
- Capture complete, non-truncated diff/test evidence and bind review to its fingerprint.

### Optional AI lifecycle

**Approved Core Alpha target**

- Configure provider and model explicitly per Aptiloop-owned role.
- Use Pi packages only behind Aptiloop-owned typed tools, validation, policy, storage, and redaction.
- Support Course Designer, Tutor, Evaluator, and Reviewer as application roles, not Pi domain types.
- Run the full manual learning and authoring paths when AI is disabled or unavailable.
- Display provider/model provenance and the context to be sent before private data is shared externally.
- Keep provider failure and credential failure explicit.

### Product experience

**Approved Core Alpha target**

- Primary navigation: Home, Courses, Review, Skills, Settings.
- Responsive desktop and mobile experiences with no overfull navigation or horizontal overflow.
- Honest loading, empty, offline, no-AI, missing-Core, validation, permission, and provider-failure states.
- `en-US` and `ru-RU` interface catalogs.
- One primary locale per Course and explicit optional translations.
- Keyboard operation, visible focus, semantic structure, reduced motion, light/dark themes, and WCAG 2.2 AA target.

## Required end-to-end journey

**Approved Core Alpha target**

Core Alpha is incomplete unless this journey works as one integrated path:

1. Launch locally with no account and see Core, storage, filesystem, environment, and optional AI readiness separately.
2. Choose guided or manual creation, or import a Course Pack produced with the Authoring Kit.
3. Create/import a Course with primary locale, stable identity, sources, capsules, finite activities, and declared environment/check references.
4. Validate the complete draft. Unsafe, incompatible, unresolved, cyclic, unknown, or required AI-only definitions fail closed with exact locations.
5. Preview learner experience, review revision/hash/requirements, and explicitly publish or install.
6. Start the Course from Home. The Learning Kernel chooses the next ready activity.
7. Complete an unaided first attempt before protected feedback or strong hints.
8. Perform a practical task in an isolated workspace using the bounded embedded editor or an app-owned external-editor handoff according to the Activity contract.
9. Run only the selected trusted check ID. The system records bounded result evidence.
10. Request Reviewer analysis of the current complete diff and matching passed check. Reviewer remains read-only.
11. If changes are requested, edit independently, run a fresh check, and request a fresh review.
12. Complete the activity/day summary and inspect deterministic evidence, mistakes, mastery changes, and scheduled review.
13. Restart the application and resume without changing revision, graph, first-attempt, or workspace evidence.
14. Complete a due review and observe deterministic state update.
15. Export or share nothing unless an explicit action identifies exactly what leaves the device.

The companion [User journeys](user-journeys.md) defines normal, recovery, authoring, privacy, and provider variants.

## Explicit non-goals

**Approved Core Alpha target**

- public hosting, accounts, synchronization, collaboration, organizations, classrooms, or role-based access;
- a Course marketplace, public publishing service, or production Course library;
- full IDE, terminal UI, general shell endpoint, arbitrary filesystem browser, or arbitrary commands from packs/browser/models; the bounded typed embedded editor is explicitly in scope;
- model-owned mastery, progression, evaluation truth, or review schedule;
- autonomous agent changes, Reviewer patches, or automatic solution application;
- silent real-provider → Mock fallback;
- PostgreSQL runtime operation in Core Alpha;
- native mobile applications;
- executable Course Pack scripts, commands, plugins, migrations, or secrets;
- ingesting private data by default;
- treating current development content as a supported Course.

## Future

- multi-user and synchronized deployments;
- hosted services and organization administration;
- public Course discovery, marketplace, signatures, and publisher reputation;
- instructor cohorts and analytics;
- PostgreSQL deployment;
- more UI locales and translation collaboration;
- mobile-native clients;
- production Courses after provenance, quality, safety, licensing, and ownership gates.

## Readiness and approval gates

Core Alpha is not approved until evidence closes all of these gates:

| Gate | Required evidence |
| --- | --- |
| Product | Scope, terminology, journeys, non-goals, and privacy are approved and internally consistent. |
| Course model | Course/revision/adaptation/activity/source/capsule contracts and invariants are implemented and replayable. |
| Pack safety | Hostile and malformed inputs fail closed; no executable authority or secrets cross the pack boundary. |
| Learning Kernel | Deterministic replay reproduces state, mastery, mistakes, and review schedule from complete evidence. |
| Migration | Candidate DB inventory, verified backup, additive migration, quarantine, reconciliation, rollback, and representative-data rehearsal pass. |
| Execution | Node and Python contracts, trusted check registry, workspace isolation, bounds, cleanup, and fingerprinted evidence pass. |
| Runtime/provider | Typed Pi tools, role policy, auth resolution, secret redaction, cancellation, and explicit no-fallback behavior pass. |
| Security/privacy | Threat controls, private-data disclosure consent, origin/path/process/provider boundaries, and dependency policy pass. |
| Studio | Manual authoring is complete; typed AI proposals are optional; validate/preview/apply/publish are separate gates. |
| Localization | `en-US` and `ru-RU` UI plus independent Course locale behavior pass on desktop and mobile. |
| Quality | Fast verification, E2E, migration rehearsal, and required local/provider/editor smokes pass. |
| Legal | Project/content/package license boundaries, provenance, notices/SBOM, trademarks, and counsel review are approved. |

## Core Alpha release matrix

**Approved Core Alpha target**

All 50 gates below are release-blocking and are fixed before implementation approval. M12 must attach observed evidence to every row. A missing, failed, stale, inferred, or mock-only result does not close a gate. A proposed deferral changes the approved release scope and therefore requires a new explicit owner decision; it is not an implicit waiver.

| # | Release gate | Milestone | Required closing evidence |
| ---: | --- | --- | --- |
| 1 | Application launches without critical errors. | M12 | Clean local-process and loopback-Compose launch smoke with no critical browser/Core/runtime errors. |
| 2 | English UI works. | M7/M12 | Complete `en-US` catalog and required journeys verified without missing/mixed system strings. |
| 3 | Russian UI works. | M7/M12 | Complete `ru-RU` catalog and required journeys verified without missing/mixed system strings. |
| 4 | Mobile layouts work. | M7–M10/M12 | Required screens and supported workflows pass at 320px and representative 390×844 viewports without horizontal overflow. |
| 5 | Theme modes work. | M7–M10/M12 | Light, dark, and system modes preserve hierarchy, contrast, state, and persistence. |
| 6 | Type checking, linting, formatting, and builds pass. | M1/M12 | Committed CI and clean candidate run pass the documented quality commands. |
| 7 | E2E tests pass. | M1/M12 | Every supported end-to-end scenario passes on the release candidate. |
| 8 | Migrations pass on old local data. | M2/M11/M12 | Inventory, verified backup, additive upgrade, reconciliation, rollback/restore, and representative old-data rehearsal pass. |
| 9 | Lesson flow works. | M4/M8 | Finite graph start/resume/next/complete path passes with kernel-owned transitions. |
| 10 | First attempt is preserved. | M4 | Replay and DTO tests prove immutable unaided first-attempt capture before protected help. |
| 11 | Tutor works. | M6/M8 | Bounded Tutor dialogue plus manual fallback passes; model output cannot complete or mutate learning state. |
| 12 | Quiz works. | M4/M8 | Protected scoring, retry history, criteria, and evidence transitions pass. |
| 13 | Code reading works. | M4/M8 | Prediction/explanation response, protected feedback, and typed evidence pass. |
| 14 | Recall works. | M4/M8 | Unaided response, delayed protected answer, revision evidence, and deterministic transition pass. |
| 15 | Explanation works. | M4/M8 | Learner-authored explanation and deterministic/manual completion evidence pass. |
| 16 | Summary works. | M4/M8 | Summary is reproduced from persisted facts and distinguishes observations from authority. |
| 17 | Checkpoint works. | M4/M8 | Visible criteria, locked/failed links, and kernel-owned gate transition pass. |
| 18 | Spaced review works. | M4/M8 | Due reason, prior evidence, completion, and deterministic rescheduling pass. |
| 19 | Code workspace works. | M5/M8 | Opaque attempt workspace, embedded/external editor mode, bounded documents, save, diff, and resume pass. |
| 20 | External editor flow works. | M5/M8 | App-owned launch/argv plus copy/manual fallback passes without browser-controlled executable or path authority. |
| 21 | Trusted checks run. | M5 | Known immutable check IDs resolve to exact app-owned process plans; unknown/forged IDs fail closed. |
| 22 | Test output is visible. | M5/M8 | Bounded stdout/stderr and structured results render with truncation/status semantics and no secret leakage. |
| 23 | Full diff is captured. | M5 | Complete baseline/current diff and digest pass changed-content/same-mtime and truncation-negative tests. |
| 24 | Reviewer receives correct context. | M5/M6 | Exact revision/activity/capsule, full diff, fresh check, provider/model, and evidence fingerprint are recorded. |
| 25 | Reviewer never edits code. | M5/M6 | Tool-policy and before/after workspace hashes prove zero patch/write/process authority. |
| 26 | Correction cycle works. | M4/M8 | Changes-requested keeps activity open; learner edit → fresh check → fresh review → completion passes. |
| 27 | Corrections are rechecked. | M4/M5 | Stale prior check/review is rejected after any edit; new fingerprints are required. |
| 28 | Node.js environment works. | M5 | Versioned Node Environment Pack happy/failure/limit/cleanup contract suite passes on supported systems. |
| 29 | Python environment works. | M5 | Versioned Python Environment Pack happy/failure/limit/cleanup contract suite passes on supported systems. |
| 30 | Multiple environment types coexist. | M5 | Node and Python packs resolve independently without ID, cache, workspace, or result collisions. |
| 31 | Missing runtime errors are understandable. | M5/M7 | UI names exact environment/version/capability, reason, safe setup action, and retained learner state. |
| 32 | Broken execution fails gracefully. | M5/M8 | Spawn failure, timeout, cancellation, result corruption, output cap, and cleanup retain deterministic recoverable state. |
| 33 | Evidence is stored. | M2/M4 | Typed append-only evidence has operation ID, provenance, revision/activity linkage, clock, and idempotency. |
| 34 | Mastery updates deterministically. | M4 | Same immutable revision/snapshot/prior facts/clock produce byte-equivalent mastery output. |
| 35 | Skills show evidence basis. | M4/M7 | Topic dimensions link to source activities/evidence and never count unvalidated interview observations. |
| 36 | Mistakes are extracted. | M4 | Mistake projection is replayable from accepted evidence with repeated-error facts preserved. |
| 37 | Review schedule is created. | M4 | Due items and dates replay deterministically from complete evidence and observed clock. |
| 38 | Flashcards are generated. | M4 | Candidate cards derive from approved facts, require learner approval where specified, and export explicitly. |
| 39 | Real provider works. | M6/M12 | At least one explicitly configured supported real provider completes an authenticated typed role smoke with provenance and no fallback. |
| 40 | Mock is not used silently. | M1/M6 | Failure tests prove real-provider/auth/model/tool errors remain explicit and never select Mock. |
| 41 | No-AI mode works. | M6/M9/M12 | Clean run completes required authoring and learning paths with AI Off. |
| 42 | Model failure is understandable. | M6/M7 | UI names role/tool/provider/model/failure layer, preserves input, and offers only explicit safe choices. |
| 43 | Provider auth is understandable. | M6/M7 | Missing/invalid credential and ownership source are explained without exposing secrets or borrowing other credentials. |
| 44 | Runtime setup guidance works. | M5/M7 | Settings diagnostics and exact non-secret recovery actions pass for Node, Python, editor, Core, and storage states. |
| 45 | Course can be created manually. | M9 | AI-Off typed authoring reaches valid Preview, Change review, explicit Publish, immutable history, and clone. |
| 46 | Course can be imported. | M3 | Version-matched Authoring Kit JSON passes non-executing validation, Preview, explicit Install/Open-as-draft, canonical hash, and atomic rollback tests. |
| 47 | Published revisions are immutable. | M2/M9 | Database guards, APIs, Studio read-only state, clone, and negative mutation tests pass. |
| 48 | Personal adaptation remains separate. | M2/M9 | Source revision/evidence hashes remain unchanged through branch edit, personal publish, and explicit upstream integration. |
| 49 | Security boundary checks pass. | M1–M6/M12 | AI/tool, secret, pack, path, process, loopback, privacy, dependency, and disclosure control suites pass with no unresolved High finding. |
| 50 | Self-hosted security check is completed. | M12 | The exact supported loopback local-process/Compose topology passes bind, data-volume, secret, backup/restore, execution-label, and operator-runbook review; public/LAN deployment remains unsupported. |

## Current gate evidence

**Implemented baseline**

`npm run verify` passed during M0, but `npm run test:e2e` did not: 1 passed, 3 failed. The dependency audit reported 4 high, 1 moderate, and 1 low vulnerability. No CI workflow is committed. Current licensing is unresolved. Therefore M0 is not a Core Alpha release or implementation approval.

**Proposed pending owner approval:** visual direction A, Calm Workshop. Licensing recommendations remain pending owner approval and legal review.
