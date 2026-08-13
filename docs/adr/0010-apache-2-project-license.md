# ADR 0010: Apache-2.0 Project License

## Status

**Implemented baseline**

## Date

2026-08-13

## Supersedes

[ADR 0009: Licensing Model](0009-licensing-model.md)

## Context

ADR 0009 recorded a cautious engineering proposal to place the integrated application under `AGPL-3.0-only` and reserve `Apache-2.0` for possible future SDKs. No license was applied by that decision.

The owner subsequently reviewed permissive and reciprocal licensing models against Aptiloop's local-first, clone-and-run, self-hosting goals. On 2026-08-13, Yan Yushkov (`nayvok`) explicitly selected `Apache-2.0` for first-party materials in this repository that he owns or controls and has authority to license. This decision replaces the AGPL proposal; it does not rewrite ADR 0009's historical record.

## Decision

- License first-party repository materials owned or controlled by Copyright 2026 Yan Yushkov (`nayvok`) under the Apache License, Version 2.0 (`Apache-2.0`), unless a file or directory states otherwise. Covered first-party materials include source code, tests, documentation, translations, development fixtures, and project-created visual assets.
- Do not use AGPL, dual licensing, a Business Source License, or custom source-available terms for the current project.
- Exclude user-authored and imported Courses, private or learner data, credentials, local databases, backups, exports, and other user-owned artifacts from the project license. Their owners and applicable terms do not change because Aptiloop stores or transports them.
- Preserve the independent licenses, copyright notices, and attribution requirements of third-party dependencies, fonts, assets, snippets, and other third-party components. Apache-2.0 does not relicense them.
- Treat a future Aptiloop-supplied Course or content catalog as a separately reviewed artifact with explicit provenance and terms. Aptiloop currently ships no first-party or sample Course.
- Keep any future proprietary module new, optional, and clearly separated from the Apache-2.0 project. No proprietary Aptiloop module exists in the current repository, and a future module cannot retroactively remove the Apache-2.0 grant from already licensed material.
- Treat names and branding separately. The Apache-2.0 grant does not authorize third parties to present a fork as the official Aptiloop product.

## Consequences

- Users and organizations may use, modify, redistribute, and commercially operate the covered work subject to Apache-2.0's conditions.
- The explicit Apache-2.0 patent grant and contribution patent terms are preferred over a shorter permissive license for this software platform.
- Apache-2.0 does not require a hosted service or downstream fork to publish its modifications. Aptiloop accepts that tradeoff to reduce adoption and integration friction.
- Copies already distributed under Apache-2.0 retain that license; a future licensing decision cannot revoke the grant for those copies while its terms are followed.
- Every distribution must preserve required project and third-party license and notice material. Artifact-specific dependency, font, asset, SBOM, and notice verification remains an independent release responsibility.
- User Courses and private data never become project-licensed merely by being created, imported, stored, backed up, or exported with Aptiloop.

## Alternatives considered

- **AGPL-3.0-only:** superseded because its network copyleft obligations add adoption and integration friction that the owner does not want for the current self-hosted project.
- **MIT or BSD:** permissive, but not selected because Apache-2.0 provides more explicit patent terms and a clearer contribution framework.
- **Business Source License or custom source-available terms:** not selected because they would restrict use and would not provide the conventional open-source grant intended for the current project.
- **Open core today:** unnecessary because the current repository contains no proprietary module. The decision preserves the option to add only new, clearly separated commercial modules later.

## Implementation status

**Implemented baseline**

The owner-approved Apache-2.0 grant is applied by the repository's root license and first-party package metadata. The README and current licensing boundary document define the covered and excluded material. Third-party notices, content provenance, trademarks, and tagged-artifact authorization remain separate compliance and release gates; they do not change the project license selected here.
