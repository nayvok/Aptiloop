import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";

import {
  compareVersions,
  parseGithubRelease,
  parseTagVersion,
  type GithubReleasePayload,
  type ReleaseInfo,
} from "@aptiloop/update-core";

export type UpdateReleaseAsset = ReleaseInfo["assets"][number];
export type UpdateRelease = ReleaseInfo;
export type UpdateOperationState =
  "queued" | "running" | "succeeded" | "failed";
export type UpdatePhase =
  | "backup"
  | "candidate"
  | "migration"
  | "health"
  | "pointer"
  | "restart"
  | "rollback";
export interface UpdateOperation {
  readonly operationId: string;
  readonly tag: string;
  readonly state: UpdateOperationState;
  readonly phase?: UpdatePhase;
  readonly startedAt: string;
  readonly finishedAt?: string;
  readonly message?: string;
  readonly evidencePath?: string;
}
const operationIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const updatePhaseSchema = z.enum([
  "backup",
  "candidate",
  "migration",
  "health",
  "pointer",
  "restart",
  "rollback",
]);
const updateOperationStateSchema = z.enum([
  "queued",
  "running",
  "succeeded",
  "failed",
]);
const updateOperationSchema = z
  .object({
    operationId: z.string().regex(operationIdPattern),
    tag: z
      .string()
      .regex(/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u)
      .max(128),
    state: updateOperationStateSchema,
    phase: updatePhaseSchema.optional(),
    startedAt: z.string().datetime({ offset: true }),
    finishedAt: z.string().datetime({ offset: true }).optional(),
    message: z.string().max(2_000).optional(),
    evidencePath: z.string().max(1_000).optional(),
  })
  .strict()
  .superRefine((operation, context) => {
    if (operation.state === "queued") {
      if (operation.phase !== undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Queued update operations cannot have a phase.",
          path: ["phase"],
        });
      }
      if (operation.finishedAt !== undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Queued update operations cannot have finishedAt.",
          path: ["finishedAt"],
        });
      }
    }
    if (operation.state === "running" && operation.phase === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Running update operations require a phase.",
        path: ["phase"],
      });
    }
    if (operation.state === "running" && operation.finishedAt !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Running update operations cannot have finishedAt.",
        path: ["finishedAt"],
      });
    }
    if (operation.state === "succeeded" && operation.phase !== "restart") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Succeeded update operations must finish in restart.",
        path: ["phase"],
      });
    }
    if (operation.state === "failed" && operation.phase !== "rollback") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Failed update operations must finish in rollback.",
        path: ["phase"],
      });
    }
    if (
      (operation.state === "succeeded" || operation.state === "failed") &&
      operation.finishedAt === undefined
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Terminal update operations require finishedAt.",
        path: ["finishedAt"],
      });
    }
  });

export const UpdateOperationSchema = updateOperationSchema;

function parsePersistedOperation(
  raw: unknown,
  expectedOperationId?: string,
): UpdateOperation {
  const parsed = updateOperationSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `Persisted update operation is invalid: ${parsed.error.issues
        .map((issue) => issue.message)
        .join("; ")}`,
    );
  }
  if (
    expectedOperationId !== undefined &&
    parsed.data.operationId !== expectedOperationId
  ) {
    throw new Error(
      "Persisted update operationId does not match its filename.",
    );
  }
  return parsed.data as UpdateOperation;
}

async function readPersistedOperation(
  operationPath: string,
  operationId: string,
): Promise<UpdateOperation | null> {
  try {
    return parsePersistedOperation(
      JSON.parse(await fs.readFile(operationPath, "utf8")) as unknown,
      operationId,
    );
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return null;
    }
    throw error;
  }
}

/** Atomic replacement that also works when Windows refuses rename-overwrite. */
async function writeOperationAtomically(
  target: string,
  operation: UpdateOperation,
): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.tmp-${process.pid}-${randomUUID()}`;
  const replacement = `${target}.old-${process.pid}-${randomUUID()}`;
  const handle = await fs.open(temporary, "wx");
  try {
    await handle.writeFile(`${JSON.stringify(operation, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    try {
      await fs.rename(temporary, target);
    } catch (error) {
      if (!isTargetExistsError(error)) {
        throw error;
      }
      await fs.rename(target, replacement);
      try {
        await fs.rename(temporary, target);
      } catch (replacementError) {
        await fs.rename(replacement, target).catch(() => undefined);
        throw replacementError;
      }
      await fs.rm(replacement, { force: true });
    }
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
    await fs.rm(replacement, { force: true }).catch(() => undefined);
  }
}
const targetExistsErrorCodes = new Set(["EEXIST", "EPERM", "EACCES"]);

function isTargetExistsError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    targetExistsErrorCodes.has(String((error as NodeJS.ErrnoException).code))
  );
}
const metadataTimeoutMs = 15_000;
const metadataBytes = 2 * 1024 * 1024;

async function readBody(response: Response): Promise<unknown> {
  if (!response.body) throw new Error("GitHub response has no body.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    bytes += chunk.value.byteLength;
    if (bytes > metadataBytes)
      throw new Error("GitHub release metadata exceeds the size cap.");
    chunks.push(chunk.value);
  }
  return JSON.parse(
    new TextDecoder().decode(
      Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))),
    ),
  );
}
export interface UpdateManagerOptions {
  readonly dataDir: string;
  readonly stableCliEntry: string;
  readonly detachedWorkerEntry: string;
  readonly currentVersion: string;
  readonly databasePath?: string;
  readonly runtimeRoot?: string;
  readonly spawnProcess?: typeof spawn;
}
export interface UpdateManager {
  check(): Promise<{
    current: string;
    release: UpdateRelease | null;
    newer: boolean;
  }>;
  apply(tag: string, operationId: string): Promise<UpdateOperation>;
  operation(operationId: string): Promise<UpdateOperation | null>;
}
export function createUpdateManager(
  options: UpdateManagerOptions,
): UpdateManager {
  const spawnProcess = options.spawnProcess ?? spawn;
  const operationDir = path.join(options.dataDir, "updates", "operations");
  const operationPath = (id: string) => path.join(operationDir, `${id}.json`);
  const createOperation = async (
    operation: UpdateOperation,
  ): Promise<{
    readonly operation: UpdateOperation;
    readonly created: boolean;
  }> => {
    parsePersistedOperation(operation, operation.operationId);
    await fs.mkdir(operationDir, { recursive: true });
    try {
      const handle = await fs.open(operationPath(operation.operationId), "wx");
      try {
        await handle.writeFile(
          `${JSON.stringify(operation, null, 2)}\n`,
          "utf8",
        );
        await handle.sync();
      } finally {
        await handle.close();
      }
      return { operation, created: true };
    } catch (error) {
      if (!isTargetExistsError(error)) throw error;
      const existing = await readPersistedOperation(
        operationPath(operation.operationId),
        operation.operationId,
      );
      if (!existing) {
        throw new Error(
          "Update operation appeared during creation but could not be read.",
          { cause: error },
        );
      }
      return { operation: existing, created: false };
    }
  };
  let applyTail = Promise.resolve();
  let activeApply: { operationId: string; tag: string } | null = null;
  const check = async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), metadataTimeoutMs);
    try {
      const response = await fetch(
        "https://api.github.com/repos/nayvok/Aptiloop/releases/latest",
        {
          headers: {
            Accept: "application/vnd.github+json",
            "User-Agent": "aptiloop-orchestrator",
          },
          signal: controller.signal,
        },
      );
      if (response.status === 404) {
        return { current: options.currentVersion, release: null, newer: false };
      }
      if (!response.ok) {
        throw new Error(
          `GitHub Releases request failed with status ${response.status}.`,
        );
      }
      const release = parseGithubRelease(
        (await readBody(response)) as GithubReleasePayload,
      );
      return {
        current: options.currentVersion,
        release,
        newer: compareVersions(options.currentVersion, release.version) > 0,
      };
    } finally {
      clearTimeout(timer);
    }
  };
  const applyNow = async (
    tag: string,
    operationId: string,
  ): Promise<UpdateOperation> => {
    if (options.databasePath === ":memory:") {
      throw new Error(
        "Updates require a file-backed database; refusing to enqueue an update.",
      );
    }
    if (activeApply) {
      const active = await readPersistedOperation(
        operationPath(activeApply.operationId),
        activeApply.operationId,
      );
      if (active?.state === "succeeded" || active?.state === "failed")
        activeApply = null;
    }
    const version = parseTagVersion(tag);
    if (!operationIdPattern.test(operationId)) {
      throw new Error("Update operationId must be a UUID.");
    }
    const queued: UpdateOperation = {
      operationId,
      tag: `v${version}`,
      state: "queued",
      startedAt: new Date().toISOString(),
      message: "Detached updater queued.",
    };
    const created = await createOperation(queued);
    if (!created.created) {
      if (created.operation.tag !== queued.tag) {
        throw new Error(
          `Update operation ${operationId} already belongs to ${created.operation.tag}; refusing to reconcile it with ${queued.tag}.`,
        );
      }
      return created.operation;
    }
    const failForContention = async (): Promise<UpdateOperation> => {
      const failed: UpdateOperation = {
        ...queued,
        state: "failed",
        phase: "rollback",
        finishedAt: new Date().toISOString(),
        message:
          "Another update operation is already queued or running; this operation was not started.",
      };
      await writeOperationAtomically(operationPath(operationId), failed);
      return failed;
    };
    if (activeApply && activeApply.operationId !== operationId) {
      return failForContention();
    }
    activeApply = { operationId, tag: queued.tag };
    const runtimeRoot =
      options.runtimeRoot ??
      process.env.APTILOOP_RUNTIME_ROOT?.trim() ??
      path.dirname(options.stableCliEntry);
    const markSpawnFailed = async (error: unknown): Promise<void> => {
      const current = await readPersistedOperation(
        operationPath(operationId),
        operationId,
      );
      if (
        !current ||
        (current.state !== "queued" && current.state !== "running")
      )
        return;
      await writeOperationAtomically(operationPath(operationId), {
        ...current,
        state: "failed",
        phase: "rollback",
        finishedAt: new Date().toISOString(),
        message:
          `Detached updater failed to start: ${error instanceof Error ? error.message : String(error)}`.slice(
            0,
            2_000,
          ),
      });
    };
    let worker: ChildProcess;
    try {
      worker = spawnProcess(
        process.execPath,
        [
          options.detachedWorkerEntry,
          "--operation",
          operationId,
          "--tag",
          queued.tag,
          "--data-dir",
          options.dataDir,
          "--runtime-root",
          runtimeRoot,
          "--database-path",
          options.databasePath ??
            path.join(options.dataDir, "dev-learning-harness.sqlite"),
        ],
        {
          detached: true,
          stdio: "ignore",
          shell: false,
          windowsHide: true,
          env: {
            ...process.env,
            APTILOOP_RUNTIME_ROOT: runtimeRoot,
            APTILOOP_RUNTIME_LAUNCHER: options.stableCliEntry,
            APTILOOP_BOOTSTRAP_ENTRY: options.stableCliEntry,
          },
        },
      );
      worker.unref();
    } catch (error) {
      if (activeApply?.operationId === operationId) activeApply = null;
      await markSpawnFailed(error).catch(() => undefined);
      throw new Error(
        `Failed to start detached updater: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
    const clearActive = () => {
      if (activeApply?.operationId === operationId) activeApply = null;
    };
    worker.once("close", clearActive);
    worker.once("error", (error) => {
      clearActive();
      void markSpawnFailed(error).catch(() => undefined);
    });
    return queued;
  };
  const apply = (
    tag: string,
    operationId: string,
  ): Promise<UpdateOperation> => {
    const result = applyTail.then(() => applyNow(tag, operationId));
    applyTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
  return {
    check,
    apply,
    operation: async (operationId) => {
      if (!operationIdPattern.test(operationId)) return null;
      const operation = await readPersistedOperation(
        operationPath(operationId),
        operationId,
      );
      if (
        activeApply?.operationId === operationId &&
        (operation?.state === "succeeded" || operation?.state === "failed")
      )
        activeApply = null;
      return operation;
    },
  };
}
