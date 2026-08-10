"use client";

import { ChatCircleDotsIcon, WrenchIcon } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";

import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";

export default function DeveloperToolsPage() {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("ui.developerTools.title")}
        description={t("ui.developerTools.description")}
      />

      <section
        data-slot="developer-tool"
        aria-labelledby="agent-playground-title"
        className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5 sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="flex min-w-0 gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-md bg-activity-ai-surface text-activity-ai">
            <ChatCircleDotsIcon aria-hidden className="size-5" />
          </span>
          <div className="flex min-w-0 flex-col gap-1">
            <h3 id="agent-playground-title" className="font-semibold">
              {t("ui.developerTools.playgroundTitle")}
            </h3>
            <p className="max-w-[65ch] text-sm leading-6 text-muted-foreground">
              {t("ui.developerTools.playgroundDescription")}
            </p>
          </div>
        </div>
        <Button asChild className="shrink-0">
          <Link href="/chat">
            <ChatCircleDotsIcon aria-hidden />
            {t("ui.developerTools.openPlayground")}
          </Link>
        </Button>
      </section>

      <div className="flex gap-3 border-t border-border pt-5 text-sm text-muted-foreground">
        <WrenchIcon aria-hidden className="size-4 shrink-0 self-start" />
        <p className="max-w-[70ch] leading-6">
          {t("ui.developerTools.boundaryNote")}
        </p>
      </div>
    </div>
  );
}
