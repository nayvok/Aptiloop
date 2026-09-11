# Aptiloop Dev Tour course packs

**Implemented baseline**

The repository ships two declarative Course Pack presets of the same
mini-Course, one per primary Course locale:

- `packages/curriculum/fixtures/course-packs/aptiloop-dev-tour-en.course-pack.json`
- `packages/curriculum/fixtures/course-packs/aptiloop-dev-tour-ru.course-pack.json`

Each preset installs as its own Course (`aptiloop-dev-tour-en` /
`aptiloop-dev-tour-ru`) and walks ten activity surfaces supported by these
importable fixtures: briefing, study, recall, teacher-dialogue, quiz,
code-reading, summary, checkpoint (lesson "Core learning loop"), then interview
and spaced-review (lesson "Practice and review"). Quiz questions are trivial
and their correct answers are marked in protected material, so the tour runs
quickly and shows each surface. UI locale (`en-US`/`ru-RU`) is independent of
the Course locale choice.

The presets are development fixtures: the development orchestrator installs
them automatically on startup, but they are not bundled into production builds
and never become production Course content. A clean development database thus
contains these two Courses and no legacy JavaScript/TypeScript curriculum.

## How to import

1. Start the app (`npm run dev` for development or `npm start` for the
   production-mode launcher) and open the URL printed by the launcher (the
   default production URL is <http://127.0.0.1:10101>; development web runs at
   <http://127.0.0.1:3000>).
2. Go to **Courses → Import** (`/courses/import`), select one preset JSON file,
   review the zero-error preview, and confirm **Install**. The imported Course
   appears immediately; open it and start lesson one.
3. Headless alternative from the repository root:

   ```sh
   aptiloop courses import packages/curriculum/fixtures/course-packs/aptiloop-dev-tour-en.course-pack.json
   ```

   (`aptiloop courses import` validates through
   `POST /api/course-packs/validate` and commits the install through
   `POST /api/course-packs/validations/{validationId}/commit` — the same
   server boundary as the `/courses/import` UI.)

On `npm run dev`, the development orchestrator validates and installs both
presets through the same repository boundary used by the import route. Both
presets also pass the exact import-boundary validator
(`validateCoursePackBytes`); `packages/curriculum/test/dev-tour-course-packs.test.ts`
enforces this continuously.

## How and when to update

Update **both** presets and the dev-tour guard in the same commit that adds or
changes an activity or completion structure, and keep them importable:

1. Edit both JSON files so every installed renderer/registry type stays
   represented and all references, graph finiteness, locale, and provenance
   rules hold. Keep IDs stable; never reuse a stable ID for different meaning.
2. Run the guard test:

   ```sh
   npm run test --workspace=@aptiloop/curriculum
   ```

3. Smoke the changed preset once through the `/courses/import` path and walk
   the lesson end to end.

## Known limitation: exercise and review

Course Pack import currently validates against a registry with no trusted
check IDs (`PACK_REQUIREMENT_UNAVAILABLE` for any `testCommandId`), so the
`exercise` activity and the `review` activity that references an exercise
cannot be part of an importable pack yet. When trusted check IDs become
available to the import registry, add `exercise` and `review` to both presets
in the same commit and extend the guard test's expected activity-type list.
