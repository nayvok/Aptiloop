# Core Alpha Licensing Plan

**Document status:** Approved Core Alpha target for the engineering direction; professional legal review remains required. This document is an inventory and decision plan, not legal advice or a legal conclusion. It does not apply a license.

## 1. Current legal state

**Implemented baseline inventory:** the repository currently contains no root `LICENSE`, `COPYING`, `NOTICE`, or equivalent license grant. The root and reviewed internal `@aptiloop/*` package manifests are `private` and do not declare a `license` field. `private: true` prevents an accidental npm publish; it is not a license grant. A lockfile's upstream `license` metadata is not a license for Aptiloop and does not replace upstream license/notice texts.

Therefore, this plan must not describe Aptiloop as open source, AGPL-licensed, Apache-licensed, dual-licensed, or permissively reusable today. No `LICENSE`, `NOTICE`, `TRADEMARK`, dependency, manifest, or package-boundary change is made by this documentation set.

The absence of a license grant is stated as repository fact, not a conclusion about any person's rights or obligations. Professional open-source/IP counsel must review ownership, provenance, dependency obligations, proposed boundaries, and final text before publication.

## 2. First-party inventory requiring a decision

| Material                    | Current repository location/example                                                                                            | Risk/question                                                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| Integrated app/server       | `apps/web`, `apps/orchestrator`                                                                                                | Orchestrator imports most internal packages; directories alone do not establish a separable legal work.           |
| Domain/runtime packages     | `packages/shared`, `learning-core`, `exercise-core`, `database`, `curriculum`, `agent-core`, provider adapters, prompt library | Ownership and intended reusable SDK boundary are unverified. Current packages are private/no-license.             |
| Course/curriculum prose     | Russian authored prompts, answers, misconceptions, examples, source links                                                      | Determine original/adapted/copied status, authors, translations, attribution, and separate content terms.         |
| Exercise templates/fixtures | `workspaces/exercises/**`                                                                                                      | Distinguish product-controlled teaching fixtures from user attempts and executable content; establish provenance. |
| Documentation               | root/docs historical and Core Alpha specifications                                                                             | Confirm authors/contributors and whether docs follow code terms or separate terms.                                |
| Screenshots/branding        | Git history and future reviewed Aptiloop captures; product/provider names                                                      | Confirm ownership, depicted third-party marks, privacy, and permitted release scope.                              |
| Font assets                 | Geist via the web application/generated output                                                                                 | Preserve the SIL Open Font License terms for distributed font files.                                              |
| Runtime/private artifacts   | `.data`, SQLite/WAL/backups, learner attempts, generated acceptance captures                                                   | Must not enter a source/content release; ownership/privacy differs from project code.                             |

The Core Alpha application distribution intentionally contains no bundled Course. A fresh user creates a personal Course or explicitly imports a trusted Course Pack. Fixture/content distribution terms remain separate from application/SDK code, and any future first-party/sample Course needs its own approved terms and provenance; its absence does not block the course-free application artifact.

## 3. Dependency inventory

### Direct dependency families observed

- **Root tooling:** npm workspace/Turborepo, TypeScript, ESLint, Prettier, tsx, Vitest and type packages.
- **Orchestrator:** internal `@aptiloop/*`, Hono and `@hono/node-server`, Zod.
- **Web:** Next/React, Radix/shadcn components, Phosphor icons, TanStack Query, React Hook Form, React Markdown/remark-gfm, Geist, Sonner, Tailwind utilities, Playwright and Testing Library tooling.
- **Packages:** Zod, OpenCode SDK, Drizzle ORM/Kit, tsup and normal test/build tooling.
- **Pi runtime:** pinned `@earendil-works/pi-ai` and `@earendil-works/pi-agent-core` v0.84.1 are present behind the constrained app-owned adapter; their lockfile metadata is MIT. `pi-coding-agent` general filesystem, shell, edit, and write tools are not exposed through Aptiloop.

### License families visible in lockfile metadata

This metadata is an inventory lead, not final verification:

- the lockfile contains 741 package records with license metadata, led by MIT (571), Apache-2.0 (87), MPL-2.0 (24), BSD-3-Clause (16), ISC (13), LGPL-3.0-or-later (10), BSD-2-Clause (8), composite Apache/LGPL(/MIT) records (4), and smaller MIT-0, BlueOak, CC-BY-4.0, SIL Open Font License, CC0-1.0, and 0BSD groups;
- direct and common examples include MIT metadata for Hono, OpenCode SDK, React/ReactDOM, React Hook Form, React Markdown/remark-gfm, Next, Radix/shadcn, TanStack Query, Zod, and the pinned Pi packages; Apache-2.0 for Drizzle ORM, TypeScript, Playwright Test, and class-variance-authority; and SIL Open Font License metadata for Geist;
- artifact-sensitive transitive leads include MPL-2.0 `lightningcss` platform packages, LGPL/composite `sharp`/`sharp-libvips` variants, CC-BY-4.0 `caniuse-lite`, and optional platform packages. Presence in lock metadata does not prove that every record ships in every artifact.

Before any distribution, verify exact package/version, upstream source, full license text, copyright holder, notice file, bundled asset, modification status, optional-platform package, and whether it ships in source, standalone output, browser bundle, or container. The orchestrator image copies the complete installed dependency tree from its dependency stage, so dev/test dependency notices may be relevant to the shipped image; this requires artifact-level verification.

The 2026-08-10 security preflight reported zero production vulnerabilities and one full-tree graph-development-only low-severity `esbuild` advisory (`GHSA-G7R4-M6W7-QQQR`) through `tsup`; the repository policy reported it without an exception and found no High or Critical advisory. Security disposition and license compliance are separate gates; neither substitutes for the other.

## 4. Content, fixture, and trademark risks

1. **Curriculum/source provenance.** Source URLs to MDN, TypeScript, React, or TanStack do not prove that embedded prose/code may be copied. Record whether each item is original, factual, adapted, quoted, or copied; retain required attribution and license.
2. **Translations.** Confirm ownership/permission for Russian legacy text and future English/Russian translations; translation authorship may differ from source authorship.
3. **Course Pack terms.** A pack needs explicit code/content/asset/provenance fields. Application terms do not automatically grant rights to third-party course material.
4. **Fixtures versus production content.** Exercise templates, test cases, starter code, and sample packs need a deliberate fixture/content license. Learner attempts and private sources are never release fixtures.
5. **Screenshots.** Review learner/private data, source code, provider/model names, logos, and other marks before distribution.
6. **Fonts/assets.** Preserve font/asset-specific terms and include only assets whose distribution channel is covered.
7. **Trademarks.** Aptiloop naming, logo, domains, provider names, and references such as OpenCode, Codex, React, Next, MDN, shadcn, and Pi require a separate nominative-use/trademark policy review. A code license does not grant trademark rights.
8. **Generated artifacts.** SBOMs/notices must describe what actually ships. Exclude `.data`, databases, backups, attempts, caches, screenshots containing private content, and local auth material.

## 5. Licensing options for owner/counsel review

### Option A — AGPL-3.0-only integrated application

Apply `AGPL-3.0-only` to owner-approved first-party application/server and inseparable internal code, with separate terms for content/assets/fixtures and retained third-party licenses/notices.

- **Potential rationale:** a clear copyleft policy for the integrated local/web application and server surface, including network use concerns.
- **Unresolved work:** ownership/contributor permission, exact source-offer/compliance workflow, dependency compatibility, combined-work boundary, installer/container notices, content terms, and trademark policy.
- **Status:** **Future** alternative. Professional legal review would still be required.

### Option B — Recommended direction: AGPL application plus future Apache SDK split

Use `AGPL-3.0-only` for the existing integrated app/server surface. Use `Apache-2.0` only for newly separated, genuinely reusable Course Pack/activity/environment SDK packages created after boundaries, ownership, dependency composition, and release artifacts are verified.

Candidate future SDK concepts may include pure Course Pack schemas/validation, activity contracts, and Node/Python environment-contract types. Existing folders are not automatically Apache packages. Database/provider/orchestration/UI code, content, fixtures, and docs remain outside the Apache boundary unless counsel and owner explicitly classify them.

- **Potential rationale:** protect the integrated product while enabling deliberately designed interoperability SDKs.
- **Required clean boundary:** separate package ownership, manifests, dependency graph, build/release artifacts, tests, documentation, contribution policy, and notices; no copy of AGPL-only application code into the Apache artifact.
- **Status:** **Approved Core Alpha target.** The owner selected this engineering direction on 2026-08-08, subject to professional legal review; it is not applied by this plan.

### Option C — Single permissive or dual-license model

Consider Apache-2.0 for a broader owner-approved scope, or an explicit dual grant, only after complete ownership/contributor permission and business/legal review.

- **Risk:** a broad permissive grant may not match product intent; dual licensing requires clear copyright control and exact “OR” terms; neither resolves content/trademark/dependency obligations.
- **Status:** **Future** alternative. It is not selected for Core Alpha and would require separate owner and professional legal review.

## 6. Recommended decision sequence

1. **Freeze claims:** continue stating “no repository license grant” until approved texts are actually applied.
2. **Establish ownership:** identify the legal owner of every code/content/docs/fixture/screenshot/translation contribution; obtain contributor records/assignments or approved contribution terms.
3. **Build provenance ledger:** record source, author, license/permission, modifications, and attribution for first-party-looking content and external snippets/assets.
4. **Define release artifacts:** source archive, npm packages, web standalone output, orchestrator container, sample packs, docs, screenshots, and SBOM/notice bundle.
5. **Verify dependencies:** scan each release artifact, verify upstream texts/notices and reciprocal/file-level obligations, especially MPL and fonts.
6. **Approve matrix:** owner and professional counsel approve exact code/package/content/fixture/docs/asset/trademark terms and the AGPL variant.
7. **Separate future SDKs:** only after approval, create clean reusable packages and prove dependency/source separation before Apache-2.0 is applied.
8. **Apply in a separate change:** add license texts, SPDX/package metadata, contribution policy, third-party notices/SBOM, content terms, and trademark policy together with an artifact verification record.
9. **Release gate:** build artifacts match the approved matrix and contain required notices while excluding private/runtime data.

Implementation remains stopped before step 8. The M12 technical preflight generated a local CycloneDX SBOM and inspected candidate container contents, but it did not add a license grant, third-party notice bundle, content/fixture terms, or trademark policy.

## 7. Questions requiring explicit answers

### Ownership and contributors

- Which person or legal entity owns each existing code package, app, document, curriculum item, translation, exercise template/test, screenshot, and visual asset?
- Who contributed, under what terms, and are assignment, DCO, CLA, employment, or contractor records available?
- Did any AI-assisted contribution include third-party code/content, and what provenance review is required?

### License choice and boundary

- Is the application grant intended to be `AGPL-3.0-only` or `AGPL-3.0-or-later`? This plan recommends only the former direction pending review and does not choose it.
- Which exact future packages may be Apache-2.0, and which source/dependencies must be rewritten or separated first?
- Are database, provider adapters, prompt library, migrations, documentation, and examples part of the AGPL app, future SDK, or a separate category?
- Is any dual licensing intended, and does the owner control all copyright needed to offer it?

### Content and fixtures

- Are curriculum prose/code/examples original, adapted, quoted, or copied from MDN, TypeScript, React, TanStack, or other sources?
- What terms apply to Course Packs, sample content, exercise templates, tests, translations, screenshots, and generated documentation?
- If Aptiloop later supplies a first-party/sample Course, under what terms may third parties redistribute or modify that separate content artifact?
- How are private sources, learner attempts, databases, backups, and generated exports excluded from releases?

### Dependencies, distribution, and marks

- Which source, npm, standalone, desktop, container, and hosted distribution channels are intended?
- Who owns generation/review of third-party notices and SBOMs for every artifact and update?
- Have MPL/file-level obligations, Geist font terms, and optional/transitive packages been reviewed for actual shipped artifacts?
- Which Aptiloop names/logos/domains are claimed as marks, and how may provider/project names and logos appear in UI, docs, screenshots, and marketing?

## 8. Owner disposition recorded 2026-08-08

The owner approved Option B as the engineering direction and explicitly kept every unresolved legal/business category out of scope pending professional counsel:

1. **Ownership and contributors:** no public release or license grant until every included code, content, document, translation, fixture, screenshot, font/asset, and contribution has verified ownership/provenance and an approved contributor policy.
2. **Code license and boundary:** retain no-license status until counsel approves the exact AGPL-3.0-only integrated path matrix; Apache-2.0 remains limited to future genuinely separated SDKs after separate proof. No dual licensing is authorized.
3. **Content and fixtures:** keep development curriculum and exercise fixtures out of the normal fresh production profile. Ship no first-party/redistributable sample Course or Course Pack until its separate terms and provenance are approved. Other included translations, screenshots, and generated documentation retain their own applicable review requirements. Repository fixtures remain development evidence only.
4. **Distribution scope:** the owner authorized publication of the current source branch on 2026-08-13. That action does not authorize npm, standalone/desktop, tagged container, hosted distribution, or a license grant.
5. **Dependencies and notices:** no artifact ships until its exact dependencies, font/assets, license texts, notices, reciprocal obligations, and SBOM are reviewed and approved.
6. **Marks and contribution policy:** no public contribution launch, trademark policy, or marketing use of Aptiloop/provider/project marks is authorized until reviewed and approved.

The legal and artifact-distribution deferrals above remain release-blocking and do not authorize license text. Public visibility of the source branch grants no reuse rights. Absence of a bundled Course is the intended product boundary, not an additional release blocker.

## 9. Approval gates

No license is applied until all gates are signed off by owner and professional counsel:

- verified copyright ownership/contributor authority;
- approved exact AGPL variant and exact package/file boundary;
- proven clean separation for any future Apache SDK;
- content/fixture/docs/font/screenshot provenance and terms;
- dependency compatibility plus complete license/notice/SBOM for each shipped artifact;
- release exclusion of private/runtime data;
- approved contribution and trademark policies; and
- a separate implementation change adding the actual texts and metadata.

Until those gates close, the accurate public statement is: **the source repository is public, but it currently grants no project license; the engineering direction is owner-approved, while license application and tagged artifact distribution remain deferred pending professional legal review.**
