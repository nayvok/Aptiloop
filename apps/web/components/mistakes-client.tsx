"use client";

import {
  LearningMistakesResponseSchema,
  type LearningMistakeItem,
} from "@aptiloop/shared";
import { ArrowRightIcon, CalendarBlankIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { EmptyState, QueryError } from "@/components/query-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

export function MistakesClient() {
  const { formatDate, formatNumber, t } = useI18n();
  const query = useQuery({
    queryKey: ["learning-mistakes"],
    queryFn: async () =>
      LearningMistakesResponseSchema.parse(
        await api<unknown>("/learning/mistakes"),
      ),
  });
  if (query.isLoading) {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-label={t("mistakes.loading")}
        className="divide-y divide-border/70 border-y border-border/70"
      >
        <span className="sr-only">{t("mistakes.loading")}</span>
        {[0, 1].map((row) => (
          <div
            key={row}
            aria-hidden
            className="grid gap-4 py-5 xl:grid-cols-[minmax(0,0.72fr)_minmax(0,1fr)_minmax(0,1fr)]"
          >
            <div className="flex flex-col gap-3">
              <Skeleton className="h-5 w-44 max-w-[75%]" />
              <Skeleton className="h-4 w-32" />
            </div>
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
          </div>
        ))}
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
  const dueCount = query.data.mistakes.filter(
    (mistake: LearningMistakeItem) => mistake.isDue,
  ).length;
  return (
    <div className="flex min-w-0 flex-col gap-4">
      {dueCount > 0 ? (
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm font-medium">
            {t("review.dueCount", { count: formatNumber(dueCount) })}
          </p>
          <Button asChild size="sm" className="w-full sm:w-auto">
            <Link href="/review">
              {t("review.view.due")}
              <ArrowRightIcon data-icon="inline-end" aria-hidden />
            </Link>
          </Button>
        </div>
      ) : null}

      <div className="divide-y divide-border/70 border-y border-border/70">
        {query.data.mistakes.map((mistake) => (
          <article
            key={mistake.id}
            className="grid min-w-0 gap-4 py-4 sm:py-5 xl:grid-cols-[minmax(0,0.72fr)_minmax(0,1fr)_minmax(0,1fr)] xl:gap-6"
          >
            <header className="min-w-0">
              <h2 className="break-words font-semibold leading-6 [overflow-wrap:anywhere]">
                {mistake.topic}
              </h2>
              <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
                {mistake.occurrenceCount > 1 ? (
                  <Badge variant="error">{t("mistakes.repeated")}</Badge>
                ) : null}
                <span className="inline-flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                  <CalendarBlankIcon aria-hidden />
                  <span className="break-words">
                    {t("mistakes.dueDate", {
                      date: formatDate(mistake.reviewAt),
                    })}
                  </span>
                </span>
              </div>
            </header>
            <div className="min-w-0">
              <h3 className="text-xs font-medium text-muted-foreground">
                {t("mistakes.whyDue")}
              </h3>
              <p className="mt-1 break-words text-sm font-medium leading-6 [overflow-wrap:anywhere]">
                {mistake.errorFamily}
              </p>
              <p className="mt-3 text-xs font-medium text-muted-foreground">
                {t("mistakes.evidenceBasis")}
              </p>
              <p className="mt-1 text-sm leading-6">
                {t("mistakes.occurrences", {
                  count: formatNumber(mistake.occurrenceCount),
                })}
              </p>
            </div>
            <div className="min-w-0">
              <h3 className="text-xs font-medium text-muted-foreground">
                {t("mistakes.correction")}
              </h3>
              <p className="mt-1 break-words text-sm leading-6">
                {t("mistakes.correctThroughReview")}
              </p>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
