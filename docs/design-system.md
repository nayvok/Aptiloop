# Design system

## Направление

Интерфейс — спокойный рабочий инструмент для взрослого разработчика, а не игровая копия Duolingo. Основной экран — guided path; в каждый момент видны положение, следующий доступный unit, объём и статус. Teacher/Reviewer появляются внутри учебного действия, Agent Playground вынесен в developer tools.

## Темы и tokens

`apps/web/app/globals.css` определяет semantic OKLCH tokens для light/dark:

- base: `background`, `foreground`, `card`, `popover`, `border`, `input`;
- actions: `primary`, `primary-hover`, `secondary`, `accent`, `destructive`;
- feedback: `success`, `warning`, `muted`;
- activity accents: `theory`, `practice`, `recall`, `interview`, `ai` и paired surfaces.

Primary/ring используют спокойный зелёный, а background/sidebar/border — холодную сине-серую нейтраль. Янтарный не является brand/primary: он остаётся семантическим warning и отдельным accent для recall. Activity colors не заменяют status colors.

Компоненты используют semantic Tailwind classes (`bg-card`, `text-muted-foreground`, `ring-ring`), а не локальные hex/палитры. Цвет activity дополняет label/icon/status и не остаётся единственным сигналом.

ThemeProvider хранит `system|light|dark` под key `theme`, включает `color-scheme` и отключает transition при смене темы. `prefers-reduced-motion` глобально сокращает animation/transition.

## Layout и навигация

- desktop: фиксированный sidebar 256 px и sticky header;
- mobile: доступная grid-навигация, content от 320 px;
- main content: `max-width: 1440px`, responsive padding;
- основной набор: Путь, Занятие, Практика, Карта знаний, Ошибки, Интервью, Карточки;
- Настройки и developer tools отделены от обучения.

Guided path использует statuses `completed`, `in_progress`, `available`, `locked` и отдельный список units. Cards применяются для самостоятельных смысловых блоков, а не как обёртка каждого текста.

## Каталог компонентов

### Textarea

`apps/web/components/ui/textarea.tsx` — ui-примитив для многострочного ввода.
Использует `data-slot="textarea"`, сохраняет стандартные focus/disabled states
и применяется в интервью-композитах как доступный composer с label.

### InterviewChatView

`apps/web/components/interview-chat-view.tsx` — составной чат-компонент
интервью. Сообщения рендерятся через `MessageScroller`/`Bubble`/`Message`, а
pending-вопрос и typing-indicator используют `role="status"` и `aria-live`
только для одного элемента за раз. Composer опирается на `Textarea`,
поддерживает Enter/Shift+Enter и не ломает существующие loading/error states.

### DayPlan

`apps/web/components/day-plan.tsx` — составной блок плана дня под шапкой
сессии. Использует `data-slot` для внутренних секций и уникальные лейблы
«План дня», «Темы», «Ожидаемые результаты», «Вне дня», «Юниты», чтобы тесты и
screen reader не путали соседние блоки. Содержимое остаётся семантическим,
сверху вниз читается как summary → outcomes → topics → units.

## Компонентные правила

- Минимальная высота интерактивной цели — 44 px (`min-h-11`).
- Button variants, inputs, badges, progress и skeletons используют общие primitives.
- Loading имеет `role=status`/`aria-busy`; error показывает понятный recovery action; empty state объясняет следующий шаг.
- Destructive publish/delete требуют явного подтверждения и поясняют необратимость.
- Published curriculum read-only visually and behaviorally; clone — отдельное действие.
- Длинные prompts/diff/test output используют перенос или scroll container, не расширяют layout.

## Accessibility

- skip-link ведёт к `#main-content`;
- landmarks и навигации имеют labels;
- текущая page/unit отмечается `aria-current`;
- focus-visible использует semantic ring и offset;
- icon-only buttons имеют `aria-label`, декоративные icons — `aria-hidden`;
- динамический Teacher/interview transcript использует polite live regions;
- progress имеет label/value text;
- формы связывают label/help/error через `aria-describedby` и `aria-invalid`;
- keyboard не зависит от hover и сохраняет видимый focus.

## Проверка изменения UI

1. Component tests для loading/empty/error/success и protected data.
2. Keyboard walkthrough path → session → practice → summary.
3. Light/dark/system screenshots без hydration warning.
4. Mobile width от 320 px и desktop 1440 px.
5. Reduced-motion emulation.
6. Проверка контраста текста, focus ring и status, не полагающегося только на цвет.
7. `npm run test --workspace=@dlh/web`, lint/typecheck и Playwright Day 1.
