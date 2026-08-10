# ADR 0004: Pi as a Restricted Model Runtime

## Status

Approved Core Alpha target

## Date

2026-08-08

## Context

Aptiloop needs provider-neutral model access and typed tool calls, but it must not inherit a coding agent's authority. Pi has useful provider, authentication, streaming, validation, and agent-loop seams; it has no built-in filesystem, process, network, credential, or permission boundary. Its documented AgentHarness v2 durability design is not a completed runtime, and its SQLite session backend is not a transparent replacement for coding-agent JSONL sessions.

Related specifications: [Pi runtime](../architecture/pi-runtime.md), [Provider Hub](../architecture/provider-hub.md), [Research Gateway](../architecture/research-gateway.md), [AI boundaries](../security/ai-boundaries.md), and [Threat model](../security/threat-model.md). Runtime evidence distinguishes the published v0.84.1 [tag commit `53fa77ccd8a279eb87e92294ef3687b03ff80112`](https://github.com/earendil-works/pi/tree/53fa77ccd8a279eb87e92294ef3687b03ff80112) from separately inspected post-release source at [`9dd90a49711d088b86fdd9b4aea575913a8328`](https://github.com/earendil-works/pi/tree/9dd90a49711d088b86fdd9b4aea575913a8328); see the [Pi permission warning](https://github.com/earendil-works/pi/blob/9dd90a49711d088b86fdd9b4aea575913a8328/README.md#L35-L41).

## Decision

Pi is the model/runtime seam behind Aptiloop-owned orchestration and policy.

- Aptiloop roles such as Course Designer, Tutor, Evaluator, and Reviewer are app contracts, not Pi role classes.
- The app exposes only narrow, typed, schema-validated tools needed by a role. It exposes no arbitrary filesystem read/write, shell/process execution, network fetch, patch/edit, plugin, credential, or provider-management tools.
- Reviewer is evidence-only: it receives the bounded app-built review capsule, has no local/general tools, and returns typed findings without patch/apply authority.
- Provider/model/auth resolution is explicit and app-owned. Failure remains explicit. There is no silent real-provider-to-Mock fallback.
- Mock is limited to tests, CI, and deliberate development fixtures; it is not a production provider or an offline substitute presented as real evaluation.
- Tool output is size-bounded and validated again by Aptiloop. Pi tool-schema constrained sampling is not treated as a provider-neutral structured assistant-output guarantee.
- Learner, course, session, and evidence identity remain in Aptiloop. Pi `sessionId` is not durable product identity.
- Integration targets the shipped `@earendil-works/pi-ai` and `@earendil-works/pi-agent-core` seams. It does not depend on unimplemented AgentHarness operations or assume the Pi SQLite backend plugs into coding-agent `AgentSession`.

## Consequences

- Aptiloop must build and test its own authorization, data minimization, budgets, persistence, audit, and tool adapters.
- Provider capability differences are surfaced rather than hidden by permissive fallbacks.
- Coding-agent convenience tools cannot be enabled wholesale, even locally.
- Pi upgrades require a pinned source review of provider/auth/tool behavior and breaking storage changes.

## Alternatives

- **Embed `pi-coding-agent` with default tools:** rejected because those tools exceed the learning application's authority boundary.
- **Use model text as structured truth:** rejected; authoritative results require typed tools plus app-side validation.
- **Adopt AgentHarness v2 design as shipped behavior:** rejected because major lifecycle methods are stubbed.
- **Silently fall back to Mock:** rejected because it would misrepresent evaluation provenance and readiness.

## Implementation status

**Implemented baseline:** Aptiloop pins `@earendil-works/pi-ai` and `@earendil-works/pi-agent-core` `0.84.1`, implements a constrained Pi adapter, a strict default-deny Aptiloop tool host, exact Provider Hub resolution, immutable disclosure decisions, minimized turn provenance, and cumulative role budgets. Active learning chat, interview, and evidence-only review resolve through Provider Hub; browser disclosure preview/approval is exact and one-time. Aptiloop does not install `pi-coding-agent` or Pi session persistence.

**Approved Core Alpha target:** M6 acceptance still requires the exact authenticated external provider/model smoke with cancellation and persistence evidence. This workstation has no configured OpenAI credential, so no production real-provider readiness is claimed.

**Future:** additional providers, durable agent lanes, and remote model gateways, each behind the same app-owned policy.

M6 acceptance remains governed by the authenticated external smoke gate above.
