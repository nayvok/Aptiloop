"use client";

import { ArrowRightIcon, CaretDownIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { EmptyState, QueryError } from "@/components/query-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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

function MobileMasteryValue({
  label,
  ariaLabel,
  value,
  formattedValue,
  valueText,
}: {
  label: string;
  ariaLabel: string;
  value: number;
  formattedValue: string;
  valueText: string;
}) {
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2">
      <dt className="min-w-0 break-words text-sm font-medium">{label}</dt>
      <dd className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
        {formattedValue}
      </dd>
      <Progress
        value={value}
        max={5}
        aria-label={ariaLabel}
        aria-valuetext={valueText}
        className="col-span-2 h-1.5 [&_[data-slot=progress-indicator]]:bg-muted-foreground/60"
      />
    </div>
  );
}

export function KnowledgeClient() {
  const { formatNumber, t } = useI18n();
  const query = useQuery({
    queryKey: ["knowledge"],
    queryFn: () => api<{ topics: Topic[] }>("/learning/skills"),
  });

  if (query.isLoading) {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-label={t("skills.loading")}
        className="grid gap-6"
      >
        <span className="sr-only">{t("skills.loading")}</span>
        {[0, 1].map((group) => (
          <div key={group} aria-hidden className="min-w-0">
            <div className="pb-3">
              <Skeleton className="h-5 w-40" />
            </div>
            <div className="grid gap-2">
              {[0, 1].map((topic) => (
                <div
                  key={topic}
                  className="grid gap-4 rounded-control bg-surface-soft/70 p-4 min-[1180px]:grid-cols-[minmax(0,1.4fr)_repeat(6,minmax(5rem,0.6fr))_8rem]"
                >
                  <Skeleton className="h-10 w-52 max-w-[80%]" />
                  {dimensions.map((dimension) => (
                    <Skeleton key={dimension} className="h-8" />
                  ))}
                </div>
              ))}
            </div>
          </div>
        ))}
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
      <EmptyState
        title={t("skills.empty.title")}
        description={t("skills.empty.description")}
        action={
          <Button asChild>
            <Link href="/courses">
              {t("nav.courses")}
              <ArrowRightIcon aria-hidden data-icon="inline-end" />
            </Link>
          </Button>
        }
      />
    );
  }

  const groupedTopics = new Map<string, Topic[]>();
  for (const topic of query.data.topics) {
    const group = groupedTopics.get(topic.group);
    if (group) group.push(topic);
    else groupedTopics.set(topic.group, [topic]);
  }
  const firstDueTopic = query.data.topics.find((topic) => topic.reviewDue);

  return (
    <div data-slot="skills-index" className="flex min-w-0 flex-col gap-5">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-[72ch] text-sm leading-6 text-muted-foreground">
          {t("skills.scaleDescription")}
        </p>
        {firstDueTopic ? (
          <Button asChild size="sm" className="w-full shrink-0 sm:w-auto">
            <Link
              href="/review"
              aria-label={`${t("skills.reviewDue")}: ${firstDueTopic.title}`}
            >
              {t("skills.reviewDue")}
              <ArrowRightIcon aria-hidden data-icon="inline-end" />
            </Link>
          </Button>
        ) : null}
      </div>

      {Array.from(groupedTopics.entries()).map(
        ([group, topics], groupIndex) => {
          const firstDueInGroup = topics.find((topic) => topic.reviewDue)?.id;
          return (
            <section
              key={group}
              data-slot="skill-group"
              aria-labelledby={`skill-group-${groupIndex}`}
              className="min-w-0"
            >
              <header className="pb-2">
                <h2
                  id={`skill-group-${groupIndex}`}
                  className="break-words text-lg font-semibold [overflow-wrap:anywhere]"
                >
                  {group}
                </h2>
              </header>

              <div data-slot="skill-topic-list" className="min-w-0">
                <div
                  data-slot="skill-topic-disclosures"
                  className="grid gap-2 min-[1180px]:hidden"
                >
                  {topics.map((topic) => (
                    <Collapsible
                      key={topic.id}
                      defaultOpen={topic.id === firstDueInGroup}
                      data-slot="skill-topic"
                      className="min-w-0 rounded-control bg-surface-soft/65 px-4 data-[state=open]:bg-surface-soft"
                    >
                      <header className="flex min-w-0 items-start gap-3 py-4">
                        <div className="min-w-0 flex-1">
                          <h3 className="break-words text-base font-semibold leading-6 [overflow-wrap:anywhere]">
                            {topic.title}
                          </h3>
                          <p className="mt-1 text-xs leading-5 text-muted-foreground">
                            {t("skills.evidenceCount", {
                              count: formatNumber(topic.evidenceCount),
                            })}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          {topic.reviewDue ? (
                            <Badge variant="warning">
                              {t("skills.reviewDue")}
                            </Badge>
                          ) : null}
                          <CollapsibleTrigger asChild>
                            <Button
                              type="button"
                              size="icon-sm"
                              variant="ghost"
                              className="group/skill-trigger rounded-control"
                              aria-label={`${topic.title}: ${t("skills.scaleDescription")}`}
                            >
                              <CaretDownIcon
                                aria-hidden
                                className="transition-transform duration-150 group-data-[state=open]/skill-trigger:rotate-180 motion-reduce:transition-none"
                              />
                            </Button>
                          </CollapsibleTrigger>
                        </div>
                      </header>
                      <CollapsibleContent>
                        <dl className="grid gap-4 pb-4 pt-1">
                          {dimensions.map((dimension) => {
                            const value = topic.scores[dimension];
                            const formattedValue = formatNumber(value, {
                              minimumFractionDigits: 1,
                              maximumFractionDigits: 1,
                            });
                            const label = t(dimensionKey(dimension));
                            return (
                              <MobileMasteryValue
                                key={dimension}
                                label={label}
                                ariaLabel={`${topic.title}: ${label}`}
                                value={value}
                                formattedValue={formattedValue}
                                valueText={t("skills.level", {
                                  value: formattedValue,
                                })}
                              />
                            );
                          })}
                        </dl>
                      </CollapsibleContent>
                    </Collapsible>
                  ))}
                </div>

                <div
                  data-slot="skill-topic-table"
                  className="hidden overflow-hidden rounded-panel bg-surface-raised min-[1180px]:block"
                >
                  <Table className="min-w-[64rem] table-fixed">
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="w-[18rem] px-4 text-xs text-muted-foreground">
                          {t("skills.topic")}
                        </TableHead>
                        {dimensions.map((dimension) => (
                          <TableHead
                            key={dimension}
                            className="px-3 text-xs text-muted-foreground"
                          >
                            {t(dimensionKey(dimension))}
                          </TableHead>
                        ))}
                        <TableHead className="w-32 px-3 text-right text-xs text-muted-foreground">
                          {t("skills.evidence")}
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {topics.map((topic) => (
                        <TableRow key={topic.id} data-slot="skill-topic">
                          <TableCell className="min-w-0 whitespace-normal px-4 py-3">
                            <div className="flex min-w-0 items-start gap-2">
                              <div className="min-w-0 flex-1">
                                <span className="block break-words font-medium leading-5 [overflow-wrap:anywhere]">
                                  {topic.title}
                                </span>
                              </div>
                              {topic.reviewDue ? (
                                <Badge variant="warning" className="shrink-0">
                                  {t("skills.reviewDue")}
                                </Badge>
                              ) : null}
                            </div>
                          </TableCell>
                          {dimensions.map((dimension) => {
                            const value = topic.scores[dimension];
                            const formattedValue = formatNumber(value, {
                              minimumFractionDigits: 1,
                              maximumFractionDigits: 1,
                            });
                            return (
                              <TableCell
                                key={dimension}
                                className="px-3 py-3 font-mono text-xs text-muted-foreground tabular-nums"
                                title={t("skills.level", {
                                  value: formattedValue,
                                })}
                              >
                                {formattedValue}
                              </TableCell>
                            );
                          })}
                          <TableCell className="px-3 py-3 text-right font-mono text-xs tabular-nums">
                            {formatNumber(topic.evidenceCount)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </section>
          );
        },
      )}
    </div>
  );
}
