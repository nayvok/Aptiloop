import { MistakesClient } from "@/components/mistakes-client";
import { PageHeader } from "@/components/page-header";

export default function MistakesPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Журнал ошибок"
        description="Не коллекция промахов, а список проверяемых гипотез: что казалось верным, почему и когда проверить снова."
      />
      <MistakesClient />
    </div>
  );
}
