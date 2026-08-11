# Current Database Operations

**Document status:** **Implemented baseline** for the current process-mode SQLite inventory, approved-backup, authorized forward migration, and whole-file recovery boundary. Public or multi-user database operation remains **Future**.

This is the only current runbook for a valuable Aptiloop process-mode database. Historical M2/M11 runbooks preserve their original cutoffs but are not executable current instructions.

## Authority and fixed paths

- Run every command from the repository root.
- The only writable process-mode database is `.data/dev-learning-harness.sqlite`.
- New approved backups must be new `.sqlite` files directly under `.data/approved-backups/`.
- Alternate database families, old backups, copied candidates, symlinks, and “newest file” selection are not authorized sources.
- Stop the web app, orchestrator, and every writable database command before the maintenance window.
- A valuable predecessor database may advance only through `--authorize-current` with the exact approved backup path and its whole-file SHA-256.
- A bare `npm run db:migrate` is suitable only for a fresh/disposable database or an exact current database. It is not authorization to upgrade valuable predecessor data.

## 1. Inventory without mutation

Inventory explicit roots, then the exact active source:

```powershell
npm run db:inventory -- --root .data --root data --root packages/database/.data
npm run db:inventory -- --db .data/dev-learning-harness.sqlite
```

Stop if the active source is missing or unstable, SQLite integrity is not `ok`, foreign-key checks fail, the migration ledger/schema is not an admitted predecessor or the exact current contract, required private-payload tables cannot be inspected, or active-session/provenance accounting is inconsistent. Inventory reports metadata and aggregate counts; it must not print learner content or credentials.

## 2. Rehearse on disposable data

Run the database migration and recovery tests before touching the active file:

```powershell
npm test --workspace=@aptiloop/database -- --run test/m2-migration-safety.test.ts test/m2-acceptance-hardening.test.ts test/course-foundation.integration.test.ts test/course-foundation-backfill.integration.test.ts test/approved-backup.test.ts
```

A disposable rehearsal does not authorize the active source.

## 3. Create and bind a new approved backup

Choose a unique destination, create the online SQLite backup, and calculate its whole-file hash:

```powershell
$stamp = [DateTime]::UtcNow.ToString("yyyy-MM-ddTHH-mm-ssZ")
$backup = ".data/approved-backups/$stamp-pre-current.sqlite"

npm run db:backup -- --source .data/dev-learning-harness.sqlite --destination $backup

$backupHash = (Get-FileHash -LiteralPath $backup -Algorithm SHA256).Hash.ToLowerInvariant()
$backupHash

npm run db:inventory -- --db .data/dev-learning-harness.sqlite --db $backup
```

Record the source path, backup path, `$backupHash`, source and backup identities, migration contracts, logical digest comparison, integrity result, foreign-key result, and maintenance cutoff. The backup command refuses overwrite and does not print the SHA-256 for you; compute it from the completed file as shown.

## 4. Apply the authorized forward migration

Use all three authorization arguments together:

```powershell
npm run db:migrate -- --authorize-current --approved-backup $backup --backup-sha256 $backupHash
```

The migration command revalidates source and backup identity, the supplied whole-file hash, logical lineage, admitted schema/ledger, SQLite health, private-payload gates, and recovery-copy safety immediately before the write. It applies forward-only migrations transactionally and verifies the exact current contract before success. Any mismatch fails closed; do not bypass the command with direct SQL or the compatibility alias `--authorize-m2`.

## 5. Verify and prove replay safety

```powershell
npm run db:inventory -- --db .data/dev-learning-harness.sqlite --db $backup
npm run db:migrate -- --authorize-current --approved-backup $backup --backup-sha256 $backupHash
```

The second migration command must report that the database is already current and perform no migration. Then run the relevant repository gates:

```powershell
npm run format:check
npm run lint
npm run typecheck
npm run test:fast
npm run build
npm run test:e2e
```

`npm run verify` does not run E2E. Do not report E2E green unless `npm run test:e2e` passes separately.

Run `npm run db:seed` only when the intended development fixture is required. Seed is not part of migration authorization and must not mutate published content in place.

## Whole-file recovery

There is no supported down migration. Recovery after a committed migration returns the entire database to an approved backup cutoff and loses later writes.

1. Obtain explicit owner approval and stop every writer.
2. Inventory the selected approved backup and verify its recorded whole-file SHA-256, integrity, foreign keys, schema/ledger, provenance, and absence of sidecars.
3. Preserve the failed active database family, including WAL/SHM when present, under a new non-overwriting incident location. Do not delete or merge it.
4. Restore the approved standalone backup as a whole database file into a newly reserved active location; never merge pages, tables, WAL, or SHM files.
5. Inventory the restored active file and compare it with the recorded cutoff.
6. Start only a binary that admits that cutoff. To return to the current contract, create a new approved backup of the restored active source and repeat the authorized procedure above.

Recovery of valuable data is a maintenance decision, not an automatic startup action.

## Compose-specific boundary

The process-mode authorization above is fixed to the repository `.data` source and does not authorize `/data/dev-learning-harness.sqlite` inside Compose. Compose backup and restore remain a cold, paired snapshot of the `harness-data` and `harness-attempts` volumes. Follow [Self-Hosting Aptiloop](../../SELF_HOSTING.md#loopback-compose-backup-and-restore).

If a Compose database has a predecessor ledger, keep the services stopped and fail closed until a dedicated owner-approved migration path verifies the stopped volume snapshot. Do not copy it into the process-mode active path merely to bypass source admission.

## Stop conditions

Stop without mutation when any source/backup path, identity, or hash changes; a destination exists; a schema/ledger is a near miss; integrity or foreign keys fail; private-payload inspection is incomplete; source and backup diverge logically; provenance/session/orphan accounting fails; the recovery copy cannot be verified or cleaned safely; or another writer may be active.

SQLite, WAL, backups, attempts, and the local credential file are plaintext local data. Integrity verification does not provide confidentiality or secure deletion.
