"use client";

import { KnowledgeClient } from "@/components/knowledge-client";
import { PageHeader } from "@/components/page-header";
import { useI18n } from "@/lib/i18n";

export default function SkillsPage() {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("nav.skills")}
        description={t("page.skills.description")}
      />
      <KnowledgeClient />
    </div>
  );
}
