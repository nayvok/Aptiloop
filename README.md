# Dev Learning Harness

Локальная single-user платформа для самостоятельного обучения JavaScript/TypeScript. Пользователь изучает короткие units, сначала отвечает и пишет код сам в Zed, затем получает Teacher-вопрос, запускает разрешённые тесты и запрашивает read-only review. Приложение хранит evidence и продолжает незавершённое занятие после перезапуска; встроенного редактора, терминала и автоматического применения исправлений нет.

## Реализованный MVP

- versioned учебный путь: published revision → неделя → день → короткие units;
- полностью наполненная первая неделя и рабочий вертикальный срез Дня 1;
- briefing, study checklist, recall, Teacher dialogue, quiz, code reading, practice, review и итог дня;
- immutable snapshot программы в каждой сессии и перезапуск с сохранённого unit;
- отдельная папка каждой практической попытки, Git baseline/diff и настоящий `npm test`;
- correction cycle: тест → read-only review → самостоятельная правка → новый тест/review;
- серверный deterministic summary, mastery evidence, журнал ошибок и кандидаты в карточки;
- отдельный workflow интервью с setup, вопросами по одному, transcript и restart-safe отчётом;
- draft Curriculum Editor: создание/клонирование ревизии, порядок week/day/unit и необратимая публикация;
- Mock provider без сети и опциональные Codex app-server/OpenCode sidecar;
- светлая, тёмная и системная темы, keyboard/focus и reduced-motion states.

Важно: отчёт интервью в текущем MVP фиксирует полноту и форму ответов, но **не подтверждает их техническую корректность и не меняет mastery**. Подробнее — в [методике](docs/learning-methodology.md).

## Требования

- Node.js 24+;
- npm 11+;
- Git;
- Zed — опционально, для кнопки открытия из практики;
- Codex CLI или OpenCode CLI — только для соответствующего внешнего провайдера;
- Docker/Compose — опционально для Mock-oriented запуска.

Проект npm-only: один `package-lock.json`, без pnpm/yarn и `workspace:*`.

## Первый запуск

Из корня репозитория:

```powershell
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

Откройте <http://127.0.0.1:3000>. Orchestrator слушает <http://127.0.0.1:8787>, readiness — <http://127.0.0.1:8787/health/ready>. Web проксирует `/api/*` через server-side rewrite.

`npm start` запускает тот же локальный stack через `scripts/dev-local.mjs` и пытается поднять OpenCode sidecar. Для обучения без внешних CLI достаточно Mock. Корневой `.env` не обязателен; при необходимости скопируйте `.env.example`.

Перед миграцией существующей базы рекомендуется сделать проверенную копию:

```powershell
npm run db:backup
npm run db:migrate
npm run db:seed
```

CLI базы разрешает относительные пути от корня проекта, даже когда npm запускает workspace-script. Backup использует `VACUUM INTO`, проверяет `integrity_check` и foreign keys у источника и копии и не перезаписывает существующий файл. Подробности — в [разработке](docs/development.md).

## Основные команды

```powershell
npm run dev          # Next.js + Hono
npm start            # локальный launcher, включая OpenCode sidecar при возможности
npm run db:backup    # проверенная timestamped-копия SQLite
npm run db:migrate   # ordered migrations и repeatable legacy repair
npm run db:seed      # идемпотентный versioned curriculum seed
npm run format:check
npm run lint
npm run typecheck
npm run test:fast    # unit/integration/component tests, всегда без Turbo cache
npm run test:e2e     # Playwright; wrapper восстанавливает next-env.d.ts
npm run build
npm run verify       # format + lint + types + fast tests + build (без E2E)
```

`npm test` запускает `test:fast`, затем E2E. Playwright намеренно использует порты `3100/8887`, отдельный `.next-e2e`, in-memory SQLite, отдельный root попыток, `retries: 0` и не переиспользует чужие dev-серверы. Корневой E2E wrapper восстанавливает tracked `apps/web/next-env.d.ts` и после успешного прогона, и после ошибки.

## Docker Compose

```powershell
docker compose up --build
docker compose logs -f orchestrator web
docker compose down
```

Compose ориентирован на Mock. SQLite хранится в `harness-data`, а изолированные рабочие папки попыток — в отдельном named volume `harness-attempts`, смонтированном в `/app/.data`. Codex CLI и Zed находятся на host, а OpenCode adapter принимает только loopback endpoint, поэтому внешний provider/Zed flow удобнее проверять локальным npm-запуском.

## Границы доверия

Browser отправляет operation/entity IDs и учебные данные, но не executable, args, cwd, filesystem handles или provider RPC. Все mutations проверяют Origin, JSON content type и локальный client header. Пути canonicalized; процессы запускаются с `shell: false`, timeout и output cap.

Allowlist — защита от command injection, **не sandbox JavaScript**. Запускайте только доверенные упражнения из репозитория. Reviewer получает diff/context и deny-write policy; route применения патча отсутствует.

Документы: [архитектура](docs/architecture.md), [безопасность](docs/security.md), [провайдеры](docs/providers.md), [авторинг](docs/curriculum-authoring.md), [acceptance-аудит](docs/acceptance-audit.md), [troubleshooting](docs/troubleshooting.md).
