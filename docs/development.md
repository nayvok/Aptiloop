# Разработка

## Локальная среда

Проект требует Node.js 24+, npm 11+, Git и использует один `package-lock.json`.

```powershell
Copy-Item .env.example .env
npm install
npm run db:inventory -- --db .data/dev-learning-harness.sqlite   # existing file only
npm run db:backup -- --source .data/dev-learning-harness.sqlite --destination .data/approved-backups/pre-migration-2026-08-08T120000Z.sqlite
npm run db:migrate
npm run db:seed
npm run dev
```

`npm run dev` параллельно запускает Next.js на `127.0.0.1:3000` и Hono на `127.0.0.1:8787`. Next server-side rewrite направляет `/api/*` к `ORCHESTRATOR_URL`.

## Переменные окружения

| Переменная                 | Default                             | Назначение                                                                            |
| -------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------- |
| `HOST`                     | `127.0.0.1`                         | bind orchestrator; loopback — security default                                        |
| `PORT`                     | `8787`                              | orchestrator port                                                                     |
| `WEB_ORIGIN`               | `http://127.0.0.1:3000`             | разрешённый browser Origin (любой loopback хост на том же порту)                      |
| `ORCHESTRATOR_URL`         | `http://127.0.0.1:8787`             | Next rewrite target                                                                   |
| `NEXT_DIST_DIR`            | `.next`                             | isolated Next output; E2E supplies a launcher-owned path                              |
| `NODE_ENV`                 | unset                               | `development`/`test` explicitly permit Mock; other values are no-AI                   |
| `DATABASE_URL`             | `.data/dev-learning-harness.sqlite` | M1 accepts only this active path; Compose accepts `/data/dev-learning-harness.sqlite` |
| `WORKSPACE_ROOT`           | `workspaces/exercises`              | trusted exercise templates                                                            |
| `EXERCISE_ATTEMPTS_ROOT`   | `.data/exercise-attempts`           | изолированные learner copies                                                          |
| `ZED_EXECUTABLE`           | `zed`                               | executable/path, не shell-строка                                                      |
| `OPENCODE_ENDPOINT`        | `http://127.0.0.1:4096`             | только HTTP loopback sidecar                                                          |
| `OPENCODE_SERVER_USERNAME` | `opencode`                          | Basic Auth username                                                                   |
| `OPENCODE_SERVER_PASSWORD` | отсутствует                         | secret только в environment                                                           |

Не передавайте секреты через UI/settings. Codex использует локальное auth-хранилище CLI.

## SQLite root, inventory, backup, and legacy repair

The active M1 database is `<repo>/.data/dev-learning-harness.sqlite`. Runtime and writable database CLIs reject every alternate family before opening it; `DATABASE_PROJECT_ROOT` is not supported. Do not use a workspace-relative candidate, newest timestamp, or old backup automatically. Inventory every explicit family without mutation, then preflight the active candidate separately:

```powershell
npm run db:inventory -- --root .data --root data --root packages/database/.data
npm run db:inventory -- --db .data/dev-learning-harness.sqlite
npm run db:backup -- --source .data/dev-learning-harness.sqlite --destination .data/approved-backups/pre-migration-2026-08-08T120000Z.sqlite
npm run db:migrate
npm run db:seed
```

Choose a fresh backup filename for each run. The backup command rejects every non-active source and every destination outside `.data/approved-backups`, refuses overwrite, and requires stable source identity, SQLite health, the exact migration ledger, complete `agent_messages`/`reviews` tables, and zero prohibited private-payload rows in the produced artifact. Five alternate families and eleven old backups remain unchanged and quarantined until M2; `.data/m0-baseline` is protected.

`db:migrate` and `db:seed` can write only the active M1 path and fail before opening alternate candidates. They can change persisted bytes, so run them only after an approved backup. Tests use an explicit disposable mode; the E2E launcher admits only its exact owned run path. Seed is idempotent by stable ID.

## Проверки

```powershell
npm run format:check
npm run lint
npm run typecheck
npm run test:fast
npm run test:e2e
npm run build
```

`npm run verify` выполняет format/lint/typecheck/fast tests/build, но намеренно не E2E. `npm test` выполняет fast tests и E2E. Turbo cache для задачи `test` отключён, поэтому `test:fast` действительно запускает suites, а не подтверждает прошлый результат из кэша.

Точечные примеры:

```powershell
npm run test --workspace=@dlh/database
npm run test --workspace=@dlh/orchestrator
npm run typecheck --workspace=@dlh/web
```

## Playwright data isolation and serialized ports

`scripts/test-e2e.mjs` creates one unique launcher-owned directory under `.data/e2e-runs/` and supplies an exact run ID/root/database contract to `apps/web/playwright.config.ts`:

- fixed lock-serialized loopback ports: web `127.0.0.1:3100`, orchestrator `127.0.0.1:8887`; the launcher fails closed if either is occupied, so parallel E2E launchers are not supported;
- file-backed `database.sqlite`, attempt workspaces, Next output, service records, and logs inside the owned run root;
- `NODE_ENV=test` plus exact path equality before the orchestrator admits the disposable database;
- `reuseExistingServer: false`, `fullyParallel: false`, `retries: 0`;
- `trace: retain-on-failure`.

The wrapper preserves the tracked `apps/web/next-env.d.ts` and restores it in `finally`. A successful run removes its entire owned root. A failed run first moves only Playwright results/traces and service logs to `.verify/e2e-failures/<run-id>/`, writes non-secret failure metadata, then removes the database, attempts, Next output, and original run root. CI uploads retained diagnostics. If artifact preservation itself fails, the wrapper fails closed and leaves the owned run root for diagnosis.

## Изменение контрактов

1. Измените Zod schema/DTO в `packages/shared`.
2. Обновите database repository/migration и boundary tests.
3. Обновите orchestrator mapping; raw provider event не должен попадать в response.
4. Обновите web и component/E2E tests.
5. Если меняются command/env/provider/security/curriculum schema — обновите соответствующий файл `docs/` и `.env.example`.

Reference answer/quiz key нельзя добавлять в learner DTO или Teacher/interview generation context до сохранения собственного ответа.

## Docker

```powershell
docker compose config
docker compose up --build
docker compose ps
docker compose logs -f orchestrator web
```

Compose uses `npm ci`, loopback-only host publication, and the `harness-data`/`harness-attempts` named volumes. Explicit `ORCHESTRATOR_BIND_MODE=container-loopback-published` permits only the orchestrator's internal `0.0.0.0` service bind. The environment is Mock-oriented; M1 blocks Codex/OpenCode from learning roles, and `npm start`/Compose do not launch an external sidecar.
