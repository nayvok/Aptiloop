"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { ApiError, api } from "@/lib/api";
import { type MessageKey, type UiLocale, useI18n } from "@/lib/i18n";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field";
import { QueryError } from "@/components/query-state";
import {
  ProviderConnectionManager,
  type ProviderConnectionSummary,
  type ProviderManagementSettings,
} from "@/components/provider-connection-manager";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

const settingsMutationSchema = z
  .object({
    theme: z.enum(["system", "light", "dark"]),
    uiLocale: z.enum(["en-US", "ru-RU"]),
  })
  .strict();
type SettingsMutation = z.infer<typeof settingsMutationSchema>;
type AiRole = "course-designer" | "tutor" | "evaluator" | "reviewer";
type RoleProfile = {
  role: AiRole;
  mode: "no-ai" | "connection";
  connectionId: string | null;
  modelId: string | null;
  requiredCapabilities: string[];
  toolPolicyId: string;
  budgets: {
    maxInputBytes: number;
    maxOutputBytes: number;
    maxEvents: number;
    maxToolCalls: number;
    deadlineMs: number;
  };
};
type Connection = ProviderConnectionSummary & {
  adapterId: string;
  providerType: string;
  lastCheckedAt: string | null;
};
type SettingsQuery = Omit<SettingsMutation, "uiLocale"> & {
  uiLocale: UiLocale | null;
  workspaceRoot: string;
  zedExecutable: string;
  opencodeBaseUrl: string;
  ai: {
    connections: Connection[];
    roleProfiles: RoleProfile[];
    management: ProviderManagementSettings;
  };
};

const roleMeta: ReadonlyArray<{
  role: AiRole;
  label: MessageKey;
  help: MessageKey;
}> = [
  {
    role: "course-designer",
    label: "role.courseDesigner",
    help: "role.courseDesigner.help",
  },
  { role: "tutor", label: "role.tutor", help: "role.tutor.help" },
  {
    role: "evaluator",
    label: "role.evaluator",
    help: "role.evaluator.help",
  },
  {
    role: "reviewer",
    label: "role.reviewer",
    help: "role.reviewer.help",
  },
];

const sectionClass =
  "min-w-0 rounded-xl border border-border bg-card p-5 sm:p-6";

function selectionValue(profile: RoleProfile): string {
  return profile.mode === "connection" &&
    profile.connectionId &&
    profile.modelId
    ? `${profile.connectionId}\u0000${profile.modelId}`
    : "off";
}

export function SettingsForm() {
  const queryClient = useQueryClient();
  const { setTheme } = useTheme();
  const { locale, setLocale, t } = useI18n();
  const [roleProfiles, setRoleProfiles] = useState<RoleProfile[]>([]);
  const query = useQuery({
    queryKey: ["settings"],
    queryFn: () => api<SettingsQuery>("/settings"),
  });
  useEffect(() => {
    if (query.data) setRoleProfiles(query.data.ai.roleProfiles);
  }, [query.data]);

  const saveSettings = useMutation({
    mutationFn: async (values: SettingsMutation) => {
      await Promise.all([
        api<{ saved: true }>("/settings", {
          method: "PUT",
          body: JSON.stringify({ theme: values.theme }),
        }),
        api<{ saved: true; uiLocale: UiLocale }>("/settings/locale", {
          method: "PUT",
          body: JSON.stringify({ uiLocale: values.uiLocale }),
        }),
      ]);
      return { saved: true as const };
    },
    onSuccess: (_result, submitted) => {
      setLocale(submitted.uiLocale);
      queryClient.setQueryData<SettingsQuery>(["settings"], (current) =>
        current ? { ...current, ...submitted } : current,
      );
    },
  });
  const saveAi = useMutation({
    mutationFn: (profiles: RoleProfile[]) =>
      api<{ saved: true; roleProfiles: RoleProfile[] }>("/settings/ai", {
        method: "PUT",
        body: JSON.stringify({
          roleProfiles: profiles.map(
            ({ role, mode, connectionId, modelId }) => ({
              role,
              mode,
              connectionId,
              modelId,
            }),
          ),
        }),
      }),
    onSuccess: (result) => {
      setRoleProfiles(result.roleProfiles);
      queryClient.setQueryData<SettingsQuery>(["settings"], (current) =>
        current
          ? {
              ...current,
              ai: { ...current.ai, roleProfiles: result.roleProfiles },
            }
          : current,
      );
    },
  });
  const form = useForm<SettingsMutation>({
    resolver: zodResolver(settingsMutationSchema),
    values: {
      theme: query.data?.theme ?? "system",
      uiLocale: query.data?.uiLocale ?? locale,
    },
    mode: "onChange",
  });

  if (query.isLoading) {
    return (
      <div role="status" aria-label={t("query.loadingSettings")}>
        <Skeleton aria-hidden className="h-96" />
        <span className="sr-only">{t("query.loadingSettings")}</span>
      </div>
    );
  }
  if (query.isError || !query.data) {
    return (
      <QueryError
        message={t("query.settingsUnavailable")}
        retry={() => void query.refetch()}
      />
    );
  }

  const themeRegistration = form.register("theme");
  const localeRegistration = form.register("uiLocale");
  const connectionOptions = query.data.ai.connections.flatMap((connection) =>
    (connection.observedCapabilities?.models ?? [])
      .filter((model) => model.available)
      .map((model) => ({ connection, modelId: model.modelId })),
  );

  return (
    <form
      data-slot="settings-form"
      className="grid gap-6"
      onSubmit={form.handleSubmit((submitted) =>
        saveSettings.mutate(submitted),
      )}
    >
      <section
        aria-labelledby="settings-interface-title"
        className={sectionClass}
      >
        <div className="mb-5">
          <h3 id="settings-interface-title" className="font-semibold">
            {t("settings.section.interface")}
          </h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {t("settings.section.interfaceDescription")}
          </p>
        </div>
        <FieldGroup>
          <Field orientation="responsive">
            <FieldContent>
              <FieldLabel htmlFor="theme">{t("settings.theme")}</FieldLabel>
              <FieldDescription>{t("settings.theme.help")}</FieldDescription>
            </FieldContent>
            <select
              id="theme"
              {...themeRegistration}
              onChange={(event) => {
                themeRegistration.onChange(event);
                setTheme(event.target.value);
              }}
              className="h-11 w-full max-w-xs rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="system">{t("shell.theme.system")}</option>
              <option value="light">{t("shell.theme.light")}</option>
              <option value="dark">{t("shell.theme.dark")}</option>
            </select>
          </Field>
          <Field orientation="responsive">
            <FieldContent>
              <FieldLabel htmlFor="ui-locale">
                {t("settings.locale")}
              </FieldLabel>
              <FieldDescription>{t("settings.locale.help")}</FieldDescription>
            </FieldContent>
            <select
              id="ui-locale"
              {...localeRegistration}
              onChange={(event) => {
                localeRegistration.onChange(event);
                setLocale(event.target.value as UiLocale);
              }}
              className="h-11 w-full max-w-xs rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="en-US">{t("locale.option.english")}</option>
              <option value="ru-RU">{t("locale.option.russian")}</option>
            </select>
          </Field>
          <Field orientation="responsive">
            <FieldContent>
              <FieldTitle>{t("settings.section.local")}</FieldTitle>
              <FieldDescription>
                {t("settings.section.localDescription")}
              </FieldDescription>
            </FieldContent>
            <dl className="grid min-w-0 gap-2 text-sm">
              <div className="min-w-0 rounded-lg border border-border bg-muted/20 p-3">
                <dt className="text-xs text-muted-foreground">
                  {t("settings.workspace")}
                </dt>
                <dd
                  className="mt-1 truncate font-mono"
                  title={query.data.workspaceRoot}
                >
                  {query.data.workspaceRoot}
                </dd>
              </div>
              <div className="min-w-0 rounded-lg border border-border bg-muted/20 p-3">
                <dt className="text-xs text-muted-foreground">
                  {t("settings.editor")}
                </dt>
                <dd
                  className="mt-1 truncate font-mono"
                  title={query.data.zedExecutable}
                >
                  {query.data.zedExecutable}
                </dd>
              </div>
            </dl>
          </Field>
        </FieldGroup>
      </section>

      <section aria-labelledby="settings-ai-title" className={sectionClass}>
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 id="settings-ai-title" className="font-semibold">
              {t("settings.section.ai")}
            </h3>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {t("settings.section.aiDescription")}
            </p>
          </div>
          <Badge variant="outline">{t("settings.serverPolicy")}</Badge>
        </div>
        <FieldGroup>
          {roleMeta.map((meta) => {
            const profile = roleProfiles.find(
              (candidate) => candidate.role === meta.role,
            );
            if (!profile) return null;
            return (
              <Field key={meta.role} orientation="responsive">
                <FieldContent>
                  <FieldLabel htmlFor={`role-${meta.role}`}>
                    {t(meta.label)}
                  </FieldLabel>
                  <FieldDescription>{t(meta.help)}</FieldDescription>
                </FieldContent>
                <Select
                  value={selectionValue(profile)}
                  onValueChange={(value) => {
                    setRoleProfiles((current) =>
                      current.map((candidate) => {
                        if (candidate.role !== meta.role) return candidate;
                        if (value === "off") {
                          return {
                            ...candidate,
                            mode: "no-ai",
                            connectionId: null,
                            modelId: null,
                          };
                        }
                        const [connectionId, modelId] = value.split("\u0000");
                        return {
                          ...candidate,
                          mode: "connection",
                          connectionId: connectionId ?? null,
                          modelId: modelId ?? null,
                        };
                      }),
                    );
                  }}
                >
                  <SelectTrigger
                    id={`role-${meta.role}`}
                    className="w-full max-w-sm"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="off">{t("settings.aiOff")}</SelectItem>
                      {connectionOptions.map(({ connection, modelId }) => (
                        <SelectItem
                          key={`${connection.connectionId}:${modelId}`}
                          value={`${connection.connectionId}\u0000${modelId}`}
                        >
                          {connection.displayName} · {modelId}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            );
          })}
        </FieldGroup>
        <div className="mt-5 flex flex-wrap items-center justify-end gap-3">
          <span
            role="status"
            aria-live="polite"
            className="text-xs text-muted-foreground"
          >
            {saveAi.isSuccess
              ? t("settings.aiSaved")
              : saveAi.isError
                ? saveAi.error instanceof ApiError
                  ? saveAi.error.message
                  : t("settings.aiSaveError")
                : t("settings.externalDisclosure")}
          </span>
          <Button
            type="button"
            variant="outline"
            disabled={saveAi.isPending}
            onClick={() => saveAi.mutate(roleProfiles)}
          >
            {t(saveAi.isPending ? "settings.saving" : "settings.saveAi")}
          </Button>
        </div>
      </section>

      <section
        aria-labelledby="settings-connections-title"
        className={sectionClass}
      >
        <ProviderConnectionManager
          connections={query.data.ai.connections}
          management={query.data.ai.management}
        />
        <div className="mt-5 flex justify-end">
          <Button asChild variant="outline">
            <Link href="/settings/developer-tools">
              {t("settings.developerDiagnostics")}
            </Link>
          </Button>
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-end gap-3">
        <span
          role="status"
          aria-live="polite"
          className="text-xs text-muted-foreground"
        >
          {saveSettings.isSuccess
            ? t("settings.saved")
            : saveSettings.isError
              ? saveSettings.error instanceof ApiError
                ? saveSettings.error.message
                : t("settings.saveError")
              : t("settings.localOnly")}
        </span>
        <Button type="submit" disabled={saveSettings.isPending}>
          {t(saveSettings.isPending ? "settings.saving" : "settings.save")}
        </Button>
      </div>
    </form>
  );
}
