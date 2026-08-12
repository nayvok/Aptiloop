import { Suspense } from "react";

import { InterviewClient } from "@/components/interview-client";
import { RouteOrientation } from "@/components/route-orientation";
import { LoadingState } from "@/components/ui/loading-state";

export default function InterviewPage() {
  return (
    <Suspense
      fallback={
        <RouteOrientation
          slot="interview-route-loading"
          title="interview.title"
          description="page.interview.description"
        >
          <LoadingState label="interview.loading" />
        </RouteOrientation>
      }
    >
      <InterviewClient />
    </Suspense>
  );
}
