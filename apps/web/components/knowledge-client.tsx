"use client";

import { useQuery } from "@tanstack/react-query";

import { QueryError } from "@/components/query-state";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { type MessageKey, useI18n } from "@/lib/i18n";

const dimensions = [
  "understanding",
  "explanation",
  "codeReading",
  "implementation",
  "debugging",
  "interview",
] as const;
type Dimension = (typeof dimensions)[number];
type Topic = {
  id: string;
  title: string;
  group: string;
  scores: Record<Dimension, number>;
  evidenceCount: number;
  reviewDue: boolean;
};

function dimensionKey(dimension: Dimension): MessageKey {
  return `skills.dimension.${dimension}` as MessageKey;
}

export function KnowledgeClient() {
  const { t } = useI18n();
  const query = useQuery({
    queryKey: ["knowledge"],
    queryFn: () => api<{ topics: Topic[] }>("/knowledge"),
  });
  if (query.isLoading) {
    return (
      <div role="status" aria-label={t("skills.loading")}>
        <Skeleton aria-hidden className="h-96" />
        <span className="sr-only">{t("skills.loading")}</span>
      </div>
    );
  }
  if (query.isError || !query.data) {
    return (
      <QueryError
        message={t("skills.unavailable")}
        retry={() => void query.refetch()}
      />
    );
  }
  if (!query.data.topics.length) {
    return (
      <div className="border-y border-border py-8">
        <h3 className="font-semibold">{t("skills.empty.title")}</h3>
        <p className="mt-1 max-w-[70ch] text-sm leading-6 text-muted-foreground">
          {t("skills.empty.description")}
        </p>
      </div>
    );
  }
  return (
    <>
      <div className="divide-y divide-border border-y border-border md:hidden">
        {query.data.topics.map((topic) => (
          <details key={topic.id} className="group py-1">
            <summary className="flex min-h-14 list-none items-center justify-between gap-3 rounded-md px-2 py-3 outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <span className="min-w-0">
                <span className="block truncate font-medium">
                  {topic.title}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {topic.group} ·{" "}
                  {t("skills.evidenceCount", { count: topic.evidenceCount })}
                </span>
              </span>
              {topic.reviewDue ? (
                <Badge variant="warning">{t("skills.reviewDue")}</Badge>
              ) : null}
            </summary>
            <dl className="grid gap-3 px-2 pb-4 pt-2">
              {dimensions.map((dimension) => (
                <div
                  key={dimension}
                  className="grid grid-cols-[1fr_auto] gap-3"
                >
                  <dt className="text-sm">{t(dimensionKey(dimension))}</dt>
                  <dd className="font-mono text-xs">
                    {t("skills.level", {
                      value: topic.scores[dimension].toFixed(1),
                    })}
                  </dd>
                  <Progress
                    value={topic.scores[dimension]}
                    max={5}
                    aria-label={`${topic.title}: ${t(dimensionKey(dimension))}`}
                    aria-valuetext={t("skills.level", {
                      value: topic.scores[dimension].toFixed(1),
                    })}
                    className="col-span-2 w-full"
                  />
                </div>
              ))}
            </dl>
          </details>
        ))}
      </div>

      <div
        data-slot="skills-table"
        role="region"
        aria-label={t("page.skills.description")}
        tabIndex={0}
        className="hidden overflow-x-auto rounded-lg border border-border md:block"
      >
        <table className="w-full min-w-[900px] border-collapse text-sm">
          <caption className="sr-only">{t("page.skills.description")}</caption>
          <thead className="bg-muted text-left text-xs text-muted-foreground">
            <tr>
              <th className="p-3 font-medium">{t("skills.topic")}</th>
              {dimensions.map((dimension) => (
                <th key={dimension} className="p-3 font-medium">
                  {t(dimensionKey(dimension))}
                </th>
              ))}
              <th className="p-3 font-medium">{t("skills.evidence")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {query.data.topics.map((topic) => (
              <tr key={topic.id} className="bg-card">
                <th
                  scope="row"
                  className="sticky left-0 z-10 bg-card p-3 text-left"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{topic.title}</span>
                    {topic.reviewDue ? (
                      <Badge variant="warning">{t("skills.reviewDue")}</Badge>
                    ) : null}
                  </div>
                  <span className="text-xs font-normal text-muted-foreground">
                    {topic.group}
                  </span>
                </th>
                {dimensions.map((dimension) => (
                  <td key={dimension} className="p-3">
                    <div className="flex items-center gap-2">
                      <Progress
                        value={topic.scores[dimension]}
                        max={5}
                        aria-label={`${topic.title}: ${t(dimensionKey(dimension))}`}
                        aria-valuetext={t("skills.level", {
                          value: topic.scores[dimension].toFixed(1),
                        })}
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
    </>
  );
}
