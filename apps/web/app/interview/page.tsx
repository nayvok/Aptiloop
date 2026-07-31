import { AgentChat } from "@/components/agent-chat";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/page-header";

export default function InterviewPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Техническое интервью"
        description="Отвечай одним сообщением за раз. Вопрос формируется без эталонного ответа в текущем контексте; оценка выполняется отдельным шагом."
        actions={
          <>
            <Badge variant="outline">JavaScript</Badge>
            <Badge variant="outline">Средняя сложность</Badge>
          </>
        }
      />
      <AgentChat initialRole="interviewer" />
    </div>
  );
}
