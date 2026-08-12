# Aptiloop Security Policy

**Document status:** **Approved Core Alpha target** with **Implemented baseline** controls identified below. Target controls are not claimed as implemented.

## Supported security scope

Aptiloop Core Alpha is a local-first, single-user application. The supported network boundary is loopback only. The current HTTP API has no user authentication. `Origin` checks and the fixed client header reduce accidental browser-origin requests, but neither is authentication and neither makes non-loopback exposure safe.

The application treats browser input, AI output, Markdown, imported content, database JSON, file paths, archives, private sources, and provider responses as untrusted. Current native exercise execution is trusted-code execution with local-user authority; it is not a sandbox.

The following status labels are normative throughout the Core Alpha documents:

- **Implemented baseline** — directly observed in the current repository; not necessarily sufficient for Core Alpha approval.
- **Approved Core Alpha target** — required behavior, not a statement of implementation.
- **Proposed pending owner approval** — a design or policy choice that requires an explicit owner decision.
- **Future** — outside Core Alpha or dependent on a later capability.

## Reporting a vulnerability

Report suspected vulnerabilities privately to the repository owner through an access-controlled project channel. Do not include credentials, learner data, private-source content, exploit payloads, or database copies in a public issue. If no private channel is available, send only a minimal request for a secure reporting channel.

Include, when safe:

1. affected revision and operating mode;
2. threat/control ID from the documents below, if known;
3. reproducible steps using synthetic data;
4. observed and expected result;
5. impact and required preconditions;
6. whether a credential or private record may have been exposed.

Do not test against another person's installation, provider account, or data. Rotate any credential that may have crossed a process, log, tool event, database, or backup boundary.

No response-time or remediation-time commitment is established by this documentation.

## Historical M1 containment evidence

**Implemented baseline** at the M1 cutoff: external learning roles were blocked and deterministic Mock was permitted only in explicit development/test mode. This was containment before Provider Hub caller cutover, not the current provider topology. Legacy Codex/OpenCode adapters remain blocked from learning authority; no failure substitutes Mock.

Direct unauthenticated operation is fail-closed to exact loopback hosts. Only the explicit Compose mode may bind the container service to `0.0.0.0`, with host publication still fixed to `127.0.0.1`. All API responses are `Cache-Control: no-store`; mutation Origin/client/media-type checks remain request-shape controls, not identity.

The active process database and writable database CLIs are fixed to `.data/dev-learning-harness.sqlite`; Compose permits exactly `/data/dev-learning-harness.sqlite`, and disposable paths require explicit test ownership. Approved backups require the exact migration ledger and complete private-payload tables before copying.

The [M1 private-data inventory](docs/audits/2026-08-08-m1-safety-boundary-inventory.md) observed six database families and eleven backups with zero logical non-empty raw/tool rows. This does not prove byte absence in SQLite free pages, WAL/SHM, snapshots, or external copies. One family is active; five families and all eleven existing backups are preserved and quarantined under the approved 2026-08-08 disposition. No cleanup migration or user-data mutation was performed.

## Historical M2 data and migration evidence

**Implemented baseline** at the 2026-08-09 M2 cutoff: migration was an explicit, backup-bound maintenance operation rather than startup repair. Current valuable-data operations retain that boundary and use `--authorize-current`, an exact `--approved-backup`, and its `--backup-sha256`; see [Current Database Operations](docs/migration/current-database-operations.md).

The repository's current SQLite migration contract is the exact `0000`–`0019` ledger. `0019_provider_connection_retirement` adds the tombstone used to remove active provider configuration while preserving historical evidence. Ordinary startup admits that current contract without rewriting history; advancing an admitted predecessor with valuable data requires the explicit backup-bound operation above.

The target schema uses composite Course/revision/lesson/activity ownership, immutable published/archived content, immutable session contexts/snapshots, append-only Evidence and migration records, constrained type registries, and explicit orphan inventory. Browser Course operations carry only entity and operation IDs. Unknown activity/evidence types, cross-scope references, missing context, and unaccounted active sessions fail closed.

Compatibility does not promote quarantined data. A migrated session without a target context is readable only when its exact source revision, lesson, and session snapshot have `m2-v1` quarantine provenance and all stored scope/hash bindings agree; otherwise the request is rejected before provider or process work. `0010_m2_quarantine_immutability` prevents update or deletion of every quarantined source revision used by that proof. The active run preserves 526 unresolved quarantine rows and all legacy source rows. The approved pre-M2, pre-`0008`, pre-`0009`, and pre-`0010` backups remain plaintext local data and are supported whole-file rollback points only at their recorded cutoffs.

Final post-review evidence on 2026-08-09: `npm run verify` passed formatting, 12/12 lint tasks, 12/12 typecheck tasks, 21/21 fast-test tasks with 614 tests passed and 3 skipped, and 12/12 builds; `npm run test:e2e` passed 4/4. Independent correctness and security/data-migration re-reviews returned PASS with no remaining M2 blocker. A final explicit active/backup inventory reconfirmed stable identities, the exact active `0000`–`0010` schema, `integrity_check=ok`, zero foreign-key violations, zero unaccounted active sessions, zero target orphans/private-payload bytes, and the exact pre-`0010` backup binding. No hosted GitHub Actions result or external-provider smoke is claimed.

## M6 Provider Hub status

**Implemented baseline:** Active Chat, Interview, evidence-only Review, and Course Designer callers resolve one exact server-owned RoleProfile, connection, and model through Provider Hub and constrained pinned Pi adapters. Readiness requires the connection to be enabled, connected, authenticated, the exact configured model to be observed as available, and all required capabilities to be present. Default-deny typed tools, single-consumption disclosure operations, cumulative turn budgets, cancellation, and secret-free terminal provenance are app-owned. Legacy Codex/OpenCode authority remains blocked and no failure substitutes another connection, model, provider, or Mock.

Settings exposes reviewed connection factories and a recovery path to add a managed connection for metadata-less legacy entries. API keys and subscription tokens enter only the explicit loopback mutation, are stored connection-scoped in `.data/provider-credentials.json`, and are never returned in browser responses or stored in browser persistence, SQLite, prompts, Course Packs, or logs. Windows stores a strict whole-file envelope protected by current-user DPAPI and migrates a valid legacy plaintext file only after successful encrypted atomic replacement. Protection or decryption failure is explicit and never falls back to plaintext. POSIX systems retain plaintext storage with an owner-only mode request. Replacement and local removal are explicit operations; removal does not assert upstream provider revocation. Built-in providers own their endpoints; local compatible endpoints are loopback-only; custom compatible endpoints require an explicit public HTTPS hostname on the default TLS port and a path ending in `/v1`.

Course Designer pending-disclosure lookup matches the Course revision and workflow and requires a stored authoring-operation identity. It does not rederive the current Draft payload during recovery GET; a changed Draft can surface a stale preview, which payload-hash validation then rejects before provider dispatch. The browser stores no outbound provider payload, and approval/cancellation remains separate from proposal Apply and manual Publish.

Only the authenticated OpenCode Zen `deepseek-v4-flash-free` disposable smoke is recorded as observed real-provider evidence. Catalog presence, stored credentials, or health metadata are not evidence that another provider/model completed a request. Every external private-data turn remains disclosure-gated; no failure silently selects another provider, model, or Mock.

## Current risk summary

The complete records, including attack path, impact, existing mitigation, source fix, and required test, are in [docs/security/threat-model.md](docs/security/threat-model.md).

| ID                | Rank   | State                      | Summary                                                                                                                                                       |
| ----------------- | ------ | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SEC-AI-001        | High   | Implemented baseline       | Active AI roles use exact server-owned Provider Hub profiles; legacy Codex/OpenCode learning authority remains blocked.                                       |
| SEC-REVIEW-001    | High   | Implemented baseline       | Reviewer receives only a bounded evidence capsule and has no write, patch, filesystem, process, or network tool.                                              |
| SEC-CRED-001      | High   | Implemented baseline       | Connection-scoped credentials enter only the explicit Settings mutation, then remain out of responses, browser persistence, SQLite, prompts, packs, and logs. |
| SEC-AI-002        | High   | Implemented baseline       | Finite app-owned typed tool policies default-deny provider/general tools and persist no raw tool/provider payload.                                            |
| SEC-NET-001       | High   | Implemented baseline       | The app API is loopback-only; local model endpoints are loopback-only and custom model endpoints require explicit public HTTPS configuration.                 |
| SEC-INTEGRITY-001 | High   | Implemented baseline       | Provider output cannot directly mutate deterministic mastery/progression; accepted facts remain app/kernel owned.                                             |
| SEC-PROVIDER-001  | High   | Implemented baseline       | Exact connection/model resolution, capability checks, disclosure, and failure behavior are server-owned with no fallback.                                     |
| SEC-EVIDENCE-001  | High   | Implemented baseline       | Reviewer output is non-authoritative advice and cannot independently emit correct mastery evidence; trusted checks remain the authority.                      |
| SEC-RELATION-001  | High   | Implemented baseline       | Teacher and Interview evidence is server-proven against the exact Course/session/Activity/conversation/interview/report relationships.                        |
| SEC-DIFF-001      | High   | Implemented baseline       | Freshness binds a canonical complete-workspace SHA-256 and complete non-truncated diff to the exact check/review evidence.                                    |
| SEC-MIGRATION-001 | High   | Implemented baseline       | M2 is explicit, backup-bound, byte-preserving, quarantined, transactionally verified, and replay-safe.                                                        |
| SEC-AI-003        | Medium | Implemented baseline       | Provider turns enforce cumulative input/output/event/tool-call/deadline budgets across reused sessions.                                                       |
| SEC-CANCEL-001    | Medium | Implemented baseline       | Cancellation propagates through the common provider runner, evicts the session, and cannot commit success.                                                    |
| SEC-SUPPLY-001    | Medium | Implemented baseline       | At the 2026-08-09 audit cutoff, shipped installed-tree High/Critical was zero and one low graph-dev-only esbuild advisory was reported.                       |
| SEC-WEB-001       | Low    | Approved Core Alpha target | Automatic external-resource behavior in untrusted Markdown remains a privacy hardening gate.                                                                  |
| SEC-HTTP-001      | Low    | Approved Core Alpha target | Remaining pre-parse body/concurrency limits must be evidenced without treating request-shape controls as authentication.                                      |
| SEC-DATA-001      | Low    | Approved Core Alpha target | Private SQLite, credential, and backup files are plaintext and need complete retention/export/delete policy before broader deployment.                        |
| SEC-PACK-001      | High   | Implemented baseline       | Course Pack V1 is strict declarative data and cannot supply executable/process/provider authority.                                                            |
| SEC-EXEC-001      | High   | Future                     | Executing untrusted content requires a separately reviewed isolated backend.                                                                                  |

## Positive controls to preserve

**Implemented baseline:** strict mutation schemas; direct loopback bind enforcement; explicit internal-only Compose wildcard mode with loopback host publication; exact Origin/client/JSON checks; API-wide `no-store`; protected-answer redaction; server-owned Provider Hub profiles; connection-scoped local credentials; constrained pinned Pi adapters; default-deny finite typed role tools; evidence-only Reviewer; single-consumption external disclosure bound at dispatch to role, connection, provider, model, payload hash, status, and expiry; cumulative turn budgets and cancellation; server-proven Teacher/Interview relationships; complete-workspace and diff SHA-256 freshness; browser event allowlisting and opaque app turn IDs; minimized provider-turn provenance; immutable Course/session/kernel facts; declarative Course Pack validation; trusted app-owned execution plans; sanitized production build/runtime environments; supervised service-tree cleanup; and bounded cancellation/draining of active trusted checks before SQLite shutdown.

These controls reduce specific risks. They do not authenticate a remote client, sandbox native execution, encrypt SQLite or POSIX/Linux credential storage, protect Windows credentials from a process already running as the same OS user, prove migrated/deleted plaintext bytes absent from filesystem history or snapshots, guarantee any provider's price/retention/availability, or establish authenticated smoke evidence for every catalog entry. The authenticated OpenCode Zen smoke proves only that exact reviewed path. Custom external endpoints remain an advanced user-directed disclosure destination, not a general model network proxy. Mock remains test/CI/development infrastructure and is not production model evidence.

## Core Alpha security rules

**Approved Core Alpha target:**

- in process mode, bind the unauthenticated application only to loopback and fail closed on non-loopback configuration; in the approved local Compose profile, allow internal wildcard service binds only behind a verified private network with every host publication fixed to loopback;
- expose AI only through Aptiloop-owned, typed, per-role tools; expose no arbitrary filesystem, shell, network, or edit tools;
- make Reviewer evidence-only: provide only the bounded app-built review capsule, no local filesystem/general tools, and no patch/apply authority;
- keep the deterministic Learning Kernel authoritative for state, evidence, and mastery;
- accept only declarative, validated Course Packs with no commands, scripts, secrets, plugins, or executable hooks;
- execute only server-owned trusted check IDs through the Execution Fabric, with explicit Node and Python environment contracts;
- never silently fall back from a real provider to Mock; Mock is for test, CI, and explicit development only;
- never upload or share private data or private sources without a separate explicit user action at the point of disclosure;
- bound untrusted input, output, event count, persistence size, runtime, and storage growth;
- minimize sensitive persistence and define export, retention, backup, and deletion behavior.

## Approval gates

Core Alpha security approval requires all of the following evidence:

1. every present High finding is fixed at its source and its listed regression test passes;
2. legacy integrity-bypass writes are migrated or removed without losing historical rows;
3. dependency audit output records all advisory IDs, affected ranges, reachability, disposition, owner, and expiry for any exception;
4. malicious Markdown, provider-output, environment-sentinel, path/archive, and cumulative-budget tests pass;
5. loopback fail-closed behavior is exercised; spoofed Origin/client headers are not described as authentication;
6. private-data inventory, no-store behavior, retention/export/deletion, and backup handling are verified;
7. no untrusted Course Pack field or imported artifact can reach native process execution;
8. external-provider smoke evidence is recorded per provider and never represented by Mock success.

**Historical observation (2026-08-09):** final local M1 evidence reported zero High/Critical findings in the full installed tree, zero production vulnerabilities, and one low graph-dev-only transitive esbuild advisory (`GHSA-g7r4-m6w7-qqqr`). This remains dated **Implemented baseline** evidence, not a claim about the current working tree, hosted CI, or complete Core Alpha security approval.

## Detailed specifications

- [Threat model and remediation register](docs/security/threat-model.md)
- [Untrusted Course Packs](docs/security/untrusted-course-packs.md)
- [Execution isolation](docs/security/execution-isolation.md)
- [AI boundaries](docs/security/ai-boundaries.md)
- [Secrets and private sources](docs/security/secrets-and-private-sources.md)
- [M1 safety-boundary and private-data inventory](docs/audits/2026-08-08-m1-safety-boundary-inventory.md)
- [M2 migration and recovery runbook](docs/migration/m2-course-foundations-runbook.md)
- [Current database operations](docs/migration/current-database-operations.md)
- [Core Alpha licensing plan](docs/licensing/core-alpha-licensing-plan.md)
