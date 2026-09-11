# Design implementation reference

## Purpose and status

This is a concise map from the canonical design contract to repository seams. It records implementation evidence and boundaries; it does not duplicate the visual specification or specialist route/component contracts.

- **Implemented baseline** — repository seam or observed behavior; not visual or accessibility acceptance evidence.
- **Approved Core Alpha target** — required behavior that implementation must preserve or complete.
- **Proposed pending owner approval** — unresolved recommendation.
- **Future** — outside Core Alpha.

The canonical visual contract is [`../../DESIGN.md`](../../DESIGN.md). Route ownership and URL state are in [`information-architecture.md`](information-architecture.md); ActivityFrame behavior is in [`activity-renderers.md`](activity-renderers.md); Studio behavior is in [`adaptive-studio.md`](adaptive-studio.md); WCAG intent and evidence limits are in [`accessibility.md`](accessibility.md).

## Source-of-truth mapping

| Contract                                    | Repository seam                                                   | Boundary                                                                                                                                                                                        |
| ------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Semantic theme roles and OKLCH tokens       | `apps/web/app/globals.css`; shared shadcn/Radix primitives        | Components consume semantic roles, never component-only raw palette values. Canonical values remain in [`../../DESIGN.md#color-roles`](../../DESIGN.md#color-roles).                            |
| Theme preference and reduced motion         | `ThemeProvider`, `next-themes`, global motion rules               | `system \| light \| dark` applies through browser-local preference; reduced motion removes nonessential transitions, scrolling, and transforms.                                                 |
| App shell and route title                   | `AppShell`, utility header, `PageHeader`                          | Shell owns rail, mobile navigation, skip link, main landmark, privacy-safe title, breadcrumb slot, and route-to-destination mapping. PageHeader owns title, description, and page actions only. |
| Breadcrumb and meaningful destination state | shared breadcrumb; Radix Tabs/compact Select; URL query contracts | Entity labels stay honest while loading; ancestors are links and current item is text with `aria-current`. IA owns route and query semantics.                                                   |
| Lesson orientation                          | `apps/web/components/day-plan.tsx`, ActivityFrame                 | Desktop rail and mobile Sheet expose the same semantic plan. ActivityFrame and renderer ownership remain in `activity-renderers.md`.                                                            |
| Localized loading and feedback              | `LoadingState`, bounded skeletons, Sheet/Popover, toast region    | Loading, errors, empty states, and transient feedback are localized and layer-specific; consequential/persistent status remains in page context.                                                |
| Text input and conversational surface       | `apps/web/components/ui/textarea.tsx`, `interview-chat-view.tsx`  | Enter/Shift+Enter behavior and one meaningful live-status boundary are preserved; unsupported chat tools are not implied.                                                                       |

## Implemented seams to preserve

**Implemented baseline**

- Next.js App Router presentation remains in `apps/web`; Geist Sans and Geist Mono come from the installed `geist` package.
- Existing shadcn/Radix primitives remain the component toolkit. `apps/web/app/globals.css` owns the semantic light/dark foundation and `surface-soft` is the recessed-band/quiet-well role; no parallel `surface-subtle` alias is introduced.
- `AppShell`, `PageHeader`, query states, `ActivityFrame`, the closed renderer registry, Adaptive Studio, and provider connection management are existing seams.
- Primary navigation remains Home, Courses, Review, Skills, and Settings. UI locale remains independent from Course locale and supports `en-US` and `ru-RU`.
- Course library, Review destination, Studio workspace, chat role, and staged-intake confirmation retain separate URL contracts. Intake recovery is limited to the same orchestrator process and validation expiry; a Core restart requires file reselection and validation.
- Browser requests retain typed API and domain contracts. Database, provider, filesystem, Git, and process authority do not move into the browser.

## Implementation boundaries

**Approved Core Alpha target**

- Components preserve the shared 248px/72px shell, stable navigation semantics, 44px mobile targets, visible focus, named landmarks, and privacy-safe route identity from [`../../DESIGN.md`](../../DESIGN.md).
- Loading, saving, validation, import, check, review, AI proposal, export, and publish status use bounded localized status/alert regions. Skeleton pulses and model tokens are not announced individually.
- Published revisions are read-only. Clone, Apply, install/open-as-draft, Validate, Preview, Change review, and Publish remain distinct operations with preserved input and explicit recovery.
- Technical values, diffs, paths, hashes, and check output wrap or use named contained scrolling. No page-level horizontal overflow is accepted at the responsive contract widths.
- Provider and runtime failure remain distinct from Core/storage failure; AI Off is not an error and real-provider failure never silently selects Mock. Secrets are never rendered.

## Evidence boundary

**Implemented baseline**

Automated component checks and focused browser checks provide evidence only for exercised semantics, state transitions, themes, reduced motion, responsive paths, route separation, and interaction seams. They do not establish complete 320px reflow, all WCAG 2.2 A/AA criteria, manual assistive-technology acceptance, or certification. The complete acceptance matrix remains owned by [`accessibility.md`](accessibility.md), and design approval remains separate from implementation and Course publication approval.
