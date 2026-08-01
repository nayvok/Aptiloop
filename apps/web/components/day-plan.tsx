"use client";

import { useState } from "react";
import { CaretDownIcon } from "@phosphor-icons/react";

import type { LearnerSession } from "@/components/session-client";
import { Badge } from "@/components/ui/badge";
import { unitStatusLabels, unitTypeLabels } from "@/lib/unit-labels";

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
                  <span
                    aria-hidden
                    className="mt-2 size-1.5 shrink-0 rounded-full bg-primary"
                  />
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
                  <span
                    aria-hidden
                    className="mt-2 size-1.5 shrink-0 rounded-full bg-muted-foreground/40"
                  />
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
