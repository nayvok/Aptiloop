"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError, api } from "@/lib/api";
import { type MessageKey, useI18n } from "@/lib/i18n";

export interface ProviderConnectionSummary {
  connectionId: string;
  displayName: string;
  enabled: boolean;
  external: boolean;
  state: string;
  observedCapabilities: {
    models: Array<{ modelId: string; available: boolean }>;
  } | null;
}

interface ProviderCatalogEntry {
  id: string;
  providerType: string;
  displayName: string;
  authKind: "api-key" | "subscription" | "local";
  external: boolean;
  credentialLabel?: string;
  defaultBaseUrl?: string;
  endpointKind?: "external" | "loopback";
  recommendation?: "overall" | "free" | "private";
}

interface ManagedConnectionMetadata {
  connectionId: string;
  catalogId: string;
  authKind: ProviderCatalogEntry["authKind"];
  credentialConfigured: boolean;
  baseUrl: string | null;
  modelIds: string[];
}

export interface ProviderManagementSettings {
  catalog: ProviderCatalogEntry[];
  connections: ManagedConnectionMetadata[];
}

interface LoginStatus {
  operationId: string;
  connectionId: string;
  status: "running" | "completed" | "failed" | "cancelled";
  events: Array<
    | {
        type: "info";
        message: string;
        links?: Array<{ url: string; label?: string }>;
      }
    | { type: "auth_url"; url: string; instructions?: string }
    | {
        type: "device_code";
        userCode: string;
        verificationUri: string;
      }
    | { type: "progress"; message: string }
  >;
  prompt: {
    promptId: string;
    type: "text" | "secret" | "select" | "manual_code";
    message: string;
    placeholder: string | null;
    options: Array<{ id: string; label: string; description?: string }>;
  } | null;
  error: string | null;
}

const statusLabels: Readonly<Record<string, MessageKey>> = {
  disabled: "settings.status.off",
  starting: "settings.status.starting",
  connected: "settings.status.connected",
  degraded: "settings.status.degraded",
  "authentication-required": "settings.status.authentication",
  unavailable: "settings.status.unavailable",
  misconfigured: "settings.status.misconfigured",
  error: "settings.status.error",
};

export function ProviderConnectionManager({
  connections,
  management,
}: {
  connections: ProviderConnectionSummary[];
  management: ProviderManagementSettings;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [catalogId, setCatalogId] = useState(
    management.catalog[0]?.id ?? "openai-api",
  );
  const selectedCatalog =
    management.catalog.find((entry) => entry.id === catalogId) ??
    management.catalog[0];
  const [displayName, setDisplayName] = useState(
    selectedCatalog?.displayName ?? "",
  );
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(selectedCatalog?.defaultBaseUrl ?? "");
  const [modelIds, setModelIds] = useState("");
  const [credentialEditor, setCredentialEditor] = useState<string | null>(null);
  const [replacementKey, setReplacementKey] = useState("");
  const [loginOperationId, setLoginOperationId] = useState<string | null>(null);
  const [loginConnectionId, setLoginConnectionId] = useState<string | null>(
    null,
  );
  const [promptAnswer, setPromptAnswer] = useState("");
  const metadataByConnection = useMemo(
    () =>
      new Map(
        management.connections.map((connection) => [
          connection.connectionId,
          connection,
        ]),
      ),
    [management.connections],
  );

  const refreshSettings = () =>
    queryClient.invalidateQueries({ queryKey: ["settings"] });
  const createConnection = useMutation({
    mutationFn: () =>
      api<{ created: true }>("/settings/ai/connections", {
        method: "POST",
        body: JSON.stringify({
          catalogId: selectedCatalog?.id,
          displayName,
          ...(selectedCatalog?.authKind === "api-key" ? { apiKey } : {}),
          ...(selectedCatalog?.endpointKind
            ? {
                baseUrl,
                modelIds: modelIds
                  .split(/[\n,]/u)
                  .map((value) => value.trim())
                  .filter(Boolean),
              }
            : {}),
        }),
      }),
    onSuccess: async () => {
      setAdding(false);
      setApiKey("");
      setModelIds("");
      await refreshSettings();
    },
  });
  const setCredential = useMutation({
    mutationFn: (connectionId: string) =>
      api<{ saved: true }>(
        `/settings/ai/connections/${encodeURIComponent(connectionId)}/credential`,
        {
          method: "PUT",
          body: JSON.stringify({ apiKey: replacementKey }),
        },
      ),
    onSuccess: async () => {
      setCredentialEditor(null);
      setReplacementKey("");
      await refreshSettings();
    },
  });
  const disableConnection = useMutation({
    mutationFn: (connectionId: string) =>
      api<{ disabled: true }>(
        `/settings/ai/connections/${encodeURIComponent(connectionId)}/disable`,
        { method: "POST", body: "{}" },
      ),
    onSuccess: refreshSettings,
  });
  const enableLocal = useMutation({
    mutationFn: (connectionId: string) =>
      api<{ enabled: true }>(
        `/settings/ai/connections/${encodeURIComponent(connectionId)}/enable`,
        { method: "POST", body: "{}" },
      ),
    onSuccess: refreshSettings,
  });
  const startLogin = useMutation({
    mutationFn: (connectionId: string) =>
      api<{ started: true; operationId: string }>(
        `/settings/ai/connections/${encodeURIComponent(connectionId)}/login`,
        { method: "POST", body: "{}" },
      ),
    onSuccess: (result, connectionId) => {
      setLoginConnectionId(connectionId);
      setLoginOperationId(result.operationId);
    },
  });
  const loginQuery = useQuery({
    queryKey: ["provider-login", loginOperationId],
    enabled: loginOperationId !== null,
    queryFn: () =>
      api<LoginStatus>(
        `/settings/ai/login/${encodeURIComponent(loginOperationId!)}`,
      ),
    refetchInterval: (query) =>
      query.state.data?.status === "running" ? 750 : false,
  });
  const answerLogin = useMutation({
    mutationFn: (prompt: NonNullable<LoginStatus["prompt"]>) =>
      api<{ accepted: true }>(
        `/settings/ai/login/${encodeURIComponent(loginOperationId!)}/answer`,
        {
          method: "POST",
          body: JSON.stringify({
            promptId: prompt.promptId,
            answer: promptAnswer,
          }),
        },
      ),
    onSuccess: async () => {
      setPromptAnswer("");
      await loginQuery.refetch();
    },
  });
  const cancelLogin = useMutation({
    mutationFn: () =>
      api<{ cancelled: true }>(
        `/settings/ai/login/${encodeURIComponent(loginOperationId!)}/cancel`,
        { method: "POST", body: "{}" },
      ),
    onSuccess: async () => {
      await loginQuery.refetch();
    },
  });

  useEffect(() => {
    if (loginQuery.data?.status !== "completed") return;
    void refreshSettings();
  }, [loginQuery.data?.status]);

  const mutationError =
    createConnection.error ??
    setCredential.error ??
    disableConnection.error ??
    enableLocal.error ??
    startLogin.error ??
    answerLogin.error ??
    cancelLogin.error;

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="settings-connections-title" className="font-semibold">
            {t("settings.section.connections")}
          </h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {t("settings.section.connectionsDescription")}
          </p>
        </div>
        <Button
          type="button"
          variant={adding ? "ghost" : "default"}
          onClick={() => setAdding((current) => !current)}
        >
          {t(
            adding
              ? "settings.connection.cancelAdd"
              : "settings.connection.add",
          )}
        </Button>
      </div>

      {adding && selectedCatalog ? (
        <div className="grid gap-4 rounded-lg border border-border bg-muted/15 p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1.5 text-sm font-medium">
              {t("settings.connection.provider")}
              <select
                value={catalogId}
                onChange={(event) => {
                  const next = management.catalog.find(
                    (entry) => entry.id === event.target.value,
                  );
                  setCatalogId(event.target.value);
                  setDisplayName(next?.displayName ?? "");
                  setBaseUrl(next?.defaultBaseUrl ?? "");
                  setApiKey("");
                  setModelIds("");
                }}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {management.catalog.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              {t("settings.connection.name")}
              <Input
                value={displayName}
                maxLength={200}
                onChange={(event) => setDisplayName(event.target.value)}
              />
            </label>
          </div>
          {selectedCatalog.recommendation ? (
            <p className="text-sm font-medium text-foreground">
              {t(
                selectedCatalog.recommendation === "overall"
                  ? "settings.connection.recommendation.overall"
                  : selectedCatalog.recommendation === "free"
                    ? "settings.connection.recommendation.free"
                    : "settings.connection.recommendation.private",
              )}
            </p>
          ) : null}
          {selectedCatalog.authKind === "api-key" ? (
            <label className="grid gap-1.5 text-sm font-medium">
              {t("settings.connection.apiKey", {
                label: selectedCatalog.credentialLabel ?? "API key",
              })}
              <Input
                type="password"
                autoComplete="off"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
              />
              <span className="text-xs font-normal text-muted-foreground">
                {t("settings.connection.secretHelp")}
              </span>
            </label>
          ) : null}
          {selectedCatalog.authKind === "subscription" ? (
            <p className="text-sm text-muted-foreground">
              {t("settings.connection.subscriptionHelp")}
            </p>
          ) : null}
          {selectedCatalog.endpointKind ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-1.5 text-sm font-medium">
                {t(
                  selectedCatalog.endpointKind === "loopback"
                    ? "settings.connection.baseUrl"
                    : "settings.connection.externalBaseUrl",
                )}
                <Input
                  value={baseUrl}
                  onChange={(event) => setBaseUrl(event.target.value)}
                />
                <span className="text-xs font-normal text-muted-foreground">
                  {t(
                    selectedCatalog.endpointKind === "loopback"
                      ? "settings.connection.loopbackOnly"
                      : "settings.connection.publicHttpsOnly",
                  )}
                </span>
              </label>
              <label className="grid gap-1.5 text-sm font-medium">
                {t("settings.connection.modelIds")}
                <Input
                  value={modelIds}
                  placeholder="llama3.2, qwen2.5-coder"
                  onChange={(event) => setModelIds(event.target.value)}
                />
              </label>
            </div>
          ) : null}
          <div className="flex items-center justify-end gap-3">
            <span
              role="status"
              aria-live="polite"
              className="text-xs text-destructive"
            >
              {createConnection.isError
                ? apiErrorMessage(
                    createConnection.error,
                    t("settings.connection.addError"),
                  )
                : ""}
            </span>
            <Button
              type="button"
              disabled={
                createConnection.isPending ||
                !displayName.trim() ||
                (selectedCatalog.authKind === "api-key" && apiKey.length < 8) ||
                (selectedCatalog.endpointKind !== undefined &&
                  (!baseUrl.trim() || !modelIds.trim()))
              }
              onClick={() => createConnection.mutate()}
            >
              {t(
                createConnection.isPending
                  ? "settings.connection.adding"
                  : "settings.connection.addConfirm",
              )}
            </Button>
          </div>
        </div>
      ) : null}

      <ul className="grid gap-3 md:grid-cols-2">
        {connections.map((connection) => {
          const metadata = metadataByConnection.get(connection.connectionId);
          const isActiveLogin = loginConnectionId === connection.connectionId;
          return (
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
                  {statusLabels[connection.state]
                    ? t(statusLabels[connection.state]!)
                    : connection.state}
                </Badge>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {t(
                  connection.external
                    ? "settings.external"
                    : "settings.localDevelopment",
                )}{" "}
                ·{" "}
                {t("settings.models", {
                  count: connection.observedCapabilities?.models.length ?? 0,
                })}
              </p>
              {metadata?.baseUrl ? (
                <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
                  {metadata.baseUrl}
                </p>
              ) : null}
              <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
                {connection.connectionId}
              </p>

              {metadata ? (
                <div className="mt-4 grid gap-3 border-t border-border pt-3">
                  {credentialEditor === connection.connectionId ? (
                    <div className="flex gap-2">
                      <Input
                        aria-label={t("settings.connection.newApiKey")}
                        type="password"
                        autoComplete="off"
                        value={replacementKey}
                        onChange={(event) =>
                          setReplacementKey(event.target.value)
                        }
                      />
                      <Button
                        type="button"
                        size="sm"
                        disabled={
                          replacementKey.length < 8 || setCredential.isPending
                        }
                        onClick={() =>
                          setCredential.mutate(connection.connectionId)
                        }
                      >
                        {t("settings.connection.saveKey")}
                      </Button>
                    </div>
                  ) : null}
                  <div className="flex flex-wrap justify-end gap-2">
                    {metadata.authKind === "api-key" ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setCredentialEditor(connection.connectionId);
                          setReplacementKey("");
                        }}
                      >
                        {t(
                          metadata.credentialConfigured
                            ? "settings.connection.replaceKey"
                            : "settings.connection.setKey",
                        )}
                      </Button>
                    ) : null}
                    {metadata.authKind === "subscription" ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={startLogin.isPending}
                        onClick={() =>
                          startLogin.mutate(connection.connectionId)
                        }
                      >
                        {t("settings.connection.signIn")}
                      </Button>
                    ) : null}
                    {metadata.authKind === "local" && !connection.enabled ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          enableLocal.mutate(connection.connectionId)
                        }
                      >
                        {t("settings.connection.enable")}
                      </Button>
                    ) : null}
                    {connection.enabled ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={disableConnection.isPending}
                        onClick={() =>
                          disableConnection.mutate(connection.connectionId)
                        }
                      >
                        {t("settings.connection.disable")}
                      </Button>
                    ) : null}
                  </div>
                  {isActiveLogin ? (
                    <LoginPanel
                      status={loginQuery.data}
                      isLoading={loginQuery.isLoading}
                      answer={promptAnswer}
                      setAnswer={setPromptAnswer}
                      onAnswer={(prompt) => answerLogin.mutate(prompt)}
                      onCancel={() => cancelLogin.mutate()}
                    />
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      {mutationError && !createConnection.isError ? (
        <Alert variant="destructive">
          <AlertTitle>{t("settings.connection.actionError")}</AlertTitle>
          <AlertDescription>
            {apiErrorMessage(
              mutationError,
              t("settings.connection.actionError"),
            )}
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

function LoginPanel({
  status,
  isLoading,
  answer,
  setAnswer,
  onAnswer,
  onCancel,
}: {
  status: LoginStatus | undefined;
  isLoading: boolean;
  answer: string;
  setAnswer: (value: string) => void;
  onAnswer: (prompt: NonNullable<LoginStatus["prompt"]>) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  if (isLoading && !status) {
    return (
      <p className="text-xs text-muted-foreground">
        {t("settings.connection.signingIn")}
      </p>
    );
  }
  if (!status) return null;
  return (
    <div className="grid gap-3 rounded-md bg-muted/30 p-3 text-sm">
      {status.events.map((event, index) => {
        if (event.type === "auth_url") {
          return (
            <p key={`${event.type}:${index}`}>
              {event.instructions ? `${event.instructions} ` : ""}
              <a
                className="font-medium text-primary underline underline-offset-4"
                href={event.url}
                target="_blank"
                rel="noreferrer"
              >
                {t("settings.connection.openSignIn")}
              </a>
            </p>
          );
        }
        if (event.type === "device_code") {
          return (
            <p key={`${event.type}:${index}`}>
              {t("settings.connection.deviceCode", { code: event.userCode })}{" "}
              <a
                className="font-medium text-primary underline underline-offset-4"
                href={event.verificationUri}
                target="_blank"
                rel="noreferrer"
              >
                {t("settings.connection.openSignIn")}
              </a>
            </p>
          );
        }
        return <p key={`${event.type}:${index}`}>{event.message}</p>;
      })}
      {status.prompt ? (
        <div className="grid gap-2">
          <label className="grid gap-1.5 font-medium">
            {status.prompt.message}
            {status.prompt.type === "select" ? (
              <select
                value={answer}
                onChange={(event) => setAnswer(event.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">
                  {t("settings.connection.chooseOption")}
                </option>
                {status.prompt.options.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : (
              <Input
                type={status.prompt.type === "secret" ? "password" : "text"}
                autoComplete="off"
                placeholder={status.prompt.placeholder ?? undefined}
                value={answer}
                onChange={(event) => setAnswer(event.target.value)}
              />
            )}
          </label>
          <Button
            type="button"
            size="sm"
            disabled={!answer}
            onClick={() => onAnswer(status.prompt!)}
          >
            {t("settings.connection.continue")}
          </Button>
        </div>
      ) : null}
      {status.status === "completed" ? (
        <p role="status" className="font-medium text-success">
          {t("settings.connection.signInComplete")}
        </p>
      ) : null}
      {status.status === "failed" ? (
        <p role="alert" className="text-destructive">
          {status.error ?? t("settings.connection.signInFailed")}
        </p>
      ) : null}
      {status.status === "running" ? (
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          {t("settings.connection.cancelSignIn")}
        </Button>
      ) : null}
    </div>
  );
}

function apiErrorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}
