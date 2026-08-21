# Aptiloop Core Alpha Design Specification

## Document status

This is the current visual and interaction specification for Aptiloop Core Alpha.

- **Implemented baseline** — behavior observed in the current repository or direct browser evidence.
- **Approved Core Alpha target** — required Core Alpha behavior; it is not an implementation claim.
- **Proposed pending owner approval** — a recommendation that requires an explicit owner decision.
- **Future** — outside Core Alpha.

The product behavior and information architecture remain governed by `PRODUCT.md`, `ARCHITECTURE.md`, and the supporting specifications:

- [`docs/design/information-architecture.md`](docs/design/information-architecture.md)
- [`docs/design/adaptive-studio.md`](docs/design/adaptive-studio.md)
- [`docs/design/activity-renderers.md`](docs/design/activity-renderers.md)
- [`docs/design/accessibility.md`](docs/design/accessibility.md)

## Design direction: Calm Workshop — Clear Slate

**Approved Core Alpha target**

Aptiloop is a quiet local learning workbench: deliberate, tactile, trustworthy, and technically precise. “Clear Slate” removes the rejected ambient green cast from the interface foundation without weakening contrast, provenance, validation, or error visibility. Light mode uses near-white cool neutrals; dark mode uses low-chroma cool graphite. Restrained evergreen appears only for primary action, progress, success, and focus.

This is an independent Aptiloop system. It is not a dashboard template, project-management composition, KPI surface, image-led layout, or collection of interchangeable rounded cards.

The product signal is produced by five recurring motifs:

1. **Focus field** — one larger, lightly elevated surface for the next learning or authoring action.
2. **Evidence rail** — compact supporting values always paired with labels and provenance-oriented copy.
3. **Soft list** — related entities share one open surface with spacing and subtle separators instead of independent boxes.
4. **Green focus trace** — next action, progress, success, and keyboard focus use restrained evergreen on otherwise neutral surfaces. Every state also has text or an icon, never color alone.
5. **Circular utility control** — theme, disclosure, compact navigation, and contextual controls use optically balanced circular or softly squared icon buttons.

## Experience principles

**Approved Core Alpha target**

- One primary action per surface. Secondary actions remain visible but quieter.
- Large values summarize persisted facts; they never imply invented mastery or model certainty.
- Supporting labels are concise, sentence case by default, and never decorative filler.
- Containers exist only for a coherent entity, action, or state. Cards are not nested.
- Borders are low-emphasis boundaries. Surface contrast, whitespace, and elevation carry most hierarchy.
- Errors, missing runtimes, no-AI mode, offline state, validation blockers, and provenance remain explicit.
- AI output is visually subordinate to deterministic state and is always attributed.
- Published revisions, source lineage, local adaptation, and protected-answer boundaries remain legible.
- Light and dark themes preserve the same hierarchy and semantics.
- Motion clarifies state changes only; reduced motion removes nonessential transitions.

## Pattern research and Aptiloop adaptation

**Approved Core Alpha target**

External patterns inform interaction anatomy, not Aptiloop composition or product scope:

- [shadcn Sidebar](https://ui.shadcn.com/docs/components/radix/sidebar) separates identity, scrollable navigation, and rail responsibilities. Aptiloop keeps brand identity distinct from collapse, theme, provider, and page utilities; it does not copy the sample workspace switcher, avatar, teams, or account menu.
- [Microsoft NavigationView](https://learn.microsoft.com/en-us/windows/apps/develop/ui/controls/navigationview) distinguishes main items, footer navigation items, and free-form pane footer content. Aptiloop uses the distinction to keep Settings and local status out of the main learning group while preserving one coherent navigation model.
- [W3C navigation landmark guidance](https://www.w3.org/WAI/ARIA/apg/patterns/landmarks/examples/navigation.html) requires named landmarks when multiple navigation regions exist. Desktop rail and mobile bottom navigation therefore retain explicit accessible names and current-page state.
- [GOV.UK radio guidance](https://design-system.service.gov.uk/components/radios/) informs the exclusive assisted-start choice: semantic controls, no preselection, one clear question, and a separately visible manual fallback. [Complete multiple tasks](https://design-system.service.gov.uk/patterns/complete-multiple-tasks/) informs Studio's verb-led gates and explicit statuses, not a generic checklist skin.
- [shadcn Input Group](https://ui.shadcn.com/docs/components/radix/input-group) and [AI Elements Prompt Input](https://elements.ai-sdk.dev/components/prompt-input) inform the chat composer's textarea/body/footer anatomy. Aptiloop omits attachments, microphone, web search, screenshots, and client model switching because those authorities are not in the product contract.
- [Carbon for AI](https://carbondesignsystem.com/guidelines/carbon-for-ai/) informs explicit identification and explainability of AI-generated proposals. Aptiloop retains its own semantic tokens and avoids Carbon's AI glow/gradient styling because Calm Workshop prohibits decorative AI effects.

## Implemented seams to preserve

**Implemented baseline**

- Next.js App Router presentation remains in `apps/web`.
- Geist Sans and Geist Mono are locally supplied by the installed `geist` package.
- `apps/web/app/globals.css` owns the semantic OKLCH light/dark foundation.
- Existing shadcn/Radix source primitives remain the component toolkit.
- `AppShell`, `PageHeader`, query states, `ActivityFrame`, the closed renderer registry, Adaptive Studio, and provider connection management are implemented seams.
- Primary navigation remains Home, Courses, Review, Skills, and Settings.
- UI locale remains independent from Course locale and supports `en-US` and `ru-RU`.
- Course library search/filter/page, Review destination, Studio workspace tab, Chat role, and staged-intake confirmation use separate URL contracts. Pack intake recovery is limited to the same orchestrator process and the validation expiry window; a Core restart requires file reselection and validation.
- Browser requests retain the existing typed API and domain contracts; redesign does not move database, provider, filesystem, Git, or process authority into the browser.

## Visual system

### Color roles

**Approved Core Alpha target**

All interface color uses semantic OKLCH variables. Component-only raw palette classes are prohibited. The neutral axis uses cool graphite rather than green-tinted neutrals. Restrained evergreen is reserved for primary action, progress, success, and focus. Warning, destructive, and activity-family roles stay independent. Activity color never overpowers readiness or evidence.

| Role             | Light                    | Dark                     | Use                            |
| ---------------- | ------------------------ | ------------------------ | ------------------------------ |
| background       | `oklch(0.994 0.001 260)` | `oklch(0.140 0.006 260)` | App field                      |
| foreground       | `oklch(0.205 0.009 260)` | `oklch(0.945 0.005 260)` | Primary text                   |
| surface-soft     | `oklch(0.965 0.004 260)` | `oklch(0.175 0.007 260)` | Recessed bands and quiet wells |
| surface          | `oklch(1.000 0.000 000)` | `oklch(0.180 0.008 260)` | Standard content surface       |
| surface-raised   | `oklch(1.000 0.000 000)` | `oklch(0.205 0.009 260)` | Focus field, popovers          |
| sidebar          | `oklch(0.982 0.002 260)` | `oklch(0.155 0.006 260)` | Navigation rail                |
| muted text       | `oklch(0.455 0.011 260)` | `oklch(0.720 0.012 260)` | Supporting copy                |
| border           | `oklch(0.895 0.006 260)` | `oklch(0.285 0.010 260)` | Low-emphasis boundary          |
| control boundary | `oklch(0.664 0.009 260)` | `oklch(0.490 0.012 260)` | Inputs and selected boundaries |
| primary          | `oklch(0.500 0.130 151)` | `oklch(0.720 0.130 151)` | Next action and progress       |
| primary hover    | `oklch(0.445 0.130 151)` | `oklch(0.770 0.125 151)` | Hover/pressed action           |
| focus ring       | `oklch(0.500 0.130 151)` | `oklch(0.720 0.130 151)` | Visible keyboard focus         |
| success          | `oklch(0.510 0.120 152)` | `oklch(0.720 0.110 152)` | Positive and completed state   |
| destructive      | `oklch(0.535 0.185 027)` | `oklch(0.700 0.160 027)` | Error and destructive action   |
| warning          | `oklch(0.875 0.070 078)` | `oklch(0.350 0.065 078)` | Warning field                  |

Normal text must reach WCAG 2.2 AA contrast. Large text and graphical/control boundaries must reach at least 3:1. Softer hierarchy is never achieved by lowering essential text contrast.

### Surface hierarchy and elevation

**Approved Core Alpha target**

- App background: near-white cool neutral in light mode and low-chroma graphite in dark mode, uninterrupted behind primary content.
- Recessed surface: sidebar, mobile navigation, tab tracks, code/output wells.
- Standard surface: related content group or form section.
- Raised surface: the one current focus action, overlay, or sticky content crossing another surface.
- Focus shadow, light: `0 1px 2px oklch(0.20 0.012 255 / 0.06), 0 18px 48px oklch(0.20 0.012 255 / 0.08)`.
- Focus shadow, dark: `0 1px 2px oklch(0.03 0.006 255 / 0.28), 0 18px 48px oklch(0.03 0.006 255 / 0.22)`.
- Standard surfaces use either a subtle border or a low shadow, not both at full strength.
- No glow, glassmorphism, animated gradient, or decorative blur field.

### Shape

**Approved Core Alpha target**

- Controls, standard panels, entity rows, and primary focus fields use an 8px radius.
- Large temporary overlays may use a larger radius only when their component anatomy requires it.
- Progress tracks and true state indicators may be fully rounded.
- Icon controls are circular where the control is a single familiar action.
- Nested containers use visibly smaller radii or no radius; equal-radius nesting is prohibited.

### Spacing and density

**Approved Core Alpha target**

A 4px base produces steps `4, 8, 12, 16, 20, 24, 32, 40, 48, 64`.

- Page section rhythm: 24px by default and 32px only between distinct workflow regions.
- Page header to first region: 20–24px.
- Standard surface padding: 20px mobile, 24px desktop.
- Focus field padding: 24px mobile, 32px desktop.
- Related list rows: 16–20px vertical.
- Controls keep a 44px minimum touch target on mobile.
- Dense Studio lists may use 36–40px controls only at desktop widths with equivalent keyboard focus and accessible names.

### Typography

**Approved Core Alpha target**

- UI, authored prose, and labels: Geist Sans.
- Code, paths, stable IDs, hashes, versions, provider/model IDs, checks, and compact technical evidence: Geist Mono.
- Page title: 32/37 mobile and about 38/43 desktop, weight 650, tracking `-0.03em`.
- Focus value/title: 24–30/32–38, weight 620–650.
- Section title: 18–20/26–28, weight 600.
- Activity title: 22/30, weight 620.
- Body/prose: 15/24, weight 400, 64–72ch reading measure.
- UI/control: 14/20, weight 500 when interactive.
- Supporting label: 12/18, weight 550, modest tracking; uppercase only for rare workflow orientation labels.
- Technical caption: 12/18 Geist Mono; never below 12px for essential content.
- English and Russian share the scale. Controls allow at least 30% label expansion.

### Icons

**Approved Core Alpha target**

Phosphor remains the single icon family. Navigation uses regular weight and selected navigation may use filled weight. Status icons use an icon plus readable state text. Utility controls use 18–20px icons inside 36–44px targets. Decorative icons are omitted.

### Interaction and motion

**Approved Core Alpha target**

- Hover changes surface or text emphasis, never layout.
- Pressed state slightly deepens the hover treatment.
- Focus uses a 2px semantic ring with a 2px offset against the current surface.
- Selected state uses the cool-neutral accent surface plus weight, marker, or `aria-current`; color alone is insufficient.
- Disabled actions remain legible and retain nearby explanation.
- State transitions use 140–180ms ease-out.
- `prefers-reduced-motion: reduce` removes nonessential duration, scrolling, and transforms.

## Component families

### App Shell

**Approved Core Alpha target**

Desktop uses one stable navigation rail: 248px expanded and 72px collapsed, matching the 72px utility-header height. Expanding or collapsing changes only the rail width; icon centers, 48px row heights, navigation order, and focus order remain stable. Expanded mode shows the Aptiloop mark and wordmark; collapsed mode retains the mark as identity in the same 72px rail and never adds a second strip. Collapsed destinations use centered square hit fields, accessible names, and Radix tooltips; they never render custom labels over page content.

Home, Courses, Review, and Skills stay in the upper navigation; Settings is the final item in the lower group. The rail footer contains no AI/provider badge, theme switch, or ambiguous local-status pill. Active navigation uses the cool-neutral accent surface, stronger text/icon treatment, and `aria-current`, not a green block.

The opaque 72px utility header owns shell collapse, location, and two global utilities. The icon-only collapse/expand control appears immediately before the labeled breadcrumb; coherent 44px outlined AI and theme controls are right-aligned. Interface locale is changed only in Settings so it is not duplicated in global chrome, while the header theme control and Settings theme selector use the same immediate browser-local preference. Provider detail and recovery remain in Settings or the affected workflow. The brand stack and sidebar footer never duplicate these utilities. `/courses/*`, compatibility `/session?id=`, exercise, and lesson-linked interview routes keep Courses active; Home is active only for Home.

**Implemented baseline** — Core Alpha remains local-first and single-user. It must not render a fake account, avatar, login, disabled account placeholder, or authentication affordance.

**Future** — if an owner-approved account capability is introduced after Core Alpha, its profile/account entry belongs at the bottom of the desktop rail and in one equivalent mobile account menu; it does not replace local privacy or runtime status.

**Approved Core Alpha target**

Main content and the utility header use the full post-rail canvas with shared 16px mobile and 24px desktop gutters. Readability limits belong to prose and focused forms, not to the shell itself.

Mobile uses one 64–72px sticky header and one five-destination bottom bar. Labels remain visible in both locales. Safe-area padding, 320px reflow, and no second navigation row are mandatory.

### Page Header

**Approved Core Alpha target**

The page header is open, without a full-width hard divider. It contains one compact responsive title, a readable 16px one- or two-line description, and optional right-aligned 44px page actions. It never repeats the utility header breadcrumb or renders a false top-level title for a nested route. On mobile, actions wrap below content without clipping.

### Buttons and controls

**Approved Core Alpha target**

- Primary: restrained evergreen fill, compact shadow, high-contrast label.
- Secondary: quiet neutral surface.
- Outline: strong control boundary on the current surface.
- Ghost: circular or softly squared utility action.
- Destructive: explicit red role, reserved for actual destructive consequences.
- Loading: spinner, stable width where practical, disabled duplicate submission.

### Progress

**Approved Core Alpha target**

Progress uses one continuous quiet track and restrained evergreen indicator. It is paired with exact completed/total text. Course progress, phase progress, and skill dimensions must not be combined into an invented overall score.

### Empty, error, offline, and no-AI states

**Approved Core Alpha target**

Empty states are compact open surfaces with reason and next action. Errors use a quiet destructive field, explicit failing layer, preserved input, and recovery action. Transient operation feedback that needs no in-page correction uses the localized global toast region and does not survive navigation; validation errors, uncertain commits, and failures requiring action remain in context. Browser offline, Core unavailable, storage failure, missing local runtime, and AI unavailable remain distinct. AI Off is calm and normal; it is not presented as an error and manual paths remain complete.

## Screen specifications

### Screen purpose contract

**Approved Core Alpha target**

Every route answers one primary user question and exposes one primary next action. Secondary tools remain reachable without competing with that action.

| Surface                 | Primary question                                                                   | Primary action                                                                                          |
| ----------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Home                    | What should I learn next in my explicitly current Course?                          | Start or resume the deterministic next activity.                                                        |
| Courses library         | Which installed Course/revision should I open or make current?                     | Open or select one Course; Create and Import are separate routes.                                       |
| Create Course           | Which assisted start fits this Course, or should I continue manually without AI?   | Choose external-model instructions or the connected Designer; use the manual fallback when preferred.   |
| Import Course Pack      | Is this existing declarative Pack safe and suitable to install or open as a Draft? | Choose a Pack, validate it, then enter staged Preview and confirmation.                                 |
| Review                  | Which due, mistake, card, or interview evidence needs attention?                   | Inspect the selected URL-backed destination and take only an available typed action.                    |
| Skills                  | What has persisted evidence, and where is it weak or due?                          | Inspect one topic's evidence-backed dimensions.                                                         |
| Session / ActivityFrame | Where am I in this lesson, and what must I do now?                                 | Complete the current authored activity.                                                                 |
| Exercise                | What trusted attempt/check/review state exists?                                    | Edit or run the next permitted attempt action.                                                          |
| Interview               | What question/progress/report state exists?                                        | Start, answer, resume, or finish the current interview step.                                            |
| Adaptive Studio         | Which explicit Draft/revision is open, and what authoring gate is next?            | Edit, review a proposal, Apply, Validate, Preview, inspect Changes, or Publish as separately permitted. |
| Settings / Connections  | Which local interface, Core, runtime, or optional AI setting needs attention?      | Save or recover one named layer.                                                                        |
| Agent chat              | Which bounded Aptiloop role/provider context am I using?                           | Send or stop one disclosed message; chat remains a secondary tool.                                      |
| Developer tools         | Which local diagnostic layer is failing?                                           | Run or recover one diagnostic action; this is never primary navigation.                                 |

Home and Courses share one invariant: the current Course is a persisted explicit selection owned by the application. The UI must never silently reinterpret “current” as the first installed Course, most recently rendered card, or last route visited. When several Courses exist, Home stays focused on the current one and provides a clear route to Courses for switching.

### Home

**Approved Core Alpha target**

Home is an editorial learning surface for the explicitly current Course, not a dashboard or recent-items feed.

1. Current Course header: persisted Course/revision identity, concise description, and a quiet **Change Course** route to Courses when another selection is needed.
2. Primary focus field: deterministic next lesson/activity, expected or remaining time, exact Course/phase progress, and one Start/Resume action.
3. Learning signals: review queue and evidence basis appear as compact supporting regions only when facts are available. Loading/error/empty states remain honest and do not block the primary Course path.
4. Phase path: Understand, Demonstrate, and Practice/Review share one soft list with exact counts and readable ready/locked/completed states.
5. Upcoming lessons: an open list for the current Course, not a metric grid.

With no current Course, Home explains that state and offers Select Course, Create Course, and Import Course Pack routes according to available actions. It never invents a current Course from list order. No streak, generic productivity score, model-generated motivation, fabricated mastery percentage, or ungrounded “recent Course” strip is permitted.

### Courses

**Approved Core Alpha target**

Courses is a set of route-owned surfaces, not one mixed page:

1. `/courses` is the local library. It shows a soft entity list with current selection, immutable revision state, stable identity/hash, personal-branch context, and explicit Open/Export/Remove actions. Its page actions link to **Create Course** and **Import Course Pack**; it contains no editor and no inline file importer.
2. `/courses/new` presents one unselected exclusive choice between **Use an external model** and **Use the connected Course Designer**. **Create manually without AI** is a quieter complete fallback. `/courses/new/external`, `/courses/new/guided`, and `/courses/new/manual` own those paths and never open the current, first, or recently viewed Course.
3. External authoring downloads a self-contained, commit-pinned instruction and creates no local Draft until the user later chooses Open as Draft. It guides the chosen model through Discovery, optional Diagnostic, Course Proposal, and explicit approval before compiling a hashless Authoring Draft. Guided and manual confirmation each create exactly one explicit local Draft; provider transmission, proposal Apply, deterministic Validation/Repair, learner-safe Preview, Changes, and Publish remain separate operations. Studio requires the returned revision authority and fails back to Courses when it is missing or invalid.
4. `/courses/import` alone selects an existing declarative Course Pack. Validation creates a server-owned staged intake operation at `/courses/intake/{operationId}`; its Preview leads to explicit **Install immutable revision** or **Open as local Draft**. File selection, validation, Preview, and commit remain separate states, and Studio never owns uncommitted Pack bytes.

The connected Designer and manual path converge on the same typed local Draft. The external path converges only after its untrusted Pack passes local intake. Import remains acquisition, not creation. Entity breadcrumbs identify the actual Course, revision, lesson, or intake operation; ancestors are links and the final crumb is plain current-page text.

### Review

**Implemented baseline**

Review exposes exactly **Due**, **Mistakes**, **Cards**, and **Interviews**. Desktop uses a semantic tab list; compact layouts use one labeled select. The selected destination is encoded in `?view=` except canonical Due, while `?item=` identifies one opaque server-owned Review execution, so Back, Forward, and reload preserve intent without exposing source-session authority. Due work explains schedule and source provenance. Executable items open the shared Activity Frame with authored immutable prompt content, bounded free response, visible loading/error/retry states, and a localized completion result; unsupported or stale identities fail closed. Empty review is positive but neutral, and repeated mistakes use text and icon in addition to color.

### Skills

**Approved Core Alpha target**

Skills is an evidence-backed topic index. Topic groups use open surfaces with a prominent topic name, evidence count/date context, review-due text, and separate dimension rows. Each dimension has exact numeric value and a continuous progress track. There is no invented single overall score, and unvalidated interview observations never become mastery.

### Learning Session and ActivityFrame

**Implemented baseline**

The lesson surface is an immersive, container-aware workspace with an open ActivityFrame canvas capped near 64rem and a quieter 22–24rem desktop plan rail. The sticky orientation and activity use the same canvas edges. Below the rail threshold, the same semantic plan opens in the accessible sheet. Surface contrast and spacing replace repeated rules, and presentation never infers readiness or changes `currentStep`, evidence, completion, or kernel ownership. [`docs/design/activity-renderers.md`](docs/design/activity-renderers.md) owns the detailed rail, sheet, activity-layer, focus, and state contract.

**Approved Core Alpha target**

The utility-header breadcrumb resolves `Courses › {Course} › {Lesson}` for the target lesson route and the compatibility `/session?id=` route. Courses remains the active primary destination; the shell never reports Home merely because the compatibility URL is top-level. While entity labels load, the breadcrumb shows an honest loading label rather than falling back to Home. The session header is sticky only when it materially preserves orientation below the App Shell. It adds phase/activity position, remaining estimate, Plan, and Continue later without repeating the shell breadcrumb or page title; one continuous progress track closes the header.

Ready, transition, and in-progress activity content uses a 52–56rem focus region on desktop, centered within the page but not trapped in a small card surrounded by empty space. On mobile it becomes one edge-safe column. The ready state visually connects lesson context, activity purpose, and the single Start action.

`ActivityFrame` uses five distinguishable layers:

1. context and readiness;
2. prompt or authored learning content;
3. learner input;
4. runtime/output and evidence;
5. help and actions.

These layers use surface contrast and spacing before borders. Learner input remains before protected feedback or strong hints. Evidence and model commentary are labeled separately. Code blocks and output wells use Geist Mono, recessed surfaces, horizontal containment, and readable line height. Correction/resume preserves input and exact state. Activity type color is a supporting trace, not the main container fill.

### Adaptive Studio

**Approved Core Alpha target**

Studio is 70% editorial workspace and 30% developer instrument. Existing forms, finite graph, proposal state machine, validation, Preview, change review, and publish contracts remain.

- Course creation remains outside Studio. The entry surface offers two unselected assisted choices—external-model instructions and the connected Course Designer—plus a complete manual fallback.
- External download creates no Draft. Guided/manual confirmation creates the explicit Draft before Studio opens; provider transmission and proposal Apply remain separate. Manual authoring is complete with AI Off.

- Current Course and personal adaptation use separate lineage surfaces.
- Complex forms group related fields in standard surfaces with lower-emphasis borders and clear section titles.
- Outline rows use spacing, indentation, and restrained separators.
- Proposal review uses before/after and provenance in a recessed diff field.
- Apply mutates only the selected Draft. Validate, digest-bound learner Preview, Changes, and Publish are separate later gates; Publish remains an independent consequential action.
- Apply, Validate, Preview, Changes, and Publish never share the same visual emphasis or wording.
- Mobile supports bounded review and field edits; wide diff/graph operations may identify desktop-only limitations without losing state.

### Settings and Connections

**Implemented baseline**

Settings uses four calm sections: Interface, AI roles, Connections, and Core & local paths, with developer diagnostics contained in the local section. Theme and UI locale expose their exact current values, apply immediately from browser-local preference state, and do not require Aptiloop Core or a database save. The utility-header theme control and Settings theme selector stay synchronized through the same theme provider.

**Approved Core Alpha target**

Settings preserves those four responsibilities without turning the page into one long form. Local paths and IDs use mono and wrap safely. Server-owned role, connection, and runtime mutations retain adjacent save, validation, and recovery state; browser-local Interface preferences do not borrow those server save semantics.

Connection rows show display name, provider kind, locality, model observation count, and readable health state. Credential secrets are never rendered. Errors identify authentication, model, capability, provider, or disclosure layer and show only safe recovery actions. Add connection is primary within Connections, not for the whole Settings page. AI role assignment remains server-owned and visibly separate from connection authentication.

### Chat and conversational input

**Approved Core Alpha target**

Agent chat and interview dialogue use the same conversational grammar while retaining their different authority and state contracts. A transcript is an open reading surface with restrained role attribution, a readable 64–72ch message measure, explicit streaming/error states, and a scroll-to-latest control that does not cover content.

The composer follows the current shadcn Input Group and AI Prompt Input composition principles without importing unsupported product behavior: one tactile 18px surface contains a multiline textarea body and a block-end footer. The footer shows only real Aptiloop context such as role/provider/model or interview state on the left and one real Send, Stop, or Retry action on the right. Enter submits, Shift+Enter inserts a line break, and the action retains an accessible name and mobile touch target.

Attachments, screenshots, web search, speech input, microphone controls, and browser-side model switching are omitted until a separately approved contract exists. No inert icon may suggest unavailable authority. AI Off and provider-unavailable states remain calm, explicit, and recoverable through the existing Settings path. Disclosure approval remains a separate explicit dialog before any named payload leaves the local application.

## Responsive contract

**Approved Core Alpha target**

- Desktop reference: 1440×900; persistent rail; two-column focus regions only where reading order remains obvious.
- Mobile reference: 390×844; single content column; bottom navigation; actions wrap or become full-width without reordering consequence.
- Minimum width: 320 CSS px; no horizontal page overflow.
- Technical values may wrap or use a contained horizontal scroller; the page itself must not scroll horizontally.
- 200% zoom, long Russian labels, browser text enlargement, safe-area insets, and virtual keyboard obstruction are design inputs.

## Accessibility contract

**Approved Core Alpha target**

- Semantic landmarks, one page-level heading, nested section headings, labels, descriptions, and live regions remain correct.
- All workflows are keyboard-operable; focus order follows the visual and reading order.
- Focus is always visible and never clipped by overflow containers.
- Touch targets are at least 44×44px on mobile.
- State is never encoded by color alone.
- Dialogs/sheets have titles, initial focus, Escape behavior, and focus return.
- Progress has an accessible name plus current/max values.
- Reduced motion, light/dark/system, and high-contrast/forced-color behavior retain information.
- `en-US` and `ru-RU` accessibility names and labels have functional parity.

## Verification requirements

**Approved Core Alpha target**

Automated component, integration, and E2E checks cover selected semantics, state contracts, localization, and reduced-motion behavior. Focused browser checks separately cover the exercised shell, navigation, breadcrumbs, route separation, themes, and responsive viewports. Neither evidence set verifies every 320px reflow path or constitutes complete visual or WCAG 2.2 AA certification. Acceptance still requires systematic 320px reflow, 200% zoom, forced-colors, assistive-technology, keyboard, contrast, and error-state sampling as defined in [`docs/design/accessibility.md`](docs/design/accessibility.md).

Repository quality gates remain separate proof from visual evidence. Design completion does not imply legal, licensing, content, trademark, distribution, or release acceptance.

## Implemented design evidence boundary

**Implemented baseline**

The current repository implements the Clear Slate token foundation, localized shell, closed ActivityFrame registry, Course creation/intake route separation, Review destinations, Studio gates, and responsive navigation described above. Individual component and browser checks prove only the exercised paths and states; target conformance and release acceptance remain separate gates.
