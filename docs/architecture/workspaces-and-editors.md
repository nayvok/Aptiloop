# Workspaces, Editors, Previews, and Artifacts

**Document status:** Isolated per-attempt workspaces, Zed launch, check-time complete-workspace snapshots, bounded raw Git patch DTOs, normalized check/process artifacts, and immutable review evidence bundles are an **Implemented baseline**. Opaque handles, save generations, embedded editing, and editor-neutral preview/document APIs are an **Approved Core Alpha target**. Remote editors are **Future**.

## Principles

A workspace is an application-owned attempt resource, not a Course Pack path. Editors are views/controllers over a workspace capability; they do not own learning state or execution authority.

1. Every attempt has one canonical workspace and immutable source snapshot identity.
2. A published Activity refers to logical document IDs, never host paths.
3. Aptiloop resolves paths, editor launches, previews, checks, and artifacts server-side from an opaque `WorkspaceHandle`.
4. Editing invalidates prior checks and reviews by changing the workspace snapshot/diff hash.
5. Only the deterministic Learning Kernel advances Activity state after validated Evidence.
6. Private learner files stay local unless the user explicitly invokes an export or a future remote transfer with a disclosed scope.

No Course Pack field may contain an absolute path, relative host path, editor executable, command, URL handler, plugin, environment value, or workspace root.

## Implemented baseline

Today the orchestrator:

- resolves repository-controlled templates below `workspaces/exercises`, creates one canonical attempt below the configured root, and rejects traversal, symlink/reparse, or canonical-root escape;
- copies regular files/directories only, excluding `.git`, `node_modules`, and `build`, records a private Git baseline, and preserves attempts across restart;
- launches configured Zed with `shell: false` and a server-selected path, with a local copy-path fallback;
- maps the learner's fixed `test` operation to an exact app-owned Environment Pack/check, snapshots the complete attempt workspace, rejects a stale expected hash before spawn, and binds normalized status/artifacts to that SHA-256;
- computes a complete non-truncated Git-visible patch for review, while separately binding check/review freshness to the complete allowed-workspace snapshot SHA-256 so allowed Git-ignored files cannot change invisibly;
- persists an immutable review evidence bundle and verifies the workspace evidence is unchanged; Reviewer has no patch/apply route.

This is a local single-user convenience boundary. Host paths are visible during explicit local editor handoff, and native editor/check processes retain local-account and network authority. It is not a sandbox. Compatibility npm scripts and templates must remain trusted repository content; imported Course content cannot become executable workspace input.

**Implemented baseline.** The public attempt/diff DTO exposes only a bounded raw Git patch plus `changed` and `truncated` flags (the dedicated diff response names the patch field `diff`). It does not expose the baseline commit, diff fingerprint, complete-workspace snapshot hash, test input hash, or immutable review-bundle hash. Those identities remain internal evidence bindings; consumers must not infer freshness from the public patch text or from an absent public hash.

## Approved workspace contract

**Approved Core Alpha target.** The target API uses capabilities rather than paths:

```ts
type WorkspaceHandle = {
  id: string;
  attemptId: string;
  generation: number;
  sourceSnapshotHash: string;
};

type WorkspaceSnapshot = {
  workspaceId: string;
  generation: number;
  contentHash: string;
  changedDocumentIds: readonly string[];
  createdAt: string;
};
```

The serialized handle is bounded, scoped to the current local user/attempt, and useless without server-side authorization. It contains no storage location. Each mutating operation carries an operation ID and expected generation/hash; stale writes fail rather than auto-merge.

A workspace service owns:

- create from a validated Source Snapshot and Environment Pack;
- list/read/write declared logical documents;
- optimistic generation/hash checks;
- snapshot/diff calculation;
- check/review freshness;
- preview derivation;
- artifact persistence and retention;
- archive/export by explicit user action;
- disposal after retention gates.

Published Source Snapshots and Course revisions remain immutable. Editing always affects the learner's personal attempt/adaptation branch; it never writes into a Course Pack or published revision.

### File rules

- logical document IDs map to normalized portable paths only inside the attempt;
- absolute paths, drive/UNC roots, `..`, NUL/control characters, platform device names, ambiguous separators, duplicate case-folded names, links/reparse points, sockets/devices, and undeclared files are rejected;
- file count, per-file size, total size, and text decoding are bounded;
- binary inputs are accepted only for declared safe asset types and limits;
- editor and execution services re-resolve canonical containment independently;
- APIs never return backend host paths except the explicit local external-editor handoff described below.

## Editor modes

### Embedded editor — Approved Core Alpha target

The embedded editor is the portable default for supported text/code documents. It operates through typed document APIs using logical IDs, expected generation, bounded text, and explicit save results.

It may provide syntax highlighting, diagnostics already produced by trusted checks, diff view, undo/redo, and learner preview. It is not a terminal, package manager, shell, arbitrary filesystem browser, or AI tool surface. It cannot open files outside the Activity document set or invoke an arbitrary command. An AI proposal, if enabled, is a typed draft proposal that requires explicit learner apply; it does not bypass the same write contract.

Embedded editing remains fully usable without an AI provider.

### External local editor — Implemented baseline and approved adapter

Zed is the implemented local adapter. The target adapter contract generalizes the handoff without putting executables or paths in Course content:

- the owner configures an editor adapter in local settings;
- the browser requests “open this workspace” by handle;
- the server validates ownership and resolves the local absolute path;
- the adapter builds a fixed `shell: false` launch plan from trusted installation settings;
- failure returns a local-only copy-path fallback;
- Aptiloop detects edits by snapshot/diff, not by trusting editor callbacks;
- external editing never grants Reviewer patch authority or changes check freshness rules.

External editors are optional. A missing editor is a recoverable capability state, not a failed learning session. The path fallback is permitted only in local mode because the user and orchestrator share the same filesystem trust boundary.

### Remote editor — Future

A remote editor cannot use a local host path. It requires:

- authenticated, authorization-scoped workspace capabilities;
- encrypted transport and explicit user consent before source leaves the local device;
- tenant/user isolation, concurrency/version checks, bounded uploads, and audit events;
- a remote workspace storage and retention policy;
- sandboxed execution with no host mounts or credentials and deny network by default;
- conflict presentation. There is no automatic merge of concurrent edits;
- an explicit download/export flow for returning artifacts.

A browser-based editor connected to a public server is not “local mode” and must satisfy the remote boundary even when the server itself is self-hosted.

## Preview contract

**Approved Core Alpha target.** A generic Preview is a bounded, read-only rendering derived from a specific workspace snapshot. It is not Evidence until a trusted check/evaluator produces Evidence. Every target preview records `workspaceId`, `generation`, `contentHash`, type, media type, size, and truncation state. The implemented Git patch response below is narrower and does not expose those target generation/hash fields.

Approved types:

| Preview type          | Status                                                             | Contract                                                                                                                                                                                    |
| --------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `plain-text`          | **Approved Core Alpha target**                                     | UTF-8 text, escaped, bounded; no active content.                                                                                                                                            |
| `source-code`         | **Approved Core Alpha target**                                     | UTF-8 source plus trusted language ID and line metadata; no execution.                                                                                                                      |
| `markdown-safe`       | **Approved Core Alpha target**                                     | Strict safe subset; raw HTML and active resources are disabled; external links are explicit.                                                                                                |
| `diff`                | **Implemented baseline** for raw Git patch; generic form is target | Public DTO is bounded patch text plus `changed`/`truncated`; internal baseline, diff-fingerprint, snapshot, and bundle hashes authorize freshness. Truncated patch cannot authorize review. |
| `image`               | **Approved Core Alpha target**                                     | Stored application artifact with verified media type, dimensions, byte cap, and no remote URL loading.                                                                                      |
| `table-json`          | **Approved Core Alpha target**                                     | Schema-bounded rows/cells rendered as data, never HTML.                                                                                                                                     |
| `static-web`          | **Future**                                                         | Separate sandboxed origin/frame, strict CSP, no credentials/storage, and network denied. It must not be implemented as unsanitized HTML in the app origin.                                  |
| `interactive-runtime` | **Future**                                                         | Requires a dedicated sandbox and message schema; no direct application DOM, storage, network, or host access.                                                                               |

Preview requests name only an approved type and logical document/artifact IDs. They cannot carry renderer code, HTML scripts, plugins, commands, or URLs.

## Artifact contract

**Implemented baseline** for normalized check/process artifacts and immutable review evidence bundles; **Approved Core Alpha target** for the generic cross-preview Artifact API. An Artifact is immutable output from a workspace/check/review operation. It is addressed by opaque ID and content digest, never by backend path.

```ts
type ArtifactRef = {
  id: string;
  type: ArtifactType;
  mediaType: string;
  digest: string;
  sizeBytes: number;
  createdAt: string;
  retention: "attempt" | "course-history" | "explicit-export";
  truncated: boolean;
};
```

Approved types:

- `source-snapshot`: canonical manifest plus document digests; content access remains separately authorized;
- `workspace-diff`: structured diff with baseline/current hashes;
- `check-report`: validated per-check results and diagnostics;
- `process-log`: bounded stdout/stderr diagnostic, never success authority;
- `review-report`: validated read-only structured review with provider/model provenance when AI was used;
- `image`: verified local generated image;
- `data-json`: schema-identified canonical JSON, not arbitrary serialized code;
- `export-bundle`: user-created local export with manifest, hashes, and explicit contents.

`archive`, executable, dynamic library, shell script, plugin, container image, and arbitrary HTML are not generic learner artifact types. If a future feature needs one, it requires a separately approved threat model and must not become executable merely by download or preview.

Artifacts are size/count limited, content-type verified rather than extension-trusted, and immutable after creation. A malformed, digest-mismatched, over-limit, or disallowed artifact fails closed. Artifact deletion follows retention policy and explicit user actions; it does not mutate historical Evidence references silently.

## Check, review, and editor freshness

**Implemented baseline — check-time hashing.** A check snapshots the complete allowed workspace at dispatch, optionally rejects a stale expected hash, and binds its result/artifacts to that internal SHA-256. Review independently snapshots before dispatch, requires a current passing non-truncated check and bounded raw Git patch, then compares the complete workspace again afterward. Any allowed file change, including Git-ignored state, changes the next snapshot and invalidates prior evidence; disallowed/oversized/link entries fail closed. Reviewer has no local-read/write capability, and the Learning Kernel consumes only current validated Evidence.

**Approved Core Alpha target — save/generation workflow.** A typed document save increments generation $n$, returns the canonical allowed-workspace hash for $n$, and rejects stale expected generation/hash rather than auto-merging. Checks and previews then name that generation explicitly; any later save creates $n+1$ and makes prior results stale. This save/generation API is not claimed as the current external-editor implementation.

mtime, editor “saved” events, model claims, process log text, and filenames are never freshness authorities.

## Privacy and export

Workspace content, attempts, diffs, process logs, reviews, and artifacts are private local data. They are not uploaded, shared, or sent to a model provider without an explicit action and a visible scope. Model context must be minimized to the typed role/tool contract; no arbitrary workspace read tool is exposed through Pi or another provider.

Exports are created locally, enumerate included items, contain hashes and provenance, exclude secrets/runtime credentials, and never include host paths. Import of an export is a separate validated flow and does not auto-merge with an existing workspace.

## Acceptance gates

**Implemented baseline.** Current regressions must continue to prove attempt path/link/device containment, owner-controlled external-editor launch/fallback, complete-workspace check-time invalidation, non-truncated review evidence, immutable internal hashes, and Reviewer no-write behavior.

**Approved Core Alpha target.** The generic workspace/editor/preview contract is not implemented until tests prove:

- path/link/device/case/size/count containment for create/read/write/preview/export;
- opaque handles cannot be changed to address another attempt or reveal a path;
- optimistic generation/hash checks reject stale writes and never auto-merge;
- embedded editor APIs cannot invoke commands or read undeclared documents;
- all preview/artifact types reject active content, remote loading, digest mismatch, oversize data, and unknown schema/type;
- remote transfer is impossible without explicit user action and the future remote editor enforces authentication, isolation, retention, and deny-network execution.
