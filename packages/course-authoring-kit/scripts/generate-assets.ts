import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { CoursePackV1Schema } from "../src/course-pack.js";

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
const authoringTemplate = CoursePackV1Schema.parse({
  format: "aptiloop.course-pack",
  formatVersion: 1,
  course: {
    courseKey: "replace-with-stable-course-id",
    title: "Replace with the Course title",
    description: "Replace with a concise Course description",
    primaryLocale: "en-US",
    availableLocales: ["en-US"],
    subjectTags: [],
    provenance: {
      contentStatus: "personal",
      author: "Replace with the author name",
      origin: "original",
      ownership: "unresolved",
      licenseSpdx: null,
      termsUrl: null,
      attribution: null,
      createdAt: "1970-01-01T00:00:00.000Z",
      notes:
        "Replace every placeholder and resolve ownership and content terms before validation.",
    },
  },
  revision: {
    revisionKey: "replace-with-stable-course-id/v1",
    revisionNumber: 1,
    parentRevisionKey: null,
    branchKind: "upstream",
    basedOnContentHash: null,
    contentHash: `sha256:${"0".repeat(64)}`,
  },
  requirements: {
    activityTypes: ["study"],
    capabilities: [],
    environmentIds: [],
    checkIds: [],
  },
  knowledge: {
    nodes: [
      {
        knowledgeNodeId: "replace-with-knowledge-node-id",
        title: "Replace with the knowledge node title",
        description: "Replace with the knowledge node description",
        kind: "concept",
        prerequisiteKnowledgeNodeIds: [],
        relatedKnowledgeNodeIds: [],
        lifecycle: "active",
      },
    ],
    sourceSnapshots: [],
    capsules: [],
  },
  localizations: [],
  lessons: [
    {
      lessonId: "replace-with-lesson-id",
      order: 0,
      title: "Replace with the lesson title",
      description: "Replace with the lesson description",
      goal: "Replace with an observable learning goal",
      estimatedMinutes: 10,
      knowledgeNodeIds: ["replace-with-knowledge-node-id"],
      entryActivityIds: ["replace-with-activity-id"],
      activities: [
        {
          activityId: "replace-with-activity-id",
          schemaVersion: 1,
          order: 0,
          type: "study",
          title: "Replace with the activity title",
          description: "Replace with the activity description",
          estimatedMinutes: 10,
          required: true,
          prerequisiteActivityIds: [],
          capabilityIds: [],
          knowledgeNodeIds: ["replace-with-knowledge-node-id"],
          sourceSnapshotIds: [],
          completionCriteria: [{ type: "acknowledgement" }],
          payload: {
            type: "study",
            body: "Replace with learner-visible study material",
          },
          protectedMaterial: { referenceAnswer: null, questions: [] },
        },
      ],
    },
  ],
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
    path.join(templatesDirectory, "course-pack-v1-authoring-template.json"),
    `${JSON.stringify(authoringTemplate, null, 2)}\n`,
    "utf8",
  ),
]);
