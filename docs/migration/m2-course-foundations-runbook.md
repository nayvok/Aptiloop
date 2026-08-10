# M2 Course Foundations Migration and Recovery Runbook

**Document status:** The active migration record below is an **Implemented baseline** observed locally on 2026-08-09. The procedure is the required boundary for any future M2 migration/replay. Destructive legacy removal is not authorized.

## Scope and safety properties

M2 applies forward-only migrations:

- `0006_course_foundations` — target Course/revision/activity/source/capsule/adaptation/session-context/evidence/review tables, composite ownership, immutability, and append-only guards;
- `0007_quarantined_course_compatibility` — exact quarantine-based compatibility for migrated versioned session snapshots/evidence;
- `0008_m2_acceptance_corrections` — preserved parent lineage, immutable correction-backup provenance, legacy publish guards, and closed session/Activity compatibility authority;
- `0009_m2_acceptance_hardening` — immutable accepted revision metadata, source parent scope, strict snapshot-envelope identity, complete ownership guards, and immutable `m2-v3` run provenance;
- `0010_m2_quarantine_immutability` — update/delete guards for every quarantined source revision used as compatibility evidence plus immutable `m2-v4` backup binding.

The operation preserves source tables, source rows, `session_snapshots.snapshot_json`, and stored snapshot hashes. Ambiguous relationships are quarantined; they are never guessed, coerced, or promoted to Course truth. There is no down migration.

The migration CLI is authorized only for the fixed active path `.data/dev-learning-harness.sqlite`. A disposable database is owned by the test harness. The command never scans for a convenient backup and never selects a quarantined historical candidate.

## Completed active migration record

| Evidence                                  | Observed value                                                                             |
| ----------------------------------------- | ------------------------------------------------------------------------------------------ |
| Active source                             | `.data/dev-learning-harness.sqlite`                                                        |
| Initial pre-M2 backup                     | `.data/approved-backups/2026-08-09T15-00-16Z-pre-m2-active.sqlite`                         |
| Initial backup whole-file SHA-256         | `501338c295589d8367a31a1082ef7469ca0e22bb91e6a3123abdb94b70220f1b`                         |
| Initial backup logical SHA-256            | `932156a35a15e48e7f84067967982b4c55268b4e55c47ff07d657ddcb14f8a8e`                         |
| Initial backup path hash                  | `cd20125e72b027d54f3a856034bc0f12dbec34101af11a151b8178ecf3a0ec28`                         |
| Pre-`0008` correction backup              | `.data/approved-backups/2026-08-09T16-19-35Z-pre-m2-correction-active.sqlite`              |
| Correction backup whole-file SHA-256      | `a09332dde7732b43b2ca6b9734bd5201fc6d71449c7c3d7303824d845418af09`                         |
| Correction backup logical SHA-256         | `cbcfaec1f5796bd2fa90d67a9e71b7177b86d0c2c0247ac513cc71de8583edd7`                         |
| Correction backup path hash               | `54e936806353d750ed25398a2da909f1024a17c22860c40b20fdf897535b08b8`                         |
| Pre-`0009` hardening backup               | `.data/approved-backups/2026-08-09T22-54-00Z-pre-m2-hardening-active.sqlite`               |
| Hardening backup whole-file SHA-256       | `9dc4b6af0c5e5a9b73cfa3e4f38240703d023f37ada6c3e0fa297dbe4aa22da2`                         |
| Hardening backup logical SHA-256          | `3d79e6eb7b6a03aca6126e20be758e87dd37af8268c131df68ab021eca10e1f3`                         |
| Hardening backup path hash                | `c78f1de263d762115e9a72190d7b44d8d9ad27e3189ba8e1b6385db22717622a`                         |
| Pre-`0010` quarantine-immutability backup | `.data/approved-backups/2026-08-09T23-34-00Z-pre-m2-quarantine-immutability-active.sqlite` |
| Quarantine backup whole-file SHA-256      | `bc325e8314117a3eb073ae015a5daf72ec3b4ea3f7f74aadfbfbe34a25c57f4d`                         |
| Quarantine backup logical SHA-256         | `9b7b2f7171d3c61ace83dc99754927539fdc7f34efb5ceec13092cdbb2c7b8b0`                         |
| Quarantine backup path hash               | `315902bfd7495b5b6103b38eb8898ae208613a42b106e57e14353f79716469be`                         |
| Pre-M2 schema SHA-256                     | `828f6e9accaa02ee3d274ec67fc5f58a32f69084855d698e13ad6ae5f331371c`                         |
| Pre-`0008` schema SHA-256                 | `e4084e674f5dcf437b134e7c1415f366735dd4350d6076aff3c1300b879a6ffd`                         |
| Pre-`0009` schema SHA-256                 | `4ded6a016d789d4cddd58f8e7cbc5493abf4b8deefd9ffde9118704c57f1b8d0`                         |
| Pre-`0010` schema SHA-256                 | `01002fb9a918c214c25a9d89c2f825796a052c3eb954f7229d888af0de95726c`                         |
| Final schema SHA-256                      | `a6a1543e468e3dbb90494bc6e5d5598933e22dd0cf49a9830f82ee695eda5a01`                         |
| Ledgers                                   | `0000`–`0005` → `0000`–`0007` → `0000`–`0008` → `0000`–`0009` → `0000`–`0010`              |
| Snapshot JSON bytes                       | `30859` at every cutoff                                                                    |
| Snapshot-bytes inventory SHA-256          | `fcb536c34615784ad3d5f97493370f43cb4f34eb79163059e61181683433bd1e` at every cutoff         |
| Content-hash inventory SHA-256            | `50112c9439c3ef3e29417fd865ba809811a76c5a95b2c90274125c9dd6afcbc1` at every cutoff         |
| Reconciliation                            | `572 = 2 mapped + 526 quarantined + 44 intentionally-unmapped`                             |

Final inventory observed `integrity_check=ok`, zero foreign-key violations, all 17 target tables compatible, zero target orphans, zero invalid provenance statuses, zero unaccounted active sessions, zero session snapshot mismatches, and zero M2 private-payload bytes. The two active sessions lack target contexts but are both covered by exact `m2-v1` revision/lesson/snapshot quarantine provenance. The immutable migration ledger has exactly one run for each of `m2-v1`, `m2-v2`, `m2-v3`, and `m2-v4`; every active-stage source digest, approved-backup logical digest, file SHA-256, and path hash matches the corresponding recorded cutoff. Authorized replay of the final backup reported a verified no-op and did not append a fifth run.

All four approved backups have no WAL, SHM, or rollback-journal sidecar and remain unchanged at their respective cutoffs. None is the current active file. They are rollback points only for pre-M2, pre-`0008`, pre-`0009`, and pre-`0010` respectively.

## Required procedure

### 1. Quiesce and identify

1. Stop the Aptiloop web/orchestrator and every writable database CLI.
2. Confirm the intended source is exactly `.data/dev-learning-harness.sqlite`.
3. Do not use a historical backup, quarantined family, copied database, symlink/reparse alias, or path discovered by scanning.
4. Record the maintenance cutoff. Every write after the backup cutoff is outside rollback.

### 2. Read-only inventory

Run the broad inventory first, then the explicit active-source inventory:

```sh
npm run db:inventory
npm run db:inventory -- --db .data/dev-learning-harness.sqlite
```

The active candidate must be stable and opened, with `integrity_check=ok`, zero foreign-key violations, an exact admitted ledger/schema, coherent active sessions, and every required private-payload table inspected. A missing/partial table, stale/extra migration row, invalid JSON/count, unstable identity, or unaccounted session is a stop condition.

Inventory is read-only. It does not authorize migration.

### 3. Prove the migration on disposable data

Run the database migration contract suite before touching the active file:

```sh
npm test --workspace=@dlh/database -- --run test/m2-migration-safety.test.ts test/m2-acceptance-hardening.test.ts test/course-foundation.integration.test.ts test/course-foundation-backfill.integration.test.ts test/approved-backup.test.ts
```

The suite must prove fresh bootstrap, representative legacy reconciliation, byte/hash preservation, exact replay no-op, wrong/missing/stale backup rejection, malformed/partial ledger/schema rejection, rollback-copy verification, unknown types, cross-scope ownership rejection, immutable published/history rows, append-only evidence, and trigger-backed rejection paths.

A passing disposable rehearsal is necessary but does not authorize the valuable source.

### 4. Create a new active-source-only backup

Choose a new filename. Never overwrite an existing artifact:

```sh
npm run db:backup -- --source .data/dev-learning-harness.sqlite --destination .data/approved-backups/<new-pre-migration-name>.sqlite
```

Record the printed whole-file SHA-256. The backup command repeats the read-only health/private-payload checks, uses `node:sqlite` online `backup()`, verifies logical source/copy equality, and refuses overwrite. Verify both files explicitly:

```sh
npm run db:inventory -- --db .data/dev-learning-harness.sqlite --db .data/approved-backups/<new-pre-migration-name>.sqlite
```

Required evidence:

- exact source and destination paths and distinct file identities;
- stable source identity;
- backup file SHA-256 and logical SHA-256;
- source/backup logical equality;
- integrity, foreign keys, exact migration ledger, and schema contract;
- coherent active sessions;
- complete private-payload inventory;
- unchanged snapshot byte/hash inventories.

### 5. Authorize and apply once

Pass the exact backup path and exact recorded file hash:

```sh
npm run db:migrate -- --authorize-m2 --approved-backup .data/approved-backups/<new-pre-migration-name>.sqlite --backup-sha256 <64-lowercase-hex>
```

The boundary must, immediately before writing:

1. reserve the authoritative active artifact;
2. recheck stable source and backup identities;
3. prove source/backup logical lineage and supplied whole-file hash;
4. recheck the admitted predecessor ledger/schema, integrity, foreign keys, sessions, and private payloads;
5. create and verify an owned whole-file recovery copy in the approved backup directory, then remove it safely;
6. enter `BEGIN IMMEDIATE` and recheck source identity/contract;
7. apply every missing migration through `0010`, perform deterministic backfill/corrections, and close or preserve the provenance manifest as applicable;
8. verify the exact `0000`–`0010` schema, integrity, foreign keys, target orphans, manifest arithmetic, every applied run's backup binding, session accounting, immutable quarantine evidence, and immutable snapshot inventories before commit.

Any mismatch rolls back the transaction and leaves the source contract unchanged. Do not bypass the CLI with direct SQL.

### 6. Verify migration and replay

Run explicit active/backup inventory again and save its JSON evidence:

```sh
npm run db:inventory -- --db .data/dev-learning-harness.sqlite --db .data/approved-backups/<approved-name>.sqlite
```

Then repeat the same authorized migration command. Expected result: a verified no-op with `applied=[]`, `alreadyApplied=[0000…0010]`, `m2Authorized=true`, and `m2Noop=true`. Replay must not append another migration run or change source facts.

### 7. Runtime smoke and gates

Start the stack only after post-migration inventory passes:

```sh
npm start
```

Observe:

- `GET /health/ready` returns ready/connected;
- the learner path is returned from a Course-owned revision;
- an existing retained session resumes only through exact compatibility provenance;
- no browser console/page errors occur on the exercised path.

Run the repository gates from the root:

```sh
npm run format:check
npm run lint
npm run typecheck
npm run test:fast
npm run build
npm run test:e2e
```

`npm run verify` may be used for the first five except E2E; it never counts as E2E evidence.

**Observed 2026-08-09:** the post-`0010` orchestrator returned ready/connected health on `127.0.0.1:8787`; the web application used the owner-approved alternate port `3002` because port `3000` was occupied. Browser smoke rendered the Course-owned learner path and resumed a retained active session without observed console or page errors. Focused publication/projection and prerequisite runtime suites passed 24/24 tests (11 database and 13 orchestrator). After all independent-review blockers were remediated, the final `npm run verify` passed formatting, 12/12 lint tasks, 12/12 typecheck tasks, 21/21 fast-test tasks with 614 tests passed and 3 skipped, and 12/12 builds; `npm run test:e2e` passed 4/4. Independent correctness and security/data-migration re-reviews returned PASS with no remaining M2 blocker. Final explicit active/backup inventory reconfirmed stable identities, active migrations `0000`–`0010`, schema SHA-256 `a6a1543e468e3dbb90494bc6e5d5598933e22dd0cf49a9830f82ee695eda5a01`, `integrity_check=ok`, zero foreign-key violations, zero target orphans, zero unaccounted active sessions, zero target private-payload bytes, and the exact `m2-v4` binding to the pre-`0010` backup. No hosted GitHub Actions result or external-provider smoke is implied.

## Whole-file recovery

Recovery is a rollback to one selected approved-backup cutoff, not a down migration. It discards every later write from the authoritative state. The initial backup restores `0000`–`0005` before all M2 data migration; the correction backup restores `0000`–`0007` before `0008`; the hardening backup restores `0000`–`0008` before `0009`; and the quarantine-immutability backup restores `0000`–`0009` before `0010`.

1. Stop every writer and verify no Aptiloop process holds the active database.
2. Select exactly one recorded approved backup. Verify its path, SHA-256, `integrity_check`, foreign keys, exact ledger/schema, session coherence, snapshot inventories, private-payload inventory, and absence of sidecars.
3. Preserve the current active database family, including any WAL/SHM state, under a newly named quarantine/recovery location; do not overwrite or delete it.
4. Copy the selected approved backup as a whole standalone file to a newly reserved `.data/dev-learning-harness.sqlite`. Do not copy a WAL/SHM/journal sidecar and do not merge pages or tables.
5. Re-run explicit active inventory and compare it with the selected backup's recorded cutoff evidence.
6. The current M2 binary intentionally rejects every predecessor ledger at ordinary startup. Start only the exact previous binary/worktree that admits the selected cutoff, or keep all application writers stopped.
7. To return to current `0000`–`0010`, create a new non-overwriting approved backup of the restored active source, stop the prior binary, and run the explicit authorized migration with that new path/hash. Do not restore or merge the quarantined post-cutoff file.

The automated migration preflight rehearses backup verification and whole-file recovery with a uniquely owned temporary artifact before active mutation. Manual recovery remains consequential because it changes the authoritative cutoff; obtain owner approval at the point of recovery.

## Fail-closed conditions

Stop without mutation for any of the following:

- source or backup path/identity/hash changes;
- backup overwrite or unapproved backup directory;
- predecessor or current schema/ledger near miss;
- integrity or foreign-key failure;
- incomplete private-payload inspection;
- source/backup logical mismatch;
- snapshot JSON/hash mismatch;
- incomplete reconciliation arithmetic or invalid provenance status;
- target orphan, missing target ownership, or unknown registry type;
- unaccounted active session context;
- unsafe recovery-artifact cleanup;
- concurrent writer or failed transaction verification.

Do not repair, delete, coerce, or silently reclassify the candidate. Preserve it for explicit reconciliation.

## Remaining limitations

- 526 migration rows are unresolved quarantine, not target Course content.
- The backups and database are local plaintext artifacts; this runbook does not prove historical byte erasure.
- Legacy tables and a global-current compatibility adapter remain.
- All four approved backups are valuable rollback data and are not automatically rotated or deleted.
- No hosted GitHub Actions result or external-provider smoke is implied by this local record.
