"use client";

import {
  ArrowRightIcon,
  CheckCircleIcon,
  LockKeyIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { type LearningDay, learningPathSchema } from "@/lib/learning-path";
import { PageHeader } from "@/components/page-header";
import { EmptyState, QueryError } from "@/components/query-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import {
  focusedUnit,
  groupDayIntoBlocks,
  remainingDayMinutes,
  type LearningBlock,
} from "@/lib/learning-blocks";
import { type MessageKey, useI18n } from "@/lib/i18n";

const phaseLabels: Readonly<Record<LearningBlock["id"], MessageKey>> = {
  study: "home.phase.study",
  check: "home.phase.check",
  practice: "home.phase.practice",
};
const phaseStatusLabels: Readonly<Record<LearningBlock["status"], MessageKey>> =
  {
    completed: "home.phase.complete",
    in_progress: "home.phase.current",
    ready: "home.phase.ready",
    locked: "home.phase.locked",
  };

export function HomeClient({
  pathEndpoint = "/learning/path",
  selectionTarget,
}: {
  pathEndpoint?: string;
  selectionTarget?: { courseId: string; revisionId: string };
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const query = useQuery({
    queryKey: ["learning-path", pathEndpoint],
    queryFn: async () => learningPathSchema.parse(await api(pathEndpoint)),
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
      router.push(`/session?id=${encodeURIComponent(session.id)}`);
    },
  });
  const selectCourse = useMutation({
    mutationFn: async () => {
      if (!selectionTarget)
        throw new Error("Course selection target is missing");
      return api(
        `/learning/courses/${encodeURIComponent(selectionTarget.courseId)}/select`,
        {
          method: "POST",
          body: JSON.stringify({
            revisionId: selectionTarget.revisionId,
            operationId: globalThis.crypto.randomUUID(),
          }),
        },
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["learning-path"] });
    },
  });

  if (query.isLoading) {
    return (
      <div role="status" aria-label={t("home.loading")} className="grid gap-6">
        <span className="sr-only">{t("home.loading")}</span>
        <Skeleton className="h-24" />
        <Skeleton className="h-52" />
        <Skeleton className="h-48" />
      </div>
    );
  }
  if (query.isError || !query.data) {
    return (
      <QueryError
        message={
          query.error instanceof Error
            ? query.error.message
            : t("home.unavailable")
        }
        retry={() => void query.refetch()}
      />
    );
  }

  const course = query.data.curriculum;
  if (!course) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title={t("nav.home")}
          description={t("page.home.description")}
        />
        <EmptyState
          title={t("home.noCourse.title")}
          description={t("home.noCourse.description")}
          action={
            <Button asChild>
              <Link href="/courses">{t("home.openCourses")}</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const days = course.weeks.flatMap((week) => week.days);
  const currentDay =
    days.find((day) => day.status === "in_progress") ??
    days.find((day) => day.status === "available") ??
    null;
  const blocks = currentDay
    ? groupDayIntoBlocks(currentDay.units, (unit) => unit.status ?? "locked")
    : [];
  const nextUnit = currentDay
    ? focusedUnit(currentDay.units, (unit) => unit.status ?? "locked")
    : null;
  const remaining = remainingDayMinutes(blocks);
  const upcoming = currentDay
    ? days.filter((day) => day.order > currentDay.order).slice(0, 4)
    : [];

  return (
    <div data-slot="home" className="flex flex-col gap-8">
      <PageHeader
        title={course.title}
        description={course.description ?? t("home.defaultCourseDescription")}
      />
      {selectionTarget && !query.data.courseContext?.selected ? (
        <section className="flex flex-col gap-4 rounded-xl border border-primary/30 bg-primary/5 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-semibold">{t("home.selectCourse.title")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("home.selectCourse.description")}
            </p>
          </div>
          <Button
            type="button"
            disabled={selectCourse.isPending}
            onClick={() => selectCourse.mutate()}
          >
            {selectCourse.isPending
              ? t("home.selectCourse.selecting")
              : t("home.selectCourse.action")}
          </Button>
        </section>
      ) : null}
      {selectCourse.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {selectCourse.error instanceof Error
            ? selectCourse.error.message
            : t("home.selectCourse.error")}
        </p>
      ) : null}
      {start.isError ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"
        >
          {start.error instanceof Error
            ? start.error.message
            : t("home.startError")}
        </p>
      ) : null}
      {currentDay ? (
        <section
          aria-labelledby="next-action-title"
          className="grid gap-6 rounded-xl border border-border bg-card p-5 sm:p-6 lg:grid-cols-[1fr_auto] lg:items-end"
        >
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-[0.12em] text-primary">
              {t("home.nextAction")}
            </p>
            <h2
              id="next-action-title"
              className="mt-2 text-2xl font-semibold tracking-[-0.025em]"
            >
              {t("home.lesson", { number: currentDay.order })} ·{" "}
              {currentDay.title}
            </h2>
            <p className="mt-2 max-w-[70ch] text-sm leading-6 text-muted-foreground">
              {nextUnit?.title ?? currentDay.goal}
            </p>
            <p className="mt-3 text-xs text-muted-foreground">
              {currentDay.sessionId
                ? t("home.remaining", { minutes: remaining })
                : t("home.estimated", { minutes: currentDay.estimatedMinutes })}
            </p>
          </div>
          <Button
            size="lg"
            disabled={
              start.isPending ||
              (selectionTarget !== undefined &&
                !query.data.courseContext?.selected)
            }
            onClick={() =>
              currentDay.sessionId
                ? router.push(
                    `/session?id=${encodeURIComponent(currentDay.sessionId)}`,
                  )
                : start.mutate(currentDay.id)
            }
          >
            {start.isPending
              ? t("home.starting")
              : currentDay.sessionId
                ? t("home.resume")
                : t("home.start")}
            <ArrowRightIcon aria-hidden />
          </Button>
        </section>
      ) : (
        <EmptyState
          title={t("home.complete")}
          description={t("review.empty.description")}
          action={
            <Button asChild variant="outline">
              <Link href="/review">{t("nav.review")}</Link>
            </Button>
          }
        />
      )}
      {blocks.length > 0 ? (
        <section aria-labelledby="learning-phases-title">
          <h2
            id="learning-phases-title"
            className="border-b border-border pb-3 text-lg font-semibold"
          >
            {t("home.phases")}
          </h2>
          <ol className="divide-y divide-border">
            {blocks.map((block) => (
              <li
                key={block.id}
                className="grid min-h-16 grid-cols-[auto_1fr_auto] items-center gap-3 py-3"
              >
                <span className="grid size-8 place-items-center rounded-full border border-border bg-background">
                  {block.status === "completed" ? (
                    <CheckCircleIcon
                      aria-hidden
                      className="size-4 text-success-foreground"
                      weight="fill"
                    />
                  ) : block.status === "locked" ? (
                    <LockKeyIcon
                      aria-hidden
                      className="size-4 text-muted-foreground"
                    />
                  ) : (
                    <span
                      aria-hidden
                      className="size-2 rounded-full bg-primary"
                    />
                  )}
                </span>
                <div className="min-w-0">
                  <h3 className="font-medium">{t(phaseLabels[block.id])}</h3>
                  <p className="text-xs text-muted-foreground">
                    {t("home.phase.progress", {
                      complete: block.completedCount,
                      total: block.totalCount,
                    })}
                  </p>
                </div>
                <Badge
                  variant={block.status === "completed" ? "success" : "outline"}
                >
                  {t(phaseStatusLabels[block.status])}
                </Badge>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
      {upcoming.length > 0 ? (
        <section aria-labelledby="upcoming-title">
          <h2
            id="upcoming-title"
            className="border-b border-border pb-3 text-lg font-semibold"
          >
            {t("home.upcoming")}
          </h2>
          <ol className="divide-y divide-border">
            {upcoming.map((day) => (
              <UpcomingLesson key={day.id} day={day} />
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}
function UpcomingLesson({ day }: { day: LearningDay }) {
  const { t } = useI18n();
  return (
    <li className="grid grid-cols-[1fr_auto] gap-4 py-4">
      <div className="min-w-0">
        <p className="truncate font-medium">
          {t("home.lesson", { number: day.order })} · {day.title}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("home.estimated", { minutes: day.estimatedMinutes })}
        </p>
      </div>
      <span className="self-center text-xs text-muted-foreground">
        {day.status === "locked" ? t("home.locked") : t("home.completed")}
      </span>
    </li>
  );
}
