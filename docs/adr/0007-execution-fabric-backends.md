# ADR 0007: Execution Fabric and Environment Backends

## Status

Approved Core Alpha target

## Date

2026-08-08

## Context

Practice activities need reproducible checks without allowing course authors, browsers, or models to select arbitrary commands. The current Node exercise path has valuable attempt isolation, canonical-path, fixed-command, output-cap, visible-change fingerprint, and reviewer controls, but it is tied to a trusted repository template and one `npm test` plan. Core Alpha also requires explicit Node and Python environment contracts.

Related specifications: [Execution Fabric](../architecture/execution-fabric.md), [Environment Packs](../architecture/environment-packs.md), [Workspaces and editors](../architecture/workspaces-and-editors.md), [Execution isolation](../security/execution-isolation.md), [Lesson Engine](../architecture/lesson-engine.md), and [Threat model](../security/threat-model.md).

## Decision

Aptiloop uses a generic Execution Fabric with app-owned backends and declarative environment contracts.

- Course activities reference an environment contract through `environmentId` and trusted checks through `checkIds` only. They never provide executable paths, commands, arguments, working directories, environment variables, package scripts, shell fragments, or network policy.
- A trusted registry maps each check ID to a versioned execution plan. Unknown IDs fail closed.
- The common backend contract covers prepare, execute check, cancel, collect bounded artifacts, inspect change evidence, and dispose. Results are typed, size/time bounded, provenance-stamped, and suitable as Learning Kernel evidence.
- Node and Python Environment Packs declare runtime/version constraints, dependency-lock expectations, fixture hashes, allowed checks, resource limits, filesystem scope, network policy, and platform compatibility. They contain no secrets or user-selected commands.
- Workspaces are attempt-scoped and canonically contained. Links/reparse escapes are rejected; child environments are minimized and secret-shaped variables are excluded; processes use `shell: false`, deadlines, output caps, and process-tree cleanup.
- The Core Alpha local-native backend is trusted-only and unsandboxed: it may use `inherit-local-trusted`, and its process can reach anything readable by the local account. Course Pack content never enters this path. Enforced deny-network/no-host-access is a Future isolated-backend contract, not a native-process claim.
- Reviewer consumes a bounded evidence bundle read-only and returns findings. It cannot edit or patch the workspace; the app verifies a canonical manifest/hash covering every allowed workspace file before and after review.
- External editors are optional views over an approved workspace path and do not become execution authorities.

## Consequences

- Node, Python, local-process, and future container backends can share lesson semantics without exposing command selection to content.
- Environment contracts and trusted check registries become signed/versioned operational assets maintained separately from Course Packs.
- Supporting untrusted code requires real OS/container isolation; path validation and fixed commands alone are not a sandbox.
- Check results must record environment/check versions so historical evidence remains interpretable.

## Alternatives

- **Put commands in Course Packs:** rejected because declarative content would become local code execution.
- **Let models choose tools or shell commands:** rejected because it bypasses deterministic policy and reviewer read-only guarantees.
- **Hardcode Node forever:** rejected because Python support and backend portability need one typed boundary.
- **Treat an external editor as the runtime:** rejected because editor configuration and extensions are outside Aptiloop's evidence contract.

## Implementation status

**Implemented baseline:** trusted templates are copied into isolated attempts; canonical containment and link rejection are present; one allowlisted Node test command runs with `shell: false`, sanitized environment, deadlines, output caps, process cleanup, Git baseline, a fingerprint of Git-visible changes, and reviewer mutation checks. Git-ignored files are not covered, so this is not a complete workspace freshness guarantee. There is no generic Execution Fabric registry, portable Environment Pack contract, Python backend, or sandbox for untrusted imported code.

**Approved Core Alpha target:** the backend and environment boundaries above are normative; no future Fabric or Environment Pack package is claimed to exist.

**Future:** hardened containers/VMs, remote runners, additional languages, enforced network/host isolation, and explicitly networked isolated environments.

No major implementation is authorized until the Core Alpha audit/specification set passes the owner approval gate.
