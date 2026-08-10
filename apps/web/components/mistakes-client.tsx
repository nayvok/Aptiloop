"use client";

import { CalendarBlankIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";

import { EmptyState, QueryError } from "@/components/query-state";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

type Mistake = {
  id: string;
  topic: string;
  errorFamily: string;
  occurrenceCount: number;
  reviewAt: string;
};

export function MistakesClient() {
  const { formatDate, t } = useI18n();
  const query = useQuery({
    queryKey: ["learning-mistakes"],
    queryFn: () => api<{ mistakes: Mistake[] }>("/learning/mistakes"),
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
          <div className="space-y-2">
            <p className="text-sm font-medium">{mistake.topic}</p>
            {mistake.occurrenceCount > 1 ? (
              <Badge variant="error">{t("mistakes.repeated")}</Badge>
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
            <p className="mt-2 text-sm leading-6">{mistake.errorFamily}</p>
            <p className="mt-3 text-xs leading-5 text-muted-foreground">
              {t("mistakes.occurrences", {
                count: mistake.occurrenceCount,
              })}
            </p>
          </div>
          <div>
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("mistakes.correction")}
            </h3>
            <p className="mt-2 text-sm leading-6">
              {t("mistakes.correctThroughReview")}
            </p>
          </div>
        </article>
      ))}
    </div>
  );
}
