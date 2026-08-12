"use client";

import { ClockIcon } from "@phosphor-icons/react";

import { useI18n } from "@/lib/i18n";
import { formatMinutesShort } from "@/lib/time";
import { cn } from "@/lib/utils";

export function EstimatedDuration({
  minutes,
  remaining = false,
  className,
}: {
  minutes: number;
  remaining?: boolean;
  className?: string;
}) {
  const { locale, t } = useI18n();

  return (
    <span
      data-slot="estimated-duration"
      className={cn(
        "inline-flex h-6 w-fit shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-surface-soft px-2 text-xs font-medium text-muted-foreground",
        className,
      )}
    >
      <ClockIcon aria-hidden className="size-3.5 shrink-0" />
      {t(remaining ? "time.estimatedRemaining" : "time.estimated", {
        duration: formatMinutesShort(minutes, locale),
      })}
    </span>
  );
}
