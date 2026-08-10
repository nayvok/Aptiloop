"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowSquareOutIcon,
  CheckCircleIcon,
  ClipboardTextIcon,
  CodeIcon,
  CopyIcon,
  FlaskIcon,
  LockKeyIcon,
  PlayIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { z } from "zod";

import { api } from "@/lib/api";
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
import { PageHeader } from "@/components/page-header";
import { EmptyState, QueryError } from "@/components/query-state";
import { Skeleton } from "@/components/ui/skeleton";

const protectedKeys = new Set([
  "referenceAnswer",
  "evaluationPoints",
  "correctOptionIds",
  "correctQuestionIds",
  "protectedEvaluation",
  "rawResponse",
  "raw_response",
  "providerRpc",
]);

const idSchema = z.string().trim().min(1);
const diffSchema = z
  .object({
    patch: z.string(),
    changed: z.boolean(),
    truncated: z.boolean(),
  })
  .strict();
const testRunSchema = z
  .object({
    id: idSchema,
    operationId: idSchema,
    status: z.enum([
      "running",
      "passed",
      "failed",
      "backend_error",
      "cancelled",
    ]),
    exitCode: z.number().int(),
    output: z.string(),
    result: z.unknown().nullable(),
    workspaceCurrent: z.boolean(),
  })
  .strict();
const findingSchema = z
  .object({
    severity: z.enum(["info", "warning", "error"]),
    category: z.enum([
      "correctness",
      "types",
      "edge_case",
      "readability",
      "requirements",
      "tests",
    ]),
    file: z.string().min(1).optional(),
    line: z.number().int().positive().optional(),
    message: z.string().min(1),
    hintLevel: z.number().int().min(0).max(3),
  })
  .strict();
const evidenceBundleSchema = z
  .object({
    id: idSchema,
    sha256: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
    workspaceSnapshotHash: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
  })
  .strict();
const reviewSchema = z
  .object({
    id: idSchema,
    status: z.enum(["passed", "changes_requested"]),
    summary: z.string().min(1),
    findings: z.array(findingSchema),
    strengths: z.array(z.string().min(1)),
    evidenceBundle: evidenceBundleSchema.nullable(),
  })
  .strict();
const exerciseProgressSchema = z
  .object({
    status: z.enum(["locked", "ready", "in_progress", "completed", "skipped"]),
    payload: z
      .object({
        type: z.literal("exercise"),
        attemptId: z.string().nullable(),
        latestTestRunId: z.string().nullable(),
        latestReviewId: z.string().nullable(),
      })
      .strict(),
  })
  .strict();
const reviewProgressSchema = z
  .object({
    status: z.enum(["locked", "ready", "in_progress", "completed", "skipped"]),
    payload: z
      .object({
        type: z.literal("review"),
        reviewId: z.string().nullable(),
        reviewStatus: z
          .enum(["pending", "accepted", "changes_requested"])
          .nullable(),
        reviewedDiffHash: z.string().nullable(),
      })
      .strict(),
  })
  .strict();
const exerciseSchema = z
  .object({
    sessionId: idSchema,
    exerciseUnitId: idSchema.nullable(),
    reviewUnitId: idSchema.nullable(),
    exerciseUnitProgress: exerciseProgressSchema.nullable(),
    reviewUnitProgress: reviewProgressSchema.nullable(),
    id: idSchema,
    title: z.string().min(1),
    prompt: z.string().min(1),
    difficulty: z.string().min(1),
    estimatedMinutes: z.number().int().positive(),
    criteria: z.array(z.string().min(1)),
    constraints: z.array(z.string().min(1)),
    topics: z.array(z.string().min(1)),
    workspace: z
      .object({
        id: idSchema,
        generation: z.number().int().positive(),
        environmentId: idSchema,
        trust: z.literal("trusted-local-unsandboxed"),
      })
      .strict()
      .nullable(),
    attempt: z
      .object({
        id: idSchema,
        changed: z.boolean(),
        testsRun: z.boolean(),
        diff: diffSchema,
        latestTestRun: testRunSchema.nullable(),
        latestReview: reviewSchema.nullable(),
      })
      .strict()
      .optional(),
  })
  .strict();
const diffResponseSchema = z
  .object({ diff: z.string(), changed: z.boolean(), truncated: z.boolean() })
  .strict();
const checkResponseSchema = testRunSchema.omit({ workspaceCurrent: true });
const reviewResponseSchema = reviewSchema.extend({
  suggestedMasteryChanges: z.array(z.unknown()),
  evidenceBundle: evidenceBundleSchema,
});
const disclosureResponseSchema = z.object({
  kind: z.literal("disclosure"),
  required: z.literal(true),
  disclosure: z.object({
    operationId: idSchema,
    status: z.literal("pending"),
    scope: z.object({
      destination: z.string().min(1),
      payloadCategories: z.array(z.string().min(1)),
      byteCount: z.number().int().nonnegative(),
      exclusions: z.array(z.string().min(1)),
    }),
  }),
});
type PendingReviewDisclosure = {
  reviewOperationId: string;
  disclosure: z.infer<typeof disclosureResponseSchema>["disclosure"];
};
const attemptResponseSchema = z
  .object({
    id: idSchema,
    workspace: z
      .object({ id: idSchema, generation: z.number().int().positive() })
      .strict(),
  })
  .strict();
const openResponseSchema = z
  .object({
    opened: z.boolean(),
    message: z.string().optional(),
  })
  .strict();

type Diff = z.infer<typeof diffSchema>;
type TestRun = z.infer<typeof testRunSchema>;
type Review = z.infer<typeof reviewSchema>;

function assertNoProtectedFields(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(assertNoProtectedFields);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    if (protectedKeys.has(key)) {
      throw new Error("Protected curriculum field received");
    }
    assertNoProtectedFields(nested);
  }
}

function parseSafe<T>(schema: z.ZodType<T>, value: unknown): T {
  assertNoProtectedFields(value);
  return schema.parse(value);
}

async function resolveSessionId(requestedSessionId: string | null) {
  if (requestedSessionId) return requestedSessionId;
  const value = await api<unknown>("/learning/sessions/current");
  assertNoProtectedFields(value);
  const envelope = z
    .object({ session: z.object({ id: idSchema }).loose().nullable() })
    .strict()
    .parse(value);
  if (!envelope.session) throw new Error("Активного занятия нет");
  return envelope.session.id;
}

export function ExerciseClient() {
  const params = useSearchParams();
  const requestedSessionId = params.get("sessionId");
  const router = useRouter();
  const queryClient = useQueryClient();
  const [localDiff, setLocalDiff] = useState<Diff | null>(null);
  const [localTest, setLocalTest] = useState<TestRun | null>(null);
  const [localReview, setLocalReview] = useState<Review | null>(null);
  const [zedFallback, setZedFallback] = useState<string | null>(null);
  const [workspaceNotice, setWorkspaceNotice] = useState<string | null>(null);
  const [pendingReviewDisclosure, setPendingReviewDisclosure] =
    useState<PendingReviewDisclosure | null>(null);

  const query = useQuery({
    queryKey: ["exercise", requestedSessionId ?? "current"],
    queryFn: async () => {
      const sessionId = await resolveSessionId(requestedSessionId);
      const value = await api<unknown>(
        `/exercises/current?sessionId=${encodeURIComponent(sessionId)}`,
      );
      return parseSafe(exerciseSchema, value);
    },
  });

  const invalidatePractice = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["exercise"] }),
      queryClient.invalidateQueries({ queryKey: ["learning-session"] }),
      queryClient.invalidateQueries({ queryKey: ["learning-session-current"] }),
      queryClient.invalidateQueries({ queryKey: ["learning-path"] }),
    ]);
  };

  const patchUnit = async (
    sessionId: string,
    unitId: string,
    body: Record<string, unknown>,
  ) =>
    api<unknown>(
      `/learning/sessions/v2/${encodeURIComponent(sessionId)}/units/${encodeURIComponent(unitId)}`,
      {
        method: "PATCH",
        body: JSON.stringify({ ...body, operationId: crypto.randomUUID() }),
      },
    );

  const attempt = useMutation({
    mutationFn: async () => {
      const exercise = query.data;
      if (!exercise) throw new Error("Упражнение ещё не загружено");
      if (
        exercise.exerciseUnitId &&
        exercise.exerciseUnitProgress?.status === "ready"
      ) {
        await patchUnit(exercise.sessionId, exercise.exerciseUnitId, {
          status: "in_progress",
        });
      }
      const value = await api<unknown>(`/exercises/${exercise.id}/attempts`, {
        method: "POST",
        body: JSON.stringify({ sessionId: exercise.sessionId }),
      });
      return parseSafe(attemptResponseSchema, value);
    },
    onSuccess: async () => {
      setLocalDiff(null);
      setLocalTest(null);
      setLocalReview(null);
      await invalidatePractice();
    },
  });

  const getAttemptId = () => {
    const attemptId = query.data?.attempt?.id;
    if (!attemptId) throw new Error("Сначала создайте попытку");
    return attemptId;
  };

  const loadDiff = useMutation({
    mutationFn: async () => {
      const value = await api<unknown>(
        `/exercise-attempts/${encodeURIComponent(getAttemptId())}/diff`,
      );
      const parsed = parseSafe(diffResponseSchema, value);
      return {
        patch: parsed.diff,
        changed: parsed.changed,
        truncated: parsed.truncated,
      } satisfies Diff;
    },
    onSuccess: (nextDiff) => {
      const previousPatch =
        localDiff?.patch ?? query.data?.attempt?.diff.patch ?? "";
      if (previousPatch !== nextDiff.patch) {
        setLocalTest((current) =>
          current ? { ...current, workspaceCurrent: false } : current,
        );
        setLocalReview(null);
      }
      setLocalDiff(nextDiff);
    },
  });

  const runTests = useMutation({
    mutationFn: async () => {
      const attemptId = getAttemptId();
      const testValue = await api<unknown>(
        `/exercise-attempts/${encodeURIComponent(attemptId)}/checks`,
        {
          method: "POST",
          body: JSON.stringify({
            operationId: crypto.randomUUID(),
            checkIds: ["apt.compat.node24.npm-test.v1"],
          }),
        },
      );
      const test = parseSafe(checkResponseSchema, testValue);
      const diffValue = await api<unknown>(
        `/exercise-attempts/${encodeURIComponent(attemptId)}/diff`,
      );
      const parsedDiff = parseSafe(diffResponseSchema, diffValue);
      return {
        test: { ...test, workspaceCurrent: true } satisfies TestRun,
        diff: {
          patch: parsedDiff.diff,
          changed: parsedDiff.changed,
          truncated: parsedDiff.truncated,
        } satisfies Diff,
      };
    },
    onSuccess: async ({ test, diff }) => {
      setLocalDiff(diff);
      setLocalTest(test);
      setLocalReview(null);
      await invalidatePractice();
    },
  });

  const runReview = useMutation({
    mutationFn: async (input?: {
      reviewOperationId: string;
      disclosureOperationId: string;
    }) => {
      const attemptId = getAttemptId();
      const currentDiffValue = await api<unknown>(
        `/exercise-attempts/${encodeURIComponent(attemptId)}/diff`,
      );
      const currentDiff = parseSafe(diffResponseSchema, currentDiffValue);
      const visiblePatch =
        localDiff?.patch ?? query.data?.attempt?.diff.patch ?? "";
      if (currentDiff.diff !== visiblePatch) {
        throw new Error(
          "Файлы изменились после последнего diff. Обновите diff и снова запустите тесты.",
        );
      }
      const reviewOperationId = input?.reviewOperationId ?? crypto.randomUUID();
      const value = await api<unknown>(
        `/exercise-attempts/${encodeURIComponent(attemptId)}/reviews`,
        {
          method: "POST",
          body: JSON.stringify({
            operationId: reviewOperationId,
            ...(input
              ? { disclosureOperationId: input.disclosureOperationId }
              : { previewDisclosure: true }),
          }),
        },
      );
      const disclosure = disclosureResponseSchema.safeParse(value);
      if (disclosure.success) {
        return {
          kind: "disclosure" as const,
          reviewOperationId,
          disclosure: disclosure.data.disclosure,
        };
      }
      const parsed = parseSafe(reviewResponseSchema, value);
      return {
        kind: "review" as const,
        review: reviewSchema.parse({
          id: parsed.id,
          status: parsed.status,
          summary: parsed.summary,
          findings: parsed.findings,
          strengths: parsed.strengths,
          evidenceBundle: parsed.evidenceBundle,
        }),
      };
    },
    onSuccess: async (result) => {
      if (result.kind === "disclosure") {
        setPendingReviewDisclosure({
          reviewOperationId: result.reviewOperationId,
          disclosure: result.disclosure,
        });
        return;
      }
      setLocalReview(result.review);
      await invalidatePractice();
    },
  });

  const openZed = useMutation({
    mutationFn: async () => {
      const value = await api<unknown>(
        `/exercise-attempts/${encodeURIComponent(getAttemptId())}/open`,
        { method: "POST" },
      );
      return parseSafe(openResponseSchema, value);
    },
    onSuccess: (data) => {
      setZedFallback(
        data.opened
          ? null
          : (data.message ?? "Zed недоступен для этой рабочей области."),
      );
    },
  });

  const acceptReview = useMutation({
    mutationFn: async () => {
      const exercise = query.data;
      const attemptId = exercise?.attempt?.id;
      const exerciseUnitId = exercise?.exerciseUnitId;
      const reviewUnitId = exercise?.reviewUnitId;
      const review = localReview ?? exercise?.attempt?.latestReview;
      const test = localTest ?? exercise?.attempt?.latestTestRun;
      if (
        !exercise ||
        !attemptId ||
        !exerciseUnitId ||
        !reviewUnitId ||
        !review ||
        review.status !== "passed" ||
        !test ||
        test.status !== "passed" ||
        !test.workspaceCurrent
      ) {
        throw new Error(
          "Серверные подтверждения навыка для завершения ещё не готовы",
        );
      }

      const exerciseStatus = exercise.exerciseUnitProgress?.status;
      if (exerciseStatus === "ready") {
        await patchUnit(exercise.sessionId, exerciseUnitId, {
          status: "in_progress",
        });
      }
      if (exerciseStatus !== "completed") {
        await patchUnit(exercise.sessionId, exerciseUnitId, {
          status: "completed",
          payload: {
            type: "exercise",
            attemptId,
            latestTestRunId: test.id,
            latestReviewId: null,
          },
        });
      }

      const reviewStatus = exercise.reviewUnitProgress?.status;
      if (reviewStatus !== "completed" && reviewStatus !== "in_progress") {
        await patchUnit(exercise.sessionId, reviewUnitId, {
          status: "in_progress",
        });
      }
      if (reviewStatus !== "completed") {
        await patchUnit(exercise.sessionId, reviewUnitId, {
          status: "completed",
          payload: {
            type: "review",
            reviewId: review.id,
            reviewStatus: "accepted",
            reviewedDiffHash: `review:${review.id}:test:${test.id}`,
          },
        });
      }
      return exercise.sessionId;
    },
    onSuccess: async (sessionId) => {
      await invalidatePractice();
      router.push(`/session?id=${encodeURIComponent(sessionId)}`);
    },
  });

  if (query.isLoading) {
    return (
      <div
        className="flex flex-col gap-5"
        role="status"
        aria-label="Загружаю практику…"
      >
        <Skeleton className="h-20" />
        <Skeleton className="h-96" />
      </div>
    );
  }
  if (query.isError || !query.data) {
    return (
      <QueryError
        message={
          query.error instanceof Error
            ? query.error.message
            : "Упражнение недоступно"
        }
        retry={() => void query.refetch()}
      />
    );
  }

  const exercise = query.data;
  const exerciseStatus = exercise.exerciseUnitProgress?.status;
  const exerciseLocked =
    exercise.exerciseUnitId !== null &&
    (exerciseStatus === "locked" || exerciseStatus === "skipped");
  if (exerciseLocked) {
    return (
      <div data-slot="exercise-locked" className="flex flex-col gap-6">
        <PageHeader
          title="Практика откроется по ходу занятия"
          description="Сначала завершите обязательные объяснения, recall, квиз и чтение кода. Условие упражнения появится только на своём шаге."
        />
        <EmptyState
          title="Текущий шаг ещё не практика"
          description="Вернитесь в занятие: там уже отмечен один следующий доступный шаг."
          action={
            <Button
              type="button"
              onClick={() =>
                router.push(
                  `/session?id=${encodeURIComponent(exercise.sessionId)}`,
                )
              }
            >
              <LockKeyIcon aria-hidden />
              Вернуться к занятию
            </Button>
          }
        />
      </div>
    );
  }
  const attemptId = exercise.attempt?.id;
  const diff = localDiff ?? exercise.attempt?.diff ?? null;
  const latestTest = localTest ?? exercise.attempt?.latestTestRun ?? null;
  const review = localReview ?? exercise.attempt?.latestReview ?? null;
  const reviewAllowed = Boolean(
    attemptId &&
    diff?.changed &&
    latestTest?.status === "passed" &&
    latestTest.workspaceCurrent &&
    !review,
  );
  const nextAction = !attemptId
    ? "Создайте изолированную попытку."
    : !diff?.changed
      ? "Внесите самостоятельную правку в Zed, затем обновите Git diff."
      : !latestTest
        ? "Запустите разрешённые тесты на текущем diff."
        : latestTest.status !== "passed"
          ? "Исправьте код и снова запустите тесты."
          : !latestTest.workspaceCurrent
            ? "Код изменился после теста — запустите тесты повторно."
            : !review
              ? "Тесты прошли. Теперь запросите проверку решения."
              : review.status === "changes_requested"
                ? "Примените замечания самостоятельно и повторите diff → тесты → проверку решения."
                : "Проверка решения принята — сохраните подтверждения навыка и вернитесь к занятию.";
  const error =
    attempt.error ??
    loadDiff.error ??
    runTests.error ??
    runReview.error ??
    openZed.error ??
    acceptReview.error;

  async function copyWorkspaceId() {
    if (!exercise.workspace) return;
    try {
      await navigator.clipboard.writeText(exercise.workspace.id);
      setWorkspaceNotice("Идентификатор рабочей области скопирован.");
    } catch {
      setWorkspaceNotice("Не удалось скопировать идентификатор.");
    }
  }
  async function approveReviewDisclosure() {
    const pending = pendingReviewDisclosure;
    if (!pending) return;
    try {
      await api(`/ai/disclosures/${pending.disclosure.operationId}/approve`, {
        method: "POST",
        body: "{}",
      });
      setPendingReviewDisclosure(null);
      runReview.mutate({
        reviewOperationId: pending.reviewOperationId,
        disclosureOperationId: pending.disclosure.operationId,
      });
    } catch (error) {
      setWorkspaceNotice(
        error instanceof Error
          ? error.message
          : "Не удалось подтвердить отправку данных.",
      );
    }
  }

  async function cancelReviewDisclosure() {
    const pending = pendingReviewDisclosure;
    if (!pending) return;
    setPendingReviewDisclosure(null);
    await api(`/ai/disclosures/${pending.disclosure.operationId}`, {
      method: "DELETE",
    }).catch(() => undefined);
    setWorkspaceNotice("Данные не отправлены. Проверку можно запросить позже.");
  }

  return (
    <div data-slot="exercise-client" className="flex flex-col gap-6">
      <PageHeader
        title={exercise.title}
        description={exercise.prompt}
        actions={
          <>
            <Badge variant="outline">{exercise.difficulty}</Badge>
            <Badge variant="outline">≈ {exercise.estimatedMinutes} мин</Badge>
          </>
        }
      />

      {error instanceof Error ? (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-foreground"
        >
          <WarningCircleIcon
            aria-hidden
            className="mt-0.5 size-5 shrink-0 text-destructive"
          />
          <span>{error.message}</span>
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section
          className="flex min-w-0 flex-col gap-6"
          aria-label="Работа над упражнением"
        >
          <div
            data-slot="exercise-criteria"
            className="grid gap-6 rounded-xl border border-border bg-card p-6 md:grid-cols-2"
          >
            <div className="flex flex-col gap-4">
              <h2 className="font-semibold">Готово, когда</h2>
              <ul className="flex flex-col gap-2">
                {exercise.criteria.map((criterion) => (
                  <li
                    key={criterion}
                    className="flex items-start gap-2 text-sm leading-6"
                  >
                    <CheckCircleIcon
                      aria-hidden
                      className="mt-1 size-4 shrink-0 text-success"
                    />
                    {criterion}
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex flex-col gap-4">
              <h2 className="font-semibold">Ограничения</h2>
              <ul className="flex flex-col gap-2">
                {exercise.constraints.map((constraint) => (
                  <li
                    key={constraint}
                    className="flex items-start gap-2 text-sm leading-6 text-muted-foreground"
                  >
                    <span
                      aria-hidden
                      className="mt-2 size-1.5 shrink-0 rounded-full bg-primary"
                    />
                    {constraint}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div
            data-slot="exercise-workspace"
            className="flex flex-col gap-4 rounded-xl border border-border bg-card p-6"
          >
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="min-w-0">
                <h2 className="font-semibold">Изолированная рабочая область</h2>
                <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
                  {exercise.workspace
                    ? `${exercise.workspace.id} · поколение ${exercise.workspace.generation}`
                    : "Будет создана сервером после начала попытки."}
                </p>
              </div>
              {attemptId ? (
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={copyWorkspaceId}>
                    <CopyIcon aria-hidden />
                    Скопировать ID
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => openZed.mutate()}
                    disabled={openZed.isPending}
                  >
                    <ArrowSquareOutIcon aria-hidden />
                    {openZed.isPending ? "Открываю…" : "Открыть в Zed"}
                  </Button>
                </div>
              ) : (
                <Button
                  onClick={() => attempt.mutate()}
                  disabled={attempt.isPending}
                >
                  <CodeIcon aria-hidden />
                  {attempt.isPending ? "Создаю…" : "Создать попытку"}
                </Button>
              )}
            </div>
            {zedFallback ? (
              <p role="status" className="text-sm text-warning-foreground">
                {zedFallback}
              </p>
            ) : null}
            {workspaceNotice ? (
              <p role="status" className="text-sm text-muted-foreground">
                {workspaceNotice}
              </p>
            ) : null}
          </div>

          <div
            data-slot="exercise-evidence"
            className="overflow-hidden rounded-xl border border-border bg-card"
          >
            <div className="border-b border-border bg-muted/35 px-4 py-3 text-sm">
              <span className="font-medium">Следующий шаг: </span>
              <span className="text-muted-foreground">{nextAction}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2 border-b border-border p-4">
              <Button
                size="sm"
                variant="outline"
                disabled={!attemptId || loadDiff.isPending}
                onClick={() => loadDiff.mutate()}
              >
                <ClipboardTextIcon aria-hidden />
                {loadDiff.isPending ? "Обновляю diff…" : "Обновить Git diff"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!attemptId || runTests.isPending}
                onClick={() => runTests.mutate()}
              >
                <PlayIcon aria-hidden />
                {runTests.isPending ? "Тестирую…" : "Запустить тесты"}
              </Button>
              <Button
                size="sm"
                disabled={!reviewAllowed || runReview.isPending}
                onClick={() => runReview.mutate(undefined)}
              >
                <FlaskIcon aria-hidden />
                {runReview.isPending
                  ? "Проверка читает…"
                  : "Запросить проверку"}
              </Button>
            </div>
            <div className="grid min-h-72 gap-px bg-border lg:grid-cols-2">
              <div className="min-w-0 bg-background p-4">
                <p className="mb-3 text-xs font-medium text-muted-foreground">
                  Diff от baseline
                </p>
                <pre
                  data-testid="exercise-diff"
                  className="max-h-96 overflow-auto whitespace-pre-wrap font-mono text-xs leading-5"
                >
                  {diff?.patch ||
                    "Diff появится после первой самостоятельной правки."}
                </pre>
                {diff?.truncated ? (
                  <p className="mt-3 text-xs text-warning-foreground">
                    Diff обрезан серверным лимитом.
                  </p>
                ) : null}
              </div>
              <div className="min-w-0 bg-background p-4">
                <p className="mb-3 text-xs font-medium text-muted-foreground">
                  Последний test run
                </p>
                <pre className="max-h-96 overflow-auto whitespace-pre-wrap font-mono text-xs leading-5">
                  {latestTest
                    ? `${latestTest.output}\n\nexit code: ${latestTest.exitCode}`
                    : "Тесты ещё не запускались."}
                </pre>
                {latestTest ? (
                  <Badge
                    className="mt-3"
                    variant={
                      latestTest.status === "passed" &&
                      latestTest.workspaceCurrent
                        ? "success"
                        : "warning"
                    }
                  >
                    {latestTest.status === "passed" &&
                    latestTest.workspaceCurrent
                      ? "Тесты прошли на текущем diff"
                      : latestTest.status === "failed"
                        ? "Тесты не прошли"
                        : "Код изменён после теста"}
                  </Badge>
                ) : null}
              </div>
            </div>
          </div>
        </section>

        <aside className="flex flex-col gap-4" aria-label="Проверка и темы">
          <div
            data-slot="exercise-topics"
            className="rounded-xl border border-border bg-card p-6"
          >
            <h2 className="font-semibold">Тренируемые темы</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {exercise.topics.map((topic) => (
                <Badge key={topic} variant="secondary">
                  {topic}
                </Badge>
              ))}
            </div>
          </div>
          <div
            data-slot="exercise-review"
            className="rounded-xl border border-border bg-card p-6"
          >
            <div className="flex items-center justify-between gap-4">
              <h2 className="font-semibold">Reviewer</h2>
              <Badge
                variant={
                  review?.status === "passed"
                    ? "success"
                    : review
                      ? "warning"
                      : "secondary"
                }
              >
                {review?.status === "passed"
                  ? "Принято"
                  : review
                    ? "Нужны изменения"
                    : "Не запускался"}
              </Badge>
            </div>
            {review ? (
              <div className="mt-4 flex flex-col gap-4">
                <p className="text-sm leading-6">{review.summary}</p>
                {review.evidenceBundle ? (
                  <div className="rounded-lg border border-border bg-muted/40 p-3">
                    <p className="text-xs font-medium">Капсула доказательств</p>
                    <p className="mt-1 break-all font-mono text-[11px] leading-5 text-muted-foreground">
                      {review.evidenceBundle.sha256}
                    </p>
                    <p className="mt-1 break-all font-mono text-[11px] leading-5 text-muted-foreground">
                      snapshot {review.evidenceBundle.workspaceSnapshotHash}
                    </p>
                  </div>
                ) : null}
                {review.strengths.length ? (
                  <ul className="flex flex-col gap-2 text-sm text-muted-foreground">
                    {review.strengths.map((strength) => (
                      <li key={strength}>✓ {strength}</li>
                    ))}
                  </ul>
                ) : null}
                <ul className="flex flex-col gap-3">
                  {review.findings.map((finding, index) => (
                    <li
                      key={`${finding.category}-${index}`}
                      className="rounded-lg bg-muted p-3 text-sm"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">{finding.category}</span>
                        <span className="font-mono text-xs text-muted-foreground">
                          hint {finding.hintLevel}
                        </span>
                      </div>
                      <p className="mt-2 leading-5 text-muted-foreground">
                        {finding.message}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                Review становится доступен после изменённого diff и успешного
                теста на текущих файлах. Он остаётся read-only.
              </p>
            )}
          </div>
          {review?.status === "passed" ? (
            <Button
              onClick={() => acceptReview.mutate()}
              disabled={acceptReview.isPending}
            >
              {acceptReview.isPending
                ? "Сохраняю подтверждения навыка…"
                : "Принять проверку и продолжить"}
            </Button>
          ) : null}
          {review?.status === "changes_requested" ? (
            <p
              role="status"
              className="rounded-lg bg-muted p-4 text-sm leading-6 text-muted-foreground"
            >
              Исправьте код в Zed, снова запустите тесты и запросите новое
              review. Текущее review не завершает юнит.
            </p>
          ) : null}
        </aside>
      </div>
      <AlertDialog open={pendingReviewDisclosure !== null}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Отправить evidence внешнему AI?</AlertDialogTitle>
            <AlertDialogDescription>
              Reviewer получит только зафиксированный bundle. Разрешение
              действует один раз.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {pendingReviewDisclosure ? (
            <dl className="grid gap-3 rounded-lg border border-border bg-muted/20 p-4 text-sm">
              <div>
                <dt className="font-medium">Получатель</dt>
                <dd className="text-muted-foreground">
                  {pendingReviewDisclosure.disclosure.scope.destination}
                </dd>
              </div>
              <div>
                <dt className="font-medium">Данные</dt>
                <dd className="text-muted-foreground">
                  {pendingReviewDisclosure.disclosure.scope.payloadCategories.join(
                    ", ",
                  )}{" "}
                  · {pendingReviewDisclosure.disclosure.scope.byteCount} bytes
                </dd>
              </div>
              <div>
                <dt className="font-medium">Не отправляется</dt>
                <dd className="text-muted-foreground">
                  {pendingReviewDisclosure.disclosure.scope.exclusions.join(
                    ", ",
                  )}
                </dd>
              </div>
            </dl>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={runReview.isPending}
              onClick={() => void cancelReviewDisclosure()}
            >
              Не отправлять
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={runReview.isPending}
              onClick={() => void approveReviewDisclosure()}
            >
              Разрешить один раз
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
