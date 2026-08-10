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
  state: string;
};
type RoleProfile = {
  role: "course-designer" | "tutor" | "evaluator" | "reviewer";
  mode: "no-ai" | "connection";
  connectionId: string | null;
  modelId: string | null;
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

export function ProviderHealth() {
  const { t } = useI18n();
  const settingsQuery = useQuery({
    queryKey: ["settings"],
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
  const ready =
    roles.length > 0 &&
    roles.every((role) =>
      role.mode === "no-ai"
        ? true
        : role.status === "connected" || role.status === "degraded",
    );
  const hasProblem = roles.some(
    (role) =>
      role.mode === "connection" &&
      !["connected", "degraded", "starting"].includes(role.status),
  );
  const readyCount = roles.filter(
    (role) => role.mode === "no-ai" || role.status === "connected",
  ).length;

  if (settingsQuery.isLoading) {
    return (
      <div
        data-slot="provider-health"
        role="status"
        aria-label={t("provider.checking")}
      >
        <Skeleton aria-hidden className="h-7 w-24 rounded-full" />
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
        className="inline-flex h-7 items-center gap-1.5 rounded-full border border-destructive/30 bg-destructive/10 px-3 text-xs font-medium text-destructive"
      >
        <span aria-hidden className="size-1.5 rounded-full bg-current" />
        {t("provider.statusUnavailable")}
      </span>
    );
  }

  const state = allOff ? "off" : ready ? "ready" : "problem";
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
              : state === "problem"
                ? "border-warning/40 bg-warning/10 text-warning-foreground hover:bg-warning/15"
                : "border-border bg-muted text-muted-foreground hover:bg-accent",
          )}
        >
          <span aria-hidden className="size-1.5 rounded-full bg-current" />
          {stateLabel}
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
                      role.mode === "no-ai" || role.status === "connected"
                        ? "bg-success"
                        : "bg-warning",
                    )}
                  />
                  <span className="truncate">
                    {role.mode === "no-ai"
                      ? t("provider.off")
                      : `${role.connection?.displayName ?? t("provider.unavailable")} · ${role.modelId ?? t("provider.noModel")}`}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          {hasProblem ? (
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
