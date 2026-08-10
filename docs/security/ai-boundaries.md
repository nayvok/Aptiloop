# AI Runtime and Tool Boundaries

**Document status:** Approved Core Alpha target with a partial evidenced **Implemented baseline**. M1 still blocks every external legacy learning role and permits deterministic Mock only. The M6 foundation now supplies the constrained Pi adapter, Provider Hub resolution, finite Aptiloop role/tool policies, strict tool input/output validation, immutable disclosure decisions, and minimized provider-turn provenance; the legacy learning route, disclosure UI, context builders, cumulative budgets, authenticated provider smoke, and final role/tool adversarial matrix are not yet migrated or claimed complete.

## 1. Ownership boundary

Aptiloop owns Course/learner/session identity, roles, prompts, authorization, typed tools, result validation, persistence, budgets, and every effect on learning state or local resources. Pi is only the model/provider/runtime seam behind those controls.

Course Designer, Tutor, Evaluator, and Reviewer are Aptiloop roles; they are not Pi permission classes. The deterministic Learning Kernel alone owns progression, evidence acceptance, adaptation, and mastery. AI may propose content or return bounded analysis, but it cannot publish a revision, apply a patch, execute a command, write mastery, or decide that evidence exists.

**Approved Core Alpha target:** no AI receives arbitrary filesystem, shell, process, network, HTTP, edit, patch, plugin, secret, provider-RPC, or database tools. Every effect is an Aptiloop-owned typed tool with strict input/output schema, per-role allowlist, server-side authorization, bounded result, audit metadata, and deterministic application semantics.

Reviewer is evidence-only: it receives only the bounded app-built review capsule, has no local filesystem/general tools or patch/apply authority, and returns typed advice/evidence without mutating learner work.

## 2. Pi evidence and constraints

The runtime research distinguishes the official published v0.84.1 [tag commit `53fa77ccd8a279eb87e92294ef3687b03ff80112`](https://github.com/earendil-works/pi/tree/53fa77ccd8a279eb87e92294ef3687b03ff80112) from separately inspected post-release source at [`9dd90a49711d088b86fdd9b4aea575913a8328`](https://github.com/earendil-works/pi/tree/9dd90a49711d088b86fdd9b4aea575913a8328), whose package manifests still say 0.84.1:

- [`@earendil-works/pi-ai`](https://github.com/earendil-works/pi/tree/9dd90a49711d088b86fdd9b4aea575913a8328/packages/ai) provides provider/model/auth/stream contracts and typed tool schemas.
- [`@earendil-works/pi-agent-core`](https://github.com/earendil-works/pi/tree/9dd90a49711d088b86fdd9b4aea575913a8328/packages/agent) provides the agent loop, validation, tool execution, events, abort, and hooks.
- [`@earendil-works/pi-coding-agent`](https://github.com/earendil-works/pi/tree/9dd90a49711d088b86fdd9b4aea575913a8328/packages/coding-agent) is a coding-agent product with read/bash/edit/write tooling; those tools are not an Aptiloop capability and must not be imported into learning roles.
- Pi states that it has [no built-in permission system](https://github.com/earendil-works/pi/blob/9dd90a49711d088b86fdd9b4aea575913a8328/README.md#L35-L41) for filesystem, process, network, or credentials. App-owned restrictions are mandatory.
- Tool arguments are runtime-validated by Pi, but validation does not authorize the tool or make the result safe.
- Pi has no provider-neutral assistant response-schema contract; tool-constrained sampling does not validate free assistant output. Aptiloop must use strict result tools or provider adapter plus app-side validation.
- The documented durable `AgentHarness` direction is partial/stubbed at this revision. Aptiloop must not design Core Alpha recovery against unimplemented harness hooks/operations.
- [`@earendil-works/pi-session-backend-sqlite-node`](https://github.com/earendil-works/pi/tree/9dd90a49711d088b86fdd9b4aea575913a8328/packages/session-backends/sqlite-node) has a v4 schema that does not migrate old work-in-progress databases and is not transparently interchangeable with coding-agent's concrete JSONL `SessionManager`.

Pi is MIT-licensed at the researched revision; project licensing still requires the separate plan and retention of upstream terms.

## 3. Role capability matrix

| Capability                                            | Course Designer                                             | Tutor           | Evaluator       | Reviewer        |
| ----------------------------------------------------- | ----------------------------------------------------------- | --------------- | --------------- | --------------- |
| Read an application-supplied bounded context capsule  | Allowed                                                     | Allowed         | Allowed         | Allowed         |
| Return a typed draft/proposal/result                  | Allowed                                                     | Allowed         | Allowed         | Allowed         |
| Mutate a draft directly                               | Denied; app applies an explicitly accepted proposal         | Denied          | Denied          | Denied          |
| Publish Course revision                               | Denied                                                      | Denied          | Denied          | Denied          |
| Write learning state/mastery/evidence                 | Denied                                                      | Denied          | Denied          | Denied          |
| Apply learner-code patch                              | Denied                                                      | Denied          | Denied          | Denied          |
| Arbitrary filesystem/shell/network/edit/provider tool | Denied                                                      | Denied          | Denied          | Denied          |
| Invoke a trusted check                                | Denied directly; application may dispatch after user action | Denied directly | Denied directly | Denied directly |

These domain tool names are now the closed implemented baseline registry in `packages/shared/src/provider-hub.ts` and `packages/agent-core/src/typed-tool-host.ts`; role-specific service handlers and full orchestrator cutover remain M6 work.

## 4. Provider resolution and Mock policy

**Approved Core Alpha target:** provider and model resolution is server-owned, explicit, and role-scoped. A request may not bypass policy with a browser-supplied provider/model unless the server validates it against the same approved profile. Authentication failure, unavailable model, policy denial, and transport failure remain explicit terminal states.

There is no silent real-provider-to-Mock fallback. Mock is permitted only for tests, CI, and explicit development selection. It is not production content/runtime evidence and cannot make Settings display a real provider as healthy.

Private data is sent to a real provider only after a separate explicit user action that identifies provider, data classes, scope, and purpose. General consent to “use AI” is not consent to upload private sources, learner history, code, paths, or credentials.

**Implemented baseline:** the orchestrator owns a fixed Mock-only learning profile for Teacher, Reviewer, Interviewer, Curator, and Codex Expert. Browser bodies cannot select provider/model, real-provider failure cannot substitute Mock, and `npm start` launches no sidecar. The Codex/OpenCode adapters remain readable legacy boundaries for later migration but are not learning capabilities.

## 5. Control records

### AI-CTRL-001 — Tool authorization

- **Attack path:** learner/private-source prompt injection causes a non-review provider role to call general file/shell/edit/network tools rooted at the project.
- **Impact:** local mutation, command effects, private-data/credential access, and Learning Kernel compromise.
- **Existing mitigation:** **Implemented baseline.** M1 blocks Codex/OpenCode/Pi for every legacy learning role and preserves only deterministic Mock. The M6 tool host now admits only the closed Aptiloop tool-name registry per role, validates strict arguments/results, and the Pi adapter rejects any tool name not installed by the app. No `pi-coding-agent` or general read/bash/edit/write tool package is installed. This remains foundational until all role handlers/context scopes and adversarial tests are complete.
- **Source fix:** complete role-specific handlers, scope re-resolution, byte/event/deadline budgets, and orchestrator cutover without adding provider-native or general tools.
- **Test:** matrix every role/provider; malicious prompts request shell/file/network/edit actions; assert no such tool is registered/called and repository/attempt hashes remain unchanged.

### AI-CTRL-002 — Typed arguments and result validation

- **Attack path:** model returns unknown fields, wrong IDs, oversized arrays/text, protected answer material, forged evidence, or malformed JSON that the app treats as authoritative.
- **Impact:** state corruption, answer leakage, resource exhaustion, or false review/evaluation.
- **Existing mitigation:** **Implemented baseline.** Existing HTTP/domain boundaries remain strict; the M6 Aptiloop tool host now validates both tool arguments and outputs against app-owned Zod contracts. Free assistant output still has no general schema guarantee and cannot become deterministic evidence.
- **Source fix:** require role-specific result tools or adapter parsing plus application validation; reject unknown/oversized fields, verify server-owned IDs/revision/operation, and never infer trusted evidence from prose.
- **Test:** malformed/unknown/oversized/protected/forged fixtures across every role; no DB/state change; bounded diagnostic only.

### AI-CTRL-003 — Output and event budgets

- **Attack path:** provider emits many small deltas/tool events or an oversized result within timeout.
- **Impact:** memory/CPU/disk exhaustion, slow rendering, huge SQLite/backups, or partial trusted result.
- **Existing mitigation:** **Implemented baseline.** The common Provider Hub runner enforces persisted cumulative input/output/event/tool/deadline budgets, bounded normalized events, and fail-closed cancellation. Invalid or over-budget output cannot become an authoritative review/evaluation result.
- **Source fix:** complete; retain the common runner as the only active role dispatch path.
- **Test:** malicious providers cross UTF-8 output, superseded-delta cumulative output, event, and tool-call thresholds; tests assert cancellation, bounded SSE/DB persistence, and zero trusted result.

### AI-CTRL-004 — Provider selection and explicit failure

- **Attack path:** browser overrides role provider/model, or an unavailable/misconfigured real provider silently becomes Mock.
- **Impact:** policy bypass, unexpected disclosure/cost, false provenance, and invalid production evidence.
- **Existing mitigation:** **Implemented baseline.** Active learning chat, interview, and evidence-only review resolve one exact persisted connection/model through `ProviderHub`, reject AI Off/auth/capability/model/policy/disclosure failures with structured codes, and never substitute another provider/model or Mock. Browser provider/model overrides and flattened role settings are retired; Mock is disabled outside test/development composition.
- **Source fix:** complete for active M6 callers; retain explicit provenance/failure behavior as new roles are added.
- **Test:** forged/unavailable provider/model is rejected; refresh/auth failure does not use ambient/Mock fallback; event and persisted result identify the actual provider/model; Mock is unavailable in production mode.

### AI-CTRL-005 — Reviewer evidence-only/no patches

- **Attack path:** Reviewer obtains local-read, edit/apply, or general-tool authority, or its response directly changes learner files.
- **Impact:** private local-file disclosure, unreviewed mutation, and false completion of the correction loop.
- **Existing mitigation:** **Implemented baseline.** Reviewer receives only the complete immutable evidence capsule after passing freshness gates, resolves through the constrained Hub role, has no local-read/edit/apply/general-tool authority, returns a strictly parsed typed result, and is checked against canonical workspace snapshots before and after. Invalid output cannot persist an authoritative review.
- **Source fix:** complete for the current evidence-only Reviewer; keep all future review inputs capsule-bound and read-only.
- **Test:** malicious event/output/tool cases fail closed; sentinels outside the capsule are absent; the workspace manifest remains unchanged; only canonical advice/result fields persist.

### AI-CTRL-006 — Secret and private-context minimization

- **Attack path:** full environment, raw tool result, local path, private source, or broad learner history enters provider context or persistence without explicit disclosure.
- **Impact:** credential/private-data exposure and long-lived copies at provider or in SQLite/backups.
- **Existing mitigation:** **Implemented baseline.** M1 containment/minimization remains. M6 stores secret-free connection references, immutable hash-scoped disclosure operations/events, and minimized provider-turn provenance without duplicating provider payloads. Chat, interview, and review UI preview the exact external destination/categories/exclusions/byte count and require an immutable one-time approval. Provider capture tests exclude environment and unrelated private-context sentinels.
- **Source fix:** complete for active M6 callers; each future context builder must add its own explicit allowlist, disclosure category, and sentinel coverage before external enablement.
- **Test:** environment and unrelated private-state sentinels are absent from provider create/stream inputs; disclosure hashes/scopes are immutable and one-time; raw provider/tool fields remain absent from SSE and persistence.

### AI-CTRL-007 — Prompt injection cannot alter authority

- **Attack path:** Course Pack, Source Snapshot, retrieved text, Markdown, learner answer, or provider response instructs the model to ignore policy, reveal secrets, invoke tools, publish, or write mastery.
- **Impact:** any downstream effect permitted by an overpowered runtime.
- **Existing mitigation:** **Implemented baseline.** Strict schemas, fixed finite role tools, server-owned transitions, exact disclosure approval, and Provider Hub resolution keep authorization outside prompts. Imported/private content remains untrusted data; no prompt can expand the fixed capability set or select a provider/model.
- **Source fix:** complete for the M6 runtime boundary; future content channels must reuse the same typed role/tool/disclosure seams.
- **Test:** adversarial event/tool/output matrices and strict schemas reject unauthorized tool/state/disclosure behavior; all four role policies exclude arbitrary filesystem, shell, network, edit, and write tools.

## 6. Session and persistence rules

**Implemented baseline:** the browser receives an app-owned opaque turn UUID and an event allowlist, never provider session/protocol IDs or raw tool payload. `LearningRepository.addMessage` accepts no tool/raw fields and always stores `tool_events_json='[]'` and `raw_event_json=NULL`; new review writes store `raw_response=NULL`. The [read-only M1 inventory](../audits/2026-08-08-m1-safety-boundary-inventory.md) observed zero logical non-empty raw/tool rows and added no cleanup migration. That logical result does not prove sensitive bytes absent from free pages, WAL/SHM, snapshots, or external copies.

**Approved Core Alpha target:** Aptiloop session identity remains application-owned. A provider `sessionId` is not learner identity or durable Course/session ownership. Persist only the minimum normalized transcript/provenance/audit envelope required by the product; never raw provider protocol, credentials, or general tool arguments/results.

Durability must use an Aptiloop-owned integration proven against the chosen Pi APIs. Do not claim the partial AgentHarness or the separate SQLite SessionRepo provides end-to-end recovery for coding-agent sessions. Any migration must inventory existing JSONL/WIP SQLite data, back it up, and prove replay before cutover.

## 7. Approval gates

A real provider/role is not Core Alpha-approved until:

1. deny-by-default role/tool matrix passes for that exact adapter/runtime version;
2. auth/provider/model resolution and failure are explicit with no Mock fallback;
3. environment and context sentinel tests pass;
4. cumulative budgets and typed result validation fail closed;
5. private disclosure requires explicit scoped user action;
6. persisted events are minimal and bounded;
7. Reviewer cannot patch or mutate; and
8. a real authenticated smoke records exact runtime/provider/model, terminal event, bounded meaningful result, cancellation/cleanup, and persistence behavior.

Mock/unit tests cannot substitute for the last gate.
