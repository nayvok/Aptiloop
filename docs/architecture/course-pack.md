# Course Pack V1

**Document status:** Approved Core Alpha target with Implemented baseline and migration findings.
**Scope:** declarative Course interchange, validation, publication, and migration. A Course Pack is not an execution, deployment, provider, or credential format.

## Purpose and invariants

**Approved Core Alpha target.** `Course` is the top entity. A Course owns an ordered lineage of immutable `CourseRevision` records. A Course Pack transports exactly one self-contained Course revision plus its declared, non-secret dependencies. Core Alpha ships no production Courses; bundled legacy curriculum and exercise fixtures are migration/test inputs only.

A valid V1 pack is:

- declarative JSON (UTF-8) whose root has `format: "aptiloop.course-pack"` and `formatVersion: 1`;
- strict: unknown fields are validation errors, not ignored extension points;
- finite and fully enumerable before import;
- deterministic under canonical JSON serialization and SHA-256 hashing;
- content-only: no commands, scripts, plugins, secrets, credentials, runtime state, learner state, provider sessions, absolute/local paths, or arbitrary network instructions;
- localized around one `primaryLocale`; application UI locale (`en-US` or `ru-RU`) is independent and is never inferred from Course content;
- publishable only if every activity type and required capability is known and available to the validator.

## Implemented baseline

**Implemented baseline.** The closest current graph is `curricula → curriculum_versions → curriculum_weeks → curriculum_days_v2 → curriculum_units`, with revision uniqueness and published-content immutability guards (`packages/database/migrations/0001_versioned_curriculum.sql:1-97,151-193`). Current shared contracts enumerate twelve unit types and use discriminated payloads (`packages/shared/src/curriculum.ts:63-77,188-262`). Publication currently checks only non-empty weeks/days/units and completion criteria before hashing and archiving the prior revision (`packages/database/src/authoring-repository.ts:624-685`). There is no Course Pack import/export endpoint or archive importer; the existing editor accepts bounded strict field mutations (`apps/orchestrator/src/curriculum-editor.ts:26-196`).

**Implemented baseline.** Published session content is copied into a schema-v2 snapshot and hashed, and learner reads redact reference answers/evaluation points (`packages/database/src/repository.ts:541-701,718-810`). These are preservation seams, not proof that Course Pack V1 exists.

## Normative V1 document shape

**Approved Core Alpha target.** The following is the logical schema. JSON Schema/Zod implementation must encode the same closed unions and limits.

```json
{
  "format": "aptiloop.course-pack",
  "formatVersion": 1,
  "course": {
    "courseKey": "javascript-foundations",
    "title": "JavaScript Foundations",
    "description": "...",
    "primaryLocale": "en-US",
    "availableLocales": ["en-US"],
    "subjectTags": ["javascript"]
  },
  "revision": {
    "revisionKey": "javascript-foundations@1",
    "revisionNumber": 1,
    "parentRevisionKey": null,
    "branchKind": "upstream",
    "basedOnContentHash": null,
    "contentHash": "sha256:..."
  },
  "requirements": {
    "activityTypes": ["study", "recall"],
    "capabilities": [],
    "environmentIds": [],
    "checkIds": []
  },
  "knowledge": {
    "nodes": [],
    "sourceSnapshots": [],
    "capsules": []
  },
  "localizations": [],
  "lessons": []
}
```

### Closed root fields

The eight root fields shown above are the complete V1 root schema; any other root field is an error. `course`, `revision`, `requirements`, and `knowledge` are strict objects. `lessons` and `localizations` are bounded arrays.

`localizations` entries have the closed shape `{ locale, releaseComplete, fields }`. `fields` is a map from a stable path such as `lesson/<lessonId>/title` or `activity/<activityId>/payload/body` to a translated string or translated string list. A path must resolve to a field declared localizable by its installed schema; structural, protected, identifier, hash, capability, environment, check, and evaluation fields are never localizable.

Each lesson record has the closed shape `{ lessonId, order, title, description, goal, estimatedMinutes, knowledgeNodeIds, entryActivityIds, activities }`. Each activity record has the closed shape `{ activityId, schemaVersion, order, type, title, description, required, prerequisiteActivityIds, capabilityIds, knowledgeNodeIds, sourceSnapshotIds, completionCriteria, payload }`. `environmentId` and `checkIds` are permitted only in a registered activity payload schema that declares the trusted Execution Fabric boundary; their values are IDs, never plans.


### Identity and revision fields

| Field | Rule |
|---|---|
| `courseKey` | Stable lowercase ASCII slug, unique in the local library. It identifies lineage, not a database row. |
| `revisionKey` | Stable opaque identifier unique within the Course; never reused for different canonical content. |
| `revisionNumber` | Positive, monotonic within the upstream lineage; not used as identity. |
| `parentRevisionKey` | Required except for the root revision; must resolve within imported/local lineage. |
| `branchKind` | Closed union `upstream | personal`. Core Alpha adaptation writes only to `personal`. |
| `basedOnContentHash` | Required for a personal revision and must match its immutable parent. |
| `contentHash` | `sha256:` plus lowercase digest over the canonical pack payload excluding the `contentHash` field itself and import metadata. |

An imported upstream revision never mutates an existing revision. Identical key+hash is an idempotent re-import. Identical key with a different hash is a hard conflict. A personal branch is a new immutable revision whose parent/based-on hash records provenance; adaptation never overwrites upstream content.

### Locale rules

- `primaryLocale` is exactly one well-formed BCP 47 tag and is the authored source of truth.
- `availableLocales` contains the primary locale and has no duplicates after canonical locale normalization.
- Every learner-visible required field is complete in the primary locale.
- Optional translations are overlays keyed by stable entity and field IDs. They may not change graph structure, completion rules, protected evaluation, capability requirements, or check IDs.
- App UI supports `en-US` and `ru-RU` independently. A Russian UI can run an English Course and vice versa.
- Missing primary-locale content is an error. Missing optional translation is a warning unless the publisher explicitly declares that locale release-complete.

### Lesson and activity fields

Each `lesson` has a stable ID, localized title/goal, topic/knowledge-node references, estimated minutes, and a finite `activities` array. Each activity has:

- stable `activityId` unique within the revision;
- `type` from the installed Activity Registry;
- localized learner-visible content;
- `required` boolean;
- explicit `prerequisiteActivityIds` (no implicit model-chosen edges);
- a payload validated by that activity type's closed schema;
- one or more closed completion criteria;
- declared `capabilityIds`, `sourceSnapshotIds`, `knowledgeNodeIds`, and optional trusted `environmentId`/`checkIds`.

Activity payloads may contain source/capsule/check identifiers. They may not contain an executable, argv, command string, shell fragment, working directory, environment map, credential, filesystem handle, provider/model ID, raw URL to be fetched by a model, or a state-transition instruction.

### Knowledge objects

Source Snapshots and Knowledge Capsules follow [knowledge-system.md](knowledge-system.md). Pack snapshots must include provenance, capture timestamp, canonical source URL, content hash, media type, locale, attribution/license metadata (or an explicit unresolved provenance blocker), and bounded captured content. Capsules contain claims and citations to immutable snapshots; they are never executable prompt templates.

### Requirements

`requirements` is a deduplicated, sorted declaration derived from content and checked against it:

- `activityTypes`: every type used by an activity, no extra unknown values;
- `capabilities`: product capability IDs, not provider marketing names;
- `environmentIds`: declarative trusted environment contracts;
- `checkIds`: trusted Execution Fabric checks allowed for the pack.

A pack cannot define a new capability, environment, check, renderer, plugin, or command. It can only reference an identifier already registered by the installed Aptiloop build. Unknown activities or capabilities are publication blockers, even if an importer could otherwise preserve the JSON.

## Validation and publication

**Approved Core Alpha target.** Validation is deterministic, side-effect free through the semantic phase, and returns stable diagnostics `{code, severity, path, entityId, message}`.

1. **Envelope:** UTF-8, JSON object, exact format/version, byte/depth/item limits, no duplicate JSON keys, no unknown fields.
2. **Shape:** all closed schemas, string/array bounds, IDs and locales.
3. **Identity:** unique stable IDs/orders, parent/hash consistency, canonical hash match.
4. **Graph:** every reference resolves in the same revision; prerequisite graph is acyclic; at least one entry activity exists; every required activity is reachable; no self-edge; no impossible completion dependency.
5. **Activity semantics:** type/payload/criterion agreement; referenced questions/options/checks/sources exist; protected evaluation is present where an objective evaluator requires it and excluded from learner-visible projections.
6. **Capability closure:** installed registries recognize every Activity, capability, environment, and check. Unknown Activity/runtime/check items block publication. Every required/terminal path has a deterministic/manual completion route; a required AI-only path is invalid, while unavailable optional AI does not block publication.
7. **Knowledge/provenance:** snapshot hashes/citations resolve; source protocols and official-source policy pass; unresolved attribution/license is a publication blocker when distribution is requested.
8. **Locale completeness:** primary locale complete; declared release-complete overlays complete.
9. **Security:** reject executable or secret-shaped fields, unsafe URLs, HTML active content, forbidden local/UNC/device/traversal path values, credential-like values, invalid UTF-8, duplicate JSON keys, and excess byte/depth/item/string/parse limits.
10. **Canonicalization:** recompute requirements and hash; mismatch blocks import/publication.

`Validate` is not `Publish`. Publication requires an explicit user action after a zero-error report and a change summary. Publishing atomically stores immutable content, hash, lineage, validation report version, and timestamp. A model may propose changes only to a draft; it cannot validate as authority, apply without user action, or publish.

### Import transaction

- Parse and validate in a staging area without touching the active Course.
- Resolve identity conflicts and show the user the target Course/revision.
- Persist Course, revision, activities, sources, capsules, and provenance in one transaction.
- Activate nothing automatically. Installation and publication/activation are separate explicit actions.
- On failure, roll back the transaction and retain only a bounded diagnostic; never partially merge.
- Re-import is deterministic and idempotent by revision key plus content hash.

Course Pack V1 is a JSON document, not an archive format. **Future.** If an archive transport is introduced, it requires separate limits and rejection of traversal, absolute/drive/UNC/device/ADS names, duplicate/confusable entries, links/reparse points, and compression bombs before extraction. Archive support does not relax the no-executable rule.

## Migration from the current graph

**Approved Core Alpha target.** Migration is additive and provenance-preserving:

1. Inventory every current `curricula`/revision/week/day/unit and legacy day/question/exercise row. Do not infer that current hardcoded content is approved for production.
2. Map current `curricula` to Course and `curriculum_versions` to immutable CourseRevision. Preserve IDs, revision numbers, parent IDs, status, and hashes as source provenance (`packages/database/migrations/0001_versioned_curriculum.sql:1-29`).
3. Map weeks/days/units to lessons/activities using stable IDs. Validate current types against the installed registry. Quarantine an unknown/malformed unit instead of coercing it to `study`.
4. Convert current source objects into Source Snapshot candidates. Current URLs/metadata do not constitute a snapshot or licensing proof (`packages/shared/src/curriculum.ts:27-51`; `packages/curriculum/src/versioned-types.ts:29-39`). Missing captured content/provenance remains an explicit blocker.
5. Preserve protected answers server-side. Never copy them into learner locale overlays, capsules supplied before an attempt, or model prompts (`packages/curriculum/src/versioned-types.ts:41-46,184-210`).
6. Keep existing session snapshots and evidence bound to their original revision. New Course revisions do not rewrite active/completed sessions (`packages/database/src/repository.ts:572-701`).
7. Create target provenance mappings from source table+ID to target ID. Unmatched rows are quarantined with a reason; none are deleted or silently attached.
8. Run dual-read parity before switching a caller. Remove the legacy compatibility write only after all persisted data is mapped and verified.

**Future.** Public Course registries, signing, trust stores, delta packs, executable exercises from third parties, and production Course distribution are outside Core Alpha.