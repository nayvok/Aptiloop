import { AgentChat } from "@/components/agent-chat";
import { PageHeader } from "@/components/page-header";

export default function ChatPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Агентная учебная комната"
        description="Переключай роль осознанно: Преподаватель проверяет понимание, Проверка решения читает diff, Интервьюер задаёт вопросы, Итоги и повторение собирают подтверждения прогресса."
      />
      <AgentChat />
    </div>
  );
}
