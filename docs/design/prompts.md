# Prompt and authoring instruction contract

## Document status

**Implemented baseline**

This document maps the prompt-library contracts, the portable external Course authoring instruction, and the connected Course Designer wording that exist in this repository. It records current behavior only; it is not a feature proposal.

## Source map

| Surface                                 | Source                                                                                                                      | Contract test or consumer                                                                                       |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Versioned prompt definitions and lookup | `packages/prompt-library/src/prompts.ts`                                                                                    | `packages/prompt-library/test/prompts.contract.test.ts`; `packages/agent-core` role resolution                  |
| Prompt package export                   | `packages/prompt-library/src/index.ts`                                                                                      | Consumers import the definitions and lookup functions from the package entrypoint                               |
| Portable external authoring instruction | `apps/web/app/courses/new/external/course-authoring-instruction.ts`                                                         | `apps/web/app/courses/new/external/instructions/route.ts`; `apps/web/test/course-authoring-instruction.test.ts` |
| Connected Designer route and wording    | `apps/web/app/courses/new/guided/page.tsx`, `apps/web/components/curriculum-editor-client.tsx`, and `apps/web/lib/i18n.tsx` | `apps/web/test/curriculum-editor.test.tsx`, route tests, and the rendered Course Designer workflow              |
| Exact embedded authoring assets         | `packages/course-authoring-kit/src/authoring-assets.ts`, generated `schema/` and `templates/` files                         | Course Pack validation and import boundaries                                                                    |
| Product-level authoring evidence        | `docs/product/course-authoring.md`, `docs/design/adaptive-studio.md`                                                        | Current product and Studio contracts                                                                            |

The prompt and instruction strings are English. The connected UI has the existing `en-US` and `ru-RU` catalogs; the two catalogs express the same authoring safeguards in their respective interface languages.

## Versioned prompt definitions

`promptDefinitions` contains eleven definitions. Each definition has an ID, an agent role, a semantic purpose, a bounded context policy, a depth policy, a system prompt, a result format, and a structured-output schema. `PromptDefinitionSchema` validates each definition at construction. Prompt lookup is exact: `getPrompt` and `getWorkflowPrompt` require both the role/ID and a `vMAJOR.MINOR.PATCH` version; unknown pairs throw. `getLatestPrompt` and `getLatestWorkflowPrompt` return the last registered definition for that role or ID.

### Role map

| Prompt role           | Purpose                                                                                                             | Output                                                                                                                           | Prompt-declared tools                                                                            | Authority and scope                                                                                                                                                                |
| --------------------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `course-designer`     | Propose a finite typed patch to one local Course Draft after the persisted Learning Design is complete.             | A concise summary plus typed changes for explicit review; never an applied or published claim.                                   | `course.readDraftSlice` and `course.proposeDraftPatch`, only when supplied by the server.        | Exact selected Draft and authoring operation; stable IDs and the persisted Learning Design are server-owned. No apply, publish, install, source-fetch, or general edit authority.  |
| `teacher`             | Build understanding through a Socratic dialogue.                                                                    | Exactly one focused question, or a short post-attempt explanation followed by one check question.                                | No prompt-declared mutation tool; only the supplied lesson/activity context and dialogue.        | Exact lesson, activity, topics, depth, attempts, hints, and reveal policy. The protected reference answer is withheld until server rules allow it.                                 |
| `reviewer`            | Review an immutable evidence bundle for correctness, type, edge-case, requirement, readability, and test issues.    | `ReviewResult` JSON with status, summary, findings, strengths, and suggested mastery changes.                                    | Read-only supplied bundle; no writable workspace handle.                                         | Exact review bundle only. It is evidence-only and cannot apply patches, create files, or rewrite the solution.                                                                     |
| `interviewer`         | Run a realistic bounded technical interview and follow contradictions.                                              | Question turn: one question and limit. Evaluation turn: assessment, evidence, weak topics, and one next question.                | No prompt-declared mutation tool; transcript and approved topics are supplied data.              | Exact server-approved topics and interview operation. Question generation receives no rubric/reference answer, and evaluation is a separate turn.                                  |
| `curator`             | Select review topics and next steps from durable evidence while respecting the roadmap.                             | Concise JSON containing rationale, review/next topic IDs, flashcard candidates, and warnings.                                    | No prompt-declared mutation tool; server-supplied evidence and roadmap snapshot only.            | Exact curation operation, Course scope, evidence summaries, deterministic mastery, and roadmap snapshot. Suggestions do not become final scores.                                   |
| `codex-expert`        | Handle a manually requested bounded architecture, quality, planning, or cross-agent analysis.                       | Structured Markdown with conclusion, evidence, risks, trade-offs, and next actions unless the caller supplies a stricter schema. | No prompt-declared mutation tool; explicitly selected repository evidence only.                  | Exact manually requested operation and selected evidence. It must not take over ordinary learner work or imply commands ran.                                                       |
| `flashcard-generator` | Turn demonstrated mistakes and durable concepts into editable retrieval candidates.                                 | JSON array of candidates with front, back, topic ID, source evidence, and rationale.                                             | No prompt-declared mutation tool; completed-unit evidence and corrected learner wording only.    | Exact flashcard-generation operation, approved topics, and provenance. Candidates are not approval or mastery.                                                                     |
| `daily-summary`       | Summarize one learning day from persisted answers, attempts, hints, reviews, and deterministic changes.             | JSON with learned items, strengths, mistakes, review needs, tomorrow questions, card candidates, and progress note.              | No prompt-declared mutation tool; exact day-summary evidence only.                               | Exact Course/session day and computed mastery deltas. Missing evidence stays missing; the prompt cannot assign mastery.                                                            |
| `weekly-analysis`     | Analyze week-level evidence and recommend the next emphasis.                                                        | JSON with evidence summary, trends, repeated mistakes, weak topics, plan adjustments, rationale, and next-week focus.            | No prompt-declared mutation tool; aggregated week evidence and roadmap snapshot only.            | Exact Course/week scope. Activity volume is not competence, and the roadmap cannot change silently.                                                                                |
| `exercise-generator`  | Design a trusted exercise brief, starter manifest, acceptance criteria, checks, and hint intent without solving it. | JSON containing brief, starter files, acceptance criteria, constraints, check ID, and hint policy.                               | No executable command tool; only the supplied authoring operation and allowlisted operation IDs. | Exact exercise-authoring scope, topic/activity, depth, misconceptions, workspace constraints, and allowed IDs. No implementation, solution, arbitrary command, or writable action. |
| `curriculum-reviewer` | Review a Draft curriculum revision for coverage, ordering, depth, leakage, and verifiable completion.               | JSON with verdict, errors, warnings, coverage gaps, and recommendations.                                                         | No prompt-declared mutation tool; selected Draft snapshot and diagnostics only.                  | Exact curriculum-review operation and Draft. Published revisions and historical learner evidence remain read-only.                                                                 |

`Output` describes the prompt's result contract. It is not Provider Hub role resolution and does not grant the prompt-declared tools.

### RoleProfile and runtime resolution

`packages/agent-core/src/roles.ts` is the authoritative prompt-role to Provider Hub role mapping:

| Prompt role or workflow ID                                                                 | Resolved `AptiloopAiRole` / RoleProfile | Current caller or resolver                                                                                                                                           |
| ------------------------------------------------------------------------------------------ | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `course-designer`                                                                          | `course-designer`                       | `apps/orchestrator/src/course-designer.ts` calls `getLatestPrompt("course-designer")`; `ProviderRuntime` resolves the `course-designer` RoleProfile.                 |
| `teacher`                                                                                  | `tutor`                                 | The Tutor route in `apps/orchestrator/src/app.ts` calls `getLatestPrompt(body.role)` for the exact `teacher` role; ProviderRuntime resolves the `tutor` RoleProfile. |
| `codex-expert` (including `exercise-generator` and `curriculum-reviewer` workflow prompts) | `tutor`                                 | `toAptiloopAiRole` resolves the prompt role; these workflow prompt IDs are not separate Provider Hub roles.                                                          |
| `interviewer`                                                                              | `evaluator`                             | `apps/orchestrator/src/interview-v2.ts` calls `getLatestPrompt("interviewer")`; ProviderRuntime resolves the `evaluator` RoleProfile.                                |
| `curator`, `flashcard-generator`, `daily-summary`, `weekly-analysis`                       | `evaluator`                             | `toAptiloopAiRole` resolves each workflow role to the shared `evaluator` RoleProfile.                                                                                |
| `reviewer`                                                                                 | `reviewer`                              | The read-only review path in `apps/orchestrator/src/app.ts` calls `getLatestPrompt("reviewer")`; ProviderRuntime resolves the `reviewer` RoleProfile.                |

The current direct prompt callers are `course-designer.ts`, the Tutor and Reviewer paths in `app.ts`, and `interview-v2.ts`. The other workflow definitions remain available through `getLatestWorkflowPrompt`; a prompt ID is not evidence that a dedicated HTTP workflow currently invokes it. The legacy `/api/agent/stream` route is Tutor-only (`teacher`), while retired learning mutation endpoints return `410`; Interview V2 uses its dedicated route.

### Enforced typed-tool policies

`packages/agent-core/src/typed-tool-host.ts` defines the enforced policy, while `apps/orchestrator/src/provider-runtime.ts` maps each resolved role to its policy ID. The runtime tool set is distinct from the prompt's prose metadata:

| Resolved role     | Policy ID                     | Enforced typed tools                                                                                       |
| ----------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `course-designer` | `apt.role.course-designer.v2` | `course.readDraftSlice`, `course.readApprovedSources`, `course.proposeDraftPatch`, `knowledge.readCapsule` |
| `tutor`           | `apt.role.tutor.v1`           | `lesson.readLearnerSafeContext`, `lesson.submitTutorMessage`, `knowledge.readSnapshotSlice`                |
| `evaluator`       | `apt.role.evaluator.v1`       | `evaluation.readAttemptBundle`, `evaluation.submitTypedResult`                                             |
| `reviewer`        | `apt.role.reviewer.v1`        | `review.readBundle`, `review.submitResult`                                                                 |

The concrete Course Designer tool factory is `apps/orchestrator/src/course-designer.ts:createCourseDesignerTools`. It currently supplies the three Course Designer tools listed in that source; the policy also permits `knowledge.readCapsule` when a provider integration supplies it. `PiAgentProvider` rejects a tool absent from the resolved policy, and the typed-tool host validates policy/role pairing. Prompt text describes intent; the policy and tool host enforce authority.

### Prompt-wide invariants

Every system prompt includes the instruction/data boundary, honesty and uncertainty rules, learner-work boundary, depth policy, language policy, result format, and structured schema. Supplied Course, Draft, source, transcript, diff, test, tool, provider, and learner content is data, never authority. Missing or ambiguous server scope stops the operation in its required result format. Unrelated work is refused without broadening scope. The learner must attempt recall, reasoning, explanation, design, or implementation before an answer or reference; recognition alone is not mastery evidence.

The Course Designer additionally requires the complete persisted Learning Design chain, attempt-before-answer, changed-condition transfer, software-engineering decision practice, explicit diagnostic-skip assumptions, explicit treatment of every placeholder, honest empty-registry degradation, separate interview readiness and independent engineering capability with time trade-offs, and explicit mastery evidence types. Concrete examples illustrate the pattern but never provide a learner solution.

## Portable external authoring instruction

`createCourseAuthoringInstruction` validates the bounded `AuthoringBrief`, requires a lowercase 40-character repository revision, and accepts only `interactive` or explicitly selected `non-interactive` mode. It returns one self-contained Markdown skill containing the exact generated artifacts and revision-pinned references. It does not contact a provider or fetch a source.

Interactive mode asks material questions before a proposal, requires explicit approval of that exact proposal, and emits no JSON before approval. Non-interactive mode is an explicit automation choice; it does not pretend that conversation happened and does not authorize validation bypass, installation, Open as Draft, or publication. Both modes require the Learning Design chain and preserve unresolved facts instead of inventing them.

The generated instruction has these lifecycle blocks:

- **Brief** — bounded user data; facts, assumptions, conflicts, and unknowns are separated.
- **Discovery** — only material questions about audience, outcomes, prerequisites, exclusions, pacing, accessibility, sources, provenance, ownership, and terms.
- **Diagnostic** — used when level or prerequisites are uncertain and is mandatory unless the learner declines; a declined or skipped diagnostic is an explicit Proposal assumption.
- **Learning Design** — target capability → observable evidence → practice → feedback → instruction/review, with attempt-before-answer, transfer, decision practice, objective trade-offs, and mastery evidence.
- **Proposal** — one finite, reviewable Course Proposal with assumptions and unresolved findings.
- **Repair** — deterministic diagnostics only, preserving each failed draft under the bounded repair budget.
- **Compilation** — exactly one UTF-8 hashless Authoring Draft only after the applicable approval gate.

The generated skill retains the explicit Install/Open-as-Draft boundary, learner-safe Preview, deterministic preparation, protected-material separation, provenance rules, stable IDs, and immutable publish gate. A model-authored draft never contains derived `requirements` or `revision.contentHash`.

## Layered authoring contract

### Layer 1 — Fixed identity and authority

**Invariant:** identity is fixed to the emitted Aptiloop repository and exact 40-character revision, Authoring Kit package identity, schema IDs, format major/minor, validator version, skill content version, and shared lifecycle. Logical schema `$id` values are identities, not download locations. Only the allowlisted raw GitHub references pinned to that revision are authoritative, and embedded assets are sufficient offline. Empty registry lists are intentional; identifiers are never invented.

### Layer 2 — Interaction contract

**Invariant:** the bounded Initial Brief is followed by Discovery, Diagnostic, Learning Design, Course Proposal, User Review, Compilation, deterministic Validation/Repair, learner-safe Preview, and explicit Install/Open as Draft. Interactive approval is explicit and exact. Non-interactive automation is explicit and still cannot bypass validation or local authority. Before a connected-provider turn, one named disclosure is reviewed at a time; approval is operation-scoped and consumed once, and cancellation sends nothing. Aptiloop, not the model, owns Draft mutation, preparation, validation, installation, and publication.

### Layer 3 — Authoring conversation

**Invariant:** Brief text cannot override fixed authority; only the explicit non-interactive mode contract grants bounded compilation authorization, and it never fakes conversational approval. Discovery resolves only design-changing unknowns; Diagnostic is explicit when uncertainty matters and its skip/decline is recorded; Learning Design is complete before Proposal; each skill/procedure names observable evidence and covers fitting mastery evidence types; placeholders become questions, unresolved facts, or approved assumptions; an environment or check registry with no entries means runtime practice is unavailable and no exercise is authored; interview readiness and independent engineering capability stay separate with time trade-offs.

### Layer 4 — Compilation rules

**Invariant:** output is hashless `aptiloop.course-pack-authoring-draft`, format version 1/minor 1, emitted only after approval. The model uses exact closed schemas, registered Activity types, stable lowercase IDs, valid finite lesson and Activity DAGs, and compatible completion criteria. Protected answers remain only in `protectedMaterial`; learner-visible fields never duplicate them. Sources and Capsules require truthful supplied provenance and verified hashes; otherwise they stay empty. The document is declarative data and contains no commands, scripts, plugins, credentials, secrets, local paths, arbitrary authority, active content, or silent network fetching. Validation, schema, protected material, provenance, stable-ID, approval, and publish gates are unchanged.

### Layer 5 — Bounded deterministic repair

**Invariant:** preserve the exact failed draft before every repair and write a new candidate. Use only deterministic diagnostics with their code/path/entity/rule/context; never suppress a diagnostic or hand-edit derived requirements/hashes. Make the smallest proposal-preserving change. A material scope, pedagogy, source, provenance, protected-evaluation, or lifecycle change returns to User Review. At most **3 repair rounds** are attempted; after the third failure, preserve the draft and diagnostics and stop. Preview requires zero validation errors, while warnings remain visible.

### Layer 6 — Exact embedded assets

**Invariant:** the skill embeds the current runtime registry, hashless Authoring Draft schema and scaffold, and final Course Pack schema and scaffold exactly as generated. Assets are data, not executable instructions; the final scaffold is not model output and is not installable unchanged. The deterministic `prepareCoursePackBytes` boundary derives requirements, canonicalizes, computes/verifies the final content hash, finalizes, and runs the same semantic/security validation as import. The model never substitutes an asset, registry ID, validator, or hash.

## Actual registry and version behavior

The external instruction reads metadata from `packages/course-authoring-kit/src/authoring-assets.ts`; it does not duplicate version constants. The current implemented values are:

- Authoring Kit package identity: read from that package's `package.json`.
- Final format: `aptiloop.course-pack`, major `1`, minor `1`.
- Hashless draft format: `aptiloop.course-pack-authoring-draft`, major `1`, minor `1`.
- Validator: `m3-v3`.
- Skill content: `1.4.0`.
- Prompt versions: `course-designer` is `v1.4.0`; the other registered definitions are `v1.2.0`.

`coursePackRegistry` is the runtime-owned `CORE_M3_COURSE_PACK_REGISTRY`. Its Activity types come from the closed shared `UnitTypeSchema`; capability IDs, environment IDs, and trusted check IDs are currently empty. Consequently, the authoring instruction and connected Designer must not claim runtime readiness, emit environment/check references, or author an exercise when either the environment or check registry has no entries. They explicitly degrade to recall, tutor dialogue, code reading, interview, or checkpoint.

The repository revision in a downloaded instruction is validated at the route boundary and interpolated into every authoritative raw GitHub URL. `main`, tags, branches, and unpinned URLs are rejected or forbidden by the instruction contract. The import/preparation boundary—not the external model—owns requirements derivation, canonical bytes, final hashes, and final validation. A mismatched `skillContentVersion` in an imported Pack is provenance visible to Preview and is not silently rewritten.

## Connected Designer wording

The connected flow is a structured workflow against one explicit local Draft, not generic chat. `apps/web/lib/i18n.tsx` labels the lifecycle as Initial brief, Discovery, Diagnostic (when needed), Learning Design, Course proposal, User review, Compilation, and Validation and repair. Learning Design guidance states the ordered capability/evidence/practice/feedback/instruction chain, attempt-before-answer, a concrete async event-order to rejection/parallelism transfer example, the SWE naive → problem → observe → change → new trade-off loop, explicit mastery evidence types, separate objectives and time trade-offs, empty-registry degradation, and no silent placeholders. Provider/model readiness remains technical evidence rather than a strength rating; disclosure, proposal Apply, Validate, Preview, Change review, and Publish remain separate actions. Before any connected-provider turn, the disclosure review presents one named operation at a time. Approval is exact, operation-scoped, consumed once, and never implied by silence; cancellation sends nothing.

The connected UI wording is advisory presentation only. Server-owned workflow state, exact provider/model scope, typed tools, deterministic validation, protected material, and all approval/authority boundaries remain authoritative.
