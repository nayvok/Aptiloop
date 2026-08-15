# Core Alpha Migration Strategy

> **Mixed-status migration strategy.** Current invariants and remaining compatibility-removal gates are normative. The staged M2–M11 plan and its exact artifacts are dated **Implemented baseline** history, not current operator instructions. Use [Current Database Operations](current-database-operations.md) for executable commands.

**Document status:** M2 additive Course foundations through M11 per-Course learner-state/session cutover were an **Implemented baseline** by 2026-08-10. The current additive ledger extends through `0020_adaptation_branch_lifecycle`; destructive compatibility-table removal and PostgreSQL remain an **Approved Core Alpha target**.

## Objective

Migrate additively from the legacy curriculum and current versioned-curriculum schema to a Core Alpha model centered on:

- `Course` as the top entity;
- immutable `CourseRevision` lineage;
- a finite, validated `Activity` graph;
- immutable session Source Snapshots;
- append-only, typed `Evidence` owned by the deterministic Learning Kernel;
- `ReviewItem` projections linked to their source Evidence;
- a personal adaptation branch that never edits a published revision.

The migration must preserve every old row and stored snapshot, record how each target row was derived, quarantine anything that cannot be mapped safely, avoid automatic database/content merges, and retain a tested compatibility period before removal.

## M2 implemented migration record

**Implemented baseline (2026-08-09):** migrations `0006_course_foundations` and `0007_quarantined_course_compatibility` add the target Course graph, source/capsule, adaptation, session-context, Evidence, Review Item, migration-run, provenance, and quarantine tables without dropping or rewriting source objects. `0008_m2_acceptance_corrections` preserves parent lineage, adds legacy publish guards, and binds an immutable `m2-v2` correction run. `0009_m2_acceptance_hardening` freezes accepted revision metadata, enforces source parent scope and snapshot-envelope identity, and closes remaining target ownership/append-only gaps with an immutable `m2-v3` run. `0010_m2_quarantine_immutability` freezes every quarantined source revision used as compatibility evidence and records the exact approved backup in an immutable `m2-v4` run. Fresh and migrated databases converge on schema SHA-256 `a6a1543e468e3dbb90494bc6e5d5598933e22dd0cf49a9830f82ee695eda5a01` and ledger `0000`–`0010`.

The valuable active database was selected only at `.data/dev-learning-harness.sqlite`, inventoried read-only, and rehearsed on disposable copies before every active write. Four distinct active-source-only rollback artifacts were approved: pre-M2 `.data/approved-backups/2026-08-09T15-00-16Z-pre-m2-active.sqlite` (`501338c295589d8367a31a1082ef7469ca0e22bb91e6a3123abdb94b70220f1b`), pre-`0008` `.data/approved-backups/2026-08-09T16-19-35Z-pre-m2-correction-active.sqlite` (`a09332dde7732b43b2ca6b9734bd5201fc6d71449c7c3d7303824d845418af09`), pre-`0009` `.data/approved-backups/2026-08-09T22-54-00Z-pre-m2-hardening-active.sqlite` (`9dc4b6af0c5e5a9b73cfa3e4f38240703d023f37ada6c3e0fa297dbe4aa22da2`), and pre-`0010` `.data/approved-backups/2026-08-09T23-34-00Z-pre-m2-quarantine-immutability-active.sqlite` (`bc325e8314117a3eb073ae015a5daf72ec3b4ea3f7f74aadfbfbe34a25c57f4d`). Each backup is standalone, healthy, immutable at its cutoff, and logically bound to its migration run.

The active reconciliation is complete as accounting, not as content promotion: 572 source rows equal 2 mapped + 526 quarantined + 44 intentionally unmapped. There are zero invalid provenance statuses and zero target orphans. Existing snapshots and hashes were unchanged. Quarantined records remain source history and cannot become target truth without a later explicit reconciliation. M11 target reads use explicit selected Course and per-Course session state; the legacy persistence bridge remains bounded, frozen compatibility storage.

There is no down migration. Whole-file recovery from one of the four named approved backups returns exactly to that artifact's cutoff and discards every later write. The operational sequence and observed identities are in [the M2 runbook](m2-course-foundations-runbook.md).

## M3–M5 additive migration record

**Implemented baseline (2026-08-10):** `0011_course_pack_lifecycle` adds immutable manifest, installation, staging, provenance, and quarantine records without allowing raw invalid bytes into active storage. Import is hash-confirmed and transactional; uninstall archives the installation and preserves Course/session/evidence history.

`0012_learning_kernel` adds append-only accepted facts, immutable projection history, a rebuildable current projection, mastery/mistake/review state, and provenance/quarantine. Reconciliation maps only provable legacy progress and quarantines ambiguous summaries. Versioned operations persist kernel facts before derived projections, and replay from one accepted frontier reproduces canonical bytes/hash.

`0013_execution_fabric` adds immutable Environment Pack and trusted-check descriptors, exact environment/check IDs on attempts and test runs, snapshot-bound structured artifacts, immutable review evidence bundles, and execution migration quarantine. Existing `commandId: "test"` maps to the finite app-owned compatibility contract; no attempt or source row is rewritten or deleted.

These migrations use the same explicit inventory, approved non-overwriting backup, exact-ledger admission, transaction rollback, and whole-file recovery discipline established for M2. M11 extended the exact schema through `0018_learner_course_state_trigger_guard`; additive `0019_provider_connection_retirement` later added managed-provider retirement while preserving historical provenance. Additive `0020_adaptation_branch_lifecycle` retains every archived personal branch, prevents more than one learner-active branch per Course, hardens base/head ownership, and pins every immutable session context to an exact revision-compatible branch. Open-as-draft keeps a distinct archived authoring branch and cannot rotate learner scope. Revision activation is rejected while the Course has an active session; after completion, Course and learner cursors rotate together while completed Kernel history remains replayable on the archived branch. An exact `0019` predecessor advances only through the same approved-backup path; ambiguous branch or session scope fails the transactional migration preflight rather than being guessed or rewritten. Ordinary startup rejects predecessor ledgers, while only the backup-bound migration CLI may advance an admitted exact predecessor. Use the current operations guide for the authoritative ledger and schema digest.

## M11 Course/session cutover record

**Implemented baseline (2026-08-10):** `0017_learner_course_state` adds one explicit learner-state row per active published Course. The deterministic backfill selects one Course by the former provable current-session pointer or stable Course order, binds a current session only when its active status and immutable `session_course_contexts` ownership match exactly, and does not rewrite legacy sessions, snapshots, evidence, or quarantine. Repository start/resume/complete operations maintain the per-Course pointer transactionally. Target path/current reads use the selected Course; simultaneous sessions in different Courses remain active and independently resumable. Legacy v1 mutations and the hardcoded dashboard return 410, while exact historical session reads and Course Pack export remain available. Verification exposed that the original context trigger also attempted to update learner state for completed and compatibility-only sessions; additive `0018_learner_course_state_trigger_guard` replaces that trigger and admits only active sessions on published target revisions.

The valuable active database was inventoried and copied without overwrite before `0017` to `.data/approved-backups/2026-08-10T14-56-15Z-pre-m11-course-cutover.sqlite` (whole-file SHA-256 `f76b8ad816094df0b7843864cd48e9e2f955b904753df494e0ef8170536ac710`). Before the corrective `0018`, the exact `0017` database was re-inventoried and copied to `.data/approved-backups/2026-08-10T15-22-43Z-pre-m11-trigger-guard.sqlite` (whole-file SHA-256 `0604a330404f94f45e0f6e0faeb62aeb3f0c5b906752825690849b91bdb05f88`). The current schema SHA-256 is `d517a45b89090fba10a6c8db268edf1cef08eb3ad5f67e09f89b00a20be86c40`; postflight observed `integrity_check=ok`, zero foreign-key violations, 19 exact migration markers, one selected Course among two state rows, zero invalid revision/session pointers, zero untracked active sessions, zero target orphans, and 526 retained quarantine rows. Exact replay reported already current.

Operator decision points remain fail-closed: stop writers before whole-file restore; preserve a failed migrated database and sidecars under a new incident path; never overwrite the approved backup; accept loss of post-cutoff writes or reconcile them only under a separate explicit recovery plan. The observation window retains compatibility tables, the synthetic legacy day bridge, immutable historical reads, local inventory/diagnostic export, and 526 quarantine rows. Any destructive rebuild requires a separate owner-approved gate and a new verified backup.

## Implemented baseline and known hazards

The current SQLite database contains two overlapping models.

### Legacy graph

- `topics`, `curriculum_days`, `curriculum_day_topics`, `questions`, and `exercises` describe global day content without Course/revision ownership.
- `learning_sessions`, `answer_attempts`, `exercise_attempts`, `test_runs`, `reviews`, `hints`, `mistakes`, `mastery_scores`, `mastery_evidence`, `flashcards`, `interview_sessions`, `agent_conversations`, and `agent_messages` contain learner/runtime history.
- legacy session reads can observe live seeded day/question/exercise content.

### Versioned graph

- `curricula`, `curriculum_versions`, `curriculum_weeks`, `curriculum_days_v2`, and `curriculum_units` are the closest current seams to Course, CourseRevision, and Activity;
- `session_snapshots` stores one creation-time hashed captured graph per versioned session; M2 immutability guards prevent later repair/rewrite of stored snapshot JSON or hashes;
- `unit_progress`, `hint_usages_v2`, and `versioned_unit_evidence` remain readable legacy projections, while new versioned operations also emit kernel facts through the M4 adapter;
- `learning_sessions` still requires a legacy day and optionally references a versioned day;
- `learner_course_states` replaces global active-session and `learner_state(id='default')` assumptions for target callers; the global row remains inert compatibility history.

Migration `0001` historically preserved a legacy revision and snapshots while abandoning all but the newest globally active session. The M2 guards now prohibit snapshot rewrites and the M4 reconciliation refuses to invent missing fact meaning; compatibility rows remain readable but no longer establish target kernel authority.

## Invariants

The following are non-negotiable:

1. Never delete, overwrite, rename, or mutate a legacy source row or existing `session_snapshots.snapshot_json` during additive backfill.
2. Never mutate a published revision. Corrections create a new immutable revision or a personal adaptation branch.
3. Never auto-merge candidate database files, Courses, revisions, Activities, Evidence, or workspace branches.
4. Never map an ambiguous record by guessing, `LIMIT 1`, recency, title similarity, or AI output. Quarantine it.
5. Every target row derived from old data has deterministic source provenance and content hashes.
6. Re-running inventory/backfill is idempotent and produces the same mappings, counts, and hashes.
7. No migration test or rehearsal may open or mutate the normal database. Use `:memory:`, a new temporary file, or a separate verified copy with an explicitly overridden path.
8. Before the first write to any candidate database, create and verify a distinct non-overwriting backup.
9. A failed migration transaction rolls back. After a committed migration, restore from the verified pre-migration backup is the rollback; there is no down migration.
10. The deterministic Learning Kernel remains the only owner of Activity state/mastery transitions. Migration translates facts and provenance; it does not invent outcomes.

## Historical staged migration design (M2–M11)

The Stage 0–6 sections below preserve the design executed during M2–M11. Future-tense statements and the former `--authorize-m2` spelling belong to that dated design and are not current status or operator guidance.

## Stage 0 — candidate database inventory

Inventory is read-only and precedes selection or backup.

### Candidate sources

At minimum inspect, when present:

1. any historical `DATABASE_URL` or operator path, supplied explicitly to read-only inventory as `--db` rather than opened by runtime;
2. `.data/dev-learning-harness.sqlite`;
3. `data/dev-learning-harness.sqlite`;
4. historical workspace-relative candidates such as `packages/database/.data/dev-learning-harness.sqlite`;
5. any other operator-supplied path from an earlier installation.

Treat each `.sqlite` plus its `-wal` and `-shm` sidecars as one candidate family. A 4 KiB main file with a populated WAL can contain current data; file size alone is not authority.

**Implemented baseline:** `npm run db:inventory` requires explicit `--root`/`--db` inputs, groups main/WAL/SHM families, discovers backup SQLite files recursively without following symlinks, inspects disposable copies, and reports health/migrations plus aggregate raw/tool/review counts without content. Runtime plus writable `db:migrate`/`db:seed` reject every candidate except active `.data/dev-learning-harness.sqlite` before opening; Compose permits exactly `/data/dev-learning-harness.sqlite`, and tests require explicit disposable mode. The approved backup command accepts only the active source after a complete-table preflight and writes a new file under `.data/approved-backups/`. Rich M2 schema/provenance reconciliation remains future.

### Inventory record

For each canonical absolute candidate path record:

- source kind and how it was discovered;
- canonical path and a non-secret operator label;
- file/WAL/SHM presence, sizes, and modification times;
- SQLite header/open result;
- `PRAGMA journal_mode`, `user_version`, `integrity_check`, and `foreign_key_check`;
- ordered `__dlh_migrations` IDs/timestamps, if present;
- schema fingerprint from normalized table/index/trigger definitions;
- row counts for every table;
- Course/curriculum/revision counts and active revision IDs;
- active/completed/abandoned session counts and global/per-course collisions;
- snapshot count, schema versions, stored content hashes, and canonical payload hashes;
- counts of progress, Evidence-like rows, Review-like rows, conversations, provider configuration, and settings;
- explicit orphan/mismatch/duplicate queries, including IDs that current FKs do not cover;
- a read-only inventory digest and timestamp.

Inventory must not checkpoint, migrate, seed, normalize, attach-and-copy, or otherwise write. If health checks fail, label the candidate unhealthy and stop normal migration; preserve it for a recovery procedure.

### Selection and no auto-merge

Present every candidate and inventory digest to the operator. The operator selects one database for one migration run. Other candidates remain untouched. The tool must never:

- pick the newest/largest candidate silently;
- union tables across files;
- copy “missing” rows between files;
- delete or rename an alternate;
- treat matching IDs as proof that data is identical.

Combining two databases is a separate explicit import/reconciliation project with its own provenance and conflict policy. It is not a startup or migration feature.

## Stage 1 — verified, non-overwriting backup

Before any migration write:

1. stop/quiesce writers and hold the maintenance boundary;
2. require healthy source `integrity_check` and `foreign_key_check`;
3. create a timestamped, unique destination different from the source;
4. use the Node `node:sqlite` online `backup()` API, or an equivalently consistent SQLite backup API, so committed WAL state is included;
5. refuse an existing destination and never overwrite an earlier backup;
6. open the backup read-only and require the same health checks;
7. compare schema fingerprint, table counts, migration markers, snapshots, and selected canonical hashes;
8. write a backup manifest containing source/backup identity, hashes, counts, tool/app version, timestamp, and verification result.

The implemented backup boundary restricts source and destination, repeats health/private-payload preflight, uses the Node `node:sqlite` online `backup()` API, refuses overwrite, and binds the produced logical digest to the approved source snapshot. M2 adds explicit `--authorize-m2` maintenance authorization: the migration CLI requires the exact named backup path and file SHA-256, re-verifies stable source/backup identity and lineage, performs an exact recovery-copy rehearsal, and rejects partial, stale, wrong-path, wrong-hash, or already-diverged inputs before writing.

A backup created after migration is useful operationally but is not a pre-migration rollback point.

## Stage 2 — additive target schema

Add new tables, indexes, constraints, and audit views without dropping or renaming old objects.

### Target relationships

- `Course(id, stable_id, primary_locale, ...)` is the parent of every authored object.
- `CourseRevision(id, course_id, revision, parent_revision_id, branch_kind, status, content_hash, ...)` is unique by `(course_id, revision)`; non-draft content is immutable.
- `Activity(id, course_revision_id, stable_id, type, graph_order, payload, ...)` is unique within a revision. Edges form a finite acyclic graph and reference Activities in the same revision.
- `LearningSession` references one Course/CourseRevision and one immutable Source Snapshot.
- `Evidence(id, session_id, course_revision_id, activity_id, evidence_type, operation_id, payload, observed_at, ...)` is append-only and explicitly tied to an Activity in the session snapshot.
- `ReviewItem(id, course_id, source_evidence_id, kind, status, due_at, payload, ...)` is a deterministic projection/reference, not free-standing AI prose.
- personal adaptation revisions/branches have an explicit owner and parent revision; they cannot become published Course content without the normal validate/publish flow.

Use composite foreign keys, scoped uniqueness, or equivalent triggers to prove Course→revision→Activity→session/snapshot agreement. Text IDs alone are insufficient. Keep SQLite-compatible repository contracts and avoid embedding SQLite-only behavior in the Learning Kernel so PostgreSQL can be added later.

### Provenance and quarantine

Add immutable migration provenance:

```text
migration_provenance
  run_id
  source_database_digest
  source_table
  source_primary_key
  source_row_hash
  target_entity_type
  target_id
  transform_version
  status: mapped | quarantined | intentionally_unmapped
  reason_code
  created_at
```

The unique source identity prevents duplicate mapping on rerun. Store canonical original payload or an immutable sidecar reference when a transformation would otherwise lose fields.

Quarantine records include source identity/hash, candidate target context, machine-readable reason, bounded diagnostic, original payload reference, and resolution state. Examples: missing parent, ambiguous revision, ID collision with different content, invalid JSON, evidence outside snapshot, mismatched unit type, protected-answer leakage, and inconsistent cross-course references.

Quarantine is preservation, not deletion. A later owner-approved resolution creates a new provenance row/version; it never edits the original source or silently changes an earlier mapping.

## Stage 3 — deterministic backfill

Backfill in parent-before-child order within bounded transactions and record a run manifest.

### Course and revision mapping

| Source                                       | Target                                             | Rule                                                                                                                                                                                                   |
| -------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `curricula`                                  | `Course`                                           | Deterministic ID from source ID; preserve slug/title/description and record source row hash.                                                                                                           |
| `curriculum_versions`                        | `CourseRevision`                                   | Preserve revision, status, parent, content hash, and timestamps; reject/quarantine cross-course parents or duplicate revision conflicts.                                                               |
| `curriculum_weeks`, `curriculum_days_v2`     | Revision graph/group metadata                      | Preserve stable IDs, order, titles, and source JSON; do not flatten away provenance.                                                                                                                   |
| `curriculum_units`                           | `Activity`                                         | Preserve stable ID/type/order/payload and exact revision membership; validate finite graph and protected fields.                                                                                       |
| legacy `curriculum_days/questions/exercises` | Activities in an explicit imported legacy revision | Preserve original IDs and rows. Do not treat legacy live content as the current Course revision. `workspace_path`/allowed operations are historical provenance, not executable target manifest fields. |

Existing `session_snapshots` remain byte-preserved. A target snapshot projection may reference their digest and parse them through a versioned adapter, but the migration must not rewrite the stored JSON/hash. When an old snapshot is malformed, quarantine the projection and keep the bytes.

### Evidence mapping

- `answer_attempts` and `versioned_unit_evidence` become typed Evidence candidates with original attempt/operation IDs, timestamps, correctness, payload, and question provenance;
- `exercise_attempts`, `test_runs`, and workspace diff fingerprints become attempt/check Evidence linked to the correct exercise Activity and input snapshot;
- `reviews` become read-only review Evidence only when Activity, test freshness, result schema, and provider provenance can be established; raw responses remain historical/private data, not authoritative structured results;
- `mastery_evidence` is preserved as historical Evidence input. `mastery_scores` is a projection/checkpoint and must not replace missing event history;
- interview/conversation facts map only to the evidence types they actually establish. Current interview reports do not prove technical correctness or mastery;
- operation-id idempotency and chronological source identity are retained.

Do not synthesize correctness, successful UTC days, repeated-error occurrence counts, conversation linkage, or missing Activity membership. Quarantine what cannot be proven.

### ReviewItem mapping

- `mistakes`, `flashcards`, eligible hints, and due-review projections become ReviewItem candidates with source type/ID and Evidence provenance;
- approved/rejected/suspended/archived states are preserved exactly;
- a `ReviewItem` without provable Course/source Evidence is quarantined rather than attached to a default Course;
- generated review scheduling is recomputed only by the versioned deterministic rule after source facts are complete and parity is approved. Migration does not fabricate due dates.

### Reconciliation

Before enabling any target read, prove:

- source rows equal mapped + quarantined + intentionally-unmapped rows for every table;
- all target scoped relationships and finite-graph rules hold;
- snapshot bytes/hashes and published revision hashes are unchanged;
- target IDs/content hashes are stable across a repeated dry run;
- no protected answers moved into learner-readable Evidence/DTO fields;
- every target Evidence/ReviewItem has a complete provenance chain;
- explicit orphan queries return only recorded quarantine entries.

Any unexplained difference blocks promotion.

## Stage 4 — dual-read shadowing

Dual-read is comparison, not result merging.

1. Keep the implemented legacy/versioned reader as user-visible authority.
2. Read the target model in shadow for the same explicit Course/session request.
3. Canonicalize both to a comparison DTO and record only bounded local parity diagnostics.
4. Classify differences as expected version adapter differences or blocking mismatches.
5. Never choose the “newer,” “richer,” or successful result automatically; never combine arrays/rows from both stores.
6. Add an owner-controlled cutover flag scoped to a named read surface, not a global hidden fallback.
7. When target becomes primary, a mismatch fails visibly or uses the explicitly selected compatibility reader; it does not silently switch per record.

Required parity surfaces include Course library/path, revision graph, session resume, Activity status, Source Snapshot, Evidence history, mastery inputs/projection, Review queue, attempts/checks/reviews, and export.

## Stage 5 — transactional dual-write

While old routes/readers remain:

- new operations use one server-owned operation ID and canonical payload hash;
- in SQLite, target and required compatibility writes occur in one transaction; either both commit or neither commits;
- write immutable target facts first conceptually, then compatibility projections. Existing repository contracts decide physical order but cannot acknowledge success until both are durable;
- replay with the same operation/payload is idempotent; same operation with a different payload is rejected;
- new sessions write explicit Course/revision/snapshot/Activity ownership and only the minimum compatibility legacy keys still required;
- new Evidence carries session, snapshot/revision, Activity, evidence type, and operation provenance;
- projection failures do not downgrade authoritative Evidence or produce partial success;
- no dual-write mutates published revisions, existing snapshots, or old evidence rows.

For a future PostgreSQL adapter, preserve equivalent transactional/idempotency semantics through repository contracts. Do not introduce cross-database dual-write in Core Alpha.

## Stage 6 — cutover and observation

Cut over one bounded surface at a time after its tests and parity thresholds pass:

1. Course/revision discovery;
2. session start/resume and snapshots;
3. Activity progression;
4. typed Evidence writes/reads;
5. mastery reconstruction/projections;
6. ReviewItem queue and review completion;
7. authoring/publish/export.

Keep compatibility reads available behind an explicit owner rollback flag for the observation window. Keep legacy writes only for callers still proven to need them. Record which route/job owns each compatibility write and its removal gate.

A code/config switch back to the old reader is possible while old schema and dual-written data remain. That is not a schema rollback. Any committed schema/data migration rollback still uses the verified backup.

## Rollback limits and procedure

### Before commit

Each migration phase uses an immediate transaction where SQLite permits. Failure rolls back the phase and leaves its migration marker unapplied. DDL/backfill hooks must be inside the same transaction.

### After commit

There is no supported down migration. The rollback is:

1. stop all writers;
2. preserve the failed migrated database and sidecars under a new non-overwriting incident path;
3. restore the verified pre-migration backup as a complete database family;
4. run integrity, foreign-key, schema fingerprint, marker, count, and selected hash checks;
5. start the previous compatible application version;
6. reconcile/export any post-backup writes separately under an explicit recovery plan—never auto-merge them.

Restoring loses all writes after the backup cutoff. After dual-write begins, decide before maintenance whether post-cutoff data will be discarded, service will remain stopped, or an explicit forward-repair will be used. After legacy removal, application flag rollback is unavailable; backup restore plus the prior binary is the only committed-migration rollback.

## Disposable tests and rehearsal

Tests and migration rehearsals must never use the normal `DATABASE_URL` or any discovered candidate in place. Test setup must create a new temporary directory/file or `:memory:` database, inject its absolute path, and assert it differs canonically from all inventory paths. A persisted-data rehearsal starts from a separate verified copy and produces a disposable output; it never migrates the backup in place.

The audit observed that a disposable SQLite migrate and seed repeated twice succeeded with 7 days, 14 topics, 5 curriculum versions, and 324 units; integrity and foreign-key checks passed, and the backup CLI produced a non-overwriting integrity-checked copy. That is baseline evidence for idempotent current setup, not proof that the target migration or real persisted databases are safe.

### Required fixture matrix

- empty database and clean 0000 legacy database;
- representative persisted old schemas, including WAL state and partial/old migration markers;
- all legacy tables populated: sessions, answers, exercises, tests, reviews, hints, mistakes, mastery, flashcards, interviews, conversations/settings;
- malformed JSON, missing `unit_type`, missing parent, invalid/untyped IDs, cross-revision/day mismatch, duplicate active revisions/sessions, and FK violations;
- at least two Courses, multiple revisions, identical stable IDs in different revisions, personal branches, and simultaneous sessions;
- immutable snapshots before/after authored changes;
- protected answers and private/raw provider content;
- operation replay, conflicting replay, interrupted transactions, and quarantine resolution;
- alternate candidate paths and duplicate-looking but non-identical databases.

### Required assertions

- migration from each supported source version to target, rerun with no change, and deterministic hashes/IDs;
- row accounting and provenance completeness; unmatched rows quarantine without defaults or deletion;
- Course/revision/Activity composite relationship negatives and finite graph validation;
- snapshot byte/hash immutability and learner protected-answer redaction;
- Evidence append-only/idempotency and correct session/revision/Activity linkage;
- complete mastery replay inputs, including successful UTC days and repeated-error counts, before score parity is claimed;
- ReviewItem source Evidence linkage and stable due-state projection;
- dual-read parity and mismatch fail-closed behavior;
- atomic dual-write and rollback on failure at each write point;
- migration-marker consistency and transaction rollback for each DDL/backfill phase;
- source/backup health, WAL inclusion, same-file/no-overwrite refusal, and full restore comparison;
- a guard proving normal and alternate candidate database paths have unchanged file hashes/timestamps after every disposable test.

Tests must assert observable data contracts, not migration source text.

## Removal gates

Legacy routes, writes, columns, tables, adapters, and repair hooks may be removed only when all applicable gates are met:

1. every supported candidate/source schema has a tested migration path;
2. verified backups and a restore drill exist for representative persistent data;
3. row accounting is complete and every exception is resolved or owner-approved quarantine;
4. target relationship/orphan queries, snapshot/hash checks, and protected-data checks pass;
5. dual-read parity has met the documented observation window with no unexplained mismatches;
6. all production callers use explicit Course/session target APIs; no `LIMIT 1`, global default learner, or legacy route dependency remains;
7. dual-write has run through the observation window and target-only replay/export can reconstruct required state;
8. mastery replay is complete rather than derived from lossy score rows;
9. rollback cutoff, previous binary, pre-removal backup, and restore procedure are approved;
10. old tables have been placed read-only for a retention window and exported with provenance;
11. the final destructive SQLite rebuild is a new append-only migration tested on all fixtures;
12. owner approval explicitly authorizes removal.

Removal never includes deleting operator alternate database candidates or historical backup files. Retention/deletion of those files is a separate explicit user action.

## Promotion checklist

A migration run can be promoted only when its record contains:

- selected candidate and full inventory digest;
- healthy verified backup and manifest;
- application/migration/transform versions;
- pre/post schema fingerprints, markers, counts, snapshot/published hashes;
- provenance and quarantine totals by source table/reason;
- reconciliation and explicit orphan-query results;
- dual-read/write status and cutover surfaces;
- rollback cutoff and restore location;
- operator approval.

Missing evidence is a failed gate, not permission to continue with a best-effort migration.
