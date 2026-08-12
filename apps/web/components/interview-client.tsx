"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AiDisclosureSchema,
  InterviewDisclosureContinuationSchema,
  InterviewPendingDisclosureSchema,
  ProviderConnectionSchema,
  RoleProfileSchema,
  type InterviewDisclosureContinuation,
  type InterviewPendingDisclosure,
} from "@aptiloop/shared";
import {
  ArrowLeftIcon,
  ArrowClockwiseIcon,
  CaretDownIcon,
  CheckCircleIcon,
  ChatCircleDotsIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { z } from "zod";

import { api, ApiError } from "@/lib/api";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { usePageRouteContext } from "@/components/page-route-context";
import { RouteOrientation } from "@/components/route-orientation";
import { InterviewChatView } from "@/components/interview-chat-view";
import { QueryError } from "@/components/query-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Markdown } from "@/components/ui/markdown";
import { LoadingState } from "@/components/ui/loading-state";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { type MessageKey, useI18n } from "@/lib/i18n";
import type { RouteContext } from "@/lib/route-context";
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
    learningSessionId: idSchema.nullable(),
    resumeOperationId: z.string().trim().min(8).max(200).nullable(),
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
  .object({
    learningSessionId: idSchema.nullable(),
    interview: interviewSchema.nullable(),
  })
  .strict();
const linkedSessionContextSchema = z
  .object({
    session: z
      .object({
        id: idSchema,
        courseContext: z
          .object({
            courseId: idSchema,
            revisionId: idSchema,
          })
          .passthrough()
          .optional(),
        snapshot: z
          .object({
            curriculumId: idSchema,
            curriculumVersionId: idSchema,
            curriculumTitle: z.string().trim().min(1),
            day: z
              .object({
                order: z.number().int().positive(),
                title: z.string().trim().min(1),
              })
              .passthrough(),
          })
          .passthrough(),
      })
      .passthrough(),
  })
  .strict();
const finishResponseSchema = z
  .object({ interview: interviewSchema, report: reportSchema })
  .strict();
const disclosureMutationResponseSchema = z
  .object({ disclosure: AiDisclosureSchema })
  .strict();
const abandonResponseSchema = z
  .object({
    abandoned: z
      .object({
        interviewId: idSchema,
        operationId: z.string().trim().min(8).max(200),
      })
      .strict(),
  })
  .strict();
export type Interview = z.infer<typeof interviewSchema>;
type Difficulty = z.infer<typeof difficultySchema>;

const pendingAnswerEntrySchema = z
  .object({
    learningSessionId: idSchema.nullable(),
    interviewId: idSchema,
    questionId: idSchema,
    operationId: z.string().trim().min(8).max(200),
    answer: z.string().trim().min(1).max(20_000),
  })
  .strict();
type PendingAnswer = z.infer<typeof pendingAnswerEntrySchema>;
type PendingDisclosure = {
  continuation: InterviewDisclosureContinuation;
  disclosure: InterviewPendingDisclosure["disclosure"];
  resume:
    | { kind: "start"; draft: StartDraft }
    | { kind: "answer"; pending: PendingAnswer };
};
type StartDraft = z.infer<typeof startDraftSchema>;
type ScopeMode = "studied" | "current-week" | "manual" | "all";
type InterviewRead = z.infer<typeof currentResponseSchema>;

const setupDraftEntrySchema = z
  .object({
    learningSessionId: idSchema.nullable(),
    scopeMode: z.enum(["studied", "current-week", "manual", "all"]),
    topicsInput: z.string().max(1_450),
    difficulty: difficultySchema,
    questionCount: z.number().int().min(1).max(12),
  })
  .strict();
const startRetryEntrySchema = z
  .object({
    learningSessionId: idSchema.nullable(),
    draft: startDraftSchema,
  })
  .strict();
const answerDraftEntrySchema = z
  .object({
    learningSessionId: idSchema.nullable(),
    interviewId: idSchema,
    questionId: idSchema,
    answer: z.string().max(20_000),
  })
  .strict();
const maxStoredDrafts = 16;
const setupDraftStoreSchema = z
  .object({
    version: z.literal(1),
    drafts: z.array(setupDraftEntrySchema).max(maxStoredDrafts),
  })
  .strict();
const startRetryStoreSchema = z
  .object({
    version: z.literal(1),
    drafts: z.array(startRetryEntrySchema).max(maxStoredDrafts),
  })
  .strict();
const answerDraftStoreSchema = z
  .object({
    version: z.literal(1),
    drafts: z.array(answerDraftEntrySchema).max(maxStoredDrafts),
  })
  .strict();
const pendingAnswerStoreSchema = z
  .object({
    version: z.literal(1),
    drafts: z.array(pendingAnswerEntrySchema).max(maxStoredDrafts),
  })
  .strict();
const interviewAiSettingsSchema = z.object({
  ai: z.object({
    connections: z.array(ProviderConnectionSchema),
    roleProfiles: z.array(RoleProfileSchema),
  }),
});

type InterviewAiSettings = z.infer<typeof interviewAiSettingsSchema>;
type InterviewAiReadiness = {
  kind: "checking" | "ready" | "off" | "unavailable";
  ready: boolean;
  recoverySection: "ai" | "connections";
};

const defaultTopicsInput = "JavaScript, TypeScript";
const defaultScopeMode: ScopeMode = "studied";
const defaultDifficulty: Difficulty = "interview-ready";
const defaultQuestionCount = 3;

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
const setupDraftKey = "dlh-interview-v2-setup-draft";
const answerDraftKey = "dlh-interview-v2-answer-draft";

function isScopeMode(value: string): value is ScopeMode {
  return scopeOptions.some((option) => option.value === value);
}

type InterviewReadErrorCode =
  "invalid-payload" | "scope-mismatch" | "association-mismatch";

class InterviewReadError extends Error {
  constructor(readonly code: InterviewReadErrorCode) {
    super(code);
    this.name = "InterviewReadError";
  }
}

const interviewReadErrorKeys: Readonly<
  Record<InterviewReadErrorCode, MessageKey>
> = {
  "invalid-payload": "interview.error.invalidPayload",
  "scope-mismatch": "interview.error.scopeMismatch",
  "association-mismatch": "interview.error.associationMismatch",
};

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
  try {
    rejectProtectedFields(value);
    return schema.parse(value);
  } catch {
    throw new InterviewReadError("invalid-payload");
  }
}

function readStorage<T>(key: string, schema: z.ZodType<T>): T | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(key);
    if (!value) return null;
    const parsed = schema.safeParse(JSON.parse(value));
    if (parsed.success) return parsed.data;
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Keep the controlled form usable when browser storage is blocked.
    }
    return null;
  } catch {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Keep the controlled form usable when browser storage is blocked.
    }
    return null;
  }
}

function writeStorage(key: string, value: unknown): void {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // The current in-memory draft remains usable for this page lifetime.
    }
  }
}

function removeStorage(key: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // A blocked storage backend must not break the Interview workflow.
  }
}

type DraftStore<T> = { version: 1; drafts: T[] };

function readDraftStore<T>(key: string, schema: z.ZodType<DraftStore<T>>): T[] {
  return readStorage(key, schema)?.drafts ?? [];
}

function writeDraftStore<T>(key: string, drafts: T[]): void {
  if (drafts.length === 0) {
    removeStorage(key);
    return;
  }
  writeStorage(key, {
    version: 1,
    drafts: drafts.slice(-maxStoredDrafts),
  } satisfies DraftStore<T>);
}

function upsertDraft<T>(
  key: string,
  schema: z.ZodType<DraftStore<T>>,
  draft: T,
  sameIdentity: (candidate: T) => boolean,
): void {
  const retained = readDraftStore(key, schema).filter(
    (candidate) => !sameIdentity(candidate),
  );
  writeDraftStore(key, [...retained, draft]);
}

function removeDrafts<T>(
  key: string,
  schema: z.ZodType<DraftStore<T>>,
  shouldRemove: (candidate: T) => boolean,
): void {
  writeDraftStore(
    key,
    readDraftStore(key, schema).filter((candidate) => !shouldRemove(candidate)),
  );
}

function sameLearningSession(
  candidate: { learningSessionId: string | null },
  learningSessionId: string | null,
): boolean {
  return candidate.learningSessionId === learningSessionId;
}

function sameInterview(
  candidate: { learningSessionId: string | null; interviewId: string },
  interview: Interview,
): boolean {
  return (
    candidate.learningSessionId === interview.learningSessionId &&
    candidate.interviewId === interview.id
  );
}

function operationId(): string {
  return globalThis.crypto.randomUUID();
}

function learningSessionScopeKey(learningSessionId: string | null): string {
  return learningSessionId
    ? `learning-session:${learningSessionId}`
    : "standalone";
}

function pendingQuestionId(interview: Interview): string | null {
  if (
    interview.status !== "in_progress" ||
    interview.progress.questionsAsked <= interview.progress.questionsAnswered
  ) {
    return null;
  }
  return (
    interview.transcript.findLast((message) => message.role === "assistant")
      ?.id ?? null
  );
}

type DisclosureRecovery = {
  continuation: InterviewDisclosureContinuation;
  resume: PendingDisclosure["resume"];
};

function readDisclosureRecovery(
  interview: Interview,
): DisclosureRecovery | null {
  if (interview.status === "setup") {
    const persisted = readDraftStore(
      startDraftKey,
      startRetryStoreSchema,
    ).findLast((candidate) =>
      sameLearningSession(candidate, interview.learningSessionId),
    )?.draft;
    const draft =
      persisted?.operationId === interview.resumeOperationId
        ? persisted
        : interview.resumeOperationId
          ? {
              operationId: interview.resumeOperationId,
              topics: interview.setup.topics,
              difficulty: interview.setup.difficulty,
              questionCount: interview.setup.questionCount,
            }
          : null;
    if (!draft) return null;
    return {
      continuation: InterviewDisclosureContinuationSchema.parse({
        kind: "start",
        learningSessionId: interview.learningSessionId,
        interviewId: interview.id,
        operationId: draft.operationId,
      }),
      resume: { kind: "start", draft },
    };
  }
  if (
    interview.status !== "in_progress" ||
    interview.progress.readyToFinish ||
    interview.progress.questionsAsked !== interview.progress.questionsAnswered
  ) {
    return null;
  }
  const pending = readDraftStore(
    pendingAnswerKey,
    pendingAnswerStoreSchema,
  ).findLast((candidate) => sameInterview(candidate, interview));
  if (!pending) return null;
  const questionIndex = interview.transcript.findIndex(
    (message) =>
      message.id === pending.questionId && message.role === "assistant",
  );
  if (
    questionIndex < 0 ||
    interview.transcript[questionIndex + 1]?.role !== "user"
  ) {
    return null;
  }
  return {
    continuation: InterviewDisclosureContinuationSchema.parse({
      kind: "answer",
      learningSessionId: pending.learningSessionId,
      interviewId: pending.interviewId,
      questionId: pending.questionId,
      operationId: pending.operationId,
    }),
    resume: { kind: "answer", pending },
  };
}

function pendingDisclosurePath(
  continuation: InterviewDisclosureContinuation,
): string {
  const query = new URLSearchParams({
    kind: continuation.kind,
    operationId: continuation.operationId,
  });
  if (continuation.kind === "answer") {
    query.set("questionId", continuation.questionId);
  }
  if (continuation.learningSessionId) {
    query.set("learningSessionId", continuation.learningSessionId);
  }
  return `/interviews/v2/${encodeURIComponent(continuation.interviewId)}/disclosures/pending?${query.toString()}`;
}

function sameDisclosureContinuation(
  left: InterviewDisclosureContinuation,
  right: InterviewDisclosureContinuation,
): boolean {
  return (
    left.kind === right.kind &&
    left.learningSessionId === right.learningSessionId &&
    left.interviewId === right.interviewId &&
    left.operationId === right.operationId &&
    (left.kind === "start" ||
      (right.kind === "answer" && left.questionId === right.questionId))
  );
}

function initialDisclosureContinuation(
  pending: InterviewPendingDisclosure,
  resume: PendingDisclosure["resume"],
  learningSessionId: string | null,
): boolean {
  if (
    pending.continuation.kind !== resume.kind ||
    pending.continuation.learningSessionId !== learningSessionId
  ) {
    return false;
  }
  if (resume.kind === "start") {
    return pending.continuation.operationId === resume.draft.operationId;
  }
  return (
    pending.continuation.kind === "answer" &&
    pending.continuation.interviewId === resume.pending.interviewId &&
    pending.continuation.questionId === resume.pending.questionId &&
    pending.continuation.operationId === resume.pending.operationId
  );
}

function getInterviewAiReadiness(
  settings: InterviewAiSettings | undefined,
  status: "pending" | "error" | "success",
): InterviewAiReadiness {
  if (status === "pending") {
    return {
      kind: "checking",
      ready: false,
      recoverySection: "ai",
    };
  }
  if (status === "error" || !settings) {
    return {
      kind: "unavailable",
      ready: false,
      recoverySection: "ai",
    };
  }
  const profile = settings.ai.roleProfiles.find(
    (candidate) => candidate.role === "evaluator",
  );
  if (!profile || profile.mode === "no-ai") {
    return { kind: "off", ready: false, recoverySection: "ai" };
  }
  if (!profile.connectionId || !profile.modelId) {
    return { kind: "unavailable", ready: false, recoverySection: "ai" };
  }
  const connection = settings.ai.connections.find(
    (candidate) => candidate.connectionId === profile.connectionId,
  );
  if (
    !connection ||
    !connection.enabled ||
    connection.state !== "connected" ||
    !connection.observedCapabilities?.connection.authenticated
  ) {
    return {
      kind: "unavailable",
      ready: false,
      recoverySection: "connections",
    };
  }
  const observed = connection.observedCapabilities;
  const model = observed.models.find(
    (candidate) => candidate.modelId === profile.modelId && candidate.available,
  );
  if (!model) {
    return { kind: "unavailable", ready: false, recoverySection: "ai" };
  }
  const hasRequiredCapabilities = profile.requiredCapabilities.every(
    (capability) => {
      if (capability === "models") return true;
      if (capability === "streaming") return observed.connection.streaming;
      if (capability === "cancellation")
        return observed.connection.cancellation;
      if (capability === "tools") {
        return model.typedToolCalls !== "none";
      }
      if (capability === "structured-output") {
        return model.typedToolCalls === "schema-constrained";
      }
      return false;
    },
  );
  return hasRequiredCapabilities
    ? { kind: "ready", ready: true, recoverySection: "ai" }
    : {
        kind: "unavailable",
        ready: false,
        recoverySection: "connections",
      };
}

function scopedReadPath(path: string, learningSessionId: string | null) {
  return learningSessionId
    ? `${path}?learningSessionId=${encodeURIComponent(learningSessionId)}`
    : path;
}

function interviewRead(interview: Interview): InterviewRead {
  return {
    learningSessionId: interview.learningSessionId,
    interview,
  };
}

async function readCurrentInterview(
  requestedLearningSessionId: string | null,
): Promise<InterviewRead> {
  const current = parsePayload(
    currentResponseSchema,
    await api<unknown>(
      scopedReadPath("/interviews/v2/current", requestedLearningSessionId),
    ),
  );
  if (
    requestedLearningSessionId &&
    current.learningSessionId !== requestedLearningSessionId
  ) {
    throw new InterviewReadError("scope-mismatch");
  }
  if (current.interview) {
    return current.interview.learningSessionId === current.learningSessionId
      ? current
      : { ...current, interview: null };
  }

  const latestId = readStorage(latestInterviewKey, idSchema);
  if (!latestId) return current;
  try {
    const latest = parsePayload(
      interviewSchema,
      await api<unknown>(
        scopedReadPath(
          `/interviews/v2/${encodeURIComponent(latestId)}`,
          requestedLearningSessionId ? current.learningSessionId : null,
        ),
      ),
    );
    if (
      requestedLearningSessionId &&
      latest.learningSessionId !== current.learningSessionId
    ) {
      return current;
    }
    return latest.status === "completed" ? interviewRead(latest) : current;
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 404) throw error;
    if (!requestedLearningSessionId) removeStorage(latestInterviewKey);
    return current;
  }
}

async function readRequestedInterview(
  interviewId: string,
  requestedLearningSessionId: string | null,
): Promise<InterviewRead> {
  const interview = parsePayload(
    interviewSchema,
    await api<unknown>(
      scopedReadPath(
        `/interviews/v2/${encodeURIComponent(interviewId)}`,
        requestedLearningSessionId,
      ),
    ),
  );
  if (
    requestedLearningSessionId &&
    interview.learningSessionId !== requestedLearningSessionId
  ) {
    throw new InterviewReadError("association-mismatch");
  }
  return interviewRead(interview);
}

const markdownContentClassName =
  "min-w-0 max-w-full [overflow-wrap:anywhere] [&:has(table)]:overflow-x-auto [&_pre]:max-w-full [&_table]:min-w-max";

function InterviewHeader({
  embedded,
  title,
  description,
  actions,
}: {
  embedded: boolean;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  if (embedded) return null;

  return (
    <PageHeader title={title} description={description} actions={actions} />
  );
}

export function InterviewClient({
  embedded = false,
}: {
  embedded?: boolean;
} = {}) {
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const { locale, t } = useI18n();
  const requestedInterviewId = params.get("id")?.trim() || null;
  const requestedLearningSessionId = params.get("sessionId")?.trim() || null;
  const interviewScopeKey = `${requestedInterviewId ?? "current"}:${requestedLearningSessionId ?? "standalone"}`;
  const queryKey = requestedInterviewId
    ? [
        "interview-v2",
        requestedInterviewId,
        requestedLearningSessionId ?? "standalone",
      ]
    : ["interview-v2-current", requestedLearningSessionId ?? "standalone"];
  const interviewQuery = useQuery({
    queryKey,
    queryFn: async () =>
      requestedInterviewId
        ? readRequestedInterview(
            requestedInterviewId,
            requestedLearningSessionId,
          )
        : readCurrentInterview(requestedLearningSessionId),
    retry: false,
  });
  const pathQuery = useQuery({
    queryKey: ["learning-path"],
    queryFn: async () =>
      learningPathSchema.parse(await api<unknown>("/learning/path")),
    retry: false,
  });
  const [topicsInput, setTopicsInput] = useState(defaultTopicsInput);
  const [scopeMode, setScopeMode] = useState<ScopeMode>(defaultScopeMode);
  const [difficulty, setDifficulty] = useState<Difficulty>(defaultDifficulty);
  const [questionCount, setQuestionCount] = useState(defaultQuestionCount);
  const [answer, setAnswer] = useState("");
  const [setupHydratedScope, setSetupHydratedScope] = useState<string | null>(
    null,
  );
  const [action, setAction] = useState<"start" | "answer" | "finish" | null>(
    null,
  );
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingDisclosure, setPendingDisclosure] =
    useState<PendingDisclosure | null>(null);
  const [disclosureError, setDisclosureError] = useState<string | null>(null);
  const disclosureRecoveryRef = useRef<string | null>(null);
  const DetailHeading = "h2";

  const interviewReadResult = interviewQuery.data ?? null;
  const interview = interviewReadResult?.interview ?? null;
  const validatedLearningSessionId =
    interviewReadResult?.learningSessionId ?? null;
  const linkedSessionQuery = useQuery({
    queryKey: ["interview-linked-session", validatedLearningSessionId],
    queryFn: async () => {
      const learningSessionId = validatedLearningSessionId;
      if (!learningSessionId) throw new Error("Missing linked session scope");
      const result = linkedSessionContextSchema.parse(
        await api<unknown>(
          `/learning/sessions/v2/${encodeURIComponent(learningSessionId)}`,
        ),
      );
      if (result.session.id !== learningSessionId) {
        throw new InterviewReadError("association-mismatch");
      }
      return result.session;
    },
    enabled: validatedLearningSessionId !== null,
    retry: false,
  });
  const linkedSession = linkedSessionQuery.data ?? null;
  const pageRouteContext = useMemo<RouteContext | null>(() => {
    if (!validatedLearningSessionId || !linkedSession) return null;
    const courseId =
      linkedSession.courseContext?.courseId ??
      linkedSession.snapshot.curriculumId;
    const revisionId =
      linkedSession.courseContext?.revisionId ??
      linkedSession.snapshot.curriculumVersionId;
    return {
      sectionHref: "/courses",
      breadcrumbs: [
        { href: "/courses", label: "nav.courses" },
        {
          href: `/courses/${encodeURIComponent(courseId)}/revisions/${encodeURIComponent(revisionId)}`,
          text: linkedSession.snapshot.curriculumTitle,
        },
        {
          href: `/session?id=${encodeURIComponent(validatedLearningSessionId)}`,
          text: t("session.lessonTitle", {
            order: linkedSession.snapshot.day.order,
            title: linkedSession.snapshot.day.title,
          }),
        },
        { label: "interview.title" },
      ],
    };
  }, [linkedSession, t, validatedLearningSessionId]);
  usePageRouteContext(pageRouteContext);
  const returnLearningSessionId = interview?.learningSessionId ?? null;
  const currentQuestionId = interview ? pendingQuestionId(interview) : null;
  const readinessQueryEnabled =
    interviewQuery.isSuccess &&
    (interview === null || interview?.status === "setup");
  const settingsQuery = useQuery({
    queryKey: ["settings", "interview"],
    queryFn: () => api<unknown>("/settings"),
    select: (value) => interviewAiSettingsSchema.parse(value),
    enabled: readinessQueryEnabled,
    retry: false,
  });
  const aiReadiness = getInterviewAiReadiness(
    settingsQuery.data,
    settingsQuery.isError
      ? "error"
      : settingsQuery.isSuccess
        ? "success"
        : "pending",
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
    setPendingDisclosure(null);
    setDisclosureError(null);
    disclosureRecoveryRef.current = null;
  }, [interviewScopeKey]);

  useEffect(() => {
    if (!interview) return;
    if (interview.status === "setup") {
      setTopicsInput(interview.setup.topics.join(", "));
      setDifficulty(interview.setup.difficulty);
      setQuestionCount(interview.setup.questionCount);
    }
    removeDrafts(setupDraftKey, setupDraftStoreSchema, (candidate) =>
      sameLearningSession(candidate, interview.learningSessionId),
    );
    setSetupHydratedScope(null);

    if (
      interview.status === "completed" ||
      (interview.status === "in_progress" && interview.progress.readyToFinish)
    ) {
      removeDrafts(answerDraftKey, answerDraftStoreSchema, (candidate) =>
        sameInterview(candidate, interview),
      );
      removeDrafts(pendingAnswerKey, pendingAnswerStoreSchema, (candidate) =>
        sameInterview(candidate, interview),
      );
      setAnswer("");
      return;
    }
    const persistedDraft = readDraftStore(
      answerDraftKey,
      answerDraftStoreSchema,
    ).findLast(
      (candidate) =>
        sameInterview(candidate, interview) &&
        candidate.questionId === currentQuestionId,
    );
    const persistedPending = readDraftStore(
      pendingAnswerKey,
      pendingAnswerStoreSchema,
    ).findLast(
      (candidate) =>
        sameInterview(candidate, interview) &&
        (candidate.questionId === currentQuestionId ||
          currentQuestionId === null),
    );

    if (persistedDraft) {
      setAnswer(persistedDraft.answer);
    } else if (persistedPending) {
      setAnswer(persistedPending.answer);
    } else {
      setAnswer("");
      removeDrafts(answerDraftKey, answerDraftStoreSchema, (candidate) =>
        sameInterview(candidate, interview),
      );
      removeDrafts(pendingAnswerKey, pendingAnswerStoreSchema, (candidate) =>
        sameInterview(candidate, interview),
      );
    }
  }, [currentQuestionId, interview]);

  useEffect(() => {
    if (!interviewQuery.isSuccess || interview) return;
    const scopeKey = learningSessionScopeKey(validatedLearningSessionId);
    if (setupHydratedScope === scopeKey) return;
    const stored = readDraftStore(
      setupDraftKey,
      setupDraftStoreSchema,
    ).findLast((candidate) =>
      sameLearningSession(candidate, validatedLearningSessionId),
    );
    if (stored) {
      setScopeMode(stored.scopeMode);
      setTopicsInput(stored.topicsInput);
      setDifficulty(stored.difficulty);
      setQuestionCount(stored.questionCount);
    } else {
      setScopeMode(defaultScopeMode);
      setTopicsInput(defaultTopicsInput);
      setDifficulty(defaultDifficulty);
      setQuestionCount(defaultQuestionCount);
    }
    setSetupHydratedScope(scopeKey);
  }, [
    interview,
    interviewQuery.isSuccess,
    setupHydratedScope,
    validatedLearningSessionId,
  ]);

  useEffect(() => {
    if (!interviewQuery.isSuccess || interview) return;
    const scopeKey = learningSessionScopeKey(validatedLearningSessionId);
    if (setupHydratedScope !== scopeKey) return;
    upsertDraft(
      setupDraftKey,
      setupDraftStoreSchema,
      {
        learningSessionId: validatedLearningSessionId,
        scopeMode,
        topicsInput,
        difficulty,
        questionCount,
      } satisfies z.infer<typeof setupDraftEntrySchema>,
      (candidate) => sameLearningSession(candidate, validatedLearningSessionId),
    );
  }, [
    difficulty,
    interview,
    interviewQuery.isSuccess,
    questionCount,
    scopeMode,
    setupHydratedScope,
    topicsInput,
    validatedLearningSessionId,
  ]);

  useEffect(() => {
    if (
      !interviewQuery.isSuccess ||
      !interview ||
      pendingDisclosure ||
      action
    ) {
      return;
    }
    const recovery = readDisclosureRecovery(interview);
    if (!recovery) return;
    const path = pendingDisclosurePath(recovery.continuation);
    if (disclosureRecoveryRef.current === path) return;
    disclosureRecoveryRef.current = path;
    let active = true;
    void api<unknown>(path)
      .then((raw) => {
        const pending = InterviewPendingDisclosureSchema.parse(raw);
        if (
          !sameDisclosureContinuation(
            pending.continuation,
            recovery.continuation,
          )
        ) {
          throw new Error("Interview disclosure continuation mismatch");
        }
        if (active) {
          setDisclosureError(null);
          setPendingDisclosure({
            continuation: pending.continuation,
            disclosure: pending.disclosure,
            resume: recovery.resume,
          });
        }
      })
      .catch(() => {
        if (active) {
          setActionError(
            recovery.resume.kind === "start"
              ? t("interview.error.start")
              : t("interview.error.answer"),
          );
        }
      });
    return () => {
      active = false;
      if (disclosureRecoveryRef.current === path) {
        disclosureRecoveryRef.current = null;
      }
    };
  }, [action, interview, interviewQuery.isSuccess, pendingDisclosure, t]);

  function updateAnswerDraft(value: string) {
    setAnswer(value);
    if (!interview) return;
    const persistedPending = readDraftStore(
      pendingAnswerKey,
      pendingAnswerStoreSchema,
    ).findLast((candidate) => sameInterview(candidate, interview));
    const questionId =
      currentQuestionId ??
      (persistedPending?.interviewId === interview.id &&
      persistedPending.learningSessionId === interview.learningSessionId
        ? persistedPending.questionId
        : null);
    if (!questionId || value.length === 0) {
      removeDrafts(answerDraftKey, answerDraftStoreSchema, (candidate) =>
        sameInterview(candidate, interview),
      );
      return;
    }
    upsertDraft(
      answerDraftKey,
      answerDraftStoreSchema,
      {
        learningSessionId: interview.learningSessionId,
        interviewId: interview.id,
        questionId,
        answer: value,
      } satisfies z.infer<typeof answerDraftEntrySchema>,
      (candidate) =>
        sameInterview(candidate, interview) &&
        candidate.questionId === questionId,
    );
  }

  async function startInterview(
    retryDraft?: StartDraft,
    disclosureOperationId?: string,
  ) {
    if (!aiReadiness.ready) return;
    if (!disclosureOperationId) disclosureRecoveryRef.current = null;
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
    upsertDraft(
      startDraftKey,
      startRetryStoreSchema,
      {
        learningSessionId: validatedLearningSessionId,
        draft,
      } satisfies z.infer<typeof startRetryEntrySchema>,
      (candidate) => sameLearningSession(candidate, validatedLearningSessionId),
    );
    setAction("start");
    setActionError(null);
    try {
      const raw = await api<unknown>("/interviews/v2", {
        method: "POST",
        body: JSON.stringify({
          ...draft,
          ...(validatedLearningSessionId
            ? { learningSessionId: validatedLearningSessionId }
            : {}),
          ...(disclosureOperationId ? { disclosureOperationId } : {}),
        }),
      });
      const disclosure = InterviewPendingDisclosureSchema.safeParse(raw);
      if (disclosure.success) {
        const resume = { kind: "start" as const, draft };
        if (
          !initialDisclosureContinuation(
            disclosure.data,
            resume,
            validatedLearningSessionId,
          )
        ) {
          throw new Error("Interview disclosure continuation mismatch");
        }
        setDisclosureError(null);
        setPendingDisclosure({
          continuation: disclosure.data.continuation,
          disclosure: disclosure.data.disclosure,
          resume,
        });
        return;
      }
      const next = parsePayload(interviewSchema, raw);
      writeStorage(latestInterviewKey, next.id);
      removeDrafts(setupDraftKey, setupDraftStoreSchema, (candidate) =>
        sameLearningSession(candidate, validatedLearningSessionId),
      );
      if (next.status !== "setup") {
        removeDrafts(startDraftKey, startRetryStoreSchema, (candidate) =>
          sameLearningSession(candidate, validatedLearningSessionId),
        );
      }
      queryClient.setQueryData(queryKey, interviewRead(next));
    } catch {
      setActionError(t("interview.error.start"));
      await interviewQuery.refetch();
    } finally {
      setAction(null);
    }
  }

  async function sendPendingAnswer(
    pending: PendingAnswer,
    disclosureOperationId?: string,
  ) {
    if (!disclosureOperationId) disclosureRecoveryRef.current = null;
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
      const disclosure = InterviewPendingDisclosureSchema.safeParse(raw);
      if (disclosure.success) {
        const resume = { kind: "answer" as const, pending };
        if (
          !initialDisclosureContinuation(
            disclosure.data,
            resume,
            pending.learningSessionId,
          )
        ) {
          throw new Error("Interview disclosure continuation mismatch");
        }
        setDisclosureError(null);
        setPendingDisclosure({
          continuation: disclosure.data.continuation,
          disclosure: disclosure.data.disclosure,
          resume,
        });
        return;
      }
      const next = parsePayload(interviewSchema, raw);
      removeDrafts(
        pendingAnswerKey,
        pendingAnswerStoreSchema,
        (candidate) =>
          candidate.learningSessionId === pending.learningSessionId &&
          candidate.interviewId === pending.interviewId &&
          candidate.questionId === pending.questionId,
      );
      removeDrafts(
        answerDraftKey,
        answerDraftStoreSchema,
        (candidate) =>
          candidate.learningSessionId === pending.learningSessionId &&
          candidate.interviewId === pending.interviewId &&
          candidate.questionId === pending.questionId,
      );
      setAnswer("");
      queryClient.setQueryData(queryKey, interviewRead(next));
    } catch {
      setActionError(t("interview.error.answer"));
    } finally {
      setAction(null);
    }
  }

  async function submitAnswer() {
    if (!interview || !answer.trim()) return;
    const stored = readDraftStore(
      pendingAnswerKey,
      pendingAnswerStoreSchema,
    ).findLast((candidate) => sameInterview(candidate, interview));
    const questionId =
      currentQuestionId ??
      (stored?.interviewId === interview.id &&
      stored.learningSessionId === interview.learningSessionId
        ? stored.questionId
        : null);
    if (!questionId) return;
    const pending =
      stored?.interviewId === interview.id &&
      stored.learningSessionId === interview.learningSessionId &&
      stored.questionId === questionId &&
      stored.answer === answer.trim()
        ? stored
        : {
            learningSessionId: interview.learningSessionId,
            interviewId: interview.id,
            questionId,
            operationId: operationId(),
            answer: answer.trim(),
          };
    upsertDraft(
      pendingAnswerKey,
      pendingAnswerStoreSchema,
      pending,
      (candidate) =>
        sameInterview(candidate, interview) &&
        candidate.questionId === questionId,
    );
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
      queryClient.setQueryData(queryKey, interviewRead(response.interview));
    } catch {
      setActionError(t("interview.error.finish"));
    } finally {
      setAction(null);
    }
  }
  async function approveDisclosure() {
    const pending = pendingDisclosure;
    if (!pending || action) return;
    setAction(pending.resume.kind);
    setActionError(null);
    setDisclosureError(null);
    try {
      const acknowledgement = disclosureMutationResponseSchema.parse(
        await api(
          `/ai/disclosures/${encodeURIComponent(pending.disclosure.operationId)}/approve`,
          {
            method: "POST",
            body: "{}",
          },
        ),
      );
      if (
        acknowledgement.disclosure.operationId !==
          pending.disclosure.operationId ||
        acknowledgement.disclosure.status !== "approved"
      ) {
        throw new Error("Interview disclosure approval mismatch");
      }
      disclosureRecoveryRef.current = pendingDisclosurePath(
        pending.continuation,
      );
      setPendingDisclosure(null);
      setAction(null);
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
    } catch {
      setDisclosureError(t("interview.error.disclosureApprove"));
      setAction(null);
    }
  }

  async function cancelDisclosure() {
    const pending = pendingDisclosure;
    if (!pending || action) return;
    setAction(pending.resume.kind);
    setActionError(null);
    setDisclosureError(null);
    try {
      const acknowledgement = disclosureMutationResponseSchema.parse(
        await api(
          `/ai/disclosures/${encodeURIComponent(pending.disclosure.operationId)}/cancel`,
          {
            method: "POST",
            body: "{}",
          },
        ),
      );
      if (
        acknowledgement.disclosure.operationId !==
          pending.disclosure.operationId ||
        acknowledgement.disclosure.status !== "cancelled"
      ) {
        throw new Error("Interview disclosure cancellation mismatch");
      }
      if (pending.resume.kind === "start") {
        const abandoned = abandonResponseSchema.parse(
          await api(
            `/interviews/v2/${encodeURIComponent(pending.continuation.interviewId)}/abandon`,
            {
              method: "POST",
              body: JSON.stringify({
                operationId: pending.resume.draft.operationId,
              }),
            },
          ),
        );
        if (
          abandoned.abandoned.interviewId !==
            pending.continuation.interviewId ||
          abandoned.abandoned.operationId !== pending.resume.draft.operationId
        ) {
          throw new Error("Interview abandonment mismatch");
        }
      }
      disclosureRecoveryRef.current = pendingDisclosurePath(
        pending.continuation,
      );
      setPendingDisclosure(null);
      setActionError(t("interview.error.disclosureCanceled"));
      void interviewQuery.refetch();
    } catch {
      setDisclosureError(t("interview.error.disclosureCancel"));
    } finally {
      setAction(null);
    }
  }

  function startNewInterview() {
    removeStorage(latestInterviewKey);
    removeDrafts(startDraftKey, startRetryStoreSchema, (candidate) =>
      sameLearningSession(candidate, validatedLearningSessionId),
    );
    removeDrafts(setupDraftKey, setupDraftStoreSchema, (candidate) =>
      sameLearningSession(candidate, validatedLearningSessionId),
    );
    if (interview) {
      removeDrafts(pendingAnswerKey, pendingAnswerStoreSchema, (candidate) =>
        sameInterview(candidate, interview),
      );
      removeDrafts(answerDraftKey, answerDraftStoreSchema, (candidate) =>
        sameInterview(candidate, interview),
      );
    }
    setAnswer("");
    setActionError(null);
    queryClient.setQueryData(queryKey, {
      learningSessionId: requestedLearningSessionId
        ? validatedLearningSessionId
        : null,
      interview: null,
    } satisfies InterviewRead);
  }

  const returnToSession = returnLearningSessionId ? (
    <Button asChild variant="outline" className="self-start">
      <Link href={`/session?id=${encodeURIComponent(returnLearningSessionId)}`}>
        <ArrowLeftIcon data-icon="inline-start" aria-hidden />
        {t("interview.returnToSession")}
      </Link>
    </Button>
  ) : null;
  const disclosureDialog = (
    <AlertDialog
      open={pendingDisclosure !== null}
      onOpenChange={(open) => {
        if (!open && pendingDisclosure) {
          void cancelDisclosure();
        }
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("interview.disclosure.title")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("interview.disclosure.description")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {pendingDisclosure ? (
          <dl className="grid gap-3 rounded-panel border border-border/60 bg-surface-soft p-4 text-sm">
            <div>
              <dt className="font-medium">
                {t("interview.disclosure.recipient")}
              </dt>
              <dd className="min-w-0 text-muted-foreground [overflow-wrap:anywhere]">
                {pendingDisclosure.disclosure.scope.destination}
              </dd>
            </div>
            <div>
              <dt className="font-medium">{t("interview.disclosure.data")}</dt>
              <dd className="min-w-0 text-muted-foreground [overflow-wrap:anywhere]">
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
              <dd className="min-w-0 text-muted-foreground [overflow-wrap:anywhere]">
                {pendingDisclosure.disclosure.scope.exclusions.join(", ")}
              </dd>
            </div>
          </dl>
        ) : null}
        {disclosureError ? (
          <Alert variant="destructive">
            <WarningCircleIcon aria-hidden />
            <AlertDescription>{disclosureError}</AlertDescription>
          </Alert>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={action !== null}>
            {t("interview.disclosure.decline")}
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={action !== null}
            onClick={(event) => {
              event.preventDefault();
              void approveDisclosure();
            }}
          >
            {t("interview.disclosure.approve")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
  const readinessRecovery = aiReadiness.ready ? null : (
    <Alert
      data-slot="interview-ai-recovery"
      role="status"
      variant="warning"
      className="min-w-0"
    >
      <WarningCircleIcon aria-hidden />
      <AlertTitle>
        {aiReadiness.kind === "checking"
          ? t("provider.checking")
          : aiReadiness.kind === "off"
            ? t("provider.off")
            : aiReadiness.kind === "unavailable" && settingsQuery.isError
              ? t("provider.statusUnavailable")
              : t("provider.needsAttention")}
      </AlertTitle>
      <AlertDescription className="sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-4">
        {aiReadiness.kind !== "checking" ? (
          <span>{t("chat.composer.unavailablePlaceholder")}</span>
        ) : (
          <span>{t("provider.checking")}</span>
        )}
        {settingsQuery.isError ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-2 justify-self-start sm:mt-0 sm:shrink-0"
            onClick={() => void settingsQuery.refetch()}
          >
            <ArrowClockwiseIcon data-icon="inline-start" aria-hidden />
            {t("query.retry")}
          </Button>
        ) : aiReadiness.kind !== "checking" ? (
          <Button
            asChild
            variant="outline"
            size="sm"
            className="mt-2 justify-self-start sm:mt-0 sm:shrink-0"
          >
            <Link href={`/settings?section=${aiReadiness.recoverySection}`}>
              {t("chat.composer.configureAi")}
            </Link>
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  );

  if (interviewQuery.isLoading) {
    if (embedded) {
      return <LoadingState label="interview.loading" variant="page" />;
    }
    return (
      <RouteOrientation
        slot="interview-loading"
        title="interview.title"
        description="page.interview.description"
      >
        <LoadingState label="interview.loading" variant="page" />
      </RouteOrientation>
    );
  }

  if (interviewQuery.error) {
    const message =
      interviewQuery.error instanceof InterviewReadError
        ? t(interviewReadErrorKeys[interviewQuery.error.code])
        : t("interview.error.load");
    const errorState = (
      <QueryError
        message={message}
        retry={() => void interviewQuery.refetch()}
      />
    );
    if (embedded) return errorState;
    return (
      <RouteOrientation
        slot="interview-error"
        title="interview.title"
        description="page.interview.description"
      >
        {errorState}
      </RouteOrientation>
    );
  }

  if (!interview) {
    return (
      <div
        data-slot="interview-setup"
        className="flex w-full min-w-0 flex-col gap-6"
      >
        {returnToSession}
        <InterviewHeader
          embedded={embedded}
          title={t("interview.title")}
          description={t("interview.setup.description")}
        />
        <section
          className="w-full min-w-0 rounded-panel bg-surface-soft/35 p-4 sm:p-6"
          aria-labelledby="interview-setup-title"
        >
          <div className="pb-5">
            <DetailHeading
              id="interview-setup-title"
              className="text-xl font-semibold tracking-[-0.02em]"
            >
              {t("interview.setup.title")}
            </DetailHeading>
            <p className="mt-1 max-w-[68ch] text-sm leading-6 text-muted-foreground">
              {t("interview.setup.help")}
            </p>
          </div>

          <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.65fr)] lg:gap-8">
            <div className="min-w-0">
              <FieldSet disabled={action !== null}>
                <FieldLegend>{t("interview.setup.scope")}</FieldLegend>
                <RadioGroup
                  value={scopeMode}
                  disabled={action !== null}
                  className="gap-0 overflow-hidden rounded-control border border-border"
                  onValueChange={(value) => {
                    if (isScopeMode(value)) setScopeMode(value);
                  }}
                >
                  {scopeOptions.map((option) => (
                    <Field
                      key={option.value}
                      orientation="horizontal"
                      className="items-start border-b border-border px-4 py-3 last:border-b-0 hover:bg-muted/35 has-[[data-state=checked]]:bg-muted/50"
                    >
                      <RadioGroupItem
                        id={`interview-scope-${option.value}`}
                        value={option.value}
                        className="mt-0.5"
                      />
                      <FieldContent className="min-w-0">
                        <FieldLabel
                          htmlFor={`interview-scope-${option.value}`}
                          className="cursor-pointer"
                        >
                          {t(option.label)}
                        </FieldLabel>
                        <FieldDescription className="[overflow-wrap:anywhere]">
                          {t(option.description)}
                        </FieldDescription>
                      </FieldContent>
                    </Field>
                  ))}
                </RadioGroup>

                {scopeMode === "manual" ? (
                  <Field>
                    <FieldLabel htmlFor="interview-manual-topics">
                      {t("interview.setup.manualTopics")}
                    </FieldLabel>
                    <Input
                      id="interview-manual-topics"
                      value={topicsInput}
                      onChange={(event) => setTopicsInput(event.target.value)}
                      placeholder="JavaScript, TypeScript"
                      maxLength={1450}
                      disabled={action !== null}
                    />
                  </Field>
                ) : (
                  <Field>
                    <FieldTitle>{t("interview.setup.topics")}</FieldTitle>
                    {selectedTopics.length > 0 ? (
                      <div
                        aria-label={t("interview.setup.selectedTopicsAria")}
                        className="flex min-w-0 flex-wrap gap-2"
                      >
                        {selectedTopics.map((topic) => (
                          <Badge
                            key={topic}
                            variant="secondary"
                            className="max-w-full min-w-0 whitespace-normal text-left [overflow-wrap:anywhere]"
                          >
                            {topic}
                          </Badge>
                        ))}
                      </div>
                    ) : pathQuery.isLoading ? (
                      <p
                        role="status"
                        className="text-sm text-muted-foreground"
                      >
                        {t("interview.setup.loadingTopics")}
                      </p>
                    ) : pathQuery.isError ? (
                      <Alert variant="warning">
                        <WarningCircleIcon aria-hidden />
                        <AlertDescription className="sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-4">
                          <span>{t("interview.setup.topicsLoadError")}</span>
                          <span className="mt-2 flex flex-wrap gap-2 sm:mt-0">
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
                          </span>
                        </AlertDescription>
                      </Alert>
                    ) : scopeMode === "studied" ? (
                      <div className="flex min-w-0 flex-col gap-3 rounded-control bg-background/75 p-4">
                        <p className="text-sm leading-6 text-muted-foreground">
                          {t("interview.setup.noStudiedTopics")}
                        </p>
                        <Button
                          variant="outline"
                          className="max-w-full self-start whitespace-normal"
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
                  </Field>
                )}
              </FieldSet>
            </div>

            <aside className="min-w-0 rounded-control bg-background/75 p-4 sm:p-5">
              <FieldGroup className="gap-5">
                <Field>
                  <FieldLabel htmlFor="interview-difficulty">
                    {t("interview.setup.difficulty")}
                  </FieldLabel>
                  <Select
                    value={difficulty}
                    disabled={action !== null}
                    onValueChange={(value) =>
                      setDifficulty(difficultySchema.parse(value))
                    }
                  >
                    <SelectTrigger id="interview-difficulty" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent align="start">
                      <SelectGroup>
                        <SelectItem value="foundation">
                          {t("interview.setup.difficulty.foundation")}
                        </SelectItem>
                        <SelectItem value="interview-ready">
                          {t("interview.setup.difficulty.interviewReady")}
                        </SelectItem>
                        <SelectItem value="deep-dive">
                          {t("interview.setup.difficulty.deepDive")}
                        </SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel htmlFor="interview-question-count">
                    {t("interview.setup.questionCount")}
                  </FieldLabel>
                  <Select
                    value={String(questionCount)}
                    disabled={action !== null}
                    onValueChange={(value) => setQuestionCount(Number(value))}
                  >
                    <SelectTrigger
                      id="interview-question-count"
                      className="w-full"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent align="start">
                      <SelectGroup>
                        {[1, 2, 3, 4, 5, 6, 8, 10, 12].map((count) => (
                          <SelectItem key={count} value={String(count)}>
                            {count}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
              </FieldGroup>
              <div className="mt-6 flex min-w-0 flex-col gap-2 rounded-control bg-surface-soft p-4 text-sm leading-6 text-muted-foreground">
                <p>
                  {t("interview.setup.durationEstimate", {
                    duration: formatMinutesShort(questionCount * 5, locale),
                    count: questionCount,
                  })}
                </p>
                <p>{t("interview.setup.reportLimit")}</p>
              </div>
            </aside>
          </div>

          {actionError ? (
            <Alert variant="destructive" className="mt-5">
              <WarningCircleIcon aria-hidden />
              <AlertDescription className="[overflow-wrap:anywhere]">
                {actionError}
              </AlertDescription>
            </Alert>
          ) : null}
          {readinessRecovery ? (
            <div className="mt-5">{readinessRecovery}</div>
          ) : null}
          <footer className="flex justify-stretch pt-5 sm:justify-end">
            <Button
              className="w-full max-w-full whitespace-normal sm:w-auto"
              onClick={() => void startInterview()}
              disabled={action !== null || !aiReadiness.ready}
            >
              {action === "start" ? (
                <>
                  <Spinner />
                  {t("interview.setup.starting")}
                </>
              ) : (
                <>
                  <ChatCircleDotsIcon data-icon="inline-start" aria-hidden />
                  {t("interview.setup.start")}
                </>
              )}
            </Button>
          </footer>
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
        embedded={embedded}
      />
    );
  }

  if (interview.status === "setup") {
    const draft =
      readDraftStore(startDraftKey, startRetryStoreSchema).findLast(
        (candidate) =>
          sameLearningSession(candidate, interview.learningSessionId),
      )?.draft ?? null;
    return (
      <div
        data-slot="interview-opening-retry"
        className="flex w-full min-w-0 flex-col gap-6"
      >
        {returnToSession}
        <InterviewHeader
          embedded={embedded}
          title={t("interview.title")}
          description={t("interview.opening.description")}
          actions={
            <Badge variant="warning">{t("interview.opening.status")}</Badge>
          }
        />
        <section className="w-full rounded-panel bg-surface-soft/35 p-5 sm:p-6">
          <DetailHeading className="text-xl font-semibold tracking-[-0.02em]">
            {t("interview.opening.errorTitle")}
          </DetailHeading>
          <p className="mt-2 max-w-[68ch] text-sm leading-6 text-muted-foreground [overflow-wrap:anywhere]">
            {t("interview.opening.retryDescription", {
              topics: interview.setup.topics.join(", "),
            })}
          </p>
          {actionError ? (
            <Alert variant="destructive" className="mt-4">
              <WarningCircleIcon aria-hidden />
              <AlertDescription className="[overflow-wrap:anywhere]">
                {actionError}
              </AlertDescription>
            </Alert>
          ) : null}
          {readinessRecovery ? (
            <div className="mt-4">{readinessRecovery}</div>
          ) : null}
          <Button
            className="mt-5 w-full max-w-full whitespace-normal sm:w-auto"
            onClick={() => draft && void startInterview(draft)}
            disabled={!draft || action !== null || !aiReadiness.ready}
          >
            {action === "start" ? (
              <>
                <Spinner />
                {t("interview.opening.retrying")}
              </>
            ) : (
              <>
                <ArrowClockwiseIcon data-icon="inline-start" aria-hidden />
                {t("interview.opening.retry")}
              </>
            )}
          </Button>
        </section>
        {disclosureDialog}
      </div>
    );
  }

  return (
    <div
      data-slot="interview-session"
      className="flex w-full min-w-0 flex-col gap-6"
    >
      {returnToSession}
      <InterviewHeader
        embedded={embedded}
        title={t("interview.title")}
        description={t("interview.session.description")}
      />
      <div className="w-full min-w-0">
        <InterviewChatView
          interview={interview}
          action={action}
          actionError={actionError}
          answer={answer}
          onAnswerChange={updateAnswerDraft}
          onSend={() => void submitAnswer()}
          onRetry={() => void submitAnswer()}
          onFinish={() => void finishInterview()}
        />
      </div>
      {disclosureDialog}
    </div>
  );
}

function InterviewReportView({
  interview,
  onNew,
  returnToSession,
  embedded,
}: {
  interview: Interview;
  onNew(): void;
  returnToSession?: ReactNode;
  embedded: boolean;
}) {
  const { locale, t } = useI18n();
  const report = interview.report;
  if (!report) return null;
  const completionPercent = new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits: 0,
  }).format(report.metrics.completionRate);
  const DetailHeading = "h2";
  return (
    <div
      data-slot="interview-report"
      className="flex w-full min-w-0 flex-col gap-6"
    >
      {returnToSession}
      <InterviewHeader
        embedded={embedded}
        title={t("interview.report.title")}
        description={t("interview.report.description")}
        actions={
          <Badge variant="success">
            <CheckCircleIcon aria-hidden />
            {t("interview.report.completed")}
          </Badge>
        }
      />
      <article className="flex w-full min-w-0 flex-col gap-3 rounded-panel bg-surface-soft/35 p-3 sm:p-4">
        <section
          data-slot="report-limits"
          aria-label={t("interview.report.limitsAria")}
          className="rounded-control bg-muted/45 px-4 py-3 sm:px-5"
        >
          <p className="max-w-[72ch] text-sm font-medium leading-6 text-muted-foreground">
            {t("interview.report.limits")}
          </p>
        </section>

        <section
          aria-labelledby="report-summary-title"
          className="rounded-control bg-background/70 px-4 py-5 sm:px-5 sm:py-6"
        >
          <DetailHeading
            id="report-summary-title"
            className="text-xl font-semibold tracking-[-0.02em]"
          >
            {t("interview.report.summary")}
          </DetailHeading>
          <Markdown
            baseHeadingLevel={3}
            className={`${markdownContentClassName} mt-3 max-w-[72ch]`}
          >
            {report.summary}
          </Markdown>
        </section>

        <section
          className="grid gap-2 sm:grid-cols-3"
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

        <div className="grid gap-2 lg:grid-cols-2">
          <ReportList
            title={t("interview.report.strengths")}
            items={report.strengths}
            headingLevel={2}
          />
          <ReportList
            title={t("interview.report.growthAreas")}
            items={report.growthAreas}
            headingLevel={2}
          />
        </div>

        <section
          className="rounded-control bg-background/70 px-4 py-5 sm:px-5 sm:py-6"
          aria-labelledby="evidence-title"
        >
          <DetailHeading id="evidence-title" className="font-semibold">
            {t("interview.report.evidence")}
          </DetailHeading>
          <ol className="mt-3 flex flex-col gap-1">
            {report.evidence.map((item) => (
              <li key={`${item.questionNumber}-${item.topic}`}>
                <Collapsible className="group/evidence rounded-control px-3 hover:bg-muted/45">
                  <CollapsibleTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-auto min-h-12 w-full max-w-full justify-between rounded-none px-0 py-3 text-left whitespace-normal"
                    >
                      <span className="flex min-w-0 flex-wrap items-center gap-2">
                        <Badge variant="outline">
                          {t("interview.report.question", {
                            number: item.questionNumber,
                          })}
                        </Badge>
                        <span className="min-w-0 font-medium [overflow-wrap:anywhere]">
                          {item.topic}
                        </span>
                      </span>
                      <CaretDownIcon
                        aria-hidden
                        className="shrink-0 transition-transform group-data-[state=open]/evidence:rotate-180 motion-reduce:transition-none"
                      />
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="min-w-0 pb-5">
                    <blockquote className="[overflow-wrap:anywhere] text-sm leading-6 text-muted-foreground">
                      {t("interview.report.answerExcerpt", {
                        excerpt: item.answerExcerpt,
                      })}
                    </blockquote>
                    <Markdown
                      baseHeadingLevel={3}
                      className={`${markdownContentClassName} mt-2`}
                    >
                      {item.observation}
                    </Markdown>
                  </CollapsibleContent>
                </Collapsible>
              </li>
            ))}
          </ol>
        </section>

        <footer className="flex flex-col gap-4 rounded-control bg-background/70 px-4 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div className="min-w-0">
            <p className="font-semibold">{t("interview.report.nextTitle")}</p>
            <p className="mt-1 max-w-[56ch] text-sm leading-6 text-muted-foreground">
              {t("interview.report.nextDescription")}
            </p>
          </div>
          <Button
            className="w-full max-w-full whitespace-normal sm:w-auto sm:shrink-0"
            onClick={onNew}
          >
            <ArrowClockwiseIcon data-icon="inline-start" aria-hidden />
            {t("interview.report.new")}
          </Button>
        </footer>
      </article>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-control bg-background/70 px-4 py-4 sm:px-5">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function ReportList({
  title,
  items,
  headingLevel,
}: {
  title: string;
  items: string[];
  headingLevel: 2 | 3;
}) {
  const Heading = headingLevel === 3 ? "h3" : "h2";
  return (
    <section className="rounded-control bg-background/70 px-4 py-5 sm:px-5 sm:py-6">
      <Heading className="text-lg font-semibold">{title}</Heading>
      <ul className="mt-4 flex flex-col gap-3 text-sm leading-6 text-muted-foreground">
        {items.map((item) => (
          <li key={item} className="flex gap-2">
            <span
              aria-hidden
              className="mt-2 size-1.5 shrink-0 rounded-full bg-muted-foreground"
            />
            <Markdown baseHeadingLevel={3} className={markdownContentClassName}>
              {item}
            </Markdown>
          </li>
        ))}
      </ul>
    </section>
  );
}
