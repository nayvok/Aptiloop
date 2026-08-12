# Local Data Portability

**Document status:** **Implemented baseline** for an explicit, local-only export and create-only offline restore of one Aptiloop profile. Cloud sync, account transfer, automatic merge, and multi-user portability are **Future**.

Aptiloop can move learning data from one computer to another through one versioned `.aptiloop-data` bundle. The workflow never overwrites or merges an existing active database.

## What the bundle contains

The bundle contains a sanitized SQLite snapshot that is rebuilt into a separate compact database and then integrity-checked. The exported payload has no SQLite freelist pages or WAL/SHM/journal sidecars. It includes:

- Courses, revisions, authored content, and personal adaptations;
- learning sessions, deterministic facts, evidence, mastery, mistakes, and review state;
- learner answers, AI-assisted transcripts, and completed provider provenance;
- application preferences and configured provider/model metadata.

The bundle is private plaintext learner data. Store and transfer it with the same care as the active `.data` directory.

## What the bundle excludes

The bundle explicitly excludes or clears:

- `.data/provider-credentials.json`, API keys, OAuth credentials, and other credential-store material;
- `.env` files and process environment configuration;
- exercise workspace files, isolated attempt directories, Git repositories, and editor/runtime executables;
- absolute device paths in exercise attempts and application settings;
- opaque provider session identifiers, pending provider disclosures, and unfinished provider turns;
- raw provider tool/event/review payloads and provider-turn metadata;
- provider auto-reconnect state; restored connections remain recognizable but disabled until explicitly reconnected;
- unrecognized application settings and opaque legacy provider option payloads.

Configured provider names, model IDs, and other non-secret Provider Hub metadata remain so the user can recognize prior choices. Credentials must be added again on the destination computer. Completed transcripts and learner evidence remain because they are part of the named learning-history payload.

## Export on the source computer

Keep Aptiloop running or stopped. Export uses SQLite's online backup mechanism and fails if the active source changes during validation.

```powershell
npm run data:export
```

The default destination is a new timestamped file under `.data/portable-exports/`. To choose a unique filename in that directory:

```powershell
npm run data:export -- --destination .data/portable-exports/my-transfer.aptiloop-data
```

The command refuses an existing destination, linked paths, unhealthy SQLite data, a stale/unknown migration contract, or a source outside the one active process-mode database. It fails closed if any absolute device path remains in a path field or nested path-bearing JSON value after the approved normalization steps.

Copy the resulting `.aptiloop-data` file to the destination computer using a transport you trust. SHA-256 and logical/schema digests detect corruption and inconsistent edits; they do not authenticate who created the bundle. A bundle is private plaintext, so use an authenticated and confidential transport when provenance matters.

## Restore on the destination computer

Restore is deliberately offline and create-only.

1. Install or clone the same Aptiloop revision and run `npm install`.
2. Stop Aptiloop and every process that could write `.data`.
3. Confirm `.data/dev-learning-harness.sqlite` and its `-wal`, `-shm`, and `-journal` sidecars do not exist. Preserve an existing `.data` directory under a new name; do not delete valuable data to make restore pass.
4. Run:

```powershell
npm run data:restore -- --source C:\path\to\my-transfer.aptiloop-data
```

5. Start Aptiloop, inspect the Courses and learning history, then reconnect any external providers and recreate any exercise workspace files required for future practice.

Restore validates the exact app-owned portability policy, strict manifest, byte count, SHA-256, current migration ledger/schema, logical database digest, SQLite integrity, foreign keys, zero freelist, standalone journal mode, and the sanitized database postconditions before and after creating `.data/dev-learning-harness.sqlite`. It never migrates, merges, or replaces an existing active database. The app must remain stopped for the entire restore; the create-only check prevents overwrite but is not a cross-process writer lock.

## Limits and recovery

- A bundle is accepted only by an application with the exact same database contract. Upgrade the source application first or use the matching application revision; restore never performs a hidden migration.
- Exercise evidence stored in SQLite is retained, but excluded workspace files are not reconstructed. An old exercise attempt may therefore show unavailable workspace state on the new computer.
- Browser-only theme/locale state may need to be selected again because browser storage is not part of the server-owned profile.
- If restore is rejected, keep both the original bundle and destination data unchanged, inspect the reported gate, and do not edit bundle bytes or SQLite tables directly.
- Whole-file migration recovery for an already valuable active database remains the separate maintenance procedure in [Current Database Operations](migration/current-database-operations.md).
