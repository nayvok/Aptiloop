# Terminology

## Document status

**Approved Core Alpha target**. This glossary is normative for new product specifications and future UI migration. **Implemented baseline** names remain valid only when describing existing code, data, routes, or historical documents.

## Status terms

| Term                                | Meaning                                                                                                   |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------- |
| **Implemented baseline**            | Directly observed behavior in the current Dev Learning Harness. It may still violate the target contract. |
| **Approved Core Alpha target**      | Binding behavior or boundary for later Core Alpha implementation. It is not evidence of implementation.   |
| **Proposed pending owner approval** | A recommendation awaiting an explicit decision.                                                           |
| **Future**                          | Intentionally outside Core Alpha.                                                                         |

Do not substitute “done,” “supported,” “production-ready,” or “approved” for these labels without evidence and the corresponding gate decision.

## Product and content model

| Preferred term            | Definition                                                                                                                                                | Legacy or discouraged term                                                                    |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| **Aptiloop**              | Product name for the approved target.                                                                                                                     | Dev Learning Harness when discussing the target.                                              |
| **Core Alpha**            | The bounded local-first, single-user product milestone.                                                                                                   | MVP when it obscures the contract or approval gates.                                          |
| **Course**                | Top-level authored learning product with identity, lineage, locale, sources, revisions, and adaptations.                                                  | Curriculum as the target top entity.                                                          |
| **Course Revision**       | Immutable published version of a Course. Drafts are mutable until explicit publish.                                                                       | Curriculum version, revision row, active curriculum.                                          |
| **Draft**                 | Mutable authoring state not used as immutable learning truth.                                                                                             | Editable published version.                                                                   |
| **Adaptation Branch**     | Learner-owned lineage derived from a published Course Revision without mutating it.                                                                       | Personalized curriculum copy, silent local override.                                          |
| **Course Pack**           | Declarative, validated transport package for Course structure/content. It contains no commands, scripts, secrets, plugins, credentials, or learner state. | Plugin, course bundle when it implies executable authority.                                   |
| **Activity Graph**        | Finite graph of activities, prerequisites, completion rules, and terminal outcomes.                                                                       | Open-ended agent plan.                                                                        |
| **Activity**              | One typed learning interaction in a Course Revision.                                                                                                      | Unit in target UI/spec prose. `unit` remains an implemented schema/code term until migration. |
| **Activity type**         | Stable machine type that selects a validated activity contract/renderer.                                                                                  | Arbitrary component or prompt type.                                                           |
| **Source Snapshot**       | Immutable captured source material or metadata used by a Course Revision, with provenance and content identity.                                           | Live URL as course truth.                                                                     |
| **Knowledge Capsule**     | Bounded, attributable learning material derived from Source Snapshots for defined goals and activities.                                                   | Unbounded generated lesson, context dump.                                                     |
| **Primary Course locale** | One required locale in which a Course is authored and complete.                                                                                           | App language, default user language.                                                          |
| **Course translation**    | Explicit optional localized resource mapped to the same stable Course/activity identities.                                                                | Silent mixed-language fallback.                                                               |

## Learning terms

| Preferred term       | Definition                                                                                                              | Avoid                                        |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| **Learning Kernel**  | Deterministic application-owned rules for graph state, evidence reduction, mastery, review scheduling, and next action. | AI brain, agent deciding mastery.            |
| **Learning Session** | Resumable learner interaction bound to immutable Course Revision context.                                               | Provider session as learner state.           |
| **Evidence**         | Typed persisted fact produced by an approved activity contract.                                                         | Any model statement, UI completion claim.    |
| **First attempt**    | Earliest persisted response before protected feedback or strong hint; immutable evidence.                               | Latest answer presented as unaided recall.   |
| **Mastery**          | Deterministic state derived from sufficient diverse evidence under approved rules.                                      | Score from one answer or model opinion.      |
| **Mistake**          | Deterministically recorded unresolved misconception/error with provenance.                                              | Failure label applied to the person.         |
| **Review Item**      | Scheduled learning work derived from evidence and review rules.                                                         | Notification generated by a model.           |
| **Trusted check**    | App-installed check definition referenced by stable ID and resolved by Execution Fabric.                                | Command supplied by browser, pack, or model. |
| **Observation**      | Bounded descriptive result that does not establish technical correctness unless an approved evidence contract says so.  | Skill confirmation for answer length/form.   |
| **Summary**          | Deterministic report derived from persisted facts, with optional model observations separated.                          | Generated narrative as state authority.      |

Current interview reports should use **answer observations** or **interview observations**, not “skill evidence” or “verified correctness,” until a technical evaluation contract produces eligible evidence.

## Runtime and AI terms

| Preferred term           | Definition                                                                                                | Avoid                                                        |
| ------------------------ | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| **Aptiloop Core**        | Application-owned domain, persistence, policy, validation, and orchestration.                             | Pi as the application.                                       |
| **Pi runtime**           | `@earendil-works/pi-ai` and `@earendil-works/pi-agent-core` capability used behind Aptiloop typed tools.  | Pi tutorial, subagent framework, built-in permission system. |
| **Application role**     | Aptiloop-owned Course Designer, Tutor, Evaluator, or Reviewer contract.                                   | Assuming Pi exports product roles.                           |
| **Typed tool**           | Aptiloop-owned, schema-validated operation with minimal authority and app policy.                         | General shell/edit/filesystem/network tool.                  |
| **Provider**             | Explicit model service/runtime selection with declared auth and capability.                               | AI as a single invisible backend.                            |
| **Mock**                 | Deterministic test/CI/development provider.                                                               | Offline production tutor, fallback provider.                 |
| **Execution Fabric**     | App-owned service that resolves trusted environment/check IDs and captures bounded execution evidence.    | Shell API, arbitrary runner.                                 |
| **Environment contract** | Declarative Node or Python runtime requirements and references to app-installed trusted checks/templates. | Embedded setup script.                                       |
| **Workspace**            | Isolated learner-owned practical-task directory created through an app policy.                            | Repository root for model tools.                             |
| **Reviewer**             | Read-only application role that analyzes bounded context/diff/check evidence and cannot patch.            | Fixer, autonomous code editor.                               |

## Navigation and screen names

**Approved Core Alpha target** primary navigation:

- **Home**
- **Courses**
- **Review**
- **Skills**
- **Settings**

Migration mapping:

| Implemented baseline label/route concept | Target placement                                                  |
| ---------------------------------------- | ----------------------------------------------------------------- |
| Path / Today                             | Home and Courses                                                  |
| Session                                  | Activity view reached from Home/Courses                           |
| Practice / Exercise                      | Activity mode, not primary navigation                             |
| Knowledge map                            | Skills                                                            |
| Mistakes                                 | Review                                                            |
| Flashcards                               | Review                                                            |
| Interview                                | Review or an in-Course activity                                   |
| Curriculum Editor                        | Adaptive Studio under Courses                                     |
| Agent Playground / Developer tools       | Diagnostics/development surface, never learner primary navigation |

Routes and database columns may keep legacy names during an explicit migration. UI and normative docs should not expose those internal compatibility names as the new product model.

## Authoring terms

| Preferred term      | Meaning                                                                                               |
| ------------------- | ----------------------------------------------------------------------------------------------------- |
| **Adaptive Studio** | Manual-first embedded Course authoring and preview workspace.                                         |
| **Proposal**        | Typed, inspectable draft change produced by optional AI.                                              |
| **Apply**           | Explicitly accept a proposal into a draft; never publish.                                             |
| **Validate**        | Run deterministic whole-Course schema, graph, locale, source, environment, and safety checks.         |
| **Preview**         | Render a draft as learner experience without publishing/installing.                                   |
| **Publish**         | Explicitly create an immutable Course Revision after independent validation/review.                   |
| **Install**         | Explicitly make a validated external immutable Course Revision available locally.                     |
| **Clone**           | Create a new draft lineage from an immutable revision.                                                |
| **Export**          | Explicitly serialize selected allowed Course data; no learner-private data or credentials by default. |

Do not use “generate course” to collapse source acquisition, authoring, validation, preview, and publish into one action.

## Language conventions

- Product and repository specifications are written in English.
- `en-US` and `ru-RU` are locale identifiers; “English” and “Russian” describe languages.
- Code, package names, APIs, schema keys, stable IDs, hashes, provider/model IDs, commands, and trusted check IDs remain verbatim.
- Translate product concepts by meaning in locale catalogs; do not create translated machine identifiers.
- Avoid “AI-powered,” “magic,” “autonomous,” and anthropomorphic claims that hide provider, limits, or state ownership.
- Use “local-first,” not “offline-only”: optional provider actions may use a network after explicit configuration/action.
- Use “read-only review,” not “automatic fix.”
- Use “evidence recorded,” not “skill proven,” unless the Learning Kernel contract supports that conclusion.

## Baseline migration findings

**Implemented baseline**

The repository and UI currently use Dev Learning Harness, `@dlh/*`, Curriculum, Week/Day/Unit, Path, Teacher, and several hardcoded Russian labels. These are facts about the baseline, not target compliance. Migration must update user-facing terminology consistently while preserving compatibility identifiers only where an explicit data/code migration requires them.
