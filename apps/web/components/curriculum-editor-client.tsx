"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CopyIcon,
  PlusIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { z } from "zod";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, QueryError } from "@/components/query-state";
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

type Version = z.infer<typeof versionSchema>;
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

function assertSafeResponse(value: unknown, path = "response"): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      assertSafeResponse(item, `${path}[${index}]`),
    );
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    if (forbiddenResponseKeys.has(key)) {
      throw new Error(`Небезопасное поле ответа: ${path}.${key}`);
    }
    assertSafeResponse(nested, `${path}.${key}`);
  }
}

async function checkedApi<T>(
  path: string,
  schema: z.ZodType<T>,
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
        : (backendError?.message ?? `Request failed (${response.status})`);
    throw new Error(message);
  }
  assertSafeResponse(value);
  return schema.parse(value);
}

function operationId(): string {
  return crypto.randomUUID();
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

function errorMessage(error: unknown): string {
  if (error instanceof z.ZodError)
    return "Ответ сервера не прошёл локальную проверку безопасности.";
  if (error instanceof Error) return error.message;
  return "Изменение не удалось сохранить.";
}

function parseJson<T>(
  label: string,
  value: FormDataEntryValue | null,
  schema: z.ZodType<T>,
): T {
  const text = typeof value === "string" ? value : "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${label}: требуется корректный JSON.`);
  }
  const result = schema.safeParse(parsed);
  if (!result.success)
    throw new Error(`${label}: структура не соответствует контракту.`);
  return result.data;
}

function text(form: FormData, name: string): string {
  return String(form.get(name) ?? "").trim();
}

function optionalText(form: FormData, name: string): string | null {
  const value = text(form, name);
  return value || null;
}

function JsonField({
  name,
  label,
  value,
  rows = 4,
}: {
  name: string;
  label: string;
  value: unknown;
  rows?: number;
}) {
  const id = useId();
  return (
    <label htmlFor={id} className={labelClass}>
      {label}
      <textarea
        id={id}
        name={name}
        rows={rows}
        className={`${fieldClass} resize-y font-mono text-xs leading-5`}
        defaultValue={JSON.stringify(value, null, 2)}
        spellCheck={false}
      />
    </label>
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
  return (
    <div className="flex gap-1" aria-label={`Порядок: ${label}`}>
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        disabled={disabled || index === 0}
        aria-label={`Поднять ${label}`}
        onClick={() => move(-1)}
      >
        <ArrowUpIcon aria-hidden />
      </Button>
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        disabled={disabled || index === count - 1}
        aria-label={`Опустить ${label}`}
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
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!armed) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={`Удалить ${label}`}
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
      aria-label={`Подтверждение удаления: ${label}`}
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
              .catch((cause) => setError(errorMessage(cause)));
          }}
        >
          Подтвердить удаление
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => setArmed(false)}
        >
          Отмена
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
  const [error, setError] = useState<string | null>(null);
  return (
    <details className={panelClass}>
      <summary className="cursor-pointer font-medium">
        Новая отдельная программа
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
          ).catch((cause) => setError(errorMessage(cause)));
        }}
      >
        <label className={labelClass}>
          ID программы
          <input
            className={fieldClass}
            name="curriculumId"
            required
            pattern="[^\s]+"
          />
        </label>
        <label className={labelClass}>
          Slug
          <input
            className={fieldClass}
            name="slug"
            required
            pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
          />
        </label>
        <label className={labelClass}>
          Название программы
          <input className={fieldClass} name="curriculumTitle" required />
        </label>
        <label className={labelClass}>
          Название ревизии
          <input className={fieldClass} name="title" required />
        </label>
        <label className={`${labelClass} md:col-span-2`}>
          Описание программы
          <textarea className={fieldClass} name="curriculumDescription" />
        </label>
        <label className={`${labelClass} md:col-span-2`}>
          Описание ревизии
          <textarea className={fieldClass} name="description" />
        </label>
        <div className="flex flex-col items-start gap-3 md:col-span-2">
          <SubmitError message={error} />
          <Button disabled={busy} type="submit">
            <PlusIcon aria-hidden />
            Создать черновик
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
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      aria-label={
        initial ? `Редактировать неделю ${initial.title}` : "Добавить неделю"
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
          .catch((cause) => setError(errorMessage(cause)));
      }}
    >
      <div className="grid gap-3 md:grid-cols-2">
        <label className={labelClass}>
          Стабильный ID
          <input
            className={fieldClass}
            name="stableId"
            required
            defaultValue={initial?.stableId}
          />
        </label>
        <label className={labelClass}>
          Название
          <input
            className={fieldClass}
            name="title"
            required
            defaultValue={initial?.title}
          />
        </label>
      </div>
      <label className={labelClass}>
        Описание
        <textarea
          className={fieldClass}
          name="description"
          defaultValue={initial?.description ?? ""}
        />
      </label>
      <SubmitError message={error} />
      <div>
        <Button disabled={busy} type="submit">
          {initial ? "Сохранить неделю" : "Добавить неделю"}
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
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      aria-label={
        initial ? `Редактировать день ${initial.title}` : "Добавить день"
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
              "Предпосылки",
              form.get("prerequisites"),
              stringArraySchema,
            ),
            expectedOutcomes: parseJson(
              "Результаты",
              form.get("expectedOutcomes"),
              stringArraySchema,
            ),
            outOfScope: parseJson(
              "Вне рамок",
              form.get("outOfScope"),
              stringArraySchema,
            ),
            topics: parseJson("Темы", form.get("topics"), stringArraySchema),
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
            .catch((cause) => setError(errorMessage(cause)));
        } catch (cause) {
          setError(errorMessage(cause));
        }
      }}
    >
      <div className="grid gap-3 md:grid-cols-2">
        <label className={labelClass}>
          Стабильный ID
          <input
            className={fieldClass}
            name="stableId"
            required
            defaultValue={initial?.stableId}
          />
        </label>
        <label className={labelClass}>
          Название
          <input
            className={fieldClass}
            name="title"
            required
            defaultValue={initial?.title}
          />
        </label>
        <label className={labelClass}>
          Минуты
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
          Глубина
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
        Цель
        <textarea
          className={fieldClass}
          name="goal"
          required
          defaultValue={initial?.goal}
        />
      </label>
      <label className={labelClass}>
        Описание
        <textarea
          className={fieldClass}
          name="description"
          defaultValue={initial?.description ?? ""}
        />
      </label>
      <div className="grid gap-3 md:grid-cols-2">
        <JsonField
          name="prerequisites"
          label="Предпосылки · JSON string[]"
          value={initial?.prerequisites ?? []}
        />
        <JsonField
          name="expectedOutcomes"
          label="Ожидаемые результаты · JSON string[]"
          value={initial?.expectedOutcomes ?? []}
        />
        <JsonField
          name="outOfScope"
          label="Вне рамок · JSON string[]"
          value={initial?.outOfScope ?? []}
        />
        <JsonField
          name="topics"
          label="Темы · JSON string[]"
          value={initial?.topics ?? []}
        />
      </div>
      <SubmitError message={error} />
      <div>
        <Button disabled={busy} type="submit">
          {initial ? "Сохранить день" : "Добавить день"}
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
    recall: { type, prompt: "Вспомните основные идеи" },
    "teacher-dialogue": {
      type,
      openingPrompt: "Объясните тему своими словами",
      minimumTurns: 1,
      requiresRevision: true,
    },
    quiz: { type, questionIds: ["question-1"], minimumScore: 0.8 },
    "code-reading": { type, snippet: "const value = 1;" },
    exercise: {
      type,
      exerciseId: "exercise-1",
      acceptanceCriteria: ["Проверки проходят"],
      constraints: [],
      template: "// TODO",
      testCommandId: "test",
      hintPolicy: "По уровням",
      reviewPolicy: "Read-only",
    },
    review: { type, exerciseUnitId: "exercise-unit" },
    interview: { type, topics: ["Тема"] },
    summary: { type, prompts: [] },
    checkpoint: { type, label: "Контрольная точка" },
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
  const [error, setError] = useState<string | null>(null);
  const [type, setType] = useState<z.infer<typeof UnitTypeSchema>>(
    initial?.type ?? "briefing",
  );
  return (
    <form
      aria-label={
        initial ? `Редактировать юнит ${initial.title}` : "Добавить юнит"
      }
      className="grid gap-4 rounded-lg border border-border bg-background p-4"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        try {
          const form = new FormData(event.currentTarget);
          const unitType = UnitTypeSchema.parse(text(form, "type"));
          const payload = parseJson(
            "Payload",
            form.get("payload"),
            UnitPayloadSchema,
          );
          if (payload.type !== unitType)
            throw new Error("Payload: type должен совпадать с типом юнита.");
          const minutes = text(form, "estimatedMinutes");
          const body = {
            operationId: operationId(),
            stableId: text(form, "stableId"),
            type: unitType,
            title: text(form, "title"),
            description: optionalText(form, "description"),
            estimatedMinutes: minutes ? Number(minutes) : null,
            objectives: parseJson(
              "Цели",
              form.get("objectives"),
              unitJsonSchemas.objectives,
            ),
            checklist: parseJson(
              "Чеклист",
              form.get("checklist"),
              unitJsonSchemas.checklist,
            ),
            sources: parseJson(
              "Источники",
              form.get("sources"),
              unitJsonSchemas.sources,
            ),
            questions: parseJson(
              "Вопросы",
              form.get("questions"),
              unitJsonSchemas.questions,
            ),
            misconceptions: parseJson(
              "Типичные ошибки",
              form.get("misconceptions"),
              unitJsonSchemas.misconceptions,
            ),
            referenceAnswer: optionalText(form, "referenceAnswer"),
            completionCriteria: parseJson(
              "Критерии завершения",
              form.get("completionCriteria"),
              unitJsonSchemas.completionCriteria,
            ),
            unlockRules: parseJson(
              "Правила открытия",
              form.get("unlockRules"),
              unitJsonSchemas.unlockRules,
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
            .catch((cause) => setError(errorMessage(cause)));
        } catch (cause) {
          setError(errorMessage(cause));
        }
      }}
    >
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <label className={labelClass}>
          Стабильный ID
          <input
            className={fieldClass}
            name="stableId"
            required
            defaultValue={initial?.stableId}
          />
        </label>
        <label className={labelClass}>
          Название
          <input
            className={fieldClass}
            name="title"
            required
            defaultValue={initial?.title}
          />
        </label>
        <label className={labelClass}>
          Тип
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
          Минуты
          <input
            className={fieldClass}
            name="estimatedMinutes"
            type="number"
            min="1"
            defaultValue={initial?.estimatedMinutes ?? ""}
          />
        </label>
        <label className={labelClass}>
          Глубина
          <select
            className={fieldClass}
            name="depthLevel"
            defaultValue={initial?.depthLevel ?? ""}
          >
            <option value="">Наследовать</option>
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
          Необязательный юнит
        </label>
      </div>
      <label className={labelClass}>
        Описание
        <textarea
          className={fieldClass}
          name="description"
          defaultValue={initial?.description ?? ""}
        />
      </label>
      <label className={labelClass}>
        Эталонный ответ · только для авторинга
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
        <JsonField
          name="objectives"
          label="Цели · JSON"
          value={initial?.objectives ?? []}
        />
        <JsonField
          name="checklist"
          label="Чеклист · JSON"
          value={initial?.checklist ?? []}
        />
        <JsonField
          name="sources"
          label="Источники · JSON"
          value={initial?.sources ?? []}
          rows={6}
        />
        <JsonField
          name="questions"
          label="Вопросы и ключи · JSON"
          value={initial?.questions ?? []}
          rows={8}
        />
        <JsonField
          name="misconceptions"
          label="Типичные ошибки · JSON"
          value={initial?.misconceptions ?? []}
        />
        <JsonField
          name="completionCriteria"
          label="Критерии завершения · JSON"
          value={initial?.completionCriteria ?? [{ type: "acknowledgement" }]}
        />
        <JsonField
          name="unlockRules"
          label="Правила открытия · JSON"
          value={initial?.unlockRules ?? []}
        />
        <JsonField
          key={`${initial?.id ?? "new"}-${type}`}
          name="payload"
          label="Payload · JSON"
          value={
            initial && initial.type === type
              ? initial.payload
              : defaultPayload(type)
          }
          rows={8}
        />
      </div>
      <SubmitError message={error} />
      <div>
        <Button disabled={busy} type="submit">
          {initial ? "Сохранить юнит" : "Добавить юнит"}
        </Button>
      </div>
    </form>
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
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (version.status !== "draft") return null;
  return (
    <section
      className={`${panelClass} grid gap-4`}
      aria-labelledby="publish-heading"
    >
      <div>
        <h3 id="publish-heading" className="font-medium">
          Публикация ревизии
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          После публикации ревизия становится неизменяемой. Для следующих правок
          клонируйте её в новый черновик.
        </p>
      </div>
      <label className="flex items-start gap-3 text-sm">
        <input
          className="mt-1"
          type="checkbox"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
        />
        Я понимаю, что опубликованную ревизию нельзя редактировать.
      </label>
      <SubmitError message={error} />
      <div>
        <Button
          disabled={busy || !confirmed}
          onClick={() => {
            setError(null);
            void mutate(
              `/curriculum-editor/versions/${version.id}/publish`,
              {
                method: "POST",
                body: JSON.stringify({ operationId: operationId() }),
              },
              z.object({ version: versionSchema }).strict(),
            ).catch((cause) => setError(errorMessage(cause)));
          }}
        >
          Опубликовать неизменяемую ревизию
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
          <strong>Только чтение.</strong> Опубликованная ревизия защищена от
          изменений.
        </div>
      ) : null}
      {graph.weeks.length === 0 ? (
        <EmptyState
          title="В черновике пока нет недель"
          description="Добавьте первую неделю, затем день и учебные юниты."
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
              Добавить неделю
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
  const [edit, setEdit] = useState(false);
  const [addDay, setAddDay] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <section className={panelClass} data-editor-week={week.id}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs text-muted-foreground">
            Неделя {index + 1} · {week.stableId}
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
              label={`неделю ${week.title}`}
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
                ).catch((cause) => setError(errorMessage(cause)));
              }}
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setEdit((value) => !value)}
            >
              Изменить
            </Button>
            <DeleteAction
              label={`неделю ${week.title}`}
              consequence="Неделя будет удалена вместе со всеми её днями и юнитами. Это действие нельзя отменить."
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
                Добавить день
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
            День {index + 1} · {day.stableId} · {day.estimatedMinutes} мин
          </p>
          <h4 className="mt-1 font-medium">{day.title}</h4>
          <p className="mt-1 text-sm text-muted-foreground">{day.goal}</p>
        </div>
        {editable ? (
          <div className="flex flex-wrap items-center gap-1">
            <ReorderControls
              label={`день ${day.title}`}
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
                ).catch((cause) => setError(errorMessage(cause)));
              }}
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setEdit((value) => !value)}
            >
              Изменить
            </Button>
            <DeleteAction
              label={`день ${day.title}`}
              consequence="День будет удалён вместе со всеми его юнитами. Это действие нельзя отменить."
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
                Добавить юнит
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
              label={`юнит ${unit.title}`}
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
                ).catch((cause) => setError(errorMessage(cause)));
              }}
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setEdit((value) => !value)}
            >
              Изменить
            </Button>
            <DeleteAction
              label={`юнит ${unit.title}`}
              consequence="Юнит будет удалён из черновика. Это действие нельзя отменить."
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

export function CurriculumEditorClient() {
  const queryClient = useQueryClient();
  const pendingOperations = usePendingOperations();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const versions = useQuery({
    queryKey: ["curriculum-editor", "versions"],
    queryFn: () =>
      checkedApi(
        "/curriculum-editor/versions",
        z.object({ versions: z.array(versionListItemSchema) }).strict(),
      ),
  });
  useEffect(() => {
    if (!selectedId && versions.data?.versions[0])
      setSelectedId(versions.data.versions[0].id);
  }, [selectedId, versions.data]);
  const graph = useQuery({
    queryKey: ["curriculum-editor", "version", selectedId],
    enabled: Boolean(selectedId),
    queryFn: () =>
      checkedApi(
        `/curriculum-editor/versions/${selectedId ?? ""}`,
        z.object({ curriculum: graphSchema }).strict(),
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
      const result = await checkedApi(path, schema, {
        ...init,
        body: JSON.stringify({ ...requestBody, operationId: operation }),
      });
      pendingOperations.confirmed(operationKey);
      const version = (result as { version?: Version }).version;
      const nextId = selectId ?? version?.id ?? selectedId;
      if (nextId) setSelectedId(nextId);
      await queryClient.invalidateQueries({ queryKey: ["curriculum-editor"] });
      return result;
    } catch (cause) {
      setActionError(errorMessage(cause));
      throw cause;
    } finally {
      setBusy(false);
    }
  };

  if (versions.isLoading)
    return (
      <div role="status" aria-label="Загружаю ревизии">
        <Skeleton className="h-72" />
      </div>
    );
  if (versions.isError || !versions.data)
    return (
      <QueryError
        message="Список ревизий недоступен."
        retry={() => void versions.refetch()}
      />
    );

  return (
    <div className="grid gap-6 xl:grid-cols-[300px_minmax(0,1fr)]">
      <aside
        className="grid content-start gap-4"
        aria-label="Ревизии программы"
      >
        <section className={panelClass}>
          <div className="mb-4">
            <h2 className="font-medium">Ревизии</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Черновики редактируются, опубликованные доступны только для
              чтения.
            </p>
          </div>
          {versions.data.versions.length === 0 ? (
            <p className="text-sm text-muted-foreground">Ревизий пока нет.</p>
          ) : (
            <div className="grid gap-2">
              {versions.data.versions.map((version) => (
                <div
                  key={version.id}
                  className={`rounded-lg border p-3 ${selectedId === version.id ? "border-primary bg-primary/5" : "border-border"}`}
                >
                  <button
                    type="button"
                    className="w-full text-left"
                    onClick={() => setSelectedId(version.id)}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <strong className="text-sm">
                        r{version.revision} · {version.title}
                      </strong>
                      <Badge
                        variant={
                          version.status === "published"
                            ? "success"
                            : version.status === "draft"
                              ? "warning"
                              : "secondary"
                        }
                      >
                        {version.status === "published"
                          ? "Опубликована"
                          : version.status === "draft"
                            ? "Черновик"
                            : "Архив"}
                      </Badge>
                    </span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {version.curriculumSlug}
                    </span>
                  </button>
                  {version.status === "published" ? (
                    <Button
                      className="mt-3 w-full"
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => {
                        void mutate(
                          `/curriculum-editor/versions/${version.id}/clone`,
                          {
                            method: "POST",
                            body: JSON.stringify({
                              operationId: operationId(),
                              title: `${version.title} — новая редакция`,
                            }),
                          },
                          z.object({ version: versionSchema }).strict(),
                        ).catch(() => undefined);
                      }}
                    >
                      <CopyIcon aria-hidden />
                      Клонировать в черновик
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </section>
        <CreateDraftPanel mutate={mutate} busy={busy} />
      </aside>
      <section className="min-w-0" aria-label="Граф выбранной ревизии">
        {actionError ? (
          <div
            role="alert"
            className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
          >
            {actionError}
          </div>
        ) : null}
        {!selectedId ? (
          <EmptyState
            title="Выберите ревизию"
            description="Откройте существующую ревизию или создайте новый черновик."
          />
        ) : graph.isLoading ? (
          <div role="status" aria-label="Загружаю граф программы">
            <Skeleton className="h-96" />
          </div>
        ) : graph.isError || !graph.data ? (
          <QueryError
            message="Граф ревизии недоступен или содержит небезопасные поля."
            retry={() => void graph.refetch()}
          />
        ) : (
          <div className="grid gap-5">
            <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-5">
              <div>
                <p className="text-sm text-muted-foreground">
                  Ревизия {graph.data.curriculum.version.revision}
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
                  ? "Опубликована · read-only"
                  : "Черновик"}
              </Badge>
            </header>
            <GraphEditor
              graph={graph.data.curriculum}
              mutate={mutate}
              busy={busy}
            />
          </div>
        )}
      </section>
    </div>
  );
}
