import { CurriculumEditorClient } from "@/components/curriculum-editor-client";
import { PageHeader } from "@/components/page-header";

export default function CurriculumEditorPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Редактор программы"
        description="Создавайте версионный граф недель, дней и юнитов. Опубликованные ревизии неизменяемы; продолжение работы начинается с клона-черновика."
      />
      <CurriculumEditorClient />
    </div>
  );
}
