import { FlashcardsClient } from "@/components/flashcards-client";
import { PageHeader } from "@/components/page-header";

export default function FlashcardsPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Карточки"
        description="Проверь формулировку и подтверди только те карточки, которые действительно хочешь повторять. Экспорт остаётся локальным."
      />
      <FlashcardsClient />
    </div>
  );
}
