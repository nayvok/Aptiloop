import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DEVELOPMENT_COURSE_MARKERS = Object.freeze([
  "development-course-pack.json",
  "development-kernel-basics",
  "Aptiloop development fixture",
]);

const PRODUCTION_SOURCE_PATHS = Object.freeze([
  "apps/web/app",
  "apps/web/components",
  "apps/web/lib",
  "packages/course-authoring-kit/package.json",
  "packages/course-authoring-kit/src",
  "packages/course-authoring-kit/schema",
  "packages/course-authoring-kit/templates",
]);

const ARTIFACT_IGNORED_DIRECTORIES = new Set(["cache", "dev", "diagnostics"]);

function displayPath(projectRoot, targetPath) {
  const relative = path.relative(projectRoot, targetPath);
  return (relative || ".").replaceAll(path.sep, "/");
}

async function pathKind(targetPath) {
  try {
    const metadata = await stat(targetPath);
    if (metadata.isDirectory()) return "directory";
    if (metadata.isFile()) return "file";
    return "other";
  } catch (error) {
    if (error?.code === "ENOENT") return "missing";
    throw error;
  }
}

export async function scanTreeForDevelopmentCourseContent(
  targetPath,
  {
    ignoredDirectories = new Set(),
    markers = DEVELOPMENT_COURSE_MARKERS,
    projectRoot = process.cwd(),
  } = {},
) {
  const kind = await pathKind(targetPath);
  if (kind === "missing") return [];
  if (kind === "other") {
    return [
      `${displayPath(projectRoot, targetPath)} is not a regular file or directory`,
    ];
  }

  const files = [];
  if (kind === "file") {
    files.push(targetPath);
  } else {
    const pending = [targetPath];
    while (pending.length > 0) {
      const directory = pending.pop();
      const entries = await readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (directory !== targetPath || !ignoredDirectories.has(entry.name)) {
            pending.push(path.join(directory, entry.name));
          }
          continue;
        }
        if (entry.isFile()) files.push(path.join(directory, entry.name));
      }
    }
  }

  const markerBuffers = markers.map((marker) => [marker, Buffer.from(marker)]);
  const violations = [];
  for (const filePath of files) {
    const relativePath = displayPath(projectRoot, filePath);
    for (const marker of markers) {
      if (path.basename(filePath).includes(marker)) {
        violations.push(
          `${relativePath}: forbidden development Course filename`,
        );
      }
    }
    const contents = await readFile(filePath);
    for (const [marker, markerBuffer] of markerBuffers) {
      if (contents.includes(markerBuffer)) {
        violations.push(`${relativePath}: contains ${JSON.stringify(marker)}`);
      }
    }
  }
  return [...new Set(violations)].sort();
}

export function resolveProductionArtifactDirectory(
  projectRoot,
  environment = process.env,
) {
  const configured = environment.NEXT_DIST_DIR?.trim() || ".next";
  return path.isAbsolute(configured)
    ? path.normalize(configured)
    : path.resolve(projectRoot, "apps", "web", configured);
}

export async function evaluateProductionCourseContent({
  projectRoot = process.cwd(),
  artifactDirectory = resolveProductionArtifactDirectory(projectRoot),
} = {}) {
  const violations = [];
  for (const relativePath of PRODUCTION_SOURCE_PATHS) {
    violations.push(
      ...(await scanTreeForDevelopmentCourseContent(
        path.resolve(projectRoot, relativePath),
        {
          projectRoot,
        },
      )),
    );
  }

  const forbiddenTemplate = path.resolve(
    projectRoot,
    "packages/course-authoring-kit/templates/development-course-pack.json",
  );
  if ((await pathKind(forbiddenTemplate)) !== "missing") {
    violations.push(
      `${displayPath(projectRoot, forbiddenTemplate)}: development Course template must not be shipped`,
    );
  }

  let artifactPresent = false;
  if (artifactDirectory !== null) {
    const artifactKind = await pathKind(artifactDirectory);
    artifactPresent = artifactKind !== "missing";
    if (artifactPresent) {
      violations.push(
        ...(await scanTreeForDevelopmentCourseContent(artifactDirectory, {
          ignoredDirectories: ARTIFACT_IGNORED_DIRECTORIES,
          projectRoot,
        })),
      );
    }
  }

  return {
    artifactDirectory:
      artifactDirectory === null
        ? null
        : displayPath(projectRoot, artifactDirectory),
    artifactPresent,
    violations: [...new Set(violations)].sort(),
  };
}

async function main() {
  const report = await evaluateProductionCourseContent();
  if (report.violations.length > 0) {
    console.error("Production Course content policy failed:");
    for (const violation of report.violations) console.error(`- ${violation}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    report.artifactPresent
      ? `Production Course content policy passed; scanned ${report.artifactDirectory}.`
      : `Production Course content policy passed; ${report.artifactDirectory} is not present, so source and package surfaces were checked.`,
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  await main();
}
