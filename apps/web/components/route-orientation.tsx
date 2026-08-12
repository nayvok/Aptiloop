"use client";

import { PageHeader } from "@/components/page-header";
import { type MessageKey, useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function RouteOrientation({
  title,
  description,
  children,
  slot,
  className,
}: {
  title: MessageKey;
  description: MessageKey;
  children: React.ReactNode;
  slot: string;
  className?: string;
}) {
  const { t } = useI18n();

  return (
    <div
      data-slot={slot}
      className={cn("flex min-w-0 flex-col gap-6 lg:gap-8", className)}
    >
      <PageHeader title={t(title)} description={t(description)} />
      {children}
    </div>
  );
}
