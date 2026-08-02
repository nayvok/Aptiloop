import { PageHeader } from "@/components/page-header";
import { SettingsForm } from "@/components/settings-form";
import { Button } from "@/components/ui/button";
import Link from "next/link";

export default function SettingsPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Настройки"
        description="Тема, AI-роли и локальные подключения. Credentials остаются в provider-owned хранилище или environment и никогда не возвращаются в UI."
        actions={
          <Button asChild variant="outline">
            <Link href="/settings/curriculum">Редактор программы</Link>
          </Button>
        }
      />
      <SettingsForm />
    </div>
  );
}
