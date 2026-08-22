import { randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  COURSE_PACK_JSON_LIMITS_V1,
  prepareCoursePackBytes,
  type CoursePackSourceKind,
  type CoursePackPreview,
  type CoursePackValidationReport,
} from "@aptiloop/course-authoring-kit";
import {
  coursePackSourceBytesHash,
  CoursePackRepositoryError,
  type CoursePackInstallResult,
  type CoursePackRepository,
} from "@aptiloop/database";
import {
  ClientError,
  CoursePackStagedValidationResponseSchema,
  type CoursePackStagedValidationResponse,
} from "@aptiloop/shared";
import type { Hono } from "hono";
import { z } from "zod";

import {
  readBoundedRequestBody,
  RequestBodyAdmissionError,
} from "./http-resource-admission.js";

const VALIDATION_TTL_MILLISECONDS = 15 * 60 * 1_000;
const MAX_STAGED_VALIDATIONS = 32;
const MAX_STAGED_DIAGNOSTICS = 100;
const MAX_STAGED_REPORT_BYTES = 64 * 1_024;
const STAGING_REMOVAL_ATTEMPTS = 3;
const validationIdSchema = z.string().uuid();
const commitSchema = z
  .object({
    operationId: z.string().trim().min(1).max(200),
    action: z.enum(["install", "open-as-draft"]),
    expectedContentHash: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
  })
  .strict();
const uninstallSchema = z
  .object({
    operationId: z.string().trim().min(1).max(200),
    revisionId: z.string().trim().min(1).max(200),
    confirmRevisionKey: z.string().trim().min(1).max(200),
  })
  .strict();

interface StagedCoursePackBase {
  readonly report: CoursePackValidationReport;
  readonly expiresAt: number;
  expiryTimer: ReturnType<typeof setTimeout> | null;
  readonly sourceKind: CoursePackSourceKind;
  readonly finalized: boolean;
}

interface StagedValidCoursePack extends StagedCoursePackBase {
  readonly valid: true;
  readonly directory: string;
  readonly preparedFilePath: string;
  readonly sourceFilePath: string;
  readonly sourceBytesHash: string;
  readonly stagedBytesHash: string;
  readonly contentHash: string;
  readonly preview: CoursePackPreview;
}

interface StagedInvalidCoursePack extends StagedCoursePackBase {
  readonly valid: false;
}

type StagedCoursePack = StagedValidCoursePack | StagedInvalidCoursePack;

export interface CoursePackRouteOptions {
  readonly now?: () => number;
  readonly id?: () => string;
  readonly stagingRoot?: string;
  readonly validationTtlMilliseconds?: number;
  readonly maxStagedValidations?: number;
  readonly maxStagedDiagnostics?: number;
  readonly maxStagedReportBytes?: number;
}

export function registerCoursePackRoutes(
  app: Hono,
  repository: CoursePackRepository,
  options: CoursePackRouteOptions = {},
): void {
  const now = options.now ?? Date.now;
  const id = options.id ?? randomUUID;
  const stagingRoot = path.resolve(options.stagingRoot ?? tmpdir());
  const validationTtlMilliseconds =
    options.validationTtlMilliseconds ?? VALIDATION_TTL_MILLISECONDS;
  const maxStagedValidations =
    options.maxStagedValidations ?? MAX_STAGED_VALIDATIONS;
  const maxStagedDiagnostics =
    options.maxStagedDiagnostics ?? MAX_STAGED_DIAGNOSTICS;
  const maxStagedReportBytes =
    options.maxStagedReportBytes ?? MAX_STAGED_REPORT_BYTES;
  const staged = new Map<string, StagedCoursePack>();

  app.get("/api/course-packs", (context) =>
    context.json({
      storageAvailable: repository.hasStorage(),
      packs: repository.list(),
    }),
  );

  app.post("/api/course-packs/validate", async (context) => {
    await cleanupExpired(staged, now());
    let sourceBytes: Uint8Array;
    try {
      sourceBytes = await readBoundedRequestBody(
        context.req.raw,
        COURSE_PACK_JSON_LIMITS_V1.maxBytes,
        `Course Pack exceeds ${COURSE_PACK_JSON_LIMITS_V1.maxBytes} bytes`,
      );
    } catch (error) {
      const status =
        error instanceof RequestBodyAdmissionError ? error.status : 413;
      return context.json(
        {
          valid: false,
          error:
            error instanceof Error ? error.message : "Course Pack is too large",
        },
        status,
      );
    }

    let directory: string;
    try {
      directory = await createStagingDirectory(stagingRoot);
    } catch {
      return context.json(
        {
          valid: false,
          error: "Course Pack staging is unavailable",
          code: "COURSE_PACK_STAGING_FAILED",
        },
        503,
      );
    }
    const sourceFilePath = path.join(directory, "source.json");
    const preparedFilePath = path.join(directory, "pack.json");
    try {
      await writeFile(sourceFilePath, sourceBytes, { flag: "wx", mode: 0o600 });
      const validation = prepareCoursePackBytes(sourceBytes);
      const sourceBytesHash = coursePackSourceBytesHash(sourceBytes);
      const validationId = validationIdSchema.parse(id());
      const expiresAt = now() + validationTtlMilliseconds;
      const report = boundedStagedReport(
        validation.report,
        maxStagedDiagnostics,
        maxStagedReportBytes,
      );
      if (!validation.valid) {
        if (repository.hasStorage()) {
          repository.recordQuarantine(sourceBytesHash, validation.report);
        }
        const stagedValidation: StagedInvalidCoursePack = {
          valid: false,
          report,
          expiresAt,
          expiryTimer: null,
          sourceKind: validation.sourceKind,
          finalized: validation.finalized,
        };
        await stageValidation(
          staged,
          validationId,
          stagedValidation,
          maxStagedValidations,
          now,
        );
        return context.json(
          stagedValidationResponse(
            validationId,
            stagedValidation,
            repository.hasStorage(),
          ),
        );
      }
      await writeFile(preparedFilePath, validation.preparedBytes, {
        flag: "wx",
        mode: 0o600,
      });

      const stagedValidation: StagedValidCoursePack = {
        valid: true,
        directory,
        preparedFilePath,
        sourceFilePath,
        sourceBytesHash,
        stagedBytesHash: coursePackSourceBytesHash(validation.preparedBytes),
        contentHash: validation.contentHash,
        preview: validation.preview,
        report,
        expiresAt,
        expiryTimer: null,
        sourceKind: validation.sourceKind,
        finalized: validation.finalized,
      };
      await stageValidation(
        staged,
        validationId,
        stagedValidation,
        maxStagedValidations,
        now,
      );
      return context.json(
        stagedValidationResponse(
          validationId,
          stagedValidation,
          repository.hasStorage(),
        ),
      );
    } catch (error) {
      if (!isStagingFileSystemError(error)) throw error;
      return context.json(
        {
          valid: false,
          error: "Course Pack staging failed",
          code: "COURSE_PACK_STAGING_FAILED",
        },
        503,
      );
    } finally {
      if (
        ![...staged.values()].some(
          (entry) => entry.valid && entry.directory === directory,
        )
      ) {
        await removeStaging(directory);
      }
    }
  });

  app.get("/api/course-packs/validations/:validationId", async (context) => {
    context.header("Cache-Control", "no-store");
    await cleanupExpired(staged, now());
    const parsedValidationId = validationIdSchema.safeParse(
      context.req.param("validationId"),
    );
    if (!parsedValidationId.success) {
      return context.json(
        { error: "Invalid Course Pack validation identifier" },
        400,
      );
    }
    const entry = staged.get(parsedValidationId.data);
    if (!entry) {
      return context.json(
        { error: "Course Pack validation is missing or expired" },
        404,
      );
    }
    touchValidation(staged, parsedValidationId.data, entry);
    return context.json(
      stagedValidationResponse(
        parsedValidationId.data,
        entry,
        repository.hasStorage(),
      ),
    );
  });

  app.post(
    "/api/course-packs/validations/:validationId/commit",
    async (context) => {
      await cleanupExpired(staged, now());
      if (!repository.hasStorage()) {
        return context.json(
          {
            error:
              "Course Pack storage is unavailable until the approved M3 migration is applied",
          },
          503,
        );
      }
      const validationId = validationIdSchema.parse(
        context.req.param("validationId"),
      );
      const body = commitSchema.parse(await context.req.json());
      try {
        const reconciled = repository.reconcileInstall({
          operationId: body.operationId,
          validationId,
          action: body.action,
          expectedContentHash: body.expectedContentHash,
        });
        if (reconciled) {
          return context.json({
            result: reconciled,
            openPath: coursePackOpenPath(reconciled),
          });
        }
      } catch (error) {
        if (error instanceof CoursePackRepositoryError) {
          return context.json(
            { error: error.message, code: error.code },
            error.code === "not_found" ? 404 : 409,
          );
        }
        throw error;
      }
      const entry = staged.get(validationId);
      if (!entry) {
        return context.json(
          { error: "Course Pack validation is missing or expired" },
          404,
        );
      }
      if (!entry.valid) {
        return context.json(
          { error: "Course Pack validation did not pass" },
          409,
        );
      }
      if (body.expectedContentHash !== entry.contentHash) {
        return context.json(
          { error: "Course Pack confirmation hash does not match Preview" },
          409,
        );
      }

      claimValidation(staged, validationId, entry);
      try {
        const sourceBytes = new Uint8Array(
          await readFile(entry.sourceFilePath),
        );
        if (coursePackSourceBytesHash(sourceBytes) !== entry.sourceBytesHash) {
          return context.json(
            { error: "Staged Course Pack changed after validation" },
            409,
          );
        }
        const preparation = prepareCoursePackBytes(sourceBytes);
        if (
          !preparation.valid ||
          preparation.contentHash !== entry.contentHash ||
          preparation.sourceKind !== entry.sourceKind ||
          preparation.finalized !== entry.finalized ||
          coursePackSourceBytesHash(preparation.preparedBytes) !==
            entry.stagedBytesHash
        ) {
          return context.json(
            { error: "Staged Course Pack changed after validation" },
            409,
          );
        }
        const stagedBytes = new Uint8Array(
          await readFile(entry.preparedFilePath),
        );
        if (coursePackSourceBytesHash(stagedBytes) !== entry.stagedBytesHash) {
          return context.json(
            { error: "Staged Course Pack changed after validation" },
            409,
          );
        }
        let result: CoursePackInstallResult;
        try {
          result = repository.install({
            operationId: body.operationId,
            validationId,
            action: body.action,
            sourceBytesHash: entry.sourceBytesHash,
            pack: preparation.pack,
            canonicalJson: preparation.canonicalJson,
            report: preparation.report,
          });
        } catch (error) {
          if (error instanceof CoursePackRepositoryError) {
            return context.json(
              { error: error.message, code: error.code },
              error.code === "not_found" ? 404 : 409,
            );
          }
          throw error;
        }
        return context.json(
          {
            result,
            openPath: coursePackOpenPath(result),
          },
          result.installed ? 201 : 200,
        );
      } finally {
        await removeStaging(entry.directory);
      }
    },
  );

  app.get("/api/course-packs/export", (context) => {
    const revisionId = z
      .string()
      .trim()
      .min(1)
      .max(200)
      .parse(context.req.query("revisionId"));
    const canonical = repository.exportCanonicalJson(revisionId);
    if (canonical === null) {
      return context.json({ error: "Unknown Course Pack revision" }, 404);
    }
    const filename = `${revisionId.replaceAll(/[^A-Za-z0-9._-]/gu, "-")}.course-pack.json`;
    return new Response(`${canonical}\n`, {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Type": "application/json; charset=utf-8",
      },
    });
  });

  app.post("/api/course-packs/uninstall", async (context) => {
    if (!repository.hasStorage()) {
      return context.json(
        {
          error:
            "Course Pack storage is unavailable until the approved M3 migration is applied",
        },
        503,
      );
    }
    const body = uninstallSchema.parse(await context.req.json());
    try {
      return context.json({ result: repository.uninstall(body) });
    } catch (error) {
      if (error instanceof CoursePackRepositoryError) {
        return context.json(
          { error: error.message, code: error.code },
          error.code === "not_found" ? 404 : 409,
        );
      }
      throw error;
    }
  });
}

function coursePackOpenPath(result: {
  action: "install" | "open-as-draft";
  courseId: string;
  revisionId: string;
}): string | null {
  return result.action === "install"
    ? `/courses/${encodeURIComponent(result.courseId)}/revisions/${encodeURIComponent(result.revisionId)}`
    : null;
}

async function cleanupExpired(
  staged: Map<string, StagedCoursePack>,
  now: number,
): Promise<void> {
  const expired = [...staged.entries()].filter(
    ([, entry]) => entry.expiresAt <= now,
  );
  await Promise.all(
    expired.map(async ([validationId, entry]) => {
      claimValidation(staged, validationId, entry);
      if (entry.valid) await removeStaging(entry.directory);
    }),
  );
}

async function stageValidation(
  staged: Map<string, StagedCoursePack>,
  validationId: string,
  entry: StagedCoursePack,
  maxEntries: number,
  now: () => number,
): Promise<void> {
  const removals: Promise<void>[] = [];
  while (staged.size >= Math.max(1, maxEntries)) {
    const oldest = staged.entries().next().value as
      [string, StagedCoursePack] | undefined;
    if (!oldest) break;
    claimValidation(staged, oldest[0], oldest[1]);
    if (oldest[1].valid) removals.push(removeStaging(oldest[1].directory));
  }
  staged.set(validationId, entry);
  const delay = Math.max(0, entry.expiresAt - now());
  entry.expiryTimer = setTimeout(() => {
    if (staged.get(validationId) !== entry) return;
    claimValidation(staged, validationId, entry);
    if (entry.valid) void removeStaging(entry.directory).catch(() => undefined);
  }, delay);
  entry.expiryTimer.unref?.();
  await Promise.all(removals);
}

function claimValidation(
  staged: Map<string, StagedCoursePack>,
  validationId: string,
  entry: StagedCoursePack,
): void {
  if (staged.get(validationId) !== entry) return;
  staged.delete(validationId);
  if (entry.expiryTimer !== null) clearTimeout(entry.expiryTimer);
  entry.expiryTimer = null;
}

function touchValidation(
  staged: Map<string, StagedCoursePack>,
  validationId: string,
  entry: StagedCoursePack,
): void {
  if (staged.get(validationId) !== entry) return;
  staged.delete(validationId);
  staged.set(validationId, entry);
}

function boundedStagedReport(
  report: CoursePackValidationReport,
  maxDiagnostics: number,
  maxBytes: number,
): CoursePackValidationReport {
  const diagnostics = report.diagnostics
    .slice(0, Math.min(MAX_STAGED_DIAGNOSTICS, Math.max(0, maxDiagnostics)))
    .map((diagnostic) => ({
      code: diagnostic.code.slice(0, 100),
      severity: diagnostic.severity,
      path: diagnostic.path.slice(0, 1_000),
      entityId: diagnostic.entityId?.slice(0, 200) ?? null,
      message: diagnostic.message.slice(0, 2_000),
      ruleId: diagnostic.ruleId?.slice(0, 100) ?? null,
      context: diagnostic.context,
    }));
  const bounded: CoursePackValidationReport = { ...report, diagnostics };
  const byteLimit = Math.max(4_096, maxBytes);
  while (
    bounded.diagnostics.length > 0 &&
    Buffer.byteLength(JSON.stringify(bounded), "utf8") > byteLimit
  ) {
    diagnostics.pop();
  }
  if (Buffer.byteLength(JSON.stringify(bounded), "utf8") > byteLimit) {
    throw new ClientError(
      400,
      "Course Pack validation report exceeds the staging limit",
    );
  }
  return bounded;
}

function stagedValidationResponse(
  validationId: string,
  entry: StagedCoursePack,
  storageAvailable: boolean,
): CoursePackStagedValidationResponse {
  const base = {
    storageAvailable,
    validationId,
    expiresAt: new Date(entry.expiresAt).toISOString(),
    report: entry.report,
    sourceKind: entry.sourceKind,
    finalized: entry.finalized,
  };
  return CoursePackStagedValidationResponseSchema.parse(
    entry.valid
      ? { valid: true as const, ...base, preview: entry.preview }
      : { valid: false as const, ...base },
  );
}

async function removeStaging(directory: string): Promise<void> {
  for (let attempt = 1; attempt <= STAGING_REMOVAL_ATTEMPTS; attempt += 1) {
    try {
      await rm(directory, { recursive: true, force: true });
      return;
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error
          ? error.code
          : null;
      if (
        (code !== "EPERM" && code !== "EBUSY") ||
        attempt === STAGING_REMOVAL_ATTEMPTS
      ) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, attempt * 25));
    }
  }
}

async function createStagingDirectory(stagingRoot: string): Promise<string> {
  const directory = await mkdtemp(
    path.join(stagingRoot, "aptiloop-course-pack-"),
  );
  try {
    await chmod(directory, 0o700);
    return directory;
  } catch (error) {
    await removeStaging(directory);
    throw error;
  }
}

function isStagingFileSystemError(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  switch (error.code) {
    case "EACCES":
    case "EBUSY":
    case "EDQUOT":
    case "EEXIST":
    case "EIO":
    case "EMFILE":
    case "ENFILE":
    case "ENOENT":
    case "ENOSPC":
    case "EPERM":
    case "EROFS":
      return true;
    default:
      return false;
  }
}
