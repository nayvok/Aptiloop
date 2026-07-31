import { FlashcardsClient } from "@/components/flashcards-client";
import { PageHeader } from "@/components/page-header";

export default function FlashcardsPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Карточки"
        description="Отредактируй и подтверди только те формулировки, которые действительно хочешь повторять. Экспорт остаётся локальным."
      />
      <FlashcardsClient />
    </div>
  );
}
