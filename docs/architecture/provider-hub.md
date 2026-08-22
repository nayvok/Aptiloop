# Provider Hub

**Document status:** **Implemented baseline** for current connection, role, disclosure, budget, and provenance boundaries; broader routing remains an **Approved Core Alpha target** or **Future** where labeled.
**Purpose:** separate provider connections from Aptiloop roles, resolve models/capabilities centrally, support explicit no-AI mode, and make every failure visible without silent fallback.

## Implemented baseline

**Implemented baseline.** `packages/shared/src/provider-hub.ts` defines strict connection, capability, RoleProfile, per-role tool-policy, structured failure, disclosure, and turn-provenance contracts. `ProviderHub.resolveTurn` resolves one server-owned role/connection/adapter/provider/model, checks provider status/capabilities and exact model availability, and rejects fallback. For an external connection it validates an approved disclosure's status, expiry, role, connection, provider type, model, and payload SHA-256. It does not compare disclosure `entityIds` or `destination`; those fields remain preview/audit scope and application recovery checks where implemented.

**Implemented baseline.** Additive migration `0014_provider_hub` and `ProviderHubRepository` persist secret-free connections, role profiles, policy allowlists, immutable disclosure operations/events, and turn-level provider provenance. Dispatch persists connection/provider/adapter/model/role/tool-policy/capability/disclosure identity and terminal outcome, not raw provider or tool payloads. One approved disclosure is consumed atomically with turn start.

**Implemented baseline.** Course Designer, lesson-scoped Tutor, Interview, and evidence-only Review resolve through persisted `RoleProfile` records and `ProviderHub`; flattened browser role selections and the legacy provider-status route are retired. The UI previews exact external disclosure scope and consumes an immutable approval once. The common runner enforces cumulative input/output/event/tool/deadline budgets, explicit cancellation, minimized persistence, and structured failures without fallback. Private environment/context sentinels and all four finite role matrices are covered. The exact authenticated OpenCode Zen `deepseek-v4-flash-free` smoke completed through constrained Pi with synthetic text in a disposable database, exact disclosure consumption, persisted minimal provenance, and observed cancellation. This closes M6 acceptance without asserting general production provider readiness.

**Implemented baseline.** Settings exposes a server-owned connection-management API and localized UI for the reviewed catalog. API-key and subscription credentials are connection-scoped in `.data/provider-credentials.json` and never returned to the browser or stored in SQLite. Windows persists a strict whole-file current-user DPAPI envelope, migrates validated legacy plaintext through atomic replacement, and fails closed without plaintext fallback; POSIX/Linux retains plaintext owner-mode storage. Built-in providers own endpoint/model discovery; Ollama and LM Studio accept only loopback `/v1` URLs plus exact model IDs; the advanced custom compatible adapter accepts only explicit public HTTPS `/v1` endpoints plus exact model IDs. Connection disable/enable, key replacement, subscription sign-in, managed connection retirement, observed model status, and exact per-role model switching are explicit mutations. Retirement removes local credentials and active configuration, resets dependent current roles to no-AI, and preserves historical provider evidence; it does not assert upstream token revocation.

## Separate concepts

**Approved Core Alpha target.** A provider connection is never a role.

```ts
type ProviderConnection = {
  connectionId: string;
  adapterId: string;
  providerType: string;
  displayName: string;
  credentialRef: string | null; // reference into credential store, never secret value
  endpointProfileId: string | null;
  enabled: boolean;
  external: boolean;
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

A connection can serve zero or several roles. Each role independently references a connection/model after validation. Disabling a connection leaves affected current profiles explicitly unavailable. Retiring a managed connection resets affected current profiles to no-AI but does not rewrite immutable disclosure or turn history. A model/provider is provenance for a turn, never the durable lesson identity.

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
7. Compare role requirements to observed capabilities and resolve the policy allowlist; an allowed name is executable only when a matching app-owned handler is installed.
8. Create a bounded provider turn through the selected adapter. Current Pi tool handlers are installed for Course Designer; other active callers retain their bounded app-owned context/result paths and gain no uninstalled policy tools.
9. Record minimized provenance: connection ID, provider type, model ID, adapter/capability profile version, role/tool policy, timestamps, outcome, and diagnostic ID. Do not persist raw secrets/general tool input/output.

No step substitutes a different connection, model, provider, role, or Mock. A user may explicitly edit the profile and retry as a new decision.

## Durable disclosure recovery

**Implemented baseline.** `ai_disclosure_operations` stores an immutable, secret-free scope: operation identity, provider/connection/model, role, destination, bounded entity IDs, payload categories/exclusions, byte count, payload SHA-256, and `expiresAt`. Append-only events persist `pending`, `approved`, `cancelled`, and `consumed`. Expiry is enforced by comparing `expiresAt` during lookup, approval, and dispatch; the current implementation does not append an `expired` event. The disclosure record intentionally does not persist the disclosed payload.

Recovery is application-owned rather than provider-session recovery. A caller that supports reload recovery must first persist enough typed domain state to reconstruct the exact payload and then expose a non-mutating, scope-specific pending lookup. The browser receives only the bounded disclosure preview and continuation identifiers; it does not store or return the provider payload as authority. Recovery GET never approves, consumes, or dispatches a provider turn.

Recovery matching is caller-specific. `ProviderRuntime.findPendingDisclosure` can match payload hash, connection/provider/model, exact entity IDs, status, and expiry. `resolveTurn` later revalidates role, connection/provider/model, payload hash, approved status, and expiry, but not destination/entity IDs. Approval and cancellation are separate explicit mutations; a dispatch mismatch fails before provider work.

### Course Designer binding

**Implemented baseline.** Course Designer recovery scans persisted pending disclosures and matches the requested Course version, workflow ID, the presence of a Course Designer authoring operation ID, and `expiresAt`; multiple matches fail as ambiguous. The recovery GET does not reconstruct the current Draft payload or rederive its SHA-256 before returning the stored preview. A Draft change can therefore make that preview stale. Dispatch reconstructs the current payload and `resolveTurn` rejects the stale approval by payload hash before provider work. This is a fail-closed dispatch boundary, not exact recovery-preview freshness. Approve/Cancel, proposal Apply, and immutable Publish remain separate decisions.

## Connection state and readiness

Connection state is a closed application projection:

- `disabled` — intentionally off;
- `starting` — bounded initialization in progress;
- `connected` — an authenticated request succeeded at the reported observation time;
- `misconfigured` — missing/invalid endpoint/auth/config;
- `authentication-required` — explicit login/key action needed;
- `unavailable` — executable/service/network/provider absent;
- `degraded` — locally configured and catalog-visible, but no authenticated model request has completed yet, or one or more optional capabilities/models are unavailable;
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

**Implemented baseline.** Managed-connection and sign-in HTTP routes (`/api/settings/ai/*`) surface intended client failures as typed `ClientError` values with exact preserved messages/statuses (unknown/expired sign-in operation → 404 on status reads, 400 elsewhere; connection-disabled conflicts → 409 on removal). Unexpected internal failures — credential-store or SQLite faults, provider-contract violations — are logged server-side with a diagnostic ID and returned as a generic 500 `{ error, diagnosticId }` payload without raw internals.

## Typed tools and safety

The Hub exposes no provider-native shell, filesystem, edit, patch, network/browser, credential, or arbitrary RPC tools. Persisted policies are finite allowlists; `AptiloopTypedToolHost` exposes only the intersection of an allowlist and installed app-owned definitions. Current Pi definitions are the Course Designer handlers. Each installed call is schema-validated, scope-checked by its handler, budgeted, and default-denied.

Live chat may emit `tool.summary` events containing only an allowlisted tool name and `started | completed` status. These summaries contain no call ID, arguments, or result and are not persisted as message history. Persisted provider provenance remains turn-level rather than a durable tool-event log.

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
