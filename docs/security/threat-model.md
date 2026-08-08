# Core Alpha Threat Model and Remediation Register

**Document status:** Approved Core Alpha target and Implemented baseline audit. Target language is normative; it does not claim implementation.

## 1. Scope and method

Core Alpha is local-first and single-user. Supported deployment is browser plus local orchestrator on loopback, SQLite and local files, optional model/provider runtimes, trusted exercise templates, and future declarative Course Packs. Remote multi-user operation, cloud synchronization, and execution of untrusted code are not approved Core Alpha modes.

Rank means expected impact under a plausible attack path, not proof of exploitability in every installation:

- **High:** source/private-data compromise, arbitrary local authority, or deterministic-learning integrity loss.
- **Medium:** material availability or supply-chain approval risk.
- **Low:** bounded privacy/hardening risk in the supported local mode.
- **Future boundary:** currently unreachable or outside scope, but a release-blocking design constraint before the capability is introduced.

Every finding below contains the acceptance-required five fields: attack path, impact, existing mitigation, source fix, and test. “Source fix” means the responsible boundary must change; suppressing output or documenting around the behavior is not sufficient.

## 2. Assets and trust boundaries

Protected assets are learner answers and interviews, mastery/evidence, private Source Snapshots and Knowledge Capsules, local paths and code, provider credentials, SQLite/WAL/backups, immutable Course revisions, deterministic Learning Kernel state, and the integrity of the Aptiloop repository and exercise attempts.

Trust transitions are:

1. browser to unauthenticated loopback HTTP;
2. orchestrator to SQLite and local files;
3. orchestrator to Pi/provider runtimes and model output;
4. trusted template to attempt workspace to native process;
5. future external Course Pack/archive to validated immutable Course revision;
6. private local source to an explicitly approved provider disclosure.

`Origin` and client headers are request-shape controls, not identity. `shell: false`, command allowlists, containers, or a provider's “sandbox” option are not by themselves an Aptiloop security sandbox.

## 3. Ranked register

### SEC-AI-001 — Non-review AI tool and write authority

- **Rank/state:** High; Implemented baseline finding.
- **Attack path:** learner text or an interview transcript reaches a non-review Codex/OpenCode role rooted at the project; Codex uses workspace-write with no approval, or OpenCode receives its default tool set; model behavior or prompt injection invokes file, edit, shell, or network-capable tools.
- **Impact:** repository/config/data mutation, local command effects, private-file or credential access, corrupted Learning Kernel behavior, and persistence compromise.
- **Existing mitigation:** browser requests do not choose executable/argv/cwd and there is no browser apply endpoint; Reviewer alone receives Codex read-only/no-network and OpenCode deny-write policies; review compares Git diff before and after.
- **Source fix:** make every learning role tool-free/read-only at the adapter and orchestration boundary. Expose only Aptiloop-owned typed tools with strict schemas, per-role allowlists, deterministic semantics, server execution, and bounded results. Provide no general filesystem, shell, network, or edit tools.
- **Required test:** table-test every role/provider policy; send prompt-injection content through Teacher and Interviewer and assert zero general-tool calls and unchanged repository/workspace hashes; preserve the Reviewer before/after-diff test.
- **Gate:** no external learning role may be enabled until the policy tests pass.

### SEC-CRED-001 — Full Codex child environment inheritance

- **Rank/state:** High; Implemented baseline finding.
- **Attack path:** root environment values, including cross-provider secrets, enter `process.env`; the Codex app-server child inherits that complete environment; a child or provider tool reads it, while transformed output can evade best-effort redaction.
- **Impact:** provider/password/token disclosure, unauthorized sidecar use, cost abuse, and credential reuse.
- **Existing mitigation:** Codex raw errors and sensitive tool fields are reduced, common secret patterns are redacted, and exercise processes already demonstrate a minimal allowlisted environment.
- **Source fix:** construct a dedicated minimal Codex environment containing only required OS/PATH/home and a narrowly scoped auth-store location; remove secret-shaped and cross-provider variables before spawn. Keep output redaction only as defense in depth.
- **Required test:** inject sentinel API keys/passwords/tokens and unrelated secret names; capture spawn options and prove absence while required discovery variables remain; prove no sentinel reaches assistant output, logs, SQLite, WAL, or backup.
- **Gate:** real Codex is blocked until environment isolation and sentinel tests pass.

### SEC-AI-002 — Unredacted OpenCode tool-event persistence

- **Rank/state:** High; Implemented baseline finding.
- **Attack path:** OpenCode emits arbitrary tool input/output/error JSON; the browser receives a reduced event, but orchestrator retains the full event and stores it in `agent_messages.tool_events_json`; backups copy it.
- **Impact:** long-lived plaintext credentials, private-file content, prompts, or raw provider results in SQLite/WAL/backups, with no reliable recall after propagation.
- **Existing mitigation:** client SSE minimizes tool events; Codex separately minimizes tool notifications; Reviewer OpenCode sessions deny tools.
- **Source fix:** eliminate general tools per SEC-AI-001 and persist only an allowlisted audit envelope: tool ID/name, operation ID, status, duration, bounded result code, and no provider arguments/results. Apply field-specific redaction and byte limits before persistence.
- **Required test:** fake nested sentinels in input/output/error; assert absence from SSE, messages, `tool_events_json`, reviews, logs, WAL, and backup; assert only the approved bounded envelope remains.
- **Gate:** no OpenCode learning role or backup approval until the bounded-envelope test passes, every existing raw tool-event row and application-managed copy has a completed owner-approved reconciled disposition, and post-cleanup/restored-copy checks prove no sentinel remains in API/SSE, SQLite, WAL, logs, approved backups, restores, or exports.

### SEC-NET-001 — Unauthenticated non-loopback exposure

- **Rank/state:** High; Implemented baseline unsafe configuration.
- **Attack path:** an operator binds/publishes the orchestrator to `0.0.0.0`, `::`, a LAN address, proxy, or forwarded port; a remote client supplies the public fixed client header and a spoofed allowed Origin string.
- **Impact:** unauthenticated read/write access to learner/private/authoring data, provider turns, local paths, process triggers, and—when chained with SEC-AI-001—project-root authority.
- **Existing mitigation:** npm defaults and example configuration use loopback; Compose publishes to host loopback; exact Origin/port and JSON checks reduce ordinary browser CSRF.
- **Source fix:** Core Alpha must validate the actual bind and fail closed unless loopback. Any future remote mode requires real authentication/authorization, TLS, secure sessions and CSRF, rate limiting, trusted-proxy rules, audit logging, and learner/author separation.
- **Required test:** accept supported IPv4/IPv6 loopback addresses; reject wildcard and LAN binds; prove fixed headers and spoofed Origin never authenticate a production request; a future remote suite must deny every unauthenticated read and mutation.
- **Gate:** release startup evidence must show loopback; no documentation may call Origin/client headers authentication.

### SEC-INTEGRITY-001 — Legacy deterministic-integrity bypass

- **Rank/state:** High; Implemented baseline finding.
- **Attack path:** a remaining legacy v1 session/answer/completion caller submits or triggers the fixed mastery/mistake/card path instead of versioned append-only evidence and server-owned progression.
- **Impact:** mastery and review state can diverge from actual evidence, corrupt adaptation decisions, and undermine deterministic replay.
- **Existing mitigation:** the versioned v2 path has immutable snapshots, protected-answer redaction, typed idempotent evidence, server-owned unit transitions, deterministic summary/mastery rules, and transactional artifact persistence.
- **Source fix:** inventory and migrate all legacy callers/data to Course revision/activity/evidence contracts; quarantine unmatched rows; stop legacy writes only after reconciliation and preserve historical rows read-only. The Learning Kernel must be the sole authority for state/mastery.
- **Required test:** migration fixture with legacy and v2 histories proves row preservation, deterministic replay, idempotency, no caller-supplied mastery, and rejection of legacy write routes after cutover.
- **Gate:** Core Alpha approval requires zero production write path around the Learning Kernel.

### SEC-AI-003 — Unbounded AI output and event accumulation

- **Rank/state:** Medium; Implemented baseline finding.
- **Attack path:** a provider sends many individually valid deltas/tool events or oversized completed/review content within the turn deadline; orchestrator concatenates, streams, parses, renders, and persists without a cumulative byte/event budget.
- **Impact:** browser/orchestrator memory and CPU pressure, SQLite/backup growth, Markdown rendering stalls, disk exhaustion, and availability loss.
- **Existing mitigation:** input-size limits, provider deadlines, a Codex per-line limit, and exercise/Git output caps exist, but they do not cap a complete AI turn.
- **Source fix:** enforce common cumulative bytes, event/tool count, structured array/string, persisted-field, and rendering budgets; abort fail-closed and store only a bounded diagnostic; use bounded buffers.
- **Required test:** malicious fake providers emit many small deltas, giant completion, excessive tools, and oversized review arrays; assert threshold abort, bounded SSE/storage, no partial trusted review, and cleanup.
- **Gate:** all provider adapters must pass identical budget tests.

### SEC-SUPPLY-001 — Unresolved dependency advisories

- **Rank/state:** Medium; Implemented baseline approval finding.
- **Attack path:** exact exploit paths remain unresolved because advisory IDs and runtime reachability have not been dispositioned. The observed lock/audit baseline reports 6 vulnerabilities: 4 high, 1 moderate, 1 low, including relevant locked versions Hono 4.12.33, Next 16.2.12, nested PostCSS 8.4.31, sharp 0.34.5, nanoid 3.3.16, and tsup's esbuild 0.27.7.
- **Impact:** potential upstream compromise, denial of service, development-tool exposure, or approval uncertainty; exact impact must be determined per advisory rather than inferred from the severity label.
- **Existing mitigation:** one lockfile with integrity hashes; the audit is recorded honestly; no forced downgrade/override was applied.
- **Source fix:** record advisory/CVE, affected range, dependency path, production/dev classification, feature reachability, fixed version or compensating control, owner, approval, and exception expiry; upgrade through supported versions.
- **Required test:** archive machine-readable dependency audit and SBOM; policy fails on unapproved production High/Critical findings and expired exceptions; verify lockfile integrity.
- **Gate:** security approval remains open while any reported advisory lacks disposition.

### SEC-WEB-001 — Markdown external-fetch privacy

- **Rank/state:** Low; Implemented baseline finding.
- **Attack path:** provider/private-source text contains a Markdown image or resource URL; transcript rendering creates a browser resource element and automatically requests an internet or local-network URL.
- **Impact:** IP/timing disclosure, tracking, unwanted GET requests to local services, and content spoofing. This is not described as full server-side request forgery because the Markdown renderer cannot read the response.
- **Existing mitigation:** React escaping is active, raw HTML is not enabled, referrer policy is same-origin, and frame denial/nosniff headers exist.
- **Source fix:** render a strict allowed Markdown subset, disallow images/resource elements, sanitize URL schemes, add restrictive `img-src`, `object-src`, `base-uri`, and appropriate `connect-src`, and require explicit navigation for external links.
- **Required test:** render remote/loopback images, raw HTML, and `javascript:`, `data:`, `file:` and malformed URLs; assert no automatic resource element/request, unsafe schemes removed, text escaped, and allowed HTTPS links safely attributed.
- **Gate:** private or AI Markdown cannot ship until hostile-render tests pass.

### SEC-DATA-001 — Plaintext private-data lifecycle

- **Rank/state:** Low in supported local mode; Implemented baseline finding and a blocker for shared/self-hosted use.
- **Attack path:** another local account, sync/backup agent, shared-directory configuration, cached response, or future remote operator reads SQLite/WAL/backups/attempts containing learner and AI history.
- **Impact:** disclosure of answers, interviews, mistakes/mastery, paths, code/test/review evidence, private sources, and sensitive tool data.
- **Existing mitigation:** local single-user scope, Git exclusions for `.data`, SQLite, and `.env`, non-root container runtime, no intended credential columns, and integrity-checked non-overwriting backups.
- **Source fix:** inventory data; enforce owner-only storage where supported and document Windows ACL requirements; add private-response `Cache-Control: no-store`; define bounded retention, complete local export, and profile deletion covering DB/WAL/backups/attempts; decide at-rest encryption before portable/shared profiles. Integrity checks are not confidentiality.
- **Required test:** POSIX modes for DB/WAL/backups; Windows ACL checklist; no-store HTTP tests; complete export/delete/retention tests; sentinel absence from exports and backups after cleanup.
- **Gate:** no shared, synced, portable, or remote profile claim without a reviewed confidentiality design.

### SEC-PACK-001 — Core Alpha untrusted Course Pack V1 boundary

- **Rank/state:** High target boundary; Approved Core Alpha target, with no current import endpoint observed.
- **Attack path:** one external JSON document exploits invalid/ambiguous encoding, duplicate keys, extreme byte/nesting/item/string/parse limits, forbidden local/UNC/device/traversal path values, unsafe URLs, secret/command/plugin fields, hash collisions, graph defects, or partial persistence; importer then connects data to native execution.
- **Impact:** validation bypass, private-file/credential exposure, resource exhaustion, unintended authority, partial immutable state, or nondeterministic learning behavior.
- **Existing mitigation:** there is no current importer; current templates resolve under a bundled trusted prefix; browser selects only a fixed command ID; strict shared schemas and canonical path helpers are preservation seams.
- **Source fix:** accept only one bounded UTF-8 JSON document; detect duplicate keys; use closed schemas and canonical hashing; reject authority/path/secret fields; stage privately; validate graph/locale/provenance/no-AI/runtime/check references; require learner Preview and explicit Install/Open-as-draft; publish transactionally; keep every imported object unreachable from process execution.
- **Required test:** non-JSON/directory/archive rejection; invalid/ambiguous UTF-8; duplicate keys; extreme bytes/depth/items/strings/parse time; forbidden path values; unknown/executable/secret fields; unsafe URLs; graph/locale/reference errors; hash mismatch/collision; rollback/cleanup; deterministic Kit/import hash and re-import; prove no imported object reaches `AllowedProcessRunner`.
- **Gate:** V1 import remains disabled until every JSON/control/parity test passes.

### SEC-PACK-ARCHIVE-001 — Future archive or directory transport

- **Rank/state:** Future; outside Core Alpha and not a V1 release gate.
- **Attack path:** a later archive/directory uses zip-slip, mixed separators, drive/UNC/device/ADS names, duplicate/confusable entries, symlink/hardlink/junction/reparse entries, special files, or decompression bombs.
- **Source fix/test:** require a separately approved transport schema, pre-extraction byte/count/depth/ratio limits, normalized-name collision checks, rejection of links/special files, private staging, cleanup, and the complete malicious extraction corpus before that transport is enabled.
- **Gate:** no archive/directory intake exists or is advertised in Core Alpha; adding it requires a new security review and release-scope approval.

### SEC-EXEC-001 — Future isolation for executable activities

- **Rank/state:** High; Future boundary. Current native execution remains trusted-only and is not a sandbox.
- **Attack path:** future imported or AI-authored code reaches a server-owned Node/Python check that runs with the local account, host home, credentials, network, or writable mounts.
- **Impact:** local code execution, data/credential theft, host modification, network abuse, and persistence.
- **Existing mitigation:** current checked-in templates, isolated attempts, strict paths, server-owned `test` ID, `shell: false`, sanitized exercise environment, timeout/output caps, and process-tree cleanup.
- **Source fix:** keep Core Alpha packs non-executable. If a later product adds untrusted execution, require a separately approved Execution Fabric using real OS/container isolation, immutable runtime images, no host home/credentials/network, read-only roots, disposable writable workdir, resource quotas, and trusted check definitions. Do not call native execution or header checks a sandbox.
- **Required test:** isolation escape suite for filesystem, environment, network, fork/process, resource, symlink/mount, timeout, cleanup, and concurrent runs on each supported OS/runtime; verify host and private data unchanged.
- **Gate:** no untrusted executable activity before independent isolation review.

## 4. Positive-control assurance records

### PC-PATH-001 — Canonical attempt containment

- **Attack path addressed:** traversal, absolute/drive/UNC/device/ADS, or reparse link escapes from a template/attempt path.
- **Impact addressed:** read/write outside approved roots.
- **Existing mitigation:** canonical containment and link/reparse rejection are Implemented baseline.
- **Source preservation/fix:** centralize all future pack and execution paths through the same boundary; never reimplement lexical-only checks.
- **Test:** retain traversal, mixed-separator, reserved-name, symlink, junction, and deletion-containment regressions.

### PC-REVIEW-001 — Read-only Reviewer and evidence freshness

- **Attack path addressed:** Reviewer mutates learner work or approves stale/truncated evidence.
- **Impact addressed:** corrupted attempt and false approval.
- **Existing mitigation:** Reviewer adapter restrictions, before/after Git diff check, full non-truncated diff SHA-256, and matching test-run fingerprint are Implemented baseline. The old mtime-bypass description is obsolete.
- **Source preservation/fix:** keep Reviewer without patch authority and keep freshness based on the full diff, never mtime.
- **Test:** preserve same-mtime mutation rejection; cover truncated diff, baseline-marker tampering, stale test, and before/after mutation.

### PC-SNAPSHOT-001 — Immutable learning evidence

- **Attack path addressed:** published content changes or caller-crafted state rewriting historical learning evidence.
- **Impact addressed:** non-reproducible progress/mastery and protected-answer leakage.
- **Existing mitigation:** immutable session snapshot/content hash, typed idempotent evidence, protected learner DTOs, and server-owned v2 transitions are Implemented baseline.
- **Source preservation/fix:** migrate legacy rows additively and keep the Learning Kernel authoritative.
- **Test:** immutable publication, protected-field redaction, idempotent evidence, deterministic replay, and migration reconciliation.

## 5. Security approval evidence

Current observed verification evidence is a baseline, not approval: `npm run verify` passed format, 12/12 lint tasks, 12/12 typecheck tasks, 21/21 fast-test tasks (352 tests), and 12/12 build tasks with 12 static Next routes. `npm run test:e2e` was not green: 1 passed and 3 failed. The disposable loopback browser smoke had no observed console errors, but that does not exercise provider or security attack paths. No CI workflow is committed. Each remediation gate above requires direct behavioral evidence before its finding may be closed.
