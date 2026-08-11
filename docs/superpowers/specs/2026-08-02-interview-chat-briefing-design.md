# Дизайн: чат-интервью, план дня в сессии, связка интервью с днём, проверка внешних ограничений

> **Historical snapshot — non-authoritative.** This document preserves an earlier Dev Learning Harness design and is not an executable workflow or current Aptiloop specification. Do not use Superpowers instructions from this history. Start with the [documentation index](../../README.md).

Дата: 2026-08-02. Статус: утверждён пользователем (план передан в составе запроса), дизайн сохранён и закоммичен перед написанием implementation plan.

## Summary

Четыре связанные задачи на существующем MVP:

1. Переделать «Техническое интервью» из формы в чат-интерфейс **без стриминга** (решение пользователя: чат поверх текущих эндпоинтов, без SSE).
2. Показывать план дня на странице сессии, чтобы не возвращаться в Path.
3. Починить «мёртвый» юнит интервью в дне (сейчас он не пишет прогресс и не может завершиться — день 7 недели непроходим).
4. Выполнить реальные проверки Codex/OpenCode model turns и запуск GUI Zed, закрыв честно зафиксированные пробелы аудита.

Исполнение — субагентами по независимым блокам, финальная интеграция и полный gate в корне.

## Реалии репозитория (проверенные контракты)

- Интервью-клиент: `apps/web/components/interview-client.tsx` — setup-форма, transcript-список, textarea «Текст ответа», finish-блок. Все схемы strict Zod, `rejectProtectedFields`, localStorage-ключи `dlh-interview-v2-*`, operationId-идемпотентность.
- Сервер интервью: `apps/orchestrator/src/interview-v2.ts` — `POST /api/interviews/v2`, `GET /current`, `GET /:id`, `POST /:id/answers`, `POST /:id/finish`. `interview_sessions.learning_session_id` заполняется из активной сессии при создании. Отчёт хранится в `result_json` (отдельной таблицы report нет).
- Сессия: `apps/web/components/session-client.tsx` — рейл `data-slot="unit-step-rail"` (не кликабельный, `data-slot="unit-step"`, `aria-current`), `UnitShell`, `UnitBody` со switch по `unit.type`, `InterviewUnit` сейчас: кнопка «Открыть интервью» → `router.push("/interview")` (без sessionId). Progress-payload интервью уже описан в web-схеме: `{type:"interview", interviewSessionId, reportId}`.
- Сервер сессии: `apps/orchestrator/src/learning-v2.ts` — `PATCH /api/learning/sessions/v2/:id/units/:unitId` (`updateUnitSchema`: status + payload), `assertCompletionCriteria`: case `"attempts"` → `evidenceAttemptCount(unit, payload) < minimum`; для interview payload даёт максимум 1 (баг: критерий 3 ответа непроходим).
- Curriculum: `packages/curriculum/src/version-2.ts` `createStandardDay` при `includeInterview: true` добавляет checkpoint → interview (criterion `written-attempt` minimum 3) → summary. В learner-снапшоте `written-attempt` нормализуется в `{type:"attempts", minimum}` (`packages/database/src/versioned-seed.ts`). Активная ревизия — v4 (`activeCurriculumVersion`), день 7 включает интервью.
- UI-примитивы чата уже есть: `MessageScroller`/`Bubble`/`Message`/`MessageContent`/`MessageHeader` (`apps/web/components/ui/message-scroller.tsx`, `bubble.tsx`, `message.tsx`), паттерн чата — `apps/web/components/agent-chat.tsx` (Enter отправка, Shift+Enter перенос, typing-индикатор «Агент печатает»).
- `dashboard-client.tsx` содержит локальный `unitTypeLabels` (Path); планируется вынос в `apps/web/lib/unit-labels.ts`.
- E2E: `apps/web/e2e/daily-flow.spec.ts` — тест «runs and restores the dedicated interview workflow» использует `getByLabel("Текст ответа")`, кнопки «Отправить ответ», «Завершить и открыть отчёт».
- `npm audit` (2026-08-02): 3 high (next 16.2.12 → nested postcss 8.4.31/≤8.5.17, optional sharp 0.34.5/<0.35.0) + 1 low dev (tsup→esbuild 0.27.x). Авто-fix предлагает ошибочный downgrade next до 9.3.3.
- `docs/acceptance-audit.md`: Codex turn «не выполнялся», OpenCode «unavailable», Zed GUI «не выполнялось» — это и закрывают проверки блока (d).

## 1. Чат-интервью (только web-клиент, без изменения серверного контракта)

### Компоненты

- Новый `apps/web/components/interview-chat-view.tsx` — `InterviewChatView`, заменяет блоки «Transcript»/«Ответ»/«Все вопросы отвечены» текущего `InterviewClient`.
- Новая обёртка `apps/web/components/ui/textarea.tsx` (shadcn-стиль, без новых зависимостей; meta-пакет `radix-ui` уже установлен, новых npm-зависимостей нет).
- `InterviewClient` сохраняет: setup-экран, opening-retry, отчёт (`InterviewReportView`), загрузку/ошибки. Внутри активного интервью рендерит `InterviewChatView`.

### Поведение чата

- Лента на `MessageScroller`/`Bubble`/`Message`: «Интервьюер» слева (аватар с interview-акцентом, вариант `muted`), «Вы» справа (вариант `default`), автоскролл (`scrollAnchor` на последнем элементе).
- pending-вопрос (последний assistant при `questionsAsked === questionsAnswered + 1`) остаётся единственным элементом с `role="status"`/`aria-live="polite"`.
- Композер внизу: `Textarea` из `components/ui/textarea.tsx`, Enter — отправить, Shift+Enter — перенос, `maxLength 20 000`, label «Сообщение».
- Пока сервер готовит следующий вопрос (`action === "answer"`) — typing-индикатор «Интервьюер печатает…».
- Прогресс «N / M» сохраняется в шапке чата; при `readyToFinish` — блок «Завершить и открыть отчёт».
- Полностью сохраняются: идемпотентность operationId, localStorage-черновики, `rejectProtectedFields` + strict Zod, ошибка «Ответ сохранён в форме — можно повторить запрос» с кнопкой повтора, разметка отчёта.
- `agent-chat` не меняется.

### Тестовые якоря (сохранить)

«Начать интервью», «Темы через запятую», «Количество вопросов», «Отправить ответ», «Завершить и открыть отчёт», «N / M», «Отчёт по интервью», «100%», `role=alert` для ошибок. Новый лейбл композера — «Сообщение» (тесты обновляются; якорь «Текст ответа» заменяется на «Сообщение»).

## 2. План дня в сессии (web-клиент)

- Новый `apps/web/components/day-plan.tsx` под шапкой сессии: коллапсируемый `<details open>` «План дня» — цель (`day.goal`), темы (badges), `expectedOutcomes`, `outOfScope`, список юнитов с русским типом/минутами/статусом.
- Уникальные лейблы: «План дня», «Темы», «Ожидаемые результаты», «Вне дня», «Юниты». Не дублировать тексты «Что нужно сделать» и «Начать юнит» (защита e2e/component-тестов от неоднозначных селекторов).
- Рейл юнитов (`UnitStepList`) обогащается русским типом, минутами и статусом. Рейл не становится кликабельным, логика фокуса не меняется, `data-slot="unit-step"` и `aria-current` сохраняются.
- Общий маппинг лейблов выносится в `apps/web/lib/unit-labels.ts` (`unitTypeLabels`, `unitStatusLabels`) и используется в `dashboard-client.tsx` (Path) и в сессии.

## 3. Связка интервью с днём (orchestrator + web)

### Сервер: finish upsert

При `POST /api/interviews/v2/:id/finish`, после создания отчёта, upsert-ить прогресс юнита интервью связанной активной learning-сессии (`interview.learningSessionId`):

- найти юнит `type === "interview"` в snapshot сессии;
- записать/обновить `unit_progress` payload `{type:"interview", interviewSessionId: <interviewId>, reportId: <interviewId>}` — отдельной таблицы отчёта нет, отчёт хранится в `interview_sessions.result_json`, поэтому `reportId = interviewId` (payload-схема `UnitProgressPayloadSchema` уже поддерживает оба поля);
- если юнита/сессии нет — интервью всё равно завершается, upsert пропускается (интервью остаётся отдельным workflow).

### Сервер: критерий завершения

Критерий `attempts`/`written-attempt` для `unit.type === "interview"` считает завершённые user-сообщения интервью из БД (через `interview_sessions.conversation_id` → `agent_messages role='user' status='completed'`), а не `evidenceAttemptCount`:

- прохождение = ≥ `criterion.minimum` (3) ответов **и** `payload.reportId` заполнен;
- `assertCompletionCriteria` уже получает `connection` — добавить ветку для `unit.type === "interview"` в case `"attempts"`.

### Клиент: состояния юнита в сессии

- нет отчёта (нет `reportId` в payload) → «Открыть интервью» → `router.push("/interview?sessionId=<id>")`;
- отчёт есть, юнит не завершён → «Открыть отчёт» (`/interview?id=<interviewId>`) + «Завершить юнит» (`PATCH` status=completed c payload; критерии уже проверены сервером);
- завершён → «Юнит завершён и сохранён» (`CompletedNote`).

### Страница интервью

- `?sessionId=` — кнопка «Вернуться к занятию» (в т.ч. после отчёта) → `/session?id=<sessionId>`;
- `?id=<interviewId>` — прямое открытие сохранённого отчёта/интервью из сессии, минуя localStorage (запрос `GET /api/interviews/v2/:id`, валидация тем же Zod).

## 4. Проверка внешних ограничений и аудит

- `npm audit` повторно: подтвердить 3 high + 1 low dev. Попробовать `npm audit fix` без `--force` для dev-only esbuild (`tsup`); если обновление безопасно — закоммитить lockfile, иначе оставить зафиксированным. Next/postcss/sharp — внешнее ограничение: registry не предлагает совместимый апдейт, авто-fix даёт ошибочный downgrade до 9.3.3, `--force`/overrides не применять.
- Codex turn: запуск приложения, provider=codex + реальная модель, Day 1 teacher dialogue — дождаться terminal-события, проверить содержательный ответ и сохранение после reload; записать версии (CLI 0.144.3) и model id.
- OpenCode turn: пользователь задаёт `OPENCODE_SERVER_PASSWORD` в env; `opencode serve --hostname 127.0.0.1 --port 4096`; health 200; provider=opencode + модель из connected set; teacher turn + сохранение; записать версии (CLI/SDK 1.18.3).
- Zed GUI: через практику — attempt, `POST /api/exercise-attempts/:id/open` → `opened:true`, проверить процесс Zed и командную строку с путём attempt-папки, визуальное подтверждение окна пользователем; fallback — `copy_path`.
- Обновить `docs/acceptance-audit.md` (external provider matrix и фактические результаты), `docs/troubleshooting.md` (команда запуска opencode sidecar), `docs/product-specification-v2.md` и `docs/design-system.md` (новый UX и ui-компоненты), README — только если меняются команды/endpoints.

## Тестовый план

- Web component: интервью-чат (все состояния, typing, recoverable-answer, protected-поля, body-запросы и operationId), план дня, обогащённый рейл; регрессия session-v2/path-v2/core-screens.
- Orchestrator integration: finish интервью пишет unit progress; критерий интервью проходит при ≥3 ответах и отчёте; полный день 7 (briefing → … → interview → summary) завершается; отрицательные кейсы (нет сессии/юнита, недостаточно ответов).
- E2E Playwright: daily-flow (обновлённые селекторы интервью + план дня + завершение интервью-юнита), interview restore/report.
- Полный gate из корня: `npm install`, `npm audit`, `npm run db:backup`, `npm run db:migrate`, `npm run db:seed`, `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm run test:fast`, `npm run test:e2e`, `npm run build`.

## Не-цели (явно отложено)

- SSE-стриминг вопросов интервью в этой итерации.
- Экспертная техническая оценка интервью/mastery update от отчёта.
- Кликабельный рейл юнитов, фокус-логика, изменение `agent-chat`.
- Новые npm-зависимости, cloud auth/sync, multi-user, IDE/terminal UI.

## Исполнение и допущения

- Блоки: (a) чат-интервью, (b) план дня/рейл, (c) бэкенд-связка, (d) аудит/проверки — субагентами; координация на общих файлах (`session-client.tsx`, `interview-client.tsx`, `learning-v2.ts`); финальная интеграция и полный gate в корне.
- Проверки провайдеров выполняются в конце и требуют запущенного приложения, реальных model turns и (для OpenCode) пароля пользователя; результаты не считаются успешными без фактического terminal-события.
- Без новых npm-зависимостей; новые ui-компоненты — textarea (и при необходимости avatar-обёртка).
- Известный латентный баг (непроходимый день 7) чинится в рамках блока (c); при изменении curriculum/schema-семантики обновляются соответствующие docs и тесты.
