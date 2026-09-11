# Aptiloop Documentation Index

**Implemented baseline** — documentation organization, not release acceptance.

Start with the relevant entry below, then read only the documents needed for the task. Current specifications own contracts; ADRs own decisions; dated audits own evidence for their stated cutoff. A nearby **Implemented baseline**, **Approved Core Alpha target**, **Proposed pending owner approval**, or **Future** label governs each specification section.

Superseded plans, closed session handoffs, and the retired Dev Learning Harness specifications are removed from the working tree. Their tracked history remains available in Git; they are not a second source of current instructions.

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

## Proposals pending owner approval

- [Deliberate practice evolution proposal](deliberate-practice-evolution-proposal.md) — a pedagogical model evolution toward deliberate practice (prediction, progressive hints, hypothesis-driven debugging, bug autopsy, misconception lifecycle, adaptive retrieval forms, transfer). Fully **Proposed pending owner approval**; contains no approved target or implementation commitment.

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
- [Design implementation reference](design/implementation.md)
- [Prompt map](design/prompts.md)
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
- [Development Course Packs](development/dev-tour-course-packs.md) — canonical localized Dev Tour fixtures, import, maintenance, and runtime limitations.
- [Troubleshooting](troubleshooting.md)
- [Current database operations](migration/current-database-operations.md) — the only current runbook for valuable process-mode SQLite inventory, approved backup, authorized forward migration, and whole-file recovery.
- [Local data portability](data-portability.md) — explicit local-profile export and create-only offline restore without credentials or workspace files.
- [Core Alpha migration strategy](migration/core-alpha-migration-strategy.md)
- [M2 migration and recovery record](migration/m2-course-foundations-runbook.md) — dated M2 evidence and cutoff-specific recovery; not a substitute for the current migration strategy.
- [Project licensing boundary](licensing/core-alpha-licensing-plan.md) — applied Apache-2.0 scope, exclusions, and remaining artifact obligations.
- [Contribution terms](../CONTRIBUTING.md)
- [Third-party notices](../THIRD_PARTY_NOTICES.md)
- [Name and branding](../TRADEMARKS.md)

## Architecture decisions

See the [ADR index](adr/README.md). ADR status records a decision at its stated date. Later implementation evidence belongs in current specifications and the roadmap rather than being inferred from an older ADR.

## Dated audits and verification evidence

- [2026-08-13 code, security, and optimization differential audit](audits/2026-08-13-code-security-optimization-audit.md)
- [2026-08-13 production-readiness polish](audits/2026-08-13-production-readiness-polish.md)
- [2026-08-12 UI/UX and runtime hardening](audits/2026-08-12-ui-ux-runtime-hardening.md)
- [2026-08-12 differential security review](audits/2026-08-12-differential-security-review.md)
- [2026-08-08 M1 safety-boundary and private-data inventory](audits/2026-08-08-m1-safety-boundary-inventory.md)
- [2026-08-08 M0 repository audit and approval gate](audits/2026-08-08-core-alpha-repository-audit.md)

Dated audits are retained for security, provenance, and migration evidence. Read them when investigating their specific findings, not as default implementation context. They do not make later changes, provider availability, accessibility certification, legal approval, or release acceptance implicit.

Exercise `README.md` files under `workspaces/exercises/**` document trusted development fixtures. Files under `.data/**`, `.verify/**`, and test-result directories are local runtime artifacts, not normative documentation.

## Documentation maintenance

- Keep current repository prose in English unless editing an explicitly localized Course resource.
- Update the current product, architecture, design, security, runtime, data, authoring, or roadmap specification whenever its behavior changes.
- Use only the four repository status labels: **Implemented baseline**, **Approved Core Alpha target**, **Proposed pending owner approval**, and **Future**.
- Keep one canonical home for each contract and link to it instead of copying its contents. Remove superseded plans and closed task diaries; retain necessary decisions in ADRs and dated safety/migration evidence in their dedicated directories.
- Never place credentials, learner content, private paths, provider payloads, or valuable database contents in documentation.
