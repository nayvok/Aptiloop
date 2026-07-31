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
} from "@phosphor-icons/react";

import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { QueryError } from "@/components/query-state";
import { Skeleton } from "@/components/ui/skeleton";

type Exercise = {
  id: string;
  title: string;
  prompt: string;
  difficulty: string;
  estimatedMinutes: number;
  criteria: string[];
  constraints: string[];
  topics: string[];
  workspacePath: string;
  attempt?: { id: string; changed: boolean; testsRun: boolean };
};

type Review = {
  status: "passed" | "changes_requested";
  summary: string;
  findings: Array<{
    severity: string;
    category: string;
    file?: string;
    line?: number;
    message: string;
    hintLevel: number;
  }>;
  strengths: string[];
};

export function ExerciseClient() {
  const params = useSearchParams();
  const sessionId = params.get("sessionId");
  const router = useRouter();
  const queryClient = useQueryClient();
  const [diff, setDiff] = useState("");
  const [testOutput, setTestOutput] = useState("");
  const [review, setReview] = useState<Review | null>(null);
  const query = useQuery({
    queryKey: ["exercise", sessionId],
    queryFn: () =>
      api<Exercise>(
        `/exercises/current${sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : ""}`,
      ),
  });
  const attempt = useMutation({
    mutationFn: () =>
      api<{ id: string }>(`/exercises/${query.data?.id}/attempts`, {
        method: "POST",
        body: JSON.stringify({ sessionId }),
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["exercise", sessionId] }),
  });
  const getAttemptId = () => query.data?.attempt?.id;
  const loadDiff = useMutation({
    mutationFn: () =>
      api<{ diff: string; changed: boolean }>(
        `/exercise-attempts/${getAttemptId()}/diff`,
      ),
    onSuccess: (data) =>
      setDiff(data.diff || "Изменений относительно baseline пока нет."),
  });
  const runTests = useMutation({
    mutationFn: () =>
      api<{ output: string; exitCode: number }>(
        `/exercise-attempts/${getAttemptId()}/commands`,
        { method: "POST", body: JSON.stringify({ commandId: "test" }) },
      ),
    onSuccess: (data) =>
      setTestOutput(`${data.output}\n\nexit code: ${data.exitCode}`),
  });
  const runReview = useMutation({
    mutationFn: () =>
      api<Review>(`/exercise-attempts/${getAttemptId()}/reviews`, {
        method: "POST",
        body: JSON.stringify({ provider: "mock" }),
      }),
    onSuccess: setReview,
  });
  const openZed = useMutation({
    mutationFn: () =>
      api<{ opened: boolean; path: string; message?: string }>(
        `/exercise-attempts/${getAttemptId()}/open`,
        { method: "POST" },
      ),
    onSuccess: async (data) => {
      if (!data.opened) await navigator.clipboard.writeText(data.path);
    },
  });
  const complete = useMutation({
    mutationFn: () =>
      api<{ completed: true }>(`/learning/sessions/${sessionId}/complete`, {
        method: "POST",
      }),
    onSuccess: () => router.push("/knowledge?completed=1"),
  });

  if (query.isLoading)
    return (
      <div className="flex flex-col gap-5">
        <Skeleton className="h-20" />
        <Skeleton className="h-96" />
      </div>
    );
  if (query.isError || !query.data)
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
  const exercise = query.data;
  const attemptId = exercise.attempt?.id;

  return (
    <div className="flex flex-col gap-6">
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

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="flex flex-col gap-6">
          <div className="grid gap-6 rounded-xl border border-border bg-card p-5 md:grid-cols-2">
            <div className="flex flex-col gap-3">
              <h3 className="font-semibold">Готово, когда</h3>
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
            <div className="flex flex-col gap-3">
              <h3 className="font-semibold">Ограничения</h3>
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

          <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-semibold">Рабочая папка</h3>
                <p className="mt-1 font-mono text-xs text-muted-foreground break-all">
                  {exercise.workspacePath}
                </p>
              </div>
              {attemptId ? (
                <Button
                  variant="outline"
                  onClick={() => openZed.mutate()}
                  disabled={openZed.isPending}
                >
                  <ArrowSquareOutIcon aria-hidden />
                  Открыть в Zed
                </Button>
              ) : (
                <Button
                  onClick={() => attempt.mutate()}
                  disabled={attempt.isPending}
                >
                  <CodeIcon aria-hidden />
                  Создать попытку
                </Button>
              )}
            </div>
            {openZed.data && !openZed.data.opened ? (
              <p role="status" className="text-xs text-warning-foreground">
                Zed недоступен. Путь скопирован в буфер.
              </p>
            ) : null}
          </div>

          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
              <Button
                size="sm"
                variant="outline"
                disabled={!attemptId || loadDiff.isPending}
                onClick={() => loadDiff.mutate()}
              >
                <ClipboardTextIcon aria-hidden />
                Показать Git diff
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
                disabled={!attemptId || !diff || runReview.isPending}
                onClick={() => runReview.mutate()}
              >
                <FlaskIcon aria-hidden />
                {runReview.isPending ? "Reviewer читает…" : "Запросить review"}
              </Button>
            </div>
            <div className="grid min-h-72 gap-px bg-border lg:grid-cols-2">
              <div className="min-w-0 bg-background p-4">
                <p className="mb-3 text-xs font-medium text-muted-foreground">
                  DIFF ОТ BASELINE
                </p>
                <pre
                  data-testid="exercise-diff"
                  className="max-h-96 overflow-auto whitespace-pre-wrap font-mono text-xs leading-5"
                >
                  {diff || "Diff появится после первой самостоятельной правки."}
                </pre>
              </div>
              <div className="min-w-0 bg-background p-4">
                <p className="mb-3 text-xs font-medium text-muted-foreground">
                  ПОСЛЕДНИЙ TEST RUN
                </p>
                <pre className="max-h-96 overflow-auto whitespace-pre-wrap font-mono text-xs leading-5">
                  {testOutput || "Тесты ещё не запускались."}
                </pre>
              </div>
            </div>
          </div>
        </section>

        <aside className="flex flex-col gap-4">
          <div className="rounded-xl border border-border bg-card p-5">
            <h3 className="font-semibold">Тренируемые темы</h3>
            <div className="mt-3 flex flex-wrap gap-2">
              {exercise.topics.map((topic) => (
                <Badge key={topic} variant="secondary">
                  {topic}
                </Badge>
              ))}
            </div>
          </div>
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-semibold">Reviewer</h3>
              {review ? (
                <Badge
                  variant={review.status === "passed" ? "success" : "warning"}
                >
                  {review.status}
                </Badge>
              ) : (
                <Badge>Не запускался</Badge>
              )}
            </div>
            {review ? (
              <div className="mt-4 flex flex-col gap-4">
                <p className="text-sm leading-6">{review.summary}</p>
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
                Review доступен только после diff. Он укажет область проблемы и
                не применит patch.
              </p>
            )}
          </div>
          {review ? (
            <Button
              onClick={() => complete.mutate()}
              disabled={complete.isPending}
            >
              {complete.isPending ? "Завершаю…" : "Завершить учебный день"}
            </Button>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
