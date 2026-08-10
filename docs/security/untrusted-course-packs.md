# Untrusted Course Packs

**Document status:** The M3 single-document Course Pack V1 importer and lifecycle are an **Implemented baseline**. Archive/directory transport, registries/signatures, untrusted executable content, and production Course distribution remain **Future**.

## 1. Security objective

A Course Pack is untrusted data. It is a declarative, schema-versioned description of a Course, immutable revisions, finite activity graph, Source Snapshots, Knowledge Capsules, localization metadata, and trusted check references. It is never a program, plugin bundle, environment description, credential carrier, or permission grant.

The top entity is `Course`. Installation creates or reuses immutable Course revisions and a personal adaptation branch; it does not mutate published history. The Learning Kernel—not pack logic—owns progression, state, evidence, and mastery.

## 2. Allowed and forbidden capabilities

**Implemented baseline — allowed declarative fields:**

- stable pack, Course, revision, activity, topic, source, and capsule IDs;
- schema version, pack version, content hash, author/provenance declarations, primary course locale, and optional translations;
- finite directed activity graph with explicit prerequisites and supported activity kinds;
- bounded text, Markdown restricted by the application renderer, quiz choices, rubric data, and structured evidence requirements;
- Source Snapshot metadata/content and Knowledge Capsules whose provenance and privacy classification are explicit;
- references to Aptiloop-owned trusted check IDs plus typed, bounded input fixtures; a reference is not a command;
- minimum Core capability/runtime contract identifiers selected from an application allowlist.

**Implemented baseline — prohibited anywhere, including extensions and unknown fields:**

- executable names, commands, arguments, current directories, shell strings, package scripts, lifecycle hooks, arbitrary test commands, or process environment entries;
- JavaScript, Python, WebAssembly, native binaries, macros, templates that evaluate code, plugins, dynamic imports, provider adapters, or install hooks;
- credentials, cookies, tokens, authorization headers, secret references, private keys, provider sessions, or embedded `.env` material;
- absolute/local filesystem paths or handles, host mounts, home-directory references, registry/device/UNC/traversal values, link/special-file metadata, or any field that asks Aptiloop to resolve a pack-provided path;
- arbitrary network requests, webhooks, embedded active HTML, resource images, or non-HTTP(S) source URLs;
- AI role prompts that grant tools, provider/model credentials, or a route around app-owned typed tools;
- production courses bundled as product fixtures. Core Alpha ships pack tooling/contracts, not production courses.

UI locale (`en-US` or `ru-RU`) is independent of the one primary course locale. A translation cannot change graph semantics, answers, check IDs, or evidence contracts.

## 3. Import pipeline

**Implemented baseline:**

1. **Receive one document as bytes.** Accept only an explicitly selected V1 JSON file and place its bytes in a fresh private staging area outside active Course storage. Directory/archive transport is Future.
2. **Bound before parsing.** Enforce input bytes, JSON nesting, object/array item counts, string lengths, total decoded text, and parse time. Concrete ceilings are milestone-owned implementation parameters in a versioned limits profile; M3 acceptance requires security review, documented rationale, and boundary tests for every threshold. They are not an additional owner scope decision unless implementation requires a new capability or material security tradeoff.
3. **Decode and parse strictly.** Require UTF-8, reject BOM/encoding ambiguity where unsupported, duplicate JSON keys, non-object roots, non-finite numbers, unsupported schema versions, and unknown fields.
4. **Reject authority-bearing values.** Reject commands, scripts, plugins, secrets, credential-like values, unsafe URLs, active content, and local/absolute/drive/UNC/device/traversal/path-resolution fields before semantic import.
5. **Validate the closed model.** Reject unknown activity kinds, cycles, missing references, unreachable required nodes, locale inconsistencies, protected-answer leakage, required AI-only paths, and forbidden capability fields.
6. **Verify canonical content.** Canonicalize the parsed V1 object, recompute its declared content hash, and reject collisions or mismatches. A Future signature may establish publisher identity only under a separate trust policy; it never grants execution authority.
7. **Validate source/privacy metadata.** Restrict external links to intended HTTP(S); imported snapshots remain local and are never fetched or uploaded silently.
8. **Stage database writes transactionally.** Resolve IDs, collisions, and provenance without overwriting existing immutable revisions. Any error removes staging and rolls back database rows.
9. **Preview before consequence.** Show provenance, requirements, validation, learner Preview, Course/revision/hash, and the explicit choice **Install immutable revision** or **Open as local draft**.
10. **Commit atomically and read back.** Persist only the chosen validated result, record import origin/hash/schema/validation/user action, and verify final identity. Re-import of identical bytes is idempotent; conflicting identity is rejected.

## 4. Control records

### PACK-CTRL-001 — JSON envelope and resource handling

- **Attack path:** crafted bytes exploit encoding ambiguity, duplicate keys, extreme nesting/item/string counts, parser time/memory, path-shaped values, or partial staging to alter meaning or exhaust resources.
- **Impact:** validation bypass, inconsistent hashes, storage exhaustion, denial of service, or unintended host-path access.
- **Existing mitigation:** the implemented byte-bounded UTF-8/strict-JSON importer rejects duplicate keys and excess limits, applies closed schema and semantic path-value checks, hashes canonical content, uses private expiring staging, commits transactionally, and removes invalid/expired staging bytes. V1 accepts no archive or directory transport.
- **Residual:** local resource exhaustion is bounded but native process isolation is irrelevant to parsing; future format/limit changes require the same boundary suite and review.
- **Test:** invalid/ambiguous encodings, duplicate keys, deep/wide/large/slow documents, forbidden path values, interrupted import, rollback, cleanup, canonical hash parity, and cross-platform deterministic results.

### PACK-CTRL-002 — Declarative-only schema

- **Attack path:** a pack hides commands, scripts, plugins, environment entries, executable content, or provider/tool permissions in optional/unknown fields.
- **Impact:** local execution, secret access, nondeterminism, or privilege expansion.
- **Existing mitigation:** Course Pack V1 is exact and strict; recursive semantic validation rejects unknown/authority-bearing fields, command/script/plugin/credential-shaped data, active content, unsafe URLs, and local/path-shaped values. Persistence receives only the validated declarative model, and M5 execution resolves only app-owned trusted IDs.
- **Residual:** validation does not certify content quality, correctness, ownership, or licensing. Those remain independent publication gates.
- **Test:** fixtures containing command/argv/cwd/env/scripts/hooks/plugins/binaries/Wasm/dynamic templates/provider RPC/general tool fields must fail before database or filesystem publication.

### PACK-CTRL-003 — Execution separation

- **Attack path:** an imported activity references a package script or creates files later consumed by the native `npm test` path.
- **Impact:** arbitrary code with local-user authority and access to host data/credentials/network.
- **Existing mitigation:** M5 resolves only exact app-owned Environment Pack/check IDs. The compatibility native check remains reachable only from repository-controlled attempts; Course Pack validation accepts no executable/path/dependency fixture and rejects unknown runtime requirements before installation. Process requests carry IDs, never plans.
- **Residual:** trusted local-native checks still have local-user/network authority, so imported Course bytes must remain unreachable from their workspaces. A future untrusted execution product needs independent isolation; an allowlist is not a sandbox.
- **Test:** Course Pack suites reject command/argv/cwd/env/script/path/fixture values and unknown requirements; Execution Fabric suites prove exact/collision-safe ID resolution and never accept pack/browser executable configuration.

### PACK-CTRL-004 — Graph and Learning Kernel integrity

- **Attack path:** a pack supplies cycles, missing prerequisites, duplicate IDs, mutable revisions, protected answers in learner fields, or its own mastery/state transitions.
- **Impact:** deadlocked activities, answer disclosure, overwritten history, or nondeterministic/forged adaptation.
- **Existing mitigation:** M3 validates finite referentially complete graphs, stable identities, learner/protected separation, and immutable collision behavior before transactional install. M4 routes accepted facts through the deterministic kernel; pack content cannot carry progression/mastery state, and the same fact frontier replays to the same canonical projection hash.
- **Residual:** legacy rows without complete fact meaning stay compatibility history or immutable quarantine; production Course quality/correctness remains an independent gate.
- **Test:** cycle/unreachable/duplicate/dangling tests; protected-field DTO tests; immutable revision and idempotent import tests; deterministic replay from imported content; rejection of mastery/state fields.

### PACK-CTRL-005 — Source and Markdown privacy

- **Attack path:** a pack includes tracking images, local-network URLs, unsafe schemes, active HTML, or a private snapshot marked public; render/fetch causes unintended disclosure.
- **Impact:** IP/timing disclosure, local-service requests, private-source exposure, or misleading content.
- **Existing mitigation:** React escaping and no raw-HTML plugin are Implemented baseline; current Markdown still permits external image fetches. Private-data files are Git-ignored.
- **Source fix:** restrict Markdown elements and URL schemes, prohibit automatic external resources, classify every source/capsule, require an explicit user action before any network fetch/upload, and store private snapshots locally.
- **Test:** hostile Markdown/URL fixtures; no automatic request; private/public classification and explicit-disclosure tests; export excludes private source bytes unless separately selected.

### PACK-CTRL-006 — Provenance and immutable identity

- **Attack path:** a modified pack reuses a trusted identity/version, omits origin/license data, overwrites a revision, or exploits nondeterministic canonicalization.
- **Impact:** content substitution, loss of auditability, licensing ambiguity, and corrupted historical evidence.
- **Existing mitigation:** M3 requires author/provenance/terms claims, canonicalizes and hashes one finalized document, rejects hash/identity collisions, stores immutable validation/provenance records, and never overwrites an installed revision. Validation confirms presence/shape; it does not certify legal truth.
- **Residual:** there is no approved production Course, publisher signature/trust service, or completed legal review.
- **Test:** golden canonical hashes; changed-content/same-identity rejection; missing provenance/terms validation; immutable revision and deterministic re-import tests.

## 5. Installation and publication gates

A pack may be previewed only after structural validation. Installation requires an explicit user action naming Course, revision, primary locale, origin, content hash, validation warnings, source privacy classes, and required Core/check contracts. Publishing an edited revision is a separate explicit action and cannot be performed by AI.

Release is blocked unless:

- all PACK controls above have behavioral tests;
- zero validation error remains;
- no prohibited field or authority-bearing value is accepted;
- every required graph node is finite and reachable;
- imported content cannot reach process/provider/general-tool authority;
- private-source and external-link disclosure behavior is explicit;
- failed import leaves no active rows/files;
- the same bytes produce the same normalized hash and result on supported platforms.

## 6. Future executable content

**Future:** if executable learner submissions or third-party checks are later required, they need a separately reviewed execution product and threat model. A container alone is not sufficient evidence. Required properties include no host home/credentials/network/mounts, immutable runtimes, disposable workspaces, resource/process quotas, strong OS isolation, and escape tests. Until that boundary is approved, Course Packs remain declarative and non-executable.
