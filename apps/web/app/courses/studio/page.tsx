import {
  CurriculumStudioClient,
  type AuthoringStart,
  type StudioWorkspace,
} from "@/components/curriculum-editor-client";
import { redirect } from "next/navigation";

type StudioSearchParams = Record<string, string | string[] | undefined>;

function requestedVersion(value: string | string[] | undefined): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= 200 ? normalized : null;
}

function requestedMode(
  value: string | string[] | undefined,
): AuthoringStart | null {
  return value === "manual" || value === "designer" ? value : null;
}

function requestedWorkspace(
  value: string | string[] | undefined,
): StudioWorkspace | null {
  return value === "program" ||
    value === "designer" ||
    value === "preview" ||
    value === "release" ||
    value === "history"
    ? value
    : null;
}

export default async function CourseStudioPage({
  searchParams,
}: {
  searchParams: Promise<StudioSearchParams>;
}) {
  const params = await searchParams;
  const version = requestedVersion(params.version);
  if (!version) redirect("/courses");
  const mode = requestedMode(params.mode);
  const workspace =
    requestedWorkspace(params.tab) ??
    (mode === "designer" ? "designer" : "program");
  return (
    <CurriculumStudioClient
      key={`${version}:${mode ?? "manual"}`}
      initialVersionId={version}
      initialMode={mode}
      initialWorkspace={workspace}
    />
  );
}
