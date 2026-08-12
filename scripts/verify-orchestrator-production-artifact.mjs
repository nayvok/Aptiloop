import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(scriptPath), "..");
const defaultArtifactDirectory = path.join(
  projectRoot,
  "apps",
  "orchestrator",
  "dist",
);

export const forbiddenDevelopmentArtifactMarkers = [
  "MockAgentProvider",
  "Deterministic Mock",
  "mock-deterministic",
  "mock-session-",
  "Unknown mock model:",
  "Mock-ответ",
  "seedDevelopmentDatabase",
  "seedVersionedCurriculum",
  "weekOneCurriculum",
  "publishedCurriculumV2",
  "curriculum-foundation-v2-r4",
  "foundation-week-01",
  "week-01-day-01",
  "JavaScript и TypeScript: снова писать руками",
];

export function findDevelopmentArtifactLeaks(artifacts) {
  const leaks = [];
  for (const artifact of artifacts) {
    for (const marker of forbiddenDevelopmentArtifactMarkers) {
      if (artifact.content.includes(marker)) {
        leaks.push({ file: artifact.file, marker });
      }
    }
  }
  return leaks;
}

export function assertNoDevelopmentArtifactLeaks(artifacts) {
  const leaks = findDevelopmentArtifactLeaks(artifacts);
  if (leaks.length === 0) return;
  throw new Error(
    `Production orchestrator artifact contains development-only data:\n${leaks
      .map(({ file, marker }) => `- ${file}: ${JSON.stringify(marker)}`)
      .join("\n")}`,
  );
}

export function readProductionArtifacts(
  artifactDirectory = defaultArtifactDirectory,
) {
  const files = collectFiles(artifactDirectory);
  if (files.length === 0) {
    throw new Error(
      `Production orchestrator artifact is missing: ${artifactDirectory}`,
    );
  }
  return files.map((file) => ({
    file: path.relative(projectRoot, file),
    content: readFileSync(file, "utf8"),
  }));
}

function collectFiles(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory()) return collectFiles(candidate);
      return statSync(candidate).isFile() ? [candidate] : [];
    });
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  const artifacts = readProductionArtifacts();
  assertNoDevelopmentArtifactLeaks(artifacts);
  process.stdout.write(
    `Verified ${artifacts.length} orchestrator production artifact file(s): no development fixtures or Mock implementation payloads.\n`,
  );
}
