"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { FlashcardsClient } from "@/components/flashcards-client";
import { InterviewClient } from "@/components/interview-client";
import { MistakesClient } from "@/components/mistakes-client";
import { PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { type MessageKey, useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const views = [
  { id: "due", label: "review.view.due" },
  { id: "mistakes", label: "review.view.mistakes" },
  { id: "cards", label: "review.view.cards" },
  { id: "interviews", label: "review.view.interviews" },
] as const satisfies ReadonlyArray<{ id: string; label: MessageKey }>;
type ReviewView = (typeof views)[number]["id"];

export function ReviewClient() {
  const searchParams = useSearchParams();
  const { t } = useI18n();
  const requested = searchParams.get("view");
  const active: ReviewView = views.some((view) => view.id === requested)
    ? (requested as ReviewView)
    : "due";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("nav.review")}
        description={t("page.review.description")}
      />
      <nav aria-label={t("nav.review")} className="overflow-x-auto">
        <div className="flex min-w-max gap-1 border-b border-border">
          {views.map((view) => {
            const selected = active === view.id;
            return (
              <Link
                key={view.id}
                href={view.id === "due" ? "/review" : `/review?view=${view.id}`}
                aria-current={selected ? "page" : undefined}
                className={cn(
                  "flex min-h-11 items-center border-b-2 border-transparent px-3 text-sm text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  selected && "border-primary font-medium text-foreground",
                )}
              >
                {t(view.label)}
              </Link>
            );
          })}
        </div>
      </nav>
      {active === "cards" ? <FlashcardsClient /> : null}
      {active === "interviews" ? (
        <Suspense fallback={<Skeleton className="h-96" />}>
          <InterviewClient />
        </Suspense>
      ) : null}
      {active === "due" || active === "mistakes" ? <MistakesClient /> : null}
    </div>
  );
}
