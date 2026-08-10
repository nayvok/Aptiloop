"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowSquareOutIcon,
  CheckCircleIcon,
  DownloadSimpleIcon,
  FileArrowUpIcon,
  PackageIcon,
  TrashIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { z } from "zod";

import { PageHeader } from "@/components/page-header";
import { EmptyState, QueryError } from "@/components/query-state";
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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { api } from "@/lib/api";

const hashSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const diagnosticSchema = z
  .object({
    code: z.string(),
    severity: z.enum(["error", "warning"]),
    path: z.string(),
    entityId: z.string().nullable(),
    message: z.string(),
  })
  .strict();
const reportSchema = z
  .object({
    validatorVersion: z.string(),
    valid: z.boolean(),
    errors: z.number().int().nonnegative(),
    warnings: z.number().int().nonnegative(),
    diagnostics: z.array(diagnosticSchema),
    limits: z.record(z.string(), z.number()),
  })
  .strict();
const previewSchema = z
  .object({
    courseKey: z.string(),
    courseTitle: z.string(),
    revisionKey: z.string(),
    revisionNumber: z.number().int().positive(),
    contentHash: hashSchema,
    primaryLocale: z.string(),
    availableLocales: z.array(z.string()),
    lessonCount: z.number().int().nonnegative(),
    activityCount: z.number().int().nonnegative(),
    sourcePrivacyClasses: z.object({
      public: z.number().int().nonnegative(),
      private: z.number().int().nonnegative(),
    }),
    requirements: z.object({
      activityTypes: z.array(z.string()),
      capabilities: z.array(z.string()),
      environmentIds: z.array(z.string()),
      checkIds: z.array(z.string()),
    }),
    provenance: z
      .object({
        contentStatus: z.enum(["development-fixture", "personal"]),
        author: z.string(),
        origin: z.enum(["original", "adapted", "generated", "migration"]),
        ownership: z.enum(["owned", "licensed", "permission", "unresolved"]),
        licenseSpdx: z.string().nullable(),
        termsUrl: z.string().nullable(),
        attribution: z.string().nullable(),
        createdAt: z.string().datetime(),
        notes: z.string().nullable(),
      })
      .strict(),
  })
  .strict();
const validationResponseSchema = z.discriminatedUnion("valid", [
  z
    .object({
      valid: z.literal(true),
      storageAvailable: z.boolean(),
      validationId: z.string().uuid(),
      expiresAt: z.string().datetime(),
      preview: previewSchema,
      report: reportSchema,
    })
    .strict(),
  z
    .object({
      valid: z.literal(false),
      storageAvailable: z.boolean(),
      report: reportSchema,
    })
    .strict(),
]);
const libraryItemSchema = z
  .object({
    courseId: z.string(),
    courseKey: z.string(),
    title: z.string(),
    revisionId: z.string(),
    revisionNumber: z.number().int().positive(),
    contentHash: hashSchema,
    revisionStatus: z.enum(["draft", "published", "archived"]),
    lifecycleAction: z.enum(["install", "open-as-draft", "uninstall"]),
    importedAt: z.string().datetime(),
  })
  .strict();
const librarySchema = z
  .object({
    storageAvailable: z.boolean(),
    packs: z.array(libraryItemSchema),
  })
  .strict();
const commitResponseSchema = z
  .object({
    result: z.object({
      courseId: z.string(),
      revisionId: z.string(),
      contentHash: hashSchema,
      action: z.enum(["install", "open-as-draft"]),
      revisionStatus: z.enum(["draft", "published", "archived"]),
      installed: z.boolean(),
      idempotent: z.boolean(),
    }),
    openPath: z.string().nullable(),
  })
  .strict();

type ValidationResponse = z.infer<typeof validationResponseSchema>;
type CoursePackLibraryItem = z.infer<typeof libraryItemSchema>;
type InstallAction = "install" | "open-as-draft";

const statusLabels: Record<CoursePackLibraryItem["revisionStatus"], string> = {
  draft: "Черновик",
  published: "Установлен",
  archived: "Удалён из библиотеки",
};

export function CoursePackClient() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [validation, setValidation] = useState<ValidationResponse | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const library = useQuery({
    queryKey: ["course-packs"],
    queryFn: async () => librarySchema.parse(await api("/course-packs")),
  });
  const validate = useMutation({
    mutationFn: async (selected: File) =>
      validationResponseSchema.parse(
        await api("/course-packs/validate", {
          method: "POST",
          body: selected,
        }),
      ),
    onSuccess: (result) => {
      setValidation(result);
      setNotice(null);
    },
  });
  const commit = useMutation({
    mutationFn: async (action: InstallAction) => {
      if (!validation?.valid) throw new Error("Сначала проверьте Course Pack");
      return commitResponseSchema.parse(
        await api(
          `/course-packs/validations/${encodeURIComponent(validation.validationId)}/commit`,
          {
            method: "POST",
            body: JSON.stringify({
              operationId: globalThis.crypto.randomUUID(),
              action,
              expectedContentHash: validation.preview.contentHash,
            }),
          },
        ),
      );
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["course-packs"] });
      setFile(null);
      setValidation(null);
      setNotice(
        result.result.action === "install"
          ? "Course Pack установлен. Открываем учебный путь."
          : "Course Pack сохранён как черновик.",
      );
      if (result.openPath) router.push(result.openPath);
    },
  });
  const uninstall = useMutation({
    mutationFn: async (item: CoursePackLibraryItem) =>
      api("/course-packs/uninstall", {
        method: "POST",
        body: JSON.stringify({
          operationId: globalThis.crypto.randomUUID(),
          revisionId: item.revisionId,
          confirmRevisionKey: item.revisionId,
        }),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["course-packs"] });
      setNotice(
        "Course Pack удалён из активной библиотеки. История сохранена.",
      );
    },
  });

  const actionError = validate.error ?? commit.error ?? uninstall.error;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Курсы"
        description="Проверяйте декларативный Course Pack до установки. Файл не может передавать команды, пути, credentials или провайдерские настройки."
      />

      <section
        aria-labelledby="course-pack-import-title"
        className="grid gap-6 rounded-xl border border-border bg-card p-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:p-6"
      >
        <div className="flex flex-col gap-5">
          <div className="flex items-start gap-3">
            <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-accent text-accent-foreground">
              <FileArrowUpIcon aria-hidden className="size-5" />
            </div>
            <div className="flex flex-col gap-1">
              <h2
                id="course-pack-import-title"
                className="text-lg font-semibold"
              >
                Импорт Course Pack
              </h2>
              <p className="text-sm leading-6 text-muted-foreground">
                Сначала — локальная проверка и Preview. Установка выполняется
                только отдельным подтверждённым действием.
              </p>
            </div>
          </div>
          <FieldGroup>
            <Field data-invalid={validate.isError || undefined}>
              <FieldLabel htmlFor="course-pack-file">JSON-файл</FieldLabel>
              <Input
                id="course-pack-file"
                type="file"
                accept="application/json,.json"
                aria-invalid={validate.isError}
                onChange={(event) => {
                  setFile(event.currentTarget.files?.[0] ?? null);
                  setValidation(null);
                  setNotice(null);
                  validate.reset();
                  commit.reset();
                }}
              />
              <FieldDescription>
                UTF-8 JSON, не более 1 MiB. Невалидные исходные байты не
                сохраняются.
              </FieldDescription>
            </Field>
            <Field orientation="horizontal">
              <Button
                type="button"
                disabled={!file || validate.isPending}
                onClick={() => {
                  if (file) validate.mutate(file);
                }}
              >
                {validate.isPending ? (
                  <Spinner data-icon="inline-start" />
                ) : null}
                Проверить Pack
              </Button>
              {file ? (
                <span className="min-w-0 truncate text-sm text-muted-foreground">
                  {file.name}
                </span>
              ) : null}
            </Field>
          </FieldGroup>

          {!library.data?.storageAvailable ? (
            <Alert>
              <WarningCircleIcon aria-hidden />
              <AlertTitle>Хранилище M3 недоступно</AlertTitle>
              <AlertDescription>
                Preview работает, но установка заблокирована до применения
                миграции Course Pack.
              </AlertDescription>
            </Alert>
          ) : null}
          {actionError ? (
            <Alert variant="destructive">
              <WarningCircleIcon aria-hidden />
              <AlertTitle>Операция не выполнена</AlertTitle>
              <AlertDescription>{actionError.message}</AlertDescription>
            </Alert>
          ) : null}
          {notice ? (
            <Alert>
              <CheckCircleIcon aria-hidden />
              <AlertTitle>Готово</AlertTitle>
              <AlertDescription>{notice}</AlertDescription>
            </Alert>
          ) : null}
        </div>

        <CoursePackPreviewPanel
          validation={validation}
          pending={commit.isPending}
          onCommit={(action) => commit.mutate(action)}
        />
      </section>

      <section
        aria-labelledby="course-library-title"
        className="flex flex-col gap-4"
      >
        <div className="flex items-end justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h2 id="course-library-title" className="text-xl font-semibold">
              Локальная библиотека
            </h2>
            <p className="text-sm text-muted-foreground">
              Импортированные ревизии неизменяемы; удаление скрывает курс, но
              сохраняет факты обучения.
            </p>
          </div>
          {library.data ? (
            <Badge variant="outline">{library.data.packs.length} ревизий</Badge>
          ) : null}
        </div>

        {library.isLoading ? <CourseLibrarySkeleton /> : null}
        {library.isError ? (
          <QueryError
            message={library.error.message}
            retry={() => void library.refetch()}
          />
        ) : null}
        {library.data?.packs.length === 0 ? (
          <EmptyState
            title="Course Pack пока не установлены"
            description="Выберите JSON-файл выше: сначала система покажет ошибки, provenance, требования и хэш Preview."
          />
        ) : null}
        {library.data && library.data.packs.length > 0 ? (
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            {library.data.packs.map((item, index) => (
              <CourseLibraryRow
                key={item.revisionId}
                item={item}
                first={index === 0}
                uninstalling={
                  uninstall.isPending &&
                  uninstall.variables?.revisionId === item.revisionId
                }
                onExport={() => void exportPack(item)}
                onUninstall={() => uninstall.mutate(item)}
              />
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}

function CoursePackPreviewPanel({
  validation,
  pending,
  onCommit,
}: {
  validation: ValidationResponse | null;
  pending: boolean;
  onCommit: (action: InstallAction) => void;
}) {
  if (!validation) {
    return (
      <div className="flex min-h-80 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-background/50 p-6 text-center">
        <PackageIcon aria-hidden className="size-8 text-muted-foreground" />
        <div className="flex flex-col gap-1">
          <p className="font-medium">Preview появится здесь</p>
          <p className="max-w-[48ch] text-sm leading-6 text-muted-foreground">
            Установка недоступна, пока схема, ссылки, граф, хэши и policy-gates
            не пройдут проверку.
          </p>
        </div>
      </div>
    );
  }

  if (!validation.valid) {
    return (
      <div className="flex min-h-80 flex-col gap-4 rounded-lg border border-destructive/40 bg-background p-5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-semibold">Pack отклонён</h3>
          <Badge variant="error">{validation.report.errors} ошибок</Badge>
        </div>
        <DiagnosticList diagnostics={validation.report.diagnostics} />
      </div>
    );
  }

  const preview = validation.preview;
  return (
    <div className="flex min-h-80 flex-col gap-5 rounded-lg border border-border bg-background p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
            Проверенный Preview
          </p>
          <h3 className="text-xl font-semibold">{preview.courseTitle}</h3>
          <p className="max-w-[60ch] text-sm leading-6 text-muted-foreground">
            {preview.courseKey} · revision {preview.revisionNumber}
          </p>
        </div>
        <Badge variant="success">Готов к установке</Badge>
      </div>

      <dl className="grid grid-cols-2 gap-x-5 gap-y-3 text-sm sm:grid-cols-4">
        <PreviewMetric label="Уроки" value={String(preview.lessonCount)} />
        <PreviewMetric
          label="Активности"
          value={String(preview.activityCount)}
        />
        <PreviewMetric label="Язык" value={preview.primaryLocale} />
        <PreviewMetric
          label="Источники"
          value={`${preview.sourcePrivacyClasses.public} public / ${preview.sourcePrivacyClasses.private} private`}
        />
      </dl>

      <div className="flex flex-col gap-2">
        <p className="text-xs font-medium text-muted-foreground">
          Content hash
        </p>
        <code className="break-all rounded-md bg-muted px-3 py-2 font-mono text-xs">
          {preview.contentHash}
        </code>
      </div>

      <div className="grid gap-4 text-sm sm:grid-cols-2">
        <RequirementList
          label="Типы активностей"
          values={preview.requirements.activityTypes}
        />
        <RequirementList
          label="Trusted checks"
          values={preview.requirements.checkIds}
        />
        <RequirementList
          label="Environment contracts"
          values={preview.requirements.environmentIds}
        />
        <RequirementList
          label="Provenance"
          values={[
            preview.provenance.author,
            preview.provenance.ownership,
            preview.provenance.licenseSpdx ?? "No project license claim",
          ]}
        />
      </div>

      {validation.report.diagnostics.length > 0 ? (
        <DiagnosticList diagnostics={validation.report.diagnostics} />
      ) : null}

      <div className="mt-auto flex flex-wrap gap-2">
        <Button
          disabled={pending || !validation.storageAvailable}
          onClick={() => onCommit("install")}
        >
          {pending ? <Spinner data-icon="inline-start" /> : null}
          Установить и открыть
        </Button>
        <Button
          variant="outline"
          disabled={pending || !validation.storageAvailable}
          onClick={() => onCommit("open-as-draft")}
        >
          Открыть как черновик
        </Button>
      </div>
    </div>
  );
}

function PreviewMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

function RequirementList({
  label,
  values,
}: {
  label: string;
  values: readonly string[];
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {values.length > 0 ? (
          values.map((value) => (
            <Badge key={value} variant="outline">
              {value}
            </Badge>
          ))
        ) : (
          <span className="text-muted-foreground">Не требуются</span>
        )}
      </div>
    </div>
  );
}

function DiagnosticList({
  diagnostics,
}: {
  diagnostics: readonly z.infer<typeof diagnosticSchema>[];
}) {
  return (
    <ul className="flex max-h-64 flex-col gap-2 overflow-auto pr-1">
      {diagnostics.map((diagnostic, index) => (
        <li
          key={`${diagnostic.code}:${diagnostic.path}:${index}`}
          className="rounded-md bg-muted p-3 text-sm"
        >
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant={diagnostic.severity === "error" ? "error" : "warning"}
            >
              {diagnostic.code}
            </Badge>
            <code className="break-all font-mono text-xs text-muted-foreground">
              {diagnostic.path}
            </code>
          </div>
          <p className="mt-2 leading-5">{diagnostic.message}</p>
        </li>
      ))}
    </ul>
  );
}

function CourseLibraryRow({
  item,
  first,
  uninstalling,
  onExport,
  onUninstall,
}: {
  item: CoursePackLibraryItem;
  first: boolean;
  uninstalling: boolean;
  onExport: () => void;
  onUninstall: () => void;
}) {
  const openPath = `/courses/${encodeURIComponent(item.courseId)}/revisions/${encodeURIComponent(item.revisionId)}`;
  return (
    <article>
      {!first ? <Separator /> : null}
      <div className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">{item.title}</h3>
            <Badge
              variant={
                item.revisionStatus === "published"
                  ? "success"
                  : item.revisionStatus === "draft"
                    ? "warning"
                    : "secondary"
              }
            >
              {statusLabels[item.revisionStatus]}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {item.courseKey} · ревизия {item.revisionNumber}
          </p>
          <code className="mt-2 block truncate font-mono text-xs text-muted-foreground">
            {item.contentHash}
          </code>
        </div>
        <div className="flex flex-wrap gap-2">
          {item.revisionStatus === "published" ? (
            <Button asChild size="sm">
              <Link href={openPath}>
                <ArrowSquareOutIcon data-icon="inline-start" aria-hidden />
                Открыть
              </Link>
            </Button>
          ) : null}
          <Button size="sm" variant="outline" onClick={onExport}>
            <DownloadSimpleIcon data-icon="inline-start" aria-hidden />
            Экспорт
          </Button>
          {item.lifecycleAction !== "uninstall" ? (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="ghost">
                  <TrashIcon data-icon="inline-start" aria-hidden />
                  Удалить
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    Удалить Course Pack из библиотеки?
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    Ревизия {item.revisionId} станет архивной. Course Pack,
                    сессии и факты обучения не удаляются, чтобы replay и история
                    оставались проверяемыми.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Отмена</AlertDialogCancel>
                  <AlertDialogAction
                    variant="destructive"
                    disabled={uninstalling}
                    onClick={onUninstall}
                  >
                    {uninstalling ? <Spinner data-icon="inline-start" /> : null}
                    Удалить из библиотеки
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function CourseLibrarySkeleton() {
  return (
    <div
      className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5"
      role="status"
      aria-label="Загрузка библиотеки курсов"
    >
      <Skeleton className="h-5 w-56" />
      <Skeleton className="h-4 w-80 max-w-full" />
      <Skeleton className="h-9 w-full" />
    </div>
  );
}

async function exportPack(item: CoursePackLibraryItem): Promise<void> {
  const response = await fetch(
    `/api/course-packs/export?revisionId=${encodeURIComponent(item.revisionId)}`,
    { headers: { "X-DLH-Client": "web" } },
  );
  if (!response.ok) throw new Error(`Export failed (${response.status})`);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${item.revisionId.replaceAll(/[^A-Za-z0-9._-]/gu, "-")}.course-pack.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}
