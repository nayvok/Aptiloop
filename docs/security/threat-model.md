# Core Alpha Threat Model and Remediation Register

**Document status:** **Approved Core Alpha target** with current **Implemented baseline** controls identified per record.

## 1. Scope and method

Core Alpha is local-first and single-user. Supported deployment is browser plus local orchestrator on loopback, SQLite and local files, optional model/provider runtimes, declarative single-document Course Pack V1 import/export, and trusted repository-controlled exercise templates executed through the local-native Fabric. Remote multi-user operation, cloud synchronization, archive/directory Pack transport, and execution of untrusted code are not approved modes.

Rank means expected impact under a plausible attack path, not proof of exploitability in every installation:

- **High:** source/private-data compromise, arbitrary local authority, or deterministic-learning integrity loss.
- **Medium:** material availability or supply-chain approval risk.
- **Low:** bounded privacy/hardening risk in the supported local mode.
- **Future:** currently unreachable or outside scope, but a release-blocking design constraint before the capability is introduced.

Every finding below contains the acceptance-required five fields: attack path, impact, existing mitigation, source fix, and test. “Source fix” means the responsible boundary must change; suppressing output or documenting around the behavior is not sufficient.

## 2. Assets and trust boundaries

Protected assets are learner answers and interviews, mastery/evidence, private Source Snapshots and Knowledge Capsules, local paths and code, provider credentials, SQLite/WAL/backups, immutable Course revisions, deterministic Learning Kernel state, and the integrity of the Aptiloop repository and exercise attempts.

Trust transitions are:

1. browser to unauthenticated loopback HTTP;
2. orchestrator to SQLite and local files;
3. orchestrator to Pi/provider runtimes and model output;
4. trusted template to attempt workspace to native process;
5. external Course Pack JSON bytes to privately staged validation to an explicitly installed immutable Course revision;
6. private local source to an explicitly approved provider disclosure.

`Origin` and client headers are request-shape controls, not identity. `shell: false`, command allowlists, containers, or a provider's “sandbox” option are not by themselves an Aptiloop security sandbox.

## 3. Ranked register

### SEC-AI-001 — Non-review AI tool and write authority

- **Rank/status:** High; **Implemented baseline**.
- **Attack path:** provider or prompt content requests general filesystem, edit, shell, process, network, credential, or provider-native authority.
- **Impact:** local mutation, command effects, private-data disclosure, and deterministic-learning compromise.
- **Existing mitigation:** active roles resolve through Provider Hub with finite Aptiloop-owned typed tools, strict argument/result schemas, server-side scope checks, and no general tools. Legacy Codex/OpenCode learning authority remains blocked.
- **Required test:** every role/provider policy rejects unauthorized tools and leaves repository/workspace hashes unchanged.
- **Gate:** preserve the same default-deny matrix for every new caller.

### SEC-REVIEW-001 — Reviewer read authority beyond evidence bundle

- **Rank/status:** High; **Implemented baseline**.
- **Attack path:** learner-controlled evidence attempts to expand Reviewer context or request read/write/process/network authority.
- **Impact:** private-data disclosure, learner-work mutation, or false review evidence.
- **Existing mitigation:** Reviewer receives only the bounded immutable evidence capsule after exact freshness checks, has no filesystem/process/network/edit/apply/general-tool authority, and returns a strict typed result. Before/after complete-workspace hashes must match.
- **Required test:** cross-attempt/environment sentinels remain absent, unauthorized tools are unavailable, and the workspace is unchanged.
- **Gate:** preserve evidence-only context and no-apply authority.

### SEC-CRED-001 — Full Codex child environment inheritance

- **Rank/status:** High; **Implemented baseline**.
- **Attack path:** a provider child inherits unrelated root environment values, including cross-provider secrets.
- **Impact:** provider/password/token disclosure, unauthorized sidecar use, cost abuse, and credential reuse.
- **Existing mitigation:** active provider transports use boundary-specific minimal environments. Settings accepts credentials only through the explicit loopback mutation, stores them connection-scoped in the local credential file, and returns only safe metadata/references; unrelated secret classes are excluded.
- **Source fix:** complete for active providers; retain minimal environments, explicit replacement/revocation, and secret-redacted outputs.
- **Required test:** inject sentinel API keys/passwords/tokens and unrelated secret names; capture spawn options and prove absence while required discovery variables remain; prove no sentinel reaches assistant output, logs, SQLite, WAL, or backup.
- **Gate:** real Codex is blocked until environment isolation and sentinel tests pass.

### SEC-AI-002 — Unredacted OpenCode tool-event persistence

- **Rank/state:** High impact if regressed; **Implemented baseline** M1 containment.
- **Attack path:** a provider emits arbitrary tool input/output/error JSON and an application layer attempts to stream or persist it.
- **Impact:** without containment, long-lived plaintext credentials, private-file content, prompts, or raw results could enter SQLite/WAL/backups.
- **Existing mitigation:** active external callers resolve through Provider Hub and finite typed tools. Provider-native tool input/output is not exposed as raw browser events or persisted protocol; `LearningRepository.addMessage` stores literal `[]`/`NULL`, new reviews store no raw response, and legacy authority-bypassing adapters remain blocked.
- **Source fix:** implemented for new writes. Keep the repository seam closed and admit only a future app-owned bounded audit envelope; never restore provider arguments/results.
- **Required test:** fake nested sentinels in input/output/error; assert absence from SSE, message/review columns, logs, WAL, and a newly approved backup.
- **Gate:** read-only inventory observed zero logical non-empty tool/raw rows. Five non-active families and all eleven old backups remain quarantined because logical zero does not prove byte erasure; only the active candidate may produce a new approved backup after preflight.

### SEC-NET-001 — Unauthenticated non-loopback exposure

- **Rank/state:** High impact if regressed; **Implemented baseline** for supported local topologies.
- **Attack path:** an operator attempts a process wildcard/LAN bind, unsafe orchestrator URL, forwarded identity spoof, or non-loopback host publication.
- **Impact:** unauthenticated read/write access to learner/private/authoring data, local paths, and process triggers.
- **Existing mitigation:** direct mode accepts only exact `127.0.0.1`, `::1`, or `localhost`; only explicit Compose mode accepts internal `0.0.0.0`, while host publications remain loopback. Web rewrite validation accepts only exact supported direct/Compose origins. Forwarded headers are validated but ignored for authorization.
- **Source fix:** implemented for the supported direct and Compose profiles. Future remote mode still requires authentication/authorization, TLS, secure sessions/CSRF, rate limiting, trusted-proxy rules, audit logging, and learner/author separation.
- **Required test:** process host/port matrix; orchestrator URL matrix; committed Compose mode/publication; spoofed/partial/multiple forwarded-header rejection; fixed headers and Origin never authenticate.
- **Gate:** no non-loopback unauthenticated deployment is supported.

### SEC-PROVIDER-001 — Browser bypass of provider/model policy

- **Rank/status:** High; **Implemented baseline**.
- **Attack path:** a browser supplies role/provider/model fields or an unavailable external provider attempts to fall back to Mock.
- **Impact:** an unapproved provider/model could receive private context, use higher authority, create misleading provenance, or incur unapproved cost.
- **Existing mitigation:** Provider Hub owns exact RoleProfile/connection/model resolution and readiness. Browser schemas reject overrides; AI Off, auth, capability, disclosure, model, and transport failures remain explicit without provider/model/Mock substitution.
- **Source fix:** complete for lesson-scoped Tutor, Interview, Review, and Course Designer callers.
- **Required test:** reject role/provider/model overrides and unavailable external profiles; prove no provider call/session and no fallback; persist only app-owned provenance.
- **Gate:** each real provider/model still requires its own observed authenticated smoke before readiness is claimed as evidence.

### SEC-EVIDENCE-001 — Mock/model review verdicts become learning authority

- **Rank/status:** High; **Implemented baseline**.
- **Attack path:** provider/Mock prose attempts to assert correctness, mastery, or progression.
- **Impact:** false evidence and premature progression.
- **Existing mitigation:** Mock is test/CI/development-only. The Learning Kernel rejects Reviewer `correct` authority; Reviewer output is advice bound to an earlier trusted check with the same workspace hash. Only deterministic evaluator/trusted-check provenance can establish objective correctness.
- **Required test:** forged/provider/Mock prose cannot raise mastery; trusted check and correction evidence remain replayable.
- **Gate:** preserve kernel authority and provenance checks.

### SEC-INTEGRITY-001 — Legacy deterministic-integrity bypass

- **Rank/status:** High; **Implemented baseline**.
- **Attack path:** a caller attempts legacy v1 session, answer, or completion mutation instead of versioned evidence and server-owned progression.
- **Impact:** without the freeze, mastery and review state can diverge from actual evidence and undermine deterministic replay.
- **Existing mitigation:** legacy POST routes return 410 before parsing or repository access; legacy reads remain available; the versioned v2 path stays runnable with hashed snapshots, typed/idempotent evidence, server-owned transitions, and deterministic summary/mastery rules.
- **Source fix:** complete for reachable legacy mutations and current server-owned relationship validation; retained history remains readable/quarantined where authority is unprovable.
- **Required test:** legacy GET reads remain; every legacy mutation is 410 with zero repository writes; the complete Mock-backed v2 vertical remains operational.
- **Gate:** preserve the freeze while later migrations prove provenance and deterministic replay.

### SEC-RELATION-001 — Caller-controlled Teacher/Interview evidence relationships

- **Rank/status:** High; **Implemented baseline**.
- **Attack path:** a caller supplies an unrelated Teacher conversation or Interview/report identity to satisfy another Activity.
- **Impact:** false completion, unlock, summary, or mastery facts.
- **Existing mitigation:** repositories prove exact Course/revision/learning-session/Activity/conversation/interview/report ownership and persisted answer/message facts. Browser requests express entity/operation intent; cross-scope relationships fail closed.
- **Required test:** reject cross-session, missing, mismatched, unrelated, and forged relationships with no progression/mastery change.
- **Gate:** preserve exact server-owned relationship proof.

### SEC-DIFF-001 — Git-ignored state absent from freshness evidence

- **Rank/status:** High; **Implemented baseline**.
- **Attack path:** any allowed regular workspace file changes after a passing check or during review, including Git-ignored state.
- **Impact:** stale or false evidence.
- **Existing mitigation:** a bounded canonical complete-workspace manifest hashes all allowed regular files independent of Git ignore, excluding only explicit app-owned roots. Check and Review bind that SHA-256 plus a complete non-truncated Git diff; before/after snapshots must match.
- **Required test:** ignored, binary, oversize, link, same-mtime, and during-review changes invalidate freshness or fail closed.
- **Gate:** preserve complete-workspace and diff binding.

### SEC-MIGRATION-001 — Startup repair rewrites historical evidence

- **Rank/state:** High; **Implemented baseline** containment accepted in M2.
- **Historical attack path:** normal startup could invoke repair before operator reconciliation, rewrite historical snapshot JSON/hashes, replace malformed progress with defaults, or infer a missing unit type without a verified backup.
- **Impact:** irreversible loss of original evidence bytes, fabricated historical meaning, broken replay/provenance, and incorrect progression/mastery.
- **Implemented mitigation:** ordinary startup and writable operation admit only the exact current `0000`–`0019` contract and never upgrade a predecessor implicitly. The explicit backup-path/hash-bound migration command alone admits exact predecessor stages. It proves source/backup lineage, integrity, foreign keys, private-payload gates, exact schema/trigger identity, immutable history, and whole-file recovery before writing. Additive M2–M11 migrations preserve source history while adding immutable Pack, kernel, execution, authoring, and per-Course learner-state records.
- **Source fix:** implemented through `0019_provider_connection_retirement`. Quarantined rows remain invalid target truth, accepted records remain immutable, provider retirement preserves historical evidence, and no legacy deletion/down migration is authorized.
- **Observed test:** disposable fresh/legacy/malformed/partial fixtures cover exact-stage admission, wrong/changed backups, schema/ledger mismatch, transaction rollback, repeated no-op, byte/hash preservation, quarantine arithmetic/tamper rejection, integrity/foreign keys, and immutable history. Pack/kernel/execution repository suites additionally cover atomic rollback, conflicting replay, canonical replay equality, collision behavior, and scoped ownership.
- **Gate:** additive migration through `0019` is the current repository contract. Any valuable-data application still requires an explicit read-only inventory and new active-source-only approved backup at the point of migration; destructive compatibility removal remains separately gated.

### SEC-AI-003 — Unbounded AI output and event accumulation

- **Rank/status:** Medium; **Implemented baseline**.
- **Attack path:** a provider sends many individually valid deltas/tool events or oversized completed/review content within the turn deadline; orchestrator concatenates, streams, parses, renders, and persists without a cumulative byte/event budget.
- **Impact:** browser/orchestrator memory and CPU pressure, SQLite/backup growth, Markdown rendering stalls, disk exhaustion, and availability loss.
- **Existing mitigation:** the common Provider Hub runner enforces cumulative input/output/event/tool/deadline budgets, cancels fail-closed, and persists only bounded normalized results/diagnostics.
- **Source fix:** complete for active callers; keep the common runner mandatory.
- **Required test:** malicious fake providers emit many small deltas, giant completion, excessive tools, and oversized review arrays; assert threshold abort, bounded SSE/storage, no partial trusted review, and cleanup.
- **Gate:** all provider adapters must pass identical budget tests.

### SEC-CANCEL-001 — Codex cancellation lacks terminal cleanup

- **Rank/status:** Medium; **Implemented baseline**.
- **Attack path:** Codex starts a turn but never emits a terminal notification; `turn/interrupt` succeeds or is ignored while the local queue, SSE response, and session remain pending without a complete-turn deadline.
- **Impact:** stuck requests, retained memory/session state, leaked child descendants, and local availability loss.
- **Existing mitigation:** the common runner propagates abort/deadline, emits one terminal cancelled/failed state, prevents success persistence, evicts the provider session, attempts upstream cancellation, and performs cleanup.
- **Source fix:** complete for active callers; preserve single-terminal-event and no-success-after-cancel invariants.
- **Required test:** silent provider, ignored interrupt, disconnect/deadline race, duplicate terminal notification, and descendant cleanup scenarios leave no pending queue/session/process.
- **Gate:** each provider adapter passes the same deadline/cancellation/cleanup contract.

### SEC-SUPPLY-001 — Unresolved dependency advisories

- **Rank/status:** Medium; **Implemented baseline** at the dated audit cutoff.
- **Attack path:** a new or changed lockfile introduces an unclassified vulnerable dependency anywhere in the installed tree shipped by the orchestrator image, or hides lower-severity development evidence.
- **Impact:** upstream compromise, denial of service, executable development-tool exposure, or approval uncertainty.
- **Existing mitigation:** the 2026-08-09 audit evidence reported zero production advisories and one graph-dev-transitive low advisory, esbuild 0.27.7 `GHSA-g7r4-m6w7-qqqr` through tsup 8.5.1, without an exception. The committed policy preserves full/production audit JSON and CycloneDX evidence and gates the shipped installed tree. This dated result is not a claim about a later lockfile or hosted run.
- **Source fix:** committed policy archives full/production audit JSON and CycloneDX SBOM, preserves production and graph-dev-only findings, and fails on any shipped installed-tree High/Critical object. Blocking is derived once from full-report vulnerability objects, so production overlap is not double-counted. No force, override, downgrade, or fabricated exception is used.
- **Required test:** CI runs the policy after `npm ci`, uploads audit/SBOM artifacts even if later gates fail, and rejects synthetic production High/Critical, full-tree graph-dev-only High/Critical, malformed metadata, and mixed-scope residual High/Critical evidence.
- **Gate:** every current release candidate requires a fresh observed audit. Any future exception requires an explicit owner and expiry.

### SEC-HTTP-001 — Request size and concurrency exhaustion

- **Rank/status:** Low; **Implemented baseline**.
- **Attack path:** oversized or highly concurrent JSON attempts to reach `req.json()`, or long-lived Tutor streams attempt to retain process capacity.
- **Impact:** local memory, CPU, connection, and availability pressure.
- **Existing mitigation:** mutations first enforce exact request authority, Origin, `X-Aptiloop-Client=web`, and JSON media type. Accepted JSON mutations are then read under a 1,048,576-byte pre-parse budget even when `Content-Length` is missing or transfer is chunked. The process admits 16 concurrent API requests total and 4 concurrent Tutor SSE responses; rejected capacity receives `429` plus `Retry-After: 1`. Admission is released on synchronous completion, errors, once cancelled request work actually exits, completed stream consumption, or stream cancellation. Shutdown closes admission to new API work and drains every admitted handler or stream before SQLite closes; a bounded drain timeout rejects `close()` instead of deliberately closing SQLite while late work remains. Course Pack validation keeps its stricter raw-byte parse path at the same 1 MiB ceiling.
- **Observed test:** production-mode boundary tests cover declared oversize, chunked oversize, a just-under-limit JSON body, invalid/missing browser headers retaining their earlier status, the concurrency threshold, `Retry-After`, release after failure or after cancelled work exits, and database-close ordering around a gated ordinary mutation. Focused admission tests cover stream-class separation, shutdown rejection, bounded drain timeout, and release after completed/cancelled stream consumption.
- **Residual:** this is a fixed process-wide concurrency ceiling, not a per-client token bucket; it limits local resource amplification but is not authentication and is not a supported defense for LAN/public exposure. Provider turns and trusted execution retain their separate duration/output/cancellation budgets.
- **Gate:** preserve the 1 MiB/16-request/4-stream defaults or review any change together with production-equivalent boundary tests and the single-user loopback profile.

### SEC-WEB-001 — Markdown external-fetch privacy

- **Rank/status:** Low; **Approved Core Alpha target**.
- **Attack path:** provider/private-source text contains a Markdown image or resource URL; transcript rendering creates a browser resource element and automatically requests an internet or local-network URL.
- **Impact:** IP/timing disclosure, tracking, unwanted GET requests to local services, and content spoofing. This is not described as full server-side request forgery because the Markdown renderer cannot read the response.
- **Existing mitigation:** React escaping is active, raw HTML is not enabled, referrer policy is same-origin, and frame denial/nosniff headers exist.
- **Source fix:** render a strict allowed Markdown subset, disallow images/resource elements, sanitize URL schemes, add restrictive `img-src`, `object-src`, `base-uri`, and appropriate `connect-src`, and require explicit navigation for external links.
- **Required test:** render remote/loopback images, raw HTML, and `javascript:`, `data:`, `file:` and malformed URLs; assert no automatic resource element/request, unsafe schemes removed, text escaped, and allowed HTTPS links safely attributed.
- **Gate:** private or AI Markdown cannot ship until hostile-render tests pass.

### SEC-DATA-001 — Plaintext private-data lifecycle

- **Rank/status:** Low; **Approved Core Alpha target**.
- **Attack path:** another local account, sync/backup agent, shared-directory configuration, cached response, or future remote operator reads SQLite/WAL/backups/attempts containing learner and AI history.
- **Impact:** disclosure of answers, interviews, mistakes/mastery, paths, code/test/review evidence, private sources, and sensitive tool data.
- **Existing mitigation:** local single-user scope, Git exclusions for `.data`, SQLite, and `.env`, non-root container runtime, no intended credential columns, and integrity-checked non-overwriting backups.
- **Source fix:** inventory data; enforce owner-only storage where supported and document Windows ACL requirements; add private-response `Cache-Control: no-store`; define bounded retention, complete local export, and profile deletion covering DB/WAL/backups/attempts; decide at-rest encryption before portable/shared profiles. Integrity checks are not confidentiality.
- **Required test:** POSIX modes for DB/WAL/backups; Windows ACL checklist; no-store HTTP tests; complete export/delete/retention tests; sentinel absence from exports and backups after cleanup.
- **Gate:** no shared, synced, portable, or remote profile claim without a reviewed confidentiality design.

### SEC-PACK-001 — Core Alpha untrusted Course Pack V1 boundary

- **Rank/status:** High; **Implemented baseline**.
- **Attack path:** one external JSON document exploits invalid/ambiguous encoding, duplicate keys, extreme byte/nesting/item/string/parse limits, forbidden local/UNC/device/traversal values, unsafe URLs, secret/command/plugin fields, hash collisions, graph defects, or partial persistence; installed data is then confused with execution authority.
- **Impact:** validation bypass, private-file/credential exposure, resource exhaustion, unintended authority, partial immutable state, or nondeterministic learning behavior.
- **Existing mitigation:** the importer accepts one byte-bounded UTF-8 JSON document, detects duplicate keys, uses a closed strict schema/canonical hash, rejects authority/path/secret/unsafe URL data, stages privately with expiry, validates graph/locale/provenance/manual-path/runtime requirements, requires Preview plus explicit Install/Open-as-draft, revalidates exact bytes/hash at commit, and persists transactionally. M5 resolves only known app-owned environment/check IDs and never converts Pack data into a process plan.
- **Residual:** validation does not certify instructional quality, factual correctness, ownership, or licensing. Aptiloop intentionally bundles no Course; any future first-party/sample Course would need separate approval. Native trusted checks remain unsandboxed, so imported bytes remain non-executable by contract.
- **Observed test:** malformed JSON/encoding/BOM/duplicates, byte/depth/item/string/parse budgets, forbidden paths/authority/secrets/URLs, graph/locale/reference/requirements errors, hash mismatch/collision, rollback/cleanup, canonical Kit/import parity, idempotent re-import, and preserved-history uninstall.
- **Gate:** V1 local import is accepted; archive/directory transport, executable content, registries/signatures, and public Course distribution services remain disabled. A first-party/sample Course is not required for the application release and would be a separately approved artifact.

### SEC-PACK-ARCHIVE-001 — Future archive or directory transport

- **Rank/status:** **Future**.
- **Attack path:** a later archive/directory uses zip-slip, mixed separators, drive/UNC/device/ADS names, duplicate/confusable entries, symlink/hardlink/junction/reparse entries, special files, or decompression bombs.
- **Impact:** host file overwrite/read, executable placement, unsafe link traversal, resource exhaustion, and partial malicious import state.
- **Existing mitigation:** no archive/directory intake exists; Core Alpha V1 accepts one JSON document and rejects archive/directory transport.
- **Source fix:** require a separately approved transport schema, pre-extraction byte/count/depth/ratio limits, normalized-name collision checks, rejection of links/special files, private staging, atomic commit, and cleanup.
- **Required test:** run the complete malicious extraction corpus for zip-slip, separators, drive/UNC/device/ADS names, collisions/confusables, links/reparse points, special files, bombs, partial failure, and cleanup before enabling transport.
- **Gate:** no archive/directory intake exists or is advertised in Core Alpha; adding it requires a new security review and release-scope approval.

### SEC-EXEC-001 — Future isolation for executable activities

- **Rank/status:** High; **Future**. Current native execution remains trusted-only and is not a sandbox.
- **Attack path:** future imported or AI-authored code reaches a server-owned Node/Python check that runs with the local account, host home, credentials, network, or writable mounts.
- **Impact:** local code execution, data/credential theft, host modification, network abuse, and persistence.
- **Existing mitigation:** M5 maps only finite exact environment/check IDs to app-owned `shell: false` plans, uses per-attempt containment, minimal non-secret environments, complete-workspace input hashing, time/output/cancellation/tree-cleanup limits, structured artifacts, and immutable review bundles. Core Node/Python contracts accept fixed app-owned locks/plans; compatibility npm is restricted to repository-controlled trusted templates.
- **Source fix:** keep Course Packs non-executable and the current backend explicitly trusted/unsandboxed. If a later product adds untrusted execution, require a separately approved isolated backend with immutable runtimes, no host home/credentials/network/mounts, disposable writable workdir, quotas, and escape testing.
- **Required test:** current Fabric/path/process/review suites must remain green. Before any untrusted capability, add the isolation escape corpus for filesystem, environment, network, fork/process, resource, symlink/mount, timeout, cleanup, and concurrent runs on every supported backend; verify host/private data unchanged.
- **Gate:** no untrusted executable activity before independent isolation review.

## 4. Positive-control assurance records

### PC-PATH-001 — Canonical attempt containment

- **Attack path addressed:** traversal, absolute/drive/UNC/device/ADS, or reparse link escapes from a template/attempt path.
- **Impact addressed:** read/write outside approved roots.
- **Existing mitigation:** canonical containment and link/reparse rejection are Implemented baseline.
- **Source preservation/fix:** centralize all future pack and execution paths through the same boundary; never reimplement lexical-only checks.
- **Test:** retain traversal, mixed-separator, reserved-name, symlink, junction, and deletion-containment regressions.

### PC-REVIEW-001 — Reviewer write denial and covered-patch change detection

- **Attack path addressed:** Reviewer mutates learner work inside the Git-visible covered set.
- **Impact addressed:** corrupted attempt and approval against a changed covered patch.
- **Existing mitigation:** **Implemented baseline.** A complete-workspace SHA-256, complete non-truncated diff, matching check evidence, and before/after snapshot equality bind the evidence-only Reviewer. Git-ignored regular files are included subject to explicit app-owned exclusions.
- **Source preservation/fix:** keep Reviewer without local/general tools or patch/apply authority and retain both workspace and diff checks.
- **Test:** preserve same-mtime visible mutation, truncated-display, baseline-marker tampering, stale visible patch, and before/after mutation regressions; add the sentinel and ignored-file suites from the ranked findings.

### PC-SNAPSHOT-001 — Session-time snapshot hashing and protected DTOs

- **Attack path addressed:** normal authored-content changes or caller-crafted state silently changing a live session snapshot, and protected-answer leakage to learner DTOs.
- **Impact addressed:** non-reproducible live progress and protected-answer disclosure.
- **Existing mitigation:** creation-time immutable snapshots, learner/protected DTO separation, M4 append-only scoped facts, server-owned completion/evaluator/check provenance, deterministic correction/history handling, replay-equal canonical projections, and complete-workspace freshness are an **Implemented baseline**. SEC-MIGRATION-001 covers historical migration.
- **Source preservation/fix:** preserve snapshot hashing/redaction and accepted-fact immutability; never infer target authority from ambiguous legacy rows.
- **Test:** content-change pinning, protected-field redaction, idempotent operations, objective-authority rejection, correction history, input-order replay equality, scoped evidence rejection, and migration byte preservation.

## 5. Security approval evidence

M0–M5 results are dated historical **Implemented baseline** evidence, not current working-tree approval. Later M6/M10 evidence adds Provider Hub caller cutover, constrained role/tool matrices, exact disclosure, budgets/cancellation, Course Designer scope, and one authenticated OpenCode Zen `deepseek-v4-flash-free` smoke using synthetic data in a disposable database. That smoke proves only the exact reviewed adapter path. No public distribution, general provider readiness, hosted GitHub Actions result, complete Core Alpha release acceptance, or approval for a future first-party/sample Course is implied. The normal application intentionally starts with no bundled Course.
