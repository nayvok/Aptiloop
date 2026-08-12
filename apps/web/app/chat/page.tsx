"use client";

import { Suspense, useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { AgentChat } from "@/components/agent-chat";
import { PageHeader } from "@/components/page-header";
import { LoadingState } from "@/components/ui/loading-state";
import { chatRoleHref, resolveChatRole, type ChatRole } from "@/lib/chat-role";
import { useI18n } from "@/lib/i18n";

function ChatRoleRoute() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentSearch = searchParams.toString();
  const { role, needsCanonicalization } = resolveChatRole(
    searchParams.getAll("role"),
  );

  useEffect(() => {
    if (!needsCanonicalization) return;
    router.replace(chatRoleHref(pathname, currentSearch, role), {
      scroll: false,
    });
  }, [currentSearch, needsCanonicalization, pathname, role, router]);

  const selectRole = (nextRole: ChatRole) => {
    if (nextRole === role && !needsCanonicalization) return;
    router.push(chatRoleHref(pathname, currentSearch, nextRole), {
      scroll: false,
    });
  };

  return <AgentChat key={role} role={role} onRoleChange={selectRole} />;
}

function ChatRoleFallback() {
  return (
    <LoadingState
      label="chat.status.loading"
      variant="panel"
      className="flex-1"
    />
  );
}

export default function ChatPage() {
  const { t } = useI18n();
  return (
    <div className="flex h-[calc(100dvh-13.5rem)] min-h-[28rem] w-full min-w-0 flex-col gap-6 md:h-[calc(100dvh-9.75rem)] md:gap-8">
      <PageHeader
        title={t("chat.page.title")}
        description={t("chat.page.description")}
      />
      <Suspense fallback={<ChatRoleFallback />}>
        <ChatRoleRoute />
      </Suspense>
    </div>
  );
}
