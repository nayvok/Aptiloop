"use client";

import { CheckIcon } from "@phosphor-icons/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";

import { ReviewQueueClient } from "@/components/flashcards-client";
import { InterviewClient } from "@/components/interview-client";
import { MistakesClient } from "@/components/mistakes-client";
import { PageHeader } from "@/components/page-header";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LoadingState } from "@/components/ui/loading-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { type MessageKey, useI18n } from "@/lib/i18n";

const views = [
  { id: "due", label: "review.view.due" },
  { id: "mistakes", label: "review.view.mistakes" },
  { id: "cards", label: "review.view.cards" },
  { id: "interviews", label: "review.view.interviews" },
] as const satisfies ReadonlyArray<{ id: string; label: MessageKey }>;
type ReviewView = (typeof views)[number]["id"];

const viewDescriptions: Readonly<Record<ReviewView, MessageKey>> = {
  due: "review.viewDescription.due",
  mistakes: "review.viewDescription.mistakes",
  cards: "review.viewDescription.cards",
  interviews: "review.viewDescription.interviews",
};

export function ReviewPageSkeleton({
  label = "cards.loading",
  compact = false,
}: {
  label?: MessageKey;
  compact?: boolean;
}) {
  const { t } = useI18n();
  if (compact) {
    return <LoadingState label={label} variant="panel" />;
  }

  return (
    <div
      data-slot="review-loading-state"
      role="status"
      aria-live="polite"
      aria-label={t(label)}
      className="flex min-w-0 flex-col gap-5"
    >
      <span className="sr-only">{t(label)}</span>
      <div aria-hidden className="flex flex-col gap-3">
        <Skeleton className="h-11 w-56 max-w-[70%]" />
        <Skeleton className="h-6 w-[34rem] max-w-full" />
      </div>
      <div aria-hidden className="flex flex-col gap-5">
        <div className="grid h-11 w-[46rem] max-w-full grid-cols-4 gap-1">
          {[0, 1, 2, 3].map((tab) => (
            <Skeleton key={tab} className="h-full rounded-control" />
          ))}
        </div>
        <div className="grid gap-3">
          {[0, 1].map((row) => (
            <div
              key={row}
              className="grid gap-4 rounded-panel bg-surface-soft/60 p-4 xl:grid-cols-2"
            >
              <Skeleton className="h-14" />
              <Skeleton className="h-14" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function ReviewClient() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useI18n();
  const requested = searchParams.get("view");
  const active: ReviewView = views.some((view) => view.id === requested)
    ? (requested as ReviewView)
    : "due";
  const searchParamString = searchParams.toString();

  useEffect(() => {
    if (requested === null || views.some((view) => view.id === requested)) {
      return;
    }
    const next = new URLSearchParams(searchParamString);
    next.delete("view");
    const serialized = next.toString();
    router.replace(serialized ? `${pathname}?${serialized}` : pathname, {
      scroll: false,
    });
  }, [pathname, requested, router, searchParamString]);

  const navigateToView = (value: string) => {
    const next = views.find((view) => view.id === value)?.id;
    if (!next || next === active) return;
    const params = new URLSearchParams(searchParamString);
    if (next === "due") params.delete("view");
    else params.set("view", next);
    const serialized = params.toString();
    router.push(serialized ? `${pathname}?${serialized}` : pathname, {
      scroll: false,
    });
  };

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader
        title={t("nav.review")}
        description={t("page.review.description")}
      />
      <Tabs
        value={active}
        onValueChange={navigateToView}
        className="min-w-0 gap-6"
      >
        <div
          data-slot="review-destination-navigation"
          className="flex w-full max-w-[58rem] min-w-0 flex-col gap-3 rounded-panel bg-surface-soft/45 p-3 sm:p-4"
        >
          <nav aria-label={t("nav.review")} className="min-w-0">
            <div data-slot="review-mobile-nav" className="xl:hidden">
              <Select value={active} onValueChange={navigateToView}>
                <SelectTrigger
                  aria-label={t("nav.review")}
                  className="w-full bg-background"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {views.map((view) => (
                      <SelectItem key={view.id} value={view.id}>
                        {t(view.label)}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>

            <TabsList
              data-slot="review-desktop-nav"
              variant="segmented"
              className="hidden h-auto w-full max-w-[50rem] grid-cols-4 justify-start gap-2 bg-transparent p-0 xl:grid"
            >
              {views.map((view) => {
                const selected = active === view.id;
                return (
                  <TabsTrigger
                    key={view.id}
                    value={view.id}
                    aria-current={selected ? "page" : undefined}
                    data-active={selected}
                    className="min-h-11 min-w-0 rounded-control border border-border/55 bg-background/35 px-3 py-2 text-[0.9375rem] shadow-none before:hidden after:hidden hover:bg-accent/45 data-[state=active]:border-primary/30 data-[state=active]:bg-accent/70 data-[state=active]:font-semibold dark:data-[state=active]:bg-accent/70"
                  >
                    {selected ? <CheckIcon aria-hidden weight="bold" /> : null}
                    <span className="min-w-0 truncate">{t(view.label)}</span>
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </nav>
          <p className="max-w-[70ch] px-1 pb-0.5 text-sm leading-6 text-muted-foreground">
            {t(viewDescriptions[active])}
          </p>
        </div>

        <TabsContent value="due" className="mt-0 min-w-0">
          <ReviewQueueClient dueOnly />
        </TabsContent>
        <TabsContent value="mistakes" className="mt-0 min-w-0">
          <MistakesClient />
        </TabsContent>
        <TabsContent value="cards" className="mt-0 min-w-0">
          <ReviewQueueClient />
        </TabsContent>
        <TabsContent value="interviews" className="mt-0 min-w-0">
          <Suspense
            fallback={<ReviewPageSkeleton label="interview.loading" compact />}
          >
            <InterviewClient embedded />
          </Suspense>
        </TabsContent>
      </Tabs>
    </div>
  );
}
