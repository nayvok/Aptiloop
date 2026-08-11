"use client";

import {
  LearningReviewsResponseSchema,
  type LearningReviewQueueItem,
} from "@aptiloop/shared";
import {
  CalendarBlankIcon,
  CaretDownIcon,
  DotsThreeVerticalIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { EmptyState, QueryError } from "@/components/query-state";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { api } from "@/lib/api";
import { type MessageKey, useI18n } from "@/lib/i18n";

type ReviewItem = LearningReviewQueueItem;

const reasonLabels: Readonly<Record<string, MessageKey>> = {
  mistake: "cards.reason.mistake",
  low_mastery: "cards.reason.lowMastery",
};
const activityLabels: Readonly<Record<string, MessageKey>> = {
  recall: "cards.activity.recall",
  correction: "cards.activity.correction",
};
const dimensionLabels: Readonly<Record<string, MessageKey>> = {
  understanding: "skills.dimension.understanding",
  explanation: "skills.dimension.explanation",
  codeReading: "skills.dimension.codeReading",
  implementation: "skills.dimension.implementation",
  debugging: "skills.dimension.debugging",
  interview: "skills.dimension.interview",
};
const historyStates = ["completed", "dismissed", "superseded"] as const;

function ReviewRow({
  review,
  dismissing,
  onDismiss,
}: {
  review: ReviewItem;
  dismissing: boolean;
  onDismiss: (review: ReviewItem) => void;
}) {
  const { formatDate, t } = useI18n();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const reasonLabel = reasonLabels[review.reasonCode];
  const activityLabel = activityLabels[review.activityKind];
  const dimensionLabel = dimensionLabels[review.dimension];
  const reviewReason = reasonLabel ? t(reasonLabel) : review.reasonCode;
  const canDismiss = review.state === "pending" && review.activityId !== null;

  return (
    <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
      <article
        data-slot="review-row"
        className="grid min-w-0 gap-4 py-4 sm:py-5 xl:grid-cols-[minmax(0,0.78fr)_minmax(0,1.22fr)_auto] xl:items-start"
      >
        <header className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Badge
              variant={
                review.state === "pending"
                  ? "warning"
                  : review.state === "completed"
                    ? "success"
                    : "secondary"
              }
            >
              {t(`cards.status.${review.state}` as MessageKey)}
            </Badge>
            <span className="inline-flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
              <CalendarBlankIcon aria-hidden />
              <span className="break-words">
                {t("cards.dueAt", { date: formatDate(review.dueAt) })}
              </span>
            </span>
          </div>
          <h2 className="mt-2 break-words text-base font-semibold leading-6 [overflow-wrap:anywhere]">
            {review.topic}
          </h2>
          <p className="mt-1 break-all font-mono text-xs leading-5 text-muted-foreground">
            {review.knowledgeNodeId}
          </p>
        </header>

        <div className="grid min-w-0 gap-3 sm:grid-cols-2 sm:gap-5">
          <div className="min-w-0">
            <h3 className="text-xs font-medium text-muted-foreground">
              {t("cards.reviewReason")}
            </h3>
            <p className="mt-1 break-words text-sm font-medium leading-6 [overflow-wrap:anywhere]">
              {reviewReason}
            </p>
            <p className="mt-1 break-words text-xs leading-5 text-muted-foreground [overflow-wrap:anywhere]">
              {t("cards.dimensionValue", {
                dimension: dimensionLabel
                  ? t(dimensionLabel)
                  : review.dimension,
              })}
            </p>
          </div>
          <div className="min-w-0">
            <h3 className="text-xs font-medium text-muted-foreground">
              {t("cards.evidenceBasis")}
            </h3>
            <p className="mt-1 break-words text-sm leading-6 [overflow-wrap:anywhere]">
              {activityLabel ? t(activityLabel) : review.activityKind}
            </p>
            <p className="mt-1 break-all font-mono text-xs leading-5 text-muted-foreground">
              {t("cards.sourceSession", { session: review.sessionId })}
            </p>
          </div>
        </div>

        <div className="flex min-w-0 items-start justify-end">
          {canDismiss ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`${t("cards.dismiss")}: ${review.topic}`}
                  aria-busy={dismissing}
                  disabled={dismissing}
                >
                  {dismissing ? (
                    <Spinner aria-hidden />
                  ) : (
                    <DotsThreeVerticalIcon aria-hidden weight="bold" />
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuGroup>
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={() => setConfirmOpen(true)}
                  >
                    <XIcon aria-hidden />
                    {t("cards.dismiss")}
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </article>

      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>{t("cards.dismiss")}</AlertDialogTitle>
          <AlertDialogDescription>
            <span className="block break-words font-medium text-foreground [overflow-wrap:anywhere]">
              {review.topic}
            </span>
            <span className="mt-1 block break-words [overflow-wrap:anywhere]">
              {t("cards.reviewReason")}: {reviewReason}
            </span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("ui.close")}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={dismissing}
            onClick={() => onDismiss(review)}
          >
            {dismissing ? <Spinner data-icon="inline-start" /> : null}
            {t("cards.dismiss")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function ReviewQueueClient({ dueOnly = false }: { dueOnly?: boolean }) {
  const client = useQueryClient();
  const { formatNumber, t } = useI18n();
  const query = useQuery({
    queryKey: ["learning-reviews"],
    queryFn: async () =>
      LearningReviewsResponseSchema.parse(
        await api<unknown>("/learning/reviews"),
      ),
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
    onSuccess: () => {
      toast.success(t("cards.status.dismissed"));
      void client.invalidateQueries({ queryKey: ["learning-reviews"] });
    },
    onError: () =>
      toast.error(t("cards.saveError"), {
        description: t("query.retry"),
      }),
  });

  if (query.isLoading) {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-label={t("cards.loading")}
        className="divide-y divide-border/70 border-y border-border/70"
      >
        <span className="sr-only">{t("cards.loading")}</span>
        {[0, 1].map((row) => (
          <div
            key={row}
            aria-hidden
            className="grid gap-4 py-5 xl:grid-cols-[minmax(0,0.78fr)_minmax(0,1.22fr)_2.25rem]"
          >
            <div className="flex flex-col gap-3">
              <Skeleton className="h-5 w-28" />
              <Skeleton className="h-5 w-52 max-w-[80%]" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Skeleton className="h-14" />
              <Skeleton className="h-14" />
            </div>
          </div>
        ))}
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

  const pendingReviews = query.data.reviews.filter(
    (review) => review.state === "pending",
  );
  const visibleReviews = dueOnly
    ? pendingReviews.filter((review) => review.isDue)
    : pendingReviews;
  const historyReviews = query.data.reviews.filter(
    (review) => review.state !== "pending",
  );

  if (
    query.data.reviews.length === 0 ||
    (dueOnly && visibleReviews.length === 0)
  ) {
    return dueOnly ? (
      <EmptyState
        title={t("review.empty.title")}
        description={t("review.empty.description")}
        action={
          <Button asChild variant="outline">
            <Link href="/courses">{t("review.goToCourses")}</Link>
          </Button>
        }
      />
    ) : (
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
  const hasDueReview = visibleReviews.some((review) => review.isDue);
  const dismissingId = dismiss.isPending ? dismiss.variables?.id : undefined;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="inline-flex min-w-0 flex-wrap items-baseline gap-2 text-sm">
          {dueOnly ? (
            t("review.dueCount", {
              count: formatNumber(visibleReviews.length),
            })
          ) : (
            <>
              <span className="text-muted-foreground">
                {t("cards.status.pending")}
              </span>
              <strong className="font-mono text-xs font-semibold tabular-nums">
                {formatNumber(visibleReviews.length)}
              </strong>
            </>
          )}
        </p>
      </div>

      {hasDueReview ? (
        <p
          data-slot="review-action-unavailable"
          className="max-w-[70ch] border-l-2 border-border pl-3 text-sm leading-6 text-muted-foreground"
        >
          {t("review.actionUnavailable")}
        </p>
      ) : null}

      {visibleReviews.length ? (
        <div
          data-slot="review-list"
          className="divide-y divide-border/70 border-y border-border/70"
        >
          {visibleReviews.map((review) => (
            <ReviewRow
              key={review.id}
              review={review}
              dismissing={dismissingId === review.id}
              onDismiss={(item) => dismiss.mutate(item)}
            />
          ))}
        </div>
      ) : (
        <div className="border-y border-border/70 py-6">
          <h2 className="font-semibold">{t("cards.empty.title")}</h2>
          <p className="mt-1 max-w-[70ch] text-sm leading-6 text-muted-foreground">
            {t("cards.empty.description")}
          </p>
        </div>
      )}

      {!dueOnly && historyReviews.length ? (
        <Collapsible className="border-b border-border/70">
          <CollapsibleTrigger
            aria-label={t("review.viewDescription.cards")}
            className="group/history flex min-h-11 w-full min-w-0 items-center justify-between gap-3 py-3 text-left outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <span className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-2 text-sm">
              {historyStates
                .filter((status) => (counts[status] ?? 0) > 0)
                .map((status) => (
                  <span
                    key={status}
                    className="inline-flex items-baseline gap-2"
                  >
                    <span className="text-muted-foreground">
                      {t(`cards.status.${status}` as MessageKey)}
                    </span>
                    <span className="font-mono text-xs font-semibold tabular-nums">
                      {formatNumber(counts[status] ?? 0)}
                    </span>
                  </span>
                ))}
            </span>
            <CaretDownIcon
              aria-hidden
              className="shrink-0 transition-transform duration-150 group-data-[state=open]/history:rotate-180 motion-reduce:transition-none"
            />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="divide-y divide-border/70 border-t border-border/70">
              {historyReviews.map((review) => (
                <ReviewRow
                  key={review.id}
                  review={review}
                  dismissing={false}
                  onDismiss={(item) => dismiss.mutate(item)}
                />
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </div>
  );
}
