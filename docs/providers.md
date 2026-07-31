# AI-провайдеры

Все adapters реализуют общий `AgentProvider`: status, models, session, streaming и cancel. Orchestrator отдаёт UI только нормализованные события. Mock остаётся рабочим, даже если внешние CLI недоступны.

## Mock

Mock — провайдер по умолчанию для разработки, Docker, тестов и offline flow. Он детерминированно поддерживает streaming, error/retry, review и interview scenarios, не использует сеть и credentials.

## Codex

Требуется установленный и авторизованный Codex CLI:

```powershell
codex --version
codex login status
```

Harness сам запускает дочерний процесс:

```text
codex app-server --listen stdio://
```

Adapter реализует узкий JSON-RPC клиент только для `initialize`, `account/read`, `model/list`, `thread/start`/`thread/resume`, `turn/start` и `turn/interrupt`. Raw RPC не доступен browser. Server-initiated client methods, tools и approval prompts отклоняются.

Для Reviewer thread создаётся с read-only sandbox и `approvalPolicy: never`; turn также получает read-only policy без network. Другие роли используют workspace-write policy, но orchestrator всё равно не предоставляет произвольный API применения патчей. Аутентификация переиспользует локальное хранилище Codex CLI; секрет в `.env` не нужен.

После запуска harness откройте `Настройки → Роли агентов`, выберите `codex` для нужной роли и укажите модель из обнаруженного списка. Настройки сохраняются в локальной SQLite и применяются к следующему сообщению без перезапуска приложения.

Если CLI не найден, не выполнен login или RPC несовместим, UI должен показать `unavailable`, `misconfigured` или `error`, не маскируя проблему под Mock.

## OpenCode

Версия SDK должна совпадать с версией sidecar. Запустите server в отдельном терминале:

```powershell
$env:OPENCODE_SERVER_USERNAME = "opencode"
$env:OPENCODE_SERVER_PASSWORD = "replace-me"
opencode serve --hostname 127.0.0.1 --port 4096
```

В `.env` harness:

```dotenv
OPENCODE_ENDPOINT=http://127.0.0.1:4096
OPENCODE_SERVER_USERNAME=opencode
OPENCODE_SERVER_PASSWORD=replace-me
```

Endpoint намеренно принимает только `http` на loopback (`localhost`, `127.0.0.0/8` или `::1`), без credentials, path, query и fragment. Password преобразуется в Basic Auth header в памяти и не должен сохраняться в SQLite/logs.

Adapter проверяет health, получает connected providers/models, создаёт session, подписывается на SSE до async prompt, нормализует parts/tool events, запрашивает итоговое message и поддерживает abort. Reviewer session получает deny permissions для patch/write/edit/mutation-capable tools.

Корневой `.env` автоматически загружается orchestrator-ом при локальном запуске. Затем в `Настройки → Роли агентов` выберите `opencode` и модель; endpoint также можно изменить в форме настроек, он применяется сразу. Сам sidecar должен продолжать работать в отдельном терминале — либо используйте `npm start`, который запустит его вместе с приложением.

## Docker и внешние провайдеры

Mock полностью работает в Compose. Codex app-server находится на host и не включён в image. Текущий OpenCode security policy отвергает `host.docker.internal`, потому что это не loopback относительно контейнера; для OpenCode запускайте harness через npm на host. Не публикуйте OpenCode server на `0.0.0.0` ради обхода этого ограничения.

## Ручной smoke checklist

1. Убедиться, что provider status — `connected`.
2. Получить реальный список моделей и выбрать доступную модель для роли.
3. Отправить короткое сообщение, увидеть delta и terminal event.
4. Отменить длинный turn и проверить освобождение процесса/session.
5. Для Reviewer передать diff и убедиться, что файлы до и после идентичны.

Наличие unit test adapter-а не подтверждает реальную авторизацию или доступность внешней модели.
