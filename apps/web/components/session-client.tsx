"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowUpRightIcon,
  ArrowRightIcon,
  CheckIcon,
  CircleIcon,
  ListIcon,
  PaperPlaneTiltIcon,
  StopIcon,
} from "@phosphor-icons/react";
import { toast } from "sonner";
import { z } from "zod";

import { ActivityFrame } from "@/components/activity-frame";
import { EstimatedDuration } from "@/components/estimated-duration";
import { usePageRouteContext } from "@/components/page-route-context";
import { RouteOrientation } from "@/components/route-orientation";
import { api, streamAgent } from "@/lib/api";
import {
  presentFailure,
  type FailurePresentation,
} from "@/lib/failure-presentation";
import {
  activityColorClass,
  activitySurfaceClass,
  depthMessageKey,
  sourceKindMessageKey,
  unitStatusMessageKeys,
  unitTypeMessageKeys,
} from "@/lib/unit-labels";
import { useI18n, type MessageKey } from "@/lib/i18n";
import { DayPlanRail, DayPlanSheet } from "@/components/day-plan";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  EmptyState,
  QueryError,
  SafeQueryError,
} from "@/components/query-state";
import { LoadingState } from "@/components/ui/loading-state";
import { Textarea } from "@/components/ui/textarea";
import type { RouteContext } from "@/lib/route-context";
import { groupDayIntoBlocks, type LearningBlock } from "@/lib/learning-blocks";
import {
  codeReadingActivityDraftSchema,
  quizActivityDraftSchema,
  recallActivityDraftSchema,
  studyActivityDraftSchema,
  teacherDialogueActivityDraftSchema,
  useLessonActivityDraft,
  type LessonActivityDraftIdentity,
} from "@/lib/lesson-activity-drafts";
import { formatMinutesShort } from "@/lib/time";
import { cn } from "@/lib/utils";

const protectedFields = new Set([
  "referenceAnswer",
  "evaluationPoints",
  "correctOptionIds",
  "correctQuestionIds",
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

const completionCriterionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("acknowledgement") }).strict(),
  z
    .object({
      type: z.literal("checklist"),
      requiredItemIds: z.array(idSchema).min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("attempts"),
      minimum: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      type: z.literal("dialogue"),
      minimumTurns: z.number().int().positive(),
      requiresRevision: z.boolean(),
    })
    .strict(),
  z
    .object({
      type: z.literal("score"),
      minimum: z.number().min(0).max(1),
      minimumAttempts: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      type: z.literal("fields"),
      required: z.array(z.string().trim().min(1)).min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("exercise"),
      passingTestsRequired: z.boolean(),
      acceptedReviewRequired: z.boolean(),
    })
    .strict(),
  z.object({ type: z.literal("custom"), key: idSchema }).strict(),
]);

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
    courseContext: z
      .object({
        courseId: idSchema,
        revisionId: idSchema,
        lessonId: idSchema,
        sessionSnapshotId: idSchema,
        snapshotHash: z.string().min(1),
      })
      .strict()
      .optional(),
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
const daySummaryMessageSchema = z
  .object({
    key: z.string().min(1),
    params: z
      .record(z.string().min(1), z.union([z.number(), z.string()]))
      .optional(),
  })
  .passthrough();
const daySummarySchema = z
  .object({
    sessionId: idSchema,
    occurredAt: z.string().datetime(),
    strengths: z.array(daySummaryMessageSchema),
    gaps: z.array(daySummaryMessageSchema),
    mistakeCandidates: z.array(
      z
        .object({
          fingerprint: idSchema,
          summary: daySummaryMessageSchema,
          correction: daySummaryMessageSchema,
          sourceId: idSchema,
        })
        .passthrough(),
    ),
    flashcardCandidates: z.array(
      z
        .object({
          front: daySummaryMessageSchema,
          back: daySummaryMessageSchema,
          sourceFingerprint: idSchema.optional(),
        })
        .passthrough(),
    ),
    narrative: daySummaryMessageSchema,
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
        reviewReceiptAccepted: z.boolean(),
        reviewStatus: z.null(),
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

function lessonActivityDraftIdentity(
  session: LearnerSession,
  unit: LearnerUnit,
): LessonActivityDraftIdentity {
  return {
    learningSessionId: session.id,
    currentStep: session.currentStep,
    revisionId:
      session.courseContext?.revisionId ?? session.snapshot.curriculumVersionId,
    snapshotId:
      session.courseContext?.sessionSnapshotId ?? session.snapshot.contentHash,
    snapshotHash:
      session.courseContext?.snapshotHash ?? session.snapshot.contentHash,
    activityId: unit.id,
    activityStableId: unit.stableId,
    activityType: unit.type,
  };
}

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

export function SessionClient() {
  const { t } = useI18n();
  const params = useSearchParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const requestedSessionId = params.get("id")?.trim() || null;
  const queryKey = requestedSessionId
    ? (["learning-session-v2", requestedSessionId] as const)
    : (["learning-session-current"] as const);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const lessonFocusRef = useRef<HTMLDivElement | null>(null);
  const previousFocusIdentityRef = useRef<string | null>(null);

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
  const focusIdentity = session
    ? `${session.id}:${session.currentStep}:${
        session.unitProgress.find(
          (item) =>
            item.unitId === session.currentStep ||
            session.snapshot.units.find(
              (unit) => unit.stableId === session.currentStep,
            )?.id === item.unitId,
        )?.status ?? session.status
      }`
    : null;
  useEffect(() => {
    if (!focusIdentity) return;
    const previousIdentity = previousFocusIdentityRef.current;
    previousFocusIdentityRef.current = focusIdentity;
    if (previousIdentity && previousIdentity !== focusIdentity) {
      lessonFocusRef.current?.focus();
    }
  }, [focusIdentity]);
  const pageRouteContext = useMemo<RouteContext | null>(() => {
    if (!session) return null;
    const courseId =
      session.courseContext?.courseId ?? session.snapshot.curriculumId;
    const revisionId =
      session.courseContext?.revisionId ?? session.snapshot.curriculumVersionId;
    return {
      sectionHref: "/courses",
      breadcrumbs: [
        { href: "/courses", label: "nav.courses" },
        {
          href: `/courses/${encodeURIComponent(courseId)}/revisions/${encodeURIComponent(revisionId)}`,
          text: session.snapshot.curriculumTitle,
        },
        {
          text: t("session.lessonTitle", {
            order: session.snapshot.day.order,
            title: session.snapshot.day.title,
          }),
        },
      ],
    };
  }, [session, t]);
  usePageRouteContext(pageRouteContext);

  async function acceptSession(next: LearnerSession): Promise<void> {
    queryClient.setQueryData(queryKey, { session: next });
    queryClient.setQueryData(["learning-session-v2", next.id], {
      session: next,
    });
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["learning-path"],
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
    setPendingAction(action);
    try {
      const result = await request();
      await acceptSession(getSession(result));
      return result;
    } catch (error) {
      toast.error(presentFailure(error, "session.action", t).message);
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
      <RouteOrientation
        slot="session-loading"
        title="shell.route.lesson"
        description="page.lesson.description"
        className="px-4 py-8 sm:px-6 sm:py-10 lg:px-6 lg:py-8"
      >
        <LoadingState label="session.loading" />
      </RouteOrientation>
    );
  }

  if (query.isError) {
    return (
      <RouteOrientation
        slot="session-error"
        title="shell.route.lesson"
        description="page.lesson.description"
        className="px-4 py-8 sm:px-6 sm:py-10 lg:px-6 lg:py-8"
      >
        <SafeQueryError
          error={query.error}
          operation="session.load"
          retry={() => void query.refetch()}
        />
      </RouteOrientation>
    );
  }

  if (!session) {
    return (
      <RouteOrientation
        slot="session-empty"
        title="shell.route.lesson"
        description="page.lesson.description"
        className="px-4 py-8 sm:px-6 sm:py-10 lg:px-6 lg:py-8"
      >
        <EmptyState
          title={t("session.empty.title")}
          description={t("session.empty.description")}
          action={
            <Button onClick={() => router.push("/")}>
              {t("session.openHome")}
            </Button>
          }
        />
      </RouteOrientation>
    );
  }

  const progressByUnit = new Map(
    session.unitProgress.map((item) => [item.unitId, item]),
  );
  const focusedUnit =
    session.currentStep === "complete"
      ? session.status === "completed"
        ? [...session.snapshot.units].reverse().find((unit) => {
            const status = progressByUnit.get(unit.id)?.status;
            return status === "completed" || status === "skipped";
          })
        : undefined
      : session.snapshot.units.find(
          (unit) =>
            unit.id === session.currentStep ||
            unit.stableId === session.currentStep,
        );
  if (!focusedUnit) {
    return (
      <RouteOrientation
        slot="session-progress-error"
        title="shell.route.lesson"
        description="page.lesson.description"
        className="px-4 py-8 sm:px-6 sm:py-10 lg:px-6 lg:py-8"
      >
        <QueryError message={t("session.error.noProgress")} />
      </RouteOrientation>
    );
  }
  const focusedProgress = progressByUnit.get(focusedUnit.id);
  if (!focusedProgress) {
    return (
      <RouteOrientation
        slot="session-progress-error"
        title="shell.route.lesson"
        description="page.lesson.description"
        className="px-4 py-8 sm:px-6 sm:py-10 lg:px-6 lg:py-8"
      >
        <QueryError message={t("session.error.noProgress")} />
      </RouteOrientation>
    );
  }
  const completed = session.snapshot.units.filter((unit) => {
    const status = progressByUnit.get(unit.id)?.status;
    return status === "completed" || status === "skipped";
  }).length;

  const blocks = groupDayIntoBlocks(
    session.snapshot.units.map((unit) => ({
      id: unit.id,
      type: unit.type,
      title: unit.title,
      estimatedMinutes: unit.estimatedMinutes,
    })),
    (unit) => progressByUnit.get(unit.id)?.status ?? "locked",
  );
  const visibleBlocks = blocks.filter((block) => block.totalCount > 0);
  const focusedBlockIndex = visibleBlocks.findIndex((block) =>
    block.units.some((unit) => unit.id === focusedUnit.id),
  );
  const activeBlock =
    session.status === "active" && focusedBlockIndex >= 0
      ? (visibleBlocks[focusedBlockIndex] ?? null)
      : null;
  const activeBlockIndex = activeBlock ? focusedBlockIndex : -1;
  const activeActivityIndex = activeBlock
    ? activeBlock.units.findIndex((unit) => unit.id === focusedUnit.id) + 1
    : null;
  const previousBlockCompleted =
    activeBlockIndex > 0 &&
    visibleBlocks[activeBlockIndex - 1]!.status === "completed";
  const showBlockTransition =
    Boolean(activeBlock) &&
    previousBlockCompleted &&
    activeActivityIndex === 1 &&
    focusedProgress.status === "ready";

  return (
    <div
      data-slot="guided-session"
      className="@container/lesson min-w-0 [&_[data-slot=badge]]:h-auto [&_[data-slot=badge]]:max-w-full [&_[data-slot=badge]]:whitespace-normal [&_[data-slot=badge]]:break-words [&_[data-slot=badge]]:py-1 [&_[data-slot=button]]:h-auto [&_[data-slot=button]]:max-w-full [&_[data-slot=button]]:whitespace-normal"
    >
      <div
        data-slot="lesson-workspace"
        className="grid min-h-[calc(100dvh-var(--shell-bar-size,4.5rem))] min-w-0 items-start @min-[72rem]/lesson:grid-cols-[minmax(0,1fr)_minmax(22rem,24rem)] @min-[72rem]/lesson:grid-rows-[auto_minmax(0,1fr)]"
      >
        <SessionProgressHeader
          session={session}
          completed={completed}
          activeBlock={activeBlock}
          activeBlockIndex={activeBlockIndex}
          activeActivityIndex={activeActivityIndex}
          phaseTotal={visibleBlocks.length}
          onContinueLater={() => router.push("/")}
        />

        <div
          ref={lessonFocusRef}
          data-slot="lesson-focus"
          role="group"
          aria-label={focusedUnit.title}
          tabIndex={-1}
          className="mx-auto w-full max-w-[72rem] min-w-0 scroll-mt-28 px-4 py-6 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-6 sm:py-7 lg:px-8 lg:py-8 @min-[72rem]/lesson:col-start-1 @min-[72rem]/lesson:row-start-2"
        >
          {showBlockTransition && activeBlock ? (
            <BlockTransition
              block={activeBlock}
              blockNumber={activeBlockIndex + 1}
              blockTotal={visibleBlocks.length}
              previousBlocks={visibleBlocks.slice(0, activeBlockIndex)}
              starting={pendingAction === `patch:${focusedUnit.id}`}
              onContinue={() =>
                void patchUnit(focusedUnit, focusedProgress, "in_progress")
              }
              onLater={() => router.push("/")}
            />
          ) : focusedProgress.status === "ready" ? (
            <section
              data-slot="unit-ready"
              aria-labelledby="unit-ready-title"
              className="flex w-full flex-col gap-4"
            >
              <div className="flex flex-col gap-3">
                <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  <Badge
                    variant="outline"
                    className={activityColorClass(focusedUnit.type)}
                  >
                    {t(unitTypeMessageKeys[focusedUnit.type])}
                  </Badge>
                  <EstimatedDuration minutes={focusedUnit.estimatedMinutes} />
                </div>
                <div className="flex min-w-0 max-w-[72ch] flex-col gap-1.5">
                  <h2
                    id="unit-ready-title"
                    className="break-words text-pretty text-[1.375rem] font-semibold leading-[1.875rem] tracking-[-0.02em] [overflow-wrap:anywhere] sm:text-2xl sm:leading-8"
                  >
                    {focusedUnit.title}
                  </h2>
                  <p className="break-words text-[0.9375rem] leading-6 text-muted-foreground [overflow-wrap:anywhere]">
                    {t("session.ready.description")}
                  </p>
                </div>
              </div>
              <ReadyLearningBrief session={session} unit={focusedUnit} />
              <div className="flex justify-stretch pt-1 sm:justify-end">
                <Button
                  className="w-full sm:w-auto"
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
              </div>
            </section>
          ) : focusedProgress.status === "locked" ? (
            <p className="text-sm text-muted-foreground">
              {t("session.locked")}
            </p>
          ) : (
            <UnitShell unit={focusedUnit} progress={focusedProgress}>
              <UnitBody
                key={focusedUnit.id}
                session={session}
                unit={focusedUnit}
                progress={focusedProgress}
                pending={pendingAction !== null}
                patchUnit={patchUnit}
                runAction={runAction}
                acceptSession={acceptSession}
                onInterview={() => {
                  const payload = focusedProgress.payload;
                  const interviewId =
                    payload.type === "interview"
                      ? payload.interviewSessionId
                      : null;
                  if (interviewId) {
                    router.push(
                      `/interview?id=${encodeURIComponent(interviewId)}`,
                    );
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
        <DayPlanRail session={session} />
      </div>
    </div>
  );
}

function ReadyLearningBrief({
  session,
  unit,
}: {
  session: LearnerSession;
  unit: LearnerUnit;
}) {
  const { locale, t } = useI18n();
  const outcomes = unit.objectives.length
    ? unit.objectives
    : session.snapshot.day.expectedOutcomes;
  const studyBody =
    unit.payload.type === "study" && unit.payload.body
      ? unit.payload.body
      : null;
  const completionCriteria = completionCriteriaLabels(unit, locale, t);

  return (
    <div
      data-slot="unit-learning-brief"
      className="flex min-w-0 flex-col gap-5"
    >
      <section className="flex min-w-0 flex-col gap-1.5 rounded-focus bg-surface-soft/55 px-4 py-4 sm:px-5 sm:py-5">
        <h3 className="text-sm font-semibold">
          {t("session.learningBrief.title")}
        </h3>
        <p className="max-w-[68ch] whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground [overflow-wrap:anywhere]">
          {studyBody ?? unit.description}
        </p>
      </section>
      <div className="grid min-w-0 gap-x-7 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
        <InfoList title={t("dayPlan.outcomes")} items={outcomes} />
        <InfoList
          title={t("dayPlan.topics")}
          items={session.snapshot.day.topics}
        />
        <InfoList
          title={t("session.learningBrief.completion")}
          items={completionCriteria}
        />
      </div>
      <Sources
        unit={unit}
        curriculumVersionId={session.snapshot.curriculumVersionId}
        flat
      />
    </div>
  );
}

function SessionProgressHeader({
  session,
  completed,
  activeBlock,
  activeBlockIndex,
  activeActivityIndex,
  phaseTotal,
  onContinueLater,
}: {
  session: LearnerSession;
  completed: number;
  activeBlock: LearningBlock | null;
  activeBlockIndex: number;
  activeActivityIndex: number | null;
  phaseTotal: number;
  onContinueLater: () => void;
}) {
  const { t } = useI18n();
  const { day } = session.snapshot;
  const total = session.snapshot.units.length;
  const lessonLabel = t("session.lessonTitle", {
    order: day.order,
    title: day.title,
  });
  return (
    <header
      data-slot="session-progress-header"
      className="sticky top-[var(--shell-bar-size,4.5rem)] z-10 w-full bg-background/95 py-3 backdrop-blur-sm sm:py-3.5 @min-[72rem]/lesson:col-start-1 @min-[72rem]/lesson:row-start-1"
    >
      <div
        data-slot="session-header-grid"
        className="mx-auto w-full max-w-[72rem] min-w-0 px-4 sm:px-6 lg:px-8"
      >
        <div data-slot="session-orientation" className="w-full min-w-0">
          <div className="flex min-w-0 flex-col gap-2.5 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-[0.6875rem] font-medium leading-4 text-muted-foreground">
                <p
                  data-slot="phase-activity-line"
                  className="min-w-0 break-words [overflow-wrap:anywhere]"
                >
                  {activeBlock
                    ? t("session.phaseProgress", {
                        phase: activeBlockIndex + 1,
                        phaseTotal,
                        name: t(activeBlock.label),
                        activity: activeActivityIndex ?? activeBlock.totalCount,
                        activityTotal: activeBlock.totalCount,
                      })
                    : t("session.lessonComplete")}
                </p>
                {activeBlock ? (
                  <EstimatedDuration
                    minutes={activeBlock.remainingMinutes}
                    remaining
                    className="h-auto min-h-6"
                  />
                ) : null}
              </div>
              <h1 className="break-words text-pretty text-lg font-semibold leading-6 tracking-[-0.015em] [overflow-wrap:anywhere]">
                {lessonLabel}
              </h1>
            </div>
            <div
              data-slot="session-utilities"
              className="flex min-w-0 flex-wrap items-center gap-1 text-muted-foreground"
            >
              <DayPlanSheet
                session={session}
                trigger={
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="@min-[72rem]/lesson:hidden"
                  >
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
          </div>
          <div className="mt-2 flex items-center justify-between gap-3 text-[0.6875rem] font-medium leading-4 text-muted-foreground">
            <span>{t("session.progress")}</span>
            <span className="tabular-nums">
              {completed} / {total}
            </span>
          </div>
          <Progress
            aria-label={t("session.progress")}
            value={completed}
            max={total}
            className="mt-1.5 h-1"
          />
        </div>
      </div>
    </header>
  );
}

function BlockTransition({
  block,
  blockNumber,
  blockTotal,
  previousBlocks,
  starting,
  onContinue,
  onLater,
}: {
  block: LearningBlock;
  blockNumber: number;
  blockTotal: number;
  previousBlocks: LearningBlock[];
  starting: boolean;
  onContinue: () => void;
  onLater: () => void;
}) {
  const { t } = useI18n();
  const covered = previousBlocks.flatMap((previous) =>
    previous.units.map((unit) => unit.title),
  );
  return (
    <section
      data-slot="block-transition"
      aria-labelledby="block-transition-title"
      className="flex w-full flex-col gap-5"
    >
      <div className="flex max-w-[68ch] flex-col gap-1.5">
        <p className="text-sm font-medium text-muted-foreground">
          {t("session.transition.complete", {
            phase: blockNumber - 1,
            total: blockTotal,
          })}
        </p>
        <h2
          id="block-transition-title"
          className="text-pretty text-2xl font-semibold leading-8 tracking-[-0.02em]"
        >
          {t("session.transition.title", { name: t(block.label) })}
        </h2>
      </div>
      {covered.length ? (
        <div className="flex max-w-[68ch] flex-col gap-2">
          <p className="text-sm font-medium">
            {t("session.transition.covered")}
          </p>
          <ul className="flex flex-col gap-2 text-sm leading-6 text-muted-foreground">
            {covered.map((title) => (
              <li key={title} className="flex items-start gap-2">
                <CheckIcon
                  aria-hidden
                  className="relative top-1 size-4 shrink-0 text-success"
                />
                <span className="min-w-0 break-words [overflow-wrap:anywhere]">
                  {title}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="flex flex-col gap-1.5 rounded-focus bg-surface-soft/55 px-4 py-4 sm:px-5 sm:py-5">
        <p className="text-sm font-semibold">{t("session.transition.next")}</p>
        <div className="flex flex-wrap items-center gap-2 text-sm leading-6 text-muted-foreground">
          <span>
            {t(
              block.totalCount === 1
                ? "session.transition.meta.one"
                : "session.transition.meta.other",
              {
                name: t(block.label),
                count: block.totalCount,
              },
            )}
          </span>
          <EstimatedDuration minutes={block.remainingMinutes} />
        </div>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          className="w-full sm:w-auto"
          disabled={starting}
          onClick={onContinue}
        >
          {starting ? t("session.starting") : t("session.transition.continue")}
          <ArrowRightIcon aria-hidden />
        </Button>
        <Button
          className="w-full sm:w-auto"
          variant="outline"
          onClick={onLater}
        >
          {t("session.transition.back")}
        </Button>
      </div>
      <p className="text-xs leading-5 text-muted-foreground">
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
  const { t } = useI18n();
  return (
    <ActivityFrame
      activityId={unit.id}
      activityType={unit.type}
      title={unit.title}
      description={unit.description}
      className="bg-transparent shadow-none"
      slots={{
        context: (
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className={activityColorClass(unit.type)}>
              {t(unitTypeMessageKeys[unit.type])}
            </Badge>
            <EstimatedDuration minutes={unit.estimatedMinutes} />
          </div>
        ),
        status: (
          <Badge
            variant={progress.status === "completed" ? "success" : "secondary"}
          >
            {t(unitStatusMessageKeys[progress.status])}
          </Badge>
        ),
        evidence: unit.completionCriteria.length ? (
          <CompletionEvidence unit={unit} />
        ) : undefined,
      }}
    >
      {children}
    </ActivityFrame>
  );
}

function completionCriteriaLabels(
  unit: LearnerUnit,
  locale: string,
  t: ReturnType<typeof useI18n>["t"],
): string[] {
  return unit.completionCriteria.map((criterion) => {
    switch (criterion.type) {
      case "acknowledgement":
        return t("session.criteria.acknowledgement");
      case "checklist":
        return t("session.criteria.checklist", {
          count: criterion.requiredItemIds.length,
        });
      case "attempts":
        return t("session.criteria.attempts", { count: criterion.minimum });
      case "dialogue":
        return t(
          criterion.requiresRevision
            ? "session.criteria.dialogueWithRevision"
            : "session.criteria.dialogue",
          { count: criterion.minimumTurns },
        );
      case "score":
        return t("session.criteria.score", {
          score: new Intl.NumberFormat(locale, {
            style: "percent",
            maximumFractionDigits: 0,
          }).format(criterion.minimum),
          attempts: criterion.minimumAttempts,
        });
      case "fields":
        return t("session.criteria.fields", {
          fields: criterion.required.join(", "),
        });
      case "exercise":
        return t(
          criterion.passingTestsRequired && criterion.acceptedReviewRequired
            ? "session.criteria.exerciseTestsAndReview"
            : criterion.passingTestsRequired
              ? "session.criteria.exerciseTests"
              : criterion.acceptedReviewRequired
                ? "session.criteria.exerciseReview"
                : "session.criteria.exercise",
        );
      case "custom":
        return t("session.criteria.custom", { key: criterion.key });
    }
  });
}

function CompletionEvidence({ unit }: { unit: LearnerUnit }) {
  const { locale, t } = useI18n();
  return (
    <section
      data-slot="completion-evidence"
      aria-labelledby={`completion-evidence-${unit.id}`}
      className="flex min-w-0 flex-col gap-2"
    >
      <h3
        id={`completion-evidence-${unit.id}`}
        className="text-sm font-semibold"
      >
        {t("session.learningBrief.completion")}
      </h3>
      <p className="max-w-[68ch] text-xs leading-5 text-muted-foreground">
        {t("session.completionEvidence.description")}
      </p>
      <ul className="flex flex-col gap-2 text-sm leading-6 text-muted-foreground">
        {completionCriteriaLabels(unit, locale, t).map((criterion) => (
          <li key={criterion} className="flex min-w-0 gap-2">
            <CircleIcon
              aria-hidden
              weight="fill"
              className="size-1.5 shrink-0 self-center text-primary"
            />
            <span className="min-w-0 break-words [overflow-wrap:anywhere]">
              {criterion}
            </span>
          </li>
        ))}
      </ul>
    </section>
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
      <div className="flex flex-col divide-y divide-border/60 border-y border-border/60 px-1">
        {items.map((item) => (
          <label
            key={item.id}
            className="flex min-h-11 items-start gap-3 py-3 text-sm leading-6 outline-none focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background"
          >
            <input
              type="checkbox"
              checked={checked.includes(item.id)}
              disabled={disabled}
              onChange={() => onToggle(item.id)}
              className="mt-1 size-4 shrink-0 accent-primary"
            />
            <span className="min-w-0 break-words [overflow-wrap:anywhere]">
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
      </div>
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
  className,
}: {
  title: string;
  items: readonly string[];
  empty: string;
  className?: string;
}) {
  return (
    <section className={cn("flex min-w-0 flex-col gap-2", className)}>
      <h3 className="text-sm font-medium">{title}</h3>
      {items.length ? (
        <ul className="flex flex-col gap-1.5 text-sm leading-6 text-muted-foreground">
          {items.map((item) => (
            <li key={item} className="flex min-w-0 gap-2">
              <CircleIcon
                aria-hidden
                weight="fill"
                className="size-1.5 shrink-0 self-center text-primary"
              />
              <span className="min-w-0 break-words [overflow-wrap:anywhere]">
                {item}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm leading-6 text-muted-foreground">{empty}</p>
      )}
    </section>
  );
}

function BriefingUnitImpl({
  session,
  unit,
  progress,
  pending,
  patchUnit,
}: UnitBodyProps) {
  const { t } = useI18n();
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
      <div data-slot="briefing-overview" className="grid gap-3 md:grid-cols-2">
        <BriefingSection
          title={t("session.briefing.topics")}
          items={day.topics}
          empty={t("session.briefing.topicsEmpty")}
          className="rounded-focus bg-surface-soft/45 px-4 py-4 sm:px-5 sm:py-5"
        />
        <BriefingSection
          title={t("session.briefing.outcomes")}
          items={day.expectedOutcomes}
          empty={t("session.briefing.outcomesEmpty")}
          className="rounded-focus bg-surface-soft/45 px-4 py-4 sm:px-5 sm:py-5"
        />
        <section className="flex min-w-0 flex-col gap-2 rounded-focus bg-surface-soft/45 px-4 py-4 sm:px-5 sm:py-5">
          <h3 className="text-sm font-medium">{t("session.briefing.level")}</h3>
          <p className="break-words text-lg font-semibold [overflow-wrap:anywhere]">
            {depthMessageKey(day.depthLevel)
              ? t(depthMessageKey(day.depthLevel)!)
              : day.depthLevel}
          </p>
          <p className="text-sm leading-6 text-muted-foreground">
            {t("session.briefing.levelDescription")}
          </p>
        </section>
        <BriefingSection
          title={t("session.briefing.scope")}
          items={outOfScope}
          empty={t("session.briefing.scopeEmpty")}
          className="rounded-focus bg-surface-soft/45 px-4 py-4 sm:px-5 sm:py-5"
        />
      </div>

      <section
        data-slot="briefing-plan"
        className="flex flex-col gap-3 rounded-focus bg-surface-soft/45 px-4 py-4 sm:px-5 sm:py-5"
      >
        <h3 className="text-base font-semibold">
          {t("session.briefing.plan")}
        </h3>
        <ol className="flex flex-col gap-1 text-sm">
          {blocks
            .filter((block) => block.totalCount > 0)
            .map((block, index) => (
              <li
                key={block.id}
                className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 py-3"
              >
                <span
                  className={cn(
                    "row-span-2 grid size-7 shrink-0 place-items-center self-center rounded-lg text-xs font-semibold",
                    activitySurfaceClass(block.units[0]?.type ?? "study"),
                    activityColorClass(block.units[0]?.type ?? "study"),
                  )}
                >
                  {index + 1}
                </span>
                <span className="min-w-0 break-words font-medium">
                  {t(block.label)}
                </span>
                <span className="flex flex-wrap items-center gap-1.5 text-xs leading-5 text-muted-foreground">
                  <span>
                    {t(
                      block.totalCount === 1
                        ? "session.activitiesCount.one"
                        : "session.activitiesCount.other",
                      { count: block.totalCount },
                    )}
                  </span>
                  <EstimatedDuration minutes={block.estimatedMinutes} />
                </span>
              </li>
            ))}
        </ol>
      </section>

      <Sources
        unit={unit}
        curriculumVersionId={session.snapshot.curriculumVersionId}
        flat
      />

      {complete ? (
        <CompletedNote />
      ) : (
        <div
          data-slot="briefing-actions"
          className="flex flex-col items-start gap-4 pt-1 sm:flex-row sm:items-center sm:justify-between"
        >
          <p className="max-w-[55ch] text-sm leading-6 text-muted-foreground">
            {t("session.briefing.skipDescription")}
          </p>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <Button
              className="w-full sm:w-auto"
              type="button"
              variant="outline"
              onClick={() => router.push("/interview")}
            >
              {t("session.briefing.diagnostic")}
            </Button>
            <Button
              className="w-full sm:w-auto"
              disabled={pending}
              onClick={finish}
            >
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

function StudyUnit({
  session,
  unit,
  progress,
  pending,
  patchUnit,
}: UnitBodyProps) {
  const { t } = useI18n();
  const payload =
    progress.payload.type === "study"
      ? progress.payload
      : { type: "study" as const, checkedItemIds: [], notes: "" };
  const draftSchema = useMemo(() => {
    const checklistIds = new Set(unit.checklist.map((item) => item.id));
    return studyActivityDraftSchema.superRefine((draft, context) => {
      if (draft.checkedItemIds.some((id) => !checklistIds.has(id))) {
        context.addIssue({
          code: "custom",
          message: "Unknown checklist item in activity draft",
        });
      }
    });
  }, [unit.checklist]);
  const draft = useLessonActivityDraft(
    lessonActivityDraftIdentity(session, unit),
    draftSchema,
    {
      type: "study" as const,
      checkedItemIds: payload.checkedItemIds,
      notes: payload.notes,
    },
  );
  const checked = draft.value.checkedItemIds;
  const notes = draft.value.notes;
  const required = Array.from(
    new Set(
      unit.completionCriteria.flatMap((criterion) =>
        criterion.type === "checklist" ? criterion.requiredItemIds : [],
      ),
    ),
  );
  const complete = progress.status === "completed";
  const nextPayload = {
    type: "study" as const,
    checkedItemIds: checked,
    notes,
  };
  async function save(status: "in_progress" | "completed") {
    const updated = await patchUnit(unit, progress, status, nextPayload);
    if (updated) draft.clear(nextPayload);
  }
  return (
    <div className="flex flex-col gap-6">
      {unit.payload.type === "study" && unit.payload.body ? (
        <p className="max-w-[68ch] whitespace-pre-wrap break-words text-[0.9375rem] leading-6 [overflow-wrap:anywhere]">
          {unit.payload.body}
        </p>
      ) : null}
      <Sources
        unit={unit}
        curriculumVersionId={session.snapshot.curriculumVersionId}
      />
      <Checklist
        items={unit.checklist}
        checked={checked}
        disabled={complete || pending}
        onToggle={(id) =>
          draft.setValue((current) => ({
            ...current,
            checkedItemIds: current.checkedItemIds.includes(id)
              ? current.checkedItemIds.filter((item) => item !== id)
              : [...current.checkedItemIds, id],
          }))
        }
      />
      <Field className="border-y border-border/60 py-5">
        <FieldLabel htmlFor={`notes-${unit.id}`}>
          {t("session.study.notes")}
        </FieldLabel>
        <Textarea
          id={`notes-${unit.id}`}
          name={`notes-${unit.id}`}
          autoComplete="off"
          rows={5}
          value={notes}
          disabled={complete || pending}
          onChange={(event) =>
            draft.setValue((current) => ({
              ...current,
              notes: event.target.value,
            }))
          }
          placeholder={t("session.study.placeholder")}
          className="min-h-28 bg-background"
        />
      </Field>
      {!complete ? (
        <div className="flex flex-col gap-2 border-t border-border/60 pt-5 sm:flex-row sm:justify-end">
          <Button
            className="w-full sm:w-auto"
            variant="outline"
            disabled={pending}
            onClick={() => void save("in_progress")}
          >
            {t("session.study.save")}
          </Button>
          <Button
            className="w-full sm:w-auto"
            disabled={pending || !required.every((id) => checked.includes(id))}
            onClick={() => void save("completed")}
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
  const draftSchema = useMemo(() => {
    const questionIds = new Set(unit.questions.map((question) => question.id));
    return recallActivityDraftSchema.superRefine((draft, context) => {
      if (Object.keys(draft.answers).some((id) => !questionIds.has(id))) {
        context.addIssue({
          code: "custom",
          message: "Unknown recall question in activity draft",
        });
      }
    });
  }, [unit.questions]);
  const draft = useLessonActivityDraft(
    lessonActivityDraftIdentity(session, unit),
    draftSchema,
    { type: "recall" as const, answers: {} },
  );
  const unsentAnswers = Object.fromEntries(
    Object.entries(draft.value.answers).filter(
      ([questionId]) => !persistedAnswers.has(questionId),
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
    const answer = unsentAnswers[questionId]?.trim() ?? "";
    if (!answer) return;
    const result = await runAction(
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
    if (result) {
      const remainingAnswers = { ...unsentAnswers };
      delete remainingAnswers[questionId];
      const nextDraft = { type: "recall" as const, answers: remainingAnswers };
      if (
        Object.values(remainingAnswers).some((value) => value.trim().length > 0)
      ) {
        draft.setValue(nextDraft);
      } else {
        draft.clear(nextDraft);
      }
    }
  }
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col divide-y divide-border/60">
        {unit.questions.map((question, index) => (
          <Field
            key={question.id}
            className="flex flex-col gap-3 py-5 first:pt-0 last:pb-0"
          >
            <FieldLabel
              className="w-full min-w-0"
              htmlFor={`recall-${question.id}`}
            >
              <span className="min-w-0 break-words text-base font-semibold leading-6 [overflow-wrap:anywhere]">
                {index + 1}. {question.prompt}
              </span>
            </FieldLabel>
            <Textarea
              id={`recall-${question.id}`}
              name={`recall-${question.id}`}
              autoComplete="off"
              rows={5}
              value={
                persistedAnswers.get(question.id)?.draft ??
                unsentAnswers[question.id] ??
                ""
              }
              disabled={
                persistedAnswers.has(question.id) ||
                progress.status === "completed" ||
                pending
              }
              onChange={(event) =>
                draft.setValue({
                  type: "recall",
                  answers: {
                    ...unsentAnswers,
                    [question.id]: event.target.value,
                  },
                })
              }
              aria-describedby={`recall-help-${unit.id}`}
              className="min-h-32 bg-background"
            />
            {!persistedAnswers.has(question.id) &&
            progress.status !== "completed" ? (
              <div className="flex justify-stretch sm:justify-end">
                <Button
                  className="w-full sm:w-auto"
                  disabled={
                    pending ||
                    (unsentAnswers[question.id]?.trim().length ?? 0) < 20
                  }
                  onClick={() => void submit(question.id)}
                >
                  <PaperPlaneTiltIcon aria-hidden />
                  {t("session.recall.saveAnswer", { number: index + 1 })}
                </Button>
              </div>
            ) : null}
          </Field>
        ))}
      </div>
      <p
        id={`recall-help-${unit.id}`}
        className="border-y border-border/60 py-3 text-xs leading-5 text-muted-foreground"
      >
        {t("session.recall.firstAttempt")}
      </p>
      {progress.status === "completed" ? (
        <CompletedNote />
      ) : allAnswered ? (
        <div className="flex justify-stretch border-t border-border/60 pt-5 sm:justify-end">
          <Button
            className="w-full sm:w-auto"
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
  const draft = useLessonActivityDraft(
    lessonActivityDraftIdentity(session, unit),
    teacherDialogueActivityDraftSchema,
    { type: "teacher-dialogue" as const, revision: "" },
  );
  const revision = draft.value.revision;
  const [localMessages, setLocalMessages] = useState<Array<{
    id: string;
    role: "user" | "assistant";
    content: string;
  }> | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [providerError, setProviderError] =
    useState<FailurePresentation | null>(null);
  const [streamStatus, setStreamStatus] = useState("");
  const [pendingDisclosure, setPendingDisclosure] = useState<{
    operationId: string;
    message: string;
    summary: string;
  } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );
  const history = useQuery({
    queryKey: ["agent-history", "teacher", session.id, unit.id],
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
            `/learning/sessions/v2/${encodeURIComponent(session.id)}/units/${encodeURIComponent(unit.id)}/teacher-transcript`,
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

  async function sendRevision(disclosureOperationId?: string) {
    const text = revision.trim();
    if (!text || streaming) return;
    const tutorMessage = answeringFollowUp
      ? `${opening}\n\nLearner first attempt:\n${firstDraft}\n\nLearner response to Tutor follow-up:\n${text}`
      : `${opening}\n\nLearner first attempt:\n${firstDraft}\n\nLearner refined explanation:\n${text}`;
    if (!disclosureOperationId) {
      const preparation = z
        .discriminatedUnion("required", [
          z.object({ required: z.literal(false) }),
          z.object({
            required: z.literal(true),
            disclosure: z.object({
              operationId: idSchema,
              scope: z.object({
                destination: z.string(),
                payloadCategories: z.array(z.string()),
                byteCount: z.number(),
              }),
            }),
          }),
        ])
        .parse(
          await api<unknown>("/ai/disclosures", {
            method: "POST",
            body: JSON.stringify({
              role: "teacher",
              sessionId: session.id,
              unitId: unit.id,
              message: tutorMessage,
            }),
          }),
        );
      if (preparation.required) {
        setPendingDisclosure({
          operationId: preparation.disclosure.operationId,
          message: tutorMessage,
          summary: `${preparation.disclosure.scope.destination}; ${preparation.disclosure.scope.payloadCategories.join(", ")}; ${preparation.disclosure.scope.byteCount.toLocaleString()} bytes`,
        });
        return;
      }
    }
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
    let terminalTurnId: string | null = null;
    let streamReportedError = false;
    try {
      stream: for await (const event of streamAgent(
        {
          role: "teacher",
          sessionId: session.id,
          unitId: unit.id,
          message: tutorMessage,
          ...(disclosureOperationId ? { disclosureOperationId } : {}),
        },
        controller.signal,
      )) {
        terminalTurnId ??= event.turnId;
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
        setProviderError({ message: teacherStreamFailureMessage });
        setStreamStatus(t("session.tutor.unavailable"));
        return;
      }
      if (!assistantContent.trim())
        throw new Error(t("session.tutor.emptyResponse"));
      const nextPayload = {
        ...payload,
        turnCount: payload.turnCount + 1,
        revisionAttemptIds: [
          ...payload.revisionAttemptIds,
          terminalTurnId ?? userMessage.id,
        ],
      };
      const updated = await patchUnit(
        unit,
        progress,
        "in_progress",
        nextPayload,
      );
      if (!updated) return;
      await acceptSession(updated);
      draft.clear({ type: "teacher-dialogue", revision: "" });
      setStreamStatus(t("session.tutor.received"));
      await queryClient.invalidateQueries({
        queryKey: ["agent-history", "teacher", session.id, unit.id],
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
        setProviderError(presentFailure(error, "session.action", t));
        setStreamStatus(t("session.tutor.unavailable"));
      }
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
      setStreaming(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <AlertDialog open={pendingDisclosure !== null}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("session.tutor.disclosureTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDisclosure?.summary ?? ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                const disclosure = pendingDisclosure;
                setPendingDisclosure(null);
                if (disclosure) {
                  void api(
                    `/ai/disclosures/${encodeURIComponent(disclosure.operationId)}/cancel`,
                    {
                      method: "POST",
                      body: JSON.stringify({}),
                    },
                  );
                }
              }}
            >
              {t("session.tutor.disclosureCancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const disclosure = pendingDisclosure;
                if (!disclosure) return;
                setPendingDisclosure(null);
                void api(
                  `/ai/disclosures/${encodeURIComponent(disclosure.operationId)}/approve`,
                  {
                    method: "POST",
                    body: JSON.stringify({}),
                  },
                ).then(() => sendRevision(disclosure.operationId));
              }}
            >
              {t("session.tutor.disclosureApprove")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <div className="flex min-w-0 flex-col gap-1.5 border-y border-border/60 py-4 text-sm leading-6 sm:py-5">
        <p className="font-semibold">{t("session.tutor.task")}</p>
        <p className="max-w-[68ch] break-words text-muted-foreground [overflow-wrap:anywhere]">
          {opening}
        </p>
      </div>
      {history.isPending && !localMessages ? (
        <LoadingState
          label="session.loading"
          variant="panel"
          className="min-h-28"
        />
      ) : history.isError ? (
        <SafeQueryError
          error={history.error}
          operation="session.load"
          retry={() => void history.refetch()}
        />
      ) : (
        <ol
          data-slot="teacher-transcript"
          aria-label={t("session.tutor.history")}
          className="flex max-h-96 min-w-0 flex-col gap-2 overflow-y-auto border-y border-border/60 py-3 sm:py-4"
        >
          {messages.length ? (
            messages.map((message) => (
              <li
                key={message.id}
                className={cn(
                  "flex min-w-0 max-w-[92%] flex-col gap-1 rounded-control px-3 py-2.5 text-sm leading-6",
                  message.role === "user"
                    ? "self-end bg-accent text-foreground"
                    : "border border-border/60 bg-background text-foreground",
                )}
              >
                <span className="block text-xs font-medium">
                  {message.role === "user"
                    ? t("session.tutor.you")
                    : t("session.tutor.name")}
                </span>
                <span className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                  {message.content || "…"}
                </span>
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
        <QueryError
          message={providerError.message}
          {...(providerError.diagnostic
            ? { diagnostic: providerError.diagnostic }
            : {})}
          retry={() => void sendRevision()}
        />
      ) : null}
      <p className="sr-only" role="status" aria-live="polite">
        {streamStatus}
      </p>
      {progress.status === "completed" ? (
        <CompletedNote />
      ) : (
        <>
          {!canComplete ? (
            <Field className="border-y border-border/60 py-5">
              <FieldLabel htmlFor={`teacher-revision-${unit.id}`}>
                {answeringFollowUp
                  ? t("session.tutor.followUpLabel")
                  : t("session.tutor.revisionLabel")}
              </FieldLabel>
              <Textarea
                id={`teacher-revision-${unit.id}`}
                name={`teacher-revision-${unit.id}`}
                autoComplete="off"
                rows={5}
                value={revision}
                disabled={streaming || pending}
                onChange={(event) =>
                  draft.setValue({
                    type: "teacher-dialogue",
                    revision: event.target.value,
                  })
                }
                placeholder={
                  answeringFollowUp
                    ? t("session.tutor.followUpPlaceholder")
                    : t("session.tutor.revisionPlaceholder")
                }
                className="min-h-28 bg-background"
              />
            </Field>
          ) : null}
          <div className="flex flex-col gap-2 border-t border-border/60 pt-5 sm:flex-row sm:justify-end">
            {streaming ? (
              <Button
                className="w-full sm:w-auto"
                variant="outline"
                onClick={() => abortRef.current?.abort()}
              >
                <StopIcon aria-hidden />
                {t("session.tutor.stop")}
              </Button>
            ) : canComplete ? (
              <Button
                className="w-full sm:w-auto"
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
                className="w-full sm:w-auto"
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
  const [retrying, setRetrying] = useState(false);
  const draftSchema = useMemo(() => {
    const optionsByQuestion = new Map(
      unit.questions.map((question) => [
        question.id,
        new Set(question.options.map((option) => option.id)),
      ]),
    );
    return quizActivityDraftSchema.superRefine((draft, context) => {
      if (
        payload.score !== null &&
        !retrying &&
        Object.keys(draft.answers).length > 0
      ) {
        context.addIssue({
          code: "custom",
          message: "Submitted quiz answers cannot be restored as a draft",
        });
        return;
      }
      for (const [questionId, optionId] of Object.entries(draft.answers)) {
        if (!optionsByQuestion.get(questionId)?.has(optionId)) {
          context.addIssue({
            code: "custom",
            message: "Unknown quiz answer in activity draft",
          });
          return;
        }
      }
    });
  }, [payload.score, retrying, unit.questions]);
  const draft = useLessonActivityDraft(
    lessonActivityDraftIdentity(session, unit),
    draftSchema,
    { type: "quiz" as const, answers: {} },
  );
  const answers = draft.value.answers;
  const [results, setResults] = useState<Array<{
    questionId: string;
    correct: boolean;
  }> | null>(null);
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
      draft.clear({ type: "quiz", answers: {} });
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
          className="border-y border-destructive/30 bg-destructive/5 py-4 text-sm text-destructive"
        >
          {t("session.quiz.invalid")}
        </p>
      ) : null}
      {unit.questions.map((question, index) => {
        const result = results?.find((item) => item.questionId === question.id);
        return (
          <FieldSet
            key={question.id}
            className="gap-3 border-b border-border/60 pb-5 last:border-b-0 last:pb-0"
          >
            <FieldLegend className="mb-0 min-w-0 break-words text-base leading-6 [overflow-wrap:anywhere]">
              {index + 1}. {question.prompt}
            </FieldLegend>
            <RadioGroup
              name={`quiz-${question.id}`}
              value={answers[question.id] ?? ""}
              disabled={
                !answering || progress.status === "completed" || pending
              }
              onValueChange={(value) =>
                draft.setValue((current) => ({
                  ...current,
                  answers: {
                    ...current.answers,
                    [question.id]: value,
                  },
                }))
              }
              className="gap-0 divide-y divide-border/60 border-y border-border/60"
            >
              {question.options.map((option) => (
                <FieldLabel
                  key={option.id}
                  htmlFor={`quiz-${question.id}-${option.id}`}
                  className="min-h-11 w-full min-w-0 cursor-pointer items-center gap-3 px-3 py-2 text-sm transition-colors hover:bg-accent has-data-[state=checked]:bg-accent motion-reduce:transition-none"
                >
                  <RadioGroupItem
                    id={`quiz-${question.id}-${option.id}`}
                    value={option.id}
                  />
                  <span className="min-w-0 break-words [overflow-wrap:anywhere]">
                    {option.label}
                  </span>
                </FieldLabel>
              ))}
            </RadioGroup>
            {result ? (
              <p
                className={cn(
                  "border-y px-3 py-2 text-sm font-medium",
                  result.correct
                    ? "border-success/25 bg-success/10 text-success-foreground"
                    : "border-warning/35 bg-warning/20 text-warning-foreground",
                )}
              >
                {result.correct
                  ? t("session.quiz.correct")
                  : t("session.quiz.retryNeeded")}
              </p>
            ) : null}
          </FieldSet>
        );
      })}
      {payload.score !== null ? (
        <p
          role="status"
          className="border-y border-border/60 py-3 text-sm font-medium"
        >
          {t("session.quiz.score", {
            score: Math.round(payload.score * 100),
            minimum: Math.round(minimumScore * 100),
          })}
        </p>
      ) : null}
      {progress.status === "completed" ? (
        <CompletedNote />
      ) : passed ? (
        <div className="flex justify-stretch border-t border-border/60 pt-5 sm:justify-end">
          <Button
            className="w-full sm:w-auto"
            disabled={pending}
            onClick={() => void patchUnit(unit, progress, "completed", payload)}
          >
            {t("session.quiz.complete")}
            <CheckIcon aria-hidden />
          </Button>
        </div>
      ) : scored && !retrying ? (
        <div className="flex flex-col items-start gap-4 border-y border-warning/35 bg-warning/20 py-4 text-warning-foreground sm:flex-row sm:items-center sm:justify-between sm:py-5">
          <p className="max-w-[60ch] text-sm leading-6">
            {t("session.quiz.retryDescription")}
          </p>
          <Button
            className="w-full sm:w-auto"
            type="button"
            variant="outline"
            disabled={pending || invalidQuestions.length > 0}
            onClick={() => {
              draft.clear({ type: "quiz", answers: {} });
              setResults(null);
              setRetrying(true);
            }}
          >
            {t("session.quiz.retry")}
          </Button>
        </div>
      ) : (
        <div className="flex justify-stretch border-t border-border/60 pt-5 sm:justify-end">
          <Button
            className="w-full sm:w-auto"
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
  const saved = Boolean(
    payload.prediction && payload.explanation && payload.verbalFix,
  );
  const draftSchema = useMemo(
    () =>
      codeReadingActivityDraftSchema.superRefine((_draft, context) => {
        if (saved) {
          context.addIssue({
            code: "custom",
            message: "Submitted code-reading fields cannot be restored",
          });
        }
      }),
    [saved],
  );
  const draft = useLessonActivityDraft(
    lessonActivityDraftIdentity(session, unit),
    draftSchema,
    {
      type: "code-reading" as const,
      prediction: payload.prediction,
      explanation: payload.explanation,
      verbalFix: payload.verbalFix,
    },
  );
  const fields = draft.value;
  async function submit() {
    const result = await runAction(
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
    if (result) draft.clear(fields);
  }
  const disabled = saved || progress.status === "completed" || pending;
  return (
    <div className="flex flex-col gap-6">
      {unit.payload.type === "code-reading" ? (
        <pre className="max-w-full overflow-x-auto border-y border-border/60 bg-surface-soft/60 p-4 font-mono text-sm leading-6">
          <code>{unit.payload.snippet}</code>
        </pre>
      ) : null}
      {unit.questions.map((question) => (
        <p
          key={question.id}
          className="break-words text-sm font-medium leading-6 [overflow-wrap:anywhere]"
        >
          {question.prompt}
        </p>
      ))}
      <FieldGroup className="gap-0 divide-y divide-border/60 border-y border-border/60">
        {(
          [
            ["prediction", t("session.code.prediction")],
            ["explanation", t("session.code.explanation")],
            ["verbalFix", t("session.code.verbalFix")],
          ] as const
        ).map(([field, label]) => (
          <Field key={field} className="py-4">
            <FieldLabel htmlFor={`${field}-${unit.id}`}>{label}</FieldLabel>
            <Textarea
              id={`${field}-${unit.id}`}
              name={`${field}-${unit.id}`}
              autoComplete="off"
              rows={4}
              value={fields[field]}
              disabled={disabled}
              onChange={(event) =>
                draft.setValue((current) => ({
                  ...current,
                  [field]: event.target.value,
                }))
              }
              className="min-h-24 bg-background"
            />
          </Field>
        ))}
      </FieldGroup>
      {progress.status === "completed" ? (
        <CompletedNote />
      ) : saved ? (
        <div className="flex justify-stretch border-t border-border/60 pt-5 sm:justify-end">
          <Button
            className="w-full sm:w-auto"
            disabled={pending}
            onClick={() => void patchUnit(unit, progress, "completed", payload)}
          >
            {t("session.code.complete")}
            <CheckIcon aria-hidden />
          </Button>
        </div>
      ) : (
        <div className="flex justify-stretch border-t border-border/60 pt-5 sm:justify-end">
          <Button
            className="w-full sm:w-auto"
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

function ExerciseHandoffUnit({ session, unit, progress }: UnitBodyProps) {
  const { t } = useI18n();
  const criteria =
    unit.payload.type === "exercise"
      ? unit.payload.acceptanceCriteria
      : unit.completionCriteria.map((criterion) => criterion.type);
  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-6 border-y border-border/60 py-5 md:grid-cols-2 md:divide-x md:divide-border/60">
        <InfoList
          title={
            unit.type === "review"
              ? t("session.practice.reviewCriteria")
              : t("session.practice.acceptance")
          }
          items={criteria}
        />
        {unit.payload.type === "exercise" && unit.payload.constraints.length ? (
          <div className="md:pl-6">
            <InfoList
              title={t("session.practice.constraints")}
              items={unit.payload.constraints}
            />
          </div>
        ) : null}
      </div>
      <p className="text-sm leading-6 text-muted-foreground">
        {t("session.practice.description")}
      </p>
      {progress.status === "completed" ? (
        <CompletedNote />
      ) : (
        <div className="flex justify-stretch border-t border-border/60 pt-5 sm:justify-end">
          <Button className="w-full sm:w-auto" asChild>
            <Link
              href={`/exercise?sessionId=${encodeURIComponent(session.id)}`}
            >
              {unit.type === "review"
                ? t("session.practice.openReview")
                : t("session.practice.open")}
              <ArrowRightIcon aria-hidden />
            </Link>
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
        <div className="flex flex-col items-start gap-4 border-y border-border/60 py-5">
          <p className="max-w-[60ch] text-sm leading-6 text-muted-foreground">
            {t("session.interview.reportReady")}
          </p>
          <div className="flex w-full flex-col gap-2 sm:flex-row sm:justify-end">
            <Button
              className="w-full sm:w-auto"
              variant="outline"
              onClick={onInterview}
            >
              {t("session.interview.openReport")}
              <ArrowRightIcon aria-hidden />
            </Button>
            <Button
              className="w-full sm:w-auto"
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
        <div className="flex justify-stretch border-t border-border/60 pt-5 sm:justify-end">
          <Button className="w-full sm:w-auto" onClick={onInterview}>
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
        <div
          data-slot="day-summary"
          className="flex flex-col divide-y divide-border/60 border-y border-border/60"
        >
          <div data-slot="summary-narrative" className="py-5">
            <p className="max-w-[68ch] break-words text-[0.9375rem] leading-6 [overflow-wrap:anywhere]">
              {summaryMessageText(t, result.summary.narrative)}
            </p>
          </div>
          <dl
            data-slot="summary-metrics"
            className="grid divide-y divide-border/60 sm:grid-cols-3 sm:divide-x sm:divide-y-0"
          >
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
          </dl>
          <section
            data-slot="summary-insights"
            className="grid gap-8 py-5 lg:grid-cols-2"
          >
            <InfoList
              title={t("session.summary.strengths")}
              items={
                result.summary.strengths.length
                  ? result.summary.strengths.map((message) =>
                      summaryMessageText(t, message),
                    )
                  : [t("session.summary.noStrengths")]
              }
            />
            <InfoList
              title={t("session.summary.gaps")}
              items={
                result.summary.gaps.length
                  ? result.summary.gaps.map((message) =>
                      summaryMessageText(t, message),
                    )
                  : [t("session.summary.noGaps")]
              }
            />
          </section>
          <footer
            data-slot="summary-actions"
            className="flex flex-col gap-5 py-5"
          >
            <p className="text-sm text-muted-foreground">
              {t("session.summary.counts", {
                mistakes: result.summary.mistakeCandidates.length,
                cards: result.summary.flashcardCandidates.length,
              })}
            </p>
            {progress.status === "completed" ? (
              <CompletedNote />
            ) : (
              <Button
                className="w-full self-start sm:w-auto sm:self-end"
                disabled={pending}
                onClick={() => void completeSummary()}
              >
                {pending
                  ? t("session.summary.completing")
                  : t("session.summary.complete")}
                <CheckIcon aria-hidden />
              </Button>
            )}
          </footer>
        </div>
      ) : persisted.isError ? (
        <SafeQueryError
          error={persisted.error}
          operation="session.load"
          retry={() => void persisted.refetch()}
        />
      ) : persisted.isPending && summaryId ? (
        <LoadingState
          label="session.summary.loading"
          variant="panel"
          className="min-h-36"
        />
      ) : (
        <div
          data-slot="summary-generate"
          className="flex flex-col items-start gap-4 border-y border-border/60 py-5 sm:flex-row sm:items-center sm:justify-between"
        >
          <p className="max-w-[65ch] text-xs leading-5 text-muted-foreground">
            {t("session.summary.description")}
          </p>
          <Button
            className="w-full shrink-0 sm:w-auto"
            disabled={pending}
            onClick={() => void createSummary()}
          >
            {pending
              ? t("session.summary.generating")
              : t("session.summary.generate")}
          </Button>
        </div>
      )}
    </div>
  );
}

function SummaryMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-4 sm:p-5">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-xl font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function summaryMessageText(
  t: (
    key: MessageKey,
    values?: Readonly<Record<string, string | number>>,
  ) => string,
  message: z.infer<typeof daySummaryMessageSchema>,
): string {
  return t(message.key as MessageKey, message.params);
}

function CheckpointUnit({ unit, progress, pending, patchUnit }: UnitBodyProps) {
  const { t } = useI18n();
  const payload =
    progress.payload.type === "checkpoint"
      ? progress.payload
      : { type: "checkpoint" as const, acknowledged: false };
  return (
    <div className="flex flex-col gap-6">
      <p className="break-words text-sm leading-6 [overflow-wrap:anywhere]">
        {unit.payload.type === "checkpoint"
          ? unit.payload.label
          : unit.description}
      </p>
      {progress.status === "completed" ? (
        <CompletedNote />
      ) : (
        <div className="flex justify-stretch border-t border-border/60 pt-5 sm:justify-end">
          <Button
            className="w-full sm:w-auto"
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
        <div className="flex justify-stretch border-t border-border/60 pt-5 sm:justify-end">
          <Button asChild className="w-full sm:w-auto" variant="outline">
            <Link href="/review">{t("nav.review")}</Link>
          </Button>
        </div>
      )}
    </div>
  );
}

function Sources({
  unit,
  curriculumVersionId,
  flat = false,
}: {
  unit: LearnerUnit;
  curriculumVersionId: string;
  flat?: boolean;
}) {
  const { locale, t } = useI18n();
  if (!unit.sources.length) {
    return (
      <div
        data-slot="unit-sources"
        className={cn(
          "flex flex-col gap-3 rounded-focus bg-surface-soft/40 px-4 py-4 sm:px-5",
          flat ? null : "mt-1",
        )}
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
        <Link
          href={`/courses/studio?version=${encodeURIComponent(curriculumVersionId)}`}
          className="inline-flex w-fit items-center gap-1.5 rounded-control text-xs font-medium text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t("session.sources.openEditor")}
          <ArrowUpRightIcon aria-hidden className="size-3.5" />
        </Link>
      </div>
    );
  }
  return (
    <div data-slot="unit-sources" className="flex flex-col gap-3">
      <h3 className="text-base font-semibold">{t("session.sources.title")}</h3>
      <ul className={cn("flex flex-col gap-3", flat ? null : "px-0")}>
        {unit.sources.map((source) => (
          <li
            key={source.id}
            data-slot="source-card"
            className="flex min-w-0 flex-col gap-3 rounded-focus bg-surface-soft/40 px-4 py-4 sm:px-5 sm:py-5"
          >
            <div className="flex min-w-0 flex-col items-start gap-3 sm:flex-row sm:justify-between">
              <div className="min-w-0">
                <p className="break-words font-medium leading-5 [overflow-wrap:anywhere]">
                  {source.title}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {sourceKindMessageKey(source.kind)
                    ? t(sourceKindMessageKey(source.kind)!)
                    : source.kind}{" "}
                  · {formatMinutesShort(source.estimatedMinutes, locale)}
                </p>
              </div>
              <Badge
                variant={source.required ? "default" : "outline"}
                className="h-auto max-w-full shrink-0 whitespace-normal break-words py-1 text-left"
              >
                {source.required
                  ? t("session.sources.primary")
                  : t("session.sources.additional")}
              </Badge>
            </div>
            {source.learningGoal ? (
              <div className="flex flex-col gap-1">
                <p className="text-xs font-medium text-muted-foreground">
                  {t("session.sources.focus")}
                </p>
                <p className="break-words text-sm leading-6 text-muted-foreground [overflow-wrap:anywhere]">
                  {source.learningGoal}
                </p>
              </div>
            ) : null}
            {source.description ? (
              <p className="break-words text-sm leading-6 text-muted-foreground [overflow-wrap:anywhere]">
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
      <h3 className="text-base font-semibold">{title}</h3>
      <ul className="flex flex-col gap-2 text-sm leading-6 text-muted-foreground">
        {items.map((item) => (
          <li key={item} className="flex min-w-0 gap-2">
            <CircleIcon
              aria-hidden
              weight="fill"
              className="size-1.5 shrink-0 self-center text-primary"
            />
            <span className="min-w-0 break-words [overflow-wrap:anywhere]">
              {item}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CompletedNote() {
  const { t } = useI18n();
  return (
    <p
      role="status"
      className="inline-flex max-w-full flex-wrap items-center gap-2 rounded-control bg-success/10 px-3 py-2 text-sm font-medium text-success-foreground"
    >
      <CheckIcon aria-hidden />
      {t("session.completed")}
    </p>
  );
}
