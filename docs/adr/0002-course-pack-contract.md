# ADR 0002: Declarative Course Pack Contract

## Status

Accepted product constraint; implementation pending approval gate

## Date

2026-08-08

## Context

Aptiloop needs a portable authoring and distribution unit without turning imported learning content into executable code. The current curriculum is embedded in TypeScript and seeds, is primarily Russian, and has no general import/export contract. Existing exercise templates are trusted repository content and must not be mistaken for safe third-party pack content.

Related specifications: [Course Pack](../architecture/course-pack.md), [Course authoring](../product/course-authoring.md), [Language policy](../product/language-policy.md), [Lesson Engine](../architecture/lesson-engine.md), [Knowledge system](../architecture/knowledge-system.md), [Environment Packs](../architecture/environment-packs.md), and [Threat model](../security/threat-model.md).

## Decision

A Course Pack is a declarative, schema-versioned description of one `Course` and its immutable `CourseRevision` graph.

- A pack declares metadata, one primary course locale, optional translations, stable activity IDs, a finite activity graph, Source Snapshot and Knowledge Capsule references, skill mappings, and `environmentId`/`checkIds` references.
- UI locale is independent. Core Alpha must provide `en-US` and `ru-RU` UI catalogs without requiring a course to provide both locales.
- Packs may reference a registered environment contract through `environmentId` and trusted checks through `checkIds`. They must not contain commands, arguments, scripts, plugins, executable hooks, secrets, credentials, provider configuration, filesystem handles, or arbitrary network/tool definitions.
- Unknown schema versions and unknown fields fail validation. Import is bounded, staged, content-hashed, and transactional; validation completes before installation or authoring.
- Publishing creates an immutable revision. Edits occur in a draft or a personal adaptation branch and never rewrite a published revision.
- Pack import does not grant execution trust. Any future executable learning asset requires a separate trust model and sandbox decision.
- Core Alpha ships no production courses. Audit fixtures, seed content, and current hardcoded Russian curricula are migration inputs, not compliant production packs.

## Consequences

- Packs can be inspected, validated, localized, diffed, and reproduced without running author code.
- Environment and execution capabilities stay app-owned and can evolve independently of course content.
- Stable IDs, canonical serialization, hashes, and immutable revisions become compatibility obligations.
- The V1 importer must enforce UTF-8/JSON byte, nesting, item, string, parse-time, duplicate-key, unsafe-URL, forbidden-path-field, and transactional-publication limits. Archive/directory transport and its extraction controls are Future.

## Alternatives

- **TypeScript/JavaScript course modules:** rejected because import would execute publisher code.
- **Arbitrary exercise repositories inside packs:** rejected because package scripts and test commands cross the trusted-code boundary.
- **Mutable course records:** rejected because sessions, evidence, citations, and adaptation must remain replayable against the authored revision.
- **One locale for UI and course content:** rejected because product chrome and authored pedagogy have separate translation lifecycles.

## Implementation status

**Implemented baseline:** the repository has versioned curriculum rows, stable unit IDs, published-content guards, immutable session snapshots, protected learner DTOs, and a strict curriculum editor. It does not have Course Pack serialization, bounded import/export, locale separation, pack validation, or pack installation. Current trusted exercise templates remain outside this contract.

**Approved Core Alpha target:** the declarative contract above is normative; no future package or importer is claimed to exist.

**Future:** signed distribution, remote catalogs, executable asset trust, and marketplace workflows.

No major implementation is authorized until the Core Alpha audit/specification set passes the owner approval gate.
