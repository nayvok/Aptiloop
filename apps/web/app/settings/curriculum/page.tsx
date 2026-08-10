"use client";

import { CurriculumEditorClient } from "@/components/curriculum-editor-client";
import { PageHeader } from "@/components/page-header";
import { useI18n } from "@/lib/i18n";

export default function CurriculumEditorPage() {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("authoring.page.title")}
        description={t("authoring.page.description")}
      />
      <CurriculumEditorClient />
    </div>
  );
}
