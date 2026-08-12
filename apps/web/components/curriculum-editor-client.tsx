"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowUpIcon,
  CaretDownIcon,
  CopyIcon,
  PlusIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import {
  AiDisclosureSchema,
  CourseDesignerPendingDisclosureResponseSchema,
  CourseLocaleSchema,
  CourseDesignerSourceSchema,
  CourseDesignerWorkflowSchema,
  CourseDraftProposalDiffSchema,
  CourseDraftProposalSchema,
} from "@aptiloop/shared";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { z } from "zod";

import { parseAuthoringBriefDescription } from "@/app/courses/new/authoring-brief";
import {
  presentFailure,
  type FailurePresentation,
} from "@/lib/failure-presentation";
import { usePageRouteContext } from "@/components/page-route-context";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { PageHeader } from "@/components/page-header";
import {
  EmptyState,
  QueryError,
  SafeQueryError,
} from "@/components/query-state";
import { LoadingState } from "@/components/ui/loading-state";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  CurriculumSourceSchema,
  DepthLevelSchema,
  UnitChecklistItemSchema,
  UnitCompletionCriterionSchema,
  UnitPayloadSchema,
  UnitQuestionSchema,
  UnitTypeSchema,
  UnitUnlockRuleSchema,
} from "@/lib/curriculum-authoring-schemas";
import { type MessageKey, type UiLocale, useI18n } from "@/lib/i18n";
import type { RouteContext } from "@/lib/route-context";
import { unitTypeMessageKeys } from "@/lib/unit-labels";

const idSchema = z.string().trim().min(1).max(200);
const nullableTextSchema = z.string().nullable();
const statusSchema = z.enum(["draft", "published", "archived"]);
const versionSchema = z
  .object({
    id: idSchema,
    curriculumId: idSchema,
    revision: z.number().int().positive(),
    parentVersionId: idSchema.nullable(),
    status: statusSchema,
    title: z.string().min(1),
    description: nullableTextSchema,
    contentHash: z.string().nullable(),
    createdAt: z.number(),
    publishedAt: z.number().nullable(),
    archivedAt: z.number().nullable(),
    updatedAt: z.number(),
  })
  .strict();
const versionListItemSchema = versionSchema
  .extend({
    curriculumSlug: idSchema,
    primaryLocale: CourseLocaleSchema,
    branchKind: z.enum(["upstream", "personal"]).optional(),
    basedOnContentHash: z.string().nullable().optional(),
    adaptationBranchId: idSchema.nullable().optional(),
  })
  .strict();

const unitSchema = z
  .object({
    id: idSchema,
    versionId: idSchema,
    dayId: idSchema,
    stableId: idSchema,
    type: UnitTypeSchema,
    orderIndex: z.number().int().nonnegative(),
    title: z.string().min(1),
    description: nullableTextSchema,
    estimatedMinutes: z.number().int().nonnegative().nullable(),
    objectives: z.array(z.unknown()),
    checklist: z.array(z.unknown()),
    sources: z.array(z.unknown()),
    questions: z.array(z.unknown()),
    misconceptions: z.array(z.unknown()),
    referenceAnswer: z.unknown(),
    completionCriteria: z.array(z.unknown()),
    unlockRules: z.array(z.unknown()),
    optional: z.boolean(),
    depthLevel: DepthLevelSchema.nullable(),
    payload: z.record(z.string(), z.unknown()),
    createdAt: z.number(),
    updatedAt: z.number(),
  })
  .strict();
const daySchema = z
  .object({
    id: idSchema,
    versionId: idSchema,
    weekId: idSchema,
    stableId: idSchema,
    orderIndex: z.number().int().nonnegative(),
    title: z.string().min(1),
    description: nullableTextSchema,
    goal: z.string().min(1),
    estimatedMinutes: z.number().int().positive(),
    prerequisites: z.array(z.unknown()),
    expectedOutcomes: z.array(z.unknown()),
    depthLevel: DepthLevelSchema,
    outOfScope: z.array(z.unknown()),
    topics: z.array(z.unknown()),
    createdAt: z.number(),
    updatedAt: z.number(),
    units: z.array(unitSchema),
  })
  .strict();
const weekSchema = z
  .object({
    id: idSchema,
    versionId: idSchema,
    stableId: idSchema,
    orderIndex: z.number().int().nonnegative(),
    title: z.string().min(1),
    description: nullableTextSchema,
    createdAt: z.number(),
    updatedAt: z.number(),
    days: z.array(daySchema),
  })
  .strict();
const graphSchema = z
  .object({ version: versionSchema, weeks: z.array(weekSchema) })
  .strict();
const validationReportSchema = z
  .object({
    validatorVersion: z.literal("m9-v1"),
    versionId: idSchema,
    draftHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    validationHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    valid: z.boolean(),
    errors: z.number().int().nonnegative(),
    warnings: z.number().int().nonnegative(),
    diagnostics: z.array(
      z
        .object({
          code: z.string().min(1),
          severity: z.enum(["error", "warning"]),
          path: z.string(),
          message: z.string().min(1),
        })
        .strict(),
    ),
  })
  .strict();
const validationResponseSchema = z
  .object({ report: validationReportSchema })
  .strict();
const previewResponseSchema = z
  .object({
    preview: z
      .object({
        versionId: idSchema,
        title: z.string().min(1),
        description: nullableTextSchema,
        draftHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
        weeks: z.array(
          z
            .object({
              stableId: idSchema,
              title: z.string().min(1),
              description: nullableTextSchema,
              days: z.array(
                z
                  .object({
                    stableId: idSchema,
                    title: z.string().min(1),
                    description: nullableTextSchema,
                    goal: z.string().min(1),
                    estimatedMinutes: z.number().int().positive(),
                    expectedOutcomes: z.array(z.unknown()),
                    topics: z.array(z.unknown()),
                    activities: z.array(
                      z
                        .object({
                          stableId: idSchema,
                          type: UnitTypeSchema,
                          title: z.string().min(1),
                          description: nullableTextSchema,
                          estimatedMinutes: z.number().int().nullable(),
                          objectives: z.array(z.unknown()),
                          checklist: z.array(z.unknown()),
                          sources: z.array(z.unknown()),
                          optional: z.boolean(),
                        })
                        .strict(),
                    ),
                  })
                  .strict(),
              ),
            })
            .strict(),
        ),
      })
      .strict(),
  })
  .strict();
const changeReviewResponseSchema = z
  .object({
    review: z
      .object({
        versionId: idSchema,
        parentVersionId: idSchema.nullable(),
        draftHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
        changeReviewHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
        added: z.number().int().nonnegative(),
        changed: z.number().int().nonnegative(),
        removed: z.number().int().nonnegative(),
        changes: z.array(
          z
            .object({
              operation: z.enum(["added", "changed", "removed"]),
              entityType: z.enum(["week", "day", "unit"]),
              stableId: idSchema,
            })
            .strict(),
        ),
        ready: z.boolean(),
      })
      .strict(),
  })
  .strict();
const releaseEvidenceSchema = z
  .object({
    validation: validationReportSchema.nullable(),
    preview: previewResponseSchema.shape.preview.nullable(),
    review: changeReviewResponseSchema.shape.review.nullable(),
  })
  .strict();
type ReleaseEvidence = z.infer<typeof releaseEvidenceSchema>;
const proposalAttributionSchema = z
  .object({
    workflowId: idSchema,
    connectionId: idSchema,
    providerType: z.string().min(1),
    modelId: z.string().min(1),
    promptTemplateId: idSchema,
    promptTemplateVersion: z.string().regex(/^v\d+\.\d+\.\d+$/u),
    disclosureOperationId: idSchema.nullable(),
    diffs: z.array(CourseDraftProposalDiffSchema),
    provenance: z
      .object({
        sourceIds: z.array(idSchema),
        sources: z.array(CourseDesignerSourceSchema),
        authoringRequestOperationId: idSchema,
        providerOperationId: idSchema,
      })
      .strict(),
    validation: z
      .object({
        valid: z.boolean(),
        errors: z.number().int().nonnegative(),
        warnings: z.number().int().nonnegative(),
        diagnostics: z.array(
          z
            .object({
              code: z.string().min(1),
              severity: z.enum(["error", "warning"]),
              targetStableId: idSchema,
              message: z.string().min(1),
            })
            .strict(),
        ),
      })
      .strict(),
  })
  .strict();
const courseProposalRecordSchema = z
  .object({
    id: idSchema,
    versionId: idSchema,
    baseDraftHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    prompt: z.string().min(1),
    proposal: CourseDraftProposalSchema,
    status: z.enum(["proposed", "applied", "rejected"]),
    authoringOperationId: idSchema,
    providerOperationId: idSchema,
    createdAt: z.number().int().nonnegative(),
    reviewedAt: z.number().int().nonnegative().nullable(),
    attribution: proposalAttributionSchema.nullable(),
  })
  .strict();
const courseProposalResponseSchema = z
  .object({
    proposal: courseProposalRecordSchema,
    workflow: CourseDesignerWorkflowSchema.optional(),
  })
  .strict();
const courseProposalListSchema = z
  .object({ proposals: z.array(courseProposalRecordSchema) })
  .strict();
const courseDesignerWorkflowResponseSchema = z
  .object({ workflow: CourseDesignerWorkflowSchema })
  .strict();
const courseDesignerWorkflowListSchema = z
  .object({ workflows: z.array(CourseDesignerWorkflowSchema) })
  .strict();
const disclosurePreparationSchema = z.discriminatedUnion("required", [
  z.object({ required: z.literal(false) }).strict(),
  z
    .object({ required: z.literal(true), disclosure: AiDisclosureSchema })
    .strict(),
]);

const adaptationRevisionSchema = z
  .object({
    id: idSchema,
    curriculumId: idSchema,
    revision: z.number().int().positive(),
    parentVersionId: idSchema.nullable(),
    branchKind: z.enum(["upstream", "personal"]),
    status: z.enum(["draft", "published", "archived"]),
    title: z.string().min(1),
    description: nullableTextSchema,
    contentHash: z.string().nullable(),
    basedOnContentHash: z.string().nullable(),
    adaptationBranchId: idSchema.nullable(),
    createdAt: z.number().int().nonnegative(),
    publishedAt: z.number().int().nonnegative().nullable(),
    archivedAt: z.number().int().nonnegative().nullable(),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict();
const adaptationBranchSchema = z
  .object({
    id: idSchema,
    courseId: idSchema,
    owner: z.literal("local"),
    baseRevisionId: idSchema,
    headRevisionId: idSchema.nullable(),
    status: z.enum(["active", "archived"]),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict();
const adaptationComparisonSchema = z
  .object({
    status: z.enum(["current", "clean", "conflict"]),
    baseRevisionId: idSchema,
    upstreamRevisionId: idSchema,
    personalVersionId: idSchema.nullable(),
    baseDraftHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    upstreamDraftHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    personalDraftHash: z
      .string()
      .regex(/^sha256:[a-f0-9]{64}$/u)
      .nullable(),
    conflicts: z.array(z.string()),
  })
  .strict();
const adaptationResponseSchema = z
  .object({
    branch: adaptationBranchSchema.nullable(),
    revisions: z.array(adaptationRevisionSchema),
    comparison: adaptationComparisonSchema,
  })
  .strict();
const adaptationMutationResponseSchema = z
  .object({
    version: adaptationRevisionSchema,
    branch: adaptationBranchSchema,
  })
  .strict();
const adaptationIntegrationResponseSchema = z
  .object({
    version: adaptationRevisionSchema,
    strategy: z.enum(["use-upstream", "keep-personal"]),
    priorConflicts: z.array(z.string()),
  })
  .strict();
type Version = z.infer<typeof versionSchema>;
type VersionListItem = z.infer<typeof versionListItemSchema>;
type Graph = z.infer<typeof graphSchema>;
type Week = z.infer<typeof weekSchema>;
type Day = z.infer<typeof daySchema>;
type Unit = z.infer<typeof unitSchema>;

const forbiddenResponseKeys = new Set([
  "credentials",
  "secret",
  "secrets",
  "workspacePath",
  "filesystemHandle",
  "rawProviderRpc",
  "rawResponse",
  "command",
  "args",
  "cwd",
  "executable",
  "protectedEvaluation",
]);

type Translate = (
  key: MessageKey,
  values?: Readonly<Record<string, string | number>>,
) => string;

function assertSafeResponse(
  value: unknown,
  t: Translate,
  path = "response",
): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      assertSafeResponse(item, t, `${path}[${index}]`),
    );
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    if (forbiddenResponseKeys.has(key)) {
      throw new Error(
        t("authoring.error.unsafeResponseField", { path: `${path}.${key}` }),
      );
    }
    assertSafeResponse(nested, t, `${path}.${key}`);
  }
}

async function checkedApi<T>(
  path: string,
  schema: z.ZodType<T>,
  t: Translate,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-Aptiloop-Client": "web",
      ...init?.headers,
    },
  });
  const value: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = z
      .object({
        error: z
          .union([
            z.string(),
            z.object({ message: z.string().min(1) }).passthrough(),
          ])
          .optional(),
        code: z.string().optional(),
        failure: z
          .object({
            code: z.string(),
            retryable: z.boolean(),
            messageKey: z.string(),
            diagnosticId: z.string(),
            recoveryAction: z.string().nullable(),
          })
          .strict()
          .optional(),
      })
      .passthrough()
      .safeParse(value);
    const backendError = parsed.success ? parsed.data.error : undefined;
    const message =
      typeof backendError === "string"
        ? backendError
        : (backendError?.message ??
          t("authoring.error.requestFailed", { status: response.status }));
    throw Object.assign(new Error(message), {
      status: response.status,
      ...(parsed.success && parsed.data.failure
        ? { failure: parsed.data.failure }
        : {}),
      ...(parsed.success && parsed.data.code ? { code: parsed.data.code } : {}),
    });
  }
  assertSafeResponse(value, t);
  return schema.parse(value);
}

function operationId(): string {
  return crypto.randomUUID();
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function splitList(value: FormDataEntryValue | null): string[] {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function usePendingOperations() {
  const pending = useRef(new Map<string, string>());
  return {
    id(key: string) {
      const existing = pending.current.get(key);
      if (existing) return existing;
      const created = operationId();
      pending.current.set(key, created);
      return created;
    },
    confirmed(key: string) {
      pending.current.delete(key);
    },
  };
}

const fieldClass =
  "min-h-11 w-full min-w-0 rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60";
const labelClass = "flex min-w-0 flex-col gap-2 text-sm font-medium";
const panelClass = "min-w-0 rounded-[14px] bg-surface-soft/45 p-5 sm:p-6";
const focusPanelClass =
  "min-w-0 rounded-[16px] bg-surface-raised p-5 shadow-[0_16px_45px_oklch(0_0_0/0.07)] sm:p-6";

const depthMessageKeys = {
  foundation: "unit.depth.foundation",
  "interview-ready": "unit.depth.interviewReady",
  "deep-dive": "unit.depth.deepDive",
} satisfies Record<z.infer<typeof DepthLevelSchema>, MessageKey>;

export type AuthoringStart = "manual" | "designer";
export type StudioWorkspace =
  "program" | "designer" | "preview" | "release" | "history";

function errorMessage(error: unknown, t: Translate): string {
  if (error instanceof z.ZodError)
    return t("authoring.error.unsafeServerResponse");
  if (
    error instanceof TypeError ||
    (error !== null &&
      typeof error === "object" &&
      typeof (error as { status?: unknown }).status === "number")
  )
    return presentFailure(error, "studio.action", t).message;
  if (error instanceof Error) return error.message;
  return t("authoring.error.saveFailed");
}

function parseJson<T>(
  label: string,
  value: FormDataEntryValue | null,
  schema: z.ZodType<T>,
  t: Translate,
): T {
  const text = typeof value === "string" ? value : "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(t("authoring.error.invalidJson", { label }));
  }
  const result = schema.safeParse(parsed);
  if (!result.success)
    throw new Error(t("authoring.error.invalidStructure", { label }));
  return result.data;
}

function text(form: FormData, name: string): string {
  return String(form.get(name) ?? "").trim();
}

function optionalText(form: FormData, name: string): string | null {
  const value = text(form, name);
  return value || null;
}

type StructuredValue =
  | null
  | string
  | number
  | boolean
  | StructuredValue[]
  | { [key: string]: StructuredValue };

const completionCriterionDefaults: Readonly<
  Record<string, { [key: string]: StructuredValue }>
> = {
  acknowledgement: { type: "acknowledgement" },
  checklist: { type: "checklist", requiredItemIds: [""] },
  attempts: { type: "attempts", minimum: 1 },
  dialogue: { type: "dialogue", minimumTurns: 1, requiresRevision: false },
  score: { type: "score", minimum: 0.8, minimumAttempts: 1 },
  fields: { type: "fields", required: [""] },
  exercise: {
    type: "exercise",
    passingTestsRequired: true,
    acceptedReviewRequired: true,
  },
  custom: { type: "custom", key: "" },
};

function structuredArrayDefault(path: string): StructuredValue {
  const key = path.split(".").at(-1);
  if (key === "checklist") return { id: "item", label: "", required: true };
  if (key === "sources")
    return {
      id: "source",
      title: "",
      url: null,
      kind: "source-required",
      required: true,
      estimatedMinutes: 0,
      examplesToRepeat: [],
    };
  if (key === "questions")
    return {
      id: "question",
      kind: "explain",
      prompt: "",
      options: [],
      correctOptionIds: [],
      referenceAnswer: null,
      evaluationPoints: [],
      commonMistakes: [],
    };
  if (key === "options") return { id: "option", label: "" };
  if (key === "completionCriteria") return { type: "acknowledgement" };
  if (key === "unlockRules") return { type: "unit-completed", unitId: "" };
  return "";
}

function StructuredValueEditor({
  value,
  path,
  onChange,
}: {
  value: StructuredValue;
  path: string;
  onChange: (value: StructuredValue) => void;
}) {
  const { t } = useI18n();
  if (Array.isArray(value)) {
    return (
      <div className="grid gap-2 rounded-md border border-border p-3">
        {value.map((item, index) => (
          <div
            key={`${path}-${index}`}
            className="grid gap-2 rounded-md bg-muted/30 p-3"
          >
            <StructuredValueEditor
              value={item}
              path={`${path}.${index}`}
              onChange={(next) =>
                onChange(
                  value.map((current, itemIndex) =>
                    itemIndex === index ? next : current,
                  ),
                )
              }
            />
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() =>
                onChange(value.filter((_, itemIndex) => itemIndex !== index))
              }
            >
              {t("authoring.structured.removeItem")}
            </Button>
          </div>
        ))}
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => onChange([...value, structuredArrayDefault(path)])}
        >
          <PlusIcon aria-hidden />
          {t("authoring.structured.addItem")}
        </Button>
      </div>
    );
  }
  if (value !== null && typeof value === "object") {
    return (
      <div className="grid gap-3 rounded-md border border-border p-3">
        {Object.entries(value).map(([key, child]) => {
          if (key === "type" && path.startsWith("completionCriteria")) {
            return (
              <label key={key} className={labelClass}>
                {key}
                <select
                  className={fieldClass}
                  value={String(child)}
                  onChange={(event) =>
                    onChange(
                      structuredClone(
                        completionCriterionDefaults[event.target.value] ??
                          value,
                      ),
                    )
                  }
                >
                  {Object.keys(completionCriterionDefaults).map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
            );
          }
          if (key === "kind" && path.startsWith("questions")) {
            return (
              <label key={key} className={labelClass}>
                {key}
                <select
                  className={fieldClass}
                  value={String(child)}
                  onChange={(event) =>
                    onChange({ ...value, kind: event.target.value })
                  }
                >
                  {[
                    "explain",
                    "compare",
                    "predict-output",
                    "find-bug",
                    "multiple-choice",
                    "design-choice",
                  ].map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
            );
          }
          return (
            <div key={key} className="grid gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">
                {key}
              </span>
              <StructuredValueEditor
                value={child}
                path={`${path}.${key}`}
                onChange={(next) => onChange({ ...value, [key]: next })}
              />
            </div>
          );
        })}
      </div>
    );
  }
  if (typeof value === "boolean") {
    return (
      <input
        aria-label={path}
        type="checkbox"
        checked={value}
        onChange={(event) => onChange(event.target.checked)}
      />
    );
  }
  if (typeof value === "number") {
    return (
      <input
        aria-label={path}
        className={fieldClass}
        type="number"
        step="any"
        value={value}
        onChange={(event) => onChange(event.target.valueAsNumber)}
      />
    );
  }
  if (value === null) {
    return (
      <textarea
        aria-label={path}
        className={`${fieldClass} resize-y`}
        rows={2}
        value=""
        placeholder={t("authoring.structured.optionalEmpty")}
        onChange={(event) => onChange(event.target.value || null)}
      />
    );
  }
  return (
    <textarea
      aria-label={path}
      className={`${fieldClass} resize-y`}
      rows={2}
      value={String(value ?? "")}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function StructuredField({
  name,
  label,
  value,
}: {
  name: string;
  label: string;
  value: unknown;
}) {
  const [current, setCurrent] = useState(value as StructuredValue);
  return (
    <fieldset className="grid gap-2 rounded-lg border border-border p-3">
      <legend className="px-1 text-sm font-medium">{label}</legend>
      <input type="hidden" name={name} value={JSON.stringify(current)} />
      <StructuredValueEditor
        value={current}
        path={name}
        onChange={setCurrent}
      />
    </fieldset>
  );
}

function SubmitError({ message }: { message: string | null }) {
  return message ? (
    <p role="alert" className="text-sm text-destructive">
      {message}
    </p>
  ) : null;
}

function ReorderControls({
  label,
  index,
  count,
  disabled,
  move,
}: {
  label: string;
  index: number;
  count: number;
  disabled: boolean;
  move: (direction: -1 | 1) => void;
}) {
  const { t } = useI18n();
  return (
    <div
      className="flex gap-1"
      aria-label={t("authoring.reorder.group", { label })}
    >
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        disabled={disabled || index === 0}
        aria-label={t("authoring.reorder.up", { label })}
        onClick={() => move(-1)}
      >
        <ArrowUpIcon aria-hidden />
      </Button>
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        disabled={disabled || index === count - 1}
        aria-label={t("authoring.reorder.down", { label })}
        onClick={() => move(1)}
      >
        <ArrowDownIcon aria-hidden />
      </Button>
    </div>
  );
}

function DeleteAction({
  label,
  consequence,
  busy,
  onConfirm,
}: {
  label: string;
  consequence: string;
  busy: boolean;
  onConfirm: () => Promise<unknown>;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) setError(null);
      }}
    >
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t("authoring.delete.button", { label })}
          disabled={busy}
        >
          <TrashIcon aria-hidden />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("authoring.delete.confirmation", { label })}
          </AlertDialogTitle>
          <AlertDialogDescription>{consequence}</AlertDialogDescription>
        </AlertDialogHeader>
        <SubmitError message={error} />
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>
            {t("authoring.common.cancel")}
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={busy}
            onClick={(event) => {
              event.preventDefault();
              setError(null);
              void onConfirm()
                .then(() => setOpen(false))
                .catch((cause) => setError(errorMessage(cause, t)));
            }}
          >
            {t("authoring.delete.confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

type Mutate = (
  path: string,
  init: RequestInit,
  schema: z.ZodType<unknown>,
  selectId?: string,
) => Promise<unknown>;

function WeekForm({
  versionId,
  initial,
  mutate,
  busy,
  onClose,
}: {
  versionId: string;
  initial?: Week;
  mutate: Mutate;
  busy: boolean;
  onClose?: () => void;
}) {
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      aria-label={
        initial
          ? t("authoring.week.form.edit", { title: initial.title })
          : t("authoring.week.form.add")
      }
      className="grid gap-3 rounded-lg border border-border bg-background p-4"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        const form = new FormData(event.currentTarget);
        const body = {
          operationId: operationId(),
          stableId: text(form, "stableId"),
          title: text(form, "title"),
          description: optionalText(form, "description"),
        };
        const path = initial
          ? `/curriculum-editor/versions/${encodeURIComponent(versionId)}/weeks/${encodeURIComponent(initial.id)}`
          : `/curriculum-editor/versions/${encodeURIComponent(versionId)}/weeks`;
        void mutate(
          path,
          { method: initial ? "PATCH" : "POST", body: JSON.stringify(body) },
          z
            .object({ week: weekSchema.omit({ days: true }).passthrough() })
            .strict(),
        )
          .then(() => onClose?.())
          .catch((cause) => setError(errorMessage(cause, t)));
      }}
    >
      <div className="grid gap-3 md:grid-cols-2">
        <label className={labelClass}>
          {t("authoring.field.stableId")}
          <input
            className={fieldClass}
            name="stableId"
            required
            defaultValue={initial?.stableId}
          />
        </label>
        <label className={labelClass}>
          {t("authoring.field.title")}
          <input
            className={fieldClass}
            name="title"
            required
            defaultValue={initial?.title}
          />
        </label>
      </div>
      <label className={labelClass}>
        {t("authoring.field.description")}
        <textarea
          className={fieldClass}
          name="description"
          defaultValue={initial?.description ?? ""}
        />
      </label>
      <SubmitError message={error} />
      <div>
        <Button disabled={busy} type="submit">
          {t(initial ? "authoring.week.save" : "authoring.week.add")}
        </Button>
      </div>
    </form>
  );
}

const stringArraySchema = z.array(z.string().trim().min(1).max(500)).max(500);

function DayForm({
  versionId,
  weekId,
  initial,
  mutate,
  busy,
  onClose,
}: {
  versionId: string;
  weekId: string;
  initial?: Day;
  mutate: Mutate;
  busy: boolean;
  onClose?: () => void;
}) {
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      aria-label={
        initial
          ? t("authoring.day.form.edit", { title: initial.title })
          : t("authoring.day.form.add")
      }
      className="grid gap-4 rounded-lg border border-border bg-background p-4"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        try {
          const form = new FormData(event.currentTarget);
          const body = {
            operationId: operationId(),
            stableId: text(form, "stableId"),
            title: text(form, "title"),
            description: optionalText(form, "description"),
            goal: text(form, "goal"),
            estimatedMinutes: Number(text(form, "estimatedMinutes")),
            depthLevel: DepthLevelSchema.parse(text(form, "depthLevel")),
            prerequisites: parseJson(
              t("authoring.field.prerequisites"),
              form.get("prerequisites"),
              stringArraySchema,
              t,
            ),
            expectedOutcomes: parseJson(
              t("authoring.field.expectedOutcomes"),
              form.get("expectedOutcomes"),
              stringArraySchema,
              t,
            ),
            outOfScope: parseJson(
              t("authoring.field.outOfScope"),
              form.get("outOfScope"),
              stringArraySchema,
              t,
            ),
            topics: parseJson(
              t("authoring.field.topics"),
              form.get("topics"),
              stringArraySchema,
              t,
            ),
          };
          const path = initial
            ? `/curriculum-editor/versions/${encodeURIComponent(versionId)}/days/${encodeURIComponent(initial.id)}`
            : `/curriculum-editor/versions/${encodeURIComponent(versionId)}/weeks/${encodeURIComponent(weekId)}/days`;
          void mutate(
            path,
            { method: initial ? "PATCH" : "POST", body: JSON.stringify(body) },
            z
              .object({ day: daySchema.omit({ units: true }).passthrough() })
              .strict(),
          )
            .then(() => onClose?.())
            .catch((cause) => setError(errorMessage(cause, t)));
        } catch (cause) {
          setError(errorMessage(cause, t));
        }
      }}
    >
      <div className="grid gap-3 md:grid-cols-2">
        <label className={labelClass}>
          {t("authoring.field.stableId")}
          <input
            className={fieldClass}
            name="stableId"
            required
            defaultValue={initial?.stableId}
          />
        </label>
        <label className={labelClass}>
          {t("authoring.field.title")}
          <input
            className={fieldClass}
            name="title"
            required
            defaultValue={initial?.title}
          />
        </label>
        <label className={labelClass}>
          {t("authoring.field.minutes")}
          <input
            className={fieldClass}
            name="estimatedMinutes"
            type="number"
            min="1"
            required
            defaultValue={initial?.estimatedMinutes ?? 60}
          />
        </label>
        <label className={labelClass}>
          {t("authoring.field.depth")}
          <select
            className={fieldClass}
            name="depthLevel"
            defaultValue={initial?.depthLevel ?? "foundation"}
          >
            {DepthLevelSchema.options.map((depth) => (
              <option key={depth} value={depth}>
                {t(depthMessageKeys[depth])}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className={labelClass}>
        {t("authoring.field.goal")}
        <textarea
          className={fieldClass}
          name="goal"
          required
          defaultValue={initial?.goal}
        />
      </label>
      <label className={labelClass}>
        {t("authoring.field.description")}
        <textarea
          className={fieldClass}
          name="description"
          defaultValue={initial?.description ?? ""}
        />
      </label>
      <div className="grid gap-3 md:grid-cols-2">
        <StructuredField
          name="prerequisites"
          label={t("authoring.field.prerequisitesJson")}
          value={initial?.prerequisites ?? []}
        />
        <StructuredField
          name="expectedOutcomes"
          label={t("authoring.field.expectedOutcomesJson")}
          value={initial?.expectedOutcomes ?? []}
        />
        <StructuredField
          name="outOfScope"
          label={t("authoring.field.outOfScopeJson")}
          value={initial?.outOfScope ?? []}
        />
        <StructuredField
          name="topics"
          label={t("authoring.field.topicsJson")}
          value={initial?.topics ?? []}
        />
      </div>
      <SubmitError message={error} />
      <div>
        <Button disabled={busy} type="submit">
          {t(initial ? "authoring.day.save" : "authoring.day.add")}
        </Button>
      </div>
    </form>
  );
}

const unitJsonSchemas = {
  objectives: stringArraySchema,
  checklist: z.array(UnitChecklistItemSchema).max(500),
  sources: z.array(CurriculumSourceSchema).max(500),
  questions: z.array(UnitQuestionSchema).max(500),
  misconceptions: stringArraySchema,
  completionCriteria: z.array(UnitCompletionCriterionSchema).min(1).max(50),
  unlockRules: z.array(UnitUnlockRuleSchema).max(500),
};

function defaultPayload(type: z.infer<typeof UnitTypeSchema>): unknown {
  const values: Record<z.infer<typeof UnitTypeSchema>, unknown> = {
    briefing: { type, scope: [] },
    study: { type },
    recall: { type, prompt: "Recall the main ideas" },
    "teacher-dialogue": {
      type,
      openingPrompt: "Explain the topic in your own words",
      minimumTurns: 1,
      requiresRevision: true,
    },
    quiz: { type, questionIds: ["question-1"], minimumScore: 0.8 },
    "code-reading": { type, snippet: "const value = 1;" },
    exercise: {
      type,
      exerciseId: "exercise-1",
      acceptanceCriteria: ["Checks pass"],
      constraints: [],
      template: "// TODO",
      testCommandId: "test",
      hintPolicy: "Progressive levels",
      reviewPolicy: "Read-only",
    },
    review: { type, exerciseUnitId: "exercise-unit" },
    interview: { type, topics: ["Topic"] },
    summary: { type, prompts: [] },
    checkpoint: { type, label: "Checkpoint" },
    "spaced-review": { type, topicIds: ["topic-1"] },
  };
  return values[type];
}

function UnitForm({
  versionId,
  dayId,
  initial,
  mutate,
  busy,
  onClose,
}: {
  versionId: string;
  dayId: string;
  initial?: Unit;
  mutate: Mutate;
  busy: boolean;
  onClose?: () => void;
}) {
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const [type, setType] = useState<z.infer<typeof UnitTypeSchema>>(
    initial?.type ?? "briefing",
  );
  return (
    <form
      aria-label={
        initial
          ? t("authoring.unit.form.edit", { title: initial.title })
          : t("authoring.unit.form.add")
      }
      className="grid gap-4 rounded-lg border border-border bg-background p-4"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        try {
          const form = new FormData(event.currentTarget);
          const unitType = UnitTypeSchema.parse(text(form, "type"));
          const payload = parseJson(
            t("authoring.field.payload"),
            form.get("payload"),
            UnitPayloadSchema,
            t,
          );
          if (payload.type !== unitType)
            throw new Error(t("authoring.error.payloadTypeMismatch"));
          const minutes = text(form, "estimatedMinutes");
          const body = {
            operationId: operationId(),
            stableId: text(form, "stableId"),
            type: unitType,
            title: text(form, "title"),
            description: optionalText(form, "description"),
            estimatedMinutes: minutes ? Number(minutes) : null,
            objectives: parseJson(
              t("authoring.field.objectives"),
              form.get("objectives"),
              unitJsonSchemas.objectives,
              t,
            ),
            checklist: parseJson(
              t("authoring.field.checklist"),
              form.get("checklist"),
              unitJsonSchemas.checklist,
              t,
            ),
            sources: parseJson(
              t("authoring.field.sources"),
              form.get("sources"),
              unitJsonSchemas.sources,
              t,
            ),
            questions: parseJson(
              t("authoring.field.questions"),
              form.get("questions"),
              unitJsonSchemas.questions,
              t,
            ),
            misconceptions: parseJson(
              t("authoring.field.misconceptions"),
              form.get("misconceptions"),
              unitJsonSchemas.misconceptions,
              t,
            ),
            referenceAnswer: optionalText(form, "referenceAnswer"),
            completionCriteria: parseJson(
              t("authoring.field.completionCriteria"),
              form.get("completionCriteria"),
              unitJsonSchemas.completionCriteria,
              t,
            ),
            unlockRules: parseJson(
              t("authoring.field.unlockRules"),
              form.get("unlockRules"),
              unitJsonSchemas.unlockRules,
              t,
            ),
            optional: form.get("optional") === "on",
            depthLevel: text(form, "depthLevel")
              ? DepthLevelSchema.parse(text(form, "depthLevel"))
              : null,
            payload,
          };
          const path = initial
            ? `/curriculum-editor/versions/${encodeURIComponent(versionId)}/units/${encodeURIComponent(initial.id)}`
            : `/curriculum-editor/versions/${encodeURIComponent(versionId)}/days/${encodeURIComponent(dayId)}/units`;
          void mutate(
            path,
            { method: initial ? "PATCH" : "POST", body: JSON.stringify(body) },
            z.object({ unit: unitSchema.passthrough() }).strict(),
          )
            .then(() => onClose?.())
            .catch((cause) => setError(errorMessage(cause, t)));
        } catch (cause) {
          setError(errorMessage(cause, t));
        }
      }}
    >
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <label className={labelClass}>
          {t("authoring.field.stableId")}
          <input
            className={fieldClass}
            name="stableId"
            required
            defaultValue={initial?.stableId}
          />
        </label>
        <label className={labelClass}>
          {t("authoring.field.title")}
          <input
            className={fieldClass}
            name="title"
            required
            defaultValue={initial?.title}
          />
        </label>
        <label className={labelClass}>
          {t("authoring.field.type")}
          <select
            className={fieldClass}
            name="type"
            value={type}
            onChange={(event) =>
              setType(UnitTypeSchema.parse(event.target.value))
            }
          >
            {UnitTypeSchema.options.map((option) => (
              <option key={option}>{option}</option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          {t("authoring.field.minutes")}
          <input
            className={fieldClass}
            name="estimatedMinutes"
            type="number"
            min="1"
            defaultValue={initial?.estimatedMinutes ?? ""}
          />
        </label>
        <label className={labelClass}>
          {t("authoring.field.depth")}
          <select
            className={fieldClass}
            name="depthLevel"
            defaultValue={initial?.depthLevel ?? ""}
          >
            <option value="">{t("authoring.field.inherit")}</option>
            {DepthLevelSchema.options.map((depth) => (
              <option key={depth} value={depth}>
                {t(depthMessageKeys[depth])}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-h-11 items-center gap-2 self-end text-sm">
          <input
            name="optional"
            type="checkbox"
            defaultChecked={initial?.optional}
          />
          {t("authoring.field.optionalUnit")}
        </label>
      </div>
      <label className={labelClass}>
        {t("authoring.field.description")}
        <textarea
          className={fieldClass}
          name="description"
          defaultValue={initial?.description ?? ""}
        />
      </label>
      <label className={labelClass}>
        {t("authoring.field.referenceAnswer")}
        <textarea
          className={fieldClass}
          name="referenceAnswer"
          defaultValue={
            typeof initial?.referenceAnswer === "string"
              ? initial.referenceAnswer
              : ""
          }
        />
      </label>
      <div className="grid gap-3 lg:grid-cols-2">
        <StructuredField
          name="objectives"
          label={t("authoring.field.objectivesJson")}
          value={initial?.objectives ?? []}
        />
        <StructuredField
          name="checklist"
          label={t("authoring.field.checklistJson")}
          value={initial?.checklist ?? []}
        />
        <StructuredField
          name="sources"
          label={t("authoring.field.sourcesJson")}
          value={initial?.sources ?? []}
        />
        <StructuredField
          name="questions"
          label={t("authoring.field.questionsJson")}
          value={initial?.questions ?? []}
        />
        <StructuredField
          name="misconceptions"
          label={t("authoring.field.misconceptionsJson")}
          value={initial?.misconceptions ?? []}
        />
        <StructuredField
          name="completionCriteria"
          label={t("authoring.field.completionCriteriaJson")}
          value={initial?.completionCriteria ?? [{ type: "acknowledgement" }]}
        />
        <StructuredField
          name="unlockRules"
          label={t("authoring.field.unlockRulesJson")}
          value={initial?.unlockRules ?? []}
        />
        <StructuredField
          key={`${initial?.id ?? "new"}-${type}`}
          name="payload"
          label={t("authoring.field.payloadJson")}
          value={
            initial && initial.type === type
              ? initial.payload
              : defaultPayload(type)
          }
        />
      </div>
      <SubmitError message={error} />
      <div>
        <Button disabled={busy} type="submit">
          {t(initial ? "authoring.unit.save" : "authoring.unit.add")}
        </Button>
      </div>
    </form>
  );
}

function designerLines(value: FormDataEntryValue | null): string[] {
  return String(value ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function designerSources(lines: readonly string[]) {
  return lines.map((locator, index) => ({
    id: `source:${index + 1}`,
    title: locator.slice(0, 500),
    kind: /^https?:\/\//u.test(locator)
      ? ("url-reference" as const)
      : ("provided-text" as const),
    locator,
    approved: true as const,
  }));
}

function displayedAuthoringDescription(value: string | null): string | null {
  if (!value) return null;
  return parseAuthoringBriefDescription(value)?.topicGoal ?? value;
}

const designerDraftSchema = z
  .object({
    goal: z.string().max(50_000),
    targetOutcome: z.string().max(50_000),
    currentLevel: z.string().max(50_000),
    constraints: z.string().max(50_000),
    sources: z.string().max(50_000),
    activityPreferences: z.string().max(50_000),
    runtimeRequirements: z.string().max(50_000),
    diagnosticAnswers: z.record(z.string(), z.string().max(50_000)),
    revisionRequest: z.string().max(50_000),
  })
  .strict();

type DesignerDraft = z.infer<typeof designerDraftSchema>;

function useDesignerDraft(versionId: string, initial: DesignerDraft) {
  const storageKey = `aptiloop:studio-designer:${versionId}`;
  const [state, setState] = useState<{
    storageKey: string | null;
    value: DesignerDraft;
  }>({ storageKey: null, value: initial });

  useEffect(() => {
    let restored = initial;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) {
        const parsed = designerDraftSchema.safeParse(JSON.parse(raw));
        if (parsed.success) restored = parsed.data;
      }
    } catch {
      // The controlled form remains usable when localStorage is unavailable.
    }
    setState({ storageKey, value: restored });
  }, [
    initial.activityPreferences,
    initial.constraints,
    initial.currentLevel,
    initial.goal,
    initial.runtimeRequirements,
    initial.sources,
    initial.targetOutcome,
    storageKey,
  ]);

  useEffect(() => {
    if (state.storageKey !== storageKey) return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(state.value));
    } catch {
      // Local persistence never changes server authority or blocks editing.
    }
  }, [state, storageKey]);

  const draft = state.storageKey === storageKey ? state.value : initial;
  const update = (patch: Partial<DesignerDraft>) =>
    setState((previous) => ({
      storageKey,
      value: {
        ...(previous.storageKey === storageKey ? previous.value : initial),
        ...patch,
      },
    }));
  const clear = () => {
    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      // The in-memory reset still succeeds when storage is unavailable.
    }
    setState({ storageKey, value: initial });
  };

  return { draft, update, clear };
}

function CourseDesignerPanel({
  graph,
  mutate,
  busy,
  initialGoal,
  onContinueManually,
}: {
  graph: Graph;
  mutate: Mutate;
  busy: boolean;
  initialGoal?: string;
  onContinueManually: () => void;
}) {
  const { locale, t } = useI18n();
  const queryClient = useQueryClient();
  const [working, setWorking] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generationController = useRef<AbortController | null>(null);
  const creationBrief = parseAuthoringBriefDescription(initialGoal);
  const initialConstraints = creationBrief
    ? [
        `${t("authoring.brief.primaryLocale")}: ${creationBrief.primaryLocale}`,
        `${t("authoring.brief.pacing")}: ${creationBrief.pacing}`,
        creationBrief.accessibility
          ? `${t("authoring.brief.accessibility")}: ${creationBrief.accessibility}`
          : "",
        creationBrief.constraints,
      ]
        .filter(Boolean)
        .join("\n")
    : undefined;
  const {
    draft: designerDraft,
    update: updateDesignerDraft,
    clear: clearDesignerDraft,
  } = useDesignerDraft(graph.version.id, {
    goal: creationBrief?.topicGoal ?? initialGoal ?? "",
    targetOutcome: creationBrief?.targetOutcome ?? "",
    currentLevel: creationBrief?.currentLevel ?? "",
    constraints: initialConstraints ?? "",
    sources: "",
    activityPreferences: "",
    runtimeRequirements: creationBrief?.tools ?? "",
    diagnosticAnswers: {},
    revisionRequest: "",
  });
  const workflows = useQuery({
    queryKey: ["curriculum-editor", "designer-workflows", graph.version.id],
    enabled: graph.version.status === "draft",
    queryFn: () =>
      checkedApi(
        `/curriculum-editor/versions/${encodeURIComponent(graph.version.id)}/designer/workflows`,
        courseDesignerWorkflowListSchema,
        t,
      ),
  });
  const proposals = useQuery({
    queryKey: ["curriculum-editor", "designer-proposals", graph.version.id],
    enabled: graph.version.status === "draft",
    queryFn: () =>
      checkedApi(
        `/curriculum-editor/versions/${encodeURIComponent(graph.version.id)}/designer/proposals`,
        courseProposalListSchema,
        t,
      ),
  });
  const activeWorkflow = workflows.data?.workflows[0] ?? null;
  const pendingDisclosureQuery = useQuery({
    queryKey: [
      "curriculum-editor",
      "designer-pending-disclosure",
      graph.version.id,
      activeWorkflow?.id ?? null,
    ],
    enabled:
      graph.version.status === "draft" &&
      activeWorkflow?.state === "CURRICULUM_PROPOSAL",
    queryFn: () =>
      checkedApi(
        `/curriculum-editor/versions/${encodeURIComponent(graph.version.id)}/designer/workflows/${encodeURIComponent(activeWorkflow?.id ?? "")}/disclosures`,
        CourseDesignerPendingDisclosureResponseSchema,
        t,
      ),
  });
  const pendingDisclosure =
    activeWorkflow?.state === "CURRICULUM_PROPOSAL"
      ? (pendingDisclosureQuery.data?.pendingDisclosure ?? null)
      : null;

  if (graph.version.status !== "draft") return null;

  const refreshDesigner = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["curriculum-editor", "designer-workflows", graph.version.id],
      }),
      queryClient.invalidateQueries({
        queryKey: ["curriculum-editor", "designer-proposals", graph.version.id],
      }),
    ]);
  };

  const advance = async (
    action:
      | "submit-request"
      | "complete-discovery"
      | "answer-diagnostic"
      | "skip-diagnostic"
      | "confirm-proposal"
      | "reject-proposal"
      | "request-revision",
    extra: Record<string, unknown> = {},
  ) => {
    if (!activeWorkflow) return;
    setError(null);
    try {
      await mutate(
        `/curriculum-editor/versions/${encodeURIComponent(graph.version.id)}/designer/workflows/${encodeURIComponent(activeWorkflow.id)}/advance`,
        { method: "POST", body: JSON.stringify({ action, ...extra }) },
        courseDesignerWorkflowResponseSchema,
      );
    } catch (cause) {
      setError(errorMessage(cause, t));
    }
  };

  const generate = async (
    workflowId: string,
    authoringOperationId: string,
    disclosureOperationId?: string,
  ) => {
    const controller = new AbortController();
    generationController.current = controller;
    setGenerating(true);
    try {
      await checkedApi(
        `/curriculum-editor/versions/${encodeURIComponent(graph.version.id)}/designer/workflows/${encodeURIComponent(workflowId)}/generate`,
        courseProposalResponseSchema,
        t,
        {
          method: "POST",
          body: JSON.stringify({
            operationId: authoringOperationId,
            ...(disclosureOperationId ? { disclosureOperationId } : {}),
          }),
          signal: controller.signal,
        },
      );
    } catch (cause) {
      if (controller.signal.aborted) {
        setError(t("authoring.designer.cancelled"));
        return;
      }
      throw cause;
    } finally {
      if (generationController.current === controller) {
        generationController.current = null;
      }
      setGenerating(false);
      await refreshDesigner();
    }
  };

  const requestProposal = async () => {
    if (!activeWorkflow) return;
    setWorking(true);
    setError(null);
    const authoringOperationId = operationId();
    try {
      const preparation = await checkedApi(
        `/curriculum-editor/versions/${encodeURIComponent(graph.version.id)}/designer/workflows/${encodeURIComponent(activeWorkflow.id)}/disclosures`,
        disclosurePreparationSchema,
        t,
        {
          method: "POST",
          body: JSON.stringify({ operationId: authoringOperationId }),
        },
      );
      if (preparation.required) {
        await pendingDisclosureQuery.refetch();
        return;
      }
      await generate(activeWorkflow.id, authoringOperationId);
    } catch (cause) {
      setError(errorMessage(cause, t));
      await refreshDesigner();
    } finally {
      setWorking(false);
    }
  };

  const finishDisclosure = async (approved: boolean) => {
    if (!pendingDisclosure) return;
    setWorking(true);
    setError(null);
    try {
      await checkedApi(
        `/ai/disclosures/${encodeURIComponent(pendingDisclosure.disclosure.operationId)}/${approved ? "approve" : "cancel"}`,
        z.object({ disclosure: AiDisclosureSchema }).strict(),
        t,
        { method: "POST", body: JSON.stringify({}) },
      );
      if (approved) {
        await generate(
          pendingDisclosure.workflowId,
          pendingDisclosure.operationId,
          pendingDisclosure.disclosure.operationId,
        );
      }
    } catch (cause) {
      setError(errorMessage(cause, t));
      await refreshDesigner();
    } finally {
      await pendingDisclosureQuery.refetch();
      setWorking(false);
    }
  };

  const proposalRows = proposals.data?.proposals ?? [];
  const activeProposal = activeWorkflow?.activeProposalId
    ? proposalRows.find(({ id }) => id === activeWorkflow.activeProposalId)
    : undefined;
  const disclosedSources = activeWorkflow?.request.sources ?? [];
  return (
    <section
      className={panelClass}
      aria-labelledby="course-designer-heading"
      data-slot="course-designer"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("authoring.designer.eyebrow")}
          </p>
          <h3 id="course-designer-heading" className="mt-1 font-medium">
            {t("authoring.designer.title")}
          </h3>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
            {t("authoring.designer.description")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">
            {t("authoring.designer.proposalOnly")}
          </Badge>
          {activeWorkflow ? (
            <Badge variant="secondary">
              {t(`authoring.designer.state.${activeWorkflow.state}`)}
            </Badge>
          ) : null}
        </div>
      </div>

      {workflows.isLoading || proposals.isLoading ? (
        <p
          className="mt-5 flex min-h-20 items-center gap-2 text-sm text-muted-foreground"
          role="status"
        >
          <Spinner />
          {t("authoring.designer.loading")}
        </p>
      ) : !activeWorkflow ? (
        <form
          className="mt-5 flex min-w-0 flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const sourceLines = designerLines(form.get("sources"));
            setError(null);
            void mutate(
              `/curriculum-editor/versions/${encodeURIComponent(graph.version.id)}/designer/workflows`,
              {
                method: "POST",
                body: JSON.stringify({
                  request: {
                    goal: String(form.get("goal") ?? "").trim(),
                    targetOutcome: String(
                      form.get("targetOutcome") ?? "",
                    ).trim(),
                    currentLevel: String(form.get("currentLevel") ?? "").trim(),
                    constraints: designerLines(form.get("constraints")),
                    sources: designerSources(sourceLines),
                    activityPreferences: designerLines(
                      form.get("activityPreferences"),
                    ),
                    runtimeRequirements: designerLines(
                      form.get("runtimeRequirements"),
                    ),
                  },
                }),
              },
              courseDesignerWorkflowResponseSchema,
            )
              .then(() => clearDesignerDraft())
              .catch((cause) => setError(errorMessage(cause, t)));
          }}
        >
          <FieldGroup className="grid gap-4 md:grid-cols-2">
            <Field className="md:col-span-2">
              <FieldLabel htmlFor="designer-goal">
                {t("authoring.designer.form.goal")}
              </FieldLabel>
              <Textarea
                id="designer-goal"
                className="min-h-28"
                name="goal"
                required
                maxLength={50_000}
                value={designerDraft.goal}
                onChange={(event) =>
                  updateDesignerDraft({ goal: event.target.value })
                }
                autoComplete="off"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="designer-target-outcome">
                {t("authoring.designer.form.targetOutcome")}
              </FieldLabel>
              <Textarea
                id="designer-target-outcome"
                className="min-h-24"
                name="targetOutcome"
                required
                maxLength={50_000}
                value={designerDraft.targetOutcome}
                onChange={(event) =>
                  updateDesignerDraft({ targetOutcome: event.target.value })
                }
                autoComplete="off"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="designer-current-level">
                {t("authoring.designer.form.currentLevel")}
              </FieldLabel>
              <Textarea
                id="designer-current-level"
                className="min-h-24"
                name="currentLevel"
                required
                maxLength={50_000}
                value={designerDraft.currentLevel}
                onChange={(event) =>
                  updateDesignerDraft({ currentLevel: event.target.value })
                }
                autoComplete="off"
              />
            </Field>
          </FieldGroup>

          <Collapsible className="group/advanced rounded-lg border border-border/70 bg-background">
            <CollapsibleTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                className="h-auto w-full justify-between gap-3 whitespace-normal px-4 py-3 text-left"
              >
                <span className="min-w-0 break-words">
                  {t("authoring.designer.form.constraints")} ·{" "}
                  {t("authoring.designer.form.sources")}
                </span>
                <CaretDownIcon
                  aria-hidden
                  className="shrink-0 transition-transform group-data-[state=open]/advanced:rotate-180 motion-reduce:transition-none"
                />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="border-t border-border/60 p-4">
              <FieldGroup className="grid gap-4 md:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="designer-constraints">
                    {t("authoring.designer.form.constraints")}
                  </FieldLabel>
                  <Textarea
                    id="designer-constraints"
                    className="min-h-24"
                    name="constraints"
                    value={designerDraft.constraints}
                    onChange={(event) =>
                      updateDesignerDraft({ constraints: event.target.value })
                    }
                    placeholder={t("authoring.designer.form.onePerLine")}
                    autoComplete="off"
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="designer-sources">
                    {t("authoring.designer.form.sources")}
                  </FieldLabel>
                  <Textarea
                    id="designer-sources"
                    className="min-h-24"
                    name="sources"
                    value={designerDraft.sources}
                    onChange={(event) =>
                      updateDesignerDraft({ sources: event.target.value })
                    }
                    placeholder={t("authoring.designer.form.sourcesHint")}
                    autoComplete="off"
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="designer-activities">
                    {t("authoring.designer.form.activities")}
                  </FieldLabel>
                  <Textarea
                    id="designer-activities"
                    className="min-h-24"
                    name="activityPreferences"
                    value={designerDraft.activityPreferences}
                    onChange={(event) =>
                      updateDesignerDraft({
                        activityPreferences: event.target.value,
                      })
                    }
                    placeholder={t("authoring.designer.form.onePerLine")}
                    autoComplete="off"
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="designer-runtime">
                    {t("authoring.designer.form.runtime")}
                  </FieldLabel>
                  <Textarea
                    id="designer-runtime"
                    className="min-h-24"
                    name="runtimeRequirements"
                    value={designerDraft.runtimeRequirements}
                    onChange={(event) =>
                      updateDesignerDraft({
                        runtimeRequirements: event.target.value,
                      })
                    }
                    placeholder={t("authoring.designer.form.onePerLine")}
                    autoComplete="off"
                  />
                </Field>
              </FieldGroup>
            </CollapsibleContent>
          </Collapsible>
          <div>
            <Button disabled={busy} type="submit">
              {t("authoring.designer.form.start")}
            </Button>
          </div>
        </form>
      ) : (
        <div className="mt-5 rounded-lg border border-border bg-background p-4">
          <p className="font-medium">{activeWorkflow.request.goal}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {activeWorkflow.request.targetOutcome}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {activeWorkflow.state === "DRAFT_REQUEST" ? (
              <Button
                type="button"
                disabled={busy}
                onClick={() => void advance("submit-request")}
              >
                {t("authoring.designer.action.submitRequest")}
              </Button>
            ) : null}
            {activeWorkflow.state === "DISCOVERY" ? (
              <Button
                type="button"
                disabled={busy}
                onClick={() => void advance("complete-discovery")}
              >
                {t("authoring.designer.action.completeDiscovery")}
              </Button>
            ) : null}
            {activeWorkflow.state === "CURRICULUM_PROPOSAL" ? (
              generating ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => generationController.current?.abort()}
                >
                  {t("authoring.designer.action.cancelGeneration")}
                </Button>
              ) : (
                <Button
                  type="button"
                  disabled={
                    busy ||
                    working ||
                    pendingDisclosureQuery.isFetching ||
                    Boolean(pendingDisclosure)
                  }
                  onClick={() => void requestProposal()}
                >
                  {t(
                    working
                      ? "authoring.designer.generating"
                      : "authoring.designer.generate",
                  )}
                </Button>
              )
            ) : null}
            {activeWorkflow.state === "FAILED" ? (
              <>
                <Button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setError(null);
                    void mutate(
                      `/curriculum-editor/versions/${encodeURIComponent(graph.version.id)}/designer/workflows/${encodeURIComponent(activeWorkflow.id)}/retry`,
                      { method: "POST", body: JSON.stringify({}) },
                      courseDesignerWorkflowResponseSchema,
                    ).catch((cause) => setError(errorMessage(cause, t)));
                  }}
                >
                  {t("authoring.designer.action.retry")}
                </Button>
                <Button type="button" variant="outline" asChild>
                  <Link href="/settings?section=ai">
                    {t("authoring.designer.action.configureAi")}
                  </Link>
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={onContinueManually}
                >
                  {t("authoring.designer.action.continueManually")}
                </Button>
                <Button type="button" variant="ghost" asChild>
                  <Link href="/courses">
                    <ArrowLeftIcon aria-hidden />
                    {t("authoring.common.back")}
                  </Link>
                </Button>
              </>
            ) : null}
          </div>

          {activeWorkflow.state === "DIAGNOSTIC" ? (
            <div className="mt-5 grid gap-3">
              <h4 className="font-medium">
                {t("authoring.designer.diagnosticTitle")}
              </h4>
              {activeWorkflow.diagnostic.questions.map((question) => (
                <label className={labelClass} key={question.id}>
                  {question.prompt}
                  <textarea
                    className={`${fieldClass} min-h-20`}
                    value={designerDraft.diagnosticAnswers[question.id] ?? ""}
                    onChange={(event) =>
                      updateDesignerDraft({
                        diagnosticAnswers: {
                          ...designerDraft.diagnosticAnswers,
                          [question.id]: event.target.value,
                        },
                      })
                    }
                  />
                </label>
              ))}
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  disabled={
                    busy ||
                    activeWorkflow.diagnostic.questions.some(
                      ({ id }) => !designerDraft.diagnosticAnswers[id]?.trim(),
                    )
                  }
                  onClick={() => {
                    void advance("answer-diagnostic", {
                      answers: designerDraft.diagnosticAnswers,
                    }).then(() =>
                      updateDesignerDraft({ diagnosticAnswers: {} }),
                    );
                  }}
                >
                  {t("authoring.designer.action.answerDiagnostic")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void advance("skip-diagnostic")}
                >
                  {t("authoring.designer.action.skipDiagnostic")}
                </Button>
              </div>
            </div>
          ) : null}

          {activeWorkflow.state === "USER_REVIEW" && activeProposal ? (
            <div className="mt-5 grid gap-3 border-t border-border pt-4">
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  disabled={
                    busy ||
                    activeProposal.attribution?.validation.valid === false
                  }
                  onClick={() => void advance("confirm-proposal")}
                >
                  {t("authoring.designer.action.confirm")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void advance("reject-proposal")}
                >
                  {t("authoring.designer.reject")}
                </Button>
              </div>
              <label className={labelClass}>
                {t("authoring.designer.revisionLabel")}
                <textarea
                  className={`${fieldClass} min-h-20`}
                  value={designerDraft.revisionRequest}
                  onChange={(event) =>
                    updateDesignerDraft({
                      revisionRequest: event.target.value,
                    })
                  }
                />
              </label>
              <div>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy || !designerDraft.revisionRequest.trim()}
                  onClick={() => {
                    void advance("request-revision", {
                      revisionRequest: designerDraft.revisionRequest.trim(),
                    }).then(() => updateDesignerDraft({ revisionRequest: "" }));
                  }}
                >
                  {t("authoring.designer.action.requestRevision")}
                </Button>
              </div>
            </div>
          ) : null}

          {activeWorkflow.state === "COMPILATION" && activeProposal ? (
            <div className="mt-5 border-t border-border pt-4">
              <Button
                type="button"
                disabled={busy}
                onClick={() => {
                  setError(null);
                  void mutate(
                    `/curriculum-editor/versions/${encodeURIComponent(graph.version.id)}/designer/workflows/${encodeURIComponent(activeWorkflow.id)}/proposals/${encodeURIComponent(activeProposal.id)}/apply`,
                    { method: "POST", body: JSON.stringify({}) },
                    z
                      .object({
                        workflow: CourseDesignerWorkflowSchema,
                        proposal: courseProposalRecordSchema,
                        curriculum: graphSchema,
                        validation: validationReportSchema,
                      })
                      .strict(),
                  ).catch((cause) => setError(errorMessage(cause, t)));
                }}
              >
                {t("authoring.designer.apply")}
              </Button>
            </div>
          ) : null}

          {activeWorkflow.state === "VALIDATION" ? (
            <p className="mt-4 text-sm text-muted-foreground">
              {t("authoring.designer.validationPending")}
            </p>
          ) : null}
          {activeWorkflow.state === "FAILED" ? (
            <p className="mt-4 text-sm text-destructive" role="alert">
              {activeWorkflow.failureMessage ?? t("authoring.designer.failed")}
            </p>
          ) : null}
        </div>
      )}

      {pendingDisclosure ? (
        <div
          className="mt-5 rounded-lg border border-warning/40 bg-warning/5 p-4"
          role="alert"
        >
          <h4 className="font-medium">
            {t("authoring.designer.disclosureTitle")}
          </h4>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {t("authoring.designer.disclosureDescription")}
          </p>
          <dl className="mt-4 grid min-w-0 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            {(
              [
                [
                  "authoring.designer.disclosure.role",
                  pendingDisclosure.disclosure.scope.role,
                ],
                [
                  "authoring.designer.disclosure.connection",
                  pendingDisclosure.disclosure.scope.connectionId,
                ],
                [
                  "authoring.designer.disclosure.provider",
                  pendingDisclosure.disclosure.scope.providerType,
                ],
                [
                  "authoring.designer.disclosure.model",
                  pendingDisclosure.disclosure.scope.modelId,
                ],
                [
                  "authoring.designer.disclosure.destination",
                  pendingDisclosure.disclosure.scope.destination,
                ],
                [
                  "authoring.designer.disclosure.payload",
                  pendingDisclosure.disclosure.scope.payloadCategories.join(
                    ", ",
                  ),
                ],
                [
                  "authoring.designer.disclosure.bytes",
                  pendingDisclosure.disclosure.scope.byteCount.toLocaleString(
                    locale,
                  ),
                ],
                [
                  "authoring.designer.disclosure.expires",
                  new Intl.DateTimeFormat(locale, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(new Date(pendingDisclosure.disclosure.expiresAt)),
                ],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="min-w-0">
                <dt className="text-xs font-medium text-muted-foreground">
                  {t(label)}
                </dt>
                <dd className="mt-1 break-all text-foreground">{value}</dd>
              </div>
            ))}
            <div className="min-w-0 sm:col-span-2">
              <dt className="text-xs font-medium text-muted-foreground">
                {t("authoring.designer.disclosure.scope")}
              </dt>
              <dd className="mt-1 grid gap-1">
                {Object.entries(
                  pendingDisclosure.disclosure.scope.entityIds,
                ).map(([kind, id]) => (
                  <span key={kind} className="break-all text-foreground">
                    {kind}: {id}
                  </span>
                ))}
              </dd>
            </div>
            {disclosedSources.length > 0 ? (
              <div className="min-w-0 sm:col-span-2">
                <dt className="text-xs font-medium text-muted-foreground">
                  {t("authoring.designer.disclosure.sources")}
                </dt>
                <dd className="mt-1 grid gap-1">
                  {disclosedSources.map((source) => (
                    <span key={source.id} className="break-all text-foreground">
                      {source.id}: {source.title}
                    </span>
                  ))}
                </dd>
              </div>
            ) : null}
            <div className="min-w-0 sm:col-span-2">
              <dt className="text-xs font-medium text-muted-foreground">
                {t("authoring.designer.disclosure.exclusions")}
              </dt>
              <dd className="mt-1 break-words text-foreground">
                {pendingDisclosure.disclosure.scope.exclusions.join("; ")}
              </dd>
            </div>
          </dl>
          <p className="mt-4 text-xs leading-5 text-muted-foreground">
            {t("authoring.designer.disclosure.retention")}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={working}
              onClick={() => void finishDisclosure(true)}
            >
              {t("authoring.designer.disclosureApprove")}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={working}
              onClick={() => void finishDisclosure(false)}
            >
              {t("authoring.designer.disclosureCancel")}
            </Button>
          </div>
        </div>
      ) : null}

      <SubmitError message={error} />
      {workflows.isError ||
      proposals.isError ||
      (activeWorkflow?.state === "CURRICULUM_PROPOSAL" &&
        pendingDisclosureQuery.isError) ? (
        <div className="mt-5">
          <QueryError
            message={t("authoring.designer.proposalsUnavailable")}
            retry={() => {
              void Promise.all([
                refreshDesigner(),
                pendingDisclosureQuery.refetch(),
              ]);
            }}
          />
        </div>
      ) : proposalRows.length > 0 ? (
        <div className="mt-6 grid gap-3">
          <h4 className="font-medium">
            {t("authoring.designer.proposalsTitle")}
          </h4>
          {proposalRows.map((record) => (
            <Collapsible
              key={record.id}
              className="group/proposal rounded-xl border border-border/60 bg-surface-soft/35"
            >
              <div className="flex min-w-0 flex-wrap items-start justify-between gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <p className="break-words font-medium">
                    {record.proposal.summary}
                  </p>
                  <CollapsibleTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="-ml-2 mt-1 h-auto max-w-full justify-start whitespace-normal text-left text-xs text-muted-foreground"
                    >
                      {t("authoring.designer.changeCount", {
                        count:
                          record.proposal.changes.length.toLocaleString(locale),
                      })}
                      <CaretDownIcon
                        aria-hidden
                        data-icon="inline-end"
                        className="shrink-0 transition-transform group-data-[state=open]/proposal:rotate-180 motion-reduce:transition-none"
                      />
                    </Button>
                  </CollapsibleTrigger>
                </div>
                <Badge
                  className="shrink-0"
                  variant={
                    record.status === "applied"
                      ? "success"
                      : record.status === "rejected"
                        ? "error"
                        : "warning"
                  }
                >
                  {t(`authoring.designer.status.${record.status}`)}
                </Badge>
              </div>
              <CollapsibleContent className="border-t border-border/60 p-4 pt-3">
                <ul className="grid min-w-0 gap-2 text-sm">
                  {record.proposal.changes.map((change, index) => {
                    const target =
                      "stableId" in change
                        ? change.stableId
                        : change.targetStableId;
                    const title = "title" in change ? change.title : undefined;
                    return (
                      <li
                        key={`${record.id}:${index}`}
                        className="min-w-0 break-words rounded-lg bg-card px-3 py-2 shadow-sm"
                      >
                        <span className="font-medium">
                          {t(`authoring.designer.change.${change.kind}`)}
                        </span>{" "}
                        · {title ? `${title} · ` : null}
                        <code className="break-all">{target}</code>
                      </li>
                    );
                  })}
                </ul>
                {record.attribution ? (
                  <div className="mt-4 min-w-0 break-words rounded-lg bg-card p-3 text-xs text-muted-foreground shadow-sm">
                    <p>
                      {t("authoring.designer.attribution", {
                        provider: record.attribution.providerType,
                        model: record.attribution.modelId,
                        version: record.attribution.promptTemplateVersion,
                      })}
                    </p>
                    <p className="mt-1">
                      {t("authoring.designer.provenance", {
                        count:
                          record.attribution.provenance.sourceIds.length.toLocaleString(
                            locale,
                          ),
                      })}
                    </p>
                    <p className="mt-1">
                      {t(
                        record.attribution.validation.valid
                          ? "authoring.designer.validProposal"
                          : "authoring.designer.invalidProposal",
                        {
                          errors:
                            record.attribution.validation.errors.toLocaleString(
                              locale,
                            ),
                          warnings:
                            record.attribution.validation.warnings.toLocaleString(
                              locale,
                            ),
                        },
                      )}
                    </p>
                  </div>
                ) : null}
              </CollapsibleContent>
            </Collapsible>
          ))}
        </div>
      ) : (
        <p className="mt-5 text-sm text-muted-foreground">
          {t("authoring.designer.empty")}
        </p>
      )}
    </section>
  );
}

function StudioPreviewPanel({ version }: { version: Version }) {
  const { locale, t } = useI18n();
  const preview = useQuery({
    queryKey: [
      "curriculum-editor",
      "learner-preview",
      version.id,
      version.updatedAt,
    ],
    queryFn: () =>
      checkedApi(
        `/curriculum-editor/versions/${encodeURIComponent(version.id)}/preview`,
        previewResponseSchema,
        t,
      ),
  });

  if (preview.isLoading) {
    return <LoadingState label="authoring.preview.loading" variant="panel" />;
  }

  if (preview.isError || !preview.data) {
    return (
      <QueryError
        message={t("authoring.preview.unavailable")}
        retry={() => void preview.refetch()}
      />
    );
  }

  const learnerPreview = preview.data.preview;
  const creationBrief = parseAuthoringBriefDescription(
    learnerPreview.description,
  );
  const description = creationBrief?.topicGoal ?? learnerPreview.description;
  const firstLesson = learnerPreview.weeks
    .flatMap((week) => week.days)
    .at(0)?.stableId;

  return (
    <section
      data-slot="adaptive-studio-preview"
      aria-labelledby="studio-preview-heading"
      className={`${panelClass} grid min-w-0 gap-5`}
    >
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-primary">
            {t("authoring.preview.eyebrow")}
          </p>
          <h3
            id="studio-preview-heading"
            className="mt-2 break-words text-xl font-semibold [overflow-wrap:anywhere]"
          >
            {learnerPreview.title}
          </h3>
          {description ? (
            <p className="mt-2 max-w-[70ch] break-words text-sm leading-6 text-muted-foreground [overflow-wrap:anywhere]">
              {description}
            </p>
          ) : null}
        </div>
        <Badge className="shrink-0" variant="outline">
          {t(versionStatusMessageKeys[version.status])}
        </Badge>
      </div>

      {learnerPreview.weeks.length === 0 ? (
        <EmptyState
          title={t("authoring.preview.emptyTitle")}
          description={t("authoring.preview.emptyDescription")}
        />
      ) : (
        <div className="grid min-w-0 gap-6">
          {learnerPreview.weeks.map((week) => (
            <section
              key={week.stableId}
              className="min-w-0"
              aria-labelledby={`preview-week-${week.stableId}`}
            >
              <div className="mb-3 min-w-0">
                <h4
                  id={`preview-week-${week.stableId}`}
                  className="break-words font-semibold [overflow-wrap:anywhere]"
                >
                  {week.title}
                </h4>
                {week.description ? (
                  <p className="mt-1 max-w-[70ch] break-words text-sm leading-6 text-muted-foreground [overflow-wrap:anywhere]">
                    {week.description}
                  </p>
                ) : null}
              </div>
              <Accordion
                type="single"
                collapsible
                {...(firstLesson ? { defaultValue: firstLesson } : {})}
                className="rounded-[14px] bg-background/70 px-3 sm:px-4"
              >
                {week.days.map((day) => (
                  <AccordionItem key={day.stableId} value={day.stableId}>
                    <AccordionTrigger
                      headingLevel={5}
                      className="min-w-0 px-1 no-underline hover:no-underline"
                    >
                      <span className="min-w-0">
                        <span className="block break-words [overflow-wrap:anywhere]">
                          {day.title}
                        </span>
                        <span className="mt-1 block text-xs font-normal text-muted-foreground">
                          {t("authoring.preview.lessonMeta", {
                            activities:
                              day.activities.length.toLocaleString(locale),
                            minutes:
                              day.estimatedMinutes.toLocaleString(locale),
                          })}
                        </span>
                      </span>
                    </AccordionTrigger>
                    <AccordionContent className="grid min-w-0 gap-4 px-1">
                      <div className="max-w-[70ch] min-w-0">
                        <p className="break-words text-sm leading-6 [overflow-wrap:anywhere]">
                          {day.goal}
                        </p>
                        {day.description ? (
                          <p className="mt-2 break-words text-sm leading-6 text-muted-foreground [overflow-wrap:anywhere]">
                            {day.description}
                          </p>
                        ) : null}
                      </div>
                      <ol className="min-w-0 divide-y divide-border/50 rounded-lg bg-surface-soft/45 px-3">
                        {day.activities.map((activity, index) => (
                          <li
                            key={activity.stableId}
                            className="grid min-w-0 gap-1 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-4"
                          >
                            <div className="min-w-0">
                              <p className="break-words font-medium [overflow-wrap:anywhere]">
                                {index + 1}. {activity.title}
                              </p>
                              {activity.description ? (
                                <p className="mt-1 break-words text-sm leading-6 text-muted-foreground [overflow-wrap:anywhere]">
                                  {activity.description}
                                </p>
                              ) : null}
                            </div>
                            <Badge
                              variant="secondary"
                              className="w-fit self-start"
                            >
                              {t(unitTypeMessageKeys[activity.type])}
                            </Badge>
                          </li>
                        ))}
                      </ol>
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}

const emptyReleaseEvidence: ReleaseEvidence = {
  validation: null,
  preview: null,
  review: null,
};

function useReleaseEvidence(version: Version) {
  const storageKey = `aptiloop:studio-release:${version.id}:${version.updatedAt}`;
  const [state, setState] = useState<{
    storageKey: string | null;
    evidence: ReleaseEvidence;
  }>({ storageKey: null, evidence: emptyReleaseEvidence });

  useEffect(() => {
    let evidence = emptyReleaseEvidence;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) {
        const parsed = releaseEvidenceSchema.safeParse(JSON.parse(raw));
        if (parsed.success) evidence = parsed.data;
      }
    } catch {
      // Release checks remain repeatable when localStorage is unavailable.
    }
    setState({ storageKey, evidence });
  }, [storageKey]);

  useEffect(() => {
    if (state.storageKey !== storageKey) return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(state.evidence));
    } catch {
      // Server-side publication revalidates every hash; persistence is UX only.
    }
  }, [state, storageKey]);

  const evidence =
    state.storageKey === storageKey ? state.evidence : emptyReleaseEvidence;
  const update = (patch: Partial<ReleaseEvidence>) =>
    setState((previous) => ({
      storageKey,
      evidence: {
        ...(previous.storageKey === storageKey
          ? previous.evidence
          : emptyReleaseEvidence),
        ...patch,
      },
    }));
  const clear = () => {
    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      // The current view still clears after a confirmed publication.
    }
    setState({ storageKey, evidence: emptyReleaseEvidence });
  };
  return { ...evidence, update, clear };
}

function PublishPanel({
  version,
  mutate,
  busy,
}: {
  version: Version;
  mutate: Mutate;
  busy: boolean;
}) {
  const { t } = useI18n();
  const [confirmed, setConfirmed] = useState(false);
  const [checking, setChecking] = useState<
    "validation" | "preview" | "change-review" | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const { validation, preview, review, update, clear } =
    useReleaseEvidence(version);
  useEffect(() => {
    setConfirmed(false);
  }, [version.id, version.updatedAt]);
  if (version.status !== "draft") return null;

  const inspect = async <T,>(
    suffix: "validation" | "preview" | "change-review",
    schema: z.ZodType<T>,
  ): Promise<T> => {
    setChecking(suffix);
    setError(null);
    try {
      return await checkedApi(
        `/curriculum-editor/versions/${encodeURIComponent(version.id)}/${suffix}`,
        schema,
        t,
      );
    } catch (cause) {
      setError(errorMessage(cause, t));
      throw cause;
    } finally {
      setChecking(null);
    }
  };
  const releaseReady =
    validation?.valid === true &&
    preview?.draftHash === validation.draftHash &&
    review?.ready === true &&
    review.draftHash === validation.draftHash;

  return (
    <section
      className={`${panelClass} grid gap-6`}
      aria-labelledby="publish-heading"
      data-slot="adaptive-studio-release"
    >
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-primary">
          {t("authoring.release.eyebrow")}
        </p>
        <h3 id="publish-heading" className="mt-2 text-lg font-semibold">
          {t("authoring.publish.title")}
        </h3>
        <p className="mt-1 max-w-[70ch] text-sm leading-6 text-muted-foreground">
          {t("authoring.publish.description")}
        </p>
      </div>

      <ol className="divide-y divide-border/60 overflow-hidden rounded-[14px] border border-border/60 bg-surface-soft/35">
        <li className="p-4 sm:p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="font-medium">
                {t("authoring.release.validateTitle")}
              </p>
              <p className="mt-1 max-w-[62ch] text-sm leading-6 text-muted-foreground">
                {t("authoring.release.validateDescription")}
              </p>
            </div>
            <Button
              className="w-full shrink-0 sm:w-auto"
              type="button"
              variant="outline"
              disabled={busy || checking !== null}
              onClick={() => {
                void inspect("validation", validationResponseSchema)
                  .then(({ report }) => update({ validation: report }))
                  .catch(() => undefined);
              }}
            >
              {checking === "validation" ? (
                <Spinner data-icon="inline-start" />
              ) : null}
              {t(
                checking === "validation"
                  ? "authoring.release.checking"
                  : "authoring.release.validateAction",
              )}
            </Button>
          </div>
          {validation ? (
            <div className="mt-4 text-sm" role="status">
              <Badge variant={validation.valid ? "success" : "error"}>
                {validation.valid
                  ? t("authoring.release.passed")
                  : t("authoring.release.blocked")}
              </Badge>
              <Collapsible className="group/release-validation mt-2">
                <CollapsibleTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="-ml-2 h-auto max-w-full justify-start whitespace-normal text-left text-muted-foreground"
                  >
                    {t("authoring.release.diagnosticCounts", {
                      errors: validation.errors,
                      warnings: validation.warnings,
                    })}
                    <CaretDownIcon
                      aria-hidden
                      data-icon="inline-end"
                      className="shrink-0 transition-transform group-data-[state=open]/release-validation:rotate-180 motion-reduce:transition-none"
                    />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  {validation.diagnostics.length ? (
                    <ul className="mt-2 divide-y divide-border/60 rounded-lg bg-card px-3">
                      {validation.diagnostics.map((diagnostic) => (
                        <li
                          className="min-w-0 break-words py-2"
                          key={`${diagnostic.code}:${diagnostic.path}`}
                        >
                          <span className="break-all font-medium">
                            {diagnostic.path}
                          </span>
                          : {diagnostic.message}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </CollapsibleContent>
              </Collapsible>
            </div>
          ) : null}
        </li>

        <li className="p-4 sm:p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="font-medium">
                {t("authoring.release.previewTitle")}
              </p>
              <p className="mt-1 max-w-[62ch] text-sm leading-6 text-muted-foreground">
                {t("authoring.release.previewDescription")}
              </p>
            </div>
            <Button
              className="w-full shrink-0 sm:w-auto"
              type="button"
              variant="outline"
              disabled={busy || checking !== null}
              onClick={() => {
                void inspect("preview", previewResponseSchema)
                  .then(({ preview: nextPreview }) =>
                    update({ preview: nextPreview }),
                  )
                  .catch(() => undefined);
              }}
            >
              {checking === "preview" ? (
                <Spinner data-icon="inline-start" />
              ) : null}
              {t(
                checking === "preview"
                  ? "authoring.release.checking"
                  : "authoring.release.previewAction",
              )}
            </Button>
          </div>
          {preview ? (
            <Collapsible className="group/release-preview mt-4 text-sm">
              <CollapsibleTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-auto w-full justify-between gap-3 whitespace-normal px-0 py-3 text-left"
                >
                  <span className="min-w-0 break-words">{preview.title}</span>
                  <CaretDownIcon
                    aria-hidden
                    className="shrink-0 transition-transform group-data-[state=open]/release-preview:rotate-180 motion-reduce:transition-none"
                  />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <ul className="divide-y divide-border/60 rounded-lg bg-card px-3 text-muted-foreground">
                  {preview.weeks.map((week) => (
                    <li
                      className="min-w-0 break-words py-2"
                      key={week.stableId}
                    >
                      {week.title} ·{" "}
                      {t("authoring.release.dayCount", {
                        count: week.days.length,
                      })}
                    </li>
                  ))}
                </ul>
              </CollapsibleContent>
            </Collapsible>
          ) : null}
        </li>

        <li className="p-4 sm:p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="font-medium">
                {t("authoring.release.reviewTitle")}
              </p>
              <p className="mt-1 max-w-[62ch] text-sm leading-6 text-muted-foreground">
                {t("authoring.release.reviewDescription")}
              </p>
            </div>
            <Button
              className="w-full shrink-0 sm:w-auto"
              type="button"
              variant="outline"
              disabled={busy || checking !== null}
              onClick={() => {
                void inspect("change-review", changeReviewResponseSchema)
                  .then(({ review: nextReview }) =>
                    update({ review: nextReview }),
                  )
                  .catch(() => undefined);
              }}
            >
              {checking === "change-review" ? (
                <Spinner data-icon="inline-start" />
              ) : null}
              {t(
                checking === "change-review"
                  ? "authoring.release.checking"
                  : "authoring.release.reviewAction",
              )}
            </Button>
          </div>
          {review ? (
            <div className="mt-4 grid gap-3 text-sm" role="status">
              <p className="text-muted-foreground">
                {t("authoring.release.changeCounts", {
                  added: review.added,
                  changed: review.changed,
                  removed: review.removed,
                })}
              </p>
              {review.changes.length ? (
                <ul className="divide-y divide-border/60 border-y border-border/60">
                  {review.changes.map((change) => (
                    <li
                      key={`${change.operation}:${change.entityType}:${change.stableId}`}
                      className="flex min-w-0 flex-wrap items-center gap-2 py-2"
                    >
                      <Badge variant="secondary">
                        {t(
                          `authoring.release.change.${change.operation}` as MessageKey,
                        )}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {t(
                          `authoring.release.entity.${change.entityType}` as MessageKey,
                        )}
                      </span>
                      <code className="min-w-0 break-words text-xs [overflow-wrap:anywhere]">
                        {change.stableId}
                      </code>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </li>
      </ol>

      <div className="border-t border-border/60 pt-5">
        <label className="flex min-h-11 items-start gap-3 text-sm leading-6">
          <input
            className="mt-1 size-4 shrink-0 accent-primary"
            type="checkbox"
            checked={confirmed}
            disabled={!releaseReady}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          <span>{t("authoring.publish.confirmation")}</span>
        </label>
        {!releaseReady ? (
          <p className="mt-2 text-sm text-muted-foreground">
            {t("authoring.release.required")}
          </p>
        ) : (
          <Badge className="mt-2" variant="success">
            {t("authoring.release.ready")}
          </Badge>
        )}
        <SubmitError message={error} />
        <Button
          className="mt-4 w-full max-w-full whitespace-normal text-center sm:w-auto"
          disabled={busy || checking !== null || !confirmed || !releaseReady}
          onClick={() => {
            if (!validation || !preview || !review) return;
            setError(null);
            void mutate(
              `/curriculum-editor/versions/${encodeURIComponent(version.id)}/publish`,
              {
                method: "POST",
                body: JSON.stringify({
                  operationId: operationId(),
                  validationHash: validation.validationHash,
                  previewHash: preview.draftHash,
                  changeReviewHash: review.changeReviewHash,
                }),
              },
              z.object({ version: versionSchema }).strict(),
            )
              .then(() => clear())
              .catch((cause) => setError(errorMessage(cause, t)));
          }}
        >
          {busy ? <Spinner data-icon="inline-start" /> : null}
          {t(
            busy ? "authoring.publish.publishing" : "authoring.publish.submit",
          )}
        </Button>
      </div>
    </section>
  );
}

function GraphEditor({
  graph,
  mutate,
  busy,
}: {
  graph: Graph;
  mutate: Mutate;
  busy: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [addWeek, setAddWeek] = useState(false);
  const editable = graph.version.status === "draft";
  const requestedWeekId = searchParams.get("week");
  const openWeekId =
    graph.weeks.find((week) => week.id === requestedWeekId)?.id ??
    graph.weeks[0]?.id ??
    "";
  const requestedDayId = searchParams.get("day");
  const selectStructure = (weekId: string, dayId?: string) => {
    const next = new URLSearchParams(searchParams.toString());
    if (weekId) next.set("week", weekId);
    else next.delete("week");
    if (dayId) next.set("day", dayId);
    else next.delete("day");
    router.replace(`/courses/studio?${next.toString()}`, { scroll: false });
  };
  const reorder = (
    path: string,
    ids: string[],
    index: number,
    direction: -1 | 1,
  ) => {
    const orderedIds = [...ids];
    [orderedIds[index], orderedIds[index + direction]] = [
      orderedIds[index + direction]!,
      orderedIds[index]!,
    ];
    return mutate(
      path,
      {
        method: "POST",
        body: JSON.stringify({ operationId: operationId(), orderedIds }),
      },
      z.object({ curriculum: graphSchema }).strict(),
    );
  };
  const remove = (path: string) =>
    mutate(
      path,
      {
        method: "DELETE",
        body: JSON.stringify({ operationId: operationId() }),
      },
      z.object({ deleted: z.literal(true) }).strict(),
    );
  return (
    <section
      className={`${focusPanelClass} grid gap-4`}
      aria-labelledby="manual-editor-heading"
      data-slot="manual-course-editor"
    >
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-primary">
          {t("authoring.manual.eyebrow")}
        </p>
        <h3 id="manual-editor-heading" className="mt-2 text-lg font-semibold">
          {t("authoring.manual.title")}
        </h3>
        <p className="mt-1 max-w-[70ch] text-sm leading-6 text-muted-foreground">
          {t("authoring.manual.description")}
        </p>
      </header>
      {!editable ? (
        <div className="rounded-lg border border-border bg-muted/40 p-4 text-sm">
          <strong>{t("authoring.graph.readOnly.title")}</strong>{" "}
          {t("authoring.graph.readOnly.description")}
        </div>
      ) : null}
      {graph.weeks.length === 0 ? (
        <EmptyState
          title={t("authoring.graph.empty.title")}
          description={t("authoring.graph.empty.description")}
        />
      ) : null}
      {graph.weeks.length > 0 ? (
        <Accordion
          type="single"
          collapsible
          value={openWeekId}
          onValueChange={(weekId) => {
            const firstDayId = graph.weeks.find(({ id }) => id === weekId)
              ?.days[0]?.id;
            selectStructure(weekId, firstDayId);
          }}
          className="grid min-w-0 gap-2"
        >
          {graph.weeks.map((week, weekIndex) => (
            <WeekEditor
              key={week.id}
              versionId={graph.version.id}
              week={week}
              index={weekIndex}
              siblings={graph.weeks}
              editable={editable}
              busy={busy}
              mutate={mutate}
              reorder={reorder}
              remove={remove}
              requestedDayId={
                openWeekId === week.id ? (requestedDayId ?? null) : null
              }
              onDayChange={(dayId) => selectStructure(week.id, dayId)}
            />
          ))}
        </Accordion>
      ) : null}
      {editable ? (
        addWeek ? (
          <WeekForm
            versionId={graph.version.id}
            mutate={mutate}
            busy={busy}
            onClose={() => setAddWeek(false)}
          />
        ) : (
          <div>
            <Button variant="outline" onClick={() => setAddWeek(true)}>
              <PlusIcon aria-hidden />
              {t("authoring.week.add")}
            </Button>
          </div>
        )
      ) : null}
    </section>
  );
}

type Reorder = (
  path: string,
  ids: string[],
  index: number,
  direction: -1 | 1,
) => Promise<unknown>;
type Remove = (path: string) => Promise<unknown>;

function WeekEditor({
  versionId,
  week,
  index,
  siblings,
  editable,
  busy,
  mutate,
  reorder,
  remove,
  requestedDayId,
  onDayChange,
}: {
  versionId: string;
  week: Week;
  index: number;
  siblings: Week[];
  editable: boolean;
  busy: boolean;
  mutate: Mutate;
  reorder: Reorder;
  remove: Remove;
  requestedDayId?: string | null;
  onDayChange: (dayId: string) => void;
}) {
  const { locale, t } = useI18n();
  const [edit, setEdit] = useState(false);
  const [addDay, setAddDay] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const openDayId =
    week.days.find((day) => day.id === requestedDayId)?.id ??
    week.days[0]?.id ??
    "";
  return (
    <AccordionItem
      value={week.id}
      className="min-w-0 overflow-hidden rounded-[14px] border border-border/60 bg-card"
      data-editor-week={week.id}
    >
      <div className="flex min-w-0 items-start gap-2 px-4 sm:px-5">
        <AccordionTrigger
          headingLevel={3}
          className="min-w-0 flex-1 py-4 hover:no-underline sm:py-5"
        >
          <span className="min-w-0 text-left">
            <span className="block break-all text-xs font-normal text-muted-foreground">
              {t("authoring.week.meta", {
                number: (index + 1).toLocaleString(locale),
                id: week.stableId,
              })}
            </span>
            <span className="mt-1 block break-words text-base font-semibold sm:text-lg">
              {week.title}
            </span>
            {week.description ? (
              <span className="mt-1 block break-words text-sm font-normal text-muted-foreground">
                {week.description}
              </span>
            ) : null}
          </span>
        </AccordionTrigger>
        {editable ? (
          <div className="flex shrink-0 items-center gap-1 py-4 sm:py-5">
            <ReorderControls
              label={t("authoring.entity.week", { title: week.title })}
              index={index}
              count={siblings.length}
              disabled={busy}
              move={(direction) => {
                setError(null);
                void reorder(
                  `/curriculum-editor/versions/${encodeURIComponent(versionId)}/weeks/reorder`,
                  siblings.map(({ id }) => id),
                  index,
                  direction,
                ).catch((cause) => setError(errorMessage(cause, t)));
              }}
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setEdit((value) => !value)}
            >
              {t("authoring.common.edit")}
            </Button>
            <DeleteAction
              label={t("authoring.entity.week", { title: week.title })}
              consequence={t("authoring.delete.weekConsequence")}
              busy={busy}
              onConfirm={() =>
                remove(
                  `/curriculum-editor/versions/${encodeURIComponent(versionId)}/weeks/${encodeURIComponent(week.id)}`,
                )
              }
            />
          </div>
        ) : null}
      </div>
      <AccordionContent className="px-4 sm:px-5">
        <SubmitError message={error} />
        {edit ? (
          <div className="mb-4">
            <WeekForm
              versionId={versionId}
              initial={week}
              mutate={mutate}
              busy={busy}
              onClose={() => setEdit(false)}
            />
          </div>
        ) : null}
        <div className="grid min-w-0 gap-3">
          {week.days.length > 0 ? (
            <Accordion
              type="single"
              collapsible
              value={openDayId}
              onValueChange={onDayChange}
              className="grid min-w-0 gap-2"
            >
              {week.days.map((day, dayIndex) => (
                <DayEditor
                  key={day.id}
                  versionId={versionId}
                  weekId={week.id}
                  day={day}
                  index={dayIndex}
                  siblings={week.days}
                  editable={editable}
                  busy={busy}
                  mutate={mutate}
                  reorder={reorder}
                  remove={remove}
                />
              ))}
            </Accordion>
          ) : null}
          {editable ? (
            addDay ? (
              <DayForm
                versionId={versionId}
                weekId={week.id}
                mutate={mutate}
                busy={busy}
                onClose={() => setAddDay(false)}
              />
            ) : (
              <div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setAddDay(true)}
                >
                  <PlusIcon aria-hidden />
                  {t("authoring.day.add")}
                </Button>
              </div>
            )
          ) : null}
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}

function DayEditor({
  versionId,
  weekId,
  day,
  index,
  siblings,
  editable,
  busy,
  mutate,
  reorder,
  remove,
}: {
  versionId: string;
  weekId: string;
  day: Day;
  index: number;
  siblings: Day[];
  editable: boolean;
  busy: boolean;
  mutate: Mutate;
  reorder: Reorder;
  remove: Remove;
}) {
  const { locale, t } = useI18n();
  const [edit, setEdit] = useState(false);
  const [addUnit, setAddUnit] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <AccordionItem
      value={day.id}
      className="min-w-0 overflow-hidden rounded-lg border border-border bg-muted/20"
      data-editor-day={day.id}
    >
      <div className="flex min-w-0 items-start gap-2 px-3 sm:px-4">
        <AccordionTrigger
          headingLevel={4}
          className="min-w-0 flex-1 py-3 hover:no-underline sm:py-4"
        >
          <span className="min-w-0 text-left">
            <span className="block break-all text-xs font-normal text-muted-foreground">
              {t("authoring.day.meta", {
                number: (index + 1).toLocaleString(locale),
                id: day.stableId,
                minutes: day.estimatedMinutes.toLocaleString(locale),
              })}
            </span>
            <span className="mt-1 block break-words font-medium">
              {day.title}
            </span>
            <span className="mt-1 block break-words text-sm font-normal text-muted-foreground">
              {day.goal}
            </span>
          </span>
        </AccordionTrigger>
        {editable ? (
          <div className="flex shrink-0 items-center gap-1 py-3 sm:py-4">
            <ReorderControls
              label={t("authoring.entity.day", { title: day.title })}
              index={index}
              count={siblings.length}
              disabled={busy}
              move={(direction) => {
                setError(null);
                void reorder(
                  `/curriculum-editor/versions/${encodeURIComponent(versionId)}/weeks/${encodeURIComponent(weekId)}/days/reorder`,
                  siblings.map(({ id }) => id),
                  index,
                  direction,
                ).catch((cause) => setError(errorMessage(cause, t)));
              }}
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setEdit((value) => !value)}
            >
              {t("authoring.common.edit")}
            </Button>
            <DeleteAction
              label={t("authoring.entity.day", { title: day.title })}
              consequence={t("authoring.delete.dayConsequence")}
              busy={busy}
              onConfirm={() =>
                remove(
                  `/curriculum-editor/versions/${encodeURIComponent(versionId)}/days/${encodeURIComponent(day.id)}`,
                )
              }
            />
          </div>
        ) : null}
      </div>
      <AccordionContent className="px-3 sm:px-4">
        <SubmitError message={error} />
        {edit ? (
          <div className="mb-4">
            <DayForm
              versionId={versionId}
              weekId={weekId}
              initial={day}
              mutate={mutate}
              busy={busy}
              onClose={() => setEdit(false)}
            />
          </div>
        ) : null}
        <div className="grid min-w-0 gap-2">
          {day.units.map((unit, unitIndex) => (
            <UnitEditor
              key={unit.id}
              versionId={versionId}
              dayId={day.id}
              unit={unit}
              index={unitIndex}
              siblings={day.units}
              editable={editable}
              busy={busy}
              mutate={mutate}
              reorder={reorder}
              remove={remove}
            />
          ))}
          {editable ? (
            addUnit ? (
              <UnitForm
                versionId={versionId}
                dayId={day.id}
                mutate={mutate}
                busy={busy}
                onClose={() => setAddUnit(false)}
              />
            ) : (
              <div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setAddUnit(true)}
                >
                  <PlusIcon aria-hidden />
                  {t("authoring.unit.add")}
                </Button>
              </div>
            )
          ) : null}
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}

function UnitEditor({
  versionId,
  dayId,
  unit,
  index,
  siblings,
  editable,
  busy,
  mutate,
  reorder,
  remove,
}: {
  versionId: string;
  dayId: string;
  unit: Unit;
  index: number;
  siblings: Unit[];
  editable: boolean;
  busy: boolean;
  mutate: Mutate;
  reorder: Reorder;
  remove: Remove;
}) {
  const { t } = useI18n();
  const [edit, setEdit] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <article
      className="min-w-0 rounded-lg border border-border bg-card px-3 py-2.5"
      data-editor-unit={unit.id}
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Badge className="shrink-0" variant="outline">
              {unit.type}
            </Badge>
            <span className="min-w-0 break-words font-medium">
              {unit.title}
            </span>
          </div>
          <p className="mt-1 break-all text-xs text-muted-foreground">
            {unit.stableId}
          </p>
        </div>
        {editable ? (
          <div className="flex shrink-0 items-center gap-1">
            <ReorderControls
              label={t("authoring.entity.unit", { title: unit.title })}
              index={index}
              count={siblings.length}
              disabled={busy}
              move={(direction) => {
                setError(null);
                void reorder(
                  `/curriculum-editor/versions/${encodeURIComponent(versionId)}/days/${encodeURIComponent(dayId)}/units/reorder`,
                  siblings.map(({ id }) => id),
                  index,
                  direction,
                ).catch((cause) => setError(errorMessage(cause, t)));
              }}
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setEdit((value) => !value)}
            >
              {t("authoring.common.edit")}
            </Button>
            <DeleteAction
              label={t("authoring.entity.unit", { title: unit.title })}
              consequence={t("authoring.delete.unitConsequence")}
              busy={busy}
              onConfirm={() =>
                remove(
                  `/curriculum-editor/versions/${encodeURIComponent(versionId)}/units/${encodeURIComponent(unit.id)}`,
                )
              }
            />
          </div>
        ) : null}
      </div>
      <SubmitError message={error} />
      {edit ? (
        <div className="mt-4">
          <UnitForm
            versionId={versionId}
            dayId={dayId}
            initial={unit}
            mutate={mutate}
            busy={busy}
            onClose={() => setEdit(false)}
          />
        </div>
      ) : null}
    </article>
  );
}

const versionStatusMessageKeys = {
  draft: "authoring.status.draft",
  published: "authoring.status.published",
  archived: "authoring.status.archived",
} satisfies Record<Version["status"], MessageKey>;

type QuantityUnit = "week" | "day";
type QuantityForm = "one" | "few" | "many" | "other";

const quantityMessageKeys = {
  week: {
    one: "authoring.quantity.week.one",
    few: "authoring.quantity.week.few",
    many: "authoring.quantity.week.many",
    other: "authoring.quantity.week.other",
  },
  day: {
    one: "authoring.quantity.day.one",
    few: "authoring.quantity.day.few",
    many: "authoring.quantity.day.many",
    other: "authoring.quantity.day.other",
  },
} satisfies Record<QuantityUnit, Record<QuantityForm, MessageKey>>;

const pluralRules: Readonly<Record<UiLocale, Intl.PluralRules>> = {
  "en-US": new Intl.PluralRules("en-US"),
  "ru-RU": new Intl.PluralRules("ru-RU"),
};
const authoringDateOptions: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
};

function formatQuantity(
  unit: QuantityUnit,
  count: number,
  locale: UiLocale,
  t: Translate,
): string {
  const selected = pluralRules[locale].select(count);
  const form: QuantityForm =
    selected === "one" ||
    selected === "few" ||
    selected === "many" ||
    selected === "other"
      ? selected
      : "other";
  return t(quantityMessageKeys[unit][form], {
    count: count.toLocaleString(locale),
  });
}

function versionBadgeVariant(
  status: Version["status"],
): "success" | "warning" | "secondary" {
  return status === "published"
    ? "success"
    : status === "draft"
      ? "warning"
      : "secondary";
}

function PersonalAdaptationPanel({
  courseId,
  mutate,
  busy,
  onSelect,
}: {
  courseId: string;
  mutate: Mutate;
  busy: boolean;
  onSelect: (versionId: string) => void;
}) {
  const { locale, t } = useI18n();
  const [strategy, setStrategy] = useState<
    "use-upstream" | "keep-personal" | null
  >(null);
  const adaptation = useQuery({
    queryKey: ["curriculum-editor", "adaptation", courseId],
    queryFn: () =>
      checkedApi(
        `/curriculum-editor/courses/${encodeURIComponent(courseId)}/adaptation`,
        adaptationResponseSchema,
        t,
      ),
  });

  if (adaptation.isLoading) {
    return (
      <section
        className={panelClass}
        aria-label={t("authoring.adaptation.title")}
      >
        <LoadingState
          label="authoring.loading.graph"
          variant="panel"
          className="min-h-32"
        />
      </section>
    );
  }
  if (adaptation.isError || !adaptation.data) {
    return (
      <QueryError
        message={t("authoring.adaptation.unavailable")}
        retry={() => void adaptation.refetch()}
      />
    );
  }

  const { branch, comparison, revisions } = adaptation.data;
  const upstream = revisions.filter(
    (revision) => revision.branchKind === "upstream",
  );
  const personal = revisions.filter(
    (revision) => revision.branchKind === "personal",
  );
  const integrate = async () => {
    if (!strategy) return;
    await mutate(
      `/curriculum-editor/courses/${encodeURIComponent(courseId)}/adaptation/integrate`,
      {
        method: "POST",
        body: JSON.stringify({
          strategy,
          baseRevisionId: comparison.baseRevisionId,
          upstreamRevisionId: comparison.upstreamRevisionId,
          personalVersionId: comparison.personalVersionId,
          baseDraftHash: comparison.baseDraftHash,
          upstreamDraftHash: comparison.upstreamDraftHash,
          personalDraftHash: comparison.personalDraftHash,
        }),
      },
      adaptationIntegrationResponseSchema,
    );
    setStrategy(null);
  };

  return (
    <section className={panelClass} data-slot="personal-adaptation">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {t("authoring.adaptation.eyebrow")}
          </p>
          <h2 className="mt-1 text-lg font-semibold">
            {t("authoring.adaptation.title")}
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {t("authoring.adaptation.description")}
          </p>
        </div>
        <Badge
          variant={
            comparison.status === "conflict"
              ? "error"
              : comparison.status === "clean"
                ? "warning"
                : "success"
          }
        >
          {t(`authoring.adaptation.status.${comparison.status}`)}
        </Badge>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        {(
          [
            ["upstream", upstream],
            ["personal", personal],
          ] as const
        ).map(([kind, items]) => (
          <div key={kind} className="rounded-lg border border-border p-4">
            <h3 className="font-medium">
              {t(`authoring.adaptation.${kind}.title`)}
            </h3>
            {items.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">
                {t(`authoring.adaptation.${kind}.empty`)}
              </p>
            ) : (
              <ul className="mt-3 grid gap-2">
                {items.map((revision) => (
                  <li
                    key={revision.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/45 px-3 py-2"
                  >
                    <button
                      type="button"
                      className="min-w-0 text-left text-sm font-medium hover:underline"
                      onClick={() => onSelect(revision.id)}
                    >
                      {revision.title}
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        {t("authoring.revision.short", {
                          revision: revision.revision.toLocaleString(locale),
                        })}
                      </span>
                    </button>
                    <Badge
                      variant={
                        revision.status === "published"
                          ? "success"
                          : revision.status === "draft"
                            ? "warning"
                            : "secondary"
                      }
                    >
                      {t(`authoring.status.${revision.status}`)}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>

      {comparison.conflicts.length > 0 ? (
        <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
          <p className="text-sm font-medium">
            {t("authoring.adaptation.conflicts", {
              count: comparison.conflicts.length.toLocaleString(locale),
            })}
          </p>
          <ul className="mt-2 list-inside list-disc text-xs text-muted-foreground">
            {comparison.conflicts.map((conflict) => (
              <li key={conflict}>
                <code>{conflict}</code>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-5 flex flex-wrap gap-2 border-t border-border pt-4">
        {!branch ? (
          <Button
            disabled={busy}
            onClick={() => {
              void mutate(
                `/curriculum-editor/versions/${encodeURIComponent(comparison.upstreamRevisionId)}/adaptation`,
                { method: "POST", body: "{}" },
                adaptationMutationResponseSchema,
              ).catch(() => undefined);
            }}
          >
            {t("authoring.adaptation.create")}
          </Button>
        ) : comparison.status === "current" ? (
          <p className="text-sm text-muted-foreground" role="status">
            {t("authoring.adaptation.currentDescription")}
          </p>
        ) : strategy ? (
          <div className="w-full rounded-lg border border-border bg-muted/35 p-4">
            <p className="text-sm font-medium">
              {t(`authoring.adaptation.confirm.${strategy}`)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("authoring.adaptation.confirm.description")}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button disabled={busy} onClick={() => void integrate()}>
                {t("authoring.adaptation.integrate")}
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => setStrategy(null)}
              >
                {t("authoring.common.cancel")}
              </Button>
            </div>
          </div>
        ) : (
          <>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setStrategy("use-upstream")}
            >
              {t("authoring.adaptation.useUpstream")}
            </Button>
            {comparison.personalVersionId ? (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => setStrategy("keep-personal")}
              >
                {t("authoring.adaptation.keepPersonal")}
              </Button>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}

function CourseStudioHeader({
  version,
  graph,
  mutate,
  busy,
  saving,
  saveFailed,
}: {
  version: VersionListItem;
  graph: Graph | undefined;
  mutate: Mutate;
  busy: boolean;
  saving: boolean;
  saveFailed: boolean;
}) {
  const { formatDate, locale, t } = useI18n();
  const weeksCount = graph?.weeks.length ?? 0;
  const daysCount =
    graph?.weeks.reduce((total, week) => total + week.days.length, 0) ?? 0;
  const date = version.publishedAt ?? version.createdAt;
  const isPublished = version.status === "published";
  const description = displayedAuthoringDescription(version.description);
  return (
    <header
      data-slot="course-studio-header"
      className="flex min-w-0 flex-col gap-4 rounded-[14px] bg-surface-soft/45 p-5 sm:flex-row sm:items-start sm:justify-between sm:p-6"
    >
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          {t("authoring.revision.label", {
            revision: version.revision.toLocaleString(locale),
          })}
        </p>
        <h2 className="mt-2 break-words text-2xl font-semibold tracking-[-0.025em]">
          {version.title}
        </h2>
        <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          <span className="break-words">
            {t(
              isPublished
                ? "authoring.current.publishedAt"
                : "authoring.current.draftCreatedAt",
              { date: formatDate(date, authoringDateOptions) },
            )}
          </span>
          <span aria-hidden>·</span>
          <span className="break-words">
            {graph
              ? t("authoring.current.structure", {
                  weeks: formatQuantity("week", weeksCount, locale, t),
                  days: formatQuantity("day", daysCount, locale, t),
                })
              : t("authoring.current.structureLoading")}
          </span>
        </div>
        <div className="mt-3 flex min-w-0 flex-wrap gap-2">
          <Badge variant="outline" className="max-w-full break-all">
            {t("authoring.current.primaryLocale", {
              locale: version.primaryLocale,
            })}
          </Badge>
          <Badge variant="outline" className="max-w-full break-all">
            {t(
              version.branchKind === "personal"
                ? "authoring.current.branchPersonal"
                : "authoring.current.branchUpstream",
            )}
          </Badge>
          {version.parentVersionId ? (
            <Badge variant="outline" className="max-w-full break-all">
              {t("authoring.current.parent", {
                id: version.parentVersionId,
              })}
            </Badge>
          ) : null}
          {saveFailed || saving ? (
            <Badge role="status" variant="warning" className="max-w-full">
              {t(
                saveFailed
                  ? "authoring.current.saveFailed"
                  : "authoring.current.saving",
              )}
            </Badge>
          ) : null}
        </div>
        {version.contentHash || version.basedOnContentHash ? (
          <Collapsible className="group/hash mt-3">
            <CollapsibleTrigger asChild>
              <Button type="button" variant="ghost" size="sm" className="-ml-2">
                {t("authoring.current.hashDetails")}
                <CaretDownIcon
                  aria-hidden
                  className="transition-transform group-data-[state=open]/hash:rotate-180 motion-reduce:transition-none"
                />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <dl className="grid min-w-0 gap-2 rounded-lg border border-border/70 bg-background p-3 text-xs">
                {version.contentHash ? (
                  <div className="min-w-0">
                    <dt className="font-medium text-muted-foreground">
                      {t("authoring.current.contentHash")}
                    </dt>
                    <dd className="mt-1 break-all">{version.contentHash}</dd>
                  </div>
                ) : null}
                {version.basedOnContentHash ? (
                  <div className="min-w-0">
                    <dt className="font-medium text-muted-foreground">
                      {t("authoring.current.baseHash")}
                    </dt>
                    <dd className="mt-1 break-all">
                      {version.basedOnContentHash}
                    </dd>
                  </div>
                ) : null}
              </dl>
            </CollapsibleContent>
          </Collapsible>
        ) : null}
        {description ? (
          <p className="mt-2 max-w-[70ch] break-words text-sm leading-6 text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      <div className="flex w-full shrink-0 flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
        <Badge
          className="shrink-0"
          variant={
            isPublished
              ? "success"
              : version.status === "draft"
                ? "warning"
                : "secondary"
          }
        >
          {isPublished
            ? t("authoring.status.publishedReadOnly")
            : t(versionStatusMessageKeys[version.status])}
        </Badge>
        {isPublished ? (
          <Button
            variant="outline"
            className="w-full sm:w-auto"
            disabled={busy}
            onClick={() => {
              void mutate(
                `/curriculum-editor/versions/${encodeURIComponent(version.id)}/clone`,
                {
                  method: "POST",
                  body: JSON.stringify({
                    operationId: operationId(),
                    title: version.title,
                  }),
                },
                z.object({ version: versionSchema }).strict(),
              ).catch(() => undefined);
            }}
          >
            <CopyIcon aria-hidden />
            {t("authoring.clone.submit")}
          </Button>
        ) : null}
      </div>
    </header>
  );
}

function VersionHistory({
  versions,
  onSelect,
}: {
  versions: VersionListItem[];
  onSelect: (id: string) => void;
}) {
  const { formatDate, locale, t } = useI18n();
  return (
    <section className={panelClass} data-slot="version-history">
      <h3 className="font-medium">{t("authoring.history.title")}</h3>
      {versions.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          {t("authoring.history.empty")}
        </p>
      ) : (
        <ul className="mt-4 grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">
          {versions.map((version) => (
            <li
              key={version.id}
              className="min-w-0 rounded-lg border border-border p-3"
            >
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  className="min-w-0 flex-1 overflow-hidden text-left"
                  onClick={() => onSelect(version.id)}
                >
                  <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                    <strong className="text-sm">
                      {t("authoring.revision.label", {
                        revision: version.revision.toLocaleString(locale),
                      })}
                    </strong>
                    <span className="min-w-0 whitespace-normal font-mono text-xs text-muted-foreground [overflow-wrap:anywhere]">
                      r{version.revision} · {version.title}
                    </span>
                  </span>
                </button>
                <Badge variant={versionBadgeVariant(version.status)}>
                  {t(versionStatusMessageKeys[version.status])}
                </Badge>
              </div>
              <details className="mt-2 min-w-0">
                <summary className="cursor-pointer text-xs text-muted-foreground">
                  {t("authoring.history.details")}
                </summary>
                <dl className="mt-2 grid min-w-0 gap-1 break-words text-xs leading-5 text-muted-foreground">
                  <div>
                    {t("authoring.history.createdAt", {
                      date: formatDate(version.createdAt, authoringDateOptions),
                    })}
                  </div>
                  <div>
                    {t("authoring.history.publishedAt", {
                      date: version.publishedAt
                        ? formatDate(version.publishedAt, authoringDateOptions)
                        : "—",
                    })}
                  </div>
                  {displayedAuthoringDescription(version.description) ? (
                    <div>
                      {t("authoring.history.description", {
                        description:
                          displayedAuthoringDescription(version.description) ??
                          "",
                      })}
                    </div>
                  ) : null}
                </dl>
              </details>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AddWeekCard({
  onOpen,
  disabled,
}: {
  onOpen: () => void;
  disabled: boolean;
}) {
  const { t } = useI18n();
  return (
    <section
      data-slot="add-week"
      className="flex flex-wrap items-center justify-between gap-4 rounded-[14px] bg-surface-soft/45 p-5 sm:p-6"
    >
      <div className="min-w-0">
        <h3 className="font-semibold">{t("authoring.addWeek.title")}</h3>
        <p className="mt-1 max-w-[60ch] text-sm leading-6 text-muted-foreground">
          {t("authoring.addWeek.cardDescription")}
        </p>
      </div>
      <Button disabled={disabled} onClick={onOpen}>
        <PlusIcon aria-hidden />
        {t("authoring.addWeek.title")}
      </Button>
    </section>
  );
}

function AddWeekSheet({
  open,
  onOpenChange,
  current,
  versions,
  mutate,
  busy,
  selectVersion,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  current: VersionListItem;
  versions: VersionListItem[];
  mutate: Mutate;
  busy: boolean;
  selectVersion: (id: string) => void;
}) {
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);

  async function submit(form: FormData) {
    setError(null);
    try {
      const title = text(form, "title");
      const goal = text(form, "goal");
      const topics = splitList(form.get("topics"));
      const expectedOutcomes = splitList(form.get("expectedOutcomes"));
      const requestedDays = Number(text(form, "daysCount"));
      const daysCount = Number.isFinite(requestedDays)
        ? Math.min(7, Math.max(1, Math.trunc(requestedDays)))
        : 1;

      let versionId = current.id;
      if (current.status !== "draft") {
        const existingDraft = versions.find(
          (candidate) =>
            candidate.status === "draft" &&
            candidate.curriculumId === current.curriculumId,
        );
        if (existingDraft) {
          versionId = existingDraft.id;
          selectVersion(versionId);
        } else {
          const created = (await mutate(
            `/curriculum-editor/versions/${encodeURIComponent(current.id)}/clone`,
            {
              method: "POST",
              body: JSON.stringify({
                operationId: operationId(),
                title: current.title,
                description: current.description,
              }),
            },
            z.object({ version: versionSchema }).strict(),
          )) as { version: Version };
          versionId = created.version.id;
          selectVersion(versionId);
        }
      }

      const weekBase = `${slugify(title) || "week"}-${Date.now()}`;
      const createdWeek = (await mutate(
        `/curriculum-editor/versions/${encodeURIComponent(versionId)}/weeks`,
        {
          method: "POST",
          body: JSON.stringify({
            operationId: operationId(),
            stableId: weekBase,
            title,
            description: goal || null,
          }),
        },
        z
          .object({ week: weekSchema.omit({ days: true }).passthrough() })
          .strict(),
      )) as { week: { id: string } };

      for (let index = 1; index <= daysCount; index += 1) {
        await mutate(
          `/curriculum-editor/versions/${encodeURIComponent(versionId)}/weeks/${encodeURIComponent(createdWeek.week.id)}/days`,
          {
            method: "POST",
            body: JSON.stringify({
              operationId: operationId(),
              stableId: `${weekBase}-day-${index}`,
              title: `Day ${index}`,
              description: null,
              goal,
              estimatedMinutes: 60,
              depthLevel: "foundation",
              prerequisites: [],
              expectedOutcomes,
              outOfScope: [],
              topics,
            }),
          },
          z
            .object({ day: daySchema.omit({ units: true }).passthrough() })
            .strict(),
        );
      }
      onOpenChange(false);
    } catch (cause) {
      setError(errorMessage(cause, t));
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent data-slot="add-week-sheet">
        <SheetHeader>
          <SheetTitle>{t("authoring.addWeek.title")}</SheetTitle>
          <SheetDescription>
            {t("authoring.addWeek.sheetDescription")}
          </SheetDescription>
        </SheetHeader>
        <form
          className="flex min-h-0 flex-1 flex-col"
          aria-label={t("authoring.addWeek.title")}
          onSubmit={(event) => {
            event.preventDefault();
            void submit(new FormData(event.currentTarget));
          }}
        >
          <div className="grid gap-4 overflow-y-auto px-5 py-4">
            <label className={labelClass}>
              {t("authoring.addWeek.weekTitle")}
              <input
                className={fieldClass}
                name="title"
                required
                placeholder={t("authoring.addWeek.titlePlaceholder")}
              />
            </label>
            <label className={labelClass}>
              {t("authoring.addWeek.weekGoal")}
              <textarea
                className={`${fieldClass} resize-y`}
                name="goal"
                rows={3}
                required
                placeholder={t("authoring.addWeek.goalPlaceholder")}
              />
            </label>
            <label className={labelClass}>
              {t("authoring.field.topics")}
              <input
                className={fieldClass}
                name="topics"
                placeholder={t("authoring.addWeek.topicsPlaceholder")}
              />
              <span className="text-xs font-normal text-muted-foreground">
                {t("authoring.addWeek.commaSeparated")}
              </span>
            </label>
            <label className={labelClass}>
              {t("authoring.field.expectedOutcomes")}
              <input
                className={fieldClass}
                name="expectedOutcomes"
                placeholder={t("authoring.addWeek.outcomesPlaceholder")}
              />
              <span className="text-xs font-normal text-muted-foreground">
                {t("authoring.addWeek.commaSeparated")}
              </span>
            </label>
            <label className={labelClass}>
              {t("authoring.addWeek.daysCount")}
              <input
                className={`${fieldClass} max-w-32`}
                name="daysCount"
                type="number"
                min={1}
                max={7}
                required
                defaultValue={5}
              />
            </label>
            <p className="text-xs leading-5 text-muted-foreground">
              {t("authoring.addWeek.aiUnavailable")}
            </p>
          </div>
          {error ? (
            <div className="px-5 pb-2">
              <SubmitError message={error} />
            </div>
          ) : null}
          <SheetFooter>
            <Button type="submit" disabled={busy}>
              {t(
                busy
                  ? "authoring.addWeek.creating"
                  : "authoring.addWeek.create",
              )}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

export function CurriculumEditorClient({
  initialVersionId = null,
  initialMode = null,
  initialWorkspace = null,
}: {
  initialVersionId?: string | null;
  initialMode?: AuthoringStart | null;
  initialWorkspace?: StudioWorkspace | null;
} = {}) {
  const { t } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const pendingOperations = usePendingOperations();
  const [selectedId, setSelectedId] = useState<string | null>(initialVersionId);
  const authoringStart = initialMode;
  const requestedWorkspace =
    initialWorkspace ?? (initialMode === "designer" ? "designer" : "program");
  const [workspace, setWorkspace] =
    useState<StudioWorkspace>(requestedWorkspace);
  const workspaceRef = useRef<StudioWorkspace>(requestedWorkspace);
  useEffect(() => {
    workspaceRef.current = requestedWorkspace;
    setWorkspace(requestedWorkspace);
  }, [requestedWorkspace]);
  const selectedIdRef = useRef<string | null>(initialVersionId);
  const searchParamString = searchParams.toString();
  const studioParamsRef = useRef(searchParamString);
  useEffect(() => {
    studioParamsRef.current = searchParamString;
  }, [searchParamString]);
  const [addWeekOpen, setAddWeekOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<FailurePresentation | null>(
    null,
  );
  const updateStudioLocation = (
    history: "push" | "replace",
    mutateParams?: (params: URLSearchParams) => void,
  ) => {
    const next = new URLSearchParams(studioParamsRef.current);
    mutateParams?.(next);
    const versionId = selectedIdRef.current;
    if (versionId) next.set("version", versionId);
    else next.delete("version");
    next.set("tab", workspaceRef.current);
    const serialized = next.toString();
    studioParamsRef.current = serialized;
    router[history](`/courses/studio?${serialized}`, { scroll: false });
  };
  const selectVersion = (id: string | null) => {
    const previousId = selectedIdRef.current;
    selectedIdRef.current = id;
    setSelectedId(id);
    if (id && id !== previousId) {
      updateStudioLocation("replace", (next) => {
        next.delete("week");
        next.delete("day");
      });
    }
  };
  const selectWorkspace = (nextWorkspace: StudioWorkspace) => {
    workspaceRef.current = nextWorkspace;
    setWorkspace(nextWorkspace);
    updateStudioLocation("push");
  };
  const versions = useQuery({
    queryKey: ["curriculum-editor", "versions"],
    queryFn: () =>
      checkedApi(
        "/curriculum-editor/versions",
        z.object({ versions: z.array(versionListItemSchema) }).strict(),
        t,
      ),
  });
  const requestedVersionMissing = Boolean(
    initialVersionId !== null &&
    versions.data &&
    !versions.data.versions.some(
      (candidate) => candidate.id === initialVersionId,
    ),
  );
  const graphVersionId =
    versions.data?.versions.some((candidate) => candidate.id === selectedId) ===
    true
      ? selectedId
      : null;
  const graph = useQuery({
    queryKey: ["curriculum-editor", "version", graphVersionId],
    enabled: Boolean(graphVersionId),
    queryFn: () =>
      checkedApi(
        `/curriculum-editor/versions/${encodeURIComponent(graphVersionId ?? "")}`,
        z.object({ curriculum: graphSchema }).strict(),
        t,
      ),
  });
  const selectedVersion = versions.data?.versions.find(
    (version) => version.id === graphVersionId,
  );
  const pageRouteContext = useMemo<RouteContext | null>(
    () =>
      selectedVersion
        ? {
            sectionHref: "/courses",
            breadcrumbs: [
              { href: "/courses", label: "nav.courses" },
              {
                href: `/courses/${encodeURIComponent(selectedVersion.curriculumId)}/revisions/${encodeURIComponent(selectedVersion.id)}`,
                text: selectedVersion.title,
              },
              { label: "shell.route.studio" },
            ],
          }
        : null,
    [selectedVersion],
  );
  usePageRouteContext(pageRouteContext);
  const selectedCourseVersions = selectedVersion
    ? (versions.data?.versions.filter(
        (version) => version.curriculumId === selectedVersion.curriculumId,
      ) ?? [])
    : [];
  const mutate: Mutate = async (path, init, schema, selectId) => {
    setBusy(true);
    setActionError(null);
    const operationKey = `${init.method ?? "POST"}:${path}`;
    const rawBody = init.body ? (JSON.parse(String(init.body)) as unknown) : {};
    const requestBody = z.record(z.string(), z.unknown()).parse(rawBody);
    const operation = pendingOperations.id(operationKey);
    try {
      const result = await checkedApi(path, schema, t, {
        ...init,
        body: JSON.stringify({ ...requestBody, operationId: operation }),
      });
      pendingOperations.confirmed(operationKey);
      const version = (result as { version?: Version }).version;
      const nextId = selectId ?? version?.id ?? selectedIdRef.current;
      if (nextId) selectVersion(nextId);
      await queryClient.invalidateQueries({ queryKey: ["curriculum-editor"] });
      return result;
    } catch (cause) {
      setActionError(presentFailure(cause, "studio.action", t));
      throw cause;
    } finally {
      setBusy(false);
    }
  };

  if (versions.isLoading)
    return <LoadingState label="authoring.loading.versions" />;
  if (versions.isError || !versions.data)
    return (
      <SafeQueryError
        error={versions.error}
        operation="studio.load"
        retry={() => void versions.refetch()}
      />
    );
  return (
    <div className="flex min-w-0 flex-col gap-6">
      {actionError ? (
        <QueryError
          title={t("authoring.error.actionTitle")}
          message={actionError.message}
          {...(actionError.diagnostic
            ? { diagnostic: actionError.diagnostic }
            : {})}
        />
      ) : null}
      {requestedVersionMissing ? (
        <EmptyState
          title={t("authoring.missingRevision.title")}
          description={t("authoring.missingRevision.description")}
          action={
            <Button asChild>
              <Link href="/courses">{t("nav.courses")}</Link>
            </Button>
          }
        />
      ) : versions.data.versions.length === 0 ? (
        <EmptyState
          title={t("authoring.emptyProgram.title")}
          description={t("authoring.emptyProgram.description")}
          action={
            <Button asChild>
              <Link href="/courses/new">{t("courses.create.action")}</Link>
            </Button>
          }
        />
      ) : selectedVersion ? (
        <>
          <section
            className="min-w-0"
            aria-label={t("authoring.graph.selectedRevision")}
          >
            {!graphVersionId ? (
              <EmptyState
                title={t("authoring.selectRevision.title")}
                description={t("authoring.selectRevision.description")}
              />
            ) : graph.isLoading ? (
              <LoadingState label="authoring.loading.graph" variant="panel" />
            ) : graph.isError || !graph.data ? (
              <SafeQueryError
                error={graph.error}
                operation="studio.load"
                retry={() => void graph.refetch()}
              />
            ) : (
              <div className="grid gap-5">
                <CourseStudioHeader
                  version={selectedVersion}
                  graph={graph.data.curriculum}
                  mutate={mutate}
                  busy={busy}
                  saving={busy}
                  saveFailed={Boolean(actionError)}
                />

                <Tabs
                  className="min-w-0"
                  value={workspace}
                  onValueChange={(value) =>
                    selectWorkspace(value as StudioWorkspace)
                  }
                >
                  <div
                    data-slot="studio-workspace-tabs-scroll"
                    className="min-w-0 overflow-x-auto overflow-y-hidden overscroll-x-contain"
                  >
                    <TabsList
                      variant="segmented"
                      className="min-w-max justify-start"
                      aria-label={t("authoring.workspace.aria")}
                    >
                      {(
                        [
                          ["program", "authoring.workspace.program"],
                          ["designer", "authoring.workspace.designer"],
                          ["preview", "authoring.workspace.preview"],
                          ["release", "authoring.workspace.release"],
                          ["history", "authoring.workspace.history"],
                        ] as const
                      ).map(([value, label]) => (
                        <TabsTrigger
                          key={value}
                          value={value}
                          className="min-w-max flex-none px-3 py-3 sm:px-4"
                        >
                          {t(label)}
                        </TabsTrigger>
                      ))}
                    </TabsList>
                  </div>

                  <TabsContent
                    value="program"
                    className="mt-5 min-w-0 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    <div className="grid gap-4">
                      <GraphEditor
                        graph={graph.data.curriculum}
                        mutate={mutate}
                        busy={busy}
                      />
                      <AddWeekCard
                        onOpen={() => setAddWeekOpen(true)}
                        disabled={busy}
                      />
                    </div>
                  </TabsContent>

                  <TabsContent
                    value="designer"
                    className="mt-5 min-w-0 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    {graph.data.curriculum.version.status === "draft" ? (
                      <CourseDesignerPanel
                        graph={graph.data.curriculum}
                        mutate={mutate}
                        busy={busy}
                        onContinueManually={() => selectWorkspace("program")}
                        {...(authoringStart === "designer"
                          ? {
                              initialGoal:
                                graph.data.curriculum.version.description ?? "",
                            }
                          : {})}
                      />
                    ) : (
                      <EmptyState
                        title={t(
                          "authoring.workspace.designerUnavailable.title",
                        )}
                        description={t(
                          "authoring.workspace.designerUnavailable.description",
                        )}
                      />
                    )}
                  </TabsContent>

                  <TabsContent
                    value="preview"
                    className="mt-5 min-w-0 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    <StudioPreviewPanel
                      version={graph.data.curriculum.version}
                    />
                  </TabsContent>

                  <TabsContent
                    value="release"
                    className="mt-5 min-w-0 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    {graph.data.curriculum.version.status === "draft" ? (
                      <PublishPanel
                        version={graph.data.curriculum.version}
                        mutate={mutate}
                        busy={busy}
                      />
                    ) : (
                      <EmptyState
                        title={t(
                          "authoring.workspace.releaseUnavailable.title",
                        )}
                        description={t(
                          "authoring.workspace.releaseUnavailable.description",
                        )}
                      />
                    )}
                  </TabsContent>

                  <TabsContent
                    value="history"
                    className="mt-5 min-w-0 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    <div className="grid gap-4 min-[70rem]:grid-cols-2 min-[70rem]:items-start">
                      <VersionHistory
                        versions={selectedCourseVersions.filter(
                          (version) => version.id !== selectedVersion.id,
                        )}
                        onSelect={selectVersion}
                      />
                      <PersonalAdaptationPanel
                        courseId={selectedVersion.curriculumId}
                        mutate={mutate}
                        busy={busy}
                        onSelect={selectVersion}
                      />
                    </div>
                  </TabsContent>
                </Tabs>
              </div>
            )}
          </section>

          <AddWeekSheet
            open={addWeekOpen}
            onOpenChange={setAddWeekOpen}
            current={selectedVersion}
            versions={selectedCourseVersions}
            mutate={mutate}
            busy={busy}
            selectVersion={selectVersion}
          />
        </>
      ) : (
        <EmptyState
          title={t("authoring.selectRevision.title")}
          description={t("authoring.selectRevision.description")}
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button asChild>
                <Link href="/courses">{t("nav.courses")}</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/courses/new">{t("courses.create.action")}</Link>
              </Button>
            </div>
          }
        />
      )}
    </div>
  );
}

export function CurriculumStudioClient({
  initialVersionId = null,
  initialMode = null,
  initialWorkspace = null,
}: {
  initialVersionId?: string | null;
  initialMode?: AuthoringStart | null;
  initialWorkspace?: StudioWorkspace | null;
}) {
  const { t } = useI18n();
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-3">
          <Link href="/courses">
            <ArrowLeftIcon aria-hidden data-icon="inline-start" />
            {t("nav.courses")}
          </Link>
        </Button>
      </div>
      <PageHeader
        title={t("authoring.entry.eyebrow")}
        description={t("authoring.page.description")}
      />
      <CurriculumEditorClient
        initialVersionId={initialVersionId}
        initialMode={initialMode}
        initialWorkspace={initialWorkspace}
      />
    </div>
  );
}
