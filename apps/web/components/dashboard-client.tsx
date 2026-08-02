"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import {
  ArrowRightIcon,
  BookOpenIcon,
  BrainIcon,
  CheckCircleIcon,
  CircleIcon,
  ClockIcon,
  LockKeyIcon,
  PlayCircleIcon,
  TerminalIcon,
} from "@phosphor-icons/react";
import { z } from "zod";

import { PageHeader } from "@/components/page-header";
import { EmptyState, QueryError } from "@/components/query-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import {
  completedBlockCount,
  focusedUnit,
  groupDayIntoBlocks,
  remainingDayMinutes,
  type BlockUnit,
  type LearningBlock,
  type LearningBlockId,
} from "@/lib/learning-blocks";
import { formatDuration, formatMinutesShort } from "@/lib/time";
import {
  depthLabel,
  unitStatusLabels,
  unitTypeLabels,
} from "@/lib/unit-labels";
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

const dayStatusLabels: Record<LearningDay["status"], string> = {
  completed: "Завершён",
  in_progress: "Текущий",
  available: "Доступен",
  locked: "Заблокирован",
};

const blockStatusLabels: Record<LearningBlock["status"], string> = {
  completed: "Завершён",
  in_progress: "Сейчас",
  ready: "Доступен",
  locked: "Заблокирован",
};

const blockIcons: Record<LearningBlockId, typeof BookOpenIcon> = {
  study: BookOpenIcon,
  check: BrainIcon,
  practice: TerminalIcon,
};

const blockColorClasses: Record<
  LearningBlockId,
  { icon: string; surface: string; border: string }
> = {
  study: {
    icon: "text-activity-study",
    surface: "bg-activity-study-surface",
    border: "border-activity-study/40",
  },
  check: {
    icon: "text-activity-recall",
    surface: "bg-activity-recall-surface",
    border: "border-activity-recall/40",
  },
  practice: {
    icon: "text-activity-practice",
    surface: "bg-activity-practice-surface",
    border: "border-activity-practice/40",
  },
};

export function DashboardClient() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [detailDayId, setDetailDayId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
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
        <Skeleton className="h-24" />
        <Skeleton className="h-44" />
        <Skeleton className="h-64" />
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
  const selectedDay =
    days.find((day) => day.id === detailDayId) ?? actionableDay ?? null;
  const blocks = actionableDay
    ? groupDayIntoBlocks(actionableDay.units, (unit) => unit.status ?? "locked")
    : [];
  const activeBlock = blocks.find(
    (block) => block.status !== "completed" && block.totalCount > 0,
  );
  const dayCompleted = Boolean(actionableDay && !activeBlock);
  const remaining = remainingDayMinutes(blocks);
  const nextUnit = actionableDay
    ? focusedUnit(actionableDay.units, (unit) => unit.status ?? "locked")
    : null;
  const completedUnits = days.reduce(
    (sum, day) => sum + countCompletedUnits(day.units),
    0,
  );
  const totalUnits = days.reduce((sum, day) => sum + day.units.length, 0);
  const totalProgress = totalUnits
    ? Math.round((completedUnits / totalUnits) * 100)
    : 0;

  return (
    <div data-slot="learning-path" className="flex flex-col gap-10">
      <PageHeader
        title={curriculum.title}
        description={
          curriculum.description ??
          "Последовательный маршрут: от понимания идеи до самостоятельного объяснения и кода."
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
        <>
          <TodayCard
            day={actionableDay}
            blocks={blocks}
            activeBlock={activeBlock ?? null}
            dayCompleted={dayCompleted}
            remaining={remaining}
            nextUnit={nextUnit}
            isStarting={start.isPending && start.variables === actionableDay.id}
            onOpen={(sessionId) => router.push(`/session?id=${sessionId}`)}
            onStart={(dayId) => start.mutate(dayId)}
          />

          <section
            data-slot="day-blocks"
            aria-labelledby="day-blocks-title"
            className="flex flex-col gap-4"
          >
            <header className="flex items-end justify-between gap-4 border-b border-border pb-4">
              <div className="flex min-w-0 flex-col gap-1">
                <h2 id="day-blocks-title" className="text-xl font-semibold">
                  Текущий день
                </h2>
                <p className="text-sm leading-6 text-muted-foreground">
                  {completedBlockCount(blocks)} из 3 учебных блоков ·{" "}
                  {formatDuration(remaining)} осталось
                </p>
              </div>
              <Sheet open={detailOpen} onOpenChange={setDetailOpen}>
                <SheetTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    data-slot="day-detail-trigger"
                  >
                    Посмотреть подробный план дня
                  </Button>
                </SheetTrigger>
                <SheetContent data-slot="day-detail-sheet">
                  {selectedDay ? (
                    <DayDetailSheetContent
                      day={selectedDay}
                      isStarting={
                        start.isPending && start.variables === selectedDay.id
                      }
                      onOpen={(sessionId) =>
                        router.push(`/session?id=${sessionId}`)
                      }
                      onStart={(dayId) => {
                        setDetailOpen(false);
                        start.mutate(dayId);
                      }}
                    />
                  ) : null}
                </SheetContent>
              </Sheet>
            </header>

            <div
              data-slot="day-block-grid"
              className="grid gap-4 lg:grid-cols-3"
            >
              {blocks
                .filter((block) => block.totalCount > 0)
                .map((block, index) => (
                  <BlockCard
                    key={block.id}
                    block={block}
                    index={index}
                    active={block.id === activeBlock?.id}
                  />
                ))}
            </div>
          </section>
        </>
      ) : (
        <EmptyState
          title="Опубликованный маршрут завершён"
          description="Все доступные дни пройдены. Результаты и повторение остаются в карте знаний и журнале ошибок."
        />
      )}

      <section
        data-slot="week-path"
        aria-labelledby="week-path-title"
        className="flex flex-col gap-4"
      >
        <header className="flex items-end justify-between gap-4 border-b border-border pb-4">
          <div className="flex min-w-0 flex-col gap-1">
            <h2 id="week-path-title" className="text-xl font-semibold">
              Путь недели
            </h2>
            <p className="text-sm leading-6 text-muted-foreground">
              {completedUnits} из {totalUnits} шагов пройдено
            </p>
          </div>
          <span className="shrink-0 font-mono text-sm font-semibold">
            {totalProgress}%
          </span>
        </header>

        <div className="flex flex-col gap-6">
          {curriculum.weeks.map((week) => (
            <div key={week.id} data-slot="week" className="flex flex-col gap-3">
              <h3 className="text-sm font-medium text-muted-foreground">
                {formatWeekTitle(week.order, week.title)}
              </h3>
              <ol
                data-slot="week-day-list"
                className="grid gap-3 md:grid-cols-2 xl:grid-cols-3"
              >
                {week.days.map((day) => (
                  <DayCard
                    key={day.id}
                    day={day}
                    current={day.id === actionableDay?.id}
                    onOpen={() => {
                      setDetailDayId(day.id);
                      setDetailOpen(true);
                    }}
                  />
                ))}
              </ol>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function TodayCard({
  day,
  blocks,
  activeBlock,
  dayCompleted,
  remaining,
  nextUnit,
  isStarting,
  onOpen,
  onStart,
}: {
  day: LearningDay;
  blocks: LearningBlock[];
  activeBlock: LearningBlock | null;
  dayCompleted: boolean;
  remaining: number;
  nextUnit: BlockUnit | null;
  isStarting: boolean;
  onOpen: (sessionId: string) => void;
  onStart: (dayId: string) => void;
}) {
  const activeBlockNumber = activeBlock
    ? blocks.findIndex((block) => block.id === activeBlock.id) + 1
    : null;
  return (
    <section
      data-slot="today-card"
      aria-labelledby="today-card-title"
      className="flex flex-col gap-6 rounded-xl border border-border bg-card p-5 md:p-6"
    >
      <div className="flex flex-col gap-1">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Сегодня
        </p>
        <h2 id="today-card-title" className="text-2xl font-semibold">
          День {day.order} · {day.title}
        </h2>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          {dayCompleted ? (
            "День завершён — отличная работа."
          ) : activeBlock ? (
            <>
              Блок {activeBlockNumber} из 3 · {activeBlock.label} · Осталось{" "}
              {formatDuration(remaining)}
            </>
          ) : (
            formatDuration(day.estimatedMinutes)
          )}
        </p>
      </div>

      <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="flex min-w-0 flex-col gap-2">
          {nextUnit ? (
            <div className="flex min-w-0 flex-col gap-1">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Следующий шаг
              </p>
              <p className="truncate font-medium">
                {nextUnit.title}
                <span className="ml-2 text-sm text-muted-foreground">
                  · около {formatMinutesShort(nextUnit.estimatedMinutes)}
                </span>
              </p>
            </div>
          ) : null}
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <ClockIcon aria-hidden className="size-4" />
            {formatDuration(day.estimatedMinutes)} на день
          </div>
        </div>

        <div className="flex shrink-0 flex-col gap-2 md:items-end">
          <Button
            type="button"
            size="lg"
            data-slot="today-cta"
            disabled={dayCompleted || isStarting}
            onClick={() =>
              day.sessionId ? onOpen(day.sessionId) : onStart(day.id)
            }
          >
            {isStarting
              ? "Создаю занятие…"
              : dayCompleted
                ? "День завершён"
                : day.sessionId
                  ? "Продолжить обучение"
                  : "Начать обучение"}
            {!dayCompleted ? <ArrowRightIcon aria-hidden /> : null}
          </Button>
        </div>
      </div>
    </section>
  );
}

function BlockCard({
  block,
  index,
  active,
}: {
  block: LearningBlock;
  index: number;
  active: boolean;
}) {
  const Icon = blockIcons[block.id];
  const colors = blockColorClasses[block.id];
  const timeText =
    block.status === "completed"
      ? formatMinutesShort(block.estimatedMinutes)
      : `Осталось ${formatMinutesShort(block.remainingMinutes)}`;
  return (
    <article
      data-slot="day-block"
      data-block={block.id}
      data-status={block.status}
      aria-current={active ? "step" : undefined}
      className={cn(
        "flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-5",
        active
          ? cn("border-primary/50 ring-1 ring-primary/20", colors.border)
          : "border-border",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <span
          className={cn(
            "grid size-10 shrink-0 place-items-center rounded-lg",
            colors.surface,
            colors.icon,
          )}
        >
          <Icon aria-hidden className="size-5" weight="fill" />
        </span>
        <Badge variant={block.status === "completed" ? "success" : "outline"}>
          {blockStatusLabels[block.status]}
        </Badge>
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Блок {index + 1} из 3
        </p>
        <h3 className="text-base font-semibold">{block.label}</h3>
        <p className="text-sm text-muted-foreground">
          {block.status === "completed"
            ? `${block.totalCount} ${pluralSteps(block.totalCount)} · ${timeText}`
            : block.currentUnit
              ? `Шаг ${block.currentStepIndex} из ${block.totalCount} · ${block.currentUnit.title}`
              : `${block.totalCount} ${pluralSteps(block.totalCount)}`}
        </p>
      </div>
      <div className="mt-auto flex items-center justify-between gap-3 pt-1 text-sm text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <ClockIcon aria-hidden className="size-4" />
          {timeText}
        </span>
      </div>
    </article>
  );
}

function DayCard({
  day,
  current,
  onOpen,
}: {
  day: LearningDay;
  current: boolean;
  onOpen: () => void;
}) {
  const completed = countCompletedUnits(day.units);
  const progress = day.units.length
    ? Math.round((completed / day.units.length) * 100)
    : 0;
  const DayStatusIcon = statusIcon(day.status);
  const locked = day.status === "locked";
  return (
    <li className="min-w-0">
      <button
        type="button"
        data-slot="week-day-card"
        data-status={day.status}
        onClick={onOpen}
        disabled={locked}
        aria-disabled={locked || undefined}
        className={cn(
          "flex w-full min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 text-left outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-ring",
          current
            ? "border-primary/50 ring-1 ring-primary/20"
            : "border-border hover:border-primary/40",
          locked && "cursor-not-allowed opacity-55",
        )}
      >
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid size-8 shrink-0 place-items-center rounded-full border border-border font-mono text-xs font-semibold">
              {String(day.order).padStart(2, "0")}
            </span>
            <div className="min-w-0">
              <p className="truncate font-medium">{day.title}</p>
              <p className="truncate text-xs text-muted-foreground">
                {day.goal}
              </p>
            </div>
          </div>
          <Badge variant={dayBadgeVariant(day.status)}>
            <DayStatusIcon aria-hidden className="size-3" />
            {dayStatusLabels[day.status]}
          </Badge>
        </div>
        <div className="flex items-center gap-3">
          <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
            <ClockIcon aria-hidden className="size-3.5" />
            {formatMinutesShort(day.estimatedMinutes)}
          </span>
          <Progress
            aria-label={`Прогресс дня ${day.order}`}
            value={progress}
            className="h-1.5"
          />
          <span className="shrink-0 font-mono text-xs text-muted-foreground">
            {progress}%
          </span>
        </div>
      </button>
    </li>
  );
}

function DayDetailSheetContent({
  day,
  isStarting,
  onOpen,
  onStart,
}: {
  day: LearningDay;
  isStarting: boolean;
  onOpen: (sessionId: string) => void;
  onStart: (dayId: string) => void;
}) {
  const completed = countCompletedUnits(day.units);
  const progress = day.units.length
    ? Math.round((completed / day.units.length) * 100)
    : 0;
  return (
    <>
      <SheetHeader>
        <SheetTitle>
          День {day.order} · {day.title}
        </SheetTitle>
        <SheetDescription>
          {dayStatusLabels[day.status]} ·{" "}
          {formatMinutesShort(day.estimatedMinutes)} · Глубина:{" "}
          {depthLabel(day.depthLevel)}
        </SheetDescription>
      </SheetHeader>

      <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {completed} из {day.units.length} шагов
            </span>
            <span className="font-mono">{progress}%</span>
          </div>
          <Progress aria-label={`Прогресс дня ${day.order}`} value={progress} />
        </div>

        <DetailSection title="Цель">
          <p className="text-sm leading-6 text-muted-foreground">{day.goal}</p>
        </DetailSection>

        <DetailSection title="Учебные блоки">
          <div className="flex flex-col gap-2">
            {groupDayIntoBlocks(day.units, (unit) => unit.status ?? "locked")
              .filter((block) => block.totalCount > 0)
              .map((block, index) => (
                <div
                  key={block.id}
                  className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"
                >
                  <span className="min-w-0 truncate">
                    Блок {index + 1} · {block.label}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {blockStatusLabels[block.status]} ·{" "}
                    {formatMinutesShort(block.estimatedMinutes)}
                  </span>
                </div>
              ))}
          </div>
        </DetailSection>

        <DetailSection title="Шаги">
          <ol className="flex flex-col gap-1.5">
            {day.units.map((unit) => (
              <li
                key={unit.id}
                data-slot="detail-unit"
                data-status={unit.status}
                className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"
              >
                <span className="min-w-0 truncate">
                  <span className="font-medium">{unit.title}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {unitTypeLabels[unit.type]} ·{" "}
                    {formatMinutesShort(unit.estimatedMinutes)}
                  </span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {unitStatusLabels[unit.status]}
                </span>
              </li>
            ))}
          </ol>
        </DetailSection>

        {day.expectedOutcomes.length ? (
          <DetailSection title="После занятия сможешь">
            <ul className="flex flex-col gap-1.5 text-sm leading-6 text-muted-foreground">
              {day.expectedOutcomes.map((outcome) => (
                <li key={outcome} className="flex gap-2">
                  <span
                    aria-hidden
                    className="mt-2 size-1.5 shrink-0 rounded-full bg-primary"
                  />
                  {outcome}
                </li>
              ))}
            </ul>
          </DetailSection>
        ) : null}

        {day.topics.length ? (
          <DetailSection title="Темы">
            <div className="flex flex-wrap gap-2">
              {day.topics.map((topic) => (
                <Badge key={topic} variant="outline">
                  {topic}
                </Badge>
              ))}
            </div>
          </DetailSection>
        ) : null}

        {day.outOfScope.length ? (
          <DetailSection title="Не входит в день">
            <p className="text-sm leading-6 text-muted-foreground">
              {day.outOfScope.join(" · ")}
            </p>
          </DetailSection>
        ) : null}
      </div>

      <SheetFooter>
        {day.status === "completed" ? (
          <p className="text-sm text-muted-foreground">День пройден.</p>
        ) : day.status === "locked" ? (
          <p className="text-sm text-muted-foreground">
            <LockKeyIcon aria-hidden className="mr-1 inline size-4" />
            Сначала заверши предыдущий день.
          </p>
        ) : (
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
                ? "Продолжить обучение"
                : "Начать обучение"}
            <ArrowRightIcon aria-hidden />
          </Button>
        )}
      </SheetFooter>
    </>
  );
}

function DetailSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">{title}</h3>
      {children}
    </section>
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

function pluralSteps(count: number): string {
  const abs = Math.abs(count) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return "шагов";
  if (last > 1 && last < 5) return "шага";
  if (last === 1) return "шаг";
  return "шагов";
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
