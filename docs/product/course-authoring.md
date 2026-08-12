# Course Authoring

## Document status

**Approved Core Alpha target**

This document defines the complete authoring contract. The implemented mechanisms operate on development content; no production Course content, legal approval, or distribution authorization is implied.

## Implemented baseline

The current Aptiloop application has an Adaptive Studio workflow backed by versioned curriculum tables. It can create or clone a draft revision, edit/reorder week/day/unit records through typed forms, validate, Preview, review changes, and explicitly publish an immutable revision with a content hash. The optional M10 Course Designer persists its finite workflow and diagnostics, reads only the selected Draft and explicitly approved sources, returns strict stable-ID changes with immutable provider/model/prompt attribution, and requires separate Apply, Preview, Changes, and Publish decisions.

Manual and assisted Course creation require an explicit primary Course locale. Common valid BCP 47 locales are presented with interface-localized display names, while a validated custom-locale path preserves the broader Course schema. The choice is persisted as Draft/Course metadata and remains independent from the local `en-US`/`ru-RU` interface preference.

The active curriculum and Authoring Kit fixture are development content, not production Courses. Source Snapshot/Capsule tables contain no approved production material. Complete production Course locale resources remain **Approved Core Alpha target** work. Existing Russian Course fixture content and retained legacy authoring routes are compatibility surfaces, not production Course localization evidence.

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
10. Creation presents two assisted starts—external-model Pack generation and the connected Course Designer—while keeping manual no-AI creation as a quiet, complete fallback.
11. Capability state is truthful: technical readiness follows the selected role, provider, exact model, and current observed evidence; model strength remains a user judgment, and unknown evidence is labeled rather than guessed.
12. Course Pack bytes are selected only on `/courses/import`; `/courses/new` never embeds an importer.

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

**Approved Core Alpha target** entry hierarchy:

1. **External model + Course Pack** — download version-matched Course Pack V1 instructions that embed the approved brief, exact generated schema, and template; use a capable model outside Aptiloop; then upload the returned JSON only at `/courses/import`.
2. **Connected Course Designer** — use the configured provider and exact model after Aptiloop reports the available server-owned role/capability evidence without claiming to score model strength.
3. **Manual without AI** — a visually quieter fallback that remains complete and never transmits content.

The first two are the primary assisted starts. All three converge only after a local Draft or validated staged Pack exists.

### Embedded: Adaptive Studio

**Implemented baseline** for the M9 manual editorial/Personal Adaptation workflows and M10 guided Course Designer; **Approved Core Alpha target** for production Course authoring gates.

Adaptive Studio is 70% editorial workspace and 30% developer instrument. It is not an IDE and must not expose a general terminal.

Required flow:

1. **Enter explicit Draft / Open revision** — `/courses/new` owns assisted-path choice and minimal Draft metadata; `/courses/import` separately owns Pack file selection and intake. Guided confirmation first persists the approved brief to exactly one local Draft. Adaptive Studio opens only with that explicit Draft/revision ID and never substitutes the first available Course.
2. **Overview** — identity, lineage, locale, source/capsule inventory, revision history, requirements, and validation summary.
3. **Outline and graph** — structured finite activity outline with prerequisite/terminal visibility.
4. **Editor** — schema-driven fields for metadata, sources, capsules, activities, rubrics, protected material, environment/check references, and translations.
5. **Inspector** — exact stable ID, type contract, references, validation, evidence expectation, and provenance.
6. **Validate** — deterministically validate the current saved Draft, identify its content digest, and report exact node/field diagnostics.
7. **Preview** — render the exact validated Draft digest through a learner-safe projection in a selected Course locale and target viewport without publication; protected evaluation material is excluded, and later content changes make both validation and Preview stale.
8. **Review changes** — diff from parent/source, locale completeness, environment/capability requirements, provenance, and canonical hash inputs.
9. **Publish** — separate explicit confirmation that creates an immutable Course Revision.

Published revisions are read-only. Editing begins by cloning to a new Draft or creating a personal Adaptation Branch.

#### Guided Course Designer

**Implemented baseline** for the persisted M10 workflow against a selected local Draft; production Course content remains an **Approved Core Alpha target**.

Before enabling guided creation, Aptiloop reports the selected Course Designer role, connection, exact model, and available capability evidence. `connected` and `degraded` are eligible server states; AI Off and unavailable selections remain distinct, while missing/stale evidence is an honest advisory and the server remains authoritative for the attempted operation. Aptiloop does not automatically classify a model as weak or strong. If the connected model has limited context, search, or reasoning, the external instruction-file path and complete manual editor remain available. Provider failure preserves the Draft/brief and never silently selects another provider or Mock.

Confirming the guided brief creates the local Draft before any transmission. A provider response creates a reviewable proposal only: **Confirm compilation**, **Apply to Draft**, deterministic **Validate**, learner **Preview**, **Change review**, and immutable **Publish** are distinct operations.

Adaptive Studio exposes two equal-trust paths on the selected local Draft: the existing structured manual editor and the optional guided Course Designer. The guided path uses this restart-safe state machine:

| State                 | Required behavior                                                                                                                                                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DRAFT_REQUEST`       | Capture a natural-language goal, target outcome, current level, primary Course locale, time/pacing, tools, accessibility needs, and constraints for the selected local Draft. The UI locale remains independent.                            |
| `DISCOVERY`           | Resolve missing scope through bounded questions; propose candidate sources, skills, activity families, and runtime needs as assumptions for review. External-provider transmission requires the privacy preflight.                          |
| `DIAGNOSTIC`          | Offer optional bounded questions or practical tasks to calibrate prior knowledge. Skip is always available; diagnostic output is evidence for the proposal, not mastery.                                                                    |
| `CURRICULUM_PROPOSAL` | Show proposed Course structure, sequencing, prerequisites, Source Snapshot candidates, Knowledge Capsules, activity/evidence contracts, Node/Python needs, trusted check references, estimates, assumptions, and provider/model provenance. |
| `USER_REVIEW`         | Let the user edit structured fields, request a revision, reject, or explicitly confirm compilation. Confirmation is not Apply, Validate, or Publish.                                                                                        |
| `COMPILATION`         | Compile the confirmed proposal into the same strict typed Draft contract used by the manual Adaptive Studio editor. Proposal confirmation still does not mutate the Draft.                                                                  |
| `VALIDATION`          | Run Aptiloop's deterministic whole-Course validators. Errors return to the exact Draft field; model output never overrides a finding.                                                                                                       |
| `PUBLISHED`           | Enter only after the separate Preview, Change review, and explicit immutable Publish gate succeeds. The designer cannot transition here directly.                                                                                           |
| `FAILED`              | Preserve user input, prior safe state, operation identity, and exact failure layer; offer Retry, Back, switch provider where explicitly configured, or continue manually. Never select Mock silently.                                       |

Every transition is persisted with a bounded audit record and is idempotent on operation ID. Restart resumes the last committed state. A pending external transmission review is recoverable only for the exact Draft revision, workflow, authoring operation, provider/model selection, and disclosed payload scope. Expired, terminal, ambiguous, unknown, or cross-revision disclosures fail closed; a scope change requires a new review. Diagnostic answers, approved source material, provider responses, and proposal revisions remain distinct from deterministic learner Evidence. AI Off rejects optional proposal generation explicitly and leaves the complete structured manual path available.

### External: Course Pack

**Implemented baseline** for Course Pack V1.

An author may use any external text editor, build system, or generator to produce declarative Course Pack data. Those external tools are outside Aptiloop's trust boundary. Aptiloop imports only the resulting data through its own bounded parser and validators.

Required import flow:

1. Select one allowed UTF-8 Course Pack JSON file through an explicit user action.
2. Parse with byte, JSON nesting, collection, string, and parse-time limits; reject duplicate JSON keys.
3. Reject invalid encoding, unsupported schema versions, unknown fields/types, forbidden local/UNC/device/traversal path values, unsafe URLs, secrets, and command-like or executable content.
4. Validate schema, stable IDs, references, graph, locale resources, source/capsule hashes, protected material separation, environments, trusted checks, and compatibility.
5. Compute canonical content identity independent of JSON member order, insignificant serialization differences, or local absolute paths.
6. Stage one bounded, temporary validation result and navigate to `/courses/intake/{validationId}`. Its strict GET restores Preview or diagnostics without installing, publishing, or opening a Draft.
7. Present provenance, requirements, validation, canonical identity, and a learner-safe Preview. URL-backed confirmation state may survive Back, Forward, and reload only while that server-held validation remains available.
8. Explicitly confirm either immutable installation or Open as draft. Confirmation atomically claims the staged validation, so mixed or concurrent commit attempts have one winner and conflicting retries fail closed.
9. Open as draft preserves the imported manifest as an immutable archived source revision and creates a distinct personal Draft/adaptation lineage. It never makes the imported source editable in place.
10. Commit atomically; invalid, expired, unknown, already-claimed, or conflicting operations leave no partially runnable Course.

Embedded and external paths converge on the same Course Draft/Revision contract and validators. Neither path gets a privileged bypass.

Staged validation is intentionally process-local, size/count bounded, LRU-capped, and time-limited. If it expires or the orchestrator restarts, the user must reselect the original file; no Course mutation is reconstructed from browser state. Uninstall preserves history and fails closed while an active learning session pins the revision. A later Pack cannot silently change an existing Course's primary locale, overwrite an occupied personal branch, or replace source provenance.

#### Authoring Kit

**Implemented baseline** for the version-matched V1 kit.

Aptiloop provides a version-matched downloadable Course Pack V1 instruction for a capable external model or text editor without granting that tool access to Aptiloop. The instruction embeds the user-approved brief, exact generated schema, and exact generated development template, requires one UTF-8 Course Pack JSON document rather than prose or executable content, and directs the user back to `/courses/import`. It is not a runtime plugin, provider connection, or substitute for the complete Node-based Authoring Kit validator. Aptiloop cannot verify the external model's readiness or output quality; uploaded bytes remain untrusted until local validation succeeds. The full Kit contains:

- the exact Course Pack JSON Schema plus generated read-only type definitions;
- the closed catalog of allowed Activity types, payload schemas, evidence/completion contracts, limits, and examples;
- minimal and representative development-only templates/fixtures, clearly labeled as non-production content;
- the same deterministic local validator, canonicalizer, and hash implementation used by import, exposed by the `aptiloop-course-pack` binary and the repository commands shown below;
- validation-code reference, primary-locale, Source Snapshot/Knowledge Capsule, protected-material, environment/check-ID, provenance, privacy, and no-execution requirements;
- single-file JSON packaging, import, Preview, Install/Open-as-draft, and export instructions;
- explicit Kit/Core/schema compatibility rules, with unsupported combinations failing explicitly;
- guidance for external AI use: the user chooses and transmits only intended context, the AI returns declarative JSON, local validation remains authoritative, and no provider receives credentials, learner history, workspaces, or direct Aptiloop access by default.
- a model-facing instruction document that contains no credentials or learner history, requires one declarative JSON result, and names `/courses/import` as the only upload destination;

The Kit and Adaptive Studio must accept/reject the same canonical fixture corpus and produce identical validation codes and hashes. A Kit update cannot weaken an older schema silently. External generators may help author data, but they cannot validate as authority, install, publish, fetch sources through Aptiloop, or define new Activity/runtime/tool behavior.

Repository workflow after building `@aptiloop/course-authoring-kit`:

```sh
node packages/course-authoring-kit/dist/cli.js validate pack.json
node packages/course-authoring-kit/dist/cli.js hash pack.json
node packages/course-authoring-kit/dist/cli.js canonicalize pack.json
node packages/course-authoring-kit/dist/cli.js finalize pack.json
```

`validate` prints the stable report and exits non-zero on a blocker. `hash` prints the content hash over the canonical hash payload. `canonicalize` requires a valid finalized pack and prints canonical JSON. `finalize` computes/replaces the declared revision content hash and prints canonical JSON. The generated schema is `packages/course-authoring-kit/schema/course-pack-v1.schema.json`; the non-production template is `packages/course-authoring-kit/templates/development-course-pack.json`. Aptiloop imports one finalized JSON file through Courses → Import Course Pack, shows Preview and diagnostics, then requires a separate Install/Open-as-draft action.

Reference external workflow:

1. From Course creation, choose **Use an external model** and download the version-matched instruction file.
2. Give the chosen external model only the goal, context, and constraints the user intends to disclose; Aptiloop sends nothing automatically.
3. Receive one UTF-8 Course Pack JSON document.
4. Open `/courses/import` and select that exact file. No Pack file input exists on `/courses/new`.
5. Run bounded local validation and fix every error; no imported field receives executable or provider authority.
6. Review provenance, requirements, canonical identity, and learner Preview.
7. Explicitly choose **Install immutable revision** or **Open as local draft**. Installation records the immutable source revision; Open as draft preserves that source manifest and creates a separate editable personal lineage. Neither action publishes the Draft.

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

**Implemented baseline**

External Course Pack runtime references and the finite M5 local registry are implemented for development content.

**Approved Core Alpha target**

Production Course runtime approval and distribution remain separately gated.

Course authoring selects declarative environment requirements and trusted IDs. It never authors commands.

Core Alpha supports contracts for:

- **Node** — compatible runtime range, package-manager policy, trusted installed template/dependency identity, and registered check IDs;
- **Python** — compatible runtime range, environment/dependency policy, trusted installed template identity, and registered check IDs.

Execution Fabric resolves references only from an app-owned trusted registry. Each check defines the executable/arguments/working-directory rule, environment allowlist, timeout, output cap, cancellation, cleanup, and result parser outside the Course Pack. The browser and model supply only operation/entity/check IDs permitted by the activity.

A pack with an unknown or incompatible environment/check ID may be inspected but cannot be installed as runnable content until the requirement is satisfied explicitly.

## Optional AI proposals

**Implemented baseline** for M10 Draft proposals; production source acquisition and Course approval remain an **Approved Core Alpha target**.

Course Designer may use Pi runtime through narrowly scoped Aptiloop typed tools such as proposing metadata, capsule text, activity fields, graph edges, or translations. Tool inputs/outputs are strict, bounded, and validated.

Every proposal shows:

- provider and model;
- destination Draft and target stable IDs;
- data categories sent externally;
- before and after values;
- sources/provenance used;
- validation changes and unresolved warnings;
- Apply and Reject actions.

AI has no filesystem, shell, network, credential, general edit, install, environment, Preview, or publish tool. A response is a proposal, not Draft truth. **Apply** mutates only the selected Draft fields after validation; deterministic **Validate**, digest-bound learner **Preview**, **Change review**, and explicit immutable **Publish** remain separate later gates. Provider failure is explicit, preserves the local Draft/brief, and never triggers Mock fallback.

## Validation

**Implemented baseline**

Course Pack V1 validation/install, M9 Adaptive Studio manual validation/publication, and M10 deterministic validation after an explicitly applied AI proposal are implemented for development content.

**Approved Core Alpha target**

Production Course approval remains separately gated.

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

**Implemented baseline**

External Pack Install/Export, M9 Adaptive Studio manual Publish/clone/personal integration, and M10's separate manual Publish after proposal Apply are implemented for development content.

**Approved Core Alpha target**

Production publication gates remain separately gated.

- **Publish** converts a local Draft into an immutable revision after Validate, Preview, change review, and explicit confirmation.
- **Install** atomically records a validated external immutable revision after Preview and explicit confirmation.
- **Export** serializes explicitly selected Course content and declares included locales/sources/protected material. It excludes credentials, provider sessions, UI settings, learner evidence, mastery, transcripts, workspaces, absolute paths, and unrelated adaptations.
- Re-export does not erase or fabricate provenance and licensing fields.
- Content hash and revision identity are shown before irreversible publication/installation.

## Privacy, provenance, and licensing

Course material, Source Snapshots, Capsules, Drafts, protected answers, and personal adaptations remain local by default. External provider authoring is an explicit disclosure action. Import never initiates network access by itself.

Authors record origin, authorship/ownership claim, license/terms claim, acquisition date, and transformation notes for source/content resources. Aptiloop validates presence and consistency; it does not certify that a claim is legally correct.

**Approved Core Alpha target**

Project licensing uses the owner-approved engineering direction of AGPL-3.0-only for the integrated app/server and Apache-2.0 only for newly separated reusable SDK packages after boundaries/ownership are verified. Content/fixtures require separate terms, and third-party notices/SBOM/trademark policy require professional legal review. No license text or production Course is authorized by this target alone.

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
