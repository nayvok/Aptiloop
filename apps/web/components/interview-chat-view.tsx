"use client";

import {
  ArrowClockwiseIcon,
  CheckCircleIcon,
  PaperPlaneTiltIcon,
} from "@phosphor-icons/react";

import type { Interview } from "@/components/interview-client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Markdown } from "@/components/ui/markdown";
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
import { useI18n } from "@/lib/i18n";

export interface InterviewChatViewProps {
  interview: Interview;
  action: "start" | "answer" | "finish" | null;
  actionError: string | null;
  answer: string;
  onAnswerChange(value: string): void;
  onSend(): void;
  onRetry(): void;
  onFinish(): void;
}

export function InterviewChatView({
  interview,
  action,
  actionError,
  answer,
  onAnswerChange,
  onSend,
  onRetry,
  onFinish,
}: InterviewChatViewProps) {
  const { t } = useI18n();
  const hasPendingQuestion =
    interview.progress.questionsAsked ===
    interview.progress.questionsAnswered + 1;
  const pendingQuestionId = hasPendingQuestion
    ? interview.transcript.findLast((message) => message.role === "assistant")
        ?.id
    : undefined;
  const waitingForQuestion = action === "answer";
  const ready = interview.progress.readyToFinish;

  return (
    <div className="flex min-h-[32rem] flex-col overflow-hidden rounded-lg border border-border bg-card">
      <MessageScrollerProvider>
        <MessageScroller className="flex-1">
          <MessageScrollerViewport className="p-4 md:p-6">
            <MessageScrollerContent>
              {interview.transcript.map((message, index) => {
                const assistant = message.role === "assistant";
                const live =
                  assistant &&
                  message.id === pendingQuestionId &&
                  !waitingForQuestion;
                return (
                  <MessageScrollerItem
                    key={message.id}
                    scrollAnchor={index === interview.transcript.length - 1}
                  >
                    <Message align={assistant ? "start" : "end"}>
                      <MessageContent>
                        <MessageHeader>
                          {t(
                            assistant
                              ? "interview.chat.interviewer"
                              : "interview.chat.you",
                          )}
                        </MessageHeader>
                        <Bubble
                          align={assistant ? "start" : "end"}
                          variant={assistant ? "muted" : "default"}
                        >
                          <BubbleContent
                            role={live ? "status" : undefined}
                            aria-live={live ? "polite" : undefined}
                            aria-atomic={live ? "true" : undefined}
                          >
                            <Markdown>{message.content}</Markdown>
                          </BubbleContent>
                        </Bubble>
                      </MessageContent>
                    </Message>
                  </MessageScrollerItem>
                );
              })}
              {waitingForQuestion ? (
                <MessageScrollerItem>
                  <Message align="start">
                    <MessageContent>
                      <MessageHeader>
                        {t("interview.chat.interviewer")}
                      </MessageHeader>
                      <Bubble align="start" variant="muted">
                        <BubbleContent
                          role="status"
                          aria-live="polite"
                          aria-atomic="true"
                        >
                          <span className="inline-flex items-center gap-2">
                            <span
                              aria-hidden
                              className="size-2 animate-pulse rounded-full bg-primary"
                            />
                            {t("interview.chat.typing")}
                          </span>
                        </BubbleContent>
                      </Bubble>
                    </MessageContent>
                  </Message>
                </MessageScrollerItem>
              ) : null}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton />
        </MessageScroller>
      </MessageScrollerProvider>

      <div className="border-t border-border p-3 md:p-4">
        {actionError ? (
          <p role="alert" className="mb-3 text-sm text-destructive">
            {actionError}
          </p>
        ) : null}
        {ready ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm leading-6 text-muted-foreground">
              {t("interview.chat.readyDescription")}
            </p>
            <div className="flex justify-end">
              <Button onClick={onFinish} disabled={action !== null}>
                {action === "finish" ? (
                  <>
                    <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    {t("interview.chat.finishing")}
                  </>
                ) : (
                  <>
                    <CheckCircleIcon aria-hidden className="size-4" />
                    {t("interview.chat.finish")}
                  </>
                )}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-end gap-2">
            <label htmlFor="interview-message" className="sr-only">
              {t("interview.chat.messageLabel")}
            </label>
            <Textarea
              id="interview-message"
              rows={3}
              value={answer}
              maxLength={20_000}
              disabled={action !== null}
              onChange={(event) => onAnswerChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  if (answer.trim()) onSend();
                }
              }}
              className="max-h-40 min-h-12 flex-1 resize-none"
              placeholder={t("interview.chat.placeholder")}
            />
            {hasPendingQuestion && !waitingForQuestion ? (
              <Button
                onClick={onSend}
                disabled={!answer.trim() || action !== null}
                aria-label={t("interview.chat.sendAria")}
              >
                <PaperPlaneTiltIcon aria-hidden className="size-4" />
              </Button>
            ) : (
              <Button
                variant="outline"
                onClick={onRetry}
                disabled={action !== null}
                aria-label={t("interview.chat.retryAria")}
              >
                <ArrowClockwiseIcon aria-hidden className="size-4" />
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
