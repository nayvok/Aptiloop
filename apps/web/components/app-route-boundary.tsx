"use client";

import {
  ArrowLeftIcon,
  ArrowClockwiseIcon,
  HouseIcon,
} from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";

type BoundaryError = Error & { digest?: string };

function safeDigest(error: BoundaryError): string | null {
  const digest = error.digest;
  return typeof digest === "string" && /^[A-Za-z0-9_-]{1,128}$/u.test(digest)
    ? digest
    : null;
}

function RecoveryActions({ reset }: { reset?: () => void }) {
  const { t } = useI18n();
  const router = useRouter();

  return (
    <div className="flex flex-wrap gap-3">
      {reset ? (
        <Button type="button" onClick={reset}>
          <ArrowClockwiseIcon aria-hidden />
          {t("routeBoundary.retry")}
        </Button>
      ) : null}
      <Button type="button" variant="outline" onClick={() => router.back()}>
        <ArrowLeftIcon aria-hidden />
        {t("routeBoundary.back")}
      </Button>
      <Button asChild variant={reset ? "ghost" : "default"}>
        <Link href="/">
          <HouseIcon aria-hidden />
          {t("routeBoundary.home")}
        </Link>
      </Button>
    </div>
  );
}

export function RouteErrorBoundary({
  error,
  reset,
}: {
  error: BoundaryError;
  reset: () => void;
}) {
  const { t } = useI18n();
  const digest = safeDigest(error);

  return (
    <section
      aria-labelledby="route-error-title"
      aria-live="assertive"
      data-slot="route-error-boundary"
      className="mx-auto grid max-w-2xl gap-5 rounded-panel bg-surface-soft/80 p-5 sm:p-7"
    >
      <div className="grid gap-2">
        <p className="text-sm font-medium text-muted-foreground">
          {t("routeBoundary.error.eyebrow")}
        </p>
        <h1
          id="route-error-title"
          className="text-2xl font-semibold tracking-tight"
        >
          {t("routeBoundary.error.title")}
        </h1>
        <p className="max-w-[65ch] text-sm leading-6 text-muted-foreground">
          {t("routeBoundary.error.description")}
        </p>
      </div>
      {digest ? (
        <details className="max-w-[65ch] text-sm text-muted-foreground">
          <summary className="min-h-11 cursor-pointer py-3 font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {t("routeBoundary.technicalDetails")}
          </summary>
          <p className="font-mono text-xs [overflow-wrap:anywhere]">
            {t("routeBoundary.error.reference", { digest })}
          </p>
        </details>
      ) : null}
      <RecoveryActions reset={reset} />
    </section>
  );
}

export function RouteNotFoundBoundary() {
  const { t } = useI18n();

  return (
    <section
      aria-labelledby="route-not-found-title"
      data-slot="route-not-found-boundary"
      className="mx-auto grid max-w-2xl gap-5 rounded-panel bg-surface-soft/80 p-5 sm:p-7"
    >
      <div className="grid gap-2">
        <p className="text-sm font-medium text-muted-foreground">
          {t("routeBoundary.notFound.eyebrow")}
        </p>
        <h1
          id="route-not-found-title"
          className="text-2xl font-semibold tracking-tight"
        >
          {t("routeBoundary.notFound.title")}
        </h1>
        <p className="max-w-[65ch] text-sm leading-6 text-muted-foreground">
          {t("routeBoundary.notFound.description")}
        </p>
      </div>
      <RecoveryActions />
    </section>
  );
}
