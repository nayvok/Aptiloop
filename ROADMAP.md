# Aptiloop Core Alpha Roadmap

**Status:** Proposed pending owner approval
**Audit date:** 2026-08-08
**Scope:** M0–M12 planning only; this document does not authorize implementation

## Roadmap rules

1. **Implemented baseline** describes behavior observed in the current Dev Learning Harness. It is not evidence that the Core Alpha target exists.
2. **Approved Core Alpha target** means the non-negotiable target contract captured in the Core Alpha specification set; execution still follows the milestone gates below.
3. **Proposed pending owner approval** identifies choices that require the repository owner's approval before implementation.
4. **Future** identifies work outside Core Alpha.
5. Every milestone must leave a runnable local vertical slice. Migration is additive and incremental; no big-bang rewrite is permitted.
6. SQLite remains the Core Alpha store. New persistence boundaries must remain compatible with a later PostgreSQL adapter, without adding PostgreSQL to Core Alpha.
7. A failed or unavailable real provider is an explicit state. It must never silently become Mock. Mock is restricted to tests, CI, and explicit development flows.
8. No Course Pack may contain or invoke commands, scripts, secrets, plugins, arbitrary tools, or provider credentials. Core Alpha ships no production courses.
9. Pi is a model/runtime dependency behind Aptiloop-owned typed tools. Pi does not own product roles, learner state, course state, permissions, or the deterministic Learning Kernel.
10. Private learner data remains local and is never uploaded or shared without an explicit user action.

## Ordering rationale

The order reduces the highest observed risks before expanding capability: provider tool authority, secret inheritance/persistence, dependency advisories, ambiguous databases, and lossy mastery replay precede new AI or Studio features. Additive Course and revision boundaries precede Course Pack import. A manual, fully capable Studio precedes AI proposals. The existing versioned learner flow remains runnable while callers migrate one vertical slice at a time.

---

## M0 — Repository audit and owner approval gate

**Status:** Implemented baseline — audit artifacts and owner decisions were recorded on 2026-08-08.

- **Objective:** Establish one evidence-based baseline, one coherent Core Alpha contract, and explicit owner decisions before product migration, redesign, or licensing changes.
- **Scope:** Central 17-part audit; target specifications; ADRs; M0–M12 roadmap; exact verification record; design alternatives; migration, security, runtime, and licensing plans.
- **Non-goals:** Production code, schema changes, dependency changes, UI changes, tests, course content, license texts, or public release.
- **Migrations:** None. Historical Russian documentation and Superpowers artifacts remain untouched and are classified for later migration or archival.
- **Tests:** No commands are run for M0 documentation. Evidence is the recorded 2026-08-08 baseline: `npm run verify` passed, while `npm run test:e2e` passed 1/4 and `npm audit` reported six vulnerabilities.
- **Docs:** All documents linked from the [central repository audit](docs/audits/2026-08-08-core-alpha-repository-audit.md), including product, architecture, design, security, migration, self-hosting, licensing, and ADR sets.
- **Demo:** Owner review of the audit, target architecture, roadmap, three visual directions, and licensing recommendation.
- **Acceptance:** The repository owner explicitly approves or rejects the Core Alpha target, roadmap/order, recommended visual direction, migration plan, and licensing direction; every owner/business licensing decision in the licensing register has a recorded disposition or explicit deferral that keeps the affected release channel/artifact out of scope pending counsel review.
- **Known limitations:** Target behavior is specified but not implemented. The current app remains Dev Learning Harness, Russian-first, legacy-compatible, and security-incomplete.
- **Rollback/compatibility:** Documentation-only. Rejection changes the proposal, not runtime behavior or stored data.

## M1 — Safety, provenance, and repeatable quality gate

**Status:** Approved Core Alpha target; M1 implementation authorized by the owner on 2026-08-08.

- **Objective:** Make the existing vertical slice safe enough to serve as the migration base and make verification repeatable before adding capability.
- **Scope:** Deny general provider filesystem/shell/network/edit tools for every learning role; minimize child environments; stop raw tool input/output persistence; inventory existing `agent_messages.tool_events_json`, SQLite WAL, application-managed backups, restores, exports, SSE, and logs; record an owner-approved preserve/redact/delete/quarantine disposition for sensitive legacy rows and copies; validate loopback-only bind; inventory current v1 callers and freeze externally reachable deterministic-integrity bypass writes without deleting history; fix or explicitly approve dependency advisories; add committed CI for install, audit policy, format, lint, typecheck, fast tests, E2E, and build; generate a private-data inventory and candidate-DB report.
- **Non-goals:** Pi integration, Course Packs, new IA, Studio redesign, PostgreSQL, remote access, or a production course.
- **Migrations:** No unrelated destructive DB migration. Inventory each configured, `.data`, and `data` SQLite candidate without merging it. Apply only the approved targeted cleanup to legacy raw tool events and their WAL/application-managed backup copies, retaining a bounded audit envelope and disposition record rather than sensitive payloads. Cleanup runs before a backup is approved and is re-applied/verified after restore. Create verified non-overwriting backups only from a cleaned candidate before any later data change.
- **Tests:** Adapter role-policy matrix; prompt-injection attempts proving no file/shell/network calls; seeded nested, encoded, and split secret sentinels proving absence from child environments, API/SSE, logs, SQLite, WAL, application-managed backups, restore results, and exports; legacy cleanup idempotency and disposition accounting; non-loopback bind rejection; v1 write-route rejection with historical reads preserved; dependency policy; the full existing vertical slice including all four E2E scenarios.
- **Docs:** Update approved security, AI-boundary, secrets, self-hosting, and verification procedures. Record advisory IDs, reachability, exceptions, owner, and expiry where a fix is unavailable.
- **Demo:** Run Day 1, Curriculum Editor, Interview, and theme flows with Mock explicitly selected for development; show a real-provider failure remaining explicit; show that injected tool requests cannot mutate the repository.
- **Acceptance:** All four E2E scenarios pass; no unapproved high/critical production advisory; no general AI tool authority; every existing raw tool-event row/copy has an approved, reconciled disposition; no sentinel secret remains in API/SSE, SQLite, WAL, logs, approved backups, restores, or exports; OpenCode learning roles and backup approval remain blocked until that record closes; no externally reachable write path bypasses deterministic evidence; CI reproduces the gate.
- **Known limitations:** The product is still the legacy UI/data model. Trusted exercise execution is not a sandbox. External providers remain optional and are not required to pass the deterministic learner path.
- **Rollback/compatibility:** Security restrictions are fail-closed. Existing provider settings remain readable, but unsupported tool-capable behavior is not preserved. CI can be reverted independently without changing user data.

## M2 — Additive Course, revision, activity, and evidence foundations

**Status:** Approved Core Alpha target; implementation proposed pending owner approval.

- **Objective:** Introduce the target domain boundaries while preserving the working versioned session flow.
- **Scope:** Course as the top entity; immutable Course Revision; finite Activity graph; Source Snapshot and Knowledge Capsule; Personal Adaptation Branch; typed Evidence and Review Item; stable IDs; explicit course/revision/activity ownership; SQLite repository ports with PostgreSQL-compatible boundaries.
- **Non-goals:** Pack archive import, redesign, AI authoring, multi-user identity, cloud sync, or removal of legacy tables/routes.
- **Migrations:** Add target tables or compatibility views plus source-to-target provenance and quarantine records. Deterministically map existing `curricula`, versions, weeks/days/units, snapshots, and evidence without deleting or rewriting source rows. Preserve immutable session snapshots and hashes.
- **Tests:** Pristine and real-old-schema fixtures; empty/malformed/partial-marker cases; multi-course and multi-revision isolation; cross-course/revision/activity negative constraints; idempotent backfill; snapshot immutability; quarantine; backup restore; SQLite foreign-key and explicit orphan checks.
- **Docs:** Keep Course Pack, Lesson Engine, Learning Kernel, Knowledge System, and migration specifications aligned with the implemented schema boundary.
- **Demo:** Open the existing learner path and resume an existing session through target read models; inspect course/revision/activity provenance and an unchanged historical snapshot.
- **Acceptance:** Every mapped row has provenance or an explicit quarantine reason; no historical content/evidence hash changes; two courses can coexist without global selection loss; the current learner vertical slice remains runnable.
- **Known limitations:** Compatibility legacy rows and global-current assumptions may still exist behind bounded adapters. Only SQLite is implemented.
- **Rollback/compatibility:** Additive migration only. Pre-migration verified backup is the rollback. Dual-read comparison remains available; no legacy table or column is dropped.

## M3 — Declarative Course Pack lifecycle

**Status:** Approved Core Alpha target; implementation proposed pending owner approval.

- **Objective:** Let a user validate, inspect, install, export, and open a safe declarative Course Pack without executing content.
- **Scope:** Versioned single-file JSON manifest/schema; canonical serialization and hash; locale, provenance, attribution/license, runtime requirements, finite graph, Source Snapshots, and Knowledge Capsules; byte/count/depth/parse limits; transactional import; quarantine and validation report; install/open/export for local user-selected packs; an Authoring Kit with versioned schema, typed definitions, templates, fixture, local validator, canonicalizer/hash command, packaging/import instructions, compatibility matrix, and no-execution guidance. The repository supplies development fixtures, not production courses.
- **Non-goals:** Archive or directory transport, commands, scripts, secrets, plugins, arbitrary files, provider credentials, remote marketplace, automatic downloads, or bundling/certifying a production Course.
- **Migrations:** Convert approved repository-controlled sample content to a clearly labeled development fixture only after provenance review. Imported packs create immutable revisions and never overwrite an existing revision or learner snapshot.
- **Tests:** Invalid UTF-8/JSON, duplicate keys, excess byte/depth/item/string limits, forbidden local/UNC/device/traversal/path fields, command-like or secret-shaped fields, duplicate IDs, graph cycles, dangling references, unsupported schema versions, locale gaps, license/provenance gaps, canonical Authoring Kit fixture/hash parity, idempotent import, collision behavior, and transactional rollback.
- **Docs:** Course Pack specification, Course authoring and Authoring Kit guide, untrusted-pack threat model, language policy, licensing/provenance rules, compatibility matrix, packaging/import instructions, and fixture disclaimer.
- **Demo:** Validate an invalid pack with field/path diagnostics; install a valid local fixture; open its course; export and re-import with the same canonical hash; show that embedded command-like data is rejected or inert.
- **Acceptance:** Import performs zero content-defined execution or network access; installed revisions are immutable; invalid/untrusted content cannot escape staging; no production course is presented as shipped content.
- **Known limitations:** Local filesystem import/export only. No registry, signatures, trust service, or collaborative authoring.
- **Rollback/compatibility:** Failed import leaves no partial course. Uninstall does not delete learner evidence and requires explicit confirmation. Existing seeded curriculum remains available through compatibility mapping until M11.

## M4 — Deterministic Learning Kernel and replay-complete evidence

**Status:** Approved Core Alpha target; implementation proposed pending owner approval.

- **Objective:** Make all learning state, progression, mastery, review scheduling, and summaries deterministic and fully replayable from typed evidence.
- **Scope:** Kernel-owned state transitions; complete mastery replay including successful UTC days and repeated-error counts; observed/injected clock; activity completion validators; review scheduling; correction cycle; explicit treatment of interview evidence; personal adaptation branch decisions; fact-only summaries.
- **Non-goals:** Model-authored mastery changes, opaque scoring, silent correction application, generic event sourcing infrastructure, or technical interview correctness without an approved rubric.
- **Migrations:** Backfill lossless kernel evidence where facts exist; preserve score rows as source provenance; quarantine ambiguous rows; do not invent successful days, error counts, or technical correctness.
- **Tests:** Deterministic replay from the same evidence; time-zone/day boundaries; repeated errors; two-successful-type/day cap; operation idempotency; stale evidence; revision changes; correction cycles; interview completion without false correctness/mastery; review-item transitions.
- **Docs:** Learning Kernel, Lesson Engine, Knowledge System, user journey, and terminology contracts.
- **Demo:** Rebuild one learner state from evidence and compare the fingerprint; edit a draft course without changing an active session; complete a correction cycle and observe deterministic review/mastery effects.
- **Acceptance:** Replaying persisted evidence reconstructs identical state and summaries; no provider/model output directly mutates mastery or progression; unknown or ambiguous evidence fails closed or is quarantined.
- **Known limitations:** Historical rows lacking facts remain explicitly partial. Interview technical evaluation remains absent unless separately approved and implemented.
- **Rollback/compatibility:** Dual-calculate old/new projections during rollout. Keep source evidence immutable and old projections readable until parity is proven; rollback switches readers, not evidence history.

## M5 — Generic Execution Fabric and environment contracts

**Status:** Approved Core Alpha target; implementation proposed pending owner approval.

- **Objective:** Generalize trusted exercise execution without creating an arbitrary command surface.
- **Scope:** Trusted check IDs; server-owned execution plans; isolated attempt workspaces; finite lifecycle; output/time/process caps; Node and Python Environment Pack contracts; runtime diagnostics; external editor handoff; immutable review bundles; Reviewer read-only invariant.
- **Non-goals:** Terminal UI, browser-selected executable/argv/cwd, Course Pack scripts, container sandbox promise, arbitrary language runtimes, or Reviewer patches.
- **Migrations:** Map current `commandId: "test"`, exercise attempts, Git baseline, test runs, and reviews to generic check/environment identifiers while preserving fingerprints and history.
- **Tests:** Unknown check/environment rejection; Node and Python happy/failure paths; environment/secret allowlist; traversal/symlink/reparse rejection; process timeout/cap/cancel/tree cleanup; same-mtime diff changes; truncated diff; review before/after immutability; restart/resume.
- **Docs:** Execution Fabric, Environment Packs, workspaces/editors, deployment, security isolation, and Course Pack runtime-requirement references.
- **Demo:** Run one trusted Node check and one trusted Python check by ID, review the exact immutable evidence bundle, request changes, edit manually, rerun, and obtain a new read-only review.
- **Acceptance:** Course content cannot choose a command; every process plan is app-owned and auditable; Reviewer cannot patch; Node/Python contracts are reproducible and produce normalized evidence.
- **Known limitations:** Trusted local execution retains local-user privileges unless an approved deployment adds isolation. Only Node and Python contracts are Core Alpha.
- **Rollback/compatibility:** Preserve the current test command as a compatibility-mapped trusted check. Existing attempts remain readable; no attempt directory is deleted automatically.

## M6 — Provider Hub and constrained Pi runtime

**Status:** Approved Core Alpha target; implementation proposed pending owner approval.

- **Objective:** Replace ad hoc provider selection with one explicit app-owned Provider Hub and introduce Pi only behind typed Aptiloop tools.
- **Scope:** `@earendil-works/pi-ai` and `@earendil-works/pi-agent-core` pinned integration; explicit provider/auth/model resolution; app-level Course Designer, Tutor, Evaluator, and Reviewer roles; per-role typed tool allowlists; strict input/output validation; cancellation/status; private-data disclosure gate; explicit AI Off/unavailable/failure states.
- **Non-goals:** Pi coding-agent filesystem/bash/edit/write tools; unimplemented AgentHarness v2 durability; transparent use of Pi's SQLite backend as coding-agent session persistence; provider-neutral structured assistant output claims; silent real-provider-to-Mock fallback.
- **Migrations:** Adapt existing Mock/Codex/OpenCode settings and conversations through Provider Hub contracts. Keep Aptiloop session identity in Aptiloop storage. Do not migrate old Pi WIP SQLite databases; they are unsupported by Pi v4.
- **Tests:** Resolution precedence; unavailable/misconfigured provider; failed OAuth/refresh without fallback; role/tool matrix; schema-invalid tool calls/results; cancellation; private-data upload confirmation; zero arbitrary filesystem/shell/network/edit tools; Mock restricted to tests/CI/dev.
- **Docs:** Pi runtime, Provider Hub, AI boundaries, secrets/private sources, Research Gateway, and relevant ADRs with pinned upstream evidence.
- **Demo:** Run the deterministic learner path with AI Off; opt into one configured real-provider Tutor turn; show provenance; fail the provider and observe an explicit recoverable error rather than Mock output.
- **Acceptance:** The app owns permissions, roles, state, and typed tools; no general Pi coding tools are exposed; provider choice and failure are explicit; private data crosses a provider boundary only after explicit user action.
- **Known limitations:** Pi AgentHarness v2 durable driving remains partial/stubbed upstream. Provider capabilities differ; tool schemas do not imply a generic structured assistant response format.
- **Rollback/compatibility:** Provider Hub adapters can route existing provider implementations while callers migrate. AI Off always preserves the deterministic path. No conversation/evidence deletion is part of cutover.

## M7 — Product identity, localization, and primary information architecture

**Status:** Approved Core Alpha target for IA/languages; visual direction proposed pending owner approval.

- **Objective:** Present Aptiloop as a coherent local learning product with English-first UI and complete Russian UI support.
- **Scope:** Primary navigation **Home / Courses / Review / Skills / Settings**; Aptiloop naming; UI locale catalogs for `en-US` and `ru-RU`; language selection; one primary course locale independent of UI locale; compatibility redirects; mobile navigation; honest Core/SQLite/AI/runtime states.
- **Non-goals:** Translating every imported course, changing course primary locale silently, Studio AI, decorative redesign beyond the approved direction, or removing deep links.
- **Migrations:** Extract hard-coded Russian UI strings and `ru-RU` formatting into catalogs. Preserve user locale preference. Map legacy Path/Session/Practice/Mistakes/Cards/Interview/Knowledge routes to the new IA through redirects and activity deep links.
- **Tests:** Catalog completeness; fallback and missing-key behavior; `html lang`; date/number formatting; UI/course locale independence; route redirects; keyboard/focus/landmarks; 390×844 navigation without overflow; desktop/mobile loading/empty/error/offline/Core-stopped/AI-off states.
- **Docs:** Product scope, journeys, terminology, language policy, information architecture, accessibility, and approved design direction.
- **Demo:** Switch UI between English and Russian while the same course stays in its primary locale; navigate the five primary destinations on desktop and mobile; recover from Core stopped and AI unavailable states.
- **Acceptance:** No learner-facing hard-coded Russian remains outside catalogs; both UI locales complete; course locale never changes as a side effect of UI locale; five-item primary IA works without losing existing journeys.
- **Known limitations:** Imported course translations depend on each pack. Historical docs and fixtures may remain Russian until their separate archival/provenance migration.
- **Rollback/compatibility:** Compatibility routes remain during the migration window. Legacy locale preference is mapped; route rollback does not change learner evidence or course revisions.

## M8 — Stable Activity Frame and renderer registry

**Status:** Approved Core Alpha target; implementation proposed pending owner approval.

- **Objective:** Migrate the monolithic unit UI to a stable activity contract without changing Kernel semantics.
- **Scope:** `ActivityFrame`; declarative renderer registry; context/status/accessibility/runtime/evidence/action slots; one-by-one migration of briefing, study, sources, recall, Tutor, quiz, code reading, practice, review, interview, and summary; contained code/output behavior.
- **Non-goals:** New progression rules, arbitrary Course Pack components/plugins, big-bang session rewrite, or visualizing internal implementation details to learners.
- **Migrations:** Wrap the current `UnitBody` first, then migrate renderers individually behind compatible DTOs. Exercise and linked interview become activity modes while existing deep links continue to resolve.
- **Tests:** Contract tests per activity type; protected-answer redaction; saved draft/reload; transition and completion gates; renderer missing/unsupported state; keyboard/screen-reader semantics; mobile code/output containment; visual smoke across light/dark and both locales.
- **Docs:** Activity renderer contract, Lesson Engine, user journeys, accessibility, and design-system behavior.
- **Demo:** Resume one mixed-activity lesson across reload, including practice and linked interview, on desktop and mobile; swap UI locale without losing activity state.
- **Acceptance:** Every Core Alpha activity renders through the registry; missing/invalid renderer fails safely; the Kernel remains the sole transition authority; the existing vertical lesson slice remains runnable after each renderer migration.
- **Known limitations:** Third-party renderers/plugins are prohibited. Unapproved future activity types show a supported-version error rather than executing content.
- **Rollback/compatibility:** Feature-switch per renderer to the compatibility body until parity is proven. DTOs and routes remain stable through the incremental cutover.

## M9 — Adaptive Studio manual editorial workflow

**Status:** Approved Core Alpha target; implementation proposed pending owner approval.

- **Objective:** Deliver the complete manual 70% editorial portion of Adaptive Studio before AI assistance.
- **Scope:** Pack overview; finite outline/graph; schema-driven activity editing; locale/provenance/source panels; learner Preview; validation; release history; explicit Validate → Preview → Change review → immutable Publish; parity with the Authoring Kit schemas and validators; personal Adaptation overview, branch creation/edit, divergence/impact validation, personal Publish, and explicit upstream comparison/conflict resolution into a new personal Draft.
- **Non-goals:** AI proposals, collaboration or multi-author merge protocol, automatic upstream merge/rebase, remote marketplace, bundling or certifying a production course, or editable published revisions.
- **Migrations:** Evolve the current Curriculum Editor through existing draft/clone/publish APIs; preserve immutable source/personal revisions and current session snapshots; map raw JSON fields to typed controls without discarding unsupported valid data; introduce adaptation lineage/invariant reads without rewriting historical evidence.
- **Tests:** Draft CRUD/reorder; graph validation; locale/provenance/runtime requirements; Preview parity; published read-only; clone; Publish confirmation; snapshot preservation; Authoring Kit schema/validator parity; source/personal branch isolation; upstream clean/conflict/stale-hash/cancel/merge-failure flows; proof integration creates a new personal Draft and never rewrites source/history; mobile single-pane Studio; no-AI completeness.
- **Docs:** Adaptive Studio, Course authoring, Course Pack, activity renderer, information architecture, accessibility, personal adaptation/upstream integration, and language policy.
- **Demo:** Create/open a local Draft, edit activities and translations, validate, Preview, review changes, Publish immutably, create and Publish a separate personal adaptation, install a newer upstream revision, inspect a conflict, Cancel without change, then explicitly integrate into a new personal Draft—all with AI Off.
- **Acceptance:** A complete valid Pack can be authored and published manually; zero-error validation and explicit immutable confirmation are required; Publish never follows an AI/edit action implicitly; source revisions and historical evidence remain unchanged through branch edit, personal Publish, and explicit upstream integration.
- **Known limitations:** Single-user local editing only. No collaborative merge. No production courses are included or certified.
- **Rollback/compatibility:** Current editor API remains as a bounded compatibility layer until each surface migrates. Published revisions and learner snapshots are never rolled back in place; a new revision corrects content.

## M10 — Adaptive Studio typed AI proposals

**Status:** Approved Core Alpha target; implementation proposed pending owner approval.

- **Objective:** Add the optional 30% developer instrument and guided Course Designer as reviewable typed proposals, without weakening manual authoring or publish gates.
- **Scope:** Guided Course Designer state machine (`DRAFT_REQUEST → DISCOVERY → DIAGNOSTIC → CURRICULUM_PROPOSAL → USER_REVIEW → COMPILATION → VALIDATION → PUBLISHED`, with `FAILED` recovery); natural-language goal, target outcome, current level, constraints, sources, activities, and runtime requirements; optional diagnostic questions or practical tasks; revision requests and explicit confirmation; typed Course Designer/Research proposal tools; stable target IDs; structured before/after diff; provenance and model disclosure; validation; Apply/Reject; draft-only mutation; Research Gateway with explicit source/private-data actions.
- **Non-goals:** Autonomous course generation/publishing, direct file edits, arbitrary web access, hidden provider use, model-owned validation, or AI requirement for Studio.
- **Migrations:** Store designer workflow state, diagnostic answers, proposal audit envelopes, and explicit apply events separately from immutable Course releases. Existing drafts remain editable without AI.
- **Tests:** Every state transition and failed-state recovery; resume after restart; diagnostic skip/manual path; invalid/unknown target IDs; schema-invalid proposals; stale-base conflicts; private-source disclosure confirmation; provider failure; revision loop; apply/reject audit trail; compilation to the same Course Pack schema; validation after apply; proof that confirmation/Apply cannot publish; AI Off manual parity.
- **Docs:** Course authoring and Authoring Kit, Adaptive Studio, Research Gateway, Provider Hub, Pi runtime, AI/security boundaries, and private-source policy.
- **Demo:** Enter a learning goal and constraints, complete or skip an optional diagnostic, inspect and revise a curriculum proposal, confirm compilation into a local draft, reject one bounded proposal, apply another, validate, then perform a separate manual publish confirmation.
- **Acceptance:** Every AI change is typed, reviewable, attributable, draft-only, and explicitly applied; designer workflow state resumes safely; compilation uses the same strict Course Pack contract as external authoring; rejecting or disabling AI loses no manual capability; confirmation and publish remain independent.
- **Known limitations:** Output quality varies and remains advisory. Research access is limited to approved tools/sources and explicit disclosure actions.
- **Rollback/compatibility:** Rejecting a proposal is a no-op. Applied draft changes can be reverted within draft history; published revisions remain immutable. Provider removal does not affect existing packs or learner evidence.

## M11 — Course/session cutover and legacy retirement

**Status:** Approved Core Alpha target; implementation proposed pending owner approval.

- **Objective:** Move all product callers to the target Course/session/evidence model and retire obsolete runtime paths only after parity and recovery evidence.
- **Scope:** Explicit course selection; per-course active revision/session; Personal Adaptation Branch; target evidence/review reads and writes; removal of v1 caller-supplied mastery/fixed completion; removal of global `learner_state='default'` and `LIMIT 1` selection assumptions; historical data retention/export.
- **Non-goals:** Deleting history, merging candidate databases automatically, multi-user, PostgreSQL deployment, or rewriting immutable snapshots.
- **Migrations:** Dual-write/read parity, final deterministic backfill, quarantine resolution report, verified backup, target read cutover, legacy write freeze, retention window, then a separately approved append-only rebuild for compatibility column/table retirement.
- **Tests:** Real persisted fixtures; simultaneous courses/sessions; old deep links; dual-write idempotency; parity fingerprints; rollback restore; legacy read-only retention; no v1 bypass; no orphan/untyped evidence; seed and migration re-run.
- **Docs:** Migration runbook, operator decision points, rollback limits, compatibility window, data export, and final architecture status.
- **Demo:** Resume a pre-cutover session, start a different course without abandoning it globally, complete a target activity, inspect adaptation/evidence, switch back, and restore a pre-cutover backup in a disposable environment.
- **Acceptance:** Every production caller uses target repositories/contracts; no caller can supply mastery or bypass Kernel evidence; all legacy rows are mapped, quarantined, or retained with reason; restore is proven before retirement.
- **Known limitations:** SQLite remains single-user/local. Some irreducibly ambiguous historical records may remain quarantined and visible only in diagnostics/export.
- **Rollback/compatibility:** Before legacy retirement, switch reads back to compatibility projections. After committed destructive rebuild, only verified backup restore is rollback; therefore retirement requires a distinct owner-approved gate.

## M12 — Core Alpha release candidate and licensing cutover

**Status:** Proposed pending owner approval and legal review.

- **Objective:** Produce a releasable loopback-only local Core Alpha candidate with verified docs, notices, recovery, and end-to-end behavior.
- **Scope:** The defined [50-item Core Alpha release matrix](docs/product/core-alpha-scope.md#core-alpha-release-matrix); supported local-process and loopback-Compose packaging; backups/restore; SBOM and third-party notices; fixture/content terms; trademark policy; owner-approved license application; accessibility/responsive verification; clean install/upgrade; no production courses; known limitations.
- **Non-goals:** Authenticated/public/LAN self-hosting, cloud service, remote operation, multi-user, sync, marketplace, mobile native app, PostgreSQL runtime, or production course certification.
- **Migrations:** Exercise clean install and every supported upgrade path on disposable copies; require verified backup and explicit candidate selection; never distribute `.data`, learner attempts, private databases, credentials, or local captures.
- **Tests:** Full CI plus clean-machine smoke; 4/4 or successor E2E contract; install/upgrade/backup/restore; dependency policy and SBOM; pack safety corpus; Node/Python environment checks; AI Off and explicit real-provider failure; locale/theme/mobile/accessibility; distribution-content inspection.
- **Docs:** Final README, product/architecture/design/security/self-hosting set, migration guide, roadmap status, licensing plan, third-party notices/SBOM, content/fixture terms, and release limitations.
- **Demo:** Clean local install; safe pack import; lesson and correction cycle; Review/Skills; manual Studio publish; optional typed AI proposal; provider failure; backup/restore; English/Russian UI on desktop/mobile.
- **Acceptance:** All approved Core Alpha contracts are met end to end; no unresolved high-severity boundary; audit policy passes or has explicit time-bounded owner exception; distribution has approved licenses/notices and no private data; owner signs the release gate.
- **Known limitations:** Local-first single-user, SQLite, trusted Node/Python checks, no production courses, optional AI, no cloud sync or remote auth, and any documented upstream Pi limitations.
- **Rollback/compatibility:** Release artifacts are immutable/versioned. Upgrade requires verified backup and documented restore. License application is not performed until ownership, variant, package/content boundaries, and legal review are approved; licensing changes are not treated as technically reversible.

## Future after M12

**Status:** Future.

Potential work includes a PostgreSQL adapter, authenticated LAN/remote deployment, collaboration, signed pack registries, additional environment contracts, production course certification, and sync. None is implied by Core Alpha and each requires a separate threat model, migration plan, and approval gate.
