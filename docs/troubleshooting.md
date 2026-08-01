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

Canonical default — `<repo>/.data/dev-learning-harness.sqlite`. Database CLI учитывает `DATABASE_PROJECT_ROOT`, поэтому workspace cwd не должен создавать `packages/database/.data`.

```powershell
$env:DATABASE_PROJECT_ROOT = (Get-Location).Path
$env:DATABASE_URL = ".data/dev-learning-harness.sqlite"
npm run db:backup
npm run db:migrate
npm run db:seed
```

Если ранее prototype уже создал другую DB под package directory, не удаляйте её вслепую. `db:backup` обнаруживает configured/canonical/legacy `data/` candidates, создаёт отдельные timestamped copies и печатает их absolute paths. Сравните содержимое осознанно.

## Backup не создаётся

`db:backup` ожидает существующую file DB и не работает с `:memory:`. Он откажется от source с ошибкой `integrity_check`/foreign keys и не перезапишет existing destination. Исправьте путь/права; не обходите проверку обычным копированием активного WAL-файла.

## Старая DB не открывает current session

В ранних prototype schema migration 0002 могла быть записана до выполнения TypeScript normalization или без `unit_progress.unit_type`. Повторно запустите:

```powershell
npm run db:backup
npm run db:migrate
npm run db:seed
```

Migration включает repeatable repair schema/snapshot. Legacy session сохраняется в истории, но current versioned UI выбирает активную versioned session; старый `legacy-v1` не подменяет новый путь.

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

Освободите `3100/8887`; удаление lock не заменяет остановку владельца процесса. E2E использует `.next-e2e`, in-memory DB, отдельные attempts, `reuseExistingServer: false` и `retries: 0`. Failure означает реальную ошибку текущего прогона; изучите retained trace/test-results, не включайте retries для маскировки flake.

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

Перезапустите orchestrator после install/login. Status `connected` подтверждает health/discovery, но не model response: выполните реальный Teacher turn перед заявлением smoke success.

## OpenCode unavailable

```powershell
Get-Command opencode
opencode --version
Invoke-WebRequest http://127.0.0.1:4096/global/health
```

Проверьте `OPENCODE_ENDPOINT`, username/password и совместимость CLI/SDK. Endpoint должен быть HTTP loopback без path/credentials/query. `npm start` пытается поднять sidecar и продолжает с Mock/Codex при failure. В Compose `host.docker.internal` не принимается как loopback.

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
