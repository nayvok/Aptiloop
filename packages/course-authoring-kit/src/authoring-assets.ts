import authoringKitPackage from "../package.json";
import coursePackAuthoringDraftV1Schema from "../schema/course-pack-authoring-draft-v1.schema.json";
import coursePackV1Schema from "../schema/course-pack-v1.schema.json";
import coursePackAuthoringDraftV1TemplateJson from "../templates/course-pack-authoring-draft-v1-template.json";
import coursePackV1AuthoringTemplateJson from "../templates/course-pack-v1-authoring-template.json";

import {
  CORE_M3_COURSE_PACK_REGISTRY,
  COURSE_PACK_AUTHORING_DRAFT_FORMAT,
  COURSE_PACK_FORMAT_MINOR_VERSION,
  COURSE_PACK_FORMAT_VERSION,
  COURSE_PACK_VALIDATOR_VERSION,
} from "./course-pack.js";

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

export interface CoursePackAuthoringMetadata {
  readonly draftFormat: typeof COURSE_PACK_AUTHORING_DRAFT_FORMAT;
  readonly formatVersion: typeof COURSE_PACK_FORMAT_VERSION;
  readonly formatMinorVersion: typeof COURSE_PACK_FORMAT_MINOR_VERSION;
  readonly validatorVersion: typeof COURSE_PACK_VALIDATOR_VERSION;
}

export type CoursePackV1AuthoringTemplateArtifact = Readonly<
  Record<string, unknown>
>;
export type CoursePackAuthoringDraftV1TemplateArtifact = Readonly<
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

/** Exact generated hashless Course Pack Authoring Draft V1 JSON Schema. */
export const coursePackAuthoringDraftV1JsonSchema: CoursePackV1JsonSchemaArtifact =
  coursePackAuthoringDraftV1Schema;

/** Exact generated hashless draft scaffold consumed by external authoring. */
export const coursePackAuthoringDraftV1Template: CoursePackAuthoringDraftV1TemplateArtifact =
  coursePackAuthoringDraftV1TemplateJson;

/** Runtime-owned registry metadata; generators must never invent IDs. */
export const coursePackRegistry = CORE_M3_COURSE_PACK_REGISTRY;

/** Version metadata paired with every exact generated authoring asset. */
export const coursePackAuthoringMetadata = {
  draftFormat: COURSE_PACK_AUTHORING_DRAFT_FORMAT,
  formatVersion: COURSE_PACK_FORMAT_VERSION,
  formatMinorVersion: COURSE_PACK_FORMAT_MINOR_VERSION,
  validatorVersion: COURSE_PACK_VALIDATOR_VERSION,
} as const satisfies CoursePackAuthoringMetadata;
