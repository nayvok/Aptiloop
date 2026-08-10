"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PaperPlaneTiltIcon, StopIcon } from "@phosphor-icons/react";

import { api, streamAgent } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
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
import { Badge } from "@/components/ui/badge";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
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

const roles = [
  "teacher",
  "reviewer",
  "interviewer",
  "curator",
  "codex-expert",
] as const;
type Role = (typeof roles)[number];
type Connection = {
  connectionId: string;
  adapterId: string;
  displayName: string;
  state: string;
  observedCapabilities: {
    models: Array<{ modelId: string; available: boolean }>;
  } | null;
};
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

export function AgentChat({ initialRole = "teacher" }: { initialRole?: Role }) {
  const { t } = useI18n();
  const agentFailureMessage = t("chat.error.response");
  const agentCancellationMessage = t("chat.status.cancelled");
  const queryClient = useQueryClient();
  const [role, setRole] = useState<Role>(initialRole);
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
  const [streamError, setStreamError] = useState<string | null>(null);
  const [pendingDisclosure, setPendingDisclosure] = useState<{
    message: string;
    disclosure: Disclosure;
  } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
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
    queryKey: ["settings"],
    queryFn: () => api<AgentSettings>("/settings"),
  });

  useEffect(() => {
    if (!history.data || streaming) return;
    setMessages(
      history.data.messages.map((message) => ({
        ...message,
        label: message.role === "user" ? t("chat.label.you") : role,
      })),
    );
  }, [history.data, role, streaming, t]);

  async function send() {
    const message = input.trim();
    if (!message || streaming) return;
    setStreaming(true);
    setStreamError(null);
    try {
      const preparation = await api<
        { required: false } | { required: true; disclosure: Disclosure }
      >("/ai/disclosures", {
        method: "POST",
        body: JSON.stringify({ role, message }),
      });
      if (preparation.required) {
        setPendingDisclosure({ message, disclosure: preparation.disclosure });
        return;
      }
      await runStream(message);
    } catch (error) {
      setStreamError(
        error instanceof Error
          ? t("chat.error.prepare", { error: error.message })
          : agentFailureMessage,
      );
    } finally {
      setStreaming(false);
    }
  }

  async function approveDisclosure() {
    const pending = pendingDisclosure;
    if (!pending) return;
    setPendingDisclosure(null);
    setStreaming(true);
    setStreamError(null);
    try {
      await api(`/ai/disclosures/${pending.disclosure.operationId}/approve`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      await runStream(pending.message, pending.disclosure.operationId);
    } catch (error) {
      setStreamError(
        error instanceof Error
          ? t("chat.error.send", { error: error.message })
          : agentFailureMessage,
      );
    } finally {
      setStreaming(false);
    }
  }

  async function cancelDisclosure() {
    const pending = pendingDisclosure;
    setPendingDisclosure(null);
    if (!pending) return;
    await api(`/ai/disclosures/${pending.disclosure.operationId}/cancel`, {
      method: "POST",
      body: JSON.stringify({}),
    }).catch(() => undefined);
  }

  async function runStream(message: string, disclosureOperationId?: string) {
    const previousMessages = messages.map(
      ({ id, role: messageRole, content }) => ({
        id,
        role: messageRole,
        content,
      }),
    );
    const userId = crypto.randomUUID();
    const assistantId = crypto.randomUUID();
    let assistantContent = "";
    let terminalReason: "completed" | "failed" | "cancelled" | null = null;
    let streamReportedError = false;
    setMessages((current) => [
      ...current,
      {
        id: userId,
        role: "user",
        label: t("chat.label.you"),
        content: message,
      },
      { id: assistantId, role: "assistant", label: role, content: "" },
    ]);
    setInput("");
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      stream: for await (const event of streamAgent(
        {
          role,
          message,
          ...(disclosureOperationId ? { disclosureOperationId } : {}),
        },
        controller.signal,
      )) {
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

      if (terminalReason === "cancelled") {
        assistantContent = agentCancellationMessage;
      } else if (
        terminalReason === "failed" ||
        terminalReason === null ||
        streamReportedError
      ) {
        assistantContent = agentFailureMessage;
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
      assistantContent = controller.signal.aborted
        ? agentCancellationMessage
        : error instanceof Error
          ? t("chat.error.responseDetail", { error: error.message })
          : agentFailureMessage;
      if (!controller.signal.aborted) setStreamError(assistantContent);
      setMessages((current) =>
        current.map((entry) =>
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
          { id: assistantId, role: "assistant", content: finalContent },
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
      abortRef.current = null;
    }
  }

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
  const selection =
    roleProfile?.mode === "connection"
      ? {
          provider: connection?.displayName ?? "Unavailable",
          model: roleProfile.modelId ?? "No model",
        }
      : { provider: "AI Off", model: "Manual path" };

  return (
    <section
      data-slot="agent-chat"
      className="flex min-h-[650px] flex-col overflow-hidden rounded-xl border border-border bg-card"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-3">
        <div
          className="flex flex-wrap gap-1"
          aria-label={t("chat.a11y.roleSelector")}
        >
          {roles.map((item) => (
            <Button
              key={item}
              aria-pressed={role === item}
              variant={role === item ? "secondary" : "ghost"}
              size="sm"
              disabled={streaming}
              onClick={() => {
                setMessages([]);
                setTools([]);
                setRole(item);
              }}
            >
              {item}
            </Button>
          ))}
        </div>
        <Badge
          variant={roleProfile?.mode === "connection" ? "success" : "outline"}
        >
          {selection.provider} · {selection.model}
        </Badge>
      </div>
      {history.isError || settings.isError || streamError ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 border-b border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          <span>
            {streamError ??
              (history.error instanceof Error
                ? t("chat.error.history", { error: history.error.message })
                : settings.error instanceof Error
                  ? t("chat.error.settings", { error: settings.error.message })
                  : t("chat.error.dataUnavailable"))}
          </span>
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
              {t("chat.retry")}
            </Button>
          ) : null}
        </div>
      ) : null}
      <p className="sr-only" role="status" aria-live="polite">
        {streaming
          ? t("chat.status.generating")
          : streamError
            ? t("chat.status.failed")
            : messages.length
              ? t("chat.status.ready")
              : ""}
      </p>
      <MessageScrollerProvider>
        <MessageScroller className="flex-1">
          <MessageScrollerViewport className="p-4 md:p-6">
            <MessageScrollerContent className="gap-4">
              {messages.length === 0 ? (
                <div className="m-auto max-w-md text-center">
                  <p className="font-medium">{t("chat.empty.title")}</p>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    {t("chat.empty.description")}
                  </p>
                </div>
              ) : (
                messages.map((message, index) => (
                  <MessageScrollerItem
                    key={message.id}
                    scrollAnchor={index === messages.length - 1}
                  >
                    <Message align={message.role === "user" ? "end" : "start"}>
                      <MessageContent>
                        <MessageHeader>{message.label}</MessageHeader>
                        <Bubble
                          align={message.role === "user" ? "end" : "start"}
                          variant={
                            message.role === "user" ? "default" : "muted"
                          }
                        >
                          <BubbleContent>
                            {message.content || (
                              <span
                                aria-label={t("chat.a11y.typing")}
                                className="inline-block h-4 w-1 animate-pulse bg-primary"
                              />
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
                  <details className="rounded-lg border border-border p-3 text-xs text-muted-foreground">
                    <summary className="cursor-pointer font-medium text-foreground">
                      Tool events · {tools.length}
                    </summary>
                    <Marker variant="separator" className="my-3">
                      <MarkerContent>read-only activity</MarkerContent>
                    </Marker>
                    <ul className="flex flex-col gap-1 font-mono">
                      {tools.map((tool, index) => (
                        <li key={`${tool}-${index}`}>{tool}</li>
                      ))}
                    </ul>
                  </details>
                </MessageScrollerItem>
              ) : null}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton />
        </MessageScroller>
      </MessageScrollerProvider>
      <div className="border-t border-border p-3 md:p-4">
        <label className="sr-only" htmlFor="agent-message">
          {t("chat.composer.label")}
        </label>
        <div className="flex items-end gap-2 rounded-lg border border-input bg-background p-2 focus-within:ring-2 focus-within:ring-ring">
          <textarea
            id="agent-message"
            rows={2}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
            placeholder={t("chat.composer.placeholder")}
            className="max-h-40 min-h-10 flex-1 resize-none bg-transparent px-2 py-1 text-sm leading-6 outline-none placeholder:text-muted-foreground"
          />
          {streaming ? (
            <Button
              size="icon"
              variant="outline"
              aria-label={t("chat.composer.stop")}
              onClick={() => abortRef.current?.abort()}
            >
              <StopIcon aria-hidden />
            </Button>
          ) : (
            <Button
              size="icon"
              aria-label={t("chat.composer.send")}
              disabled={!input.trim()}
              onClick={() => void send()}
            >
              <PaperPlaneTiltIcon aria-hidden />
            </Button>
          )}
        </div>
      </div>
      <AlertDialog
        open={pendingDisclosure !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDisclosure(null);
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
            <dl className="grid gap-3 rounded-lg border border-border bg-muted/20 p-4 text-sm">
              <div>
                <dt className="font-medium">
                  {t("chat.disclosure.destination")}
                </dt>
                <dd className="text-muted-foreground">
                  {pendingDisclosure.disclosure.scope.destination}
                </dd>
              </div>
              <div>
                <dt className="font-medium">{t("chat.disclosure.data")}</dt>
                <dd className="text-muted-foreground">
                  {pendingDisclosure.disclosure.scope.payloadCategories.join(
                    ", ",
                  )}{" "}
                  · {pendingDisclosure.disclosure.scope.byteCount} bytes
                </dd>
              </div>
              <div>
                <dt className="font-medium">
                  {t("chat.disclosure.exclusions")}
                </dt>
                <dd className="text-muted-foreground">
                  {pendingDisclosure.disclosure.scope.exclusions.join(", ")}
                </dd>
              </div>
            </dl>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => void cancelDisclosure()}>
              {t("chat.disclosure.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction onClick={() => void approveDisclosure()}>
              {t("chat.disclosure.approve")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
