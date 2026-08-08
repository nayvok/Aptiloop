# Aptiloop Core Alpha Repository Audit and Approval Gate

**Date:** 2026-08-08
**Branch:** `docs/core-alpha-audit`
**Status:** Approved Core Alpha target; M0 decisions recorded and M1 authorized on 2026-08-08
**Scope:** M0 audit/specification evidence and recorded owner decisions; target behavior is not claimed as implemented

Status language in this audit is normative:

- **Implemented baseline** — directly observed in the current repository or in the recorded 2026-08-08 verification run.
- **Approved Core Alpha target** — the required target contract captured by the specification set; it is not an implementation claim.
- **Proposed pending owner approval** — a recommendation or choice that must not be acted on before approval.
- **Future** — explicitly outside Core Alpha.

This audit supersedes historical acceptance claims as approval evidence. It does not rewrite or erase those historical records.

## 1. Current state

**Implemented baseline.** Aptiloop is currently an npm/Turborepo monorepo named and presented as **Dev Learning Harness**; its workspace manifests use `private: true`, which is packaging metadata, not repository visibility or a license. A Next.js 16/React 19 web app calls a Hono orchestrator, which owns SQLite, filesystem/Git/process operations, curriculum/session state, and Mock/Codex/OpenCode provider lifecycles. Internal packages use the `@dlh/*` scope. The active source revision is `curriculum-foundation-v2-r4`, despite older docs that say r3.

The current repository contains a materially working versioned learner slice:

- authored versioned curriculum and immutable session snapshots;
- stable unit IDs and server-owned progression transitions;
- protected answer redaction from learner DTOs;
- append-only recall, quiz, and code-reading evidence with operation IDs;
- isolated exercise attempt workspaces, allowlisted tests, full-diff fingerprint freshness, and read-only Reviewer checks;
- deterministic summary persistence, mastery/mistake/flashcard artifacts, and restart/resume;
- a restart-safe interview flow whose report measures completion and answer form, not technical correctness or mastery;
- a local Curriculum Editor with draft/clone/validate/publish and immutable published revisions.

This baseline is not Core Alpha compliance. It remains Russian-first and hard-coded, exposes a subsystem-oriented navigation, carries live v1 compatibility routes/data, lacks Course Packs and Source Snapshot/Knowledge Capsule contracts, has no Provider Hub or constrained Pi integration, and has no committed CI workflow.

Repository history evidence supplied for this audit is exact: clean local `old` and `main` both preserve commit `053dcd0`; documentation work occurs on `docs/core-alpha-audit`.

## 2. Current architecture

**Implemented baseline.** The useful dependency direction is:

```text
Browser / Next.js UI
        |
        v
Hono orchestrator (HTTP/SSE, composition, lifecycle)
        |
        +--> shared strict contracts
        +--> deterministic learning-core rules
        +--> SQLite repositories/migrations/seed
        +--> exercise-core path/Git/process/editor boundary
        +--> provider adapters behind AgentProvider
        +--> authored curriculum sources
```

The strongest seams are shared Zod contracts, pure learning rules, repositories around `node:sqlite`, provider normalization, and exercise-core containment. The versioned route modules for learning, interview, and authoring are better migration boundaries than the large legacy orchestrator surface.

The principal architectural contradictions are:

1. Legacy `curriculum_days/questions/exercises` and v1 session routes remain live beside the versioned graph.
2. Versioned sessions still require a synthetic legacy day row, and current-session selection is globally single-course.
3. `curricula.active_version_id`, several repeated version/day/unit identifiers, unit evidence IDs, and hint IDs are not fully constrained by database ownership relationships.
4. The generic provider stream can accept browser provider/model overrides rather than resolving policy in one server-owned hub.
5. Exercise and Reviewer boundaries are strong, but non-review provider roles bypass them through provider-internal tools.
6. The web renderer is a large unit-type switch; exercise and interview are partly separate routes rather than one activity contract.

The migration rule is therefore incremental preservation, not a rewrite: retain the working seams and session snapshots, add target contracts beside them, migrate callers and data with parity evidence, then retire compatibility paths only after a separately proven cutover.

## 3. Actual verification on 2026-08-08

**Implemented baseline evidence.** The following results are the approval baseline; older green claims do not replace them.

| Check                    | Exact result                                                                                                                                                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Repository state         | Clean local `old` and `main` both preserve commit `053dcd0`; work is on `docs/core-alpha-audit`.                                                                                                                               |
| Install                  | `npm install` succeeded and left Git clean.                                                                                                                                                                                    |
| Disposable SQLite        | Migrate plus seed twice succeeded; resulting seed reported 7 days and 14 topics.                                                                                                                                               |
| `npm run verify`         | Passed format; 12/12 lint tasks; 12/12 typecheck tasks; 21/21 fast-test tasks totaling 352 tests; 12/12 build tasks; 12 static Next routes.                                                                                    |
| `npm run test:e2e`       | **Failed: 1 passed, 3 failed.** Day 1 could not find `Plan day`; Curriculum Editor timed out waiting for create revision amid repeated navigation; Interview could not find the default studied-scope radio. E2E is not green. |
| Desktop browser smoke    | At 1440×900, Home loaded, a session started, and the plan drawer opened; no console errors were observed.                                                                                                                      |
| Mobile browser smoke     | At 390×844, no horizontal overflow was observed, but Home was 3534 px tall and the mobile navigation was overfull/dense.                                                                                                       |
| Dependency audit         | `npm audit` reported **6 vulnerabilities: 4 high, 1 moderate, 1 low**. Relevant locked versions: Hono 4.12.33, Next 16.2.12, nested PostCSS 8.4.31, sharp 0.34.5, nanoid 3.3.16, and tsup esbuild 0.27.7.                      |
| Collaboration/automation | GitHub API reported zero issues and zero pull requests. No CI workflow is committed.                                                                                                                                           |

Consequences:

- `npm run verify` does not include E2E and must not be summarized as a complete green product gate.
- A static route count of 12 is the current evidence; the older document reporting 13 routes is historical.
- Previous external provider, Docker, or Zed smoke records are dated history, not automatically current proof.
- The audit failures are release and ordering evidence, not questions to delegate to the owner.

## 4. Reusable mechanisms to preserve

**Implemented baseline.** The following mechanisms are useful inputs to Core Alpha and should be migrated incrementally:

- strict shared validation at HTTP/provider/DB boundaries and protected learner DTOs;
- immutable authored revisions, full-graph validation, clone-to-draft, content hashes, and immutable session snapshots;
- stable IDs, append-only typed unit evidence, canonical JSON, operation-id idempotency, and first-attempt recall pinning;
- pure prerequisite/status progression, deterministic day summary, and transactional summary artifacts;
- isolated attempt workspaces, canonical containment/reparse checks, private Git baseline, full non-truncated diff SHA-256 freshness, fixed `shell: false` process plans, caps/timeouts/cleanup, and external editor fallback;
- Reviewer read-only/deny-write policy plus before/after diff invariant; Reviewer remains advisory and never supplies patches;
- loopback defaults, exact Origin and JSON enforcement, browser suppression of raw provider protocol, and server-side quiz scoring;
- SQLite WAL/foreign keys, ordered transactions, non-overwriting `VACUUM INTO` backups, integrity/foreign-key checks, and candidate discovery without automatic merge/delete;
- Today/start/resume, sequential activity flow, knowledge/mistake/card behavior, theme tokens, reduced motion, landmarks, and immutable publish confirmation;
- provider lifecycle normalization and deterministic Mock for tests, CI, and explicit development only.

Preservation does not mean freezing current names or shapes. `curricula` can become the Course compatibility source, `curriculum_versions` the Course Revision source, and units the Activity source, while provenance and snapshots remain intact.

## 5. Obsolete, conflicting, or incomplete mechanisms

**Implemented baseline findings to migrate or retire later.**

| Mechanism                              | Finding                                                                                                                     | Disposition                                                                                                            |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Dev Learning Harness / `@dlh/*` naming | Product identity and package scope predate Aptiloop.                                                                        | Rename in staged, separately verified slices; do not couple every rename to domain migration.                          |
| Russian UI and docs                    | `<html lang="ru">`, hard-coded labels, `ru-RU` formatting, and Russian docs are current baseline, not bilingual compliance. | Extract UI catalogs for en-US/ru-RU; classify old docs as historical or migrate them after approval.                   |
| Primary navigation                     | Path, Session, Practice, Knowledge, Mistakes, Interview, and Cards expose subsystems; mobile nav is overfull.               | Migrate to Home / Courses / Review / Skills / Settings with compatibility routes.                                      |
| v1 learning endpoints                  | Caller-supplied fixed mastery, canned mistakes/cards, and completion bypass v2 evidence rules.                              | Stop new callers, migrate evidence, freeze writes, then remove after parity.                                           |
| Lossy mastery reconstruction           | Successful UTC days and repeated-error counts are not persisted/replayed completely.                                        | Add replay-complete evidence; never infer missing facts.                                                               |
| Hints                                  | Six-level rules exist, but persistence is orphaned from HTTP/UI; older 0–3 path remains.                                    | Generalize typed evidence or explicitly defer; retire old path only after data migration.                              |
| Teacher linkage                        | Generic conversation counts act as authority and canonical `conversationId` can remain null.                                | Replace with typed turn/evidence linkage.                                                                              |
| Interview report                       | Completion/form observations can be mislabeled as skill evidence.                                                           | Keep honest limitation; no technical mastery until a deterministic approved evaluator exists.                          |
| Generic provider stream                | Browser provider/model override bypasses central settings/policy.                                                           | Resolve through one server-owned Provider Hub.                                                                         |
| Curriculum Editor                      | Raw JSON-centric and lacks pack, locales, preview, provenance, and typed proposals.                                         | Evolve into manual-first Adaptive Studio; preserve draft/publish invariants.                                           |
| `.superpowers` and `docs/superpowers`  | Committed instructions require Superpowers workflows, conflicting with the OMP-native repository workflow.                  | Treat as historical audit material; migrate/archive instructions after approval. Do not recommend Superpowers/Caveman. |
| Historical docs                        | r3/r4 mismatch, pre-v2 product spec, conflicting plan statuses, old mtime limitation, and dated acceptance claims.          | Status-label and archive/migrate later; do not treat as current approval evidence.                                     |
| Mock in product health                 | Mock can appear as “AI ready.”                                                                                              | Restrict to test/CI/dev and distinguish AI Off, unavailable, failed, and real configured provider.                     |

## 6. Security findings and required boundaries

**Implemented baseline findings; Approved Core Alpha target controls.** Five present high-severity findings must be addressed before capability expansion:

1. **Non-review AI roles have repository write/general tool authority.** Browser-controlled learner text can reach Codex workspace-write or default OpenCode tools rooted at the project. Reviewer-only restrictions do not protect Tutor/Interviewer/other roles.
2. **Codex inherits the complete orchestrator environment.** Root `.env` values, including cross-provider secrets, are passed to the child process; output redaction cannot undo access.
3. **OpenCode tool inputs/outputs are persisted raw.** Full JSON can enter `agent_messages.tool_events_json` and backups even though the browser receives a minimized event.
4. **A non-loopback bind exposes an unauthenticated control plane.** The fixed client header and Origin check are not authentication for non-browser clients.
5. **Legacy v1 writes bypass deterministic learning integrity.** Remaining legacy session/answer/completion paths can apply fixed mastery, mistakes, and cards outside versioned append-only evidence and server-owned Kernel transitions.

Additional present risks are unbounded cumulative AI stream/tool/review output (medium), external-resource Markdown privacy leakage (low), plaintext private-data lifecycle/permissions gaps (low/medium confidence), unresolved dependency advisories (approval-gate risk), and obsolete mtime text in security/architecture docs (implementation already uses the stronger full-diff hash).

Course Pack import is not currently implemented, so pack execution is a target-design hazard rather than a present import vulnerability. Course Pack V1 accepts one UTF-8 JSON document and must enforce private staging, strict duplicate-key/encoding parsing, JSON/path-value rejection, byte/count/depth/string/time limits, closed schemas, finite graphs, provenance, canonical hashing, learner Preview, transactional Install/Open-as-draft, and **zero content-defined execution**. Archive/directory transport and extraction controls are Future.

Core Alpha security invariants are:

- every AI role is tool-free/read-only by default;
- Aptiloop exposes only app-owned typed tools with strict per-role allowlists and validated results;
- no arbitrary AI filesystem, shell, network, edit, credential, or process tools;
- Reviewer receives an immutable evidence bundle, is read-only, and never emits/applies patches;
- Course Packs contain no commands, scripts, secrets, plugins, executable hooks, or credentials;
- real-provider failure remains explicit; no silent fallback to Mock;
- private learner/source data never leaves the machine without an explicit user action at the disclosure boundary;
- loopback-only remains the supported unauthenticated mode; remote access is Future and requires authentication and a new threat model;
- trusted checks use app-owned IDs and plans; trusted execution is not described as a sandbox.

## 7. Data risks

**Implemented baseline.** SQLite currently combines a legacy graph with the versioned graph. The versioned shape is useful but not fully relationally enforced. Important risks are:

- global uniqueness and selection assumptions prevent correct multi-course behavior even for one user;
- `learner_state(id='default')`, a one-global-active-session index, and `LIMIT 1` path/current-session queries can abandon or hide another course;
- repeated text IDs do not prove that course, revision, week/day, activity, snapshot, progress, hint, question, and evidence belong together;
- legacy sessions can read live curriculum content, unlike immutable versioned snapshots;
- migration 0001 globally rewrites older active sessions to abandoned;
- TypeScript repair hooks rebuild/normalize tables, can default a missing unit type to `study`, and can replace malformed progress JSON, which is logically irreversible after commit;
- migration and backup are separate commands; a direct migration caller can change a file without first creating a verified backup;
- multiple local candidate databases and WAL/SHM files exist; none may be silently chosen, merged, distributed, or deleted;
- SQLite and backups contain learner answers, paths, test output, reviews, interviews, transcripts, and tool events in plaintext;
- current fixtures do not fully represent persisted old schemas, WAL states, multi-course collisions, or malformed data.

The approved direction is additive, provenance-preserving migration with explicit candidate inventory, verified non-overwriting backups, quarantine instead of invented mappings, pre/post counts and hashes, dual reads/writes, and explicit operator choice.

## 8. Course and session migration

**Approved Core Alpha target.** The safe staged migration is:

1. **Inventory and preserve:** discover configured and conventional DB candidates; record integrity, FK status, migration markers, schema fingerprints, counts, active sessions, snapshots, and hashes; back up each candidate independently.
2. **Add target model:** Course, immutable Course Revision, finite Activity, Source Snapshot, Knowledge Capsule, Personal Adaptation Branch, typed Evidence, and Review Item, with source-to-target provenance and quarantine.
3. **Deterministic backfill:** map versioned entities by stable existing IDs; map legacy data as explicit legacy provenance; preserve unmatched rows without defaulting them to unrelated activities; reconcile each session against its snapshot.
4. **Dual write/read:** new sessions and evidence carry explicit course/revision/activity ownership while compatibility rows remain only where old routes require them. Compare projections and fingerprints.
5. **Caller cutover:** migrate Home/Courses/session/progress/review/Studio callers one vertical slice at a time; stop v1 mastery and completion writes.
6. **Retirement gate:** after parity, freeze legacy tables read-only for a retention window. Only a later owner-approved append-only rebuild may remove compatibility columns/tables.

Rollback after a committed destructive SQLite migration is a verified backup restore, not a down migration. Immutable session snapshots and source evidence must never be rewritten for convenience. An ambiguous historical fact stays partial or quarantined; the migration must not fabricate successful days, error counts, mastery correctness, or course ownership.

## 9. Target architecture

**Approved Core Alpha target.**

```text
Aptiloop UI (en-US / ru-RU; course locale independent)
  Home | Courses | Review | Skills | Settings | contextual Studio
                        |
                        v
Aptiloop Core application services
  Course Library | Lesson Engine | Learning Kernel | Knowledge System
  Adaptive Studio | Research Gateway | Provider Hub | Execution Fabric
                        |
        +---------------+----------------+
        |               |                |
        v               v                v
 SQLite repositories  typed AI tools   trusted checks
 (PostgreSQL-ready     via Pi runtime   by check/environment ID
 ports, not runtime)   and providers    Node + Python contracts
```

Domain invariants:

- local-first, single-user Core Alpha;
- Course is the top entity; every published Course Revision is immutable;
- each learner owns a Personal Adaptation Branch rather than mutating the course;
- lessons are finite declarative Activity graphs; no plugin or command execution;
- the deterministic Learning Kernel alone owns progression, mastery, review state, and replay;
- Source Snapshots preserve source facts/provenance; Knowledge Capsules are validated reusable knowledge units;
- Course Packs are declarative, versioned, validated, canonically hashed, and transactional;
- no production courses ship in Core Alpha;
- Pi is only the model/runtime seam behind Aptiloop-owned typed tools and explicit provider resolution;
- Provider Hub never silently changes a real provider to Mock;
- Execution Fabric accepts trusted check IDs, not commands, and implements Node/Python Environment Pack contracts;
- Reviewer is read-only and returns validated findings, never patches;
- Adaptive Studio is approximately 70% editorial workflow and 30% developer instrument; manual authoring remains complete with AI Off.

Pi integration must use current official evidence, not tutorial projects or historical scopes. The researched revision is `@earendil-works/pi-ai`, `@earendil-works/pi-agent-core`, and `@earendil-works/pi-coding-agent` 0.84.1 at commit [`9dd90a49711d088b86fdd9b4aea575913a8328`](https://github.com/earendil-works/pi/tree/9dd90a49711d088b86fdd9b4aea575913a8328). Pi states that it has [no built-in permission system](https://github.com/earendil-works/pi/blob/9dd90a49711d088b86fdd9b4aea575913a8328/README.md#L35-L41). Its [AgentHarness implementation](https://github.com/earendil-works/pi/blob/9dd90a49711d088b86fdd9b4aea575913a8328/packages/agent/src/harness/agent-harness.ts#L342-L357) is partial/stubbed, and the [SQLite backend changelog](https://github.com/earendil-works/pi/blob/9dd90a49711d088b86fdd9b4aea575913a8328/packages/session-backends/sqlite-node/CHANGELOG.md#L8-L19) says old WIP databases are not migrated to the v4 contract. Aptiloop must not design around unimplemented durability or treat that backend as transparently pluggable into coding-agent `AgentSession`.

## 10. Core Alpha specification set

**Approved Core Alpha target documents; their implementation claims remain subject to each document's status.** This audit links the complete new set.

### Repository and product

- [README](../../README.md)
- [Product register](../../PRODUCT.md)
- [Repository operating rules](../../AGENTS.md)
- [Architecture](../../ARCHITECTURE.md)
- [Design](../../DESIGN.md)
- [Security](../../SECURITY.md)
- [Self-hosting](../../SELF_HOSTING.md)
- [Core Alpha scope](../product/core-alpha-scope.md)
- [User journeys](../product/user-journeys.md)
- [Terminology](../product/terminology.md)
- [Language policy](../product/language-policy.md)
- [Course authoring, guided Course Designer, and Authoring Kit](../product/course-authoring.md)

### Architecture

- [Course Pack](../architecture/course-pack.md)
- [Lesson Engine](../architecture/lesson-engine.md)
- [Learning Kernel](../architecture/learning-kernel.md)
- [Knowledge System](../architecture/knowledge-system.md)
- [Research Gateway](../architecture/research-gateway.md)
- [Pi runtime](../architecture/pi-runtime.md)
- [Provider Hub](../architecture/provider-hub.md)
- [Execution Fabric](../architecture/execution-fabric.md)
- [Environment Packs](../architecture/environment-packs.md)
- [Workspaces and editors](../architecture/workspaces-and-editors.md)
- [Deployment models](../architecture/deployment-models.md)

### Design

- [Adaptive Studio](../design/adaptive-studio.md)
- [Information architecture](../design/information-architecture.md)
- [Activity renderers](../design/activity-renderers.md)
- [Accessibility](../design/accessibility.md)

### Security, migration, and licensing

- [Threat model](../security/threat-model.md)
- [Untrusted Course Packs](../security/untrusted-course-packs.md)
- [Execution isolation](../security/execution-isolation.md)
- [AI boundaries](../security/ai-boundaries.md)
- [Secrets and private sources](../security/secrets-and-private-sources.md)
- [Core Alpha migration strategy](../migration/core-alpha-migration-strategy.md)
- [Core Alpha licensing plan](../licensing/core-alpha-licensing-plan.md)
- [M0–M12 roadmap](../../ROADMAP.md)

### Architecture decisions

- [ADR-0001: Local-first Core](../adr/0001-local-first-core.md)
- [ADR-0002: Course Pack contract](../adr/0002-course-pack-contract.md)
- [ADR-0003: Finite Lesson Engine](../adr/0003-finite-lesson-engine.md)
- [ADR-0004: Pi runtime](../adr/0004-pi-runtime.md)
- [ADR-0005: Deterministic Learning Kernel](../adr/0005-deterministic-learning-kernel.md)
- [ADR-0006: Source Snapshots and Knowledge Capsules](../adr/0006-source-snapshots-knowledge-capsules.md)
- [ADR-0007: Execution Fabric backends](../adr/0007-execution-fabric-backends.md)
- [ADR-0008: Adaptive Studio](../adr/0008-adaptive-studio.md)
- [ADR-0009: Licensing model](../adr/0009-licensing-model.md)

Historical lowercase `docs/architecture.md`, `docs/security.md`, the 2026-08-02 acceptance audit, product specification v2, implementation plans, guided-learning design records, `.superpowers`, and `docs/superpowers` remain baseline evidence only. They must later receive explicit historical status or be archived/migrated without deleting history.

## 11. Roadmap and execution order

**Proposed pending owner approval.** The detailed [M0–M12 roadmap](../../ROADMAP.md) is ordered to retain runnable vertical slices:

| Milestone | Outcome                                                                                                                         |
| --------- | ------------------------------------------------------------------------------------------------------------------------------- |
| M0        | Audit/specification approval only.                                                                                              |
| M1        | Security containment, data inventory, dependency/CI gate; existing product slice remains intact.                                |
| M2        | Additive Course/revision/activity/evidence foundations with provenance and compatibility reads.                                 |
| M3        | Safe single-file JSON Course Pack lifecycle plus version-matched Authoring Kit; no content execution and no production courses. |
| M4        | Replay-complete deterministic Learning Kernel.                                                                                  |
| M5        | Generic trusted-ID Execution Fabric plus Node/Python environment contracts.                                                     |
| M6        | Provider Hub and constrained Pi runtime behind typed Aptiloop tools.                                                            |
| M7        | Aptiloop identity, en-US/ru-RU, and Home/Courses/Review/Skills/Settings IA.                                                     |
| M8        | Activity Frame and one-by-one renderer migration.                                                                               |
| M9        | Complete manual 70% editorial Adaptive Studio with Authoring Kit schema/validator parity.                                       |
| M10       | Optional 30% guided Course Designer and typed AI proposal instrument.                                                           |
| M11       | Course/session caller cutover and separately gated legacy retirement.                                                           |
| M12       | Release candidate, self-hosting, notices/SBOM, and approved licensing cutover.                                                  |

Evidence for this order is concrete: present provider authority and secrets risks must precede Pi/AI expansion; data ambiguity must precede pack import and course selection; manual Studio must be complete before AI authoring; the monolithic renderer can be wrapped and migrated type-by-type; v1 retirement must follow, not precede, backfill and parity; and M12 licensing cannot proceed before ownership, variant, boundaries, and legal review.

Changing the sequence requires evidence that the same safety dependency is satisfied and that a runnable deterministic learner slice remains after every change.

## 12. UX and approval process

**Approved Core Alpha target.** The learner IA is **Home / Courses / Review / Skills / Settings**. Studio is contextual/secondary rather than another learner subsystem destination. UI locale (`en-US` or `ru-RU`) is independent from one primary course locale, with explicit course translation/fallback metadata.

The UX migration process is:

1. Preserve Today/resume, immutable session state, semantic OKLCH tokens, Geist Sans/Mono, reduced motion, keyboard landmarks, source empty states, external-editor fallback, read-only review, and publish/delete confirmations.
2. Reframe subsystem routes into the five primary destinations with compatibility redirects.
3. Extract all UI strings and locale-sensitive formatting before large composition changes.
4. Introduce explicit browser offline, Core stopped, SQLite problem, AI Off, provider unavailable, and provider failed states. Missing optional AI must not masquerade as Core failure.
5. Wrap the current unit renderer in a stable Activity Frame, then migrate activity types one by one without changing Kernel authority.
6. Evolve Curriculum Editor into manual-first Adaptive Studio: Create/Open/Import → Pack overview → outline/finite graph → typed editor → learner Preview → Validate → Change review → explicit immutable Publish, including a separate personal-adaptation/upstream-integration flow.
7. Supply the version-matched Authoring Kit for external manual/AI authoring and require schema, validator-code, canonical-hash, no-execution, and fixture parity with Adaptive Studio/import.
8. Only after manual Studio is complete, add the restart-safe guided Course Designer state machine and typed AI proposals with provenance, stable target IDs, structured before/after, validation, and Apply/Reject. Compilation/Apply changes a Draft only; publishing is always a separate confirmation.
9. Verify each slice at desktop/mobile, light/dark, en-US/ru-RU, keyboard/screen-reader semantics, and loading/empty/error/offline/no-AI/missing-Core states.

The target composition is approximately 70% calm editorial workflow and 30% developer instrument. Structured controls are the Core Alpha editor; an Advanced JSON editor is **Future**, not an M9 requirement. No AI response is a publish instruction.

## 13. Three visual directions

The owner selected **A. Calm Workshop** on 2026-08-08. B and C remain decision evidence and unselected **Future** alternatives.

### A. Calm Workshop

Cool neutral/eucalyptus, open editorial learner surfaces, dense but non-IDE Studio, thin borders, minimal shadow, current semantic OKLCH foundation, and retained local Geist Sans/Mono. A stable Activity Frame keeps page anatomy constant while the activity type changes controls. This has the lowest migration and dark-mode risk, but the IA and composition must change decisively enough to avoid looking like a renamed harness.

### B. Learning Ledger

Warm paper/editorial surfaces, ruled separators, margin evidence, serif learning prose, and sans/mono controls. It gives long-form reading and authorship the strongest identity, but increases font/localization work and is less natural for finite graphs, test output, and dense dark-mode Studio panels.

### C. Graph Blueprint

Slate/navy technical workbench, cobalt selection, amber validation, explicit graph/evidence rails, and a dense Studio-first grid. It expresses finite dependencies and validation well, especially in dark mode, but risks becoming an IDE/control plane and exposing implementation structure to learners.

These are product-system directions, not cosmetic themes. A is the approved target direction; B and C are not authorized redesign targets.

## 14. Recommendation

**Approved Core Alpha target:** the owner selected **A. Calm Workshop** on 2026-08-08.

Reasons:

- it extends the existing semantic light/dark OKLCH system rather than replacing a useful accessibility foundation;
- retaining local Geist Sans/Mono minimizes network, packaging, and Cyrillic support risk;
- the current learner flow is the strongest part of the baseline, so the highest-value change is clearer IA, state semantics, localization, and open editorial composition—not decorative reinvention;
- one visual language can support a calm 720–800 px lesson surface and a dense outline/editor/inspector Studio without making the learner UI resemble an IDE;
- it best supports the required incremental Activity Frame and renderer migration.

Approval covers the direction, not every token. Detailed design remains subject to the accessibility, language, activity, Studio, and milestone acceptance contracts.

The owner deferred every licensing/distribution artifact and channel pending professional legal review. No license text, new source/npm/standalone/desktop/container/hosted distribution artifact, future Apache SDK, redistributable production/sample Course, contribution policy, or trademark policy is authorized. The repository remains under no license grant; the earlier AGPL/Apache direction remains an unapproved engineering recommendation only.

## 15. Licensing inventory and owner questions

**Implemented baseline finding:** no root `LICENSE`, `COPYING`, `NOTICE`, or third-party notice file was found; root and inspected internal private manifests do not declare a project license. `private: true` is not a license. The lockfile's upstream metadata is not a substitute for project terms or upstream license/notice retention.

The repository mixes own code, curriculum prose and code examples, exercise templates/tests, Russian translations, docs, screenshots, Geist fonts, provider/trademark names, and local learner/runtime artifacts. Package directories alone do not prove legal separability because the orchestrator imports nearly every internal package. `.data` databases, backups, attempts, and local captures must never enter a release by accident.

The following owner/business decisions remain unresolved under the owner-approved 2026-08-08 deferral. The deferral keeps every affected artifact, content set, mark, contribution model, and distribution channel out of scope until the owner and professional counsel approve it:

1. **Ownership and contributors:** identify the person/legal entity controlling each code, curriculum, translation, fixture/test, document, screenshot, font/asset, and contribution; record assignment/DCO/CLA/employment/contractor evidence and the policy for AI-assisted provenance.
2. **Code license and boundary:** choose the exact AGPL variant and path matrix for the integrated surface; identify any future Apache SDK candidates and required separation; decide whether dual licensing is intended and whether authority exists.
3. **Content and fixtures:** choose terms for Course Packs, sample/development content, exercises/tests, translations, screenshots, generated documentation, and private-source exclusions; decide whether any redistributable sample Course ships at all.
4. **Distribution scope:** name intended source, npm, standalone/desktop, container, and hosted channels and the exact artifact classes allowed in each. Unselected channels remain out of scope.
5. **Dependencies and notices:** assign ownership for per-artifact SBOM/notices; require actual shipped-artifact review of MPL/file-level, Geist font, optional, and transitive obligations.
6. **Marks and contribution policy:** decide Aptiloop name/logo/domain claims, provider/project-name use in UI/docs/screenshots/marketing, and the public contribution model.

Professional counsel must determine verified rights, license compatibility, combined-work/separability, exact obligations, content/asset terms, and trademark/contribution consequences. Engineering must supply the path/dependency/provenance inventory, SBOM/notices, artifact scan, and private-data exclusion evidence. No document here substitutes one class of decision for another or applies a license.

## 16. Recorded owner decisions

On 2026-08-08, the repository owner explicitly:

1. approved the Core Alpha product and architecture contract, including the fixed 50-item release matrix;
2. approved the M0–M12 order and incremental/no-big-bang migration rule;
3. selected **A. Calm Workshop**;
4. deferred every licensing and distribution decision in Section 15, keeping all affected artifacts and channels out of scope pending professional legal review; and
5. authorized implementation of M1.

The failed E2E scenarios, six baseline dependency vulnerabilities, five present high-severity security findings, missing CI, data ambiguities, and incomplete mechanisms are M1 work with acceptance tests in the roadmap. They are not owner design decisions.

## 17. Approval gate result

**Implemented baseline:** the M0 approval gate was satisfied on 2026-08-08. The approved documents authorize milestone execution in the recorded order; they do not claim that target behavior exists.

M1 may implement only safety, provenance, and repeatable-quality scope. Product redesign, Pi integration, Course Pack rollout, production Course work, public/new artifact distribution, and every license or trademark/contribution change remain outside M1. Later milestones begin only after the preceding milestone's acceptance evidence is recorded.

The implemented application remains Dev Learning Harness until each approved migration slice is delivered and verified. E2E and dependency findings remain red until M1 runtime evidence proves otherwise.
