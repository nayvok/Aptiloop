# ADR 0011: Collision-Safe Install Port Selection

## Status

Approved Core Alpha target

## Date

2026-09-09

## Context

The installed CLI starts two loopback services (web and orchestrator) and must not collide with other software, another Aptiloop install, or its own running instance. The owner approved the semantics: defaults are `10101` (web) and `8787` (orchestrator); fallback is allowed only on the first unpinned setup/start; flags, environment overrides, and fixed ports never hop; persisted ports remain stable; reset rearms fallback. The design must cover every start path — `aptiloop init`, foreground `start`, per-user service install/start/autostart, and update cutover — without shifting port authority into the browser, the installer, or Course content.

This is a single-user local app with a documented stable URL, so it follows the opencodex CLI port model (unpinned starts may pick another free port; an explicit `--port` never hops) with deliberate Aptiloop-specific divergences recorded below.

Related specifications: [Deployment models](../architecture/deployment-models.md), [Self-hosting boundary](../../SELF_HOSTING.md), and the installed runtime baseline in that document.

## Decision

Port selection is centralized in the installed CLI (`packages/cli/src/ports.ts`) and follows one contract for all start paths.

- **Resolution order:** explicit `--port`/`--orch-port` flags > `APTILOOP_PORT`/`APTILOOP_ORCHESTRATOR_PORT` environment overrides > persisted `<data-dir>/config.json` > preferred defaults `10101`/`8787`. Loopback-only (`127.0.0.1`) always.
- **Pinned is fixed.** Any explicit flag, environment override, or user-fixed persisted config selects `fixed` mode with exactly one candidate pair. An occupied pinned port fails closed with an actionable error; it never hops.
- **Unpinned is auto once.** `init`, first unpinned start, and `service install` run in `auto` mode. `init` and `service install` record the preference only — they never probe or reserve ports. The first start that actually binds walks a deterministic bounded range (`web 10101–10111`, `orchestrator 8787–8797`; the ranges are disjoint so a pair can never collide with itself) and persists the concrete bound winner with `autoFallbackArmed: false`, after which later starts are effectively fixed until reset.
- **Reuse beats collision.** A loopback occupant that answers `/api/version` with product `Aptiloop`, a non-empty version, and a loopback web origin is reused/opened, not treated as a collision. Strangers, malformed bodies, or guessed version shapes are not reuse candidates.
- **Persistence is atomic and strict.** `config.json` is written by temp-file + rename, strictly validated on read, and unreadable/invalid values are treated as absent (preferred defaults apply). Reset (`aptiloop config reset-ports`) restores the preferred automatic pair and rearms fallback.
- **Single instance.** A create-only instance lock per data dir (with stale-PID recovery and rename-based reclaim) prevents duplicate starts against the same data dir before any port is touched.
- **Update cutover does not touch selection.** The update worker health-checks candidates on ephemeral OS-assigned loopback ports (`port 0`, mutually excluded), never on the user's ports, and after cutover restart waits on the persisted pair. The stable launcher environment scrubs launcher-owned port variables so inherited shells cannot override the CLI-resolved pair. npm postinstall never inspects or reserves ports.
- **Status advertising.** The actually bound pair is recorded in the PID record and runtime status that `status`, shortcuts, the service adapter, and the UI consume; documentation and shortcuts never assume the defaults.

## Consequences

- The fallback space is bounded (11 ports per service). Exhausting it fails with an explicit actionable message instead of hopping unboundedly or taking an arbitrary OS-assigned port.
- Two installs with different data dirs can each hold an automatic pair; the same data dir is protected by the instance lock, not by ports.
- Because only bind failures are collisions, a service that fails for another reason after a probe looked free fails honestly with its own reason.
- Port selection stays a server/CLI concern; the browser only reads advertised origins through the orchestrator and never resolves ports.

## Alternatives

- **Ephemeral `port 0` for normal starts:** rejected because the documented stable URL is a product commitment and persisted ports must stay stable.
- **Unbounded hopping until a free port:** rejected as unpredictable and hostile to bookmarks, service definitions, and proxy configuration.
- **Reserving ports at install time (postinstall):** rejected because a reservation cannot prove a later bind and adds install-time failure modes.
- **Treating any startup failure as a collision:** rejected because it would mask real failures (missing artifacts, bad config) as port noise.

## Implementation status

**Implemented baseline:** the resolution order, auto/fixed modes, bounded deterministic candidate walk, EADDRINUSE-only classification, Aptiloop reuse probe, atomic persisted config with reset, create-only instance lock with stale recovery, `init`/`service install` record-only selection, and update-cutover ephemeral health ports are present in `packages/cli/src/ports.ts`, `packages/cli/src/cli.ts`, `packages/cli/src/runtime.ts`, and `scripts/update-worker.mjs`. The `packages/cli` port suite passes 14/14 on Windows (observed 2026-09-09). Windows installed-runtime start/service behavior is covered by earlier task evidence; macOS/Linux service behavior remains adapter-contract-only.

**Approved Core Alpha target:** the contract above is normative for every current and future start path; no new start path may bypass it.

**Future:** no multi-port publishing, LAN binding, or public exposure is part of this decision; loopback-only is a standing boundary.
