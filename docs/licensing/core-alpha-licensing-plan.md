# Core Alpha Licensing Boundary

## Document status

**Implemented baseline**

On 2026-08-13, the owner approved and applied the Apache License, Version 2.0 (Apache-2.0) to the covered Aptiloop material defined below:

> Copyright 2026 Yan Yushkov (nayvok)

The repository root LICENSE contains the license grant, NOTICE records the project notice and scope boundary, and first-party package metadata identifies Apache-2.0. ADR 0010 records the decision and supersedes the earlier AGPL engineering proposal.

This document explains the intended repository boundary and release-compliance work. It is not legal advice. Professional review of ownership, third-party obligations, trademarks, and particular distribution artifacts remains appropriate, but the Aptiloop project license is selected and applied; it is not pending.

## 1. License decision

**Implemented baseline**

First-party materials in this repository that Yan Yushkov owns or controls and has authority to license are available under Apache-2.0, unless a file or directory states otherwise. Covered first-party materials include source code, tests, documentation, translations, development fixtures, and project-created visual assets.

This permissive license supports Aptiloop's local-first, clone-and-run, and self-hosting goals:

- individuals and organizations may use, modify, redistribute, and commercially operate the covered work subject to the license conditions;
- hosted services and downstream forks are not required to publish their modifications;
- the license provides an explicit patent grant and patent-termination terms;
- required copyright, license, NOTICE, and modification notices must be preserved as applicable; and
- the license provides the covered work without warranties or conditions beyond its stated terms.

Copies distributed under Apache-2.0 retain that grant while recipients comply with its terms. A later licensing decision cannot retroactively withdraw it from those copies.

## 2. Covered and excluded material

**Implemented baseline**

| Category                                           | Licensing treatment                                                                                                                                                                |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First-party application and server source          | Covered by Apache-2.0 when owned or controlled by Yan Yushkov, including the first-party code in apps, packages, scripts, tests, build files, and repository configuration.        |
| First-party documentation                          | Covered by Apache-2.0 when owned or controlled by Yan Yushkov, including root documentation and docs.                                                                              |
| User-authored or imported Courses and Course Packs | Excluded from the project license. Their authors, owners, source licenses, and pack-specific terms continue to control them.                                                       |
| Private, user, and learner data                    | Excluded, including learner state, attempts, evidence, mastery, transcripts, private sources, and personal adaptations.                                                            |
| Credentials and local persistence                  | Excluded, including provider keys, credential stores, SQLite databases and journals, caches, backups, and runtime state.                                                           |
| Exports and transfer bundles                       | Excluded as user data. Aptiloop's processing or container format does not relicense their contents.                                                                                |
| Third-party components                             | Not relicensed. Dependencies, fonts, assets, snippets, provider SDKs, and other third-party material retain their own copyrights, licenses, notices, and attribution requirements. |
| Aptiloop name and branding                         | Not granted as trademark rights by Apache-2.0. Reasonable attribution and description of origin do not authorize a fork to present itself as the official Aptiloop product.        |

The application intentionally ships without a bundled first-party or sample Course. A fresh user creates a personal Course or explicitly imports a trusted Course Pack. This product boundary means no production Course license is required for the course-free application distribution.

A future Aptiloop-supplied Course, sample pack, curriculum artifact, or content catalog requires its own provenance review and explicit terms. Merely storing or processing a Course in Aptiloop never places it under Apache-2.0.

## 3. First-party and content inventory

**Implemented baseline**

This inventory helps reviewers distinguish covered project source from material that needs separate treatment.

| Material                        | Repository location or example                                                                                            | Current treatment and review concern                                                                                                                                                                                                   |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Integrated application          | apps/web and apps/orchestrator                                                                                            | First-party source is covered when owned or controlled by the licensor.                                                                                                                                                                |
| Domain and runtime packages     | packages/shared, learning-core, exercise-core, database, agent-core, provider adapters, prompt library, and authoring kit | First-party source is covered when owned or controlled by the licensor; bundled third-party material retains its own terms.                                                                                                            |
| Curriculum package              | packages/curriculum                                                                                                       | First-party program source may be covered, but authored Course prose, imported sources, quotations, and other content need a separate provenance and content-license determination. Development curriculum is not a production Course. |
| Exercise templates and fixtures | workspaces/exercises and test fixtures                                                                                    | First-party source fixtures may be covered; copied or adapted teaching content and executable examples still require provenance. Learner attempts are excluded private data.                                                           |
| Documentation                   | README, PRODUCT, root specifications, and docs                                                                            | First-party documentation is covered. Quotes, screenshots, linked content, marks, and embedded third-party assets retain separate obligations.                                                                                         |
| Screenshots and visual assets   | README captures, audit evidence, icons, and branding                                                                      | Confirm ownership, privacy, depicted provider marks, and asset terms before including each item in a release artifact.                                                                                                                 |
| Font assets                     | Geist and generated web output                                                                                            | Preserve the SIL Open Font License and any required notices for distributed font files.                                                                                                                                                |
| Runtime and private artifacts   | .data, SQLite/WAL files, backups, learner attempts, credentials, and local captures                                       | Excluded from source and release artifacts and from the project-license scope.                                                                                                                                                         |

## 4. Dependency inventory

**Implemented baseline**

The current direct dependency families include:

- root tooling: npm workspaces, Turborepo, TypeScript, ESLint, Prettier, tsx, Vitest, and type packages;
- orchestrator: internal Aptiloop packages, Hono, @hono/node-server, and Zod;
- web: Next.js, React, Radix/shadcn components, Phosphor icons, TanStack Query, React Hook Form, React Markdown, remark-gfm, Geist, Sonner, Tailwind utilities, Playwright, and Testing Library tooling;
- packages: Zod, the OpenCode SDK, Drizzle ORM and Kit, tsup, and test/build tooling; and
- constrained Pi runtime: pinned @earendil-works/pi-ai and @earendil-works/pi-agent-core packages. Aptiloop does not expose pi-coding-agent's general filesystem, shell, edit, or write tools.

Earlier lockfile inventory identified common MIT, Apache-2.0, MPL-2.0, BSD-3-Clause, ISC, LGPL, SIL Open Font License, Creative Commons, and other license metadata. Examples included MIT metadata for Hono, React, Next.js, Radix, TanStack Query, Zod, OpenCode, and the pinned Pi packages; Apache-2.0 metadata for TypeScript, Playwright, Drizzle ORM, and class-variance-authority; and SIL Open Font License metadata for Geist.

Lockfile metadata is an inventory lead, not complete compliance evidence. It neither changes the Aptiloop license nor proves what a source archive, browser bundle, standalone build, or container actually contains.

**Approved Core Alpha target**

For every distributed artifact, verify the exact package and version, upstream source, full license text, copyright holder, required notice file, modification status, bundled assets, optional platform packages, and actual inclusion. Artifact-sensitive transitive leads include MPL-licensed platform packages, sharp/libvips variants with LGPL or composite metadata, caniuse data, fonts, and optional native packages.

Security audit disposition and license compliance are independent gates. An SBOM or vulnerability report does not replace the required license and notice review.

## 5. Content, privacy, and trademark controls

**Approved Core Alpha target**

1. Record whether every distributed curriculum item, exercise, example, translation, quotation, and source-derived passage is original, factual, adapted, quoted, or copied.
2. Preserve source attribution and the applicable license or permission for third-party Course content. A link to MDN, TypeScript, React, TanStack, or another source does not itself grant copying rights.
3. Keep user Courses, private sources, learner attempts, databases, backups, exports, credentials, and local provider state out of source and release artifacts.
4. Review screenshots for learner data, private paths, credentials, provider/model names, source code, and third-party marks before distribution.
5. Preserve font- and asset-specific terms and include only assets authorized for the relevant distribution channel.
6. Maintain a separate trademark and branding policy if the project needs rules beyond Apache-2.0's trademark clause. The code license does not grant rights to the Aptiloop name, logo, domains, or third-party provider/project marks.
7. Generate SBOM and third-party notice material from the artifact that actually ships, rather than from an assumed source dependency graph.

## 6. Future proprietary modules

**Future**

Aptiloop may later offer optional commercial or proprietary modules, but none exists in the current repository.

Any such module must be:

- new and clearly separated from the Apache-2.0 project by source, package, dependency, build, artifact, documentation, and licensing boundaries;
- optional, so the Apache-2.0 core remains independently usable;
- covered by explicit terms that do not claim exclusive rights over third-party or Apache-2.0 material; and
- unable to revoke or narrow the Apache-2.0 grant already applied to covered Aptiloop versions.

Moving or copying Apache-2.0 project code into a proprietary directory does not erase the existing license grant. A future open-core design therefore requires a deliberate architectural and legal review rather than a folder name alone.

## 7. Distribution and release review

**Implemented baseline**

The root Apache-2.0 license applies now to the covered work. Public visibility, repository cloning, and source redistribution may rely on that grant subject to its terms. The source no longer has a no-license status.

The project NOTICE defines the current project-level notice and exclusion boundary. It is not a complete third-party notice bundle for every possible build or container.

**Approved Core Alpha target**

Before calling a tagged Core Alpha artifact release-approved:

1. verify that the licensor owns or controls every included first-party contribution and has authority to license it;
2. inventory the exact source archive, npm package, browser/standalone build, container, documentation, screenshot, font, and asset payloads;
3. include the Apache-2.0 license, applicable NOTICE material, and all required third-party licenses and notices;
4. preserve required modification notices and source attribution;
5. produce and review an artifact-specific SBOM;
6. exclude credentials and private/runtime/user data;
7. complete content, fixture, screenshot, font, asset, and trademark review; and
8. obtain owner release sign-off and professional legal review appropriate to the intended distribution.

These artifact and legal-review gates do not suspend, qualify, or make pending the Apache-2.0 license already applied to the covered repository material. They determine whether a particular release has completed the project's compliance and acceptance process.

## 8. Decision history

**Implemented baseline**

- On 2026-08-08, the owner recorded an engineering proposal for AGPL-3.0-only on the integrated application and a possible future Apache-2.0 SDK split. No license was applied by that proposal.
- On 2026-08-13, Yan Yushkov (nayvok) superseded that proposal and explicitly selected Apache-2.0 for first-party repository materials he owns or controls and has authority to license.
- ADR 0010 records the current decision. The earlier ADR remains historical context and is not current approval evidence.
- User/imported Courses, private/user/learner data, credentials, databases, backups, exports, and third-party components remain outside the project-license grant.
- No proprietary Aptiloop module exists today. Any future proprietary module must be new and separately licensed.

The accurate current statement is:

> First-party materials in this repository owned or controlled by Copyright 2026 Yan Yushkov (nayvok), and which he has authority to license, are available under Apache-2.0 unless stated otherwise. User and learner data, user-authored or imported Courses, credentials, databases, backups, exports, and third-party components are not relicensed by Aptiloop.
