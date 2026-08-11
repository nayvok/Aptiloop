import { CoursePackIntakeClient } from "@/components/course-pack-client";

export default async function CoursePackIntakePage({
  params,
}: {
  params: Promise<{ operationId: string }>;
}) {
  const { operationId } = await params;
  return <CoursePackIntakeClient operationId={operationId} />;
}
