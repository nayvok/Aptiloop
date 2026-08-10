"use client";

import { AgentChat } from "@/components/agent-chat";
import { PageHeader } from "@/components/page-header";
import { useI18n } from "@/lib/i18n";

export default function ChatPage() {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("chat.page.title")}
        description={t("chat.page.description")}
      />
      <AgentChat />
    </div>
  );
}
