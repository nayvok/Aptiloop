# Execution Isolation and Trusted Checks

**Document status:** M5 trusted local-native Execution Fabric, Node/Python contracts, and compatibility migration are an **Implemented baseline**. Native execution is not a sandbox. Untrusted executable content and isolated server/remote backends are **Future**.

## 1. Baseline boundary

The Implemented baseline practice path copies a repository-controlled template into a per-attempt directory, establishes a Git baseline, and accepts only operation/entity IDs plus the literal compatibility command ID `test`. The M5 Fabric resolves that to immutable environment/check descriptors and an app-owned `shell: false` plan, validates exact attempt ownership and complete-workspace freshness, supplies a minimal environment, bounds output/runtime, and terminates the process tree on cancellation or limits. Canonical containment rejects traversal and link/reparse escape. Review requires a passing non-truncated result bound to the current Git-visible patch SHA-256 and persists an immutable evidence bundle.

Those controls make execution auditable and reject browser/pack/model command authority; they do not isolate malicious Node/Python code from the local account or network. The compatibility npm contract also preserves learner-template script authority. No imported Course Pack, arbitrary dependency, AI-authored executable, learner-selected command, or untrusted user may enter this backend.

## 2. Approved Core Alpha Execution Fabric

The Execution Fabric is a generic application-owned dispatcher, not a terminal:

- the request contains a trusted check ID, activity/revision ID, attempt ID, operation ID, and bounded typed input;
- a versioned trusted registry maps check ID to an immutable environment contract and server-owned plan;
- browser, Course Pack, AI, and learner content cannot select executable, argv, cwd, environment, network, mounts, timeout, or output limits;
- every run uses an attempt-scoped directory and produces a typed bounded result plus immutable evidence fingerprint;
- unknown IDs, contract/version mismatch, stale revision, unsafe path, or budget breach fail closed;
- Reviewer consumes the evidence read-only, cannot patch files, and cannot authorize execution;
- only the Learning Kernel decides whether result evidence changes progression/mastery.

No arbitrary AI filesystem, shell, network, or edit tool is part of the Fabric.

## 3. Environment contracts

### Node contract

**Implemented baseline:** the Core Node registry pins Node major 24, the exact built-in `node --test` plan, `package-lock.json` lockfileVersion 3, a minimal environment, the input snapshot hash, and fixed time/output limits. The separate compatibility npm contract is explicitly less isolated and retained only for existing trusted repository templates.

### Python contract

**Implemented baseline:** the Core Python registry pins the Python 3 contract, exact isolated `-I -B -m unittest discover` plan, an app-owned empty `requirements.lock`, user-site/bytecode-disabling environment, the input snapshot hash, and fixed time/output limits. It does not install or evaluate pack-supplied dependencies, setup hooks, modules, commands, or paths.

Both accepted local-native contracts use `inherit-local-trusted` network policy and remain visibly trusted-only/unsandboxed. Their current 120-second/1 MB process limits reuse the existing proven runner; memory, disk, and process-count quotas require a future isolated backend. Enforced no-network behavior is required only for a separately approved backend that claims isolation.

## 4. Control records

### EXEC-CTRL-001 — Command-plan ownership

- **Attack path:** browser, AI, learner input, or pack supplies executable/argv/cwd/script or selects an unknown operation.
- **Impact:** arbitrary command execution and local account compromise.
- **Existing mitigation:** Implemented baseline accepts only `commandId: "test"`; server owns executable/args/cwd; `shell: false` is used.
- **Source fix:** replace the single command with a versioned trusted-check registry while preserving server ownership; strict request schemas contain no command-like fields and unknown IDs fail closed.
- **Test:** unknown/forged IDs and command/argv/cwd/env fields are rejected; spawn capture exactly matches the registry for every Node/Python check.

### EXEC-CTRL-002 — Filesystem containment

- **Attack path:** traversal, absolute/UNC/device/ADS path, symlink/junction/reparse change, race, or malicious deletion target escapes the attempt root.
- **Impact:** host file read/write/delete or use of private code/data.
- **Existing mitigation:** Implemented baseline canonical path checks, trusted-root resolution, reparse rejection, isolated copies, and deletion containment.
- **Source fix:** make resolved canonical attempt handles the only filesystem capability passed to the Fabric; revalidate at use boundaries and never accept pack/browser paths.
- **Test:** cross-platform malicious path/link/race fixtures; host canary remains unchanged; cleanup cannot target a parent/sibling.

### EXEC-CTRL-003 — Environment and credential isolation

- **Attack path:** a child inherits provider tokens, sidecar passwords, database paths, cloud credentials, auth-store variables, or proxy configuration and reads/exfiltrates them.
- **Impact:** credential/private-data disclosure and lateral provider access.
- **Existing mitigation:** Implemented baseline exercise child environment is minimal and rejects secret-shaped overrides; Codex child inheritance remains a separate High finding.
- **Source fix:** one environment builder per trusted runtime permits only essential OS/runtime variables and synthetic run identifiers; strip secret-shaped/cross-provider variables and do not mount auth stores.
- **Test:** parent environment contains varied sentinel names/values; child records its environment; no sentinel or private path appears in output, logs, database, WAL, or backup.

### EXEC-CTRL-004 — Network isolation

- **Attack path:** checked code contacts internet, metadata endpoints, loopback sidecars, LAN services, or a collaborator and leaks data or downloads behavior.
- **Impact:** exfiltration, remote control, nondeterminism, and supply-chain expansion.
- **Existing mitigation:** none that makes current native exercise execution network-isolated; `shell: false` is unrelated to network access.
- **Source fix:** Core Alpha permits only repository-trusted checks and records this residual authority. Any Future untrusted execution requires enforceable deny-by-default network isolation at OS/container policy, including loopback and DNS.
- **Test:** supported runtimes attempt DNS, internet, loopback, IPv4/IPv6, LAN, proxy, and metadata endpoints; all fail under the Future isolation profile without affecting run cleanup.

### EXEC-CTRL-005 — Resource and process containment

- **Attack path:** process floods stdout/stderr, loops, allocates memory/disk/processes, or leaves descendants after cancel/timeout.
- **Impact:** local denial of service and persistent background activity.
- **Existing mitigation:** Implemented baseline has timeout, cumulative output cap, cancellation, and process-tree cleanup.
- **Source fix:** preserve those limits and add registry-owned memory, disk, file, process/thread, CPU, and concurrency quotas where the supported platform can enforce them; a limit breach is a failed check, never partial success.
- **Test:** output flood, infinite loop, allocation, disk fill, fork/child tree, cancellation race, and concurrent-run fixtures; assert bounded diagnostic, no descendant, and reusable Fabric.

### EXEC-CTRL-006 — Dependency and runtime identity

- **Attack path:** pack/attempt alters package scripts, dependencies, interpreter lookup, PATH, or a mutable global environment so the trusted check executes different code.
- **Impact:** arbitrary code, nondeterministic grading, or evidence that cannot be reproduced.
- **Existing mitigation:** current templates and command are repository-controlled and dependencies lockfile-pinned, but native host/runtime identity is not a complete isolation guarantee.
- **Source fix:** trusted registry pins environment contract and dependency content identity; no install/lifecycle action consumes pack content; runtime/check identity is recorded in evidence.
- **Test:** mutate package scripts/dependency files/PATH/runtime; dispatch rejects identity mismatch; golden run records exact contract and reproduces result.

### EXEC-CTRL-007 — Evidence freshness and deterministic authority

- **Attack path:** learner edits after a passing run, truncated/stale evidence reaches Reviewer, mtime is forged, or a caller directly submits mastery/result state.
- **Impact:** false approval and corrupted adaptation/mastery.
- **Existing mitigation:** Implemented baseline fingerprints the full non-truncated Git diff with SHA-256, rejects stale/truncated review, compares before/after review, and v2 Learning Kernel derives evidence. The old mtime-bypass claim is obsolete.
- **Source fix:** bind result to activity revision, attempt, check contract, exact input/diff hash, operation ID, and terminal run; Reviewer remains read-only; only the Learning Kernel accepts typed evidence.
- **Test:** same-mtime edit, stale run, truncated diff, baseline tamper, replay/duplicate operation, Reviewer mutation, and caller-supplied mastery are rejected.

### EXEC-CTRL-008 — Reviewer authority

- **Attack path:** Reviewer obtains filesystem/edit/apply tools or its response automatically patches/approves learner work.
- **Impact:** unreviewed mutation and collapse of the learner correction cycle.
- **Existing mitigation:** Implemented baseline Reviewer uses Codex read-only/no-network, OpenCode deny-write, no apply route, and before/after diff invariant.
- **Source fix:** preserve read-only/no-patch policy across Pi/provider migration; Reviewer receives only bounded serialized evidence through a typed tool/result; its decision never executes code or edits.
- **Test:** adapter policy matrix and malicious reviewer output/tool request; zero filesystem/process action; diff unchanged; invalid/oversized response cannot produce trusted review.

## 5. Release gates

Core Alpha may approve trusted checks only when:

1. every public request maps to a known immutable check contract;
2. no Course Pack, browser, learner, or AI field controls process configuration;
3. Node and Python contracts are versioned and exercised on supported platforms;
4. environment sentinel, path escape, budget, cleanup, identity, and stale-evidence tests pass;
5. imported packs are proven unreachable from native executable content;
6. UI and docs say “trusted native execution,” never “sandbox”; and
7. Reviewer remains read-only with no patches.

**Future:** executing untrusted code requires an independently reviewed isolation boundary with no host home, credentials, network, or writable host mounts; immutable images; disposable workdir; enforced quotas; and escape testing. A container label or native command allowlist alone does not satisfy this gate.
