# Aptiloop Handoff

## Entry point

Read `AGENTS.md`, `README.md`, `PRODUCT.md`, and this file. Treat the working tree as user work: do not reset, discard, or delete data. Select one slice only. Task11, **run full gates and runtime smoke**, is closed in the current working tree. All 11 original checklist items are complete; any further slices are new work. Do not touch historical plans or audits.

## Original 11-task phased checklist

### Runtime Distribution

- [x] Build npm bootstrap and runtime bundles
- [x] Fix launcher data paths and proxy
- [x] Correct service autostart and shortcuts
- [x] Implement verified GitHub release updates
- [x] Design collision-safe install port selection

### Course Portability

- [x] Complete course transfer and attempt restore
- [x] Expose precise safe import diagnostics

### Learning Evolution

- [x] Harden course revision upgrade semantics
- [x] Add Learning Design authoring stage

### Release Readiness

- [x] Update documentation and remove scaffolding
- [x] Run full gates and runtime smoke

All remaining unchecked items are **PAUSED** for the next session; this is not an external blocker.

## Current slice record: task11 — Run full gates and runtime smoke

**Implemented baseline (2026-09-10).**

- **E2E green — fixed the last E2E 403-blocker and default-Web-Origin gaps.** The browser proxy (`apps/web/app/api/[...path]/route.ts`) now applies the Aptiloop-owned client marker `X-Aptiloop-Client: web` instead of the legacy `X-DLH-Client: web`, symmetrically with the orchestator boundary (`apps/orchestrator/src/app.ts`); a forged browser marker is overwritten, never forwarded (`apps/web/test/proxy-route.test.ts` asserts the overwrite and stays green). `scripts/test-e2e.mjs` passes `WEB_ORIGIN` into orchestrator/web service environments, and `apps/orchestrator/src/app.ts` returns the launcher-owned E2E database target directly (avoiding the installed/active revalidation path in disposable E2E runs). A fresh `npm run test:e2e` result: **8 passed (2.1m)** — the full seeded daily-flow/accessibility matrix, `E2E_EXIT=0`.
- **Runtime smoke (local `.verify` harnesses) all exit 0.** Update lock smoke **5/5**, update failure smoke **bad-digest / migration / health** (post-switch rollback restores previous runtime/database and approved backup, pointer verified semantically), and active success smoke **`0.1.0 → 0.1.1` on a running runtime** with candidate SHA-256 proof, approved backup, and web+orchestrator health ports confirmed. The failure harness now compares the runtime pointer semantically (JSON) instead of by bytes, which the product legitimately rewrites while preserving version/releaseDir identity.
- **Full repo gates.** `npm run format:check` green; `npm run lint` exit 0; `npm run typecheck` 15/15; `npm run build` green; `npm run check:production-content` green. Docs updated for the client-marker rename (`docs/architecture.md`, `docs/security.md`, `docs/audits/2026-08-08-m1-safety-boundary-inventory.md`).
- **Known pre-existing limitation.** `apps/orchestrator/test/http-boundary.integration.test.ts` reports 3/52 timeouts (`holds request capacity until cancelled work exits` and `drains admitted mutation work before closing the database` plus one capacity gate test). Recorded identically on a clean base (git stash, 49 passed / 3 failed) — not introduced by this slice; the surrounding 49 boundary tests pass. No E2E is affected.
- Artifacts: `.verify/task11-*` logs retained as runtime-smoke evidence; disposable `.verify` smoke harnesses (`update-failure-smoke.mjs`, `run-failure-smoke-task11.cmd` semantic comparison) remain reusable tooling.

## Previous slice record: task10 — Update documentation and remove scaffolding

**Implemented baseline (2026-09-10).**

- The uncommitted task8/task9 working tree was first committed intact as `a6dacb5` (thematic task9 commit) before this slice changed anything; no working-tree or `.data` content was reset, discarded, or deleted.
- Documentation brought current with the task1–task9 implemented baselines: `README.md` Capabilities now cover Course Pack share with precise import diagnostics and copy-for-AI repair, course transfer with learner progress and Git learner-commit attempt restore, safe-update/side-by-side revision upgrades, and the Learning Design authoring stage; the npm bootstrap smoke paragraph no longer points at the removed intermediate `.verify` fixture and defers durable proof to a repack of the current tree. `ROADMAP.md` records the usability release slices as one **Implemented baseline** ledger row and moved **Latest implementation evidence** to 2026-09-10. `docs/data-portability.md` gained an explicit section separating the whole-profile bundle from the narrower Course Pack share and course-transfer-with-progress payloads. `docs/architecture/course-pack.md`, `docs/product/course-authoring.md`, `docs/product/user-journeys.md`, `docs/adr/` (0011, 0012), and the docs index were already current from tasks 6–9 and were not rewritten.
- Scaffolding removed (local, git-ignored, disposable): the one-shot `.verify` proof roots (`active-final-artifacts*`, `bootstrap-proof*`, `bootstrap-served-final`, `data-011-proof`, `data active 01011`, `installed runtime *`, `npm-*-proof`, `runtime-*`, `task4-disposable-data`, `update-*build*`, `updater-*`), all one-shot `.log`/`.port` files, and one-shot helpers (`probe-orchestrator.mjs`, `probe-worker-exit.mjs`, `sentinel-writer.mjs`, `create-baseline.mts`, `commit-task67-msg.txt`), plus the regenerable untracked `packages/course-authoring-kit/dist` build output.
- Preserved deliberately: `.verify/e2e-failures/**` (the recorded E2E blocker artifact), the task4 Settings smoke screenshots, and the reusable smoke harnesses (`update-active-smoke.mjs`, `update-failure-smoke.mjs`, `update-fetch-hook.mjs`, `mock-release-server.mjs`, `run-active-smoke.cmd`, `run-failure-smoke.cmd`) that task11 can rerun. `.data` user data, the local `.omp` harness, historical methodology documents noted in the prior slice, tracked `workspaces/exercises/**` trusted exercise templates, and historical plans/audits were not touched.
- This slice is documentation and local-scaffolding cleanup only; no application behavior, schema, or provider boundary changed.

## Previous slice record: task9 — Add Learning Design authoring stage

**Implemented baseline (2026-09-10).**

- The shared and guided authoring order is `Initial Brief → Discovery → Diagnostic → Learning Design → Course Proposal → User Review`. Proposal generation rejects an incomplete Learning Design, and an out-of-order completion request retains the established `409 invalid_workflow_transition` contract without mutation.
- The external authoring instruction and the constrained `course-designer` prompt now require target capability → observable evidence → practice → feedback → instruction/review; attempt-before-answer; software decision practice; changed-condition transfer; explicit mastery evidence; separate interview/engineering objectives and time trade-offs; honest placeholders; and runtime-unavailable degradation without invented exercises.
- A skipped Diagnostic requires a persisted explicit assumption before the guided workflow can advance. Both completion and generation enforce the condition server-side; the localized UI explains it and keeps the completion action disabled until the assumption and all required Learning Design fields are present.
- `COURSE_PACK_SKILL_CONTENT_VERSION` and the Course Designer prompt are `1.4.0`. Generated authoring templates carry the version, and import Preview shows a non-blocking `en-US`/`ru-RU` mismatch warning while keeping explicit install/open-as-draft actions available.
- Identity/authority, finite typed tools, deterministic validation, protected-material separation, provenance, stable-ID meaning, approval/Apply/Publish gates, and the three-repair-round budget remain unchanged.
- Focused evidence after formatting: orchestrator Course Designer 13/13, web Course authoring instruction 11/11, guided Studio component 20/20, Course Pack component 32/32, prompt-library 8/8, and Authoring Kit asset 1/1 passed. A reviewer-found early-transition TypeError path was corrected and retained as a regression test. Affected-workspace TypeScript checks and LSP diagnostics passed without errors.
- Repository gates: `format:check`, lint 15/15, typecheck 15/15, build 15/15, and `check:production-content` passed. `test:fast` passed every suite except the unchanged `apps/orchestrator/test/http-boundary.integration.test.ts` baseline: one concurrent-entry assertion and two 30-second shutdown/capacity timeouts (orchestrator 348/351). E2E was not rerun in this capability slice; the existing writable-database launcher blocker remains recorded below.
- Rendered Browser proof used the production Next build at 1280×900 with a disposable in-tab Course Designer fixture. The Learning Design guidance and six labeled fields rendered without a framework overlay or console/page errors; completion was disabled before required input and enabled only after all fields plus the explicit skipped-Diagnostic assumption were entered. No Course or learner data was mutated.

**Task9 is closed.** Task10 is the next slice; release-readiness cleanup and full release evidence were not started here.

## Previous slice record: task8 — Harden course revision upgrade semantics

**Implemented baseline (2026-09-10).**

- Course Pack validation detects an upgrade only for the same `courseKey`, a strictly greater revision number, and a resolvable parent revision in that Course. The staged response carries a bounded detailed preview: current/incoming revision, collision-checked side-by-side key, carried activities, activities requiring revalidation, removed activities, and personal-adaptation conflicts.
- The owner-approved choices are exactly `safe-update` and `side-by-side`; the older replace-with-backup proposal is not implemented. The UI defaults to safe-update, exposes both choices in an accessible localized dialog, and uses a dedicated staged upgrade POST.
- Safe-update rejects while any Course session remains active. Otherwise it transactionally publishes and activates the incoming upstream revision, leaves old revisions/sessions/facts immutable, replays only facts whose stable activity and prerequisite contracts survive, and records migration provenance bound to the original fact and contract hashes.
- Personal adaptation conflicts require an exact normalized resolution set. The incoming upstream revision remains the sole learner-active branch for new sessions; resolved personal divergence is retained as a separate archived rebased lineage/head rather than silently discarded or made active.
- Side-by-side derives and collision-checks a distinct Course identity, installs it as a new Course, and carries no learner history.
- Upgrade operations are idempotent only for the exact validation, mode, content hash, suffix, and normalized adaptation resolutions. A consumed staged operation can return its prior result; changed payloads fail closed.
- Focused evidence after formatting: database Course Pack suite 14/14, orchestrator Course Pack route suite 19/19, web Course Pack component suite 31/31, UI state primitives 16/16, and changed-workspace TypeScript checks passed.
- Repository gates: `format:check` passed; `lint` 15/15 passed; `typecheck` 15/15 passed; `build` 15/15 passed; `check:production-content` passed after the build completed. `test:fast` passed every suite except the known `apps/orchestrator/test/http-boundary.integration.test.ts` red baseline (3 failures: concurrent-entry assertion plus two 30-second shutdown/capacity timeouts; orchestrator total 346/349). `test:e2e` did not start the app: `createApp` rejected the missing writable database identity at `apps/orchestrator/src/app.ts:493`; current artifact `.verify/e2e-failures/20260910012302002-25764-cbaadf62`.
- Rendered Browser proof used the production Next build at 1280×900 with a disposable in-tab staged-validation fixture: the dialog showed exactly `Safe update` and `Side-by-side`, safe-update was selected by default, active-old-session guidance was visible in its accessible name, adaptation resolution was keyboard accessible, and Space selected side-by-side. No real Course or learner data was mutated.

**Task8 was closed before task9 began.** Its behavior-specific suites, build, and rendered interaction proof were green; the repository-wide `test:fast`/E2E limitations below remain pre-existing infrastructure baselines.

## Verified evidence

**Implemented baseline**

- **Task1:** Windows npm `.bin/aptiloop.cmd --version` (`0.1.0`) and help passed from an unrelated working directory; the real runtime passed with spaced paths, loopback ports `59880/59881`, health, root, version, icon, and stop. LICENSE, NOTICE, and THIRD_PARTY files are present. `.verify/bootstrap-proof-shebang/aptiloop-0.1.0.tgz` is intermediate evidence only and must be repacked from the current tree before it can be final proof. An initial smoke changed the real AppData/Roaming/Aptiloop/last-data-dir.json to a test profile without a pre-backup; it was preserved, not guessed. Later smokes used isolated roots. Pointer ownership and owner recovery still need action.
- **Task2:** Installed database authority is exactly `APTILOOP_DATA_DIR/dev-learning-harness.sqlite`; source checkout is unchanged. Proxy `WEB_ORIGIN` and real `127.0.0.1` Origin validation passed; aliases/evil returned 403. Standalone 3 MiB plus 17-byte SHA, early/delayed SSE, cancellation, reparse rejection, and database mismatch rejection passed. 27 proxy+URL tests, typecheck, and lint passed.
- **Task3:** Stable service launcher uses `--service-run --data-dir`. Windows XML LogonTrigger toggle, UTF-16 temp handling, macOS `RunAtLoad`/`KeepAlive`, and Linux desktop escaping are covered by contracts; unique Windows scheduled `/TR` and shortcuts passed. Host XML toggle returned `ERROR_ACCESS_DENIED`, so it is not host-proven; macOS/Linux are contract-only. `queryAutostart` was restored and a useless assignment removed; lint/type/build passed.
- **Task4 (closed):** verified update path from current source. **Failure smoke (exit 0):** `bad-digest` — `SHA-256 mismatch`, pointer/database untouched, no backup (`a1c85494-c32d-4174-9be3-92957b5f5333`); `migration` — controlled candidate failure, pointer/database untouched, backup written (`9373426b-a488-45c4-8028-fc7f177b576c`); **health C (post-switch rollback)** — candidate `0.1.2` created & cutover, restart exit 41 → rollback restored `previousPointer 0.1.1` and DB from approved backup, `activeDatabaseMutated/pointerMutated: true`, old health re-verified, clean stop (`24396ded-fcf0-496b-9ca3-cf1a3152ea96`). **Lock smoke (5/5):** exclusive-lock fail-fast, same-operation no-op, dead-owner recovery, unattributable lock fail-closed, terminal short-circuit. **Active success** from current source: `0.1.0→0.1.1`, sentinel preserved, approved backup, `.staging` removed (`f960c8ea-ae89-43f4-b1c8-8d67c28cf996`, ports `52221/52222`). Fixed in source this slice: bundle now ships `scripts/update-launcher-env.mjs` (worker import was missing from release archives), quiescent database wait after runtime stop, transient SQLite I/O retry in identity reads. Current-source gates: typecheck 15/15, update-core 18/18, system-routes 17/17, launcher-env 1/1, prettier/eslint/`node --check` clean (`HANDOFF.md`).
- **Task4 rejection evidence:** bad digest operation `92c33c1e-e279-40cd-9ed6-4306ffae5b35` rejected with pointer/database untouched and no backup; migration fixture `6772621a-1963-4fa3-9e56-45d13bddf7bf` rejected with backup and pointer/database unchanged. These predate the latest safety edits.
- **Task4 UI:** Settings release metadata/assets/size/digest/migration warning/phase/error are localized in `en-US`/`ru-RU`. Local Next in-tab fixture API showed Russian available→success and English available→rollback message at 1280×900. This was not a real backend update. One unrelated 503 occurred; no overlay/page error. Settings tests 11/11, types, lint, and format passed.
- **Task5:** collision-safe install port selection design recorded as [ADR 0011](docs/adr/0011-collision-safe-install-port-selection.md) (**Approved Core Alpha target**, 2026-09-09) plus an "Installed port selection contract" section in `docs/architecture/deployment-models.md`. Direct implementation evidence reviewed in source: `packages/cli/src/ports.ts` (resolution order flag > env > persisted > defaults; auto/fixed modes; disjoint deterministic ranges web 10101–10111 / orchestrator 8787–8797; EADDRINUSE-only classification; Aptiloop reuse probe; atomic `config.json` with `reset-ports`; create-only instance lock with stale recovery), `packages/cli/src/cli.ts` (`init`/`service install` record-only selection; start/service-run candidate walk with fail-closed pinned errors and fallback disarm after a successful auto bind), `packages/cli/src/runtime.ts` (preflight occupancy probe never reserves), `scripts/update-worker.mjs` (candidate health on ephemeral loopback ports; cutover waits on the persisted pair), and `scripts/update-launcher-env.mjs` (scrub of launcher-owned port variables). Verification: `packages/cli` port suite passed 14/14 on Windows (observed 2026-09-09). macOS/Linux service behavior remains adapter-contract-only; no new runtime claims.
- **Other:** Working tree committed on 2026-09-09 as thematic commits (repo hygiene, installed CLI runtime, GitHub Releases updater, course transfer/authoring, docs/handoff). Excluded from git intentionally: compiled `.js` artifacts next to `.ts` sources in `packages/database` and `packages/course-authoring-kit` (regenerable; `.ts` sources are committed), and task4 Settings smoke screenshots moved to `.verify/`. Local `.omp/` harness config is ignored via `.gitignore`/`.prettierignore`. Known red items at commit time: E2E launcher failure (`Writable database identity is required before opening`, see above) and the `no-control-regex` lint violation in `apps/web/lib/failure-presentation.ts`. Transfer authoredGraph/raw JSON hash preservation and mixed manual/Pack plus active-facts snapshot direct-repository smoke passed, but real route attempt materialization/Git restore source identities remain incomplete. Diagnostic safe reports/catalogs and async Validate detection are complete; Course Pack browser en/ru only. Upgrade is mostly incomplete; Learning Design is partial.

## Incomplete / explicitly unverified

- Integrated gates are not fully green. `test:fast` still has the known three failures in `apps/orchestrator/test/http-boundary.integration.test.ts` (concurrent-entry assertion and two 30-second timeouts). `test:e2e` currently fails before route registration with exact error `Writable database identity is required before opening` at `apps/orchestrator/src/app.ts:493`; artifact `.verify/e2e-failures/20260910012302002-25764-cbaadf62`. The prior `failure-presentation.ts` lint violation is fixed; current format, lint, typecheck, build, and production-content gates pass.
- Post-switch failure and rollback C: **VERIFIED** this slice (see Task4 evidence). Latest freeze: no background jobs, live smokes, or `update-worker` processes remain. Windows cleanup occasionally returns `EBUSY` on disposable smoke roots (`rmdir` after late `taskkill`), which does not affect evidence; roots are removed manually.
- Public GitHub tagged-release operation is unverified. macOS/Linux runtime updates are unverified. Do not make public release/provider claims.
- Collision-safe install port selection: design recorded as ADR 0011 and the CLI contract is an implemented baseline (port suite 14/14, Windows); macOS/Linux host service/autostart verification and any future start-path additions remain open.

## Owner-approved decisions

**Approved Core Alpha target**

- Defaults are `10101/8787`; fallback is allowed only on first unpinned setup/start. Flags, environment, and fixed ports never hop; persisted ports remain stable; reset rearms fallback.
- `transfer-with-progress` always records history. Restore active sessions/attempts with real ordered Git commits.
- Upgrades are safe-update/side-by-side only; safe-update blocks an active old-revision session.
- Authoring sequence is Brief→Discovery→Diagnostic→Learning Design→Proposal.
- Workers use Luna and sessions work by slices.

The shared attempt `environmentId`/`baselineTreeHash` fields proposal was reverted. `baselineTreeHash` is intended to use `source_snapshot_hash` and the restored local baseline commit; migration0022 is not approved.

## Task9 scope source (closed)

**Implemented baseline**

Task9 followed `APTILOOP_USABILITY_RELEASE_PLAN.md` step 8 and the owner-approved sequence `Brief → Discovery → Diagnostic → Learning Design → Proposal`. It updated the external authoring instruction, in-app guided Designer, and prompt-library Course Designer contract without weakening identity/authority, typed tools, validation, protected material, provenance, stable IDs, approval gates, or the three-attempt repair budget.

### Task6 slice progress (2026-09-09 session)

**Implemented baseline**

- **Git restore source identities: closed.** `restoreExerciseAttempt` now replays learner commits as real ordered commits with the source author identity (`GIT_AUTHOR_NAME/EMAIL/DATE` from the envelope, validated against control characters/line breaks/length before reaching the Git environment; committer stays the deterministic `Aptiloop transfer` identity), re-anchors onto the destination's own trusted-template baseline commit instead of demanding the source-machine baseline SHA, and keeps the source commit SHA in the restored commit message. `exercise-core` 65/65 includes a fresh-baseline cross-machine round-trip asserting author identity, order, parent link, and source-SHA message mapping, plus rejection of malformed author identity before any write.
- **Three regressions from commit `803532b` found and fixed while wiring the route proof:** (1) `registerVersionedLearningRoutes(app, state)` and `registerCurriculumEditorRoutes(app, state)` calls were dropped from `apps/orchestrator/src/app.ts`, unmounting all versioned learning and curriculum-editor routes (practice-resume and learning-v2 suites were red); (2) the production default web origin moved to `10101` while seven orchestrator integration fixtures still sent `Origin: 3000` — fixtures now pass an explicit `webOrigin`; (3) `exportRevisionSnapshots` threw a bare `Error` (HTTP 500) on legacy backfill revisions whose preserved content hash cannot match `publicationContent` — such revisions are now skipped and `buildCourseTransferExport` fails closed with `409 "no transferable content revision"` when a Course has no representable snapshot. Also cleared pre-existing lint reds (`no-empty-object-type`, unused imports, missing `no-control-regex` pragmas) in `exercise-core` and `orchestrator`; lint and typecheck for both packages plus `@aptiloop/database` are green, `exercise-core` 65/65 and `@aptiloop/database` 134 passed.

**Owner decisions (2026-09-09) — approved by the repository owner; recorded in [ADR 0012](docs/adr/0012-course-transfer-scope-and-version-contract.md)**

1. **LearnerScope-only transfer is allowed for already installed Courses** (the "B" path). The envelope may carry no `packs`/`revisionSnapshots` when the target already holds the exact same Course revision (identity + revision content hash bound to the exported learner scope). Importing a new Course still requires the full envelope. Target missing the matching installed revision → fail closed with a precise diagnostic.
2. **Version contract:** `formatVersion` is the hard contract (unknown/newer schema → "update the app"; older schema → "re-export from a current version"). The originating app version is recorded in the manifest at export and shown as a non-blocking preview warning on import when it differs; UI-only releases never bump the schema. Structural Course migration stays in the separate upgrade-semantics slice.
3. **Unknown Course types (activity/evidence/check/environment) fail closed** with precise code/path/entity diagnostics; no partial install, no silent skip.
4. **Scope of the finishing session:** implement decision 1 and close the full route proof (export with active attempt → import on a profile where the same Course revision is already installed → restored exercise workspace + Git learner commits with source author identity). Do not start import diagnostics (task7), upgrade semantics (task8), or Learning Design (task9) in the same session.

**Implementation brief for the previous session (finishing task6) — DONE; see the Task6 record (closed) below.**

- The v1 envelope schema (`packages/shared/src/course-transfer.ts`) must support the learnerScope-only mode: relax the "at least one pack or revision snapshot" super-refine only for the already-installed-Course case, add the originating app version to the manifest, and surface the mode + app-version warning in the export request and import preview.
- `packages/database/src/course-transfer.ts`: replace the current `409 "no transferable content revision"` hard stop with decision-1 semantics (export learnerScope-only; on commit require the exact installed revision match, verify it, and reject otherwise). Existing full-envelope import behavior stays untouched.
- `apps/orchestrator/src/course-transfer.ts` + `apps/orchestrator/src/app.ts`: route support for the new mode; the materializer already exists.
- Close the skipped route proof in `apps/orchestrator/test/course-transfer.integration.test.ts` (the `it.skip`): source and target both run the seeded course (the only course with `exercises` rows today), source has an active session + attempt with a learner commit; export learnerScope-only, import on target, assert the restored `exercise_attempts` row points at a real workspace and the Git learner commit carries the source author identity (fresh baseline re-anchor plus restored commit).
- Gates for the session: `npm run typecheck`, `npm run lint` (both packages touched), `npm run test:fast`, targeted `npm run test:e2e` only after the above, `npm run build`; record results.

## Task6 record (closed)

**Implemented baseline (2026-09-09)** — see [ADR 0012](docs/adr/0012-course-transfer-scope-and-version-contract.md) Implementation status.

- `packages/shared/src/course-transfer.ts`: manifest now carries `mode` (`full`|`learnerScope`), `originatingAppVersion`, and `learnerScopeCourses` (courseKey, courseTitle, revisionKey, revisionNumber, revisionContentHash, primaryLocale). The envelope super-refine requires content only in `full` mode; learnerScope mode requires exactly one binding per exported course and forbids packs/revision snapshots. Preview schema surfaces mode + originating app version + nullable `appVersionMatches`.
- `packages/database/src/course-transfer.ts`: `buildCourseTransferExport` no longer 409s on content-less Courses — it exports learnerScope-only and binds the installed published revision (`readPublishedCourseRevisions`), verifying scope/revision coverage (`assertLearnerScopeRevisionCoverage`). Commit (`commitCourseTransfer`) calls `verifyLearnerScopeInstalledRevisions` (fails closed with `TRANSFER_INSTALLED_REVISION_UNRESOLVED`) and `transferCommitComplete` requires the exact match even for idempotent replay. `curriculum_versions.content_hash` is normalized between bare hex and `sha256:` forms. `previewEnvelope` handles learnerScope courses.
- `apps/orchestrator/src/{course-transfer,app}.ts`: export route injects `originatingAppVersion` from `readAppVersion(projectRoot)`; validate fills `appVersionMatches`; new `app.onError` branch renders `CourseTransferInvalidError` as 409 with diagnostics.
- `apps/web/components/course-transfer-client.tsx` + `i18n.tsx` (en/ru): preview panel shows transfer mode, originating version, and a non-blocking `appVersionMismatch` warning fed by `useQuery("/version")`.
- Route proof closed: `apps/orchestrator/test/course-transfer.integration.test.ts` — (1) learnerScope-only export succeeds, target without the installed revision fails closed with `TRANSFER_INSTALLED_REVISION_UNRESOLVED`; (2) app-version mismatch is a non-blocking preview warning (`appVersionMatches: false`, still valid); (3) active attempt with Ada Lovelace learner commit restores a real workspace and ordered Git commit with source author identity.

**Gates (2026-09-09):** `format:check` ✔, `lint` 15/15 ✔, `typecheck` 15/15 ✔, `build` 15/15 ✔, transfer integration 3/3 ✔. `test:fast` — all suites green except `http-boundary.integration.test.ts` (3 of 3 in that file fail with concurrency/timeouts; proven pre-existing by running the same file on a stashed clean tree — identical 3 failed). `test:e2e` — orchestrator fails at `createApp` "Writable database identity is required before opening" (before any route registration; previous e2e-failure artifacts exist from 07.09), so E2E could not run in this session and is recorded as BLOCKED on infrastructure, not on task6 changes. Also applied on this session: removed a pre-existing unused import in `course-authoring-kit/src/course-pack.ts`, dead `#archiveCourseRevisions` and unused imports in `database`, and a `no-control-regex` pragma in `apps/web/lib/failure-presentation.ts` that were blocking `npm run lint` on the un-pushed main; these are lint-only cleanups with no behavior change.

## Task4 record (closed)

### Current code and smoke map

**Implemented baseline**

- `scripts/update-worker.mjs` — detached update phases, candidate migration/health, cutover, and rollback path.
- `scripts/update-launcher-env.mjs` — stable launcher environment construction and scrubbing.
- `apps/orchestrator/src/update-manager.ts` — Settings metadata check, apply queue, operation contracts, and terminal retry clearing.
- `apps/web/components/settings-runtime.tsx` + `apps/web/lib/i18n.tsx` — Settings updater surface and localized copy.
- `packages/update-core` — release asset, digest, archive, and manifest contracts.
- `.verify/update-failure-smoke.mjs` + `.verify/update-fetch-hook.mjs` — local failure and intercepted-release smoke harnesses.
- `packages/database/src/active-database.ts` and `apps/web/app/api/[...path]/route.ts` — database identity and local API proxy boundaries.
- Safety edits are implemented in source: trusted-previous CLI stop/fallback PID, stable environment scrub, fail-fast lock handling, and terminal `activeApply` clearing for retries. **C is VERIFIED** (post-switch rollback accepted).

### Latest updater freeze result

- Result: **C VERIFIED** — post-switch rollback accepted from the current source.
- Evidence: update-core 18/18, system-routes 17/17, launcher-env 1/1, updater lint/prettier, typecheck 15/15; failure smoke (bad-digest/migration/health) and lock smoke (5/5) exit 0; active success smoke `0.1.0→0.1.1` exited 0. No background jobs/live smoke/update-worker processes remain.
- Limitations: public GitHub tagged-release operation, macOS/Linux runtime updates remain **UNVERIFIED**. Windows-only run. Cleanup EBUSY on disposable roots is cosmetic.

## Later gates

Only after slices are complete, run the applicable format, lint, typecheck, `test:fast`, E2E, build, and production-content gates. Record limitations exactly; never infer release acceptance from historical audits or fixture-only evidence.
