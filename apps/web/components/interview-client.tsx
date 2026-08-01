"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowClockwiseIcon,
  CheckCircleIcon,
  ChatCircleDotsIcon,
} from "@phosphor-icons/react";
import { z } from "zod";

import { api, ApiError } from "@/lib/api";
import { PageHeader } from "@/components/page-header";
import { InterviewChatView } from "@/components/interview-chat-view";
import { QueryError } from "@/components/query-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";

const protectedFields = new Set([
  "referenceAnswer",
  "evaluationPoints",
  "correctOptionIds",
  "commonMistakes",
  "misconceptions",
  "protectedEvaluation",
  "providerId",
  "modelId",
]);

const idSchema = z.string().trim().min(1);
const difficultySchema = z.enum(["foundation", "interview-ready", "deep-dive"]);
const setupSchema = z
  .object({
    topics: z.array(z.string().trim().min(1).max(120)).min(1).max(12),
    difficulty: difficultySchema,
    questionCount: z.number().int().min(1).max(12),
  })
  .strict();
const startDraftSchema = setupSchema.extend({
  operationId: z.string().trim().min(8).max(200),
});
const transcriptMessageSchema = z
  .object({
    id: idSchema,
    role: z.enum(["user", "assistant"]),
    content: z.string().trim().min(1).max(20_000),
    createdAt: z.string().trim().min(1),
  })
  .strict();
const evidenceSchema = z
  .object({
    questionNumber: z.number().int().positive(),
    topic: z.string().trim().min(1).max(120),
    answerExcerpt: z.string().max(240),
    observation: z.string().trim().min(1),
  })
  .strict();
const reportSchema = z
  .object({
    interviewId: idSchema,
    status: z.literal("completed"),
    summary: z.string().trim().min(1),
    topics: z.array(z.string().trim().min(1).max(120)),
    metrics: z
      .object({
        questionsAsked: z.number().int().nonnegative(),
        questionsAnswered: z.number().int().nonnegative(),
        completionRate: z.number().min(0).max(1),
      })
      .strict(),
    strengths: z.array(z.string().trim().min(1)),
    growthAreas: z.array(z.string().trim().min(1)),
    evidence: z.array(evidenceSchema),
  })
  .strict();
const interviewSchema = z
  .object({
    id: idSchema,
    status: z.enum(["setup", "in_progress", "completed"]),
    setup: setupSchema,
    transcript: z.array(transcriptMessageSchema),
    progress: z
      .object({
        questionsAsked: z.number().int().nonnegative(),
        questionsAnswered: z.number().int().nonnegative(),
        readyToFinish: z.boolean(),
      })
      .strict(),
    report: reportSchema.nullable(),
    startedAt: z.string().trim().min(1),
    completedAt: z.string().trim().min(1).nullable(),
  })
  .strict();
const currentResponseSchema = z
  .object({ interview: interviewSchema.nullable() })
  .strict();
const finishResponseSchema = z
  .object({ interview: interviewSchema, report: reportSchema })
  .strict();

export type Interview = z.infer<typeof interviewSchema>;
type Difficulty = z.infer<typeof difficultySchema>;

const pendingAnswerSchema = z
  .object({
    interviewId: idSchema,
    operationId: z.string().trim().min(8).max(200),
    answer: z.string().trim().min(1).max(20_000),
  })
  .strict();
type StartDraft = z.infer<typeof startDraftSchema>;

const startDraftKey = "dlh-interview-v2-start";
const pendingAnswerKey = "dlh-interview-v2-pending-answer";
const latestInterviewKey = "dlh-interview-v2-latest-id";

function rejectProtectedFields(
  value: unknown,
  path = "$",
  seen = new WeakSet<object>(),
): void {
  if (typeof value !== "object" || value === null) return;
  if (seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      rejectProtectedFields(item, `${path}[${index}]`, seen),
    );
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (protectedFields.has(key)) {
      throw new Error(`Protected interview field received at ${path}.${key}`);
    }
    rejectProtectedFields(child, `${path}.${key}`, seen);
  }
}

function parsePayload<T>(schema: z.ZodType<T>, value: unknown): T {
  rejectProtectedFields(value);
  return schema.parse(value);
}

function readStorage<T>(key: string, schema: z.ZodType<T>): T | null {
  if (typeof window === "undefined") return null;
  const value = window.localStorage.getItem(key);
  if (!value) return null;
  try {
    const parsed = schema.safeParse(JSON.parse(value));
    if (parsed.success) return parsed.data;
    window.localStorage.removeItem(key);
    return null;
  } catch {
    window.localStorage.removeItem(key);
    return null;
  }
}

function writeStorage(key: string, value: unknown): void {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(key, JSON.stringify(value));
  }
}

function removeStorage(key: string): void {
  if (typeof window !== "undefined") window.localStorage.removeItem(key);
}

function operationId(): string {
  return globalThis.crypto.randomUUID();
}

async function readCurrentInterview(): Promise<Interview | null> {
  const current = parsePayload(
    currentResponseSchema,
    await api<unknown>("/interviews/v2/current"),
  ).interview;
  if (current) return current;

  const latestId = readStorage(latestInterviewKey, idSchema);
  if (!latestId) return null;
  try {
    const latest = parsePayload(
      interviewSchema,
      await api<unknown>(`/interviews/v2/${encodeURIComponent(latestId)}`),
    );
    return latest.status === "completed" ? latest : null;
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 404) throw error;
    removeStorage(latestInterviewKey);
    return null;
  }
}

const fieldClassName =
  "min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60";

export function InterviewClient() {
  const queryClient = useQueryClient();
  const interviewQuery = useQuery({
    queryKey: ["interview-v2-current"],
    queryFn: readCurrentInterview,
    retry: false,
  });
  const [topicsInput, setTopicsInput] = useState("JavaScript, TypeScript");
  const [difficulty, setDifficulty] = useState<Difficulty>("interview-ready");
  const [questionCount, setQuestionCount] = useState(3);
  const [answer, setAnswer] = useState("");
  const [action, setAction] = useState<"start" | "answer" | "finish" | null>(
    null,
  );
  const [actionError, setActionError] = useState<string | null>(null);

  const interview = interviewQuery.data ?? null;
  const persistedAnswer = useMemo(
    () => readStorage(pendingAnswerKey, pendingAnswerSchema),
    [interview?.id],
  );

  useEffect(() => {
    if (!interview) return;
    if (interview.status === "setup") {
      setTopicsInput(interview.setup.topics.join(", "));
      setDifficulty(interview.setup.difficulty);
      setQuestionCount(interview.setup.questionCount);
    }
    if (
      persistedAnswer?.interviewId === interview.id &&
      interview.progress.questionsAsked === interview.progress.questionsAnswered
    ) {
      setAnswer(persistedAnswer.answer);
    }
  }, [interview, persistedAnswer]);

  async function startInterview(retryDraft?: StartDraft) {
    const topics = retryDraft?.topics ?? [
      ...new Set(
        topicsInput
          .split(",")
          .map((topic) => topic.trim())
          .filter(Boolean),
      ),
    ];
    const draft = retryDraft ?? {
      operationId: operationId(),
      topics,
      difficulty,
      questionCount,
    };
    const validation = startDraftSchema.safeParse(draft);
    if (!validation.success) {
      setActionError(
        topics.length === 0
          ? "Укажите хотя бы одну тему через запятую."
          : "Проверьте темы, сложность и количество вопросов.",
      );
      return;
    }
    writeStorage(startDraftKey, draft);
    setAction("start");
    setActionError(null);
    try {
      const next = parsePayload(
        interviewSchema,
        await api<unknown>("/interviews/v2", {
          method: "POST",
          body: JSON.stringify(draft),
        }),
      );
      writeStorage(latestInterviewKey, next.id);
      if (next.status !== "setup") removeStorage(startDraftKey);
      queryClient.setQueryData(["interview-v2-current"], next);
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Не удалось начать интервью.",
      );
      await interviewQuery.refetch();
    } finally {
      setAction(null);
    }
  }

  async function submitAnswer() {
    if (!interview || !answer.trim()) return;
    const stored = readStorage(pendingAnswerKey, pendingAnswerSchema);
    const pending =
      stored?.interviewId === interview.id && stored.answer === answer.trim()
        ? stored
        : {
            interviewId: interview.id,
            operationId: operationId(),
            answer: answer.trim(),
          };
    writeStorage(pendingAnswerKey, pending);
    setAction("answer");
    setActionError(null);
    try {
      const next = parsePayload(
        interviewSchema,
        await api<unknown>(
          `/interviews/v2/${encodeURIComponent(interview.id)}/answers`,
          {
            method: "POST",
            body: JSON.stringify({
              operationId: pending.operationId,
              answer: pending.answer,
            }),
          },
        ),
      );
      removeStorage(pendingAnswerKey);
      setAnswer("");
      queryClient.setQueryData(["interview-v2-current"], next);
    } catch (error) {
      setActionError(
        error instanceof Error
          ? `${error.message} Ответ сохранён в форме — можно повторить запрос.`
          : "Следующий вопрос не получен. Ответ сохранён в форме.",
      );
    } finally {
      setAction(null);
    }
  }

  async function finishInterview() {
    if (!interview?.progress.readyToFinish) return;
    setAction("finish");
    setActionError(null);
    try {
      const response = parsePayload(
        finishResponseSchema,
        await api<unknown>(
          `/interviews/v2/${encodeURIComponent(interview.id)}/finish`,
          {
            method: "POST",
            body: JSON.stringify({ operationId: operationId() }),
          },
        ),
      );
      writeStorage(latestInterviewKey, response.interview.id);
      queryClient.setQueryData(["interview-v2-current"], response.interview);
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "Не удалось завершить интервью.",
      );
    } finally {
      setAction(null);
    }
  }

  function startNewInterview() {
    removeStorage(latestInterviewKey);
    removeStorage(startDraftKey);
    removeStorage(pendingAnswerKey);
    setAnswer("");
    setActionError(null);
    queryClient.setQueryData(["interview-v2-current"], null);
  }

  if (interviewQuery.isLoading) {
    return (
      <div
        data-slot="interview-loading"
        className="flex flex-col gap-6"
        role="status"
        aria-label="Загружаю интервью…"
      >
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }

  if (interviewQuery.error) {
    return (
      <QueryError
        message={
          interviewQuery.error instanceof Error
            ? interviewQuery.error.message
            : "Неизвестная ошибка"
        }
        retry={() => void interviewQuery.refetch()}
      />
    );
  }

  if (!interview) {
    return (
      <div data-slot="interview-setup" className="flex flex-col gap-6">
        <PageHeader
          title="Техническое интервью"
          description="Настрой темы и формат. Интервьюер задаёт по одному вопросу; отчёт фиксирует evidence, но не выдумывает техническую оценку."
          actions={<Badge variant="outline">Отдельный workflow</Badge>}
        />
        <section
          className="rounded-lg border border-border bg-card p-4 sm:p-6"
          aria-labelledby="interview-setup-title"
        >
          <div className="flex max-w-2xl flex-col gap-6">
            <div>
              <h3 id="interview-setup-title" className="text-lg font-semibold">
                Настройка интервью
              </h3>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                Provider и модель берутся из серверных настроек. Здесь задаётся
                только учебная рамка.
              </p>
            </div>
            <label className="grid gap-2 text-sm font-medium">
              Темы через запятую
              <input
                className={fieldClassName}
                value={topicsInput}
                onChange={(event) => setTopicsInput(event.target.value)}
                placeholder="JavaScript, TypeScript"
                maxLength={1450}
                disabled={action !== null}
              />
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-2 text-sm font-medium">
                Сложность
                <select
                  className={fieldClassName}
                  value={difficulty}
                  onChange={(event) =>
                    setDifficulty(difficultySchema.parse(event.target.value))
                  }
                  disabled={action !== null}
                >
                  <option value="foundation">Фундамент</option>
                  <option value="interview-ready">Готовность к интервью</option>
                  <option value="deep-dive">Глубокий разбор</option>
                </select>
              </label>
              <label className="grid gap-2 text-sm font-medium">
                Количество вопросов
                <select
                  className={fieldClassName}
                  value={questionCount}
                  onChange={(event) =>
                    setQuestionCount(Number(event.target.value))
                  }
                  disabled={action !== null}
                >
                  {[1, 2, 3, 4, 5, 6, 8, 10, 12].map((count) => (
                    <option key={count} value={count}>
                      {count}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {actionError ? (
              <p role="alert" className="text-sm text-destructive">
                {actionError}
              </p>
            ) : null}
            <Button
              onClick={() => void startInterview()}
              disabled={action !== null}
            >
              {action === "start" ? (
                <>
                  <Spinner />
                  Формирую первый вопрос…
                </>
              ) : (
                <>
                  <ChatCircleDotsIcon aria-hidden className="size-4" />
                  Начать интервью
                </>
              )}
            </Button>
          </div>
        </section>
      </div>
    );
  }

  if (interview.status === "completed" && interview.report) {
    return (
      <InterviewReportView interview={interview} onNew={startNewInterview} />
    );
  }

  if (interview.status === "setup") {
    const draft = readStorage(startDraftKey, startDraftSchema);
    return (
      <div data-slot="interview-opening-retry" className="flex flex-col gap-6">
        <PageHeader
          title="Техническое интервью"
          description="Настройка сохранена, но первый вопрос ещё не получен."
          actions={<Badge variant="warning">Ожидает запуска</Badge>}
        />
        <section className="rounded-lg border border-border bg-card p-6">
          <h3 className="font-semibold">Не удалось получить первый вопрос</h3>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Темы: {interview.setup.topics.join(", ")}. Повтор использует тот же
            operation ID и не создаёт дубликат.
          </p>
          {actionError ? (
            <p role="alert" className="mt-3 text-sm text-destructive">
              {actionError}
            </p>
          ) : null}
          <Button
            className="mt-4"
            onClick={() => draft && void startInterview(draft)}
            disabled={!draft || action !== null}
          >
            {action === "start" ? (
              <>
                <Spinner />
                Повторяю…
              </>
            ) : (
              <>
                <ArrowClockwiseIcon aria-hidden className="size-4" />
                Повторить запуск
              </>
            )}
          </Button>
        </section>
      </div>
    );
  }

  return (
    <div data-slot="interview-session" className="flex flex-col gap-6">
      <PageHeader
        title="Техническое интервью"
        description="Отвечай на текущий вопрос. Transcript и прогресс сохраняются сервером после каждого шага."
        actions={
          <Badge variant="outline">
            {interview.progress.questionsAnswered} /{" "}
            {interview.setup.questionCount}
          </Badge>
        }
      />
      <InterviewChatView
        interview={interview}
        action={action}
        actionError={actionError}
        answer={answer}
        onAnswerChange={setAnswer}
        onSend={() => void submitAnswer()}
        onRetry={() => void submitAnswer()}
        onFinish={() => void finishInterview()}
      />
    </div>
  );
}

function InterviewReportView({
  interview,
  onNew,
}: {
  interview: Interview;
  onNew(): void;
}) {
  const report = interview.report;
  if (!report) return null;
  const completionPercent = Math.round(report.metrics.completionRate * 100);
  return (
    <div data-slot="interview-report" className="flex flex-col gap-6">
      <PageHeader
        title="Отчёт по интервью"
        description={report.summary}
        actions={
          <Badge variant="success">
            <CheckCircleIcon aria-hidden className="size-3.5" />
            Завершено
          </Badge>
        }
      />
      <section
        className="grid gap-4 sm:grid-cols-3"
        aria-label="Метрики интервью"
      >
        <Metric label="Задано" value={String(report.metrics.questionsAsked)} />
        <Metric
          label="Отвечено"
          value={String(report.metrics.questionsAnswered)}
        />
        <Metric label="Полнота" value={`${completionPercent}%`} />
      </section>
      <div className="grid gap-6 lg:grid-cols-2">
        <ReportList title="Сильные стороны" items={report.strengths} />
        <ReportList title="Зоны роста" items={report.growthAreas} />
      </div>
      <section
        className="rounded-lg border border-border bg-card p-4 sm:p-6"
        aria-labelledby="evidence-title"
      >
        <h3 id="evidence-title" className="font-semibold">
          Evidence
        </h3>
        <ol className="mt-4 divide-y divide-border">
          {report.evidence.map((item) => (
            <li
              key={`${item.questionNumber}-${item.topic}`}
              className="py-4 first:pt-0 last:pb-0"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">Вопрос {item.questionNumber}</Badge>
                <span className="text-sm font-medium">{item.topic}</span>
              </div>
              <blockquote className="mt-3 text-sm leading-6 text-muted-foreground">
                «{item.answerExcerpt}»
              </blockquote>
              <p className="mt-2 text-sm leading-6">{item.observation}</p>
            </li>
          ))}
        </ol>
      </section>
      <Button variant="outline" className="self-start" onClick={onNew}>
        Новое интервью
      </Button>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 sm:p-6">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function ReportList({ title, items }: { title: string; items: string[] }) {
  return (
    <section className="rounded-lg border border-border bg-card p-4 sm:p-6">
      <h3 className="font-semibold">{title}</h3>
      <ul className="mt-4 flex flex-col gap-3 text-sm leading-6">
        {items.map((item) => (
          <li key={item} className="flex gap-2">
            <span
              aria-hidden
              className="mt-2 size-1.5 shrink-0 rounded-full bg-primary"
            />
            {item}
          </li>
        ))}
      </ul>
    </section>
  );
}
