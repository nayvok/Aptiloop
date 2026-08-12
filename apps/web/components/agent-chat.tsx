"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowClockwiseIcon,
  CaretDownIcon,
  PaperPlaneTiltIcon,
  StopIcon,
} from "@phosphor-icons/react";

import { api, ApiError, streamAgent } from "@/lib/api";
import { CHAT_ROLES, isChatRole, type ChatRole } from "@/lib/chat-role";
import { type MessageKey, useI18n } from "@/lib/i18n";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupText,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { Markdown } from "@/components/ui/markdown";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Marker, MarkerContent } from "@/components/ui/marker";
import {
  Message,
  MessageContent,
  MessageHeader,
} from "@/components/ui/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";

const roleLabelKeys = {
  teacher: "chat.role.teacher",
  reviewer: "chat.role.reviewer",
  interviewer: "chat.role.interviewer",
  curator: "chat.role.curator",
  "codex-expert": "chat.role.codexExpert",
} as const;
type Connection = {
  connectionId: string;
  adapterId: string;
  displayName: string;
  enabled: boolean;
  state: string;
  observedCapabilities: {
    models: Array<{ modelId: string; available: boolean }>;
    connection: {
      authenticated: boolean;
      streaming: boolean;
      cancellation: boolean;
    };
  } | null;
};
type StreamLiveState =
  "idle" | "generating" | "completed" | "failed" | "cancelled";
type RoleProfile = {
  role: "course-designer" | "tutor" | "evaluator" | "reviewer";
  mode: "no-ai" | "connection";
  connectionId: string | null;
  modelId: string | null;
};
type AgentSettings = {
  ai: {
    connections: Connection[];
    roleProfiles: RoleProfile[];
  };
};
type Disclosure = {
  operationId: string;
  scope: {
    destination: string;
    payloadCategories: string[];
    exclusions: string[];
    byteCount: number;
  };
  expiresAt: string;
};

type PresentedError = {
  message: string;
  technicalDetails: string | null;
};

const maximumTechnicalDetailLength = 600;

function safeTechnicalDetails(
  error: unknown,
  t: (key: MessageKey, values?: Record<string, string | number>) => string,
): string | null {
  if (!(error instanceof ApiError)) return null;

  const metadata = [
    t("query.technical.httpStatus", { status: error.status }),
    error.failure?.diagnosticId
      ? t("query.technical.diagnosticId", {
          diagnosticId: error.failure.diagnosticId,
        })
      : null,
    error.failure?.code
      ? t("query.technical.code", { code: error.failure.code })
      : null,
  ]
    .filter((value): value is string => Boolean(value))
    .join("\n");
  const rawDetails = metadata.slice(0, maximumTechnicalDetailLength);
  let details = "";
  for (const character of rawDetails) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (
      codePoint === 9 ||
      codePoint === 10 ||
      codePoint === 13 ||
      (codePoint >= 32 && codePoint !== 127)
    ) {
      details += character;
    }
  }
  details = details.trim();

  return details || null;
}

const markdownContentClassName =
  "min-w-0 max-w-full [overflow-wrap:anywhere] [&:has(table)]:overflow-x-auto [&_pre]:max-w-full [&_table]:min-w-max";

export function AgentChat({
  role,
  onRoleChange,
}: {
  role: ChatRole;
  onRoleChange: (role: ChatRole) => void;
}) {
  const { locale, t } = useI18n();
  const agentFailureMessage = t("chat.error.response");
  const agentCancellationMessage = t("chat.status.cancelled");
  const queryClient = useQueryClient();
  const selectedRoleLabel = t(roleLabelKeys[role]);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<
    Array<{
      id: string;
      role: "user" | "assistant";
      label: string;
      content: string;
    }>
  >([]);
  const [tools, setTools] = useState<string[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [streamLiveState, setStreamLiveState] =
    useState<StreamLiveState>("idle");
  const [streamError, setStreamError] = useState<PresentedError | null>(null);
  const [retryMessage, setRetryMessage] = useState<string | null>(null);
  const [abortable, setAbortable] = useState(false);
  const [pendingDisclosure, setPendingDisclosure] = useState<{
    message: string;
    disclosure: Disclosure;
  } | null>(null);
  const [disclosureError, setDisclosureError] = useState<PresentedError | null>(
    null,
  );
  const abortRef = useRef<AbortController | null>(null);
  const approvingDisclosureRef = useRef(false);
  const pendingMessageIdsRef = useRef(new Set<string>());
  const history = useQuery({
    queryKey: ["agent-history", role],
    queryFn: () =>
      api<{
        messages: Array<{
          id: string;
          role: "user" | "assistant";
          content: string;
        }>;
      }>(`/agent/history?role=${encodeURIComponent(role)}`),
  });
  const settings = useQuery({
    queryKey: ["settings", "agent-chat"],
    queryFn: () => api<AgentSettings>("/settings"),
  });
  const aptiloopRole =
    role === "reviewer"
      ? "reviewer"
      : role === "teacher" || role === "codex-expert"
        ? "tutor"
        : "evaluator";
  const roleProfile = settings.data?.ai.roleProfiles.find(
    (profile) => profile.role === aptiloopRole,
  );
  const connection = settings.data?.ai.connections.find(
    (candidate) => candidate.connectionId === roleProfile?.connectionId,
  );
  const assignedModel = roleProfile?.modelId;
  const hasCompleteAssignment =
    roleProfile?.mode === "connection" &&
    Boolean(roleProfile.connectionId) &&
    Boolean(assignedModel);
  const connectionReady =
    hasCompleteAssignment &&
    connection?.enabled === true &&
    connection.state === "connected" &&
    connection.observedCapabilities?.connection.authenticated === true &&
    connection.observedCapabilities.connection.streaming === true;
  const modelAvailable =
    assignedModel !== null &&
    assignedModel !== undefined &&
    connection?.observedCapabilities?.models.some(
      (model) => model.modelId === assignedModel && model.available,
    ) === true;
  const assignedModelAvailable = connectionReady && modelAvailable;
  const chatDataReady = history.isSuccess && settings.isSuccess;
  const chatDataLoading = history.isLoading || settings.isLoading;
  const composerReady =
    chatDataReady && hasCompleteAssignment && assignedModelAvailable;
  const composerNeedsConfiguration = settings.isSuccess && !composerReady;
  const recoverySection =
    hasCompleteAssignment && !connectionReady ? "connections" : "ai";
  const selection = settings.isLoading
    ? { provider: t("provider.checking"), model: null }
    : roleProfile?.mode === "connection"
      ? {
          provider: connection?.displayName ?? t("provider.unavailable"),
          model: roleProfile.modelId ?? t("provider.noModel"),
        }
      : {
          provider: t("provider.off"),
          model: null,
        };
  const composerContext = [
    selectedRoleLabel,
    selection.provider,
    selection.model,
  ]
    .filter(Boolean)
    .join(" · ");

  useEffect(() => {
    if (!history.data) return;
    // Query notifications can lag the local stream lifecycle. Keep an
    // optimistic turn mounted until the history cache contains its IDs.
    const historyMessages = history.data.messages.map((message) => ({
      ...message,
      label: message.role === "user" ? t("chat.label.you") : selectedRoleLabel,
    }));
    const historyIds = new Set(historyMessages.map((message) => message.id));
    for (const id of historyIds) {
      pendingMessageIdsRef.current.delete(id);
    }
    const pendingMessageIds = new Set(pendingMessageIdsRef.current);
    setMessages((current) => [
      ...historyMessages,
      ...current.filter(
        (message) =>
          pendingMessageIds.has(message.id) && !historyIds.has(message.id),
      ),
    ]);
  }, [history.data, selectedRoleLabel, t]);

  useEffect(() => () => abortRef.current?.abort(), []);

  async function send() {
    const message = input.trim();
    if (!message || streaming || !composerReady) return;
    setStreaming(true);
    setStreamLiveState("generating");
    setStreamError(null);
    setDisclosureError(null);
    setRetryMessage(null);
    try {
      const preparation = await api<
        { required: false } | { required: true; disclosure: Disclosure }
      >("/ai/disclosures", {
        method: "POST",
        body: JSON.stringify({ role, message }),
      });
      if (preparation.required) {
        setPendingDisclosure({
          message,
          disclosure: preparation.disclosure,
        });
        setStreamLiveState("idle");
        return;
      }
      await runStream(message);
    } catch (error) {
      setStreamLiveState("failed");
      setStreamError({
        message: t("chat.error.prepare"),
        technicalDetails: safeTechnicalDetails(error, t),
      });
      setRetryMessage(message);
      setInput((current) => current || message);
    } finally {
      setStreaming(false);
    }
  }

  async function approveDisclosure() {
    const pending = pendingDisclosure;
    if (!pending) return;
    setStreaming(true);
    setStreamLiveState("generating");
    setStreamError(null);
    setDisclosureError(null);
    setRetryMessage(null);
    try {
      await api(`/ai/disclosures/${pending.disclosure.operationId}/approve`, {
        method: "POST",
        body: JSON.stringify({}),
      });
    } catch (error) {
      setStreamLiveState("idle");
      setDisclosureError({
        message: t("chat.error.send"),
        technicalDetails: safeTechnicalDetails(error, t),
      });
      return;
    } finally {
      setStreaming(false);
    }

    setPendingDisclosure(null);
    setStreaming(true);
    setStreamLiveState("generating");
    try {
      await runStream(pending.message, pending.disclosure.operationId);
    } catch (error) {
      setStreamLiveState("failed");
      setStreamError({
        message: t("chat.error.send"),
        technicalDetails: safeTechnicalDetails(error, t),
      });
      setRetryMessage(pending.message);
      setInput((current) => current || pending.message);
    } finally {
      setStreaming(false);
    }
  }

  async function cancelDisclosure() {
    const pending = pendingDisclosure;
    setPendingDisclosure(null);
    setStreamLiveState("idle");
    setDisclosureError(null);
    if (!pending) return;
    try {
      await api(`/ai/disclosures/${pending.disclosure.operationId}/cancel`, {
        method: "POST",
        body: JSON.stringify({}),
      });
    } catch (error) {
      setPendingDisclosure(pending);
      setDisclosureError({
        message: t("chat.error.cancelDisclosure"),
        technicalDetails: safeTechnicalDetails(error, t),
      });
    }
  }

  async function runStream(message: string, disclosureOperationId?: string) {
    setStreamLiveState("generating");
    const previousMessages = messages.map(
      ({ id, role: messageRole, content }) => ({
        id,
        role: messageRole,
        content,
      }),
    );
    const userId = crypto.randomUUID();
    const assistantId = crypto.randomUUID();
    pendingMessageIdsRef.current.add(userId);
    pendingMessageIdsRef.current.add(assistantId);
    let assistantContent = "";
    let terminalReason: "completed" | "failed" | "cancelled" | null = null;
    let streamReportedError = false;
    let transportFailed = false;
    setMessages((current) => [
      ...current,
      {
        id: userId,
        role: "user",
        label: t("chat.label.you"),
        content: message,
      },
      {
        id: assistantId,
        role: "assistant",
        label: selectedRoleLabel,
        content: "",
      },
    ]);
    setInput("");
    const controller = new AbortController();
    abortRef.current = controller;
    setAbortable(true);
    try {
      stream: for await (const event of streamAgent(
        {
          role,
          message,
          ...(disclosureOperationId ? { disclosureOperationId } : {}),
        },
        controller.signal,
      )) {
        if (controller.signal.aborted) break;
        switch (event.type) {
          case "message.delta":
            assistantContent += event.content;
            setMessages((current) =>
              current.map((entry) =>
                entry.id === assistantId
                  ? { ...entry, content: entry.content + event.content }
                  : entry,
              ),
            );
            break;
          case "message.completed":
            assistantContent = event.content;
            setMessages((current) =>
              current.map((entry) =>
                entry.id === assistantId
                  ? { ...entry, content: event.content }
                  : entry,
              ),
            );
            break;
          case "tool.summary":
            setTools((current) => [
              ...current,
              `${event.name} · ${event.status}`,
            ]);
            break;
          case "error":
            streamReportedError = true;
            assistantContent = agentFailureMessage;
            setMessages((current) =>
              current.map((entry) =>
                entry.id === assistantId
                  ? { ...entry, content: agentFailureMessage }
                  : entry,
              ),
            );
            break;
          case "session.completed":
            terminalReason = event.reason;
            break stream;
        }
      }

      const failed =
        terminalReason === "failed" ||
        terminalReason === null ||
        streamReportedError;
      if (controller.signal.aborted || terminalReason === "cancelled") {
        assistantContent = agentCancellationMessage;
        setStreamLiveState("cancelled");
      } else if (failed) {
        assistantContent = agentFailureMessage;
        setStreamLiveState("failed");
        setRetryMessage(message);
        setInput((current) => current || message);
      } else {
        setStreamLiveState("completed");
      }
      if (terminalReason !== "completed" || streamReportedError) {
        setMessages((current) =>
          current.map((entry) =>
            entry.id === assistantId
              ? { ...entry, content: assistantContent }
              : entry,
          ),
        );
      }
    } catch (error) {
      transportFailed = !controller.signal.aborted;
      setStreamLiveState(controller.signal.aborted ? "cancelled" : "failed");
      if (transportFailed) pendingMessageIdsRef.current.delete(assistantId);
      assistantContent = controller.signal.aborted
        ? agentCancellationMessage
        : agentFailureMessage;
      if (!controller.signal.aborted) {
        setStreamError({
          message: t("chat.error.responseDetail"),
          technicalDetails: safeTechnicalDetails(error, t),
        });
        setRetryMessage(message);
        setInput((current) => current || message);
      }
      setMessages((current) =>
        transportFailed
          ? current.filter((entry) => entry.id !== assistantId)
          : current.map((entry) =>
              entry.id === assistantId
                ? { ...entry, content: assistantContent }
                : entry,
            ),
      );
    } finally {
      const finalContent =
        assistantContent ||
        (controller.signal.aborted || terminalReason === "cancelled"
          ? agentCancellationMessage
          : terminalReason === "completed"
            ? t("chat.error.emptyResponse")
            : agentFailureMessage);
      queryClient.setQueryData(["agent-history", role], {
        messages: [
          ...previousMessages,
          { id: userId, role: "user", content: message },
          ...(transportFailed
            ? []
            : [
                {
                  id: assistantId,
                  role: "assistant" as const,
                  content: finalContent,
                },
              ]),
        ],
      });
      if (!assistantContent) {
        setMessages((current) =>
          current.map((entry) =>
            entry.id === assistantId
              ? { ...entry, content: finalContent }
              : entry,
          ),
        );
      }
      setAbortable(false);
      abortRef.current = null;
    }
  }

  const retrying = retryMessage !== null && input.trim() === retryMessage;
  const queryError: PresentedError | null = history.isError
    ? {
        message: t("chat.error.history"),
        technicalDetails: safeTechnicalDetails(history.error, t),
      }
    : settings.isError
      ? {
          message: t("chat.error.settings"),
          technicalDetails: safeTechnicalDetails(settings.error, t),
        }
      : null;
  const presentedError = streamError ?? queryError;

  return (
    <section
      data-slot="agent-chat"
      aria-busy={streaming}
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background"
    >
      <div className="flex min-w-0 flex-col gap-3 pb-3 md:flex-row md:items-center md:justify-between">
        <div className="md:hidden">
          <label className="sr-only" htmlFor="agent-role-select">
            {t("chat.a11y.roleSelector")}
          </label>
          <Select
            value={role}
            disabled={streaming}
            onValueChange={(value) => {
              if (isChatRole(value)) onRoleChange(value);
            }}
          >
            <SelectTrigger id="agent-role-select" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="start">
              <SelectGroup>
                {CHAT_ROLES.map((item) => (
                  <SelectItem key={item} value={item}>
                    {t(roleLabelKeys[item])}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
        <div
          role="group"
          className="hidden min-w-0 flex-wrap gap-1 md:flex"
          aria-label={t("chat.a11y.roleSelector")}
        >
          {CHAT_ROLES.map((item) => (
            <Button
              key={item}
              aria-pressed={role === item}
              variant={role === item ? "secondary" : "ghost"}
              size="sm"
              disabled={streaming}
              onClick={() => onRoleChange(item)}
            >
              {t(roleLabelKeys[item])}
            </Button>
          ))}
        </div>
        <p
          className="min-w-0 text-sm leading-5 text-muted-foreground md:max-w-[24rem] md:text-right"
          aria-label={t("chat.composer.context", {
            context: composerContext,
          })}
          title={composerContext}
        >
          <span className="font-medium text-foreground">
            {selection.provider}
          </span>
          {selection.model ? (
            <span className="[overflow-wrap:anywhere]">
              {" "}
              · {selection.model}
            </span>
          ) : null}
        </p>
      </div>
      {presentedError ? (
        <Alert
          id="agent-chat-error"
          variant="destructive"
          className="rounded-none border-x-0 border-t-0"
        >
          <AlertDescription className="flex w-full flex-col items-start justify-between gap-3 sm:flex-row sm:items-start">
            <div className="min-w-0">
              <p>{presentedError.message}</p>
              {presentedError.technicalDetails ? (
                <details className="mt-2 max-w-[65ch] text-xs text-muted-foreground">
                  <summary className="min-h-11 cursor-pointer py-3 font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    {t("query.technicalDetails")}
                  </summary>
                  <p className="whitespace-pre-wrap font-mono [overflow-wrap:anywhere]">
                    {presentedError.technicalDetails}
                  </p>
                </details>
              ) : null}
            </div>
            {!streamError ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  void history.refetch();
                  void settings.refetch();
                }}
              >
                <ArrowClockwiseIcon data-icon="inline-start" aria-hidden />
                {t("chat.retry")}
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}
      <p className="sr-only" role="status" aria-live="polite">
        {streamLiveState === "generating"
          ? t("chat.status.generating")
          : streamLiveState === "completed"
            ? t("chat.status.ready")
            : streamLiveState === "failed"
              ? t("chat.status.failed")
              : streamLiveState === "cancelled"
                ? t("chat.status.cancelled")
                : ""}
      </p>
      <MessageScrollerProvider>
        <MessageScroller className="min-h-0 flex-1">
          <MessageScrollerViewport
            role="region"
            aria-label={t("chat.a11y.transcript")}
            className="py-6 pr-2"
          >
            <MessageScrollerContent className="mx-0 max-w-none">
              {history.isLoading && messages.length === 0 ? (
                <div
                  role="status"
                  className="m-auto inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground"
                >
                  <Spinner />
                  {t("chat.status.loading")}
                </div>
              ) : history.isError &&
                messages.length === 0 ? null : messages.length === 0 ? (
                <div className="my-auto w-full max-w-xl py-12 text-left">
                  <p className="text-sm font-medium text-muted-foreground">
                    {selectedRoleLabel}
                  </p>
                  <p className="mt-2 font-medium">{t("chat.empty.title")}</p>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground [overflow-wrap:anywhere]">
                    {t("chat.empty.description")}
                  </p>
                  <p className="mt-2 text-xs leading-5 text-muted-foreground [overflow-wrap:anywhere]">
                    {t("chat.empty.reloadLimitation")}
                  </p>
                </div>
              ) : (
                messages.map((message, index) => (
                  <MessageScrollerItem
                    key={message.id}
                    scrollAnchor={index === messages.length - 1}
                  >
                    <Message
                      align={message.role === "user" ? "end" : "start"}
                      aria-label={message.label}
                    >
                      <MessageContent>
                        <MessageHeader>{message.label}</MessageHeader>
                        <Bubble
                          align={message.role === "user" ? "end" : "start"}
                          variant={
                            message.role === "user" ? "secondary" : "ghost"
                          }
                        >
                          <BubbleContent>
                            {message.content ? (
                              message.role === "assistant" ? (
                                <Markdown
                                  baseHeadingLevel={2}
                                  className={`${markdownContentClassName} max-w-[72ch]`}
                                >
                                  {message.content}
                                </Markdown>
                              ) : (
                                <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">
                                  {message.content}
                                </p>
                              )
                            ) : (
                              <span
                                role="status"
                                aria-live="polite"
                                className="inline-flex min-h-6 items-center gap-2 text-muted-foreground"
                              >
                                <Spinner />
                                {t("chat.status.generating")}
                              </span>
                            )}
                          </BubbleContent>
                        </Bubble>
                      </MessageContent>
                    </Message>
                  </MessageScrollerItem>
                ))
              )}
              {tools.length ? (
                <MessageScrollerItem>
                  <Collapsible className="group/tools rounded-control bg-surface-soft/55 px-3 text-xs text-muted-foreground">
                    <CollapsibleTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        className="h-auto w-full justify-between rounded-none px-0 py-3 text-left"
                      >
                        <span className="min-w-0 whitespace-normal">
                          {t("chat.tools.title", { count: tools.length })}
                        </span>
                        <CaretDownIcon
                          aria-hidden
                          className="transition-transform group-data-[state=open]/tools:rotate-180 motion-reduce:transition-none"
                        />
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="pb-4">
                      <Marker variant="separator" className="mb-3">
                        <MarkerContent>
                          {t("chat.tools.boundary")}
                        </MarkerContent>
                      </Marker>
                      <ul className="flex min-w-0 flex-col gap-1 overflow-x-auto font-mono [overflow-wrap:anywhere]">
                        {tools.map((tool, index) => (
                          <li key={`${tool}-${index}`}>{tool}</li>
                        ))}
                      </ul>
                    </CollapsibleContent>
                  </Collapsible>
                </MessageScrollerItem>
              ) : null}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton />
        </MessageScroller>
      </MessageScrollerProvider>
      <form
        className="shrink-0 pt-4"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <label className="sr-only" htmlFor="agent-message">
          {t("chat.composer.label")}
        </label>
        <InputGroup>
          <InputGroupTextarea
            id="agent-message"
            rows={3}
            disabled={!composerReady || streaming}
            value={input}
            aria-describedby={streamError ? "agent-chat-error" : undefined}
            onChange={(event) => {
              const value = event.target.value;
              setInput(value);
              if (retryMessage && value.trim() !== retryMessage) {
                setRetryMessage(null);
              }
            }}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing &&
                !streaming &&
                composerReady
              ) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder={
              chatDataLoading
                ? t("chat.status.loading")
                : queryError
                  ? t("chat.error.dataUnavailable")
                  : composerNeedsConfiguration
                    ? t("chat.composer.unavailablePlaceholder")
                    : t("chat.composer.placeholder")
            }
          />
          <InputGroupAddon
            align="block-end"
            className="flex-wrap justify-between gap-2 border-t border-border/60 pt-3"
          >
            <InputGroupText
              className="min-w-0 flex-1 whitespace-normal [overflow-wrap:anywhere]"
              aria-label={t("chat.composer.context", {
                context: composerContext,
              })}
              title={composerContext}
            >
              <span>{composerContext}</span>
            </InputGroupText>
            {streaming ? (
              abortable ? (
                <InputGroupButton
                  type="button"
                  size="sm"
                  variant="outline"
                  aria-label={t("chat.composer.stop")}
                  onClick={() => abortRef.current?.abort()}
                >
                  <StopIcon data-icon="inline-start" aria-hidden />
                  {t("chat.composer.stop")}
                </InputGroupButton>
              ) : (
                <span
                  role="status"
                  className="inline-flex min-h-11 shrink-0 items-center gap-2 text-xs text-muted-foreground sm:min-h-9"
                >
                  <Spinner />
                  {t("chat.status.generating")}
                </span>
              )
            ) : chatDataLoading ? (
              <span
                role="status"
                className="inline-flex min-h-11 shrink-0 items-center gap-2 text-xs text-muted-foreground sm:min-h-9"
              >
                <Spinner />
                {t("chat.status.loading")}
              </span>
            ) : queryError ? (
              <span className="inline-flex min-h-11 items-center text-xs text-muted-foreground sm:min-h-9">
                {t("chat.error.dataUnavailable")}
              </span>
            ) : composerNeedsConfiguration ? (
              <InputGroupButton asChild size="sm" variant="default">
                <Link href={`/settings?section=${recoverySection}`}>
                  {t("chat.composer.configureAi")}
                </Link>
              </InputGroupButton>
            ) : (
              <InputGroupButton
                type="submit"
                size="sm"
                variant="default"
                aria-label={
                  retrying ? t("chat.retry") : t("chat.composer.send")
                }
                disabled={!composerReady || !input.trim()}
              >
                {retrying ? (
                  <ArrowClockwiseIcon data-icon="inline-start" aria-hidden />
                ) : (
                  <PaperPlaneTiltIcon data-icon="inline-start" aria-hidden />
                )}
                {retrying ? t("chat.retry") : t("chat.composer.send")}
              </InputGroupButton>
            )}
          </InputGroupAddon>
        </InputGroup>
      </form>
      <AlertDialog
        open={pendingDisclosure !== null}
        onOpenChange={(open) => {
          if (open) return;
          if (approvingDisclosureRef.current) {
            approvingDisclosureRef.current = false;
            return;
          }
          void cancelDisclosure();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("chat.disclosure.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("chat.disclosure.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {pendingDisclosure ? (
            <dl className="grid gap-3 rounded-panel border border-border bg-muted/20 p-4 text-sm">
              <div>
                <dt className="font-medium">
                  {t("chat.disclosure.destination")}
                </dt>
                <dd className="min-w-0 text-muted-foreground [overflow-wrap:anywhere]">
                  {pendingDisclosure.disclosure.scope.destination}
                </dd>
              </div>
              <div>
                <dt className="font-medium">{t("chat.disclosure.data")}</dt>
                <dd className="min-w-0 text-muted-foreground [overflow-wrap:anywhere]">
                  {t("chat.disclosure.payload", {
                    categories:
                      pendingDisclosure.disclosure.scope.payloadCategories.join(
                        ", ",
                      ),
                    bytes:
                      pendingDisclosure.disclosure.scope.byteCount.toLocaleString(
                        locale,
                      ),
                  })}
                </dd>
              </div>
              <div>
                <dt className="font-medium">
                  {t("chat.disclosure.exclusions")}
                </dt>
                <dd className="min-w-0 text-muted-foreground [overflow-wrap:anywhere]">
                  {pendingDisclosure.disclosure.scope.exclusions.join(", ")}
                </dd>
              </div>
            </dl>
          ) : null}
          {disclosureError ? (
            <Alert variant="destructive">
              <AlertDescription>
                <p>{disclosureError.message}</p>
                {disclosureError.technicalDetails ? (
                  <details className="mt-2 text-xs text-muted-foreground">
                    <summary className="min-h-11 cursor-pointer py-3 font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      {t("query.technicalDetails")}
                    </summary>
                    <p className="whitespace-pre-wrap font-mono [overflow-wrap:anywhere]">
                      {disclosureError.technicalDetails}
                    </p>
                  </details>
                ) : null}
              </AlertDescription>
            </Alert>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel>{t("chat.disclosure.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                approvingDisclosureRef.current = true;
                void approveDisclosure();
              }}
            >
              {t("chat.disclosure.approve")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
