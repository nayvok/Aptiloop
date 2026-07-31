import { Suspense } from "react";

import { ExerciseClient } from "@/components/exercise-client";
import { Skeleton } from "@/components/ui/skeleton";

export default function ExercisePage() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <ExerciseClient />
    </Suspense>
  );
}
