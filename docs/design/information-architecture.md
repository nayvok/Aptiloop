# Information Architecture and Screen Specification

## Status and scope

This document owns Core Alpha route responsibility, navigation, meaningful URL state, screen purpose, and cross-screen recovery. The current route inventory is **Implemented baseline** evidence; future logical paths remain **Approved Core Alpha target** only where stated.

- **Implemented baseline** — current repository evidence.
- **Approved Core Alpha target** — required for Core Alpha.
- **Proposed pending owner approval** — an unresolved recommendation.
- **Future** — outside Core Alpha.

Calm Workshop — Clear Slate is the approved direction name, not a separate status label.

The visual system is owned by [`../../DESIGN.md`](../../DESIGN.md) and [`../design-system.md`](../design-system.md). Activity internals, Studio, and accessibility are owned by the sibling specialist specifications; this document links to them instead of redefining their component anatomy.

## Audit of the current information architecture

### Current route inventory

**Implemented baseline**

| Current path                                                                          | Current responsibility                                                                                                                  | Evidence                                                                                         | Current disposition                                                                                           |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `/`                                                                                   | Explicitly selected/current Course and deterministic next action                                                                        | `apps/web/app/page.tsx`; `apps/web/components/home-client.tsx`                                   | Primary Home destination; never infer current Course from list order or last route.                           |
| `/courses`                                                                            | Local Course/revision library, current selection, and explicit Create/Import entries                                                    | `apps/web/app/courses/page.tsx`; `apps/web/components/course-pack-client.tsx`                    | Primary Courses destination; contains no editor or inline Pack importer.                                      |
| `/courses/new`, `/courses/new/external`, `/courses/new/manual`, `/courses/new/guided` | Two exclusive assisted starts, quiet manual fallback, locally retained authoring brief, and explicit Draft creation; no Pack file input | the corresponding App Router pages; `CourseCreationClient`; version-matched instruction route    | External download creates nothing; guided/manual create exactly one explicit Draft only after confirmation.   |
| `/courses/import`                                                                     | Course Pack file selection, validation, Preview, and explicit install-or-draft action                                                   | `apps/web/app/courses/import/page.tsx`; `CoursePackClient`                                       | Dedicated acquisition route, separate from new Course creation.                                               |
| `/courses/intake/[operationId]?confirm={action}`                                      | Server-owned diagnostics, learner Preview, and explicit install/open-as-draft commit                                                    | `apps/web/app/courses/intake/[operationId]/page.tsx`; `CoursePackClient`                         | Recoverable only in the same process before expiry; restart, expiry, or unknown ID returns to file selection. |
| `/courses/studio?version={revisionId}&mode={mode}&tab={workspace}`                    | Explicitly selected revision workspace: Program, Designer, Preview, Release, or History                                                 | `apps/web/app/courses/studio/page.tsx`; `CurriculumStudioClient`                                 | `version` is required; optional creation `mode` and workspace `tab` are separate concerns.                    |
| `/courses/[courseId]/revisions/[revisionId]`                                          | Learner-safe revision preview and explicit Course selection                                                                             | `apps/web/app/courses/[courseId]/revisions/[revisionId]/page.tsx`; `HomeClient` selection target | Compatibility detail route until the logical Course route cutover.                                            |
| `/review`                                                                             | Due, Mistakes, Cards, and Interviews                                                                                                    | `apps/web/components/review-client.tsx`; review subclients                                       | Primary Review destination; `?view=` preserves non-Due selection across navigation and reload.                |
| `/skills`                                                                             | Evidence-backed topic and mastery dimensions                                                                                            | `apps/web/app/skills/page.tsx`; `apps/web/components/knowledge-client.tsx`                       | Primary Skills destination.                                                                                   |
| `/session?id=`, `/exercise?sessionId=`, `/interview`                                  | Lesson ActivityFrame, isolated practice/check/reviewer, and interview activity/report contexts                                          | the corresponding App Router pages and clients                                                   | Deep activity contexts; never separate primary destinations.                                                  |
| `/settings`                                                                           | Interface, local paths/Core, optional AI roles, Connections, and recovery                                                               | `apps/web/components/settings-form.tsx`; `provider-connection-manager.tsx`                       | Primary Settings destination with diagnostics kept secondary.                                                 |
| `/settings/curriculum`                                                                | Historical authoring URL redirect                                                                                                       | `apps/web/app/settings/curriculum/page.tsx`                                                      | Redirects to `/courses`; it is not a second Studio entry.                                                     |
| `/settings/developer-tools`, `/chat`                                                  | Local diagnostics and bounded role chat                                                                                                 | the corresponding route components                                                               | Secondary tools; generic chat and diagnostics do not define product IA.                                       |
| `/knowledge`, `/mistakes`, `/flashcards`                                              | Compatibility redirects                                                                                                                 | the corresponding route pages                                                                    | Preserve stable links while maintaining one navigation model.                                                 |

The shell implements exactly five localized destinations: Home, Courses, Review, Skills, and Settings. Desktop uses a collapsible rail; mobile uses a five-item bottom navigation. `en-US` and `ru-RU` UI locale remain independent from Course locale. Account/authentication is not rendered in the local-first single-user baseline.

### Current journey quality

**Implemented baseline**

| Journey                            | Current quality                                                                                           | Evidence                                  | Remaining target pressure                                                                       |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Resume learning                    | Deterministic current-Course focus with one next action                                                   | Home and `/learning/path`                 | Keep supporting evidence quieter than the next action.                                          |
| Switch among Courses               | Explicit selected Course/revision state and server-owned selection                                        | `/learning/courses`; Courses/Home clients | Avoid ambiguous Open versus Make current wording.                                               |
| Create a Course                    | External instruction download and connected Designer are the two assisted starts; manual remains complete | Course creation routes; Adaptive Studio   | Keep one exclusive chooser and one Continue action before dense authoring controls.             |
| Import a Course Pack               | Bounded Validate → Preview → explicit install/open-as-draft                                               | Courses intake                            | Keep import distinct from Course creation.                                                      |
| Complete lesson/practice/interview | ActivityFrame registry plus guarded session, exercise, reviewer, and interview flows                      | corresponding clients                     | Maintain orientation, protected answers, evidence, and clear recovery.                          |
| Review weak evidence               | Due, Mistakes, Cards, and Interviews under one URL-backed destination                                     | Review clients and kernel projections     | A due-item executor remains unavailable; provenance stays visible without a false Start action. |
| Inspect mastery                    | Evidence-backed Skills dimensions                                                                         | Skills client                             | Never collapse dimensions into an invented overall score.                                       |
| Configure optional AI              | AI Off, connection/model/role health, disclosure, and no silent Mock fallback                             | Settings, ProviderHealth, Connections     | Keep provider failure distinct from Core/storage failure.                                       |
| Work in both UI locales/themes     | `en-US`, `ru-RU`, light, dark, and system through shared semantic tokens                                  | App Shell, i18n provider, theme provider  | Continue 320px, keyboard, contrast, and long-label QA.                                          |

## Navigation model

### Primary destinations

**Implemented baseline**

Primary navigation contains exactly five destinations, in this order:

1. **Home** — current course, deterministic next action, due review, and blocking runtime notice.
2. **Courses** — installed Courses and immutable revisions, Course detail/outline, lessons, personal adaptation branch, and Adaptive Studio.
3. **Review** — due queue and views for Mistakes, Cards, and Interview practice.
4. **Skills** — evidence-backed topic mastery, dimensions, history, and source evidence.
5. **Settings** — language, appearance/accessibility, Core & Storage, runtimes, optional AI tools, privacy, and diagnostics.

Home is the default route. Courses is the only product-level entry to authoring; Studio is a workspace mode under a Course, not a sixth primary destination. Exercise and linked interview are activity contexts. Developer diagnostics never enter primary navigation.

### URL and state model

**Implemented baseline**

Meaningful navigation state is recoverable without moving server authority into the browser:

- **Course library:** `/courses?q={text}&filter={value}&page={number}`; default values canonicalize away and Back/Forward restores the view.
- **Course creation:** `/courses/new`, `/external`, `/guided`, and `/manual` own distinct starts; retained briefs are bounded local drafts, not URL payloads.
- **Pack intake:** `/courses/intake/{operationId}?confirm={action}` identifies only the staged operation and an `install` or `open-as-draft` confirmation choice; diagnostics, learner Preview, and commit remain intake-owned. Recovery works only in the same orchestrator process before `expiresAt`; restart or expiry requires file reselection and validation.
- **Studio:** `/courses/studio?version={revisionId}&mode={mode}&tab={workspace}` requires the revision, treats creation mode as optional context, and keeps the Program/Designer/Preview/Release/History workspace in the separate `tab` parameter. Week/day selection is canonicalized without dropping that state.
- **Review:** `/review` is canonical Due; `?view={destination}` preserves `mistakes`, `cards`, or `interviews`.
- **Chat:** `?role=` preserves the strict role selection while unrelated safe query parameters survive canonicalization.
- **Lesson contexts:** `/session?id=`, `/exercise?sessionId=`, and lesson-linked `/interview` preserve exact server-owned entity association.

Invalid or ambiguous URL state is replaced with a safe canonical value, never interpreted as a new entity or executable instruction. Compatibility redirects preserve stable links without creating a second navigation model.

### Desktop shell

**Approved Core Alpha target**

Direction: Calm Workshop — Clear Slate.

- The left rail is exactly 280px expanded and 72px collapsed. Width changes do not move icon centers, reorder destinations, clip labels, or change focus order. Collapsed items have accessible names and Radix tooltips; no custom label overlays page content. Collapse/expand exposes `aria-expanded` and preserves focus.
- The brand row owns identity only. Collapse/expand is a distinct edge-aligned control. Theme and provider utilities never appear in the brand stack or sidebar footer.
- Home, Courses, Review, and Skills occupy the main scrollable navigation group. Settings is the final navigation item in the lower group. One `nav` landmark or uniquely named landmarks preserve a coherent navigation model and `aria-current="page"` semantics. The footer contains no AI, provider, runtime, or ambiguous local-status pill.
- A restrained sticky utility header contains a labeled breadcrumb on the left and theme plus a compact layer-aware provider utility on the right. Provider detail/recovery remains in Settings or the affected workflow; the header does not present a generic “AI ready” KPI.
- Route ownership drives active navigation: Home only for `/`; Courses for `/courses/*`, compatibility `/session?id=`, exercise, and lesson-linked interview contexts; Review for `/review/*`; Skills for `/skills/*`; Settings for `/settings/*`.
- The separate page header owns title, description, and page actions. It does not repeat the breadcrumb or show a false top-level title for a nested route.
- Main width follows the screen: reading views cap content measure; lists and Studio use available width.
- Secondary tabs are scoped to their destination and use a single row. They do not duplicate primary navigation.

### Mobile shell

**Approved Core Alpha target**

- Top app bar: compact breadcrumb/up context for deep routes, theme/provider utilities only when they fit without displacing location, and one overflow menu for remaining global utilities.
- Fixed bottom navigation: Home, Courses, Review, Skills, Settings; label and icon always visible; safe-area inset honored.
- Exactly five labeled destinations remain in one bottom row; primary navigation never becomes a horizontally scrolling tab strip.
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
2. The primary action **Create Course** opens `/courses/new`; the secondary action **Import Course Pack** opens `/courses/import`. Neither routes through Settings or opens an existing Course editor. No marketplace or production catalog is implied.
3. `/courses/new` presents one unselected exclusive choice between **Use an external model** and **Use the connected Course Designer**, with one Continue action. It explains limited versus suitable model guidance without automatic weak/strong scoring. **Create manually without AI** remains a quieter complete fallback. The page contains no Pack file input.
4. The external start retains the same authoring brief locally, downloads a version-matched instruction embedding the exact generated V1 schema/template, sends nothing automatically, and directs the returned JSON to `/courses/import`.
5. Guided confirmation shows the exact configured role/provider/model and available capability evidence, then creates exactly one explicit local Draft before any transmission. Unknown evidence is advisory; AI Off and unavailable selections expose Settings, external, and manual recovery without silent substitution.
6. `/courses/import` alone reads one V1 JSON document and creates the server-owned staged intake. Invalid input stays outside the library; valid input proceeds through provenance/requirements review and learner Preview.
7. Install/Open-as-draft is explicit and atomic. For locally created Drafts, proposal **Apply**, deterministic **Validate**, digest-bound **Preview**, **Change review**, and immutable **Publish** remain separate gates.
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

Courses owns creation entry and Pack intake. Adaptive Studio begins only after an explicit local Draft/revision exists and owns structured editing, optional proposal review/Apply, deterministic Validate, digest-bound learner Preview, Change review, immutable Publish, personal adaptation/upstream integration, history, export, and clone-to-draft. It does not own an uncommitted Pack or embed import file selection. The complete sequence and mobile limits are specified in [`adaptive-studio.md`](adaptive-studio.md).

### 6. Work with no AI

**Approved Core Alpha target**

- Settings allows AI Off as an explicit choice.
- Home does not display a warning solely because AI is off.
- Lesson renders deterministic/manual activities normally. An optional AI region becomes “AI assistance is off” with a settings link; the learner’s draft stays editable.
- Studio remains fully authorable and validatable manually. The proposal inspector is absent or collapsed, never replaced by Mock.
- A real provider failure stays explicit. There is no silent real-provider → Mock fallback. Mock is visible only in test/CI/dev contexts.

### 7. Recover from missing runtime

**Approved Core Alpha target**

Settings → Core & Storage and Settings → Runtimes use status rows for Aptiloop Core, SQLite, filesystem, Node environment, Python environment, external editor, then optional AI tools. Each row has status, version/path summary, diagnostic reason, and one exact recovery action. Core/storage failures are pinned above optional failures. An external-editor failure retains the implemented copy/manual-path fallback.

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

### Courses library

**Approved Core Alpha target**

Desktop wireframe:

- Header actions: **Create Course** and **Import Course Pack** link to separate routes.
- Installed Courses are a ruled list, grouped by active and other; no identical card grid.
- Each row: title, immutable revision/version, primary/available locales, lesson count, source/provenance summary, local validation state, runtime requirements, and Continue/Open.
- Selected Course may open a right detail rail on wide screens.
- The library contains neither a Draft editor nor an inline Pack file input. Create never opens the selected, first, or most recently viewed Course.

Mobile wireframe:

- Single list; row metadata under disclosure.
- Sticky **Create Course** in empty/first-run state with secondary **Import Course Pack**.

Required states: library loading, no Courses, selected Course, multiple Courses, Draft-only Course, archived-only history, Core unavailable, storage unavailable, and library load failure.

### Create Course

**Approved Core Alpha target**

Breadcrumb: `Courses › Create course`. The page preserves one unselected exclusive chooser with two high-emphasis assisted paths and one Continue action:

1. **Use an external model** — explain that Aptiloop downloads a version-matched instruction, sends nothing automatically, and accepts the resulting JSON only at `/courses/import`.
2. **Use the connected Course Designer** — explain that Aptiloop shows the selected provider/model and current technical readiness evidence without rating model strength. `connected` and `degraded` remain eligible server states; unknown evidence is advisory, not a guessed Ready state.
3. **Create manually without AI** — a visually quieter tertiary link that remains complete and enabled whenever Core/storage permit.

External and guided routes collect the same brief and retain it locally until explicit Clear. External download creates no Draft. Guided/manual confirmation creates exactly one local Draft and opens that explicit Draft; provider transmission, proposal Apply, Validate, Preview, Change review, and Publish are later separate actions. This route contains no library, Pack input, selected-Course editor, validation dashboard, or Publish action.

Required states: initial choice, external brief/download, guided brief, capability checking, eligible connected/degraded selection, AI Off, provider/model unavailable, capability unknown advisory, explicit missing capability, manual fallback, retained-input create/download failure, cancelled-no-Draft, Core unavailable, and storage unavailable.

### Import Course Pack and staged intake

**Approved Core Alpha target**

Breadcrumb starts `Courses › Import Course Pack`; staged inspection appends the Pack title or a stable inspection label when known. `/courses/import` owns file selection, bounded byte/schema preflight, and the explicit **Validate Pack** action. A successful preflight enters `/courses/intake/:operationId`, where provenance, requirements, graph summary, diagnostics, and learner Preview precede the explicit install-or-draft decision. Import does not expose Course creation choices or Studio editing controls.

The route may explain that the file came from downloaded external-model instructions, but it does not contact that model or trust its output. `/courses/new` links here and never hosts this file input.

Mobile uses dedicated file-selection, validation, Preview, and confirmation steps rather than a cramped modal. Ordinary validated immutable installation is supported on mobile. The staged operation remains recoverable only in the same process before expiry; a Core restart or expiry returns to file selection. Desktop-only conflict enforcement and handoff behavior remain an **Approved Core Alpha target**.

Required states: no file, reading, invalid bytes, invalid Pack, incompatible schema, duplicate revision, validation blocked, Preview loading/failure, install-vs-draft choice, update/new revision available locally, runtime mismatch, commit uncertain, install failure, storage failure, expired staging operation, and cancel with no installed mutation.

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

- The utility-header breadcrumb resolves `Courses › {Course} › {Lesson}` from entity data for both the target route and compatibility `/session?id=`. Courses remains the active primary destination; loading entity labels use an honest loading state and never fall back to Home.
- A sticky lesson-orientation row may add activity N/M, remaining estimate, Plan, and Leave safely, but it does not repeat the shell breadcrumb or page title.
- Center 720–800px ActivityFrame.
- Optional contextual region for sources, notes, evidence, or runtime details when the exercised viewport has sufficient space.
- Activity frame anatomy and code/review/source contexts follow [`activity-renderers.md`](activity-renderers.md).

Mobile wireframe: one pane, compact progress header, Plan/Context sheets, contained code/output scroll, and sticky primary action above bottom navigation. No desktop rail remains squeezed beside content.

Required states: activity loading, locked, ready, in progress, saving, validation error, completed, stale evidence, browser offline, Core unavailable, AI off/unavailable, external editor missing, required Node/Python environment missing, check failure, read-only review, and safe resume.

### Review

**Approved Core Alpha target**

Desktop wireframe: URL-backed destinations **Due**, **Mistakes**, **Cards**, and **Interviews** sit above the main field; an optional detail rail may accompany the active destination. Each row exposes the persisted type, topic, reason, source evidence/date, and due state. Due rows do not render an executable Start action until the typed server-owned review executor exists.

Mobile wireframe: the same four destinations use one labeled Select; compact rows open their supported detail or action without losing `?view=` state. Controls remain reachable above bottom navigation.

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

Adaptive Studio contains the explicit Draft/revision header, optional guided Designer for that Draft, manual outline/finite-graph editing, Source Snapshot/Knowledge Capsule management, locale coverage, environment contracts, learner Preview, validation, Change review, immutable Publish, personal adaptation/upstream integration, history, clone, and export. Pack file selection and pre-install intake remain under `/courses/import`, never inside Studio. See [`adaptive-studio.md`](adaptive-studio.md).

Studio light/dark must preserve editor hierarchy, validation severity, selection, read-only state, and proposal provenance. Dark mode must not use code-editor neon, glow, or glass.

## Global loading, empty, error, and capability patterns

**Approved Core Alpha target**

| State                        | Required content                                                                                       | Prohibited behavior                                                          |
| ---------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| Loading                      | known heading/context, shape-preserving skeleton, `aria-busy`, one announcement                        | replacing the entire shell; announcing every skeleton pulse                  |
| Empty                        | reason, what creates content, one relevant action                                                      | “Nothing here” without recovery; decorative illustration taking focus        |
| Validation error             | summary, stable count, exact field/node link, inline message, preserved input                          | toast-only failure; clearing form; publishing with errors                    |
| Recoverable error            | failed layer/operation, retained data, Retry and settings/recovery path                                | generic “Something went wrong”; infinite retry                               |
| Browser offline              | visible Offline status, read-only retained data, explicit mutation limit                               | pretending local Core is necessarily down; promising sync                    |
| Core unavailable             | “Aptiloop Core is not responding,” retry, Core settings                                                | labeling as AI/network failure                                               |
| Storage unavailable          | specific SQLite/storage state and safe recovery                                                        | suggesting destructive reset before diagnostics/backup                       |
| AI off                       | calm neutral notice only where AI was optional                                                         | global warning; activating Mock                                              |
| AI unavailable               | provider/tool/model and explicit retry/switch/continue-without-AI options                              | silent provider or Mock substitution                                         |
| Designer capability checking | selected provider/model plus Checking state; manual and external alternatives remain usable            | showing Ready before server-owned capability resolution                      |
| Designer capability unknown  | exact eligible connection/model, advisory evidence gap, server-authoritative continuation and recovery | disabling every path; guessing model strength or silently switching provider |
| Runtime missing              | exact Node/Python/editor requirement and setup/copy/manual path                                        | arbitrary command execution or shell instructions from a Pack                |

## Theme and responsive ownership

**Implemented baseline**

Light/dark tokens, `surface-soft`, focus treatment, and Clear Slate hierarchy are canonical in [`../../DESIGN.md`](../../DESIGN.md) and [`../design-system.md`](../design-system.md). This IA adds only one invariant: theme or breakpoint changes never change route ownership, reading order, current destination, or URL-backed state.

## Explicit non-goals

**Future**

- Course marketplace, production Course library, community ratings, collaboration, and shared authoring.
- A separate primary nav item for Studio, Exercise, Interview, Cards, Mistakes, Agent Chat, or Diagnostics.
- General chat history as the organizing model for learning.
- Full IDE panels, terminals, arbitrary graph canvases, or scripts supplied by Course Packs.
- Cloud sync or silent sharing of private learner data.

## Information architecture acceptance checklist

**Approved Core Alpha target**

The IA gate is satisfied only when owner-approved implementation evidence shows:

- exactly Home/Courses/Review/Skills/Settings as primary destinations;
- every current journey has one unambiguous target owner and compatibility migration path;
- first run, install, learn, review, skill inspection, Studio, locale change, offline, no-AI, and missing-runtime journeys work end to end;
- desktop/mobile and light/dark compositions follow this specification;
- no nested-card hierarchy, generic dashboard/card grid, chat-clone organization, full IDE, or second mobile navigation row;
- all required states preserve data and identify the failing layer;
- `/courses/new` contains no Pack input; `/courses/import` is the sole upload owner;
- Create/Compile, proposal Apply, Validate, digest-bound Preview, Change review, and Publish remain distinct actions;
- design approval remains separate from implementation and Course publication approval.
