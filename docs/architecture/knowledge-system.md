# Knowledge System

**Document status:** Approved Core Alpha target with an evidenced Implemented baseline.
**Purpose:** represent what a Course teaches, where claims came from, what the learner demonstrated, and what should be reviewed—without treating model text or mutable web pages as authoritative state.

## Implemented baseline

**Implemented baseline.** M2 stores immutable Course-owned Source Snapshots and Knowledge Capsules with hashes, provenance/rights metadata, claims/citations, and protected-material separation. M3 Course Pack V1 validates and transactionally imports declarative snapshot/capsule records and their references; the repository development fixture is not approved production content.

**Implemented baseline.** Versioned sessions pin their exact Course revision and learner-safe snapshot. M4 accepted facts are scoped to Course/revision/personal branch/session/activity/knowledge node and deterministically project mastery, mistake families, review items, and summary from a canonical fact frontier. Learner/model narrative alone remains unverified, and protected evaluator material remains server-only.

The active database still has no approved production Source Snapshot or Knowledge Capsule corpus. Live source acquisition, production provenance/licensing approval, Adaptive Studio editing, and Research Gateway behavior retain their target status.

## Entity model

**Approved Core Alpha target.** The Knowledge System owns the following immutable or append-only entities.

### KnowledgeNode

A Course-scoped concept or skill with stable identity across revisions:

- `knowledgeNodeId`, `courseId`, stable key;
- primary-locale title/description and optional locale overlays;
- kind `concept | procedure | skill | misconception-family`;
- prerequisite/related node IDs (finite validated references);
- optional external vocabulary IDs;
- creation provenance and lifecycle `active | superseded`.

A CourseRevision pins the exact node definitions it uses. Renaming a node does not rewrite evidence. Merging/splitting creates explicit supersession mappings.

### SourceReference

An authored pointer describing intended research material: canonical URL, source authority ID, title, expected locale/media type, locator, required flag, and learning goal. It is not evidence that content was fetched, reviewed, licensed, or unchanged.

### SourceSnapshot

An immutable local capture produced only by the Research Gateway:

```ts
type SourceSnapshot = {
  snapshotId: string;
  sourceAuthorityId: string;
  canonicalUrl: string;
  retrievedAt: string;
  retrievalMethod: "official-http" | "manual-import";
  mediaType: string;
  locale: string | null;
  contentHash: `sha256:${string}`;
  content: BoundedTextOrStructuredContent;
  title: string;
  authorPublisher: string | null;
  publishedOrUpdatedAt: string | null;
  attribution: string | null;
  licenseSpdx: string | null;
  termsUrl: string | null;
  locatorMap: readonly Locator[];
};
```

Snapshots are append-only and content-addressed. A refresh creates a new snapshot and a relation `supersedesSnapshotId`; it never overwrites the prior capture. Original bytes may be retained only when permitted and bounded; otherwise the snapshot stores an allowed extract plus hash/metadata and an explicit retention mode.

### KnowledgeCapsule

A bounded, reviewable set of normalized claims derived from snapshots:

```ts
type KnowledgeCapsule = {
  capsuleId: string;
  schemaVersion: number;
  courseRevisionId: string;
  knowledgeNodeIds: readonly string[];
  primaryLocale: string;
  claims: readonly {
    claimId: string;
    statement: string;
    citationIds: readonly string[];
    confidence: "direct" | "synthesized" | "conflicted";
  }[];
  citations: readonly {
    citationId: string;
    snapshotId: string;
    locator: Locator;
    quoteHash: `sha256:${string}`;
  }[];
  conflicts: readonly ConflictNote[];
  createdBy: "manual" | "typed-ai-proposal" | "migration";
  validationHash: `sha256:${string}`;
};
```

A capsule is content, not executable policy. It cannot contain a prompt that grants tools, commands, plugins, provider configuration, secrets, learner data, state-transition instructions, or mutable remote includes. AI-generated capsules remain proposals until schema, citation, coverage, and user-approval gates pass.

### Evidence

Append-only accepted facts from the Learning Kernel, scoped to Course branch, revision, session, activity, and KnowledgeNode. Evidence records type/outcome, timestamps, hint level, evaluator/check identity and version, content/diff hashes where needed, and provenance. Model narrative alone is never correctness evidence.

### MasteryProjection

Deterministic per-branch, per-node, per-dimension projection from accepted evidence. It records model version, source fact frontier/hash, full replay state, score, coverage/confidence, last evidence, and projection hash. It is replaceable by reprojection; facts are not.

### Mistake and ReviewItem

A Mistake is a deduplicated error-family observation with occurrence facts and correction status. A ReviewItem is a deterministic scheduled action referencing the evidence/mistake/node that created it. These concepts are specified in [learning-kernel.md](learning-kernel.md).

## Provenance rules

**Approved Core Alpha target.** Every learner-visible factual claim in a required Course activity must resolve through one of:

1. authored Course content with explicit author/provenance;
2. a Knowledge Capsule claim with one or more immutable Source Snapshot citations;
3. a clearly labeled learner/model hypothesis that is not presented as verified fact.

Citation locators are stable within a snapshot: heading/path plus paragraph index, page, timestamp range, or repository commit/path/line range. A raw mutable URL alone is insufficient. Quote hashes detect locator/content mismatch. Missing snapshot, broken locator, hash mismatch, or unresolved conflict blocks Course publication when the claim is required.

Protected evaluation is a separate server-only projection. It may cite snapshots/capsules but is never included in learner-safe context before the attempt. Current redaction behavior is a seam to preserve (`packages/curriculum/src/versioned-types.ts:41-46,184-210`).

## Lifecycle

1. Author registers a SourceReference using an approved authority.
2. User explicitly requests capture/research.
3. Research Gateway fetches bounded official content and writes a SourceSnapshot.
4. Manual authoring or a typed AI tool proposes capsule claims/citations.
5. Knowledge validation checks all references, hashes, locale, attribution/license state, and conflicts.
6. User accepts the capsule into a draft CourseRevision.
7. Course validation pins exact snapshot/capsule hashes.
8. Publication makes the revision immutable.
9. A later source refresh creates new snapshots/capsule proposals and a new Course/personal revision. Existing sessions retain their pinned content.

No background refresh silently changes a published Course or active lesson.

## Validation

- closed schema/version and byte/item/depth bounds;
- stable unique IDs and same-Course/revision ownership;
- canonical `https` URL and registered source authority;
- exact content and quote hashes;
- locator within retained content;
- every capsule claim has a citation unless explicitly marked unresolved (unresolved required claims block publication);
- no citation to a newer mutable alias when a snapshot ID is required;
- conflicts retained, not averaged away;
- primary Course locale complete; translations cannot alter claim meaning/citations;
- attribution/license/terms state explicit;
- no active HTML, scripts, commands, plugins, secrets, credentials, local paths, arbitrary remote includes, or learner-private data.

Unknown snapshot/capsule schema or capability blocks publication. Import may quarantine unknown data for inspection but cannot execute or publish it.

## Privacy and isolation

**Approved Core Alpha target.** Source content may enter provider context only through an explicit role tool and a bounded learner-safe projection. Learner answers, transcripts, local paths, provider credentials, and private author notes are excluded by default. Any external upload/share action must show exact destination and payload category and require explicit user action. Disabling AI leaves snapshots/capsules and manual authoring fully usable locally.

## Migration

1. Convert current source records to SourceReference candidates, not snapshots.
2. Retain their original JSON, Course/revision/unit IDs, and migration provenance.
3. Capture official content only through an explicit Research Gateway operation; do not infer capture from a URL.
4. Map topic strings to KnowledgeNode candidates with an owner-visible deduplication report. Ambiguity is quarantined, never auto-merged.
5. Map current evidence/mastery/mistakes/cards with source table/row provenance and confidence limits.
6. Pin target IDs/hashes into new revision/session snapshots; never rewrite existing snapshot JSON or history.
7. Switch knowledge/progress views only after dual-read parity.

**Future.** Cross-Course global ontology, collaborative knowledge graphs, remote indexes/vector stores, continuous crawling, and public capsule marketplaces are outside Core Alpha.
