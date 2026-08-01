"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import {
  ArrowRightIcon,
  CheckCircleIcon,
  CircleIcon,
  ClockIcon,
  LockKeyIcon,
  PlayCircleIcon,
} from "@phosphor-icons/react";
import { z } from "zod";

import { PageHeader } from "@/components/page-header";
import { EmptyState, QueryError } from "@/components/query-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

const unitTypeSchema = z.enum([
  "briefing",
  "study",
  "recall",
  "teacher-dialogue",
  "quiz",
  "code-reading",
  "exercise",
  "review",
  "interview",
  "summary",
  "checkpoint",
  "spaced-review",
]);

const unitStatusSchema = z.enum([
  "locked",
  "ready",
  "in_progress",
  "completed",
  "skipped",
]);

const learnerUnitSchema = z
  .object({
    id: z.string().min(1),
    stableId: z.string().min(1),
    type: unitTypeSchema,
    order: z.number().int().positive(),
    title: z.string().min(1),
    description: z.string(),
    estimatedMinutes: z.number().int().nonnegative(),
    objectives: z.array(z.string()),
    checklist: z.array(
      z.object({
        id: z.string().min(1),
        label: z.string().min(1),
        required: z.boolean(),
      }),
    ),
    status: unitStatusSchema,
  })
  .passthrough();

const learningPathSchema = z
  .object({
    curriculum: z
      .object({
        id: z.string().min(1),
        slug: z.string().min(1),
        title: z.string().min(1),
        description: z.string().nullable(),
        version: z.object({
          id: z.string().min(1),
          revision: z.number().int().positive(),
          contentHash: z.string().min(1),
          status: z.literal("published"),
        }),
        weeks: z.array(
          z.object({
            id: z.string().min(1),
            stableId: z.string().min(1),
            order: z.number().int().positive(),
            title: z.string().min(1),
            description: z.string().nullable(),
            days: z.array(
              z.object({
                id: z.string().min(1),
                stableId: z.string().min(1),
                order: z.number().int().positive(),
                title: z.string().min(1),
                description: z.string().min(1),
                goal: z.string().min(1),
                estimatedMinutes: z.number().int().nonnegative(),
                prerequisites: z.array(z.string()),
                expectedOutcomes: z.array(z.string()),
                depthLevel: z.enum([
                  "foundation",
                  "interview-ready",
                  "deep-dive",
                ]),
                outOfScope: z.array(z.string()),
                topics: z.array(z.string()),
                status: z.enum([
                  "completed",
                  "in_progress",
                  "available",
                  "locked",
                ]),
                sessionId: z.string().nullable(),
                units: z.array(learnerUnitSchema),
              }),
            ),
          }),
        ),
      })
      .nullable(),
  })
  .superRefine((value, context) => {
    const leak = findProtectedField(value);
    if (leak) {
      context.addIssue({
        code: "custom",
        path: leak.path,
        message: `Protected curriculum field received: ${leak.field}`,
      });
    }
  });

type LearningPath = z.infer<typeof learningPathSchema>;
type LearningDay = NonNullable<
  LearningPath["curriculum"]
>["weeks"][number]["days"][number];
type LearnerUnit = LearningDay["units"][number];

const unitTypeLabels: Record<LearnerUnit["type"], string> = {
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

const dayStatusLabels: Record<LearningDay["status"], string> = {
  completed: "Завершён",
  in_progress: "Текущий",
  available: "Доступен",
  locked: "Заблокирован",
};

const unitStatusLabels: Record<LearnerUnit["status"], string> = {
  completed: "Готово",
  skipped: "Пропущено",
  in_progress: "Сейчас",
  ready: "Доступно",
  locked: "Заблокировано",
};

export function DashboardClient() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["learning-path"],
    queryFn: async () => learningPathSchema.parse(await api("/learning/path")),
  });
  const start = useMutation({
    mutationFn: (dayId: string) =>
      api<{ session: { id: string } }>("/learning/sessions/v2", {
        method: "POST",
        body: JSON.stringify({
          dayId,
          operationId: globalThis.crypto.randomUUID(),
        }),
      }),
    onSuccess: async ({ session }) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["learning-path"] }),
        queryClient.invalidateQueries({
          queryKey: ["learning-session-current"],
        }),
      ]);
      router.push(`/session?id=${session.id}`);
    },
  });

  if (query.isLoading) {
    return (
      <div
        data-slot="learning-path-loading"
        role="status"
        aria-busy="true"
        aria-label="Загружаю учебный маршрут…"
        className="flex flex-col gap-6"
      >
        <span className="sr-only">Загружаю учебный маршрут…</span>
        <Skeleton className="h-20" />
        <Skeleton className="h-56" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  if (query.isError || !query.data) {
    return (
      <QueryError
        message={
          query.error instanceof Error
            ? query.error.message
            : "Orchestrator недоступен."
        }
        retry={() => void query.refetch()}
      />
    );
  }

  const curriculum = query.data.curriculum;
  if (!curriculum) {
    return (
      <EmptyState
        title="Учебный маршрут ещё не опубликован"
        description="Опубликуй активную версию curriculum, чтобы начать занятие."
      />
    );
  }

  const days = curriculum.weeks.flatMap((week) => week.days);
  const actionableDay =
    days.find((day) => day.status === "in_progress") ??
    days.find((day) => day.status === "available");
  const completedUnits = days.reduce(
    (sum, day) => sum + countCompletedUnits(day.units),
    0,
  );
  const totalUnits = days.reduce((sum, day) => sum + day.units.length, 0);
  const totalProgress = totalUnits
    ? Math.round((completedUnits / totalUnits) * 100)
    : 0;

  return (
    <div data-slot="learning-path" className="flex flex-col gap-8">
      <PageHeader
        title={curriculum.title}
        description={
          curriculum.description ??
          "Последовательный маршрут: от понимания идеи до самостоятельного объяснения и кода."
        }
        actions={
          <Badge variant="outline">Версия {curriculum.version.revision}</Badge>
        }
      />

      {start.isError ? (
        <div
          data-slot="start-session-error"
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"
        >
          {start.error instanceof Error
            ? start.error.message
            : "Не удалось начать занятие."}
        </div>
      ) : null}

      {actionableDay ? (
        <section
          data-slot="next-learning-step"
          aria-labelledby="next-learning-step-title"
          className="flex flex-col gap-5"
        >
          <header className="flex flex-col gap-1 border-b border-border pb-4">
            <h2 id="next-learning-step-title" className="text-xl font-semibold">
              Следующий шаг
            </h2>
            <p className="max-w-[70ch] text-sm leading-6 text-muted-foreground">
              Продолжи с ближайшего доступного шага. Ниже можно свериться со
              всем маршрутом, не раскрывая будущие задания раньше времени.
            </p>
          </header>
          <ol data-slot="current-curriculum-day">
            <DayRail
              day={actionableDay}
              isActionable
              isStarting={
                start.isPending && start.variables === actionableDay.id
              }
              onOpen={(sessionId) => router.push(`/session?id=${sessionId}`)}
              onStart={(dayId) => start.mutate(dayId)}
            />
          </ol>
        </section>
      ) : (
        <EmptyState
          title="Опубликованный маршрут завершён"
          description="Все доступные дни пройдены. Результаты и повторение остаются в карте знаний и журнале ошибок."
        />
      )}

      <section
        data-slot="path-progress"
        aria-labelledby="path-progress-title"
        className="flex flex-col gap-3 border-y border-border py-6"
      >
        <div className="flex items-end justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1">
            <h2 id="path-progress-title" className="text-sm font-medium">
              Общий прогресс
            </h2>
            <p className="text-xs text-muted-foreground">
              {completedUnits} из {totalUnits} юнитов завершено
            </p>
          </div>
          <span className="shrink-0 font-mono text-sm font-semibold">
            {totalProgress}%
          </span>
        </div>
        <Progress aria-label="Общий прогресс маршрута" value={totalProgress} />
      </section>

      <div data-slot="curriculum-weeks" className="flex flex-col gap-8">
        {curriculum.weeks.map((week) => (
          <section
            key={week.id}
            data-slot="curriculum-week"
            aria-labelledby={`week-${week.id}`}
            className="flex flex-col gap-4"
          >
            <header className="flex flex-col gap-1 border-b border-border pb-4">
              <h2 id={`week-${week.id}`} className="text-lg font-semibold">
                {formatWeekTitle(week.order, week.title)}
              </h2>
              {week.description ? (
                <p className="max-w-[70ch] text-sm leading-6 text-muted-foreground">
                  {week.description}
                </p>
              ) : null}
            </header>

            <ol
              data-slot="curriculum-days-overview"
              aria-label={`Обзор дней недели ${week.order}`}
              className="divide-y divide-border border-y border-border"
            >
              {week.days.map((day) => (
                <DaySummary
                  key={day.id}
                  day={day}
                  current={day.id === actionableDay?.id}
                />
              ))}
            </ol>
          </section>
        ))}
      </div>
    </div>
  );
}

function DaySummary({ day, current }: { day: LearningDay; current: boolean }) {
  const completed = countCompletedUnits(day.units);
  const progress = day.units.length
    ? Math.round((completed / day.units.length) * 100)
    : 0;
  const DayStatusIcon = statusIcon(day.status);

  return (
    <li
      data-slot="curriculum-day-summary"
      data-status={day.status}
      className={cn(
        "flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:gap-4",
        current && "bg-accent/35 px-3",
      )}
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-full border border-border font-mono text-sm font-semibold">
        {String(day.order).padStart(2, "0")}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-medium">{day.title}</h3>
          <Badge variant={dayBadgeVariant(day.status)}>
            <DayStatusIcon aria-hidden />
            {dayStatusLabels[day.status]}
          </Badge>
        </div>
        <p className="mt-1 line-clamp-2 text-sm leading-6 text-muted-foreground">
          {day.description}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-4 sm:w-48">
        <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
          <ClockIcon aria-hidden />
          {day.estimatedMinutes} мин
        </span>
        <div className="min-w-20 flex-1">
          <div className="mb-1 flex justify-between text-xs text-muted-foreground">
            <span>
              {completed}/{day.units.length}
            </span>
            <span className="font-mono">{progress}%</span>
          </div>
          <Progress aria-label={`Прогресс дня ${day.order}`} value={progress} />
        </div>
      </div>
    </li>
  );
}

function DayRail({
  day,
  isActionable,
  isStarting,
  onOpen,
  onStart,
}: {
  day: LearningDay;
  isActionable: boolean;
  isStarting: boolean;
  onOpen: (sessionId: string) => void;
  onStart: (dayId: string) => void;
}) {
  const completed = countCompletedUnits(day.units);
  const progress = day.units.length
    ? Math.round((completed / day.units.length) * 100)
    : 0;
  const currentUnit =
    day.units.find((unit) => unit.status === "in_progress") ??
    (isActionable
      ? day.units.find((unit) => unit.status === "ready")
      : undefined);
  const DayStatusIcon = statusIcon(day.status);

  return (
    <li
      data-slot="curriculum-day"
      data-status={day.status}
      aria-disabled={day.status === "locked" || undefined}
      className="grid min-w-0 grid-cols-[2rem_minmax(0,1fr)] gap-4"
    >
      <div aria-hidden className="flex flex-col items-center gap-2">
        <span className="flex size-8 items-center justify-center rounded-full border border-border bg-background font-mono text-xs font-semibold">
          {String(day.order).padStart(2, "0")}
        </span>
        <span className="min-h-8 w-px flex-1 bg-border" />
      </div>

      <article
        aria-labelledby={`day-${day.id}`}
        className="flex min-w-0 flex-col gap-6 border-b border-border pb-8"
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={dayBadgeVariant(day.status)}>
                <DayStatusIcon aria-hidden />
                {dayStatusLabels[day.status]}
              </Badge>
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <ClockIcon aria-hidden />
                {day.estimatedMinutes} мин
              </span>
              <span className="text-xs text-muted-foreground">
                Глубина: {depthLabel(day.depthLevel)}
              </span>
            </div>
            <div className="flex flex-col gap-1">
              <h3 id={`day-${day.id}`} className="text-lg font-semibold">
                {day.title}
              </h3>
              <p className="max-w-[70ch] text-sm leading-6 text-muted-foreground">
                {day.description}
              </p>
            </div>
          </div>

          <div className="flex w-full shrink-0 flex-col gap-2 sm:w-40">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">
                {completed}/{day.units.length}
              </span>
              <span className="font-mono">{progress}%</span>
            </div>
            <Progress
              aria-label={`Прогресс дня ${day.order}`}
              value={progress}
            />
          </div>
        </div>

        {isActionable ? (
          <div className="flex justify-start">
            <Button
              type="button"
              disabled={isStarting}
              onClick={() =>
                day.sessionId ? onOpen(day.sessionId) : onStart(day.id)
              }
            >
              {isStarting
                ? "Создаю занятие…"
                : day.sessionId
                  ? "Продолжить занятие"
                  : "Начать занятие"}
              <ArrowRightIcon aria-hidden />
            </Button>
          </div>
        ) : null}

        <dl className="grid gap-4 rounded-lg bg-muted/55 p-4 text-sm md:grid-cols-2">
          <div className="flex flex-col gap-1">
            <dt className="font-medium">Цель</dt>
            <dd className="leading-6 text-muted-foreground">{day.goal}</dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="font-medium">Результат</dt>
            <dd className="leading-6 text-muted-foreground">
              {day.expectedOutcomes.length
                ? day.expectedOutcomes.join(" · ")
                : "Будет уточнён в curriculum"}
            </dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="font-medium">Темы</dt>
            <dd className="flex flex-wrap gap-2">
              {day.topics.map((topic) => (
                <Badge key={topic} variant="secondary">
                  {topic}
                </Badge>
              ))}
            </dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="font-medium">Не входит в день</dt>
            <dd className="leading-6 text-muted-foreground">
              {day.outOfScope.length ? day.outOfScope.join(" · ") : "—"}
            </dd>
          </div>
        </dl>

        <ol
          data-slot="curriculum-units"
          aria-label={`Юниты дня ${day.order}`}
          className="flex flex-col gap-2"
        >
          {day.units.map((unit) => (
            <UnitRow
              key={unit.id}
              unit={unit}
              expanded={unit.id === currentUnit?.id}
            />
          ))}
        </ol>

        {!isActionable && day.status === "locked" ? (
          <div className="flex justify-end">
            <Button type="button" variant="outline" disabled>
              <LockKeyIcon aria-hidden />
              Сначала завершите предыдущий день
            </Button>
          </div>
        ) : null}
      </article>
    </li>
  );
}

function UnitRow({ unit, expanded }: { unit: LearnerUnit; expanded: boolean }) {
  const UnitStatusIcon = unitStatusIcon(unit.status);
  return (
    <li
      data-slot="curriculum-unit"
      data-unit-type={unit.type}
      data-status={unit.status}
      aria-current={expanded ? "step" : undefined}
      className={
        expanded
          ? "rounded-lg border border-primary/35 bg-accent/45 p-4"
          : "border-b border-border px-1 py-3 last:border-b-0"
      }
    >
      <div className="flex min-w-0 items-start gap-3">
        <span className="flex size-6 shrink-0 items-center justify-center text-muted-foreground">
          <UnitStatusIcon aria-hidden className="size-4" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <div className="min-w-0">
              <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                {String(unit.order).padStart(2, "0")} ·{" "}
                {unitTypeLabels[unit.type]}
              </span>
              <p className="text-sm font-medium">{unit.title}</p>
            </div>
            <span className="shrink-0 text-xs text-muted-foreground">
              {unitStatusLabels[unit.status]} · {unit.estimatedMinutes} мин
            </span>
          </div>

          {expanded ? (
            <div className="flex flex-col gap-3 text-sm">
              <p className="max-w-[70ch] leading-6 text-muted-foreground">
                {unit.description}
              </p>
              {unit.objectives.length ? (
                <div className="flex flex-col gap-2">
                  <p className="font-medium">Что нужно получить</p>
                  <ul className="flex flex-col gap-1.5 text-muted-foreground">
                    {unit.objectives.map((objective) => (
                      <li key={objective} className="flex items-start gap-2">
                        <CircleIcon
                          aria-hidden
                          className="relative top-1 size-3 shrink-0"
                        />
                        <span>{objective}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </li>
  );
}

function countCompletedUnits(units: readonly LearnerUnit[]): number {
  return units.filter(
    (unit) => unit.status === "completed" || unit.status === "skipped",
  ).length;
}

function formatWeekTitle(order: number, title: string): string {
  return new RegExp(`^неделя\\s+0*${order}(?:\\b|\\.)`, "iu").test(title)
    ? title
    : `Неделя ${order}. ${title}`;
}

function dayBadgeVariant(status: LearningDay["status"]) {
  if (status === "completed") return "success" as const;
  if (status === "in_progress") return "default" as const;
  return "outline" as const;
}

function statusIcon(status: LearningDay["status"]) {
  if (status === "completed") return CheckCircleIcon;
  if (status === "in_progress") return PlayCircleIcon;
  if (status === "locked") return LockKeyIcon;
  return CircleIcon;
}

function unitStatusIcon(status: LearnerUnit["status"]) {
  if (status === "completed" || status === "skipped") return CheckCircleIcon;
  if (status === "in_progress") return PlayCircleIcon;
  if (status === "locked") return LockKeyIcon;
  return CircleIcon;
}

function depthLabel(depth: LearningDay["depthLevel"]): string {
  if (depth === "interview-ready") return "interview-ready";
  if (depth === "deep-dive") return "deep-dive";
  return "foundation";
}

function findProtectedField(
  value: unknown,
  path: Array<string | number> = [],
): { field: string; path: Array<string | number> } | null {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findProtectedField(value[index], [...path, index]);
      if (found) return found;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;

  for (const [key, nestedValue] of Object.entries(value)) {
    if (
      key === "referenceAnswer" ||
      key === "evaluationPoints" ||
      key === "correctOptionIds" ||
      key === "commonMistakes" ||
      key === "misconceptions" ||
      key === "protectedEvaluation"
    ) {
      return { field: key, path: [...path, key] };
    }
    const found = findProtectedField(nestedValue, [...path, key]);
    if (found) return found;
  }
  return null;
}
