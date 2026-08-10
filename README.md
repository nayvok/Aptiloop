# Aptiloop

Aptiloop is being specified as a local-first, single-user learning system for building durable technical skill through authored courses, deliberate practice, deterministic evidence, and optional AI assistance.

The runnable application remains the **Dev Learning Harness** in package identity while the UI now carries the Aptiloop identity. M1 safety containment and M2 Course foundations remain enforced; M3 provides the declarative Course Pack lifecycle, M4 the replay-complete deterministic Learning Kernel, M5 trusted app-owned Node/Python execution, M6 the constrained Pi Provider Hub, M7 the localized Calm Workshop application shell, M8 the closed Activity Frame registry, and M9 the AI-Off Adaptive Studio workflow with a separate Personal Adaptation Branch. The accepted M6 **Implemented baseline** routes active learning chat, interview, and evidence-only review through pinned constrained Pi adapters and exact Provider Hub contracts, with finite typed role tools, immutable one-time disclosure decisions, cumulative budgets, explicit failure states, and provider-turn provenance. An authenticated OpenCode Zen `deepseek-v4-flash-free` smoke completed through Pi with exact disclosure, persisted minimal provenance, and observed cancellation; no general provider-readiness claim follows from that synthetic smoke.

## Status vocabulary

Every current specification uses one of four labels:

- **Implemented baseline** — behavior observed in the current Dev Learning Harness.
- **Approved Core Alpha target** — a binding product contract for later implementation.
- **Proposed pending owner approval** — a recommendation that must not be implemented as settled scope yet.
- **Future** — intentionally outside Core Alpha.

Do not infer implementation from a target specification.

## Runnable baseline

**Implemented baseline**

The current repository is an npm/Turborepo monorepo with:

- a Next.js web application and Hono orchestrator;
- local SQLite persistence;
- a versioned learning path with creation-time hashed session snapshots;
- briefing, study, recall, Teacher dialogue, quiz, code-reading, exercise, review, interview, and summary flows;
- deterministic unit progression, summary derivation, and mastery rules;
- isolated exercise attempts, a Git baseline and visible patch, an allowlisted test command, and review that denies writes;
- a draft curriculum editor with clone, validation, ordering, and immutable publish behavior;
- a deterministic Mock learning provider plus legacy Codex app-server and OpenCode adapters that M1 policy blocks from every learning role.
- a strict single-file Course Pack validator, Preview/install/open-as-draft/export/uninstall flow, and version-matched Authoring Kit;
- an append-only deterministic Learning Kernel whose accepted facts rebuild progression, mastery, mistakes, review scheduling, and summary projections byte-for-byte;
- a trusted local Execution Fabric with opaque app-owned Node/Python environment and check IDs, structured evidence, snapshot freshness, and the compatibility-mapped existing exercise route.
- complete `en-US`/`ru-RU` UI catalogs, the five-destination Aptiloop shell, and a closed typed `ActivityFrame` renderer registry;
- an AI-Off Adaptive Studio workflow for manual Draft validation, Preview, immutable Publish/clone, and isolated personal adaptation/upstream integration.

The current interview report records completion and answer form. It does **not** establish technical correctness or change mastery. Pre-M3 snapshot bytes and unprovable migration relationships remain preserved; quarantined legacy data does not become valid Course truth. Git-ignored workspace state remains outside test/review freshness, and trusted local execution remains explicitly unsandboxed. Production Course content, complete legal approval, clean legacy cutover, release hardening, and public distribution are not implemented.

## Core Alpha direction

**Approved Core Alpha target**

Core Alpha is local-first and single-user. `Course` is the top-level entity. Published course revisions are immutable; each learner has a personal adaptation branch; learning is a finite activity graph; and the deterministic Learning Kernel owns progression, evidence interpretation, review scheduling, and mastery. Course content is carried by declarative, validated Course Packs. Packs contain no commands, scripts, secrets, or plugins.

Pi is the model/runtime layer behind Aptiloop-owned typed tools. It is not the product domain, permission system, or a general coding-agent surface. AI roles receive no arbitrary filesystem, shell, network, or edit tools. Reviewer is evidence-only: it receives only the bounded app-built review capsule and has no local tools or patch/apply authority. Real-provider failure is explicit; there is no silent fallback to Mock. Private learner data stays local unless the user explicitly exports or shares it.

The runtime research distinguishes the published `@earendil-works/pi-ai`, `@earendil-works/pi-agent-core`, and `@earendil-works/pi-coding-agent` v0.84.1 release at [tag commit `53fa77ccd8a279eb87e92294ef3687b03ff80112`](https://github.com/earendil-works/pi/tree/53fa77ccd8a279eb87e92294ef3687b03ff80112) from separately inspected post-release upstream source at [`9dd90a49711d088b86fdd9b4aea575913a8328`](https://github.com/earendil-works/pi/tree/9dd90a49711d088b86fdd9b4aea575913a8328), whose manifests still say 0.84.1. Pi is MIT-licensed but [does not provide a built-in permission system](https://github.com/earendil-works/pi/blob/9dd90a49711d088b86fdd9b4aea575913a8328/README.md#L35-L41). Its AgentHarness implementation is not a durable app runtime: restore and major operations remain unimplemented, and the v4 SQLite SessionRepo is not transparently interchangeable with coding-agent's JSONL `AgentSession`.

See:

- [Product contract](PRODUCT.md)
- [Core Alpha scope](docs/product/core-alpha-scope.md)
- [User journeys](docs/product/user-journeys.md)
- [Terminology](docs/product/terminology.md)
- [Language policy](docs/product/language-policy.md)
- [Course authoring](docs/product/course-authoring.md)
- [Architecture](ARCHITECTURE.md)
- [Design and visual alternatives](DESIGN.md)
- [Security policy](SECURITY.md)
- [Migration strategy](docs/migration/core-alpha-migration-strategy.md)
- [M2–M5 data model](docs/data-model.md)
- [M2 migration and recovery runbook](docs/migration/m2-course-foundations-runbook.md)
- [Roadmap](ROADMAP.md)
- [Central audit and complete specification index](docs/audits/2026-08-08-core-alpha-repository-audit.md)
- [M1 safety-boundary and private-data inventory](docs/audits/2026-08-08-m1-safety-boundary-inventory.md)

## Requirements

- Node.js 24 or newer (the package manifest declares `>=24.0.0`)
- npm 11 (the repository pins `npm@11.12.1`)
- Git
- Zed, optional for opening an exercise workspace
- Codex CLI or OpenCode CLI only for separate legacy adapter diagnostics; M1 blocks both from learning roles
- Docker with Compose, optional for the Mock-oriented container setup

This is an npm-only workspace with one `package-lock.json`. Do not use pnpm, Yarn, or `workspace:*` dependency ranges.

## Local startup gate

Install dependencies from the repository root:

```sh
npm install
```

The current binary admits only the exact `0000`–`0013` schema contract, SHA-256 `1e32db9cc459f342b32808f3594f79b785f89de8872cc9438e9d890711104da7`, at the authoritative active/container path. Fresh and forward-migrated disposable databases converge on that contract. A read-only active-database inventory on 2026-08-10 observed all 14 migrations through `0013`, the same schema hash, `integrity_check=ok`, zero foreign-key violations, coherent legacy compatibility, reconciled M2 accounting, and zero target orphans. Only the explicitly authorized backup-bound migration command may admit an exact predecessor from `0000`–`0005` through `0000`–`0012` long enough to apply missing forward migrations. Any ledger, schema, trigger, integrity, foreign-key, provenance, immutable-history, or ownership mismatch fails closed.

On a genuinely fresh installation where no active database exists, `npm run dev` may reserve and bootstrap a new active database. If startup passes the gate, open <http://127.0.0.1:3000>. The orchestrator defaults to <http://127.0.0.1:8787>; readiness is exposed at <http://127.0.0.1:8787/health/ready>. The web server rewrites `/api/*` to the orchestrator.

`npm start` invokes `scripts/dev-local.mjs` and attempts to launch only the local Aptiloop stack. It does not start Codex, OpenCode, or any external sidecar. A root `.env` is optional; copy `.env.example` only when local overrides are needed.

### Optional OpenCode Zen provider smoke

The Provider Hub registers OpenCode Zen through the constrained pinned Pi adapter. It does not use the legacy OpenCode sidecar or expose coding-agent tools. Set `OPENCODE_API_KEY` only in the local process environment or untracked root `.env`, then run:

```sh
npm run smoke:provider:opencode
```

The smoke uses the exact `deepseek-v4-flash-free` model and synthetic text in a disposable database. It requires and consumes an explicit disclosure, observes one authenticated completion, verifies minimal persisted provider-turn provenance, starts a second authenticated turn, and verifies cancellation. It prints no prompt, response, credential, learner content, path, or provider metadata.

Before a writable SQLite PRAGMA, startup rechecks the selected exact contract, file identity, logical contents, integrity, foreign keys, complete M2–M5 schema, reconciled migration provenance, zero target orphans, immutable snapshots/Pack/kernel/execution history, environment/check ownership, and active-session accounting. A current session must have exact target Course context; an older missing context is tolerated only with the complete matching M2 quarantine provenance. Unknown or unaccounted identities fail closed.

Inventory the explicit active database before any future data migration. The authorized additive migration command uses `--authorize-current`; the historical `--authorize-m2` alias remains accepted for recorded M2 procedures. Every write requires a newly named, non-overwriting, active-source-only approved backup plus the exact backup SHA-256:

```sh
npm run db:inventory -- --db .data/dev-learning-harness.sqlite
npm run db:backup -- --source .data/dev-learning-harness.sqlite --destination .data/approved-backups/<new-pre-migration-name>.sqlite
npm run db:migrate -- --authorize-current --approved-backup .data/approved-backups/<approved-name>.sqlite --backup-sha256 <sha256>
```

The migration command re-verifies source and backup identity, integrity, foreign keys, exact ledger/schema/trigger contracts, logical lineage, private-payload gates, immutable Pack/kernel/execution relationships, and a whole-file recovery rehearsal before writing. It applies every missing additive migration transactionally and reports a verified no-op on replay. It never selects an old or quarantined backup automatically. After commit there is no down migration; rollback is a stopped-writer whole-file restore from the explicitly approved pre-migration backup and discards every later write.

## Root commands

These commands exactly match the root `package.json` scripts:

```sh
npm run build           # turbo run build
npm run dev             # local Aptiloop development launcher; no external sidecar
npm start               # local Aptiloop launcher; no external sidecar
npm run audit:policy    # full + production classification; shipped installed-tree gate
npm run format          # write formatting changes
npm run format:check    # check formatting
npm run sbom            # CycloneDX npm SBOM
npm run smoke:provider:opencode # authenticated OpenCode Zen/Pi smoke; requires OPENCODE_API_KEY
npm run lint
npm run typecheck
npm test                # fast tests, then E2E
npm run test:fast       # Turbo unit/integration/component tests
npm run test:e2e        # lock-serialized Playwright wrapper
npm run db:generate
npm run db:inventory    # explicit read-only SQLite family inventory
npm run db:backup       # explicit active-source approved backup
npm run db:migrate      # fresh bootstrap, or explicit backup-bound M2 migration/replay
npm run db:seed         # exact dual admission; seeds data without implying schema upgrade
npm run verify          # format, lint, typecheck, fast tests, build; excludes E2E
```

The Playwright wrapper uses unique launcher-owned data and fixed lock-serialized loopback ports (`127.0.0.1:3100` and `127.0.0.1:8887`); it fails closed if either port is occupied, does not provide parallel port isolation, uses zero retries, and restores `apps/web/next-env.d.ts` after success or failure. An exclusive owner marker plus authenticated heartbeat binds the suite to its canonical run directory, and service watchdogs require both that owner process and the expected launcher lineage. Successful runs delete their owned root; failed runs retain only traces/results and service logs under `.verify/e2e-failures/<run-id>/` before deleting disposable database, attempt, and Next data.

## M2 accepted Course foundation baseline

**Implemented baseline.** M2 local acceptance evidence on 2026-08-09 establishes:

- strict shared contracts for Course, immutable Course Revision lineage, sections, lessons, finite typed Activity graphs, Source Snapshots, Knowledge Capsules, personal Adaptation Branches, session Course contexts, typed append-only Evidence, and Review Items;
- deterministic graph validation rejects unknown activity/evidence types, missing or cross-scope prerequisites, duplicate stable meaning, and cycles before persistence;
- SQLite migrations `0006_course_foundations` through `0010_m2_quarantine_immutability` add the target tables and guards, preserve migrated revision lineage, normalize admitted predecessors to one exact schema, close Course/session compatibility authority, freeze accepted revision metadata, validate snapshot envelopes and legacy ownership, and make every `m2-v1` quarantined source revision immutable without dropping or rewriting legacy source rows;
- Course-scoped list/path APIs and v2 start/resume reads use target Course ownership. Existing migrated sessions remain runnable only through exact `m2-v1` revision/lesson/snapshot quarantine provenance; unknown or unaccounted missing contexts fail closed;
- each active write used a newly named active-source-only approved backup: pre-M2 `.data/approved-backups/2026-08-09T15-00-16Z-pre-m2-active.sqlite` (`501338c295589d8367a31a1082ef7469ca0e22bb91e6a3123abdb94b70220f1b`), pre-`0008` `.data/approved-backups/2026-08-09T16-19-35Z-pre-m2-correction-active.sqlite` (`a09332dde7732b43b2ca6b9734bd5201fc6d71449c7c3d7303824d845418af09`), pre-`0009` `.data/approved-backups/2026-08-09T22-54-00Z-pre-m2-hardening-active.sqlite` (`9dc4b6af0c5e5a9b73cfa3e4f38240703d023f37ada6c3e0fa297dbe4aa22da2`), and pre-`0010` `.data/approved-backups/2026-08-09T23-34-00Z-pre-m2-quarantine-immutability-active.sqlite` (`bc325e8314117a3eb073ae015a5daf72ec3b4ea3f7f74aadfbfbe34a25c57f4d`);
- final post-migration inventory reports schema SHA-256 `a6a1543e468e3dbb90494bc6e5d5598933e22dd0cf49a9830f82ee695eda5a01`, migrations `0000`–`0010`, `integrity_check=ok`, zero foreign-key violations, zero target orphans, zero unaccounted active sessions, zero target private-payload bytes, exactly one immutable run for each of `m2-v1` through `m2-v4`, and the unchanged reconciled `572 = 2 mapped + 526 quarantined + 44 intentionally-unmapped` source-row manifest;
- the post-`0010` runtime returned ready/connected health, rendered the Course-owned Path, resumed a retained active session, and produced no observed browser console or page errors on the exercised path. After review remediation, `npm run verify` passed formatting, 12/12 lint tasks, 12/12 typecheck tasks, 21/21 fast-test tasks with 614 tests passed and 3 skipped, and 12/12 builds; `npm run test:e2e` passed 4/4. Independent correctness and security/data-migration re-reviews returned PASS with no remaining M2 blocker. A final explicit active/backup inventory reconfirmed stable identities, the active `0000`–`0010` schema, `integrity_check=ok`, zero foreign-key violations, zero unaccounted active sessions, zero target orphans/private-payload bytes, and the exact pre-`0010` backup binding. No hosted GitHub Actions result or external-provider smoke is claimed.

M2 does not import Course Packs, populate production Source Snapshots/Capsules, resolve the 526 quarantined rows, remove legacy tables, redesign the UI, or begin M3. See the [M2 data model](docs/data-model.md) and [migration/recovery runbook](docs/migration/m2-course-foundations-runbook.md).

## M3–M5 implemented Core Alpha boundaries

**Implemented baseline.** Local acceptance evidence on 2026-08-10 establishes:

- M3 accepts one bounded UTF-8 JSON document, rejects duplicate keys, limits, unsafe paths/URLs, secret- or authority-bearing data, invalid graphs/locales/provenance/hashes, and unknown trusted requirements before any install. Validation uses a private expiring staging directory; commit revalidates the exact bytes/hash and installs transactionally. The Courses UI exposes Preview, explicit Install/Open as draft, canonical export, and confirmed archival uninstall without deleting learning history;
- `@dlh/course-authoring-kit` owns Course Pack V1 schemas, canonical JSON/SHA-256, deterministic diagnostics, the generated JSON Schema, a development-only fixture, and the `validate`, `canonicalize`, `hash`, and `finalize` CLI commands used by the importer;
- M4 records closed, versioned Learning Kernel facts and replay-complete projections through migration `0012_learning_kernel`. The pure reducer owns legal progression, next action, objective evaluation effects, mastery replay state, mistake/review scheduling, correction supersession, interview non-correctness, and canonical projection hashes. Legacy facts are adapted with provenance only where their meaning is provable; ambiguous summaries are quarantined rather than promoted;
- M5 migration `0013_execution_fabric` binds attempts and test evidence to exact environment/check IDs. The existing exercise route now resolves the compatibility Node check through the generic local-native Fabric, while built-in Node 24 and Python 3 contracts enforce app-owned process plans, lock/runtime checks, minimal environments, bounded output/time, cancellation/process cleanup, complete-workspace snapshot freshness, and normalized evidence. This remains trusted local execution, not a sandbox;
- focused Course Pack, kernel, persistence, summary, and Execution Fabric suites pass. The integrated `npm run verify` gate and `npm run test:e2e` (4/4 Chromium flows) pass after the learner-safe quiz projection retains the learner score while continuing to redact answer keys.

These milestones do not approve production Course content, third-party Environment Packs, arbitrary or untrusted execution, Pi/provider migration, Adaptive Studio, target navigation/localization, public distribution, or deletion of the 526 preserved quarantine rows.

## M1 accepted containment baseline

**Implemented baseline.** M1 local acceptance closed on 2026-08-09 after independent security and correctness re-review and a refreshed integrated gate; the recorded evidence is:

- Mock is the only learning provider for Teacher, Reviewer, Interviewer, Curator, and Codex Expert in explicit development/test mode; all provider readiness endpoints enforce the same policy without activating blocked adapters, browser bodies cannot select a provider/model, external failure does not fall back, and `npm start` launches no sidecar;
- new agent messages store `tool_events_json='[]'` and `raw_event_json=NULL`, new reviews store no raw response, browser events are allowlisted under an opaque app turn UUID, and v1 learning mutations return 410 while v2 stays operational;
- direct unauthenticated operation is loopback-only; Compose's explicit internal wildcard mode retains loopback-only host publication; API responses are no-store;
- read-only inventory found six database families and eleven pre-existing backups, zero logical non-empty tool/raw rows, and no basis for a cleanup migration. Byte absence in free pages/WAL/SHM is not proven. One family is active; runtime and writable database CLIs now reject every alternate family before opening it. Five families and all eleven old backups remain quarantined. The approved active-only preflight requires the exact approved `0000`–`0005` ledger, the named legacy schema, private-payload gates, and active-session data invariants; it created two verified, non-overwriting point-in-time backups under `.data/approved-backups/`;
- the current production dependency audit is zero, and the full installed-tree audit has one low graph-dev-only transitive esbuild advisory reported without an exception. Because the orchestrator image currently copies the full root `node_modules` tree, the policy blocks High/Critical findings across that shipped installed tree rather than only production-classified findings. `npm ci` and the refreshed `npm run verify` passed; the latter covered all 12 workspace lint, typecheck, test, and build tasks (656 fast tests). The post-remediation ownership/lock suite passed 30/30, including transient heartbeat-read recovery followed by persistent ownership-loss termination and authenticated dead-run scavenging that preserves live or ambiguous service processes; two consecutive lock-serialized E2E runs passed 4/4, with the first removing the previously retained proven-dead run root. Browser smoke exercised server-owned provider display, explicit unavailable-provider state, and persisted theme mutation/restoration. Independent reviewers closed every reported M1 security and correctness finding. Committed CI classifies audit output, emits a CycloneDX SBOM, and defines the same fast, E2E, and build gates. No hosted GitHub Actions run is claimed.

See the [M1 inventory and operator runbook](docs/audits/2026-08-08-m1-safety-boundary-inventory.md).

## M0 audit evidence

**Implemented baseline**, observed for this audit on local `main` after consolidating the preserved baseline into immutable branch `old`:

- local `main`, `old`, and `docs/core-alpha-audit` preserve the consolidated baseline at `0ba8dee`; `origin/main` remains at `053dcd0`, `old` is immutable, and the M0 approval-package refinements are uncommitted changes on local `main`;
- `npm install` succeeded and left the then-current baseline clean;
- a disposable SQLite database migrated successfully and seeded twice, yielding 7 days, 14 topics, 5 curriculum versions, and 324 units; `PRAGMA integrity_check` and `PRAGMA foreign_key_check` passed, and the backup CLI produced a non-overwriting integrity-checked copy;
- `npm run verify` passed formatting, 12/12 lint tasks, 12/12 typecheck tasks, 21/21 fast-test tasks totaling 352 tests, and 12/12 build tasks; the web build produced 12 static Next routes;
- `npm run test:e2e` was **red**: 1 test passed and 3 failed. The web server repeatedly emitted fatal Turbopack `Next.js package not found` errors while writing `/session/page`, `/settings/curriculum/page`, and `/interview/page`; missing `План дня` and Interview controls plus repeated Curriculum Editor navigation were downstream observed symptoms;
- a disposable 1440×900 browser smoke loaded Home, started a session, opened the plan drawer, and showed no observed console errors;
- at 390×844 there was no horizontal overflow, but Home was a dense 3414 px page and the mobile navigation was overfull;
- `npm audit` reported 6 vulnerabilities: 4 high, 1 moderate, and 1 low. Relevant locked versions include Hono 4.12.33, Next 16.2.12, nested PostCSS 8.4.31, sharp 0.34.5, nanoid 3.3.16, and tsup esbuild 0.27.7;
- at that M0 snapshot, the GitHub API showed zero issues and zero pull requests, and no CI workflow was committed.

Those M0 results were not a release approval. The accepted M1 and M2 evidence and remaining limitations are recorded above.

## Privacy and trust boundary

The current application is intended for trusted local use. Browser requests must never supply executables, argument vectors, working directories, filesystem handles, credentials, or raw provider RPC. Paths remain canonical and contained. Child processes remain allowlisted, `shell: false`, bounded by time/output limits, and cleaned up. An allowlist prevents command injection; it does not sandbox trusted JavaScript fixtures.

**Approved Core Alpha target:** Course Packs and activities are data, never executable authority. Environment execution uses app-owned contracts and trusted check IDs. Provider credentials stay outside packs and learner records. No private course, source, workspace, evidence, transcript, or profile data is uploaded or shared without an explicit user action.

## Approval state

M1 containment through M9 Adaptive Studio manual authoring are accepted **Implemented baseline** as of 2026-08-10. M6 active role callers use Provider Hub, browser disclosure approval is exact and one-time, cumulative budgets fail closed, and sentinel/adversarial matrices cover the constrained boundary. M7 provides complete UI catalogs and primary navigation; M8 routes Core Alpha activities through the closed renderer registry; M9 keeps upstream and personal revisions separate and creates a new personal Draft for explicit upstream integration. The exact OpenCode Zen `deepseek-v4-flash-free` authenticated smoke completed through Pi using synthetic text and a disposable database; it consumed explicit disclosure, persisted minimal provider/model provenance, and observed cancellation. M10 is unblocked; production content, licensing, migration-cutover, and release gates remain open.

The valuable active database was inventoried before M6, backed up without overwrite to `.data/approved-backups/2026-08-10T08-55-12Z-pre-m6-provider-hub.sqlite` (whole-file SHA-256 `8e459eea9576b688498b6d275f6e4cbeda13b77e030dbd2b7049196229028f07`), migrated additively through `0014_provider_hub`, and replayed as a verified no-op. The post-migration inventory observed schema SHA-256 `dce93b3d8714eac8ab01bce0d98f136e6cb5bc4205674d4cea618a7ccfb24409`, `integrity_check=ok`, zero foreign-key violations, coherent legacy/session accounting, unchanged immutable snapshot inventories, and zero logical raw/tool provider payload rows.

Before M9, the active database was re-inventoried and backed up without overwrite to `.data/approved-backups/2026-08-10T11-54-00Z-pre-m9-personal-adaptation.sqlite` (whole-file SHA-256 `475c30c6dcc196bfc8fb135fc77d4180abc4f0032181814d01f3f0719327266f`). Additive migration `0015_adaptive_studio` reached schema SHA-256 `4bc021f2fa2807738aa429c58d743d9f8cbe441824b8f063dde9e5fc50d0e55f`; exact admission then reported the database already current. The migration retains M2 provenance hashes over their original source-column contract while adding personal-branch metadata.
