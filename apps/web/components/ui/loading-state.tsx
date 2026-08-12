"use client";

import { Spinner } from "@/components/ui/spinner";
import { type MessageKey, useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const variantClasses = {
  page: "min-h-[18rem] sm:min-h-[22rem]",
  panel: "min-h-40",
  inline: "min-h-11 flex-row rounded-none bg-transparent p-0 text-left",
} as const;

export function LoadingState({
  label,
  variant = "page",
  className,
}: {
  label: MessageKey;
  variant?: keyof typeof variantClasses;
  className?: string;
}) {
  const { t } = useI18n();
  const message = t(label);

  return (
    <div
      data-slot="loading-state"
      data-variant={variant}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-label={message}
      className={cn(
        "flex min-w-0 flex-col items-center justify-center gap-3 rounded-panel bg-surface-soft/45 p-6 text-center text-sm text-muted-foreground",
        variantClasses[variant],
        className,
      )}
    >
      <span
        aria-hidden
        className="grid size-11 shrink-0 place-items-center rounded-full bg-primary/10 text-primary"
      >
        <Spinner className="size-5" />
      </span>
      <span className="leading-6">{message}</span>
    </div>
  );
}
