"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { api } from "@/lib/api";
import {
  PopoverContent,
  PopoverRoot,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type Provider = {
  id: string;
  label: string;
  status: "connected" | "unavailable" | "misconfigured" | "starting" | "error";
  model?: string;
  message?: string;
};

type Settings = {
  teacherProvider: string;
  teacherModel: string;
  reviewerProvider: string;
  reviewerModel: string;
  interviewerProvider: string;
  interviewerModel: string;
  curatorProvider: string;
  curatorModel: string;
  codexExpertProvider: string;
  codexExpertModel: string;
};

const providerLabels: Record<string, string> = {
  mock: "Mock",
  opencode: "OpenCode",
  codex: "Codex",
};

const statusLabels: Record<Provider["status"], string> = {
  connected: "Подключён",
  unavailable: "Недоступен",
  misconfigured: "Нужна настройка",
  starting: "Запускается",
  error: "Ошибка",
};

export function ProviderHealth() {
  const providersQuery = useQuery({
    queryKey: ["providers"],
    queryFn: () => api<{ providers: Provider[] }>("/providers"),
  });
  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: () => api<Settings>("/settings"),
  });
  const providers = providersQuery.data?.providers ?? [];
  const settings = settingsQuery.data ?? null;
  const connected = providers.filter(
    (provider) => provider.status === "connected",
  );
  const hasProblem = providers.some((provider) =>
    ["misconfigured", "error", "unavailable"].includes(provider.status),
  );
  const ready = connected.length > 0 && !hasProblem;
  const roles = [
    {
      label: "Преподаватель",
      provider: settings?.teacherProvider,
      model: settings?.teacherModel,
    },
    {
      label: "Проверка решения",
      provider: settings?.reviewerProvider,
      model: settings?.reviewerModel,
    },
    {
      label: "Интервьюер",
      provider: settings?.interviewerProvider,
      model: settings?.interviewerModel,
    },
    {
      label: "Итоги и повторение",
      provider: settings?.curatorProvider,
      model: settings?.curatorModel,
    },
    {
      label: "Эксперт",
      provider: settings?.codexExpertProvider,
      model: settings?.codexExpertModel,
    },
  ];

  if (providersQuery.isLoading || settingsQuery.isLoading) {
    return (
      <div data-slot="provider-health" role="status" aria-label="Проверяю AI">
        <Skeleton aria-hidden className="h-7 w-24 rounded-full" />
        <span className="sr-only">Проверяю AI…</span>
      </div>
    );
  }
  if (providersQuery.isError || settingsQuery.isError) {
    return (
      <span
        data-slot="provider-health"
        data-state="error"
        role="status"
        className="inline-flex h-7 items-center gap-1.5 rounded-full border border-destructive/30 bg-destructive/10 px-3 text-xs font-medium text-destructive"
      >
        <span aria-hidden className="size-1.5 rounded-full bg-current" />
        Статус AI недоступен
      </span>
    );
  }

  return (
    <PopoverRoot>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-slot="provider-health"
          data-state={ready ? "ready" : "problem"}
          aria-label="Статус AI: подробности в попапе"
          className={cn(
            "inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-xs font-medium outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-ring",
            ready
              ? "border-success/40 bg-success/10 text-success-foreground hover:bg-success/15"
              : "border-warning/40 bg-warning/10 text-warning-foreground hover:bg-warning/15",
          )}
        >
          <span aria-hidden className="size-1.5 rounded-full bg-current" />
          {ready ? "AI готов" : "AI недоступен"}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <div className="flex flex-col gap-3">
          <div>
            <p className="text-sm font-semibold">AI для обучения</p>
            <p className="text-xs text-muted-foreground">
              {connected.length} из {providers.length} подключений активно
            </p>
          </div>
          <ul className="flex flex-col gap-2">
            {roles.map((role) => {
              const provider = providers.find(
                (candidate) => candidate.id === role.provider,
              );
              const status = provider?.status ?? "unavailable";
              return (
                <li
                  key={role.label}
                  data-slot="provider-role"
                  data-status={status}
                  className="flex items-center justify-between gap-2 text-sm"
                >
                  <span className="min-w-0 truncate text-muted-foreground">
                    {role.label}
                  </span>
                  <span className="flex min-w-0 items-center gap-1.5 text-xs">
                    <span
                      aria-hidden
                      className={cn(
                        "size-1.5 shrink-0 rounded-full",
                        status === "connected" ? "bg-success" : "bg-warning",
                      )}
                    />
                    <span className="truncate">
                      {providerLabels[role.provider ?? ""] ?? role.provider} ·{" "}
                      {role.model}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
          {hasProblem ? (
            <p className="rounded-md bg-warning/10 p-2 text-xs leading-5 text-warning-foreground">
              Часть подключений требует настройки. Проверь статусы ниже.
            </p>
          ) : null}
          <div className="border-t border-border pt-2">
            <Link
              href="/settings/developer-tools"
              className="text-xs font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
            >
              Полная диагностика → Инструменты разработчика
            </Link>
          </div>
        </div>
      </PopoverContent>
    </PopoverRoot>
  );
}
