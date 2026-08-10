"use client";

import { WarningCircleIcon } from "@phosphor-icons/react/dist/ssr";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";

export function QueryError({
  message,
  retry,
}: {
  message: string;
  retry?: () => void;
}) {
  const { t } = useI18n();
  return (
    <div
      data-slot="query-error"
      role="alert"
      className="flex min-h-44 flex-col items-start justify-center gap-3 rounded-lg border border-border bg-card p-6"
    >
      <WarningCircleIcon aria-hidden className="size-6 text-destructive" />
      <div>
        <p className="font-medium">{t("query.failed")}</p>
        <p className="mt-1 max-w-[65ch] text-sm text-muted-foreground">
          {message}
        </p>
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
      className="flex min-h-44 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border p-6 text-center"
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
