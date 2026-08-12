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

function canonicalStudioSearchParams(params: StudioSearchParams) {
  const canonical = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") canonical.append(key, value);
    else if (Array.isArray(value)) {
      for (const item of value) canonical.append(key, item);
    }
  }
  return canonical;
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
  const workspace = requestedWorkspace(params.tab);
  if (
    (params.mode !== undefined && mode === null) ||
    (params.tab !== undefined && workspace === null)
  ) {
    const canonical = canonicalStudioSearchParams(params);
    if (mode === null) canonical.delete("mode");
    if (workspace === null) canonical.delete("tab");
    redirect(`/courses/studio?${canonical.toString()}`);
  }
  return (
    <CurriculumStudioClient
      key={`${version}:${mode ?? "manual"}`}
      initialVersionId={version}
      initialMode={mode}
      initialWorkspace={
        workspace ?? (mode === "designer" ? "designer" : "program")
      }
    />
  );
}
