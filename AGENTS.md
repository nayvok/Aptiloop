# Repository Agent Rules

## Authority and status

These rules apply to every repository task. Read `README.md` and `PRODUCT.md` before changing behavior. The current application and npm workspace carry the Aptiloop identity. M1–M11 platform boundaries and the dated 2026-08-12 UI/UX/runtime hardening are an **Implemented baseline**; Core Alpha release acceptance remains an **Approved Core Alpha target**. Every current specification section must state its own status explicitly.

Use these status labels exactly:

- **Implemented baseline**
- **Approved Core Alpha target**
- **Proposed pending owner approval**
- **Future**

Never claim a target is implemented without direct runtime evidence.

## OMP-native workflow

- Use the Oh My Pi (OMP) harness and its repository tools.
- Do not use, recommend, invoke, or recreate Superpowers, Caveman, or their planning/development methodologies.
- Treat committed `.superpowers` and `docs/superpowers` material as historical, non-authoritative artifacts.
- Reuse current repository conventions; do not introduce a second architecture beside an existing seam.
- Prefer incremental migration with explicit compatibility and rollback over a big-bang rewrite.
- Do not overwrite unrelated work or delete historical data to simplify a migration.
- Keep documentation in English unless editing an explicitly localized Course resource.

## Product boundaries

**Approved Core Alpha target**

- Core Alpha is local-first and single-user.
- `Course` is the top-level entity; published Course Revisions are immutable.
- Learner changes belong to a personal Adaptation Branch.
- Learning uses a finite Activity Graph.
- The deterministic Learning Kernel owns progression, evidence reduction, mastery, review scheduling, and next-action selection.
- Course Packs are declarative and validated. They contain no commands, scripts, secrets, executable plugins, provider credentials, or absolute local paths.
- No production Course ships until content, provenance, safety, and licensing gates are approved.
- UI locale (`en-US` or `ru-RU`) is independent from one primary Course locale.
- Private data stays local unless the user explicitly exports or shares a named payload to a named destination.

Do not add cloud sync, authentication, collaboration, organizations, marketplace behavior, an embedded IDE/terminal, arbitrary command execution, or multi-user state to Core Alpha.

## Repository seams to preserve

- `apps/web` — Next.js presentation and browser state.
- `apps/orchestrator` — Hono HTTP/SSE composition and app-owned runtime policies.
- `packages/shared` — boundary schemas and DTO contracts.
- `packages/learning-core` — deterministic learning rules.
- `packages/agent-core` — current provider contract and normalized events.
- `packages/codex-provider` and `packages/opencode-provider` — retained legacy provider adapters; they must not bypass the active Provider Hub/Pi boundary.
- `packages/exercise-core` — canonical paths, isolated attempts, Git evidence, allowlisted runner, and editor launch.
- `packages/curriculum` — current versioned development curriculum.
- `packages/database` — SQLite schema, migrations, repositories, seed, and backup.

Migrate through these seams. Do not move database, provider, filesystem, Git, or process authority into the browser.

## Security invariants

- Validate all external data at the boundary with strict schemas.
- Browser mutations send operation and entity IDs, never executable names, argument vectors, working directories, filesystem handles, provider RPC, or credentials.
- Keep canonical path containment and Windows reparse/symlink escape checks.
- Launch child processes with `shell: false`, a fixed app-owned plan, timeout, output cap, minimal environment, cancellation, and process-tree cleanup.
- An allowlist prevents command injection; it is not a sandbox. Execute only trusted, installed environment definitions and checks.
- Preserve isolated learner attempts and immutable trusted templates.
- Preserve server-owned Git baseline identity, complete non-truncated diff evidence, and SHA-256 test/review freshness. Never replace this with timestamps.
- Reviewer is read-only. It receives bounded evidence, has no write/edit/apply tools, and cannot return or apply a patch through an execution route.
- AI roles receive only Aptiloop-owned typed tools. Never expose arbitrary filesystem, shell, network, credential, or general edit tools.
- Pi is a model/runtime dependency behind app-owned policy. Pi has no built-in permission system; Aptiloop must enforce the boundary.
- Do not design against unimplemented AgentHarness v2 hooks, durable driving, or restore semantics.
- Do not treat `@earendil-works/pi-session-backend-sqlite-node` as transparently interchangeable with coding-agent `AgentSession`; integration and migration are application-owned.
- Do not expose `@earendil-works/pi-coding-agent` general read/bash/edit/write tools through Aptiloop.
- Normalize provider events and redact secrets before persistence, logs, errors, and UI delivery. Do not expose raw provider events to the browser.
- Provider/model resolution is server-owned and explicit. A failed or unavailable real provider never silently falls back to Mock.
- Mock is limited to tests, CI, and development.
- Keep credentials in approved local credential stores or environment configuration, never Course Packs, learner records, logs, or browser payloads.
- Do not upload or share Course data, sources, capsules, learner evidence, transcripts, workspaces, or profiles without explicit user action.
- Do not weaken loopback defaults, exact Origin checks, local-client checks, JSON content checks, rate/size limits, or trust-proxy safety.
- Preserve protected-answer redaction and first-attempt-before-hint behavior.

The historical non-review Codex/OpenCode authority and provider-override paths were audit findings. Active AI roles resolve through Provider Hub and constrained Pi policy. Do not re-enable, describe as compliant, or extend a compatibility path that bypasses that boundary.

## Learning and authoring invariants

- Stable IDs identify meaning and are never silently reused.
- Published revisions and session snapshots are immutable.
- Keep authored truth, learner-visible content, protected evaluation material, learner evidence, and model output separate.
- Deterministic state must be replayable from complete persisted facts. LLM output never directly sets mastery or progression.
- A Course Pack imports as untrusted data: enforce schema version, size/count/depth limits, reference integrity, graph finiteness, cycle policy, locale declarations, content hashes, and provenance.
- Unknown activity, evidence, environment, or check types fail closed.
- Environment contracts may declare Node or Python requirements; Course Packs reference trusted environment/check IDs and never embed commands.
- Manual authoring must remain complete without AI.
- AI authoring uses typed proposals against a draft. Applying a proposal and publishing are separate explicit actions. AI cannot publish.
- Preserve source attribution and immutable Source Snapshots/Knowledge Capsules. Never treat a live URL or model answer as silently mutable course truth.
- Keep fixtures and development curriculum distinct from production Course content.

## Data discipline

- SQLite is the Core Alpha store. Keep repository/service boundaries compatible with a later PostgreSQL implementation; do not write SQLite quirks into domain contracts.
- Use additive, forward-only migrations with provenance and quarantine for unmatched legacy rows.
- Inventory candidate databases and make a verified, non-overwriting backup before migrating valuable local data.
- Never edit an applied migration. Never reset, delete, or overwrite user data as a migration strategy.
- Preserve legacy rows until migration reconciliation and rollback evidence are approved.
- Seed operations must be idempotent and must not mutate published content in place.

## UI and language

- Target primary navigation is Home, Courses, Review, Skills, Settings.
- Preserve accessible semantic HTML, keyboard operation, visible focus, WCAG 2.2 AA contrast, reduced motion, and light/dark themes.
- Provide honest loading, empty, offline, no-AI, missing-Core, validation, and error states.
- Do not encode state by color alone.
- UI strings belong in `en-US` and `ru-RU` catalogs. Do not use a Course locale as the UI locale.
- Identifiers, schema keys, activity/evidence types, code, commands, API names, hashes, and check IDs are not localized.
- Complete `en-US`/`ru-RU` catalogs are an **Implemented baseline**. Treat any new learner-facing hardcoded copy outside the catalogs as a regression, not as permission to weaken localization.

## Package and implementation rules

- Use npm workspaces and the single `package-lock.json`; do not use pnpm, Yarn, or `workspace:*` ranges.
- Keep TypeScript strict.
- Keep business rules deterministic, pure where practical, and outside model prompts.
- Avoid unnecessary allocations, copies, and abstraction layers.
- Update every caller during a contract change; do not leave silent aliases or fallback paths unless an approved migration requires them.
- Do not add production dependencies without checking security, license, runtime support, and lockfile impact.
- The repository currently has no granted project license. Do not add license text or infer redistribution rights without an approved legal decision.

## Verification discipline

Run from the repository root and select the smallest command set that proves the change, then run the applicable full gate:

```text
npm run format:check
npm run lint
npm run typecheck
npm run test:fast
npm run test:e2e
npm run build
```

`npm run verify` runs format check, lint, typecheck, fast tests, and build. It does **not** run E2E. `npm test` runs fast tests followed by E2E.

For a database change, use a disposable database to prove the affected contract and rollback/recovery procedure. Before any valuable-data migration, run the explicit read-only inventory and create a new active-source-only approved backup under `.data/approved-backups/`; never use a quarantined candidate or old backup automatically.

For a security boundary, test the permitted path and rejection paths: malformed input, unauthorized IDs, traversal/reparse escapes, stale or truncated diff, denied tools, secret redaction, provider unavailability, and cancellation/cleanup as applicable.

For an external provider smoke, require the exact local installation, authentication, selected provider/model, and an observed request. Never infer success from health metadata. Failure must remain explicit; do not switch to Mock.

Do not call E2E green until `npm run test:e2e` passes. The M0 audit baseline was red (1 passed, 3 failed); M1 runtime evidence must be recorded separately. Do not treat `npm run verify` as E2E evidence.

A Node 24/npm 11 CI workflow is committed, but do not claim a run passed unless its result is observed. The supply-chain job must retain full/production audit JSON and CycloneDX artifacts, report lower/dev findings, and fail on any unapproved production high/critical advisory. Any future exception requires explicit owner and expiry.

## Documentation map

Product specifications:

- `docs/README.md`
- `PRODUCT.md`
- `docs/product/core-alpha-scope.md`
- `docs/product/user-journeys.md`
- `docs/product/terminology.md`
- `docs/product/language-policy.md`
- `docs/product/course-authoring.md`

Decision and evidence indexes:

- `docs/adr/README.md`
- `docs/audits/2026-08-12-ui-ux-runtime-hardening.md`

When behavior changes, update the relevant current product, architecture, security, runtime, data, authoring, or roadmap specification. Preserve historical documents as history; do not cite them as current approval evidence.
