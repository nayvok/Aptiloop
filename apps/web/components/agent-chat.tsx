"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PaperPlaneTiltIcon, StopIcon } from "@phosphor-icons/react";

import { api, streamAgent } from "@/lib/api";
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
type AgentSettings = {
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

export function AgentChat({ initialRole = "teacher" }: { initialRole?: Role }) {
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
        label: message.role === "user" ? "Ты" : role,
      })),
    );
  }, [history.data, role, streaming]);

  async function send() {
    const message = input.trim();
    if (!message || streaming) return;
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
    setMessages((current) => [
      ...current,
      {
        id: userId,
        role: "user",
        label: "Ты",
        content: message,
      },
      { id: assistantId, role: "assistant", label: role, content: "" },
    ]);
    setInput("");
    setStreaming(true);
    setStreamError(null);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      for await (const event of streamAgent(
        { role, message },
        controller.signal,
      )) {
        if (event.type === "message.delta") {
          assistantContent += event.content ?? "";
          setMessages((current) =>
            current.map((entry) =>
              entry.id === assistantId
                ? { ...entry, content: entry.content + (event.content ?? "") }
                : entry,
            ),
          );
        }
        if (event.type === "tool.started")
          setTools((current) => [
            ...current,
            `${event.name ?? "tool"}: запущен`,
          ]);
        if (event.type === "tool.completed")
          setTools((current) => [
            ...current,
            `${event.name ?? "tool"}: завершён`,
          ]);
        if (event.type === "error") {
          assistantContent = event.message ?? "Не удалось получить ответ";
          setMessages((current) =>
            current.map((entry) =>
              entry.id === assistantId
                ? {
                    ...entry,
                    content: event.message ?? "Не удалось получить ответ",
                  }
                : entry,
            ),
          );
        }
      }
    } catch (error) {
      assistantContent = controller.signal.aborted
        ? "Ответ остановлен."
        : error instanceof Error
          ? `Не удалось получить ответ: ${error.message}`
          : "Не удалось получить ответ.";
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
        (controller.signal.aborted
          ? "Ответ остановлен."
          : "Агент завершил ответ без текста.");
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
      setStreaming(false);
    }
  }

  const selection = settings.data
    ? role === "teacher"
      ? {
          provider: settings.data.teacherProvider,
          model: settings.data.teacherModel,
        }
      : role === "reviewer"
        ? {
            provider: settings.data.reviewerProvider,
            model: settings.data.reviewerModel,
          }
        : role === "interviewer"
          ? {
              provider: settings.data.interviewerProvider,
              model: settings.data.interviewerModel,
            }
          : role === "codex-expert"
            ? {
                provider: settings.data.codexExpertProvider,
                model: settings.data.codexExpertModel,
              }
            : {
                provider: settings.data.curatorProvider,
                model: settings.data.curatorModel,
              }
    : { provider: "Mock", model: "loading" };

  return (
    <section
      data-slot="agent-chat"
      className="flex min-h-[650px] flex-col overflow-hidden rounded-xl border border-border bg-card"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-3">
        <div className="flex flex-wrap gap-1" aria-label="Роль агента">
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
        <Badge variant="success">
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
                ? `История недоступна: ${history.error.message}`
                : settings.error instanceof Error
                  ? `Настройки провайдера недоступны: ${settings.error.message}`
                  : "Данные агента временно недоступны.")}
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
              Повторить
            </Button>
          ) : null}
        </div>
      ) : null}
      <p className="sr-only" role="status" aria-live="polite">
        {streaming
          ? "Агент формирует ответ"
          : streamError
            ? "Ответ не получен"
            : messages.length
              ? "Ответ готов"
              : ""}
      </p>
      <MessageScrollerProvider>
        <MessageScroller className="flex-1">
          <MessageScrollerViewport className="p-4 md:p-6">
            <MessageScrollerContent className="gap-4">
              {messages.length === 0 ? (
                <div className="m-auto max-w-md text-center">
                  <p className="font-medium">
                    Сначала сформулируй свой вопрос или ответ
                  </p>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    Агент не будет писать практическое решение вместо тебя.
                    Проверка решения работает только с зафиксированным diff.
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
                                aria-label="Агент печатает"
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
          Сообщение агенту
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
            placeholder="Напиши свой ответ или попроси уточняющий вопрос…"
            className="max-h-40 min-h-10 flex-1 resize-none bg-transparent px-2 py-1 text-sm leading-6 outline-none placeholder:text-muted-foreground"
          />
          {streaming ? (
            <Button
              size="icon"
              variant="outline"
              aria-label="Остановить ответ"
              onClick={() => abortRef.current?.abort()}
            >
              <StopIcon aria-hidden />
            </Button>
          ) : (
            <Button
              size="icon"
              aria-label="Отправить"
              disabled={!input.trim()}
              onClick={() => void send()}
            >
              <PaperPlaneTiltIcon aria-hidden />
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}
