"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { ApiError, api } from "@/lib/api";
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
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

const settingsMutationSchema = z
  .object({ theme: z.enum(["system", "light", "dark"]) })
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
type Connection = {
  connectionId: string;
  adapterId: string;
  providerType: string;
  displayName: string;
  enabled: boolean;
  external: boolean;
  state: string;
  lastCheckedAt: string | null;
  observedCapabilities: {
    models: Array<{
      modelId: string;
      available: boolean;
    }>;
  } | null;
};
type SettingsQuery = SettingsMutation & {
  workspaceRoot: string;
  zedExecutable: string;
  opencodeBaseUrl: string;
  ai: {
    connections: Connection[];
    roleProfiles: RoleProfile[];
  };
};

const roleMeta: ReadonlyArray<{
  role: AiRole;
  label: string;
  help: string;
}> = [
  {
    role: "course-designer",
    label: "Course Designer",
    help: "Draft-only proposals. Apply and Publish remain separate actions.",
  },
  {
    role: "tutor",
    label: "Tutor",
    help: "Learner-safe explanation and Socratic guidance.",
  },
  {
    role: "evaluator",
    label: "Evaluator",
    help: "Bounded interview and evaluation output; no mastery writes.",
  },
  {
    role: "reviewer",
    label: "Reviewer",
    help: "Evidence-only review with no patch or local file authority.",
  },
];

const statusLabels: Readonly<Record<string, string>> = {
  disabled: "Off",
  starting: "Starting",
  connected: "Connected",
  degraded: "Needs canary",
  "authentication-required": "Authentication required",
  unavailable: "Unavailable",
  misconfigured: "Configuration required",
  error: "Error",
};
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
  const [roleProfiles, setRoleProfiles] = useState<RoleProfile[]>([]);
  const query = useQuery({
    queryKey: ["settings"],
    queryFn: () => api<SettingsQuery>("/settings"),
  });
  useEffect(() => {
    if (query.data) setRoleProfiles(query.data.ai.roleProfiles);
  }, [query.data]);

  const saveTheme = useMutation({
    mutationFn: (values: SettingsMutation) =>
      api<{ saved: true }>("/settings", {
        method: "PUT",
        body: JSON.stringify(values),
      }),
    onSuccess: (_result, submitted) => {
      queryClient.setQueryData<SettingsQuery>(["settings"], (current) =>
        current ? { ...current, theme: submitted.theme } : current,
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
    values: { theme: query.data?.theme ?? "system" },
    mode: "onChange",
  });

  if (query.isLoading) {
    return (
      <div role="status" aria-label="Loading settings">
        <Skeleton aria-hidden className="h-96" />
        <span className="sr-only">Loading settings…</span>
      </div>
    );
  }
  if (query.isError || !query.data) {
    return (
      <QueryError
        message="Settings are unavailable"
        retry={() => void query.refetch()}
      />
    );
  }

  const themeRegistration = form.register("theme");
  const connectionOptions = query.data.ai.connections.flatMap((connection) =>
    (connection.observedCapabilities?.models ?? [])
      .filter((model) => model.available)
      .map((model) => ({ connection, modelId: model.modelId })),
  );

  return (
    <form
      data-slot="settings-form"
      className="grid gap-6"
      onSubmit={form.handleSubmit((submitted) => saveTheme.mutate(submitted))}
    >
      <section
        aria-labelledby="settings-general-title"
        className={sectionClass}
      >
        <div className="mb-5">
          <h3 id="settings-general-title" className="font-semibold">
            General
          </h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Appearance and server-owned local paths.
          </p>
        </div>
        <FieldGroup>
          <Field orientation="responsive">
            <FieldContent>
              <FieldLabel htmlFor="theme">Theme</FieldLabel>
              <FieldDescription>
                Applied immediately and saved locally.
              </FieldDescription>
            </FieldContent>
            <select
              id="theme"
              {...themeRegistration}
              onChange={(event) => {
                themeRegistration.onChange(event);
                setTheme(event.target.value);
              }}
              className="h-10 w-full max-w-xs rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </Field>
          <Field orientation="responsive">
            <FieldContent>
              <FieldTitle>Local paths</FieldTitle>
              <FieldDescription>
                Diagnostic only; never sent by the browser.
              </FieldDescription>
            </FieldContent>
            <dl className="grid min-w-0 gap-2 text-sm">
              <div className="min-w-0 rounded-lg border border-border bg-muted/20 p-3">
                <dt className="text-xs text-muted-foreground">
                  Exercise workspace
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
                  Editor executable
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
              AI roles
            </h3>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Exact connection and model resolution. No fallback to Mock.
            </p>
          </div>
          <Badge variant="outline">Server-owned policy</Badge>
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
                    {meta.label}
                  </FieldLabel>
                  <FieldDescription>{meta.help}</FieldDescription>
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
                      <SelectItem value="off">AI Off</SelectItem>
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
              ? "AI role profiles saved"
              : saveAi.isError
                ? saveAi.error instanceof ApiError
                  ? saveAi.error.message
                  : "Could not save AI role profiles"
                : "External turns require one-time disclosure approval"}
          </span>
          <Button
            type="button"
            variant="outline"
            disabled={saveAi.isPending}
            onClick={() => saveAi.mutate(roleProfiles)}
          >
            {saveAi.isPending ? "Saving…" : "Save AI roles"}
          </Button>
        </div>
      </section>

      <section
        aria-labelledby="settings-connections-title"
        className={sectionClass}
      >
        <div className="mb-5">
          <h3 id="settings-connections-title" className="font-semibold">
            Connections
          </h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Readiness is observed and time-scoped. Credentials stay in
            provider-owned storage.
          </p>
        </div>
        <ul className="grid gap-3 md:grid-cols-2">
          {query.data.ai.connections.map((connection) => (
            <li
              key={connection.connectionId}
              className="rounded-lg border border-border bg-background p-4"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">{connection.displayName}</p>
                <Badge
                  variant={
                    connection.state === "connected"
                      ? "success"
                      : connection.state === "error"
                        ? "error"
                        : "outline"
                  }
                >
                  {statusLabels[connection.state] ?? connection.state}
                </Badge>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {connection.external ? "External" : "Local development"} ·{" "}
                {connection.observedCapabilities?.models.length ?? 0} models
              </p>
              <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
                {connection.connectionId}
              </p>
            </li>
          ))}
        </ul>
        <div className="mt-5 flex justify-end">
          <Button asChild variant="outline">
            <Link href="/settings/developer-tools">Developer diagnostics</Link>
          </Button>
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-end gap-3">
        <span
          role="status"
          aria-live="polite"
          className="text-xs text-muted-foreground"
        >
          {saveTheme.isSuccess
            ? "Theme saved"
            : saveTheme.isError
              ? saveTheme.error instanceof ApiError
                ? saveTheme.error.message
                : "Could not save theme"
              : "Settings remain local"}
        </span>
        <Button type="submit" disabled={saveTheme.isPending}>
          {saveTheme.isPending ? "Saving…" : "Save theme"}
        </Button>
      </div>
    </form>
  );
}
