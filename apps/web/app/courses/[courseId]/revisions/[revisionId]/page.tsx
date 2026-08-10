import { HomeClient } from "@/components/home-client";

export default async function CourseRevisionPage({
  params,
}: {
  params: Promise<{ courseId: string; revisionId: string }>;
}) {
  const { courseId, revisionId } = await params;
  const apiCourseId = encodeURIComponent(decodeURIComponent(courseId));
  const apiRevisionId = encodeURIComponent(decodeURIComponent(revisionId));
  return (
    <HomeClient
      pathEndpoint={`/learning/courses/${apiCourseId}/revisions/${apiRevisionId}/path`}
      selectionTarget={{
        courseId: decodeURIComponent(courseId),
        revisionId: decodeURIComponent(revisionId),
      }}
    />
  );
}
