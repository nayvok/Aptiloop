import { Suspense } from "react";

import { ExerciseClient } from "@/components/exercise-client";
import { LoadingState } from "@/components/ui/loading-state";

export default function ExercisePage() {
  return (
    <Suspense fallback={<LoadingState label="practice.loading" />}>
      <ExerciseClient />
    </Suspense>
  );
}
