# Aptiloop

Aptiloop is being specified as a local-first, single-user learning system for building durable technical skill through authored courses, deliberate practice, deterministic evidence, and optional AI assistance.

This branch is a documentation and audit milestone. The runnable application is still the **Dev Learning Harness**: its package names, routes, hardcoded Russian interface, bundled curriculum, and provider adapters have not been migrated to the Aptiloop Core Alpha architecture. The bundled curriculum is development content, not a production course.

## Status vocabulary

Every current specification uses one of four labels:

- **Implemented baseline** — behavior observed in the current Dev Learning Harness.
- **Approved Core Alpha target** — a binding product contract for later implementation.
- **Proposed pending owner approval** — a recommendation that must not be implemented as settled scope yet.
- **Future** — intentionally outside Core Alpha.

Do not infer implementation from a target specification.

## Runnable baseline

**Implemented baseline**

The current repository is an npm/Turborepo monorepo with:

- a Next.js web application and Hono orchestrator;
- local SQLite persistence;
- a versioned learning path with immutable session snapshots;
- briefing, study, recall, Teacher dialogue, quiz, code-reading, exercise, review, interview, and summary flows;
- deterministic unit progression, summary derivation, and mastery rules;
- isolated exercise attempts, a Git baseline and diff, an allowlisted test command, and read-only review;
- a draft curriculum editor with clone, validation, ordering, and immutable publish behavior;
- Mock, Codex app-server, and OpenCode provider adapters.

The current interview report records completion and answer form. It does **not** establish technical correctness or change mastery. The current provider boundary is not the approved Pi/tool boundary, current course import/export does not exist, and the current editor is not yet Adaptive Studio.

## Core Alpha direction

**Approved Core Alpha target**

Core Alpha is local-first and single-user. `Course` is the top-level entity. Published course revisions are immutable; each learner has a personal adaptation branch; learning is a finite activity graph; and the deterministic Learning Kernel owns progression, evidence interpretation, review scheduling, and mastery. Course content is carried by declarative, validated Course Packs. Packs contain no commands, scripts, secrets, or plugins.

Pi is the model/runtime layer behind Aptiloop-owned typed tools. It is not the product domain, permission system, or a general coding-agent surface. AI roles receive no arbitrary filesystem, shell, network, or edit tools. Reviewer is read-only and cannot apply patches. Real-provider failure is explicit; there is no silent fallback to Mock. Private learner data stays local unless the user explicitly exports or shares it.

The runtime research is pinned to official `@earendil-works/pi-ai`, `@earendil-works/pi-agent-core`, and `@earendil-works/pi-coding-agent` v0.84.1 at [Pi commit `9dd90a49711d088b86fdd9b4aea575913a8328`](https://github.com/earendil-works/pi/tree/9dd90a49711d088b86fdd9b4aea575913a8328). Pi is MIT-licensed but [does not provide a built-in permission system](https://github.com/earendil-works/pi/blob/9dd90a49711d088b86fdd9b4aea575913a8328/README.md#L35-L41). Its documented AgentHarness v2 is not a durable app runtime today: [restore and major operations remain unimplemented](https://github.com/earendil-works/pi/blob/9dd90a49711d088b86fdd9b4aea575913a8328/packages/agent/src/harness/agent-harness.ts#L342-L357). Aptiloop must not design Core Alpha against those unimplemented hooks or treat the separate SQLite session backend as a transparent coding-agent session replacement.

See:

- [Product contract](PRODUCT.md)
- [Core Alpha scope](docs/product/core-alpha-scope.md)
- [User journeys](docs/product/user-journeys.md)
- [Terminology](docs/product/terminology.md)
- [Language policy](docs/product/language-policy.md)
- [Course authoring](docs/product/course-authoring.md)

## Requirements

- Node.js 24 or newer (the package manifest declares `>=24.0.0`)
- npm 11 (the repository pins `npm@11.12.1`)
- Git
- Zed, optional for opening an exercise workspace
- Codex CLI or OpenCode CLI, optional and only for its corresponding current provider adapter
- Docker with Compose, optional for the Mock-oriented container setup

This is an npm-only workspace with one `package-lock.json`. Do not use pnpm, Yarn, or `workspace:*` dependency ranges.

## Run locally

From the repository root:

```sh
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

Open <http://127.0.0.1:3000>. The orchestrator defaults to <http://127.0.0.1:8787>; readiness is exposed at <http://127.0.0.1:8787/health/ready>. The web server rewrites `/api/*` to the orchestrator.

`npm start` invokes `scripts/dev-local.mjs`, attempts to start the current OpenCode sidecar, and then launches the local development stack. A root `.env` is optional; copy `.env.example` only when local overrides are needed.

Back up a valuable existing database before migration:

```sh
npm run db:backup
npm run db:migrate
npm run db:seed
```

The current backup command uses SQLite `VACUUM INTO`, verifies integrity and foreign keys for source and copy, and does not overwrite an existing backup.

## Root commands

These commands exactly match the root `package.json` scripts:

```sh
npm run build         # turbo run build
npm run dev           # development tasks in parallel
npm start             # local launcher script
npm run format        # write formatting changes
npm run format:check  # check formatting
npm run lint
npm run typecheck
npm test              # fast tests, then E2E
npm run test:fast     # Turbo unit/integration/component tests
npm run test:e2e      # isolated Playwright wrapper
npm run db:generate
npm run db:backup
npm run db:migrate
npm run db:seed
npm run verify        # format check, lint, typecheck, fast tests, build; excludes E2E
```

The Playwright wrapper uses the web workspace configuration, isolated ports and data, zero retries, and restores `apps/web/next-env.d.ts` after either success or failure.

## M0 audit evidence

**Implemented baseline**, observed for this audit on `docs/core-alpha-audit`:

- clean local `old` and `main` both preserved commit `053dcd0`;
- `npm install` succeeded and left Git clean;
- a disposable SQLite database migrated successfully and seeded twice, yielding 7 days and 14 topics;
- `npm run verify` passed formatting, 12/12 lint tasks, 12/12 typecheck tasks, 21/21 fast-test tasks totaling 352 tests, and 12/12 build tasks; the web build produced 12 static Next routes;
- `npm run test:e2e` was **red**: 1 test passed and 3 failed. Day 1 could not find `Plan day`; Curriculum Editor timed out waiting for create revision amid repeated navigation; Interview could not find the default studied-scope radio;
- a disposable 1440×900 browser smoke loaded Home, started a session, opened the plan drawer, and showed no observed console errors;
- at 390×844 there was no horizontal overflow, but Home was a dense 3534 px page and the mobile navigation was overfull;
- `npm audit` reported 6 vulnerabilities: 4 high, 1 moderate, and 1 low. Relevant locked versions include Hono 4.12.33, Next 16.2.12, nested PostCSS 8.4.31, sharp 0.34.5, nanoid 3.3.16, and tsup esbuild 0.27.7;
- the GitHub API showed zero issues and zero pull requests; no CI workflow is committed.

E2E is not green, dependency approval is not complete, and this M0 documentation set is not a release approval.

## Privacy and trust boundary

The current application is intended for trusted local use. Browser requests must never supply executables, argument vectors, working directories, filesystem handles, credentials, or raw provider RPC. Paths remain canonical and contained. Child processes remain allowlisted, `shell: false`, bounded by time/output limits, and cleaned up. An allowlist prevents command injection; it does not sandbox trusted JavaScript fixtures.

**Approved Core Alpha target:** Course Packs and activities are data, never executable authority. Environment execution uses app-owned contracts and trusted check IDs. Provider credentials stay outside packs and learner records. No private course, source, workspace, evidence, transcript, or profile data is uploaded or shared without an explicit user action.

## Approval state

Core Alpha remains behind product, architecture, security, data-migration, runtime/provider, design, dependency, licensing, and E2E gates. Recommended visual direction **A. Calm Workshop** is **Proposed pending owner approval**. The licensing recommendation is also **Proposed pending owner approval** and requires legal review; this repository currently has no project license grant. Do not add or infer a license until that gate is resolved.
