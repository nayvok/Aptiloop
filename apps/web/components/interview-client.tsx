"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeftIcon,
  ArrowClockwiseIcon,
  CheckCircleIcon,
  ChatCircleDotsIcon,
} from "@phosphor-icons/react";
import { useRouter, useSearchParams } from "next/navigation";
import { z } from "zod";

import { api, ApiError } from "@/lib/api";
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
import { PageHeader } from "@/components/page-header";
import { InterviewChatView } from "@/components/interview-chat-view";
import { QueryError } from "@/components/query-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/ui/markdown";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { type MessageKey, useI18n } from "@/lib/i18n";
import { formatMinutesShort } from "@/lib/time";

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

export type Interview = z.infer<typeof interviewSchema>;
type Difficulty = z.infer<typeof difficultySchema>;

const pendingAnswerSchema = z
  .object({
    interviewId: idSchema,
    operationId: z.string().trim().min(8).max(200),
    answer: z.string().trim().min(1).max(20_000),
  })
  .strict();
type PendingAnswer = z.infer<typeof pendingAnswerSchema>;
type PendingDisclosure = {
  disclosure: z.infer<typeof disclosureResponseSchema>["disclosure"];
  resume:
    | { kind: "start"; draft: StartDraft }
    | { kind: "answer"; pending: PendingAnswer };
};
type StartDraft = z.infer<typeof startDraftSchema>;
type ScopeMode = "studied" | "current-week" | "manual" | "all";

const learningPathSchema = z.object({
  curriculum: z
    .object({
      weeks: z.array(
        z.object({
          order: z.number().int().positive(),
          days: z.array(
            z.object({
              status: z.enum([
                "completed",
                "in_progress",
                "available",
                "locked",
              ]),
              topics: z.array(z.string().trim().min(1)),
              units: z.array(
                z.object({
                  status: z.enum([
                    "locked",
                    "ready",
                    "in_progress",
                    "completed",
                    "skipped",
                  ]),
                }),
              ),
            }),
          ),
        }),
      ),
    })
    .nullable(),
});

const scopeOptions = [
  {
    value: "studied",
    label: "interview.scope.studied.label",
    description: "interview.scope.studied.description",
  },
  {
    value: "current-week",
    label: "interview.scope.currentWeek.label",
    description: "interview.scope.currentWeek.description",
  },
  {
    value: "manual",
    label: "interview.scope.manual.label",
    description: "interview.scope.manual.description",
  },
  {
    value: "all",
    label: "interview.scope.all.label",
    description: "interview.scope.all.description",
  },
] as const satisfies ReadonlyArray<{
  value: ScopeMode;
  label: MessageKey;
  description: MessageKey;
}>;

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
  const params = useSearchParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { locale, t } = useI18n();
  const requestedInterviewId = params.get("id")?.trim() || null;
  const sessionId = params.get("sessionId")?.trim() || null;
  const queryKey = requestedInterviewId
    ? ["interview-v2", requestedInterviewId]
    : ["interview-v2-current"];
  const interviewQuery = useQuery({
    queryKey,
    queryFn: async () =>
      requestedInterviewId
        ? parsePayload(
            interviewSchema,
            await api<unknown>(
              `/interviews/v2/${encodeURIComponent(requestedInterviewId)}`,
            ),
          )
        : readCurrentInterview(),
    retry: false,
  });
  const pathQuery = useQuery({
    queryKey: ["learning-path"],
    queryFn: async () =>
      learningPathSchema.parse(await api<unknown>("/learning/path")),
    retry: false,
  });
  const [topicsInput, setTopicsInput] = useState("JavaScript, TypeScript");
  const [scopeMode, setScopeMode] = useState<ScopeMode>("studied");
  const [difficulty, setDifficulty] = useState<Difficulty>("interview-ready");
  const [questionCount, setQuestionCount] = useState(3);
  const [answer, setAnswer] = useState("");
  const [action, setAction] = useState<"start" | "answer" | "finish" | null>(
    null,
  );
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingDisclosure, setPendingDisclosure] =
    useState<PendingDisclosure | null>(null);

  const interview = interviewQuery.data ?? null;
  const persistedAnswer = useMemo(
    () => readStorage(pendingAnswerKey, pendingAnswerSchema),
    [interview?.id],
  );
  const topicsByScope = useMemo(() => {
    const studied = new Set<string>();
    const currentWeek = new Set<string>();
    const all = new Set<string>();
    const curriculum = pathQuery.data?.curriculum;
    if (curriculum) {
      for (const week of curriculum.weeks) {
        for (const day of week.days) {
          day.topics.forEach((topic) => all.add(topic));
          const hasProgress = day.units.some(
            (unit) =>
              unit.status === "completed" || unit.status === "in_progress",
          );
          if (hasProgress) {
            day.topics.forEach((topic) => studied.add(topic));
          }
        }
      }
      const actionableWeek =
        curriculum.weeks.find((week) =>
          week.days.some(
            (day) => day.status === "in_progress" || day.status === "available",
          ),
        ) ?? curriculum.weeks[0];
      if (actionableWeek) {
        for (const day of actionableWeek.days) {
          day.topics.forEach((topic) => currentWeek.add(topic));
        }
      }
    }
    return {
      studied: [...studied],
      currentWeek: [...currentWeek],
      all: [...all],
    };
  }, [pathQuery.data]);
  const selectedTopics = useMemo(() => {
    if (scopeMode === "manual") {
      return [
        ...new Set(
          topicsInput
            .split(",")
            .map((topic) => topic.trim())
            .filter(Boolean),
        ),
      ];
    }
    return scopeMode === "current-week"
      ? topicsByScope.currentWeek
      : topicsByScope[scopeMode];
  }, [scopeMode, topicsInput, topicsByScope]);

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

  async function startInterview(
    retryDraft?: StartDraft,
    disclosureOperationId?: string,
  ) {
    const topics = retryDraft?.topics ?? selectedTopics;
    const draft: StartDraft = retryDraft ?? {
      operationId: operationId(),
      topics,
      difficulty,
      questionCount,
    };
    const validation = startDraftSchema.safeParse(draft);
    if (!validation.success) {
      setActionError(
        topics.length === 0
          ? scopeMode === "manual"
            ? t("interview.error.validation.manualTopics")
            : t("interview.error.validation.emptyScope")
          : t("interview.error.validation.setup"),
      );
      return;
    }
    writeStorage(startDraftKey, draft);
    setAction("start");
    setActionError(null);
    try {
      const raw = await api<unknown>("/interviews/v2", {
        method: "POST",
        body: JSON.stringify({
          ...draft,
          ...(sessionId ? { learningSessionId: sessionId } : {}),
          ...(disclosureOperationId ? { disclosureOperationId } : {}),
        }),
      });
      const disclosure = disclosureResponseSchema.safeParse(raw);
      if (disclosure.success) {
        setPendingDisclosure({
          disclosure: disclosure.data.disclosure,
          resume: { kind: "start", draft },
        });
        return;
      }
      const next = parsePayload(interviewSchema, raw);
      writeStorage(latestInterviewKey, next.id);
      if (next.status !== "setup") removeStorage(startDraftKey);
      queryClient.setQueryData(queryKey, next);
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : t("interview.error.start"),
      );
      await interviewQuery.refetch();
    } finally {
      setAction(null);
    }
  }

  async function sendPendingAnswer(
    pending: PendingAnswer,
    disclosureOperationId?: string,
  ) {
    setAction("answer");
    setActionError(null);
    try {
      const raw = await api<unknown>(
        `/interviews/v2/${encodeURIComponent(pending.interviewId)}/answers`,
        {
          method: "POST",
          body: JSON.stringify({
            operationId: pending.operationId,
            answer: pending.answer,
            ...(disclosureOperationId ? { disclosureOperationId } : {}),
          }),
        },
      );
      const disclosure = disclosureResponseSchema.safeParse(raw);
      if (disclosure.success) {
        setPendingDisclosure({
          disclosure: disclosure.data.disclosure,
          resume: { kind: "answer", pending },
        });
        return;
      }
      const next = parsePayload(interviewSchema, raw);
      removeStorage(pendingAnswerKey);
      setAnswer("");
      queryClient.setQueryData(queryKey, next);
    } catch (error) {
      setActionError(
        error instanceof Error
          ? t("interview.error.answerRetry", { error: error.message })
          : t("interview.error.answer"),
      );
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
    await sendPendingAnswer(pending);
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
      queryClient.setQueryData(queryKey, response.interview);
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : t("interview.error.finish"),
      );
    } finally {
      setAction(null);
    }
  }
  async function approveDisclosure() {
    const pending = pendingDisclosure;
    if (!pending) return;
    try {
      await api(`/ai/disclosures/${pending.disclosure.operationId}/approve`, {
        method: "POST",
        body: "{}",
      });
      setPendingDisclosure(null);
      if (pending.resume.kind === "start") {
        await startInterview(
          pending.resume.draft,
          pending.disclosure.operationId,
        );
      } else {
        await sendPendingAnswer(
          pending.resume.pending,
          pending.disclosure.operationId,
        );
      }
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : t("interview.error.disclosureApprove"),
      );
    }
  }

  async function cancelDisclosure() {
    const pending = pendingDisclosure;
    if (!pending) return;
    setPendingDisclosure(null);
    await api(`/ai/disclosures/${pending.disclosure.operationId}`, {
      method: "DELETE",
    }).catch(() => undefined);
    setActionError(t("interview.error.disclosureCanceled"));
  }

  function startNewInterview() {
    removeStorage(latestInterviewKey);
    removeStorage(startDraftKey);
    removeStorage(pendingAnswerKey);
    setAnswer("");
    setActionError(null);
    queryClient.setQueryData(queryKey, null);
  }

  const returnToSession = sessionId ? (
    <Button
      variant="outline"
      className="self-start"
      onClick={() =>
        router.push(`/session?id=${encodeURIComponent(sessionId)}`)
      }
    >
      <ArrowLeftIcon aria-hidden className="size-4" />
      {t("interview.returnToSession")}
    </Button>
  ) : null;
  const disclosureDialog = (
    <AlertDialog open={pendingDisclosure !== null}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("interview.disclosure.title")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("interview.disclosure.description")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {pendingDisclosure ? (
          <dl className="grid gap-3 rounded-lg border border-border bg-muted/20 p-4 text-sm">
            <div>
              <dt className="font-medium">
                {t("interview.disclosure.recipient")}
              </dt>
              <dd className="text-muted-foreground">
                {pendingDisclosure.disclosure.scope.destination}
              </dd>
            </div>
            <div>
              <dt className="font-medium">{t("interview.disclosure.data")}</dt>
              <dd className="text-muted-foreground">
                {t("interview.disclosure.payload", {
                  categories:
                    pendingDisclosure.disclosure.scope.payloadCategories.join(
                      ", ",
                    ),
                  bytes: pendingDisclosure.disclosure.scope.byteCount,
                })}
              </dd>
            </div>
            <div>
              <dt className="font-medium">
                {t("interview.disclosure.exclusions")}
              </dt>
              <dd className="text-muted-foreground">
                {pendingDisclosure.disclosure.scope.exclusions.join(", ")}
              </dd>
            </div>
          </dl>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel
            disabled={action !== null}
            onClick={() => void cancelDisclosure()}
          >
            {t("interview.disclosure.decline")}
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={action !== null}
            onClick={() => void approveDisclosure()}
          >
            {t("interview.disclosure.approve")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  if (interviewQuery.isLoading) {
    return (
      <div
        data-slot="interview-loading"
        className="flex flex-col gap-6"
        role="status"
        aria-label={t("interview.loading")}
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
            : t("interview.error.unknown")
        }
        retry={() => void interviewQuery.refetch()}
      />
    );
  }

  if (!interview) {
    return (
      <div data-slot="interview-setup" className="flex flex-col gap-6">
        {returnToSession}
        <PageHeader
          title={t("interview.title")}
          description={t("interview.setup.description")}
          actions={
            <Badge variant="outline">{t("interview.setup.workflow")}</Badge>
          }
        />
        <section
          className="rounded-lg border border-border bg-card p-4 sm:p-6"
          aria-labelledby="interview-setup-title"
        >
          <div className="flex max-w-2xl flex-col gap-6">
            <div>
              <h3 id="interview-setup-title" className="text-lg font-semibold">
                {t("interview.setup.title")}
              </h3>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                {t("interview.setup.help")}
              </p>
            </div>
            <fieldset className="grid gap-2" disabled={action !== null}>
              <legend className="text-sm font-medium">
                {t("interview.setup.scope")}
              </legend>
              <div className="flex flex-col gap-1.5">
                {scopeOptions.map((option) => (
                  <label
                    key={option.value}
                    className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md border border-border px-3 py-2.5 text-sm"
                  >
                    <input
                      type="radio"
                      name="interview-scope"
                      value={option.value}
                      checked={scopeMode === option.value}
                      onChange={() => setScopeMode(option.value)}
                      className="mt-0.5 size-4 accent-primary"
                    />
                    <span className="grid gap-0.5">
                      <span className="font-medium">{t(option.label)}</span>
                      <span className="text-muted-foreground">
                        {t(option.description)}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            {scopeMode === "manual" ? (
              <label className="grid gap-2 text-sm font-medium">
                {t("interview.setup.manualTopics")}
                <input
                  className={fieldClassName}
                  value={topicsInput}
                  onChange={(event) => setTopicsInput(event.target.value)}
                  placeholder="JavaScript, TypeScript"
                  maxLength={1450}
                  disabled={action !== null}
                />
              </label>
            ) : (
              <div className="grid gap-2">
                <p className="text-sm font-medium">
                  {t("interview.setup.topics")}
                </p>
                {selectedTopics.length > 0 ? (
                  <div
                    aria-label={t("interview.setup.selectedTopicsAria")}
                    className="flex flex-wrap gap-2"
                  >
                    {selectedTopics.map((topic) => (
                      <Badge key={topic} variant="secondary">
                        {topic}
                      </Badge>
                    ))}
                  </div>
                ) : pathQuery.isLoading ? (
                  <p role="status" className="text-sm text-muted-foreground">
                    {t("interview.setup.loadingTopics")}
                  </p>
                ) : pathQuery.isError ? (
                  <div className="flex flex-col gap-3 rounded-md border border-border bg-muted/40 p-3 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-sm leading-6 text-muted-foreground">
                      {t("interview.setup.topicsLoadError")}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void pathQuery.refetch()}
                      >
                        {t("interview.setup.retryTopics")}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setScopeMode("manual")}
                      >
                        {t("interview.setup.chooseManual")}
                      </Button>
                    </div>
                  </div>
                ) : scopeMode === "studied" ? (
                  <div className="flex flex-col gap-3 rounded-md border border-border bg-muted/40 p-4">
                    <p className="text-sm leading-6 text-muted-foreground">
                      {t("interview.setup.noStudiedTopics")}
                    </p>
                    <Button
                      variant="outline"
                      className="self-start"
                      onClick={() => setScopeMode("manual")}
                    >
                      {t("interview.setup.chooseManual")}
                    </Button>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {t("interview.setup.noTopics")}
                  </p>
                )}
              </div>
            )}
            <p className="text-sm text-muted-foreground">
              {t("interview.setup.durationEstimate", {
                duration: formatMinutesShort(questionCount * 5, locale),
                count: questionCount,
              })}
            </p>
            <p className="text-sm text-muted-foreground">
              {t("interview.setup.reportLimit")}
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-2 text-sm font-medium">
                {t("interview.setup.difficulty")}
                <select
                  className={fieldClassName}
                  value={difficulty}
                  onChange={(event) =>
                    setDifficulty(difficultySchema.parse(event.target.value))
                  }
                  disabled={action !== null}
                >
                  <option value="foundation">
                    {t("interview.setup.difficulty.foundation")}
                  </option>
                  <option value="interview-ready">
                    {t("interview.setup.difficulty.interviewReady")}
                  </option>
                  <option value="deep-dive">
                    {t("interview.setup.difficulty.deepDive")}
                  </option>
                </select>
              </label>
              <label className="grid gap-2 text-sm font-medium">
                {t("interview.setup.questionCount")}
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
                  {t("interview.setup.starting")}
                </>
              ) : (
                <>
                  <ChatCircleDotsIcon aria-hidden className="size-4" />
                  {t("interview.setup.start")}
                </>
              )}
            </Button>
          </div>
        </section>
        {disclosureDialog}
      </div>
    );
  }

  if (interview.status === "completed" && interview.report) {
    return (
      <InterviewReportView
        interview={interview}
        onNew={startNewInterview}
        returnToSession={returnToSession}
      />
    );
  }

  if (interview.status === "setup") {
    const draft = readStorage(startDraftKey, startDraftSchema);
    return (
      <div data-slot="interview-opening-retry" className="flex flex-col gap-6">
        {returnToSession}
        <PageHeader
          title={t("interview.title")}
          description={t("interview.opening.description")}
          actions={
            <Badge variant="warning">{t("interview.opening.status")}</Badge>
          }
        />
        <section className="rounded-lg border border-border bg-card p-6">
          <h3 className="font-semibold">{t("interview.opening.errorTitle")}</h3>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {t("interview.opening.retryDescription", {
              topics: interview.setup.topics.join(", "),
            })}
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
                {t("interview.opening.retrying")}
              </>
            ) : (
              <>
                <ArrowClockwiseIcon aria-hidden className="size-4" />
                {t("interview.opening.retry")}
              </>
            )}
          </Button>
        </section>
        {disclosureDialog}
      </div>
    );
  }

  const assistantMessages = interview.transcript.filter(
    (message) => message.role === "assistant",
  ).length;
  const currentQuestion = Math.max(1, assistantMessages);

  return (
    <div data-slot="interview-session" className="flex flex-col gap-6">
      {returnToSession}
      <PageHeader
        title={t("interview.title")}
        description={t("interview.session.description")}
        actions={
          <Badge variant="outline">
            {interview.progress.questionsAnswered} /{" "}
            {interview.setup.questionCount}
          </Badge>
        }
      />
      <div
        data-slot="interview-question-progress"
        className="flex items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-2"
      >
        <p className="text-sm font-medium">
          {t("interview.session.questionProgress", {
            current: currentQuestion,
            total: interview.setup.questionCount,
          })}
        </p>
        <span className="text-xs text-muted-foreground">
          {t("interview.session.answeredProgress", {
            answered: interview.progress.questionsAnswered,
            total: interview.setup.questionCount,
          })}
        </span>
      </div>
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
      {disclosureDialog}
    </div>
  );
}

function InterviewReportView({
  interview,
  onNew,
  returnToSession,
}: {
  interview: Interview;
  onNew(): void;
  returnToSession?: ReactNode;
}) {
  const { locale, t } = useI18n();
  const report = interview.report;
  if (!report) return null;
  const completionPercent = new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits: 0,
  }).format(report.metrics.completionRate);
  return (
    <div data-slot="interview-report" className="flex flex-col gap-6">
      {returnToSession}
      <PageHeader
        title={t("interview.report.title")}
        description={t("interview.report.description")}
        actions={
          <Badge variant="success">
            <CheckCircleIcon aria-hidden className="size-3.5" />
            {t("interview.report.completed")}
          </Badge>
        }
      />
      <section
        data-slot="report-limits"
        aria-label={t("interview.report.limitsAria")}
        className="rounded-lg border border-primary/30 bg-primary/5 p-4 sm:p-5"
      >
        <p className="text-sm font-medium leading-6">
          {t("interview.report.limits")}
        </p>
      </section>
      <section
        aria-labelledby="report-summary-title"
        className="rounded-lg border border-border bg-card p-4 sm:p-6"
      >
        <h3 id="report-summary-title" className="font-semibold">
          {t("interview.report.summary")}
        </h3>
        <Markdown className="mt-3">{report.summary}</Markdown>
      </section>
      <section
        className="grid gap-4 sm:grid-cols-3"
        aria-label={t("interview.report.metricsAria")}
      >
        <Metric
          label={t("interview.report.metric.asked")}
          value={String(report.metrics.questionsAsked)}
        />
        <Metric
          label={t("interview.report.metric.answered")}
          value={String(report.metrics.questionsAnswered)}
        />
        <Metric
          label={t("interview.report.metric.completion")}
          value={completionPercent}
        />
      </section>
      <div className="grid gap-6 lg:grid-cols-2">
        <ReportList
          title={t("interview.report.strengths")}
          items={report.strengths}
        />
        <ReportList
          title={t("interview.report.growthAreas")}
          items={report.growthAreas}
        />
      </div>
      <section
        className="rounded-lg border border-border bg-card p-4 sm:p-6"
        aria-labelledby="evidence-title"
      >
        <h3 id="evidence-title" className="font-semibold">
          {t("interview.report.evidence")}
        </h3>
        <ol className="mt-4 divide-y divide-border">
          {report.evidence.map((item) => (
            <li
              key={`${item.questionNumber}-${item.topic}`}
              className="py-4 first:pt-0 last:pb-0"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">
                  {t("interview.report.question", {
                    number: item.questionNumber,
                  })}
                </Badge>
                <span className="text-sm font-medium">{item.topic}</span>
              </div>
              <blockquote className="mt-3 text-sm leading-6 text-muted-foreground">
                {t("interview.report.answerExcerpt", {
                  excerpt: item.answerExcerpt,
                })}
              </blockquote>
              <Markdown className="mt-2">{item.observation}</Markdown>
            </li>
          ))}
        </ol>
      </section>
      <Button variant="outline" className="self-start" onClick={onNew}>
        {t("interview.report.new")}
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
            <Markdown>{item}</Markdown>
          </li>
        ))}
      </ul>
    </section>
  );
}
