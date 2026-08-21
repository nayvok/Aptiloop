import { readFile } from "node:fs/promises";

import {
  courseAuthoringKitPackageIdentity,
  coursePackAuthoringDraftV1JsonSchema,
  coursePackAuthoringDraftV1Template,
  coursePackAuthoringMetadata,
  coursePackRegistry,
  coursePackV1AuthoringTemplate,
  coursePackV1JsonSchema,
} from "@aptiloop/course-authoring-kit/authoring-assets";
import { describe, expect, it } from "vitest";

async function readPackageFile(path: string): Promise<string> {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

describe("Course Pack authoring assets", () => {
  it("exposes the package identity and generated artifacts without duplicating them", async () => {
    const packageManifest = JSON.parse(
      await readPackageFile("package.json"),
    ) as { readonly name: string; readonly version: string };

    expect(courseAuthoringKitPackageIdentity).toEqual({
      name: packageManifest.name,
      version: packageManifest.version,
    });
    expect(coursePackV1JsonSchema).toEqual(
      JSON.parse(await readPackageFile("schema/course-pack-v1.schema.json")),
    );
    expect(coursePackV1JsonSchema).toMatchObject({
      $id: "https://aptiloop.local/schema/course-pack-v1.schema.json",
      properties: {
        format: { const: "aptiloop.course-pack" },
        formatVersion: { const: 1 },
      },
    });
    expect(coursePackV1AuthoringTemplate).toEqual(
      JSON.parse(
        await readPackageFile(
          "templates/course-pack-v1-authoring-template.json",
        ),
      ),
    );
    expect(coursePackAuthoringDraftV1JsonSchema).toEqual(
      JSON.parse(
        await readPackageFile(
          "schema/course-pack-authoring-draft-v1.schema.json",
        ),
      ),
    );
    expect(coursePackAuthoringDraftV1JsonSchema).toMatchObject({
      $id: "https://aptiloop.local/schema/course-pack-authoring-draft-v1.schema.json",
      properties: {
        format: { const: "aptiloop.course-pack-authoring-draft" },
        formatVersion: { const: 1 },
        formatMinorVersion: { const: 1 },
      },
    });
    expect(coursePackAuthoringDraftV1Template).toEqual(
      JSON.parse(
        await readPackageFile(
          "templates/course-pack-authoring-draft-v1-template.json",
        ),
      ),
    );
    expect(coursePackAuthoringDraftV1Template).not.toHaveProperty(
      "requirements",
    );
    expect(coursePackAuthoringDraftV1Template).not.toHaveProperty(
      "revision.contentHash",
    );
    expect(coursePackRegistry).toMatchObject({
      capabilityIds: [],
      environmentIds: [],
      checkIds: [],
    });
    expect(coursePackAuthoringMetadata).toEqual({
      draftFormat: "aptiloop.course-pack-authoring-draft",
      formatVersion: 1,
      formatMinorVersion: 1,
      validatorVersion: "m3-v3",
    });
  });
});
