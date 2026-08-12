# Aptiloop Differential Security Review

**Review date:** 2026-08-12  
**Baseline:** `f05971cf6468a9e9faa95a61ff304daac32d5cfb` (`docs: align design guidance with compact compositions`)  
**Implementation commit:** `fd8155f` (`feat(web): harden Core Alpha learning UX`)
**Reviewed state:** final observed worktree on `codex/core-alpha-ui-ux-docs` before the documentation-only commit  
**Status:** Review artifact; not implementation or release evidence

## Executive Summary

| Severity | Active findings |
| -------- | --------------: |
| CRITICAL |               0 |
| HIGH     |               0 |
| MEDIUM   |               0 |
| LOW      |               0 |

**Overall risk:** LOW  
**Recommendation:** ACCEPT the reviewed security delta, subject to the limitations and full release gates listed below.

The final snapshot contains no active security finding in the requested boundaries. Four blocking or merge-significant issues discovered during the review were fixed and re-reviewed before this report was finalized:

1. Course Designer displayed a protected-answer exclusion while its provider payload and `course.readDraftSlice` could contain protected answer material. The current code uses one recursively sanitized, allowlisted authoring projection for disclosure, dispatch, and draft-read tools. Exact-byte marker tests now prove the disclosure SHA-256 and byte count describe the bytes sent externally.
2. New Exercise and Studio Stop controls initially lacked complete server-side cancellation fences. The current code fences provider entry and terminal completion, cancels provider sessions, removes un-attributed Course Designer proposals, keeps cancelled workflows retryable, and commits reviewer transcript, evidence, and terminal provider provenance atomically.
3. The provider sign-in prompt initially allowed a browser-supplied GitHub Enterprise domain to become Pi network authority. Nonblank enterprise answers now fail closed before Pi; only the app-owned `github.com` default is reachable in Core Alpha.
4. Provider sign-in status initially copied raw Pi prompts, events, links, and error text into the browser. The current boundary uses a strict shared DTO, app-owned prompt/event/error registries, pinned HTTPS endpoints, and runtime parsing on both server and browser.

The previously reported generic Chat recovery findings are not part of the current tree. The persistent recovery repository, DTOs, endpoint, and durable recovery claims were rolled back. Generic Chat remains an intentionally in-memory browser flow over the existing immutable disclosure ledger.

### Key metrics

- 83 changed or untracked application/repository files, excluding this report: 68 tracked and 15 untracked.
- Tracked delta: +7,393 / -1,098 lines; untracked files add approximately 1,626 lines.
- Source scale: 322 TypeScript/JavaScript files under `apps` and `packages`; a SURGICAL review strategy was used.
- Requested HIGH-risk coverage: shared/database Chat recovery boundaries, orchestrator/provider cancellation, Studio disclosure payloads and tools, Course Pack commit reconciliation, curriculum/learning projections, and browser disclosure/error callers.
- Focused final verification: the previously recorded 6 orchestrator files / 93 tests and 5 web files / 89 tests passed, as did 6 database tests, 14 Exercise Core tests, and 8 Agent Core tests. The final provider-login slice additionally passed 31 orchestrator tests, 6 web tests, and 16 shared-contract tests. Shared, orchestrator, database, and web typechecks passed.
- Final repository gates: `npm run verify` passed, and `npm run test:e2e` passed 8/8 after the route-title consolidation fix.

## What Changed

The reviewed range contains no commit after the baseline; it is one shared uncommitted worktree snapshot.

```text
f05971c (baseline) -> uncommitted UI/runtime hardening -> reviewed final snapshot
```

| Area                                        | Representative files                                                                                                 | Risk   | Final assessment                                                    |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------- |
| Exercise and provider cancellation          | `apps/orchestrator/src/app.ts`, `provider-runtime.ts`, `apps/web/components/exercise-client.tsx`                     | HIGH   | Server fences and durable-state cleanup verified                    |
| Course Designer disclosure and cancellation | `apps/orchestrator/src/course-designer.ts`, `curriculum-editor-client.tsx`                                           | HIGH   | Protected data is projected out; cancellation stays retryable       |
| Course Pack commit reconciliation           | `apps/orchestrator/src/course-packs.ts`, `packages/database/src/course-pack-repository.ts`, `course-pack-client.tsx` | HIGH   | Exact terminal replay is transactionally bound and fail-closed      |
| Provider sign-in prompt/status boundary     | `packages/shared/src/provider-hub.ts`, `provider-management.ts`, `provider-connection-manager.tsx`                   | HIGH   | Network authority and browser data are app-owned and fail-closed    |
| Generic Chat disclosure/error UX            | `apps/orchestrator/src/app.ts`, `apps/web/components/agent-chat.tsx`                                                 | MEDIUM | In-memory only; safe typed diagnostics; no durable recovery feature |
| Safe failure presentation                   | `apps/web/lib/failure-presentation.ts`, `query-state.tsx`, route boundaries                                          | MEDIUM | Raw messages are not rendered as technical diagnostics              |
| Curriculum and completed-path projection    | `curriculum-editor.ts`, `learning-v2.ts`, `unit-progression.ts`                                                      | MEDIUM | No authority or protected-data regression found                     |
| Remaining UI, localization, tests, and docs | `apps/web`, `docs`                                                                                                   | LOW    | Surface-scanned; no new security authority found                    |

## Active Findings

No active finding remained in the final reviewed snapshot.

## Findings Resolved During Review

### Resolved HIGH: false protected-answer exclusion in Course Designer

**Original boundary:** `apps/orchestrator/src/course-designer.ts` and `apps/web/components/curriculum-editor-client.tsx`  
**Final implementation:** `apps/orchestrator/src/course-designer.ts:L437`, `:L464`, `:L478`, `:L503`, `:L541`, and `:L984`  
**Adversarial test:** `apps/orchestrator/test/course-designer.integration.test.ts:L491`

The disclosure UI now tells the truth about the external payload. `providerSafeAuthoringValue` recursively normalizes key spellings and removes protected answer, grading, rubric, misconception, solution, and equivalent nested keys. `providerSafeAuthoringGraph` projects only explicit graph/unit fields. `designerPayload` and `course.readDraftSlice` both reuse that projection.

The marker test stores protected values in unit `referenceAnswer`, question `correctOptionIds`, `evaluationPoints`, `commonMistakes`, unit misconceptions, and nested alternate spellings. It verifies all of the following:

- the captured external stream message contains legitimate authoring structure but none of the protected keys or markers;
- disclosure `byteCount` equals the UTF-8 byte length of that exact message;
- disclosure `payloadSha256` equals the SHA-256 of that exact message;
- `course.readDraftSlice` for both `all` and `activities` returns the same protected-data-safe view.

**Historical context:** the unsanitized serializer and exclusion text predated `f05971c` in `e548d96`. The current UI delta made the false assertion explicit at consent time, so the inherited boundary issue was treated as blocking and fixed in the touched surface.

### Resolved MEDIUM: Exercise and Studio Stop was not end-to-end fenced

**Final provider fence:** `apps/orchestrator/src/provider-runtime.ts:L413-L580`  
**Trusted check fences:** `apps/orchestrator/src/app.ts:L1467-L1538`  
**Reviewer commit boundary:** `apps/orchestrator/src/app.ts:L1685-L1783` and `:L2747-L2947`  
**Course Designer cleanup:** `apps/orchestrator/src/course-designer.ts:L1145-L1251` and `:L1910-L2015`

The final implementation checks cancellation before the provider sees a payload, on every provider event, and after the provider iterator returns. Trusted checks recheck the request signal after execution and inside the result/artifact transaction. Reviewer completion persists the canonical assistant result, review row, evidence bundle, and terminal provider provenance in one transaction; cancellation leaves no completed assistant result or authoritative review. Provider sessions are cancelled for pre-stream and post-terminal windows.

Course Designer cancellation deletes the exact un-attributed proposal by version, provider operation, and authoring operation, covering both typed-tool and fallback proposal paths. The workflow remains in `CURRICULUM_PROPOSAL`, provider provenance becomes `cancelled`, and the provider session is cancelled. The route returns stable cancellation JSON rather than a raw `AbortError`.

Deterministic tests cover cancellation during provider session creation, provider-stream cancellation, completed-provider/pre-commit cancellation, trusted-check post-run/pre-persistence cancellation, absence of authoritative artifacts/reviews/proposals, provider-session cancellation, terminal provenance, and preserved retryable workflow state.

### Resolved HIGH: browser-controlled GitHub Enterprise authority enabled provider SSRF

**Original boundary:** `apps/orchestrator/src/provider-management.ts` and the provider-login answer route in `apps/orchestrator/src/app.ts`  
**Final implementation:** `apps/orchestrator/src/provider-management.ts:L374-L398` and `:L601-L744`  
**Adversarial test:** `apps/orchestrator/test/provider-login-boundary.test.ts:L15-L324`

The initial sign-in UX forwarded an arbitrary nonblank GitHub Enterprise hostname from the browser to Pi. Pi constructs OAuth and subsequent API URLs from that value, so hostname syntax checks could not prevent DNS rebinding, redirects, or alternative IPv4 spellings such as `127.1`, which Node canonicalizes to loopback. This made a browser mutation a network-authority selector and violated the Core Alpha ID-only mutation boundary.

The final implementation recognizes only the exact Pi GitHub prompt and accepts only an empty answer. Every nonblank value is rejected before it reaches Pi, so GitHub sign-in resolves to the app-owned `github.com` default. Provider-returned URLs are separately bound to an exact catalog/purpose registry:

- OpenAI authorization: `https://auth.openai.com/oauth/authorize`;
- OpenAI device login: `https://auth.openai.com/codex/device`;
- Anthropic authorization: `https://claude.ai/oauth/authorize`;
- GitHub device login: `https://github.com/login/device`.

The registry rejects alternate hosts, wrong paths, user information, ports, fragments, non-HTTPS schemes, and query strings on device URLs. The shared browser schema independently enforces the same finite endpoints.

GitHub Enterprise sign-in is deliberately unsupported for Core Alpha. Future support would require an approved app-owned endpoint profile plus resolver/connect-time private-address checks, redirect revalidation, and DNS-rebinding controls; string validation alone is insufficient.

### Resolved MEDIUM: raw provider sign-in data crossed into the browser

**Shared contract:** `packages/shared/src/provider-hub.ts:L103-L242`  
**Server normalization:** `apps/orchestrator/src/provider-management.ts:L343-L385` and `:L601-L744`  
**Browser parsing:** `apps/web/components/provider-connection-manager.tsx:L52-L59` and `:L252-L260`

The initial login-status path retained raw Pi prompt messages, progress/info text, instructions, links, and `Error.message`. Truncation and hiding text during rendering did not prevent provider-controlled values from entering the HTTP response and React Query cache.

The final boundary maps provider interactions into a strict app-owned union:

- prompt kinds and select options are finite Aptiloop identifiers;
- progress events contain no provider message;
- sign-in links use only the pinned endpoints above;
- device codes are trimmed and bounded;
- failed status carries only the literal `provider-sign-in-failed`;
- unknown properties and invalid status/prompt/error combinations fail closed.

`ProviderManagementService.loginStatus` runtime-parses the assembled response, and the browser fetches `unknown` then parses it again before storing or rendering it. Hostile-response tests prove raw provider/credential text and unapproved links do not reach the browser UI.

## Rolled-Back Generic Chat Recovery

The earlier review snapshot contained a persistent generic Chat pending-disclosure recovery layer and produced three MEDIUM and two LOW findings. The final worktree contains none of that feature:

- `packages/database/src/agent-chat-recovery-repository.ts` does not exist;
- `packages/shared/src/dto.ts` and `packages/database/src/index.ts` have no relevant delta;
- no `AgentChatRecovery*`, `AgentChatPendingDisclosure`, `chat-operation`, `agentChatRecovery`, or `/api/agent/disclosures/pending` production symbol remains;
- no documentation claims durable generic Chat disclosure recovery.

Therefore the earlier create/save ambiguity, approved-state recovery gap, divergent role mapper, recovery plaintext retention, and stale-ID deletion findings are absent rather than deferred. Current generic Chat prepares, approves/cancels, and dispatches through the baseline Provider Hub ledger while browser pending state remains in memory.

## Course Pack Reconciliation

`POST /api/course-packs/validations/:validationId/commit` now attempts exact terminal reconciliation before consulting process-local staging (`apps/orchestrator/src/course-packs.ts:L242`). The repository binds the unique operation ID to validation ID, action, content hash, manifest/result revisions, and source-bytes hash (`packages/database/src/course-pack-repository.ts:L148-L298`, `:L1181-L1273`). The lifecycle event is appended in the same SQLite transaction as install or open-as-draft.

Security properties verified:

- post-commit response loss can replay only the exact stored result after staging removal;
- any validation/action/hash mismatch returns conflict rather than reusing a terminal operation;
- pre-commit failure has no terminal record and claimed staging is not resurrected;
- immutable manifest, collision, primary-locale, branch-occupancy, provenance, quarantine, and no-deletion uninstall controls remain intact;
- concurrent mixed actions permit one claimed staging winner and fail closed for the other.

The process-local pre-commit limitation remains intentional: restart before commit requires explicit file reselection, and unknown temporary staging is never trusted.

## Error and Disclosure Presentation

`presentFailure` accepts only allowlisted provider message keys and an explicit `diagnosticId`; untyped exceptions and raw API error strings fall back to operation-specific localized copy. `SafeQueryError` renders technical details only when such a diagnostic ID exists. Agent Chat separately bounds technical details to HTTP status, diagnostic ID, and typed failure code, filters control characters, and never renders raw provider error messages.

Tests prove hostile local paths, provider secrets, unknown message keys, and diagnostic-free raw messages do not reach the UI. React rendering and the Markdown component do not enable raw HTML, and tool summaries expose only allowlisted tool name/status rather than call IDs, arguments, or outputs.

## Blast Radius Analysis

| Boundary                            | Direct consumers / reach                                 | Security priority | Evidence                                                                  |
| ----------------------------------- | -------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------- |
| `ProviderRuntime.stream`            | Chat, Review, Course Designer and other provider callers | P1                | pre-entry/event/post-terminal fences; shared provider cancellation tests  |
| Provider sign-in status/answer      | Settings browser, orchestrator, Pi OAuth adapters        | P1                | blank-only GitHub authority; strict DTO and pinned URL registry           |
| Exercise check/review routes        | Exercise browser plus loopback local API                 | P1                | exact attempt/check IDs, isolated workspace, signal and transaction tests |
| Course Designer payload/tools       | external provider disclosure and constrained Pi tools    | P1                | exact-byte marker test and strict tool allowlist                          |
| Course Pack repository/commit route | intake UI plus local API                                 | P1                | transaction, exact replay, collision and competing-claim tests            |
| `presentFailure` / `SafeQueryError` | multiple Course/Session/Studio/Settings callers          | P2                | safe-copy and hostile-detail tests                                        |
| Curriculum/path projection          | Studio list and learner Course path                      | P2                | focused integration and pure Learning Core tests                          |

The numerically small repository/provider caller sets have high priority because they cross SQLite durability, protected evaluation material, child-process/provider cancellation, and explicit external-disclosure consent.

## Positive Security Evidence

- The loopback HTTP boundary retains exact Host/authority, Origin, local-client marker, JSON content-type, trust-proxy, and `no-store` enforcement.
- Provider/model resolution remains server-owned. Unavailable real providers do not silently fall back to Mock.
- Provider login prompts, events, failure codes, and browser-rendered links are normalized into a strict shared Aptiloop DTO. Nonblank GitHub Enterprise authority fails closed; raw Pi strings are discarded.
- Provider Hub still validates disclosure status, expiry, role, connection, provider, model, payload hash, and exact entity scope; approval is consumed once with provider-turn provenance.
- Course Designer has only Aptiloop-owned typed read/propose tools. It cannot apply or publish. Proposal confirmation, Apply with draft-hash checks, validation, change review, Preview, and manual Publish remain separate.
- Exercise check requests contain only app-owned check IDs and attempt identity. The runner retains canonical containment, `shell: false`, minimal environment, timeout/output caps, already-aborted rejection, cancellation, and process-tree cleanup.
- Reviewer input remains bounded, complete, hash-bound evidence and reviewer output cannot directly alter deterministic mastery/progression.
- Course Pack input remains bounded strict JSON with duplicate-key, authority-field, secret-shaped value, local-path, unsafe-URL, graph, hash, provenance, and schema-version rejection.
- Curriculum list metadata only adds branch lineage fields. Completed lesson projection replays the exact session/revision Learning Kernel facts and preserves completed optional work rather than granting progression from model output.
- The Studio header no longer claims an edited form is Saved before explicit submission; the browser test asserts the absence of that false status.

## Test Coverage Analysis

### Final focused verification

| Command / suite                                                                                                | Result                    |
| -------------------------------------------------------------------------------------------------------------- | ------------------------- |
| Orchestrator: practice boundaries, Course Designer, Course Packs, agent policy, curriculum editor, learning v2 | 6 files / 93 tests passed |
| Web: Exercise, Curriculum Editor, Agent Chat, Course Pack client, safe UI state                                | 5 files / 89 tests passed |
| Database Course Pack integration                                                                               | 6 tests passed            |
| Exercise Core process runner + execution fabric                                                                | 2 files / 14 tests passed |
| Agent Core Provider Hub                                                                                        | 8 tests passed            |
| Orchestrator provider-login boundary                                                                           | 31 tests passed           |
| Web provider connection/login boundary                                                                         | 6 tests passed            |
| Shared provider-login and general contracts                                                                    | 16 tests passed           |
| `npm run typecheck --workspace @aptiloop/shared`                                                               | Passed                    |
| `npm run typecheck --workspace @aptiloop/orchestrator`                                                         | Passed                    |
| `npm run typecheck --workspace @aptiloop/database`                                                             | Passed                    |
| `npm run typecheck --workspace @aptiloop/web`                                                                  | Passed                    |
| `git diff --check f05971c`                                                                                     | Passed                    |

### Not established by this review

- No authenticated live external-provider smoke was performed. Provider success is not inferred from mocks or health metadata.
- Authorization-link query keys and values are still trusted to pinned Pi `0.84.1`; Aptiloop pins scheme, host, path, and fragment policy but does not yet validate each provider's complete OAuth query registry. This is defense-in-depth against dependency drift, not a browser-input path in the current design.
- Pi's authenticated GitHub Copilot token flow can derive a later model endpoint from provider response metadata. That inherited trusted-provider assumption predates this delta and was not exercised by a real-provider smoke.
- Provider-management routes still use the inherited `safeProviderManagementMessage` helper, which can expose an underlying credential-store filesystem error and absolute local path. This predates `f05971c`; no credential body exposure was found, but the path-disclosure seam should be normalized to app-owned error codes.
- No full `npm run verify`, `npm run test:e2e`, dependency audit, supply-chain artifact inspection, or production database migration was run as part of this review.
- No abrupt child-process kill harness was used for provider cancellation or Course Pack response-loss recovery; deterministic in-process gates exercise the critical commit windows.
- Pre-commit Course Pack staging is intentionally process-local and still has no startup orphan-directory sweep.
- The full UI/layout delta was surface-scanned rather than exhaustively audited line by line.

## Recommendations

### Release gates

- [ ] Run `npm run verify` on the final settled worktree.
- [ ] Run `npm run test:e2e`; do not infer E2E green from `verify`.
- [ ] If external AI is release-critical, perform a smoke with the exact authenticated provider/model and observe an actual request while using protected-answer sentinels.
- [ ] Preserve the exact-byte Course Designer disclosure/tool marker test and cancellation fault-window tests as mandatory regressions.

### Follow-up hardening

- [ ] Add an abrupt process-termination test for a Course Pack commit after SQLite commit but before HTTP response.
- [ ] Add a bounded startup cleanup design for Aptiloop-owned Course Pack staging directories if orphan retention becomes operationally material; never resume unknown files.
- [ ] Keep new failure surfaces on typed message keys and diagnostic IDs rather than raw exception text.
- [ ] Replace inherited provider-management exception echoing with app-owned error codes and add an `EACCES`/`EPERM` regression test proving credential-store paths and usernames stay out of HTTP responses and logs.
- [ ] Pin the expected OAuth query-key/value registry per subscription provider, including bounded single-use state/challenge parameters and rejection of duplicate or unknown keys.
- [ ] Before any future GitHub Enterprise support, define an app-owned endpoint profile with connect-time DNS/IP enforcement and redirect revalidation; do not restore browser-supplied network authority.

## Analysis Methodology

**Strategy:** SURGICAL, selected from repository size and the requested high-risk boundaries.

The review followed the differential-review methodology and included:

- baseline/current diff classification and final-snapshot recount;
- complete review of requested boundary files and direct callers;
- `git log`, `git blame`, and string-history checks for Provider Hub, Course Designer, Course Pack, and learning behavior;
- caller and one-hop blast-radius mapping with `rg`;
- explicit local-attacker and ordinary crash/cancellation scenarios;
- SQL transaction, idempotency, exact-binding, append-only, expiry, race, and failure-state analysis;
- protected-data marker tracing from SQLite authoring rows through disclosure, provider dispatch, and typed tools;
- direct inspection of Pi `0.84.1` OAuth URL construction and adversarial testing of alternative IPv4 spellings, DNS authority, raw login events, prompt drift, and unapproved sign-in links;
- focused permitted/rejected/failure-window tests, typechecks, formatting checks, and diff whitespace validation.

The shared worktree changed during the review because fixes were applied by parallel agents. This report describes the final observed snapshot and intentionally excludes transient/retracted findings once their code was removed or their fix was independently verified.

**Confidence:** HIGH for the requested Provider/Exercise/Studio/Course Pack/Chat boundaries and for the absence of the rolled-back generic Chat recovery layer; MEDIUM for the broad remaining presentation delta because it was surface-scanned rather than exhaustively audited.

## Appendix A: Final Finding Reference

| ID         | Final state              | Severity when found | Title                                                                                  |
| ---------- | ------------------------ | ------------------- | -------------------------------------------------------------------------------------- |
| APT-DR-001 | Resolved                 | HIGH                | Course Designer disclosed protected answer material while claiming exclusion           |
| APT-DR-002 | Resolved                 | MEDIUM              | Exercise/Studio Stop lacked complete server-side cancellation and durable-state fences |
| APT-DR-003 | Rolled back with feature | MEDIUM              | Generic Chat disclosure creation/recovery ambiguity                                    |
| APT-DR-004 | Rolled back with feature | MEDIUM              | Approved generic Chat disclosure was not restart-recoverable                           |
| APT-DR-005 | Rolled back with feature | MEDIUM              | Divergent generic Chat `course-designer` role mapping                                  |
| APT-DR-006 | Rolled back with feature | LOW                 | Generic Chat recovery plaintext cleanup gap                                            |
| APT-DR-007 | Rolled back with feature | LOW                 | Reused generic Chat operation ID stale deletion                                        |
| APT-DR-008 | Resolved                 | HIGH                | Browser-supplied GitHub Enterprise host became provider network authority              |
| APT-DR-009 | Resolved                 | MEDIUM              | Raw provider sign-in prompts, events, links, and errors crossed into browser state     |

No item in this table is an active finding in the final reviewed worktree.
