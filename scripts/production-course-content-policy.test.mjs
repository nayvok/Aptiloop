import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  evaluateProductionCourseContent,
  resolveProductionArtifactDirectory,
  scanTreeForDevelopmentCourseContent,
} from "./production-course-content-policy.mjs";

test("production source and package surfaces exclude development Course content", async () => {
  const report = await evaluateProductionCourseContent({
    projectRoot: process.cwd(),
    artifactDirectory: null,
  });

  assert.deepEqual(report.violations, []);
  assert.equal(report.artifactPresent, false);
});

test("scans a selected production artifact without invoking a build", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "aptiloop-course-policy-"));
  try {
    const serverDirectory = path.join(root, "server");
    const ignoredCache = path.join(root, "cache");
    await mkdir(serverDirectory, { recursive: true });
    await mkdir(ignoredCache, { recursive: true });
    await writeFile(
      path.join(serverDirectory, "route.js"),
      'const course = "development-kernel-basics";\n',
      "utf8",
    );
    await writeFile(
      path.join(ignoredCache, "stale.pack"),
      "Aptiloop development fixture\n",
      "utf8",
    );

    const violations = await scanTreeForDevelopmentCourseContent(root, {
      ignoredDirectories: new Set(["cache"]),
      projectRoot: root,
    });

    assert.deepEqual(violations, [
      'server/route.js: contains "development-kernel-basics"',
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("uses NEXT_DIST_DIR when selecting a non-default production artifact", () => {
  const projectRoot = path.resolve("C:/aptiloop-policy-root");

  assert.equal(
    resolveProductionArtifactDirectory(projectRoot, {
      NEXT_DIST_DIR: ".next-release-check",
    }),
    path.join(projectRoot, "apps", "web", ".next-release-check"),
  );
  assert.equal(
    resolveProductionArtifactDirectory(projectRoot, {}),
    path.join(projectRoot, "apps", "web", ".next"),
  );
});
