import { Suspense } from "react";

import { ReviewClient, ReviewPageSkeleton } from "@/components/review-client";

export default function ReviewPage() {
  return (
    <Suspense fallback={<ReviewPageSkeleton />}>
      <ReviewClient />
    </Suspense>
  );
}
