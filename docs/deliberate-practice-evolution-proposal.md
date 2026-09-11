# Deliberate Practice Evolution Proposal

**Document status:** **Proposed pending owner approval**. Nothing in this document is implemented, approved, or binding. Every recommendation here requires explicit owner approval before any implementation milestone begins. Factual claims about the current repository are labeled **Implemented baseline** and cite their observed contracts; they describe today's behavior, not an approval of change.

**Scope:** an evolution of the Aptiloop pedagogical model toward deliberate practice — training independent reasoning, debugging discipline, explanation, mental-model correction, and transfer — while preserving deterministic Learning Kernel authority, Course/Revision/Adaptation Branch semantics, the evidence model, Provider Hub boundaries, and all existing product guarantees.

**Idea source:** [Manware's AI Learning Toolkit](https://github.com/i-am-manware/Manware-s-AI-Learning-Toolkit) was reviewed as inspiration/reference material for pedagogical ideas and workflow patterns (attempt → predict → hint → implement → test → explain → review → retrieve; "reduce friction without reducing learner thinking"). It was not integrated and nothing will be copied from it. Its prompts were not reused and will not be reused; its license was not observed during review and literal reuse is disallowed in any case. All schemas, wording, prompts, and protocol definitions proposed here are first-party and original.

**Central principle:** AI must reduce the friction around learning without reducing the amount of independent thinking the learner does. Aptiloop already enforces this at the authority level; this proposal extends it into the tutoring workflow itself.

## A. Current State Audit

This section records what Aptiloop already implements so that no proposal duplicates it.

### A.1 Authority skeleton (Implemented baseline — no changes needed)

- The deterministic Learning Kernel owns accepted learning facts, lesson state, evidence, mastery, mistakes, review items, and summaries (`packages/learning-core/src/kernel.ts`). Facts are append-only with closed bodies `evidence | progress | correction | review`, typed provenance, operation-idempotent acceptance, canonical SHA-256 fact frontier, and replay-complete projections (migrations `0012_learning_kernel` and `0021_learning_kernel_fact_schema_v2`).
- A browser submits learner actions; a model produces typed proposals through Aptiloop-owned tools. Neither may choose `completed`/`unlocked`, mastery score/delta, review schedule, or next activity; assert a test passed; see protected evaluation material before the relevant attempt; or turn unvalidated natural language into authoritative evidence (`docs/architecture/learning-kernel.md`).
- Advanced mastery already encodes evidence diversity: a dimension score above 4 requires successful evidence of **at least two different evidence types** on **at least two different UTC days** (`packages/learning-core/src/mastery.ts`).
- Repeated misconceptions already exist: evidence carries an optional `errorFamily`; repeated error keys accumulate occurrence counts, apply a `repeatedErrorPenalty` (capped at 0.75), and deterministically create a mistake review item keyed by `(knowledgeNodeId, errorFamily)` with an **accelerating** schedule: `delayDays = max(1, 4 − min(occurrences, 3))` (`packages/learning-core/src/review-prefix.ts`).
- Mental-model revision already has a first-class fact: `LearningKernelCorrectionBody { supersedesFactId, replacement }`. A correction deterministically supersedes prior evidence in the effective-evidence prefix — an immutable "original model → corrected model" mechanism already exists.
- Misconception already exists as authored content: KnowledgeNode kind `concept | procedure | skill | misconception-family` (`docs/architecture/knowledge-system.md`).
- Trusted execution, allowlisted checks, server-owned Git baseline identity, complete SHA-256 diff fingerprints, stale-input rejection, read-only evidence-only Reviewer, and `acceptedReviewRequired` gating are implemented; Reviewer cannot patch or apply anything.
- Day Summary derivation is fully deterministic from kernel facts with an exact authority envelope (model version, observed projection clock, projection hash, canonical source-fact frontier).
- Interview is a finite one-question-at-a-time persisted state machine whose report honestly measures completion/form observations only and never touches mastery.
- Course Pack V1 is declarative, validated against a closed registry, and fails closed on unknown types/capabilities. Adaptive Studio and Course Designer produce typed, attributed proposals applied only to a Draft; AI cannot publish.
- AI Off is a supported mode: registered manual paths remain usable; an AI-required activity without a validated manual alternative is visibly blocked, never auto-completed. Provider/model failure is explicit with no silent Mock substitution.

### A.2 Hint system: complete domain model, absent tutoring flow (Implemented baseline — the main domain/UX gap)

`packages/learning-core/src/hints.ts` implements a complete six-level progressive ladder:

```text
0 none       revealsAnswer: false  masteryCreditMultiplier: 1.00
1 reflection  false                0.85
2 direction   false                0.70
3 concept     false                0.55
4 scaffold    false                0.40
5 reference   true                 0.25
```

`canAdvanceHint` enforces deliberate gating: every new level requires an explicit learner request **and** another unsuccessful independent attempt (`attempt_required`); level 5 additionally requires an explicit caller grant (`reference_locked`). This exactly matches the desired pedagogy — and it has **zero production callers**:

- No hint request endpoint exists; no recall/quiz/code-reading/exercise flow serves hints.
- `readLegacyHintLevel` (`apps/orchestrator/src/learning-v2.ts`) attaches hint level 0 to every kernel evidence fact; the summary UI therefore always shows `maxHintLevel: 0 / 5`.
- The `hint_usages_v2` table and `recordHintUsage` repository method are written only from tests.
- The authoring `hintPolicy` field ("Progressive levels") and the exercise-generator prompt's "progressive hint intent" are labels nothing consumes.

**Conclusion:** the hint ladder's mathematics, gating, mastery multipliers, and persistence are complete and tested. The missing piece is pure wiring: an endpoint, authored hint content, and a UI control. This is the single most valuable, lowest-risk improvement in the entire proposal.

### A.3 Prediction: collected, never verified (Implemented baseline)

Code-reading saves `{prediction, explanation, verbalFix}` as `unverified` evidence. Nothing ever reveals the actual behavior or compares prediction against observation; there is no self-check step; the unit completes on the learner's own button press. Quiz questions already include a `predict-output` kind with snapshot-side `correctOptionIds`, but prediction-style code-reading units never confront the learner's committed mental model with reality. **Gap:** prediction exists as a field, not as a protocol.

### A.4 First-attempt guarantees (Implemented baseline)

Recall records an immutable first attempt before feedback and returns an `isFirstAttempt` flag; the first-try-before-hint order is honored. Teacher-dialogue requires the learner's first explanation before any follow-up turn. Quiz keeps the first attempt as saved evidence. Protected evaluation material (`referenceAnswer`, rubrics, quiz answer keys) never leaves the server before the relevant attempt.

### A.5 Retrieval and review (Implemented baseline)

Authored question kinds already span `explain | compare | predict-output | find-bug | multiple-choice | design-choice` — nearly the full retrieval-form vocabulary desired for adaptive review. The typed due-Review surface resolves an opaque execution identity to an immutable authored snapshot and records participation-only evidence without asserting correctness; a deterministic successor cycle is scheduled three days later. **Gap:** the review surface presents one fixed participation form; authored question-kind richness is not used for form variety, and mistake-driven review items do not progress through predict → find-bug → explain-fix → apply shapes.

### A.6 Debugging (Implemented baseline — partial)

A `debugging` mastery dimension and evidence type exist, trusted checks and the correction loop (edit → re-run trusted test → re-review) are implemented, and correction supersession is available. **Gap:** there is no structured expected/actual/hypothesis/experiment workflow; `test failed → AI explains the bug` remains the de facto scenario, and debugging mastery is currently fed by trusted-outcome facts rather than by observable debugging-process evidence (falsifiable hypothesis, correct experiment prediction, hypothesis rejection after evidence).

### A.7 Structured learner inputs (Implemented baseline)

Recall answers, code-reading fields, review participation responses, study notes, teacher-dialogue turns, and interview answers are all single free-text fields (length-validated only). Quiz (RadioGroup), study checklist (Checkbox), and checkpoint (acknowledge) are the only structured widgets. There are no self-review, confidence, hypothesis-revisit, or autopsy inputs anywhere in the session flow.

### A.8 Model-gated deterministic paths (Implemented baseline — noted for honesty, unchanged by this proposal)

Teacher-dialogue completion counts persisted assistant transcript rows (presence, not meaning). Review `passed/changes_requested` status originates in strictly validated model output and gates `acceptedReviewRequired` completion. Interview reports derive deterministic word-count heuristics from the AI-persisted transcript. All other paths are deterministic-only (quiz scoring is snapshot-side; summary derives only from kernel facts; `suggestedMasteryChanges` are validated and persisted but never applied to mastery). This proposal does not extend any model-gated path; every new mechanism is deterministic or participation-only.

## B. Gap Analysis

The table below is **Proposed pending owner approval** as a prioritization; the "Current support" column states **Implemented baseline** facts from Section A.

| Concept                                  | Current support                                                                                    | Missing pieces                                                                                                                                        | Value                                                                                    | Complexity                  | Risk           | Recommendation                                                       |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------- | -------------- | -------------------------------------------------------------------- |
| Progressive hint workflow                | Full ladder + gating + mastery multipliers in `hints.ts`; **no production caller**                 | Hint request endpoint; authored hint content per problem; hint level written into evidence facts; reference reveal semantics; guided-completion badge | Critical — the only place where the domain model and the tutoring workflow fully diverge | Medium (wiring, not design) | Low (additive) | **P0** — activate the existing system                                |
| Guided completion vs independent mastery | Level-5 multiplier 0.25; `revealsAnswer` flag                                                      | Distinct guided-completion outcome semantics; automatic scheduling of an independent verification task                                                | High                                                                                     | Medium                      | Low            | Level-5 evidence + deterministic independent-verification scheduling |
| Prediction protocol                      | Field collected in code-reading; never verified                                                    | Verification step (reveal actual observation); deterministic evaluator when observation is known; mismatch → mental-model-gap mistake candidate       | Critical                                                                                 | Medium                      | Low            | **P0**                                                               |
| Hypothesis-driven debugging              | `debugging` dimension; trusted checks; correction loop; supersession                               | Structured expected/actual/hypothesis/experiment/predict/observe workflow; debugging-process evidence                                                 | Critical                                                                                 | Medium–High                 | Medium         | **P0** — structured protocol over existing exercise/correction facts |
| Misconception lifecycle                  | `misconception-family` authored node kind; `errorFamily` occurrence counts; repeated-error penalty | Authored mapping errorFamily → misconception node; misconception candidates via typed AI proposals; autopsy trigger                                   | High                                                                                     | Medium                      | Low            | **P0**                                                               |
| Bug autopsy / post-mortem                | None                                                                                               | Deterministic trigger criteria; structured reflection attachment; reflection evidence                                                                 | High                                                                                     | Medium                      | Low            | **P0**                                                               |
| Transfer challenges                      | Expressible only through the authored graph                                                        | Authored transfer descriptors (novelty axis, one-constraint-per-step); deterministic surfacing after independent success; transfer retrieval forms    | High                                                                                     | Medium                      | Low            | **P1**                                                               |
| Adaptive retrieval forms                 | Rich authored `QuestionKind` enum; fixed review participation form                                 | Deterministic form-selection policy on review items; form-aware review surface; mistake-driven form progression                                       | High                                                                                     | Medium                      | Medium         | **P1**                                                               |
| Teach-back                               | Teacher-dialogue: first explanation then revision turn                                             | Stronger diagnostic follow-ups (omission / conceptual / terminology distinction as presentation)                                                      | Medium                                                                                   | Low                         | Low            | Strengthen the existing dialogue; no new system                      |
| Self-review before Reviewer              | None                                                                                               | Bounded self-assessment before the AI review; suspected-vs-found comparison presentation                                                              | Medium                                                                                   | Low                         | Low            | **P1/P2**                                                            |
| Confidence / calibration                 | None                                                                                               | Optional pre-answer confidence on prediction activities; derived calibration observation                                                              | Medium                                                                                   | Low                         | Low            | **P2** — optional, friction-aware                                    |
| Difficulty adaptation                    | Authored `DepthLevel`; deterministic next-action selection                                         | Authored novelty/transfer-distance metadata for evidence diversity                                                                                    | Medium                                                                                   | Low                         | Low            | Authored metadata, never model-decided                               |
| Hint-dependence indicator                | Always-zero `maxHintLevel` display                                                                 | Derived diagnostic after hints are activated                                                                                                          | Medium                                                                                   | Low                         | None           | UI-only projection from facts; **not** a new authoritative metric    |

**Priority summary (Proposed pending owner approval):** P0 = prediction, real progressive hints, hypothesis-driven debugging, bug autopsy/misconception correction, guided-completion semantics, mistake-driven retrieval forms; P1 = teach-back strengthening, self-review before Reviewer, test-design ceremony on selected exercises, architecture interview templates, API discovery as an authored recall/study pattern; P2/experimental = confidence calibration, explicit metacognition metrics, new mastery dimensions (not recommended), sophisticated difficulty adaptation.

## C. Proposed Architecture

**Proposed pending owner approval.** Everything in this section is a recommendation, not an approved target.

### C.1 Decision: no first-class `LearningProtocol` domain abstraction

Considered authoring variants:

- **A** `activity.protocols[]` — rejected: adds a second mechanism describing runtime behavior beside completion criteria, requires Course Pack schema v2 and new fail-closed registries for what additive payload data already expresses.
- **B** `activity.strategy` — rejected: a single free strategy field is unvalidatable and would become a stringly-typed protocol engine.
- **C** Activity-graph substeps — not needed: the graph already supports prerequisite steps; encoding protocols as graph nodes would multiply authored surface for ceremonies that are better expressed as deterministic app-owned policies.
- **D** Dynamically generated protocol registry — rejected: model-generated runtime protocols violate the fail-closed authoring principle.
- **E** Additive payload extension — **recommended**: a strict, closed, additive `PedagogyBlock` descriptor in activity payloads, plus app-owned deterministic policies that consume it.

Reasons:

1. Unit type (12 closed types) + discriminated payload + completion criteria + kernel policy **already** separate "what the learner does" from "how the activity passes pedagogically". `recall` with an immutable first attempt, `exercise` with trusted checks, and `spaced-review` are protocols already encoded in type + criteria.
2. Every proposed mechanic decomposes into (a) authored **data** in the payload, (b) **deterministic policies** in the orchestrator routes, and (c) **evidence semantics** in the fact body. A protocol runtime engine would duplicate mechanisms (b) and (c).
3. Course Pack compatibility stays intact: existing Packs import unchanged; unknown pedagogy fields fail closed exactly as unknown capabilities do today; published Revisions remain immutable.

Recommended additive descriptor (illustrative shape; final schema requires owner approval):

```ts
// packages/shared — additive, strict, closed; absence = identical baseline behavior
export const PedagogyBlockSchema = z
  .object({
    prediction: z
      .object({
        required: z.boolean().default(false),
        target: z
          .enum(["unit", "code-reading", "exercise", "review"])
          .default("unit"),
        /** Deterministic verifier when the observation is known; otherwise unverified. */
        expectedObservation: TextSchema.nullable().default(null),
      })
      .optional(),
    hypothesisDebugging: z
      .object({
        trigger: z
          .enum(["on-failed-check", "on-changes-requested", "always"])
          .default("on-failed-check"),
        maxActiveHypotheses: z.literal(1).default(1),
      })
      .optional(),
    teachBack: z
      .object({ required: z.boolean(), audience: z.enum(["beginner"]) })
      .optional(),
    transfer: z
      .object({
        transferOfStableId: IdSchema,
        novelty: z.enum(["near", "far"]).default("near"),
        /** Exactly one new constraint per step. */
        constraints: z.array(ShortTextSchema).max(1),
      })
      .optional(),
    autopsy: z
      .object({
        trigger: z
          .enum(["never", "on-repeated-error", "manual"])
          .default("on-repeated-error"),
      })
      .optional(),
  })
  .strict();
```

This is a **descriptor of pedagogy** (authored, validated, fail-closed data), not a runtime engine. Behavior lives in app-owned deterministic policies (versioned learning routes + kernel projections) that read the block and apply the existing fact/evidence mechanisms. The PedagogyBlock is authored content in the immutable Course Revision snapshot; active sessions pin it exactly as they pin any other snapshot content.

### C.2 Central mechanism: the Practice Loop

The combination `immutable first attempt + prediction + hint level + trusted outcome + correction supersession + evidence diversity + accelerated mistake retrieval + transfer` is already almost assembled from existing mechanisms. This proposal adds exactly three missing links (real hint level in facts, prediction verification, hypothesis workflow) — after which every practice item deterministically records:

```text
attempt (immutable) → prediction (committed; verified / unverified)
→ hints (max level used) → trusted outcome
→ correction (supersedes) → mistake family (recurrence count)
→ retrieval (accelerated, diverse forms) → transfer (authored, novelty)
```

From this fact set, the illustrative "rich learner model" (understanding, independence, hint dependence, recurring misconception, calibration, missing coverage) is assembled **without new authoritative metrics** — as derived projections whose every number traces to a provable source-fact frontier. Existing fields already support the linking: evidence facts carry `basisFactIds`, so prediction/hypothesis/self-review facts reference their attempt facts.

### C.3 What deliberately does not change

- No new fact body types; no new mastery dimensions for P0; no new unit types.
- No chat wrapper; every new workflow is structured UI whose state lives in Aptiloop (typed fields, deterministic transitions), with an optional advisory Tutor beside it.
- No model-owned decisions anywhere: models may propose question wording, hints within the authorized level, error-family candidates, transfer scenarios, and draft content — via existing typed proposal tools, draft-only Apply.

## D. Evidence Model

**Proposed pending owner approval.** The current `LearningKernelEvidenceBody` is closed (`dimension`, `evidenceType`, `outcome unverified|incorrect|partial|correct`, `hintLevel`, `errorFamily?`, `occurredAt`, `basisFactIds`). The proposal extends it additively with closed optional sub-objects (fact schema v3):

```ts
// additive, closed; absent fields = byte-identical baseline projections
prediction?: {
  text: string; // committed before the observation
  verification: "matched" | "mismatched" | "unverified";
};
hypothesis?: {
  statement: string;
  experimentOutcome: "supports" | "rejects" | "partially" | "unverified";
};
selfReview?: { suspectedArea: string }; // metacognitive; always unverified
reflection?: { kind: "autopsy" | "mental-model-correction" };
surfaceVariantId?: string; // authored transfer/novelty axis for coverage
```

### D.1 Evaluation authority per evidence kind

| Evidence                          | Authority                                                                                                    | AI required?                                          | AI Off behavior                            |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- | ------------------------------------------ |
| Prediction `matched`/`mismatched` | Deterministic evaluator only (snapshot `expectedObservation` or trusted-check result)                        | No                                                    | Fully usable                               |
| Prediction `unverified`           | Participation evidence, as today                                                                             | No                                                    | Fully usable                               |
| Hypothesis `supports`/`rejects`   | Learner statement compared against the trusted experiment result; comparison recorded deterministically      | Tutor advisory only                                   | Structure fully works; tutor advice absent |
| Self-review / reflection          | Participation/unverified; never mastery                                                                      | No                                                    | Fully usable                               |
| Guided completion                 | Evidence with `hintLevel: 5` + a deterministic "independent verification scheduled" fact                     | Reference reveal is authored content, not AI          | Fully usable                               |
| Transfer attempt                  | Ordinary implementation/explanation evidence against trusted checks where available; otherwise participation | Scenario authored or AI-proposed (Apply → Draft only) | Authored transfers fully usable            |

**Critical invariant:** a `mismatched` prediction is **not** an `incorrect` mastery credit. Prediction verification does not enter scoring (Section F); a deterministic `mismatched` creates a mental-model-gap mistake-family candidate instead. This prevents rewarding guessing and prevents double punishment for honest thinking. Verified prediction fields are set only by deterministic-evaluator/trusted-check provenance; learner and model narrative remain `unverified`.

## E. Kernel Changes

**Proposed pending owner approval.** Minimize kernel complexity; nothing here changes fact acceptance, operation idempotency, or hash-frontier mechanics.

1. **Fact schema v3:** the reducer validates the new closed optional sub-objects (additive migration `0022_learning_kernel_fact_schema_v3` proposed). Projections over old frontiers remain byte-identical; old facts are never rewritten.
2. **Guided-completion scheduling:** a one-policy extension in the review-prefix projection — evidence whose effective hint level reached 5 (`revealsAnswer`) schedules an independent-verification review item on the same knowledge node, through the same policy path that already creates mistake review items. The verification task prefers a different authored surface/variant and starts without hints.
3. **Prediction-mismatch mistake candidate:** a deterministic `mismatched` prediction creates/extends a mistake family occurrence (the existing `(knowledgeNodeId, errorFamily)` path with its accelerating retrieval schedule).
4. **Review item form:** an additive closed `form` field on the review-item projection, chosen by a deterministic policy from `(dimension, errorFamily?, completedForms, evidence diversity)`; no model participates in the choice.
5. **Mastery computation:** unchanged for P0 — existing hint multipliers finally applied by real hint levels, existing diversity cap unchanged.

## F. Mastery Changes

**Proposed pending owner approval.**

- **No new dimensions.** `MASTERY_DIMENSIONS` is a closed list mapped 1:1 to evidence types; prediction, hypothesis, transfer, and metacognition are **qualities of evidence and coverage axes**, not separate skills. Adding a `transfer` dimension would require authored content that Course Packs cannot guarantee and would multiply projection complexity. Transfer is expressed as evidence diversity/coverage, not a new score.
- **Mastery scoring unchanged for P0:** real hint levels multiply positive credit through the existing `masteryCreditMultiplier` ladder; the advanced cap (score > 4 requires two evidence types × two days) already rewards diversity.
- **Model version `baseline-2`** (single P1 candidate): only if `surfaceVariantId` enters diversity scoring (e.g., variants feed the advanced cap). A versioned model with deterministic reprojection and no history rewrite follows the existing model-version discipline; this requires its own owner-approval decision and a replay-hash migration rehearsal.
- **Transfer evidence:** ordinary `implementation`/`explanation` evidence; robustness is presented as coverage (evidence types × days × authored novelty), never as a separate authoritative score.
- **Metacognition:** a diagnostic layer (predictions, self-review, optional confidence) — always unverified, never mastery.

## G. Mistakes and Mental Models

**Proposed pending owner approval.**

- **Recurrence is already strong:** `errorFamily` occurrence counts, `repeatedErrorPenalty`, and occurrence-accelerated retrieval (`max(1, 4 − min(occ, 3))` days) need no replacement. Nothing here multiplies mistake surfaces.
- **Misconception lifecycle:** the authored `misconception-family` node is authoritative meaning; the runtime `errorFamily` is the occurrence record. The **link** between them is authored (activity/question metadata → errorFamily → misconception node), because runtime AI classification cannot authoritatively name a misconception (fail-closed principle). AI may only **propose** mappings or error-family candidates through a typed proposal tool along the existing Adaptive Studio path: candidate → owner/learner acceptance on a Draft → validation → Apply. Confirmed recurrence is deterministic from occurrence counts.
- **Bug autopsy:** not a new unit type — a structured reflection attachment triggered deterministically:
  - default `on-repeated-error`: the same mistake family occurs twice or more (deterministic from counts), or a manual learner action ("Reflect on this mistake");
  - authored `autopsy.trigger` may restrict or allow it per activity;
  - autopsy never runs after trivial isolated errors (single occurrence, no conceptual tag).
- **Autopsy structure (learner-restated, never AI-restated):** what happened (BUG) → what the learner believed (ORIGINAL MODEL) → what actually happened (REAL MODEL) → which earlier observation was missed (MISSED SIGNAL) → which concept was misunderstood (ROOT CONCEPT) → which habit/test/tool prevents recurrence (PREVENTION). The learner **self-restates** the corrected idea in a revision turn (reusing the existing teacher-dialogue first-explanation/revision-turn semantics); a Tutor may ask follow-up questions but never restates the correction for the learner.
- **Autopsy products:** a reflection evidence fact (`unverified`, no mastery by itself), optionally a mental-model-correction fact linked to the superseding correction via `basisFactIds`, and a deterministic review-item candidate on the misconception node (the same path mistake review items use). Summary presents it honestly as reflection material.

## H. Review Changes

**Proposed pending owner approval.**

- **Retrieval forms (closed enum, deterministic selection):** `recall | predict | find-bug | explain-fix | apply | transfer` — deliberately aligned with the authored `QuestionKind` vocabulary that already exists (`predict-output`, `find-bug`, `explain`, `compare`, `design-choice`). Selection policy, in order:
  1. the form in which the learner failed previously has priority;
  2. otherwise rotation across completed forms against evidence diversity;
  3. difficulty escalation only after success on the weak form;
  4. prerequisite regression: a weak prerequisite node forces a regression form before advancing.
     The policy is versioned and deterministic; a model may propose wording/content only inside an authored Draft.
- **Review from mistakes:** a mistake review item (already created per `(knowledgeNodeId, errorFamily)`) gains a **form sequence** instead of flashcards: an async-closure mistake → `predict` output of an unfamiliar example → later `find-bug` in stale-closure code → `explain-fix` why the fix works → `apply` the concept in another context. Each success deterministically schedules the next form; each failure resets to the earliest weak form. Existing due cycles keep their dates and states — the form field is additive and defaults deterministically.
- **Scheduler unchanged:** due computation, successor creation, and participation-only completion remain deterministic; a model never sets a due date, marks a review completed, or dismisses an item.

## I. UX (Structured, Not Chat; Avoiding Ceremony)

**Proposed pending owner approval.** All learner-facing copy goes through the `en-US`/`ru-RU` catalogs; identifiers, schema keys, evidence types, and check IDs stay non-localized.

### I.1 Exercise failure → debugging protocol (structured UI)

```text
Expected behavior        [ textarea ]
Actual behavior          [ textarea ]
Current hypothesis       [ textarea ]
Evidence so far          [ textarea ]
Prediction for next experiment [ textarea ]
[Run trusted check]
Observed result (trusted, injected)  ...
Did this support your hypothesis?  [ Yes ] [ No ] [ Partially ]
[ Keep hypothesis ] [ Revise hypothesis ] [ Try fix ] [ Verify ]
```

- One hypothesis and one experiment at a time (`maxActiveHypotheses: 1`); hypothesis rejection after contradicting trusted evidence is recorded deterministically.
- The AI Tutor sits beside the workflow as advisory: ask questions, help make the hypothesis falsifiable, suggest a minimal diagnostic experiment, escalate hints through the ladder — but by default it never names the file, the line, or the final fix, and it never rewrites code (Reviewer remains read-only; the workspace stays in the learner's editor).
- Without AI, the entire structured flow works; the tutor panel shows an explicit No-AI state.

### I.2 Prediction → verify (code-reading and `predict-output` quiz questions)

Committed prediction → trusted observation injection → `matched`/`mismatched` comparison with highlight → learner explains the difference in their own words (committed as explanation evidence). Protected material is never revealed before the commit.

### I.3 Hint escalation control

- A "Request hint" control gated by the existing `canAdvanceHint` semantics server-side (unsuccessful attempts, learner request, `reference_locked`).
- The ladder shows the current level and what the next level would reveal (from authored hint content per problem).
- Level 5 requires an explicit "Show reference" action; after reveal, the practice item is honestly labeled **Guided completion** and the system deterministically schedules an independent verification task (different authored surface/variant, no hints initially).

### I.4 Self-review before Reviewer

Two bounded questions before the AI review ("Which part are you least confident about?" / "Which assumption could be wrong?"), then the evidence-only Reviewer runs as today, then a comparison panel (suspected vs found) is presented. Self-review evidence is metacognitive and unverified; the Reviewer contract is unchanged.

### I.5 Ceremony matrix (selective, authored pedagogy — never everything everywhere)

```text
Simple recall:        attempt → feedback                       (as today)
Code reading:         prediction → explanation → verify        (P0)
Exercise:             attempt → trusted test → hint if needed  (P0)
Failed exercise:      debugging protocol                       (P0)
Corrected bug ×2+:    autopsy (optional / triggered)           (P0)
Strong success:       transfer challenge (authored)            (P1)
Concept completion:   teach-back (existing teacher-dialogue)   (as today)
Review:               different retrieval form per cycle       (P1)
```

No activity carries every protocol: the authored `PedagogyBlock` selects what applies, and validators bound complexity per activity.

### I.6 Derived learner view (illustrative target, never a pseudo-metric)

When facts allow, presentation may honestly show:

```text
Knowledge node: React closures
Understanding (mastery):        Strong
Independent recall:             Strong
Code reading:                   Strong
Implementation:                 Medium
Debugging:                      Weak
Transfer:                       Weak / insufficient evidence
Hint dependence (derived):      Medium (most credit at level 3+)
Recurring misconception:        "Callback reads latest render state" (×2, corrected, transfer unverified)
Self-assessment calibration:    Low accuracy / potentially overconfident (from prediction & self-review observations)
Evidence diversity:             recall, code prediction, implementation, debugging
Missing coverage:               transfer under an async scenario
Recommended next action:        Debug an unfamiliar stale-closure example without hints (deterministic)
```

Every line traces to existing or proposed kernel projections; "Recommended next action" remains the existing deterministic selection. Missing-coverage and hint-dependence lines are **derived diagnostics**, explicitly not authoritative scores.

## J. Course Authoring

**Proposed pending owner approval.**

- **PedagogyBlock in payloads:** additive, strict, closed. Course Pack V1 is unchanged for existing Packs; Packs carrying pedagogy require the additive schema version, and existing validators keep failing closed on unknown fields. Manual authoring remains complete without AI; pedagogy descriptors are editable typed controls in Adaptive Studio.
- **Validation rules:** max mechanisms per activity; prediction not on briefing/study/checkpoint; hypothesisDebugging only on exercise/review; transfer requires a resolvable `transferOfStableId` and a declared verification surface; hint levels require authored content per level; unknown pedagogy keys fail closed.
- **Course Designer:** pedagogy proposals are typed proposals against the current Draft with provenance and model disclosure (the existing proposal path): e.g., for the goal "understand the event loop" → study, recall, code-reading with prediction, exercise, debugging on failure, teach-back, later transfer review; for basic syntax → study, recall, exercise. The deterministic validator bounds per-activity complexity; Apply changes only the Draft; Preview, Change review, and Publish remain separate explicit actions.
- **Existing Courses:** zero impact. Published Revisions are immutable — pedagogy appears only in new Revisions or personal Adaptation Branches; active sessions pin their existing snapshots and are unaffected.

## K. Migration Strategy

**Proposed pending owner approval.**

- **One additive DB migration (`0022_learning_kernel_fact_schema_v3`):** additive schema version plus closed optional evidence sub-objects. Facts are append-only; nothing is rewritten; unmatched/ambiguous rows remain quarantined history as today.
- **Rehearsal on a disposable database (required before any valuable-data migration):** replaying an old frontier under the new schema must reproduce old canonical bytes/hashes; replaying a new frontier must stay replay-complete. Backward reads of old facts remain compatible.
- **Model version:** projections for old frontiers are byte-identical, so P0 needs no model bump; `baseline-2` only with the P1 diversity-scoring change, with its own reprojection and owner approval.
- **Reuse, don't duplicate:** the hint persistence (`hint_usages_v2`, `recordHintUsage`) and repository seams already exist; they are activated, not re-created.

## L. Backward Compatibility

**Proposed pending owner approval.**

- **Profiles/facts/projections:** untouched; new evidence fields are optional and closed; old rows read unchanged.
- **Published revisions/sessions:** pinned snapshots continue; pedagogy arrives only in new revisions/personal branches.
- **Evidence:** old evidence stays valid; nothing becomes required retroactively; the fail-closed semantics of pre-envelope Summary rows (Reviewer-verdict/correction-derived contamination) are not softened.
- **Review items:** existing due cycles keep dates/states; the additive `form` field defaults deterministically.
- **UI routes:** additive endpoints only; existing DTOs gain optional strict fields.
- **Tests/E2E/Provider Hub/Course Designer/backup-restore/AI Off:** unaffected by default; each milestone updates only the surfaces it touches. AI Off must remain fully supported: every P0 protocol works end-to-end without a provider (advisory Tutor absent, structure intact); no Course becomes unusable with AI Off.

## M. Testing Strategy

**Proposed pending owner approval.**

- **Unit (learning-core):** reducer validation of new body fields (malformed/unknown fail closed); correction supersession with prediction fields; hint advance gating (`attempt_required`, `reference_locked`, `maximum_level`); guided-completion scheduling; mistake-acceleration unchanged; retrieval form-selection policy determinism (order-independent); advanced diversity cap unchanged; byte-identical projections over old frontiers.
- **Integration (database):** migration `0022` on a disposable DB; old-frontier replay = old hashes; new-fact insertion + projection verification; existing operation-replay idempotency; backward reads.
- **Integration (orchestrator):** hint endpoint gating; prediction verification (deterministic + unverified paths; mismatch → mistake candidate, no mastery); debugging protocol → trusted-check injection; self-review submission; review submission authority unchanged; protected material never exposed before commit (`rejectProtectedFields` path).
- **Web (component):** structured debugging UI; hint control; prediction reveal; suspected-vs-found panel; AI Off paths (tutor visibly blocked, everything else usable); `en-US`/`ru-RU` catalogs — any new learner-facing hardcoded copy is a regression.
- **Security:** verified prediction/hypothesis comparison only from deterministic-evaluator/trusted-check provenance; AI-proposed error-family mappings fail closed on Apply to anything but a Draft; autopsy triggers deterministic and never provider-driven; cancellation/cleanup for staged protocol state; no raw provider events into protocol evidence.
- **E2E:** the full Practice Loop with AI Off and AI On (Mock restricted to dev/test), migration rehearsal, replay-hash tests; no E2E claim until `npm run test:e2e` passes.

## N. Incremental Implementation Plan

**Proposed pending owner approval.** Milestones are small, usable, tested, additive, and independently roll back; each leaves a runnable vertical slice and updates only the documentation it makes stale. The order below supersedes the P1/P2 grouping of Section B where more specific.

**Milestone 1 — Hint workflow activation (P0).** Hint request endpoint (per activity problem, `canAdvanceHint` enforced server-side); authored hint content per level as an additive payload field; real hint level written into evidence facts (replacing the always-zero glue); UI control with ladder presentation; guided-completion badge; level-5 reveal → deterministic independent-verification scheduling. Acceptance: an evidence fact with `hintLevel > 0` demonstrably multiplies mastery credit; the first attempt never receives hint content (protected); AI Off works (authored hints are content, not AI output).

**Milestone 2 — Prediction verification + mental-model-gap candidates (P0).** Reveal/self-check step for code-reading and `predict-output` quiz questions; deterministic verification when a known observation exists (snapshot `expectedObservation` or trusted result); fact schema v3 + migration `0022`; deterministic `mismatched` → mistake-family candidate. Acceptance: mismatch creates an accelerated review item on the error family; prediction verification assigns no mastery; unverified predictions remain participation.

**Milestone 3 — Hypothesis-driven debugging protocol (P0).** Structured debugging UI on exercise failure/correction; one-hypothesis limit; prediction-before-experiment with trusted check injection; hypothesis support/rejection recorded deterministically against the trusted result; debugging-process evidence facts. Acceptance: debugging mastery credit still flows only through trusted outcomes; hypothesis mismatch never writes mastery; AI Tutor advisory optional; the full structured flow works with AI Off.

**Milestone 4 — Misconception lifecycle + Bug Autopsy (P0).** Authored errorFamily → misconception-node mapping (activity metadata); deterministic autopsy trigger (repeated error / authored / manual); learner-restated revision turn (existing teacher-dialogue semantics); reflection evidence (`unverified`). Acceptance: autopsy never runs from a provider turn; a repeated conceptual error creates an autopsy request, not a duplicate mistake; Summary reflects it honestly.

**Milestone 5 — Adaptive retrieval forms (P1).** Closed `form` enum on review items; deterministic selection policy; form-aware review surface backed by authored snapshots per form; mistake-driven progression predict → find-bug → explain-fix → apply. Acceptance: no model chooses form or date; progression is deterministic; existing due cycles unaffected.

**Milestone 6 — Transfer challenges + Practice Loop presentation (P1).** Authored transfer descriptors (novelty, one-constraint-per-step); deterministic surfacing after independent success; transfer evidence + coverage presentation; `baseline-2` diversity scoring only here (separate owner approval). Acceptance: transfers are authored or draft-only AI proposals; the derived Practice Loop view shows coverage/novelty/hint dependence from facts with no pseudo-metrics.

**Milestone 7 — Self-review + calibration, confidence (P2).** Bounded self-assessment before the Reviewer; suspected-vs-found comparison presentation; optional pre-answer confidence on prediction activities; derived calibration observation. Acceptance: metacognitive evidence is always unverified; fields are optional with an explicit skip; no new mastery dimensions.

**Milestone 8 — Existing-mechanic strengthening (P1, near-zero cost).** Teach-back follow-ups on teacher-dialogue (omission/conceptual/terminology distinction as presentation only — evaluation remains advisory); API-discovery question set as an authored recall/study pattern (over Source Snapshots/Knowledge Capsules: predict/answer → read snapshot → correct own model → small experiment → teach-back); architecture interview scenario templates (interview setup topics).

## Conclusion

**Proposed pending owner approval.** Aptiloop's deterministic skeleton already contains the hard half of deliberate practice: immutable first attempts, correction supersession, evidence diversity, repeated-misconception penalties with accelerating retrieval, misconception-family knowledge nodes, trusted outcomes, and a complete tested hint ladder. This proposal adds the three missing links (real hint levels, prediction verification, hypothesis workflow), a minimal authored `PedagogyBlock` instead of a protocol engine, a misconception lifecycle, mistake-driven retrieval forms, authored transfer, and honest derived learner views — with no new mastery dimensions, no model authority anywhere, structured (never chat) UI, and full AI Off usability. The desired end state: Aptiloop knows not only whether the learner completed a task, but — from transparent evidence — how independently they reasoned, where their mental model diverged from reality, how much help they needed, whether they corrected the misconception, and whether they can apply the same principle in a new situation.

Nothing in this document takes effect without explicit owner approval. After approval, implementation follows Section N milestone by milestone, each with its own verification gate (`npm run format:check`, `npm run lint`, `npm run typecheck`, targeted tests, then the applicable full gate) and migration rehearsal on a disposable database before touching any valuable data.
