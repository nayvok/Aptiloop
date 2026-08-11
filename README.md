# Aptiloop

Aptiloop is a local-first, single-user system for building durable technical skill through authored Courses, deliberate practice, deterministic evidence, and optional AI assistance.

## Project status

**Implemented baseline**

The runnable application and npm workspace carry the Aptiloop identity. The M1–M11 platform boundaries and the 2026-08-12 UI/UX and runtime hardening are implemented in the current repository. The application includes Course-based learning, immutable published revisions, deterministic progression and review scheduling, safe Course Pack intake, Adaptive Studio, constrained Provider Hub roles, and complete `en-US`/`ru-RU` UI catalogs.

**Approved Core Alpha target**

Core Alpha release acceptance remains open. A typed Review Activity executor is not implemented, so the Review queue fails closed instead of inventing a learner-session link. Professional legal review, approved license/notices/content/trademark artifacts, approved production Course content, distribution authorization, and owner sign-off also remain required. No Core Alpha release has been accepted or published.

Current specifications use these labels exactly:

- **Implemented baseline** — behavior observed in the repository or runtime;
- **Approved Core Alpha target** — a binding target that is not necessarily implemented;
- **Proposed pending owner approval** — a recommendation awaiting an owner decision;
- **Future** — work outside Core Alpha.

Do not infer implementation or release acceptance from a target specification.

## What runs today

- Next.js presentation in `apps/web` and a Hono orchestrator in `apps/orchestrator`;
- local SQLite persistence with explicit Course, revision, session, evidence, review, adaptation, and provider ownership;
- finite Activity Graph learning with deterministic progression, mastery, mistakes, review scheduling, and next-action selection;
- briefing, study, recall, Tutor dialogue, quiz, code-reading, trusted exercise, interview, and summary activities;
- strict single-file Course Pack validation, Preview, Install, Open as draft, export, and confirmed uninstall;
- Adaptive Studio manual authoring, learner-safe Preview, immutable Publish/clone history, personal adaptations, and reviewable typed Course Designer proposals;
- constrained Provider Hub roles with exact model resolution, operation-scoped external disclosure approval consumed once, explicit AI Off/unavailable states, and no silent Mock fallback;
- trusted local Node/Python checks with isolated attempts, Git evidence, bounded processes, and evidence-only review;
- a responsive five-destination shell: Home, Courses, Review, Skills, and Settings.

The interview report records completion and answer form; it does not establish technical correctness or directly change mastery. Trusted local execution is not a hostile-code sandbox. Production Course content is not bundled or approved.

### Package identity and compatibility names

The root package is `aptiloop`, and internal workspaces use `@aptiloop/*`. Some durable names intentionally retain the original harness identity, including `.data/dev-learning-harness.sqlite`, Docker volume names, the migration ledger, persisted fingerprint domains, and browser draft keys. They are compatibility boundaries, not current product identity, and may change only through an approved additive migration with backup and rollback evidence.

## Requirements

- Node.js 24 or newer;
- npm 11 (`npm@11.12.1` is pinned by the repository);
- Git;
- Zed, optional for external exercise editing;
- Docker with Compose, optional for loopback-only local packaging.

This is an npm-workspaces repository with one `package-lock.json`. Do not use pnpm, Yarn, or `workspace:*` dependency ranges.

## Run locally

From the repository root:

```sh
npm install
npm run dev
```

Open <http://127.0.0.1:3000>. The orchestrator defaults to <http://127.0.0.1:8787>, and readiness is available at <http://127.0.0.1:8787/health/ready>. `npm start` launches the same local Aptiloop stack. Neither command starts Codex, OpenCode, or another external sidecar.

A genuinely fresh installation can bootstrap a new active database. An existing installation must pass the exact database admission gate; startup never silently repairs or selects another database. Follow [Current database operations](docs/migration/current-database-operations.md) before changing valuable data.

Configure optional AI under **Settings → Connections**. Credentials remain in the app-owned local credential store and are never returned to the browser. Each role resolves one exact available model, and every external role turn requires an exact operation-scoped disclosure approval that is consumed once. See [Provider connections](docs/providers.md).

## Common commands

```sh
npm run dev                 # local development stack
npm start                   # local Aptiloop stack
npm run build               # all workspace builds
npm run format:check        # Prettier check
npm run lint                # all workspace lint tasks
npm run typecheck           # all workspace type checks
npm run test:fast           # unit, integration, component, and policy tests
npm run test:e2e            # lock-serialized Playwright suite
npm test                    # fast tests followed by E2E
npm run verify              # format, lint, typecheck, fast tests, build; no E2E
npm run audit:policy        # dependency policy reports
npm run sbom                # CycloneDX npm SBOM
npm run db:inventory        # explicit read-only SQLite inventory
npm run db:backup           # explicit non-overwriting approved backup
npm run db:migrate          # fresh bootstrap or explicitly authorized migration
npm run db:seed             # idempotent seed; not a schema upgrade
```

The E2E launcher uses disposable data and fixed lock-serialized loopback ports `3100` and `8887`. It uses zero retries and retains bounded failure diagnostics under `.verify/e2e-failures/`.

## Safety and data boundaries

- Aptiloop is supported only on loopback for one trusted local user. It has no authentication or authorization; do not expose it to a LAN, tunnel, public proxy, or the Internet.
- Browser mutations send entity and operation IDs, never executable names, argument vectors, working directories, filesystem handles, credentials, or provider RPC.
- Course Packs are untrusted declarative data. They contain no commands, scripts, plugins, secrets, credentials, or absolute local paths.
- AI roles receive only Aptiloop-owned typed tools. Pi is a model runtime, not the permission boundary, and general coding-agent tools are not exposed.
- Reviewer is read-only and receives a bounded evidence capsule. It cannot edit files, apply patches, or return a patch through an execution route.
- Child processes use app-owned plans with `shell: false`, a minimal environment, timeout, output cap, cancellation, and process-tree cleanup. The trusted local backend remains unsandboxed.
- Private Course data, learner evidence, transcripts, workspaces, and profiles stay local unless the user explicitly approves a named payload and destination.
- Real-provider failure is explicit. Mock is limited to tests, CI, and development and is never a silent production fallback.

Before any authorized migration of a valuable database, follow [Current database operations](docs/migration/current-database-operations.md): stop writers, inventory the explicit active source, and create a new non-overwriting active-source-only backup.

```sh
npm run db:inventory -- --db .data/dev-learning-harness.sqlite
npm run db:backup -- --source .data/dev-learning-harness.sqlite --destination .data/approved-backups/<new-name>.sqlite
npm run db:migrate -- --authorize-current --approved-backup .data/approved-backups/<new-name>.sqlite --backup-sha256 <sha256>
```

Never use a quarantined candidate or old backup automatically. There is no supported down migration; recovery is a stopped-writer whole-file restore from the explicitly approved pre-migration backup and loses later writes.

## Current release blockers and limitations

- The Review queue and due-state projection exist, but the typed Review Activity executor does not. The UI therefore withholds an invalid next-action link.
- Course Pack validation staging is process-local; a restart can require the user to reselect the file, and crash-orphan cleanup remains bounded rather than durable.
- No fresh authenticated external-provider smoke was run for implementation commit `b542b32`; the 2026-08-10 OpenCode Zen smoke is historical evidence for its own cutoff.
- Course Designer and Interview provider-disclosure recovery have integration/remount evidence only; the focused Browser runs used AI Off and do not establish live provider-backed recovery.
- Trusted Node/Python execution is local and unsandboxed.
- Historical ambiguous migration rows remain quarantined rather than promoted to Course truth.
- Accessibility semantics, keyboard behavior, contrast, reduced motion, and responsive layouts have automated and browser evidence, but no independent full WCAG 2.2 AA certification is claimed.
- No production Course, public distribution, project license grant, or public/LAN hosting profile is approved.

See the [2026-08-12 UI/UX and runtime hardening audit](docs/audits/2026-08-12-ui-ux-runtime-hardening.md) for current verification evidence and the [roadmap](ROADMAP.md) for milestone and release-gate status.

## Documentation

- [Documentation index](docs/README.md)
- [Product contract](PRODUCT.md)
- [Architecture](ARCHITECTURE.md)
- [Design system](DESIGN.md)
- [Security policy](SECURITY.md)
- [Self-hosting and deployment boundary](SELF_HOSTING.md)
- [Current database operations](docs/migration/current-database-operations.md)
- [Roadmap](ROADMAP.md)
- [Architecture decision records](docs/adr/README.md)

The repository currently grants no project license. `private: true` prevents accidental npm publication; it is not a license grant.
