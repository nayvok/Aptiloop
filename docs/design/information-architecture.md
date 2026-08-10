# Information Architecture and Screen Specification

## Status and scope

This document specifies Core Alpha navigation, journeys, screens, wireframe-level responsive behavior, and cross-screen states. It does not claim that the target routes or compositions are implemented.

- **Implemented baseline** — current repository evidence.
- **Approved Core Alpha target** — required for Core Alpha.
- **Approved Core Alpha target — Calm Workshop** — selected composition and presentation choices.
- **Future** — outside Core Alpha.

The visual-direction approval gate is defined in [`../../DESIGN.md`](../../DESIGN.md). Activity internals, Studio, and accessibility are detailed in the sibling specifications.

## Audit of the current information architecture

### Current route inventory

**Implemented baseline**

| Current path                         | Current responsibility                      | Evidence                                                                           | Audit finding                                                                                   |
| ------------------------------------ | ------------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `/`                                  | Path/current day/week                       | `apps/web/app/page.tsx`; `apps/web/components/dashboard-client.tsx:237-452`        | Strong resume surface; lacks Course Pack first run and Core-layer states.                       |
| `/session?id=`                       | Current lesson and 12 unit types            | `apps/web/app/session/page.tsx`; `apps/web/components/session-client.tsx:691-1036` | Strong learner seam; should become a course/lesson workspace rather than a primary destination. |
| `/exercise?sessionId=`               | Isolated code attempt, diff, checks, review | `apps/web/components/exercise-client.tsx:447-850`                                  | Keep as an activity context and compatibility deep link; remove from primary navigation.        |
| `/knowledge`                         | Topic × dimension table                     | `apps/web/components/knowledge-client.tsx:29-121`                                  | Move to Skills; replace table-only mobile behavior.                                             |
| `/mistakes`                          | Mistake journal                             | `apps/web/components/mistakes-client.tsx:24-89`                                    | Move to Review as a view/filter.                                                                |
| `/interview`                         | Setup, transcript, report                   | `apps/web/components/interview-client.tsx:521-925`                                 | Standalone practice belongs in Review; linked interviews stay in lessons.                       |
| `/flashcards`                        | Candidate approval and local export         | `apps/web/components/flashcards-client.tsx:26-144`                                 | Move to Review; preserve explicit candidate approval.                                           |
| `/settings`                          | Theme, paths, AI roles, connections         | `apps/web/components/settings-form.tsx:523-892`                                    | Split settings by user task and distinguish Core/runtime/AI layers.                             |
| `/settings/curriculum`               | Versioned curriculum CRUD/publish           | `apps/web/components/curriculum-editor-client.tsx:1053-1107`, `:1365-1559`         | Predecessor to Adaptive Studio; lacks Course Pack and typed editing flows.                      |
| `/settings/developer-tools`, `/chat` | Diagnostics and agent playground            | `apps/web/components/app-shell.tsx:34-60`                                          | Keep diagnostics secondary; a generic chat must not define product IA.                          |

The current desktop shell uses a fixed 256px rail (`apps/web/components/app-shell.tsx:95-164`). Mobile exposes eight destinations in a four-column grid (`:187-212`). The shell maps system modules instead of the learner’s five recurring tasks. Hardcoded Russian labels and `<html lang="ru">` (`apps/web/app/layout.tsx:11-20`) are audit findings to migrate, not evidence of the required locale model.

### Current journey quality

**Implemented baseline**

| Journey                    | Current quality         | Path evidence                                             | Core Alpha gap                                                                    |
| -------------------------- | ----------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Resume today               | Strong                  | `dashboard-client.tsx:277-337`, `:457-550`                | Course identity, first run, runtime readiness.                                    |
| Complete lesson            | Strong v2 seam          | `session-client.tsx:691-790`, `:943-1036`                 | Stable ActivityFrame/registry and unified activity contexts.                      |
| Code practice              | Strong guarded sequence | `exercise-client.tsx:504-529`, `:621-848`                 | Bring into lesson anatomy; name trusted check IDs/environment.                    |
| Review weak evidence       | Fragmented              | `/mistakes`, `/flashcards`, `/interview`                  | One due-first Review entry.                                                       |
| Inspect mastery            | Dense desktop table     | `knowledge-client.tsx:62-119`                             | Evidence-led Skills detail and mobile-native disclosure.                          |
| Configure optional AI      | Present but conflated   | `provider-health.tsx:83-137`; `settings-form.tsx:604-844` | AI Off/unavailable/failed; explicit provider resolution; no silent Mock fallback. |
| Work offline or without AI | Not modeled             | generic query errors in `query-state.tsx:5-30`            | Layer-specific offline/Core/storage/runtime states.                               |
| Author a revision          | Partial                 | `curriculum-editor-client.tsx:804-1048`, `:1053-1107`     | Course Pack intake, typed forms, Preview, validation, Change review, export.      |
| Use English/Russian        | Absent                  | `app-shell.tsx:24-60`; `layout.tsx:20`                    | Separate UI and course locale contracts.                                          |

## Navigation model

### Primary destinations

**Approved Core Alpha target**

Primary navigation contains exactly five destinations, in this order:

1. **Home** — current course, deterministic next action, due review, and blocking runtime notice.
2. **Courses** — installed Courses and immutable revisions, Course detail/outline, lessons, personal adaptation branch, and Adaptive Studio.
3. **Review** — due queue and views for Mistakes, Cards, and Interview practice.
4. **Skills** — evidence-backed topic mastery, dimensions, history, and source evidence.
5. **Settings** — language, appearance/accessibility, Core & Storage, runtimes, optional AI tools, privacy, and diagnostics.

Home is the default route. Courses is the only product-level entry to authoring; Studio is a workspace mode under a Course, not a sixth primary destination. Exercise and linked interview are activity contexts. Developer diagnostics never enter primary navigation.

### Route model

**Approved Core Alpha target** logical routes; exact URLs may be refined without changing ownership:

| Target path                                                   | Screen owner                                                                             | Current compatibility source                |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------- |
| `/`                                                           | Home                                                                                     | `/`                                         |
| `/courses`                                                    | Course library / first run                                                               | no equivalent                               |
| `/courses/new`                                                | Create Course: manual Draft or optional guided Course Designer                           | no equivalent                               |
| `/courses/intake/:operationId`                                | Courses-owned staged Pack inspection, validation, Preview, and install-or-draft decision | no equivalent                               |
| `/courses/:courseId`                                          | Course overview and finite outline                                                       | current Path data                           |
| `/courses/:courseId/lessons/:lessonId`                        | Lesson workspace / ActivityFrame                                                         | `/session?id=`                              |
| `/courses/:courseId/lessons/:lessonId/activities/:activityId` | Stable activity deep link                                                                | `/exercise?sessionId=`, linked `/interview` |
| `/courses/:courseId/adaptation`                               | Personal adaptation branch                                                               | no equivalent                               |
| `/courses/:courseId/studio`                                   | Adaptive Studio Pack overview                                                            | `/settings/curriculum`                      |
| `/courses/:courseId/studio/revisions/:revisionId`             | Studio editor/preview/validation/release                                                 | `/settings/curriculum`                      |
| `/review`                                                     | Due queue                                                                                | no combined equivalent                      |
| `/review/mistakes`                                            | Mistakes view                                                                            | `/mistakes`                                 |
| `/review/cards`                                               | Candidate and due cards                                                                  | `/flashcards`                               |
| `/review/interviews`                                          | Standalone interview practice/history                                                    | `/interview` without lesson context         |
| `/skills`                                                     | Topic index                                                                              | `/knowledge`                                |
| `/skills/:topicId`                                            | Topic dimensions/evidence timeline                                                       | no equivalent                               |
| `/settings`                                                   | Settings category overview                                                               | `/settings`                                 |
| `/settings/language`                                          | UI locale                                                                                | no equivalent                               |
| `/settings/appearance`                                        | Theme and accessibility preferences                                                      | part of `/settings`                         |
| `/settings/core`                                              | Core, SQLite, filesystem, backups                                                        | partial diagnostic paths                    |
| `/settings/runtimes`                                          | Node, Python, external editor                                                            | partial Zed path                            |
| `/settings/ai-tools`                                          | optional providers/models/roles                                                          | part of `/settings`                         |
| `/settings/privacy`                                           | data boundaries/export controls                                                          | no equivalent                               |
| `/settings/diagnostics`                                       | lifecycle, check, and provider diagnostics                                               | developer tools and chat                    |
| `/exports/:operationId/review`                                | Reusable local export/external share review                                              | no equivalent                               |

A server-issued `operationId` owns pre-install Pack staging; neither selected file bytes nor a local path appears in the URL. Intake remains Courses-owned through bounded parse, validation, provenance/requirements review, Preview, and explicit commit. **Open as local draft** creates a Course/Draft and then enters Studio; **Install immutable revision** enters the resulting Course overview. Studio never owns an uncommitted external Pack.

Compatibility links may redirect during migration, but the final cutover must not leave two navigation models or two names for one user task.

### Desktop shell

**Approved Core Alpha target — Calm Workshop**

- 240–256px left rail with product identity, the five destinations, active Course switcher, and a compact local status entry.
- Home/Courses/Review/Skills occupy the main group; Settings sits at the rail foot.
- Top of content contains a contextual breadcrumb and page-level actions only. A global provider-health pill is replaced by layer-aware local status.
- Main width follows the screen: reading views cap content measure; lists and Studio use available width.
- Secondary tabs are scoped to their destination and use a single row. They do not duplicate primary navigation.

### Mobile shell

**Approved Core Alpha target**

- Top app bar: current page title, optional back/up affordance, and one overflow menu.
- Fixed bottom navigation: Home, Courses, Review, Skills, Settings; label and icon always visible; safe-area inset honored.
- No second row, horizontally scrolling primary tabs, or eight-item grid.
- Activity primary action sits above the bottom bar; sheets leave it reachable and preserve focus.
- Deep-linked activity or Studio screens may temporarily replace the bottom bar with a task toolbar when the user is in a contained workflow and a clear Back/Leave action is present.

## Global state hierarchy

**Approved Core Alpha target**

The UI derives a layer before selecting copy or recovery:

1. **Browser offline** — navigator/network unavailable. Reads already in memory may remain visible and labeled; mutations are disabled unless durable offline handling exists.
2. **Aptiloop Core unavailable** — browser may be online, but local Core cannot be reached. Provide “Open Core & Storage settings” and non-destructive retry.
3. **Storage unavailable** — Core responds but SQLite is locked, migration-blocked, corrupt, missing, or read-only. Never flatten to “network error.”
4. **Course unavailable/invalid** — Course Pack missing, invalid, incompatible, or revision not installed.
5. **Required runtime missing** — declared Node/Python environment or filesystem capability prevents an activity.
6. **Optional runtime missing** — external editor or AI tool unavailable; show a manual alternative when contractually valid.
7. **Operation failure** — a scoped load/save/check/review/export failed.

All states preserve already entered learner or authoring data. The UI never marks a kernel transition complete based only on optimistic client state.

## Required journeys

### 1. First run: create or import a Course

**Approved Core Alpha target**

1. Home detects no installed Course and shows a compact readiness section with separate Core, SQLite, filesystem/workspace, Node, Python, external editor, and optional AI rows. Blocking local infrastructure appears first; AI Off is neutral.
2. The primary action is **Create Course** and the secondary action is **Import Course Pack**. Both lead to Courses; no marketplace or production catalog is implied.
3. Courses offers **Create Course**, **Import Course Pack**, and **Open local Pack**. Create opens `/courses/new`, where **Create manually** and optional **Describe a learning goal** converge on the same local Draft schema. Cancel before confirmation leaves no Draft. Import/Open creates only a server-owned staging operation at `/courses/intake/:operationId`.
4. Open reads one V1 JSON document for inspection only. Import remains Courses-owned while it performs bounded non-executing validation, provenance/requirements review, and learner Preview before any persistence.
5. Invalid input remains outside the installed library. Errors identify JSON path, stable node ID, field, and rule.
6. For a valid Pack, the user explicitly chooses **Install immutable revision** or **Open as local draft**, then reviews Course/revision/hash/destination and commits atomically. Install enters Course overview; Open-as-draft creates the Course/Draft before Studio opens.
7. For creation, confirmed minimal metadata creates only a local Draft and opens Adaptive Studio; immutable Publish remains a separate desktop gate.
8. Home then shows the active Course/Draft status and the deterministic next valid action.

Missing Core or storage blocks create/import commits. Missing optional AI never blocks manual creation, authoring, or any required/terminal learner path. Every publishable Course graph must have a deterministic/manual route; AI-dependent activities are optional and non-blocking. Commands, scripts, secrets, and plugins are rejected rather than displayed as runnable options.

### 2. Resume or start learning

**Approved Core Alpha target**

1. Home identifies active Course and personal branch.
2. One lead action resumes an active lesson or starts the next available lesson determined by the Learning Kernel.
3. The Course outline explains locked prerequisites without offering a bypass.
4. Lesson workspace restores the current activity, learner draft, persisted evidence, and exact graph position.
5. Leaving is always safe: “Leave lesson” describes that saved state will resume from the current activity.
6. Completion is acknowledged only after a server-owned transition succeeds.

### 3. Review due evidence

**Approved Core Alpha target**

1. Home shows a compact due-review line only when actionable.
2. Review opens to a due-first list ordered by kernel policy, not UI heuristics.
3. Each row names type, topic, reason, last relevant evidence/date, estimated effort, and action.
4. Mistakes, Cards, and Interviews are filters/views over Review, not competing destinations.
5. Candidate flashcards require explicit approve/reject; export remains a separate local action.
6. Interview reports distinguish answer observations from technically validated evidence.
7. Empty state explains which learning activity creates review items and links to Courses when appropriate.

### 4. Inspect Skills

**Approved Core Alpha target**

1. Skills opens an alphabetic/grouped topic list with concise evidence status and review due state.
2. Selecting a topic opens dimensions, their 0–5 levels, confidence/evidence count, last update, and an evidence timeline.
3. Every level can be traced to source activity/revision/date without revealing protected answers.
4. Missing or stale evidence is explicit; the UI does not invent a single overall skill score.
5. Personal adaptation indicators are distinguished from source-Course expectations.

### 5. Author, validate, preview, and publish

**Approved Core Alpha target**

Courses → Course → Adaptive Studio owns Create/Open/Import, metadata, outline/finite graph, structured activity editing, Source Snapshots, Knowledge Capsules, locale completion, environment contracts, Preview, validation, Change review, immutable Publish, personal adaptation/upstream integration, release history, export, and clone-to-draft. The complete sequence and mobile limits are specified in [`adaptive-studio.md`](adaptive-studio.md).

### 6. Work with no AI

**Approved Core Alpha target**

- Settings allows AI Off as an explicit choice.
- Home does not display a warning solely because AI is off.
- Lesson renders deterministic/manual activities normally. An optional AI region becomes “AI assistance is off” with a settings link; the learner’s draft stays editable.
- Studio remains fully authorable and validatable manually. The proposal inspector is absent or collapsed, never replaced by Mock.
- A real provider failure stays explicit. There is no silent real-provider → Mock fallback. Mock is visible only in test/CI/dev contexts.

### 7. Recover from missing runtime

**Approved Core Alpha target**

Settings → Core & Storage and Settings → Runtimes use status rows for Aptiloop Core, SQLite, filesystem, Node environment, Python environment, external editor, then optional AI tools. Each row has status, version/path summary, diagnostic reason, and one exact recovery action. Core/storage failures are pinned above optional failures. An external-editor failure retains the current useful copy/manual-path fallback seen in `apps/web/components/exercise-client.tsx:538-547`.

### 8. Change UI or preview locale

**Approved Core Alpha target**

- UI locale is `en-US` or `ru-RU` and changes navigation, controls, errors, dates, and accessibility names.
- A Course has one primary locale and declared fallback/translation locales.
- Changing UI locale does not silently change Course content.
- Studio preview has an independent Course locale selector and visibly marks fallback or missing translations.
- The document language changes at the correct root or region; mixed-language content uses `lang` on the Course-content region.

### 9. Review an external provider transmission

**Approved Core Alpha target**

Before Course Designer, Tutor, Evaluator, Reviewer, or interview generation sends private context, the reusable review names Aptiloop role/tool, provider/model, destination, credential owner, exact payload categories and selected entity/document/evidence ranges, exclusions/redactions, size bounds, and known retention disclosure. **Cancel** preserves the draft and sends nothing; **Send to provider** is explicit. A changed provider, role, destination, data category, protected-data rule, or materially expanded range requires renewed review. Offline/auth/provider/timeout/invalid-response states preserve input and never change deterministic state.

### 10. Export or share data

**Approved Core Alpha target**

The reusable export/share review opens from a Course, evidence report, flashcards, or another approved artifact. It shows included and excluded data classes, format, local destination or external destination, overwrite/transfer boundary, checksum where applicable, and exact confirmation. Local export and external sharing are separate operations; a completed local export is never proof of sharing. Cancel sends/writes nothing. Retry after an uncertain transfer first reads operation status and cannot duplicate-send.

## Screen specifications

### Home

**Approved Core Alpha target**

Desktop wireframe:

1. Open page heading with active Course and personal/source revision context.
2. On first run, an open ruled readiness section ordered Core, SQLite, filesystem/workspace, Node, Python, external editor, optional AI. Each row shows state, reason, and one recovery action; successful optional rows collapse after first run while actionable blockers remain.
3. Lead next-action field: lesson, current activity, graph position, estimated remaining time, and one Resume/Start button.
4. Three phase rows (understand, demonstrate, practice/review), not three equal cards.
5. Compact upcoming lesson list.
6. Narrow context rail only when there is due review or a blocking Core/runtime issue after the first-run readiness section is complete.

Mobile wireframe:

1. Course/readiness and the primary Create/Resume action fit in the first viewport at typical 390×844 sizing.
2. First-run readiness is a compact ordered list, never metric cards; optional AI is last and neutral when Off.
3. Phase rows stack with concise disclosure.
4. Upcoming items use compact rows.
5. No Course shows primary **Create Course** and secondary **Import Course Pack**; completed Course offers Review and another installed Course without manufacturing a streak metric.

Light/dark: same separators and hierarchy; dark uses raised surfaces only for the lead action and temporary status, never glow.

Required states: loading, readiness loading, no Course, create/import unavailable because Core/storage failed, installed but no published revision, ready, active lesson, Course complete, browser offline, Core unavailable, storage unavailable, start failure.

### Courses library and first run

**Approved Core Alpha target**

Desktop wireframe:

- Header actions: **Create Course**, **Import Course Pack**, **Open local Pack**.
- Installed Courses are a ruled list, grouped by active and other; no identical card grid.
- Each row: title, immutable revision/version, primary/available locales, lesson count, source/provenance summary, local validation state, runtime requirements, and Continue/Open.
- Selected Course may open a right detail rail on wide screens.
- `/courses/new` begins with manual/guided choice and minimal Course/locale fields. Confirm creates one local Draft; Cancel creates nothing.

Mobile wireframe:

- Single list; row metadata under disclosure.
- Sticky **Create Course** in empty/first-run state with secondary **Import Course Pack**; Open local Pack remains in overflow.
- Intake validation and learner Preview are dedicated steps, not a cramped modal.
- Ordinary validated immutable installation confirmation is supported on mobile. Complex import conflict resolution requires desktop; the validated staging operation remains resumable and exposes a clear handoff instead of a failing control.

Required states: library loading, no Courses, new-Course initial/saving/save failure/cancelled-no-Draft, Core unavailable, storage unavailable, invalid Pack, incompatible schema, duplicate revision, Preview loading/failure, install-vs-draft choice, update/new revision available locally, runtime mismatch, commit uncertain, install failure, and storage failure.

### Course overview and outline

**Approved Core Alpha target**

Desktop wireframe: Course header; active/source/personal revision; locale; Continue; lesson outline as an ordered list with finite activity counts, prerequisite state, estimated time, and completion. A secondary rail contains sources, Pack facts, and Studio entry for the owner/authoring use case.

Mobile wireframe: Course summary, Continue, then lesson disclosure list; the Studio entry is in Course actions and opens a dedicated workspace.

Locked items explain prerequisites. Published source content is read-only. Personal adaptations are labeled and can be inspected without conflating them with source revision state.

Required states: loading, no active or published revision, Draft only, archived-only history, invalid/missing revision, source revision read-only, personal branch active, upstream update available, integration conflict, runtime mismatch, Core/storage unavailable, and safe resume after failed Continue.

### Personal adaptation and upstream integration

**Approved Core Alpha target**

Desktop wireframe: source revision/hash and current personal revision header; allowed-change/invariant summary; divergence list and future-state impact; **Adapt for me** or **Open personal Draft**; Change review and Preview; upstream comparison with clean changes/conflicts; explicit merge/rebase into a new personal Draft; separate Publish personal revision.

Mobile wireframe: branch status, divergence rows, conflict inspection, simple resolution, and Preview as dedicated screens. Wide conflict resolution and Publish show **Available on desktop** without losing state.

Required states: no branch, branch current, Draft saved/saving/failed, upstream available, comparison loading, clean integration, conflict, validation blocked, stale source/hash, merge failure, publish uncertain, and personal revision published. Source revisions and historical evidence are always read-only; Cancel or failure never auto-merges.

### Lesson workspace

**Approved Core Alpha target**

Desktop wireframe:

- Sticky Course › lesson breadcrumb, activity N/M, remaining estimate, Plan, and Leave safely.
- Center 720–800px ActivityFrame.
- Optional 280px context rail for sources, notes, evidence, or runtime details.
- Activity frame anatomy and code/review/source contexts follow [`activity-renderers.md`](activity-renderers.md).

Mobile wireframe: one pane, compact progress header, Plan/Context sheets, contained code/output scroll, and sticky primary action above bottom navigation. No desktop rail remains squeezed beside content.

Required states: activity loading, locked, ready, in progress, saving, validation error, completed, stale evidence, browser offline, Core unavailable, AI off/unavailable, external editor missing, required Node/Python environment missing, check failure, read-only review, and safe resume.

### Review

**Approved Core Alpha target**

Desktop wireframe: due-first list in the main field; scoped tabs All/Mistakes/Cards/Interviews; optional detail rail. Each list row has type, topic, reason, source evidence/date, due state, and action.

Mobile wireframe: compact rows; selecting an item opens a full screen. Tabs may use a select/menu if all labels do not fit at 320px. Primary review action remains reachable above bottom navigation.

Cards retain candidate approval and local export. Export errors stay local and do not invalidate review. Interview reports use “Answer observations” until technical correctness is evaluated.

Required states: no due items, never learned, filter empty, stale evidence, item missing because source revision changed, export failure, AI off/unavailable for optional interview generation, and Core/storage failure.

### Skills

**Approved Core Alpha target**

Desktop wireframe: topic list left; selected topic right with dimension rows, evidence counts, last update, source activity timeline, review due reason, and personal-branch markers.

Mobile wireframe: topic summary rows; select a topic to open a dedicated page; dimensions are expandable rows rather than the current 900px-wide table.

Levels must have text, numeric value, and accessible name. Color is supplementary. Empty state points to the first Course lesson that can create evidence. Interview answer-form observations never increment technical mastery without Learning Kernel evidence.

Required states: loading, no topics, topic without evidence, evidence available, stale or missing source revision, replay/integrity failure, filter empty, personal/source branch distinction, Core unavailable, and storage unavailable.

### Settings overview

**Approved Core Alpha target**

Settings is a list of categories, not one long form:

- Language
- Appearance & Accessibility
- Core & Storage
- Runtimes
- Optional AI Tools
- Privacy & Data
- Diagnostics

Desktop may show category navigation plus selected settings pane. Mobile shows category rows and dedicated screens. Save state stays next to the changed setting; immediate theme/locale changes explain whether they also need persistence.

Required states for every category: loading; ready; saved; saving; save failed with retained input; restart required; permission denied; browser offline; Core unavailable; storage unavailable; and unsupported capability. Provider settings additionally distinguish AI Off, auth missing/invalid, provider/model unavailable, capability mismatch, and retained unsent input.

### Core, storage, runtime, and AI status

**Approved Core Alpha target**

Desktop wireframe: status list ordered Aptiloop Core, SQLite, filesystem, Node environments, Python environments, external editor, optional AI tools. Row anatomy: component, Ready/Starting/Missing/Misconfigured/Update required/Permission denied/Off, version or non-secret path, reason, recovery action. Diagnostics stay in a disclosure.

Mobile wireframe: stacked status rows and full-screen detail. Core issue is pinned; optional AI never masquerades as Core failure.

AI provider resolution and authentication failure remain explicit. Provider/model provenance appears on AI-generated assistance/proposals by disclosure, and every external transmission uses the review pattern below before private context leaves the device. The UI never exposes arbitrary Pi filesystem, shell, network, or edit tools.

### Privacy & Data and export/share review

**Approved Core Alpha target**

Privacy & Data lists local data classes and locations at a non-secret abstraction level, retention controls, approved exportable artifacts, provider disclosure history, and direct links to the reusable Export/Share review. It does not offer a destructive reset before backup/diagnostics.

Desktop review: artifact identity; included/excluded data classes; format; local file destination or named external destination; overwrite/transfer boundary; checksum/size where known; warnings; **Cancel** and one exact action such as **Export locally** or **Share with provider**. External transfer is always a separate confirmation after any local export.

Mobile review uses one step per scope/destination/confirmation and keeps the final action above safe-area navigation. Large desktop-only exports explain that limit without dropping the prepared scope.

Required states: scope loading, nothing exportable, preview ready, validation blocked, local permission/path failure, serialization/checksum failure, progress, cancel, success, browser offline, external auth/transfer failure, uncertain transfer status, and retry after server readback without duplicate send.

### External provider transmission review

**Approved Core Alpha target**

The common pattern for Course Designer, Tutor, Evaluator, Reviewer, and interview generation shows role/tool, provider/model, destination, credential ownership, payload categories and exact selected entity/document/evidence ranges, exclusions/redactions, size bounds, and known retention disclosure. Scope-changing actions require renewed review. Cancel/offline/auth/provider/timeout/invalid-response states preserve drafts and record no successful transmission. See [`activity-renderers.md`](activity-renderers.md#external-provider-transmission-review).

### Adaptive Studio

**Approved Core Alpha target**

Adaptive Studio contains Pack overview, guided/manual creation, outline/finite graph, structured editor, Source Snapshot/Knowledge Capsule management, locale coverage, environment contracts, learner Preview, validation, Change review, immutable Publish, personal adaptation/upstream integration, history, clone, import, and export. See [`adaptive-studio.md`](adaptive-studio.md).

Studio light/dark must preserve editor hierarchy, validation severity, selection, read-only state, and proposal provenance. Dark mode must not use code-editor neon, glow, or glass.

## Global loading, empty, error, and capability patterns

**Approved Core Alpha target**

| State               | Required content                                                                | Prohibited behavior                                                   |
| ------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Loading             | known heading/context, shape-preserving skeleton, `aria-busy`, one announcement | replacing the entire shell; announcing every skeleton pulse           |
| Empty               | reason, what creates content, one relevant action                               | “Nothing here” without recovery; decorative illustration taking focus |
| Validation error    | summary, stable count, exact field/node link, inline message, preserved input   | toast-only failure; clearing form; publishing with errors             |
| Recoverable error   | failed layer/operation, retained data, Retry and settings/recovery path         | generic “Something went wrong”; infinite retry                        |
| Browser offline     | visible Offline status, read-only retained data, explicit mutation limit        | pretending local Core is necessarily down; promising sync             |
| Core unavailable    | “Aptiloop Core is not responding,” retry, Core settings                         | labeling as AI/network failure                                        |
| Storage unavailable | specific SQLite/storage state and safe recovery                                 | suggesting destructive reset before diagnostics/backup                |
| AI off              | calm neutral notice only where AI was optional                                  | global warning; activating Mock                                       |
| AI unavailable      | provider/tool/model and explicit retry/switch/continue-without-AI options       | silent provider or Mock substitution                                  |
| Runtime missing     | exact Node/Python/editor requirement and setup/copy/manual path                 | arbitrary command execution or shell instructions from a Pack         |

## Light and dark behavior

**Approved Core Alpha target — Calm Workshop**

- Light uses tinted cool-neutral background and near-white semantic surfaces; avoid pure white.
- Dark uses three quiet luminance levels: background, surface, raised. Border contrast provides grouping.
- Primary eucalyptus remains action/selection, not success. Success, warning, destructive, activity type, and focus are separate token roles.
- Selected rows use background + leading marker + `aria-current`/state, not color alone.
- Diff additions/deletions, validation severities, mastery dimensions, and graph edges require text/icon/pattern equivalents.
- Theme changes do not rearrange content or hide borders. Screens must not rely on shadow as their only boundary.

## Explicit non-goals

**Future**

- Course marketplace, production Course library, community ratings, collaboration, and shared authoring.
- A separate primary nav item for Studio, Exercise, Interview, Cards, Mistakes, Agent Chat, or Diagnostics.
- General chat history as the organizing model for learning.
- Full IDE panels, terminals, arbitrary graph canvases, or scripts supplied by Course Packs.
- Cloud sync or silent sharing of private learner data.

## Information architecture acceptance checklist

The IA gate is satisfied only when owner-approved implementation evidence shows:

- exactly Home/Courses/Review/Skills/Settings as primary destinations;
- every current journey has one unambiguous target owner and compatibility migration path;
- first run, install, learn, review, skill inspection, Studio, locale change, offline, no-AI, and missing-runtime journeys work end to end;
- desktop/mobile and light/dark compositions follow this specification;
- no nested-card hierarchy, generic dashboard/card grid, chat-clone organization, full IDE, or second mobile navigation row;
- all required states preserve data and identify the failing layer;
- design approval remains separate from implementation and Course publication approval.
