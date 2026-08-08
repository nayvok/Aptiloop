# Aptiloop Security Policy

**Document status:** Approved Core Alpha target, with Implemented baseline findings recorded below. This document specifies policy; it does not claim that target controls are implemented.

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

## Current risk summary

The complete records, including attack path, impact, existing mitigation, source fix, and required test, are in [docs/security/threat-model.md](docs/security/threat-model.md).

| ID | Rank | State | Summary |
| --- | --- | --- | --- |
| SEC-AI-001 | High | Implemented baseline finding | Non-review Codex/OpenCode roles can receive repository write or general tool authority. |
| SEC-CRED-001 | High | Implemented baseline finding | The Codex child inherits the orchestrator's full environment. |
| SEC-AI-002 | High | Implemented baseline finding | OpenCode tool input/output can be persisted without redaction or minimization. |
| SEC-NET-001 | High | Implemented baseline finding | A configurable non-loopback bind exposes an unauthenticated control plane. |
| SEC-INTEGRITY-001 | High | Implemented baseline finding | Legacy learning routes can bypass the evidence-owned deterministic learning path. |
| SEC-AI-003 | Medium | Implemented baseline finding | AI output and tool-event accumulation lacks a cumulative budget. |
| SEC-SUPPLY-001 | Medium | Implemented baseline finding | Dependency advisories are unresolved and require reachability/upgrade disposition. |
| SEC-WEB-001 | Low | Implemented baseline finding | Untrusted Markdown can cause an external browser fetch. |
| SEC-DATA-001 | Low | Implemented baseline finding | Private SQLite data/backups are plaintext and lack a complete lifecycle contract. |
| SEC-PACK-001 | High | Future boundary | An untrusted Course Pack must never enter the trusted native-execution path. |
| SEC-EXEC-001 | High | Future boundary | Executable activities require real isolation before untrusted content can run. |

## Positive controls to preserve

**Implemented baseline:** strict mutation schemas; loopback defaults; exact Origin and JSON checks; learner DTO redaction of protected answers; canonical and reparse-safe path handling; per-attempt workspace copies; server-selected `shell: false` exercise commands; exercise timeout/output limits and sanitized child environments; full, non-truncated Git-diff SHA-256 freshness; Reviewer read-only/deny-write policies plus before/after diff comparison; loopback-only OpenCode endpoint validation; browser minimization of raw provider events; SQLite foreign keys/WAL; integrity-checked, non-overwriting backups; and Git exclusion of local databases and secret files.

These controls reduce specific risks. They do not authenticate a remote client, sandbox native execution, make provider tools safe, encrypt SQLite, or prove target compliance.

## Core Alpha security rules

**Approved Core Alpha target:**

- bind the unauthenticated application only to loopback and fail closed on non-loopback configuration;
- expose AI only through Aptiloop-owned, typed, per-role tools; expose no arbitrary filesystem, shell, network, or edit tools;
- make Reviewer read-only and unable to apply patches;
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

The observed repository baseline is not fully approved: `npm run verify` passed its documented format, lint, typecheck, fast-test, and build tasks, but `npm run test:e2e` had 1 pass and 3 failures; the E2E gate is not green. The observed `npm audit` result reported 6 vulnerabilities (4 high, 1 moderate, 1 low). No committed CI workflow was observed.

## Detailed specifications

- [Threat model and remediation register](docs/security/threat-model.md)
- [Untrusted Course Packs](docs/security/untrusted-course-packs.md)
- [Execution isolation](docs/security/execution-isolation.md)
- [AI boundaries](docs/security/ai-boundaries.md)
- [Secrets and private sources](docs/security/secrets-and-private-sources.md)
- [Core Alpha licensing plan](docs/licensing/core-alpha-licensing-plan.md)
