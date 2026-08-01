# Dev Learning Harness Design System

## Intent

Физическая сцена: разработчик поздним вечером возвращает навык за широким монитором, рядом открыт Zed; интерфейс должен давать ясный маршрут и снижать усталость, а не соревноваться с кодом за внимание.

Стратегия цвета — restrained. Спокойный зелёный используется для primary action и текущего шага, а холодный сине-серый задаёт нейтральные поверхности. Отдельные activity accents помогают различать типы учебной работы; success, warning и destructive остаются функциональными семантическими цветами.

## Foundations

### Color tokens

Все цвета задаются в OKLCH и маппятся на semantic shadcn tokens. Полное актуальное определение находится в `apps/web/app/globals.css`; ниже зафиксированы опорные identity tokens.

```css
:root {
  --background: oklch(0.977 0.006 255);
  --foreground: oklch(0.25 0.025 255);
  --card: oklch(1 0 0);
  --primary: oklch(0.49 0.14 151);
  --primary-hover: oklch(0.44 0.13 151);
  --primary-foreground: oklch(0.99 0 0);
  --secondary: oklch(0.94 0.012 255);
  --accent: oklch(0.93 0.025 151);
  --success: oklch(0.86 0.065 151);
  --warning: oklch(0.9 0.075 78);
  --border: oklch(0.88 0.015 255);
  --ring: oklch(0.49 0.14 151);
  --activity-practice: oklch(0.47 0.15 250);
  --activity-recall: oklch(0.43 0.105 76);
}

.dark {
  --background: oklch(0.19 0.018 255);
  --foreground: oklch(0.97 0.006 255);
  --card: oklch(0.23 0.022 255);
  --primary: oklch(0.77 0.14 151);
  --primary-hover: oklch(0.82 0.13 151);
  --primary-foreground: oklch(0.19 0.018 255);
  --secondary: oklch(0.28 0.022 255);
  --accent: oklch(0.31 0.045 151);
  --success: oklch(0.32 0.065 151);
  --warning: oklch(0.34 0.07 78);
  --border: oklch(0.34 0.025 255);
  --ring: oklch(0.77 0.14 151);
  --activity-practice: oklch(0.76 0.12 250);
  --activity-recall: oklch(0.82 0.115 76);
}
```

### Typography

- UI и prose: Geist Sans, system-ui fallback.
- Код, paths, model IDs и metrics: Geist Mono.
- Базовый размер 14px; body 14–16px; page title 24–28px; без fluid display type.
- Длинные объяснения ограничены `70ch`; таблицы и diff используют доступную ширину.

### Shape and spacing

- Стиль shadcn: Nova — компактный product UI.
- Радиус controls 8px, panels 12px, pills только для status/tag.
- Шаг сетки 4px; типовые gaps 8/12/16/24px.
- Sidebar 256px desktop, collapsible rail 72px; main content max 1440px.
- Карта используется только для самостоятельной сущности; вложенные карточки запрещены.

## Layout

- Desktop shell: sidebar + sticky top bar + content.
- Top bar показывает breadcrumb, текущий этап занятия и provider health.
- Dashboard строится как editorial overview: крупный блок сегодняшнего занятия, компактная полоса недели и две списковые колонки, а не сетка одинаковых KPI-карт.
- Daily Session: step rail сверху, основная задача слева, supporting context справа; на узких экранах одна колонка.
- Agent Chat: role tabs, transcript, collapsible tool events, sticky composer; provider/model рядом с ролью.
- Exercise: условие и действия сверху, diff/test/review ниже через tabs; путь всегда копируемый.

## Components

Основа — официальные shadcn primitives: Button, Badge, Progress, Tabs, Breadcrumb, Tooltip, DropdownMenu, Select, Dialog, Sheet, Skeleton, Alert, Input, Textarea, Separator и ScrollArea. Product compositions получают `data-slot`, используют semantic tokens и принимают `className` через `cn()`.

Каждый interactive component имеет default, hover, focus-visible, active, disabled и loading. Empty state объясняет, что сделать дальше. Ошибка остаётся рядом с источником; toast используется только для кратких подтверждений.

## Motion

- 160–200ms, ease-out; только смена состояния, раскрытие tool event, skeleton-to-content и sidebar collapse.
- Никаких page-load choreography.
- `prefers-reduced-motion: reduce` отключает transform/scroll animation.

## Content voice

Короткие конкретные русские формулировки. Не «AI думает», а «OpenCode · model-name отвечает». Не «Вы ошиблись», а «Ответ не объясняет, почему TDZ существует». Primary CTA описывает следующий шаг: «Начать повторение», «Сохранить ответ», «Запустить проверку».
