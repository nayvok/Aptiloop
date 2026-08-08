# Core Alpha Migration Strategy

Status: **Approved Core Alpha target** for migration safety and target boundaries. Existing legacy and versioned schemas are an **Implemented baseline**. No Course/CourseRevision/Activity/Evidence/ReviewItem migration described here is claimed as implemented.

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

## Implemented baseline and known hazards

The current SQLite database contains two overlapping models.

### Legacy graph

- `topics`, `curriculum_days`, `curriculum_day_topics`, `questions`, and `exercises` describe global day content without Course/revision ownership.
- `learning_sessions`, `answer_attempts`, `exercise_attempts`, `test_runs`, `reviews`, `hints`, `mistakes`, `mastery_scores`, `mastery_evidence`, `flashcards`, `interview_sessions`, `agent_conversations`, and `agent_messages` contain learner/runtime history.
- legacy session reads can observe live seeded day/question/exercise content.

### Versioned graph

- `curricula`, `curriculum_versions`, `curriculum_weeks`, `curriculum_days_v2`, and `curriculum_units` are the closest current seams to Course, CourseRevision, and Activity;
- `session_snapshots` preserves one immutable captured graph per versioned session;
- `unit_progress`, `hint_usages_v2`, and `versioned_unit_evidence` preserve versioned progress/evidence, but several unit/question relationships are text IDs enforced only in application logic;
- `learning_sessions` still requires a legacy day and optionally references a versioned day;
- global active-session and `learner_state(id='default')` assumptions remain single-course compatibility constraints.

Migration 0001 already preserves a legacy revision and snapshots, but it also abandons all but the newest globally active session. TypeScript compatibility hooks can rebuild `unit_progress`, infer missing types as `study`, and normalize malformed progress/snapshots. These operations are transaction-protected in flight but have no down migration after commit. This strategy must not repeat silent semantic defaults.

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

## Stage 0 — candidate database inventory

Inventory is read-only and precedes selection or backup.

### Candidate sources

At minimum inspect, when present:

1. `DATABASE_URL`, resolved relative to `DATABASE_PROJECT_ROOT`/repository root and with a leading `file:` handled explicitly;
2. `.data/dev-learning-harness.sqlite`;
3. `data/dev-learning-harness.sqlite`;
4. historical workspace-relative candidates such as `packages/database/.data/dev-learning-harness.sqlite`;
5. any operator-supplied path from an earlier installation.

Treat each `.sqlite` plus its `-wal` and `-shm` sidecars as one candidate family. A 4 KiB main file with a populated WAL can contain current data; file size alone is not authority.

The current backup helper discovers the configured path plus repository `.data` and `data`. The broader historical-workspace search and operator confirmation are target requirements, not current automatic behavior.

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
4. use SQLite `VACUUM INTO` or an equivalently consistent SQLite backup API so committed WAL state is included;
5. refuse an existing destination and never overwrite an earlier backup;
6. open the backup read-only and require the same health checks;
7. compare schema fingerprint, table counts, migration markers, snapshots, and selected canonical hashes;
8. write a backup manifest containing source/backup identity, hashes, counts, tool/app version, timestamp, and verification result.

The existing `createDatabaseBackup` primitive implements the strong source/destination health, same-file, no-overwrite, and `VACUUM INTO` controls. The migration CLI does not currently require it; making preflight backup mandatory is target work.

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

| Source | Target | Rule |
| --- | --- | --- |
| `curricula` | `Course` | Deterministic ID from source ID; preserve slug/title/description and record source row hash. |
| `curriculum_versions` | `CourseRevision` | Preserve revision, status, parent, content hash, and timestamps; reject/quarantine cross-course parents or duplicate revision conflicts. |
| `curriculum_weeks`, `curriculum_days_v2` | Revision graph/group metadata | Preserve stable IDs, order, titles, and source JSON; do not flatten away provenance. |
| `curriculum_units` | `Activity` | Preserve stable ID/type/order/payload and exact revision membership; validate finite graph and protected fields. |
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

The audit observed that a disposable SQLite migrate and seed repeated twice succeeded with 7 days and 14 topics. That is baseline evidence for idempotent current setup, not proof that the target migration or real persisted databases are safe.

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
