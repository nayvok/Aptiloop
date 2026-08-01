import { Suspense } from "react";

import { InterviewClient } from "@/components/interview-client";
import { Skeleton } from "@/components/ui/skeleton";

export default function InterviewPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <InterviewClient />
    </Suspense>
  );
}
