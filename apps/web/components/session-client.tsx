"use client";

import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowRightIcon,
  CheckIcon,
  CircleIcon,
  ClockIcon,
  PaperPlaneTiltIcon,
  StopIcon,
} from "@phosphor-icons/react";
import { z } from "zod";

import { api, streamAgent } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { EmptyState, QueryError } from "@/components/query-state";
import { Skeleton } from "@/components/ui/skeleton";

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
    .object({ type: z.literal("briefing"), scope: z.array(z.string()) })
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
      correctQuestionIds: z.array(idSchema),
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

type LearnerSession = z.infer<typeof learnerSessionSchema>;
type LearnerUnit = z.infer<typeof learnerUnitSchema>;
type UnitProgress = z.infer<typeof unitProgressSchema>;
type ProgressPayload = z.infer<typeof progressPayloadSchema>;

const statusLabels: Record<z.infer<typeof unitStatusSchema>, string> = {
  locked: "Заблокировано",
  ready: "Доступно",
  in_progress: "Сейчас",
  completed: "Готово",
  skipped: "Пропущено",
};

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
  return error instanceof Error ? error.message : "Неизвестная ошибка";
}

export function SessionClient() {
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
        aria-label="Загружаю занятие…"
      >
        <span className="sr-only">Загружаю занятие…</span>
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
        title="Активного занятия нет"
        description="Открой Path и начни доступный день — здесь появится сохранённый прогресс."
        action={<Button onClick={() => router.push("/")}>Открыть Path</Button>}
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
    return <QueryError message="Snapshot занятия не содержит юнитов" />;
  }
  const focusedProgress = progressByUnit.get(focusedUnit.id);
  if (!focusedProgress) {
    return <QueryError message="Прогресс текущего юнита отсутствует" />;
  }
  const completed = session.unitProgress.filter(
    (item) => item.status === "completed",
  ).length;

  return (
    <div
      data-slot="guided-session"
      className="flex min-w-0 flex-col gap-4 md:gap-6"
    >
      <PageHeader
        title={`День ${session.snapshot.day.order}: ${session.snapshot.day.title}`}
        description={session.snapshot.day.goal}
        actions={
          <Badge
            variant={session.status === "completed" ? "success" : "outline"}
          >
            {completed} из {session.snapshot.units.length}
          </Badge>
        }
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
            Закрыть
          </Button>
        </div>
      ) : null}

      <div className="grid min-w-0 gap-4 md:grid-cols-[14rem_minmax(0,1fr)] md:gap-6">
        <nav
          data-slot="unit-step-rail"
          aria-label="Юниты занятия"
          className="min-w-0"
        >
          <ol className="flex flex-col gap-2">
            {session.snapshot.units.map((unit) => {
              const progress = progressByUnit.get(unit.id);
              const status = progress?.status ?? "locked";
              const current = unit.id === focusedUnit.id;
              return (
                <li
                  key={unit.id}
                  data-slot="unit-step"
                  data-status={status}
                  aria-current={current ? "step" : undefined}
                  className={`flex min-w-0 items-start gap-2 rounded-md border p-3 text-sm ${
                    current
                      ? "border-primary bg-accent"
                      : "border-border bg-background"
                  }`}
                >
                  <span
                    className={`grid size-6 shrink-0 place-items-center rounded-full border text-xs ${status === "completed" ? "border-success bg-success text-success-foreground" : "border-border"}`}
                  >
                    {status === "completed" ? (
                      <CheckIcon aria-hidden />
                    ) : (
                      unit.order
                    )}
                  </span>
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="block font-medium leading-5">
                      {unit.title}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {statusLabels[status]}
                    </span>
                  </span>
                </li>
              );
            })}
          </ol>
        </nav>

        <UnitShell unit={focusedUnit} progress={focusedProgress}>
          {focusedProgress.status === "ready" ? (
            <div className="flex flex-col items-start gap-4">
              <p className="max-w-[70ch] text-sm leading-6 text-muted-foreground">
                Юнит доступен. Начало будет сохранено, поэтому после перезапуска
                занятие продолжится с этого места.
              </p>
              <Button
                disabled={pendingAction !== null}
                onClick={() =>
                  void patchUnit(focusedUnit, focusedProgress, "in_progress")
                }
              >
                {pendingAction === `patch:${focusedUnit.id}`
                  ? "Начинаю…"
                  : "Начать юнит"}
                <ArrowRightIcon aria-hidden />
              </Button>
            </div>
          ) : focusedProgress.status === "locked" ? (
            <p className="text-sm text-muted-foreground">
              Сначала заверши предыдущий обязательный юнит.
            </p>
          ) : (
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
              onInterview={() => router.push("/interview")}
            />
          )}
        </UnitShell>
      </div>
    </div>
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
  return (
    <section
      data-slot="unit-shell"
      data-unit-type={unit.type}
      className="min-w-0 rounded-lg border border-border bg-card"
    >
      <header
        data-slot="unit-shell-header"
        className="flex flex-col gap-4 border-b border-border p-4 md:flex-row md:items-start md:justify-between md:p-6"
      >
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{unit.type}</Badge>
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <ClockIcon aria-hidden />
              {unit.estimatedMinutes} мин
            </span>
          </div>
          <h2 className="text-pretty text-xl font-semibold leading-7">
            {unit.title}
          </h2>
          <p className="max-w-[70ch] text-sm leading-6 text-muted-foreground">
            {unit.description}
          </p>
        </div>
        <Badge
          variant={progress.status === "completed" ? "success" : "secondary"}
        >
          {statusLabels[progress.status]}
        </Badge>
      </header>
      <div data-slot="unit-shell-content" className="p-4 md:p-6">
        {children}
      </div>
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
  onExercise: () => void;
  onInterview: () => void;
};

function UnitBody(props: UnitBodyProps) {
  switch (props.unit.type) {
    case "briefing":
      return <BriefingUnit {...props} />;
    case "study":
      return <StudyUnit {...props} />;
    case "recall":
      return <RecallUnit {...props} />;
    case "teacher-dialogue":
      return <TeacherDialogueUnit {...props} />;
    case "quiz":
      return <QuizUnit {...props} />;
    case "code-reading":
      return <CodeReadingUnit {...props} />;
    case "exercise":
    case "review":
      return <ExerciseHandoffUnit {...props} />;
    case "interview":
      return <InterviewUnit {...props} />;
    case "summary":
      return <SummaryUnit {...props} />;
    case "checkpoint":
      return <CheckpointUnit {...props} />;
    case "spaced-review":
      return <SpacedReviewUnit {...props} />;
  }
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
  if (!items.length) return null;
  return (
    <fieldset data-slot="unit-checklist" className="flex flex-col gap-2">
      <legend className="pb-2 text-sm font-medium">Checklist</legend>
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
              <span className="text-muted-foreground"> · обязательно</span>
            ) : null}
          </span>
        </label>
      ))}
    </fieldset>
  );
}

function BriefingUnit({ unit, progress, pending, patchUnit }: UnitBodyProps) {
  const payload =
    progress.payload.type === "briefing"
      ? progress.payload
      : { type: "briefing" as const, acknowledged: false, checkedItemIds: [] };
  const [acknowledged, setAcknowledged] = useState(payload.acknowledged);
  const [checked, setChecked] = useState(payload.checkedItemIds);
  const required = unit.checklist
    .filter((item) => item.required)
    .map((item) => item.id);
  const complete = progress.status === "completed";
  const canComplete =
    acknowledged && required.every((id) => checked.includes(id));
  return (
    <div className="flex flex-col gap-6">
      {unit.payload.type === "briefing" && unit.payload.scope.length ? (
        <InfoList title="Границы дня" items={unit.payload.scope} />
      ) : null}
      <InfoList title="Результат дня" items={unit.objectives} />
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
      <label className="flex min-h-11 items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          checked={acknowledged}
          disabled={complete || pending}
          onChange={(event) => setAcknowledged(event.target.checked)}
          className="size-4 accent-primary"
        />
        Цель и границы дня понятны
      </label>
      {!complete ? (
        <div className="flex justify-end">
          <Button
            disabled={!canComplete || pending}
            onClick={() =>
              void patchUnit(unit, progress, "completed", {
                type: "briefing",
                acknowledged,
                checkedItemIds: checked,
              })
            }
          >
            Завершить briefing
            <CheckIcon aria-hidden />
          </Button>
        </div>
      ) : (
        <CompletedNote />
      )}
    </div>
  );
}

function StudyUnit({ unit, progress, pending, patchUnit }: UnitBodyProps) {
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
        Заметки
        <textarea
          id={`notes-${unit.id}`}
          rows={5}
          value={notes}
          disabled={complete || pending}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Коротко зафиксируй механизм и вопросы…"
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
            Сохранить заметки
          </Button>
          <Button
            disabled={pending || !required.every((id) => checked.includes(id))}
            onClick={() =>
              void patchUnit(unit, progress, "completed", nextPayload)
            }
          >
            Завершить study
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
  const payload =
    progress.payload.type === "recall"
      ? progress.payload
      : { type: "recall" as const, draft: "", firstAttemptId: null };
  const [answer, setAnswer] = useState(payload.draft);
  const firstQuestion = unit.questions[0];
  const saved = Boolean(payload.firstAttemptId);
  async function submit() {
    if (!firstQuestion) return;
    await runAction(
      `recall:${unit.id}`,
      async () => {
        const raw = await api<unknown>(
          `/learning/sessions/v2/${encodeURIComponent(session.id)}/units/${encodeURIComponent(unit.id)}/recall-attempts`,
          {
            method: "POST",
            body: JSON.stringify({
              operationId: operationId(),
              answer: answer.trim(),
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
      <div className="flex flex-col gap-2">
        {unit.questions.map((question, index) => (
          <div key={question.id} className="flex gap-2 text-sm leading-6">
            <span className="font-medium">{index + 1}.</span>
            <p>{question.prompt}</p>
          </div>
        ))}
      </div>
      <label
        className="flex flex-col gap-2 text-sm font-medium"
        htmlFor={`recall-${unit.id}`}
      >
        Объяснение по памяти
        <textarea
          id={`recall-${unit.id}`}
          rows={8}
          value={answer}
          disabled={saved || progress.status === "completed" || pending}
          onChange={(event) => setAnswer(event.target.value)}
          aria-describedby={`recall-help-${unit.id}`}
          className="min-h-44 resize-y rounded-md border border-input bg-background p-3 font-normal leading-6 outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-70"
        />
      </label>
      <p
        id={`recall-help-${unit.id}`}
        className="text-xs text-muted-foreground"
      >
        Первая попытка сохраняется отдельно и не перезаписывается.
      </p>
      {progress.status === "completed" ? (
        <CompletedNote />
      ) : saved ? (
        <div className="flex justify-end">
          <Button
            disabled={pending}
            onClick={() => void patchUnit(unit, progress, "completed", payload)}
          >
            Завершить recall
            <CheckIcon aria-hidden />
          </Button>
        </div>
      ) : (
        <div className="flex justify-end">
          <Button
            disabled={pending || answer.trim().length < 20 || !firstQuestion}
            onClick={() => void submit()}
          >
            <PaperPlaneTiltIcon aria-hidden />
            Сохранить первую попытку
          </Button>
        </div>
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
            `/agent/history?role=teacher&sessionId=${encodeURIComponent(session.id)}`,
          ),
        ),
  });
  const messages = localMessages ?? history.data?.messages ?? [];
  const opening =
    unit.payload.type === "teacher-dialogue"
      ? unit.payload.openingPrompt
      : "Уточни объяснение.";
  const recallDraft = session.unitProgress.find(
    (item) => item.payload.type === "recall",
  )?.payload;
  const firstDraft = recallDraft?.type === "recall" ? recallDraft.draft : "";
  const canComplete =
    payload.turnCount >=
      (unit.payload.type === "teacher-dialogue"
        ? unit.payload.minimumTurns
        : 1) && payload.revisionAttemptIds.length > 0;

  async function sendRevision() {
    const text = revision.trim();
    if (!text || streaming) return;
    setProviderError(null);
    setStreaming(true);
    setStreamStatus("Teacher формулирует уточнение…");
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
    try {
      for await (const event of streamAgent(
        {
          role: "teacher",
          sessionId: session.id,
          message: `${opening}\n\nПервая попытка ученика:\n${firstDraft}\n\nУточнённое объяснение ученика:\n${text}`,
        },
        controller.signal,
      )) {
        if (event.type === "message.delta") {
          assistantContent += event.content ?? "";
          setLocalMessages((current) =>
            (current ?? []).map((message) =>
              message.id === assistantId
                ? {
                    ...message,
                    content: message.content + (event.content ?? ""),
                  }
                : message,
            ),
          );
        }
        if (event.type === "error")
          throw new Error(event.message ?? "Teacher не ответил");
      }
      if (!assistantContent.trim())
        throw new Error("Teacher вернул пустой ответ");
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
      setStreamStatus("Ответ Teacher получен");
      await queryClient.invalidateQueries({
        queryKey: ["agent-history", "teacher", session.id],
        refetchType: "none",
      });
    } catch (error) {
      if (controller.signal.aborted) {
        setStreamStatus("Ответ Teacher остановлен");
      } else {
        setProviderError(errorMessage(error));
        setStreamStatus("Teacher недоступен");
      }
    } finally {
      setStreaming(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1 rounded-md border border-border bg-background p-3 text-sm leading-6">
        <p className="font-medium">Задача Teacher</p>
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
          aria-label="История диалога с Teacher"
          className="flex max-h-96 flex-col gap-2 overflow-y-auto"
        >
          {messages.length ? (
            messages.map((message) => (
              <li
                key={message.id}
                className={`flex max-w-[90%] flex-col gap-1 rounded-md p-3 text-sm leading-6 ${message.role === "user" ? "self-end bg-primary text-primary-foreground" : "bg-muted"}`}
              >
                <span className="block text-xs font-medium">
                  {message.role === "user" ? "Ты" : "Teacher"}
                </span>
                {message.content || "…"}
              </li>
            ))
          ) : (
            <li className="text-sm text-muted-foreground">
              История пуста. Отправь уточнённое объяснение — Teacher ответит без
              раскрытия эталона.
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
            Повторить
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
          <label
            className="flex flex-col gap-2 text-sm font-medium"
            htmlFor={`teacher-revision-${unit.id}`}
          >
            Уточнённое объяснение
            <textarea
              id={`teacher-revision-${unit.id}`}
              rows={5}
              value={revision}
              disabled={streaming || pending}
              onChange={(event) => setRevision(event.target.value)}
              placeholder="Перепиши механизм точнее после follow-up…"
              className="min-h-28 resize-y rounded-md border border-input bg-background p-3 font-normal leading-6 outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
          <div className="flex flex-wrap justify-end gap-2">
            {streaming ? (
              <Button
                variant="outline"
                onClick={() => abortRef.current?.abort()}
              >
                <StopIcon aria-hidden />
                Остановить Teacher
              </Button>
            ) : canComplete ? (
              <Button
                disabled={pending}
                onClick={() =>
                  void patchUnit(unit, progress, "completed", payload)
                }
              >
                Завершить диалог
                <CheckIcon aria-hidden />
              </Button>
            ) : (
              <Button
                disabled={pending || revision.trim().length < 20}
                onClick={() => void sendRevision()}
              >
                <PaperPlaneTiltIcon aria-hidden />
                Отправить revision
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
  const [results, setResults] = useState<Array<{
    questionId: string;
    correct: boolean;
  }> | null>(
    payload.score === null
      ? null
      : payload.attemptedQuestionIds.map((questionId) => ({
          questionId,
          correct: payload.correctQuestionIds.includes(questionId),
        })),
  );
  const minimumScore =
    unit.payload.type === "quiz" ? unit.payload.minimumScore : 1;
  const scored = payload.score !== null;
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
    if (result) setResults(result.attempt.results);
  }
  const allAnswered = unit.questions.every((question) =>
    Boolean(answers[question.id]),
  );
  return (
    <div className="flex flex-col gap-6">
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
                    scored || progress.status === "completed" || pending
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
                {result.correct ? "Верно" : "Нужно повторить"}
              </p>
            ) : null}
          </fieldset>
        );
      })}
      {payload.score !== null ? (
        <p role="status" className="text-sm font-medium">
          Серверная оценка: {Math.round(payload.score * 100)}%. Порог:{" "}
          {Math.round(minimumScore * 100)}%.
        </p>
      ) : null}
      {progress.status === "completed" ? (
        <CompletedNote />
      ) : scored ? (
        <div className="flex justify-end">
          <Button
            disabled={pending || (payload.score ?? 0) < minimumScore}
            onClick={() => void patchUnit(unit, progress, "completed", payload)}
          >
            Завершить quiz
            <CheckIcon aria-hidden />
          </Button>
        </div>
      ) : (
        <div className="flex justify-end">
          <Button
            disabled={pending || !allAnswered}
            onClick={() => void submit()}
          >
            Проверить ответы
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
          ["prediction", "Предсказание"],
          ["explanation", "Объяснение механизма"],
          ["verbalFix", "Исправление словами"],
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
            Завершить code reading
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
            Сохранить разбор
          </Button>
        </div>
      )}
    </div>
  );
}

function ExerciseHandoffUnit({ unit, progress, onExercise }: UnitBodyProps) {
  const criteria =
    unit.payload.type === "exercise"
      ? unit.payload.acceptanceCriteria
      : unit.completionCriteria.map((criterion) => criterion.type);
  return (
    <div className="flex flex-col gap-6">
      <InfoList
        title={
          unit.type === "review" ? "Условия review" : "Acceptance criteria"
        }
        items={criteria}
      />
      {unit.payload.type === "exercise" && unit.payload.constraints.length ? (
        <InfoList title="Ограничения" items={unit.payload.constraints} />
      ) : null}
      <p className="text-sm leading-6 text-muted-foreground">
        Код редактируется только во внешнем Zed. Diff, allowlisted tests и
        read-only Reviewer открываются в Practice.
      </p>
      {progress.status === "completed" ? (
        <CompletedNote />
      ) : (
        <div className="flex justify-end">
          <Button onClick={onExercise}>
            {unit.type === "review"
              ? "Открыть read-only Review"
              : "Открыть практику"}
            <ArrowRightIcon aria-hidden />
          </Button>
        </div>
      )}
    </div>
  );
}

function InterviewUnit({ unit, progress, onInterview }: UnitBodyProps) {
  return (
    <div className="flex flex-col gap-6">
      {unit.payload.type === "interview" ? (
        <InfoList title="Темы" items={unit.payload.topics} />
      ) : null}
      {progress.status === "completed" ? (
        <CompletedNote />
      ) : (
        <div className="flex justify-end">
          <Button onClick={onInterview}>
            Открыть интервью
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
        <InfoList title="Итоговые вопросы" items={unit.payload.prompts} />
      ) : null}
      {result ? (
        <div data-slot="day-summary" className="flex flex-col gap-5">
          <div className="rounded-md border border-border bg-muted p-4">
            <p className="text-sm leading-6">{result.summary.narrative}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <SummaryMetric
              label="Квиз"
              value={`${Math.round(result.summary.metrics.quizScore * 100)}%`}
            />
            <SummaryMetric
              label="Evidence"
              value={String(result.summary.metrics.evidenceCount)}
            />
            <SummaryMetric
              label="Подсказки"
              value={`${result.summary.metrics.maxHintLevel} / 5`}
            />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <InfoList
              title="Что уже получается"
              items={
                result.summary.strengths.length
                  ? result.summary.strengths
                  : ["Пока недостаточно подтверждённого evidence"]
              }
            />
            <InfoList
              title="Что закрепить"
              items={
                result.summary.gaps.length
                  ? result.summary.gaps
                  : ["Новых пробелов не зафиксировано"]
              }
            />
          </div>
          <p className="text-sm text-muted-foreground">
            В журнал добавлено ошибок: {result.summary.mistakeCandidates.length}
            . Кандидатов в карточки: {result.summary.flashcardCandidates.length}
            .
          </p>
          {progress.status === "completed" ? (
            <CompletedNote />
          ) : (
            <div className="flex justify-end">
              <Button disabled={pending} onClick={() => void completeSummary()}>
                {pending ? "Завершаю…" : "Завершить день"}
                <CheckIcon aria-hidden />
              </Button>
            </div>
          )}
        </div>
      ) : persisted.isError ? (
        <div className="flex flex-col items-start gap-3" role="alert">
          <p className="text-sm text-destructive">
            Не удалось восстановить сохранённый итог:{" "}
            {errorMessage(persisted.error)}
          </p>
          <Button variant="outline" onClick={() => void persisted.refetch()}>
            Повторить загрузку
          </Button>
        </div>
      ) : persisted.isPending && summaryId ? (
        <div className="flex flex-col gap-3" role="status">
          <span className="sr-only">Загружаю итог…</span>
          <Skeleton className="h-20" />
          <Skeleton className="h-16" />
        </div>
      ) : (
        <div className="flex flex-col items-start gap-2">
          <Button disabled={pending} onClick={() => void createSummary()}>
            {pending ? "Формирую итог…" : "Сформировать итог"}
          </Button>
          <p className="text-xs text-muted-foreground">
            Итог строится только из сохранённых ответов, тестов и read-only
            review. Браузер не выставляет mastery и не придумывает evidence.
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
            Подтвердить checkpoint
            <CheckIcon aria-hidden />
          </Button>
        </div>
      )}
    </div>
  );
}

function SpacedReviewUnit({ unit, progress }: UnitBodyProps) {
  return (
    <div className="flex flex-col gap-6">
      {unit.payload.type === "spaced-review" ? (
        <InfoList title="Темы повторения" items={unit.payload.topicIds} />
      ) : null}
      <p className="text-sm text-muted-foreground">
        Повторение будет доступно в Practice после появления серверного
        evidence.
      </p>
      {progress.status === "completed" ? (
        <CompletedNote />
      ) : (
        <Button disabled>Начать серверное повторение</Button>
      )}
    </div>
  );
}

function Sources({ unit }: { unit: LearnerUnit }) {
  if (!unit.sources.length) return null;
  return (
    <div data-slot="unit-sources" className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">Источники</h3>
      <ul className="flex flex-col gap-2">
        {unit.sources.map((source) => (
          <li key={source.id} className="text-sm leading-6">
            {source.url ? (
              <a
                href={source.url}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {source.title}
              </a>
            ) : (
              <span className="font-medium">{source.title}</span>
            )}
            <span className="text-muted-foreground">
              {" "}
              · {source.estimatedMinutes} мин
              {source.required ? " · обязательно" : ""}
            </span>
            {source.learningGoal ? (
              <p className="text-muted-foreground">{source.learningGoal}</p>
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
  return (
    <p className="inline-flex items-center gap-2 text-sm font-medium text-success">
      <CheckIcon aria-hidden />
      Юнит завершён и сохранён
    </p>
  );
}
