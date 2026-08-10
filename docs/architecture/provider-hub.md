# Provider Hub

**Document status:** Approved Core Alpha target with an accepted evidenced **Implemented baseline**.
**Purpose:** separate provider connections from Aptiloop roles, resolve models/capabilities centrally, support explicit no-AI mode, and make every failure visible without silent fallback.

## Implemented baseline

**Implemented baseline.** `packages/shared/src/provider-hub.ts` now defines strict connection, capability, RoleProfile, per-role tool-policy, structured failure, disclosure, and turn-provenance contracts. `packages/agent-core/src/provider-hub.ts` resolves one exact server-owned connection/model, rejects AI Off, disabled/missing providers, capability gaps, and model loss without fallback, and requires an exact approved disclosure for external turns. `packages/agent-core/src/typed-tool-host.ts` installs only the finite Aptiloop role tool matrix and validates both arguments and results.

**Implemented baseline.** Additive migration `0014_provider_hub` and `ProviderHubRepository` persist secret-free connections, role profiles, tool policies, immutable disclosure operations/events, and terminal provider-turn provenance. Disclosure approval is payload-hash, destination, provider, model, role, entity-scope, and expiry specific; one-time consumption is append-only.

**Implemented baseline.** Active learning chat, interview, and evidence-only review resolve through persisted `RoleProfile` records and `ProviderHub`; flattened browser role selections and the legacy provider-status route are retired. The UI previews exact external disclosure scope and consumes an immutable approval once. The common runner enforces cumulative input/output/event/tool/deadline budgets, explicit cancellation, minimized persistence, and structured failures without fallback. Private environment/context sentinels and all four finite role matrices are covered. The exact authenticated OpenCode Zen `deepseek-v4-flash-free` smoke completed through constrained Pi with synthetic text in a disposable database, exact disclosure consumption, persisted minimal provenance, and observed cancellation. This closes M6 acceptance without asserting general production provider readiness.

**Implemented baseline.** Settings exposes a server-owned connection-management API and localized UI for the reviewed catalog. API-key and subscription credentials are connection-scoped in `.data/provider-credentials.json` and never returned to the browser or stored in SQLite. Built-in providers own endpoint/model discovery; Ollama and LM Studio accept only loopback `/v1` URLs plus exact model IDs; the advanced custom compatible adapter accepts only explicit public HTTPS `/v1` endpoints plus exact model IDs. Connection disable/enable, key replacement, subscription sign-in/sign-out, observed model status, and exact per-role model switching are explicit mutations.

## Separate concepts

**Approved Core Alpha target.** A provider connection is never a role.

```ts
type ProviderConnection = {
  connectionId: string;
  providerType: string;
  displayName: string;
  credentialRef: string | null; // reference into credential store, never secret value
  endpointProfileId: string | null;
  enabled: boolean;
  state: ConnectionState;
  observedCapabilities: ProviderCapabilityProfile | null;
  lastCheckedAt: string | null;
};

type RoleProfile = {
  role: "course-designer" | "tutor" | "evaluator" | "reviewer";
  mode: "no-ai" | "connection";
  connectionId: string | null;
  modelId: string | null;
  requiredCapabilities: readonly CapabilityRequirement[];
  toolPolicyId: string;
  budgets: RoleBudgets;
};
```

A connection can serve zero or several roles. Each role independently references a connection/model after validation. Deleting/disabling a connection does not rewrite role history; affected profiles become explicitly unresolved. A model/provider is provenance for a turn, never the durable lesson identity.

Credentials live in an app-owned credential store or approved provider auth store. The Hub stores only references and safe metadata. Course Packs, role prompts, browser payloads, SQLite learner records, logs, and tool results never contain credentials.

## Capability profile

**Approved Core Alpha target.** Marketing/provider flags are mapped into Aptiloop capability IDs with evidence and observation time:

```ts
type ProviderCapabilityProfile = {
  providerType: string;
  adapterVersion: string;
  observedAt: string;
  models: readonly ModelCapabilityProfile[];
  connection: {
    authenticated: boolean;
    streaming: boolean;
    cancellation: boolean;
  };
};

type ModelCapabilityProfile = {
  modelId: string;
  available: boolean;
  contextTokens: number | null;
  outputTokens: number | null;
  typedToolCalls: "none" | "best-effort" | "schema-constrained";
  parallelToolCalls: boolean;
  attachments: readonly ("text" | "image")[];
};
```

Role policy additionally evaluates application-level abilities that are not provider claims: exact typed tool schemas installed, tool result validation, default-deny enforcement, read-only context, output/event budgets, and evaluator/reviewer freshness rules.

A provider-neutral structured assistant-output capability is not assumed. For Pi, constrained sampling applies to tools, not generic assistant output; evaluator/reviewer therefore require strict typed tools and app-side validation (see [pi-runtime.md](pi-runtime.md)).

### Course validation and optional AI readiness

- Course Pack declares product capability IDs; any unknown ID is a schema/compatibility error.
- Activity Registry maps known IDs to app roles/tools and the required deterministic/manual completion route. An AI-dependent Activity may be optional and non-blocking only.
- Provider Hub tests an optional AI RoleProfile against a concrete connection/model capability profile.
- Missing, stale, or incompatible provider/model/tool capability makes that AI affordance explicitly unavailable. It does not block Course publication or a required/terminal learner path.
- “Provider connected” alone is not proof that a selected model can perform an authenticated optional operation.

## Resolution algorithm

**Approved Core Alpha target.** Every AI turn is resolved server-side:

1. Load the Aptiloop role profile. Browser requests contain role/activity intent only, never provider/model override.
2. If mode is `no-ai`, return explicit `ai_disabled` unless the activity invokes its deterministic/manual path.
3. Resolve the referenced connection; require enabled and a known provider adapter.
4. Resolve credentials according to provider-owned auth rules without exposing them.
5. Refresh status/capability profile when stale, within a bounded timeout.
6. Resolve the exact configured model; do not choose “first available.”
7. Compare all role/activity requirements to observed capabilities and installed typed tools.
8. Create a bounded provider turn through the Pi/provider adapter with the role's default-deny tool set.
9. Record minimized provenance: connection ID, provider type, model ID, adapter/capability profile version, role/tool policy, timestamps, outcome, and diagnostic ID. Do not persist raw secrets/general tool input/output.

No step substitutes a different connection, model, provider, role, or Mock. A user may explicitly edit the profile and retry as a new decision.

## Connection state and readiness

Connection state is a closed application projection:

- `disabled` — intentionally off;
- `starting` — bounded initialization in progress;
- `connected` — an authenticated request succeeded at the reported observation time;
- `misconfigured` — missing/invalid endpoint/auth/config;
- `authentication-required` — explicit login/key action needed;
- `unavailable` — executable/service/network/provider absent;
- `degraded` — connected but one or more optional capabilities/models unavailable;
- `error` — bounded unexpected adapter failure.

Readiness is time-scoped evidence, not a permanent assertion. Provider health/model discovery and an authenticated model/tool canary are distinct observations. UI reports the layer, time, safe diagnostic, and recovery action without secrets.

## No-AI mode

**Approved Core Alpha target.** No-AI is first-class and may be global plus per-role. It means:

- no provider process/session/turn is started for that role;
- no learner/Course/source data is sent externally;
- no Mock content is substituted;
- manual authoring, deterministic Learning Kernel, local knowledge, and non-AI activity paths remain available;
- optional AI affordances disappear or show `Off`, not `Ready`;
- a required/terminal Activity that needs AI without a validated deterministic/manual completion route is a Course validation error and blocks Preview commit, Install, and publication rather than becoming a runtime state;
- only optional AI affordances may disappear or show `Off`/unavailable at runtime; publication readiness confirms that no required/terminal AI-only path exists.

Mock is deterministic test infrastructure for unit/integration/E2E/CI and explicit developer scenarios only. It is never a production connection, offline tutor, or silent fallback.

## Explicit failures

```ts
type ProviderHubFailureCode =
  | "ai_disabled"
  | "connection_not_found"
  | "connection_disabled"
  | "authentication_required"
  | "misconfigured"
  | "provider_unavailable"
  | "model_unavailable"
  | "capability_unknown"
  | "capability_missing"
  | "tool_policy_unavailable"
  | "disclosure_required"
  | "disclosure_mismatch"
  | "invalid_output"
  | "budget_exceeded"
  | "cancelled"
  | "timeout"
  | "provider_error";
```

Each failure returns a retryable flag, safe user message key, diagnostic ID, and optional recovery action. It commits no successful agent message/evaluation fact/activity completion. Failed partial output is visibly incomplete and cannot become trusted evidence.

Examples:

- Selected real provider cannot authenticate → `authentication_required`; do not use environment credentials after a stored credential refresh failure and do not switch to Mock.
- Selected model disappears → `model_unavailable`; do not choose the first returned model.
- Typed tool calling is unobserved/unknown → `capability_unknown`; block the evaluator activity/profile/publication that requires it.
- Stream exceeds byte/event/deadline budget → cancel and return `budget_exceeded`; persist only bounded diagnostic/provenance.
- Provider emits invalid evaluator output → `invalid_output`; kernel sees no evidence.

## Typed tools and safety

The Hub exposes no provider-native shell, filesystem, edit, patch, network/browser, credential, or arbitrary RPC tools. It installs only Aptiloop typed tools allowed by the resolved role policy (see [pi-runtime.md](pi-runtime.md)). Every call is schema-validated, scope re-resolved, budgeted, auditable, and default-denied.

Reviewer receives only a bounded app-built evidence capsule, has no local/general tools or patch authority, and submits a typed result. Course Designer submits draft proposals only; no apply/publish. Tutor reads learner-safe context only. Evaluator submits a typed result only. Models never select commands or state transitions.

## Privacy and retention

- Context builders use explicit allowlists per role/tool.
- Protected answers, unrelated learner history, credentials, local paths, and raw private source material are excluded unless the role contract explicitly needs a safe slice.
- Before any provider receives private data, UI shows the exact destination and data category and requires an explicit user action scoped to that disclosure.
- Persist bounded final content and minimized audit envelopes only when product behavior needs them; never persist general provider tool inputs/outputs.
- Cancellation, errors, and diagnostics are bounded and secret-redacted before persistence/logging.

## Completed incremental migration

1. Added connection and RoleProfile records while reading legacy settings only inside the additive migration path.
2. Centralized exact connection/model/capability resolution and rejected browser provider/model overrides.
3. Added observed capability mapping, typed failures, and explicit no-AI profiles; Mock is restricted to test/development composition.
4. Routed active learning roles through Provider Hub and Aptiloop default-deny tool policies.
5. Removed general Codex/OpenCode workspace/tool authority from learning roles.
6. Migrated browser settings/history provenance and retired flattened role fields and the legacy provider-status API.

**Future.** Automatic cost/latency routing, load balancing, provider failover, team-shared connections, remote secrets services, and production multi-user quotas are outside Core Alpha.
