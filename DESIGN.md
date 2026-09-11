# Aptiloop Core Alpha Design Specification

## Status and ownership

This is the compact visual and interaction contract for Aptiloop Core Alpha.

- **Implemented baseline** — behavior observed in the repository or direct browser evidence.
- **Approved Core Alpha target** — required Core Alpha behavior; not an implementation claim.
- **Proposed pending owner approval** — recommendation awaiting an explicit owner decision.
- **Future** — outside Core Alpha.

Product behavior and information architecture remain governed by `PRODUCT.md`, `ARCHITECTURE.md`, and the focused specifications:

- [`docs/design/information-architecture.md`](docs/design/information-architecture.md) — routes, navigation, URL state, journeys, and recovery.
- [`docs/design/adaptive-studio.md`](docs/design/adaptive-studio.md) — authoring workspace and publication gates.
- [`docs/design/activity-renderers.md`](docs/design/activity-renderers.md) — ActivityFrame and renderer contracts.
- [`docs/design/accessibility.md`](docs/design/accessibility.md) — WCAG 2.2 AA target and verification matrix.

Those documents own their detailed inventories. This document owns the shared visual language and cross-surface interaction contract.

## Design direction: Calm Workshop — Clear Slate

**Approved Core Alpha target**

Aptiloop is a quiet local learning workbench: deliberate, tactile, trustworthy, and technically precise. Light mode uses near-white cool neutrals; dark mode uses low-chroma cool graphite. Restrained evergreen is reserved for primary action, progress, success, and focus. The foundation has no ambient green cast.

This is an independent workbench, not a dashboard template, project-management composition, KPI surface, image-led layout, interchangeable card grid, chat clone, or IDE. Its recurring motifs are:

1. **Focus field** — one lightly elevated surface for the next learning or authoring action.
2. **Evidence rail** — compact values paired with labels and provenance-oriented copy.
3. **Soft list** — related entities share an open surface with spacing and subtle separators.
4. **Green focus trace** — next action, progress, success, and keyboard focus use restrained evergreen; every state also has text or an icon.
5. **Circular utility control** — theme, disclosure, compact navigation, and contextual controls use optically balanced circular or softly squared icon buttons.

External pattern research informs interaction anatomy only; Aptiloop keeps its own composition and scope. In particular, navigation landmarks, exclusive assisted-start choices, explicit workflow statuses, prompt anatomy, and AI disclosure follow the linked source guidance without importing unsupported controls or decorative AI effects.

## Experience principles

**Approved Core Alpha target**

- One primary action per surface; secondary actions remain visible but quieter.
- Large values summarize persisted facts and never imply invented mastery or model certainty.
- Labels are concise, sentence case by default, and not decorative filler.
- Containers represent a coherent entity, action, or state; cards are not nested.
- Borders are low-emphasis boundaries; whitespace, surface contrast, and elevation carry hierarchy.
- Errors, missing runtimes, no-AI mode, offline state, validation blockers, and provenance remain explicit.
- AI output is visually subordinate to deterministic state and always attributed.
- Published revisions, source lineage, local adaptation, and protected-answer boundaries remain legible.
- Light and dark themes preserve hierarchy and semantics. Motion clarifies state changes only; reduced motion removes nonessential transitions.
- No browser surface receives database, provider, filesystem, Git, process, command, script, secret, or plugin authority merely through presentation.

## Visual system

All interface color uses semantic OKLCH variables. Component-only raw palette classes are prohibited. Cool graphite neutrals remain independent from evergreen, warning, destructive, selection, and activity-family roles. Activity color supplements a label, icon, marker, and state text; it is never the only distinction.

### Color roles

**Approved Core Alpha target**

| Role             | Light                    | Dark                     | Use                            |
| ---------------- | ------------------------ | ------------------------ | ------------------------------ |
| background       | `oklch(0.994 0.001 260)` | `oklch(0.140 0.006 260)` | App field                      |
| foreground       | `oklch(0.205 0.009 260)` | `oklch(0.945 0.005 260)` | Primary text                   |
| surface-soft     | `oklch(0.965 0.004 260)` | `oklch(0.175 0.007 260)` | Recessed bands and quiet wells |
| surface          | `oklch(1.000 0.000 000)` | `oklch(0.180 0.008 260)` | Standard content surface       |
| surface-raised   | `oklch(1.000 0.000 000)` | `oklch(0.205 0.009 260)` | Focus field and popovers       |
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

Normal text reaches WCAG 2.2 AA contrast. Large text and graphical/control boundaries reach at least 3:1. Softer hierarchy never lowers essential text contrast. Token pairs require rendered-state review in both themes, including hover, focus, selected, disabled, overlays, and forced colors.

### Surface, shape, spacing, type, and icons

**Approved Core Alpha target**

- App background is uninterrupted behind content. Recessed surfaces serve rails, navigation, tabs, code/output wells; standard surfaces group related content; raised surfaces are reserved for the current focus action, overlay, or sticky content.
- Focus shadows are `0 1px 2px oklch(0.20 0.012 255 / 0.06), 0 18px 48px oklch(0.20 0.012 255 / 0.08)` in light mode and `0 1px 2px oklch(0.03 0.006 255 / 0.28), 0 18px 48px oklch(0.03 0.006 255 / 0.22)` in dark mode. Standard surfaces use a subtle border or low shadow, not both at full strength. No glow, glassmorphism, animated gradient, or decorative blur field.
- Controls, panels, entity rows, and focus fields use an 8px radius. Large temporary overlays may be larger; progress and true state indicators may be fully rounded. Nested containers use visibly smaller radii or no radius.
- Use the 4px scale `4, 8, 12, 16, 20, 24, 32, 40, 48, 64`. Default section rhythm is 24px, or 32px between distinct workflow regions; standard padding is 20px mobile/24px desktop and focus-field padding is 24px mobile/32px desktop. Mobile controls have a 44px minimum target.
- Header-to-content spacing is 20–24px; related list rows use 16–20px vertical spacing. Dense Studio lists may use 36–40px controls only on desktop with equivalent keyboard focus and accessible names.
- Geist Sans serves UI, authored prose, and labels. Geist Mono serves code, paths, IDs, hashes, versions, provider/model IDs, checks, and technical evidence. Body text is 15/24px at a 64–72ch measure; essential technical captions never fall below 12px. English and Russian share the scale and controls allow at least 30% label expansion.
- Type scale (size/line-height in px): page title 32/37 mobile and about 38/43 desktop, weight 650, tracking `-0.03em`; focus title 24–30/32–38, weight 620–650; section title 18–20/26–28, weight 600; activity title 22/30, weight 620. Body is weight 400; controls are 14/20, weight 500 when interactive; supporting labels are 12/18, weight 550 with modest tracking; technical captions are 12/18 Geist Mono. Uppercase is reserved for rare workflow-orientation labels.
- Phosphor is the single icon family: regular weight for navigation, optionally filled for the selected destination. Status icons pair with readable state text; utility icons are 18–20px inside 36–44px targets; decorative icons are omitted or hidden from assistive technology.

## Shared interaction and state contract

**Approved Core Alpha target**

- Hover changes emphasis, never layout; pressed state deepens it. Keyboard focus is a visible 2px semantic ring with 2px offset. Selected state combines surface/weight/marker with `aria-current` or equivalent semantics, never color alone.
- Disabled actions remain legible and explain why nearby. Loading uses a spinner and stable width where practical, disables duplicate submission, and keeps the control name.
- Progress uses one quiet continuous track plus exact completed/total text. Course progress, phase progress, and skill dimensions are never combined into an invented overall score.
- Empty states explain the reason and next action. Errors identify the failing layer, preserve input, and offer recovery. Browser offline, Core unavailable, storage failure, Course invalid/unavailable, required runtime missing, optional runtime missing, operation failure, and AI unavailable remain distinct. AI Off is calm and normal; manual paths remain complete.
- External provider transmission and export/share are separate explicit operations. Before private context leaves the local application, a localized review identifies role/tool, provider/model, destination, payload categories and selected ranges, exclusions/redactions, size bounds, and retention disclosure; cancel preserves the draft, and changed scope requires renewed review. Local export is never proof of external sharing.
- Transient feedback may use a localized global toast and does not survive navigation. Validation errors, uncertain commits, destructive consequences, and failures requiring action remain in page context. Toasts are supplemental, never the only record of consequential status.
- Focus and reading order remain stable across themes, breakpoints, sheets, and route changes. Dialogs/sheets have names, contained focus, Escape behavior when safe, and focus restoration. Long technical values wrap or use named contained scrolling; the page itself does not overflow horizontally.
- State-changing operations are explicit and typed. Apply, Validate, Preview, Change review, install/open-as-draft, and Publish are separate gates. Published revisions are read-only; destructive or irreversible operations explain consequences and require confirmation.
- Transitions use 140–180ms ease-out. `prefers-reduced-motion: reduce` removes nonessential duration, scrolling, transforms, and animation.

## Component and route contracts

**Approved Core Alpha target**

- **App Shell:** desktop rail is 248px expanded/72px collapsed with stable icon centers, 48px rows, order, and focus order. The utility header owns collapse/expand immediately before a labeled breadcrumb; it also owns theme and compact layer-aware provider utilities. Expanded mode shows mark and wordmark; collapsed mode retains the centered mark. The rail footer has no provider, theme, or ambiguous status pill. Primary navigation is Home, Courses, Review, Skills, Settings; route ownership is defined by [`information-architecture.md`](docs/design/information-architecture.md). Core Alpha renders no fake account or authentication affordance.
- **Page header and breadcrumbs:** PageHeader owns only title, description, and page actions. It does not repeat the utility breadcrumb or invent a top-level title for nested routes. Breadcrumb ancestors are links; the current entity is plain text with `aria-current="page"`, and unresolved labels show honest loading text rather than a false Home location.
- **Mobile shell:** one 64–72px context bar and one five-destination bottom bar with labels, safe-area padding, and no second navigation row. A contained deep workflow may use a task toolbar only with a clear Back/Leave action. Content reflows at 320 CSS px; technical two-dimensional material stays in named contained regions with usable alternatives.
- **ActivityFrame:** shared frame owns context, loading, focus, status, save state, capability resolution, error placement, and kernel transition requests. Renderer-specific anatomy and protected-answer rules belong to [`activity-renderers.md`](docs/design/activity-renderers.md); presentation never infers readiness, mastery, completion, or kernel ownership.
- **Adaptive Studio:** creation/intake remain outside Studio. Studio begins with an explicit local Draft/revision; manual authoring is complete without AI; Apply changes only a Draft; Validate, learner-safe Preview, Changes, and immutable Publish remain distinct. Detailed authoring contract: [`adaptive-studio.md`](docs/design/adaptive-studio.md).
- **Settings and conversational input:** interface locale, theme, Core/storage, runtimes, connections, and optional AI roles retain separate ownership and recovery. Chat is a secondary bounded tool, not generic authority: textarea plus real Send/Stop/Retry, disclosed role/provider/model, no inert attachments, screenshots, web search, microphone, or browser-side model switching.
- **Route surfaces:** Home is the current Course and deterministic next action; Courses owns library/create/import; Review owns Due/Mistakes/Cards/Interviews; Skills shows evidence-backed dimensions; Settings owns local interface/runtime/provider recovery. Detailed route and state inventories are in [`information-architecture.md`](docs/design/information-architecture.md).

## Accessibility, localization, and evidence boundary

**Approved Core Alpha target**

The product targets WCAG 2.2 Level AA across all Core Alpha routes, ActivityFrame renderers, Studio surfaces, themes, locales, breakpoints, and loading/empty/error/offline/no-AI/missing-runtime states. This is a target and verification plan, not a conformance statement or certification. The detailed criterion inventory and manual matrix are in [`docs/design/accessibility.md`](docs/design/accessibility.md).

Semantic landmarks, one logical page heading, labels/descriptions, keyboard operation, visible/not-obscured focus, 44px mobile targets, non-color state cues, named live regions, dialog/sheet focus behavior, and accessible progress values are mandatory. `en-US` and `ru-RU` provide functional parity for controls, errors, dates, status labels, and accessibility names. UI locale is independent from Course locale; Course content declares its language and fallback, and mixed-language regions use `lang`.

Responsive acceptance includes 1440×900 desktop, 390×844 mobile, 320 CSS px reflow, 200% zoom, long Russian labels, safe-area/keyboard obstruction, touch and keyboard-only input, light/dark/system themes, forced colors, increased text spacing, and reduced motion. Existing automated and focused browser evidence covers only exercised paths; it does not establish complete reflow, manual assistive-technology acceptance, or certification. Design completion is separate from security, licensing, content, distribution, and release acceptance.
