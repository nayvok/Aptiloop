"use client";

import {
  LearningReviewActivityResponseSchema,
  LearningReviewSubmissionResponseSchema,
  LearningReviewSubmissionSchema,
  type LearningReviewSubmission,
} from "@aptiloop/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";

import { ActivityFrame } from "@/components/activity-frame";
import { QueryError } from "@/components/query-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import { LoadingState } from "@/components/ui/loading-state";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { type MessageKey, useI18n } from "@/lib/i18n";
import { unitTypeMessageKeys } from "@/lib/unit-labels";

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

type SubmissionDraft = {
  executionId: string;
  activitySnapshotHash: string;
  executionContextHash: string;
  operationId: string;
  text: string;
};

export function ReviewActivityClient({
  executionId,
  onExit,
  onComplete,
}: {
  executionId: string;
  onExit: () => void;
  onComplete: (nextDueAt: string) => void;
}) {
  const client = useQueryClient();
  const { formatDate, formatNumber, t } = useI18n();
  const formId = useId();
  const responseId = useId();
  const responseHintId = useId();
  const responseCountId = useId();
  const validationErrorId = useId();
  const submissionErrorId = useId();
  const activityRootRef = useRef<HTMLDivElement>(null);
  const [response, setResponse] = useState("");
  const [hasInvalidResponse, setHasInvalidResponse] = useState(false);
  const [retryDraft, setRetryDraft] = useState<SubmissionDraft | null>(null);

  const query = useQuery({
    queryKey: ["learning-review-execution", executionId],
    queryFn: async () => {
      const parsed = LearningReviewActivityResponseSchema.parse(
        await api<unknown>(
          `/learning/reviews/executions/${encodeURIComponent(executionId)}`,
        ),
      );
      if (parsed.activity.executionId !== executionId) {
        throw new Error("Review execution identity mismatch");
      }
      return parsed.activity;
    },
  });

  const submission = useMutation({
    mutationFn: async (body: LearningReviewSubmission) =>
      LearningReviewSubmissionResponseSchema.parse(
        await api<unknown>(
          `/learning/reviews/executions/${encodeURIComponent(executionId)}/submissions`,
          {
            method: "POST",
            body: JSON.stringify(LearningReviewSubmissionSchema.parse(body)),
          },
        ),
      ),
    onSuccess: async (result) => {
      setRetryDraft(null);
      await Promise.all([
        client.invalidateQueries({ queryKey: ["learning-reviews"] }),
        client.invalidateQueries({
          queryKey: ["learning-review-execution", executionId],
          refetchType: "none",
        }),
      ]);
      toast.success(t("review.activity.complete"), {
        description: t("review.activity.nextDue", {
          date: formatDate(result.nextReview.dueAt),
        }),
      });
      onComplete(result.nextReview.dueAt);
    },
  });

  useEffect(() => {
    if (!query.data) return;
    const heading = activityRootRef.current?.querySelector("h2");
    if (!(heading instanceof HTMLElement)) return;
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  }, [executionId, query.data]);

  if (query.isLoading) {
    return <LoadingState label="review.activity.loading" variant="panel" />;
  }

  if (query.isError || !query.data) {
    return (
      <div className="grid min-w-0 gap-4">
        <QueryError
          title={t("review.activity.unavailableTitle")}
          message={t("review.activity.unavailableDescription")}
          retry={() => void query.refetch()}
        />
        <Button
          type="button"
          variant="outline"
          className="justify-self-start"
          onClick={onExit}
        >
          {t("review.activity.back")}
        </Button>
      </div>
    );
  }

  const activity = query.data;
  const activityLabel =
    activityLabels[activity.activityKind] ?? "ui.unknownValue";
  const reasonLabel = reasonLabels[activity.reasonCode] ?? "ui.unknownValue";
  const dimensionLabel =
    dimensionLabels[activity.dimension] ?? "ui.unknownValue";
  const trimmedResponse = response.trim();
  const responseIsValid =
    trimmedResponse.length >= activity.response.minimumLength &&
    trimmedResponse.length <= activity.response.maximumLength;
  const describedBy = [
    responseHintId,
    responseCountId,
    hasInvalidResponse ? validationErrorId : null,
    submission.isError ? submissionErrorId : null,
  ]
    .filter(Boolean)
    .join(" ");

  const submit = () => {
    if (!responseIsValid) {
      setHasInvalidResponse(true);
      return;
    }
    setHasInvalidResponse(false);
    const reusable =
      retryDraft?.executionId === executionId &&
      retryDraft.activitySnapshotHash === activity.activitySnapshotHash &&
      retryDraft.executionContextHash === activity.executionContextHash &&
      retryDraft.text === trimmedResponse;
    const draft: SubmissionDraft = reusable
      ? retryDraft
      : {
          executionId,
          activitySnapshotHash: activity.activitySnapshotHash,
          executionContextHash: activity.executionContextHash,
          operationId: globalThis.crypto.randomUUID(),
          text: trimmedResponse,
        };
    setRetryDraft(draft);
    submission.mutate({
      operationId: draft.operationId,
      executionContextHash: draft.executionContextHash,
      response: { type: "free-response", text: draft.text },
    });
  };

  return (
    <div ref={activityRootRef}>
      <ActivityFrame
        activityId={activity.executionId}
        activityType="review"
        title={activity.title}
        description={activity.description}
        className="rounded-panel bg-surface-soft/35 p-4 sm:p-6"
        slots={{
          accessibility: (
            <p className="sr-only" role="status" aria-live="polite">
              {submission.isPending ? t("review.activity.submitting") : ""}
            </p>
          ),
          context: (
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{t("review.activity.badge")}</Badge>
              <Badge variant="secondary">{t(activityLabel)}</Badge>
            </div>
          ),
          status: (
            <Badge variant="warning">{t("review.activity.statusDue")}</Badge>
          ),
          evidence: (
            <dl className="grid min-w-0 gap-4 text-sm sm:grid-cols-2">
              <div className="min-w-0">
                <dt className="text-xs font-medium text-muted-foreground">
                  {t("review.activity.metadata.due")}
                </dt>
                <dd className="mt-1 font-medium">
                  {formatDate(activity.dueAt)}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-xs font-medium text-muted-foreground">
                  {t("review.activity.metadata.sourceEvidence")}
                </dt>
                <dd className="mt-1 font-medium">
                  {formatDate(activity.sourceEvidenceAt)}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-xs font-medium text-muted-foreground">
                  {t("review.activity.metadata.sourceActivity")}
                </dt>
                <dd className="mt-1 font-medium">
                  {t(unitTypeMessageKeys[activity.sourceActivityType])}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-xs font-medium text-muted-foreground">
                  {t("review.activity.metadata.dimension")}
                </dt>
                <dd className="mt-1 font-medium">{t(dimensionLabel)}</dd>
              </div>
              <div className="min-w-0 sm:col-span-2">
                <dt className="text-xs font-medium text-muted-foreground">
                  {t("cards.reviewReason")}
                </dt>
                <dd className="mt-1 leading-6">{t(reasonLabel)}</dd>
              </div>
            </dl>
          ),
          actions: (
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
              <Button
                type="button"
                variant="outline"
                disabled={submission.isPending}
                onClick={onExit}
              >
                {t("review.activity.back")}
              </Button>
              <Button
                type="submit"
                form={formId}
                disabled={submission.isPending}
              >
                {submission.isPending ? (
                  <Spinner data-icon="inline-start" />
                ) : null}
                {t(
                  submission.isPending
                    ? "review.activity.submitting"
                    : "review.activity.submit",
                )}
              </Button>
            </div>
          ),
        }}
      >
        <form
          id={formId}
          noValidate
          aria-busy={submission.isPending}
          className="grid min-w-0 gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <section aria-labelledby={`${formId}-prompt`}>
            <h3 id={`${formId}-prompt`} className="text-base font-semibold">
              {t("review.activity.promptHeading")}
            </h3>
            <p className="mt-2 max-w-[72ch] whitespace-pre-wrap break-words text-[0.9375rem] leading-7 [overflow-wrap:anywhere]">
              {activity.prompt}
            </p>
          </section>

          <Field data-invalid={hasInvalidResponse || undefined}>
            <FieldLabel htmlFor={responseId}>
              {t("review.activity.responseLabel")}
            </FieldLabel>
            <Textarea
              id={responseId}
              value={response}
              required
              maxLength={activity.response.maximumLength}
              rows={9}
              disabled={submission.isPending}
              aria-invalid={hasInvalidResponse || undefined}
              aria-describedby={describedBy}
              placeholder={t("review.activity.responsePlaceholder")}
              className="min-h-48"
              onChange={(event) => {
                setResponse(event.target.value);
                setHasInvalidResponse(false);
                setRetryDraft(null);
                if (submission.isError) submission.reset();
              }}
            />
            <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
              <FieldDescription id={responseHintId}>
                {t("review.activity.responseHint")}
              </FieldDescription>
              <p
                id={responseCountId}
                className="shrink-0 text-xs leading-5 text-muted-foreground"
              >
                {t("review.activity.characters", {
                  count: formatNumber(response.length),
                  maximum: formatNumber(activity.response.maximumLength),
                })}
              </p>
            </div>
            {hasInvalidResponse ? (
              <FieldError id={validationErrorId}>
                {t("review.activity.invalidResponse")}
              </FieldError>
            ) : null}
            {submission.isError ? (
              <div
                id={submissionErrorId}
                role="alert"
                className="rounded-control bg-destructive/10 px-3 py-2 text-sm leading-6 text-destructive"
              >
                <span className="font-medium">
                  {t("review.activity.submitError")}
                </span>{" "}
                {t("review.activity.submitErrorDescription")}
              </div>
            ) : null}
          </Field>
        </form>
      </ActivityFrame>
    </div>
  );
}
