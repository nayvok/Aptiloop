import { Suspense } from "react";

import { SessionClient } from "@/components/session-client";
import { RouteOrientation } from "@/components/route-orientation";
import { LoadingState } from "@/components/ui/loading-state";

export default function SessionPage() {
  return (
    <Suspense
      fallback={
        <RouteOrientation
          slot="session-route-loading"
          title="shell.route.lesson"
          description="page.lesson.description"
          className="px-4 py-8 sm:px-6 sm:py-10 lg:px-6 lg:py-8"
        >
          <LoadingState label="session.loading" />
        </RouteOrientation>
      }
    >
      <SessionClient />
    </Suspense>
  );
}
