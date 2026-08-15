import authoringKitPackage from "../package.json";
import coursePackV1Schema from "../schema/course-pack-v1.schema.json";
import coursePackV1AuthoringTemplateJson from "../templates/course-pack-v1-authoring-template.json";

export interface CourseAuthoringKitPackageIdentity {
  readonly name: string;
  readonly version: string;
}

export interface CoursePackV1JsonSchemaArtifact {
  readonly $id: string;
  readonly properties: {
    readonly format: { readonly const: string };
    readonly formatVersion: { readonly const: number };
  };
}

export type CoursePackV1AuthoringTemplateArtifact = Readonly<
  Record<string, unknown>
>;

/** Package-owned identity for the generated assets exposed by this subpath. */
export const courseAuthoringKitPackageIdentity = {
  name: authoringKitPackage.name,
  version: authoringKitPackage.version,
} as const satisfies CourseAuthoringKitPackageIdentity;

/** Exact generated Course Pack V1 JSON Schema artifact. */
export const coursePackV1JsonSchema: CoursePackV1JsonSchemaArtifact =
  coursePackV1Schema;

/** Exact generated topic-neutral Course Pack V1 authoring scaffold. */
export const coursePackV1AuthoringTemplate: CoursePackV1AuthoringTemplateArtifact =
  coursePackV1AuthoringTemplateJson;
