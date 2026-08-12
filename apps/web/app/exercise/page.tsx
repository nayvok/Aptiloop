import { Suspense } from "react";

import { ExerciseClient } from "@/components/exercise-client";
import { RouteOrientation } from "@/components/route-orientation";
import { LoadingState } from "@/components/ui/loading-state";

export default function ExercisePage() {
  return (
    <Suspense
      fallback={
        <RouteOrientation
          slot="exercise-route-loading"
          title="unit.type.exercise"
          description="page.exercise.description"
        >
          <LoadingState label="practice.loading" />
        </RouteOrientation>
      }
    >
      <ExerciseClient />
    </Suspense>
  );
}
