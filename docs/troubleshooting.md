# Troubleshooting

**Document status:** **Implemented baseline** for current local-process and loopback Compose behavior.

## Wrong Node, npm, or workspace

```powershell
node --version
npm --version
npm config get prefix
git status --short
```

Use Node 24+, npm 11+, the repository root, and the single root lockfile. Do not use pnpm, Yarn, `workspace:*`, `--legacy-peer-deps`, or a package-local install.

## Database inventory requires an explicit input

`db:inventory` rejects a command with no `--root` or `--db`.

```powershell
npm run db:inventory -- --root .data --root data --root packages/database/.data
npm run db:inventory -- --db .data/dev-learning-harness.sqlite
```

The only process-mode writable source is `.data/dev-learning-harness.sqlite`. Do not move, merge, migrate, approve, restore, or delete an alternate candidate based on path, timestamp, or apparent similarity.

## Existing database reports predecessor/no migration

A bare `npm run db:migrate` does not authorize a valuable predecessor upgrade. It bootstraps fresh data, verifies current data, or leaves an admitted predecessor unchanged. Follow [Current Database Operations](migration/current-database-operations.md) and use the exact approved backup path/hash:

```powershell
npm run db:migrate -- --authorize-current --approved-backup <path-under-.data/approved-backups> --backup-sha256 <64-lowercase-hex>
```

Do not use the historical `--authorize-m2` spelling in current operations.

## Approved backup fails

The backup command requires exactly one active `--source` and one new `.sqlite` `--destination` directly under `.data/approved-backups/`. It rejects existing destinations, alternate sources, unstable files, health/ledger failures, or incomplete private-payload inspection.

The command prints the verified path, not its hash:

```powershell
$backupHash = (Get-FileHash -LiteralPath <approved-backup-path> -Algorithm SHA256).Hash.ToLowerInvariant()
```

If authorized migration reports a wrong or changed hash, do not recalculate and continue blindly. Stop writers, inventory source and backup again, and create a new approved backup if the maintenance cutoff changed.

## Compose database has a predecessor ledger

The process-mode approved-backup/migration capability does not authorize Compose `/data/dev-learning-harness.sqlite`. Keep both services stopped and use the paired cold-volume procedure in [Self-Hosting Aptiloop](../SELF_HOSTING.md#loopback-compose-backup-and-restore). Do not copy the volume database into the process-mode active path to bypass admission.

## Ports or E2E locks are busy

Normal development uses `3000/8787`; E2E uses `3100/8887`.

```powershell
Get-NetTCPConnection -LocalPort 3000,8787,3100,8887 -ErrorAction SilentlyContinue |
  Select-Object LocalPort,State,OwningProcess
```

Stop only a verified owner process. Do not kill every Node process or delete a lock while its owner is alive. Install the browser once if needed, then run:

```powershell
npx playwright install chromium
npm run test:e2e
```

On failure, inspect `.verify/e2e-failures/<run-id>/`. E2E is intentionally serialized and has no retries.

## A lesson does not resume after reload

Confirm both services use the same database and readiness succeeds:

```powershell
Invoke-WebRequest http://127.0.0.1:8787/health/ready
```

Resume is Course-scoped and reads the persisted immutable session snapshot and accepted facts. Do not create or retarget sessions manually. A missing/current-Course mismatch, unpublished revision, invalid context, or quarantined relationship fails closed.

## Course Pack Preview disappeared

Course Pack validation is held in a bounded, expiring, process-local staging registry. Reload and Back/Forward can restore `/courses/intake/<validationId>` only while the same orchestrator process still holds that unexpired validation. Expiry, LRU eviction, or orchestrator restart requires selecting the file again. A recovery GET never commits; Commit is a one-shot atomic POST.

Expired staging is removed proactively. After bounded retries, a final `EPERM`/`EBUSY` cleanup error is suppressed, and a process crash cannot run timers; there is no startup orphan-directory sweep. These are local cleanup limitations, not permission to reuse an unknown staging directory.

## Review requires a fresh passing check

Run the check again after every workspace change. Review requires all of the following:

- a passing trusted check bound to the exact attempt/revision/check contract;
- a canonical complete-workspace SHA-256 covering allowed regular files, including Git-ignored files except explicit app-owned exclusions;
- a complete, non-truncated Git diff and its SHA-256;
- unchanged workspace snapshots before and after the evidence-only Reviewer turn.

Filesystem timestamps are not freshness authority. Reviewer never applies a patch. After `changes_requested`, edit the attempt, run a fresh check, and request a new review.

## AI is Off, unavailable, or the model is missing

Open **Settings → AI connections**. A role is ready only when its connection is enabled, connected, authenticated, the exact configured model is observed as available, and required capabilities are present. Failure never selects another provider, model, or Mock.

For a metadata-less legacy connection, use **Add managed connection** instead of trying to edit read-only diagnostics. API keys are submitted only by the explicit loopback mutation and stored connection-scoped in `.data/provider-credentials.json`; they are not returned to the browser or stored in SQLite.

Catalog presence and health metadata do not prove a model request. Use the displayed recovery action and record an external-provider smoke only after an observed authenticated request.

## Course Designer or Interview disclosure did not resume

Pending disclosure recovery is exact and server-owned. Course Designer binds Course, revision, workflow, and authoring operation. Interview binds learning session, interview, question, and operation. Unknown, expired, terminal, consumed, cancelled, ambiguous, or cross-scope disclosures fail closed.

Reload the exact URL. If the server reports no recoverable operation, retry from the preserved Draft/interview state. Do not reconstruct or store the outbound provider payload in browser storage. Approval or cancellation remains separate from applying a Course proposal, publishing, or accepting an Interview answer.

## Zed does not open

```powershell
Get-Command zed -ErrorAction SilentlyContinue
```

`ZED_EXECUTABLE` is one executable/path, not a shell string. The UI offers the server-verified attempt path as a local copy-path fallback. A host desktop editor is not automatically available inside Compose.

## Interview report does not score correctness

This is expected. Interview completion and answer form are non-technical evidence. The report does not assert technical correctness or change mastery without a separately approved typed evaluator.

## A trusted check process is stuck

The runner enforces timeout, output limits, cancellation, and process-tree cleanup. On Windows, identify the exact process before terminating it:

```powershell
Get-CimInstance Win32_Process |
  Where-Object CommandLine -Match 'vitest|normalize-profile|collection-toolkit' |
  Select-Object ProcessId,CommandLine
```

Do not terminate every `node.exe` process.
