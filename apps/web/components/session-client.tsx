"use client";

import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowUpRightIcon,
  ArrowRightIcon,
  CheckIcon,
  CircleIcon,
  ClockIcon,
  ListIcon,
  PaperPlaneTiltIcon,
  StopIcon,
} from "@phosphor-icons/react";
import { z } from "zod";

import { ActivityFrame } from "@/components/activity-frame";
import { api, streamAgent } from "@/lib/api";
import {
  activityBorderClass,
  activityColorClass,
  activitySurfaceClass,
  depthMessageKey,
  sourceKindMessageKey,
  unitStatusMessageKeys,
  unitTypeMessageKeys,
} from "@/lib/unit-labels";
import { useI18n } from "@/lib/i18n";
import { DayPlanSheet } from "@/components/day-plan";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { EmptyState, QueryError } from "@/components/query-state";
import { Skeleton } from "@/components/ui/skeleton";
import { groupDayIntoBlocks, type LearningBlock } from "@/lib/learning-blocks";
import { formatDuration, formatMinutesShort } from "@/lib/time";
import { cn } from "@/lib/utils";

const protectedFields = new Set([
  "referenceAnswer",
  "evaluationPoints",
  "correctOptionIds",
  "commonMistakes",
  "misconceptions",
  "protectedEvaluation",
]);

const idSchema = z.string().trim().min(1);
const unitStatusSchema = z.enum([
  "locked",
  "ready",
  "in_progress",
  "completed",
  "skipped",
]);
const unitTypeSchema = z.enum([
  "briefing",
  "study",
  "recall",
  "teacher-dialogue",
  "quiz",
  "code-reading",
  "exercise",
  "review",
  "interview",
  "summary",
  "checkpoint",
  "spaced-review",
]);

const checklistItemSchema = z
  .object({
    id: idSchema,
    label: z.string().trim().min(1),
    required: z.boolean(),
  })
  .passthrough();

const questionSchema = z
  .object({
    id: idSchema,
    kind: z.string().trim().min(1),
    prompt: z.string().trim().min(1),
    options: z.array(
      z.object({ id: idSchema, label: z.string().trim().min(1) }).passthrough(),
    ),
  })
  .passthrough();

const completionCriterionSchema = z
  .object({
    type: z.enum([
      "acknowledgement",
      "checklist",
      "attempts",
      "dialogue",
      "score",
      "fields",
      "exercise",
      "custom",
    ]),
    requiredItemIds: z.array(idSchema).optional(),
    minimum: z.number().optional(),
    minimumTurns: z.number().optional(),
    requiresRevision: z.boolean().optional(),
    required: z.array(z.string()).optional(),
    passingTestsRequired: z.boolean().optional(),
    acceptedReviewRequired: z.boolean().optional(),
    key: z.string().optional(),
  })
  .passthrough();

const unitPayloadSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("briefing"),
      scope: z.array(z.string()),
      outOfScope: z.array(z.string()).default([]),
    })
    .passthrough(),
  z
    .object({ type: z.literal("study"), body: z.string().optional() })
    .passthrough(),
  z.object({ type: z.literal("recall"), prompt: z.string() }).passthrough(),
  z
    .object({
      type: z.literal("teacher-dialogue"),
      openingPrompt: z.string(),
      minimumTurns: z.number().int().positive(),
      requiresRevision: z.boolean(),
    })
    .passthrough(),
  z
    .object({
      type: z.literal("quiz"),
      questionIds: z.array(idSchema),
      minimumScore: z.number().min(0).max(1),
    })
    .passthrough(),
  z
    .object({ type: z.literal("code-reading"), snippet: z.string() })
    .passthrough(),
  z
    .object({
      type: z.literal("exercise"),
      exerciseId: idSchema,
      acceptanceCriteria: z.array(z.string()),
      constraints: z.array(z.string()),
      template: z.string(),
      testCommandId: idSchema,
      hintPolicy: z.string(),
      reviewPolicy: z.string(),
    })
    .passthrough(),
  z
    .object({ type: z.literal("review"), exerciseUnitId: idSchema })
    .passthrough(),
  z
    .object({ type: z.literal("interview"), topics: z.array(z.string()) })
    .passthrough(),
  z
    .object({ type: z.literal("summary"), prompts: z.array(z.string()) })
    .passthrough(),
  z.object({ type: z.literal("checkpoint"), label: z.string() }).passthrough(),
  z
    .object({ type: z.literal("spaced-review"), topicIds: z.array(idSchema) })
    .passthrough(),
]);

const learnerUnitSchema = z
  .object({
    id: idSchema,
    stableId: idSchema,
    type: unitTypeSchema,
    title: z.string().trim().min(1),
    description: z.string().trim().min(1),
    order: z.number().int().positive(),
    estimatedMinutes: z.number().int().nonnegative(),
    objectives: z.array(z.string()),
    checklist: z.array(checklistItemSchema),
    sources: z.array(
      z
        .object({
          id: idSchema,
          title: z.string().trim().min(1),
          url: z.string().nullable(),
          kind: z.string().trim().min(1),
          required: z.boolean(),
          estimatedMinutes: z.number().int().nonnegative(),
          description: z.string().optional(),
          learningGoal: z.string().optional(),
        })
        .passthrough(),
    ),
    questions: z.array(questionSchema),
    completionCriteria: z.array(completionCriterionSchema),
    unlockRules: z.array(z.unknown()),
    optional: z.boolean(),
    depthLevel: z.enum(["foundation", "interview-ready", "deep-dive"]),
    payload: unitPayloadSchema,
  })
  .passthrough()
  .superRefine((unit, context) => {
    if (unit.type !== unit.payload.type) {
      context.addIssue({
        code: "custom",
        path: ["payload", "type"],
        message: "Unit payload type does not match unit type",
      });
    }
  });

const progressPayloadSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("briefing"),
      acknowledged: z.boolean(),
      checkedItemIds: z.array(idSchema),
    })
    .passthrough(),
  z
    .object({
      type: z.literal("study"),
      checkedItemIds: z.array(idSchema),
      notes: z.string(),
    })
    .passthrough(),
  z
    .object({
      type: z.literal("recall"),
      answers: z
        .array(
          z.object({
            questionId: idSchema,
            draft: z.string(),
            firstAttemptId: idSchema,
          }),
        )
        .optional()
        .default([]),
      draft: z.string(),
      firstAttemptId: idSchema.nullable(),
    })
    .passthrough(),
  z
    .object({
      type: z.literal("teacher-dialogue"),
      conversationId: idSchema.nullable(),
      turnCount: z.number().int().nonnegative(),
      revisionAttemptIds: z.array(idSchema),
    })
    .passthrough(),
  z
    .object({
      type: z.literal("quiz"),
      attemptedQuestionIds: z.array(idSchema),
      correctQuestionIds: z.array(idSchema).optional(),
      score: z.number().min(0).max(1).nullable(),
    })
    .passthrough(),
  z
    .object({
      type: z.literal("code-reading"),
      prediction: z.string(),
      explanation: z.string(),
      verbalFix: z.string(),
    })
    .passthrough(),
  z
    .object({
      type: z.literal("exercise"),
      attemptId: idSchema.nullable(),
      latestTestRunId: idSchema.nullable(),
      latestReviewId: idSchema.nullable(),
    })
    .passthrough(),
  z
    .object({
      type: z.literal("review"),
      reviewId: idSchema.nullable(),
      reviewStatus: z
        .enum(["pending", "accepted", "changes_requested"])
        .nullable(),
      reviewedDiffHash: z.string().nullable(),
    })
    .passthrough(),
  z
    .object({
      type: z.literal("interview"),
      interviewSessionId: idSchema.nullable(),
      reportId: idSchema.nullable(),
    })
    .passthrough(),
  z
    .object({ type: z.literal("summary"), summaryId: idSchema.nullable() })
    .passthrough(),
  z
    .object({ type: z.literal("checkpoint"), acknowledged: z.boolean() })
    .passthrough(),
  z
    .object({
      type: z.literal("spaced-review"),
      reviewedTopicIds: z.array(idSchema),
    })
    .passthrough(),
]);

const unitProgressSchema = z
  .object({
    unitId: idSchema,
    unitType: unitTypeSchema,
    status: unitStatusSchema,
    payload: progressPayloadSchema,
    startedAt: z.string().nullable(),
    completedAt: z.string().nullable(),
    skippedAt: z.string().nullable(),
    updatedAt: z.string(),
  })
  .passthrough()
  .superRefine((progress, context) => {
    if (progress.unitType !== progress.payload.type) {
      context.addIssue({
        code: "custom",
        path: ["payload", "type"],
        message: "Progress payload type does not match unit type",
      });
    }
  });

const learnerSessionSchema = z
  .object({
    id: idSchema,
    status: z.enum(["active", "completed"]),
    currentStep: z.string(),
    snapshot: z
      .object({
        schemaVersion: z.number().int().positive(),
        contentHash: z.string(),
        curriculumId: idSchema,
        curriculumVersionId: idSchema,
        curriculumRevision: z.number().int().positive(),
        curriculumTitle: z.string(),
        week: z
          .object({
            id: idSchema,
            stableId: idSchema,
            order: z.number().int().positive(),
            title: z.string(),
            description: z.string().nullable(),
          })
          .passthrough(),
        day: z
          .object({
            id: idSchema,
            stableId: idSchema,
            order: z.number().int().positive(),
            title: z.string(),
            description: z.string(),
            goal: z.string(),
            estimatedMinutes: z.number().int().positive(),
            prerequisites: z.array(z.string()),
            expectedOutcomes: z.array(z.string()),
            depthLevel: z.string(),
            outOfScope: z.array(z.string()),
            topics: z.array(z.string()),
          })
          .passthrough(),
        units: z.array(learnerUnitSchema).min(1),
        capturedAt: z.string(),
      })
      .passthrough(),
    unitProgress: z.array(unitProgressSchema).min(1),
  })
  .passthrough();

const sessionEnvelopeSchema = z
  .object({ session: learnerSessionSchema })
  .passthrough();
const currentSessionEnvelopeSchema = z
  .object({ session: learnerSessionSchema.nullable() })
  .passthrough();

const evidenceBaseSchema = z
  .object({
    id: idSchema,
    operationId: idSchema.optional(),
    payload: z.unknown().optional(),
    createdAt: z.union([z.string(), z.number()]).optional(),
  })
  .passthrough();
const recallResponseSchema = z
  .object({
    evidence: evidenceBaseSchema.extend({
      isFirstAttempt: z.boolean().optional(),
      questionId: idSchema.optional(),
      correctness: z.unknown().optional(),
    }),
    session: learnerSessionSchema,
  })
  .passthrough();
const quizResponseSchema = z
  .object({
    attempt: z
      .object({
        operationId: idSchema,
        score: z.number().min(0).max(1),
        results: z.array(
          z
            .object({ questionId: idSchema, correct: z.boolean() })
            .passthrough(),
        ),
      })
      .passthrough(),
    session: learnerSessionSchema,
  })
  .passthrough();
const codeReadingResponseSchema = z
  .object({ evidence: evidenceBaseSchema, session: learnerSessionSchema })
  .passthrough();
const daySummarySchema = z
  .object({
    sessionId: idSchema,
    occurredAt: z.string().datetime(),
    strengths: z.array(z.string()),
    gaps: z.array(z.string()),
    mistakeCandidates: z.array(
      z
        .object({
          fingerprint: idSchema,
          summary: z.string().min(1),
          correction: z.string().min(1),
          sourceId: idSchema,
        })
        .passthrough(),
    ),
    flashcardCandidates: z.array(
      z
        .object({
          front: z.string().min(1),
          back: z.string().min(1),
          sourceFingerprint: idSchema.optional(),
        })
        .passthrough(),
    ),
    narrative: z.string(),
    metrics: z
      .object({
        topicCount: z.number().int().nonnegative(),
        evidenceCount: z.number().int().nonnegative(),
        correctEvidenceCount: z.number().int().nonnegative(),
        partialEvidenceCount: z.number().int().nonnegative(),
        incorrectEvidenceCount: z.number().int().nonnegative(),
        attemptedActivityCount: z.number().int().nonnegative(),
        quizScore: z.number().min(0).max(1),
        maxHintLevel: z.number().int().min(0).max(5),
        exerciseTestsPassed: z.boolean(),
        reviewStatus: z.enum(["passed", "changes_requested"]).nullable(),
        correctionCycleCount: z.number().int().nonnegative(),
      })
      .passthrough(),
  })
  .passthrough();
const summaryResponseSchema = z
  .object({
    summary: daySummarySchema,
    evidence: z.object({ id: idSchema }).passthrough(),
    session: learnerSessionSchema,
  })
  .passthrough();

export type LearnerSession = z.infer<typeof learnerSessionSchema>;
type LearnerUnit = z.infer<typeof learnerUnitSchema>;
type UnitProgress = z.infer<typeof unitProgressSchema>;
type ProgressPayload = z.infer<typeof progressPayloadSchema>;

function rejectProtectedFields(value: unknown, path = "response"): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      rejectProtectedFields(item, `${path}[${index}]`),
    );
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (protectedFields.has(key)) {
      throw new Error(`Protected curriculum field received: ${path}.${key}`);
    }
    rejectProtectedFields(child, `${path}.${key}`);
  }
}

function parseSessionEnvelope(value: unknown) {
  rejectProtectedFields(value);
  return sessionEnvelopeSchema.parse(value);
}

function parseCurrentSessionEnvelope(value: unknown) {
  rejectProtectedFields(value);
  return currentSessionEnvelopeSchema.parse(value);
}

function operationId(): string {
  return globalThis.crypto.randomUUID();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

export function SessionClient() {
  const { t } = useI18n();
  const params = useSearchParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const requestedSessionId = params.get("id")?.trim() || null;
  const queryKey = requestedSessionId
    ? (["learning-session-v2", requestedSessionId] as const)
    : (["learning-session-current"] as const);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const raw = requestedSessionId
        ? await api<unknown>(
            `/learning/sessions/v2/${encodeURIComponent(requestedSessionId)}`,
          )
        : await api<unknown>("/learning/sessions/current");
      return requestedSessionId
        ? parseSessionEnvelope(raw)
        : parseCurrentSessionEnvelope(raw);
    },
  });

  const session = query.data?.session ?? null;

  async function acceptSession(next: LearnerSession): Promise<void> {
    queryClient.setQueryData(queryKey, { session: next });
    queryClient.setQueryData(["learning-session-v2", next.id], {
      session: next,
    });
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["learning-path"],
        refetchType: "none",
      }),
      queryClient.invalidateQueries({
        queryKey: ["learning-session-current"],
        refetchType: "none",
      }),
      queryClient.invalidateQueries({
        queryKey: ["learning-session-v2", next.id],
        refetchType: "none",
      }),
    ]);
  }

  async function runAction<T>(
    action: string,
    request: () => Promise<T>,
    getSession: (result: T) => LearnerSession,
  ): Promise<T | null> {
    setMutationError(null);
    setPendingAction(action);
    try {
      const result = await request();
      await acceptSession(getSession(result));
      return result;
    } catch (error) {
      setMutationError(errorMessage(error));
      return null;
    } finally {
      setPendingAction(null);
    }
  }

  async function patchUnit(
    unit: LearnerUnit,
    progress: UnitProgress,
    status: Exclude<z.infer<typeof unitStatusSchema>, "locked">,
    payload: ProgressPayload = progress.payload,
  ): Promise<LearnerSession | null> {
    if (!session) return null;
    const result = await runAction(
      `patch:${unit.id}`,
      async () => {
        const raw = await api<unknown>(
          `/learning/sessions/v2/${encodeURIComponent(session.id)}/units/${encodeURIComponent(unit.id)}`,
          {
            method: "PATCH",
            body: JSON.stringify({
              status,
              payload,
              operationId: operationId(),
            }),
          },
        );
        return parseSessionEnvelope(raw);
      },
      (response) => response.session,
    );
    return result?.session ?? null;
  }

  if (query.isPending) {
    return (
      <div
        data-slot="session-loading"
        className="flex flex-col gap-4"
        role="status"
        aria-label={t("session.loading")}
      >
        <span className="sr-only">{t("session.loading")}</span>
        <Skeleton className="h-20" />
        <div className="grid gap-4 md:grid-cols-[14rem_minmax(0,1fr)]">
          <Skeleton className="h-72" />
          <Skeleton className="h-96" />
        </div>
      </div>
    );
  }

  if (query.isError) {
    return (
      <QueryError
        message={errorMessage(query.error)}
        retry={() => void query.refetch()}
      />
    );
  }

  if (!session) {
    return (
      <EmptyState
        title={t("session.empty.title")}
        description={t("session.empty.description")}
        action={
          <Button onClick={() => router.push("/")}>
            {t("session.openHome")}
          </Button>
        }
      />
    );
  }

  const progressByUnit = new Map(
    session.unitProgress.map((item) => [item.unitId, item]),
  );
  const focusedUnit =
    session.snapshot.units.find(
      (unit) => progressByUnit.get(unit.id)?.status === "in_progress",
    ) ??
    session.snapshot.units.find(
      (unit) => progressByUnit.get(unit.id)?.status === "ready",
    ) ??
    [...session.snapshot.units]
      .reverse()
      .find((unit) => progressByUnit.get(unit.id)?.status === "completed") ??
    session.snapshot.units[0];
  if (!focusedUnit) {
    return <QueryError message={t("session.error.noActivities")} />;
  }
  const focusedProgress = progressByUnit.get(focusedUnit.id);
  if (!focusedProgress) {
    return <QueryError message={t("session.error.noProgress")} />;
  }
  const completed = session.unitProgress.filter(
    (item) => item.status === "completed",
  ).length;

  const blocks = groupDayIntoBlocks(
    session.snapshot.units.map((unit) => ({
      id: unit.id,
      type: unit.type,
      title: unit.title,
      estimatedMinutes: unit.estimatedMinutes,
    })),
    (unit) => progressByUnit.get(unit.id)?.status ?? "locked",
  );
  const activeBlock =
    blocks.find(
      (block) => block.status !== "completed" && block.totalCount > 0,
    ) ?? null;
  const activeBlockIndex = activeBlock ? blocks.indexOf(activeBlock) : -1;
  const previousBlockCompleted =
    activeBlockIndex > 0 &&
    blocks[activeBlockIndex - 1]!.status === "completed";
  const showBlockTransition =
    Boolean(activeBlock) &&
    previousBlockCompleted &&
    activeBlock!.currentStepIndex === 1 &&
    focusedProgress.status === "ready" &&
    activeBlock!.currentUnit?.id === focusedUnit.id;

  return (
    <div
      data-slot="guided-session"
      className="flex min-w-0 flex-col gap-4 md:gap-6"
    >
      <SessionProgressHeader
        session={session}
        completed={completed}
        activeBlock={activeBlock}
        activeBlockIndex={activeBlockIndex}
        onContinueLater={() => router.push("/")}
      />

      {mutationError ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
        >
          <span>{mutationError}</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setMutationError(null)}
          >
            {t("session.close")}
          </Button>
        </div>
      ) : null}

      {showBlockTransition && activeBlock ? (
        <BlockTransition
          block={activeBlock}
          blockNumber={activeBlockIndex + 1}
          previousBlocks={blocks.slice(0, activeBlockIndex)}
          starting={pendingAction === `patch:${focusedUnit.id}`}
          onContinue={() =>
            void patchUnit(focusedUnit, focusedProgress, "in_progress")
          }
          onLater={() => router.push("/")}
        />
      ) : focusedProgress.status === "ready" ? (
        <section
          data-slot="unit-ready"
          className="mx-auto flex w-full max-w-xl flex-col items-start gap-4 rounded-xl border border-border bg-card p-6"
        >
          <div className="flex flex-col gap-1">
            <Badge variant="outline">
              {t(unitTypeMessageKeys[focusedUnit.type])}
            </Badge>
            <h2 className="mt-2 text-xl font-semibold">{focusedUnit.title}</h2>
            <p className="mt-1 max-w-[60ch] text-sm leading-6 text-muted-foreground">
              {t("session.ready.description")}
            </p>
          </div>
          <Button
            disabled={pendingAction !== null}
            onClick={() =>
              void patchUnit(focusedUnit, focusedProgress, "in_progress")
            }
          >
            {pendingAction === `patch:${focusedUnit.id}`
              ? t("session.starting")
              : t("session.startActivity")}
            <ArrowRightIcon aria-hidden />
          </Button>
        </section>
      ) : focusedProgress.status === "locked" ? (
        <p className="text-sm text-muted-foreground">{t("session.locked")}</p>
      ) : (
        <UnitShell unit={focusedUnit} progress={focusedProgress}>
          <UnitBody
            session={session}
            unit={focusedUnit}
            progress={focusedProgress}
            pending={pendingAction !== null}
            patchUnit={patchUnit}
            runAction={runAction}
            acceptSession={acceptSession}
            onExercise={() =>
              router.push(
                `/exercise?sessionId=${encodeURIComponent(session.id)}`,
              )
            }
            onInterview={() => {
              const payload = focusedProgress.payload;
              const interviewId =
                payload.type === "interview"
                  ? payload.interviewSessionId
                  : null;
              if (interviewId) {
                router.push(`/interview?id=${encodeURIComponent(interviewId)}`);
              } else {
                router.push(
                  `/interview?sessionId=${encodeURIComponent(session.id)}`,
                );
              }
            }}
          />
        </UnitShell>
      )}
    </div>
  );
}

function SessionProgressHeader({
  session,
  completed,
  activeBlock,
  activeBlockIndex,
  onContinueLater,
}: {
  session: LearnerSession;
  completed: number;
  activeBlock: LearningBlock | null;
  activeBlockIndex: number;
  onContinueLater: () => void;
}) {
  const { locale, t } = useI18n();
  const { day } = session.snapshot;
  const total = session.snapshot.units.length;
  const overall = total ? Math.round((completed / total) * 100) : 0;
  return (
    <header
      data-slot="session-progress-header"
      className="sticky top-0 z-30 -mx-4 border-b border-border bg-background/95 px-4 py-3 backdrop-blur md:-mx-6 md:px-6"
    >
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {t("session.lessonTitle", { order: day.order, title: day.title })}
          </p>
          <p className="truncate text-sm font-semibold">
            {activeBlock ? (
              <>
                {t("session.phaseProgress", {
                  phase: activeBlockIndex + 1,
                  phaseTotal: 3,
                  name: t(activeBlock.label),
                  activity:
                    activeBlock.currentStepIndex ?? activeBlock.totalCount,
                  activityTotal: activeBlock.totalCount,
                })}
              </>
            ) : (
              t("session.lessonComplete")
            )}
          </p>
        </div>
        {activeBlock ? (
          <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
            <ClockIcon aria-hidden className="size-4" />
            {t("session.phaseRemaining", {
              duration: formatDuration(activeBlock.remainingMinutes, locale),
            })}
          </span>
        ) : null}
        <DayPlanSheet
          session={session}
          trigger={
            <Button type="button" variant="outline" size="sm">
              <ListIcon aria-hidden className="size-4" />
              {t("session.plan")}
            </Button>
          }
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onContinueLater}
        >
          {t("session.continueLater")}
        </Button>
      </div>
      <Progress
        aria-label={t("session.progress")}
        value={overall}
        className="mt-2 h-1.5"
      />
    </header>
  );
}

function BlockTransition({
  block,
  blockNumber,
  previousBlocks,
  starting,
  onContinue,
  onLater,
}: {
  block: LearningBlock;
  blockNumber: number;
  previousBlocks: LearningBlock[];
  starting: boolean;
  onContinue: () => void;
  onLater: () => void;
}) {
  const { locale, t } = useI18n();
  const covered = previousBlocks.flatMap((previous) =>
    previous.units.map((unit) => unit.title),
  );
  return (
    <section
      data-slot="block-transition"
      aria-labelledby="block-transition-title"
      className="mx-auto flex w-full max-w-xl flex-col gap-5 rounded-xl border border-border bg-card p-6 md:p-8"
    >
      <div className="text-center">
        <p className="text-sm text-muted-foreground">
          {t("session.transition.complete", {
            phase: blockNumber - 1,
            total: 3,
          })}
        </p>
        <h2 id="block-transition-title" className="mt-1 text-xl font-semibold">
          {t("session.transition.title", { name: t(block.label) })}
        </h2>
      </div>
      {covered.length ? (
        <div className="flex flex-col gap-1.5 text-sm leading-6">
          <p className="font-medium">{t("session.transition.covered")}</p>
          <ul className="flex flex-col gap-1 text-muted-foreground">
            {covered.map((title) => (
              <li key={title} className="flex items-start gap-2">
                <CheckIcon
                  aria-hidden
                  className="relative top-1 size-3 shrink-0 text-success"
                />
                {title}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div
        className={cn(
          "flex flex-col gap-1 rounded-lg border p-4",
          activityBorderClass(block.units[0]?.type ?? "study"),
        )}
      >
        <p className="text-sm font-medium">{t("session.transition.next")}</p>
        <p className="text-sm text-muted-foreground">
          {t("session.transition.meta", {
            name: t(block.label),
            count: block.totalCount,
            duration: formatDuration(block.remainingMinutes, locale),
          })}
        </p>
      </div>
      <div className="flex flex-col justify-center gap-2 sm:flex-row">
        <Button disabled={starting} onClick={onContinue}>
          {starting ? t("session.starting") : t("session.transition.continue")}
          <ArrowRightIcon aria-hidden />
        </Button>
        <Button variant="outline" onClick={onLater}>
          {t("session.transition.back")}
        </Button>
      </div>
      <p className="text-center text-xs text-muted-foreground">
        {t("session.transition.saved")}
      </p>
    </section>
  );
}

function UnitShell({
  unit,
  progress,
  children,
}: {
  unit: LearnerUnit;
  progress: UnitProgress;
  children: React.ReactNode;
}) {
  const { locale, t } = useI18n();
  return (
    <ActivityFrame
      activityId={unit.id}
      activityType={unit.type}
      title={unit.title}
      description={unit.description}
      slots={{
        context: (
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{t(unitTypeMessageKeys[unit.type])}</Badge>
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <ClockIcon aria-hidden />
              {formatMinutesShort(unit.estimatedMinutes, locale)}
            </span>
          </div>
        ),
        status: (
          <Badge
            variant={progress.status === "completed" ? "success" : "secondary"}
          >
            {t(unitStatusMessageKeys[progress.status])}
          </Badge>
        ),
      }}
    >
      {children}
    </ActivityFrame>
  );
}

type UnitBodyProps = {
  session: LearnerSession;
  unit: LearnerUnit;
  progress: UnitProgress;
  pending: boolean;
  patchUnit: (
    unit: LearnerUnit,
    progress: UnitProgress,
    status: "ready" | "in_progress" | "completed" | "skipped",
    payload?: ProgressPayload,
  ) => Promise<LearnerSession | null>;
  runAction: <T>(
    action: string,
    request: () => Promise<T>,
    getSession: (result: T) => LearnerSession,
  ) => Promise<T | null>;
  acceptSession: (session: LearnerSession) => Promise<void>;
  onExercise: () => void;
  onInterview: () => void;
};

type ActivityRenderer = (props: UnitBodyProps) => React.ReactNode;

export const activityRendererRegistry: Readonly<
  Partial<Record<LearnerUnit["type"], ActivityRenderer>>
> = Object.freeze({
  briefing: BriefingUnit,
  study: StudyUnit,
  recall: RecallUnit,
  "teacher-dialogue": TeacherDialogueUnit,
  quiz: QuizUnit,
  "code-reading": CodeReadingUnit,
  exercise: ExerciseHandoffUnit,
  review: ExerciseHandoffUnit,
  interview: InterviewUnit,
  summary: SummaryUnit,
  checkpoint: CheckpointUnit,
  "spaced-review": SpacedReviewUnit,
});

function UnitBody(props: UnitBodyProps) {
  const { t } = useI18n();
  const Renderer = activityRendererRegistry[props.unit.type];
  if (!Renderer) {
    return (
      <div
        role="alert"
        data-slot="unsupported-activity"
        className="rounded-md border border-warning/40 bg-warning/10 p-4"
      >
        <p className="font-medium">{t("activity.unsupported.title")}</p>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          {t("activity.unsupported.description")}
        </p>
      </div>
    );
  }
  return <Renderer {...props} />;
}

function Checklist({
  items,
  checked,
  disabled,
  onToggle,
}: {
  items: LearnerUnit["checklist"];
  checked: string[];
  disabled?: boolean;
  onToggle: (id: string) => void;
}) {
  const { t } = useI18n();
  if (!items.length) return null;
  const requiredCount = items.filter((item) => item.required).length;
  return (
    <fieldset data-slot="unit-checklist" className="flex flex-col gap-2">
      <legend className="pb-1 text-sm font-medium">
        {t("session.checklist.title")}
      </legend>
      <p className="pb-1 text-xs leading-5 text-muted-foreground">
        {t("session.checklist.help")}
        {requiredCount > 0 ? t("session.checklist.requiredHelp") : ""}
      </p>
      {items.map((item) => (
        <label
          key={item.id}
          className="flex min-h-11 items-start gap-2 rounded-md border border-border p-3 text-sm"
        >
          <input
            type="checkbox"
            checked={checked.includes(item.id)}
            disabled={disabled}
            onChange={() => onToggle(item.id)}
            className="size-4 accent-primary"
          />
          <span>
            {item.label}
            {item.required ? (
              <span className="text-muted-foreground">
                {" "}
                · {t("session.checklist.required")}
              </span>
            ) : null}
          </span>
        </label>
      ))}
      <p className="pt-1 text-xs text-muted-foreground">
        {t("session.checklist.count", {
          checked: checked.length,
          total: items.length,
        })}
      </p>
    </fieldset>
  );
}

function BriefingSection({
  title,
  items,
  empty,
}: {
  title: string;
  items: readonly string[];
  empty: string;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-4">
      <h3 className="text-sm font-medium">{title}</h3>
      {items.length ? (
        <ul className="flex flex-col gap-1.5 text-sm leading-6 text-muted-foreground">
          {items.map((item) => (
            <li key={item} className="flex gap-2">
              <CircleIcon
                aria-hidden
                weight="fill"
                className="size-1.5 shrink-0 self-center text-primary"
              />
              {item}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm leading-6 text-muted-foreground">{empty}</p>
      )}
    </div>
  );
}

function BriefingUnitImpl({
  session,
  unit,
  progress,
  pending,
  patchUnit,
}: UnitBodyProps) {
  const { locale, t } = useI18n();
  const router = useRouter();
  const day = session.snapshot.day;
  const progressByUnit = new Map(
    session.unitProgress.map((item) => [item.unitId, item]),
  );
  const blocks = groupDayIntoBlocks(
    session.snapshot.units.map((candidate) => ({
      id: candidate.id,
      type: candidate.type,
      title: candidate.title,
      estimatedMinutes: candidate.estimatedMinutes,
    })),
    (candidate) => progressByUnit.get(candidate.id)?.status ?? "locked",
  );
  const outOfScope =
    unit.payload.type === "briefing" ? unit.payload.outOfScope : day.outOfScope;
  const complete = progress.status === "completed";

  function finish() {
    void patchUnit(unit, progress, "completed", {
      type: "briefing",
      acknowledged: true,
      checkedItemIds: unit.checklist.map((item) => item.id),
    });
  }

  return (
    <div data-slot="briefing" className="flex flex-col gap-6">
      <div className="grid gap-4 md:grid-cols-2">
        <BriefingSection
          title={t("session.briefing.topics")}
          items={day.topics}
          empty={t("session.briefing.topicsEmpty")}
        />
        <BriefingSection
          title={t("session.briefing.outcomes")}
          items={day.expectedOutcomes}
          empty={t("session.briefing.outcomesEmpty")}
        />
        <div className="flex flex-col gap-2 rounded-lg border border-border p-4">
          <h3 className="text-sm font-medium">{t("session.briefing.level")}</h3>
          <p className="text-lg font-semibold">
            {depthMessageKey(day.depthLevel)
              ? t(depthMessageKey(day.depthLevel)!)
              : day.depthLevel}
          </p>
          <p className="text-sm leading-6 text-muted-foreground">
            {t("session.briefing.levelDescription")}
          </p>
        </div>
        <BriefingSection
          title={t("session.briefing.scope")}
          items={outOfScope}
          empty={t("session.briefing.scopeEmpty")}
        />
      </div>

      <div className="flex flex-col gap-2 rounded-lg border border-border p-4">
        <h3 className="text-sm font-medium">{t("session.briefing.plan")}</h3>
        <ol className="flex flex-col gap-1.5 text-sm">
          {blocks
            .filter((block) => block.totalCount > 0)
            .map((block, index) => (
              <li key={block.id} className="flex items-center gap-2">
                <span
                  className={cn(
                    "grid size-6 shrink-0 place-items-center rounded-md text-xs font-semibold",
                    activitySurfaceClass(block.units[0]?.type ?? "study"),
                    activityColorClass(block.units[0]?.type ?? "study"),
                  )}
                >
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {t(block.label)}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {t("session.activitiesCount", {
                    count: block.totalCount,
                    duration: formatMinutesShort(
                      block.estimatedMinutes,
                      locale,
                    ),
                  })}
                </span>
              </li>
            ))}
        </ol>
      </div>

      <Sources unit={unit} />

      {complete ? (
        <CompletedNote />
      ) : (
        <div className="flex flex-col items-start gap-3 rounded-lg bg-muted/60 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-[55ch] text-sm leading-6 text-muted-foreground">
            {t("session.briefing.skipDescription")}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => router.push("/interview")}
            >
              {t("session.briefing.diagnostic")}
            </Button>
            <Button disabled={pending} onClick={finish}>
              {pending
                ? t("session.briefing.opening")
                : t("session.briefing.startStudy")}
              <ArrowRightIcon aria-hidden />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function BriefingUnit(props: UnitBodyProps) {
  return <BriefingUnitImpl {...props} />;
}

function StudyUnit({ unit, progress, pending, patchUnit }: UnitBodyProps) {
  const { t } = useI18n();
  const payload =
    progress.payload.type === "study"
      ? progress.payload
      : { type: "study" as const, checkedItemIds: [], notes: "" };
  const [checked, setChecked] = useState(payload.checkedItemIds);
  const [notes, setNotes] = useState(payload.notes);
  const required = unit.checklist
    .filter((item) => item.required)
    .map((item) => item.id);
  const complete = progress.status === "completed";
  const nextPayload = {
    type: "study" as const,
    checkedItemIds: checked,
    notes,
  };
  return (
    <div className="flex flex-col gap-6">
      {unit.payload.type === "study" && unit.payload.body ? (
        <p className="max-w-[75ch] whitespace-pre-wrap text-sm leading-6">
          {unit.payload.body}
        </p>
      ) : null}
      <Sources unit={unit} />
      <Checklist
        items={unit.checklist}
        checked={checked}
        disabled={complete || pending}
        onToggle={(id) =>
          setChecked((current) =>
            current.includes(id)
              ? current.filter((item) => item !== id)
              : [...current, id],
          )
        }
      />
      <label
        className="flex flex-col gap-2 text-sm font-medium"
        htmlFor={`notes-${unit.id}`}
      >
        {t("session.study.notes")}
        <textarea
          id={`notes-${unit.id}`}
          rows={5}
          value={notes}
          disabled={complete || pending}
          onChange={(event) => setNotes(event.target.value)}
          placeholder={t("session.study.placeholder")}
          className="min-h-28 resize-y rounded-md border border-input bg-background p-3 font-normal leading-6 outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-70"
        />
      </label>
      {!complete ? (
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            variant="outline"
            disabled={pending}
            onClick={() =>
              void patchUnit(unit, progress, "in_progress", nextPayload)
            }
          >
            {t("session.study.save")}
          </Button>
          <Button
            disabled={pending || !required.every((id) => checked.includes(id))}
            onClick={() =>
              void patchUnit(unit, progress, "completed", nextPayload)
            }
          >
            {t("session.study.complete")}
            <CheckIcon aria-hidden />
          </Button>
        </div>
      ) : (
        <CompletedNote />
      )}
    </div>
  );
}

function RecallUnit({
  session,
  unit,
  progress,
  pending,
  patchUnit,
  runAction,
}: UnitBodyProps) {
  const { t } = useI18n();
  const payload =
    progress.payload.type === "recall"
      ? progress.payload
      : {
          type: "recall" as const,
          answers: [],
          draft: "",
          firstAttemptId: null,
        };
  const persistedAnswers = new Map(
    payload.answers.map((answer) => [answer.questionId, answer]),
  );
  const firstQuestionId = unit.questions[0]?.id;
  if (
    firstQuestionId &&
    payload.firstAttemptId &&
    payload.draft.trim() &&
    !persistedAnswers.has(firstQuestionId)
  ) {
    persistedAnswers.set(firstQuestionId, {
      questionId: firstQuestionId,
      draft: payload.draft,
      firstAttemptId: payload.firstAttemptId,
    });
  }
  const [answers, setAnswers] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      unit.questions.map((question) => [
        question.id,
        persistedAnswers.get(question.id)?.draft ?? "",
      ]),
    ),
  );
  const allAnswered =
    unit.questions.length > 0 &&
    unit.questions.every((question) => persistedAnswers.has(question.id));
  const completionPayload = {
    ...payload,
    answers: unit.questions.flatMap((question) => {
      const answer = persistedAnswers.get(question.id);
      return answer ? [answer] : [];
    }),
  };
  async function submit(questionId: string) {
    const answer = answers[questionId]?.trim() ?? "";
    if (!answer) return;
    await runAction(
      `recall:${unit.id}:${questionId}`,
      async () => {
        const raw = await api<unknown>(
          `/learning/sessions/v2/${encodeURIComponent(session.id)}/units/${encodeURIComponent(unit.id)}/recall-attempts`,
          {
            method: "POST",
            body: JSON.stringify({
              operationId: operationId(),
              questionId,
              answer,
            }),
          },
        );
        rejectProtectedFields(raw);
        return recallResponseSchema.parse(raw);
      },
      (response) => response.session,
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-5">
        {unit.questions.map((question, index) => (
          <div
            key={question.id}
            className="flex flex-col gap-3 rounded-lg border border-border/70 p-4"
          >
            <label
              className="flex flex-col gap-2 text-sm font-medium"
              htmlFor={`recall-${question.id}`}
            >
              <span className="leading-6">
                {index + 1}. {question.prompt}
              </span>
              <textarea
                id={`recall-${question.id}`}
                rows={5}
                value={answers[question.id] ?? ""}
                disabled={
                  persistedAnswers.has(question.id) ||
                  progress.status === "completed" ||
                  pending
                }
                onChange={(event) =>
                  setAnswers((current) => ({
                    ...current,
                    [question.id]: event.target.value,
                  }))
                }
                aria-describedby={`recall-help-${unit.id}`}
                className="min-h-32 resize-y rounded-md border border-input bg-background p-3 font-normal leading-6 outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-70"
              />
            </label>
            {!persistedAnswers.has(question.id) &&
            progress.status !== "completed" ? (
              <div className="flex justify-end">
                <Button
                  disabled={
                    pending || (answers[question.id]?.trim().length ?? 0) < 20
                  }
                  onClick={() => void submit(question.id)}
                >
                  <PaperPlaneTiltIcon aria-hidden />
                  {t("session.recall.saveAnswer", { number: index + 1 })}
                </Button>
              </div>
            ) : null}
          </div>
        ))}
      </div>
      <p
        id={`recall-help-${unit.id}`}
        className="text-xs text-muted-foreground"
      >
        {t("session.recall.firstAttempt")}
      </p>
      {progress.status === "completed" ? (
        <CompletedNote />
      ) : allAnswered ? (
        <div className="flex justify-end">
          <Button
            disabled={pending}
            onClick={() =>
              void patchUnit(unit, progress, "completed", completionPayload)
            }
          >
            {t("session.recall.complete")}
            <CheckIcon aria-hidden />
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          {t("session.recall.count", {
            saved: persistedAnswers.size,
            total: unit.questions.length,
          })}
        </p>
      )}
    </div>
  );
}

function TeacherDialogueUnit({
  session,
  unit,
  progress,
  pending,
  patchUnit,
  acceptSession,
}: UnitBodyProps) {
  const { t } = useI18n();
  const teacherStreamFailureMessage = t("session.tutor.unavailable");
  const teacherStreamCancellationMessage = t("session.tutor.stopped");
  const queryClient = useQueryClient();
  const payload =
    progress.payload.type === "teacher-dialogue"
      ? progress.payload
      : {
          type: "teacher-dialogue" as const,
          conversationId: null,
          turnCount: 0,
          revisionAttemptIds: [],
        };
  const [revision, setRevision] = useState("");
  const [localMessages, setLocalMessages] = useState<Array<{
    id: string;
    role: "user" | "assistant";
    content: string;
  }> | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [providerError, setProviderError] = useState<string | null>(null);
  const [streamStatus, setStreamStatus] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const history = useQuery({
    queryKey: ["agent-history", "teacher", session.id],
    queryFn: async () =>
      z
        .object({
          messages: z.array(
            z
              .object({
                id: idSchema,
                role: z.enum(["user", "assistant"]),
                content: z.string(),
              })
              .passthrough(),
          ),
        })
        .passthrough()
        .parse(
          await api<unknown>(
            `/learning/sessions/v2/${encodeURIComponent(session.id)}/teacher-transcript`,
          ),
        ),
  });
  const messages = localMessages ?? history.data?.messages ?? [];
  const opening =
    unit.payload.type === "teacher-dialogue"
      ? unit.payload.openingPrompt
      : t("session.tutor.defaultPrompt");
  const recallDraft = session.unitProgress.find(
    (item) => item.payload.type === "recall",
  )?.payload;
  const firstDraft = recallDraft?.type === "recall" ? recallDraft.draft : "";
  const requiredTurns = Math.max(
    unit.payload.type === "teacher-dialogue" ? unit.payload.minimumTurns : 1,
    unit.payload.type === "teacher-dialogue" && unit.payload.requiresRevision
      ? 2
      : 1,
  );
  const canComplete =
    payload.turnCount >= requiredTurns &&
    payload.revisionAttemptIds.length >= requiredTurns;
  const answeringFollowUp = payload.revisionAttemptIds.length === 1;

  async function sendRevision() {
    const text = revision.trim();
    if (!text || streaming) return;
    setProviderError(null);
    setStreaming(true);
    setStreamStatus(t("session.tutor.generating"));
    const controller = new AbortController();
    abortRef.current = controller;
    const userMessage = {
      id: operationId(),
      role: "user" as const,
      content: text,
    };
    const assistantId = operationId();
    setLocalMessages([
      ...messages,
      userMessage,
      { id: assistantId, role: "assistant", content: "" },
    ]);
    let assistantContent = "";
    let terminalReason: "completed" | "failed" | "cancelled" | null = null;
    let streamReportedError = false;
    try {
      stream: for await (const event of streamAgent(
        {
          role: "teacher",
          sessionId: session.id,
          message: answeringFollowUp
            ? `${opening}\n\nLearner first attempt:\n${firstDraft}\n\nLearner response to Tutor follow-up:\n${text}`
            : `${opening}\n\nLearner first attempt:\n${firstDraft}\n\nLearner refined explanation:\n${text}`,
        },
        controller.signal,
      )) {
        switch (event.type) {
          case "message.delta":
            assistantContent += event.content;
            setLocalMessages((current) =>
              (current ?? []).map((message) =>
                message.id === assistantId
                  ? {
                      ...message,
                      content: message.content + event.content,
                    }
                  : message,
              ),
            );
            break;
          case "message.completed":
            assistantContent = event.content;
            setLocalMessages((current) =>
              (current ?? []).map((message) =>
                message.id === assistantId
                  ? { ...message, content: event.content }
                  : message,
              ),
            );
            break;
          case "error":
            streamReportedError = true;
            assistantContent = teacherStreamFailureMessage;
            setLocalMessages((current) =>
              (current ?? []).map((message) =>
                message.id === assistantId
                  ? { ...message, content: teacherStreamFailureMessage }
                  : message,
              ),
            );
            break;
          case "session.completed":
            terminalReason = event.reason;
            break stream;
        }
      }

      if (controller.signal.aborted || terminalReason === "cancelled") {
        assistantContent = teacherStreamCancellationMessage;
        setLocalMessages((current) =>
          (current ?? []).map((message) =>
            message.id === assistantId
              ? { ...message, content: teacherStreamCancellationMessage }
              : message,
          ),
        );
        setStreamStatus(t("session.tutor.stopped"));
        return;
      }
      if (
        terminalReason === "failed" ||
        terminalReason === null ||
        streamReportedError
      ) {
        assistantContent = teacherStreamFailureMessage;
        setLocalMessages((current) =>
          (current ?? []).map((message) =>
            message.id === assistantId
              ? { ...message, content: teacherStreamFailureMessage }
              : message,
          ),
        );
        setProviderError(teacherStreamFailureMessage);
        setStreamStatus(t("session.tutor.unavailable"));
        return;
      }
      if (!assistantContent.trim())
        throw new Error(t("session.tutor.emptyResponse"));
      const nextPayload = {
        ...payload,
        turnCount: payload.turnCount + 1,
        revisionAttemptIds: [...payload.revisionAttemptIds, userMessage.id],
      };
      const updated = await patchUnit(
        unit,
        progress,
        "in_progress",
        nextPayload,
      );
      if (updated) await acceptSession(updated);
      setRevision("");
      setStreamStatus(t("session.tutor.received"));
      await queryClient.invalidateQueries({
        queryKey: ["agent-history", "teacher", session.id],
        refetchType: "none",
      });
    } catch (error) {
      if (controller.signal.aborted) {
        if (!assistantContent.trim()) {
          setLocalMessages((current) =>
            (current ?? []).map((message) =>
              message.id === assistantId
                ? { ...message, content: teacherStreamCancellationMessage }
                : message,
            ),
          );
        }
        setStreamStatus(t("session.tutor.stopped"));
      } else {
        setProviderError(errorMessage(error));
        setStreamStatus(t("session.tutor.unavailable"));
      }
    } finally {
      setStreaming(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1 rounded-md border border-border bg-background p-3 text-sm leading-6">
        <p className="font-medium">{t("session.tutor.task")}</p>
        <p className="text-muted-foreground">{opening}</p>
      </div>
      {history.isPending && !localMessages ? (
        <Skeleton className="h-28" />
      ) : history.isError ? (
        <QueryError
          message={errorMessage(history.error)}
          retry={() => void history.refetch()}
        />
      ) : (
        <ol
          data-slot="teacher-transcript"
          aria-label={t("session.tutor.history")}
          className="flex max-h-96 flex-col gap-2 overflow-y-auto"
        >
          {messages.length ? (
            messages.map((message) => (
              <li
                key={message.id}
                className={`flex max-w-[90%] flex-col gap-1 rounded-md p-3 text-sm leading-6 ${message.role === "user" ? "self-end bg-primary text-primary-foreground" : "bg-muted"}`}
              >
                <span className="block text-xs font-medium">
                  {message.role === "user"
                    ? t("session.tutor.you")
                    : t("session.tutor.name")}
                </span>
                {message.content || "…"}
              </li>
            ))
          ) : (
            <li className="text-sm text-muted-foreground">
              {t("session.tutor.emptyHistory")}
            </li>
          )}
        </ol>
      )}
      {providerError ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/40 p-3 text-sm text-destructive"
        >
          <span>{providerError}</span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void sendRevision()}
          >
            {t("session.tutor.retry")}
          </Button>
        </div>
      ) : null}
      <p className="sr-only" role="status" aria-live="polite">
        {streamStatus}
      </p>
      {progress.status === "completed" ? (
        <CompletedNote />
      ) : (
        <>
          {!canComplete ? (
            <label
              className="flex flex-col gap-2 text-sm font-medium"
              htmlFor={`teacher-revision-${unit.id}`}
            >
              {answeringFollowUp
                ? t("session.tutor.followUpLabel")
                : t("session.tutor.revisionLabel")}
              <textarea
                id={`teacher-revision-${unit.id}`}
                rows={5}
                value={revision}
                disabled={streaming || pending}
                onChange={(event) => setRevision(event.target.value)}
                placeholder={
                  answeringFollowUp
                    ? t("session.tutor.followUpPlaceholder")
                    : t("session.tutor.revisionPlaceholder")
                }
                className="min-h-28 resize-y rounded-md border border-input bg-background p-3 font-normal leading-6 outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            {streaming ? (
              <Button
                variant="outline"
                onClick={() => abortRef.current?.abort()}
              >
                <StopIcon aria-hidden />
                {t("session.tutor.stop")}
              </Button>
            ) : canComplete ? (
              <Button
                disabled={pending}
                onClick={() =>
                  void patchUnit(unit, progress, "completed", payload)
                }
              >
                {t("session.tutor.complete")}
                <CheckIcon aria-hidden />
              </Button>
            ) : (
              <Button
                disabled={pending || revision.trim().length < 20}
                onClick={() => void sendRevision()}
              >
                <PaperPlaneTiltIcon aria-hidden />
                {answeringFollowUp
                  ? t("session.tutor.answer")
                  : t("session.tutor.send")}
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function QuizUnit({
  session,
  unit,
  progress,
  pending,
  patchUnit,
  runAction,
}: UnitBodyProps) {
  const { t } = useI18n();
  const payload =
    progress.payload.type === "quiz"
      ? progress.payload
      : {
          type: "quiz" as const,
          attemptedQuestionIds: [],
          correctQuestionIds: [],
          score: null,
        };
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [retrying, setRetrying] = useState(false);
  const persistedCorrectQuestionIds = payload.correctQuestionIds;
  const [results, setResults] = useState<Array<{
    questionId: string;
    correct: boolean;
  }> | null>(
    payload.score === null || persistedCorrectQuestionIds === undefined
      ? null
      : payload.attemptedQuestionIds.map((questionId) => ({
          questionId,
          correct: persistedCorrectQuestionIds.includes(questionId),
        })),
  );
  const minimumScore =
    unit.payload.type === "quiz" ? unit.payload.minimumScore : 1;
  const scored = payload.score !== null;
  const passed = scored && (payload.score ?? 0) >= minimumScore;
  const answering = !scored || retrying;
  const invalidQuestions = unit.questions.filter(
    (question) => question.options.length < 2,
  );
  async function submit() {
    const result = await runAction(
      `quiz:${unit.id}`,
      async () => {
        const raw = await api<unknown>(
          `/learning/sessions/v2/${encodeURIComponent(session.id)}/units/${encodeURIComponent(unit.id)}/quiz-attempts`,
          {
            method: "POST",
            body: JSON.stringify({
              operationId: operationId(),
              answers: unit.questions.map((question) => ({
                questionId: question.id,
                selectedOptionId: answers[question.id],
              })),
            }),
          },
        );
        rejectProtectedFields(raw);
        return quizResponseSchema.parse(raw);
      },
      (response) => response.session,
    );
    if (result) {
      setResults(result.attempt.results);
      setRetrying(false);
    }
  }
  const allAnswered = unit.questions.every((question) =>
    Boolean(answers[question.id]),
  );
  return (
    <div className="flex flex-col gap-6">
      {invalidQuestions.length ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/35 bg-destructive/10 p-4 text-sm text-destructive"
        >
          {t("session.quiz.invalid")}
        </p>
      ) : null}
      {unit.questions.map((question, index) => {
        const result = results?.find((item) => item.questionId === question.id);
        return (
          <fieldset
            key={question.id}
            className="flex flex-col gap-2 rounded-md border border-border p-4"
          >
            <legend className="px-1 text-sm font-medium">
              {index + 1}. {question.prompt}
            </legend>
            {question.options.map((option) => (
              <label
                key={option.id}
                className="flex min-h-11 items-center gap-2 rounded-md border border-border px-3 py-2 text-sm"
              >
                <input
                  type="radio"
                  name={`quiz-${question.id}`}
                  value={option.id}
                  checked={answers[question.id] === option.id}
                  disabled={
                    !answering || progress.status === "completed" || pending
                  }
                  onChange={() =>
                    setAnswers((current) => ({
                      ...current,
                      [question.id]: option.id,
                    }))
                  }
                  className="size-4 accent-primary"
                />
                {option.label}
              </label>
            ))}
            {result ? (
              <p
                className={`text-sm font-medium ${result.correct ? "text-success" : "text-destructive"}`}
              >
                {result.correct
                  ? t("session.quiz.correct")
                  : t("session.quiz.retryNeeded")}
              </p>
            ) : null}
          </fieldset>
        );
      })}
      {payload.score !== null ? (
        <p role="status" className="text-sm font-medium">
          {t("session.quiz.score", {
            score: Math.round(payload.score * 100),
            minimum: Math.round(minimumScore * 100),
          })}
        </p>
      ) : null}
      {progress.status === "completed" ? (
        <CompletedNote />
      ) : passed ? (
        <div className="flex justify-end">
          <Button
            disabled={pending}
            onClick={() => void patchUnit(unit, progress, "completed", payload)}
          >
            {t("session.quiz.complete")}
            <CheckIcon aria-hidden />
          </Button>
        </div>
      ) : scored && !retrying ? (
        <div className="flex flex-col items-start gap-3 rounded-md bg-muted p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-[60ch] text-sm leading-6 text-muted-foreground">
            {t("session.quiz.retryDescription")}
          </p>
          <Button
            type="button"
            variant="outline"
            disabled={pending || invalidQuestions.length > 0}
            onClick={() => {
              setAnswers({});
              setResults(null);
              setRetrying(true);
            }}
          >
            {t("session.quiz.retry")}
          </Button>
        </div>
      ) : (
        <div className="flex justify-end">
          <Button
            disabled={pending || !allAnswered || invalidQuestions.length > 0}
            onClick={() => void submit()}
          >
            {retrying
              ? t("session.quiz.submitAgain")
              : t("session.quiz.submit")}
          </Button>
        </div>
      )}
    </div>
  );
}

function CodeReadingUnit({
  session,
  unit,
  progress,
  pending,
  patchUnit,
  runAction,
}: UnitBodyProps) {
  const { t } = useI18n();
  const payload =
    progress.payload.type === "code-reading"
      ? progress.payload
      : {
          type: "code-reading" as const,
          prediction: "",
          explanation: "",
          verbalFix: "",
        };
  const [fields, setFields] = useState(payload);
  const saved = Boolean(
    payload.prediction && payload.explanation && payload.verbalFix,
  );
  async function submit() {
    await runAction(
      `code-reading:${unit.id}`,
      async () => {
        const raw = await api<unknown>(
          `/learning/sessions/v2/${encodeURIComponent(session.id)}/units/${encodeURIComponent(unit.id)}/code-reading-attempts`,
          {
            method: "POST",
            body: JSON.stringify({
              operationId: operationId(),
              prediction: fields.prediction.trim(),
              explanation: fields.explanation.trim(),
              verbalFix: fields.verbalFix.trim(),
            }),
          },
        );
        rejectProtectedFields(raw);
        return codeReadingResponseSchema.parse(raw);
      },
      (response) => response.session,
    );
  }
  const disabled = saved || progress.status === "completed" || pending;
  return (
    <div className="flex flex-col gap-6">
      {unit.payload.type === "code-reading" ? (
        <pre className="overflow-x-auto rounded-md border border-border bg-muted p-4 text-sm leading-6">
          <code>{unit.payload.snippet}</code>
        </pre>
      ) : null}
      {unit.questions.map((question) => (
        <p key={question.id} className="text-sm font-medium leading-6">
          {question.prompt}
        </p>
      ))}
      {(
        [
          ["prediction", t("session.code.prediction")],
          ["explanation", t("session.code.explanation")],
          ["verbalFix", t("session.code.verbalFix")],
        ] as const
      ).map(([field, label]) => (
        <label
          key={field}
          className="flex flex-col gap-2 text-sm font-medium"
          htmlFor={`${field}-${unit.id}`}
        >
          {label}
          <textarea
            id={`${field}-${unit.id}`}
            rows={4}
            value={fields[field]}
            disabled={disabled}
            onChange={(event) =>
              setFields((current) => ({
                ...current,
                [field]: event.target.value,
              }))
            }
            className="min-h-24 resize-y rounded-md border border-input bg-background p-3 font-normal leading-6 outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-70"
          />
        </label>
      ))}
      {progress.status === "completed" ? (
        <CompletedNote />
      ) : saved ? (
        <div className="flex justify-end">
          <Button
            disabled={pending}
            onClick={() => void patchUnit(unit, progress, "completed", payload)}
          >
            {t("session.code.complete")}
            <CheckIcon aria-hidden />
          </Button>
        </div>
      ) : (
        <div className="flex justify-end">
          <Button
            disabled={
              pending ||
              !fields.prediction.trim() ||
              !fields.explanation.trim() ||
              !fields.verbalFix.trim()
            }
            onClick={() => void submit()}
          >
            {t("session.code.save")}
          </Button>
        </div>
      )}
    </div>
  );
}

function ExerciseHandoffUnit({ unit, progress, onExercise }: UnitBodyProps) {
  const { t } = useI18n();
  const criteria =
    unit.payload.type === "exercise"
      ? unit.payload.acceptanceCriteria
      : unit.completionCriteria.map((criterion) => criterion.type);
  return (
    <div className="flex flex-col gap-6">
      <InfoList
        title={
          unit.type === "review"
            ? t("session.practice.reviewCriteria")
            : t("session.practice.acceptance")
        }
        items={criteria}
      />
      {unit.payload.type === "exercise" && unit.payload.constraints.length ? (
        <InfoList
          title={t("session.practice.constraints")}
          items={unit.payload.constraints}
        />
      ) : null}
      <p className="text-sm leading-6 text-muted-foreground">
        {t("session.practice.description")}
      </p>
      {progress.status === "completed" ? (
        <CompletedNote />
      ) : (
        <div className="flex justify-end">
          <Button onClick={onExercise}>
            {unit.type === "review"
              ? t("session.practice.openReview")
              : t("session.practice.open")}
            <ArrowRightIcon aria-hidden />
          </Button>
        </div>
      )}
    </div>
  );
}

function InterviewUnit({
  unit,
  progress,
  pending,
  patchUnit,
  onInterview,
}: UnitBodyProps) {
  const { t } = useI18n();
  const payload =
    progress.payload.type === "interview" ? progress.payload : null;
  const hasReport = Boolean(payload?.reportId);
  return (
    <div className="flex flex-col gap-6">
      {unit.payload.type === "interview" ? (
        <InfoList
          title={t("session.interview.topics")}
          items={unit.payload.topics}
        />
      ) : null}
      {progress.status === "completed" ? (
        <CompletedNote />
      ) : hasReport ? (
        <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-[60ch] text-sm leading-6 text-muted-foreground">
            {t("session.interview.reportReady")}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={onInterview}>
              {t("session.interview.openReport")}
              <ArrowRightIcon aria-hidden />
            </Button>
            <Button
              disabled={pending}
              onClick={() =>
                void patchUnit(unit, progress, "completed", {
                  type: "interview",
                  interviewSessionId: payload?.interviewSessionId ?? null,
                  reportId: payload?.reportId ?? null,
                })
              }
            >
              {t("session.interview.complete")}
              <CheckIcon aria-hidden />
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex justify-end">
          <Button onClick={onInterview}>
            {t("session.interview.open")}
            <ArrowRightIcon aria-hidden />
          </Button>
        </div>
      )}
    </div>
  );
}

function SummaryUnit({
  session,
  unit,
  progress,
  pending,
  patchUnit,
  runAction,
}: UnitBodyProps) {
  const { t } = useI18n();
  const summaryId =
    progress.payload.type === "summary" ? progress.payload.summaryId : null;
  const [created, setCreated] = useState<z.infer<
    typeof summaryResponseSchema
  > | null>(null);
  const persisted = useQuery({
    queryKey: ["learning-summary-v2", session.id, unit.id, summaryId],
    enabled: Boolean(summaryId) && created === null,
    queryFn: async () => {
      const raw = await api<unknown>(
        `/learning/sessions/v2/${encodeURIComponent(session.id)}/units/${encodeURIComponent(unit.id)}/summary`,
      );
      rejectProtectedFields(raw);
      return summaryResponseSchema.parse(raw);
    },
  });
  const result = created ?? persisted.data ?? null;

  async function createSummary() {
    const response = await runAction(
      `summary:${unit.id}`,
      async () => {
        const raw = await api<unknown>(
          `/learning/sessions/v2/${encodeURIComponent(session.id)}/units/${encodeURIComponent(unit.id)}/summary`,
          {
            method: "POST",
            body: JSON.stringify({ operationId: operationId() }),
          },
        );
        rejectProtectedFields(raw);
        return summaryResponseSchema.parse(raw);
      },
      (value) => value.session,
    );
    if (response) setCreated(response);
  }

  async function completeSummary() {
    if (!result) return;
    await patchUnit(unit, progress, "completed", {
      type: "summary",
      summaryId: result.evidence.id,
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {unit.payload.type === "summary" && unit.payload.prompts.length ? (
        <InfoList
          title={t("session.summary.prompts")}
          items={unit.payload.prompts}
        />
      ) : null}
      {result ? (
        <div data-slot="day-summary" className="flex flex-col gap-5">
          <div className="rounded-md border border-border bg-muted p-4">
            <p className="text-sm leading-6">{result.summary.narrative}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <SummaryMetric
              label={t("session.summary.quiz")}
              value={`${Math.round(result.summary.metrics.quizScore * 100)}%`}
            />
            <SummaryMetric
              label={t("session.summary.evidence")}
              value={String(result.summary.metrics.evidenceCount)}
            />
            <SummaryMetric
              label={t("session.summary.hints")}
              value={`${result.summary.metrics.maxHintLevel} / 5`}
            />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <InfoList
              title={t("session.summary.strengths")}
              items={
                result.summary.strengths.length
                  ? result.summary.strengths
                  : [t("session.summary.noStrengths")]
              }
            />
            <InfoList
              title={t("session.summary.gaps")}
              items={
                result.summary.gaps.length
                  ? result.summary.gaps
                  : [t("session.summary.noGaps")]
              }
            />
          </div>
          <p className="text-sm text-muted-foreground">
            {t("session.summary.counts", {
              mistakes: result.summary.mistakeCandidates.length,
              cards: result.summary.flashcardCandidates.length,
            })}
          </p>
          {progress.status === "completed" ? (
            <CompletedNote />
          ) : (
            <div className="flex justify-end">
              <Button disabled={pending} onClick={() => void completeSummary()}>
                {pending
                  ? t("session.summary.completing")
                  : t("session.summary.complete")}
                <CheckIcon aria-hidden />
              </Button>
            </div>
          )}
        </div>
      ) : persisted.isError ? (
        <div className="flex flex-col items-start gap-3" role="alert">
          <p className="text-sm text-destructive">
            {t("session.summary.restoreError", {
              error: errorMessage(persisted.error),
            })}
          </p>
          <Button variant="outline" onClick={() => void persisted.refetch()}>
            {t("session.summary.retry")}
          </Button>
        </div>
      ) : persisted.isPending && summaryId ? (
        <div className="flex flex-col gap-3" role="status">
          <span className="sr-only">{t("session.summary.loading")}</span>
          <Skeleton className="h-20" />
          <Skeleton className="h-16" />
        </div>
      ) : (
        <div className="flex flex-col items-start gap-2">
          <Button disabled={pending} onClick={() => void createSummary()}>
            {pending
              ? t("session.summary.generating")
              : t("session.summary.generate")}
          </Button>
          <p className="text-xs text-muted-foreground">
            {t("session.summary.description")}
          </p>
        </div>
      )}
    </div>
  );
}

function SummaryMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function CheckpointUnit({ unit, progress, pending, patchUnit }: UnitBodyProps) {
  const { t } = useI18n();
  const payload =
    progress.payload.type === "checkpoint"
      ? progress.payload
      : { type: "checkpoint" as const, acknowledged: false };
  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm leading-6">
        {unit.payload.type === "checkpoint"
          ? unit.payload.label
          : unit.description}
      </p>
      {progress.status === "completed" ? (
        <CompletedNote />
      ) : (
        <div className="flex justify-end">
          <Button
            disabled={pending}
            onClick={() =>
              void patchUnit(unit, progress, "completed", {
                ...payload,
                acknowledged: true,
              })
            }
          >
            {t("session.checkpoint.confirm")}
            <CheckIcon aria-hidden />
          </Button>
        </div>
      )}
    </div>
  );
}

function SpacedReviewUnit({ unit, progress }: UnitBodyProps) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-6">
      {unit.payload.type === "spaced-review" ? (
        <InfoList
          title={t("session.spaced.topics")}
          items={unit.payload.topicIds}
        />
      ) : null}
      <p className="text-sm text-muted-foreground">
        {t("session.spaced.description")}
      </p>
      {progress.status === "completed" ? (
        <CompletedNote />
      ) : (
        <Button disabled>{t("session.spaced.start")}</Button>
      )}
    </div>
  );
}

function Sources({ unit }: { unit: LearnerUnit }) {
  const { locale, t } = useI18n();
  if (!unit.sources.length) {
    return (
      <div
        data-slot="unit-sources"
        className="flex flex-col gap-3 rounded-lg border border-dashed border-border p-4"
      >
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-medium">{t("session.sources.title")}</h3>
          <p className="text-sm leading-6 text-muted-foreground">
            {t("session.sources.empty")}
          </p>
        </div>
        <p className="text-sm leading-6 text-muted-foreground">
          {t("session.sources.own")}
        </p>
        <div>
          <Button asChild variant="outline" size="sm">
            <Link href="/settings/curriculum">
              {t("session.sources.openEditor")}
            </Link>
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div data-slot="unit-sources" className="flex flex-col gap-3">
      <h3 className="text-sm font-medium">{t("session.sources.title")}</h3>
      <ul className="grid gap-3 md:grid-cols-2">
        {unit.sources.map((source) => (
          <li
            key={source.id}
            data-slot="source-card"
            className="flex min-w-0 flex-col gap-3 rounded-lg border border-border p-4"
          >
            <div className="flex min-w-0 items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium leading-5">{source.title}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {sourceKindMessageKey(source.kind)
                    ? t(sourceKindMessageKey(source.kind)!)
                    : source.kind}{" "}
                  · {formatMinutesShort(source.estimatedMinutes, locale)}
                </p>
              </div>
              <Badge variant={source.required ? "default" : "outline"}>
                {source.required
                  ? t("session.sources.primary")
                  : t("session.sources.additional")}
              </Badge>
            </div>
            {source.learningGoal ? (
              <div className="flex flex-col gap-1">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {t("session.sources.focus")}
                </p>
                <p className="text-sm leading-6 text-muted-foreground">
                  {source.learningGoal}
                </p>
              </div>
            ) : null}
            {source.description ? (
              <p className="text-sm leading-6 text-muted-foreground">
                {source.description}
              </p>
            ) : null}
            {source.url ? (
              <a
                href={source.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
              >
                {t("session.sources.open")}
                <ArrowUpRightIcon aria-hidden className="size-4" />
              </a>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function InfoList({
  title,
  items,
}: {
  title: string;
  items: readonly string[];
}) {
  if (!items.length) return null;
  return (
    <div data-slot="unit-info-list" className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">{title}</h3>
      <ul className="flex flex-col gap-2 text-sm leading-6">
        {items.map((item) => (
          <li key={item} className="flex gap-2">
            <CircleIcon
              aria-hidden
              weight="fill"
              className="size-1.5 shrink-0 self-center text-primary"
            />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CompletedNote() {
  const { t } = useI18n();
  return (
    <p className="inline-flex items-center gap-2 text-sm font-medium text-success">
      <CheckIcon aria-hidden />
      {t("session.completed")}
    </p>
  );
}
