"use client";

import {
  ArrowCounterClockwiseIcon,
  CalendarBlankIcon,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";

import { EmptyState, QueryError } from "@/components/query-state";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

type Mistake = {
  id: string;
  topic: string;
  thought: string;
  correction: string;
  cause: string;
  repeated: boolean;
  reviewAt: string;
};

export function MistakesClient() {
  const { formatDate, t } = useI18n();
  const query = useQuery({
    queryKey: ["mistakes"],
    queryFn: () => api<{ mistakes: Mistake[] }>("/mistakes"),
  });
  if (query.isLoading) {
    return (
      <div role="status" aria-label={t("mistakes.loading")}>
        <Skeleton aria-hidden className="h-80" />
        <span className="sr-only">{t("mistakes.loading")}</span>
      </div>
    );
  }
  if (query.isError || !query.data) {
    return (
      <QueryError
        message={t("mistakes.unavailable")}
        retry={() => void query.refetch()}
      />
    );
  }
  if (!query.data.mistakes.length) {
    return (
      <EmptyState
        title={t("mistakes.empty.title")}
        description={t("mistakes.empty.description")}
      />
    );
  }
  return (
    <div className="divide-y divide-border border-y border-border">
      {query.data.mistakes.map((mistake) => (
        <article
          key={mistake.id}
          className="grid gap-4 py-5 lg:grid-cols-[180px_1fr_1fr]"
        >
          <div className="flex flex-col items-start gap-2">
            <Badge variant="outline">{mistake.topic}</Badge>
            {mistake.repeated ? (
              <Badge variant="warning">
                <ArrowCounterClockwiseIcon aria-hidden />
                {t("mistakes.repeated")}
              </Badge>
            ) : null}
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <CalendarBlankIcon aria-hidden />
              {formatDate(mistake.reviewAt)}
            </span>
          </div>
          <div>
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("mistakes.previous")}
            </h3>
            <p className="mt-2 text-sm leading-6">{mistake.thought}</p>
            <p className="mt-3 text-xs leading-5 text-muted-foreground">
              {t("mistakes.cause", { cause: mistake.cause })}
            </p>
          </div>
          <div>
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("mistakes.correction")}
            </h3>
            <p className="mt-2 text-sm leading-6">{mistake.correction}</p>
          </div>
        </article>
      ))}
    </div>
  );
}
