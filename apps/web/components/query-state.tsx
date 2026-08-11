"use client";

import { WarningCircleIcon } from "@phosphor-icons/react/dist/ssr";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";

export function QueryError({
  message,
  diagnostic,
  retry,
}: {
  message: string;
  diagnostic?: string;
  retry?: () => void;
}) {
  const { t } = useI18n();
  return (
    <div
      data-slot="query-error"
      role="alert"
      className="flex min-h-36 flex-col items-start justify-center gap-4 rounded-panel bg-destructive/10 p-5 sm:p-6"
    >
      <WarningCircleIcon aria-hidden className="size-6 text-destructive" />
      <div>
        <p className="font-semibold text-foreground">{t("query.failed")}</p>
        <p className="mt-1 max-w-[65ch] text-sm text-muted-foreground">
          {message}
        </p>
        {diagnostic ? (
          <details className="mt-3 max-w-[65ch] text-xs text-muted-foreground">
            <summary className="min-h-11 cursor-pointer py-3 font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {t("query.technicalDetails")}
            </summary>
            <p className="break-words font-mono [overflow-wrap:anywhere]">
              {diagnostic}
            </p>
          </details>
        ) : null}
      </div>
      {retry ? (
        <Button variant="outline" onClick={retry}>
          {t("query.retry")}
        </Button>
      ) : null}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div
      data-slot="empty-state"
      className="flex min-h-36 flex-col items-start justify-center gap-4 rounded-panel bg-surface-soft p-5 text-left sm:p-6"
    >
      <div>
        <p className="font-medium">{title}</p>
        <p className="mt-1 max-w-[55ch] text-sm text-muted-foreground">
          {description}
        </p>
      </div>
      {action}
    </div>
  );
}
