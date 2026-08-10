# Research Gateway

**Document status:** Approved Core Alpha target. The repository has only precursor source fields; no target gateway is claimed as implemented.
**Purpose:** bounded retrieval from registered official sources into immutable local Source Snapshots. It is the only external-source path exposed to Aptiloop AI roles.

## Boundary

**Approved Core Alpha target.** Research is user-initiated, local-first, read-only, and fail-closed. The Gateway—not the browser and not the model—owns URL resolution, network policy, redirect policy, limits, content decoding, snapshot hashing, and persistence.

A role tool accepts a registered source authority/reference ID and a bounded query/locator. It does not accept an arbitrary URL, HTTP method, headers, body, cookies, credentials, proxy, filesystem path, or shell command. Models cannot browse freely or select a network destination.

**Implemented baseline.** The only current precursor is authored source metadata: current schemas allow URL-bearing source records but do not constrain URL protocol to official authorities and do not capture immutable content (`packages/shared/src/curriculum.ts:16-52`; `packages/curriculum/src/versioned-types.ts:20-39`). That is an audit finding, not gateway compliance.

## Official source registry

**Approved Core Alpha target.** `SourceAuthority` is app-owned configuration, reviewed and versioned with the product:

```ts
type SourceAuthority = {
  authorityId: string;
  displayName: string;
  allowedOrigins: readonly HttpsOrigin[];
  allowedPathPrefixes: readonly string[];
  redirectOrigins: readonly HttpsOrigin[];
  allowedMediaTypes: readonly string[];
  extractionProfileId: string;
  attributionPolicy: "required" | "best-effort";
  termsUrl: string;
};
```

Rules:

- HTTPS only, except a dedicated test adapter in tests.
- Exact normalized hostname/origin and allowed path prefix; no wildcard public suffixes.
- DNS and every redirect target are revalidated. Redirect count is bounded.
- Reject userinfo, fragments for retrieval authority, non-default embedded ports unless registered, IP literals, localhost, loopback, link-local, multicast, private/reserved ranges, and DNS rebinding results.
- No browser cookies, ambient cloud credentials, provider tokens, or arbitrary request headers.
- GET only; no form submission, login, upload, or state-changing request.
- Repository sources pin an exact commit/tag resolved by an authority-specific adapter; mutable `main` alone is not an immutable snapshot.

Adding/changing an authority is an application release/configuration decision, not Course Pack content and not a model action.

## Request and result contracts

```ts
type OfficialResearchRequest = {
  operationId: string;
  sourceReferenceId: string;
  purpose: "capture" | "refresh" | "verify-citation";
  locator?: RegisteredLocator;
  query?: string;
};

type ResearchResult =
  | {
      status: "captured";
      snapshotId: string;
      contentHash: string;
      diagnostics: readonly Diagnostic[];
    }
  | { status: "not-modified"; snapshotId: string }
  | {
      status: "blocked" | "failed";
      code: ResearchFailureCode;
      retryable: boolean;
      diagnosticId: string;
    };
```

The Gateway resolves `sourceReferenceId` from the draft Course/Knowledge System, verifies its authority, applies a canonical locator/query, retrieves bounded content, converts it to inert text/structured blocks, and returns only the stored snapshot ID/hash plus diagnostics. Raw active HTML is never passed to a role or renderer.

Idempotency is mandatory. Same operation ID plus identical canonical request returns the prior result. A conflicting replay fails. Identical bytes/metadata may reuse the content-addressed snapshot; changed content creates a new snapshot linked to the prior one.

## Bounds

**Approved Core Alpha target.** Initial Core Alpha defaults are conservative and configurable downward per authority:

- 5 requests per explicit research operation;
- 3 redirects per request;
- 10 seconds connect and 30 seconds total per request;
- 5 MiB compressed response, 10 MiB decoded text;
- 50,000 extracted blocks and 200,000 tokens total per operation;
- no recursive link traversal; depth is always zero;
- one concurrent operation by default;
- bounded diagnostic and persisted error sizes.

**Approved Core Alpha target.** Whatever numeric defaults are approved, byte, time, request, redirect, token/block, and concurrency budgets must exist and must abort fail-closed. Partial content cannot satisfy a required Source Snapshot unless explicitly marked truncated, and truncated required snapshots block Course publication.

## Extraction and snapshots

1. Resolve and validate authority/reference.
2. Fetch with an app-owned minimal client and no ambient credentials.
3. Validate status, final URL, media type, encoding, and size while streaming.
4. Decode to inert normalized blocks; remove scripts, styles, forms, images/resources, event handlers, embeds, active Markdown/HTML, and hidden navigation noise.
5. Record canonical URL, redirect chain, retrieval time, response validators, publication/update metadata when observable, attribution/terms/license state, media type/locale, extraction profile version, and hashes.
6. Build stable locators and quote hashes.
7. Persist the immutable Source Snapshot in one transaction.
8. Return a bounded result. A model can subsequently read only the requested, learner-safe snapshot slice through a separate typed tool.

Provider web-search/browsing features are not a substitute: they have different destination, credential, retention, citation, and reproducibility semantics. If a provider can browse autonomously, that capability is disabled for Aptiloop roles.

## Typed role tools

| Tool                              | Input                                                                   | Output                                | Authority                                                            |
| --------------------------------- | ----------------------------------------------------------------------- | ------------------------------------- | -------------------------------------------------------------------- |
| `research.requestOfficialCapture` | registered source reference ID, purpose, optional bounded locator/query | snapshot ID/hash or typed failure     | User action is required before execution.                            |
| `knowledge.readSnapshotSlice`     | snapshot ID, registered locator, byte/token limit                       | inert text blocks with locator/hash   | Read-only; rejects learner-private/protected fields.                 |
| `knowledge.proposeCapsule`        | snapshot IDs, KnowledgeNode IDs, bounded claims                         | typed capsule proposal with citations | Draft proposal only; cannot apply/publish.                           |
| `knowledge.verifyCitations`       | capsule proposal ID                                                     | deterministic diagnostics             | Local validator; no network unless user separately requests refresh. |

A model cannot invoke the capture tool without an application-issued approval token scoped to the exact source references and operation. UI text or web content never supplies approval.

## Privacy

**Approved Core Alpha target.** Official retrieval requests contain no learner answers, transcripts, mastery, mistakes, local paths, repository contents, provider credentials, author private notes, or unrelated Course content. A query is either authored locally by the user or shown in the point-of-action disclosure. Any provider-assisted synthesis receives only selected snapshot slices after explicit role invocation; private data is never uploaded/shared implicitly.

Snapshot capture is distinct from sending content to an AI provider. The UI displays these as two separate actions with destination and data category. No-AI mode supports capture, manual reading, citation, and capsule authoring entirely locally.

## Failure behavior

| Failure                                                            | Required behavior                                                                           |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| Unknown authority/reference, disallowed URL/IP/redirect/media type | `blocked`, persist bounded diagnostic, no snapshot.                                         |
| Timeout, DNS/TLS/HTTP failure, limit exceeded                      | `failed`, retain prior snapshot unchanged, no partial authoritative capture.                |
| Changed content                                                    | create a new snapshot; never overwrite or silently update a published Course.               |
| Offline/no network                                                 | explicit offline state; existing snapshots remain readable.                                 |
| Provider unavailable                                               | capture remains independent; optional AI capsule proposal is blocked with no Mock fallback. |
| Citation/hash mismatch                                             | block capsule/Course validation until repaired in a new draft.                              |
| Terms/licensing disallow retention                                 | store only permitted metadata/extract mode or block; do not evade source policy.            |

Failures never complete a lesson, validate a capsule, publish a Course, or change mastery.

## Migration

1. Treat existing source objects as SourceReference candidates.
2. Normalize only approved HTTPS official URLs; quarantine other protocols/unknown authorities.
3. Require an explicit user capture to create each first Source Snapshot.
4. Pin snapshots/capsules only in a new draft/personal CourseRevision.
5. Keep existing sessions on their old snapshot content; do not fetch during resume.
6. Introduce role tools only after the network and persistence boundary is implemented and verified.

**Future.** General web search, crawling, authenticated sources, browser automation, private repositories, remote vector search, scheduled refresh, and collaborative source libraries are outside Core Alpha.
