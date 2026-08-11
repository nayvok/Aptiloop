# Adaptive Studio Specification

## Status and intent

This document owns the authoring workspace after an explicit Draft or revision exists. Course creation and Pack intake remain owned by [`information-architecture.md`](information-architecture.md); renderer Preview behavior remains owned by [`activity-renderers.md`](activity-renderers.md).

- **Implemented baseline** — current repository evidence.
- **Approved Core Alpha target** — required Studio contract.
- **Proposed pending owner approval** — an unresolved recommendation.
- **Future** — outside Core Alpha.

Calm Workshop — Clear Slate is the approved direction name, not a separate status label.

Adaptive Studio is approximately **70% editorial workspace and 30% developer instrument**. Authors primarily shape a learning experience; stable IDs, schemas, dependencies, environments, validation, hashes, and diffs remain available as contextual instruments. Studio must not become a full IDE, generic CMS card grid, or chat interface.

## Baseline audit

**Implemented baseline**

The current Studio is revision-scoped and exposes URL-backed **Program**, **Designer**, **Preview**, **Release**, and **History** destinations. It preserves typed Draft editing, immutable published history, clone-to-draft, deterministic validation, learner-safe Preview, change review, explicit Publish, personal adaptation lineage, and a persisted optional Course Designer workflow. The Designer runs against the selected Draft, returns a reviewable proposal, and cannot publish.

Current implementation evidence does not turn every target authoring field or mobile operation into a completed capability. Sections below retain **Approved Core Alpha target** where additional authoring breadth or formal acceptance remains required.

## Studio principles

**Approved Core Alpha target**

1. **Course first.** Adaptive Studio operates on a local Course Draft or immutable Course revision. `/courses/new` creates the minimal Draft transaction before opening Studio; cancel before that transaction leaves no Draft. A Course contains immutable revisions plus the single user's private adaptation branch.
2. **Manual path complete.** Every authoring, validation, preview, and publication task works without AI.
3. **Declarative only.** A Course Pack contains data and references, never commands, scripts, secrets, executable plugins, or arbitrary tool definitions.
4. **Finite graph.** Activities and prerequisites form a finite, validated graph. The author edits nodes and declared edges, not runtime state.
5. **Immutable release.** Published revisions are read-only. Editing starts by cloning to a new draft revision.
6. **Separate gates.** AI Apply modifies a draft only. Validate, Preview, Change review, and immutable Publish are separate actions.
7. **Stable provenance.** Source Snapshots, Knowledge Capsules, locale variants, environment requirements, and check IDs remain attributable across revisions.
8. **No production courses.** Core Alpha exercises the format and workflow with fixtures only; the product must not imply a production catalog.
9. **Local-first privacy.** Packs, drafts, previews, validation reports, and learner data remain local. Any external model request presents its exact content scope before transmission.
10. **Incremental migration.** Preserve current revision and CRUD seams while moving one authoring surface at a time; do not big-bang rewrite the domain.

## Studio information model

**Approved Core Alpha target**

The outline follows this hierarchy:

- Course
  - Course Revision
    - Course metadata and locale contract
    - Release requirements
    - Source Snapshots
    - Knowledge Capsules
    - Environment Contracts
    - Lessons
      - finite Activity nodes
      - prerequisite edges
      - completion criteria
      - evidence contracts
      - check references by trusted check ID

The personal adaptation branch references its source Course Revision, records changed nodes, and is distinct from the immutable source. Published and source-referenced entities are never silently edited in place.

### Course Pack facts shown to the author

- Pack schema version
- Course stable ID and revision ID/version
- source revision/parent lineage
- immutable content hash after publication
- primary course locale, declared locales, and fallback rules
- course title, summary, audience, prerequisites, outcomes, duration
- lesson and activity counts
- Source Snapshot and Knowledge Capsule counts
- Node and Python environment contract IDs and supported versions
- trusted Execution Fabric check IDs referenced by activities
- optional Aptiloop AI tool capabilities
- validation errors and warnings
- provenance, authorship, license/content terms when declared

Secrets, environment variable values, provider credentials, arbitrary filesystem paths, shell commands, and plugin payloads are never Pack facts.

## Studio shell and modes

### Entry boundary

**Implemented baseline**

Direction: Calm Workshop — Clear Slate.

Studio never owns the uncommitted creation chooser or Pack bytes. `/courses/new` exposes two unselected assisted starts—**Use an external model** and **Use the connected Course Designer**—plus **Create manually without AI**. External instruction download creates no Draft. Guided/manual confirmation creates exactly one explicit Draft and opens Studio with its revision ID. `/courses/import` and `/courses/intake/{operationId}` alone own file selection, validation, Preview, and install-or-draft confirmation.

Studio requires an exact `version` URL value. Optional `mode` records manual/designer creation context; the separate `tab` parameter selects Program, Designer, Preview, Release, or History. Missing/invalid revision authority returns safely to Courses, while invalid tab state falls back to the mode-appropriate workspace. Studio never substitutes the first, current, or most recently viewed revision.

### Desktop

**Implemented baseline**

Direction: Calm Workshop — Clear Slate.

Desktop uses the shared shell, entity breadcrumb, PageHeader, exact Course/revision context, and one contained horizontal tab track for **Program**, **Designer**, **Preview**, **Release**, and **History**. The selected tab is URL-backed. Program uses structured Week/Day/Activity forms and disclosures; Preview uses the learner-safe hierarchy; Designer, Release, and History remain distinct surfaces rather than nested sidebars. Technical IDs, hashes, diagnostics, and proposal provenance use `surface-soft` wells without turning Studio into an IDE.

### Mobile

**Implemented baseline**

Mobile keeps the same five Studio destinations in a contained horizontal tab track. Forms, disclosures, proposal review, Preview, validation, and history stack into one reading column; exact version/tab state and retained draft data survive route changes and reload.

The implemented mobile composition supports:

- opening a Course/revision;
- inspecting revision metadata and validation;
- editing simple text, enum, boolean, number, list, source, and locale fields;
- adding/reordering within a small ordered list using accessible Move up/Move down controls;
- reviewing one activity and its dependencies;
- learner preview at mobile width;
- reviewing, applying, or rejecting one validated typed proposal to a Draft;
- cloning a published revision to draft.

**Approved Core Alpha target**

The following actions require explicit desktop-only enforcement and a state-preserving handoff; that enforcement is not claimed as an implemented baseline:

- freeform graph manipulation;
- bulk reorder across lessons;
- raw JSON editing;
- complex import conflict resolution;
- environment contract creation;
- wide structured diff review;
- export packaging;
- immutable publication.

Those actions must explain “Available on desktop” and preserve the Draft. They must not remain visible as a failing mobile control.

### Light and dark

**Implemented baseline**

Direction: Calm Workshop — Clear Slate.

Light Studio uses the near-white cool-neutral foundation, `surface-soft` for quiet technical wells, and restrained evergreen for primary action, progress, success, and focus. Dark Studio uses low-chroma graphite background/surface/raised levels. Selection combines surface, marker, text, and semantics; validation colors never replace labels or icons. No neon code palette, glow, glass, simulated terminal, or dense IDE menu bar.

## Required screens and flows

### 1. Studio entry and revision context

**Approved Core Alpha target**

Entry: a guided/manual creation confirmation, explicit Course revision action, clone, or completed **Open as local Draft** result opens `/courses/studio` with exact version/mode authority. Studio never substitutes the current or first revision. The shell breadcrumb and Studio header identify Course, revision/version, locale, Draft/Published/Archived state, personal/source branch, and save state. Actions appear only in their owning tabs.

Main overview sections:

1. Course/revision identity and provenance.
2. Draft/source/release lineage.
3. Locale coverage.
4. Outline summary and graph validity.
5. Source Snapshot and Knowledge Capsule summary.
6. Environment and trusted check requirements.
7. Validation summary.
8. Release history.

Published revisions are read-only and offer “Clone to new draft.” A personal adaptation draft is visibly separate from source authoring.

Required states: no draft, draft, published, archived, unsaved local edits, save pending, save failure, validation never run, validation stale, missing locale, missing source, missing environment, and read-only source.

### 2. Creation and intake handoff

**Implemented baseline**

Course creation and intake are specified in [`information-architecture.md`](information-architecture.md#create-course) and [`../product/course-authoring.md`](../product/course-authoring.md). Studio receives only an explicit local Draft/revision result. Clone creates a new Draft with parent lineage; install opens immutable Course context; **Open as local Draft** creates the separate personal Draft before Studio opens. No file picker, staged bytes, validation operation, or install confirmation belongs inside Studio.

### 3. Guided Course Designer flow

**Implemented baseline**

The guided entry is a structured workflow, not generic chat. Guided creation has already created the explicit local Draft before Studio opens. The persisted workflow and its pending external-disclosure operation are scoped to that exact revision and recover after reload. The proposal screen shows goal/outcome/level/constraints, assumptions, sources/capsules, finite sequence and prerequisites, activity/evidence types, runtime/check requirements, estimates, provider/model, and disclosed data.

`USER_REVIEW` supports structured edits, **Request revision**, **Reject**, and **Confirm compilation**. Compilation produces a proposal; it does not create, mutate, preview, or publish the Draft. A separate **Apply to Draft** validates and applies only selected typed changes. Deterministic **Validate**, digest-bound learner **Preview**, **Changes**, and immutable **Publish** are later independent gates. AI Off keeps the manual Program editor complete, and `FAILED` preserves input and the prior safe state.

Required states: initial, saving request, discovery awaiting answer, diagnostic offered/in progress/skipped, proposal loading/ready/revising, confirmation pending, compilation, validation blocked, provider unavailable, browser offline, Core/storage unavailable, cancellation with the existing Draft unchanged, resumable after restart, and failed with retained input.

### 4. Course metadata editor

**Approved Core Alpha target**

Typed fields replace raw JSON for:

- stable Course ID (read-only after creation), revision/version, and parent lineage;
- title, short summary, full description;
- audience, prerequisites, learning outcomes;
- primary locale, declared locales, and fallback behavior;
- estimated duration and release notes;
- provenance, authorship, and content/license terms;
- optional AI capability declarations at the Aptiloop tool level.

Each localized field shows locale, fallback, missing state, and source. Changing a stable identity has a dedicated migration affordance or is prohibited; it is never an ordinary text edit.

### 5. Outline and finite graph

**Approved Core Alpha target**

The default outline is a compact hierarchical list with Course → lessons → activities. Each row contains type icon/label, title, stable ID on disclosure, required/optional, estimated time, prerequisite status, locale completion, validation count, and Draft/Published inheritance.

Author actions:

- add/duplicate/delete a draft lesson or activity;
- move within allowed order with keyboard-accessible controls;
- edit prerequisite edges using a searchable node picker;
- switch to a finite graph view for dependency inspection on desktop;
- select a validation finding and focus its node;
- inspect unreachable, cyclic, orphaned, or ambiguous-next-action findings.

The graph is not a general canvas. Nodes use a bounded layout, provide a synchronized accessible outline, and never require pointer-only edge drawing. Deletion previews downstream dependency impact and requires confirmation when consequential.

### 6. Structured activity editor

**Approved Core Alpha target**

All activities share:

- title, description/instruction, type, required/optional, estimate;
- prerequisite node IDs;
- completion criteria owned by supported schemas;
- evidence contract;
- sources/capsules;
- locale variants;
- environment and trusted check references where allowed;
- learner-preview examples that contain no protected answer leakage.

Activity-specific controls follow [`activity-renderers.md`](activity-renderers.md). Structured repeaters, choice editors, criteria builders, source pickers, environment selectors, and check-ID selectors replace raw JSON. An Advanced JSON view may be **Future**, is desktop-only, schema-validated, and never the primary editor.

Protected answers/evaluation material use a clearly marked author-only region and never appear in learner preview or learner DTO inspection.

### 7. Source Snapshots

**Approved Core Alpha target**

A Source Snapshot editor records stable ID, title, source kind, origin URL/reference, captured version/date, locale, attribution/terms, goals, excerpt/summary, integrity identifier where defined, and which Knowledge Capsules or activities consume it.

The screen distinguishes:

- locally available snapshot;
- reference only;
- missing/unresolved;
- changed origin with unchanged snapshot;
- orphaned snapshot;
- attribution/terms missing.

Opening an external source is an explicit user action. Validation does not silently fetch or refresh a source. Private local source content is not sent to an AI provider without explicit scoped approval.

### 8. Knowledge Capsules

**Approved Core Alpha target**

A Knowledge Capsule is an authored, bounded learning object linked to Source Snapshots. Editor fields include stable ID, title, primary/fallback locale content, learning goals, concepts, examples, misconceptions, source links, and consuming activities. The editor previews authored content using the same typography and source context as the lesson renderer.

Validation catches missing source linkage, missing locale, orphaned capsule, unsupported content block, protected material in learner-visible fields, and oversized content according to schema. Capsules do not embed commands or tools.

### 9. Locale coverage

**Approved Core Alpha target**

Locale view is a matrix/list by Course, lesson, activity, source/capsule, and required field. It shows Complete, Fallback, Missing, and Not localized. Selecting an issue opens the exact field.

Rules:

- one primary course locale is required;
- UI `en-US`/`ru-RU` is independent of course locales;
- preview locale is explicit;
- fallback content is visibly labeled in preview;
- publishing criteria declare whether warnings for fallback are allowed;
- no automatic model translation is applied without typed proposal review.

On mobile the matrix becomes a filterable issue list. There is no wide-grid-only workflow.

### 10. Environment contracts and trusted checks

**Approved Core Alpha target**

Studio references app-owned environment contracts:

- Node environment ID, supported version/range, package-manager policy, entry fixture/reference, and allowed trusted checks;
- Python environment ID, supported version/range, dependency policy, entry fixture/reference, and allowed trusted checks.

Activities reference trusted **check IDs**, not commands. The author may select from Execution Fabric checks already registered by Aptiloop and inspect their human-readable purpose, input/output contract, timeout, and evidence type. A Course Pack cannot define shell text, executable paths, environment secrets, or networking policy.

Missing/unavailable local environments appear in preview as capability findings. They may block release when declared required, but Studio never attempts an install or executes a Pack-defined setup script.

### 11. Learner preview

**Approved Core Alpha target**

Preview renders the selected Course locale, breakpoint (desktop/mobile), light/dark theme, and capability profile (full local, no AI, missing optional editor, missing required runtime) using the same ActivityFrame contract as learning.

Preview is clearly labeled and isolated from learner state:

- it does not create sessions, evidence, mastery, mistakes, cards, reviews, or provider conversations;
- it does not execute checks or call an AI provider by default;
- protected author-only material is excluded;
- kernel transitions are simulated only as labeled preview controls and cannot be confused with saved progress.

Preview navigation shows the finite graph and locked/unlocked explanation. Authors can jump to validation findings without pretending prerequisites were satisfied.

### 12. Validation center

**Approved Core Alpha target**

Validation is deterministic, versioned, and separated into layers:

1. schema and format;
2. identity and immutable lineage;
3. locale completeness/fallback;
4. finite graph and deterministic next action;
5. activity payload/completion/evidence contracts;
6. protected-content boundary;
7. Source Snapshot/Knowledge Capsule references;
8. environment contracts and trusted check IDs;
9. declarative safety boundary;
10. release metadata/provenance.

Every finding has stable rule ID, severity, node/path, field, message, and fix guidance. The center provides filters and “Next finding.” Selecting a finding moves focus to the editor field and announces the context. Errors block publish. Warnings require review and may require explicit acknowledgement according to release policy. Validation hash and time are shown; any draft change marks results stale.

Validation loading, cancelled, Core unavailable, storage error, validator-version mismatch, and stale-result states are distinct. A toast is not the validation center.

### 13. Typed AI proposal inspector

**Approved Core Alpha target**

AI is optional and never the primary editor. Pi runs behind Aptiloop-owned typed tools. Studio never exposes arbitrary filesystem, shell, network, write/edit, coding-agent, or plugin tools.

**Approved Core Alpha target**

The typed-tool boundary is informed by [pinned upstream Pi evidence](../architecture/pi-runtime.md), not Aptiloop implementation evidence: the published `v0.84.1` tag is commit [`53fa77ccd8a279eb87e92294ef3687b03ff80112`](https://github.com/earendil-works/pi/tree/53fa77ccd8a279eb87e92294ef3687b03ff80112); separately inspected post-release commit [`9dd90a49711d088b86fdd9b4aea575913a8328`](https://github.com/earendil-works/pi/tree/9dd90a49711d088b86fdd9b4aea575913a8328) contains additional typed-tool/provider-model and message-steering infrastructure but does not change the pinned implementation boundary.

A proposal contains:

- Aptiloop tool and role name;
- provider/model provenance on disclosure;
- exact target Course/revision and stable node IDs;
- source context included in the request;
- structured proposed operations within the schema;
- before/after field diff;
- local validation result and unresolved findings;
- private-data transmission scope and consent state;
- Apply and Reject.

Proposal sequence:

1. author explicitly invokes a typed task;
2. Studio shows the material that would leave the machine when an external provider is selected;
3. author confirms transmission where private data is included;
4. provider/auth resolution is explicit; failure remains explicit;
5. response is schema-validated by Aptiloop;
6. invalid output is rejected as an error, not coerced into content;
7. proposal is displayed without changing the draft;
8. Apply modifies only named draft fields in one reviewable operation;
9. resulting draft is revalidated and remains unpublished;
10. Reject stores no content change.

AI Off collapses the proposal region. Provider unavailable offers Retry, choose another explicitly configured provider/tool, or continue manually. It never silently selects Mock. Reviewer remains read-only and cannot generate a patch/apply operation.

### 14. Change review

**Approved Core Alpha target**

Before publish, Change review compares the draft to its parent/source:

- changed, added, removed lessons/activities;
- prerequisite and ordering changes;
- locale changes and fallback impact;
- source/capsule changes;
- environment/check requirement changes;
- protected evaluation changes;
- AI-applied operations labeled by proposal provenance;
- unresolved warnings and acknowledgements.

The default is an editorial grouped diff, not a source-code diff. Technical identifiers and normalized JSON are secondary disclosures. Removed nodes show downstream and learner-progress migration impact when applicable.

### 15. Publish gate

**Approved Core Alpha target**

Publish is a dedicated screen and is desktop-only in Core Alpha. It requires:

- draft saved locally;
- current deterministic validation with zero errors;
- learner Preview completed and reviewed for the exact saved Draft digest covered by the current validation result;
- locale/release policy satisfied;
- finite graph valid;
- all required sources/capsules resolved;
- environment/check references valid;
- Change review completed for that same validated and previewed Draft digest;
- version/release notes entered;
- immutable consequence acknowledged;
- exact Course/revision/parent and resulting hash/version summary;
- explicit Publish action.

Any content or release-relevant metadata change invalidates validation, Preview, and Change review together; Publish remains blocked until all three are current again.

Apply Proposal, Validate, Preview, and Publish never share one confirmation or primary button. AI cannot publish. A validation pass is not design approval, and owner design approval is not Course publication approval.

Publish failure preserves the draft and shows whether the operation failed before or after immutable revision creation. The UI must not invite repeated submission until final state is read back safely.

### 16. Release history and clone

**Approved Core Alpha target**

History is a chronological ruled list showing version, immutable hash, parent, date, locale coverage, author/provenance, validation version, release notes, and active/archived state. Selecting a revision opens read-only overview and change comparison.

“Clone to new draft” names parent lineage and creates a personal/source draft according to the chosen branch. Published revisions are never unlocked. Archive affects selection/status, not historical deletion.

### Personal adaptation and upstream integration

**Approved Core Alpha target**

The adaptation workspace follows **Adaptation overview → Create branch → Edit within invariants → Divergence/impact validation → Change review → Publish personal revision**. Overview names the immutable source revision/hash, current personal revision, allowed change categories, historical-evidence boundary, and future-state impact. Creating a branch never unlocks or copies writes into the source revision.

When a newer upstream revision is installed, a separate integration screen compares old/new source and the personal branch, classifies clean changes and conflicts, previews future graph/evidence impact, validates the proposed result, and offers explicit **Merge/Rebase into new personal Draft** or **Cancel**. It never auto-merges, mutates either published revision, or rewrites historical evidence. Publish remains the ordinary desktop-only personal revision gate.

Desktop uses source/personal comparison, editorial diff, conflict list, Preview, and inspector. Mobile supports overview, conflict inspection, simple field resolution, and Preview; wide conflict resolution and Publish say **Available on desktop** while preserving state.

Required states: no branch, branch current, Draft saved/saving/failed, upstream available, comparison loading, clean integration, conflict, validation blocked, stale source/hash, merge failure, publish uncertain, and completed personal revision.

### 17. Export

**Approved Core Alpha target**

Export is desktop-only and serializes a selected immutable revision or explicit Draft snapshot as one Course Pack V1 JSON document. Before writing, Adaptive Studio shows:

- Course/revision/hash;
- included declarative fields and bounded content;
- locales, sources/capsules, environments, and check references;
- explicit exclusions: credentials, provider sessions, learner data, attempts, private paths, runtime processes, commands/scripts/plugins;
- target local JSON file name/path and overwrite policy;
- validation status and Draft warning when applicable.

Export never silently shares externally. Errors preserve the local target choice and report path/permission/serialization/checksum stage without exposing secrets.

## Authoring state matrix

**Approved Core Alpha target**

| State                   | Studio response                                                                                                                              |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Loading Course/revision | Keep shell and selected Course context; skeleton outline/editor separately.                                                                  |
| Empty Course            | Guided metadata → first lesson → first activity sequence; no empty card grid.                                                                |
| Draft saved             | Quiet “Saved locally” with timestamp on disclosure.                                                                                          |
| Draft saving            | `aria-live` polite once; prevent conflicting publish, not ordinary reading.                                                                  |
| Save failed             | Inline persistent banner plus affected field/operation; retain local edit buffer.                                                            |
| Browser offline         | Allow safe local editing only if durable local save is guaranteed; otherwise read-only with copy/export-draft recovery. Do not promise sync. |
| Core unavailable        | Preserve editor buffer; disable server-owned validation/publish; route to Core settings.                                                     |
| Storage unavailable     | Disable mutations; show SQLite/storage reason and non-destructive recovery.                                                                  |
| AI off                  | Manual editor complete; proposal rail absent/quiet.                                                                                          |
| AI unavailable          | Existing proposal/draft retained; explicit Retry/switch/manual.                                                                              |
| Runtime missing         | Preview capability finding; exact Node/Python/editor contract and settings link.                                                             |
| Validation errors       | Count by severity; focus exact node/field; Publish disabled.                                                                                 |
| Validation stale        | Keep prior report visibly stale; require rerun before Publish.                                                                               |
| Published/read-only     | Disable edit controls; offer Compare and Clone.                                                                                              |
| Import invalid          | Keep outside library; structured findings; no “force import.”                                                                                |
| Pack incompatible       | Name supported schema range; no auto-conversion claim.                                                                                       |
| Proposal invalid        | Show typed-output validation failure; do not partially apply.                                                                                |
| Guided workflow failed  | Keep the last safe state and all user input; name provider/auth/storage/compilation/validation layer; retry, back, or continue manually.     |
| Adaptation conflict     | Preserve source and personal revisions; show explicit conflict/invariant findings; never auto-merge or rewrite history.                      |
| Publish uncertain       | Lock duplicate submit; read back revision state; preserve draft until confirmed.                                                             |

## Accessibility requirements

**Approved Core Alpha target**

- Outline and graph share one logical node model; every graph action has a list/form equivalent.
- Drag is never the only reorder method. Move before/after/up/down actions are keyboard and touch accessible.
- Three-region desktop layout has landmarks and direct skip links to Outline, Editor/Preview, Inspector, and Validation.
- Selecting a validation finding moves focus predictably and announces node, field, and error.
- Save/validation/proposal status uses restrained live regions; streaming output is not announced token by token.
- Structured diffs expose operation, field, old value, and new value in reading order; color is supplementary.
- Published/read-only and draft/editable states are conveyed in heading/status text and programmatic state.
- Touch targets, zoom, reflow, contrast, focus appearance, error identification, and accessible authentication follow [`accessibility.md`](accessibility.md).

## Explicit non-goals

**Future**

- Multi-user collaborative editing, comments, roles, remote sync, and conflict-free shared cursors.
- Course marketplace or production Course content.
- Arbitrary plugins, Pack-defined commands, package installation, shell, terminal, filesystem browser, or full code editor.
- Generic prompt/chat authoring as the main workflow.
- AI automatic translation, automatic Apply, automatic validation override, or automatic Publish.
- Durable Pi AgentHarness v2 driving based on unimplemented hooks or restore behavior.
- Transparent use of Pi SQLite session backend as coding-agent session storage.

## Studio acceptance gate

**Approved Core Alpha target**

Adaptive Studio meets this specification only after owner-approved implementation evidence demonstrates every screen and flow above on desktop and the defined mobile subset, in light/dark and `en-US`/`ru-RU`; proves the guided Course Designer state machine and failure recovery; verifies manual no-AI authoring and Authoring Kit schema/validator/hash parity; rejects unsafe Pack content without execution; preserves immutable source and personal-adaptation lineage through explicit upstream integration; uses typed Aptiloop tools and explicit provider failure; keeps Reviewer read-only; uses trusted check IDs rather than Pack commands; and separates Apply/Compile, Validate, Preview, Change review, and Publish. Until then, this document remains a target specification.
