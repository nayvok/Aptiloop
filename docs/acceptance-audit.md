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

Playwright covers the product path with explicit test-only Mock, a real isolated file-backed database/attempt root, authoring/publish/clone with snapshot preservation, the dedicated interview, and theme hydration. Each run uses unique launcher-owned data under `.data/e2e-runs/`, fixed lock-serialized loopback ports `3100/8887` that fail closed if occupied, `retries: 0`, and retained failure diagnostics under `.verify/e2e-failures/`; the ports do not provide parallel run isolation, and the suite never mutates the trusted template.

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

- Writable database paths are resolved from the repository root and restricted to the designated active target.
- `db:inventory` inspects disposable SQLite-family copies without exposing learner content.
- `db:backup` creates a non-overwriting copy with the Node `node:sqlite` online `backup()` API, binds its logical digest to the approved source snapshot, and checks source/copy integrity plus foreign keys.
- Fresh databases bootstrap to the exact current migration contract. The audited legacy active database may use only its named exact compatibility contract and data invariants; it is not silently repaired or reconciled.
- A recorded migration ledger with any unapproved schema drift is rejected without repeat repair.
- Versioned curriculum seeding is idempotent.

A fresh approved backup is required before any future authorized migration of a valuable database. Discovered legacy or package-local databases remain preserved until explicit reconciliation.

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
npm ci
npm run audit:policy -- --output-dir .verify/supply-chain
npm run sbom -- --output .verify/supply-chain/sbom.cdx.json
npm run db:inventory -- --db .data/dev-learning-harness.sqlite
npm run db:backup -- --source .data/dev-learning-harness.sqlite --destination .data/approved-backups/pre-gate-2026-08-08T120000Z.sqlite
npm run db:migrate
npm run db:seed
npm run format:check
npm run lint
npm run typecheck
npm run test:fast
npm run test:e2e
npm run build
```

Skip approved backup only for a new/`:memory:` disposable database. For valuable data, use one fresh destination under `.data/approved-backups/`; never use a quarantined alternate family or old backup. Repeat migration/seed idempotency and integrity/foreign-key/private-payload checks on a disposable copy.

Browser acceptance проверяет light/dark hydration, path, start/resume, practice, correction, summary, Day 2 unlock, Editor draft/publish/clone guard и Interview reload/report. Component tests покрывают основные loading/empty/error/protected-data states. Dashboard, session и locked Practice дополнительно проверены вручную при 390×844 и 1280×800; автоматический contrast audit в текущий gate не входит.

## Фактический результат 2026-08-02

| Gate                  | Результат                                                                                                                                                               |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm install`         | успешно; npm workspaces и lockfile сохранены, `tsup` выровнен до одной 8.5.1                                                                                            |
| DB backup             | две новые копии через `VACUUM INTO`, integrity/foreign keys проверены                                                                                                   |
| migrate + seed x2     | успешно и идемпотентно; 7 дней, 14 topics                                                                                                                               |
| SQLite                | `integrity_check=ok`, `foreign_key_check=[]`                                                                                                                            |
| format/lint/typecheck | успешно во всех 12 workspaces                                                                                                                                           |
| fast tests            | все 21 Turbo task зелёные: web 54/54, orchestrator 33/33, database 10/10 и остальные                                                                                    |
| Playwright            | 4/4: theme, Day 1 (с планом дня), Curriculum Editor snapshot, Interview chat + session                                                                                  |
| production build      | 12/12 workspace builds, 13 Next routes prerendered (в `NEXT_DIST_DIR=.next-gate`)                                                                                       |
| runtime               | web/orchestrator отвечают; desktop/mobile browser smoke и readiness `database=connected`                                                                                |
| Docker                | image собран; non-root user пишет в attempt-root и резолвит Vitest из `/app/node_modules`                                                                               |
| Codex                 | реальный turn выполнен: provider=codex, model=gpt-5.6-terra, CLI 0.144.3, terminal `completed`, ответ Teacher сохранён после reload                                     |
| OpenCode              | реальный turn выполнен: provider=opencode, model=opencode/deepseek-v4-flash-free, CLI/SDK 1.18.3, sidecar health 200, terminal `completed`, ответ сохранён после reload |
| Zed                   | attempt создан, `POST /api/exercise-attempts/:id/open` → `opened:true`, процесс Zed запущен, attempt-папка создана; визуальное подтверждение окна — за пользователем    |

`npm audit` (без изменений зависимостей) показал 3 high production advisories в latest `next@16.2.12` через его pinned `postcss@8.4.31` и optional `sharp@0.34.5`, а также 1 low dev-only advisory в `esbuild` через `tsup`. `npm audit fix` без `--force` не нашёл безопасного обновления; esbuild 0.27.7 под tsup остаётся; `--force`/overrides не применялись (ошибочный downgrade next до 9.3.3).

Примечания к gate 2026-08-02:

- `npm run build` из корня штатно не выполнялся: запущенный пользователем production standalone-сервер держит `.next/standalone/apps/web` (EBUSY). Сборка проверена в изолированный `NEXT_DIST_DIR=.next-gate` (12/12, 13 routes). Для штатного `npm run build` нужно остановить запущенный `node server.js`.
- Исправлен time-dependent баг выбора активной программы: seed писал `curricula.updated_at = publishedAt` активной ревизии (`2026-08-02T00:00:00Z`), что при часовом поясе/клоке «в будущем» перебивало реальную новую публикацию (`ORDER BY updated_at DESC`). Seed теперь клампит wall-clock маркер к моменту сида и само-чинит существующие строки при ре-сиде; добавлен regression-тест.
- Typecheck-баг в `packages/database/src/snapshot-contract.ts` (fallback briefing-payload без обязательного `outOfScope`) исправлен — это блокировало typecheck всех workspaces.

## Итог по acceptance criteria

| Группа                                                          | Статус    | Комментарий                                                                                         |
| --------------------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------- |
| Запуск, migrations, seed, persistence, restart                  | Выполнено | canonical DB сохранена и повторно проверена                                                         |
| Light/dark/system, path, units, active session                  | Выполнено | component + E2E + ручные desktop screenshots                                                        |
| Day 1: briefing → summary → Day 2                               | Выполнено | полный Playwright vertical slice + план дня в сессии                                                |
| День 7: interview-юнит и прохождение дня                        | Выполнено | orchestrator integration: ≥3 ответа + reportId, полный день 7                                       |
| Практика, Zed path, Git diff, tests, read-only correction cycle | Выполнено | реальный attempt и запуск GUI Zed; коррекционный цикл в E2E                                         |
| Mastery, mistake journal, flashcard candidates/export           | Выполнено | summary E2E и deterministic export unit tests                                                       |
| Curriculum Editor/versioning/history                            | Выполнено | draft/CRUD/reorder/publish/clone + snapshot E2E                                                     |
| Interview как отдельный workflow                                | Выполнено | чат-UI, setup/questions/report/reload E2E и связка с day unit                                       |
| Interview technical mastery evaluation                          | Частично  | report честно оценивает полноту/форму, не correctness/mastery                                       |
| Mock provider                                                   | Выполнено | offline fast/E2E provider                                                                           |
| Codex provider                                                  | Выполнено | реальный Teacher turn: gpt-5.6-terra, terminal completed, сохранение после reload                   |
| OpenCode provider                                               | Выполнено | реальный Teacher turn: opencode/deepseek-v4-flash-free, terminal completed, сохранение после reload |
| Security boundaries и запрещённые расширения                    | Выполнено | tests + финальный grep; Pi/IDE/AnkiConnect отсутствуют                                              |
| Dependency audit                                                | Частично  | Hono исправлен; 3 upstream Next high + 1 dev low остаются                                           |

## External provider matrix

| Provider | Что можно доказать без model request      | Что требуется для smoke success                                  |
| -------- | ----------------------------------------- | ---------------------------------------------------------------- |
| Mock     | deterministic tests/flow                  | fast + E2E green                                                 |
| Codex    | CLI/version/login/status/model discovery  | фактический authenticated turn выбранной модели + terminal event |
| OpenCode | CLI/sidecar health/status/model discovery | фактический authenticated SDK turn + terminal event              |

Если внешний request не выполнен в текущем окружении, итог должен явно писать «не проверено» или точный blocker. Нельзя объявлять smoke успешным только по `connected`, наличию CLI, unit tests или Mock.

## Запрещённые расширения

Финальный grep/audit должен подтверждать отсутствие Pi/provider scaffolding, AnkiConnect/sync, Monaco/IDE/terminal UI, arbitrary shell endpoint, browser-side provider credentials, cloud auth и multi-user scope.
