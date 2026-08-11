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
Copy-Item .env.example .env
npm ci
npm run db:migrate
npm run db:seed
npm run dev
```

Before running this block, verify that `.data/dev-learning-harness.sqlite` is absent or is an explicitly disposable development database with no valuable data. `db:seed` is permitted only under that precondition. Do not seed an existing valuable or published-content database.

Use the bare migration command only for that absent/disposable database or to verify an exact current database without seeding it. If `.data/dev-learning-harness.sqlite` already contains valuable predecessor data, stop and follow [Current Database Operations](migration/current-database-operations.md); the authorized command requires `--authorize-current`, `--approved-backup`, and `--backup-sha256`.

`npm run dev` starts Next.js at `127.0.0.1:3000` and the Hono orchestrator at `127.0.0.1:8787`. Next rewrites `/api/*` to `ORCHESTRATOR_URL`.

## Local configuration

| Variable                 | Default                             | Purpose                                                                  |
| ------------------------ | ----------------------------------- | ------------------------------------------------------------------------ |
| `HOST`                   | `127.0.0.1`                         | Orchestrator bind; direct mode rejects non-loopback hosts.               |
| `PORT`                   | `8787`                              | Orchestrator port.                                                       |
| `WEB_ORIGIN`             | `http://127.0.0.1:3000`             | Exact browser Origin accepted for mutations.                             |
| `ORCHESTRATOR_URL`       | `http://127.0.0.1:8787`             | Next server-side API target.                                             |
| `NEXT_DIST_DIR`          | `.next`                             | Next output; E2E supplies an isolated launcher-owned directory.          |
| `NODE_ENV`               | unset                               | Explicit `development`/`test` permits deterministic Mock; otherwise Off. |
| `DATABASE_URL`           | `.data/dev-learning-harness.sqlite` | Fixed process-mode writable database.                                    |
| `WORKSPACE_ROOT`         | `workspaces/exercises`              | Trusted repository exercise templates.                                   |
| `EXERCISE_ATTEMPTS_ROOT` | `.data/exercise-attempts`           | Server-created learner workspaces.                                       |
| `ZED_EXECUTABLE`         | `zed`                               | Local editor executable or path; never a shell command.                  |

Do not bind the app to `0.0.0.0` in direct mode or expose its ports to a LAN, tunnel, or public proxy. The current app has no authentication.

## Provider connections and credentials

AI Off is a supported state. Active Chat, Interview, Review, and Course Designer callers resolve one exact server-owned RoleProfile, connection, model, and required capability set. Failure remains explicit; no provider/model/Mock fallback occurs.

Use **Settings → AI connections** to add a managed connection, submit an API key or complete a supported subscription sign-in, and assign exact models to roles. Secret values travel only in the explicit loopback mutation, are stored connection-scoped in `.data/provider-credentials.json`, and are never returned by Settings or stored in SQLite, Course Packs, prompts, logs, or browser persistence. Settings also exposes explicit key replacement and sign-out/revocation. Treat the local credential file as plaintext private data.

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

`npm run verify` runs format check, lint, typecheck, fast tests, and build. It does not run E2E. `npm test` runs fast tests followed by E2E.

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

The committed Compose topology is loopback-only local packaging, not authenticated self-hosting. Its database and attempt volumes require the separate cold paired recovery procedure in [Self-Hosting Aptiloop](../SELF_HOSTING.md#loopback-compose-backup-and-restore).
