"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { QueryError } from "@/components/query-state";
import { Skeleton } from "@/components/ui/skeleton";

const providerSchema = z.enum(["mock", "opencode", "codex"]);
const schema = z.object({
  workspaceRoot: z.string().min(1, "Укажи папку упражнений"),
  zedExecutable: z.string().min(1, "Укажи executable, без shell-аргументов"),
  opencodeBaseUrl: z
    .url()
    .refine(
      (value) =>
        ["127.0.0.1", "localhost", "[::1]"].includes(new URL(value).hostname),
      "Для MVP разрешён только loopback endpoint",
    ),
  teacherProvider: providerSchema,
  teacherModel: z.string().min(1),
  reviewerProvider: providerSchema,
  reviewerModel: z.string().min(1),
  interviewerProvider: providerSchema,
  interviewerModel: z.string().min(1),
  curatorProvider: providerSchema,
  curatorModel: z.string().min(1),
  codexExpertProvider: providerSchema,
  codexExpertModel: z.string().min(1),
  theme: z.enum(["system", "light", "dark"]),
});
type Settings = z.infer<typeof schema>;

export function SettingsForm() {
  const query = useQuery({
    queryKey: ["settings"],
    queryFn: () =>
      api<
        Settings & {
          providers: Array<{
            id: string;
            status: string;
            models: Array<{ id: string; name: string }>;
          }>;
        }
      >("/settings"),
  });
  const save = useMutation({
    mutationFn: (values: Settings) =>
      api<{ saved: true }>("/settings", {
        method: "PUT",
        body: JSON.stringify(values),
      }),
  });
  const values: Settings = query.data
    ? {
        workspaceRoot: query.data.workspaceRoot,
        zedExecutable: query.data.zedExecutable,
        opencodeBaseUrl: query.data.opencodeBaseUrl,
        teacherProvider: query.data.teacherProvider,
        teacherModel: query.data.teacherModel,
        reviewerProvider: query.data.reviewerProvider,
        reviewerModel: query.data.reviewerModel,
        interviewerProvider: query.data.interviewerProvider,
        interviewerModel: query.data.interviewerModel,
        curatorProvider: query.data.curatorProvider,
        curatorModel: query.data.curatorModel,
        codexExpertProvider: query.data.codexExpertProvider,
        codexExpertModel: query.data.codexExpertModel,
        theme: query.data.theme,
      }
    : {
        workspaceRoot: "./workspaces/exercises",
        zedExecutable: "zed",
        opencodeBaseUrl: "http://127.0.0.1:4096",
        teacherProvider: "mock",
        teacherModel: "mock-deterministic",
        reviewerProvider: "mock",
        reviewerModel: "mock-deterministic",
        interviewerProvider: "mock",
        interviewerModel: "mock-deterministic",
        curatorProvider: "mock",
        curatorModel: "mock-deterministic",
        codexExpertProvider: "mock",
        codexExpertModel: "mock-deterministic",
        theme: "system",
      };
  const form = useForm<Settings>({ resolver: zodResolver(schema), values });
  if (query.isLoading) return <Skeleton className="h-96" />;
  if (query.isError || !query.data)
    return (
      <QueryError
        message="Настройки недоступны"
        retry={() => void query.refetch()}
      />
    );
  const fields = [
    {
      name: "workspaceRoot",
      label: "Exercise workspace",
      help: "Путь проверяется на сервере; браузер не управляет cwd процесса.",
    },
    {
      name: "zedExecutable",
      label: "Zed executable",
      help: "Только имя/путь executable. Shell-строка и произвольные аргументы запрещены.",
    },
    {
      name: "opencodeBaseUrl",
      label: "OpenCode server",
      help: "Headless server должен слушать loopback. Пароль читается только из environment.",
    },
  ] as const;
  const roleFields = [
    {
      label: "Teacher",
      provider: "teacherProvider",
      model: "teacherModel",
      help: "Сократический диалог и проверка объяснений.",
    },
    {
      label: "Reviewer",
      provider: "reviewerProvider",
      model: "reviewerModel",
      help: "Всегда получает read-only/deny-write policy.",
    },
    {
      label: "Interviewer",
      provider: "interviewerProvider",
      model: "interviewerModel",
      help: "Один вопрос за раз и отдельная оценка.",
    },
    {
      label: "Curator",
      provider: "curatorProvider",
      model: "curatorModel",
      help: "Итоги, повторение и кандидаты карточек.",
    },
    {
      label: "Codex Expert",
      provider: "codexExpertProvider",
      model: "codexExpertModel",
      help: "Ручной глубокий анализ и архитектурные задачи.",
    },
  ] as const;
  return (
    <form
      className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_340px]"
      onSubmit={form.handleSubmit((values) => save.mutate(values))}
    >
      <div className="divide-y divide-border rounded-xl border border-border bg-card px-5">
        {fields.map((field) => (
          <label
            key={field.name}
            className="grid gap-2 py-5 sm:grid-cols-[220px_1fr]"
          >
            <span className="text-sm font-medium">
              {field.label}
              <span className="mt-1 block text-xs font-normal leading-5 text-muted-foreground">
                {field.help}
              </span>
            </span>
            <span>
              <input
                {...form.register(field.name)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <span className="mt-1 block text-xs text-destructive">
                {form.formState.errors[field.name]?.message}
              </span>
            </span>
          </label>
        ))}
        {roleFields.map((field) => (
          <label
            key={field.label}
            className="grid gap-2 py-5 sm:grid-cols-[220px_1fr]"
          >
            <span className="text-sm font-medium">
              {field.label}
              <span className="mt-1 block text-xs font-normal leading-5 text-muted-foreground">
                {field.help}
              </span>
            </span>
            <span className="grid gap-2 sm:grid-cols-[130px_1fr]">
              <select
                aria-label={`${field.label} provider`}
                {...form.register(field.provider)}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="mock">Mock</option>
                <option value="opencode">OpenCode</option>
                <option value="codex">Codex</option>
              </select>
              <span>
                <input
                  aria-label={`${field.label} model`}
                  {...form.register(field.model)}
                  list="available-agent-models"
                  className="h-10 w-full rounded-md border border-input bg-background px-3 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <span className="mt-1 block text-xs text-destructive">
                  {form.formState.errors[field.model]?.message}
                </span>
              </span>
            </span>
          </label>
        ))}
        <datalist id="available-agent-models">
          {query.data.providers.flatMap((provider) =>
            provider.models.map((model) => (
              <option key={`${provider.id}:${model.id}`} value={model.id}>
                {provider.id} · {model.name}
              </option>
            )),
          )}
        </datalist>
        <label className="grid gap-2 py-5 sm:grid-cols-[220px_1fr]">
          <span className="text-sm font-medium">Тема</span>
          <select
            {...form.register("theme")}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="system">Системная</option>
            <option value="light">Светлая</option>
            <option value="dark">Тёмная</option>
          </select>
        </label>
        <div className="flex items-center justify-end gap-3 py-5">
          <span role="status" className="text-xs text-muted-foreground">
            {save.isSuccess
              ? "Сохранено"
              : save.isError
                ? "Не удалось сохранить"
                : "Секреты здесь не сохраняются"}
          </span>
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? "Сохраняю…" : "Сохранить"}
          </Button>
        </div>
      </div>
      <aside className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5">
        <h3 className="font-semibold">Провайдеры</h3>
        {query.data.providers.map((provider) => (
          <div
            key={provider.id}
            className="flex items-center justify-between gap-3 border-t border-border pt-3"
          >
            <div>
              <p className="text-sm font-medium">{provider.id}</p>
              <p className="font-mono text-xs text-muted-foreground">
                {provider.models.length
                  ? `${provider.models.length} model(s)`
                  : "models unavailable"}
              </p>
            </div>
            <Badge
              variant={
                provider.status === "connected"
                  ? "success"
                  : provider.status === "misconfigured"
                    ? "warning"
                    : "outline"
              }
            >
              {provider.status}
            </Badge>
          </div>
        ))}
      </aside>
    </form>
  );
}
