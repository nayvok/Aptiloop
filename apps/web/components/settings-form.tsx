"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { useTheme } from "next-themes";
import { z } from "zod";

import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { QueryError } from "@/components/query-state";
import { Skeleton } from "@/components/ui/skeleton";

const providerSchema = z.enum(["mock", "opencode", "codex"]);
const schema = z.object({
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
type ProviderStatus = {
  id: string;
  status: string;
  message?: string;
  models: Array<{ id: string; name: string }>;
};
type SettingsQuery = Settings & {
  workspaceRoot: string;
  zedExecutable: string;
  providers: ProviderStatus[];
};

const statusLabels: Record<string, string> = {
  connected: "Подключён",
  unavailable: "Недоступен",
  misconfigured: "Нужна настройка",
  starting: "Запускается",
  error: "Ошибка",
};

export function SettingsForm() {
  const queryClient = useQueryClient();
  const { setTheme } = useTheme();
  const query = useQuery({
    queryKey: ["settings"],
    queryFn: () => api<SettingsQuery>("/settings"),
  });
  const save = useMutation({
    mutationFn: (values: Settings) =>
      api<{ saved: true }>("/settings", {
        method: "PUT",
        body: JSON.stringify(values),
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["settings"] }),
        queryClient.invalidateQueries({ queryKey: ["providers"] }),
      ]);
    },
  });
  const values: Settings = query.data
    ? {
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
  useEffect(() => {
    if (query.data?.theme) setTheme(query.data.theme);
  }, [query.data?.theme, setTheme]);

  if (query.isLoading)
    return (
      <div role="status" aria-label="Загружаю настройки">
        <Skeleton aria-hidden className="h-96" />
        <span className="sr-only">Загружаю настройки…</span>
      </div>
    );
  if (query.isError || !query.data)
    return (
      <QueryError
        message="Настройки недоступны"
        retry={() => void query.refetch()}
      />
    );
  const fields = [
    {
      name: "opencodeBaseUrl",
      label: "OpenCode server",
      help: "Headless server должен слушать loopback. Пароль читается только из environment.",
    },
  ] as const;
  const themeRegistration = form.register("theme");
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
      data-slot="settings-form"
      className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_340px]"
      onSubmit={form.handleSubmit((values) => save.mutate(values))}
    >
      <section
        aria-label="Настройки приложения"
        className="divide-y divide-border rounded-xl border border-border bg-card px-5"
      >
        <div className="grid gap-2 py-5 sm:grid-cols-[220px_1fr]">
          <div className="flex flex-col gap-1">
            <h3 className="text-sm font-medium">Локальные пути</h3>
            <p className="text-xs leading-5 text-muted-foreground">
              Управляются сервером и показаны только для диагностики.
            </p>
          </div>
          <dl className="grid min-w-0 gap-3 text-sm">
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground">
                Exercise workspace
              </dt>
              <dd
                className="truncate font-mono"
                title={query.data.workspaceRoot}
              >
                {query.data.workspaceRoot}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground">Zed executable</dt>
              <dd
                className="truncate font-mono"
                title={query.data.zedExecutable}
              >
                {query.data.zedExecutable}
              </dd>
            </div>
          </dl>
        </div>
        {fields.map((field) => (
          <div
            key={field.name}
            className="grid gap-2 py-5 sm:grid-cols-[220px_1fr]"
          >
            <div className="flex flex-col gap-1">
              <label htmlFor={field.name} className="text-sm font-medium">
                {field.label}
              </label>
              <p
                id={`${field.name}-help`}
                className="text-xs leading-5 text-muted-foreground"
              >
                {field.help}
              </p>
            </div>
            <div className="flex flex-col gap-1">
              <input
                id={field.name}
                {...form.register(field.name)}
                aria-invalid={Boolean(form.formState.errors[field.name])}
                aria-describedby={`${field.name}-help${form.formState.errors[field.name] ? ` ${field.name}-error` : ""}`}
                className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-ring"
              />
              {form.formState.errors[field.name] ? (
                <p
                  id={`${field.name}-error`}
                  className="text-xs text-destructive"
                >
                  {form.formState.errors[field.name]?.message}
                </p>
              ) : null}
            </div>
          </div>
        ))}
        {roleFields.map((field) => {
          const helpId = `${field.provider}-help`;
          const modelError = form.formState.errors[field.model];
          return (
            <fieldset
              key={field.label}
              aria-describedby={helpId}
              className="grid min-w-0 gap-2 py-5 sm:grid-cols-[220px_1fr]"
            >
              <legend className="sr-only">{field.label}</legend>
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium">{field.label}</p>
                <p
                  id={helpId}
                  className="text-xs leading-5 text-muted-foreground"
                >
                  {field.help}
                </p>
              </div>
              <div className="grid min-w-0 gap-3 sm:grid-cols-[130px_1fr]">
                <div className="flex flex-col gap-1">
                  <label
                    htmlFor={field.provider}
                    className="block text-xs text-muted-foreground"
                  >
                    Провайдер
                  </label>
                  <select
                    id={field.provider}
                    {...form.register(field.provider)}
                    className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <option value="mock">Mock</option>
                    <option value="opencode">OpenCode</option>
                    <option value="codex">Codex</option>
                  </select>
                </div>
                <div className="flex min-w-0 flex-col gap-1">
                  <label
                    htmlFor={field.model}
                    className="block text-xs text-muted-foreground"
                  >
                    Модель
                  </label>
                  <input
                    id={field.model}
                    {...form.register(field.model)}
                    list="available-agent-models"
                    aria-invalid={Boolean(modelError)}
                    aria-describedby={
                      modelError ? `${field.model}-error` : undefined
                    }
                    className="h-11 w-full rounded-md border border-input bg-background px-3 font-mono text-sm outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-ring"
                  />
                  {modelError ? (
                    <p
                      id={`${field.model}-error`}
                      className="text-xs text-destructive"
                    >
                      {modelError.message}
                    </p>
                  ) : null}
                </div>
              </div>
            </fieldset>
          );
        })}
        <datalist id="available-agent-models">
          {query.data.providers.flatMap((provider) =>
            provider.models.map((model) => (
              <option key={`${provider.id}:${model.id}`} value={model.id}>
                {provider.id} · {model.name}
              </option>
            )),
          )}
        </datalist>
        <div className="grid gap-2 py-5 sm:grid-cols-[220px_1fr]">
          <div className="flex flex-col gap-1">
            <label htmlFor="theme" className="text-sm font-medium">
              Тема
            </label>
            <p
              id="theme-help"
              className="text-xs leading-5 text-muted-foreground"
            >
              Изменение применяется сразу и сохраняется после отправки формы.
            </p>
          </div>
          <select
            id="theme"
            {...themeRegistration}
            aria-describedby="theme-help"
            onChange={(event) => {
              themeRegistration.onChange(event);
              setTheme(event.target.value);
            }}
            className="h-11 rounded-md border border-input bg-background px-3 text-sm outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="system">Системная</option>
            <option value="light">Светлая</option>
            <option value="dark">Тёмная</option>
          </select>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3 py-5">
          <span
            role="status"
            aria-live="polite"
            className={
              save.isError
                ? "text-xs text-destructive"
                : "text-xs text-muted-foreground"
            }
          >
            {save.isSuccess
              ? "Сохранено"
              : save.isError
                ? "Не удалось сохранить настройки. Повтори попытку."
                : "Секреты здесь не сохраняются"}
          </span>
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? "Сохраняю…" : "Сохранить настройки"}
          </Button>
        </div>
      </section>
      <aside
        data-slot="settings-status"
        className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5 xl:self-start"
      >
        <div className="flex flex-col gap-1">
          <h3 className="font-semibold">Провайдеры</h3>
          <p className="text-xs leading-5 text-muted-foreground">
            Текущий статус локальных адаптеров и доступных моделей.
          </p>
        </div>
        {query.data.providers.map((provider) => (
          <div
            key={provider.id}
            className="flex items-start justify-between gap-3 border-t border-border pt-4"
          >
            <div className="flex min-w-0 flex-col gap-1">
              <p className="text-sm font-medium">{provider.id}</p>
              <p className="font-mono text-xs text-muted-foreground">
                {provider.models.length
                  ? `${provider.models.length} ${provider.models.length === 1 ? "модель" : "моделей"}`
                  : "Модели недоступны"}
              </p>
              {provider.message ? (
                <p className="text-xs leading-5 text-muted-foreground">
                  {provider.message}
                </p>
              ) : null}
            </div>
            <Badge
              variant={
                provider.status === "connected"
                  ? "success"
                  : provider.status === "misconfigured"
                    ? "warning"
                    : provider.status === "error"
                      ? "error"
                      : "outline"
              }
            >
              {statusLabels[provider.status] ?? provider.status}
            </Badge>
          </div>
        ))}
        <div className="border-t border-border pt-4">
          <Button asChild variant="outline" className="w-full">
            <Link href="/settings/developer-tools">
              Инструменты разработчика
            </Link>
          </Button>
        </div>
      </aside>
    </form>
  );
}
