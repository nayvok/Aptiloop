# Accessibility Specification

## Standard and status

**Approved Core Alpha target**

Aptiloop Core Alpha targets **WCAG 2.2 Level AA**, the current W3C Recommendation target specified for this project. Level AA conformance includes every applicable Level A and Level AA success criterion.

Authoritative references:

- W3C Recommendation: [Web Content Accessibility Guidelines (WCAG) 2.2](https://www.w3.org/TR/WCAG22/)
- W3C explanatory guidance: [Understanding WCAG 2.2](https://www.w3.org/WAI/WCAG22/Understanding/)
- W3C techniques and failures: [Techniques for WCAG 2.2](https://www.w3.org/WAI/WCAG22/Techniques/)

This document is a product specification and audit. It is not a conformance statement, accessibility certification, or claim that the current interface meets WCAG 2.2 AA.

Status vocabulary:

- **Implemented baseline** — current repository evidence.
- **Approved Core Alpha target** — required accessibility behavior.
- **Proposed pending owner approval** — an unresolved recommendation.
- **Future** — outside Core Alpha.

Calm Workshop — Clear Slate is the approved direction name, not a separate status label.

## Baseline audit

### Implemented semantics

**Implemented baseline**

- `AppShell` provides a skip link, focusable main landmark, named desktop/mobile navigation, exactly five ordered destinations, visible current-page state, and an `aria-expanded` collapse control.
- The utility breadcrumb is a named navigation landmark with an ordered list, linked ancestors, entity-backed labels, and plain final text with `aria-current="page"`.
- Shared buttons and form controls expose accessible names, labels, descriptions, invalid/disabled/busy state, visible focus, and mobile-sized targets.
- Query, validation, streaming, save, and interview states use bounded `role="status"` or `role="alert"` regions rather than announcing every visual update.
- Review uses semantic desktop tabs and a labeled compact Select for the same Due/Mistakes/Cards/Interviews destinations.
- The closed ActivityFrame registry provides typed labels/status and a localized unsupported-type alert; lesson and roadmap progress use accessible values and current-step semantics.
- `en-US` and `ru-RU` catalogs drive application strings and root language independently from Course locale.
- Global reduced-motion rules and component `motion-reduce` variants remove nonessential transitions and transforms.

### Evidence limits and remaining acceptance work

**Implemented baseline** automated tests cover selected landmarks, names, roles, values, keyboard paths, focus states, theme behavior, reduced motion, URL-backed navigation, and localized labels. Focused browser checks separately cover exercised responsive layouts and interactions. Neither verifies complete 320px reflow or constitutes certification.

**Approved Core Alpha target** remains open for a complete WCAG 2.2 A/AA criterion inventory and representative manual verification with screen readers, keyboard-only navigation, 200% zoom, 320 CSS px reflow, text-spacing overrides, Forced Colors Mode, rendered contrast across every state, long labels in both locales, and capability/error variants. No component test, screenshot set, E2E pass, or green repository gate is a certification by itself.

## Conformance scope

**Approved Core Alpha target**

The WCAG target applies to:

- Home, Courses, Review, Skills, and Settings;
- Course Pack first run, intake, validation, install, and export;
- Course overview and lesson workspace;
- every supported ActivityFrame renderer and state;
- code, diff, trusted-check, read-only review, and Source Snapshot contexts;
- Adaptive Studio overview, outline/graph alternative, structured editing, Preview, validation, typed proposals, Change review, Publish, history, adaptation, and clone;
- light and dark themes;
- `en-US` and `ru-RU` UI and mixed Course-content locales;
- desktop and mobile compositions;
- loading, empty, error, validation, browser-offline, Core/storage unavailable, no-AI, AI unavailable, and missing-runtime states.

Third-party external editor, provider login pages, and external source sites are outside Aptiloop page conformance, but Aptiloop’s launch/link/authentication handoff remains in scope.

## Perceivable

### Text alternatives and non-text content — 1.1.1

**Approved Core Alpha target**

- Functional icons use an accessible name on their control; duplicate decorative icons are `aria-hidden`.
- Course diagrams provide authored text alternatives. A finite graph always has a synchronized outline/list that exposes the same nodes, edges, states, and actions.
- Status dots, activity colors, mastery bars, validation markers, diff colors, and provider indicators have adjacent text.
- Screenshots are not used as UI. Any instructional screenshot requires concise alternative text and, when it contains important sequence/detail, a nearby textual equivalent.
- Generated decorative illustrations, if introduced later, are ignored by assistive technology and never carry required instructions.

### Information and relationships — 1.3.1, 1.3.2, 1.3.5

**Approved Core Alpha target**

- Headings form a logical hierarchy: one page/workspace `h1`; major sections `h2`; nested activity/inspector sections follow order without selecting levels for size.
- Navigation, main, complementary source/evidence rail, search, form, and status regions use semantic landmarks and names.
- Lists, tables, definition lists, fieldsets, legends, labels, captions, and headers carry relationships programmatically.
- Required state is in label/instruction and `required`/`aria-required` as appropriate.
- Personal-data fields use correct autocomplete purpose tokens where applicable. Aptiloop does not request secrets through ordinary settings forms.
- Reading and focus order match visual order. CSS reordering may not produce a different keyboard or screen-reader sequence.

### Sensory characteristics and orientation — 1.3.3, 1.3.4

**Approved Core Alpha target**

Instructions never rely only on position, shape, color, sound, or gesture. “Select the red node on the right” becomes “Select ‘Recall: closures,’ marked Error.” Both portrait and landscape work unless a specific external environment makes an orientation essential; no current Core Alpha screen has such an exception.

### Color and contrast — 1.4.1, 1.4.3, 1.4.11

**Approved Core Alpha target**

- Normal text: at least 4.5:1 against its rendered background.
- Large text under the WCAG definition: at least 3:1.
- Essential control boundaries, icons, focus indicators, graph edges, progress parts, and status visuals: at least 3:1 against adjacent colors where required by non-text contrast.
- Color never carries the only meaning. Activity families add icon/text; validation adds severity text/icon; diff adds Added/Removed labels; Skills shows numeric/text values.
- Disabled controls remain identifiable; disabled contrast is assessed for usability even where WCAG’s inactive-component exception applies.
- The Clear Slate neutral foundation is tested independently from evergreen primary/success/progress/focus roles. Selected rail items, neutral accent buttons, activity surfaces, destructive/warning fields, and dark graphite surface boundaries remain distinguishable without relying on a green cast.
- Every semantic token pair is tested in light, dark, hover, active, focus, selected, disabled, overlay, and forced-colors contexts. OKLCH values are not accepted based on visual intuition alone.

### Resize, reflow, spacing, and hover content — 1.4.4, 1.4.10, 1.4.12, 1.4.13

**Approved Core Alpha target**

- Text can resize to 200% without loss of content or function.
- At 320 CSS px width (or equivalent 400% zoom at 1280px), content reflows to one dimension except genuinely two-dimensional content such as code, diff, graph, or data table; those exceptions stay in named, contained scroll regions and have a usable alternative where required.
- The current 900px Skills table is replaced on mobile by topic/detail and expandable dimension rows.
- User-applied text spacing—line height 1.5×, paragraph spacing 2×, letter spacing 0.12×, word spacing 0.16×—does not clip or overlap content.
- Tooltip/popover content triggered by hover or focus is dismissible, hoverable, and persistent under WCAG conditions. Essential instructions never live only in a tooltip.
- Sticky lesson actions and bottom navigation do not cover zoomed focus targets or validation errors.
- The desktop rail remains exactly 280px expanded or 72px collapsed without content overlap, clipped destinations, focus loss, or layout jitter. At zoom/reflow breakpoints it yields to the mobile shell rather than squeezing beside 320px content.

## Operable

### Keyboard — 2.1.1, 2.1.2, 2.1.4

**Approved Core Alpha target**

- Every action works from keyboard without timing-sensitive key sequences.
- No keyboard trap exists in sheets, dialogs, code scroll regions, graph alternatives, editors, popovers, or provider authentication handoff.
- Dialog focus is contained while open, Escape closes when safe, and focus returns to the invoking control.
- Studio graph operations have list/form equivalents. Drag is never required.
- Character shortcuts are off by default or can be turned off/remapped and are active only on focus where allowed.
- Code/output scroll regions are focusable and named; arrow-key use does not unexpectedly trigger global shortcuts.

### Time limits, pause, and interruption — 2.2.x

**Approved Core Alpha target**

Core Alpha learning and authoring screens have no UI-imposed time limits. Runtime/check/provider timeouts report the operation failure without discarding learner input. Streaming or progress animation can be stopped by canceling the operation. No auto-refresh moves focus or replaces the active editor. Session resume is based on persisted state, not a countdown.

### Seizures and physical reactions — 2.3.x

**Approved Core Alpha target**

No flashing content, rapid high-contrast animation, or autoplay visual effects. Activity completion uses restrained state change, not confetti. The reduced-motion preference removes nonessential transforms and scrolling animation.

### Navigation, headings, focus, and location — 2.4.x

**Approved Core Alpha target**

- Skip links include Main; Studio additionally includes Outline, Editor/Preview, Inspector, and Validation where present.
- Page titles identify Course/screen/activity context.
- Focus order follows task order and does not traverse hidden panels.
- Link purpose is clear in context; repeated “Open” links include accessible Course/source names.
- More than one path is available to Courses/settings content through primary navigation and contextual links, except contained workflow steps.
- Headings and labels describe topic/purpose.
- Keyboard focus is always visible (2.4.7).
- Focused components are not entirely hidden by sticky headers, action bars, bottom navigation, or overlays, satisfying Focus Not Obscured (Minimum), 2.4.11 at Level AA.
- The utility-header breadcrumb is a labeled navigation landmark with an ordered list. Ancestors are links; the final item is non-link text with `aria-current="page"`. A session exposes `Courses › {Course} › {Lesson}` from resolved entities and never substitutes a false Home title while labels load.

**Approved Core Alpha target**

Although Focus Appearance (2.4.13) is Level AAA, Calm Workshop — Clear Slate uses a two-layer focus ring designed to be at least 2 CSS px equivalent and visibly contrasted across near-white and dark graphite surfaces as a product-quality goal.

### Pointer gestures, cancellation, labels, dragging, and target size — 2.5.x

**Approved Core Alpha target**

- Multipoint/path gestures have a single-pointer alternative. Graph pan/zoom never gates authoring.
- Actions fire on up/click and can be canceled or undone where appropriate; destructive operations require explicit confirmation.
- Visible control text is contained in the accessible name (“Publish immutable revision” is not named only “Submit”).
- Motion/device gestures are not required.
- Dragging Movements, 2.5.7 Level AA: reorder and graph relationships have Move up/down/before/after or selection-based alternatives.
- Target Size (Minimum), 2.5.8 Level AA: pointer targets meet at least 24×24 CSS px or the criterion’s spacing/exception rules. Aptiloop’s product target is 44×44 CSS px for primary mobile controls, icon buttons, radio/checkbox rows, and bottom-navigation items.
- Small inline source links may rely on line spacing only when the WCAG exception/spacing requirement is satisfied; frequently used actions receive full targets.

## Understandable

### Language — 3.1.1, 3.1.2

**Approved Core Alpha target**

- Root `lang` is `en-US` or `ru-RU` according to UI locale.
- Course content is wrapped with its declared primary/fallback locale independent of UI locale.
- Known language changes in quotations, source excerpts, code comments, and translated content use `lang` at the appropriate element/region.
- Product names, code, stable IDs, and technical terms do not require false language annotation.

### Predictable behavior and consistent help — 3.2.x

**Approved Core Alpha target**

- Focus or input does not trigger unexpected navigation, installation, validation, provider request, Apply, or Publish.
- Home/Courses/Review/Skills/Settings remain in the same relative order across the application.
- Controls with the same function use the same name, icon, and placement within comparable frames.
- **Create Course** consistently opens two unselected assisted choices—external-model instructions and the connected Course Designer—with a separate complete manual fallback. It never opens Settings or an existing Course editor. **Import Course Pack** consistently opens the separate Pack-selection/intake path.
- Contextual help and recovery routes appear consistently, satisfying Consistent Help (3.2.6) where applicable.
- Theme and locale may preview immediately only when the control explains the behavior; persistent save state remains explicit.

### Input assistance — 3.3.x

**Approved Core Alpha target**

- Errors identify the field and problem in text. Validation summaries link to exact fields/nodes.
- Labels and instructions appear before input; placeholder is never the only label.
- Course Pack import, delete, Apply, export, private-data transmission, and Publish explain scope and consequences before action.
- Consequential submission is reversible, checked, or confirmed under the applicable error-prevention criterion. Immutable Publish uses current saved Draft → current Validate → reviewed Preview of that validated Draft → Change review → consequence acknowledgement → explicit Publish.
- Redundant Entry (3.3.7): previously entered Course/revision/provider configuration is prefilled or selectable in the same process unless re-entry is essential or needed for security.
- Status errors do not clear drafts. A user can copy/export a local draft when safe recovery is needed.

### Accessible authentication — 3.3.8

**Approved Core Alpha target**

Aptiloop itself is local single-user and does not add a product login for Core Alpha. If an external provider authorization flow is launched, Aptiloop must not require a cognitive function test such as memorizing/transcribing a password without an allowed alternative or assist mechanism. Password managers, paste, and provider-native OAuth must not be blocked. Provider failure remains explicit; the app never asks the user to paste provider secrets into Course Pack or ordinary Studio fields.

## Robust

### Name, role, value and status messages — 4.1.2, 4.1.3

**Approved Core Alpha target**

- Custom controls expose correct name, role, state, value, disabled/read-only, expanded, selected, current, required, and invalid properties.
- Native controls are preferred over re-created widgets.
- Save, validation, import, check, review, AI proposal, export, and publish status are announced without taking focus when that is appropriate.
- Live regions announce meaningful operation boundaries once. They do not announce skeleton pulses, every model token, every test-output line, or repeated connectivity polling.
- Toasts are supplemental; persistent failure and consequential success are present in page context.

## Component and pattern requirements

### Navigation

**Approved Core Alpha target**

Desktop rail and mobile bottom navigation are landmarks with distinct labels if both ever coexist during a breakpoint transition. Active page uses `aria-current="page"`. The 280px/72px collapse control exposes its state with `aria-expanded`; collapsing preserves destination order and focus, while every icon-only destination keeps an accessible name and a dismissible, hoverable Radix tooltip. No custom hover label may overlap the content plane. Icons are decorative when visible text labels already name the destination. The utility-header breadcrumb follows the ordered ancestor/current-page pattern, and the final crumb exposes `aria-current="page"`.

### Sheets and dialogs

Sheets are for context/inspector/navigation; dialogs are for destructive or consequential confirmation. Each has a name, description where needed, close control, initial focus policy, contained focus, Escape behavior, and trigger-focus restoration. Publication confirmation is a dedicated review screen plus final confirmation, not a dense modal.

### Forms and structured editors

Labels, help, units, format examples, required state, and errors are associated. Repeater items have item headings and Remove/Move controls with target names. Raw JSON is not the primary editor. If a **Future** advanced JSON view is added, it requires a text alternative to syntax-only error markings, keyboard-safe editing, and exact line/path error navigation.

### ActivityFrame

Landmarks and headings follow [`activity-renderers.md`](activity-renderers.md). Focus transitions after start/save/complete are intentional. Sticky footer leaves scroll padding. Question groups use fieldset/legend. First-attempt state and protected answer boundary are clear.

### Code, diff, check output, and review

- Use semantic `pre`/`code` with language and context labels.
- Copy excludes line-number decoration.
- Wrap toggle has pressed state.
- Scroll region is named and keyboard accessible.
- Diff adds textual Added/Removed/Unchanged semantics and a unified reading order.
- Trusted-check result includes status text, check ID/purpose, freshness, and output truncation.
- Read-only review announces read-only state and provides no patch/apply action.

### Sources and external links

Source title and origin are meaningful. New-window behavior is announced when used. The accessible name distinguishes similarly titled sources. Missing snapshot/fallback locale states are text. Opening an external source is explicit and never required to complete an activity when the Pack is intended to be self-contained.

### Graph and outline

The outline is the accessibility baseline. Graph selection synchronizes without unexpected focus jumps. Nodes expose title, type, status, validation count, and prerequisite relationships. Edge creation/removal works through labeled selection controls. Zoom/pan does not hide the equivalent outline.

### Tables and Skills

Data tables use caption and row/column headers. On mobile, Skills uses topic detail and expandable dimensions rather than only horizontal table scroll. Numeric level includes descriptive accessible text. Sorting/filtering states are announced and keyboard operable.

### AI proposal and streaming

AI proposal is a structured diff with tool, target IDs, before/after, validation, provider/model disclosure, and Apply/Reject. The response is not inserted while streaming. Completion is announced once. Apply affects a draft only and focus moves to the changed-field summary. AI Off/unavailable has clear text and never activates Mock silently.

## Responsive and input matrix

**Approved Core Alpha target**

Every required screen is designed and verified at minimum for:

- 1440×900 desktop, pointer and keyboard;
- 1280×720 desktop/laptop at 100% and 200% zoom;
- 390×844 mobile portrait;
- 320 CSS px reflow;
- mobile landscape where keyboard may consume half the viewport;
- touch, keyboard-only, screen-reader keyboard, and speech-control label matching;
- light, dark, forced colors, reduced motion, and increased text spacing;
- `en-US`, `ru-RU`, and each screen with longer labels/content fallback.

No acceptance is inferred from “no horizontal overflow” alone; content density, sticky obstruction, tap targets, reading order, and task completion must also be reviewed.

## Assistive technology and manual verification plan

These are remaining manual acceptance activities. Existing automated and focused browser checks reduce regression risk but do not replace this matrix.

**Approved Core Alpha target**

- Chromium + NVDA on Windows: primary journeys, landmarks, headings, forms, live status, ActivityFrame, Studio outline/validation/proposal.
- Chromium keyboard-only: all journeys, focus visibility/not-obscured, sheets/dialogs, graph alternatives, drag alternatives, code scroll, bottom navigation.
- Browser zoom/reflow: 200% text and 320 CSS px; desktop/mobile sticky regions.
- Forced Colors Mode: navigation, focus, validation, activity state, graph, progress, diff, selected rows.
- Automated accessibility checks may catch structural regressions but never replace manual keyboard, screen-reader, zoom/reflow, and contrast review.
- Contrast is measured from rendered states in both themes, including hover/focus/selected/disabled and overlays.

### Journey sampling

1. Courses library → Create Course → external/connected assisted choice or manual fallback → cancel with no Draft, download with no Draft, or confirm exactly one explicit Draft.
2. Courses library → Import Course Pack → staged validate/Preview → install or open as Draft.
3. Home → resume lesson → verify `Courses › Course › Lesson` location on compatibility `/session?id=` → recall save error/retry → complete.
4. Code activity → copy/open workspace → run trusted checks → stale evidence → read-only review → changes requested.
5. Review → switch URL-backed Due/Mistakes/Cards/Interviews destinations → card approve/reject/export → interview setup/report limit; confirm Due exposes provenance without a false executor.
6. Skills → select topic → inspect dimensions and evidence timeline.
7. Settings → UI locale/theme → Core/storage/runtime state → AI Off and provider failure.
8. Studio → outline edit → validation finding → source/locale/environment → preview → proposal review → change review → publish.

## WCAG 2.2 additions explicitly covered

**Approved Core Alpha target**

| WCAG 2.2 criterion                        | Level | Aptiloop requirement                                                                                 |
| ----------------------------------------- | ----- | ---------------------------------------------------------------------------------------------------- |
| 2.4.11 Focus Not Obscured (Minimum)       | AA    | Sticky headers, action footers, bottom nav, sheets, and banners never entirely hide focused content. |
| 2.5.7 Dragging Movements                  | AA    | Every reorder/edge/drag operation has a non-drag alternative.                                        |
| 2.5.8 Target Size (Minimum)               | AA    | ≥24×24 CSS px or valid spacing/exception; 44×44 product target for primary mobile controls.          |
| 3.2.6 Consistent Help                     | A     | Help/recovery access stays in consistent relative locations.                                         |
| 3.3.7 Redundant Entry                     | A     | Reuse/prefill prior information in a process unless essential/security-related.                      |
| 3.3.8 Accessible Authentication (Minimum) | AA    | No unsupported cognitive test; allow paste/password managers/provider OAuth.                         |

Removed WCAG 2.0 criterion 4.1.1 Parsing is not used as a reason to lower engineering quality; valid semantic markup remains required for robust behavior.

## Exceptions and blocking policy

**Approved Core Alpha target**

Any WCAG exception must be documented per component and scenario with criterion, reason, scope, alternative, owner, and approval. “Third-party component,” “developer tool,” “mobile is secondary,” “dark mode,” or “screen-reader users will not use Studio” is not an acceptable blanket exception.

An unresolved Level A/AA blocker in a required Core Alpha journey blocks accessibility approval. A provider or external editor limitation does not excuse an inaccessible Aptiloop fallback/handoff.

## Explicit non-goals

**Future**

- Formal legal certification or a public conformance claim from this internal specification alone.
- Multi-user accessibility roles/preferences syncing.
- Speech-to-text, text-to-speech tutoring, or cognitive personalization beyond platform/accessibility preferences.
- Accessibility of external provider/editor/source interfaces beyond Aptiloop’s own handoff.

## Accessibility acceptance gate

**Approved Core Alpha target**

The UI has implemented semantics and focused regression evidence, but the accessibility gate remains open until the complete required scope has reviewed evidence for applicable WCAG 2.2 A/AA criteria, keyboard, screen reader, zoom/reflow, contrast, forced colors, reduced motion, desktop/mobile, light/dark, `en-US`/`ru-RU`, mixed Course locales, and representative capability/error states. This document is a target and verification plan, not a formal conformance statement or certification.
