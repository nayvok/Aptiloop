"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import {
  ArrowRightIcon,
  BookOpenTextIcon,
  BrainIcon,
  ClockIcon,
  CodeIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";

import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/page-header";
import { QueryError } from "@/components/query-state";

type Dashboard = {
  week: {
    number: number;
    title: string;
    days: Array<{
      dayNumber: number;
      title: string;
      status: "completed" | "today" | "upcoming";
    }>;
  };
  today: {
    dayNumber: number;
    title: string;
    description: string;
    topics: string[];
    estimatedMinutes: number;
    progress: number;
    sessionId?: string;
  };
  stats: { mastery: number; unfinishedExercises: number; cardsDue: number };
  reviewTopics: Array<{ id: string; title: string; reason: string }>;
  recentMistakes: Array<{
    id: string;
    title: string;
    detail: string;
    createdAt: string;
  }>;
};

export function DashboardClient() {
  const router = useRouter();
  const query = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api<Dashboard>("/dashboard"),
  });
  const start = useMutation({
    mutationFn: () =>
      api<{ id: string }>("/learning/sessions", {
        method: "POST",
        body: JSON.stringify({ dayNumber: query.data?.today.dayNumber ?? 1 }),
      }),
    onSuccess: ({ id }) => router.push(`/session?id=${id}`),
  });

  if (query.isLoading) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-20" />
        <Skeleton className="h-72" />
        <Skeleton className="h-52" />
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

  const data = query.data;
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={`Неделя ${data.week.number}: ${data.week.title}`}
        description="Сегодня важна не скорость: сначала сформулируй ответ без подсказок, затем используй Teacher как проверку мышления."
        actions={
          <Badge variant="outline">
            <ClockIcon aria-hidden /> 3 часа
          </Badge>
        }
      />

      <section
        aria-labelledby="today-title"
        className="grid gap-6 lg:grid-cols-[minmax(0,1.55fr)_minmax(280px,0.7fr)]"
      >
        <div className="flex flex-col justify-between gap-8 rounded-xl bg-foreground p-6 text-background md:p-8">
          <div className="flex flex-col gap-5">
            <div className="flex items-center justify-between gap-4">
              <Badge className="bg-background/12 text-background">
                День {data.today.dayNumber}
              </Badge>
              <span className="font-mono text-xs text-background/70">
                {data.today.estimatedMinutes} мин
              </span>
            </div>
            <div className="flex max-w-2xl flex-col gap-3">
              <h3
                id="today-title"
                className="text-balance text-3xl font-semibold tracking-[-0.035em] md:text-4xl"
              >
                {data.today.title}
              </h3>
              <p className="max-w-[65ch] text-pretty text-sm leading-6 text-background/75">
                {data.today.description}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {data.today.topics.slice(0, 6).map((topic) => (
                <span
                  key={topic}
                  className="rounded-full border border-background/20 px-2.5 py-1 text-xs text-background/80"
                >
                  {topic}
                </span>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-48 flex-1 items-center gap-3">
              <Progress
                aria-label="Прогресс занятия"
                value={data.today.progress}
                className="bg-background/15 [&_[data-slot=progress-indicator]]:bg-background"
              />
              <span className="font-mono text-xs text-background/70">
                {data.today.progress}%
              </span>
            </div>
            <Button
              disabled={start.isPending}
              onClick={() =>
                data.today.sessionId
                  ? router.push(`/session?id=${data.today.sessionId}`)
                  : start.mutate()
              }
              className="bg-background text-foreground hover:bg-background/90"
            >
              {start.isPending
                ? "Создаю занятие…"
                : data.today.sessionId
                  ? "Продолжить"
                  : "Начать занятие"}
              <ArrowRightIcon aria-hidden />
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-border bg-border lg:grid-cols-1">
          {[
            {
              label: "Среднее владение",
              value: data.stats.mastery.toFixed(1),
              icon: BrainIcon,
            },
            {
              label: "Незавершённая практика",
              value: data.stats.unfinishedExercises,
              icon: CodeIcon,
            },
            {
              label: "Карточки к повторению",
              value: data.stats.cardsDue,
              icon: BookOpenTextIcon,
            },
          ].map((stat) => (
            <div
              key={stat.label}
              className="flex min-w-0 flex-col gap-3 bg-card p-4 lg:flex-row lg:items-center"
            >
              <stat.icon aria-hidden className="size-5 shrink-0 text-primary" />
              <div className="min-w-0">
                <p className="font-mono text-xl font-semibold">{stat.value}</p>
                <p className="text-xs leading-5 text-muted-foreground">
                  {stat.label}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section aria-label="Неделя" className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Маршрут недели</h3>
          <span className="text-xs text-muted-foreground">7 учебных дней</span>
        </div>
        <ol className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-7">
          {data.week.days.map((day) => (
            <li
              key={day.dayNumber}
              className="flex min-w-0 flex-col gap-2 bg-card p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-xs text-muted-foreground">
                  {String(day.dayNumber).padStart(2, "0")}
                </span>
                <span
                  className={`size-2 rounded-full ${day.status === "completed" ? "bg-success" : day.status === "today" ? "bg-primary" : "bg-border"}`}
                />
              </div>
              <p className="truncate text-xs font-medium" title={day.title}>
                {day.title}
              </p>
            </li>
          ))}
        </ol>
      </section>

      <section className="grid gap-8 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <div>
            <h3 className="font-semibold">Повторить до новой темы</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Темы выбраны по давности и недавним ошибкам.
            </p>
          </div>
          <div className="divide-y divide-border border-y border-border">
            {data.reviewTopics.map((topic) => (
              <div key={topic.id} className="flex items-start gap-3 py-4">
                <BrainIcon
                  aria-hidden
                  className="mt-0.5 size-4 shrink-0 text-primary"
                />
                <div>
                  <p className="text-sm font-medium">{topic.title}</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {topic.reason}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-4">
          <div>
            <h3 className="font-semibold">Последние ошибки</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Формулировки, которые стоит проверить ещё раз.
            </p>
          </div>
          {data.recentMistakes.length ? (
            <div className="divide-y divide-border border-y border-border">
              {data.recentMistakes.map((mistake) => (
                <div key={mistake.id} className="flex items-start gap-3 py-4">
                  <WarningCircleIcon
                    aria-hidden
                    className="mt-0.5 size-4 shrink-0 text-warning"
                  />
                  <div>
                    <p className="text-sm font-medium">{mistake.title}</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      {mistake.detail}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              Журнал заполнится после первых ответов.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
