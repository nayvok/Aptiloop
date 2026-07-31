# Dev Learning Harness

Локальная single-user платформа для восстановления самостоятельного навыка JavaScript/TypeScript: сначала собственный ответ и код в Zed, затем ограниченная подсказка, тесты и read-only review. Интерфейс не заменяет IDE и не применяет исправления за пользователя.

## Что входит в MVP

- недельный учебный план, Daily Session и детерминированный mastery;
- вопросы, ошибки, knowledge map, flashcards и interview mode;
- упражнение в отдельной рабочей папке, Git baseline/diff и история проверок;
- потоковый чат с ролями Teacher, Reviewer и Interviewer;
- всегда доступный детерминированный Mock provider;
- опциональные Codex app-server и OpenCode sidecar;
- Next.js web, Hono orchestrator, SQLite через встроенный `node:sqlite` и Drizzle.

## Требования

- Node.js 24 или новее;
- npm 11 или новее;
- Git;
- Zed — опционально, для кнопки «Открыть в Zed»;
- Docker 29+ и Docker Compose v2/v5 — только для контейнерного quick start;
- Codex CLI или OpenCode CLI — только если нужен соответствующий провайдер.

Проект npm-only. Не используйте pnpm и не создавайте `pnpm-lock.yaml`.

## Быстрый запуск через npm

```powershell
npm install
npm start
```

Откройте <http://127.0.0.1:3000>. `npm start` автоматически запускает локальный OpenCode sidecar, если он ещё не работает, и останавливает созданный процесс вместе с приложением. Codex app-server запускается самим harness по требованию. Миграции SQLite и seed первой недели выполняются автоматически.

Для Mock/Codex без автозапуска OpenCode используйте `npm run dev`. `.env` не обязателен; скопируйте `.env.example` только если хотите изменить порты, путь SQLite или OpenCode credentials. Orchestrator доступен на <http://127.0.0.1:8787>; readiness probe — <http://127.0.0.1:8787/health/ready>.

## Быстрый запуск через Docker Compose

Сначала должен существовать актуальный `package-lock.json` (`npm install` создаёт его):

```powershell
docker compose up --build
```

После готовности healthchecks откройте <http://127.0.0.1:3000>. SQLite хранится в named volume `dev-learning-harness_harness-data`, упражнения монтируются из `workspaces/exercises`.

```powershell
docker compose logs -f orchestrator web
docker compose down
```

Compose — быстрый воспроизводимый запуск с Mock. Codex CLI и Zed запускаются на машине пользователя, поэтому полный external-tool flow удобнее запускать через npm. Текущий OpenCode adapter принимает только loopback endpoint; адрес `host.docker.internal` из контейнера не проходит эту защиту — для OpenCode используйте локальный npm-запуск.

## Основные команды

```powershell
npm run dev          # web + orchestrator
npm start            # web + orchestrator + локальный OpenCode sidecar
npm run db:migrate   # применить SQL migrations
npm run db:seed      # идемпотентно загрузить первую неделю
npm run test:fast    # unit/integration/component tests
npm run test:e2e     # Playwright
npm run lint
npm run typecheck
npm run build
npm run verify       # format check + lint + types + fast tests + build
```

Настройка провайдеров описана в [docs/providers.md](docs/providers.md), разработка — в [docs/development.md](docs/development.md), типичные проблемы Windows и Docker — в [docs/troubleshooting.md](docs/troubleshooting.md).

## Безопасность и границы

Harness рассчитан только на доверенные bundled exercises. Allowlist предотвращает подстановку shell-команд, но запуск JavaScript не является sandbox. Reviewer получает diff/context и deny-write policy; отдельного API для применения патча нет. Подробности: [docs/security.md](docs/security.md).
