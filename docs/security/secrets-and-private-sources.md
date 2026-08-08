# Secrets, Private Sources, and Local Data Lifecycle

**Document status:** Approved Core Alpha target with Implemented baseline gaps. Target controls are not claimed as implemented.

## 1. Data classes

| Class | Examples | Default handling |
| --- | --- | --- |
| Secret | provider tokens, passwords, cookies, authorization headers, private keys, auth-store material | memory or provider-owned credential store only; never Course Pack, transcript, tool event, log, SQLite, backup, export, or model context |
| Private learner data | answers, interviews, mistakes, mastery, flashcard decisions, transcripts, code/diffs/tests/reviews | local-only plaintext baseline; minimize, no-store over HTTP, explicit export/delete/retention |
| Private source | local document, licensed/internal material, notes, source credentials, private URL content | local Source Snapshot/Knowledge Capsule; no fetch/upload/share without a separate explicit action |
| Local operational data | filesystem paths, DB/attempt roots, provider/model IDs, runtime diagnostics | minimize and disclose only where required; paths are private by default |
| Public Course content | owner-approved pack manifest/content/provenance | still untrusted for rendering/import; no execution authority |
| Security audit data | tool name/status/operation ID, bounded failure code | allowlisted and bounded; no raw tool input/output or secret value |

Classification follows the most sensitive constituent. A Knowledge Capsule derived from a private Source Snapshot remains private unless an explicit declassification workflow exists.

## 2. Core privacy contract

**Approved Core Alpha target:** private data never leaves the local profile without an explicit action at the point of disclosure. The action must identify recipient/provider, data classes, selected scope, purpose, and whether a copy may be retained externally. Enabling an AI provider, opening a Course, or accepting general terms is not authorization to upload private sources or learner history.

A Source Snapshot captures stable local evidence and provenance. It is not a live URL fetch permission. Knowledge Capsules carry source IDs, content hashes, locale, provenance, and privacy class. AI receives only an application-built bounded capsule necessary for the approved action, never an entire database, directory, environment, or auth store.

## 3. Implemented baseline

Positive controls observed: loopback/single-user defaults; `.data`, SQLite, and `.env` Git exclusions; no intended credential columns; OpenCode endpoint restricted to loopback and password converted to an in-memory Authorization header; client SSE suppression of raw provider event fields; exercise child environment allowlisting; non-root containers; foreign keys/WAL; and non-overwriting integrity/FK-checked backups.

Gaps observed: Codex inherits the full orchestrator environment; OpenCode raw tool input/output may persist; learner/AI/private operational data is plaintext in SQLite/WAL/backups; no complete retention/export/delete contract or owner-only cross-platform storage enforcement was found; and Markdown can trigger external resource fetches. Database integrity checks do not provide confidentiality.

## 4. Secret lifecycle

**Approved Core Alpha target:**

1. **Acquire:** accept provider secrets only through provider-owned auth or a protected local configuration path; never from a Course Pack, learner prompt, or AI tool.
2. **Resolve:** explicit provider credential wins according to provider rules; an auth/refresh failure is explicit and does not silently fall back to another credential source or Mock.
3. **Use:** expose the credential only to the minimum provider transport for the minimum operation. Build child environments from an allowlist.
4. **Observe:** logs, UI, errors, traces, tool events, and metrics contain no secret value, raw headers, provider stderr, or auth-store paths.
5. **Persist:** do not persist tokens/passwords/cookies/Authorization. Store only non-secret provider/model/profile identity when needed.
6. **Rotate/revoke:** surface provider-owned rotation/logout and invalidate application sessions that depended on the credential.
7. **Incident:** if a secret may have entered model context, tool output, SQLite, WAL, backup, or logs, rotate it first; then inventory and remove every local copy under an approved recovery procedure.

## 5. Control records

### DATA-CTRL-001 — Child-process secret isolation

- **Attack path:** provider or execution child inherits root environment and reads cross-provider/application secrets.
- **Impact:** credential disclosure, account/cost abuse, and lateral access.
- **Existing mitigation:** Implemented baseline exercise child environment is allowlisted; Codex output has best-effort redaction. Codex full environment inheritance remains SEC-CRED-001.
- **Source fix:** dedicated minimal environment builders for every provider/runtime; deny secret-shaped and cross-provider variables; narrowly scope auth-store paths; no host credential mounts for Future untrusted execution.
- **Test:** varied sentinel names/values in parent environment; capture child environment and all outputs/storage/backups; sentinel is absent while required runtime discovery still works.

### DATA-CTRL-002 — Tool-event and transcript minimization

- **Attack path:** provider tool input/output/error contains secret/private content and is persisted verbatim or copied into backup/export.
- **Impact:** durable plaintext disclosure and multiplied copies.
- **Existing mitigation:** Implemented baseline browser SSE minimizes raw tool fields; Reviewer OpenCode tools are denied; Codex tool notifications are reduced. OpenCode persistence remains SEC-AI-002.
- **Source fix:** remove general tools and persist only a typed bounded audit envelope; field-specific redaction occurs before any log/SSE/DB write; raw provider protocol is never stored.
- **Test:** nested/encoded/split sentinel fixtures; assert absence from all messages, tool JSON, reviews, logs, WAL, backups, and exports; approved audit metadata remains.

### DATA-CTRL-003 — Private provider disclosure

- **Attack path:** Tutor/Designer/Evaluator/Reviewer context builder automatically includes private sources, broad history, code, paths, or answers when a real provider is selected.
- **Impact:** unapproved external disclosure, provider retention, and possible contractual/privacy breach.
- **Existing mitigation:** Implemented baseline runs locally by default and does not expose credentials/raw protocol to the browser; no complete point-of-disclosure consent contract was observed.
- **Source fix:** privacy-tag every context item; preview recipient/provider and selected data classes; require an explicit scoped action; construct the minimum capsule; record only decision metadata, not secret/private payload duplication.
- **Test:** default provider request excludes every private class; selecting specific synthetic items includes only those items; cancellation/denial sends nothing; changing provider or scope requires a new action.

### DATA-CTRL-004 — Source acquisition and external fetch

- **Attack path:** Markdown or a source URL automatically fetches attacker/intranet resources, sends referrer/timing/IP, or downloads mutable content without approval.
- **Impact:** privacy disclosure, unwanted local-network requests, and unreviewed content substitution.
- **Existing mitigation:** Implemented baseline React escaping/no raw HTML and same-origin referrer policy; current Markdown image handling remains SEC-WEB-001.
- **Source fix:** no automatic external resource rendering; safe URL schemes; explicit user-initiated fetch naming URL/provider; fetch through a bounded policy component if introduced; snapshot bytes/hash/provenance locally; never fetch `file:`, loopback, link-local, private-network, or credential-bearing URLs by default.
- **Test:** remote/loopback/private-IP/IPv6/DNS-rebind/redirect/credential URL and Markdown image fixtures; no request before approval; prohibited targets remain blocked; accepted snapshot hash is stable.

### DATA-CTRL-005 — Plaintext storage permissions and cache

- **Attack path:** local account, shared/synced directory, backup agent, or HTTP cache reads SQLite/WAL/backups/private API responses.
- **Impact:** learner/source/path/code/provider-history disclosure.
- **Existing mitigation:** Implemented baseline local single-user scope, Git ignores, non-root container, and private named volumes reduce exposure; files remain plaintext and OS-default permissions are not a confidentiality policy.
- **Source fix:** POSIX 0700 data/backup directories and 0600 DB/WAL/backups; Windows owner-only ACL guidance/enforcement; private API `Cache-Control: no-store`; reject unsafe shared profile roots; decide encryption requirements before portable/shared use.
- **Test:** mode/ACL integration checks, unsafe-root rejection, no-store headers, sync/export fixture, and proof that integrity checks are not represented as encryption.

### DATA-CTRL-006 — Retention, export, and deletion

- **Attack path:** data remains indefinitely across main DB, WAL/SHM, backups, attempts, Source Snapshots, provider transcripts, tool events, or exports after a learner expects removal.
- **Impact:** unexpected future disclosure and inability to satisfy user intent.
- **Existing mitigation:** Git exclusion and consistent backups exist; no complete profile lifecycle was observed.
- **Source fix:** define owner-approved retention by data class; offer local inventory/export; profile deletion covers DB/WAL/SHM, attempts, snapshots/capsules, generated exports, and application-managed backups; explain limits of secure deletion on SSD/snapshots/sync; never delete user-selected external backups silently.
- **Test:** seeded profile inventory matches export; deletion removes all application-managed copies and leaves no dangling DB references; retention expiry is deterministic; external-copy warning is shown/recorded.

### DATA-CTRL-007 — Backup confidentiality and recovery

- **Attack path:** a verified plaintext backup is placed in a broadly readable/synced location or contains secrets/raw tool data; restore reintroduces them.
- **Impact:** disclosure and repeated compromise after recovery.
- **Existing mitigation:** Implemented baseline backups are non-overwriting and pass integrity/foreign-key checks.
- **Source fix:** private destination permissions, explicit destination/privacy warning, minimization before backup, inventory/retention metadata, and restore-time schema/security migration. Encryption, if approved, is a separate confidentiality control with recovery-key design.
- **Test:** permissions/destination checks; secret sentinel absent; corrupt backup rejected; restore preserves data and applies cleanup migrations; retention never overwrites an existing backup.

### DATA-CTRL-008 — Export/share separation

- **Attack path:** a Course Pack, diagnostic bundle, flashcard export, or support report silently includes private sources, paths, learner history, attempts, credentials, or tool payloads.
- **Impact:** accidental disclosure through a portable artifact.
- **Existing mitigation:** Implemented baseline flashcard export is local and credentials have no intended schema; no generalized safe export was observed.
- **Source fix:** separate public Course Pack, learner-data export, and diagnostic bundle schemas; default to minimum; preview field classes and destination; private inclusion requires an explicit additional selection; secret fields are impossible by schema.
- **Test:** golden export inventories, synthetic secret/private sentinels, default/public/private variants, cancellation, and archive-content inspection.

## 6. Storage and sharing gates

Core Alpha cannot claim private-data readiness until:

- environment, context, persistence, logs, backups, and exports pass sentinel tests;
- private HTTP responses use no-store;
- the user can inventory/export and delete application-managed profile data;
- external fetch/upload requires a scoped explicit action;
- Source Snapshots and Knowledge Capsules retain provenance/hash/privacy class;
- backup destination, permissions, retention, and restore are documented and exercised; and
- remote/shared/synced profile modes remain unsupported unless a separate confidentiality design is approved.
