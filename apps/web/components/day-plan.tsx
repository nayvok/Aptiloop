"use client";

import type { ReactNode } from "react";

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
import { groupDayIntoBlocks } from "@/lib/learning-blocks";
import { formatMinutesShort } from "@/lib/time";
import { type MessageKey, useI18n } from "@/lib/i18n";
import {
  activityColorClass,
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

  return (
    <Sheet>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent data-slot="day-plan-sheet">
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

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">{t("dayPlan.phases")}</h3>
            <ol className="flex flex-col gap-2">
              {blocks
                .filter((block) => block.totalCount > 0)
                .map((block, index) => (
                  <li
                    key={block.id}
                    data-slot="plan-block"
                    data-block={block.id}
                    className="rounded-md border border-border p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="min-w-0 truncate text-sm font-medium">
                        <span
                          className={cn(
                            "mr-2",
                            activityColorClass(block.units[0]?.type ?? "study"),
                          )}
                        >
                          {t("dayPlan.phaseIndex", {
                            current: index + 1,
                            total: 3,
                          })}
                        </span>
                        {t(phaseMessageKeys[block.id])}
                      </p>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {t(unitStatusMessageKeys[block.status])} ·{" "}
                        {formatMinutesShort(block.estimatedMinutes, locale)}
                      </span>
                    </div>
                    <ol className="mt-2 flex flex-col gap-1">
                      {block.units.map((unit) => {
                        const status =
                          progressByUnit.get(unit.id)?.status ?? "locked";
                        return (
                          <li
                            key={unit.id}
                            data-slot="plan-step"
                            data-status={status}
                            className="flex items-center justify-between gap-2 rounded-md bg-muted/60 px-3 py-2 text-sm"
                          >
                            <span className="min-w-0 truncate">
                              <span className="font-medium">{unit.title}</span>
                              <span className="ml-2 text-xs text-muted-foreground">
                                {t(unitTypeMessageKeys[unit.type])} ·{" "}
                                {formatMinutesShort(
                                  unit.estimatedMinutes,
                                  locale,
                                )}
                              </span>
                            </span>
                            <span className="shrink-0 text-xs text-muted-foreground">
                              {t(unitStatusMessageKeys[status])}
                            </span>
                          </li>
                        );
                      })}
                    </ol>
                  </li>
                ))}
            </ol>
          </div>

          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">{t("dayPlan.goal")}</h3>
            <p className="text-sm leading-6 text-muted-foreground">
              {day.goal}
            </p>
          </div>

          {day.topics.length ? (
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-medium">{t("dayPlan.topics")}</h3>
              <div className="flex flex-wrap gap-2">
                {day.topics.map((topic) => (
                  <Badge key={topic} variant="outline">
                    {topic}
                  </Badge>
                ))}
              </div>
            </div>
          ) : null}

          {day.expectedOutcomes.length ? (
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-medium">{t("dayPlan.outcomes")}</h3>
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
            </div>
          ) : null}

          {day.outOfScope.length ? (
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-medium">{t("dayPlan.outOfScope")}</h3>
              <p className="text-sm leading-6 text-muted-foreground">
                {day.outOfScope.join(" · ")}
              </p>
            </div>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
