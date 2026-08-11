# Knowledge System

**Document status:** **Approved Core Alpha target** with an evidenced **Implemented baseline** for local persistence, Course Pack import, session pinning, and kernel projections.
**Purpose:** represent what a Course teaches, where claims came from, what the learner demonstrated, and what should be reviewed—without treating model text or mutable web pages as authoritative state.

## Implemented baseline

**Implemented baseline.** M2 stores immutable Course-owned Source Snapshots and Knowledge Capsules with hashes, provenance/rights metadata, claims/citations, and protected-material separation. M3 Course Pack V1 validates and transactionally imports declarative snapshot/capsule records and their references; the repository development fixture is not approved production content.

**Implemented baseline.** Versioned sessions pin their exact Course revision and learner-safe snapshot. M4 accepted facts are scoped to Course/revision/personal branch/session/activity/knowledge node and deterministically project mastery, mistake families, review items, and summary from a canonical fact frontier. Learner/model narrative alone remains unverified, and protected evaluator material remains server-only.

Production content approval is a release decision rather than an architecture invariant; the dated status is recorded in the [2026-08-12 runtime-hardening audit](../audits/2026-08-12-ui-ux-runtime-hardening.md). Live source acquisition, production provenance/licensing approval, and dedicated Adaptive Studio editing for snapshots/capsules retain **Approved Core Alpha target** status; this does not describe the implemented general Course Studio as missing.

## Entity model

**Implemented baseline.** Course-owned KnowledgeNode, SourceSnapshot, KnowledgeCapsule, Evidence, mastery/mistake/review, and session-pin records are persisted behind strict shared contracts. **Approved Core Alpha target.** A first-class SourceReference authoring/retrieval workflow and dedicated snapshot/capsule editor remain target behavior.

### KnowledgeNode

**Implemented baseline.** A Course-scoped concept or skill with stable identity across revisions:

- `knowledgeNodeId`, `courseId`, stable key;
- primary-locale title/description and optional locale overlays;
- kind `concept | procedure | skill | misconception-family`;
- prerequisite/related node IDs (finite validated references);
- optional external vocabulary IDs;
- creation provenance and lifecycle `active | superseded`.

A CourseRevision pins the exact node definitions it uses. Renaming a node does not rewrite evidence. Merging/splitting creates explicit supersession mappings.

### SourceReference

**Approved Core Alpha target.** An authored pointer describing intended research material: canonical URL, source authority ID, title, expected locale/media type, locator, required flag, and learning goal. It is not evidence that content was fetched, reviewed, licensed, or unchanged. Legacy source metadata is only a migration candidate for this contract.

### SourceSnapshot

**Implemented baseline.** An immutable local capture admitted through validated non-network Course Pack/manual import. **Approved Core Alpha target.** Research Gateway is the only component that may resolve and fetch an external source; importing already selected bytes does not grant network authority.

```ts
type SourceSnapshot = {
  snapshotId: string;
  courseId: string;
  revisionId: string;
  sourceAuthorityId: string;
  canonicalUrl: string;
  retrievedAt: string;
  retrievalMethod: "official-http" | "manual-import";
  mediaType: string;
  locale: string | null;
  contentHash: `sha256:${string}`;
  content: BoundedTextOrStructuredContent | null;
  title: string;
  authorPublisher: string | null;
  publishedOrUpdatedAt: string | null;
  attribution: string | null;
  licenseSpdx: string | null;
  termsUrl: string | null;
  locatorMap: readonly Locator[];
  retentionMode: "full" | "extract" | "metadata-only";
  supersedesSnapshotId: string | null;
};
```

Snapshots are append-only and content-addressed. A refresh creates a new snapshot through `supersedesSnapshotId`; it never overwrites the prior capture. `metadata-only` requires `content: null`; `full` and `extract` require bounded retained content. The shared normalized SourceSnapshot contract has no `privacyClass` field.

Course Pack V1 separately requires `privacyClass` and preserves it in the content-hashed canonical manifest and intake Preview. The current normalized `source_snapshots` row does not copy that transport field. Any provider/privacy decision must resolve the manifest-bound classification or fail closed; absence from the normalized row is never evidence that a source is public.

### KnowledgeCapsule

**Implemented baseline.** A bounded, reviewable set of normalized claims derived from snapshots:

```ts
type KnowledgeCapsule = {
  capsuleId: string;
  courseId: string;
  revisionId: string;
  schemaVersion: number;
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
  conflicts: readonly {
    conflictId: string;
    claimIds: readonly string[];
    status: "unresolved" | "resolved";
    note: string;
    resolution: string | null;
  }[];
  createdBy: "manual" | "typed-ai-proposal" | "migration";
  validationHash: `sha256:${string}`;
  createdAt: string;
};
```

A capsule is content, not executable policy. It cannot contain a prompt that grants tools, commands, plugins, provider configuration, secrets, learner data, state-transition instructions, or mutable remote includes. AI-generated capsules remain proposals until schema, citation, coverage, and user-approval gates pass.

### Evidence

**Implemented baseline.** Append-only accepted facts from the Learning Kernel, scoped to Course branch, revision, session, activity, and KnowledgeNode. Evidence records type/outcome, timestamps, hint level, evaluator/check identity and version, content/diff hashes where needed, and provenance. Model narrative alone is never correctness evidence.

### MasteryProjection

**Implemented baseline.** Deterministic per-branch, per-node, per-dimension projection from accepted evidence. It records model version, source fact frontier/hash, full replay state, score, coverage/confidence, last evidence, and projection hash. It is replaceable by reprojection; facts are not.

### Mistake and ReviewItem

**Implemented baseline.** A Mistake is a deduplicated error-family observation with occurrence facts and correction status. A ReviewItem is a deterministic scheduled action referencing the evidence/mistake/node that created it. These concepts are specified in [learning-kernel.md](learning-kernel.md).

## Provenance rules

**Approved Core Alpha target.** Every learner-visible factual claim in a required Course activity must resolve through one of:

1. authored Course content with explicit author/provenance;
2. a Knowledge Capsule claim with one or more immutable Source Snapshot citations;
3. a clearly labeled learner/model hypothesis that is not presented as verified fact.

Citation locators are stable within a snapshot: heading/path plus paragraph index, page, timestamp range, or repository commit/path/line range. A raw mutable URL alone is insufficient. Quote hashes detect locator/content mismatch. Missing snapshot, broken locator, hash mismatch, or unresolved conflict blocks Course publication when the claim is required.

Protected evaluation is a separate server-only projection. It may cite snapshots/capsules but is never included in learner-safe context before the attempt. The learner-safe/protected split in the curriculum and Course boundary schemas is a seam to preserve.

## Lifecycle

**Implemented baseline — import lifecycle.** Explicitly selected Course Pack bytes are validated before one transaction persists immutable snapshots/capsules and their exact Course/revision ownership; imported citations, hashes, retention mode, provenance, and conflicts must close. The canonical Pack manifest retains transport-only metadata such as `privacyClass`. Course publication and session creation pin immutable content; later Draft/import work never rewrites an existing session.

**Approved Core Alpha target — live capture and editing lifecycle.**

1. Author registers a SourceReference using an approved authority.
2. User explicitly requests capture/research.
3. Research Gateway fetches bounded content and writes a SourceSnapshot.
4. Manual authoring or a typed AI tool proposes capsule claims/citations.
5. Knowledge validation checks all references, hashes, locale, attribution/license state, and conflicts.
6. User accepts the capsule into a draft CourseRevision.
7. Course validation pins exact snapshot/capsule hashes.
8. Publication makes the revision immutable.
9. A later source refresh creates new snapshots/capsule proposals and a new Course/personal revision. Existing sessions retain their pinned content.

No background refresh silently changes a published Course or active lesson.

## Validation

**Implemented baseline — local/import validation:** closed schema/version and byte/item/depth bounds; stable unique IDs and same-Course/revision ownership; canonical HTTPS URL shape plus a declared `sourceAuthorityId`; exact content/quote hashes and citation references; retention/content consistency; conflicts retained; locale and attribution/license/terms state explicit; and no active code, secrets, credentials, local paths, arbitrary remote includes, or learner-private data. Course Pack validation does not prove that a declared source authority is present in a future official-source registry.

**Approved Core Alpha target — live Gateway/editor validation:** resolve the declared authority through the installed registry, prove locators within captured content, reject mutable aliases where a snapshot ID is required, require every accepted claim to cite captured evidence, and prevent an unresolved required claim from publication.

Unknown snapshot/capsule schema or capability blocks publication. Import may quarantine unknown data for inspection but cannot execute or publish it.

## Privacy and isolation

**Implemented baseline.** Course Pack intake exposes the manifest-bound `privacyClass` in Preview and preserves it in canonical Pack bytes; normalized snapshot persistence alone is not a complete privacy-policy source. Provider context construction must retain/re-resolve that classification or fail closed.

**Approved Core Alpha target.** Source content may enter provider context only through an explicit role tool and a bounded learner-safe projection. Learner answers, transcripts, local paths, provider credentials, and private author notes are excluded by default. Any external upload/share action must show exact destination and payload category and require explicit user action. Disabling AI leaves snapshots/capsules and manual authoring fully usable locally.

## Migration

**Implemented baseline.** Additive migrations retain original legacy JSON/IDs and provenance, map only provable Course/revision/activity/knowledge/evidence relationships, quarantine ambiguous meaning, persist immutable imported Source Snapshots/Capsules, pin target IDs/hashes into new sessions, and leave existing session snapshots/history unchanged. Quarantine is a completed accounting outcome, not a SourceReference or captured Snapshot; compatibility history remains readable but cannot become stronger target truth.

**Approved Core Alpha target.** Live official-source capture must occur only through an explicit Research Gateway operation; a URL or legacy source pointer never implies that capture occurred.

**Future.** Cross-Course global ontology, collaborative knowledge graphs, remote indexes/vector stores, continuous crawling, and public capsule marketplaces are outside Core Alpha.
