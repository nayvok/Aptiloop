"use client";

import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowRightIcon,
  CheckIcon,
  PaperPlaneTiltIcon,
  StopIcon,
} from "@phosphor-icons/react";

import { api, streamAgent } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/page-header";
import { QueryError, EmptyState } from "@/components/query-state";
import { Skeleton } from "@/components/ui/skeleton";

type Session = {
  id: string;
  dayNumber: number;
  title: string;
  status: "active" | "completed";
  currentStep: string;
  steps: Array<{
    id: string;
    label: string;
    status: "done" | "active" | "locked";
  }>;
  question: { id: string; prompt: string; kind: string };
  savedAnswer?: string;
};

export function SessionClient() {
  const params = useSearchParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const sessionId = params.get("id");
  const [answer, setAnswer] = useState("");
  const [teacher, setTeacher] = useState("");
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const query = useQuery({
    queryKey: ["session", sessionId],
    queryFn: () => api<Session>(`/learning/sessions/${sessionId}`),
    enabled: Boolean(sessionId),
  });
  const effectiveAnswer = answer || query.data?.savedAnswer || "";
  const save = useMutation({
    mutationFn: () =>
      api<{ saved: true }>(`/learning/sessions/${sessionId}/answers`, {
        method: "POST",
        body: JSON.stringify({
          questionId: query.data?.question.id,
          answer: effectiveAnswer,
        }),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["session", sessionId] });
      const controller = new AbortController();
      abortRef.current = controller;
      setTeacher("");
      setStreaming(true);
      try {
        for await (const event of streamAgent(
          { role: "teacher", sessionId, message: effectiveAnswer },
          controller.signal,
        )) {
          if (event.type === "message.delta")
            setTeacher((current) => current + (event.content ?? ""));
          if (event.type === "error")
            setTeacher(
              (current) => current + `\n${event.message ?? "Ошибка Teacher"}`,
            );
        }
      } finally {
        setStreaming(false);
      }
    },
  });

  const stepIndex = useMemo(
    () => query.data?.steps.findIndex((step) => step.status === "active") ?? 0,
    [query.data],
  );

  if (!sessionId)
    return (
      <EmptyState
        title="Занятие ещё не начато"
        description="Вернись на обзор и начни сегодняшний учебный цикл."
        action={<Button onClick={() => router.push("/")}>Открыть обзор</Button>}
      />
    );
  if (query.isLoading)
    return (
      <div className="flex flex-col gap-5">
        <Skeleton className="h-20" />
        <Skeleton className="h-14" />
        <Skeleton className="h-80" />
      </div>
    );
  if (query.isError || !query.data)
    return (
      <QueryError
        message={
          query.error instanceof Error
            ? query.error.message
            : "Занятие не найдено"
        }
        retry={() => void query.refetch()}
      />
    );
  const session = query.data;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`День ${session.dayNumber}: ${session.title}`}
        description="Пиши объяснение по памяти. Teacher увидит ответ только после сохранения первой попытки."
        actions={
          <Badge variant="outline">
            Этап {stepIndex + 1} из {session.steps.length}
          </Badge>
        }
      />
      <ol
        aria-label="Этапы занятия"
        className="flex gap-1 overflow-x-auto rounded-lg bg-muted p-1"
      >
        {session.steps.map((step, index) => (
          <li
            key={step.id}
            className={`flex min-w-max flex-1 items-center gap-2 rounded-md px-3 py-2 text-xs ${step.status === "active" ? "bg-background font-medium shadow-sm" : "text-muted-foreground"}`}
          >
            <span
              className={`grid size-5 place-items-center rounded-full border ${step.status === "done" ? "border-success bg-success text-white" : "border-border"}`}
            >
              {step.status === "done" ? <CheckIcon aria-hidden /> : index + 1}
            </span>
            {step.label}
          </li>
        ))}
      </ol>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
        <section className="flex flex-col gap-5 rounded-xl border border-border bg-card p-5 md:p-6">
          <div className="flex items-center justify-between gap-3">
            <Badge>{session.question.kind}</Badge>
            <span className="text-xs text-muted-foreground">
              Ответ без источников
            </span>
          </div>
          <h3 className="text-balance text-xl font-semibold leading-8">
            {session.question.prompt}
          </h3>
          <label
            className="flex flex-col gap-2 text-sm font-medium"
            htmlFor="answer"
          >
            Твоё объяснение
            <textarea
              id="answer"
              value={effectiveAnswer}
              disabled={Boolean(session.savedAnswer)}
              onChange={(event) => setAnswer(event.target.value)}
              rows={9}
              placeholder="Сформулируй причинно-следственную связь и приведи пример…"
              className="min-h-48 resize-y rounded-lg border border-input bg-background p-3 text-sm font-normal leading-6 outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-70"
            />
          </label>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              Минимум 40 символов. Эталон пока скрыт.
            </p>
            <Button
              disabled={
                effectiveAnswer.trim().length < 40 ||
                save.isPending ||
                Boolean(session.savedAnswer)
              }
              onClick={() => save.mutate()}
            >
              <PaperPlaneTiltIcon aria-hidden />
              {save.isPending
                ? "Сохраняю…"
                : session.savedAnswer
                  ? "Первая попытка сохранена"
                  : "Сохранить ответ"}
            </Button>
          </div>
        </section>

        <aside className="flex min-h-80 flex-col rounded-xl border border-border bg-background">
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <div>
              <p className="text-sm font-medium">Teacher</p>
              <p className="text-xs text-muted-foreground">
                Mock · socratic-v1
              </p>
            </div>
            {streaming ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => abortRef.current?.abort()}
              >
                <StopIcon aria-hidden />
                Стоп
              </Button>
            ) : (
              <Badge variant={teacher ? "success" : "secondary"}>
                {teacher ? "Ответил" : "Ждёт попытку"}
              </Badge>
            )}
          </div>
          <div
            aria-live="polite"
            className="flex flex-1 flex-col justify-end gap-3 p-4"
          >
            {teacher ? (
              <div className="rounded-lg bg-muted p-3 text-sm leading-6">
                {teacher}
                <span
                  className={
                    streaming
                      ? "ml-1 inline-block h-4 w-1 animate-pulse bg-primary"
                      : "hidden"
                  }
                />
              </div>
            ) : (
              <p className="m-auto max-w-xs text-center text-sm leading-6 text-muted-foreground">
                После сохранения Teacher задаст один уточняющий вопрос, не
                раскрывая готовый ответ.
              </p>
            )}
          </div>
        </aside>
      </div>

      {session.savedAnswer && teacher && !streaming ? (
        <div className="flex justify-end">
          <Button
            onClick={() => router.push(`/exercise?sessionId=${session.id}`)}
          >
            Перейти к практике
            <ArrowRightIcon aria-hidden />
          </Button>
        </div>
      ) : null}
    </div>
  );
}
