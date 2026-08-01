"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowSquareOutIcon,
  CheckCircleIcon,
  ClipboardTextIcon,
  CodeIcon,
  FlaskIcon,
  PlayIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { z } from "zod";

import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { QueryError } from "@/components/query-state";
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
    status: z.enum(["running", "passed", "failed"]),
    exitCode: z.number().int(),
    output: z.string(),
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
const reviewSchema = z
  .object({
    id: idSchema,
    status: z.enum(["passed", "changes_requested"]),
    summary: z.string().min(1),
    findings: z.array(findingSchema),
    strengths: z.array(z.string().min(1)),
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
    workspacePath: z.string().min(1).nullable(),
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
const commandResponseSchema = testRunSchema.omit({ workspaceCurrent: true });
const reviewResponseSchema = reviewSchema.extend({
  suggestedMasteryChanges: z.array(z.unknown()),
});
const attemptResponseSchema = z.object({ id: idSchema }).strict();
const openResponseSchema = z
  .object({
    opened: z.boolean(),
    path: z.string().min(1),
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
        `/exercise-attempts/${encodeURIComponent(attemptId)}/commands`,
        {
          method: "POST",
          body: JSON.stringify({
            operationId: crypto.randomUUID(),
            commandId: "test",
          }),
        },
      );
      const test = parseSafe(commandResponseSchema, testValue);
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
    mutationFn: async () => {
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
      const value = await api<unknown>(
        `/exercise-attempts/${encodeURIComponent(attemptId)}/reviews`,
        { method: "POST", body: "{}" },
      );
      const parsed = parseSafe(reviewResponseSchema, value);
      return reviewSchema.parse({
        id: parsed.id,
        status: parsed.status,
        summary: parsed.summary,
        findings: parsed.findings,
        strengths: parsed.strengths,
      });
    },
    onSuccess: async (result) => {
      setLocalReview(result);
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
    onSuccess: async (data) => {
      if (data.opened) {
        setZedFallback(null);
        return;
      }
      try {
        await navigator.clipboard.writeText(data.path);
        setZedFallback("Zed недоступен. Путь скопирован в буфер обмена.");
      } catch {
        setZedFallback(`Zed недоступен. Откройте папку вручную: ${data.path}`);
      }
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
        throw new Error("Серверные evidence для завершения ещё не готовы");
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
  const error =
    attempt.error ??
    loadDiff.error ??
    runTests.error ??
    runReview.error ??
    openZed.error ??
    acceptReview.error;

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
                <h2 className="font-semibold">Изолированная рабочая папка</h2>
                <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
                  {exercise.workspacePath ??
                    "Будет создана сервером после начала попытки."}
                </p>
              </div>
              {attemptId ? (
                <Button
                  variant="outline"
                  onClick={() => openZed.mutate()}
                  disabled={openZed.isPending}
                >
                  <ArrowSquareOutIcon aria-hidden />
                  {openZed.isPending ? "Открываю…" : "Открыть в Zed"}
                </Button>
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
          </div>

          <div
            data-slot="exercise-evidence"
            className="overflow-hidden rounded-xl border border-border bg-card"
          >
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
                onClick={() => runReview.mutate()}
              >
                <FlaskIcon aria-hidden />
                {runReview.isPending ? "Reviewer читает…" : "Запросить review"}
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

        <aside className="flex flex-col gap-4" aria-label="Review и темы">
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
                ? "Сохраняю evidence…"
                : "Принять review и продолжить"}
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
    </div>
  );
}
