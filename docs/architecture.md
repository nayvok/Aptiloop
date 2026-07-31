# Архитектура Dev Learning Harness

Статус: MVP specification v1  
Дата: 2026-07-31

## 1. Цели и границы

Dev Learning Harness — локальная single-user платформа. Web показывает учебный поток; orchestrator владеет данными, файловыми операциями, процессами и AI-провайдерами. Пользователь пишет код только в Zed. Браузер никогда не передаёт произвольную команду в shell.

Не входят в MVP: auth, cloud sync, multi-user, AnkiConnect, встроенный IDE/терминал, произвольный code execution sandbox, Pi и автоматическое исправление решений Reviewer-ом.

## 2. Решения

### ADR-001: npm workspaces + Turborepo

Два приложения и сфокусированные packages используют npm workspaces, один `package-lock.json` и общие задачи `lint`, `typecheck`, `test`, `build`. Internal packages имеют одинаковую локальную версию; отдельная публикация не предполагается. pnpm/yarn и `workspace:*` не используются.

```text
apps/
  web/                 Next.js UI
  orchestrator/        Hono HTTP/SSE, process lifecycle
packages/
  shared/              Zod contracts, DTO, error model
  learning-core/       deterministic mastery/review/hint rules
  agent-core/          provider contract, event normalization
  codex-provider/      narrow Codex app-server stdio adapter
  opencode-provider/   official OpenCode SDK/server adapter
  prompt-library/      versioned prompts and output schemas
  curriculum/          week-one content
  database/            node:sqlite + Drizzle schema, migrations, repositories
  testing/             fixtures and mock provider helpers
content/               author-facing markdown/reference material
workspaces/exercises/  trusted local exercises
```

### ADR-002: Next.js UI, отдельный Hono orchestrator

Next.js 16/React 19 отвечает только за presentation и browser state. Hono на Node.js владеет SQLite, Git diff, test processes, Zed launch и provider sessions. Такое разделение не даёт Client Components прямого доступа к filesystem/process API и позволяет тестировать orchestration независимо.

Browser ↔ orchestrator:

- JSON REST для reads/mutations;
- SSE для agent stream и test output;
- `AbortController` + `DELETE /api/agent/sessions/:id/turn` для отмены;
- WebSocket не нужен для MVP.

### ADR-003: SQLite + Drizzle, нормализованное ядро и JSON для authoring payloads

Основные таблицы:

- `topics`, `curriculum_days`, `questions`, `exercises`;
- `learning_sessions`, `answer_attempts`, `exercise_attempts`, `test_runs`;
- `reviews`, `hint_usages`, `mistakes`, `mastery_scores`;
- `interview_sessions`, `flashcards`;
- `agent_conversations`, `agent_messages`;
- `provider_configurations`, `application_settings`.

Массивы целей, criteria, constraints и source metadata хранятся JSON text с Zod validation на границе repository. Событийные сущности и mastery остаются отдельными строками, потому что по ним нужны история и запросы. Миграции версионируются; seed идемпотентен по стабильным string id.

### ADR-004: dependency inversion для AI

`AgentProvider` не знает о HTTP и базе:

```ts
interface AgentProvider {
  readonly id: "mock" | "opencode" | "codex";
  getStatus(signal?: AbortSignal): Promise<ProviderStatus>;
  listModels(signal?: AbortSignal): Promise<AgentModel[]>;
  createSession(input: CreateAgentSessionInput): Promise<AgentSession>;
  streamMessage(input: StreamAgentMessageInput): AsyncIterable<AgentEvent>;
  cancelSession(sessionId: string): Promise<void>;
}
```

Adapters нормализуют delta, completed, tool start/completed, error и session completion. Raw provider events сохраняются только в диагностическом поле без секретов. Structured final responses проходят Zod validation; максимум одна repair-попытка, после чего ошибка сохраняется и показывается без падения процесса.

Провайдеры:

- **Mock** — всегда доступен, детерминированный streaming/error/review/interview сценарий.
- **OpenCode** — официальный `@opencode-ai/sdk`, подключение к loopback `opencode serve`; модели запрашиваются у server API. Endpoint и model per role настраиваются.
- **Codex** — узкий JSON-RPC adapter запускает локальный `codex app-server --listen stdio://`, использует account/model/thread/turn API и не отдаёт raw RPC наружу. Для Reviewer используется read-only sandbox и approval `never`. Если CLI/аутентификация/модель недоступны, status честно возвращает `unavailable`/`misconfigured`; mock продолжает работать.

В MVP orchestrator не запускает постоянно живущие внешние servers автоматически. Пользователь явно выбирает endpoint/режим; status endpoint проверяет доступность без раскрытия credentials.

### ADR-005: Reviewer технически read-only

Reviewer получает сериализованный brief, diff, выбранные source snippets, test result и hints — не writable workspace handle. В provider policy запрещены edit/write tools; Codex thread запускается с read-only sandbox. API не содержит route «apply review». OpenCode reviewer работает с injected context и deny-write permissions. Защита проверяется contract-тестом по provider input и поиском mutation methods.

### ADR-006: упражнения — доверенный локальный код с immutable baseline

Каждое упражнение автономно. При первом старте `exercise-core` создаёт внутри него отдельный private Git repository, baseline commit и marker `dev-learning-harness-baseline.json` в `.git`. Последующие diff строятся относительно записанного commit; tracked/staged changes получает Git с отключёнными external diff/textconv, а untracked files добавляются безопасным локальным renderer. Paths сначала проходят проверку относительно allowed root, `realpath` и symlink/junction/reparse checks.

Разрешённые операции представлены ID, а не строкой команды. Конкретный registry принадлежит orchestrator; определения фиксируют executable/args/timeout/output cap, например:

```text
exercise:test      -> npm exec vitest run
exercise:typecheck -> npm exec tsc -- --noEmit
workspace:install  -> npm ci
project:lint       -> npm run lint
project:build      -> npm run build
```

UI отправляет только operation ID и exercise ID. Сервер выбирает executable, фиксированные args, cwd и timeout. Kill отменяет дерево дочернего процесса. Allowlist предотвращает command injection, но не изолирует произвольный JavaScript: MVP запускает только доверенные bundled exercises. Настоящая граница для стороннего кода потребует контейнера/низкопривилегированного OS user.

Zed запускается отдельным allowlisted adapter: executable из локальной конфигурации, единственный аргумент — проверенный absolute exercise path, `shell: false`. При ошибке UI показывает и копирует путь.

### ADR-007: детерминированный mastery

LLM предлагает evidence, но не итоговый score. `learning-core` применяет фиксированные правила к dimensions `understanding`, `explanation`, `codeReading`, `implementation`, `debugging`, `interview`:

- базовое изменение зависит от evidence type и correctness;
- hint level уменьшает положительное изменение;
- повторная одинаковая ошибка добавляет penalty;
- score ограничен 0..5;
- давность снижает confidence и приоритетно выбирает review, но не стирает исторический score;
- mastery выше 4 требует минимум два разных evidence types в разные дни.

Алгоритм — чистые функции с table-driven unit tests.

## 3. Основные потоки

### Daily Session

1. `POST /api/learning/sessions` создаёт день и steps из curriculum.
2. Ответ сохраняется до вызова Teacher; UI не получает reference answer.
3. Teacher stream идёт по SSE, один вопрос за раз; hint usage пишется отдельно.
4. Exercise attempt фиксирует baseline, diff и test history.
5. Reviewer возвращает Zod-valid `ReviewResult`; пользователь исправляет сам.
6. `POST /complete` транзакционно пишет mastery evidence, mistakes и flashcard candidates.

### Agent stream

1. Server валидирует role/provider/model/message.
2. Prompt library собирает system prompt и минимальный role-specific context.
3. Provider event нормализуется и транслируется как SSE с monotonically increasing event id.
4. Completed assistant message и tool summaries сохраняются.
5. Disconnect/explicit cancel aborts provider turn and cleans child resources.

### Interview isolation

Question generation не получает reference answer. Оценочный turn создаётся отдельно после ответа и получает rubric/reference. Это исключает утечку подсказки из одного provider context.

## 4. Security model

- Orchestrator слушает `127.0.0.1`; CORS allowlist содержит только configured web origin.
- Все request bodies, DB JSON и provider structured outputs валидируются Zod.
- Secrets читаются только из environment; в SQLite хранятся endpoint, provider/model ids и non-secret flags.
- Logs структурированы и редактируют token/password/auth/header fields.
- Workspace roots canonicalized через `realpath`; traversal, absolute escape, UNC/network paths и symlink escape отклоняются.
- Process adapters не используют shell; stdout/stderr ограничены по размеру, есть timeout и graceful shutdown.
- SSE получает `Cache-Control: no-cache`, `X-Content-Type-Options: nosniff`; ошибки не содержат stack в production.
- Local single-user не означает trusted browser: state-changing routes проверяют Origin и content type.

## 5. Observability и errors

Каждый request/session/process имеет correlation id. Structured log содержит event, duration, status и redacted error. UI различает `connected`, `unavailable`, `misconfigured`, `starting`, `error`. Provider outage не влияет на DB, curriculum, exercise diff/test и exports.

## 6. Self-review спецификации

Проверено против ТЗ:

- offline/mock flow, streaming, cancellation и structured validation предусмотрены;
- Codex/OpenCode отделены контрактом; Pi отсутствует;
- Reviewer не имеет write/apply surface;
- browser не формирует команды и не видит secrets;
- exercise path, baseline, Git diff, test history и Zed fallback определены;
- curriculum, mastery, mistakes, interview, flashcards и exports имеют владельца;
- UI pages и состояния определены в `DESIGN.md`;
- миграции, seed, shutdown, logs и tests включены в план.

Открытые риски:

1. Provider SDK event schemas меняются быстрее business contract — изолировать mapping contract tests и pin exact versions.
2. Codex model discovery может быть недоступен в TypeScript SDK — показывать configured/current model и не выдумывать список.
3. Запуск JS-тестов не является sandbox — маркировать workspace trusted-only.
4. Windows process-tree cancellation отличается от POSIX — покрыть adapter tests и использовать platform-specific termination fallback.
5. Полный production-grade объём велик для первого MVP — acceptance flow приоритетнее расширенной authoring UI и сложной аналитики.
