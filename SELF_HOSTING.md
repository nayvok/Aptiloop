# Self-Hosting Aptiloop

Status: **Future** for authenticated public/LAN self-hosting. The committed Docker Compose setup is an **Implemented baseline** for loopback-only local use.

> **Do not expose the current web or orchestrator ports to a LAN, the Internet, a tunnel, or a public reverse proxy.** The current application has no user authentication or authorization. `Origin`, JSON content type, and `X-DLH-Client` checks are not authentication.

See [Deployment Models](docs/architecture/deployment-models.md) for the normative topology and promotion gates.

## What is supported today

Aptiloop Core Alpha is local-first and single-user. Two local forms exist in the repository:

- local Node processes, where direct mode accepts only `127.0.0.1`, `::1`, or `localhost` and the orchestrator defaults to `127.0.0.1:8787`;
- the committed two-service Compose topology, with host publication restricted to `127.0.0.1:3000` and `127.0.0.1:8787`.

Compose runs the web and orchestrator as non-root container users, waits for local health checks, stores SQLite data and attempt data in named volumes, and bind-mounts repository-controlled exercise templates. Only explicit `ORCHESTRATOR_BIND_MODE=container-loopback-published` permits the orchestrator to listen on `0.0.0.0` inside its private container network; host mappings remain `127.0.0.1:3000` and `127.0.0.1:8787`.

This is **local packaging, not authenticated public self-hosting**. Do not change `127.0.0.1` port publication to `0.0.0.0`, publish it through a router/tunnel, or place a public proxy in front of it.

## Current local data boundaries

Default process-mode locations are:

| Data                              | Default                             |
| --------------------------------- | ----------------------------------- |
| Active SQLite database            | `.data/dev-learning-harness.sqlite` |
| New approved backup directory     | `.data/approved-backups`            |
| Quarantined historical backups    | `.data/backups`                     |
| Trusted exercise templates        | `workspaces/exercises`              |
| Learner attempt workspaces        | `.data/exercise-attempts`           |
| External provider learning access | Blocked in M1                       |

Compose stores the database in `harness-data` and attempt workspaces in `harness-attempts`. These volumes are private runtime data and are not source fixtures. They can contain answers, transcripts, mastery, mistakes, diffs, test output, provider/model metadata, and local paths.

Private data is never uploaded or shared without an explicit user action naming destination and scope. Course Packs, exports, logs, process environments, and model prompts must not carry credentials. External providers are optional and resolved only by the server-owned Provider Hub; an unavailable provider remains an explicit failure and never becomes Mock. Mock is limited to tests, CI, and development. Any Course, source, learner evidence, transcript, workspace, or profile disclosure to a provider requires the recorded destination-specific decision defined by the M6 policy.

## Backup before migration or upgrade

Before changing an installation that has data:

1. stop or quiesce application writers;
2. inventory every explicit root/candidate without merging, deleting, selecting newest, or opening a candidate for write;
3. use only `.data/dev-learning-harness.sqlite` as the owner-approved active source; runtime and writable CLIs reject every alternate candidate before opening;
4. create one new non-overwriting copy under `.data/approved-backups/` only after the active read-only preflight passes;
5. require integrity `ok`, zero foreign-key violations, the exact migration ledger, complete `agent_messages`/`reviews` schemas, zero logical raw/tool/review payload rows, and stable source hashes around inspection;
6. retain the inventory and backup record, then rehearse migration on a disposable copy rather than the active file.

```sh
npm run db:inventory -- --root .data --root data --root packages/database/.data
npm run db:inventory -- --db .data/dev-learning-harness.sqlite
npm run db:backup -- --source .data/dev-learning-harness.sqlite --destination .data/approved-backups/pre-migration-2026-08-08T120000Z.sqlite
```

Choose a new destination filename for every backup. The inventory fingerprints main/WAL/SHM files and inspects a disposable family copy, so committed WAL-visible rows are counted without checkpointing or mutating the source. It reports only health, migration IDs, sizes/hashes, and aggregate tool/raw counts—never learner content or secret values.

**Approved 2026-08-08 disposition:** the other five candidate families and all eleven existing backups are preserved unchanged and quarantined from runtime, restore, and approved-backup use until M2 reconciliation. `.data/m0-baseline/` is protected unchanged. No M1 cleanup migration exists because the observed logical non-empty tool/raw count is zero; absence of bytes in free pages, WAL, SHM, snapshots, or external copies is not proven.

The approved backup command repeats the preflight, uses the Node `node:sqlite` online `backup()` API, includes committed WAL state in the logical backup, rejects every other source and destinations outside `.data/approved-backups/`, refuses overwrite, binds the produced logical digest to the approved source snapshot, and health-checks the source and copy. Existing `.data/backups/` files are not approved restore points.

A failed in-flight future migration is transaction-rolled back. After a migration commits, Aptiloop has no supported down migration: restore the whole database from the explicitly approved pre-migration backup while writers are stopped, preserve the failed database separately, and repeat integrity, foreign-key, migration-marker, and private-payload checks. The restore loses writes after the maintenance cutoff.

### Loopback Compose backup and restore

Compose recovery is a cold, paired snapshot of `harness-data` and `harness-attempts`. Stop both services before copying either volume. Never copy a live SQLite main file without its WAL family, never overwrite a prior backup, and never restore into the active volume. The default Docker volume names are `dev-learning-harness_harness-data` and `dev-learning-harness_harness-attempts`.

1. Run `docker compose stop` and confirm `docker compose ps --status running` returns no services.
2. Create a new timestamped directory under `.data/approved-backups/compose/`. Mount that absolute host directory into a one-shot local helper container.
3. Copy `/data/dev-learning-harness.sqlite` from the read-only data volume with exclusive-create semantics. The stopped volume must contain only the main database, not `-wal` or `-shm` sidecars.
4. Archive the read-only attempts volume in the same timestamped directory. Treat the database file and attempts archive as one recovery point.
5. Run `npm run db:inventory -- --db <absolute-database-backup-path>`, require integrity `ok`, zero foreign-key violations, and the exact current migration ledger, then record SHA-256 digests for both files. Restart with `docker compose start` only after verification.

Restore is rehearsed without replacing the active volumes:

1. Keep the original volumes unchanged. Create new uniquely named data and attempts volumes.
2. Copy the chosen verified database into the empty data volume as `/data/dev-learning-harness.sqlite`; extract only its paired attempts archive into the empty attempts volume.
3. Launch the candidate with `APTILOOP_DATA_VOLUME=<new-data-volume>` and `APTILOOP_ATTEMPTS_VOLUME=<new-attempts-volume>` set for `docker compose up`. Compose defaults to the original volume names when those variables are absent.
4. Require both health checks, repeat the database inventory, and exercise the named learner state before accepting the restored pair.
5. To roll back the drill, stop the candidate and relaunch without the two overrides. Do not delete either volume until the owner approves retention and reconciliation.

The 2026-08-10 M12 rehearsal followed this non-overwriting path on disposable volumes: the quiesced source and copied database were byte-identical, `PRAGMA integrity_check` returned `ok`, `PRAGMA foreign_key_check` returned zero rows, all 19 migrations were present, and the restored copy had the same SHA-256 digest. This proves the database-volume procedure used in that rehearsal; it does not approve public/LAN deployment or replace a restore drill on each release candidate and operator platform.

See [Core Alpha Migration Strategy](docs/migration/core-alpha-migration-strategy.md) for candidate inventory, dual-read/write, quarantine, and removal gates.

The observed candidate inventory and exact disposition are recorded in [M1 Safety-Boundary and Private-Data Inventory](docs/audits/2026-08-08-m1-safety-boundary-inventory.md).

The current exercise path copies a trusted repository template into an attempt workspace and accepts only the app-owned browser command ID `test`, with an outer `shell: false` runner, sanitized environment, timeout, output cap, cancellation, and process-tree cleanup. Review is bound to a fingerprint of the Git-visible patch and denies writes; Git-ignored workspace state is not covered. The internal plan invokes `npm test`; learner-modifiable package scripts and npm lifecycle behavior remain trusted-code authority.

It is therefore **native, unsandboxed, trusted-only execution**. The process has the authority of the orchestrator/container user within its reachable environment, and current execution does not enforce network denial or host resource quotas. Path containment and a browser command allowlist are not a hostile-code sandbox.

Consequences:

- run only repository-controlled trusted templates;
- do not connect imported Course Pack files to the native runner;
- do not add commands, scripts, executable arguments, environment values, plugins, secrets, or host paths to Course Packs;
- do not treat a container alone as sufficient isolation;
- do not use this backend for remote or mutually untrusted users.

The generic trusted-ID contract is specified in [Execution Fabric](docs/architecture/execution-fabric.md), and runtime ownership is specified in [Environment Packs](docs/architecture/environment-packs.md).

## External editors in local/Compose operation

Zed launch is an implemented local-process convenience. Aptiloop chooses the canonical attempt path and launches the configured executable without a shell; failure returns a copy-path fallback.

A host desktop editor is not automatically reachable from an orchestrator container. Operators must not work around that difference by accepting a Course Pack editor command or arbitrary path. Embedded editing is an approved target; remote editing is future and requires authentication, capability-scoped workspaces, encrypted transfer, explicit consent, and conflict handling without auto-merge. See [Workspaces and Editors](docs/architecture/workspaces-and-editors.md).

## What public self-hosting requires

Public/LAN support remains **Future** until one exact deployment profile implements and tests all of these boundaries:

### Identity and application security

- authentication, secure sessions, logout/revocation, and authorization on every read/mutation;
- learner/author/publisher/operator separation, including protected-answer isolation;
- TLS, secure cookies, CSRF, allowed-host/origin and trusted-proxy rules;
- request/body limits, rate limits, audit events, and fail-closed unsafe configuration;
- no reliance on browser-selectable headers as identity.

### Database and operations

- one explicit database, encrypted database transport where applicable, secret management, storage quotas, and maintenance mode;
- verified backups, restore drills, retention, monitoring, and recovery objectives;
- repository-level SQLite/PostgreSQL boundaries; no shared SQLite file on a network filesystem;
- fully scoped user/course/session relationships before any multi-user claim;
- additive migration and legacy-data retention gates.

### Isolated execution

- a dedicated server Execution Fabric backend rather than the local trusted-native runner;
- per-run sandbox, read-only base, ephemeral writable workspace, no host mounts/socket/credentials, and process/resource/output/storage quotas;
- **deny network by default**, tested across DNS, IPv4/IPv6, loopback, link-local, metadata-service, and proxy paths;
- app-owned immutable Environment Packs and check IDs only;
- structured results bound to environment digest and workspace snapshot hash;
- no arbitrary Pi/model filesystem, shell, network, edit, or process tools.

### Privacy and providers

- explicit disclosure and user action before learner/course/workspace data is sent to a model, remote executor, or another person;
- minimum typed model context, credential isolation, retention controls, and export/delete semantics;
- explicit provider configuration failures, with Mock limited to tests, CI, and development.

Publishing current Compose behind TLS does not satisfy these requirements. A reverse proxy cannot add missing application identity, authorization, data scoping, or execution isolation by itself.

## Future status gate

The “self-hosted” label may be promoted from **Future** only after:

- unauthenticated access is denied in end-to-end tests;
- role authorization and protected data boundaries are tested;
- proxy/TLS/session/CSRF/rate-limit configuration is verified;
- representative persistent-data backup, migration, and restore are exercised;
- the server execution backend passes escape, resource, credential/host-mount absence, and deny-network tests;
- an operator runbook covers upgrades, backup/restore, logs, secrets, monitoring, and incident response;
- the exact topology receives security approval.

Until then, use Aptiloop only on loopback for one trusted local user.
