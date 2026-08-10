"use client";

import { CalendarBlankIcon, XIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { EmptyState, QueryError } from "@/components/query-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { type MessageKey, useI18n } from "@/lib/i18n";

type ReviewItem = {
  id: string;
  topic: string;
  knowledgeNodeId: string;
  dimension: string;
  activityKind: string;
  reasonCode: string;
  dueAt: string;
  state: "pending" | "completed" | "dismissed" | "superseded";
  sessionId: string;
  activityId: string | null;
};

export function FlashcardsClient() {
  const client = useQueryClient();
  const { formatDate, t } = useI18n();
  const query = useQuery({
    queryKey: ["learning-reviews"],
    queryFn: () => api<{ reviews: ReviewItem[] }>("/learning/reviews"),
  });
  const dismiss = useMutation({
    mutationFn: (review: ReviewItem) => {
      if (!review.activityId) {
        throw new Error("Review item has no source activity.");
      }
      return api(
        `/learning/sessions/v2/${review.sessionId}/kernel/activities/${review.activityId}/reviews/${review.id}/dismiss`,
        {
          method: "POST",
          body: JSON.stringify({ operationId: crypto.randomUUID() }),
        },
      );
    },
    onSuccess: () =>
      client.invalidateQueries({ queryKey: ["learning-reviews"] }),
  });
  if (query.isLoading) {
    return (
      <div role="status" aria-label={t("cards.loading")}>
        <Skeleton aria-hidden className="h-80" />
        <span className="sr-only">{t("cards.loading")}</span>
      </div>
    );
  }
  if (query.isError || !query.data) {
    return (
      <QueryError
        message={t("cards.unavailable")}
        retry={() => void query.refetch()}
      />
    );
  }
  if (query.data.reviews.length === 0) {
    return (
      <EmptyState
        title={t("cards.empty.title")}
        description={t("cards.empty.description")}
      />
    );
  }
  const counts = query.data.reviews.reduce(
    (result, review) => ({
      ...result,
      [review.state]: (result[review.state] ?? 0) + 1,
    }),
    {} as Partial<Record<ReviewItem["state"], number>>,
  );
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        {(["pending", "completed", "dismissed"] as const).map((status) => (
          <div key={status} className="rounded-xl bg-muted/60 p-3 text-sm">
            <span className="text-muted-foreground">
              {t(`cards.status.${status}` as MessageKey)}
            </span>
            <strong className="ml-2">{counts[status] ?? 0}</strong>
          </div>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {query.data.reviews.map((review) => (
          <article key={review.id} className="rounded-2xl border p-5">
            <div className="flex items-center justify-between gap-3">
              <Badge
                variant={review.state === "pending" ? "warning" : "secondary"}
              >
                {t(`cards.status.${review.state}` as MessageKey)}
              </Badge>
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <CalendarBlankIcon aria-hidden />
                {formatDate(review.dueAt)}
              </span>
            </div>
            <div className="mt-4 space-y-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t("cards.topic")}
                </p>
                <p className="mt-1 text-sm font-medium">{review.topic}</p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t("cards.reviewReason")}
                </p>
                <p className="mt-1 text-sm">
                  {t("cards.reviewDetail", {
                    dimension: review.dimension,
                    reason: review.reasonCode,
                  })}
                </p>
              </div>
            </div>
            {review.state === "pending" && review.activityId ? (
              <div className="mt-4 flex justify-end">
                <Button
                  aria-label={t("cards.dismiss")}
                  aria-busy={
                    dismiss.isPending && dismiss.variables?.id === review.id
                  }
                  size="icon"
                  variant="ghost"
                  disabled={
                    dismiss.isPending && dismiss.variables?.id === review.id
                  }
                  onClick={() => dismiss.mutate(review)}
                >
                  <XIcon aria-hidden />
                </Button>
              </div>
            ) : null}
          </article>
        ))}
      </div>
      {dismiss.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {t("cards.saveError")}
        </p>
      ) : null}
    </div>
  );
}
