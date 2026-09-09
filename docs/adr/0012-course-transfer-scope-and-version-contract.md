# ADR 0012: Course Transfer Scope and Version Contract

## Status

**Approved Core Alpha target**

## Date

2026-09-09

## Context

Course transfer has two user meanings: `share` (canonical Course Pack without learner data) and `transfer` (private device transfer of Courses plus progress). Transfer-with-progress always carries history. The v1 envelope currently requires at least one pack or revision snapshot, so every exported transfer must contain the Course content itself. During the attempt-restore slice we established three facts:

1. **Active exercise attempts can only exist for Courses that have `exercises` rows.** Today only the seeded development Course has them; Course Pack–imported Courses have none, so the full `export → import → restore` route could not be proven end-to-end.
2. **Seeded development revisions carry preserved legacy content hashes** that cannot be re-derived through the current canonization, so they are not representable as immutable revision snapshots.
3. **The envelope has no notion of the originating app version** — only the envelope schema version (`v1`) is present, and unknown schema versions fail closed without precise diagnostics.

Owner scenarios: transferring Course progress and attempts between a user's own PCs where the same Course revision is already installed, importing a transfer created on an older/newer app version, and Courses referencing activity/check/environment types the app does not know.

## Decision

1. **LearnerScope-only transfer is allowed for already installed Courses.** A transfer envelope without `packs`/`revisionSnapshots` is valid only when the target already holds the exact same Course revision (course/revision identity plus revision content hash bound to the exported learner scope). Importing a new Course still requires the full envelope. The schema and preview surface this mode explicitly and validation fails closed with a precise diagnostic when the target lacks the matching installed revision.

2. **Version contract: schema version is the hard contract; app version is metadata.**
   - `format` + `formatVersion` remain literals and the only hard compatibility contract. An unknown/newer schema fails closed with a clear "update the app" diagnostic; an explicitly older schema fails closed with "re-export from a current version".
   - The originating app version is recorded in the manifest at export and shown as a non-blocking warning in the import preview when it differs from the target app version.
   - App version must not be conflated with schema version: UI-only releases do not bump the schema.
   - Structural Course migration under a different app version is NOT implemented here; it is a separate owner-approved slice (revision upgrade semantics).

3. **Unknown Course types fail closed with precise diagnostics.** A transfer whose Course references activity, evidence, check, or environment types the app does not support is rejected with code/path/entity diagnostics instead of being installed partially or silently skipping steps. Soft "unavailable" handling may be added later inside the precise import diagnostics slice; it is not part of this decision.

4. **Scope of the finishing session for this slice.** Implement decision 1 and close the full route proof: export with an active attempt → import on a profile where the same Course revision is already installed → restored exercise workspace and Git learner commits carrying source author identity. Do not start import diagnostics, upgrade semantics, or Learning Design in the same session.

## Consequences

- A user can transfer progress and attempts between their own devices where the same Course revision is already installed; no Course Pack re-install is forced.
- New Course import still requires the full trusted envelope; the learnerScope-only path cannot smuggle progress onto a mismatched Course.
- Version mismatches become predictable: schema mismatch is a hard error, app version is an informational warning.
- The remaining route proof becomes achievable with the seeded Course installed on both source and target (the only Course with exercises today) while the mechanism itself is Course-agnostic.

## Alternatives considered

- **Recomputing seeded revision hashes under current canonization:** rejected as changing stored hashes and touching many tests without product value.
- **Implementing structural Course migration in this slice:** rejected as a separate, larger upgrade-semantics slice.
- **Silently skipping unknown activity types:** rejected as breaking activity-graph determinism and progress integrity.
- **Treating app-version equality as a hard import gate:** rejected because UI-only releases must not block transfers.

## Implementation status

**Implemented baseline (2026-09-09).** Decision 1 and the version contract are
materialized in the working tree: the transfer manifest carries `mode`
(`full` | `learnerScope`), `originatingAppVersion`, and bound
`learnerScopeCourses` (course/revision identity plus revision content hash);
learnerScope-only export no longer hard-stops when a selected Course has no
transferable content revision, and commit verifies the exact installed
revision match before restoring any learner state, failing closed with a
precise `TRANSFER_INSTALLED_REVISION_UNRESOLVED` diagnostic otherwise.
Import previews surface the mode and a non-blocking app-version warning.
Route proof passed in `apps/orchestrator/test/course-transfer.integration.test.ts`
(learnerScope-only fail-closed on a target without the revision, preview
version warning, and active attempt restore with source Git author
identity). No runtime evidence is claimed for decision 3 (unknown Course
types diagnostics) — that remains the separate precise-import-diagnostics
slice.
