# ADR 0001: Local-first Core

## Status

Approved Core Alpha target

## Date

2026-08-08

## Context

Aptiloop Core Alpha is a personal learning application, not a hosted learning platform. Its authoritative state includes courses, immutable revisions, learner evidence, mastery, private adaptation, review history, provider settings, and local workspaces. That state must remain useful without an account, cloud service, or AI provider. A browser-only client is insufficient because the application owns deterministic learning rules, local persistence, provider boundaries, and controlled execution.

Related specifications: [Core Alpha scope](../product/core-alpha-scope.md), [Architecture](../../ARCHITECTURE.md), [Deployment models](../architecture/deployment-models.md), [Core Alpha migration strategy](../migration/core-alpha-migration-strategy.md), and [Threat model](../security/threat-model.md).

## Decision

Core Alpha is a local-first, single-user application with these boundaries:

- `Course` is the top-level product entity. Course revisions, learner sessions, adaptation state, evidence, and review items are course-scoped.
- SQLite is the authoritative Core Alpha store. Repository and transaction boundaries must remain compatible with a later PostgreSQL implementation; PostgreSQL, sync, accounts, and multi-user authorization are Future.
- The web application calls an app-owned local Core service. The service, not the browser or an AI model, owns validation, state transitions, persistence, provider policy, and execution policy.
- Core functionality works without AI. An external provider may receive private data only after an explicit user action with clear destination and scope; there are no background uploads, cloud sync, or implicit sharing.
- Core Alpha fails closed when its local Core, database, or required filesystem boundary is unavailable. Optional AI failure must not masquerade as Core failure.
- The supported default is loopback-only. Exposing the service to a LAN or public network is not a supported shortcut to self-hosting.
- Migrations are additive and provenance-preserving. Existing local databases are inventoried and backed up; unmatched legacy records are quarantined rather than deleted or silently reinterpreted.

## Consequences

- Learning, review, authoring, and local export remain available without a provider.
- A single-user scope removes account and collaboration complexity but does not remove validation, privacy, backup, or process-isolation obligations.
- Any future remote or multi-user mode requires a separate decision covering authentication, authorization, TLS, CSRF, tenant isolation, audit, and data lifecycle.
- Course scoping and PostgreSQL-compatible boundaries require incremental migration away from current global singleton assumptions.

## Alternatives

- **Cloud-first service:** rejected because it makes private learning state and availability depend on remote infrastructure.
- **Pure browser application:** rejected because controlled execution, durable SQLite state, and provider credential boundaries require a local service.
- **Ship LAN/self-host exposure in Alpha:** deferred; loopback request headers and `Origin` checks are not authentication.
- **Big-bang database rewrite:** rejected in favor of additive migration with backups, provenance, compatibility reads, and measured cutover.

## Implementation status

**Implemented baseline:** the repository has a Next.js client, a Hono orchestrator, local SQLite repositories, loopback defaults, Docker loopback publication, versioned session snapshots, backup utilities, and filesystem/process seams. Current data and navigation remain globally single-course in places; non-loopback configuration is not fail-closed; legacy routes remain live.

**Approved Core Alpha target:** the boundaries above are normative, but are not yet implemented as a complete Course-scoped Core.

**Future:** PostgreSQL, synchronization, remote hosting, accounts, collaboration, and multi-user authorization.

No major implementation is authorized until the Core Alpha audit/specification set passes the owner approval gate.
