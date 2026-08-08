# Aptiloop Core Alpha Design Specification

## Document status

This document replaces the legacy Dev Learning Harness design description. It is a specification and audit, not evidence that the target interface exists.

Status vocabulary used throughout this design set:

- **Implemented baseline** — observed in the current repository or recorded audit evidence.
- **Approved Core Alpha target** — required product behavior for Core Alpha; implementation is not implied.
- **Proposed pending owner approval** — a design choice that must not become an implementation commitment until the owner approves it.
- **Future** — explicitly outside Core Alpha.

The supporting specifications are:

- [`docs/design/information-architecture.md`](docs/design/information-architecture.md)
- [`docs/design/adaptive-studio.md`](docs/design/adaptive-studio.md)
- [`docs/design/activity-renderers.md`](docs/design/activity-renderers.md)
- [`docs/design/accessibility.md`](docs/design/accessibility.md)

## Product and experience principles

**Approved Core Alpha target**

Aptiloop Core Alpha is a local-first, single-user learning environment. The interface must make the next learner action obvious while preserving the technical provenance needed to trust course content, deterministic progression, evidence, reviews, and optional AI assistance.

The design must communicate these boundaries:

1. A **Course** is the top-level learner and authoring entity.
2. Published Course Revisions are immutable. Personal adaptation occurs on a separate private branch and never rewrites the source revision.
3. A lesson is a finite activity graph. The deterministic Learning Kernel, not the UI or a model, owns state transitions and mastery.
4. Source Snapshots and Knowledge Capsules expose provenance without turning the learner workspace into a research database.
5. Course Packs are declarative and validated. They contain no commands, scripts, secrets, executable plugins, or production courses.
6. The UI locale is `en-US` or `ru-RU`; it is independent of one primary course locale and any declared course fallback locales.
7. AI is optional. Pi is a model/runtime seam behind Aptiloop-owned typed tools, not a product shell, chat clone, or permission boundary.
8. Reviewer output is read-only and cannot apply patches. Execution results come from trusted, generic check IDs under the Execution Fabric and explicit Node or Python environment contracts.
9. Private learner data remains local and is never uploaded or shared without an explicit user action.

The interface is not a generic dashboard or card grid, a ChatGPT clone, or a full IDE. Studio is an editorial authoring environment with contextual technical instruments, not a code editor with a learning sidebar.

## Current UX audit

### Useful seams to preserve

**Implemented baseline**

- `apps/web/app/globals.css:5-160` defines a semantic OKLCH light/dark foundation and activity tokens.
- `apps/web/app/layout.tsx:1-3` loads local Geist Sans and Geist Mono.
- `apps/web/components/ui/button.tsx:7-55` provides semantic variants, visible focus, disabled behavior, and 44px mobile targets.
- `apps/web/components/query-state.tsx:5-57` provides reusable error and empty-state compositions.
- `apps/web/components/dashboard-client.tsx:237-275` distinguishes loading, query failure, and no published curriculum; `:303-452` provides a clear current-day and week path.
- `apps/web/components/session-client.tsx:796-987` provides a sticky session status and stable unit shell; `:1011-1036` dispatches the current activity types.
- `apps/web/components/exercise-client.tsx:515-529` derives a concrete next action; `:621-755` exposes workspace, diff, and trusted test evidence; `:758-848` keeps review separate and read-only.
- `apps/web/components/curriculum-editor-client.tsx:1053-1107` warns that publish is immutable and requires explicit acknowledgement.
- `apps/web/components/interview-client.tsx:838-925` states the limits of the current interview report, although the “skill evidence” label at `:897-918` overstates what the current structural report proves.

### Material UX debt

**Implemented baseline** audit findings, not compliance claims:

- The primary navigation exposes seven subsystems plus Settings (`apps/web/components/app-shell.tsx:24-60`) instead of learner journeys.
- Mobile renders eight destinations in a four-column grid (`apps/web/components/app-shell.tsx:187-212`). Recorded 390×844 smoke evidence found no horizontal overflow but an overfull mobile navigation and a dense 3534px Home page.
- The shell, metadata, content, and labels are hardcoded in Russian (`apps/web/components/app-shell.tsx:24-60`, `apps/web/app/layout.tsx:11-20`); this is migration evidence, not localization compliance.
- Home and the curriculum editor still lean on repeated cards. The editor nests Week → Day → Unit panels (`apps/web/components/curriculum-editor-client.tsx:1365-1468`, `:1497-1559`), contradicting the current no-nested-card intent.
- The knowledge table requires `min-w-[900px]` horizontal scrolling (`apps/web/components/knowledge-client.tsx:62-119`) and has no mobile-native summary.
- Optional AI health is presented as global readiness and Mock can be labeled “AI ready” (`apps/web/components/provider-health.tsx:83-137`). Browser-offline, Core-stopped, storage, no-AI, and missing-runtime states are not separated.
- Studio authoring relies on raw JSON fields (`apps/web/components/curriculum-editor-client.tsx:993-1041`). Course Pack opening, import, export, validation, locale completion, preview, and typed AI proposals are absent.
- Current screenshots cover paired light/dark Path, Session, Settings, and Interview setup plus a few single-state desktop views in `docs/screenshots/`. They do not prove mobile, error, offline, no-AI, missing-runtime, exercise, review, Skills, or Studio-dark behavior.

Recorded verification is mixed and must remain described accurately: `npm run verify` passed its recorded format, lint, typecheck, fast-test, and build tasks, but `npm run test:e2e` had 1 pass and 3 failures. The failed flows were Day 1 (`Plan day` not found), Curriculum Editor (create-revision navigation timeout), and Interview (default studied-scope radio not found). A disposable 1440×900 browser smoke loaded Home, started a session, opened the plan drawer, and showed no observed console errors. This evidence does not approve the Core Alpha design.

## Design directions

The three directions below are alternatives. None is approved by this document.

### A Calm Workshop

**Proposed pending owner approval — recommended**

A cold-neutral and eucalyptus workshop: open editorial learner surfaces, thin separators, restrained elevation, and contextual technical panels. The learner sees a calm reading and practice space; Studio increases information density without becoming an IDE.

- Retain Geist Sans and Geist Mono.
- Retain and refine the semantic OKLCH foundation.
- Materially replace generic dashboard/card composition with a lead next-action field, open lists, ruled sections, and task-specific side context.
- Use activity color only as a redundant type cue alongside text and icon.
- Use nearly flat surfaces; shadows are reserved for temporary overlays and drag elevation.
- Let Studio be approximately 70% editorial workspace and 30% developer instrument.

Tradeoffs: this is the lowest-risk incremental migration and the strongest shared basis for light/dark and English/Russian. It can look too close to the legacy harness if the shell, hierarchy, card usage, and Studio composition are not actually changed.

### B Learning Ledger

**Proposed pending owner approval**

A warm editorial study ledger: paper-tinted fields, ruled separators, strong long-form rhythm, and margin evidence. Authored material feels durable and deliberate.

- Source Serif 4 for authored prose and headings; IBM Plex Sans for UI; IBM Plex Mono for code.
- Document index, manuscript center, and evidence margin rather than panels.
- Warm neutral light mode with forest and rust accents.

Tradeoffs: strongest identity for reading and reflective work, but weaker for dense graph validation and test evidence. It introduces a larger font/localization migration and loses some paper character in dark mode.

### C Graph Blueprint

**Proposed pending owner approval**

A slate and navy technical workbench: explicit dependency lines, graph/list switching, cobalt selection, amber validation, and dense inspectors without glow or glass.

- IBM Plex Sans and Mono.
- Studio-first tree, graph/list, inspector, and validation console.
- More compact controls and stronger technical provenance rails.

Tradeoffs: best for finite-graph inspection and dark Studio density, but most likely to feel like a full IDE or control plane and to expose authoring internals to learners.

### Comparable direction matrix

**Proposed pending owner approval.** These references keep all three alternatives at the same decision level; they are not production tokens or implementation authorization.

| Dimension | A Calm Workshop | B Learning Ledger | C Graph Blueprint |
| --- | --- | --- | --- |
| Light/dark semantic palette | Cool-neutral surfaces; eucalyptus action; independent activity/status colors; three dark luminance levels. | Warm paper/ink/forest/rust in light; charcoal parchment in dark; independent evidence/status inks. | Slate/near-white light and navy/slate dark; cobalt selection, amber validation; independent semantic statuses; no neon. |
| Type and licensing impact | Existing local Geist Sans/Mono; lowest packaging and Cyrillic risk. | Source Serif 4 + IBM Plex Sans/Mono; strongest editorial voice, but new font provenance, payload, Cyrillic, and hinting review. | IBM Plex Sans/Mono; technical density, with new font provenance/payload and less long-form warmth. |
| Density, spacing, radius, elevation | 4px system; 8/12px radii; open learner spacing; dense three-region Studio; thin borders; overlay-only shadow. | 4px system with larger 16/24px prose rhythm; 4/8px radii; ruled document fields; almost no elevation. | 4px system; 6/8px radii; compact rows and inspectors; border/selection markers; elevation only for overlays/drag. |
| Home | Lead next action, open phase rows, compact readiness/evidence rail. | Dated learning brief, manuscript-like next action, evidence margin. | Dependency-oriented next action, compact readiness and graph-position rail. |
| Lesson | 720–800px calm ActivityFrame plus optional context rail. | 68–74ch reading sheet with margin sources/evidence and restrained task footer. | Compact ActivityFrame with collapsible dependency/evidence rail; learner material still visually primary. |
| Adaptive Studio | 264px outline / fluid editorial field / 320px inspector; 70/30 editorial-instrument balance. | Document index / manuscript editor / evidence margin; graph and validation use dedicated modes. | Tree or graph/list / compact editor-preview / inspector-validation rail; strict guard against full-IDE drift. |
| Mobile | One pane, five-item bottom nav, full-height context sheets; Studio Outline/Edit/Preview modes. | One reading sheet, section index sheet, evidence/source sheet; same workflow limits. | One list/editor/preview mode at a time; graph becomes accessible outline; inspectors become sheets. |
| Accessibility/localization risk | Lowest: existing type/tokens; must prove new compositions and all semantic pairs. | Highest font/reflow risk and paper metaphor loss in dark/forced-colors; 30% label expansion still required. | Highest density/cognitive-load risk; dependency meaning needs list/text equivalents; Russian expansion can stress compact controls. |
| Migration cost | Lowest, but must materially replace shell/card hierarchy to avoid a rename-only result. | Highest: typography, composition, dark mode, localization, and artifact licensing changes. | Medium-high: dense components, graph/list parity, mobile reduction, and learner/author separation. |

All directions use the same five-destination IA, ActivityFrame, no-generic-dashboard rule, responsive state contract, WCAG 2.2 AA target, and manual/no-AI completeness. Direction choice changes composition and visual language, not product authority or security boundaries.


## Recommendation and approval gate

**Proposed pending owner approval**

Recommend **A Calm Workshop** because it preserves the strongest implemented seams—Geist, OKLCH, restrained motion, session progression, and source/review evidence—while materially changing composition and information architecture. It supports a calm lesson surface and a capable three-region Studio without a big-bang rewrite.

Owner approval of a direction is an explicit gate. Before approval:

- no direction-specific visual implementation is authorized;
- the token values below are reference values, not accepted production tokens;
- wireframes define behavior and hierarchy, not pixel-perfect implementation;
- documentation may be refined without claiming UI delivery.

After approval, implementation must still pass the independent accessibility, responsive, localization, and product acceptance gates. Approval of an AI-generated draft is never approval to publish a Course Revision.

## Calm Workshop foundation

### Color

**Implemented baseline**

The existing semantic names in `apps/web/app/globals.css:5-160` are the migration foundation: background, foreground, card/popover, primary, secondary, muted, accent, destructive, success, warning, border, input, ring, sidebar, and activity pairs. Existing activity-practice is emerald; stale references to blue practice are not authoritative.

**Proposed pending owner approval** Calm Workshop identity values:

| Role | Light | Dark |
| --- | --- | --- |
| background | `oklch(0.975 0.006 250)` | `oklch(0.185 0.018 255)` |
| surface | `oklch(0.995 0.002 250)` | `oklch(0.225 0.022 255)` |
| raised | `oklch(0.985 0.004 250)` | `oklch(0.255 0.024 255)` |
| foreground | `oklch(0.25 0.025 255)` | `oklch(0.965 0.006 255)` |
| muted foreground | `oklch(0.48 0.025 255)` | `oklch(0.72 0.018 255)` |
| border | `oklch(0.875 0.015 255)` | `oklch(0.34 0.025 255)` |
| primary | `oklch(0.50 0.13 153)` | `oklch(0.78 0.13 153)` |
| focus ring | `oklch(0.55 0.15 153)` | `oklch(0.82 0.12 153)` |

Activity families use explicit foreground/quiet-surface pairs. The reference values below must still be measured in rendered controls, text, borders, diffs, charts, overlays, and forced-color fallbacks before adoption.

| Activity family | Light foreground | Light quiet surface | Dark foreground | Dark quiet surface |
| --- | --- | --- | --- | --- |
| study | `oklch(0.40 0.14 300)` | `oklch(0.95 0.03 300)` | `oklch(0.84 0.10 300)` | `oklch(0.29 0.05 300)` |
| recall | `oklch(0.39 0.10 75)` | `oklch(0.96 0.04 80)` | `oklch(0.87 0.11 80)` | `oklch(0.29 0.06 75)` |
| explain | `oklch(0.37 0.10 215)` | `oklch(0.95 0.035 215)` | `oklch(0.84 0.09 215)` | `oklch(0.28 0.05 215)` |
| assess | `oklch(0.39 0.13 255)` | `oklch(0.95 0.03 255)` | `oklch(0.84 0.10 255)` | `oklch(0.29 0.05 255)` |
| practice | `oklch(0.37 0.11 155)` | `oklch(0.95 0.035 155)` | `oklch(0.84 0.10 155)` | `oklch(0.28 0.05 155)` |
| review | `oklch(0.43 0.14 25)` | `oklch(0.96 0.035 25)` | `oklch(0.86 0.10 25)` | `oklch(0.29 0.05 25)` |

Status semantics have separate foreground/quiet-surface pairs and always include text/icon/state:

| Status | Light foreground | Light quiet surface | Dark foreground | Dark quiet surface |
| --- | --- | --- | --- | --- |
| success | `oklch(0.36 0.11 150)` | `oklch(0.95 0.035 150)` | `oklch(0.84 0.10 150)` | `oklch(0.28 0.05 150)` |
| warning | `oklch(0.39 0.10 75)` | `oklch(0.96 0.04 80)` | `oklch(0.87 0.11 80)` | `oklch(0.29 0.06 75)` |
| error | `oklch(0.43 0.15 25)` | `oklch(0.96 0.035 25)` | `oklch(0.86 0.11 25)` | `oklch(0.29 0.055 25)` |
| info | `oklch(0.39 0.12 250)` | `oklch(0.95 0.03 250)` | `oklch(0.84 0.10 250)` | `oklch(0.29 0.05 250)` |
| offline | `oklch(0.40 0.035 255)` | `oklch(0.94 0.015 255)` | `oklch(0.80 0.025 255)` | `oklch(0.28 0.025 255)` |
| disabled control | `oklch(0.58 0.018 255)` | `oklch(0.94 0.008 255)` | `oklch(0.58 0.018 255)` | `oklch(0.25 0.015 255)` |

Interaction references: hover uses `oklch(0.50 0.03 255 / 0.08)` light and `oklch(0.90 0.02 255 / 0.08)` dark; pressed doubles that alpha; selected uses the primary quiet surface plus a leading marker; focus uses the existing focus-ring role with a 2px ring and 2px offset; disabled controls remove interaction but essential explanatory copy uses normal muted foreground, not the disabled token. Expected checks: at least 4.5:1 for normal text, 3:1 for large text and graphical/control boundaries, 3:1 focus contrast against adjacent colors, discernible hover/selected/pressed without color alone, and no information conveyed solely by disabled opacity.

No interface may use hardcoded hex, pure black, pure white, or arbitrary component-only colors. Contrast must be verified against rendered theme pairs rather than inferred from token intent.

### Typography

**Proposed pending owner approval**

- UI and authored prose: Geist Sans, with the installed local font and language-appropriate fallback.
- Code, paths, stable IDs, hashes, versions, model IDs, check IDs, and compact metrics: Geist Mono.
- Page title: 28/34, weight 650.
- Section title: 20/28, weight 600.
- Activity title: 22/30, weight 600.
- Body/prose: 15/24, weight 400; reading measure 64–72ch.
- UI/control: 14/20, weight 500 where interactive.
- Caption/metadata/mono: 12/18; never below 12px for essential text.
- Code blocks: 13/20 desktop and mobile, horizontal containment, user-controlled wrapping when feasible.

English and Russian must share the scale. Controls must allow at least 30% label expansion without clipping. Truncation is reserved for repeatable identifiers with a full accessible name and a reveal/copy path.

### Spacing, shape, elevation, motion

**Proposed pending owner approval**

- 4px base with named steps 4, 8, 12, 16, 24, 32, 48, 64.
- Control radius 8px; bounded panels and overlays 12px; pills only for compact state or tags.
- Learner rail 240–256px. Lesson reading field 720–800px plus optional 280px context.
- Studio at ≥1280px: 264px outline, fluid editor/preview, 320px inspector.
- Thin borders provide hierarchy. Shadows appear only on menus, sheets, dialogs, drag previews, and sticky elements crossing content.
- State transitions use 160ms ease-out. No page-load choreography, bounce, decorative parallax, animated gradients, or typewriter AI text.
- `prefers-reduced-motion` removes nonessential motion and preserves immediate state feedback.

## Composition rules

**Approved Core Alpha target**

- Primary navigation is **Home / Courses / Review / Skills / Settings**.
- Home is an editorial next-action surface, not a metric dashboard.
- Courses owns installed Courses and immutable revisions, Course Pack intake/export, Course outline, lesson workspaces, and Adaptive Studio entry points.
- Review is a due-first work queue with Mistakes, Cards, and Interview practice as views, not primary destinations.
- Skills is an evidence-backed topic index and detail timeline, not a wide table as the only view.
- Settings separates language, appearance/accessibility, Core & Storage, external runtimes, optional AI tools, privacy, and diagnostics.
- Desktop uses persistent navigation; mobile uses a five-destination bottom bar. A second row of navigation is prohibited.
- A card is used only for a self-contained entity or action. Related rows share an open surface and separators. Cards must not be nested.
- Dialogs are reserved for destructive or consequential confirmations. Inspectors and details use rails or sheets.

## Required responsive and theme behavior

**Approved Core Alpha target**

Desktop and mobile are different compositions over the same contract, not a desktop grid squeezed narrower.

- Desktop: persistent primary rail; optional contextual rail; sticky local toolbar only when it shortens a repeated workflow.
- Mobile: one primary pane; bottom navigation; plan, context, outline, and inspector open as full-height sheets or dedicated screens; primary lesson action sits above the bottom bar.
- Adaptive Studio mobile is for review, metadata edits, structured field edits, validation, Preview, simple adaptation/conflict inspection, and proposal approval. Graph rearrangement, bulk import conflict resolution, raw JSON, wide diff/conflict review, environment authoring, export packaging, and release publication are desktop-only unless a later usability study approves otherwise. Small bounded embedded coding tasks may run on mobile when their renderer/input/reflow contract passes; full-project coding remains in an external workspace and mobile offers safe resume/Continue on desktop.
- Light and dark preserve identical information hierarchy and status meaning. Dark mode uses raised luminance, not glow. Light mode uses tinted neutrals, not pure white.
- Zoom to 200%, 320 CSS px reflow, long English/Russian labels, large text, and high-contrast/forced-colors behavior are design inputs, not cleanup tasks.

## State model

**Approved Core Alpha target**

Every networked or runtime-dependent region declares one of: loading, ready, empty, validation blocked, recoverable error, browser offline, Core unavailable, storage unavailable/locked, external runtime missing, AI off, AI unavailable, or unsupported capability.

- **Loading:** preserve layout context; announce the operation once; disable duplicate submission.
- **Empty:** explain why the region is empty and the next relevant action.
- **Error:** stay beside the source, preserve user input, identify the failed layer, and provide a safe retry or settings path.
- **Offline:** distinguish browser connectivity from local Core health. Do not promise queued mutation or cached completion unless the Learning Kernel implements it.
- **No AI:** manual and deterministic paths remain complete. Hide or disable only the optional AI affordance.
- **Missing runtime:** identify Core, SQLite/storage, filesystem permission, Node, Python, external editor, or AI provider separately. Never silently substitute Mock for a real provider.
- **Validation blocked:** focus the exact Course node and field; retain a summary and stable error IDs.

## Content and provenance

**Approved Core Alpha target**

- UI copy defaults to concise `en-US`; `ru-RU` is a complete UI catalog, not mixed inline strings.
- Course content stays in its declared primary locale with explicit fallback and missing-translation markers.
- Actions describe the next operation: “Resume lesson,” “Run checks,” “Review evidence,” “Validate draft,” “Apply to draft,” “Publish immutable revision.”
- AI surfaces name the Aptiloop role/tool and provider/model in a disclosure. Never anthropomorphize a model or present Mock as a real provider.
- Source contexts show title, origin, snapshot time/version, course locale, and availability. External navigation is explicit.
- Interview observations must be labeled as answer observations until technically validated evidence exists.
- Private-data export or provider transmission requires an explicit scope summary and confirmation at the point of action.

## Out of scope

**Future**

- Multi-user collaboration, shared comments, cloud sync, and permissions.
- A general-purpose graph canvas, full IDE, embedded shell, arbitrary AI tools, plugins, or pack scripts.
- Production Course Packs or a public course marketplace.
- Automatic cross-device offline mutation replay.
- AI-authored automatic publishing or reviewer patches.

## Acceptance gate

Design implementation may be called approved only after the owner selects a direction and the implementation is reviewed against all four supporting specifications. Passing build or unit checks alone is insufficient. The review must cover desktop/mobile, light/dark, `en-US`/`ru-RU`, keyboard and assistive technology, the complete state model, all required screens and authoring/import/validation flows, and proof that no silent real-provider-to-Mock fallback or private-data transmission has been introduced.
