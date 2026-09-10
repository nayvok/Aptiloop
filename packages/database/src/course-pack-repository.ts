import { createHash, randomUUID } from "node:crypto";

import {
  canonicalJson,
  CoursePackV1Schema,
  finalizeCoursePack,
  validateCoursePackBytes,
  type CoursePackDiagnostic,
  type CoursePackV1,
  type CoursePackValidationReport,
} from "@aptiloop/course-authoring-kit";
import {
  activityContractHash,
  canonicalLearningKernelJson,
  isMigrationProvenance,
  learningKernelSha256,
  projectLearningKernel,
  type LearningKernelFact,
  type LearningKernelFactBody,
  type LearningKernelNonMigrationProvenance,
} from "@aptiloop/learning-core";
import {
  ClientError,
  CourseOperationIdSchema,
  CoursePackUpgradeModeSchema,
  COURSE_TRANSFER_JSON_LIMITS_V1,
  type CoursePackUpgradeMode,
  type CoursePackUpgradePreview,
} from "@aptiloop/shared";

import { adaptationBranchIdForRevision } from "./adaptation-branch.js";
import { withTransaction, type DatabaseConnection } from "./database.js";
import {
  ensureKernelSessionStubDay,
  insertRestoredKernelFact,
  readRevisionActivities,
} from "./kernel-restore.js";

const UTF8_ENCODER = new TextEncoder();

const REQUIRED_M3_TABLES = [
  "course_pack_manifests",
  "course_pack_localizations",
  "course_pack_knowledge_nodes",
  "course_pack_lifecycle_events",
  "course_pack_quarantine",
] as const;

export type CoursePackInstallAction = "install" | "open-as-draft";
export type CoursePackLifecycleAction = CoursePackInstallAction | "uninstall";
export type CoursePackRepositoryErrorCode =
  "active_session" | "conflict" | "not_found";

export class CoursePackRepositoryError extends Error {
  readonly code: CoursePackRepositoryErrorCode;

  constructor(code: CoursePackRepositoryErrorCode, message: string) {
    super(message);
    this.name = "CoursePackRepositoryError";
    this.code = code;
  }
}

export interface CoursePackRepositoryOptions {
  readonly now?: () => number;
  readonly id?: () => string;
}

export interface InstallCoursePackInput {
  readonly operationId: string;
  readonly validationId: string;
  readonly action: CoursePackInstallAction;
  readonly sourceBytesHash: string;
  readonly pack: CoursePackV1;
  readonly canonicalJson: string;
  readonly report: CoursePackValidationReport;
}

export interface CoursePackInstallResult {
  readonly courseId: string;
  readonly revisionId: string;
  readonly contentHash: string;
  readonly action: CoursePackInstallAction;
  readonly revisionStatus: "draft" | "published" | "archived";
  readonly installed: boolean;
  readonly idempotent: boolean;
}

export interface ReconcileCoursePackInstallInput {
  readonly operationId: string;
  readonly validationId: string;
  readonly action: CoursePackInstallAction;
  readonly expectedContentHash: string;
}
export interface ReconcileCoursePackUpgradeInput {
  readonly operationId: string;
  readonly validationId: string;
  readonly mode: CoursePackUpgradeMode;
  readonly expectedContentHash: string;
  readonly sideBySideSuffix?: string | undefined;
  readonly adaptationResolutions?: readonly {
    conflictId: string;
    resolution: "use-upstream" | "keep-personal";
  }[];
}

export interface CoursePackLibraryItem {
  readonly courseId: string;
  readonly courseKey: string;
  readonly title: string;
  readonly revisionId: string;
  readonly revisionNumber: number;
  readonly contentHash: string;
  readonly revisionStatus: "draft" | "published" | "archived";
  readonly lifecycleAction: CoursePackInstallAction;
  readonly importedAt: string;
}

export interface DeleteCoursePackInput {
  readonly operationId: string;
  readonly courseId: string;
  readonly confirmCourseKey: string;
}

export interface DeleteCoursePackResult {
  readonly courseId: string;
  readonly lifecycleAction: "delete";
  readonly retainedEvidenceCount: number;
  readonly deletedRevisionCount: number;
  readonly idempotent: boolean;
}

export interface UpgradeCourseToRevisionInput {
  readonly operationId: string;
  readonly validationId: string;
  readonly pack: CoursePackV1;
  readonly canonicalJson: string;
  readonly report: CoursePackValidationReport;
  readonly sourceBytesHash: string;
  readonly mode: CoursePackUpgradeMode;
  readonly sideBySideSuffix?: string | undefined;
  readonly adaptationResolutions?: readonly {
    conflictId: string;
    resolution: "use-upstream" | "keep-personal";
  }[];
}

export interface CoursePackUpgradeResult {
  readonly courseId: string;
  readonly revisionId: string;
  readonly contentHash: string;
  readonly mode: CoursePackUpgradeMode;
  readonly installed: boolean;
  readonly idempotent: boolean;
  readonly replayedFactCount: number;
  readonly supersededEvidenceCount: number;
  readonly carriedCount: number;
  readonly revalidationCount: number;
  readonly sideBySideCourseKey: string | null;
}
export type CourseUpgradePreview = CoursePackUpgradePreview;

interface CourseDeletionRow {
  course_id: string;
  course_key: string;
  manifest_revision_id: string;
}

interface UpgradeActivityRow {
  id: string;
  lesson_id: string;
  stable_id: string;
  activity_type: string;
  order_index: number;
  required: number;
  capability_ids_json: string;
  knowledge_node_ids_json: string;
  completion_criteria_json: string;
  payload_json: string;
  protected_material_json: string;
}

interface UpgradeAdaptationActivityRow extends UpgradeActivityRow {
  lesson_stable_id: string;
  title: string;
  description: string;
  estimated_minutes: number | null;
  objectives_json: string;
  checklist_json: string;
  sources_json: string;
  questions_json: string;
  misconceptions_json: string;
  depth_level: string | null;
}
function parseUpgradeJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function parseUpgradeStringArray(value: string): readonly string[] {
  const parsed = parseUpgradeJson(value);
  return Array.isArray(parsed)
    ? parsed.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function upgradeActivityContract(row: UpgradeActivityRow): string {
  return activityContractHash({
    type: row.activity_type,
    schemaVersion: 1,
    required: row.required === 1,
    payload: parseUpgradeJson(row.payload_json),
    completionCriteria: parseUpgradeJson(row.completion_criteria_json),
    capabilityIds: parseUpgradeStringArray(row.capability_ids_json),
    knowledgeNodeIds: parseUpgradeStringArray(row.knowledge_node_ids_json),
    protectedMaterial: parseUpgradeJson(row.protected_material_json),
  });
}

function equalStringSets(
  left: Iterable<string>,
  right: Iterable<string>,
): boolean {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return (
    leftSet.size === rightSet.size &&
    [...leftSet].every((value) => rightSet.has(value))
  );
}

function upgradePackActivityContract(
  activity: CoursePackV1["lessons"][number]["activities"][number],
): string {
  return activityContractHash({
    type: activity.type,
    schemaVersion: 1,
    required: activity.required,
    payload: activity.payload,
    completionCriteria: activity.completionCriteria,
    capabilityIds: activity.capabilityIds,
    knowledgeNodeIds: activity.knowledgeNodeIds,
    protectedMaterial: activity.protectedMaterial,
  });
}

export class CoursePackRepository {
  readonly #connection: DatabaseConnection;
  readonly #now: () => number;
  readonly #id: () => string;

  constructor(
    connection: DatabaseConnection,
    options: CoursePackRepositoryOptions = {},
  ) {
    this.#connection = connection;
    this.#now = options.now ?? Date.now;
    this.#id = options.id ?? randomUUID;
  }

  hasStorage(): boolean {
    const rows = this.#connection.sqlite
      .prepare(
        `SELECT name FROM sqlite_schema
         WHERE type = 'table' AND name IN (${REQUIRED_M3_TABLES.map(() => "?").join(", ")})`,
      )
      .all(...REQUIRED_M3_TABLES) as Array<{ name: string }>;
    return rows.length === REQUIRED_M3_TABLES.length;
  }

  recordQuarantine(
    sourceBytesHash: string,
    report: CoursePackValidationReport,
  ): void {
    this.#assertStorage();
    assertSha256(sourceBytesHash, "Course Pack source bytes hash");
    if (report.valid) {
      throw new Error("A valid Course Pack cannot be quarantined");
    }
    const reportJson = boundedReportJson(report);
    this.#connection.sqlite
      .prepare(
        `INSERT OR IGNORE INTO course_pack_quarantine
         (id, source_bytes_hash, validator_version, report_json, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        this.#id(),
        sourceBytesHash,
        report.validatorVersion,
        reportJson,
        this.#now(),
      );
  }

  install(input: InstallCoursePackInput): CoursePackInstallResult {
    this.#assertStorage();
    const operationId = CourseOperationIdSchema.parse(input.operationId);
    const validationId = CourseOperationIdSchema.parse(input.validationId);
    const pack = CoursePackV1Schema.parse(input.pack);
    assertSha256(input.sourceBytesHash, "Course Pack source bytes hash");
    if (!input.report.valid || input.report.errors !== 0) {
      throw new ClientError(
        400,
        "Course Pack installation requires a zero-error report",
      );
    }
    if (input.canonicalJson !== canonicalJson(pack)) {
      throw new ClientError(
        400,
        "Course Pack canonical JSON does not match the validated pack",
      );
    }
    const supportedValidation = validateCoursePackBytes(
      UTF8_ENCODER.encode(input.canonicalJson),
    );
    if (!supportedValidation.valid) {
      throw new ClientError(
        400,
        "Course Pack installation requires app-supported validation",
      );
    }
    if (
      supportedValidation.canonicalJson !== input.canonicalJson ||
      supportedValidation.contentHash !== pack.revision.contentHash
    ) {
      throw new ClientError(
        400,
        "Course Pack app-supported validation is inconsistent",
      );
    }

    return withTransaction(this.#connection, () => {
      const existingOperation = this.#readLifecycleOperation(operationId);
      if (existingOperation) {
        return this.#reconcileInstallOperation(existingOperation, {
          operationId,
          validationId,
          action: input.action,
          expectedContentHash: pack.revision.contentHash,
        });
      }

      const existingManifest = this.#connection.sqlite
        .prepare(
          `SELECT content_hash FROM course_pack_manifests WHERE revision_id = ?`,
        )
        .get(pack.revision.revisionKey) as { content_hash: string } | undefined;
      if (existingManifest) {
        if (existingManifest.content_hash !== pack.revision.contentHash) {
          throw new CoursePackRepositoryError(
            "conflict",
            "Course Pack revision identity is already bound to different content",
          );
        }
        const lifecycle = this.#readImportLifecycle(pack.revision.revisionKey);
        if (!lifecycle || lifecycle.action !== input.action) {
          throw new CoursePackRepositoryError(
            "conflict",
            "Course Pack revision is already bound to a different lifecycle action",
          );
        }
        const result = this.#installResult(pack, input.action, false, true);
        this.#insertInstallLifecycleEvent({
          operationId,
          validationId,
          action: input.action,
          manifestRevisionId: pack.revision.revisionKey,
          resultRevisionId: result.revisionId,
          contentHash: pack.revision.contentHash,
          sourceBytesHash: input.sourceBytesHash,
          occurredAt: this.#now(),
        });
        return result;
      }

      const now = this.#now();
      if (input.action === "install") {
        this.#assertCourseHasNoActiveSession(pack.course.courseKey);
      }
      this.#assertInstallIdentity(pack);
      this.#insertCompatibilityGraph(pack, now);
      this.#applyPackTargetMetadata(pack);
      this.#insertKnowledge(pack, now);
      this.#connection.sqlite
        .prepare(
          `INSERT INTO course_pack_manifests
           (revision_id, format_version, canonical_json, content_hash,
            source_bytes_hash, validation_report_json, validator_version,
            imported_at)
           VALUES (?, 1, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          pack.revision.revisionKey,
          input.canonicalJson,
          pack.revision.contentHash,
          input.sourceBytesHash,
          boundedReportJson(supportedValidation.report),
          supportedValidation.report.validatorVersion,
          now,
        );
      this.#insertPackMetadata(pack);
      if (input.action === "install") {
        this.#prepareInstalledPersonalBranch(pack, now);
      }
      this.#assertCompatibilityProjection(pack, pack.revision.revisionKey);
      this.#publishManifestRevision(pack, now);

      let resultRevisionId = pack.revision.revisionKey;
      if (input.action === "install") {
        this.#activateInstalledRevisionBranch(pack, now);
        this.#connection.sqlite
          .prepare(
            `UPDATE courses SET active_revision_id = ?, title = ?,
                 description = ?, primary_locale = ?, updated_at = ?
             WHERE id = ?`,
          )
          .run(
            pack.revision.revisionKey,
            pack.course.title,
            pack.course.description,
            pack.course.primaryLocale,
            now,
            pack.course.courseKey,
          );
        this.#connection.sqlite
          .prepare(
            `UPDATE curricula SET active_version_id = ?, title = ?,
                 description = ?, updated_at = ? WHERE id = ?`,
          )
          .run(
            pack.revision.revisionKey,
            pack.course.title,
            pack.course.description,
            now,
            pack.course.courseKey,
          );
        this.#connection.sqlite
          .prepare(
            `UPDATE learner_course_states
             SET active_revision_id = ?, current_learning_session_id = NULL,
                 updated_at = MAX(created_at, ?)
             WHERE course_id = ?`,
          )
          .run(pack.revision.revisionKey, now, pack.course.courseKey);
      } else {
        resultRevisionId = this.#createEditableDraft(pack, now);
        this.#archiveManifestRevision(pack, now);
      }

      this.#insertInstallLifecycleEvent({
        operationId,
        validationId,
        action: input.action,
        manifestRevisionId: pack.revision.revisionKey,
        resultRevisionId,
        contentHash: pack.revision.contentHash,
        sourceBytesHash: input.sourceBytesHash,
        occurredAt: now,
      });

      return this.#installResult(pack, input.action, true, false);
    });
  }

  reconcileInstall(
    input: ReconcileCoursePackInstallInput,
  ): CoursePackInstallResult | null {
    this.#assertStorage();
    const operationId = CourseOperationIdSchema.parse(input.operationId);
    const validationId = CourseOperationIdSchema.parse(input.validationId);
    assertSha256(
      input.expectedContentHash,
      "Course Pack expected content hash",
    );
    const existingOperation = this.#readLifecycleOperation(operationId);
    if (!existingOperation) return null;
    return this.#reconcileInstallOperation(existingOperation, {
      operationId,
      validationId,
      action: input.action,
      expectedContentHash: input.expectedContentHash,
    });
  }

  list(): readonly CoursePackLibraryItem[] {
    if (!this.hasStorage()) return [];
    const rows = this.#connection.sqlite
      .prepare(
        `SELECT course.id AS course_id, course.stable_id AS course_key,
                course.title, revision.id AS revision_id,
                CAST(json_extract(
                  manifest.canonical_json,
                  '$.revision.revisionNumber'
                ) AS INTEGER) AS revision_number,
                revision.status,
                manifest.content_hash, manifest.imported_at,
                event.action
         FROM course_pack_manifests manifest
         JOIN course_revisions revision ON revision.id = manifest.revision_id
         JOIN courses course ON course.id = revision.course_id
         JOIN course_pack_lifecycle_events event ON event.id = (
           SELECT latest.id FROM course_pack_lifecycle_events latest
           WHERE latest.revision_id = manifest.revision_id
            ORDER BY latest.occurred_at DESC, latest.rowid DESC LIMIT 1
         )
         WHERE event.action IN ('install', 'open-as-draft')
           AND NOT EXISTS (
             SELECT 1
             FROM course_pack_lifecycle_events latest_course_event
             JOIN course_pack_manifests latest_course_manifest
               ON latest_course_manifest.revision_id = latest_course_event.revision_id
             JOIN course_revisions latest_course_revision
               ON latest_course_revision.id = latest_course_manifest.revision_id
             WHERE latest_course_revision.course_id = course.id
               AND latest_course_event.action = 'uninstall'
               AND latest_course_event.rowid = (
                 SELECT candidate_event.rowid
                 FROM course_pack_lifecycle_events candidate_event
                 JOIN course_pack_manifests candidate_manifest
                   ON candidate_manifest.revision_id = candidate_event.revision_id
                 JOIN course_revisions candidate_revision
                   ON candidate_revision.id = candidate_manifest.revision_id
                 WHERE candidate_revision.course_id = course.id
                 ORDER BY candidate_event.occurred_at DESC,
                          candidate_event.rowid DESC
                 LIMIT 1
               )
           )
         ORDER BY course.stable_id, revision.revision_number, revision.id`,
      )
      .all() as Array<{
      course_id: string;
      course_key: string;
      title: string;
      revision_id: string;
      revision_number: number;
      status: "draft" | "published" | "archived";
      content_hash: string;
      imported_at: number;
      action: CoursePackInstallAction;
    }>;
    return rows.map((row) => ({
      courseId: row.course_id,
      courseKey: row.course_key,
      title: row.title,
      revisionId: row.revision_id,
      revisionNumber: row.revision_number,
      contentHash: row.content_hash,
      revisionStatus: row.status,
      lifecycleAction: row.action,
      importedAt: new Date(row.imported_at).toISOString(),
    }));
  }

  read(revisionId: string): CoursePackV1 | null {
    if (!this.hasStorage()) return null;
    const row = this.#connection.sqlite
      .prepare(
        `SELECT canonical_json FROM course_pack_manifests WHERE revision_id = ?`,
      )
      .get(revisionId) as { canonical_json: string } | undefined;
    return row
      ? CoursePackV1Schema.parse(JSON.parse(row.canonical_json) as unknown)
      : null;
  }

  exportCanonicalJson(revisionId: string): string | null {
    if (!this.hasStorage()) return null;
    const row = this.#connection.sqlite
      .prepare(
        `SELECT manifest.canonical_json
         FROM course_pack_manifests manifest
         JOIN course_revisions revision ON revision.id = manifest.revision_id
         WHERE manifest.revision_id = ?
           AND (
             SELECT latest_event.action
             FROM course_pack_lifecycle_events latest_event
             JOIN course_pack_manifests latest_manifest
               ON latest_manifest.revision_id = latest_event.revision_id
             JOIN course_revisions latest_revision
               ON latest_revision.id = latest_manifest.revision_id
             WHERE latest_revision.course_id = revision.course_id
             ORDER BY latest_event.occurred_at DESC, latest_event.rowid DESC
             LIMIT 1
           ) != 'uninstall'`,
      )
      .get(revisionId) as { canonical_json: string } | undefined;
    if (!row) return null;
    const parsed = CoursePackV1Schema.parse(
      JSON.parse(row.canonical_json) as unknown,
    );
    const canonical = canonicalJson(parsed);
    if (canonical !== row.canonical_json) {
      throw new ClientError(
        400,
        "Stored Course Pack canonical bytes are inconsistent",
      );
    }
    return canonical;
  }

  deleteCourse(input: DeleteCoursePackInput): DeleteCoursePackResult {
    this.#assertStorage();
    const operationId = CourseOperationIdSchema.parse(input.operationId);
    return withTransaction(this.#connection, () => {
      const course = this.#connection.sqlite
        .prepare(
          `SELECT course.id AS course_id, course.stable_id AS course_key,
                  manifest.revision_id AS manifest_revision_id
           FROM courses course
           JOIN course_revisions revision ON revision.course_id = course.id
           JOIN course_pack_manifests manifest ON manifest.revision_id = revision.id
           WHERE course.id = ?
           ORDER BY manifest.imported_at DESC, manifest.rowid DESC
           LIMIT 1`,
        )
        .get(input.courseId) as CourseDeletionRow | undefined;
      if (!course) {
        throw new CoursePackRepositoryError(
          "not_found",
          "Unknown Course Pack Course",
        );
      }
      if (input.confirmCourseKey !== course.course_key) {
        throw new CoursePackRepositoryError(
          "conflict",
          "Course deletion confirmation does not match Course",
        );
      }

      const existingOperation = this.#readLifecycleOperation(operationId);
      if (existingOperation) {
        const existingCourse = this.#connection.sqlite
          .prepare(
            `SELECT revision.course_id
             FROM course_pack_manifests manifest
             JOIN course_revisions revision ON revision.id = manifest.revision_id
             WHERE manifest.revision_id = ?`,
          )
          .get(existingOperation.revision_id) as
          { course_id: string } | undefined;
        if (
          existingCourse?.course_id !== input.courseId ||
          existingOperation.action !== "uninstall"
        ) {
          throw new CoursePackRepositoryError(
            "conflict",
            "Course Pack operation ID is already bound to a different action",
          );
        }
        return {
          courseId: input.courseId,
          lifecycleAction: "delete",
          retainedEvidenceCount: this.#evidenceCountForCourse(input.courseId),
          deletedRevisionCount: this.#revisionCount(input.courseId),
          idempotent: true,
        };
      }

      const activeSession = this.#connection.sqlite
        .prepare(
          `SELECT session.id
           FROM learning_sessions session
           JOIN session_course_contexts context ON context.session_id = session.id
           WHERE context.course_id = ? AND session.status = 'active'
           LIMIT 1`,
        )
        .get(input.courseId) as { id: string } | undefined;
      if (activeSession) {
        throw new CoursePackRepositoryError(
          "active_session",
          "Course is pinned by an active learning session",
        );
      }

      const now = this.#now();
      this.#connection.sqlite
        .prepare(
          `UPDATE course_revisions
           SET status = 'archived', archived_at = ?, updated_at = ?
           WHERE course_id = ? AND status != 'archived'`,
        )
        .run(now, now, input.courseId);
      this.#connection.sqlite
        .prepare(
          `UPDATE curriculum_versions
           SET status = 'archived', archived_at = ?, updated_at = ?
           WHERE curriculum_id = ? AND status != 'archived'`,
        )
        .run(now, now, input.courseId);
      this.#connection.sqlite
        .prepare(
          `UPDATE curricula SET active_version_id = NULL, updated_at = ?
           WHERE id = ?`,
        )
        .run(now, input.courseId);
      this.#connection.sqlite
        .prepare(
          `UPDATE courses SET active_revision_id = NULL, updated_at = ?
           WHERE id = ?`,
        )
        .run(now, input.courseId);
      this.#connection.sqlite
        .prepare(
          `UPDATE adaptation_branches SET status = 'archived', updated_at = ?
           WHERE course_id = ? AND status = 'active'`,
        )
        .run(now, input.courseId);
      this.#connection.sqlite
        .prepare(
          `UPDATE learner_state
           SET current_learning_session_id = NULL, updated_at = ?
           WHERE current_learning_session_id IN (
             SELECT context.session_id
             FROM session_course_contexts context
             JOIN learning_sessions session ON session.id = context.session_id
             WHERE context.course_id = ? AND session.status != 'active'
           )`,
        )
        .run(now, input.courseId);
      this.#connection.sqlite
        .prepare(`DELETE FROM learner_course_states WHERE course_id = ?`)
        .run(input.courseId);
      this.#connection.sqlite
        .prepare(
          `UPDATE learner_course_states
           SET is_selected = 1, updated_at = MAX(updated_at, ?)
           WHERE course_id = (
             SELECT state.course_id
             FROM learner_course_states state
             JOIN course_revisions revision
               ON revision.course_id = state.course_id
              AND revision.id = state.active_revision_id
             JOIN curriculum_versions source
               ON source.curriculum_id = revision.course_id
              AND source.id = revision.id
             WHERE revision.status = 'published'
               AND source.status = 'published'
             ORDER BY state.updated_at DESC, state.course_id
             LIMIT 1
           )
             AND NOT EXISTS (
               SELECT 1 FROM learner_course_states WHERE is_selected = 1
             )`,
        )
        .run(now);
      const retainedEvidenceCount = this.#evidenceCountForCourse(
        input.courseId,
      );
      const deletedRevisionCount = this.#revisionCount(input.courseId);
      this.#connection.sqlite
        .prepare(
          `INSERT INTO course_pack_lifecycle_events

           (id, revision_id, operation_id, action, occurred_at, details_json)
           VALUES (?, ?, ?, 'uninstall', ?, ?)`,
        )
        .run(
          this.#id(),
          course.manifest_revision_id,
          operationId,
          now,
          canonicalJson({
            courseId: input.courseId,
            deletedRevisionCount,
            retainedEvidenceCount,
          }),
        );
      return {
        courseId: input.courseId,
        lifecycleAction: "delete",
        retainedEvidenceCount,
        deletedRevisionCount,
        idempotent: false,
      };
    });
  }
  reconcileUpgrade(
    input: ReconcileCoursePackUpgradeInput,
  ): CoursePackUpgradeResult | null {
    this.#assertStorage();
    const operationId = CourseOperationIdSchema.parse(input.operationId);
    const validationId = CourseOperationIdSchema.parse(input.validationId);
    const mode = CoursePackUpgradeModeSchema.parse(input.mode);
    assertSha256(
      input.expectedContentHash,
      "Course Pack expected content hash",
    );
    const payloadHash = upgradeRequestPayloadHash(
      mode,
      input.sideBySideSuffix,
      input.adaptationResolutions,
    );
    return withTransaction(this.#connection, () => {
      const operation = this.#readLifecycleOperation(operationId);
      if (!operation) return null;
      return this.#reconcileUpgradeOperation(operation, {
        operationId,
        validationId,
        mode,
        expectedContentHash: input.expectedContentHash,
        payloadHash,
      });
    });
  }
  /**
   * Returns a bounded, learner-safe compatibility preview. Protected material
   * only participates in contract hashes and is never returned.
   */
  previewUpgrade(
    courseKey: string,
    pack: CoursePackV1,
  ): CourseUpgradePreview | null {
    if (!this.hasStorage() || pack.course.courseKey !== courseKey) return null;
    const course = this.#connection.sqlite
      .prepare("SELECT id, active_revision_id FROM courses WHERE id = ?")
      .get(courseKey) as
      { id: string; active_revision_id: string | null } | undefined;
    if (!course) return null;
    const activeBranch = this.#connection.sqlite
      .prepare(
        `SELECT base_revision_id, head_revision_id
         FROM adaptation_branches
         WHERE course_id = ? AND status = 'active'
         ORDER BY id LIMIT 1`,
      )
      .get(courseKey) as
      { base_revision_id: string; head_revision_id: string | null } | undefined;
    const revisions = this.#connection.sqlite
      .prepare(
        `SELECT id, revision_number FROM course_revisions
         WHERE course_id = ? ORDER BY revision_number DESC, id`,
      )
      .all(courseKey) as Array<{ id: string; revision_number: number }>;
    const latest = revisions[0];
    if (
      !latest ||
      pack.revision.revisionNumber <= latest.revision_number ||
      pack.revision.parentRevisionKey === null ||
      !revisions.some((row) => row.id === pack.revision.parentRevisionKey)
    ) {
      return null;
    }
    const current =
      (activeBranch?.head_revision_id !== null &&
      activeBranch?.head_revision_id !== undefined
        ? revisions.find((row) => row.id === activeBranch.base_revision_id)
        : undefined) ??
      revisions.find((row) => row.id === course.active_revision_id) ??
      latest;
    const currentRows = this.#connection.sqlite
      .prepare(
        `SELECT activity.id, activity.lesson_id, lesson.stable_id AS lesson_stable_id,
                activity.stable_id, activity.activity_type, activity.order_index,
                activity.required, activity.capability_ids_json,
                activity.knowledge_node_ids_json, activity.completion_criteria_json,
                activity.payload_json, activity.protected_material_json
         FROM course_activities activity
         JOIN course_lessons lesson
           ON lesson.course_id = activity.course_id
          AND lesson.revision_id = activity.revision_id
          AND lesson.id = activity.lesson_id
         WHERE activity.course_id = ? AND activity.revision_id = ?
         ORDER BY activity.stable_id`,
      )
      .all(courseKey, current.id) as unknown as Array<
      UpgradeActivityRow & { lesson_stable_id: string }
    >;
    const currentByStable = new Map(
      currentRows.map((row) => [row.stable_id, row] as const),
    );
    const incomingByStable = new Map(
      pack.lessons.flatMap((lesson) =>
        lesson.activities.map(
          (activity) =>
            [
              activity.activityId,
              { activity, lessonStableId: lesson.lessonId },
            ] as const,
        ),
      ),
    );
    const currentDependencies = this.#readActivityDependencies(
      courseKey,
      current.id,
    );
    const currentStableById = new Map(
      currentRows.map((row) => [row.id, row.stable_id] as const),
    );
    const incomingContracts = new Map(
      [...incomingByStable].map(([stableId, value]) => [
        stableId,
        upgradePackActivityContract(value.activity),
      ]),
    );
    const carried: CourseUpgradePreview["carried"] = [];
    const requiresRevalidation: CourseUpgradePreview["requiresRevalidation"] =
      [];
    const removed: string[] = [];
    for (const [stableId, row] of currentByStable) {
      const incoming = incomingByStable.get(stableId);
      if (!incoming) {
        removed.push(stableId);
        continue;
      }
      const oldPrerequisites = [
        ...(currentDependencies.get(row.id) ?? new Set<string>()),
      ]
        .map((id) => currentStableById.get(id))
        .filter((id): id is string => id !== undefined);
      const compatible =
        row.lesson_stable_id === incoming.lessonStableId &&
        upgradeActivityContract(row) === incomingContracts.get(stableId) &&
        equalStringSets(
          oldPrerequisites,
          incoming.activity.prerequisiteActivityIds,
        );
      const entry = {
        activityId: stableId,
        contractHash: incomingContracts.get(stableId)!,
      };
      (compatible ? carried : requiresRevalidation).push(entry);
    }
    removed.sort();
    carried.sort((left, right) =>
      left.activityId.localeCompare(right.activityId),
    );
    requiresRevalidation.sort((left, right) =>
      left.activityId.localeCompare(right.activityId),
    );
    const adaptationConflicts: CourseUpgradePreview["adaptationConflicts"] = [];
    if (
      activeBranch?.base_revision_id === current.id &&
      activeBranch.head_revision_id !== null &&
      activeBranch.head_revision_id !== current.id
    ) {
      const personalRows = this.#connection.sqlite
        .prepare(
          `SELECT activity.id, activity.lesson_id, lesson.stable_id AS lesson_stable_id,
                  activity.stable_id, activity.activity_type, activity.order_index,
                  activity.required, activity.capability_ids_json,
                  activity.knowledge_node_ids_json, activity.completion_criteria_json,
                  activity.payload_json, activity.protected_material_json
           FROM course_activities activity
           JOIN course_lessons lesson
             ON lesson.course_id = activity.course_id
            AND lesson.revision_id = activity.revision_id
            AND lesson.id = activity.lesson_id
           WHERE activity.course_id = ? AND activity.revision_id = ?
           ORDER BY activity.stable_id`,
        )
        .all(courseKey, activeBranch.head_revision_id) as unknown as Array<
        UpgradeActivityRow & { lesson_stable_id: string }
      >;
      for (const personal of personalRows) {
        const upstream = currentByStable.get(personal.stable_id);
        const incoming = incomingByStable.get(personal.stable_id);
        const personalChanged =
          upstream === undefined ||
          upgradeActivityContract(personal) !==
            upgradeActivityContract(upstream);
        const upstreamChanged =
          incoming === undefined ||
          upstream === undefined ||
          upgradeActivityContract(upstream) !==
            incomingContracts.get(personal.stable_id);
        if (personalChanged && upstreamChanged) {
          adaptationConflicts.push({
            conflictId: `adaptation-${personal.stable_id}`,
            activityId: incoming?.activity.activityId ?? personal.stable_id,
            reason:
              incoming === undefined
                ? "Personal adaptation targets an activity removed by the incoming revision"
                : "Personal adaptation and incoming revision both changed this activity contract",
          });
        }
      }
      adaptationConflicts.sort((left, right) =>
        left.conflictId.localeCompare(right.conflictId),
      );
    }
    let sideBySideKeyPreview = `${courseKey}-r${pack.revision.revisionNumber}`;
    let collisionSuffix = 2;
    while (
      this.#connection.sqlite
        .prepare(
          `SELECT 1 FROM courses WHERE id = ?
           UNION ALL SELECT 1 FROM course_revisions WHERE id = ?`,
        )
        .get(sideBySideKeyPreview, `${sideBySideKeyPreview}/v1`)
    ) {
      sideBySideKeyPreview =
        `${courseKey}-r${pack.revision.revisionNumber}-${collisionSuffix++}`.slice(
          0,
          200,
        );
    }
    return {
      currentRevisionId: current.id,
      currentRevisionNumber: current.revision_number,
      incomingRevisionNumber: pack.revision.revisionNumber,
      sideBySideKeyPreview,
      carried,
      requiresRevalidation,
      removed,
      adaptationConflicts,
    };
  }

  upgradeCourseToRevision(
    input: UpgradeCourseToRevisionInput,
  ): CoursePackUpgradeResult {
    this.#assertStorage();
    const operationId = CourseOperationIdSchema.parse(input.operationId);
    const validationId = CourseOperationIdSchema.parse(input.validationId);
    const mode = CoursePackUpgradeModeSchema.parse(input.mode);
    const pack = CoursePackV1Schema.parse(input.pack);
    assertSha256(input.sourceBytesHash, "Course Pack source bytes hash");
    if (!input.report.valid || input.report.errors !== 0) {
      throw new ClientError(
        400,
        "Course Pack upgrade requires a zero-error report",
      );
    }
    if (input.canonicalJson !== canonicalJson(pack)) {
      throw new ClientError(
        400,
        "Course Pack canonical JSON does not match the validated pack",
      );
    }
    const supportedValidation = validateCoursePackBytes(
      UTF8_ENCODER.encode(input.canonicalJson),
    );
    if (!supportedValidation.valid) {
      throw new ClientError(
        400,
        "Course Pack upgrade requires app-supported validation",
      );
    }
    if (
      supportedValidation.canonicalJson !== input.canonicalJson ||
      supportedValidation.contentHash !== pack.revision.contentHash
    ) {
      throw new ClientError(
        400,
        "Course Pack app-supported validation is inconsistent",
      );
    }
    const payloadHash = upgradeRequestPayloadHash(
      mode,
      input.sideBySideSuffix,
      input.adaptationResolutions,
    );
    return withTransaction(this.#connection, () => {
      const existingOperation = this.#readLifecycleOperation(operationId);
      if (existingOperation) {
        return this.#reconcileUpgradeOperation(existingOperation, {
          operationId,
          validationId,
          mode,
          expectedContentHash: pack.revision.contentHash,
          payloadHash,
        });
      }
      if (
        mode === "side-by-side" &&
        (input.adaptationResolutions?.length ?? 0) > 0
      ) {
        throw new CoursePackRepositoryError(
          "conflict",
          "Side-by-side upgrades cannot carry adaptation resolutions",
        );
      }
      switch (mode) {
        case "side-by-side":
          return this.#upgradeSideBySide({
            operationId,
            validationId,
            pack,
            sideBySideSuffix: input.sideBySideSuffix,
            payloadHash,
            sourceBytesHash: input.sourceBytesHash,
          });
        default:
          return this.#upgradeKeepProgress({
            operationId,
            validationId,
            pack,
            canonicalJson: input.canonicalJson,
            report: supportedValidation.report,
            sourceBytesHash: input.sourceBytesHash,
            payloadHash,
            ...(input.adaptationResolutions === undefined
              ? {}
              : { adaptationResolutions: input.adaptationResolutions }),
          });
      }
    });
  }

  #upgradeKeepProgress(input: {
    operationId: string;
    validationId: string;
    pack: CoursePackV1;
    canonicalJson: string;
    report: CoursePackValidationReport;
    sourceBytesHash: string;
    payloadHash: string;
    adaptationResolutions?: readonly {
      conflictId: string;
      resolution: "use-upstream" | "keep-personal";
    }[];
  }): CoursePackUpgradeResult {
    const courseKey = input.pack.course.courseKey;
    const course = this.#connection.sqlite
      .prepare(
        `SELECT id, primary_locale, active_revision_id FROM courses
         WHERE id = ?`,
      )
      .get(courseKey) as
      | {
          id: string;
          primary_locale: string;
          active_revision_id: string | null;
        }
      | undefined;
    if (!course) {
      throw new CoursePackRepositoryError(
        "not_found",
        "No installed Course matches this upgrade; install it first",
      );
    }
    if (course.primary_locale !== input.pack.course.primaryLocale) {
      throw new CoursePackRepositoryError(
        "conflict",
        "Course Pack primary locale change requires an explicit migration",
      );
    }
    const preview = this.previewUpgrade(courseKey, input.pack);
    if (preview === null) {
      throw new CoursePackRepositoryError(
        "conflict",
        "Course Pack upgrade preview is no longer applicable",
      );
    }
    const supplied = input.adaptationResolutions ?? [];
    const suppliedIds = supplied.map((entry) => entry.conflictId);
    if (new Set(suppliedIds).size !== suppliedIds.length) {
      throw new CoursePackRepositoryError(
        "conflict",
        "Adaptation resolutions contain duplicate conflict IDs",
      );
    }
    const expectedIds = preview.adaptationConflicts.map(
      (entry) => entry.conflictId,
    );
    if (
      suppliedIds.length !== expectedIds.length ||
      suppliedIds.some((id) => !expectedIds.includes(id))
    ) {
      throw new CoursePackRepositoryError(
        "conflict",
        "Adaptation resolutions must exactly match the preview conflicts",
      );
    }
    if (
      supplied.some(
        (entry) =>
          entry.resolution !== "use-upstream" &&
          entry.resolution !== "keep-personal",
      )
    ) {
      throw new CoursePackRepositoryError(
        "conflict",
        "Adaptation resolution is unsupported",
      );
    }
    const revisions = this.#connection.sqlite
      .prepare(
        `SELECT id, revision_number FROM course_revisions
         WHERE course_id = ? ORDER BY revision_number DESC`,
      )
      .all(courseKey) as Array<{ id: string; revision_number: number }>;
    const latest = revisions[0];
    if (
      !latest ||
      input.pack.revision.revisionNumber <= latest.revision_number
    ) {
      throw new CoursePackRepositoryError(
        "conflict",
        "Course Pack revision is not newer than the installed Course",
      );
    }
    const collision = this.#connection.sqlite
      .prepare(`SELECT id FROM course_revisions WHERE id = ?`)
      .get(input.pack.revision.revisionKey);
    if (collision) {
      throw new CoursePackRepositoryError(
        "conflict",
        "Course Pack revision identity already exists",
      );
    }
    if (
      input.pack.revision.parentRevisionKey === null ||
      !revisions.some((row) => row.id === input.pack.revision.parentRevisionKey)
    ) {
      throw new CoursePackRepositoryError(
        "conflict",
        "Course Pack parent revision is unavailable",
      );
    }
    const branchId = adaptationBranchIdForRevision(
      courseKey,
      input.pack.revision.revisionKey,
    );
    const occupiedBranch = this.#connection.sqlite
      .prepare(
        `SELECT base_revision_id FROM adaptation_branches
         WHERE course_id = ? AND id = ?`,
      )
      .get(courseKey, branchId) as { base_revision_id: string } | undefined;
    const expectedBase =
      input.pack.revision.branchKind === "upstream"
        ? input.pack.revision.revisionKey
        : input.pack.revision.parentRevisionKey;
    if (occupiedBranch && occupiedBranch.base_revision_id !== expectedBase) {
      throw new CoursePackRepositoryError(
        "conflict",
        "Personal adaptation branch identity is already occupied",
      );
    }
    const activeSession = this.#connection.sqlite
      .prepare(
        `SELECT session.id
         FROM learning_sessions session
         JOIN session_course_contexts context ON context.session_id = session.id
         WHERE context.course_id = ? AND session.status = 'active'
         LIMIT 1`,
      )
      .get(courseKey);
    if (activeSession) {
      throw new CoursePackRepositoryError(
        "active_session",
        "Course has an active session on the old revision; finish or abandon it before safe-update",
      );
    }
    const activeBranch = this.#connection.sqlite
      .prepare(
        `SELECT base_revision_id, head_revision_id
         FROM adaptation_branches
         WHERE course_id = ? AND status = 'active'
         ORDER BY id LIMIT 1`,
      )
      .get(courseKey) as
      { base_revision_id: string; head_revision_id: string | null } | undefined;
    const oldPersonalHead =
      activeBranch?.base_revision_id === preview.currentRevisionId &&
      activeBranch.head_revision_id !== null
        ? activeBranch.head_revision_id
        : null;
    const now = this.#now();
    this.#insertUpgradedRevision(
      input.pack,
      input.canonicalJson,
      input.report,
      input.sourceBytesHash,
      now,
    );
    if (oldPersonalHead !== null) {
      this.#materializeRebasedPersonalBranch({
        pack: input.pack,
        oldHeadRevisionId: oldPersonalHead,
        baseRevisionId: preview.currentRevisionId,
        adaptationConflicts: preview.adaptationConflicts,
        adaptationResolutions: supplied,
        now,
      });
    }
    this.#connection.sqlite
      .prepare(
        `UPDATE learner_course_states
         SET active_revision_id = ?, updated_at = MAX(created_at, ?)
         WHERE course_id = ?`,
      )
      .run(input.pack.revision.revisionKey, now, courseKey);
    const { replayed, superseded, revalidation } = this.#replayUpgradeFacts(
      input.operationId,
      courseKey,
      course.active_revision_id,
      input.pack,
      now,
    );
    const result: CoursePackUpgradeResult = {
      courseId: courseKey,
      revisionId: input.pack.revision.revisionKey,
      contentHash: input.pack.revision.contentHash,
      mode: "safe-update",
      installed: true,
      idempotent: false,
      replayedFactCount: replayed,
      supersededEvidenceCount: superseded,
      carriedCount: replayed,
      revalidationCount: revalidation,
      sideBySideCourseKey: null,
    };
    this.#insertUpgradeLifecycleEvent({
      operationId: input.operationId,
      validationId: input.validationId,
      manifestRevisionId: input.pack.revision.revisionKey,
      result,
      sourceBytesHash: input.sourceBytesHash,
      payloadHash: input.payloadHash,
      occurredAt: now,
    });
    return result;
  }

  #materializeRebasedPersonalBranch(input: {
    pack: CoursePackV1;
    oldHeadRevisionId: string;
    baseRevisionId: string;
    adaptationConflicts: CourseUpgradePreview["adaptationConflicts"];
    adaptationResolutions: readonly {
      conflictId: string;
      resolution: "use-upstream" | "keep-personal";
    }[];
    now: number;
  }): CoursePackV1 {
    const courseId = input.pack.course.courseKey;
    const personalRevisionId = scopedId(
      "rebase",
      input.pack.revision.revisionKey,
      input.oldHeadRevisionId,
    );
    const personalPack = CoursePackV1Schema.parse({
      ...input.pack,
      revision: {
        ...input.pack.revision,
        revisionKey: personalRevisionId,
        parentRevisionKey: input.pack.revision.revisionKey,
        branchKind: "personal",
        basedOnContentHash: input.pack.revision.contentHash,
      },
    });
    const branchId = adaptationBranchIdForRevision(
      courseId,
      personalRevisionId,
    );
    this.#connection.sqlite
      .prepare(
        `INSERT INTO adaptation_branches
         (id, course_id, owner, base_revision_id, head_revision_id, status,
          created_at, updated_at)
         VALUES (?, ?, 'local', ?, NULL, 'archived', ?, ?)`,
      )
      .run(
        branchId,
        courseId,
        input.pack.revision.revisionKey,
        input.now,
        input.now,
      );
    this.#insertCompatibilityGraph(personalPack, input.now, {
      id: personalRevisionId,
      revisionNumber: input.pack.revision.revisionNumber,
      parentRevisionId: input.pack.revision.revisionKey,
      branchKind: "personal",
      basedOnContentHash: input.pack.revision.contentHash,
      adaptationBranchId: branchId,
    });
    this.#applyPackActivityMetadata(personalPack, personalRevisionId);
    this.#assertCompatibilityProjection(personalPack, personalRevisionId);

    const baseRows = this.#connection.sqlite
      .prepare(
        `SELECT activity.id, activity.lesson_id, lesson.stable_id AS lesson_stable_id,
                activity.stable_id, activity.activity_type, activity.order_index,
                activity.required, activity.capability_ids_json,
                activity.knowledge_node_ids_json, activity.completion_criteria_json,
                activity.payload_json, activity.protected_material_json,
                activity.title, activity.description, activity.estimated_minutes,
                activity.objectives_json, activity.checklist_json,
                activity.sources_json, activity.questions_json,
                activity.misconceptions_json, activity.depth_level
         FROM course_activities activity
         JOIN course_lessons lesson
           ON lesson.course_id = activity.course_id
          AND lesson.revision_id = activity.revision_id
          AND lesson.id = activity.lesson_id
         WHERE activity.course_id = ? AND activity.revision_id = ?
         ORDER BY activity.stable_id`,
      )
      .all(
        courseId,
        input.baseRevisionId,
      ) as unknown as UpgradeAdaptationActivityRow[];
    const personalRows = this.#connection.sqlite
      .prepare(
        `SELECT activity.id, activity.lesson_id, lesson.stable_id AS lesson_stable_id,
                activity.stable_id, activity.activity_type, activity.order_index,
                activity.required, activity.capability_ids_json,
                activity.knowledge_node_ids_json, activity.completion_criteria_json,
                activity.payload_json, activity.protected_material_json,
                activity.title, activity.description, activity.estimated_minutes,
                activity.objectives_json, activity.checklist_json,
                activity.sources_json, activity.questions_json,
                activity.misconceptions_json, activity.depth_level
         FROM course_activities activity
         JOIN course_lessons lesson
           ON lesson.course_id = activity.course_id
          AND lesson.revision_id = activity.revision_id
          AND lesson.id = activity.lesson_id
         WHERE activity.course_id = ? AND activity.revision_id = ?
         ORDER BY activity.stable_id`,
      )
      .all(
        courseId,
        input.oldHeadRevisionId,
      ) as unknown as UpgradeAdaptationActivityRow[];
    const baseByStable = new Map(
      baseRows.map((row) => [row.stable_id, row] as const),
    );
    const incomingByStable = new Map(
      input.pack.lessons.flatMap((lesson) =>
        lesson.activities.map(
          (activity) =>
            [
              activity.activityId,
              { activity, lessonStableId: lesson.lessonId },
            ] as const,
        ),
      ),
    );
    const resolutions = new Map(
      input.adaptationResolutions.map((entry) => [
        entry.conflictId,
        entry.resolution,
      ]),
    );
    const targetLessonIds = new Map(
      (
        this.#connection.sqlite
          .prepare(
            `SELECT id, stable_id FROM course_lessons
             WHERE course_id = ? AND revision_id = ?`,
          )
          .all(courseId, personalRevisionId) as Array<{
          id: string;
          stable_id: string;
        }>
      ).map((row) => [row.stable_id, row.id] as const),
    );
    const conflictIds = new Set(
      input.adaptationConflicts.map((conflict) => conflict.conflictId),
    );
    for (const personal of personalRows) {
      const base = baseByStable.get(personal.stable_id);
      const incoming = incomingByStable.get(personal.stable_id);
      const personalChanged =
        base === undefined ||
        personal.lesson_stable_id !== base.lesson_stable_id ||
        upgradeActivityContract(personal) !== upgradeActivityContract(base);
      if (!personalChanged) continue;
      const conflictId = `adaptation-${personal.stable_id}`;
      const preservePersonal =
        !conflictIds.has(conflictId) ||
        resolutions.get(conflictId) === "keep-personal";
      if (!incoming) {
        const targetLessonId = targetLessonIds.get(personal.lesson_stable_id);
        if (!targetLessonId || !preservePersonal) continue;
        const targetActivityId = scopedId(
          "activity",
          personalRevisionId,
          personal.stable_id,
        );
        const nextOrder = this.#connection.sqlite
          .prepare(
            `SELECT COALESCE(MAX(order_index), -1) + 1 AS order_index
             FROM course_activities
             WHERE course_id = ? AND revision_id = ? AND lesson_id = ?`,
          )
          .get(courseId, personalRevisionId, targetLessonId) as {
          order_index: number;
        };
        this.#connection.sqlite
          .prepare(
            `INSERT INTO course_activities
             (id, course_id, revision_id, lesson_id, stable_id, activity_type,
              order_index, title, description, estimated_minutes, required,
              objectives_json, checklist_json, sources_json, questions_json,
              misconceptions_json, capability_ids_json, completion_criteria_json,
              payload_json, protected_material_json, depth_level, created_at,
              updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                     ?, ?, ?, ?)`,
          )
          .run(
            targetActivityId,
            courseId,
            personalRevisionId,
            targetLessonId,
            personal.stable_id,
            personal.activity_type,
            nextOrder.order_index,
            personal.title,
            personal.description,
            personal.estimated_minutes,
            personal.required,
            personal.objectives_json,
            personal.checklist_json,
            personal.sources_json,
            personal.questions_json,
            personal.misconceptions_json,
            personal.capability_ids_json,
            personal.completion_criteria_json,
            personal.payload_json,
            personal.protected_material_json,
            personal.depth_level,
            input.now,
            input.now,
          );
        continue;
      }
      const incomingChanged =
        base === undefined ||
        incoming.lessonStableId !== base.lesson_stable_id ||
        upgradeActivityContract(base) !==
          upgradePackActivityContract(incoming.activity);
      if (
        incomingChanged &&
        conflictIds.has(conflictId) &&
        resolutions.get(conflictId) === "use-upstream"
      ) {
        continue;
      }
      const targetLessonId = targetLessonIds.get(incoming.lessonStableId);
      if (!targetLessonId) continue;
      this.#connection.sqlite
        .prepare(
          `UPDATE course_activities
           SET activity_type = ?, order_index = ?, title = ?, description = ?,
               estimated_minutes = ?, required = ?, objectives_json = ?,
               checklist_json = ?, sources_json = ?, questions_json = ?,
               misconceptions_json = ?, capability_ids_json = ?,
               completion_criteria_json = ?, payload_json = ?,
               protected_material_json = ?, depth_level = ?, updated_at = ?
           WHERE course_id = ? AND revision_id = ? AND lesson_id = ?
             AND stable_id = ?`,
        )
        .run(
          personal.activity_type,
          personal.order_index,
          personal.title,
          personal.description,
          personal.estimated_minutes,
          personal.required,
          personal.objectives_json,
          personal.checklist_json,
          personal.sources_json,
          personal.questions_json,
          personal.misconceptions_json,
          personal.capability_ids_json,
          personal.completion_criteria_json,
          personal.payload_json,
          personal.protected_material_json,
          personal.depth_level,
          input.now,
          courseId,
          personalRevisionId,
          targetLessonId,
          personal.stable_id,
        );
    }
    const materializedRows = this.#connection.sqlite
      .prepare(
        `SELECT lesson.stable_id AS lesson_stable_id,
                activity.stable_id, activity.activity_type, activity.order_index,
                activity.title, activity.description, activity.estimated_minutes,
                activity.required, activity.objectives_json, activity.checklist_json,
                activity.sources_json, activity.questions_json,
                activity.misconceptions_json, activity.capability_ids_json,
                activity.completion_criteria_json, activity.payload_json,
                activity.protected_material_json, activity.depth_level
         FROM course_activities activity
         JOIN course_lessons lesson
           ON lesson.course_id = activity.course_id
          AND lesson.revision_id = activity.revision_id
          AND lesson.id = activity.lesson_id
         WHERE activity.course_id = ? AND activity.revision_id = ?
         ORDER BY lesson.stable_id, activity.stable_id`,
      )
      .all(courseId, personalRevisionId);
    const materializedContentHash = `sha256:${createHash("sha256")
      .update(canonicalJson(materializedRows), "utf8")
      .digest("hex")}`;
    const archived = this.#connection.sqlite
      .prepare(
        `UPDATE curriculum_versions
         SET status = 'archived', content_hash = ?, published_at = ?,
             archived_at = ?, updated_at = ?
         WHERE id = ? AND status = 'draft'`,
      )
      .run(
        materializedContentHash,
        input.now,
        input.now,
        input.now,
        personalRevisionId,
      );
    if (archived.changes !== 1) {
      throw new ClientError(
        400,
        "Rebased personal Course revision could not be retained",
      );
    }
    const branched = this.#connection.sqlite
      .prepare(
        `UPDATE adaptation_branches
         SET head_revision_id = ?, updated_at = ?
         WHERE course_id = ? AND id = ? AND status = 'archived'
           AND head_revision_id IS NULL`,
      )
      .run(personalRevisionId, input.now, courseId, branchId);
    if (branched.changes !== 1) {
      throw new CoursePackRepositoryError(
        "conflict",
        "Rebased personal adaptation branch could not be retained",
      );
    }
    return personalPack;
  }

  #upgradeSideBySide(input: {
    operationId: string;
    validationId: string;
    pack: CoursePackV1;
    sideBySideSuffix?: string | undefined;
    payloadHash: string;
    sourceBytesHash: string;
  }): CoursePackUpgradeResult {
    const suffix =
      input.sideBySideSuffix ?? `r${input.pack.revision.revisionNumber}`;
    if (!/^[a-z0-9][a-z0-9._-]{0,59}$/u.test(suffix)) {
      throw new ClientError(400, "Side-by-side key suffix is malformed");
    }
    const courseKey = `${input.pack.course.courseKey}-${suffix}`.slice(0, 200);
    const revisionKey = `${courseKey}/v1`.slice(0, 200);
    const collision = this.#connection.sqlite
      .prepare(
        `SELECT id FROM courses WHERE id = ?
         UNION ALL SELECT id FROM course_revisions WHERE id = ?`,
      )
      .get(courseKey, revisionKey);
    if (collision) {
      throw new CoursePackRepositoryError(
        "conflict",
        "Side-by-side Course identity is already occupied",
      );
    }
    const rebased = finalizeCoursePack(
      CoursePackV1Schema.parse({
        ...input.pack,
        course: { ...input.pack.course, courseKey },
        revision: {
          revisionKey,
          revisionNumber: 1,
          parentRevisionKey: null,
          branchKind: "upstream",
          basedOnContentHash: null,
          contentHash: `sha256:${"0".repeat(64)}`,
        },
      }),
    );
    const canonical = canonicalJson(rebased);
    const revalidation = validateCoursePackBytes(
      UTF8_ENCODER.encode(canonical),
    );
    if (!revalidation.valid) {
      throw new ClientError(
        400,
        "Side-by-side Course Pack did not pass validation",
      );
    }
    const installed = this.install({
      operationId: `${input.operationId}:side-by-side`,
      validationId: input.validationId,
      action: "install",
      sourceBytesHash: coursePackSourceBytesHash(
        UTF8_ENCODER.encode(revalidation.canonicalJson),
      ),
      pack: revalidation.pack,
      canonicalJson: revalidation.canonicalJson,
      report: revalidation.report,
    });
    const result: CoursePackUpgradeResult = {
      courseId: installed.courseId,
      revisionId: installed.revisionId,
      contentHash: installed.contentHash,
      mode: "side-by-side",
      installed: installed.installed,
      idempotent: false,
      replayedFactCount: 0,
      supersededEvidenceCount: 0,
      carriedCount: 0,
      revalidationCount: 0,
      sideBySideCourseKey: courseKey,
    };
    this.#insertUpgradeLifecycleEvent({
      operationId: input.operationId,
      validationId: input.validationId,
      manifestRevisionId: installed.revisionId,
      result,
      sourceBytesHash: input.sourceBytesHash,
      payloadHash: input.payloadHash,
      occurredAt: this.#now(),
    });
    return result;
  }

  #insertUpgradedRevision(
    pack: CoursePackV1,
    canonicalJsonText: string,
    report: CoursePackValidationReport,
    sourceBytesHash: string,
    now: number,
  ): void {
    this.#insertCompatibilityGraph(pack, now);
    this.#applyPackTargetMetadata(pack);
    this.#insertKnowledge(pack, now);
    this.#connection.sqlite
      .prepare(
        `INSERT INTO course_pack_manifests
         (revision_id, format_version, canonical_json, content_hash,
          source_bytes_hash, validation_report_json, validator_version,
          imported_at)
         VALUES (?, 1, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        pack.revision.revisionKey,
        canonicalJsonText,
        pack.revision.contentHash,
        sourceBytesHash,
        boundedReportJson(report),
        report.validatorVersion,
        now,
      );
    this.#insertPackMetadata(pack);
    if (pack.revision.branchKind === "personal") {
      this.#prepareInstalledPersonalBranch(pack, now);
    }
    this.#assertCompatibilityProjection(pack, pack.revision.revisionKey);
    this.#publishManifestRevision(pack, now);
    this.#activateInstalledRevisionBranch(pack, now);
    this.#connection.sqlite
      .prepare(
        `UPDATE courses SET active_revision_id = ?, title = ?,
               description = ?, primary_locale = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        pack.revision.revisionKey,
        pack.course.title,
        pack.course.description,
        pack.course.primaryLocale,
        now,
        pack.course.courseKey,
      );
    this.#connection.sqlite
      .prepare(
        `UPDATE curricula SET active_version_id = ?, title = ?,
               description = ?, updated_at = ? WHERE id = ?`,
      )
      .run(
        pack.revision.revisionKey,
        pack.course.title,
        pack.course.description,
        now,
        pack.course.courseKey,
      );
  }

  #insertUpgradeLifecycleEvent(input: {
    operationId: string;
    validationId: string;
    manifestRevisionId: string;
    result: CoursePackUpgradeResult;
    sourceBytesHash: string;
    payloadHash: string;
    occurredAt: number;
  }): void {
    this.#connection.sqlite
      .prepare(
        `INSERT INTO course_pack_lifecycle_events
         (id, revision_id, operation_id, action, occurred_at, details_json)
         VALUES (?, ?, ?, 'install', ?, ?)`,
      )
      .run(
        this.#id(),
        input.manifestRevisionId,
        input.operationId,
        input.occurredAt,
        canonicalJson({
          kind: "upgrade",
          mode: input.result.mode,
          validationId: input.validationId,
          contentHash: input.result.contentHash,
          manifestRevisionId: input.manifestRevisionId,
          resultRevisionId: input.result.revisionId,
          courseId: input.result.courseId,
          sourceBytesHash: input.sourceBytesHash,
          payloadHash: input.payloadHash,
          replayedFactCount: input.result.replayedFactCount,
          supersededEvidenceCount: input.result.supersededEvidenceCount,
          sideBySideCourseKey: input.result.sideBySideCourseKey,
        }),
      );
  }

  #reconcileUpgradeOperation(
    operation: {
      revision_id: string;
      action: CoursePackLifecycleAction;
      details_json: string;
    },
    input: {
      operationId: string;
      validationId: string;
      mode: CoursePackUpgradeMode;
      expectedContentHash: string;
      payloadHash: string;
    },
  ): CoursePackUpgradeResult {
    const details = upgradeLifecycleDetails(operation.details_json);
    if (
      operation.action !== "install" ||
      details === null ||
      details.mode !== input.mode ||
      details.validationId !== input.validationId ||
      details.contentHash !== input.expectedContentHash ||
      details.payloadHash !== input.payloadHash ||
      details.manifestRevisionId !== operation.revision_id
    ) {
      throw new CoursePackRepositoryError(
        "conflict",
        "Course Pack operation ID is already bound to a different validation, action, or payload",
      );
    }
    return {
      courseId: details.courseId,
      revisionId: details.resultRevisionId,
      contentHash: details.contentHash,
      mode: details.mode,
      installed: false,
      idempotent: true,
      replayedFactCount: details.replayedFactCount,
      supersededEvidenceCount: details.supersededEvidenceCount,
      carriedCount: details.replayedFactCount,
      revalidationCount: 0,
      sideBySideCourseKey: details.sideBySideCourseKey,
    };
  }

  /**
   * Replays kernel facts for surviving activity IDs into deterministic
   * per-lesson upgrade sessions (completed, never active) on the new
   * revision. Old facts are never mutated: removed/changed completion
   * evidence stays read-only and is counted as superseded. Mastery is
   * deterministically recomputed per scope to prove the replay is sound;
   * projections themselves rebuild on read.
   */
  #replayUpgradeFacts(
    operationId: string,
    courseId: string,
    previousRevisionId: string | null,
    pack: CoursePackV1,
    now: number,
  ): { replayed: number; superseded: number; revalidation: number } {
    if (previousRevisionId === null) {
      return { replayed: 0, superseded: 0, revalidation: 0 };
    }
    const nextRevisionId = pack.revision.revisionKey;
    const nextBranchId = adaptationBranchIdForRevision(
      courseId,
      nextRevisionId,
    );
    const previousLessons = new Map(
      (
        this.#connection.sqlite
          .prepare(
            `SELECT id, stable_id FROM course_lessons
             WHERE course_id = ? AND revision_id = ?`,
          )
          .all(courseId, previousRevisionId) as Array<{
          id: string;
          stable_id: string;
        }>
      ).map((row) => [row.id, row.stable_id] as const),
    );
    const nextLessons = new Map(
      (
        this.#connection.sqlite
          .prepare(
            `SELECT id, stable_id FROM course_lessons
             WHERE course_id = ? AND revision_id = ?`,
          )
          .all(courseId, nextRevisionId) as Array<{
          id: string;
          stable_id: string;
        }>
      ).map((row) => [row.stable_id, row.id] as const),
    );
    const previousActivities = new Map(
      (
        this.#connection.sqlite
          .prepare(
            `SELECT id, lesson_id, stable_id, activity_type, order_index,
                    required, capability_ids_json, knowledge_node_ids_json,
                    completion_criteria_json, payload_json, protected_material_json
             FROM course_activities
             WHERE course_id = ? AND revision_id = ?`,
          )
          .all(courseId, previousRevisionId) as unknown as UpgradeActivityRow[]
      ).map((row) => [row.id, row] as const),
    );
    const nextActivities = new Map(
      (
        this.#connection.sqlite
          .prepare(
            `SELECT id, lesson_id, stable_id, activity_type, order_index,
                    required, capability_ids_json, knowledge_node_ids_json,
                    completion_criteria_json, payload_json, protected_material_json
             FROM course_activities
             WHERE course_id = ? AND revision_id = ?`,
          )
          .all(courseId, nextRevisionId) as unknown as UpgradeActivityRow[]
      ).map((row) => [row.stable_id, row] as const),
    );
    const previousDependencies = this.#readActivityDependencies(
      courseId,
      previousRevisionId,
    );
    const nextDependencies = this.#readActivityDependencies(
      courseId,
      nextRevisionId,
    );
    const previousFacts = this.#connection.sqlite
      .prepare(
        `SELECT id, operation_id, lesson_id, activity_id, canonical_json,
                fact_hash, occurred_at
         FROM learning_kernel_facts
         WHERE course_id = ? AND revision_id = ?
         ORDER BY occurred_at, id
         LIMIT ?`,
      )
      .all(
        courseId,
        previousRevisionId,
        COURSE_TRANSFER_JSON_LIMITS_V1.maxFacts + 1,
      ) as Array<{
      id: string;
      operation_id: string;
      lesson_id: string;
      activity_id: string;
      canonical_json: string;
      fact_hash: string;
      occurred_at: number;
    }>;
    if (previousFacts.length > COURSE_TRANSFER_JSON_LIMITS_V1.maxFacts) {
      throw new ClientError(400, "Course upgrade history exceeds replay limit");
    }
    let superseded = 0;
    let revalidation = 0;
    const survivors: Array<{
      previousId: string;
      nextId: string;
      nextOperationId: string;
      lessonStable: string;
      nextLessonId: string;
      nextActivityId: string;
      sourceFactHash: string;
      sourceContractHash: string;
      fact: LearningKernelFact;
      occurredAt: number;
    }> = [];
    const deferredCorrections: Array<{
      row: (typeof previousFacts)[number];
      fact: LearningKernelFact;
    }> = [];
    const compatibleActivities = new Map<string, boolean>();
    const checkingActivities = new Set<string>();
    const isCompatibleActivity = (previousActivityId: string): boolean => {
      const cached = compatibleActivities.get(previousActivityId);
      if (cached !== undefined) return cached;
      if (checkingActivities.has(previousActivityId)) return false;
      checkingActivities.add(previousActivityId);
      const previousActivity = previousActivities.get(previousActivityId);
      const nextActivity =
        previousActivity === undefined
          ? undefined
          : nextActivities.get(previousActivity.stable_id);
      const previousLessonStable =
        previousActivity === undefined
          ? undefined
          : previousLessons.get(previousActivity.lesson_id);
      const nextLessonStable =
        nextActivity === undefined
          ? undefined
          : [...nextLessons.entries()].find(
              ([, lessonId]) => lessonId === nextActivity.lesson_id,
            )?.[0];
      const previousPrerequisites =
        previousDependencies.get(previousActivityId) ?? new Set<string>();
      const nextPrerequisites =
        nextActivity === undefined
          ? new Set<string>()
          : (nextDependencies.get(nextActivity.id) ?? new Set<string>());
      const previousPrerequisiteStableIds = [...previousPrerequisites].flatMap(
        (id) => {
          const prerequisite = previousActivities.get(id);
          return prerequisite === undefined ? [] : [prerequisite.stable_id];
        },
      );
      const nextPrerequisiteStableIds = [...nextPrerequisites].flatMap((id) => {
        const prerequisite = [...nextActivities.values()].find(
          (candidate) => candidate.id === id,
        );
        return prerequisite === undefined ? [] : [prerequisite.stable_id];
      });
      const compatible =
        previousActivity !== undefined &&
        nextActivity !== undefined &&
        previousLessonStable !== undefined &&
        previousLessonStable === nextLessonStable &&
        upgradeActivityContract(previousActivity) ===
          upgradeActivityContract(nextActivity) &&
        equalStringSets(
          previousPrerequisiteStableIds,
          nextPrerequisiteStableIds,
        ) &&
        [...previousPrerequisites].every((id) => isCompatibleActivity(id));
      checkingActivities.delete(previousActivityId);
      compatibleActivities.set(previousActivityId, compatible);
      return compatible;
    };
    const mapSurvivor = (row: (typeof previousFacts)[number]): void => {
      let fact: LearningKernelFact;
      try {
        fact = JSON.parse(row.canonical_json) as LearningKernelFact;
      } catch {
        superseded += 1;
        revalidation += 1;
        return;
      }
      if (
        learningKernelSha256(fact) !== row.fact_hash ||
        fact.provenance.kind === "migration" ||
        isMigrationProvenance(fact.provenance)
      ) {
        superseded += 1;
        revalidation += 1;
        return;
      }
      const previousActivity = previousActivities.get(row.activity_id);
      const lessonStable = previousLessons.get(row.lesson_id);
      const nextLessonId =
        lessonStable === undefined ? undefined : nextLessons.get(lessonStable);
      const nextActivity =
        previousActivity === undefined
          ? undefined
          : nextActivities.get(previousActivity.stable_id);
      if (
        previousActivity === undefined ||
        lessonStable === undefined ||
        nextLessonId === undefined ||
        nextActivity === undefined ||
        nextActivity.lesson_id !== nextLessonId ||
        !isCompatibleActivity(row.activity_id)
      ) {
        superseded += 1;
        revalidation += 1;
        return;
      }
      if (fact.body.type === "correction") {
        deferredCorrections.push({ row, fact });
        return;
      }
      survivors.push({
        previousId: row.id,
        nextId: upgradeReplayId(operationId, row.id),
        nextOperationId: upgradeReplayId(operationId, row.operation_id),
        lessonStable,
        nextLessonId,
        nextActivityId: nextActivity.id,
        sourceFactHash: row.fact_hash,
        sourceContractHash: upgradeActivityContract(previousActivity),
        fact,
        occurredAt: row.occurred_at,
      });
    };
    for (const row of previousFacts) mapSurvivor(row);
    const survivorIds = new Map(
      survivors.map((entry) => [entry.previousId, entry.nextId] as const),
    );
    for (const { row, fact } of deferredCorrections) {
      const correction = fact.body.type === "correction" ? fact.body : null;
      const mappedSupersedes =
        correction === null
          ? undefined
          : survivorIds.get(correction.supersedesFactId);
      if (
        correction === null ||
        mappedSupersedes === undefined ||
        learningKernelSha256(fact) !== row.fact_hash ||
        fact.provenance.kind === "migration" ||
        isMigrationProvenance(fact.provenance)
      ) {
        superseded += 1;
        revalidation += 1;
        continue;
      }
      const previousActivity = previousActivities.get(row.activity_id);
      const lessonStable = previousLessons.get(row.lesson_id);
      const nextLessonId =
        lessonStable === undefined ? undefined : nextLessons.get(lessonStable);
      const nextActivity =
        previousActivity === undefined
          ? undefined
          : nextActivities.get(previousActivity.stable_id);
      if (
        previousActivity === undefined ||
        lessonStable === undefined ||
        nextLessonId === undefined ||
        nextActivity === undefined ||
        nextActivity.lesson_id !== nextLessonId ||
        !isCompatibleActivity(row.activity_id)
      ) {
        superseded += 1;
        revalidation += 1;
        continue;
      }
      survivors.push({
        previousId: row.id,
        nextId: upgradeReplayId(operationId, row.id),
        nextOperationId: upgradeReplayId(operationId, row.operation_id),
        lessonStable,
        nextLessonId,
        nextActivityId: nextActivity.id,
        sourceFactHash: row.fact_hash,
        sourceContractHash: upgradeActivityContract(previousActivity),
        fact: {
          ...fact,
          body: {
            ...correction,
            replacement: {
              ...correction.replacement,
              activityId: nextActivity.id,
            },
            supersedesFactId: mappedSupersedes,
          },
        },
        occurredAt: row.occurred_at,
      });
      survivorIds.set(row.id, upgradeReplayId(operationId, row.id));
    }
    if (survivors.length === 0) {
      return { replayed: 0, superseded, revalidation };
    }
    ensureKernelSessionStubDay(this.#connection.sqlite, now);
    const byLesson = new Map<string, typeof survivors>();
    for (const entry of survivors) {
      const group = byLesson.get(entry.nextLessonId) ?? [];
      group.push(entry);
      byLesson.set(entry.nextLessonId, group);
    }
    let replayed = 0;
    for (const [nextLessonId, group] of byLesson) {
      const lessonStable = group[0]!.lessonStable;
      const sessionSeed = `${courseId} ${nextRevisionId} ${lessonStable} ${operationId}`;
      const sessionId = `upgrade-${createHash("sha256").update(sessionSeed, "utf8").digest("hex").slice(0, 32)}`;
      const day = this.#connection.sqlite
        .prepare(
          `SELECT id FROM curriculum_days_v2
           WHERE version_id = ? AND stable_id = ?`,
        )
        .get(nextRevisionId, lessonStable) as { id: string } | undefined;
      if (!day) {
        throw new ClientError(400, "Upgraded lesson projection is incomplete");
      }
      this.#connection.sqlite
        .prepare(
          `INSERT OR IGNORE INTO learning_sessions
           (id, day_id, status, current_step, idempotency_key, started_at,
            completed_at, updated_at, curriculum_day_v2_id)
           VALUES (?, ?, 'completed', 'upgrade-replay', ?, ?, ?, ?, ?)`,
        )
        .run(
          sessionId,
          "transfer-session-day",
          `upgrade:${operationId}:${lessonStable}`.slice(0, 500),
          now,
          now,
          now,
          day.id,
        );
      const snapshotJson = canonicalJson({
        kind: "course-upgrade-replay",
        courseId,
        fromRevisionId: previousRevisionId,
        toRevisionId: nextRevisionId,
        lessonStable,
        operationId,
      });
      const snapshotId = `upgrade-snapshot-${createHash("sha256").update(`snapshot ${sessionSeed}`, "utf8").digest("hex").slice(0, 24)}`;
      const contentHash = `sha256:${createHash("sha256").update(snapshotJson, "utf8").digest("hex")}`;
      this.#connection.sqlite
        .prepare(
          `INSERT OR IGNORE INTO session_snapshots
           (id, session_id, schema_version, curriculum_id,
            curriculum_version_id, curriculum_day_id, content_hash,
            snapshot_json, created_at)
           VALUES (?, ?, 2, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          snapshotId,
          sessionId,
          courseId,
          nextRevisionId,
          day.id,
          contentHash,
          snapshotJson,
          now,
        );
      this.#connection.sqlite
        .prepare(
          `INSERT OR IGNORE INTO session_course_contexts
           (session_id, course_id, revision_id, lesson_id, session_snapshot_id,
            snapshot_hash, created_at, adaptation_branch_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          sessionId,
          courseId,
          nextRevisionId,
          nextLessonId,
          snapshotId,
          contentHash,
          now,
          nextBranchId,
        );
      const scope = {
        courseId,
        revisionId: nextRevisionId,
        branchId: nextBranchId,
        sessionId,
      };
      const facts: LearningKernelFact[] = [];
      for (const entry of group) {
        const nextFact: LearningKernelFact = {
          ...entry.fact,
          schemaVersion: 2,
          id: entry.nextId,
          operationId: entry.nextOperationId,
          courseId,
          revisionId: nextRevisionId,
          branchId: nextBranchId,
          sessionId,
          provenance: {
            kind: "migration",
            sourceId: entry.previousId,
            sourceHash: entry.sourceFactHash,
            sourceRevisionId: previousRevisionId,
            sourceFactId: entry.previousId,
            sourceFactHash: entry.sourceFactHash,
            sourceContractHash: entry.sourceContractHash,
            targetContractHash: entry.sourceContractHash,
            migratorVersion: "upgrade-migrator-1",
            originalProvenance: entry.fact
              .provenance as LearningKernelNonMigrationProvenance,
          },
          body: rewriteUpgradeFactBody(entry.fact.body, entry.nextActivityId),
        };
        const canonical = canonicalLearningKernelJson(nextFact);
        facts.push(nextFact);
        replayed += insertRestoredKernelFact(
          this.#connection.sqlite,
          {
            id: nextFact.id,
            schemaVersion: nextFact.schemaVersion,
            operationId: nextFact.operationId,
            courseId,
            revisionId: nextRevisionId,
            branchId: nextBranchId,
            sessionId,
            lessonId: nextLessonId,
            activityId: entry.nextActivityId,
            bodyType: nextFact.body.type,
            provenanceKind: nextFact.provenance.kind,
            supersedesFactId:
              nextFact.body.type === "correction"
                ? nextFact.body.supersedesFactId
                : null,
            occurredAt: entry.occurredAt,
            acceptedAt: Math.max(now, entry.occurredAt),
            canonicalJson: canonical,
            factHash: learningKernelSha256(nextFact),
          },
          false,
        );
      }
      projectLearningKernel({
        scope,
        activities: readRevisionActivities(
          this.#connection.sqlite,
          courseId,
          nextRevisionId,
          nextLessonId,
        ),
        facts: [...facts].sort((left, right) =>
          left.occurredAt < right.occurredAt ? -1 : 1,
        ),
        observedAt: new Date(now).toISOString(),
      });
    }
    return { replayed, superseded, revalidation };
  }

  #readActivityDependencies(
    courseId: string,
    revisionId: string,
  ): Map<string, Set<string>> {
    const dependencies = new Map<string, Set<string>>();
    const rows = this.#connection.sqlite
      .prepare(
        `SELECT activity_id, prerequisite_activity_id
         FROM course_activity_prerequisites
         WHERE course_id = ? AND revision_id = ?`,
      )
      .all(courseId, revisionId) as Array<{
      activity_id: string;
      prerequisite_activity_id: string;
    }>;
    for (const row of rows) {
      const set = dependencies.get(row.activity_id) ?? new Set<string>();
      set.add(row.prerequisite_activity_id);
      dependencies.set(row.activity_id, set);
    }
    return dependencies;
  }

  #assertInstallIdentity(pack: CoursePackV1): void {
    const courses = this.#connection.sqlite
      .prepare(
        `SELECT id, stable_id, primary_locale
         FROM courses WHERE id = ? OR stable_id = ?`,
      )
      .all(pack.course.courseKey, pack.course.courseKey) as Array<{
      id: string;
      stable_id: string;
      primary_locale: string;
    }>;
    const compatibilityCourse = this.#connection.sqlite
      .prepare(`SELECT id, slug FROM curricula WHERE id = ? OR slug = ?`)
      .all(pack.course.courseKey, pack.course.courseKey) as Array<{
      id: string;
      slug: string;
    }>;
    if (
      courses.length !== compatibilityCourse.length ||
      courses.some(
        (course) =>
          course.id !== pack.course.courseKey ||
          course.stable_id !== pack.course.courseKey,
      ) ||
      compatibilityCourse.some(
        (course) =>
          course.id !== pack.course.courseKey ||
          course.slug !== pack.course.courseKey,
      )
    ) {
      throw new CoursePackRepositoryError(
        "conflict",
        "Course Pack Course identity collides with local data",
      );
    }
    if (
      courses.some(
        (course) => course.primary_locale !== pack.course.primaryLocale,
      )
    ) {
      throw new CoursePackRepositoryError(
        "conflict",
        "Course Pack primary locale conflicts with the existing Course",
      );
    }

    const revisionCollision = this.#connection.sqlite
      .prepare(`SELECT id FROM course_revisions WHERE id = ?`)
      .all(pack.revision.revisionKey) as Array<{ id: string }>;
    if (revisionCollision.length > 0) {
      throw new CoursePackRepositoryError(
        "conflict",
        "Course Pack revision identity already exists",
      );
    }
    if (pack.revision.parentRevisionKey === null) return;

    const parent = this.#connection.sqlite
      .prepare(
        `SELECT course_id, content_hash FROM course_revisions WHERE id = ?`,
      )
      .get(pack.revision.parentRevisionKey) as
      { course_id: string; content_hash: string | null } | undefined;
    if (!parent || parent.course_id !== pack.course.courseKey) {
      throw new CoursePackRepositoryError(
        "conflict",
        "Course Pack parent revision is unavailable",
      );
    }
    if (
      pack.revision.branchKind === "personal" &&
      parent.content_hash !== pack.revision.basedOnContentHash
    ) {
      throw new CoursePackRepositoryError(
        "conflict",
        "Personal Course Pack base hash does not match its parent",
      );
    }
  }

  #applyPackTargetMetadata(pack: CoursePackV1): void {
    this.#connection.sqlite
      .prepare(
        `UPDATE curriculum_versions
         SET branch_kind = ?, based_on_content_hash = ? WHERE id = ?`,
      )
      .run(
        pack.revision.branchKind,
        pack.revision.basedOnContentHash,
        pack.revision.revisionKey,
      );
    this.#connection.sqlite
      .prepare(`UPDATE courses SET primary_locale = ? WHERE id = ?`)
      .run(pack.course.primaryLocale, pack.course.courseKey);
    this.#applyPackActivityMetadata(pack, pack.revision.revisionKey);
  }

  #applyPackActivityMetadata(
    pack: CoursePackV1,
    targetRevisionId: string,
  ): void {
    for (const lesson of pack.lessons) {
      for (const activity of lesson.activities) {
        const privateQuestions = projectedPrivateQuestions(activity);
        const result = this.#connection.sqlite
          .prepare(
            `UPDATE course_activities
             SET sources_json = ?, questions_json = ?, capability_ids_json = ?,
                 knowledge_node_ids_json = ?, protected_material_json = ?
             WHERE course_id = ? AND revision_id = ? AND id = ?`,
          )
          .run(
            canonicalJson(
              activity.sourceSnapshotIds.map((id) =>
                scopedId("source", pack.revision.revisionKey, id),
              ),
            ),
            canonicalJson(
              privateQuestions.map((question) => ({
                id: question.id,
                kind: question.kind,
                prompt: question.prompt,
                options: question.options,
              })),
            ),
            canonicalJson(activity.capabilityIds),
            canonicalJson(activity.knowledgeNodeIds),
            canonicalJson({
              ...activity.protectedMaterial,
              questions: privateQuestions,
            }),
            pack.course.courseKey,
            targetRevisionId,
            scopedId("activity", targetRevisionId, activity.activityId),
          );
        if (result.changes !== 1) {
          throw new ClientError(
            400,
            "Course Pack activity projection is incomplete",
          );
        }
      }
    }
  }

  #insertCompatibilityGraph(
    pack: CoursePackV1,
    now: number,
    revision: {
      readonly id: string;
      readonly revisionNumber: number;
      readonly parentRevisionId: string | null;
      readonly branchKind: "upstream" | "personal";
      readonly basedOnContentHash: string | null;
      readonly adaptationBranchId: string | null;
    } = {
      id: pack.revision.revisionKey,
      revisionNumber: pack.revision.revisionNumber,
      parentRevisionId: pack.revision.parentRevisionKey,
      branchKind: pack.revision.branchKind,
      basedOnContentHash: pack.revision.basedOnContentHash,
      adaptationBranchId: null,
    },
  ): void {
    this.#connection.sqlite
      .prepare(
        `INSERT INTO curricula
         (id, slug, title, description, active_version_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, NULL, ?, ?)
         ON CONFLICT(id) DO NOTHING`,
      )
      .run(
        pack.course.courseKey,
        pack.course.courseKey,
        pack.course.title,
        pack.course.description,
        now,
        now,
      );
    const compatibilityCourse = this.#connection.sqlite
      .prepare(`SELECT id, slug FROM curricula WHERE id = ?`)
      .get(pack.course.courseKey) as { id: string; slug: string } | undefined;
    if (
      compatibilityCourse?.id !== pack.course.courseKey ||
      compatibilityCourse.slug !== pack.course.courseKey
    ) {
      throw new CoursePackRepositoryError(
        "conflict",
        "Course Pack compatibility Course identity collides with local data",
      );
    }

    this.#connection.sqlite
      .prepare(
        `INSERT INTO curriculum_versions
         (id, curriculum_id, revision, parent_version_id, branch_kind, status,
          title, description, content_hash, based_on_content_hash,
          adaptation_branch_id, created_at, published_at, archived_at,
          updated_at)
         VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, NULL, ?, ?, ?, NULL, NULL, ?)`,
      )
      .run(
        revision.id,
        pack.course.courseKey,
        this.#availableRevisionNumber(
          pack.course.courseKey,
          revision.revisionNumber,
        ),
        revision.parentRevisionId,
        revision.branchKind,
        pack.course.title,
        pack.course.description,
        revision.basedOnContentHash,
        revision.adaptationBranchId,
        now,
        now,
      );
    const weekId = scopedId("week", revision.id, "main");
    const sourceSnapshots = new Map(
      pack.knowledge.sourceSnapshots.map((snapshot) => [
        snapshot.snapshotId,
        snapshot,
      ]),
    );
    this.#connection.sqlite
      .prepare(
        `INSERT INTO curriculum_weeks
         (id, version_id, stable_id, order_index, title, description,
          created_at, updated_at)
         VALUES (?, ?, 'main', 0, ?, ?, ?, ?)`,
      )
      .run(
        weekId,
        revision.id,
        pack.course.title,
        pack.course.description,
        now,
        now,
      );

    for (const lesson of prerequisiteInsertionOrder(
      pack.lessons,
      (candidate) => candidate.lessonId,
      (candidate) => candidate.prerequisiteLessonIds ?? [],
    )) {
      const lessonId = scopedId("lesson", revision.id, lesson.lessonId);
      this.#connection.sqlite
        .prepare(
          `INSERT INTO curriculum_days_v2
           (id, version_id, week_id, stable_id, order_index, title,
            description, goal, estimated_minutes, prerequisites_json,
            expected_outcomes_json, depth_level, out_of_scope_json,
            topics_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', 'foundation', '[]',
                   ?, ?, ?)`,
        )
        .run(
          lessonId,
          revision.id,
          weekId,
          lesson.lessonId,
          lesson.order,
          lesson.title,
          lesson.description,
          lesson.goal,
          lesson.estimatedMinutes,
          canonicalJson(lesson.prerequisiteLessonIds ?? []),
          canonicalJson(lesson.knowledgeNodeIds),
          now,
          now,
        );
      for (const activity of prerequisiteInsertionOrder(
        lesson.activities,
        (candidate) => candidate.activityId,
        (candidate) => candidate.prerequisiteActivityIds,
      )) {
        const activityId = scopedId(
          "activity",
          revision.id,
          activity.activityId,
        );
        const privateQuestions = projectedPrivateQuestions(activity);
        const learnerSources = activity.sourceSnapshotIds.map((snapshotId) => {
          const snapshot = sourceSnapshots.get(snapshotId);
          if (!snapshot) {
            throw new ClientError(
              400,
              "Course Pack source projection is incomplete",
            );
          }
          return {
            id: scopedId("source", pack.revision.revisionKey, snapshotId),
            title: snapshot.title,
            url: snapshot.canonicalUrl,
            kind: "source-required" as const,
            ...(snapshot.authorPublisher
              ? { author: snapshot.authorPublisher }
              : {}),
            ...(snapshot.attribution
              ? { description: snapshot.attribution }
              : {}),
            required: true,
            estimatedMinutes: 0,
            examplesToRepeat: [],
          };
        });
        this.#connection.sqlite
          .prepare(
            `INSERT INTO curriculum_units
             (id, version_id, day_id, stable_id, type, order_index, title,
              description, estimated_minutes, objectives_json, checklist_json,
              sources_json, questions_json, misconceptions_json,
              reference_answer_json, completion_criteria_json,
              unlock_rules_json, optional, depth_level, payload_json,
              created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', '[]', ?, ?, '[]',
                     ?, ?, ?, ?, 'foundation', ?, ?, ?)`,
          )
          .run(
            activityId,
            revision.id,
            lessonId,
            activity.activityId,
            activity.type,
            activity.order,
            activity.title,
            activity.description,
            activity.estimatedMinutes,
            canonicalJson(learnerSources),
            canonicalJson(privateQuestions),
            activity.protectedMaterial.referenceAnswer === null
              ? null
              : canonicalJson(activity.protectedMaterial.referenceAnswer),
            canonicalJson(activity.completionCriteria),
            canonicalJson(
              activity.prerequisiteActivityIds.map((unitId) => ({
                type: "unit-completed",
                unitId,
              })),
            ),
            activity.required ? 0 : 1,
            canonicalJson(activity.payload),
            now,
            now,
          );
      }
    }
  }

  #assertCompatibilityProjection(pack: CoursePackV1, revisionId: string): void {
    const expected: CompatibilityProjection = {
      lessonIds: pack.lessons.map((lesson) => lesson.lessonId).sort(),
      lessonEdges: pack.lessons
        .flatMap((lesson) =>
          (lesson.prerequisiteLessonIds ?? []).map((prerequisiteId) =>
            projectionKey(lesson.lessonId, prerequisiteId),
          ),
        )
        .sort(),
      activityIds: pack.lessons
        .flatMap((lesson) =>
          lesson.activities.map((activity) =>
            projectionKey(lesson.lessonId, activity.activityId),
          ),
        )
        .sort(),
      activityEdges: pack.lessons
        .flatMap((lesson) =>
          lesson.activities.flatMap((activity) =>
            activity.prerequisiteActivityIds.map((prerequisiteId) =>
              projectionKey(
                lesson.lessonId,
                activity.activityId,
                prerequisiteId,
              ),
            ),
          ),
        )
        .sort(),
    };

    const sourceLessons = this.#connection.sqlite
      .prepare(
        `SELECT stable_id, prerequisites_json
         FROM curriculum_days_v2
         WHERE version_id = ? ORDER BY stable_id`,
      )
      .all(revisionId) as Array<{
      stable_id: string;
      prerequisites_json: string;
    }>;
    const sourceActivities = this.#connection.sqlite
      .prepare(
        `SELECT lesson.stable_id AS lesson_stable_id,
                activity.stable_id AS activity_stable_id,
                activity.unlock_rules_json
         FROM curriculum_units activity
         JOIN curriculum_days_v2 lesson
           ON lesson.version_id = activity.version_id
          AND lesson.id = activity.day_id
         WHERE activity.version_id = ?
         ORDER BY lesson.stable_id, activity.stable_id`,
      )
      .all(revisionId) as Array<{
      lesson_stable_id: string;
      activity_stable_id: string;
      unlock_rules_json: string;
    }>;
    const source: CompatibilityProjection = {
      lessonIds: sourceLessons.map((lesson) => lesson.stable_id).sort(),
      lessonEdges: sourceLessons
        .flatMap((lesson) =>
          jsonStringArray(
            lesson.prerequisites_json,
            "Course Pack lesson prerequisites",
          ).map((prerequisiteId) =>
            projectionKey(lesson.stable_id, prerequisiteId),
          ),
        )
        .sort(),
      activityIds: sourceActivities
        .map((activity) =>
          projectionKey(activity.lesson_stable_id, activity.activity_stable_id),
        )
        .sort(),
      activityEdges: sourceActivities
        .flatMap((activity) =>
          jsonUnitPrerequisiteIds(activity.unlock_rules_json).map(
            (prerequisiteId) =>
              projectionKey(
                activity.lesson_stable_id,
                activity.activity_stable_id,
                prerequisiteId,
              ),
          ),
        )
        .sort(),
    };
    assertCompatibilityProjection("curriculum source", expected, source);

    const foundationLessonIds = this.#connection.sqlite
      .prepare(
        `SELECT stable_id FROM course_lessons
         WHERE course_id = ? AND revision_id = ? ORDER BY stable_id`,
      )
      .all(pack.course.courseKey, revisionId) as Array<{ stable_id: string }>;
    const foundationLessonEdges = this.#connection.sqlite
      .prepare(
        `SELECT lesson.stable_id AS lesson_stable_id,
                prerequisite.stable_id AS prerequisite_stable_id
         FROM course_lesson_prerequisites edge
         JOIN course_lessons lesson
           ON lesson.course_id = edge.course_id
          AND lesson.revision_id = edge.revision_id
          AND lesson.id = edge.lesson_id
         JOIN course_lessons prerequisite
           ON prerequisite.course_id = edge.course_id
          AND prerequisite.revision_id = edge.revision_id
          AND prerequisite.id = edge.prerequisite_lesson_id
         WHERE edge.course_id = ? AND edge.revision_id = ?
         ORDER BY lesson.stable_id, prerequisite.stable_id`,
      )
      .all(pack.course.courseKey, revisionId) as Array<{
      lesson_stable_id: string;
      prerequisite_stable_id: string;
    }>;
    const foundationActivityIds = this.#connection.sqlite
      .prepare(
        `SELECT lesson.stable_id AS lesson_stable_id,
                activity.stable_id AS activity_stable_id
         FROM course_activities activity
         JOIN course_lessons lesson
           ON lesson.course_id = activity.course_id
          AND lesson.revision_id = activity.revision_id
          AND lesson.id = activity.lesson_id
         WHERE activity.course_id = ? AND activity.revision_id = ?
         ORDER BY lesson.stable_id, activity.stable_id`,
      )
      .all(pack.course.courseKey, revisionId) as Array<{
      lesson_stable_id: string;
      activity_stable_id: string;
    }>;
    const foundationActivityEdges = this.#connection.sqlite
      .prepare(
        `SELECT lesson.stable_id AS lesson_stable_id,
                activity.stable_id AS activity_stable_id,
                prerequisite.stable_id AS prerequisite_stable_id
         FROM course_activity_prerequisites edge
         JOIN course_lessons lesson
           ON lesson.course_id = edge.course_id
          AND lesson.revision_id = edge.revision_id
          AND lesson.id = edge.lesson_id
         JOIN course_activities activity
           ON activity.course_id = edge.course_id
          AND activity.revision_id = edge.revision_id
          AND activity.lesson_id = edge.lesson_id
          AND activity.id = edge.activity_id
         JOIN course_activities prerequisite
           ON prerequisite.course_id = edge.course_id
          AND prerequisite.revision_id = edge.revision_id
          AND prerequisite.lesson_id = edge.lesson_id
          AND prerequisite.id = edge.prerequisite_activity_id
         WHERE edge.course_id = ? AND edge.revision_id = ?
         ORDER BY lesson.stable_id, activity.stable_id,
                  prerequisite.stable_id`,
      )
      .all(pack.course.courseKey, revisionId) as Array<{
      lesson_stable_id: string;
      activity_stable_id: string;
      prerequisite_stable_id: string;
    }>;
    const foundation: CompatibilityProjection = {
      lessonIds: foundationLessonIds.map((lesson) => lesson.stable_id).sort(),
      lessonEdges: foundationLessonEdges
        .map((edge) =>
          projectionKey(edge.lesson_stable_id, edge.prerequisite_stable_id),
        )
        .sort(),
      activityIds: foundationActivityIds
        .map((activity) =>
          projectionKey(activity.lesson_stable_id, activity.activity_stable_id),
        )
        .sort(),
      activityEdges: foundationActivityEdges
        .map((edge) =>
          projectionKey(
            edge.lesson_stable_id,
            edge.activity_stable_id,
            edge.prerequisite_stable_id,
          ),
        )
        .sort(),
    };
    assertCompatibilityProjection("foundation", expected, foundation);
  }

  #insertKnowledge(pack: CoursePackV1, now: number): void {
    for (const snapshot of pack.knowledge.sourceSnapshots) {
      this.#connection.sqlite
        .prepare(
          `INSERT INTO source_snapshots
           (id, course_id, revision_id, source_authority_id, canonical_url,
            retrieved_at, retrieval_method, media_type, locale, content_hash,
            title, author_publisher, published_or_updated_at, attribution,
            license_spdx, terms_url, content, locator_map_json,
            retention_mode, supersedes_snapshot_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                   ?, ?)`,
        )
        .run(
          scopedId("source", pack.revision.revisionKey, snapshot.snapshotId),
          pack.course.courseKey,
          pack.revision.revisionKey,
          snapshot.sourceAuthorityId,
          snapshot.canonicalUrl,
          Date.parse(snapshot.retrievedAt),
          snapshot.retrievalMethod,
          snapshot.mediaType,
          snapshot.locale,
          snapshot.contentHash,
          snapshot.title,
          snapshot.authorPublisher,
          snapshot.publishedOrUpdatedAt,
          snapshot.attribution,
          snapshot.licenseSpdx,
          snapshot.termsUrl,
          snapshot.content === null
            ? null
            : typeof snapshot.content === "string"
              ? snapshot.content
              : canonicalJson(snapshot.content),
          canonicalJson(snapshot.locatorMap),
          snapshot.retentionMode,
          snapshot.supersedesSnapshotId === null
            ? null
            : scopedId(
                "source",
                pack.revision.revisionKey,
                snapshot.supersedesSnapshotId,
              ),
          now,
        );
    }
    for (const capsule of pack.knowledge.capsules) {
      const capsuleId = scopedId(
        "capsule",
        pack.revision.revisionKey,
        capsule.capsuleId,
      );
      this.#connection.sqlite
        .prepare(
          `INSERT INTO knowledge_capsules
           (id, schema_version, course_id, revision_id,
            knowledge_node_ids_json, primary_locale, claims_json,
            citations_json, conflicts_json, created_by, validation_hash,
            created_at)
           VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          capsuleId,
          pack.course.courseKey,
          pack.revision.revisionKey,
          canonicalJson(capsule.knowledgeNodeIds),
          capsule.primaryLocale,
          canonicalJson(capsule.claims),
          canonicalJson(
            capsule.citations.map((citation) => ({
              ...citation,
              snapshotId: scopedId(
                "source",
                pack.revision.revisionKey,
                citation.snapshotId,
              ),
            })),
          ),
          canonicalJson(capsule.conflicts),
          capsule.createdBy,
          capsule.validationHash.slice("sha256:".length),
          Date.parse(capsule.createdAt),
        );
      const sourceIds = new Set(
        capsule.citations.map((citation) => citation.snapshotId),
      );
      for (const sourceId of sourceIds) {
        this.#connection.sqlite
          .prepare(
            `INSERT INTO knowledge_capsule_sources
             (course_id, revision_id, capsule_id, source_snapshot_id)
             VALUES (?, ?, ?, ?)`,
          )
          .run(
            pack.course.courseKey,
            pack.revision.revisionKey,
            capsuleId,
            scopedId("source", pack.revision.revisionKey, sourceId),
          );
      }
    }
  }

  #insertPackMetadata(pack: CoursePackV1): void {
    for (const localization of pack.localizations) {
      this.#connection.sqlite
        .prepare(
          `INSERT INTO course_pack_localizations
           (revision_id, locale, release_complete, fields_json)
           VALUES (?, ?, ?, ?)`,
        )
        .run(
          pack.revision.revisionKey,
          localization.locale,
          localization.releaseComplete ? 1 : 0,
          canonicalJson(localization.fields),
        );
    }
    for (const node of pack.knowledge.nodes) {
      this.#connection.sqlite
        .prepare(
          `INSERT INTO course_pack_knowledge_nodes
           (revision_id, knowledge_node_id, title, description, kind,
            prerequisite_ids_json, related_ids_json, lifecycle)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          pack.revision.revisionKey,
          node.knowledgeNodeId,
          node.title,
          node.description,
          node.kind,
          canonicalJson(node.prerequisiteKnowledgeNodeIds),
          canonicalJson(node.relatedKnowledgeNodeIds),
          node.lifecycle,
        );
    }
  }

  #publishManifestRevision(pack: CoursePackV1, now: number): void {
    const published = this.#connection.sqlite
      .prepare(
        `UPDATE curriculum_versions
         SET status = 'published', content_hash = ?, published_at = ?,
             updated_at = ?
         WHERE id = ? AND status = 'draft'`,
      )
      .run(pack.revision.contentHash, now, now, pack.revision.revisionKey);
    if (published.changes !== 1) {
      throw new ClientError(
        400,
        "Course Pack manifest revision could not be published",
      );
    }
    const projection = this.#connection.sqlite
      .prepare(`SELECT status, content_hash FROM course_revisions WHERE id = ?`)
      .get(pack.revision.revisionKey) as
      { status: string; content_hash: string | null } | undefined;
    if (
      projection?.status !== "published" ||
      projection.content_hash !== pack.revision.contentHash
    ) {
      throw new ClientError(
        400,
        "Course Pack manifest projection is inconsistent",
      );
    }
  }

  #createEditableDraft(pack: CoursePackV1, now: number): string {
    const revisionId = scopedId(
      "draft",
      pack.revision.revisionKey,
      pack.revision.contentHash,
    );
    const existing = this.#connection.sqlite
      .prepare(`SELECT id FROM curriculum_versions WHERE id = ?`)
      .get(revisionId) as { id: string } | undefined;
    if (existing) return existing.id;

    const matchingBranchId = adaptationBranchIdForRevision(
      pack.course.courseKey,
      pack.revision.revisionKey,
    );
    const matchingBranch = this.#connection.sqlite
      .prepare(
        `SELECT id, base_revision_id, status FROM adaptation_branches
         WHERE course_id = ? AND id = ?`,
      )
      .get(pack.course.courseKey, matchingBranchId) as
      | {
          id: string;
          base_revision_id: string;
          status: "active" | "archived";
        }
      | undefined;
    if (
      matchingBranch &&
      matchingBranch.base_revision_id !== pack.revision.revisionKey
    ) {
      throw new CoursePackRepositoryError(
        "conflict",
        "Personal adaptation branch identity is bound to another revision",
      );
    }
    if (!matchingBranch) {
      this.#connection.sqlite
        .prepare(
          `INSERT INTO adaptation_branches
           (id, course_id, owner, base_revision_id, head_revision_id, status,
            created_at, updated_at)
           VALUES (?, ?, 'local', ?, NULL, 'archived', ?, ?)`,
        )
        .run(
          matchingBranchId,
          pack.course.courseKey,
          pack.revision.revisionKey,
          now,
          now,
        );
    }
    const latest = this.#connection.sqlite
      .prepare(
        `SELECT COALESCE(MAX(revision), 0) AS revision
         FROM curriculum_versions WHERE curriculum_id = ?`,
      )
      .get(pack.course.courseKey) as { revision: number };
    this.#insertCompatibilityGraph(pack, now, {
      id: revisionId,
      revisionNumber: latest.revision + 1,
      parentRevisionId: pack.revision.revisionKey,
      branchKind: "personal",
      basedOnContentHash: pack.revision.contentHash,
      adaptationBranchId: matchingBranchId,
    });
    this.#applyPackActivityMetadata(pack, revisionId);
    this.#assertCompatibilityProjection(pack, revisionId);
    return revisionId;
  }

  #activateInstalledRevisionBranch(pack: CoursePackV1, now: number): void {
    const branchId = adaptationBranchIdForRevision(
      pack.course.courseKey,
      pack.revision.revisionKey,
    );
    const baseRevisionId =
      pack.revision.branchKind === "upstream"
        ? pack.revision.revisionKey
        : pack.revision.parentRevisionKey!;
    const headRevisionId =
      pack.revision.branchKind === "personal"
        ? pack.revision.revisionKey
        : null;
    const activeBranches = this.#connection.sqlite
      .prepare(
        `SELECT id, base_revision_id
         FROM adaptation_branches
         WHERE course_id = ? AND status = 'active'
         ORDER BY id`,
      )
      .all(pack.course.courseKey) as Array<{
      id: string;
      base_revision_id: string;
    }>;
    if (activeBranches.length > 1) {
      throw new CoursePackRepositoryError(
        "conflict",
        "Course has ambiguous active personal adaptation branches",
      );
    }
    const active = activeBranches[0];
    if (active?.id === branchId) {
      if (active.base_revision_id !== baseRevisionId) {
        throw new CoursePackRepositoryError(
          "conflict",
          "Personal adaptation branch identity is bound to another revision",
        );
      }
      this.#setInstalledBranchHead(
        pack.course.courseKey,
        branchId,
        headRevisionId,
        now,
      );
      return;
    }
    if (active) {
      this.#connection.sqlite
        .prepare(
          `UPDATE adaptation_branches
           SET status = 'archived', updated_at = ?
           WHERE course_id = ? AND id = ? AND status = 'active'`,
        )
        .run(now, pack.course.courseKey, active.id);
    }

    const reusable = this.#connection.sqlite
      .prepare(
        `SELECT base_revision_id, status
         FROM adaptation_branches
         WHERE course_id = ? AND id = ?`,
      )
      .get(pack.course.courseKey, branchId) as
      { base_revision_id: string; status: "active" | "archived" } | undefined;
    if (reusable) {
      if (reusable.base_revision_id !== baseRevisionId) {
        throw new CoursePackRepositoryError(
          "conflict",
          "Personal adaptation branch identity is bound to another revision",
        );
      }
      this.#connection.sqlite
        .prepare(
          `UPDATE adaptation_branches
           SET status = 'active', updated_at = ?
           WHERE course_id = ? AND id = ? AND status = 'archived'`,
        )
        .run(now, pack.course.courseKey, branchId);
      this.#setInstalledBranchHead(
        pack.course.courseKey,
        branchId,
        headRevisionId,
        now,
      );
      return;
    }
    this.#connection.sqlite
      .prepare(
        `INSERT INTO adaptation_branches
         (id, course_id, owner, base_revision_id, head_revision_id, status,
          created_at, updated_at)
         VALUES (?, ?, 'local', ?, ?, 'active', ?, ?)`,
      )
      .run(
        branchId,
        pack.course.courseKey,
        baseRevisionId,
        headRevisionId,
        now,
        now,
      );
  }

  #assertCourseHasNoActiveSession(courseId: string): void {
    const activeSession = this.#connection.sqlite
      .prepare(
        `SELECT session.id
         FROM learning_sessions session
         JOIN session_course_contexts context ON context.session_id = session.id
         WHERE context.course_id = ? AND session.status = 'active'
         LIMIT 1`,
      )
      .get(courseId);
    if (activeSession) {
      throw new CoursePackRepositoryError(
        "active_session",
        "Complete the active Course session before installing another revision",
      );
    }
  }

  #prepareInstalledPersonalBranch(pack: CoursePackV1, now: number): void {
    if (pack.revision.branchKind !== "personal") return;
    const baseRevisionId = pack.revision.parentRevisionKey;
    if (!baseRevisionId) {
      throw new CoursePackRepositoryError(
        "conflict",
        "Personal Course Pack revision has no immutable upstream parent",
      );
    }
    const branchId = adaptationBranchIdForRevision(
      pack.course.courseKey,
      pack.revision.revisionKey,
    );
    const activeBranches = this.#connection.sqlite
      .prepare(
        `SELECT id FROM adaptation_branches
         WHERE course_id = ? AND status = 'active'
         ORDER BY id`,
      )
      .all(pack.course.courseKey) as Array<{ id: string }>;
    if (activeBranches.length > 1) {
      throw new CoursePackRepositoryError(
        "conflict",
        "Course has ambiguous active personal adaptation branches",
      );
    }
    const active = activeBranches[0];
    if (active && active.id !== branchId) {
      this.#connection.sqlite
        .prepare(
          `UPDATE adaptation_branches
           SET status = 'archived', updated_at = ?
           WHERE course_id = ? AND id = ? AND status = 'active'`,
        )
        .run(now, pack.course.courseKey, active.id);
    }
    const existing = this.#connection.sqlite
      .prepare(
        `SELECT base_revision_id, head_revision_id, status
         FROM adaptation_branches WHERE course_id = ? AND id = ?`,
      )
      .get(pack.course.courseKey, branchId) as
      | {
          base_revision_id: string;
          head_revision_id: string | null;
          status: "active" | "archived";
        }
      | undefined;
    if (existing) {
      if (
        existing.base_revision_id !== baseRevisionId ||
        existing.head_revision_id !== null
      ) {
        throw new CoursePackRepositoryError(
          "conflict",
          "Personal adaptation branch identity is already occupied",
        );
      }
      if (existing.status === "archived") {
        this.#connection.sqlite
          .prepare(
            `UPDATE adaptation_branches
             SET status = 'active', updated_at = ?
             WHERE course_id = ? AND id = ? AND status = 'archived'`,
          )
          .run(now, pack.course.courseKey, branchId);
      }
    } else {
      this.#connection.sqlite
        .prepare(
          `INSERT INTO adaptation_branches
           (id, course_id, owner, base_revision_id, head_revision_id, status,
            created_at, updated_at)
           VALUES (?, ?, 'local', ?, NULL, 'active', ?, ?)`,
        )
        .run(branchId, pack.course.courseKey, baseRevisionId, now, now);
    }
    const classified = this.#connection.sqlite
      .prepare(
        `UPDATE curriculum_versions
         SET adaptation_branch_id = ?, updated_at = ?
         WHERE id = ? AND curriculum_id = ? AND status = 'draft'
           AND branch_kind = 'personal'`,
      )
      .run(branchId, now, pack.revision.revisionKey, pack.course.courseKey);
    if (classified.changes !== 1) {
      throw new Error("Personal Course Pack branch could not be classified");
    }
  }

  #setInstalledBranchHead(
    courseId: string,
    branchId: string,
    headRevisionId: string | null,
    now: number,
  ): void {
    if (headRevisionId === null) return;
    const result = this.#connection.sqlite
      .prepare(
        `UPDATE adaptation_branches
         SET head_revision_id = ?, updated_at = ?
         WHERE course_id = ? AND id = ? AND status = 'active'
           AND (head_revision_id IS NULL OR head_revision_id = ?)`,
      )
      .run(headRevisionId, now, courseId, branchId, headRevisionId);
    if (result.changes !== 1) {
      throw new CoursePackRepositoryError(
        "conflict",
        "Personal adaptation branch head is already occupied",
      );
    }
  }

  #archiveManifestRevision(pack: CoursePackV1, now: number): void {
    const archived = this.#connection.sqlite
      .prepare(
        `UPDATE curriculum_versions
         SET status = 'archived', archived_at = ?, updated_at = ?
         WHERE id = ? AND status = 'published'`,
      )
      .run(now, now, pack.revision.revisionKey);
    if (archived.changes !== 1) {
      throw new ClientError(
        400,
        "Course Pack manifest source could not be archived",
      );
    }
  }

  #availableRevisionNumber(courseId: string, preferred: number): number {
    const collision = this.#connection.sqlite
      .prepare(
        `SELECT 1 FROM curriculum_versions
         WHERE curriculum_id = ? AND revision = ?`,
      )
      .get(courseId, preferred);
    if (!collision) return preferred;
    const latest = this.#connection.sqlite
      .prepare(
        `SELECT COALESCE(MAX(revision), 0) AS revision
         FROM curriculum_versions WHERE curriculum_id = ?`,
      )
      .get(courseId) as { revision: number };
    return latest.revision + 1;
  }

  #installResult(
    pack: CoursePackV1,
    action: CoursePackInstallAction,
    installed: boolean,
    idempotent: boolean,
  ): CoursePackInstallResult {
    const revisionId =
      action === "install"
        ? pack.revision.revisionKey
        : scopedId(
            "draft",
            pack.revision.revisionKey,
            pack.revision.contentHash,
          );
    const row = this.#connection.sqlite
      .prepare(`SELECT status FROM course_revisions WHERE id = ?`)
      .get(revisionId) as
      { status: "draft" | "published" | "archived" } | undefined;
    if (!row) throw new Error("Installed Course Pack revision disappeared");
    return {
      courseId: pack.course.courseKey,
      revisionId,
      contentHash: pack.revision.contentHash,
      action,
      revisionStatus: row.status,
      installed,
      idempotent,
    };
  }

  #insertInstallLifecycleEvent(input: {
    operationId: string;
    validationId: string;
    action: CoursePackInstallAction;
    manifestRevisionId: string;
    resultRevisionId: string;
    contentHash: string;
    sourceBytesHash: string;
    occurredAt: number;
  }): void {
    this.#connection.sqlite
      .prepare(
        `INSERT INTO course_pack_lifecycle_events
         (id, revision_id, operation_id, action, occurred_at, details_json)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        this.#id(),
        input.manifestRevisionId,
        input.operationId,
        input.action,
        input.occurredAt,
        canonicalJson({
          contentHash: input.contentHash,
          manifestRevisionId: input.manifestRevisionId,
          resultRevisionId: input.resultRevisionId,
          sourceBytesHash: input.sourceBytesHash,
          validationId: input.validationId,
        }),
      );
  }

  #readLifecycleOperation(operationId: string):
    | {
        revision_id: string;
        action: CoursePackLifecycleAction;
        details_json: string;
      }
    | undefined {
    return this.#connection.sqlite
      .prepare(
        `SELECT revision_id, action, details_json FROM course_pack_lifecycle_events
         WHERE operation_id = ?`,
      )
      .get(operationId) as
      | {
          revision_id: string;
          action: CoursePackLifecycleAction;
          details_json: string;
        }
      | undefined;
  }

  #reconcileInstallOperation(
    operation: {
      revision_id: string;
      action: CoursePackLifecycleAction;
      details_json: string;
    },
    input: ReconcileCoursePackInstallInput,
  ): CoursePackInstallResult {
    const details = lifecycleInstallDetails(operation.details_json);
    if (
      operation.action !== input.action ||
      details === null ||
      details.validationId !== input.validationId ||
      details.contentHash !== input.expectedContentHash ||
      details.manifestRevisionId !== operation.revision_id
    ) {
      throw new CoursePackRepositoryError(
        "conflict",
        "Course Pack operation ID is already bound to a different validation, action, or payload",
      );
    }
    const manifest = this.#connection.sqlite
      .prepare(
        `SELECT canonical_json, content_hash FROM course_pack_manifests
         WHERE revision_id = ?`,
      )
      .get(operation.revision_id) as
      { canonical_json: string; content_hash: string } | undefined;
    if (!manifest || manifest.content_hash !== details.contentHash) {
      throw new Error("Committed Course Pack operation is inconsistent");
    }
    const pack = CoursePackV1Schema.parse(
      JSON.parse(manifest.canonical_json) as unknown,
    );
    const result = this.#installResult(pack, input.action, false, true);
    if (result.revisionId !== details.resultRevisionId) {
      throw new Error("Committed Course Pack result is inconsistent");
    }
    return result;
  }

  #readImportLifecycle(
    revisionId: string,
  ): { action: CoursePackLifecycleAction } | undefined {
    return this.#connection.sqlite
      .prepare(
        `SELECT action FROM course_pack_lifecycle_events
         WHERE revision_id = ?
         ORDER BY occurred_at DESC, rowid DESC LIMIT 1`,
      )
      .get(revisionId) as { action: CoursePackLifecycleAction } | undefined;
  }

  #evidenceCountForCourse(courseId: string): number {
    const row = this.#connection.sqlite
      .prepare(
        `SELECT count(*) AS count FROM evidence_facts WHERE course_id = ?`,
      )
      .get(courseId) as { count: number };
    return row.count;
  }

  #revisionCount(courseId: string): number {
    const row = this.#connection.sqlite
      .prepare(
        `SELECT count(*) AS count FROM course_revisions WHERE course_id = ?`,
      )
      .get(courseId) as { count: number };
    return row.count;
  }

  #assertStorage(): void {
    if (!this.hasStorage()) {
      throw new ClientError(
        400,
        "Course Pack storage is unavailable until the approved M3 migration is applied",
      );
    }
  }
}

function prerequisiteInsertionOrder<T>(
  items: readonly T[],
  stableId: (item: T) => string,
  prerequisiteIds: (item: T) => readonly string[],
): readonly T[] {
  const itemById = new Map(items.map((item) => [stableId(item), item]));
  const active = new Set<string>();
  const complete = new Set<string>();
  const ordered: T[] = [];
  const visit = (item: T): void => {
    const id = stableId(item);
    if (complete.has(id)) return;
    if (active.has(id)) {
      throw new ClientError(
        400,
        "Course Pack prerequisite insertion graph has a cycle",
      );
    }
    active.add(id);
    for (const prerequisiteId of prerequisiteIds(item)) {
      const prerequisite = itemById.get(prerequisiteId);
      if (prerequisite === undefined) {
        throw new ClientError(
          400,
          "Course Pack prerequisite insertion graph is incomplete",
        );
      }
      visit(prerequisite);
    }
    active.delete(id);
    complete.add(id);
    ordered.push(item);
  };
  for (const item of items) visit(item);
  if (ordered.length !== items.length) {
    throw new ClientError(
      400,
      "Course Pack prerequisite insertion graph is ambiguous",
    );
  }
  return ordered;
}
function upgradeRequestPayloadHash(
  mode: CoursePackUpgradeMode,
  sideBySideSuffix: string | undefined,
  adaptationResolutions:
    | readonly {
        conflictId: string;
        resolution: "use-upstream" | "keep-personal";
      }[]
    | undefined,
): string {
  const normalizedResolutions = [...(adaptationResolutions ?? [])].sort(
    (left, right) =>
      left.conflictId.localeCompare(right.conflictId) ||
      left.resolution.localeCompare(right.resolution),
  );
  return `sha256:${createHash("sha256")
    .update(
      canonicalJson({
        mode,
        sideBySideSuffix: sideBySideSuffix ?? null,
        adaptationResolutions: normalizedResolutions,
      }),
      "utf8",
    )
    .digest("hex")}`;
}

interface CompatibilityProjection {
  readonly lessonIds: readonly string[];
  readonly lessonEdges: readonly string[];
  readonly activityIds: readonly string[];
  readonly activityEdges: readonly string[];
}

function projectionKey(...ids: readonly string[]): string {
  return canonicalJson(ids);
}

function jsonStringArray(value: string, label: string): readonly string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new Error(`${label} projection is invalid`);
  }
  if (
    !Array.isArray(parsed) ||
    parsed.some((entry) => typeof entry !== "string")
  ) {
    throw new Error(`${label} projection is invalid`);
  }
  return parsed as string[];
}

function jsonUnitPrerequisiteIds(value: string): readonly string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new ClientError(
      400,
      "Course Pack activity prerequisite projection is invalid",
    );
  }
  if (!Array.isArray(parsed)) {
    throw new ClientError(
      400,
      "Course Pack activity prerequisite projection is invalid",
    );
  }
  return parsed.map((candidate) => {
    if (
      candidate === null ||
      typeof candidate !== "object" ||
      Array.isArray(candidate)
    ) {
      throw new ClientError(
        400,
        "Course Pack activity prerequisite projection is invalid",
      );
    }
    const rule = candidate as Record<string, unknown>;
    if (
      rule.type !== "unit-completed" ||
      typeof rule.unitId !== "string" ||
      Object.keys(rule).sort().join(",") !== "type,unitId"
    ) {
      throw new ClientError(
        400,
        "Course Pack activity prerequisite projection is invalid",
      );
    }
    return rule.unitId;
  });
}

function assertCompatibilityProjection(
  layer: string,
  expected: CompatibilityProjection,
  actual: CompatibilityProjection,
): void {
  if (canonicalJson(expected) !== canonicalJson(actual)) {
    throw new Error(
      `Course Pack compatibility projection mismatch in ${layer}`,
    );
  }
}

export function createCoursePackRepository(
  connection: DatabaseConnection,
  options: CoursePackRepositoryOptions = {},
): CoursePackRepository {
  return new CoursePackRepository(connection, options);
}

export function coursePackSourceBytesHash(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function scopedId(kind: string, revisionId: string, stableId: string): string {
  return `m3-${kind}-${createHash("sha256")
    .update(`${revisionId}\u0000${stableId}`, "utf8")
    .digest("hex")}`;
}

function projectedPrivateQuestions(
  activity: CoursePackV1["lessons"][number]["activities"][number],
): CoursePackV1["lessons"][number]["activities"][number]["protectedMaterial"]["questions"] {
  if (activity.protectedMaterial.questions.length > 0) {
    return activity.protectedMaterial.questions;
  }
  if (activity.payload.type !== "recall") return [];
  return [
    {
      id: activity.activityId,
      kind: "explain",
      prompt: activity.payload.prompt,
      options: [],
      correctOptionIds: [],
      referenceAnswer: activity.protectedMaterial.referenceAnswer,
      evaluationPoints: [],
      commonMistakes: [],
    },
  ];
}

function boundedReportJson(report: CoursePackValidationReport): string {
  const boundedDiagnostics = report.diagnostics
    .slice(0, 500)
    .map((diagnostic): CoursePackDiagnostic => ({
      code: diagnostic.code.slice(0, 100),
      severity: diagnostic.severity,
      path: diagnostic.path.slice(0, 1_000),
      entityId: diagnostic.entityId?.slice(0, 200) ?? null,
      ruleId: diagnostic.ruleId?.slice(0, 100) ?? null,
      context: diagnostic.context,
      message: diagnostic.message.slice(0, 2_000),
    }));
  return canonicalJson({
    validatorVersion: report.validatorVersion,
    valid: report.valid,
    errors: report.errors,
    warnings: report.warnings,
    diagnostics: boundedDiagnostics,
    limits: report.limits,
  });
}

function assertSha256(value: string, label: string): void {
  if (!/^sha256:[0-9a-f]{64}$/u.test(value)) {
    throw new Error(`${label} is malformed`);
  }
}

function lifecycleInstallDetails(value: string): {
  contentHash: string;
  manifestRevisionId: string;
  resultRevisionId: string;
  validationId: string;
} | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const details = parsed as Record<string, unknown>;
  return typeof details.contentHash === "string" &&
    /^sha256:[0-9a-f]{64}$/u.test(details.contentHash) &&
    typeof details.manifestRevisionId === "string" &&
    details.manifestRevisionId.length > 0 &&
    typeof details.resultRevisionId === "string" &&
    details.resultRevisionId.length > 0 &&
    typeof details.validationId === "string" &&
    CourseOperationIdSchema.safeParse(details.validationId).success
    ? {
        contentHash: details.contentHash,
        manifestRevisionId: details.manifestRevisionId,
        resultRevisionId: details.resultRevisionId,
        validationId: details.validationId,
      }
    : null;
}

function upgradeLifecycleDetails(value: string): {
  mode: CoursePackUpgradeMode;
  validationId: string;
  contentHash: string;
  manifestRevisionId: string;
  resultRevisionId: string;
  courseId: string;
  replayedFactCount: number;
  supersededEvidenceCount: number;
  sideBySideCourseKey: string | null;
  payloadHash: string;
} | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const details = parsed as Record<string, unknown>;
  const mode = details.mode;
  if (mode !== "safe-update" && mode !== "side-by-side") {
    return null;
  }
  if (
    typeof details.validationId !== "string" ||
    !CourseOperationIdSchema.safeParse(details.validationId).success ||
    typeof details.contentHash !== "string" ||
    !/^sha256:[0-9a-f]{64}$/u.test(details.contentHash) ||
    typeof details.manifestRevisionId !== "string" ||
    details.manifestRevisionId.length === 0 ||
    typeof details.resultRevisionId !== "string" ||
    details.resultRevisionId.length === 0 ||
    typeof details.courseId !== "string" ||
    details.courseId.length === 0 ||
    typeof details.replayedFactCount !== "number" ||
    !Number.isInteger(details.replayedFactCount) ||
    details.replayedFactCount < 0 ||
    typeof details.supersededEvidenceCount !== "number" ||
    !Number.isInteger(details.supersededEvidenceCount) ||
    details.supersededEvidenceCount < 0 ||
    typeof details.payloadHash !== "string" ||
    !/^sha256:[0-9a-f]{64}$/u.test(details.payloadHash) ||
    (details.sideBySideCourseKey !== null &&
      typeof details.sideBySideCourseKey !== "string")
  ) {
    return null;
  }
  return {
    mode,
    validationId: details.validationId,
    contentHash: details.contentHash,
    manifestRevisionId: details.manifestRevisionId,
    resultRevisionId: details.resultRevisionId,
    courseId: details.courseId,
    replayedFactCount: details.replayedFactCount,
    supersededEvidenceCount: details.supersededEvidenceCount,
    sideBySideCourseKey: details.sideBySideCourseKey,
    payloadHash: details.payloadHash,
  };
}

function upgradeReplayId(operationId: string, previousId: string): string {
  const suffix = createHash("sha256")
    .update(`${operationId} ${previousId}`, "utf8")
    .digest("hex")
    .slice(0, 16);
  const candidate = `replay-${suffix}-${previousId}`;
  return candidate.length <= 500
    ? candidate
    : `replay-${createHash("sha256").update(candidate, "utf8").digest("hex")}`;
}

function rewriteUpgradeFactBody(
  body: LearningKernelFactBody,
  activityId: string,
): LearningKernelFactBody {
  if (body.type === "correction") {
    return {
      ...body,
      replacement: { ...body.replacement, activityId },
    };
  }
  return { ...body, activityId };
}
