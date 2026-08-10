# User Journeys

## Document status

**Approved Core Alpha target**. These are required product journeys for later implementation. The current Dev Learning Harness covers parts of the learning loop but does not implement these journeys end to end.

## Actors

Core Alpha has one human actor: the local learner-author. The same person may install a Course, author or adapt it, complete learning activities, review evidence, and configure optional providers.

Aptiloop application roles are bounded collaborators, not additional users:

- **Course Designer** — proposes structured draft changes through typed tools.
- **Tutor** — provides bounded teaching dialogue and hints.
- **Evaluator** — produces validated observations for evidence paths that explicitly accept them.
- **Reviewer** — analyzes supplied task context, complete diff, and trusted check evidence; read-only and no patches.

Every role is optional where a manual path is defined. Pi supplies model/runtime capability only; Aptiloop owns role semantics, permissions, tools, storage, and truth.

## Journey 1: first local launch

**Approved Core Alpha target**

1. The user launches Aptiloop locally without creating an account.
2. Home reports independent readiness for Aptiloop Core, SQLite, filesystem/workspace root, configured Node/Python environments, external editor, and optional AI providers.
3. A Core/storage/filesystem problem blocks the affected action and provides local recovery guidance.
4. An optional AI problem does not masquerade as a Core failure. The user can continue through a complete manual path.
5. With no saved UI locale, the user explicitly confirms `en-US` or `ru-RU`; the picker is prefilled from a supported browser/OS locale and otherwise defaults to `en-US`. This does not select or prefill a Course locale.
6. With no installed Course, the primary action is to create one manually or import a Course Pack.

Privacy result: no account, telemetry, upload, provider request, or sharing action occurs during launch.

## Journey 2: create a Course in Adaptive Studio

**Approved Core Alpha target**

1. From Home empty state or Courses, the user chooses **Create Course** at `/courses/new`.
2. The user chooses **Create manually** or **Describe a learning goal**. Both produce the same local Draft contract; AI Off keeps the manual path complete.
3. In guided mode, the user provides a natural-language goal, target outcome, current level, primary Course locale, time/pacing, tools, accessibility needs, and constraints. The UI locale remains independent.
4. Course Designer asks bounded discovery questions and may offer an optional diagnostic through questions or a practical task. Skip remains available. Before any external provider receives content, the transmission review names provider/model, destination, payload categories, selected entities, exclusions, and retention disclosure.
5. The curriculum proposal shows finite structure and sequencing, prerequisites, sources, capsules, activity/evidence types, Node/Python requirements, trusted check references, estimates, assumptions, and provider/model provenance.
6. The user edits fields, requests revision, rejects, or explicitly confirms compilation. Confirmation creates only a local Draft and cannot publish.
7. Manual or compiled Draft editing uses typed fields for identity, one primary locale, Sources, Capsules, finite activities, protected material, evidence/completion rules, and trusted environment/check references.
8. Adaptive Studio preserves state through `DRAFT_REQUEST → DISCOVERY → DIAGNOSTIC → CURRICULUM_PROPOSAL → USER_REVIEW → COMPILATION → VALIDATION`; `FAILED` retains input and offers explicit recovery.
9. Validate checks the whole Course with the same rules used by the Authoring Kit and external import. Preview renders the learner experience. Change review shows changes, locales, runtime requirements, revision, hash, and proposal provenance.
10. The user separately confirms immutable Publish. Only that action enters `PUBLISHED`; the resulting Course Revision is read-only.

Recovery:

- Closing and reopening Studio resumes the local draft.
- Validation errors focus the exact node and field.
- AI unavailable leaves all manual controls working.
- Publishing is blocked on errors, unknown activity/environment/check types, graph violations, missing primary-locale content, or unresolved protected material.

## Journey 3: import an externally authored Course Pack

**Approved Core Alpha target**

1. The user authors or obtains one declarative Course Pack JSON document outside Aptiloop using the version-matched Authoring Kit with a text editor or generator.
2. The Kit provides the exact schema and allowed Activity types, examples, local validator/canonicalizer, compatibility rules, single-file packaging requirements, and Aptiloop import instructions. An external AI sees only context the user deliberately sends and receives no direct Aptiloop authority.
3. From Courses, the user chooses **Import Course Pack** and selects the exact UTF-8 JSON file.
4. Aptiloop treats every field as untrusted data. It reads no commands and grants no runtime, filesystem, network, plugin, or provider authority from the pack.
5. Validation reports schema version, stable IDs, reference integrity, finite graph result, locale coverage, source/capsule hashes, environment/check references, limits, provenance, compatibility, and canonical hash. Authoring Kit and importer results must match.
6. Unknown or unsupported definitions fail closed. The user may inspect errors without partially installing runnable content.
7. A valid pack opens in learner Preview. The user sees publisher/provenance claims as claims, not automatic trust proof.
8. The user explicitly chooses **Install immutable revision** or **Open as local draft**, reviews the identity/hash/destination consequence, and commits atomically. Opening as a draft creates a separate editable lineage.

Privacy result: import is local. The pack cannot read existing Courses, learner history, credentials, paths, or provider sessions.

## Journey 4: start or resume learning

**Approved Core Alpha target**

1. Home shows the active Course and one deterministic next action.
2. The user chooses **Continue**. The Learning Kernel selects a ready activity from the finite graph based on persisted state and prerequisites.
3. The activity frame shows objective, expected effort, evidence requirement, source/capsule context, availability of hints/AI, and why the activity is ready.
4. The user responds before seeing protected feedback or a strong hint. First-attempt evidence is immutable.
5. The application records typed evidence and calculates the next state deterministically.
6. On completion, the user receives the next meaningful activity rather than a dashboard of unrelated subsystem routes.
7. After restart, the same Course Revision, graph context, activity state, and first attempt resume.

Honesty rules:

- completion is not mastery;
- model commentary is identified as model commentary;
- answer shape or length is not technical correctness;
- missing evidence remains a gap;
- current interview-style observations do not affect mastery unless an approved technical-evaluation contract produces valid evidence.

## Journey 5: practical task, trusted check, and review correction

**Approved Core Alpha target**

1. A ready practice activity asks the server to create an isolated learner-owned workspace from a trusted installed environment/template definition.
2. The Activity contract selects `embedded`, `external`, or `either`. A small bounded text/code task (typically one to three declared documents) may use Aptiloop's typed embedded editor; a larger multi-file project uses a configured external editor or path-copy/manual-open handoff. The browser never supplies an executable, arguments, working directory, or undeclared path.
3. The user edits independently. The embedded editor is not a terminal, package manager, filesystem browser, or AI agent and can read/write only declared logical documents through optimistic generation/hash checks.
4. Aptiloop displays the current complete diff and lets the user select only a trusted check ID declared by the activity/environment contract.
5. Execution Fabric resolves that ID to an app-owned fixed process plan, runs with `shell: false`, minimal environment, bounds, cancellation, and cleanup, and records result/fingerprint evidence.
6. Review is available only for a non-empty complete current diff and a matching, fresh passed check when required by the activity.
7. Reviewer receives bounded instructions, relevant capsule/task context, the complete diff, and check evidence. Reviewer has no write/edit/apply tools and no patch route.
8. If Reviewer requests changes, the activity remains incomplete.
9. The user edits again, runs a new trusted check, and requests a new review bound to the new fingerprint.
10. An approved review records evidence; it never modifies the workspace.

Recovery:

- stale, mismatched, or truncated diff evidence fails closed;
- cancellation terminates the process tree and leaves a clear state;
- missing Node/Python runtime identifies the exact environment requirement;
- missing external editor retains the workspace and offers path copy/manual open or the declared embedded alternative, never an IDE fallback for a full project;
- on mobile, small declared embedded tasks may proceed when their renderer is supported; full-project coding offers criteria, safe resume, path copy/registered handoff where available, and **Continue on desktop** without losing state;
- no AI provider leaves deterministic check evidence available and explains that optional AI review is unavailable.

## Journey 6: summary, skills, and due review

**Approved Core Alpha target**

1. The Learning Kernel derives a summary from persisted typed evidence, not from browser claims or a generated narrative.
2. Summary distinguishes successes, unresolved gaps, mistakes, review items, and optional model observations.
3. Skills shows mastery by dimension with supporting evidence types and dates.
4. Review orders due items and explains why each is due.
5. The user completes a due recall, explanation, assessment, practice, or interview activity.
6. The Learning Kernel applies deterministic rules and stores the resulting state so replay produces the same result.
7. Export of flashcards/evidence is a separate explicit local action and describes included data.

## Journey 7: create a personal adaptation

**Approved Core Alpha target**

1. The user opens an installed published Course Revision and chooses **Adapt for me**.
2. Aptiloop creates a personal Adaptation Branch that references the source revision.
3. The user may adjust ordering, optional activities, pacing metadata, translations, or local capsules within approved invariants.
4. Source revision and prior evidence remain immutable.
5. Validation shows divergence, source lineage, conflicts, and effect on future—not historical—learning state.
6. Publishing the personal adaptation creates an immutable personal revision.
7. If a new upstream Course Revision is installed, merging/rebasing is explicit and previewed; no silent overwrite occurs.

## Journey 8: change UI and Course locales

**Approved Core Alpha target**

1. In Settings, the user changes UI locale between `en-US` and `ru-RU`.
2. Navigation, controls, system errors, dates/numbers, accessibility names, and system notifications change locale.
3. Course primary-locale content does not change.
4. In a Course or Studio Preview, the user selects an available Course translation.
5. Activity identity, graph state, evidence types, code, hashes, and trusted check IDs remain unchanged.
6. If a translation is incomplete, the UI labels fallback content and its locale; it does not silently mix languages.

## Journey 9: configure and use an external provider

**Approved Core Alpha target**

1. In Settings, the user selects a provider, model, and allowed Aptiloop role.
2. Aptiloop reports authentication and capability requirements explicitly.
3. Before first use of private Course/learner context with that provider, the UI identifies provider, destination, and payload categories and requires explicit action.
4. Aptiloop invokes Pi through an app-owned role policy and typed tools only.
5. Tool arguments and outputs are schema-validated; secrets are redacted before persistence or UI delivery.
6. A provider/auth/model/tool failure is shown as that failure.
7. Aptiloop does not switch to Mock, another provider, or environment credentials contrary to the selected credential ownership.
8. The user can disable AI and continue the manual path.

## Journey 10: export or share private data

**Approved Core Alpha target**

1. The user starts from the object to export: Course Pack, evidence report, flashcards, or other approved artifact.
2. The UI previews the exact data classes, excluded private fields, format, destination, and whether external transfer is involved.
3. Credentials, provider sessions, absolute local paths, raw workspaces, and unrelated learner history are excluded by default and cannot enter a Course Pack.
4. The user explicitly confirms the named action.
5. Local export writes only to the selected destination. External sharing requires a separate explicit confirmation at the point of transfer.
6. Cancellation causes no transfer.

## Current baseline coverage

**Implemented baseline**

The Dev Learning Harness now demonstrates parts of Journeys 1–6 and 10: Course Pack V1 validation/Preview/install/export, immutable Course/session context, deterministic kernel-owned progression and replay, multiple activities, trusted local Node exercise checks, diff-bound read-only review/correction, deterministic summary/mastery/review projections, restart-safe interview/session behavior, and local flashcard export. It also retains the legacy draft Curriculum Editor related to Journey 2. Adaptive Studio, production Course content, complete target navigation/localization, and real Pi/provider roles remain unimplemented.

It does not implement the complete first-run target Course flow, personal-adaptation application, UI locale separation, target navigation/identity, Adaptive Studio, Pi typed tools/provider roles, or the complete manual/AI state model. M3–M5 local acceptance proves the current Course Pack, deterministic-kernel, and trusted execution slices; it is not production-content, public-distribution, or complete Core Alpha approval.
