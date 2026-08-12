# Design system

## Status and direction

- **Implemented baseline** — repository seams that exist; this label is not visual acceptance evidence.
- **Approved Core Alpha target** — required Core Alpha presentation and interaction behavior.
- **Proposed pending owner approval** — an unresolved recommendation.
- **Future** — outside Core Alpha.

Calm Workshop — Clear Slate is the approved and implemented visual direction. Aptiloop is a quiet, precise learning workbench rather than a game, generic dashboard, chat clone, or IDE. The visual foundation is near-white cool neutral in light mode and low-chroma cool graphite in dark mode. Restrained evergreen is semantic emphasis, not an ambient surface tint.

## Semantic themes and tokens

**Implemented baseline**

`apps/web/app/globals.css` owns semantic OKLCH variables for both themes and maps them to Tailwind roles. Existing components consume roles such as `bg-card`, `text-muted-foreground`, and `ring-ring` instead of raw palette values.

**Implemented baseline**

The exact canonical values and contrast intent are in [`../DESIGN.md`](../DESIGN.md#color-roles). `apps/web/app/globals.css` implements these token families:

- neutral foundation: `background`, `foreground`, `card`, `popover`, `surface-raised`, `surface-soft`, `sidebar`, `secondary`, `muted`, `accent`, `border`, `input`, and `overlay`;
- primary interaction: `primary`, `primary-hover`, `primary-foreground`, and `ring`;
- feedback: `success`, `warning`, and `destructive`, each with an explicit foreground role;
- activity accents and paired surfaces: `theory`, `study`, `recall`, `teacher`, `quiz`, `code-reading`, `practice`, `review`, `interview`, `summary`, and `ai`.

`surface-soft` is the canonical recessed-band, quiet-well, query-state, and secondary-group surface. It replaces the obsolete `surface-subtle` name; documentation and components must not introduce a parallel alias. Cool-neutral surfaces never inherit the evergreen hue. Evergreen is reserved for primary action, success, progress, and focus. Warning, destructive, selection, and activity families retain independent roles. Activity color supplements a label, icon, border/marker, and state text; it is never the only distinction.

`ThemeProvider` retains `system | light | dark`, defaults to system, applies `color-scheme`, and suppresses transition noise during theme changes. Theme changes apply and persist immediately through the shared browser-local `next-themes` state. Settings keeps UI-locale selection as an allowlisted browser-session draft until explicit Save or Cancel, preserving it across section changes, route exits, and reloads without applying it. Cancel restores the active locale; Save and Cancel clear the draft. Saving the locale uses browser-local persistence only and never requires Core or a database write. `prefers-reduced-motion` globally reduces nonessential animation, scrolling, and transforms.

## Layout and navigation

**Implemented baseline**

- Primary destinations are exactly Home, Courses, Review, Skills, and Settings.
- The desktop rail is exactly 248px expanded and 72px collapsed. The collapsed width equals the utility-header height. Icon centers, 48px row heights, navigation order, and focus order remain stable between states; collapsed destinations use square hit fields and Radix tooltips and never render overlay labels into the content plane.
- Expanded mode shows the neutral mark and wordmark; collapsed mode retains the centered mark in the same 72px rail. The icon-only collapse/expand control is in the utility header immediately before the breadcrumb, not in the brand row or a second strip. The browser-local collapse preference is restored before the interactive shell paints; rail geometry, labels, and transitions remain prepaint-controlled through hydration so cookie/local-storage reconciliation does not flash the wrong composition.
- Home, Courses, Review, and Skills occupy the upper navigation; Settings is the final lower navigation item. The footer contains no AI/provider badge, theme switch, or ambiguous status pill.
- The opaque 72px utility header contains the collapse/expand control and labeled breadcrumb on the left and coherent 44px outlined AI and theme controls on the right. Interface locale is changed only in Settings. Provider recovery remains in Settings or the affected workflow.
- The shared header and main content use the full post-rail canvas with the same 16px mobile and 24px desktop gutters; prose and focused forms own their own readability limits.
- The separate page header owns a compact responsive title, 16px description, and 44px page actions. It does not repeat the breadcrumb or substitute a top-level title for nested routes.
- `/courses/*`, compatibility `/session?id=`, exercise, and lesson-linked interview contexts keep Courses active. Home is active only for Home.
- Mobile uses one compact top context bar and one five-item bottom navigation with visible labels and safe-area padding. It has no second navigation row or squeezed desktop rail.
- Reading surfaces use a 64–72ch measure; lists and Studio may use the available content width. Complete usable reflow at 320 CSS px remains an **Approved Core Alpha target** beyond the focused responsive paths already exercised.

## Route-owned composition

**Implemented baseline**

The design system owns reusable composition, not route semantics. The canonical route, query-state, breadcrumb, Course creation/intake, Review destination, and Studio ownership rules live in [`design/information-architecture.md`](design/information-architecture.md). Components must preserve those rules without duplicating them in local variants.

## Component catalog

### AppShell, utility header, and PageHeader

**Implemented baseline**

`AppShell` owns the 248px/72px rail, pre-hydration collapse restoration, collapsed tooltips, five-item mobile bottom navigation, utility header, privacy-safe route title, entity breadcrumb slot, route-to-primary-destination mapping, skip link, and main landmark. `PageHeader` owns only route title, description, and page actions. Neither owns lesson progression.

### Breadcrumb

**Implemented baseline**

The breadcrumb is a labeled navigation landmark with an ordered list. Ancestors are links; the final item is non-link text with `aria-current="page"`. Entity-backed labels use an honest loading state and never fall back to a false Home location.

### Tabs and compact destination selection

**Implemented baseline**

Desktop destination tabs use the shared Radix Tabs primitive with visible focus and selected semantics. Compact layouts may replace the same destination set with one labeled Select when all options and the current value remain available. Meaningful destination state belongs in the URL—for example Review's `?view=`—so Back, Forward, reload, and copied local links preserve intent.

### Textarea and InterviewChatView

**Implemented baseline**

`apps/web/components/ui/textarea.tsx` is the multiline input primitive. `apps/web/components/interview-chat-view.tsx` composes the transcript and composer, preserves Enter/Shift+Enter behavior, and limits live status to one meaningful operation boundary at a time.

### DayPlan rail and sheet

**Implemented baseline**

`apps/web/components/day-plan.tsx` presents one semantic lesson plan as a substantial, independently scrolling desktop rail when the lesson container has enough width and as a full-height Sheet below that threshold. The trigger belongs to lesson orientation, not the global utility header. Current, completed, and locked text, phase structure, and `aria-current` remain equivalent in both compositions.

### LoadingState and stable skeletons

**Implemented baseline**

The shared localized `LoadingState` is the default for route and query boundaries whose eventual geometry is not yet known. Page loading is open and transparent; panel loading may retain one quiet `surface-soft` frame. Skeletons are limited to bounded regions whose approximate shape is stable; they do not invent a page structure or announce each pulse. Both patterns expose one concise status through the owning region.

### Sheet, Popover, and toast feedback

**Approved Core Alpha target**

Sheet is for plan, context, inspector, and bounded mobile navigation. Popover may disclose compact utility detail, including provider context, but provider state is never placed in the rail footer or presented as a global KPI. Toast feedback may acknowledge transient success, background completion, or a recoverable operation; validation errors, destructive consequences, uncertain commits, and failures requiring action remain in page context with preserved input and recovery.

## Component rules

**Approved Core Alpha target**

- Primary mobile controls and icon buttons have at least a 44px target.
- Buttons, inputs, badges, progress, loading states, bounded skeletons, sheets, dialogs, and toasts use shared semantic primitives.
- Loading exposes `role="status"` or `aria-busy`; errors identify the failing layer and a recovery action; empty states explain what creates content.
- Published revisions are read-only. Clone, Apply, install, and Publish are distinct explicit actions.
- Destructive or irreversible operations require confirmation and state the consequence.
- Long prompts, diffs, paths, hashes, and check output wrap or use a named contained scroll region rather than widening the page.
- Sonner-style toasts are supplemental; persistent or consequential status is never toast-only.

## Accessibility

**Approved Core Alpha target**

- The skip link targets `#main-content`; landmarks and navigation regions have names.
- Current primary destination and breadcrumb item expose `aria-current`.
- Collapse/expand exposes `aria-expanded`, preserves focus, and never removes accessible names. Collapsed icon destinations provide focus/hover tooltips.
- `focus-visible` uses the semantic ring and offset across light and dark surfaces.
- Icon-only buttons have accessible names; decorative icons are hidden from assistive technology.
- Dynamic Teacher/interview output uses restrained polite live regions; progress includes accessible current/max text.
- Forms associate label, help, and error through `aria-describedby` and `aria-invalid`.
- Keyboard operation never depends on hover and focus is not covered by sticky headers, bottom navigation, or overlays.

## UI change verification

**Approved Core Alpha target**

Automated component tests cover selected semantics, theme, and reduced-motion contracts; focused browser checks cover exercised responsive and interaction paths. Neither is a complete WCAG 2.2 AA certification. Ongoing acceptance requires:

1. component states for loading, empty, error, success, offline, AI Off, and protected data;
2. keyboard walkthrough through library → create, library → import/intake, Home → session → practice → summary, and Studio gates;
3. light, dark, and system screenshots without hydration warnings;
4. 248px/72px rail, pre-hydration collapsed restoration, collapsed tooltip, 1440×900 desktop, 390×844 mobile, and 320 CSS px reflow checks;
5. reduced-motion and forced-colors checks;
6. rendered contrast checks for text, focus, selected navigation, controls, statuses, and activity surfaces;
7. the applicable repository format, lint, typecheck, web component, and E2E gates, reported separately from visual approval.
