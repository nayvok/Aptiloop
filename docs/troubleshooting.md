# Troubleshooting

## npm использует старое или смешанное дерево

Проверьте Node/npm и workspace root:

```powershell
node --version
npm --version
npm config get prefix
```

Проект npm-only. Удалите появившиеся `pnpm-lock.yaml`/локальные pnpm workspace files вручную, затем выполните `npm install` из корня. Не используйте `--legacy-peer-deps`: root намеренно фиксирует TypeScript 6, совместимый с текущим typescript-eslint.

## SQLite не открывается

Node должен быть 24+, поскольку используется `node:sqlite`. Проверьте путь `DATABASE_URL`, права на родительскую папку и отсутствие процесса, удерживающего файл. Затем:

```powershell
npm run db:migrate
npm run db:seed
```

Для Docker смотрите `docker compose logs orchestrator` и состояние volume через `docker volume ls`. Не удаляйте volume, если нужны учебные данные.

## Порты заняты в Windows

```powershell
Get-NetTCPConnection -LocalPort 3000,8787,4096 -ErrorAction SilentlyContinue
Get-Process -Id (Get-NetTCPConnection -LocalPort 8787).OwningProcess
```

Остановите известный процесс или согласованно измените `PORT`, `WEB_ORIGIN` и web/orchestrator URL. Не переводите orchestrator на `0.0.0.0` для обычного local run.

## Zed не открывается

```powershell
Get-Command zed -ErrorAction SilentlyContinue
```

Если CLI не в PATH, задайте `ZED_EXECUTABLE` абсолютным путём к executable. Значение — один command/path, не строка shell с аргументами. UI должен показать проверенный path для копирования; откройте папку вручную.

В Docker desktop Zed не запускается из Linux container — используйте copy-path fallback или npm-запуск на host.

## Codex unavailable/misconfigured

```powershell
Get-Command codex
codex --version
codex login status
```

Harness запускает `codex app-server --listen stdio://`. Перезапустите orchestrator после обновления/login. Если версия app-server изменила RPC, Mock остаётся доступным; не подменяйте ошибочный status на connected.

## OpenCode не подключается

```powershell
Get-Command opencode
opencode --version
Invoke-WebRequest http://127.0.0.1:4096/global/health
```

Проверьте, что server слушает именно loopback, а `.env` использует `OPENCODE_ENDPOINT`, не устаревшее `OPENCODE_BASE_URL`. Username/password у sidecar и harness должны совпадать. SDK package и CLI/server должны быть совместимы по версии.

OpenCode через текущий Compose не поддержан: `host.docker.internal` не является loopback для adapter-а. Запускайте web/orchestrator через npm на host.

## Docker build не находит package-lock или public

```powershell
npm install
Test-Path package-lock.json
Test-Path apps/web/public
docker compose build --no-cache
```

Dockerfiles используют `npm ci` и копируют `apps/web/public`. Оба пути должны существовать. Если Compose завис в startup, выполните `docker compose ps` и `docker compose logs --tail=200 orchestrator web`.

## Тест не завершается

Runner ограничивает время и output. После cancel на Windows дерево завершается через `taskkill /T /F`. Если остался известный дочерний `node`/`vitest`, сначала найдите его по command line, не завершайте все процессы Node без разбора:

```powershell
Get-CimInstance Win32_Process | Where-Object CommandLine -Match 'vitest|collection-toolkit' | Select-Object ProcessId,CommandLine
```

## E2E не стартует

```powershell
npx playwright install chromium
npm run test:e2e
```

Убедитесь, что порты 3000/8787 свободны и migrations/seed выполнены. Для диагностики используйте Playwright trace, а не отключение readiness checks.
