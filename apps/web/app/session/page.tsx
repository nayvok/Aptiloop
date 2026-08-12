import { Suspense } from "react";

import { SessionClient } from "@/components/session-client";
import { LoadingState } from "@/components/ui/loading-state";

export default function SessionPage() {
  return (
    <Suspense
      fallback={
        <LoadingState
          label="session.loading"
          className="min-h-[calc(100dvh-var(--shell-bar-size,4.5rem))] rounded-none"
        />
      }
    >
      <SessionClient />
    </Suspense>
  );
}
