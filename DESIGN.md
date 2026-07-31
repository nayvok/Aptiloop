# Dev Learning Harness Design System

## Intent

Физическая сцена: разработчик поздним вечером возвращает навык за широким монитором, рядом открыт Zed; интерфейс должен давать ясный маршрут и снижать усталость, а не соревноваться с кодом за внимание.

Стратегия цвета — restrained. Янтарный seed используется только для primary action, текущего шага и небольших акцентов. Остальная поверхность нейтральна; success, warning и destructive — функциональные семантические цвета.

## Foundations

### Color tokens

Все цвета задаются в OKLCH и маппятся на semantic shadcn tokens.

```css
:root {
  --background: oklch(1 0 0);
  --foreground: oklch(0.18 0.01 60);
  --card: oklch(0.985 0.003 60);
  --card-foreground: oklch(0.18 0.01 60);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.18 0.01 60);
  --primary: oklch(0.58 0.15 55);
  --primary-foreground: oklch(0.99 0 0);
  --secondary: oklch(0.955 0.008 60);
  --secondary-foreground: oklch(0.27 0.02 60);
  --muted: oklch(0.96 0.006 60);
  --muted-foreground: oklch(0.46 0.015 60);
  --accent: oklch(0.94 0.025 60);
  --accent-foreground: oklch(0.3 0.06 55);
  --destructive: oklch(0.55 0.2 27);
  --destructive-foreground: oklch(0.99 0 0);
  --success: oklch(0.52 0.13 155);
  --warning: oklch(0.67 0.14 78);
  --border: oklch(0.9 0.008 60);
  --input: oklch(0.9 0.008 60);
  --ring: oklch(0.58 0.15 55);
}

.dark {
  --background: oklch(0.13 0 0);
  --foreground: oklch(0.94 0.006 60);
  --card: oklch(0.17 0.006 60);
  --card-foreground: oklch(0.94 0.006 60);
  --popover: oklch(0.17 0.006 60);
  --popover-foreground: oklch(0.94 0.006 60);
  --primary: oklch(0.7 0.13 60);
  --primary-foreground: oklch(0.13 0 0);
  --secondary: oklch(0.22 0.008 60);
  --secondary-foreground: oklch(0.9 0.006 60);
  --muted: oklch(0.21 0.006 60);
  --muted-foreground: oklch(0.7 0.01 60);
  --accent: oklch(0.25 0.025 60);
  --accent-foreground: oklch(0.88 0.07 60);
  --destructive: oklch(0.66 0.18 27);
  --destructive-foreground: oklch(0.13 0 0);
  --success: oklch(0.68 0.12 155);
  --warning: oklch(0.77 0.12 78);
  --border: oklch(0.27 0.008 60);
  --input: oklch(0.27 0.008 60);
  --ring: oklch(0.7 0.13 60);
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
