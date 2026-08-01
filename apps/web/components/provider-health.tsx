"use client";

import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

type Provider = {
  id: string;
  label: string;
  status: "connected" | "unavailable" | "misconfigured" | "starting" | "error";
  model?: string;
  message?: string;
};

export function ProviderHealth() {
  const query = useQuery({
    queryKey: ["providers"],
    queryFn: () => api<{ providers: Provider[] }>("/providers"),
  });
  const providers = query.data?.providers ?? [];
  const connected = providers.filter(
    (provider) => provider.status === "connected",
  );
  const hasProblem = providers.some((provider) =>
    ["misconfigured", "error", "unavailable"].includes(provider.status),
  );
  const details = providers
    .map(
      (provider) =>
        `${provider.label}: ${provider.status}${provider.model ? `, ${provider.model}` : ""}${provider.message ? `, ${provider.message}` : ""}`,
    )
    .join("; ");

  if (query.isLoading)
    return (
      <div
        data-slot="provider-health"
        role="status"
        aria-label="Проверяю провайдеры"
      >
        <Skeleton aria-hidden className="h-6 w-28 rounded-full" />
        <span className="sr-only">Проверяю провайдеры…</span>
      </div>
    );
  if (query.isError)
    return (
      <Badge data-slot="provider-health" variant="error" role="status">
        Статус недоступен
      </Badge>
    );
  if (!connected.length)
    return (
      <Badge
        data-slot="provider-health"
        variant="warning"
        role="status"
        title={details || undefined}
      >
        Нет подключений
      </Badge>
    );
  return (
    <Badge
      data-slot="provider-health"
      variant={hasProblem ? "warning" : "success"}
      role="status"
      aria-label={details}
      title={details}
    >
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {connected.length}/{providers.length} подключено
      <span className="hidden xl:inline">
        ·{" "}
        {connected
          .map(
            (provider) =>
              `${provider.label}${provider.model ? ` · ${provider.model}` : ""}`,
          )
          .join("; ")}
      </span>
    </Badge>
  );
}
