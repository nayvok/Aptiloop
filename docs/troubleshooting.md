# Troubleshooting

## npm использует не тот workspace/runtime

```powershell
node --version
npm --version
npm config get prefix
git status --short
```

Нужны Node 24+ и npm 11+. Запускайте команды из корня с общим `package-lock.json`; не используйте pnpm/yarn, `workspace:*` и `--legacy-peer-deps`.

## SQLite открывается не из корня проекта

Canonical writable target is `<repo>/.data/dev-learning-harness.sqlite`. Runtime and writable database CLIs resolve from the repository root and reject `DATABASE_PROJECT_ROOT`, alternate candidates, `:memory:`, and arbitrary absolute paths before opening them.

```powershell
$env:DATABASE_URL = ".data/dev-learning-harness.sqlite"
npm run db:inventory -- --root .data --root data --root packages/database/.data
npm run db:inventory -- --db .data/dev-learning-harness.sqlite
npm run db:backup -- --source .data/dev-learning-harness.sqlite --destination .data/approved-backups/pre-migration-2026-08-08T120000Z.sqlite
npm run db:migrate
npm run db:seed
```

If a prototype created another database under a package/data directory, do not move, merge, migrate, back up as approved, or delete it. M1 designates only `.data/dev-learning-harness.sqlite` active and enforces that target in runtime and writable CLIs; five alternate families and all eleven old backups remain quarantined unchanged until M2 reconciliation.

## Backup не создаётся

`db:backup` requires one explicit active `--source` and one new `.sqlite` `--destination` directly under `.data/approved-backups/`. It fails on `:memory:`, a non-active source, an existing destination, unstable source hashes, health/migration errors, or logical raw/tool/review payload rows. Do not bypass it by copying an active main/WAL file manually.

## Старая DB не открывает current session

Early prototype schemas may need compatibility repair. First inventory all candidates without mutation. Repair only the owner-approved active file and only after a new approved backup:

```powershell
npm run db:inventory -- --db .data/dev-learning-harness.sqlite
npm run db:backup -- --source .data/dev-learning-harness.sqlite --destination .data/approved-backups/pre-repair-2026-08-08T120000Z.sqlite
npm run db:migrate
npm run db:seed
```

Migration can rewrite schema/snapshot bytes. It retains legacy session history, but after commit the rollback is whole-file restore from the new approved backup—not a quarantined historical copy.

## Порты заняты

Обычный dev: `3000/8787`; E2E: `3100/8887`; OpenCode: `4096`.

```powershell
Get-NetTCPConnection -LocalPort 3000,8787,3100,8887,4096 -ErrorAction SilentlyContinue |
  Select-Object LocalPort,State,OwningProcess
```

Завершайте только проверенный PID. Не убивайте все Node-процессы. Для dev согласованно меняйте `PORT`, `WEB_ORIGIN` и `ORCHESTRATOR_URL`; не используйте `0.0.0.0`.

## E2E не стартует или видит Next lock

```powershell
npx playwright install chromium
npm run test:e2e
```

Free `3100/8887`; deleting a lock does not replace stopping its owner. E2E uses one `.data/e2e-runs/<run-id>/` root for a file-backed disposable database, attempts, Next output, and logs, with `reuseExistingServer: false` and `retries: 0`. On failure inspect `.verify/e2e-failures/<run-id>/playwright-results` and service logs; CI uploads the same directory. Do not enable retries to mask a flake.

## Занятие не продолжилось после reload

Проверьте, что оба приложения смотрят на одну DB и путь возвращает active published revision:

```powershell
Invoke-WebRequest http://127.0.0.1:8787/health/ready
```

API routes требуют локальный client header, а mutations также Origin/JSON. Проще проверить через UI. Не создавайте вручную second active session; `GET /api/learning/sessions/current` должен вернуть сохранённый snapshot/progress.

## Review пишет «нужен актуальный passed test»

После любой правки файлов нужно снова нажать «Запустить тесты». Review отклоняется, если diff пуст, latest test failed или filesystem `mtime` новее test completion. Если tool сохранил старый timestamp, текущая mtime-проверка может быть недостаточна; это известное ограничение, диагностируйте diff и запускайте новый test.

Reviewer никогда не применяет патч. После `changes_requested` исправьте код в Zed, затем создайте новый test/review cycle.

## Zed не открывается

```powershell
Get-Command zed -ErrorAction SilentlyContinue
```

`ZED_EXECUTABLE` — один executable/path без аргументов shell. UI показывает проверенный attempt path для ручного открытия. В Docker desktop Zed из Linux container не запускается.

## Codex unavailable/misconfigured

```powershell
Get-Command codex
codex --version
codex login status
```

M1 readiness endpoints intentionally report Codex as policy-blocked without invoking it. The commands above are manual adapter diagnostics only; they are not learning-provider or model-response evidence, and an external-provider smoke is not permitted until its later approval gate.

## OpenCode unavailable

```powershell
Get-Command opencode
opencode --version
Invoke-WebRequest http://127.0.0.1:4096/global/health
```

Validate `OPENCODE_ENDPOINT`, username/password, and CLI/SDK compatibility manually. The endpoint must be HTTP loopback without path/credentials/query. `npm start` and Compose do not launch a sidecar, and M1 readiness/learning routes do not activate OpenCode. `host.docker.internal` is not accepted as loopback.

## Запуск OpenCode sidecar

```text
Запуск OpenCode sidecar для локального провайдера:
OPENCODE_SERVER_PASSWORD=<пароль> opencode serve --hostname 127.0.0.1 --port 4096
Проверка: GET http://127.0.0.1:4096/health → 200.
Пароль передаётся только через environment и не логируется.
```

## Interview report не оценивает correctness

Это ожидаемое ограничение MVP: отчёт хранит completion/length/structure evidence. Он не сравнивает ответы с rubric/reference и не меняет mastery. Для технической оценки используйте Teacher/Reviewer или ручную проверку; не интерпретируйте completion rate как correctness score.

## Тестовый процесс завис

Runner имеет timeout/output cap и завершает process tree. На Windows сначала найдите адресный процесс:

```powershell
Get-CimInstance Win32_Process |
  Where-Object CommandLine -Match 'vitest|normalize-profile|collection-toolkit' |
  Select-Object ProcessId,CommandLine
```

Не завершайте все `node.exe` без проверки command line.
