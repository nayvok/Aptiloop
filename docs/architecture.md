# Архитектура Dev Learning Harness

Статус: реализованный versioned MVP.

Дата актуализации: 2026-08-01.

## Границы продукта

Dev Learning Harness — локальное single-user приложение. Next.js показывает учебный путь и хранит только browser state. Hono orchestrator владеет SQLite, curriculum/session state, filesystem/Git, разрешёнными процессами, Zed и lifecycle AI-провайдеров.

Не входят в MVP: auth/cloud/multi-user, Pi, AnkiConnect, встроенная IDE/терминал, browser sandbox, произвольный shell endpoint и применение исправления Reviewer-ом.

## Компоненты

```text
apps/web                 Next.js 16 / React 19 presentation
apps/orchestrator        Hono HTTP/SSE, DB/process/provider lifecycle
packages/shared          строгие Zod DTO и versioned contracts
packages/learning-core   чистые progression/mastery/summary/hint rules
packages/agent-core      provider contract и normalized events
packages/codex-provider  узкий Codex app-server stdio adapter
packages/opencode-provider OpenCode SDK/sidecar adapter
packages/exercise-core   canonical paths, isolated attempts, Git, runner, Zed
packages/curriculum      published revision 3 первой недели + immutable parents
packages/database        node:sqlite, schema, migrations, repositories, seed
```

Проект использует npm workspaces, общий `package-lock.json`, TypeScript strict и Turborepo. `pnpm`, `yarn` и `workspace:*` не применяются.

## Versioned curriculum и сессии

Опубликованная программа — упорядоченный граф `curriculum version → weeks → days → units`. Unit имеет stable ID, тип, цели, checklist, источники, вопросы, completion/unlock rules и type-specific payload. Publication валидирует весь граф, вычисляет content hash, архивирует прежнюю активную published revision и делает новую revision immutable.

Редактор изменяет только draft. Published/archived revision доступны read-only; продолжение редактирования начинается с полного clone в следующую draft revision. Учебный путь читает только активную published revision.

При старте дня repository атомарно сохраняет session snapshot schema v2 с content hash и отдельные `unit_progress`. Поэтому последующая публикация курса не меняет уже начатое занятие. Browser получает learner DTO без protected `referenceAnswer` и quiz answer key.

Текущий UI использует:

- `GET /api/learning/path`;
- `GET /api/learning/sessions/current`;
- `POST /api/learning/sessions/v2`;
- server-owned evidence endpoints для recall/quiz/code reading;
- `PATCH .../units/:unitId` для разрешённых переходов остальных units;
- `GET|POST .../summary` для server-derived итогов.

Старые `/api/learning/sessions` routes оставлены как compatibility surface, но versioned path/session — основной flow.

## Данные и миграции

SQLite работает через встроенный `node:sqlite` и Drizzle. Ordered SQL migrations записываются в `__dlh_migrations`; TypeScript hooks выполняют backfill/normalization, которые невозможно выразить условным SQLite DDL.

Миграции 0001–0004 добавляют versioned curriculum, snapshots, typed unit progress и immutable unit evidence. Repeatable compatibility repair:

- добавляет потерянный в раннем prototype `unit_progress.unit_type` через безопасный rebuild;
- нормализует legacy snapshot к schema v2 и заново проверяет Zod contract;
- запускается даже если старый prototype уже записал marker 0002, но не выполнил TypeScript hook;
- сохраняет legacy rows/history, однако legacy revision не становится текущей active revision.

Относительные `DATABASE_URL` и backup directory разрешаются от project root, а не от npm workspace cwd. Перед миграцией file DB используется `npm run db:backup`: source и `VACUUM INTO` copy проходят SQLite integrity/foreign-key проверки.

## Учебный поток Дня 1

Путь открывает units последовательно. Briefing объясняет цель/глубину/out-of-scope; Study требует checklist; Recall сначала сохраняет собственный ответ; Teacher dialogue идёт через выбранного provider; Quiz оценивается на server без раскрытия ключа; Code Reading сохраняет prediction/explanation/fix.

Practice создаёт копию доверенного template под `EXERCISE_ATTEMPTS_ROOT`, затем private Git baseline. После learner diff разрешён только server-owned `test`; успешный и актуальный run открывает review. Reviewer получает brief, criteria, constraints, diff, test и server-derived число предыдущих reviews. Он не может менять workspace. При `changes_requested` пользователь правит код в Zed и повторяет test/review. Состояние попытки, последняя актуальная проверка и review восстанавливаются из SQLite/filesystem.

Summary детерминированно выводится из сохранённого evidence. Сервер транзакционно сохраняет summary, mastery evidence, mistake candidates и flashcard candidates; completion открывает следующий день.

## Interview

`/api/interviews/v2` — отдельная restart-safe state machine: setup → один вопрос → ответ → следующий вопрос → finish/report. Provider/model выбираются server-side из settings, transcript хранится в SQLite. Текущий report вычисляет количество/полноту/форму ответов и явно не заявляет техническую корректность; mastery из него не обновляется.

## Provider boundary

`AgentProvider` нормализует status/models/session/stream/cancel. Raw Codex RPC и OpenCode events не выдаются UI. Mock детерминирован и доступен offline. Codex запускается как дочерний app-server; OpenCode подключается к loopback sidecar.

Reviewer policy:

- Codex: `sandbox=read-only`, network disabled, `approvalPolicy=never`;
- OpenCode: явные deny rules для patch/write/edit и mutation-capable tools;
- orchestrator сравнивает Git diff до и после review;
- route `apply` отсутствует.

## HTTP и process boundary

Browser mutations несут entity/operation IDs и JSON data, но не executable/args/cwd. Orchestrator проверяет точный Origin, `Content-Type: application/json` и `X-DLH-Client: web`; внешние тела и provider outputs валидируются Zod.

Paths разрешаются относительно allowlisted root, canonicalized через `realpath` и reparse/symlink checks. Дочерние процессы используют `shell: false`, фиксированные args, timeout, output cap и cleanup. Allowlist не является sandbox: упражнения должны быть доверенными.

## Принятые ограничения

1. Актуальность test/review после изменения workspace определяется по максимальному filesystem `mtime`. Это restart-safe, но timestamp можно искусственно сохранить/подделать; следующий hardening — хранить и сравнивать hash diff/tree.
2. Interview report не является экспертной оценкой correctness и не пишет mastery.
3. Connected status внешнего provider — только health/model discovery. Успешный smoke можно объявлять лишь после фактического authenticated model request.
4. Curriculum Editor — локальный authoring tool, без collaboration/conflict protocol.
5. Запуск тестов доверенного JS не создаёт sandbox.
