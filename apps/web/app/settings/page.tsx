import { PageHeader } from "@/components/page-header";
import { SettingsForm } from "@/components/settings-form";

export default function SettingsPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Настройки"
        description="Пути, модели и локальные endpoints. Credentials остаются в provider-owned хранилище или environment и никогда не возвращаются в UI."
      />
      <SettingsForm />
    </div>
  );
}
