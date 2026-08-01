# Чат-интервью, план дня, связка интервью с днём, аудит внешних ограничений — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Превратить интервью в чат, показать план дня в сессии, связать завершённое интервью с юнитом дня (чинит непроходимый день 7) и закрыть/честно зафиксировать проверки внешних провайдеров и Zed.

**Architecture:** Три независимых клиентских/серверных блока плюс аудит. Web: новый `InterviewChatView` поверх существующих `MessageScroller`/`Bubble`/`Message` и существующих эндпоинтов интервью (без SSE); новый `DayPlan` и обогащённый рейл с общим модулем лейблов. Оркестратор: при finish интервью upsert-ит progress юнита интервью; критерий `attempts` для интервью считает ответы из БД. Аудит: `npm audit fix` только для dev-зависимости, реальные provider turns и Zed GUI с честной фиксацией результатов.

**Tech Stack:** Next.js 16 (App Router), TanStack Query, shadcn-примитивы через `radix-ui`, Hono, `node:sqlite`, Zod strict, Vitest, Playwright, Turbo workspaces.

## Global Constraints

- Без новых npm-зависимостей; все Radix-примитивы доступны через установленный `radix-ui`.
- `agent-chat` не менять. Серверный контракт интервью не менять (эндпоинты, запросы, ответы).
- SSE-стриминг вопросов в этой итерации не делать.
- TypeScript strict; внешние данные валидировать Zod на границе (`rejectProtectedFields` + strict схемы).
- Браузер не шлёт executable/args/cwd; operationId-идемпотентность сохраняется во всех мутациях.
- Рейл юнитов не делать кликабельным; `data-slot="unit-step"` и `aria-current` сохраняются.
- Уникальные лейблы плана дня: «План дня», «Темы», «Ожидаемые результаты», «Вне дня», «Юниты»; не использовать «Что нужно сделать» и «Начать юнит».
- Тестовые якоря интервью сохраняются: «Начать интервью», «Темы через запятую», «Количество вопросов», «Отправить ответ», «Завершить и открыть отчёт», «N / M», «Отчёт по интервью», «100%», `role=alert`. Новый лейбл композера — «Сообщение» (заменяет «Текст ответа» в тестах).
- В любой момент рендерится не более одного элемента `role="status"` в чате интервью.
- `npm audit fix` только без `--force`; next/postcss/sharp не трогать (registry-ограничение, авто-fix = ошибочный downgrade до 9.3.3); `--force`/overrides запрещены.
- Provider smoke успешен только при реальном terminal-событии и сохранении после reload; иначе писать «не проверено» + blocker.
- Секреты (в т.ч. `OPENCODE_SERVER_PASSWORD`) — только из environment, не логировать.

---

## Файловая структура

- Create: `apps/web/lib/unit-labels.ts` — общие `unitTypeLabels`/`unitStatusLabels`.
- Create: `apps/web/components/ui/textarea.tsx` — shadcn-обёртка `Textarea`.
- Create: `apps/web/components/interview-chat-view.tsx` — `InterviewChatView`.
- Create: `apps/web/components/day-plan.tsx` — `DayPlan`.
- Modify: `apps/web/components/interview-client.tsx` — интеграция чата, `?sessionId=`, `?id=`.
- Modify: `apps/web/components/session-client.tsx` — `DayPlan` под шапкой, обогащённый `UnitStepList`, состояния `InterviewUnit`.
- Modify: `apps/web/components/dashboard-client.tsx` — импорт лейблов из `lib/unit-labels.ts`.
- Modify: `apps/orchestrator/src/interview-v2.ts` — upsert прогресса юнита при finish.
- Modify: `apps/orchestrator/src/learning-v2.ts` — критерий интервью по ответам из БД.
- Modify: `apps/web/test/interview-v2.test.tsx`, `apps/web/test/session-v2.test.tsx`, `apps/web/test/path-v2.test.tsx` (по необходимости), `apps/web/e2e/daily-flow.spec.ts`.
- Modify/Add: `apps/orchestrator/test/interview-v2.integration.test.ts`, `apps/orchestrator/test/learning-v2.integration.test.ts`.
- Modify: `docs/acceptance-audit.md`, `docs/troubleshooting.md`, `docs/product-specification-v2.md`, `docs/design-system.md`.

## Межблочные контракты (Interfaces)

- `lib/unit-labels.ts` экспортирует:
  - `unitTypeLabels: Record<UnitType, string>` (UnitType = `"briefing" | "study" | "recall" | "teacher-dialogue" | "quiz" | "code-reading" | "exercise" | "review" | "interview" | "summary" | "checkpoint" | "spaced-review"`; значения из текущего `dashboard-client.tsx`).
  - `unitStatusLabels: Record<UnitStatus, string>` (status = `"locked" | "ready" | "in_progress" | "completed" | "skipped"`).
  - Тип `UnitTypeLabel = keyof typeof unitTypeLabels`.
- `components/ui/textarea.tsx` экспортирует `Textarea` (forwardRef, `React.ComponentProps<"textarea">`, классы как у `input` в `interview-client.tsx` — `min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60`).
- `components/interview-chat-view.tsx` экспортирует `InterviewChatView` с props:
  ```ts
  interface InterviewChatViewProps {
    interview: Interview; // z.infer<typeof interviewSchema> — экспортировать тип из interview-client.tsx
    action: "start" | "answer" | "finish" | null;
    actionError: string | null;
    answer: string;
    onAnswerChange(value: string): void;
    onSend(): void;
    onRetry(): void;
    onFinish(): void;
  }
  ```
- `components/day-plan.tsx` экспортирует `DayPlan({ session }: { session: LearnerSession })` — тип `LearnerSession` экспортировать из `session-client.tsx`.
- Сервер: `interview-v2.ts` при finish вызывает `upsertInterviewUnitProgress(state, learningSessionId, interviewId)` внутри той же транзакции; `learning-v2.ts` добавляет `countCompletedInterviewAnswers(connection, interviewSessionId): number`.

---

### Task 1: Общий модуль лейблов юнитов

**Files:**
- Create: `apps/web/lib/unit-labels.ts`
- Modify: `apps/web/components/dashboard-client.tsx` (удалить локальные `unitTypeLabels`/`unitStatusLabels`, импортировать из lib)
- Test: существующие `apps/web/test/path-v2.test.tsx` (регрессия)

- [ ] **Step 1: Создать `apps/web/lib/unit-labels.ts`**

```ts
export type UnitType =
  | "briefing" | "study" | "recall" | "teacher-dialogue" | "quiz"
  | "code-reading" | "exercise" | "review" | "interview" | "summary"
  | "checkpoint" | "spaced-review";

export type UnitStatus =
  | "locked" | "ready" | "in_progress" | "completed" | "skipped";

export const unitTypeLabels: Record<UnitType, string> = {
  briefing: "Брифинг",
  study: "Изучение",
  recall: "Воспроизведение",
  "teacher-dialogue": "Диалог с Teacher",
  quiz: "Квиз",
  "code-reading": "Чтение кода",
  exercise: "Упражнение",
  review: "Review",
  interview: "Интервью",
  summary: "Итоги",
  checkpoint: "Контрольная точка",
  "spaced-review": "Интервальное повторение",
};

export const unitStatusLabels: Record<UnitStatus, string> = {
  locked: "Заблокировано",
  ready: "Доступно",
  in_progress: "Сейчас",
  completed: "Готово",
  skipped: "Пропущено",
};
```

- [ ] **Step 2: Обновить `dashboard-client.tsx`** — удалить локальные `unitTypeLabels` и `unitStatusLabels` (строки ~139–157), добавить `import { unitTypeLabels, unitStatusLabels } from "@/lib/unit-labels";`. Проверить, что типы `LearnerUnit["type"]`/`["status"]` совместимы (строка `{unitTypeLabels[unit.type]}` и `unitStatusLabels[unit.status]` остаются без изменений).
- [ ] **Step 3: Проверить**

```powershell
npm run typecheck --workspace=@dlh/web
npm run test --workspace=@dlh/web -- path-v2.test.tsx
```

Ожидается: typecheck чистый, path-v2 тесты зелёные.

- [ ] **Step 4: Commit** `git add apps/web/lib/unit-labels.ts apps/web/components/dashboard-client.tsx && git commit -m "refactor(web): extract shared unit label maps"`

### Task 2: UI-компонент Textarea

**Files:**
- Create: `apps/web/components/ui/textarea.tsx`
- Test: покрытие через `apps/web/test/ui-foundation.test.tsx` (добавить кейс) и компонентные тесты чата (Task 3)

- [ ] **Step 1: Создать `apps/web/components/ui/textarea.tsx`**

```tsx
"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
```

- [ ] **Step 2: Добавить кейс в `ui-foundation.test.tsx`** — рендер `Textarea` с label «Сообщение», проверка `data-slot="textarea"`, disabled-состояния (по образцу соседних кейсов ui-примитивов в этом файле).
- [ ] **Step 3: Проверить** `npm run test --workspace=@dlh/web -- ui-foundation.test.tsx` — зелёный; `npm run typecheck --workspace=@dlh/web` — чистый.
- [ ] **Step 4: Commit** `git add apps/web/components/ui/textarea.tsx apps/web/test/ui-foundation.test.tsx && git commit -m "feat(web): add shadcn-style Textarea primitive"`

### Task 3: InterviewChatView и интеграция в InterviewClient

**Files:**
- Create: `apps/web/components/interview-chat-view.tsx`
- Modify: `apps/web/components/interview-client.tsx` (экспортировать тип `Interview`, заменить секцию «Transcript/Ответ/Все вопросы отвечены» на `InterviewChatView`)
- Modify: `apps/web/test/interview-v2.test.tsx` (лейбл «Текст ответа» → «Сообщение», новые кейсы чата)

- [ ] **Step 1: Написать падающие тесты чата** — в `apps/web/test/interview-v2.test.tsx` заменить `getByLabelText("Текст ответа")` на `getByLabelText("Сообщение")` и добавить кейсы:

```tsx
it("renders chat bubbles, typing state and a single live pending question", async () => {
  apiMock
    .mockResolvedValueOnce({ interview: interviewFixture() })
    .mockResolvedValueOnce(
      interviewFixture({ transcript: transcriptWithFirstAnswer() }),
    );
  renderWithQuery(<InterviewClient />);

  expect(
    await screen.findByText(/Чем lexical scope отличается/u),
  ).toBeInTheDocument();
  expect(screen.getByText("Интервьюер")).toBeInTheDocument();
  expect(screen.getByText("Вы")).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent(
    "Чем lexical scope отличается от dynamic scope?",
  );
  expect(screen.getAllByRole("status")).toHaveLength(1);

  fireEvent.change(screen.getByLabelText("Сообщение"), {
    target: { value: "Lexical scope определяется местом объявления функции." },
  });
  fireEvent.click(screen.getByRole("button", { name: "Отправить ответ" }));
  expect(
    await screen.findByText("Интервьюер печатает…"),
  ).toBeInTheDocument();
  expect(await screen.findByText(/Как TypeScript narrowing/u)).toBeInTheDocument();
  expect(screen.queryByText("Интервьюер печатает…")).not.toBeInTheDocument();
  expect(screen.getAllByRole("status")).toHaveLength(1);
  expect(screen.getByRole("status")).toHaveTextContent(
    "Как TypeScript narrowing меняет доступный тип?",
  );
});

it("sends with Enter and keeps Shift+Enter as a newline", async () => {
  apiMock.mockResolvedValueOnce({ interview: interviewFixture() });
  renderWithQuery(<InterviewClient />);
  const composer = await screen.findByLabelText("Сообщение");
  fireEvent.keyDown(composer, { key: "Enter", shiftKey: true });
  expect(apiMock).not.toHaveBeenCalledWith(
    "/interviews/v2/interview-1/answers",
    expect.anything(),
  );
  fireEvent.keyDown(composer, { key: "Enter" });
  expect(apiMock).toHaveBeenCalledWith(
    "/interviews/v2/interview-1/answers",
    expect.objectContaining({ method: "POST" }),
  );
});
```

Дополнительные кейсы (реализовать по той же схеме): recoverable-answer показывает кнопку «Повторить запрос» и `role=alert` с «Ответ сохранён в форме»; в кейсе «keeps the answer and operation id» лейбл композера «Сообщение»; прогресс «N / M» виден в шапке чата; при `readyToFinish` кнопка «Завершить и открыть отчёт»; protected-поля отклоняются до рендера (существующий кейс остаётся).

- [ ] **Step 2: Прогнать тесты — убедиться, что падают** (компонент ещё не создан).
- [ ] **Step 3: Создать `apps/web/components/interview-chat-view.tsx`**

```tsx
"use client";

import {
  ArrowClockwiseIcon,
  CheckCircleIcon,
  PaperPlaneTiltIcon,
} from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Bubble,
  BubbleContent,
  Message,
  MessageContent,
  MessageHeader,
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import type { Interview } from "@/components/interview-client";

export interface InterviewChatViewProps {
  interview: Interview;
  action: "start" | "answer" | "finish" | null;
  actionError: string | null;
  answer: string;
  onAnswerChange(value: string): void;
  onSend(): void;
  onRetry(): void;
  onFinish(): void;
}

export function InterviewChatView({
  interview,
  action,
  actionError,
  answer,
  onAnswerChange,
  onSend,
  onRetry,
  onFinish,
}: InterviewChatViewProps) {
  const hasPendingQuestion =
    interview.progress.questionsAsked ===
    interview.progress.questionsAnswered + 1;
  const pendingQuestionId = hasPendingQuestion
    ? interview.transcript.findLast((message) => message.role === "assistant")
        ?.id
    : undefined;
  const waitingForQuestion = action === "answer";
  const ready = interview.progress.readyToFinish;

  return (
    <div className="flex min-h-[32rem] flex-col overflow-hidden rounded-lg border border-border bg-card">
      <MessageScrollerProvider>
        <MessageScroller className="flex-1">
          <MessageScrollerViewport className="p-4 md:p-6">
            <MessageScrollerContent>
              {interview.transcript.map((message, index) => {
                const assistant = message.role === "assistant";
                const live =
                  assistant &&
                  message.id === pendingQuestionId &&
                  !waitingForQuestion;
                return (
                  <MessageScrollerItem
                    key={message.id}
                    scrollAnchor={index === interview.transcript.length - 1}
                  >
                    <Message align={assistant ? "start" : "end"}>
                      <MessageContent>
                        <MessageHeader>
                          {assistant ? "Интервьюер" : "Вы"}
                        </MessageHeader>
                        <Bubble
                          align={assistant ? "start" : "end"}
                          variant={assistant ? "muted" : "default"}
                        >
                          <BubbleContent
                            role={live ? "status" : undefined}
                            aria-live={live ? "polite" : undefined}
                            aria-atomic={live ? "true" : undefined}
                          >
                            {message.content}
                          </BubbleContent>
                        </Bubble>
                      </MessageContent>
                    </Message>
                  </MessageScrollerItem>
                );
              })}
              {waitingForQuestion ? (
                <MessageScrollerItem>
                  <Message align="start">
                    <MessageContent>
                      <MessageHeader>Интервьюер</MessageHeader>
                      <Bubble align="start" variant="muted">
                        <BubbleContent
                          role="status"
                          aria-live="polite"
                          aria-atomic="true"
                        >
                          <span className="inline-flex items-center gap-2">
                            <span
                              aria-hidden
                              className="size-2 animate-pulse rounded-full bg-primary"
                            />
                            Интервьюер печатает…
                          </span>
                        </BubbleContent>
                      </Bubble>
                    </MessageContent>
                  </Message>
                </MessageScrollerItem>
              ) : null}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton />
        </MessageScroller>
      </MessageScrollerProvider>

      <div className="border-t border-border p-3 md:p-4">
        {actionError ? (
          <p role="alert" className="mb-3 text-sm text-destructive">
            {actionError}
          </p>
        ) : null}
        {ready ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm leading-6 text-muted-foreground">
              Сервер сформирует честный отчёт по сохранённому transcript.
              Техническая корректность без review не будет считаться
              доказанной.
            </p>
            <div className="flex justify-end">
              <Button
                onClick={onFinish}
                disabled={action !== null}
              >
                {action === "finish" ? (
                  <>
                    <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    Формирую отчёт…
                  </>
                ) : (
                  <>
                    <CheckCircleIcon aria-hidden className="size-4" />
                    Завершить и открыть отчёт
                  </>
                )}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-end gap-2">
            <label htmlFor="interview-message" className="sr-only">
              Сообщение
            </label>
            <Textarea
              id="interview-message"
              rows={3}
              value={answer}
              maxLength={20_000}
              disabled={action !== null}
              onChange={(event) => onAnswerChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  if (answer.trim()) onSend();
                }
              }}
              className="max-h-40 min-h-12 flex-1 resize-none"
              placeholder="Напиши ответ на вопрос интервьюера…"
            />
            {hasPendingQuestion && !waitingForQuestion ? (
              <Button
                onClick={onSend}
                disabled={!answer.trim() || action !== null}
                aria-label="Отправить ответ"
              >
                <PaperPlaneTiltIcon aria-hidden className="size-4" />
              </Button>
            ) : (
              <Button
                variant="outline"
                onClick={onRetry}
                disabled={action !== null}
                aria-label="Повторить запрос"
              >
                <ArrowClockwiseIcon aria-hidden className="size-4" />
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
```

Примечания:
- `MessageScroller`/`Message`/`Bubble` импортируются из существующих ui-модулей (в `message-scroller.tsx` переэкспортируются примитивы, `message.tsx` — `Message*`, `bubble.tsx` — `Bubble*`; в `agent-chat.tsx` единый импорт уже работает).
- «Отправить ответ» и «Повторить запрос» — `aria-label` на кнопке; видимый текст внутри кнопки не обязателен, но для e2e-якоря «Отправить ответ» тесты используют `getByRole("button", { name: "Отправить ответ" })`, который матчит aria-label.

- [ ] **Step 4: Интегрировать в `interview-client.tsx`**
  - Экспортировать тип: `export type Interview = z.infer<typeof interviewSchema>;`.
  - В ветке `interview.status === "in_progress"` (и setup-retry не трогаем) заменить секции «Transcript», «Ответ» и «Все вопросы отвечены» одним рендером:

```tsx
return (
  <div data-slot="interview-session" className="flex flex-col gap-6">
    <PageHeader
      title="Техническое интервью"
      description="Отвечай на текущий вопрос. Transcript и прогресс сохраняются сервером после каждого шага."
      actions={
        <Badge variant="outline">
          {interview.progress.questionsAnswered} /{" "}
          {interview.setup.questionCount}
        </Badge>
      }
    />
    <InterviewChatView
      interview={interview}
      action={action}
      actionError={actionError}
      answer={answer}
      onAnswerChange={setAnswer}
      onSend={() => void submitAnswer()}
      onRetry={() => void submitAnswer()}
      onFinish={() => void finishInterview()}
    />
  </div>
);
```

  - `submitAnswer` менять не нужно (логика operationId/localStorage/ошибки сохраняется). `setActionError` для recoverable-кейса остаётся «… Ответ сохранён в форме — можно повторить запрос.».
  - Удалить неиспользуемые импорты (`Progress`, `Skeleton` оставить для loading).

- [ ] **Step 5: Обновить e2e-селекторы интервью** (см. Task 8, но лейбл поменять уже здесь): в `apps/web/e2e/daily-flow.spec.ts` `getByLabel("Текст ответа")` → `getByLabel("Сообщение")`; `getByRole("button", { name: "Отправить ответ" })` остаётся.
- [ ] **Step 6: Прогнать** `npm run test --workspace=@dlh/web -- interview-v2.test.tsx` и `npm run typecheck --workspace=@dlh/web` — зелёные.
- [ ] **Step 7: Commit** `git add apps/web/components/interview-chat-view.tsx apps/web/components/interview-client.tsx apps/web/test/interview-v2.test.tsx apps/web/e2e/daily-flow.spec.ts && git commit -m "feat(web): render interview as a chat without streaming"`

### Task 4: План дня и обогащённый рейл юнитов

**Files:**
- Create: `apps/web/components/day-plan.tsx`
- Modify: `apps/web/components/session-client.tsx` (DayPlan под шапкой; `UnitStepList` с типом/минутами/статусом; экспортировать тип `LearnerSession`)
- Modify: `apps/web/test/session-v2.test.tsx` (новые кейсы)

- [ ] **Step 1: Написать падающие тесты** в `apps/web/test/session-v2.test.tsx` (по образцу существующих кейсов этого файла; фикстура сессии уже содержит `snapshot.day.goal/topics/expectedOutcomes/outOfScope` и `units`):

```tsx
it("shows the collapsible day plan with unique labels above the rail", async () => {
  // рендер SessionClient с фикстурой активной сессии
  const plan = await screen.findByText("План дня");
  expect(plan).toBeVisible();
  expect(screen.getByText("Темы")).toBeInTheDocument();
  expect(screen.getByText("Ожидаемые результаты")).toBeInTheDocument();
  expect(screen.getByText("Вне дня")).toBeInTheDocument();
  expect(screen.getByText("Юниты")).toBeInTheDocument();
  // цели дня и юниты с русским типом/минутами
  expect(screen.getByText(/Цель дня из фикстуры/u)).toBeInTheDocument();
  expect(screen.getByText("Брифинг · 6 мин")).toBeInTheDocument();
  // не дублируем якоря unit-оболочки
  expect(screen.getAllByText("Что нужно сделать")).toHaveLength(1);
});

it("enriches the unit rail with Russian type, minutes and status", async () => {
  const steps = document.querySelectorAll('[data-slot="unit-step"]');
  expect(steps[0]).toHaveTextContent("Брифинг");
  expect(steps[0]).toHaveTextContent("6 мин");
  expect(steps[0]).toHaveTextContent("Доступно");
});
```

Уточнение по тестам: в существующем файле сессионные фикстуры строятся через `sessionFixture(...)`; новые кейсы используют её и проверяют лейблы из `unitTypeLabels`/`unitStatusLabels` для типов фикстуры.

- [ ] **Step 2: Прогнать — убедиться, что падают.**
- [ ] **Step 3: Создать `apps/web/components/day-plan.tsx`**

```tsx
"use client";

import { useState } from "react";
import { CaretDownIcon } from "@phosphor-icons/react";

import { Badge } from "@/components/ui/badge";
import {
  unitStatusLabels,
  unitTypeLabels,
} from "@/lib/unit-labels";
import type { LearnerSession } from "@/components/session-client";

export function DayPlan({ session }: { session: LearnerSession }) {
  const { day } = session.snapshot;
  const [open, setOpen] = useState(true);
  return (
    <details
      data-slot="day-plan"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="rounded-lg border border-border bg-card"
    >
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span className="text-sm font-semibold">План дня</span>
        <CaretDownIcon
          aria-hidden
          className={`size-4 transition-transform ${open ? "" : "-rotate-90"}`}
        />
      </summary>
      <div className="grid gap-4 border-t border-border p-4 lg:grid-cols-2">
        <div className="flex flex-col gap-3">
          <div>
            <h3 className="text-sm font-medium">Цель</h3>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {day.goal}
            </p>
          </div>
          <div>
            <h3 className="text-sm font-medium">Темы</h3>
            <ul className="mt-2 flex flex-wrap gap-2">
              {day.topics.map((topic) => (
                <li key={topic}>
                  <Badge variant="outline">{topic}</Badge>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="text-sm font-medium">Ожидаемые результаты</h3>
            <ul className="mt-2 flex flex-col gap-1.5 text-sm text-muted-foreground">
              {day.expectedOutcomes.map((outcome) => (
                <li key={outcome} className="flex gap-2">
                  <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" />
                  {outcome}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="text-sm font-medium">Вне дня</h3>
            <ul className="mt-2 flex flex-col gap-1.5 text-sm text-muted-foreground">
              {day.outOfScope.map((item) => (
                <li key={item} className="flex gap-2">
                  <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-muted-foreground/40" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div>
          <h3 className="text-sm font-medium">Юниты</h3>
          <ol className="mt-2 flex flex-col gap-1.5 text-sm">
            {session.snapshot.units.map((unit) => {
              const progress = session.unitProgress.find(
                (item) => item.unitId === unit.id,
              );
              const status = progress?.status ?? "locked";
              return (
                <li
                  key={unit.id}
                  className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2"
                >
                  <span className="min-w-0 truncate">
                    <span className="font-medium">{unit.title}</span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {unitTypeLabels[unit.type]} · {unit.estimatedMinutes} мин
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {unitStatusLabels[status]}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </details>
  );
}
```

- [ ] **Step 4: В `session-client.tsx`:**
  - Экспортировать тип `export type LearnerSession = z.infer<typeof learnerSessionSchema>;`.
  - Под `<PageHeader .../>` и над блоком `mutationError`/grid вставить `<DayPlan session={session} />` (импорт `import { DayPlan } from "@/components/day-plan";`).
  - В `UnitStepList` заменить подпись под названием юнита:

```tsx
<span className="block text-xs text-muted-foreground">
  {unitTypeLabels[unit.type]} · {unit.estimatedMinutes} мин ·{" "}
  {unitStatusLabels[status]}
</span>
```

  - Импортировать `unitTypeLabels`, `unitStatusLabels` из `@/lib/unit-labels`; локальный `statusLabels` в `session-client.tsx` заменить на `unitStatusLabels` (он используется в трёх местах: шапка details, `UnitShell`, рейл). `unitTypeLabels` используется в шапке `UnitShell` вместо `<Badge variant="outline">{unit.type}</Badge>` (лейбл «Интервью» вместо «interview»).
  - Убедиться, что `data-slot="unit-step"`, `aria-current`, отсутствие кликабельности сохраняются.

- [ ] **Step 5: Прогнать** `npm run test --workspace=@dlh/web -- session-v2.test.tsx path-v2.test.tsx core-screens.test.tsx` и typecheck — зелёные.
- [ ] **Step 6: Commit** `git add apps/web/components/day-plan.tsx apps/web/components/session-client.tsx apps/web/test/session-v2.test.tsx && git commit -m "feat(web): show day plan in session and enrich unit rail"`

### Task 5: Сервер — upsert прогресса интервью при finish

**Files:**
- Modify: `apps/orchestrator/src/interview-v2.ts`
- Modify: `apps/orchestrator/test/interview-v2.integration.test.ts`

- [ ] **Step 1: Написать падающий интеграционный тест** (в `interview-v2.integration.test.ts`):

```ts
it("writes interview unit progress into the linked learning session on finish", async () => {
  const { state } = createState();
  const app = createTestApp(state);
  // 1. Создать активную learning-сессию через SQL (как createLearningRepository):
  //    learning_sessions (id='session-interview-1', status='active'),
  //    session_snapshots (snapshot с unit type='interview', id='unit-interview-1'),
  //    unit_progress (session_id, unit_id, unit_type='interview', status='in_progress',
  //                   progress_json='{"type":"interview","interviewSessionId":null,"reportId":null}').
  // 2. Запустить интервью (operationId 'setup-linked'), убедиться что interview_sessions.learning_session_id = 'session-interview-1'.
  // 3. Ответить на 3 вопроса (operationId 'a-1','a-2','a-3').
  // 4. finish → 200.
  // 5. Проверить unit_progress.progress_json ==
  //    {"type":"interview","interviewSessionId":<id>,"reportId":<id>} и статус юнита не изменился.
});

it("finishes standalone interviews without a learning session", async () => {
  // существующий happy-path тест: без learning-сессии finish остаётся 200 (upsert пропускается)
});
```

Помощник для вставки сессии (в тестовый файл): вставить `learning_sessions`, `session_snapshots`, `unit_progress` строки напрямую через `state.connection.sqlite.prepare(...)` по колонкам из `packages/database/src/schema.ts` (`session_snapshots`: id, session_id, schema_version, curriculum_day_id, content_hash, snapshot_json, created_at; `learning_sessions`: id, curriculum_day_id?, status, created_at, updated_at — свериться с schema.ts при реализации).

- [ ] **Step 2: Прогнать — убедиться, что падает** (finish не пишет unit_progress).
- [ ] **Step 3: Реализовать** в `apps/orchestrator/src/interview-v2.ts`:
  - Внутри транзакции finish (после UPDATE `interview_sessions` и `agent_conversations`, до `COMMIT`) добавить:

```ts
upsertInterviewUnitProgress(state, learningSessionId, interviewId);
```

  - `learningSessionId` — из `interview.learningSessionId` (уже есть в `InterviewRow`).
  - Новая функция:

```ts
function upsertInterviewUnitProgress(
  state: InterviewV2State,
  learningSessionId: string | null,
  interviewId: string,
): void {
  if (!learningSessionId) return;
  const unit = state.connection.sqlite
    .prepare(
      `SELECT unit_id AS unitId FROM unit_progress
       WHERE session_id = ? AND unit_type = 'interview'
       ORDER BY rowid ASC LIMIT 1`,
    )
    .get(learningSessionId) as { unitId: string } | undefined;
  if (!unit) return;
  state.connection.sqlite
    .prepare(
      `UPDATE unit_progress
       SET progress_json = ?, updated_at = ?
       WHERE session_id = ? AND unit_id = ?
         AND EXISTS (
           SELECT 1 FROM learning_sessions session
           WHERE session.id = unit_progress.session_id
             AND session.status = 'active'
         )`,
    )
    .run(
      JSON.stringify({
        type: "interview",
        interviewSessionId: interviewId,
        reportId: interviewId,
      }),
      Date.now(),
      learningSessionId,
      unit.unitId,
    );
}
```

- [ ] **Step 4: Прогнать** `npm run test --workspace=@dlh/orchestrator -- interview-v2.integration.test.ts` — зелёный; typecheck чистый.
- [ ] **Step 5: Commit** `git add apps/orchestrator/src/interview-v2.ts apps/orchestrator/test/interview-v2.integration.test.ts && git commit -m "feat(orchestrator): link finished interview to learning day unit"`

### Task 6: Сервер — критерий интервью по ответам из БД + день 7

**Files:**
- Modify: `apps/orchestrator/src/learning-v2.ts`
- Modify: `apps/orchestrator/test/learning-v2.integration.test.ts`

- [ ] **Step 1: Написать падающие тесты** в `learning-v2.integration.test.ts` (переиспользовать `createRuntime`, `request`, `completionPayload`, `unitProgressPayload` из файла):

```ts
it("completes the interview unit only with three persisted answers and a report", async () => {
  const { app, state } = createRuntime();
  const pathBody = ...; // day 7 (stableId 'w1d7-integration-checkpoint') из /api/learning/path
  const started = await request(app, "/api/learning/sessions/v2", {
    method: "POST",
    body: JSON.stringify({ dayId: daySeven.id, operationId: "day7-interview-test" }),
  });
  let session = (await started.json()).session;
  const interviewUnit = session.snapshot.units.find((u) => u.type === "interview")!;
  // Пройти предыдущие юниты дня по паттерну существующего full-day теста
  // (briefing/study/recall/dialogue/quiz/code-reading/exercise/review/checkpoint),
  // либо — для фокуса на критерии — начать сессию и дойти до interview тем же циклом.
  // До interview: start unit → real evidence → PATCH completed.

  // Фабрикация без реального интервью отклоняется:
  const forged = await request(app, `/api/learning/sessions/v2/${session.id}/units/${interviewUnit.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      status: "completed",
      payload: { type: "interview", interviewSessionId: "fake", reportId: "fake" },
    }),
  });
  expect(forged.status).toBe(400);

  // Реальное интервью: interview_sessions + conversation + 3 user messages
  const interviewId = "day7-real-interview";
  const conversationId = "day7-interview-conversation";
  state.connection.sqlite.prepare(
    `INSERT INTO interview_sessions
     (id, learning_session_id, status, result_json, started_at, completed_at)
     VALUES (?, ?, 'completed', ?, 1000, 2000)`,
  ).run(
    interviewId,
    session.id,
    JSON.stringify({ schemaVersion: 1, setup: { conversationId, topics: [], difficulty: "interview-ready", questionCount: 3, operationId: "day7-op" }, report: { status: "completed" } }),
  );
  state.connection.sqlite.prepare(
    `INSERT INTO agent_conversations
     (id, learning_session_id, role, provider_id, model_id, provider_session_id,
      status, created_at, updated_at)
     VALUES (?, ?, 'interviewer', 'mock', 'mock-deterministic', NULL, 'active', 1000, 1000)`,
  ).run(conversationId, session.id);
  const insertMessage = state.connection.sqlite.prepare(
    `INSERT INTO agent_messages
     (id, conversation_id, role, content, tool_events_json, raw_event_json,
      status, sequence, idempotency_key, created_at)
     VALUES (?, ?, 'user', ?, '[]', NULL, 'completed', ?, NULL, ?)`,
  );
  for (let i = 1; i <= 3; i += 1) {
    insertMessage.run(`day7-answer-${i}`, conversationId, `Ответ ${i}`, i, 1000 + i);
  }

  const complete = await request(app, `/api/learning/sessions/v2/${session.id}/units/${interviewUnit.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      status: "completed",
      payload: { type: "interview", interviewSessionId: interviewId, reportId: interviewId },
    }),
  });
  expect(complete.status).toBe(200);
  session = (await complete.json()).session;
  expect(session.unitProgress.find((p) => p.unitId === interviewUnit.id)!.status).toBe("completed");
  // следующий юнит (summary) разблокирован
});

it("rejects interview completion with fewer than three answers", async () => {
  // те же setup, но только 2 user-сообщения → PATCH completed → 400
  // и 3 ответа без reportId → 400
});

it("completes the full day 7 from briefing through interview to summary", async () => {
  // Полный цикл: start day 7 → для каждого юнита real evidence по паттерну
  // существующего «enforces evidence, unlocks units, persists reloads, and completes safely»
  // (recall-attempts, quiz-attempts, code-reading-attempts, exercise+test_runs, reviews,
  //  checkpoint payload, interview как выше с 3 ответами, summary через POST /summary),
  // затем PATCH completed → session.status === 'completed', currentStep === 'complete',
  // /api/learning/sessions/current → { session: null }, day 7 status 'completed',
  // следующий день отсутствует/нет следующего available дня.
});
```

- [ ] **Step 2: Прогнать — убедиться, что падает** (сейчас `evidenceAttemptCount` даёт 1 и PATCH с реальными данными тоже 400).
- [ ] **Step 3: Реализовать** в `apps/orchestrator/src/learning-v2.ts`:
  - В `assertCompletionCriteria`, case `"attempts"`, добавить ветку для `unit.type === "interview"`:

```ts
case "attempts":
  failed =
    unit.type === "recall"
      ? !(await hasPersistedRecallEvidence(
          repository,
          sessionId,
          unit,
          payload,
          criterion.minimum,
        ))
      : unit.type === "interview"
        ? !(
            "interviewSessionId" in payload &&
            typeof payload.interviewSessionId === "string" &&
            payload.interviewSessionId !== "" &&
            "reportId" in payload &&
            typeof payload.reportId === "string" &&
            payload.reportId !== "" &&
            countCompletedInterviewAnswers(
              connection,
              payload.interviewSessionId,
            ) >= (criterion.minimum ?? 1)
          )
        : evidenceAttemptCount(unit, payload) < criterion.minimum;
  break;
```

  - Добавить схему и хелпер (рядом с `evidenceAttemptCount`):

```ts
const interviewStoredSetupSchema = z.object({
  schemaVersion: z.literal(1),
  setup: z
    .object({ conversationId: z.string().trim().min(1) })
    .passthrough(),
});

function countCompletedInterviewAnswers(
  connection: DatabaseConnection,
  interviewSessionId: string,
): number {
  const row = connection.sqlite
    .prepare(
      "SELECT result_json AS resultJson FROM interview_sessions WHERE id = ?",
    )
    .get(interviewSessionId) as { resultJson: string | null } | undefined;
  if (!row?.resultJson) return 0;
  const parsed = interviewStoredSetupSchema.safeParse(
    JSON.parse(row.resultJson),
  );
  if (!parsed.success) return 0;
  const count = connection.sqlite
    .prepare(
      `SELECT COUNT(*) AS count FROM agent_messages
       WHERE conversation_id = ? AND role = 'user' AND status = 'completed'`,
    )
    .get(parsed.data.setup.conversationId) as { count: number };
  return count.count;
}
```

  - Проверить, что `z` уже импортирован в `learning-v2.ts` (да, используется для схем запросов).

- [ ] **Step 4: Прогнать** `npm run test --workspace=@dlh/orchestrator -- learning-v2.integration.test.ts interview-v2.integration.test.ts` и typecheck — зелёные. Проверить, что существующий full-day-1 тест не сломан (интервью в нём нет).
- [ ] **Step 5: Commit** `git add apps/orchestrator/src/learning-v2.ts apps/orchestrator/test/learning-v2.integration.test.ts && git commit -m "fix(orchestrator): complete interview units from persisted answers and report"`

### Task 7: Клиент — состояния интервью-юнита и параметры страницы интервью

**Files:**
- Modify: `apps/web/components/session-client.tsx` (`InterviewUnit`, `onInterview` push)
- Modify: `apps/web/components/interview-client.tsx` (`?sessionId=`, `?id=`)
- Modify: `apps/web/test/session-v2.test.tsx`, `apps/web/test/interview-v2.test.tsx`

- [ ] **Step 1: Написать падающие тесты:**
  - `session-v2.test.tsx`: интервью-юнит без отчёта показывает «Открыть интервью» и `router.push("/interview?sessionId=<id>")` (мок `useRouter` как в существующих кейсах); с `reportId` показывает «Открыть отчёт» + «Завершить юнит»; после `PATCH completed` — «Юнит завершён и сохранён».
  - `interview-v2.test.tsx`: с `?sessionId=session-1` рендерится кнопка «Вернуться к занятию» во всех состояниях (setup/in_progress/report) и `router.push("/session?id=session-1")` по клику; с `?id=interview-9` первоначальный запрос идёт на `/interviews/v2/interview-9` (а не `/current`) и рендерится сохранённый отчёт; `?id=` невалидного интервью → `QueryError` с повтором.

- [ ] **Step 2: Прогнать — убедиться, что падают.**
- [ ] **Step 3: Реализовать `session-client.tsx`:**
  - `onInterview` в `SessionClient`:

```tsx
onInterview={() => {
  const payload = focusedProgress.payload;
  const interviewId =
    payload.type === "interview" ? payload.interviewSessionId : null;
  if (interviewId) {
    router.push(`/interview?id=${encodeURIComponent(interviewId)}`);
  } else {
    router.push(`/interview?sessionId=${encodeURIComponent(session.id)}`);
  }
}}
```

  - `InterviewUnit` (заменить функцию целиком):

```tsx
function InterviewUnit({
  unit,
  progress,
  pending,
  patchUnit,
  onInterview,
}: UnitBodyProps) {
  const payload =
    progress.payload.type === "interview" ? progress.payload : null;
  const hasReport = Boolean(payload?.reportId);
  return (
    <div className="flex flex-col gap-6">
      {unit.payload.type === "interview" ? (
        <InfoList title="Темы" items={unit.payload.topics} />
      ) : null}
      {progress.status === "completed" ? (
        <CompletedNote />
      ) : hasReport ? (
        <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-[60ch] text-sm leading-6 text-muted-foreground">
            Отчёт по интервью сохранён. Открой его, затем заверши юнит.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={onInterview}>
              Открыть отчёт
              <ArrowRightIcon aria-hidden />
            </Button>
            <Button
              disabled={pending}
              onClick={() =>
                void patchUnit(unit, progress, "completed", {
                  type: "interview",
                  interviewSessionId: payload?.interviewSessionId ?? null,
                  reportId: payload?.reportId ?? null,
                })
              }
            >
              Завершить юнит
              <CheckIcon aria-hidden />
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex justify-end">
          <Button onClick={onInterview}>
            Открыть интервью
            <ArrowRightIcon aria-hidden />
          </Button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Реализовать `interview-client.tsx`:**
  - `const params = useSearchParams();` (уже есть в `session-client`; здесь добавить импорт `useSearchParams` из `next/navigation` и `useRouter`).
  - `requestedInterviewId = params.get("id")?.trim() || null`; `sessionId = params.get("sessionId")?.trim() || null`.
  - `queryKey = requestedInterviewId ? ["interview-v2", requestedInterviewId] : ["interview-v2-current"]`.
  - `queryFn`: если `requestedInterviewId` — `parsePayload(interviewSchema, await api(`/interviews/v2/${encodeURIComponent(requestedInterviewId)}`))`, иначе `readCurrentInterview()`.
  - В рендер добавить кнопку «Вернуться к занятию» (рендерится при `sessionId` во всех ветках: setup, opening-retry, session, report):

```tsx
{sessionId ? (
  <Button
    variant="outline"
    className="self-start"
    onClick={() => router.push(`/session?id=${encodeURIComponent(sessionId)}`)}
  >
    <ArrowLeftIcon aria-hidden className="size-4" />
    Вернуться к занятию
  </Button>
) : null}
```

  - `ArrowLeftIcon` импортировать из `@phosphor-icons/react`.
  - Проверить, что `startNewInterview` при `?id=` не роняет кэш: при `?id=` queryKey другой, `setQueryData` в `startInterview`/`submitAnswer`/`finishInterview` обновляет `["interview-v2-current"]` — в `?id=`-режиме обновлять и `["interview-v2", id]` (после мутаций `queryClient.setQueryData(queryKey, next)` вместо жёсткого ключа; в существующих местах заменить `["interview-v2-current"]` на `queryKey`).

- [ ] **Step 5: Прогнать** `npm run test --workspace=@dlh/web -- session-v2.test.tsx interview-v2.test.tsx` и typecheck — зелёные.
- [ ] **Step 6: Commit** `git add apps/web/components/session-client.tsx apps/web/components/interview-client.tsx apps/web/test/session-v2.test.tsx apps/web/test/interview-v2.test.tsx && git commit -m "feat(web): link interview unit states and session returns"`

### Task 8: E2E — обновлённые селекторы, план дня, завершение интервью-юнита

**Files:**
- Modify: `apps/web/e2e/daily-flow.spec.ts`

- [ ] **Step 1: Обновить тест «runs and restores the dedicated interview workflow»:**
  - `getByLabel("Текст ответа")` → `getByLabel("Сообщение")`.
  - После «Завершить и открыть отчёт» и проверки «Отчёт по интервью»/«100%» добавить проверку «Вернуться к занятию» при `?sessionId=` (открыть `/interview?sessionId=demo-session`, проверить кнопку и `await expect(page).toHaveURL(/\/session\?id=/u)` после клика).
  - Проверка `li[role="status"]` остаётся (pending-вопрос).
- [ ] **Step 2: Добавить проверку плана дня** в тест Day 1: после перехода на `/session?id=` — `page.getByText("План дня")`, `getByText("Темы")`, «Ожидаемые результаты», «Вне дня», «Юниты»; рейл содержит русский тип («Брифинг · 6 мин» для первого юнита Day 1).
- [ ] **Step 3: Прогнать e2e-интервью-тест локально:**

```powershell
npm run test:e2e --workspace=@dlh/web -- --grep "interview"
```

  Ожидается: зелёный. Полный e2e-прогон — в финальном gate.
- [ ] **Step 4: Commit** `git add apps/web/e2e/daily-flow.spec.ts && git commit -m "test(e2e): cover chat interview, day plan and session return"`

### Task 9: Аудит зависимостей и документация

**Files:**
- Modify: `package-lock.json` (только если `npm audit fix` безопасно обновит esbuild/tsup)
- Modify: `docs/acceptance-audit.md`, `docs/troubleshooting.md`, `docs/product-specification-v2.md`, `docs/design-system.md`

- [ ] **Step 1: `npm audit --json`** — зафиксировать: 3 high (next → postcss/sharp) + 1 low dev (tsup → esbuild). Сравнить с прошлым срезом.
- [ ] **Step 2: `npm audit fix` (без `--force`)** — проверить, что меняется: только dev-only esbuild (0.27.x → 0.28.x через tsup). Прогнать `npm run typecheck` и `npm run test:fast`; если зелёные — оставить lockfile; если `audit fix` трогает next/postcss/sharp или не завершается безопасно — `git checkout -- package-lock.json` не использовать (worktree чистый): откатить `package-lock.json` и `node_modules` через `npm install` с предыдущим lockfile из git (`git show HEAD:package-lock.json > package-lock.json` запрещён shell-редиректом в файл — использовать `git restore package-lock.json`, затем `npm install`).
- [ ] **Step 3: `docs/acceptance-audit.md`** — обновить: интервью (чат-UI, связка с днём, критерий ≥3 ответа + report), день 7 «проходим», итоговая таблица, external provider matrix, фактический результат 2026-08-02 (аудит: те же 3 high + 1 low или обновлённое).
- [ ] **Step 4: `docs/troubleshooting.md`** — добавить раздел про opencode sidecar:

```text
Запуск OpenCode sidecar для локального провайдера:
OPENCODE_SERVER_PASSWORD=<пароль> opencode serve --hostname 127.0.0.1 --port 4096
Проверка: GET http://127.0.0.1:4096/health → 200.
Пароль передаётся только через environment и не логируется.
```

- [ ] **Step 5: `docs/product-specification-v2.md`** — описать: интервью как чат (без стриминга), план дня в сессии, связку интервью-юнита (состояния и завершение), `?sessionId=`/`?id=`.
- [ ] **Step 6: `docs/design-system.md`** — добавить `Textarea` (ui-примитив) и `InterviewChatView`/`DayPlan` (композитные компоненты) в каталог компонентов с указанием data-slot и доступности.
- [ ] **Step 7: Commit** `git add package-lock.json docs && git commit -m "docs(audit): record dependency audit and interview/day-plan UX"`

### Task 10: Реальные проверки провайдеров и Zed (финальный блок, требует окружения)

**Files:**
- Modify: `docs/acceptance-audit.md` (фактические результаты)

Проверки выполняются субагентом аудита в конце, с запущенным приложением:

- [ ] **Step 1: Codex turn** — запустить dev (`npm run dev`), в `/settings` provider=codex + реальная модель из списка, открыть Day 1 teacher dialogue, отправить объяснение, дождаться terminal-события в `agent-conversations`/`agent_messages` (status completed), проверить содержательный ответ, reload страницы → ответ сохранён. Записать: CLI-версия (ожидается 0.144.3), model id, terminal-статус.
- [ ] **Step 2: OpenCode turn** — запросить у пользователя установку `OPENCODE_SERVER_PASSWORD`; запустить `opencode serve --hostname 127.0.0.1 --port 4096`; `GET /health` → 200; в приложении provider=opencode + модель из connected set; teacher turn + сохранение после reload. Записать CLI/SDK-версии (ожидается 1.18.3), model id.
- [ ] **Step 3: Zed GUI** — через практику: создать attempt, `POST /api/exercise-attempts/:id/open` → `opened:true`; проверить процесс Zed (`Get-Process zed*`) и командную строку с путём attempt-папки; попросить пользователя подтвердить видимое окно. Fallback: `copy_path` и честная запись «GUI не подтверждён».
- [ ] **Step 4: Записать результаты в `docs/acceptance-audit.md`** — для каждого: факт/статус/версии/blocker. Не объявлять успех без реального terminal-события.
- [ ] **Step 5: Commit** `git add docs/acceptance-audit.md && git commit -m "docs(audit): record provider and Zed verification results"`

### Task 11: Финальный gate из корня

- [ ] **Step 1: Backup + миграции + seed** (`npm run db:backup`, `npm run db:migrate`, `npm run db:seed` ×2 для идемпотентности).
- [ ] **Step 2: Gate:** `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm run test:fast`, `npm run test:e2e`, `npm run build`.
- [ ] **Step 3: Починить всё найденное** (обычно: селекторы тестов, неиспользуемые импорты, форматирование) и повторить gate.
- [ ] **Step 4: Итоговый `npm audit`** — записать финальное состояние в acceptance-audit.
- [ ] **Step 5: Commit** `git add -A && git commit -m "chore: final verification gate for interview chat and day plan"`

## Self-review (выполнен автором плана)

- Покрытие спеки: чат-интервью → Task 2/3/8; план дня и рейл → Task 1/4/8; связка интервью с днём (upsert + критерий + состояния + params) → Task 5/6/7; аудит и проверки → Task 9/10; gate → Task 11. Документация → Task 9/10.
- Placeholder-скан: все шаги содержат конкретные файлы, сигнатуры и код; тестовые кейсы заданы через существующие фикстуры/паттерны репозитория (full-day-1 тест как образец для day-7).
- Типы согласованы: `Interview` экспортируется из `interview-client.tsx` (Task 3), `LearnerSession` из `session-client.tsx` (Task 4), `InterviewChatViewProps` (Task 3) совпадает с вызовом в Task 3 Step 4, `countCompletedInterviewAnswers(connection, interviewSessionId)` (Task 6) вызывается в том же Task.
