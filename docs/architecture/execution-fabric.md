# Execution Fabric

Status: **Implemented baseline** for the M5 generic trusted local-native Fabric, built-in Node/Python contracts, and compatibility-mapped exercise path; independently isolated untrusted or remote execution is **Future**.

## Purpose and ownership

The Execution Fabric turns a validated Activity request into bounded execution evidence. It does not choose what the learner should do, change Activity state, calculate mastery, or publish Course content. Those decisions remain with the deterministic Learning Kernel and the application repositories.

The ownership boundary is:

1. a published, immutable `CourseRevision` names an `environmentId` and one or more `checkId` values;
2. Aptiloop resolves those opaque IDs through an app-owned trusted registry;
3. an execution backend runs only the resolved plans against an attempt-owned workspace;
4. the backend returns a validated structured result and bounded artifacts;
5. the Learning Kernel decides how that evidence affects progression and mastery.

A Course Pack is data, not an execution extension. It may not contain executables, command lines, argument arrays, shell fragments, package lifecycle scripts, environment-variable values, secrets, plugins, container definitions, URLs used as execution endpoints, or absolute/relative host filesystem paths. Unknown environment or check IDs fail validation; they are never interpreted as commands.

## Implemented baseline: trusted local Execution Fabric

The M5 path is deliberately finite and app-owned:

- `TrustedExecutionFabric` resolves exact environment/check IDs from an in-process registry; requests cannot carry executable, arguments, environment, network policy, or limits;
- migration `0013_execution_fabric` persists immutable Environment Pack/check descriptors, exact environment/check identity on attempts and test runs, structured artifacts, review evidence bundles, and quarantine for legacy runs without a complete-workspace snapshot;
- the compatibility exercise route maps the browser's literal `commandId: "test"` to `apt.compat.node24.local.v1` / `apt.compat.node24.npm-test.v1`, preserving existing attempts and behavior without exposing a generic command surface;
- built-in `apt.core.node24.local.v1` and `apt.core.python3.local.v1` contracts use fixed `shell: false` Node test/Python isolated unittest plans, app-owned lock/runtime checks, minimal non-secret environments, 120-second timeouts, 1 MB output caps, cancellation, and process-tree cleanup;
- every run snapshots the complete attempt workspace, optionally rejects a stale expected hash before spawn, binds the normalized result/artifacts to that SHA-256, and returns explicit `unsupported_environment` rather than changing runtime;
- review still requires a complete non-truncated Git-visible patch and passing fresh check, persists an immutable evidence bundle, exposes no patch/apply route, and verifies unchanged workspace evidence.

This is **native local execution with the local user's authority**. The compatibility npm plan still permits the repository-controlled learner template's package script, and neither local-native contract enforces network, memory, disk, or process-count isolation. The UI/docs must call it trusted and unsandboxed. Imported Course Packs may only reference known public IDs; they cannot supply code, dependencies, locks, commands, paths, or process definitions.

## Approved Core Alpha manifest contract

An executable Activity contains declarative references only. The exact schema will live in shared versioned contracts; this example is normative in meaning, not a claim that these types exist:

```ts
type ActivityExecutionManifest = {
  schemaVersion: 1;
  environmentId: string; // opaque, versioned registry ID
  checkIds: readonly string[]; // opaque, ordered, unique registry IDs
  entryDocument?: string; // logical document ID, never a path
  requestedPreviewTypes: readonly PreviewType[];
};
```

Rules:

- `environmentId` is immutable for a published `CourseRevision` and resolves to exactly one installed, trusted Environment Pack version and digest.
- Each `checkId` is stable within that Environment Pack version. IDs use a bounded portable identifier syntax and are compared exactly.
- The list is finite, ordered, duplicate-free, and validated at Course Pack import, draft validation, publish, install, and execution.
- A Course Pack cannot add, replace, parameterize, or shadow registry entries.
- Check parameters, when a check type needs them, are a separately typed data schema owned by that check definition. They cannot become executable tokens or paths.
- Publication records the Environment Pack identity/digest and the check-contract version so later registry updates cannot silently change an existing revision.
- Missing, disabled, incompatible, or digest-mismatched entries produce an explicit `unsupported_environment` result. There is no best-effort substitution.

## Trusted registry and check plans

Environment Packs and check plans are installed and approved by Aptiloop, not by Course Packs. A trusted check definition binds:

- a stable ID, result schema version, and supported artifact types;
- a backend capability requirement;
- an app-owned executable and fixed argument plan, or a built-in non-process evaluator;
- workspace-relative inputs resolved by the backend from logical document IDs;
- an explicit environment-variable allowlist with no credential inheritance;
- timeout, memory/process/output/artifact limits;
- network policy;
- deterministic normalization rules for exit state, diagnostics, and artifacts.

Native process definitions are configuration of the trusted installation. They are never serialized into a Course Pack, Source Snapshot, Knowledge Capsule, model prompt, or browser request.

## Execution request and backend interface

The orchestrator creates a request only after resolving Course revision, Activity, attempt, Environment Pack, and checks:

```ts
type ExecutionRequest = {
  operationId: string;
  attemptId: string;
  courseRevisionId: string;
  activityId: string;
  workspace: WorkspaceHandle;
  environmentPack: ResolvedEnvironmentPack;
  checkIds: readonly string[];
  inputSnapshotHash: string;
  deadline: string;
};

interface ExecutionBackend {
  readonly id: string;
  describeCapabilities(): Promise<ExecutionCapabilities>;
  prepare(
    request: ExecutionRequest,
    signal: AbortSignal,
  ): Promise<ExecutionLease>;
  runChecks(
    lease: ExecutionLease,
    checkIds: readonly string[],
    signal: AbortSignal,
  ): Promise<ExecutionResult>;
  dispose(lease: ExecutionLease): Promise<void>;
}
```

`WorkspaceHandle` and `ExecutionLease` are opaque, short-lived application capabilities. They are not filesystem paths and are not accepted from Course Pack fields. The backend must verify attempt ownership, snapshot hash, Environment Pack digest, check membership, limits, and cancellation again at the execution boundary. `dispose` is idempotent and runs after success, failure, cancellation, or timeout.

The application may add backend-specific preparation internally, but every backend must preserve the same request/result contract. Backend errors cannot be converted into passing checks.

## Structured results

Every run returns one validated envelope:

```ts
type ExecutionResult = {
  schemaVersion: 1;
  operationId: string;
  backendId: string;
  environmentId: string;
  environmentPackDigest: string;
  inputSnapshotHash: string;
  status:
    | "passed"
    | "failed"
    | "cancelled"
    | "timed_out"
    | "resource_limit"
    | "unsupported_environment"
    | "backend_error";
  startedAt: string;
  completedAt: string;
  durationMs: number;
  checks: readonly CheckResult[];
  artifacts: readonly ArtifactRef[];
  diagnostics: readonly Diagnostic[];
  truncated: boolean;
};

type CheckResult = {
  checkId: string;
  status: "passed" | "failed" | "skipped" | "error";
  summary: string;
  metrics: Readonly<Record<string, number>>;
  artifactIds: readonly string[];
};
```

Requirements:

- output is schema-validated, size-bounded, and canonicalized before persistence;
- timestamps and duration are backend observations, not model assertions;
- every requested check appears exactly once; extra or unknown results invalidate the run;
- `passed` requires every required check to pass and no truncation that would invalidate its evidence;
- stdout/stderr are diagnostic artifacts, not the success authority;
- operation IDs provide idempotency. Replaying the same operation with a different request hash is rejected;
- the input snapshot/diff hash binds evidence to the exact learner state. Any edit makes the prior result stale;
- artifact content is stored by the application and referenced by opaque ID, digest, media type, size, and retention class. Results never expose backend host paths;
- provider/model prose cannot create or upgrade execution evidence. Reviewer may interpret already validated evidence but remains read-only and cannot patch the workspace.

## Backends and network boundary

| Backend                       | Status                   | Trust and network contract                                                                                                                                                                                                                                                        |
| ----------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Compatibility native runner   | **Implemented baseline** | Existing repository-controlled templates mapped through the Fabric; local-account authority; unsandboxed; network not denied; learner-visible API remains the fixed `test` operation.                                                                                             |
| Generic `local-native` Fabric | **Implemented baseline** | Finite app-distributed Node/Python registry, fixed plans and limits, normalized snapshot-bound evidence, explicit trusted-only mode; imported executable material is rejected.                                                                                                    |
| `server-isolated`             | **Future**               | Sandboxed per execution, read-only base image, ephemeral writable workspace, resource quotas, no host mounts, no credentials, and **deny network by default**. Network exceptions require separately approved app-owned environment policy and cannot originate in a Course Pack. |
| `remote-execution`            | **Future**               | Same structured contract over an authenticated transport, encrypted workspace/artifact transfer, tenant isolation, deny-network execution, retention controls, and explicit user action before private data leaves the device.                                                    |

A public/self-hosted server must not use the trusted local native backend for untrusted users. “Runs in a container” is not sufficient evidence of isolation; the server backend requires a tested sandbox and deny-network enforcement.

## AI and Pi boundary

Pi is a model/runtime layer behind Aptiloop-owned typed tools. Pi has no built-in permission system, so Aptiloop must expose only typed operations such as “request check by ID” or “read bounded evidence.” It must not expose shell, arbitrary filesystem read/write, arbitrary network, editor, or host-process tools. Course Designer, Tutor, Evaluator, and Reviewer are Aptiloop roles, not Pi authority domains.

Mock execution is not a production fallback. Mock remains test/CI/dev-only, and failure of a real backend or model is explicit; Aptiloop must never silently turn it into Mock success.

## Acceptance evidence and residual gates

**Implemented baseline.** M5 contract tests prove exact and collision-safe environment/check resolution, stale complete-workspace snapshot rejection before spawn, structured result/artifact binding, explicit unsupported environments, and normalized Node/Python success/failure. Existing process-runner, workspace-containment, Git freshness, and reviewer-policy suites retain timeout, cancellation, output cap, process-tree cleanup, traversal/reparse, same-mtime change, truncated/stale evidence, and no-apply coverage. Course Pack tests reject commands, scripts, secrets, plugins, paths, and unknown requirements before persistence.

**Residual/Future gates:** local-native execution is not approved for untrusted users or untrusted code; it does not enforce memory/disk/process quotas or deny network. A future isolated backend must demonstrate sandbox escape tests, absence of credentials/host mounts, enforced deny-network behavior, equivalent normalized status semantics, and disposable cleanup rather than documenting those controls only.
