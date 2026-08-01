# Разработка

## Локальная среда

Проект требует Node.js 24+, npm 11+, Git и использует один `package-lock.json`.

```powershell
Copy-Item .env.example .env
npm install
npm run db:backup   # если уже существует file DB
npm run db:migrate
npm run db:seed
npm run dev
```

`npm run dev` параллельно запускает Next.js на `127.0.0.1:3000` и Hono на `127.0.0.1:8787`. Next server-side rewrite направляет `/api/*` к `ORCHESTRATOR_URL`.

## Переменные окружения

| Переменная                 | Default                             | Назначение                                                       |
| -------------------------- | ----------------------------------- | ---------------------------------------------------------------- |
| `HOST`                     | `127.0.0.1`                         | bind orchestrator; loopback — security default                   |
| `PORT`                     | `8787`                              | orchestrator port                                                |
| `WEB_ORIGIN`               | `http://127.0.0.1:3000`             | разрешённый browser Origin (любой loopback хост на том же порту) |
| `ORCHESTRATOR_URL`         | `http://127.0.0.1:8787`             | Next rewrite target                                              |
| `NEXT_DIST_DIR`            | `.next`                             | отдельный Next build/dev output, E2E использует `.next-e2e`      |
| `DATABASE_PROJECT_ROOT`    | repo root                           | root для относительных DB/backup paths                           |
| `DATABASE_URL`             | `.data/dev-learning-harness.sqlite` | SQLite file или `:memory:`                                       |
| `DATABASE_BACKUP_DIR`      | `.data/backups`                     | timestamped verified backups                                     |
| `WORKSPACE_ROOT`           | `workspaces/exercises`              | trusted exercise templates                                       |
| `EXERCISE_ATTEMPTS_ROOT`   | `.data/exercise-attempts`           | изолированные learner copies                                     |
| `ZED_EXECUTABLE`           | `zed`                               | executable/path, не shell-строка                                 |
| `OPENCODE_ENDPOINT`        | `http://127.0.0.1:4096`             | только HTTP loopback sidecar                                     |
| `OPENCODE_SERVER_USERNAME` | `opencode`                          | Basic Auth username                                              |
| `OPENCODE_SERVER_PASSWORD` | отсутствует                         | secret только в environment                                      |

Не передавайте секреты через UI/settings. Codex использует локальное auth-хранилище CLI.

## SQLite: root, backup и legacy repair

Database CLI всегда вычисляет canonical project root. Поэтому команда из корня и npm workspace delegation обращаются к одной `.data/dev-learning-harness.sqlite`, а не к `packages/database/.data`.

```powershell
npm run db:backup
npm run db:migrate
npm run db:seed
```

Backup ищет configured/canonical candidates, отказывается перезаписывать файл, выполняет `PRAGMA integrity_check` и `foreign_key_check` у source, создаёт консистентную копию через `VACUUM INTO` и повторяет проверки у копии.

`db:migrate` применяет SQL по имени и записывает `__dlh_migrations`. После ordered migrations запускается repeatable compatibility repair старых prototype DB: rebuild отсутствующего `unit_type`, snapshot schema v2 normalization и Zod validation. Он не удаляет legacy history. `db:seed` идемпотентен по stable IDs, сохраняет immutable r1/r2 и публикует revision 3 первой недели, не переписывая snapshot активной сессии.

Если `DATABASE_URL=:memory:`, backup неприменим.

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

## Playwright isolation

`apps/web/playwright.config.ts` не использует обычные dev-порты и пользовательскую DB:

- web `127.0.0.1:3100`, orchestrator `127.0.0.1:8887`;
- `DATABASE_URL=:memory:`;
- `.data/e2e-exercise-attempts` с проверкой canonical root перед cleanup;
- `NEXT_DIST_DIR=.next-e2e`;
- `reuseExistingServer: false`, `fullyParallel: false`, `retries: 0`;
- trace сохраняется только при failure.

Корневая команда запускает Playwright через `scripts/test-e2e.mjs`: wrapper сохраняет исходный tracked `apps/web/next-env.d.ts` и восстанавливает его в `finally`, включая failed test process.

Это предотвращает ложный green из чужого запущенного dev server, не смешивает Day 1 evidence с пользовательскими данными и не оставляет E2E-generated type reference в рабочем дереве. E2E не редактирует и не удаляет template workspace.

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

Compose использует `npm ci`, loopback-публикацию и два named volumes: `harness-data` для SQLite в `/data` и `harness-attempts` для server-created attempt folders в `/app/.data`. Runner заранее создаёт оба writable location до переключения на непривилегированного пользователя `harness`. Это Mock-oriented среда. Zed/Codex на host и OpenCode loopback restriction означают, что полный внешний-provider flow проверяется npm-запуском на host.
