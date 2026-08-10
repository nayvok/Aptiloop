import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  AllowedProcessRunner,
  type AllowedProcessDefinition,
  type ProcessResult,
} from "./process-runner.js";
import {
  snapshotCompleteWorkspace,
  type CompleteWorkspaceSnapshot,
} from "./workspace-snapshot.js";

export type RuntimeKind = "node" | "python";
export type ExecutionStatus =
  | "passed"
  | "failed"
  | "cancelled"
  | "timed_out"
  | "resource_limit"
  | "unsupported_environment"
  | "backend_error";

export interface TrustedCheckDescriptor {
  readonly id: string;
  readonly contractVersion: 1;
  readonly title: string;
  readonly resultKind: "tests" | "static-analysis" | "build";
  readonly artifactTypes: readonly ["process-log"];
}

export interface EnvironmentPackDescriptor {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly version: string;
  readonly digest: string;
  readonly runtime: {
    readonly kind: RuntimeKind;
    readonly version: string;
    readonly lockfile: string;
    readonly isolated: boolean;
  };
  readonly checks: readonly TrustedCheckDescriptor[];
  readonly network: "inherit-local-trusted";
  readonly trust: "trusted-local-unsandboxed";
}

interface InstalledCheckDefinition {
  readonly descriptor: TrustedCheckDescriptor;
  readonly process: AllowedProcessDefinition;
}

interface InstalledEnvironmentPack {
  readonly descriptor: EnvironmentPackDescriptor;
  readonly checks: ReadonlyMap<string, InstalledCheckDefinition>;
  readonly validateRuntime: () => string | null;
  readonly validateWorkspace: (workspacePath: string) => Promise<string | null>;
}

export interface ExecutionDiagnostic {
  readonly code: string;
  readonly severity: "info" | "error";
  readonly message: string;
}

export interface ExecutionArtifact {
  readonly id: string;
  readonly type: "process-log";
  readonly mediaType: "text/plain; charset=utf-8";
  readonly digest: string;
  readonly sizeBytes: number;
  readonly retention: "attempt";
  readonly truncated: boolean;
  readonly content: string;
}

export interface TrustedCheckResult {
  readonly checkId: string;
  readonly status: "passed" | "failed" | "error";
  readonly summary: string;
  readonly metrics: Readonly<Record<string, number>>;
  readonly artifactIds: readonly string[];
}

export interface ExecutionResult {
  readonly schemaVersion: 1;
  readonly operationId: string;
  readonly backendId: "local-native";
  readonly environmentId: string;
  readonly environmentPackDigest: string;
  readonly inputSnapshotHash: string;
  readonly status: ExecutionStatus;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly checks: readonly TrustedCheckResult[];
  readonly artifacts: readonly ExecutionArtifact[];
  readonly diagnostics: readonly ExecutionDiagnostic[];
  readonly truncated: boolean;
}

export interface ExecutionRequest {
  readonly operationId: string;
  readonly attemptId: string;
  readonly courseRevisionId: string;
  readonly activityId: string;
  readonly workspacePath: string;
  readonly environmentId: string;
  readonly checkIds: readonly string[];
  readonly expectedInputSnapshotHash?: string;
  readonly signal?: AbortSignal;
}

export interface CoreExecutionRegistryOptions {
  readonly legacyNodeTestPlan: AllowedProcessDefinition;
  readonly pythonExecutable?: string;
  readonly pythonTestPlan?: AllowedProcessDefinition;
}

const ID_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,198}[a-z0-9])?$/u;
const EMPTY_SHA256 = createHash("sha256").update("").digest("hex");

export const LEGACY_NODE_ENVIRONMENT_ID = "apt.compat.node24.local.v1";
export const LEGACY_NODE_TEST_CHECK_ID = "apt.compat.node24.npm-test.v1";
export const CORE_NODE_ENVIRONMENT_ID = "apt.core.node24.local.v1";
export const CORE_NODE_TEST_CHECK_ID = "apt.core.node24.node-test.v1";
export const CORE_PYTHON_ENVIRONMENT_ID = "apt.core.python3.local.v1";
export const CORE_PYTHON_TEST_CHECK_ID = "apt.core.python3.unittest.v1";

export class TrustedExecutionFabric {
  readonly #environments: ReadonlyMap<string, InstalledEnvironmentPack>;

  constructor(environments: readonly InstalledEnvironmentPack[]) {
    const byId = new Map<string, InstalledEnvironmentPack>();
    for (const environment of environments) {
      assertId(environment.descriptor.id, "Environment");
      if (byId.has(environment.descriptor.id)) {
        throw new Error(
          `Duplicate environment ID: ${environment.descriptor.id}`,
        );
      }
      for (const checkId of environment.checks.keys()) {
        assertId(checkId, "Check");
      }
      byId.set(environment.descriptor.id, environment);
    }
    this.#environments = byId;
  }

  listEnvironments(): readonly EnvironmentPackDescriptor[] {
    return [...this.#environments.values()]
      .map((environment) => environment.descriptor)
      .sort((left, right) => left.id.localeCompare(right.id, "en"));
  }

  describeEnvironment(environmentId: string): EnvironmentPackDescriptor {
    return this.#requireEnvironment(environmentId).descriptor;
  }

  async run(request: ExecutionRequest): Promise<ExecutionResult> {
    assertId(request.operationId, "Operation");
    assertId(request.attemptId, "Attempt");
    assertId(request.courseRevisionId, "Course revision");
    assertId(request.activityId, "Activity");
    if (!path.isAbsolute(request.workspacePath)) {
      throw new Error(
        "Execution workspace must be an absolute server-owned path",
      );
    }
    if (request.checkIds.length === 0 || request.checkIds.length > 20) {
      throw new Error("Execution must request between 1 and 20 checks");
    }
    if (new Set(request.checkIds).size !== request.checkIds.length) {
      throw new Error("Execution check IDs must be unique");
    }

    const environment = this.#requireEnvironment(request.environmentId);
    const checks = request.checkIds.map((checkId) => {
      assertId(checkId, "Check");
      const check = environment.checks.get(checkId);
      if (!check) {
        throw new Error(
          `Unknown check ID for environment ${request.environmentId}: ${checkId}`,
        );
      }
      return check;
    });
    const snapshot = await snapshotCompleteWorkspace(request.workspacePath);
    if (
      request.expectedInputSnapshotHash !== undefined &&
      snapshot.contentHash !== request.expectedInputSnapshotHash
    ) {
      throw new Error("Execution request snapshot is stale");
    }

    const started = Date.now();
    const startedAt = new Date(started).toISOString();
    const runtimeError = environment.validateRuntime();
    const workspaceError = runtimeError
      ? null
      : await environment.validateWorkspace(request.workspacePath);
    if (runtimeError || workspaceError) {
      const completedAt = new Date().toISOString();
      return unsupportedResult(
        request,
        environment.descriptor,
        snapshot,
        startedAt,
        completedAt,
        runtimeError ?? workspaceError ?? "Environment is unsupported",
      );
    }

    const processDefinitions = Object.fromEntries(
      checks.map((check) => [check.descriptor.id, check.process]),
    );
    const runner = new AllowedProcessRunner(processDefinitions);
    const results: TrustedCheckResult[] = [];
    const artifacts: ExecutionArtifact[] = [];
    const diagnostics: ExecutionDiagnostic[] = [];
    let aggregateStatus: ExecutionStatus = "passed";

    for (const check of checks) {
      const processResult = await runner.run(check.descriptor.id, {
        cwd: request.workspacePath,
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      });
      const artifact = processArtifact(
        request.operationId,
        check,
        processResult,
      );
      artifacts.push(artifact);
      const status = processStatus(processResult);
      if (status !== "passed" && aggregateStatus === "passed") {
        aggregateStatus = status;
      }
      results.push({
        checkId: check.descriptor.id,
        status:
          status === "passed"
            ? "passed"
            : status === "failed"
              ? "failed"
              : "error",
        summary:
          status === "passed"
            ? "Trusted check passed"
            : `Trusted check ended with ${processResult.terminationReason}`,
        metrics: { durationMs: processResult.durationMs },
        artifactIds: [artifact.id],
      });
      if (status !== "passed") {
        diagnostics.push({
          code: `process_${processResult.terminationReason}`,
          severity: "error",
          message: results.at(-1)!.summary,
        });
        break;
      }
    }

    const completed = Date.now();
    return {
      schemaVersion: 1,
      operationId: request.operationId,
      backendId: "local-native",
      environmentId: environment.descriptor.id,
      environmentPackDigest: environment.descriptor.digest,
      inputSnapshotHash: snapshot.contentHash,
      status: aggregateStatus,
      startedAt,
      completedAt: new Date(completed).toISOString(),
      durationMs: Math.max(0, completed - started),
      checks: results,
      artifacts,
      diagnostics,
      truncated: artifacts.some((artifact) => artifact.truncated),
    };
  }

  #requireEnvironment(environmentId: string): InstalledEnvironmentPack {
    assertId(environmentId, "Environment");
    const environment = this.#environments.get(environmentId);
    if (!environment)
      throw new Error(`Unknown environment ID: ${environmentId}`);
    return environment;
  }
}

export function createCoreExecutionFabric(
  options: CoreExecutionRegistryOptions,
): TrustedExecutionFabric {
  const pythonExecutable =
    options.pythonExecutable ??
    (process.platform === "win32" ? "python" : "python3");
  const nodeMajor = Number.parseInt(
    process.versions.node.split(".")[0] ?? "",
    10,
  );
  return new TrustedExecutionFabric([
    createEnvironment(
      LEGACY_NODE_ENVIRONMENT_ID,
      "1.0.0",
      {
        kind: "node",
        version: "24",
        lockfile: "package-lock.json",
        isolated: false,
      },
      [
        {
          id: LEGACY_NODE_TEST_CHECK_ID,
          title: "Compatibility Node test",
          process: options.legacyNodeTestPlan,
        },
      ],
      () =>
        nodeMajor === 24
          ? null
          : `Node 24 is required; found ${process.versions.node}`,
      async () => null,
    ),
    createEnvironment(
      CORE_NODE_ENVIRONMENT_ID,
      "1.0.0",
      {
        kind: "node",
        version: "24",
        lockfile: "package-lock.json",
        isolated: true,
      },
      [
        {
          id: CORE_NODE_TEST_CHECK_ID,
          title: "Node built-in test runner",
          process: {
            executable: process.execPath,
            args: ["--test"],
            timeoutMs: 120_000,
            maxOutputBytes: 1_000_000,
          },
        },
      ],
      () =>
        nodeMajor === 24
          ? null
          : `Node 24 is required; found ${process.versions.node}`,
      validateNodeWorkspace,
    ),
    createEnvironment(
      CORE_PYTHON_ENVIRONMENT_ID,
      "1.0.0",
      {
        kind: "python",
        version: "3",
        lockfile: "requirements.lock",
        isolated: true,
      },
      [
        {
          id: CORE_PYTHON_TEST_CHECK_ID,
          title: "Python unittest",
          process: options.pythonTestPlan ?? {
            executable: pythonExecutable,
            args: [
              "-I",
              "-B",
              "-m",
              "unittest",
              "discover",
              "-s",
              ".",
              "-p",
              "test_*.py",
            ],
            env: {
              PYTHONNOUSERSITE: "1",
              PYTHONDONTWRITEBYTECODE: "1",
              PYTHONHASHSEED: "0",
            },
            timeoutMs: 120_000,
            maxOutputBytes: 1_000_000,
          },
        },
      ],
      () => null,
      validatePythonWorkspace,
    ),
  ]);
}

function createEnvironment(
  id: string,
  version: string,
  runtime: EnvironmentPackDescriptor["runtime"],
  checks: readonly {
    readonly id: string;
    readonly title: string;
    readonly process: AllowedProcessDefinition;
  }[],
  validateRuntime: () => string | null,
  validateWorkspace: (workspacePath: string) => Promise<string | null>,
): InstalledEnvironmentPack {
  const descriptors = checks.map((check): TrustedCheckDescriptor => ({
    id: check.id,
    contractVersion: 1,
    title: check.title,
    resultKind: "tests",
    artifactTypes: ["process-log"],
  }));
  const manifest = {
    schemaVersion: 1 as const,
    id,
    version,
    runtime,
    checks: descriptors,
    network: "inherit-local-trusted" as const,
    trust: "trusted-local-unsandboxed" as const,
  };
  const descriptor: EnvironmentPackDescriptor = {
    ...manifest,
    digest: `sha256:${createHash("sha256")
      .update(JSON.stringify(manifest))
      .digest("hex")}`,
  };
  return {
    descriptor,
    checks: new Map(
      checks.map((check, index) => [
        check.id,
        { descriptor: descriptors[index]!, process: check.process },
      ]),
    ),
    validateRuntime,
    validateWorkspace,
  };
}

async function validateNodeWorkspace(
  workspacePath: string,
): Promise<string | null> {
  try {
    const lock = JSON.parse(
      await readFile(path.join(workspacePath, "package-lock.json"), "utf8"),
    ) as { lockfileVersion?: unknown };
    return lock.lockfileVersion === 3
      ? null
      : "Node environment requires package-lock.json lockfileVersion 3";
  } catch {
    return "Node environment requires a valid package-lock.json";
  }
}

async function validatePythonWorkspace(
  workspacePath: string,
): Promise<string | null> {
  try {
    const lock = await readFile(path.join(workspacePath, "requirements.lock"));
    const digest = createHash("sha256").update(lock).digest("hex");
    return digest === EMPTY_SHA256
      ? null
      : "Python Core environment accepts only the installed empty dependency lock";
  } catch {
    return "Python environment requires requirements.lock";
  }
}

function unsupportedResult(
  request: ExecutionRequest,
  environment: EnvironmentPackDescriptor,
  snapshot: CompleteWorkspaceSnapshot,
  startedAt: string,
  completedAt: string,
  message: string,
): ExecutionResult {
  return {
    schemaVersion: 1,
    operationId: request.operationId,
    backendId: "local-native",
    environmentId: environment.id,
    environmentPackDigest: environment.digest,
    inputSnapshotHash: snapshot.contentHash,
    status: "unsupported_environment",
    startedAt,
    completedAt,
    durationMs: Math.max(0, Date.parse(completedAt) - Date.parse(startedAt)),
    checks: [],
    artifacts: [],
    diagnostics: [
      { code: "unsupported_environment", severity: "error", message },
    ],
    truncated: false,
  };
}

function processArtifact(
  operationId: string,
  check: InstalledCheckDefinition,
  result: ProcessResult,
): ExecutionArtifact {
  const content = [result.stdout, result.stderr].filter(Boolean).join("\n");
  return {
    id: `artifact:${operationId}:${check.descriptor.id}`,
    type: "process-log",
    mediaType: "text/plain; charset=utf-8",
    digest: `sha256:${createHash("sha256").update(content).digest("hex")}`,
    sizeBytes: Buffer.byteLength(content, "utf8"),
    retention: "attempt",
    truncated: result.truncated,
    content,
  };
}

function processStatus(result: ProcessResult): ExecutionStatus {
  switch (result.terminationReason) {
    case "exit":
      return result.exitCode === 0 ? "passed" : "failed";
    case "cancelled":
      return "cancelled";
    case "timeout":
      return "timed_out";
    case "output_limit":
      return "resource_limit";
    case "spawn_error":
      return "unsupported_environment";
  }
}

function assertId(value: string, label: string): void {
  if (!ID_PATTERN.test(value)) {
    throw new TypeError(`${label} ID is invalid`);
  }
}
