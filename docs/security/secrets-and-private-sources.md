# Secrets, Private Sources, and Local Data Lifecycle

**Document status:** **Approved Core Alpha target** with an evidenced **Implemented baseline** for local credential management, minimized provider persistence, and scoped disclosure across active Chat, Interview, Review, and Course Designer callers.

## 1. Data classes

| Class                  | Examples                                                                                           | Default handling                                                                                                                                                                                           |
| ---------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Secret                 | provider tokens, passwords, cookies, authorization headers, private keys, auth-store material      | explicit loopback Settings mutation, then connection-scoped local credential store; never browser response/persistence, Course Pack, transcript, tool event, log, SQLite, backup, export, or model context |
| Private learner data   | answers, interviews, mistakes, mastery, flashcard decisions, transcripts, code/diffs/tests/reviews | local-only plaintext baseline; minimize, no-store over HTTP, explicit export/delete/retention                                                                                                              |
| Private source         | local document, licensed/internal material, notes, source credentials, private URL content         | local Source Snapshot/Knowledge Capsule; no fetch/upload/share without a separate explicit action                                                                                                          |
| Local operational data | filesystem paths, DB/attempt roots, provider/model IDs, runtime diagnostics                        | minimize and disclose only where required; paths are private by default                                                                                                                                    |
| Public Course content  | owner-approved pack manifest/content/provenance                                                    | still untrusted for rendering/import; no execution authority                                                                                                                                               |
| Security audit data    | tool name/status/operation ID, bounded failure code                                                | allowlisted and bounded; no raw tool input/output or secret value                                                                                                                                          |

Classification follows the most sensitive constituent. A Knowledge Capsule derived from a private Source Snapshot remains private unless an explicit declassification workflow exists.

## 2. Core privacy contract

**Approved Core Alpha target:** private data never leaves the local profile without an explicit action at the point of disclosure. The action must identify recipient/provider, data classes, selected scope, purpose, and whether a copy may be retained externally. Enabling an AI provider, opening a Course, or accepting general terms is not authorization to upload private sources or learner history.

A Source Snapshot captures stable local evidence and provenance. It is not a live URL fetch permission. Knowledge Capsules carry source IDs, content hashes, locale, provenance, and privacy class. AI receives only an application-built bounded capsule necessary for the approved action, never an entire database, directory, environment, or auth store.

## 3. Implemented baseline

Positive controls observed: loopback/single-user defaults; `.data`, SQLite, and `.env` Git exclusions; no secret-value SQLite columns; exact Provider Hub connection/model resolution; API-wide `no-store`; browser event allowlisting; raw provider/tool payload exclusion; exercise child environment allowlisting; non-root containers; active-source-only approved backups; and Course Pack exports that exclude private learner/runtime state. Settings accepts a secret only in the explicit mutation, stores it connection-scoped in `.data/provider-credentials.json`, and returns only safe metadata/opaque references. Disclosure metadata binds provider, model, destination, entity IDs, payload categories, byte count, payload SHA-256, expiry, and lifecycle without copying the disclosed payload.

Remaining gaps: learner/AI/private operational data and POSIX/Linux credential storage are plaintext; Windows current-user DPAPI does not protect against same-user processes and legacy migration cannot prove historical plaintext bytes were erased; logical SQL inventory cannot prove byte absence from free pages, WAL/SHM, storage snapshots, or external copies; no complete retention/export/delete or owner-only cross-platform permission enforcement exists; and Markdown can trigger external resource fetches. Integrity checks do not provide confidentiality.

**Historical observation (2026-08-08):** the inventory found six database families and eleven existing backups with zero logical non-empty raw/tool rows. One family was selected as active; the other five and all old backups were preserved and excluded from automatic runtime, restore, and approved-backup selection. M2 later completed without authorizing their deletion or automatic promotion. See the [dated M1 inventory](../audits/2026-08-08-m1-safety-boundary-inventory.md). Current valuable-data operations still require an explicit active-source inventory and a fresh destination under `.data/approved-backups/`.

## 4. Secret lifecycle

**Approved Core Alpha target:**

1. **Acquire:** accept provider secrets only through an explicit loopback Settings mutation, provider-owned auth, or another approved protected local path; never from a Course Pack, learner prompt, or AI tool.
2. **Resolve:** the server resolves the exact credential source configured for the selected connection. Missing, invalid, or failed refresh/authentication remains explicit and does not switch provider, model, connection, or Mock.
3. **Use:** expose the credential only to the selected provider's authentication transport for the minimum operation. Never place it in model prompt/content. Build child environments from an allowlist.
4. **Observe:** logs, UI, errors, traces, tool events, and metrics contain no secret value, raw headers, provider stderr, or auth-store paths.
5. **Persist:** store provider credentials only in the connection-scoped app-owned local credential file or approved provider auth store. SQLite and browser responses/persistence store only non-secret identity/reference metadata.
6. **Rotate/revoke:** use explicit key replacement or supported subscription sign-out/revocation. Subsequent operations must re-resolve the updated connection state; do not claim provider-side revocation beyond the observed provider operation.
7. **Incident:** if a secret may have entered model context, tool output, SQLite, WAL, backup, or logs, rotate it first; then inventory and remove every local copy under an approved recovery procedure.

## 5. Control records

### DATA-CTRL-001 — Child-process secret isolation

- **Attack path:** provider or execution child inherits root environment and reads cross-provider/application secrets.
- **Impact:** credential disclosure, account/cost abuse, and lateral access.
- **Existing mitigation:** **Implemented baseline.** Exercise children and active provider adapters receive only boundary-specific minimal environments; unrelated connection/database/GitHub sentinels are excluded. Legacy Codex/OpenCode learning authority and automatic sidecar launch remain blocked.
- **Source fix:** dedicated minimal environment builders for every provider/runtime; deny secret-shaped and cross-provider variables; narrowly scope auth-store paths; no host credential mounts for Future untrusted execution.
- **Test:** varied sentinel names/values in parent environment; capture child environment and all outputs/storage/backups; sentinel is absent while required runtime discovery still works.

### DATA-CTRL-002 — Tool-event and transcript minimization

- **Attack path:** provider tool input/output/error contains secret/private content and is persisted verbatim or copied into backup/export.
- **Impact:** durable plaintext disclosure and multiplied copies.
- **Existing mitigation:** **Implemented baseline.** Active external callers use typed bounded tools/results; provider tool input/output is not forwarded or persisted as raw protocol. Browser events expose only an allowlist; messages store no raw event payload and reviews store no raw response. Historical read-only inventory found zero logical non-empty legacy rows, so no destructive cleanup was applied.
- **Source fix:** remove general tools and persist only a typed bounded audit envelope; field-specific redaction occurs before any log/SSE/DB write; raw provider protocol is never stored.
- **Test:** nested/encoded/split sentinel fixtures; assert absence from all messages, tool JSON, reviews, logs, WAL, backups, and exports; approved audit metadata remains.

### DATA-CTRL-003 — Private provider disclosure

- **Attack path:** Tutor/Designer/Evaluator/Reviewer context builder automatically includes private sources, broad history, code, paths, or answers when a real provider is selected.
- **Impact:** unapproved external disclosure, provider retention, and possible contractual/privacy breach.
- **Existing mitigation:** **Implemented baseline.** Provider Hub dispatch must match approved role, connection, provider, model, payload hash, status, and expiry, then consumes the approval once. Chat, Interview, Review, and Course Designer show destination/categories/exclusions without persisting the outbound payload in browser storage. Interview recovery uses exact persisted domain scope. Course Designer recovery is revision/workflow-scoped and may return a stale preview after Draft mutation, but current-payload hashing rejects it before provider work.
- **Source fix:** **Approved Core Alpha target.** Compare destination and entity IDs during dispatch and rederive Course Designer recovery payload/scope before returning the preview; retain minimum context and exact recovery scope for every new caller.
- **Test:** default requests exclude unrelated private classes; cancellation sends nothing; changing provider/model/payload requires a new action; reload cannot dispatch a cross-scope, stale, or terminal disclosure.

### DATA-CTRL-004 — Source acquisition and external fetch

- **Attack path:** Markdown or a source URL automatically fetches attacker/intranet resources, sends referrer/timing/IP, or downloads mutable content without approval.
- **Impact:** privacy disclosure, unwanted local-network requests, and unreviewed content substitution.
- **Existing mitigation:** Implemented baseline React escaping/no raw HTML and same-origin referrer policy; current Markdown image handling remains SEC-WEB-001.
- **Source fix:** no automatic external resource rendering; safe URL schemes; explicit user-initiated fetch naming URL/provider; fetch through a bounded policy component if introduced; snapshot bytes/hash/provenance locally; never fetch `file:`, loopback, link-local, private-network, or credential-bearing URLs by default.
- **Test:** remote/loopback/private-IP/IPv6/DNS-rebind/redirect/credential URL and Markdown image fixtures; no request before approval; prohibited targets remain blocked; accepted snapshot hash is stable.

### DATA-CTRL-005 — Local storage permissions, protection, and cache

- **Attack path:** local account, shared/synced directory, backup agent, or HTTP cache reads SQLite/WAL/backups/private API responses.
- **Impact:** learner/source/path/code/provider-history disclosure.
- **Existing mitigation:** **Implemented baseline.** Local single-user scope, Git ignores, non-root containers, API-wide `Cache-Control: no-store`, explicit candidate inventory, and private named volumes reduce exposure. Windows provider credentials use current-user DPAPI with strict fail-closed parsing and no plaintext fallback; POSIX systems request owner-only file modes. SQLite, backups, attempts, and POSIX/Linux credential storage remain plaintext, and OS-default directory permissions are not a complete confidentiality policy.
- **Source fix:** POSIX 0700 data/backup directories and 0600 DB/WAL/backups; Windows owner-only ACL guidance/enforcement for remaining private files; private API `Cache-Control: no-store`; reject unsafe shared profile roots; decide database encryption requirements before portable/shared use.
- **Test:** DPAPI real/fake round-trip and tamper rejection, atomic legacy migration and failure preservation, mode/ACL integration checks, unsafe-root rejection, no-store headers, sync/export fixture, and proof that integrity checks are not represented as encryption.

### DATA-CTRL-006 — Retention, export, and deletion

- **Attack path:** data remains indefinitely across main DB, WAL/SHM, backups, attempts, Source Snapshots, provider transcripts, tool events, or exports after a learner expects removal.
- **Impact:** unexpected future disclosure and inability to satisfy user intent.
- **Existing mitigation:** Git exclusion and consistent backups exist; no complete profile lifecycle was observed.
- **Source fix:** define owner-approved retention by data class; offer local inventory/export; profile deletion covers DB/WAL/SHM, attempts, snapshots/capsules, generated exports, and application-managed backups; explain limits of secure deletion on SSD/snapshots/sync; never delete user-selected external backups silently.
- **Test:** seeded profile inventory matches export; deletion removes all application-managed copies and leaves no dangling DB references; retention expiry is deterministic; external-copy warning is shown/recorded.

### DATA-CTRL-007 — Backup confidentiality and recovery

- **Attack path:** a verified plaintext backup is placed in a broadly readable/synced location or contains secrets/raw tool data; restore reintroduces them.
- **Impact:** disclosure and repeated compromise after recovery.
- **Existing mitigation:** Implemented baseline approved backups are active-source-only, preflighted, non-overwriting, stored separately under `.data/approved-backups/`, and pass integrity/foreign-key checks. Eleven historical backups remain unchanged and quarantined, not approved restore sources.
- **Source fix:** private destination permissions, explicit destination/privacy warning, minimization before backup, inventory/retention metadata, and restore-time schema/security migration. Encryption, if approved, is a separate confidentiality control with recovery-key design.
- **Test:** permissions/destination checks; secret sentinel absent; corrupt backup rejected; restore preserves data and applies cleanup migrations; retention never overwrites an existing backup.

### DATA-CTRL-008 — Export/share separation

- **Attack path:** a Course Pack, diagnostic bundle, flashcard export, or support report silently includes private sources, paths, learner history, attempts, credentials, or tool payloads.
- **Impact:** accidental disclosure through a portable artifact.
- **Existing mitigation:** M3 canonical Course Pack export is Course-scoped and schema-closed: learner evidence, mastery, transcripts, workspaces, provider sessions, credentials, UI settings, absolute paths, and unrelated adaptations have no export field. Flashcard export remains a separate explicit local action.
- **Residual/source fix:** generalized learner-data and diagnostic/support exports are still unimplemented. Keep those as distinct previewed schemas with minimum defaults and explicit private inclusion; secret-shaped fields must remain impossible.
- **Test:** Course Pack export/re-import hash parity and forbidden-field tests are implemented. Future learner/diagnostic exports require golden inventories, synthetic secret/private sentinels, cancellation, destination disclosure, and archive/content inspection.

## 6. Storage and sharing gates

Core Alpha cannot claim private-data readiness until:

- environment, context, persistence, logs, backups, and exports pass sentinel tests;
- private HTTP responses use no-store;
- the user can inventory/export and delete application-managed profile data;
- external fetch/upload requires a scoped explicit action;
- Source Snapshots and Knowledge Capsules retain provenance/hash/privacy class;
- backup destination, permissions, retention, and restore are documented and exercised; and
- remote/shared/synced profile modes remain unsupported unless a separate confidentiality design is approved.
