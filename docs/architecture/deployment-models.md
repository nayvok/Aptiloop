# Deployment Models

Status: local single-user processes and loopback Compose are an **Implemented baseline**. Hardened authenticated self-hosting and remote managed deployment are **Future**. Core Alpha remains local-first and single-user.

## Non-negotiable boundary

The current application has no user authentication or authorization. `Origin`, `Content-Type`, and `X-DLH-Client` checks are request-boundary controls, not identity. Therefore the current server must not be published to a LAN, the Internet, a tunnel, or an untrusted reverse proxy.

The committed `compose.yaml` is **loopback/local only and is not authenticated public self-hosting**. Although the containers listen on `0.0.0.0` internally, the host publishes web and orchestrator only on `127.0.0.1`. Changing those port bindings, forwarding them, or adding a public reverse proxy produces an unsupported and unsafe deployment.

**Approved Core Alpha target:** process mode rejects any non-loopback bind. The local Compose profile may bind a service to `0.0.0.0` only inside its verified private container network while every host-published port remains explicitly loopback-only. Startup/preflight validates the effective host publication and fails closed on wildcard/LAN publication, forwarding, or unapproved proxy exposure; internal wildcard binding does not make client headers or Origin checks authentication.

## Model matrix

| Model              | Status                   | User/data model                                     | Database                                                                                             | Execution                                                                                           | Editor                                                        | Network exposure                                        |
| ------------------ | ------------------------ | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------- |
| Local processes    | **Implemented baseline** | One local user; private local data                  | SQLite file                                                                                          | M5 trusted local-native Execution Fabric; finite Node/Python checks; unsandboxed, network inherited | Zed/copy-path; embedded editor is target                      | Loopback only                                           |
| Local Compose      | **Implemented baseline** | One local operator; named local volumes             | SQLite in `harness-data`                                                                             | Same trusted Fabric inside orchestrator container; container is not hostile-code isolation          | Host Zed integration is not equivalent to native process mode | Host ports bound to loopback only                       |
| Hardened self-host | **Future**               | Authenticated identities and explicit authorization | SQLite only for an approved single-instance profile; PostgreSQL-compatible repository boundary later | Isolated server backend, no host mounts/credentials, resource quotas, deny network by default       | Embedded/remote contract                                      | TLS behind an approved proxy; no unauthenticated routes |
| Managed/remote     | **Future**               | Multi-tenant isolation and policy                   | PostgreSQL or another approved service behind repository contracts                                   | Tenant-isolated remote Execution Fabric, deny network                                               | Remote editor                                                 | Authenticated encrypted service boundary                |

No row in the future section is a promise that the behavior exists.

## Implemented local process model

The source defaults are:

- orchestrator direct mode accepts only `127.0.0.1`, `::1`, or `localhost` and defaults to `127.0.0.1:8787`;
- web defaults to `127.0.0.1:3000` through local development tooling;
- the only active M1 SQLite candidate is `.data/dev-learning-harness.sqlite`;
- new approved backups use explicit active-source preflight and `.data/approved-backups`; five alternate families and eleven old backups remain quarantined;
- trusted templates are at `workspaces/exercises`, attempts at `.data/exercise-attempts`, and fixed compatibility/Core Node/Python Environment Pack/check descriptors are app-distributed;
- Mock is the only learning provider; Codex/OpenCode are blocked legacy adapters and no external sidecar is started.

The web browser uses Next.js routes/rewrite to reach the orchestrator. The orchestrator owns SQLite, filesystem/process operations, providers, and deterministic learning transitions.

M5 native checks run with the current user's authority. App-owned exact plans, minimal child environments, time/output/cancellation/tree-cleanup limits, complete-workspace snapshot binding, and immutable artifacts improve auditability, but do not enforce network, memory, disk, or process-count isolation. Only trusted repository-controlled templates may use the compatibility npm plan; imported Course content cannot supply executable input. Local mode must say trusted/unsandboxed explicitly.

## Implemented loopback Compose model

The committed Compose topology has two services:

- `web`, published at `127.0.0.1:3000`;
- `orchestrator`, published at `127.0.0.1:8787`;
- a private service-to-service URL from web to orchestrator;
- named `harness-data` and `harness-attempts` volumes;
- a bind mount of the repository-controlled exercise templates;
- non-root application users in both images and local health checks.

The services set explicit `ORCHESTRATOR_BIND_MODE=container-loopback-published`. Only that mode permits the orchestrator's internal `0.0.0.0` bind and exact `http://orchestrator:<port>` web rewrite; direct mode rejects both. The host publications above remain the unauthenticated network boundary.

This is a local packaging convenience, not an isolation or public-hosting claim. Important limits:

- there is no login, session identity, role authorization, CSRF/session system, public rate limiting, public audit log, trusted-proxy configuration, or TLS termination;
- the browser trust headers are spoofable by any network client that can reach the service;
- the orchestrator image contains a Node runtime, dependencies, templates, and native execution authority within its mounted volumes;
- container process/file isolation is not a vetted hostile-code sandbox, and current checks are not deny-network;
- named volumes require separate operator backup/export handling; copying a live SQLite file directly is not the approved backup method;
- a desktop editor on the host is not automatically available inside the container. The copy-path/open-in-editor experience is deployment-specific.

Do not change Compose port publication from loopback or attach a public proxy and call it self-hosting.

## Approved Core Alpha local-first boundary

Core Alpha remains:

- single-user and local-first;
- SQLite-backed, with repository/domain boundaries designed so a later PostgreSQL adapter does not leak SQL/storage concerns into the Learning Kernel;
- Course as the top entity, immutable Course revisions, personal adaptation/workspace branches, and finite Activity graphs;
- deterministic local Learning Kernel ownership of progression/mastery;
- explicit provider resolution, with no silent real-provider-to-Mock fallback;
- private data local by default and never uploaded/shared without an explicit action showing destination and scope.

Local-first does not mean “offline everything”: a configured real AI provider may require network access. That provider use is explicit and separate from exercise execution. Exercise checks must not inherit provider credentials.

## Future hardened self-host boundary

A supported self-hosted profile cannot be documented as available until it includes and verifies all of the following.

### Identity and HTTP

- authenticated users, secure session lifecycle, logout/revocation, password/identity-provider policy, and authorization on every read/mutation;
- separation of learner, course author/publisher, and operator capabilities; protected answers and authoring data are never learner-readable;
- TLS, secure cookies, CSRF protection, allowed-host/origin policy, trusted-proxy configuration, request/body limits, rate limits, and security headers;
- auditable security-sensitive operations without logging secrets/private content unnecessarily;
- fail-closed startup for unsafe bind/proxy/auth combinations.

The `X-DLH-Client` header and `Origin` remain defense-in-depth and never become authentication.

### Data and storage

- one explicitly selected database; no candidate auto-merge;
- encrypted transport to external databases and secrets supplied through an approved secret store;
- tested backups, restore drills, retention, storage quotas, migration maintenance windows, and recovery objectives;
- PostgreSQL compatibility through app-owned repositories and transactions, not SQL conditionals scattered through domain code;
- explicit single-instance/write constraints if SQLite is offered. A shared SQLite file over a network filesystem is unsupported;
- tenant/user/course scoping in every persistence relationship before any multi-user claim.

### Execution

Server execution is a separate backend from local trusted native execution. It must provide:

- a sandbox per run, read-only base, ephemeral writable attempt, no Docker/socket/host mounts, no host PID or credential access;
- CPU, memory, process, time, output, artifact, and storage quotas plus cancellation/cleanup;
- **deny network by default**, tested at DNS, IPv4, IPv6, loopback, link-local, metadata-service, and proxy paths;
- app-owned Environment Packs/check IDs only; Course Packs still contain no commands, scripts, secrets, plugins, or paths;
- immutable environment identity/digest and structured results bound to input snapshot hash;
- no use of a general Pi/coding-agent shell or filesystem tool as the execution backend.

A future approved network exception belongs to an operator-installed Environment Pack policy, is visible/audited, and cannot be requested by Course content. Core Alpha does not require such exceptions.

### Privacy and providers

- explicit data-flow disclosure before sending learner/course/workspace content to an external model or remote execution service;
- minimum typed context for Aptiloop-owned Pi tools; no arbitrary filesystem, shell, network, edit, or credential tools;
- provider credentials never stored in Course Packs, workspace exports, process environments, logs, or artifacts;
- explicit errors for unavailable/misconfigured providers. Mock is test/CI/dev-only and never a production fallback;
- export/share/delete are separate explicit actions with exact scope and retention consequences.

## Future managed/remote model

Managed service support additionally requires tenant isolation, per-tenant encryption/key policy, data residency/retention controls, administrative separation, abuse controls, availability/incident procedures, and a PostgreSQL-class concurrency model. Remote editor and execution transfers require explicit consent and authenticated encrypted transport.

Multi-user collaboration, conflict resolution, automatic merge, public Course marketplace, remote Environment Pack/plugin installation, and durable Pi AgentHarness driving are not Core Alpha assumptions. They require separate specifications and approval. Pi's current harness-v2 is partial/stubbed, and its SQLite session backend is not a transparent replacement for Aptiloop persistence.

## Data durability by model

For all models:

1. inventory candidate databases and choose one explicitly;
2. create a timestamped, non-overwriting SQLite backup with the Node `node:sqlite` online `backup()` API so committed WAL state is included in the logical copy;
3. verify `PRAGMA integrity_check` and `PRAGMA foreign_key_check` on source and backup;
4. stop writers for restore, preserve the failed database separately, restore the verified file, and re-run health checks;
5. never run migration experiments against the normal database. Use a disposable database or a separate verified copy.

A transaction can roll back a failed in-flight migration. After a schema migration commits, the reliable rollback is restore from the verified pre-migration backup; there is no supported down migration. Restoring also discards writes made after the backup, which is why maintenance windows and rollback cutoffs must be explicit.

## Deployment promotion gates

### Local release gate

- loopback bind/publication is enforced and documented;
- database/backup/restore and volume paths are explicit;
- native execution displays trusted-only/unsandboxed status;
- no secrets enter logs, artifacts, Course Packs, or check environments;
- provider failure remains explicit;
- the changed user journey is smoke-tested locally.

### Self-host gate

In addition to the local gate:

- unauthenticated GET and mutation requests are denied in end-to-end tests;
- authorization and protected-answer separation are tested by role;
- TLS/proxy/cookie/CSRF/host/rate-limit configurations are tested;
- backup/restore and migration are exercised on representative persistent data;
- the isolated execution backend passes escape, resource, credential/host-mount absence, and deny-network tests;
- security review and operational documentation approve the exact topology.

Until every self-host gate is met, documentation and UI must label the mode Future/unsupported rather than offering public deployment instructions.
