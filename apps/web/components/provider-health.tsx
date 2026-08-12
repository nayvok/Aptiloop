"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { z } from "zod";

import {
  PopoverContent,
  PopoverRoot,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { type MessageKey, useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const settingsSchema = z
  .object({
    ai: z
      .object({
        connections: z.array(
          z
            .object({
              connectionId: z.string(),
              displayName: z.string(),
              enabled: z.boolean(),
              state: z.string(),
              observedCapabilities: z
                .object({
                  connection: z
                    .object({
                      authenticated: z.boolean(),
                      streaming: z.boolean(),
                      cancellation: z.boolean(),
                    })
                    .passthrough(),
                  models: z.array(
                    z
                      .object({
                        modelId: z.string(),
                        available: z.boolean(),
                        typedToolCalls: z.enum([
                          "none",
                          "best-effort",
                          "schema-constrained",
                        ]),
                      })
                      .passthrough(),
                  ),
                })
                .passthrough()
                .nullable(),
            })
            .passthrough(),
        ),
        roleProfiles: z.array(
          z
            .object({
              role: z.enum([
                "course-designer",
                "tutor",
                "evaluator",
                "reviewer",
              ]),
              mode: z.enum(["no-ai", "connection"]),
              connectionId: z.string().nullable(),
              modelId: z.string().nullable(),
              requiredCapabilities: z.array(
                z.enum([
                  "streaming",
                  "models",
                  "tools",
                  "structured-output",
                  "cancellation",
                ]),
              ),
            })
            .passthrough(),
        ),
      })
      .passthrough(),
  })
  .passthrough();
type Settings = z.infer<typeof settingsSchema>;
type RoleProfile = Settings["ai"]["roleProfiles"][number];
const roleLabels: Readonly<Record<RoleProfile["role"], MessageKey>> = {
  "course-designer": "role.courseDesigner",
  tutor: "role.tutor",
  evaluator: "role.evaluator",
  reviewer: "role.reviewer",
};

export function ProviderHealth({
  compactOnMobile = false,
}: {
  compactOnMobile?: boolean;
}) {
  const { t } = useI18n();
  const compactControlClass = compactOnMobile
    ? "size-11 justify-center rounded-control px-0 text-sm shadow-none min-[680px]:h-11 min-[680px]:w-auto min-[680px]:px-3.5"
    : undefined;
  const compactLabelClass = compactOnMobile
    ? "sr-only min-[680px]:not-sr-only"
    : undefined;
  const settingsQuery = useQuery({
    queryKey: ["settings", "provider-health"],
    queryFn: async () => settingsSchema.parse(await api<unknown>("/settings")),
  });
  const settings = settingsQuery.data?.ai ?? null;
  const roles =
    settings?.roleProfiles.map((profile) => {
      const connection = settings.connections.find(
        (candidate) => candidate.connectionId === profile.connectionId,
      );
      return {
        ...profile,
        connection,
        status:
          profile.mode === "no-ai"
            ? "disabled"
            : (connection?.state ?? "unavailable"),
      };
    }) ?? [];
  const allOff =
    roles.length > 0 && roles.every((role) => role.mode === "no-ai");
  const roleIsReady = (role: (typeof roles)[number]) => {
    if (role.mode === "no-ai") return false;
    const observed = role.connection?.observedCapabilities;
    const model = observed?.models.find(
      (candidate) => candidate.modelId === role.modelId && candidate.available,
    );
    if (
      !role.connection?.enabled ||
      (role.status !== "connected" && role.status !== "degraded") ||
      (role.status === "connected" && !observed?.connection.authenticated) ||
      !observed ||
      !model
    ) {
      return false;
    }
    return role.requiredCapabilities.every((capability) => {
      switch (capability) {
        case "streaming":
          return observed.connection.streaming;
        case "models":
          return true;
        case "cancellation":
          return observed.connection.cancellation;
        case "tools":
          return model.typedToolCalls !== "none";
        case "structured-output":
          return model.typedToolCalls === "schema-constrained";
        default:
          return false;
      }
    });
  };
  const configuredRoles = roles.filter((role) => role.mode === "connection");
  const roleIsDegraded = (role: (typeof roles)[number]) =>
    role.status === "degraded" && roleIsReady(role);
  const ready =
    configuredRoles.length > 0 && configuredRoles.every(roleIsReady);
  const hasDegraded = configuredRoles.some(roleIsDegraded);
  const hasProblem = configuredRoles.some((role) => !roleIsReady(role));
  const readyCount = configuredRoles.filter(roleIsReady).length;

  if (settingsQuery.isLoading) {
    return (
      <div
        data-slot="provider-health"
        role="status"
        aria-label={t("provider.checking")}
      >
        <Skeleton
          aria-hidden
          className={cn(
            "h-7 w-24 rounded-full",
            compactOnMobile &&
              "size-11 rounded-control min-[680px]:h-11 min-[680px]:w-24",
          )}
        />
        <span className="sr-only">{t("provider.checking")}</span>
      </div>
    );
  }
  if (settingsQuery.isError) {
    return (
      <Link
        href="/settings?section=connections"
        data-slot="provider-health"
        data-state="error"
        aria-label={t("provider.statusUnavailable")}
        className={cn(
          "inline-flex h-7 items-center gap-1.5 rounded-full border border-destructive/30 bg-destructive/10 px-3 text-xs font-medium text-destructive outline-none transition-colors hover:bg-destructive/15 focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none",
          compactControlClass,
        )}
      >
        <span aria-hidden className="size-1.5 rounded-full bg-current" />
        <span data-slot="provider-health-label" className={compactLabelClass}>
          {t("provider.statusUnavailable")}
        </span>
      </Link>
    );
  }

  const state = allOff
    ? "off"
    : hasProblem
      ? "problem"
      : hasDegraded
        ? "degraded"
        : ready
          ? "ready"
          : "problem";
  const stateLabel = allOff
    ? t("provider.off")
    : ready && !hasDegraded
      ? t("provider.ready")
      : hasDegraded && !hasProblem
        ? t("provider.configured")
        : t("provider.needsAttention");

  return (
    <PopoverRoot>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-slot="provider-health"
          data-state={state}
          aria-label={`${t("provider.statusDetails")}: ${stateLabel}`}
          className={cn(
            "inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-xs font-medium outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-ring",
            state === "ready"
              ? "border-success/40 bg-success/10 text-success-foreground hover:bg-success/15"
              : state === "problem" || state === "degraded"
                ? "border-warning/40 bg-warning/10 text-warning-foreground hover:bg-warning/15"
                : "border-border bg-muted text-muted-foreground hover:bg-accent",
            compactControlClass,
          )}
        >
          <span aria-hidden className="size-1.5 rounded-full bg-current" />
          <span data-slot="provider-health-label" className={compactLabelClass}>
            {stateLabel}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <div className="flex flex-col gap-3">
          <div>
            <p className="text-sm font-semibold">{t("provider.title")}</p>
            <p className="text-xs text-muted-foreground">
              {allOff
                ? t("provider.off")
                : t("provider.rolesReady", {
                    ready: readyCount,
                    total: configuredRoles.length,
                  })}
            </p>
          </div>
          <ul className="flex flex-col gap-2">
            {roles.map((role) => (
              <li
                key={role.role}
                data-slot="provider-role"
                data-status={
                  role.mode === "no-ai"
                    ? "off"
                    : roleIsDegraded(role)
                      ? "degraded"
                      : roleIsReady(role)
                        ? "ready"
                        : "problem"
                }
                data-connection-status={role.status}
                className="flex items-center justify-between gap-2 text-sm"
              >
                <span className="min-w-0 truncate text-muted-foreground">
                  {t(roleLabels[role.role])}
                </span>
                <span className="flex min-w-0 items-center gap-1.5 text-xs">
                  <span
                    aria-hidden
                    data-slot="provider-role-indicator"
                    data-state={
                      role.mode === "no-ai"
                        ? "off"
                        : roleIsDegraded(role)
                          ? "degraded"
                          : roleIsReady(role)
                            ? "ready"
                            : "problem"
                    }
                    className={cn(
                      "size-1.5 shrink-0 rounded-full",
                      role.mode === "no-ai"
                        ? "bg-muted-foreground/55"
                        : roleIsDegraded(role)
                          ? "bg-warning"
                          : roleIsReady(role)
                            ? "bg-success"
                            : "bg-warning",
                    )}
                  />
                  <span className="truncate">
                    {role.mode === "no-ai" ? (
                      t("provider.off")
                    ) : (
                      <>
                        {role.connection?.displayName ??
                          t("provider.unavailable")}
                        {" · "}
                        {role.modelId ?? t("provider.noModel")}
                        {role.connection && role.modelId
                          ? roleIsDegraded(role)
                            ? ` · ${t("settings.status.degraded")}`
                            : role.status === "starting"
                              ? ` · ${t("settings.status.starting")}`
                              : role.status === "connected" && roleIsReady(role)
                                ? null
                                : ` · ${t("provider.unavailable")}`
                          : null}
                      </>
                    )}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          {hasProblem ? (
            <p className="rounded-md bg-warning/10 p-2 text-xs leading-5 text-warning-foreground">
              {t("provider.problem")}
            </p>
          ) : hasDegraded ? (
            <p className="rounded-md bg-warning/10 p-2 text-xs leading-5 text-warning-foreground">
              {t("provider.degradedNotice")}
            </p>
          ) : null}
          <div className="border-t border-border pt-2">
            {hasProblem ? (
              <Link
                href="/settings?section=connections&source=recovery"
                data-slot="provider-recovery-link"
                className="inline-flex h-9 w-full items-center justify-center rounded-control bg-primary px-3 text-sm font-medium text-primary-foreground outline-none transition-colors hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
              >
                {t("provider.recoverConnections")}
              </Link>
            ) : null}
            <Link
              href="/settings/developer-tools"
              className="mt-2 inline-flex text-xs font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t("provider.fullDiagnostics")}
            </Link>
          </div>
        </div>
      </PopoverContent>
    </PopoverRoot>
  );
}
