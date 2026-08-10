import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import {
  canonicalCoursePackJson,
  CoursePackV1Schema,
} from "../src/course-pack.js";
import { createDevelopmentCoursePackFixture } from "../src/development-fixture.js";

const packageRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const schemaDirectory = path.join(packageRoot, "schema");
const templatesDirectory = path.join(packageRoot, "templates");
await Promise.all([
  mkdir(schemaDirectory, { recursive: true }),
  mkdir(templatesDirectory, { recursive: true }),
]);

const schema = z.toJSONSchema(CoursePackV1Schema, {
  target: "draft-2020-12",
  io: "input",
});
await Promise.all([
  writeFile(
    path.join(schemaDirectory, "course-pack-v1.schema.json"),
    `${JSON.stringify(
      {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        $id: "https://aptiloop.local/schema/course-pack-v1.schema.json",
        title: "Aptiloop Course Pack V1",
        description:
          "Declarative local Course interchange. Validation remains authoritative in the version-matched Authoring Kit.",
        ...schema,
      },
      null,
      2,
    )}\n`,
    "utf8",
  ),
  writeFile(
    path.join(templatesDirectory, "development-course-pack.json"),
    `${canonicalCoursePackJson(createDevelopmentCoursePackFixture())}\n`,
    "utf8",
  ),
]);
