# 2026-08-12 UI/UX and Runtime Hardening Audit

**Document status:** **Implemented baseline** evidence for the repository and local runtime observed at this cutoff.

**Release status:** Core Alpha release acceptance remains an **Approved Core Alpha target**. This audit does not approve a release, public distribution, production Course content, a project license, public/LAN hosting, or full WCAG 2.2 AA certification.

**Implementation commit:** `b542b32` (`Core Alpha UX/runtime hardening`). The later documentation commit is intentionally not cited by this implementation audit.

## Scope

This audit records the comprehensive UI/UX and supporting runtime hardening performed across the current Aptiloop shell and principal local-first journeys:

- Home, Courses, Course creation, Course Pack intake, and Course details;
- Learning Path, Lesson/Session, activities, and trusted exercise handoff;
- Review, Skills, Interview, Chat, and Settings;
- Adaptive Studio Program, Designer, Preview, Release, and History surfaces;
- responsive desktop/mobile layout, light/dark themes, `en-US`/`ru-RU`, loading/empty/error/AI Off states, reload recovery, and URL-backed navigation;
- Course identity, staged import, provider disclosure, draft persistence, deterministic next action, and evidence boundaries needed to keep those interfaces honest.

The work was incremental through the existing `apps/web`, `apps/orchestrator`, `packages/shared`, `packages/learning-core`, `packages/exercise-core`, and `packages/database` seams. It did not move database, provider, filesystem, Git, or process authority into the browser.

## Application shell and visual system

**Implemented baseline**

- The desktop shell uses a stable expanded/collapsed navigation rail, predictable icon alignment, one visual rail boundary, 44 px interactive targets, and the five approved destinations: Home, Courses, Review, Skills, and Settings.
- Mobile uses a bounded bottom navigation and viewport-height composition without horizontal page overflow on the exercised routes.
- Breadcrumbs expose real Course, revision, lesson, session, exercise, and interview context. The final crumb is plain current-location text rather than a misleading link.
- UI locale is no longer treated as Course locale. Locale controls live in Settings; primary Course locale remains explicit Course data.
- AI state is compact in the shell and expands only where provider/model detail or recovery is relevant.
- Light and dark themes use neutral surfaces with functional green reserved for progress, selection, and success. Input boundaries, focus visibility, reduced-motion behavior, and error/empty states were tightened.
- Accordion triggers support semantic heading levels, while long Lesson rails and Studio tabs contain overscroll and Windows scrollbar controls without introducing tiny vertical arrows.
- User-facing query failures use localized primary copy. Raw diagnostics are hidden in a closed native “Technical details” disclosure rather than rendered as the main error.

This evidence is implementation and browser QA, not an independent contrast laboratory or full assistive-technology certification.

## Navigation and reload recovery

**Implemented baseline**

- Course search, filter, pagination, Chat role selection, Review tabs, Course Pack confirmation, and Studio tabs are URL-backed and preserve unrelated parameters where applicable.
- Meaningful navigation uses history entries; canonicalization of missing or invalid state uses replacement. Back, Forward, reload, and remount paths have focused coverage.
- Chat role changes abort an obsolete stream rather than leaving a prior role turn active.
- Lesson activity drafts are scoped to exact session, revision, snapshot, and activity identity. Study notes/checklists, Recall answers, Tutor unsent revisions, Quiz selections, and code-reading fields restore after reload, retain input after failure, clear only after accepted submission, enforce size bounds, and fail closed on malformed storage.
- Interview setup, pending answer, and question drafts are separately scoped and bounded. Course Designer and Interview disclosure state recovers from server-owned pending operations after reload without persisting provider payloads in browser storage.

## Courses, Course Packs, and Studio

**Implemented baseline**

- Manual and guided Course creation require one explicit primary Course locale and persist it independently from UI locale.
- Draft creation is insert-only and rejects Course ID, slug, stable-identity, and cross-column collisions without mutating an existing Course. Idempotent operation IDs are bound to a request fingerprint; reuse with a different body fails closed.
- Cloning and Studio “add week” behavior preserve immutable published lineage and create distinct Draft revisions rather than reusing an existing identity.
- Course Pack intake separates validation from commit. Validation leads to a recoverable intake URL; Install and Open as draft require an explicit confirmation state and are never GET side effects.
- File-selection generation and identity checks prevent stale validation results from winning a later selection race. Pending actions are disabled and staged claims are atomic across competing actions.
- Open as draft preserves the immutable archived manifest source and creates a distinct personal Draft with parent/base-hash lineage. Published source content remains immutable and exportable.
- Staged import records enforce entry, diagnostic, and byte bounds, deterministic lifecycle ordering, expiry, and bounded cleanup retries. Unknown or expired staged state asks the user to reselect the file.
- Studio Preview renders learner-safe weekly, lesson, and activity structure without protected evaluation fields. Release evidence and change review use stable IDs and server-verified hashes.
- Guided Course Designer briefs are typed and localized. AI proposals remain Draft-only; confirmation, Apply, validation, and manual Publish are separate actions.

## Learning, Review, Skills, and Interview

**Implemented baseline**

- Learning Path and Course-revision path responses use the deterministic server/kernel `nextAction`; the browser does not invent progression.
- Session rendering selects the exact current Activity rather than the first superficially ready item. Learner briefs expose bounded outcomes, topics, sources, and completion criteria without protected material.
- Exercise state is bound to the exact session, exercise, and attempt. Diff, test, and review freshness cannot leak across attempts, and server-owned Lesson context supplies the breadcrumb.
- First-attempt-before-hint behavior and protected-answer redaction remain enforced.
- Review due state uses a server-owned `asOf`, provenance, and deterministic scheduling. A previously invented `/session` CTA was removed. The shared response now fails closed with no next-action link until a typed Review Activity executor exists.
- Skills uses a responsive table/compact breakpoint and an actionable Courses empty state.
- Interview terminology describes observations rather than false scoring. Completion does not claim technical correctness or directly set mastery.
- Interview disclosure operations are bound to exact setup/conversation or session/interview/question identities and payload hashes. Duplicate, expired, consumed, cancelled, ambiguous, or cross-scope operations fail closed; decline cancels the pending stage.

The Review queue is therefore implemented, but executable spaced Review remains incomplete and is a release blocker.

## Settings, providers, and Chat

**Implemented baseline**

- Settings projections use distinct cache keys while saving theme and locale atomically. Locale updates invalidate the complete settings family without corrupting richer cached projections.
- Provider readiness requires enabled, connected, authenticated, exact model availability, and required capabilities. Missing model/capability state remains explicit.
- The model selector is searchable and bounded. Technical model search uses locale-invariant normalization.
- A metadata-less provider connection is shown as read-only diagnostic state with an explicit managed-connection recovery action.
- Chat exposes localized generating, completed, failed, cancelled, and byte-limit states. Role selection is strict and URL-backed.
- The orchestrator can emit a minimized live tool summary containing only an allowlisted tool name and started/completed state. Arguments, results, provider call IDs, raw events, filesystem paths, and credentials are not exposed to the browser.

## Security and deterministic ownership

**Implemented baseline**

- Browser mutations remain typed entity/operation data and cannot select executables, arguments, working directories, filesystem handles, provider RPC, or credentials.
- Provider/model resolution remains server-owned and exact. External turns consume a scoped one-time disclosure; failure never silently changes to Mock.
- AI roles receive only finite Aptiloop-owned typed tools. Reviewer remains evidence-only and cannot write or apply a patch. Its `passed`/`changes_requested` verdict is advisory UI data only: the application records a separate `accepted` participation receipt after bounded semantic validation, then revalidates the immutable bundle SHA-256 and its exact passing check, environment, backend, workspace snapshot, and complete diff binding before completion. Bare legacy `passed` rows, impossible file/line references, out-of-scope topic suggestions, contradictory findings, stale checks, malformed output, and oversized output fail closed.
- Course Pack content remains declarative and untrusted; imported content cannot define process or provider authority.
- Published revisions, source manifests, session snapshots, accepted facts, and historical evidence remain immutable at their respective boundaries.
- Course selection, active revision, current session, review/evidence side effects, and next actions are explicitly Course-owned.
- The Learning Kernel, not a model or browser clock, owns deterministic progression, evidence reduction, mastery, review scheduling, and next-action selection.
- Complete Git-diff SHA-256 and structured check evidence remain the freshness authority; timestamps are not substituted.

## Verification evidence

The following commands were observed on the final hardening tree from the repository root:

| Gate                   | Observed result                                                       |
| ---------------------- | --------------------------------------------------------------------- |
| `npm run format:check` | Passed; all files conformed to Prettier.                              |
| `npm run lint`         | Passed, 13/13 workspace tasks.                                        |
| `npm run typecheck`    | Passed, 13/13 workspace tasks.                                        |
| `npm run test:fast`    | Passed, 23/23 Turbo tasks.                                            |
| `npm run build`        | Passed, 13/13 workspace builds; the Next.js build produced 23 routes. |
| `npm run test:e2e`     | Passed, 4/4 Playwright flows.                                         |
| `git diff --check`     | Passed with no whitespace errors.                                     |

`npm run verify` does not include E2E; the separate successful `npm run test:e2e` result above is the E2E evidence.

Focused shared, database, orchestrator, learning, provider-policy, Course Pack, Course Designer, Interview, Session, Settings, Chat, localization, and web component suites also covered rejection paths relevant to the changed contracts. Their evidence is included in `test:fast`; this audit does not replace the executable tests.

## Browser evidence

Focused in-app Browser runs exercised the principal route matrix before the changes and selected high-risk routes after the changes:

- Lesson desktop/mobile showed exact Course and Lesson breadcrumbs, the intended active Activity, AI Off state, responsive composition, and no horizontal overflow.
- Studio Preview used the exact version/tab URL and rendered the learner-safe empty/preview state without overflow.
- Course Designer restored its server-owned pending/reload state at desktop width without observed console errors; a local visual capture was retained in the interactive task evidence but is not a release artifact.
- Session loaded the exact Course/Lesson context without observed warning or error output.
- Interview restored a manual topic draft after reload, preserved AI Off recovery, and did not enable Start without a valid available provider.
- Previously captured Home, Courses, Review, Settings, dark-theme, collapsed-shell, desktop, and mobile states were compared against the accepted Calm Workshop concept.

Late in the audit, the root Browser session refused additional local navigation under its URL policy, and no Course Pack browser surface was available in that session. Those paths were not bypassed with another browser mechanism. Automated component/integration coverage and the 4/4 E2E gate remained available, but this audit does not claim a second final visual pass for those blocked surfaces.

## Remaining limitations

1. **Typed Review execution:** Review scheduling, due state, and provenance exist, but no typed spaced-Review Activity executor exists. The UI intentionally exposes no fabricated next-action link. This is a Core Alpha release blocker.
2. **Course Pack staging durability:** validation staging is process-local. Restart requires reselecting the source, a process crash cannot run expiry timers, and there is no startup sweep for an orphan staging directory. Cleanup retries are bounded; the final expiry-timer cleanup error is suppressed, so an undeleted temporary directory can remain.
3. **Legacy Pack-bound drafts:** incompatible historical manifest-bound Drafts fail closed; this hardening does not silently rewrite or auto-migrate them.
4. **External-provider recovery and adversarial proof:** the focused Browser runs used AI Off. Disclosure/resume behavior and hostile Reviewer-output cases have deterministic integration coverage, while the authenticated 2026-08-10 OpenCode Zen smoke remains historical evidence for its own cutoff. No new request against an authenticated, exactly selected external provider/model was observed at this cutoff, so model-specific prompt discipline and adversarial Reviewer behavior remain unproven in a live runtime. Course Designer recovery GET matches revision/workflow but does not rederive current payload hash; a stale preview is rejected only at dispatch before provider work.
5. **Tool-summary history:** minimized tool summaries are a live Chat disclosure and are not promoted into durable provider/tool transcript authority.
6. **Accessibility certification:** semantic HTML, keyboard/focus behavior, responsive layouts, reduced motion, contrast tokens, and localized states have automated and browser evidence. A complete independent WCAG 2.2 AA audit across every route, locale, theme, zoom level, and assistive technology was not performed.
7. **Execution isolation:** the trusted local Execution Fabric is bounded but unsandboxed and must not run hostile or Course-defined commands.
8. **Distribution and legal gates:** no production Course, project license grant, third-party notice bundle, content/fixture terms, trademark policy, public distribution, or owner release sign-off is approved.

## Release disposition

The observed UI/UX and runtime hardening is an **Implemented baseline**. Core Alpha release acceptance remains an **Approved Core Alpha target**. The successful gates do not override the typed Review executor gap, legal/content/distribution gates, documented Browser limitations, or the absence of full accessibility certification.
