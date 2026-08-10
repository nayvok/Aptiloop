"use client";

import { PageHeader } from "@/components/page-header";
import { SettingsForm } from "@/components/settings-form";
import { useI18n } from "@/lib/i18n";

export default function SettingsPage() {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("nav.settings")}
        description={t("page.settings.description")}
      />
      <SettingsForm />
    </div>
  );
}
