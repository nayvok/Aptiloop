"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import {
  CoursePackStagedValidationReportSchema,
  CourseTransferCommitResultSchema,
  CourseTransferConflictSchema,
  CourseTransferPreviewSchema,
  COURSE_TRANSFER_FORMAT,
  COURSE_TRANSFER_JSON_LIMITS_V1,
  type CoursePackStagedValidationReportDto,
  type CourseTransferConflict,
  type CourseTransferPreview,
} from "@aptiloop/shared";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { api } from "@/lib/api";
import { type MessageKey, useI18n } from "@/lib/i18n";

const versionSchema = z
  .object({
    product: z.literal("Aptiloop"),
    appVersion: z.string(),
  })
  .strict();

export type DetectedFileFormat = "pack" | "transfer" | "unknown" | null;

export const TRANSFER_FORMAT = COURSE_TRANSFER_FORMAT;
export const SHARE_FORMAT = "aptiloop.course-pack";

export async function detectFileFormat(
  file: File,
): Promise<DetectedFileFormat> {
  try {
    const text = await file.text();
    const parsed = JSON.parse(text) as { format?: unknown };
    if (parsed.format === TRANSFER_FORMAT) return "transfer";
    if (parsed.format === SHARE_FORMAT) return "pack";
    return "unknown";
  } catch {
    return "unknown";
  }
}

const transferStagedValidSchema = z.object({
  valid: z.literal(true),
  validationId: z.string().uuid(),
  expiresAt: z.string(),
  storageAvailable: z.boolean().optional(),
  envelopeHash: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
  preview: CourseTransferPreviewSchema,
});
const transferStagedInvalidSchema = z.object({
  valid: z.literal(false),
  validationId: z.string().uuid().optional(),
  expiresAt: z.string().optional(),
  error: z.string().optional(),
  report: CoursePackStagedValidationReportSchema.optional(),
  diagnostics: z.array(z.unknown()).optional(),
});

export type TransferStagedValid = z.infer<typeof transferStagedValidSchema>;
export type TransferStagedInvalid = {
  valid: false;
  message: string;
  report?: CoursePackStagedValidationReportDto;
};

export function parseTransferStaged(
  body: unknown,
): TransferStagedValid | TransferStagedInvalid {
  const valid = transferStagedValidSchema.safeParse(body);
  if (valid.success) return valid.data;
  const invalid = transferStagedInvalidSchema.safeParse(body);
  if (invalid.success) {
    return {
      valid: false,
      message: "transfer-validation-failed",
    };
  }
  throw new Error(
    "Transfer validation response did not match the staged contract.",
  );
}

export async function downloadTransferEnvelope(options: {
  courseKeys: string[];
  scopeNote: string;
}): Promise<{ filename: string; bytes: number }> {
  const response = await fetch("/api/course-transfer/export", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Aptiloop-Client": "web",
    },
    body: JSON.stringify({
      operationId: globalThis.crypto.randomUUID(),
      courseKeys: options.courseKeys,
      includeHistory: true,
      scopeNote: options.scopeNote,
    }),
  });
  if (response.status === 404) {
    throw new Error("transfer-unavailable");
  }
  if (!response.ok) {
    const detail = (await response.json().catch(() => null)) as {
      error?: unknown;
    } | null;
    throw new Error(
      typeof detail?.error === "string"
        ? detail.error
        : `Transfer export failed with status ${response.status}.`,
    );
  }
  const blob = await response.blob();
  const disposition = response.headers.get("Content-Disposition") ?? "";
  const match = /filename="([^"]+)"/u.exec(disposition);
  const filename =
    match?.[1] ?? `aptiloop-transfer-${Date.now()}.course-transfer.json`;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
  return { filename, bytes: blob.size };
}

export async function validateTransferBytes(
  file: File,
): Promise<TransferStagedValid | TransferStagedInvalid> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength > COURSE_TRANSFER_JSON_LIMITS_V1.maxBytes) {
    return {
      valid: false,
      message: `Transfer file exceeds ${COURSE_TRANSFER_JSON_LIMITS_V1.maxBytes} bytes.`,
    };
  }
  const response = await fetch("/api/course-transfer/validate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Aptiloop-Client": "web",
    },
    body: bytes as BodyInit,
  });
  if (response.status === 404) {
    throw new Error("transfer-unavailable");
  }
  const body = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    const message =
      body !== null &&
      typeof body === "object" &&
      "error" in body &&
      typeof (body as { error: unknown }).error === "string"
        ? (body as { error: string }).error
        : `Transfer validation failed with status ${response.status}.`;
    return { valid: false, message };
  }
  return parseTransferStaged(body);
}

export async function commitTransferValidation(options: {
  validationId: string;
  expectedEnvelopeHash: string;
}): Promise<z.infer<typeof CourseTransferCommitResultSchema>> {
  const response = await fetch(
    `/api/course-transfer/validations/${encodeURIComponent(options.validationId)}/commit`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Aptiloop-Client": "web",
      },
      body: JSON.stringify({
        operationId: globalThis.crypto.randomUUID(),
        expectedEnvelopeHash: options.expectedEnvelopeHash,
      }),
    },
  );
  if (response.status === 404) {
    throw new Error("transfer-unavailable");
  }
  const body = (await response.json().catch(() => null)) as unknown;
  const parsed = CourseTransferCommitResultSchema.safeParse(body);
  if (!response.ok || !parsed.success) {
    const message =
      body !== null &&
      typeof body === "object" &&
      "error" in body &&
      typeof (body as { error: unknown }).error === "string"
        ? (body as { error: string }).error
        : `Transfer commit failed with status ${response.status}.`;
    throw new Error(message);
  }
  return parsed.data;
}

export interface TransferCourseOption {
  readonly courseKey: string;
  readonly title: string;
  readonly revisionNumber: number;
}

export function TransferPanel({
  courses,
  initialKey,
  onClose,
}: {
  courses: readonly TransferCourseOption[];
  initialKey: string | null;
  onClose: () => void;
}) {
  const { locale, t } = useI18n();
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set(initialKey === null ? [] : [initialKey]),
  );
  const [scopeNote, setScopeNote] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloaded, setDownloaded] = useState<string | null>(null);

  const selectedCourses = courses.filter((course) =>
    selected.has(course.courseKey),
  );
  const scopeValid =
    scopeNote.trim().length >= 1 && scopeNote.trim().length <= 500;

  const toggle = (courseKey: string) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(courseKey)) {
        next.delete(courseKey);
      } else if (next.size < COURSE_TRANSFER_JSON_LIMITS_V1.maxCourses) {
        next.add(courseKey);
      }
      return next;
    });
  };

  const download = async () => {
    if (selected.size === 0 || !scopeValid || pending) return;
    setPending(true);
    setError(null);
    setDownloaded(null);
    try {
      const result = await downloadTransferEnvelope({
        courseKeys: [...selected],
        scopeNote: scopeNote.trim(),
      });
      setDownloaded(`${result.filename} (${result.bytes} bytes)`);
    } catch (error: unknown) {
      setError(
        error instanceof Error && error.message === "transfer-unavailable"
          ? t("courses.transfer.unavailable")
          : error instanceof Error
            ? error.message
            : t("courses.transfer.validationFailed"),
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <section
      aria-labelledby="course-transfer-title"
      className="min-w-0 rounded-lg border border-border bg-background p-5 sm:p-6"
    >
      <div className="flex min-w-0 flex-col gap-2">
        <h2 id="course-transfer-title" className="text-lg font-semibold">
          {t("courses.transfer.title")}
        </h2>
        <p className="max-w-[70ch] text-sm leading-6 text-muted-foreground">
          {t("courses.transfer.description")}
        </p>
      </div>

      {courses.length === 0 ? (
        <Alert className="mt-4">
          <AlertTitle>{t("courses.library.empty.title")}</AlertTitle>
          <AlertDescription>
            {t("courses.library.empty.description")}
          </AlertDescription>
        </Alert>
      ) : (
        <fieldset className="mt-4 grid min-w-0 gap-2">
          <legend className="text-sm font-medium">
            {t("courses.transfer.selectCourses")}
          </legend>
          {courses.map((course) => (
            <label
              key={course.courseKey}
              className="flex min-w-0 cursor-pointer items-center gap-3 rounded-lg border border-border px-3 py-2"
            >
              <Checkbox
                checked={selected.has(course.courseKey)}
                onCheckedChange={() => toggle(course.courseKey)}
                aria-label={course.title}
              />
              <span className="min-w-0 flex-1 break-words text-sm">
                {course.title}
              </span>
              <span className="shrink-0 font-mono text-xs text-muted-foreground">
                {t("courses.library.revisionNumber", {
                  revision: course.revisionNumber.toLocaleString(locale),
                })}
              </span>
            </label>
          ))}
        </fieldset>
      )}

      <div className="mt-4 grid min-w-0 gap-4">
        <div className="grid min-w-0 gap-1.5">
          <Label htmlFor="course-transfer-scope">
            {t("courses.transfer.scopeNote")}
          </Label>
          <Input
            id="course-transfer-scope"
            value={scopeNote}
            maxLength={500}
            placeholder={t("courses.transfer.scopeNotePlaceholder")}
            onChange={(event) => setScopeNote(event.currentTarget.value)}
          />
        </div>
        <p className="text-sm text-muted-foreground" role="status">
          {t("courses.transfer.composition", {
            courses: selected.size.toLocaleString(locale),
            revisions: selectedCourses.length.toLocaleString(locale),
          })}
        </p>
      </div>

      {error ? (
        <Alert variant="destructive" className="mt-4">
          <AlertTitle>{error}</AlertTitle>
        </Alert>
      ) : null}
      {downloaded ? (
        <Alert className="mt-4">
          <AlertDescription>{downloaded}</AlertDescription>
        </Alert>
      ) : null}

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Button
          type="button"
          disabled={selected.size === 0 || !scopeValid || pending}
          onClick={() => void download()}
        >
          {pending ? <Spinner data-icon="inline-start" /> : null}
          {pending
            ? t("courses.transfer.downloading")
            : t("courses.transfer.download")}
        </Button>
        <Button type="button" variant="outline" onClick={onClose}>
          {t("courses.action.cancel")}
        </Button>
      </div>
    </section>
  );
}

export function TransferPreviewPanel({
  preview,
  onCommit,
  committing,
}: {
  preview: CourseTransferPreview;
  onCommit: () => void;
  committing: boolean;
}) {
  const { locale, t } = useI18n();
  const versionInfo = useQuery({
    queryKey: ["system", "version"],
    queryFn: () =>
      api<unknown>("/version").then((body) => versionSchema.parse(body)),
    staleTime: 60_000,
  });
  return (
    <div className="grid min-w-0 gap-6">
      <div>
        <h2 className="text-lg font-semibold">
          {t("courses.transfer.preview.courses")}
        </h2>
        <div
          className={`mt-3 flex min-w-0 flex-col gap-2 rounded-lg border p-3 text-sm ${
            preview.mode === "learnerScope" ? "border-warning" : "border-border"
          }`}
        >
          <p>
            {preview.mode === "learnerScope"
              ? t("courses.transfer.preview.mode.learnerScope")
              : t("courses.transfer.preview.mode.full")}
          </p>
          <p className="text-muted-foreground">
            {t("courses.transfer.preview.originatingVersion", {
              version: preview.originatingAppVersion,
            })}
          </p>
          {preview.appVersionMatches === false ? (
            <p role="note" className="text-sm text-warning">
              {t("courses.transfer.preview.appVersionMismatch", {
                source: preview.originatingAppVersion,
                current:
                  versionInfo.data?.appVersion ?? preview.originatingAppVersion,
              })}
            </p>
          ) : null}
        </div>
        <ul className="mt-3 grid min-w-0 gap-2">
          {preview.courses.map((course) => (
            <li
              key={`${course.courseKey}@${course.revisionKey}`}
              className="min-w-0 rounded-lg border border-border px-3 py-2"
            >
              <p className="break-words text-sm font-medium">
                {course.courseTitle}
              </p>
              <p className="mt-0.5 break-words font-mono text-xs text-muted-foreground">
                {course.courseKey} ·{" "}
                {t("courses.library.revisionNumber", {
                  revision: course.revisionNumber.toLocaleString(locale),
                })}{" "}
                · {course.contentHash}
              </p>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
          <span>
            {t("courses.transfer.preview.facts", {
              count: preview.factCount.toLocaleString(locale),
            })}
          </span>
          <span>
            {t("courses.transfer.preview.sessions", {
              count: preview.sessionCount.toLocaleString(locale),
            })}
          </span>
          {preview.skippedSessionCount > 0 ? (
            <span>
              {t("courses.transfer.preview.skippedSessions", {
                count: preview.skippedSessionCount.toLocaleString(locale),
              })}
            </span>
          ) : null}
        </div>
      </div>

      <div>
        <h3 className="text-sm font-medium">
          {t("courses.transfer.preview.excluded")}
        </h3>
        <ul className="mt-2 flex min-w-0 flex-wrap gap-1.5">
          {preview.excluded.map((item) => (
            <li
              key={item}
              className="rounded-full border border-border px-2.5 py-1 font-mono text-xs text-muted-foreground"
            >
              {item}
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h3 className="text-sm font-medium">
          {t("courses.transfer.preview.conflicts")}
        </h3>
        {preview.conflicts.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            {t("courses.transfer.preview.noConflicts")}
          </p>
        ) : (
          <ul className="mt-2 grid min-w-0 gap-2">
            {preview.conflicts.map((conflict, index) => (
              <ConflictRow
                key={`${conflict.code}-${conflict.courseKey ?? index}`}
                conflict={conflict}
              />
            ))}
          </ul>
        )}
      </div>

      <div>
        <Button type="button" disabled={committing} onClick={onCommit}>
          {committing ? <Spinner data-icon="inline-start" /> : null}
          {t("courses.action.installAndOpen")}
        </Button>
      </div>
    </div>
  );
}

function ConflictRow({ conflict }: { conflict: CourseTransferConflict }) {
  const { t } = useI18n();
  const parsed = CourseTransferConflictSchema.parse(conflict);
  const messageKey =
    parsed.code === "already-installed"
      ? ("courses.transfer.preview.alreadyInstalled" as const)
      : parsed.code === "new-revision-available"
        ? ("courses.transfer.preview.newRevision" as const)
        : ("courses.transfer.preview.unknownCourse" as const);
  return (
    <li className="min-w-0 rounded-lg border border-border px-3 py-2">
      <p className="break-words font-mono text-xs text-muted-foreground">
        {parsed.code}
        {parsed.courseKey ? ` · ${parsed.courseKey}` : ""}
      </p>
      <p className="mt-1 break-words text-sm">{t(messageKey)}</p>
      <p className="mt-1 break-words text-sm text-muted-foreground">
        {parsed.reason}
      </p>
      {parsed.code === "new-revision-available" && parsed.courseKey ? (
        <Button asChild variant="outline" size="sm" className="mt-2">
          <Link href={`/courses?q=${encodeURIComponent(parsed.courseKey)}`}>
            {t("courses.transfer.preview.openUpgrade")}
          </Link>
        </Button>
      ) : null}
    </li>
  );
}

export type { CourseTransferPreview };
export type TransferMessageKey = MessageKey;
