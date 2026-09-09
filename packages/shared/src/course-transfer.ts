import { z } from "zod";

/**
 * Course transfer v1: private device transfer with complete replayable state.
 *
 * Two user meanings are preserved:
 * - `share` is the canonical single Course Pack (`aptiloop.course-pack`)
 *   without learner data, flowing through `/api/course-packs/*` untouched.
 * - `transfer` is the multi-course envelope below
 *   (`aptiloop.course-transfer-v1`) served by `/api/course-transfer/*`
 *   for 1..N selected Courses. It closes all revision dependencies:
 *   `packs[]` for imported upstream manifests, hash-bound
 *   `revisionSnapshots[]` for manual/personal revisions (immutable graph,
 *   protected material, provenance, branch links), and `learnerScope` with
 *   adaptation bindings, all kernel facts, review state,
 *   completed/abandoned/active session snapshots, learner-course pointers,
 *   and bounded active-exercise attempt snapshots.
 *
 * Export reads one consistent SQLite snapshot; derived projections are
 * rebuilt and checkpoint hashes compared on import. Transfer-with-progress
 * always carries history (no without-history mode). Credentials, provider
 * pending/raw sessions, env/logs, and absolute/UNC/device paths are never
 * admitted: see `COURSE_TRANSFER_EXCLUDED_V1` and the prohibited-scan in
 * `@aptiloop/database` (`scope:course-transfer`).
 *
 * Active provider turns resume from the last persisted fact; the preview
 * reports dropped pending turns. Active exercises carry bounded
 * `attemptSnapshots[]` (max 32 within 64 MiB total) with trusted
 * template/baseline identity, full non-truncated diff, allowed untracked
 * blobs, and SHA-256. Filesystem/Git authority lives in
 * `@aptiloop/exercise-core`; the database stores typed metadata only.
 *
 * Unknown fields and unknown versions fail closed: every object schema is
 * `.strict()` and both `format` and `formatVersion` are literals.
 */

export const COURSE_TRANSFER_FORMAT = "aptiloop.course-transfer-v1" as const;
export const COURSE_TRANSFER_FORMAT_VERSION = 1 as const;

/** Envelope limit const. The UI must show `maxBytes` before export. */
export const COURSE_TRANSFER_JSON_LIMITS_V1 = Object.freeze({
  maxBytes: 64 * 1024 * 1024,
  maxCourses: 32,
  maxPacks: 64,
  maxFacts: 50_000,
  maxSessions: 1_000,
  maxSnapshots: 1_000,
  maxSnapshotBytes: 65_536,
  maxRevisionSnapshotBytes: 8 * 1024 * 1024,
  maxRevisionSnapshotTotalBytes: 64 * 1024 * 1024,
  maxRevisionSnapshots: 256,
  maxAttemptSnapshots: 32,
  maxAttemptTotalBytes: 64 * 1024 * 1024,
  maxAttemptDiffBytes: 4 * 1024 * 1024,
  maxAttemptBlobBytes: 1 * 1024 * 1024,
  maxReviewItems: 5_000,
  maxLearnerCoursePointers: 32,
});

export const COURSE_TRANSFER_EXCLUDED_V1 = [
  "provider-credentials",
  "environment-files",
  "absolute-workspace-locations-runtime-artifacts-and-ignored-secret-files",
  "absolute-local-paths",
  "provider-session-identifiers",
  "pending-provider-disclosures",
  "unfinished-provider-turns",
  "legacy-provider-options",
  "raw-provider-payloads",
  "provider-auto-reconnect-state",
  "transient-provider-state",
  "logs",
] as const;
export type CourseTransferExcluded =
  (typeof COURSE_TRANSFER_EXCLUDED_V1)[number];

const ENTITY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,199}$/;
const STABLE_ID_PATTERN = /^[a-z0-9][a-z0-9._/-]{0,199}$/;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const LOCALE_PATTERN = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/;

const EntityIdSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(ENTITY_ID_PATTERN, "Malformed entity ID");
const StableIdSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(STABLE_ID_PATTERN, "Malformed stable ID");
const OperationIdSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(ENTITY_ID_PATTERN, "Malformed operation ID");
const Sha256Schema = z.string().regex(SHA256_PATTERN, "Malformed SHA-256");
const IsoDateTimeSchema = z.string().datetime({ offset: true });
const ScopeNoteSchema = z.string().trim().min(1).max(500);
const TransferSessionStatusSchema = z.enum([
  "active",
  "completed",
  "abandoned",
]);
export type CourseTransferSessionStatus = z.infer<
  typeof TransferSessionStatusSchema
>;

export const CourseTransferExcludedSchema = z.enum(COURSE_TRANSFER_EXCLUDED_V1);

export const CourseTransferExportRequestSchema = z
  .object({
    courseKeys: z.array(StableIdSchema).min(1).max(32),
    // Transfer-with-progress always carries history; there is no without-history mode.
    includeHistory: z.literal(true),
    scopeNote: ScopeNoteSchema,
    operationId: OperationIdSchema,
  })
  .strict();
export type CourseTransferExportRequest = z.infer<
  typeof CourseTransferExportRequestSchema
>;

export const CourseTransferManifestSchema = z
  .object({
    format: z.literal(COURSE_TRANSFER_FORMAT),
    formatVersion: z.literal(COURSE_TRANSFER_FORMAT_VERSION),
    createdAt: IsoDateTimeSchema,
    operationId: OperationIdSchema,
    courseKeys: z
      .array(StableIdSchema)
      .min(1)
      .max(COURSE_TRANSFER_JSON_LIMITS_V1.maxCourses),
    includeHistory: z.literal(true),
    scopeNote: ScopeNoteSchema,
    packCount: z.number().int().nonnegative(),
    revisionSnapshotCount: z.number().int().nonnegative(),
    revisionSnapshotByteCount: z.number().int().nonnegative(),
    factCount: z.number().int().nonnegative(),
    sessionCount: z.number().int().nonnegative(),
    skippedSessionCount: z.number().int().nonnegative(),
    attemptSnapshotCount: z.number().int().nonnegative(),
    attemptByteCount: z.number().int().nonnegative(),
    droppedPendingTurnCount: z.number().int().nonnegative(),
    excluded: z.array(CourseTransferExcludedSchema),
  })
  .strict();
export type CourseTransferManifest = z.infer<
  typeof CourseTransferManifestSchema
>;

export const CourseTransferPackEntrySchema = z
  .object({
    courseKey: StableIdSchema,
    revisionKey: StableIdSchema,
    revisionNumber: z.number().int().positive(),
    contentHash: Sha256Schema,
    /** Canonical pack bytes. Re-validated with the pack boundary on import. */
    canonicalJson: z.string().min(2).max(1_048_576),
  })
  .strict();
export type CourseTransferPackEntry = z.infer<
  typeof CourseTransferPackEntrySchema
>;

export const CourseTransferFactEntrySchema = z
  .object({
    id: z.string().min(1).max(500),
    operationId: z.string().min(1).max(500),
    courseId: EntityIdSchema,
    revisionId: EntityIdSchema,
    branchId: EntityIdSchema,
    sessionId: EntityIdSchema,
    lessonId: EntityIdSchema,
    activityId: EntityIdSchema,
    bodyType: z.enum(["evidence", "progress", "correction", "review"]),
    occurredAt: IsoDateTimeSchema,
    acceptedAt: IsoDateTimeSchema,
    /** Canonical kernel-fact JSON. Hash-verified on import, never trusted. */
    canonicalJson: z.string().min(2).max(50_000),
    factHash: Sha256Schema,
  })
  .strict();
export type CourseTransferFactEntry = z.infer<
  typeof CourseTransferFactEntrySchema
>;

export const CourseTransferSnapshotEntrySchema = z
  .object({
    snapshotId: EntityIdSchema,
    sessionId: EntityIdSchema,
    courseId: EntityIdSchema,
    revisionId: EntityIdSchema,
    lessonId: EntityIdSchema,
    branchId: EntityIdSchema,
    dayId: EntityIdSchema,
    schemaVersion: z.number().int().positive(),
    sessionStatus: TransferSessionStatusSchema,
    currentStep: z.string().min(1).max(500),
    startedAt: IsoDateTimeSchema,
    completedAt: IsoDateTimeSchema.nullable(),
    createdAt: IsoDateTimeSchema,
    snapshotHash: z.string().min(1).max(500),
    contentHash: z.string().min(1).max(500),
    snapshotBytesHash: Sha256Schema,
    snapshotJson: z
      .string()
      .min(2)
      .max(COURSE_TRANSFER_JSON_LIMITS_V1.maxSnapshotBytes),
  })
  .strict();
export type CourseTransferSnapshotEntry = z.infer<
  typeof CourseTransferSnapshotEntrySchema
>;

export const CourseTransferBindingEntrySchema = z
  .object({
    courseId: EntityIdSchema,
    revisionId: EntityIdSchema,
    branchId: EntityIdSchema,
    baseRevisionId: EntityIdSchema,
    headRevisionId: EntityIdSchema.nullable(),
    status: z.enum(["active", "archived"]),
  })
  .strict();
export type CourseTransferBindingEntry = z.infer<
  typeof CourseTransferBindingEntrySchema
>;

export const CourseTransferCheckpointEntrySchema = z
  .object({
    courseId: EntityIdSchema,
    revisionId: EntityIdSchema,
    branchId: EntityIdSchema,
    sessionId: EntityIdSchema,
    observedAt: IsoDateTimeSchema,
    /**
     * Advisory only. Derived projections are recomputed from replayed facts on
     * import and must match this hash, otherwise the envelope is quarantined.
     */
    projectionHash: Sha256Schema,
  })
  .strict();
export type CourseTransferCheckpointEntry = z.infer<
  typeof CourseTransferCheckpointEntrySchema
>;

export const CourseTransferSessionRefSchema = z
  .object({
    sessionId: EntityIdSchema,
    courseId: EntityIdSchema,
    revisionId: EntityIdSchema,
    branchId: EntityIdSchema,
    lessonId: EntityIdSchema,
    status: TransferSessionStatusSchema,
  })
  .strict();
export type CourseTransferSessionRef = z.infer<
  typeof CourseTransferSessionRefSchema
>;

const RevisionSnapshotJsonSchema = z
  .string()
  .min(2)
  .max(2_000_000)
  .refine((value) => {
    try {
      const parsed: unknown = JSON.parse(value);
      return typeof parsed === "object" && parsed !== null;
    } catch {
      return false;
    }
  }, "Nested JSON must be a valid object or array");
const RevisionSnapshotArrayJsonSchema = RevisionSnapshotJsonSchema.refine(
  (value) => Array.isArray(JSON.parse(value)),
  "Nested JSON must be an array",
);
const RevisionSnapshotObjectJsonSchema = RevisionSnapshotJsonSchema.refine(
  (value) => {
    const parsed: unknown = JSON.parse(value);
    return (
      typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
    );
  },
  "Nested JSON must be an object",
);
const RevisionSnapshotSectionSchema = z
  .object({
    id: EntityIdSchema,
    stable_id: StableIdSchema,
    order_index: z.number().int().nonnegative(),
    title: z.string().min(1).max(500),
    description: z.string().max(50_000).nullable(),
  })
  .strict();
const RevisionSnapshotLessonSchema = z
  .object({
    id: EntityIdSchema,
    section_id: EntityIdSchema,
    stable_id: StableIdSchema,
    order_index: z.number().int().nonnegative(),
    title: z.string().min(1).max(500),
    description: z.string().min(1).max(50_000),
    goal: z.string().min(1).max(50_000),
    estimated_minutes: z.number().int().positive(),
    expected_outcomes_json: RevisionSnapshotArrayJsonSchema,
    depth_level: z.string().min(1).max(100),
    out_of_scope_json: RevisionSnapshotArrayJsonSchema,
    topics_json: RevisionSnapshotArrayJsonSchema,
  })
  .strict();
const RevisionSnapshotActivitySchema = z
  .object({
    id: EntityIdSchema,
    lesson_id: EntityIdSchema,
    stable_id: StableIdSchema,
    activity_type: z.enum([
      "briefing",
      "study",
      "recall",
      "teacher-dialogue",
      "quiz",
      "code-reading",
      "exercise",
      "review",
      "interview",
      "summary",
      "checkpoint",
      "spaced-review",
    ]),
    order_index: z.number().int().nonnegative(),
    title: z.string().min(1).max(500),
    description: z.string().min(1).max(50_000),
    estimated_minutes: z.number().int().positive().nullable(),
    required: z.number().int().min(0).max(1),
    objectives_json: RevisionSnapshotArrayJsonSchema,
    checklist_json: RevisionSnapshotArrayJsonSchema,
    sources_json: RevisionSnapshotArrayJsonSchema,
    questions_json: RevisionSnapshotArrayJsonSchema,
    misconceptions_json: RevisionSnapshotArrayJsonSchema,
    capability_ids_json: RevisionSnapshotArrayJsonSchema,
    knowledge_node_ids_json: RevisionSnapshotArrayJsonSchema,
    completion_criteria_json: RevisionSnapshotArrayJsonSchema,
    payload_json: RevisionSnapshotObjectJsonSchema,
    protected_material_json: RevisionSnapshotObjectJsonSchema,
    depth_level: z.string().min(1).max(100).nullable(),
  })
  .strict();
const RevisionSnapshotLessonPrerequisiteSchema = z
  .object({
    course_id: EntityIdSchema,
    revision_id: EntityIdSchema,
    lesson_id: EntityIdSchema,
    prerequisite_lesson_id: EntityIdSchema,
  })
  .strict();
const RevisionSnapshotActivityPrerequisiteSchema = z
  .object({
    course_id: EntityIdSchema,
    revision_id: EntityIdSchema,
    lesson_id: EntityIdSchema,
    activity_id: EntityIdSchema,
    prerequisite_activity_id: EntityIdSchema,
  })
  .strict();
const RevisionSnapshotSourceSchema = z
  .object({
    id: EntityIdSchema,
    course_id: EntityIdSchema,
    revision_id: EntityIdSchema,
    source_authority_id: EntityIdSchema,
    canonical_url: z
      .string()
      .min(8)
      .max(4_000)
      .refine((value) => value.toLowerCase().startsWith("https://")),
    retrieved_at: z.number().int().nonnegative(),
    retrieval_method: z.enum(["official-http", "manual-import", "migration"]),
    media_type: z.string().min(3).max(255),
    locale: z.string().min(2).max(35).nullable(),
    content_hash: Sha256Schema,
    title: z.string().min(1).max(500),
    author_publisher: z.string().min(1).max(500).nullable(),
    published_or_updated_at: z.string().max(100).nullable(),
    attribution: z.string().min(1).max(50_000).nullable(),
    license_spdx: z.string().min(1).max(500).nullable(),
    terms_url: z
      .string()
      .max(4_000)
      .refine((value) => value.toLowerCase().startsWith("https://"))
      .nullable(),
    content: z.string().max(100_000).nullable(),
    locator_map_json: RevisionSnapshotArrayJsonSchema,
    retention_mode: z.enum(["full", "extract", "metadata-only"]),
    supersedes_snapshot_id: EntityIdSchema.nullable(),
    created_at: z.number().int().nonnegative(),
  })
  .strict();
const RevisionSnapshotCapsuleSchema = z
  .object({
    id: EntityIdSchema,
    schema_version: z.number().int().positive(),
    course_id: EntityIdSchema,
    revision_id: EntityIdSchema,
    knowledge_node_ids_json: RevisionSnapshotArrayJsonSchema,
    primary_locale: z.string().min(2).max(35),
    claims_json: RevisionSnapshotArrayJsonSchema,
    citations_json: RevisionSnapshotArrayJsonSchema,
    conflicts_json: RevisionSnapshotArrayJsonSchema,
    created_by: z.enum(["manual", "typed-ai-proposal", "migration"]),
    validation_hash: Sha256Schema,
    created_at: z.number().int().nonnegative(),
  })
  .strict();
const RevisionSnapshotCapsuleSourceSchema = z
  .object({
    course_id: EntityIdSchema,
    revision_id: EntityIdSchema,
    capsule_id: EntityIdSchema,
    source_snapshot_id: EntityIdSchema,
  })
  .strict();
const RevisionSnapshotLocalizationSchema = z
  .object({
    revision_id: EntityIdSchema,
    locale: z.string().min(2).max(35),
    release_complete: z.number().int().min(0).max(1),
    fields_json: RevisionSnapshotJsonSchema,
  })
  .strict();
const RevisionSnapshotKnowledgeNodeSchema = z
  .object({
    revision_id: EntityIdSchema,
    knowledge_node_id: EntityIdSchema,
    title: z.string().min(1).max(500),
    description: z.string().max(50_000),
    kind: z.enum(["concept", "procedure", "skill", "misconception-family"]),
    prerequisite_ids_json: RevisionSnapshotJsonSchema,
    related_ids_json: RevisionSnapshotJsonSchema,
    lifecycle: z.enum(["active", "superseded"]),
  })
  .strict();
const RevisionSnapshotBranchSchema = z
  .object({
    id: EntityIdSchema,
    base_revision_id: EntityIdSchema,
    head_revision_id: EntityIdSchema.nullable(),
    status: z.enum(["active", "archived"]),
  })
  .strict();
const RevisionSnapshotCourseSchema = z
  .object({
    id: EntityIdSchema,
    stable_id: StableIdSchema,
    slug: z.string().min(1).max(200),
    title: z.string().min(1).max(500),
    description: z.string().max(50_000).nullable(),
    primary_locale: z.string().min(2).max(35),
    active_revision_id: EntityIdSchema.nullable(),
    created_at: z.number().int().nonnegative(),
    updated_at: z.number().int().nonnegative(),
  })
  .strict();
const AuthoredGraphVersionSchema = z
  .object({
    id: EntityIdSchema,
    curriculumId: EntityIdSchema,
    revision: z.number().int().positive(),
    parentVersionId: EntityIdSchema.nullable(),
    status: z.enum(["draft", "published", "archived"]),
    title: z.string().min(1).max(500),
    description: z.string().max(50_000).nullable(),
    contentHash: z.string().max(500).nullable(),
    createdAt: z.number().int().nonnegative(),
    publishedAt: z.number().int().nonnegative().nullable(),
    archivedAt: z.number().int().nonnegative().nullable(),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict();
const AuthoredGraphUnitSchema = z
  .object({
    id: EntityIdSchema,
    versionId: EntityIdSchema,
    dayId: EntityIdSchema,
    stableId: StableIdSchema,
    type: z.string().min(1).max(100),
    orderIndex: z.number().int().nonnegative(),
    title: z.string().min(1).max(500),
    description: z.string().max(50_000).nullable(),
    estimatedMinutes: z.number().int().positive().nullable(),
    objectives: z.array(z.unknown()),
    checklist: z.array(z.unknown()),
    sources: z.array(z.unknown()),
    questions: z.array(z.unknown()),
    misconceptions: z.array(z.unknown()),
    referenceAnswer: z.unknown(),
    depthLevel: z.string().max(100).nullable(),
    payload: z.record(z.string(), z.unknown()),
    optional: z.boolean(),
    payloadJson: z.string(),
    objectivesJson: z.string(),
    checklistJson: z.string(),
    sourcesJson: z.string(),
    questionsJson: z.string(),
    misconceptionsJson: z.string(),
    referenceAnswerJson: z.string().nullable(),
    completionCriteria: z.array(z.unknown()),
    unlockRules: z.array(z.unknown()),
    completionCriteriaJson: z.string(),
    unlockRulesJson: z.string(),
    updatedAt: z.number().int().nonnegative(),
    createdAt: z.number().int().nonnegative(),
  })
  .strict();
const AuthoredGraphDaySchema = z
  .object({
    id: EntityIdSchema,
    versionId: EntityIdSchema,
    weekId: EntityIdSchema,
    stableId: StableIdSchema,
    orderIndex: z.number().int().nonnegative(),
    title: z.string().min(1).max(500),
    description: z.string().max(50_000).nullable(),
    goal: z.string().min(1).max(50_000),
    estimatedMinutes: z.number().int().positive(),
    depthLevel: z.string().min(1).max(100),
    prerequisites: z.array(z.unknown()),
    expectedOutcomes: z.array(z.unknown()),
    outOfScope: z.array(z.unknown()),
    topics: z.array(z.unknown()),
    prerequisitesJson: z.string(),
    expectedOutcomesJson: z.string(),
    outOfScopeJson: z.string(),
    topicsJson: z.string(),
    units: z.array(AuthoredGraphUnitSchema),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict();
const AuthoredGraphWeekSchema = z
  .object({
    id: EntityIdSchema,
    versionId: EntityIdSchema,
    stableId: StableIdSchema,
    orderIndex: z.number().int().nonnegative(),
    title: z.string().min(1).max(500),
    description: z.string().max(50_000).nullable(),
    days: z.array(AuthoredGraphDaySchema),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict();
const AuthoredGraphPayloadSchema = z
  .object({
    primaryLocale: z.string().min(2).max(35),
    version: AuthoredGraphVersionSchema,
    weeks: z.array(AuthoredGraphWeekSchema),
  })
  .strict();
export const CourseTransferRevisionSnapshotCanonicalSchema = z
  .object({
    courseKey: StableIdSchema,
    course: RevisionSnapshotCourseSchema,
    authoredGraph: AuthoredGraphPayloadSchema,
    revisionKey: StableIdSchema,
    revisionNumber: z.number().int().positive(),
    parentRevisionKey: StableIdSchema.nullable(),
    branchKind: z.enum(["upstream", "personal"]),
    basedOnContentHash: Sha256Schema.nullable(),
    status: z.enum(["draft", "published", "archived"]),
    createdAt: z.number().int().nonnegative(),
    publishedAt: z.number().int().nonnegative().nullable(),
    archivedAt: z.number().int().nonnegative().nullable(),
    updatedAt: z.number().int().nonnegative(),
    revisionContentHash: Sha256Schema,
    title: z.string().min(1).max(500),
    description: z.string().max(50_000).nullable(),
    sections: z.array(RevisionSnapshotSectionSchema).max(500),
    lessons: z.array(RevisionSnapshotLessonSchema).max(1_000),
    activities: z.array(RevisionSnapshotActivitySchema).max(5_000),
    lessonPrerequisites: z
      .array(RevisionSnapshotLessonPrerequisiteSchema)
      .max(5_000),
    activityPrerequisites: z
      .array(RevisionSnapshotActivityPrerequisiteSchema)
      .max(10_000),
    branchLinks: RevisionSnapshotBranchSchema.nullable(),
    sourceSnapshots: z.array(RevisionSnapshotSourceSchema).max(1_000),
    knowledgeCapsules: z.array(RevisionSnapshotCapsuleSchema).max(1_000),
    knowledgeCapsuleSources: z
      .array(RevisionSnapshotCapsuleSourceSchema)
      .max(5_000),
    localizations: z.array(RevisionSnapshotLocalizationSchema).max(500),
    knowledgeNodes: z.array(RevisionSnapshotKnowledgeNodeSchema).max(1_000),
  })
  .strict();
export type CourseTransferRevisionSnapshotCanonical = z.infer<
  typeof CourseTransferRevisionSnapshotCanonicalSchema
>;

export const CourseTransferRevisionSnapshotEntrySchema = z
  .object({
    courseKey: StableIdSchema,
    revisionKey: StableIdSchema,
    revisionNumber: z.number().int().positive(),
    parentRevisionKey: StableIdSchema.nullable(),
    branchKind: z.enum(["upstream", "personal"]),
    basedOnContentHash: Sha256Schema.nullable(),
    /** Immutable content hash persisted on the server-owned revision row. */
    revisionContentHash: Sha256Schema,
    /** Hash of canonicalJson, used to detect tampering of this snapshot entry. */
    snapshotHash: Sha256Schema,
    canonicalJson: z
      .string()
      .min(2)
      .max(COURSE_TRANSFER_JSON_LIMITS_V1.maxRevisionSnapshotBytes),
  })
  .strict();
export type CourseTransferRevisionSnapshotEntry = z.infer<
  typeof CourseTransferRevisionSnapshotEntrySchema
>;
const CanonicalBase64Schema = z
  .string()
  .max(2_000_000)
  .regex(
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u,
    "Malformed canonical base64 blob",
  )
  .refine(
    (value) => transferBase64DecodedBytes(value) <= 1_048_576,
    "Decoded blob exceeds the 1 MiB limit",
  );
export const CourseTransferAttemptBlobSchema = z
  .object({
    path: z
      .string()
      .min(1)
      .max(1_024)
      .refine(
        (value) =>
          !value.includes("\\") &&
          !value.includes("\0") &&
          !value.startsWith("/") &&
          value
            .split("/")
            .every(
              (segment) =>
                segment !== "" && segment !== "." && segment !== "..",
            ),
        "Blob path must be a canonical relative path",
      ),
    sizeBytes: z.number().int().nonnegative(),
    sha256: Sha256Schema,
    contentBase64: CanonicalBase64Schema,
  })
  .strict();
export type CourseTransferAttemptBlob = z.infer<
  typeof CourseTransferAttemptBlobSchema
>;
const GitShaSchema = z
  .string()
  .regex(/^[0-9a-f]{40}$/u, "Malformed Git commit");
const transferTextEncoder = new TextEncoder();
export function transferUtf8ByteLength(value: string): number {
  return transferTextEncoder.encode(value).length;
}
export function transferBase64DecodedBytes(value: string): number {
  if (value.length === 0) return 0;
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return Math.floor((value.length * 3) / 4) - padding;
}
export const CourseTransferAttemptCommitSchema = z
  .object({
    sourceCommit: GitShaSchema,
    parentCommit: GitShaSchema,
    authorName: z.string().min(1).max(500),
    authorEmail: z.string().min(1).max(500),
    authoredAt: IsoDateTimeSchema,
    subject: z.string().max(500),
    patch: z.string().max(COURSE_TRANSFER_JSON_LIMITS_V1.maxAttemptDiffBytes),
    patchHash: Sha256Schema,
  })
  .strict();
export type CourseTransferAttemptCommit = z.infer<
  typeof CourseTransferAttemptCommitSchema
>;

export const CourseTransferAttemptSnapshotEntrySchema = z
  .object({
    attemptId: EntityIdSchema,
    sessionId: EntityIdSchema,
    courseId: EntityIdSchema,
    revisionId: EntityIdSchema,
    exerciseId: EntityIdSchema,
    trustedTemplateId: z.string().min(1).max(200),
    baselineCommit: GitShaSchema,
    // v1 carries baseline, ordered learner commits, and complete working-tree evidence.
    learnerCommits: z.array(CourseTransferAttemptCommitSchema).max(32),
    workingTreeDiff: z
      .string()
      .max(COURSE_TRANSFER_JSON_LIMITS_V1.maxAttemptDiffBytes),
    untrackedBlobs: z.array(CourseTransferAttemptBlobSchema).max(32),
    treeHash: Sha256Schema,
    diffHash: Sha256Schema,
    createdAt: IsoDateTimeSchema,
  })
  .strict();
export type CourseTransferAttemptSnapshotEntry = z.infer<
  typeof CourseTransferAttemptSnapshotEntrySchema
>;
export const CourseTransferReviewEntrySchema = z
  .object({
    reviewItemId: EntityIdSchema,
    sessionId: EntityIdSchema,
    courseId: EntityIdSchema,
    revisionId: EntityIdSchema,
    branchId: EntityIdSchema,
    activityId: EntityIdSchema,
    status: z.enum(["pending", "submitted", "completed", "dismissed"]),
    dueAt: IsoDateTimeSchema.nullable(),
    createdAt: IsoDateTimeSchema,
  })
  .strict();
export type CourseTransferReviewEntry = z.infer<
  typeof CourseTransferReviewEntrySchema
>;
export const CourseTransferLearnerCoursePointerSchema = z
  .object({
    courseId: EntityIdSchema,
    activeRevisionId: EntityIdSchema.nullable(),
    currentSessionId: EntityIdSchema.nullable(),
    isSelected: z.boolean(),
    updatedAt: IsoDateTimeSchema,
  })
  .strict();
export type CourseTransferLearnerCoursePointer = z.infer<
  typeof CourseTransferLearnerCoursePointerSchema
>;
export const CourseTransferLearnerScopeSchema = z
  .object({
    bindings: z
      .array(CourseTransferBindingEntrySchema)
      .max(COURSE_TRANSFER_JSON_LIMITS_V1.maxPacks),
    facts: z
      .array(CourseTransferFactEntrySchema)
      .max(COURSE_TRANSFER_JSON_LIMITS_V1.maxFacts),
    snapshots: z
      .array(CourseTransferSnapshotEntrySchema)
      .max(COURSE_TRANSFER_JSON_LIMITS_V1.maxSnapshots),
    checkpoints: z
      .array(CourseTransferCheckpointEntrySchema)
      .max(COURSE_TRANSFER_JSON_LIMITS_V1.maxSessions),
    sessionRefs: z
      .array(CourseTransferSessionRefSchema)
      .max(COURSE_TRANSFER_JSON_LIMITS_V1.maxSessions),
    reviewItems: z
      .array(CourseTransferReviewEntrySchema)
      .max(COURSE_TRANSFER_JSON_LIMITS_V1.maxReviewItems),
    learnerCoursePointers: z
      .array(CourseTransferLearnerCoursePointerSchema)
      .max(COURSE_TRANSFER_JSON_LIMITS_V1.maxLearnerCoursePointers),
    attemptSnapshots: z
      .array(CourseTransferAttemptSnapshotEntrySchema)
      .max(COURSE_TRANSFER_JSON_LIMITS_V1.maxAttemptSnapshots),
  })
  .strict();
export type CourseTransferLearnerScope = z.infer<
  typeof CourseTransferLearnerScopeSchema
>;

export const CourseTransferEnvelopeSchema = z
  .object({
    format: z.literal(COURSE_TRANSFER_FORMAT),
    formatVersion: z.literal(COURSE_TRANSFER_FORMAT_VERSION),
    manifest: CourseTransferManifestSchema,
    packs: z
      .array(CourseTransferPackEntrySchema)
      .max(COURSE_TRANSFER_JSON_LIMITS_V1.maxPacks),
    revisionSnapshots: z
      .array(CourseTransferRevisionSnapshotEntrySchema)
      .max(COURSE_TRANSFER_JSON_LIMITS_V1.maxRevisionSnapshots),
    learnerScope: CourseTransferLearnerScopeSchema,
  })
  .strict()
  .superRefine((envelope, context) => {
    if (envelope.packs.length + envelope.revisionSnapshots.length < 1) {
      context.addIssue({
        code: "custom",
        path: ["packs"],
        message:
          "Transfer envelope must carry at least one pack or revision snapshot",
      });
    }
    if (envelope.manifest.packCount !== envelope.packs.length) {
      context.addIssue({
        code: "custom",
        path: ["manifest", "packCount"],
        message: "Transfer manifest pack count does not match the envelope",
      });
    }
    if (
      envelope.manifest.revisionSnapshotCount !==
      envelope.revisionSnapshots.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["manifest", "revisionSnapshotCount"],
        message:
          "Transfer manifest revision snapshot count does not match the envelope",
      });
    }
    const revisionSnapshotBytes = envelope.revisionSnapshots.reduce(
      (total, snapshot, index) => {
        const bytes = transferUtf8ByteLength(snapshot.canonicalJson);
        if (bytes > COURSE_TRANSFER_JSON_LIMITS_V1.maxRevisionSnapshotBytes) {
          context.addIssue({
            code: "custom",
            path: ["revisionSnapshots", index, "canonicalJson"],
            message: "Revision snapshot exceeds its byte budget",
          });
        }
        return total + bytes;
      },
      0,
    );
    if (
      envelope.manifest.revisionSnapshotByteCount !== revisionSnapshotBytes ||
      revisionSnapshotBytes >
        COURSE_TRANSFER_JSON_LIMITS_V1.maxRevisionSnapshotTotalBytes
    ) {
      context.addIssue({
        code: "custom",
        path: ["manifest", "revisionSnapshotByteCount"],
        message:
          "Transfer revision snapshot byte count does not match the envelope",
      });
    }
    if (envelope.manifest.factCount !== envelope.learnerScope.facts.length) {
      context.addIssue({
        code: "custom",
        path: ["manifest", "factCount"],
        message: "Transfer manifest fact count does not match the envelope",
      });
    }
    if (
      envelope.manifest.sessionCount !==
      envelope.learnerScope.sessionRefs.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["manifest", "sessionCount"],
        message: "Transfer manifest session count does not match the envelope",
      });
    }
    if (
      envelope.manifest.attemptSnapshotCount !==
      envelope.learnerScope.attemptSnapshots.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["manifest", "attemptSnapshotCount"],
        message:
          "Transfer manifest attempt snapshot count does not match the envelope",
      });
    }
    const packKeys = new Set(
      envelope.packs.map((pack) => `${pack.courseKey}|${pack.revisionKey}`),
    );
    if (packKeys.size !== envelope.packs.length) {
      context.addIssue({
        code: "custom",
        path: ["packs"],
        message: "Transfer envelope contains duplicate pack entries",
      });
    }
    const snapshotKeys = new Set(
      envelope.revisionSnapshots.map(
        (snapshot) => `${snapshot.courseKey}|${snapshot.revisionKey}`,
      ),
    );
    if (snapshotKeys.size !== envelope.revisionSnapshots.length) {
      context.addIssue({
        code: "custom",
        path: ["revisionSnapshots"],
        message: "Transfer envelope contains duplicate revision snapshots",
      });
    }
    let attemptBytes = 0;
    envelope.learnerScope.attemptSnapshots.forEach((attempt, attemptIndex) => {
      let expectedParent = attempt.baselineCommit;
      const commitIds = new Set<string>();
      attempt.learnerCommits.forEach((commit, commitIndex) => {
        const patchBytes = transferUtf8ByteLength(commit.patch);
        if (patchBytes > COURSE_TRANSFER_JSON_LIMITS_V1.maxAttemptDiffBytes) {
          context.addIssue({
            code: "custom",
            path: [
              "learnerScope",
              "attemptSnapshots",
              attemptIndex,
              "learnerCommits",
              commitIndex,
              "patch",
            ],
            message: "Learner commit patch exceeds its byte budget",
          });
        }
        if (
          commit.parentCommit !== expectedParent ||
          commitIds.has(commit.sourceCommit)
        ) {
          context.addIssue({
            code: "custom",
            path: [
              "learnerScope",
              "attemptSnapshots",
              attemptIndex,
              "learnerCommits",
              commitIndex,
            ],
            message:
              "Learner commits must form a unique linear chain from baseline",
          });
        }
        commitIds.add(commit.sourceCommit);
        expectedParent = commit.sourceCommit;
        attemptBytes += patchBytes;
      });
      const diffBytes = transferUtf8ByteLength(attempt.workingTreeDiff);
      if (diffBytes > COURSE_TRANSFER_JSON_LIMITS_V1.maxAttemptDiffBytes) {
        context.addIssue({
          code: "custom",
          path: [
            "learnerScope",
            "attemptSnapshots",
            attemptIndex,
            "workingTreeDiff",
          ],
          message: "Transfer attempt diff exceeds its byte budget",
        });
      }
      attemptBytes += diffBytes;
      attempt.untrackedBlobs.forEach((blob, blobIndex) => {
        const decodedBytes = transferBase64DecodedBytes(blob.contentBase64);
        if (decodedBytes !== blob.sizeBytes) {
          context.addIssue({
            code: "custom",
            path: [
              "learnerScope",
              "attemptSnapshots",
              attemptIndex,
              "untrackedBlobs",
              blobIndex,
              "sizeBytes",
            ],
            message:
              "Transfer blob declared size does not match its decoded bytes",
          });
        }
        if (decodedBytes > COURSE_TRANSFER_JSON_LIMITS_V1.maxAttemptBlobBytes) {
          context.addIssue({
            code: "custom",
            path: [
              "learnerScope",
              "attemptSnapshots",
              attemptIndex,
              "untrackedBlobs",
              blobIndex,
              "contentBase64",
            ],
            message: "Transfer blob exceeds its byte budget",
          });
        }
        attemptBytes += decodedBytes;
      });
    });
    if (attemptBytes !== envelope.manifest.attemptByteCount) {
      context.addIssue({
        code: "custom",
        path: ["manifest", "attemptByteCount"],
        message:
          "Transfer manifest attempt byte count does not match the envelope",
      });
    }
    if (attemptBytes > COURSE_TRANSFER_JSON_LIMITS_V1.maxAttemptTotalBytes) {
      context.addIssue({
        code: "custom",
        path: ["learnerScope", "attemptSnapshots"],
        message: "Transfer attempt snapshots exceed the 64 MiB total budget",
      });
    }
  });
export type CourseTransferEnvelope = z.infer<
  typeof CourseTransferEnvelopeSchema
>;

export const CourseTransferConflictSchema = z
  .object({
    code: z.enum([
      "already-installed",
      "new-revision-available",
      "unknown-course",
      "active-session-blocks",
    ]),
    courseKey: StableIdSchema.nullable(),
    revisionKey: StableIdSchema.nullable(),
    reason: z.string().min(1).max(500),
  })
  .strict();
export type CourseTransferConflict = z.infer<
  typeof CourseTransferConflictSchema
>;

export const CourseTransferPreviewCourseSchema = z
  .object({
    courseKey: StableIdSchema,
    courseTitle: z.string().min(1).max(500),
    revisionKey: StableIdSchema,
    revisionNumber: z.number().int().positive(),
    contentHash: Sha256Schema,
    primaryLocale: z.string().regex(LOCALE_PATTERN),
  })
  .strict();
export type CourseTransferPreviewCourse = z.infer<
  typeof CourseTransferPreviewCourseSchema
>;

export const CourseTransferPreviewSchema = z
  .object({
    courses: z
      .array(CourseTransferPreviewCourseSchema)
      .max(COURSE_TRANSFER_JSON_LIMITS_V1.maxCourses),
    packCount: z.number().int().nonnegative(),
    revisionSnapshotCount: z.number().int().nonnegative(),
    factCount: z.number().int().nonnegative(),
    sessionCount: z.number().int().nonnegative(),
    skippedSessionCount: z.number().int().nonnegative(),
    attemptSnapshotCount: z.number().int().nonnegative(),
    attemptByteCount: z.number().int().nonnegative(),
    droppedPendingTurnCount: z.number().int().nonnegative(),
    excluded: z.array(CourseTransferExcludedSchema),
    conflicts: z.array(CourseTransferConflictSchema).max(128),
  })
  .strict();
export type CourseTransferPreview = z.infer<typeof CourseTransferPreviewSchema>;

export const CourseTransferCourseResolutionSchema = z
  .object({
    courseKey: StableIdSchema,
    decision: z.enum([
      "keep-destination",
      "replace-with-import-after-transfer-backup",
    ]),
  })
  .strict();
export type CourseTransferCourseResolution = z.infer<
  typeof CourseTransferCourseResolutionSchema
>;

export const CourseTransferCommitRequestSchema = z
  .object({
    operationId: OperationIdSchema,
    expectedEnvelopeHash: Sha256Schema,
    resolutions: z
      .array(CourseTransferCourseResolutionSchema)
      .max(32)
      .default([]),
  })
  .strict();
export type CourseTransferCommitRequest = z.infer<
  typeof CourseTransferCommitRequestSchema
>;

export const CourseTransferCommitResultSchema = z
  .object({
    installedPacks: z.number().int().nonnegative(),
    restoredRevisionSnapshots: z.number().int().nonnegative().default(0),
    replayedFacts: z.number().int().nonnegative(),
    restoredSessions: z.number().int().nonnegative(),
    restoredAttempts: z.number().int().nonnegative().default(0),
    droppedPendingTurns: z.number().int().nonnegative().default(0),
    idempotent: z.boolean(),
    courses: z.array(CourseTransferPreviewCourseSchema),
  })
  .strict();
export type CourseTransferCommitResult = z.infer<
  typeof CourseTransferCommitResultSchema
>;

export const CoursePackUpgradeModeSchema = z.enum([
  "safe-update",
  "side-by-side",
]);
export type CoursePackUpgradeMode = z.infer<typeof CoursePackUpgradeModeSchema>;

export const CoursePackAdaptationResolutionSchema = z
  .object({
    conflictId: z.string().min(1).max(200),
    resolution: z.enum(["use-upstream", "keep-personal"]),
  })
  .strict();
export type CoursePackAdaptationResolution = z.infer<
  typeof CoursePackAdaptationResolutionSchema
>;

export const CoursePackUpgradeRequestSchema = z
  .object({
    operationId: OperationIdSchema,
    mode: CoursePackUpgradeModeSchema,
    expectedContentHash: Sha256Schema,
    sideBySideSuffix: z
      .string()
      .min(1)
      .max(60)
      .regex(/^[a-z0-9][a-z0-9._-]{0,59}$/)
      .optional(),
    adaptationResolutions: z
      .array(CoursePackAdaptationResolutionSchema)
      .max(128)
      .default([]),
  })
  .strict();
export type CoursePackUpgradeRequest = z.infer<
  typeof CoursePackUpgradeRequestSchema
>;

export const CoursePackUpgradeCarriedSchema = z
  .object({
    activityId: StableIdSchema,
    contractHash: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
  })
  .strict();
export type CoursePackUpgradeCarried = z.infer<
  typeof CoursePackUpgradeCarriedSchema
>;

export const CoursePackUpgradeAdaptationConflictSchema = z
  .object({
    conflictId: z.string().min(1).max(200),
    activityId: StableIdSchema.nullable(),
    reason: z.string().min(1).max(500),
  })
  .strict();
export type CoursePackUpgradeAdaptationConflict = z.infer<
  typeof CoursePackUpgradeAdaptationConflictSchema
>;

export const CoursePackUpgradePreviewSchema = z
  .object({
    currentRevisionId: StableIdSchema,
    currentRevisionNumber: z.number().int().positive(),
    incomingRevisionNumber: z.number().int().positive(),
    sideBySideKeyPreview: StableIdSchema,
    carried: z.array(CoursePackUpgradeCarriedSchema).max(500),
    requiresRevalidation: z.array(CoursePackUpgradeCarriedSchema).max(500),
    removed: z.array(StableIdSchema).max(500),
    adaptationConflicts: z
      .array(CoursePackUpgradeAdaptationConflictSchema)
      .max(128),
  })
  .strict();
export type CoursePackUpgradePreview = z.infer<
  typeof CoursePackUpgradePreviewSchema
>;

export const CoursePackUpgradeInfoSchema = z
  .object({
    currentRevisionId: StableIdSchema,
    currentRevisionNumber: z.number().int().positive(),
    incomingRevisionNumber: z.number().int().positive(),
    sideBySideKeyPreview: StableIdSchema,
  })
  .strict();
export type CoursePackUpgradeInfo = z.infer<typeof CoursePackUpgradeInfoSchema>;

export const CoursePackUpgradeResultSchema = z
  .object({
    courseId: EntityIdSchema,
    revisionId: EntityIdSchema,
    contentHash: Sha256Schema,
    mode: CoursePackUpgradeModeSchema,
    installed: z.boolean(),
    idempotent: z.boolean(),
    replayedFactCount: z.number().int().nonnegative(),
    supersededEvidenceCount: z.number().int().nonnegative(),
    carriedCount: z.number().int().nonnegative().default(0),
    revalidationCount: z.number().int().nonnegative().default(0),
  })
  .strict();
export type CoursePackUpgradeResult = z.infer<
  typeof CoursePackUpgradeResultSchema
>;
