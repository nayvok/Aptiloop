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
import {
  activityColorClass,
  depthLabel,
  unitStatusLabels,
  unitTypeLabels,
} from "@/lib/unit-labels";
import { cn } from "@/lib/utils";

const blockStatusLabels: Record<string, string> = {
  completed: "Завершён",
  in_progress: "Сейчас",
  ready: "Доступен",
  locked: "Заблокирован",
};

export function DayPlanSheet({
  session,
  trigger,
}: {
  session: LearnerSession;
  trigger: ReactNode;
}) {
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
            День {day.order} · {day.title}
          </SheetTitle>
          <SheetDescription>
            {formatMinutesShort(day.estimatedMinutes)} · Глубина:{" "}
            {depthLabel(day.depthLevel)}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">Учебные блоки</h3>
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
                          Блок {index + 1} из 3
                        </span>
                        {block.label}
                      </p>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {blockStatusLabels[block.status]} ·{" "}
                        {formatMinutesShort(block.estimatedMinutes)}
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
                                {unitTypeLabels[unit.type]} ·{" "}
                                {formatMinutesShort(unit.estimatedMinutes)}
                              </span>
                            </span>
                            <span className="shrink-0 text-xs text-muted-foreground">
                              {unitStatusLabels[status]}
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
            <h3 className="text-sm font-medium">Цель</h3>
            <p className="text-sm leading-6 text-muted-foreground">
              {day.goal}
            </p>
          </div>

          {day.topics.length ? (
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-medium">Темы</h3>
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
              <h3 className="text-sm font-medium">Ожидаемые результаты</h3>
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
              <h3 className="text-sm font-medium">Вне дня</h3>
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
