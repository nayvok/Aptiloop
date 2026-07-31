"use client";

import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { QueryError } from "@/components/query-state";
import { Skeleton } from "@/components/ui/skeleton";

const labels = {
  understanding: "Понимание",
  explanation: "Объяснение",
  codeReading: "Чтение",
  implementation: "Реализация",
  debugging: "Отладка",
  interview: "Интервью",
} as const;
type Dimension = keyof typeof labels;
type Topic = {
  id: string;
  title: string;
  group: string;
  scores: Record<Dimension, number>;
  evidenceCount: number;
  reviewDue: boolean;
};

export function KnowledgeClient() {
  const query = useQuery({
    queryKey: ["knowledge"],
    queryFn: () => api<{ topics: Topic[] }>("/knowledge"),
  });
  if (query.isLoading) return <Skeleton className="h-96" />;
  if (query.isError || !query.data)
    return (
      <QueryError
        message="Карта знаний недоступна"
        retry={() => void query.refetch()}
      />
    );
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full min-w-[900px] border-collapse text-sm">
        <thead className="bg-muted text-left text-xs text-muted-foreground">
          <tr>
            <th className="p-3 font-medium">Тема</th>
            {Object.values(labels).map((label) => (
              <th key={label} className="p-3 font-medium">
                {label}
              </th>
            ))}
            <th className="p-3 font-medium">Evidence</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {query.data.topics.map((topic) => (
            <tr key={topic.id} className="bg-card">
              <td className="p-3">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{topic.title}</span>
                  {topic.reviewDue ? (
                    <Badge variant="warning">повторить</Badge>
                  ) : null}
                </div>
                <span className="text-xs text-muted-foreground">
                  {topic.group}
                </span>
              </td>
              {(Object.keys(labels) as Dimension[]).map((dimension) => (
                <td key={dimension} className="p-3">
                  <div className="flex items-center gap-2">
                    <Progress
                      value={topic.scores[dimension] * 20}
                      className="w-16"
                    />
                    <span className="font-mono text-xs">
                      {topic.scores[dimension].toFixed(1)}
                    </span>
                  </div>
                </td>
              ))}
              <td className="p-3 font-mono text-xs">{topic.evidenceCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
