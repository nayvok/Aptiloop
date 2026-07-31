# Разработка

## Локальная среда

Проект использует Node.js 24+, npm workspaces и Turborepo. Единственный lockfile — `package-lock.json`.

```powershell
Copy-Item .env.example .env
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

`npm run dev` запускает workspace-задачи параллельно: Next.js на `127.0.0.1:3000`, Hono orchestrator на `127.0.0.1:8787`. Web перенаправляет `/api/*` в orchestrator через `ORCHESTRATOR_URL`.

Основные переменные:

| Переменная                 | Значение по умолчанию               | Назначение                              |
| -------------------------- | ----------------------------------- | --------------------------------------- |
| `HOST`                     | `127.0.0.1`                         | bind orchestrator                       |
| `PORT`                     | `8787`                              | порт orchestrator                       |
| `WEB_ORIGIN`               | `http://127.0.0.1:3000`             | разрешённый browser origin              |
| `DATABASE_URL`             | `.data/dev-learning-harness.sqlite` | SQLite file (`file:` также принимается) |
| `WORKSPACE_ROOT`           | `workspaces/exercises`              | доверенный root упражнений              |
| `OPENCODE_ENDPOINT`        | `http://127.0.0.1:4096`             | loopback OpenCode sidecar               |
| `OPENCODE_SERVER_USERNAME` | `opencode`                          | Basic Auth username                     |
| `OPENCODE_SERVER_PASSWORD` | не задан                            | Basic Auth password, только environment |
| `ZED_EXECUTABLE`           | `zed`                               | executable token/path, не shell-команда |

## База данных

Database package использует встроенный в Node `DatabaseSync` из `node:sqlite` и `drizzle-orm/node-sqlite`. Нативная сборка `better-sqlite3` не нужна.

```powershell
npm run db:generate
npm run db:migrate
npm run db:seed
```

Migrations выполняются по имени SQL-файла и фиксируются в `__dlh_migrations`. Seed можно запускать повторно: сущности первой недели имеют стабильные IDs. При обычном file database включены foreign keys и WAL.

## Проверки

```powershell
npm run format:check
npm run lint
npm run typecheck
npm run test:fast
npm run build
npm run test:e2e
```

`npm test` объединяет fast tests и Playwright. `npm run verify` намеренно не запускает E2E, чтобы оставаться быстрым локальным gate.

Точечный запуск:

```powershell
npm run test --workspace=@dlh/learning-core
npm run test --workspace=@dlh/database
npm run typecheck --workspace=@dlh/web
```

## Docker

Dockerfiles используют `npm ci`, поэтому без committed/актуального `package-lock.json` сборка остановится. Проверка конфигурации и запуск:

```powershell
docker compose config
docker compose up --build
docker compose ps
docker compose logs -f orchestrator web
```

Порты публикуются только на `127.0.0.1`. Named volume хранит SQLite, bind mount `./workspaces/exercises:/workspace` — рабочие файлы. Compose оптимизирован для Mock provider. Zed из контейнера не открывает desktop-приложение; путь можно скопировать и открыть вручную.

## Изменение контрактов

Сначала меняйте schema/DTO в `packages/shared`, затем adapters и HTTP boundary, после этого web. Provider-specific event не должен просачиваться в UI. Изменение migration сопровождайте integration test; изменение mastery/hint rules — table-driven unit test.
