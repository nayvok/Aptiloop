# Implementation plan v2

> **Historical snapshot — non-authoritative.** This file records an earlier **Implemented baseline** and is preserved for context only. Do not execute it as a current plan. See the [current documentation index](README.md).

Статус: выполняется  
Baseline: `eeb0e3e`  
Принцип: tests first, additive migrations, usable Day 1 before breadth.

## Phase 0. Audit and safety baseline

- [x] Git history/status, architecture, schema, seed, routes, adapters, prompts,
      tests and docs inspected.
- [x] Existing UI and active-session navigation reproduced in browser.
- [x] `1 Issue` traced to the already-fixed theme hydration mismatch; current
      runtime has no page/console error.
- [x] Isolated migrate/seed twice, format, lint, typecheck, 160 fast tests and
      production build passed.
- [x] External versions/health checked without claiming generation smoke.
- [ ] Add safe DB backup/preflight; never mutate the second candidate DB.

Commit: `docs: specify versioned unit learning flow`.

## Phase 1. Contracts, migration and versioned curriculum

1. Write failing tests for CurriculumVersion status/revision, unit order,
   immutable publish, clone revision and historical snapshot.
2. Add Zod contracts for source/depth/unit/day/week/version/snapshot/progress.
3. Add append-only `0001_curriculum_units.sql` and Drizzle schema.
4. Backfill a legacy version and snapshots for existing sessions.
5. Seed published v2 and detailed Day 1 units by stable IDs; never update a
   published content hash in place.
6. Add repository draft/publish/clone/list/path operations.

Verification: database/shared/curriculum/learning-core tests, migration fixture,
typecheck.  
Commit: `feat: version curriculum and snapshot sessions`.

## Phase 2. Session unit engine and restart recovery

1. Write guard matrix for locked/ready/in-progress/completed/skipped.
2. Persist learner current session, current unit and per-unit payload/progress.
3. Add start/resume/abandon, save draft, toggle checklist, submit evidence and
   complete unit repository operations.
4. Enforce one global active session and allow a new session after completion.
5. Return active session by `/api/learning/sessions/current` and resolve
   `/session` without a query ID.
6. Persist/reload dialogue, exercise, test and review history.

Verification: repository and orchestrator restart integration tests.  
Commit: `feat: persist guided unit progression`.

## Phase 3. Guided Path and lesson UI

1. Inspect shadcn ecosystem before custom primitives; reuse existing Phosphor,
   CVA and semantic shadcn patterns.
2. Make `/` the detailed Path and remove Agents from primary navigation.
3. Build unit renderer for Briefing, Study, Recall, Teacher Dialogue, Quiz,
   Code Reading, Exercise handoff, Review status and Summary.
4. Add checklist persistence, draft recovery, beforeunload warning, loading,
   retry, cancel and explicit provider/model status.
5. Add accessible current/locked/completed semantics and one primary CTA.
6. Add focused component tests for every Day 1 surface.

Verification: web unit/component tests, keyboard/mobile checks.  
Commit: `feat: build the guided day one path`.

## Phase 4. Provider and security integration

1. Fix `npm start` propagation of computed OpenCode endpoint.
2. Use exact WEB_ORIGIN and JSON content-type checks on mutations.
3. Add explicit turn cancellation and evict failed/cancelled provider sessions.
4. Call structured-output validation with bounded repair for review/report.
5. Connect configured Reviewer to real diff/test context; Mock remains fallback.
6. Remove executable/path mutations from browser settings boundary.
7. Minimize exercise process environment and revalidate stored paths.

Verification: provider contract, orchestrator integration, origin/content-type,
cancel/retry/read-only tests; optional real-provider smoke recorded separately.  
Commit: `fix: enforce provider and process boundaries`.

## Phase 5. Exercise correction and deterministic completion

1. Copy exercise template to per-attempt workspace.
2. Keep server-owned baseline identity and reviewed diff hash.
3. Require non-empty diff and tests before review.
4. Require changed diff/new tests after `changes_requested`.
5. Run `learning-core` mastery from evidence; aggregate mistakes across sessions.
6. Persist summary and editable/taggable flashcard candidates.

Verification: pass/fail/fix integration, no workspace mutation by Reviewer,
mastery/mistake/card assertions.  
Commit: `feat: require learner correction before completion`.

## Phase 6. Curriculum editor and Interview

1. Add draft version/week/day/unit CRUD, up/down ordering, duplicate, preview,
   publish, archive and clone revision.
2. Add authoring validation and immutable published guards.
3. Replace free chat Interview with setup, one-question flow, transcript, report
   and deterministic evidence.

Verification: editor and interview integration/component/E2E scenarios.  
Commits: `feat: add curriculum revision editor`,
`feat: build structured interview workflow`.

## Phase 7. Design system, themes and accessibility

1. Replace brown/amber tokens with cool neutral + emerald semantic palette.
2. Add activity tokens, AA contrast tests and success foreground token.
3. Synchronize light/dark/system choice without hydration flash.
4. Add skip link, aria-current, named progress, 44px primary controls and
   correctly associated form errors/live regions.
5. Run shadcn component review after custom UI changes.

Verification: component tests, light/dark/system screenshots, desktop/tablet/
mobile browser pass, reduced motion.  
Commit: `feat: refresh the accessible learning interface`.

## Phase 8. Isolated E2E and acceptance

1. Give Playwright unique file SQLite and copied workspace; never reuse shared
   dev servers or remove repository `.git` directories.
2. Test full Day 1, failed tests, fix, review, summary artefacts and exact
   restart recovery.
3. Test curriculum revision snapshot and Interview.
4. Clean install, migrate, seed, format, lint, typecheck, fast tests, E2E and
   production build.
5. Perform Mock, available/unavailable OpenCode/Codex, streaming/cancel, Zed,
   diff/tests/read-only review, theme and secret/forbidden-feature audits.
6. Update README, AGENTS and all required docs with only verified claims.

Commit: `test: verify the local learning workflow`, then
`docs: publish the acceptance audit`.

## Stop/go gates

- No schema mutation before verified backups of candidate local DBs.
- No UI completion CTA without matching server-side completion guard.
- No provider marked connected without live health; no smoke marked passed
  without an actual request.
- No Day 2 breadth before Day 1 restart E2E passes.
- No final completion claim while lint/typecheck/fast/E2E/build or acceptance
  evidence is missing; unverified items are reported explicitly.
