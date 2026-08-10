# Environment Packs

Status: **Implemented baseline** for the finite app-distributed M5 compatibility Node, Core Node 24, and Core Python 3 Environment Pack contracts. Third-party/installable packs and isolated server execution remain **Future**.

## Definition

An Environment Pack is an Aptiloop-installed, trusted, immutable description of an execution environment and its check catalog. It is separate from a Course Pack.

- A **Course Pack** contains declarative learning content and references opaque `environmentId` and `checkId` values.
- An **Environment Pack** defines trusted runtime/toolchain resolution, materialization rules, process plans, resource/network policy, and result adapters.
- The **Execution Fabric** resolves both, owns the workspace capability, runs checks, and returns structured evidence.

Course authors can select installed IDs and provide typed educational data. They cannot define commands, executable names, arguments, package lifecycle scripts, environment variables, secrets, plugins, containers, network rules, or host paths. Course Pack validation rejects those fields even if their values appear harmless.

## Identity and immutability

```ts
type EnvironmentPackManifest = {
  schemaVersion: 1;
  id: string;
  version: string;
  digest: string;
  runtime: NodeRuntimeContract | PythonRuntimeContract;
  checks: readonly TrustedCheckDescriptor[];
  previewTypes: readonly PreviewType[];
  artifactTypes: readonly ArtifactType[];
  limits: ResourceLimits;
  network: "inherit-local-trusted" | "deny";
};
```

This is the implemented public descriptor shape for the finite local registry. Its rules are:

1. `(id, version, digest)` identifies one immutable pack. Replacing bytes under the same identity is forbidden.
2. IDs are bounded portable identifiers. Versions follow one documented comparison scheme; digests use an approved cryptographic hash over canonical content.
3. Published `CourseRevision` records the exact identity and check-contract version. Resolving to a newer “compatible” pack is an explicit revision change, never automatic.
4. Import and publication fail when the exact pack is missing, disabled, unsupported on the host, or has a digest mismatch.
5. Install/enable is an application-owner action outside Course Pack import. Packs are not fetched automatically from content URLs.
6. A pack has no credentials. Provider credentials and private environment variables remain outside pack storage and are not inherited by checks.
7. The Core Alpha catalog is finite and app-distributed. Third-party plugin loading is **Future** and is not approved by this specification.

## Common runtime contract

Every runtime contract declares data rather than shell instructions:

- runtime kind and exact supported version/range;
- supported operating systems/architectures or backend capabilities;
- project marker and lockfile policy;
- trusted materializer implementation ID;
- source document/file rules and maximum counts/sizes;
- check IDs and their fixed internal process/evaluator plans;
- sanitized environment names and constant non-secret values, if required;
- timeout, process, memory, output, artifact, and workspace limits;
- network policy;
- structured diagnostic and artifact adapters.

A materializer consumes a validated Source Snapshot and writes only below an attempt-owned workspace. It rejects absolute paths, `..`, empty/ambiguous segments, platform device names, links/reparse points, duplicate case-folded names, and files outside the declared document set. The Course Pack never supplies the attempt root.

Dependency acquisition is not implicit execution. Core Alpha should prefer prebuilt app-owned environments. If a trusted local Environment Pack needs installation, it is an explicit owner operation with a lockfile and visible provenance, not an Activity start side effect. A future server build phase must run separately from learner checks, with no secrets and deny-network execution after materialization.

## Node Environment Pack

The compatibility environment `apt.compat.node24.local.v1` preserves the existing repository-controlled `npm test` path. It verifies Node 24 but deliberately remains `isolated: false`: the learner template's `package.json` selects its internal npm script, npm dispatches that script through its own shell, and local network/account authority remains. This is an **Implemented baseline compatibility contract**, not the generic Core Node boundary.

The **Implemented baseline** Core Node contract is `apt.core.node24.local.v1` / `apt.core.node24.node-test.v1`:

```ts
type NodeRuntimeContract = {
  kind: "node";
  node: { major: number; version?: string };
  packageManager: { kind: "npm"; version: string };
  lockfile: {
    name: "package-lock.json";
    required: true;
    lockfileVersion: number;
  };
  dependencyMode: "prebuilt" | "owner-materialized";
  lifecycleScripts: "disabled";
  moduleMode: "esm" | "commonjs";
};
```

Normative behavior:

- the backend verifies the Node and npm identity before execution and reports an explicit unsupported-environment result on mismatch;
- evaluated dependencies are pinned by the immutable Environment Pack and lockfile. A Course Pack cannot add dependencies or alter the trusted lockfile;
- npm lifecycle scripts are disabled for generic materialization. A built-in repository-controlled fixture that requires native setup remains trusted native content and must be classified separately, not smuggled through a Course Pack;
- checks such as `node:test`, `vitest`, typecheck, lint, or build are distinct trusted check IDs whose executable/argv live only in the installed pack registry;
- source paths are logical document IDs mapped inside the attempt workspace. `package.json` scripts are not selected or invoked because a Course Pack names them;
- checks receive a minimal environment, no provider/API tokens, bounded output, cancellation, and the backend network policy;
- generated caches and `node_modules` are backend-owned materialization artifacts, not Course Pack files or learner Evidence.

A target built-in catalog might expose IDs such as `node24.vitest`, but names are illustrative until registered. Documentation must not imply that an unregistered ID works.

## Python Environment Pack

Python support is an **Implemented baseline** contract at `apt.core.python3.local.v1` / `apt.core.python3.unittest.v1`. It requires the app-owned empty `requirements.lock`, runs the fixed isolated `python -I -B -m unittest discover` plan, disables user-site/bytecode discovery through the child environment, and returns explicit unsupported/failure results. Host interpreter presence/version support is observed at execution; no dependency installation occurs.

```ts
type PythonRuntimeContract = {
  kind: "python";
  python: { major: 3; minor: number; version?: string };
  environment: "isolated-venv";
  dependencyMode: "prebuilt" | "owner-materialized";
  lock: {
    format: "requirements-hashes" | "pylock";
    required: true;
    fileName: string;
  };
  importMode: "isolated";
  bytecode: "workspace-local-or-disabled";
};
```

Normative behavior:

- the interpreter is resolved by the installed pack/backend, never from Course Pack text, shebangs, `PATH` mutation, or a learner-controlled executable;
- each materialized environment is isolated from the application interpreter and user site packages; `PYTHONNOUSERSITE`-equivalent behavior is enforced;
- dependencies are pinned and integrity-verified by an immutable trusted lock. Unlocked `requirements.txt`, arbitrary index URLs, VCS dependencies, local editable installs, and setup hooks supplied by Course Packs are rejected;
- generic dependency builds/install hooks are not run during a learner check. Native or build-time dependencies require an owner-built environment image/artifact;
- trusted IDs can map internally to `pytest`, type checking, formatting verification, or a built-in evaluator, but their flags and plugins are pack-owned;
- `PYTHONPATH`, plugin discovery, startup hooks, environment variables, filesystem scope, output limits, cancellation, and network policy are controlled by the backend;
- caches, virtual environments, coverage data, and bytecode are backend artifacts with explicit retention, not learner-authored Course Pack content.

## Check descriptors

A Course Pack sees only the public descriptor:

```ts
type TrustedCheckDescriptor = {
  id: string;
  contractVersion: number;
  title: string;
  requiredCapabilities: readonly string[];
  resultKind: "tests" | "static-analysis" | "build" | "custom-evaluator";
  artifactTypes: readonly ArtifactType[];
};
```

The private installed definition additionally contains fixed executable/evaluator plans and adapters. Public descriptors must not leak host paths or command construction. Check IDs are namespaced by pack identity, cannot be overridden by an imported pack, and resolve exactly once.

Check output is converted to the Execution Fabric result envelope. Parsers are untrusted-input parsers: they are size-bounded, total (returning a typed error rather than crashing), and cannot treat unparseable output as success. Exit code alone may be part of a check result, but stdout text alone is never proof of passing.

## Network and trust modes

- **Implemented baseline:** native local trusted templates run with local account authority. Network denial is not enforced.
- **Approved Core Alpha target:** local-native packs remain visibly marked trusted-only/unsandboxed. Their manifest uses `inherit-local-trusted`; imported Course Packs still cannot supply executable content.
- **Future server boundary:** the execution phase is `network: deny`, with an independently tested sandbox, no credentials, no host mounts, and quotas. Any dependency preparation is a separate controlled owner/build phase. Course Packs cannot request exceptions.
- **Future remote boundary:** transferring private source/evidence requires explicit user action, authenticated encrypted transport, retention disclosure, and the same deny-network execution policy.

Network policy is a backend capability that must be measured and reported. A backend that cannot enforce `deny` cannot run a pack requiring it.

## Validation and lifecycle

Validation occurs at four layers:

1. **Install:** schema, canonical digest, ownership/signature policy, runtime support, check uniqueness, internal process plans, limits, and artifact adapters.
2. **Course draft:** referenced pack/check IDs exist and typed Activity inputs match their public schemas.
3. **Publish/install Course Pack:** pin exact identities; revalidate the finite Activity graph; reject commands, paths, scripts, secrets, plugins, and undeclared capabilities.
4. **Execution:** resolve IDs again, verify digest/capabilities/snapshot, and fail closed on drift.

Disabling or uninstalling a pack never rewrites a published revision or old Evidence. Existing content becomes explicitly unavailable until the exact pack returns. Historical structured results retain the pack identity and digest needed for provenance.

## Acceptance evidence and residual gates

**Implemented baseline.** The installed registry has immutable `(id, version, digest)` descriptors and exact check membership. Course Pack validation rejects executable/path/secret/plugin data and unknown environment/check references. Fabric tests cover duplicate/unknown IDs, runtime/lock failure, no automatic environment substitution, complete-workspace freshness, and normalized Node/Python pass/fail evidence. The app-owned process runner supplies the minimal environment, timeout/output limits, cancellation, and process-tree cleanup.

**Residual/Future:** the registry is app-distributed rather than a third-party pack installer; compatibility npm remains less isolated than Core Node; local-native checks retain local-user and network authority; memory/disk/process-count quotas are not enforced. A future server backend requires tested isolation and deny-network enforcement before it can execute untrusted content.
