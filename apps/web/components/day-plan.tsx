"use client";

import type { ReactNode } from "react";
import {
  CaretDownIcon,
  CheckIcon,
  CircleIcon,
  LockKeyIcon,
} from "@phosphor-icons/react";

import type { LearnerSession } from "@/components/session-client";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { groupDayIntoBlocks } from "@/lib/learning-blocks";
import { formatMinutesShort } from "@/lib/time";
import { type MessageKey, useI18n } from "@/lib/i18n";
import {
  depthMessageKey,
  unitStatusMessageKeys,
  unitTypeMessageKeys,
} from "@/lib/unit-labels";
import { cn } from "@/lib/utils";

const phaseMessageKeys: Readonly<
  Record<"study" | "check" | "practice", MessageKey>
> = {
  study: "home.phase.study",
  check: "home.phase.check",
  practice: "home.phase.practice",
};

export function DayPlanSheet({
  session,
  trigger,
}: {
  session: LearnerSession;
  trigger: ReactNode;
}) {
  return (
    <Sheet>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent data-slot="day-plan-sheet">
        <DayPlanContent session={session} variant="sheet" />
      </SheetContent>
    </Sheet>
  );
}

export function DayPlanRail({ session }: { session: LearnerSession }) {
  const { t } = useI18n();

  return (
    <aside
      data-slot="day-plan-rail"
      aria-label={t("session.plan")}
      className="sticky top-[var(--shell-bar-size,4.5rem)] hidden h-[calc(100dvh-var(--shell-bar-size,4.5rem))] min-w-0 self-start overflow-y-auto overscroll-contain border-l border-border/50 bg-surface-soft/35 px-5 py-6 [scrollbar-gutter:stable] @min-[72rem]/lesson:col-start-2 @min-[72rem]/lesson:row-span-2 @min-[72rem]/lesson:row-start-1 @min-[72rem]/lesson:block"
    >
      <DayPlanContent session={session} variant="rail" />
    </aside>
  );
}

function DayPlanContent({
  session,
  variant,
}: {
  session: LearnerSession;
  variant: "sheet" | "rail";
}) {
  const { locale, t } = useI18n();
  const { day } = session.snapshot;
  const progressByUnit = new Map(
    session.unitProgress.map((item) => [item.unitId, item]),
  );
  const blocks = groupDayIntoBlocks(
    session.snapshot.units.map((unit) => ({
      id: unit.id,
      type: unit.type,
      title: unit.title,
      estimatedMinutes: unit.estimatedMinutes,
    })),
    (unit) => progressByUnit.get(unit.id)?.status ?? "locked",
  );
  const visibleBlocks = blocks.filter((block) => block.totalCount > 0);
  const currentUnit =
    session.currentStep === "complete"
      ? undefined
      : session.snapshot.units.find(
          (unit) =>
            unit.id === session.currentStep ||
            unit.stableId === session.currentStep,
        );
  const currentBlockId = currentUnit
    ? visibleBlocks.find((block) =>
        block.units.some((unit) => unit.id === currentUnit.id),
      )?.id
    : undefined;
  const completed = session.snapshot.units.filter((unit) => {
    const status = progressByUnit.get(unit.id)?.status;
    return status === "completed" || status === "skipped";
  }).length;
  const total = session.snapshot.units.length;

  return (
    <>
      {variant === "sheet" ? (
        <SheetHeader>
          <SheetTitle className="text-xl">{t("session.plan")}</SheetTitle>
          <SheetDescription>
            <span className="block font-medium text-foreground">
              {t("dayPlan.title", { order: day.order, title: day.title })}
            </span>
            <span className="mt-0.5 block">
              {t("dayPlan.meta", {
                duration: formatMinutesShort(day.estimatedMinutes, locale),
                depth: depthMessageKey(day.depthLevel)
                  ? t(depthMessageKey(day.depthLevel)!)
                  : day.depthLevel,
              })}
            </span>
          </SheetDescription>
        </SheetHeader>
      ) : (
        <header className="pb-4">
          <h2 className="break-words text-xl font-semibold leading-7 tracking-[-0.02em] [overflow-wrap:anywhere]">
            {t("session.plan")}
          </h2>
          <p className="mt-2.5 break-words text-pretty text-sm font-semibold leading-5 [overflow-wrap:anywhere]">
            {t("dayPlan.title", { order: day.order, title: day.title })}
          </p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {t("dayPlan.meta", {
              duration: formatMinutesShort(day.estimatedMinutes, locale),
              depth: depthMessageKey(day.depthLevel)
                ? t(depthMessageKey(day.depthLevel)!)
                : day.depthLevel,
            })}
          </p>
        </header>
      )}

      <div
        data-slot="day-plan-summary"
        className={cn(
          "rounded-control bg-background/55 px-3 py-3",
          variant === "sheet" && "mx-5",
        )}
      >
        <div className="flex items-center justify-between gap-3 text-xs font-medium text-muted-foreground">
          <span>{t("session.progress")}</span>
          <span className="tabular-nums">
            {completed} / {total}
          </span>
        </div>
        <Progress
          aria-label={t("session.progress")}
          value={completed}
          max={total}
          className="mt-2 h-1"
        />
      </div>

      <div
        className={cn(
          "flex flex-1 flex-col pt-5",
          variant === "sheet" &&
            "overflow-y-auto overscroll-contain px-5 pb-6 [scrollbar-gutter:stable]",
        )}
      >
        <section className="flex min-w-0 flex-col gap-4">
          <h3 className="text-sm font-semibold">{t("dayPlan.phases")}</h3>
          <ol data-slot="day-plan-stepper" className="flex flex-col gap-1">
            {visibleBlocks.map((block, index) => {
              const blockActive = block.id === currentBlockId;
              const blockComplete = block.status === "completed";
              return (
                <li
                  key={block.id}
                  data-slot="plan-block"
                  data-block={block.id}
                  data-status={block.status}
                  aria-current={blockActive ? "step" : undefined}
                  className="grid min-w-0 grid-cols-[1.75rem_minmax(0,1fr)] gap-3"
                >
                  <div
                    aria-hidden
                    className="flex h-full flex-col items-center"
                  >
                    <span
                      className={cn(
                        "grid size-7 shrink-0 place-items-center rounded-full border bg-background text-xs font-semibold",
                        blockComplete && "border-success/45 text-success",
                        blockActive && "border-primary text-primary",
                        block.status === "locked" &&
                          "border-border text-muted-foreground",
                      )}
                    >
                      {blockComplete ? (
                        <CheckIcon className="size-4" />
                      ) : block.status === "locked" ? (
                        <LockKeyIcon className="size-3.5" />
                      ) : (
                        index + 1
                      )}
                    </span>
                    {index < visibleBlocks.length - 1 ? (
                      <span className="my-1 w-px flex-1 bg-border" />
                    ) : null}
                  </div>

                  <div
                    className={cn(
                      "min-w-0",
                      index < visibleBlocks.length - 1 ? "pb-6" : "pb-0",
                    )}
                  >
                    <div className="flex min-w-0 items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="break-words text-sm font-semibold leading-5 [overflow-wrap:anywhere]">
                          {t("dayPlan.phaseIndex", {
                            current: index + 1,
                            total: visibleBlocks.length,
                          })}
                          <span className="text-muted-foreground"> · </span>
                          {t(phaseMessageKeys[block.id])}
                        </p>
                        <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                          {t("session.activitiesCount", {
                            count: block.totalCount,
                            duration: formatMinutesShort(
                              block.estimatedMinutes,
                              locale,
                            ),
                          })}
                        </p>
                      </div>
                      <span className="max-w-24 shrink-0 break-words pt-0.5 text-right text-xs leading-5 text-muted-foreground [overflow-wrap:anywhere]">
                        {t(unitStatusMessageKeys[block.status])}
                      </span>
                    </div>

                    <ol className="mt-2.5 flex flex-col gap-1">
                      {block.units.map((unit) => {
                        const status =
                          progressByUnit.get(unit.id)?.status ?? "locked";
                        const current = unit.id === currentUnit?.id;
                        return (
                          <li
                            key={unit.id}
                            data-slot="plan-step"
                            data-status={status}
                            aria-current={current ? "step" : undefined}
                            className={cn(
                              "grid min-w-0 grid-cols-[1rem_minmax(0,1fr)_auto] items-start gap-2.5 rounded-control px-2.5 py-2 text-sm",
                              current
                                ? "bg-background shadow-sm"
                                : "bg-transparent",
                            )}
                          >
                            <span
                              aria-hidden
                              className="mt-0.5 grid size-4 place-items-center"
                            >
                              {status === "completed" ||
                              status === "skipped" ? (
                                <CheckIcon
                                  className={cn(
                                    "size-3.5",
                                    status === "completed"
                                      ? "text-success"
                                      : "text-muted-foreground",
                                  )}
                                />
                              ) : status === "locked" ? (
                                <LockKeyIcon className="size-3.5 text-muted-foreground" />
                              ) : (
                                <CircleIcon
                                  className={cn(
                                    "size-3.5",
                                    current
                                      ? "text-primary"
                                      : "text-muted-foreground",
                                  )}
                                  weight={current ? "fill" : "regular"}
                                />
                              )}
                            </span>
                            <span className="min-w-0 leading-5">
                              <span className="block break-words font-medium [overflow-wrap:anywhere]">
                                {unit.title}
                              </span>
                              <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                                {t(unitTypeMessageKeys[unit.type])} ·{" "}
                                {formatMinutesShort(
                                  unit.estimatedMinutes,
                                  locale,
                                )}
                              </span>
                            </span>
                            <span className="max-w-24 shrink-0 break-words pt-0.5 text-right text-xs leading-5 text-muted-foreground [overflow-wrap:anywhere]">
                              {t(unitStatusMessageKeys[status])}
                            </span>
                          </li>
                        );
                      })}
                    </ol>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>

        <div
          data-slot="day-plan-secondary"
          className="mt-6 flex flex-col gap-1 border-t border-border/50 pt-2.5"
        >
          <details data-slot="day-plan-goal" className="group">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-control px-2 py-2.5 text-sm font-semibold outline-none hover:bg-background/50 hover:text-primary focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
              {t("dayPlan.goal")}
              <CaretDownIcon
                aria-hidden
                className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none"
              />
            </summary>
            <div className="flex flex-col gap-5 px-2 pb-5">
              <p className="max-w-[65ch] break-words text-sm leading-6 text-muted-foreground [overflow-wrap:anywhere]">
                {day.goal}
              </p>
              {day.expectedOutcomes.length ? (
                <div className="flex flex-col gap-2">
                  <h4 className="text-sm font-medium">
                    {t("dayPlan.outcomes")}
                  </h4>
                  <ul className="flex flex-col gap-2 text-sm leading-6 text-muted-foreground">
                    {day.expectedOutcomes.map((outcome) => (
                      <li key={outcome} className="flex min-w-0 gap-2">
                        <CircleIcon
                          aria-hidden
                          weight="fill"
                          className="mt-2 size-1.5 shrink-0 text-primary"
                        />
                        <span className="min-w-0 break-words [overflow-wrap:anywhere]">
                          {outcome}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </details>

          {day.topics.length || day.outOfScope.length ? (
            <details data-slot="day-plan-topics" className="group">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-control px-2 py-2.5 text-sm font-semibold outline-none hover:bg-background/50 hover:text-primary focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                {t("dayPlan.topics")}
                <CaretDownIcon
                  aria-hidden
                  className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none"
                />
              </summary>
              <div className="flex flex-col gap-5 px-2 pb-5">
                {day.topics.length ? (
                  <div className="flex flex-wrap gap-2">
                    {day.topics.map((topic) => (
                      <Badge
                        key={topic}
                        variant="outline"
                        className="h-auto max-w-full min-w-0 whitespace-normal break-words py-1 text-left"
                      >
                        {topic}
                      </Badge>
                    ))}
                  </div>
                ) : null}
                {day.outOfScope.length ? (
                  <div className="flex flex-col gap-1.5">
                    <h4 className="text-xs font-medium text-muted-foreground">
                      {t("dayPlan.outOfScope")}
                    </h4>
                    <p className="max-w-[65ch] break-words text-sm leading-6 text-muted-foreground [overflow-wrap:anywhere]">
                      {day.outOfScope.join(" · ")}
                    </p>
                  </div>
                ) : null}
              </div>
            </details>
          ) : null}
        </div>
      </div>
    </>
  );
}
