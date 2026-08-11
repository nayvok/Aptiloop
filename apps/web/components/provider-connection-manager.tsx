"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, api } from "@/lib/api";
import { type MessageKey, useI18n } from "@/lib/i18n";

export interface ProviderConnectionSummary {
  connectionId: string;
  displayName: string;
  enabled: boolean;
  external: boolean;
  state: string;
  providerType?: string;
  lastCheckedAt?: string | null;
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
  const { formatDate, t } = useI18n();
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
  const [disableTarget, setDisableTarget] = useState<string | null>(null);
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
  const catalogById = useMemo(
    () => new Map(management.catalog.map((entry) => [entry.id, entry])),
    [management.catalog],
  );

  const refreshSettings = () =>
    queryClient.invalidateQueries({ queryKey: ["settings"] });
  const resetConnectionDraft = () => {
    const defaultCatalog = management.catalog[0];
    setCatalogId(defaultCatalog?.id ?? "openai-api");
    setDisplayName(defaultCatalog?.displayName ?? "");
    setBaseUrl(defaultCatalog?.defaultBaseUrl ?? "");
    setApiKey("");
    setModelIds("");
    setReplacementKey("");
  };
  const openManagedRecovery = (connection: ProviderConnectionSummary) => {
    const matchingCatalog = management.catalog.find(
      (entry) => entry.providerType === connection.providerType,
    );
    const nextCatalog = matchingCatalog ?? management.catalog[0];
    if (nextCatalog) {
      setCatalogId(nextCatalog.id);
      setDisplayName(connection.displayName);
      setBaseUrl(nextCatalog.defaultBaseUrl ?? "");
      setModelIds(
        connection.observedCapabilities?.models
          .map(({ modelId }) => modelId)
          .join(", ") ?? "",
      );
      setApiKey("");
    }
    setAdding(true);
  };
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
      resetConnectionDraft();
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
    <div className="flex min-w-0 flex-col gap-6">
      <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2
            id="settings-connections-title"
            className="text-lg font-semibold tracking-[-0.015em]"
          >
            {t("settings.section.connections")}
          </h2>
          <p className="mt-1 max-w-[68ch] text-sm leading-6 text-muted-foreground">
            {t("settings.section.connectionsDescription")}
          </p>
        </div>
        <Sheet
          open={adding}
          onOpenChange={(open) => {
            setAdding(open);
            if (!open) {
              resetConnectionDraft();
              createConnection.reset();
            }
          }}
        >
          <SheetTrigger asChild>
            <Button className="w-full shrink-0 sm:w-auto" type="button">
              {t("settings.connection.add")}
            </Button>
          </SheetTrigger>
          {selectedCatalog ? (
            <SheetContent className="sm:max-w-xl">
              <SheetHeader>
                <SheetTitle>{t("settings.connection.add")}</SheetTitle>
                <SheetDescription>
                  {t("settings.section.connectionsDescription")}
                </SheetDescription>
              </SheetHeader>
              <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
                <FieldGroup className="gap-5">
                  <Field>
                    <FieldLabel htmlFor="new-connection-provider">
                      {t("settings.connection.provider")}
                    </FieldLabel>
                    <Select
                      value={catalogId}
                      onValueChange={(value) => {
                        const next = management.catalog.find(
                          (entry) => entry.id === value,
                        );
                        setCatalogId(value);
                        setDisplayName(next?.displayName ?? "");
                        setBaseUrl(next?.defaultBaseUrl ?? "");
                        setApiKey("");
                        setModelIds("");
                      }}
                    >
                      <SelectTrigger
                        id="new-connection-provider"
                        className="w-full"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {management.catalog.map((entry) => (
                            <SelectItem key={entry.id} value={entry.id}>
                              {entry.displayName}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>

                  {selectedCatalog.recommendation ? (
                    <Alert>
                      <AlertTitle>{selectedCatalog.displayName}</AlertTitle>
                      <AlertDescription>
                        {t(
                          selectedCatalog.recommendation === "overall"
                            ? "settings.connection.recommendation.overall"
                            : selectedCatalog.recommendation === "free"
                              ? "settings.connection.recommendation.free"
                              : "settings.connection.recommendation.private",
                        )}
                      </AlertDescription>
                    </Alert>
                  ) : null}

                  <Field>
                    <FieldLabel htmlFor="new-connection-name">
                      {t("settings.connection.name")}
                    </FieldLabel>
                    <Input
                      id="new-connection-name"
                      value={displayName}
                      maxLength={200}
                      onChange={(event) => setDisplayName(event.target.value)}
                    />
                  </Field>

                  {selectedCatalog.authKind === "api-key" ? (
                    <Field>
                      <FieldLabel htmlFor="new-connection-api-key">
                        {t("settings.connection.apiKey", {
                          label:
                            selectedCatalog.credentialLabel ??
                            t("settings.connection.apiKeyDefault"),
                        })}
                      </FieldLabel>
                      <Input
                        id="new-connection-api-key"
                        type="password"
                        autoComplete="off"
                        value={apiKey}
                        onChange={(event) => setApiKey(event.target.value)}
                      />
                      <FieldDescription>
                        {t("settings.connection.secretHelp")}
                      </FieldDescription>
                    </Field>
                  ) : null}

                  {selectedCatalog.authKind === "subscription" ? (
                    <p className="text-sm leading-6 text-muted-foreground">
                      {t("settings.connection.subscriptionHelp")}
                    </p>
                  ) : null}

                  {selectedCatalog.endpointKind ? (
                    <FieldGroup className="gap-5">
                      <Field>
                        <FieldLabel htmlFor="new-connection-base-url">
                          {t(
                            selectedCatalog.endpointKind === "loopback"
                              ? "settings.connection.baseUrl"
                              : "settings.connection.externalBaseUrl",
                          )}
                        </FieldLabel>
                        <Input
                          id="new-connection-base-url"
                          value={baseUrl}
                          onChange={(event) => setBaseUrl(event.target.value)}
                        />
                        <FieldDescription>
                          {t(
                            selectedCatalog.endpointKind === "loopback"
                              ? "settings.connection.loopbackOnly"
                              : "settings.connection.publicHttpsOnly",
                          )}
                        </FieldDescription>
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="new-connection-models">
                          {t("settings.connection.modelIds")}
                        </FieldLabel>
                        <Textarea
                          id="new-connection-models"
                          className="min-h-24 resize-y font-mono"
                          value={modelIds}
                          onChange={(event) => setModelIds(event.target.value)}
                        />
                      </Field>
                    </FieldGroup>
                  ) : null}

                  {createConnection.isError ? (
                    <Alert variant="destructive">
                      <AlertTitle>
                        {t("settings.connection.addError")}
                      </AlertTitle>
                      <AlertDescription>
                        {apiErrorMessage(
                          createConnection.error,
                          t("settings.connection.addError"),
                        )}
                      </AlertDescription>
                    </Alert>
                  ) : null}

                  <p className="text-sm leading-5 text-muted-foreground">
                    {t("settings.connection.requirements")}
                  </p>
                </FieldGroup>
              </div>
              <SheetFooter>
                <SheetClose asChild>
                  <Button type="button" variant="outline">
                    {t("settings.connection.cancelAdd")}
                  </Button>
                </SheetClose>
                <Button
                  type="button"
                  disabled={
                    createConnection.isPending ||
                    !displayName.trim() ||
                    (selectedCatalog.authKind === "api-key" &&
                      apiKey.length < 8) ||
                    (selectedCatalog.endpointKind !== undefined &&
                      (!baseUrl.trim() || !modelIds.trim()))
                  }
                  onClick={() => createConnection.mutate()}
                >
                  {createConnection.isPending ? (
                    <Spinner data-icon="inline-start" />
                  ) : null}
                  {t(
                    createConnection.isPending
                      ? "settings.connection.adding"
                      : "settings.connection.addConfirm",
                  )}
                </Button>
              </SheetFooter>
            </SheetContent>
          ) : null}
        </Sheet>
      </div>

      {connections.length === 0 ? (
        <div role="status" className="border-y border-border/60 py-5">
          <p className="font-medium">{t("settings.connection.emptyTitle")}</p>
          <p className="mt-1 max-w-[64ch] text-sm leading-6 text-muted-foreground">
            {t("settings.connection.emptyDescription")}
          </p>
        </div>
      ) : (
        <ul className="overflow-hidden rounded-lg border border-border bg-background divide-y divide-border/60">
          {connections.map((connection) => {
            const metadata = metadataByConnection.get(connection.connectionId);
            const catalog = metadata
              ? catalogById.get(metadata.catalogId)
              : undefined;
            const providerKind =
              connection.providerType ??
              catalog?.providerType ??
              metadata?.catalogId ??
              t("provider.unavailable");
            const modelIdsForDetails =
              metadata && metadata.modelIds.length > 0
                ? metadata.modelIds
                : (connection.observedCapabilities?.models.map(
                    (model) => model.modelId,
                  ) ?? []);
            const isActiveLogin = loginConnectionId === connection.connectionId;
            return (
              <li key={connection.connectionId} className="min-w-0">
                <Collapsible>
                  <div className="grid min-w-0 gap-3 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto] sm:items-center sm:px-5">
                    <div className="min-w-0">
                      <p
                        title={connection.displayName}
                        className="truncate text-sm font-semibold"
                      >
                        {connection.displayName}
                      </p>
                      <p
                        title={providerKind}
                        className="mt-1 truncate text-xs text-muted-foreground"
                      >
                        {providerKind}
                      </p>
                    </div>
                    <Badge
                      className="w-fit max-w-full justify-self-start"
                      variant={
                        connection.state === "connected"
                          ? "success"
                          : connection.state === "starting" ||
                              connection.state === "degraded"
                            ? "warning"
                            : connection.state === "disabled"
                              ? "secondary"
                              : "error"
                      }
                    >
                      {statusLabels[connection.state]
                        ? t(statusLabels[connection.state]!)
                        : t("settings.status.unavailable")}
                    </Badge>
                    <span className="text-sm tabular-nums text-muted-foreground sm:whitespace-nowrap">
                      {t("settings.models", {
                        count:
                          connection.observedCapabilities?.models.length ?? 0,
                      })}
                    </span>
                    <CollapsibleTrigger asChild>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="w-full sm:w-auto"
                      >
                        {t(
                          metadata
                            ? "chat.composer.configureAi"
                            : "settings.connection.details",
                        )}
                      </Button>
                    </CollapsibleTrigger>
                  </div>

                  <CollapsibleContent>
                    <div className="min-w-0 border-t border-border/60 px-4 py-4 sm:px-5">
                      <p
                        title={connection.connectionId}
                        className="min-w-0 font-mono text-xs leading-5 text-muted-foreground [overflow-wrap:anywhere]"
                      >
                        {connection.connectionId}
                      </p>

                      <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                        <div>
                          <dt className="text-xs font-medium text-muted-foreground">
                            {t("settings.connection.providerKind")}
                          </dt>
                          <dd className="mt-1 font-mono text-sm [overflow-wrap:anywhere]">
                            {providerKind}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs font-medium text-muted-foreground">
                            {t("settings.connection.scope")}
                          </dt>
                          <dd className="mt-1 text-sm">
                            {t(
                              connection.external
                                ? "settings.external"
                                : "settings.localDevelopment",
                            )}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs font-medium text-muted-foreground">
                            {t("settings.connection.modelsObserved")}
                          </dt>
                          <dd className="mt-1 text-sm tabular-nums">
                            {t("settings.models", {
                              count:
                                connection.observedCapabilities?.models
                                  .length ?? 0,
                            })}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs font-medium text-muted-foreground">
                            {t("settings.connection.lastChecked")}
                          </dt>
                          <dd className="mt-1 text-sm">
                            {connection.lastCheckedAt
                              ? formatDate(connection.lastCheckedAt, {
                                  dateStyle: "medium",
                                  timeStyle: "short",
                                })
                              : t("settings.connection.notChecked")}
                          </dd>
                        </div>
                      </dl>

                      {metadata?.baseUrl ? (
                        <div className="mt-4 min-w-0 border-l-2 border-border/70 pl-3">
                          <p className="text-xs font-medium text-muted-foreground">
                            {t("settings.connection.endpoint")}
                          </p>
                          <p className="mt-1 font-mono text-xs leading-5 [overflow-wrap:anywhere]">
                            {metadata.baseUrl}
                          </p>
                        </div>
                      ) : null}

                      {modelIdsForDetails.length > 0 ? (
                        <div className="mt-4 min-w-0 border-l-2 border-border/70 pl-3">
                          <p className="text-xs font-medium text-muted-foreground">
                            {t("settings.connection.modelIds")}
                          </p>
                          <ul className="mt-1 grid min-w-0 gap-1">
                            {modelIdsForDetails.map((modelId) => (
                              <li
                                key={modelId}
                                title={modelId}
                                className="min-w-0 font-mono text-xs leading-5 [overflow-wrap:anywhere]"
                              >
                                {modelId}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}

                      {metadata ? (
                        <div className="mt-5 flex min-w-0 flex-col gap-4 border-t border-border/60 pt-4">
                          {metadata.authKind === "api-key" ? (
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-xs font-medium text-muted-foreground">
                                {t("settings.connection.credentialState")}
                              </span>
                              <Badge
                                variant={
                                  metadata.credentialConfigured
                                    ? "success"
                                    : "warning"
                                }
                              >
                                {t(
                                  metadata.credentialConfigured
                                    ? "settings.connection.credentialStored"
                                    : "settings.connection.credentialMissing",
                                )}
                              </Badge>
                            </div>
                          ) : null}

                          {credentialEditor === connection.connectionId ? (
                            <Field>
                              <FieldLabel
                                htmlFor={`credential-${connection.connectionId}`}
                              >
                                {t("settings.connection.newApiKey")}
                              </FieldLabel>
                              <div className="flex flex-col gap-2 sm:flex-row">
                                <Input
                                  id={`credential-${connection.connectionId}`}
                                  type="password"
                                  autoComplete="off"
                                  value={replacementKey}
                                  onChange={(event) =>
                                    setReplacementKey(event.target.value)
                                  }
                                />
                                <Button
                                  className="w-full sm:w-auto"
                                  type="button"
                                  variant="secondary"
                                  disabled={
                                    replacementKey.length < 8 ||
                                    setCredential.isPending
                                  }
                                  onClick={() =>
                                    setCredential.mutate(
                                      connection.connectionId,
                                    )
                                  }
                                >
                                  {setCredential.isPending ? (
                                    <Spinner data-icon="inline-start" />
                                  ) : null}
                                  {t(
                                    setCredential.isPending
                                      ? "settings.connection.updating"
                                      : "settings.connection.saveKey",
                                  )}
                                </Button>
                                <Button
                                  className="w-full sm:w-auto"
                                  type="button"
                                  variant="ghost"
                                  disabled={setCredential.isPending}
                                  onClick={() => {
                                    setCredentialEditor(null);
                                    setReplacementKey("");
                                  }}
                                >
                                  {t("settings.connection.cancelAdd")}
                                </Button>
                              </div>
                              <FieldDescription>
                                {t("settings.connection.secretHelp")}
                              </FieldDescription>
                            </Field>
                          ) : null}

                          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
                            {metadata.authKind === "api-key" ? (
                              <Button
                                className="w-full sm:w-auto"
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
                                className="w-full sm:w-auto"
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={startLogin.isPending}
                                onClick={() =>
                                  startLogin.mutate(connection.connectionId)
                                }
                              >
                                {startLogin.isPending ? (
                                  <Spinner data-icon="inline-start" />
                                ) : null}
                                {t(
                                  startLogin.isPending
                                    ? "settings.connection.signingIn"
                                    : "settings.connection.signIn",
                                )}
                              </Button>
                            ) : null}
                            {metadata.authKind === "local" &&
                            !connection.enabled ? (
                              <Button
                                className="w-full sm:w-auto"
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={enableLocal.isPending}
                                onClick={() =>
                                  enableLocal.mutate(connection.connectionId)
                                }
                              >
                                {enableLocal.isPending ? (
                                  <Spinner data-icon="inline-start" />
                                ) : null}
                                {t(
                                  enableLocal.isPending
                                    ? "settings.connection.updating"
                                    : "settings.connection.enable",
                                )}
                              </Button>
                            ) : null}
                            {connection.enabled ? (
                              <AlertDialog
                                open={disableTarget === connection.connectionId}
                                onOpenChange={(open) => {
                                  disableConnection.reset();
                                  setDisableTarget(
                                    open ? connection.connectionId : null,
                                  );
                                }}
                              >
                                <AlertDialogTrigger asChild>
                                  <Button
                                    className="w-full sm:w-auto"
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    disabled={disableConnection.isPending}
                                  >
                                    {t("settings.connection.disable")}
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>
                                      {t("settings.connection.disable")}
                                    </AlertDialogTitle>
                                    <AlertDialogDescription className="min-w-0">
                                      <span className="block break-words text-foreground">
                                        {connection.displayName}
                                      </span>
                                      <span className="mt-2 block">
                                        {t("settings.status.off")} ·{" "}
                                        {t(
                                          metadata.authKind === "api-key"
                                            ? "settings.connection.setKey"
                                            : metadata.authKind ===
                                                "subscription"
                                              ? "settings.connection.signIn"
                                              : "settings.connection.enable",
                                        )}
                                      </span>
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  {disableConnection.isError ? (
                                    <Alert variant="destructive">
                                      <AlertTitle>
                                        {t("settings.connection.actionError")}
                                      </AlertTitle>
                                      <AlertDescription>
                                        {apiErrorMessage(
                                          disableConnection.error,
                                          t("settings.connection.actionError"),
                                        )}
                                      </AlertDescription>
                                    </Alert>
                                  ) : null}
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>
                                      {t("settings.connection.cancelAdd")}
                                    </AlertDialogCancel>
                                    <AlertDialogAction
                                      variant="destructive"
                                      disabled={disableConnection.isPending}
                                      onClick={(event) => {
                                        event.preventDefault();
                                        disableConnection.mutate(
                                          connection.connectionId,
                                          {
                                            onSuccess: () =>
                                              setDisableTarget(null),
                                          },
                                        );
                                      }}
                                    >
                                      {t("settings.connection.disable")}
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            ) : null}
                          </div>

                          {isActiveLogin ? (
                            <LoginPanel
                              status={loginQuery.data}
                              isLoading={loginQuery.isLoading}
                              error={loginQuery.error}
                              answer={promptAnswer}
                              setAnswer={setPromptAnswer}
                              answering={answerLogin.isPending}
                              cancelling={cancelLogin.isPending}
                              onAnswer={(prompt) => answerLogin.mutate(prompt)}
                              onCancel={() => cancelLogin.mutate()}
                            />
                          ) : null}
                        </div>
                      ) : (
                        <div
                          role="status"
                          className="mt-5 flex min-w-0 flex-col gap-3 border-t border-border/60 pt-4 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <p className="max-w-[62ch] text-sm leading-6 text-muted-foreground">
                            {t("settings.connection.legacyReadOnly")}
                          </p>
                          <Button
                            className="w-full shrink-0 sm:w-auto"
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={management.catalog.length === 0}
                            onClick={() => openManagedRecovery(connection)}
                          >
                            {t("settings.connection.addManaged")}
                          </Button>
                        </div>
                      )}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              </li>
            );
          })}
        </ul>
      )}

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
  error,
  answer,
  setAnswer,
  answering,
  cancelling,
  onAnswer,
  onCancel,
}: {
  status: LoginStatus | undefined;
  isLoading: boolean;
  error: unknown;
  answer: string;
  setAnswer: (value: string) => void;
  answering: boolean;
  cancelling: boolean;
  onAnswer: (prompt: NonNullable<LoginStatus["prompt"]>) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  if (isLoading && !status) {
    return (
      <p
        role="status"
        className="flex items-center gap-2 text-sm text-muted-foreground"
      >
        <Spinner aria-hidden />
        {t("settings.connection.signingIn")}
      </p>
    );
  }
  if (error) {
    return (
      <Alert variant="destructive">
        <AlertTitle>{t("settings.connection.signInFailed")}</AlertTitle>
        <AlertDescription>
          {apiErrorMessage(error, t("settings.connection.signInFailed"))}
        </AlertDescription>
      </Alert>
    );
  }
  if (!status) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {t("settings.connection.loginUnavailable")}
      </p>
    );
  }
  return (
    <div className="flex min-w-0 flex-col gap-4 rounded-xl bg-background/70 p-4 text-sm">
      {status.events.length > 0 ? (
        <div className="flex flex-col gap-2">
          {status.events.map((event, index) => {
            if (event.type === "auth_url") {
              return (
                <p key={`${event.type}:${index}`} className="leading-6">
                  {event.instructions ? `${event.instructions} ` : ""}
                  <a
                    className="font-medium text-primary underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                <p key={`${event.type}:${index}`} className="leading-6">
                  {t("settings.connection.deviceCode", {
                    code: event.userCode,
                  })}{" "}
                  <a
                    className="font-medium text-primary underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    href={event.verificationUri}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t("settings.connection.openSignIn")}
                  </a>
                </p>
              );
            }
            return (
              <p key={`${event.type}:${index}`} className="leading-6">
                {event.message}
              </p>
            );
          })}
        </div>
      ) : null}

      {status.prompt ? (
        <Field>
          <FieldLabel htmlFor={`provider-prompt-${status.prompt.promptId}`}>
            {status.prompt.message}
          </FieldLabel>
          {status.prompt.type === "select" ? (
            <select
              id={`provider-prompt-${status.prompt.promptId}`}
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
              className="min-h-11 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <option value="">{t("settings.connection.chooseOption")}</option>
              {status.prompt.options.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          ) : (
            <Input
              id={`provider-prompt-${status.prompt.promptId}`}
              type={status.prompt.type === "secret" ? "password" : "text"}
              autoComplete="off"
              placeholder={status.prompt.placeholder ?? undefined}
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
            />
          )}
          <Button
            className="w-full sm:w-fit"
            type="button"
            size="sm"
            disabled={!answer || answering}
            onClick={() => onAnswer(status.prompt!)}
          >
            {answering ? <Spinner data-icon="inline-start" /> : null}
            {t(
              answering
                ? "settings.connection.answering"
                : "settings.connection.continue",
            )}
          </Button>
        </Field>
      ) : null}

      {status.status === "running" ? (
        <p role="status" className="text-muted-foreground">
          {t("settings.connection.loginRunning")}
        </p>
      ) : null}
      {status.status === "completed" ? (
        <p role="status" className="font-medium text-success-foreground">
          {t("settings.connection.signInComplete")}
        </p>
      ) : null}
      {status.status === "failed" ? (
        <p role="alert" className="text-destructive">
          {status.error ?? t("settings.connection.signInFailed")}
        </p>
      ) : null}
      {status.status === "cancelled" ? (
        <p role="status" className="text-muted-foreground">
          {t("settings.connection.loginCancelled")}
        </p>
      ) : null}
      {status.status === "running" ? (
        <Button
          className="w-full sm:w-fit"
          type="button"
          size="sm"
          variant="ghost"
          disabled={cancelling}
          onClick={onCancel}
        >
          {cancelling ? <Spinner data-icon="inline-start" /> : null}
          {t(
            cancelling
              ? "settings.connection.cancelling"
              : "settings.connection.cancelSignIn",
          )}
        </Button>
      ) : null}
    </div>
  );
}

function apiErrorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}
