"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowSquareOutIcon,
  CaretDownIcon,
  CheckCircleIcon,
  ClipboardTextIcon,
  CodeIcon,
  CopyIcon,
  FlaskIcon,
  LockKeyIcon,
  PlayIcon,
  StopIcon,
} from "@phosphor-icons/react";
import { z } from "zod";

import { api } from "@/lib/api";
import { presentFailure, SafeUiError } from "@/lib/failure-presentation";
import { useI18n } from "@/lib/i18n";
import type { RouteContext } from "@/lib/route-context";
import { formatMinutesShort } from "@/lib/time";
import { usePageRouteContext } from "@/components/page-route-context";
import { RouteOrientation } from "@/components/route-orientation";
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { PageHeader } from "@/components/page-header";
import { EmptyState, SafeQueryError } from "@/components/query-state";
import { LoadingState } from "@/components/ui/loading-state";
import { Separator } from "@/components/ui/separator";

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
      "timed_out",
      "resource_limit",
      "unsupported_environment",
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
    completionEligible: z.boolean(),
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
    lessonContext: z
      .object({
        courseId: idSchema,
        revisionId: idSchema,
        courseTitle: z.string().trim().min(1),
        lessonOrder: z.number().int().positive(),
        lessonTitle: z.string().trim().min(1),
      })
      .strict()
      .nullable()
      .default(null),
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
type Exercise = z.infer<typeof exerciseSchema>;
type OwnedValue<T> = { ownerKey: string; value: T };
type AbortableOperation = {
  controller: AbortController;
  ownerKey: string;
  token: symbol;
};

class StoppedExerciseOperationError extends DOMException {
  constructor(readonly operation: AbortableOperation) {
    super("Exercise operation stopped", "AbortError");
  }
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

function throwIfStopped(operation: AbortableOperation): void {
  if (operation.controller.signal.aborted) {
    throw new StoppedExerciseOperationError(operation);
  }
}

function normalizeOperationError(
  error: unknown,
  operation: AbortableOperation,
): never {
  if (operation.controller.signal.aborted || isAbortError(error)) {
    throw new StoppedExerciseOperationError(operation);
  }
  throw error;
}

function ownsOperation(
  current: AbortableOperation | null,
  operation: AbortableOperation,
): boolean {
  return (
    current?.token === operation.token &&
    current.ownerKey === operation.ownerKey
  );
}

function exerciseOwnerKey(exercise: Exercise): string {
  return [
    exercise.sessionId,
    exercise.id,
    exercise.attempt?.id ?? "no-attempt",
  ].join("\u0000");
}

function assertNoProtectedFields(value: unknown, errorMessage: string): void {
  if (Array.isArray(value)) {
    value.forEach((nested) => assertNoProtectedFields(nested, errorMessage));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    if (protectedKeys.has(key)) {
      throw new SafeUiError(errorMessage);
    }
    assertNoProtectedFields(nested, errorMessage);
  }
}

function parseSafe<T>(
  schema: z.ZodType<T>,
  value: unknown,
  protectedFieldError: string,
): T {
  assertNoProtectedFields(value, protectedFieldError);
  return schema.parse(value);
}

async function resolveSessionId(
  requestedSessionId: string | null,
  noActiveSessionError: string,
  protectedFieldError: string,
) {
  if (requestedSessionId) return requestedSessionId;
  const value = await api<unknown>("/learning/sessions/current");
  assertNoProtectedFields(value, protectedFieldError);
  const envelope = z
    .object({ session: z.object({ id: idSchema }).loose().nullable() })
    .strict()
    .parse(value);
  if (!envelope.session) throw new Error(noActiveSessionError);
  return envelope.session.id;
}

export function ExerciseClient() {
  const params = useSearchParams();
  const requestedSessionId = params.get("sessionId");
  const router = useRouter();
  const queryClient = useQueryClient();
  const { locale, t } = useI18n();
  const protectedFieldError = t("practice.error.protectedField");
  const [localDiff, setLocalDiff] = useState<OwnedValue<Diff> | null>(null);
  const [localTest, setLocalTest] = useState<OwnedValue<TestRun> | null>(null);
  const [localReview, setLocalReview] =
    useState<OwnedValue<Review | null> | null>(null);
  const [zedFallback, setZedFallback] = useState<string | null>(null);
  const [workspaceNotice, setWorkspaceNotice] = useState<string | null>(null);
  const [pendingReviewDisclosure, setPendingReviewDisclosure] =
    useState<OwnedValue<PendingReviewDisclosure> | null>(null);
  const checksOperationRef = useRef<AbortableOperation | null>(null);
  const reviewOperationRef = useRef<AbortableOperation | null>(null);
  const pendingReviewDisclosureRef =
    useRef<OwnedValue<PendingReviewDisclosure> | null>(null);
  pendingReviewDisclosureRef.current = pendingReviewDisclosure;

  useEffect(
    () => () => {
      checksOperationRef.current?.controller.abort();
      reviewOperationRef.current?.controller.abort();
      const pending = pendingReviewDisclosureRef.current;
      if (pending) {
        void api(`/ai/disclosures/${pending.value.disclosure.operationId}`, {
          method: "DELETE",
        }).catch(() => undefined);
      }
    },
    [],
  );

  const query = useQuery({
    queryKey: ["exercise", requestedSessionId ?? "current"],
    queryFn: async () => {
      const sessionId = await resolveSessionId(
        requestedSessionId,
        t("practice.error.noActiveSession"),
        protectedFieldError,
      );
      const value = await api<unknown>(
        `/exercises/current?sessionId=${encodeURIComponent(sessionId)}`,
      );
      return parseSafe(exerciseSchema, value, protectedFieldError);
    },
  });
  const resolvedOwnerKey = query.data ? exerciseOwnerKey(query.data) : null;
  const currentOwnerKeyRef = useRef<string | null>(resolvedOwnerKey);
  currentOwnerKeyRef.current = resolvedOwnerKey;

  useLayoutEffect(() => {
    if (
      checksOperationRef.current &&
      checksOperationRef.current.ownerKey !== resolvedOwnerKey
    ) {
      checksOperationRef.current.controller.abort();
    }
    if (
      reviewOperationRef.current &&
      reviewOperationRef.current.ownerKey !== resolvedOwnerKey
    ) {
      reviewOperationRef.current.controller.abort();
    }
    const pending = pendingReviewDisclosureRef.current;
    if (pending && pending.ownerKey !== resolvedOwnerKey) {
      void api(`/ai/disclosures/${pending.value.disclosure.operationId}`, {
        method: "DELETE",
      }).catch(() => undefined);
    }
    setLocalDiff((current) =>
      current?.ownerKey === resolvedOwnerKey ? current : null,
    );
    setLocalTest((current) =>
      current?.ownerKey === resolvedOwnerKey ? current : null,
    );
    setLocalReview((current) =>
      current?.ownerKey === resolvedOwnerKey ? current : null,
    );
    setPendingReviewDisclosure((current) =>
      current?.ownerKey === resolvedOwnerKey ? current : null,
    );
    setZedFallback(null);
    setWorkspaceNotice(null);
  }, [resolvedOwnerKey]);

  const getAttemptContext = () => {
    const exercise = query.data;
    const attemptId = exercise?.attempt?.id;
    if (!exercise || !attemptId) {
      throw new SafeUiError(t("practice.error.attemptRequired"));
    }
    return {
      attemptId,
      exercise,
      ownerKey: exerciseOwnerKey(exercise),
    };
  };

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
      if (!exercise)
        throw new SafeUiError(t("practice.error.exerciseNotLoaded"));
      const ownerKey = exerciseOwnerKey(exercise);
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
      return {
        attempt: parseSafe(attemptResponseSchema, value, protectedFieldError),
        ownerKey,
      };
    },
    onSuccess: async ({ ownerKey }) => {
      if (currentOwnerKeyRef.current === ownerKey) {
        setLocalDiff(null);
        setLocalTest(null);
        setLocalReview(null);
        setPendingReviewDisclosure(null);
      }
      await invalidatePractice();
    },
  });

  const loadDiff = useMutation({
    mutationFn: async () => {
      const { attemptId, ownerKey } = getAttemptContext();
      const value = await api<unknown>(
        `/exercise-attempts/${encodeURIComponent(attemptId)}/diff`,
      );
      const parsed = parseSafe(diffResponseSchema, value, protectedFieldError);
      return {
        diff: {
          patch: parsed.diff,
          changed: parsed.changed,
          truncated: parsed.truncated,
        } satisfies Diff,
        ownerKey,
      };
    },
    onSuccess: ({ diff: nextDiff, ownerKey }) => {
      if (currentOwnerKeyRef.current !== ownerKey) return;
      const ownedDiff =
        localDiff?.ownerKey === ownerKey ? localDiff.value : null;
      const previousPatch =
        ownedDiff?.patch ?? query.data?.attempt?.diff.patch ?? "";
      if (previousPatch !== nextDiff.patch) {
        const ownedTest =
          localTest?.ownerKey === ownerKey ? localTest.value : null;
        const currentTest = ownedTest ?? query.data?.attempt?.latestTestRun;
        setLocalTest(
          currentTest
            ? {
                ownerKey,
                value: { ...currentTest, workspaceCurrent: false },
              }
            : null,
        );
        setLocalReview({ ownerKey, value: null });
      }
      setLocalDiff({ ownerKey, value: nextDiff });
    },
  });

  const runTests = useMutation({
    mutationFn: async () => {
      const { attemptId, ownerKey } = getAttemptContext();
      const operation = {
        controller: new AbortController(),
        ownerKey,
        token: Symbol("exercise-check"),
      } satisfies AbortableOperation;
      checksOperationRef.current?.controller.abort();
      checksOperationRef.current = operation;
      const testValue = await api<unknown>(
        `/exercise-attempts/${encodeURIComponent(attemptId)}/checks`,
        {
          method: "POST",
          signal: operation.controller.signal,
          body: JSON.stringify({
            operationId: crypto.randomUUID(),
            checkIds: ["apt.compat.node24.npm-test.v1"],
          }),
        },
      ).catch((error: unknown) => normalizeOperationError(error, operation));
      throwIfStopped(operation);
      const test = parseSafe(
        checkResponseSchema,
        testValue,
        protectedFieldError,
      );
      const diffValue = await api<unknown>(
        `/exercise-attempts/${encodeURIComponent(attemptId)}/diff`,
        { signal: operation.controller.signal },
      ).catch((error: unknown) => normalizeOperationError(error, operation));
      throwIfStopped(operation);
      const parsedDiff = parseSafe(
        diffResponseSchema,
        diffValue,
        protectedFieldError,
      );
      return {
        ownerKey,
        operation,
        test: { ...test, workspaceCurrent: true } satisfies TestRun,
        diff: {
          patch: parsedDiff.diff,
          changed: parsedDiff.changed,
          truncated: parsedDiff.truncated,
        } satisfies Diff,
      };
    },
    onSuccess: async ({ diff, operation, ownerKey, test }) => {
      if (!ownsOperation(checksOperationRef.current, operation)) return;
      if (currentOwnerKeyRef.current === ownerKey) {
        setLocalDiff({ ownerKey, value: diff });
        setLocalTest({ ownerKey, value: test });
        setLocalReview({ ownerKey, value: null });
      }
      await invalidatePractice();
    },
    onError: (error) => {
      const operation =
        error instanceof StoppedExerciseOperationError
          ? error.operation
          : checksOperationRef.current;
      if (
        isAbortError(error) &&
        operation !== null &&
        ownsOperation(checksOperationRef.current, operation) &&
        currentOwnerKeyRef.current === operation.ownerKey
      ) {
        setWorkspaceNotice(t("practice.operation.stopped"));
      }
    },
    onSettled: (data, error) => {
      const operation =
        data?.operation ??
        (error instanceof StoppedExerciseOperationError
          ? error.operation
          : undefined);
      if (operation && ownsOperation(checksOperationRef.current, operation)) {
        checksOperationRef.current = null;
      }
    },
  });

  const runReview = useMutation({
    mutationFn: async (input?: {
      reviewOperationId: string;
      disclosureOperationId: string;
    }) => {
      const { attemptId, ownerKey } = getAttemptContext();
      const operation = {
        controller: new AbortController(),
        ownerKey,
        token: Symbol("exercise-review"),
      } satisfies AbortableOperation;
      reviewOperationRef.current?.controller.abort();
      reviewOperationRef.current = operation;
      const currentDiffValue = await api<unknown>(
        `/exercise-attempts/${encodeURIComponent(attemptId)}/diff`,
        { signal: operation.controller.signal },
      ).catch((error: unknown) => normalizeOperationError(error, operation));
      throwIfStopped(operation);
      const currentDiff = parseSafe(
        diffResponseSchema,
        currentDiffValue,
        protectedFieldError,
      );
      const visiblePatch =
        (localDiff?.ownerKey === ownerKey ? localDiff.value.patch : null) ??
        query.data?.attempt?.diff.patch ??
        "";
      if (currentDiff.diff !== visiblePatch) {
        throw new SafeUiError(t("practice.error.diffChanged"));
      }
      const reviewOperationId = input?.reviewOperationId ?? crypto.randomUUID();
      const value = await api<unknown>(
        `/exercise-attempts/${encodeURIComponent(attemptId)}/reviews`,
        {
          method: "POST",
          signal: operation.controller.signal,
          body: JSON.stringify({
            operationId: reviewOperationId,
            ...(input
              ? { disclosureOperationId: input.disclosureOperationId }
              : { previewDisclosure: true }),
          }),
        },
      ).catch((error: unknown) => normalizeOperationError(error, operation));
      throwIfStopped(operation);
      const disclosure = disclosureResponseSchema.safeParse(value);
      if (disclosure.success) {
        return {
          kind: "disclosure" as const,
          ownerKey,
          operation,
          reviewOperationId,
          disclosure: disclosure.data.disclosure,
        };
      }
      const parsed = parseSafe(
        reviewResponseSchema,
        value,
        protectedFieldError,
      );
      return {
        kind: "review" as const,
        ownerKey,
        operation,
        review: reviewSchema.parse({
          id: parsed.id,
          status: parsed.status,
          completionEligible: parsed.completionEligible,
          summary: parsed.summary,
          findings: parsed.findings,
          strengths: parsed.strengths,
          evidenceBundle: parsed.evidenceBundle,
        }),
      };
    },
    onSuccess: async (result) => {
      if (!ownsOperation(reviewOperationRef.current, result.operation)) return;
      if (result.kind === "disclosure") {
        if (currentOwnerKeyRef.current === result.ownerKey) {
          setPendingReviewDisclosure({
            ownerKey: result.ownerKey,
            value: {
              reviewOperationId: result.reviewOperationId,
              disclosure: result.disclosure,
            },
          });
        }
        return;
      }
      if (currentOwnerKeyRef.current === result.ownerKey) {
        setLocalReview({ ownerKey: result.ownerKey, value: result.review });
      }
      await invalidatePractice();
    },
    onError: (error) => {
      const operation =
        error instanceof StoppedExerciseOperationError
          ? error.operation
          : reviewOperationRef.current;
      if (
        isAbortError(error) &&
        operation !== null &&
        ownsOperation(reviewOperationRef.current, operation) &&
        currentOwnerKeyRef.current === operation.ownerKey
      ) {
        setWorkspaceNotice(t("practice.operation.stopped"));
      }
    },
    onSettled: (data, error) => {
      const operation =
        data?.operation ??
        (error instanceof StoppedExerciseOperationError
          ? error.operation
          : undefined);
      if (operation && ownsOperation(reviewOperationRef.current, operation)) {
        reviewOperationRef.current = null;
      }
    },
  });

  const openZed = useMutation({
    mutationFn: async () => {
      const { attemptId, ownerKey } = getAttemptContext();
      const value = await api<unknown>(
        `/exercise-attempts/${encodeURIComponent(attemptId)}/open`,
        { method: "POST" },
      );
      return {
        ownerKey,
        result: parseSafe(openResponseSchema, value, protectedFieldError),
      };
    },
    onSuccess: ({ ownerKey, result }) => {
      if (currentOwnerKeyRef.current !== ownerKey) return;
      setZedFallback(
        result.opened
          ? null
          : (result.message ?? t("practice.error.zedUnavailable")),
      );
    },
  });

  const acceptReview = useMutation({
    mutationFn: async () => {
      const exercise = query.data;
      const attemptId = exercise?.attempt?.id;
      const exerciseUnitId = exercise?.exerciseUnitId;
      const reviewUnitId = exercise?.reviewUnitId;
      const ownerKey = exercise ? exerciseOwnerKey(exercise) : null;
      const ownedReview =
        ownerKey && localReview?.ownerKey === ownerKey
          ? localReview.value
          : undefined;
      const ownedTest =
        ownerKey && localTest?.ownerKey === ownerKey
          ? localTest.value
          : undefined;
      const review =
        ownedReview !== undefined
          ? ownedReview
          : exercise?.attempt?.latestReview;
      const test = ownedTest ?? exercise?.attempt?.latestTestRun;
      if (
        !exercise ||
        !attemptId ||
        !exerciseUnitId ||
        !reviewUnitId ||
        !review ||
        !review.completionEligible ||
        !test ||
        test.status !== "passed" ||
        !test.workspaceCurrent
      ) {
        throw new SafeUiError(
          t("practice.error.completionEvidenceUnavailable"),
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

  const lessonContext = query.data?.lessonContext ?? null;
  const pageRouteContext = useMemo<RouteContext | null>(
    () =>
      lessonContext
        ? {
            sectionHref: "/courses",
            breadcrumbs: [
              { href: "/courses", label: "nav.courses" },
              {
                href: `/courses/${encodeURIComponent(lessonContext.courseId)}/revisions/${encodeURIComponent(lessonContext.revisionId)}`,
                text: lessonContext.courseTitle,
              },
              {
                href: `/session?id=${encodeURIComponent(query.data?.sessionId ?? "")}`,
                text: t("session.lessonTitle", {
                  order: lessonContext.lessonOrder,
                  title: lessonContext.lessonTitle,
                }),
              },
              { label: "unit.type.exercise" },
            ],
          }
        : null,
    [lessonContext, query.data?.sessionId, t],
  );
  usePageRouteContext(pageRouteContext);

  if (query.isLoading) {
    return (
      <RouteOrientation
        slot="exercise-loading"
        title="unit.type.exercise"
        description="page.exercise.description"
      >
        <LoadingState label="practice.loading" variant="page" />
      </RouteOrientation>
    );
  }
  if (query.isError || !query.data) {
    return (
      <RouteOrientation
        slot="exercise-error"
        title="unit.type.exercise"
        description="page.exercise.description"
      >
        <SafeQueryError
          error={query.error}
          operation="exercise.load"
          retry={() => void query.refetch()}
        />
      </RouteOrientation>
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
          title={t("practice.locked.title")}
          description={t("practice.locked.description")}
        />
        <EmptyState
          title={t("practice.locked.emptyTitle")}
          description={t("practice.locked.emptyDescription")}
          action={
            <Button
              className="h-auto max-w-full whitespace-normal break-words py-2 text-center"
              type="button"
              onClick={() =>
                router.push(
                  `/session?id=${encodeURIComponent(exercise.sessionId)}`,
                )
              }
            >
              <LockKeyIcon aria-hidden />
              {t("practice.backToLesson")}
            </Button>
          }
        />
      </div>
    );
  }
  const ownerKey = exerciseOwnerKey(exercise);
  const attemptId = exercise.attempt?.id;
  const ownedDiff =
    localDiff?.ownerKey === ownerKey ? localDiff.value : undefined;
  const ownedTest =
    localTest?.ownerKey === ownerKey ? localTest.value : undefined;
  const ownedReview =
    localReview?.ownerKey === ownerKey ? localReview.value : undefined;
  const activePendingReviewDisclosure =
    pendingReviewDisclosure?.ownerKey === ownerKey
      ? pendingReviewDisclosure.value
      : null;
  const diff = ownedDiff ?? exercise.attempt?.diff ?? null;
  const latestTest = ownedTest ?? exercise.attempt?.latestTestRun ?? null;
  const review =
    ownedReview !== undefined
      ? ownedReview
      : (exercise.attempt?.latestReview ?? null);
  const reviewAllowed = Boolean(
    attemptId &&
    diff?.changed &&
    latestTest?.status === "passed" &&
    latestTest.workspaceCurrent &&
    !review,
  );
  const testsCurrent = Boolean(
    latestTest?.status === "passed" && latestTest.workspaceCurrent,
  );
  const latestTestStatusLabel = t(
    latestTest
      ? latestTest.status === "passed" && latestTest.workspaceCurrent
        ? "practice.testRun.status.passed"
        : latestTest.status === "failed"
          ? "practice.testRun.status.failed"
          : latestTest.status === "running"
            ? "practice.testRun.status.running"
            : latestTest.status === "cancelled"
              ? "practice.testRun.status.cancelled"
              : latestTest.status === "timed_out"
                ? "practice.testRun.status.timedOut"
                : latestTest.status === "resource_limit"
                  ? "practice.testRun.status.resourceLimit"
                  : latestTest.status === "unsupported_environment"
                    ? "practice.testRun.status.unsupportedEnvironment"
                    : latestTest.status === "backend_error"
                      ? "practice.testRun.status.backendError"
                      : "practice.testRun.status.stale"
      : "practice.testRun.empty",
  );
  const reviewStatusLabel = t(
    review?.status === "passed"
      ? "practice.reviewer.status.accepted"
      : review
        ? "practice.reviewer.status.changesRequested"
        : "practice.reviewer.status.notRun",
  );
  const currentPracticeAction:
    "attempt" | "diff" | "tests" | "review" | "acceptance" = !attemptId
    ? "attempt"
    : review?.completionEligible
      ? "acceptance"
      : !diff?.changed
        ? "diff"
        : !testsCurrent
          ? "tests"
          : "review";
  const nextAction = t(
    !attemptId
      ? "practice.nextAction.createAttempt"
      : !diff?.changed
        ? "practice.nextAction.editAndRefreshDiff"
        : !latestTest
          ? "practice.nextAction.runTests"
          : latestTest.status !== "passed"
            ? "practice.nextAction.fixAndRetest"
            : !latestTest.workspaceCurrent
              ? "practice.nextAction.retestChangedWorkspace"
              : !review
                ? "practice.nextAction.requestReview"
                : review.completionEligible
                  ? "practice.nextAction.evidenceVerified"
                  : "practice.nextAction.applyFindings",
  );
  const error =
    attempt.error ??
    loadDiff.error ??
    (isAbortError(runTests.error) ? null : runTests.error) ??
    (isAbortError(runReview.error) ? null : runReview.error) ??
    openZed.error ??
    acceptReview.error;

  async function copyWorkspaceId() {
    if (!exercise.workspace) return;
    try {
      await navigator.clipboard.writeText(exercise.workspace.id);
      setWorkspaceNotice(t("practice.workspace.copied"));
    } catch {
      setWorkspaceNotice(t("practice.workspace.copyFailed"));
    }
  }
  async function approveReviewDisclosure() {
    const pending = activePendingReviewDisclosure;
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
      setWorkspaceNotice(presentFailure(error, "exercise.action", t).message);
    }
  }

  async function cancelReviewDisclosure() {
    const pending = activePendingReviewDisclosure;
    if (!pending) return;
    setPendingReviewDisclosure(null);
    await api(`/ai/disclosures/${pending.disclosure.operationId}`, {
      method: "DELETE",
    }).catch(() => undefined);
    setWorkspaceNotice(t("practice.disclosure.cancelled"));
  }

  return (
    <div data-slot="exercise-client" className="flex min-w-0 flex-col gap-8">
      <PageHeader
        title={exercise.title}
        description={exercise.prompt}
        actions={
          <>
            <Badge
              variant="outline"
              className="max-w-full min-w-0 whitespace-normal break-words text-left [overflow-wrap:anywhere]"
            >
              {exercise.difficulty}
            </Badge>
            <Badge
              variant="outline"
              className="max-w-full min-w-0 whitespace-normal break-words text-left [overflow-wrap:anywhere]"
            >
              {t("practice.duration", {
                duration: formatMinutesShort(exercise.estimatedMinutes, locale),
              })}
            </Badge>
          </>
        }
      />

      {error ? (
        <SafeQueryError error={error} operation="exercise.action" />
      ) : null}

      <section
        data-slot="exercise-next-action"
        aria-labelledby="exercise-next-action-title"
        aria-live="polite"
        className="grid gap-2 border-y border-border/70 py-5 sm:grid-cols-[9rem_minmax(0,1fr)] sm:items-baseline sm:gap-6"
      >
        <h2
          id="exercise-next-action-title"
          className="text-sm font-medium text-muted-foreground"
        >
          {t("practice.nextAction.label")}
        </h2>
        <p className="min-w-0 max-w-[68ch] break-words text-pretty text-xl font-semibold leading-7 tracking-[-0.02em] [overflow-wrap:anywhere]">
          {nextAction}
        </p>
      </section>

      <div className="grid min-w-0 gap-8 2xl:grid-cols-[minmax(0,1fr)_20rem]">
        <section
          className="flex min-w-0 flex-col gap-8"
          aria-label={t("practice.work.label")}
        >
          <div
            data-slot="exercise-criteria"
            className="grid border-y border-border/70 md:grid-cols-2 md:divide-x md:divide-border/70"
          >
            <section className="flex flex-col gap-4 py-5 md:pr-8">
              <h2 className="text-lg font-semibold">
                {t("practice.completionCriteria")}
              </h2>
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
                    <span className="min-w-0 break-words">{criterion}</span>
                  </li>
                ))}
              </ul>
            </section>
            <section className="flex flex-col gap-4 border-t border-border/70 py-5 md:border-t-0 md:pl-8">
              <h2 className="text-lg font-semibold">
                {t("practice.constraints")}
              </h2>
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
                    <span className="min-w-0 break-words">{constraint}</span>
                  </li>
                ))}
              </ul>
            </section>
          </div>

          <div
            data-slot="exercise-focus-surface"
            className="overflow-hidden rounded-lg border border-border/80 bg-card"
          >
            <div
              data-slot="exercise-workspace"
              className="flex flex-col gap-4 p-5 sm:p-6"
            >
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <h2 className="font-semibold">
                    {t("practice.workspace.title")}
                  </h2>
                  <p className="mt-1 break-all font-mono text-xs leading-5 text-muted-foreground">
                    {exercise.workspace
                      ? t("practice.workspace.identity", {
                          id: exercise.workspace.id,
                          generation: exercise.workspace.generation,
                        })
                      : t("practice.workspace.pending")}
                  </p>
                </div>
                {attemptId ? (
                  <div className="flex min-w-0 w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap">
                    <Button
                      className="h-auto w-full min-w-0 max-w-full whitespace-normal break-words py-2 text-center sm:w-auto"
                      variant="outline"
                      onClick={copyWorkspaceId}
                    >
                      <CopyIcon data-icon="inline-start" aria-hidden />
                      {t("practice.workspace.copyId")}
                    </Button>
                    <Button
                      className="h-auto w-full min-w-0 max-w-full whitespace-normal break-words py-2 text-center sm:w-auto"
                      variant="outline"
                      onClick={() => openZed.mutate()}
                      disabled={openZed.isPending}
                    >
                      <ArrowSquareOutIcon
                        data-icon="inline-start"
                        aria-hidden
                      />
                      {t(
                        openZed.isPending
                          ? "practice.workspace.opening"
                          : "practice.workspace.open",
                      )}
                    </Button>
                  </div>
                ) : (
                  <Button
                    className="h-auto w-full min-w-0 max-w-full whitespace-normal break-words py-2 text-center sm:w-auto"
                    aria-current={
                      currentPracticeAction === "attempt" ? "step" : undefined
                    }
                    onClick={() => attempt.mutate()}
                    disabled={attempt.isPending}
                  >
                    <CodeIcon data-icon="inline-start" aria-hidden />
                    {t(
                      attempt.isPending
                        ? "practice.workspace.creating"
                        : "practice.workspace.create",
                    )}
                  </Button>
                )}
              </div>
              {zedFallback ? (
                <p
                  role="status"
                  className="min-w-0 break-words text-sm text-warning-foreground [overflow-wrap:anywhere]"
                >
                  {zedFallback}
                </p>
              ) : null}
              {workspaceNotice ? (
                <p
                  role="status"
                  className="min-w-0 break-words text-sm text-muted-foreground [overflow-wrap:anywhere]"
                >
                  {workspaceNotice}
                </p>
              ) : null}
            </div>

            <Separator />

            <div data-slot="exercise-evidence" className="min-w-0">
              <div
                data-slot="exercise-action-sequence"
                className="flex flex-col gap-2 p-4 sm:flex-row sm:flex-wrap sm:items-center sm:p-5"
              >
                <Button
                  data-slot="exercise-action-diff"
                  className="h-auto w-full min-w-0 max-w-full whitespace-normal break-words py-2 text-center sm:w-auto"
                  size="sm"
                  variant={
                    currentPracticeAction === "diff"
                      ? "default"
                      : diff?.changed
                        ? "ghost"
                        : "outline"
                  }
                  aria-current={
                    currentPracticeAction === "diff" ? "step" : undefined
                  }
                  disabled={!attemptId || loadDiff.isPending}
                  onClick={() => loadDiff.mutate()}
                >
                  <ClipboardTextIcon data-icon="inline-start" aria-hidden />
                  {t(
                    loadDiff.isPending
                      ? "practice.diff.refreshing"
                      : "practice.diff.refresh",
                  )}
                </Button>
                {runTests.isPending ? (
                  <Button
                    data-slot="exercise-action-tests-cancel"
                    className="h-auto w-full min-w-0 max-w-full whitespace-normal break-words py-2 text-center sm:w-auto"
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      checksOperationRef.current?.controller.abort()
                    }
                  >
                    <StopIcon data-icon="inline-start" aria-hidden />
                    {t("practice.tests.stop")}
                  </Button>
                ) : (
                  <Button
                    data-slot="exercise-action-tests"
                    className="h-auto w-full min-w-0 max-w-full whitespace-normal break-words py-2 text-center sm:w-auto"
                    size="sm"
                    variant={
                      currentPracticeAction === "tests"
                        ? "default"
                        : testsCurrent
                          ? "ghost"
                          : "outline"
                    }
                    aria-current={
                      currentPracticeAction === "tests" ? "step" : undefined
                    }
                    disabled={!attemptId}
                    onClick={() => runTests.mutate()}
                  >
                    <PlayIcon data-icon="inline-start" aria-hidden />
                    {t("practice.tests.run")}
                  </Button>
                )}
                {runReview.isPending && !activePendingReviewDisclosure ? (
                  <Button
                    data-slot="exercise-action-review-cancel"
                    className="h-auto w-full min-w-0 max-w-full whitespace-normal break-words py-2 text-center sm:w-auto"
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      reviewOperationRef.current?.controller.abort()
                    }
                  >
                    <StopIcon data-icon="inline-start" aria-hidden />
                    {t("practice.review.stop")}
                  </Button>
                ) : (
                  <Button
                    data-slot="exercise-action-review"
                    className="h-auto w-full min-w-0 max-w-full whitespace-normal break-words py-2 text-center sm:w-auto"
                    size="sm"
                    variant={
                      currentPracticeAction === "review"
                        ? "default"
                        : review
                          ? "ghost"
                          : "outline"
                    }
                    aria-current={
                      currentPracticeAction === "review" ? "step" : undefined
                    }
                    disabled={!reviewAllowed || runReview.isPending}
                    onClick={() => runReview.mutate(undefined)}
                  >
                    <FlaskIcon data-icon="inline-start" aria-hidden />
                    {t(
                      runReview.isPending
                        ? "practice.review.running"
                        : "practice.review.request",
                    )}
                  </Button>
                )}
                {review?.completionEligible ? (
                  <Button
                    data-slot="exercise-action-acceptance"
                    className="h-auto w-full min-w-0 max-w-full whitespace-normal break-words py-2 text-center sm:w-auto"
                    size="sm"
                    aria-current={
                      currentPracticeAction === "acceptance"
                        ? "step"
                        : undefined
                    }
                    onClick={() => acceptReview.mutate()}
                    disabled={acceptReview.isPending}
                  >
                    {t(
                      acceptReview.isPending
                        ? "practice.reviewer.accepting"
                        : "practice.reviewer.accept",
                    )}
                  </Button>
                ) : null}
              </div>
              <Collapsible
                data-slot="exercise-evidence-disclosure"
                className="min-w-0 border-t border-border/70"
              >
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="group flex min-h-14 w-full min-w-0 items-center justify-between gap-3 rounded-md px-4 py-3 text-left outline-none transition-colors hover:bg-muted/45 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:px-5"
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <ClipboardTextIcon
                        aria-hidden
                        className="size-4 shrink-0 text-muted-foreground"
                      />
                      <span className="min-w-0">
                        <span className="block break-words text-sm font-medium [overflow-wrap:anywhere]">
                          {t("practice.diff.title")}
                        </span>
                        <span className="block break-words text-xs leading-5 text-muted-foreground [overflow-wrap:anywhere]">
                          {t("practice.testRun.title")}
                        </span>
                      </span>
                    </span>
                    <span className="flex min-w-0 shrink items-center justify-end gap-2">
                      <Badge
                        className="max-w-full min-w-0 whitespace-normal break-words text-left leading-5 [overflow-wrap:anywhere]"
                        variant={
                          !latestTest
                            ? "secondary"
                            : latestTest.status === "passed" &&
                                latestTest.workspaceCurrent
                              ? "success"
                              : "warning"
                        }
                      >
                        {latestTestStatusLabel}
                      </Badge>
                      <CaretDownIcon
                        aria-hidden
                        className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180 motion-reduce:transition-none"
                      />
                    </span>
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="min-w-0 divide-y divide-border/60 border-t border-border/60 bg-surface-soft">
                    <div className="min-w-0 p-4 sm:p-5">
                      <p className="mb-3 text-xs font-semibold text-muted-foreground">
                        {t("practice.diff.title")}
                      </p>
                      <pre
                        data-testid="exercise-diff"
                        className="max-h-80 max-w-full overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-5 [overflow-wrap:anywhere]"
                      >
                        {diff?.patch || t("practice.diff.empty")}
                      </pre>
                      {diff?.truncated ? (
                        <p className="mt-3 break-words text-xs text-warning-foreground [overflow-wrap:anywhere]">
                          {t("practice.diff.truncated")}
                        </p>
                      ) : null}
                    </div>
                    <div className="min-w-0 p-4 sm:p-5">
                      <p className="mb-3 text-xs font-semibold text-muted-foreground">
                        {t("practice.testRun.title")}
                      </p>
                      <pre className="max-h-80 max-w-full overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-5 [overflow-wrap:anywhere]">
                        {latestTest
                          ? t("practice.testRun.output", {
                              output: latestTest.output,
                              exitCode: latestTest.exitCode,
                            })
                          : t("practice.testRun.empty")}
                      </pre>
                      {latestTest ? (
                        <Badge
                          className="mt-3 max-w-full min-w-0 whitespace-normal break-words text-left leading-5 [overflow-wrap:anywhere]"
                          variant={
                            latestTest.status === "passed" &&
                            latestTest.workspaceCurrent
                              ? "success"
                              : "warning"
                          }
                        >
                          {latestTestStatusLabel}
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </div>
          </div>
        </section>

        <aside
          className="flex min-w-0 flex-col border-t border-border/70 2xl:border-l 2xl:border-t-0 2xl:pl-8"
          aria-label={t("practice.sidebar.label")}
        >
          <section
            data-slot="exercise-topics"
            className="border-b border-border/70 py-5 2xl:pt-0"
          >
            <h2 className="text-base font-semibold">
              {t("practice.topics.title")}
            </h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {exercise.topics.map((topic) => (
                <Badge
                  key={topic}
                  variant="secondary"
                  className="max-w-full min-w-0 whitespace-normal break-words text-left [overflow-wrap:anywhere]"
                >
                  {topic}
                </Badge>
              ))}
            </div>
          </section>
          <section
            data-slot="exercise-review"
            aria-labelledby="exercise-review-title"
            className="min-w-0 py-5"
          >
            {review ? (
              <Collapsible data-slot="exercise-review-disclosure">
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="group flex min-h-11 w-full min-w-0 items-center justify-between gap-3 rounded-md text-left outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  >
                    <span
                      id="exercise-review-title"
                      className="min-w-0 break-words text-lg font-semibold [overflow-wrap:anywhere]"
                    >
                      {t("practice.reviewer.title")}
                    </span>
                    <span className="flex min-w-0 shrink items-center justify-end gap-2">
                      <Badge
                        className="max-w-full min-w-0 whitespace-normal break-words text-left leading-5 [overflow-wrap:anywhere]"
                        variant={
                          review.status === "passed" ? "success" : "warning"
                        }
                      >
                        {reviewStatusLabel}
                      </Badge>
                      <CaretDownIcon
                        aria-hidden
                        className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180 motion-reduce:transition-none"
                      />
                    </span>
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div
                    data-slot="exercise-review-details"
                    className="mt-4 flex min-w-0 flex-col gap-4 border-t border-border/70 pt-4"
                  >
                    <p className="min-w-0 break-words text-sm leading-6 [overflow-wrap:anywhere]">
                      {review.summary}
                    </p>
                    {review.completionEligible ? (
                      <p
                        role="status"
                        className="min-w-0 break-words border-y border-success/40 py-4 text-sm leading-6 text-success-foreground [overflow-wrap:anywhere]"
                      >
                        {t("practice.reviewer.receiptVerified")}
                      </p>
                    ) : null}
                    {review.evidenceBundle ? (
                      <div className="min-w-0 border-y border-border/70 py-3">
                        <p className="break-words text-xs font-medium [overflow-wrap:anywhere]">
                          {t("practice.evidenceBundle.title")}
                        </p>
                        <p className="mt-1 min-w-0 break-all font-mono text-xs leading-5 text-muted-foreground">
                          {review.evidenceBundle.sha256}
                        </p>
                        <p className="mt-1 min-w-0 break-all font-mono text-xs leading-5 text-muted-foreground">
                          {t("practice.evidenceBundle.snapshot", {
                            hash: review.evidenceBundle.workspaceSnapshotHash,
                          })}
                        </p>
                      </div>
                    ) : null}
                    {review.strengths.length ? (
                      <ul className="flex min-w-0 flex-col gap-2 text-sm leading-6 text-muted-foreground">
                        {review.strengths.map((strength) => (
                          <li
                            key={strength}
                            className="flex min-w-0 items-start gap-2"
                          >
                            <CheckCircleIcon
                              aria-hidden
                              className="mt-1 size-4 shrink-0 text-success"
                            />
                            <span className="min-w-0 break-words [overflow-wrap:anywhere]">
                              {strength}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    <ul className="flex min-w-0 flex-col divide-y divide-border/60">
                      {review.findings.map((finding, index) => (
                        <li
                          key={`${finding.category}-${index}`}
                          className="min-w-0 py-3 text-sm first:pt-0 last:pb-0"
                        >
                          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                            <span className="min-w-0 break-words font-medium [overflow-wrap:anywhere]">
                              {finding.category}
                            </span>
                            <span className="shrink-0 font-mono text-xs text-muted-foreground">
                              {t("practice.reviewer.hint", {
                                level: finding.hintLevel,
                              })}
                            </span>
                          </div>
                          <p className="mt-2 min-w-0 break-words leading-6 text-muted-foreground [overflow-wrap:anywhere]">
                            {finding.message}
                          </p>
                        </li>
                      ))}
                    </ul>
                    {review.status === "changes_requested" ? (
                      <p
                        role="status"
                        className="min-w-0 break-words border-y border-warning/40 py-4 text-sm leading-6 text-warning-foreground [overflow-wrap:anywhere]"
                      >
                        {t("practice.reviewer.changesRequested")}
                      </p>
                    ) : null}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            ) : (
              <>
                <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
                  <h2
                    id="exercise-review-title"
                    className="min-w-0 break-words text-lg font-semibold [overflow-wrap:anywhere]"
                  >
                    {t("practice.reviewer.title")}
                  </h2>
                  <Badge
                    variant="secondary"
                    className="max-w-full min-w-0 whitespace-normal break-words text-left leading-5 [overflow-wrap:anywhere]"
                  >
                    {reviewStatusLabel}
                  </Badge>
                </div>
                <p className="mt-3 min-w-0 break-words text-sm leading-6 text-muted-foreground [overflow-wrap:anywhere]">
                  {t("practice.reviewer.empty")}
                </p>
              </>
            )}
          </section>
        </aside>
      </div>
      <AlertDialog
        open={activePendingReviewDisclosure !== null}
        onOpenChange={(open) => {
          if (!open && activePendingReviewDisclosure) {
            void cancelReviewDisclosure();
          }
        }}
      >
        <AlertDialogContent className="min-w-0">
          <AlertDialogHeader>
            <AlertDialogTitle className="min-w-0 break-words [overflow-wrap:anywhere]">
              {t("practice.disclosure.title")}
            </AlertDialogTitle>
            <AlertDialogDescription className="min-w-0 break-words [overflow-wrap:anywhere]">
              {t("practice.disclosure.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {activePendingReviewDisclosure ? (
            <dl className="grid min-w-0 gap-3 rounded-md border border-border/60 bg-surface-soft p-4 text-sm">
              <div className="min-w-0">
                <dt className="font-medium">
                  {t("practice.disclosure.destination")}
                </dt>
                <dd className="min-w-0 break-all text-muted-foreground">
                  {activePendingReviewDisclosure.disclosure.scope.destination}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="font-medium">{t("practice.disclosure.data")}</dt>
                <dd className="min-w-0 break-words text-muted-foreground [overflow-wrap:anywhere]">
                  {t("practice.disclosure.dataSummary", {
                    categories:
                      activePendingReviewDisclosure.disclosure.scope.payloadCategories.join(
                        ", ",
                      ),
                    bytes:
                      activePendingReviewDisclosure.disclosure.scope.byteCount,
                  })}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="font-medium">
                  {t("practice.disclosure.exclusions")}
                </dt>
                <dd className="min-w-0 break-words text-muted-foreground [overflow-wrap:anywhere]">
                  {activePendingReviewDisclosure.disclosure.scope.exclusions.join(
                    ", ",
                  )}
                </dd>
              </div>
            </dl>
          ) : null}
          <AlertDialogFooter className="min-w-0">
            <AlertDialogCancel
              className="h-auto max-w-full whitespace-normal break-words py-2 text-center"
              disabled={runReview.isPending}
            >
              {t("practice.disclosure.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              className="h-auto max-w-full whitespace-normal break-words py-2 text-center"
              disabled={runReview.isPending}
              onClick={(event) => {
                event.preventDefault();
                void approveReviewDisclosure();
              }}
            >
              {t("practice.disclosure.approveOnce")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
