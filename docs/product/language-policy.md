# Language and Locale Policy

## Document status

**Approved Core Alpha target** overall. Complete `en-US` and `ru-RU` application catalogs, explicit UI locale persistence, root document language, and locale-independent browser state are an **Implemented baseline**. Authored-resource publication completeness and full assistive-technology conformance remain gated separately. Aptiloop intentionally bundles no Course; any future first-party/sample Course would require its own translation and provenance evidence.

## Principles

1. Interface locale and Course locale are independent settings.
2. Core Alpha UI supports `en-US` and `ru-RU` with equal functional coverage.
3. Every Course declares exactly one primary locale.
4. Course translations are explicit, versioned resources; missing content is never silently disguised.
5. Machine contracts and learner evidence remain stable across locales.
6. Changing language never changes graph state, mastery, trusted checks, or revision identity.
7. Repository product/engineering specifications are written in English.

## Locale layers

### UI locale

**Approved Core Alpha target**

UI locale controls application-owned presentation:

- navigation, actions, form labels, help, validation, errors, recovery guidance, and notifications;
- accessibility names and descriptions;
- date, time, number, duration, and plural formatting;
- Settings, runtime/provider state, privacy prompts, import/export prompts, and Studio chrome;
- deterministic Learning Kernel explanations and evidence labels.

Supported values are `en-US` and `ru-RU`. Resolution order is deterministic: use the saved user setting; otherwise show an explicit first-run choice prefilled from a supported browser/OS locale (`ru`/`ru-*` → `ru-RU`, `en`/`en-*` → `en-US`, anything else → `en-US`). The prefill is not persisted until the user confirms it. Browser/OS changes never alter an existing saved preference silently. UI locale does not choose or prefill a Course locale.

**Implemented baseline**

The web application stores the confirmed UI locale under `aptiloop:ui-locale` in browser local storage and mirrors the same value to the `aptiloop.ui-locale` cookie for the server-rendered root language. Settings keeps a language selection under the allowlisted `aptiloop:ui-locale-draft` browser-session key until explicit Save or Cancel, so an unsaved selection survives Settings section changes, route exits, and reloads in the same browser session without changing the active locale. Save and Cancel clear that draft; Save applies the confirmed locale without Core availability or a database write. Blocked browser storage remains an explicit unsaved error rather than a false success. Malformed confirmed or draft values are discarded and fail closed to the active supported locale or first-run/default resolution path.

### Primary Course locale

**Approved Core Alpha target**

A Course declares one BCP 47 primary locale. The primary locale must be complete for all required learner-visible Course metadata, Knowledge Capsules, activities, protected evaluation text, and authoring diagnostics that belong to Course content.

The primary Course locale:

- does not follow the UI locale automatically;
- is part of immutable Course Revision metadata;
- participates in validation and content identity;
- cannot be changed in place on a published revision;
- may differ from both the user's UI locale and the programming language used in examples.

### Course translations

**Approved Core Alpha target**

A Course may include explicit translations keyed by BCP 47 locale and stable content identifiers. A translation:

- maps to the same Course, Activity Graph, activity IDs, source/capsule identities, and evidence contracts;
- does not translate code, commands, identifiers, paths, hashes, provider/model IDs, package names, API tokens, or trusted check IDs;
- may localize explanatory prose, titles, prompts, rubrics, captions, and approved feedback;
- declares completeness and provenance;
- is validated independently;
- becomes immutable with its Course Revision.

Core Alpha requires UI locales `en-US` and `ru-RU`; it does not require every Course to provide both. One primary Course locale is mandatory. Optional translations are Course-owned.

## Fallback behavior

**Approved Core Alpha target**

Fallback must be visible and deterministic:

1. use the explicitly selected Course translation when complete for the requested resource;
2. otherwise use the Course primary-locale resource;
3. label fallback content with its locale and explain missing translation in Studio/Preview;
4. never merge fragments from multiple locales inside one prompt, rubric, protected answer, or evidence payload without an explicit authored composite resource.

A missing required primary-locale resource is a validation error and blocks publication. A missing optional translation is a visible completeness warning or error according to the translation's declared release status; it never changes the underlying activity state.

## Stable and non-localized data

The following are locale-independent:

- Course, revision, branch, graph, activity, source, capsule, evidence, environment, and check stable IDs;
- schema keys, type discriminants, enum values, operation IDs, content hashes, and fingerprints;
- filesystem paths, URLs, MIME types, language/runtime identifiers, package names, and versions;
- code, test output, stack traces, API names, CLI commands, Git data, provider/model IDs, and credential field names;
- numeric mastery state and deterministic evidence facts.

User-facing descriptions of these values may be localized, but the values are never translated.

## Authoring requirements

**Approved Core Alpha target**

Adaptive Studio must:

- show the Course primary locale and current preview locale at all times;
- distinguish missing, fallback, stale, and complete translations;
- edit one locale resource explicitly rather than changing hidden parallel content;
- validate placeholder variables, Markdown/structured content, protected evaluation alignment, and locale coverage;
- preview right-to-left readiness even though Core Alpha ships no RTL UI locale;
- keep Apply, Validate, Preview, and Publish gates independent of locale switching;
- show exactly which localized fields an AI proposal would change.

External Course Packs declare primary locale and optional translation resources in data. Import rejects malformed locale tags, duplicate locale keys, translation references to unknown stable IDs, and required primary-locale omissions.

## AI and provider language

**Approved Core Alpha target**

- A role request declares the intended response/content locale explicitly.
- Provider/model capability does not override Course or UI locale policy.
- Before every external dispatch carrying private content, the user sees the stored role, provider/model, destination, selected Course/learner scope, locale, exclusions, and retention disclosure. Approval is consumed once; dispatch rejects a changed role, connection/provider/model, payload hash, status, or expiry. Comparing destination/entity IDs again at dispatch and rederiving Course Designer recovery-preview scope remain an **Approved Core Alpha target**.
- Model output is untrusted. It is schema-validated and labeled with provider/model provenance.
- Model-generated translation is a proposal against a draft, not approved Course content.
- Applying a translation proposal never publishes.
- Provider failure does not change locale or silently fall back to Mock.

## Privacy

Language selection is local preference data. Course translations, Source Snapshots, Knowledge Capsules, prompts, answers, transcripts, and evaluation material remain private by default. Translation or generation through an external provider is an explicit disclosure action and must identify the destination and payload categories.

Exported Course Packs include only selected Course locale resources. They exclude UI preferences, learner answers, evidence, transcripts, provider sessions, credentials, and unrelated private data.

## Content and terminology quality

- Use the normative English concepts from [Terminology](terminology.md).
- Translate for meaning and consistent product voice; do not transliterate machine terms unnecessarily.
- Preserve programming-language and library names.
- Avoid gendered assumptions, named owner data, employer-specific context, and culture-specific scheduling defaults in system UI.
- Examples in a Course may be culturally specific only when intentionally authored and identified as Course content.
- Error messages explain the failing layer and recovery action; they do not blame the user.
- State is not communicated by language or color alone; icons, text, semantics, and accessible descriptions agree.

## Formatting

Use locale-aware platform formatting with explicit time zone behavior where learning rules depend on UTC or local-day semantics. Store canonical timestamps and numeric facts independent of presentation. Never parse localized display strings back into domain state.

Code blocks, inline code, diffs, terminal output, and raw validation paths preserve source text and direction. Surround them with localized explanation rather than translating their content.

## Baseline migration status

**Implemented baseline**

The M7 application-shell migration moved application-owned navigation, state, validation, provider/runtime, accessibility, authoring, Course Pack, Review, and Interview strings into complete `en-US`/`ru-RU` catalogs with explicit locale persistence and parity checks. M11 kept Course locale independent from UI locale. Manual/guided creation and Course Pack import require explicit primary Course locale data, and immutable revision identity includes that locale. Existing Russian development Course content and historical documents remain intentionally untranslated fixtures/history rather than application-string fallbacks. Legacy identifiers remain stable rather than being translated in place.

**Approved Core Alpha target**

Remaining locale work is complete visible fallback behavior across every authored resource, publication evidence for primary-locale completeness, full assistive-technology and formatting verification in both UI locales, and any later additive migration required for retained legacy data. A future Aptiloop-supplied first-party/sample Course would additionally require translation-content and provenance evidence. These gates are not closed merely by catalog parity.

## Acceptance

Locale policy is not complete until:

- every Core Alpha user journey works in `en-US` and `ru-RU` UI;
- changing UI locale leaves Course content/state unchanged;
- selecting Course translation leaves graph/evidence/check identity unchanged;
- missing/fallback translations are visible and deterministic;
- publication fails for incomplete primary-locale content;
- import rejects invalid locale structures;
- private content is not sent for translation without explicit disclosure action;
- keyboard, screen-reader names, layout, truncation, date/number formatting, and mobile navigation are verified in both UI locales.
