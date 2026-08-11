"use client";

import {
  ChatCircleDotsIcon,
  ShieldCheckIcon,
  WrenchIcon,
} from "@phosphor-icons/react";
import Link from "next/link";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";

export function DeveloperToolsClient() {
  const { t } = useI18n();

  return (
    <div data-slot="developer-tools" className="flex min-w-0 flex-col gap-8">
      <PageHeader
        title={t("ui.developerTools.title")}
        description={t("ui.developerTools.description")}
      />

      <section
        data-slot="developer-tool"
        aria-labelledby="agent-playground-title"
        className="rounded-[18px] bg-surface-raised p-5 shadow-[0_16px_45px_oklch(0_0_0/0.07)] sm:p-7"
      >
        <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex min-w-0 gap-3">
            <ChatCircleDotsIcon
              aria-hidden
              className="mt-1 size-5 shrink-0 text-activity-ai"
            />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2
                  id="agent-playground-title"
                  className="text-lg font-semibold tracking-[-0.015em]"
                >
                  {t("ui.developerTools.playgroundTitle")}
                </h2>
                <Badge variant="secondary">
                  {t("ui.developerTools.compatibilityBadge")}
                </Badge>
              </div>
              <p className="mt-2 max-w-[68ch] text-sm leading-6 text-muted-foreground">
                {t("ui.developerTools.playgroundDescription")}
              </p>
            </div>
          </div>
          <Button asChild className="w-full shrink-0 sm:w-auto">
            <Link href="/chat">
              <ChatCircleDotsIcon aria-hidden data-icon="inline-start" />
              {t("ui.developerTools.openPlayground")}
            </Link>
          </Button>
        </div>
      </section>

      <section
        aria-labelledby="developer-boundary-title"
        className="rounded-[14px] border border-border/60 bg-card p-5 sm:p-6"
      >
        <div className="flex min-w-0 gap-3">
          <WrenchIcon
            aria-hidden
            className="mt-1 size-5 shrink-0 text-muted-foreground"
          />
          <div className="min-w-0">
            <h2
              id="developer-boundary-title"
              className="text-lg font-semibold tracking-[-0.015em]"
            >
              {t("ui.developerTools.boundaryTitle")}
            </h2>
            <p className="mt-1 max-w-[70ch] text-sm leading-6 text-muted-foreground">
              {t("ui.developerTools.boundaryNote")}
            </p>
          </div>
        </div>

        <dl className="mt-5 divide-y divide-border/60 rounded-xl bg-surface-soft/50 px-4">
          <div className="flex flex-col gap-2 py-4 sm:flex-row sm:items-center sm:justify-between">
            <dt className="flex items-center gap-2 text-sm font-medium">
              <ShieldCheckIcon aria-hidden className="size-4" />
              {t("ui.developerTools.executionBoundary")}
            </dt>
            <dd className="text-sm text-muted-foreground sm:text-right">
              {t("ui.developerTools.serverAllowlist")}
            </dd>
          </div>
          <div className="flex flex-col gap-2 py-4 sm:flex-row sm:items-center sm:justify-between">
            <dt className="text-sm font-medium">
              {t("ui.developerTools.reviewerBoundary")}
            </dt>
            <dd className="text-sm text-muted-foreground sm:text-right">
              {t("ui.developerTools.readOnly")}
            </dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
