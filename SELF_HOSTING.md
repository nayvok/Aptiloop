# Self-Hosting Aptiloop

Status: **Future** for authenticated public/LAN self-hosting. The committed Docker Compose setup is an **Implemented baseline** for loopback-only local use.

> **Do not expose the current web or orchestrator ports to a LAN, the Internet, a tunnel, or a public reverse proxy.** The current application has no user authentication or authorization. `Origin`, JSON content type, and `X-DLH-Client` checks are not authentication.

See [Deployment Models](docs/architecture/deployment-models.md) for the normative topology and promotion gates.

## What is supported today

Aptiloop Core Alpha is local-first and single-user. Two local forms exist in the repository:

- local Node processes, with the orchestrator defaulting to `127.0.0.1:8787` and the web application on local loopback;
- the committed two-service Compose topology, with host publication restricted to `127.0.0.1:3000` and `127.0.0.1:8787`.

Compose runs the web and orchestrator as non-root container users, waits for local health checks, stores SQLite data and attempt data in named volumes, and bind-mounts repository-controlled exercise templates. The orchestrator listens on `0.0.0.0` inside its container so the web container can reach it; the host port mappings provide the loopback boundary.

This is **local packaging, not authenticated public self-hosting**. Do not change `127.0.0.1` port publication to `0.0.0.0`, publish it through a router/tunnel, or place a public proxy in front of it.

## Current local data boundaries

Default process-mode locations are:

| Data | Default |
| --- | --- |
| SQLite database | `.data/dev-learning-harness.sqlite` |
| Verified backup directory | `.data/backups` |
| Trusted exercise templates | `workspaces/exercises` |
| Learner attempt workspaces | `.data/exercise-attempts` |
| Optional OpenCode endpoint | HTTP loopback only |

Compose stores the database in `harness-data` and attempt workspaces in `harness-attempts`. These volumes are private runtime data and are not source fixtures. They can contain answers, transcripts, mastery, mistakes, diffs, test output, provider/model metadata, and local paths.

Private data is never to be uploaded or shared without an explicit user action that names the destination and scope. Course Packs, exports, logs, process environments, and model prompts must not carry credentials. Real-provider failure is explicit; there is no silent fallback to Mock. Mock is test/CI/dev-only.

## Backup before migration or upgrade

Before changing an installation that has data:

1. stop or quiesce application writers;
2. inventory every candidate database and select each one explicitly; do not auto-merge or delete candidates;
3. create a separate timestamped, non-overwriting backup with the repository backup command (`npm run db:backup`) or the same verified backup primitive;
4. require `PRAGMA integrity_check` to return `ok` and `PRAGMA foreign_key_check` to report no violations on both source and backup;
5. retain the inventory, source path, backup path, migration markers, counts, and hashes with the maintenance record;
6. perform migration rehearsal on a disposable database or a separate copy, never on the normal database.

The backup implementation uses SQLite `VACUUM INTO`, includes committed WAL state, rejects same-file and overwrite destinations, and health-checks both files.

A failed in-flight migration is transaction-rolled back. After a migration commits, Aptiloop has no supported down migration: **restore from the verified pre-migration backup is the rollback**. Stop writers, preserve the failed database separately for diagnosis, restore the whole database file consistently, then repeat integrity/foreign-key checks. The restore loses writes made after the backup; define the maintenance cutoff before starting.

See [Core Alpha Migration Strategy](docs/migration/core-alpha-migration-strategy.md) for candidate inventory, dual-read/write, quarantine, and removal gates.

## Native execution warning

The current exercise path copies a trusted repository template into an attempt workspace and runs only the app-owned `test` command with `shell: false`, a sanitized environment, timeout, output cap, cancellation, and process-tree cleanup. Review is bound to the complete diff fingerprint and is read-only.

It is nevertheless **native, unsandboxed, trusted-only execution**. The process has the authority of the orchestrator/container user within its reachable environment, and current execution does not enforce network denial. Path containment and a command allowlist are not a hostile-code sandbox.

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
