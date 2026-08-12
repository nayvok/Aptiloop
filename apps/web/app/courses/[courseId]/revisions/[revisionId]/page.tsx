import { HomeClient } from "@/components/home-client";
import { notFound } from "next/navigation";

export default async function CourseRevisionPage({
  params,
}: {
  params: Promise<{ courseId: string; revisionId: string }>;
}) {
  const { courseId, revisionId } = await params;
  if (!courseId || !revisionId) notFound();
  const apiCourseId = encodeURIComponent(courseId);
  const apiRevisionId = encodeURIComponent(revisionId);
  return (
    <HomeClient
      surface="revision"
      pathEndpoint={`/learning/courses/${apiCourseId}/revisions/${apiRevisionId}/path`}
      selectionTarget={{
        courseId,
        revisionId,
      }}
    />
  );
}
