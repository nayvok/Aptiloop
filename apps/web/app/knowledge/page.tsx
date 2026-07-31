import { KnowledgeClient } from "@/components/knowledge-client";
import { PageHeader } from "@/components/page-header";

export default function KnowledgePage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Карта знаний"
        description="Шесть независимых измерений. Высокая оценка требует нескольких видов evidence в разные дни — один правильный ответ недостаточен."
      />
      <KnowledgeClient />
    </div>
  );
}
