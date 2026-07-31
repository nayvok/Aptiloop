# AGENTS.md

## Назначение проекта

Dev Learning Harness — локальная npm-only платформа обучения JavaScript/TypeScript. Пользователь пишет код во внешнем Zed; приложение организует занятие, хранит evidence, запускает только заранее разрешённые проверки и даёт read-only review.

## Обязательные границы

- Не добавлять встроенный IDE, редактор кода, terminal UI или произвольный shell endpoint.
- Не добавлять Pi, AnkiConnect, cloud auth/sync или multi-user scope в MVP.
- Не давать Reviewer write/edit/apply tools. Review должен оставаться советом, который пользователь применяет сам.
- Не передавать в browser secrets, filesystem handles, raw provider RPC или командные строки.
- Не ослаблять canonical path checks, loopback defaults, Origin checks и process allowlist.
- Не считать allowlist sandbox: разрешены только доверенные упражнения из репозитория.
- Использовать npm workspaces и `package-lock.json`; не использовать pnpm/yarn и `workspace:*`.

## Структура

- `apps/web` — Next.js presentation и browser state.
- `apps/orchestrator` — Hono HTTP/SSE, SQLite, процессы, Git/Zed и provider lifecycle.
- `packages/shared` — Zod contracts и DTO.
- `packages/learning-core` — чистые правила mastery/hints/review.
- `packages/agent-core` — provider contract, mock и event normalization.
- `packages/codex-provider` — узкий Codex app-server stdio adapter.
- `packages/opencode-provider` — OpenCode SDK/sidecar adapter.
- `packages/exercise-core` — paths, Git baseline/diff, allowlisted runner и Zed.
- `packages/curriculum` — versioned curriculum content.
- `packages/database` — `node:sqlite`, Drizzle schema, migrations, repositories и seed.

## Правила реализации

- TypeScript strict; валидировать внешние данные Zod на границе.
- Business rules держать детерминированными и тестируемыми вне LLM.
- Browser mutation отправляет operation ID и entity ID, не executable/args/cwd.
- Все дочерние процессы запускать с `shell: false`, timeout, output cap и cleanup.
- Provider events нормализовать; raw events не отдавать напрямую UI.
- Codex Reviewer: `sandbox=read-only`, `approvalPolicy=never`.
- OpenCode Reviewer: явные deny rules для patch/write/edit/mutation tools.
- Секреты брать только из environment и редактировать в logs/errors.
- Сохранять first-attempt-before-hint и не показывать reference answer заранее.
- UI: semantic tokens, keyboard/focus, reduced motion, light/dark, честные loading/empty/error states.

## Команды проверки

Запускать из корня:

```text
npm install
npm run db:migrate
npm run db:seed
npm run format:check
npm run lint
npm run typecheck
npm run test:fast
npm run test:e2e
npm run build
```

Для точечной проверки используйте npm workspace, например:

```text
npm run test --workspace=@dlh/database
npm run typecheck --workspace=@dlh/orchestrator
```

Не объявлять external provider smoke успешным без локальной установки, аутентификации и фактически выполненного запроса.

## Curriculum

Использовать стабильные string IDs. Seed обязан быть идемпотентным. Каждый день содержит цели, темы с источниками, вопросы с reference/evaluation points, упражнение и common mistakes. Reference answer не должен попадать в question-generation/interview context до ответа пользователя.

## Работа с Git и файлами пользователя

Не перезаписывать несвязанные изменения. Для упражнения сохранять baseline до редактирования, показывать diff, затем просить пользователя исправить код в Zed. Paths всегда разрешать относительно allowlisted workspace root с `realpath`/reparse checks.

## Документация

При изменении команд, env, provider protocol, security boundary или curriculum schema обновить соответствующий файл в `docs/` и `.env.example`. README должен описывать только реально существующие scripts и endpoints.
