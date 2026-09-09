import { randomUUID } from "node:crypto";

import {
  buildCourseTransferExport,
  commitCourseTransfer,
  courseTransferBytesHash,
  listActiveAttemptDescriptors,
  previewCourseTransferConflicts,
  validateCourseTransferBytes,
  withTransaction,
  type CourseTransferAttemptDescriptor,
  type CourseTransferExportInput,
} from "@aptiloop/database";
import type {
  CoursePackRepository,
  DatabaseConnection,
} from "@aptiloop/database";
import {
  COURSE_TRANSFER_JSON_LIMITS_V1,
  ClientError,
  CourseTransferCommitRequestSchema,
  CourseTransferEnvelopeSchema,
  CourseTransferExportRequestSchema,
  CourseTransferPreviewSchema,
  type CoursePackStagedValidationReportDto,
  type CourseTransferEnvelope,
  type CourseTransferPreview,
} from "@aptiloop/shared";
import {
  restoreExerciseAttempt,
  snapshotExerciseAttempt,
  type AttemptTransferSnapshot,
} from "@aptiloop/exercise-core";
import type { Hono } from "hono";
import { z } from "zod";

import { boundedStagedReport } from "./course-packs.js";
import {
  readBoundedRequestBody,
  RequestBodyAdmissionError,
} from "./http-resource-admission.js";

const DEFAULT_VALIDATION_TTL_MILLISECONDS = 15 * 60 * 1_000;
const DEFAULT_MAX_STAGED_VALIDATIONS = 32;
const validationIdSchema = z.string().uuid();
const UTF8_ENCODER = new TextEncoder();

type StagedTransferBase = {
  readonly envelopeHash: string;
  readonly operationId: string | null;
  readonly expiresAt: number;
  readonly report: CoursePackStagedValidationReportDto;
  expiryTimer: ReturnType<typeof setTimeout> | null;
};

type StagedTransfer = StagedTransferBase &
  (
    | {
        readonly valid: true;
        readonly envelope: CourseTransferEnvelope;
        readonly preview: CourseTransferPreview;
      }
    | {
        readonly valid: false;
      }
  );

export interface CourseTransferRouteOptions {
  readonly connection: DatabaseConnection;
  readonly coursePacks: CoursePackRepository;
  readonly exerciseAttemptsRoot?: string;
  /** App version recorded in exported transfer manifests as metadata. */
  readonly originatingAppVersion: string;
  readonly now?: () => number;
  readonly id?: () => string;
  readonly validationTtlMilliseconds?: number;
  readonly maxStagedValidations?: number;
  readonly materializeAttemptWorkspace?: (input: {
    readonly attemptId: string;
    readonly exerciseId: string;
    readonly trustedTemplateId: string;
  }) => Promise<{
    readonly workspacePath: string;
    readonly baselinePath: string;
    readonly baselineCommit: string;
    readonly workspaceHandleId: string;
    readonly cleanup: () => Promise<void>;
  }>;
}

export function registerCourseTransferRoutes(
  app: Hono,
  options: CourseTransferRouteOptions,
): void {
  const now = options.now ?? Date.now;
  const id = options.id ?? randomUUID;
  const ttl =
    options.validationTtlMilliseconds ?? DEFAULT_VALIDATION_TTL_MILLISECONDS;
  const maxStaged =
    options.maxStagedValidations ?? DEFAULT_MAX_STAGED_VALIDATIONS;
  const staged = new Map<string, StagedTransfer>();

  app.post("/api/course-transfer/export", async (context) => {
    const request = CourseTransferExportRequestSchema.parse(
      await context.req.json(),
    );
    const exported = await buildTransferExport(
      options.connection,
      { ...request, originatingAppVersion: options.originatingAppVersion },
      options.exerciseAttemptsRoot,
    );
    context.header("Cache-Control", "no-store");
    context.header(
      "Content-Disposition",
      `attachment; filename="${exported.filename.replaceAll(/[^A-Za-z0-9._-]/gu, "-")}"`,
    );
    context.header("Content-Type", "application/json; charset=utf-8");
    return context.body(`${exported.envelopeJson}\n`);
  });

  app.post("/api/course-transfer/validate", async (context) => {
    await cleanupExpired(staged, now());
    let bytes: Uint8Array;
    try {
      bytes = await readBoundedRequestBody(
        context.req.raw,
        COURSE_TRANSFER_JSON_LIMITS_V1.maxBytes,
        `Course transfer exceeds ${COURSE_TRANSFER_JSON_LIMITS_V1.maxBytes} bytes`,
      );
    } catch (error) {
      const status =
        error instanceof RequestBodyAdmissionError ? error.status : 413;
      return context.json(
        {
          valid: false,
          error:
            error instanceof Error
              ? error.message
              : "Course transfer is too large",
        },
        status,
      );
    }
    const validation = validateCourseTransferBytes(bytes);
    if (
      !validation.valid ||
      validation.envelope === null ||
      validation.preview === null
    ) {
      const report = boundedStagedReport(validation.report, 100, 64 * 1_024);
      const validationId = validationIdSchema.parse(id());
      if (options.coursePacks.hasStorage()) {
        options.coursePacks.recordQuarantine(
          validation.envelopeHash,
          validation.report,
        );
      }
      const entry: StagedTransfer = {
        valid: false,
        envelopeHash: validation.envelopeHash,
        operationId: null,
        report,
        expiresAt: now() + ttl,
        expiryTimer: null,
      };
      await stageTransfer(staged, validationId, entry, maxStaged, now);
      return context.json({
        valid: false,
        validationId,
        expiresAt: new Date(entry.expiresAt).toISOString(),
        storageAvailable: options.coursePacks.hasStorage(),
        envelopeHash: entry.envelopeHash,
        report,
        diagnostics: report.diagnostics,
      });
    }
    const validationId = validationIdSchema.parse(id());
    const preview = CourseTransferPreviewSchema.parse({
      ...validation.preview,
      appVersionMatches:
        validation.envelope.manifest.originatingAppVersion ===
        options.originatingAppVersion,
      conflicts: previewCourseTransferConflicts(
        options.connection,
        validation.envelope,
      ),
    });
    const entry: StagedTransfer = {
      valid: true,
      envelope: validation.envelope,
      envelopeHash: validation.envelopeHash,
      preview,
      operationId: validation.envelope.manifest.operationId,
      report: boundedStagedReport(validation.report, 100, 64 * 1_024),
      expiresAt: now() + ttl,
      expiryTimer: null,
    };
    await stageTransfer(staged, validationId, entry, maxStaged, now);
    return context.json({
      valid: true,
      validationId,
      expiresAt: new Date(entry.expiresAt).toISOString(),
      storageAvailable: options.coursePacks.hasStorage(),
      envelopeHash: entry.envelopeHash,
      preview: entry.preview,
    });
  });

  app.get("/api/course-transfer/validations/:validationId", async (context) => {
    await cleanupExpired(staged, now());
    const validationId = validationIdSchema.safeParse(
      context.req.param("validationId"),
    );
    if (!validationId.success) {
      return context.json(
        { error: "Invalid Course transfer validation identifier" },
        400,
      );
    }
    const entry = staged.get(validationId.data);
    if (!entry) {
      return context.json(
        { error: "Course transfer validation is missing or expired" },
        404,
      );
    }
    if (!entry.valid) {
      return context.json({
        valid: false,
        validationId: validationId.data,
        expiresAt: new Date(entry.expiresAt).toISOString(),
        storageAvailable: options.coursePacks.hasStorage(),
        envelopeHash: entry.envelopeHash,
        report: entry.report,
        diagnostics: entry.report.diagnostics,
      });
    }
    return context.json({
      valid: true,
      validationId: validationId.data,
      expiresAt: new Date(entry.expiresAt).toISOString(),
      storageAvailable: options.coursePacks.hasStorage(),
      envelopeHash: entry.envelopeHash,
      preview: entry.preview,
    });
  });

  app.post(
    "/api/course-transfer/validations/:validationId/commit",
    async (context) => {
      await cleanupExpired(staged, now());
      const validationId = validationIdSchema.safeParse(
        context.req.param("validationId"),
      );
      if (!validationId.success) {
        return context.json(
          { error: "Invalid Course transfer validation identifier" },
          400,
        );
      }
      const entry = staged.get(validationId.data);
      if (!entry) {
        return context.json(
          { error: "Course transfer validation is missing or expired" },
          404,
        );
      }
      if (!entry.valid) {
        return context.json(
          { error: "Course transfer validation did not pass" },
          409,
        );
      }
      if (!options.coursePacks.hasStorage()) {
        return context.json(
          { error: "Course transfer storage is unavailable" },
          503,
        );
      }
      const request = CourseTransferCommitRequestSchema.parse(
        await context.req.json(),
      );
      if (request.expectedEnvelopeHash !== entry.envelopeHash) {
        return context.json(
          {
            error:
              "Course transfer confirmation hash does not match validation",
          },
          409,
        );
      }
      const materialized: Array<{
        readonly attemptId: string;
        readonly workspacePath: string;
        readonly baselinePath: string;
        readonly baselineCommit: string;
        readonly workspaceHandleId: string;
        readonly existing: boolean;
        readonly cleanup: () => Promise<void>;
      }> = [];
      try {
        for (const snapshot of entry.envelope.learnerScope.attemptSnapshots) {
          const existing = options.connection.sqlite
            .prepare(
              `SELECT session_id, exercise_id, workspace_path, baseline_path,
                    baseline_hash, workspace_handle_id
             FROM exercise_attempts WHERE id = ?`,
            )
            .get(snapshot.attemptId) as
            | {
                session_id: string;
                exercise_id: string;
                workspace_path: string;
                baseline_path: string;
                baseline_hash: string;
                workspace_handle_id: string | null;
              }
            | undefined;
          if (existing) {
            if (
              existing.session_id !== snapshot.sessionId ||
              existing.exercise_id !== snapshot.exerciseId ||
              existing.baseline_hash !== snapshot.baselineCommit ||
              existing.workspace_handle_id === null
            ) {
              throw new ClientError(
                409,
                "Transferred exercise attempt collides with local data",
              );
            }
            materialized.push({
              attemptId: snapshot.attemptId,
              workspacePath: existing.workspace_path,
              baselinePath: existing.baseline_path,
              baselineCommit: existing.baseline_hash,
              workspaceHandleId: existing.workspace_handle_id,
              existing: true,
              cleanup: async () => {},
            });
            continue;
          }
          if (!options.materializeAttemptWorkspace) {
            throw new ClientError(
              409,
              "Active exercise attempts require an app-owned workspace materializer",
            );
          }
          const workspace = await options.materializeAttemptWorkspace({
            attemptId: snapshot.attemptId,
            exerciseId: snapshot.exerciseId,
            trustedTemplateId: snapshot.trustedTemplateId,
          });
          materialized.push({
            attemptId: snapshot.attemptId,
            existing: false,
            ...workspace,
          });
          await restoreExerciseAttempt({
            destinationRoot: workspace.workspacePath,
            snapshot,
            expectedBaselineCommit: workspace.baselineCommit,
          });
        }
        const result = withTransaction(options.connection, () => {
          const committed = commitCourseTransfer(
            options.connection,
            options.coursePacks,
            {
              operationId: request.operationId,
              envelope: entry.envelope,
              envelopeHash: entry.envelopeHash,
              expectedEnvelopeHash: request.expectedEnvelopeHash,
              resolutions: request.resolutions,
            },
          );
          for (const [
            index,
            snapshot,
          ] of entry.envelope.learnerScope.attemptSnapshots.entries()) {
            const workspace = materialized[index]!;
            options.connection.sqlite
              .prepare(
                `INSERT INTO exercise_attempts
               (id, session_id, exercise_id, status, workspace_path, baseline_path,
                baseline_hash, workspace_handle_id, workspace_generation, started_at,
                completed_at, updated_at)
               VALUES (?, ?, ?, 'active', ?, ?, ?, ?, 1, ?, NULL, ?)`,
              )
              .run(
                snapshot.attemptId,
                snapshot.sessionId,
                snapshot.exerciseId,
                workspace.workspacePath,
                workspace.baselinePath,
                workspace.baselineCommit,
                workspace.workspaceHandleId,
                Date.parse(snapshot.createdAt),
                now(),
              );
          }
          return committed;
        });
        claimTransfer(staged, validationId.data, entry);
        return context.json({
          ...result,
          restoredAttempts: materialized.length,
        });
      } catch (error) {
        await Promise.all(materialized.map((attempt) => attempt.cleanup()));
        throw error;
      }
    },
  );
}

async function buildTransferExport(
  connection: DatabaseConnection,
  request: CourseTransferExportInput,
  exerciseAttemptsRoot: string | undefined,
) {
  const exported = buildCourseTransferExport(connection, request);
  const parsed = CourseTransferEnvelopeSchema.parse(
    JSON.parse(exported.envelopeJson),
  );
  const descriptors = listActiveAttemptDescriptors(
    connection.sqlite,
    request.courseKeys,
  );
  const attemptSnapshots =
    [] as CourseTransferEnvelope["learnerScope"]["attemptSnapshots"];
  if (descriptors.length > 0 && exerciseAttemptsRoot === undefined) {
    throw new ClientError(
      409,
      "Active exercise attempts require a server-owned attempt root",
    );
  }
  for (const descriptor of descriptors) {
    try {
      const snapshot = await snapshotExerciseAttempt({
        workspaceRoot: descriptor.workspacePath,
        trustedTemplateId: descriptor.trustedTemplateId,
        baselineCommit: descriptor.baselineCommit,
      });
      attemptSnapshots.push(toTransferAttemptSnapshot(descriptor, snapshot));
    } catch {
      throw new ClientError(
        409,
        `Active exercise attempt ${descriptor.attemptId} could not be captured for transfer`,
      );
    }
  }
  const attemptByteCount = attemptSnapshots.reduce(
    (total, attempt) =>
      total +
      new TextEncoder().encode(attempt.workingTreeDiff).byteLength +
      attempt.learnerCommits.reduce(
        (commitTotal, commit) =>
          commitTotal + new TextEncoder().encode(commit.patch).byteLength,
        0,
      ) +
      attempt.untrackedBlobs.reduce(
        (blobTotal, blob) => blobTotal + blob.sizeBytes,
        0,
      ),
    0,
  );
  const envelope = CourseTransferEnvelopeSchema.parse({
    ...parsed,
    manifest: {
      ...parsed.manifest,
      attemptSnapshotCount: attemptSnapshots.length,
      attemptByteCount,
    },
    learnerScope: {
      ...parsed.learnerScope,
      attemptSnapshots,
    },
  });
  const envelopeJson = JSON.stringify(envelope);
  const bytes = UTF8_ENCODER.encode(envelopeJson);
  return {
    envelopeJson,
    envelopeHash: courseTransferBytesHash(bytes),
    filename: exported.filename,
    preview: {
      ...exported.preview,
      attemptSnapshotCount: attemptSnapshots.length,
      attemptByteCount,
    },
  };
}

function toTransferAttemptSnapshot(
  descriptor: CourseTransferAttemptDescriptor,
  snapshot: AttemptTransferSnapshot,
): CourseTransferEnvelope["learnerScope"]["attemptSnapshots"][number] {
  return {
    attemptId: descriptor.attemptId,
    sessionId: descriptor.sessionId,
    courseId: descriptor.courseId,
    revisionId: descriptor.revisionId,
    exerciseId: descriptor.exerciseId,
    trustedTemplateId: snapshot.trustedTemplateId,
    baselineCommit: snapshot.baselineCommit,
    learnerCommits: [...snapshot.learnerCommits],
    workingTreeDiff: snapshot.workingTreeDiff,
    untrackedBlobs: [...snapshot.untrackedBlobs],
    treeHash: snapshot.treeHash,
    diffHash: snapshot.diffHash,
    createdAt: descriptor.startedAt,
  };
}

async function cleanupExpired(
  staged: Map<string, StagedTransfer>,
  currentTime: number,
): Promise<void> {
  for (const [validationId, entry] of staged) {
    if (entry.expiresAt <= currentTime)
      claimTransfer(staged, validationId, entry);
  }
}

async function stageTransfer(
  staged: Map<string, StagedTransfer>,
  validationId: string,
  entry: StagedTransfer,
  maxEntries: number,
  now: () => number,
): Promise<void> {
  while (staged.size >= Math.max(1, maxEntries)) {
    const oldest = staged.entries().next().value as
      [string, StagedTransfer] | undefined;
    if (!oldest) break;
    claimTransfer(staged, oldest[0], oldest[1]);
  }
  staged.set(validationId, entry);
  const delay = Math.max(0, entry.expiresAt - now());
  entry.expiryTimer = setTimeout(() => {
    if (staged.get(validationId) !== entry) return;
    claimTransfer(staged, validationId, entry);
  }, delay);
  entry.expiryTimer.unref?.();
}

function claimTransfer(
  staged: Map<string, StagedTransfer>,
  validationId: string,
  entry: StagedTransfer,
): void {
  if (staged.get(validationId) !== entry) return;
  staged.delete(validationId);
  if (entry.expiryTimer !== null) clearTimeout(entry.expiryTimer);
  entry.expiryTimer = null;
}
