# Workspaces, Editors, Previews, and Artifacts

Status: isolated per-attempt workspaces, Zed launch, complete-workspace check snapshots, normalized check/process artifacts, and immutable review evidence bundles are an **Implemented baseline**. Opaque handles, embedded editing, and editor-neutral preview/document APIs are an **Approved Core Alpha target**. Remote editors are **Future**.

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
- computes the complete Git-visible patch and requires a passing non-truncated check bound to the current fingerprint before read-only review;
- persists an immutable review evidence bundle and verifies the workspace evidence is unchanged; Reviewer has no patch/apply route.

This is a local single-user convenience boundary. Host paths are visible during explicit local editor handoff, and native editor/check processes retain local-account and network authority. It is not a sandbox. Compatibility npm scripts and templates must remain trusted repository content; imported Course content cannot become executable workspace input.

## Approved workspace contract

The target API uses capabilities rather than paths:

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

A Preview is a bounded, read-only rendering derived from a specific workspace snapshot. It is not Evidence until a trusted check/evaluator produces Evidence. Every preview records `workspaceId`, `generation`, `contentHash`, type, media type, size, and truncation state.

Approved types:

| Preview type          | Status                                                         | Contract                                                                                                                                                   |
| --------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `plain-text`          | **Approved Core Alpha target**                                 | UTF-8 text, escaped, bounded; no active content.                                                                                                           |
| `source-code`         | **Approved Core Alpha target**                                 | UTF-8 source plus trusted language ID and line metadata; no execution.                                                                                     |
| `markdown-safe`       | **Approved Core Alpha target**                                 | Strict safe subset; raw HTML and active resources are disabled; external links are explicit.                                                               |
| `diff`                | **Implemented baseline** for Git patch; generic form is target | Complete or explicitly truncated structured diff tied to baseline/current hashes. Truncated diff cannot authorize review.                                  |
| `image`               | **Approved Core Alpha target**                                 | Stored application artifact with verified media type, dimensions, byte cap, and no remote URL loading.                                                     |
| `table-json`          | **Approved Core Alpha target**                                 | Schema-bounded rows/cells rendered as data, never HTML.                                                                                                    |
| `static-web`          | **Future**                                                     | Separate sandboxed origin/frame, strict CSP, no credentials/storage, and network denied. It must not be implemented as unsanitized HTML in the app origin. |
| `interactive-runtime` | **Future**                                                     | Requires a dedicated sandbox and message schema; no direct application DOM, storage, network, or host access.                                              |

Preview requests name only an approved type and logical document/artifact IDs. They cannot carry renderer code, HTML scripts, plugins, commands, or URLs.

## Artifact contract

An Artifact is immutable output from a workspace/check/review operation. It is addressed by opaque ID and content digest, never by backend path.

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

The authoritative sequence is:

1. save produces canonical allowed-workspace manifest/hash $n$, independent of Git ignore, with explicit app-owned exclusions;
2. check runs against $n$ and returns a result bound to $n$;
3. any allowed file edit creates $n+1$ and makes the result stale; a disallowed/oversized/link entry fails closed;
4. Reviewer receives only the bounded disclosed patch and a passing check for the current hash;
5. Reviewer has no local-read or write capability; a before/after hash mismatch invalidates its result;
6. `changes_requested` returns to edit → fresh check → fresh review;
7. the Learning Kernel consumes the current validated Evidence.

mtime, editor “saved” events, model claims, process log text, and filenames are never freshness authorities.

## Privacy and export

Workspace content, attempts, diffs, process logs, reviews, and artifacts are private local data. They are not uploaded, shared, or sent to a model provider without an explicit action and a visible scope. Model context must be minimized to the typed role/tool contract; no arbitrary workspace read tool is exposed through Pi or another provider.

Exports are created locally, enumerate included items, contain hashes and provenance, exclude secrets/runtime credentials, and never include host paths. Import of an export is a separate validated flow and does not auto-merge with an existing workspace.

## Acceptance gates

The target is not implemented until tests prove:

- path/link/device/case/size/count containment for create/read/write/preview/export;
- opaque handles cannot be changed to address another attempt or reveal a path;
- optimistic generation/hash checks reject stale writes and never auto-merge;
- embedded editor APIs cannot invoke commands or read undeclared documents;
- external adapter executable/argv remain owner-controlled and path fallback is local-only;
- all preview/artifact types reject active content, remote loading, digest mismatch, oversize data, and unknown schema/type;
- edits invalidate checks/reviews, truncated diffs cannot authorize review, and Reviewer cannot mutate;
- remote transfer is impossible without explicit user action and the future remote editor enforces authentication, isolation, retention, and deny-network execution.
