# ADR 0006: Source Snapshots and Knowledge Capsules

## Status

Approved Core Alpha target

## Date

2026-08-08

## Context

A URL is not durable learning evidence: content changes, disappears, or varies by locale and access. Conversely, copying an entire source into prompts or courses creates provenance, licensing, privacy, and token-budget risks. Aptiloop needs a local, immutable boundary between acquired source material and the bounded knowledge used by a course.

Related specifications: [Knowledge system](../architecture/knowledge-system.md), [Research Gateway](../architecture/research-gateway.md), [Course Pack](../architecture/course-pack.md), [Secrets and private sources](../security/secrets-and-private-sources.md), and [Learning Kernel](../architecture/learning-kernel.md).

## Decision

Aptiloop separates source capture from pedagogical use.

- A **Source Snapshot** is an immutable local record of acquired source material and provenance: stable ID, canonical locator, source kind, title/author when known, acquisition time and method, locale, content hash, media type, rights/attribution metadata, and bounded captured content or an explicit unavailable-content record.
- A **Knowledge Capsule** is an immutable, bounded, course-usable derivation from one or more Source Snapshots. It contains claims, excerpts where permitted, concepts, examples, citations to exact snapshot locations, locale, derivation provenance, and a content hash.
- A Course Revision pins capsule and snapshot IDs/hashes. Lesson rendering never relies on a live URL to preserve historical meaning.
- Capsules are evidence containers, not executable plugins. They contain no commands, scripts, secrets, tools, provider settings, or hidden mutable state.
- AI may propose a capsule, but publication requires schema validation, citation resolution, rights metadata, and explicit human approval. Generated prose is not treated as an authoritative source.
- Research access is app-owned, allowlisted, bounded, and explicit. Private learner/course data is never included in an external query or upload without a clear user action specifying destination and scope.
- Session Snapshots remain distinct: they pin the selected Course Revision and activity graph for one learning session; they do not replace source provenance.

## Consequences

- Courses remain reproducible when websites change, and claims can be traced to captured evidence.
- Local storage, retention, rights, redaction, and re-capture policies are required.
- Capsule updates create new immutable objects and a new Course Revision rather than mutating prior lessons.
- Not every source may be stored verbatim; rights metadata and unavailable-content records must make that limitation explicit.

## Alternatives

- **Store only URLs:** rejected because links are mutable and insufficient for replay or audit.
- **Embed raw source blobs directly in activities:** rejected because it duplicates content and obscures provenance and rights.
- **Treat model output as a source:** rejected because generated text is a derivation requiring citations and review.
- **Fetch live sources during every lesson:** rejected because it breaks offline behavior, privacy, determinism, and historical consistency.

## Implementation status

**Implemented baseline:** versioned curriculum source records carry titles, URLs, kinds, goals, and examples; session snapshots pin activity content and hashes. Source records lack complete author/license/attribution metadata, and there is no Source Snapshot, Knowledge Capsule, or bounded Research Gateway implementation.

**Approved Core Alpha target:** the two-object provenance model above is normative; no future storage package, crawler, or research adapter is claimed to exist.

**Future:** collaborative libraries, remote snapshot services, automated revalidation, and shared research indexes.

No major implementation is authorized until the Core Alpha audit/specification set passes the owner approval gate.
