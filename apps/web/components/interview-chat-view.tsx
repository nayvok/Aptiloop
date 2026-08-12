"use client";

import {
  ArrowClockwiseIcon,
  CheckCircleIcon,
  PaperPlaneTiltIcon,
} from "@phosphor-icons/react";

import type { Interview } from "@/components/interview-client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { Markdown } from "@/components/ui/markdown";
import { Progress } from "@/components/ui/progress";
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
import { Spinner } from "@/components/ui/spinner";
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

const markdownContentClassName =
  "min-w-0 max-w-full [overflow-wrap:anywhere] [&:has(table)]:overflow-x-auto [&_pre]:max-w-full [&_table]:min-w-max";

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
  const retryAction = Boolean(actionError) || !hasPendingQuestion;
  const assistantMessages = interview.transcript.filter(
    (message) => message.role === "assistant",
  ).length;
  const currentQuestion = Math.max(
    1,
    Math.min(interview.setup.questionCount, assistantMessages),
  );
  const answeredProgress = t("interview.session.answeredProgress", {
    answered: interview.progress.questionsAnswered,
    total: interview.setup.questionCount,
  });

  return (
    <div
      aria-busy={action !== null}
      className="flex min-w-0 flex-col bg-background"
    >
      <div data-slot="interview-question-progress" className="pb-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold">
            {t("interview.session.questionProgress", {
              current: currentQuestion,
              total: interview.setup.questionCount,
            })}
          </p>
          <span className="text-xs font-medium text-muted-foreground">
            {answeredProgress}
          </span>
        </div>
        <Progress
          className="mt-3 h-1.5"
          value={interview.progress.questionsAnswered}
          max={interview.setup.questionCount}
          aria-label={answeredProgress}
        />
      </div>
      <MessageScrollerProvider>
        <MessageScroller className="h-[clamp(20rem,40vh,30rem)] flex-none">
          <MessageScrollerViewport
            role="region"
            aria-label={t("interview.chat.transcript")}
            className="py-6 pr-2"
          >
            <MessageScrollerContent className="mx-0 max-w-none">
              {interview.transcript.length === 0 && !waitingForQuestion ? (
                <div className="my-auto w-full max-w-xl py-12 text-left">
                  <p className="font-medium">{t("interview.opening.status")}</p>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    {t("interview.opening.description")}
                  </p>
                </div>
              ) : null}
              {interview.transcript.map((message, index) => {
                const assistant = message.role === "assistant";
                const label = t(
                  assistant
                    ? "interview.chat.interviewer"
                    : "interview.chat.you",
                );
                const live =
                  assistant &&
                  message.id === pendingQuestionId &&
                  !waitingForQuestion;
                return (
                  <MessageScrollerItem
                    key={message.id}
                    scrollAnchor={index === interview.transcript.length - 1}
                  >
                    <Message
                      align={assistant ? "start" : "end"}
                      aria-label={label}
                    >
                      <MessageContent>
                        <MessageHeader>{label}</MessageHeader>
                        <Bubble
                          align={assistant ? "start" : "end"}
                          variant={assistant ? "ghost" : "secondary"}
                        >
                          <BubbleContent
                            role={live ? "status" : undefined}
                            aria-live={live ? "polite" : undefined}
                            aria-atomic={live ? "true" : undefined}
                          >
                            <Markdown
                              baseHeadingLevel={2}
                              className={`${markdownContentClassName} max-w-[72ch]`}
                            >
                              {message.content}
                            </Markdown>
                          </BubbleContent>
                        </Bubble>
                      </MessageContent>
                    </Message>
                  </MessageScrollerItem>
                );
              })}
              {waitingForQuestion ? (
                <MessageScrollerItem scrollAnchor>
                  <Message
                    align="start"
                    aria-label={t("interview.chat.interviewer")}
                  >
                    <MessageContent>
                      <MessageHeader>
                        {t("interview.chat.interviewer")}
                      </MessageHeader>
                      <Bubble align="start" variant="ghost">
                        <BubbleContent>
                          <span
                            role="status"
                            aria-live="polite"
                            aria-atomic="true"
                            className="inline-flex min-h-6 items-center gap-2 text-muted-foreground"
                          >
                            <Spinner />
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

      <div className="flex min-w-0 flex-col gap-3 pt-4">
        {actionError ? (
          <Alert id="interview-chat-error" variant="destructive">
            <AlertDescription>{actionError}</AlertDescription>
          </Alert>
        ) : null}
        {ready ? (
          <div className="flex min-w-0 flex-col gap-3 rounded-control bg-surface-soft/60 p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="min-w-0 max-w-2xl text-sm leading-6 text-muted-foreground [overflow-wrap:anywhere]">
              {t("interview.chat.readyDescription")}
            </p>
            <Button
              className="max-w-full whitespace-normal sm:shrink-0"
              onClick={onFinish}
              disabled={action !== null}
            >
              {action === "finish" ? (
                <>
                  <Spinner />
                  {t("interview.chat.finishing")}
                </>
              ) : (
                <>
                  <CheckCircleIcon data-icon="inline-start" aria-hidden />
                  {t("interview.chat.finish")}
                </>
              )}
            </Button>
          </div>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!retryAction && answer.trim() && action === null) onSend();
            }}
          >
            <label htmlFor="interview-message" className="sr-only">
              {t("interview.chat.messageLabel")}
            </label>
            <InputGroup data-disabled={action !== null}>
              <InputGroupTextarea
                id="interview-message"
                rows={3}
                value={answer}
                maxLength={20_000}
                disabled={action !== null}
                aria-describedby={
                  actionError ? "interview-chat-error" : undefined
                }
                onChange={(event) => onAnswerChange(event.target.value)}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    !event.shiftKey &&
                    !event.nativeEvent.isComposing &&
                    action === null
                  ) {
                    event.preventDefault();
                    if (hasPendingQuestion && !answer.trim()) return;
                    if (retryAction) onRetry();
                    else onSend();
                  }
                }}
                placeholder={t("interview.chat.placeholder")}
              />
              {!waitingForQuestion ? (
                <InputGroupAddon
                  align="block-end"
                  className="flex-wrap justify-end gap-2 border-t border-border/60 pt-3"
                >
                  {retryAction ? (
                    <InputGroupButton
                      size="sm"
                      variant="outline"
                      aria-label={t("interview.chat.retryAria")}
                      disabled={hasPendingQuestion && !answer.trim()}
                      onClick={onRetry}
                    >
                      <ArrowClockwiseIcon
                        data-icon="inline-start"
                        aria-hidden
                      />
                      {t("interview.chat.retryAria")}
                    </InputGroupButton>
                  ) : (
                    <InputGroupButton
                      type="submit"
                      size="sm"
                      variant="default"
                      aria-label={t("interview.chat.sendAria")}
                      disabled={!answer.trim()}
                    >
                      <PaperPlaneTiltIcon
                        data-icon="inline-start"
                        aria-hidden
                      />
                      {t("interview.chat.sendAria")}
                    </InputGroupButton>
                  )}
                </InputGroupAddon>
              ) : null}
            </InputGroup>
          </form>
        )}
      </div>
    </div>
  );
}
