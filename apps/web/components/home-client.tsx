"use client";

import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CaretDownIcon,
  CheckCircleIcon,
  CircleIcon,
  LockKeyIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { toast } from "sonner";

import { usePageRouteContext } from "@/components/page-route-context";
import {
  type LearningDay,
  type LearningPath,
  learningPathSchema,
} from "@/lib/learning-path";
import { PageHeader } from "@/components/page-header";
import { EmptyState, QueryError } from "@/components/query-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LoadingState } from "@/components/ui/loading-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { api } from "@/lib/api";
import {
  blockForUnitType,
  groupDayIntoBlocks,
  remainingDayMinutes,
  type LearningBlock,
} from "@/lib/learning-blocks";
import { learningCourseCollectionSchema } from "@/lib/learning-courses";
import { type MessageKey, useI18n } from "@/lib/i18n";
import type { RouteContext } from "@/lib/route-context";
import {
  type UnitStatus,
  unitStatusMessageKeys,
  unitTypeMessageKeys,
} from "@/lib/unit-labels";

type LearningCourse = NonNullable<LearningPath["curriculum"]>;
type RoadmapStatus =
  LearningDay["status"] | LearningBlock["status"] | UnitStatus;
type RevisionRoadmapAction =
  | {
      kind: "continue";
      day: LearningDay;
      sessionId: string;
      currentUnit: LearningDay["units"][number] | null;
    }
  | {
      kind: "start";
      day: LearningDay;
      currentUnit: LearningDay["units"][number] | null;
    };

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
const dayStatusLabels: Readonly<Record<LearningDay["status"], MessageKey>> = {
  completed: "home.completed",
  in_progress: "home.phase.current",
  available: "home.phase.ready",
  locked: "home.locked",
};

export function HomeClient({
  surface = "home",
  pathEndpoint = "/learning/path",
  selectionTarget,
}: {
  surface?: "home" | "revision";
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
  const isRevisionPreview = surface === "revision";
  const courseCollection = useQuery({
    queryKey: ["learning-courses"],
    queryFn: async () =>
      learningCourseCollectionSchema.parse(
        await api<unknown>("/learning/courses"),
      ),
    enabled:
      !isRevisionPreview && query.isSuccess && query.data.curriculum === null,
    retry: false,
  });
  const routeCourse = query.data?.curriculum ?? null;
  const pageRouteContext = useMemo<RouteContext | null>(
    () =>
      isRevisionPreview && routeCourse
        ? {
            sectionHref: "/courses",
            breadcrumbs: [
              { href: "/courses", label: "nav.courses" },
              {
                text: `${routeCourse.title} · ${t(
                  "courses.library.revisionNumber",
                  { revision: routeCourse.version.revision },
                )}`,
              },
            ],
          }
        : null,
    [isRevisionPreview, routeCourse, t],
  );
  usePageRouteContext(pageRouteContext);
  const surfaceSlot = isRevisionPreview ? "course-revision-preview" : "home";
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
    onError: () => toast.error(t("home.startError")),
  });
  const selectCourse = useMutation({
    mutationFn: async () => {
      if (!selectionTarget) throw new Error("missing-selection-target");
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
    onError: () => toast.error(t("home.selectCourse.error")),
  });

  if (query.isLoading) {
    if (!isRevisionPreview) {
      return (
        <div data-slot="home" className="flex flex-col gap-6 lg:gap-8">
          <HomePageHeader />
          <LoadingState label="home.loading" variant="page" />
        </div>
      );
    }

    return (
      <div data-slot={surfaceSlot} className="flex flex-col gap-6 lg:gap-8">
        <RevisionPageHeader />
        <div
          role="status"
          aria-label={t("authoring.loading.versions")}
          className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6"
        >
          <span className="sr-only">{t("authoring.loading.versions")}</span>
          <div
            className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-5 rounded-panel bg-surface-soft/70 p-5 sm:p-6"
            aria-hidden
          >
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-8 w-80 max-w-[90%]" />
            <Skeleton className="h-4 w-full max-w-xl" />
            <Skeleton className="h-2 w-full max-w-xl" />
            <div className="grid grid-cols-[minmax(0,1fr)] gap-4 pt-2 sm:grid-cols-3">
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
            </div>
          </div>
          <div aria-hidden className="grid min-w-0 gap-2 sm:grid-cols-3">
            <Skeleton className="h-14 rounded-control" />
            <Skeleton className="h-14 rounded-control" />
            <Skeleton className="h-14 rounded-control" />
          </div>
        </div>
      </div>
    );
  }
  if (query.isError || !query.data) {
    if (isRevisionPreview) {
      return (
        <RevisionFailureState
          {...(query.error instanceof Error
            ? { diagnostic: query.error.message }
            : {})}
          retry={() => void query.refetch()}
        />
      );
    }
    return (
      <div data-slot="home" className="flex flex-col gap-6 lg:gap-8">
        <HomePageHeader />
        <QueryError
          message={t("home.unavailable")}
          {...(query.error instanceof Error
            ? { diagnostic: query.error.message }
            : {})}
          retry={() => void query.refetch()}
        />
      </div>
    );
  }

  const course = query.data.curriculum;
  if (!course) {
    if (isRevisionPreview) {
      return <RevisionMissingState retry={() => void query.refetch()} />;
    }
    if (courseCollection.isLoading) {
      return (
        <div data-slot="home" className="flex flex-col gap-6 lg:gap-8">
          <HomePageHeader />
          <LoadingState label="home.loadingCourses" variant="page" />
        </div>
      );
    }
    if (courseCollection.isError || !courseCollection.data) {
      return (
        <div data-slot="home" className="flex flex-col gap-6 lg:gap-8">
          <HomePageHeader />
          <QueryError
            message={t("home.coursesUnavailable")}
            {...(courseCollection.error instanceof Error
              ? { diagnostic: courseCollection.error.message }
              : {})}
            retry={() => void courseCollection.refetch()}
          />
        </div>
      );
    }
    const hasLocalCourses = courseCollection.data.courses.length > 0;
    return (
      <div className="flex flex-col gap-6">
        <HomePageHeader />
        <EmptyState
          title={t(
            hasLocalCourses ? "home.noCourse.title" : "home.noCourses.title",
          )}
          description={t(
            hasLocalCourses
              ? "home.noCourse.description"
              : "home.noCourses.description",
          )}
          action={
            <div className="flex w-full flex-col justify-center gap-2 sm:w-auto sm:flex-row sm:flex-wrap">
              {hasLocalCourses ? (
                <Button asChild className="w-full sm:w-auto">
                  <Link href="/courses#course-library-title">
                    {t("home.chooseCourse")}
                  </Link>
                </Button>
              ) : null}
              <Button
                asChild
                variant={hasLocalCourses ? "secondary" : "default"}
                className="w-full sm:w-auto"
              >
                <Link href="/courses/new">{t("home.createCourse")}</Link>
              </Button>
              <Button asChild variant="outline" className="w-full sm:w-auto">
                <Link href="/courses/import">{t("home.importCoursePack")}</Link>
              </Button>
            </div>
          }
        />
      </div>
    );
  }

  if (
    isRevisionPreview &&
    (!selectionTarget ||
      !query.data.courseContext ||
      query.data.courseContext.courseId !== selectionTarget.courseId ||
      query.data.courseContext.revisionId !== selectionTarget.revisionId ||
      course.id !== selectionTarget.courseId ||
      course.version.id !== selectionTarget.revisionId)
  ) {
    return <RevisionFailureState retry={() => void query.refetch()} />;
  }

  const days = course.weeks.flatMap((week) => week.days);
  const completedDays = days.filter((day) => day.status === "completed").length;
  const requiresSelection =
    selectionTarget !== undefined && !query.data.courseContext?.selected;
  const roadmapAction = resolveRevisionRoadmapAction(
    query.data.nextAction,
    days,
  );

  if (isRevisionPreview) {
    return (
      <RevisionRoadmapView
        course={course}
        days={days}
        action={roadmapAction}
        completedDays={completedDays}
        requiresSelection={requiresSelection}
        selecting={selectCourse.isPending}
        continuing={start.isPending}
        onSelect={() => selectCourse.mutate()}
        onAction={() => {
          if (!roadmapAction) return;
          if (roadmapAction.kind === "continue") {
            router.push(
              `/session?id=${encodeURIComponent(roadmapAction.sessionId)}`,
            );
            return;
          }
          start.mutate(roadmapAction.day.id);
        }}
      />
    );
  }

  const currentDay = roadmapAction?.day ?? null;
  const blocks = currentDay
    ? groupDayIntoBlocks(currentDay.units, (unit) => unit.status ?? "locked")
    : [];
  const nextUnit = roadmapAction?.currentUnit ?? null;
  const currentBlock = nextUnit
    ? (blocks.find((block) =>
        block.units.some((unit) => unit.id === nextUnit.id),
      ) ?? null)
    : null;
  const remaining = remainingDayMinutes(blocks);
  const completedUnits = blocks.reduce(
    (total, block) => total + block.completedCount,
    0,
  );
  const totalUnits = blocks.reduce(
    (total, block) => total + block.totalCount,
    0,
  );
  const upcoming = currentDay
    ? days.filter((day) => day.order > currentDay.order).slice(0, 4)
    : [];

  return (
    <div
      data-slot={surfaceSlot}
      className="@container/home flex flex-col gap-6 lg:gap-8"
    >
      {isRevisionPreview ? (
        <RevisionPageHeader
          title={course.title}
          description={course.description ?? t("courses.library.selectHelp")}
        />
      ) : (
        <div
          data-slot="home-course-header"
          className="flex min-w-0 flex-col gap-2 [overflow-wrap:anywhere]"
        >
          <p className="text-sm font-medium text-muted-foreground">
            {t("home.currentCourse")}
          </p>
          <PageHeader
            title={course.title}
            description={
              course.description ?? t("home.defaultCourseDescription")
            }
            actions={
              <Button asChild variant="outline">
                <Link href="/courses#course-library-title">
                  {t("home.switchCourse")}
                </Link>
              </Button>
            }
          />
        </div>
      )}

      {requiresSelection ? (
        <section
          data-slot="course-selection-callout"
          className="flex min-w-0 flex-col gap-4 rounded-panel bg-surface-soft/75 p-5 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="min-w-0">
            <h2 className="font-semibold">{t("home.selectCourse.title")}</h2>
            <p className="mt-1 max-w-[65ch] text-sm leading-6 text-muted-foreground">
              {t("home.selectCourse.description")}
            </p>
          </div>
          <Button
            data-slot="home-primary-action"
            type="button"
            className="w-full shrink-0 sm:w-auto"
            disabled={selectCourse.isPending}
            onClick={() => selectCourse.mutate()}
          >
            {selectCourse.isPending
              ? t("home.selectCourse.selecting")
              : t("home.selectCourse.action")}
          </Button>
        </section>
      ) : null}

      {currentDay ? (
        <section
          aria-labelledby="next-action-title"
          className="flex min-w-0 flex-col gap-5 rounded-panel bg-surface-soft/70 p-5 sm:p-6"
        >
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
              <p className="text-xs font-semibold tracking-wide text-primary">
                {t("home.nextAction")}
              </p>
              <h2
                id="next-action-title"
                className="mt-2 text-2xl font-semibold leading-tight tracking-[-0.025em] sm:text-[1.75rem]"
              >
                {t("home.lesson", { number: currentDay.order })} ·{" "}
                {currentDay.title}
              </h2>
              <p className="mt-2 max-w-[76ch] text-sm leading-6 text-muted-foreground">
                {nextUnit?.title ?? currentDay.goal}
              </p>
              {totalUnits > 0 ? (
                <div className="mt-5 w-full">
                  <div className="mb-2 flex items-center justify-between gap-4 text-xs">
                    <span className="font-medium">
                      {t("home.focus.lessonProgress")}
                    </span>
                    <span className="text-muted-foreground">
                      {t("home.phase.progress", {
                        complete: completedUnits,
                        total: totalUnits,
                      })}
                    </span>
                  </div>
                  <Progress
                    value={completedUnits}
                    max={totalUnits}
                    aria-label={t("home.focus.lessonProgress")}
                    aria-valuetext={t("home.phase.progress", {
                      complete: completedUnits,
                      total: totalUnits,
                    })}
                  />
                </div>
              ) : null}
            </div>
            <Button
              data-slot={requiresSelection ? undefined : "home-primary-action"}
              size="lg"
              variant={requiresSelection ? "secondary" : "default"}
              className="w-full shrink-0 sm:w-auto"
              disabled={start.isPending || requiresSelection}
              onClick={() => {
                if (roadmapAction?.kind === "continue") {
                  router.push(
                    `/session?id=${encodeURIComponent(roadmapAction.sessionId)}`,
                  );
                  return;
                }
                if (roadmapAction?.kind === "start") {
                  start.mutate(roadmapAction.day.id);
                }
              }}
            >
              {start.isPending
                ? t("home.starting")
                : roadmapAction?.kind === "continue"
                  ? t("home.resume")
                  : t("home.start")}
              <ArrowRightIcon data-icon="inline-end" aria-hidden />
            </Button>
          </div>

          <dl className="grid gap-2 sm:grid-cols-3">
            <div className="min-w-0 rounded-control bg-background/70 px-4 py-3">
              <dt className="text-xs text-muted-foreground">
                {t("home.focus.time")}
              </dt>
              <dd className="mt-1 text-sm font-medium">
                {roadmapAction?.kind === "continue"
                  ? t("home.remaining", { minutes: remaining })
                  : t("home.estimated", {
                      minutes: currentDay.estimatedMinutes,
                    })}
              </dd>
            </div>
            <div className="min-w-0 rounded-control bg-background/70 px-4 py-3">
              <dt className="text-xs text-muted-foreground">
                {t("home.focus.courseProgress")}
              </dt>
              <dd className="mt-1 text-sm font-medium">
                {t("home.courseProgress", {
                  complete: completedDays,
                  total: days.length,
                })}
              </dd>
            </div>
            {currentBlock ? (
              <div className="min-w-0 rounded-control bg-background/70 px-4 py-3">
                <dt className="text-xs text-muted-foreground">
                  {t("home.focus.phase")}
                </dt>
                <dd className="mt-1 text-sm font-medium">
                  {t(phaseLabels[currentBlock.id])} ·{" "}
                  {t(phaseStatusLabels[currentBlock.status])}
                </dd>
              </div>
            ) : null}
          </dl>
        </section>
      ) : (
        <EmptyState
          title={t(
            days.length > 0 && days.every((day) => day.status === "completed")
              ? "home.complete"
              : "courses.current.revisionUnavailable",
          )}
          description={
            days.length > 0 && days.every((day) => day.status === "completed")
              ? t("review.empty.description")
              : t("courses.library.selectionUnknownHelp")
          }
          action={
            <Button asChild variant="outline">
              <Link href="/review">{t("nav.review")}</Link>
            </Button>
          }
        />
      )}

      {blocks.length > 0 ? (
        <section
          data-slot="home-learning-phases"
          aria-labelledby="learning-phases-title"
          className="min-w-0"
        >
          <h2 id="learning-phases-title" className="pb-3 text-lg font-semibold">
            {t("home.phases")}
          </h2>
          <ol
            data-slot="home-phase-list"
            className="grid gap-2 @min-[68rem]/home:grid-cols-3"
          >
            {blocks.map((block) => (
              <li
                key={block.id}
                className="flex min-h-16 items-center gap-3 rounded-control bg-surface-soft/55 px-4 py-3"
              >
                <span className="grid size-8 shrink-0 place-items-center">
                  {block.status === "completed" ? (
                    <CheckCircleIcon
                      aria-hidden
                      className="text-success-foreground"
                      weight="fill"
                    />
                  ) : block.status === "locked" ? (
                    <LockKeyIcon
                      aria-hidden
                      className="text-muted-foreground"
                    />
                  ) : (
                    <span
                      aria-hidden
                      className="size-2 rounded-full bg-primary"
                    />
                  )}
                </span>
                <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-medium">{t(phaseLabels[block.id])}</h3>
                    <p className="text-xs leading-5 text-muted-foreground">
                      {t("home.phase.progress", {
                        complete: block.completedCount,
                        total: block.totalCount,
                      })}
                    </p>
                  </div>
                  <Badge
                    className="w-fit shrink-0"
                    variant={
                      block.status === "completed" ? "success" : "outline"
                    }
                  >
                    {t(phaseStatusLabels[block.status])}
                  </Badge>
                </div>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {upcoming.length > 0 ? (
        <section data-slot="home-upcoming" aria-labelledby="upcoming-title">
          <h2 id="upcoming-title" className="pb-2 text-lg font-semibold">
            {t("home.upcoming")}
          </h2>
          <ol
            data-slot="home-upcoming-list"
            className="grid gap-2 @min-[48rem]/home:grid-cols-2"
          >
            {upcoming.map((day) => (
              <UpcomingLesson key={day.id} day={day} />
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}

function HomePageHeader() {
  const { t } = useI18n();
  return (
    <PageHeader
      title={t("nav.home")}
      description={t("page.home.description")}
    />
  );
}

function RevisionPageHeader({
  title,
  description,
  revision,
  current = false,
}: {
  title?: string;
  description?: string;
  revision?: number;
  current?: boolean;
}) {
  const { t } = useI18n();
  const eyebrow =
    revision === undefined
      ? t("courses.action.previewRevision")
      : t(
          current
            ? "courses.revisionSurface.current"
            : "courses.revisionSurface.preview",
          { revision },
        );
  return (
    <div
      data-slot="course-revision-preview-header"
      className="flex min-w-0 flex-col gap-2 [overflow-wrap:anywhere]"
    >
      {title ? (
        <p className="text-sm font-medium text-muted-foreground">{eyebrow}</p>
      ) : null}
      <PageHeader
        title={title ?? t("courses.action.previewRevision")}
        description={description ?? t("courses.library.selectHelp")}
        actions={<BackToCourses />}
      />
    </div>
  );
}

function BackToCourses() {
  const { t } = useI18n();
  return (
    <Button asChild variant="outline">
      <Link href="/courses">
        <ArrowLeftIcon data-icon="inline-start" aria-hidden />
        {t("review.goToCourses")}
      </Link>
    </Button>
  );
}

function RevisionFailureState({
  diagnostic,
  retry,
}: {
  diagnostic?: string;
  retry: () => void;
}) {
  const { t } = useI18n();
  return (
    <div
      data-slot="course-revision-preview"
      className="flex flex-col gap-6 lg:gap-8"
    >
      <RevisionPageHeader />
      <div data-slot="course-revision-preview-error">
        <QueryError
          title={t("courses.current.revisionUnavailable")}
          message={t("courses.library.selectionUnknownHelp")}
          {...(diagnostic ? { diagnostic } : {})}
          retry={retry}
        />
      </div>
    </div>
  );
}

function RevisionMissingState({ retry }: { retry: () => void }) {
  const { t } = useI18n();
  return (
    <div
      data-slot="course-revision-preview"
      className="flex flex-col gap-6 lg:gap-8"
    >
      <RevisionPageHeader />
      <EmptyState
        title={t("authoring.missingRevision.title")}
        description={t("courses.current.unavailableDescription")}
        action={
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <Button type="button" onClick={retry}>
              {t("query.retry")}
            </Button>
          </div>
        }
      />
    </div>
  );
}

function resolveRevisionRoadmapAction(
  nextAction: LearningPath["nextAction"],
  days: readonly LearningDay[],
): RevisionRoadmapAction | null {
  if (nextAction === null) return null;
  const day = days.find((candidate) => candidate.id === nextAction.lessonId);
  if (!day) return null;
  if (nextAction.type === "start") {
    return { kind: "start", day, currentUnit: null };
  }
  const currentUnit = day.units.find(
    (unit) => unit.stableId === nextAction.currentStep,
  );
  if (!currentUnit) return null;
  return {
    kind: "continue",
    day,
    sessionId: nextAction.sessionId,
    currentUnit,
  };
}

function RevisionRoadmapView({
  course,
  days,
  action,
  completedDays,
  requiresSelection,
  selecting,
  continuing,
  onSelect,
  onAction,
}: {
  course: LearningCourse;
  days: LearningDay[];
  action: RevisionRoadmapAction | null;
  completedDays: number;
  requiresSelection: boolean;
  selecting: boolean;
  continuing: boolean;
  onSelect: () => void;
  onAction: () => void;
}) {
  const { t } = useI18n();
  const currentUnitId = action?.currentUnit?.id ?? null;
  const currentBlockId = action?.currentUnit
    ? blockForUnitType(action.currentUnit.type)
    : null;
  return (
    <div
      data-slot="course-revision-preview"
      className="flex min-w-0 flex-col gap-6 lg:gap-8"
    >
      <RevisionPageHeader
        title={course.title}
        description={course.description ?? t("courses.library.selectHelp")}
        revision={course.version.revision}
        current={!requiresSelection}
      />

      {requiresSelection ? (
        <section
          data-slot="course-selection-callout"
          className="flex min-w-0 flex-col gap-4 rounded-panel bg-surface-soft/75 p-5 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="min-w-0">
            <h2 className="font-semibold">{t("home.selectCourse.title")}</h2>
            <p className="mt-1 max-w-[65ch] text-sm leading-6 text-muted-foreground">
              {t("home.selectCourse.description")}
            </p>
          </div>
          <Button
            type="button"
            className="w-full shrink-0 sm:w-auto"
            disabled={selecting}
            onClick={onSelect}
          >
            {selecting
              ? t("home.selectCourse.selecting")
              : t("home.selectCourse.action")}
          </Button>
        </section>
      ) : null}

      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(18rem,23rem)] xl:items-start xl:gap-8">
        <RevisionContextRail
          course={course}
          days={days}
          action={action}
          completedDays={completedDays}
          requiresSelection={requiresSelection}
          continuing={continuing}
          onAction={onAction}
        />
        <section
          data-slot="course-roadmap"
          aria-labelledby="course-roadmap-title"
          className="min-w-0 w-full xl:col-start-1 xl:row-start-1"
        >
          <div
            data-slot="course-roadmap-heading"
            className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"
          >
            <div className="min-w-0">
              <h2 id="course-roadmap-title" className="text-xl font-semibold">
                {t("home.courseRoadmap")}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("home.courseProgress", {
                  complete: completedDays,
                  total: days.length,
                })}
              </p>
            </div>
            {days.length > 0 ? (
              <Progress
                className="w-full sm:w-52"
                value={completedDays}
                max={days.length}
                aria-label={t("home.focus.courseProgress")}
                aria-valuetext={t("home.courseProgress", {
                  complete: completedDays,
                  total: days.length,
                })}
              />
            ) : null}
          </div>

          <div className="mt-6 space-y-8">
            {course.weeks.map((week) => (
              <section
                key={week.id}
                aria-labelledby={`roadmap-week-${week.id}`}
                className="min-w-0"
              >
                <div className="mb-4 min-w-0 [overflow-wrap:anywhere]">
                  <h3
                    id={`roadmap-week-${week.id}`}
                    className="text-base font-semibold"
                  >
                    {week.title}
                  </h3>
                  {week.description ? (
                    <p className="mt-1 max-w-[65ch] text-sm leading-6 text-muted-foreground">
                      {week.description}
                    </p>
                  ) : null}
                </div>
                <ol className="space-y-3">
                  {week.days.map((day) => (
                    <RoadmapLesson
                      key={day.id}
                      day={day}
                      currentDayId={action?.day.id ?? null}
                      currentBlockId={currentBlockId}
                      currentUnitId={currentUnitId}
                    />
                  ))}
                </ol>
              </section>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function RoadmapLesson({
  day,
  currentDayId,
  currentBlockId,
  currentUnitId,
}: {
  day: LearningDay;
  currentDayId: string | null;
  currentBlockId: LearningBlock["id"] | null;
  currentUnitId: string | null;
}) {
  const { t } = useI18n();
  const isCurrent = day.id === currentDayId;
  const lessonLocked = day.status === "locked";
  const blocks = groupDayIntoBlocks(day.units, (unit) =>
    lessonLocked ? "locked" : (unit.status ?? "locked"),
  ).filter((block) => block.totalCount > 0);
  return (
    <li
      data-slot="course-roadmap-lesson"
      data-status={day.status}
      data-current={isCurrent ? "true" : undefined}
      aria-current={isCurrent && currentUnitId === null ? "step" : undefined}
      className={
        isCurrent
          ? "min-w-0 rounded-panel border-l-[3px] border-primary bg-primary/[0.06]"
          : "min-w-0 rounded-panel bg-surface-soft/60"
      }
    >
      <article className="min-w-0 p-5 sm:p-6">
        <header className="flex min-w-0 items-start gap-3">
          <RoadmapStatusIcon status={day.status} />
          <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
            <h4 className="font-semibold leading-6">
              {t("home.lesson", { number: day.order })} · {day.title}
            </h4>
            <p className="mt-1 max-w-[65ch] text-sm leading-6 text-muted-foreground">
              {day.goal}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
              <RoadmapStatusText status={day.status} />
              <span>
                {t("home.estimated", { minutes: day.estimatedMinutes })}
              </span>
            </div>
          </div>
        </header>

        {blocks.length > 0 ? (
          <details
            data-slot="course-roadmap-lesson-details"
            className="group mt-5"
            open={isCurrent ? true : undefined}
          >
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-control bg-surface-soft/65 px-3 py-2.5 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 [&::-webkit-details-marker]:hidden">
              {t("session.plan")}
              <CaretDownIcon
                aria-hidden
                className="shrink-0 transition-transform group-open:rotate-180 motion-reduce:transition-none"
              />
            </summary>
            <ol className="mt-3 space-y-4 px-1">
              {blocks.map((block) => (
                <RoadmapPhase
                  key={block.id}
                  block={block}
                  isCurrent={isCurrent && block.id === currentBlockId}
                  currentUnitId={currentUnitId}
                  lessonLocked={lessonLocked}
                />
              ))}
            </ol>
          </details>
        ) : null}
      </article>
    </li>
  );
}

function RoadmapPhase({
  block,
  isCurrent,
  currentUnitId,
  lessonLocked,
}: {
  block: LearningBlock;
  isCurrent: boolean;
  currentUnitId: string | null;
  lessonLocked: boolean;
}) {
  const { t } = useI18n();
  return (
    <li
      data-slot="course-roadmap-phase"
      data-status={block.status}
      data-current={isCurrent ? "true" : undefined}
      className="py-1"
    >
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-5">
        <div className="flex min-w-0 items-center gap-2.5">
          <RoadmapStatusIcon status={block.status} compact />
          <h5 className="min-w-0 font-medium">{t(phaseLabels[block.id])}</h5>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pl-7 text-xs text-muted-foreground sm:justify-end sm:pl-0">
          <span>{t(phaseStatusLabels[block.status])}</span>
          <span>
            {t("home.phase.progress", {
              complete: block.completedCount,
              total: block.totalCount,
            })}
          </span>
          <span>
            {t("home.estimated", { minutes: block.estimatedMinutes })}
          </span>
        </div>
      </div>
      <ol className="mt-3 space-y-1 pl-7">
        {block.units.map((unit) => (
          <RoadmapActivity
            key={unit.id}
            unit={unit}
            isCurrent={unit.id === currentUnitId}
            status={lessonLocked ? "locked" : (unit.status ?? "locked")}
          />
        ))}
      </ol>
    </li>
  );
}

function RoadmapActivity({
  unit,
  isCurrent,
  status,
}: {
  unit: LearningBlock["units"][number];
  isCurrent: boolean;
  status: UnitStatus;
}) {
  const { t } = useI18n();
  return (
    <li
      data-slot="course-roadmap-activity"
      data-status={status}
      aria-current={isCurrent ? "step" : undefined}
      className={
        isCurrent
          ? "grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-2.5 rounded-control bg-accent/70 px-3 py-2.5 sm:grid-cols-[auto_minmax(0,1fr)_auto]"
          : "grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-2.5 rounded-control px-3 py-2.5 sm:grid-cols-[auto_minmax(0,1fr)_auto]"
      }
    >
      <RoadmapStatusIcon status={status} compact />
      <div className="min-w-0 [overflow-wrap:anywhere]">
        <p className="text-sm font-medium leading-5">{unit.title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {t(unitTypeMessageKeys[unit.type])}
        </p>
      </div>
      <div className="col-start-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground sm:col-start-3 sm:justify-end">
        <span>{t(unitStatusMessageKeys[status])}</span>
        <span>{t("home.estimated", { minutes: unit.estimatedMinutes })}</span>
      </div>
    </li>
  );
}

function RevisionContextRail({
  course,
  days,
  action,
  completedDays,
  requiresSelection,
  continuing,
  onAction,
}: {
  course: LearningCourse;
  days: LearningDay[];
  action: RevisionRoadmapAction | null;
  completedDays: number;
  requiresSelection: boolean;
  continuing: boolean;
  onAction: () => void;
}) {
  const { t } = useI18n();
  const courseComplete =
    days.length > 0 && days.every((day) => day.status === "completed");
  return (
    <aside
      data-slot="course-roadmap-context"
      className="min-w-0 w-full space-y-3 xl:col-start-2 xl:row-start-1 xl:sticky xl:top-24"
    >
      <section
        data-slot="course-roadmap-summary"
        className="rounded-panel bg-surface-raised p-5"
      >
        <h2 className="font-semibold">{t("home.nextAction")}</h2>
        {action ? (
          <div className="mt-4 min-w-0 [overflow-wrap:anywhere]">
            <p className="text-sm font-medium">
              {t("home.lesson", { number: action.day.order })}
            </p>
            <p className="mt-1 text-base font-semibold leading-6">
              {action.day.title}
            </p>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {action.currentUnit?.title ?? action.day.goal}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted-foreground">
              <RoadmapStatusText status={action.day.status} />
              <span>
                {action.kind === "continue"
                  ? t("home.remaining", {
                      minutes: remainingDayMinutes(
                        groupDayIntoBlocks(
                          action.day.units,
                          (unit) => unit.status ?? "locked",
                        ),
                      ),
                    })
                  : t("home.estimated", {
                      minutes: action.day.estimatedMinutes,
                    })}
              </span>
            </div>
          </div>
        ) : (
          <p className="mt-4 text-sm font-medium">
            {courseComplete
              ? t("home.complete")
              : t("courses.current.revisionUnavailable")}
          </p>
        )}
        {action ? (
          <Button
            type="button"
            size="lg"
            className="mt-5 w-full"
            disabled={requiresSelection || continuing}
            onClick={onAction}
          >
            {continuing
              ? t("home.starting")
              : action.kind === "continue"
                ? t("courses.action.continue")
                : t("home.start")}
            <ArrowRightIcon data-icon="inline-end" aria-hidden />
          </Button>
        ) : null}
        <div className="mt-5 rounded-control bg-surface-soft/75 p-4">
          <h3 className="text-sm font-semibold">
            {t("courses.table.progress")}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("home.courseProgress", {
              complete: completedDays,
              total: days.length,
            })}
          </p>
          {days.length > 0 ? (
            <Progress
              className="mt-3"
              value={completedDays}
              max={days.length}
              aria-label={t("home.focus.courseProgress")}
              aria-valuetext={t("home.courseProgress", {
                complete: completedDays,
                total: days.length,
              })}
            />
          ) : null}
        </div>
      </section>

      <details className="rounded-control bg-surface-soft/65 p-4 text-sm">
        <summary className="min-h-11 cursor-pointer content-center rounded-control font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
          {t("courses.library.details")}
        </summary>
        <p className="mt-4 text-sm font-medium">
          {t("home.revision", { revision: course.version.revision })}
        </p>
        <dl className="mt-4 space-y-4 text-muted-foreground">
          <div>
            <dt className="text-xs">{t("courses.library.revisionId")}</dt>
            <dd className="mt-1 [overflow-wrap:anywhere]">
              {course.version.id}
            </dd>
          </div>
          <div>
            <dt className="text-xs">{t("courses.preview.contentHash")}</dt>
            <dd className="mt-1 font-mono text-xs [overflow-wrap:anywhere]">
              {course.version.contentHash}
            </dd>
          </div>
        </dl>
      </details>
    </aside>
  );
}

function RoadmapStatusIcon({
  status,
  compact = false,
}: {
  status: RoadmapStatus;
  compact?: boolean;
}) {
  const className = compact ? "size-4 shrink-0" : "mt-0.5 size-5 shrink-0";
  if (status === "completed" || status === "skipped") {
    return (
      <CheckCircleIcon
        aria-hidden
        weight="fill"
        className={`${className} text-success-foreground`}
      />
    );
  }
  if (status === "locked") {
    return (
      <LockKeyIcon
        aria-hidden
        className={`${className} text-muted-foreground`}
      />
    );
  }
  if (status === "in_progress") {
    return (
      <ArrowRightIcon aria-hidden className={`${className} text-primary`} />
    );
  }
  return <CircleIcon aria-hidden className={`${className} text-primary`} />;
}

function RoadmapStatusText({ status }: { status: LearningDay["status"] }) {
  const { t } = useI18n();
  return (
    <span className="inline-flex items-center gap-1.5">
      <RoadmapStatusIcon status={status} compact />
      {t(dayStatusLabels[status])}
    </span>
  );
}

function UpcomingLesson({ day }: { day: LearningDay }) {
  const { t } = useI18n();
  return (
    <li
      data-slot="home-upcoming-lesson"
      className="flex min-w-0 flex-col gap-2.5 rounded-control bg-surface-soft/45 px-4 py-3.5"
    >
      <div className="min-w-0 [overflow-wrap:anywhere]">
        <p className="font-medium leading-6">
          {t("home.lesson", { number: day.order })} · {day.title}
        </p>
      </div>
      <p className="text-xs text-muted-foreground">
        {t("home.estimated", { minutes: day.estimatedMinutes })}
      </p>
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <span className="inline-flex w-fit max-w-full items-center gap-1.5 rounded-full bg-background/60 px-2.5 py-1 text-xs text-muted-foreground">
          {day.status === "completed" ? (
            <CheckCircleIcon aria-hidden weight="fill" />
          ) : day.status === "locked" ? (
            <LockKeyIcon aria-hidden />
          ) : (
            <span aria-hidden className="size-2 rounded-full bg-primary" />
          )}
          <span className="break-words [overflow-wrap:anywhere]">
            {t(dayStatusLabels[day.status])}
          </span>
        </span>
      </div>
    </li>
  );
}
