"use client";

import { useQuery } from "@tanstack/react-query";
import {
  ArrowCounterClockwiseIcon,
  CalendarBlankIcon,
} from "@phosphor-icons/react";

import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { EmptyState, QueryError } from "@/components/query-state";
import { Skeleton } from "@/components/ui/skeleton";

type Mistake = {
  id: string;
  topic: string;
  thought: string;
  correction: string;
  cause: string;
  repeated: boolean;
  reviewAt: string;
};

export function MistakesClient() {
  const query = useQuery({
    queryKey: ["mistakes"],
    queryFn: () => api<{ mistakes: Mistake[] }>("/mistakes"),
  });
  if (query.isLoading)
    return (
      <div role="status" aria-label="Загружаю журнал ошибок">
        <Skeleton aria-hidden className="h-80" />
        <span className="sr-only">Загружаю журнал ошибок…</span>
      </div>
    );
  if (query.isError || !query.data)
    return (
      <QueryError
        message="Журнал ошибок недоступен"
        retry={() => void query.refetch()}
      />
    );
  if (!query.data.mistakes.length)
    return (
      <EmptyState
        title="Ошибки ещё не зафиксированы"
        description="После объяснений, квиза и review здесь появится контекст ошибки и дата повторения."
      />
    );
  return (
    <div className="divide-y divide-border border-y border-border">
      {query.data.mistakes.map((mistake) => (
        <article
          key={mistake.id}
          className="grid gap-4 py-5 lg:grid-cols-[180px_1fr_1fr]"
        >
          <div className="flex flex-col items-start gap-2">
            <Badge variant="outline">{mistake.topic}</Badge>
            {mistake.repeated ? (
              <Badge variant="warning">
                <ArrowCounterClockwiseIcon aria-hidden />
                Повторилась
              </Badge>
            ) : null}
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <CalendarBlankIcon aria-hidden />
              {new Date(mistake.reviewAt).toLocaleDateString("ru-RU")}
            </span>
          </div>
          <div>
            <h3 className="text-xs font-medium text-muted-foreground">
              КАК Я ДУМАЛ
            </h3>
            <p className="mt-2 text-sm leading-6">{mistake.thought}</p>
            <p className="mt-3 text-xs leading-5 text-muted-foreground">
              Причина: {mistake.cause}
            </p>
          </div>
          <div>
            <h3 className="text-xs font-medium text-muted-foreground">
              ТОЧНЕЕ
            </h3>
            <p className="mt-2 text-sm leading-6">{mistake.correction}</p>
          </div>
        </article>
      ))}
    </div>
  );
}
