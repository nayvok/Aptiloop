# Aptiloop Dev Tour course pack presets

**Implemented baseline (development fixtures only).**

`aptiloop-dev-tour-en.course-pack.json` and `aptiloop-dev-tour-ru.course-pack.json`
are repository development presets of the same declarative mini-Course, one per
primary Course locale (`en`, `ru`). Each pack installs as a separate Course and
walks through every currently importable Aptiloop activity surface in a few
minutes: briefing, study, recall, teacher-dialogue, quiz, code-reading,
summary, checkpoint, interview, and spaced-review. Quiz questions are trivial
and their correct answers are marked in protected material so the tour runs
quickly.

These files are fixture content, not production Course material. A development
orchestrator start installs both presets into the active development database;
they are never included in a production build.

- Import and usage: [docs/development/dev-tour-course-packs.md](../../../../docs/development/dev-tour-course-packs.md)
- Validation guard: `packages/curriculum/test/dev-tour-course-packs.test.ts`
  runs both files through the same `validateCoursePackBytes` boundary used by
  import.

## Maintenance rule

Update both presets in the same commit whenever an activity or completion
structure changes, and keep them importable (zero validation errors). Run:

```sh
npm run test --workspace=@aptiloop/curriculum
```

Known limitation: the import registry currently provides no trusted check IDs,
so `exercise` (and the `review` activity that references an exercise) cannot
pass Course Pack import validation yet. Add them to both presets in the same
commit that makes trusted check IDs available to the import registry.
