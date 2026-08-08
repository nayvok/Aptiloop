# AI Runtime and Tool Boundaries

**Document status:** Approved Core Alpha target with Implemented baseline findings. Pi integration and the final role/tool surface are not claimed as implemented.

## 1. Ownership boundary

Aptiloop owns Course/learner/session identity, roles, prompts, authorization, typed tools, result validation, persistence, budgets, and every effect on learning state or local resources. Pi is only the model/provider/runtime seam behind those controls.

Course Designer, Tutor, Evaluator, and Reviewer are Aptiloop roles; they are not Pi permission classes. The deterministic Learning Kernel alone owns progression, evidence acceptance, adaptation, and mastery. AI may propose content or return bounded analysis, but it cannot publish a revision, apply a patch, execute a command, write mastery, or decide that evidence exists.

**Approved Core Alpha target:** no AI receives arbitrary filesystem, shell, process, network, HTTP, edit, patch, plugin, secret, provider-RPC, or database tools. Every effect is an Aptiloop-owned typed tool with strict input/output schema, per-role allowlist, server-side authorization, bounded result, audit metadata, and deterministic application semantics.

Reviewer is read-only and has no patch/apply authority. A review is advice/evidence for the application; it does not mutate learner work.

## 2. Pi evidence and constraints

The runtime research baseline is official `earendil-works/pi` commit [`9dd90a49711d088b86fdd9b4aea575913a8328`](https://github.com/earendil-works/pi/tree/9dd90a49711d088b86fdd9b4aea575913a8328), package version 0.84.1:

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

| Capability | Course Designer | Tutor | Evaluator | Reviewer |
| --- | --- | --- | --- | --- |
| Read an application-supplied bounded context capsule | Allowed | Allowed | Allowed | Allowed |
| Return a typed draft/proposal/result | Allowed | Allowed | Allowed | Allowed |
| Mutate a draft directly | Denied; app applies an explicitly accepted proposal | Denied | Denied | Denied |
| Publish Course revision | Denied | Denied | Denied | Denied |
| Write learning state/mastery/evidence | Denied | Denied | Denied | Denied |
| Apply learner-code patch | Denied | Denied | Denied | Denied |
| Arbitrary filesystem/shell/network/edit/provider tool | Denied | Denied | Denied | Denied |
| Invoke a trusted check | Denied directly; application may dispatch after user action | Denied directly | Denied directly | Denied directly |

Tools should describe domain operations, not infrastructure. Examples are bounded requests such as `propose_course_revision`, `propose_tutor_turn`, `submit_evaluation_result`, and `submit_review_result`. These names do not imply current implementation.

## 4. Provider resolution and Mock policy

**Approved Core Alpha target:** provider and model resolution is server-owned, explicit, and role-scoped. A request may not bypass policy with a browser-supplied provider/model unless the server validates it against the same approved profile. Authentication failure, unavailable model, policy denial, and transport failure remain explicit terminal states.

There is no silent real-provider-to-Mock fallback. Mock is permitted only for tests, CI, and explicit development selection. It is not production content/runtime evidence and cannot make Settings display a real provider as healthy.

Private data is sent to a real provider only after a separate explicit user action that identifies provider, data classes, scope, and purpose. General consent to “use AI” is not consent to upload private sources, learner history, code, paths, or credentials.

## 5. Control records

### AI-CTRL-001 — Tool authorization

- **Attack path:** learner/private-source prompt injection causes a non-review provider role to call general file/shell/edit/network tools rooted at the project.
- **Impact:** local mutation, command effects, private-data/credential access, and Learning Kernel compromise.
- **Existing mitigation:** Implemented baseline browser API exposes no direct arbitrary command/apply route; Reviewer alone has read-only/deny-write provider policies and a diff invariant. Non-review Codex/OpenCode authority remains High finding SEC-AI-001.
- **Source fix:** construct every role from an Aptiloop-owned deny-by-default tool registry; do not import coding-agent tools; adapter/provider settings must disable built-ins; only strict domain tools are admitted.
- **Test:** matrix every role/provider; malicious prompts request shell/file/network/edit actions; assert no such tool is registered/called and repository/attempt hashes remain unchanged.

### AI-CTRL-002 — Typed arguments and result validation

- **Attack path:** model returns unknown fields, wrong IDs, oversized arrays/text, protected answer material, forged evidence, or malformed JSON that the app treats as authoritative.
- **Impact:** state corruption, answer leakage, resource exhaustion, or false review/evaluation.
- **Existing mitigation:** Implemented baseline uses strict Zod at HTTP/domain boundaries and structured review validation; Pi validates typed tool arguments. Free assistant output has no general schema guarantee.
- **Source fix:** require role-specific result tools or adapter parsing plus application validation; reject unknown/oversized fields, verify server-owned IDs/revision/operation, and never infer trusted evidence from prose.
- **Test:** malformed/unknown/oversized/protected/forged fixtures across every role; no DB/state change; bounded diagnostic only.

### AI-CTRL-003 — Output and event budgets

- **Attack path:** provider emits many small deltas/tool events or an oversized result within timeout.
- **Impact:** memory/CPU/disk exhaustion, slow rendering, huge SQLite/backups, or partial trusted result.
- **Existing mitigation:** Implemented baseline has input limits, provider deadlines, and some per-item/process limits, but no complete per-turn cumulative budget (SEC-AI-003).
- **Source fix:** common byte/event/tool/array/string/persistence/render budgets with bounded buffers and fail-closed abort; no partial review/evaluation is trusted.
- **Test:** malicious providers cross each cumulative threshold; assert abort, cleanup, bounded SSE/DB, and zero trusted result.

### AI-CTRL-004 — Provider selection and explicit failure

- **Attack path:** browser overrides role provider/model, or an unavailable/misconfigured real provider silently becomes Mock.
- **Impact:** policy bypass, unexpected disclosure/cost, false provenance, and invalid production evidence.
- **Existing mitigation:** Implemented baseline has provider status/model discovery and no automatic external-to-Mock turn fallback; current browser agent stream can supply provider/model overrides.
- **Source fix:** central server Provider Hub resolves role/profile/model and validates any user selection; persist explicit provenance; return distinct unavailable/auth/policy/transport failure. Mock requires explicit dev/test configuration.
- **Test:** forged/unavailable provider/model is rejected; refresh/auth failure does not use ambient/Mock fallback; event and persisted result identify actual provider/model; Mock is unavailable in production mode.

### AI-CTRL-005 — Reviewer read-only/no patches

- **Attack path:** Reviewer obtains edit/apply/tool authority or its response directly changes learner files.
- **Impact:** unreviewed mutation and false completion of the correction loop.
- **Existing mitigation:** Implemented baseline Codex Reviewer is read-only/network-off, OpenCode Reviewer denies mutation tools, no apply route exists, and orchestrator checks the diff before/after.
- **Source fix:** preserve these invariants in Pi role construction; pass only serialized bounded evidence; accept only typed review result; never expose patch/apply or filesystem handles.
- **Test:** reviewer requests tools/returns patch-shaped output/attempts mutation; no tool is available, diff unchanged, response remains advice, and invalid output cannot approve.

### AI-CTRL-006 — Secret and private-context minimization

- **Attack path:** full environment, raw tool result, local path, private source, or broad learner history enters provider context or persistence without explicit disclosure.
- **Impact:** credential/private-data exposure and long-lived copies at provider or in SQLite/backups.
- **Existing mitigation:** Implemented baseline client SSE minimizes events; Codex redacts some output; provider credentials are intended to remain outside SQLite. Codex environment inheritance and OpenCode raw tool persistence remain High findings.
- **Source fix:** minimal child environment, zero general tools, context builder with explicit field allowlist/privacy labels, pre-persistence minimization, and point-of-disclosure user approval for private data.
- **Test:** sentinel secrets/private fields in environment, tools, sources, paths, and history; assert absence from provider request unless explicitly selected, and absence from logs/SSE/DB/WAL/backup/export.

### AI-CTRL-007 — Prompt injection cannot alter authority

- **Attack path:** Course Pack, Source Snapshot, retrieved text, Markdown, learner answer, or provider response instructs the model to ignore policy, reveal secrets, invoke tools, publish, or write mastery.
- **Impact:** any downstream effect permitted by an overpowered runtime.
- **Existing mitigation:** strict application schemas and server-owned learning transitions limit some effects, but current non-review provider tools expand authority.
- **Source fix:** treat all content as data, keep authorization outside prompts, deny general tools, scope context, validate every domain result, and require independent explicit user/app gates for draft apply or provider disclosure.
- **Test:** injection corpus through every content channel and role; capability set never changes; no unauthorized tool/state/publish/disclosure action occurs.

## 6. Session and persistence rules

Aptiloop session identity is application-owned. A provider `sessionId` is not learner identity or durable Course/session ownership. Persist only the minimum normalized transcript/provenance/audit envelope required by the product; never raw provider protocol, credentials, or general tool arguments/results.

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
