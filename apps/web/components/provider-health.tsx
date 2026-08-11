"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import {
  PopoverContent,
  PopoverRoot,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { type MessageKey, useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type Connection = {
  connectionId: string;
  displayName: string;
  enabled: boolean;
  state: string;
  observedCapabilities: {
    connection: {
      authenticated: boolean;
      streaming: boolean;
      cancellation: boolean;
    };
    models: Array<{
      modelId: string;
      available: boolean;
      typedToolCalls: "none" | "best-effort" | "schema-constrained";
    }>;
  } | null;
};
type RoleProfile = {
  role: "course-designer" | "tutor" | "evaluator" | "reviewer";
  mode: "no-ai" | "connection";
  connectionId: string | null;
  modelId: string | null;
  requiredCapabilities: string[];
};
type Settings = {
  ai: {
    connections: Connection[];
    roleProfiles: RoleProfile[];
  };
};
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
    queryFn: () => api<Settings>("/settings"),
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
    if (role.mode === "no-ai") return true;
    const observed = role.connection?.observedCapabilities;
    const model = observed?.models.find(
      (candidate) => candidate.modelId === role.modelId && candidate.available,
    );
    if (
      !role.connection?.enabled ||
      role.status !== "connected" ||
      !observed?.connection.authenticated ||
      !model
    ) {
      return false;
    }
    return (role.requiredCapabilities ?? []).every((capability) => {
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
  const ready = roles.length > 0 && roles.every((role) => roleIsReady(role));
  const hasDegraded = roles.some(
    (role) =>
      role.mode === "connection" &&
      Boolean(role.modelId) &&
      role.status === "degraded",
  );
  const hasProblem = roles.some(
    (role) =>
      role.mode === "connection" &&
      role.status !== "degraded" &&
      !roleIsReady(role),
  );
  const readyCount = roles.filter((role) => roleIsReady(role)).length;

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
      <span
        data-slot="provider-health"
        data-state="error"
        role="status"
        className={cn(
          "inline-flex h-7 items-center gap-1.5 rounded-full border border-destructive/30 bg-destructive/10 px-3 text-xs font-medium text-destructive",
          compactControlClass,
        )}
      >
        <span aria-hidden className="size-1.5 rounded-full bg-current" />
        <span data-slot="provider-health-label" className={compactLabelClass}>
          {t("provider.statusUnavailable")}
        </span>
      </span>
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
    : ready
      ? t("provider.ready")
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
              {t("provider.rolesReady", {
                ready: readyCount,
                total: roles.length,
              })}
            </p>
          </div>
          <ul className="flex flex-col gap-2">
            {roles.map((role) => (
              <li
                key={role.role}
                data-slot="provider-role"
                data-status={role.status}
                className="flex items-center justify-between gap-2 text-sm"
              >
                <span className="min-w-0 truncate text-muted-foreground">
                  {t(roleLabels[role.role])}
                </span>
                <span className="flex min-w-0 items-center gap-1.5 text-xs">
                  <span
                    aria-hidden
                    className={cn(
                      "size-1.5 shrink-0 rounded-full",
                      roleIsReady(role) ? "bg-success" : "bg-warning",
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
                          ? role.status === "degraded"
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
          {hasProblem || hasDegraded ? (
            <p className="rounded-md bg-warning/10 p-2 text-xs leading-5 text-warning-foreground">
              {t("provider.problem")}
            </p>
          ) : null}
          <div className="border-t border-border pt-2">
            <Link
              href="/settings/developer-tools"
              className="text-xs font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t("provider.fullDiagnostics")}
            </Link>
          </div>
        </div>
      </PopoverContent>
    </PopoverRoot>
  );
}
