"use client";

import {
  ArrowLeftIcon,
  ArrowRightIcon,
  DownloadSimpleIcon,
  PencilSimpleIcon,
  SparkleIcon,
} from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";

import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { FieldLegend, FieldSet } from "@/components/ui/field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const assistedPaths = [
  {
    id: "external",
    href: "/courses/new/external",
    icon: DownloadSimpleIcon,
    title: "authoring.external.title",
    description: "authoring.external.description",
    guidance: "authoring.external.guidance",
    badge: "authoring.external.badge",
  },
  {
    id: "connected",
    href: "/courses/new/guided",
    icon: SparkleIcon,
    title: "authoring.connected.title",
    description: "authoring.connected.description",
    guidance: "authoring.connected.guidance",
    badge: "authoring.connected.badge",
  },
] as const;

export default function NewCoursePage() {
  const { t } = useI18n();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedPathId = searchParams.get("path");
  const selectedPathId = assistedPaths.find(
    (path) => path.id === requestedPathId,
  )?.id;
  const selectedPath = assistedPaths.find((path) => path.id === selectedPathId);
  const searchParamString = searchParams.toString();

  useEffect(() => {
    if (requestedPathId === null || selectedPathId) return;
    const next = new URLSearchParams(searchParamString);
    next.delete("path");
    const serialized = next.toString();
    router.replace(serialized ? `${pathname}?${serialized}` : pathname, {
      scroll: false,
    });
  }, [pathname, requestedPathId, router, searchParamString, selectedPathId]);

  const selectPath = (value: string) => {
    const nextPath = assistedPaths.find((path) => path.id === value)?.id;
    if (!nextPath || nextPath === selectedPathId) return;
    const next = new URLSearchParams(searchParamString);
    next.set("path", nextPath);
    router.push(`${pathname}?${next.toString()}`, { scroll: false });
  };
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-3">
          <Link href="/courses">
            <ArrowLeftIcon aria-hidden data-icon="inline-start" />
            {t("nav.courses")}
          </Link>
        </Button>
      </div>
      <PageHeader
        title={t("courses.create.title")}
        description={t("authoring.entry.description")}
      />

      <FieldSet className="w-full min-w-0 gap-5 pb-1">
        <div>
          <FieldLegend className="text-sm font-semibold">
            {t("authoring.entry.assistedTitle")}
          </FieldLegend>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
            {t("authoring.entry.assistedDescription")}
          </p>
        </div>
        <RadioGroup
          data-slot="course-creation-paths"
          value={selectedPathId ?? null}
          onValueChange={selectPath}
          className="grid gap-3 md:grid-cols-2"
        >
          {assistedPaths.map((path) => {
            const descriptionId = `${path.id}-description`;
            const guidanceId = `${path.id}-guidance`;
            const badgeId = `${path.id}-badge`;
            return (
              <label
                key={path.id}
                htmlFor={`${path.id}-path`}
                className={cn(
                  "grid min-w-0 cursor-pointer grid-cols-[auto_2.75rem_minmax(0,1fr)] gap-x-3 gap-y-2 rounded-[14px] bg-surface-soft/55 p-4 transition-colors has-data-[state=checked]:bg-accent hover:bg-accent/70 sm:grid-cols-[auto_3rem_minmax(0,1fr)] sm:items-start sm:gap-x-4 sm:p-5",
                )}
              >
                <RadioGroupItem
                  id={`${path.id}-path`}
                  value={path.id}
                  aria-describedby={`${descriptionId} ${guidanceId} ${badgeId}`}
                  className="mt-1 border-foreground/45 text-foreground"
                />
                <span className="grid size-11 place-items-center rounded-lg border border-border bg-muted/50 text-muted-foreground sm:size-12">
                  <path.icon aria-hidden />
                </span>
                <span className="min-w-0">
                  <strong className="block break-words text-base leading-6 font-semibold">
                    {t(path.title)}
                  </strong>
                  <span
                    id={descriptionId}
                    className="mt-1 block break-words text-sm leading-6 text-muted-foreground"
                  >
                    {t(path.description)}
                  </span>
                  <span
                    id={guidanceId}
                    className="mt-3 block border-l-2 border-primary/45 pl-3 text-sm leading-6"
                  >
                    {t(path.guidance)}
                  </span>
                </span>
                <span
                  id={badgeId}
                  className="col-start-3 min-w-0 break-words text-xs leading-5 font-medium text-muted-foreground"
                >
                  {t(path.badge)}
                </span>
              </label>
            );
          })}
        </RadioGroup>

        <div className="flex min-w-0 flex-col gap-3 pt-1 sm:flex-row sm:items-center sm:justify-between">
          <Button asChild variant="outline" className="w-full sm:w-auto">
            <Link href="/courses">{t("authoring.common.cancel")}</Link>
          </Button>
          <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
            <p className="min-w-0 text-sm text-muted-foreground sm:text-right">
              {t(
                selectedPath
                  ? "authoring.entry.continueReady"
                  : "authoring.entry.continueHint",
              )}
            </p>
            {selectedPath ? (
              <Button asChild className="w-full sm:w-auto">
                <Link href={selectedPath.href}>
                  {t("authoring.common.continue")}
                  <ArrowRightIcon aria-hidden data-icon="inline-end" />
                </Link>
              </Button>
            ) : (
              <Button disabled className="w-full sm:w-auto">
                {t("authoring.common.continue")}
                <ArrowRightIcon aria-hidden data-icon="inline-end" />
              </Button>
            )}
          </div>
        </div>
      </FieldSet>

      <section className="flex w-full min-w-0 flex-col gap-4 rounded-[14px] bg-surface-soft/45 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <PencilSimpleIcon aria-hidden className="text-muted-foreground" />
            <h2 className="text-sm font-semibold">
              {t("authoring.manual.fallback")}
            </h2>
          </div>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
            {t("authoring.manual.fallbackDescription")}
          </p>
        </div>
        <Button asChild variant="ghost" className="w-full sm:w-auto">
          <Link href="/courses/new/manual">
            {t("authoring.manual.start")}
            <ArrowRightIcon aria-hidden data-icon="inline-end" />
          </Link>
        </Button>
      </section>
    </div>
  );
}
