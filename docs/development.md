# Development

**Document status:** **Implemented baseline** for the current local development workflow.

## Prerequisites

- Node.js 24 or newer
- npm 11 or newer
- Git
- PowerShell for the Windows examples below

Use npm workspaces and the single root `package-lock.json`. Do not use pnpm, Yarn, `workspace:*`, or `--legacy-peer-deps`.

## Start a fresh local profile

From the repository root:

```powershell
npm ci
npm run dev
```

No `.env` file is required. The local launcher selects explicit development mode, and the orchestrator uses loopback-only defaults plus the fixed `.data/dev-learning-harness.sqlite` data path. On a genuinely fresh development profile it creates the database, applies current migrations, and idempotently installs the two validated Aptiloop Dev Tour Course Packs. Set `APTILOOP_DEV_SEED_CURRICULUM=1` to additionally opt in to the legacy versioned development curriculum, or run `npm run db:seed` explicitly.

Use `.env.example` only as a reference for optional local overrides. Do not copy it merely to start Aptiloop, and never commit a populated `.env` file.

Before starting, verify that an existing `.data/dev-learning-harness.sqlite` is the intended active profile. Startup never silently adopts another database or upgrades a valuable predecessor database without the approved migration capability.

The explicit `db:migrate` and `db:seed` commands are maintenance and development-fixture operations, not fresh-install prerequisites. Run `db:seed` only when the active database is absent or explicitly disposable; do not seed an existing valuable or published-content database.

Use the bare migration command only for that absent/disposable database or to verify an exact current database without seeding it. If `.data/dev-learning-harness.sqlite` already contains valuable predecessor data, stop and follow [Current Database Operations](migration/current-database-operations.md); the authorized command requires `--authorize-current`, `--approved-backup`, and `--backup-sha256`.

`npm run dev` starts Next.js at `127.0.0.1:3000` and the Hono orchestrator at `127.0.0.1:8787`. Next rewrites `/api/*` to `ORCHESTRATOR_URL`.

## Start the local production build

From a clean clone, the supported local-user flow is:

```powershell
npm ci
npm start
```

The production launcher builds the workspaces and then starts the built web UI on `127.0.0.1:10101` (override with `APTILOOP_PORT`) and the orchestrator on `127.0.0.1:8787` (override with `APTILOOP_ORCHESTRATOR_PORT`) under the same sanitized environment. It forces `NODE_ENV=production`, fixed loopback endpoints, and repository-owned data/workspace paths during both build and runtime; it does not load `.env`, expose development Mock, or seed the development curriculum. If either service exits, the launcher terminates the sibling process tree. On Unix, it sends `SIGTERM` to the detached service groups and allows 30 seconds for provider turns and trusted checks to drain before escalating to `SIGKILL`. On Windows, `Ctrl+C` reaches the shared console children directly; the launcher observes them for the same 30-second drain window before using `taskkill /T /F` as a forced fallback, then exits.

On Unix desktop sessions, only the orchestrator runtime receives `DISPLAY`, `WAYLAND_DISPLAY`, `XDG_RUNTIME_DIR`, and `DBUS_SESSION_BUS_ADDRESS` so it can launch the configured local editor. These variables are not supplied to the production build or web service, and provider secrets, proxy credentials, `NODE_OPTIONS`, and SSH-agent variables remain excluded.

Use `npm run dev` only for repository development. It intentionally uses watchers and the explicit development composition, including development fixtures and deterministic Mock where policy permits.

## Installed npm workflow

**Document status:** **Implemented baseline** for the local installed-runtime workflow.

Install the published CLI package (Node.js 24+):

```powershell
npm install --global aptiloop
aptiloop init
aptiloop start --open
```

`aptiloop init` checks Node and the build/runtime files, selects the OS data directory unless `--data-dir` or `APTILOOP_DATA_DIR` is set, and records the preferred loopback pair. The first unpinned start (or background service start) tries the preferred pair and a bounded fallback range only when a bind collision is observed; once both services are ready, the actual pair is persisted and later starts stay on it. Explicit `--port`, `--orch-port`, `APTILOOP_PORT`, and `APTILOOP_ORCHESTRATOR_PORT` values are pinned and never hop. Use `aptiloop config show` to inspect the effective paths and ports, and `aptiloop config reset-ports` to explicitly re-arm automatic first-start selection.

The browser is `http://127.0.0.1:<web-port>` and the orchestrator readiness endpoint is `http://127.0.0.1:<orchestrator-port>/health/ready`. `aptiloop status`, `aptiloop health --wait`, `aptiloop open`, and `aptiloop stop` are the supported lifecycle commands. `aptiloop service install --autostart` followed by `aptiloop service start` installs a user-level background service (launchd/systemd/Task Scheduler); `aptiloop service status|stop|restart|uninstall` manages it without deleting the data directory.

The data directory contains `config.json`, `runtime-state/` logs and status, SQLite data (the configured `DATABASE_URL` path), update operation records, and bounded update evidence. Provider credentials remain in the app-owned protected credential store; do not copy the data directory while services are writing. Use the approved database backup/export procedures for durable migration or machine recovery.

Check and apply a release explicitly:

```powershell
aptiloop update check
aptiloop update apply --version vX.Y.Z
aptiloop status
aptiloop health --wait
```

The CLI asks the running orchestrator to verify the exact tag and waits for the operation ID. The updater creates a non-overwriting, integrity/foreign-key/schema/migration-ledger-verified database snapshot, downloads the platform bundle, checks the release manifest and SHA-256 digests, migrates and health-checks an isolated candidate, switches the pointer/database atomically, and verifies post-switch readiness. A failed operation records rollback evidence and restores the previous runtime/database when an approved backup exists; inspect `updates/operations/` and `updates/evidence/<operation-id>/` before retrying. Updates never auto-apply.

For the loopback Compose topology, update the image explicitly and keep the paired private volumes together:

```powershell
docker compose config
docker compose build --pull
docker compose up -d
docker compose ps
docker compose logs -f orchestrator web
```

Before a Compose update or host migration, follow [Self-Hosting Aptiloop](../SELF_HOSTING.md#loopback-compose-backup-and-restore) for the paired cold backup/restore procedure. Do not copy a live SQLite file or restore the database volume without its matching private runtime volume.

## Local configuration

| Variable                 | Default                             | Purpose                                                                  |
| ------------------------ | ----------------------------------- | ------------------------------------------------------------------------ |
| `HOST`                   | `127.0.0.1`                         | Orchestrator bind; direct mode rejects non-loopback hosts.               |
| `PORT`                   | `8787`                              | Orchestrator port.                                                       |
| `WEB_ORIGIN`             | `http://127.0.0.1:10101`            | Exact browser Origin accepted for mutations.                             |
| `ORCHESTRATOR_URL`       | `http://127.0.0.1:8787`             | Next server-side API target.                                             |
| `NEXT_DIST_DIR`          | `.next`                             | Next output; E2E supplies an isolated launcher-owned directory.          |
| `NODE_ENV`               | `development` via local launcher    | Explicit `development`/`test` permits deterministic Mock; otherwise Off. |
| `DATABASE_URL`           | `.data/dev-learning-harness.sqlite` | Fixed process-mode writable database.                                    |
| `WORKSPACE_ROOT`         | `workspaces/exercises`              | Trusted repository exercise templates.                                   |
| `EXERCISE_ATTEMPTS_ROOT` | `.data/exercise-attempts`           | Server-created learner workspaces.                                       |
| `ZED_EXECUTABLE`         | `zed`                               | Local editor executable or path; never a shell command.                  |

Do not bind the app to `0.0.0.0` in direct mode or expose its ports to a LAN, tunnel, or public proxy. The current app has no authentication.

## Provider connections and credentials

AI Off is a supported state. Lesson-scoped Tutor, Interview, Review, and Course Designer callers resolve one exact server-owned RoleProfile, connection, model, and required capability set. Failure remains explicit; no provider/model/Mock fallback occurs.

Use **Settings → AI connections** to add a managed connection, submit an API key or complete a supported subscription sign-in, and assign exact models to roles. Secret values travel only in the explicit loopback mutation, are stored connection-scoped in `.data/provider-credentials.json`, and are never returned by Settings or stored in SQLite, Course Packs, prompts, logs, or browser persistence. Windows protects the whole file with current-user DPAPI and fails closed if protection is unavailable. POSIX and Linux Compose storage remains plaintext with an owner-only mode request. Settings also exposes explicit key replacement and local connection removal. Local removal does not revoke a token at the upstream provider; use that provider's account controls when revocation is required.

Catalog presence or health metadata is not proof of a successful model request. Record a real-provider smoke only after observing the exact authenticated provider/model request.

## Verification

Run the smallest focused command that proves a change, then the applicable root gates:

```powershell
npm run format:check
npm run lint
npm run typecheck
npm run test:fast
npm run build
npm run test:e2e
```

`npm run verify` runs format check, lint, typecheck, fast tests, build, and the production content check. It does not run E2E. `npm test` runs fast tests followed by E2E.

Focused examples:

```powershell
npm run test --workspace=@aptiloop/database
npm run test --workspace=@aptiloop/orchestrator
npm run typecheck --workspace=@aptiloop/web
```

## E2E isolation

`scripts/test-e2e.mjs` owns one disposable root under `.data/e2e-runs/`, a file-backed SQLite database, attempt workspaces, Next output, and logs. It uses lock-serialized loopback ports `3100` and `8887`, `reuseExistingServer: false`, `fullyParallel: false`, and `retries: 0`.

Successful runs remove their owned root. Failed runs retain bounded Playwright results and service logs under `.verify/e2e-failures/<run-id>/`, then remove the disposable database and runtime outputs. Do not delete a lock instead of stopping its verified owner, and do not enable retries to hide a flake.

## Contract changes

1. Update the strict shared schema/DTO.
2. Update every caller and database repository/migration in the same change.
3. Keep filesystem, Git, process, provider, credential, and database authority in the orchestrator.
4. Add permitted-path and rejection-path tests, including malformed input, cross-scope IDs, stale hashes, denied tools, redaction, unavailability, and cancellation where applicable.
5. Update the current product, architecture, security, data, authoring, or operations specification.

Protected answers and quiz keys must not enter learner DTOs or Tutor/Interview context before the learner's own attempt is persisted.

## Compose

```powershell
docker compose config
docker compose up --build
docker compose ps
docker compose logs -f orchestrator web
```

The committed Compose topology is loopback-only local packaging, not authenticated self-hosting. It needs no `.env`, builds production-only runtime stages, omits development dependencies and repository fixtures, and opens a fresh empty Course library. Its database and private runtime volumes require the separate cold paired recovery procedure in [Self-Hosting Aptiloop](../SELF_HOSTING.md#loopback-compose-backup-and-restore); that private archive can include the POSIX plaintext provider credential file and is not a sanitized data export.
