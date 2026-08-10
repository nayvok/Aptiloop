import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type ActivityFrameSlots = {
  context: ReactNode;
  status: ReactNode;
  accessibility?: ReactNode;
  runtime?: ReactNode;
  evidence?: ReactNode;
  actions?: ReactNode;
};

export function ActivityFrame({
  activityId,
  activityType,
  title,
  description,
  slots,
  children,
  className,
}: {
  activityId: string;
  activityType: string;
  title: string;
  description: string;
  slots: ActivityFrameSlots;
  children: ReactNode;
  className?: string;
}) {
  const titleId = `activity-${activityId}-title`;
  const descriptionId = `activity-${activityId}-description`;

  return (
    <section
      data-slot="activity-frame"
      data-activity-type={activityType}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      className={cn(
        "min-w-0 overflow-hidden rounded-lg border border-border bg-card",
        className,
      )}
    >
      {slots.accessibility}
      <header
        data-slot="activity-context"
        className="flex flex-col gap-4 border-b border-border p-4 md:flex-row md:items-start md:justify-between md:p-6"
      >
        <div className="flex min-w-0 flex-col gap-2">
          {slots.context}
          <h2
            id={titleId}
            className="text-pretty text-xl font-semibold leading-7"
          >
            {title}
          </h2>
          <p
            id={descriptionId}
            className="max-w-[70ch] text-sm leading-6 text-muted-foreground"
          >
            {description}
          </p>
        </div>
        <div data-slot="activity-status" className="shrink-0">
          {slots.status}
        </div>
      </header>
      <div data-slot="activity-content" className="min-w-0 p-4 md:p-6">
        {children}
      </div>
      {slots.runtime ? (
        <div
          data-slot="activity-runtime"
          className="min-w-0 border-t border-border p-4 md:p-6"
        >
          {slots.runtime}
        </div>
      ) : null}
      {slots.evidence ? (
        <div
          data-slot="activity-evidence"
          className="min-w-0 border-t border-border p-4 md:p-6"
        >
          {slots.evidence}
        </div>
      ) : null}
      {slots.actions ? (
        <footer
          data-slot="activity-actions"
          className="border-t border-border p-4 md:p-6"
        >
          {slots.actions}
        </footer>
      ) : null}
    </section>
  );
}
