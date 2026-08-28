# Aptiloop

Local-first deliberate practice for durable technical skill.

Aptiloop turns an authored Course into a finite sequence of evidence-producing activities: study, recall, explanation, implementation, trusted checks, correction, and review. It is designed for learners who want durable, inspectable progress rather than passive content completion. The deterministic Learning Kernel owns progression, evidence reduction, mastery, mistakes, review scheduling, and the next action; optional AI stays behind explicit, constrained roles.

**Implemented baseline**

The current repository implements the Aptiloop application and its local SQLite learning store, Course and immutable revision workflows, deterministic learning and evidence rules, Adaptive Studio, constrained Provider Hub roles, and responsive `en-US`/`ru-RU` application surfaces. A fresh profile is intentionally empty: no Course is bundled, so the learner starts with **Create Course** or **Import Course Pack**.

### Implemented now

- **Finite learning model:** Courses become validated Activity Graphs with immutable published Revisions, personal Adaptation Branches, and exact Course/revision/session context.
- **Deterministic learning state:** append-only facts and replayable projections drive progression, mastery, mistakes, summaries, review scheduling, and next-action selection—not model prose.
- **Declarative acquisition:** Course Pack V1 is strictly validated, previewable, installable as a draft, exportable canonically, and free of commands, scripts, secrets, executable plugins, and absolute local paths.
- **Evidence-producing practice:** activity frames include briefing, study, recall, Tutor dialogue, quiz, code-reading, trusted exercise, interview, and summary work.
- **Bounded checks:** allowlisted Node and Python checks run against copied learner attempts, with Git/SHA-256-bound evidence and stale-input rejection. Execution is trusted and unsandboxed, not a hostile-code sandbox.
- **Constrained assistance:** Provider Hub resolves an exact connection, model, capability, and disclosure; active roles receive only Aptiloop-owned typed tools, and AI Off is supported.
- **Local-first state:** SQLite repositories and additive migrations retain learning history locally, with explicit sanitized export and create-only offline restore.
- **Usable application shell:** Home, Courses, Review, Skills, and Settings are available in responsive light and dark layouts with `en-US` and `ru-RU` catalogs.

### Technical highlights

- Course Designer proposals are typed, attributed, deterministically validated, and applied only to a selected Draft; Preview, Change review, and explicit Publish remain separate actions.
- Review execution records the learner's bounded response as participation evidence without inventing correctness or mastery, then schedules the deterministic successor.
- Reviewer is evidence-only and read-only: it cannot edit a workspace or apply a patch.
- Provider and model failures remain explicit. Aptiloop never silently switches to another provider, model, or Mock.

### Stack

Node.js `>=24.0.0` · npm `11.12.1` · TypeScript · npm workspaces · Turborepo · Next.js/React · Hono HTTP/SSE · SQLite · strict Zod boundary contracts.

### Clone and run

Requirements: Node.js 24 or newer, npm 11 (`npm@11.12.1` is pinned), and Git.

```sh
git clone https://github.com/nayvok/Aptiloop.git
cd Aptiloop
npm ci
npm start
```

Open <http://127.0.0.1:3000>. The documented launcher builds and starts the local production-mode web and orchestrator processes on loopback. No `.env` file or provider sidecar is required. The app is loopback-only and has no authentication or authorization; do not expose it to a LAN, tunnel, public proxy, or the Internet.

<p align="center">
  <img src="docs/readme/course-overview-desktop.jpg" width="900" alt="Aptiloop Course overview with the next lesson, deterministic progress, and finite learning stages" />
</p>

<p align="center"><sub>A disposable development profile using repository fixture content, shown in Russian; no provider credential, account data, or private path is shown.</sub></p>

## Capabilities

**Implemented baseline**

- Create a Course manually, optionally apply a typed AI proposal to its Draft, or import a strictly validated declarative Course Pack.
- Publish immutable Course Revisions and make learner changes in a personal Adaptation Branch without rewriting the source revision.
- Bind sessions to an exact Course, revision, lesson, and source snapshot; support one active session per Course and independent sessions across Courses.
- Record typed evidence and preserve provenance through deterministic Learning Kernel facts and projections.
- Run due Review Items as typed free-response activities, retaining participation without asserting correctness or mastery when no verified evaluator exists.
- Export a sanitized local profile and restore it offline into a fresh profile without overwriting or merging an active profile.

Manual authoring is complete without AI. Applying a proposal changes only a Draft; validation, learner Preview, Change review, and explicit Publish are separate operations. Repository exercise fixtures are development evidence, not bundled production Courses.

## Architecture map

The implemented request path is:

```text
Browser presentation
        -> Hono orchestrator (HTTP/SSE and runtime policy)
        -> repositories, pure rules, and provider/execution adapters
        -> SQLite and local runtime state
```

The learning flow is:

```text
Course
  -> immutable Course Revision
  -> finite Activity Graph
  -> typed evidence and immutable session snapshot
  -> deterministic Learning Kernel
  -> next action, mastery projection, and scheduled review
```

| Path                     | Responsibility                                                    |
| ------------------------ | ----------------------------------------------------------------- |
| `apps/web`               | Next.js presentation and browser state                            |
| `apps/orchestrator`      | Hono HTTP/SSE composition and app-owned runtime policy            |
| `packages/shared`        | Strict schemas and boundary DTOs                                  |
| `packages/learning-core` | Deterministic learning rules and projections                      |
| `packages/agent-core`    | Provider Hub, role policy, typed tools, and normalized events     |
| `packages/exercise-core` | Attempts, paths, Git evidence, and bounded trusted execution      |
| `packages/database`      | SQLite schema, migrations, repositories, seed, and backup         |
| `docs`                   | Current specifications, decisions, operations, and dated evidence |

See [Architecture](ARCHITECTURE.md) for ownership boundaries and the [documentation index](docs/README.md) for the deeper architecture specifications.

## Optional AI boundary

**Implemented baseline**

AI Off is a supported state. To enable a provider, open **Settings → Connections**, create a connection, provide its credential through the explicit local form, and assign one exact available model to each desired role.

- Provider Hub owns connection, model, capability, network, authentication, and disclosure resolution.
- External turns require an exact operation-scoped disclosure approval that is consumed once.
- Roles receive only finite Aptiloop-owned typed tools; they have no arbitrary filesystem, shell, network, credential, or general editing authority.
- Credentials remain in the app-owned local credential store; they are accepted only by the explicit local credential mutation and never returned in browser responses or persisted in Course Packs, prompts, SQLite, or exports.
- A real-provider failure is explicit. Aptiloop never silently falls back to Mock or substitutes another provider/model; Mock is development/test-only.

See [Provider connections](docs/providers.md) and [AI boundaries](docs/security/ai-boundaries.md).

## Local data, security, and limits

**Implemented baseline**

Aptiloop is local-first and single-user. Course material, learner state, evidence, mistakes, mastery, transcripts, and settings remain on the device unless the user explicitly exports or shares a named payload. The process-mode database currently uses `.data/dev-learning-harness.sqlite`; credentials are stored separately.

On Windows, provider credentials are encrypted for the current OS user with DPAPI. On POSIX systems and inside the Linux Compose profile, the credential file is private plaintext with an owner-only mode request. This protects an offline copy from another account, not from software already running as the same user.

Course Packs are untrusted declarative data. They cannot contain commands, scripts, executable plugins, credentials, provider sessions, or absolute local paths. Trusted Node and Python checks use bounded app-owned process plans, but execution is local and unsandboxed. Docker Compose is optional loopback-only packaging, not an authenticated self-hosting profile.

Move a local profile with:

```sh
npm run data:export
npm run data:restore -- --source <bundle.aptiloop-data>
```

Export excludes credentials, raw provider payloads, environment files, exercise workspace files, device paths, and transient provider state. Restore is offline and create-only; bundle hashes provide integrity, not creator authenticity. See [Local data portability](docs/data-portability.md) and [Current database operations](docs/migration/current-database-operations.md) before changing valuable data.

Other current limits include process-local Course Pack staging, quarantined ambiguous migration rows, and no complete WCAG 2.2 AA certification claim.

## Operations and development

Optional development stack with file watching and explicit development fixtures:

```sh
npm run dev
```

Optional loopback-only container packaging:

```sh
docker compose up --build
```

Useful repository commands:

| Command                                                   | Purpose                                            |
| --------------------------------------------------------- | -------------------------------------------------- |
| `npm run build`                                           | Build every workspace                              |
| `npm run typecheck`                                       | Run all TypeScript checks                          |
| `npm run lint`                                            | Run all lint tasks                                 |
| `npm run test:fast`                                       | Run unit, integration, component, and policy tests |
| `npm run test:e2e`                                        | Run the lock-serialized Playwright suite           |
| `npm run audit:policy`                                    | Produce dependency policy reports                  |
| `npm run sbom`                                            | Generate the CycloneDX npm SBOM                    |
| `npm run data:export`                                     | Create a sanitized local-profile transfer bundle   |
| `npm run data:restore -- --source <bundle.aptiloop-data>` | Restore one bundle offline; never overwrite        |

Read [Development](docs/development.md) before changing behavior and [Repository rules](AGENTS.md) before contributing.

## Focused documentation

- [Product contract](PRODUCT.md)
- [Architecture](ARCHITECTURE.md)
- [Documentation index](docs/README.md)
- [Security policy](SECURITY.md)
- [Self-hosting boundary](SELF_HOSTING.md)
- [Provider connections](docs/providers.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Course Pack architecture](docs/architecture/course-pack.md)
- [Learning Kernel architecture](docs/architecture/learning-kernel.md)
- [Execution Fabric](docs/architecture/execution-fabric.md)
- [Local data portability](docs/data-portability.md)
- [Roadmap](ROADMAP.md)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution terms, repository rules, and the required engineering workflow. Third-party and branding boundaries are documented in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and [TRADEMARKS.md](TRADEMARKS.md).

## Release status

**Implemented baseline**

This public source repository is the clone-and-run distribution, licensed under Apache-2.0. It is **not a tagged Core Alpha release**.

**Approved Core Alpha target**

Core Alpha acceptance remains a separate release gate requiring product and security evidence, dependency and runtime verification, third-party notices, content provenance, trademark review, artifact authorization, and owner sign-off. Dated audits and working-tree provider evidence do not certify every provider, role, recovery path, current tree, or release acceptance.

**Future**

Multi-user identity, cloud sync, remote/self-hosted access, PostgreSQL deployment, collaborative authoring, third-party plugins, arbitrary executable Course content, and production Course distribution are not implemented. See [Roadmap](ROADMAP.md) for the status ledger.

## License

**Implemented baseline**

Copyright 2026 Yan Yushkov (`nayvok`). First-party materials in this repository that the copyright holder has authority to license are available under the [Apache License 2.0](LICENSE), unless a file or directory states otherwise.

The covered first-party materials include source code, tests, documentation, translations, development fixtures, and project-created visual assets. The project license does not grant rights to user-authored or imported Courses, private or learner data, credentials, local databases, backups, exports, or third-party components; those retain their owners and applicable terms. Apache-2.0 does not grant rights to use Aptiloop branding to present a fork as official. See [NOTICE](NOTICE), [Third-party notices](THIRD_PARTY_NOTICES.md), and [Name and branding](TRADEMARKS.md).
