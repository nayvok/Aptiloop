# Aptiloop Documentation Index

This index identifies the current authority for product, architecture, design, security, operations, and dated evidence. A document can contain both **Implemented baseline** and **Approved Core Alpha target** sections; the nearest explicit status label governs.

Historical documents preserve decision and migration context. They are not current implementation or approval evidence unless a current specification links to an explicitly dated result. This current index supersedes document classifications recorded by older audits only for navigation and authority; the dated audit text remains unchanged evidence for its own cutoff.

## Start here

- [README](../README.md) — current onboarding, commands, safety boundary, and release blockers.
- [Product contract](../PRODUCT.md) — normative product intent, users, boundaries, and release behavior.
- [Roadmap](../ROADMAP.md) — mixed current milestone status ledger and release gate.
- [Repository rules](../AGENTS.md) — mandatory engineering, security, data, language, and verification rules.

## Current product specifications

- [Core Alpha scope](product/core-alpha-scope.md)
- [User journeys](product/user-journeys.md)
- [Terminology](product/terminology.md)
- [Language policy](product/language-policy.md)
- [Course authoring](product/course-authoring.md)

## Current architecture

- [Architecture overview](../ARCHITECTURE.md)
- [Course Pack](architecture/course-pack.md)
- [Learning Kernel](architecture/learning-kernel.md)
- [Lesson Engine](architecture/lesson-engine.md)
- [Knowledge system](architecture/knowledge-system.md)
- [Execution Fabric](architecture/execution-fabric.md)
- [Environment Packs](architecture/environment-packs.md)
- [Provider Hub](architecture/provider-hub.md)
- [Pi runtime](architecture/pi-runtime.md)
- [Research Gateway](architecture/research-gateway.md)
- [Workspaces and editors](architecture/workspaces-and-editors.md)
- [Deployment models](architecture/deployment-models.md)
- [Data model](data-model.md)

## Current design and accessibility

- [Design system](../DESIGN.md)
- [Design implementation reference](design-system.md)
- [Information architecture](design/information-architecture.md)
- [Activity renderers](design/activity-renderers.md)
- [Adaptive Studio](design/adaptive-studio.md)
- [Accessibility](design/accessibility.md)

## Current security and operations

- [Security policy](../SECURITY.md)
- [Self-hosting boundary](../SELF_HOSTING.md)
- [Threat model](security/threat-model.md)
- [AI boundaries](security/ai-boundaries.md)
- [Secrets and private sources](security/secrets-and-private-sources.md)
- [Execution isolation](security/execution-isolation.md)
- [Untrusted Course Packs](security/untrusted-course-packs.md)
- [Provider connections](providers.md)
- [Development](development.md)
- [Troubleshooting](troubleshooting.md)
- [Current database operations](migration/current-database-operations.md) — the only current runbook for valuable process-mode SQLite inventory, approved backup, authorized forward migration, and whole-file recovery.
- [Local data portability](data-portability.md) — explicit local-profile export and create-only offline restore without credentials or workspace files.
- [Core Alpha migration strategy](migration/core-alpha-migration-strategy.md)
- [M2 migration and recovery record](migration/m2-course-foundations-runbook.md) — dated M2 evidence and cutoff-specific recovery; not a substitute for the current migration strategy.
- [Core Alpha licensing plan](licensing/core-alpha-licensing-plan.md) — engineering inventory and owner disposition, not legal advice or a license grant.

## Architecture decisions

See the [ADR index](adr/README.md). ADR status records a decision at its stated date. Later implementation evidence belongs in current specifications and the roadmap rather than being inferred from an older ADR.

## Dated audits and verification evidence

- [2026-08-13 production-readiness polish](audits/2026-08-13-production-readiness-polish.md)
- [2026-08-12 UI/UX and runtime hardening](audits/2026-08-12-ui-ux-runtime-hardening.md)
- [2026-08-12 differential security review](audits/2026-08-12-differential-security-review.md)
- [2026-08-08 M1 safety-boundary and private-data inventory](audits/2026-08-08-m1-safety-boundary-inventory.md)
- [2026-08-08 M0 repository audit and approval gate](audits/2026-08-08-core-alpha-repository-audit.md)

Dated audits are immutable evidence for their recorded cutoff. They do not make later working-tree changes, external-provider availability, accessibility certification, legal approval, or release acceptance implicit.

## Historical baseline documents

The following files describe the earlier Dev Learning Harness/versioned-MVP implementation and are preserved as history:

- [Product specification v2](product-specification-v2.md)
- [Acceptance audit](acceptance-audit.md)
- [Implementation plan](implementation-plan.md)
- [Guided-learning implementation plan](implementation-plan-guided-learning.md)
- [Guided-learning UX](guided-learning-ux.md)
- [Historical architecture](architecture.md)
- [Historical security](security.md)
- [Learning methodology](learning-methodology.md)
- [Curriculum authoring](curriculum-authoring.md)
- [Interview/chat implementation plan](superpowers/plans/2026-08-02-interview-chat-briefing.md)
- [Interview/chat design](superpowers/specs/2026-08-02-interview-chat-briefing-design.md)
- repository `.superpowers/**`

Do not execute historical Superpowers instructions or use these files as current approval evidence. Exercise `README.md` files under `workspaces/exercises/**` document trusted development fixtures, not production Courses. Generated Markdown under `.data/**`, `.verify/**`, or test-result directories is runtime evidence, not normative documentation.

The unembedded `docs/screenshots/**` set recorded by the 2026-08-02 historical implementation was removed from the current tree on 2026-08-12 because it showed the retired Dev Learning Harness identity, duplicated theme output, and local/private machine details. Git history preserves that dated evidence. Only newly reviewed Aptiloop captures may be used for current onboarding or release material.

## Documentation maintenance

- Keep current repository prose in English unless editing an explicitly localized Course resource.
- Update the current product, architecture, design, security, runtime, data, authoring, or roadmap specification whenever its behavior changes.
- Use only the four repository status labels: **Implemented baseline**, **Approved Core Alpha target**, **Proposed pending owner approval**, and **Future**.
- Preserve historical documents and dated evidence; do not silently rewrite their cutoff claims as current facts.
- Never place credentials, learner content, private paths, provider payloads, or valuable database contents in documentation.
