import { ChatCircleDotsIcon, WrenchIcon } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";

import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";

export default function DeveloperToolsPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Инструменты разработчика"
        description="Диагностика и ручные инструменты для проверки provider lifecycle. Они не входят в основной учебный маршрут."
      />

      <section
        data-slot="developer-tool"
        aria-labelledby="agent-playground-title"
        className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5 sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="flex min-w-0 gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-md bg-activity-ai-surface text-activity-ai">
            <ChatCircleDotsIcon aria-hidden className="size-5" />
          </span>
          <div className="flex min-w-0 flex-col gap-1">
            <h3 id="agent-playground-title" className="font-semibold">
              Agent Playground
            </h3>
            <p className="max-w-[65ch] text-sm leading-6 text-muted-foreground">
              Ручной диалог с выбранной ролью, моделью и видимыми tool events.
              Reviewer остаётся read-only и не может применять изменения.
            </p>
          </div>
        </div>
        <Button asChild className="shrink-0">
          <Link href="/chat">
            <ChatCircleDotsIcon aria-hidden />
            Открыть Playground
          </Link>
        </Button>
      </section>

      <div className="flex gap-3 border-t border-border pt-5 text-sm text-muted-foreground">
        <WrenchIcon aria-hidden className="size-4 shrink-0 self-start" />
        <p className="max-w-[70ch] leading-6">
          Встроенного terminal UI и произвольного shell-доступа здесь нет.
          Исполняемые команды выбирает только серверный allowlist.
        </p>
      </div>
    </div>
  );
}
