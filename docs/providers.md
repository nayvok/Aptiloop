# AI-провайдеры

Все adapters реализуют общий lifecycle `status → models → session → normalized stream → cancel`. Orchestrator выбирает provider/model из локальных settings; browser не получает credentials, raw RPC/events, provider session handles или tool API. Mock доступен независимо от внешних CLI.

## Что означает status

`GET /api/providers` и экран настроек показывают результат реального health/discovery check:

- `connected` — adapter/CLI доступен и, где поддерживается, список моделей получен;
- `unavailable` — executable/sidecar/endpoint недоступен;
- `misconfigured` — endpoint/auth/model configuration некорректны;
- `error` — проверка завершилась ошибкой.

`connected` **не доказывает**, что фактический model turn успешно выполнен. External provider smoke считается успешным только после authenticated запроса, terminal event и содержательного ответа от выбранной модели. Unit/contract tests и наличие CLI этого не подтверждают.

## Mock

Mock — offline default для разработки и тестов. Он детерминированно выдаёт stream, Teacher/interview replies и correction-cycle review: первый review запрашивает изменения, последующий при server-derived prior-review context может пройти. Credentials и сеть не нужны.

Mock проверяет продуктовый flow и boundary contracts, но не качество внешней модели.

## Codex

Требуется локальный Codex CLI и авторизация:

```powershell
codex --version
codex login status
```

Harness запускает `codex app-server --listen stdio://` как дочерний процесс и использует узкий JSON-RPC набор: initialize/account/model discovery, thread start/resume, turn start/interrupt. Server-initiated tools/approval requests отклоняются; raw RPC не выходит из adapter.

Для Reviewer применяются `sandbox=read-only`, network disabled и `approvalPolicy=never`. Orchestrator дополнительно сравнивает Git diff до/после review. Для остальных ролей provider policy не расширяет browser/orchestrator API: произвольного shell или apply-patch endpoint всё равно нет.

Auth переиспользует локальное хранилище Codex CLI; Codex token в `.env` не нужен. После выбора Codex/модели в `Настройки` настройка применяется к новому provider session.

## OpenCode

Можно запустить sidecar вручную:

```powershell
$env:OPENCODE_SERVER_USERNAME = "opencode"
$env:OPENCODE_SERVER_PASSWORD = "replace-me"
opencode serve --hostname 127.0.0.1 --port 4096
```

```dotenv
OPENCODE_ENDPOINT=http://127.0.0.1:4096
OPENCODE_SERVER_USERNAME=opencode
OPENCODE_SERVER_PASSWORD=replace-me
```

Или используйте `npm start`: launcher сначала проверяет `/global/health`, при необходимости пытается запустить `opencode serve`, а при неудаче продолжает с Mock/Codex. Созданный launcher-ом sidecar завершается вместе с приложением.

Endpoint принимает только HTTP loopback (`localhost`, `127.0.0.0/8`, `::1`) без embedded credentials, path, query и fragment. Password превращается в Basic Auth header в памяти и не сохраняется в SQLite/logs.

Adapter получает health/models через SDK, создаёт session, подписывается на events, нормализует message/tool events и поддерживает abort. Reviewer получает deny permissions для patch/write/edit и других mutation-capable tools.

## Ручной smoke

Для каждого внешнего provider отдельно:

1. Проверить CLI/sidecar и status `connected`.
2. Получить server-reported model list и выбрать существующую модель.
3. Выполнить фактический Teacher turn и дождаться terminal `completed`.
4. Проверить сохранение assistant message после reload.
5. Отменить длинный turn и проверить cleanup.
6. Выполнить Reviewer turn на learner diff и сравнить workspace до/после.
7. Записать точную версию CLI/model и фактический результат; не переносить успех одного provider на другой.

Если CLI/auth/request не проверены в текущем окружении, acceptance report должен писать «не проверено» или точный blocker, а не `passed`.

## Docker

Compose гарантированно покрывает Mock. Codex CLI находится на host и не входит в image. `host.docker.internal` не loopback относительно container, поэтому текущий OpenCode adapter его отвергает; не публикуйте sidecar на `0.0.0.0` ради обхода. Для внешних providers используйте npm-запуск на host.
