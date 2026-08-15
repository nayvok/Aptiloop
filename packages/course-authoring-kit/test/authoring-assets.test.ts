import { readFile } from "node:fs/promises";

import {
  courseAuthoringKitPackageIdentity,
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
  });
});
