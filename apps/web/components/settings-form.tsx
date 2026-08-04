"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useForm, type UseFormReturn } from "react-hook-form";
import { useTheme } from "next-themes";
import { z } from "zod";

import { ApiError, api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { QueryError } from "@/components/query-state";
import { Skeleton } from "@/components/ui/skeleton";

const providerSchema = z.enum(["mock", "opencode", "codex"]);
const baseSchema = z.object({
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
type Settings = z.infer<typeof baseSchema>;
type ProviderStatus = {
  id: z.infer<typeof providerSchema>;
  status: string;
  message?: string;
  models: Array<{ id: string; name: string; available?: boolean }>;
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

const providerNames: Record<string, string> = {
  mock: "Mock",
  opencode: "OpenCode",
  codex: "Codex",
};

const roleSelections = [
  ["teacherProvider", "teacherModel"],
  ["reviewerProvider", "reviewerModel"],
  ["interviewerProvider", "interviewerModel"],
  ["curatorProvider", "curatorModel"],
  ["codexExpertProvider", "codexExpertModel"],
] as const;

function settingsSchema(providers: ProviderStatus[]) {
  return baseSchema.superRefine((values, context) => {
    for (const [providerField, modelField] of roleSelections) {
      const provider = providers.find(
        (candidate) => candidate.id === values[providerField],
      );
      const models =
        provider?.models.filter((model) => model.available !== false) ?? [];
      if (!models.some((model) => model.id === values[modelField])) {
        context.addIssue({
          code: "custom",
          path: [modelField],
          message: provider
            ? `Модель недоступна у провайдера ${provider.id}`
            : "Провайдер недоступен",
        });
      }
    }
  });
}

type RoleMeta = {
  group: string;
  label: string;
  provider: (typeof roleSelections)[number][0];
  model: (typeof roleSelections)[number][1];
  help: string;
};

const roleMeta: RoleMeta[] = [
  {
    group: "Teacher",
    label: "Преподаватель",
    provider: "teacherProvider",
    model: "teacherModel",
    help: "Сократический диалог и проверка объяснений.",
  },
  {
    group: "Reviewer",
    label: "Проверка решения",
    provider: "reviewerProvider",
    model: "reviewerModel",
    help: "Всегда получает read-only/deny-write policy.",
  },
  {
    group: "Interviewer",
    label: "Интервьюер",
    provider: "interviewerProvider",
    model: "interviewerModel",
    help: "Один вопрос за раз и отдельная оценка.",
  },
  {
    group: "Curator",
    label: "Итоги и повторение",
    provider: "curatorProvider",
    model: "curatorModel",
    help: "Итоги, повторение и кандидаты карточек.",
  },
  {
    group: "Codex Expert",
    label: "Эксперт",
    provider: "codexExpertProvider",
    model: "codexExpertModel",
    help: "Ручной глубокий анализ и архитектурные задачи.",
  },
];

type ProfileId = "economical" | "balanced" | "accuracy";

const profilePlans: Record<
  ProfileId,
  Array<{
    provider: (typeof roleSelections)[number][0];
    model: (typeof roleSelections)[number][1];
    providerId: "opencode" | "codex";
  }>
> = {
  economical: [
    {
      provider: "teacherProvider",
      model: "teacherModel",
      providerId: "opencode",
    },
    {
      provider: "reviewerProvider",
      model: "reviewerModel",
      providerId: "opencode",
    },
    {
      provider: "interviewerProvider",
      model: "interviewerModel",
      providerId: "opencode",
    },
    {
      provider: "curatorProvider",
      model: "curatorModel",
      providerId: "opencode",
    },
    {
      provider: "codexExpertProvider",
      model: "codexExpertModel",
      providerId: "codex",
    },
  ],
  balanced: [
    {
      provider: "teacherProvider",
      model: "teacherModel",
      providerId: "opencode",
    },
    {
      provider: "reviewerProvider",
      model: "reviewerModel",
      providerId: "opencode",
    },
    {
      provider: "interviewerProvider",
      model: "interviewerModel",
      providerId: "opencode",
    },
    {
      provider: "curatorProvider",
      model: "curatorModel",
      providerId: "opencode",
    },
    {
      provider: "codexExpertProvider",
      model: "codexExpertModel",
      providerId: "codex",
    },
  ],
  accuracy: [
    {
      provider: "teacherProvider",
      model: "teacherModel",
      providerId: "opencode",
    },
    {
      provider: "reviewerProvider",
      model: "reviewerModel",
      providerId: "codex",
    },
    {
      provider: "interviewerProvider",
      model: "interviewerModel",
      providerId: "codex",
    },
    { provider: "curatorProvider", model: "curatorModel", providerId: "codex" },
    {
      provider: "codexExpertProvider",
      model: "codexExpertModel",
      providerId: "codex",
    },
  ],
};

const profiles: Array<{
  id: ProfileId;
  title: string;
  description: string;
  caption?: string;
  warning?: string;
}> = [
  {
    id: "economical",
    title: "Экономный",
    description:
      "Повседневные роли — OpenCode, Эксперт — Codex. Минимальный расход лимитов Codex.",
  },
  {
    id: "balanced",
    title: "Сбалансированный",
    description:
      "Преподаватель, проверка, интервью и итоги — OpenCode; Эксперт — Codex.",
    caption:
      "Сложная проверка решения и экспертная помощь — Codex по ручной эскалации.",
  },
  {
    id: "accuracy",
    title: "Максимальная точность",
    description:
      "Проверка, интервью, итоги и Эксперт — Codex; преподаватель — OpenCode.",
    warning: "Повышенный расход лимитов Codex.",
  },
];

const fieldClass =
  "h-11 w-full rounded-md border border-input bg-background px-3 text-sm outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-ring";
const sectionClass =
  "min-w-0 rounded-xl border border-border bg-card p-5 sm:p-6";
const sectionTitleClass = "font-semibold";

function firstAvailableModel(
  providers: ProviderStatus[],
  providerId: string,
): string | null {
  return (
    providers
      .find((provider) => provider.id === providerId)
      ?.models.find((model) => model.available !== false)?.id ?? null
  );
}

function RoleSelects({
  meta,
  providers,
  form,
}: {
  meta: RoleMeta;
  providers: ProviderStatus[];
  form: UseFormReturn<Settings>;
}) {
  const helpId = `${meta.provider}-help`;
  const modelError = form.formState.errors[meta.model];
  const selectedProvider = form.watch(meta.provider);
  const selectedModel = form.watch(meta.model);
  const availableModels =
    providers
      .find((provider) => provider.id === selectedProvider)
      ?.models.filter((model) => model.available !== false) ?? [];
  const hasSelectedModel = availableModels.some(
    (model) => model.id === selectedModel,
  );
  const providerRegistration = form.register(meta.provider);
  return (
    <fieldset
      aria-describedby={helpId}
      className="grid min-w-0 gap-2 sm:grid-cols-[220px_1fr]"
    >
      <legend className="sr-only">{meta.label}</legend>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">{meta.label}</p>
        <p id={helpId} className="text-xs leading-5 text-muted-foreground">
          {meta.help}
        </p>
      </div>
      <div className="grid min-w-0 gap-3 sm:grid-cols-[130px_1fr]">
        <div className="flex flex-col gap-1">
          <label
            htmlFor={meta.provider}
            className="block text-xs text-muted-foreground"
          >
            Провайдер
          </label>
          <select
            id={meta.provider}
            {...providerRegistration}
            onChange={(event) => {
              void providerRegistration.onChange(event);
              const provider = providers.find(
                (candidate) => candidate.id === event.target.value,
              );
              const firstModel = provider?.models.find(
                (model) => model.available !== false,
              );
              form.setValue(meta.model, firstModel?.id ?? "", {
                shouldDirty: true,
                shouldTouch: true,
                shouldValidate: true,
              });
            }}
            className={fieldClass}
          >
            <option value="mock">Mock</option>
            <option value="opencode">OpenCode</option>
            <option value="codex">Codex</option>
          </select>
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <label
            htmlFor={meta.model}
            className="block text-xs text-muted-foreground"
          >
            Модель
          </label>
          <select
            id={meta.model}
            {...form.register(meta.model)}
            aria-invalid={Boolean(modelError)}
            aria-describedby={modelError ? `${meta.model}-error` : undefined}
            className={`${fieldClass} font-mono`}
          >
            {!hasSelectedModel && selectedModel ? (
              <option value={selectedModel} disabled>
                {selectedModel} · недоступна
              </option>
            ) : null}
            {availableModels.length === 0 ? (
              <option value="">Нет доступных моделей</option>
            ) : null}
            {availableModels.map((model) => (
              <option key={model.id} value={model.id}>
                {model.name}
              </option>
            ))}
          </select>
          {modelError ? (
            <p id={`${meta.model}-error`} className="text-xs text-destructive">
              {modelError.message}
            </p>
          ) : null}
        </div>
      </div>
    </fieldset>
  );
}

export function SettingsForm() {
  const queryClient = useQueryClient();
  const { setTheme } = useTheme();
  const [profile, setProfile] = useState<ProfileId>("balanced");
  const [profileNote, setProfileNote] = useState<string | null>(null);
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
  const validationSchema = useMemo(
    () => settingsSchema(query.data?.providers ?? []),
    [query.data?.providers],
  );
  const form = useForm<Settings>({
    resolver: zodResolver(validationSchema),
    values,
    mode: "onChange",
  });

  function applyProfile(profileId: ProfileId) {
    const skipped: string[] = [];
    for (const step of profilePlans[profileId]) {
      const modelId = firstAvailableModel(
        query.data?.providers ?? [],
        step.providerId,
      );
      if (!modelId) {
        const meta = roleMeta.find(
          (candidate) => candidate.provider === step.provider,
        );
        skipped.push(
          meta
            ? `${meta.label} → ${providerNames[step.providerId] ?? step.providerId}`
            : (providerNames[step.providerId] ?? step.providerId),
        );
        continue;
      }
      form.setValue(step.provider, step.providerId, {
        shouldDirty: true,
        shouldTouch: true,
        shouldValidate: true,
      });
      form.setValue(step.model, modelId, {
        shouldDirty: true,
        shouldTouch: true,
        shouldValidate: true,
      });
    }
    setProfileNote(
      skipped.length > 0
        ? `Профиль применён частично: ${skipped.join(", ")} — доступных моделей нет, роли оставлены без изменений.`
        : null,
    );
  }

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

  const themeRegistration = form.register("theme");
  const connectionProviders = query.data.providers.filter(
    (provider) => provider.id === "opencode" || provider.id === "codex",
  );
  const connectedCount = connectionProviders.filter(
    (provider) => provider.status === "connected",
  ).length;
  let healthText: string;
  let healthVariant: "success" | "warning" | "error" | "outline";
  if (connectionProviders.length === 0) {
    healthText = "Адаптеры ещё не зарегистрированы сервером.";
    healthVariant = "outline";
  } else if (connectedCount === connectionProviders.length) {
    healthText = "Все локальные подключения работают.";
    healthVariant = "success";
  } else if (connectedCount > 0) {
    healthText = `${connectedCount} из ${connectionProviders.length} подключено.`;
    healthVariant = "warning";
  } else {
    healthText = "Подключения недоступны — проверьте настройки и процессы.";
    healthVariant = "error";
  }
  const diagnostics = connectionProviders
    .filter((provider) => provider.status !== "connected")
    .map(
      (provider) =>
        `${providerNames[provider.id] ?? provider.id}: ${
          provider.message ?? statusLabels[provider.status] ?? provider.status
        }`,
    );

  return (
    <form
      data-slot="settings-form"
      className="grid gap-6"
      onSubmit={form.handleSubmit((submitted) => save.mutate(submitted))}
    >
      <section
        aria-labelledby="settings-general-title"
        className={sectionClass}
      >
        <div className="mb-5">
          <h3 id="settings-general-title" className={sectionTitleClass}>
            Основные
          </h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Тема интерфейса и локальные пути, которыми управляет сервер.
          </p>
        </div>
        <div className="grid gap-5">
          <div className="grid gap-2 sm:grid-cols-[220px_1fr]">
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
              className={`${fieldClass} max-w-xs`}
            >
              <option value="system">Системная</option>
              <option value="light">Светлая</option>
              <option value="dark">Тёмная</option>
            </select>
          </div>
          <div className="grid gap-2 sm:grid-cols-[220px_1fr]">
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium">Локальные пути</p>
              <p className="text-xs leading-5 text-muted-foreground">
                Управляются сервером и показаны только для диагностики.
              </p>
            </div>
            <dl className="grid min-w-0 gap-3 text-sm">
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
                  Zed executable
                </dt>
                <dd
                  className="mt-1 truncate font-mono"
                  title={query.data.zedExecutable}
                >
                  {query.data.zedExecutable}
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </section>

      <section aria-labelledby="settings-ai-title" className={sectionClass}>
        <div className="mb-5">
          <h3 id="settings-ai-title" className={sectionTitleClass}>
            AI для обучения
          </h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Роли, которые ведут занятие, и профили подбора моделей.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {roleMeta.map((meta) => {
            const selectedProvider = form.watch(meta.provider);
            const selectedModel = form.watch(meta.model);
            return (
              <div
                key={meta.group}
                className="rounded-lg border border-border bg-background p-4"
              >
                <p className="text-sm font-medium">{meta.label}</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {meta.help}
                </p>
                <p
                  className="mt-2 truncate font-mono text-xs text-foreground/80"
                  title={`${selectedProvider}/${selectedModel}`}
                >
                  {providerNames[selectedProvider] ?? selectedProvider} ·{" "}
                  {selectedModel}
                </p>
              </div>
            );
          })}
        </div>

        <div className="mt-6">
          <p className="text-sm font-medium">Профиль подбора</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Профиль заполняет роли доступными моделями. Ручной выбор — в
            расширенных настройках ниже.
          </p>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            {profiles.map((option) => (
              <label
                key={option.id}
                className="grid cursor-pointer gap-2 rounded-xl border border-border bg-background p-4 transition-colors has-[:checked]:border-primary has-[:checked]:bg-primary/5"
              >
                <span className="flex items-center gap-2 text-sm font-medium">
                  <input
                    type="radio"
                    name="ai-profile"
                    value={option.id}
                    checked={profile === option.id}
                    onChange={() => {
                      setProfile(option.id);
                      applyProfile(option.id);
                    }}
                    className="size-4 accent-primary"
                  />
                  {option.title}
                </span>
                <span className="text-xs leading-5 text-muted-foreground">
                  {option.description}
                </span>
                {option.caption ? (
                  <span className="text-xs leading-5 text-muted-foreground">
                    {option.caption}
                  </span>
                ) : null}
                {option.warning ? (
                  <span className="text-xs font-medium leading-5 text-warning-foreground">
                    {option.warning}
                  </span>
                ) : null}
              </label>
            ))}
          </div>
          {profileNote ? (
            <p role="status" className="mt-3 text-xs text-muted-foreground">
              {profileNote}
            </p>
          ) : null}
        </div>

        <details className="mt-6 rounded-lg border border-border bg-background p-4">
          <summary className="cursor-pointer text-sm font-medium">
            Расширенные настройки
          </summary>
          <div className="mt-5 grid gap-5">
            {roleMeta.map((meta) => (
              <RoleSelects
                key={meta.group}
                meta={meta}
                providers={query.data.providers}
                form={form}
              />
            ))}
          </div>
        </details>
      </section>

      <section
        aria-labelledby="settings-connections-title"
        className={sectionClass}
      >
        <div className="mb-5">
          <h3 id="settings-connections-title" className={sectionTitleClass}>
            Подключения
          </h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Локальные адаптеры, health check и доступные модели.
          </p>
        </div>
        <div className="grid gap-5">
          <div className="grid gap-2 sm:grid-cols-[220px_1fr]">
            <div className="flex flex-col gap-1">
              <label htmlFor="opencodeBaseUrl" className="text-sm font-medium">
                OpenCode server
              </label>
              <p
                id="opencodeBaseUrl-help"
                className="text-xs leading-5 text-muted-foreground"
              >
                Headless server должен слушать loopback. Пароль читается только
                из environment.
              </p>
            </div>
            <div className="flex flex-col gap-1">
              <input
                id="opencodeBaseUrl"
                {...form.register("opencodeBaseUrl")}
                aria-invalid={Boolean(form.formState.errors.opencodeBaseUrl)}
                aria-describedby={`opencodeBaseUrl-help${
                  form.formState.errors.opencodeBaseUrl
                    ? " opencodeBaseUrl-error"
                    : ""
                }`}
                className={fieldClass}
              />
              {form.formState.errors.opencodeBaseUrl ? (
                <p
                  id="opencodeBaseUrl-error"
                  className="text-xs text-destructive"
                >
                  {form.formState.errors.opencodeBaseUrl.message}
                </p>
              ) : null}
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            {(["opencode", "codex"] as const).map((id) => {
              const provider = query.data.providers.find(
                (candidate) => candidate.id === id,
              );
              const label = provider
                ? (statusLabels[provider.status] ?? provider.status)
                : "Недоступен";
              const variant = provider
                ? provider.status === "connected"
                  ? "success"
                  : provider.status === "misconfigured"
                    ? "warning"
                    : provider.status === "error"
                      ? "error"
                      : "outline"
                : "outline";
              return (
                <div
                  key={id}
                  className="rounded-lg border border-border bg-background p-4"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium">{providerNames[id]}</p>
                    <Badge variant={variant}>{label}</Badge>
                  </div>
                  <p className="mt-1 font-mono text-xs text-muted-foreground">
                    {provider
                      ? provider.models.length
                        ? `${provider.models.length} ${
                            provider.models.length === 1
                              ? "модель"
                              : provider.models.length < 5
                                ? "модели"
                                : "моделей"
                          }`
                        : "Модели недоступны"
                      : "Провайдер не зарегистрирован"}
                  </p>
                  {provider?.message ? (
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      {provider.message}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/20 p-4">
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium">Health check</p>
              <p className="text-xs leading-5 text-muted-foreground">
                {healthText}
              </p>
            </div>
            <Badge variant={healthVariant}>
              {connectedCount === connectionProviders.length &&
              connectionProviders.length > 0
                ? "Работает"
                : connectedCount > 0
                  ? "Частично"
                  : connectionProviders.length > 0
                    ? "Недоступно"
                    : "Нет данных"}
            </Badge>
          </div>

          {diagnostics.length > 0 ? (
            <ul className="grid gap-1 text-xs leading-5 text-muted-foreground">
              {diagnostics.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-background p-4">
            <div className="min-w-0">
              <p className="text-sm font-medium">Полная диагностика</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                Endpoint, список моделей, lifecycle процессов и события
                провайдеров.
              </p>
            </div>
            <Button asChild variant="outline">
              <Link href="/settings/developer-tools">
                Инструменты разработчика
              </Link>
            </Button>
          </div>
        </div>
      </section>

      <section aria-labelledby="settings-dev-title" className={sectionClass}>
        <div className="mb-4">
          <h3 id="settings-dev-title" className={sectionTitleClass}>
            Для разработчика
          </h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Диагностика и ручные инструменты — вне основного учебного маршрута.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-background p-4">
          <div className="min-w-0">
            <p className="text-sm font-medium">Инструменты разработчика</p>
            <ul className="mt-1 list-inside list-disc text-xs leading-5 text-muted-foreground">
              <li>Endpoint и список моделей</li>
              <li>Lifecycle процессов</li>
              <li>Agent Playground и события провайдеров</li>
            </ul>
          </div>
          <Button asChild variant="outline">
            <Link href="/settings/developer-tools">Открыть</Link>
          </Button>
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-end gap-3">
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
              ? save.error instanceof ApiError
                ? save.error.message
                : "Не удалось сохранить настройки. Повтори попытку."
              : "Секреты здесь не сохраняются"}
        </span>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? "Сохраняю…" : "Сохранить настройки"}
        </Button>
      </div>
    </form>
  );
}
