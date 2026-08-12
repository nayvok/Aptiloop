import assert from "node:assert/strict";
import test from "node:test";

import {
  assertNoDevelopmentArtifactLeaks,
  findDevelopmentArtifactLeaks,
} from "./verify-orchestrator-production-artifact.mjs";

test("rejects development curriculum and Mock implementation payloads", () => {
  const artifacts = [
    {
      file: "apps/orchestrator/dist/server.js",
      content: "weekOneCurriculum mock-deterministic",
    },
  ];

  assert.deepEqual(findDevelopmentArtifactLeaks(artifacts), [
    {
      file: "apps/orchestrator/dist/server.js",
      marker: "mock-deterministic",
    },
    {
      file: "apps/orchestrator/dist/server.js",
      marker: "weekOneCurriculum",
    },
  ]);
  assert.throws(
    () => assertNoDevelopmentArtifactLeaks(artifacts),
    /development-only data/u,
  );
});

test("allows fail-closed legacy Mock quarantine policy without fixture payloads", () => {
  assert.doesNotThrow(() =>
    assertNoDevelopmentArtifactLeaks([
      {
        file: "apps/orchestrator/dist/server.js",
        content:
          'if (connection.adapterId === "mock" && !developmentMode) disable(connection);',
      },
    ]),
  );
});
