import { AgentChat } from "@/components/agent-chat";
import { PageHeader } from "@/components/page-header";

export default function ChatPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Агентная учебная комната"
        description="Переключай роль осознанно: Teacher проверяет понимание, Reviewer читает diff, Interviewer задаёт вопросы, Curator собирает доказательства прогресса."
      />
      <AgentChat />
    </div>
  );
}
