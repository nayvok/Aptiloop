import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import {
  canonicalJson,
  COURSE_PACK_JSON_LIMITS_V1,
  parseStrictJson,
  StrictJsonError,
  validateCoursePackBytes,
  type CoursePackDiagnostic,
  type CoursePackValidationReport,
  type CoursePackV1,
} from "@aptiloop/course-authoring-kit";
import {
  canonicalLearningKernelJson,
  collectLearningKernelFactShapeIssues,
  learningKernelSha256,
  projectLearningKernel,
  type LearningKernelFact,
} from "@aptiloop/learning-core";
import {
  ClientError,
  COURSE_TRANSFER_EXCLUDED_V1,
  COURSE_TRANSFER_FORMAT,
  COURSE_TRANSFER_FORMAT_VERSION,
  COURSE_TRANSFER_JSON_LIMITS_V1,
  CourseTransferConflictSchema,
  CourseTransferEnvelopeSchema,
  CourseTransferExportRequestSchema,
  CourseTransferRevisionSnapshotCanonicalSchema,
  transferUtf8ByteLength,
  type CourseTransferCommitResult,
  type CourseTransferConflict,
  type CourseTransferCourseResolution,
  type CourseTransferEnvelope,
  type CourseTransferLearnerScopeCourse,
  type CourseTransferPreview,
  type CourseTransferRevisionSnapshotCanonical,
  type CourseTransferPreviewCourse,
} from "@aptiloop/shared";

import { adaptationBranchIdForRevision } from "./adaptation-branch.js";
import {
  hashCanonicalJson,
  loadVersionGraph,
  publicationContent,
  publishDraftCurriculumVersionWithinTransaction,
  restoreDraftGraphWithIds,
  type CurriculumVersionGraph,
} from "./authoring-repository.js";
import {
  courseTransferSanitizationPolicy,
  courseTransferSanitizationScope,
  findCourseTransferProhibitedSignals,
} from "./data-portability.js";
import { withTransaction, type DatabaseConnection } from "./database.js";
import {
  coursePackSourceBytesHash,
  type CoursePackRepository,
} from "./course-pack-repository.js";
import {
  ensureKernelSessionStubDay,
  insertRestoredKernelFact,
  KERNEL_RESTORE_STUB_DAY_ID,
  readRevisionActivities,
} from "./kernel-restore.js";

const UTF8_ENCODER = new TextEncoder();
const UTF8_DECODER = new TextDecoder("utf-8");
const TRANSFER_VALIDATOR_VERSION = "transfer-v1" as const;
/** Parser-detail override: pack limits reused, envelope bytes/items raised. */
const TRANSFER_STRICT_LIMITS = {
  ...COURSE_PACK_JSON_LIMITS_V1,
  maxBytes: COURSE_TRANSFER_JSON_LIMITS_V1.maxBytes,
  maxDecodedCharacters: COURSE_TRANSFER_JSON_LIMITS_V1.maxBytes,
  maxItems: 1_000_000,
  maxStringCharacters: 2_000_000,
  maxParseMilliseconds: 2_000,
} as const;
const MAX_TRANSFER_DIAGNOSTICS = 100;

export interface CourseTransferAttemptDescriptor {
  readonly attemptId: string;
  readonly sessionId: string;
  readonly exerciseId: string;
  readonly courseId: string;
  readonly revisionId: string;
  readonly workspacePath: string;
  readonly baselinePath: string;
  readonly baselineCommit: string;
  readonly trustedTemplateId: string;
  readonly templatePath: string;
  readonly startedAt: string;
}

export interface CourseTransferExportInput {
  readonly courseKeys: readonly string[];
  readonly includeHistory: true;
  readonly scopeNote: string;
  readonly operationId: string;
  /** Originating app version, recorded in the manifest as metadata. */
  readonly originatingAppVersion: string;
}

export interface CourseTransferExportResult {
  readonly envelopeJson: string;
  readonly envelopeHash: string;
  readonly filename: string;
  readonly preview: CourseTransferPreview;
  /** Server-owned descriptors for orchestrator exercise-core enrichment. */
  readonly attemptDescriptors: readonly CourseTransferAttemptDescriptor[];
}

export interface CourseTransferValidation {
  readonly valid: boolean;
  readonly envelope: CourseTransferEnvelope | null;
  readonly preview: CourseTransferPreview | null;
  readonly report: CoursePackValidationReport;
  readonly envelopeHash: string;
}

export interface CourseTransferCommitInput {
  readonly operationId: string;
  readonly envelope: CourseTransferEnvelope;
  readonly envelopeHash: string;
  readonly expectedEnvelopeHash: string;
  readonly resolutions?: readonly CourseTransferCourseResolution[];
}

export class CourseTransferInvalidError extends Error {
  readonly report: CoursePackValidationReport;
  readonly envelopeHash: string;

  constructor(
    report: CoursePackValidationReport,
    envelopeHash: string,
    message = "Course transfer envelope did not pass validation",
  ) {
    super(message);
    this.name = "CourseTransferInvalidError";
    this.report = report;
    this.envelopeHash = envelopeHash;
  }
}

/**
 * Builds a transfer envelope for explicitly named courses. Requires an
 * explicit user action: non-empty course keys plus a scope note naming the
 * destination/scope. Transfer-with-progress always carries history. Export
 * reads one consistent SQLite snapshot (transactional); derived projections
 * are rebuilt and checkpoint hashes compared on import. Active provider turns
 * resume from the last persisted fact; the preview reports dropped pending
 * turns. Active exercises are represented as bounded attempt snapshots; the
 * orchestrator composes filesystem/Git content via exercise-core, while this
 * boundary stores typed metadata/facts only.
 */
export function buildCourseTransferExport(
  connection: DatabaseConnection,
  input: CourseTransferExportInput,
): CourseTransferExportResult {
  const request = CourseTransferExportRequestSchema.parse({
    courseKeys: [...input.courseKeys],
    includeHistory: true,
    scopeNote: input.scopeNote,
    operationId: input.operationId,
  });
  return withTransaction(connection, () => {
    const courseKeys = [...new Set(request.courseKeys)];
    const nowIso = new Date(Date.now()).toISOString();
    const packs: CourseTransferEnvelope["packs"] = [];
    const revisionSnapshots: CourseTransferEnvelope["revisionSnapshots"] = [];
    const previewCourses: CourseTransferPreviewCourse[] = [];
    for (const courseKey of courseKeys) {
      const course = connection.sqlite
        .prepare(`SELECT id, title, primary_locale FROM courses WHERE id = ?`)
        .get(courseKey) as
        { id: string; title: string; primary_locale: string } | undefined;
      if (!course) {
        throw new ClientError(404, `Unknown Course for transfer: ${courseKey}`);
      }
      const revisions = connection.sqlite
        .prepare(
          `SELECT manifest.revision_id, manifest.canonical_json,
                  manifest.content_hash,
                  CAST(json_extract(manifest.canonical_json, '$.revision.revisionNumber') AS INTEGER) AS revision_number
           FROM course_pack_manifests manifest
           JOIN course_revisions revision ON revision.id = manifest.revision_id
           WHERE revision.course_id = ? AND revision.status = 'published'
           ORDER BY revision_number, manifest.revision_id`,
        )
        .all(courseKey) as Array<{
        revision_id: string;
        canonical_json: string;
        content_hash: string;
        revision_number: number;
      }>;
      if (
        packs.length + revisions.length >
        COURSE_TRANSFER_JSON_LIMITS_V1.maxPacks
      ) {
        throw new ClientError(
          400,
          "Course transfer exceeds the pack count limit",
        );
      }
      for (const revision of revisions) {
        const pack = JSON.parse(revision.canonical_json) as {
          course?: {
            courseKey?: string;
            title?: string;
            primaryLocale?: string;
          };
          revision?: { revisionKey?: string; revisionNumber?: number };
        };
        packs.push({
          courseKey,
          revisionKey: revision.revision_id,
          revisionNumber: revision.revision_number,
          contentHash: revision.content_hash,
          canonicalJson: revision.canonical_json,
        });
        previewCourses.push({
          courseKey,
          courseTitle: String(pack.course?.title ?? course.title),
          revisionKey: revision.revision_id,
          revisionNumber: revision.revision_number,
          contentHash: revision.content_hash,
          primaryLocale: String(
            pack.course?.primaryLocale ?? course.primary_locale,
          ),
        });
      }
      for (const snapshot of exportRevisionSnapshots(connection, courseKey)) {
        if (
          revisionSnapshots.length + 1 >
          COURSE_TRANSFER_JSON_LIMITS_V1.maxRevisionSnapshots
        ) {
          throw new ClientError(
            400,
            "Course transfer exceeds the revision snapshot limit",
          );
        }
        revisionSnapshots.push(snapshot);
      }
    }

    const exported = exportLearnerScope(connection.sqlite, courseKeys);
    const learnerScopeCourses =
      packs.length === 0 && revisionSnapshots.length === 0
        ? readPublishedCourseRevisions(connection.sqlite, courseKeys)
        : [];
    if (
      packs.length === 0 &&
      revisionSnapshots.length === 0 &&
      learnerScopeCourses.length === 0
    ) {
      throw new ClientError(
        409,
        "Course has no transferable content revision and no installed published revision to bind learner progress to",
      );
    }
    if (
      packs.length !== 0 ||
      revisionSnapshots.length !== 0 ||
      learnerScopeCourses.length === 0
    ) {
      const closedCourses = new Set([
        ...packs.map((pack) => pack.courseKey),
        ...revisionSnapshots.map((snapshot) => snapshot.courseKey),
      ]);
      for (const courseKey of courseKeys) {
        if (!closedCourses.has(courseKey)) {
          throw new ClientError(
            409,
            `Course ${courseKey} has no transferable content revision; a full transfer envelope must close every selected Course`,
          );
        }
      }
    }
    // In learnerScope mode the envelope carries no content, so the bound
    // installed revision must be the exact revision the learner scope
    // references. Anything else would fail closed on commit; reject at
    // export with a precise diagnostic instead.
    if (learnerScopeCourses.length !== 0) {
      assertLearnerScopeRevisionCoverage(
        connection.sqlite,
        courseKeys,
        learnerScopeCourses,
      );
    }
    const transferMode =
      packs.length === 0 && revisionSnapshots.length === 0
        ? ("learnerScope" as const)
        : ("full" as const);
    // Filesystem/Git evidence is owned by exercise-core. The database only
    // returns exact attempt descriptors below; the orchestrator enriches these
    // asynchronously and inserts verified snapshots before final hashing.
    const attemptDescriptors = listActiveAttemptDescriptors(
      connection.sqlite,
      courseKeys,
    );
    const attemptSnapshots: CourseTransferEnvelope["learnerScope"]["attemptSnapshots"] =
      [];
    const attemptByteCount = 0;
    const revisionSnapshotByteCount = revisionSnapshots.reduce(
      (total, snapshot) =>
        total + transferUtf8ByteLength(snapshot.canonicalJson),
      0,
    );
    if (
      revisionSnapshotByteCount >
      COURSE_TRANSFER_JSON_LIMITS_V1.maxRevisionSnapshotTotalBytes
    ) {
      throw new ClientError(
        400,
        "Course transfer exceeds the revision snapshot byte limit",
      );
    }
    const learnerScope: CourseTransferEnvelope["learnerScope"] = {
      bindings: exported.bindings,
      facts: exported.facts,
      snapshots: exported.snapshots,
      checkpoints: exported.checkpoints,
      sessionRefs: exported.sessionRefs,
      reviewItems: exported.reviewItems,
      learnerCoursePointers: exported.learnerCoursePointers,
      attemptSnapshots,
    };

    const envelope = CourseTransferEnvelopeSchema.parse({
      format: COURSE_TRANSFER_FORMAT,
      formatVersion: COURSE_TRANSFER_FORMAT_VERSION,
      manifest: {
        format: COURSE_TRANSFER_FORMAT,
        formatVersion: COURSE_TRANSFER_FORMAT_VERSION,
        createdAt: nowIso,
        operationId: request.operationId,
        courseKeys,
        includeHistory: true,
        scopeNote: request.scopeNote,
        packCount: packs.length,
        revisionSnapshotCount: revisionSnapshots.length,
        revisionSnapshotByteCount,
        mode: transferMode,
        originatingAppVersion: input.originatingAppVersion,
        learnerScopeCourses,
        factCount: learnerScope.facts.length,
        sessionCount: learnerScope.sessionRefs.length,
        skippedSessionCount: exported.skippedSessionCount,
        attemptSnapshotCount: attemptSnapshots.length,
        attemptByteCount,
        droppedPendingTurnCount: exported.droppedPendingTurnCount,
        excluded: [...COURSE_TRANSFER_EXCLUDED_V1],
      },
      packs,
      revisionSnapshots,
      learnerScope,
    });
    const envelopeJson = JSON.stringify(envelope);
    const envelopeHash = courseTransferBytesHash(
      UTF8_ENCODER.encode(envelopeJson),
    );
    const preview: CourseTransferPreview = {
      courses: previewCourses.slice(
        0,
        COURSE_TRANSFER_JSON_LIMITS_V1.maxCourses,
      ),
      packCount: packs.length,
      revisionSnapshotCount: revisionSnapshots.length,
      mode: transferMode,
      originatingAppVersion: input.originatingAppVersion,
      appVersionMatches: true,
      factCount: learnerScope.facts.length,
      sessionCount: learnerScope.sessionRefs.length,
      skippedSessionCount: exported.skippedSessionCount,
      attemptSnapshotCount: attemptSnapshots.length,
      attemptByteCount,
      droppedPendingTurnCount: exported.droppedPendingTurnCount,
      excluded: [...COURSE_TRANSFER_EXCLUDED_V1],
      conflicts: [],
    };
    return {
      envelopeJson,
      envelopeHash,
      filename: `aptiloop-transfer-${nowIso.replaceAll(/[:.]/gu, "-")}.course-transfer.json`,
      preview,
      attemptDescriptors,
    };
  });
}

/** Fail-closed envelope parse: unknown fields/versions, packs, prohibited scan. */
export function validateCourseTransferBytes(
  bytes: Uint8Array,
): CourseTransferValidation {
  const envelopeHash = courseTransferBytesHash(bytes);
  if (bytes.byteLength > COURSE_TRANSFER_JSON_LIMITS_V1.maxBytes) {
    return {
      valid: false,
      envelope: null,
      preview: null,
      report: transferReport([
        transferDiagnostic(
          "TRANSFER_ENVELOPE_TOO_LARGE",
          "",
          null,
          `Course transfer exceeds ${COURSE_TRANSFER_JSON_LIMITS_V1.maxBytes} bytes`,
        ),
      ]),
      envelopeHash,
    };
  }
  let parsed: unknown;
  try {
    parsed = parseStrictJson(bytes, { limits: TRANSFER_STRICT_LIMITS });
  } catch (error) {
    const message =
      error instanceof StrictJsonError
        ? `Course transfer JSON is not accepted (${error.code})`
        : "Course transfer JSON is not accepted";
    return {
      valid: false,
      envelope: null,
      preview: null,
      report: transferReport([
        transferDiagnostic("TRANSFER_SHAPE_INVALID", "", null, message),
      ]),
      envelopeHash,
    };
  }
  const transferFormatProbe = parsed as {
    format?: unknown;
    formatVersion?: unknown;
  };
  if (
    typeof transferFormatProbe === "object" &&
    transferFormatProbe !== null &&
    transferFormatProbe.format !== COURSE_TRANSFER_FORMAT
  ) {
    return {
      valid: false,
      envelope: null,
      preview: null,
      report: transferReport([
        transferDiagnostic(
          "TRANSFER_FORMAT_UNKNOWN",
          "/format",
          null,
          `Unknown Course transfer format ${JSON.stringify(transferFormatProbe.format)}; update the app to import this file`,
        ),
      ]),
      envelopeHash,
    };
  }
  if (
    typeof transferFormatProbe === "object" &&
    transferFormatProbe !== null &&
    typeof transferFormatProbe.formatVersion === "number" &&
    transferFormatProbe.formatVersion !== COURSE_TRANSFER_FORMAT_VERSION
  ) {
    const older =
      transferFormatProbe.formatVersion < COURSE_TRANSFER_FORMAT_VERSION;
    return {
      valid: false,
      envelope: null,
      preview: null,
      report: transferReport([
        transferDiagnostic(
          older ? "TRANSFER_FORMAT_OLDER" : "TRANSFER_FORMAT_NEWER",
          "/formatVersion",
          null,
          older
            ? `Course transfer format version ${String(transferFormatProbe.formatVersion)} is older than ${String(COURSE_TRANSFER_FORMAT_VERSION)}; re-export from a current version`
            : `Course transfer format version ${String(transferFormatProbe.formatVersion)} is newer than ${String(COURSE_TRANSFER_FORMAT_VERSION)}; update the app to import this file`,
        ),
      ]),
      envelopeHash,
    };
  }
  const envelopeResult = CourseTransferEnvelopeSchema.safeParse(parsed);
  if (!envelopeResult.success) {
    return {
      valid: false,
      envelope: null,
      preview: null,
      report: transferReport(
        envelopeResult.error.issues
          .slice(0, MAX_TRANSFER_DIAGNOSTICS)
          .map((issue) =>
            transferDiagnostic(
              "TRANSFER_SHAPE_INVALID",
              `/${issue.path.map(String).join("/")}`,
              null,
              issue.message.slice(0, 500),
            ),
          ),
      ),
      envelopeHash,
    };
  }
  const envelope = envelopeResult.data;
  const diagnostics: CoursePackDiagnostic[] = [];
  for (const pack of envelope.packs) {
    const packValidation = validateCoursePackBytes(
      UTF8_ENCODER.encode(pack.canonicalJson),
    );
    if (
      !packValidation.valid ||
      packValidation.contentHash !== pack.contentHash ||
      packValidation.pack.course.courseKey !== pack.courseKey ||
      packValidation.pack.revision.revisionKey !== pack.revisionKey ||
      packValidation.pack.revision.revisionNumber !== pack.revisionNumber
    ) {
      const children = packValidation.report.diagnostics.slice(
        0,
        MAX_TRANSFER_DIAGNOSTICS,
      );
      if (children.length > 0) {
        for (const child of children) {
          diagnostics.push(
            transferDiagnostic(
              child.code,
              `/packs/${pack.revisionKey}${child.path}`,
              child.entityId ?? pack.revisionKey,
              child.message,
            ),
          );
        }
      } else {
        diagnostics.push(
          transferDiagnostic(
            "TRANSFER_PACK_INVALID",
            `/packs/${pack.revisionKey}`,
            pack.revisionKey,
            `Transfer pack ${pack.revisionKey} did not pass Course Pack identity comparison`,
          ),
        );
      }
    }
  }
  for (const snapshot of envelope.revisionSnapshots) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(snapshot.canonicalJson) as unknown;
    } catch {
      diagnostics.push(
        transferDiagnostic(
          "TRANSFER_REVISION_INVALID",
          `/revisionSnapshots/${snapshot.revisionKey}`,
          snapshot.revisionKey,
          `Transfer revision snapshot ${snapshot.revisionKey} is not valid JSON`,
        ),
      );
      continue;
    }
    const observed = `sha256:${createHash("sha256").update(snapshot.canonicalJson).digest("hex")}`;
    if (observed !== snapshot.snapshotHash) {
      diagnostics.push(
        transferDiagnostic(
          "TRANSFER_REVISION_INVALID",
          `/revisionSnapshots/${snapshot.revisionKey}/snapshotHash`,
          snapshot.revisionKey,
          `Transfer revision snapshot ${snapshot.revisionKey} snapshot hash does not match`,
        ),
      );
    }
    const canonicalResult =
      CourseTransferRevisionSnapshotCanonicalSchema.safeParse(parsed);
    if (!canonicalResult.success) {
      diagnostics.push(
        transferDiagnostic(
          "TRANSFER_REVISION_INVALID",
          `/revisionSnapshots/${snapshot.revisionKey}/canonicalJson`,
          snapshot.revisionKey,
          `Transfer revision snapshot ${snapshot.revisionKey} has invalid canonical structure`,
        ),
      );
      continue;
    }
    const record: CourseTransferRevisionSnapshotCanonical =
      canonicalResult.data;
    if (canonicalJson(record) !== snapshot.canonicalJson) {
      diagnostics.push(
        transferDiagnostic(
          "TRANSFER_REVISION_INVALID",
          `/revisionSnapshots/${snapshot.revisionKey}/canonicalJson`,
          snapshot.revisionKey,
          `Transfer revision snapshot ${snapshot.revisionKey} is not canonical JSON`,
        ),
      );
    }
    if (
      record.courseKey !== snapshot.courseKey ||
      record.revisionKey !== snapshot.revisionKey ||
      record.revisionNumber !== snapshot.revisionNumber ||
      record.parentRevisionKey !== snapshot.parentRevisionKey ||
      record.branchKind !== snapshot.branchKind ||
      record.revisionContentHash !== snapshot.revisionContentHash
    ) {
      diagnostics.push(
        transferDiagnostic(
          "TRANSFER_REVISION_INVALID",
          `/revisionSnapshots/${snapshot.revisionKey}`,
          snapshot.revisionKey,
          `Transfer revision snapshot ${snapshot.revisionKey} identity or immutable hash does not match`,
        ),
      );
    }
    for (const message of validateRevisionSnapshotReferences(record)) {
      diagnostics.push(
        transferDiagnostic(
          "TRANSFER_REVISION_DEPENDENCY",
          `/revisionSnapshots/${snapshot.revisionKey}`,
          snapshot.revisionKey,
          message,
        ),
      );
    }
    if (snapshot.parentRevisionKey !== null) {
      const inEnvelope =
        envelope.packs.some(
          (pack) =>
            pack.courseKey === snapshot.courseKey &&
            pack.revisionKey === snapshot.parentRevisionKey,
        ) ||
        envelope.revisionSnapshots.some(
          (candidate) =>
            candidate.courseKey === snapshot.courseKey &&
            candidate.revisionKey === snapshot.parentRevisionKey,
        );
      if (!inEnvelope) {
        diagnostics.push(
          transferDiagnostic(
            "TRANSFER_REVISION_DEPENDENCY",
            `/revisionSnapshots/${snapshot.revisionKey}`,
            snapshot.revisionKey,
            `Transfer revision snapshot ${snapshot.revisionKey} parent is not closed by the envelope`,
          ),
        );
      }
    }
    for (const signal of findCourseTransferProhibitedSignals(record)) {
      diagnostics.push(
        transferDiagnostic(
          "TRANSFER_PROHIBITED_CONTENT",
          `/revisionSnapshots/${snapshot.revisionKey}${signal.path}`,
          snapshot.revisionKey,
          signal.detail,
          "transfer-scope-policy",
        ),
      );
    }
  }
  let attemptBytes = 0;
  for (const [
    attemptIndex,
    attempt,
  ] of envelope.learnerScope.attemptSnapshots.entries()) {
    let decodedTotal = transferUtf8ByteLength(attempt.workingTreeDiff);
    const observedDiffHash = `sha256:${createHash("sha256").update(attempt.workingTreeDiff).digest("hex")}`;
    if (observedDiffHash !== attempt.diffHash) {
      diagnostics.push(
        transferDiagnostic(
          "TRANSFER_ATTEMPT_INVALID",
          `/learnerScope/attemptSnapshots/${attemptIndex}`,
          attempt.attemptId,
          `Transfer attempt ${attempt.attemptId} diff hash does not match`,
        ),
      );
    }
    let expectedParent = attempt.baselineCommit;
    const commitIds = new Set<string>();
    for (const [commitIndex, commit] of attempt.learnerCommits.entries()) {
      const patchBytes = transferUtf8ByteLength(commit.patch);
      decodedTotal += patchBytes;
      const commitPath = `/learnerScope/attemptSnapshots/${attemptIndex}/learnerCommits/${commitIndex}`;
      if (patchBytes > COURSE_TRANSFER_JSON_LIMITS_V1.maxAttemptDiffBytes) {
        diagnostics.push(
          transferDiagnostic(
            "TRANSFER_ATTEMPT_INVALID",
            `${commitPath}/patch`,
            attempt.attemptId,
            `Transfer learner commit ${commit.sourceCommit} patch exceeds its byte budget`,
          ),
        );
      }
      const observedPatchHash = `sha256:${createHash("sha256").update(commit.patch).digest("hex")}`;
      if (observedPatchHash !== commit.patchHash) {
        diagnostics.push(
          transferDiagnostic(
            "TRANSFER_ATTEMPT_INVALID",
            commitPath,
            attempt.attemptId,
            `Transfer learner commit ${commit.sourceCommit} patch hash does not match`,
          ),
        );
      }
      if (
        commit.parentCommit !== expectedParent ||
        commitIds.has(commit.sourceCommit)
      ) {
        diagnostics.push(
          transferDiagnostic(
            "TRANSFER_ATTEMPT_INVALID",
            commitPath,
            attempt.attemptId,
            `Transfer learner commit ${commit.sourceCommit} ancestry is not a unique linear chain from baseline`,
          ),
        );
      }
      commitIds.add(commit.sourceCommit);
      expectedParent = commit.sourceCommit;
    }
    for (const [blobIndex, blob] of attempt.untrackedBlobs.entries()) {
      let decoded: Buffer;
      try {
        decoded = Buffer.from(blob.contentBase64, "base64");
      } catch {
        diagnostics.push(
          transferDiagnostic(
            "TRANSFER_ATTEMPT_INVALID",
            `/learnerScope/attemptSnapshots/${attemptIndex}/untrackedBlobs/${blobIndex}`,
            attempt.attemptId,
            `Transfer attempt ${attempt.attemptId} blob is not valid base64`,
          ),
        );
        continue;
      }
      if (decoded.length !== blob.sizeBytes) {
        diagnostics.push(
          transferDiagnostic(
            "TRANSFER_ATTEMPT_INVALID",
            `/learnerScope/attemptSnapshots/${attemptIndex}/untrackedBlobs/${blobIndex}`,
            attempt.attemptId,
            `Transfer attempt ${attempt.attemptId} blob size does not match decoded bytes`,
          ),
        );
      }
      const observedBlobHash = `sha256:${createHash("sha256").update(decoded).digest("hex")}`;
      if (observedBlobHash !== blob.sha256) {
        diagnostics.push(
          transferDiagnostic(
            "TRANSFER_ATTEMPT_INVALID",
            `/learnerScope/attemptSnapshots/${attemptIndex}/untrackedBlobs/${blobIndex}`,
            attempt.attemptId,
            `Transfer attempt ${attempt.attemptId} blob hash does not match`,
          ),
        );
      }
      decodedTotal += decoded.length;
    }
    attemptBytes += decodedTotal;
  }
  if (attemptBytes !== envelope.manifest.attemptByteCount) {
    diagnostics.push(
      transferDiagnostic(
        "TRANSFER_ATTEMPT_INVALID",
        "/manifest/attemptByteCount",
        null,
        "Transfer manifest attempt byte count does not match decoded evidence",
      ),
    );
  }
  for (const signal of findCourseTransferProhibitedSignals(
    withoutInlineBlobs(envelope),
  )) {
    diagnostics.push(
      transferDiagnostic(
        "TRANSFER_PROHIBITED_CONTENT",
        signal.path,
        null,
        signal.detail,
        "transfer-scope-policy",
      ),
    );
  }
  for (const pack of envelope.packs) {
    for (const signal of findCourseTransferProhibitedSignals(
      JSON.parse(pack.canonicalJson) as unknown,
    )) {
      diagnostics.push(
        transferDiagnostic(
          "TRANSFER_PROHIBITED_CONTENT",
          `/packs/${pack.revisionKey}${signal.path}`,
          pack.revisionKey,
          signal.detail,
          "transfer-scope-policy",
        ),
      );
    }
  }
  diagnostics.push(...collectTransferFactDiagnostics(envelope));
  if (diagnostics.length > 0) {
    return {
      valid: false,
      envelope: null,
      preview: null,
      report: transferReport(diagnostics),
      envelopeHash,
    };
  }
  return {
    valid: true,
    envelope,
    preview: previewEnvelope(envelope),
    report: transferReport([]),
    envelopeHash,
  };
}

/** Preview conflicts of a valid envelope against live storage. */
export function previewCourseTransferConflicts(
  connection: DatabaseConnection,
  envelope: CourseTransferEnvelope,
): CourseTransferConflict[] {
  const conflicts: CourseTransferConflict[] = [];
  const byCourse = new Map<string, typeof envelope.packs>();
  for (const pack of envelope.packs) {
    const entries = byCourse.get(pack.courseKey) ?? [];
    entries.push(pack);
    byCourse.set(pack.courseKey, entries);
  }
  for (const [courseKey, packs] of byCourse) {
    const rows = connection.sqlite
      .prepare(
        `SELECT revision.id AS revision_id, revision.revision_number,
                manifest.content_hash
         FROM course_revisions revision
         LEFT JOIN course_pack_manifests manifest
           ON manifest.revision_id = revision.id
         WHERE revision.course_id = ?
         ORDER BY revision.revision_number`,
      )
      .all(courseKey) as Array<{
      revision_id: string;
      revision_number: number;
      content_hash: string | null;
    }>;
    if (rows.length === 0) continue;
    const maxRevision = Math.max(...rows.map((row) => row.revision_number));
    for (const pack of packs) {
      const existing = rows.find((row) => row.revision_id === pack.revisionKey);
      if (existing) {
        if (existing.content_hash !== pack.contentHash) {
          conflicts.push({
            code: "already-installed",
            courseKey,
            revisionKey: pack.revisionKey,
            reason: `Revision ${pack.revisionKey} is already bound to different content`,
          });
        }
        continue;
      }
      if (pack.revisionNumber > maxRevision) {
        conflicts.push({
          code: "new-revision-available",
          courseKey,
          revisionKey: pack.revisionKey,
          reason: `Course ${courseKey} has an upgrade path to revision ${pack.revisionNumber}`,
        });
      }
    }
  }
  return conflicts.map((conflict) =>
    CourseTransferConflictSchema.parse(conflict),
  );
}

/**
 * Transactional, idempotent-by-operationId transfer commit. Installs packs in
 * revision order, restores session shells + snapshots + contexts, replays
 * kernel facts (hash-verified, INSERT OR IGNORE), then recomputes every
 * checkpoint projection from replayed facts: a divergence quarantines the
 * envelope and rolls everything back. Review items/mistakes are projections
 * and rebuild from facts on read; no projection snapshot is ever trusted.
 */
export function commitCourseTransfer(
  connection: DatabaseConnection,
  coursePacks: CoursePackRepository,
  input: CourseTransferCommitInput,
): CourseTransferCommitResult {
  if (input.expectedEnvelopeHash !== input.envelopeHash) {
    throw new ClientError(
      409,
      "Course transfer confirmation hash does not match validation",
    );
  }
  const envelope = CourseTransferEnvelopeSchema.parse(input.envelope);
  validateIncomingTransferRevisionHashes(envelope, input.envelopeHash);
  return withTransaction(connection, () => {
    if (
      transferCommitComplete(connection.sqlite, input.operationId, envelope)
    ) {
      return transferCommitResult(connection.sqlite, envelope, true);
    }
    if (envelope.manifest.mode === "learnerScope") {
      verifyLearnerScopeInstalledRevisions(connection.sqlite, envelope);
    }
    const restoredRevisionSnapshots = restoreRevisionSnapshots(
      connection,
      envelope,
    );
    const orderedPacks = [...envelope.packs].sort(
      (left, right) =>
        left.revisionNumber - right.revisionNumber ||
        (left.revisionKey < right.revisionKey ? -1 : 1),
    );
    let installedPacks = 0;
    for (const entry of orderedPacks) {
      const packBytes = UTF8_ENCODER.encode(entry.canonicalJson);
      const packValidation = validateCoursePackBytes(packBytes);
      if (
        !packValidation.valid ||
        packValidation.contentHash !== entry.contentHash
      ) {
        throw new CourseTransferInvalidError(
          transferReport([
            transferDiagnostic(
              "TRANSFER_PACK_INVALID",
              `/packs/${entry.revisionKey}`,
              entry.revisionKey,
              `Transfer pack ${entry.revisionKey} did not pass Course Pack validation`,
            ),
          ]),
          input.envelopeHash,
        );
      }
      const installed = coursePacks.install({
        operationId: `${input.operationId}:pack:${entry.revisionKey}`,
        validationId: `${input.operationId}:validation`,
        action: "install",
        sourceBytesHash: coursePackSourceBytesHash(packBytes),
        pack: packValidation.pack,
        canonicalJson: packValidation.canonicalJson,
        report: packValidation.report,
      });
      if (installed.installed) installedPacks += 1;
    }
    restoreTransferSessions(connection.sqlite, envelope);
    const replayedFacts = replayTransferFacts(connection.sqlite, envelope);
    verifyTransferCheckpoints(connection.sqlite, envelope);
    return transferCommitResult(
      connection.sqlite,
      envelope,
      installedPacks === 0 &&
        restoredRevisionSnapshots === 0 &&
        replayedFacts === 0,
      { installedPacks, restoredRevisionSnapshots, replayedFacts },
    );
  });
}

export function courseTransferBytesHash(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function transferCommitComplete(
  sqlite: DatabaseSync,
  operationId: string,
  envelope: CourseTransferEnvelope,
): boolean {
  if (envelope.manifest.mode === "learnerScope") {
    // Idempotent replay of a learnerScope-only envelope still requires the
    // exact installed revision match; a mismatched target is never complete.
    if (!learnerScopeInstalledRevisionsMatch(sqlite, envelope)) return false;
  }
  for (const pack of envelope.packs) {
    const manifest = sqlite
      .prepare(
        `SELECT content_hash FROM course_pack_manifests WHERE revision_id = ?`,
      )
      .get(pack.revisionKey) as { content_hash: string } | undefined;
    if (!manifest || manifest.content_hash !== pack.contentHash) return false;
    const subOperation = sqlite
      .prepare(
        `SELECT 1 FROM course_pack_lifecycle_events WHERE operation_id = ?`,
      )
      .get(`${operationId}:pack:${pack.revisionKey}`);
    if (!subOperation) return false;
  }
  for (const snapshot of envelope.revisionSnapshots) {
    const revision = sqlite
      .prepare(
        `SELECT course_id, content_hash FROM course_revisions WHERE id = ?`,
      )
      .get(snapshot.revisionKey) as
      { course_id: string; content_hash: string | null } | undefined;
    const source = sqlite
      .prepare(
        `SELECT curriculum_id, content_hash FROM curriculum_versions WHERE id = ?`,
      )
      .get(snapshot.revisionKey) as
      { curriculum_id: string; content_hash: string | null } | undefined;
    if (
      revision === undefined ||
      revision.course_id !== snapshot.courseKey ||
      revision.content_hash !== snapshot.revisionContentHash ||
      source === undefined ||
      source.curriculum_id !== snapshot.courseKey ||
      source.content_hash !== snapshot.revisionContentHash
    ) {
      return false;
    }
  }
  for (const ref of envelope.learnerScope.sessionRefs) {
    const session = sqlite
      .prepare(`SELECT status FROM learning_sessions WHERE id = ?`)
      .get(ref.sessionId) as { status: string } | undefined;
    const context = sqlite
      .prepare(
        `SELECT course_id, revision_id, lesson_id, adaptation_branch_id,
                snapshot_hash, snapshot_bytes_hash
         FROM session_course_contexts WHERE session_id = ?`,
      )
      .get(ref.sessionId) as
      | {
          course_id: string;
          revision_id: string;
          lesson_id: string;
          adaptation_branch_id: string | null;
          snapshot_hash: string;
          snapshot_bytes_hash: string | null;
        }
      | undefined;
    const snapshot = envelope.learnerScope.snapshots.find(
      (candidate) => candidate.sessionId === ref.sessionId,
    );
    if (
      session === undefined ||
      session.status !== ref.status ||
      context === undefined ||
      snapshot === undefined ||
      context.course_id !== ref.courseId ||
      context.revision_id !== ref.revisionId ||
      context.lesson_id !== ref.lessonId ||
      context.adaptation_branch_id !== ref.branchId ||
      context.snapshot_hash !== snapshot.snapshotHash ||
      context.snapshot_bytes_hash !==
        snapshot.snapshotBytesHash.slice("sha256:".length)
    ) {
      return false;
    }
  }
  for (const fact of envelope.learnerScope.facts) {
    const row = sqlite
      .prepare(
        `SELECT canonical_json, fact_hash FROM learning_kernel_facts WHERE id = ?`,
      )
      .get(fact.id) as
      { canonical_json: string; fact_hash: string } | undefined;
    if (
      row === undefined ||
      row.canonical_json !== fact.canonicalJson ||
      row.fact_hash !== fact.factHash
    ) {
      return false;
    }
  }
  return true;
}

/**
 * learnerScope-only commit gate (ADR 0012 decision 1): the target must
 * already hold the exact bound Course revision (course/revision identity
 * plus revision content hash) before any learner state is restored.
 */
function learnerScopeInstalledRevisionsMatch(
  sqlite: DatabaseSync,
  envelope: CourseTransferEnvelope,
): boolean {
  for (const course of envelope.manifest.learnerScopeCourses) {
    const row = sqlite
      .prepare(
        `SELECT content_hash FROM curriculum_versions
          WHERE id = ? AND curriculum_id = ? AND status = 'published'`,
      )
      .get(course.revisionKey, course.courseKey) as
      { content_hash: string | null } | undefined;
    if (
      row === undefined ||
      row.content_hash !== course.revisionContentHash.slice("sha256:".length)
    ) {
      return false;
    }
  }
  return true;
}

function verifyLearnerScopeInstalledRevisions(
  sqlite: DatabaseSync,
  envelope: CourseTransferEnvelope,
): void {
  for (const [
    index,
    course,
  ] of envelope.manifest.learnerScopeCourses.entries()) {
    const row = sqlite
      .prepare(
        `SELECT content_hash FROM curriculum_versions
          WHERE id = ? AND curriculum_id = ? AND status = 'published'`,
      )
      .get(course.revisionKey, course.courseKey) as
      { content_hash: string | null } | undefined;
    if (row === undefined) {
      throw transferInvalid(
        "TRANSFER_INSTALLED_REVISION_UNRESOLVED",
        `/manifest/learnerScopeCourses/${index}`,
        course.revisionKey,
        `Target does not hold the installed revision ${course.revisionKey} required by this learnerScope-only transfer; import the Course content first`,
        envelope,
      );
    }
    if (
      row.content_hash !== course.revisionContentHash.slice("sha256:".length)
    ) {
      throw transferInvalid(
        "TRANSFER_INSTALLED_REVISION_UNRESOLVED",
        `/manifest/learnerScopeCourses/${index}/revisionContentHash`,
        course.revisionKey,
        `Installed revision ${course.revisionKey} is bound to different content than the exported learner scope`,
        envelope,
      );
    }
  }
}

function transferCommitResult(
  sqlite: DatabaseSync,
  envelope: CourseTransferEnvelope,
  idempotent: boolean,
  counts?: {
    installedPacks: number;
    replayedFacts: number;
    restoredRevisionSnapshots?: number;
    restoredAttempts?: number;
  },
): CourseTransferCommitResult {
  void sqlite;
  const courses = previewEnvelope(envelope).courses;
  return {
    installedPacks: counts?.installedPacks ?? 0,
    restoredRevisionSnapshots: counts?.restoredRevisionSnapshots ?? 0,
    replayedFacts: counts?.replayedFacts ?? 0,
    restoredSessions: envelope.learnerScope.sessionRefs.length,
    restoredAttempts: counts?.restoredAttempts ?? 0,
    droppedPendingTurns: envelope.manifest.droppedPendingTurnCount,
    idempotent,
    courses,
  };
}

function restoreTransferSessions(
  sqlite: DatabaseSync,
  envelope: CourseTransferEnvelope,
): number {
  ensureKernelSessionStubDay(sqlite, Date.now());
  const bySession = new Map(
    envelope.learnerScope.snapshots.map((snapshot) => [
      snapshot.sessionId,
      snapshot,
    ]),
  );
  let restored = 0;
  for (const ref of envelope.learnerScope.sessionRefs) {
    const snapshot = bySession.get(ref.sessionId);
    if (!snapshot) {
      throw new CourseTransferInvalidError(
        transferReport([
          transferDiagnostic(
            "TRANSFER_SESSION_UNRESOLVED",
            `/learnerScope/sessionRefs/${ref.sessionId}`,
            ref.sessionId,
            `Transfer session ${ref.sessionId} has no snapshot`,
          ),
        ]),
        courseTransferBytesHash(UTF8_ENCODER.encode(JSON.stringify(envelope))),
      );
    }
    if (
      snapshot.courseId !== ref.courseId ||
      snapshot.revisionId !== ref.revisionId ||
      snapshot.lessonId !== ref.lessonId ||
      snapshot.branchId !== ref.branchId ||
      snapshot.sessionStatus !== ref.status
    ) {
      throw new CourseTransferInvalidError(
        transferReport([
          transferDiagnostic(
            "TRANSFER_SESSION_UNRESOLVED",
            `/learnerScope/sessionRefs/${ref.sessionId}`,
            ref.sessionId,
            `Transfer session ${ref.sessionId} is not a restorable completed session`,
          ),
        ]),
        courseTransferBytesHash(UTF8_ENCODER.encode(JSON.stringify(envelope))),
      );
    }
    if (
      courseTransferBytesHash(UTF8_ENCODER.encode(snapshot.snapshotJson)) !==
      snapshot.snapshotBytesHash
    ) {
      throw transferInvalid(
        "TRANSFER_SESSION_UNRESOLVED",
        `/learnerScope/snapshots/${snapshot.snapshotId}`,
        snapshot.snapshotId,
        `Transfer session snapshot ${snapshot.snapshotId} bytes hash does not match`,
        envelope,
      );
    }
    ensureTransferBranch(sqlite, {
      courseId: ref.courseId,
      branchId: ref.branchId,
      baseRevisionId: ref.revisionId,
    });
    const existing = sqlite
      .prepare(
        `SELECT id, status, current_step, started_at, completed_at,
                day_id, curriculum_day_v2_id
         FROM learning_sessions WHERE id = ?`,
      )
      .get(ref.sessionId) as
      | {
          id: string;
          status: string;
          current_step: string;
          started_at: number;
          completed_at: number | null;
          day_id: string;
          curriculum_day_v2_id: string | null;
        }
      | undefined;
    if (existing) {
      if (
        existing.status !== ref.status ||
        existing.current_step !== snapshot.currentStep ||
        existing.started_at !== Date.parse(snapshot.startedAt) ||
        existing.completed_at !==
          (snapshot.completedAt === null
            ? null
            : Date.parse(snapshot.completedAt)) ||
        existing.curriculum_day_v2_id !== snapshot.dayId
      ) {
        throw transferInvalid(
          "TRANSFER_SESSION_UNRESOLVED",
          `/learnerScope/sessionRefs/${ref.sessionId}`,
          ref.sessionId,
          `Transfer session ${ref.sessionId} collides with local data`,
          envelope,
        );
      }
    } else {
      sqlite
        .prepare(
          `INSERT INTO learning_sessions
           (id, day_id, status, current_step, idempotency_key, started_at,
            completed_at, updated_at, curriculum_day_v2_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          ref.sessionId,
          KERNEL_RESTORE_STUB_DAY_ID,
          ref.status,
          snapshot.currentStep,
          `transfer:${snapshot.sessionId}`,
          Date.parse(snapshot.startedAt),
          snapshot.completedAt === null
            ? null
            : Date.parse(snapshot.completedAt),
          Date.parse(snapshot.createdAt),
          snapshot.dayId,
        );
      restored += 1;
    }
    const existingSnapshot = sqlite
      .prepare(
        `SELECT session_id, schema_version, curriculum_id, curriculum_version_id,
                curriculum_day_id, content_hash, snapshot_json, created_at
         FROM session_snapshots WHERE id = ?`,
      )
      .get(snapshot.snapshotId) as
      | {
          session_id: string;
          schema_version: number;
          curriculum_id: string;
          curriculum_version_id: string | null;
          curriculum_day_id: string | null;
          content_hash: string;
          snapshot_json: string;
          created_at: number;
        }
      | undefined;
    if (existingSnapshot) {
      if (
        existingSnapshot.session_id !== ref.sessionId ||
        existingSnapshot.schema_version !== snapshot.schemaVersion ||
        existingSnapshot.curriculum_id !== ref.courseId ||
        existingSnapshot.curriculum_version_id !== ref.revisionId ||
        existingSnapshot.curriculum_day_id !== snapshot.dayId ||
        existingSnapshot.content_hash !== snapshot.contentHash ||
        existingSnapshot.snapshot_json !== snapshot.snapshotJson ||
        existingSnapshot.created_at !== Date.parse(snapshot.createdAt)
      ) {
        throw transferInvalid(
          "TRANSFER_SESSION_UNRESOLVED",
          `/learnerScope/snapshots/${snapshot.snapshotId}`,
          snapshot.snapshotId,
          `Transfer snapshot ${snapshot.snapshotId} collides with local data`,
          envelope,
        );
      }
    } else {
      sqlite
        .prepare(
          `INSERT INTO session_snapshots
           (id, session_id, schema_version, curriculum_id, curriculum_version_id,
            curriculum_day_id, content_hash, snapshot_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          snapshot.snapshotId,
          ref.sessionId,
          snapshot.schemaVersion,
          ref.courseId,
          ref.revisionId,
          snapshot.dayId,
          snapshot.contentHash,
          snapshot.snapshotJson,
          Date.parse(snapshot.createdAt),
        );
    }
    const context = sqlite
      .prepare(
        `SELECT course_id, revision_id, lesson_id, session_snapshot_id,
                snapshot_hash, snapshot_bytes_hash, adaptation_branch_id
         FROM session_course_contexts WHERE session_id = ?`,
      )
      .get(ref.sessionId) as
      | {
          course_id: string;
          revision_id: string;
          lesson_id: string;
          session_snapshot_id: string;
          snapshot_hash: string;
          snapshot_bytes_hash: string | null;
          adaptation_branch_id: string | null;
        }
      | undefined;
    if (context) {
      if (
        context.course_id !== ref.courseId ||
        context.revision_id !== ref.revisionId ||
        context.lesson_id !== ref.lessonId ||
        context.session_snapshot_id !== snapshot.snapshotId ||
        context.adaptation_branch_id !== ref.branchId ||
        context.snapshot_hash !== snapshot.snapshotHash ||
        context.snapshot_bytes_hash !==
          snapshot.snapshotBytesHash.slice("sha256:".length)
      ) {
        throw new CourseTransferInvalidError(
          transferReport([
            transferDiagnostic(
              "TRANSFER_SESSION_UNRESOLVED",
              `/learnerScope/sessionRefs/${ref.sessionId}`,
              ref.sessionId,
              `Transfer session ${ref.sessionId} collides with local data`,
            ),
          ]),
          courseTransferBytesHash(
            UTF8_ENCODER.encode(JSON.stringify(envelope)),
          ),
        );
      }
    } else {
      sqlite
        .prepare(
          `INSERT INTO session_course_contexts
           (session_id, course_id, revision_id, lesson_id, session_snapshot_id,
            snapshot_hash, snapshot_bytes_hash, created_at, adaptation_branch_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          ref.sessionId,
          ref.courseId,
          ref.revisionId,
          ref.lessonId,
          snapshot.snapshotId,
          snapshot.snapshotHash,
          snapshot.snapshotBytesHash.slice("sha256:".length),
          Date.parse(snapshot.createdAt),
          ref.branchId,
        );
    }
  }
  return restored;
}
function restoreRevisionSnapshots(
  connection: DatabaseConnection,
  envelope: CourseTransferEnvelope,
): number {
  const sqlite = connection.sqlite;
  const ordered = [...envelope.revisionSnapshots].sort(
    (left, right) =>
      left.courseKey.localeCompare(right.courseKey) ||
      left.revisionNumber - right.revisionNumber ||
      left.revisionKey.localeCompare(right.revisionKey),
  );
  let restored = 0;
  for (const entry of ordered) {
    const record = CourseTransferRevisionSnapshotCanonicalSchema.parse(
      JSON.parse(entry.canonicalJson),
    );
    if (record.revisionContentHash !== entry.revisionContentHash) {
      throw transferInvalid(
        "TRANSFER_REVISION_INVALID",
        `/revisionSnapshots/${entry.revisionKey}`,
        entry.revisionKey,
        "Revision content hash does not match the canonical snapshot",
        envelope,
      );
    }
    const authoredGraph =
      record.authoredGraph as unknown as CurriculumVersionGraph;
    if (
      authoredGraph.version.id !== record.revisionKey ||
      authoredGraph.version.curriculumId !== record.course.id ||
      authoredGraph.primaryLocale !== record.course.primary_locale ||
      authoredGraph.version.revision !== record.revisionNumber ||
      authoredGraph.version.parentVersionId !== record.parentRevisionKey ||
      authoredGraph.version.title !== record.title ||
      authoredGraph.version.description !== record.description
    ) {
      throw transferInvalid(
        "TRANSFER_REVISION_INVALID",
        `/revisionSnapshots/${entry.revisionKey}/authoredGraph`,
        entry.revisionKey,
        "Authored graph metadata does not match its revision snapshot",
        envelope,
      );
    }
    const calculatedContentHash = `sha256:${hashCanonicalJson(
      publicationContent(authoredGraph),
    )}`;
    if (calculatedContentHash !== record.revisionContentHash) {
      throw transferInvalid(
        "TRANSFER_REVISION_INVALID",
        `/revisionSnapshots/${entry.revisionKey}/revisionContentHash`,
        entry.revisionKey,
        "Revision content hash does not match the incoming authored graph",
        envelope,
      );
    }
    const sourceRevision = sqlite
      .prepare(
        `SELECT id, status, content_hash
           FROM curriculum_versions
          WHERE id = ? AND curriculum_id = ?`,
      )
      .get(record.revisionKey, record.courseKey) as
      { id: string; status: string; content_hash: string | null } | undefined;
    let sourceDraftInserted = false;
    if (sourceRevision !== undefined) {
      const existingGraph = loadVersionGraph(connection, record.revisionKey);
      if (
        canonicalJson(existingGraph) !== canonicalJson(authoredGraph) ||
        sourceRevision.content_hash !== record.revisionContentHash
      ) {
        throw transferInvalid(
          "TRANSFER_REVISION_INVALID",
          `/revisionSnapshots/${entry.revisionKey}/authoredGraph`,
          entry.revisionKey,
          "Incoming authored graph collides with local immutable source data",
          envelope,
        );
      }
    }
    const course = sqlite
      .prepare(
        `SELECT id, stable_id, slug, title, description, primary_locale,
                active_revision_id, created_at, updated_at
         FROM courses WHERE id = ?`,
      )
      .get(record.course.id) as
      | {
          id: string;
          stable_id: string;
          slug: string;
          title: string;
          description: string | null;
          primary_locale: string;
          active_revision_id: string | null;
          created_at: number;
          updated_at: number;
        }
      | undefined;
    if (course) {
      if (
        course.stable_id !== record.course.stable_id ||
        course.slug !== record.course.slug ||
        course.title !== record.course.title ||
        course.description !== record.course.description ||
        course.primary_locale !== record.course.primary_locale
      ) {
        throw transferInvalid(
          "TRANSFER_REVISION_INVALID",
          `/revisionSnapshots/${entry.revisionKey}/course`,
          entry.revisionKey,
          "Transfer course collides with local immutable metadata",
          envelope,
        );
      }
    } else if (
      sqlite
        .prepare("SELECT 1 FROM curricula WHERE id = ?")
        .get(record.course.id) !== undefined
    ) {
      sqlite
        .prepare(
          `INSERT INTO courses
           (id, stable_id, slug, title, description, primary_locale,
            active_revision_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
        )
        .run(
          record.course.id,
          record.course.stable_id,
          record.course.slug,
          record.course.title,
          record.course.description,
          record.course.primary_locale,
          record.course.created_at,
          record.course.updated_at,
        );
    }
    const curriculum = sqlite
      .prepare("SELECT slug, title, description FROM curricula WHERE id = ?")
      .get(record.course.id) as
      { slug: string; title: string; description: string | null } | undefined;
    if (curriculum === undefined) {
      sqlite
        .prepare(
          `INSERT INTO curricula
           (id, slug, title, description, active_version_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, NULL, ?, ?)`,
        )
        .run(
          record.course.id,
          record.course.slug,
          record.course.title,
          record.course.description,
          record.course.created_at,
          record.course.updated_at,
        );
    } else if (
      curriculum.slug !== record.course.slug ||
      curriculum.title !== record.course.title ||
      curriculum.description !== record.course.description
    ) {
      throw transferInvalid(
        "TRANSFER_REVISION_INVALID",
        `/revisionSnapshots/${entry.revisionKey}/course`,
        entry.revisionKey,
        "Transfer curriculum collides with local immutable metadata",
        envelope,
      );
    }
    if (
      sqlite
        .prepare("SELECT 1 FROM courses WHERE id = ?")
        .get(record.course.id) === undefined
    ) {
      sqlite
        .prepare(
          `INSERT INTO courses
         (id, stable_id, slug, title, description, primary_locale,
          active_revision_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
        )
        .run(
          record.course.id,
          record.course.stable_id,
          record.course.slug,
          record.course.title,
          record.course.description,
          record.course.primary_locale,
          record.course.created_at,
          record.course.updated_at,
        );
    }
    if (!course) {
      sqlite
        .prepare("UPDATE courses SET primary_locale = ? WHERE id = ?")
        .run(record.course.primary_locale, record.course.id);
      const importedCourse = sqlite
        .prepare("SELECT primary_locale FROM courses WHERE id = ?")
        .get(record.course.id) as { primary_locale: string } | undefined;
      if (importedCourse?.primary_locale !== record.course.primary_locale) {
        throw new Error(
          "Imported Course locale projection is missing or mismatched",
        );
      }
    }
    if (sourceRevision === undefined) {
      restoreDraftGraphWithIds(connection, authoredGraph);
      if (
        sqlite
          .prepare("SELECT 1 FROM course_revisions WHERE id = ?")
          .get(record.revisionKey) === undefined
      ) {
        sqlite
          .prepare(
            `INSERT INTO course_revisions
           (id, course_id, revision_number, parent_revision_id, branch_kind, status,
            title, description, content_hash, based_on_content_hash, created_at,
            published_at, archived_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, NULL, ?, ?, NULL, NULL, ?)`,
          )
          .run(
            record.revisionKey,
            record.courseKey,
            record.revisionNumber,
            record.parentRevisionKey,
            record.branchKind,
            record.title,
            record.description,
            record.basedOnContentHash,
            record.createdAt,
            record.updatedAt,
          );
      }
      sourceDraftInserted = true;
    }
    const publishImportedGraph = (): void => {
      publishDraftCurriculumVersionWithinTransaction(connection, {
        versionId: record.revisionKey,
        publishedAt: record.publishedAt ?? record.updatedAt,
        expectedContentHash: record.revisionContentHash,
        courseUpdatedAt: record.updatedAt,
      });
      if (record.status === "archived") {
        sqlite
          .prepare(
            `UPDATE curriculum_versions
             SET status = 'archived', archived_at = ?, updated_at = ?
             WHERE id = ?`,
          )
          .run(
            record.archivedAt ?? record.updatedAt,
            record.updatedAt,
            record.revisionKey,
          );
        sqlite
          .prepare(
            `UPDATE course_revisions
             SET status = 'archived', archived_at = ?, updated_at = ?
             WHERE id = ?`,
          )
          .run(
            record.archivedAt ?? record.updatedAt,
            record.updatedAt,
            record.revisionKey,
          );
      }
    };
    const parentExists =
      record.parentRevisionKey === null ||
      sqlite
        .prepare("SELECT 1 FROM course_revisions WHERE id = ?")
        .get(record.parentRevisionKey) !== undefined;
    if (!parentExists) {
      throw transferInvalid(
        "TRANSFER_REVISION_DEPENDENCY",
        `/revisionSnapshots/${entry.revisionKey}/parentRevisionKey`,
        entry.revisionKey,
        `Parent revision ${record.parentRevisionKey} is not available`,
        envelope,
      );
    }
    const existingRevision = sqlite
      .prepare(
        `SELECT course_id, revision_number, parent_revision_id, branch_kind,
                status, title, description, content_hash, based_on_content_hash,
                created_at, published_at, archived_at, updated_at
         FROM course_revisions WHERE id = ?`,
      )
      .get(record.revisionKey) as
      | {
          course_id: string;
          revision_number: number;
          parent_revision_id: string | null;
          branch_kind: string;
          status: string;
          title: string;
          description: string | null;
          content_hash: string | null;
          based_on_content_hash: string | null;
          created_at: number;
          published_at: number | null;
          archived_at: number | null;
          updated_at: number;
        }
      | undefined;
    if (existingRevision !== undefined) {
      if (
        existingRevision.course_id !== record.courseKey ||
        existingRevision.revision_number !== record.revisionNumber ||
        existingRevision.parent_revision_id !== record.parentRevisionKey ||
        existingRevision.branch_kind !== record.branchKind ||
        existingRevision.title !== record.title ||
        existingRevision.description !== record.description ||
        (existingRevision.content_hash !== record.revisionContentHash &&
          !(
            existingRevision.status === "draft" &&
            existingRevision.content_hash === null
          )) ||
        existingRevision.based_on_content_hash !== record.basedOnContentHash ||
        (existingRevision.status !== record.status &&
          !(
            existingRevision.status === "draft" && record.status === "published"
          ))
      ) {
        throw transferInvalid(
          "TRANSFER_REVISION_INVALID",
          `/revisionSnapshots/${entry.revisionKey}`,
          entry.revisionKey,
          "Transfer revision collides with local immutable metadata",
          envelope,
        );
      }
      const existingCounts = sqlite
        .prepare(
          `SELECT
             (SELECT count(*) FROM course_sections WHERE course_id = ? AND revision_id = ?) AS sections,
             (SELECT count(*) FROM course_lessons WHERE course_id = ? AND revision_id = ?) AS lessons,
             (SELECT count(*) FROM course_activities WHERE course_id = ? AND revision_id = ?) AS activities,
             (SELECT count(*) FROM source_snapshots WHERE course_id = ? AND revision_id = ?) AS sources,
             (SELECT count(*) FROM knowledge_capsules WHERE course_id = ? AND revision_id = ?) AS capsules`,
        )
        .get(
          record.courseKey,
          record.revisionKey,
          record.courseKey,
          record.revisionKey,
          record.courseKey,
          record.revisionKey,
          record.courseKey,
          record.revisionKey,
          record.courseKey,
          record.revisionKey,
        ) as {
        sections: number;
        lessons: number;
        activities: number;
        sources: number;
        capsules: number;
      };
      if (
        existingCounts.sections !== record.sections.length ||
        existingCounts.lessons !== record.lessons.length ||
        existingCounts.activities !== record.activities.length ||
        existingCounts.sources !== record.sourceSnapshots.length ||
        existingCounts.capsules !== record.knowledgeCapsules.length
      ) {
        throw transferInvalid(
          "TRANSFER_REVISION_INVALID",
          `/revisionSnapshots/${entry.revisionKey}`,
          entry.revisionKey,
          "Transfer revision exists but its immutable closure is incomplete",
          envelope,
        );
      }
      if (sourceDraftInserted) publishImportedGraph();
      continue;
    }
    sqlite
      .prepare(
        `INSERT INTO course_revisions
         (id, course_id, revision_number, parent_revision_id, branch_kind,
          status, title, description, content_hash, based_on_content_hash,
          created_at, published_at, archived_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, NULL, ?, ?, NULL, NULL, ?)`,
      )
      .run(
        record.revisionKey,
        record.courseKey,
        record.revisionNumber,
        record.parentRevisionKey,
        record.branchKind,
        record.title,
        record.description,
        record.basedOnContentHash,
        record.createdAt,
        record.updatedAt,
      );
    const insertSource = sqlite.prepare(
      `INSERT INTO source_snapshots
       (id, course_id, revision_id, source_authority_id, canonical_url,
        retrieved_at, retrieval_method, media_type, locale, content_hash, title,
        author_publisher, published_or_updated_at, attribution, license_spdx,
        terms_url, content, locator_map_json, retention_mode,
        supersedes_snapshot_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const source of record.sourceSnapshots) {
      insertSource.run(
        source.id,
        record.courseKey,
        record.revisionKey,
        source.source_authority_id,
        source.canonical_url,
        source.retrieved_at,
        source.retrieval_method,
        source.media_type,
        source.locale,
        source.content_hash,
        source.title,
        source.author_publisher,
        source.published_or_updated_at,
        source.attribution,
        source.license_spdx,
        source.terms_url,
        source.content,
        source.locator_map_json,
        source.retention_mode,
        source.supersedes_snapshot_id,
        source.created_at,
      );
    }
    const insertCapsule = sqlite.prepare(
      `INSERT INTO knowledge_capsules
       (id, schema_version, course_id, revision_id, knowledge_node_ids_json,
        primary_locale, claims_json, citations_json, conflicts_json, created_by,
        validation_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const capsule of record.knowledgeCapsules) {
      insertCapsule.run(
        capsule.id,
        capsule.schema_version,
        record.courseKey,
        record.revisionKey,
        capsule.knowledge_node_ids_json,
        capsule.primary_locale,
        capsule.claims_json,
        capsule.citations_json,
        capsule.conflicts_json,
        capsule.created_by,
        capsule.validation_hash,
        capsule.created_at,
      );
    }
    const insertCapsuleSource = sqlite.prepare(
      `INSERT INTO knowledge_capsule_sources
       (course_id, revision_id, capsule_id, source_snapshot_id)
       VALUES (?, ?, ?, ?)`,
    );
    for (const link of record.knowledgeCapsuleSources) {
      insertCapsuleSource.run(
        record.courseKey,
        record.revisionKey,
        link.capsule_id,
        link.source_snapshot_id,
      );
    }
    const hasPackManifest =
      sqlite
        .prepare("SELECT 1 FROM course_pack_manifests WHERE revision_id = ?")
        .get(record.revisionKey) !== undefined;
    if (record.localizations.length > 0 || record.knowledgeNodes.length > 0) {
      if (!hasPackManifest) {
        throw transferInvalid(
          "TRANSFER_REVISION_INVALID",
          `/revisionSnapshots/${entry.revisionKey}/localizations`,
          entry.revisionKey,
          "Course Pack localization and knowledge projection rows require a manifest",
          envelope,
        );
      }
      const insertLocalization = sqlite.prepare(
        `INSERT INTO course_pack_localizations
         (revision_id, locale, release_complete, fields_json)
         VALUES (?, ?, ?, ?)`,
      );
      for (const localization of record.localizations) {
        insertLocalization.run(
          record.revisionKey,
          localization.locale,
          localization.release_complete,
          localization.fields_json,
        );
      }
      const insertNode = sqlite.prepare(
        `INSERT INTO course_pack_knowledge_nodes
         (revision_id, knowledge_node_id, title, description, kind,
          prerequisite_ids_json, related_ids_json, lifecycle)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const node of record.knowledgeNodes) {
        insertNode.run(
          record.revisionKey,
          node.knowledge_node_id,
          node.title,
          node.description,
          node.kind,
          node.prerequisite_ids_json,
          node.related_ids_json,
          node.lifecycle,
        );
      }
    }
    if (!sourceDraftInserted) {
      throw transferInvalid(
        "TRANSFER_REVISION_DEPENDENCY",
        `/revisionSnapshots/${entry.revisionKey}`,
        entry.revisionKey,
        "Course revision exists without its authored source graph",
        envelope,
      );
    }
    publishImportedGraph();
    if (record.branchLinks !== null) {
      const branch = sqlite
        .prepare(
          "SELECT base_revision_id, head_revision_id, status FROM adaptation_branches WHERE id = ?",
        )
        .get(record.branchLinks.id) as
        | {
            base_revision_id: string;
            head_revision_id: string | null;
            status: string;
          }
        | undefined;
      if (branch) {
        if (
          branch.base_revision_id !== record.branchLinks.base_revision_id ||
          branch.head_revision_id !== record.branchLinks.head_revision_id ||
          branch.status !== record.branchLinks.status
        ) {
          throw transferInvalid(
            "TRANSFER_REVISION_INVALID",
            `/revisionSnapshots/${entry.revisionKey}/branchLinks`,
            entry.revisionKey,
            "Transfer adaptation branch collides with local data",
            envelope,
          );
        }
      } else {
        sqlite
          .prepare(
            `INSERT INTO adaptation_branches
             (id, course_id, owner, base_revision_id, head_revision_id, status,
              created_at, updated_at)
             VALUES (?, ?, 'local', ?, ?, ?, ?, ?)`,
          )
          .run(
            record.branchLinks.id,
            record.courseKey,
            record.branchLinks.base_revision_id,
            record.branchLinks.head_revision_id,
            record.branchLinks.status,
            record.createdAt,
            record.updatedAt,
          );
      }
    }
    restored += 1;
  }
  const desiredPointers = new Map<string, string>();
  for (const entry of ordered) {
    const record = CourseTransferRevisionSnapshotCanonicalSchema.parse(
      JSON.parse(entry.canonicalJson),
    );
    if (record.course.active_revision_id !== null) {
      desiredPointers.set(record.course.id, record.course.active_revision_id);
    }
  }
  for (const [courseId, revisionId] of desiredPointers) {
    const current = sqlite
      .prepare("SELECT active_revision_id FROM courses WHERE id = ?")
      .get(courseId) as { active_revision_id: string | null } | undefined;
    if (
      current !== undefined &&
      (current.active_revision_id === null ||
        ordered.some(
          (entry) => entry.revisionKey === current.active_revision_id,
        ))
    ) {
      sqlite
        .prepare("UPDATE courses SET active_revision_id = ? WHERE id = ?")
        .run(revisionId, courseId);
      sqlite
        .prepare(
          "UPDATE curricula SET active_version_id = ?, updated_at = ? WHERE id = ?",
        )
        .run(revisionId, Date.now(), courseId);
    }
  }
  return restored;
}

/**
 * Structural per-fact contract check for learnerScope facts received as
 * untrusted data (ADR 0012 decision 3): unknown kernel body/evidence/
 * provenance types and malformed fact shapes fail closed with precise
 * code/path/entity diagnostics instead of being installed partially or
 * silently skipped. Cross-fact links and activity-scope rules still run in
 * the kernel boundary before any projection is recomputed.
 */
function collectTransferFactDiagnostics(
  envelope: CourseTransferEnvelope,
): CoursePackDiagnostic[] {
  const diagnostics: CoursePackDiagnostic[] = [];
  for (const entry of envelope.learnerScope.facts) {
    let fact: unknown;
    try {
      fact = JSON.parse(entry.canonicalJson) as unknown;
    } catch {
      diagnostics.push(
        transferDiagnostic(
          "TRANSFER_FACT_SHAPE_INVALID",
          `/learnerScope/facts/${entry.id}`,
          entry.id,
          `Transfer fact ${entry.id} is not valid JSON`,
        ),
      );
      continue;
    }
    try {
      if (
        canonicalLearningKernelJson(fact) !== entry.canonicalJson ||
        learningKernelSha256(fact) !== entry.factHash
      ) {
        diagnostics.push(
          transferDiagnostic(
            "TRANSFER_FACT_UNVERIFIED",
            `/learnerScope/facts/${entry.id}`,
            entry.id,
            `Transfer fact ${entry.id} hash does not verify`,
          ),
        );
        continue;
      }
    } catch {
      diagnostics.push(
        transferDiagnostic(
          "TRANSFER_FACT_SHAPE_INVALID",
          `/learnerScope/facts/${entry.id}`,
          entry.id,
          `Transfer fact ${entry.id} is not canonicalizable kernel JSON`,
        ),
      );
      continue;
    }
    for (const issue of collectLearningKernelFactShapeIssues(fact)) {
      diagnostics.push(
        transferDiagnostic(
          issue.code === "unknown-type"
            ? "TRANSFER_FACT_UNKNOWN_TYPE"
            : "TRANSFER_FACT_SHAPE_INVALID",
          `/learnerScope/facts/${entry.id}${issue.path}`,
          entry.id,
          issue.message,
        ),
      );
    }
  }
  return diagnostics;
}

function replayTransferFacts(
  sqlite: DatabaseSync,
  envelope: CourseTransferEnvelope,
): number {
  let replayed = 0;
  for (const entry of envelope.learnerScope.facts) {
    let fact: LearningKernelFact;
    try {
      fact = JSON.parse(entry.canonicalJson) as LearningKernelFact;
    } catch {
      throw transferInvalid(
        "TRANSFER_FACT_UNVERIFIED",
        `/learnerScope/facts/${entry.id}`,
        entry.id,
        `Transfer fact ${entry.id} is not valid JSON`,
        envelope,
      );
    }
    if (
      canonicalLearningKernelJson(fact) !== entry.canonicalJson ||
      learningKernelSha256(fact) !== entry.factHash ||
      fact.id !== entry.id ||
      fact.courseId !== entry.courseId ||
      fact.revisionId !== entry.revisionId ||
      fact.branchId !== entry.branchId ||
      fact.sessionId !== entry.sessionId
    ) {
      throw transferInvalid(
        "TRANSFER_FACT_UNVERIFIED",
        `/learnerScope/facts/${entry.id}`,
        entry.id,
        `Transfer fact ${entry.id} hash or scope does not verify`,
        envelope,
      );
    }
    const occurredAt = Date.parse(fact.occurredAt);
    const acceptedAt = Date.parse(entry.acceptedAt);
    if (!Number.isFinite(occurredAt) || !Number.isFinite(acceptedAt)) {
      throw transferInvalid(
        "TRANSFER_FACT_UNVERIFIED",
        `/learnerScope/facts/${entry.id}`,
        entry.id,
        `Transfer fact ${entry.id} has an invalid clock`,
        envelope,
      );
    }
    const existing = sqlite
      .prepare(
        `SELECT canonical_json, fact_hash, operation_id
         FROM learning_kernel_facts WHERE id = ?`,
      )
      .get(entry.id) as
      | { canonical_json: string; fact_hash: string; operation_id: string }
      | undefined;
    if (existing) {
      if (
        existing.canonical_json !== entry.canonicalJson ||
        existing.fact_hash !== entry.factHash
      ) {
        throw transferInvalid(
          "TRANSFER_FACT_UNVERIFIED",
          `/learnerScope/facts/${entry.id}`,
          entry.id,
          `Transfer fact ${entry.id} collides with local data`,
          envelope,
        );
      }
      continue;
    }
    // Fail closed before any write: an unknown kernel type must never be
    // persisted even when commit is reached without the validate stage.
    for (const issue of collectLearningKernelFactShapeIssues(fact)) {
      throw transferInvalid(
        issue.code === "unknown-type"
          ? "TRANSFER_FACT_UNKNOWN_TYPE"
          : "TRANSFER_FACT_SHAPE_INVALID",
        `/learnerScope/facts/${entry.id}${issue.path}`,
        entry.id,
        issue.message,
        envelope,
      );
    }
    replayed += insertRestoredKernelFact(
      sqlite,
      {
        id: fact.id,
        schemaVersion: fact.schemaVersion,
        operationId: `transfer:${entry.sessionId}:${fact.operationId}`.slice(
          0,
          500,
        ),
        courseId: fact.courseId,
        revisionId: fact.revisionId,
        branchId: fact.branchId,
        sessionId: fact.sessionId,
        lessonId: entry.lessonId,
        activityId: entry.activityId,
        bodyType: fact.body.type,
        provenanceKind: fact.provenance.kind,
        supersedesFactId:
          fact.body.type === "correction" ? fact.body.supersedesFactId : null,
        occurredAt,
        acceptedAt,
        canonicalJson: entry.canonicalJson,
        factHash: entry.factHash,
      },
      true,
    );
  }
  return replayed;
}

function verifyTransferCheckpoints(
  sqlite: DatabaseSync,
  envelope: CourseTransferEnvelope,
): void {
  for (const checkpoint of envelope.learnerScope.checkpoints) {
    const context = sqlite
      .prepare(
        `SELECT lesson_id FROM session_course_contexts
         WHERE session_id = ? AND course_id = ? AND revision_id = ?`,
      )
      .get(checkpoint.sessionId, checkpoint.courseId, checkpoint.revisionId) as
      { lesson_id: string } | undefined;
    if (!context) {
      throw transferInvalid(
        "TRANSFER_CHECKPOINT_DIVERGED",
        `/learnerScope/checkpoints/${checkpoint.sessionId}`,
        checkpoint.sessionId,
        `Transfer checkpoint for ${checkpoint.sessionId} has no restored session`,
        envelope,
      );
    }
    const scope = {
      courseId: checkpoint.courseId,
      revisionId: checkpoint.revisionId,
      branchId: checkpoint.branchId,
      sessionId: checkpoint.sessionId,
    };
    const facts = (
      sqlite
        .prepare(
          `SELECT canonical_json FROM learning_kernel_facts
           WHERE session_id = ? AND course_id = ? AND revision_id = ?
                 AND branch_id = ?
           ORDER BY occurred_at, id`,
        )
        .all(
          checkpoint.sessionId,
          checkpoint.courseId,
          checkpoint.revisionId,
          checkpoint.branchId,
        ) as Array<{ canonical_json: string }>
    ).map((row) => JSON.parse(row.canonical_json) as LearningKernelFact);
    const recomputed = projectLearningKernel({
      scope,
      activities: readRevisionActivities(
        sqlite,
        checkpoint.courseId,
        checkpoint.revisionId,
        context.lesson_id,
      ),
      facts,
      observedAt: checkpoint.observedAt,
    });
    if (recomputed.projectionHash !== checkpoint.projectionHash) {
      throw transferInvalid(
        "TRANSFER_CHECKPOINT_DIVERGED",
        `/learnerScope/checkpoints/${checkpoint.sessionId}`,
        checkpoint.sessionId,
        `Transfer checkpoint for ${checkpoint.sessionId} diverges from replayed facts`,
        envelope,
      );
    }
    persistTransferProjection(sqlite, scope, recomputed);
  }
}

function persistTransferProjection(
  sqlite: DatabaseSync,
  scope: {
    courseId: string;
    revisionId: string;
    branchId: string;
    sessionId: string;
  },
  projection: ReturnType<typeof projectLearningKernel>,
): void {
  const projectionJson = canonicalLearningKernelJson(projection);
  const factFrontierHash = learningKernelSha256(projection.factFrontier);
  const observedAt = Date.parse(projection.observedAt);
  sqlite
    .prepare(
      `INSERT INTO learning_kernel_projection_history
       (id, session_id, course_id, revision_id, branch_id, model_version,
        scheduler_version, observed_at, fact_frontier_hash, projection_hash,
        projection_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO NOTHING`,
    )
    .run(
      `transfer-${scope.sessionId}-${projection.projectionHash.slice("sha256:".length, "sha256:".length + 16)}`,
      scope.sessionId,
      scope.courseId,
      scope.revisionId,
      scope.branchId,
      projection.modelVersion,
      projection.schedulerVersion,
      observedAt,
      factFrontierHash,
      projection.projectionHash,
      projectionJson,
      Date.now(),
    );
  sqlite
    .prepare(
      `INSERT INTO learning_kernel_projections
       (session_id, course_id, revision_id, branch_id, model_version,
        scheduler_version, observed_at, fact_frontier_hash, projection_hash,
        projection_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET
        course_id = excluded.course_id,
        revision_id = excluded.revision_id,
        branch_id = excluded.branch_id,
        model_version = excluded.model_version,
        scheduler_version = excluded.scheduler_version,
        observed_at = excluded.observed_at,
        fact_frontier_hash = excluded.fact_frontier_hash,
        projection_hash = excluded.projection_hash,
        projection_json = excluded.projection_json,
        updated_at = excluded.updated_at`,
    )
    .run(
      scope.sessionId,
      scope.courseId,
      scope.revisionId,
      scope.branchId,
      projection.modelVersion,
      projection.schedulerVersion,
      observedAt,
      factFrontierHash,
      projection.projectionHash,
      projectionJson,
      Date.now(),
    );
}

/**
 * Reads the installed published revisions of the selected courses for
 * learnerScope-only transfer binding (ADR 0012 decision 1). The bound
 * identity (course + revision + content hash) is recorded in the manifest
 * and verified against the target on import; it fails closed on mismatch.
 */
function readPublishedCourseRevisions(
  sqlite: DatabaseSync,
  courseKeys: readonly string[],
): CourseTransferLearnerScopeCourse[] {
  if (courseKeys.length === 0) return [];
  const placeholders = courseKeys.map(() => "?").join(", ");
  const rows = sqlite
    .prepare(
      `SELECT course.id AS course_id, course.title AS course_title,
              course.primary_locale AS primary_locale,
              version.id AS revision_id, version.revision AS revision_number,
              version.content_hash AS content_hash
       FROM courses course
       JOIN curriculum_versions version ON version.curriculum_id = course.id
       WHERE course.id IN (${placeholders}) AND version.status = 'published'
       ORDER BY course.id, version.revision, version.id`,
    )
    .all(...courseKeys) as Array<{
    course_id: string;
    course_title: string;
    primary_locale: string;
    revision_id: string;
    revision_number: number;
    content_hash: string | null;
  }>;
  const bindings: CourseTransferLearnerScopeCourse[] = [];
  for (const row of rows) {
    if (row.content_hash === null) {
      throw new ClientError(
        409,
        `Course ${row.course_id} revision ${row.revision_id} has no content hash to bind learner progress to`,
      );
    }
    bindings.push({
      courseKey: row.course_id,
      courseTitle: row.course_title,
      revisionKey: row.revision_id,
      revisionNumber: row.revision_number,
      // curriculum_versions stores a bare hex digest; the transfer contract
      // carries the sha256-prefixed form.
      revisionContentHash: `sha256:${row.content_hash}`,
      primaryLocale: row.primary_locale,
    });
  }
  return bindings;
}

/**
 * LearnerScope-only export must bind the exact revisions the exported
 * learner scope references; anything else would silently attach progress to
 * a different revision on the target.
 */
function assertLearnerScopeRevisionCoverage(
  sqlite: DatabaseSync,
  courseKeys: readonly string[],
  bindings: readonly CourseTransferLearnerScopeCourse[],
): void {
  if (courseKeys.length === 0) return;
  const placeholders = courseKeys.map(() => "?").join(", ");
  const rows = sqlite
    .prepare(
      `SELECT DISTINCT context.course_id AS course_id,
              context.revision_id AS revision_id
       FROM session_course_contexts context
       WHERE context.course_id IN (${placeholders})`,
    )
    .all(...courseKeys) as Array<{
    course_id: string;
    revision_id: string;
  }>;
  const bound = new Set(
    bindings.map((binding) => `${binding.courseKey}|${binding.revisionKey}`),
  );
  for (const row of rows) {
    if (!bound.has(`${row.course_id}|${row.revision_id}`)) {
      throw new ClientError(
        409,
        `Course ${row.course_id} learner progress references revision ${row.revision_id} that is not the installed published revision`,
      );
    }
  }
}

function exportLearnerScope(
  sqlite: DatabaseSync,
  courseKeys: readonly string[],
): {
  bindings: CourseTransferEnvelope["learnerScope"]["bindings"];
  facts: CourseTransferEnvelope["learnerScope"]["facts"];
  snapshots: CourseTransferEnvelope["learnerScope"]["snapshots"];
  checkpoints: CourseTransferEnvelope["learnerScope"]["checkpoints"];
  sessionRefs: CourseTransferEnvelope["learnerScope"]["sessionRefs"];
  reviewItems: CourseTransferEnvelope["learnerScope"]["reviewItems"];
  learnerCoursePointers: CourseTransferEnvelope["learnerScope"]["learnerCoursePointers"];
  skippedSessionCount: number;
  droppedPendingTurnCount: number;
} {
  const placeholders = courseKeys.map(() => "?").join(", ");
  const bindings = readBindings(sqlite, courseKeys);
  const factRows = sqlite
    .prepare(
      `SELECT fact.id, fact.operation_id, fact.course_id, fact.revision_id,
              fact.branch_id, fact.session_id, fact.lesson_id, fact.activity_id,
              fact.body_type, fact.occurred_at, fact.accepted_at,
              fact.canonical_json, fact.fact_hash, session.status AS session_status
       FROM learning_kernel_facts fact
       JOIN session_course_contexts context
         ON context.session_id = fact.session_id
        AND context.course_id = fact.course_id
        AND context.revision_id = fact.revision_id
       JOIN learning_sessions session ON session.id = fact.session_id
       WHERE fact.course_id IN (${placeholders})
       ORDER BY fact.occurred_at, fact.id`,
    )
    .all(...courseKeys) as Array<{
    id: string;
    operation_id: string;
    course_id: string;
    revision_id: string;
    branch_id: string;
    session_id: string;
    lesson_id: string;
    activity_id: string;
    body_type: string;
    occurred_at: number;
    accepted_at: number;
    canonical_json: string;
    fact_hash: string;
    session_status: string;
  }>;
  const liveFacts = factRows;
  const skippedSessions = new Set<string>();
  if (liveFacts.length > COURSE_TRANSFER_JSON_LIMITS_V1.maxFacts) {
    throw new ClientError(
      400,
      "Course transfer history exceeds the fact limit",
    );
  }
  // Sessions are an independent unit of transfer. In particular, an active
  // session with no facts still carries its immutable snapshot and pointers.
  const sessionRows = sqlite
    .prepare(
      `SELECT session.id, session.status
       FROM learning_sessions session
       JOIN session_course_contexts context ON context.session_id = session.id
       WHERE context.course_id IN (${placeholders})
       ORDER BY session.started_at, session.id`,
    )
    .all(...courseKeys) as Array<{
    id: string;
    status: string;
  }>;
  const sessionIds = sessionRows.map((row) => row.id);
  if (sessionIds.length > COURSE_TRANSFER_JSON_LIMITS_V1.maxSessions) {
    throw new ClientError(
      400,
      "Course transfer history exceeds the session limit",
    );
  }
  // Do not equate an active session with an in-flight provider operation.
  // Only persisted provider turns still in `started` state are dropped.
  const sessionIdPlaceholders = sessionIds.map(() => "?").join(", ");
  const droppedPendingTurnCount =
    sessionIds.length === 0
      ? 0
      : (
          sqlite
            .prepare(
              `SELECT count(DISTINCT operation_id) AS count
               FROM provider_turn_provenance
               WHERE status = 'started'
                 AND metadata_json IS NOT NULL
                 AND json_valid(metadata_json)
                 AND json_extract(metadata_json, '$.learningSessionId')
                     IN (${sessionIdPlaceholders})`,
            )
            .get(...sessionIds) as { count: number }
        ).count;
  const sessionPlaceholders = sessionIds.map(() => "?").join(", ");
  interface TransferSnapshotRow {
    snapshot_id: string;
    session_id: string;
    schema_version: number;
    curriculum_version_id: string | null;
    curriculum_day_id: string | null;
    content_hash: string;
    snapshot_json: string;
    created_at: number;
    course_id: string;
    revision_id: string;
    lesson_id: string;
    snapshot_hash: string;
    snapshot_bytes_hash: string | null;
    session_status: string;
    adaptation_branch_id: string | null;
    current_step: string;
    started_at: number;
    completed_at: number | null;
  }
  const snapshotBySession = new Map<string, TransferSnapshotRow>();
  const checkpoints: CourseTransferEnvelope["learnerScope"]["checkpoints"] = [];
  const sessionRefs: CourseTransferEnvelope["learnerScope"]["sessionRefs"] = [];
  if (sessionIds.length > 0) {
    const snapshots = sqlite
      .prepare(
        `SELECT snapshot.id AS snapshot_id, snapshot.session_id,
                snapshot.schema_version, snapshot.curriculum_version_id,
                snapshot.curriculum_day_id, snapshot.content_hash,
                snapshot.snapshot_json, snapshot.created_at,
                context.course_id, context.revision_id, context.lesson_id,
                context.snapshot_hash, context.snapshot_bytes_hash,
                context.adaptation_branch_id,
                session.status AS session_status, session.current_step,
                session.started_at, session.completed_at
         FROM session_snapshots snapshot
         JOIN session_course_contexts context
           ON context.session_snapshot_id = snapshot.id
         JOIN learning_sessions session ON session.id = snapshot.session_id
         WHERE snapshot.session_id IN (${sessionPlaceholders})`,
      )
      .all(...sessionIds) as unknown as TransferSnapshotRow[];
    for (const row of snapshots) {
      snapshotBySession.set(row.session_id, row);
    }
    const projections = sqlite
      .prepare(
        `SELECT session_id, course_id, revision_id, branch_id, observed_at,
                projection_hash
         FROM learning_kernel_projections
         WHERE session_id IN (${sessionPlaceholders})`,
      )
      .all(...sessionIds) as Array<{
      session_id: string;
      course_id: string;
      revision_id: string;
      branch_id: string;
      observed_at: number;
      projection_hash: string;
    }>;
    for (const row of projections) {
      checkpoints.push({
        courseId: row.course_id,
        revisionId: row.revision_id,
        branchId: row.branch_id,
        sessionId: row.session_id,
        observedAt: new Date(row.observed_at).toISOString(),
        projectionHash: row.projection_hash,
      });
    }
  }
  const snapshotEntries: CourseTransferEnvelope["learnerScope"]["snapshots"] =
    [];
  const keptSessionIds = new Set<string>();
  for (const sessionId of sessionIds) {
    const row = snapshotBySession.get(sessionId);
    if (!row) {
      skippedSessions.add(sessionId);
      continue;
    }
    if (
      row.snapshot_json.length >
        COURSE_TRANSFER_JSON_LIMITS_V1.maxSnapshotBytes ||
      row.curriculum_version_id === null ||
      row.curriculum_day_id === null ||
      row.adaptation_branch_id === null
    ) {
      skippedSessions.add(sessionId);
      continue;
    }
    keptSessionIds.add(sessionId);
    const sessionStatus =
      row.session_status === "active" ||
      row.session_status === "completed" ||
      row.session_status === "abandoned"
        ? row.session_status
        : "completed";
    snapshotEntries.push({
      snapshotId: row.snapshot_id,
      sessionId: row.session_id,
      courseId: row.course_id,
      revisionId: row.revision_id,
      lessonId: row.lesson_id,
      branchId: row.adaptation_branch_id,
      dayId: row.curriculum_day_id,
      schemaVersion: row.schema_version,
      sessionStatus,
      currentStep: row.current_step,
      startedAt: new Date(row.started_at).toISOString(),
      completedAt:
        row.completed_at === null
          ? null
          : new Date(row.completed_at).toISOString(),
      snapshotHash: row.snapshot_hash,
      contentHash: row.content_hash,
      snapshotBytesHash: `sha256:${row.snapshot_bytes_hash ?? createHash("sha256").update(UTF8_ENCODER.encode(row.snapshot_json)).digest("hex")}`,
      createdAt: new Date(row.created_at).toISOString(),
      snapshotJson: row.snapshot_json,
    });
    const context = sqlite
      .prepare(
        `SELECT course_id, revision_id, lesson_id, adaptation_branch_id
         FROM session_course_contexts WHERE session_id = ?`,
      )
      .get(sessionId) as {
      course_id: string;
      revision_id: string;
      lesson_id: string;
      adaptation_branch_id: string;
    };
    sessionRefs.push({
      sessionId,
      courseId: context.course_id,
      revisionId: context.revision_id,
      branchId: context.adaptation_branch_id,
      lessonId: context.lesson_id,
      status: sessionStatus,
    });
  }
  const reviewItems = exportReviewItems(sqlite, courseKeys, keptSessionIds);
  const learnerCoursePointers = exportLearnerCoursePointers(sqlite, courseKeys);
  return {
    bindings,
    facts: liveFacts
      .filter((row) => keptSessionIds.has(row.session_id))
      .map((row) => ({
        id: row.id,
        operationId: row.operation_id,
        courseId: row.course_id,
        revisionId: row.revision_id,
        branchId: row.branch_id,
        sessionId: row.session_id,
        lessonId: row.lesson_id,
        activityId: row.activity_id,
        bodyType: row.body_type as
          "evidence" | "progress" | "correction" | "review",
        occurredAt: new Date(row.occurred_at).toISOString(),
        acceptedAt: new Date(row.accepted_at).toISOString(),
        canonicalJson: row.canonical_json,
        factHash: row.fact_hash,
      })),
    snapshots: snapshotEntries,
    checkpoints: checkpoints.filter((checkpoint) =>
      keptSessionIds.has(checkpoint.sessionId),
    ),
    sessionRefs,
    reviewItems,
    learnerCoursePointers,
    skippedSessionCount: skippedSessions.size,
    droppedPendingTurnCount,
  };
}

function exportRevisionSnapshots(
  connection: DatabaseConnection,
  courseKey: string,
): CourseTransferEnvelope["revisionSnapshots"] {
  const sqlite = connection.sqlite;
  const rows = sqlite
    .prepare(
      `SELECT revision.id, revision.revision_number, revision.parent_revision_id,
              revision.branch_kind, revision.based_on_content_hash,
              revision.content_hash, revision.title, revision.description,
              revision.status, revision.created_at, revision.published_at,
              revision.archived_at, revision.updated_at
       FROM course_revisions revision
       LEFT JOIN course_pack_manifests manifest
         ON manifest.revision_id = revision.id
       WHERE revision.course_id = ? AND manifest.revision_id IS NULL
       ORDER BY revision.revision_number, revision.id`,
    )
    .all(courseKey) as Array<{
    id: string;
    revision_number: number;
    parent_revision_id: string | null;
    branch_kind: string;
    based_on_content_hash: string | null;
    content_hash: string | null;
    title: string;
    description: string | null;
    status: string;
    created_at: number;
    published_at: number | null;
    archived_at: number | null;
    updated_at: number;
  }>;
  const course = sqlite
    .prepare(
      `SELECT id, stable_id, slug, title, description, primary_locale,
              active_revision_id, created_at, updated_at
       FROM courses WHERE id = ?`,
    )
    .get(courseKey) as
    | {
        id: string;
        stable_id: string;
        slug: string;
        title: string;
        description: string | null;
        primary_locale: string;
        active_revision_id: string | null;
        created_at: number;
        updated_at: number;
      }
    | undefined;
  if (!course) return [];
  const snapshots: CourseTransferEnvelope["revisionSnapshots"] = [];
  for (const row of rows) {
    if (row.branch_kind !== "upstream" && row.branch_kind !== "personal")
      continue;
    if (row.status === "draft") continue;
    if (row.content_hash === null) continue;
    const sections = sqlite
      .prepare(
        `SELECT id, stable_id, order_index, title, description
         FROM course_sections WHERE course_id = ? AND revision_id = ?
         ORDER BY order_index, id`,
      )
      .all(courseKey, row.id) as Array<Record<string, unknown>>;
    const lessons = sqlite
      .prepare(
        `SELECT id, section_id, stable_id, order_index, title, description, goal,
                estimated_minutes, expected_outcomes_json, depth_level,
                out_of_scope_json, topics_json
         FROM course_lessons WHERE course_id = ? AND revision_id = ?
         ORDER BY order_index, id`,
      )
      .all(courseKey, row.id) as Array<Record<string, unknown>>;
    const activities = sqlite
      .prepare(
        `SELECT id, lesson_id, stable_id, activity_type, order_index, title,
                description, estimated_minutes, required, objectives_json,
                checklist_json, sources_json, questions_json,
                misconceptions_json, capability_ids_json, knowledge_node_ids_json,
                completion_criteria_json, payload_json, protected_material_json,
                depth_level
         FROM course_activities WHERE course_id = ? AND revision_id = ?
         ORDER BY lesson_id, order_index, id`,
      )
      .all(courseKey, row.id) as Array<Record<string, unknown>>;
    const lessonPrerequisites = sqlite
      .prepare(
        `SELECT course_id, revision_id, lesson_id, prerequisite_lesson_id
         FROM course_lesson_prerequisites
         WHERE course_id = ? AND revision_id = ?
         ORDER BY lesson_id, prerequisite_lesson_id`,
      )
      .all(courseKey, row.id) as Array<Record<string, unknown>>;
    const activityPrerequisites = sqlite
      .prepare(
        `SELECT course_id, revision_id, lesson_id, activity_id,
                prerequisite_activity_id
         FROM course_activity_prerequisites
         WHERE course_id = ? AND revision_id = ?
         ORDER BY lesson_id, activity_id, prerequisite_activity_id`,
      )
      .all(courseKey, row.id) as Array<Record<string, unknown>>;
    const sourceSnapshots = sqlite
      .prepare(
        `SELECT id, course_id, revision_id, source_authority_id, canonical_url,
                retrieved_at, retrieval_method, media_type, locale, content_hash,
                title, author_publisher, published_or_updated_at, attribution,
                license_spdx, terms_url, content, locator_map_json, retention_mode,
                supersedes_snapshot_id, created_at
         FROM source_snapshots
         WHERE course_id = ? AND revision_id = ?
         ORDER BY id`,
      )
      .all(courseKey, row.id) as Array<Record<string, unknown>>;
    const knowledgeCapsules = sqlite
      .prepare(
        `SELECT id, schema_version, course_id, revision_id,
                knowledge_node_ids_json, primary_locale, claims_json,
                citations_json, conflicts_json, created_by, validation_hash,
                created_at
         FROM knowledge_capsules
         WHERE course_id = ? AND revision_id = ?
         ORDER BY id`,
      )
      .all(courseKey, row.id) as Array<Record<string, unknown>>;
    const knowledgeCapsuleSources = sqlite
      .prepare(
        `SELECT course_id, revision_id, capsule_id, source_snapshot_id
         FROM knowledge_capsule_sources
         WHERE course_id = ? AND revision_id = ?
         ORDER BY capsule_id, source_snapshot_id`,
      )
      .all(courseKey, row.id) as Array<Record<string, unknown>>;
    const localizations = sqlite
      .prepare(
        `SELECT revision_id, locale, release_complete, fields_json
         FROM course_pack_localizations
         WHERE revision_id = ?
         ORDER BY locale`,
      )
      .all(row.id) as Array<Record<string, unknown>>;
    const knowledgeNodes = sqlite
      .prepare(
        `SELECT revision_id, knowledge_node_id, title, description, kind,
                prerequisite_ids_json, related_ids_json, lifecycle
         FROM course_pack_knowledge_nodes
         WHERE revision_id = ?
         ORDER BY knowledge_node_id`,
      )
      .all(row.id) as Array<Record<string, unknown>>;
    const branch = sqlite
      .prepare(
        `SELECT id, base_revision_id, head_revision_id, status
         FROM adaptation_branches WHERE course_id = ? AND base_revision_id = ?`,
      )
      .get(courseKey, row.id) as
      | {
          id: string;
          base_revision_id: string;
          head_revision_id: string | null;
          status: string;
        }
      | undefined;
    const authoredGraph = loadVersionGraph(connection, row.id);
    const calculatedContentHash = `sha256:${hashCanonicalJson(
      publicationContent(authoredGraph),
    )}`;
    if (
      calculatedContentHash !== row.content_hash &&
      calculatedContentHash.slice("sha256:".length) !== row.content_hash
    ) {
      // Legacy backfill revisions (preserved M11 compatibility history) carry
      // their historical content hash and are not representable as a
      // re-verifiable authored-graph snapshot. Skip them instead of failing
      // the whole export; the receiving profile that owns the same Course
      // already holds this revision locally.
      continue;
    }
    const transferAuthoredGraph = authoredGraph;
    const canonical = canonicalJson({
      courseKey,
      course: {
        id: course.id,
        stable_id: course.stable_id,
        slug: course.slug,
        title: course.title,
        description: course.description,
        primary_locale: course.primary_locale,
        active_revision_id: course.active_revision_id,
        created_at: course.created_at,
        updated_at: course.updated_at,
      },
      authoredGraph: transferAuthoredGraph,
      revisionKey: row.id,
      revisionNumber: row.revision_number,
      parentRevisionKey: row.parent_revision_id,
      branchKind: row.branch_kind,
      basedOnContentHash: row.based_on_content_hash,
      status: row.status,
      createdAt: row.created_at,
      publishedAt: row.published_at,
      archivedAt: row.archived_at,
      updatedAt: row.updated_at,
      revisionContentHash:
        row.content_hash === null
          ? null
          : row.content_hash.startsWith("sha256:")
            ? row.content_hash
            : `sha256:${row.content_hash}`,
      sections,
      lessons,
      activities,
      lessonPrerequisites,
      activityPrerequisites,
      branchLinks: branch ?? null,
      sourceSnapshots,
      knowledgeCapsules,
      title: row.title,
      description: row.description,
      knowledgeCapsuleSources,
      localizations,
      knowledgeNodes,
    });
    const snapshotHash = `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
    snapshots.push({
      courseKey,
      revisionKey: row.id,
      revisionNumber: row.revision_number,
      parentRevisionKey: row.parent_revision_id,
      branchKind: row.branch_kind as "upstream" | "personal",
      basedOnContentHash:
        row.based_on_content_hash === null
          ? null
          : row.based_on_content_hash.startsWith("sha256:")
            ? (row.based_on_content_hash as `sha256:${string}`)
            : (`sha256:${row.based_on_content_hash}` as `sha256:${string}`),
      revisionContentHash: (row.content_hash === null
        ? null
        : row.content_hash.startsWith("sha256:")
          ? row.content_hash
          : `sha256:${row.content_hash}`) as `sha256:${string}`,
      snapshotHash: snapshotHash as `sha256:${string}`,
      canonicalJson: canonical,
    });
  }
  return snapshots;
}

/**
 * Returns only server-owned metadata for active attempts. This function never
 * reads or invents workspace bytes; callers must ask exercise-core to snapshot
 * each descriptor and include only verified results in a transfer envelope.
 */
export function listActiveAttemptDescriptors(
  sqlite: DatabaseSync,
  courseKeys: readonly string[],
): readonly CourseTransferAttemptDescriptor[] {
  if (courseKeys.length === 0) return [];
  const placeholders = courseKeys.map(() => "?").join(", ");
  const rows = sqlite
    .prepare(
      `SELECT attempt.id, attempt.session_id, attempt.exercise_id,
              context.course_id, context.revision_id,
              attempt.workspace_path, attempt.baseline_path,
              attempt.baseline_hash, attempt.started_at,
              exercise.workspace_path AS template_path
       FROM exercise_attempts attempt
       JOIN session_course_contexts context
         ON context.session_id = attempt.session_id
       JOIN learning_sessions session
         ON session.id = attempt.session_id
       JOIN exercises exercise ON exercise.id = attempt.exercise_id
       WHERE context.course_id IN (${placeholders})
         AND session.status = 'active'
       ORDER BY attempt.started_at, attempt.id
       LIMIT ${COURSE_TRANSFER_JSON_LIMITS_V1.maxAttemptSnapshots}`,
    )
    .all(...courseKeys) as Array<{
    id: string;
    session_id: string;
    exercise_id: string;
    course_id: string;
    revision_id: string | null;
    workspace_path: string;
    baseline_path: string;
    baseline_hash: string;
    started_at: number;
    template_path: string;
  }>;
  return rows.flatMap((row) => {
    if (row.revision_id === null) return [];
    // `baseline_hash` is populated by ensureExerciseBaseline() with the
    // server-owned Git commit; reject legacy SHA-256/content fingerprints
    // instead of relabelling them as Git evidence.
    if (!/^[0-9a-f]{40}$/u.test(row.baseline_hash)) {
      throw new Error(
        `Active attempt ${row.id} has no valid server-owned Git baseline commit`,
      );
    }
    return [
      {
        attemptId: row.id,
        sessionId: row.session_id,
        exerciseId: row.exercise_id,
        courseId: row.course_id,
        revisionId: row.revision_id,
        workspacePath: row.workspace_path,
        baselinePath: row.baseline_path,
        baselineCommit: row.baseline_hash,
        trustedTemplateId: row.exercise_id,
        templatePath: row.template_path,
        startedAt: new Date(row.started_at).toISOString(),
      },
    ];
  });
}

function exportReviewItems(
  sqlite: DatabaseSync,
  courseKeys: readonly string[],
  keptSessionIds: ReadonlySet<string>,
): CourseTransferEnvelope["learnerScope"]["reviewItems"] {
  if (courseKeys.length === 0 || keptSessionIds.size === 0) return [];
  const coursePlaceholders = courseKeys.map(() => "?").join(", ");
  let rows: Array<{
    id: string;
    course_id: string;
    revision_id: string;
    source_evidence_id: string;
    status: string;
    due_at: number;
    created_at: number;
    session_id: string | null;
    activity_id: string | null;
    branch_id: string | null;
  }> = [];
  try {
    rows = sqlite
      .prepare(
        `SELECT item.id, item.course_id, item.revision_id, item.source_evidence_id,
                item.status, item.due_at, item.created_at,
                evidence.session_id, evidence.activity_id,
                context.adaptation_branch_id AS branch_id
         FROM review_items item
         LEFT JOIN evidence_facts evidence
           ON evidence.id = item.source_evidence_id
          AND evidence.course_id = item.course_id
          AND evidence.revision_id = item.revision_id
         LEFT JOIN session_course_contexts context
           ON context.session_id = evidence.session_id
         WHERE item.course_id IN (${coursePlaceholders})
         ORDER BY item.created_at, item.id
         LIMIT ${COURSE_TRANSFER_JSON_LIMITS_V1.maxReviewItems}`,
      )
      .all(...courseKeys) as typeof rows;
  } catch {
    return [];
  }
  const items: CourseTransferEnvelope["learnerScope"]["reviewItems"] = [];
  for (const row of rows) {
    if (row.session_id === null || !keptSessionIds.has(row.session_id))
      continue;
    if (row.activity_id === null || row.branch_id === null) continue;
    const status =
      row.status === "pending"
        ? "pending"
        : row.status === "completed"
          ? "completed"
          : "dismissed";
    items.push({
      reviewItemId: row.id,
      sessionId: row.session_id,
      courseId: row.course_id,
      revisionId: row.revision_id,
      branchId: row.branch_id,
      activityId: row.activity_id,
      status: status as "pending" | "completed" | "dismissed",
      dueAt: new Date(row.due_at).toISOString(),
      createdAt: new Date(row.created_at).toISOString(),
    });
  }
  return items;
}

function exportLearnerCoursePointers(
  sqlite: DatabaseSync,
  courseKeys: readonly string[],
): CourseTransferEnvelope["learnerScope"]["learnerCoursePointers"] {
  if (courseKeys.length === 0) return [];
  const placeholders = courseKeys.map(() => "?").join(", ");
  let rows: Array<{
    course_id: string;
    active_revision_id: string;
    current_learning_session_id: string | null;
    is_selected: number;
    updated_at: number;
  }> = [];
  try {
    rows = sqlite
      .prepare(
        `SELECT course_id, active_revision_id, current_learning_session_id,
                is_selected, updated_at
         FROM learner_course_states WHERE course_id IN (${placeholders})
         ORDER BY course_id`,
      )
      .all(...courseKeys) as typeof rows;
  } catch {
    return [];
  }
  return rows.map((row) => ({
    courseId: row.course_id,
    activeRevisionId: row.active_revision_id,
    currentSessionId: row.current_learning_session_id,
    isSelected: row.is_selected === 1,
    updatedAt: new Date(row.updated_at).toISOString(),
  }));
}

function readBindings(
  sqlite: DatabaseSync,
  courseKeys: readonly string[],
): CourseTransferEnvelope["learnerScope"]["bindings"] {
  if (courseKeys.length === 0) return [];
  const placeholders = courseKeys.map(() => "?").join(", ");
  const rows = sqlite
    .prepare(
      `SELECT course_id, base_revision_id AS revision_id, id AS branch_id,
              base_revision_id, head_revision_id, status
       FROM adaptation_branches
       WHERE course_id IN (${placeholders})
       ORDER BY course_id, id`,
    )
    .all(...courseKeys) as Array<{
    course_id: string;
    revision_id: string;
    branch_id: string;
    base_revision_id: string;
    head_revision_id: string | null;
    status: string;
  }>;
  return rows
    .filter((row) => row.status === "active" || row.status === "archived")
    .map((row) => ({
      courseId: row.course_id,
      revisionId: row.revision_id,
      branchId: row.branch_id,
      baseRevisionId: row.base_revision_id,
      headRevisionId: row.head_revision_id,
      status: row.status as "active" | "archived",
    }));
}

function ensureTransferBranch(
  sqlite: DatabaseSync,
  input: { courseId: string; branchId: string; baseRevisionId: string },
): void {
  const expected = adaptationBranchIdForRevision(
    input.courseId,
    input.baseRevisionId,
  );
  const row = sqlite
    .prepare(
      `SELECT base_revision_id FROM adaptation_branches
       WHERE course_id = ? AND id = ?`,
    )
    .get(input.courseId, input.branchId) as
    { base_revision_id: string } | undefined;
  if (row) {
    if (row.base_revision_id !== input.baseRevisionId) {
      throw new ClientError(
        409,
        `Transfer branch ${input.branchId} collides with local data`,
      );
    }
    return;
  }
  if (input.branchId !== expected) {
    throw new ClientError(
      409,
      `Transfer branch ${input.branchId} is not a revision-pinned branch`,
    );
  }
  sqlite
    .prepare(
      `INSERT INTO adaptation_branches
       (id, course_id, owner, base_revision_id, head_revision_id, status,
        created_at, updated_at)
       VALUES (?, ?, 'local', ?, NULL, 'archived', ?, ?)`,
    )
    .run(
      input.branchId,
      input.courseId,
      input.baseRevisionId,
      Date.now(),
      Date.now(),
    );
}

function previewEnvelope(
  envelope: CourseTransferEnvelope,
): CourseTransferPreview {
  const courses: CourseTransferPreviewCourse[] =
    envelope.manifest.mode === "learnerScope"
      ? envelope.manifest.learnerScopeCourses.map((course) => ({
          courseKey: course.courseKey,
          courseTitle: course.courseTitle,
          revisionKey: course.revisionKey,
          revisionNumber: course.revisionNumber,
          contentHash: course.revisionContentHash,
          primaryLocale: course.primaryLocale,
        }))
      : envelope.packs.map((pack) => {
          const parsed = JSON.parse(pack.canonicalJson) as CoursePackV1;
          return {
            courseKey: pack.courseKey,
            courseTitle: parsed.course.title,
            revisionKey: pack.revisionKey,
            revisionNumber: pack.revisionNumber,
            contentHash: pack.contentHash,
            primaryLocale: parsed.course.primaryLocale,
          };
        });
  return {
    courses: courses.slice(0, COURSE_TRANSFER_JSON_LIMITS_V1.maxCourses),
    mode: envelope.manifest.mode,
    originatingAppVersion: envelope.manifest.originatingAppVersion,
    appVersionMatches: null,
    packCount: envelope.manifest.packCount,
    revisionSnapshotCount: envelope.manifest.revisionSnapshotCount,
    factCount: envelope.manifest.factCount,
    sessionCount: envelope.manifest.sessionCount,
    skippedSessionCount: envelope.manifest.skippedSessionCount,
    attemptSnapshotCount: envelope.manifest.attemptSnapshotCount,
    attemptByteCount: envelope.manifest.attemptByteCount,
    droppedPendingTurnCount: envelope.manifest.droppedPendingTurnCount,
    excluded: [...envelope.manifest.excluded],
    conflicts: [],
  };
}

function withoutInlineBlobs(envelope: CourseTransferEnvelope): unknown {
  return {
    ...envelope,
    packs: envelope.packs.map((pack) => ({ ...pack, canonicalJson: null })),
    revisionSnapshots: envelope.revisionSnapshots.map((snapshot) => ({
      ...snapshot,
      canonicalJson: null,
    })),
    learnerScope: {
      ...envelope.learnerScope,
      facts: envelope.learnerScope.facts.map((fact) => ({
        ...fact,
        canonicalJson: null,
      })),
      snapshots: envelope.learnerScope.snapshots.map((snapshot) => ({
        ...snapshot,
        snapshotJson: null,
      })),
      attemptSnapshots: envelope.learnerScope.attemptSnapshots.map(
        (attempt) => ({
          ...attempt,
          workingTreeDiff: null,
          untrackedBlobs: attempt.untrackedBlobs.map((blob) => ({
            ...blob,
            contentBase64: null,
          })),
        }),
      ),
    },
  };
}

function validateRevisionSnapshotReferences(
  record: CourseTransferRevisionSnapshotCanonical,
): readonly string[] {
  const messages: string[] = [];
  const lessons = record["lessons"];
  const activities = record["activities"];
  const lessonIds = new Set<string>();
  const activityIds = new Set<string>();
  if (!Array.isArray(lessons)) {
    messages.push("Revision snapshot lessons must be an array");
  } else {
    for (const lesson of lessons) {
      if (
        lesson === null ||
        typeof lesson !== "object" ||
        typeof (lesson as Record<string, unknown>)["id"] !== "string"
      ) {
        messages.push(
          "Revision snapshot contains a malformed lesson reference",
        );
        continue;
      }
      const id = (lesson as Record<string, unknown>)["id"] as string;
      if (lessonIds.has(id)) messages.push(`Duplicate lesson reference ${id}`);
      lessonIds.add(id);
    }
  }
  if (!Array.isArray(activities)) {
    messages.push("Revision snapshot activities must be an array");
  } else {
    for (const activity of activities) {
      if (activity === null || typeof activity !== "object") {
        messages.push(
          "Revision snapshot contains a malformed activity reference",
        );
        continue;
      }
      const value = activity as Record<string, unknown>;
      const id = value["id"];
      const lessonId = value["lesson_id"];
      if (typeof id !== "string" || typeof lessonId !== "string") {
        messages.push(
          "Revision snapshot activity has an invalid lesson reference",
        );
        continue;
      }
      if (activityIds.has(id))
        messages.push(`Duplicate activity reference ${id}`);
      activityIds.add(id);
      if (!lessonIds.has(lessonId)) {
        messages.push(`Activity ${id} references missing lesson ${lessonId}`);
      }
    }
  }
  const lessonPrerequisites = record["lessonPrerequisites"];
  if (!Array.isArray(lessonPrerequisites)) {
    messages.push("Revision snapshot lesson prerequisites must be an array");
  } else {
    for (const prerequisite of lessonPrerequisites) {
      if (prerequisite === null || typeof prerequisite !== "object") {
        messages.push(
          "Revision snapshot contains a malformed lesson prerequisite",
        );
        continue;
      }
      const value = prerequisite as Record<string, unknown>;
      if (
        typeof value["lesson_id"] !== "string" ||
        typeof value["prerequisite_lesson_id"] !== "string" ||
        !lessonIds.has(value["lesson_id"]) ||
        !lessonIds.has(value["prerequisite_lesson_id"])
      ) {
        messages.push(
          "Revision snapshot lesson prerequisite references a missing lesson",
        );
      }
    }
  }
  const activityPrerequisites = record["activityPrerequisites"];
  if (!Array.isArray(activityPrerequisites)) {
    messages.push("Revision snapshot activity prerequisites must be an array");
  } else {
    for (const prerequisite of activityPrerequisites) {
      if (prerequisite === null || typeof prerequisite !== "object") {
        messages.push(
          "Revision snapshot contains a malformed activity prerequisite",
        );
        continue;
      }
      const value = prerequisite as Record<string, unknown>;
      if (
        typeof value["activity_id"] !== "string" ||
        typeof value["prerequisite_activity_id"] !== "string" ||
        !activityIds.has(value["activity_id"]) ||
        !activityIds.has(value["prerequisite_activity_id"]) ||
        typeof value["lesson_id"] !== "string" ||
        !lessonIds.has(value["lesson_id"])
      ) {
        messages.push(
          "Revision snapshot activity prerequisite references a missing activity or lesson",
        );
      }
    }
  }
  const sourceIds = new Set(record.sourceSnapshots.map((source) => source.id));
  const capsuleIds = new Set(
    record.knowledgeCapsules.map((capsule) => capsule.id),
  );
  const nodeIds = new Set(
    record.knowledgeNodes.map((node) => node.knowledge_node_id),
  );
  if (sourceIds.size !== record.sourceSnapshots.length) {
    messages.push("Revision snapshot contains duplicate source snapshots");
  }
  if (capsuleIds.size !== record.knowledgeCapsules.length) {
    messages.push("Revision snapshot contains duplicate knowledge capsules");
  }
  if (nodeIds.size !== record.knowledgeNodes.length) {
    messages.push("Revision snapshot contains duplicate knowledge nodes");
  }
  for (const source of record.sourceSnapshots) {
    if (
      source.supersedes_snapshot_id !== null &&
      !sourceIds.has(source.supersedes_snapshot_id)
    ) {
      messages.push(
        `Source snapshot ${source.id} supersedes a missing source snapshot`,
      );
    }
    if (
      source.supersedes_snapshot_id !== null &&
      source.supersedes_snapshot_id === source.id
    ) {
      messages.push(`Source snapshot ${source.id} cannot supersede itself`);
    }
  }
  for (const link of record.knowledgeCapsuleSources) {
    if (
      !capsuleIds.has(link.capsule_id) ||
      !sourceIds.has(link.source_snapshot_id)
    ) {
      messages.push(
        `Knowledge capsule source link ${link.capsule_id}/${link.source_snapshot_id} is unresolved`,
      );
    }
  }
  const parseArray = (value: string): readonly unknown[] => {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  };
  for (const node of record.knowledgeNodes) {
    for (const rawId of [
      ...parseArray(node.prerequisite_ids_json),
      ...parseArray(node.related_ids_json),
    ]) {
      if (typeof rawId !== "string" || !nodeIds.has(rawId)) {
        messages.push(
          `Knowledge node ${node.knowledge_node_id} has an unresolved relation`,
        );
      }
    }
  }
  for (const capsule of record.knowledgeCapsules) {
    for (const rawId of parseArray(capsule.knowledge_node_ids_json)) {
      if (typeof rawId !== "string" || !nodeIds.has(rawId)) {
        messages.push(`Knowledge capsule ${capsule.id} has an unresolved node`);
      }
    }
  }
  for (const activity of record.activities) {
    for (const rawId of parseArray(activity.sources_json)) {
      if (typeof rawId !== "string" || !sourceIds.has(rawId)) {
        messages.push(
          `Activity ${activity.id} has an unresolved source snapshot`,
        );
      }
    }
    for (const rawId of parseArray(activity.knowledge_node_ids_json)) {
      if (typeof rawId !== "string" || !nodeIds.has(rawId)) {
        messages.push(
          `Activity ${activity.id} has an unresolved knowledge node`,
        );
      }
    }
  }
  return messages;
}

function transferDiagnostic(
  code: string,
  path: string,
  entityId: string | null,
  message: string,
  ruleId: string | null = null,
): CoursePackValidationReport["diagnostics"][number] {
  return {
    code,
    severity: "error",
    path,
    entityId,
    message,
    ruleId,
    context: "json-value",
  };
}

function transferReport(
  diagnostics: ReadonlyArray<CoursePackValidationReport["diagnostics"][number]>,
): CoursePackValidationReport {
  const bounded = diagnostics.slice(0, MAX_TRANSFER_DIAGNOSTICS);
  const errors = diagnostics.filter(
    (diagnostic) => diagnostic.severity === "error",
  ).length;
  const warnings = diagnostics.filter(
    (diagnostic) => diagnostic.severity === "warning",
  ).length;
  return {
    validatorVersion: TRANSFER_VALIDATOR_VERSION,
    valid: errors === 0,
    errors,
    warnings,
    diagnostics: bounded,
    limits: {
      ...COURSE_PACK_JSON_LIMITS_V1,
      maxBytes: COURSE_TRANSFER_JSON_LIMITS_V1.maxBytes,
    },
  };
}
function validateIncomingTransferRevisionHashes(
  envelope: CourseTransferEnvelope,
  envelopeHash: string,
): void {
  for (const snapshot of envelope.revisionSnapshots) {
    const record = CourseTransferRevisionSnapshotCanonicalSchema.parse(
      JSON.parse(snapshot.canonicalJson),
    );
    const graph = record.authoredGraph as unknown as CurriculumVersionGraph;
    if (
      `sha256:${hashCanonicalJson(publicationContent(graph))}` !==
      record.revisionContentHash
    ) {
      throw new CourseTransferInvalidError(
        transferReport([
          transferDiagnostic(
            "TRANSFER_REVISION_INVALID",
            `/revisionSnapshots/${snapshot.revisionKey}/revisionContentHash`,
            snapshot.revisionKey,
            "Revision content hash does not match the incoming authored graph",
          ),
        ]),
        envelopeHash,
      );
    }
  }
}

function transferInvalid(
  code: string,
  path: string,
  entityId: string | null,
  message: string,
  envelope: CourseTransferEnvelope,
): CourseTransferInvalidError {
  return new CourseTransferInvalidError(
    transferReport([transferDiagnostic(code, path, entityId, message)]),
    courseTransferBytesHash(UTF8_ENCODER.encode(JSON.stringify(envelope))),
  );
}

export function describeTransferSanitizationScope(): {
  scope: typeof courseTransferSanitizationScope;
  policy: typeof courseTransferSanitizationPolicy;
} {
  return {
    scope: courseTransferSanitizationScope,
    policy: courseTransferSanitizationPolicy,
  };
}

export function decodeTransferBytes(bytes: Uint8Array): string {
  return UTF8_DECODER.decode(bytes);
}

export function encodeTransferJson(value: CourseTransferEnvelope): Uint8Array {
  return UTF8_ENCODER.encode(canonicalJson(value));
}
