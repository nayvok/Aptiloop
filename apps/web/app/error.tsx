"use client";

import { RouteErrorBoundary } from "@/components/app-route-boundary";

export default function ErrorBoundary({
  error,
  reset,
}: Readonly<{
  error: Error & { digest?: string };
  reset: () => void;
}>) {
  return <RouteErrorBoundary error={error} reset={reset} />;
}
