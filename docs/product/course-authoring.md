# Course Authoring

## Document status

**Approved Core Alpha target** overall. The external Course Pack V1 path, version-matched Authoring Kit, and M9 Adaptive Studio manual editorial workflow are an **Implemented baseline**; guided AI proposals and production Course publication are not claimed implemented.

## Implemented baseline

The current Dev Learning Harness has an AI-Off Adaptive Studio workflow backed by versioned curriculum tables. It can create or clone a draft revision, edit/reorder week/day/unit records through typed forms, validate, Preview, review changes, and explicitly publish an immutable revision with a content hash. M2 adds target Course/revision/section/lesson/Activity, personal Adaptation Branch, Source Snapshot, and Knowledge Capsule contracts and persistence. M3 adds the strict external Course Pack V1 validator, Preview/install/open-as-draft/export/uninstall lifecycle, and version-matched Authoring Kit. M5 validates runtime requirements against the finite app-owned Environment Pack/check registry. M9 adds upstream/personal revision comparison, isolated branch creation and personal Publish, deterministic conflict/impact reporting, and explicit upstream integration into a new personal Draft.

The active curriculum and Authoring Kit fixture are development content, not production Courses. Source Snapshot/Capsule tables contain no approved production material. Complete production Course locale resources and guided typed AI proposals remain **Approved Core Alpha target** work. Existing hardcoded Russian Course content and retained legacy authoring routes are compatibility surfaces, not evidence that Course localization or the M11 cutover is complete.

## Authoring principles

**Approved Core Alpha target**

1. Manual authoring is complete without AI.
2. Course truth is structured, declarative, attributable, versioned, and locally inspectable.
3. Publishing is an explicit independent gate and creates an immutable Course Revision.
4. AI produces typed proposals against drafts; it never directly mutates published content or publishes.
5. The same deterministic validators govern embedded authoring and external Course Pack import.
6. Content cannot grant execution, filesystem, network, credential, provider, or plugin authority.
7. Stable IDs survive reordering and translation; they are not silently reused for different meaning.
8. Learner-visible material, protected evaluation material, learner evidence, and model output remain separate.
9. No production Course is bundled until provenance, quality, safety, licensing, and ownership are approved.

## Common Course model

**Approved Core Alpha target**

```text
Course
  identity and lineage
  primary locale + optional translations
  metadata, goals, prerequisites, outcomes
  Source Snapshots
  Knowledge Capsules
  Course Revisions
    finite Activity Graph
      Activities
      prerequisite edges
      completion/evidence contracts
    environment and trusted-check references
  personal Adaptation Branches
```

### Course

A stable top-level identity. It owns descriptive metadata, lineage policy, primary locale, source/capsule namespace, and revisions. A Course is not the current learner session and does not contain credentials or provider configuration.

### Course Revision

An immutable, content-addressed publication. It records parent/source lineage, schema version, canonical content hash, locale manifest, activity graph, source/capsule identities, declared capability requirements, and validation result. A mutable Draft becomes a revision only through explicit Publish.

### Adaptation Branch

A learner-owned lineage based on a published Course Revision. It may change approved learning content/order/pacing within invariants. It never rewrites the source revision or historical evidence. Upstream integration is explicit, diffed, validated, and previewed.

### Source Snapshot

An immutable, attributable capture or record of source material used for authoring. It includes stable ID, source kind, canonical origin when applicable, acquisition time, content identity/hash, provenance/rights metadata, locale, and bounded content or a policy-safe local reference. A live URL alone is not immutable Course truth.

### Knowledge Capsule

A bounded, attributable learning resource derived from one or more Source Snapshots. It declares learning goals, scope, primary locale, source links, content hash, and relationships to activities. Generated capsules remain draft proposals until reviewed and published.

### Activity Graph

A finite set of typed Activities and explicit prerequisite edges. It has at least one entry, reachable required terminal outcomes, stable node IDs, bounded size/depth, and deterministic next-action semantics. Cycles are rejected unless a future schema explicitly defines a bounded construct; Core Alpha does not accept open-ended loops.

## Required authoring paths

### Embedded: Adaptive Studio

**Implemented baseline** for the M9 AI-Off manual editorial and Personal Adaptation workflows; **Approved Core Alpha target** for the guided AI designer and production Course authoring gates.

Adaptive Studio is 70% editorial workspace and 30% developer instrument. It is not an IDE and must not expose a general terminal.

Required flow:

1. **New / Open / Import** — create a Course Draft, resume one, or validate an external pack.
2. **Overview** — identity, lineage, locale, source/capsule inventory, revision history, requirements, and validation summary.
3. **Outline and graph** — structured finite activity outline with prerequisite/terminal visibility.
4. **Editor** — schema-driven fields for metadata, sources, capsules, activities, rubrics, protected material, environment/check references, and translations.
5. **Inspector** — exact stable ID, type contract, references, validation, evidence expectation, and provenance.
6. **Validate** — deterministically validate the current saved Draft, identify its content digest, and report exact node/field diagnostics.
7. **Preview** — render the exact validated Draft digest as learner experience in a selected Course locale and target viewport without publication; later content changes make both validation and Preview stale.
8. **Review changes** — diff from parent/source, locale completeness, environment/capability requirements, provenance, and canonical hash inputs.
9. **Publish** — separate explicit confirmation that creates an immutable Course Revision.

Published revisions are read-only. Editing begins by cloning to a new Draft or creating a personal Adaptation Branch.

#### Guided Course Designer

**Approved Core Alpha target**

`/courses/new` offers two equal-trust paths: **Create manually** and **Describe a learning goal**. Manual creation opens the same typed Draft contract without an AI dependency. The guided Course Designer is optional and uses this restart-safe state machine:

| State                 | Required behavior                                                                                                                                                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DRAFT_REQUEST`       | Capture a natural-language goal, target outcome, current level, primary Course locale, time/pacing, tools, accessibility needs, and constraints. The UI locale remains independent. No Course exists yet.                                   |
| `DISCOVERY`           | Resolve missing scope through bounded questions; propose candidate sources, skills, activity families, and runtime needs as assumptions for review. External-provider transmission requires the privacy preflight.                          |
| `DIAGNOSTIC`          | Offer optional bounded questions or practical tasks to calibrate prior knowledge. Skip is always available; diagnostic output is evidence for the proposal, not mastery.                                                                    |
| `CURRICULUM_PROPOSAL` | Show proposed Course structure, sequencing, prerequisites, Source Snapshot candidates, Knowledge Capsules, activity/evidence contracts, Node/Python needs, trusted check references, estimates, assumptions, and provider/model provenance. |
| `USER_REVIEW`         | Let the user edit structured fields, request a revision, reject, or explicitly confirm compilation. Confirmation is not Apply, Validate, or Publish.                                                                                        |
| `COMPILATION`         | Compile the confirmed proposal into the same strict Course Pack/Draft schema used by manual and external authoring. Create only a local Draft with proposal provenance.                                                                     |
| `VALIDATION`          | Run Aptiloop's deterministic whole-Course validators. Errors return to the exact Draft field; model output never overrides a finding.                                                                                                       |
| `PUBLISHED`           | Enter only after the separate Preview, Change review, and explicit immutable Publish gate succeeds. The designer cannot transition here directly.                                                                                           |
| `FAILED`              | Preserve user input, prior safe state, operation identity, and exact failure layer; offer Retry, Back, switch provider where explicitly configured, or continue manually. Never select Mock silently.                                       |

Every transition is persisted with a bounded audit record and is idempotent on operation ID. Restart resumes the last committed state. Diagnostic answers, source material, provider responses, and proposal revisions remain distinct from deterministic learner Evidence. AI Off bypasses `DISCOVERY`/`DIAGNOSTIC`/proposal generation and leaves the complete structured manual path available.

### External: Course Pack

**Implemented baseline** for Course Pack V1.

An author may use any external text editor, build system, or generator to produce declarative Course Pack data. Those external tools are outside Aptiloop's trust boundary. Aptiloop imports only the resulting data through its own bounded parser and validators.

Required import flow:

1. Select one allowed UTF-8 Course Pack JSON file through an explicit user action.
2. Parse with byte, JSON nesting, collection, string, and parse-time limits; reject duplicate JSON keys.
3. Reject invalid encoding, unsupported schema versions, unknown fields/types, forbidden local/UNC/device/traversal path values, unsafe URLs, secrets, and command-like or executable content.
4. Validate schema, stable IDs, references, graph, locale resources, source/capsule hashes, protected material separation, environments, trusted checks, and compatibility.
5. Compute canonical content identity independent of JSON member order, insignificant serialization differences, or local absolute paths.
6. Present provenance, requirements, validation, and learner Preview.
7. Explicitly install the immutable revision or open a separate local Draft.
8. Commit atomically; invalid imports leave no partially runnable Course.

Embedded and external paths converge on the same Course Draft/Revision contract and validators. Neither path gets a privileged bypass.

#### Authoring Kit

**Implemented baseline** for the version-matched V1 kit.

Aptiloop publishes a version-matched Authoring Kit so an author can produce a valid Pack with an external text editor or AI tool without granting that tool access to Aptiloop. The Kit is a build/release artifact, not a runtime plugin, and contains:

- the exact Course Pack JSON Schema plus generated read-only type definitions;
- the closed catalog of allowed Activity types, payload schemas, evidence/completion contracts, limits, and examples;
- minimal and representative development-only templates/fixtures, clearly labeled as non-production content;
- the same deterministic local validator, canonicalizer, and hash implementation used by import, exposed through app-owned commands such as `aptiloop pack validate` and `aptiloop pack canonicalize`;
- validation-code reference, primary-locale, Source Snapshot/Knowledge Capsule, protected-material, environment/check-ID, provenance, privacy, and no-execution requirements;
- single-file JSON packaging, import, Preview, Install/Open-as-draft, and export instructions;
- a compatibility matrix mapping Kit/Core/schema versions, with unsupported combinations failing explicitly;
- guidance for external AI use: the user chooses and transmits only intended context, the AI returns declarative JSON, local validation remains authoritative, and no provider receives credentials, learner history, workspaces, or direct Aptiloop access by default.

The Kit and Adaptive Studio must accept/reject the same canonical fixture corpus and produce identical validation codes and hashes. A Kit update cannot weaken an older schema silently. External generators may help author data, but they cannot validate as authority, install, publish, fetch sources through Aptiloop, or define new Activity/runtime/tool behavior.

Repository workflow after building `@dlh/course-authoring-kit`:

```sh
node packages/course-authoring-kit/dist/cli.js validate pack.json
node packages/course-authoring-kit/dist/cli.js hash pack.json
node packages/course-authoring-kit/dist/cli.js canonicalize pack.json
node packages/course-authoring-kit/dist/cli.js finalize pack.json
```

`validate` prints the stable report and exits non-zero on a blocker. `hash` prints the content hash over the canonical hash payload. `canonicalize` requires a valid finalized pack and prints canonical JSON. `finalize` computes/replaces the declared revision content hash and prints canonical JSON. The generated schema is `packages/course-authoring-kit/schema/course-pack-v1.schema.json`; the non-production template is `packages/course-authoring-kit/templates/development-course-pack.json`. Aptiloop imports one finalized JSON file through Courses → Import Course Pack, shows Preview and diagnostics, then requires a separate Install/Open-as-draft action.

Reference external workflow:

1. select a Kit version compatible with the target Aptiloop Core;
2. author manually or give an external AI only the chosen goal, context, templates, and constraints;
3. receive one Course Pack JSON document;
4. run the local Kit validator/canonicalizer or import into Aptiloop;
5. fix all errors locally;
6. use Aptiloop's non-executing inspection, learner Preview, and explicit Install/Open-as-draft choice.

## Course Pack boundary

**Approved Core Alpha target**

A Course Pack may contain declarative:

- schema and pack version;
- Course identity, metadata, lineage, primary locale, and translations;
- Source Snapshot metadata and bounded permitted resources;
- Knowledge Capsules;
- Activity Graph and typed Activity payloads;
- protected evaluation data in its designated section;
- environment requirements and references to trusted environment/check IDs;
- provenance, ownership/license declarations, content hashes, and compatibility constraints.

A Course Pack must never contain or activate:

- commands, shell fragments, argument vectors, scripts, installers, package-manager lifecycle hooks, migrations, or executable plugins;
- arbitrary HTML/JavaScript or active embedded content;
- credentials, tokens, cookies, auth profiles, provider sessions, or environment-secret values;
- absolute local paths, filesystem handles, repository roots, editor executables, or external endpoints with embedded credentials;
- learner profiles, answers, evidence, mastery, mistakes, transcripts, workspaces, or private adaptation data by default;
- arbitrary tool definitions or permissions;
- network fetch-on-open/install behavior.

Unknown fields/types that could affect execution, evaluation, graph semantics, or protected data fail closed. Forward-compatible metadata may be retained only through an explicitly bounded extension policy; there is no plugin escape hatch.

## Activity contract

**Approved Core Alpha target**

Every Activity declares:

- stable ID and type;
- primary-locale content plus optional translations;
- objectives and expected learner action;
- prerequisite and unlock relationships;
- typed completion and evidence requirements;
- hint/feedback policy, including first-attempt protection;
- relevant Knowledge Capsules and Source Snapshots;
- optional environment and trusted-check references;
- optional app-role capability requirement;
- deterministic failure/recovery behavior;
- protected evaluation material in a server/private boundary.

Activity types are registered application contracts, not pack-provided code. Unknown types do not render or execute.

The learner Activity Frame owns common context, state, accessibility, runtime/AI availability, response, evidence, and action footer. A type-specific renderer changes activity controls, not security or state authority.

## Environment and trusted checks

**Implemented baseline for external Course Pack runtime references and the finite M5 local registry; Approved Core Alpha target for Adaptive Studio authoring UX and future installed packs.**

Course authoring selects declarative environment requirements and trusted IDs. It never authors commands.

Core Alpha supports contracts for:

- **Node** — compatible runtime range, package-manager policy, trusted installed template/dependency identity, and registered check IDs;
- **Python** — compatible runtime range, environment/dependency policy, trusted installed template identity, and registered check IDs.

Execution Fabric resolves references only from an app-owned trusted registry. Each check defines the executable/arguments/working-directory rule, environment allowlist, timeout, output cap, cancellation, cleanup, and result parser outside the Course Pack. The browser and model supply only operation/entity/check IDs permitted by the activity.

A pack with an unknown or incompatible environment/check ID may be inspected but cannot be installed as runnable content until the requirement is satisfied explicitly.

## Optional AI proposals

**Approved Core Alpha target**

Course Designer may use Pi runtime through narrowly scoped Aptiloop typed tools such as proposing metadata, capsule text, activity fields, graph edges, or translations. Tool inputs/outputs are strict, bounded, and validated.

Every proposal shows:

- provider and model;
- destination Draft and target stable IDs;
- data categories sent externally;
- before and after values;
- sources/provenance used;
- validation changes and unresolved warnings;
- Apply and Reject actions.

AI has no filesystem, shell, network, credential, general edit, install, environment, or publish tool. Apply mutates only the selected Draft fields after validation. Apply and Publish never share one confirmation. Provider failure is explicit and never triggers Mock fallback.

## Validation

**Implemented baseline for Course Pack V1 validation/install and M9 Adaptive Studio manual validation/publication; Approved Core Alpha target for AI-assisted authoring and production Course approval.**

Publication and installation require zero errors across:

- supported schema/pack versions and canonical serialization;
- stable ID uniqueness and immutable lineage;
- all references and ownership boundaries;
- graph finiteness, reachability, prerequisites, terminal outcomes, and bounds;
- typed activity payloads and completion/evidence contracts;
- every required/terminal learner path has a deterministic or manual completion route; an AI-dependent Activity may be optional/non-blocking but cannot make publication or Course completion depend on a provider;
- first-attempt/protected-answer separation;
- primary locale completeness and translation mapping;
- Source Snapshot and Knowledge Capsule identity, attribution, and provenance fields;
- environment/capability compatibility and trusted check existence;
- pack size/resource/depth/path/link/encoding constraints;
- prohibited commands, scripts, plugins, secrets, private learner data, and active content;
- deterministic content hash and revision collision handling.

Warnings may cover optional translation completeness, unavailable optional AI, unverified provenance claims, or future compatibility. A warning never downgrades a safety, schema, primary-locale, graph, or protected-data error.

## Publish, install, and export

**Implemented baseline for external Pack Install/Export and M9 Adaptive Studio manual Publish/clone/personal integration; Approved Core Alpha target for AI-assisted and production publication gates.**

- **Publish** converts a local Draft into an immutable revision after Validate, Preview, change review, and explicit confirmation.
- **Install** atomically records a validated external immutable revision after Preview and explicit confirmation.
- **Export** serializes explicitly selected Course content and declares included locales/sources/protected material. It excludes credentials, provider sessions, UI settings, learner evidence, mastery, transcripts, workspaces, absolute paths, and unrelated adaptations.
- Re-export does not erase or fabricate provenance and licensing fields.
- Content hash and revision identity are shown before irreversible publication/installation.

## Privacy, provenance, and licensing

Course material, Source Snapshots, Capsules, Drafts, protected answers, and personal adaptations remain local by default. External provider authoring is an explicit disclosure action. Import never initiates network access by itself.

Authors record origin, authorship/ownership claim, license/terms claim, acquisition date, and transformation notes for source/content resources. Aptiloop validates presence and consistency; it does not certify that a claim is legally correct.

**Approved Core Alpha target:** project licensing uses the owner-approved engineering direction of AGPL-3.0-only for the integrated app/server and Apache-2.0 only for newly separated reusable SDK packages after boundaries/ownership are verified. Content/fixtures require separate terms, and third-party notices/SBOM/trademark policy require professional legal review. No license text or production Course is authorized by this target alone.

## Baseline migration

**Approved Core Alpha target**

Migration is incremental:

1. preserve current versioned curriculum/session snapshots and stable IDs;
2. introduce Course/Course Revision/Activity/Source/Capsule contracts additively;
3. inventory candidate SQLite databases and create verified non-overwriting backups;
4. map legacy curriculum and evidence with provenance, quarantining unmatched/ambiguous rows;
5. dual-read/compare, then cut callers over only after reconciliation evidence;
6. retain legacy rows until rollback and approval gates close;
7. treat current seeded curriculum and exercise templates as development fixtures, not production Courses;
8. retire legacy writes only after every caller and stored-data path is migrated.

No big-bang table rename, destructive reset, silent reclassification, or published-content mutation is acceptable.

## Acceptance

Course authoring is not complete until both embedded and external paths can produce the same valid Draft/Revision, the full Course validates and previews, immutable publish/install is explicit, hostile packs fail closed without partial install, manual authoring works with AI disabled, proposals cannot publish, Node and Python references resolve through trusted IDs only, locale and provenance rules hold, private data is excluded, restart preserves drafts, and an installed Course completes the required end-to-end learner journey.
