# User Journeys

## Document status

**Approved Core Alpha target**

This document defines the complete user journeys and their release boundaries.

**Implemented baseline**

M1–M11 implement the application journeys around development Course fixtures and user-owned Course flows, and the dated 2026-08-12 UI/UX/runtime hardening plus production-readiness polish record the current reviewed baseline. The 2026-08-10 M12 technical preflight is historical evidence for its earlier tree, while a fresh authenticated OpenCode Zen Tutor request is working-tree evidence only. A normal fresh profile intentionally contains no Course and offers Create Course / Import Course Pack; release authorization remains outside the implemented journey evidence.

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
6. With no installed Course, **Create Course** opens two assisted starts—external-model instructions or an eligible connected Course Designer—with a quiet complete **Create manually without AI** fallback; **Import Course Pack** remains a separate direct action to `/courses/import`.

Privacy result: no account, telemetry, upload, provider request, or sharing action occurs during launch.

## Journey 2: create a Course in Adaptive Studio

**Approved Core Alpha target**

1. From Home empty state or Courses, the user chooses **Create Course** at `/courses/new`. The screen contains no Pack file input, selected-Course editor, validation dashboard, or Publish action.
2. Two exclusive assisted choices use one Continue action: **Use an external model** downloads version-matched Course Pack V1 instructions, while **Use the connected Course Designer** proceeds to technical readiness and brief review. A quieter **Create manually without AI** fallback is always available.
3. The chooser explains the decision without scoring models: prefer an external model when it offers the needed context, search, tools, or reasoning; prefer the connected Designer when its exact model is eligible and the user considers it appropriate.
4. Both assisted paths collect the same locally retained brief: topic/goal, target outcome, current level, primary Course locale, pacing, tools/access, accessibility needs, and constraints. The Course locale remains independent from the UI locale. Before Draft creation, the browser copy survives reload only when `localStorage` is available and until explicitly cleared; guided confirmation persists the approved brief with the Draft.
5. External-model generation follows Journey 3. Aptiloop sends nothing to that model and cannot label its capability or output quality as verified.
6. In connected guided mode, Aptiloop shows the persisted Course Designer role, connection, exact model, and available capability evidence. `connected` and `degraded` are eligible; unknown/stale evidence is an advisory and the server performs the authoritative check. AI Off or an unavailable exact selection keeps connected generation disabled without affecting external or manual recovery.
7. Confirming guided creation creates exactly one explicit local Draft, preserves the brief with it, and enters that Draft's Designer. It does not contact a provider, apply a proposal, Preview, or publish. Cancel before confirmation creates nothing.
8. Before a later provider request, the transmission review names role, provider/model, destination, selected Draft fields/source records, payload categories, exclusions, and retention. Course Designer may then ask bounded questions or offer an optional diagnostic and returns a typed proposal with finite structure, sequencing, sources/capsules, activity/evidence types, trusted runtime/check references, estimates, assumptions, and provider/model provenance.
9. The user may edit, request revision, reject, or confirm compilation. None of those actions mutates the Draft. A separate **Apply to Draft** action validates and applies only the selected proposal changes.
10. The manual fallback creates the same Draft contract and opens the complete structured editor without provider checks or transmission. If readiness changes or a provider request fails, the retained Draft/brief can continue manually or through an external-model handoff.
11. **Validate** checks the current saved Draft and content digest. Learner **Preview** renders that exact digest. **Change review** shows the parent/source diff, locales, runtime requirements, provenance, and canonical hash inputs.
12. The user separately confirms immutable **Publish**. Create, proposal confirmation, compilation, Apply, Validate, and Preview never publish.

Recovery:

- Closing and reopening Studio resumes the saved local Draft. Unsaved browser-only authoring fields survive reload only when `localStorage` is available.
- Validation errors focus the exact node and field.
- AI unavailable leaves all manual controls working.
- A guided Draft and its brief survive provider, authentication, model, or capability failure; Aptiloop never replaces the selected provider/model or activates Mock silently.
- A pending Course Designer transmission review resumes only for the exact Draft revision, workflow, authoring operation, provider/model selection, and payload scope. Expired, terminal, ambiguous, unknown, or cross-revision records fail closed and require a new review.
- Publishing is blocked on errors, unknown activity/environment/check types, graph violations, missing primary-locale content, or unresolved protected material.

## Journey 3: import an externally authored Course Pack

**Approved Core Alpha target**

1. From `/courses/new` or Courses, the user chooses **Use an external model**, completes the locally retained brief, and downloads a version-matched instruction file embedding that brief, the exact generated Course Pack V1 schema, and a topic-neutral structural scaffold that is deliberately invalid until all placeholders, ownership/terms, and the content hash are resolved.
2. The user deliberately supplies only that downloaded file to the chosen external tool. Aptiloop neither transmits the brief nor verifies the external model; the resulting JSON remains untrusted.
3. The user opens `/courses/import` and selects the exact UTF-8 JSON file returned by the model. No import form exists on `/courses/new`, and downloading instructions or selecting a file creates no Course or Draft.
4. Aptiloop treats every field as untrusted data. It reads no commands and grants no runtime, filesystem, network, plugin, or provider authority from the pack.
5. Validation reports schema version, stable IDs, reference integrity, finite graph result, locale coverage, source/capsule hashes, environment/check references, limits, provenance, compatibility, and canonical hash. Authoring Kit and importer results must match.
6. Unknown or unsupported definitions fail closed. The user may inspect errors without partially installing runnable content.
7. The browser navigates to `/courses/intake/{validationId}`. A strict GET may restore the staged validation's Preview or diagnostics but never installs, publishes, or opens a Draft.
8. A valid pack opens in learner-safe Preview. The user sees publisher/provenance claims as claims, not automatic trust proof.
9. The user explicitly chooses **Install immutable revision** or **Open as local draft**, reviews the identity/hash/destination consequence, and confirms one atomic commit. Open as draft preserves the imported manifest as an immutable archived source revision and creates a separate personal Draft/adaptation lineage.

Privacy result: import is local. The pack cannot read existing Courses, learner history, credentials, paths, or provider sessions.

Recovery and lifecycle:

- Back, Forward, and reload restore URL-backed confirmation only while the bounded process-local staged validation remains available; GET never commits.
- Expiry or orchestrator restart makes the staged operation unavailable and requires explicit file reselection. Browser state cannot reconstruct a commit.
- Concurrent or mixed Install/Open-as-draft attempts have one atomic winner; already-claimed, malformed, unknown, and conflicting attempts fail closed.
- Invalid or expired intake leaves no partially runnable Course.
- Uninstall preserves history and fails closed while an active learning session pins the revision.
- A later Pack cannot silently change an existing Course's primary locale or overwrite an occupied personal adaptation branch.

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

**Implemented baseline**

Due Review Items expose an opaque typed free-response Activity on the Review surface. The server resolves the exact immutable Course, revision, branch, session, source evidence, and authored prompt; it atomically stores the learner submission and a deterministic completion bound to the current due cycle. The kernel retains that completed cycle and schedules a distinct successor three days later. Participation does not establish correctness or mastery, and source-session provenance never becomes a `/session` shortcut.

Interview practice stores browser-only setup drafts per validated learning-session scope and unsent answer drafts per exact interview/question. They restore across reload only when `localStorage` is available; accepted mutations clear only their matching draft. Persisted interview state, report, and Return action are server-owned and use the recorded `learningSessionId` association rather than trusting URL scope. Interview reports contain answer/interview observations and never establish technical correctness or mastery.

External Interviewer requests use the existing Evaluator provider role. A staged start or answer transmission review can resume after reload only for the exact session, interview, question, operation, provider/model selection, and payload. Expired, terminal, cancelled, unknown, ambiguous, or cross-scope records fail closed. AI Off preserves local drafts and offers explicit manual/settings recovery without creating a provider-backed interview.

Course Designer and Interview disclosure recovery has integration and component-remount evidence only. No fresh authenticated live-provider smoke has been observed for these recovery paths on `b542b32`.

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
3. Before every external dispatch carrying private Course/learner context, the UI identifies the exact role, provider/model, destination, payload categories, selected entities, exclusions, and retention disclosure and requires an operation-scoped explicit action. A changed scope requires a new review; prior consent is never a blanket authorization.
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

| Journey                               | Status                                                    | Current boundary                                                                                                                                                                                                                                                                                  |
| ------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. First local launch                 | **Implemented baseline** / **Approved Core Alpha target** | Account-free launch, locale confirmation, Course creation/import, and AI-Off recovery exist. A consolidated Home view of Core, SQLite, filesystem, Node/Python, editor, and provider readiness remains target work.                                                                               |
| 2. Adaptive Studio authoring          | **Implemented baseline**                                  | Manual and guided personal Draft workflows, exact disclosure recovery, Validate, Preview, change review, Publish, and immutable history exist. Any future Aptiloop-supplied first-party/sample Course remains separately gated.                                                                   |
| 3. Course Pack import                 | **Implemented baseline**                                  | Bounded validation, temporary URL-restored intake, learner-safe Preview, atomic Install/Open-as-draft, exact lineage/export, and fail-closed uninstall exist. Process restart requires file reselection.                                                                                          |
| 4. Start or resume learning           | **Implemented baseline**                                  | Kernel-owned next action, immutable session context, first-attempt protection, and restart-safe server resume exist for development Course content. Browser-only drafts restore when `localStorage` is available.                                                                                 |
| 5. Practice/check/review correction   | **Implemented baseline**                                  | Trusted Node/Python checks, complete diff freshness, read-only Reviewer, and correction recheck exist. Trusted local execution is not an independent sandbox.                                                                                                                                     |
| 6. Summary, Skills, Review, Interview | **Implemented baseline**                                  | Summary, Skills, due scheduling/provenance, cards, scoped restart-safe Interview observations, and typed due-Review participation execution exist. Completion retains the exact cycle and schedules a unique successor without claiming correctness/mastery or fabricating a `/session` shortcut. |
| 7. Personal adaptation                | **Implemented baseline**                                  | Personal lineage, immutable source preservation, personal Publish, and explicit upstream integration exist for development content.                                                                                                                                                               |
| 8. UI and Course locales              | **Implemented baseline** / **Approved Core Alpha target** | Complete `en-US`/`ru-RU` application catalogs, persisted UI locale, and independent primary Course locale exist. Authored-resource fallback/conformance evidence remains target work; a future first-party/sample Course would need its own locale evidence.                                      |
| 9. External provider                  | **Implemented baseline** / **Approved Core Alpha target** | Exact role/provider/model configuration, operation-scoped disclosures, typed tools, explicit failure, and no Mock fallback exist. A fresh authenticated OpenCode Zen Tutor request is recorded for the working tree; other roles and recovery paths remain unexercised by a live provider.        |
| 10. Export or share                   | **Implemented baseline** / **Approved Core Alpha target** | Explicit local Course Pack and flashcard exports exist. External sharing and production distribution remain target/gated work.                                                                                                                                                                    |

The baseline intentionally supplies no bundled Course. A fresh user creates a personal Course or imports a trusted Course Pack; this is normal product behavior, not a release blocker. The public source branch remains distinct from external data sharing, a tagged Core Alpha release, or a license grant. Those actions and any future first-party/sample Course retain their applicable privacy, legal, content, artifact, and owner gates.
