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
      className="sticky top-[12.5rem] hidden max-h-[calc(100vh-13.5rem)] min-w-0 overflow-y-auto overscroll-contain border-l border-border/60 pl-6 [scrollbar-gutter:stable] xl:block"
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
          <SheetTitle>
            {t("dayPlan.title", { order: day.order, title: day.title })}
          </SheetTitle>
          <SheetDescription>
            {t("dayPlan.meta", {
              duration: formatMinutesShort(day.estimatedMinutes, locale),
              depth: depthMessageKey(day.depthLevel)
                ? t(depthMessageKey(day.depthLevel)!)
                : day.depthLevel,
            })}
          </SheetDescription>
        </SheetHeader>
      ) : (
        <header className="border-b border-border/60 pb-4">
          <p className="text-xs font-medium text-muted-foreground">
            {t("session.plan")}
          </p>
          <h2 className="mt-1 break-words text-base font-semibold leading-6 [overflow-wrap:anywhere]">
            {t("dayPlan.title", { order: day.order, title: day.title })}
          </h2>
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
          "border-border/60 py-3",
          variant === "sheet" ? "border-y px-6" : "border-b",
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
          "flex flex-1 flex-col py-5",
          variant === "sheet" &&
            "overflow-y-auto overscroll-contain px-5 [scrollbar-gutter:stable]",
        )}
      >
        <section className="flex min-w-0 flex-col gap-4">
          <h3 className="text-sm font-semibold">{t("dayPlan.phases")}</h3>
          <ol data-slot="day-plan-stepper" className="flex flex-col">
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
                      index < visibleBlocks.length - 1 ? "pb-7" : "pb-0",
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
                      <Badge
                        variant={
                          blockComplete
                            ? "success"
                            : blockActive
                              ? "outline"
                              : "secondary"
                        }
                        className="h-auto max-w-28 shrink-0 whitespace-normal break-words py-1 text-right"
                      >
                        {t(unitStatusMessageKeys[block.status])}
                      </Badge>
                    </div>

                    <ol className="mt-3 flex flex-col divide-y divide-border/60 border-y border-border/60">
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
                              "grid min-w-0 grid-cols-[1rem_minmax(0,1fr)_auto] items-start gap-2.5 px-2 py-3 text-sm",
                              current && "bg-accent/55",
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
          className="border-t border-border/60"
        >
          <details
            data-slot="day-plan-goal"
            className="group border-b border-border/60"
          >
            <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 py-3 text-sm font-semibold outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
              {t("dayPlan.goal")}
              <CaretDownIcon
                aria-hidden
                className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none"
              />
            </summary>
            <div className="flex flex-col gap-5 pb-5">
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
            <details
              data-slot="day-plan-topics"
              className="group border-b border-border/60"
            >
              <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 py-3 text-sm font-semibold outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                {t("dayPlan.topics")}
                <CaretDownIcon
                  aria-hidden
                  className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none"
                />
              </summary>
              <div className="flex flex-col gap-5 pb-5">
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
