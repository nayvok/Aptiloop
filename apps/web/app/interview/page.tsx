import { Suspense } from "react";

import { InterviewClient } from "@/components/interview-client";
import { LoadingState } from "@/components/ui/loading-state";

export default function InterviewPage() {
  return (
    <Suspense fallback={<LoadingState label="interview.loading" />}>
      <InterviewClient />
    </Suspense>
  );
}
