# Модель безопасности

> **Historical snapshot — non-authoritative.** This file records an earlier **Implemented baseline** and is preserved for context only. Do not use it as current security policy or approval evidence. See the [current documentation index](README.md).

## Scope и actors

Это локальное single-user приложение без auth. Тем не менее browser input, provider output, DB JSON, пути и содержимое exercise считаются недоверенными. Поддерживаемый bind — HTTP loopback; remote/LAN deployment не является безопасным режимом MVP.

Allowlisted exercise — доверенный код из репозитория. Allowlist предотвращает выбор произвольной команды, но не создаёт sandbox для выполняемого JavaScript.

## Browser → HTTP boundary

Каждый `/api/*` request требует `X-DLH-Client: web` (кроме test environment). Mutations требуют loopback `Origin` на порту из `WEB_ORIGIN` (`127.0.0.1`, `localhost` или `[::1]`), и `Content-Type: application/json`. Bodies проверяются strict Zod schemas.

Browser mutations отправляют operation ID, entity ID и учебные данные. Они не выбирают executable, args, cwd, provider RPC или raw tool. Локальные workspace/Zed settings доступны только как read-only diagnostic strings; mutation schema намеренно их исключает. Реальные filesystem objects/handles browser не получает.

Learner session/path DTO не содержит protected reference answers и quiz answer keys. Quiz response сообщает aggregate score/attempted IDs, а не правильный option каждого вопроса. Raw Codex/OpenCode protocol не отдаётся UI: adapter переводит его в общий event contract.

Local client header не заменяет auth; защита опирается также на loopback bind и Origin. Не выставляйте orchestrator в сеть.

**Implemented baseline.** Классификация клиентских ошибок явная: предназначенные для browser отклонения бросаются как типизированный `ClientError` (`packages/shared/src/errors.ts`) со статусом `400 | 404 | 409` и точным сообщением; глобальный `onError` не классифицирует ошибки по текстовым префиксам сообщений. Неожиданные внутренние сбои возвращают generic `{ error: "Internal server error", diagnosticId }` со статусом 500 и логируются серверно с тем же diagnosticId. Роуты управления провайдерами (`/api/settings/ai/*`) следуют тому же контракту через узкие catch: ожидаемые ошибки сохраняют точные тексты и статусы, всё остальное — generic 500 + diagnosticId без утечки internals. Trusted-check план для legacy Node окружения резолвится при старте orchestrator'а с проверкой существования `npm_execpath` / fallback `npm-cli.js`; отсутствие кандидата — fail-fast ошибка старта с понятным сообщением вместо тихого падения spawn при выполнении проверки.

## Filesystem и Git

Templates разрешаются внутри `WORKSPACE_ROOT`; попытки создаются только внутри `EXERCISE_ATTEMPTS_ROOT`. Canonical path checks отклоняют traversal, absolute/drive/UNC/device paths, control characters, Windows reserved names, alternate-data-stream syntax и symlink/junction/reparse escape.

Template копируется до работы пользователя. Baseline создаётся в изолированной attempt folder и фиксируется marker/commit hash. Diff строится read-only относительно ожидаемого baseline с отключёнными external diff/textconv. Zed получает проверенный absolute attempt path одним аргументом.

Не удаляйте attempt roots по непроверенному вычисленному пути. E2E cleanup отдельно доказывает, что canonical target находится под repo `.data`.

## Процессы

Public API принимает только `commandId: "test"`. Server выбирает executable/args/cwd/timeout; `AllowedProcessRunner` использует `spawn` с `shell: false`, sanitizes inherited environment, ограничивает суммарный output и завершает process tree при cancel/timeout/output limit. На Windows допустим адресный `taskkill /T /F` fallback для известного PID.

Git/Zed/provider child processes также не используют browser command lines. Никогда не добавляйте endpoint вида `run(command)` или terminal UI.

## Reviewer

Reviewer получает сериализованный brief, constraints, criteria, diff, test output и prior review count, но не writable filesystem handle.

- Codex thread/turn: read-only sandbox, network disabled, approval `never`.
- OpenCode session: deny patch/write/edit/mutation tools.
- Orchestrator сравнивает baseline/diff до и после review и отвергает изменение.
- В API нет apply/edit route.

Review остаётся советом. Пользователь применяет correction сам в Zed и подтверждает новым test/review cycle.

## Secrets и provider data

OpenCode password читается из environment и превращается в Authorization header только в памяти. Codex auth берётся из локального CLI store. В SQLite допустимы endpoint, provider/model IDs, normalized transcript/result и non-secret settings; token/password/cookie/Authorization хранить нельзя.

Process environment проходит allowlist/sanitization перед упражнением. Logs/errors не должны содержать credentials, provider stderr, headers или stack trace в пользовательском response. Structured provider output валидируется до использования. Сохранённый raw assistant response нужен для audit/reparse, но не должен содержать секреты и не возвращается как raw provider protocol.

## Database

Foreign keys включены; file DB использует WAL. Перед миграцией создаётся verified backup через `VACUUM INTO`; source/copy проходят integrity и foreign-key checks. Migration repair сохраняет legacy rows, rebuild выполняется транзакционно.

Curriculum publication immutable и transactional. Session snapshot сохраняет content hash, поэтому draft/published changes не переписывают historical evidence.

## Известные ограничения

- JS tests выполняются с полномочиями локального пользователя: это trusted-only execution, не sandbox.
- Актуальность test/review после learner edit основана на `mtime`; подделка timestamp может обойти check. Требуемое усиление — diff/tree hash.
- Отсутствие remote auth означает, что LAN exposure запрещён operational rule, а не поддерживаемая configuration.
- Mock boundary tests не доказывают policies фактической версии внешнего provider; это проверяется отдельным smoke.

## Security regression checklist

- Origin/content-type/client-header rejection;
- Zod rejects unknown fields and forged quiz/reference payloads;
- traversal/UNC/symlink/junction escape tests;
- unknown operation/command ID rejection;
- process env redaction, timeout, cap и cleanup;
- Reviewer before/after diff invariant;
- published revision mutation rejection;
- backup integrity/FK check и legacy migration test;
- grep на Pi, AnkiConnect, Monaco, arbitrary shell/apply endpoints и secrets.
