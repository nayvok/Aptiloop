# Activity Frame and Renderer Specification

## Status and purpose

This document owns the implemented lesson `ActivityFrame`, closed renderer registry, type-specific interaction boundaries, technical contexts, and authoring-preview contract. Route ownership and global shell behavior remain in [`information-architecture.md`](information-architecture.md); cross-cutting accessibility remains in [`accessibility.md`](accessibility.md).

- **Implemented baseline** — current repository evidence.
- **Approved Core Alpha target** — required behavior.
- **Proposed pending owner approval** — an unresolved recommendation.
- **Future** — outside Core Alpha.

Calm Workshop — Clear Slate is the approved direction name, not a separate status label.

## Baseline audit

**Implemented baseline**

`apps/web/components/activity-frame.tsx` implements the shared frame. `activityRendererRegistry` in `session-client.tsx` is frozen and covers briefing, study, recall, teacher dialogue, quiz, code reading, exercise, review, interview, summary, checkpoint, and spaced review. An unknown type renders a localized `role="alert"` unsupported state instead of falling through to arbitrary UI. The deterministic kernel and server contracts remain authoritative for readiness, completion, evidence, and next action.

Session activities preserve bounded context-scoped local drafts for learner input where implemented. Exercise and linked Interview routes retain exact Course/lesson entity breadcrumbs and server-owned session association rather than presenting themselves as unrelated destinations. This is the implemented migration seam; no parallel learning state machine is permitted.

The lesson presentation is a container-aware two-column workspace. Orientation and the current activity form the left canvas; when available content width permits, the lesson-plan rail spans both rows, stays below the App Shell, fills the remaining viewport height, and scrolls independently. Narrower layouts keep one activity column and expose the same plan in an accessible sheet. Phase grouping, locked/current/completed text, `aria-current`, persisted `currentStep`, and every completion mutation retain their existing deterministic owners.

## Activity model boundary

**Approved Core Alpha target**

An Activity is an immutable Course Revision node with stable identity, supported renderer type, prerequisite edges, completion criteria, evidence contract, locale content, source/capsule references, and optional environment/check/tool capabilities.

The Activity renderer:

- renders server-approved learner data;
- gathers learner input;
- invokes named app operations;
- renders persisted evidence/status;
- requests a Learning Kernel transition.

The Activity renderer does not:

- decide readiness, mastery, graph transition, or completion by itself;
- receive protected authored answers unless a server-owned scoring operation requires them and keeps them server-side;
- execute Course Pack commands or resolve scripts/plugins;
- expose arbitrary model, filesystem, shell, network, edit, or patch tools;
- allow Reviewer to mutate a workspace;
- silently select Mock or another provider after a real-provider failure.

## ActivityFrame anatomy

**Approved Core Alpha target**

Every activity uses this ordered anatomy even when a region is empty:

1. **Lesson context** — the App Shell owns `Courses › {Course} › {Lesson}`; the lesson orientation row adds activity N/M, deterministic graph position, remaining estimate, Plan, and Leave safely without duplicating the breadcrumb.
2. **Activity header** — type icon and text, status text, title, concise purpose, estimate, required/optional.
3. **Prompt/material** — authored instructions, Knowledge Capsule content, question, code, or task criteria.
4. **Response surface** — learner answer, selection, explanation, checklist, external workspace handoff, or review acknowledgement.
5. **Validation/evidence** — saved state, local validation, server scoring facts, trusted check evidence, review findings, or source provenance.
6. **Context** — optional sources, notes, capability/runtime state, evidence history, AI provenance.
7. **Action footer** — one primary next action, secondary save/retry/reveal as allowed, and explicit completion requirements.

The frame owns shared loading, focus, status announcements, save state, capability resolution, error placement, and kernel transition requests. The renderer owns only type-specific material, response, and evidence formatting.

### Desktop composition

**Implemented baseline**

- Sticky lesson orientation and the activity occupy the left column; the substantial plan rail occupies the right column only when the lesson container, rather than the raw viewport, has enough width.
- The plan rail has one canvas boundary, viewport-height independent scrolling, a connected phase timeline, and concise locked/current/completed text. Internal step rows use spacing and a current-step surface instead of stacked separators.
- The sticky lesson orientation and ActivityFrame share one centered canvas boundary up to about 64rem, so progress and activity content align while prose inside the canvas retains its own readable measure.
- The desktop plan rail stays within roughly 22–24rem and yields to the sheet composition when the post-sidebar lesson container cannot support both columns comfortably.
- A contextual region appears only for sources, notes, evidence, or capability help that is useful alongside the task and fits the exercised viewport. Missing-source authoring remains available as a low-emphasis contextual link rather than a competing lesson action.
- The main activity is an open editorial field; `surface-soft` is reserved for quiet context/evidence wells rather than wrapping every activity in a nested card or dividing every region with a rule.
- Technical evidence may use a wider workspace up to the content maximum, while learner instructions retain readable measure.

### Mobile composition

**Implemented baseline**

Below the lesson-container rail threshold, the workspace is one edge-safe activity column and Plan opens the same semantic content in the existing full-height sheet. Radix owns dialog focus containment, Escape, close, and trigger focus return; long activity content retains horizontal containment.

**Approved Core Alpha target**

- One pane; lesson context compresses to Course/lesson, N/M, and Plan.
- Context opens in a bottom/full-height sheet and returns focus to its trigger.
- Primary action is sticky above the five-item bottom navigation or replaces navigation during a contained task.
- Long code, diff, tables, and output are contained; the page itself must not horizontally overflow.
- Response drafts remain visible when an error or capability sheet opens.

### Light and dark

**Implemented baseline**

Activity type uses a tokenized icon, label, and supporting trace. It never recolors all body text. Light mode uses the near-white Clear Slate foundation; dark mode separates graphite background/surface/raised without glow. Code, diff, focus, status, error, and activity type use independent semantic roles.

## Declarative renderer registry

**Implemented baseline**

The current registry is closed, frozen, and exhaustive for the learner unit union. It maps each supported type to one renderer and fails safely for an unknown type. Shared schemas and server routes—not component naming—define accepted learner payloads and evidence.

**Approved Core Alpha target** metadata may evolve toward a declarative definition such as:

```ts
interface ActivityRendererDefinition {
  type: SupportedActivityType;
  family:
    | "orient"
    | "study"
    | "recall"
    | "explain"
    | "assess"
    | "practice"
    | "review"
    | "reflect";
  learnerPayloadSchema: unknown;
  progressPayloadSchema: unknown;
  evidenceKinds: readonly string[];
  requiredCapabilities: readonly CapabilityId[];
  optionalCapabilities: readonly CapabilityId[];
  authoringSchema: unknown;
  previewPolicy: "static" | "simulated-no-persist";
}
```

This is a target metadata shape, not the current registry API. Any evolution must reuse existing shared schemas and naming conventions rather than introduce duplicate contracts.

Registry requirements:

- every supported Activity type has exactly one renderer and authoring schema;
- unknown/unsupported types fail validation before publication and render a safe unsupported state if encountered;
- capability requirements are declared, not inferred from UI code;
- protected data boundaries are declared and tested at the API/schema boundary;
- activity family affects presentation only, never kernel semantics;
- future metadata migration extends the current registry incrementally without changing persisted meaning.

## Common interaction contract

**Approved Core Alpha target**

### Start and resume

- Ready activity presents a concrete “Start activity” or task-specific action.
- Starting is idempotent and disables duplicate submission.
- Resume restores persisted response/evidence and clearly distinguishes saved server state from an unsaved local draft.
- Locked activity explains the prerequisite and links to the current available activity; it offers no client-side unlock.

### Draft and save

- Textual responses autosave only when a durable contract exists; otherwise the action is “Save response.”
- Saving preserves focus and reports status with polite live text.
- Save failure retains the draft, identifies the failed layer, and offers Retry/copy.
- Navigating away warns only about genuinely unsaved content.

### Validate and complete

- Client validation is guidance; server/kernel validation is authoritative.
- Completion button names the remaining requirement when disabled.
- On success, focus moves to a completion summary or next activity heading, not the top of the entire page.
- An optimistic UI may show saving/pending but must not claim completion before server readback.

### Evidence

- Evidence names kind, source activity/revision, timestamp, result, and freshness.
- Protected reference answers are never rendered as learner evidence.
- Stale trusted-check/review evidence identifies why it is stale.
- Mastery is displayed only from the Learning Kernel result, never calculated in renderer code.

## Renderer patterns

### Briefing / orientation

**Approved Core Alpha target**

Purpose: establish lesson outcomes, prerequisites, plan, estimates, and capability requirements.

Material: outcomes, finite activity sequence summarized by family, prior-knowledge prompt, environment notices. Response: acknowledgement/checklist only where meaningful. Evidence: acknowledgement and selected plan facts, not mastery.

Empty outcomes or an invalid empty lesson are authoring validation failures. A missing required runtime is shown before the learner enters a dependent task.

### Study / Knowledge Capsule

**Approved Core Alpha target**

Purpose: read or inspect bounded authored content.

Material supports headings, paragraphs, lists, callouts with semantic roles, inline/block code, tables with mobile alternatives, diagrams with text equivalent, examples, misconceptions, and linked Source Snapshot context. Reading measure is 64–72ch. Completion criteria may require checklist acknowledgement or a subsequent activity, not scroll depth.

Source rail shows snapshot title, kind, locale, captured version/date, origin, and external-open action. Missing source never removes the capsule body; it shows source unavailable and provenance state. Fallback locale is visibly labeled.

### Recall

**Approved Core Alpha target**

Purpose: retrieve without seeing the protected answer.

Prompt appears before response. First-attempt state is explicit. The UI preserves the immutable first attempt and may allow a later revision as separate evidence. Any reference explanation is shown only after server-owned rules permit it and is labeled as feedback, never substituted into the first attempt.

Actions: Save first attempt, revise/explain when allowed, continue when completion criteria pass. Offline/save failure preserves the draft and does not pretend the first attempt was recorded.

### Teacher dialogue / guided explanation

**Approved Core Alpha target**

Purpose: improve a learner-authored explanation with optional typed assistance.

This is not generic chat. The layout is learner draft → optional bounded teacher response/feedback → learner revision. Every required or terminal Core Alpha path has a manual/deterministic completion route; AI may enhance feedback but cannot be required to complete the Course.

AI state names Aptiloop tool/role; provider/model appears in disclosure. No arbitrary tools. A real-provider failure offers explicit Retry, switch to another explicitly configured provider, or continue without AI. Mock is test/CI/dev only and is never a silent fallback.

Streaming content is not announced token by token. Saved revision IDs and evidence are explicit. Teacher output cannot directly mark mastery.

### Quiz / selected response assessment

**Approved Core Alpha target**

Use `fieldset`/`legend` for each question. Options are complete accessible labels with generous targets. Submit is separate from selection. After server scoring, each result combines icon/text and explanation; color alone is insufficient.

Retry preserves attempt history and distinguishes latest result from immutable first attempt. Protected keys remain server-side. Empty option sets, multiple supposed single answers, or missing criteria block Pack validation.

### Code reading / explain code

**Approved Core Alpha target**

Material: language-labeled code with line numbers only when referenced; copy; wrap toggle; contained horizontal scroll; optional Source Snapshot. Response is structured into prediction, explanation, and verbal fix where authored.

Desktop may show code beside response when each remains usable; mobile stacks them and keeps the prompt visible via a compact disclosure. Code is never an editable IDE. Completion requires server-persisted fields, not textarea presence alone.

### Code practice workspace

**Approved Core Alpha target**

Purpose: make a learner-owned change in an isolated attempt workspace and collect trusted evidence. The Activity schema declares editor mode `embedded`, `external`, or `either` plus the bounded logical document set. Small text/code exercises—typically one to three declared documents within editor limits—may use the typed embedded editor. Larger multi-file projects use the app-owned external-editor adapter or path-copy/manual-open handoff. Neither mode is a full IDE or grants command authority.

Sequence:

1. understand criteria and constraints;
2. create/resume isolated attempt;
3. open declared documents in the embedded editor, or launch/copy the external workspace according to the Activity contract;
4. save through generation/hash checks and refresh the complete baseline diff;
5. run registered trusted checks by check ID;
6. inspect result and freshness;
7. request read-only review when prerequisites pass;
8. make changes independently if requested;
9. rerun fresh checks and review;
10. accept evidence and return to lesson.

The implemented next-action and fallback patterns remain the migration seam. The target labels the editor mode, environment contract (Node/Python), check ID and purpose, diff baseline, output truncation/freshness, and review boundary.

The embedded editor reads/writes only declared logical documents through typed APIs; it has no terminal, package manager, arbitrary filesystem browser, arbitrary command, or autonomous AI edit. The external adapter executable/argv/cwd remain app-owned. Execution Fabric exposes only app-owned actions such as **Run checks**. Missing Node/Python blocks checks with a settings path; missing external editor offers copy/manual open or the declared embedded alternative. Reviewer is read-only, produces findings against current evidence, and never supplies an Apply patch.

Device contract: desktop supports both declared modes. Mobile may edit a small declared embedded task when its renderer, input method, and reflow contract are supported; it may inspect criteria, diff, check output, and review evidence for either mode. Full-project coding is never recreated inside mobile web UI. When registered external handoff is unavailable, mobile shows workspace retention, copy path where meaningful, and **Continue on desktop**; state and evidence remain resumable.

### Review renderer

**Approved Core Alpha target**

Purpose: present read-only evaluation and collect learner acknowledgement/correction cycle state.

Header identifies reviewer boundary and evidence fingerprint/freshness on disclosure. Body: summary, strengths, findings grouped by category, hint level where meaningful, cited file/range/check, and required learner next action. A “changes requested” result cannot complete the activity. The learner edits independently, reruns checks, and requests a fresh review.

No “Apply fix,” patch button, editable reviewer diff, or filesystem tool appears. A provider failure remains explicit and does not convert to Mock.

### Interview

**Approved Core Alpha target**

Linked interview uses ActivityFrame; standalone interview lives in Review. Setup declares studied/manual scope, difficulty, question count, estimate, and assessment limits. One question is active at a time; answer drafts persist according to the save contract.

**Implemented baseline.** Interview reports use **Answer observations** and explicitly state that answer structure/completeness—not technical correctness—was evaluated. These observations do not become mastery without deterministic Learning Kernel evidence.

AI Off/unavailable disables only optional generation. Saved interviews/reports remain readable, and a required/terminal Course or review path must use authored deterministic questions or another manual renderer. A standalone optional generated interview may be unavailable without blocking Course completion. Failure to obtain a question preserves setup and operation identity.

### Summary / reflection

**Approved Core Alpha target**

Summary displays deterministic facts from persisted evidence: completed activities, outcomes, mistakes/corrections, cards needing approval, mastery changes where kernel-derived, review due items, and next action. It does not accept model-authored facts as authority.

A commit/save step names what will be persisted. Failure retains the derived summary and allows safe retry. Empty summary evidence is an integrity error, not a celebratory empty state.

### Checkpoint

**Approved Core Alpha target**

Checkpoint composes supported assessment/acknowledgement elements and states the gate it controls. Required criteria are visible before the attempt. It may aggregate existing evidence but cannot invent new mastery. Locked/failed criteria link to their originating activities.

### Spaced review

**Approved Core Alpha target**

Spaced review names why the item is due and shows the prior evidence date without revealing protected material. It may use recall, quiz, explanation, or practice subpatterns registered by schema. Completion returns evidence to the kernel; the renderer never schedules its own next date.

**Implemented baseline.** The Review UI starts a typed free-response activity only from a server-issued opaque execution identity. It shows authored immutable Course content plus due/source-evidence context, preserves the learner response on failure, and submits only an operation ID and bounded text. The server persists participation without claiming correctness/mastery, completes the exact due cycle, and returns the deterministic successor date. The renderer never reopens the source session or schedules locally.

## Source context pattern

**Approved Core Alpha target**

Source context is available from Study, Recall feedback, Code reading, Practice criteria, Review, and Summary when referenced. It contains:

- Source Snapshot title and stable ID on disclosure;
- source kind and origin;
- captured version/date and locale;
- Course revision that pinned it;
- relevant Knowledge Capsule and activity;
- attribution/terms when declared;
- local availability, fallback, or missing state;
- explicit Open external source action.

Desktop uses a context rail or inline ruled disclosure. Mobile uses a sheet. Opening a source never changes completion. External navigation is announced, and private local content is never uploaded to refresh or summarize without explicit action.

## Code context pattern

**Approved Core Alpha target**

Code contexts include language, source/fixture label, read-only state, copy, wrap, and accessible description. Optional line numbers are excluded from copy and screen-reader reading unless referenced. Horizontal scroll containers are keyboard-focusable and named. Diff contexts additionally expose Added/Removed/Context semantics in text and a unified reading view.

Terminal-style decoration, editable Monaco-like chrome, fake window controls, or arbitrary shell input are prohibited. Check output is evidence from a trusted check ID, not an interactive console.

## Review context pattern

**Approved Core Alpha target**

Review context contains reviewed attempt ID, baseline/current evidence fingerprint on disclosure, check IDs and results, provider/model provenance for the read-only reviewer, start/completion time, findings, and stale/current status. The prominent label is “Read-only review.” No content suggests that the reviewer can edit or approve publication.

## External provider transmission review

**Approved Core Alpha target**

Before Course Designer, Tutor, Evaluator, Reviewer, or interview generation sends private Course/learner/workspace context to an external provider, a reusable review surface shows:

- Aptiloop role and typed tool;
- provider, model, external destination, and credential owner;
- exact payload categories and selected Course/revision/activity/document/evidence ranges;
- explicit exclusions, redactions, size bounds, and whether protected answers are excluded;
- provider persistence/retention disclosure known to Aptiloop;
- **Cancel** and **Send to provider** as distinct actions.

Consent is scoped to the displayed provider/tool/data categories. A changed provider, role, destination, inclusion category, protected-data policy, or materially expanded range requires a new review. An unchanged repeated action may use a user-configured remembered choice only when the exact scope remains inspectable and revocable. Cancel, browser offline, auth failure, provider failure, timeout, and invalid response preserve the learner/author draft and record no successful transmission. Model provenance and the actual bounded request identity remain available on the resulting observation/proposal; no provider action changes deterministic state by itself.

## Capability model and states

**Approved Core Alpha target**

| Capability state                | Frame behavior                                                                             |
| ------------------------------- | ------------------------------------------------------------------------------------------ |
| Full local                      | Render normal activity and optional assistance affordances.                                |
| AI Off                          | Hide/collapse optional AI; manual path complete; no global alarm.                          |
| AI unavailable                  | Preserve input; show exact provider/tool failure and explicit choices; no silent fallback. |
| External editor missing         | Keep workspace path, copy/open-manually guidance, and checks.                              |
| Required Node missing           | Preserve activity; disable checks; name environment contract and Settings action.          |
| Required Python missing         | Same as Node with Python-specific contract.                                                |
| Core unavailable                | Preserve local draft where safe; disable kernel mutations; retry/Core settings.            |
| Storage unavailable             | Render retained content read-only; explain SQLite/storage state.                           |
| Browser offline                 | Distinguish from local Core failure; do not promise sync or queued completion.             |
| Unsupported renderer/capability | Safe error with type/capability ID and Course validation path; no generic crash.           |

## Loading, empty, error, and stale states

**Approved Core Alpha target**

### Loading

The route and session-query boundary use the shared localized page LoadingState because the activity shape is not known yet. A bounded renderer subregion may use a skeleton only when its approximate geometry is stable. One concise status is announced; starting, saving, scoring, checking, reviewing, and completing use distinct verbs.

### Empty

An activity material/response is empty only when the schema permits it. Otherwise it is a Pack validation/integrity error. User-generated empty states explain how to create evidence. Summary and review do not turn missing evidence into zero metrics.

### Error

Errors are placed in the failing region and summarized at the frame when they block progress. They include operation and layer; input remains. Retry reuses idempotency/operation identity where required. A toast may confirm success but never be the only failure record.

### Offline

Offline banner does not cover the activity header. Saved server evidence is labeled; unsaved local response is labeled separately. Completion/check/review buttons are disabled unless the exact operation is locally supported. There is no automatic queue claim.

### Stale evidence

A stale check/review names what changed since evidence capture. Primary action becomes rerun/refresh, not continue. Truncated diff or output that invalidates review is explicit and fail-closed.

## Authoring and preview mapping

**Approved Core Alpha target**

Each renderer exposes an authoring schema that maps fields to the learner anatomy. Studio preview uses the production renderer contract with persistence, checks, provider calls, and mastery disabled. Authors can preview:

- desktop/mobile;
- light/dark;
- each Course locale and fallback state;
- loading/empty/error where meaningful;
- AI Off/unavailable;
- missing external editor;
- missing Node/Python runtime;
- locked/ready/in-progress/completed/stale evidence.

Preview is labeled and cannot create real evidence. Protected answer material is excluded even for author preview unless a separate protected inspector is deliberately opened.

## Accessibility contract

**Approved Core Alpha target**

- One `h1` identifies the lesson/workspace; ActivityFrame title is the next appropriate heading.
- Activity type/status are text, not icon/color only.
- Every response has programmatic label, instruction, error association, and preserved value.
- Status changes announce once; AI streaming and check output are not read continuously.
- Focus moves to the next meaningful heading after transitions and to exact error on requested navigation.
- Keyboard order follows material → response → evidence → actions → context trigger.
- Sticky actions never cover focused content at 200% zoom or mobile safe areas.
- Code/diff/output and wide tables have named scroll regions and mobile alternatives.
- Reduced motion, target size, focus appearance, contrast, error identification, and authentication follow [`accessibility.md`](accessibility.md).

## Explicit non-goals

**Future**

- A chat transcript as the universal renderer.
- Pack-defined renderers, executable plugins, arbitrary HTML/JS, or arbitrary model tools.
- Embedded IDE, terminal, patch application, repository browser, or general graph editor.
- Reviewer patches or automatic corrections.
- UI-owned mastery/progression or model-owned deterministic facts.
- Production Course content.

## Renderer acceptance gate

**Approved Core Alpha target**

Automated tests provide implementation evidence for the common frame, closed type registry, supported renderers, local draft recovery, protected-answer separation, deterministic kernel ownership, typed due Review execution, trusted check IDs, explicit provider failure, and read-only Reviewer. Focused browser checks separately cover exercised responsive, theme, and interaction paths. Complete 320px reflow and unexercised assistive-technology/state combinations do not become accessibility or release evidence through this document.
