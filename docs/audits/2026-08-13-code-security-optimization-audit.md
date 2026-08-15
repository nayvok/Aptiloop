# Code, Security, and Optimization Differential Audit

**Document status:** Fixes and local evidence explicitly recorded as completed below are an **Implemented baseline** in the reviewed working tree. Open release and architecture work remains an **Approved Core Alpha target** unless a section says **Proposed pending owner approval**.

**Review date:** 2026-08-13

**Git baseline:** `7a3e5dc` (`test: stabilize cold settings navigation`)

**Reviewed state:** shared uncommitted working tree after bounded differential-review fixes

**Recommendation:** **APPROVE** the bounded reviewed working-tree change; the open Core Alpha architecture and release targets below remain unresolved, so this is not release acceptance

## Executive summary

The audit reviewed correctness, security boundaries, prompt and agent scope, architecture, duplication, dead material, documentation, and maintainability. The differential security pass found three merge-significant regressions in the working changes. All three were reproduced, fixed, and re-reviewed before this report was written:

1. invoked transaction callbacks that disguised a Promise could resume after rollback and write outside the transaction;
2. Course Pack secret heuristics rejected ordinary authentication-course prose;
3. stricter Learning Kernel validation initially changed or rejected historical `baseline-1` replay under the unchanged model version.

No remaining reproducible regression was found in the reviewed database transaction conversions, Course lifecycle selection repair, Course Pack graph/secret validation, Learning Kernel optimization, or final Adaptation Branch draft/session binding after those fixes and independent re-review. The working tree still has open architecture and release risks listed below; this report does not claim Core Alpha release acceptance.

| State                            | CRITICAL | HIGH | MEDIUM | LOW |
| -------------------------------- | -------: | ---: | -----: | --: |
| Active differential regressions  |        0 |    0 |      0 |   0 |
| Resolved during this review      |        0 |    4 |      4 |   0 |
| Open residuals / follow-up risks |        0 |    1 |      4 |   1 |

The severity table distinguishes regressions introduced by the reviewed delta from pre-existing or deliberately deferred risks. A residual count is not a claim that every item is independently exploitable; it expresses release or architectural importance.

## Scope and methodology

The final audit used a FOCUSED/SURGICAL strategy appropriate to a large TypeScript workspace:

- 128 final working-tree paths (112 tracked changes or deletions and 16 untracked additions) were triaged; the differential review classified 426 repository files as analyzable source, test, configuration, or documentation material;
- security-critical and state-changing code received line-by-line comparison against `HEAD`;
- removed transaction and validation behavior was inspected with `git show`, `git log -S`, and `git blame`;
- blast radius was measured with repository-wide caller searches;
- adversarial probes covered shared `DatabaseSync` interleaving, async/thenable callbacks, nested savepoints, rollback injection, Course uninstall selection, Course Pack cycles and credential-shaped values, Kernel correction/evidence replay, and revision-incompatible Adaptation Branch/session pinning;
- focused tests were run after each bounded fix, followed by the repository-wide verification gate and a separate Chromium E2E run on the final combined tree.

The history review found the base synchronous transaction helper in `1e84636`, nested savepoint and async transaction behavior in the M1–M6 foundation history, and Learning Kernel model/hash persistence in `8c571aa`. No removed CVE-specific or security-fix commit was reintroduced in the reviewed scope.

## Implemented changes and resolved findings

### Transaction integrity and shared SQLite safety

**Implemented baseline.** Faux-async repository methods and HTTP mutations were converted to honest synchronous persistence, with request parsing and provider work kept outside database transactions. The reviewed tree has 33 production `withTransaction` call sites and no production `withAsyncTransaction` reference. Twenty-six changed or directly affected calls were traced in the database repositories and the Course Designer, Curriculum Editor, Personal Adaptations, and versioned learning routes. No transaction callback contains `await` or a known Promise-returning call.

Nested transactions use savepoints. Synchronous success, nested rollback, outer rollback, and partial Course Designer compilation failure are covered by tests. The Course Designer proposal apply loop, curriculum mutation plus graph validation, Personal Adaptation cloning/publication, and versioned evidence/progress writes now commit atomically within their respective application operations.

#### Resolved MEDIUM: disguised Promise continuation escaped rollback

The initial runtime guard rejected direct `async` functions before invocation, but a non-`async` wrapper returning an async IIFE could run, trigger rollback, then resume and write on the still-open shared connection. The probe observed no row immediately after rollback and a new row after the gate resumed.

The final helper fail-stops this impossible-to-cancel misuse: it unwinds the active transaction or savepoint when possible, poisons and closes the shared connection, attaches a rejection handler, and preserves the fixed synchronous-callback error. Direct `async` functions are still rejected before invocation without closing a safe connection. The file-backed regression test proves the pre-await row is absent after reopening, the post-await write fails, reuse is rejected, cleanup is idempotent, and no unhandled rejection is emitted.

Representative evidence:

- `packages/database/src/database.ts` — closed-connection state and fail-stop path;
- `packages/database/test/transaction-integrity.test.ts` — direct async, disguised Promise, nested commit, and nested rollback cases.

### Course lifecycle selection

**Implemented baseline.** Uninstalling the selected Course now chooses one remaining eligible Course deterministically inside the existing transaction. A candidate must have matching published `course_revisions` and `curriculum_versions` rows; ordering is `updated_at DESC, course_id`. The partial unique selected-state index and the `NOT EXISTS` guard preserve the single-selection invariant.

The focused lifecycle review found no introduced regression. A forced failure while recording the uninstall lifecycle event rolled back revision state, Course pointers, and replacement selection together. The focused Course Pack database suite passed 7/7.

### Course Pack validation

**Implemented baseline.** Knowledge prerequisite relationships now receive finite cycle validation while related-node cycles remain allowed. The independent probe covered two- and three-node cycles, disconnected cycles, a valid diamond DAG, related cycles, and a 500-node chain/cycle. Secret-shaped value checks cover common provider tokens, explicit Basic authorization, assignments, and HTTPS user-info without copying the candidate value into diagnostics.

#### Resolved HIGH: legitimate lesson prose classified as a secret

The first heuristic matched ordinary text beginning with `Basic` followed by base64-alphabet letters, and broad colon assignments treated policy prose as a credential. This blocked valid authentication/security Courses in both CLI and orchestrator validation paths.

The final rules require explicit `Authorization: Basic` context and a bounded token-shaped assignment value. Finalized Course Packs now accept ordinary prose such as a Basic-authentication overview, a password-length policy, and an API-key rotation policy, while all reproduced credential forms remain rejected with redacted diagnostics.

Blast radius: four production validation calls across the Course Pack CLI and orchestrator validation/revalidation paths.

### Learning Kernel replay and optimization

**Implemented baseline.** Mastery evidence is indexed once by knowledge node and dimension instead of repeatedly filtering the full fact set. The refactor preserves canonical node order, canonical fact order, source fact IDs, mastery bytes, and hashes for previously valid projections. Portable ordinal comparators replace locale-sensitive ordering in the reviewed deterministic helpers. Day Summary now requires a persisted exercise attempt before emitting implementation evidence or incrementing the attempted-activity count.

New commands receive strict link validation before projection:

- evidence basis facts must already exist and precede the candidate by `(occurredAt, id)`;
- a correction must target existing evidence that has not already been corrected and canonically precedes the candidate;
- a correction replacement must preserve activity, knowledge-node set, mastery dimension, evidence type, and error family.

#### Resolved HIGH: changed semantics under immutable `baseline-1`

The initial diff applied the stricter link rules while replaying all stored facts and corrected the mistake Review dimension without changing the model version. Reproducible historical frontiers either produced a different projection hash under `baseline-1` or became unreprojectable. Exact persisted hash/JSON verification would then reject idempotent replay, while the database schema and immutable history admit only the existing version.

The final bounded resolution separates acceptance from replay:

- `projectLearningKernel` preserves the `HEAD`/`baseline-1` timestamp-only correction chronology and legacy correction-identity semantics;
- `reduceLearningKernel` applies the strict rules only to the newly proposed candidate;
- legacy same-time and identity-mismatch fixtures prove deterministic replay compatibility, while attempting the same malformed correction as a new command is rejected;
- the prior mistake-dimension correction was reverted pending a versioned additive migration.

This preserves immutable historical meaning without allowing new commands to extend the legacy weakness.

Review-history replay was also optimized after the compatibility split. A one-pass incremental prefix projector replaces repeated full-history reconstruction for Review boundaries. An independent oracle review found and fixed one `baseline-1` mismatch involving a correction of `unverified` evidence; the final implementation preserves that legacy absence and fails closed rather than synthesizing a Review item. The deterministic benchmark visits 192 facts once instead of inspecting 12,288 fact-prefix entries for 64 Review series, while golden projection hashes and full Learning Core replay tests remain unchanged.

### Summary authority and immutable frontier safety

**Implemented baseline.** Summary creation, existing-row resolution, deterministic presentation inputs, Kernel authority projection, and evidence insertion now execute in one synchronous transaction. Parallel requests with different operation IDs converge on one immutable Summary evidence row and return the same payload and authority; retries do not poison the unit.

The authority envelope binds the exact Course, revision, pinned adaptation branch, session, `baseline-1` model version, observation clock, projection hash, and ordered fact frontier. For historical pre-envelope rows, reconstruction uses the persisted Summary evidence `created_at` as a strict Kernel `accepted_at` boundary. A later-accepted fact carrying an earlier or equal event clock cannot be silently attached to the old presentation, and equal acceptance timestamps fail closed because their order cannot be proven. New Summary operations do not write the legacy topic, mastery, mistake, flashcard, or progress read models; explicit unit completion remains the only progression side effect.

### Reviewer advisory result and deterministic receipt

**Implemented baseline.** `ReviewResult.status`, findings, and prose are bounded advisory output. Both valid advisory outcomes may produce an app-owned participation receipt, but neither outcome decides correctness, mastery, mistakes, debugging evidence, or progression. Eligibility is recomputed from the canonical result plus the exact immutable bundle SHA-256, complete diff and target-hunk references, current workspace snapshot, and the joined passing trusted test operation/check/environment/digest/backend/fingerprint. Duplicate normalized diff targets, impossible paths or lines, stale idempotent retries, legacy `passed` rows, truncated or tampered evidence, and out-of-scope topic suggestions fail closed.

### HTTP admission and shutdown lifecycle

**Implemented baseline.** JSON mutations are measured before parsing under a 1 MiB cap, including missing or chunked `Content-Length`; the process admits at most 16 API requests and 4 Tutor SSE streams, returning `429` with `Retry-After: 1` at capacity. Admission remains held until server work actually settles. Shutdown rejects new work, stops provider/execution producers, cancels remaining owned sessions, drains admitted handlers and streams, and only then closes SQLite. Tutor SSE producer settlement and browser reader cancellation both release stream ownership, preventing abandoned consumers from retaining capacity.

## Blast radius summary

| Boundary               | Quantified impact                                                  | Final assessment                                                      |
| ---------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------- |
| Transaction helper     | 33 production calls; 26 in reviewed changed/direct caller files    | High-confidence clean after fail-stop fix                             |
| Course uninstall       | 1 production route; selected target feeds 6 orchestrator consumers | High-confidence clean; transactional replacement selection            |
| Course Pack validation | 4 production calls in CLI/orchestrator                             | High-confidence clean after false-positive fix                        |
| Kernel projection      | repository accept/reproject plus versioned learning consumers      | Backward-compatible replay restored; strict new-command gate retained |

## Final verification evidence

The following results were observed on the final reviewed working tree:

- Database after the final Adaptation Branch fix: 19 test files, 129 passed and 3 skipped.
- Orchestrator: 22 test files, 306 passed.
- Web: 32 test files, 427 passed.
- Transaction integrity: 4/4 focused tests passed after the fail-stop change.
- Course Pack authoring kit: 2 test files, 11/11 tests; lint, typecheck, build, Prettier check, and diff check passed.
- Learning Core after replay optimization: 11 test files, 136/136 tests; lint, typecheck, build, Prettier check, and diff check passed.
- Database Learning Kernel integration: 6/6 tests passed after the accepted-frontier boundary coverage.
- Course Pack and Adaptation Branch lifecycle coverage includes the final open-as-draft regression: a v2 authoring branch remains archived, the v1 learner branch remains active, a v1 session pins v1, and incompatible branch bindings fail closed. The final `0020_adaptation_branch_lifecycle` schema hash is `a8b8ae44b994e8afe93b8436832d64c1c68103bae2731d4afd1ea385ff041021`.
- Final combined tree: `npm run verify` exited 0 in 373.8 seconds. This covered formatting, lint and typecheck across 12 packages, all fast tests, all builds, and the production-content policy.
- Separate browser gate: `npm run test:e2e` exited 0 in 110.1 seconds with 8/8 Chromium tests passing.
- Supply-chain policy: `npm run audit:policy` exited 0; production dependencies had 0 advisories, and the full tree had one development-only low `esbuild` advisory (`GHSA-G7R4-M6W7-QQQR`).

These are directly observed local results for the reviewed tree. They support approval of this bounded change, but they do not establish external-provider smoke coverage, a production CI result, release distribution readiness, or resolution of the open Core Alpha targets below.

## Resolved architecture follow-up

**Implemented baseline.** The remaining architecture findings from the prior review are resolved in this working tree:

1. **Summary authority and dual-write.** The Summary presentation route is bound to an exact Kernel scope/model/clock/hash/fact frontier; active Skills, Mistakes, Reviews, mastery, progression, and scheduling read Kernel projections. New Summary operations do not mutate legacy topic, mastery, mistake, flashcard, or progress read models. A validated Reviewer receipt contributes participation only and cannot create correctness, mastery, debugging, or mistake evidence.
2. **Adaptation Branch lifecycle and uniqueness.** Additive migration `0020_adaptation_branch_lifecycle` preserves archived v1 history and creates a distinct revision-scoped active branch for a valid v2 install. It enforces one active learner branch per Course, immutable base/head ownership, and revision-compatible session/Kernel scope. The final open-as-draft regression test proves that v2 authoring stays on an archived branch while the v1 learner branch remains active and a v1 session stays pinned to v1. Ambiguous or incompatible branch state fails closed.
3. **HTTP resource caps.** JSON mutations are measured before parsing under a 1 MiB cap, including missing or chunked `Content-Length`; the process admits at most 16 API requests and 4 Tutor SSE streams, returning `429` with `Retry-After: 1` at capacity. Cancellation releases admission only after server work exits. This remains a loopback application-layer control, not a defense for public or LAN exposure.
4. **Kernel Review replay performance.** The repeated-prefix path now projects incrementally in one fact pass. Oracle/golden coverage preserves ordering, corrections, dismissals, successors, non-ASCII identifiers, and `baseline-1` compatibility; the deterministic benchmark records 192 visits instead of 12,288 prefix inspections for 64 Review series.

## Open residual risks and follow-up

### HIGH — Approved Core Alpha target

1. **External Reviewer model evaluation.** The runtime treats Reviewer output as advisory and records only an application-owned participation receipt after bounded semantic validation. Synthetic adversarial fixtures cover invalid, stale, truncated, tampered, contradictory, oversized, and out-of-scope results, but no request against an authenticated, exactly selected external provider/model was observed at this cutoff. Model-specific prompt discipline and adversarial narrative quality therefore remain unproven in a live runtime.

### MEDIUM — Approved Core Alpha target

1. **Seed write guard.** Development seed commands need an explicit disposable/development target admission so they cannot be aimed at valuable local data by mistake.
2. **Legacy Summary storage retirement.** Physical legacy tables and dormant repository APIs remain preserved compatibility history. Their removal requires a later inventory, approved backup, reconciliation, and additive migration plan.
3. **Review-history capacity.** The repeated-prefix inefficiency is removed, but very large histories still need an explicit product fact-count budget and representative performance monitoring before release distribution.
4. **Historical zero-selection repair.** An idempotent re-uninstall does not repair a database already left with Course rows but no selected row by an older build; current admission correctly rejects the incoherent state rather than mutating it implicitly.

### LOW — Implemented baseline limitation

1. **Legacy `baseline-1` mistake dimension.** Historical replay preserves the original error-family-wide dimension lookup, which can label a same-family mistake on another node with the first dimension. New facts are constrained more strictly, but correcting historical projections requires a new model version, additive migration, deterministic reprojection, and immutable-history compatibility evidence.

## Provider, frontend, and documentation integration results

### Provider and agent boundaries

**Implemented baseline.** Prompt definitions were advanced to `v1.2.0` with one shared instruction/data boundary. Every role is told to treat Course, Draft, source, transcript, diff, test, tool, provider, and learner material as untrusted data; obey only Aptiloop-owned system, role, and typed-operation authority; fail closed when the server-owned scope is absent or ambiguous; and briefly refuse work unrelated to that scope. Role-specific contracts retain the narrower Tutor, Interviewer, Reviewer, authoring, curation, summary, and exercise restrictions. Contract tests assert the common injection boundary, unrelated-task refusal, lesson-only Tutor behavior, and read-only Reviewer behavior.

Tutor is no longer a generic chat surface. Both disclosure preparation and streaming require the `teacher` role plus an exact active versioned learning session and in-progress `teacher-dialogue` unit. The server derives the Course, revision, lesson, approved topics, out-of-scope topics, prior exact-unit dialogue, and operation entity IDs; sibling-unit and legacy unscoped messages are excluded. Persisted Tutor turns carry server-owned unit-scoped idempotency keys, and unit completion requires the persisted exact-unit turn evidence. External connections use a fresh provider session for each Tutor turn, while cancellation and connection removal evict the owned provider session. Disclosure names the Course content, learner message, and learner evidence sent to the selected destination; an unavailable exact provider/model fails explicitly rather than switching to Mock.

Linked Interviews derive topic and depth scope from the immutable learning snapshot and preserve the exact learning-session, unit, revision, and snapshot binding. Only a linked report with the required persisted answers can satisfy that Interview unit; a standalone Interview can finish independently but cannot be substituted for lesson completion. Disclosure recovery and consumption remain exact-operation scoped.

Reviewer execution remains read-only and bounded to the immutable operation evidence bundle. Each sequential review uses a fresh provider session, and the operation-scoped session is cancelled or evicted after authoritative persistence, failure, or cancellation; an isolation test proves that a second review does not inherit the first review payload. Canonical structured output, complete-diff freshness, output bounds, and exact external disclosure remain enforced. Semantic validation rejects status/finding contradictions, impossible changed-file or target-hunk line references, out-of-scope mastery topic IDs, and oversized narratives. The persisted `accepted` status denotes only a server-validated participation receipt; the model's `passed` or `changes_requested` verdict remains in `result_json` for bounded advisory UI, and neither outcome creates correct/incorrect Summary evidence, mastery, mistakes, strengths, gaps, or debugging evidence. The remaining limitation is live external-model evaluation, not server authority.

### Frontend quality and dead-code cleanup

**Implemented baseline.** The standalone `/chat` page, generic `AgentChat`, client-side role selector, their tests, and associated route/navigation/localization references were removed. Tutor is presented only inside the active lesson workflow. The learning client aborts an active Tutor stream when its lesson unmounts without aborting an already completed stream; the Curriculum Editor applies the same lifecycle rule to active Designer generation.

Course-authoring assets now use the package's public `@aptiloop/course-authoring-kit/authoring-assets` boundary instead of a deep relative import. Package manifests, the single lockfile, and Docker dependency graphs were aligned with the surviving runtime dependencies. The unused tracked `packages/testing` package and an orphaned legacy screenshot were removed. Required legacy provider adapter packages and tracked historical `docs/superpowers/**` evidence were deliberately retained; no user data, applied migration, or historical audit record was deleted.

The final web lint, typecheck, fast-test, build, and Chromium E2E paths are included in the green combined verification above. Existing semantic HTML, keyboard/focus, reduced-motion, theme, and `en-US`/`ru-RU` catalog checks remain part of those repository suites; this audit does not claim a separate manual assistive-technology certification.

### Documentation and repository hygiene

**Implemented baseline.** Current architecture, Provider Hub/Pi runtime, AI/security boundaries, private-source handling, information architecture, development guidance, terminology, and user-journey documents were reconciled with the scoped Tutor/Interview/Reviewer runtime and the five-item primary navigation. Status and date language now separates the implemented M1-M11/runtime baseline from uncompleted Core Alpha release targets.

The documentation index now links this dated audit. Non-authoritative local `.superpowers/**` leftovers are classified as removable local artifacts, while tracked `docs/superpowers/**` material remains preserved and explicitly historical. Stale generic Chat and deep-import references were removed, and documentation link checks found the current local Markdown targets resolvable. Repository documentation remains English and does not turn historical evidence into current approval authority.

## Final recommendation

**APPROVE (bounded working-tree change).** The reviewed transaction, lifecycle, Course Pack, Learning Kernel, agent-scope, frontend-cleanup, and documentation delta is acceptable on the directly observed local evidence above. Residual items that remain explicitly open are **Approved Core Alpha targets**; they are not waived by local gates and still require resolution or explicit owner disposition before release acceptance. External-provider smoke, production CI, distribution, and owner release approval remain separate evidence and decisions.

## Limitations

- No valuable user database was opened, migrated, or rewritten for this review.
- No exhaustive credential-format fuzzing or arbitrary Kernel graph fuzzing was performed.
- The Course lifecycle tie-break was code-reviewed and rollback-probed, but its new integration test contains one eligible fallback rather than several equal-time candidates.
- External provider behavior, production CI, and release distribution were outside this differential artifact unless later appended with directly observed evidence.
