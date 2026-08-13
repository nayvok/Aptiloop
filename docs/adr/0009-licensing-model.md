# ADR 0009: Licensing Model

## Status

Superseded by [ADR 0010](0010-apache-2-project-license.md). The status recorded at the time was **Approved Core Alpha target**.

## Date

2026-08-08

## Context

The repository has no root `LICENSE`, `COPYING`, `NOTICE`, or third-party notice file, and its private workspace manifests do not declare an own-project license. Dependency metadata is not a project license and does not settle ownership of code, curriculum prose, translations, fixtures, screenshots, fonts, or contributions. The orchestrator currently integrates most internal packages, so directory boundaries alone do not establish legally separate works.

Related specifications: [Core Alpha licensing plan](../licensing/core-alpha-licensing-plan.md), [Core Alpha repository audit](../audits/2026-08-08-core-alpha-repository-audit.md), [Course Pack](../architecture/course-pack.md), and [Core Alpha migration strategy](../migration/core-alpha-migration-strategy.md). This ADR records an engineering recommendation, not legal advice.

## Decision

The owner approved the following engineering direction on 2026-08-08, subject to professional legal review and the recorded no-distribution deferrals:

- Use **AGPL-3.0-only** for the existing integrated application/server surface if and when professional counsel approves the exact included path matrix and a separate change applies the license text.
- Use **Apache-2.0** only for newly separated, genuinely reusable Course Pack, activity, and environment SDK packages after their boundaries, copyright ownership, contribution history, and dependency obligations are verified. This ADR does not claim that those packages exist or that any current package already qualifies.
- Do not dual-license or relicense existing code by inference. Any exception requires an explicit owner-approved path-level decision and verified authority from every copyright holder.
- Treat curriculum/content, exercise fixtures/templates, screenshots, fonts, sample databases, and learner-generated artifacts separately from software code. Choose explicit content/fixture terms only after provenance and redistribution scope are verified.
- Preserve upstream license and notice obligations; do not relicense dependencies. Produce a versioned third-party notice inventory and SBOM for each distributed source archive, binary, or container image, including transitive and font obligations.
- Establish contributor provenance/agreements, trademark and branding policy, provider-name usage rules, and a release checklist before public distribution.
- Exclude private databases, backups, learner attempts, secrets, generated captures, and unapproved fixtures from releases. Private data is never published or shared without an explicit owner/user action covering the exact artifact and destination.

## Consequences

- Public release is blocked until ownership, path boundaries, content provenance, notices, and counsel review are complete.
- If the owner and professional counsel approve and a separate change applies AGPL-3.0-only to the recorded integrated surface, counsel must determine the resulting network/source and combined-work obligations; packaging a folder separately is not evidence of legal separability.
- Apache-2.0 SDK boundaries require real architectural separation and ongoing dependency/notice maintenance.
- Content and trademark policies remain independent deliverables rather than being hidden inside the code license.

## Alternatives

- **License the entire repository Apache-2.0:** not recommended because it does not preserve the proposed reciprocal boundary for the integrated application.
- **License every current internal package differently by folder:** rejected because current imports and ownership have not established clean legal boundaries.
- **AGPL-3.0-or-later:** not selected by this proposal; changing the version grant is an owner/legal decision.
- **Dual licensing:** deferred until complete copyright ownership and contributor permissions are verified.
- **Remain private with no license:** possible before distribution, but insufficient for the intended public release and contribution model.

## Implementation status

**Implemented baseline:** no own-project license or notice set is present. The lockfile contains dependency license metadata, but upstream texts, notices, provenance, distribution contents, and trademark permissions have not been fully verified.

**Approved Core Alpha target:** AGPL-3.0-only for the approved integrated surface and Apache-2.0 only for qualifying newly separated SDK packages, subject to professional legal review. No license text is added by this ADR.

**Future:** any dual-license program, commercial exception, contribution program, or separately licensed content catalog.

No license application or public release is authorized. Ownership, contributor authority, content/fixture terms, artifact distribution scope, dependency notices/SBOM, and trademark/contribution policy remain explicitly deferred and release-blocking pending professional legal review.
