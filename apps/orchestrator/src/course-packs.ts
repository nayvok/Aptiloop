import { randomUUID } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  COURSE_PACK_JSON_LIMITS_V1,
  validateCoursePackBytes,
  type CoursePackPreview,
  type CoursePackValidationReport,
} from "@dlh/course-authoring-kit";
import {
  coursePackSourceBytesHash,
  CoursePackRepositoryError,
  type CoursePackRepository,
} from "@dlh/database";
import type { Hono } from "hono";
import { z } from "zod";

const VALIDATION_TTL_MILLISECONDS = 15 * 60 * 1_000;
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

interface StagedCoursePack {
  readonly directory: string;
  readonly filePath: string;
  readonly sourceBytesHash: string;
  readonly contentHash: string;
  readonly preview: CoursePackPreview;
  readonly report: CoursePackValidationReport;
  readonly expiresAt: number;
}

export interface CoursePackRouteOptions {
  readonly now?: () => number;
  readonly id?: () => string;
  readonly stagingRoot?: string;
}

export function registerCoursePackRoutes(
  app: Hono,
  repository: CoursePackRepository,
  options: CoursePackRouteOptions = {},
): void {
  const now = options.now ?? Date.now;
  const id = options.id ?? randomUUID;
  const stagingRoot = path.resolve(options.stagingRoot ?? tmpdir());
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
      sourceBytes = await readBoundedBody(
        context.req.raw,
        COURSE_PACK_JSON_LIMITS_V1.maxBytes,
      );
    } catch (error) {
      return context.json(
        {
          valid: false,
          error:
            error instanceof Error ? error.message : "Course Pack is too large",
        },
        413,
      );
    }

    const directory = await mkdtemp(
      path.join(stagingRoot, "aptiloop-course-pack-"),
    );
    await chmod(directory, 0o700);
    const filePath = path.join(directory, "pack.json");
    try {
      await writeFile(filePath, sourceBytes, { flag: "wx", mode: 0o600 });
      const validation = validateCoursePackBytes(sourceBytes);
      const sourceBytesHash = coursePackSourceBytesHash(sourceBytes);
      if (!validation.valid) {
        if (repository.hasStorage()) {
          repository.recordQuarantine(sourceBytesHash, validation.report);
        }
        return context.json({
          valid: false,
          storageAvailable: repository.hasStorage(),
          report: validation.report,
        });
      }

      const validationId = validationIdSchema.parse(id());
      const expiresAt = now() + VALIDATION_TTL_MILLISECONDS;
      staged.set(validationId, {
        directory,
        filePath,
        sourceBytesHash,
        contentHash: validation.contentHash,
        preview: validation.preview,
        report: validation.report,
        expiresAt,
      });
      return context.json({
        valid: true,
        storageAvailable: repository.hasStorage(),
        validationId,
        expiresAt: new Date(expiresAt).toISOString(),
        preview: validation.preview,
        report: validation.report,
      });
    } finally {
      if (
        ![...staged.values()].some((entry) => entry.directory === directory)
      ) {
        await removeStaging(directory);
      }
    }
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
      const entry = staged.get(validationId);
      if (!entry) {
        return context.json(
          { error: "Course Pack validation is missing or expired" },
          404,
        );
      }
      if (body.expectedContentHash !== entry.contentHash) {
        return context.json(
          { error: "Course Pack confirmation hash does not match Preview" },
          409,
        );
      }

      const sourceBytes = new Uint8Array(await readFile(entry.filePath));
      const validation = validateCoursePackBytes(sourceBytes);
      if (
        !validation.valid ||
        validation.contentHash !== entry.contentHash ||
        coursePackSourceBytesHash(sourceBytes) !== entry.sourceBytesHash
      ) {
        staged.delete(validationId);
        await removeStaging(entry.directory);
        return context.json(
          { error: "Staged Course Pack changed after validation" },
          409,
        );
      }
      let result: ReturnType<CoursePackRepository["install"]>;
      try {
        result = repository.install({
          operationId: body.operationId,
          action: body.action,
          sourceBytesHash: entry.sourceBytesHash,
          pack: validation.pack,
          canonicalJson: validation.canonicalJson,
          report: validation.report,
        });
      } catch (error) {
        if (error instanceof CoursePackRepositoryError) {
          return context.json(
            { error: error.message },
            error.code === "not_found" ? 404 : 409,
          );
        }
        throw error;
      }
      staged.delete(validationId);
      await removeStaging(entry.directory);
      return context.json(
        {
          result,
          openPath:
            body.action === "install"
              ? `/courses/${encodeURIComponent(result.courseId)}/revisions/${encodeURIComponent(result.revisionId)}`
              : null,
        },
        result.installed ? 201 : 200,
      );
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
          { error: error.message },
          error.code === "not_found" ? 404 : 409,
        );
      }
      throw error;
    }
  });
}

async function readBoundedBody(
  request: Request,
  maxBytes: number,
): Promise<Uint8Array> {
  const declaredLength = request.headers.get("Content-Length");
  if (declaredLength !== null) {
    const parsed = Number(declaredLength);
    if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > maxBytes) {
      throw new Error(`Course Pack exceeds ${maxBytes} bytes`);
    }
  }
  if (request.body === null) return new Uint8Array();
  const buffer = new Uint8Array(maxBytes);
  const reader = request.body.getReader();
  let length = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (length + chunk.value.byteLength > maxBytes) {
        await reader.cancel();
        throw new Error(`Course Pack exceeds ${maxBytes} bytes`);
      }
      buffer.set(chunk.value, length);
      length += chunk.value.byteLength;
    }
    return buffer.slice(0, length);
  } finally {
    reader.releaseLock();
  }
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
      staged.delete(validationId);
      await removeStaging(entry.directory);
    }),
  );
}

async function removeStaging(directory: string): Promise<void> {
  await rm(directory, { recursive: true, force: true });
}
