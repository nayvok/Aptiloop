# Core Alpha Threat Model and Remediation Register

**Document status:** Approved Core Alpha target and Implemented baseline audit. Target language is normative; it does not claim implementation.

## 1. Scope and method

Core Alpha is local-first and single-user. Supported deployment is browser plus local orchestrator on loopback, SQLite and local files, optional model/provider runtimes, declarative single-document Course Pack V1 import/export, and trusted repository-controlled exercise templates executed through the local-native Fabric. Remote multi-user operation, cloud synchronization, archive/directory Pack transport, and execution of untrusted code are not approved modes.

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
5. external Course Pack JSON bytes to privately staged validation to an explicitly installed immutable Course revision;
6. private local source to an explicitly approved provider disclosure.

`Origin` and client headers are request-shape controls, not identity. `shell: false`, command allowlists, containers, or a provider's “sandbox” option are not by themselves an Aptiloop security sandbox.

## 3. Ranked register

### SEC-AI-001 — Non-review AI tool and write authority

- **Rank/state:** High impact if re-enabled; **Implemented baseline** M1 containment.
- **Attack path:** a learning role attempts to select Codex/OpenCode or prompt for general file/edit/shell/network authority.
- **Impact:** without containment, repository/config/data mutation, local command effects, private-file or credential access, corrupted Learning Kernel behavior, and persistence compromise.
- **Existing mitigation:** the orchestrator permits Mock only for all five learning roles and rejects browser provider/model overrides; Codex/OpenCode remain blocked legacy adapters and `npm start` launches no sidecar.
- **Source fix:** make every learning role tool-free/read-only at the adapter and orchestration boundary. Expose only Aptiloop-owned typed tools with strict schemas, per-role allowlists, deterministic semantics, server execution, and bounded results. Provide no general filesystem, shell, network, or edit tools.
- **Required test:** table-test every role/provider policy; send prompt-injection content through Teacher and Interviewer and assert zero general-tool calls and unchanged repository/workspace hashes; preserve the Reviewer before/after-diff test.
- **Gate:** no external learning role may be enabled until the policy tests pass.

### SEC-REVIEW-001 — Reviewer read authority beyond evidence bundle

- **Rank/state:** High impact if re-enabled; **Implemented baseline** M1 containment.
- **Attack path:** learner-controlled evidence attempts to select an external Reviewer with project/local read or general tool authority.
- **Impact:** without containment, disclosure of source, credentials, learner data, and cross-attempt evidence to an external provider, response history, SQLite/WAL, and backups.
- **Existing mitigation:** Codex and OpenCode Reviewer are blocked at orchestration; the runnable correction cycle uses deterministic Mock and exposes no apply route. A future real Reviewer remains gated on an evidence-only capsule.
- **Source fix:** make Reviewer tool-free with only one bounded typed result contract; provide no project/local filesystem context or general tools, and disclose only the explicit app-built evidence capsule under a versioned policy.
- **Required test:** put sentinels in repository, `.env`, `.data`, home, private sources, and another attempt; send a malicious diff/test payload; assert no filesystem capability/call and no sentinel in provider request/response, SSE, SQLite, WAL, logs, or backup.
- **Gate:** real Codex Reviewer is blocked until the evidence-only capability and sentinel tests pass.

### SEC-CRED-001 — Full Codex child environment inheritance

- **Rank/state:** High impact if regressed; **Implemented baseline** M1 containment.
- **Attack path:** a provider child inherits unrelated root environment values, including cross-provider secrets.
- **Impact:** provider/password/token disclosure, unauthorized sidecar use, cost abuse, and credential reuse.
- **Existing mitigation:** Codex app-server receives a strict explicit environment containing essential OS/path, `CODEX_HOME`, and required OpenAI credential variables; unrelated database, OpenCode, and GitHub secret classes are excluded. Learning roles remain blocked.
- **Source fix:** construct a dedicated minimal Codex environment containing only required OS/PATH/home and a narrowly scoped auth-store location; remove secret-shaped and cross-provider variables before spawn. Keep output redaction only as defense in depth.
- **Required test:** inject sentinel API keys/passwords/tokens and unrelated secret names; capture spawn options and prove absence while required discovery variables remain; prove no sentinel reaches assistant output, logs, SQLite, WAL, or backup.
- **Gate:** real Codex is blocked until environment isolation and sentinel tests pass.

### SEC-AI-002 — Unredacted OpenCode tool-event persistence

- **Rank/state:** High impact if regressed; **Implemented baseline** M1 containment.
- **Attack path:** a provider emits arbitrary tool input/output/error JSON and an application layer attempts to stream or persist it.
- **Impact:** without containment, long-lived plaintext credentials, private-file content, prompts, or raw results could enter SQLite/WAL/backups.
- **Existing mitigation:** OpenCode normalization drops provider tool input/output; browser events are allowlisted; `LearningRepository.addMessage` stores literal `[]`/`NULL`; new reviews store no raw response; all external learning roles are blocked.
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

- **Rank/state:** High impact if regressed; **Implemented baseline** M1 containment.
- **Attack path:** a browser supplies role/provider/model fields or an unavailable external provider attempts to fall back to Mock.
- **Impact:** an unapproved provider/model could receive private context, use higher authority, create misleading provenance, or incur unapproved cost.
- **Existing mitigation:** the server owns a fixed per-role Mock profile, strict browser schemas reject authority fields, external adapters are blocked, and failure remains explicit without first-model or Mock substitution.
- **Source fix:** implemented for M1 containment; the later Provider Hub must retain this ownership while adding approved Pi profiles.
- **Required test:** reject role/provider/model overrides and unavailable external profiles; prove no provider call/session and no fallback; persist only app-owned provenance.
- **Gate:** external learning roles stay blocked until the target Provider Hub, disclosure, capability, and authenticated smoke gates pass.

### SEC-EVIDENCE-001 — Mock/model review verdicts become learning authority

- **Rank/state:** High; Implemented baseline finding.
- **Attack path:** every role defaults to Mock; the Mock Reviewer emits `passed` from prior-review count rather than technical correctness; the persisted verdict can satisfy exercise completion and feed a correct implementation outcome into deterministic summary/mastery.
- **Impact:** false evidence, incorrect mastery, premature progression, and misleading claims that learning was verified.
- **Existing mitigation:** review requires a current passing test and a matching Git-visible patch fingerprint; result schema is strict; provider write attempts that alter that visible patch are rejected. These controls do not cover ignored files and prove neither Reviewer truth nor Mock eligibility.
- **Source fix:** exclude Mock outside tests/CI/explicit developer mode and reject Mock output as learner evidence. Treat Reviewer feedback as read-only advice; only validated deterministic checks and separately typed, provenance-bound assessment facts may enter the Learning Kernel, which remains the sole mastery authority.
- **Required test:** production composition exposes no Mock; failed real providers create no successful evidence; forged/Mock review rows cannot complete an Activity or raise mastery; deterministic check and correction evidence remain replayable.
- **Gate:** no production review or mastery path accepts Mock or provider prose as authoritative success.

### SEC-INTEGRITY-001 — Legacy deterministic-integrity bypass

- **Rank/state:** High impact if regressed; **Implemented baseline** v1 write freeze, with separate v2 relationship risks tracked by SEC-RELATION-001.
- **Attack path:** a caller attempts legacy v1 session, answer, or completion mutation instead of versioned evidence and server-owned progression.
- **Impact:** without the freeze, mastery and review state can diverge from actual evidence and undermine deterministic replay.
- **Existing mitigation:** legacy POST routes return 410 before parsing or repository access; legacy reads remain available; the versioned v2 path stays runnable with hashed snapshots, typed/idempotent evidence, server-owned transitions, and deterministic summary/mastery rules.
- **Source fix:** implemented for externally reachable v1 mutations. M2/M11 still must reconcile retained historical rows and eliminate the separate caller-controlled v2 relationship gaps.
- **Required test:** legacy GET reads remain; every legacy mutation is 410 with zero repository writes; the complete Mock-backed v2 vertical remains operational.
- **Gate:** preserve the freeze while later migrations prove provenance and deterministic replay.

### SEC-RELATION-001 — Caller-controlled Teacher/Interview evidence relationships

- **Rank/state:** High; Implemented baseline finding.
- **Attack path:** generic v2 progress accepts browser-supplied Teacher conversation/count/revision IDs or Interview session/report IDs; current criteria do not fully prove session, revision, Activity, conversation, interview, answer, and report ownership, so unrelated or forged relationships can satisfy completion.
- **Impact:** false Activity completion, successor unlock, fabricated revision evidence, incorrect summary/mastery, and nondeterministic replay.
- **Existing mitigation:** payloads are schema-validated; status transitions are server-owned; Interview answer counts and Teacher message counts are checked; summaries are deterministic over persisted facts. The facts' relationships are not fully authorized.
- **Source fix:** create server-owned, typed, append-only Teacher and Interview evidence; prove the complete session → snapshot/revision → Activity → conversation/interview/report relationship in repository queries; browser requests carry only operation and entity intent, never evidence status or relationship IDs.
- **Required test:** reject cross-session Interview IDs, missing/mismatched reports, an Interview from another Activity/revision, arbitrary/null Teacher conversation IDs, unrelated messages, and forged revision arrays; assert progression, summary, and mastery remain unchanged.
- **Gate:** deterministic-learning cutover requires zero caller-controlled evidence relationship.

### SEC-DIFF-001 — Git-ignored state absent from freshness evidence

- **Rank/state:** High; Implemented baseline finding.
- **Attack path:** an ignored executable, dependency, configuration, or data file affects the allowlisted test; it is created or changed after a passing run or during review, while `git ls-files --others --exclude-standard` omits it and the patch fingerprint remains unchanged.
- **Impact:** stale or false passing evidence, Reviewer mutation outside the compared patch, incorrect Activity completion, and corrupted mastery.
- **Existing mitigation:** tracked, staged, and non-ignored untracked changes are included; the visible patch is non-truncated for fingerprinting; matching SHA-256 and before/after checks reject changes in that covered set.
- **Source fix:** build a canonical manifest/hash of every allowed regular workspace file independent of Git ignore, with explicit app-owned exclusions; fail closed on disallowed ignored executable/config state, links, oversize files, and manifest changes.
- **Required test:** ignored files present before/after test, newly ignored files, `.git/info/exclude`, global excludes, binary/large files, and mutation during Reviewer all invalidate freshness or fail closed.
- **Gate:** no execution/review result becomes learning evidence until the complete allowed-workspace manifest is fresh and unchanged.

### SEC-MIGRATION-001 — Startup repair rewrites historical evidence

- **Rank/state:** High; **Implemented baseline** containment accepted in M2.
- **Historical attack path:** normal startup could invoke repair before operator reconciliation, rewrite historical snapshot JSON/hashes, replace malformed progress with defaults, or infer a missing unit type without a verified backup.
- **Impact:** irreversible loss of original evidence bytes, fabricated historical meaning, broken replay/provenance, and incorrect progression/mastery.
- **Implemented mitigation:** ordinary startup and writable operation admit only the exact current `0000`–`0013` contract and never upgrade a predecessor. The explicit backup-path/hash-bound migration command alone admits exact predecessor stages. It proves source/backup lineage, integrity, foreign keys, private-payload gates, exact schema/trigger identity, immutable history, and whole-file recovery before writing. M2 preserves snapshots/provenance and quarantines ambiguity; M3–M5 add immutable Pack, kernel, and execution records without deleting source history.
- **Source fix:** implemented for additive migrations `0006` through `0013`. Quarantined rows remain invalid target truth, accepted kernel/Pack/execution records are immutable, and no legacy deletion/down migration is authorized.
- **Observed test:** disposable fresh/legacy/malformed/partial fixtures cover exact-stage admission, wrong/changed backups, schema/ledger mismatch, transaction rollback, repeated no-op, byte/hash preservation, quarantine arithmetic/tamper rejection, integrity/foreign keys, and immutable history. Pack/kernel/execution repository suites additionally cover atomic rollback, conflicting replay, canonical replay equality, collision behavior, and scoped ownership.
- **Gate:** additive M2–M5 schema promotion is closed locally. Any valuable-data application still requires an explicit read-only inventory and new active-source-only approved backup at the point of migration; destructive cutover remains separately gated.

### SEC-AI-003 — Unbounded AI output and event accumulation

- **Rank/state:** Medium; Implemented baseline finding.
- **Attack path:** a provider sends many individually valid deltas/tool events or oversized completed/review content within the turn deadline; orchestrator concatenates, streams, parses, renders, and persists without a cumulative byte/event budget.
- **Impact:** browser/orchestrator memory and CPU pressure, SQLite/backup growth, Markdown rendering stalls, disk exhaustion, and availability loss.
- **Existing mitigation:** input-size limits, provider deadlines, a Codex per-line limit, and exercise/Git output caps exist, but they do not cap a complete AI turn.
- **Source fix:** enforce common cumulative bytes, event/tool count, structured array/string, persisted-field, and rendering budgets; abort fail-closed and store only a bounded diagnostic; use bounded buffers.
- **Required test:** malicious fake providers emit many small deltas, giant completion, excessive tools, and oversized review arrays; assert threshold abort, bounded SSE/storage, no partial trusted review, and cleanup.
- **Gate:** all provider adapters must pass identical budget tests.

### SEC-CANCEL-001 — Codex cancellation lacks terminal cleanup

- **Rank/state:** Medium; Implemented baseline finding.
- **Attack path:** Codex starts a turn but never emits a terminal notification; `turn/interrupt` succeeds or is ignored while the local queue, SSE response, and session remain pending without a complete-turn deadline.
- **Impact:** stuck requests, retained memory/session state, leaked child descendants, and local availability loss.
- **Existing mitigation:** individual RPC calls time out; client abort requests cancellation; OpenCode has a separate turn deadline; Codex shutdown kills its direct child after a grace period.
- **Source fix:** add a complete-turn deadline and local abort path that closes the queue exactly once, emits a terminal cancelled/failed event, evicts state, attempts upstream interrupt, and performs process-tree cleanup.
- **Required test:** silent provider, ignored interrupt, disconnect/deadline race, duplicate terminal notification, and descendant cleanup scenarios leave no pending queue/session/process.
- **Gate:** each provider adapter passes the same deadline/cancellation/cleanup contract.

### SEC-SUPPLY-001 — Unresolved dependency advisories

- **Rank/state:** **Implemented baseline** shipped installed-tree gate; one reported low graph-dev-only finding remains.
- **Attack path:** a new or changed lockfile introduces an unclassified vulnerable dependency anywhere in the installed tree shipped by the orchestrator image, or hides lower-severity development evidence.
- **Impact:** upstream compromise, denial of service, executable development-tool exposure, or approval uncertainty.
- **Existing mitigation:** supported lock updates moved Hono to 4.13.1, Next to 16.3.0, nested PostCSS to 8.5.23, Sharp to 0.35.3, and nanoid to 3.3.18. Production audit is zero. Full audit reports only graph-dev-transitive esbuild 0.27.7 `GHSA-g7r4-m6w7-qqqr` through tsup 8.5.1; it is reported without exception because tsup constrains `^0.27.0`. The orchestrator image currently copies the full root `node_modules` tree.
- **Source fix:** committed policy archives full/production audit JSON and CycloneDX SBOM, preserves production and graph-dev-only findings, and fails on any shipped installed-tree High/Critical object. Blocking is derived once from full-report vulnerability objects, so production overlap is not double-counted. No force, override, downgrade, or fabricated exception is used.
- **Required test:** CI runs the policy after `npm ci`, uploads audit/SBOM artifacts even if later gates fail, and rejects synthetic production High/Critical, full-tree graph-dev-only High/Critical, malformed metadata, and mixed-scope residual High/Critical evidence.
- **Gate:** the observed full report has no High/Critical finding; the tightened shipped installed-tree policy and the rest of the integrated gate await refreshed execution, and future owner exceptions require an explicit owner and expiry.

### SEC-HTTP-001 — Incomplete request size/rate/schema guards

- **Rank/state:** Low in supported loopback mode; Implemented baseline hardening gap.
- **Attack path:** oversized or highly concurrent JSON reaches `req.json()` without a pre-parse byte/rate budget; test mode bypasses the fixed client header; chat/settings schemas strip unknown fields instead of rejecting them.
- **Impact:** local availability pressure, untested production request-shape behavior, and contract ambiguity that can hide attempted authority fields.
- **Existing mitigation:** mutations enforce exact Origin, `X-DLH-Client=web`, and JSON media type; API responses are no-store; forwarded-header ambiguity is rejected and never authorizes; chat/provider schemas reject authority fields; most versioned learning/interview/practice/authoring schemas are strict and bounded.
- **Source fix:** add a pre-parse byte limit, bounded concurrency/rate policy appropriate to loopback, production-equivalent header composition in tests, and closed strict schemas where rejection is the contract.
- **Required test:** oversized/chunked bodies, concurrency/rate threshold, missing/wrong client header in production mode, and unknown chat/settings fields fail with bounded explicit errors.
- **Gate:** request-boundary documentation may claim only controls exercised in production-equivalent tests.

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

- **Rank/state:** High boundary; M3 Course Pack V1 is an **Implemented baseline**.
- **Attack path:** one external JSON document exploits invalid/ambiguous encoding, duplicate keys, extreme byte/nesting/item/string/parse limits, forbidden local/UNC/device/traversal values, unsafe URLs, secret/command/plugin fields, hash collisions, graph defects, or partial persistence; installed data is then confused with execution authority.
- **Impact:** validation bypass, private-file/credential exposure, resource exhaustion, unintended authority, partial immutable state, or nondeterministic learning behavior.
- **Existing mitigation:** the importer accepts one byte-bounded UTF-8 JSON document, detects duplicate keys, uses a closed strict schema/canonical hash, rejects authority/path/secret/unsafe URL data, stages privately with expiry, validates graph/locale/provenance/manual-path/runtime requirements, requires Preview plus explicit Install/Open-as-draft, revalidates exact bytes/hash at commit, and persists transactionally. M5 resolves only known app-owned environment/check IDs and never converts Pack data into a process plan.
- **Residual:** validation does not certify instructional quality, factual correctness, ownership, or licensing; no production Course is approved. Native trusted checks remain unsandboxed, so imported bytes remain non-executable by contract.
- **Observed test:** malformed JSON/encoding/BOM/duplicates, byte/depth/item/string/parse budgets, forbidden paths/authority/secrets/URLs, graph/locale/reference/requirements errors, hash mismatch/collision, rollback/cleanup, canonical Kit/import parity, idempotent re-import, and preserved-history uninstall.
- **Gate:** V1 local import is accepted; archive/directory transport, executable content, registries/signatures, and production Course distribution remain disabled.

### SEC-PACK-ARCHIVE-001 — Future archive or directory transport

- **Rank/state:** Future; outside Core Alpha and not a V1 release gate.
- **Attack path:** a later archive/directory uses zip-slip, mixed separators, drive/UNC/device/ADS names, duplicate/confusable entries, symlink/hardlink/junction/reparse entries, special files, or decompression bombs.
- **Impact:** host file overwrite/read, executable placement, unsafe link traversal, resource exhaustion, and partial malicious import state.
- **Existing mitigation:** no archive/directory intake exists; Core Alpha V1 accepts one JSON document and rejects archive/directory transport.
- **Source fix:** require a separately approved transport schema, pre-extraction byte/count/depth/ratio limits, normalized-name collision checks, rejection of links/special files, private staging, atomic commit, and cleanup.
- **Required test:** run the complete malicious extraction corpus for zip-slip, separators, drive/UNC/device/ADS names, collisions/confusables, links/reparse points, special files, bombs, partial failure, and cleanup before enabling transport.
- **Gate:** no archive/directory intake exists or is advertised in Core Alpha; adding it requires a new security review and release-scope approval.

### SEC-EXEC-001 — Future isolation for executable activities

- **Rank/state:** High; Future boundary. Current native execution remains trusted-only and is not a sandbox.
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
- **Existing mitigation:** before/after Git-visible patch comparison and matching test-run fingerprint are Implemented baseline; M1 additionally blocks every external Reviewer. The deterministic Mock Reviewer remains a development/test compatibility path, and Git-ignored files remain outside the fingerprint; SEC-EVIDENCE-001 and SEC-DIFF-001 cover those gaps.
- **Source preservation/fix:** keep Reviewer without patch authority and retain covered-patch checks while replacing them with the evidence-only Reviewer and complete allowed-workspace manifest required by those findings.
- **Test:** preserve same-mtime visible mutation, truncated-display, baseline-marker tampering, stale visible patch, and before/after mutation regressions; add the sentinel and ignored-file suites from the ranked findings.

### PC-SNAPSHOT-001 — Session-time snapshot hashing and protected DTOs

- **Attack path addressed:** normal authored-content changes or caller-crafted state silently changing a live session snapshot, and protected-answer leakage to learner DTOs.
- **Impact addressed:** non-reproducible live progress and protected-answer disclosure.
- **Existing mitigation:** creation-time immutable snapshots, learner/protected DTO separation, M4 append-only scoped facts, server-owned completion/evaluator/check provenance, deterministic correction/history handling, and replay-equal canonical projections are an Implemented baseline. SEC-DIFF-001 still covers Git-ignored state in compatibility review freshness; SEC-MIGRATION-001 covers historical migration.
- **Source preservation/fix:** preserve snapshot hashing/redaction and accepted-fact immutability; never infer target authority from ambiguous legacy rows.
- **Test:** content-change pinning, protected-field redaction, idempotent operations, objective-authority rejection, correction history, input-order replay equality, scoped evidence rejection, and migration byte preservation.

## 5. Security approval evidence

M0 historical evidence remains baseline, not current approval: `npm run verify` passed its then-current gates, while E2E was 1/4 and no CI existed. M1 local acceptance closed on 2026-08-09 with zero production npm advisories plus one reported low dev-only advisory, a committed Node 24/npm 11 CI workflow, a refreshed 656-test `npm run verify`, a 30/30 E2E ownership/lock suite, two consecutive 4/4 lock-serialized E2E runs, active-data/backup checks, audit-policy/CycloneDX evidence, loopback smoke, and independent blocker closure. M2 local acceptance closed on 2026-08-09 after exact backup-bound active migrations through `0010`, byte-preserving reconciliation, runtime smoke, integrated verification, 4/4 E2E, inventory, and independent correctness/security/data-migration PASS reviews. M3–M5 local acceptance closed on 2026-08-10 after hostile Course Pack/transaction tests, deterministic kernel replay/persistence/reconciliation tests, finite Execution Fabric/environment/process/reviewer tests, the integrated `npm run verify` gate, and 4/4 Chromium E2E. A read-only active inventory then confirmed the exact `0000`–`0013` schema hash, integrity, foreign keys, compatibility, M2 reconciliation, and zero target orphans. No production Course, public distribution, hosted GitHub Actions result, or external-provider smoke is claimed.
