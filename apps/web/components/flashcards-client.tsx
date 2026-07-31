"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckIcon, DownloadSimpleIcon, XIcon } from "@phosphor-icons/react";

import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, QueryError } from "@/components/query-state";
import { Skeleton } from "@/components/ui/skeleton";

type Flashcard = {
  id: string;
  topic: string;
  question: string;
  answer: string;
  status: "candidate" | "approved" | "rejected";
};

export function FlashcardsClient() {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["flashcards"],
    queryFn: () => api<{ flashcards: Flashcard[] }>("/flashcards"),
  });
  const update = useMutation({
    mutationFn: ({ id, status }: { id: string; status: Flashcard["status"] }) =>
      api(`/flashcards/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["flashcards"] }),
  });
  if (query.isLoading) return <Skeleton className="h-80" />;
  if (query.isError || !query.data)
    return (
      <QueryError
        message="Карточки недоступны"
        retry={() => void query.refetch()}
      />
    );
  if (!query.data.flashcards.length)
    return (
      <EmptyState
        title="Кандидатов пока нет"
        description="Curator предложит карточки после завершения дня. Ни одна из них не подтверждается автоматически."
      />
    );
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap justify-end gap-2">
        {(["markdown", "csv", "tsv"] as const).map((format) => (
          <Button key={format} asChild variant="outline" size="sm">
            <a href={`/api/flashcards/export?format=${format}`} download>
              <DownloadSimpleIcon aria-hidden />
              {format.toUpperCase()}
            </a>
          </Button>
        ))}
      </div>
      <div className="divide-y divide-border rounded-xl border border-border bg-card">
        {query.data.flashcards.map((card) => (
          <article
            key={card.id}
            className="grid gap-4 p-5 lg:grid-cols-[160px_1fr_1fr_auto]"
          >
            <div>
              <Badge
                variant={
                  card.status === "approved"
                    ? "success"
                    : card.status === "rejected"
                      ? "error"
                      : "warning"
                }
              >
                {card.status}
              </Badge>
              <p className="mt-2 text-xs text-muted-foreground">{card.topic}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">
                ВОПРОС
              </p>
              <p className="mt-2 text-sm leading-6">{card.question}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">ОТВЕТ</p>
              <p className="mt-2 text-sm leading-6">{card.answer}</p>
            </div>
            <div className="flex gap-1">
              <Button
                aria-label="Подтвердить карточку"
                size="icon"
                variant="outline"
                onClick={() =>
                  update.mutate({ id: card.id, status: "approved" })
                }
              >
                <CheckIcon aria-hidden />
              </Button>
              <Button
                aria-label="Отклонить карточку"
                size="icon"
                variant="ghost"
                onClick={() =>
                  update.mutate({ id: card.id, status: "rejected" })
                }
              >
                <XIcon aria-hidden />
              </Button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
