"use client";

import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";

type Provider = {
  id: string;
  label: string;
  status: "connected" | "unavailable" | "misconfigured" | "starting" | "error";
  model?: string;
};

const variants = {
  connected: "success",
  unavailable: "outline",
  misconfigured: "warning",
  starting: "secondary",
  error: "error",
} as const;

export function ProviderHealth() {
  const query = useQuery({
    queryKey: ["providers"],
    queryFn: () => api<{ providers: Provider[] }>("/providers"),
  });
  const active = query.data?.providers.find(
    (provider) => provider.status === "connected",
  );

  if (query.isLoading) return <Badge>Провайдер…</Badge>;
  if (!active) return <Badge variant="warning">Только offline</Badge>;
  return (
    <Badge variant={variants[active.status]}>
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {active.label}
      <span className="hidden sm:inline">· {active.model ?? "default"}</span>
    </Badge>
  );
}
