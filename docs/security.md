# Модель безопасности

## Scope

Это local single-user приложение, но browser, provider output и пути считаются недоверенными. В MVP нет auth и remote deployment. Bind по умолчанию — `127.0.0.1`; публикация orchestrator в локальную сеть не поддерживается как безопасный режим.

## HTTP boundary

- `WEB_ORIGIN` задаёт точный разрешённый Origin.
- State-changing requests должны проверять Origin и ожидаемый content type.
- Bodies, DB JSON и structured provider output валидируются Zod.
- SSE не раскрывает raw provider protocol, stack traces или credentials.
- Provider failure не должен блокировать DB, curriculum, diff, tests и export.

## Файлы и пути

Browser отправляет entity ID и относительный subpath. `exercise-core` отклоняет absolute/drive/UNC/device paths, `.`/`..`, control characters, reserved Windows names, NTFS alternate data stream syntax и reparse/symlink escape. Root и существующие segments canonicalized через `realpath`.

Git baseline создаётся для отдельного упражнения до изменений. Diff — наблюдение, не механизм записи. Zed получает только проверенный absolute path как отдельный аргумент.

## Процессы

Публичный контракт использует operation ID; executable, args, cwd, timeout и output cap выбирает server. `AllowedProcessRunner` использует `spawn(..., { shell: false })`, ограничивает общий stdout/stderr, завершает process tree при cancel/timeout/output limit; на Windows используется `taskkill /T /F` fallback.

Allowlist защищает от command injection, но не изолирует код упражнения. Запускайте только доверенные упражнения из репозитория. Для стороннего кода нужен отдельный container/low-privilege sandbox, которого в MVP нет.

## Reviewer

У Reviewer нет route «apply», writable handle или mutation API. Codex получает read-only sandbox, no network и approval `never`. OpenCode получает deny rules для patch/write/edit и других mutation-capable tools. Дополнительный invariant: workspace/diff до и после review не должен меняться.

## Секреты

Credentials читаются только из environment. В SQLite допустимы endpoint, provider/model IDs и non-secret flags. Не логируйте Authorization, password, token, cookie, provider stderr или полный raw event. Ошибки пользователю должны быть безопасными и без production stack.

## Docker

Compose публикует web и orchestrator только на loopback. Container работает непривилегированным пользователем и хранит SQLite в named volume. Bind-mounted exercise directory остаётся writable host-состоянием; это не security sandbox. Не подключайте Docker socket и не запускайте container privileged.

## Перед релизом

- path traversal, UNC и symlink/junction escape tests;
- unknown operation ID rejection;
- Origin/content-type tests для mutations;
- log redaction tests;
- reviewer no-write contract и before/after diff;
- cancel/timeout/output-limit cleanup на Windows и POSIX;
- поиск секретов и запрещённых shell/process surfaces.
