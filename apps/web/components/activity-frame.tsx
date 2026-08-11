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
      className={cn("w-full max-w-[48rem] min-w-0", className)}
    >
      {slots.accessibility}
      <header
        data-slot="activity-context"
        className="flex min-w-0 flex-col gap-3 border-b border-border/60 pb-4 sm:flex-row sm:items-start sm:justify-between sm:pb-5"
      >
        <div className="flex min-w-0 max-w-[72ch] flex-col gap-2">
          {slots.context}
          <h2
            id={titleId}
            className="break-words text-pretty text-[1.375rem] font-semibold leading-[1.875rem] tracking-[-0.02em] [overflow-wrap:anywhere] sm:text-2xl sm:leading-8"
          >
            {title}
          </h2>
          <p
            id={descriptionId}
            className="max-w-[68ch] break-words text-[0.9375rem] leading-6 text-muted-foreground [overflow-wrap:anywhere]"
          >
            {description}
          </p>
        </div>
        <div
          data-slot="activity-status"
          className="max-w-full shrink-0 self-start [&_[data-slot=badge]]:h-auto [&_[data-slot=badge]]:max-w-full [&_[data-slot=badge]]:whitespace-normal [&_[data-slot=badge]]:break-words [&_[data-slot=badge]]:py-1 [&_[data-slot=badge]]:text-left"
        >
          {slots.status}
        </div>
      </header>
      <div data-slot="activity-content" className="min-w-0 pb-1 pt-5">
        {children}
      </div>
      {slots.runtime ? (
        <div
          data-slot="activity-runtime"
          className="mb-5 min-w-0 border-y border-border/60 bg-surface-soft/60 py-4 sm:py-5"
        >
          {slots.runtime}
        </div>
      ) : null}
      {slots.evidence ? (
        <div
          data-slot="activity-evidence"
          className="mb-5 min-w-0 border-t border-border/60 pt-5 sm:pt-6"
        >
          {slots.evidence}
        </div>
      ) : null}
      {slots.actions ? (
        <footer
          data-slot="activity-actions"
          className="mb-5 min-w-0 border-t border-border/60 pt-5 sm:pt-6"
        >
          {slots.actions}
        </footer>
      ) : null}
    </section>
  );
}
