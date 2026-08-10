import { DashboardClient } from "@/components/dashboard-client";

export default async function CourseRevisionPage({
  params,
}: {
  params: Promise<{ courseId: string; revisionId: string }>;
}) {
  const { courseId, revisionId } = await params;
  const apiCourseId = encodeURIComponent(decodeURIComponent(courseId));
  const apiRevisionId = encodeURIComponent(decodeURIComponent(revisionId));
  return (
    <DashboardClient
      pathEndpoint={`/learning/courses/${apiCourseId}/revisions/${apiRevisionId}/path`}
    />
  );
}
