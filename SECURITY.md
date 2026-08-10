# Aptiloop Security Policy

**Document status:** Approved Core Alpha target. Implemented baseline findings are explicitly identified below; target controls are not claimed as implemented.

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

## M1 containment status

**Implemented baseline:** Mock is the only permitted learning provider for Teacher, Reviewer, Interviewer, Curator, and Codex Expert, and only in explicit development/test mode; unset, misspelled, or production runtime mode is honest no-AI. Codex/OpenCode remain legacy adapters but are blocked at the orchestrator; browser bodies cannot override provider/model, readiness endpoints do not activate blocked adapters, and failure never substitutes Mock. `npm start` launches no external sidecar. Codex children use a minimal explicit environment, OpenCode tool lifecycle normalization drops provider inputs/outputs, browser events expose only an allowlist under an opaque app turn UUID, and new persistence stores no raw provider/tool/review payload.

Direct unauthenticated operation is fail-closed to exact loopback hosts. Only the explicit Compose mode may bind the container service to `0.0.0.0`, with host publication still fixed to `127.0.0.1`. All API responses are `Cache-Control: no-store`; mutation Origin/client/media-type checks remain request-shape controls, not identity.

The active process database and writable database CLIs are fixed to `.data/dev-learning-harness.sqlite`; Compose permits exactly `/data/dev-learning-harness.sqlite`, and disposable paths require explicit test ownership. Approved backups require the exact migration ledger and complete private-payload tables before copying.

The [M1 private-data inventory](docs/audits/2026-08-08-m1-safety-boundary-inventory.md) observed six database families and eleven backups with zero logical non-empty raw/tool rows. This does not prove byte absence in SQLite free pages, WAL/SHM, snapshots, or external copies. One family is active; five families and all eleven existing backups are preserved and quarantined under the approved 2026-08-08 disposition. No cleanup migration or user-data mutation was performed.

## M2 data and migration status

**Implemented baseline:** The active M2 migration is an explicit maintenance operation, not startup repair. It accepts only the authoritative active path, an exact admitted predecessor stage, an exact named approved-backup path and SHA-256, matching logical lineage, healthy private-payload inventory, and stable source/backup identities. It rehearses an exact whole-file restore before `BEGIN IMMEDIATE`, re-verifies immediately before writing, applies forward-only migrations, and verifies the exact current `0000`–`0010` contract before commit. Replay with the same approved backup is a verified no-op.

The target schema uses composite Course/revision/lesson/activity ownership, immutable published/archived content, immutable session contexts/snapshots, append-only Evidence and migration records, constrained type registries, and explicit orphan inventory. Browser Course operations carry only entity and operation IDs. Unknown activity/evidence types, cross-scope references, missing context, and unaccounted active sessions fail closed.

Compatibility does not promote quarantined data. A migrated session without a target context is readable only when its exact source revision, lesson, and session snapshot have `m2-v1` quarantine provenance and all stored scope/hash bindings agree; otherwise the request is rejected before provider or process work. `0010_m2_quarantine_immutability` prevents update or deletion of every quarantined source revision used by that proof. The active run preserves 526 unresolved quarantine rows and all legacy source rows. The approved pre-M2, pre-`0008`, pre-`0009`, and pre-`0010` backups remain plaintext local data and are supported whole-file rollback points only at their recorded cutoffs.

Final post-review evidence on 2026-08-09: `npm run verify` passed formatting, 12/12 lint tasks, 12/12 typecheck tasks, 21/21 fast-test tasks with 614 tests passed and 3 skipped, and 12/12 builds; `npm run test:e2e` passed 4/4. Independent correctness and security/data-migration re-reviews returned PASS with no remaining M2 blocker. A final explicit active/backup inventory reconfirmed stable identities, the exact active `0000`–`0010` schema, `integrity_check=ok`, zero foreign-key violations, zero unaccounted active sessions, zero target orphans/private-payload bytes, and the exact pre-`0010` backup binding. No hosted GitHub Actions result or external-provider smoke is claimed.

## Current risk summary

The complete records, including attack path, impact, existing mitigation, source fix, and required test, are in [docs/security/threat-model.md](docs/security/threat-model.md).

| ID                | Rank   | State                        | Summary                                                                                                |
| ----------------- | ------ | ---------------------------- | ------------------------------------------------------------------------------------------------------ |
| SEC-AI-001        | High   | Implemented baseline         | External Codex/OpenCode learning roles are policy-blocked; Mock alone is permitted.                    |
| SEC-REVIEW-001    | High   | Implemented baseline         | External Reviewer is blocked; no legacy provider read/tool authority is reachable by learning routes.  |
| SEC-CRED-001      | High   | Implemented baseline         | Codex child environment is explicitly allowlisted; unrelated secret classes are excluded.              |
| SEC-AI-002        | High   | Implemented baseline         | Provider tool input/output is discarded and the repository stores only `[]`/`NULL`.                    |
| SEC-NET-001       | High   | Implemented baseline         | Direct mode is loopback-only; explicit Compose internal wildcard keeps loopback host publication.      |
| SEC-INTEGRITY-001 | High   | Implemented baseline         | Legacy learning mutations return 410 before parsing/write; historical reads and v2 remain.             |
| SEC-PROVIDER-001  | High   | Implemented baseline         | Learning provider/model policy is server-owned and browser override fields are rejected.               |
| SEC-EVIDENCE-001  | High   | Implemented baseline finding | Mock/model review verdicts can satisfy completion and influence mastery evidence.                      |
| SEC-RELATION-001  | High   | Implemented baseline finding | Caller-controlled Teacher/Interview relationships can create false progression or mastery evidence.    |
| SEC-DIFF-001      | High   | Implemented baseline finding | Git-ignored workspace state is absent from test/review freshness fingerprints.                         |
| SEC-MIGRATION-001 | High   | Implemented baseline         | M2 is explicit, backup-bound, byte-preserving, quarantined, transactionally verified, and replay-safe. |
| SEC-AI-003        | Medium | Implemented baseline finding | AI output and tool-event accumulation lacks a cumulative budget.                                       |
| SEC-CANCEL-001    | Medium | Implemented baseline finding | Codex lacks a complete-turn deadline and local terminal cleanup when interruption is ignored.          |
| SEC-SUPPLY-001    | Medium | Implemented baseline         | Shipped installed-tree High/Critical: zero; one low graph-dev-only esbuild advisory remains.           |
| SEC-WEB-001       | Low    | Implemented baseline finding | Untrusted Markdown can cause an external browser fetch.                                                |
| SEC-HTTP-001      | Low    | Implemented baseline finding | Body/rate limits, production client-header rejection, and strict chat/settings schemas are incomplete. |
| SEC-DATA-001      | Low    | Implemented baseline finding | Private SQLite data/backups are plaintext and lack a complete lifecycle contract.                      |
| SEC-PACK-001      | High   | Approved Core Alpha target   | An untrusted Course Pack must never enter the trusted native-execution path.                           |
| SEC-EXEC-001      | High   | Future boundary              | Executable activities require real isolation before untrusted content can run.                         |

## Positive controls to preserve

**Implemented baseline:** strict mutation schemas; direct loopback bind enforcement; explicit internal-only Compose wildcard mode with loopback host publication; exact Origin/client/JSON checks; API-wide `no-store`; learner DTO protected-answer redaction; Mock-only learning-provider policy; legacy external adapter blocking; allowlisted Codex child environment; OpenCode provider-payload discard; browser event allowlisting and opaque app turn IDs; persistence literals for empty/no raw events; v1 mutation freeze; canonical and reparse-safe paths; isolated attempts; server-owned `shell: false` exercise plans; exercise timeout/output limits and sanitized child environments; SHA-256 freshness over the Git-visible patch; foreign keys/WAL; and verified non-overwriting backups.

These controls reduce specific risks. They do not authenticate a remote client, sandbox native execution, include Git-ignored workspace state in freshness, encrypt SQLite, prove deleted bytes absent from WAL/free pages, complete retention/export/deletion, or implement the target Pi boundary. External adapters are blocked rather than promoted as compliant. Mock preserves the development/test learning vertical and is not production model evidence.

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

Final local M1 evidence on 2026-08-09 reports zero High/Critical findings in the full installed tree, zero production vulnerabilities, and one low graph-dev-only transitive esbuild advisory (`GHSA-g7r4-m6w7-qqqr`), reported without an owner exception. Because the orchestrator image copies the full root `node_modules` tree, policy gates High/Critical findings across that shipped installed tree rather than only production-classified findings. `npm ci`, the refreshed 656-test `npm run verify`, the 30/30 E2E ownership/lock suite, two consecutive 4/4 lock-serialized E2E runs, read-only active-data inventory, approved-backup verification, audit policy, CycloneDX generation, and a 1440×900 loopback Settings smoke passed. The first final E2E run removed the retained authenticated, stale, proven-dead run root while the scavenger remains fail-closed for live, ambiguous, malformed, or unauthenticated state. Independent security and correctness re-reviews closed every reported M1 blocker. The Node 24/npm 11 workflow commits the same audit/SBOM, fast, E2E, and build gates; no hosted GitHub Actions run is claimed. This closes M1 containment, not the later Core Alpha security approval gates above.

## Detailed specifications

- [Threat model and remediation register](docs/security/threat-model.md)
- [Untrusted Course Packs](docs/security/untrusted-course-packs.md)
- [Execution isolation](docs/security/execution-isolation.md)
- [AI boundaries](docs/security/ai-boundaries.md)
- [Secrets and private sources](docs/security/secrets-and-private-sources.md)
- [M1 safety-boundary and private-data inventory](docs/audits/2026-08-08-m1-safety-boundary-inventory.md)
- [M2 migration and recovery runbook](docs/migration/m2-course-foundations-runbook.md)
- [Core Alpha licensing plan](docs/licensing/core-alpha-licensing-plan.md)
