# Dev Learning Harness: product specification v2

> **Historical snapshot — non-authoritative.** This file records an earlier **Implemented baseline** and is preserved for context only. Do not use it as the current product contract. See the [current documentation index](README.md).

Статус: implementation baseline  
Дата: 2026-07-31  
Baseline commit: `eeb0e3e`

## 1. Проверенный исходный уровень

Существующий MVP запускается, мигрирует и seed-ит SQLite, сохраняет сокращённую
сессию, строит настоящий Git diff, запускает allowlisted tests и умеет работать
с Mock, Codex и OpenCode adapters. На baseline прошли format, lint, typecheck,
160 fast tests и production build.

При этом текущий продукт не реализует заявленный учебный метод:

- модель построена вокруг Day, Question и Exercise, а не versioned Units;
- активная сессия имеет только состояния `questions` и `complete`;
- Briefing, Study, Quiz, Code Reading, Review correction и Summary отсутствуют;
- Teacher, diff, test output и review не восстанавливаются после reload;
- exercise review всегда Mock и не использует configured Reviewer;
- completion не проверяет prerequisites и записывает фиксированный mastery;
- seed может менять содержимое, которое отображается в старой сессии;
- существуют две локальные DB с разными сессиями из-за drift `.data/` и `data/`.

## 2. Product outcome

Первый обязательный результат: пользователь полностью проходит День 1 от
понятного briefing до summary, пишет код в Zed, получает read-only review,
самостоятельно исправляет решение и после полного restart продолжает с точного
следующего unit.

AI остаётся Teacher и Reviewer, но не выполняет учебную работу и не изменяет
workspace. Любой шаг, влияющий на прогресс, подтверждается persisted evidence и
детерминированным правилом, а не одним LLM-ответом.

## 3. Информационная архитектура

Основная навигация:

1. `/` - Путь, основная страница.
2. `/session` и `/sessions/:id` - Текущее занятие; route без ID разрешает
   `currentLearningSessionId`, а `?id=` задаёт явную сессию и показывает план
   дня внутри страницы.
3. `/exercise` - Практика текущей сессии.
4. `/knowledge` - Карта знаний.
5. `/mistakes` - Ошибки.
6. `/interview` - отдельный interview workflow; поддерживает `?sessionId=` и
   `?id=`.
7. `/flashcards` - кандидаты и export.
8. `/settings` - providers, theme, paths.
9. `/settings/curriculum` - curriculum editor.
10. `/settings/developer-tools` - Agent Playground и diagnostics.

Роли Teacher, Reviewer, Curator и Codex Expert контекстны и не являются
пунктами основной навигации.

## 4. Domain model

```text
Curriculum
  -> CurriculumVersion (draft | published | archived)
    -> Week
      -> Day
        -> Unit
          -> source/checklist/question/exercise payload

LearningSession
  -> immutable CurriculumSnapshot
  -> UnitProgress[]
  -> Answer/Quiz/CodeReading/Hint evidence
  -> AgentConversation/Message[]
  -> ExerciseAttempt/TestRun/Review[]
  -> Summary/Mastery/Mistake/Flashcard evidence
```

### CurriculumVersion

- `id`, `curriculumId`, `revision`, `parentVersionId`;
- `status`, `title`, `description`, `contentHash`;
- `createdAt`, `publishedAt`, `archivedAt`.

Draft редактируется. Publish валидирует весь graph, вычисляет content hash и
делает revision immutable. Редактирование published version создаёт новую draft
revision. Исторические entities не удаляются, только архивируются.

### Day

- стабильный `stableId`, versioned row ID, week/order;
- title, description, goal, estimatedMinutes;
- prerequisites, expectedOutcomes, depthLevel, outOfScope, topics.

### Unit

Типы: `briefing`, `study`, `recall`, `teacher-dialogue`, `quiz`,
`code-reading`, `exercise`, `review`, `interview`, `summary`, `checkpoint`,
`spaced-review`.

Unit хранит title, description, order, estimatedMinutes, objectives, checklist,
sources, questions, misconceptions, protected reference answer, completion
criteria, unlock rules, optional flag и depth. Exercise unit дополнительно
ссылается на exercise ID, acceptance criteria, constraints, template,
test-command ID, hint policy и review policy.

### Session snapshot

При старте сессии весь выбранный Day graph сериализуется через Zod, получает
schema version и content hash и сохраняется отдельно. Все экраны старой сессии
читают authored content из snapshot. Новая публикация не меняет старые ответы,
порядок, prompts, exercise policy или summary.

## 5. Unit progression

Состояния unit: `locked`, `ready`, `in_progress`, `completed`, `skipped`.

Инварианты:

- при старте первый required unit `ready`, остальные вычисляются из unlock rules;
- начать можно только `ready` unit;
- required unit нельзя пропустить;
- завершение проверяет type-specific completion criteria;
- завершение открывает ровно допустимые следующие units;
- Day завершается только после всех required units;
- одна global active LearningSession принадлежит learner state;
- повторный start активного Day возвращает ту же active session;
- повтор после completed создаёт новую session, не возвращает старую;
- прогресс, draft и checklist сохраняются после каждой mutation.

## 6. Day 1 vertical slice

Активная версия: «JavaScript, TypeScript и React: восстановление фундамента».

Порядок обязательных units Дня 1:

1. Briefing: цель, depth `interview-ready`, outcomes, scope/out-of-scope, sources.
2. Study: значения и примитивы.
3. Study: `null`, `undefined`, `typeof`, truthy/falsy.
4. Study: объекты, ссылки и мутации.
5. Study: equality, shallow/deep copy.
6. Recall: самостоятельное объяснение до любых подсказок.
7. Teacher Dialogue: один follow-up за ход, минимум одна revision попытка.
8. Quiz: минимум четыре вопроса, persisted attempts и score.
9. Code Reading: prediction, explanation и verbal fix.
10. Exercise: immutable update/unknown profile в отдельной attempt workspace.
11. Review: real diff + latest tests + read-only configured Reviewer.
12. Summary: mastery delta, misconceptions, cards и следующий unit.

Каждый экран показывает текущий unit, прогресс Day, оставшееся время,
completion criterion и один primary next action.

## 7. Teacher и reference policy

- first recall attempt записывается до вызова Teacher;
- reference answer отсутствует в generation/interview context;
- Teacher задаёт ровно один вопрос за ответ;
- dialogue transcript и provider/model сохраняются и восстанавливаются;
- cancel завершает только текущий turn, а новый turn создаёт пригодную provider
  session, если предыдущая cancelled/failed;
- reference открывается только по persisted attempt/hint policy;
- provider outage показывает причину и предлагает явный Mock fallback, не меняя
  настройку скрытно.

## 8. Practice and review

Каждый ExerciseAttempt получает test-owned/learner-owned copy исходного template,
а не редактирует bundled curriculum source. Baseline commit/hash хранится в DB;
diff сверяется с server-side baseline identity и canonical path при каждом вызове.

Browser отправляет только IDs. Orchestrator выбирает cwd/executable/args из
allowlist и запускает с `shell:false`, timeout, output cap, cleanup и минимальным
environment без provider secrets.

Review допускается только после non-empty diff и test run. Reviewer получает
brief, acceptance criteria, diff, tests и hints как сериализованный read-only
context. В API нет apply/patch route. При `changes_requested` следующий review
требует новый diff hash и новый test run. Completion требует accepted review и
passing required command, если exercise policy не определяет иначе.

## 9. Deterministic evidence

Mastery dimensions: understanding, explanation, codeReading, implementation,
debugging, interview; шкала 0-5.

`learning-core` применяет evidence с correctness, independence, hint level,
evidence type, recurrence и recency. LLM может вернуть observation, но итоговый
score вычисляет чистая функция. Summary транзакционно сохраняет evidence,
mistake occurrences и flashcard candidates. Повторная одинаковая ошибка
агрегируется между sessions, не только внутри одной.

Hints имеют уровни 0-5 и сохраняют reason, unit ID, question/exercise attempt и
time. Уровень 5 доступен только после completion/explicit give-up/review mode.

## 10. Interview

InterviewSession сохраняет setup (topics, depth, duration, count, format,
provider/model), transcript, current question и report. Во время интервью роль
нельзя переключить, reference скрыт, вопросы идут по одному, а UI работает как
чат без стриминга: новый вопрос появляется после сохранённого ответа, а typing
state показывается локально.

Интервью поддерживает два режима открытия:

- `?sessionId=<learningSessionId>` — вход из юнита дня, с кнопкой
  «Вернуться к занятию» и возвратом на `/session?id=<learningSessionId>`.
- `?id=<interviewId>` — прямое открытие сохранённого интервью/отчёта без
  localStorage, с чтением по `/api/interviews/v2/:id`.

Завершение создаёт детерминированные mastery/mistake/card evidence на основе
validated report. Когда интервью связано с unit дня, finish также сохраняет
progress юнита интервью: до завершения юнит показывает «Открыть интервью» или
«Открыть отчёт» + «Завершить юнит», а после успешного сохранения — «Юнит
завершён и сохранён». Для завершения юнита требуется reportId и минимум три
сохранённых ответа, поэтому день 7 проходит насквозь.

## 11. Curriculum editor MVP

Editor позволяет создавать draft version/week/day/unit, редактировать fields,
перемещать вверх/вниз, дублировать, preview, publish, archive и clone revision.
Publish блокируется на ошибках: duplicate stable IDs/order, missing required
source metadata, invalid unlock rule, missing exercise/command, empty completion
criteria или reference leakage.

## 12. Design specification

Register: product. Physical scene: разработчик работает 2-3 часа за широким
монитором рядом с Zed, часто вечером; интерфейс должен сохранять концентрацию и
ясно показывать один следующий шаг.

Design dials: variance 4, motion 3, density 6. Product UI использует знакомые
affordances, компактную типографику Geist и semantic tokens. Карточка применяется
только для самостоятельной сущности, вложенные карточки запрещены.

Color strategy: restrained cool neutrals + emerald primary. Light background
`#F6F8FB`, surface `#FFFFFF`, ink `#17202D`; dark background `#0E131B`, surface
`#151C26`, ink `#F2F5F9`. Primary корректируется вокруг `#24B86A`/`#43D98B` до
контраста AA. Activity colors: theory violet, practice blue, recall amber,
interview coral, AI cyan. Цвет всегда сопровождается icon/text/shape/status.

Theme modes light/dark/system применяются до hydration, сохраняются через
`next-themes` и синхронизируются с settings. Motion 160-200ms сообщает только
completion/unlock/loading; reduced motion отключает transform animation.

Learning Path строится как вертикальная нить с Day sections и различимыми Unit
nodes. Current node имеет `aria-current=step`, status text и единственный CTA.
Locked node объясняет prerequisite. Desktop использует path + sticky next-action
rail; mobile сворачивается в одну колонку без горизонтальной учебной навигации.

Accessibility: skip link, keyboard path, 44px primary touch targets, named
progress bars, field errors через `aria-describedby`, focused live region только
для статуса stream и WCAG 2.2 AA contrast во всех темах.

## 13. Data migration and backup

- `0000_initial.sql` остаётся неизменным; новые migrations append-only;
- canonical DB default: `.data/dev-learning-harness.sqlite`;
- `data/dev-learning-harness.sqlite` не удаляется и не сливается автоматически;
- preflight находит candidate DBs, проверяет integrity/FK и создаёт отдельные
  timestamped online backups;
- legacy Day graph backfill-ится в archived/published v1 без удаления старых rows;
- существующие sessions получают snapshot до любых authored updates;
- seed только insert-if-absent immutable version ID/hash.

## 14. Security invariants

- exact configured `WEB_ORIGIN`, loopback host и JSON content-type checks;
- browser mutations принимают operation/entity IDs, не executable/args/cwd;
- credentials и provider environment не попадают в browser, DB logs или exercise;
- all paths canonicalized относительно allowlisted root с reparse checks;
- Reviewer получает read-only context и provider deny-write/read-only policy;
- no Pi, embedded IDE/terminal, AnkiConnect, cloud auth or multi-user surface.

## 15. Specification self-review

Проверка против ТЗ выявила и закрыла на уровне design следующие прежние пробелы:

- определён минимальный Unit и полный Day 1 order;
- описаны immutable revisions, snapshots и data-retention invariants;
- route без ID имеет однозначное правило active-session recovery;
- every completion имеет server-side gate;
- Teacher/reference/hint policies не полагаются на UI;
- real Reviewer связан с diff/tests и correction cycle;
- mastery, mistakes и cards получают детерминированный источник evidence;
- editor создаёт новые недели без изменения истории;
- темы, accessibility и responsive states имеют проверяемые критерии;
- external provider success не заявляется без фактического generation smoke.

Открытые риски implementation:

1. Две существующие DB нельзя безопасно объединить автоматически; обе сохраняются,
   canonical runtime выбирается явно конфигурацией.
2. OpenCode/Codex schemas зависят от установленных версий; adapters остаются
   изолированы contract tests.
3. Запуск trusted exercise JavaScript не является sandbox и остаётся явно
   документированным ограничением.
4. Полный editor и interview идут после доказанного Day 1, чтобы не задерживать
   usable vertical slice.
