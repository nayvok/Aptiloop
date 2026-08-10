import { Suspense } from "react";

import { ReviewClient } from "@/components/review-client";
import { Skeleton } from "@/components/ui/skeleton";

export default function ReviewPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <ReviewClient />
    </Suspense>
  );
}
