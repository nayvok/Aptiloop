# Acceptance-аудит versioned MVP

Дата среза: 2026-08-02. Этот документ отделяет реализованное поведение от обязательной финальной проверки окружения. Наличие UI или unit test не считается доказательством external provider smoke.

## Вертикальный срез Дня 1

| Требование                     | Реализация/проверяемое evidence                                  | Статус                                               |
| ------------------------------ | ---------------------------------------------------------------- | ---------------------------------------------------- |
| Подробный путь и блокировки    | active published revision, week/day/unit DTO, sequential unlock  | Реализовано                                          |
| Briefing и study checklist     | versioned units, goals/depth/out-of-scope/sources/checklist      | Реализовано                                          |
| First recall before feedback   | отдельный immutable `unit_evidence` по каждому `questionId`      | Реализовано                                          |
| Teacher dialogue               | объяснение → вопрос Teacher → обязательный learner follow-up     | Реализовано; качество зависит от выбранного provider |
| Quiz без утечки ключа          | server scoring, learner DTO redacts correct options/reference    | Реализовано                                          |
| Code reading evidence          | prediction/explanation/verbal fix endpoint                       | Реализовано                                          |
| Изолированная практика         | template copy → attempt root → private Git baseline/diff         | Реализовано                                          |
| Настоящие тесты                | allowlisted `commandId=test`, persisted output/status            | Реализовано для trusted exercise                     |
| Read-only review               | passed-current-test gate, provider deny-write, before/after diff | Реализовано                                          |
| Correction cycle               | edit → новый test → последующий review; Mock deterministic cycle | Реализовано                                          |
| Summary/mastery/mistakes/cards | deterministic server summary и transactional persistence         | Реализовано                                          |
| Следующий день                 | completion unlock по ordered days                                | Реализовано                                          |
| Restart/resume                 | immutable snapshot, evidence и stable-ID resume между revisions  | Реализовано                                          |

Playwright покрывает продуктовый путь с Mock и реальной изолированной папкой, authoring/publish/clone со snapshot preservation, отдельное интервью и theme hydration. Тесты не меняют template, используют `3100/8887`, in-memory DB, `.next-e2e`, `retries: 0` и отдельный attempts root.

## Curriculum Editor

- список revisions и read-only просмотр graph;
- создание draft и clone existing revision;
- CRUD/reorder week/day/unit;
- обычные form fields и advanced JSON payload;
- full-graph validation и transactional ownership checks;
- explicit immutable publish; предыдущая published revision архивируется;
- session snapshots не меняются после публикации.

Не реализованы collaborative editing, merge/conflict protocol и remote authoring.

## Interview

Реализованы setup (topics/difficulty/1–12), чат-UI без стриминга, server-selected provider/model, один вопрос за раз, transcript/current-session resume, terminal finish и persisted report. Интервью связано с юнитом дня: finish сохраняет progress юнита, завершение требует `reportId` и минимум 3 ответа, поэтому день 7 проходим.

Ограничение: report оценивает completion, длину и форму ответа. Он не доказывает technical correctness, не использует полноценную expert rubric/reference evaluation и не обновляет mastery. Поэтому acceptance по «отдельному workflow» выполнен, а «экспертная техническая оценка интервью» — вне текущего среза.

## Migration/data safety

- canonical DB CLI path разрешается от project root;
- `db:backup` создаёт non-overwriting `VACUUM INTO` copy и проверяет source/copy integrity + foreign keys;
- migrations ordered/idempotent;
- repeatable repair восстанавливает ранние schema/snapshot contracts даже при преждевременном marker 0002;
- legacy rows/history сохраняются;
- seed versioned curriculum идемпотентен.

Перед проверкой на пользовательской DB обязательна свежая backup; нельзя удалять найденные legacy/package-local DB без ручного сравнения.

## Security boundaries

- loopback defaults и validated `WEB_ORIGIN`;
- mutations требуют client header, Origin и JSON;
- strict Zod на HTTP/DB/provider boundaries;
- browser не задаёт command/args/cwd, не получает provider RPC или secrets;
- canonical/reparse-safe paths;
- processes: `shell: false`, timeout, output cap, cleanup;
- Reviewer read-only/deny-write и no-apply API;
- Codex events whitelist/redaction и 1 MiB fail-closed JSONL limit;
- конечные deadlines OpenCode HTTP/SSE/cancel/shutdown;
- OpenCode endpoint только HTTP loopback, credentials только environment;
- trusted exercises only: allowlist не sandbox.

Test/review freshness основана на сохранённом SHA-256 полного Git diff. Review отклоняется при несовпадающем или truncated diff; filesystem `mtime` не считается evidence.

## Финальный gate

Из корня в чистом окружении:

```powershell
npm install
npm audit
npm run db:backup
npm run db:migrate
npm run db:seed
npm run format:check
npm run lint
npm run typecheck
npm run test:fast
npm run test:e2e
npm run build
```

`db:backup` пропускается только для новой/`:memory:` DB. После migrate/seed полезно повторить команды для idempotency и выполнить `PRAGMA integrity_check`/`foreign_key_check`.

Browser acceptance проверяет light/dark hydration, path, start/resume, practice, correction, summary, Day 2 unlock, Editor draft/publish/clone guard и Interview reload/report. Component tests покрывают основные loading/empty/error/protected-data states. Dashboard, session и locked Practice дополнительно проверены вручную при 390×844 и 1280×800; автоматический contrast audit в текущий gate не входит.

## Фактический результат 2026-08-02

| Gate                  | Результат                                                                                 |
| --------------------- | ----------------------------------------------------------------------------------------- |
| `npm install`         | успешно; npm workspaces и lockfile сохранены, `tsup` выровнен до одной 8.5.1              |
| DB backup             | две новые копии через `VACUUM INTO`, integrity/foreign keys проверены                     |
| migrate + seed x2     | успешно и идемпотентно; 7 дней, 14 topics                                                 |
| SQLite                | `integrity_check=ok`, `foreign_key_check=[]`                                              |
| format/lint/typecheck | успешно во всех workspaces                                                                |
| fast tests            | 21 свежая Turbo task без test cache; 305 тестов, orchestrator 27/27, web 48/48            |
| Playwright            | 4/4: theme, Day 1, Curriculum Editor snapshot, Interview restore                          |
| production build      | 12/12 workspace builds, 13 Next routes prerendered                                        |
| runtime               | web/orchestrator отвечают; desktop/mobile browser smoke и readiness `database=connected`  |
| Docker                | image собран; non-root user пишет в attempt-root и резолвит Vitest из `/app/node_modules` |
| Codex                 | проверка выполняется в финальном блоке                                                    |
| OpenCode              | проверка выполняется в финальном блоке                                                    |
| Zed                   | проверка выполняется в финальном блоке                                                    |

`npm audit` (без изменений зависимостей) показал 3 high production advisories в latest `next@16.2.12` через его pinned `postcss@8.4.31` и optional `sharp@0.34.5`, а также 1 low dev-only advisory в `esbuild` через `tsup`. `npm audit fix` без `--force` не нашёл безопасного обновления; esbuild 0.27.7 под tsup остаётся; `--force`/overrides не применялись (ошибочный downgrade next до 9.3.3).

## Итог по acceptance criteria

| Группа                                                          | Статус                                 | Комментарий                                                   |
| --------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------- |
| Запуск, migrations, seed, persistence, restart                  | Выполнено                              | canonical DB сохранена и повторно проверена                   |
| Light/dark/system, path, units, active session                  | Выполнено                              | component + E2E + ручные desktop screenshots                  |
| Day 1: briefing → summary → Day 2                               | Выполнено                              | полный Playwright vertical slice                              |
| Практика, Zed path, Git diff, tests, read-only correction cycle | Проверка выполняется в финальном блоке | Zed GUI и внешний smoke доберут отдельным блоком              |
| Mastery, mistake journal, flashcard candidates/export           | Выполнено                              | summary E2E и deterministic export unit tests                 |
| Curriculum Editor/versioning/history                            | Выполнено                              | draft/CRUD/reorder/publish/clone + snapshot E2E               |
| Interview как отдельный workflow                                | Выполнено                              | чат-UI, setup/questions/report/reload E2E и связка с day unit |
| Interview technical mastery evaluation                          | Частично                               | report честно оценивает полноту/форму, не correctness/mastery |
| Mock provider                                                   | Выполнено                              | offline fast/E2E provider                                     |
| Codex provider                                                  | Проверка выполняется в финальном блоке | финальный block заполнит реальный turn                        |
| OpenCode provider                                               | Проверка выполняется в финальном блоке | финальный block заполнит реальный turn                        |
| Security boundaries и запрещённые расширения                    | Выполнено                              | tests + финальный grep; Pi/IDE/AnkiConnect отсутствуют        |
| Dependency audit                                                | Частично                               | Hono исправлен; 3 upstream Next high + 1 dev low остаются     |

## External provider matrix

| Provider | Что можно доказать без model request      | Что требуется для smoke success                                  |
| -------- | ----------------------------------------- | ---------------------------------------------------------------- |
| Mock     | deterministic tests/flow                  | fast + E2E green                                                 |
| Codex    | CLI/version/login/status/model discovery  | фактический authenticated turn выбранной модели + terminal event |
| OpenCode | CLI/sidecar health/status/model discovery | фактический authenticated SDK turn + terminal event              |

Если внешний request не выполнен в текущем окружении, итог должен явно писать «не проверено» или точный blocker. Нельзя объявлять smoke успешным только по `connected`, наличию CLI, unit tests или Mock.

## Запрещённые расширения

Финальный grep/audit должен подтверждать отсутствие Pi/provider scaffolding, AnkiConnect/sync, Monaco/IDE/terminal UI, arbitrary shell endpoint, browser-side provider credentials, cloud auth и multi-user scope.
