import { Suspense } from "react";

import { SessionClient } from "@/components/session-client";
import { Skeleton } from "@/components/ui/skeleton";

export default function SessionPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <SessionClient />
    </Suspense>
  );
}
