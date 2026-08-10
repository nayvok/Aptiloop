"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CopyIcon,
  PlusIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { AiDisclosureSchema, CourseDraftProposalSchema } from "@dlh/shared";
import { z } from "zod";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, QueryError } from "@/components/query-state";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
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
  .extend({ curriculumSlug: idSchema })
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
        ready: z.boolean(),
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
  })
  .strict();
const courseProposalResponseSchema = z
  .object({ proposal: courseProposalRecordSchema })
  .strict();
const courseProposalListSchema = z
  .object({ proposals: z.array(courseProposalRecordSchema) })
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
      "X-DLH-Client": "web",
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
      })
      .passthrough()
      .safeParse(value);
    const backendError = parsed.success ? parsed.data.error : undefined;
    const message =
      typeof backendError === "string"
        ? backendError
        : (backendError?.message ??
          t("authoring.error.requestFailed", { status: response.status }));
    throw new Error(message);
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
  "min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60";
const labelClass = "grid gap-1.5 text-sm font-medium";
const panelClass = "rounded-xl border border-border bg-card p-5";

function errorMessage(error: unknown, t: Translate): string {
  if (error instanceof z.ZodError)
    return t("authoring.error.unsafeServerResponse");
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
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!armed) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={t("authoring.delete.button", { label })}
        disabled={busy}
        onClick={() => setArmed(true)}
      >
        <TrashIcon aria-hidden />
      </Button>
    );
  }
  return (
    <div
      className="basis-full rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm"
      role="group"
      aria-label={t("authoring.delete.confirmation", { label })}
    >
      <p className="text-destructive">{consequence}</p>
      <SubmitError message={error} />
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          type="button"
          variant="destructive"
          size="sm"
          disabled={busy}
          onClick={() => {
            setError(null);
            void onConfirm()
              .then(() => setArmed(false))
              .catch((cause) => setError(errorMessage(cause, t)));
          }}
        >
          {t("authoring.delete.confirm")}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => setArmed(false)}
        >
          {t("authoring.common.cancel")}
        </Button>
      </div>
    </div>
  );
}

type Mutate = (
  path: string,
  init: RequestInit,
  schema: z.ZodType<unknown>,
  selectId?: string,
) => Promise<unknown>;

function CreateDraftPanel({ mutate, busy }: { mutate: Mutate; busy: boolean }) {
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);
  return (
    <details className={panelClass}>
      <summary className="cursor-pointer font-medium">
        {t("authoring.createDraft.summary")}
      </summary>
      <form
        className="mt-5 grid gap-4 md:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          const form = new FormData(event.currentTarget);
          const id = text(form, "curriculumId");
          void mutate(
            "/curriculum-editor/versions",
            {
              method: "POST",
              body: JSON.stringify({
                operationId: operationId(),
                curriculum: {
                  id,
                  slug: text(form, "slug"),
                  title: text(form, "curriculumTitle"),
                  description: optionalText(form, "curriculumDescription"),
                },
                title: text(form, "title"),
                description: optionalText(form, "description"),
              }),
            },
            z.object({ version: versionSchema }).strict(),
          ).catch((cause) => setError(errorMessage(cause, t)));
        }}
      >
        <label className={labelClass}>
          {t("authoring.field.curriculumId")}
          <input
            className={fieldClass}
            name="curriculumId"
            required
            pattern="[^\s]+"
          />
        </label>
        <label className={labelClass}>
          {t("authoring.field.slug")}
          <input
            className={fieldClass}
            name="slug"
            required
            pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
          />
        </label>
        <label className={labelClass}>
          {t("authoring.field.curriculumTitle")}
          <input className={fieldClass} name="curriculumTitle" required />
        </label>
        <label className={labelClass}>
          {t("authoring.field.revisionTitle")}
          <input className={fieldClass} name="title" required />
        </label>
        <label className={`${labelClass} md:col-span-2`}>
          {t("authoring.field.curriculumDescription")}
          <textarea className={fieldClass} name="curriculumDescription" />
        </label>
        <label className={`${labelClass} md:col-span-2`}>
          {t("authoring.field.revisionDescription")}
          <textarea className={fieldClass} name="description" />
        </label>
        <div className="flex flex-col items-start gap-3 md:col-span-2">
          <SubmitError message={error} />
          <Button disabled={busy} type="submit">
            <PlusIcon aria-hidden />
            {t("authoring.createDraft.submit")}
          </Button>
        </div>
      </form>
    </details>
  );
}

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
          ? `/curriculum-editor/versions/${versionId}/weeks/${initial.id}`
          : `/curriculum-editor/versions/${versionId}/weeks`;
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
            ? `/curriculum-editor/versions/${versionId}/days/${initial.id}`
            : `/curriculum-editor/versions/${versionId}/weeks/${weekId}/days`;
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
            <option value="foundation">foundation</option>
            <option value="interview-ready">interview-ready</option>
            <option value="deep-dive">deep-dive</option>
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
            ? `/curriculum-editor/versions/${versionId}/units/${initial.id}`
            : `/curriculum-editor/versions/${versionId}/days/${dayId}/units`;
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
            <option value="foundation">foundation</option>
            <option value="interview-ready">interview-ready</option>
            <option value="deep-dive">deep-dive</option>
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

function CourseDesignerPanel({
  graph,
  mutate,
  busy,
}: {
  graph: Graph;
  mutate: Mutate;
  busy: boolean;
}) {
  const { locale, t } = useI18n();
  const queryClient = useQueryClient();
  const [prompt, setPrompt] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingDisclosure, setPendingDisclosure] = useState<{
    authoringOperationId: string;
    prompt: string;
    disclosure: z.infer<typeof AiDisclosureSchema>;
  } | null>(null);
  const proposals = useQuery({
    queryKey: ["curriculum-editor", "designer-proposals", graph.version.id],
    enabled: graph.version.status === "draft",
    queryFn: () =>
      checkedApi(
        `/curriculum-editor/versions/${graph.version.id}/designer/proposals`,
        courseProposalListSchema,
        t,
      ),
  });

  if (graph.version.status !== "draft") return null;

  const generate = async (
    authoringOperationId: string,
    requestedPrompt: string,
    disclosureOperationId?: string,
  ) => {
    await checkedApi(
      `/curriculum-editor/versions/${graph.version.id}/designer/generate`,
      courseProposalResponseSchema,
      t,
      {
        method: "POST",
        body: JSON.stringify({
          operationId: authoringOperationId,
          prompt: requestedPrompt,
          ...(disclosureOperationId ? { disclosureOperationId } : {}),
        }),
      },
    );
    await queryClient.invalidateQueries({
      queryKey: ["curriculum-editor", "designer-proposals", graph.version.id],
    });
  };

  const requestProposal = async () => {
    const requestedPrompt = prompt.trim();
    if (!requestedPrompt) return;
    setWorking(true);
    setError(null);
    const authoringOperationId = operationId();
    try {
      const preparation = await checkedApi(
        `/curriculum-editor/versions/${graph.version.id}/designer/disclosures`,
        disclosurePreparationSchema,
        t,
        {
          method: "POST",
          body: JSON.stringify({
            operationId: authoringOperationId,
            prompt: requestedPrompt,
          }),
        },
      );
      if (preparation.required) {
        setPendingDisclosure({
          authoringOperationId,
          prompt: requestedPrompt,
          disclosure: preparation.disclosure,
        });
        return;
      }
      await generate(authoringOperationId, requestedPrompt);
      setPrompt("");
    } catch (cause) {
      setError(errorMessage(cause, t));
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
          pendingDisclosure.authoringOperationId,
          pendingDisclosure.prompt,
          pendingDisclosure.disclosure.operationId,
        );
        setPrompt("");
      }
      setPendingDisclosure(null);
    } catch (cause) {
      setError(errorMessage(cause, t));
    } finally {
      setWorking(false);
    }
  };

  const proposalRows = proposals.data?.proposals ?? [];
  return (
    <section className={panelClass} aria-labelledby="course-designer-heading">
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
        <Badge variant="outline">{t("authoring.designer.proposalOnly")}</Badge>
      </div>
      <label className={`${labelClass} mt-5`}>
        {t("authoring.designer.prompt")}
        <textarea
          className={`${fieldClass} min-h-28`}
          value={prompt}
          maxLength={50_000}
          placeholder={t("authoring.designer.promptPlaceholder")}
          onChange={(event) => setPrompt(event.target.value)}
        />
      </label>
      <div className="mt-3">
        <Button
          type="button"
          disabled={busy || working || !prompt.trim()}
          onClick={() => void requestProposal()}
        >
          {t(
            working
              ? "authoring.designer.generating"
              : "authoring.designer.generate",
          )}
        </Button>
      </div>

      {pendingDisclosure ? (
        <div
          className="mt-5 rounded-lg border border-warning/40 bg-warning/5 p-4"
          role="alert"
        >
          <h4 className="font-medium">
            {t("authoring.designer.disclosureTitle")}
          </h4>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("authoring.designer.disclosureDescription", {
              destination: pendingDisclosure.disclosure.scope.destination,
              bytes:
                pendingDisclosure.disclosure.scope.byteCount.toLocaleString(
                  locale,
                ),
            })}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            {pendingDisclosure.disclosure.scope.payloadCategories.join(", ")}
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
      {proposals.isError ? (
        <div className="mt-5">
          <QueryError
            message={t("authoring.designer.proposalsUnavailable")}
            retry={() => void proposals.refetch()}
          />
        </div>
      ) : proposalRows.length > 0 ? (
        <div className="mt-6 grid gap-3">
          <h4 className="font-medium">
            {t("authoring.designer.proposalsTitle")}
          </h4>
          {proposalRows.map((record) => (
            <article
              key={record.id}
              className="rounded-lg border border-border bg-background p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium">{record.proposal.summary}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t("authoring.designer.changeCount", {
                      count:
                        record.proposal.changes.length.toLocaleString(locale),
                    })}
                  </p>
                </div>
                <Badge
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
              <ul className="mt-3 grid gap-2 text-sm">
                {record.proposal.changes.map((change, index) => (
                  <li
                    key={`${record.id}:${index}`}
                    className="rounded-md border border-border px-3 py-2"
                  >
                    <span className="font-medium">
                      {t(`authoring.designer.change.${change.kind}`)}
                    </span>{" "}
                    · {change.title} · <code>{change.stableId}</code>
                  </li>
                ))}
              </ul>
              {record.status === "proposed" ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={busy || working}
                    onClick={() => {
                      setError(null);
                      void mutate(
                        `/curriculum-editor/versions/${graph.version.id}/designer/proposals/${encodeURIComponent(record.id)}/apply`,
                        { method: "POST", body: JSON.stringify({}) },
                        z
                          .object({
                            proposal: courseProposalRecordSchema,
                            curriculum: graphSchema,
                          })
                          .strict(),
                      ).catch((cause) => setError(errorMessage(cause, t)));
                    }}
                  >
                    {t("authoring.designer.apply")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy || working}
                    onClick={() => {
                      setError(null);
                      void mutate(
                        `/curriculum-editor/versions/${graph.version.id}/designer/proposals/${encodeURIComponent(record.id)}/reject`,
                        { method: "POST", body: JSON.stringify({}) },
                        courseProposalResponseSchema,
                      ).catch((cause) => setError(errorMessage(cause, t)));
                    }}
                  >
                    {t("authoring.designer.reject")}
                  </Button>
                </div>
              ) : null}
            </article>
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
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validation, setValidation] = useState<
    z.infer<typeof validationReportSchema> | undefined
  >();
  const [preview, setPreview] = useState<
    z.infer<typeof previewResponseSchema>["preview"] | undefined
  >();
  const [review, setReview] = useState<
    z.infer<typeof changeReviewResponseSchema>["review"] | undefined
  >();
  useEffect(() => {
    setConfirmed(false);
    setValidation(undefined);
    setPreview(undefined);
    setReview(undefined);
  }, [version.id, version.updatedAt]);
  if (version.status !== "draft") return null;

  const inspect = async <T,>(
    suffix: "validation" | "preview" | "change-review",
    schema: z.ZodType<T>,
  ): Promise<T> => {
    setChecking(true);
    setError(null);
    try {
      return await checkedApi(
        `/curriculum-editor/versions/${version.id}/${suffix}`,
        schema,
        t,
      );
    } catch (cause) {
      setError(errorMessage(cause, t));
      throw cause;
    } finally {
      setChecking(false);
    }
  };
  const releaseReady =
    validation?.valid === true &&
    preview?.draftHash === validation.draftHash &&
    review?.ready === true &&
    review.draftHash === validation.draftHash;

  return (
    <section
      className={`${panelClass} grid gap-5`}
      aria-labelledby="publish-heading"
      data-slot="adaptive-studio-release"
    >
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t("authoring.release.eyebrow")}
        </p>
        <h3 id="publish-heading" className="mt-1 font-medium">
          {t("authoring.publish.title")}
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("authoring.publish.description")}
        </p>
      </div>

      <ol className="grid gap-3 lg:grid-cols-3">
        <li className="rounded-lg border border-border bg-background p-4">
          <p className="font-medium">{t("authoring.release.validateTitle")}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("authoring.release.validateDescription")}
          </p>
          <Button
            className="mt-4"
            type="button"
            variant="outline"
            disabled={busy || checking}
            onClick={() => {
              void inspect("validation", validationResponseSchema)
                .then(({ report }) => setValidation(report))
                .catch(() => undefined);
            }}
          >
            {t("authoring.release.validateAction")}
          </Button>
          {validation ? (
            <div className="mt-3 text-sm" role="status">
              <Badge variant={validation.valid ? "success" : "error"}>
                {validation.valid
                  ? t("authoring.release.passed")
                  : t("authoring.release.blocked")}
              </Badge>
              <p className="mt-2 text-muted-foreground">
                {t("authoring.release.diagnosticCounts", {
                  errors: validation.errors,
                  warnings: validation.warnings,
                })}
              </p>
              {validation.diagnostics.length ? (
                <ul className="mt-2 grid gap-1">
                  {validation.diagnostics.map((diagnostic) => (
                    <li key={`${diagnostic.code}:${diagnostic.path}`}>
                      <span className="font-medium">{diagnostic.path}</span>:{" "}
                      {diagnostic.message}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </li>

        <li className="rounded-lg border border-border bg-background p-4">
          <p className="font-medium">{t("authoring.release.previewTitle")}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("authoring.release.previewDescription")}
          </p>
          <Button
            className="mt-4"
            type="button"
            variant="outline"
            disabled={busy || checking}
            onClick={() => {
              void inspect("preview", previewResponseSchema)
                .then(({ preview: nextPreview }) => setPreview(nextPreview))
                .catch(() => undefined);
            }}
          >
            {t("authoring.release.previewAction")}
          </Button>
          {preview ? (
            <details className="mt-3 text-sm" open>
              <summary className="cursor-pointer font-medium">
                {preview.title}
              </summary>
              <div className="mt-2 grid gap-2 text-muted-foreground">
                {preview.weeks.map((week) => (
                  <div key={week.stableId}>
                    {week.title} ·{" "}
                    {t("authoring.release.dayCount", {
                      count: week.days.length,
                    })}
                  </div>
                ))}
              </div>
            </details>
          ) : null}
        </li>

        <li className="rounded-lg border border-border bg-background p-4">
          <p className="font-medium">{t("authoring.release.reviewTitle")}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("authoring.release.reviewDescription")}
          </p>
          <Button
            className="mt-4"
            type="button"
            variant="outline"
            disabled={busy || checking}
            onClick={() => {
              void inspect("change-review", changeReviewResponseSchema)
                .then(({ review: nextReview }) => setReview(nextReview))
                .catch(() => undefined);
            }}
          >
            {t("authoring.release.reviewAction")}
          </Button>
          {review ? (
            <p className="mt-3 text-sm text-muted-foreground" role="status">
              {t("authoring.release.changeCounts", {
                added: review.added,
                changed: review.changed,
                removed: review.removed,
              })}
            </p>
          ) : null}
        </li>
      </ol>

      <label className="flex items-start gap-3 text-sm">
        <input
          className="mt-1"
          type="checkbox"
          checked={confirmed}
          disabled={!releaseReady}
          onChange={(event) => setConfirmed(event.target.checked)}
        />
        {t("authoring.publish.confirmation")}
      </label>
      {!releaseReady ? (
        <p className="text-sm text-muted-foreground">
          {t("authoring.release.required")}
        </p>
      ) : null}
      <SubmitError message={error} />
      <div>
        <Button
          disabled={busy || checking || !confirmed || !releaseReady}
          onClick={() => {
            if (!validation || !preview || !review) return;
            setError(null);
            void mutate(
              `/curriculum-editor/versions/${version.id}/publish`,
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
            ).catch((cause) => setError(errorMessage(cause, t)));
          }}
        >
          {t("authoring.publish.submit")}
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
  const [addWeek, setAddWeek] = useState(false);
  const editable = graph.version.status === "draft";
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
    <div className="grid gap-5">
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
        />
      ))}
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
      <PublishPanel version={graph.version} mutate={mutate} busy={busy} />
    </div>
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
}) {
  const { locale, t } = useI18n();
  const [edit, setEdit] = useState(false);
  const [addDay, setAddDay] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <section className={panelClass} data-editor-week={week.id}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs text-muted-foreground">
            {t("authoring.week.meta", {
              number: (index + 1).toLocaleString(locale),
              id: week.stableId,
            })}
          </p>
          <h3 className="mt-1 text-lg font-semibold">{week.title}</h3>
          {week.description ? (
            <p className="mt-1 text-sm text-muted-foreground">
              {week.description}
            </p>
          ) : null}
        </div>
        {editable ? (
          <div className="flex flex-wrap items-center gap-1">
            <ReorderControls
              label={t("authoring.entity.week", { title: week.title })}
              index={index}
              count={siblings.length}
              disabled={busy}
              move={(direction) => {
                setError(null);
                void reorder(
                  `/curriculum-editor/versions/${versionId}/weeks/reorder`,
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
                  `/curriculum-editor/versions/${versionId}/weeks/${week.id}`,
                )
              }
            />
          </div>
        ) : null}
      </div>
      <SubmitError message={error} />
      {edit ? (
        <div className="mt-4">
          <WeekForm
            versionId={versionId}
            initial={week}
            mutate={mutate}
            busy={busy}
            onClose={() => setEdit(false)}
          />
        </div>
      ) : null}
      <div className="mt-5 grid gap-4">
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
    </section>
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
    <section
      className="rounded-lg border border-border bg-muted/20 p-4"
      data-editor-day={day.id}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs text-muted-foreground">
            {t("authoring.day.meta", {
              number: (index + 1).toLocaleString(locale),
              id: day.stableId,
              minutes: day.estimatedMinutes.toLocaleString(locale),
            })}
          </p>
          <h4 className="mt-1 font-medium">{day.title}</h4>
          <p className="mt-1 text-sm text-muted-foreground">{day.goal}</p>
        </div>
        {editable ? (
          <div className="flex flex-wrap items-center gap-1">
            <ReorderControls
              label={t("authoring.entity.day", { title: day.title })}
              index={index}
              count={siblings.length}
              disabled={busy}
              move={(direction) => {
                setError(null);
                void reorder(
                  `/curriculum-editor/versions/${versionId}/weeks/${weekId}/days/reorder`,
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
                  `/curriculum-editor/versions/${versionId}/days/${day.id}`,
                )
              }
            />
          </div>
        ) : null}
      </div>
      <SubmitError message={error} />
      {edit ? (
        <div className="mt-4">
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
      <div className="mt-4 grid gap-3">
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
    </section>
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
      className="rounded-lg border border-border bg-card p-3"
      data-editor-unit={unit.id}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{unit.type}</Badge>
            <span className="font-medium">{unit.title}</span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{unit.stableId}</p>
        </div>
        {editable ? (
          <div className="flex flex-wrap items-center gap-1">
            <ReorderControls
              label={t("authoring.entity.unit", { title: unit.title })}
              index={index}
              count={siblings.length}
              disabled={busy}
              move={(direction) => {
                setError(null);
                void reorder(
                  `/curriculum-editor/versions/${versionId}/days/${dayId}/units/reorder`,
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
                  `/curriculum-editor/versions/${versionId}/units/${unit.id}`,
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
        `/curriculum-editor/courses/${courseId}/adaptation`,
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
        <Skeleton className="h-32" />
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
      `/curriculum-editor/courses/${courseId}/adaptation/integrate`,
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
                `/curriculum-editor/versions/${comparison.upstreamRevisionId}/adaptation`,
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

function CurrentProgramCard({
  version,
  published,
  graph,
  mutate,
  busy,
}: {
  version: VersionListItem;
  published: VersionListItem | undefined;
  graph: Graph | undefined;
  mutate: Mutate;
  busy: boolean;
}) {
  const { formatDate, locale, t } = useI18n();
  const weeksCount = graph?.weeks.length ?? 0;
  const daysCount =
    graph?.weeks.reduce((total, week) => total + week.days.length, 0) ?? 0;
  const date = version.publishedAt ?? version.createdAt;
  const isPublished = version.status === "published";
  const cloneTarget = isPublished ? version : published;
  return (
    <section data-slot="current-program" className={panelClass}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">
            {t("authoring.current.label")}
          </p>
          <h2 className="mt-1 text-xl font-semibold">
            {t("authoring.revision.heading", {
              revision: version.revision.toLocaleString(locale),
              title: version.title,
            })}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t(
              isPublished
                ? "authoring.current.publishedAt"
                : "authoring.current.draftCreatedAt",
              { date: formatDate(date, authoringDateOptions) },
            )}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {graph
              ? t("authoring.current.structure", {
                  weeks: formatQuantity("week", weeksCount, locale, t),
                  days: formatQuantity("day", daysCount, locale, t),
                })
              : t("authoring.current.structureLoading")}
          </p>
          {version.description ? (
            <p className="mt-2 text-sm text-muted-foreground">
              {version.description}
            </p>
          ) : null}
        </div>
        <Badge
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
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-border pt-4">
        <CreateDraftPanel mutate={mutate} busy={busy} />
        {cloneTarget ? (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => {
              void mutate(
                `/curriculum-editor/versions/${cloneTarget.id}/clone`,
                {
                  method: "POST",
                  body: JSON.stringify({
                    operationId: operationId(),
                    title: `${cloneTarget.title} — new edition`,
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
    </section>
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
    <details className={panelClass} data-slot="version-history">
      <summary className="cursor-pointer font-medium">
        {t("authoring.history.title")}
      </summary>
      {versions.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          {t("authoring.history.empty")}
        </p>
      ) : (
        <ul className="mt-4 grid gap-2">
          {versions.map((version) => (
            <li
              key={version.id}
              className="rounded-lg border border-border p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  className="min-w-0 text-left"
                  onClick={() => onSelect(version.id)}
                >
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <strong className="text-sm">
                      {t("authoring.revision.label", {
                        revision: version.revision.toLocaleString(locale),
                      })}
                    </strong>
                    <span className="truncate font-mono text-xs text-muted-foreground">
                      r{version.revision} · {version.title}
                    </span>
                  </span>
                </button>
                <Badge variant={versionBadgeVariant(version.status)}>
                  {t(versionStatusMessageKeys[version.status])}
                </Badge>
              </div>
              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-muted-foreground">
                  {t("authoring.history.details")}
                </summary>
                <dl className="mt-2 grid gap-1 text-xs leading-5 text-muted-foreground">
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
                  {version.description ? (
                    <div>
                      {t("authoring.history.description", {
                        description: version.description,
                      })}
                    </div>
                  ) : null}
                </dl>
              </details>
            </li>
          ))}
        </ul>
      )}
    </details>
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
      className={`${panelClass} flex flex-wrap items-center justify-between gap-4`}
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
            "/curriculum-editor/versions",
            {
              method: "POST",
              body: JSON.stringify({
                operationId: operationId(),
                curriculum: {
                  id: current.curriculumId,
                  slug: current.curriculumSlug,
                  title: current.title,
                },
                title: `${current.title} — new edition`,
                description: null,
              }),
            },
            z.object({ version: versionSchema }).strict(),
          )) as { version: Version };
          versionId = created.version.id;
        }
      }

      const weekBase = `${slugify(title) || "week"}-${Date.now()}`;
      const createdWeek = (await mutate(
        `/curriculum-editor/versions/${versionId}/weeks`,
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
          `/curriculum-editor/versions/${versionId}/weeks/${createdWeek.week.id}/days`,
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

export function CurriculumEditorClient() {
  const { locale, t } = useI18n();
  const queryClient = useQueryClient();
  const pendingOperations = usePendingOperations();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  const [addWeekOpen, setAddWeekOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const selectVersion = (id: string | null) => {
    selectedIdRef.current = id;
    setSelectedId(id);
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
  useEffect(() => {
    if (!selectedId && versions.data?.versions[0])
      selectVersion(versions.data.versions[0].id);
  }, [selectedId, versions.data]);
  const graph = useQuery({
    queryKey: ["curriculum-editor", "version", selectedId],
    enabled: Boolean(selectedId),
    queryFn: () =>
      checkedApi(
        `/curriculum-editor/versions/${selectedId ?? ""}`,
        z.object({ curriculum: graphSchema }).strict(),
        t,
      ),
  });
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
      setActionError(errorMessage(cause, t));
      throw cause;
    } finally {
      setBusy(false);
    }
  };

  if (versions.isLoading)
    return (
      <div role="status" aria-label={t("authoring.loading.versions")}>
        <Skeleton className="h-72" />
      </div>
    );
  if (versions.isError || !versions.data)
    return (
      <QueryError
        message={t("authoring.error.versionsUnavailable")}
        retry={() => void versions.refetch()}
      />
    );
  const selectedVersion =
    versions.data.versions.find((version) => version.id === selectedId) ??
    versions.data.versions[0]!;

  return (
    <div className="grid gap-6">
      {actionError ? (
        <div
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
        >
          {actionError}
        </div>
      ) : null}
      {versions.data.versions.length === 0 ? (
        <section className={panelClass}>
          <h2 className="text-lg font-semibold">
            {t("authoring.emptyProgram.title")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("authoring.emptyProgram.description")}
          </p>
          <div className="mt-5">
            <CreateDraftPanel mutate={mutate} busy={busy} />
          </div>
        </section>
      ) : (
        <>
          <CurrentProgramCard
            version={selectedVersion}
            published={versions.data.versions.find(
              (version) => version.status === "published",
            )}
            graph={graph.data?.curriculum}
            mutate={mutate}
            busy={busy}
          />
          <PersonalAdaptationPanel
            courseId={selectedVersion.curriculumId}
            mutate={mutate}
            busy={busy}
            onSelect={selectVersion}
          />
          <AddWeekCard onOpen={() => setAddWeekOpen(true)} disabled={busy} />
          <VersionHistory
            versions={versions.data.versions.filter(
              (version) => version.id !== selectedVersion.id,
            )}
            onSelect={selectVersion}
          />
          <section
            className="min-w-0"
            aria-label={t("authoring.graph.selectedRevision")}
          >
            {!selectedId ? (
              <EmptyState
                title={t("authoring.selectRevision.title")}
                description={t("authoring.selectRevision.description")}
              />
            ) : graph.isLoading ? (
              <div role="status" aria-label={t("authoring.loading.graph")}>
                <Skeleton className="h-96" />
              </div>
            ) : graph.isError || !graph.data ? (
              <QueryError
                message={t("authoring.error.graphUnavailable")}
                retry={() => void graph.refetch()}
              />
            ) : (
              <div className="grid gap-5">
                <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-5">
                  <div>
                    <p className="text-sm text-muted-foreground">
                      {t("authoring.revision.label", {
                        revision:
                          graph.data.curriculum.version.revision.toLocaleString(
                            locale,
                          ),
                      })}
                    </p>
                    <h2 className="mt-1 text-xl font-semibold">
                      {graph.data.curriculum.version.title}
                    </h2>
                    {graph.data.curriculum.version.description ? (
                      <p className="mt-1 text-sm text-muted-foreground">
                        {graph.data.curriculum.version.description}
                      </p>
                    ) : null}
                  </div>
                  <Badge
                    variant={
                      graph.data.curriculum.version.status === "published"
                        ? "success"
                        : "warning"
                    }
                  >
                    {graph.data.curriculum.version.status === "published"
                      ? t("authoring.status.publishedReadOnly")
                      : t("authoring.status.draft")}
                  </Badge>
                </header>
                <CourseDesignerPanel
                  graph={graph.data.curriculum}
                  mutate={mutate}
                  busy={busy}
                />
                <GraphEditor
                  graph={graph.data.curriculum}
                  mutate={mutate}
                  busy={busy}
                />
              </div>
            )}
          </section>
        </>
      )}
      <AddWeekSheet
        open={addWeekOpen}
        onOpenChange={setAddWeekOpen}
        current={selectedVersion}
        versions={versions.data.versions}
        mutate={mutate}
        busy={busy}
        selectVersion={selectVersion}
      />
    </div>
  );
}
