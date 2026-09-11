# Aptiloop Core Alpha Roadmap

**Document status:** Current orientation for the implemented baseline, the approved Core Alpha target, and the remaining release gates.
**Owner approval:** 2026-08-08 (Calm Workshop direction and Core Alpha order).
**Most recent recorded full-run evidence:** release-preparation tree based on `cc51455`.

## Status rules

- **Implemented baseline** means behavior observed in the repository or in a dated local/hosted run. It does not authorize a release.
- **Approved Core Alpha target** means a binding contract or release gate; it remains open until current evidence closes it.
- **Proposed pending owner approval** and **Future** are not implementation commitments.
- SQLite and additive migrations remain the Core Alpha persistence boundary. A committed migration has no supported down migration; recovery is a whole-file restore from a verified, explicitly named pre-migration backup and therefore discards writes after that cutoff.
- A failed or unavailable real provider is explicit and never becomes Mock. Mock is restricted to tests, CI, and explicit development flows.
- Course Packs are declarative, bounded, validated, and non-executable: no commands, scripts, plugins, credentials, provider sessions, arbitrary paths, or provider authority.
- Pi is behind Aptiloop-owned roles, policies, typed tools, storage, and deterministic state. Private data leaves the device only after an explicit action naming destination and scope.

## Current status

### Implemented baseline: M0–M11

The original implementation order is complete. These are orientation labels, not a closed task diary:

- **M0 — owner baseline:** product, architecture, security, migration, visual direction, licensing boundary, and release scope are recorded in the current specification set.
- **M1 — safety and provenance:** request/provider boundaries, secret handling, no-fallback behavior, backup admission, dependency policy, and repeatable verification are implemented.
- **M2 — Course foundations:** Course, immutable revisions, finite activities, sources/capsules, adaptations, session context, evidence, and quarantine-preserving additive migrations are implemented.
- **M3 — Course Pack lifecycle:** strict V1 validation, canonical hashing, Preview, transactional Install/Open-as-draft, export, and the version-matched Authoring Kit are implemented. No production Course is bundled; repository development fixtures remain separate.
- **M4 — Learning Kernel:** append-only facts, deterministic replay/projections, mastery, mistakes, review scheduling, correction, and next-action ownership are implemented; interview completion is not technical correctness or mastery.
- **M5 — Execution Fabric:** finite app-owned Node/Python checks, trusted isolated attempts, bounded execution, complete diff freshness, and read-only review evidence are implemented. Local execution remains trusted/unsandboxed, not a hostile-code sandbox.
- **M6 — Provider Hub and Pi boundary:** exact connection/model/capability resolution, finite role policies, disclosure, minimized provenance, cancellation, and explicit failures are implemented. AI Off remains fully usable.
- **M7 — identity, locale, and IA:** Aptiloop identity, complete `en-US`/`ru-RU` UI catalogs, locale-independent Course content, and Home/Courses/Review/Skills/Settings navigation are implemented.
- **M8 — Activity Frame:** Core Alpha activity renderers use the closed app-owned registry while the Learning Kernel retains transition authority.
- **M9 — Adaptive Studio:** manual Draft editing, validation, learner Preview, Change review, immutable Publish, personal adaptations, and explicit upstream integration are implemented.
- **M10 — typed Course Designer:** restart-safe typed proposals, Diagnostic and Learning Design stages, provenance, bounded repair, explicit disclosure, draft-only Apply, and separate manual Publish are implemented.
- **M11 — Course/session cutover:** product callers use explicit Course/revision/session context; global learner-pointer reads, hardcoded dashboard paths, and legacy mutation authority are retired or frozen while historical rows remain preserved, quarantined, or readable.

Normative detail is in [Product](PRODUCT.md), [Core Alpha scope](docs/product/core-alpha-scope.md), [Architecture](ARCHITECTURE.md), and the [documentation index](docs/README.md). The relevant architecture authorities are [Course Pack](docs/architecture/course-pack.md), [Learning Kernel](docs/architecture/learning-kernel.md), [Execution Fabric](docs/architecture/execution-fabric.md), [Provider Hub](docs/architecture/provider-hub.md), and [Deployment Models](docs/architecture/deployment-models.md).

### Implemented baseline: installed usability slices

The installed CLI/runtime, independent runtime and data roots, loopback proxy and origin boundary, per-user service/shortcut adapters, collision-safe port selection, Course transfer, actionable Pack diagnostics, safe-update/side-by-side revision upgrades, and Learning Design authoring stage are implemented. Current contracts and decisions are in [Deployment Models](docs/architecture/deployment-models.md), [ADR 0011](docs/adr/0011-collision-safe-install-port-selection.md), [ADR 0012](docs/adr/0012-course-transfer-scope-and-version-contract.md), [Course Pack](docs/architecture/course-pack.md), and [Course authoring](docs/product/course-authoring.md).

Owner decisions that remain authoritative:

- Preferred ports are web `10101` and orchestrator `8787`. Explicit flags, environment values, and persisted ports never hop; only an unpinned first bind may choose a free port and persist it. Reset explicitly rearms fallback.
- LearnerScope-only transfer is valid only when the target already has the exact Course revision and content hash. A new Course requires the full envelope; a missing exact revision fails closed. Schema/`formatVersion` mismatch is a hard error; originating app-version mismatch is informational.
- Course upgrades are exactly **safe-update** or **side-by-side**. Safe-update blocks an active old-revision session, preserves immutable history, and replays only surviving contracts; side-by-side carries no learner history.
- Authoring order is **Initial Brief → Discovery → Diagnostic when uncertainty warrants it → Learning Design → Course Proposal → User Review**, with an explicit assumption when Diagnostic is declined or skipped.
- [Deliberate-practice evolution](docs/deliberate-practice-evolution-proposal.md) remains **Proposed pending owner approval**, not current implementation or release evidence.

## Verification and evidence boundaries

**Implemented baseline:** the release-preparation tree based on `cc51455` has the following local evidence; this is not hosted CI or public-release acceptance:

- `npm run verify` passes format, lint, typecheck, fast tests, build, and production-content checks;
- E2E passes **8/8**; the repaired HTTP-admission suite passes **52/52**, and the complete orchestrator suite passes **352/352**;
- disposable `npm ci --ignore-scripts` passes with the reconciled lockfile, including `packages/update-core`;
- Next.js **16.3.4** and Sharp **0.35.4** close the reported high/critical dependency blockers. Production audit has **0 critical, 0 high, 1 moderate (Hono), and 1 low (esbuild)** finding; the full audit also reports two dev-only moderate findings. No exception or security-gate waiver was added.

The current Windows runtime archive has **9,344 verified file hashes**. The **16-file** npm tarball installs into a disposable prefix and runs `--version` (`0.1.0`) and `--help` against a locally prepared, hash-verified runtime. CycloneDX and SPDX SBOM generation passes. This smoke does not exercise public GitHub downloading, npm publication, or installed application startup; matching public runtime assets must exist before publishing the npm launcher.

Older evidence is cutoff-specific. The 2026-08-10 M12 technical preflight covered clean install, local/Compose launch, migration and backup/restore rehearsal, trusted Node/Python checks, SBOM/dependency policy, browser QA, and a 4/4 E2E run for that tree. It is historical implementation evidence, not proof for later commits or release acceptance. The 2026-08-12 UI/runtime hardening audit and 2026-08-13 production-readiness audit likewise retain their own dated scope; neither claims WCAG 2.2 AA certification or acceptance of later changes.

### Updater qualification

The updater is an **Implemented baseline** for installed releases: exact host asset selection, digest/SHA256SUMS agreement, bounded archive work, approved non-overwriting backup, candidate migration and health checks, serialized apply, and explicit failure/rollback handling exist. The 2026-09-10 local smoke on disposable Windows installed roots included bad-digest and migration rejection, lock handling, an active `0.1.0 → 0.1.1` update, and post-switch rollback C restoring the prior runtime/database and approved backup. This is local fixture/Windows evidence only. Public GitHub tagged-release operation, macOS/Linux runtime updates, and release-artifact qualification remain **UNVERIFIED**. Source-checkout and Compose apply remain refused/image-owned. See [Deployment Models](docs/architecture/deployment-models.md#installed-updater-baseline).

### Provider qualification

The 2026-08-10 M6 evidence includes one authenticated OpenCode Zen `deepseek-v4-flash-free` typed-role smoke through constrained Pi, exact disclosure consumption, minimized provenance, synthetic text, and observed cancellation in a disposable database. A fresh authenticated OpenCode Zen Tutor request was also observed on the 2026-08-13 production-readiness working tree, but it is not evidence for commit `b542b32` or for unexercised roles and recovery paths. These observations do not establish general provider availability, quality, retention, or production readiness. Course Designer and Interview pending-disclosure recovery have integration/remount evidence only; Course Designer recovery-preview freshness is narrower and must remain fail-closed at dispatch. See [Provider Hub](docs/architecture/provider-hub.md).

## M12 — Core Alpha release acceptance

**Status: Approved Core Alpha target.** M12 technical preflight, UI/runtime hardening, updater smokes, and provider observations are implementation evidence. They do not by themselves accept or publish Core Alpha. The release candidate must close the [Core Alpha release matrix](docs/product/core-alpha-scope.md#core-alpha-release-matrix), with fresh evidence attached to every applicable row.

Remaining release gates are grouped here for orientation:

1. Product terms, journeys, language, privacy, and non-goals remain internally consistent.
2. Course/revision/activity/source/capsule/adaptation/session contracts, immutable history, and Learning Kernel replay remain proven on representative data.
3. Pack hostile-input handling, provenance, canonical hashes, and no-execution boundaries remain closed.
4. Migration inventory, verified backup, additive upgrade, quarantine/reconciliation, representative-data rehearsal, and whole-file restore are proven for the release candidate.
5. Trusted Node/Python execution, workspace/diff freshness, cleanup, Review evidence, and explicit trusted/unsandboxed status are proven.
6. Provider auth/capability/tool/disclosure boundaries, explicit failure/no-fallback behavior, AI Off paths, and at least one qualifying authenticated real-provider typed role are proven for the exact candidate. A connected/catalog-visible provider alone is insufficient.
7. Manual Studio, optional typed AI proposals, Preview, Change review, and explicit immutable Publish remain separate gates; no AI action publishes.
8. Responsive desktop/mobile `en-US`/`ru-RU` journeys, keyboard/focus semantics, themes, honest empty/offline/Core/provider recovery states, and the accessibility target are verified. No complete WCAG 2.2 AA certification is currently claimed.
9. Current format/lint/typecheck/build/E2E and fast-test quality evidence remains clean for the exact release candidate; the local passing result above must not be substituted for hosted or platform-specific release gates.
10. Apache-2.0 project scope, third-party artifact compliance, content/fixture provenance and terms, notices/SBOM, trademark review, exact release artifact authorization, and owner sign-off are complete.
11. The supported local-process and loopback-Compose deployment remains loopback-only, with current backup/restore, secret, volume, execution-label, and operator-runbook evidence. Public/LAN/authenticated self-hosting is not an Alpha shortcut.

Fresh production and installed profiles start with an empty Course library. The development launcher installs only the two [Dev Tour fixtures](docs/development/dev-tour-course-packs.md). Any future production Course needs separate content, provenance, safety, licensing, and ownership approval.

## Future and explicit non-goals

Outside Core Alpha: accounts, multi-user state, cloud sync, collaboration, organizations, public hosting/LAN exposure, a marketplace or public Course catalog, hosted provider brokerage/failover, remote managed deployment, PostgreSQL operation, native mobile clients, arbitrary shell/filesystem/network authority, executable Pack scripts/plugins, autonomous model-owned state changes, Reviewer patches, and production Course distribution. Durable Pi AgentHarness lanes and additional environment contracts also require separate specifications and approval. None of this roadmap grants a future row implementation authority.
