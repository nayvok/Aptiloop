import { HomeClient } from "@/components/home-client";
import { notFound } from "next/navigation";

function decodeRouteId(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    notFound();
  }
}

export default async function CourseRevisionPage({
  params,
}: {
  params: Promise<{ courseId: string; revisionId: string }>;
}) {
  const raw = await params;
  if (!raw.courseId || !raw.revisionId) notFound();
  const courseId = decodeRouteId(raw.courseId);
  const revisionId = decodeRouteId(raw.revisionId);
  const apiCourseId = encodeURIComponent(courseId);
  const apiRevisionId = encodeURIComponent(revisionId);
  return (
    <HomeClient
      surface="revision"
      pathEndpoint={`/learning/courses/${apiCourseId}/revisions/${apiRevisionId}/path`}
      selectionTarget={{ courseId, revisionId }}
    />
  );
}
