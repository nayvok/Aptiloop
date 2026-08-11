# Course Pack V1

**Document status:** Course Pack V1 validation, local intake/lifecycle, Authoring Kit, and Adaptive Studio import/export/open-as-draft surfaces are an **Implemented baseline**. Production Course approval, registries/signatures, and archive transport retain their labels below.
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
- structurally installable only when its schemas, finite graph, references, learner/protected split, declared requirements, and installed Activity renderer registry close. This validation does not prove that every product-level executor exists end to end.

## Implemented baseline

**Implemented baseline.** `@aptiloop/course-authoring-kit` defines the strict Course Pack V1 Zod contract, deterministic diagnostics, canonical JSON/SHA-256 rules, limits profile, generated JSON Schema, typed exports, CLI, and a clearly labeled development-only fixture. The same `validateCoursePackBytes` implementation is used by the local kit and orchestrator import boundary.

**Implemented baseline.** The orchestrator accepts one bounded byte stream, validates it in a private expiring staging directory, retains a byte/count-bounded LRU set of validation reports, revalidates the exact staged bytes/hash at commit, and atomically claims each validation before filesystem I/O. Install publishes and activates the immutable imported revision. Open-as-draft first materializes that same canonical revision as an immutable archived, non-learning source, then creates a distinct mutable personal Draft with explicit parent and based-on-hash lineage. Pack-only capability, knowledge, and protected-answer metadata is inherited without overwriting editable Draft source/question fields.

**Implemented baseline.** Migration `0011_course_pack_lifecycle` stores immutable canonical manifests/localizations/knowledge nodes plus append-only lifecycle events and bounded quarantine records; it does not store pre-commit staging handles or files. Same-action re-import is idempotent; cross-action, key/hash, occupied-branch, and existing-Course primary-locale conflicts fail closed. Uninstall preserves learner facts and is rejected while an active learning session pins the revision. The Courses UI exposes one accessible file-selection control, validation report/Preview/provenance/requirements/hash, explicit Install/Open-as-draft, canonical source export, and confirmed uninstall.

**Implemented baseline limitation.** V1 is one local JSON document. It never fetches content and cannot define commands, processes, providers, plugins, credentials, arbitrary files, or execution environments. No production Course is bundled or approved.

### Intake lifecycle and recovery

**Implemented baseline.** Validation returns an opaque validation ID and expiry. The intake route may recover its bounded report and Preview with a non-consuming `GET /api/course-packs/validations/:validationId`; reload and browser Back/Forward therefore restore the same view while the originating orchestrator process and validation remain alive. GET never installs, publishes, activates, or opens a Draft. Confirmation query state is presentation only.

**Implemented baseline.** Consequence requires a strict POST carrying a unique operation ID, the selected `install | open-as-draft` action, and the exact Preview content hash. The server claims the staged validation before asynchronous file/database work, re-reads and revalidates the staged bytes and both hashes, then performs one transaction. Concurrent commits, changed bytes, changed action under the same operation, and expired or missing validation fail closed.

**Implemented baseline limitation.** Pre-commit validation state is process-local: at most 32 validation records, at most 100 retained diagnostics and 64 KiB per report, with a 15-minute expiry. Orchestrator restart loses the in-memory validation index, so a restored intake URL becomes missing and requires explicit file reselection; no Pack is committed from the orphaned file. Expiry cleanup is best effort, retries transient `EPERM`/`EBUSY` removal three times, and cannot run after an abrupt process death. There is no startup sweep for orphaned temporary staging directories.

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
    "subjectTags": ["javascript"],
    "provenance": {
      "contentStatus": "personal",
      "author": "Example author",
      "origin": "original",
      "ownership": "owned",
      "licenseSpdx": null,
      "termsUrl": "https://example.invalid/course-terms",
      "attribution": "Illustrative Course Pack contract example.",
      "createdAt": "2026-08-12T00:00:00.000Z",
      "notes": null
    }
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
    "activityTypes": ["study"],
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
  "lessons": [
    {
      "lessonId": "lesson-1",
      "order": 0,
      "title": "Start here",
      "description": "A minimal learner-safe lesson.",
      "goal": "Acknowledge the first activity.",
      "estimatedMinutes": 5,
      "knowledgeNodeIds": [],
      "entryActivityIds": ["study-1"],
      "activities": [
        {
          "activityId": "study-1",
          "schemaVersion": 1,
          "order": 0,
          "type": "study",
          "title": "Read",
          "description": "Read the bounded body.",
          "estimatedMinutes": 5,
          "required": true,
          "prerequisiteActivityIds": [],
          "capabilityIds": [],
          "knowledgeNodeIds": [],
          "sourceSnapshotIds": [],
          "completionCriteria": [{ "type": "acknowledgement" }],
          "payload": { "type": "study", "body": "Example content." },
          "protectedMaterial": { "referenceAnswer": null, "questions": [] }
        }
      ]
    }
  ]
}
```

### Closed root fields

The eight root fields shown above are the complete V1 root schema; any other root field is an error. `course`, `revision`, `requirements`, and `knowledge` are strict objects. `lessons` and `localizations` are bounded arrays.

`localizations` entries have the closed shape `{ locale, releaseComplete, fields }`. `fields` is a map from a stable path such as `lesson/<lessonId>/title` or `activity/<activityId>/payload/body` to a translated string or translated string list. A path must resolve to a field declared localizable by its installed schema; structural, protected, identifier, hash, capability, environment, check, and evaluation fields are never localizable.

Each lesson record has the closed shape `{ lessonId, order, title, description, goal, estimatedMinutes, knowledgeNodeIds, entryActivityIds, activities }`. Each activity record has the closed shape `{ activityId, schemaVersion, order, type, title, description, estimatedMinutes, required, prerequisiteActivityIds, capabilityIds, knowledgeNodeIds, sourceSnapshotIds, completionCriteria, payload, protectedMaterial }`.

V1 has no generic activity-level `environmentId` or `checkIds`. An exercise carries the app-owned trusted check reference only as `payload.testCommandId` inside its strict exercise payload:

```json
{
  "type": "exercise",
  "exerciseId": "exercise-1",
  "acceptanceCriteria": ["The trusted check passes."],
  "constraints": [],
  "template": "exercise-template-1",
  "testCommandId": "core.node-test",
  "hintPolicy": "learner-requested",
  "reviewPolicy": "evidence-only"
}
```

### Identity and revision fields

| Field                | Rule                                                                                                                          |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `courseKey`          | Stable lowercase ASCII slug, unique in the local library. It identifies lineage, not a database row.                          |
| `revisionKey`        | Stable opaque identifier unique within the Course; never reused for different canonical content.                              |
| `revisionNumber`     | Positive, monotonic within the upstream lineage; not used as identity.                                                        |
| `parentRevisionKey`  | Required except for the root revision; must resolve within imported/local lineage.                                            |
| `branchKind`         | Closed union `upstream \| personal`. Core Alpha adaptation writes only to `personal`.                                         |
| `basedOnContentHash` | Required for a personal revision and must match its immutable parent.                                                         |
| `contentHash`        | `sha256:` plus lowercase digest over the canonical pack payload excluding the `contentHash` field itself and import metadata. |

An imported upstream revision never mutates an existing revision. Identical revision key, content hash, and lifecycle action is an idempotent re-import. Reusing that identity with different content or a different `install | open-as-draft` action is a hard conflict. A personal branch records parent/based-on provenance and never overwrites upstream content. Its Draft head remains mutable only through validated authoring operations; publication creates an immutable personal revision.

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
- `estimatedMinutes`, declared `capabilityIds`, `sourceSnapshotIds`, and `knowledgeNodeIds`;
- strict `protectedMaterial`, stored server-side and excluded from learner projections.

Only the exercise payload may carry a trusted check ID, as `testCommandId`; it still cannot carry an executable, argv, command string, shell fragment, working directory, environment map, credential, filesystem handle, provider/model ID, raw URL to be fetched by a model, or a state-transition instruction.

### Knowledge objects

Source Snapshots and Knowledge Capsules follow [knowledge-system.md](knowledge-system.md). Pack snapshots include provenance, capture timestamp, canonical source URL, content hash, media type, locale, attribution/license metadata, retention mode, nullable content for `metadata-only`, and required `privacyClass: "public" | "private"`. Capsules include `createdAt`, claims, citations, conflicts, creation provenance, and validation hash; they are never executable prompt templates.

**Implemented baseline limitation.** `privacyClass` remains in the content-hashed canonical Course Pack manifest and Preview, but the normalized `source_snapshots` row does not currently persist that field. Provider disclosure/privacy policy must use the manifest-bound classification (or fail closed); it must never infer public eligibility from the normalized snapshot row alone.

### Requirements

`requirements` is a deduplicated, sorted declaration derived from content and checked against it:

- `activityTypes`: every type used by an activity, no extra unknown values;
- `capabilities`: product capability IDs, not provider marketing names;
- `environmentIds`: currently derived as empty because V1 has no environment field;
- `checkIds`: exact trusted check IDs derived from exercise `payload.testCommandId` values.

A pack cannot define a new capability, environment, check, renderer, plugin, or command. It can only reference an identifier already registered by the installed Aptiloop build. Unknown activities or capabilities are publication blockers, even if an importer could otherwise preserve the JSON.

## Validation and publication

**Implemented baseline.** Validation is deterministic, side-effect free through the semantic phase, and returns stable diagnostics `{code, severity, path, entityId, message}`.

1. **Envelope:** UTF-8, JSON object, exact format/version, byte/depth/item limits, no duplicate JSON keys, no unknown fields.
2. **Shape:** all closed schemas, string/array bounds, IDs and locales.
3. **Identity:** unique stable IDs/orders, parent/hash consistency, canonical hash match.
4. **Graph:** every reference resolves in the same revision; prerequisite graph is acyclic; at least one entry activity exists; every required activity is reachable; no self-edge; no impossible completion dependency.
5. **Activity semantics:** type/payload/criterion agreement; referenced questions/options/checks/sources exist; protected evaluation is present where an objective evaluator requires it and excluded from learner-visible projections.
6. **Registry/renderer closure:** installed registries recognize every declared Activity, capability, environment, and check; activity payload schemas and renderer types close. This is structural availability, not proof that a product-level executor can start and complete every activity.
7. **Knowledge/provenance:** snapshot hashes/citations resolve; HTTPS/source metadata and attribution/license requirements pass. V1 does not resolve `sourceAuthorityId` against a future official-source registry.
8. **Locale completeness:** primary locale complete; declared release-complete overlays complete.
9. **Security:** reject executable or secret-shaped fields, unsafe URLs, HTML active content, forbidden local/UNC/device/traversal path values, credential-like values, invalid UTF-8, duplicate JSON keys, and excess byte/depth/item/string/parse limits.
10. **Canonicalization:** recompute requirements and hash; mismatch blocks import/publication.

`Validate` is not `Publish` and is not end-to-end runtime readiness. Publication requires an explicit user action after a zero-error report and a change summary. Publishing atomically stores immutable content, hash, lineage, validation report version, and timestamp. A model may propose changes only to a draft; it cannot validate as authority, apply without user action, or publish.

**Implemented baseline limitation.** `spaced-review` is a recognized schema/renderer type, so a Pack may pass structural validation, while the due-Review projection still has no typed server-verified executor and exposes no next action. Validation must not be cited as evidence that executable spaced Review exists; the UI remains fail-closed until the **Approved Core Alpha target** executor is implemented.

### Import transaction

- Parse and validate in a staging area without touching the active Course.
- Resolve identity conflicts and show the user the target Course/revision.
- Persist Course, revision, activities, sources, capsules, and provenance in one transaction.
- Apply only the explicitly selected consequence: Install publishes and activates the imported immutable revision; Open-as-draft archives the canonical imported source and creates a separate mutable personal Draft. Publishing that edited Draft is a later explicit action.
- On failure, roll back the transaction and retain only a bounded diagnostic; never partially merge.
- Re-import is deterministic and idempotent only for the same revision key, content hash, and lifecycle action; a changed action under the same identity conflicts.

Course Pack V1 is a JSON document, not an archive format. **Future.** If an archive transport is introduced, it requires separate limits and rejection of traversal, absolute/drive/UNC/device/ADS names, duplicate/confusable entries, links/reparse points, and compression bombs before extraction. Archive support does not relax the no-executable rule.

## Completed migration from the legacy graph

**Implemented baseline.** The additive Course-foundation and Course Pack migrations inventoried legacy curriculum/session/evidence records, mapped provable Course/revision/lesson/activity identities while preserving stable IDs and lineage, and quarantined unknown or ambiguous meaning rather than coercing it. Target Course Pack imports now write immutable manifest/content records and lifecycle events through target repositories; legacy fixed-completion mutations are retired while compatibility reads remain preserved.

Legacy authored source objects remain SourceReference/capture candidates rather than silently becoming approved snapshots or licensing proof. Protected answers remain server-only, and existing session snapshots/evidence stay pinned to their original revision. New imports, Drafts, and publications never rewrite those historical bytes.

**Future.** Public Course registries, signing, trust stores, delta packs, executable exercises from third parties, and production Course distribution are outside Core Alpha.
