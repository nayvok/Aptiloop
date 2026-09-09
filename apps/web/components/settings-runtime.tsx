"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { api } from "@/lib/api";
import { type MessageKey, useI18n } from "@/lib/i18n";

type Translate = (
  key: MessageKey,
  values?: Record<string, string | number>,
) => string;
const runtimeSchema = z
  .object({
    webOrigin: z.string(),
    webPort: z.number().int().positive().optional(),
    orchestratorPort: z.number().int().positive(),
    dataDir: z.string().nullable(),
    deploymentProfile: z.string(),
    channel: z.string(),
    autostartSupported: z.boolean(),
    shortcutsSupported: z.boolean(),
  })
  .strict();

const autostartSchema = z
  .object({
    installed: z.boolean(),
    enabled: z.boolean(),
    detail: z.string(),
    message: z.string().optional(),
  })
  .strict();

const versionSchema = z
  .object({
    product: z.literal("Aptiloop"),
    appVersion: z.string(),
    validatorVersion: z.string(),
    migrationHead: z.string(),
    channel: z.string(),
    deploymentProfile: z.string(),
    webOrigin: z.string(),
  })
  .strict();

const releaseSchema = z
  .object({
    version: z.string(),
    tag: z.string(),
    name: z.string(),
    notes: z.string(),
    publishedAt: z.string(),
    assets: z.array(
      z
        .object({
          name: z.string(),
          size: z.number().int().nonnegative(),
          downloadUrl: z.string(),
          digest: z.string().optional(),
        })
        .strict(),
    ),
  })
  .strict();

const updateCheckSchema = z
  .object({
    current: z.string(),
    release: releaseSchema.nullable(),
    newer: z.boolean(),
  })
  .strict();

const shortcutsSchema = z
  .object({
    message: z.string(),
  })
  .strict();
const operationSchema = z
  .object({
    operationId: z.string().uuid(),
    tag: z.string(),
    state: z.enum(["queued", "running", "succeeded", "failed"]),
    phase: z
      .enum([
        "backup",
        "candidate",
        "migration",
        "health",
        "pointer",
        "restart",
        "rollback",
      ])
      .optional(),
    startedAt: z.string(),
    finishedAt: z.string().optional(),
    message: z.string().optional(),
    evidencePath: z.string().optional(),
  })
  .strict()
  .superRefine((operation, context) => {
    if (
      operation.state === "queued" &&
      (operation.phase !== undefined || operation.finishedAt !== undefined)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Queued update operation has an invalid phase or finish time.",
      });
    }
    if (
      operation.state === "running" &&
      (operation.phase === undefined || operation.finishedAt !== undefined)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Running update operation has an invalid phase or finish time.",
      });
    }
    if (
      operation.state === "succeeded" &&
      (operation.phase !== "restart" || operation.finishedAt === undefined)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Succeeded update operation is not a terminal restart state.",
      });
    }
    if (
      operation.state === "failed" &&
      (operation.phase !== "rollback" || operation.finishedAt === undefined)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Failed update operation is not a terminal rollback state.",
      });
    }
  });

type RuntimeInfo = z.infer<typeof runtimeSchema>;
type AutostartInfo = z.infer<typeof autostartSchema>;
type VersionInfo = z.infer<typeof versionSchema>;
type UpdateOperation = z.infer<typeof operationSchema>;

type UpdatePhase = z.infer<typeof operationSchema>["phase"];
type UpdateAsset = z.infer<typeof releaseSchema>["assets"][number];
type UpdateState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "up-to-date"; version: string }
  | {
      status: "available";
      current: string;
      version: string;
      tag: string;
      notes: string;
      publishedAt: string;
      assets: UpdateAsset[];
    }
  | { status: "applying"; version: string; tag: string; phase?: UpdatePhase }
  | { status: "succeeded"; version: string }
  | { status: "failed"; message: string }
  | { status: "not-checked" };

function RuntimeFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid min-w-0 gap-1 px-5 py-4 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)] sm:items-baseline sm:gap-6 sm:px-6">
      <dt className="text-sm font-medium">{label}</dt>
      <dd className="min-w-0 font-mono text-xs leading-5 text-muted-foreground [overflow-wrap:anywhere] sm:text-right">
        {value}
      </dd>
    </div>
  );
}

export function SettingsRuntimePanel() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [update, setUpdate] = useState<UpdateState>({ status: "idle" });

  const runtime = useQuery({
    queryKey: ["system", "runtime"],
    queryFn: () =>
      api<unknown>("/system/runtime").then((body) => runtimeSchema.parse(body)),
  });
  const version = useQuery({
    queryKey: ["system", "version"],
    queryFn: () =>
      api<unknown>("/version").then((body) => versionSchema.parse(body)),
  });
  const autostart = useQuery({
    queryKey: ["system", "autostart"],
    queryFn: () =>
      api<unknown>("/system/autostart").then((body) =>
        autostartSchema.parse(body),
      ),
  });

  const autostartMutation = useMutation({
    mutationFn: (enabled: boolean) =>
      api<unknown>("/system/autostart", {
        method: "POST",
        body: JSON.stringify({
          operationId: globalThis.crypto.randomUUID(),
          autostart: enabled,
        }),
      }).then((body) => autostartSchema.parse(body)),
    onSuccess: (result) => {
      queryClient.setQueryData(["system", "autostart"], result);
    },
  });

  const shortcutsMutation = useMutation({
    mutationFn: (action: "install" | "remove") =>
      api<unknown>("/system/shortcuts", {
        method: "POST",
        body: JSON.stringify({
          operationId: globalThis.crypto.randomUUID(),
          action,
        }),
      }).then((body) => shortcutsSchema.parse(body)),
  });

  const checkUpdates = async () => {
    setUpdate({ status: "checking" });
    try {
      const result = updateCheckSchema.parse(
        await api<unknown>("/system/update/check"),
      );
      if (!result.release || !result.newer) {
        setUpdate({ status: "up-to-date", version: result.current });
        return;
      }
      setUpdate({
        status: "available",
        current: result.current,
        version: result.release.version,
        tag: result.release.tag,
        notes: result.release.notes,
        publishedAt: result.release.publishedAt,
        assets: result.release.assets,
      });
    } catch {
      setUpdate({ status: "not-checked" });
    }
  };

  const applyUpdate = async () => {
    if (update.status !== "available") return;
    const { tag, version } = update;
    const operationId = globalThis.crypto.randomUUID();
    let safeFailure: string | null = null;
    setUpdate({ status: "applying", version, tag, phase: undefined });
    try {
      await api<unknown>("/system/update/apply", {
        method: "POST",
        body: JSON.stringify({ operationId, tag }),
      });
      const deadline = Date.now() + 10 * 60 * 1_000;
      for (;;) {
        let operation: UpdateOperation;
        try {
          operation = operationSchema.parse(
            await api<unknown>(
              `/system/update/operations/${encodeURIComponent(operationId)}`,
            ),
          );
        } catch {
          if (Date.now() >= deadline) {
            safeFailure = t("settings.runtime.updateTimeout");
            throw new Error("update-timeout");
          }
          const delay = Promise.withResolvers<void>();
          setTimeout(delay.resolve, 750);
          await delay.promise;
          continue;
        }
        if (operation.state === "running") {
          setUpdate({
            status: "applying",
            version,
            tag,
            phase: operation.phase,
          });
        }
        if (operation.state === "succeeded") {
          setUpdate({ status: "succeeded", version });
          queryClient.invalidateQueries({ queryKey: ["system", "version"] });
          return;
        }
        if (operation.state === "failed") {
          safeFailure =
            operation.message ?? t("settings.runtime.updateFailedGeneric");
          throw new Error("update-failed");
        }
        if (Date.now() >= deadline) {
          safeFailure = t("settings.runtime.updateTimeout");
          throw new Error("update-timeout");
        }
        const delay = Promise.withResolvers<void>();
        setTimeout(delay.resolve, 750);
        await delay.promise;
      }
    } catch {
      setUpdate({
        status: "failed",
        message: safeFailure ?? t("settings.runtime.updateNetworkError"),
      });
    }
  };

  return (
    <div className="mt-4 min-w-0 overflow-hidden rounded-xl border border-border/60 bg-background">
      {runtime.isLoading || version.isLoading ? (
        <div
          className="grid gap-3 p-5"
          role="status"
          aria-label={t("query.failed")}
        >
          <Skeleton aria-hidden className="h-5 w-48" />
          <Skeleton aria-hidden className="h-5 w-full" />
          <Skeleton aria-hidden className="h-5 w-2/3" />
        </div>
      ) : null}
      {runtime.isError ? (
        <div className="grid gap-2 p-5">
          <Alert variant="destructive">
            <AlertTitle>{t("settings.runtime.actionError")}</AlertTitle>
          </Alert>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full sm:w-auto"
            onClick={() => void runtime.refetch()}
          >
            {t("settings.runtime.refresh")}
          </Button>
        </div>
      ) : null}
      {runtime.data ? (
        <RuntimeFacts
          runtime={runtime.data}
          version={version.data ?? null}
          t={t}
        />
      ) : null}
      <div className="grid min-w-0 gap-4 border-t border-border/60 px-5 py-4 sm:px-6">
        <AutostartRow
          autostart={autostart.data ?? null}
          loading={autostart.isLoading}
          error={autostart.isError}
          pending={autostartMutation.isPending}
          supported={runtime.data?.autostartSupported ?? true}
          t={t}
          onToggle={(enabled) => autostartMutation.mutate(enabled)}
          onRetry={() => void autostart.refetch()}
        />
        {autostartMutation.isError ? (
          <Alert variant="destructive">
            <AlertTitle>{t("settings.runtime.actionError")}</AlertTitle>
          </Alert>
        ) : null}
        <ShortcutsRow
          pending={shortcutsMutation.isPending}
          supported={runtime.data?.shortcutsSupported ?? true}
          t={t}
          onAction={(action) => shortcutsMutation.mutate(action)}
        />
        {shortcutsMutation.data ? (
          <Alert>
            <AlertDescription>
              {shortcutsMutation.data.message}
            </AlertDescription>
          </Alert>
        ) : null}
        {shortcutsMutation.isError ? (
          <Alert variant="destructive">
            <AlertTitle>{t("settings.runtime.actionError")}</AlertTitle>
          </Alert>
        ) : null}
        <UpdateRow
          update={update}
          t={t}
          onCheck={() => void checkUpdates()}
          onApply={() => void applyUpdate()}
        />
        <p className="text-sm leading-6 text-muted-foreground">
          {t("settings.runtime.tray")}
        </p>
      </div>
    </div>
  );
}

function RuntimeFacts({
  runtime,
  version,
  t,
}: {
  runtime: RuntimeInfo;
  version: VersionInfo | null;
  t: Translate;
}) {
  return (
    <dl className="min-w-0 divide-y divide-border/60">
      <RuntimeFact
        label={t("settings.runtime.webOrigin")}
        value={runtime.webOrigin}
      />
      <RuntimeFact
        label={t("settings.runtime.orchestratorPort")}
        value={String(runtime.orchestratorPort)}
      />
      <RuntimeFact
        label={t("settings.runtime.dataDir")}
        value={runtime.dataDir ?? "—"}
      />
      <RuntimeFact
        label={t("settings.runtime.profile")}
        value={runtime.deploymentProfile}
      />
      <RuntimeFact
        label={t("settings.runtime.channel")}
        value={runtime.channel}
      />
      {version ? (
        <>
          <RuntimeFact
            label={t("settings.runtime.appVersion")}
            value={version.appVersion}
          />
          <RuntimeFact
            label={t("settings.runtime.validator")}
            value={version.validatorVersion}
          />
          <RuntimeFact
            label={t("settings.runtime.migrationHead")}
            value={version.migrationHead}
          />
        </>
      ) : null}
      <div className="px-5 py-4 sm:px-6">
        <p className="text-sm leading-6 text-muted-foreground">
          {t("settings.runtime.cliHint")}
        </p>
      </div>
    </dl>
  );
}

function AutostartRow({
  autostart,
  loading,
  error,
  pending,
  supported,
  t,
  onToggle,
  onRetry,
}: {
  autostart: AutostartInfo | null;
  loading: boolean;
  error: boolean;
  pending: boolean;
  supported: boolean;
  t: Translate;
  onToggle: (enabled: boolean) => void;
  onRetry: () => void;
}) {
  return (
    <div className="grid min-w-0 gap-2">
      <h3 className="text-sm font-medium">{t("settings.runtime.autostart")}</h3>
      {loading ? <Spinner aria-hidden /> : null}
      {error ? (
        <div className="flex flex-wrap gap-2">
          <Alert variant="destructive">
            <AlertTitle>{t("settings.runtime.actionError")}</AlertTitle>
          </Alert>
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            {t("settings.runtime.refresh")}
          </Button>
        </div>
      ) : null}
      {autostart ? (
        <>
          <p className="text-sm leading-6 text-muted-foreground">
            {autostart.detail}
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending || !supported || autostart.enabled}
              onClick={() => onToggle(true)}
            >
              {pending ? <Spinner data-icon="inline-start" /> : null}
              {t("settings.runtime.autostartOn")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending || !supported || !autostart.enabled}
              onClick={() => onToggle(false)}
            >
              {pending ? <Spinner data-icon="inline-start" /> : null}
              {t("settings.runtime.autostartOff")}
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}

function ShortcutsRow({
  pending,
  supported,
  t,
  onAction,
}: {
  pending: boolean;
  supported: boolean;
  t: Translate;
  onAction: (action: "install" | "remove") => void;
}) {
  return (
    <div className="grid min-w-0 gap-2">
      <h3 className="text-sm font-medium">{t("settings.runtime.shortcuts")}</h3>
      <p className="text-sm leading-6 text-muted-foreground">
        {t("settings.runtime.shortcutsHint")}
      </p>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending || !supported}
          onClick={() => onAction("install")}
        >
          {pending ? <Spinner data-icon="inline-start" /> : null}
          {t("settings.runtime.shortcutsInstall")}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending || !supported}
          onClick={() => onAction("remove")}
        >
          {pending ? <Spinner data-icon="inline-start" /> : null}
          {t("settings.runtime.shortcutsRemove")}
        </Button>
      </div>
    </div>
  );
}

function formatAssetSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KiB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MiB`;
}

function UpdateRow({
  update,
  t,
  onCheck,
  onApply,
}: {
  update: UpdateState;
  t: Translate;
  onCheck: () => void;
  onApply: () => void;
}) {
  return (
    <div className="grid min-w-0 gap-2">
      <h3 className="text-sm font-medium">{t("settings.runtime.update")}</h3>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={
            update.status === "checking" || update.status === "applying"
          }
          onClick={onCheck}
        >
          {update.status === "checking" || update.status === "applying" ? (
            <Spinner data-icon="inline-start" />
          ) : null}
          {update.status === "checking"
            ? t("settings.runtime.checking")
            : update.status === "applying"
              ? t("settings.runtime.applying")
              : t("settings.runtime.checkUpdates")}
        </Button>
        {update.status === "available" ? (
          <Button type="button" size="sm" onClick={onApply}>
            {t("settings.runtime.applyUpdate")}
          </Button>
        ) : null}
      </div>
      {update.status === "up-to-date" ? (
        <Alert>
          <AlertDescription>
            {t("settings.runtime.upToDate", { version: update.version })}
          </AlertDescription>
        </Alert>
      ) : null}
      {update.status === "available" ? (
        <Alert>
          <AlertTitle>
            {t("settings.runtime.updateAvailable", {
              current: update.current,
              version: update.version,
            })}
          </AlertTitle>
          <AlertDescription>
            {t("settings.runtime.releaseMetadata", {
              tag: update.tag,
              publishedAt: update.publishedAt || t("settings.runtime.unknown"),
            })}
          </AlertDescription>
          {update.assets.map((asset) => (
            <AlertDescription key={asset.name} className="font-mono text-xs">
              {asset.name} · {formatAssetSize(asset.size)}
              {asset.digest ? ` · ${asset.digest}` : ""}
            </AlertDescription>
          ))}
          {update.notes ? (
            <AlertDescription>{update.notes.slice(0, 2000)}</AlertDescription>
          ) : null}
          <AlertDescription>
            {t("settings.runtime.updateApplyHint")}
          </AlertDescription>
          <AlertDescription className="font-medium">
            {t("settings.runtime.migrationWarning")}
          </AlertDescription>
        </Alert>
      ) : null}
      {update.status === "applying" ? (
        <Alert>
          <AlertDescription>
            {t("settings.runtime.updatePhase", {
              phase: update.phase
                ? t(`settings.runtime.phase.${update.phase}` as MessageKey)
                : t("settings.runtime.phase.queued"),
            })}
          </AlertDescription>
        </Alert>
      ) : null}
      {update.status === "succeeded" ? (
        <Alert>
          <AlertDescription>
            {t("settings.runtime.updateSucceeded", { version: update.version })}
          </AlertDescription>
        </Alert>
      ) : null}
      {update.status === "failed" ? (
        <Alert variant="destructive">
          <AlertDescription>
            {t("settings.runtime.updateFailed", { message: update.message })}
          </AlertDescription>
        </Alert>
      ) : null}
      {update.status === "not-checked" ? (
        <Alert variant="destructive">
          <AlertDescription>
            {t("settings.runtime.notChecked")}
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
