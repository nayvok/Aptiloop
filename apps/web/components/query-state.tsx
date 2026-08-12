"use client";

import { WarningCircleIcon } from "@phosphor-icons/react/dist/ssr";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";

export function QueryError({
  title,
  message,
  diagnostic,
  retry,
  kind = "error",
}: {
  title?: string;
  message: string;
  diagnostic?: string;
  retry?: () => void;
  kind?: "error" | "warning";
}) {
  const { t } = useI18n();
  return (
    <div
      data-slot="query-error"
      data-kind={kind}
      role="alert"
      className={`grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-3 rounded-panel border bg-surface-raised p-4 sm:p-5 ${
        kind === "warning" ? "border-warning/45" : "border-destructive/30"
      }`}
    >
      <span
        aria-hidden
        className={`flex size-9 items-center justify-center rounded-full ${
          kind === "warning" ? "bg-warning/15" : "bg-destructive/10"
        }`}
      >
        <WarningCircleIcon
          className={`size-5 ${
            kind === "warning" ? "text-warning-foreground" : "text-destructive"
          }`}
        />
      </span>
      <div className="min-w-0 pt-1">
        <h2 className="font-semibold text-foreground">
          {title ?? t("query.failed")}
        </h2>
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
        <Button
          className="col-start-2 justify-self-start"
          variant="outline"
          onClick={retry}
        >
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
