# Implementation plan: Guided Learning UX

Дата: 2026-08-02

Вертикальные срезы; после каждого этапа — релевантные тесты и commit. Backend меняется только при необходимости небольшого API/DTO; security/curriculum/session/exercise не трогаются.

## Stage 0. Foundations

- `apps/web/lib/learning-blocks.ts`: grouping units → 3 блока (study/check/practice), статусы блоков, прогресс, время.
- `apps/web/lib/learner-labels.ts` + `lib/unit-labels.ts`: learner-терминология, depth labels, activity meta (иконка/цвет/label).
- `apps/web/lib/time.ts`: форматирование минут («около 2 ч 48 мин», «18 мин»).
- `apps/web/app/globals.css`: новые activity-токены (study/teacher/quiz/code-reading/practice/review/summary), старые оставить как алиасы.
- `components/ui/sheet.tsx`, `components/ui/popover.tsx` (radix-ui).
- Component tests для блоков/времени/лейблов.

✅ Выполнено. Commit: `feat(web): add learning blocks and learner labels`.

## Stage 1. Path

Переписать `dashboard-client.tsx`: «Сегодня» (hero + один CTA), «Текущий день» (3 блока), drawer с подробным планом дня, «Путь недели» (компактные карточки). Обновить `test/path-v2.test.tsx`, добавить тесты «today card», «blocks», «drawer».

✅ Выполнено. Commit: `refactor: simplify learning path`.

## Stage 2. Session

`session-client.tsx`: sticky progress header (день/блок/шаг/время/«План дня»), активный unit в центре, план в drawer, упрощённый Briefing, transition screen между блоками, «Продолжить позже». Обновить `test/session-v2.test.tsx`.

✅ Выполнено (включая source cards). Commits: `refactor: focus session on active unit`,
`fix(web): show block transition only at the first step of a block`.

## Stage 3. Study sources

Карточки источников с типом/временем/целью, честное пустое состояние, checklist. Tests.

✅ Выполнено в составе Stage 2 (source cards + честное пустое состояние).

## Stage 4. Language и AI status

Применить learner-терминологию на learner-экранах (Path/Session/Interview), компактный `ProviderHealth` с popover, убрать «Версия N» с Path. Tests.

✅ Выполнено. Commits: `refactor: simplify learner terminology`,
`fix(web): base compact AI status on configured roles`.

## Stage 5. Interview

Setup со scoping «Только изученные» (клиентский расчёт из `/learning/path`), Markdown/code rendering (react-markdown + remark-gfm), честная дисклеймер-строка в отчёте. Tests.

✅ Выполнено (Markdown-рендер, scope «Только изученные» по умолчанию, честный отчёт).
Commit: `refactor: improve interview workflow`.

## Stage 6. Settings и Curriculum Editor

Settings: группировка (Основные / AI для обучения / Подключения / Для разработчика), профили «Экономный/Сбалансированный/Максимальная точность», понятные роли. Editor: «Текущая программа» + свёрнутая «История версий» + «Добавить следующую неделю». Tests.

✅ Выполнено (секции settings, профили, «Текущая программа» + «История версий» + «Добавить следующую неделю»).
Commit: `refactor: reorganize settings and curriculum editor`.

## Stage 7. Polish и acceptance

- Alignment/responsive/a11y/empty states.
- Скриншоты Path/Session/Interview/Settings/Editor (light/dark).
- Полный gate: format, lint, typecheck, test:fast, test:e2e, build.
- Обновить `docs/acceptance-audit.md` и DESIGN.md при изменении визуальной системы.

✅ Выполнено. Скриншоты в `docs/screenshots/`, gate: format/lint/typecheck/test:fast/build/E2E — все зелёные.

## Ограничения

- «Длительность учебного дня» в Settings не добавляется: backend settings schema фиксирована, изменение — вне малого API/DTO.
- «Формат интервью (теория/сценарии/смешанный)» не добавляется в MVP-срез: backend setup strict; фиксируется в известных ограничениях.
- AI-генерация черновика недели в Editor остаётся за пределами среза (нет authoring endpoint); сценарий «Добавить следующую неделю» реализуется ручными шагами.
