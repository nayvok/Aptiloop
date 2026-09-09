# Aptiloop Handoff

## Entry point

Read `AGENTS.md`, `README.md`, `PRODUCT.md`, and this file. Treat the working tree as user work: do not reset, discard, or delete data. Select one slice only. The current slice was **task5: collision-safe install port selection** (design recorded in [ADR 0011](docs/adr/0011-collision-safe-install-port-selection.md)); task4 was closed in the previous session. The next slice is **Complete course transfer and attempt restore** (see the next-slice section). Do not touch historical plans or audits.

## Original 11-task phased checklist

### Runtime Distribution

- [x] Build npm bootstrap and runtime bundles
- [x] Fix launcher data paths and proxy
- [x] Correct service autostart and shortcuts
- [x] Implement verified GitHub release updates
- [x] Design collision-safe install port selection

### Course Portability

- [ ] Complete course transfer and attempt restore
- [ ] Expose precise safe import diagnostics

### Learning Evolution

- [ ] Harden course revision upgrade semantics
- [ ] Add Learning Design authoring stage

### Release Readiness

- [ ] Update documentation and remove scaffolding
- [ ] Run full gates and runtime smoke

All remaining unchecked items are **PAUSED** for the next session; this is not an external blocker.

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

- E2E is not green: launcher failed with exact error `Writable database identity is required before opening` at `apps/orchestrator/src/app.ts:474`; artifact `.verify/e2e-failures/20260907052333145-21600-c680a209`. A current diagnostic lint violation remains at `failure-presentation.ts138` (`no-control-regex`). Do not imply integrated full gates.
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

## Next slice: complete course transfer and attempt restore

**Approved Core Alpha target**

The next slice is the first unchecked Course Portability item, from current source. Scope sources: `APTILOOP_USABILITY_RELEASE_PLAN.md` (transfer contracts and UI/CLI steps) and the owner decisions that `transfer-with-progress` always records history and that restore of active sessions/attempts uses real ordered Git commits. Recorded starting point: transfer authoredGraph/raw JSON hash preservation and the mixed manual/Pack plus active-facts snapshot direct-repository smoke passed, but real route attempt materialization and Git restore source identities remain incomplete. Do not start import diagnostics, upgrade semantics, Learning Design, or release-readiness items in the same slice.

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
