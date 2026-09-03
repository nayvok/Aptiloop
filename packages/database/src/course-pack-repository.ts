import { createHash, randomUUID } from "node:crypto";

import {
  canonicalJson,
  CoursePackV1Schema,
  validateCoursePackBytes,
  type CoursePackDiagnostic,
  type CoursePackV1,
  type CoursePackValidationReport,
} from "@aptiloop/course-authoring-kit";
import { ClientError, CourseOperationIdSchema } from "@aptiloop/shared";

import { adaptationBranchIdForRevision } from "./adaptation-branch.js";
import { withTransaction, type DatabaseConnection } from "./database.js";

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

interface CourseDeletionRow {
  course_id: string;
  course_key: string;
  manifest_revision_id: string;
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
