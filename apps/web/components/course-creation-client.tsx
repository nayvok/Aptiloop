"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CourseLocaleSchema, type CourseLocale } from "@aptiloop/shared";
import {
  ArrowClockwiseIcon,
  ArrowRightIcon,
  DownloadSimpleIcon,
  PlusIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { z } from "zod";

import {
  AuthoringBriefSchema,
  AuthoringBriefDraftSchema,
  authoringBriefDescription,
  type AuthoringBrief,
  type AuthoringBriefDraft,
  emptyAuthoringBriefDraft,
} from "@/app/courses/new/authoring-brief";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export const AUTHORING_BRIEF_STORAGE_KEY = "aptiloop.course-authoring-brief.v1";

type CreationMode = "external" | "guided" | "manual";

const modelCapabilitySchema = z.object({
  modelId: z.string().trim().min(1).max(300),
  available: z.boolean(),
  contextTokens: z.number().int().positive().nullable(),
  outputTokens: z.number().int().positive().nullable(),
  typedToolCalls: z.enum(["none", "best-effort", "schema-constrained"]),
});

const connectionSchema = z.object({
  connectionId: z.string().trim().min(1).max(200),
  displayName: z.string().trim().min(1).max(200),
  state: z.string().trim().min(1).max(100),
  observedCapabilities: z
    .object({
      observedAt: z.iso.datetime(),
      models: z.array(modelCapabilitySchema).max(500),
      connection: z.object({
        authenticated: z.boolean(),
        streaming: z.boolean(),
        cancellation: z.boolean(),
      }),
    })
    .nullable(),
});

const roleProfileSchema = z.object({
  role: z.enum(["course-designer", "tutor", "evaluator", "reviewer"]),
  mode: z.enum(["no-ai", "connection"]),
  connectionId: z.string().trim().min(1).max(200).nullable(),
  modelId: z.string().trim().min(1).max(300).nullable(),
  requiredCapabilities: z.array(z.string().trim().min(1).max(100)).max(20),
});

const courseDesignerSettingsSchema = z.object({
  ai: z.object({
    connections: z.array(connectionSchema).max(100),
    roleProfiles: z.array(roleProfileSchema).max(20),
  }),
});

type ModelCapability = z.infer<typeof modelCapabilitySchema>;
type Connection = z.infer<typeof connectionSchema>;
type Settings = z.infer<typeof courseDesignerSettingsSchema>;

type ReadinessKind =
  "checking" | "ready" | "off" | "unavailable" | "unknown" | "unsupported";

type DesignerReadiness = {
  kind: ReadinessKind;
  eligible: boolean;
  connection: Connection | null;
  model: ModelCapability | null;
  modelId: string | null;
  requiredCapabilities: string[];
  missingCapability?: string;
};

function getDesignerReadiness(
  settings: Settings | undefined,
  status: "pending" | "error" | "success",
): DesignerReadiness {
  if (status === "pending") {
    return {
      kind: "checking",
      eligible: false,
      connection: null,
      model: null,
      modelId: null,
      requiredCapabilities: [],
    };
  }
  if (status === "error" || !settings) {
    return {
      kind: "unavailable",
      eligible: false,
      connection: null,
      model: null,
      modelId: null,
      requiredCapabilities: [],
    };
  }
  const profile = settings.ai.roleProfiles.find(
    (candidate) => candidate.role === "course-designer",
  );
  if (!profile || profile.mode === "no-ai") {
    return {
      kind: "off",
      eligible: false,
      connection: null,
      model: null,
      modelId: null,
      requiredCapabilities: [],
    };
  }
  const connection = settings.ai.connections.find(
    (candidate) => candidate.connectionId === profile.connectionId,
  );
  if (
    !connection ||
    (connection.state !== "connected" && connection.state !== "degraded")
  ) {
    return {
      kind: "unavailable",
      eligible: false,
      connection: connection ?? null,
      model: null,
      modelId: profile.modelId,
      requiredCapabilities: profile.requiredCapabilities,
    };
  }
  const observed = connection.observedCapabilities;
  if (!observed) {
    return {
      kind: "unknown",
      eligible: true,
      connection,
      model: null,
      modelId: profile.modelId,
      requiredCapabilities: profile.requiredCapabilities,
    };
  }
  const model = observed.models.find(
    (candidate) => candidate.modelId === profile.modelId,
  );
  if (!model) {
    return {
      kind: "unavailable",
      eligible: false,
      connection,
      model: null,
      modelId: profile.modelId,
      requiredCapabilities: profile.requiredCapabilities,
    };
  }
  if (!model.available) {
    return {
      kind: "unavailable",
      eligible: false,
      connection,
      model,
      modelId: profile.modelId,
      requiredCapabilities: profile.requiredCapabilities,
    };
  }
  const missingCapability = profile.requiredCapabilities.find((capability) => {
    if (capability === "models") return false;
    if (capability === "streaming") return !observed.connection.streaming;
    if (capability === "cancellation") return !observed.connection.cancellation;
    if (capability === "tools") return model.typedToolCalls === "none";
    if (capability === "structured-output")
      return model.typedToolCalls === "none";
    return true;
  });
  if (missingCapability) {
    return {
      kind: "unsupported",
      eligible: false,
      connection,
      model,
      modelId: profile.modelId,
      requiredCapabilities: profile.requiredCapabilities,
      missingCapability,
    };
  }
  return {
    kind: "ready",
    eligible: true,
    connection,
    model,
    modelId: profile.modelId,
    requiredCapabilities: profile.requiredCapabilities,
  };
}

function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 80);
}

function usePersistentBrief() {
  const [brief, setBrief] = useState<AuthoringBriefDraft>(
    emptyAuthoringBriefDraft,
  );
  const [storageError, setStorageError] = useState(false);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(AUTHORING_BRIEF_STORAGE_KEY);
      if (!saved) return;
      const parsed = AuthoringBriefDraftSchema.safeParse(JSON.parse(saved));
      if (parsed.success) setBrief(parsed.data);
    } catch {
      setStorageError(true);
    }
  }, []);

  function update<Key extends keyof AuthoringBriefDraft>(
    key: Key,
    value: AuthoringBriefDraft[Key],
  ) {
    setBrief((current) => {
      const next = { ...current, [key]: value };
      try {
        window.localStorage.setItem(
          AUTHORING_BRIEF_STORAGE_KEY,
          JSON.stringify(next),
        );
        setStorageError(false);
      } catch {
        setStorageError(true);
      }
      return next;
    });
  }

  function clear() {
    setBrief(emptyAuthoringBriefDraft());
    try {
      window.localStorage.removeItem(AUTHORING_BRIEF_STORAGE_KEY);
      setStorageError(false);
    } catch {
      setStorageError(true);
    }
  }

  return { brief, clear, storageError, update };
}

function BriefFields({
  brief,
  primaryLocaleError,
  onPrimaryLocaleInvalid,
  onChange,
}: {
  brief: AuthoringBriefDraft;
  primaryLocaleError: string | null;
  onPrimaryLocaleInvalid: () => void;
  onChange: <Key extends keyof AuthoringBriefDraft>(
    key: Key,
    value: AuthoringBriefDraft[Key],
  ) => void;
}) {
  const { t } = useI18n();
  return (
    <FieldGroup className="grid gap-5 md:grid-cols-2">
      <Field className="md:col-span-2">
        <FieldLabel htmlFor="authoring-topic-goal">
          {t("authoring.brief.topicGoal")}
        </FieldLabel>
        <Input
          id="authoring-topic-goal"
          value={brief.topicGoal}
          required
          maxLength={500}
          autoComplete="off"
          placeholder={t("authoring.brief.topicGoalPlaceholder")}
          onChange={(event) => onChange("topicGoal", event.target.value)}
        />
      </Field>
      <Field className="md:col-span-2">
        <FieldLabel htmlFor="authoring-target-outcome">
          {t("authoring.brief.targetOutcome")}
        </FieldLabel>
        <Textarea
          id="authoring-target-outcome"
          value={brief.targetOutcome}
          required
          maxLength={1_500}
          className="min-h-24"
          placeholder={t("authoring.brief.targetOutcomePlaceholder")}
          onChange={(event) => onChange("targetOutcome", event.target.value)}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="authoring-current-level">
          {t("authoring.brief.currentLevel")}
        </FieldLabel>
        <Input
          id="authoring-current-level"
          value={brief.currentLevel}
          required
          maxLength={300}
          autoComplete="off"
          placeholder={t("authoring.brief.currentLevelPlaceholder")}
          onChange={(event) => onChange("currentLevel", event.target.value)}
        />
      </Field>
      <Field data-invalid={primaryLocaleError ? true : undefined}>
        <FieldLabel htmlFor="authoring-primary-locale">
          {t("authoring.brief.primaryLocale")}
        </FieldLabel>
        <Input
          id="authoring-primary-locale"
          name="primaryLocale"
          value={brief.primaryLocale}
          required
          minLength={2}
          maxLength={35}
          autoComplete="off"
          placeholder="en-US"
          aria-invalid={primaryLocaleError ? true : undefined}
          aria-describedby={
            primaryLocaleError
              ? "authoring-primary-locale-description authoring-primary-locale-error"
              : "authoring-primary-locale-description"
          }
          onInvalid={(event) => {
            event.preventDefault();
            onPrimaryLocaleInvalid();
            event.currentTarget.focus();
          }}
          onChange={(event) => onChange("primaryLocale", event.target.value)}
        />
        <FieldDescription id="authoring-primary-locale-description">
          {t("authoring.brief.primaryLocaleDescription")}
        </FieldDescription>
        <FieldError id="authoring-primary-locale-error">
          {primaryLocaleError}
        </FieldError>
      </Field>
      <Field className="md:col-span-2">
        <FieldLabel htmlFor="authoring-pacing">
          {t("authoring.brief.pacing")}
        </FieldLabel>
        <Input
          id="authoring-pacing"
          value={brief.pacing}
          required
          maxLength={500}
          autoComplete="off"
          placeholder={t("authoring.brief.pacingPlaceholder")}
          onChange={(event) => onChange("pacing", event.target.value)}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="authoring-tools">
          {t("authoring.brief.tools")}
        </FieldLabel>
        <Textarea
          id="authoring-tools"
          value={brief.tools}
          maxLength={1_000}
          className="min-h-24"
          placeholder={t("authoring.brief.optionalPlaceholder")}
          onChange={(event) => onChange("tools", event.target.value)}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="authoring-accessibility">
          {t("authoring.brief.accessibility")}
        </FieldLabel>
        <Textarea
          id="authoring-accessibility"
          value={brief.accessibility}
          maxLength={1_000}
          className="min-h-24"
          placeholder={t("authoring.brief.optionalPlaceholder")}
          onChange={(event) => onChange("accessibility", event.target.value)}
        />
      </Field>
      <Field className="md:col-span-2">
        <FieldLabel htmlFor="authoring-constraints">
          {t("authoring.brief.constraints")}
        </FieldLabel>
        <Textarea
          id="authoring-constraints"
          value={brief.constraints}
          maxLength={2_500}
          className="min-h-24"
          placeholder={t("authoring.brief.optionalPlaceholder")}
          onChange={(event) => onChange("constraints", event.target.value)}
        />
      </Field>
    </FieldGroup>
  );
}

function ReadinessPanel({
  readiness,
  refreshing,
  onRefresh,
}: {
  readiness: DesignerReadiness;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const { t } = useI18n();
  const observed = readiness.connection?.observedCapabilities;
  return (
    <section
      aria-labelledby="designer-readiness-title"
      className="min-w-0 rounded-lg border border-border bg-muted/20 p-4"
    >
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="designer-readiness-title" className="text-sm font-semibold">
              {t("authoring.connected.readinessTitle")}
            </h2>
            <Badge
              variant={readiness.kind === "ready" ? "secondary" : "outline"}
              className={cn(
                "max-w-full",
                readiness.kind === "ready" &&
                  "border-success/35 text-success-foreground",
              )}
            >
              {t(`authoring.connected.state.${readiness.kind}`)}
            </Badge>
          </div>
          <p className="mt-2 min-w-0 text-sm leading-6 text-muted-foreground [overflow-wrap:anywhere]">
            {readiness.connection?.displayName ?? t("provider.unavailable")}
            {readiness.modelId ? ` · ${readiness.modelId}` : ""}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={refreshing}
          onClick={onRefresh}
        >
          {refreshing ? <Spinner /> : <ArrowClockwiseIcon aria-hidden />}
          {t("authoring.connected.refresh")}
        </Button>
      </div>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">
        {t(`authoring.connected.stateDescription.${readiness.kind}`, {
          capability:
            readiness.missingCapability ??
            t("authoring.connected.evidence.notAvailable"),
        })}
      </p>
      {observed && readiness.model ? (
        <dl className="mt-4 grid gap-3 border-t border-border pt-4 text-xs sm:grid-cols-3">
          <div>
            <dt className="text-muted-foreground">
              {t("authoring.connected.evidence.model")}
            </dt>
            <dd className="mt-1 font-medium">
              {readiness.model.available
                ? t("authoring.connected.evidence.observed")
                : t("authoring.connected.evidence.notAvailable")}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">
              {t("authoring.connected.evidence.tools")}
            </dt>
            <dd className="mt-1 font-medium">
              {readiness.model.typedToolCalls}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">
              {t("authoring.connected.evidence.transport")}
            </dt>
            <dd className="mt-1 font-medium">
              {observed.connection.streaming && observed.connection.cancellation
                ? t("authoring.connected.evidence.observed")
                : t("authoring.connected.evidence.notAvailable")}
            </dd>
          </div>
        </dl>
      ) : null}
      <p className="mt-4 border-t border-border pt-4 text-xs leading-5 text-muted-foreground">
        {t("authoring.connected.qualityNote")}
      </p>
    </section>
  );
}

export function CourseCreationClient({ mode }: { mode: CreationMode }) {
  const { t } = useI18n();
  const router = useRouter();
  const { brief, clear, storageError, update } = usePersistentBrief();
  const [busy, setBusy] = useState(false);
  const [primaryLocaleError, setPrimaryLocaleError] = useState<string | null>(
    null,
  );
  const [manualPrimaryLocaleError, setManualPrimaryLocaleError] = useState<
    string | null
  >(null);
  const identityRef = useRef<{
    signature: string;
    operationId: string;
    courseId: string;
    slug: string;
  } | null>(null);
  const settings = useQuery({
    queryKey: ["settings", "course-designer-readiness"],
    queryFn: async () =>
      courseDesignerSettingsSchema.parse(await api<unknown>("/settings")),
    enabled: mode === "guided",
  });
  const readiness = getDesignerReadiness(
    settings.data,
    settings.isPending ? "pending" : settings.isError ? "error" : "success",
  );

  function identity(
    title: string,
    description: string,
    primaryLocale: CourseLocale,
  ) {
    const signature = JSON.stringify({ title, description, primaryLocale });
    if (identityRef.current?.signature === signature)
      return identityRef.current;
    const operationId = crypto.randomUUID();
    const suffix = operationId.replace(/[^a-z0-9]/giu, "").slice(-12);
    const base = slugify(title) || "course";
    identityRef.current = {
      signature,
      operationId,
      courseId: `course-${base}-${suffix}`,
      slug: `${base}-${suffix}`,
    };
    return identityRef.current;
  }

  async function createDraft(
    title: string,
    description: string,
    primaryLocale: CourseLocale,
    targetMode: "manual" | "designer",
  ) {
    setBusy(true);
    try {
      const draftIdentity = identity(title, description, primaryLocale);
      const result = await api<{ version: { id: string } }>(
        "/curriculum-editor/versions",
        {
          method: "POST",
          body: JSON.stringify({
            operationId: draftIdentity.operationId,
            curriculum: {
              id: draftIdentity.courseId,
              slug: draftIdentity.slug,
              title,
              description: description || null,
              primaryLocale,
            },
            title,
            description: description || null,
          }),
        },
      );
      const search = new URLSearchParams({
        version: result.version.id,
        mode: targetMode,
        tab: targetMode === "designer" ? "designer" : "program",
      });
      router.push(`/courses/studio?${search.toString()}`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("authoring.creation.error"),
      );
    } finally {
      setBusy(false);
    }
  }

  async function downloadInstructions(validatedBrief: AuthoringBrief) {
    setBusy(true);
    try {
      const response = await fetch("/courses/new/external/instructions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validatedBrief),
      });
      if (!response.ok) throw new Error(t("authoring.external.downloadError"));
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "aptiloop-course-pack-v1-authoring-skill.md";
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      toast.success(t("authoring.external.downloaded"));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("authoring.external.downloadError"),
      );
    } finally {
      setBusy(false);
    }
  }

  if (mode === "manual") {
    return (
      <form
        className="w-full max-w-[52rem] rounded-lg border border-border bg-card p-5 sm:p-6"
        aria-label={t("authoring.manual.form")}
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const primaryLocale = CourseLocaleSchema.safeParse(
            String(form.get("primaryLocale") ?? "").trim(),
          );
          if (!primaryLocale.success) {
            setManualPrimaryLocaleError(
              t("authoring.brief.primaryLocaleError"),
            );
            document.getElementById("manual-course-primary-locale")?.focus();
            return;
          }
          setManualPrimaryLocaleError(null);
          void createDraft(
            String(form.get("title") ?? "").trim(),
            String(form.get("description") ?? "").trim(),
            primaryLocale.data,
            "manual",
          );
        }}
      >
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="manual-course-title">
              {t("authoring.field.curriculumTitle")}
            </FieldLabel>
            <Input
              id="manual-course-title"
              name="title"
              required
              maxLength={500}
              autoComplete="off"
            />
          </Field>
          <Field data-invalid={manualPrimaryLocaleError ? true : undefined}>
            <FieldLabel htmlFor="manual-course-primary-locale">
              {t("authoring.brief.primaryLocale")}
            </FieldLabel>
            <Input
              id="manual-course-primary-locale"
              name="primaryLocale"
              required
              minLength={2}
              maxLength={35}
              autoComplete="off"
              placeholder="en-US"
              aria-invalid={manualPrimaryLocaleError ? true : undefined}
              aria-describedby={
                manualPrimaryLocaleError
                  ? "manual-course-primary-locale-description manual-course-primary-locale-error"
                  : "manual-course-primary-locale-description"
              }
              onInvalid={(event) => {
                event.preventDefault();
                setManualPrimaryLocaleError(
                  t("authoring.brief.primaryLocaleError"),
                );
                event.currentTarget.focus();
              }}
              onChange={() => setManualPrimaryLocaleError(null)}
            />
            <FieldDescription id="manual-course-primary-locale-description">
              {t("authoring.brief.primaryLocaleDescription")}
            </FieldDescription>
            <FieldError id="manual-course-primary-locale-error">
              {manualPrimaryLocaleError}
            </FieldError>
          </Field>
          <Field>
            <FieldLabel htmlFor="manual-course-description">
              {t("authoring.field.curriculumDescription")}
            </FieldLabel>
            <Textarea
              id="manual-course-description"
              name="description"
              maxLength={10_000}
              className="min-h-28"
            />
          </Field>
        </FieldGroup>
        <div className="mt-6 flex justify-end border-t border-border pt-5">
          <Button type="submit" disabled={busy} className="w-full sm:w-auto">
            {busy ? <Spinner /> : <PlusIcon aria-hidden />}
            {busy
              ? t("authoring.createDraft.creating")
              : t("authoring.createDraft.submit")}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <form
      className="w-full max-w-[76rem] min-w-0"
      aria-label={
        mode === "external"
          ? t("authoring.external.form")
          : t("authoring.connected.form")
      }
      onSubmit={(event) => {
        event.preventDefault();
        const parsed = AuthoringBriefSchema.safeParse(brief);
        if (!parsed.success) {
          if (
            parsed.error.issues.some(
              (issue) => issue.path[0] === "primaryLocale",
            )
          ) {
            setPrimaryLocaleError(t("authoring.brief.primaryLocaleError"));
            document.getElementById("authoring-primary-locale")?.focus();
          } else {
            toast.error(t("authoring.brief.validationError"));
          }
          return;
        }
        setPrimaryLocaleError(null);
        if (mode === "external") {
          void downloadInstructions(parsed.data);
        } else if (readiness.eligible) {
          void createDraft(
            parsed.data.topicGoal,
            authoringBriefDescription(parsed.data),
            parsed.data.primaryLocale,
            "designer",
          );
        }
      }}
    >
      <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <section className="min-w-0 rounded-lg border border-border bg-card p-5 sm:p-6">
          <div className="mb-6 flex min-w-0 flex-col gap-3 border-b border-border pb-5 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h2 className="font-semibold">{t("authoring.brief.title")}</h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                {t("authoring.brief.description")}
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setPrimaryLocaleError(null);
                clear();
              }}
            >
              <TrashIcon aria-hidden />
              {t("authoring.brief.clear")}
            </Button>
          </div>
          <BriefFields
            brief={brief}
            primaryLocaleError={primaryLocaleError}
            onPrimaryLocaleInvalid={() =>
              setPrimaryLocaleError(t("authoring.brief.primaryLocaleError"))
            }
            onChange={(key, value) => {
              if (key === "primaryLocale") setPrimaryLocaleError(null);
              update(key, value);
            }}
          />
          {storageError ? (
            <Alert variant="destructive" className="mt-5">
              <AlertTitle>{t("authoring.brief.storageErrorTitle")}</AlertTitle>
              <AlertDescription>
                {t("authoring.brief.storageErrorDescription")}
              </AlertDescription>
            </Alert>
          ) : (
            <FieldDescription className="mt-5">
              {t("authoring.brief.savedLocally")}
            </FieldDescription>
          )}
        </section>

        <aside className="min-w-0 xl:sticky xl:top-24 xl:self-start">
          {mode === "guided" ? (
            <ReadinessPanel
              readiness={readiness}
              refreshing={settings.isFetching}
              onRefresh={() => void settings.refetch()}
            />
          ) : (
            <Alert>
              <AlertTitle>{t("authoring.external.privacyTitle")}</AlertTitle>
              <AlertDescription>
                {t("authoring.external.privacyDescription")}
              </AlertDescription>
            </Alert>
          )}

          <div className="mt-4 grid gap-3 rounded-lg border border-border bg-card p-4">
            <Button
              type="submit"
              disabled={busy || (mode === "guided" && !readiness.eligible)}
              className="h-auto min-w-0 w-full whitespace-normal [overflow-wrap:anywhere]"
            >
              {busy ? (
                <Spinner />
              ) : mode === "external" ? (
                <DownloadSimpleIcon aria-hidden />
              ) : (
                <PlusIcon aria-hidden />
              )}
              {mode === "external"
                ? t("authoring.external.download")
                : t("authoring.connected.create")}
            </Button>
            {mode === "external" ? (
              <Button
                asChild
                type="button"
                variant="outline"
                className="h-auto min-w-0 w-full whitespace-normal [overflow-wrap:anywhere]"
              >
                <Link href="/courses/import">
                  {t("authoring.external.uploadResult")}
                  <ArrowRightIcon aria-hidden />
                </Link>
              </Button>
            ) : (
              <Button
                asChild
                type="button"
                variant="outline"
                className="h-auto min-w-0 w-full whitespace-normal [overflow-wrap:anywhere]"
              >
                <Link href="/settings?section=ai">
                  {t("authoring.connected.openSettings")}
                  <ArrowRightIcon aria-hidden />
                </Link>
              </Button>
            )}
            <p className="text-xs leading-5 text-muted-foreground">
              {mode === "external"
                ? t("authoring.external.nextStep")
                : t("authoring.connected.nextStep")}
            </p>
          </div>

          {mode === "guided" && !readiness.eligible ? (
            <div className="mt-4 grid gap-2 border-t border-border pt-4 text-sm">
              <p className="font-medium">
                {t("authoring.connected.alternatives")}
              </p>
              <Link
                href="/courses/new/external"
                className="text-primary underline-offset-4 hover:underline"
              >
                {t("authoring.external.title")}
              </Link>
              <Link
                href="/courses/new/manual"
                className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                {t("authoring.manual.fallback")}
              </Link>
            </div>
          ) : null}
        </aside>
      </div>
    </form>
  );
}
