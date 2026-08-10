# AI Providers

**Document status:** **Implemented baseline** M1 containment. Pi integration and external learning-provider enablement remain an **Approved Core Alpha target**.

## M1 learning policy

The orchestrator owns provider/model resolution. Teacher, Reviewer, Interviewer, Curator, and Codex Expert are fixed to the deterministic Mock profile for tests, CI, and explicit development. Browser request bodies cannot choose or override provider/model. An unavailable or denied external provider remains an explicit failure and never silently substitutes Mock.

Mock preserves the runnable v2 learning vertical. It exercises product flow and boundary contracts, not external model quality or production evidence.

## Legacy Codex and OpenCode adapters

Codex app-server and OpenCode adapters remain in the repository as legacy migration boundaries. They may report diagnostics, but M1 policy blocks them from every learning role. Do not interpret an installed CLI, reachable sidecar, discovered model, or `connected` health result as permission to run a learning turn.

`npm start` launches Aptiloop only. It does not start OpenCode, Codex, or any other external sidecar. If an operator starts a sidecar separately for adapter diagnostics, it must remain on loopback and is still unusable by learning roles.

Defense in depth remains at the blocked adapters:

- Codex children receive only essential OS/path values, `CODEX_HOME`, and required OpenAI credential variables; unrelated database, OpenCode, and GitHub secret classes are excluded;
- OpenCode normalized tool events discard provider input/output and retain only bounded lifecycle identity;
- provider RPC/session IDs and raw events are never browser contracts;
- server-initiated general tools/approval requests are not Aptiloop learning capabilities.

## Persistence and browser events

Browser-facing events are an allowlist correlated by an app-owned opaque turn UUID. Provider session/protocol IDs and raw tool arguments/results are not exposed. New messages always persist `tool_events_json='[]'` and `raw_event_json=NULL`; new reviews persist no raw response.

The [M1 inventory](audits/2026-08-08-m1-safety-boundary-inventory.md) observed zero logical non-empty raw/tool rows. This does not prove historical byte absence from SQLite free pages, WAL/SHM, snapshots, or external copies.

## External-provider promotion gate

A real provider/role remains blocked until the target Provider Hub supplies server-owned profile/capability resolution, typed Aptiloop tools, scoped disclosure consent, bounded context/output, evidence-only Reviewer behavior, cancellation/cleanup, persistence minimization, and a real authenticated smoke with exact runtime/provider/model and terminal result. Mock tests cannot substitute for that smoke.
