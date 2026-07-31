# План реализации MVP

## Этап 0. Исследование и решения

- Зафиксировать версии Node, npm, Codex, OpenCode и актуальные package versions.
- Проверить official Codex SDK/app-server/exec и OpenCode SDK/headless server.
- Создать PRODUCT, DESIGN, architecture и security notes.
- Self-review: пройти 24 acceptance criteria и убрать неподтверждённые provider claims.

Проверка: документы существуют; providers.md ссылается только на реальные интерфейсы.

## Этап 1. Foundation

- Инициализировать Git, npm workspaces, Turbo, strict shared tsconfig, ESLint/Prettier.
- Создать `apps/web`, `apps/orchestrator` и packages из архитектуры.
- Поднять Hono health endpoint и Next shell.
- Создать Drizzle schema, SQL migration, database client и идемпотентный seed.
- Добавить `.env.example`, `.gitignore`, structured logger, graceful shutdown.
- Реализовать `MockAgentProvider` и provider status API.

Проверка: install, db:migrate, db:seed, dev, health, typecheck, first commit.

## Этап 2. Learning core

- Описать curriculum types и seed первой недели.
- Реализовать session creation, step state machine и answer persistence.
- Реализовать deterministic mastery, hint penalties, review selection.
- Добавить mistake journal и flashcard candidate lifecycle/export.
- Покрыть unit и repository integration tests.

Проверка: day 1 создаётся из seed; ответ сохраняется; completion обновляет mastery и flashcards.

## Этап 3. Agent chat и providers

- Создать versioned prompt library и prompt contract tests.
- Реализовать SSE endpoint, abort/cancel, conversation persistence и event normalization.
- Подключить OpenCode SDK/server adapter с model listing/status.
- Подключить Codex app-server stdio adapter с read-only Reviewer policy и честным status fallback.
- Валидировать Reviewer/interview/summary JSON через Zod с одной repair-попыткой.

Проверка: mock stream/error/retry; unavailable providers; optional real-provider smoke commands documented.

## Этап 4. Exercises

- Создать автономное упражнение week-01/day-02/group-by и ещё компактные metadata для недели.
- Реализовать safe workspace resolver, immutable baseline и `git diff --no-index`.
- Реализовать operation-ID allowlist, test/typecheck runners, output cap, timeout и cancellation.
- Реализовать Zed adapter/fallback, attempts, hints и read-only review endpoint.

Проверка: traversal rejected; diff changes after edit; tests recorded; reviewer cannot patch.

## Этап 5. Product UI

- App shell: sidebar, breadcrumb/top bar, theme, provider health.
- Pages: Dashboard, Daily Session, Agent Chat, Exercise, Knowledge Map, Mistake Journal, Interview, Flashcards, Settings.
- TanStack Query boundary, React Hook Form + Zod on forms.
- Loading skeletons, empty/error states, keyboard/focus and reduced motion.
- Component tests for required surfaces.

Проверка: responsive browser pass; light/dark; no hardcoded non-semantic colors; shadcn review.

## Этап 6. E2E и hardening

- Playwright acceptance scenario from Dashboard through completion/card creation.
- Security tests: origin, path traversal, operation allowlist, redaction, reviewer policy.
- Production builds, disabled-provider states, orchestrator start/stop.
- Complete README, AGENTS and seven docs; validate AGENTS ≤300 lines.
- Clean reinstall, migrate, seed, lint, typecheck, all tests, e2e, build.
- Search repository for forbidden Pi, IDE, AnkiConnect and secrets; review Git diff.
- Create logical Conventional Commits.

## Definition of done

Каждый пункт финального отчёта содержит фактически выполненную команду и результат. Непроверенная реальная авторизация внешнего провайдера отмечается как ручной smoke test, а не как «работает».
