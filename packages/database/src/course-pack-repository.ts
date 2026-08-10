import { createHash, randomUUID } from "node:crypto";

import {
  canonicalJson,
  CoursePackV1Schema,
  type CoursePackDiagnostic,
  type CoursePackV1,
  type CoursePackValidationReport,
} from "@dlh/course-authoring-kit";
import { CourseOperationIdSchema } from "@dlh/shared";

import { withTransaction, type DatabaseConnection } from "./database.js";

const REQUIRED_M3_TABLES = [
  "course_pack_manifests",
  "course_pack_localizations",
  "course_pack_knowledge_nodes",
  "course_pack_lifecycle_events",
  "course_pack_quarantine",
] as const;

export type CoursePackInstallAction = "install" | "open-as-draft";
export type CoursePackLifecycleAction = CoursePackInstallAction | "uninstall";
export type CoursePackRepositoryErrorCode = "conflict" | "not_found";

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

export interface CoursePackLibraryItem {
  readonly courseId: string;
  readonly courseKey: string;
  readonly title: string;
  readonly revisionId: string;
  readonly revisionNumber: number;
  readonly contentHash: string;
  readonly revisionStatus: "draft" | "published" | "archived";
  readonly lifecycleAction: CoursePackLifecycleAction;
  readonly importedAt: string;
}

export interface UninstallCoursePackInput {
  readonly operationId: string;
  readonly revisionId: string;
  readonly confirmRevisionKey: string;
}

export interface UninstallCoursePackResult {
  readonly revisionId: string;
  readonly lifecycleAction: "uninstall";
  readonly retainedEvidenceCount: number;
  readonly idempotent: boolean;
}

interface RevisionStatusRow {
  course_id: string;
  status: "draft" | "published" | "archived";
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
    const pack = CoursePackV1Schema.parse(input.pack);
    assertSha256(input.sourceBytesHash, "Course Pack source bytes hash");
    if (!input.report.valid || input.report.errors !== 0) {
      throw new Error("Course Pack installation requires a zero-error report");
    }
    if (input.canonicalJson !== canonicalJson(pack)) {
      throw new Error(
        "Course Pack canonical JSON does not match the validated pack",
      );
    }
    if (pack.revision.contentHash.length !== 71) {
      throw new Error("Course Pack requires a prefixed SHA-256 content hash");
    }

    return withTransaction(this.#connection, () => {
      const existingOperation = this.#readLifecycleOperation(operationId);
      if (existingOperation) {
        if (
          existingOperation.revision_id !== pack.revision.revisionKey ||
          existingOperation.action !== input.action
        ) {
          throw new CoursePackRepositoryError(
            "conflict",
            "Course Pack operation ID is already bound to a different action",
          );
        }
        return this.#installResult(pack, input.action, false, true);
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
        return this.#installResult(pack, input.action, false, true);
      }

      const now = this.#now();
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
          boundedReportJson(input.report),
          input.report.validatorVersion,
          now,
        );
      this.#insertPackMetadata(pack);
      this.#connection.sqlite
        .prepare(
          `INSERT INTO course_pack_lifecycle_events
           (id, revision_id, operation_id, action, occurred_at, details_json)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          this.#id(),
          pack.revision.revisionKey,
          operationId,
          input.action,
          now,
          canonicalJson({
            contentHash: pack.revision.contentHash,
            sourceBytesHash: input.sourceBytesHash,
          }),
        );

      if (input.action === "install") {
        this.#connection.sqlite
          .prepare(
            `UPDATE course_revisions
             SET status = 'published', content_hash = ?, published_at = ?,
                 updated_at = ?
             WHERE id = ? AND status = 'draft'`,
          )
          .run(pack.revision.contentHash, now, now, pack.revision.revisionKey);
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
            `UPDATE curriculum_versions
             SET status = 'published', content_hash = ?, published_at = ?,
                 updated_at = ?
             WHERE id = ? AND status = 'draft'`,
          )
          .run(pack.revision.contentHash, now, now, pack.revision.revisionKey);
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

      return this.#installResult(pack, input.action, true, false);
    });
  }

  list(): readonly CoursePackLibraryItem[] {
    if (!this.hasStorage()) return [];
    const rows = this.#connection.sqlite
      .prepare(
        `SELECT course.id AS course_id, course.stable_id AS course_key,
                course.title, revision.id AS revision_id,
                revision.revision_number, revision.status,
                manifest.content_hash, manifest.imported_at,
                event.action
         FROM course_pack_manifests manifest
         JOIN course_revisions revision ON revision.id = manifest.revision_id
         JOIN courses course ON course.id = revision.course_id
         JOIN course_pack_lifecycle_events event ON event.id = (
           SELECT latest.id FROM course_pack_lifecycle_events latest
           WHERE latest.revision_id = manifest.revision_id
           ORDER BY latest.occurred_at DESC, latest.id DESC LIMIT 1
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
      action: CoursePackLifecycleAction;
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
        `SELECT canonical_json FROM course_pack_manifests WHERE revision_id = ?`,
      )
      .get(revisionId) as { canonical_json: string } | undefined;
    if (!row) return null;
    const parsed = CoursePackV1Schema.parse(
      JSON.parse(row.canonical_json) as unknown,
    );
    const canonical = canonicalJson(parsed);
    if (canonical !== row.canonical_json) {
      throw new Error("Stored Course Pack canonical bytes are inconsistent");
    }
    return canonical;
  }

  uninstall(input: UninstallCoursePackInput): UninstallCoursePackResult {
    this.#assertStorage();
    const operationId = CourseOperationIdSchema.parse(input.operationId);
    if (input.confirmRevisionKey !== input.revisionId) {
      throw new CoursePackRepositoryError(
        "conflict",
        "Course Pack uninstall confirmation does not match revision",
      );
    }
    return withTransaction(this.#connection, () => {
      const existingOperation = this.#readLifecycleOperation(operationId);
      if (existingOperation) {
        if (
          existingOperation.revision_id !== input.revisionId ||
          existingOperation.action !== "uninstall"
        ) {
          throw new CoursePackRepositoryError(
            "conflict",
            "Course Pack operation ID is already bound to a different action",
          );
        }
        return {
          revisionId: input.revisionId,
          lifecycleAction: "uninstall",
          retainedEvidenceCount: this.#evidenceCount(input.revisionId),
          idempotent: true,
        };
      }
      const revision = this.#connection.sqlite
        .prepare(
          `SELECT revision.course_id, revision.status
           FROM course_pack_manifests manifest
           JOIN course_revisions revision ON revision.id = manifest.revision_id
           WHERE manifest.revision_id = ?`,
        )
        .get(input.revisionId) as RevisionStatusRow | undefined;
      if (!revision) {
        throw new CoursePackRepositoryError(
          "not_found",
          "Unknown Course Pack revision",
        );
      }

      const now = this.#now();
      if (revision.status === "published") {
        this.#connection.sqlite
          .prepare(
            `UPDATE course_revisions
             SET status = 'archived', archived_at = ?, updated_at = ?
             WHERE id = ? AND status = 'published'`,
          )
          .run(now, now, input.revisionId);
      }
      this.#connection.sqlite
        .prepare(
          `UPDATE curriculum_versions
           SET status = 'archived', archived_at = ?, updated_at = ?
           WHERE id = ? AND status = 'published'`,
        )
        .run(now, now, input.revisionId);
      this.#connection.sqlite
        .prepare(
          `UPDATE curricula SET active_version_id = NULL, updated_at = ?
           WHERE id = ? AND active_version_id = ?`,
        )
        .run(now, revision.course_id, input.revisionId);
      this.#connection.sqlite
        .prepare(
          `UPDATE courses SET active_revision_id = NULL, updated_at = ?
           WHERE id = ? AND active_revision_id = ?`,
        )
        .run(now, revision.course_id, input.revisionId);
      this.#connection.sqlite
        .prepare(
          `UPDATE adaptation_branches SET status = 'archived', updated_at = ?
           WHERE course_id = ? AND base_revision_id = ? AND status = 'active'`,
        )
        .run(now, revision.course_id, input.revisionId);
      const retainedEvidenceCount = this.#evidenceCount(input.revisionId);
      this.#connection.sqlite
        .prepare(
          `INSERT INTO course_pack_lifecycle_events
           (id, revision_id, operation_id, action, occurred_at, details_json)
           VALUES (?, ?, ?, 'uninstall', ?, ?)`,
        )
        .run(
          this.#id(),
          input.revisionId,
          operationId,
          now,
          canonicalJson({ retainedEvidenceCount }),
        );
      return {
        revisionId: input.revisionId,
        lifecycleAction: "uninstall",
        retainedEvidenceCount,
        idempotent: false,
      };
    });
  }

  #assertInstallIdentity(pack: CoursePackV1): void {
    const courses = this.#connection.sqlite
      .prepare(
        `SELECT id, stable_id FROM courses WHERE id = ? OR stable_id = ?`,
      )
      .all(pack.course.courseKey, pack.course.courseKey) as Array<{
      id: string;
      stable_id: string;
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

    const revisionCollision = this.#connection.sqlite
      .prepare(
        `SELECT id FROM course_revisions
         WHERE id = ? OR (course_id = ? AND revision_number = ?)`,
      )
      .all(
        pack.revision.revisionKey,
        pack.course.courseKey,
        pack.revision.revisionNumber,
      ) as Array<{ id: string }>;
    if (revisionCollision.length > 0) {
      throw new CoursePackRepositoryError(
        "conflict",
        "Course Pack revision identity or number already exists",
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
      .prepare(`UPDATE courses SET primary_locale = ? WHERE id = ?`)
      .run(pack.course.primaryLocale, pack.course.courseKey);
    this.#connection.sqlite
      .prepare(
        `UPDATE course_revisions
         SET branch_kind = ?, based_on_content_hash = ? WHERE id = ?`,
      )
      .run(
        pack.revision.branchKind,
        pack.revision.basedOnContentHash,
        pack.revision.revisionKey,
      );
    for (const lesson of pack.lessons) {
      for (const activity of lesson.activities) {
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
              activity.protectedMaterial.questions.map((question) => ({
                id: question.id,
                kind: question.kind,
                prompt: question.prompt,
                options: question.options,
              })),
            ),
            canonicalJson(activity.capabilityIds),
            canonicalJson(activity.knowledgeNodeIds),
            canonicalJson(activity.protectedMaterial),
            pack.course.courseKey,
            pack.revision.revisionKey,
            scopedId(
              "activity",
              pack.revision.revisionKey,
              activity.activityId,
            ),
          );
        if (result.changes !== 1) {
          throw new Error("Course Pack activity projection is incomplete");
        }
      }
    }
  }

  #insertCompatibilityGraph(pack: CoursePackV1, now: number): void {
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
         (id, curriculum_id, revision, parent_version_id, status, title,
          description, content_hash, created_at, published_at, archived_at,
          updated_at)
         VALUES (?, ?, ?, ?, 'draft', ?, ?, NULL, ?, NULL, NULL, ?)`,
      )
      .run(
        pack.revision.revisionKey,
        pack.course.courseKey,
        pack.revision.revisionNumber,
        pack.revision.parentRevisionKey,
        pack.course.title,
        pack.course.description,
        now,
        now,
      );
    const weekId = scopedId("week", pack.revision.revisionKey, "main");
    this.#connection.sqlite
      .prepare(
        `INSERT INTO curriculum_weeks
         (id, version_id, stable_id, order_index, title, description,
          created_at, updated_at)
         VALUES (?, ?, 'main', 0, ?, ?, ?, ?)`,
      )
      .run(
        weekId,
        pack.revision.revisionKey,
        pack.course.title,
        pack.course.description,
        now,
        now,
      );

    for (const lesson of pack.lessons) {
      const lessonId = scopedId(
        "lesson",
        pack.revision.revisionKey,
        lesson.lessonId,
      );
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
          pack.revision.revisionKey,
          weekId,
          lesson.lessonId,
          lesson.order,
          lesson.title,
          lesson.description,
          lesson.goal,
          lesson.estimatedMinutes,
          canonicalJson([]),
          canonicalJson(lesson.knowledgeNodeIds),
          now,
          now,
        );
      for (const activity of lesson.activities) {
        const activityId = scopedId(
          "activity",
          pack.revision.revisionKey,
          activity.activityId,
        );
        const learnerQuestions = activity.protectedMaterial.questions.map(
          (question) => ({
            id: question.id,
            kind: question.kind,
            prompt: question.prompt,
            options: question.options,
          }),
        );
        this.#connection.sqlite
          .prepare(
            `INSERT INTO curriculum_units
             (id, version_id, day_id, stable_id, type, order_index, title,
              description, estimated_minutes, objectives_json, checklist_json,
              sources_json, questions_json, misconceptions_json,
              reference_answer_json, completion_criteria_json,
              unlock_rules_json, optional, depth_level, payload_json,
              created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', '[]', '[]', ?, '[]',
                     NULL, ?, ?, ?, 'foundation', ?, ?, ?)`,
          )
          .run(
            activityId,
            pack.revision.revisionKey,
            lessonId,
            activity.activityId,
            activity.type,
            activity.order,
            activity.title,
            activity.description,
            activity.estimatedMinutes,
            canonicalJson(learnerQuestions),
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

  #installResult(
    pack: CoursePackV1,
    action: CoursePackInstallAction,
    installed: boolean,
    idempotent: boolean,
  ): CoursePackInstallResult {
    const row = this.#connection.sqlite
      .prepare(`SELECT status FROM course_revisions WHERE id = ?`)
      .get(pack.revision.revisionKey) as
      { status: "draft" | "published" | "archived" } | undefined;
    if (!row) throw new Error("Installed Course Pack revision disappeared");
    return {
      courseId: pack.course.courseKey,
      revisionId: pack.revision.revisionKey,
      contentHash: pack.revision.contentHash,
      action,
      revisionStatus: row.status,
      installed,
      idempotent,
    };
  }

  #readLifecycleOperation(operationId: string):
    | {
        revision_id: string;
        action: CoursePackLifecycleAction;
      }
    | undefined {
    return this.#connection.sqlite
      .prepare(
        `SELECT revision_id, action FROM course_pack_lifecycle_events
         WHERE operation_id = ?`,
      )
      .get(operationId) as
      { revision_id: string; action: CoursePackLifecycleAction } | undefined;
  }

  #evidenceCount(revisionId: string): number {
    const row = this.#connection.sqlite
      .prepare(
        `SELECT count(*) AS count FROM evidence_facts WHERE revision_id = ?`,
      )
      .get(revisionId) as { count: number };
    return row.count;
  }

  #assertStorage(): void {
    if (!this.hasStorage()) {
      throw new Error(
        "Course Pack storage is unavailable until the approved M3 migration is applied",
      );
    }
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

function boundedReportJson(report: CoursePackValidationReport): string {
  const boundedDiagnostics = report.diagnostics
    .slice(0, 500)
    .map((diagnostic): CoursePackDiagnostic => ({
      code: diagnostic.code.slice(0, 100),
      severity: diagnostic.severity,
      path: diagnostic.path.slice(0, 1_000),
      entityId: diagnostic.entityId?.slice(0, 200) ?? null,
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
