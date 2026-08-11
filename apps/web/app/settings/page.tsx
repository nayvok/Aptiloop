"use client";

import { Suspense } from "react";

import { PageHeader } from "@/components/page-header";
import { SettingsForm } from "@/components/settings-form";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/lib/i18n";

export default function SettingsPage() {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("nav.settings")}
        description={t("page.settings.description")}
      />
      <Suspense
        fallback={
          <div
            role="status"
            aria-label={t("query.loadingSettings")}
            className="flex min-w-0 flex-col gap-4"
          >
            <span className="sr-only">{t("query.loadingSettings")}</span>
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-56 w-full" />
          </div>
        }
      >
        <SettingsForm />
      </Suspense>
    </div>
  );
}
