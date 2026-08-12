# Production-readiness polish evidence

**Document status:** The repository changes and local evidence recorded here are an **Implemented baseline**. Core Alpha release acceptance remains an **Approved Core Alpha target**.

## Scope

This record covers the 2026-08-12–13 production-readiness polish working tree: responsive lesson layout, honest approximate-duration copy, managed provider lifecycle, production Mock isolation, environment-free local startup, local-profile portability, production container packaging, documentation cleanup, and a fresh authenticated provider request.

It is working-tree evidence, not a claim about commit `b542b32` or any future commit. Release authorization, a project license/notices/trademark set, hosted CI, and owner sign-off remain separate gates. Aptiloop intentionally ships no Course; approval applies only if a future first-party or sample Course is proposed.

## Authenticated provider smoke

**Implemented baseline**

The smoke used a disposable database and disposable credential root under ignored `.verify/local-preview`; the active `.data` database was not opened or migrated.

Observed sequence:

1. Started the orchestrator with `developmentMode: false` and no Mock provider fixture.
2. Opened **Settings → Connections** in the browser and created an OpenCode Zen connection by entering the temporary credential through the password field.
3. Observed 59 exact model IDs and selected `deepseek-v4-flash-free` while the connection was honestly labelled `Configured · not yet tested` / `Настроено · ещё не протестировано`.
4. Assigned that exact connection/model to the Tutor role.
5. Sent one bounded Tutor request through the browser. The operation-scoped external-disclosure dialog identified OpenCode Zen, the `learner-message` payload category, 177 bytes, and the excluded credential/environment/path/history categories.
6. Approved that exact disclosure once and observed a completed, meaningful Tutor response.
7. Reopened Connections and observed the connection transition to `Connected` / `Подключено`.
8. Removed the connection through the confirmation UI and observed its role profiles return to AI Off. The disposable credential store was then removed with the disposable preview data during cleanup.

No credential value, provider account identifier, absolute private path, or raw provider payload is recorded in this document or the committed screenshots. The temporary credential must still be revoked by its owner because it was disclosed in the task conversation.

## Verification boundary

**Implemented baseline**

The final command evidence belongs to the completed working tree:

- `npm run verify` passed formatting, 13/13 lint tasks, 13/13 typecheck tasks, 23/23 fast-test tasks, and 13/13 builds. The web build generated 25 routes.
- `npm run test:e2e` passed 8/8 browser tests, including the responsive accessibility matrix.
- `npm run audit:policy` reported zero production vulnerabilities and one dev-only low advisory in `esbuild` (`GHSA-g7r4-m6w7-qqqr`).
- `npm run sbom` generated the ignored CycloneDX artifact under `.verify/supply-chain/`.
- The repository/history secret audit found no high-confidence real credential in tracked content, and the production orchestrator bundle contains no Mock fixture identifier.
- `docker compose config --format json` resolved two loopback-published services with non-root image users, read-only root filesystems, dropped capabilities, `no-new-privileges`, bounded temporary filesystems, named private-data volumes, and no exercise-fixture bind mount. A clean lockfile production-install probe retained the Hono/Pi/OpenCode runtime closure while excluding representative development packages (`vitest`, `tsx`, `tsup`, TypeScript, Next, and Playwright). Docker Desktop's Linux daemon was not running, so no fresh image build, filesystem inspection, or container health result is claimed.
- Production startup seeds no Course and the final image recipe copies no fixture directory. A later same-day cleanup replaced the web route's complete development Course with a topic-neutral, deliberately non-installable structural scaffold and moved the concrete Course Pack fixture to a test-only module. A fresh web standalone build contained neither the deleted fixture filename nor its recognizable identifiers; the exact evidence is recorded below.
- `NEXT_DIST_DIR=.next-course-fixture-check npm run build --workspace=@aptiloop/web` produced 25 routes. `npm run check:production-content` then scanned that complete isolated build and passed; an independent recursive filename/content scan also found zero occurrences of `development-course-pack.json`, `development-kernel-basics`, `Aptiloop development fixture`, `Deterministic Learning Basics`, `replay-lesson`, `study-replay`, or `recall-replay`.

`npm run verify` does not include E2E; the two gates above were run separately. The curated README screenshots use disposable development curriculum data with production provider policy and contain no provider credential or private path.

## Remaining release gates

**Approved Core Alpha target**

- Professional legal review and an approved project license/notices/content/trademark set.
- Distribution authorization; any future first-party/sample Course also requires separate content, provenance, safety, licensing, and ownership approval.
- Hosted CI evidence and owner sign-off.

The local provider smoke proves one exact authenticated request only. It does not certify every provider, model, role, network condition, disclosure-recovery path, or upstream retention policy.
