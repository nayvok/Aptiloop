"use client";

import { WarningCircleIcon } from "@phosphor-icons/react/dist/ssr";

import { Button } from "@/components/ui/button";
import type { FailureOperation } from "@/lib/failure-presentation";
import { presentFailure, safeDiagnosticId } from "@/lib/failure-presentation";
import { useI18n } from "@/lib/i18n";
import { useOnlineStatus } from "@/lib/online-status";

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
  const isOnline = useOnlineStatus();
  const presentedDiagnosticId = safeDiagnosticId(diagnostic);

  return (
    <div
      data-slot="query-error"
      data-kind={kind}
      role="alert"
      className={`relative grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-3 overflow-hidden rounded-panel bg-surface-soft/80 p-4 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center sm:px-5 ${
        kind === "warning" ? "before:bg-warning" : "before:bg-destructive"
      } before:absolute before:inset-y-0 before:left-0 before:w-0.5`}
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
      <div className="min-w-0 py-0.5">
        <h2 className="font-semibold text-foreground">
          {title ?? t("query.failed")}
        </h2>
        <p className="mt-1 max-w-[65ch] text-sm text-muted-foreground">
          {message}
        </p>
        {!isOnline ? (
          <p className="mt-2 max-w-[65ch] text-xs leading-5 text-muted-foreground">
            <span className="font-medium text-foreground">
              {t("query.offline")}:
            </span>{" "}
            {t("query.offlineDescription")}
          </p>
        ) : null}
        {presentedDiagnosticId ? (
          <details className="mt-3 max-w-[65ch] text-xs text-muted-foreground">
            <summary className="min-h-11 cursor-pointer py-3 font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {t("query.technicalDetails")}
            </summary>
            <p className="break-words font-mono [overflow-wrap:anywhere]">
              {presentedDiagnosticId}
            </p>
          </details>
        ) : null}
      </div>
      {retry ? (
        <Button
          className="col-start-2 justify-self-start sm:col-start-3 sm:row-start-1 sm:row-span-2 sm:justify-self-end"
          variant="outline"
          onClick={retry}
        >
          {t("query.retry")}
        </Button>
      ) : null}
    </div>
  );
}

export function SafeQueryError({
  title,
  error,
  operation,
  retry,
}: {
  title?: string;
  error: unknown;
  operation: FailureOperation;
  retry?: () => void;
}) {
  const { t } = useI18n();
  const presentation = presentFailure(error, operation, t);
  return (
    <QueryError
      {...(title ? { title } : {})}
      message={presentation.message}
      {...(presentation.diagnostic
        ? { diagnostic: presentation.diagnostic }
        : {})}
      {...(retry ? { retry } : {})}
    />
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
      className="grid min-w-0 gap-4 rounded-panel bg-surface-soft/80 p-5 text-left sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-6 sm:px-6 sm:py-5"
    >
      <div className="min-w-0">
        <p className="font-medium">{title}</p>
        <p className="mt-1 max-w-[65ch] text-sm leading-6 text-muted-foreground">
          {description}
        </p>
      </div>
      {action}
    </div>
  );
}
