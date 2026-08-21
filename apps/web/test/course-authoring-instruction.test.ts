import {
  coursePackAuthoringDraftV1JsonSchema,
  coursePackAuthoringDraftV1Template,
  coursePackRegistry,
  coursePackV1AuthoringTemplate,
  coursePackV1JsonSchema,
} from "@aptiloop/course-authoring-kit/authoring-assets";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createCourseAuthoringInstruction,
  type CourseAuthoringInstructionOptions,
} from "@/app/courses/new/external/course-authoring-instruction";
import { POST } from "@/app/courses/new/external/instructions/route";
import {
  APTILOOP_BUILD_COMMIT_ENV,
  resolveAptiloopBuildCommit,
} from "../next.config";

const REPOSITORY_REVISION = "0123456789abcdef0123456789abcdef01234567";
const originalBuildCommit = process.env.APTILOOP_BUILD_COMMIT;
const brief = {
  topicGoal: "Practical async JavaScript",
  targetOutcome: "Build and explain an asynchronous workflow",
  currentLevel: "Comfortable with syntax",
  primaryLocale: "en-US",
  pacing: "30 minutes daily for four weeks",
  tools: "Node.js 24",
  accessibility: "Prefer concise text",
  constraints: "No framework",
};
const authoritativePaths = [
  "packages/course-authoring-kit/schema/course-pack-v1.schema.json",
  "packages/course-authoring-kit/schema/course-pack-authoring-draft-v1.schema.json",
  "packages/course-authoring-kit/src/course-pack.ts",
  "packages/course-authoring-kit/templates/course-pack-v1-authoring-template.json",
  "packages/course-authoring-kit/templates/course-pack-authoring-draft-v1-template.json",
  "packages/shared/src/course.ts",
  "packages/shared/src/curriculum.ts",
  "docs/product/course-authoring.md",
  "docs/architecture/course-pack.md",
  "docs/security/untrusted-course-packs.md",
] as const;

function instruction(
  options: Omit<CourseAuthoringInstructionOptions, "repositoryRevision"> = {},
): string {
  return createCourseAuthoringInstruction(brief, {
    repositoryRevision: REPOSITORY_REVISION,
    ...options,
  });
}

function instructionRequest(): Request {
  return new Request("http://localhost/courses/new/external/instructions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(brief),
  });
}

afterEach(() => {
  if (originalBuildCommit === undefined) {
    delete process.env.APTILOOP_BUILD_COMMIT;
  } else {
    process.env.APTILOOP_BUILD_COMMIT = originalBuildCommit;
  }
});

describe("portable Course authoring instruction", () => {
  it("defaults to material discovery and explicit proposal approval before draft JSON", () => {
    const contents = instruction();

    expect(contents).toContain("interaction_mode: interactive");
    expect(contents).toContain(
      "Ask the user all material questions before writing the Course Proposal",
    );
    expect(contents).toContain(
      "Do not emit JSON, a JSON fragment, or a filled scaffold until the user explicitly approves that exact Course Proposal",
    );
    expect(contents.indexOf("**Discovery.**")).toBeLessThan(
      contents.indexOf("**Course Proposal.**"),
    );
    expect(contents.indexOf("**User Review.**")).toBeLessThan(
      contents.indexOf("**Compilation.**"),
    );
    expect(contents).toContain(
      'Output format "aptiloop.course-pack-authoring-draft"',
    );
  });

  it("makes explicitly selected automation mode distinguishable without weakening local authority", () => {
    const contents = instruction({ interactionMode: "non-interactive" });

    expect(contents).toContain("interaction_mode: non-interactive");
    expect(contents).toContain(
      "Non-interactive automation mode (explicit opt-in)",
    );
    expect(contents).toContain(
      "does not authorize validation bypass, installation, Open as Draft, or publication",
    );
    expect(contents).not.toContain("Interactive mode (default)");
  });

  it("embeds exact assets and assigns requirements and final hash only to Aptiloop", () => {
    const contents = instruction();

    for (const artifact of [
      coursePackAuthoringDraftV1JsonSchema,
      coursePackAuthoringDraftV1Template,
      coursePackRegistry,
      coursePackV1AuthoringTemplate,
      coursePackV1JsonSchema,
    ]) {
      expect(contents).toContain(JSON.stringify(artifact, null, 2));
    }
    expect(contents).toContain("Omit the root requirements field completely");
    expect(contents).toContain("Omit revision.contentHash completely");
    expect(contents).toContain(
      "owned exclusively by the deterministic Aptiloop preparation tool",
    );
    expect(contents).toContain("at most **3 repair rounds**");
    expect(contents).toContain("preserve the last failed draft");
    expect(contents).toContain("/courses/import");
  });

  it("uses only the allowlisted references pinned to the injected repository revision", () => {
    const contents = instruction();
    const prefix = `https://raw.githubusercontent.com/nayvok/Aptiloop/${REPOSITORY_REVISION}/`;

    for (const path of authoritativePaths) {
      expect(contents).toContain(`${prefix}${path}`);
    }
    expect(
      contents.match(/https:\/\/raw\.githubusercontent\.com\//gu),
    ).toHaveLength(authoritativePaths.length);
    expect(contents).not.toContain(
      "raw.githubusercontent.com/nayvok/Aptiloop/main/",
    );
    expect(contents).toContain(`repository_revision: ${REPOSITORY_REVISION}`);
  });

  it("rejects malformed repository metadata at the instruction boundary", () => {
    expect(() =>
      createCourseAuthoringInstruction(brief, {
        repositoryRevision: "main",
      }),
    ).toThrow("40-character repository revision");
  });
});

describe("Course authoring build identity", () => {
  it("prefers an exact override and otherwise resolves an exact Git commit", () => {
    const readHead = vi.fn(() => `${"f".repeat(40)}\n`);

    expect(
      resolveAptiloopBuildCommit(
        { [APTILOOP_BUILD_COMMIT_ENV]: REPOSITORY_REVISION },
        readHead,
      ),
    ).toBe(REPOSITORY_REVISION);
    expect(readHead).not.toHaveBeenCalled();
    expect(resolveAptiloopBuildCommit({}, readHead)).toBe("f".repeat(40));
  });

  it("fails closed on a malformed explicit override", () => {
    const readHead = vi.fn(() => "f".repeat(40));

    expect(
      resolveAptiloopBuildCommit(
        { [APTILOOP_BUILD_COMMIT_ENV]: "main" },
        readHead,
      ),
    ).toBeNull();
    expect(readHead).not.toHaveBeenCalled();
  });

  it("keeps the download route closed when build metadata is absent or malformed", async () => {
    delete process.env.APTILOOP_BUILD_COMMIT;
    expect((await POST(instructionRequest())).status).toBe(503);

    process.env.APTILOOP_BUILD_COMMIT = "main";
    expect((await POST(instructionRequest())).status).toBe(503);
  });

  it("returns downloadable text containing the validated injected commit", async () => {
    process.env.APTILOOP_BUILD_COMMIT = REPOSITORY_REVISION;

    const response = await POST(instructionRequest());
    const contents = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/markdown; charset=utf-8",
    );
    expect(response.headers.get("content-disposition")).toContain(
      "aptiloop-course-pack-v1-authoring-skill.md",
    );
    expect(contents).toContain(`repository_revision: ${REPOSITORY_REVISION}`);
    expect(contents).toContain(
      `https://raw.githubusercontent.com/nayvok/Aptiloop/${REPOSITORY_REVISION}/packages/course-authoring-kit/src/course-pack.ts`,
    );
  });
});
